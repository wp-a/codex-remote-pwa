import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodexSessionSummary, Session, SessionSnapshot } from "@codex-remote/shared";

import { App } from "./app.js";
import { selectionStorageKey } from "./session-preferences.js";

const firstSession: Session = {
  id: "session_first",
  title: "First saved task",
  projectPath: "/workspace/first",
  status: "idle",
  createdAt: "2026-07-18T09:00:00.000Z",
  updatedAt: "2026-07-18T09:00:00.000Z",
  runtimeThreadId: "thread_first",
};

const restoredSession: Session = {
  ...firstSession,
  id: "session_restored",
  title: "Restored task",
  projectPath: "/workspace/restored",
  runtimeThreadId: "thread_restored",
};

const nativeSession: CodexSessionSummary = {
  threadId: "thread_native",
  title: "Native task from Codex",
  projectPath: "/workspace/native",
  updatedAt: "2026-07-18T11:00:00.000Z",
  importedSessionId: null,
};

function snapshot(session: Session): SessionSnapshot {
  return { session, approvals: [], events: [], runs: [] };
}

function clientWith(options: {
  codexSessions?: CodexSessionSummary[];
  sessions?: Session[];
  importCodexSession?: (threadId: string) => Promise<Session>;
}) {
  return {
    getHealth: async () => ({
      ok: true,
      runtimeMode: "app-server" as const,
      canSendMessages: true,
    }),
    listSessions: async () => options.sessions ?? [],
    listCodexSessions: async () => options.codexSessions ?? [],
    createSession: async () => firstSession,
    importCodexSession:
      options.importCodexSession ?? (async () => restoredSession),
    getSnapshot: async (sessionId: string) =>
      snapshot(
        [firstSession, restoredSession].find((session) => session.id === sessionId) ??
          restoredSession,
      ),
    sendMessage: async () => ({ id: "run_1" }),
    interrupt: async () => ({ interrupted: false }),
    approveOnce: async () => undefined,
    approveTurn: async () => undefined,
    rejectApproval: async () => undefined,
  };
}

const realtime = { connect: () => () => undefined };

afterEach(() => {
  window.localStorage.clear();
});

describe("App V2 navigation", () => {
  it("restores the last valid bridge session for this connection", async () => {
    const key = selectionStorageKey("direct", "https://bridge.example.test");
    window.localStorage.setItem(key, restoredSession.id);
    const getSnapshot = vi.fn(async (sessionId: string) =>
      snapshot(sessionId === restoredSession.id ? restoredSession : firstSession),
    );
    const client = {
      ...clientWith({ sessions: [firstSession, restoredSession] }),
      getSnapshot,
    };

    render(
      <App
        client={client}
        initialBaseUrl="https://bridge.example.test"
        initialToken="secret"
        onSaveConnection={() => undefined}
        realtime={realtime}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Restored task" })).toBeInTheDocument();
    expect(getSnapshot).toHaveBeenCalledWith(restoredSession.id);
  });

  it("shows native tasks directly on Home and imports only after selection", async () => {
    const importCodexSession = vi.fn(async () => restoredSession);
    render(
      <App
        client={clientWith({
          codexSessions: [nativeSession],
          importCodexSession,
          sessions: [],
        })}
        initialBaseUrl="https://bridge.example.test"
        initialToken="secret"
        onSaveConnection={() => undefined}
        realtime={realtime}
      />,
    );

    expect(await screen.findByRole("heading", { name: "最近任务" })).toBeInTheDocument();
    expect(importCodexSession).not.toHaveBeenCalled();

    await userEvent.setup().click(
      screen.getByRole("button", { name: /Native task from Codex/ }),
    );

    await waitFor(() => expect(importCodexSession).toHaveBeenCalledWith("thread_native"));
    expect(await screen.findByRole("heading", { name: "Restored task" })).toBeInTheDocument();
    expect(window.localStorage.getItem(
      selectionStorageKey("direct", "https://bridge.example.test"),
    )).toBe(restoredSession.id);
  });
});
