import type { Session } from "@codex-remote/shared";

import { sessionStatusLabel } from "../copy.js";
import { compactPath } from "../format.js";

type SessionListProps = {
  selectedSessionId: string | null;
  sessions: Session[];
  onSelect: (sessionId: string) => void;
};

export function SessionList({
  selectedSessionId,
  sessions,
  onSelect,
}: SessionListProps) {
  if (sessions.length === 0) {
    return <p className="session-list__empty">还没有导入会话，先从上面的最近会话继续，或手动新建一个。</p>;
  }

  return (
    <div className="session-list">
      {sessions.map((session) => (
        <button
          key={session.id}
          className={`session-list__item${session.id === selectedSessionId ? " is-selected" : ""}`}
          onClick={() => onSelect(session.id)}
          type="button"
        >
          <div className="session-card__body">
            <strong className="session-card__title">{session.title}</strong>
            <span className="session-card__path">{compactPath(session.projectPath)}</span>
          </div>
          <span className={`session-card__badge is-${session.status}`}>
            {sessionStatusLabel(session.status)}
          </span>
        </button>
      ))}
    </div>
  );
}
