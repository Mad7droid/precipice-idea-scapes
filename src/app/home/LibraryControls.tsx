import type { RefObject } from "react";
import type { LibraryPreferences } from "./library";
import { GridIcon, ListIcon, SearchIcon } from "./icons";

const FILTERS: { id: LibraryPreferences["filter"]; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Every scape in this library" },
  { id: "pinned", label: "Pinned", hint: "Scapes you pinned to the top" },
  { id: "published", label: "Published", hint: "Scapes with a live read-only link" },
];

export function LibraryControls({
  query,
  onQuery,
  searchRef,
  preferences,
  onPreferences,
  counts,
}: {
  query: string;
  onQuery: (value: string) => void;
  searchRef?: RefObject<HTMLInputElement | null>;
  preferences: LibraryPreferences;
  onPreferences: (value: LibraryPreferences) => void;
  counts: Record<LibraryPreferences["filter"], number>;
}) {
  // A filter with nothing in it is a promise of content that is not there. Show one only once
  // it can return something — or while it is the active one, so it can always be switched off.
  const filters = FILTERS.filter(
    (f) => f.id === "all" || counts[f.id] > 0 || preferences.filter === f.id,
  );
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="text-lg font-medium text-fg">Scapes</h2>
        {filters.length === 1 && (
          <span className="text-sm text-fg-tertiary" aria-label={`${counts.all} scapes`}>
            {counts.all}
          </span>
        )}
      </div>
      {filters.length > 1 && (
        <div role="group" aria-label="Filter scapes" className="flex gap-1">
          {filters.map((filter) => {
            const active = preferences.filter === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                aria-pressed={active}
                title={filter.hint}
                onClick={() => onPreferences({ ...preferences, filter: filter.id })}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors duration-instant ease-out " +
                  (active
                    ? "bg-selected text-fg"
                    : "text-fg-secondary hover:bg-hover hover:text-fg")
                }
              >
                {filter.label}
                <span className={`text-xs ${active ? "text-fg-secondary" : "text-fg-tertiary"}`}>
                  {counts[filter.id]}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <label className="relative flex min-w-0 flex-1 items-center sm:w-64 sm:flex-none">
          <SearchIcon className="pointer-events-none absolute left-2.5 text-fg-tertiary" />
          <input
            ref={searchRef}
            type="search"
            aria-label="Search scapes"
            placeholder="Search by name"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                onQuery("");
              }
            }}
            className="w-full rounded-md border border-subtle bg-surface py-1.5 pl-8 pr-8 text-sm text-fg placeholder:text-fg-tertiary focus-self focus:border-focus"
          />
          {!query && (
            <kbd
              aria-hidden
              title="Press / to search"
              className="mono pointer-events-none absolute right-2 rounded-xs border border-subtle px-1 text-fg-tertiary"
            >
              /
            </kbd>
          )}
        </label>
        <select
          aria-label="Sort scapes"
          value={preferences.sort}
          onChange={(e) =>
            onPreferences({ ...preferences, sort: e.target.value as LibraryPreferences["sort"] })
          }
          className="rounded-md border border-subtle bg-surface px-2.5 py-1.5 text-sm text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover focus-self"
        >
          <option value="edited">Last edited</option>
          <option value="name">Name A–Z</option>
        </select>
        <div
          className="flex items-center gap-0.5 rounded-md border border-subtle bg-inset p-0.5"
          role="group"
          aria-label="Library view"
        >
          {(["gallery", "list"] as const).map((view) => {
            const active = preferences.view === view;
            const label = view === "gallery" ? "Gallery" : "List";
            return (
              <button
                key={view}
                type="button"
                aria-label={label}
                title={`${label} view`}
                aria-pressed={active}
                onClick={() => onPreferences({ ...preferences, view })}
                className={
                  "grid h-7 w-7 place-items-center rounded-sm transition-colors duration-instant ease-out " +
                  (active
                    ? "bg-raised text-fg shadow-sm"
                    : "text-fg-tertiary hover:text-fg-secondary")
                }
              >
                {view === "gallery" ? <GridIcon /> : <ListIcon />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
