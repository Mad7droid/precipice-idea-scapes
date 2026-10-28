import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_INSTRUCTIONS } from "@/core/types";
import { Button } from "@/design/Button";
import { ScapiActionIcon } from "@/components/scapi/ScapiActionIcon";
import { Select } from "@/design/Select";
import { DotMatrix } from "./DotMatrix";
import { InstructionsPill } from "./Instructions";
import type { Scope } from "./prompt";
import { MODELS, webSearchUnavailableReason, type ModelChoice } from "./models";
import { Elapsed, MicButton } from "@/dictation/MicButton";
import { useDictation } from "@/dictation/useDictation";
import { appendPhrase } from "@/dictation/vocabulary";
import { decide } from "./router/decide";
import { describeCommand } from "./router/commands";
import { useRoute } from "./router/useRoute";
import { LiveHistory, LiveLine } from "./live/LivePanel";
import { useLiveVoice } from "./live/useLiveVoice";
import { ALL_LOCKS, DIMENSION_NAMES, NO_LOCKS, PILL, TypePicker } from "./ComposerParts";
import type { LocalCommand, RouteContext, RouteDimension, SendRoute } from "./router/types";

/** Auto-grow to six lines, then scroll. Roughly six × --leading-base plus the padding. */
const MAX_HEIGHT_PX = 168;

export type { Scope } from "./prompt";
export type { SendRoute } from "./router/types";

/**
 * Route chips: the composer's own controls, set from the draft as it is typed or dictated.
 * See docs/voice-and-routing-plan.md.
 */
export interface ComposerRouting {
  enabled: boolean;
  /** A TypeSafe key when the person opted in to Jev; empty for on-device heuristics only. */
  jevKey: string;
  /** Jev decides alone: no on-device fallback, and a failure is shown with its reason. */
  jevOnly?: boolean;
  /** Read when a route is computed, never per keystroke. Titles and types only. */
  getContext: () => Pick<RouteContext, "selection" | "objects">;
  /** Runs a recognised local command. Absent means this composer offers none. */
  onCommand?: (command: LocalCommand) => void;
}

export interface ComposerProps {
  models?: ModelChoice[];
  /** `route` is present only when route chips are on, and is what the controls showed. */
  onSend: (request: string, route?: SendRoute) => void;
  value?: string;
  onValueChange?: (value: string) => void;
  sendLabel?: string;
  onCancel: () => void;
  busy: boolean;
  modelId: string;
  onModelChange: (modelId: string) => void;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  /** Object types this generation may create. Empty means no constraint — every type. */
  types: string[];
  onTypesChange: (types: string[]) => void;
  /**
   * The types the picker may offer at all, as decided by the scape's starter. Empty means
   * every registered type. A mind map does not offer to create a wireframe.
   */
  availableTypes?: string[];
  /**
   * This scape's standing instructions, and how to change them. Absent on the home page,
   * where there is no document yet to attach them to.
   */
  instructions?: string;
  onInstructionsChange?: (next: string) => void;
  maxInstructions?: number;
  /** Shown, not edited, in the popover — so the user can see what else is already in play. */
  globalInstructions?: string;
  onEditGlobalInstructions?: () => void;
  selectionCount: number;
  disabled?: boolean;
  placeholder?: string;
  /**
   * Ask vs edit, when this composer is allowed to choose. Both surfaces that offer the choice
   * — the canvas bar and the Scapi panel — render the same control here rather than owning a
   * toggle of their own, so the two never disagree about which mode is live.
   */
  mode?: "ask" | "edit";
  onModeChange?: (mode: "ask" | "edit") => void;
  /**
   * Web search, which only asking can use. Rendered in place of the controls that shape a
   * generation, since a question creates nothing for them to constrain.
   */
  webSearch?: boolean;
  onWebSearchChange?: (enabled: boolean) => void;
  /** Disables the toggle and says why, when the key has no search entitlement. */
  webSearchUnavailable?: boolean;
  /** Rendered to the left of the send button — the starter badge on the home page. */
  slot?: React.ReactNode;
  /** Lets the editor's command palette return focus to the prompt after expanding it. */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  /**
   * Which pills to draw.
   *
   * The home page shows neither: there is no selection to scope to, and the starter cards
   * directly below already decide the types. A control that cannot change anything is worse
   * than no control — it is a promise the app does not keep.
   */
  controls?: { scope?: boolean; types?: boolean; instructions?: boolean };
  /** Route chips. Only takes effect where the composer also offers the Ask/Edit choice. */
  routing?: ComposerRouting;
  /**
   * True while any ask or edit runs, whichever mode started it. Enables live voice, which
   * needs to know when the scape is free for the next spoken phrase.
   */
  liveBusy?: boolean;
  /** The last ask or edit failed; live voice reports that run as failed, not done. */
  liveFailed?: boolean;
}

