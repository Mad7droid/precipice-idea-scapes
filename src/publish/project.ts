import { getPlugin } from "@/core/registry";
import type { Scape } from "@/core/types";
import {
  LIMITS,
  canonicalize,
  publishedScapeSchema,
  type PublishedObject,
  type PublishedScape,
} from "./contract";

/**
 * A `Scape` as a stranger may see it.
 *
 * Everything removed here is removed for a reason, and the reasons are in `contract.ts`: the
 * local scape id is the key to the author's own library, the action log is an edit history with
 * the model prompts still in it, the timestamps leak working hours, and `meta` carries the
 * starter, which is an authoring detail.
 *
 * This runs before the request. The Worker parses the same schema again on arrival and is the
 * only parse that counts — this one exists so the client cannot offer to publish something the
 * server is going to reject.
 */
export interface Projection {
  scape: PublishedScape;
  /** Objects left out, and why. Surfaced in the publish sheet rather than silently dropped. */
  skipped: Array<{ id: string; reason: "unknown type" | "invalid data" | "over limit" }>;
}

export function projectScape(scape: Scape): Projection {
  const skipped: Projection["skipped"] = [];
  const objects: PublishedObject[] = [];
  const kept = new Set<string>();

  // `objectOrder` is the author's order and the wire format is a flat array, so the order is
  // carried by the array itself rather than by a second field that could disagree with it.
  for (const id of scape.objectOrder) {
    const object = scape.objects[id];
    if (!object) continue;

    const plugin = getPlugin(object.type);
    if (!plugin) {
      skipped.push({ id, reason: "unknown type" });
      continue;
    }
    if (!plugin.schema.safeParse(object.data).success) {
      skipped.push({ id, reason: "invalid data" });
      continue;
    }

    const candidate: PublishedObject = {
      id: object.id,
      type: object.type,
      title: object.title.slice(0, LIMITS.title),
      data: object.data,
      x: object.x,
      y: object.y,
      ...(object.width === undefined ? {} : { width: object.width }),
    };

    // The per-object data cap is a byte length, not a character count, and it is cheaper to
    // find the one oversized object here than to have the Worker reject the whole payload.
    if (!publishedScapeSchema.shape.objects.element.safeParse(candidate).success) {
      skipped.push({ id, reason: "over limit" });
      continue;
    }

    kept.add(id);
    objects.push(candidate);
  }

  const relationships = Object.values(scape.relationships)
    .filter((rel) => kept.has(rel.from) && kept.has(rel.to))
    .map((rel) => ({
      id: rel.id,
      from: rel.from,
      to: rel.to,
      ...(rel.label ? { label: rel.label.slice(0, LIMITS.label) } : {}),
    }));

  return {
    scape: {
      name: scape.name.slice(0, LIMITS.name),
      objects,
      relationships,
      viewState: scape.viewState,
    },
    skipped,
  };
}

/**
 * The hash of a projection, for deciding whether the public copy is behind the local one.
 *
 * Computed over `canonicalize()`, the same bytes the Worker hashes, so the two agree. It is
 * never sent: `contract.ts` makes the Worker the authority on the canonical hash precisely so
 * a client cannot assert what it published. This value only ever gets compared against the
 * `publishedHash` the server previously returned.
 */
export async function projectionHash(scape: PublishedScape): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(scape));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
