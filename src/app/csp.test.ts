import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The CSP in `public/_headers` allows the pre-paint theme scripts in `index.html` and
 * `view.html` by hash. Edit either script without updating its hash and the browser blocks
 * it: no crash, no error a user would see, just the wrong theme until first paint. This turns
 * that into a red test.
 *
 * Both HTML entries are covered because the build has two of them — see `vite.config.ts`.
 * A viewer whose theme script is silently blocked is the same bug, on the page a stranger
 * sees first.
 */
const root = resolve(__dirname, "../..");
const entries = ["index.html", "view.html"];
const headers = readFileSync(resolve(root, "public/_headers"), "utf8");

describe("content security policy", () => {
  it("allows exactly the inline scripts the HTML entries actually contain", () => {
    const inline = entries.flatMap((entry) => [
      ...readFileSync(resolve(root, entry), "utf8").matchAll(
        /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g,
      ),
    ]);
    const expected = inline.map(
      (match) => `sha256-${createHash("sha256").update(match[1]).digest("base64")}`,
    );
    const allowed = [...headers.matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].map((match) => match[1]);

    expect(allowed.sort()).toEqual(expected.sort());
  });

  it("keeps connect-src pointed at the AI proxy", () => {
    const proxy = "https://precipice-ai-proxy.precipice.workers.dev";
    expect(headers).toContain(`connect-src 'self' ${proxy}`);
    // The browser must never reach Anthropic directly; that would put the key in a
    // cross-origin request the proxy exists to mediate.
    expect(headers).not.toContain("api.anthropic.com");
  });
});
