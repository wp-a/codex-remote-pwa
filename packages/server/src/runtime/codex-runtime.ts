import { spawn } from "node:child_process";
import readline from "node:readline";

export type RuntimeSignal =
  | { type: "thread_started"; threadId: string }
  | {
      type: "command";
      commandId: string;
      command: string;
      status: "running" | "done" | "failed";
      output: string | null;
      exitCode: number | null;
    }
  | { type: "assistant_message"; text: string }
  | { type: "system_message"; text: string }
  | {
      type: "approval_request";
      requestId: string;
      threadId: string;
      turnId: string;
      itemId: string;
      scope: string;
      reason: string;
    }
  | {
      type: "turn_completed";
      usage?: {
        input_tokens: number;
        cached_input_tokens: number;
        output_tokens: number;
      };
    };

export type RuntimeCallbacks = {
  onSignal: (signal: RuntimeSignal) => void;
  onExit?: (code: number | null) => void;
};

export type RuntimeTurnInput = {
  sessionId: string;
  cwd: string;
  prompt: string;
  threadId?: string | null;
};

export type RuntimeHandle = {
  wait: Promise<number | null>;
  interrupt: () => void;
};

export interface RuntimeAdapter {
  buildInvocation(input: Omit<RuntimeTurnInput, "sessionId">): {
    command: string;
    args: string[];
  };
  parseStdoutLine(line: string): RuntimeSignal[];
  parseStderrLine(line: string): RuntimeSignal[];
}

type SpawnFn = typeof spawn;

export class CodexRuntime {
  private readonly activeTurns = new Map<string, RuntimeHandle>();

  constructor(
    private readonly adapter: RuntimeAdapter,
    private readonly spawnFn: SpawnFn = spawn,
  ) {}

  startTurn(input: RuntimeTurnInput, callbacks: RuntimeCallbacks): RuntimeHandle {
    if (this.activeTurns.has(input.sessionId)) {
      throw new Error(`Session already has an active turn: ${input.sessionId}`);
    }

    let currentChild: ReturnType<SpawnFn> | null = null;
    let emittedRuntimeOutput = false;
    let emittedSystemMessage = false;
    let attemptedFreshFallback = false;
    let resolveWait!: (code: number | null) => void;

    const wait = new Promise<number | null>((resolve) => {
      resolveWait = resolve;
    });

    const launch = (turnInput: Omit<RuntimeTurnInput, "sessionId">) => {
      const invocation = this.adapter.buildInvocation(turnInput);
      const child = this.spawnFn(invocation.command, invocation.args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      currentChild = child;

      const stdout = readline.createInterface({ input: child.stdout });
      const stderr = readline.createInterface({ input: child.stderr });

      stdout.on("line", (line) => {
        for (const signal of this.adapter.parseStdoutLine(line)) {
          if (signal.type !== "thread_started") {
            emittedRuntimeOutput = true;
          }
          if (signal.type === "system_message") {
            emittedSystemMessage = true;
          }
          callbacks.onSignal(signal);
        }
      });

      stderr.on("line", (line) => {
        for (const signal of this.adapter.parseStderrLine(line)) {
          if (signal.type === "system_message") {
            emittedSystemMessage = true;
          }
          callbacks.onSignal(signal);
        }
      });

      child.once("close", (code) => {
        const shouldFallbackToFreshThread =
          Boolean(turnInput.threadId) &&
          Boolean(code) &&
          code !== 0 &&
          !emittedRuntimeOutput &&
          !emittedSystemMessage &&
          !attemptedFreshFallback;

        if (shouldFallbackToFreshThread) {
          attemptedFreshFallback = true;
          emittedRuntimeOutput = false;
          emittedSystemMessage = false;
          launch({
            cwd: turnInput.cwd,
            prompt: turnInput.prompt,
            threadId: null,
          });
          return;
        }

        this.activeTurns.delete(input.sessionId);
        callbacks.onExit?.(code);
        resolveWait(code);
      });
    };

    const handle: RuntimeHandle = {
      wait,
      interrupt: () => {
        currentChild?.kill("SIGINT");
      },
    };

    this.activeTurns.set(input.sessionId, handle);
    launch(input);
    return handle;
  }

  interrupt(sessionId: string): boolean {
    const handle = this.activeTurns.get(sessionId);
    if (!handle) {
      return false;
    }

    handle.interrupt();
    return true;
  }
}
