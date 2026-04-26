import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Session, SessionSnapshot, TimelineEvent } from "@codex-remote/shared";

import { App } from "../app.js";

const session: Session = {
  id: "session_1",
  title: "Demo Session",
  projectPath: "/workspace/demo",
  status: "idle",
  createdAt: "2026-04-18T10:00:00.000Z",
  updatedAt: "2026-04-18T10:00:00.000Z",
  lastRunId: null,
  runtimeThreadId: "thread_1",
};

const snapshot: SessionSnapshot = {
  session,
  runs: [],
  events: [
    {
      id: "history_user_1",
      sessionId: session.id,
      runId: "import_1",
      type: "user_message",
      text: "先告诉我这个项目是做什么的",
      ts: "2026-04-18T09:59:58.000Z",
    },
    {
      id: "history_assistant_1",
      sessionId: session.id,
      runId: "import_1",
      type: "assistant_message",
      text: "这是一个手机端远程控制 Codex 的项目。",
      ts: "2026-04-18T09:59:59.000Z",
    },
  ],
  approvals: [
    {
      id: "approval_1",
      sessionId: session.id,
      runId: "run_1",
      scope: "network",
      reason: "Needs network",
      status: "pending",
      createdAt: "2026-04-18T10:00:00.000Z",
    },
    {
      id: "approval_2",
      sessionId: session.id,
      runId: "run_1",
      scope: "filesystem",
      reason: "Needs filesystem access",
      status: "pending",
      createdAt: "2026-04-18T10:00:01.000Z",
    },
    {
      id: "approval_3",
      sessionId: session.id,
      runId: "run_1",
      scope: "dangerous",
      reason: "Needs dangerous action",
      status: "pending",
      createdAt: "2026-04-18T10:00:02.000Z",
    },
  ],
};

describe("session view", () => {
  it("sends prompts, shows only the latest output, and triggers approval actions", async () => {
    const sendMessage = vi.fn(async () => ({ id: "run_1" }));
    const approveOnce = vi.fn(async () => undefined);
    const approveTurn = vi.fn(async () => undefined);
    const rejectApproval = vi.fn(async () => undefined);

    let pushEvent: ((event: TimelineEvent) => void) | null = null;

    const client = {
      listSessions: async () => [session],
      listCodexSessions: async () => [],
      createSession: async () => session,
      importCodexSession: async () => session,
      getSnapshot: async () => snapshot,
      sendMessage,
      interrupt: async () => ({ interrupted: true }),
      approveOnce,
      approveTurn,
      rejectApproval,
    };

    const realtime = {
      connect: (_sessionId: string, onEvent: (event: TimelineEvent) => void) => {
        pushEvent = onEvent;
        return () => undefined;
      },
    };

    render(
      <App
        client={client}
        initialBaseUrl="https://bridge.example.test"
        initialToken="bridge-secret"
        onSaveConnection={() => undefined}
        realtime={realtime}
      />,
    );

    const user = userEvent.setup();
    const composer = await screen.findByPlaceholderText(
      "继续这个会话，告诉 Codex 你想做什么…",
    );

    expect(
      await screen.findByText("先告诉我这个项目是做什么的"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("这是一个手机端远程控制 Codex 的项目。"),
    ).toBeInTheDocument();
    expect(screen.getByText("继续当前会话")).toBeInTheDocument();
    expect(screen.queryByText("下一条任务")).not.toBeInTheDocument();

    await user.type(composer, "Explain the repo");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(sendMessage).toHaveBeenCalledWith("session_1", "Explain the repo");

    pushEvent?.({
      id: "event_cmd_1",
      sessionId: "session_1",
      runId: "run_1",
      type: "command",
      cmd: "npm test",
      status: "running",
      ts: "2026-04-18T10:00:00.500Z",
    });

    pushEvent?.({
      id: "event_1",
      sessionId: "session_1",
      runId: "run_1",
      type: "assistant_message",
      text: "READY",
      ts: "2026-04-18T10:00:01.000Z",
    });

    expect(await screen.findByText("READY")).toBeInTheDocument();
    expect(screen.getByText("先告诉我这个项目是做什么的")).toBeInTheDocument();
    expect(screen.queryByText("执行中: npm test")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "允许一次" })[0]!);
    await waitFor(() => {
      expect(approveOnce).toHaveBeenCalledWith("approval_1");
    });

    await user.click(screen.getAllByRole("button", { name: "本轮允许" })[0]!);
    await waitFor(() => {
      expect(approveTurn).toHaveBeenCalledWith("approval_2");
    });

    await user.click(screen.getAllByRole("button", { name: "拒绝" })[0]!);
    await waitFor(() => {
      expect(rejectApproval).toHaveBeenCalledWith("approval_3");
    });
  });
});
