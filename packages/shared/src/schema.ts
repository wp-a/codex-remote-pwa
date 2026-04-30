import { z } from "zod";

export const sessionStatusSchema = z.enum([
  "idle",
  "running",
  "blocked_approval",
  "error",
]);

export const runStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "interrupted",
]);

export const approvalStatusSchema = z.enum([
  "pending",
  "approved_once",
  "approved_turn",
  "rejected",
]);

export const timelineEventSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    sessionId: z.string(),
    runId: z.string(),
    type: z.literal("user_message"),
    text: z.string(),
    ts: z.string(),
  }),
  z.object({
    id: z.string(),
    sessionId: z.string(),
    runId: z.string(),
    type: z.literal("assistant_message"),
    text: z.string(),
    ts: z.string(),
  }),
  z.object({
    id: z.string(),
    sessionId: z.string(),
    runId: z.string(),
    type: z.literal("command"),
    cmd: z.string(),
    status: z.enum(["running", "done", "failed"]),
    ts: z.string(),
  }),
  z.object({
    id: z.string(),
    sessionId: z.string(),
    runId: z.string(),
    type: z.literal("approval_required"),
    approvalId: z.string(),
    scope: z.string(),
    ts: z.string(),
  }),
  z.object({
    id: z.string(),
    sessionId: z.string(),
    runId: z.string(),
    type: z.literal("patch_summary"),
    files: z.array(z.string()),
    summary: z.string(),
    ts: z.string(),
  }),
  z.object({
    id: z.string(),
    sessionId: z.string(),
    runId: z.string(),
    type: z.literal("system"),
    text: z.string(),
    ts: z.string(),
  }),
]);

export const sessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectPath: z.string(),
  status: sessionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunId: z.string().nullable().optional(),
  runtimeThreadId: z.string().nullable().optional(),
});

export const runSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  prompt: z.string(),
  status: runStatusSchema,
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});

export const approvalRequestSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  runId: z.string(),
  scope: z.string(),
  reason: z.string(),
  status: approvalStatusSchema,
  createdAt: z.string(),
});

export const sessionSnapshotSchema = z.object({
  session: sessionSchema,
  runs: z.array(runSchema),
  events: z.array(timelineEventSchema),
  approvals: z.array(approvalRequestSchema),
});

export const sessionSummarySchema = sessionSchema.pick({
  id: true,
  title: true,
  projectPath: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  lastRunId: true,
  runtimeThreadId: true,
});

export const codexSessionSummarySchema = z.object({
  threadId: z.string(),
  title: z.string(),
  projectPath: z.string(),
  updatedAt: z.string(),
  importedSessionId: z.string().nullable(),
});

export const remoteRoleSchema = z.enum(["app", "agent"]);

export const remoteNamespaceSchema = z.enum([
  "bridge",
  "health",
  "pairing",
  "system",
]);

export const remoteRequestActionSchema = z.enum([
  "health",
  "list_sessions",
  "list_codex_sessions",
  "create_session",
  "import_codex_session",
  "get_snapshot",
  "send_message",
  "interrupt",
  "approve_once",
  "approve_turn",
  "reject_approval",
  "subscribe_session",
  "unsubscribe_session",
]);

export const remoteEventActionSchema = z.enum([
  "connected",
  "peer_connected",
  "peer_disconnected",
  "heartbeat",
  "timeline_event",
  "agent_status",
]);

const remoteBaseMessageSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  ns: remoteNamespaceSchema,
  action: z.string().min(1),
  ts: z.number().int().nonnegative(),
});

export const remoteRequestSchema = remoteBaseMessageSchema.extend({
  kind: z.literal("request"),
  action: remoteRequestActionSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const remoteResponseSchema = remoteBaseMessageSchema.extend({
  kind: z.literal("response"),
  ok: z.boolean(),
  payload: z.record(z.string(), z.unknown()).default({}),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export const remoteEventSchema = remoteBaseMessageSchema.extend({
  kind: z.literal("event"),
  action: remoteEventActionSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const remoteMessageSchema = z.discriminatedUnion("kind", [
  remoteRequestSchema,
  remoteResponseSchema,
  remoteEventSchema,
]);
