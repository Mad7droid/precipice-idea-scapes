import { useEffect, useState } from "react";
import { notify } from "@/core/notify";
import { useScapeStore } from "@/core/store";
import { SETTING_KEYS, type ScapeSummary } from "@/core/types";
import { Composer } from "@/ai/Composer";
import { getStarter } from "@/starters";
import { downloadScape, importScape, ScapeImportError } from "@/persistence/portable";
import { scapeRepository } from "@/persistence/scapeRepository";
import { settingsRepository } from "@/persistence/settings";
import { ImportButton, ScapeList } from "./ScapeList";
import { setPendingWork } from "./pending";
import { navigate, scapeRoute } from "./router";
import { SettingsModal } from "./SettingsModal";
import { StarterPicker } from "./StarterPicker";
import { ThemeControl } from "./ThemeControl";
import { useAppSettings } from "./useAppSettings";
import { useTheme } from "./theme";

/** First line of the brief, clipped — a readable name without asking anyone to invent one. */
function titleFromPrompt(prompt: string): string {
  const line = prompt.trim().split("\n")[0] ?? "";
  return line.length > 60 ? `${line.slice(0, 59)}…` : line || "Untitled scape";
}

/**
 * The front door.
 *
 * One page: what do you want to make, what kind of thing is it, and everything you have made
 * before. The app used to open straight into an empty editor with a file list bolted to the
 * side, which is a workspace, not an arrival.
 *
 * Sending from here creates the scape and hands the brief to the editor through `pending`, so
 * the generation starts on a canvas rather than on this page.
 */
export function Home() {
  const [scapes, setScapes] = useState<ScapeSummary[]>([]);
  const [starterId, setStarterId] = useState("blank");
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const { apiKey, setApiKey, modelId, setModelId, types, setTypes, ready } = useAppSettings();

  const starter = getStarter(starterId);

  const refresh = async () => setScapes(await scapeRepository.list());

  useEffect(() => {
    // Landing on home means no scape is open. Clearing it here is what makes the browser's
    // back button out of the editor behave: the canvas does not linger in the store.
    useScapeStore.getState().loadScape(null);
    void settingsRepository.set(SETTING_KEYS.lastScapeId, null);
    void refresh();
  }, []);

  /**
   * Create, then navigate, then let the editor generate.
   *
   * The scape is created before the key is checked would be the wrong order — a missing key
   * would leave an empty scape behind every time — so the check comes first.
   */
  const create = async (request: string | null) => {
    if (request !== null && !apiKey.trim()) {
      notify.error("No API key", "Add an Anthropic API key in settings, then try again.");
      setSettingsOpen(true);
      return;
    }

    const name = request ? titleFromPrompt(request) : `Untitled ${starter.label.toLowerCase()}`;
    const scape = await scapeRepository.create(name, { starter: starter.id });

    // No brief means nobody is about to fill this canvas, so the starter seeds one root
    // object — an empty grid is a worse answer to "make me a mind map" than a single note.
    // Both are dispatched by the editor after it boots; see pending.ts for why.
    setPendingWork(request ? { request } : starter.seed ? { seed: starter.seed("") } : {});

    await settingsRepository.set(SETTING_KEYS.lastScapeId, scape.id);
    navigate(scapeRoute(scape.id));
  };

  const onImport = async (file: File) => {
    try {
      const imported = await importScape(await file.text(), scapeRepository);
      await refresh();
      navigate(scapeRoute(imported.id));
    } catch (error) {
      if (error instanceof ScapeImportError)
        notify.error("Could not import that file", error.message);
      else throw error;
    }
  };

  const onExport = async (id: string) => {
    const scape = await scapeRepository.get(id);
    if (scape) downloadScape(scape);
  };

  if (!ready) return null;

  return (
    <div className="h-full overflow-auto bg-base">
      <header className="flex items-center justify-between px-6 py-3">
        <span className="text-fg">Precipice</span>
        <div className="flex items-center gap-2">
          <ImportButton onFile={(file) => void onImport(file)} />
          <ThemeControl value={theme} onChange={setTheme} />
          <button
            type="button"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
            className="grid h-7 w-7 place-items-center rounded-sm text-fg-tertiary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
          >
            ⚙
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[860px] px-6 pb-24">
        <h1 className="pb-6 pt-12 text-center text-3xl text-fg">What are we mapping?</h1>

        <Composer
          onSend={(text) => void create(text)}
          onCancel={() => {}}
          busy={false}
          modelId={modelId}
          onModelChange={setModelId}
          scope="scape"
          onScopeChange={() => {}}
          types={types}
          onTypesChange={setTypes}
          availableTypes={starter.types}
          selectionCount={0}
          placeholder={starter.placeholder}
          // No selection to scope to, and the starter cards below already decide the types.
          controls={{ scope: false, types: false }}
        />

        <div className="pt-4">
          <StarterPicker value={starterId} onChange={setStarterId} />
        </div>

        <p className="pt-3 text-center text-xs text-fg-tertiary">
          Or{" "}
          <button
            type="button"
            onClick={() => void create(null)}
            className="text-fg-accent underline decoration-dotted underline-offset-2 hover:no-underline"
          >
            {starter.id === "blank"
              ? "open an empty canvas"
              : `start a blank ${starter.label.toLowerCase()}`}
          </button>{" "}
          and build it by hand.
        </p>

        <div className="pt-14">
          <ScapeList
            scapes={scapes}
            query={query}
            onQueryChange={setQuery}
            onOpen={(id) => navigate(scapeRoute(id))}
            onRename={(id, name) => void scapeRepository.rename(id, name).then(refresh)}
            onDuplicate={(id) =>
              void scapeRepository.duplicate(id).then(async () => {
                await refresh();
                notify.success("Duplicated.");
              })
            }
            onDelete={(id) =>
              void scapeRepository.remove(id).then(async () => {
                await refresh();
                notify.success("Deleted.");
              })
            }
            onExport={(id) => void onExport(id)}
          />
        </div>
      </main>

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
