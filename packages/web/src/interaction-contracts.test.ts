import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(import.meta.dirname, "styles.css"), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("interaction style contracts", () => {
  it("keeps segmented tabs and approval actions at least 44px tall", () => {
    expect(rule(".segmented-control button")).toContain("min-height: 44px");
    expect(rule(".approval-card__actions button")).toContain("min-height: 44px");
  });

  it("clamps active chat titles to two stable lines", () => {
    const titleRule = rule(".app-header h1");
    expect(titleRule).toContain("-webkit-line-clamp: 2");
    expect(titleRule).toContain("max-height: 36px");
    expect(titleRule).toContain("white-space: normal");
  });
});
