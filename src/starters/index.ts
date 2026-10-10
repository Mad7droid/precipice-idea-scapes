import type { ActionPayload } from "@/core/actions";
import { newObjectId } from "@/core/ids";

/**
 * Starters.
 *
 * A starter is a recipe, not a schema. "Mind map" is not a fourth object type — it is notes,
 * relationships, and a radial layout. "Journey map" is journeys and notes read left to right.
 * Composing the three existing object types this way is what lets the home page offer a menu
 * of things to make without the object model growing a branch per menu item.
 *
 * Everything a starter decides is advisory — including `types`, which focuses a generation but
 * never limits what the canvas can hold. An unrecognised starter id falls back to BLANK,
 * so a scape written by a newer build still opens here.
 *
 * This module is deliberately pure data with no JSX and no React: the canvas reads `layout`,
 * the AI layer reads `types` and `promptHint`, the home page reads the copy, and none of them
 * import each other.
 */

/** How the engine arranges the canvas. Dagre handles LR and TB; the other two are ours. */
export type LayoutMode = "LR" | "TB" | "radial" | "grid";

/**
 * How much of the relationship graph is drawn. Lives here rather than in the canvas because
 * it is a property of the kind of document you are making: a mind map whose edges are hidden
 * is not a mind map, and a wall of screens threaded with lines is unreadable.
 */
export type EdgeMode = "none" | "selected" | "all";

export interface Starter {
  id: string;
  /** Sentence case, on a card. */
  label: string;
  /** One line, under the label. Says what you get, not how we feel about it. */
  blurb: string;
  /**
   * What the canvas holds the moment it is created without a brief. Mirrors `seed`, in words,
   * so the home page can say exactly what "Create" will do before anyone presses it.
   */
  startsWith: string;
  /**
   * The object types an AI generation focuses on when the person has not picked any. Guidance,
   * never a lock: every type can still be added by hand, by Scapi on request, or by an agent.
   * Empty means no focus.
   */
  types: string[];
  /** When to reach for this starter, in one line, for the templates page. */
  useWhen: string;
  /** A complete brief that shows the format off. One click puts it in the composer. */
  example: string;
  layout: LayoutMode;
  edgeMode: EdgeMode;
  /** Appended to the system prompt. Empty for Blank — no starter, no steer. */
  promptHint: string;
  /** The example prompt in the composer. This is the main thing that teaches the format. */
  placeholder: string;
  /**
   * The one object a scape gets when it is created from this starter with no prompt, so the
   * canvas is never an empty grid. Not used when the user sends a brief — the generation is
   * about to fill the canvas and a stray root would just be in the way.
   */
  seed?: (title: string) => ActionPayload[];
}

export const BLANK: Starter = {
  id: "blank",
  label: "Blank",
  blurb: "An open canvas with no structure. Use any block.",
  useWhen: "You already know the shape of the work, or want to explore freely.",
  startsWith: "An empty canvas",
  types: [],
  layout: "LR",
  edgeMode: "all",
  promptHint: "",
  placeholder: "Describe what you are working on…",
  example: "Plan the launch of a habit-tracking app: audience, key flows and risks.",
};

const PRODUCT_CONCEPT: Starter = {
  id: "product-concept",
  label: "Product concept",
  blurb: "A brief linked to the journeys, screens and open questions behind it.",
  useWhen: "You have an idea and want to see it as a whole product, end to end.",
  startsWith: "A brief with Problem, Audience, Goals, Requirements and Open questions",
  types: ["scape", "journey", "wireframe", "note"],
  layout: "TB",
  edgeMode: "selected",
  promptHint:
    "This scape is a product concept. Start with one Scape block that is the brief, written in " +
    "Markdown with sections for Problem, Audience, Goals, Requirements and Open questions; " +
    "separate assumptions from known requirements. Then create the two or three journeys that " +
    "matter most, the key screens as wireframes, and a note for each open question or risk. " +
    "Connect every journey, screen and note to the brief or to the journey it belongs to, so " +
    "the whole concept reads as one connected picture.",
  placeholder: "Describe the product idea and who it is for…",
  example: "A tool that helps small teams plan their week together in ten minutes on Monday.",
  seed: (title) => [
    {
      type: "CreateObject",
      id: newObjectId(),
      objectType: "scape",
      title: title || "Product brief",
      data: {
        body: "## Problem\n\nWhat problem are we solving?\n\n## Audience\n\nWho is this for?\n\n## Goals\n\nWhat does success look like?\n\n## Requirements\n\nWhat must the product do?\n\n## Open questions\n\nWhat do we still need to learn?",
      },
    },
  ],
};

