import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { loadRolloutHistory } from "./rollout-history.js";

describe("loadRolloutHistory", () => {
  let fixtureDir: string | null = null;

  afterEach(() => {
    if (fixtureDir) {
      rmSync(fixtureDir, { force: true, recursive: true });
      fixtureDir = null;
    }
  });

  it("extracts recent visible user and assistant messages from a native rollout", () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "codex-rollout-history-"));
    const rolloutPath = join(fixtureDir, "rollout.jsonl");

    writeFileSync(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: "2026-04-18T09:00:00.000Z",
          type: "session_meta",
          payload: { id: "thread_1" },
        }),
        JSON.stringify({
          timestamp: "2026-04-18T09:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "system prompt" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-18T09:00:02.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "<environment_context>\n  <cwd>/workspace/demo</cwd>\n</environment_context>",
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-18T09:00:03.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "# AGENTS.md instructions\n\n<INSTRUCTIONS>\nInternal operating notes\n</INSTRUCTIONS>",
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-18T09:00:03.100Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "<in-app-browser-context source=\"ambient-ui-state\">\nBrowser state\n</in-app-browser-context>\n\n## My request for Codex:\n帮我检查这个仓库",
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-18T09:00:03.200Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "帮我检查这个仓库" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-18T09:00:04.000Z",
          type: "response_item",
          payload: {
            type: "reasoning",
            summary: [],
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-18T09:00:04.500Z",
          type: "event_msg",
          payload: {
            type: "context_compacted",
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-18T09:00:05.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "我先查看目录结构。" }],
            phase: "commentary",
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-18T09:00:06.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-18T09:00:06.500Z",
          type: "compacted",
          payload: {
            replacement_history: [],
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-18T09:00:07.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "仓库使用 Node.js 和 Vite。" }],
          },
        }),
      ].join("\n"),
    );

    expect(loadRolloutHistory(rolloutPath, { limit: 2 })).toEqual([
      {
        role: "context_compaction",
        ts: "2026-04-18T09:00:06.500Z",
      },
      {
        role: "assistant",
        text: "仓库使用 Node.js 和 Vite。",
        ts: "2026-04-18T09:00:07.000Z",
      },
    ]);

    expect(loadRolloutHistory(rolloutPath, { limit: 10 })).toEqual([
      {
        role: "user",
        text: "帮我检查这个仓库",
        ts: "2026-04-18T09:00:03.200Z",
      },
      {
        role: "context_compaction",
        ts: "2026-04-18T09:00:04.500Z",
      },
      {
        role: "assistant",
        text: "我先查看目录结构。",
        ts: "2026-04-18T09:00:05.000Z",
      },
      {
        role: "context_compaction",
        ts: "2026-04-18T09:00:06.500Z",
      },
      {
        role: "assistant",
        text: "仓库使用 Node.js 和 Vite。",
        ts: "2026-04-18T09:00:07.000Z",
      },
    ]);
  });

  it("skips only a complete turn-aborted protocol envelope", () => {
    fixtureDir = mkdtempSync(join(tmpdir(), "codex-rollout-history-"));
    const rolloutPath = join(fixtureDir, "rollout.jsonl");

    writeFileSync(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: "2026-07-18T10:00:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "  <turn_aborted>\nThe user intentionally interrupted the previous turn.\n</turn_aborted>  ",
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-18T10:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "<turn_aborted> is an XML tag, not a command.",
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-18T10:00:02.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "<turn_aborted>" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-18T10:00:03.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "<turn_aborted>protocol</turn_aborted>\n继续执行",
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-18T10:00:04.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "继续检查" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-18T10:00:05.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "继续处理。" }],
          },
        }),
      ].join("\n"),
    );

    expect(loadRolloutHistory(rolloutPath)).toEqual([
      {
        role: "user",
        text: "<turn_aborted> is an XML tag, not a command.",
        ts: "2026-07-18T10:00:01.000Z",
      },
      {
        role: "user",
        text: "<turn_aborted>",
        ts: "2026-07-18T10:00:02.000Z",
      },
      {
        role: "user",
        text: "<turn_aborted>protocol</turn_aborted>\n继续执行",
        ts: "2026-07-18T10:00:03.000Z",
      },
      {
        role: "user",
        text: "继续检查",
        ts: "2026-07-18T10:00:04.000Z",
      },
      {
        role: "assistant",
        text: "继续处理。",
        ts: "2026-07-18T10:00:05.000Z",
      },
    ]);
  });
});
