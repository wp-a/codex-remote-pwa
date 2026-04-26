import type { SessionStatus, TimelineEvent } from "@codex-remote/shared";

export function sessionStatusLabel(status: SessionStatus): string {
  switch (status) {
    case "idle":
      return "空闲";
    case "running":
      return "运行中";
    case "blocked_approval":
      return "等待授权";
    case "error":
      return "异常";
  }
}

export function approvalScopeLabel(scope: string): string {
  switch (scope) {
    case "network":
      return "网络";
    case "filesystem":
      return "文件系统";
    case "dangerous":
      return "高风险操作";
    default:
      return scope;
  }
}

export function timelineEventLabel(event: TimelineEvent): string {
  switch (event.type) {
    case "assistant_message":
    case "patch_summary":
    case "system":
      return "最后输出";
    case "command":
      return "运行状态";
    case "user_message":
      return "你的任务";
    case "approval_required":
      return "授权请求";
  }
}

export function timelineEventText(event: TimelineEvent): string {
  switch (event.type) {
    case "user_message":
    case "assistant_message":
    case "system":
      return event.text;
    case "command":
      return `${commandStatusLabel(event.status)}: ${event.cmd}`;
    case "approval_required":
      return `需要授权：${approvalScopeLabel(event.scope)}`;
    case "patch_summary":
      return event.summary;
  }
}

function commandStatusLabel(status: "running" | "done" | "failed"): string {
  switch (status) {
    case "running":
      return "执行中";
    case "done":
      return "已完成";
    case "failed":
      return "失败";
  }
}
