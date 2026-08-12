import type { Scape } from "@/core/types";

/** Useful first questions come from the canvas, never from a generic help-card catalogue. */
export function suggestScapeyQuestions(scape: Scape): string[] {
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
