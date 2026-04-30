import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { createRelayServer } from "./relay.js";

describe("relay server", () => {
  let relay: ReturnType<typeof createRelayServer> | null = null;

  afterEach(() => {
    relay?.close();
    relay = null;
  });

  it("pairs app and agent sockets and forwards messages", async () => {
    relay = createRelayServer({ pairingTtlMs: 60_000 });
    await new Promise<void>((resolve) => {
      relay?.server.listen(0, "127.0.0.1", resolve);
    });

    const address = relay.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected listen port");
    }

    const pairing = relay.createPairing();
    const base = `ws://127.0.0.1:${address.port}`;
    const app = new WebSocket(`${base}/api/relay/app?pair=${pairing.code}`);
    const agent = new WebSocket(`${base}/api/relay/agent?pair=${pairing.code}`);

    await Promise.all([
      new Promise<void>((resolve) => app.once("open", resolve)),
      new Promise<void>((resolve) => agent.once("open", resolve)),
    ]);

    const forwarded = new Promise<string>((resolve) => {
      agent.on("message", (data) => {
        const text = String(data);
        if (text.includes('"kind":"request"')) {
          resolve(text);
        }
      });
    });

    app.send(
      JSON.stringify({
        v: 1,
        kind: "request",
        id: "msg_1",
        ns: "bridge",
        action: "health",
        ts: Date.now(),
        payload: {},
      }),
    );

    await expect(forwarded).resolves.toContain('"action":"health"');
    app.close();
    agent.close();
  });
});
