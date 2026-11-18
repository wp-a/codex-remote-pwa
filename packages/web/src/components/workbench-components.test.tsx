import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CodexSessionSummary, Session } from "@codex-remote/shared";

import { AppHeader } from "./app-header.js";
import { HomeView } from "./home-view.js";
import { SessionPicker } from "./session-picker.js";
import { SettingsSheet } from "./settings-sheet.js";

const saved: Session = {
  id: "saved_1",
  title: "Saved release task",
  projectPath: "/workspace/release",
  status: "idle",
  createdAt: "2026-07-18T09:00:00.000Z",
  updatedAt: "2026-07-18T10:00:00.000Z",
  runtimeThreadId: "thread_saved",
};

const recent: CodexSessionSummary = {
  threadId: "thread_recent",
  title: "Recent mobile polish",
  projectPath: "/workspace/mobile",
  updatedAt: "2026-07-18T11:00:00.000Z",
  importedSessionId: null,
};

describe("workbench components", () => {
  it("shows recent native threads on Home without requiring a picker", async () => {
    const onOpenThread = vi.fn();
    render(
      <HomeView
        isLoading={false}
        onOpenThread={onOpenThread}
        recentSessions={[recent]}
      />,
    );

    expect(screen.getByRole("heading", { name: "最近任务" })).toBeInTheDocument();
    await userEvent.setup().click(
      screen.getByRole("button", { name: /Recent mobile polish/ }),
    );
    expect(onOpenThread).toHaveBeenCalledWith("thread_recent");
  });

  it("keeps recent and saved sessions in distinct searchable picker tabs", async () => {
    const user = userEvent.setup();
    render(
      <SessionPicker
        codexSessions={[recent]}
        onClose={() => undefined}
        onOpenCodexSession={() => undefined}
        onSelectSession={() => undefined}
        open
        selectedSessionId={saved.id}
        sessions={[saved]}
      />,
    );

    expect(screen.getByRole("dialog", { name: "选择会话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Recent mobile polish/ })).toBeInTheDocument();
    expect(screen.queryByText("Saved release task")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "已保存" }));
    expect(screen.getByRole("button", { name: /Saved release task/ })).toBeInTheDocument();
    expect(screen.queryByText("Recent mobile polish")).not.toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "搜索会话" }), "missing");
    expect(screen.getByText("没有匹配的会话")).toBeInTheDocument();
  });

  it("treats the picker as modal, focuses search, and closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <SessionPicker
        codexSessions={[recent]}
        onClose={onClose}
        onOpenCodexSession={() => undefined}
        onSelectSession={() => undefined}
        open
        selectedSessionId={null}
        sessions={[]}
      />,
    );

    expect(screen.getByRole("dialog", { name: "选择会话" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    await waitFor(() => {
      expect(screen.getByRole("searchbox", { name: "搜索会话" })).toHaveFocus();
    });
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps connection and runtime controls in Settings, not the picker", () => {
    render(
      <SettingsSheet
        accessLinks={[
          {
            kind: "lan",
            label: "Wi-Fi",
            url: "http://192.168.1.20:8790/?token=secret",
          },
          {
            kind: "tailscale",
            label: "Tailnet",
            url: "https://mac.example.ts.net/?token=secret",
          },
        ]}
        baseUrl="https://bridge.example.test"
        connectionMode="direct"
        health={{
          ok: true,
          runtimeMode: "app-server",
          canSendMessages: true,
        }}
        newProjectPath=""
        newTitle=""
        onBaseUrlChange={() => undefined}
        onClose={() => undefined}
        onCopyLink={() => undefined}
        onCreateSession={() => undefined}
        onNewProjectPathChange={() => undefined}
        onNewTitleChange={() => undefined}
        onSaveConnection={() => undefined}
        onTokenChange={() => undefined}
        open
        token="secret"
      />,
    );

    expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByText("运行正常")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "复制访问链接" })).toHaveLength(2);
    expect(screen.getByDisplayValue(
      "https://mac.example.ts.net/?token=secret",
    )).toBeInTheDocument();
    expect(screen.getByText("高级连接").closest("details")).not.toHaveAttribute("open");
  });

  it("treats Settings as modal, focuses Close, and closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <SettingsSheet
        accessLinks={[]}
        baseUrl="https://bridge.example.test"
        connectionMode="direct"
        health={null}
        newProjectPath=""
        newTitle=""
        onBaseUrlChange={() => undefined}
        onClose={onClose}
        onCopyLink={() => undefined}
        onCreateSession={() => undefined}
        onNewProjectPathChange={() => undefined}
        onNewTitleChange={() => undefined}
        onSaveConnection={() => undefined}
        onTokenChange={() => undefined}
        open
        token="secret"
      />,
    );

    expect(screen.getByRole("dialog", { name: "设置" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "关闭设置" })[1]).toHaveFocus();
    });
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uses one compact title source and only exposes Stop while running", async () => {
    const onStop = vi.fn();
    const { rerender } = render(
      <AppHeader
        connectionLabel="在线"
        onOpenSessions={() => undefined}
        onOpenSettings={() => undefined}
        onStop={onStop}
        path="/workspace/release"
        status="idle"
        statusLabel="空闲"
        title="Saved release task"
      />,
    );

    expect(screen.getAllByRole("heading", { name: "Saved release task" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "停止任务" })).not.toBeInTheDocument();

    rerender(
      <AppHeader
        connectionLabel="在线"
        onOpenSessions={() => undefined}
        onOpenSettings={() => undefined}
        onStop={onStop}
        path="/workspace/release"
        status="running"
        statusLabel="运行中"
        title="Saved release task"
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "停止任务" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("does not repeat the connection label when no project path is active", () => {
    render(
      <AppHeader
        connectionLabel="在线"
        onOpenSessions={() => undefined}
        onOpenSettings={() => undefined}
        onStop={() => undefined}
        status="idle"
        statusLabel="在线"
        title="Remote Workbench"
      />,
    );

    expect(screen.getAllByText("在线")).toHaveLength(1);
  });
});
