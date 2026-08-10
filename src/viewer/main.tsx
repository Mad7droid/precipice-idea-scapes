import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";

/**
 * Entry point for the public viewer — `view.html`, served at `/p/<id>` and `/embed/<id>`.
 *
 * **Wave 0 stub.** This renders a placeholder so the second Vite entry exists and the build
 * split is real from the first commit. Workstream B builds the viewer into this directory.
 *
 * The rule this file exists to protect: nothing reachable from here may import
 * `@/core/store`, `@/persistence/db`, `@/ai/**`, or an object plugin's `index.ts`. The viewer
 * renders a stranger's document on a page that must not be able to touch the author's scapes
 * or their API key. Object types are reached through `view.ts` and the `ViewPlugin` registry;
 * `src/viewer/bundle.test.ts` is what keeps that honest once B lands.
 */
function Viewer() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-6 text-center">
      <div className="max-w-sm">
        <p className="text-base text-fg">Viewer</p>
        <p className="mt-2 text-sm text-fg-tertiary">
          Published scapes will render here. Nothing is published to this address yet.
        </p>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Viewer />
  </StrictMode>,
);
