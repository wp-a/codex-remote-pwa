import WebSocket from "ws";

type JsonRpcResponse = {
  id: number | string;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

export type JsonRpcNotification = {
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcServerRequest = {
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type WebSocketCtor = typeof WebSocket;

export class AppServerClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private initialized = false;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationListeners = new Set<(message: JsonRpcNotification) => void>();
  private readonly requestListeners = new Set<(message: JsonRpcServerRequest) => void>();
  private readonly disconnectListeners = new Set<(error?: unknown) => void>();

  constructor(
    private readonly url: string,
    private readonly websocketCtor: WebSocketCtor = WebSocket,
  ) {}

  async connect(): Promise<void> {
    if (this.initialized && this.socket?.readyState === this.websocketCtor.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new this.websocketCtor(this.url);
      let settled = false;

      const fail = (error: unknown) => {
        if (settled) {
          this.emitDisconnect(error);
          return;
        }

        settled = true;
        this.connectPromise = null;
        reject(error);
      };

      socket.on("open", async () => {
        this.socket = socket;
        this.bindSocket(socket);

        try {
          await this.request("initialize", {
            clientInfo: {
              name: "codex-remote-pwa",
              title: "Codex Remote PWA",
              version: "0.1.0",
            },
            capabilities: null,
          });
          this.initialized = true;
          settled = true;
          resolve();
        } catch (error) {
          fail(error);
        } finally {
          this.connectPromise = null;
        }
      });

      socket.on("error", (error) => {
        fail(error);
      });
    });

    return this.connectPromise;
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (
      method !== "initialize" &&
      (!this.socket || this.socket.readyState !== this.websocketCtor.OPEN || !this.initialized)
    ) {
      await this.connect();
    }

    if (!this.socket || this.socket.readyState !== this.websocketCtor.OPEN) {
      throw new Error("App-server websocket is not connected.");
    }

    const id = this.nextId++;
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params: params ?? {},
      }),
    );

    return response;
  }

  onNotification(listener: (message: JsonRpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  onRequest(listener: (message: JsonRpcServerRequest) => void): () => void {
    this.requestListeners.add(listener);
    return () => {
      this.requestListeners.delete(listener);
    };
  }

  onDisconnect(listener: (error?: unknown) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => {
      this.disconnectListeners.delete(listener);
    };
  }

  private bindSocket(socket: WebSocket) {
    socket.on("message", (payload) => {
      this.handleMessage(String(payload));
    });

    socket.on("close", () => {
      this.socket = null;
      this.initialized = false;
      this.rejectPending(new Error("App-server websocket closed."));
      this.emitDisconnect();
    });
  }

  private handleMessage(raw: string) {
    const payload = JSON.parse(raw) as
      | JsonRpcNotification
      | JsonRpcServerRequest
      | JsonRpcResponse;

    if ("method" in payload && "id" in payload) {
      this.requestListeners.forEach((listener) => listener(payload));
      return;
    }

    if ("method" in payload) {
      this.notificationListeners.forEach((listener) => listener(payload));
      return;
    }

    const id = Number(payload.id);
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }

    this.pending.delete(id);

    if (payload.error) {
      pending.reject(
        new Error(payload.error.message || `JSON-RPC error ${payload.error.code ?? "unknown"}`),
      );
      return;
    }

    pending.resolve(payload.result);
  }

  private rejectPending(error: Error) {
    const pendingRequests = [...this.pending.values()];
    this.pending.clear();
    pendingRequests.forEach(({ reject }) => reject(error));
  }

  private emitDisconnect(error?: unknown) {
    this.disconnectListeners.forEach((listener) => listener(error));
  }
}
