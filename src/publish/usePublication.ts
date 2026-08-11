import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicationRecord, Scape, ScapeRepository } from "@/core/types";
import { publicPath, type Publication } from "./contract";
import { projectScape, projectionHash } from "./project";
import { readSession } from "./session";

/**
 * What the top bar has to be able to say at a glance.
 *
 * PRD §30 is right that the user must never be uncertain whether a scape is public, so these
 * are four distinct states rather than a boolean and a spinner. `stale` is the one that only
 * exists because publishing is a snapshot: the public copy is real, and it is behind.
 */
export type PublicationState =
  | { kind: "unpublished" }
  | { kind: "published"; record: PublicationRecord; url: string }
  | { kind: "stale"; record: PublicationRecord; url: string }
  | { kind: "withdrawn"; record: PublicationRecord; url: string };

export interface PublicationView {
  state: PublicationState;
  /** Null until the projection has been hashed, which is one async tick after a change. */
  localHash: string | null;
  skipped: ReturnType<typeof projectScape>["skipped"];
  signedIn: boolean;
  refresh: () => void;
  /** Applies a server response to the local row. The server is always the authority. */
  record: (publication: Publication) => Promise<void>;
  forget: () => Promise<void>;
}

/**
 * Derives publication state for one scape from the local row plus the projection's hash.
 *
 * The row is a cache, not an authority: it exists so the editor can render "published" without
 * a network request on every load. Anything that grants access is decided by the Worker.
 */
export function usePublication(
  scape: Scape | null,
  repository: Pick<ScapeRepository, "publications">,
): PublicationView {
  const [row, setRow] = useState<PublicationRecord | undefined>();
  const [localHash, setLocalHash] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(() => readSession() !== null);
  const scapeId = scape?.id ?? null;

  const projection = useMemo(() => (scape ? projectScape(scape) : null), [scape]);

  const refresh = useCallback(() => {
    setSignedIn(readSession() !== null);
    if (!scapeId) return;
    void repository.publications.get(scapeId).then(setRow);
  }, [repository, scapeId]);

  useEffect(() => {
    setRow(undefined);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!projection) return setLocalHash(null);
    let live = true;
    void projectionHash(projection.scape).then((hash) => {
      if (live) setLocalHash(hash);
    });
    return () => {
      live = false;
    };
  }, [projection]);

  const state = useMemo<PublicationState>(() => {
    if (!row) return { kind: "unpublished" };
    const url = publicPath(row.publicationId);
    if (row.status === "unpublished") return { kind: "withdrawn", record: row, url };
    // Unknown hash means "not yet computed", not "changed" — claiming an update is available
    // for a frame on every load would make the badge meaningless.
    if (localHash && localHash !== row.publishedHash) return { kind: "stale", record: row, url };
    return { kind: "published", record: row, url };
  }, [row, localHash]);

  const record = useCallback(
    async (publication: Publication) => {
      if (!scapeId) return;
      const next: PublicationRecord = {
        scapeId,
        publicationId: publication.publicationId,
        publishedHash: publication.hash,
        version: publication.version,
        status: publication.status,
        updatedAt: publication.updatedAt,
      };
      await repository.publications.put(next);
      setRow(next);
    },
    [repository, scapeId],
  );

  const forget = useCallback(async () => {
    if (!scapeId) return;
    await repository.publications.remove(scapeId);
    setRow(undefined);
  }, [repository, scapeId]);

  return {
    state,
    localHash,
    skipped: projection?.skipped ?? [],
    signedIn,
    refresh,
    record,
    forget,
  };
}

/** One-line summary for a badge. Sentence case, no filler. */
export function describeState(state: PublicationState): string {
  switch (state.kind) {
    case "unpublished":
      return "Not published";
    case "published":
      return "Published";
    case "stale":
      return "Update available";
    case "withdrawn":
      return "Unpublished";
  }
}
