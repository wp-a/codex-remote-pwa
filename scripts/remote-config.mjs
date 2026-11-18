import { randomBytes as nodeRandomBytes, randomUUID as nodeRandomUUID } from "node:crypto";
import { chmod, link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_PORT = 8790;
const MAX_ACCESS_CANDIDATES = 8;

function isValidConfig(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.token === "string" &&
    /^[a-f0-9]{64}$/.test(value.token) &&
    Number.isInteger(value.port) &&
    value.port > 0 &&
    value.port <= 65535
  );
}

export async function loadOrCreateRemoteConfig(options = {}) {
  const homeDir = options.homeDir ?? os.homedir();
  const configPath = options.configPath ?? path.join(homeDir, ".codex-remote-pwa", "config.json");

  try {
    const existing = JSON.parse(await readFile(configPath, "utf8"));
    if (!isValidConfig(existing)) {
      throw new Error("config must contain a 64-character hexadecimal token and a valid port");
    }
    await chmod(configPath, 0o600);
    return { path: configPath, token: existing.token, port: existing.port };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(`Unable to load remote config at ${configPath}: ${error.message}`, {
        cause: error,
      });
    }
  }

  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  const port = options.defaultPort ?? DEFAULT_PORT;
  const config = { token: randomBytes(32).toString("hex"), port };
  if (!isValidConfig(config)) {
    throw new Error("Generated remote config is invalid");
  }

  const configDir = path.dirname(configPath);
  const temporaryPath = path.join(
    configDir,
    `.${path.basename(configPath)}.${process.pid}.${(options.randomUUID ?? nodeRandomUUID)()}.tmp`,
  );
  await mkdir(configDir, { recursive: true, mode: 0o700 });

  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    try {
      await link(temporaryPath, configPath);
      await chmod(configPath, 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const published = JSON.parse(await readFile(configPath, "utf8"));
      if (!isValidConfig(published)) {
        throw new Error("published config is invalid", { cause: error });
      }
      await chmod(configPath, 0o600);
      return { path: configPath, token: published.token, port: published.port };
    }
  } catch (error) {
    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }

  return { path: configPath, ...config };
}

function createCandidate(kind, label, address, port, token) {
  const url = new URL(`http://${address}:${port}/`);
  url.searchParams.set("token", token);
  return { kind, label, url: url.toString() };
}

export function buildAccessCandidates({ port, token, lanAddresses = [], tailscaleAddress }) {
  const candidates = [createCandidate("local", "This Mac", "127.0.0.1", port, token)];
  const uniqueLanAddresses = new Set(lanAddresses);
  uniqueLanAddresses.delete("127.0.0.1");
  if (tailscaleAddress) {
    uniqueLanAddresses.delete(tailscaleAddress);
  }

  const reservedSlots = tailscaleAddress ? 1 : 0;
  const lanLimit = MAX_ACCESS_CANDIDATES - candidates.length - reservedSlots;
  for (const address of [...uniqueLanAddresses].slice(0, lanLimit)) {
    candidates.push(createCandidate("lan", "Local network", address, port, token));
  }
  if (tailscaleAddress) {
    candidates.push(createCandidate("tailscale", "Tailscale", tailscaleAddress, port, token));
  }

  const seenUrls = new Set();
  return candidates.filter((candidate) => {
    if (seenUrls.has(candidate.url)) return false;
    seenUrls.add(candidate.url);
    return true;
  });
}

export function choosePreferredAccessUrl(candidates) {
  for (const kind of ["tailscale", "lan", "local"]) {
    const candidate = candidates.find((item) => item.kind === kind);
    if (candidate) return candidate.url;
  }
  return undefined;
}
