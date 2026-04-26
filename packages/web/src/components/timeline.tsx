import type { ApprovalRequest, TimelineEvent } from "@codex-remote/shared";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { timelineEventLabel, timelineEventText } from "../copy.js";
import { ApprovalCard } from "./approval-card.js";

type TimelineProps = {
  approvals: ApprovalRequest[];
  events: TimelineEvent[];
  onApproveOnce: (approvalId: string) => void;
  onApproveTurn: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
};

function transcriptEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.filter((event) =>
    ["user_message", "assistant_message", "patch_summary", "system"].includes(event.type),
  );
}

function latestActivityEvent(events: TimelineEvent[]): TimelineEvent | null {
  return (
    [...events]
      .reverse()
      .find((event) => event.type === "command" || event.type === "approval_required") ??
    null
  );
}

function shouldRenderMarkdown(event: TimelineEvent): boolean {
  return (
    event.type === "assistant_message" ||
    event.type === "patch_summary" ||
    event.type === "system"
  );
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="timeline-markdown">
      <ReactMarkdown
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} rel="noreferrer" target="_blank" />
          ),
        }}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function Timeline({
  approvals,
  events,
  onApproveOnce,
  onApproveTurn,
  onReject,
}: TimelineProps) {
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const transcript = transcriptEvents(events);
  const activityEvent = latestActivityEvent(events);

  if (pendingApprovals.length === 0 && transcript.length === 0 && !activityEvent) {
    return (
      <p className="timeline-empty">
        还没有输出。先从手机发一条任务，当前会话就会开始工作。
      </p>
    );
  }

  return (
    <>
      {pendingApprovals.map((approval) => (
        <ApprovalCard
          approval={approval}
          key={approval.id}
          onApproveOnce={onApproveOnce}
          onApproveTurn={onApproveTurn}
          onReject={onReject}
        />
      ))}

      {transcript.length > 0 ? (
        <div className="timeline-thread">
          {transcript.map((event) => (
            <article
              className={`timeline-message ${
                event.type === "user_message"
                  ? "is-user"
                  : event.type === "assistant_message"
                    ? "is-assistant"
                    : "is-meta"
              }`}
              key={event.id}
            >
              {event.type === "assistant_message" ? (
                <span aria-hidden="true" className="timeline-message__avatar">
                  C
                </span>
              ) : null}
              <div
                className={`timeline-bubble ${
                  event.type === "user_message"
                    ? "is-user"
                    : event.type === "assistant_message"
                      ? "is-assistant"
                      : "is-meta"
                }`}
              >
                {event.type === "user_message" || event.type === "assistant_message" ? null : (
                  <span className="timeline-bubble__label">{timelineEventLabel(event)}</span>
                )}
                {shouldRenderMarkdown(event) ? (
                  <MarkdownMessage content={timelineEventText(event)} />
                ) : (
                  <p>{timelineEventText(event)}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {transcript.length === 0 && activityEvent ? (
        <article
          className={`timeline-card timeline-card--${activityEvent.type}`}
          key={activityEvent.id}
        >
          <span className="timeline-card__type">{timelineEventLabel(activityEvent)}</span>
          <p>{timelineEventText(activityEvent)}</p>
        </article>
      ) : null}
    </>
  );
}
