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

type TableInfoRow = {
  name: string;
};

const internalThreadTitlePrefixes = [
  "<codex_delegation>",
  "<environment_context>",
  "<in-app-browser-context",
];

export function isHumanFacingCodexThreadTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) {
    return false;
  }

  const start = title.trimStart();
  if (internalThreadTitlePrefixes.some((prefix) => start.startsWith(prefix))) {
    return false;
  }

  return trimmed.replace(/<\/?[A-Za-z][^>]*>/g, "").trim().length > 0;
}

function getTableColumns(
  db: Database.Database,
  table: "threads" | "thread_spawn_edges",
): Set<string> {
  const rows = db.prepare(`pragma table_info(${table})`).all() as TableInfoRow[];
  return new Set(rows.map((row) => row.name));
}

function buildRootThreadWhereClause(
  db: Database.Database,
  additionalFilters: string[] = [],
): string {
  const threadColumns = getTableColumns(db, "threads");
  const spawnEdgeColumns = getTableColumns(db, "thread_spawn_edges");
  const filters: string[] = [];

  if (threadColumns.has("thread_source")) {
    filters.push(
      "coalesce(t.thread_source, 'user') not in ('subagent', 'automation')",
    );
  }
  if (threadColumns.has("source")) {
    filters.push("coalesce(t.source, '') <> 'exec'");
  }
  if (threadColumns.has("archived")) {
    filters.push("coalesce(t.archived, 0) = 0");
  }
  if (spawnEdgeColumns.has("child_thread_id")) {
    filters.push(
      "not exists (select 1 from thread_spawn_edges e where e.child_thread_id = t.id)",
    );
  }
  filters.push(...additionalFilters);

  return filters.length > 0
    ? `where ${filters.join("\n              and ")}`
    : "";
}

function toCodexSessionSummary(row: ThreadRow): CodexSessionSummary {
  return codexSessionSummarySchema.parse({
    threadId: row.id,
    title: row.title,
    projectPath: row.cwd || "",
    updatedAt: new Date(row.updated_at_ms ?? Date.now()).toISOString(),
    importedSessionId: null,
  });
}

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
      const whereClause = buildRootThreadWhereClause(db);
      const rows = db
        .prepare(
          `
            select
              t.id,
              t.title,
              t.cwd,
              t.updated_at_ms
            from threads t
            ${whereClause}
            order by t.updated_at_ms desc
          `,
        )
        .iterate() as IterableIterator<ThreadRow>;
      const sessions: CodexSessionSummary[] = [];

      for (const row of rows) {
        if (!isHumanFacingCodexThreadTitle(row.title)) {
          continue;
        }

        sessions.push(toCodexSessionSummary(row));

        if (sessions.length === 30) {
          break;
        }
      }

      return sessions;
    } finally {
      db.close();
    }
  }

  getByThreadId(threadId: string): CodexSessionSummary | null {
    if (!existsSync(this.dbPath)) {
      return null;
    }

    const db = new Database(this.dbPath, { readonly: true });

    try {
      const whereClause = buildRootThreadWhereClause(db, ["t.id = ?"]);
      const row = db
        .prepare(
          `
            select
              t.id,
              t.title,
              t.cwd,
              t.updated_at_ms
            from threads t
            ${whereClause}
            limit 1
          `,
        )
        .get(threadId) as ThreadRow | undefined;

      if (!row || !isHumanFacingCodexThreadTitle(row.title)) {
        return null;
      }

      return toCodexSessionSummary(row);
    } finally {
      db.close();
    }
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
