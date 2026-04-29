import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { CliJsonAdapter } from "./cli-json-adapter.js";
import { CodexRuntime, type RuntimeSignal } from "./codex-runtime.js";

describe("CliJsonAdapter", () => {
  it("builds start and resume invocations and normalizes runtime events", () => {
    const adapter = new CliJsonAdapter("/usr/local/bin/codex");

    const fresh = adapter.buildInvocation({
      cwd: "/tmp/demo",
      prompt: "Reply READY",
    });
    const resumed = adapter.buildInvocation({
      cwd: "/tmp/demo",
      prompt: "Continue",
      threadId: "thread_123",
    });

    expect(fresh).toEqual({
      command: "/usr/local/bin/codex",
      args: [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "-C",
        "/tmp/demo",
        "Reply READY",
      ],
    });

    expect(resumed).toEqual({
      command: "/usr/local/bin/codex",
      args: [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "thread_123",
        "Continue",
      ],
    });

    const signals = [
      ...adapter.parseStdoutLine('{"type":"thread.started","thread_id":"thread_123"}'),
      ...adapter.parseStdoutLine(
        '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
      ),
      ...adapter.parseStdoutLine(
        '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"/tmp/demo\\n","exit_code":0,"status":"completed"}}',
      ),
      ...adapter.parseStdoutLine(
        '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"DONE"}}',
      ),
      ...adapter.parseStdoutLine(
        '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}',
      ),
      ...adapter.parseStderrLine("warning: something noisy"),
    ];

    expect(signals).toEqual([
      { type: "thread_started", threadId: "thread_123" },
      {
        type: "command",
        commandId: "item_1",
        command: "/bin/zsh -lc pwd",
        status: "running",
        output: "",
        exitCode: null,
      },
      {
        type: "command",
        commandId: "item_1",
        command: "/bin/zsh -lc pwd",
        status: "done",
        output: "/tmp/demo\n",
        exitCode: 0,
      },
      { type: "assistant_message", text: "DONE" },
      {
        type: "turn_completed",
        usage: {
          input_tokens: 1,
          cached_input_tokens: 0,
          output_tokens: 1,
        },
      },
      { type: "system_message", text: "warning: something noisy" },
    ]);
  });

  it("hides non-actionable cli stderr noise but keeps real runtime errors", () => {
    const adapter = new CliJsonAdapter();

    expect(
      adapter.parseStderrLine(
        "2026-04-28T02:40:23Z  WARN codex_analytics::client: events failed with status 403 Forbidden: <html>",
      ),
    ).toEqual([]);
    expect(adapter.parseStderrLine("  <body>challenge</body>")).toEqual([]);
    expect(adapter.parseStderrLine("</html>")).toEqual([]);
    expect(
      adapter.parseStderrLine(
        "2026-04-28T02:40:25Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when Auth(TokenRefreshFailed(\"Server returned error response: invalid_grant: Invalid refresh token\"))",
      ),
    ).toEqual([]);
    expect(adapter.parseStderrLine("Reading additional input from stdin...")).toEqual([]);
    expect(
      adapter.parseStderrLine(
        "2026-04-28T02:40:30Z ERROR codex_core::session: failed to record rollout items: thread 123 not found",
      ),
    ).toEqual([]);

    expect(
      adapter.parseStderrLine(
        "2026-04-28T02:45:04Z  WARN codex_core_plugins::client: featured plugins failed with status 403 Forbidden: <html>",
      ),
    ).toEqual([]);
    expect(
      adapter.parseStderrLine(
        "<script>a.src = '/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1?ray=9f32ba8f6faed789';</script>",
      ),
    ).toEqual([]);
    expect(adapter.parseStderrLine("</html>")).toEqual([]);

    expect(adapter.parseStderrLine("fatal: model request failed")).toEqual([
      { type: "system_message", text: "fatal: model request failed" },
    ]);
  });

  it("parses cli json runtime errors without duplicating turn.failed", () => {
    const adapter = new CliJsonAdapter();
    const message =
      "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 3:30 PM.";

    expect(
      adapter.parseStdoutLine(
        JSON.stringify({
          type: "error",
          message,
        }),
      ),
    ).toEqual([{ type: "system_message", text: message }]);
    expect(
      adapter.parseStdoutLine(
        JSON.stringify({
          type: "turn.failed",
          error: { message },
        }),
      ),
    ).toEqual([]);
  });
});

describe("CodexRuntime", () => {
  it("falls back to a fresh cli thread when resume exits without output", async () => {
    const adapter = new CliJsonAdapter("/usr/local/bin/codex");
    const children: Array<
      EventEmitter & {
        kill: () => void;
        stderr: PassThrough;
        stdout: PassThrough;
      }
    > = [];
    const spawnedArgs: string[][] = [];
    const spawnFn = ((command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        kill: () => void;
        stderr: PassThrough;
        stdout: PassThrough;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => undefined;
      children.push(child);
      spawnedArgs.push([command, ...args]);

      if (children.length === 1) {
        setTimeout(() => {
          child.emit("close", 1);
        }, 0);
      } else {
        setTimeout(() => {
          child.stdout.write(
            '{"type":"thread.started","thread_id":"thread_fallback"}\n',
          );
          child.stdout.write(
            '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"OK"}}\n',
          );
          child.stdout.write('{"type":"turn.completed"}\n');
          child.emit("close", 0);
        }, 0);
      }

      return child;
    }) as never;

    const runtime = new CodexRuntime(adapter, spawnFn);
    const signals: RuntimeSignal[] = [];
    const exits: Array<number | null> = [];

    const handle = runtime.startTurn(
      {
        cwd: "/tmp/demo",
        prompt: "Continue",
        sessionId: "session_1",
        threadId: "thread_missing",
      },
      {
        onExit: (code) => {
          exits.push(code);
        },
        onSignal: (signal) => {
          signals.push(signal);
        },
      },
    );

    await expect(handle.wait).resolves.toBe(0);

    expect(spawnedArgs).toEqual([
      [
        "/usr/local/bin/codex",
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "thread_missing",
        "Continue",
      ],
      [
        "/usr/local/bin/codex",
        "exec",
        "--json",
        "--skip-git-repo-check",
        "-C",
        "/tmp/demo",
        "Continue",
      ],
    ]);
    expect(signals).toEqual([
      { type: "thread_started", threadId: "thread_fallback" },
      { type: "assistant_message", text: "OK" },
      { type: "turn_completed", usage: undefined },
    ]);
    expect(exits).toEqual([0]);
  });
});
