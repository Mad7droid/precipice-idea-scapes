import type { ComponentType } from "react";
import type { ZodType } from "zod";
import type { ActionPayload } from "./actions";
import type { ScapeObject } from "./types";

/**
 * Adding an object type is: create src/objects/<type>/index.ts with a default export.
 * That is the entire registration step. Nothing writes to a shared barrel file, so two
 * people can add two types without touching the same line.
 */
export interface ObjectPlugin<Data = Record<string, unknown>> {
  type: string;
  /** User-facing, sentence case. */
  label: string;
  /** A `--obj-*` token name, never a hex value. */
  color: string;
  schema: ZodType<Data>;
  defaults: () => Data;
  /** Canvas body only. The card, border, type bar and id label belong to the canvas host. */
  Node: ComponentType<{ object: ScapeObject; selected: boolean }>;
  Inspector: ComponentType<{
    object: ScapeObject;
    /** Emits an action; the store stamps txId and ts. Every edit goes through this. */
    dispatch: (payload: ActionPayload) => void;
  }>;
  /** Dense one-line summary. This is what the model sees for objects it is not focused on. */
  toText: (object: ScapeObject) => string;
  /** One sentence telling the model when to reach for this type. */
  aiHint: string;
}

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
 * reach none of them. Splitting the entry point makes "the viewer cannot touch the editor's
 * state" a fact a bundler can prove, instead of a code-review convention. `src/viewer`'s
 * bundle test is what holds that line.
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

// Eager so a plugin is available the moment anything renders. The glob is absolute from the
// project root because that is what Vite resolves consistently across app and test runs.
const modules = import.meta.glob<{ default?: ObjectPlugin }>("/src/objects/*/index.ts", {
  eager: true,
});

const registry = new Map<string, ObjectPlugin>();

for (const [path, mod] of Object.entries(modules)) {
  const plugin = mod?.default;
  if (!plugin?.type) {
    console.warn(`[registry] ${path} has no default ObjectPlugin export — skipped`);
    continue;
  }
  if (registry.has(plugin.type)) {
    console.warn(`[registry] duplicate object type "${plugin.type}" from ${path} — skipped`);
    continue;
  }
  registry.set(plugin.type, plugin as ObjectPlugin);
}

export function getPlugin(type: string): ObjectPlugin | undefined {
  return registry.get(type);
}

export function allPlugins(): ObjectPlugin[] {
  return [...registry.values()].sort((a, b) => a.type.localeCompare(b.type));
}

export function pluginTypes(): string[] {
  return allPlugins().map((p) => p.type);
}

/**
 * The viewer's registry. Deliberately built from its own glob rather than derived from
 * `registry`: importing `index.ts` to discover a view would pull the editor back in and
 * defeat the split.
 */
const viewModules = import.meta.glob<{ default?: ViewPlugin }>("/src/objects/*/view.ts", {
  eager: true,
});

const viewRegistry = new Map<string, ViewPlugin>();

for (const [path, mod] of Object.entries(viewModules)) {
  const plugin = mod?.default;
  if (!plugin?.type) {
    console.warn(`[registry] ${path} has no default ViewPlugin export — skipped`);
    continue;
  }
  if (viewRegistry.has(plugin.type)) {
    console.warn(`[registry] duplicate view type "${plugin.type}" from ${path} — skipped`);
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

/** Fallback used when an object's type has no plugin — never throw, never render blank. */
export function summarize(object: ScapeObject): string {
  const plugin = registry.get(object.type);
  if (!plugin) return `${object.id} · ${object.type} · ${object.title}`;
  return plugin.toText(object);
}
