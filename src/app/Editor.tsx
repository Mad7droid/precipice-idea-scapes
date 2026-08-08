import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionPayload } from "@/core/actions";
import { notify } from "@/core/notify";
import { getPlugin } from "@/core/registry";
import { useScapeStore } from "@/core/store";
import { SETTING_KEYS, type ObjectId, type RelationshipId } from "@/core/types";
import { Composer } from "@/ai/Composer";
import type { Scope } from "@/ai/prompt";
import { Ribbon } from "@/ai/Ribbon";
import { useGeneration } from "@/ai/useGeneration";
import { Canvas, type CanvasCommands } from "@/canvas/Canvas";
import { starterFor } from "@/starters";
import { startAutosave, type AutosaveHandle } from "@/persistence/autosave";
import { downloadScape } from "@/persistence/portable";
import { scapeRepository } from "@/persistence/scapeRepository";
import { settingsRepository } from "@/persistence/settings";
import { Outline } from "./Outline";
import { takePendingWork } from "./pending";
import { CommandPalette, HelpPanel, type CommandItem } from "./ProductivityOverlays";
import { RelationshipInspector } from "./RelationshipInspector";
import { navigate } from "./router";
import { SettingsModal } from "./SettingsModal";
import { TopBar } from "./TopBar";
import { useAppSettings } from "./useAppSettings";
import { useTheme } from "./theme";

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

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("scape");
  const [selectedEdgeId, setSelectedEdgeId] = useState<RelationshipId | null>(null);
  const [booted, setBooted] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(248);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [theme, setTheme, resolvedTheme] = useTheme();
  const { apiKey, setApiKey, modelId, setModelId, types, setTypes, ready } = useAppSettings();

  const autosave = useRef<AutosaveHandle | null>(null);
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
      const clamped = Math.max(220, Math.min(440, next));
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

  const generation = useGeneration({ requestLayout: () => commands.current?.relayout() });
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
    inspector.current?.querySelector<HTMLElement>("input, textarea")?.focus();
  };

  // Boot: start autosave, load the scape named in the route, then run whatever brief was
  // written on the home page.
  useEffect(() => {
    autosave.current = startAutosave(scapeRepository);
    let cancelled = false;

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
    };
  }, [scapeId]);

  // Whatever the home page set up: a brief to run, or a starter's seed object to place. Taken
  // once, so a refresh neither re-runs a generation the user has paid for nor re-seeds a
  // canvas they deliberately emptied.
  useEffect(() => {
    if (!booted || !ready) return;
    const pending = takePendingWork();
    if (!pending) return;
    if (pending.seed?.length) {
      dispatchTx(pending.seed);
      commands.current?.relayout();
    }
    if (pending.request) void handleSend(pending.request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, ready]);

  // A finished generation has left its compact action summary behind; reclaim the canvas for
  // the work itself while keeping the next prompt one click away.
  useEffect(() => {
    if (busy) setComposerCollapsed(false);
    else if (generation.state.status === "done") setComposerCollapsed(true);
  }, [busy, generation.state.status]);

  // A selected block is the thing the user is working on. Keep the full composer out of its
  // way; the compact actions still make the selection-aware AI path immediately available.
  // This only reacts when the selection changes, so choosing “Ask AI” keeps the composer open.
  useEffect(() => {
    if (selection.length > 0 && !busy) setComposerCollapsed(true);
  }, [selection.length, busy]);

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
      if (!meta || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) useScapeStore.getState().redo();
      else useScapeStore.getState().undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leftPanelCollapsed, rightPanelCollapsed]);

  const requireKey = () => {
    if (apiKey.trim()) return true;
    notify.error("No API key", "Add an Anthropic API key in settings, then try again.");
    setSettingsOpen(true);
    return false;
  };

  const handleSend = async (request: string) => {
    if (!requireKey()) return;
    await generation.start({ request, apiKey: apiKey.trim(), modelId, allowedTypes, scope });
  };

  const handleConnect = async (ids?: ObjectId[]) => {
    if (!requireKey()) return;
    await generation.connect(apiKey.trim(), modelId, ids);
  };

  const selectFromOutline = (id: ObjectId) => {
    setSelectedEdgeId(null);
    useScapeStore.getState().setSelection([id]);
    commands.current?.focus(id);
  };

  const focusComposer = () => {
    setComposerCollapsed(false);
    window.requestAnimationFrame(() => composerInput.current?.focus());
  };

  const selectedObject = selection.length === 1 && scape ? scape.objects[selection[0]] : undefined;
  const plugin = selectedObject ? getPlugin(selectedObject.type) : undefined;
  const selectedEdge = selectedEdgeId && scape ? scape.relationships[selectedEdgeId] : undefined;
  const commandItems: CommandItem[] = [
    ...(["note", "journey", "wireframe"] as const)
      .filter((type) => starter.types.length === 0 || starter.types.includes(type))
      .map((type) => ({
        id: `add-${type}`,
        label: `Add ${type}`,
        hint: "Create at canvas centre",
        shortcut: type === "note" ? "N" : type === "journey" ? "J" : "W",
        run: () => commands.current?.addObject(type),
      })),
    { id: "fit", label: "Fit canvas", shortcut: "⇧1", run: () => commands.current?.fit() },
    {
      id: "zoom-reset",
      label: "Reset zoom",
      shortcut: "0",
      run: () => commands.current?.resetZoom(),
    },
    { id: "tidy", label: "Tidy layout", run: () => commands.current?.relayout() },
    {
      id: "ask-ai",
      label: "Tell AI what to do",
      hint: "Open the composer",
      run: focusComposer,
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
        scape={scape}
        onBack={() => navigate("/")}
        onRename={(name) => dispatchTx([{ type: "RenameScape", name }])}
        onExport={() => downloadScape(scape)}
        onOpenSettings={() => setSettingsOpen(true)}
        theme={theme}
        onThemeChange={setTheme}
      />

      <div className="flex min-h-0 flex-1">
        <div
          className="relative h-full shrink-0 transition-[width] duration-fast ease-out"
          style={{ width: leftPanelCollapsed ? 32 : leftPanelWidth }}
        >
          <Outline
            scape={scape}
            selection={selection}
            onSelect={selectFromOutline}
            onAdd={(type) => commands.current?.addObject(type)}
            onConnectLoose={(ids) => void handleConnect(ids)}
            busy={busy}
            isCollapsed={leftPanelCollapsed}
            onToggleCollapse={() => setLeftPanelCollapsed((open) => !open)}
          />
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
          />

          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-composer flex flex-col items-center gap-2 px-4">
            <div className="pointer-events-auto w-full max-w-[720px]">
              <Ribbon
                state={generation.state}
                onCancel={generation.cancel}
                onUndo={generation.undo}
                onDismiss={generation.dismiss}
              />
            </div>

            {selection.length > 0 && !busy && composerCollapsed && (
              <div className="pointer-events-auto flex items-center gap-1.5">
                <QuickAction onClick={() => void handleConnect(selection)}>
                  {selection.length > 1 ? "Connect these" : "Connect this"}
                </QuickAction>
                <QuickAction
                  onClick={() =>
                    void handleSend(
                      selection.length > 1
                        ? "Expand on the selected objects. Add the detail they are missing and connect what you add."
                        : "Expand on the selected object. Add the detail it is missing and connect what you add.",
                    )
                  }
                >
                  Expand
                </QuickAction>
              </div>
            )}

            {composerCollapsed && !busy ? (
              <button
                type="button"
                onClick={focusComposer}
                aria-label="Open AI composer"
                className="pointer-events-auto flex w-[min(360px,calc(100vw-32px))] items-center gap-2 rounded-full border border-subtle bg-surface px-4 py-2 text-left text-sm text-fg-secondary shadow-md transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
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
                  {selection.length
                    ? "Tell AI what to do with this selection…"
                    : "Tell AI what to do in this scape…"}
                </span>
                <kbd className="mono shrink-0 normal-case tracking-normal">⌘K</kbd>
              </button>
            ) : (
              <div className="pointer-events-auto w-full max-w-[720px]">
                <Composer
                  onSend={(text) => void handleSend(text)}
                  onCancel={generation.cancel}
                  busy={busy}
                  modelId={modelId}
                  onModelChange={setModelId}
                  scope={scope}
                  onScopeChange={setScope}
                  types={types}
                  onTypesChange={setTypes}
                  availableTypes={starter.types}
                  selectionCount={selection.length}
                  placeholder={
                    selection.length
                      ? "Tell AI what to do with this selection…"
                      : starter.placeholder
                  }
                  inputRef={composerInput}
                />
              </div>
            )}
          </div>
        </div>

        <div
          className="relative h-full shrink-0 transition-[width] duration-fast ease-out"
          style={{
            width: rightPanelCollapsed
              ? 32
              : selectedEdge || (selectedObject && plugin)
                ? rightPanelWidth
                : 0,
          }}
        >
          {rightPanelCollapsed ? (
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
                  <RelationshipInspector
                    scape={scape}
                    relationship={selectedEdge}
                    onClose={() => setSelectedEdgeId(null)}
                    onFocusObject={selectFromOutline}
                  />
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
                      <plugin.Inspector
                        object={selectedObject}
                        dispatch={(payload: ActionPayload) => dispatchTx([payload])}
                      />
                    </>
                  )
                )}
              </aside>
            )
          )}
          {!rightPanelCollapsed && (selectedEdge || (selectedObject && plugin)) && (
            <button
              type="button"
              onClick={() => setRightPanelCollapsed(true)}
              aria-label="Collapse inspector"
              title="Collapse inspector (⌘/)"
              className="absolute right-1 top-2 z-panel grid h-6 w-6 place-items-center rounded-sm text-fg-tertiary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
            >
              ›
            </button>
          )}
          {!rightPanelCollapsed && (selectedEdge || (selectedObject && plugin)) && (
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
          onThemeChange={setTheme}
          onOpenHelp={() => {
            setSettingsOpen(false);
            setShortcutsOpen(true);
          }}
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
