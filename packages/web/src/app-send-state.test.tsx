import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Session, SessionSnapshot } from "@codex-remote/shared";

import { App } from "./app.js";

const idleSession: Session = {
  id: "session_send",
  title: "Send state task",
  projectPath: "/workspace/send-state",
  status: "idle",
  createdAt: "2026-07-18T09:00:00.000Z",
  updatedAt: "2026-07-18T09:00:00.000Z",
  runtimeThreadId: "thread_send",
};

const runningSession: Session = {
  ...idleSession,
  status: "running",
  lastRunId: "run_send",
};

function snapshot(
  session: Session,
  assistantText?: string,
): SessionSnapshot {
  return {
    session,
    runs: [],
    events: assistantText
      ? [
          {
            id: `event_${session.status}`,
            sessionId: session.id,
            runId: "run_send",
            type: "assistant_message",
            text: assistantText,
            ts: "2026-07-18T09:00:01.000Z",
          },
        ]
      : [],
    approvals: [],
  };
}

function clientWith(getSnapshot: (sessionId: string) => Promise<SessionSnapshot>) {
  return {
    getHealth: async () => ({
      ok: true,
      runtimeMode: "app-server" as const,
      canSendMessages: true,
    }),
    listSessions: async () => [idleSession],
    listCodexSessions: async () => [],
    createSession: async () => idleSession,
    importCodexSession: async () => idleSession,
    getSnapshot,
    sendMessage: vi.fn(async () => ({ id: "run_send" })),
    interrupt: async () => ({ interrupted: true }),
    approveOnce: async () => undefined,
    approveTurn: async () => undefined,
    rejectApproval: async () => undefined,
  };
}

const realtime = { connect: () => () => undefined };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

