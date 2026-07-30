import type { ScapeObject } from "@/core/types";
import { EmptyHint } from "../ui";
import type { NoteData } from "./schema";

export function NoteNode({ object }: { object: ScapeObject; selected: boolean }) {
  const data = object.data as Partial<NoteData>;
  const body = data.body?.trim() ?? "";

  return (
    <>
      <h4 className="text-sm font-medium leading-snug text-fg">{object.title || "Untitled"}</h4>
      <div className="lod-body mt-1.5">
        {body ? (
          // Three lines, then ellipsis. The node is height-bounded by the clamp, not by the
          // length of the body, so a 4,000-word note is the same size as a one-liner.
          <p className="line-clamp-3 text-xs text-fg-secondary">{body}</p>
        ) : (
          <EmptyHint>No body yet</EmptyHint>
        )}
      </div>
    </>
  );
}
