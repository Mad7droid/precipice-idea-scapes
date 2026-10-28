import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import type { ActionPayload } from "@/core/actions";
import { notify, useNotifications } from "@/core/notify";
import { allPlugins, getPlugin } from "@/core/registry";
import { useScapeStore } from "@/core/store";
import { MAX_INSTRUCTIONS, type ObjectId, type RelationshipId } from "@/core/types";
import { Composer, type ComposerRouting, type SendRoute } from "@/ai/Composer";
import { modelForTier, tierOf } from "@/ai/models";
import type { LocalCommand } from "@/ai/router/types";
import type { Scope } from "@/ai/prompt";
import { Ribbon } from "@/ai/Ribbon";
import { useGeneration } from "@/ai/useGeneration";
import { createApplier } from "@/ai/applier";
import { useScapi } from "@/ai/scapi/useScapi";
import { useScapiMood } from "@/ai/scapi/useScapiMood";
import { suggestScapiQuestions } from "@/ai/scapi/suggestions";
import { isToolName } from "@/ai/tools";
import { Canvas, type CanvasCommands } from "@/canvas/Canvas";
import { Scapi } from "@/components/scapi/Scapi";
import { Button, buttonClass } from "@/design/Button";
import { starterFor } from "@/starters";
import { downloadScape } from "@/persistence/portable";
import { scapeRepository } from "@/persistence/scapeRepository";
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
import { SettingsModal, type SettingsSection } from "./SettingsModal";
import { TopBar, type ExportFormat } from "./TopBar";
import { useAppSettings } from "./useAppSettings";
import { useTheme } from "./theme";
import { useMcpBridge } from "@/mcp/bridge";
import { publishToken, saveHostCredential } from "@/mcp/host/credential";
import { signOutDesktop } from "@/mcp/host/desktopAuth";
import { isDesktop } from "@/desktop/runtime";
import { BLOCK_SHORTCUTS, BlockNav } from "./editor/BlockNav";
import {
  INSPECTOR_COLLAPSE_BELOW,
  OUTLINE_COLLAPSE_BELOW,
  PANEL,
  viewportShowsContent,
  visibleObjectIds,
} from "./editor/layout";
import { PanelResizer } from "./editor/PanelResizer";
import { useEditorSession } from "./editor/useEditorSession";
import { useEditorShortcuts } from "./editor/useEditorShortcuts";

/** The same toast twice in a row is noise; repeated clicks must not stack copies. */
function notifyOnce(level: "info" | "danger", message: string, detail: string) {
  if (useNotifications.getState().toasts.some((toast) => toast.message === message)) return;
  if (level === "info") notify.info(message, detail);
  else notify.error(message, detail);
}

