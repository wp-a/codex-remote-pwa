import { describe, expect, it } from "vitest";

import type { Session } from "@codex-remote/shared";

import {
  resolveInitialSessionId,
  selectionStorageKey,
} from "./session-preferences.js";

const sessions: Session[] = [
  {
    id: "manual",
    title: "Manual session",
    projectPath: "/workspace/manual",
    status: "idle",
    createdAt: "2026-07-18T09:00:00.000Z",
    updatedAt: "2026-07-18T09:00:00.000Z",
    runtimeThreadId: null,
  },
  {
    id: "imported",
    title: "Imported session",
    projectPath: "/workspace/imported",
    status: "idle",
    createdAt: "2026-07-18T10:00:00.000Z",
    updatedAt: "2026-07-18T10:00:00.000Z",
    runtimeThreadId: "thread_1",
  },
];

describe("session preferences", () => {
  it("scopes the selection key by connection mode and normalized base URL", () => {
    expect(selectionStorageKey("direct", "https://bridge.example.test/")).toBe(
      "codex-remote.selected-session.direct.https%3A%2F%2Fbridge.example.test",
    );
    expect(selectionStorageKey("relay", "https://bridge.example.test/")).not.toBe(
      selectionStorageKey("direct", "https://bridge.example.test/"),
    );
  });

  it("restores a saved bridge session when it still exists", () => {
    expect(resolveInitialSessionId(sessions, "manual")).toBe("manual");
  });

  it("falls back to the first imported bridge session", () => {
    expect(resolveInitialSessionId(sessions, "missing")).toBe("imported");
  });

  it("falls back to the first bridge session, then null", () => {
    expect(resolveInitialSessionId([sessions[0]!], null)).toBe("manual");
    expect(resolveInitialSessionId([], "missing")).toBeNull();
  });
});
