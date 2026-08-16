/**
 * A stub standing in for jsPDF's optional rasterisation dependencies — html2canvas, canvg
 * and dompurify — aliased in `vite.config.ts`.
 *
 * `render.ts` draws with jsPDF's vector primitives only: no `addImage`, no `.html()`, no SVG.
 * jsPDF still reaches for those three packages behind `jsPDF.html()` and `addSvgAsImage()`,
 * which we never call, so without this alias the build emits ~390 kB of code that can only
 * ever be dead.
 *
 * Reaching one of them means someone added a raster or SVG path to the export. That is a
 * real decision — it triples the size of the export chunk — so it throws rather than silently
 * doing nothing. Drop the alias and the real dependency comes back.
 */
function unavailable(): never {
  throw new Error(
    "PDF export is vector-only. Rasterisation (jsPDF .html/.addSvgAsImage) is stubbed out in " +
      "vite.config.ts — remove the alias to enable it.",
  );
}

export default unavailable;
export const html2canvas = unavailable;
export const Canvg = { fromString: unavailable, from: unavailable };
export const sanitize = unavailable;
