import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createScapi } from "./scapi-controller.js";

export type ScapiState =
  "idle" | "listening" | "thinking" | "happy" | "concerned" | "wink" | "success" | "error";
export type ScapiGaze = "front" | "left" | "right" | "up";

export interface ScapiProps {
  state?: ScapiState;
  gaze?: ScapiGaze;
  /** Canvas width in CSS pixels. Height follows the artwork's 420:360 ratio. */
  size?: number;
  reducedMotion?: boolean;
  /** Thought beads, confetti, tear and warning. Off for small, static placements. */
  effects?: boolean;
  /** Increment to replay a success or error reaction without changing `state`. */
  reactionKey?: number;
  animated?: boolean;
  assetUrl?: string;
  /** Omit to keep the mascot decorative; adjacent text should carry the meaning. */
  label?: string;
  className?: string;
  style?: CSSProperties;
  onError?: (error: Error) => void;
  /**
   * Clicking plays a short, friendly reaction — never a worried one. Only while Scapi is idle,
   * so play can never hide real work or a real failure.
   */
  playful?: boolean;
}

type PlayStep = [state: ScapiState, gaze: ScapiGaze, ms: number];

/** Played in turn, one per click: a wink, a smile, a confetti burst, a look around. */
export const SCAPI_PLAYS: readonly (readonly PlayStep[])[] = [
  [["wink", "front", 700]],
  [["happy", "front", 1200]],
  [["success", "front", 1800]],
  [
    ["idle", "left", 450],
    ["idle", "right", 450],
    ["happy", "up", 800],
  ],
];

/**
 * Scapi, drawn from the approved artwork on a Canvas 2D surface.
 *
 * The controller owns animation, offscreen pausing and reduced motion; this wrapper only maps
 * props onto it. Below 48px it is always quiet — breathing and blinks are noise at avatar size.
 * Where Canvas or its observers are unavailable (jsdom, a locked-down WebView) the mascot
 * yields an empty box of the same size, so the layout around it never moves.
 */
export function Scapi({
  state = "idle",
  gaze = "front",
  size = 160,
  reducedMotion = false,
  animated = true,
  effects = true,
  reactionKey = 0,
  assetUrl,
  label,
  className,
  style,
  onError,
  playful = false,
}: ScapiProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<ReturnType<typeof createScapi> | null>(null);
  const quiet = reducedMotion || !animated || size < 48;
  const [failed, setFailed] = useState(false);
  const props = useRef({ state, gaze, reducedMotion: quiet, effects, onError });
  props.current = { state, gaze, reducedMotion: quiet, effects, onError };
  const play = useRef({ next: 0, timer: 0 });

  useEffect(() => {
    if (!canvas.current) return;
    setFailed(false);
    const fail = (error: Error) => {
      setFailed(true);
      props.current.onError?.(error);
    };
    let api: ReturnType<typeof createScapi>;
    try {
      api = createScapi(canvas.current, {
        ...(assetUrl ? { assetUrl } : {}),
        state: props.current.state,
        gaze: props.current.gaze,
        reducedMotion: props.current.reducedMotion,
        effects: props.current.effects,
        onError: fail,
      });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    controller.current = api;
    return () => {
      window.clearTimeout(play.current.timer);
      api.destroy();
      controller.current = null;
    };
  }, [assetUrl]);

  useEffect(() => {
    // A real state change always wins over a reaction in progress.
    window.clearTimeout(play.current.timer);
    controller.current?.setState(state);
    controller.current?.setGaze(props.current.gaze);
  }, [state, reactionKey]);
  useEffect(() => {
    controller.current?.setEffects(effects);
  }, [effects]);
  useEffect(() => {
    controller.current?.setGaze(gaze);
  }, [gaze]);
  useEffect(() => {
    controller.current?.setReducedMotion(quiet);
  }, [quiet]);

  const onClick = () => {
    const api = controller.current;
    if (!api || props.current.state !== "idle") return;
    window.clearTimeout(play.current.timer);
    const steps = SCAPI_PLAYS[play.current.next % SCAPI_PLAYS.length]!;
    play.current.next += 1;
    const run = (index: number) => {
      const step = steps[index];
      if (!step) {
        api.setState(props.current.state);
        api.setGaze(props.current.gaze);
        return;
      }
      api.setState(step[0]);
      api.setGaze(step[1]);
      play.current.timer = window.setTimeout(() => run(index + 1), step[2]);
    };
    run(0);
  };

  const box: CSSProperties = {
    width: size,
    height: (size * 360) / 420,
    ...(playful ? { cursor: "pointer", userSelect: "none", touchAction: "manipulation" } : {}),
    ...style,
  };
  const a11y = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": true as const };
  return failed ? (
    <span {...a11y} className={className} style={{ display: "inline-block", ...box }} />
  ) : (
    <canvas
      ref={canvas}
      {...a11y}
      {...(playful ? { onClick } : {})}
      className={className}
      style={{ display: "block", ...box }}
    />
  );
}
