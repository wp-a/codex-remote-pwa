import http from "node:http";
import { fileURLToPath } from "node:url";

import { SqliteStore } from "./db.js";
import { EventBus } from "./event-bus.js";
import { createBridgeHttp } from "./http.js";
import { LocalCodexSessions } from "./local-codex-sessions.js";
import { AppServerRuntime } from "./runtime/app-server-runtime.js";
import { CliJsonAdapter } from "./runtime/cli-json-adapter.js";
import { CodexRuntime } from "./runtime/codex-runtime.js";
import { SessionService } from "./session-service.js";

const port = Number(process.env.PORT ?? "8787");
const authToken = process.env.BRIDGE_TOKEN ?? "change-me";
const dbPath = process.env.DB_PATH ?? "./codex-remote.db";
const defaultStaticDir = fileURLToPath(new URL("../../web/dist", import.meta.url));
const staticDir = process.env.WEB_DIST_DIR ?? defaultStaticDir;

const store = new SqliteStore(dbPath);
const eventBus = new EventBus();
const service = new SessionService(store, eventBus);
const runtime = process.env.CODEX_APP_SERVER_URL
  ? new AppServerRuntime(process.env.CODEX_APP_SERVER_URL)
  : new CodexRuntime(new CliJsonAdapter(process.env.CODEX_BIN ?? "codex"));
const codexSessions = new LocalCodexSessions(process.env.CODEX_STATE_DB_PATH);

const bridge = createBridgeHttp({
  authToken,
  codexSessions,
  eventBus,
  runtime,
  service,
  staticDir,
});

const server = http.createServer(bridge.app);
bridge.attachWebSocket(server);

server.listen(port, "0.0.0.0", () => {
  console.log(`codex-remote server listening on http://0.0.0.0:${port}`);
});
