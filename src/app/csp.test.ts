import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `public/_headers`.
 *
 * Two things are being defended here, and the second is the one that bites.
 *
 * 1. The CSP allows the pre-paint theme scripts by hash. Edit either script without updating
 *    its hash and the browser blocks it: no crash, no error a user would see, just the wrong
 *    theme until first paint.
 * 2. Cloudflare Pages merges matching rules and the browser intersects multiple CSP headers,
 *    so a path matching two blocks that both set CSP gets the *most restrictive* combination.
 *    That is how `/embed/*` ends up unframeable while the config appears to say otherwise.
 *    The rule enforced below: no path may be covered by two CSP-setting blocks.
 */
const root = resolve(__dirname, "../..");
const headers = readFileSync(resolve(root, "public/_headers"), "utf8");

const PUBLICATION_API = "__PUBLICATION_API_ORIGIN__";
const AI_PROXY = "https://precipice-ai-proxy.precipice.workers.dev";

/** `_headers` is path blocks, each followed by indented `Header: value` lines. */
function blocks(): Array<{ path: string; headers: Record<string, string> }> {
  const parsed: Array<{ path: string; headers: Record<string, string> }> = [];
  for (const line of headers.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      parsed.push({ path: line.trim(), headers: {} });
      continue;
    }
    const [, name, value] = line.match(/^\s+([^:]+):\s*(.*)$/) ?? [];
    if (name && parsed.length) parsed[parsed.length - 1].headers[name] = value;
  }
  return parsed;
}

const cspBlocks = () => blocks().filter((block) => block.headers["Content-Security-Policy"]);

/** Cloudflare Pages globbing: `*` matches any suffix. */
function matches(pattern: string, path: string): boolean {
  return pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : pattern === path;
}

describe("content security policy", () => {
  it("allows exactly the inline scripts the HTML entries actually contain", () => {
    const inline = ["index.html", "view.html"].flatMap((entry) => [
      ...readFileSync(resolve(root, entry), "utf8").matchAll(
        /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g,
      ),
    ]);
    const expected = new Set(
      inline.map((match) => `sha256-${createHash("sha256").update(match[1]).digest("base64")}`),
    );
    const allowed = new Set(
      [...headers.matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].map((match) => match[1]),
    );

    expect([...allowed].sort()).toEqual([...expected].sort());
  });

  it("gives every document exactly one CSP, so none are intersected", () => {
    // The editor is a hash router, so all of its URLs are `/`. These are every document the
    // site serves.
    for (const path of ["/", "/index.html", "/p/pub_abc", "/embed/pub_abc"]) {
      const covering = cspBlocks().filter((block) => matches(block.path, path));
      expect(covering.map((block) => block.path), path).toHaveLength(1);
    }
  });

  it("permits framing on /embed/* and nowhere else", () => {
    const framable = cspBlocks().filter(
      (block) => !block.headers["Content-Security-Policy"].includes("frame-ancestors 'none'"),
    );
    expect(framable.map((block) => block.path)).toEqual(["/embed/*"]);
    expect(framable[0].headers["Content-Security-Policy"]).toContain("frame-ancestors *");
  });

  it("lets both the editor and the viewer reach the publication Worker", () => {
    for (const block of cspBlocks()) {
      expect(block.headers["Content-Security-Policy"], block.path).toContain(PUBLICATION_API);
    }
  });

  it("keeps the AI relay reachable from the editor and unreachable from the viewer", () => {
    for (const block of cspBlocks()) {
      const editor = block.path === "/" || block.path === "/index.html";
      const policy = block.headers["Content-Security-Policy"];
      expect(policy.includes(AI_PROXY), block.path).toBe(editor);
    }
    // The browser must never reach Anthropic directly; that would put the key in a
    // cross-origin request the proxy exists to mediate.
    expect(headers).not.toContain("api.anthropic.com");
  });

  it("keeps the hardening headers on everything", () => {
    const wildcard = blocks().find((block) => block.path === "/*");
    expect(wildcard?.headers).toMatchObject({
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    // COOP must not be set per-document alongside a framing grant — it is inert in an iframe,
    // but duplicating it per path is how it drifts.
    expect(wildcard?.headers["Content-Security-Policy"]).toBeUndefined();
  });
});
