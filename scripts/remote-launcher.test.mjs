import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";

import {
  detectLanAddresses,
  detectTailscaleAddress,
  publishAccessCandidates,
  runRemoteLauncher,
  verifyAccessCandidate,
  waitForAppServerReady,
  waitForBridgeReady,
} from "./remote-launcher.mjs";

const projectRoot = "/workspace/codex-remote-pwa";
const serverEntrypoint = path.join(projectRoot, "packages/server/dist/index.js");
const config = { path: "/home/test/.codex-remote-pwa/config.json", token: "a".repeat(64), port: 8790 };

function createChild(name) {
  const child = new EventEmitter();
  child.name = name;
  child.kills = [];
  child.unrefs = 0;
  child.kill = (signal) => {
    child.kills.push(signal);
  };
  child.unref = () => {
    child.unrefs += 1;
  };
  return child;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createHarness(overrides = {}) {
  const calls = { errors: [], logs: [], spawns: [], handlers: new Map(), removedSignals: [] };
  const children = [];
  const options = {
    projectRoot,
    loadConfig: async () => config,
    pathExists: async (candidate) => candidate === serverEntrypoint,
    probePort: async () => true,
    getLanAddresses: () => ["192.168.1.20"],
    getTailscaleAddress: async () => "100.64.0.7",
    renderQr: async (url) => `QR:${url}`,
    waitForAppServer: async () => {},
    waitForBridge: async () => {},
    verifyAccessCandidate: async () => true,
    publishAccessCandidates: async () => {},
    spawnProcess(command, args, spawnOptions) {
      const child = createChild(command);
      calls.spawns.push({ command, args, options: spawnOptions, child });
      children.push(child);
      return child;
    },
    log(message) {
      calls.logs.push(message);
    },
    error(message) {
      calls.errors.push(message);
    },
    registerSignal(signal, handler) {
      calls.handlers.set(signal, handler);
      return () => calls.removedSignals.push(signal);
    },
    ...overrides,
  };

  return { calls, children, options };
}

test("detects only unique external IPv4 LAN interfaces", () => {
  const addresses = detectLanAddresses({
    lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    en0: [
      { address: "192.168.1.20", family: "IPv4", internal: false },
      { address: "fe80::1", family: "IPv6", internal: false },
    ],
    en1: [{ address: "192.168.1.20", family: 4, internal: false }],
  });

  assert.deepEqual(addresses, ["192.168.1.20"]);
});

test("detects a connected Tailscale IPv4 address without requiring the binary", async () => {
  assert.equal(
    await detectTailscaleAddress(async (command, args) => {
      assert.equal(command, "tailscale");
      assert.deepEqual(args, ["ip", "-4"]);
      return { stdout: "100.64.0.7\n" };
    }),
    "100.64.0.7",
  );
  assert.equal(
    await detectTailscaleAddress(async () => {
      const error = new Error("not found");
      error.code = "ENOENT";
      throw error;
    }),
    undefined,
  );
});

test("bounds a stalled Tailscale lookup and falls back without an address", async () => {
  let commandOptions;
  const address = await detectTailscaleAddress(async (_command, _args, options) => {
    commandOptions = options;
    const error = new Error("command timed out");
    error.code = "ETIMEDOUT";
    throw error;
  });

  assert.equal(address, undefined);
  assert.equal(commandOptions.timeout, 1_000);
});

test("waits for the app-server TCP listener", async () => {
  const attempts = [];
  await waitForAppServerReady({
    url: "ws://127.0.0.1:8766",
    intervalMs: 0,
    sleep: async () => {},
    checkTcp: async (host, port) => {
      attempts.push([host, port]);
      return attempts.length === 2;
    },
  });

  assert.deepEqual(attempts, [
    ["127.0.0.1", 8766],
    ["127.0.0.1", 8766],
  ]);
});

test("waits for authenticated bridge health", async () => {
  const requests = [];
  await waitForBridgeReady({
    port: 8790,
    token: "bridge-secret",
    intervalMs: 0,
    sleep: async () => {},
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: requests.length === 2,
        json: async () => ({
          ok: true,
          runtimeMode: "app-server",
          canSendMessages: true,
          accessCandidates: [],
        }),
      };
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "http://127.0.0.1:8790/api/health");
  assert.equal(requests[0].options.headers.Authorization, "Bearer bridge-secret");
});

test("verifies authenticated bridge health semantics at a candidate origin", async () => {
  const requests = [];
  const candidate = {
    kind: "lan",
    label: "Local network",
    url: "http://192.168.1.20:8790/?token=visible-token",
  };
  const verified = await verifyAccessCandidate(candidate, {
    token: "bridge-secret",
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          ok: true,
          runtimeMode: "app-server",
          canSendMessages: true,
          accessCandidates: [],
        }),
      };
    },
  });

  assert.equal(verified, true);
  assert.equal(requests[0].url, "http://192.168.1.20:8790/api/health");
  assert.equal(requests[0].options.headers.Authorization, "Bearer bridge-secret");
  assert.equal(
    await verifyAccessCandidate(candidate, {
      token: "bridge-secret",
      fetchFn: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    }),
    false,
  );
});

