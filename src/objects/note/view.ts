import type { ViewObject, ViewPlugin } from "@/core/viewRegistry";
import { clamp, richTextToPlainText } from "../ui";
import { NoteBody } from "./Body";
import { noteSchema, type NoteData } from "./schema";

/**
 * The note as the public viewer sees it. Registered by the `view.ts` glob in
 * `@/core/viewRegistry`; nothing here may reach the store, the inspector or the action
 * protocol. `index.ts` imports this file for `toText`, `label` and `color`, so the two halves
 * of the plugin cannot describe the same type differently.
 */
const view: ViewPlugin<NoteData> = {
  type: "note",
  label: "Note",
  color: "--obj-note",
  schema: noteSchema,
  View: NoteBody,
  toText: (object: ViewObject) => {
    const body = richTextToPlainText((object.data as Partial<NoteData>).body ?? "");
    const title = object.title || "Untitled";
    return clamp(body ? `"${title}" · ${body}` : `"${title}" · empty`, 118);
  },
};

export default view;