// Markdown is sizeable and Scapi is optional. Keep it out of the editor's first paint.
const ScapiPanel = lazy(() =>
  import("@/ai/scapi/ScapiPanel").then((module) => ({ default: module.ScapiPanel })),
);
// Same chunk as the panel: the canvas answer renders markdown exactly as the panel does.
const AnswerBody = lazy(() =>
  import("@/ai/scapi/ScapiPanel").then((module) => ({ default: module.AnswerBody })),
);
const AnswerError = lazy(() =>
  import("@/ai/scapi/ScapiPanel").then((module) => ({ default: module.AnswerError })),
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

  /** Which settings section is open, or null. AI prompts open straight on the AI section. */
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const settingsOpen = settingsSection !== null;
  const setSettingsOpen = (open: boolean) => setSettingsSection(open ? "general" : null);
  const openAiSettings = () => setSettingsSection("ai");
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
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Whether the canvas bar is showing its full controls. The bar itself is always present. */
  const [canvasComposerOpen, setCanvasComposerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(PANEL.left);
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(PANEL.right);
  // A narrow window gives the canvas the room: the outline yields first, then the inspector.
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(
    () => window.innerWidth < OUTLINE_COLLAPSE_BELOW,
  );
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(
    () => window.innerWidth < INSPECTOR_COLLAPSE_BELOW,
  );
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
  const appSettings = useAppSettings();
  const {
    credentials,
    apiKey,
    setApiKey,
    modelId,
    setModelId,
    types,
    setTypes,
    instructions,
    setInstructions,
    routeChips,
    jevRouting,
    jevOnly,
    jevKey,
    ready,
  } = appSettings;

  /**
   * Publication state for this scape. Derived from the local Dexie row plus the projection's
   * hash — the server is the authority, but the top bar must be able to say "published"
   * without a network request every time a scape opens.
   */
  const publication = usePublication(scape, scapeRepository);
  const session = readSession();
  const publishingToken = publishToken();
  const requestOptions = useMemo(
    () => (publishingToken ? { token: publishingToken } : {}),
    [publishingToken],
  );

  /**
   * Picks up an intent that survived the round trip to Google.
   *
   * Someone who clicked Publish, signed in, and came back to a closed sheet would reasonably
   * conclude publishing is broken. Reading it clears it, so a reload does not reopen the sheet.
   */
  useEffect(() => {
    if (takePendingPublish() === scapeId) setPublishOpen(true);
  }, [scapeId]);

  const commands = useRef<CanvasCommands | null>(null);
  const inspector = useRef<HTMLElement | null>(null);
  const composerInput = useRef<HTMLTextAreaElement | null>(null);
  const canvasArea = useRef<HTMLDivElement | null>(null);
  const { booted, readOnly, takingOver, takeOver } = useEditorSession(scapeId, commands);

  // Auto-collapse the outline when the window narrows past the breakpoint, so an 800px
  // window keeps a usable canvas. Widening does not reopen it: that is the person's call.
  useEffect(() => {
    const query = window.matchMedia?.(`(max-width: ${OUTLINE_COLLAPSE_BELOW - 1}px)`);
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setLeftPanelCollapsed(true);
    };
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

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
  useEffect(() => {
    generation.cancel();
  }, [appSettings.connection.provider, appSettings.connection.connectionId, generation.cancel]);
  const scapi = useScapi({
    getScape: () => useScapeStore.getState().scape,
    getSelection: () => useScapeStore.getState().selection,
    apiKey,
    modelId,
    connectionId: `${appSettings.connection.provider}:${appSettings.connection.connectionId ?? ""}`,
    scapeId,
  });
  const busy = generation.state.status === "streaming";
  const scapiMood = useScapiMood(scapi.turns, scapi.streaming, busy);
  const starter = starterFor(scape);

  /**
   * What this generation may create. A starter steers, it never locks: an explicit pick in the
   * composer wins outright, and the starter's focus applies only when nothing is picked.
   */
  const allowedTypes = useMemo(
    () => (types.length > 0 ? types : starter.types),
    [starter.types, types],
  );

  /** Creation, Enter, and double-click focus block content, not shared tag controls. */
  const focusInspector = useCallback((id: ObjectId) => {
    setRightPanelCollapsed(false);
    setScapiOpen(false);
    window.requestAnimationFrame(() => {
      // Selection may have changed while the inspector was opening. An older request
      // must not steal focus into another block's fields.
      if (useScapeStore.getState().selection[0] !== id) return;
      inspector.current
        ?.querySelector<HTMLElement>(
          "[data-block-inspector] input:enabled, [data-block-inspector] textarea:enabled",
        )
        ?.focus();
    });
  }, []);
  const openHelp = useCallback(() => setShortcutsOpen(true), []);

  // Whatever the home page set up: a brief to run, or a starter's seed object to place. Taken
  // once, so a refresh neither re-runs a generation the user has paid for nor re-seeds a
  // canvas they deliberately emptied.
  useEffect(() => {
    if (!booted || !ready) return;
    const intent = takeEditorIntent(scapeId);
    if (intent === "publish") setPublishOpen(true);
    if (intent === "scapi") setScapiOpen(true);
    if (intent === "agent") setSettingsSection("agent");
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

  useEditorShortcuts({
    openCommands: () => setCommandOpen(true),
    toggleScapi: () => setScapiOpen((open) => !open),
    togglePanels: () => {
      const collapse = !(leftPanelCollapsed && rightPanelCollapsed);
      setLeftPanelCollapsed(collapse);
      setRightPanelCollapsed(collapse);
    },
    openHelp: () => setShortcutsOpen(true),
    scapiOpen,
    closeScapi: () => setScapiOpen(false),
    readOnly,
    busy,
  });

  /**
   * The one place an edit can be attempted while another tab holds the scape. The canvas and
   * the inspector are already inert by then; this covers the paths that are not — the
   * composer, the quick actions and the title field.
   */
  const requireLease = () => {
    if (!readOnly) return true;
    notifyOnce(
      "info",
      "This scape is open in another tab",
      "Choose “Edit here” to move editing to it.",
    );
    return false;
  };

  const requireKey = () => {
    if (appSettings.aiReady) return true;
    notifyOnce("danger", "Connect AI", "Finish connecting in Settings → AI, then send your draft.");
    openAiSettings();
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
  const handleSend = async (
    request: string,
    origin: "canvas" | "panel" = "canvas",
    /** A routed send's choices, or a Deepen pass's. Absent means the controls' own state. */
    route?: Partial<Pick<SendRoute, "scope" | "types" | "modelId" | "deep" | "spoken">>,
  ) => {
    if (busy || scapi.streaming || !requireLease()) return;
    if (!requireKey()) return;
    setLastOrigin(origin);
    setScapiMode("edit");
    if (origin === "panel") setScapiOpen(true);
    const routedTypes = route?.types;
    await generation.start({
      request,
      apiKey: apiKey.trim(),
      modelId: route?.modelId ?? modelId,
      allowedTypes: routedTypes && routedTypes.length > 0 ? routedTypes : allowedTypes,
      scope: route?.scope ?? scope,
      globalInstructions: instructions,
      ...(route?.deep ? { deepSuggested: true } : {}),
      // Spoken requests carry what the previous run changed, so "it" can mean that.
      ...(route?.spoken
        ? { spoken: { ...route.spoken, lastChanged: generation.state.touched } }
        : {}),
    });
  };

  /** A question, from whichever composer asked it. One transcript underneath both. */
  const handleAsk = (
    question: string,
    origin: "canvas" | "panel" = "canvas",
    route?: Pick<SendRoute, "modelId" | "webSearch" | "scope" | "spoken">,
  ) => {
    if (busy || !requireLease() || !requireKey()) return;
    setLastOrigin(origin);
    setScapiMode("ask");
    void scapi.send(question, route);
  };

  const handleConnect = async (ids?: ObjectId[], routedModel?: string) => {
    // Same guard as a send: one AI run at a time, whichever surface started it.
    if (busy || scapi.streaming || !requireLease()) return;
    if (!requireKey()) return;
    await generation.connect(apiKey.trim(), routedModel ?? modelId, ids, instructions);
  };

  /** One entry point for both composers, so a routed send lands the same way from either. */
  const sendFromComposer = (text: string, origin: "canvas" | "panel", route?: SendRoute) => {
    if (!route) {
      if (scapiMode === "ask") handleAsk(text, origin);
      else void handleSend(text, origin);
      return;
    }
    if (route.intent === "ask") handleAsk(text, origin, route);
    else if (route.intent === "connect") {
      setScapiMode("edit");
      const ids = route.scope === "selection" ? useScapeStore.getState().selection : undefined;
      void handleConnect(ids, route.modelId);
    } else void handleSend(text, origin, route);
  };

  /**
   * Local commands from a short typed or dictated draft. Each one is something the editor can
   * already do by hand, through the same store and canvas calls, so undo and the edit lease
   * apply exactly as they do to a keyboard shortcut.
   */
  const runCommand = (command: LocalCommand) => {
    const store = useScapeStore.getState();
    switch (command.kind) {
      case "undo":
      case "redo":
        if (!requireLease()) return;
        if (command.kind === "undo") store.undo();
        else store.redo();
        return;
      case "focus":
        if (!command.target || !store.scape?.objects[command.target]) return;
        setSelectedEdgeId(null);
        store.setSelection([command.target]);
        commands.current?.focus(command.target);
        return;
      case "select-all":
        // Only what is on screen: a hidden type selected here would be deleted by the next
        // Delete without the person ever having seen it.
        if (store.scape) store.setSelection(visibleObjectIds(store.scape));
        return;
      case "fit":
        commands.current?.fit();
        return;
      case "connect":
        void handleConnect(store.selection);
        return;
    }
  };

  const routing: ComposerRouting = {
    enabled: routeChips,
    jevKey: jevRouting ? jevKey : "",
    jevOnly: jevRouting && jevOnly,
    getContext: () => {
      const { scape: current, selection: selected } = useScapeStore.getState();
      const objects = current
        ? current.objectOrder.flatMap((id) => {
            const object = current.objects[id];
            return object ? [{ id, type: object.type, title: object.title }] : [];
          })
        : [];
      return {
        selection: {
          count: selected.length,
          types: [...new Set(selected.map((id) => current?.objects[id]?.type ?? ""))].filter(
            Boolean,
          ),
        },
        objects,
      };
    },
    ...(readOnly ? {} : { onCommand: runCommand }),
  };

  /**
   * Make fast, then enhance: a second generation on the deep tier, scoped to what the first one
   * created or rewrote. Its own transaction, so undo removes the refinement and keeps the draft.
   */
  const deepen = () => {
    const current = useScapeStore.getState().scape;
    const ids = generation.state.touched.filter((id) => current?.objects[id]);
    if (ids.length === 0) return;
    useScapeStore.getState().setSelection(ids);
    void handleSend(
      ids.length > 1
        ? "Deepen the selected objects you just created. Add the detail, edge cases and structure they are missing, sharpen their wording, and connect what you add."
        : "Deepen the selected object you just created. Add the detail, edge cases and structure it is missing, sharpen its wording, and connect what you add.",
      lastOrigin,
      { scope: "selection", modelId: modelForTier("deep", modelId) },
    );
  };
  // ChatGPT has no deeper model to move to, so Deepen would rerun the same model.
  const canDeepen =
    !readOnly &&
    generation.state.touched.length > 0 &&
    tierOf(generation.state.model) !== "deep" &&
    !generation.state.model.startsWith("chatgpt/");

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
    const scape = useScapeStore.getState().scape;
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

  /** Select one object and fly to it. Shared by the outline, answers and the inspector. */
  const selectFromOutline = useCallback((id: ObjectId) => {
    setSelectedEdgeId(null);
    useScapeStore.getState().setSelection([id]);
    commands.current?.focus(id);
  }, []);

  const selectMany = useCallback((ids: ObjectId[]) => {
    setSelectedEdgeId(null);
    useScapeStore.getState().setSelection(ids);
    if (ids[0]) commands.current?.focus(ids[0]);
  }, []);

  /**
   * The canvas hands over its commands once it mounts. On the first hand-over for a scape,
   * a viewport saved in a bigger window can leave every block off-screen; fit instead.
   */
  const fittedFor = useRef<string | null>(null);
  const onCanvasReady = useCallback(
    (ready: CanvasCommands) => {
      commands.current = ready;
      if (fittedFor.current === scapeId) return;
      fittedFor.current = scapeId;
      const current = useScapeStore.getState().scape;
      const area = canvasArea.current?.getBoundingClientRect();
      if (!current || !area) return;
      if (!viewportShowsContent(current, current.viewState, area.width, area.height)) {
        window.requestAnimationFrame(() => commands.current?.fit());
      }
    },
    [scapeId],
  );

  const scapiSuggestions = useMemo(
    () => (scape ? suggestScapiQuestions(scape) : []),
    // Suggestions read objects and relationships only; panning must not recompute them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scape?.objects, scape?.objectOrder, scape?.relationships],
  );

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
  // The Mac app is one window, so "move editing to this tab" has nowhere to point.
  const editCommands: CommandItem[] = readOnly
    ? isDesktop()
      ? []
      : [{ id: "take-over", label: "Edit here", hint: "Move editing to this tab", run: takeOver }]
    : [
        // Registry-driven, so a new object type reaches the palette by existing rather than by
        // being remembered here.
        ...allPlugins().map((candidate) => ({
          id: `add-${candidate.type}`,
          label: `Add ${candidate.label.toLowerCase()}`,
          hint: "Create at canvas centre",
          ...(BLOCK_SHORTCUTS[candidate.type] ? { shortcut: BLOCK_SHORTCUTS[candidate.type] } : {}),
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

  /**
   * One prop set for both composers. They differ only in where a send is attributed, the
   * panel's extra "not connected" gate, and which one owns the focus ref.
   */
  const composerProps = (origin: "canvas" | "panel"): ComponentProps<typeof Composer> => {
    const gated = origin === "panel" && !appSettings.aiReady;
    return {
      instructions: scape?.instructions?.body ?? "",
      onInstructionsChange: setScapeInstructions,
      globalInstructions: instructions,
      onEditGlobalInstructions: openAiSettings,
      controls: { instructions: true },
      value: draft,
      onValueChange: setDraft,
      onSend: (text, route) => sendFromComposer(text, origin, route),
      routing,
      liveBusy: busy || scapi.streaming,
      liveFailed: generation.state.status === "error" || scapi.turns.at(-1)?.status === "error",
      sendLabel: scapiMode === "ask" ? "Ask" : "Edit",
      onCancel: scapiMode === "ask" ? scapi.cancel : generation.cancel,
      busy: scapiMode === "ask" ? scapi.streaming : busy,
      disabled: readOnly || gated || (scapiMode === "ask" ? busy : scapi.streaming),
      mode: scapiMode,
      onModeChange: setScapiMode,
      webSearch: scapi.webSearch,
      onWebSearchChange: scapi.setWebSearch,
      webSearchUnavailable: scapi.searchAvailability === "unavailable",
      modelId,
      models: appSettings.models,
      onModelChange: setModelId,
      scope,
      onScopeChange: setScope,
      types,
      onTypesChange: setTypes,
      selectionCount: selection.length,
      ...(origin === "canvas" ? { inputRef: composerInput } : {}),
      placeholder: gated ? "Connect AI in Settings → AI to ask." : composerPlaceholder,
    };
  };

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
      />

      <div className="flex min-h-0 flex-1">
        <div
          className="relative h-full shrink-0 transition-[width] duration-fast ease-out"
          style={{
            width: leftPanelCollapsed ? "var(--panel-rail)" : `min(${leftPanelWidth}px, 78vw)`,
          }}
        >
          <div className="flex h-full">
            <Outline
              scape={scape}
              selection={selection}
              onSelect={selectFromOutline}
              onConnectLoose={(ids) => void handleConnect(ids)}
              onSelectMany={selectMany}
              busy={busy}
              readOnly={readOnly}
              isCollapsed={leftPanelCollapsed}
              onToggleCollapse={() => setLeftPanelCollapsed((open) => !open)}
            />
            {!leftPanelCollapsed && !readOnly && (
              <BlockNav onAdd={(type) => commands.current?.addObject(type)} />
            )}
          </div>
          {!leftPanelCollapsed && (
            <PanelResizer
              side="left"
              label="Resize outline"
              width={leftPanelWidth}
              onResize={setLeftPanelWidth}
            />
          )}
        </div>

        <div ref={canvasArea} className="relative min-w-0 flex-1">
          <Canvas
            onReady={onCanvasReady}
            onOpenInspector={focusInspector}
            onEdgeSelect={setSelectedEdgeId}
            onOpenHelp={openHelp}
            isGenerating={busy}
            colorMode={resolvedTheme}
            readOnly={readOnly}
          />

          {readOnly && !isDesktop() && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-composer flex justify-center px-4">
              <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-subtle bg-surface px-3 py-1.5 shadow-md">
                <span className="text-fg-secondary">Open in another tab</span>
                <button
                  type="button"
                  onClick={() => void takeOver()}
                  disabled={takingOver}
                  className={buttonClass({ variant: "secondary", size: "sm", shape: "pill" })}
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
            <div className="pointer-events-auto w-full max-w-[var(--composer-max)]">
              <Ribbon
                state={generation.state}
                onCancel={generation.cancel}
                onUndo={generation.undo}
                onDismiss={generation.dismiss}
                {...(canDeepen
                  ? {
                      onDeepen: deepen,
                      deepenLabel: "Deepen with Opus",
                    }
                  : {})}
              />
            </div>

            {canvasAnswer && (
              <div className="pointer-events-auto w-full max-w-[var(--composer-max)] rounded-2xl border border-subtle bg-surface p-3 shadow-md">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="mono flex items-center gap-1.5">
                    {/* The panel is closed while this shows, so this is Scapi's only live face. */}
                    <Scapi
                      size={24}
                      state={scapiMood.state}
                      reactionKey={scapiMood.reactionKey}
                      effects={false}
                    />
                    Scapi
                  </span>
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
                <div className="max-h-[28vh] overflow-auto text-fg">
                  {canvasAnswer.body ? (
                    <Suspense
                      fallback={<div className="whitespace-pre-wrap">{canvasAnswer.body}</div>}
                    >
                      <AnswerBody
                        body={canvasAnswer.body}
                        objects={scape.objects}
                        onObjectClick={selectFromOutline}
                      />
                    </Suspense>
                  ) : canvasAnswer.status === "error" ? (
                    <Suspense fallback={null}>
                      <AnswerError turn={canvasAnswer} />
                    </Suspense>
                  ) : scapi.streaming ? (
                    "…"
                  ) : null}
                </div>
              </div>
            )}

            {canvasComposerOpen ? (
              <div className="pointer-events-auto w-full max-w-[var(--composer-max)]">
                <Composer {...composerProps("canvas")} />
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
                ? "min(var(--panel-scapi-wide), 92vw)"
                : "min(var(--panel-scapi), 65vw)"
              : rightPanelCollapsed
                ? "var(--panel-rail)"
                : selectedEdge || (selectedObject && plugin)
                  ? `min(${rightPanelWidth}px, 78vw)`
                  : 0,
          }}
        >
          {scapiOpen ? (
            <aside className="z-panel flex h-full w-full min-w-0 flex-col border-l border-subtle bg-surface">
              <div className="flex shrink-0 items-center justify-between border-b border-subtle px-4 py-2.5">
                <h2 className="flex items-center gap-2 text-sm font-[var(--weight-emph)] text-fg">
                  <Scapi size={28} animated={false} effects={false} />
                  Scapi
                </h2>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setScapiWide((wide) => !wide)}
                    aria-pressed={scapiWide}
                    className="text-xs text-fg-secondary transition-colors duration-instant ease-out hover:text-fg"
                  >
                    {scapiWide ? "Narrower panel" : "Wider panel"}
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
                    <Button
                      variant="primary"
                      disabled={busy || scapi.streaming || readOnly}
                      onClick={() => {
                        const request = proposedEdit;
                        if (!requireLease() || !requireKey()) return;
                        setProposedEdit(null);
                        void handleSend(request, "panel");
                      }}
                    >
                      Apply proposed edit
                    </Button>
                    <Button variant="ghost" onClick={() => setProposedEdit(null)}>
                      Cancel
                    </Button>
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
                    onObjectClick={selectFromOutline}
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
                    suggestions={scapiSuggestions}
                    mood={scapiMood}
                    disabled={!appSettings.aiReady || busy}
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
                                {...(canDeepen
                                  ? {
                                      onDeepen: deepen,
                                      deepenLabel: "Deepen with Opus",
                                    }
                                  : {})}
                              />
                            </div>
                          ),
                        })}
                    composer={
                      <div className="shrink-0 border-t border-subtle p-3">
                        <Composer {...composerProps("panel")} />
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
                // Escape in a field hands the keyboard back to the canvas, so the next N/J/W/S
                // creates a block instead of typing into the title.
                onKeyDown={(e) => {
                  if (e.key !== "Escape" || e.defaultPrevented) return;
                  const target = e.target as HTMLElement;
                  if (target.matches("input, textarea, select")) {
                    e.preventDefault();
                    target.blur();
                    document.querySelector<HTMLElement>("[data-canvas-surface]")?.focus();
                  }
                }}
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
                          key={selectedObject.id}
                          object={selectedObject}
                          dispatch={(payload: ActionPayload) => dispatchTx([payload])}
                          suggestions={tagSuggestions}
                        />
                        <div data-block-inspector className="contents">
                          {/* Keyed by block: a field's local draft must never commit to the
                              next block when the selection changes under it. */}
                          <plugin.Inspector
                            key={selectedObject.id}
                            object={selectedObject}
                            dispatch={(payload: ActionPayload) => dispatchTx([payload])}
                          />
                        </div>
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
            <PanelResizer
              side="right"
              label="Resize inspector"
              width={rightPanelWidth}
              onResize={setRightPanelWidth}
            />
          )}
        </div>
      </div>

      {settingsOpen && (
        <SettingsModal
          routingSettings={appSettings}
          initialSection={settingsSection ?? "general"}
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          credentials={credentials}
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
            if (isDesktop()) {
              await signOutDesktop();
              publication.refresh();
              return;
            }
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
            // The web agent host credential rides on this sign-in; the Mac keeps its own.
            if (!isDesktop()) void saveHostCredential(null);
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
      className={buttonClass({
        variant: "secondary",
        size: "sm",
        shape: "pill",
        className: "bg-surface shadow-sm",
      })}
    >
      {children}
    </button>
  );
}
