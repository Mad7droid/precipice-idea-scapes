import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionPayload } from "@/core/actions";
import { notify } from "@/core/notify";
import { allPlugins, getPlugin } from "@/core/registry";
import { useScapeStore } from "@/core/store";
import { MAX_INSTRUCTIONS, SETTING_KEYS, type ObjectId, type RelationshipId } from "@/core/types";
import { Composer } from "@/ai/Composer";
import type { Scope } from "@/ai/prompt";
import { Ribbon } from "@/ai/Ribbon";
import { useGeneration } from "@/ai/useGeneration";
import { createApplier } from "@/ai/generate";
import { useScapi } from "@/ai/scapi/useScapi";
import { suggestScapiQuestions } from "@/ai/scapi/suggestions";
import { isToolName } from "@/ai/tools";
import { Canvas, type CanvasCommands } from "@/canvas/Canvas";
import { starterFor } from "@/starters";
import { startAutosave, type AutosaveHandle } from "@/persistence/autosave";
import { acquireScapeLease, type ScapeLease } from "@/persistence/lease";
import { downloadScape } from "@/persistence/portable";
import { scapeRepository } from "@/persistence/scapeRepository";
import { settingsRepository } from "@/persistence/settings";
import { PublishSheet } from "@/publish/PublishSheet";
import { PublishClientError, logout } from "@/publish/client";
import {
  clearSession,
  readSession,
  setPendingPublish,
  startSignIn,
  takePendingPublish,
} from "@/publish/session";
import { usePublication } from "@/publish/usePublication";
import { BlockMarkers, scapeTags } from "./BlockMarkers";
import { Outline } from "./Outline";
import { takeEditorIntent, takePendingWork } from "./pending";
import { CommandPalette, HelpPanel, type CommandItem } from "./ProductivityOverlays";
import { RelationshipInspector } from "./RelationshipInspector";
import { navigate, scapeRoute } from "./router";
import { SettingsModal } from "./SettingsModal";
import { TopBar, type ExportFormat } from "./TopBar";
import { useAppSettings } from "./useAppSettings";
import { useTheme } from "./theme";
import { useMcpBridge } from "@/mcp/bridge";

// Markdown is sizeable and Scapi is optional. Keep it out of the editor's first paint.
const ScapiPanel = lazy(() =>
  import("@/ai/scapi/ScapiPanel").then((module) => ({ default: module.ScapiPanel })),
);

/**
 * One scape, open.
 *
 * Everything about *which* scape you are in belongs to the home page now; this screen is the
 * document and nothing else. The left rail is an outline of what is on the canvas, the right
 * one inspects whatever is selected — an object or a relationship — and the composer sits over
 * the canvas because a brief is about what you are looking at.
 */
