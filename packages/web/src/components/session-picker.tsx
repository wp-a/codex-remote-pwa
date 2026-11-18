import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CodexSessionSummary, Session } from "@codex-remote/shared";

import { sessionStatusLabel } from "../copy.js";
import { compactPath, formatRelativeTime } from "../format.js";

type SessionPickerProps = {
  codexSessions: CodexSessionSummary[];
  onClose: () => void;
  onOpenCodexSession: (threadId: string) => void;
  onSelectSession: (sessionId: string) => void;
  open: boolean;
  selectedSessionId: string | null;
  sessions: Session[];
};

export function SessionPicker({
  codexSessions,
  onClose,
  onOpenCodexSession,
  onSelectSession,
  open,
  selectedSessionId,
  sessions,
}: SessionPickerProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [tab, setTab] = useState<"recent" | "saved">("recent");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRecents = useMemo(
    () =>
      codexSessions.filter((session) =>
        `${session.title} ${session.projectPath}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      ),
    [codexSessions, normalizedQuery],
  );
  const filteredSaved = useMemo(
    () =>
      sessions.filter((session) =>
        `${session.title} ${session.projectPath}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      ),
    [sessions, normalizedQuery],
  );
  const isEmpty =
    tab === "recent" ? filteredRecents.length === 0 : filteredSaved.length === 0;

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousFocus = document.activeElement;
    searchInputRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (previousFocus instanceof HTMLElement) {
        previousFocus.focus();
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="sheet-layer">
      <button
        aria-label="关闭会话选择"
        className="sheet-backdrop"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label="选择会话"
        aria-modal="true"
        className="sheet session-picker"
        role="dialog"
      >
        <div className="sheet__header">
          <div>
            <p className="brand-kicker">Workspaces</p>
            <h2>选择会话</h2>
          </div>
          <button
            aria-label="关闭会话选择"
            className="icon-button"
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>

        <div aria-label="会话来源" className="segmented-control" role="tablist">
          <button
            aria-selected={tab === "recent"}
            onClick={() => setTab("recent")}
            role="tab"
            type="button"
          >
            最近
          </button>
          <button
            aria-label="已保存"
            aria-selected={tab === "saved"}
            onClick={() => setTab("saved")}
            role="tab"
            type="button"
          >
            已保存
            <span>{sessions.length}</span>
          </button>
        </div>

        <label className="search-field">
          <Search aria-hidden="true" size={18} />
          <span className="sr-only">搜索会话</span>
          <input
            aria-label="搜索会话"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称或路径"
            ref={searchInputRef}
            type="search"
            value={query}
          />
        </label>

        <div className="picker-list">
          {tab === "recent"
            ? filteredRecents.map((session) => (
                <button
                  className="picker-row"
                  key={session.threadId}
                  onClick={() => onOpenCodexSession(session.threadId)}
                  type="button"
                >
                  <span className="picker-row__main">
                    <strong>{session.title}</strong>
                    <span>{compactPath(session.projectPath)}</span>
                  </span>
                  <span className="picker-row__meta">
                    {session.importedSessionId ? "已保存" : formatRelativeTime(session.updatedAt)}
                  </span>
                </button>
              ))
            : filteredSaved.map((session) => (
                <button
                  className={`picker-row${session.id === selectedSessionId ? " is-selected" : ""}`}
                  key={session.id}
                  onClick={() => onSelectSession(session.id)}
                  type="button"
                >
                  <span className="picker-row__main">
                    <strong>{session.title}</strong>
                    <span>{compactPath(session.projectPath)}</span>
                  </span>
                  <span className={`picker-row__status is-${session.status}`}>
                    {sessionStatusLabel(session.status)}
                  </span>
                </button>
              ))}
          {isEmpty ? <p className="picker-list__empty">没有匹配的会话</p> : null}
        </div>
      </aside>
    </div>
  );
}
