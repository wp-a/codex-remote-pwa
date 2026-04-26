import { describe, expect, it } from "vitest";

import {
  LOCAL_DEV_TOKEN,
  buildConnectionLink,
  inferDefaultConnectionToken,
} from "./connection.js";

describe("connection helpers", () => {
  it("reads an explicit token from the connection URL", () => {
    expect(
      inferDefaultConnectionToken("https://bridge.example.test/?token=secret"),
    ).toBe("secret");
  });

  it("uses the development token only for the local bridge", () => {
    expect(inferDefaultConnectionToken("http://127.0.0.1:8787")).toBe(
      LOCAL_DEV_TOKEN,
    );
    expect(inferDefaultConnectionToken("https://bridge.example.test")).toBeNull();
  });

  it("builds a phone-ready link without leaking stale bridgeToken values", () => {
    expect(
      buildConnectionLink(
        "https://bridge.example.test/remote?view=chat&bridgeToken=old",
        " secret ",
      ),
    ).toBe("https://bridge.example.test/remote?view=chat&token=secret");
  });

  it("does not build a share link without a token", () => {
    expect(buildConnectionLink("https://bridge.example.test", "")).toBeNull();
  });
});
