import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "../index.css";
import { App } from "./App";

/**
 * Entry point for the public viewer — `view.html`, served at `/p/<id>` and `/embed/<id>`.
 *
 * The rule this file exists to protect: nothing reachable from here may import
 * `@/core/store`, `@/persistence/db`, `@/ai/**`, or an object plugin's `index.ts`. The viewer
 * renders a stranger's document on a page that must not be able to touch the author's scapes
 * or their API key. Object types are reached through `view.ts` and the `ViewPlugin` registry in
 * `@/core/viewRegistry`; `src/viewer/bundle.test.ts` keeps that honest against the built
 * output, and `src/core/viewRegistry.test.ts` against the source.
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
