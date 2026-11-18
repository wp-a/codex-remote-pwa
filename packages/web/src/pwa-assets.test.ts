import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");

describe("PWA shell", () => {
  it("links install metadata and every declared icon asset", () => {
    const html = readFileSync(resolve(webRoot, "index.html"), "utf8");
    const manifest = JSON.parse(
      readFileSync(resolve(webRoot, "public/manifest.webmanifest"), "utf8"),
    ) as { icons: Array<{ src: string; sizes: string }> };

    expect(html).toContain('rel="manifest"');
    expect(html).toContain('name="apple-mobile-web-app-capable"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512"]);
    manifest.icons.forEach((icon) => {
      expect(existsSync(resolve(webRoot, "public", icon.src.replace(/^\//, "")))).toBe(true);
    });
  });
});
