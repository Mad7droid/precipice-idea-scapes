import { fixtureScape } from "@/core/fixtures";
import { allPlugins } from "@/core/registry";
import type { Scape } from "@/core/types";
import { describeObjectTypes, projectScape, type ProjectionOptions } from "./context";

/**
 * One worked example of each type's `data`, taken from the fixture rather than written out
 * here. The fixture is already asserted to satisfy every plugin schema, so these examples
 * cannot drift out of date the way a hand-maintained block in a prompt always does.
 */
function dataShapeExamples(allowedTypes: string[]): string {
  const fixture = fixtureScape();
  return allPlugins()
    .filter((plugin) => allowedTypes.length === 0 || allowedTypes.includes(plugin.type))
    .map((plugin) => {
      const example = Object.values(fixture.objects).find((o) => o.type === plugin.type);
      const data = example ? example.data : plugin.defaults();
      return `${plugin.type}: ${JSON.stringify(data)}`;
    })
    .join("\n\n");
}

/**
 * @param allowedTypes Object types this generation may create. Empty means every registered
 *   type — the constrained catalogue is built by omission, so a type the user excluded is
 *   never described, never given a data example, and has nothing to imitate.
 */
export function systemPrompt(allowedTypes: string[] = []): string {
  const constrained = allowedTypes.length > 0;

  return `You are the generation engine inside Precipice, a canvas for thinking through a
design problem. You do not reply with prose. You build the canvas by calling tools.

Each tool call is a named, reversible operation the user can see land on their canvas one at
a time, and undo as a group. Emit them in the order they should appear.

## Object types

${describeObjectTypes(allowedTypes)}

## The shape of each type's data

Match these shapes exactly. Every field shown is required unless the example omits it.

${dataShapeExamples(allowedTypes)}

## Rules

- Give every object a short kebab-case id: "verify-identity", not "obj_1". The id is shown
  to the user on the card, so it should read like a label.
- Create both endpoints before you connect them. A relationship to an object that does not
  exist yet is dropped.
- Never send coordinates. The engine lays out the canvas; positions you invent are wrong.
- Prefer a few substantial objects over many thin ones. Eight to fourteen is a good scape.
${
  constrained
    ? `- Create only these types: ${allowedTypes.join(", ")}. The user asked for nothing else.
  If something would have been a different type, say it in one of the types you have.`
    : `- Use journeys when the order of steps carries the meaning, wireframes when the answer is a
  specific screen, and notes for everything else.`
}
- Connect what you make. A scape with no relationships is a list, not a map.
- Rename the scape once, first, if it is untitled.
- Write in sentence case. No exclamation marks. No filler.`;
}

export function userPrompt(
  request: string,
  scape: Scape,
  options: ProjectionOptions = {},
): { text: string; estimatedTokens: number; omitted: number } {
  const projection = projectScape(scape, options);
  const empty = scape.objectOrder.length === 0;

  const text = empty
    ? `The scape is empty.\n\n${request}`
    : `Here is the current scape.\n\n${projection.text}\n\n---\n\n${request}`;

  return { text, estimatedTokens: projection.estimatedTokens, omitted: projection.omitted };
}
