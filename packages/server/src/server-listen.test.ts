import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { listenForBridge } from "./server-listen.js";

class FakeServer extends EventEmitter {
  listenCallback: (() => void) | null = null;
  listenHost: string | null = null;
  listenPort: number | null = null;

  listen(port: number, host: string, callback: () => void) {
    this.listenPort = port;
    this.listenHost = host;
    this.listenCallback = callback;
    return this;
  }
}

describe("listenForBridge", () => {
  it("logs success only after the server starts listening", () => {
    const server = new FakeServer();
    const log = vi.fn();

    listenForBridge(server, { log, port: 8790 });

    expect(log).not.toHaveBeenCalled();
    server.listenCallback?.();
    expect(log).toHaveBeenCalledWith(
      "codex-remote server listening on http://0.0.0.0:8790",
    );
  });

  it("reports an actionable error and non-zero exit for an occupied port", () => {
    const server = new FakeServer();
    const error = vi.fn();
    const exit = vi.fn();

    listenForBridge(server, { error, exit, port: 8787 });
    server.emit("error", Object.assign(new Error("address in use"), { code: "EADDRINUSE" }));

    expect(error).toHaveBeenCalledWith(
      "Port 8787 is already in use. Set PORT to an available port and try again.",
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});
