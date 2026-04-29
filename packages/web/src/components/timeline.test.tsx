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

  it("rewrites local screenshot image paths through the bridge image proxy", async () => {
    const events: TimelineEvent[] = [
      {
        id: "event_assistant_image_1",
        sessionId: "session_1",
        runId: "run_1",
        type: "assistant_message",
        text: "![界面截图](/var/folders/demo/screen.png)",
        ts: "2026-04-18T10:00:01.000Z",
      },
      {
        id: "event_assistant_image_2",
        sessionId: "session_1",
        runId: "run_1",
        type: "assistant_message",
        text: "![file 截图](file:///tmp/codex-preview.png)",
        ts: "2026-04-18T10:00:02.000Z",
      },
    ];

    render(
      <Timeline
        approvals={[]}
        events={events}
        mediaBaseUrl="https://bridge.example.test"
        mediaToken="bridge-secret"
        onApproveOnce={vi.fn()}
        onApproveTurn={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "界面截图" })).toHaveAttribute(
      "src",
      "https://bridge.example.test/api/local-image?path=%2Fvar%2Ffolders%2Fdemo%2Fscreen.png&token=bridge-secret",
    );
    expect(screen.getByRole("img", { name: "file 截图" })).toHaveAttribute(
      "src",
      "https://bridge.example.test/api/local-image?path=%2Ftmp%2Fcodex-preview.png&token=bridge-secret",
    );
  });

  it("hides non-actionable runtime noise already stored in history", async () => {
    const events: TimelineEvent[] = [
      {
        id: "event_noise_1",
        sessionId: "session_1",
        runId: "run_1",
        type: "system",
        text:
          "<script>a.src = '/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1?ray=9f32ba8f6faed789';</script>",
        ts: "2026-04-18T10:00:01.000Z",
      },
      {
        id: "event_noise_2",
        sessionId: "session_1",
        runId: "run_1",
        type: "system",
        text: "</html>",
        ts: "2026-04-18T10:00:02.000Z",
      },
      {
        id: "event_assistant_1",
        sessionId: "session_1",
        runId: "run_1",
        type: "assistant_message",
        text: "OK",
        ts: "2026-04-18T10:00:03.000Z",
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

    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("challenge-platform");
    expect(document.body).not.toHaveTextContent("</html>");
  });

  it("hides stale generic process exits after a later successful reply", async () => {
    const events: TimelineEvent[] = [
      {
        id: "event_user_1",
        sessionId: "session_1",
        runId: "run_1",
        type: "user_message",
        text: "修完了吗",
        ts: "2026-04-18T10:00:00.000Z",
      },
      {
        id: "event_exit_1",
        sessionId: "session_1",
        runId: "run_1",
        type: "system",
        text: "Codex exited with code 1",
        ts: "2026-04-18T10:00:01.000Z",
      },
      {
        id: "event_user_2",
        sessionId: "session_1",
        runId: "run_2",
        type: "user_message",
        text: "再试一次",
        ts: "2026-04-18T10:00:02.000Z",
      },
      {
        id: "event_assistant_2",
        sessionId: "session_1",
        runId: "run_2",
        type: "assistant_message",
        text: "OK",
        ts: "2026-04-18T10:00:03.000Z",
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

    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Codex exited with code 1");
  });

  it("renders generic process exits as actionable Chinese copy", async () => {
    const events: TimelineEvent[] = [
      {
        id: "event_exit_1",
        sessionId: "session_1",
        runId: "run_1",
        type: "system",
        text: "Codex exited with code 1",
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

    expect(
      screen.getByText("Codex 本次没有返回回复，通常是额度、登录或网络限制导致。请稍后重试，或切换/重新登录 Codex 账号。"),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Codex exited with code 1");
  });
});
