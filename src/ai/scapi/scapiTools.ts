import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { renderObjectBlock } from "@/ai/context";
import type { ObjectId, Scape } from "@/core/types";

/**
 * Scapi's tools. Every one of them reads.
 *
 * This is a capability boundary, not a style choice. Scapi reads the open web, so a page it
 * fetches can carry instructions; with no write tool the worst a hostile page achieves is a
 * wrong answer, never an edited document. `applyAction` also stays the single mutation path,
 * which is the rule the whole architecture rests on.
 *
 * `scapiTools.test.ts` asserts this set contains nothing that mutates. If someone adds a
 * `CreateObject` here, that test is the thing that has to fail.
 */

const MAX_SEARCH_HITS = 12;
const MAX_READ_IDS = 8;

export interface ToolContext {
  scape: Scape;
  /** Called as tools run, so the panel can show what Scapi is doing while it does it. */
  onActivity: (
    event: { kind: "reading-canvas"; query: string } | { kind: "reading-objects"; ids: ObjectId[] },
  ) => void;
}

/** Case-insensitive substring over title, type, id and serialised data. Deliberately dumb. */
function matches(scape: Scape, query: string): ObjectId[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return scape.objectOrder.filter((id) => {
    const object = scape.objects[id];
    if (!object) return false;
    const haystack = `${object.id} ${object.type} ${object.title} ${JSON.stringify(object.data)}`;
    return haystack.toLowerCase().includes(needle);
  });
}

export function scapiTools(context: ToolContext): ToolSet {
  return {
    search_scape: tool({
      description:
        "Find objects on the canvas by keyword. Searches ids, titles, types and body text. " +
        "Use this when the user names something you cannot already see in the scape you were " +
        "given, or when the scape was too large to include in full.",
      inputSchema: z.object({
        query: z.string().min(1).describe("A word or short phrase to look for."),
      }),
      execute: async ({ query }) => {
        context.onActivity({ kind: "reading-canvas", query });
        const hits = matches(context.scape, query).slice(0, MAX_SEARCH_HITS);
        if (hits.length === 0) return `No objects match "${query}".`;
        return hits
          .map((id) => {
            const object = context.scape.objects[id];
            return `${id} · ${object.type} · "${object.title}"`;
          })
          .join("\n");
      },
    }),

    read_objects: tool({
      description:
        "Read the full body of specific objects by id. Use this for objects the scape summary " +
        "said were omitted, or when you need an object's exact contents rather than its title.",
      inputSchema: z.object({
        ids: z
          .array(z.string())
          .min(1)
          .max(MAX_READ_IDS)
          .describe("Object ids, exactly as they appear on the canvas."),
      }),
      execute: async ({ ids }) => {
        context.onActivity({ kind: "reading-objects", ids });
        const blocks = ids.map((id) => {
          const object = context.scape.objects[id];
          // A missing id is information, not an error: it tells the model the object it
          // hypothesised does not exist, which is usually the answer to the question.
          return object ? renderObjectBlock(object) : `### ${id}\nNo object with this id exists.`;
        });
        return blocks.join("\n\n");
      },
    }),
  };
}
