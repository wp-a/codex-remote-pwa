import { describe, expect, it } from "vitest";

import {
  LOCAL_DEV_TOKEN,
  buildConnectionLink,
  buildRelayConnectionLink,
  inferDefaultConnectionToken,
  resolveDirectConnectionConfig,
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

  it("uses an explicit URL token and current origin instead of stale storage", () => {
    expect(
      resolveDirectConnectionConfig(
        "https://current.example.test/chat?token=query-secret",
        "https://stale.example.test",
        "stale-secret",
      ),
    ).toEqual({
      baseUrl: "https://current.example.test",
      explicitUrlToken: true,
      token: "query-secret",
    });
  });

  it("supports the legacy bridgeToken URL parameter", () => {
    expect(
      resolveDirectConnectionConfig(
        "https://current.example.test/?bridgeToken=legacy-secret",
        null,
        null,
      ),
    ).toEqual({
      baseUrl: "https://current.example.test",
      explicitUrlToken: true,
      token: "legacy-secret",
    });
  });

  it("uses stored direct connection values when the URL has no credential", () => {
    expect(
      resolveDirectConnectionConfig(
        "https://app.example.test/",
        "https://bridge.example.test",
        "stored-secret",
      ),
    ).toEqual({
      baseUrl: "https://bridge.example.test",
      explicitUrlToken: false,
      token: "stored-secret",
    });
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

  it("builds a relay pairing link for the current PWA", () => {
    expect(
      buildRelayConnectionLink(
        "https://relay.example.test",
        " ABC123 ",
        "https://app.example.test/?token=stale",
      ),
    ).toBe("https://app.example.test/?relay=https%3A%2F%2Frelay.example.test&pair=ABC123");
  });
});
