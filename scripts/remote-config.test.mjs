import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildAccessCandidates,
  choosePreferredAccessUrl,
  loadOrCreateRemoteConfig,
} from "./remote-config.mjs";

test("creates a private config with a 256-bit token and stable port", async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "codex-remote-config-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));

  let randomCalls = 0;
  const randomBytes = (size) => {
    randomCalls += 1;
    assert.equal(size, 32);
    return Buffer.alloc(size, 0xab);
  };

  const first = await loadOrCreateRemoteConfig({ homeDir, randomBytes });
  const second = await loadOrCreateRemoteConfig({ homeDir, randomBytes });

  assert.equal(first.path, path.join(homeDir, ".codex-remote-pwa", "config.json"));
  assert.equal(first.token, "ab".repeat(32));
  assert.equal(first.port, 8790);
  assert.deepEqual(second, first);
  assert.equal(randomCalls, 1);
  assert.equal((await stat(first.path)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(first.path, "utf8")), {
    token: first.token,
    port: 8790,
  });
  assert.deepEqual(await readdir(path.dirname(first.path)), ["config.json"]);
});

test("reuses a valid injected config path", async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "codex-remote-config-path-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const configPath = path.join(homeDir, "custom", "remote.json");

  const created = await loadOrCreateRemoteConfig({
    configPath,
    randomBytes: () => Buffer.alloc(32, 0xcd),
    defaultPort: 9900,
  });
  const reused = await loadOrCreateRemoteConfig({
    configPath,
    randomBytes: () => {
      throw new Error("must not regenerate an existing token");
    },
  });

  assert.deepEqual(created, { path: configPath, token: "cd".repeat(32), port: 9900 });
  assert.deepEqual(reused, created);
});

test("concurrent creators publish one config and remove every temporary file", async (t) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "codex-remote-config-race-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  let tokenSeed = 0;

  const results = await Promise.all(
    Array.from({ length: 16 }, () =>
      loadOrCreateRemoteConfig({
        homeDir,
        randomBytes: (size) => Buffer.alloc(size, ++tokenSeed),
      }),
    ),
  );

  assert.equal(new Set(results.map((result) => result.token)).size, 1);
  const configDir = path.join(homeDir, ".codex-remote-pwa");
  assert.deepEqual(await readdir(configDir), ["config.json"]);
  assert.deepEqual(JSON.parse(await readFile(results[0].path, "utf8")), {
    token: results[0].token,
    port: 8790,
  });
  assert.equal((await stat(results[0].path)).mode & 0o777, 0o600);
});

test("builds deduplicated access candidates with encoded credentials", () => {
  const candidates = buildAccessCandidates({
    port: 8790,
    token: "secret with spaces",
    lanAddresses: ["192.168.1.20", "192.168.1.20", "10.0.0.8"],
    tailscaleAddress: "100.64.0.7",
  });

  assert.deepEqual(candidates, [
    {
      kind: "local",
      label: "This Mac",
      url: "http://127.0.0.1:8790/?token=secret+with+spaces",
    },
    {
      kind: "lan",
      label: "Local network",
      url: "http://192.168.1.20:8790/?token=secret+with+spaces",
    },
    {
      kind: "lan",
      label: "Local network",
      url: "http://10.0.0.8:8790/?token=secret+with+spaces",
    },
    {
      kind: "tailscale",
      label: "Tailscale",
      url: "http://100.64.0.7:8790/?token=secret+with+spaces",
    },
  ]);
});

test("prefers Tailscale, then LAN, then loopback", () => {
  const local = { kind: "local", label: "This Mac", url: "http://127.0.0.1:8790" };
  const lan = { kind: "lan", label: "Local network", url: "http://192.168.1.20:8790" };
  const tailscale = { kind: "tailscale", label: "Tailscale", url: "http://100.64.0.7:8790" };

  assert.equal(choosePreferredAccessUrl([local, lan, tailscale]), tailscale.url);
  assert.equal(choosePreferredAccessUrl([local, lan]), lan.url);
  assert.equal(choosePreferredAccessUrl([local]), local.url);
  assert.equal(choosePreferredAccessUrl([]), undefined);
});

test("keeps a duplicated Tailscale interface classified as Tailscale", () => {
  const candidates = buildAccessCandidates({
    port: 8790,
    token: "a".repeat(64),
    lanAddresses: ["192.168.1.20", "100.64.0.7"],
    tailscaleAddress: "100.64.0.7",
  });

  assert.deepEqual(
    candidates.map(({ kind, url }) => ({ kind, url: new URL(url).hostname })),
    [
      { kind: "local", url: "127.0.0.1" },
      { kind: "lan", url: "192.168.1.20" },
      { kind: "tailscale", url: "100.64.0.7" },
    ],
  );
});

test("reserves bounded candidates for local and preferred Tailscale access", () => {
  const tailscaleUrl = `http://100.64.0.7:8790/?token=${"a".repeat(64)}`;
  const candidates = buildAccessCandidates({
    port: 8790,
    token: "a".repeat(64),
    lanAddresses: Array.from({ length: 12 }, (_, index) => `192.168.1.${index + 1}`),
    tailscaleAddress: "100.64.0.7",
  });

  assert.equal(candidates.length, 8);
  assert.equal(candidates[0].kind, "local");
  assert.ok(candidates.some((candidate) => candidate.kind === "tailscale"));
  assert.equal(choosePreferredAccessUrl(candidates), tailscaleUrl);
});
