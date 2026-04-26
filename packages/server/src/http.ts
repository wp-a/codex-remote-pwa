import type http from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";

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
  runtime: RuntimeController;
  service: SessionService;
  staticDir?: string;
};

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
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

  app.use("/api", (request, response, next) => {
    if (
      !options.authToken ||
      bearerToken(request.header("authorization")) === options.authToken
    ) {
      next();
      return;
    }

    response.status(401).json({ error: "Unauthorized" });
  });

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
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
    const run = options.service.startRun({
      sessionId: session.id,
      prompt: text,
    });

    let completed = false;
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
              break;
          }
        },
        onExit: (code) => {
          if (completed || !code || code === 0) {
            return;
          }

          options.service.updateRunStatus(run.id, "failed");
          options.service.updateSessionStatus(session.id, "error");
          options.service.appendEvent({
            sessionId: session.id,
            runId: run.id,
            type: "system",
            text: `Codex exited with code ${code}`,
            ts: new Date().toISOString(),
          });
        },
      },
    );

    response.status(202).json({ run });
  });

  app.post("/api/sessions/:sessionId/interrupt", (request, response) => {
    const session = options.service.getSession(request.params.sessionId);
    const interrupted = options.runtime.interrupt(session.id);

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
