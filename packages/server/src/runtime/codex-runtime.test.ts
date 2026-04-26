import { describe, expect, it } from "vitest";

import { CliJsonAdapter } from "./cli-json-adapter.js";

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
});
