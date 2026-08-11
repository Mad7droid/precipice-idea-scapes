import type { ViewObject, ViewPlugin } from "@/core/viewRegistry";
import { clamp } from "../ui";
import { WireframeBody } from "./Body";
import { wireframeSchema, type WireframeData } from "./schema";

/** See `note/view.ts` for what a `view.ts` may and may not import. */
const view: ViewPlugin<WireframeData> = {
  type: "wireframe",
  label: "Wireframe",
  color: "--obj-wireframe",
  schema: wireframeSchema,
  View: WireframeBody,
  toText: (object: ViewObject) => {
    const primitives = (object.data as Partial<WireframeData>).primitives ?? [];
    const title = object.title || "Untitled";
    if (primitives.length === 0) return clamp(`"${title}" · no elements`, 118);
    // Labels carry more signal to the model than the primitive kinds do, and a section name
    // says which region of the screen the labels after it belong to.
    const labels = primitives
      .map((p) => (p.kind === "section" ? `[${p.label ?? "section"}]` : p.label))
      .filter(Boolean)
      .join(", ");
    return clamp(`"${title}" · ${primitives.length} elements${labels ? `: ${labels}` : ""}`, 118);
  },
};

export default view;
