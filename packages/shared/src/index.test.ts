import { describe, expect, it } from "vitest";

import {
  approvalRequestSchema,
  sessionSchema,
  sessionSnapshotSchema,
  timelineEventSchema,
} from "./index.js";

describe("shared schemas", () => {
  it("parses the core session snapshot shape", () => {
    const session = sessionSchema.parse({
      id: "session_1",
      title: "Demo",
      projectPath: "/workspace/demo",
      status: "idle",
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
      lastRunId: null,
      runtimeThreadId: null,
    });

    const event = timelineEventSchema.parse({
      id: "event_1",
      sessionId: session.id,
      runId: "run_1",
      type: "assistant_message",
      text: "Ready.",
      ts: "2026-04-18T10:00:01.000Z",
    });

    const approval = approvalRequestSchema.parse({
      id: "approval_1",
      sessionId: session.id,
      runId: "run_1",
      scope: "network",
      reason: "Needs network access",
      status: "pending",
      createdAt: "2026-04-18T10:00:02.000Z",
    });

    const snapshot = sessionSnapshotSchema.parse({
      session,
      runs: [],
      events: [event],
      approvals: [approval],
    });

    expect(snapshot.events[0]?.type).toBe("assistant_message");
    expect(snapshot.approvals[0]?.status).toBe("pending");
  });
});
