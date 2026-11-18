import http from "node:http";
import { fileURLToPath } from "node:url";

import { parseAccessCandidates } from "./access-info.js";
import { SqliteStore } from "./db.js";
import { EventBus } from "./event-bus.js";
import { createBridgeHttp } from "./http.js";
import { LocalCodexSessions } from "./local-codex-sessions.js";
import { AppServerRuntime } from "./runtime/app-server-runtime.js";
import { CliJsonAdapter } from "./runtime/cli-json-adapter.js";
import { CodexRuntime } from "./runtime/codex-runtime.js";
import { SessionService } from "./session-service.js";
import { listenForBridge } from "./server-listen.js";

const port = Number(process.env.PORT ?? "8787");
const authToken = process.env.BRIDGE_TOKEN ?? "change-me";
const dbPath = process.env.DB_PATH ?? "./codex-remote.db";
const defaultStaticDir = fileURLToPath(new URL("../../web/dist", import.meta.url));
const staticDir = process.env.WEB_DIST_DIR ?? defaultStaticDir;
const localOnly = process.env.CODEX_REMOTE_LOCAL_ONLY === "1";
const accessCandidates = parseAccessCandidates(
  process.env.CODEX_REMOTE_ACCESS_CANDIDATES,
);
const runtimeMode: "app-server" | "cli" | "local-only" = localOnly
  ? "local-only"
  : process.env.CODEX_APP_SERVER_URL
    ? "app-server"
    : "cli";

const store = new SqliteStore(dbPath);
const eventBus = new EventBus();
const service = new SessionService(store, eventBus);
const runtime = localOnly
  ? null
  : process.env.CODEX_APP_SERVER_URL
    ? new AppServerRuntime(process.env.CODEX_APP_SERVER_URL)
    : new CodexRuntime(new CliJsonAdapter(process.env.CODEX_BIN ?? "codex"));
const codexSessions = new LocalCodexSessions(process.env.CODEX_STATE_DB_PATH);

const bridge = createBridgeHttp({
  accessCandidates,
  authToken,
  codexSessions,
  eventBus,
  runtime,
  runtimeMode,
  service,
  staticDir,
});

const server = http.createServer(bridge.app);
bridge.attachWebSocket(server);

listenForBridge(server, { port });
