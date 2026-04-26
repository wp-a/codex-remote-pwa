import type { TimelineEvent } from "@codex-remote/shared";

type SessionListener = (event: TimelineEvent) => void;

export class EventBus {
  private readonly listeners = new Map<string, Set<SessionListener>>();

  subscribe(sessionId: string, listener: SessionListener): () => void {
    const listeners = this.listeners.get(sessionId) ?? new Set<SessionListener>();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);

    return () => {
      const current = this.listeners.get(sessionId);
      if (!current) {
        return;
      }

      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  publish(sessionId: string, event: TimelineEvent): void {
    for (const listener of this.listeners.get(sessionId) ?? []) {
      listener(event);
    }
  }
}
