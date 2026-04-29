import type { ApprovalRequest, TimelineEvent } from "@codex-remote/shared";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { timelineEventLabel, timelineEventText } from "../copy.js";
import { ApprovalCard } from "./approval-card.js";

type TimelineProps = {
  approvals: ApprovalRequest[];
  events: TimelineEvent[];
  mediaBaseUrl?: string;
  mediaToken?: string;
  onApproveOnce: (approvalId: string) => void;
  onApproveTurn: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
};

function transcriptEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.filter(
    (event) =>
      ["user_message", "assistant_message", "patch_summary", "system"].includes(
        event.type,
      ) && !isNoisySystemEvent(event, events),
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

function isNoisySystemEvent(event: TimelineEvent, events: TimelineEvent[]): boolean {
  if (event.type !== "system") {
    return false;
  }

  const text = event.text.trim();
  const hasLaterSuccessfulReply =
    text === "Codex exited with code 1" &&
    events
      .slice(events.findIndex((item) => item.id === event.id) + 1)
      .some((item) => item.type === "assistant_message");

  return (
    hasLaterSuccessfulReply ||
    text === "Reading additional input from stdin..." ||
    ["</div>", "</body>", "</html>"].includes(text) ||
    text.includes("codex_analytics::client: events failed") ||
    text.includes("codex_core_plugins::manifest: ignoring interface.defaultPrompt") ||
    text.includes("codex_core::session::turn: after_agent hook failed") ||
    text.includes("codex_core::session: failed to record rollout items") ||
    text.includes("codex_rmcp_client::stdio_server_launcher: Failed to terminate MCP process group") ||
    text.includes("rmcp::transport::worker: worker quit with fatal: Transport channel closed, when Auth(TokenRefreshFailed") ||
    text.includes("Forbidden: <html>") ||
    text.includes("challenge-platform/h/g/orchestrate") ||
    text.includes("_cf_chl_opt") ||
    text.includes("Enable JavaScript and cookies")
  );
}

function localImageProxyUrl(
  src: string | undefined,
  mediaBaseUrl: string | undefined,
  mediaToken: string | undefined,
): string | undefined {
  if (!src || !mediaBaseUrl || !mediaToken) {
    return src;
  }

  let filePath: string | null = null;
  if (src.startsWith("file://")) {
    try {
      filePath = decodeURIComponent(new URL(src).pathname);
    } catch {
      return src;
    }
  } else if (src.startsWith("/") && !src.startsWith("//")) {
    filePath = src;
  }

  if (!filePath) {
    return src;
  }

  const url = new URL("/api/local-image", mediaBaseUrl);
  url.searchParams.set("path", filePath);
  url.searchParams.set("token", mediaToken);
  return url.toString();
}

function MarkdownMessage({
  content,
  mediaBaseUrl,
  mediaToken,
}: {
  content: string;
  mediaBaseUrl?: string;
  mediaToken?: string;
}) {
  return (
    <div className="timeline-markdown">
      <ReactMarkdown
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} rel="noreferrer" target="_blank" />
          ),
          img: ({ node: _node, ...props }) => (
            <img
              {...props}
              loading="lazy"
              src={localImageProxyUrl(props.src, mediaBaseUrl, mediaToken)}
            />
          ),
        }}
        remarkPlugins={[remarkGfm]}
        urlTransform={(url, key) =>
          key === "src" && url.startsWith("file://")
            ? url
            : defaultUrlTransform(url)
        }
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function Timeline({
  approvals,
  events,
  mediaBaseUrl,
  mediaToken,
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
                  <MarkdownMessage
                    content={timelineEventText(event)}
                    mediaBaseUrl={mediaBaseUrl}
                    mediaToken={mediaToken}
                  />
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
