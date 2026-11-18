import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  isHumanFacingCodexThreadTitle,
  LocalCodexSessions,
} from "./local-codex-sessions.js";

describe("isHumanFacingCodexThreadTitle", () => {
  it("rejects internal prefixes, blank titles, and protocol-only payloads", () => {
    expect(isHumanFacingCodexThreadTitle("  <codex_delegation>worker")).toBe(false);
    expect(isHumanFacingCodexThreadTitle("\n<environment_context>state")).toBe(false);
    expect(isHumanFacingCodexThreadTitle(" <in-app-browser-context source=\"ambient\">"))
      .toBe(false);
    expect(isHumanFacingCodexThreadTitle("   \n\t")).toBe(false);
    expect(isHumanFacingCodexThreadTitle("<protocol></protocol>"))
      .toBe(false);
  });

  it("keeps human titles that contain angle brackets later", () => {
    expect(isHumanFacingCodexThreadTitle("Fix <Button> spacing"))
      .toBe(true);
  });
});

describe("LocalCodexSessions", () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { force: true, recursive: true });
      tempDir = null;
    }
  });

  it("iterates past newer internal threads to collect 30 human results", () => {
    tempDir = mkdtempSync(join(tmpdir(), "codex-state-"));
    const dbPath = join(tempDir, "state.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      create table threads (
        id text primary key,
        title text not null,
        cwd text not null,
        rollout_path text,
        updated_at_ms integer
      )
    `);

    const insert = db.prepare(`
      insert into threads (id, title, cwd, rollout_path, updated_at_ms)
      values (?, ?, ?, null, ?)
    `);

    for (let index = 0; index < 31; index += 1) {
      insert.run(
        `human_${index}`,
        `Human task ${index}`,
        `/workspace/${index}`,
        1_000 + index,
      );
    }

    for (let index = 0; index < 101; index += 1) {
      insert.run(
        `internal_${index}`,
        `<codex_delegation>delegate ${index}`,
        "/workspace/internal",
        2_000 + index,
      );
    }
    db.close();

    const sessions = new LocalCodexSessions(dbPath).listRecent();

    expect(sessions).toHaveLength(30);
    expect(sessions.map((session) => session.threadId)).toEqual(
      Array.from({ length: 30 }, (_, index) => `human_${30 - index}`),
    );
    expect(new LocalCodexSessions(dbPath).getByThreadId("human_0"))
      .toMatchObject({ threadId: "human_0", title: "Human task 0" });
  });

  it("returns only interactive root threads from a modern Codex state database", () => {
    tempDir = mkdtempSync(join(tmpdir(), "codex-state-"));
    const dbPath = join(tempDir, "state.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      create table threads (
        id text primary key,
        title text not null,
        cwd text not null,
        rollout_path text,
        updated_at_ms integer,
        source text,
        thread_source text,
        archived integer not null default 0
      );
      create table thread_spawn_edges (
        parent_thread_id text not null,
        child_thread_id text not null primary key,
        status text not null
      );
    `);

    const insert = db.prepare(`
      insert into threads (
        id,
        title,
        cwd,
        rollout_path,
        updated_at_ms,
        source,
        thread_source,
        archived
      ) values (?, ?, ?, null, ?, ?, ?, ?)
    `);

    insert.run("user_vscode", "Fix the settings screen", "/workspace/app", 100, "vscode", "user", 0);
    insert.run("user_cli", "Review the release", "/workspace/app", 110, "cli", "user", 0);
    insert.run("legacy_root", "Legacy root conversation", "/workspace/app", 120, "vscode", null, 0);
    insert.run("typed_subagent", "Audit the implementation", "/workspace/app", 200, "vscode", "subagent", 0);
    insert.run("automation", "Prepare the scheduled report", "/workspace/app", 210, "vscode", "automation", 0);
    insert.run(
      "exec_worker",
      "Rebuild one page for image-to-editable-ppt. Run dir: /private/tmp/page",
      "/workspace/app",
      220,
      "exec",
      "user",
      0,
    );
    insert.run("archived_root", "Old root conversation", "/workspace/app", 230, "vscode", "user", 1);
    insert.run("edge_child", "Check mobile rendering", "/workspace/app", 240, "vscode", null, 0);
    db.prepare(`
      insert into thread_spawn_edges (parent_thread_id, child_thread_id, status)
      values (?, ?, ?)
    `).run("user_vscode", "edge_child", "closed");
    db.close();

    const source = new LocalCodexSessions(dbPath);

    expect(source.listRecent().map((session) => session.threadId))
      .toEqual(["legacy_root", "user_cli", "user_vscode"]);
    for (const internalId of [
      "typed_subagent",
      "automation",
      "exec_worker",
      "archived_root",
      "edge_child",
    ]) {
      expect(source.getByThreadId(internalId)).toBeNull();
    }
  });

  it("gets a valid root beyond the recent-list limit by id", () => {
    tempDir = mkdtempSync(join(tmpdir(), "codex-state-"));
    const dbPath = join(tempDir, "state.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      create table threads (
        id text primary key,
        title text not null,
        cwd text not null,
        rollout_path text,
        updated_at_ms integer,
        source text,
        thread_source text,
        archived integer not null default 0
      );
      create table thread_spawn_edges (
        parent_thread_id text not null,
        child_thread_id text not null primary key,
        status text not null
      );
    `);

    const insert = db.prepare(`
      insert into threads (
        id,
        title,
        cwd,
        rollout_path,
        updated_at_ms,
        source,
        thread_source,
        archived
      ) values (?, ?, ?, null, ?, 'vscode', 'user', 0)
    `);
    for (let index = 0; index < 31; index += 1) {
      insert.run(
        `root_${index}`,
        `Root conversation ${index}`,
        `/workspace/${index}`,
        1_000 + index,
      );
    }
    db.close();

    const source = new LocalCodexSessions(dbPath);

    expect(source.listRecent().map((session) => session.threadId))
      .not.toContain("root_0");
    expect(source.getByThreadId("root_0")).toMatchObject({
      threadId: "root_0",
      title: "Root conversation 0",
    });
  });

  it("keeps scanning after 101 naturally titled subagents to collect 30 roots", () => {
    tempDir = mkdtempSync(join(tmpdir(), "codex-state-"));
    const dbPath = join(tempDir, "state.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      create table threads (
        id text primary key,
        title text not null,
        cwd text not null,
        rollout_path text,
        updated_at_ms integer,
        source text,
        thread_source text,
        archived integer not null default 0
      );
      create table thread_spawn_edges (
        parent_thread_id text not null,
        child_thread_id text not null primary key,
        status text not null
      );
    `);

    const insert = db.prepare(`
      insert into threads (
        id,
        title,
        cwd,
        rollout_path,
        updated_at_ms,
        source,
        thread_source,
        archived
      ) values (?, ?, ?, null, ?, ?, ?, 0)
    `);

    for (let index = 0; index < 30; index += 1) {
      insert.run(
        `root_${index}`,
        `Root conversation ${index}`,
        `/workspace/${index}`,
        1_000 + index,
        "vscode",
        "user",
      );
    }

    for (let index = 0; index < 101; index += 1) {
      insert.run(
        `subagent_${index}`,
        `Review component ${index}`,
        "/workspace/internal",
        2_000 + index,
        "vscode",
        "subagent",
      );
    }
    db.close();

    const sessions = new LocalCodexSessions(dbPath).listRecent();

    expect(sessions).toHaveLength(30);
    expect(sessions.map((session) => session.threadId)).toEqual(
      Array.from({ length: 30 }, (_, index) => `root_${29 - index}`),
    );
  });
});
