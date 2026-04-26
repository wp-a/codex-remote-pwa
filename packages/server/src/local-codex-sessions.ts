import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import {
  codexSessionSummarySchema,
  type CodexSessionSummary,
} from "@codex-remote/shared";

import {
  loadRolloutHistory,
  type ImportedTranscriptEntry,
} from "./rollout-history.js";

type ThreadRow = {
  id: string;
  title: string;
  cwd: string;
  rollout_path?: string;
  updated_at_ms: number | null;
};

export type CodexSessionSource = {
  getByThreadId: (threadId: string) => CodexSessionSummary | null;
  getHistoryByThreadId: (threadId: string, limit?: number) => ImportedTranscriptEntry[];
  listRecent: () => CodexSessionSummary[];
};

export class LocalCodexSessions implements CodexSessionSource {
  constructor(
    private readonly dbPath = path.join(os.homedir(), ".codex", "state_5.sqlite"),
  ) {}

  listRecent(): CodexSessionSummary[] {
    if (!existsSync(this.dbPath)) {
      return [];
    }

    const db = new Database(this.dbPath, { readonly: true });

    try {
      const rows = db
        .prepare(
          `
            select
              id,
              title,
              cwd,
              updated_at_ms
            from threads
            order by updated_at_ms desc
            limit 30
          `,
        )
        .all() as ThreadRow[];

      return rows.map((row) =>
        codexSessionSummarySchema.parse({
          threadId: row.id,
          title: row.title || row.cwd || row.id,
          projectPath: row.cwd || "",
          updatedAt: new Date(row.updated_at_ms ?? Date.now()).toISOString(),
          importedSessionId: null,
        }),
      );
    } finally {
      db.close();
    }
  }

  getByThreadId(threadId: string): CodexSessionSummary | null {
    return this.listRecent().find((session) => session.threadId === threadId) ?? null;
  }

  getHistoryByThreadId(threadId: string, limit = 120): ImportedTranscriptEntry[] {
    if (!existsSync(this.dbPath)) {
      return [];
    }

    const db = new Database(this.dbPath, { readonly: true });

    try {
      const row = db
        .prepare(
          `
            select
              rollout_path
            from threads
            where id = ?
            limit 1
          `,
        )
        .get(threadId) as ThreadRow | undefined;

      return loadRolloutHistory(String(row?.rollout_path ?? ""), { limit });
    } finally {
      db.close();
    }
  }
}
