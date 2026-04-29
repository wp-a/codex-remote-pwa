import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import type { CodexSessionSummary } from "@codex-remote/shared";

import { SqliteStore } from "./db.js";
import { EventBus } from "./event-bus.js";
import { createBridgeHttp } from "./http.js";
import { SessionService } from "./session-service.js";

describe("createBridgeHttp", () => {
  let store: SqliteStore | null = null;
  let server: http.Server | null = null;
  let staticDir: string | null = null;

  afterEach(async () => {
    store?.close();
    store = null;

    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      server = null;
    }

    if (staticDir) {
      rmSync(staticDir, { force: true, recursive: true });
      staticDir = null;
    }
  });

  it("creates sessions, posts messages, and streams events over websocket", async () => {
    store = new SqliteStore(":memory:");
    const eventBus = new EventBus();
    const service = new SessionService(store, eventBus);

    const fakeRuntime = {
      startTurn: (_input, callbacks) => {
        callbacks.onSignal({ type: "thread_started", threadId: "thread_remote_1" });
        callbacks.onSignal({ type: "assistant_message", text: "READY" });
        callbacks.onSignal({
          type: "turn_completed",
          usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
        });
        callbacks.onExit?.(0);

        return {
          wait: Promise.resolve(0),
          interrupt: () => undefined,
        };
      },
      interrupt: () => true,
    };

    const bridge = createBridgeHttp({
      authToken: "secret",
      eventBus,
      runtime: fakeRuntime,
      service,
    });

    server = http.createServer(bridge.app);
    bridge.attachWebSocket(server);

    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an IPv4 test address.");
    }

    const api = request(server);
    const createResponse = await api
      .post("/api/sessions")
      .set("Authorization", "Bearer secret")
      .send({
        title: "Remote Demo",
        projectPath: "/workspace/codex-remote-pwa/tmp-runtime",
      })
      .expect(201);

    const sessionId: string = createResponse.body.session.id;
    const receivedTypes: string[] = [];

    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/api/sessions/${sessionId}/stream?token=secret`,
    );

    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", (error) => reject(error));
    });

    socket.on("message", (payload) => {
      const parsed = JSON.parse(String(payload)) as { type: string };
      receivedTypes.push(parsed.type);
    });

    await api
      .post(`/api/sessions/${sessionId}/messages`)
      .set("Authorization", "Bearer secret")
      .send({ text: "Reply READY" })
      .expect(202);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const snapshotResponse = await api
      .get(`/api/sessions/${sessionId}/snapshot`)
      .set("Authorization", "Bearer secret")
      .expect(200);

    expect(snapshotResponse.body.session.runtimeThreadId).toBe("thread_remote_1");
    expect(snapshotResponse.body.session.status).toBe("idle");
    expect(snapshotResponse.body.events.map((event: { type: string }) => event.type)).toEqual([
      "user_message",
      "assistant_message",
    ]);
    expect(receivedTypes).toEqual(["user_message", "assistant_message"]);

    socket.close();
  });

  it("serves the built web app from the same server without api auth", async () => {
    store = new SqliteStore(":memory:");
    const eventBus = new EventBus();
    const service = new SessionService(store, eventBus);

    staticDir = mkdtempSync(join(tmpdir(), "codex-remote-web-"));
    writeFileSync(
      join(staticDir, "index.html"),
      "<!doctype html><html><body><div>Codex Remote Web</div></body></html>",
    );

    const bridge = createBridgeHttp({
      authToken: "secret",
      eventBus,
      runtime: {
        startTurn: () => ({
          wait: Promise.resolve(0),
          interrupt: () => undefined,
        }),
        interrupt: () => false,
      },
      service,
      staticDir,
    });

    server = http.createServer(bridge.app);
    bridge.attachWebSocket(server);

    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });

    const response = await request(server).get("/").expect(200).expect(/Codex Remote Web/);
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("serves authenticated local image files for screenshot previews", async () => {
    store = new SqliteStore(":memory:");
    const eventBus = new EventBus();
    const service = new SessionService(store, eventBus);
    staticDir = mkdtempSync(join(tmpdir(), "codex-remote-image-"));
    const imagePath = join(staticDir, "screen shot.png");
    writeFileSync(
      imagePath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64",
      ),
    );

    const bridge = createBridgeHttp({
      authToken: "secret",
      eventBus,
      runtime: {
        startTurn: () => ({
          wait: Promise.resolve(0),
          interrupt: () => undefined,
        }),
        interrupt: () => false,
      },
      service,
    });

    server = http.createServer(bridge.app);
    bridge.attachWebSocket(server);

    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });

    await request(server)
      .get("/api/local-image")
      .query({ path: imagePath })
      .expect(401);

    const response = await request(server)
      .get("/api/local-image")
      .query({ path: imagePath, token: "secret" })
      .expect(200);

    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.body).toBeInstanceOf(Buffer);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it("serves legacy absolute image URLs when the current page referrer has the token", async () => {
    store = new SqliteStore(":memory:");
    const eventBus = new EventBus();
    const service = new SessionService(store, eventBus);
    staticDir = mkdtempSync(join(tmpdir(), "codex-remote-legacy-image-"));
    const imagePath = join(staticDir, "screen shot.png");
    writeFileSync(
      imagePath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64",
      ),
    );

    const bridge = createBridgeHttp({
      authToken: "secret",
      eventBus,
      runtime: {
        startTurn: () => ({
          wait: Promise.resolve(0),
          interrupt: () => undefined,
        }),
        interrupt: () => false,
      },
      service,
    });

    server = http.createServer(bridge.app);
    bridge.attachWebSocket(server);

    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });

    const legacyImageUrl = imagePath.replaceAll(" ", "%20");
    await request(server).get(legacyImageUrl).expect(401);

    const response = await request(server)
      .get(legacyImageUrl)
      .set("Referer", "http://127.0.0.1:8787/?token=secret")
      .expect(200);

    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.body).toBeInstanceOf(Buffer);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it("lists native codex sessions and imports one into the bridge", async () => {
    store = new SqliteStore(":memory:");
    const eventBus = new EventBus();
    const service = new SessionService(store, eventBus);

    const codexSessions: CodexSessionSummary[] = [
      {
        threadId: "thread_native_1",
        title: "Existing Codex Session",
        projectPath: "/workspace/native-demo",
        updatedAt: "2026-04-18T09:30:00.000Z",
        importedSessionId: null,
      },
    ];

    const bridge = createBridgeHttp({
      authToken: "secret",
      codexSessions: {
        getByThreadId(threadId) {
          return codexSessions.find((session) => session.threadId === threadId) ?? null;
        },
        getHistoryByThreadId(threadId) {
          if (threadId !== "thread_native_1") {
            return [];
          }

          return [
            {
              role: "user" as const,
              text: "请总结这个项目",
              ts: "2026-04-18T09:30:01.000Z",
            },
            {
              role: "assistant" as const,
              text: "这是项目的历史摘要。",
              ts: "2026-04-18T09:30:02.000Z",
            },
          ];
        },
        listRecent() {
          return codexSessions;
        },
      },
      eventBus,
      runtime: {
        startTurn: () => ({
          wait: Promise.resolve(0),
          interrupt: () => undefined,
        }),
        interrupt: () => false,
      },
      service,
    });

    server = http.createServer(bridge.app);
    bridge.attachWebSocket(server);

    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });

    const api = request(server);

    const nativeResponse = await api
      .get("/api/codex-sessions")
      .set("Authorization", "Bearer secret")
      .expect(200);

    expect(nativeResponse.body.sessions).toEqual(codexSessions);

    const importResponse = await api
      .post("/api/codex-sessions/thread_native_1/import")
      .set("Authorization", "Bearer secret")
      .expect(201);

    expect(importResponse.body.session.runtimeThreadId).toBe("thread_native_1");
    expect(importResponse.body.session.projectPath).toBe(
      "/workspace/native-demo",
    );

    const snapshotResponse = await api
      .get(`/api/sessions/${importResponse.body.session.id}/snapshot`)
      .set("Authorization", "Bearer secret")
      .expect(200);

    expect(
      snapshotResponse.body.events.map((event: { type: string; text?: string }) => ({
        type: event.type,
        text: event.text ?? null,
      })),
    ).toEqual([
      { type: "user_message", text: "请总结这个项目" },
      { type: "assistant_message", text: "这是项目的历史摘要。" },
    ]);

    const importedListResponse = await api
      .get("/api/codex-sessions")
      .set("Authorization", "Bearer secret")
      .expect(200);

    expect(importedListResponse.body.sessions[0]?.importedSessionId).toBe(
      importResponse.body.session.id,
    );
  });

  it("supports local-only mode for browsing history without starting runtime runs", async () => {
    store = new SqliteStore(":memory:");
    const eventBus = new EventBus();
    const service = new SessionService(store, eventBus);

    const bridge = createBridgeHttp({
      authToken: "secret",
      eventBus,
      runtime: null,
      runtimeMode: "local-only",
      service,
    });

    server = http.createServer(bridge.app);
    bridge.attachWebSocket(server);

    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });

    const api = request(server);

    const healthResponse = await api
      .get("/api/health")
      .set("Authorization", "Bearer secret")
      .expect(200);

    expect(healthResponse.body).toMatchObject({
      ok: true,
      runtimeMode: "local-only",
      canSendMessages: false,
    });

    const createResponse = await api
      .post("/api/sessions")
      .set("Authorization", "Bearer secret")
      .send({
        title: "Local Only Demo",
        projectPath: "/workspace/codex-remote-pwa/tmp-runtime",
      })
      .expect(201);

    const sessionId: string = createResponse.body.session.id;

    await api
      .post(`/api/sessions/${sessionId}/messages`)
      .set("Authorization", "Bearer secret")
      .send({ text: "Try to run" })
      .expect(503)
      .expect({
        error: "本地只读模式只能查看本机 Codex 历史，不能发送新任务。",
      });

    const snapshotResponse = await api
      .get(`/api/sessions/${sessionId}/snapshot`)
      .set("Authorization", "Bearer secret")
      .expect(200);

    expect(snapshotResponse.body.session.status).toBe("idle");
    expect(snapshotResponse.body.runs).toEqual([]);
    expect(snapshotResponse.body.events).toEqual([]);
  });

  it("backfills history when an imported bridge session already exists", async () => {
    store = new SqliteStore(":memory:");
    const eventBus = new EventBus();
    const service = new SessionService(store, eventBus);

    const existingSession = service.createImportedSession({
      title: "Existing Codex Session",
      projectPath: "/workspace/native-demo",
      runtimeThreadId: "thread_native_1",
    });

    const bridge = createBridgeHttp({
      authToken: "secret",
      codexSessions: {
        getByThreadId() {
          return {
            threadId: "thread_native_1",
            title: "Existing Codex Session",
            projectPath: "/workspace/native-demo",
            updatedAt: "2026-04-18T09:30:00.000Z",
            importedSessionId: existingSession.id,
          };
        },
        getHistoryByThreadId() {
          return [
            {
              role: "user" as const,
              text: "继续原来的对话",
              ts: "2026-04-18T09:31:00.000Z",
            },
            {
              role: "assistant" as const,
              text: "好的，历史已经回填。",
              ts: "2026-04-18T09:31:01.000Z",
            },
          ];
        },
        listRecent() {
          return [];
        },
      },
      eventBus,
      runtime: {
        startTurn: () => ({
          wait: Promise.resolve(0),
          interrupt: () => undefined,
        }),
        interrupt: () => false,
      },
      service,
    });

    server = http.createServer(bridge.app);
    bridge.attachWebSocket(server);

    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });

    const api = request(server);

    const importResponse = await api
      .post("/api/codex-sessions/thread_native_1/import")
      .set("Authorization", "Bearer secret")
      .expect(201);

    expect(importResponse.body.session.id).toBe(existingSession.id);

    const snapshotResponse = await api
      .get(`/api/sessions/${existingSession.id}/snapshot`)
      .set("Authorization", "Bearer secret")
      .expect(200);

    expect(
      snapshotResponse.body.events.map((event: { type: string; text?: string }) => ({
        type: event.type,
        text: event.text ?? null,
      })),
    ).toEqual([
      { type: "user_message", text: "继续原来的对话" },
      { type: "assistant_message", text: "好的，历史已经回填。" },
    ]);
  });

  it("creates a pending approval and blocks the session when runtime requests approval", async () => {
    store = new SqliteStore(":memory:");
    const eventBus = new EventBus();
    const service = new SessionService(store, eventBus);

    const bridge = createBridgeHttp({
      authToken: "secret",
      eventBus,
      runtime: {
        startTurn: (_input, callbacks) => {
          callbacks.onSignal({
            type: "approval_request",
            requestId: "approval_runtime_1",
            threadId: "thread_remote_1",
            turnId: "turn_remote_1",
            itemId: "item_permissions_1",
            scope: "network",
            reason: "Needs network access",
          });

          return {
            wait: Promise.resolve(null),
            interrupt: () => undefined,
          };
        },
        interrupt: () => false,
      },
      service,
    });

    server = http.createServer(bridge.app);
    bridge.attachWebSocket(server);

    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });

    const api = request(server);
    const createResponse = await api
      .post("/api/sessions")
      .set("Authorization", "Bearer secret")
      .send({
        title: "Approval Demo",
        projectPath: "/workspace/codex-remote-pwa/tmp-runtime",
      })
      .expect(201);

    const sessionId: string = createResponse.body.session.id;

    await api
      .post(`/api/sessions/${sessionId}/messages`)
      .set("Authorization", "Bearer secret")
      .send({ text: "Use the network" })
      .expect(202);

    const snapshotResponse = await api
      .get(`/api/sessions/${sessionId}/snapshot`)
      .set("Authorization", "Bearer secret")
      .expect(200);

    expect(snapshotResponse.body.session.status).toBe("blocked_approval");
    expect(snapshotResponse.body.approvals).toHaveLength(1);
    expect(snapshotResponse.body.approvals[0]).toMatchObject({
      scope: "network",
      reason: "Needs network access",
      status: "pending",
    });
    expect(
      snapshotResponse.body.events.map((event: { type: string; scope?: string }) => ({
        type: event.type,
        scope: event.scope ?? null,
      })),
    ).toEqual([
      { type: "user_message", scope: null },
      { type: "approval_required", scope: "network" },
    ]);
  });

  it("persists system messages emitted by the runtime", async () => {
    store = new SqliteStore(":memory:");
    const eventBus = new EventBus();
    const service = new SessionService(store, eventBus);

    const bridge = createBridgeHttp({
      authToken: "secret",
      eventBus,
      runtime: {
        startTurn: (_input, callbacks) => {
          callbacks.onSignal({
            type: "system_message",
            text: "App-server runtime failed: thread not found: thread_existing",
          });
          callbacks.onExit?.(1);
          return {
            wait: Promise.resolve(1),
            interrupt: () => undefined,
          };
        },
        interrupt: () => false,
      },
      service,
    });

    server = http.createServer(bridge.app);
    bridge.attachWebSocket(server);

    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });

    const api = request(server);
    const createResponse = await api
      .post("/api/sessions")
      .set("Authorization", "Bearer secret")
      .send({
        title: "Runtime Error Demo",
        projectPath: "/workspace/codex-remote-pwa/tmp-runtime",
      })
      .expect(201);

    const sessionId: string = createResponse.body.session.id;

    await api
      .post(`/api/sessions/${sessionId}/messages`)
      .set("Authorization", "Bearer secret")
      .send({ text: "Continue" })
      .expect(202);

    const snapshotResponse = await api
      .get(`/api/sessions/${sessionId}/snapshot`)
      .set("Authorization", "Bearer secret")
      .expect(200);

    expect(snapshotResponse.body.events).toContainEqual(
      expect.objectContaining({
        type: "system",
        text: "App-server runtime failed: thread not found: thread_existing",
      }),
    );
  });

  it("rejects a second prompt while the session has an active turn", async () => {
    store = new SqliteStore(":memory:");
    const eventBus = new EventBus();
    const service = new SessionService(store, eventBus);

    const bridge = createBridgeHttp({
      authToken: "secret",
      eventBus,
      runtime: {
        startTurn: () => ({
          wait: new Promise(() => undefined),
          interrupt: () => undefined,
        }),
        interrupt: () => true,
      },
      service,
    });

    server = http.createServer(bridge.app);
    bridge.attachWebSocket(server);

    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });

    const api = request(server);
    const createResponse = await api
      .post("/api/sessions")
      .set("Authorization", "Bearer secret")
      .send({
        title: "Busy Demo",
        projectPath: "/workspace/codex-remote-pwa/tmp-runtime",
      })
      .expect(201);

    const sessionId: string = createResponse.body.session.id;

    await api
      .post(`/api/sessions/${sessionId}/messages`)
      .set("Authorization", "Bearer secret")
      .send({ text: "First prompt" })
      .expect(202);

    await api
      .post(`/api/sessions/${sessionId}/messages`)
      .set("Authorization", "Bearer secret")
      .send({ text: "Second prompt" })
      .expect(409)
      .expect({
        error: "Session already has an active turn. Interrupt it before sending another message.",
      });

    const snapshotResponse = await api
      .get(`/api/sessions/${sessionId}/snapshot`)
      .set("Authorization", "Bearer secret")
      .expect(200);

    expect(snapshotResponse.body.session.status).toBe("running");
    expect(snapshotResponse.body.runs).toHaveLength(1);
    expect(snapshotResponse.body.events).toHaveLength(1);
    expect(snapshotResponse.body.events[0]).toMatchObject({
      type: "user_message",
      text: "First prompt",
    });
  });
});
