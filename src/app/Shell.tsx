import { useEffect, useRef, useState } from "react";
import type { ActionPayload } from "@/core/actions";
import { getPlugin } from "@/core/registry";
import { useScapeStore } from "@/core/store";
import { SETTING_KEYS, type ScapeSummary } from "@/core/types";
import { notify } from "@/core/notify";
import { Composer, type Scope } from "@/ai/Composer";
import { Ribbon } from "@/ai/Ribbon";
import { DEFAULT_MODEL } from "@/ai/provider";
import { useGeneration } from "@/ai/useGeneration";
import { Canvas, type CanvasCommands } from "@/canvas/Canvas";
import { startAutosave, type AutosaveHandle } from "@/persistence/autosave";
import { downloadScape } from "@/persistence/portable";
import { scapeRepository } from "@/persistence/scapeRepository";
import { settingsRepository } from "@/persistence/settings";
import { Sidebar } from "./Sidebar";
import { SettingsModal } from "./SettingsModal";
import { useTheme } from "./theme";

/** First line of the brief, clipped — a readable label in the sidebar without asking the
 * user to name anything up front. */
function titleFromPrompt(prompt: string): string {
  const line = prompt.trim().split("\n")[0] ?? "";
  return line.length > 60 ? `${line.slice(0, 59)}…` : line || "Untitled scape";
}

/**
 * A browser-local preference, like the theme — how you want to be generated *for* is not
 * part of the Scape document and should not travel with an export.
 *
 * Not in `SETTING_KEYS` because `src/core` is frozen; flagged in NOTES.md to be folded in
 * the next time core opens.
 */
const GENERATE_TYPES_KEY = "ui.generateTypes";

