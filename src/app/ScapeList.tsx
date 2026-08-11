import { useRef, useState } from "react";
import { getPlugin } from "@/core/registry";
import type { PublicationRecord, ScapeSummary } from "@/core/types";
import { getStarter } from "@/starters";
import { ScapeThumbnail } from "./ScapeThumbnail";

/**
 * Every scape you have, on the home page.
 *
 * This is the file browser that used to be welded to the left of the canvas. Moving it here is
 * what freed the editor's rail to become an outline of the document you actually have open.
 */
export function ScapeList({
  scapes,
  query,
  onQueryChange,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  publications,
  onExport,
}: {
  scapes: ScapeSummary[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  /** Publication rows by scape id. Absent on surfaces that have not loaded them. */
  publications?: Map<string, PublicationRecord>;
  onExport: (id: string) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const startRename = (scape: ScapeSummary) => {
    setRenamingId(scape.id);
    setRenameValue(scape.name);
  };

  const commitRename = () => {
    const id = renamingId;
    setRenamingId(null);
    if (!id) return;
    const trimmed = renameValue.trim();
    if (trimmed) onRename(id, trimmed);
  };

  const filtered = query.trim()
    ? scapes.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))
    : scapes;

  return (
    <section>
      <div className="flex items-center justify-between gap-3 border-b border-subtle pb-2">
        <h2 className="text-fg">Your scapes</h2>
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search"
          aria-label="Search scapes"
          className="w-48 rounded-full border border-subtle bg-surface px-3 py-1 text-fg placeholder:text-fg-tertiary focus-self focus:border-focus"
        />
      </div>

      {scapes.length === 0 ? (
        <p className="py-8 text-center text-fg-secondary">
          Nothing here yet. Describe something above to make your first scape.
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-fg-secondary">No scape matches “{query.trim()}”.</p>
      ) : (
        <ul>
          {filtered.map((scape) => (
            <li
              key={scape.id}
              className="group flex items-center gap-3 border-b border-subtle px-1 py-2 transition-colors duration-instant ease-out hover:bg-hover"
            >
              <ScapeThumbnail {...(scape.preview ? { preview: scape.preview } : {})} />

              {renamingId === scape.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  aria-label="Scape name"
                  className="min-w-0 flex-1 rounded-sm border border-focus bg-raised px-2 py-1 text-fg focus-self"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onOpen(scape.id)}
                  onDoubleClick={() => startRename(scape)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-fg">{scape.name}</span>
                  <Composition scape={scape} />
                </button>
              )}

              <PublicationBadge status={publications?.get(scape.id)?.status} />

              <span className="mono hidden shrink-0 sm:block">{relativeTime(scape.updatedAt)}</span>

              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-instant ease-out group-hover:opacity-100 focus-within:opacity-100">
                <RowButton label={`Rename ${scape.name}`} onClick={() => startRename(scape)}>
                  ✎
                </RowButton>
                <RowButton label={`Duplicate ${scape.name}`} onClick={() => onDuplicate(scape.id)}>
                  ⧉
                </RowButton>
                <RowButton label={`Export ${scape.name}`} onClick={() => onExport(scape.id)}>
                  ↓
                </RowButton>
                {/* Deleting a scape cannot be undone — the undo stack lives inside a document,
                    not above it — so it asks once, in place, rather than opening a dialog. */}
                {confirmingId === scape.id ? (
                  <button
                    type="button"
                    autoFocus
                    onClick={() => {
                      onDelete(scape.id);
                      setConfirmingId(null);
                    }}
                    onBlur={() => setConfirmingId(null)}
                    className="rounded-full bg-danger px-2 py-0.5 text-2xs text-on-accent"
                  >
                    {/* A published scape has a copy on a server that this delete has to take
                        with it. Saying so on the button is the only warning there is room for,
                        and there must be no path that leaves a live URL behind. */}
                    {publications?.get(scape.id)?.status === "published"
                      ? "Unpublish & delete?"
                      : "Delete?"}
                  </button>
                ) : (
                  <RowButton
                    label={`Delete ${scape.name}`}
                    danger
                    onClick={() => setConfirmingId(scape.id)}
                  >
                    ✕
                  </RowButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Whether this scape has a public copy, without hovering anything.
 *
 * Nothing is shown for a scape that was never published, which is most of them — a row of
 * "Private" badges would be noise that makes the real signal harder to see.
 */
function PublicationBadge({ status }: { status?: PublicationRecord["status"] }) {
  if (!status) return null;
  const published = status === "published";
  return (
    <span
      className="mono hidden shrink-0 items-center gap-1.5 sm:flex"
      title={published ? "Published to a public address" : "Unpublished — the address is reserved"}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${
          published ? "bg-[var(--success)]" : "bg-[var(--border-strong)]"
        }`}
      />
      {published ? "public" : "unpublished"}
    </span>
  );
}

/** What the scape is made of, in one line: the starter, then a count per object type. */
function Composition({ scape }: { scape: ScapeSummary }) {
  const parts = Object.entries(scape.typeCounts).sort(([a], [b]) => a.localeCompare(b));

  return (
    <span className="mt-0.5 flex items-center gap-2 text-xs text-fg-tertiary">
      {scape.starter && scape.starter !== "blank" && (
        <span className="text-fg-secondary">{getStarter(scape.starter).label}</span>
      )}
      {parts.length === 0 ? (
        <span>Empty</span>
      ) : (
        parts.map(([type, count]) => {
          const plugin = getPlugin(type);
          return (
            <span key={type} className="flex items-center gap-1">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: `var(${plugin?.color ?? "--border-strong"})` }}
              />
              {count}
            </span>
          );
        })
      )}
      {scape.relationshipCount > 0 && <span>{scape.relationshipCount} links</span>}
    </span>
  );
}

function RowButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={
        "rounded-sm px-1.5 py-1 text-fg-tertiary transition-colors duration-instant ease-out " +
        (danger ? "hover:text-danger" : "hover:text-fg")
      }
    >
      {children}
    </button>
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Recent times read as elapsed; older ones read as a date. Nobody counts back 40 days. */
export function relativeTime(ts: number, now = Date.now()): string {
  const delta = now - ts;
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A file input styled as a button. Import lives beside the list it adds to. */
export function ImportButton({ onFile }: { onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="rounded-full border border-subtle px-3 py-1 text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
      >
        Import
      </button>
      <input
        ref={input}
        type="file"
        accept=".scape,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </>
  );
}
