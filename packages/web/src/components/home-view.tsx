import type { CodexSessionSummary } from "@codex-remote/shared";

import { compactPath, formatRelativeTime } from "../format.js";

type HomeViewProps = {
  error?: string | null;
  isLoading: boolean;
  onOpenThread: (threadId: string) => void;
  recentSessions: CodexSessionSummary[];
};

export function HomeView({
  error,
  isLoading,
  onOpenThread,
  recentSessions,
}: HomeViewProps) {
  return (
    <main className="home-view">
      <div className="home-view__heading">
        <p className="brand-kicker">Remote Workbench</p>
        <h2>最近任务</h2>
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      {isLoading ? (
        <p className="view-state">正在读取会话…</p>
      ) : recentSessions.length === 0 ? (
        <p className="view-state">没有可继续的 Codex 会话。</p>
      ) : (
        <div className="home-session-list">
          {recentSessions.map((session) => (
            <button
              className="home-session-row"
              key={session.threadId}
              onClick={() => onOpenThread(session.threadId)}
              type="button"
            >
              <span className="home-session-row__main">
                <strong>{session.title}</strong>
                <span>{compactPath(session.projectPath)}</span>
              </span>
              <span className="home-session-row__meta">
                {formatRelativeTime(session.updatedAt)}
                <span aria-hidden="true">›</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
