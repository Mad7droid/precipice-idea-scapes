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
    "A low-fidelity screen layout: a stack of boxes, text blocks, inputs, buttons and lists " +
    "on a 12-column grid. Use it when the answer is a specific screen rather than a flow.",
};

export default plugin;