const JOURNEY_MAP: Starter = {
  id: "journey-map",
  label: "User journey",
  blurb: "The steps a person takes, with the evidence and pain points around them.",
  useWhen: "You need to understand or improve how someone gets something done.",
  startsWith: "One empty journey",
  types: ["journey", "note"],
  layout: "LR",
  edgeMode: "all",
  promptHint:
    "This scape is a journey map. Build it around ordered flows: each journey object is one " +
    "path a person takes, and the notes around it carry the constraints, the evidence and " +
    "the open questions that shape it. Connect a journey to the notes that constrain it, and " +
    "connect one journey to another where a person can move between them.",
  placeholder: "Describe who is trying to do what…",
  example: "How a new customer opens an account and makes a first deposit.",
  seed: (title) => [
    {
      type: "CreateObject",
      id: newObjectId(),
      objectType: "journey",
      title: title || "New journey",
      data: { steps: [] },
    },
  ],
};

const SCREEN_FLOW: Starter = {
  id: "screen-flow",
  label: "Screen flow",
  blurb: "Low-fidelity screens, linked in the order people move through them.",
  useWhen: "You want to sketch an interface before anyone opens a design tool.",
  startsWith: "One blank screen",
  types: ["wireframe", "note"],
  layout: "grid",
  edgeMode: "selected",
  promptHint:
    "This scape is a set of screens. Every screen is a wireframe object with real labels — " +
    "the words that actually appear on the screen, not placeholder names for the elements. " +
    "Connect screens in the order a person moves through them, and label those relationships " +
    "with the action that causes the move. Use notes sparingly, for a rule or a state that " +
    "no single screen can show.",
  placeholder: "Describe the screens and what people do on them…",
  example: "The screens for signing up, verifying identity and adding a card.",
  seed: (title) => [
    {
      type: "CreateObject",
      id: newObjectId(),
      objectType: "wireframe",
      title: title || "New screen",
      data: { primitives: [] },
    },
  ],
};

const RESEARCH_SYNTHESIS: Starter = {
  id: "research-synthesis",
  label: "Research synthesis",
  blurb: "Findings grouped into themes around one question, with a written summary.",
  useWhen: "You have interviews, feedback or notes and need to see the patterns.",
  startsWith: "One central research question",
  types: ["note", "scape"],
  layout: "radial",
  edgeMode: "all",
  promptHint:
    "This scape is a research synthesis. Create one central note that states the research " +
    "question. Around it, create a note for each theme, and connect each theme to the centre. " +
    "Attach the individual findings, quotes or observations as short notes connected to their " +
    "theme. Finish with one Scape block that summarises the themes, what they imply, and what " +
    "is still unknown. If the person pastes raw material, use only what it actually says.",
  placeholder: "Paste notes or feedback, or describe what you want to learn…",
  example: "Why users stop using a budgeting app after the first two weeks.",
  seed: (title) => [
    {
      type: "CreateObject",
      id: newObjectId(),
      objectType: "note",
      title: title || "Research question",
      data: { body: "What are we trying to learn?" },
    },
  ],
};

/** Order is the order they appear on the home page. Blank first: it is the safe default. */
export const STARTERS: Starter[] = [
  BLANK,
  PRODUCT_CONCEPT,
  JOURNEY_MAP,
  SCREEN_FLOW,
  RESEARCH_SYNTHESIS,
];

/**
 * Ids written by earlier builds. Scapes keep the id they were created with, so a retired
 * starter maps to the one that replaced it rather than silently falling back to Blank.
 */
const RETIRED: Record<string, string> = {
  "mind-map": "research-synthesis",
  "product-brief": "product-concept",
};

export function getStarter(id: string | undefined): Starter {
  const current = id && RETIRED[id] ? RETIRED[id] : id;
  return STARTERS.find((s) => s.id === current) ?? BLANK;
}

/** The starter a scape was made from, or Blank. Never throws on an unknown id. */
export function starterFor(scape: { meta?: { starter?: string } } | null | undefined): Starter {
  return getStarter(scape?.meta?.starter);
}

/** How each edge mode reads to someone choosing a starter, not to someone in the toolbar. */
export const EDGE_LABELS: Record<EdgeMode, string> = {
  all: "All connections shown",
  selected: "Connections shown on selection",
  none: "Connections hidden",
};

export const LAYOUT_LABELS: Record<LayoutMode, string> = {
  LR: "Flow — left to right",
  TB: "Hierarchy — top down",
  radial: "Radial — around a centre",
  grid: "Grid — contact sheet",
};
