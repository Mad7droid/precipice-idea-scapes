import { downloadLibrary, importLibrary, MAX_LIBRARY_BYTES } from "@/persistence/libraryTransfer";
import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/core/notify";
import { allPlugins } from "@/core/registry";
import { useScapeStore } from "@/core/store";
import { SETTING_KEYS, type PublicationRecord, type ScapeSummary } from "@/core/types";
import { getStarter } from "@/starters";
import { downloadScape, importScape } from "@/persistence/portable";
import { scapeRepository } from "@/persistence/scapeRepository";
import { requestPersistence, warnIfStorageTight } from "@/persistence/storage";
import { settingsRepository } from "@/persistence/settings";
import { deletePublication } from "@/publish/client";
import { publicPath } from "@/publish/contract";
import { readSession } from "@/publish/session";
import { ImportButton } from "./ScapeList";
import { setEditorIntent, setPendingWork } from "./pending";
import { navigate, scapeRoute } from "./router";
import { SettingsModal } from "./SettingsModal";
import { HelpPanel, type HelpTopic } from "./ProductivityOverlays";
import { Brand } from "./Brand";
import { ThemeControl } from "./ThemeControl";
import { useAppSettings } from "./useAppSettings";
import { useTheme } from "./theme";
import { CreationPanel, HOME_BUTTON } from "./home/CreationPanel";
import { LibraryControls } from "./home/LibraryControls";
import { ScapeCard, type CardAction } from "./home/ScapeCard";
import { Dialog } from "./home/Dialog";
import {
  DEFAULT_PREFERENCES,
  HOME_KEYS,
  readPreferences,
  selectScapes,
  withHomeLease,
  type LibraryPreferences,
} from "./home/library";

