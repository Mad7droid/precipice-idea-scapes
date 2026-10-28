/**
 * Block markers: an optional accent colour and a few optional tags, carried by every object.
 *
 * Type colour answers "what kind of thing is this". It cannot answer "which of these forty
 * things belong together", because every note is the same colour as every other note. Markers
 * are the second axis: the user (or a generation acting on their instructions) groups blocks
 * across types by phase, owner, surface, confidence — whatever the document is actually about.
 *
 * Deliberately a closed palette of names rather than free colour. A name survives a theme
 * change, an export and a re-import; a hex does not, and the design language forbids raw hex
 * in a component anyway. Six is enough to stay distinguishable at canvas zoom and few enough
 * that a legend does not need scrolling.
 *
 * Pure and dependency-free, so the reducer can normalise markers without gaining a dependency.
 */

export const MARK_NAMES = ["amber", "rose", "teal", "indigo", "olive", "plum"] as const;

export type MarkName = (typeof MARK_NAMES)[number];

/** Sentence case, for the swatch tooltips and the accessible name of each swatch. */
export const MARK_LABELS: Record<MarkName, string> = {
  amber: "Amber",
  rose: "Rose",
  teal: "Teal",
  indigo: "Indigo",
  olive: "Olive",
  plum: "Plum",
};

/** More than a handful stops being an indicator and starts being a paragraph. */
export const MAX_TAGS = 6;
export const MAX_TAG_LENGTH = 24;

export function isMarkName(value: string): value is MarkName {
  return (MARK_NAMES as readonly string[]).includes(value);
}

/** A `--mark-*` token reference, never a hex. Unknown names resolve to nothing. */
export function markColor(accent: string | undefined): string | undefined {
  if (!accent || !isMarkName(accent)) return undefined;
  return `var(--mark-${accent})`;
}

/**
 * Unknown accent names clear rather than reject.
 *
 * A marker is decoration. A file written by a build with a seventh colour, or a model that
 * invents "cerulean", must cost the user nothing worse than an uncoloured card — never a
 * dropped object.
 */
export function normalizeAccent(accent: string | undefined): string {
  const trimmed = (accent ?? "").trim().toLowerCase();
  return isMarkName(trimmed) ? trimmed : "";
}

/**
 * Trim, collapse whitespace, truncate, de-duplicate case-insensitively, cap the count.
 *
 * Case is preserved as typed — "Phase 2" reads better than "phase 2" on a card — but two tags
 * differing only in case are one tag, because they are one tag to the person reading them.
 */
/**
 * Cut by user-perceived characters, not UTF-16 units: `slice` can split a surrogate pair or a
 * ZWJ emoji sequence and leave a lone half that renders as a replacement glyph.
 */
function truncateGraphemes(text: string, max: number): string {
  if (text.length <= max) return text;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    let out = "";
    let count = 0;
    for (const { segment } of segmenter.segment(text)) {
      if (count++ >= max) break;
      out += segment;
    }
    return out;
  }
  return Array.from(text).slice(0, max).join("");
}

export function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = truncateGraphemes(raw.replace(/\s+/g, " ").trim(), MAX_TAG_LENGTH).trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}
