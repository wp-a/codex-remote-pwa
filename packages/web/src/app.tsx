import { useEffect, useRef, useState, type FormEvent } from "react";

import type {
  CodexSessionSummary,
  Session,
  SessionSnapshot,
} from "@codex-remote/shared";

import type { ApiClient, BridgeHealth } from "./api.js";
import { Composer } from "./components/composer.js";
import { SessionList } from "./components/session-list.js";
import { Timeline } from "./components/timeline.js";
import {
  LOCAL_DEV_TOKEN,
  buildConnectionLink,
  inferDefaultConnectionToken,
} from "./connection.js";
import { sessionStatusLabel } from "./copy.js";
import { compactPath, formatRelativeTime } from "./format.js";
import type { RealtimeClient } from "./realtime.js";

type AppProps = {
  client: ApiClient;
  initialBaseUrl: string;
  initialToken: string;
  onSaveConnection: (input: { baseUrl: string; token: string }) => void;
  realtime: RealtimeClient;
};

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes("HTTP 401")) {
      return "连接密码缺失或无效，请在左侧抽屉里重新保存连接。";
    }

    return error.message;
  }

  return "发生了未预期错误";
}

export function App({
  client,
  initialBaseUrl,
  initialToken,
  onSaveConnection,
  realtime,
}: AppProps) {
  const defaultToken =
    inferDefaultConnectionToken(initialBaseUrl, window.location.origin) ?? "";
  const [sessions, setSessions] = useState<Session[]>([]);
  const [codexSessions, setCodexSessions] = useState<CodexSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newProjectPath, setNewProjectPath] = useState("");
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [token, setToken] = useState(
    initialToken === "change-me" ? defaultToken : initialToken,
  );
  const [shareLinkFeedback, setShareLinkFeedback] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isInterrupting, setIsInterrupting] = useState(false);
  const [runtimeCapability, setRuntimeCapability] = useState<{
    runtimeMode: BridgeHealth["runtimeMode"] | "unknown";
    canSendMessages: boolean;
  }>({
    runtimeMode: "unknown",
    canSendMessages: true,
  });
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(
    (!initialToken || initialToken === "change-me") && !defaultToken
      ? "还没有连接密码，请先在左侧抽屉里保存连接。"
      : null,
  );

  function applySnapshot(nextSnapshot: SessionSnapshot) {
    setSnapshot(nextSnapshot);
    setSessions((current) =>
      current.map((session) =>
        session.id === nextSnapshot.session.id ? nextSnapshot.session : session,
      ),
    );
  }

  useEffect(() => {
    setShareLinkFeedback(null);
  }, [baseUrl, token]);

  useEffect(() => {
    if (!shareLinkFeedback) {
      return;
    }

    const timer = window.setTimeout(() => {
      setShareLinkFeedback(null);
    }, 2200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [shareLinkFeedback]);

  useEffect(() => {
    let cancelled = false;

    client
      .getHealth?.()
      .then((health) => {
        if (!cancelled) {
          setRuntimeCapability({
            runtimeMode: health.runtimeMode,
            canSendMessages: health.canSendMessages,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeCapability({
            runtimeMode: "unknown",
            canSendMessages: true,
          });
        }
      });

    client
      .listSessions()
      .then((nextSessions) => {
        if (cancelled) {
          return;
        }

        setError(null);
        setSessions(nextSessions);
        setSelectedSessionId((current) => current ?? nextSessions[0]?.id ?? null);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(describeError(nextError));
        }
      });

    client
      .listCodexSessions()
      .then((nextSessions) => {
        if (!cancelled) {
          setCodexSessions(nextSessions);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(describeError(nextError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    client
      .getSnapshot(selectedSessionId)
      .then((nextSnapshot) => {
        if (!cancelled) {
          setError(null);
          applySnapshot(nextSnapshot);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(describeError(nextError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    return realtime.connect(selectedSessionId, (event) => {
      setSnapshot((current) => {
        if (!current || current.session.id !== selectedSessionId) {
          return current;
        }

        return {
          ...current,
          events: [...current.events, event],
        };
      });
    });
  }, [realtime, selectedSessionId]);

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedSessionId ||
      !message.trim() ||
      isSessionBusy ||
      !runtimeCapability.canSendMessages
    ) {
      return;
    }

    const text = message.trim();
    setMessage("");
    try {
      await client.sendMessage(selectedSessionId, text);
      setError(null);
    } catch (nextError) {
      setMessage(text);
      setError(describeError(nextError));
    }
  }

  async function interruptActiveSession() {
    if (!selectedSessionId || !canInterrupt) {
      return;
    }

    setIsInterrupting(true);
    try {
      const result = await client.interrupt(selectedSessionId);
      if (!result.interrupted) {
        setError("当前会话没有可中断的任务。");
        return;
      }

      const nextSnapshot = await client.getSnapshot(selectedSessionId);
      applySnapshot(nextSnapshot);
      setError(null);
    } catch (nextError) {
      setError(describeError(nextError));
    } finally {
      setIsInterrupting(false);
    }
  }

  async function submitSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTitle.trim() || !newProjectPath.trim()) {
      return;
    }

    try {
      const session = await client.createSession({
        title: newTitle.trim(),
        projectPath: newProjectPath.trim(),
      });

      setError(null);
      setSessions((current) => [...current, session]);
      setSelectedSessionId(session.id);
      setNewTitle("");
      setNewProjectPath("");
      setIsDrawerOpen(false);
    } catch (nextError) {
      setError(describeError(nextError));
    }
  }

  async function importCodexSession(threadId: string) {
    try {
      const session = await client.importCodexSession(threadId);
      setError(null);
      setSessions((current) => {
        const existing = current.find((item) => item.id === session.id);
        if (existing) {
          return current.map((item) => (item.id === session.id ? session : item));
        }

        return [session, ...current];
      });
      setCodexSessions((current) =>
        current.map((item) =>
          item.threadId === threadId
            ? { ...item, importedSessionId: session.id }
            : item,
        ),
      );
      setSelectedSessionId(session.id);
      setIsDrawerOpen(false);
    } catch (nextError) {
      setError(describeError(nextError));
    }
  }

  async function handleApprovalAction(
    approvalId: string,
    action: "once" | "turn" | "reject",
  ) {
    if (action === "once") {
      await client.approveOnce(approvalId);
    } else if (action === "turn") {
      await client.approveTurn(approvalId);
    } else {
      await client.rejectApproval(approvalId);
    }

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        approvals: current.approvals.map((approval) =>
          approval.id === approvalId
            ? {
                ...approval,
                status:
                  action === "once"
                    ? "approved_once"
                    : action === "turn"
                      ? "approved_turn"
                      : "rejected",
              }
            : approval,
        ),
      };
    });
  }

  function submitConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!baseUrl.trim()) {
      setError("服务器地址要填写。");
      return;
    }

    const nextToken =
      token.trim() ||
      inferDefaultConnectionToken(baseUrl.trim(), window.location.origin);
    if (!nextToken) {
      setError("这不是演示环境，请填写连接密码。");
      return;
    }

    setError(null);
    onSaveConnection({
      baseUrl: baseUrl.trim(),
      token: nextToken,
    });
    setIsDrawerOpen(false);
  }

  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? null;
  const activeSnapshot =
    snapshot && snapshot.session.id === selectedSessionId ? snapshot : null;
  const activeSession = activeSnapshot?.session ?? selectedSession;
  const recentCodexSessions = codexSessions.slice(0, 6);
  const effectiveToken =
    token.trim() ||
    inferDefaultConnectionToken(baseUrl.trim(), window.location.origin) ||
    "";
  const isLocalOnly =
    runtimeCapability.runtimeMode === "local-only" ||
    !runtimeCapability.canSendMessages;
  const connectionState = isLocalOnly
    ? "本地只读"
    : error
      ? "待处理"
      : effectiveToken
        ? "在线"
        : "未配置";
  const activeStatus = activeSession?.status ?? (error ? "error" : "idle");
  const shareLink = buildConnectionLink(
    baseUrl.trim(),
    effectiveToken,
    window.location.origin,
  );
  const activeStatusLabel = activeSession
    ? sessionStatusLabel(activeSession.status)
    : error
      ? "待处理"
      : connectionState;
  const isSessionBusy =
    activeSession?.status === "running" ||
    activeSession?.status === "blocked_approval";
  const canInterrupt = Boolean(activeSession && isSessionBusy);
  const composerHint = !activeSession
    ? "先从左上角选择一个会话"
    : isLocalOnly
      ? "本地只读模式：可以查看历史和截图，不能发送新任务。"
    : isSessionBusy
      ? activeSession.status === "blocked_approval"
        ? "当前任务正在等待授权，请先处理授权或中断。"
        : "当前任务还在运行，请先中断。"
      : "继续当前会话";
  const activePath = activeSession?.projectPath
    ? compactPath(activeSession.projectPath)
    : "从左上角打开会话列表，继续最近的 Codex 会话";
  const timelineCount = activeSnapshot?.events.length ?? 0;
  const pendingApprovalCount =
    activeSnapshot?.approvals.filter((approval) => approval.status === "pending")
      .length ?? 0;
  const lastActivityLabel = activeSession?.updatedAt
    ? formatRelativeTime(activeSession.updatedAt)
    : "等待选择";

  useEffect(() => {
    if (!selectedSessionId || !isSessionBusy) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      client
        .getSnapshot(selectedSessionId)
        .then((nextSnapshot) => {
          if (!cancelled) {
            applySnapshot(nextSnapshot);
            setError(null);
          }
        })
        .catch((nextError) => {
          if (!cancelled) {
            setError(describeError(nextError));
          }
        });
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [client, selectedSessionId, isSessionBusy]);

  useEffect(() => {
    if (!activeSnapshot) {
      return;
    }

    const timelineEnd = timelineEndRef.current;
    if (typeof timelineEnd?.scrollIntoView !== "function") {
      return;
    }

    timelineEnd.scrollIntoView({
      block: "end",
      behavior: "auto",
    });
  }, [activeSnapshot, pendingApprovalCount, timelineCount]);

  async function copyShareLink() {
    if (!shareLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareLink);
      setShareLinkFeedback("已复制");
    } catch {
      setShareLinkFeedback("复制失败，请长按输入框手动复制");
    }
  }

  return (
    <div className="app-shell">
      {isDrawerOpen ? (
        <>
          <button
            aria-label="点击遮罩关闭抽屉"
            className="drawer-backdrop"
            onClick={() => setIsDrawerOpen(false)}
            type="button"
          />
          <aside
            aria-label="会话抽屉"
            aria-modal="true"
            className="session-drawer"
            role="dialog"
          >
            <div className="session-drawer__inner">
              <div className="session-drawer__header">
                <div>
                  <p className="eyebrow">Codex Remote</p>
                  <strong>会话切换</strong>
                </div>
                <button
                  aria-label="关闭会话抽屉"
                  className="session-drawer__close"
                  onClick={() => setIsDrawerOpen(false)}
                  type="button"
                >
                  关闭
                </button>
              </div>

              <section className="surface-card surface-card--hero drawer-current">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">当前会话</p>
                    <h2>{activeSession?.title ?? "还没有选中会话"}</h2>
                  </div>
                  <span className={`session-card__badge is-${activeStatus}`}>
                    {activeStatusLabel}
                  </span>
                </div>
                <p className="session-column__lede">{activePath}</p>
                {activeSession?.runtimeThreadId ? (
                  <div className="drawer-current__meta">
                    <span className="meta-chip">已连接 Codex</span>
                  </div>
                ) : null}
              </section>

              {recentCodexSessions.length > 0 ? (
                <section className="surface-card">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">最近的 Codex</p>
                      <h2>继续已有会话</h2>
                    </div>
                    <span className="section-caption">最近活动的 thread</span>
                  </div>

                  <div className="native-session-list">
                    {recentCodexSessions.map((session) => (
                      <button
                        className="native-session-list__item"
                        key={session.threadId}
                        onClick={() => {
                          void importCodexSession(session.threadId);
                        }}
                        type="button"
                      >
                        <div className="session-card__body">
                          <strong className="session-card__title">{session.title}</strong>
                          <span className="session-card__path">
                            {compactPath(session.projectPath)}
                          </span>
                          <span className="session-card__meta">
                            {formatRelativeTime(session.updatedAt)}
                          </span>
                        </div>
                        <span className="session-card__action">
                          {session.importedSessionId ? "打开" : "继续"}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="surface-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">已导入会话</p>
                    <h2>工作区列表</h2>
                  </div>
                  <span className="section-caption">{sessions.length} 个会话</span>
                </div>

                <SessionList
                  onSelect={(sessionId) => {
                    setSelectedSessionId(sessionId);
                    setIsDrawerOpen(false);
                  }}
                  selectedSessionId={selectedSessionId}
                  sessions={sessions}
                />
              </section>

              {error ? <p className="error-banner">{error}</p> : null}

              <section className="surface-card">
                <details className="drawer-disclosure" open={!effectiveToken}>
                  <summary>
                    <span>连接设置</span>
                    <span className="meta-chip meta-chip--accent">{connectionState}</span>
                  </summary>

                  <p className="section-note">
                    连接密码就是你启动 bridge 时设置的
                    <code>BRIDGE_TOKEN</code>。如果当前链接带了
                    <code>?token=...</code>
                    ，页面会自动填入；本地开发地址默认使用
                    <code>{LOCAL_DEV_TOKEN}</code>。
                  </p>

                  {shareLink ? (
                    <div className="connection-share">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">手机直达</p>
                          <h3>手机打开链接</h3>
                        </div>
                        <span className="meta-chip">自动带密码</span>
                      </div>
                      <p className="section-note">
                        把这条链接发到手机上，页面会自动填好连接密码，不用再手动输入。
                      </p>
                      <label className="field-stack">
                        <span className="field-label">手机打开链接</span>
                        <input
                          onFocus={(event) => event.target.select()}
                          readOnly
                          value={shareLink}
                        />
                      </label>
                      <div className="connection-share__actions">
                        <button onClick={() => void copyShareLink()} type="button">
                          {shareLinkFeedback ?? "复制链接"}
                        </button>
                        <a
                          className="connection-share__open"
                          href={shareLink}
                          rel="noreferrer"
                          target="_blank"
                        >
                          在手机打开
                        </a>
                      </div>
                    </div>
                  ) : null}

                  <form className="connection-form" onSubmit={submitConnection}>
                    <label className="field-stack">
                      <span className="field-label">服务器地址</span>
                      <input
                        onChange={(event) => setBaseUrl(event.target.value)}
                        placeholder="例如：https://bridge.example.test"
                        value={baseUrl}
                      />
                    </label>
                    <label className="field-stack">
                      <span className="field-label">连接密码</span>
                      <input
                        onChange={(event) => setToken(event.target.value)}
                        placeholder="留空时会尝试从当前链接自动读取"
                        type="password"
                        value={token}
                      />
                    </label>
                    <button type="submit">保存连接</button>
                  </form>
                </details>
              </section>

              <section className="surface-card">
                <details className="drawer-disclosure">
                  <summary>
                    <span>从路径新建</span>
                    <span className="section-caption">适合临时项目</span>
                  </summary>

                  <form className="session-create" onSubmit={submitSession}>
                    <label className="field-stack">
                      <span className="field-label">会话名称</span>
                      <input
                        onChange={(event) => setNewTitle(event.target.value)}
                        placeholder="例如：官网改版"
                        value={newTitle}
                      />
                    </label>
                    <label className="field-stack">
                      <span className="field-label">项目路径</span>
                      <input
                        onChange={(event) => setNewProjectPath(event.target.value)}
                        placeholder="/Users/you/project"
                        value={newProjectPath}
                      />
                    </label>
                    <button type="submit">创建会话</button>
                  </form>
                </details>
              </section>
            </div>
          </aside>
        </>
      ) : null}

      <main className="chat-layout">
        <header className="chat-header">
          <button
            aria-label="打开会话抽屉"
            className="drawer-toggle"
            onClick={() => setIsDrawerOpen(true)}
            type="button"
          >
            <span className="drawer-toggle__bars" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>

          <div className="chat-header__copy">
            <p className="eyebrow">当前会话</p>
            <h1>{activeSession?.title ?? "先从左上角选择一个会话"}</h1>
            <p className="chat-header__path">{activePath}</p>
          </div>

          <div className="chat-header__status">
            <span className={`status-dot is-${activeStatus}`} />
            <span className={`session-card__badge is-${activeStatus}`}>
              {activeStatusLabel}
            </span>
            {canInterrupt ? (
              <button
                className="interrupt-button"
                disabled={isInterrupting}
                onClick={() => {
                  void interruptActiveSession();
                }}
                type="button"
              >
                {isInterrupting ? "中断中" : "中断"}
              </button>
            ) : null}
          </div>
        </header>

        {error ? <p className="error-banner error-banner--inline">{error}</p> : null}

        <section
          aria-label="会话概览"
          className={`command-deck is-${activeStatus}`}
        >
          <div className="command-deck__content">
            <div className="command-deck__title">
              <p className="eyebrow">控制中心</p>
              <h2>{activeSession?.title ?? "选择一个会话"}</h2>
              <p>{activeSession ? `项目 ${activePath}` : activePath}</p>
            </div>
            <div className="command-deck__state">
              <span className={`command-deck__pulse is-${activeStatus}`} />
              <span>{connectionState}</span>
              <strong>状态 {activeStatusLabel}</strong>
            </div>
          </div>
          <div className="command-deck__metrics">
            <div>
              <span>输出</span>
              <strong>{timelineCount}</strong>
            </div>
            <div>
              <span>授权</span>
              <strong>{pendingApprovalCount}</strong>
            </div>
            <div>
              <span>更新</span>
              <strong>{lastActivityLabel}</strong>
            </div>
          </div>
        </section>

        <section aria-label="消息时间线" className="chat-stream">
          <Timeline
            approvals={activeSnapshot?.approvals ?? []}
            events={activeSnapshot?.events ?? []}
            mediaBaseUrl={baseUrl.trim()}
            mediaToken={effectiveToken}
            onApproveOnce={(approvalId) => {
              void handleApprovalAction(approvalId, "once");
            }}
            onApproveTurn={(approvalId) => {
              void handleApprovalAction(approvalId, "turn");
            }}
            onReject={(approvalId) => {
              void handleApprovalAction(approvalId, "reject");
            }}
          />
          <div aria-hidden="true" className="timeline-end" ref={timelineEndRef} />
        </section>

        <Composer
          disabled={!activeSession || isSessionBusy || isLocalOnly}
          hint={composerHint}
          message={message}
          onChange={setMessage}
          onSubmit={submitMessage}
        />
      </main>
    </div>
  );
}