describe("App send state refresh", () => {
  it("applies the immediate running snapshot, then unlocks after polling completion", async () => {
    const getSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot(idleSession, "Ready"))
      .mockResolvedValueOnce(snapshot(runningSession))
      .mockResolvedValue(snapshot(idleSession, "Task completed"));
    const client = clientWith(getSnapshot);
    const user = userEvent.setup();

    render(
      <App
        client={client}
        initialBaseUrl="https://bridge.example.test"
        initialToken="secret"
        onSaveConnection={() => undefined}
        realtime={realtime}
      />,
    );

    await screen.findByText("Ready");
    await user.type(
      screen.getByPlaceholderText("继续这个会话，告诉 Codex 你想做什么…"),
      "Run the tests",
    );
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByRole("button", { name: "停止任务" })).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(client.sendMessage).toHaveBeenCalledTimes(1);

    expect(await screen.findByText("Task completed", {}, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "停止任务" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "发送" })).not.toBeDisabled();
    });
  });

  it("keeps an accepted task locked while an immediate snapshot refresh fails", async () => {
    const getSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot(idleSession, "Ready"))
      .mockRejectedValueOnce(new Error("snapshot unavailable"))
      .mockResolvedValue(snapshot(idleSession, "Recovered completion"));
    const client = clientWith(getSnapshot);
    const user = userEvent.setup();

    render(
      <App
        client={client}
        initialBaseUrl="https://bridge.example.test"
        initialToken="secret"
        onSaveConnection={() => undefined}
        realtime={realtime}
      />,
    );

    await screen.findByText("Ready");
    const composer = screen.getByPlaceholderText(
      "继续这个会话，告诉 Codex 你想做什么…",
    );
    await user.type(composer, "Run safely");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText(/任务已发送，但状态刷新失败/)).toBeInTheDocument();
    expect(composer).toHaveValue("");
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "停止任务" })).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();

    expect(
      await screen.findByText("Recovered completion", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).not.toBeDisabled();
  });

  it("restores the draft when sending itself fails", async () => {
    const client = clientWith(async () => snapshot(idleSession, "Ready"));
    client.sendMessage.mockRejectedValueOnce(new Error("send unavailable"));
    const user = userEvent.setup();

    render(
      <App
        client={client}
        initialBaseUrl="https://bridge.example.test"
        initialToken="secret"
        onSaveConnection={() => undefined}
        realtime={realtime}
      />,
    );

    await screen.findByText("Ready");
    const composer = screen.getByPlaceholderText(
      "继续这个会话，告诉 Codex 你想做什么…",
    );
    await user.type(composer, "Keep this draft");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("send unavailable")).toBeInTheDocument();
    expect(composer).toHaveValue("Keep this draft");
  });

  it("keeps only one slow polling snapshot in flight and applies its result", async () => {
    vi.useFakeTimers();
    const slowCompletion = deferred<SessionSnapshot>();
    const getSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot(runningSession, "Working"))
      .mockImplementationOnce(() => slowCompletion.promise)
      .mockResolvedValue(snapshot(idleSession, "Unexpected extra poll"));
    const client = clientWith(getSnapshot);
    client.listSessions = async () => [runningSession];

    try {
      render(
        <App
          client={client}
          initialBaseUrl="https://bridge.example.test"
          initialToken="secret"
          onSaveConnection={() => undefined}
          realtime={realtime}
        />,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("Working")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(getSnapshot).toHaveBeenCalledTimes(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      expect(getSnapshot).toHaveBeenCalledTimes(2);

      await act(async () => {
        slowCompletion.resolve(snapshot(idleSession, "Slow completion"));
        await slowCompletion.promise;
      });

      expect(screen.getByText("Slow completion")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "发送" })).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an accepted run pending only for its session across session switches", async () => {
    window.localStorage.clear();
    const sessionA: Session = {
      ...idleSession,
      id: "session_a",
      title: "Session A",
      runtimeThreadId: "thread_a",
    };
    const runningSessionA: Session = {
      ...sessionA,
      status: "running",
      lastRunId: "run_a",
    };
    const sessionB: Session = {
      ...idleSession,
      id: "session_b",
      title: "Session B",
      runtimeThreadId: "thread_b",
    };
    const acceptedRefresh = deferred<SessionSnapshot>();
    const reselectedRefresh = deferred<SessionSnapshot>();
    let sessionASnapshotCalls = 0;
    const getSnapshot = vi.fn((sessionId: string) => {
      if (sessionId === sessionB.id) {
        return Promise.resolve(snapshot(sessionB, "B ready"));
      }

      sessionASnapshotCalls += 1;
      if (sessionASnapshotCalls === 1) {
        return Promise.resolve(snapshot(sessionA, "A ready"));
      }
      if (sessionASnapshotCalls === 2) {
        return acceptedRefresh.promise;
      }
      if (sessionASnapshotCalls === 3) {
        return reselectedRefresh.promise;
      }

      return Promise.resolve(snapshot(sessionA, "A completed"));
    });
    const client = clientWith(getSnapshot);
    client.listSessions = async () => [sessionA, sessionB];
    const user = userEvent.setup();

    render(
      <App
        client={client}
        initialBaseUrl="https://bridge.example.test"
        initialToken="secret"
        onSaveConnection={() => undefined}
        realtime={realtime}
      />,
    );

    await screen.findByText("A ready");
    await user.type(
      screen.getByPlaceholderText("继续这个会话，告诉 Codex 你想做什么…"),
      "Run A",
    );
    await user.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledWith(sessionA.id, "Run A");
      expect(sessionASnapshotCalls).toBe(2);
    });

    await user.click(screen.getByRole("button", { name: "选择会话" }));
    await user.click(screen.getByRole("tab", { name: "已保存" }));
    await user.click(screen.getByRole("button", { name: /Session B/ }));

    expect(await screen.findByRole("heading", { name: "Session B" })).toBeInTheDocument();
    expect(await screen.findByText("B ready")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停止任务" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).not.toBeDisabled();

    await act(async () => {
      acceptedRefresh.resolve(snapshot(runningSessionA, "Stale A refresh"));
      await acceptedRefresh.promise;
    });
    expect(screen.getByRole("heading", { name: "Session B" })).toBeInTheDocument();
    expect(screen.queryByText("Stale A refresh")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "选择会话" }));
    await user.click(screen.getByRole("tab", { name: "已保存" }));
    await user.click(screen.getByRole("button", { name: /Session A/ }));

    expect(await screen.findByRole("heading", { name: "Session A" })).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止任务" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();

    expect(
      await screen.findByText("A completed", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停止任务" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).not.toBeDisabled();

    await act(async () => {
      reselectedRefresh.resolve(snapshot(runningSessionA, "Late stale refresh"));
      await reselectedRefresh.promise;
    });
    expect(screen.queryByText("Late stale refresh")).not.toBeInTheDocument();
  });
});
