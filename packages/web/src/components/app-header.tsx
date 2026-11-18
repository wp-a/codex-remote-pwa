import { PanelLeft, Settings, Square } from "lucide-react";

import type { Session } from "@codex-remote/shared";

type AppHeaderProps = {
  connectionLabel: string;
  isStopping?: boolean;
  onOpenSessions: () => void;
  onOpenSettings: () => void;
  onStop: () => void;
  path?: string;
  status: Session["status"];
  statusLabel: string;
  title: string;
};

export function AppHeader({
  connectionLabel,
  isStopping = false,
  onOpenSessions,
  onOpenSettings,
  onStop,
  path,
  status,
  statusLabel,
  title,
}: AppHeaderProps) {
  const isRunning = status === "running" || status === "blocked_approval";

  return (
    <header className="app-header">
      <button
        aria-label="选择会话"
        className="icon-button app-header__sessions"
        onClick={onOpenSessions}
        title="选择会话"
        type="button"
      >
        <PanelLeft aria-hidden="true" size={20} strokeWidth={1.8} />
      </button>

      <div className="app-header__identity">
        <div className="app-header__title-row">
          <h1>{title}</h1>
          <span className={`status-pill is-${status}`}>
            <span aria-hidden="true" className="status-pill__dot" />
            {statusLabel}
          </span>
        </div>
        {path ? <p title={path}>{`${path} · ${connectionLabel}`}</p> : null}
      </div>

      <div className="app-header__actions">
        {isRunning ? (
          <button
            aria-label="停止任务"
            className="icon-button icon-button--danger"
            disabled={isStopping}
            onClick={onStop}
            title={isStopping ? "正在停止" : "停止任务"}
            type="button"
          >
            <Square aria-hidden="true" fill="currentColor" size={16} strokeWidth={2} />
          </button>
        ) : null}
        <button
          aria-label="打开设置"
          className="icon-button"
          onClick={onOpenSettings}
          title="打开设置"
          type="button"
        >
          <Settings aria-hidden="true" size={20} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}
