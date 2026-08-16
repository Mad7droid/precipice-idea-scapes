import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, findViolations, walkImports } from "@/test/importGraph";
import { allViewPlugins, getViewPlugin, viewTypes } from "./viewRegistry";

describe("view registry", () => {
  it("registers a view for every object type", () => {
    expect(viewTypes()).toEqual(["journey", "note", "scape", "wireframe"]);
  });

  it("returns undefined for an unregistered type rather than throwing", () => {
    expect(getViewPlugin("nope")).toBeUndefined();
  });

  it("carries no editor-only surface", () => {
    for (const plugin of allViewPlugins()) {
      expect(plugin).not.toHaveProperty("Inspector");
      expect(plugin).not.toHaveProperty("defaults");
      expect(plugin).not.toHaveProperty("aiHint");
    }
  });

  it("agrees with the editor registry on label and colour", async () => {
    const { getPlugin } = await import("./registry");
    for (const view of allViewPlugins()) {
      const editor = getPlugin(view.type);
      expect(editor?.label).toBe(view.label);
      expect(editor?.color).toBe(view.color);
    }
  });
});

/**
 * Why `viewRegistry.ts` is its own module.
 *
 * Both registries are built from *eager* globs, which compile to static imports. While the two
 * lived in one file, importing `getViewPlugin` pulled every `src/objects/*​/index.ts` — and so
 * `@/core/store` — into whatever imported it, putting zustand and the whole editor inside the
 * public viewer's bundle.
 */
export const EDITOR_ONLY: Array<[RegExp, string]> = [
  [/^src\/core\/store\.ts$/, "the Zustand store"],
  [/^src\/core\/registry\.ts$/, "the editor registry, which eagerly imports every plugin"],
  [/^src\/persistence\//, "Dexie and the local database"],
  [/^src\/ai\//, "the AI SDK"],
  [/^src\/canvas\//, "the editing canvas"],
  [/^src\/app\//, "the app shell"],
  [/^src\/objects\/[^/]+\/(index|Node|Inspector)\.(ts|tsx)$/, "a plugin's editing half"],
];

describe("view registry import graph", () => {
  const viewFiles = readdirSync(resolve(REPO_ROOT, "src/objects"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `src/objects/${entry.name}/view.ts`)
    .filter((file) => existsSync(resolve(REPO_ROOT, file)));

  it("finds a view.ts for every object directory", () => {
    expect(viewFiles).toHaveLength(4);
  });

  it("reaches nothing that can edit a document", () => {
    const reached = walkImports(["src/core/viewRegistry.ts", ...viewFiles]);
    expect(findViolations(reached, EDITOR_ONLY)).toEqual([]);
  });

  it("discovers views by glob, so adding a type needs no barrel edit", () => {
    const source = readFileSync(resolve(REPO_ROOT, "src/core/viewRegistry.ts"), "utf8");
    expect(source).toContain('import.meta.glob<{ default?: ViewPlugin }>("/src/objects/*/view.ts"');
    // The editor's glob must not have followed it here.
    expect(source).not.toContain("/src/objects/*/index.ts");
  });
});
