import type { LibraryPreferences } from "./library";
import { HOME_BUTTON } from "./CreationPanel";
export function LibraryControls({
  query,
  onQuery,
  preferences,
  onPreferences,
  count,
}: {
  query: string;
  onQuery: (value: string) => void;
  preferences: LibraryPreferences;
  onPreferences: (value: LibraryPreferences) => void;
  count: number;
}) {
  return (
    <div className="mb-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-pixel text-lg text-fg">
          Your scapes <span className="ml-2 text-sm text-fg-tertiary">{count}</span>
        </h2>
        <div className="flex gap-1" role="group" aria-label="Library view">
          {(["gallery", "list"] as const).map((view) => (
            <button
              key={view}
              className={`${HOME_BUTTON} ${preferences.view === view ? "bg-selected border-default text-fg" : ""}`}
              aria-pressed={preferences.view === view}
              onClick={() => onPreferences({ ...preferences, view })}
            >
              {view === "gallery" ? "Gallery" : "List"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter scapes" className="flex gap-1">
          {(["all", "pinned", "published"] as const).map((filter) => (
            <button
              key={filter}
              aria-pressed={preferences.filter === filter}
              onClick={() => onPreferences({ ...preferences, filter })}
              className={`${HOME_BUTTON} ${preferences.filter === filter ? "bg-selected border-default text-fg" : "border-transparent bg-transparent"}`}
            >
              {filter[0].toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
        <input
          aria-label="Search scapes"
          placeholder="Search scapes…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-subtle bg-surface px-3 py-2 text-sm sm:ml-auto sm:max-w-xs"
        />
        <select
          aria-label="Sort scapes"
          value={preferences.sort}
          onChange={(e) =>
            onPreferences({ ...preferences, sort: e.target.value as LibraryPreferences["sort"] })
          }
          className={HOME_BUTTON}
        >
          <option value="edited">Recently edited</option>
          <option value="name">Name</option>
        </select>
      </div>
    </div>
  );
}
