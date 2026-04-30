import type { TimelineEvent } from "@codex-remote/shared";
import {
  remoteEventSchema,
  remoteMessageSchema,
  remoteRequestSchema,
  type RemoteEvent,
  type RemoteRequest,
  type RemoteRequestAction,
  type RemoteResponse,
} from "@codex-remote/shared";

import type { ApiClient, BridgeHealth, CreateSessionInput } from "./api.js";
import type { RealtimeClient } from "./realtime.js";

type RemoteBridgeOptions = {
  pairCode: string;
  relayUrl: string;
};

type PendingRequest = {
  reject: (error: Error) => void;
  resolve: (payload: Record<string, unknown>) => void;
};

function messageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `msg_${Date.now()}_${Math.random()}`;
}

function buildAppWsUrl(relayUrl: string, pairCode: string): string {
  const url = new URL("/api/relay/app", relayUrl);
  url.protocol = url.protocol.replace(/^http/, "ws");
  url.searchParams.set("pair", pairCode);
  return url.toString();
}

function requestMessage(
  action: RemoteRequestAction,
  payload: Record<string, unknown> = {},
): RemoteRequest {
  return remoteRequestSchema.parse({
    v: 1,
    kind: "request",
    id: messageId(),
    ns: "bridge",
    action,
    ts: Date.now(),
    payload,
  });
}

class RemoteBridgeSocket {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly timelineListeners = new Map<string, Set<(event: TimelineEvent) => void>>();

  constructor(private readonly options: RemoteBridgeOptions) {}

  async request<T>(
    action: RemoteRequestAction,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    await this.connect();
    const message = requestMessage(action, payload);

    return new Promise<T>((resolve, reject) => {
      this.pending.set(message.id, {
        reject,
        resolve: (responsePayload) => resolve(responsePayload as T),
      });
      this.socket?.send(JSON.stringify(message));
    });
  }

  subscribe(sessionId: string, listener: (event: TimelineEvent) => void): () => void {
    const listeners = this.timelineListeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.timelineListeners.set(sessionId, listeners);

    void this.request("subscribe_session", { sessionId }).catch(() => undefined);

    return () => {
      const current = this.timelineListeners.get(sessionId);
      current?.delete(listener);
      if (!current || current.size > 0) {
        return;
      }

      this.timelineListeners.delete(sessionId);
      void this.request("unsubscribe_session", { sessionId }).catch(() => undefined);
    };
  }

  private async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(
        buildAppWsUrl(this.options.relayUrl, this.options.pairCode),
      );
      this.socket = socket;

      socket.addEventListener("open", () => {
        this.connectPromise = null;
        resolve();
      });

      socket.addEventListener("error", () => {
        this.connectPromise = null;
        reject(new Error("Relay WebSocket 连接失败。"));
      });

      socket.addEventListener("close", () => {
        this.socket = null;
        this.connectPromise = null;
        const pending = [...this.pending.values()];
        this.pending.clear();
        pending.forEach(({ reject: rejectPending }) => {
          rejectPending(new Error("Relay WebSocket 已断开。"));
        });
      });

      socket.addEventListener("message", (event) => {
        this.handleMessage(String(event.data));
      });
    });

    return this.connectPromise;
  }

  private handleMessage(raw: string) {
    const parsed = remoteMessageSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return;
    }

    if (parsed.data.kind === "response") {
      this.handleResponse(parsed.data);
      return;
    }

    if (parsed.data.kind === "event") {
      this.handleEvent(parsed.data);
    }
  }

  private handleResponse(response: RemoteResponse) {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    this.pending.delete(response.id);
    if (!response.ok) {
      pending.reject(new Error(response.error?.message ?? "Relay request failed."));
      return;
    }

    pending.resolve(response.payload);
  }

  private handleEvent(event: RemoteEvent) {
    const parsed = remoteEventSchema.parse(event);
    if (parsed.action !== "timeline_event") {
      return;
    }

    const sessionId =
      typeof parsed.payload.sessionId === "string" ? parsed.payload.sessionId : null;
    const timelineEvent = parsed.payload.event as TimelineEvent | undefined;
    if (!sessionId || !timelineEvent) {
      return;
    }

    this.timelineListeners
      .get(sessionId)
      ?.forEach((listener) => listener(timelineEvent));
  }
}

export function createRemoteBridge(options: RemoteBridgeOptions): {
  client: ApiClient;
  realtime: RealtimeClient;
} {
  const socket = new RemoteBridgeSocket(options);

  return {
    client: {
      async getHealth() {
        const health = await socket.request<BridgeHealth & { agent?: unknown }>(
          "health",
        );
        return {
          ...health,
          transport: "relay",
        };
      },
      async listSessions() {
        const result = await socket.request<{
          sessions: Awaited<ReturnType<ApiClient["listSessions"]>>;
        }>("list_sessions");
        return result.sessions;
      },
      async listCodexSessions() {
        const result = await socket.request<{
          sessions: Awaited<ReturnType<ApiClient["listCodexSessions"]>>;
        }>("list_codex_sessions");
        return result.sessions;
      },
      async createSession(input: CreateSessionInput) {
        const result = await socket.request<{
          session: Awaited<ReturnType<ApiClient["createSession"]>>;
        }>("create_session", input);
        return result.session;
      },
      async importCodexSession(threadId) {
        const result = await socket.request<{
          session: Awaited<ReturnType<ApiClient["importCodexSession"]>>;
        }>("import_codex_session", { threadId });
        return result.session;
      },
      async getSnapshot(sessionId) {
        const result = await socket.request<{
          snapshot: Awaited<ReturnType<ApiClient["getSnapshot"]>>;
        }>("get_snapshot", { sessionId });
        return result.snapshot;
      },
      async sendMessage(sessionId, text) {
        const result = await socket.request<{
          run: Awaited<ReturnType<ApiClient["sendMessage"]>>;
        }>("send_message", { sessionId, text });
        return result.run;
      },
      async interrupt(sessionId) {
        return socket.request("interrupt", { sessionId });
      },
      async approveOnce(approvalId) {
        await socket.request("approve_once", { approvalId });
      },
      async approveTurn(approvalId) {
        await socket.request("approve_turn", { approvalId });
      },
      async rejectApproval(approvalId) {
        await socket.request("reject_approval", { approvalId });
      },
    },
    realtime: {
      connect(sessionId, onEvent) {
        return socket.subscribe(sessionId, onEvent);
      },
    },
  };
}
