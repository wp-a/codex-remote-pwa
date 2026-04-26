import type {
  RuntimeAdapter,
  RuntimeSignal,
  RuntimeTurnInput,
} from "./codex-runtime.js";

type CliJsonLine =
  | { type: "thread.started"; thread_id: string }
  | {
      type: "item.started";
      item: {
        id: string;
        type: "command_execution";
        command: string;
        aggregated_output: string | null;
        exit_code: number | null;
        status: "in_progress";
      };
    }
  | {
      type: "item.completed";
      item:
        | {
            id: string;
            type: "agent_message";
            text: string;
          }
        | {
            id: string;
            type: "command_execution";
            command: string;
            aggregated_output: string | null;
            exit_code: number | null;
            status: "completed" | "failed";
          };
    }
  | {
      type: "turn.completed";
      usage?: {
        input_tokens: number;
        cached_input_tokens: number;
        output_tokens: number;
      };
    };

export class CliJsonAdapter implements RuntimeAdapter {
  constructor(private readonly codexBin = "codex") {}

  buildInvocation(input: Omit<RuntimeTurnInput, "sessionId">): {
    command: string;
    args: string[];
  } {
    if (input.threadId) {
      return {
        command: this.codexBin,
        args: [
          "exec",
          "resume",
          "--json",
          "--skip-git-repo-check",
          input.threadId,
          input.prompt,
        ],
      };
    }

    return {
      command: this.codexBin,
      args: [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "-C",
        input.cwd,
        input.prompt,
      ],
    };
  }

  parseStdoutLine(line: string): RuntimeSignal[] {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      return [];
    }

    const payload = JSON.parse(trimmed) as CliJsonLine;

    switch (payload.type) {
      case "thread.started":
        return [{ type: "thread_started", threadId: payload.thread_id }];
      case "item.started":
        return [
          {
            type: "command",
            commandId: payload.item.id,
            command: payload.item.command,
            status: "running",
            output: payload.item.aggregated_output,
            exitCode: payload.item.exit_code,
          },
        ];
      case "item.completed":
        if (payload.item.type === "agent_message") {
          return [{ type: "assistant_message", text: payload.item.text }];
        }

        return [
          {
            type: "command",
            commandId: payload.item.id,
            command: payload.item.command,
            status: payload.item.status === "failed" ? "failed" : "done",
            output: payload.item.aggregated_output,
            exitCode: payload.item.exit_code,
          },
        ];
      case "turn.completed":
        return [{ type: "turn_completed", usage: payload.usage }];
      default:
        return [];
    }
  }

  parseStderrLine(line: string): RuntimeSignal[] {
    const text = line.trim();
    if (!text) {
      return [];
    }

    return [{ type: "system_message", text }];
  }
}
