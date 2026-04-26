import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TimelineEvent } from "@codex-remote/shared";

import { Timeline } from "./timeline.js";

describe("Timeline markdown rendering", () => {
  it("renders assistant markdown as formatted content while keeping user markdown literal", async () => {
    const events: TimelineEvent[] = [
      {
        id: "event_user_1",
        sessionId: "session_1",
        runId: "run_1",
        type: "user_message",
        text: "## 请把这个标题原样发给 Codex",
        ts: "2026-04-18T10:00:00.000Z",
      },
      {
        id: "event_assistant_1",
        sessionId: "session_1",
        runId: "run_1",
        type: "assistant_message",
        text:
          "# 调试结果\n\n- 第一项\n- 第二项\n\n```ts\nconst ready = true;\n```",
        ts: "2026-04-18T10:00:01.000Z",
      },
    ];

    render(
      <Timeline
        approvals={[]}
        events={events}
        onApproveOnce={vi.fn()}
        onApproveTurn={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("## 请把这个标题原样发给 Codex")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: "调试结果" })).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("const ready = true;")).toBeInTheDocument();
    expect(screen.queryByText("# 调试结果")).not.toBeInTheDocument();
  });
});
