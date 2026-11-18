import { describe, expect, it } from "vitest";

import { parseAccessCandidates } from "./access-info.js";

describe("parseAccessCandidates", () => {
  it("parses valid candidates and preserves their order", () => {
    const input = JSON.stringify([
      { kind: "local", label: "This Mac", url: "http://127.0.0.1:8790/?token=a" },
      { kind: "lan", label: "Local network", url: "http://192.168.1.2:8790/?token=a" },
    ]);

    expect(parseAccessCandidates(input)).toEqual([
      { kind: "local", label: "This Mac", url: "http://127.0.0.1:8790/?token=a" },
      { kind: "lan", label: "Local network", url: "http://192.168.1.2:8790/?token=a" },
    ]);
  });

  it("returns no candidates for missing, malformed, or non-array input", () => {
    expect(parseAccessCandidates(undefined)).toEqual([]);
    expect(parseAccessCandidates("not json")).toEqual([]);
    expect(parseAccessCandidates(JSON.stringify({ kind: "local" }))).toEqual([]);
  });

  it("drops candidates that fail shared schema validation", () => {
    expect(
      parseAccessCandidates(
        JSON.stringify([
          { kind: "public", label: "Public", url: "https://example.com" },
          { kind: "lan", label: "LAN", url: "ftp://192.168.1.2" },
          { kind: "tailscale", label: "Tailnet", url: "https://mac.example.ts.net" },
        ]),
      ),
    ).toEqual([
      { kind: "tailscale", label: "Tailnet", url: "https://mac.example.ts.net" },
    ]);
  });

  it("deduplicates by URL and caps the result at eight candidates", () => {
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      kind: "lan",
      label: `LAN ${index}`,
      url: `http://192.168.1.${index + 1}:8790/`,
    }));
    candidates.splice(1, 0, {
      kind: "lan",
      label: "Duplicate label",
      url: candidates[0]!.url,
    });

    const parsed = parseAccessCandidates(JSON.stringify(candidates));

    expect(parsed).toHaveLength(8);
    expect(parsed.map((candidate) => candidate.label)).toEqual([
      "LAN 0",
      "LAN 1",
      "LAN 2",
      "LAN 3",
      "LAN 4",
      "LAN 5",
      "LAN 6",
      "LAN 7",
    ]);
  });
});
