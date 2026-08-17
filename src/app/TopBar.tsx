import { useEffect, useRef, useState } from "react";
import type { Scape, ThemePreference } from "@/core/types";
import { Menu, MenuItem } from "@/design/Menu";
import { starterFor } from "@/starters";
import { describeState, type PublicationState } from "@/publish/usePublication";
import { ThemeControl } from "./ThemeControl";
import { Brand } from "./Brand";

export type ExportFormat = "scape" | "pdf";

/**
 * The editor's chrome.
 *
 * Replaces the scape sidebar's header. What belongs at the top of a document is the way back
 * out of it, its name, and what kind of thing it is — not a list of every other document.
 */
export function TopBar({
  scape,
  onBack,
  onRename,
  onExport,
  exporting,
  onOpenSettings,
  onPublish,
  publicationState,
  theme,
  onThemeChange,
}: {
  scape: Scape;
  onBack: () => void;
  onRename: (name: string) => void;
  onExport: (format: ExportFormat) => void;
  /** A PDF of a large scape takes a beat, and a button that looks idle while it renders lies. */
  exporting?: boolean;
  onOpenSettings: () => void;
  onPublish?: () => void;
  /** Omitted on surfaces that have no publication context, such as the dev harnesses. */
  publicationState?: PublicationState;
  theme: ThemePreference;
  onThemeChange: (next: ThemePreference) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(scape.name);
  const starter = starterFor(scape);

  // The model renames an untitled scape during a generation, so the field has to follow the
  // document rather than own it.
  useEffect(() => setDraft(scape.name), [scape.name]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== scape.name) onRename(trimmed);
    else setDraft(scape.name);
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-subtle bg-surface px-3 sm:gap-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="All scapes"
        title="All scapes"
        className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M7.5 2.5 4 6l3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <Brand compact />
      </button>

      <span aria-hidden className="text-fg-tertiary">
        /
      </span>

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(scape.name);
              setEditing(false);
            }
          }}
          aria-label="Scape name"
          className="min-w-0 flex-1 rounded-sm border border-focus bg-raised px-2 py-0.5 text-fg focus-self"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Rename"
          className="min-w-0 max-w-[140px] truncate rounded-sm px-1.5 py-0.5 text-left text-fg transition-colors duration-instant ease-out hover:bg-hover sm:max-w-[420px]"
        >
          {scape.name}
        </button>
      )}

      {starter.id !== "blank" && (
        <span className="mono hidden shrink-0 rounded-full border border-subtle px-2 py-0.5 sm:inline-flex">
          {starter.label}
        </span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        {onPublish && <PublishControl state={publicationState} onClick={onPublish} />}
        <ExportMenu onExport={onExport} busy={exporting ?? false} />
        <ThemeControl value={theme} onChange={onThemeChange} />
        <button
          type="button"
          aria-label="Open settings"
          title="Settings"
          onClick={onOpenSettings}
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
      </div>
    </header>
  );
}

/**
 * Whether this scape is public, readable without hovering anything.
 *
 * Four states, each with its own dot colour and its own word. The user must never have to
 * guess whether something of theirs is visible to strangers, and "Update available" has to be
 * distinguishable from "Published" at a glance or the public copy silently rots.
 */
const PUBLICATION_DOT: Record<PublicationState["kind"], string> = {
  unpublished: "bg-[var(--border-strong)]",
  published: "bg-[var(--success)]",
  stale: "bg-[var(--accent)]",
  withdrawn: "bg-[var(--border-strong)]",
};

function PublishControl({ state, onClick }: { state?: PublicationState; onClick: () => void }) {
  const kind = state?.kind ?? "unpublished";
  const label = state ? describeState(state) : "Publish";

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex items-center gap-1.5 rounded-md border border-default px-2.5 py-1.5 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PUBLICATION_DOT[kind]}`} aria-hidden />
      <span className="hidden sm:inline">{kind === "unpublished" ? "Publish" : label}</span>
    </button>
  );
}

/**
 * Two ways out of a scape, and they are not interchangeable: one comes back into Precipice,
 * the other is for everyone else. The captions say which is which, because the file extension
 * is not something anyone should have to know.
 */
function ExportMenu({
  onExport,
  busy,
}: {
  onExport: (format: ExportFormat) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boundary = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = () => setOpen(false);
  const choose = (format: ExportFormat) => {
    close();
    onExport(format);
  };

  return (
    <div ref={boundary} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy}
        disabled={busy}
        onClick={() => setOpen((was) => !was)}
        className="flex items-center gap-1.5 rounded-full border border-subtle px-3 py-1 text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg disabled:opacity-60 disabled:hover:bg-transparent"
      >
        {busy ? "Exporting…" : "Export"}
        {!busy && (
          <svg width="8" height="5" viewBox="0 0 8 5" fill="none" aria-hidden>
            <path
              d="m1 1 3 3 3-3"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      <div className="absolute right-0 top-full z-popover mt-1">
        <Menu
          open={open}
          label="Export"
          boundaryRef={boundary}
          onClose={() => {
            close();
            trigger.current?.focus();
          }}
        >
          <MenuItem onSelect={() => choose("scape")} caption="Re-opens in Precipice">
            Scape file
          </MenuItem>
          <MenuItem onSelect={() => choose("pdf")} caption="Diagram and written outline">
            PDF
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
}
