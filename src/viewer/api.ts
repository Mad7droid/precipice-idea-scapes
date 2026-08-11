import {
  ERROR_STATUS,
  publicationPointerSchema,
  publishedScapeSchema,
  type PublishedScape,
} from "@/publish/contract";

/**
 * Reading a publication, in two requests.
 *
 * `GET /p/:id` is a tiny D1 lookup returning a version pointer, served `no-store` so an
 * unpublish takes effect immediately. The snapshot it points at is immutable and versioned, so
 * it can be cached at the edge for a year. One always-fresh cheap request gating one cacheable
 * expensive one — the alternative, `no-store` on the whole snapshot, makes every viewer load a
 * full D1 plus R2 round trip and turns a link that spreads into a bill.
 *
 * Both responses are parsed. The Worker is the authority on what is published, but this page
 * renders attacker-authored content and treats every field as hostile regardless of origin.
 */
export type LoadResult =
  | { kind: "ok"; scape: PublishedScape }
  | { kind: "missing" }
  | { kind: "unpublished" }
  | { kind: "error"; detail: string };

const API_ORIGIN = (import.meta.env.VITE_PUBLICATION_API_URL ?? "").replace(/\/+$/, "");

function endpoint(path: string): string {
  return `${API_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function loadPublication(
  publicationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LoadResult> {
  let pointerResponse: Response;
  try {
    pointerResponse = await fetchImpl(endpoint(`/p/${encodeURIComponent(publicationId)}`), {
      headers: { Accept: "application/json" },
    });
  } catch {
    return { kind: "error", detail: "Could not reach the server." };
  }

  // 404 and 410 are deliberately distinguishable: "this was unpublished" and "this never
  // existed" are different things to tell someone holding a link.
  if (pointerResponse.status === ERROR_STATUS.not_found) return { kind: "missing" };
  if (pointerResponse.status === ERROR_STATUS.unpublished) return { kind: "unpublished" };
  if (!pointerResponse.ok) return { kind: "error", detail: `Server returned ${pointerResponse.status}.` };

  const pointer = publicationPointerSchema.safeParse(await readJson(pointerResponse));
  if (!pointer.success) return { kind: "error", detail: "The server sent a response we could not read." };

  // Relative to the API origin, and required to stay that way. `snapshotPath` is a string the
  // server chooses, but it arrives over the network and is therefore treated as hostile: an
  // absolute URL here would redirect the snapshot fetch to an origin of the responder's
  // choosing. Same rule as the Worker's `return` validation — a single leading slash, no
  // scheme, no protocol-relative form, no backslash.
  const path = pointer.data.snapshotPath;
  const relative =
    path.startsWith("/") && !path.startsWith("//") && !/[:\\]/.test(path) && !path.includes("..");
  if (!relative) {
    return { kind: "error", detail: "The server sent a response we could not read." };
  }

  let snapshotResponse: Response;
  try {
    snapshotResponse = await fetchImpl(endpoint(path), { headers: { Accept: "application/json" } });
  } catch {
    return { kind: "error", detail: "Could not reach the server." };
  }

  if (snapshotResponse.status === ERROR_STATUS.not_found) return { kind: "missing" };
  if (!snapshotResponse.ok) return { kind: "error", detail: `Server returned ${snapshotResponse.status}.` };

  const scape = publishedScapeSchema.safeParse(await readJson(snapshotResponse));
  if (!scape.success) return { kind: "error", detail: "This publication could not be read." };

  return { kind: "ok", scape: scape.data };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
