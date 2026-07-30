import type { ObjectPlugin } from "@/core/registry";
import type { ScapeObject } from "@/core/types";
import { clamp } from "../ui";
import { NoteInspector } from "./Inspector";
import { NoteNode } from "./Node";
import { noteSchema, type NoteData } from "./schema";

const plugin: ObjectPlugin<NoteData> = {
  type: "note",
  label: "Note",
  color: "--obj-note",
  schema: noteSchema,
  defaults: () => ({ body: "" }),
  Node: NoteNode,
  Inspector: NoteInspector,
  toText: (object: ScapeObject) => {
    const body = (object.data as Partial<NoteData>).body ?? "";
    const title = object.title || "Untitled";
    return clamp(body ? `"${title}" · ${body}` : `"${title}" · empty`, 118);
  },
  aiHint:
    "Prose: a brief, a constraint, an observation, an open question. The default when the " +
    "content is not an ordered flow and not a screen layout.",
};

export default plugin;