test("bounds candidate health verification timeout", async () => {
  const startedAt = Date.now();
  const verified = await verifyAccessCandidate(
    { kind: "local", label: "This Mac", url: "http://127.0.0.1:8790/?token=a" },
    {
      token: "bridge-secret",
      requestTimeoutMs: 5,
      fetchFn: async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    },
  );

  assert.equal(verified, false);
  assert.ok(Date.now() - startedAt < 500);
});

test("publishes candidates through loopback and confirms health metadata", async () => {
  const candidates = [
    { kind: "local", label: "This Mac", url: "http://127.0.0.1:8790/?token=a" },
  ];
  const requests = [];
  await publishAccessCandidates({
    port: 8790,
    token: "bridge-secret",
    accessCandidates: candidates,
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          ...(options.method === "POST"
            ? {}
            : { ok: true, runtimeMode: "app-server", canSendMessages: true }),
          accessCandidates: candidates,
        }),
      };
    },
  });

  assert.equal(requests[0].url, "http://127.0.0.1:8790/api/access-candidates");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.Authorization, "Bearer bridge-secret");
  assert.deepEqual(JSON.parse(requests[0].options.body), { accessCandidates: candidates });
  assert.equal(requests[1].url, "http://127.0.0.1:8790/api/health");
});

test("reports the build command and exits before spawning when server output is missing", async () => {
  const harness = createHarness({ pathExists: async () => false });

  const result = await runRemoteLauncher(harness.options);

  assert.equal(result, 1);
  assert.equal(harness.calls.spawns.length, 0);
  assert.match(harness.calls.errors.join("\n"), /npm run build/);
});

test("fails before spawning when the configured bridge port is occupied", async () => {
  let probeArguments;
  const harness = createHarness({
    probePort: async (...args) => {
      probeArguments = args;
      return false;
    },
  });

  const result = await runRemoteLauncher(harness.options);

  assert.equal(result, 1);
  assert.deepEqual(probeArguments, [8790, "0.0.0.0"]);
  assert.equal(harness.calls.spawns.length, 0);
  assert.match(harness.calls.errors.join("\n"), /8790/);
});

test("stops started children when terminal QR rendering fails", async () => {
  const harness = createHarness({
    renderQr: async () => {
      throw new Error("terminal output unavailable");
    },
  });

  const running = runRemoteLauncher(harness.options);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.spawns.length, 2);
  assert.deepEqual(harness.children[0].kills, ["SIGTERM"]);
  assert.deepEqual(harness.children[1].kills, ["SIGTERM"]);
  harness.children[0].emit("exit", null, "SIGTERM");
  harness.children[1].emit("exit", null, "SIGTERM");
  assert.equal(await running, 1);
  assert.doesNotMatch(harness.calls.logs.join("\n"), /Codex Remote access|QR:/);
});

test("does not print after SIGINT completes while QR rendering is pending", async () => {
  const qr = deferred();
  const harness = createHarness({ renderQr: () => qr.promise });
  const running = runRemoteLauncher(harness.options);
  let result;
  const completed = running.then((value) => {
    result = value;
  });
  await new Promise((resolve) => setImmediate(resolve));

  harness.calls.handlers.get("SIGINT")();
  harness.children[0].emit("exit", null, "SIGINT");
  harness.children[1].emit("exit", null, "SIGINT");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result, 0);
  qr.resolve("QR:late");
  await completed;
  await new Promise((resolve) => setImmediate(resolve));

  assert.doesNotMatch(harness.calls.logs.join("\n"), /Codex Remote access|QR:/);
});

