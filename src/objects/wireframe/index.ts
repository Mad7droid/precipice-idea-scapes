import type { ObjectPlugin } from "@/core/registry";
import { WireframeInspector } from "./Inspector";
import { WireframeNode } from "./Node";
import view from "./view";
import { wireframeSchema, type WireframeData } from "./schema";

/** See `note/index.ts` for why the shared fields come from `./view`. */
const plugin: ObjectPlugin<WireframeData> = {
  type: view.type,
  label: view.label,
  color: view.color,
  schema: wireframeSchema,
  defaults: () => ({ primitives: [] }),
  Node: WireframeNode,
  Inspector: WireframeInspector,
  toText: view.toText,
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
