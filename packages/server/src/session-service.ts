import type {
  ApprovalRequest,
  ApprovalStatus,
  Run,
  Session,
  SessionSnapshot,
  SessionSummary,
  TimelineEvent,
} from "@codex-remote/shared";

import { SqliteStore } from "./db.js";
import { EventBus } from "./event-bus.js";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

type CreateSessionInput = Pick<Session, "title" | "projectPath">;
type CreateImportedSessionInput = Pick<
  Session,
  "title" | "projectPath" | "runtimeThreadId"
>;
type StartRunInput = Pick<Run, "sessionId" | "prompt">;
type AppendEventInput = DistributiveOmit<TimelineEvent, "id">;
type CreateApprovalInput = Omit<ApprovalRequest, "id">;

export class SessionService {
  constructor(
    private readonly store: SqliteStore,
    private readonly eventBus: EventBus,
  ) {}

  createSession(input: CreateSessionInput): Session {
    return this.store.createSession(input);
  }

  createImportedSession(input: CreateImportedSessionInput): Session {
    return this.store.createImportedSession(input);
  }

  listSessions(): SessionSummary[] {
    return this.store.listSessions();
  }

  findSessionByRuntimeThreadId(runtimeThreadId: string): Session | null {
    return this.store.findSessionByRuntimeThreadId(runtimeThreadId);
  }

  getSession(sessionId: string): Session {
    return this.store.getSession(sessionId);
  }

  getSnapshot(sessionId: string): SessionSnapshot {
    return this.store.getSessionSnapshot(sessionId);
  }

  startRun(input: StartRunInput): Run {
    this.store.updateSessionStatus(input.sessionId, "running");

    const run = this.store.createRun({
      sessionId: input.sessionId,
      prompt: input.prompt,
      status: "running",
      startedAt: new Date().toISOString(),
    });

    this.appendEvent({
      sessionId: input.sessionId,
      runId: run.id,
      type: "user_message",
      text: input.prompt,
      ts: new Date().toISOString(),
    });

    return run;
  }

  appendEvent(input: AppendEventInput): TimelineEvent {
    const event = this.store.appendEvent(input);
    this.eventBus.publish(input.sessionId, event);
    return event;
  }

  createApproval(input: CreateApprovalInput): ApprovalRequest {
    return this.store.createApproval(input);
  }

  updateApprovalStatus(approvalId: string, status: ApprovalStatus): void {
    this.store.updateApprovalStatus(approvalId, status);
  }

  updateRunStatus(runId: string, status: Run["status"]): void {
    this.store.updateRunStatus(runId, status);
  }

  updateSessionStatus(sessionId: string, status: Session["status"]): void {
    this.store.updateSessionStatus(sessionId, status);
  }

  updateSessionRuntimeThreadId(sessionId: string, runtimeThreadId: string): void {
    this.store.updateSessionRuntimeThreadId(sessionId, runtimeThreadId);
  }
}
