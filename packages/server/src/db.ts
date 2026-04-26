import Database from "better-sqlite3";
import { nanoid } from "nanoid";

import {
  approvalRequestSchema,
  type ApprovalRequest,
  type ApprovalStatus,
  runSchema,
  type Run,
  type RunStatus,
  sessionSchema,
  sessionSnapshotSchema,
  type Session,
  type SessionSnapshot,
  sessionSummarySchema,
  type SessionSummary,
  timelineEventSchema,
  type TimelineEvent,
} from "@codex-remote/shared";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

type SessionRecord = Pick<Session, "title" | "projectPath">;
type ImportedSessionRecord = Pick<Session, "title" | "projectPath" | "runtimeThreadId">;

type RunRecord = Pick<Run, "sessionId" | "prompt"> & {
  status?: RunStatus;
  startedAt?: string;
  finishedAt?: string;
};

type EventRecord = DistributiveOmit<TimelineEvent, "id">;
type ApprovalRecord = Omit<ApprovalRequest, "id">;

type RunRow = {
  id: string;
  sessionId: string;
  prompt: string;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
};

type EventRow = {
  payload_json: string;
};

export class SqliteStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  close() {
    this.db.close();
  }

  createSession(input: SessionRecord): Session {
    return this.insertSession({
      title: input.title,
      projectPath: input.projectPath,
      runtimeThreadId: null,
    });
  }

  createImportedSession(input: ImportedSessionRecord): Session {
    return this.insertSession({
      title: input.title,
      projectPath: input.projectPath,
      runtimeThreadId: input.runtimeThreadId ?? null,
    });
  }

  private insertSession(input: {
    title: string;
    projectPath: string;
    runtimeThreadId: string | null;
  }): Session {
    const now = new Date().toISOString();
    const session = sessionSchema.parse({
      id: `session_${nanoid(10)}`,
      title: input.title,
      projectPath: input.projectPath,
      status: "idle",
      createdAt: now,
      updatedAt: now,
      lastRunId: null,
      runtimeThreadId: input.runtimeThreadId,
    });

    this.db
      .prepare(
        `
          insert into sessions (
            id, title, project_path, status, created_at, updated_at, last_run_id, runtime_thread_id
          ) values (
            @id, @title, @projectPath, @status, @createdAt, @updatedAt, @lastRunId, @runtimeThreadId
          )
        `,
      )
      .run(session);

    return session;
  }

  findSessionByRuntimeThreadId(runtimeThreadId: string): Session | null {
    const row = this.db
      .prepare(
        `
          select
            id,
            title,
            project_path as projectPath,
            status,
            created_at as createdAt,
            updated_at as updatedAt,
            last_run_id as lastRunId,
            runtime_thread_id as runtimeThreadId
          from sessions
          where runtime_thread_id = ?
          limit 1
        `,
      )
      .get(runtimeThreadId);

    return row ? sessionSchema.parse(row) : null;
  }

  listSessions(): SessionSummary[] {
    const rows = this.db
      .prepare(
        `
          select
            id,
            title,
            project_path as projectPath,
            status,
            created_at as createdAt,
            updated_at as updatedAt,
            last_run_id as lastRunId,
            runtime_thread_id as runtimeThreadId
          from sessions
          order by updated_at desc
        `,
      )
      .all();

    return rows.map((row) => sessionSummarySchema.parse(row));
  }

  getSession(sessionId: string): Session {
    const row = this.db
      .prepare(
        `
          select
            id,
            title,
            project_path as projectPath,
            status,
            created_at as createdAt,
            updated_at as updatedAt,
            last_run_id as lastRunId,
            runtime_thread_id as runtimeThreadId
          from sessions
          where id = ?
        `,
      )
      .get(sessionId);

    if (!row) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return sessionSchema.parse(row);
  }

  updateSessionStatus(sessionId: string, status: Session["status"]): void {
    this.db
      .prepare(
        `
          update sessions
          set status = ?, updated_at = ?
          where id = ?
        `,
      )
      .run(status, new Date().toISOString(), sessionId);
  }

  updateSessionRuntimeThreadId(sessionId: string, runtimeThreadId: string): void {
    this.db
      .prepare(
        `
          update sessions
          set runtime_thread_id = ?, updated_at = ?
          where id = ?
        `,
      )
      .run(runtimeThreadId, new Date().toISOString(), sessionId);
  }

  createRun(input: RunRecord): Run {
    const run = runSchema.parse({
      id: `run_${nanoid(10)}`,
      sessionId: input.sessionId,
      prompt: input.prompt,
      status: input.status ?? "queued",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    });

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `
            insert into runs (
              id, session_id, prompt, status, started_at, finished_at
            ) values (
              @id, @sessionId, @prompt, @status, @startedAt, @finishedAt
            )
          `,
        )
        .run(run);

      this.db
        .prepare(
          `
            update sessions
            set last_run_id = ?, updated_at = ?
            where id = ?
          `,
        )
        .run(run.id, new Date().toISOString(), input.sessionId);
    });

    transaction();

    return run;
  }

  updateRunStatus(runId: string, status: RunStatus): void {
    const finishedAt =
      status === "completed" || status === "failed" || status === "interrupted"
        ? new Date().toISOString()
        : null;

    this.db
      .prepare(
        `
          update runs
          set status = ?, finished_at = coalesce(?, finished_at)
          where id = ?
        `,
      )
      .run(status, finishedAt, runId);
  }

  appendEvent(input: EventRecord): TimelineEvent {
    const event = timelineEventSchema.parse({
      id: `event_${nanoid(10)}`,
      ...input,
    });

    this.db
      .prepare(
        `
          insert into events (
            id, session_id, run_id, type, payload_json, ts
          ) values (
            ?, ?, ?, ?, ?, ?
          )
        `,
      )
      .run(
        event.id,
        event.sessionId,
        event.runId,
        event.type,
        JSON.stringify(event),
        event.ts,
      );

    this.db
      .prepare("update sessions set updated_at = ? where id = ?")
      .run(new Date().toISOString(), event.sessionId);

    return event;
  }

  createApproval(input: ApprovalRecord): ApprovalRequest {
    const approval = approvalRequestSchema.parse({
      id: `approval_${nanoid(10)}`,
      ...input,
    });

    this.db
      .prepare(
        `
          insert into approvals (
            id, session_id, run_id, scope, reason, status, created_at
          ) values (
            @id, @sessionId, @runId, @scope, @reason, @status, @createdAt
          )
        `,
      )
      .run(approval);

    return approval;
  }

  updateApprovalStatus(approvalId: string, status: ApprovalStatus): void {
    this.db
      .prepare(
        `
          update approvals
          set status = ?
          where id = ?
        `,
      )
      .run(status, approvalId);
  }

  getSessionSnapshot(sessionId: string): SessionSnapshot {
    const session = this.getSession(sessionId);

    const runs = (this.db
      .prepare(
        `
          select
            id,
            session_id as sessionId,
            prompt,
            status,
            started_at as startedAt,
            finished_at as finishedAt
          from runs
          where session_id = ?
          order by rowid asc
        `,
      )
      .all(sessionId) as RunRow[])
      .map((row) =>
        runSchema.parse({
          ...row,
          startedAt: row.startedAt ?? undefined,
          finishedAt: row.finishedAt ?? undefined,
        }),
      );

    const events = (this.db
      .prepare(
        `
          select payload_json
          from events
          where session_id = ?
          order by rowid asc
        `,
      )
      .all(sessionId) as EventRow[])
      .map((row) => timelineEventSchema.parse(JSON.parse(row.payload_json)));

    const approvals = this.db
      .prepare(
        `
          select
            id,
            session_id as sessionId,
            run_id as runId,
            scope,
            reason,
            status,
            created_at as createdAt
          from approvals
          where session_id = ?
          order by rowid asc
        `,
      )
      .all(sessionId)
      .map((row) => approvalRequestSchema.parse(row));

    return sessionSnapshotSchema.parse({
      session,
      runs,
      events,
      approvals,
    });
  }

  private migrate() {
    this.db.exec(`
      create table if not exists sessions (
        id text primary key,
        title text not null,
        project_path text not null,
        status text not null,
        created_at text not null,
        updated_at text not null,
        last_run_id text,
        runtime_thread_id text
      );

      create table if not exists runs (
        id text primary key,
        session_id text not null,
        prompt text not null,
        status text not null,
        started_at text,
        finished_at text
      );

      create table if not exists events (
        id text primary key,
        session_id text not null,
        run_id text not null,
        type text not null,
        payload_json text not null,
        ts text not null
      );

      create table if not exists approvals (
        id text primary key,
        session_id text not null,
        run_id text not null,
        scope text not null,
        reason text not null,
        status text not null,
        created_at text not null
      );
    `);
  }
}
