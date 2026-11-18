import type { Session } from "@codex-remote/shared";

export type ConnectionMode = "direct" | "relay";

export function selectionStorageKey(
  mode: ConnectionMode,
  baseUrl: string,
): string {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, "");
  return `codex-remote.selected-session.${mode}.${encodeURIComponent(normalizedBaseUrl)}`;
}

export function resolveInitialSessionId(
  sessions: Session[],
  savedId: string | null,
): string | null {
  if (savedId && sessions.some((session) => session.id === savedId)) {
    return savedId;
  }

  return (
    sessions.find((session) => Boolean(session.runtimeThreadId))?.id ??
    sessions[0]?.id ??
    null
  );
}
