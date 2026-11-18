import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import QRCode from "qrcode";

import {
  buildAccessCandidates,
  choosePreferredAccessUrl,
  loadOrCreateRemoteConfig,
} from "./remote-config.mjs";

const APP_SERVER_URL = "ws://127.0.0.1:8766";
const execFileAsync = promisify(execFile);

function isBridgeHealth(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.ok === true &&
    ["app-server", "cli", "local-only"].includes(value.runtimeMode) &&
    typeof value.canSendMessages === "boolean" &&
    Array.isArray(value.accessCandidates)
  );
}

function requestSignal(timeoutMs, signal) {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  return AbortSignal.any(signals);
}

async function waitForReady({
  name,
  check,
  timeoutMs = 10_000,
  intervalMs = 100,
  now = Date.now,
  sleep = (milliseconds, signal) => delay(milliseconds, undefined, { signal }),
  signal,
}) {
  const startedAt = now();
  let lastError;
  while (!signal?.aborted) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }

    const elapsedMs = now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      const detail = lastError?.message ? ` Last error: ${lastError.message}` : "";
      throw new Error(`${name} was not ready within ${timeoutMs}ms.${detail}`, {
        cause: lastError,
      });
    }
    await sleep(Math.min(intervalMs, timeoutMs - elapsedMs), signal);
  }
  throw signal.reason ?? new Error(`${name} readiness was cancelled.`);
}

