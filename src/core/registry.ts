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

/** Fallback used when an object's type has no plugin — never throw, never render blank. */
export function summarize(object: ScapeObject): string {
  const plugin = registry.get(object.type);
  if (!plugin) return `${object.id} · ${object.type} · ${object.title}`;
  return plugin.toText(object);
}
