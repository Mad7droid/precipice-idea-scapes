import type { ObjectPlugin } from "@/core/registry";
import { NoteInspector } from "./Inspector";
import { NoteNode } from "./Node";
import view from "./view";
import { noteSchema, type NoteData } from "./schema";

/**
 * The editing half. `type`, `label`, `color` and `toText` come from `./view` so the editor and
 * the public viewer cannot end up describing the same object type differently.
 */
const plugin: ObjectPlugin<NoteData> = {
  type: view.type,
  label: view.label,
  color: view.color,
  schema: noteSchema,
  defaults: () => ({ body: "" }),
  Node: NoteNode,
  Inspector: NoteInspector,
  toText: view.toText,
  aiHint:
    "Prose: a brief, a constraint, an observation, an open question. The default when the " +
    "content is not an ordered flow and not a screen layout.",
};

export default plugin;
