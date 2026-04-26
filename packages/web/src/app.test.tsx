import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  CodexSessionSummary,
  Session,
  SessionSnapshot,
} from "@codex-remote/shared";

import { App } from "./app.js";

const session: Session = {
  id: "session_1",
  title: "Demo Session",
  projectPath: "/workspace/demo",
  status: "idle",
  createdAt: "2026-04-18T10:00:00.000Z",
  updatedAt: "2026-04-18T10:00:00.000Z",
  lastRunId: null,
  runtimeThreadId: null,
};

const snapshot: SessionSnapshot = {
  session,
  runs: [],
  events: [
    {
      id: "event_hist_user_1",
      sessionId: session.id,
      runId: "import_1",
      type: "user_message",
      text: "这是之前的用户问题",
      ts: "2026-04-18T10:00:00.000Z",
    },
    {
      id: "event_hist_assistant_1",
      sessionId: session.id,
      runId: "import_1",
      type: "assistant_message",
      text: "这是之前的助手回答",
      ts: "2026-04-18T10:00:01.000Z",
    },
  ],
  approvals: [],
};

const nativeSession: CodexSessionSummary = {
  threadId: "thread_native_1",
  title: "Existing Codex Session",
  projectPath: "/workspace/native-demo",
  updatedAt: "2026-04-18T10:00:00.000Z",
  importedSessionId: null,
};

