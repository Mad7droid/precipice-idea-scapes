import { useEffect, useState } from "react";
import { loadPublication, type LoadResult } from "./api";
import { PublicationCanvas } from "./PublicationCanvas";
import { parseViewerRoute } from "./route";
import {
  ErrorState,
  LoadingState,
  MissingState,
  UnknownRouteState,
  UnpublishedState,
} from "./states";

/**
 * The public viewer.
 *
 * No store, no router, no persistence — the whole page is one fetch and one of five states.
 * Anything more would be a reason for this bundle to import something the editor owns, and the
 * separation between the two is the security boundary, not a bundle-size preference.
 */
export function App() {
  const route = parseViewerRoute(window.location.pathname);
  const publicationId = route.kind === "publication" ? route.publicationId : null;
  const [result, setResult] = useState<LoadResult | null>(null);

  useEffect(() => {
    if (!publicationId) return;
    let live = true;
    setResult(null);
    loadPublication(publicationId).then((next) => {
      if (live) setResult(next);
    });
    return () => {
      live = false;
    };
  }, [publicationId]);

  if (route.kind !== "publication") return <UnknownRouteState />;
  if (!result) return <LoadingState />;

  switch (result.kind) {
    case "ok":
      return <PublicationCanvas scape={result.scape} embed={route.embed} />;
    case "missing":
      return <MissingState />;
    case "unpublished":
      return <UnpublishedState />;
    case "error":
      return <ErrorState detail={result.detail} />;
  }
}