test("does not print after a child fails while QR rendering is pending", async () => {
  const qr = deferred();
  const harness = createHarness({ renderQr: () => qr.promise });
  const running = runRemoteLauncher(harness.options);
  let result;
  const completed = running.then((value) => {
    result = value;
  });
  await new Promise((resolve) => setImmediate(resolve));

  harness.children[0].emit("exit", 7, null);
  harness.children[1].emit("exit", null, "SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result, 1);
  qr.reject(new Error("late QR failure"));
  await completed;
  await new Promise((resolve) => setImmediate(resolve));

  assert.doesNotMatch(harness.calls.logs.join("\n"), /Codex Remote access|QR:/);
});

test("starts app-server and bridge with stable connection environment", async () => {
  const harness = createHarness();
  const running = runRemoteLauncher(harness.options);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.calls.spawns.length, 2);
  const [appServer, bridge] = harness.calls.spawns;
  assert.deepEqual(appServer.args, ["app-server", "--listen", "ws://127.0.0.1:8766"]);
  assert.equal(bridge.command, process.execPath);
  assert.deepEqual(bridge.args, [serverEntrypoint]);

  for (const child of [appServer, bridge]) {
    assert.equal(child.options.env.BRIDGE_TOKEN, config.token);
    assert.equal(child.options.env.PORT, "8790");
    assert.equal(child.options.env.CODEX_APP_SERVER_URL, "ws://127.0.0.1:8766");
    assert.deepEqual(JSON.parse(child.options.env.CODEX_REMOTE_ACCESS_CANDIDATES), []);
  }

  assert.match(harness.calls.logs.join("\n"), /Tailscale/);
  assert.match(harness.calls.logs.join("\n"), /QR:http:\/\/100\.64\.0\.7:8790/);

  harness.calls.handlers.get("SIGINT")();
  harness.children[0].emit("exit", null, "SIGINT");
  harness.children[1].emit("exit", null, "SIGINT");
  assert.equal(await running, 0);
});

test("drops a hijacked LAN candidate from metadata and the access panel", async () => {
  const verified = [];
  let published;
  const harness = createHarness({
    verifyAccessCandidate: async (candidate, options) => {
      verified.push({ candidate, options });
      return candidate.kind !== "lan";
    },
    publishAccessCandidates: async (options) => {
      published = options.accessCandidates;
    },
  });
  const running = runRemoteLauncher(harness.options);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(verified.length, 3);
  assert.deepEqual(
    published.map((candidate) => candidate.kind),
    ["local", "tailscale"],
  );
  assert.doesNotMatch(harness.calls.logs.join("\n"), /192\.168\.1\.20/);
  assert.match(harness.calls.logs.join("\n"), /100\.64\.0\.7/);
  harness.calls.handlers.get("SIGINT")();
  harness.children[0].emit("exit", null, "SIGINT");
  harness.children[1].emit("exit", null, "SIGINT");
  assert.equal(await running, 0);
});

test("fails startup when the required local candidate cannot reach bridge health", async () => {
  let publishCalls = 0;
  const harness = createHarness({
    verifyAccessCandidate: async (candidate) => candidate.kind !== "local",
    publishAccessCandidates: async () => {
      publishCalls += 1;
    },
  });
  const running = runRemoteLauncher(harness.options);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(publishCalls, 0);
  assert.deepEqual(harness.children[0].kills, ["SIGTERM"]);
  assert.doesNotMatch(harness.calls.logs.join("\n"), /Codex Remote access|QR:/);
  harness.children[0].emit("exit", null, "SIGTERM");
  harness.children[1].emit("exit", null, "SIGTERM");
  assert.equal(await running, 1);
  assert.match(harness.calls.errors.join("\n"), /local access verification failed/i);
});

test("prints access details only after app-server and bridge are both ready", async () => {
  const appServerReady = deferred();
  const bridgeReady = deferred();
  const harness = createHarness({
    waitForAppServer: () => appServerReady.promise,
    waitForBridge: () => bridgeReady.promise,
  });
  const running = runRemoteLauncher(harness.options);
  await new Promise((resolve) => setImmediate(resolve));

  assert.doesNotMatch(harness.calls.logs.join("\n"), /Codex Remote access|QR:/);
  appServerReady.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotMatch(harness.calls.logs.join("\n"), /Codex Remote access|QR:/);
  bridgeReady.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(harness.calls.logs.join("\n"), /Codex Remote access/);
  assert.match(harness.calls.logs.join("\n"), /QR:/);

  harness.calls.handlers.get("SIGINT")();
  harness.children[0].emit("exit", null, "SIGINT");
  harness.children[1].emit("exit", null, "SIGINT");
  assert.equal(await running, 0);
});

