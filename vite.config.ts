import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const entry = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      /**
       * Two HTML entries, two independent module graphs.
       *
       * `main` is the editor. `view` is the public viewer, served at `/p/*` and `/embed/*`
       * via `public/_redirects`. The alternative — one entry that branches on the URL and
       * dynamically imports the viewer — is a runtime waterfall, and it leaves "the viewer
       * ships no AI SDK, no store and no Dexie" as something you test for heuristically
       * rather than something the build makes true. Rollup will still share a chunk that
       * both genuinely import (React, the design tokens); what it cannot do is let the
       * viewer reach code only the editor pulls in.
       */
      input: { main: entry("index.html"), view: entry("view.html") },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // jsPDF pulls in html2canvas, canvg and dompurify for its raster and SVG paths. The
      // PDF export is vector-only and calls neither, so they are stubbed out rather than
      // shipped. See src/persistence/pdf/no-raster.ts.
      ...Object.fromEntries(
        ["html2canvas", "canvg", "dompurify"].map((pkg) => [
          pkg,
          fileURLToPath(new URL("./src/persistence/pdf/no-raster.ts", import.meta.url)),
        ]),
      ),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
