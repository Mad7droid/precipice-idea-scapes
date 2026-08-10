import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
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
