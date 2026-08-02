import type { Primitive, PrimitiveKind } from "./schema";

/**
 * Screens people actually draw.
 *
 * Building a credible screen one element at a time is a dozen decisions before you learn
 * anything, and most of those decisions are the same every time — a sign-up form is a
 * heading, some fields, a button and a link, in that order, on every product ever shipped.
 * A preset gets you to the part that is specific to *your* problem, which is the labels.
 *
 * Presets are written on a twelve-column grid, and scaled down when the card is on a
 * coarser one.
 */

type Seed = Omit<Primitive, "id">;

export interface Preset {
  name: string;
  /** What the screen is for, shown under the name — presets are only useful if you can
   * tell them apart without inserting one. */
  hint: string;
  elements: Seed[];
}

const el = (
  kind: PrimitiveKind,
  span: number,
  label?: string,
  extra: Partial<Seed> = {},
): Seed => ({ kind, span, ...(label ? { label } : {}), ...extra });

export const PRESETS: Preset[] = [
  {
    name: "Header + hero",
    hint: "A landing screen: nav, a promise, one action",
    elements: [
      el("section", 12, "header"),
      el("avatar", 3, "Logo"),
      el("text", 6, "Product  ·  Pricing  ·  Docs", { align: "center" }),
      el("button", 3, "Sign in"),
      el("section", 12, "hero"),
      el("heading", 12, "One line that says what this is"),
      el("text", 12, "A sentence of support, no longer than this one."),
      el("button", 4, "Get started"),
      el("image", 12, "Product shot", { size: "lg" }),
    ],
  },
  {
    name: "Sign-up form",
    hint: "Account creation, with the usual consent row",
    elements: [
      el("heading", 12, "Create your account"),
      el("text", 12, "Already have one? Sign in."),
      el("input", 12, "Work email"),
      el("input", 12, "Password"),
      el("input", 6, "First name"),
      el("input", 6, "Last name"),
      el("checkbox", 12, "I agree to the terms"),
      el("button", 12, "Create account"),
    ],
  },
  {
    name: "List screen",
    hint: "Search, filter, rows — the shape of most of an app",
    elements: [
      el("section", 12, "toolbar"),
      el("input", 8, "Search"),
      el("button", 4, "New"),
      el("badge", 3, "All"),
      el("badge", 3, "Active"),
      el("badge", 3, "Archived"),
      el("section", 12, "results"),
      el("list", 12, "Results", { size: "lg" }),
    ],
  },
  {
    name: "Card grid",
    hint: "A browsable collection — three across",
    elements: [
      el("heading", 12, "Browse"),
      el("input", 12, "Filter"),
      el("box", 4, "Card", { size: "md" }),
      el("box", 4, "Card", { size: "md" }),
      el("box", 4, "Card", { size: "md" }),
      el("box", 4, "Card", { size: "md" }),
      el("box", 4, "Card", { size: "md" }),
      el("box", 4, "Card", { size: "md" }),
    ],
  },
  {
    name: "Settings",
    hint: "Grouped preferences with toggles",
    elements: [
      el("heading", 12, "Settings"),
      el("section", 12, "profile"),
      el("avatar", 12, "Your name"),
      el("input", 12, "Display name"),
      el("section", 12, "notifications"),
      el("toggle", 12, "Email me about activity"),
      el("toggle", 12, "Weekly summary"),
      el("divider", 12),
      el("button", 4, "Save"),
    ],
  },
  {
    name: "Detail view",
    hint: "One record, its metadata and its actions",
    elements: [
      el("section", 12, "header"),
      el("heading", 9, "Record title"),
      el("badge", 3, "Draft", { align: "end" }),
      el("text", 12, "A description of what this record is."),
      el("section", 12, "content"),
      el("image", 12, "Preview", { size: "lg" }),
      el("list", 12, "Related items"),
      el("section", 12, "actions"),
      el("button", 6, "Approve"),
      el("box", 6, "Discard"),
    ],
  },
];

/** Rewrite a preset's spans for a coarser grid, keeping full-width elements full-width. */
export function scaleSpan(span: number, columns: number): number {
  if (columns === 12) return span;
  return Math.min(columns, Math.max(1, Math.round((span / 12) * columns)));
}
