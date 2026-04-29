import type {
  RuntimeAdapter,
  RuntimeSignal,
  RuntimeTurnInput,
} from "./codex-runtime.js";

type JsonRpcRequest = {
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcNotification = {
  method: string;
  params?: Record<string, unknown>;
};

type ThreadStartResponse = {
  thread?: {
    id?: string;
  };
};

type TurnStartResponse = {
  turn?: {
    id?: string;
  };
};

type CommandExecutionItem = {
  type: "commandExecution";
  id: string;
  command: string;
  status: "inProgress" | "completed" | "failed" | "declined";
  aggregatedOutput: string | null;
  exitCode: number | null;
};

type AgentMessageItem = {
  type: "agentMessage";
  id: string;
  text: string;
};

type ItemNotification = {
  threadId?: string;
  turnId?: string;
  item?: CommandExecutionItem | AgentMessageItem | { type: string; id: string };
};

type TurnCompletedNotification = {
  threadId?: string;
  turn?: {
    id?: string;
    status?: "completed" | "interrupted" | "failed" | "inProgress";
    error?: TurnError | null;
  };
};

type TurnStatus = NonNullable<TurnCompletedNotification["turn"]>["status"];

type TurnError = {
  message?: string | null;
  codexErrorInfo?: unknown;
  additionalDetails?: string | null;
};

type ErrorNotification = {
  threadId?: string;
  turnId?: string;
  error?: TurnError | null;
  willRetry?: boolean;
};

type PermissionsApprovalRequest = {
  threadId?: string;
  turnId?: string;
  itemId?: string;
  reason?: string | null;
  permissions?: {
    network?: {
      enabled?: boolean | null;
    } | null;
    fileSystem?: {
      read?: string[] | null;
      write?: string[] | null;
    } | null;
  } | null;
};

type CommandApprovalRequest = {
  threadId?: string;
  turnId?: string;
  itemId?: string;
  reason?: string | null;
  additionalPermissions?: {
    network?: {
      enabled?: boolean | null;
    } | null;
    fileSystem?: {
      read?: string[] | null;
      write?: string[] | null;
    } | null;
  } | null;
  command?: string | null;
};

type FileChangeApprovalRequest = {
  threadId?: string;
  turnId?: string;
  itemId?: string;
  reason?: string | null;
};

function filesystemRequested(
  permissions:
    | {
        fileSystem?: {
          read?: string[] | null;
          write?: string[] | null;
        } | null;
      }
    | undefined
    | null,
): boolean {
  const fileSystem = permissions?.fileSystem;
  return Boolean(fileSystem?.read?.length || fileSystem?.write?.length);
}

function isCommandExecutionItem(
  item: ItemNotification["item"] | undefined,
): item is CommandExecutionItem {
  return item?.type === "commandExecution";
}

function isAgentMessageItem(
  item: ItemNotification["item"] | undefined,
): item is AgentMessageItem {
  return item?.type === "agentMessage";
}

export class AppServerAdapter implements RuntimeAdapter {
  buildInvocation(_input: Omit<RuntimeTurnInput, "sessionId">): {
    command: string;
    args: string[];
  } {
    throw new Error("AppServerAdapter does not spawn local commands.");
  }

  buildInitializeParams() {
    return {
      clientInfo: {
        name: "codex-remote-pwa",
        title: "Codex Remote PWA",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    };
  }

  buildThreadStartParams(input: Pick<RuntimeTurnInput, "cwd">) {
    return {
      cwd: input.cwd,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    };
  }

  buildThreadResumeParams(input: Pick<RuntimeTurnInput, "cwd"> & { threadId: string }) {
    return {
      threadId: input.threadId,
      cwd: input.cwd,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      persistExtendedHistory: true,
    };
  }

  buildTurnStartParams(input: Omit<RuntimeTurnInput, "sessionId"> & { threadId: string }) {
    return {
      threadId: input.threadId,
      cwd: input.cwd,
      input: [
        {
          type: "text",
          text: input.prompt,
          text_elements: [],
        },
      ],
    };
  }

  buildInterruptParams(threadId: string, turnId: string) {
    return {
      threadId,
      turnId,
    };
  }

  getThreadIdFromThreadStartResponse(result: unknown): string | null {
    return (result as ThreadStartResponse | undefined)?.thread?.id ?? null;
  }

  getThreadIdFromThreadResumeResponse(result: unknown): string | null {
    return (result as ThreadStartResponse | undefined)?.thread?.id ?? null;
  }

  getTurnIdFromTurnStartResponse(result: unknown): string | null {
    return (result as TurnStartResponse | undefined)?.turn?.id ?? null;
  }

  getTurnCompletedStatus(
    notification: JsonRpcNotification,
  ): TurnStatus | null {
    return (notification.params as TurnCompletedNotification | undefined)?.turn?.status ?? null;
  }

  getTurnCompletedError(notification: JsonRpcNotification): string | null {
    const error = (notification.params as TurnCompletedNotification | undefined)?.turn?.error;
    return formatTurnError(error);
  }

  getTurnCompletedIds(notification: JsonRpcNotification): {
    threadId: string | null;
    turnId: string | null;
  } {
    const payload = notification.params as TurnCompletedNotification | undefined;
    return {
      threadId: payload?.threadId ?? null,
      turnId: payload?.turn?.id ?? null,
    };
  }

  getTurnStartedIds(notification: JsonRpcNotification): {
    threadId: string | null;
    turnId: string | null;
  } {
    const payload = notification.params as {
      threadId?: string;
      turn?: { id?: string };
    };
    return {
      threadId: payload?.threadId ?? null,
      turnId: payload?.turn?.id ?? null,
    };
  }

  parseNotification(notification: JsonRpcNotification): RuntimeSignal[] {
    if (notification.method === "error") {
      const error = (notification.params as ErrorNotification | undefined)?.error;
      const text = formatTurnError(error);
      return text ? [{ type: "system_message", text }] : [];
    }

    if (notification.method === "item/started") {
      const item = (notification.params as ItemNotification | undefined)?.item;
      if (isCommandExecutionItem(item)) {
        return [
          {
            type: "command",
            commandId: item.id,
            command: item.command,
            status: "running",
            output: item.aggregatedOutput,
            exitCode: item.exitCode,
          },
        ];
      }
    }

    if (notification.method === "item/completed") {
      const item = (notification.params as ItemNotification | undefined)?.item;
      if (isAgentMessageItem(item)) {
        return item.text ? [{ type: "assistant_message", text: item.text }] : [];
      }

      if (isCommandExecutionItem(item)) {
        return [
          {
            type: "command",
            commandId: item.id,
            command: item.command,
            status: item.status === "failed" ? "failed" : "done",
            output: item.aggregatedOutput,
            exitCode: item.exitCode,
          },
        ];
      }
    }

    return [];
  }

  parseServerRequest(request: JsonRpcRequest): RuntimeSignal[] {
    if (request.method === "item/permissions/requestApproval") {
      const params = request.params as PermissionsApprovalRequest | undefined;
      if (!params) {
        return [];
      }

      const scope = params.permissions?.network?.enabled
        ? "network"
        : filesystemRequested(params.permissions)
          ? "filesystem"
          : "dangerous";

      return [
        this.approvalSignal(
          request.id,
          params.threadId,
          params.turnId,
          params.itemId,
          scope,
          params.reason,
        ),
      ];
    }

    if (request.method === "item/commandExecution/requestApproval") {
      const params = request.params as CommandApprovalRequest | undefined;
      if (!params) {
        return [];
      }

      const scope = params.additionalPermissions?.network?.enabled
        ? "network"
        : filesystemRequested(params.additionalPermissions)
          ? "filesystem"
          : "dangerous";

      return [
        this.approvalSignal(
          request.id,
          params.threadId,
          params.turnId,
          params.itemId,
          scope,
          params.reason ?? params.command ?? "需要命令执行授权",
        ),
      ];
    }

    if (request.method === "item/fileChange/requestApproval") {
      const params = request.params as FileChangeApprovalRequest | undefined;
      if (!params) {
        return [];
      }

      return [
        this.approvalSignal(
          request.id,
          params.threadId,
          params.turnId,
          params.itemId,
          "filesystem",
          params.reason ?? "需要文件修改授权",
        ),
      ];
    }

    return [];
  }

  parseStdoutLine(_line: string): RuntimeSignal[] {
    return [];
  }

  parseStderrLine(line: string): RuntimeSignal[] {
    const text = line.trim();
    return text ? [{ type: "system_message", text }] : [];
  }

  private approvalSignal(
    requestId: number | string,
    threadId: string | undefined,
    turnId: string | undefined,
    itemId: string | undefined,
    scope: string,
    reason: string | null | undefined,
  ): RuntimeSignal {
    return {
      type: "approval_request",
      requestId: String(requestId),
      threadId: threadId ?? "",
      turnId: turnId ?? "",
      itemId: itemId ?? "",
      scope,
      reason: reason?.trim() || `需要${scope}授权`,
    };
  }
}

function formatTurnError(error: TurnError | null | undefined): string | null {
  const message = error?.message?.trim();
  if (!message) {
    return null;
  }

  if (
    error?.codexErrorInfo === "unauthorized" ||
    message.toLowerCase().includes("invalidated oauth token")
  ) {
    return `Codex 登录已失效，请重新登录后再发送消息。原始错误：${message}`;
  }

  return `App-server turn failed: ${message}`;
}
