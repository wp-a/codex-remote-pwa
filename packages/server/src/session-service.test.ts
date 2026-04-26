import { afterEach, describe, expect, it } from "vitest";

import { SqliteStore } from "./db.js";
import { EventBus } from "./event-bus.js";
import { SessionService } from "./session-service.js";

describe("SessionService", () => {
  let store: SqliteStore | null = null;

  afterEach(() => {
    store?.close();
    store = null;
  });

  it("creates sessions and publishes new timeline events", () => {
    store = new SqliteStore(":memory:");

    const bus = new EventBus();
    const service = new SessionService(store, bus);
    const session = service.createSession({
      title: "Demo Session",
      projectPath: "/workspace/demo",
    });

    const received: string[] = [];
    const unsubscribe = bus.subscribe(session.id, (event) => {
      received.push(event.type);
    });

    const run = service.startRun({
      sessionId: session.id,
      prompt: "Summarize the repository",
    });

    const snapshot = service.getSnapshot(session.id);
    unsubscribe();

    expect(run.status).toBe("running");
    expect(snapshot.session.status).toBe("running");
    expect(snapshot.events[0]?.type).toBe("user_message");
    expect(received).toEqual(["user_message"]);
  });
});
