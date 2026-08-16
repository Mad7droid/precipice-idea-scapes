import type { ViewObject } from "@/core/viewRegistry";
import { DocumentText, EmptyHint } from "../ui";
import type { ScapeBlockData } from "./schema";

/**
 * A scape block's body, rendered. One component, two callers — the editor's `Node.tsx` and the
 * public viewer's `view.ts`, exactly as the note does it.
 *
 * The difference from a note is the second gate: `onEdit` says editing is *possible* here (the
 * viewer never passes it), `selected` says the click that arrives is a *second* click rather
 * than the one that selected the card. Without that gate the click that selects a block would
 * also drop it into source, and you could never simply look at one.
 */
export type ScapeBlockEditField = "title" | "body";

export function ScapeBlockBody({
  object,
  selected,
  onEdit,
}: {
  object: ViewObject;
  selected?: boolean;
  onEdit?: (field: ScapeBlockEditField) => void;
}) {
  const data = object.data as Partial<ScapeBlockData>;
  const body = data.body ?? "";
  const edit = onEdit && selected ? onEdit : undefined;
  // `nodrag` keeps a click from starting a canvas drag, and the text cursor advertises that
  // clicking edits. Both are true only once the card is already selected.
  const editable = edit ? "nodrag cursor-text" : "";

  return (
    <>
      <h4
        onClick={edit && (() => edit("title"))}
        className={`text-sm font-medium leading-snug text-fg ${editable}`}
      >
        {object.title || "Untitled"}
      </h4>
      <div className="mt-1.5">
        {body.trim() ? (
          <DocumentText
            onClick={edit && (() => edit("body"))}
            value={body}
            className={`text-xs text-fg-secondary ${editable}`}
          />
        ) : (
          <span onClick={edit && (() => edit("body"))} className={editable}>
            <EmptyHint>{edit ? "Click again to write" : "Nothing written yet"}</EmptyHint>
          </span>
        )}
      </div>
      {edit && <p className="mono mt-2 text-2xs text-fg-tertiary">Click to edit · ⏎</p>}
    </>
  );
}
