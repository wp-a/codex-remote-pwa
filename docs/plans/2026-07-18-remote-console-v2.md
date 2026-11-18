# Codex Remote Console V2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a one-command launcher and a task-first responsive PWA that restores the last session, surfaces recent Codex threads directly, and moves low-frequency connection controls out of the chat flow.

**Architecture:** A root Node launcher owns durable local configuration, address discovery, child-process lifecycle, and terminal QR output. The existing bridge remains the authenticated API boundary and adds read-only access metadata plus internal-thread filtering. The React client adopts explicit Home, Chat, Session Picker, and Settings surfaces while preserving Direct and Relay transports.

**Tech Stack:** Node.js ESM, TypeScript, React 19, Express 5, Vitest, Node test runner, Vite, lucide-react, qrcode

---

## Parallel Ownership

- Launcher owner: `scripts/**`, root `package.json`, root `package-lock.json` only.
- Server/data owner: `packages/server/**` and `packages/shared/**` only.
- Web owner: `packages/web/**` only.
- Integrator: README, full verification, browser QA, and cross-owner conflict resolution.

No agent may revert or reformat pre-existing uncommitted changes. Each agent must inspect the current diff before editing and use TDD.

### Task 1: Durable Launcher Configuration And Address Discovery

**Files:**
- Create: `scripts/remote-config.mjs`
- Create: `scripts/remote-config.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Write failing config tests**

Use `node:test` with a temporary home directory. Cover:

```js
test("creates a 0600 config with a 256-bit token and stable port", async () => {
  const first = await loadOrCreateRemoteConfig({ homeDir, randomBytes });
  const second = await loadOrCreateRemoteConfig({ homeDir, randomBytes });
  assert.equal(first.token, second.token);
  assert.equal(first.port, 8790);
  assert.equal((await stat(first.path)).mode & 0o777, 0o600);
  assert.match(first.token, /^[a-f0-9]{64}$/);
});
```

Add pure tests for LAN/Tailscale URL construction and preference order: connected Tailscale, then LAN, then loopback.

**Step 2: Verify RED**

Run: `node --test scripts/remote-config.test.mjs`

Expected: FAIL because `remote-config.mjs` does not exist.

**Step 3: Implement minimal config module**

Export:

```js
export async function loadOrCreateRemoteConfig(options = {}) { /* 0600 JSON */ }
export function buildAccessCandidates({ port, token, lanAddresses, tailscaleAddress }) { /* URLs */ }
export function choosePreferredAccessUrl(candidates) { /* tailscale > lan > local */ }
```

Use `crypto.randomBytes(32).toString("hex")`, exclusive atomic publication from a private temporary file, and explicit `chmod(0o600)`.

**Step 4: Verify GREEN**

Run: `node --test scripts/remote-config.test.mjs`

Expected: all config tests pass.

**Step 5: Add dependencies**

Add `qrcode` as a root dependency. Do not add a general launcher framework.

### Task 2: One-Command Process Orchestration

**Files:**
- Create: `scripts/remote-launcher.mjs`
- Create: `scripts/remote-launcher.test.mjs`
- Create: `scripts/start-remote.mjs`
- Modify: `package.json`

**Step 1: Write failing lifecycle tests**

Inject port probing, spawn, logging, signal registration, and exit handling. Cover:

- Missing `packages/server/dist/index.js` reports `npm run build` and exits 1.
- Occupied configured port reports the port and exits before spawning.
- Both children receive the resolved app-server URL, token, and port; the bridge starts with an empty candidate set until verification completes.
- SIGINT terminates both children once.
- Required child failure terminates its sibling and returns non-zero.

**Step 2: Verify RED**

Run: `node --test scripts/remote-launcher.test.mjs`

Expected: FAIL because launcher exports do not exist.

**Step 3: Implement orchestration**

Export a dependency-injected `runRemoteLauncher(options)` from `remote-launcher.mjs`. Keep `start-remote.mjs` as a thin executable entrypoint. Use the existing `codex` binary and compiled server entrypoint. Detect addresses with `os.networkInterfaces()` and read-only `tailscale ip -4` only when the binary is present.

Print a compact access panel and terminal QR for the preferred URL. Redact the raw token from standalone logs; it appears only inside the access URL.

**Step 4: Verify GREEN**

Run: `node --test scripts/remote-config.test.mjs scripts/remote-launcher.test.mjs`

Expected: all launcher tests pass.

**Step 5: Wire root scripts**

Add:

```json
"remote": "node scripts/start-remote.mjs",
"test:launcher": "node --test scripts/*.test.mjs"
```

Update root `test` so launcher tests run before workspace tests.

### Task 3: Authenticated Access Metadata And Thread Hygiene

**Files:**
- Create: `packages/server/src/access-info.ts`
- Create: `packages/server/src/access-info.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/http.ts`
- Modify: `packages/server/src/http.test.ts`
- Modify: `packages/server/src/local-codex-sessions.ts`
- Modify: `packages/server/src/db.test.ts` or create `packages/server/src/local-codex-sessions.test.ts`
- Modify: `packages/shared/src/schema.ts`
- Modify: `packages/shared/src/index.test.ts`

**Step 1: Write failing access parsing tests**

Define a shared `accessCandidateSchema` with `kind: "local" | "lan" | "tailscale"`, `label`, and validated HTTP(S) `url`. Test valid JSON, malformed JSON fallback, duplicate removal, and maximum candidate count.

**Step 2: Verify RED**

Run: `npm test --workspace @codex-remote/server -- --run src/access-info.test.ts`

Expected: FAIL because parsing and schema support do not exist.

**Step 3: Implement and expose metadata**

Parse `CODEX_REMOTE_ACCESS_CANDIDATES` in `index.ts` as the initial value and include the current value in authenticated `/api/health`. After readiness, the launcher verifies every candidate origin and publishes only the verified set through a Bearer-authenticated, loopback-only update endpoint. Never add an unauthenticated access endpoint.

**Step 4: Write failing thread hygiene test**

Populate a temporary Codex state database with normal titles and internal titles beginning with `<codex_delegation>`, `<environment_context>`, or blank protocol payloads. Assert `listRecent()` returns only human-facing threads while preserving sort order and the 30-item cap.

**Step 5: Implement minimal filtering**

Filter after the database query through a pure predicate. Do not rewrite stored Codex state or hide ordinary titles containing angle brackets later in the string.

**Step 6: Verify GREEN**

Run: `npm test --workspace @codex-remote/server`

Run: `npm test --workspace @codex-remote/shared`

Expected: all server/shared tests pass.

### Task 4: Session Restoration And Explicit App States

**Files:**
- Create: `packages/web/src/session-preferences.ts`
- Create: `packages/web/src/session-preferences.test.ts`
- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/src/app.tsx`
- Modify: `packages/web/src/app.test.tsx`

