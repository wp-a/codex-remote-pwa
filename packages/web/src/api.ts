import type {
  CodexSessionSummary,
  Session,
  SessionSnapshot,
} from "@codex-remote/shared";

export type CreateSessionInput = {
  title: string;
  projectPath: string;
};

export type BridgeHealth = {
  ok: boolean;
  runtimeMode: "app-server" | "cli" | "local-only";
  canSendMessages: boolean;
};

export type ApiClient = {
  getHealth?: () => Promise<BridgeHealth>;
  listSessions: () => Promise<Session[]>;
  listCodexSessions: () => Promise<CodexSessionSummary[]>;
  createSession: (input: CreateSessionInput) => Promise<Session>;
  importCodexSession: (threadId: string) => Promise<Session>;
  getSnapshot: (sessionId: string) => Promise<SessionSnapshot>;
  sendMessage: (sessionId: string, text: string) => Promise<{ id: string }>;
  interrupt: (sessionId: string) => Promise<{ interrupted: boolean }>;
  approveOnce: (approvalId: string) => Promise<void>;
  approveTurn: (approvalId: string) => Promise<void>;
  rejectApproval: (approvalId: string) => Promise<void>;
};

type CreateApiClientOptions = {
  baseUrl: string;
  token: string;
};

async function requestJson<T>(
  input: string,
  init: RequestInit,
  token: string,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${response.status} for ${input}${detail ? `: ${detail}` : ""}`,
    );
  }

  return (await response.json()) as T;
}

export function createApiClient(options: CreateApiClientOptions): ApiClient {
  return {
    async getHealth() {
      return requestJson<BridgeHealth>(
        `${options.baseUrl}/api/health`,
        { method: "GET" },
        options.token,
      );
    },
    async listSessions() {
      const result = await requestJson<{ sessions: Session[] }>(
        `${options.baseUrl}/api/sessions`,
        { method: "GET" },
        options.token,
      );
      return result.sessions;
    },
    async createSession(input) {
      const result = await requestJson<{ session: Session }>(
        `${options.baseUrl}/api/sessions`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
        options.token,
      );
      return result.session;
    },
    async listCodexSessions() {
      const result = await requestJson<{ sessions: CodexSessionSummary[] }>(
        `${options.baseUrl}/api/codex-sessions`,
        { method: "GET" },
        options.token,
      );
      return result.sessions;
    },
    async importCodexSession(threadId) {
      const result = await requestJson<{ session: Session }>(
        `${options.baseUrl}/api/codex-sessions/${encodeURIComponent(threadId)}/import`,
        { method: "POST" },
        options.token,
      );
      return result.session;
    },
    async getSnapshot(sessionId) {
      return requestJson<SessionSnapshot>(
        `${options.baseUrl}/api/sessions/${sessionId}/snapshot`,
        { method: "GET" },
        options.token,
      );
    },
    async sendMessage(sessionId, text) {
      return requestJson<{ run: { id: string } }>(
        `${options.baseUrl}/api/sessions/${sessionId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ text }),
        },
        options.token,
      ).then((result) => result.run);
    },
    async interrupt(sessionId) {
      return requestJson<{ interrupted: boolean }>(
        `${options.baseUrl}/api/sessions/${sessionId}/interrupt`,
        { method: "POST" },
        options.token,
      );
    },
    async approveOnce(approvalId) {
      await requestJson(
        `${options.baseUrl}/api/approvals/${approvalId}/approve-once`,
        { method: "POST" },
        options.token,
      );
    },
    async approveTurn(approvalId) {
      await requestJson(
        `${options.baseUrl}/api/approvals/${approvalId}/approve-turn`,
        { method: "POST" },
        options.token,
      );
    },
    async rejectApproval(approvalId) {
      await requestJson(
        `${options.baseUrl}/api/approvals/${approvalId}/reject`,
        { method: "POST" },
        options.token,
      );
    },
  };
}