export function Editor({ scapeId }: { scapeId: string }) {
  const scape = useScapeStore((s) => s.scape);
  const selection = useScapeStore((s) => s.selection);
  const dispatchTx = useScapeStore((s) => s.dispatchTx);
  useEffect(() => {
    if (!scape) return;
    const present = selection.filter((id) => scape.objects[id]);
    if (present.length !== selection.length) useScapeStore.getState().setSelection(present);
  }, [scape, selection]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [scopeOverride, setScopeOverride] = useState<{ selection: string; scope: Scope } | null>(
    null,
  );
  const selectionKey = selection.join("|");
  const scope: Scope =
    selection.length > 0 && scopeOverride?.selection === selectionKey
      ? scopeOverride.scope
      : selection.length
        ? "selection"
        : "scape";
  const setScope = (next: Scope) => setScopeOverride({ selection: selectionKey, scope: next });
  const [proposedEdit, setProposedEdit] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<RelationshipId | null>(null);
  const [booted, setBooted] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Whether the canvas bar is showing its full controls. The bar itself is always present. */
  const [canvasComposerOpen, setCanvasComposerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(280);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(() => window.innerWidth < 768);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => window.innerWidth < 768);
  const [scapiOpen, setScapiOpen] = useState(false);
  const [scapiMode, setScapiMode] = useState<"ask" | "edit">("ask");
  /**
   * One draft behind both composers, and one record of which of them last sent.
   *
   * The draft is shared so that switching surfaces mid-sentence keeps the sentence. The origin
   * decides where the answer surfaces: whichever composer you typed in is the one that shows
   * the result, because that is where you are already looking.
   */
  const [draft, setDraft] = useState("");
  const [lastOrigin, setLastOrigin] = useState<"canvas" | "panel">("canvas");
  const [dismissedTurnId, setDismissedTurnId] = useState<string | null>(null);
  const [scapiWide, setScapiWide] = useState(false);
  const [theme, setTheme, resolvedTheme] = useTheme();
  const {
    apiKey,
    setApiKey,
    modelId,
    setModelId,
    types,
    setTypes,
    instructions,
    setInstructions,
    ready,
  } = useAppSettings();

  const [readOnly, setReadOnly] = useState(false);
  const [takingOver, setTakingOver] = useState(false);

  /**
   * Publication state for this scape. Derived from the local Dexie row plus the projection's
   * hash — the server is the authority, but the top bar must be able to say "published"
   * without a network request every time a scape opens.
   */
  const publication = usePublication(scape, scapeRepository);
  const session = readSession();
  const requestOptions = useMemo(() => (session ? { token: session.token } : {}), [session?.token]);

  /**
   * Picks up an intent that survived the round trip to Google.
   *
   * Someone who clicked Publish, signed in, and came back to a closed sheet would reasonably
   * conclude publishing is broken. Reading it clears it, so a reload does not reopen the sheet.
   */
  useEffect(() => {
    if (takePendingPublish() === scapeId) setPublishOpen(true);
  }, [scapeId]);

  const autosave = useRef<AutosaveHandle | null>(null);
  const lease = useRef<ScapeLease | null>(null);
  /** Identifies this tab to the other tabs, and breaks ties when two claim at once. */
  const tabId = useRef(`tab_${Math.random().toString(36).slice(2, 10)}`);
  const commands = useRef<CanvasCommands | null>(null);
  const inspector = useRef<HTMLElement | null>(null);
  const composerInput = useRef<HTMLTextAreaElement | null>(null);

  const startPanelResize = (side: "left" | "right") => (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftPanelWidth : rightPanelWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = side === "left" ? startWidth + delta : startWidth - delta;
      const clamped = Math.max(260, Math.min(440, next));
      if (side === "left") setLeftPanelWidth(clamped);
      else setRightPanelWidth(clamped);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    // Wait for the panel's width transition, then frame in the actual available canvas.
    const timer = window.setTimeout(
      () => {
        const ids = useScapeStore.getState().selection;
        if (ids.length === 1) commands.current?.focus(ids[0]);
      },
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--dur-fast"),
      ) || 0,
    );
    return () => window.clearTimeout(timer);
  }, [scapiOpen, scapiWide, leftPanelCollapsed, rightPanelCollapsed]);

  useEffect(() => {
    setProposedEdit(null);
  }, [selectionKey, scope]);

  const generation = useGeneration({ requestLayout: () => commands.current?.relayout() });
  const scapi = useScapi({
    getScape: () => useScapeStore.getState().scape,
    getSelection: () => useScapeStore.getState().selection,
    apiKey,
    modelId,
    scapeId,
  });
  const busy = generation.state.status === "streaming";
  const starter = starterFor(scape);

  /**
   * What this generation may create: the starter's constraint, narrowed by the user's own
   * pick. A mind map cannot be talked into a wireframe by unticking a box.
   */
  const allowedTypes = useMemo(() => {
    if (starter.types.length === 0) return types;
    if (types.length === 0) return starter.types;
    const narrowed = types.filter((t) => starter.types.includes(t));
    return narrowed.length > 0 ? narrowed : starter.types;
  }, [starter.types, types]);

  /** Enter / double-click on a node land here — the inspector is already open via selection,
   * so the useful thing left to do is jump focus straight into its first editable field. */
  const focusInspector = () => {
    setRightPanelCollapsed(false);
    setScapiOpen(false);
    window.requestAnimationFrame(() =>
      inspector.current?.querySelector<HTMLElement>("input, textarea")?.focus(),
    );
  };

  // Boot: claim the scape's write lease, start autosave, load the scape named in the route,
  // then run whatever brief was written on the home page.
  useEffect(() => {
    let cancelled = false;

    const reload = async () => {
      const fresh = await scapeRepository.get(scapeId);
      if (!cancelled && fresh) useScapeStore.getState().loadScape(fresh);
    };

    lease.current = acquireScapeLease({
      scapeId,
      holderId: tabId.current,
      // Flush before the other tab reads. Autosave still holds the lease at this point, by
      // construction — the lease downgrades only after this returns.
      onYield: () => autosave.current?.flush(),
      onChange: (status, change) => {
        if (cancelled) return;
        setReadOnly(status === "follower");
        if (status === "holder" && change === "promoted") {
          // Whatever this tab has in memory is older than what the outgoing holder just
          // wrote. Read theirs before writing anything, or the handover loses their edits.
          void reload();
          setTakingOver(false);
        }
      },
    });

    autosave.current = startAutosave(scapeRepository, {
      canWrite: () => lease.current?.status() === "holder",
    });

    void (async () => {
      const loaded = await scapeRepository.get(scapeId);
      if (cancelled) return;
      if (!loaded) {
        notify.error("That scape is gone", "It may have been deleted in another tab.");
        navigate("/");
        return;
      }
      useScapeStore.getState().loadScape(loaded);
      await settingsRepository.set(SETTING_KEYS.lastScapeId, scapeId);
      setBooted(true);
    })();

    return () => {
      cancelled = true;
      autosave.current?.stop();
      autosave.current = null;
      // Order matters: the flush inside stop() has to land while this tab still holds the
      // lease, because releasing it lets another tab read immediately.
      lease.current?.stop();
      lease.current = null;
    };
  }, [scapeId]);

  // Whatever the home page set up: a brief to run, or a starter's seed object to place. Taken
  // once, so a refresh neither re-runs a generation the user has paid for nor re-seeds a
  // canvas they deliberately emptied.
  useEffect(() => {
    if (!booted || !ready) return;
    const intent = takeEditorIntent(scapeId);
    if (intent === "publish") setPublishOpen(true);
    if (intent === "scapi") setScapiOpen(true);
    if (intent === "agent") setSettingsOpen(true);
    const pending = takePendingWork();
    if (!pending) return;
    if (pending.seed?.length) {
      dispatchTx(pending.seed);
      commands.current?.relayout();
    }
    if (pending.request) void handleSend(pending.request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, ready]);

  // A finished generation is read on the canvas, not in a control panel. Shrink the bar back
  // to its resting size so the work has the screen; the next prompt is still one click away.
  useEffect(() => {
    if (generation.state.status === "done") setCanvasComposerOpen(false);
  }, [generation.state.status]);

  // Global Cmd+Z / Cmd+Shift+Z — not just canvas-scoped, since the inspector and outline sit
  // right next to it and a drag's undo shouldn't depend on which panel last had focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (meta && event.key.toLowerCase() === "j") {
        event.preventDefault();
        // A toggle, and only of the panel. Scapi's request lives in the hook above this
        // component, so hiding the transcript never cancels the work behind it — the answer
        // and any applied changes are waiting when you open it again.
        setScapiOpen((open) => !open);
        return;
      }
      if (meta && event.key === "/") {
        event.preventDefault();
        const collapse = !(leftPanelCollapsed && rightPanelCollapsed);
        setLeftPanelCollapsed(collapse);
        setRightPanelCollapsed(collapse);
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
        setShortcutsOpen(true);
        return;
      }
      if (event.key === "Escape" && scapiOpen) {
        event.preventDefault();
        setScapiOpen(false);
        return;
      }
      if (!meta || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      // Undo is an edit. In a follower tab it would change a document this tab cannot save,
      // so the canvas would silently drift from what is on disk.
      if (readOnly) return;
      if (event.shiftKey) useScapeStore.getState().redo();
      else useScapeStore.getState().undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leftPanelCollapsed, rightPanelCollapsed, readOnly, scapiOpen]);

  /**
   * The one place an edit can be attempted while another tab holds the scape. The canvas and
   * the inspector are already inert by then; this covers the paths that are not — the
   * composer, the quick actions and the title field.
   */
  const requireLease = () => {
    if (!readOnly) return true;
    notify.info("This scape is open in another tab", "Choose “Edit here” to move editing to it.");
    return false;
  };

  const takeOver = async () => {
    setTakingOver(true);
    await lease.current?.takeOver();
  };

  const requireKey = () => {
    if (apiKey.trim()) return true;
    notify.error("No API key", "Add an Anthropic API key in settings, then try again.");
    setSettingsOpen(true);
    return false;
  };

  /**
   * The scape's own standing instructions.
   *
   * `version` counts edits rather than tracking content, because it is what a connected agent
   * holds between reading the instructions and replacing them. Clearing the field removes the
   * field entirely — an empty body and no body are the same thing, and only one of them should
   * ever reach a prompt or a file.
   */
  const setScapeInstructions = (body: string) => {
    if (!requireLease()) return;
    const trimmed = body.trim().slice(0, MAX_INSTRUCTIONS);
    const current = scape?.instructions;
    if ((current?.body ?? "") === trimmed) return;
    dispatchTx([
      trimmed
        ? {
            type: "SetInstructions",
            instructions: { body: trimmed, version: (current?.version ?? 0) + 1 },
          }
        : { type: "SetInstructions" },
    ]);
    notify.success(trimmed ? "Instructions saved." : "Instructions cleared.");
  };

  /**
   * An edit, from whichever composer asked for it.
   *
   * A canvas-bar edit deliberately opens nothing: the blocks arriving one by one *are* the
   * result, and a panel narrating that over the top of them is chrome in front of the thing
   * worth watching. The Ribbon carries progress and Undo.
   */
  const handleSend = async (request: string, origin: "canvas" | "panel" = "canvas") => {
    if (busy || scapi.streaming || !requireLease()) return;
    if (!requireKey()) return;
    setLastOrigin(origin);
    setScapiMode("edit");
    if (origin === "panel") setScapiOpen(true);
    await generation.start({
      request,
      apiKey: apiKey.trim(),
      modelId,
      allowedTypes,
      scope,
      globalInstructions: instructions,
    });
  };

  /** A question, from whichever composer asked it. One transcript underneath both. */
  const handleAsk = (question: string, origin: "canvas" | "panel" = "canvas") => {
    if (busy || !requireLease() || !requireKey()) return;
    setLastOrigin(origin);
    setScapiMode("ask");
    void scapi.send(question);
  };

  const handleConnect = async (ids?: ObjectId[]) => {
    if (!requireLease()) return;
    if (!requireKey()) return;
    await generation.connect(apiKey.trim(), modelId, ids, instructions);
  };

  /**
   * The local agent bridge is intentionally routed through the same model-facing action applier
   * as a normal generation. That keeps the schema, plugin validation, reducer, autosave and one
   * transaction/undo behaviour identical instead of creating a second back door into the store.
   */
  const applyMcpActions = useCallback(
    (payloads: ActionPayload[]) => {
      if (readOnly) {
        notify.error("This tab is read-only", "Take over editing before applying agent changes.");
        return { applied: 0, skipped: payloads.length };
      }
      const applier = createApplier({
        dispatch: (action) => useScapeStore.getState().dispatch(action),
        onEvent: () => undefined,
        requestLayout: () => commands.current?.relayout(),
        allowedTypes,
      });
      for (const payload of payloads) {
        if (isToolName(payload.type)) applier.apply(payload.type, payload);
      }
      applier.finish();
      const result = { applied: applier.applied(), skipped: applier.skipped() };
      if (result.applied > 0) {
        notify.success(
          "Agent changes applied.",
          `${result.applied} ${result.applied === 1 ? "change" : "changes"} added to this scape.`,
        );
      }
      return result;
    },
    [allowedTypes, readOnly],
  );

  const mcpBridge = useMcpBridge({
    scape,
    apply: applyMcpActions,
    currentScape: () => useScapeStore.getState().scape,
  });

  /**
   * A `.scape` is a serialisation and lands instantly. A PDF is a render — big scapes take a
   * beat — so the button says so, after a frame in which the label can actually paint.
   */
  const exportAs = async (format: ExportFormat) => {
    if (!scape) return;
    if (format === "scape") {
      downloadScape(scape);
      return;
    }
    setExporting(true);
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    try {
      const { exportScapePdf } = await import("@/export/pdf");
      const result = await exportScapePdf(scape, {
        plugins: allPlugins(),
        ...(commands.current ? { measured: commands.current.measuredSizes() } : {}),
      });
      notify.success(
        "Exported.",
        `${result.objects} ${result.objects === 1 ? "block" : "blocks"} over ${result.pages} ${
          result.pages === 1 ? "page" : "pages"
        }.`,
      );
    } catch (error) {
      notify.error(
        "Could not export the PDF.",
        error instanceof Error ? error.message : "Try again, or export a scape file instead.",
      );
    } finally {
      setExporting(false);
    }
  };

  const selectFromOutline = (id: ObjectId) => {
    setSelectedEdgeId(null);
    useScapeStore.getState().setSelection([id]);
    commands.current?.focus(id);
  };

  /** Opens the canvas bar in place. It is the composer now, not a button that summons one. */
  const focusComposer = () => {
    setCanvasComposerOpen(true);
    window.requestAnimationFrame(() => composerInput.current?.focus());
  };

  /**
   * The answer the canvas bar shows: only the latest, only when this bar is what asked, and
   * only while the panel is not already showing the same thing in full.
   */
  const latestTurn = scapi.turns[scapi.turns.length - 1];
  const canvasAnswer =
    !scapiOpen && lastOrigin === "canvas" && latestTurn && latestTurn.id !== dismissedTurnId
      ? latestTurn
      : undefined;

  const composerPlaceholder =
    scapiMode === "ask"
      ? scope === "selection"
        ? "Ask about this selection…"
        : "Ask about this scape…"
      : scope === "selection"
        ? "Describe a change to this selection…"
        : starter.placeholder;

  const selectedObject = selection.length === 1 && scape ? scape.objects[selection[0]] : undefined;
  /** Tags already in play, offered when marking a block so a shared vocabulary forms. */
  const tagSuggestions = useMemo(
    () => (scape ? scapeTags(scape.objects).map((entry) => entry.tag) : []),
    [scape],
  );
  const plugin = selectedObject ? getPlugin(selectedObject.type) : undefined;
  const selectedEdge = selectedEdgeId && scape ? scape.relationships[selectedEdgeId] : undefined;
  // A palette that lists what you cannot do is a palette you stop trusting. In a follower tab
  // the commands that change the document are absent, not present-and-inert.
  const editCommands: CommandItem[] = readOnly
    ? [{ id: "take-over", label: "Edit here", hint: "Move editing to this tab", run: takeOver }]
    : [
        // Registry-driven, so a new object type reaches the palette by existing rather than by
        // being remembered here.
        ...allPlugins()
          .filter(
            (candidate) => starter.types.length === 0 || starter.types.includes(candidate.type),
          )
          .map((candidate) => ({
            id: `add-${candidate.type}`,
            label: `Add ${candidate.label.toLowerCase()}`,
            hint: "Create at canvas centre",
            ...(BLOCK_SHORTCUTS[candidate.type]
              ? { shortcut: BLOCK_SHORTCUTS[candidate.type] }
              : {}),
            run: () => commands.current?.addObject(candidate.type),
          })),
        {
          id: "tidy",
          label: "Tidy layout",
          hint: "Arrange left to right and fit",
          run: () => commands.current?.relayout("LR"),
        },
        {
          id: "ask-ai",
          label: "Tell AI what to do",
          hint: "Open the composer",
          run: focusComposer,
        },
        {
          id: "ask-scapi",
          label: scapiOpen ? "Close Scapi" : "Ask Scapi",
          hint: scapiOpen ? "Hide the panel; work keeps running" : "Ask about this scape",
          shortcut: "⌘J",
          run: () => setScapiOpen((open) => !open),
        },
      ];

  const commandItems: CommandItem[] = [
    ...editCommands,
    { id: "fit", label: "Fit canvas", shortcut: "⇧1", run: () => commands.current?.fit() },
    {
      id: "zoom-reset",
      label: "Reset zoom",
      shortcut: "0",
      run: () => commands.current?.resetZoom(),
    },
    { id: "settings", label: "Open settings", run: () => setSettingsOpen(true) },
    {
      id: "shortcuts",
      label: "Help and keyboard shortcuts",
      shortcut: "?",
      run: () => setShortcutsOpen(true),
    },
  ];

  if (!booted || !ready || !scape) return null;

  return (
    <div className="flex h-full flex-col bg-base">
      <TopBar
        scapiOpen={scapiOpen}
        onOpenScapi={() => setScapiOpen((open) => !open)}
        scape={scape}
        onBack={() => navigate("/")}
        onRename={(name) => {
          if (!requireLease()) return;
          dispatchTx([{ type: "RenameScape", name }]);
        }}
        onExport={exportAs}
        exporting={exporting}
        onOpenSettings={() => setSettingsOpen(true)}
        onPublish={() => setPublishOpen(true)}
        publicationState={publication.state}
        theme={theme}
        onThemeChange={setTheme}
      />

      <div className="flex min-h-0 flex-1">
        <div
          className="relative h-full shrink-0 transition-[width] duration-fast ease-out"
          style={{ width: leftPanelCollapsed ? 32 : `min(${leftPanelWidth}px, 78vw)` }}
        >
          <div className="flex h-full">
            <Outline
              scape={scape}
              selection={selection}
              onSelect={selectFromOutline}
              onConnectLoose={(ids) => void handleConnect(ids)}
              onSelectMany={(ids) => {
                setSelectedEdgeId(null);
                useScapeStore.getState().setSelection(ids);
                if (ids[0]) commands.current?.focus(ids[0]);
              }}
              busy={busy}
              readOnly={readOnly}
              isCollapsed={leftPanelCollapsed}
              onToggleCollapse={() => setLeftPanelCollapsed((open) => !open)}
            />
            {!leftPanelCollapsed && !readOnly && (
              <BlockNav
                availableTypes={starter.types}
                onAdd={(type) => commands.current?.addObject(type)}
              />
            )}
          </div>
          {!leftPanelCollapsed && (
            <span
              role="separator"
              aria-label="Resize outline"
              onPointerDown={startPanelResize("left")}
              className="absolute right-0 top-0 z-panel h-full w-1 cursor-col-resize transition-colors hover:bg-accent/40"
            />
          )}
        </div>

        <div className="relative min-w-0 flex-1">
          <Canvas
            onReady={(c) => (commands.current = c)}
            onOpenInspector={focusInspector}
            onEdgeSelect={setSelectedEdgeId}
            onOpenHelp={() => setShortcutsOpen(true)}
            isGenerating={busy}
            colorMode={resolvedTheme}
            readOnly={readOnly}
          />

          {readOnly && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-composer flex justify-center px-4">
              <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-subtle bg-surface px-3 py-1.5 shadow-md">
                <span className="text-fg-secondary">Open in another tab</span>
                <button
                  type="button"
                  onClick={() => void takeOver()}
                  disabled={takingOver}
                  className="rounded-full border border-subtle px-2.5 py-0.5 text-fg transition-colors duration-instant ease-out hover:bg-hover disabled:text-fg-tertiary"
                >
                  {takingOver ? "Moving…" : "Edit here"}
                </button>
              </div>
            </div>
          )}

          {/*
            The canvas composer. It is the real input, not a button that opens one elsewhere.
            It yields only to the Scapi panel, which renders the *same* composer over the same
            draft — two live textareas for one draft is a worse answer than one, and a
            duplicated Ribbon underneath them is worse still.
          */}
          <div
            className={
              "pointer-events-none absolute inset-x-0 bottom-4 z-composer flex flex-col items-center gap-2 px-4" +
              (scapiOpen ? " hidden" : "")
            }
          >
            <div className="pointer-events-auto w-full max-w-[720px]">
              <Ribbon
                state={generation.state}
                onCancel={generation.cancel}
                onUndo={generation.undo}
                onDismiss={generation.dismiss}
              />
            </div>

            {canvasAnswer && (
              <div className="pointer-events-auto w-full max-w-[720px] rounded-2xl border border-subtle bg-surface p-3 shadow-md">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="mono">Scapi</span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setScapiOpen(true)}
                      className="text-xs text-fg-secondary transition-colors duration-instant ease-out hover:text-fg"
                    >
                      Open in Scapi
                    </button>
                    <button
                      type="button"
                      onClick={() => setDismissedTurnId(canvasAnswer.id)}
                      aria-label="Dismiss answer"
                      className="text-fg-tertiary transition-colors duration-instant ease-out hover:text-fg"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="max-h-[38vh] overflow-auto whitespace-pre-wrap text-fg">
                  {canvasAnswer.body || (scapi.streaming ? "…" : "")}
                </div>
              </div>
            )}

            {canvasComposerOpen ? (
              <div className="pointer-events-auto w-full max-w-[720px]">
                <Composer
                  instructions={scape.instructions?.body ?? ""}
                  onInstructionsChange={setScapeInstructions}
                  globalInstructions={instructions}
                  onEditGlobalInstructions={() => setSettingsOpen(true)}
                  controls={{ instructions: true }}
                  value={draft}
                  onValueChange={setDraft}
                  onSend={(text) => {
                    if (scapiMode === "ask") handleAsk(text, "canvas");
                    else void handleSend(text, "canvas");
                  }}
                  sendLabel={scapiMode === "ask" ? "Ask" : "Edit"}
                  onCancel={scapiMode === "ask" ? scapi.cancel : generation.cancel}
                  busy={scapiMode === "ask" ? scapi.streaming : busy}
                  disabled={readOnly || (scapiMode === "ask" ? busy : scapi.streaming)}
                  mode={scapiMode}
                  onModeChange={setScapiMode}
                  webSearch={scapi.webSearch}
                  onWebSearchChange={scapi.setWebSearch}
                  webSearchUnavailable={scapi.searchAvailability === "unavailable"}
                  modelId={modelId}
                  onModelChange={setModelId}
                  scope={scope}
                  onScopeChange={setScope}
                  types={types}
                  onTypesChange={setTypes}
                  availableTypes={starter.types}
                  selectionCount={selection.length}
                  inputRef={composerInput}
                  placeholder={composerPlaceholder}
                />
              </div>
            ) : (
              <div className="pointer-events-auto flex max-w-[calc(100vw-32px)] items-center gap-1.5">
                <button
                  type="button"
                  onClick={focusComposer}
                  aria-label="Open the composer"
                  className="flex w-[min(360px,calc(100vw-32px))] items-center gap-2 rounded-full border border-subtle bg-surface px-4 py-2 text-left text-sm text-fg-secondary shadow-md transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 15 15"
                    fill="none"
                    aria-hidden
                    className="shrink-0 text-fg-tertiary"
                  >
                    <path
                      d="M7.5 1.75v2M7.5 11.25v2M1.75 7.5h2M11.25 7.5h2M3.43 3.43l1.42 1.42M10.15 10.15l1.42 1.42M11.57 3.43l-1.42 1.42M4.85 10.15l-1.42 1.42"
                      stroke="currentColor"
                      strokeWidth="1.15"
                      strokeLinecap="round"
                    />
                    <circle cx="7.5" cy="7.5" r="2.15" stroke="currentColor" strokeWidth="1.15" />
                  </svg>
                  <span className="min-w-0 flex-1 truncate">
                    {draft.trim() || composerPlaceholder}
                  </span>
                </button>

                {/* Inline, not stacked above: a floating row of its own landed on top of
                    whichever block sat at the bottom of the canvas. */}
                {selection.length > 0 && !busy && (
                  <>
                    <QuickAction onClick={() => void handleConnect(selection)}>
                      {selection.length > 1 ? "Connect these" : "Connect this"}
                    </QuickAction>
                    <QuickAction
                      onClick={() =>
                        void handleSend(
                          selection.length > 1
                            ? "Expand on the selected objects. Add the detail they are missing and connect what you add."
                            : "Expand on the selected object. Add the detail it is missing and connect what you add.",
                          "canvas",
                        )
                      }
                    >
                      Expand
                    </QuickAction>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div
          className="relative h-full shrink-0 transition-[width] duration-fast ease-out"
          style={{
            width: scapiOpen
              ? scapiWide
                ? "min(720px, 92vw)"
                : "min(420px, 65vw)"
              : rightPanelCollapsed
                ? 32
                : selectedEdge || (selectedObject && plugin)
                  ? `min(${rightPanelWidth}px, 78vw)`
                  : 0,
          }}
        >
          {scapiOpen ? (
            <aside className="z-panel flex h-full w-full min-w-0 flex-col border-l border-subtle bg-surface">
              <div className="flex shrink-0 items-center justify-between border-b border-subtle px-4 py-2.5">
                <h2 className="text-sm font-[var(--weight-emph)] text-fg">Scapi</h2>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setScapiWide((wide) => !wide)}
                    className="text-xs text-fg-secondary transition-colors duration-instant ease-out hover:text-fg"
                  >
                    {scapiWide ? "Narrow" : "Expand"}
                  </button>
                  <button
                    type="button"
                    onClick={scapi.clear}
                    disabled={scapi.turns.length === 0}
                    className="text-xs text-fg-secondary transition-colors duration-instant ease-out hover:text-fg disabled:opacity-40"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setScapiOpen(false)}
                    aria-label="Close Scapi"
                    title="Close Scapi (⌘J). Anything running keeps running."
                    className="text-fg-tertiary transition-colors duration-instant ease-out hover:text-fg"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {proposedEdit && (
                <div
                  className="border-b border-subtle bg-inset p-4"
                  role="region"
                  aria-label="Review proposed edit"
                >
                  <p className="text-sm text-fg">Review before editing</p>
                  <div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-fg-secondary">
                    {proposedEdit.replace(/^.*?Scapi's proposal:\n/s, "")}
                  </div>
                  <p className="mt-1 text-xs text-fg-secondary">
                    {scope === "selection"
                      ? `Only the ${selection.length} selected block(s) can be changed.`
                      : "This edit can change the whole scape."}{" "}
                    The generator will interpret the proposal above. You can undo the result.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={busy || scapi.streaming || readOnly}
                      className="rounded-sm border border-default px-3 py-1.5 text-fg hover:bg-hover disabled:opacity-40"
                      onClick={() => {
                        const request = proposedEdit;
                        if (!requireLease() || !requireKey()) return;
                        setProposedEdit(null);
                        void handleSend(request, "panel");
                      }}
                    >
                      Apply proposed edit
                    </button>
                    <button
                      type="button"
                      className="rounded-sm px-3 py-1.5 text-fg-secondary hover:bg-hover"
                      onClick={() => setProposedEdit(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              <div className="min-h-0 flex-1">
                <Suspense fallback={<div className="flex-1 bg-surface" />}>
                  <ScapiPanel
                    turns={scapi.turns}
                    streaming={scapi.streaming}
                    onSend={(question) => handleAsk(question, "panel")}
                    onCancel={scapi.cancel}
                    onRetry={() => {
                      if (!busy && requireKey()) scapi.retry();
                    }}
                    onObjectClick={(id) => {
                      setSelectedEdgeId(null);
                      useScapeStore.getState().setSelection([id]);
                      commands.current?.focus(id);
                    }}
                    onTurnIntoEdit={(turn) => {
                      setProposedEdit(
                        `Apply this proposed change to the scape. User request: ${turn.question}\n\nScapi's proposal:\n${turn.body}`,
                      );
                    }}
                    objects={scape.objects}
                    webSearch={scapi.webSearch}
                    onWebSearchChange={scapi.setWebSearch}
                    searchAvailability={scapi.searchAvailability}
                    restored={scapi.restored}
                    suggestions={suggestScapiQuestions(scape)}
                    disabled={!apiKey.trim() || busy}
                    value={draft}
                    onValueChange={setDraft}
                    {...(generation.state.status === "idle"
                      ? {}
                      : {
                          activity: (
                            <div role="status">
                              <Ribbon
                                state={generation.state}
                                onCancel={generation.cancel}
                                onUndo={() => {
                                  if (requireLease()) generation.undo();
                                }}
                                onDismiss={generation.dismiss}
                              />
                            </div>
                          ),
                        })}
                    composer={
                      <div className="shrink-0 border-t border-subtle p-3">
                        <Composer
                          instructions={scape.instructions?.body ?? ""}
                          onInstructionsChange={setScapeInstructions}
                          globalInstructions={instructions}
                          onEditGlobalInstructions={() => setSettingsOpen(true)}
                          controls={{ instructions: true }}
                          value={draft}
                          onValueChange={setDraft}
                          onSend={(text) => {
                            if (scapiMode === "ask") handleAsk(text, "panel");
                            else void handleSend(text, "panel");
                          }}
                          sendLabel={scapiMode === "ask" ? "Ask" : "Edit"}
                          onCancel={scapiMode === "ask" ? scapi.cancel : generation.cancel}
                          busy={scapiMode === "ask" ? scapi.streaming : busy}
                          disabled={
                            readOnly ||
                            !apiKey.trim() ||
                            (scapiMode === "ask" ? busy : scapi.streaming)
                          }
                          mode={scapiMode}
                          onModeChange={setScapiMode}
                          webSearch={scapi.webSearch}
                          onWebSearchChange={scapi.setWebSearch}
                          webSearchUnavailable={scapi.searchAvailability === "unavailable"}
                          modelId={modelId}
                          onModelChange={setModelId}
                          scope={scope}
                          onScopeChange={setScope}
                          types={types}
                          onTypesChange={setTypes}
                          availableTypes={starter.types}
                          selectionCount={selection.length}
                          placeholder={
                            apiKey.trim()
                              ? composerPlaceholder
                              : "Add an API key in settings to ask."
                          }
                        />
                      </div>
                    }
                  />
                </Suspense>
              </div>
            </aside>
          ) : rightPanelCollapsed ? (
            <button
              type="button"
              onClick={() => setRightPanelCollapsed(false)}
              aria-label="Expand inspector"
              title="Expand inspector (⌘/)"
              className="grid h-full w-full place-items-start pt-2 text-fg-tertiary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
            >
              ‹
            </button>
          ) : (
            (selectedEdge || (selectedObject && plugin)) && (
              <aside
                ref={inspector}
                className="z-panel h-full w-full overflow-auto border-l border-subtle bg-surface p-4"
              >
                {selectedEdge ? (
                  // `display: contents` so this changes what the controls do and nothing about
                  // where they sit; a disabled fieldset disables every control inside it
                  // regardless of how it is laid out.
                  <fieldset disabled={readOnly} className="contents">
                    <RelationshipInspector
                      scape={scape}
                      relationship={selectedEdge}
                      onClose={() => setSelectedEdgeId(null)}
                      onFocusObject={selectFromOutline}
                    />
                  </fieldset>
                ) : (
                  selectedObject &&
                  plugin && (
                    <>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-fg-secondary">{plugin.label}</span>
                        <button
                          type="button"
                          aria-label="Close inspector"
                          onClick={() => commands.current?.clearSelection()}
                          className="grid h-6 w-6 place-items-center rounded-sm text-fg-tertiary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
                        >
                          ✕
                        </button>
                      </div>
                      <fieldset disabled={readOnly} className="contents">
                        <BlockMarkers
                          object={selectedObject}
                          dispatch={(payload: ActionPayload) => dispatchTx([payload])}
                          suggestions={tagSuggestions}
                        />
                        <plugin.Inspector
                          object={selectedObject}
                          dispatch={(payload: ActionPayload) => dispatchTx([payload])}
                        />
                      </fieldset>
                    </>
                  )
                )}
              </aside>
            )
          )}
          {!scapiOpen && !rightPanelCollapsed && (selectedEdge || (selectedObject && plugin)) && (
            <button
              type="button"
              onClick={() => setRightPanelCollapsed(true)}
              aria-label="Collapse inspector"
              title="Collapse inspector (⌘/)"
              className="absolute right-1 top-10 z-panel grid h-6 w-6 place-items-center rounded-sm text-fg-tertiary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
            >
              ›
            </button>
          )}
          {!scapiOpen && !rightPanelCollapsed && (selectedEdge || (selectedObject && plugin)) && (
            <span
              role="separator"
              aria-label="Resize inspector"
              onPointerDown={startPanelResize("right")}
              className="absolute left-0 top-0 z-panel h-full w-1 cursor-col-resize transition-colors hover:bg-accent/40"
            />
          )}
        </div>
      </div>

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          instructions={instructions}
          onInstructionsChange={setInstructions}
          onThemeChange={setTheme}
          onOpenHelp={() => {
            setSettingsOpen(false);
            setShortcutsOpen(true);
          }}
          mcpBridge={mcpBridge}
        />
      )}
      {publishOpen && (
        <PublishSheet
          scape={scape}
          publication={publication}
          options={requestOptions}
          onClose={() => setPublishOpen(false)}
          onSignIn={async (turnstileToken) => {
            // The intent has to outlive a top-level navigation to Google and back, so it goes
            // to sessionStorage rather than to a module-level box.
            setPendingPublish(scape.id);
            await startSignIn(scapeRoute(scape.id), turnstileToken);
          }}
          onSignOut={async () => {
            // Revoking on the server is best effort; forgetting the token locally is not. A
            // session the server has already dropped answers 401 to its own logout, and if that
            // aborted the local clear the user would be sealed into a signed-in UI that can
            // neither publish nor sign out. The worst case of clearing anyway is a server-side
            // session nobody holds a token for, which expires on its own.
            const revoked = session
              ? await logout(requestOptions).then(
                  () => true,
                  (error: unknown) =>
                    // A rejected token is already dead on the server; anything else means the
                    // request never landed, and the user should know the session may still be live.
                    error instanceof PublishClientError && error.code === "unauthorized",
                )
              : true;
            clearSession();
            publication.refresh();
            if (!revoked) {
              notify.info(
                "Signed out on this device.",
                "The publishing service could not be reached, so the session may still be active elsewhere.",
              );
            }
          }}
          isAdmin={session?.isAdmin}
        />
      )}
      {commandOpen && <CommandPalette items={commandItems} onClose={() => setCommandOpen(false)} />}
      {shortcutsOpen && <HelpPanel onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

/**
 * Actions that only make sense with something selected, placed where the selection is — over
 * the canvas, above the composer — rather than in a menu you have to already know about.
 */
function QuickAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-subtle bg-surface px-3 py-1 text-xs text-fg-secondary shadow-sm transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
    >
      {children}
    </button>
  );
}

const BLOCK_SHORTCUTS: Record<string, string> = {
  note: "N",
  journey: "J",
  wireframe: "W",
  scape: "S",
};

/** A compact creation rail: it expands naturally as the object registry grows. */
function BlockNav({
  availableTypes,
  onAdd,
}: {
  availableTypes: string[];
  onAdd: (type: string) => void;
}) {
  const plugins = allPlugins().filter(
    (plugin) => availableTypes.length === 0 || availableTypes.includes(plugin.type),
  );

  return (
    <nav
      aria-label="Add building block"
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-subtle bg-surface px-1 py-2"
    >
      {plugins.map((plugin) => {
        const shortcut = BLOCK_SHORTCUTS[plugin.type];
        const label = `Add ${plugin.label}${shortcut ? ` (${shortcut})` : ""}`;
        return (
          <button
            key={plugin.type}
            type="button"
            aria-label={label}
            onClick={() => onAdd(plugin.type)}
            className="group relative grid h-8 w-8 place-items-center rounded-sm text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
          >
            <BlockIcon type={plugin.type} color={plugin.color} />
            <span className="pointer-events-none absolute left-[calc(100%+6px)] top-1/2 z-popover -translate-y-1/2 whitespace-nowrap rounded-sm border border-subtle bg-raised px-2 py-1 text-xs text-fg opacity-0 shadow-md transition-opacity duration-instant ease-out group-hover:opacity-100 group-focus-visible:opacity-100">
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function BlockIcon({ type, color }: { type: string; color: string }) {
  const stroke = `var(${color})`;
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
      {type === "note" && (
        <path
          d="M3 2.5h8l3 3v9H3v-12ZM11 2.5v3h3"
          stroke={stroke}
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
      )}
      {type === "journey" && (
        <path
          d="M3 4h4m3 0h4M5 2v4m7-4v4M3 13h4m3 0h4M5 11v4m7-4v4M7 4h3M7 13h3"
          stroke={stroke}
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      )}
      {type === "wireframe" && (
        <path
          d="M2.5 3h12v11h-12zM2.5 6h12M5 8.5h2.5M5 11h6.5"
          stroke={stroke}
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
      )}
      {type === "scape" && (
        <path
          d="M3.5 2.5h10v12h-10zM6 5.5h5M6 8h5M6 10.5h3"
          stroke={stroke}
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {!["note", "journey", "wireframe", "scape"].includes(type) && (
        <circle cx="8.5" cy="8.5" r="4.5" fill={stroke} />
      )}
    </svg>
  );
}