export function Home() {
  const [scapes, setScapes] = useState<ScapeSummary[]>([]);
  const [publications, setPublications] = useState<Map<string, PublicationRecord>>(new Map());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [pins, setPins] = useState<Set<string>>(new Set());
  const [exploreHidden, setExploreHidden] = useState(false);
  const [query, setQuery] = useState("");
  const [starterId, setStarterId] = useState("blank");
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [help, setHelp] = useState<HelpTopic | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const running = useRef(new Set<string>());
  const [dialog, setDialog] = useState<{ kind: "rename" | "delete"; scape: ScapeSummary } | null>(
    null,
  );
  const [name, setName] = useState("");
  const [copied, setCopied] = useState<{ id: string; name: string } | null>(null);
  const [theme, setTheme] = useTheme();
  const { credentials, apiKey, setApiKey, instructions, setInstructions, ready } = useAppSettings();
  const refreshId = useRef(0);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const ticket = ++refreshId.current;
    try {
      const [items, rows, settings] = await Promise.all([
        scapeRepository.list(),
        scapeRepository.publications.all(),
        settingsRepository.all(),
      ]);
      if (!mounted.current || ticket !== refreshId.current) return;
      setScapes(items);
      setPublications(new Map(rows.map((row) => [row.scapeId, row])));
      setPreferences(readPreferences(settings[HOME_KEYS.preferences]));
      setPins(
        new Set(items.filter((s) => settings[HOME_KEYS.pin + s.id] === true).map((s) => s.id)),
      );
      setExploreHidden(settings[HOME_KEYS.explore] === true);
      setStatus("ready");
    } catch (error) {
      if (!mounted.current || ticket !== refreshId.current) return;
      setStatus("error");
      notify.error(
        "Could not load your scapes",
        error instanceof Error ? error.message : String(error),
      );
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    useScapeStore.getState().loadScape(null);
    void settingsRepository
      .set(SETTING_KEYS.lastScapeId, null)
      .catch((error) => notify.error("Could not save home preference", String(error)));
    void refresh();
    void warnIfStorageTight();
    const focus = () => {
      if (!running.current.size) void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      ++refreshId.current;
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);

  const run = async (key: string, operation: () => Promise<void>) => {
    if (running.current.has(key)) return;
    running.current.add(key);
    setBusy(new Set(running.current));
    try {
      await operation();
    } catch (error) {
      notify.error(
        "Could not complete that action",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      running.current.delete(key);
      if (mounted.current) setBusy(new Set(running.current));
    }
  };
  const savePreferences = (next: LibraryPreferences) => {
    void run("preferences", async () => {
      await settingsRepository.set(HOME_KEYS.preferences, next);
      setPreferences(next);
    });
  };
  const open = (id: string) => navigate(scapeRoute(id));
  const requireScape = async (id: string) => {
    const scape = await scapeRepository.get(id);
    if (!scape)
      throw new Error(
        "This scape could not be found in browser storage. Refresh the library and try again.",
      );
    return scape;
  };
  const create = (request: string | null) => {
    if (request !== null && !apiKey.trim()) {
      setSettingsOpen(true);
      return;
    }
    void run("creation", async () => {
      const starter = getStarter(starterId);
      const line = request?.trim().split("\n")[0];
      const scape = await scapeRepository.create(
        line
          ? line.length > 60
            ? `${line.slice(0, 59)}…`
            : line
          : `Untitled ${starter.label.toLowerCase()}`,
        { starter: starter.id },
      );
      await requireScape(scape.id);
      await settingsRepository.set(SETTING_KEYS.lastScapeId, scape.id);
      setPendingWork(request ? { request } : starter.seed ? { seed: starter.seed("") } : {});
      void requestPersistence();
      open(scape.id);
    });
  };
  const onImport = (file: File) =>
    void run("creation", async () => {
      if (file.size > MAX_LIBRARY_BYTES)
        throw new Error("Import files must be smaller than 100 MB.");
      const text = await file.text();
      // The macOS WebView does not consistently honour custom file extensions in
      // a file-input accept filter. Recognise the envelope from its contents so
      // a renamed backup remains importable and validation stays authoritative.
      const isLibrary = (() => {
        try {
          const parsed: unknown = JSON.parse(text);
          return (
            typeof parsed === "object" &&
            parsed !== null &&
            (parsed as { format?: unknown }).format === "precipice-library"
          );
        } catch {
          return false;
        }
      })();
      if (isLibrary) {
        const count = await importLibrary(text);
        await refresh();
        void requestPersistence();
        notify.success("Library imported.", `${count} scapes added as new copies.`);
        return;
      }
      const scape = await importScape(text, scapeRepository);
      await requireScape(scape.id);
      void requestPersistence();
      open(scape.id);
    });
  const action = (scape: ScapeSummary, kind: CardAction) => {
    if (kind === "open") {
      open(scape.id);
      return;
    }
    if (kind === "publish" || kind === "scapi" || kind === "agent") {
      setEditorIntent(scape.id, kind);
      open(scape.id);
      return;
    }
    if (kind === "rename" || kind === "delete") {
      setName(scape.name);
      setDialog({ kind, scape });
      return;
    }
    if (kind === "public") {
      const row = publications.get(scape.id);
      if (row?.status === "published")
        window.open(publicPath(row.publicationId), "_blank", "noopener,noreferrer");
      return;
    }
    void run(scape.id, async () => {
      if (kind === "pin") {
        const next = !pins.has(scape.id);
        await settingsRepository.set(HOME_KEYS.pin + scape.id, next);
        setPins((old) => {
          const updated = new Set(old);
          if (next) updated.add(scape.id);
          else updated.delete(scape.id);
          return updated;
        });
      } else if (kind === "duplicate") {
        const copy = await scapeRepository.duplicate(scape.id);
        await requireScape(copy.id);
        const next: LibraryPreferences = { ...preferences, filter: "all", sort: "edited" };
        await settingsRepository.set(HOME_KEYS.preferences, next);
        setQuery("");
        await refresh();
        setCopied({ id: copy.id, name: copy.name });
      } else if (kind === "copy") {
        const row = publications.get(scape.id);
        if (!row || row.status !== "published")
          throw new Error("This scape has no published link.");
        await navigator.clipboard.writeText(
          new URL(publicPath(row.publicationId), location.origin).href,
        );
        notify.success("Public link copied.");
      } else {
        const document = await requireScape(scape.id);
        if (kind === "scape") downloadScape(document);
        if (kind === "pdf") {
          const { exportScapePdf } = await import("@/export/pdf");
          await exportScapePdf(document, { plugins: allPlugins() });
          notify.success("PDF exported.");
        }
      }
    });
  };
  const commitDialog = () => {
    if (!dialog) return;
    const { scape, kind } = dialog;
    void run(scape.id, async () => {
      await withHomeLease(scape.id, async () => {
        await requireScape(scape.id);
        if (kind === "rename") {
          const trimmed = name.trim();
          if (!trimmed) throw new Error("Enter a name for this scape.");
          await scapeRepository.rename(scape.id, trimmed);
          if ((await requireScape(scape.id)).name !== trimmed)
            throw new Error("The name was not saved. Try again.");
        } else {
          const row = await scapeRepository.publications.get(scape.id);
          if (row?.status === "published") {
            const session = readSession();
            if (!session)
              throw new Error(
                "Open this scape and sign in through Manage publication before deleting it. Its public copy must be removed first.",
              );
            await deletePublication(row.publicationId, { token: session.token });
          }
          await scapeRepository.remove(scape.id);
          await settingsRepository.set(HOME_KEYS.pin + scape.id, false);
        }
      });
      setDialog(null);
      await refresh();
      notify.success(kind === "rename" ? "Renamed." : "Deleted.");
    });
  };
  const visible = selectScapes(scapes, query, preferences, pins, publications);
  const firstUse = status === "ready" && scapes.length === 0;
  const closeDialog = () => {
    if (dialog && !running.current.has(dialog.scape.id)) setDialog(null);
  };

  return (
    <div className="h-full overflow-auto bg-base text-fg">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-5 py-3 sm:px-8">
        <Brand />
        <div className="flex flex-wrap items-center gap-2">
          <ImportButton onFile={onImport} disabled={busy.has("creation")} />
          <button
            className={HOME_BUTTON}
            disabled={status !== "ready" || !scapes.length || busy.has("library-export")}
            onClick={() =>
              void run("library-export", async () => {
                await downloadLibrary();
                notify.success(
                  "Library exported.",
                  "Import the file on another device to copy your scapes.",
                );
              })
            }
          >
            Export library
          </button>
          <ThemeControl value={theme} onChange={setTheme} />
          <button
            aria-label="Open settings"
            onClick={() => setSettingsOpen(true)}
            className={HOME_BUTTON}
          >
            Settings
          </button>
          <button aria-label="Open help" onClick={() => setHelp("how-to")} className={HOME_BUTTON}>
            Help
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-5 pb-16 pt-8 sm:px-8">
        <div className="mb-6">
          <h1 className="font-pixel text-2xl sm:text-3xl">
            {firstUse ? "Turn an idea into a working canvas" : "Your workspace"}
          </h1>
          <p className="mt-2 text-sm text-fg-secondary">
            {firstUse
              ? "Connect notes, journeys, screens, and documents. Start with a thought, then make it your own."
              : "Pick up where you left off, or give your next idea a place to grow."}
          </p>
        </div>
        {!ready || status === "loading" ? (
          <div
            role="status"
            className="rounded-xl border border-subtle bg-surface p-8 text-fg-secondary"
          >
            Loading your workspace…
          </div>
        ) : (
          <>
            <CreationPanel
              firstUse={firstUse}
              starterId={starterId}
              onStarterChange={setStarterId}
              draft={draft}
              onDraftChange={setDraft}
              busy={busy.has("creation")}
              onCreate={create}
              onSettings={() => setSettingsOpen(true)}
            />
            <section aria-label="Scape library" className="mt-8">
              <LibraryControls
                query={query}
                onQuery={setQuery}
                preferences={preferences}
                onPreferences={savePreferences}
                count={scapes.length}
              />
              {copied && (
                <div
                  role="status"
                  className="mb-4 flex items-center gap-3 rounded-md border border-subtle bg-surface p-3 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">Created “{copied.name}”.</span>
                  <button className={HOME_BUTTON} onClick={() => open(copied.id)}>
                    Open copy
                  </button>
                  <button
                    className={HOME_BUTTON}
                    aria-label="Dismiss duplicate message"
                    onClick={() => setCopied(null)}
                  >
                    Dismiss
                  </button>
                </div>
              )}
              {status === "error" ? (
                <div role="alert" className="rounded-xl border border-subtle p-8 text-center">
                  <p>Could not load your library.</p>
                  <button className={`${HOME_BUTTON} mt-3`} onClick={() => void refresh()}>
                    Retry
                  </button>
                </div>
              ) : firstUse ? (
                <div className="rounded-xl border border-dashed border-subtle px-6 py-10 text-center">
                  <h3 className="text-base">A home for your ideas</h3>
                  <p className="mt-2 text-sm text-fg-secondary">
                    Create your first scape above, or import a .scape file or library export to
                    continue existing work.
                  </p>
                  <div className="mt-4">
                    <ImportButton onFile={onImport} disabled={busy.has("creation")} />
                  </div>
                </div>
              ) : !visible.length ? (
                <div className="rounded-xl border border-subtle p-10 text-center">
                  <p>No scapes match these filters.</p>
                  <button
                    className={`${HOME_BUTTON} mt-3`}
                    onClick={() => {
                      setQuery("");
                      savePreferences({ ...preferences, filter: "all" });
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <ul
                  className={
                    preferences.view === "gallery"
                      ? "grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
                      : "space-y-3"
                  }
                >
                  {visible.map((scape) => (
                    <ScapeCard
                      key={scape.id}
                      scape={scape}
                      pinned={pins.has(scape.id)}
                      publication={publications.get(scape.id)}
                      list={preferences.view === "list"}
                      busy={busy.has(scape.id)}
                      onAction={(kind) => action(scape, kind)}
                    />
                  ))}
                </ul>
              )}
              <p className="mt-5 text-xs leading-5 text-fg-tertiary">
                Saved on this device. Export a scape file to back up your work or move it to another
                device.
              </p>
            </section>
            {!exploreHidden && (
              <section
                aria-label="Explore the workspace"
                className="mt-10 border-t border-subtle pt-5"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium">Explore the workspace</h2>
                  <button
                    className={HOME_BUTTON}
                    aria-label="Dismiss explore the workspace"
                    onClick={() =>
                      void run("explore", async () => {
                        await settingsRepository.set(HOME_KEYS.explore, true);
                        setExploreHidden(true);
                      })
                    }
                  >
                    Dismiss
                  </button>
                </div>
                <div className="mt-4 grid gap-5 sm:grid-cols-3">
                  {(
                    [
                      [
                        "scapi",
                        "Think it through with Scapi",
                        "Ask questions about your canvas and explore what to do next.",
                      ],
                      [
                        "agent",
                        "Bring your agent",
                        "Connect a local agent to an open scape and review its proposed changes.",
                      ],
                      [
                        "publishing",
                        "Share a snapshot",
                        "Publish a read-only version for others to explore. Publishing is invite-only.",
                      ],
                    ] as const
                  ).map(([topic, title, body]) => (
                    <button
                      key={topic}
                      className="rounded-md p-2 text-left transition-colors duration-instant hover:bg-hover active:bg-selected"
                      onClick={() => setHelp(topic)}
                    >
                      <h3 className="text-sm">
                        {title} <span aria-hidden>↗</span>
                      </h3>
                      <p className="mt-2 text-xs leading-5 text-fg-tertiary">{body}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
      {settingsOpen && (
        <SettingsModal
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
            setHelp("how-to");
          }}
        />
      )}
      {help && <HelpPanel initialSection={help} onClose={() => setHelp(null)} />}
      {dialog && (
        <Dialog
          title={`${dialog.kind === "rename" ? "Rename" : "Delete"} “${dialog.scape.name}”`}
          onClose={closeDialog}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              commitDialog();
            }}
          >
            {dialog.kind === "rename" ? (
              <input
                data-initial-focus
                aria-label="Scape name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-5 w-full rounded-md border border-subtle bg-inset px-3 py-2"
              />
            ) : (
              <p className="mt-4 text-sm text-fg-secondary">
                {publications.get(dialog.scape.id)?.status === "published"
                  ? "This removes the public snapshot and permanently deletes the scape from this browser."
                  : "This permanently deletes the scape from this browser."}{" "}
                Export a copy first if you want to keep it.
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                data-initial-focus={dialog.kind === "delete" ? true : undefined}
                disabled={busy.has(dialog.scape.id)}
                onClick={closeDialog}
                className={HOME_BUTTON}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy.has(dialog.scape.id) || (dialog.kind === "rename" && !name.trim())}
                className={`${HOME_BUTTON} ${dialog.kind === "delete" ? "text-danger" : "text-fg-accent"}`}
              >
                {busy.has(dialog.scape.id)
                  ? "Saving…"
                  : dialog.kind === "rename"
                    ? "Save name"
                    : publications.get(dialog.scape.id)?.status === "published"
                      ? "Unpublish and delete"
                      : "Delete scape"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
