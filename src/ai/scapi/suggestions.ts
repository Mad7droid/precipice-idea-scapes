import type { Scape } from "@/core/types";

/** These prepare an Ask prompt; sending and applying changes remain explicit operations. */
export const SCAPI_ACTIONS = [
  {
    id: "summarize",
    label: "Summarize",
    prompt: "Summarize the main ideas and their connections. Answer without changing the scape.",
  },
  {
    id: "questions",
    label: "Open questions",
    prompt:
      "Identify the open questions and assumptions in this work. Answer without making edits.",
  },
  {
    id: "decisions",
    label: "Extract decisions",
    prompt:
      "Extract decisions explicitly recorded in this work, with references to the source blocks. Distinguish them from suggestions. Do not edit the scape.",
  },
  {
    id: "next",
    label: "Next steps",
    prompt: "Suggest concrete next steps based on this work. Answer without making changes.",
  },
  {
    id: "plan",
    label: "Outline a plan",
    prompt:
      "Outline a plan from this work. Identify assumptions and missing information. Present a proposal for review; do not edit the scape.",
  },
] as const;

/** Useful first questions come from the canvas, never from a generic help-card catalogue. */
export function suggestScapiQuestions(scape: Scape): string[] {
  const suggestions: string[] = [];
  const linked = new Set(
    Object.values(scape.relationships).flatMap((relationship) => [
      relationship.from,
      relationship.to,
    ]),
  );
  const loose = scape.objectOrder.filter((id) => !linked.has(id));
  const wireframes = scape.objectOrder.filter((id) => scape.objects[id]?.type === "wireframe");

  if (loose.length > 0) suggestions.push("Which objects aren't connected to anything?");
  if (wireframes.length > 1) suggestions.push("Compare the wireframes and explain the trade-offs.");
  if (scape.objectOrder.length > 0) suggestions.push("What's missing from this scape?");
  suggestions.push("Summarise the flow in five lines.");

  return [...new Set(suggestions)].slice(0, 3);
}
