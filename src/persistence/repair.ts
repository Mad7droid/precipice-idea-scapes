import type { Scape } from "@/core/types";

export class ScapeIntegrityError extends Error {}

/**
 * Structural checks the schema cannot express, applied to every document that enters the
 * library from outside it (a `.scape`, a library backup, a public copy).
 *
 * - Each `objects` / `relationships` entry must be keyed by its own `id`. A mismatched key is
 *   re-keyed when that is unambiguous and refused when two entries claim the same id.
 * - `objectOrder` is repaired rather than refused: duplicates are dropped, ids with no object
 *   are dropped, and objects missing from the order are appended. A bad order only affects
 *   stacking, so refusing the whole document over it would cost more than it protects.
 */
export function repairScape(scape: Scape): Scape {
  const rekey = <T extends { id: string }>(entries: Record<string, T>, label: string) => {
    const out: Record<string, T> = {};
    for (const value of Object.values(entries)) {
      if (Object.hasOwn(out, value.id))
        throw new ScapeIntegrityError(`Two ${label} share the id “${value.id}”.`);
      out[value.id] = value;
    }
    return out;
  };
  const objects = rekey(scape.objects, "objects");
  const relationships = rekey(scape.relationships, "relationships");

  const seen = new Set<string>();
  const objectOrder: string[] = [];
  for (const id of scape.objectOrder) {
    if (seen.has(id) || !Object.hasOwn(objects, id)) continue;
    seen.add(id);
    objectOrder.push(id);
  }
  for (const id of Object.keys(objects)) if (!seen.has(id)) objectOrder.push(id);

  return { ...scape, objects, relationships, objectOrder };
}
