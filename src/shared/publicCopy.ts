import { newScapeId } from "@/core/ids";
import type { Scape } from "@/core/types";
import { publishedScapeSchema, type PublishedScape } from "@/publish/contract";

/**
 * A same-tab handoff from the public viewer to the editor.
 *
 * The viewer is intentionally unable to reach Dexie or the editor store. It may only stage the
 * already-public projection, and the editor owns the actual local write after the redirect.
 * `sessionStorage` is deliberately used instead of localStorage: this is a one-time intent, not
 * a permanent copy of somebody else's document in every future tab.
 */
const KEY = "precipice.publicCopy";

export function stagePublicCopy(scape: PublishedScape): boolean {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(publishedScapeSchema.parse(scape)));
    return true;
  } catch {
    return false;
  }
}

/** Consume first so a reload cannot accidentally create a second local scape. */
export function consumePublicCopy(): PublishedScape | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = publishedScapeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Turn a public projection into a brand-new local document; it never inherits publication state. */
export function localCopyFromPublication(source: PublishedScape): Scape {
  const now = Date.now();
  const objects = Object.fromEntries(
    source.objects.map((object) => [
      object.id,
      {
        ...object,
        data: structuredClone(object.data),
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );
  const relationships = Object.fromEntries(
    source.relationships.map((relationship) => [relationship.id, { ...relationship }]),
  );

  return {
    id: newScapeId(),
    name: `${source.name || "Untitled scape"} copy`,
    objects,
    objectOrder: source.objects.map((object) => object.id),
    relationships,
    viewState: { ...source.viewState },
    createdAt: now,
    updatedAt: now,
  };
}