/**
 * The loudest element on screen, and everything else is arranged to make that true: a big
 * radius, an inset well, and the only filled accent button in the app.
 */
export function Composer({
  onSend,
  value: controlledValue,
  onValueChange,
  sendLabel,
  onCancel,
  busy,
  modelId,
  onModelChange,
  scope,
  onScopeChange,
  types,
  onTypesChange,
  availableTypes,
  instructions,
  onInstructionsChange,
  maxInstructions = MAX_INSTRUCTIONS,
  globalInstructions,
  onEditGlobalInstructions,
  selectionCount,
  disabled,
  placeholder = "Describe what you want on the canvas.",
  slot,
  inputRef,
  controls,
  mode,
  onModeChange,
  webSearch,
  onWebSearchChange,
  webSearchUnavailable,
  routing,
  liveBusy,
  liveFailed,
  models = MODELS,
}: ComposerProps) {
  const routingOn = !!routing?.enabled && !!mode && !!onModeChange;
  const inputKind = useRef<"typed" | "voice">("typed");
  const phraseLanded = useRef<() => void>(() => {});
  const [locked, setLocked] = useState<ReadonlySet<RouteDimension>>(NO_LOCKS);
  const routingRef = useRef(routing);
  routingRef.current = routing;
  const availableRef = useRef(availableTypes);
  availableRef.current = availableTypes;
  const getRouteContext = useCallback(
    (): RouteContext => ({
      ...(routingRef.current?.getContext() ?? { selection: { count: 0, types: [] }, objects: [] }),
      input: inputKind.current,
      availableTypes: availableRef.current ?? [],
      commands: !!routingRef.current?.onCommand,
    }),
    [],
  );
  // Asking reads the scape and answers; it creates nothing. So the controls that exist only to
  // shape a generation — which types it may add, the standing instructions it writes under —
  // are not merely disabled but absent. A control that cannot change the outcome is a promise
  // the app does not keep.
  const [localValue, setLocalValue] = useState("");
  const value = controlledValue ?? localValue;
  const route = useRoute({
    text: value,
    enabled: routingOn,
    jevKey: routing?.jevKey ?? "",
    jevOnly: !!routing?.jevOnly,
    getContext: getRouteContext,
  });
  phraseLanded.current = route.phraseLanded;
  // A manual change sticks for the rest of the draft; a new draft starts unlocked.
  const empty = !value.trim();
  useEffect(() => {
    if (!empty) return;
    setLocked(NO_LOCKS);
    inputKind.current = "typed";
  }, [empty]);
  const decision = routingOn
    ? decide(
        {
          intent: mode ?? "edit",
          scope,
          types,
          modelId,
          webSearch: !!webSearch,
          selectionCount,
        },
        route.suggestion,
        locked,
      )
    : null;
  const lock = (dimension: RouteDimension) => {
    if (routingOn) setLocked((prev) => new Set(prev).add(dimension));
  };
  const effectiveMode = decision ? (decision.route.intent === "ask" ? "ask" : "edit") : mode;
  const effectiveScope = decision?.route.scope ?? scope;
  const effectiveTypes = decision?.route.types ?? types;
  const effectiveModel = decision?.route.modelId ?? modelId;
  const effectiveWebSearch = decision ? decision.route.webSearch : webSearch;
  const connecting = decision?.route.intent === "connect";
  const command = routing?.onCommand ? decision?.command : undefined;
  const routed = decision?.route.routed ?? [];
  const label =
    routingOn && sendLabel
      ? connecting
        ? "Connect"
        : effectiveMode === "ask"
          ? "Ask"
          : "Edit"
      : sendLabel;

  const asking = effectiveMode === "ask";
  const showScope = (controls?.scope ?? true) && !asking;
  const showTypes = (controls?.types ?? true) && !asking;
  // Opt-in, unlike the other two: without a scape to attach them to there is nothing to edit.
  const showInstructions = (controls?.instructions ?? false) && !!onInstructionsChange && !asking;
  const showWebSearch = asking && !!onWebSearchChange;
  const setValue = onValueChange ?? setLocalValue;
  const [focused, setFocused] = useState(false);
  const localTextarea = useRef<HTMLTextAreaElement>(null);
  const textarea = inputRef ?? localTextarea;
  // Phrases can land faster than React re-renders, so each one appends to the latest draft.
  const latest = useRef(value);
  latest.current = value;
  // Live voice: phrases run as they are heard instead of collecting in the draft.
  const liveAvailable = liveBusy !== undefined && !!routing && !!mode && !!onModeChange;
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);
  liveRef.current = live;
  const liveVoice = useLiveVoice({
    baseline: () => ({
      intent: mode ?? "edit",
      scope,
      types,
      modelId,
      webSearch: !!webSearch,
      selectionCount,
    }),
    context: getRouteContext,
    jevKey: routing?.jevKey ?? "",
    jevOnly: !!routing?.jevOnly,
    busy: !!liveBusy,
    failed: !!liveFailed,
    onSend: (text, route) => onSend(text, route),
    ...(routing?.onCommand ? { onCommand: routing.onCommand } : {}),
  });
  const dictation = useDictation((phrase) => {
    if (liveRef.current) {
      liveVoice.push(phrase);
      return;
    }
    latest.current = appendPhrase(latest.current, phrase);
    inputKind.current = "voice";
    phraseLanded.current();
    setValue(latest.current);
  });

  // Live ends when its dictation session does — Stop, Esc, an error or another composer.
  useEffect(() => {
    if (live && !dictation.active && dictation.status?.kind !== "starting") setLive(false);
  }, [live, dictation.active, dictation.status?.kind]);
  const startLive = () => {
    if (dictation.active || disabled) return;
    liveVoice.clear();
    setLive(true);
    dictation.toggle();
  };
  // Visible whenever this device can dictate at all; a first press fetches the speech model
  // and starts live as soon as it is ready.
  const [liveAfterInstall, setLiveAfterInstall] = useState(false);
  const voiceKind = dictation.status?.kind;
  const liveReady = liveAvailable && !disabled && !!voiceKind && voiceKind !== "unavailable";
  const pressLive = () => {
    if (voiceKind === "needs-model") {
      setLiveAfterInstall(true);
      dictation.install();
    } else startLive();
  };
  useEffect(() => {
    if (!liveAfterInstall) return;
    if (voiceKind === "ready") {
      setLiveAfterInstall(false);
      startLive();
    } else if (voiceKind === "error") setLiveAfterInstall(false);
    // startLive reads current state; only the status transition should trigger it.
  }, [liveAfterInstall, voiceKind]);

  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [value]);

  const canSend = value.trim().length > 0 && !busy && !disabled && !dictation.active;

  const send = () => {
    if (!canSend) return;
    // Sending never waits on routing: it uses exactly the route the controls show now.
    if (decision) onSend(value.trim(), decision.route);
    else onSend(value.trim());
    if (controlledValue === undefined) setValue("");
  };

  // Commands, like sends, wait for dictation to finish and never run on their own.
  const canRunCommand = !!command && !busy && !disabled && !dictation.active;
  const runCommand = () => {
    if (!command || !canRunCommand) return;
    routing?.onCommand?.(command);
    setValue("");
  };
  // Who decided the chips, said in the pill itself: Jev, Jev still thinking, or this device.
  const decider =
    route.jev === "asking"
      ? "jev-asking"
      : decision?.source === "jev"
        ? "jev"
        : route.jev === "failed"
          ? "failed"
          : route.jev === "fallback"
            ? "fallback"
            : "local";
  const autoTitle =
    decider === "failed"
      ? `Jev could not route this draft: ${route.jevError}. Your own choices apply.`
      : decider === "jev-asking"
        ? routing?.jevOnly
          ? "Jev is reading your draft."
          : "Jev is reading your draft. On-device suggestions apply until it answers."
        : decision && routed.length > 0
          ? `Set ${routed.map((d) => DIMENSION_NAMES[d]).join(", ")} from your draft ` +
            (decider === "jev"
              ? `with Jev in ${decision.ms} ms`
              : decider === "fallback"
                ? "on this device, because Jev did not answer"
                : "on this device") +
            ". Click to keep your own choices for this draft."
          : decider === "fallback"
            ? "Jev did not answer; on-device routing stands."
            : "Reading your draft…";
  const autoLabel =
    decider === "jev-asking"
      ? null
      : decider === "jev"
        ? "Jev"
        : decider === "failed"
          ? "Jev failed"
          : decider === "fallback"
            ? "local"
            : "auto";

  return (
    <div
      className={
        "w-full rounded-2xl border bg-raised shadow-sm transition-[border-color,box-shadow] duration-fast ease-out " +
        (focused ? "border-focus shadow-md" : "border-default")
      }
    >
      {live && (
        <LiveLine
          partial={dictation.partial}
          entries={liveVoice.entries}
          jevOn={!!routing?.jevKey.trim()}
        />
      )}
      <textarea
        ref={textarea}
        rows={1}
        // Live voice takes this row; the draft is kept, untouched, for when it ends.
        hidden={live}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          inputKind.current = "typed";
          setValue(e.target.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (dictation.handleShortcut(e)) return;
          // A recognised command runs on plain Enter; Cmd+Enter still sends it as a request.
          if (
            command &&
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.nativeEvent.isComposing
          ) {
            e.preventDefault();
            runCommand();
            return;
          }
          // Cmd+Enter sends. Plain Enter inserts a newline — briefs are usually more than
          // one line, and losing a half-written one to a stray keystroke is unforgivable.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={placeholder}
        aria-label="Prompt"
        // The well around it is what lights up on focus, so the field itself draws nothing.
        className="focus-self w-full resize-none bg-transparent px-4 pt-3 text-base text-fg placeholder:text-fg-tertiary disabled:opacity-50"
      />

      {command && (
        <div className="mx-3 mt-1 flex items-center gap-2 rounded-lg border border-subtle bg-inset px-2.5 py-1.5">
          <span aria-hidden className="text-fg-tertiary">
            ↩
          </span>
          <span role="status" className="min-w-0 flex-1 truncate text-sm text-fg">
            {describeCommand(command, getRouteContext().objects)}
          </span>
          <span className="mono hidden sm:inline">↵ to run</span>
          <Button
            variant="secondary"
            shape="pill"
            size="sm"
            onClick={runCommand}
            disabled={!canRunCommand}
          >
            Run
          </Button>
          <button
            type="button"
            onClick={() => {
              lock("command");
              lock("intent");
            }}
            aria-label="Not a command"
            title="Treat this as an ordinary request"
            className="rounded-sm px-1 text-fg-tertiary transition-colors duration-instant ease-out hover:text-fg"
          >
            ✕
          </button>
        </div>
      )}

      {/* Icon row, inside the well. */}
      <div
        className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5 pt-1"
        // A chip under the pointer, or focused with its menu open, never moves under it.
        onPointerEnter={() => route.hold(true)}
        onPointerLeave={() => route.hold(false)}
        onFocus={() => route.hold(true)}
        onBlur={() => route.hold(false)}
      >
        {routingOn && (routed.length > 0 || route.pending || route.jev !== "off") && (
          <button
            type="button"
            onClick={() => setLocked(ALL_LOCKS)}
            title={autoTitle}
            aria-label={autoTitle}
            data-decider={decider}
            // Shrinks and truncates first so Send never wraps onto its own line (1440px with
            // "Connect ChatGPT" in the model pill).
            className={
              PILL +
              " min-w-0 max-w-[12rem] shrink truncate" +
              (decider === "failed"
                ? " text-danger"
                : decider === "fallback"
                  ? " text-fg-secondary"
                  : " text-fg-accent")
            }
          >
            {autoLabel === null ? (
              <DotMatrix label="Jev" />
            ) : routed.length > 0 || decider !== "local" ? (
              autoLabel
            ) : (
              <DotMatrix label="auto" />
            )}
          </button>
        )}
        {mode && onModeChange && (
          <div
            className={
              "flex items-center rounded-full border border-subtle p-0.5" +
              // Unsure band: the mode was set, but the runner-up is offered beside it.
              (decision?.alternative ? " ring-1 ring-[var(--border-focus)]" : "")
            }
            role="group"
            aria-label="Scapi mode"
          >
            {(["ask", "edit"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={effectiveMode === option}
                disabled={busy}
                onClick={() => {
                  lock("intent");
                  onModeChange(option);
                }}
                className={
                  "rounded-full px-2.5 py-0.5 transition-colors duration-instant ease-out " +
                  // A pressed segment is selection, not an action. Its warm surface, accent
                  // label and hairline ring make the current mode clear without competing with
                  // Send's solid action fill.
                  (effectiveMode === option
                    ? "bg-selected font-medium text-fg-accent shadow-sm ring-1 ring-[var(--border-focus)]"
                    : "text-fg-secondary hover:bg-hover hover:text-fg")
                }
              >
                {option === "ask" ? "Ask" : "Edit"}
              </button>
            ))}
          </div>
        )}
        {decision?.alternative && decision.alternative !== "connect" && onModeChange && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              lock("intent");
              onModeChange(decision.alternative as "ask" | "edit");
            }}
            className={PILL}
          >
            or {decision.alternative === "ask" ? "Ask" : "Edit"}?
          </button>
        )}
        {connecting && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              lock("intent");
              onModeChange?.("edit");
            }}
            title="Only draws relationships between existing objects. Click for an ordinary edit."
            className={PILL + " text-fg-accent"}
          >
            Connect only ✕
          </button>
        )}
        {(showScope || asking) && (
          <Select
            variant="pill"
            label="Scope"
            value={effectiveScope}
            onChange={(v) => {
              lock("scope");
              onScopeChange(v as Scope);
            }}
            options={[
              { value: "scape", label: "Whole scape" },
              ...(selectionCount > 0
                ? [{ value: "selection", label: `Selection (${selectionCount})` }]
                : []),
            ]}
            disabled={busy}
          />
        )}
        {showTypes && (
          <TypePicker
            types={effectiveTypes}
            onChange={(next) => {
              lock("types");
              onTypesChange(next);
            }}
            disabled={busy}
            {...(availableTypes ? { availableTypes } : {})}
          />
        )}
        {showInstructions && onInstructionsChange && (
          <InstructionsPill
            value={instructions ?? ""}
            onChange={onInstructionsChange}
            maxLength={maxInstructions}
            disabled={busy}
            {...(globalInstructions ? { globalInstructions } : {})}
            {...(onEditGlobalInstructions ? { onEditGlobal: onEditGlobalInstructions } : {})}
          />
        )}
        {showWebSearch && (
          <label
            className={
              "mono flex items-center gap-1.5 rounded-full border border-subtle px-2.5 py-1 " +
              "normal-case tracking-normal text-fg-secondary " +
              (webSearchUnavailable ? "opacity-40" : "cursor-pointer hover:text-fg")
            }
            title={
              webSearchUnavailable
                ? webSearchUnavailableReason(effectiveModel)
                : "Let Scapi search the web for this question"
            }
          >
            <input
              type="checkbox"
              checked={!!effectiveWebSearch && !webSearchUnavailable}
              onChange={(event) => {
                lock("webSearch");
                onWebSearchChange?.(event.target.checked);
              }}
              disabled={busy || webSearchUnavailable}
              className="accent-[var(--accent)]"
            />
            Search web
          </label>
        )}
        <Select
          variant="pill"
          label="Model"
          value={effectiveModel}
          onChange={(next) => {
            lock("tier");
            onModelChange(next);
          }}
          options={models.map((m) => ({ value: m.id, label: m.label, title: m.hint }))}
          disabled={busy}
        />

        <div className="ml-auto flex items-center gap-1.5">
          {slot}
          {live ? null : busy ? (
            <span className="mono hidden sm:inline">
              <DotMatrix label="working" />
            </span>
          ) : (
            <span
              // With Live in the row, the hint yields first so Send never wraps to a new line.
              className={"mono hidden " + (liveAvailable ? "2xl:inline" : "sm:inline")}
              title="Send with Command or Control + Enter"
            >
              ⌘↵ to send
            </span>
          )}
          {liveAvailable && <LiveHistory entries={liveVoice.entries} onClear={liveVoice.clear} />}
          {!disabled && !live && <MicButton dictation={dictation} size="md" />}
          {live && (
            <Button
              variant="secondary"
              size="sm"
              onClick={dictation.toggle}
              disabled={dictation.status?.kind !== "listening"}
              aria-label="Stop live voice"
              title="Stop live voice · Esc"
              className="gap-1.5"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-danger motion-safe:animate-pulse"
              />
              <Elapsed since={dictation.startedAt} />
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-current" />
            </Button>
          )}
          {liveReady && !live && !dictation.active && (
            <Button
              variant="secondary"
              size="sm"
              onClick={pressLive}
              disabled={voiceKind === "installing" || voiceKind === "starting" || dictation.active}
              title={
                voiceKind === "needs-model"
                  ? "Live voice needs a one-time speech model. Press to download it and start."
                  : "Talk to Scapi: each pause runs what you said as an Ask, Edit or command. Every edit can be undone."
              }
              aria-label="Start live voice"
            >
              <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-danger" />
              {voiceKind === "installing" ? "Preparing…" : "Live"}
            </Button>
          )}
        </div>

        {busy ? (
          // Stop is not the primary action — it undoes one. Filling it accent would put two
          // loud controls in the same corner across the two composers.
          <Button variant="neutral" shape="icon" onClick={onCancel} aria-label="Stop generating">
            <span aria-hidden className="block h-2.5 w-2.5 rounded-[2px] bg-current" />
          </Button>
        ) : live ? null : (
          // Live voice runs each phrase itself; a Send with nothing to send is noise.
          <Button
            variant="primary"
            shape={label ? "pill" : "icon"}
            onClick={send}
            disabled={!canSend}
            aria-label={label ?? "Send"}
            className={"shrink-0 whitespace-nowrap" + (label ? " h-8 py-0.5 pr-1" : "")}
          >
            {label}
            {mode ? (
              <ScapiActionIcon />
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path
                  d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5l4 4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