async function checkTcpConnection(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (ready) => {
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

export async function waitForAppServerReady(options = {}) {
  const endpoint = new URL(options.url ?? APP_SERVER_URL);
  const port = Number(endpoint.port || (endpoint.protocol === "wss:" ? 443 : 80));
  const checkTcp = options.checkTcp ?? checkTcpConnection;
  return waitForReady({
    name: "app-server",
    check: () => checkTcp(endpoint.hostname, port),
    timeoutMs: options.timeoutMs,
    intervalMs: options.intervalMs,
    now: options.now,
    sleep: options.sleep,
    signal: options.signal,
  });
}

export async function waitForBridgeReady(options) {
  const fetchFn = options.fetchFn ?? fetch;
  const url = `http://127.0.0.1:${options.port}/api/health`;
  return waitForReady({
    name: "bridge",
    check: async () => {
      const response = await fetchFn(url, {
        headers: { Authorization: `Bearer ${options.token}` },
        signal: requestSignal(options.requestTimeoutMs ?? 1_000, options.signal),
      });
      return response.ok && isBridgeHealth(await response.json());
    },
    timeoutMs: options.timeoutMs,
    intervalMs: options.intervalMs,
    now: options.now,
    sleep: options.sleep,
    signal: options.signal,
  });
}

export async function verifyAccessCandidate(candidate, options) {
  try {
    const healthUrl = new URL("/api/health", candidate.url).toString();
    const response = await (options.fetchFn ?? fetch)(healthUrl, {
      headers: { Authorization: `Bearer ${options.token}` },
      signal: requestSignal(options.requestTimeoutMs ?? 1_000, options.signal),
    });
    return response.ok && isBridgeHealth(await response.json());
  } catch {
    return false;
  }
}

export async function publishAccessCandidates(options) {
  const fetchFn = options.fetchFn ?? fetch;
  const baseUrl = `http://127.0.0.1:${options.port}`;
  const requestTimeoutMs = options.requestTimeoutMs ?? 1_000;
  const headers = {
    Authorization: `Bearer ${options.token}`,
    "Content-Type": "application/json",
  };
  const updateResponse = await fetchFn(`${baseUrl}/api/access-candidates`, {
    method: "POST",
    headers,
    body: JSON.stringify({ accessCandidates: options.accessCandidates }),
    signal: requestSignal(requestTimeoutMs, options.signal),
  });
  if (!updateResponse.ok) {
    throw new Error(`bridge rejected access candidates with HTTP ${updateResponse.status ?? "error"}`);
  }
  const updateBody = await updateResponse.json();
  if (JSON.stringify(updateBody.accessCandidates) !== JSON.stringify(options.accessCandidates)) {
    throw new Error("bridge returned different access candidates after update");
  }

  const healthResponse = await fetchFn(`${baseUrl}/api/health`, {
    method: "GET",
    headers: { Authorization: `Bearer ${options.token}` },
    signal: requestSignal(requestTimeoutMs, options.signal),
  });
  const health = healthResponse.ok ? await healthResponse.json() : null;
  if (
    !isBridgeHealth(health) ||
    JSON.stringify(health.accessCandidates) !== JSON.stringify(options.accessCandidates)
  ) {
    throw new Error("bridge health did not confirm the verified access candidates");
  }
}

export function detectLanAddresses(interfaces = os.networkInterfaces()) {
  const addresses = [];
  const seen = new Set();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if ((entry.family === "IPv4" || entry.family === 4) && !entry.internal && !seen.has(entry.address)) {
        seen.add(entry.address);
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

export async function detectTailscaleAddress(runCommand = execFileAsync) {
  try {
    const { stdout } = await runCommand("tailscale", ["ip", "-4"], {
      encoding: "utf8",
      timeout: 1_000,
    });
    const address = stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find((value) => net.isIP(value) === 4);
    return address || undefined;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    return undefined;
  }
}

async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function probePort(port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    server.listen({ port, host }, () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
  });
}

function registerSignal(signal, handler) {
  process.on(signal, handler);
  return () => process.off(signal, handler);
}

function formatChildFailure(name, code, signal) {
  const detail = code === null || code === undefined ? `signal ${signal ?? "unknown"}` : `code ${code}`;
  return `${name} stopped unexpectedly (${detail}).`;
}

export async function runRemoteLauncher(options = {}) {
  const projectRoot =
    options.projectRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const serverEntrypoint = path.join(projectRoot, "packages/server/dist/index.js");
  const exists = options.pathExists ?? pathExists;
  const error = options.error ?? console.error;
  const log = options.log ?? console.log;

  if (!(await exists(serverEntrypoint))) {
    error(`Missing compiled server: ${serverEntrypoint}\nRun npm run build and try again.`);
    return 1;
  }

  const loadConfig = options.loadConfig ?? loadOrCreateRemoteConfig;
  const config = await loadConfig();
  const checkPort = options.probePort ?? probePort;
  if (!(await checkPort(config.port, "0.0.0.0"))) {
    error(`Port ${config.port} is already in use. Update ${config.path} and try again.`);
    return 1;
  }

  const getLanAddresses = options.getLanAddresses ?? (() => detectLanAddresses());
  const getTailscaleAddress = options.getTailscaleAddress ?? (() => detectTailscaleAddress());
  const [lanAddresses, tailscaleAddress] = await Promise.all([
    Promise.resolve(getLanAddresses()),
    Promise.resolve(getTailscaleAddress()),
  ]);
  const discoveredCandidates = buildAccessCandidates({
    port: config.port,
    token: config.token,
    lanAddresses,
    tailscaleAddress,
  });
  const renderQr =
    options.renderQr ?? ((url) => QRCode.toString(url, { type: "terminal", small: true }));
  const childEnvironment = {
    ...(options.env ?? process.env),
    BRIDGE_TOKEN: config.token,
    PORT: String(config.port),
    CODEX_APP_SERVER_URL: APP_SERVER_URL,
    CODEX_REMOTE_ACCESS_CANDIDATES: JSON.stringify([]),
  };
  const spawnProcess = options.spawnProcess ?? spawn;
  const spawnOptions = { cwd: projectRoot, env: childEnvironment, stdio: "inherit" };
  const children = [];

  try {
    children.push({
      name: "app-server",
      process: spawnProcess("codex", ["app-server", "--listen", APP_SERVER_URL], spawnOptions),
    });
    children.push({
      name: "bridge",
      process: spawnProcess(process.execPath, [serverEntrypoint], spawnOptions),
    });
  } catch (spawnError) {
    for (const child of children) child.process.kill("SIGTERM");
    error(`Unable to start remote services: ${spawnError.message}`);
    return 1;
  }

  const addSignalHandler = options.registerSignal ?? registerSignal;
  const readinessAbort = new AbortController();
  const setShutdownTimer = options.setShutdownTimer ?? setTimeout;
  const clearShutdownTimer = options.clearShutdownTimer ?? clearTimeout;
  const shutdownGraceMs = options.shutdownGraceMs ?? 3_000;
  const forceExitMs = options.forceExitMs ?? 1_000;
  let shutdownStarted = false;
  let escalationStarted = false;
  let exitCode = 0;
  let settled = false;
  let graceTimer;
  let forceTimer;
  let resolveCompletion;
  const finished = new Set();
  const removeSignalHandlers = [];
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });

  const finish = (forced = false) => {
    if (settled || (!forced && finished.size !== children.length)) return;
    settled = true;
    if (graceTimer) clearShutdownTimer(graceTimer);
    if (forceTimer) clearShutdownTimer(forceTimer);
    for (const remove of removeSignalHandlers) remove();
    if (forced) {
      exitCode = 1;
      error("Child processes did not exit after SIGKILL; forcing launcher exit.");
      for (const child of children) {
        if (!finished.has(child.process)) child.process.unref?.();
      }
    }
    resolveCompletion(exitCode);
  };

  const stopChildren = (signal) => {
    for (const child of children) {
      if (!finished.has(child.process)) child.process.kill(signal);
    }
  };

  const escalateShutdown = () => {
    if (settled || escalationStarted) return;
    escalationStarted = true;
    if (graceTimer) clearShutdownTimer(graceTimer);
    stopChildren("SIGKILL");
    if (!settled) {
      forceTimer = setShutdownTimer(() => finish(true), forceExitMs);
    }
  };

  const beginShutdown = ({ code, message, signal }) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    exitCode = code;
    readinessAbort.abort(new Error("Remote launcher is shutting down."));
    if (message) error(message);
    stopChildren(signal);
    if (!settled) {
      graceTimer = setShutdownTimer(escalateShutdown, shutdownGraceMs);
    }
  };

  for (const child of children) {
    let childFinished = false;
    const recordExit = (code, signal) => {
      if (childFinished) return;
      childFinished = true;
      finished.add(child.process);
      if (!shutdownStarted) {
        beginShutdown({ code: 1, message: formatChildFailure(child.name, code, signal), signal: "SIGTERM" });
      }
      finish();
    };
    child.process.once("exit", recordExit);
    child.process.once("close", recordExit);
    child.process.once("error", (failure) => {
      if (childFinished) return;
      childFinished = true;
      finished.add(child.process);
      beginShutdown({
        code: 1,
        message: `${child.name} failed to start: ${failure.message}`,
        signal: "SIGTERM",
      });
      finish();
    });
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    removeSignalHandlers.push(
      addSignalHandler(signal, () => {
        if (shutdownStarted) escalateShutdown();
        else beginShutdown({ code: 0, signal });
      }),
    );
  }

  const readinessTimeoutMs = options.readinessTimeoutMs ?? 10_000;
  const waitForAppServer = options.waitForAppServer ?? waitForAppServerReady;
  const waitForBridge = options.waitForBridge ?? waitForBridgeReady;
  let readinessResult;
  try {
    readinessResult = await Promise.race([
      Promise.all([
        waitForAppServer({
          url: APP_SERVER_URL,
          timeoutMs: readinessTimeoutMs,
          signal: readinessAbort.signal,
        }),
        waitForBridge({
          port: config.port,
          token: config.token,
          timeoutMs: readinessTimeoutMs,
          signal: readinessAbort.signal,
        }),
      ]).then(() => ({ ready: true })),
      completion.then((code) => ({ code, ready: false })),
    ]);
  } catch (readinessError) {
    if (!shutdownStarted) {
      beginShutdown({
        code: 1,
        message: `Remote services did not become ready: ${readinessError.message}`,
        signal: "SIGTERM",
      });
    }
    return completion;
  }

  if (!readinessResult.ready) return readinessResult.code;

  const verifyCandidate = options.verifyAccessCandidate ?? verifyAccessCandidate;
  const publishCandidates = options.publishAccessCandidates ?? publishAccessCandidates;
  const accessVerificationTimeoutMs = options.accessVerificationTimeoutMs ?? 1_000;
  const assertStartupActive = () => {
    if (shutdownStarted || settled || readinessAbort.signal.aborted) {
      throw readinessAbort.signal.reason ?? new Error("Remote launcher is shutting down.");
    }
  };
  const prepareAccessPanel = async () => {
    assertStartupActive();
    const verificationResults = await Promise.all(
      discoveredCandidates.map((candidate) =>
        Promise.resolve(
          verifyCandidate(candidate, {
            token: config.token,
            requestTimeoutMs: accessVerificationTimeoutMs,
            signal: readinessAbort.signal,
          }),
        ).catch(() => false),
      ),
    );
    assertStartupActive();
    const accessCandidates = discoveredCandidates.filter(
      (_candidate, index) => verificationResults[index],
    );
    if (!accessCandidates.some((candidate) => candidate.kind === "local")) {
      throw new Error("Local access verification failed.");
    }
    await publishCandidates({
      port: config.port,
      token: config.token,
      accessCandidates,
      requestTimeoutMs: accessVerificationTimeoutMs,
      signal: readinessAbort.signal,
    });
    assertStartupActive();
    const preferredUrl = choosePreferredAccessUrl(accessCandidates);
    const renderedQr = preferredUrl ? await renderQr(preferredUrl) : undefined;
    assertStartupActive();
    return { accessCandidates, renderedQr };
  };

  let preparationResult;
  try {
    preparationResult = await Promise.race([
      prepareAccessPanel().then((panel) => ({ panel, prepared: true })),
      completion.then((code) => ({ code, prepared: false })),
    ]);
  } catch (accessError) {
    if (!shutdownStarted) {
      beginShutdown({
        code: 1,
        message: `Unable to prepare verified access URLs: ${accessError.message}`,
        signal: "SIGTERM",
      });
    }
    return completion;
  }

  if (!preparationResult.prepared) return preparationResult.code;
  if (shutdownStarted || settled || readinessAbort.signal.aborted) return completion;
  const { accessCandidates, renderedQr } = preparationResult.panel;

  log("Codex Remote access");
  for (const candidate of accessCandidates) {
    log(`${candidate.label}: ${candidate.url}`);
  }
  if (renderedQr) log(renderedQr);
  return completion;
}
