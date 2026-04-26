import { afterEach, describe, expect, it } from "vitest";

import { SqliteStore } from "./db.js";

describe("SqliteStore", () => {
  let store: SqliteStore | null = null;

  afterEach(() => {
    store?.close();
    store = null;
  });

  it("creates a session and returns a full snapshot", () => {
    store = new SqliteStore(":memory:");

    const session = store.createSession({
      title: "Bridge Demo",
      projectPath: "/workspace/demo",
    });
    const run = store.createRun({
      sessionId: session.id,
      prompt: "Inspect the repository",
    });

    store.appendEvent({
      sessionId: session.id,
      runId: run.id,
      type: "assistant_message",
      text: "I am inspecting the repository.",
      ts: "2026-04-18T10:00:01.000Z",
    });

    store.createApproval({
      sessionId: session.id,
      runId: run.id,
      scope: "network",
      reason: "Fetch package metadata",
      status: "pending",
      createdAt: "2026-04-18T10:00:02.000Z",
    });

    const snapshot = store.getSessionSnapshot(session.id);

    expect(snapshot.session.id).toBe(session.id);
    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.approvals).toHaveLength(1);
    expect(snapshot.events[0]?.type).toBe("assistant_message");
    expect(snapshot.approvals[0]?.status).toBe("pending");
  });
});
