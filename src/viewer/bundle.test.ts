import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, findViolations, walkImports } from "@/test/importGraph";

/**
 * What the public viewer is allowed to ship.
 *
 * The viewer renders a stranger's document on the same origin that holds the author's scapes
 * and their Anthropic API key. "The viewer cannot reach the editor's state" has to be a fact
 * about the build, not a convention — so it is asserted twice, from both ends:
 *
 * - Against `dist/`, below: whatever `view.html` actually loads contains no Dexie, no zustand
 *   and no AI SDK. Authoritative, but needs a build.
 * - Against the source, in `src/core/viewRegistry.test.ts` and at the bottom of this file: the
 *   import graph reaches nothing that can edit. Runs every time, fails next to the cause.
 *
 * `pnpm verify` runs a build and then the suite, so the `dist/` half is exercised in CI. When
 * `dist/` is absent these cases skip loudly rather than passing quietly.
 */
const DIST = resolve(REPO_ROOT, "dist");
const hasBuild = existsSync(resolve(DIST, "view.html"));

/**
 * Markers for the three dependencies that must never reach this page. Minifiers mangle local
 * identifiers but not string literals, and each of these libraries carries its own name in
 * error messages or feature detection, which is what makes them findable at all.
 */
const FORBIDDEN_IN_BUNDLE = [
  ["Dexie", "the local database"],
  ["dexie", "the local database"],
  ["zustand", "the editor's store"],
  ["anthropic", "the Anthropic client"],
  ["ai-sdk", "the AI SDK"],
  ["sk-ant-", "anything that knows the shape of an API key"],
  // The publish client is the editor's. A page that can be framed by any origin must hold no
  // session token and make no mutating call — that emptiness is what makes `frame-ancestors *`
  // safe on `/embed/*`, and it stops being true silently.
  ["precipice.publishSession", "the publication session token"],
  ["pendingPublish", "the pending-publish intent"],
  ["/auth/exchange", "the OAuth exchange"],
] as const;

/** Every `/assets/*.js` the viewer entry pulls in, following nested chunk imports. */
function viewerChunks(): string[] {
  const html = readFileSync(resolve(DIST, "view.html"), "utf8");
  const seen = new Set<string>();
  const queue: string[] = [];

  for (const [, file] of html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)) queue.push(file);

  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const path = resolve(DIST, "assets", file);
    if (!existsSync(path)) continue;
    seen.add(file);
    const source = readFileSync(path, "utf8");
    for (const [, nested] of source.matchAll(/from"\.\/([^"]+\.js)"/g)) queue.push(nested);
    for (const [, nested] of source.matchAll(/import\("\.\/([^"]+\.js)"\)/g)) queue.push(nested);
  }
  return [...seen];
}

describe.skipIf(!hasBuild)("viewer bundle", () => {
  it("loads at least one chunk, so the assertions below mean something", () => {
    expect(viewerChunks().length).toBeGreaterThan(0);
  });

  it("ships no Dexie, no store and no AI SDK", () => {
    const offences: string[] = [];
    for (const chunk of viewerChunks()) {
      const source = readFileSync(resolve(DIST, "assets", chunk), "utf8");
      for (const [marker, what] of FORBIDDEN_IN_BUNDLE) {
        if (source.includes(marker)) offences.push(`${chunk} contains ${marker} — ${what}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("does not load the editor's entry chunk", () => {
    // Rollup shares a chunk between the two entries — React and React Flow are legitimately
    // common. What must not happen is the viewer reaching the editor's own entry.
    const editorEntry = readFileSync(resolve(DIST, "index.html"), "utf8").match(
      /src="\/assets\/([^"]+\.js)"/,
    );
    expect(editorEntry).not.toBeNull();
    expect(viewerChunks()).not.toContain(editorEntry![1]);
  });

  it("proves the markers would be found if they were there", () => {
    // Guards the assertion above: if minification ever mangled these strings, the test would
    // pass for the wrong reason. The editor's entry genuinely contains them.
    const editorEntry = readFileSync(resolve(DIST, "index.html"), "utf8").match(
      /src="\/assets\/([^"]+\.js)"/,
    )![1];
    const source = readFileSync(resolve(DIST, "assets", editorEntry), "utf8");
    expect(source).toContain("Dexie");
    expect(source).toContain("anthropic");
  });
});

/* -------------------------------------------------------------------------- */
/* Source graph — runs whether or not there is a build                         */
/* -------------------------------------------------------------------------- */

const VIEWER_FORBIDDEN: Array<[RegExp, string]> = [
  [/^src\/core\/store\.ts$/, "the Zustand store"],
  [/^src\/core\/registry\.ts$/, "the editor registry, which eagerly imports every plugin"],
  [/^src\/persistence\//, "Dexie and the local database"],
  [/^src\/ai\//, "the AI SDK"],
  [/^src\/canvas\//, "the editing canvas"],
  [/^src\/app\//, "the app shell"],
  [/^src\/publish\/(?!contract).*/, "the publish client"],
  [/^src\/objects\/[^/]+\/(index|Node|Inspector)\.(ts|tsx)$/, "a plugin's editing half"],
];

describe("viewer source graph", () => {
  const reached = walkImports(["src/viewer/main.tsx"]);

  it("reaches nothing that can edit a document or publish one", () => {
    expect(findViolations(reached, VIEWER_FORBIDDEN)).toEqual([]);
  });

  it("reaches the view registry and the object views", () => {
    expect([...reached.keys()]).toContain("src/core/viewRegistry.ts");
    // `contract.ts` is the one `src/publish` file the viewer may have: it is the wire format,
    // and parsing hostile input through it is the whole point.
    expect([...reached.keys()]).toContain("src/publish/contract.ts");
  });

  it("never sets HTML directly", () => {
    // React's own property table contains this string, so it cannot be asserted against the
    // shared chunk. Our source is where it would actually be a defect.
    for (const file of reached.keys()) {
      const source = readFileSync(resolve(REPO_ROOT, file), "utf8");
      expect(source, `${file} sets HTML directly`).not.toContain("dangerouslySetInnerHTML");
    }
  });
});
