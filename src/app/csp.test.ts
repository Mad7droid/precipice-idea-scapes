import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The CSP in `public/_headers` allows the pre-paint theme script in `index.html` by hash.
 * Edit that script without updating the hash and the browser blocks it: no crash, no error
 * a user would see, just the wrong theme until first paint. This turns that into a red test.
 */
const root = resolve(__dirname, "../..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const headers = readFileSync(resolve(root, "public/_headers"), "utf8");

describe("content security policy", () => {
  it("allows exactly the inline scripts index.html actually contains", () => {
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
      (match) => match[1],
    );
    const expected = inline.map(
      (source) => `sha256-${createHash("sha256").update(source).digest("base64")}`,
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
