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
 * Everything a starter decides is advisory. An unrecognised starter id falls back to BLANK,
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
  /** Object types a generation may create. Empty means every registered type. */
  types: string[];
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
  label: "All-in-one",
  blurb: "A flexible canvas with every block type available.",
  types: [],
  layout: "LR",
  edgeMode: "all",
  promptHint: "",
  placeholder: "Tell AI what to do in this scape…",
};

const JOURNEY_MAP: Starter = {
  id: "journey-map",
  label: "Journey map",
  blurb: "Flows and the thinking around them, read left to right.",
  types: ["journey", "note", "scape"],
  layout: "LR",
  edgeMode: "all",
  promptHint:
    "This scape is a journey map. Build it around ordered flows: each journey object is one " +
    "path a person takes, and the notes around it carry the constraints, the evidence and " +
    "the open questions that shape it. Connect a journey to the notes that constrain it, and " +
    "connect one journey to another where a person can move between them.",
  placeholder: 'Try: "Map how a new customer opens an account and makes a first deposit."',
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

const MIND_MAP: Starter = {
  id: "mind-map",
  label: "Mind map",
  blurb: "Ideas radiating from one centre. Notes and connections only.",
  types: ["note"],
  layout: "radial",
  edgeMode: "all",
  promptHint:
    "This scape is a mind map. Create one central note that names the subject, then branch " +
    "outward: every other note connects back to the centre or to another branch, so the whole " +
    "scape is one connected tree. Keep each note short — a title and a sentence or two. The " +
    "shape of the connections is the content here, so connect every note you create.",
  placeholder: 'Try: "Everything that affects whether someone trusts a new banking app."',
  seed: (title) => [
    {
      type: "CreateObject",
      id: newObjectId(),
      objectType: "note",
      title: title || "Centre",
      data: { body: "" },
    },
  ],
};

const SCREEN_FLOW: Starter = {
  id: "screen-flow",
  label: "Screens",
  blurb: "Low-fidelity screens laid out as a contact sheet.",
  types: ["wireframe", "note", "scape"],
  layout: "grid",
  edgeMode: "selected",
  promptHint:
    "This scape is a set of screens. Every screen is a wireframe object with real labels — " +
    "the words that actually appear on the screen, not placeholder names for the elements. " +
    "Connect screens in the order a person moves through them, and label those relationships " +
    "with the action that causes the move. Use notes sparingly, for a rule or a state that " +
    "no single screen can show.",
  placeholder: 'Try: "The screens for signing up, verifying identity and adding a card."',
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

/** Order is the order they appear on the home page. Blank first: it is the safe default. */
export const STARTERS: Starter[] = [BLANK, JOURNEY_MAP, MIND_MAP, SCREEN_FLOW];

export function getStarter(id: string | undefined): Starter {
  return STARTERS.find((s) => s.id === id) ?? BLANK;
}

/** The starter a scape was made from, or Blank. Never throws on an unknown id. */
export function starterFor(scape: { meta?: { starter?: string } } | null | undefined): Starter {
  return getStarter(scape?.meta?.starter);
}

export const LAYOUT_LABELS: Record<LayoutMode, string> = {
  LR: "Flow — left to right",
  TB: "Hierarchy — top down",
  radial: "Radial — around a centre",
  grid: "Grid — contact sheet",
};
