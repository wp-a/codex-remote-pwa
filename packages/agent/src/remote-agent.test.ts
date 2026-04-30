import { describe, expect, it } from "vitest";

import { LocalBridgeClient } from "./bridge-client.js";

describe("LocalBridgeClient", () => {
  it("builds websocket stream URLs using the bridge token", () => {
    const client = new LocalBridgeClient({
      baseUrl: "http://127.0.0.1:8787/",
      token: "secret",
    });

    expect(client.streamUrl("session 1")).toBe(
      "ws://127.0.0.1:8787/api/sessions/session%201/stream?token=secret",
    );
  });
});