**Step 1: Write failing preference tests**

Test a storage key scoped by mode and base URL, valid saved-session restoration, missing-session fallback to the first imported session, and no automatic native-thread import.

**Step 2: Verify RED**

Run: `npm test --workspace @codex-remote/web -- --run src/session-preferences.test.ts src/app.test.tsx`

Expected: new tests fail because selection is not persisted or restored.

**Step 3: Implement pure selection helpers**

Export:

```ts
export function selectionStorageKey(mode: ConnectionMode, baseUrl: string): string;
export function resolveInitialSessionId(sessions: Session[], savedId: string | null): string | null;
```

Keep localStorage reads/writes at the App boundary. Persist only after successful selection/import.

**Step 4: Model Home and Chat states**

Derive `viewState` from selected session and load status. Home renders recent native threads directly; Chat renders an active snapshot. Preserve drafts across transient health failures.

**Step 5: Verify GREEN**

Run: `npm test --workspace @codex-remote/web -- --run src/session-preferences.test.ts src/app.test.tsx`

Expected: all state-flow tests pass.

### Task 5: Task-First Responsive Interface

**Files:**
- Create: `packages/web/src/components/app-header.tsx`
- Create: `packages/web/src/components/home-view.tsx`
- Create: `packages/web/src/components/session-picker.tsx`
- Create: `packages/web/src/components/settings-sheet.tsx`
- Create corresponding `*.test.tsx` files
- Modify: `packages/web/src/app.tsx`
- Modify: `packages/web/src/components/session-list.tsx`
- Modify: `packages/web/src/components/composer.tsx`
- Modify: `packages/web/src/components/timeline.tsx`
- Modify: `packages/web/src/styles.css`
- Modify: `packages/web/package.json`
- Modify: `package-lock.json` only through launcher owner coordination

