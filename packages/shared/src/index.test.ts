import { describe, expect, it } from "vitest";

import {
  approvalRequestSchema,
  remoteEventSchema,
  remoteMessageSchema,
  remoteRequestSchema,
  remoteResponseSchema,
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

  it("parses relay protocol request, response, and event envelopes", () => {
    const request = remoteRequestSchema.parse({
      v: 1,
      kind: "request",
      id: "msg_1",
      ns: "bridge",
      action: "send_message",
      ts: 1,
      payload: {
        sessionId: "session_1",
        text: "继续修复 UI",
      },
    });

    const response = remoteResponseSchema.parse({
      v: 1,
      kind: "response",
      id: request.id,
      ns: "bridge",
      action: request.action,
      ts: 2,
      ok: true,
      payload: {
        id: "run_1",
      },
    });

    const event = remoteEventSchema.parse({
      v: 1,
      kind: "event",
      id: "event_1",
      ns: "bridge",
      action: "timeline_event",
      ts: 3,
      payload: {
        sessionId: "session_1",
      },
    });

    expect(remoteMessageSchema.parse(request).kind).toBe("request");
    expect(remoteMessageSchema.parse(response).kind).toBe("response");
    expect(remoteMessageSchema.parse(event).kind).toBe("event");
  });
});