export function Shell() {
  const scape = useScapeStore((s) => s.scape);
  const selection = useScapeStore((s) => s.selection);
  const dispatchTx = useScapeStore((s) => s.dispatchTx);

  const [scapes, setScapes] = useState<ScapeSummary[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState(DEFAULT_MODEL);
  const [scope, setScope] = useState<Scope>("scape");
  /** Which object types a generation may create. Empty means no constraint. */
  const [types, setTypes] = useState<string[]>([]);
  const [booted, setBooted] = useState(false);
  const [theme, setTheme, resolvedTheme] = useTheme();

  const autosave = useRef<AutosaveHandle | null>(null);
  const commands = useRef<CanvasCommands | null>(null);
  const inspector = useRef<HTMLElement | null>(null);

  /** Enter / double-click on a node land here — the inspector is already open via selection,
   * so the useful thing left to do is jump focus straight into its first editable field. */
  const focusInspector = () => {
    inspector.current?.querySelector<HTMLElement>("input, textarea")?.focus();
  };

  const generation = useGeneration({ requestLayout: () => commands.current?.relayout() });

  const refreshScapes = async () => setScapes(await scapeRepository.list());

  // Boot once: start autosave, restore whatever scape was open before the last refresh.
  useEffect(() => {
    autosave.current = startAutosave(scapeRepository);

    void (async () => {
      await refreshScapes();
      const lastId = await settingsRepository.get<string>(SETTING_KEYS.lastScapeId);
      if (lastId) {
        const restored = await scapeRepository.get(lastId);
        if (restored) useScapeStore.getState().loadScape(restored);
      }
      const savedModel = await settingsRepository.get<string>(SETTING_KEYS.model);
      if (savedModel) setModelId(savedModel);
      const savedApiKey = await settingsRepository.get<string>(SETTING_KEYS.apiKey);
      if (savedApiKey) setApiKey(savedApiKey);
      const savedTypes = await settingsRepository.get<string[]>(GENERATE_TYPES_KEY);
      if (Array.isArray(savedTypes)) setTypes(savedTypes);
      setBooted(true);
    })();

    return () => {
      autosave.current?.stop();
      autosave.current = null;
    };
  }, []);

  // Global Cmd+Z / Cmd+Shift+Z — not just canvas-scoped, since the inspector and sidebar sit
  // right next to it and a drag's undo shouldn't depend on which panel last had focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]")) {
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

  const openScape = async (id: string) => {
    const loaded = await scapeRepository.get(id);
    if (!loaded) return;
    useScapeStore.getState().loadScape(loaded);
    await settingsRepository.set(SETTING_KEYS.lastScapeId, id);
  };

  const newScape = () => {
    useScapeStore.getState().loadScape(null);
    void settingsRepository.set(SETTING_KEYS.lastScapeId, null);
  };

  const deleteScape = async (id: string) => {
    await scapeRepository.remove(id);
    if (scape?.id === id) newScape();
    await refreshScapes();
  };

  const renameScape = async (id: string, name: string) => {
    await scapeRepository.rename(id, name);
    if (scape?.id === id) useScapeStore.getState().loadScape({ ...scape, name });
    await refreshScapes();
    notify.success("Renamed.");
  };

  const duplicateScape = async (id: string) => {
    await scapeRepository.duplicate(id);
    await refreshScapes();
    notify.success("Duplicated.");
  };

  /** Shared by the empty-state prompt and the docked composer: creates a scape on first send. */
  const handleSend = async (request: string) => {
    let active = scape;
    if (!active) {
      active = await scapeRepository.create(titleFromPrompt(request));
      useScapeStore.getState().loadScape(active);
      await settingsRepository.set(SETTING_KEYS.lastScapeId, active.id);
      await refreshScapes();
    }

    await generation.start(request, apiKey.trim() || "proxy", modelId, types);
    await refreshScapes();
  };

  const handleTypesChange = (next: string[]) => {
    setTypes(next);
    void settingsRepository.set(GENERATE_TYPES_KEY, next);
  };

  const selectedObject =
    selection.length === 1 && scape ? scape.objects[selection[0]] : undefined;
  const plugin = selectedObject ? getPlugin(selectedObject.type) : undefined;

  if (!booted) return null;

  return (
    <div className="flex h-full bg-base">
      <Sidebar
        scapes={scapes}
        activeId={scape?.id ?? null}
        onOpen={(id) => void openScape(id)}
        onNew={newScape}
        onDelete={(id) => void deleteScape(id)}
        onRename={(id, name) => void renameScape(id, name)}
        onDuplicate={(id) => void duplicateScape(id)}
        onImported={(id) => void openScape(id).then(refreshScapes)}
        onExport={() => scape && downloadScape(scape)}
        onOpenSettings={() => setSettingsOpen(true)}
        theme={theme}
        onThemeChange={setTheme}
      />

      <div className="relative min-w-0 flex-1">
        {scape ? (
          <Canvas
            onReady={(c) => (commands.current = c)}
            onOpenInspector={focusInspector}
            isGenerating={generation.state.status === "streaming"}
            colorMode={resolvedTheme}
          />
        ) : (
          <EmptyState
            onSend={(text) => void handleSend(text)}
            busy={generation.state.status === "streaming"}
            types={types}
            onTypesChange={handleTypesChange}
          />
        )}

        {scape && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-composer flex flex-col items-center gap-2 px-4">
            <div className="pointer-events-auto w-full max-w-[720px]">
              <Ribbon
                state={generation.state}
                onCancel={generation.cancel}
                onUndo={generation.undo}
                onDismiss={generation.dismiss}
              />
            </div>
            <div className="pointer-events-auto w-full max-w-[720px]">
              <Composer
                onSend={(text) => void handleSend(text)}
                onCancel={generation.cancel}
                busy={generation.state.status === "streaming"}
                modelId={modelId}
                onModelChange={(id) => {
                  setModelId(id);
                  void settingsRepository.set(SETTING_KEYS.model, id);
                }}
                scope={scope}
                onScopeChange={setScope}
                types={types}
                onTypesChange={handleTypesChange}
                selectionCount={selection.length}
              />
            </div>
          </div>
        )}
      </div>

      {selectedObject && plugin && (
        <aside
          ref={inspector}
          className="z-panel w-[320px] shrink-0 overflow-auto border-l border-subtle bg-surface p-4"
        >
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
        </aside>
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          apiKey={apiKey}
          onApiKeyChange={(next) => {
            setApiKey(next);
            void settingsRepository.set(SETTING_KEYS.apiKey, next);
          }}
          onThemeChange={setTheme}
        />
      )}
    </div>
  );
}

function EmptyState({
  onSend,
  busy,
  types,
  onTypesChange,
}: {
  onSend: (text: string) => void;
  busy: boolean;
  types: string[];
  onTypesChange: (types: string[]) => void;
}) {
  const [scope, setScope] = useState<Scope>("scape");
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="w-full max-w-[720px] text-center">
        <h1 className="text-3xl text-fg">Precipice</h1>
        <p className="mt-2 text-fg-secondary">
          Describe what you want on the canvas, and watch it build itself.
        </p>
        <div className="mt-6 text-left">
          <Composer
            onSend={onSend}
            onCancel={() => {}}
            busy={busy}
            modelId={DEFAULT_MODEL}
            onModelChange={() => {}}
            scope={scope}
            onScopeChange={setScope}
            types={types}
            onTypesChange={onTypesChange}
            selectionCount={0}
            placeholder='Try: "Design an onboarding flow for a fintech app."'
          />
        </div>
      </div>
    </div>
  );
}
