import { randomUUID } from "node:crypto";
import os from "node:os";

import WebSocket from "ws";

import {
  remoteEventSchema,
  remoteMessageSchema,
  remoteRequestSchema,
  remoteResponseSchema,
  type RemoteEvent,
  type RemoteRequest,
  type RemoteResponse,
  type TimelineEvent,
} from "@codex-remote/shared";

import { LocalBridgeClient } from "./bridge-client.js";

export type RemoteAgentOptions = {
  bridgeUrl: string;
  pairCode: string;
  relayUrl: string;
  token: string;
};

function buildAgentWsUrl(relayUrl: string, pairCode: string): string {
  const url = new URL("/api/relay/agent", relayUrl);
  url.protocol = url.protocol.replace(/^http/, "ws");
  url.searchParams.set("pair", pairCode);
  return url.toString();
}

function responseFor(
  request: RemoteRequest,
  ok: boolean,
  payload: Record<string, unknown>,
  error?: RemoteResponse["error"],
): RemoteResponse {
  return remoteResponseSchema.parse({
    v: 1,
    kind: "response",
    id: request.id,
    ns: request.ns,
    action: request.action,
    ts: Date.now(),
    ok,
    payload,
    error,
  });
}

function event(
  action: RemoteEvent["action"],
  payload: Record<string, unknown>,
): RemoteEvent {
  return remoteEventSchema.parse({
    v: 1,
    kind: "event",
    id: randomUUID(),
    ns: action === "agent_status" ? "health" : "bridge",
    action,
    ts: Date.now(),
    payload,
  });
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required field: ${key}`);
  }

  return value;
}

export class RemoteAgent {
  private readonly bridge: LocalBridgeClient;
  private readonly startedAt = new Date().toISOString();
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly subscriptions = new Map<string, WebSocket>();

  constructor(private readonly options: RemoteAgentOptions) {
    this.bridge = new LocalBridgeClient({
      baseUrl: options.bridgeUrl,
      token: options.token,
    });
  }

  connect(): Promise<void> {
    const wsUrl = buildAgentWsUrl(this.options.relayUrl, this.options.pairCode);
    this.socket = new WebSocket(wsUrl);

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Agent socket not initialized."));
        return;
      }

      this.socket.once("open", () => {
        this.startHeartbeat();
        resolve();
      });
      this.socket.once("error", reject);
      this.socket.on("message", (data) => {
        void this.handleMessage(String(data));
      });
      this.socket.on("close", () => {
        this.stopHeartbeat();
        this.closeSubscriptions();
      });
    });
  }

  close() {
    this.stopHeartbeat();
    this.closeSubscriptions();
    this.socket?.close();
    this.socket = null;
  }

  private startHeartbeat() {
    this.send(
      event("agent_status", {
        bridgeUrl: this.options.bridgeUrl,
        host: os.hostname(),
        platform: process.platform,
        startedAt: this.startedAt,
      }),
    );

    this.heartbeatTimer = setInterval(() => {
      this.send(
        event("agent_status", {
          bridgeUrl: this.options.bridgeUrl,
          host: os.hostname(),
          platform: process.platform,
          startedAt: this.startedAt,
        }),
      );
    }, 10_000);
  }

  private stopHeartbeat() {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private closeSubscriptions() {
    this.subscriptions.forEach((socket) => socket.close());
    this.subscriptions.clear();
  }

  private async handleMessage(raw: string) {
    const parsed = remoteMessageSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.kind !== "request") {
      return;
    }

    const request = remoteRequestSchema.parse(parsed.data);
    try {
      const payload = await this.handleRequest(request);
      this.send(responseFor(request, true, payload));
    } catch (error) {
      this.send(
        responseFor(request, false, {}, {
          code: "AGENT_REQUEST_FAILED",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  private async handleRequest(request: RemoteRequest): Promise<Record<string, unknown>> {
    switch (request.action) {
      case "health":
        return {
          ...(await this.bridge.getHealth()),
          agent: {
            bridgeUrl: this.options.bridgeUrl,
            host: os.hostname(),
            platform: process.platform,
            startedAt: this.startedAt,
          },
        };
      case "list_sessions":
        return { sessions: await this.bridge.listSessions() };
      case "list_codex_sessions":
        return { sessions: await this.bridge.listCodexSessions() };
      case "create_session":
        return {
          session: await this.bridge.createSession({
            title: stringField(request.payload, "title"),
            projectPath: stringField(request.payload, "projectPath"),
          }),
        };
      case "import_codex_session":
        return {
          session: await this.bridge.importCodexSession(
            stringField(request.payload, "threadId"),
          ),
        };
      case "get_snapshot":
        return {
          snapshot: await this.bridge.getSnapshot(
            stringField(request.payload, "sessionId"),
          ),
        };
      case "send_message":
        return {
          run: await this.bridge.sendMessage(
            stringField(request.payload, "sessionId"),
            stringField(request.payload, "text"),
          ),
        };
      case "interrupt":
        return await this.bridge.interrupt(stringField(request.payload, "sessionId"));
      case "approve_once":
        await this.bridge.approveOnce(stringField(request.payload, "approvalId"));
        return {};
      case "approve_turn":
        await this.bridge.approveTurn(stringField(request.payload, "approvalId"));
        return {};
      case "reject_approval":
        await this.bridge.rejectApproval(stringField(request.payload, "approvalId"));
        return {};
      case "subscribe_session":
        this.subscribeToSession(stringField(request.payload, "sessionId"));
        return {};
      case "unsubscribe_session":
        this.unsubscribeFromSession(stringField(request.payload, "sessionId"));
        return {};
    }
  }

  private subscribeToSession(sessionId: string) {
    if (this.subscriptions.has(sessionId)) {
      return;
    }

    const socket = new WebSocket(this.bridge.streamUrl(sessionId));
    socket.on("message", (data) => {
      const timelineEvent = JSON.parse(String(data)) as TimelineEvent;
      this.send(
        event("timeline_event", {
          sessionId,
          event: timelineEvent,
        }),
      );
    });
    socket.on("close", () => {
      this.subscriptions.delete(sessionId);
    });
    this.subscriptions.set(sessionId, socket);
  }

  private unsubscribeFromSession(sessionId: string) {
    const socket = this.subscriptions.get(sessionId);
    socket?.close();
    this.subscriptions.delete(sessionId);
  }

  private send(message: RemoteEvent | RemoteResponse) {
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(message));
  }
}
