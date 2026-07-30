import type { ObjectPlugin } from "@/core/registry";
import type { ScapeObject } from "@/core/types";
import { clamp } from "../ui";
import { JourneyInspector } from "./Inspector";
import { JourneyNode } from "./Node";
import { journeySchema, type JourneyData } from "./schema";

const plugin: ObjectPlugin<JourneyData> = {
  type: "journey",
  label: "Journey",
  color: "--obj-journey",
  schema: journeySchema,
  defaults: () => ({ steps: [] }),
  Node: JourneyNode,
  Inspector: JourneyInspector,
  toText: (object: ScapeObject) => {
    const steps = (object.data as Partial<JourneyData>).steps ?? [];
    const title = object.title || "Untitled";
    if (steps.length === 0) return clamp(`"${title}" · no steps`, 118);
    // Step labels in order: the sequence is the information, so it goes in the projection.
    return clamp(
      `"${title}" · ${steps.length} steps: ${steps.map((s) => s.label).join(" → ")}`,
      118,
    );
  },
  aiHint:
    "An ordered sequence a person moves through — a flow, a process, a path. Use it when the " +
    "order of the steps is itself the point.",
};

export default plugin;
