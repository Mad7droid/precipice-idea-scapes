/**
 * The print palette.
 *
 * A PDF is always light. Reading the live tokens off `document.documentElement` would export a
 * black-on-black document whenever the app is in dark mode, and `--obj-note` is an indirection
 * to `--type-note-light` anyway — `getPropertyValue` hands back the declaration, not a hex, so
 * resolving it needs a probe element and a reflow inside what should be a pure module.
 *
 * So the values are literal here, and `palette.test.ts` reads `src/design/tokens.css` off disk
 * to prove they still match the light theme. Colour drift becomes a red test, not a wrong
 * colour in somebody's export.
 */

/** Keyed by the `--obj-*` token name each plugin declares as its `color`. */
export const PRINT_PALETTE: Record<string, string> = {
  "--obj-note": "#8a6a3d",
  "--obj-journey": "#4e8c86",
  "--obj-wireframe": "#5b6bae",
  "--obj-scape": "#a85f5a",
};

/** Text. Never pure black, matching the design language. */
export const INK = {
  primary: "#1e1b17",
  secondary: "#5a5248",
  tertiary: "#9e958a",
};

export const PAPER = {
  page: "#ffffff",
  card: "#ffffff",
  hairline: "#dcd7cd",
  edge: "#c4bdb0",
};

/** An unregistered type still prints — in grey, rather than not at all. */
export function printColor(token: string): string {
  return PRINT_PALETTE[token] ?? INK.tertiary;
}
