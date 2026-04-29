import type http from "node:http";
import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { WebSocketServer } from "ws";

import type { ApprovalStatus, CodexSessionSummary } from "@codex-remote/shared";

import type { EventBus } from "./event-bus.js";
import type { ImportedTranscriptEntry } from "./rollout-history.js";
import type {
  RuntimeCallbacks,
  RuntimeHandle,
  RuntimeTurnInput,
} from "./runtime/codex-runtime.js";
import type { SessionService } from "./session-service.js";

type RuntimeController = {
  startTurn: (
    input: RuntimeTurnInput,
    callbacks: RuntimeCallbacks,
  ) => RuntimeHandle;
  interrupt: (sessionId: string) => boolean;
};

type RuntimeMode = "app-server" | "cli" | "local-only";

type CreateBridgeHttpOptions = {
  authToken: string;
  codexSessions?: {
    getByThreadId: (threadId: string) => CodexSessionSummary | null;
    getHistoryByThreadId: (
      threadId: string,
      limit?: number,
    ) => ImportedTranscriptEntry[];
    listRecent: () => CodexSessionSummary[];
  };
  eventBus: EventBus;
  runtime: RuntimeController | null;
  runtimeMode?: RuntimeMode;
  service: SessionService;
  staticDir?: string;
};

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

function queryToken(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isAuthorized(
  request: express.Request,
  authToken: string,
): boolean {
  if (!authToken) {
    return true;
  }

  return (
    bearerToken(request.header("authorization")) === authToken ||
    queryToken(request.query.token) === authToken
  );
}

function referrerToken(request: express.Request): string | null {
  const referer = request.header("referer") ?? request.header("referrer");
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).searchParams.get("token");
  } catch {
    return null;
  }
}

function isAuthorizedLocalImageRequest(
  request: express.Request,
  authToken: string,
): boolean {
  if (!authToken) {
    return true;
  }

  return (
    isAuthorized(request, authToken) ||
    referrerToken(request) === authToken
  );
}

const imageMimeByExtension = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function normalizeLocalImagePath(rawPath: string): string | null {
  const path =
    rawPath.startsWith("file://") ? fileURLToPath(rawPath) : decodePath(rawPath);
  return isAbsolute(path) ? resolve(path) : null;
}

function decodePath(rawPath: string): string {
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath;
  }
}

function localImageFile(rawPath: string): {
  filePath: string;
  mimeType: string;
} | null {
  const filePath = normalizeLocalImagePath(rawPath);
  const mimeType = filePath
    ? imageMimeByExtension.get(extname(filePath).toLowerCase())
    : null;

  if (!filePath || !mimeType || !existsSync(filePath)) {
    return null;
  }

  const stat = statSync(filePath);
  if (!stat.isFile() || stat.size > 25 * 1024 * 1024) {
    return null;
  }

  return { filePath, mimeType };
}

function sendLocalImage(response: express.Response, rawPath: string): boolean {
  const image = localImageFile(rawPath);
  if (!image) {
    return false;
  }

  response.type(image.mimeType);
  response.setHeader("Cache-Control", "private, max-age=60");
  response.sendFile(image.filePath);
  return true;
}

