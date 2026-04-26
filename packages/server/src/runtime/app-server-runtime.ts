import { AppServerAdapter } from "./app-server-adapter.js";
import {
  AppServerClient,
  type JsonRpcNotification,
  type JsonRpcServerRequest,
} from "./app-server-client.js";
import type {
  RuntimeCallbacks,
  RuntimeHandle,
  RuntimeSignal,
  RuntimeTurnInput,
} from "./codex-runtime.js";

type ActiveTurnState = {
  callbacks: RuntimeCallbacks;
  resolveWait: (code: number | null) => void;
  settled: boolean;
  threadId: string | null;
  turnId: string | null;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export class AppServerRuntime {
  private readonly adapter = new AppServerAdapter();
  private readonly client: AppServerClient;
  private readonly activeTurns = new Map<string, ActiveTurnState>();
  private readonly threadToSession = new Map<string, string>();

  constructor(
    url: string,
    client: AppServerClient = new AppServerClient(url),
  ) {
    this.client = client;
    this.client.onNotification((notification) => {
      this.handleNotification(notification);
    });
    this.client.onRequest((request) => {
      this.handleServerRequest(request);
    });
    this.client.onDisconnect((error) => {
      this.handleDisconnect(error);
    });
  }

  startTurn(input: RuntimeTurnInput, callbacks: RuntimeCallbacks): RuntimeHandle {
    if (this.activeTurns.has(input.sessionId)) {
      throw new Error(`Session already has an active turn: ${input.sessionId}`);
    }

    const deferred = createDeferred<number | null>();
    const state: ActiveTurnState = {
      callbacks,
      resolveWait: deferred.resolve,
      settled: false,
      threadId: input.threadId ?? null,
      turnId: null,
    };

    if (input.threadId) {
      this.threadToSession.set(input.threadId, input.sessionId);
    }

    this.activeTurns.set(input.sessionId, state);

    void this.beginTurn(input);

    return {
      wait: deferred.promise,
      interrupt: () => {
        void this.interrupt(input.sessionId);
      },
    };
  }

  interrupt(sessionId: string): boolean {
    const state = this.activeTurns.get(sessionId);
    if (!state?.threadId || !state.turnId) {
      return false;
    }

    void this.client
      .request("turn/interrupt", this.adapter.buildInterruptParams(state.threadId, state.turnId))
      .catch((error) => {
        this.emitSignal(sessionId, {
          type: "system_message",
          text: `Failed to interrupt active turn: ${describeError(error)}`,
        });
      });

    return true;
  }

  private async beginTurn(input: RuntimeTurnInput) {
    try {
      await this.client.connect();

      let threadId = input.threadId ?? null;
      if (!threadId) {
        const threadResult = await this.client.request(
          "thread/start",
          this.adapter.buildThreadStartParams({ cwd: input.cwd }),
        );
        threadId = this.adapter.getThreadIdFromThreadStartResponse(threadResult);
        if (!threadId) {
          throw new Error("App-server did not return a thread id.");
        }

        const state = this.activeTurns.get(input.sessionId);
        if (!state || state.settled) {
          return;
        }

        state.threadId = threadId;
        this.threadToSession.set(threadId, input.sessionId);
        state.callbacks.onSignal({ type: "thread_started", threadId });
      }

      const turnResult = await this.client.request(
        "turn/start",
        this.adapter.buildTurnStartParams({
          cwd: input.cwd,
          prompt: input.prompt,
          threadId,
        }),
      );

      const state = this.activeTurns.get(input.sessionId);
      if (!state || state.settled) {
        return;
      }

      state.threadId = threadId;
      state.turnId = this.adapter.getTurnIdFromTurnStartResponse(turnResult);
    } catch (error) {
      this.emitSignal(input.sessionId, {
        type: "system_message",
        text: `App-server runtime failed: ${describeError(error)}`,
      });
      this.finishSession(input.sessionId, 1);
    }
  }

  private handleNotification(notification: JsonRpcNotification) {
    if (notification.method === "turn/started") {
      const { threadId, turnId } = this.adapter.getTurnStartedIds(notification);
      const sessionId = threadId ? this.threadToSession.get(threadId) : null;
      const state = sessionId ? this.activeTurns.get(sessionId) : null;
      if (state && turnId) {
        state.turnId = turnId;
      }
      return;
    }

    if (notification.method === "turn/completed") {
      const { threadId, turnId } = this.adapter.getTurnCompletedIds(notification);
      const sessionId = threadId ? this.threadToSession.get(threadId) : null;
      if (!sessionId) {
        return;
      }

      const state = this.activeTurns.get(sessionId);
      if (!state) {
        return;
      }

      if (turnId) {
        state.turnId = turnId;
      }

      const status = this.adapter.getTurnCompletedStatus(notification);
      if (status === "completed") {
        state.callbacks.onSignal({ type: "turn_completed" });
        this.finishSession(sessionId, 0);
        return;
      }

      if (status === "interrupted") {
        this.finishSession(sessionId, 0);
        return;
      }

      if (status === "failed") {
        state.callbacks.onSignal({
          type: "system_message",
          text: "App-server turn failed.",
        });
        this.finishSession(sessionId, 1);
      }
      return;
    }

    const sessionId = this.resolveSessionId(notification.params);
    if (!sessionId) {
      return;
    }

    for (const signal of this.adapter.parseNotification(notification)) {
      this.emitSignal(sessionId, signal);
    }
  }

  private handleServerRequest(request: JsonRpcServerRequest) {
    const sessionId = this.resolveSessionId(request.params);
    if (!sessionId) {
      return;
    }

    for (const signal of this.adapter.parseServerRequest(request)) {
      this.emitSignal(sessionId, signal);
    }
  }

  private handleDisconnect(error?: unknown) {
    for (const [sessionId, state] of this.activeTurns.entries()) {
      if (state.settled) {
        continue;
      }

      state.callbacks.onSignal({
        type: "system_message",
        text: `App-server websocket disconnected: ${describeError(error)}`,
      });
      this.finishSession(sessionId, 1);
    }
  }

  private resolveSessionId(
    params: Record<string, unknown> | undefined,
  ): string | null {
    const threadId = typeof params?.threadId === "string" ? params.threadId : null;
    if (!threadId) {
      return null;
    }

    return this.threadToSession.get(threadId) ?? null;
  }

  private emitSignal(sessionId: string, signal: RuntimeSignal) {
    const state = this.activeTurns.get(sessionId);
    if (!state || state.settled) {
      return;
    }

    state.callbacks.onSignal(signal);
  }

  private finishSession(sessionId: string, code: number | null) {
    const state = this.activeTurns.get(sessionId);
    if (!state || state.settled) {
      return;
    }

    state.settled = true;
    this.activeTurns.delete(sessionId);
    if (state.threadId) {
      this.threadToSession.delete(state.threadId);
    }
    state.callbacks.onExit?.(code);
    state.resolveWait(code);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}
