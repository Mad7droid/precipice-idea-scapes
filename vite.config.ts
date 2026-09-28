import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

const entry = (file: string) => fileURLToPath(new URL(file, import.meta.url));

/** The MCP connector origin, allowed for HTTPS and for the relay's WebSocket. Optional. */
function mcpOrigins(value: string | undefined): string {
  if (!value) return "";
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("VITE_MCP_URL must be an HTTPS origin with no path, query, or fragment.");
  }
  return `${parsed.origin} wss://${parsed.host}`;
}

function publicationCsp(apiOrigin: string | undefined, mcp = ""): Plugin {
  let origin = "https://publication.invalid";
  if (apiOrigin) {
    const parsed = new URL(apiOrigin);
    if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("VITE_PUBLICATION_API_URL must be an HTTPS origin with no path, query, or fragment.");
    }
    origin = parsed.origin;
  }
  return {
    name: "publication-csp-origin",
    closeBundle() {
      const headers = entry("dist/_headers");
      const source = readFileSync(headers, "utf8");
      if (!source.includes("__PUBLICATION_API_ORIGIN__")) throw new Error("Publication CSP placeholder is missing.");
      writeFileSync(
        headers,
        source.replaceAll("__PUBLICATION_API_ORIGIN__", origin).replaceAll(" __MCP_ORIGINS__", mcp ? ` ${mcp}` : ""),
      );
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    publicationCsp(
      loadEnv(mode, process.cwd(), "VITE_").VITE_PUBLICATION_API_URL,
      mcpOrigins(loadEnv(mode, process.cwd(), "VITE_").VITE_MCP_URL),
    ),
  ],
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
      // shipped. See src/export/pdf/no-raster.ts.
      ...Object.fromEntries(
        ["html2canvas", "canvg", "dompurify"].map((pkg) => [
          pkg,
          fileURLToPath(new URL("./src/export/pdf/no-raster.ts", import.meta.url)),
        ]),
      ),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    /*
     * `.context` is a gitignored scratch directory. Release tooling leaves whole checkouts of
     * the repo in it, each with its own `node_modules`, so leaving it in the default glob
     * meant `pnpm verify` ran every suite twice — the second copy against a second React,
     * which fails on `useState` being null. Only the working tree is under test here.
     */
    exclude: ["**/node_modules/**", "**/dist/**", ".context/**"],
  },
}));
