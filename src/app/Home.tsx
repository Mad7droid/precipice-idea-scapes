import { downloadLibrary, importLibrary, MAX_LIBRARY_BYTES } from "@/persistence/libraryTransfer";
import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/core/notify";
import { allPlugins } from "@/core/registry";
import { useScapeStore } from "@/core/store";
import { SETTING_KEYS, type PublicationRecord, type ScapeSummary } from "@/core/types";
import { Button } from "@/design/Button";
import { getStarter } from "@/starters";
import { downloadScape, importScape } from "@/persistence/portable";
import { scapeRepository } from "@/persistence/scapeRepository";
import { requestPersistence, warnIfStorageTight } from "@/persistence/storage";
import { settingsRepository } from "@/persistence/settings";
import { deletePublication } from "@/publish/client";
import { publicPath } from "@/publish/contract";
import { publicationUrl } from "@/publish/url";
import { readSession } from "@/publish/session";
import { setEditorIntent, setPendingWork } from "./pending";
import { navigate, scapeRoute } from "./router";
import { SettingsModal, type SettingsSection } from "./SettingsModal";
import { HelpPanel, type HelpTopic } from "./ProductivityOverlays";
import { useAppSettings } from "./useAppSettings";
import { useTheme } from "./theme";
import { CreationPanel } from "./home/CreationPanel";
import { ImportButton } from "./home/ImportButton";
import { isDesktop } from "@/desktop/runtime";
import { MobileNav, Sidebar } from "./home/Sidebar";
import { TemplatesPage } from "./home/TemplatesPage";
import { PublishedPage } from "./home/PublishedPage";
import { AgentsPage } from "./home/AgentsPage";
import { InstructionsPage } from "./home/InstructionsPage";
import type { HomePage } from "./home/routes";
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

