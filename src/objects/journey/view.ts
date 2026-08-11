import type { ViewObject, ViewPlugin } from "@/core/viewRegistry";
import { clamp } from "../ui";
import { JourneyBody } from "./Body";
import { journeySchema, type JourneyData } from "./schema";

/** See `note/view.ts` for what a `view.ts` may and may not import. */
const view: ViewPlugin<JourneyData> = {
  type: "journey",
  label: "Journey",
  color: "--obj-journey",
  schema: journeySchema,
  View: JourneyBody,
  toText: (object: ViewObject) => {
    const steps = (object.data as Partial<JourneyData>).steps ?? [];
    const title = object.title || "Untitled";
    if (steps.length === 0) return clamp(`"${title}" · no steps`, 118);
    // Step labels in order: the sequence is the information, so it goes in the projection.
    return clamp(
      `"${title}" · ${steps.length} steps: ${steps.map((s) => s.label).join(" → ")}`,
      118,
    );
  },
};

export default view;
