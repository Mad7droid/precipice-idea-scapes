import { useRef, useState } from "react";
import type { ScapeSummary, ThemePreference } from "@/core/types";
import { notify } from "@/core/notify";
import { importScape, ScapeImportError } from "@/persistence/portable";
import { scapeRepository } from "@/persistence/scapeRepository";
import { ThemeControl } from "./ThemeControl";

export function Sidebar({
  scapes,
  activeId,
  onOpen,
  onNew,
  onDelete,
  onRename,
  onDuplicate,
  onImported,
  onExport,
  onOpenSettings,
  theme,
  onThemeChange,
}: {
  scapes: ScapeSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onImported: (id: string) => void;
  onExport: () => void;
  onOpenSettings: () => void;
  theme: ThemePreference;
  onThemeChange: (next: ThemePreference) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const startRename = (s: ScapeSummary) => {
    setRenamingId(s.id);
    setRenameValue(s.name);
  };

  const commitRename = () => {
    const id = renamingId;
    setRenamingId(null);
    if (!id) return;
    const trimmed = renameValue.trim();
    if (trimmed) onRename(id, trimmed);
  };

  const onImportFile = async (file: File) => {
    try {
      const imported = await importScape(await file.text(), scapeRepository);
      onImported(imported.id);
    } catch (error) {
      if (error instanceof ScapeImportError) notify.error("Could not import that file", error.message);
      else throw error;
    }
  };

  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-subtle bg-surface">
      <div className="flex items-center justify-between p-3">
        <span className="text-fg">Precipice</span>
        <button
          type="button"
          aria-label="Settings"
          onClick={onOpenSettings}
          className="grid h-7 w-7 place-items-center rounded-sm text-fg-tertiary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
        >
          ⚙
        </button>
      </div>

      <div className="flex gap-1.5 px-3 pb-2">
        <button
          type="button"
          onClick={onNew}
          className="flex-1 rounded-full bg-accent px-3 py-1.5 text-xs text-on-accent transition-colors duration-instant ease-out hover:bg-accent-hover"
        >
          New scape
        </button>
      </div>

      <div className="flex-1 overflow-auto px-2">
        {scapes.length === 0 ? (
          <p className="px-1.5 py-2 text-xs text-fg-tertiary">No scapes yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {scapes.map((s) => (
              <li key={s.id} className="group flex items-center gap-1">
                {renamingId === s.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="min-w-0 flex-1 rounded-sm border border-focus bg-raised px-2 py-1.5 text-fg outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpen(s.id)}
                    onDoubleClick={() => startRename(s)}
                    className={
                      "min-w-0 flex-1 rounded-sm px-2 py-1.5 text-left transition-colors duration-instant ease-out hover:bg-hover " +
                      (activeId === s.id ? "bg-selected" : "")
                    }
                  >
                    <span className="block truncate text-fg">{s.name}</span>
                    <span className="mono block text-fg-tertiary">
                      {s.objectCount} objects
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Rename ${s.name}`}
                  onClick={() => startRename(s)}
                  className="shrink-0 rounded-sm px-1.5 py-1 text-fg-tertiary opacity-0 transition-colors duration-instant ease-out hover:text-fg group-hover:opacity-100"
                >
                  ✎
                </button>
                <button
                  type="button"
                  aria-label={`Duplicate ${s.name}`}
                  onClick={() => onDuplicate(s.id)}
                  className="shrink-0 rounded-sm px-1.5 py-1 text-fg-tertiary opacity-0 transition-colors duration-instant ease-out hover:text-fg group-hover:opacity-100"
                >
                  ⧉
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${s.name}`}
                  onClick={() => onDelete(s.id)}
                  className="shrink-0 rounded-sm px-1.5 py-1 text-fg-tertiary opacity-0 transition-colors duration-instant ease-out hover:text-danger group-hover:opacity-100"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-subtle px-2 pt-2">
        <ThemeControl value={theme} onChange={onThemeChange} />
      </div>

      <div className="flex gap-1.5 p-2">
        <button
          type="button"
          onClick={onExport}
          disabled={!activeId}
          className="flex-1 rounded-full border border-subtle px-2.5 py-1 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          Export
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex-1 rounded-full border border-subtle px-2.5 py-1 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
        >
          Import
        </button>
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
    </aside>
  );
}
