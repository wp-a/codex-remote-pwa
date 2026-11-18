import { useEffect, useRef, useState, type FormEvent } from "react";

import type {
  CodexSessionSummary,
  Session,
  SessionSnapshot,
} from "@codex-remote/shared";

import type { ApiClient, BridgeHealth } from "./api.js";
import { AppHeader } from "./components/app-header.js";
import { Composer } from "./components/composer.js";
import { HomeView } from "./components/home-view.js";
import { SessionPicker } from "./components/session-picker.js";
import { SettingsSheet } from "./components/settings-sheet.js";
import type { AccessLink } from "./components/settings-sheet.js";
import { Timeline } from "./components/timeline.js";
import {
  buildConnectionLink,
  buildRelayConnectionLink,
  inferDefaultConnectionToken,
} from "./connection.js";
import { sessionStatusLabel } from "./copy.js";
import { compactPath } from "./format.js";
import type { RealtimeClient } from "./realtime.js";
import {
  resolveInitialSessionId,
  selectionStorageKey,
  type ConnectionMode,
} from "./session-preferences.js";

type AppProps = {
  client: ApiClient;
  connectionMode?: ConnectionMode;
  initialBaseUrl: string;
  initialToken: string;
  onSaveConnection: (input: { baseUrl: string; token: string }) => void;
  realtime: RealtimeClient;
};

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes("HTTP 401")) {
      return "连接密码缺失或无效，请在设置中重新保存连接。";
    }

    return error.message;
  }

  return "发生了未预期错误";
}

