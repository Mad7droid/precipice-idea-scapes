import type { ComponentType } from "react";
import type { ZodType } from "zod";
import type { ScapeObject } from "./types";

/**
 * The viewer's half of the plugin registry, in its own module.
 *
 * This lives apart from `registry.ts` for one reason, and it is a hard one: both registries are
 * built from *eager* `import.meta.glob` calls, which compile to static imports at the top of
 * whatever module holds them. While the two globs shared a file, importing `getViewPlugin`
 * pulled in every `src/objects/*​/index.ts`, and those reach `@/core/store` — so the public
 * viewer's bundle would have contained zustand and the entire editor. The split is what makes
 * "the viewer cannot touch the author's state" a fact the bundler enforces rather than a
 * code-review convention. `src/viewer/bundle.test.ts` holds the line from the other side.
 *
 * Nothing here may import `registry.ts` at runtime. Types are fine — they erase.
 */

/**
 * An object type as the public viewer sees it: enough to render, nothing that can edit.
 *
 * Timestamps are gone because a published projection does not carry them — see
 * `src/publish/contract.ts`. `ScapeObject` is assignable to this, so one component can serve
 * both the editor and the viewer; the reverse is not, which is the direction we want.
 */
export type ViewObject = Omit<ScapeObject, "createdAt" | "updatedAt">;

/**
 * The read-only half of a plugin, registered from `src/objects/<type>/view.ts`.
 *
 * The alternative — a parallel set of viewer components under `src/viewer/` — is two
 * renderers per object type forever, and they will drift. This is one renderer, reached
 * through a second entry point.
 *
 * The point of the second *file* rather than a second field on `ObjectPlugin` is the import
 * graph. `index.ts` reaches the store, the inspector and the action protocol; `view.ts` must
 * reach none of them.
 *
 * `schema` is here for the same reason it is on `ObjectPlugin`: published objects are
 * attacker-authored, and the viewer parses each one through its plugin's schema and drops
 * failures — the same way the reducer drops invalid actions. That gives hostile-input
 * handling for free, from a registry that already exists.
 */
export interface ViewPlugin<Data = Record<string, unknown>> {
  type: string;
  label: string;
  color: string;
  schema: ZodType<Data>;
  /** Body only. The card, border, type bar and id label belong to the viewer host. */
  View: ComponentType<{ object: ViewObject; selected?: boolean }>;
  toText: (object: ViewObject) => string;
}

/**
 * Built from its own glob rather than derived from the editor registry: reading `index.ts` to
 * discover a view would pull the editor back in and defeat the whole point of the split.
 */
const viewModules = import.meta.glob<{ default?: ViewPlugin }>("/src/objects/*/view.ts", {
  eager: true,
});

const viewRegistry = new Map<string, ViewPlugin>();

for (const [path, mod] of Object.entries(viewModules)) {
  const plugin = mod?.default;
  if (!plugin?.type) {
    console.warn(`[viewRegistry] ${path} has no default ViewPlugin export — skipped`);
    continue;
  }
  if (viewRegistry.has(plugin.type)) {
    console.warn(`[viewRegistry] duplicate view type "${plugin.type}" from ${path} — skipped`);
    continue;
  }
  viewRegistry.set(plugin.type, plugin as ViewPlugin);
}

export function getViewPlugin(type: string): ViewPlugin | undefined {
  return viewRegistry.get(type);
}

export function allViewPlugins(): ViewPlugin[] {
  return [...viewRegistry.values()].sort((a, b) => a.type.localeCompare(b.type));
}

export function viewTypes(): string[] {
  return allViewPlugins().map((plugin) => plugin.type);
}
