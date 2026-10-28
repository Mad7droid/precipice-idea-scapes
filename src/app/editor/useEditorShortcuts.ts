import { useEffect, useRef } from "react";
import { useScapeStore } from "@/core/store";

export interface EditorShortcutHandlers {
  openCommands: () => void;
  toggleScapi: () => void;
  togglePanels: () => void;
  openHelp: () => void;
  /** Whether Escape has something to close. */
  scapiOpen: boolean;
  closeScapi: () => void;
  /** A follower tab cannot edit, so undo would drift from what is on disk. */
  readOnly: boolean;
  /**
   * An AI generation is streaming into the document. Undo mid-stream would pop the half-built
   * transaction (or an older one) while the applier keeps writing, so it waits.
   */
  busy: boolean;
}

/**
 * Editor-wide keys. Global rather than canvas-scoped, since the inspector and outline sit
 * right next to the canvas and a drag's undo shouldn't depend on which panel last had focus.
 */
export function useEditorShortcuts(handlers: EditorShortcutHandlers) {
  // Read through a ref so the listener is attached once, not on every render.
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const h = latest.current;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        h.openCommands();
        return;
      }
      if (meta && event.key.toLowerCase() === "j") {
        event.preventDefault();
        // A toggle, and only of the panel: hiding the transcript never cancels the work.
        h.toggleScapi();
        return;
      }
      if (meta && event.key === "/") {
        event.preventDefault();
        h.togglePanels();
        return;
      }
      if (
        (event.target as HTMLElement | null)?.closest?.(
          "input, textarea, select, [contenteditable]",
        )
      ) {
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        h.openHelp();
        return;
      }
      if (event.key === "Escape" && h.scapiOpen) {
        event.preventDefault();
        h.closeScapi();
        return;
      }
      if (!meta || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (h.readOnly || h.busy) return;
      if (event.shiftKey) useScapeStore.getState().redo();
      else useScapeStore.getState().undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