function readSelection(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSelection(key: string, sessionId: string): void {
  try {
    window.localStorage.setItem(key, sessionId);
  } catch {
    // Selection persistence is optional when storage is unavailable.
  }
}

export function App({
  client,
  connectionMode = "direct",
  initialBaseUrl,
  initialToken,
  onSaveConnection,
  realtime,
}: AppProps) {
  const defaultToken =
    inferDefaultConnectionToken(initialBaseUrl, window.location.origin) ?? "";
  const preferenceKey = selectionStorageKey(connectionMode, initialBaseUrl);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [codexSessions, setCodexSessions] = useState<CodexSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newProjectPath, setNewProjectPath] = useState("");
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [token, setToken] = useState(
    initialToken === "change-me" ? defaultToken : initialToken,
  );
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInterrupting, setIsInterrupting] = useState(false);
  const [sendingSessionId, setSendingSessionId] = useState<string | null>(null);
  const [pendingRunSessionIds, setPendingRunSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const selectedSessionIdRef = useRef<string | null>(null);
  const sendingSessionIdRef = useRef<string | null>(null);
  const snapshotRequestIdRef = useRef(0);
  const [error, setError] = useState<string | null>(
    (!initialToken || initialToken === "change-me") && !defaultToken
      ? "还没有连接密码，请先在设置中保存连接。"
      : null,
  );

  function persistAndSelect(sessionId: string) {
    setSnapshot(null);
    selectedSessionIdRef.current = sessionId;
    setSelectedSessionId(sessionId);
    writeSelection(preferenceKey, sessionId);
  }

  function markPendingRun(sessionId: string) {
    setPendingRunSessionIds((current) => {
      if (current.has(sessionId)) {
        return current;
      }

      const next = new Set(current);
      next.add(sessionId);
      return next;
    });
  }

  function clearPendingRun(sessionId: string) {
    setPendingRunSessionIds((current) => {
      if (!current.has(sessionId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });
  }

  function applySnapshot(nextSnapshot: SessionSnapshot) {
    setSnapshot(nextSnapshot);
    setSessions((current) =>
      current.map((session) =>
        session.id === nextSnapshot.session.id ? nextSnapshot.session : session,
      ),
    );
  }

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    const healthRequest = client.getHealth?.()
      .then((nextHealth) => {
        if (!cancelled) {
          setHealth(nextHealth);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth(null);
        }
      });

    const sessionsRequest = client
      .listSessions()
      .then((nextSessions) => {
        if (cancelled) {
          return;
        }

        const nextSelection = resolveInitialSessionId(
          nextSessions,
          readSelection(preferenceKey),
        );
        setSessions(nextSessions);
        selectedSessionIdRef.current = nextSelection;
        setSelectedSessionId(nextSelection);
        if (nextSelection) {
          writeSelection(preferenceKey, nextSelection);
        }
        setError(null);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(describeError(nextError));
        }
      });

    const nativeSessionsRequest = client
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

    void Promise.allSettled([
      healthRequest,
      sessionsRequest,
      nativeSessionsRequest,
    ]).then(() => {
      if (!cancelled) {
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [client, preferenceKey]);

  useEffect(() => {
    if (!selectedSessionId) {
      snapshotRequestIdRef.current += 1;
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    const requestId = ++snapshotRequestIdRef.current;
    client
      .getSnapshot(selectedSessionId)
      .then((nextSnapshot) => {
        if (
          !cancelled &&
          requestId === snapshotRequestIdRef.current &&
          selectedSessionIdRef.current === selectedSessionId
        ) {
          setError(null);
          applySnapshot(nextSnapshot);
        }
      })
      .catch((nextError) => {
        if (
          !cancelled &&
          requestId === snapshotRequestIdRef.current &&
          selectedSessionIdRef.current === selectedSessionId
        ) {
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

        return { ...current, events: [...current.events, event] };
      });
    });
  }, [realtime, selectedSessionId]);

  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? null;
  const activeSnapshot =
    snapshot && snapshot.session.id === selectedSessionId ? snapshot : null;
  const activeSession = activeSnapshot?.session ?? selectedSession;
  const effectiveToken =
    token.trim() ||
    inferDefaultConnectionToken(baseUrl.trim(), window.location.origin) ||
    "";
  const isLocalOnly =
    health?.runtimeMode === "local-only" || health?.canSendMessages === false;
  const connectionLabel = isLocalOnly
    ? "本地只读"
    : error
      ? "连接待检查"
      : connectionMode === "relay"
        ? "Relay 在线"
        : "在线";
  const isSendingActive = sendingSessionId !== null;
  const hasPendingRunState = selectedSessionId
    ? pendingRunSessionIds.has(selectedSessionId)
    : false;
  const activeStatus = hasPendingRunState
    ? "running"
    : activeSession?.status ?? (error ? "error" : "idle");
  const activeStatusLabel =
    activeSession || hasPendingRunState
      ? sessionStatusLabel(activeStatus)
      : connectionLabel;
  const isSessionBusy = hasPendingRunState ||
    activeSession?.status === "running" ||
    activeSession?.status === "blocked_approval";
  const isComposerLocked = isSendingActive || isSessionBusy;
  const pendingApprovalCount =
    activeSnapshot?.approvals.filter((approval) => approval.status === "pending")
      .length ?? 0;
  const timelineCount = activeSnapshot?.events.length ?? 0;
  const activePath = activeSession?.projectPath
    ? compactPath(activeSession.projectPath)
    : undefined;
  const composerHint = isSendingActive
    ? "正在发送任务…"
    : isLocalOnly
    ? "本地只读模式：可以查看历史和截图，不能发送新任务。"
    : isSessionBusy
      ? activeSession?.status === "blocked_approval"
        ? "当前任务正在等待授权，请先处理授权或停止。"
        : "当前任务还在运行，请先停止。"
      : "继续当前会话";
  const fallbackShareLink =
    connectionMode === "relay"
      ? buildRelayConnectionLink(baseUrl.trim(), effectiveToken, window.location.href)
      : buildConnectionLink(
          baseUrl.trim(),
          effectiveToken,
          window.location.origin,
        );
  const accessLinks: AccessLink[] = [
    ...(health?.accessCandidates ?? []),
    ...(fallbackShareLink
      ? [{ kind: "current" as const, label: "当前页面", url: fallbackShareLink }]
      : []),
  ].filter(
    (link, index, all) =>
      all.findIndex((candidate) => candidate.url === link.url) === index,
  );

  useEffect(() => {
    if (!selectedSessionId || !isSessionBusy) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      const requestId = ++snapshotRequestIdRef.current;
      try {
        const nextSnapshot = await client.getSnapshot(selectedSessionId);
        if (
          !cancelled &&
          requestId === snapshotRequestIdRef.current &&
          selectedSessionIdRef.current === selectedSessionId
        ) {
          applySnapshot(nextSnapshot);
          clearPendingRun(selectedSessionId);
          setError(null);
        }
      } catch (nextError) {
        if (
          !cancelled &&
          requestId === snapshotRequestIdRef.current &&
          selectedSessionIdRef.current === selectedSessionId
        ) {
          setError(describeError(nextError));
        }
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(() => void poll(), 1500);
        }
      }
    };

    timer = window.setTimeout(() => void poll(), 1500);

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [client, selectedSessionId, isSessionBusy]);

  useEffect(() => {
    if (!activeSnapshot) {
      return;
    }

    const timelineEnd = timelineEndRef.current;
    if (typeof timelineEnd?.scrollIntoView === "function") {
      timelineEnd.scrollIntoView({ block: "end", behavior: "auto" });
    }
  }, [activeSnapshot, pendingApprovalCount, timelineCount]);

  useEffect(() => {
    if (!copyFeedback) {
      return;
    }

    const timer = window.setTimeout(() => setCopyFeedback(null), 2200);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedSessionId ||
      !message.trim() ||
      isComposerLocked ||
      sendingSessionIdRef.current !== null ||
      isLocalOnly
    ) {
      return;
    }

    const sessionId = selectedSessionId;
    const text = message.trim();
    sendingSessionIdRef.current = sessionId;
    setSendingSessionId(sessionId);
    setMessage("");
    try {
      await client.sendMessage(sessionId, text);
    } catch (nextError) {
      if (selectedSessionIdRef.current === sessionId) {
        setMessage(text);
      }
      if (selectedSessionIdRef.current === sessionId) {
        setError(describeError(nextError));
      }
      if (sendingSessionIdRef.current === sessionId) {
        sendingSessionIdRef.current = null;
      }
      setSendingSessionId((current) => (current === sessionId ? null : current));
      return;
    }

    if (sendingSessionIdRef.current === sessionId) {
      sendingSessionIdRef.current = null;
    }
    setSendingSessionId((current) => (current === sessionId ? null : current));
    markPendingRun(sessionId);
    if (selectedSessionIdRef.current !== sessionId) {
      return;
    }
    const requestId = ++snapshotRequestIdRef.current;
    try {
      const nextSnapshot = await client.getSnapshot(sessionId);
      if (
        requestId === snapshotRequestIdRef.current &&
        selectedSessionIdRef.current === sessionId
      ) {
        applySnapshot(nextSnapshot);
        clearPendingRun(sessionId);
        setError(null);
      }
    } catch (nextError) {
      if (
        requestId === snapshotRequestIdRef.current &&
        selectedSessionIdRef.current === sessionId
      ) {
        setError(`任务已发送，但状态刷新失败：${describeError(nextError)}`);
      }
    }
  }

  async function interruptActiveSession() {
    if (!selectedSessionId || !isSessionBusy) {
      return;
    }

    setIsInterrupting(true);
    try {
      const result = await client.interrupt(selectedSessionId);
      if (!result.interrupted) {
        setError("当前会话没有可停止的任务。");
        return;
      }

      const requestId = ++snapshotRequestIdRef.current;
      const nextSnapshot = await client.getSnapshot(selectedSessionId);
      if (
        requestId === snapshotRequestIdRef.current &&
        selectedSessionIdRef.current === selectedSessionId
      ) {
        applySnapshot(nextSnapshot);
        clearPendingRun(selectedSessionId);
        setError(null);
      }
    } catch (nextError) {
      if (selectedSessionIdRef.current === selectedSessionId) {
        setError(describeError(nextError));
      }
    } finally {
      setIsInterrupting(false);
    }
  }

  async function importCodexSession(threadId: string) {
    try {
      const session = await client.importCodexSession(threadId);
      setSessions((current) => {
        const exists = current.some((item) => item.id === session.id);
        return exists
          ? current.map((item) => (item.id === session.id ? session : item))
          : [session, ...current];
      });
      setCodexSessions((current) =>
        current.map((item) =>
          item.threadId === threadId
            ? { ...item, importedSessionId: session.id }
            : item,
        ),
      );
      persistAndSelect(session.id);
      setError(null);
      setIsPickerOpen(false);
    } catch (nextError) {
      setError(describeError(nextError));
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
      setSessions((current) => [session, ...current]);
      persistAndSelect(session.id);
      setNewTitle("");
      setNewProjectPath("");
      setError(null);
      setIsSettingsOpen(false);
    } catch (nextError) {
      setError(describeError(nextError));
    }
  }

  async function handleApprovalAction(
    approvalId: string,
    action: "once" | "turn" | "reject",
  ) {
    try {
      if (action === "once") {
        await client.approveOnce(approvalId);
      } else if (action === "turn") {
        await client.approveTurn(approvalId);
      } else {
        await client.rejectApproval(approvalId);
      }

      setSnapshot((current) =>
        current
          ? {
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
            }
          : current,
      );
    } catch (nextError) {
      setError(describeError(nextError));
    }
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
    onSaveConnection({ baseUrl: baseUrl.trim(), token: nextToken });
    setIsSettingsOpen(false);
  }

  async function copyAccessLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopyFeedback("已复制");
    } catch {
      setCopyFeedback("复制失败，请长按链接手动复制");
    }
  }

  return (
    <div className={`app-shell${activeSession ? " is-chat" : " is-home"}`}>
      <AppHeader
        connectionLabel={connectionLabel}
        isStopping={isInterrupting}
        onOpenSessions={() => setIsPickerOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onStop={() => void interruptActiveSession()}
        path={activePath}
        status={activeStatus}
        statusLabel={activeStatusLabel}
        title={activeSession?.title ?? "Remote Workbench"}
      />

      {activeSession ? (
        <main className="chat-view">
          {error ? <p className="error-banner error-banner--inline">{error}</p> : null}
          <section aria-label="消息时间线" className="chat-stream">
            <Timeline
              approvals={activeSnapshot?.approvals ?? []}
              events={activeSnapshot?.events ?? []}
              mediaBaseUrl={baseUrl.trim()}
              mediaToken={effectiveToken}
              onApproveOnce={(id) => void handleApprovalAction(id, "once")}
              onApproveTurn={(id) => void handleApprovalAction(id, "turn")}
              onReject={(id) => void handleApprovalAction(id, "reject")}
            />
            <div aria-hidden="true" className="timeline-end" ref={timelineEndRef} />
          </section>
          <Composer
            disabled={isComposerLocked || isLocalOnly}
            hint={composerHint}
            message={message}
            onChange={setMessage}
            onSubmit={submitMessage}
          />
        </main>
      ) : (
        <HomeView
          error={error}
          isLoading={isLoading}
          onOpenThread={(threadId) => void importCodexSession(threadId)}
          recentSessions={codexSessions}
        />
      )}

      <SessionPicker
        codexSessions={codexSessions}
        onClose={() => setIsPickerOpen(false)}
        onOpenCodexSession={(threadId) => void importCodexSession(threadId)}
        onSelectSession={(sessionId) => {
          persistAndSelect(sessionId);
          setIsPickerOpen(false);
        }}
        open={isPickerOpen}
        selectedSessionId={selectedSessionId}
        sessions={sessions}
      />

      <SettingsSheet
        accessLinks={accessLinks}
        baseUrl={baseUrl}
        connectionMode={connectionMode}
        copyFeedback={copyFeedback}
        health={health}
        newProjectPath={newProjectPath}
        newTitle={newTitle}
        onBaseUrlChange={setBaseUrl}
        onClose={() => setIsSettingsOpen(false)}
        onCopyLink={(link) => void copyAccessLink(link)}
        onCreateSession={submitSession}
        onNewProjectPathChange={setNewProjectPath}
        onNewTitleChange={setNewTitle}
        onSaveConnection={submitConnection}
        onTokenChange={setToken}
        open={isSettingsOpen}
        token={token}
      />
    </div>
  );
}
