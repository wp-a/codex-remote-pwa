import type {
  CodexSessionSummary,
  Session,
  SessionSnapshot,
  TimelineEvent,
} from "@codex-remote/shared";

export type LocalBridgeClientOptions = {
  baseUrl: string;
  token: string;
};

export type BridgeHealth = {
  ok: boolean;
  runtimeMode: "app-server" | "cli" | "local-only";
  canSendMessages: boolean;
};

export class LocalBridgeClient {
  private readonly baseUrl: string;

  constructor(private readonly options: LocalBridgeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  async getHealth(): Promise<BridgeHealth> {
    return this.requestJson<BridgeHealth>("/api/health", { method: "GET" });
  }

  async listSessions(): Promise<Session[]> {
    const result = await this.requestJson<{ sessions: Session[] }>(
      "/api/sessions",
      { method: "GET" },
    );
    return result.sessions;
  }

  async listCodexSessions(): Promise<CodexSessionSummary[]> {
    const result = await this.requestJson<{ sessions: CodexSessionSummary[] }>(
      "/api/codex-sessions",
      { method: "GET" },
    );
    return result.sessions;
  }

  async createSession(input: {
    title: string;
    projectPath: string;
  }): Promise<Session> {
    const result = await this.requestJson<{ session: Session }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return result.session;
  }

  async importCodexSession(threadId: string): Promise<Session> {
    const result = await this.requestJson<{ session: Session }>(
      `/api/codex-sessions/${encodeURIComponent(threadId)}/import`,
      { method: "POST" },
    );
    return result.session;
  }

  async getSnapshot(sessionId: string): Promise<SessionSnapshot> {
    return this.requestJson<SessionSnapshot>(
      `/api/sessions/${encodeURIComponent(sessionId)}/snapshot`,
      { method: "GET" },
    );
  }

  async sendMessage(sessionId: string, text: string): Promise<{ id: string }> {
    const result = await this.requestJson<{ run: { id: string } }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ text }),
      },
    );
    return result.run;
  }

  async interrupt(sessionId: string): Promise<{ interrupted: boolean }> {
    return this.requestJson<{ interrupted: boolean }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/interrupt`,
      { method: "POST" },
    );
  }

  async approveOnce(approvalId: string): Promise<void> {
    await this.requestJson(
      `/api/approvals/${encodeURIComponent(approvalId)}/approve-once`,
      { method: "POST" },
    );
  }

  async approveTurn(approvalId: string): Promise<void> {
    await this.requestJson(
      `/api/approvals/${encodeURIComponent(approvalId)}/approve-turn`,
      { method: "POST" },
    );
  }

  async rejectApproval(approvalId: string): Promise<void> {
    await this.requestJson(
      `/api/approvals/${encodeURIComponent(approvalId)}/reject`,
      { method: "POST" },
    );
  }

  streamUrl(sessionId: string): string {
    const url = new URL(
      `/api/sessions/${encodeURIComponent(sessionId)}/stream`,
      this.baseUrl,
    );
    url.protocol = url.protocol.replace(/^http/, "ws");
    url.searchParams.set("token", this.options.token);
    return url.toString();
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.token}`,
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Local bridge HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    return (await response.json()) as T;
  }
}

export type TimelineListener = (event: TimelineEvent) => void;