**Step 1: Add `lucide-react` through the designated dependency owner**

Use lucide icons for menu, settings, search, copy, QR, close, stop, and send. Every icon-only button needs an accessible name and tooltip/title.

**Step 2: Write failing component tests**

Cover:

- Home shows recent threads without opening a drawer.
- Picker Recent/Saved segmented control and search filter.
- Settings contains connection/share/manual-create controls and picker does not.
- Chat has one visible title/status source and no command deck.
- Running sessions show stop action; idle sessions do not.
- Composer remains enabled only for a selected writable idle session.

**Step 3: Verify RED**

Run: `npm test --workspace @codex-remote/web`

Expected: new component expectations fail against the old drawer/command-deck UI.

**Step 4: Implement structural components**

Keep App as state coordinator. Components receive data and callbacks; they do not create API clients or read global storage. Use a mobile bottom sheet and a desktop sidebar from the same picker component.

**Step 5: Replace the visual system**

Rewrite only selectors owned by the new structure. Use solid surfaces, 1px borders, maximum 8px card radius, 44px controls, safe-area padding, fixed composer dimensions, and no decorative gradients. Add `prefers-reduced-motion` behavior and explicit 900px desktop breakpoint.

**Step 6: Verify GREEN**

Run: `npm test --workspace @codex-remote/web && npm run typecheck --workspace @codex-remote/web && npm run build --workspace @codex-remote/web`

Expected: all web tests pass and Vite builds production assets.

### Task 6: Integration, Documentation, And Browser QA

**Files:**
- Modify: `README.md`
- Modify only as required by integration: files from Tasks 1-5

**Step 1: Integrate owner branches in the shared worktree**

Review every owner diff, resolve API shape mismatches, and run `git diff --check`. Do not discard pre-existing context-compaction and connection-reliability work.

**Step 2: Update README**

Lead Quick Start with:

```bash
npm install
npm run build
npm run remote
```

Document durable config location, URL preference, Tailscale read-only detection, manual environment override, and shutdown behavior. Keep lower-level start commands under Advanced.

**Step 3: Full automated verification**

Run: `npm test && npm run typecheck && npm run build && git diff --check`

Expected: zero failing tests, type errors, build errors, or whitespace errors.

**Step 4: Real launcher smoke test**

Run the launcher with a temporary HOME/config path and alternate port. Verify app-server ready, bridge health authenticated, printed URL reachable, and SIGINT cleanly stops both children.

**Step 5: Browser QA**

Use the in-app browser at 390x844, 430x932, 768x1024, and 1440x900. At each viewport check:

- `scrollWidth === clientWidth`.
- Composer does not cover the final timeline item.
- Home recent list is usable without opening Settings.
- Picker and Settings are distinct and dismissible.
- Long thread titles clamp without changing row height.
- Active Chat has one title/status region.
- No console warnings/errors.

Capture representative mobile and desktop screenshots for visual review. Reset viewport override after QA.

**Step 6: Final security and scope review**

Confirm token file permissions, no token-only logging, no automatic Funnel/Serve changes, authenticated access metadata, and no new filesystem/terminal exposure.
