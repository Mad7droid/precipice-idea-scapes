import type { ObjectPlugin } from "@/core/registry";
import { JourneyInspector } from "./Inspector";
import { JourneyNode } from "./Node";
import view from "./view";
import { journeySchema, type JourneyData } from "./schema";

/** See `note/index.ts` for why the shared fields come from `./view`. */
const plugin: ObjectPlugin<JourneyData> = {
  type: view.type,
  label: view.label,
  color: view.color,
  schema: journeySchema,
  defaults: () => ({ steps: [] }),
  Node: JourneyNode,
  Inspector: JourneyInspector,
  toText: view.toText,
  aiHint:
    "An ordered sequence a person moves through — a flow, a process, a path. Use it when the " +
    "order of the steps is itself the point.",
};

export default plugin;
