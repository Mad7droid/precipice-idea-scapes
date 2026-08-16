import type { ObjectPlugin } from "@/core/registry";
import { ScapeBlockInspector } from "./Inspector";
import { ScapeBlockNode } from "./Node";
import view from "./view";
import { scapeBlockSchema, type ScapeBlockData } from "./schema";

/**
 * The editing half. `type`, `label`, `color` and `toText` come from `./view` so the editor and
 * the public viewer cannot end up describing the same object type differently.
 */
const plugin: ObjectPlugin<ScapeBlockData> = {
  type: view.type,
  label: view.label,
  color: view.color,
  schema: scapeBlockSchema,
  defaults: () => ({ body: "" }),
  Node: ScapeBlockNode,
  Inspector: ScapeBlockInspector,
  toText: view.toText,
  aiHint:
    "Long-form written content: a spec, a summary, a section of a document. Reach for it when " +
    "the structure carries meaning — headings, a table, a long list. A note is the short " +
    "capture; this is the document.",
};

export default plugin;
