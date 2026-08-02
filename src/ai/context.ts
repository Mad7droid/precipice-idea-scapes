import { allPlugins, summarize } from "@/core/registry";
import type { ObjectId, Scape } from "@/core/types";

/**
 * Turning a Scape into something the model can read.
 *
 * This determines output quality more than the prompt does. The shape is deliberate:
 *
 * - Every object gets one dense line, so the model always knows the whole graph exists.
 * - Only objects the user is looking at, their immediate neighbours, and anything just
 *   created get their full body. Everything else would crowd out the part that matters.
 * - Relationships are an adjacency list, not prose. Prose about a graph is unreadable at
 *   any size and costs several times the tokens.
 * - When it does not fit, the *middle* is dropped. The ends are where recent and selected
 *   context lives; truncating them is how you get a model that ignores what you just did.
 */

/** Rough but stable. Real counting needs a tokenizer we deliberately do not ship. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export const DEFAULT_BUDGET_TOKENS = 4000;

export interface ProjectionOptions {
  /** What the user has selected. These get full bodies. */
  selection?: ObjectId[];
  /** Objects created or edited by the most recent transaction. These get full bodies too. */
  recent?: ObjectId[];
  budgetTokens?: number;
}

export interface Projection {
  text: string;
  estimatedTokens: number;
  /** How many objects were reduced to a placeholder to fit the budget. */
  omitted: number;
}

const MAX_DETAIL_OBJECTS = 12;
const MAX_DETAIL_CHARS = 700;

export function projectScape(scape: Scape, options: ProjectionOptions = {}): Projection {
  const budget = options.budgetTokens ?? DEFAULT_BUDGET_TOKENS;
  const objects = scape.objectOrder.map((id) => scape.objects[id]).filter(Boolean);
  const relationships = Object.values(scape.relationships);

  const detailIds = pickDetailed(scape, options);

  // Priority order. The header and the in-focus bodies are what the request is actually
  // about, so they are paid for first; the two list sections share whatever is left.
  const header = [
    `# Scape: ${scape.name}`,
    `${objects.length} objects, ${relationships.length} relationships.`,
  ].join("\n");

  // Full bodies are the most valuable and the most expensive thing here, so they are capped
  // at a little over half the budget. Without this, twelve long notes alone can exceed a
  // small budget before a single index line is written.
  const detail = renderDetail(scape, detailIds, Math.floor(budget * 0.55));

  // Reserve a little headroom for the separators and the truncation markers themselves.
  const remaining = Math.max(0, budget - estimateTokens(`${header}\n\n${detail}`) - 48);

  const indexLines = objects.map((o) => `${o.id} · ${o.type} · ${summarize(o)}`);
  const relLines = relationships.map(
    (r) => `${r.from} -> ${r.to}${r.label ? ` (${r.label})` : ""}`,
  );

  // The index carries more signal per token than the edge list — an object the model cannot
  // see at all is worse than an edge it cannot see — so it gets the larger share.
  const relBudget = Math.min(estimateTokens(relLines.join("\n")), Math.floor(remaining * 0.35));
  const indexBudget = remaining - relBudget;

  const index = truncateMiddle(indexLines, "## All objects", indexBudget, "objects");
  const rels = truncateMiddle(relLines, "## Relationships", relBudget, "relationships");

  const text = [header, index.text, detail, rels.text].filter(Boolean).join("\n\n");
  return { text, estimatedTokens: estimateTokens(text), omitted: index.omitted };
}

/**
 * Drops lines from the middle, keeping both ends. The head carries the scape's framing and
 * the tail carries whatever was added most recently; truncating either is how you get a
 * model that ignores what the user just did.
 */
function truncateMiddle(
  lines: string[],
  title: string,
  budgetTokens: number,
  noun: string,
): { text: string; omitted: number } {
  if (lines.length === 0) return { text: "", omitted: 0 };

  const cost = (kept: string[]) => estimateTokens([title, ...kept].join("\n"));
  if (cost(lines) <= budgetTokens) return { text: [title, ...lines].join("\n"), omitted: 0 };

  let head = Math.ceil(lines.length / 2);
  let tail = lines.length - head;

  const render = () => [
    ...lines.slice(0, head),
    `… ${lines.length - head - tail} more ${noun} omitted to fit the context budget …`,
    ...lines.slice(lines.length - tail),
  ];

  // Shrink the larger half first, so the two ends stay roughly balanced.
  while (head + tail > 2 && cost(render()) > budgetTokens) {
    if (head > tail) head -= 1;
    else tail -= 1;
  }

  return { text: [title, ...render()].join("\n"), omitted: lines.length - head - tail };
}

function pickDetailed(scape: Scape, options: ProjectionOptions): Set<ObjectId> {
  const detailed = new Set<ObjectId>();

  const add = (id: ObjectId) => {
    if (scape.objects[id]) detailed.add(id);
  };

  for (const id of options.recent ?? []) add(id);
  for (const id of options.selection ?? []) add(id);

  // Immediate neighbours of the selection: what you are editing rarely makes sense alone.
  const selected = new Set(options.selection ?? []);
  for (const rel of Object.values(scape.relationships)) {
    if (selected.has(rel.from)) add(rel.to);
    if (selected.has(rel.to)) add(rel.from);
  }

  // With nothing selected and nothing recent, the whole scape is the context — but only
  // while it is small enough that full bodies are affordable.
  if (detailed.size === 0 && scape.objectOrder.length <= MAX_DETAIL_OBJECTS) {
    for (const id of scape.objectOrder) add(id);
  }

  return new Set([...detailed].slice(0, MAX_DETAIL_OBJECTS));
}

function renderDetail(scape: Scape, ids: Set<ObjectId>, budgetTokens: number): string {
  if (ids.size === 0 || budgetTokens <= 0) return "";

  const chosen = [...ids].map((id) => scape.objects[id]).filter(Boolean);
  // Share the budget evenly, so ten objects each get a readable slice rather than the first
  // two consuming everything and the rest being dropped.
  const charsEach = Math.min(
    MAX_DETAIL_CHARS,
    Math.max(80, Math.floor(((budgetTokens * 4) / Math.max(1, chosen.length)) * 0.8)),
  );

  const blocks: string[] = [];
  let used = estimateTokens("## In focus");

  for (const object of chosen) {
    const body = JSON.stringify(object.data);
    const truncated =
      body.length > charsEach ? `${body.slice(0, charsEach)}…(truncated)` : body;
    const block = `### ${object.id} · ${object.type} · "${object.title}"\n${truncated}`;

    const cost = estimateTokens(block);
    if (blocks.length > 0 && used + cost > budgetTokens) break;
    blocks.push(block);
    used += cost;
  }

  if (blocks.length === 0) return "";
  return ["## In focus", ...blocks].join("\n");
}

/**
 * The type catalogue the model chooses from, built from the registry so a new object type
 * becomes available to the AI by existing — no prompt to update, no list to keep in sync.
 */
export function describeObjectTypes(allowedTypes: string[] = []): string {
  return allPlugins()
    .filter((plugin) => allowedTypes.length === 0 || allowedTypes.includes(plugin.type))
    .map((plugin) => `- ${plugin.type}: ${plugin.aiHint}`)
    .join("\n");
}
