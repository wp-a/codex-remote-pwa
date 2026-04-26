import type { TimelineEvent } from "@codex-remote/shared";

export type RealtimeClient = {
  connect: (
    sessionId: string,
    onEvent: (event: TimelineEvent) => void,
  ) => () => void;
};

type CreateRealtimeClientOptions = {
  wsBaseUrl: string;
  token: string;
};

export function createRealtimeClient(
  options: CreateRealtimeClientOptions,
): RealtimeClient {
  return {
    connect(sessionId, onEvent) {
      const socket = new WebSocket(
        `${options.wsBaseUrl}/api/sessions/${sessionId}/stream?token=${encodeURIComponent(options.token)}`,
      );

      socket.addEventListener("message", (event) => {
        onEvent(JSON.parse(String(event.data)) as TimelineEvent);
      });

      return () => {
        socket.close();
      };
    },
  };
}
