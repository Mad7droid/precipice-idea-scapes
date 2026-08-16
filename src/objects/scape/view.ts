import type { ViewObject, ViewPlugin } from "@/core/viewRegistry";
import { clamp, richTextToPlainText } from "../ui";
import { ScapeBlockBody } from "./Body";
import { scapeBlockSchema, type ScapeBlockData } from "./schema";

/**
 * The scape block as the public viewer sees it. The viewer passes no `onEdit`, so the same
 * component that is editable on the canvas is inert here — there is no read-only flag to
 * forget to check. `index.ts` imports this file for `type`, `label`, `color` and `toText`.
 */
const view: ViewPlugin<ScapeBlockData> = {
  type: "scape",
  label: "Scape block",
  color: "--obj-scape",
  schema: scapeBlockSchema,
  View: ScapeBlockBody,
  toText: (object: ViewObject) => {
    const body = richTextToPlainText((object.data as Partial<ScapeBlockData>).body ?? "");
    const title = object.title || "Untitled";
    return clamp(body ? `"${title}" · ${body}` : `"${title}" · empty`, 118);
  },
};

export default view;