export function createBridgeHttp(options: CreateBridgeHttpOptions) {
  const app = express();
  app.use(express.json());

  function seedImportedHistory(sessionId: string, threadId: string) {
    const importedHistory =
      options.codexSessions?.getHistoryByThreadId(threadId, 120) ?? [];

    importedHistory.forEach((entry, index) => {
      options.service.appendEvent({
        sessionId,
        runId: `import_${threadId}_${index + 1}`,
        type: entry.role === "user" ? "user_message" : "assistant_message",
        text: entry.text,
        ts: entry.ts,
      });
    });
  }

  if (options.staticDir) {
    app.use(
      express.static(options.staticDir, {
        setHeaders: (response, servedPath) => {
          if (
            servedPath.endsWith("index.html") ||
            servedPath.endsWith("manifest.webmanifest") ||
            servedPath.endsWith("sw.js")
          ) {
            response.setHeader("Cache-Control", "no-store");
          }
        },
      }),
    );
  }

  app.get("/api/local-image", (request, response) => {
    if (!isAuthorized(request, options.authToken)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    const rawPath =
      typeof request.query.path === "string" ? request.query.path : "";
    if (!sendLocalImage(response, rawPath)) {
      response.status(404).json({ error: "Image not found." });
    }
  });

  app.use("/api", (request, response, next) => {
    if (isAuthorized(request, options.authToken)) {
      next();
      return;
    }

    response.status(401).json({ error: "Unauthorized" });
  });

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      runtimeMode: options.runtimeMode ?? (options.runtime ? "cli" : "local-only"),
      canSendMessages: Boolean(options.runtime),
    });
  });

  app.get("/api/sessions", (_request, response) => {
    response.json({ sessions: options.service.listSessions() });
  });

  app.get("/api/codex-sessions", (_request, response) => {
    const sessions = options.codexSessions?.listRecent() ?? [];
    response.json({
      sessions: sessions.map((session) => ({
        ...session,
        importedSessionId:
          options.service.findSessionByRuntimeThreadId(session.threadId)?.id ?? null,
      })),
    });
  });

  app.post("/api/sessions", (request, response) => {
    const session = options.service.createSession({
      title: String(request.body?.title ?? "Untitled Session"),
      projectPath: String(request.body?.projectPath ?? ""),
    });

    response.status(201).json({ session });
  });

  app.post("/api/codex-sessions/:threadId/import", (request, response) => {
    const threadId = String(request.params.threadId ?? "");
    const existingSession = options.service.findSessionByRuntimeThreadId(threadId);
    if (existingSession) {
      if (options.service.getSnapshot(existingSession.id).events.length === 0) {
        seedImportedHistory(existingSession.id, threadId);
      }

      response.status(201).json({ session: existingSession });
      return;
    }

    const nativeSession = options.codexSessions?.getByThreadId(threadId);
    if (!nativeSession) {
      response.status(404).json({ error: "Codex session not found." });
      return;
    }

    const session = options.service.createImportedSession({
      title: nativeSession.title,
      projectPath: nativeSession.projectPath,
      runtimeThreadId: nativeSession.threadId,
    });
    seedImportedHistory(session.id, threadId);

    response.status(201).json({ session });
  });

  app.get("/api/sessions/:sessionId", (request, response) => {
    response.json({ session: options.service.getSession(request.params.sessionId) });
  });

  app.get("/api/sessions/:sessionId/snapshot", (request, response) => {
    response.json(options.service.getSnapshot(request.params.sessionId));
  });

  app.post("/api/sessions/:sessionId/messages", (request, response) => {
    const text = String(request.body?.text ?? "").trim();
    if (!text) {
      response.status(400).json({ error: "Message text is required." });
      return;
    }

    const session = options.service.getSession(request.params.sessionId);
    if (session.status === "running" || session.status === "blocked_approval") {
      response.status(409).json({
        error:
          "Session already has an active turn. Interrupt it before sending another message.",
      });
      return;
    }

    if (!options.runtime) {
      response.status(503).json({
        error: "本地只读模式只能查看本机 Codex 历史，不能发送新任务。",
      });
      return;
    }

    const run = options.service.startRun({
      sessionId: session.id,
      prompt: text,
    });

    let completed = false;
    let emittedRuntimeSystemMessage = false;
    try {
      options.runtime.startTurn(
        {
          sessionId: session.id,
          cwd: session.projectPath,
          prompt: text,
          threadId: session.runtimeThreadId ?? undefined,
        },
        {
          onSignal: (signal) => {
            switch (signal.type) {
              case "thread_started":
                options.service.updateSessionRuntimeThreadId(
                  session.id,
                  signal.threadId,
                );
                break;
              case "approval_request": {
                const approval = options.service.createApproval({
                  sessionId: session.id,
                  runId: run.id,
                  scope: signal.scope,
                  reason: signal.reason,
                  status: "pending",
                  createdAt: new Date().toISOString(),
                });
                options.service.appendEvent({
                  sessionId: session.id,
                  runId: run.id,
                  type: "approval_required",
                  approvalId: approval.id,
                  scope: signal.scope,
                  ts: new Date().toISOString(),
                });
                options.service.updateSessionStatus(session.id, "blocked_approval");
                break;
              }
              case "assistant_message":
                options.service.appendEvent({
                  sessionId: session.id,
                  runId: run.id,
                  type: "assistant_message",
                  text: signal.text,
                  ts: new Date().toISOString(),
                });
                break;
              case "command":
                options.service.appendEvent({
                  sessionId: session.id,
                  runId: run.id,
                  type: "command",
                  cmd: signal.command,
                  status: signal.status,
                  ts: new Date().toISOString(),
                });
                break;
              case "turn_completed":
                completed = true;
                options.service.updateRunStatus(run.id, "completed");
                options.service.updateSessionStatus(session.id, "idle");
                break;
              case "system_message":
                emittedRuntimeSystemMessage = true;
                options.service.appendEvent({
                  sessionId: session.id,
                  runId: run.id,
                  type: "system",
                  text: signal.text,
                  ts: new Date().toISOString(),
                });
                break;
            }
          },
          onExit: (code) => {
            if (completed || !code || code === 0) {
              return;
            }

            options.service.updateRunStatus(run.id, "failed");
            options.service.updateSessionStatus(session.id, "error");
            if (!emittedRuntimeSystemMessage) {
              options.service.appendEvent({
                sessionId: session.id,
                runId: run.id,
                type: "system",
                text: `Codex exited with code ${code}`,
                ts: new Date().toISOString(),
              });
            }
          },
        },
      );
    } catch (error) {
      options.service.updateRunStatus(run.id, "failed");
      options.service.updateSessionStatus(session.id, "error");
      options.service.appendEvent({
        sessionId: session.id,
        runId: run.id,
        type: "system",
        text: error instanceof Error ? error.message : "Runtime failed to start.",
        ts: new Date().toISOString(),
      });
      response.status(500).json({ error: "Runtime failed to start." });
      return;
    }

    response.status(202).json({ run });
  });

  app.post("/api/sessions/:sessionId/interrupt", (request, response) => {
    const session = options.service.getSession(request.params.sessionId);
    const interrupted = options.runtime?.interrupt(session.id) ?? false;

    if (interrupted && session.lastRunId) {
      options.service.updateRunStatus(session.lastRunId, "interrupted");
      options.service.updateSessionStatus(session.id, "idle");
    }

    response.json({ interrupted });
  });

  const updateApproval =
    (status: ApprovalStatus) =>
    (request: express.Request, response: express.Response) => {
      const approvalId = String(request.params.approvalId);
      options.service.updateApprovalStatus(approvalId, status);
      response.json({ approvalId, status });
    };

  app.post(
    "/api/approvals/:approvalId/approve-once",
    updateApproval("approved_once"),
  );
  app.post(
    "/api/approvals/:approvalId/approve-turn",
    updateApproval("approved_turn"),
  );
  app.post("/api/approvals/:approvalId/reject", updateApproval("rejected"));

  app.get(/^\/.+\.(?:avif|bmp|gif|jpe?g|png|webp)$/i, (request, response, next) => {
    if (!isAuthorizedLocalImageRequest(request, options.authToken)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (sendLocalImage(response, request.path)) {
      return;
    }

    next();
  });

  if (options.staticDir && existsSync(join(options.staticDir, "index.html"))) {
    app.get(/^\/(?!api(?:\/|$)).*/, (_request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.sendFile(join(options.staticDir!, "index.html"));
    });
  }

  function attachWebSocket(server: http.Server) {
    const socketServer = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      const origin = new URL(request.url ?? "/", "http://127.0.0.1");
      const match = origin.pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
      if (!match) {
        socket.destroy();
        return;
      }

      const token = origin.searchParams.get("token");
      if (options.authToken && token !== options.authToken) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const sessionId = decodeURIComponent(match[1] ?? "");
      socketServer.handleUpgrade(request, socket, head, (websocket) => {
        const unsubscribe = options.eventBus.subscribe(sessionId, (event) => {
          websocket.send(JSON.stringify(event));
        });

        websocket.on("close", () => {
          unsubscribe();
        });
      });
    });
  }

  return {
    app,
    attachWebSocket,
  };
}
