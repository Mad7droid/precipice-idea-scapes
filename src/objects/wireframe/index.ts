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
    // Labels carry more signal to the model than the primitive kinds do.
    const labels = primitives
      .map((p) => p.label)
      .filter(Boolean)
      .join(", ");
    return clamp(
      `"${title}" · ${primitives.length} elements${labels ? `: ${labels}` : ""}`,
      118,
    );
  },
  aiHint:
    "A low-fidelity screen layout on a 12-column grid, built from heading, text, box, image, " +
    "avatar, input, button, checkbox, toggle, badge, list and divider elements. Use it when " +
    "the answer is a specific screen rather than a flow. Always label elements with the real " +
    "words on the screen — \"Continue\", not \"button\" — because the label is what renders.",
};

export default plugin;
