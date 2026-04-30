import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";

import { WebSocketServer, type WebSocket } from "ws";

import {
  remoteEventSchema,
  remoteRoleSchema,
  type RemoteEvent,
  type RemoteRole,
} from "@codex-remote/shared";

const DEFAULT_PAIRING_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const HEARTBEAT_INTERVAL_MS = 15_000;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const WS_OPEN = 1;

type RelaySession = {
  code: string;
  createdAt: number;
  expiresAt: number;
  sockets: Partial<Record<RemoteRole, WebSocket>>;
};

export type RelayServerOptions = {
  pairingTtlMs?: number;
  maxMessageBytes?: number;
};

function jsonResponse(
  response: http.ServerResponse,
  status: number,
  body: unknown,
) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function makePairingCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = "";
  for (const byte of bytes) {
    code += PAIRING_CODE_ALPHABET[byte % PAIRING_CODE_ALPHABET.length];
  }
  return code;
}

function messageBytes(data: WebSocket.RawData): number {
  if (typeof data === "string") {
    return Buffer.byteLength(data);
  }

  if (Buffer.isBuffer(data)) {
    return data.byteLength;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).byteLength;
  }

  return data.byteLength;
}

function wsBaseUrl(request: http.IncomingMessage): string {
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  const proto = request.headers["x-forwarded-proto"];
  const secure =
    proto === "https" ||
    Boolean((request.socket as { encrypted?: boolean }).encrypted);
  return `${secure ? "wss" : "ws"}://${Array.isArray(host) ? host[0] : host}`;
}

function systemEvent(
  action: RemoteEvent["action"],
  payload: Record<string, unknown>,
): RemoteEvent {
  return remoteEventSchema.parse({
    v: 1,
    kind: "event",
    id: randomUUID(),
    ns: "system",
    action,
    ts: Date.now(),
    payload,
  });
}

function sendJson(socket: WebSocket | undefined, payload: unknown) {
  if (!socket || socket.readyState !== WS_OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

export function createRelayServer(options: RelayServerOptions = {}) {
  const pairingTtlMs = options.pairingTtlMs ?? DEFAULT_PAIRING_TTL_MS;
  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const sessions = new Map<string, RelaySession>();
  const socketServer = new WebSocketServer({ noServer: true });

  function createPairing(now = Date.now()): RelaySession {
    let code = makePairingCode();
    while (sessions.has(code)) {
      code = makePairingCode();
    }

    const session: RelaySession = {
      code,
      createdAt: now,
      expiresAt: now + pairingTtlMs,
      sockets: {},
    };
    sessions.set(code, session);
    return session;
  }

  function getValidSession(code: string, now = Date.now()): RelaySession | null {
    const session = sessions.get(code);
    if (!session) {
      return null;
    }

    if (session.expiresAt <= now) {
      sessions.delete(code);
      session.sockets.app?.close(1008, "pairing expired");
      session.sockets.agent?.close(1008, "pairing expired");
      return null;
    }

    return session;
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "OPTIONS") {
      jsonResponse(response, 204, {});
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      jsonResponse(response, 200, {
        ok: true,
        activePairings: sessions.size,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/pairings") {
      const session = createPairing();
      const base = wsBaseUrl(request);
      jsonResponse(response, 201, {
        code: session.code,
        expiresAt: new Date(session.expiresAt).toISOString(),
        appWsUrl: `${base}/api/relay/app?pair=${encodeURIComponent(session.code)}`,
        agentWsUrl: `${base}/api/relay/agent?pair=${encodeURIComponent(session.code)}`,
      });
      return;
    }

    jsonResponse(response, 404, { error: "Not found" });
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const match = url.pathname.match(/^\/api\/relay\/([^/]+)$/);
    const roleResult = remoteRoleSchema.safeParse(match?.[1]);
    const code = url.searchParams.get("pair") ?? url.searchParams.get("code");
    const session = code ? getValidSession(code) : null;

    if (!roleResult.success || !code || !session) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    socketServer.handleUpgrade(request, socket, head, (websocket) => {
      const role = roleResult.data;
      const oldSocket = session.sockets[role];
      if (oldSocket && oldSocket.readyState === WS_OPEN) {
        oldSocket.close(1012, "replaced by newer connection");
      }

      session.sockets[role] = websocket;
      const oppositeRole = role === "app" ? "agent" : "app";
      const oppositeSocket = session.sockets[oppositeRole];

      sendJson(websocket, systemEvent("connected", { role, code }));
      if (oppositeSocket && oppositeSocket.readyState === WS_OPEN) {
        sendJson(websocket, systemEvent("peer_connected", { peer: oppositeRole }));
        sendJson(oppositeSocket, systemEvent("peer_connected", { peer: role }));
      }

      websocket.on("message", (data, isBinary) => {
        if (messageBytes(data) > maxMessageBytes) {
          websocket.close(1009, "message too large");
          return;
        }

        const target = session.sockets[oppositeRole];
        if (!target || target.readyState !== WS_OPEN) {
          sendJson(websocket, systemEvent("peer_disconnected", { peer: oppositeRole }));
          return;
        }

        target.send(data, { binary: isBinary });
      });

      websocket.on("close", () => {
        if (session.sockets[role] === websocket) {
          delete session.sockets[role];
        }

        sendJson(
          session.sockets[oppositeRole],
          systemEvent("peer_disconnected", { peer: role }),
        );
      });
    });
  });

  const heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (session.expiresAt <= now) {
        sessions.delete(session.code);
        session.sockets.app?.close(1008, "pairing expired");
        session.sockets.agent?.close(1008, "pairing expired");
        continue;
      }

      const payload = {
        code: session.code,
        expiresAt: new Date(session.expiresAt).toISOString(),
      };
      sendJson(session.sockets.app, systemEvent("heartbeat", payload));
      sendJson(session.sockets.agent, systemEvent("heartbeat", payload));
    }
  }, HEARTBEAT_INTERVAL_MS);

  function close() {
    clearInterval(heartbeatTimer);
    socketServer.clients.forEach((client) => client.close(1001, "relay closing"));
    socketServer.close();
    server.close();
  }

  return {
    close,
    createPairing,
    get sessions() {
      return sessions;
    },
    server,
  };
}
