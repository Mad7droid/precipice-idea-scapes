import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wave 0's half of the viewer's separation guarantees — the ones that are true about the
 * source tree before workstream B writes a line.
 *
 * The bundle-level assertions (no `@ai-sdk`, no `zustand`, no `dexie`, no
 * `dangerouslySetInnerHTML` in the emitted `view-*.js`) belong to `src/viewer/bundle.test.ts`
 * and run against `dist/`. That file is B's; this one exists so the split cannot quietly rot
 * in the meantime.
 */
const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/** Assertions here are about what ships, so comments explaining it must not satisfy them. */
const stripComments = (source: string) =>
  source.replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*#.*$/gm, "");

describe("viewer entry", () => {
  it("is a second Vite input, not a route inside the app", () => {
    const config = read("vite.config.ts");
    expect(config).toContain('entry("index.html")');
    expect(config).toContain('entry("view.html")');
  });

  it("is what /p/* and /embed/* are rewritten to", () => {
    const redirects = stripComments(read("public/_redirects"));
    expect(redirects).toMatch(/^\/p\/\*\s+\/view\s+200$/m);
    expect(redirects).toMatch(/^\/embed\/\*\s+\/view\s+200$/m);
    // The local editor's namespace must never be routed to the viewer.
    expect(redirects).not.toContain("/s/");
  });

  it("targets /view, never /view.html — the extension turns a rewrite into a redirect", () => {
    // Cloudflare Pages serves HTML extensionless and 308-redirects anything resolving to a
    // `.html` path. A `/view.html` target therefore redirects `/p/<id>` to `/view`, dropping
    // the publication id, and every published link renders an empty viewer. Caught with
    // `wrangler pages dev dist`; `vite preview` does not read `_redirects` and shows nothing.
    expect(stripComments(read("public/_redirects"))).not.toContain("view.html");
  });

  it("boots src/viewer/main.tsx and nothing from the app shell", () => {
    const html = read("view.html");
    expect(html).toContain('src="/src/viewer/main.tsx"');
    expect(html).not.toContain("/src/main.tsx");
  });

  it("does not read the author's stored theme preference", () => {
    // The app mirrors its theme into localStorage for its own pre-paint script. A page
    // rendering a stranger's document has no business reading the app's state.
    expect(stripComments(read("view.html"))).not.toContain("localStorage");
  });
});
