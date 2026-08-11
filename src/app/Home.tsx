import { useEffect, useState } from "react";
import { notify } from "@/core/notify";
import { useScapeStore } from "@/core/store";
import { SETTING_KEYS, type PublicationRecord, type ScapeSummary } from "@/core/types";
import { Composer } from "@/ai/Composer";
import { getStarter } from "@/starters";
import { downloadScape, importScape, ScapeImportError } from "@/persistence/portable";
import { scapeRepository } from "@/persistence/scapeRepository";
import { requestPersistence, warnIfStorageTight } from "@/persistence/storage";
import { settingsRepository } from "@/persistence/settings";
import { deletePublication, PublishClientError } from "@/publish/client";
import { readSession } from "@/publish/session";
import { ImportButton, ScapeList } from "./ScapeList";
import { setPendingWork } from "./pending";
import { navigate, scapeRoute } from "./router";
import { SettingsModal } from "./SettingsModal";
import { HelpPanel } from "./ProductivityOverlays";
import { Brand } from "./Brand";
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
  const [publications, setPublications] = useState<Map<string, PublicationRecord>>(new Map());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const { apiKey, setApiKey, modelId, setModelId, types, setTypes, ready } = useAppSettings();

  const starter = getStarter(starterId);

  const refresh = async () => {
    setScapes(await scapeRepository.list());
    const rows = await scapeRepository.publications.all();
    setPublications(new Map(rows.map((row) => [row.scapeId, row])));
  };

  /**
   * Deleting a scape has to take its public copy with it.
   *
   * A local delete that leaves a live URL is the worst outcome available here: the author
   * believes the thing is gone, and it is still being served to anyone holding the link. So the
   * server call goes first, and the local delete only proceeds if it succeeded — except when
   * the publication was already withdrawn, which leaves nothing public to strand.
   */
  const removeScape = async (id: string) => {
    const row = publications.get(id);

    if (row && row.status === "published") {
      const session = readSession();
      if (!session) {
        notify.error(
          "Sign in to delete this scape.",
          "It is published, and the public copy has to come down with it.",
        );
        return;
      }
      try {
        await deletePublication(row.publicationId, { token: session.token });
      } catch (error) {
        notify.error(
          "Could not unpublish this scape.",
          error instanceof PublishClientError ? error.message : "It has not been deleted.",
        );
        return;
      }
    }

    if (row) await scapeRepository.publications.remove(id);
    await scapeRepository.remove(id);
    await refresh();
    notify.success(row?.status === "published" ? "Unpublished and deleted." : "Deleted.");
  };

  useEffect(() => {
    // Landing on home means no scape is open. Clearing it here is what makes the browser's
    // back button out of the editor behave: the canvas does not linger in the store.
    useScapeStore.getState().loadScape(null);
    void settingsRepository.set(SETTING_KEYS.lastScapeId, null);
    void refresh();
    // Between sessions rather than mid-edit: being told storage is nearly full while you are
    // typing is both alarming and badly timed.
    void warnIfStorageTight();
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

    // The first scape is the moment the user has something worth not losing, and the moment a
    // storage prompt makes sense to them. Not awaited: nothing here should delay the canvas.
    void requestPersistence();

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
        <Brand />
        <div className="flex items-center gap-2">
          <ImportButton onFile={(file) => void onImport(file)} />
          <ThemeControl value={theme} onChange={setTheme} />
          <button
            type="button"
            aria-label="Open settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-md text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M6.38 2.2h3.24l.34 1.35c.38.14.73.34 1.05.6l1.32-.4 1.62 2.8-.98.96c.04.2.06.4.06.6s-.02.4-.06.6l.98.96-1.62 2.8-1.32-.4c-.32.26-.67.46-1.05.6l-.34 1.35H6.38l-.34-1.35a4.16 4.16 0 0 1-1.05-.6l-1.32.4-1.62-2.8.98-.96a4.1 4.1 0 0 1 0-1.2l-.98-.96 1.62-2.8 1.32.4c.32-.26.67-.46 1.05-.6l.34-1.35Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <circle cx="8" cy="8" r="2.05" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Open help"
            title="Help and keyboard shortcuts"
            onClick={() => setHelpOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-md text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.35" />
              <path
                d="M6.25 6.2a1.83 1.83 0 1 1 3.06 1.35c-.83.73-1.31 1.08-1.31 2.05"
                stroke="currentColor"
                strokeWidth="1.35"
                strokeLinecap="round"
              />
              <circle cx="8" cy="11.45" r=".7" fill="currentColor" />
            </svg>
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[920px] px-6 pb-24">
        <section className="animate-home-enter pb-2 pt-12 text-center motion-reduce:animate-none">
          <h1 className="font-pixel pb-3 text-3xl text-fg">What are we mapping?</h1>
          <p className="mx-auto max-w-[560px] text-fg-secondary">
            Describe the product idea, flow, or screen you want to map. We’ll give you an editable
            starting point.
          </p>
        </section>

        <section className="transition-[filter] duration-base ease-out focus-within:drop-shadow-sm">
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
            placeholder="Map the onboarding flow for a personal finance app…"
            // No selection to scope to, and the starter cards below already decide the types.
            controls={{ scope: false, types: false }}
          />
        </section>

        <div className="pt-6">
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
              ? "open the all-in-one canvas"
              : `start a blank ${starter.label.toLowerCase()}`}
          </button>{" "}
          and build it by hand.
        </p>

        <div className="pt-16">
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
            onDelete={(id) => void removeScape(id)}
            publications={publications}
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
          onOpenHelp={() => {
            setSettingsOpen(false);
            setHelpOpen(true);
          }}
        />
      )}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
