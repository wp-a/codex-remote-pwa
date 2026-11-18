import { Copy, QrCode, X } from "lucide-react";
import { useEffect, useRef, type FormEvent } from "react";

import type { BridgeHealth } from "../api.js";
import type { ConnectionMode } from "../session-preferences.js";
import { AccessQr } from "./access-qr.js";

export type AccessLink = {
  kind: "current" | "lan" | "local" | "tailscale";
  label: string;
  url: string;
};

type SettingsSheetProps = {
  accessLinks: AccessLink[];
  baseUrl: string;
  connectionMode: ConnectionMode;
  copyFeedback?: string | null;
  health: BridgeHealth | null;
  newProjectPath: string;
  newTitle: string;
  onBaseUrlChange: (value: string) => void;
  onClose: () => void;
  onCopyLink: (link: string) => void;
  onCreateSession: (event: FormEvent<HTMLFormElement>) => void;
  onNewProjectPathChange: (value: string) => void;
  onNewTitleChange: (value: string) => void;
  onSaveConnection: (event: FormEvent<HTMLFormElement>) => void;
  onTokenChange: (value: string) => void;
  open: boolean;
  token: string;
};

const accessKindLabels: Record<AccessLink["kind"], string> = {
  current: "当前连接",
  lan: "局域网",
  local: "本机",
  tailscale: "Tailscale",
};

function preferredAccessLink(accessLinks: AccessLink[]): AccessLink | null {
  for (const kind of ["tailscale", "lan", "local", "current"] as const) {
    const match = accessLinks.find((link) => link.kind === kind);
    if (match) {
      return match;
    }
  }

  return null;
}

export function SettingsSheet({
  accessLinks,
  baseUrl,
  connectionMode,
  copyFeedback,
  health,
  newProjectPath,
  newTitle,
  onBaseUrlChange,
  onClose,
  onCopyLink,
  onCreateSession,
  onNewProjectPathChange,
  onNewTitleChange,
  onSaveConnection,
  onTokenChange,
  open,
  token,
}: SettingsSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousFocus = document.activeElement;
    closeButtonRef.current?.focus();
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

  const isHealthy = Boolean(health?.ok);
  const primaryLink = preferredAccessLink(accessLinks);

  return (
    <div className="sheet-layer">
      <button
        aria-label="关闭设置"
        className="sheet-backdrop"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label="设置"
        aria-modal="true"
        className="sheet settings-sheet"
        role="dialog"
      >
        <div className="sheet__header">
          <div>
            <p className="brand-kicker">System</p>
            <h2>设置</h2>
          </div>
          <button
            aria-label="关闭设置"
            className="icon-button"
            onClick={onClose}
            ref={closeButtonRef}
            title="关闭"
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>

        <section className={`health-strip${isHealthy ? " is-healthy" : " is-warning"}`}>
          <span aria-hidden="true" className="health-strip__dot" />
          <div>
            <strong>{isHealthy ? "运行正常" : "连接待检查"}</strong>
            <span>
              {health
                ? `${health.runtimeMode} · ${health.canSendMessages ? "可发送任务" : "只读"}`
                : "尚未获得运行状态"}
            </span>
          </div>
        </section>

        {primaryLink ? (
          <section className="settings-section access-section">
            <div className="settings-section__heading">
              <div>
                <h3>手机访问</h3>
                <p>{accessLinks.length > 1 ? `${accessLinks.length} 个可用地址` : "当前可用地址"}</p>
              </div>
              <QrCode aria-hidden="true" size={20} />
            </div>
            <AccessQr url={primaryLink.url} />
            <div className="access-link-list">
              {accessLinks.map((link) => (
                <div className="access-link-row" key={`${link.kind}:${link.url}`}>
                  <div className="access-link-row__content">
                    <div className="access-link-row__labels">
                      <strong>{accessKindLabels[link.kind]}</strong>
                      <span>{link.label}</span>
                    </div>
                    <input aria-label={`${accessKindLabels[link.kind]}访问链接`} readOnly value={link.url} />
                  </div>
                  <button
                    aria-label="复制访问链接"
                    className="icon-button"
                    onClick={() => onCopyLink(link.url)}
                    title="复制访问链接"
                    type="button"
                  >
                    <Copy aria-hidden="true" size={18} />
                  </button>
                </div>
              ))}
            </div>
            {copyFeedback ? <p className="inline-feedback">{copyFeedback}</p> : null}
          </section>
        ) : null}

        <details className="settings-disclosure" open={!isHealthy}>
          <summary>
            <span>高级连接</span>
            <span>{connectionMode === "relay" ? "Relay" : "Direct"}</span>
          </summary>
          <form className="settings-form" onSubmit={onSaveConnection}>
            <label>
              <span>{connectionMode === "relay" ? "Relay 地址" : "服务器地址"}</span>
              <input
                aria-label={connectionMode === "relay" ? "Relay 地址" : "服务器地址"}
                onChange={(event) => onBaseUrlChange(event.target.value)}
                value={baseUrl}
              />
            </label>
            <label>
              <span>{connectionMode === "relay" ? "配对码" : "连接密码"}</span>
              <input
                aria-label={connectionMode === "relay" ? "配对码" : "连接密码"}
                onChange={(event) => onTokenChange(event.target.value)}
                type="password"
                value={token}
              />
            </label>
            <button className="button-primary" type="submit">保存连接</button>
          </form>
        </details>

        <details className="settings-disclosure">
          <summary>
            <span>从路径新建</span>
            <span>Manual</span>
          </summary>
          <form className="settings-form" onSubmit={onCreateSession}>
            <label>
              <span>会话名称</span>
              <input
                aria-label="会话名称"
                onChange={(event) => onNewTitleChange(event.target.value)}
                value={newTitle}
              />
            </label>
            <label>
              <span>项目路径</span>
              <input
                aria-label="项目路径"
                onChange={(event) => onNewProjectPathChange(event.target.value)}
                placeholder="/Users/you/project"
                value={newProjectPath}
              />
            </label>
            <button className="button-primary" type="submit">创建会话</button>
          </form>
        </details>

        <section className="runtime-diagnostics">
          <h3>运行诊断</h3>
          <dl>
            <div><dt>通道</dt><dd>{connectionMode === "relay" ? "Relay" : "本机直连"}</dd></div>
            <div><dt>Runtime</dt><dd>{health?.runtimeMode ?? "unknown"}</dd></div>
            <div><dt>权限</dt><dd>{health?.canSendMessages ? "读写" : "只读"}</dd></div>
          </dl>
        </section>
      </aside>
    </div>
  );
}
