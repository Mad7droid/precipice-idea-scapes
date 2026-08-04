import type { ObjectPlugin } from "@/core/registry";
import type { ScapeObject } from "@/core/types";
import { clamp } from "../ui";
import { WireframeInspector } from "./Inspector";
import { WireframeNode } from "./Node";
import { wireframeSchema, type WireframeData } from "./schema";

const plugin: ObjectPlugin<WireframeData> = {
  type: "wireframe",
  label: "Wireframe",
  color: "--obj-wireframe",
  schema: wireframeSchema,
  defaults: () => ({ primitives: [] }),
  Node: WireframeNode,
  Inspector: WireframeInspector,
  toText: (object: ScapeObject) => {
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
  aiHint:
    "A low-fidelity screen layout on a column grid (12 by default; set `columns` to 4 or 6 for " +
    "a simpler screen). Elements are section, heading, text, box, image, avatar, input, " +
    "button, checkbox, toggle, badge, list and divider. Use `section` to name a region — " +
    "header, content, footer — and the elements after it belong to that region. Each element " +
    "has a `span` in columns, and optionally `align` (start/center/end) and `size` " +
    "(sm/md/lg, for box, image and list). Use a wireframe when the answer is a specific " +
    "screen rather than a flow. Always label elements with the real words on the screen — " +
    '"Continue", not "button" — because the label is what renders.',
};

export default plugin;
