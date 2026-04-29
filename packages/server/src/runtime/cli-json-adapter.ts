import type {
  RuntimeAdapter,
  RuntimeSignal,
  RuntimeTurnInput,
} from "./codex-runtime.js";

type CliJsonLine =
  | { type: "thread.started"; thread_id: string }
  | { type: "error"; message: string }
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
    }
  | {
      type: "turn.failed";
      error?: {
        message?: string;
      };
    };

export class CliJsonAdapter implements RuntimeAdapter {
  private ignoringHtmlNoise = false;
  private lastRuntimeErrorMessage: string | null = null;

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
      case "error":
        this.lastRuntimeErrorMessage = payload.message;
        return [{ type: "system_message", text: payload.message }];
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
        this.lastRuntimeErrorMessage = null;
        return [{ type: "turn_completed", usage: payload.usage }];
      case "turn.failed": {
        const message = payload.error?.message ?? "Codex turn failed.";
        if (message === this.lastRuntimeErrorMessage) {
          return [];
        }
        this.lastRuntimeErrorMessage = message;
        return [{ type: "system_message", text: message }];
      }
      default:
        return [];
    }
  }

  parseStderrLine(line: string): RuntimeSignal[] {
    const text = line.trim();
    if (!text) {
      return [];
    }

    if (this.shouldIgnoreStderr(text)) {
      return [];
    }

    return [{ type: "system_message", text }];
  }

  private shouldIgnoreStderr(text: string): boolean {
    if (this.ignoringHtmlNoise) {
      if (text.includes("</html>")) {
        this.ignoringHtmlNoise = false;
      }
      return true;
    }

    if (
      text.includes("codex_analytics::client: events failed") ||
      text.includes("Forbidden: <html>") ||
      text.includes("challenge-platform/h/g/orchestrate") ||
      text.includes("_cf_chl_opt") ||
      text.includes("Enable JavaScript and cookies")
    ) {
      this.ignoringHtmlNoise = !text.includes("</html>");
      return true;
    }

    return (
      text === "Reading additional input from stdin..." ||
      ["</div>", "</body>", "</html>"].includes(text) ||
      text.includes("codex_core_plugins::manifest: ignoring interface.defaultPrompt") ||
      text.includes("codex_core::session::turn: after_agent hook failed") ||
      text.includes("codex_core::session: failed to record rollout items") ||
      text.includes("codex_rmcp_client::stdio_server_launcher: Failed to terminate MCP process group") ||
      text.includes("rmcp::transport::worker: worker quit with fatal: Transport channel closed, when Auth(TokenRefreshFailed")
    );
  }
}
