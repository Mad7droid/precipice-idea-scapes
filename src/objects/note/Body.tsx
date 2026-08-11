import type { ViewObject } from "@/core/viewRegistry";
import { EmptyHint, RichText, richTextToPlainText } from "../ui";
import type { NoteData } from "./schema";

/**
 * A note's body, rendered. One component, two callers.
 *
 * The editor's `Node.tsx` passes `onEdit` and swaps this out for an input while a field is
 * being edited; the public viewer's `view.ts` passes nothing. Absence of `onEdit` *is*
 * read-only — there is no flag to forget to check, and the viewer cannot reach the store
 * because this file does not import it.
 */
export type NoteEditField = "title" | "body";

export function NoteBody({
  object,
  onEdit,
}: {
  object: ViewObject;
  selected?: boolean;
  onEdit?: (field: NoteEditField) => void;
}) {
  const data = object.data as Partial<NoteData>;
  const body = richTextToPlainText(data.body ?? "");
  // `nodrag` keeps a click from starting a canvas drag, and the text cursor advertises that
  // clicking edits. Neither is true in the viewer, so neither is applied there.
  const editable = onEdit ? "nodrag cursor-text" : "";

  return (
    <>
      <h4
        onClick={onEdit && (() => onEdit("title"))}
        className={`text-sm font-medium leading-snug text-fg ${editable}`}
      >
        {object.title || "Untitled"}
      </h4>
      <div className="mt-1.5">
        {body ? (
          <RichText
            onClick={onEdit && (() => onEdit("body"))}
            value={data.body ?? ""}
            className={`text-xs text-fg-secondary ${editable}`}
          />
        ) : (
          <span onClick={onEdit && (() => onEdit("body"))} className={editable}>
            <EmptyHint>No body yet</EmptyHint>
          </span>
        )}
      </div>
    </>
  );
}
