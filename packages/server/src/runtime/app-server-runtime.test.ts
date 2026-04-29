import http from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import type { RuntimeSignal } from "./codex-runtime.js";
import { AppServerRuntime } from "./app-server-runtime.js";

function rpcResponse(id: number | string, result: unknown) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function rpcNotification(method: string, params: unknown) {
  return JSON.stringify({
    jsonrpc: "2.0",
    method,
    params,
  });
}

function threadPayload(id: string, cwd: string) {
  return {
    id,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd,
    cliVersion: "1.0.0",
    source: "appServer",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}

function turnPayload(id: string, status: "inProgress" | "completed" | "interrupted" | "failed") {
  return {
    id,
    items: [],
    status,
    error: null,
  };
}

function failedTurnPayload(id: string, message: string) {
  return {
    id,
    items: [],
    status: "failed",
    error: {
      message,
      codexErrorInfo: "unauthorized",
      additionalDetails: "token_revoked",
    },
  };
}

describe("AppServerRuntime", () => {
  let httpServer: http.Server | null = null;
  let socketServer: WebSocketServer | null = null;

  afterEach(async () => {
    socketServer?.clients.forEach((client) => {
      client.terminate();
    });

    await new Promise<void>((resolve, reject) => {
      socketServer?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }) ?? resolve();
    });
    socketServer = null;

    await new Promise<void>((resolve, reject) => {
      httpServer?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }) ?? resolve();
    });
    httpServer = null;
  });

  it("starts a new thread, starts a turn, and normalizes runtime notifications", async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];

    httpServer = http.createServer();
    socketServer = new WebSocketServer({ server: httpServer });

    socketServer.on("connection", (socket) => {
      socket.on("message", (message) => {
        const payload = JSON.parse(String(message)) as {
          id: number;
          method: string;
          params?: Record<string, unknown>;
        };
        requests.push({ method: payload.method, params: payload.params });

        if (payload.method === "initialize") {
          socket.send(
            rpcResponse(payload.id, {
              userAgent: "codex-app-server",
              codexHome: "/tmp/codex-home",
              platformFamily: "unix",
              platformOs: "macos",
            }),
          );
          return;
        }

        if (payload.method === "thread/start") {
          socket.send(
            rpcResponse(payload.id, {
              thread: threadPayload("thread_1", "/tmp/demo"),
              model: "gpt-5.4",
              modelProvider: "openai",
              serviceTier: null,
              cwd: "/tmp/demo",
              approvalPolicy: "on-request",
              approvalsReviewer: "user",
              sandbox: "workspace-write",
              reasoningEffort: null,
            }),
          );
          return;
        }

        if (payload.method === "turn/start") {
          socket.send(
            rpcResponse(payload.id, {
              turn: turnPayload("turn_1", "inProgress"),
            }),
          );

          socket.send(
            rpcNotification("item/started", {
              threadId: "thread_1",
              turnId: "turn_1",
              item: {
                type: "commandExecution",
                id: "item_command_1",
                command: "npm test",
                cwd: "/tmp/demo",
                processId: null,
                source: "agent",
                status: "inProgress",
                commandActions: [],
                aggregatedOutput: null,
                exitCode: null,
                durationMs: null,
              },
            }),
          );
          socket.send(
            rpcNotification("item/completed", {
              threadId: "thread_1",
              turnId: "turn_1",
              item: {
                type: "commandExecution",
                id: "item_command_1",
                command: "npm test",
                cwd: "/tmp/demo",
                processId: null,
                source: "agent",
                status: "completed",
                commandActions: [],
                aggregatedOutput: "ok",
                exitCode: 0,
                durationMs: 10,
              },
            }),
          );
          socket.send(
            rpcNotification("item/completed", {
              threadId: "thread_1",
              turnId: "turn_1",
              item: {
                type: "agentMessage",
                id: "item_message_1",
                text: "READY",
                phase: null,
                memoryCitation: null,
              },
            }),
          );
          socket.send(
            rpcNotification("turn/completed", {
              threadId: "thread_1",
              turn: turnPayload("turn_1", "completed"),
            }),
          );
        }
      });
    });

    await new Promise<void>((resolve) => {
      httpServer?.listen(0, "127.0.0.1", () => resolve());
    });

    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a test port.");
    }

    const runtime = new AppServerRuntime(`ws://127.0.0.1:${address.port}`);
    const signals: RuntimeSignal[] = [];
    let exitCode: number | null = null;

    const handle = runtime.startTurn(
      {
        sessionId: "session_1",
        cwd: "/tmp/demo",
        prompt: "Reply READY",
      },
      {
        onSignal(signal) {
          signals.push(signal);
        },
        onExit(code) {
          exitCode = code;
        },
      },
    );

    await handle.wait;

    expect(requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/start",
      "turn/start",
    ]);
    expect(requests[0]?.params).toMatchObject({
      capabilities: {
        experimentalApi: true,
      },
    });
    expect(requests[2]?.params).toMatchObject({
      threadId: "thread_1",
      cwd: "/tmp/demo",
      input: [{ type: "text", text: "Reply READY", text_elements: [] }],
    });

    expect(signals).toEqual([
      { type: "thread_started", threadId: "thread_1" },
      {
        type: "command",
        commandId: "item_command_1",
        command: "npm test",
        status: "running",
        output: null,
        exitCode: null,
      },
      {
        type: "command",
        commandId: "item_command_1",
        command: "npm test",
        status: "done",
        output: "ok",
        exitCode: 0,
      },
      { type: "assistant_message", text: "READY" },
      { type: "turn_completed" },
    ]);
    expect(exitCode).toBe(0);
  });

  it("interrupts the active turn for a session", async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];

    httpServer = http.createServer();
    socketServer = new WebSocketServer({ server: httpServer });

    socketServer.on("connection", (socket) => {
      socket.on("message", (message) => {
        const payload = JSON.parse(String(message)) as {
          id: number;
          method: string;
          params?: Record<string, unknown>;
        };
        requests.push({ method: payload.method, params: payload.params });

        if (payload.method === "initialize") {
          socket.send(
            rpcResponse(payload.id, {
              userAgent: "codex-app-server",
              codexHome: "/tmp/codex-home",
              platformFamily: "unix",
              platformOs: "macos",
            }),
          );
          return;
        }

        if (payload.method === "thread/resume") {
          socket.send(
            rpcResponse(payload.id, {
              thread: threadPayload("thread_existing", "/tmp/demo"),
              model: "gpt-5.4",
              modelProvider: "openai",
              serviceTier: null,
              cwd: "/tmp/demo",
              approvalPolicy: "on-request",
              approvalsReviewer: "user",
              sandbox: "workspace-write",
              reasoningEffort: null,
            }),
          );
          return;
        }

        if (payload.method === "turn/start") {
          socket.send(rpcResponse(payload.id, { turn: turnPayload("turn_existing", "inProgress") }));
          return;
        }

        if (payload.method === "turn/interrupt") {
          socket.send(rpcResponse(payload.id, {}));
        }
      });
    });

    await new Promise<void>((resolve) => {
      httpServer?.listen(0, "127.0.0.1", () => resolve());
    });

    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a test port.");
    }

    const runtime = new AppServerRuntime(`ws://127.0.0.1:${address.port}`);
    runtime.startTurn(
      {
        sessionId: "session_1",
        cwd: "/tmp/demo",
        prompt: "Continue",
        threadId: "thread_existing",
      },
      {
        onSignal: () => undefined,
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(runtime.interrupt("session_1")).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/resume",
      "turn/start",
      "turn/interrupt",
    ]);
    expect(requests[3]?.params).toEqual({
      threadId: "thread_existing",
      turnId: "turn_existing",
    });
  });

  it("resumes an existing thread before starting a turn", async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];

    httpServer = http.createServer();
    socketServer = new WebSocketServer({ server: httpServer });

    socketServer.on("connection", (socket) => {
      socket.on("message", (message) => {
        const payload = JSON.parse(String(message)) as {
          id: number;
          method: string;
          params?: Record<string, unknown>;
        };
        requests.push({ method: payload.method, params: payload.params });

        if (payload.method === "initialize") {
          socket.send(
            rpcResponse(payload.id, {
              userAgent: "codex-app-server",
              codexHome: "/tmp/codex-home",
              platformFamily: "unix",
              platformOs: "macos",
            }),
          );
          return;
        }

        if (payload.method === "thread/resume") {
          socket.send(
            rpcResponse(payload.id, {
              thread: threadPayload("thread_existing", "/tmp/demo"),
              model: "gpt-5.4",
              modelProvider: "openai",
              serviceTier: null,
              cwd: "/tmp/demo",
              approvalPolicy: "on-request",
              approvalsReviewer: "user",
              sandbox: "workspace-write",
              reasoningEffort: null,
            }),
          );
          return;
        }

        if (payload.method === "turn/start") {
          socket.send(rpcResponse(payload.id, { turn: turnPayload("turn_existing", "inProgress") }));
          socket.send(
            rpcNotification("turn/completed", {
              threadId: "thread_existing",
              turn: turnPayload("turn_existing", "completed"),
            }),
          );
        }
      });
    });

    await new Promise<void>((resolve) => {
      httpServer?.listen(0, "127.0.0.1", () => resolve());
    });

    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a test port.");
    }

    const runtime = new AppServerRuntime(`ws://127.0.0.1:${address.port}`);

    const handle = runtime.startTurn(
      {
        sessionId: "session_1",
        cwd: "/tmp/demo",
        prompt: "Continue",
        threadId: "thread_existing",
      },
      {
        onSignal: () => undefined,
      },
    );

    await handle.wait;

    expect(requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/resume",
      "turn/start",
    ]);
    expect(requests[1]?.params).toMatchObject({
      threadId: "thread_existing",
      cwd: "/tmp/demo",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      persistExtendedHistory: true,
    });
  });

  it("maps approval requests into runtime approval signals", async () => {
    httpServer = http.createServer();
    socketServer = new WebSocketServer({ server: httpServer });

    socketServer.on("connection", (socket) => {
      socket.on("message", (message) => {
        const payload = JSON.parse(String(message)) as {
          id: number;
          method: string;
        };

        if (payload.method === "initialize") {
          socket.send(
            rpcResponse(payload.id, {
              userAgent: "codex-app-server",
              codexHome: "/tmp/codex-home",
              platformFamily: "unix",
              platformOs: "macos",
            }),
          );
          return;
        }

        if (payload.method === "thread/resume") {
          socket.send(
            rpcResponse(payload.id, {
              thread: threadPayload("thread_existing", "/tmp/demo"),
              model: "gpt-5.4",
              modelProvider: "openai",
              serviceTier: null,
              cwd: "/tmp/demo",
              approvalPolicy: "on-request",
              approvalsReviewer: "user",
              sandbox: "workspace-write",
              reasoningEffort: null,
            }),
          );
          return;
        }

        if (payload.method === "turn/start") {
          socket.send(rpcResponse(payload.id, { turn: turnPayload("turn_approval", "inProgress") }));
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: "approval_1",
              method: "item/permissions/requestApproval",
              params: {
                threadId: "thread_existing",
                turnId: "turn_approval",
                itemId: "item_permissions_1",
                permissions: {
                  network: {
                    enabled: true,
                  },
                },
                reason: "Needs network",
              },
            }),
          );
        }
      });
    });

    await new Promise<void>((resolve) => {
      httpServer?.listen(0, "127.0.0.1", () => resolve());
    });

    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a test port.");
    }

    const runtime = new AppServerRuntime(`ws://127.0.0.1:${address.port}`);
    const signals: RuntimeSignal[] = [];

    runtime.startTurn(
      {
        sessionId: "session_1",
        cwd: "/tmp/demo",
        prompt: "Use network",
        threadId: "thread_existing",
      },
      {
        onSignal(signal) {
          signals.push(signal);
        },
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(signals).toContainEqual({
      type: "approval_request",
      scope: "network",
      reason: "Needs network",
      requestId: "approval_1",
      threadId: "thread_existing",
      turnId: "turn_approval",
      itemId: "item_permissions_1",
    });
  });

  it("emits the detailed app-server turn error when a turn fails", async () => {
    const authError =
      "Encountered invalidated oauth token for user, failing request";

    httpServer = http.createServer();
    socketServer = new WebSocketServer({ server: httpServer });

    socketServer.on("connection", (socket) => {
      socket.on("message", (message) => {
        const payload = JSON.parse(String(message)) as {
          id: number;
          method: string;
        };

        if (payload.method === "initialize") {
          socket.send(
            rpcResponse(payload.id, {
              userAgent: "codex-app-server",
              codexHome: "/tmp/codex-home",
              platformFamily: "unix",
              platformOs: "macos",
            }),
          );
          return;
        }

        if (payload.method === "thread/resume") {
          socket.send(
            rpcResponse(payload.id, {
              thread: threadPayload("thread_existing", "/tmp/demo"),
              model: "gpt-5.4",
              modelProvider: "openai",
              serviceTier: null,
              cwd: "/tmp/demo",
              approvalPolicy: "on-request",
              approvalsReviewer: "user",
              sandbox: "workspace-write",
              reasoningEffort: null,
            }),
          );
          return;
        }

        if (payload.method === "turn/start") {
          socket.send(rpcResponse(payload.id, { turn: turnPayload("turn_failed", "inProgress") }));
          socket.send(
            rpcNotification("turn/completed", {
              threadId: "thread_existing",
              turn: failedTurnPayload("turn_failed", authError),
            }),
          );
        }
      });
    });

    await new Promise<void>((resolve) => {
      httpServer?.listen(0, "127.0.0.1", () => resolve());
    });

    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a test port.");
    }

    const runtime = new AppServerRuntime(`ws://127.0.0.1:${address.port}`);
    const signals: RuntimeSignal[] = [];
    let exitCode: number | null = null;

    const handle = runtime.startTurn(
      {
        sessionId: "session_1",
        cwd: "/tmp/demo",
        prompt: "Continue",
        threadId: "thread_existing",
      },
      {
        onSignal(signal) {
          signals.push(signal);
        },
        onExit(code) {
          exitCode = code;
        },
      },
    );

    await handle.wait;

    expect(signals).toContainEqual({
      type: "system_message",
      text: `Codex 登录已失效，请重新登录后再发送消息。原始错误：${authError}`,
    });
    expect(signals).not.toContainEqual({
      type: "system_message",
      text: "App-server turn failed.",
    });
    expect(exitCode).toBe(1);
  });
});
