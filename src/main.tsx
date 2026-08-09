import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Offline shell — see public/sw.js.
 *
 * Registered after paint so it never competes with the first render, and only in a built app:
 * a service worker in front of the dev server caches modules Vite is actively rewriting.
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // An unsupported or blocked registration costs offline support, nothing else. The app
      // works exactly as it did before it had one.
    });
  });
}
