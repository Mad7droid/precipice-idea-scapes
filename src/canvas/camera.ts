import { useCallback, useEffect, useRef } from "react";
import { useReactFlow, type Viewport } from "@xyflow/react";
import { useScapeStore } from "@/core/store";
import type { ObjectId } from "@/core/types";
import { widthFor } from "./layout";

const VIEWPORT_DEBOUNCE_MS = 500;
/** Matches --dur-canvas. Fly-to and layout reflow move at the same speed on purpose. */
const CANVAS_DURATION_MS = 420;

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Persists the viewport into `scape.viewState`, debounced, so panning does not write a
 * SetViewState per frame — and so the camera is where you left it after a refresh.
 */
export function useViewportPersistence() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return useCallback((viewport: Viewport) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const scape = useScapeStore.getState().scape;
      if (!scape) return;
      useScapeStore.getState().dispatchTx([{ type: "SetViewState", viewState: viewport }]);
    }, VIEWPORT_DEBOUNCE_MS);
  }, []);
}

/** Flies the camera to an object over --dur-canvas, or jumps under reduced motion. */
export function useFocusObject() {
  const { setCenter, getZoom } = useReactFlow();

  return useCallback(
    (id: ObjectId) => {
      const scape = useScapeStore.getState().scape;
      const object = scape?.objects[id];
      if (!object) return;
      setCenter(object.x + widthFor(object.type) / 2, object.y + 60, {
        zoom: Math.max(getZoom(), 0.8),
        duration: prefersReducedMotion() ? 0 : CANVAS_DURATION_MS,
      });
    },
    [setCenter, getZoom],
  );
}