describe("App", () => {
  it("opens and closes the session drawer while keeping the main console focused", async () => {
    const client = {
      listSessions: async () => [session],
      listCodexSessions: async () => [],
      createSession: async () => session,
      importCodexSession: async () => session,
      getSnapshot: async () => snapshot,
      sendMessage: async () => ({ id: "run_1" }),
      interrupt: async () => ({ interrupted: false }),
      approveOnce: async () => undefined,
      approveTurn: async () => undefined,
      rejectApproval: async () => undefined,
    };

    const realtime = {
      connect: () => () => undefined,
    };

    const user = userEvent.setup();
    render(
      <App
        client={client}
        initialBaseUrl="https://bridge.example.test"
        initialToken="bridge-secret"
        onSaveConnection={() => undefined}
        realtime={realtime}
      />,
    );

    expect(await screen.findByRole("button", { name: "打开会话抽屉" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "会话抽屉" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开会话抽屉" }));

    expect(await screen.findByRole("dialog", { name: "会话抽屉" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Demo Session/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭会话抽屉" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "会话抽屉" })).not.toBeInTheDocument();
    });

    expect(await screen.findByRole("heading", { level: 1, name: "Demo Session" })).toBeInTheDocument();
    expect(await screen.findByText("这是之前的用户问题")).toBeInTheDocument();
    expect(await screen.findByText("这是之前的助手回答")).toBeInTheDocument();
    expect(screen.getByText("继续当前会话")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("继续这个会话，告诉 Codex 你想做什么…"),
    ).toBeInTheDocument();
    expect(screen.queryByText("手机控制台")).not.toBeInTheDocument();
  });

  it("creates a new session from the sidebar form", async () => {
    const createSession = vi.fn(async () => session);
    const client = {
      listSessions: async () => [],
      listCodexSessions: async () => [],
      createSession,
      importCodexSession: async () => session,
      getSnapshot: async () => snapshot,
      sendMessage: async () => ({ id: "run_1" }),
      interrupt: async () => ({ interrupted: false }),
      approveOnce: async () => undefined,
      approveTurn: async () => undefined,
      rejectApproval: async () => undefined,
    };

    const realtime = {
      connect: () => () => undefined,
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
    await user.click(await screen.findByRole("button", { name: "打开会话抽屉" }));
    await user.type(screen.getByPlaceholderText("例如：官网改版"), "Demo Session");
    await user.type(
      screen.getByPlaceholderText("/Users/you/project"),
      "/workspace/demo",
    );
    await user.click(screen.getByRole("button", { name: "创建会话" }));

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith({
        title: "Demo Session",
        projectPath: "/workspace/demo",
      });
    });
  });

  it("imports a recent Codex session and selects it", async () => {
    const importedSession: Session = {
      ...session,
      id: "session_imported",
      title: nativeSession.title,
      projectPath: nativeSession.projectPath,
      runtimeThreadId: nativeSession.threadId,
    };
    const importedSnapshot: SessionSnapshot = {
      session: importedSession,
      runs: [],
      events: [
        {
          id: "event_import_user_1",
          sessionId: importedSession.id,
          runId: "import_1",
          type: "user_message",
          text: "请继续我们刚才的对话",
          ts: "2026-04-18T10:00:00.000Z",
        },
        {
          id: "event_import_assistant_1",
          sessionId: importedSession.id,
          runId: "import_1",
          type: "assistant_message",
          text: "好的，我会接着上一条会话继续。",
          ts: "2026-04-18T10:00:01.000Z",
        },
      ],
      approvals: [],
    };

    const importCodexSession = vi.fn(async () => importedSession);
    const client = {
      listSessions: async () => [],
      listCodexSessions: async () => [nativeSession],
      createSession: async () => session,
      importCodexSession,
      getSnapshot: async () => importedSnapshot,
      sendMessage: async () => ({ id: "run_1" }),
      interrupt: async () => ({ interrupted: false }),
      approveOnce: async () => undefined,
      approveTurn: async () => undefined,
      rejectApproval: async () => undefined,
    };

    const realtime = {
      connect: () => () => undefined,
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
    await user.click(await screen.findByRole("button", { name: "打开会话抽屉" }));
    await user.click((await screen.findAllByRole("button", { name: /Existing Codex Session/ }))[0]!);

    await waitFor(() => {
      expect(importCodexSession).toHaveBeenCalledWith("thread_native_1");
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "会话抽屉" })).not.toBeInTheDocument();
    });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Existing Codex Session" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("请继续我们刚才的对话")).toBeInTheDocument();
    expect(await screen.findByText("好的，我会接着上一条会话继续。")).toBeInTheDocument();
  });

  it("uses the token query parameter when saving a connection with an empty password", async () => {
    const onSaveConnection = vi.fn();
    const client = {
      listSessions: async () => [],
      listCodexSessions: async () => [],
      createSession: async () => session,
      importCodexSession: async () => session,
      getSnapshot: async () => snapshot,
      sendMessage: async () => ({ id: "run_1" }),
      interrupt: async () => ({ interrupted: false }),
      approveOnce: async () => undefined,
      approveTurn: async () => undefined,
      rejectApproval: async () => undefined,
    };

    const realtime = {
      connect: () => () => undefined,
    };

    render(
      <App
        client={client}
        initialBaseUrl="https://bridge.example.test?token=bridge-secret"
        initialToken="change-me"
        onSaveConnection={onSaveConnection}
        realtime={realtime}
      />,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "打开会话抽屉" }));
    await user.click(screen.getByRole("button", { name: "保存连接" }));

    expect(onSaveConnection).toHaveBeenCalledWith({
      baseUrl: "https://bridge.example.test?token=bridge-secret",
      token: "bridge-secret",
    });
  });

  it("re-imports an already linked native session so older bridge sessions can backfill history", async () => {
    const alreadyImportedNativeSession: CodexSessionSummary = {
      ...nativeSession,
      importedSessionId: "session_existing",
    };
    const existingBridgeSession: Session = {
      ...session,
      id: "session_existing",
      title: alreadyImportedNativeSession.title,
      projectPath: alreadyImportedNativeSession.projectPath,
      runtimeThreadId: alreadyImportedNativeSession.threadId,
    };
    const existingSnapshot: SessionSnapshot = {
      session: existingBridgeSession,
      runs: [],
      events: [
        {
          id: "event_existing_user_1",
          sessionId: existingBridgeSession.id,
          runId: "import_1",
          type: "user_message",
          text: "旧 bridge 会话现在也要补回历史",
          ts: "2026-04-18T10:00:00.000Z",
        },
      ],
      approvals: [],
    };

    const importCodexSession = vi.fn(async () => existingBridgeSession);
    const client = {
      listSessions: async () => [existingBridgeSession],
      listCodexSessions: async () => [alreadyImportedNativeSession],
      createSession: async () => session,
      importCodexSession,
      getSnapshot: async () => existingSnapshot,
      sendMessage: async () => ({ id: "run_1" }),
      interrupt: async () => ({ interrupted: false }),
      approveOnce: async () => undefined,
      approveTurn: async () => undefined,
      rejectApproval: async () => undefined,
    };

    const realtime = {
      connect: () => () => undefined,
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
    await user.click(await screen.findByRole("button", { name: "打开会话抽屉" }));
    await user.click(
      (await screen.findAllByRole("button", { name: /Existing Codex Session/ }))[0]!,
    );

    await waitFor(() => {
      expect(importCodexSession).toHaveBeenCalledWith("thread_native_1");
    });
  });

  it("switches imported sessions immediately instead of continuing to show the previous snapshot", async () => {
    const sessionTwo: Session = {
      ...session,
      id: "session_2",
      title: "Second Session",
      projectPath: "/workspace/second",
      updatedAt: "2026-04-18T10:05:00.000Z",
    };

    const snapshotTwo: SessionSnapshot = {
      session: sessionTwo,
      runs: [],
      events: [
        {
          id: "event_hist_user_2",
          sessionId: sessionTwo.id,
          runId: "import_2",
          type: "user_message",
          text: "第二个会话的问题",
          ts: "2026-04-18T10:05:00.000Z",
        },
      ],
      approvals: [],
    };

    let resolveSecondSnapshot: ((snapshot: SessionSnapshot) => void) | null = null;
    const secondSnapshotPromise = new Promise<SessionSnapshot>((resolve) => {
      resolveSecondSnapshot = resolve;
    });

    const getSnapshot = vi.fn(async (sessionId: string) => {
      if (sessionId === session.id) {
        return snapshot;
      }

      return secondSnapshotPromise;
    });

    const client = {
      listSessions: async () => [session, sessionTwo],
      listCodexSessions: async () => [],
      createSession: async () => session,
      importCodexSession: async () => session,
      getSnapshot,
      sendMessage: async () => ({ id: "run_1" }),
      interrupt: async () => ({ interrupted: false }),
      approveOnce: async () => undefined,
      approveTurn: async () => undefined,
      rejectApproval: async () => undefined,
    };

    const realtime = {
      connect: () => () => undefined,
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

    expect(await screen.findByRole("heading", { level: 1, name: "Demo Session" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开会话抽屉" }));
    await user.click(screen.getByRole("button", { name: /Second Session/ }));

    expect(await screen.findByRole("heading", { level: 1, name: "Second Session" })).toBeInTheDocument();
    expect(screen.getByText("/workspace/second")).toBeInTheDocument();
    expect(screen.queryByText("这是之前的助手回答")).not.toBeInTheDocument();

    resolveSecondSnapshot?.(snapshotTwo);

    expect(await screen.findByText("第二个会话的问题")).toBeInTheDocument();
  });
});
