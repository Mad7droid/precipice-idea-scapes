import { useCallback, useRef, useState } from "react";
import { notify } from "@/core/notify";
import { useScapeStore } from "@/core/store";
import { generate, type GenerationEvent, type SkippedEvent } from "./generate";
import { ONBOARDING_RECORDING, replayRecording } from "./recording";

export type GenerationStatus = "idle" | "streaming" | "done" | "error";

export interface RibbonLine {
  key: number;
  text: string;
}

export interface GenerationState {
  status: GenerationStatus;
  /** One line per applied action, in the order they landed. */
  lines: RibbonLine[];
  skipped: SkippedEvent[];
  applied: number;
  model: string;
  txId: string | null;
  error: { message: string; detail: string } | null;
}

const IDLE: GenerationState = {
  status: "idle",
  lines: [],
  skipped: [],
  applied: 0,
  model: "",
  txId: null,
  error: null,
};

export interface UseGenerationOptions {
  /** Wired to the canvas by the app shell so this module never imports src/canvas. */
  requestLayout?: () => void;
}

export function useGeneration({ requestLayout }: UseGenerationOptions = {}) {
  const [state, setState] = useState<GenerationState>(IDLE);
  const controller = useRef<AbortController | null>(null);
  const lineKey = useRef(0);

  const handleEvent = useCallback((event: GenerationEvent) => {
    setState((prev) => {
      switch (event.kind) {
        case "applied":
          return {
            ...prev,
            applied: prev.applied + 1,
            lines: [...prev.lines, { key: lineKey.current++, text: event.line }],
          };
        case "skipped":
          return { ...prev, skipped: [...prev.skipped, event] };
        case "error":
          return { ...prev, status: "error", error: { message: event.message, detail: event.detail } };
        case "done":
          return {
            ...prev,
            status: prev.status === "error" ? "error" : "done",
            applied: event.applied,
            model: event.model,
            txId: event.txId,
          };
      }
    });
  }, []);

  const start = useCallback(
    async (request: string, apiKey: string, modelId: string) => {
      const scape = useScapeStore.getState().scape;
      if (!scape || !request.trim()) return;

      controller.current?.abort();
      controller.current = new AbortController();
      lineKey.current = 0;
      setState({ ...IDLE, status: "streaming", model: modelId });

      useScapeStore.getState().setGenerating(true);
      try {
        await generate({
          request,
          scape,
          selection: useScapeStore.getState().selection,
          apiKey,
          modelId,
          dispatch: (action) => useScapeStore.getState().dispatch(action),
          onEvent: handleEvent,
          ...(requestLayout ? { requestLayout } : {}),
          signal: controller.current.signal,
        });
      } finally {
        useScapeStore.getState().setGenerating(false);
      }
    },
    [handleEvent, requestLayout],
  );

  /** Runs the recorded generation. No key, no network — the ribbon behaves identically. */
  const startRecorded = useCallback(async () => {
    const scape = useScapeStore.getState().scape;
    if (!scape) return;

    controller.current?.abort();
    controller.current = new AbortController();
    lineKey.current = 0;
    setState({ ...IDLE, status: "streaming", model: ONBOARDING_RECORDING.model });

    useScapeStore.getState().setGenerating(true);
    try {
      await replayRecording(ONBOARDING_RECORDING, {
        dispatch: (action) => useScapeStore.getState().dispatch(action),
        onEvent: handleEvent,
        ...(requestLayout ? { requestLayout } : {}),
        signal: controller.current.signal,
      });
    } finally {
      useScapeStore.getState().setGenerating(false);
    }
  }, [handleEvent, requestLayout]);

  /** Stops the stream. Everything already applied stays, and undoes as one transaction. */
  const cancel = useCallback(() => controller.current?.abort(), []);

  /** Reverses the whole generation — every action shares one txId, so this is one step. */
  const undo = useCallback(() => {
    const { undoStack } = useScapeStore.getState();
    const top = undoStack[undoStack.length - 1];
    if (!top || top.txId !== state.txId) {
      notify.info("Nothing to undo", "Something else has changed the scape since.");
      return;
    }
    useScapeStore.getState().undo();
    setState(IDLE);
    requestLayout?.();
  }, [state.txId, requestLayout]);

  const dismiss = useCallback(() => setState(IDLE), []);

  return { state, start, startRecorded, cancel, undo, dismiss };
}
