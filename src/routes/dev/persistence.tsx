import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@/app/router";
import { describeAction } from "@/core/actions";
import { fixtureScape } from "@/core/fixtures";
import { notify } from "@/core/notify";
import { useScapeStore } from "@/core/store";
import type { LoggedAction, ScapeSummary } from "@/core/types";
import { startAutosave, type AutosaveHandle } from "@/persistence/autosave";
import { downloadScape, importScape, ScapeImportError } from "@/persistence/portable";
import { scapeRepository } from "@/persistence/scapeRepository";

const LAST_SCAPE_KEY = "precipice.dev.lastScape";

/**
 * Workstream A's harness. The thing worth checking here is the one thing a user never sees:
 * that closing or refreshing the tab costs them nothing.
 */
export function DevPersistence() {
  const scape = useScapeStore((s) => s.scape);
  const dispatchTx = useScapeStore((s) => s.dispatchTx);

  const [scapes, setScapes] = useState<ScapeSummary[]>([]);
  const [log, setLog] = useState<LoggedAction[]>([]);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [writes, setWrites] = useState(0);
  const autosave = useRef<AutosaveHandle | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setScapes(await scapeRepository.list());
    const id = useScapeStore.getState().scape?.id;
    setLog(id ? await scapeRepository.getActionLog(id) : []);
  }, []);

  // Start autosave once, and reload whatever scape was open before the refresh.
  useEffect(() => {
    autosave.current = startAutosave(scapeRepository);

    const tick = setInterval(() => {
      setLastSavedAt(autosave.current?.lastSavedAt() ?? null);
      setWrites(autosave.current?.writes() ?? 0);
    }, 200);

    void (async () => {
      const previous = localStorage.getItem(LAST_SCAPE_KEY);
      if (previous) {
        const restored = await scapeRepository.get(previous);
        if (restored) useScapeStore.getState().loadScape(restored);
      }
      await refresh();
    })();

    return () => {
      clearInterval(tick);
      autosave.current?.stop();
      autosave.current = null;
    };
  }, [refresh]);

  // Re-read the scape list and log a moment after each write lands, so the sidebar counts
  // are the ones actually on disk rather than whatever they were at first paint.
  useEffect(() => {
    if (writes === 0) return;
    const timer = setTimeout(() => void refresh(), 60);
    return () => clearTimeout(timer);
  }, [writes, refresh]);

  const open = async (id: string) => {
    const loaded = await scapeRepository.get(id);
    if (!loaded) return;
    useScapeStore.getState().loadScape(loaded);
    localStorage.setItem(LAST_SCAPE_KEY, id);
    await refresh();
  };

  const seed = async () => {
    const created = await scapeRepository.create("Fintech onboarding");
    // The fixture carries a fixed 2025 timestamp so snapshots stay stable; a scape that was
    // seeded just now should not claim it was last touched a year ago.
    const now = Date.now();
    const seeded = {
      ...fixtureScape(),
      id: created.id,
      name: created.name,
      createdAt: now,
      updatedAt: now,
    };
    await scapeRepository.saveSnapshot(seeded, Date.now());
    await open(created.id);
    notify.success("Seeded the fixture scape.");
  };

  const remove = async (id: string) => {
    await scapeRepository.remove(id);
    if (useScapeStore.getState().scape?.id === id) {
      useScapeStore.getState().loadScape(null);
      localStorage.removeItem(LAST_SCAPE_KEY);
    }
    await refresh();
  };

  const onImportFile = async (file: File) => {
    try {
      const imported = await importScape(await file.text(), scapeRepository);
      await open(imported.id);
    } catch (error) {
      if (error instanceof ScapeImportError)
        notify.error("Could not import that file", error.message);
      else throw error;
    }
  };

  return (
    <div className="flex h-full bg-base">
      <div className="min-w-0 flex-1 overflow-auto p-6">
        <Link to="/dev" className="mono">
          ← dev
        </Link>
        <h1 className="mt-2 text-2xl text-fg">Persistence</h1>
        <p className="mt-1 text-fg-secondary">
          Seed the fixture, mutate it, watch the save land, then hard-refresh this page. The
          mutation should still be here.
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          <Command onClick={seed}>Seed fixture</Command>
          <Command
            onClick={() =>
              dispatchTx([
                {
                  type: "CreateObject",
                  id: `dev_${Date.now().toString(36)}`,
                  objectType: "note",
                  title: `Added at ${new Date().toLocaleTimeString()}`,
                  data: { body: "Created from the persistence harness." },
                },
              ])
            }
            disabled={!scape}
          >
            Mutate
          </Command>
          <Command
            onClick={() => {
              // Offset each burst so a second run is not 50 no-op moves to the same spot.
              const base = Math.round(Math.random() * 400);
              for (let i = 0; i < 50; i++) {
                dispatchTx([
                  { type: "MoveObject", id: scape!.objectOrder[0], x: base + i * 3, y: base + i },
                ]);
              }
            }}
            disabled={!scape?.objectOrder.length}
          >
            50 rapid mutations
          </Command>
          <Command onClick={() => autosave.current?.flush()} disabled={!scape}>
            Flush now
          </Command>
          <Command
            onClick={() =>
              scape &&
              downloadScape(
                scape,
                log.map((entry) => entry.action),
              )
            }
            disabled={!scape}
          >
            Export
          </Command>
          <Command onClick={() => fileInput.current?.click()}>Import</Command>
          <input
            ref={fileInput}
            type="file"
            accept=".scape,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImportFile(file);
              e.target.value = "";
            }}
          />
        </div>

        <dl className="mono mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>open</dt>
          <dd className="text-fg-secondary">{scape ? scape.id : "none"}</dd>
          <dt>objects</dt>
          <dd className="text-fg-secondary">{scape ? scape.objectOrder.length : 0}</dd>
          <dt>snapshot writes</dt>
          <dd className="text-fg-secondary">{writes}</dd>
          <dt>last saved</dt>
          <dd className="text-fg-secondary">
            {lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString() : "never"}
          </dd>
        </dl>

        <h2 className="mono mt-6">action log · {log.length}</h2>
        {log.length === 0 ? (
          <p className="mt-1 text-xs text-fg-tertiary">
            Nothing written yet. Seed a scape and mutate it.
          </p>
        ) : (
          <table className="mt-2 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-subtle text-left">
                <Th>ts</Th>
                <Th>txId</Th>
                <Th>action</Th>
                <Th>detail</Th>
              </tr>
            </thead>
            <tbody>
              {log
                .slice()
                .reverse()
                .map((entry, i) => (
                  <tr key={i} className="border-b border-subtle">
                    <Td mono>{new Date(entry.ts).toLocaleTimeString()}</Td>
                    <Td mono>{entry.txId}</Td>
                    <Td mono>{entry.action.type}</Td>
                    <Td>{describeAction(entry.action)}</Td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      <aside className="w-[300px] shrink-0 overflow-auto border-l border-subtle bg-surface p-4">
        <h2 className="mono mb-2">scapes · {scapes.length}</h2>
        {scapes.length === 0 ? (
          <p className="text-xs text-fg-tertiary">No scapes yet. Seed the fixture.</p>
        ) : (
          <ul className="space-y-1">
            {scapes.map((summary) => (
              <li key={summary.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void open(summary.id)}
                  className={
                    "min-w-0 flex-1 rounded-sm px-2 py-1.5 text-left transition-colors " +
                    "duration-instant ease-out hover:bg-hover " +
                    (scape?.id === summary.id ? "bg-selected" : "")
                  }
                >
                  <span className="block truncate text-fg">{summary.name}</span>
                  <span className="mono">
                    {summary.objectCount} objects ·{" "}
                    {new Date(summary.updatedAt).toLocaleTimeString()}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${summary.name}`}
                  onClick={() => void remove(summary.id)}
                  className="shrink-0 rounded-sm px-1.5 py-1 text-fg-tertiary transition-colors duration-instant ease-out hover:text-danger"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function Command({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-subtle px-2.5 py-1 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="mono py-1 pr-3 font-medium">{children}</th>
);

const Td = ({ children, mono }: { children: React.ReactNode; mono?: boolean }) => (
  <td
    className={`py-1 pr-3 align-top ${mono ? "mono normal-case tracking-normal" : "text-fg-secondary"}`}
  >
    {children}
  </td>
);