export function Home({ page = "home" }: { page?: HomePage }) {
  const [scapes, setScapes] = useState<ScapeSummary[]>([]);
  const [publications, setPublications] = useState<Map<string, PublicationRecord>>(new Map());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [pins, setPins] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [starterId, setStarterId] = useState("blank");
  const [draft, setDraft] = useState("");
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const prompt = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const desktop = isDesktop();
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

  // "/" jumps to search, as in most libraries — but never while typing or inside a dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable], [role='dialog']")) return;
      if (!search.current) return;
      event.preventDefault();
      search.current.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  const create = (request: string | null, chosen = starterId) => {
    if (request !== null && !apiKey.trim()) {
      setSettings("general");
      return;
    }
    void run("creation", async () => {
      const starter = getStarter(chosen);
      const line = request?.trim().split("\n")[0];
      const scape = await scapeRepository.create(
        line
          ? line.length > 60
            ? `${line.slice(0, 59)}…`
            : line
          : starter.id === "blank"
            ? "Untitled scape"
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
    if (kind === "publish") {
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
        window.open(publicationUrl(publicPath(row.publicationId)), "_blank", "noopener,noreferrer");
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
        await navigator.clipboard.writeText(publicationUrl(publicPath(row.publicationId)));
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
  const counts = {
    all: scapes.length,
    pinned: scapes.filter((s) => pins.has(s.id)).length,
    published: scapes.filter((s) => publications.get(s.id)?.status === "published").length,
  };
  const backUp = () =>
    void run("library-export", async () => {
      await downloadLibrary();
      notify.success(
        "Library backed up.",
        `${scapes.length} ${scapes.length === 1 ? "scape" : "scapes"} saved to one file. Import it anywhere to restore them as copies.`,
      );
    });
  const firstUse = status === "ready" && scapes.length === 0;
  const closeDialog = () => {
    if (dialog && !running.current.has(dialog.scape.id)) setDialog(null);
  };

  const newScape = () => {
    if (page !== "home") navigate("/");
    window.requestAnimationFrame(() => prompt.current?.focus());
  };
  const storage = desktop ? "Saved on this Mac" : "Saved in this browser";
  const libraryReady = ready && status !== "loading";

  return (
    <div className="flex h-full bg-base text-fg">
      <Sidebar
        page={page}
        publishedCount={counts.published}
        hasInstructions={!!instructions.trim()}
        onNewScape={newScape}
        onImport={() => fileInput.current?.click()}
        importDisabled={busy.has("creation")}
        onBackUp={backUp}
        backUpDisabled={status !== "ready" || !scapes.length || busy.has("library-export")}
        onSettings={() => setSettings("general")}
        onHelp={() => setHelp("how-to")}
        theme={theme}
        onTheme={setTheme}
        storage={storage}
      />
      <input
        ref={fileInput}
        type="file"
        // Unrestricted on purpose: WKWebView can disable custom extensions before validation.
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImport(file);
          e.target.value = "";
        }}
      />
      <div className="min-w-0 flex-1 overflow-auto">
        <MobileNav
          page={page}
          onNewScape={newScape}
          onImport={() => fileInput.current?.click()}
          onSettings={() => setSettings("general")}
          onHelp={() => setHelp("how-to")}
        />
        <main className="mx-auto w-full max-w-6xl px-5 pb-16 pt-10 sm:px-8">
          {!libraryReady ? (
            <div role="status" aria-label="Loading your library">
              <div className="mx-auto h-40 max-w-3xl animate-pulse rounded-2xl bg-surface motion-reduce:animate-none" />
              <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-60 animate-pulse rounded-xl bg-surface motion-reduce:animate-none"
                  />
                ))}
              </div>
            </div>
          ) : page === "templates" ? (
            <TemplatesPage
              busy={busy.has("creation")}
              onUse={(starter) => {
                setStarterId(starter.id);
                newScape();
              }}
              onStartEmpty={(starter) => {
                setStarterId(starter.id);
                create(null, starter.id);
              }}
            />
          ) : page === "published" ? (
            <PublishedPage
              scapes={scapes}
              publications={publications}
              busy={busy}
              onAction={action}
            />
          ) : page === "agents" ? (
            <AgentsPage desktop={desktop} />
          ) : page === "instructions" ? (
            <InstructionsPage
              value={instructions}
              onChange={setInstructions}
              where={desktop ? "in this Mac app" : "in this browser"}
            />
          ) : (
            <>
              <div className={firstUse ? "pt-6 sm:pt-12" : "pt-2"}>
                <CreationPanel
                  firstUse={firstUse}
                  starterId={starterId}
                  onStarterChange={setStarterId}
                  draft={draft}
                  onDraftChange={setDraft}
                  busy={busy.has("creation")}
                  onCreate={create}
                  onSettings={() => setSettings("general")}
                  inputRef={prompt}
                />
              </div>
              <section aria-label="Scape library" className={firstUse ? "mt-16" : "mt-14"}>
                {!firstUse && status !== "error" && (
                  <LibraryControls
                    query={query}
                    onQuery={setQuery}
                    searchRef={search}
                    preferences={preferences}
                    onPreferences={savePreferences}
                    counts={counts}
                  />
                )}
                {copied && (
                  <div
                    role="status"
                    className="mb-4 flex items-center gap-3 rounded-lg border border-subtle bg-surface py-2 pl-4 pr-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">Created “{copied.name}”.</span>
                    <Button variant="secondary" size="sm" onClick={() => open(copied.id)}>
                      Open copy
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Dismiss duplicate message"
                      onClick={() => setCopied(null)}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
                {status === "error" ? (
                  <div role="alert" className="rounded-xl border border-subtle p-8 text-center">
                    <p className="text-fg">Could not load your library.</p>
                    <p className="mt-1 text-sm text-fg-secondary">
                      Your scapes have not been changed. Try again, or reload the page.
                    </p>
                    <Button variant="secondary" className="mt-4" onClick={() => void refresh()}>
                      Retry
                    </Button>
                  </div>
                ) : firstUse ? (
                  <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed border-default px-5 py-4">
                    <div>
                      <h2 className="text-sm font-medium text-fg">Already have work?</h2>
                      <p className="mt-0.5 text-sm text-fg-secondary">
                        Import a .scape file or a library backup. Imports are added as copies.
                      </p>
                    </div>
                    <ImportButton
                      onFile={onImport}
                      disabled={busy.has("creation")}
                      variant="secondary"
                      label="Import file"
                    />
                  </div>
                ) : !visible.length ? (
                  <div className="rounded-xl border border-dashed border-default px-6 py-10 text-center">
                    <p className="text-fg">
                      {query.trim()
                        ? `No scapes named “${query.trim()}”${preferences.filter === "all" ? "" : ` in ${preferences.filter}`}.`
                        : `No ${preferences.filter} scapes yet.`}
                    </p>
                    <Button
                      variant="secondary"
                      className="mt-4"
                      onClick={() => {
                        setQuery("");
                        savePreferences({ ...preferences, filter: "all" });
                      }}
                    >
                      Clear filters
                    </Button>
                  </div>
                ) : (
                  <ul
                    className={
                      preferences.view === "gallery"
                        ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                        : "divide-y divide-subtle rounded-xl border border-subtle bg-surface"
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
              </section>
            </>
          )}
        </main>
      </div>
      {settings && (
        <SettingsModal
          initialSection={settings}
          onClose={() => setSettings(null)}
          theme={theme}
          credentials={credentials}
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          instructions={instructions}
          onInstructionsChange={setInstructions}
          onThemeChange={setTheme}
          onOpenHelp={() => {
            setSettings(null);
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
              <Button
                variant="secondary"
                data-initial-focus={dialog.kind === "delete" ? true : undefined}
                disabled={busy.has(dialog.scape.id)}
                onClick={closeDialog}
              >
                Cancel
              </Button>
              {/* The confirm carries the weight, as a fill: the delete in crimson, the rename
                  in the one action accent. Accent-coloured *text* on a bordered button read as
                  a link and lost to Cancel, which is the wrong way round in a dialog. */}
              <Button
                type="submit"
                variant={dialog.kind === "delete" ? "destructive" : "primary"}
                disabled={busy.has(dialog.scape.id) || (dialog.kind === "rename" && !name.trim())}
              >
                {busy.has(dialog.scape.id)
                  ? "Saving…"
                  : dialog.kind === "rename"
                    ? "Save name"
                    : publications.get(dialog.scape.id)?.status === "published"
                      ? "Unpublish and delete"
                      : "Delete scape"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
