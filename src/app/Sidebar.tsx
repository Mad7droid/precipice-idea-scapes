import { useRef } from "react";
import type { ScapeSummary } from "@/core/types";
import { notify } from "@/core/notify";
import { importScape, ScapeImportError } from "@/persistence/portable";
import { scapeRepository } from "@/persistence/scapeRepository";

export function Sidebar({
  scapes,
  activeId,
  onOpen,
  onNew,
  onDelete,
  onImported,
  onExport,
  onOpenSettings,
}: {
  scapes: ScapeSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onImported: (id: string) => void;
  onExport: () => void;
  onOpenSettings: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);

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
                <button
                  type="button"
                  onClick={() => onOpen(s.id)}
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

      <div className="flex gap-1.5 border-t border-subtle p-2">
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
