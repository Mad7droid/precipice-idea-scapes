import { PUBLICATION_ID_PATTERN } from "@/publish/contract";

/**
 * Which publication this page is showing, and how much chrome to put around it.
 *
 * Real paths, not a hash route. `public/_redirects` rewrites `/p/*` and `/embed/*` to `/view`
 * with a 200, so the address bar still holds the id when this runs. The editor's hash router
 * is a separate world and deliberately a separate id space — see the comment in `_redirects`.
 */
export type ViewerRoute =
  | { kind: "publication"; publicationId: string; embed: boolean }
  | { kind: "unknown" };

export function parseViewerRoute(pathname: string): ViewerRoute {
  const match = pathname.replace(/\/+$/, "").match(/^\/(p|embed)\/([^/]+)$/);
  if (!match) return { kind: "unknown" };

  const [, prefix, raw] = match;
  let publicationId: string;
  try {
    publicationId = decodeURIComponent(raw);
  } catch {
    return { kind: "unknown" };
  }

  // The id shape is the only access control an unlisted publication has, so a malformed one is
  // rejected here rather than sent to the server to be told about.
  if (!PUBLICATION_ID_PATTERN.test(publicationId)) return { kind: "unknown" };

  return { kind: "publication", publicationId, embed: prefix === "embed" };
}