test("readiness failure stops both children without printing access details", async () => {
  const harness = createHarness({
    waitForAppServer: async () => {
      throw new Error("app-server readiness timed out");
    },
  });
  const running = runRemoteLauncher(harness.options);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(harness.children[0].kills, ["SIGTERM"]);
  assert.deepEqual(harness.children[1].kills, ["SIGTERM"]);
  assert.doesNotMatch(harness.calls.logs.join("\n"), /Codex Remote access|QR:/);
  harness.children[0].emit("exit", null, "SIGTERM");
  harness.children[1].emit("exit", null, "SIGTERM");
  assert.equal(await running, 1);
  assert.match(harness.calls.errors.join("\n"), /app-server readiness timed out/i);
});

test("a first signal during readiness does not trigger immediate escalation", async () => {
  const waitUntilAborted = ({ signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  const harness = createHarness({
    waitForAppServer: waitUntilAborted,
    waitForBridge: waitUntilAborted,
  });
  const running = runRemoteLauncher(harness.options);
  await new Promise((resolve) => setImmediate(resolve));

  harness.calls.handlers.get("SIGINT")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.children[0].kills, ["SIGINT"]);
  assert.deepEqual(harness.children[1].kills, ["SIGINT"]);
  harness.children[0].emit("exit", null, "SIGINT");
  harness.children[1].emit("exit", null, "SIGINT");
  assert.equal(await running, 0);
});

test("a child error during graceful shutdown does not impersonate a second signal", async () => {
  const harness = createHarness();
  const running = runRemoteLauncher(harness.options);
  await new Promise((resolve) => setImmediate(resolve));

  harness.calls.handlers.get("SIGINT")();
  harness.children[0].emit("error", new Error("closed during shutdown"));
  assert.deepEqual(harness.children[1].kills, ["SIGINT"]);
  harness.children[1].emit("exit", null, "SIGINT");
  assert.equal(await running, 0);
});

test("a repeated shutdown signal escalates both children immediately", async () => {
  const harness = createHarness();
  const running = runRemoteLauncher(harness.options);
  await new Promise((resolve) => setImmediate(resolve));

  harness.calls.handlers.get("SIGINT")();
  harness.calls.handlers.get("SIGINT")();

  assert.deepEqual(harness.children[0].kills, ["SIGINT", "SIGKILL"]);
  assert.deepEqual(harness.children[1].kills, ["SIGINT", "SIGKILL"]);
  harness.children[0].emit("exit", null, "SIGKILL");
  harness.children[1].emit("exit", null, "SIGKILL");
  assert.equal(await running, 0);
  assert.deepEqual(harness.calls.removedSignals.sort(), ["SIGINT", "SIGTERM"]);
});

test("forces launcher completion when children emit no exit after SIGKILL", async () => {
  const timers = [];
  const harness = createHarness({
    setShutdownTimer(callback, milliseconds) {
      const timer = { active: true, callback, milliseconds };
      timers.push(timer);
      return timer;
    },
    clearShutdownTimer(timer) {
      timer.active = false;
    },
    shutdownGraceMs: 25,
    forceExitMs: 10,
  });
  const running = runRemoteLauncher(harness.options);
  await new Promise((resolve) => setImmediate(resolve));

  harness.calls.handlers.get("SIGTERM")();
  assert.deepEqual(harness.children[0].kills, ["SIGTERM"]);
  assert.equal(timers[0].milliseconds, 25);
  timers[0].callback();
  assert.deepEqual(harness.children[0].kills, ["SIGTERM", "SIGKILL"]);
  assert.equal(timers[1].milliseconds, 10);
  timers[1].callback();

  assert.equal(await running, 1);
  assert.equal(harness.children[0].unrefs, 1);
  assert.equal(harness.children[1].unrefs, 1);
  assert.match(harness.calls.errors.join("\n"), /did not exit after SIGKILL/i);
  assert.deepEqual(harness.calls.removedSignals.sort(), ["SIGINT", "SIGTERM"]);
});

test("a required child failure terminates its sibling and returns non-zero", async () => {
  const harness = createHarness();
  const running = runRemoteLauncher(harness.options);
  await new Promise((resolve) => setImmediate(resolve));

  harness.children[0].emit("exit", 7, null);
  assert.deepEqual(harness.children[1].kills, ["SIGTERM"]);
  harness.children[1].emit("exit", null, "SIGTERM");

  assert.equal(await running, 1);
  assert.match(harness.calls.errors.join("\n"), /app-server.*7/i);
});
