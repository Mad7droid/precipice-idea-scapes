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
  const [theme, setTheme, resolvedTheme] = useTheme();
  const { apiKey, setApiKey, modelId, setModelId, types, setTypes, ready } = useAppSettings();

  const autosave = useRef<AutosaveHandle | null>(null);
  const commands = useRef<CanvasCommands | null>(null);
  const inspector = useRef<HTMLElement | null>(null);

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

  // Global Cmd+Z / Cmd+Shift+Z — not just canvas-scoped, since the inspector and outline sit
  // right next to it and a drag's undo shouldn't depend on which panel last had focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement | null)?.closest?.(
          "input, textarea, select, [contenteditable]",
        )
      ) {
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) useScapeStore.getState().redo();
      else useScapeStore.getState().undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  const selectedObject = selection.length === 1 && scape ? scape.objects[selection[0]] : undefined;
  const plugin = selectedObject ? getPlugin(selectedObject.type) : undefined;
  const selectedEdge = selectedEdgeId && scape ? scape.relationships[selectedEdgeId] : undefined;

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
        <Outline
          scape={scape}
          selection={selection}
          onSelect={selectFromOutline}
          onAdd={(type) => commands.current?.addObject(type)}
          onConnectLoose={(ids) => void handleConnect(ids)}
          busy={busy}
        />

        <div className="relative min-w-0 flex-1">
          <Canvas
            onReady={(c) => (commands.current = c)}
            onOpenInspector={focusInspector}
            onEdgeSelect={setSelectedEdgeId}
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

            {selection.length > 0 && !busy && (
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
                placeholder={starter.placeholder}
              />
            </div>
          </div>
        </div>

        {(selectedEdge || (selectedObject && plugin)) && (
          <aside
            ref={inspector}
            className="z-panel w-[320px] shrink-0 overflow-auto border-l border-subtle bg-surface p-4"
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
        )}
      </div>

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          onThemeChange={setTheme}
        />
      )}
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
