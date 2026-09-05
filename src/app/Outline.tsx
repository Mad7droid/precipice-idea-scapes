import { useMemo, useState } from "react";
import { markColor } from "@/core/marks";
import { allPlugins, getPlugin } from "@/core/registry";
import { useScapeStore } from "@/core/store";
import type { ObjectId, Scape } from "@/core/types";
import { scapeTags } from "./BlockMarkers";

/**
 * What is on this canvas, as a list.
 *
 * The rail used to hold a list of every scape you own — a file browser welded to a document.
 * That moved to the home page, which freed this space for something contextual to the thing
 * you actually have open.
 *
 * It is deliberately not a flat layers panel. Objects stay in one predictable type group, while
 * a compact status row calls out any unconnected blocks. Keeping an object in both a type group
 * and “Loose ends” made the rail look like two competing structures.
 */
export function Outline({
  scape,
  selection,
  onSelect,
  onConnectLoose,
  onSelectMany,
  busy,
  readOnly = false,
  isCollapsed = false,
  onToggleCollapse,
}: {
  scape: Scape;
  selection: ObjectId[];
  /** Selects the object and flies the camera to it. */
  onSelect: (id: ObjectId) => void;
  onConnectLoose: (ids: ObjectId[]) => void;
  /** Selects a whole tag's worth of blocks at once, so the canvas rings all of them. */
  onSelectMany?: (ids: ObjectId[]) => void;
  busy: boolean;
  /** Another tab holds the scape. Search, navigation and the counts stay; the edits go. */
  readOnly?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const dispatchTx = useScapeStore((s) => s.dispatchTx);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sectionCollapsed, setSectionCollapsed] = useState<Set<string>>(new Set());

  const tags = useMemo(() => scapeTags(scape.objects), [scape.objects]);
  // A filter pinned to a tag that has just been renamed away would silently hide everything.
  const activeTag =
    tagFilter && tags.some((t) => t.tag.toLowerCase() === tagFilter) ? tagFilter : null;

  const { groups, loose, degree } = useMemo(() => {
    const degree = new Map<ObjectId, number>();
    for (const id of scape.objectOrder) degree.set(id, 0);
    for (const rel of Object.values(scape.relationships)) {
      if (degree.has(rel.from)) degree.set(rel.from, degree.get(rel.from)! + 1);
      if (degree.has(rel.to)) degree.set(rel.to, degree.get(rel.to)! + 1);
    }

    const loose: ObjectId[] = [];
    const byType = new Map<string, ObjectId[]>();
    for (const id of scape.objectOrder) {
      const object = scape.objects[id];
      if (!object) continue;
      if (degree.get(id) === 0) loose.push(id);
      const list = byType.get(object.type) ?? [];
      list.push(id);
      byType.set(object.type, list);
    }

    // Registry order, so the sections do not reshuffle as objects come and go.
    const groups = allPlugins()
      .map((plugin) => ({ plugin, ids: byType.get(plugin.type) ?? [] }))
      .filter((group) => group.ids.length > 0);

    return { groups, loose, degree };
  }, [scape]);

  const queryText = query.trim().toLowerCase();
  const matches = (id: ObjectId) => {
    const object = scape.objects[id];
    if (!object) return false;
    if (activeTag && !(object.tags ?? []).some((tag) => tag.toLowerCase() === activeTag)) {
      return false;
    }
    if (!queryText) return true;
    // Tags are searchable too. Someone typing "risk" means the blocks about risk, whether the
    // word is in the title or on the label they attached to it.
    return (
      object.title.toLowerCase().includes(queryText) ||
      (object.tags ?? []).some((tag) => tag.toLowerCase().includes(queryText))
    );
  };

  const taggedIds = (tag: string) =>
    scape.objectOrder.filter((id) =>
      (scape.objects[id]?.tags ?? []).some((t) => t.toLowerCase() === tag),
    );
  const toggle = (section: string) =>
    setSectionCollapsed((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  return (
    <aside className="flex h-full min-w-0 flex-1 flex-col bg-surface">
      {isCollapsed ? (
        <div className="flex h-full flex-col items-center pt-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand outline"
            title="Expand outline (⌘/)"
            className="grid h-8 w-8 place-items-center rounded-sm text-fg-tertiary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
          >
            ›
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-auto px-2 py-2">
            <div className="mb-2 flex items-center justify-between px-1 pt-3">
              <p className="mono">On this scape</p>
              <span className="mono text-fg-tertiary">{scape.objectOrder.length}</span>
            </div>
            <label className="sr-only" htmlFor="outline-search">
              Search canvas
            </label>
            <input
              id="outline-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search canvas"
              className="focus-self mb-2 w-full rounded-sm border border-subtle bg-inset px-2 py-1 text-xs text-fg placeholder:text-fg-tertiary"
            />
            {tags.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-1">
                {tags.map(({ tag, count }) => {
                  const key = tag.toLowerCase();
                  const on = activeTag === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTagFilter(on ? null : key)}
                      className={
                        "rounded-full border px-2 py-0.5 text-xs transition-colors " +
                        "duration-instant ease-out " +
                        (on
                          ? "border-transparent bg-selected text-fg"
                          : "border-subtle text-fg-secondary hover:bg-hover hover:text-fg")
                      }
                    >
                      {tag} <span className="text-fg-tertiary">{count}</span>
                    </button>
                  );
                })}
                {activeTag && onSelectMany && (
                  <button
                    type="button"
                    onClick={() => onSelectMany(taggedIds(activeTag))}
                    className="rounded-full px-2 py-0.5 text-xs text-fg-tertiary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
                  >
                    Select on canvas
                  </button>
                )}
              </div>
            )}
            {scape.objectOrder.length === 0 ? (
              <p className="px-2 py-3 text-xs text-fg-tertiary">
                Nothing on the canvas yet. Add a block below, or describe what you want.
              </p>
            ) : (
              <>
                {loose.length > 0 && (
                  <div className="mb-3 rounded-md border border-subtle bg-inset p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-fg-secondary">
                        {loose.length} unconnected {loose.length === 1 ? "block" : "blocks"}
                      </span>
                      <button
                        type="button"
                        disabled={busy || readOnly || loose.length < 2}
                        onClick={() => onConnectLoose(loose)}
                        className="whitespace-nowrap rounded-sm px-1.5 py-1 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
                      >
                        Connect with AI
                      </button>
                    </div>
                    {loose.length === 1 && (
                      <p className="mt-1 text-xs text-fg-tertiary">
                        Add another block, then connect them.
                      </p>
                    )}
                  </div>
                )}
                {groups.map(({ plugin, ids }) => {
                  const visibleIds = ids.filter(matches);
                  if (visibleIds.length === 0) return null;
                  return (
                    <Section
                      key={plugin.type}
                      label={plugin.label}
                      count={visibleIds.length}
                      collapsed={sectionCollapsed.has(plugin.type)}
                      onToggle={() => toggle(plugin.type)}
                    >
                      {visibleIds.map((id) => (
                        <Row
                          key={id}
                          scape={scape}
                          id={id}
                          links={degree.get(id) ?? 0}
                          selected={selection.includes(id)}
                          onSelect={onSelect}
                          onDelete={
                            readOnly ? undefined : () => dispatchTx([{ type: "DeleteObject", id }])
                          }
                        />
                      ))}
                    </Section>
                  );
                })}
              </>
            )}
          </div>

          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse outline"
            title="Collapse outline (⌘/)"
            className="absolute left-[calc(100%-1px)] top-2 z-panel grid h-7 w-5 place-items-center rounded-r-sm border border-subtle bg-surface text-fg-tertiary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
          >
            ‹
          </button>
        </>
      )}
    </aside>
  );
}

function Section({
  label,
  count,
  collapsed,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="pb-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="mono flex w-full items-center justify-between rounded-sm px-2 py-1 text-left transition-colors duration-instant ease-out hover:bg-hover"
      >
        <span className="flex items-center gap-1.5">
          <DisclosureChevron collapsed={collapsed} />
          {label}
        </span>
        <span>{count}</span>
      </button>
      {!collapsed && children}
    </section>
  );
}

function DisclosureChevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden
      className={`shrink-0 text-fg-tertiary transition-transform duration-fast ease-out ${collapsed ? "-rotate-90" : ""}`}
    >
      <path
        d="m3.25 4.5 2.75 3 2.75-3"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Row({
  scape,
  id,
  links,
  selected,
  onSelect,
  onDelete,
}: {
  scape: Scape;
  id: ObjectId;
  links: number;
  selected: boolean;
  onSelect: (id: ObjectId) => void;
  /** Absent in a read-only tab, which removes the control rather than greying it out. */
  onDelete?: () => void;
}) {
  const object = scape.objects[id];
  if (!object) return null;
  const plugin = getPlugin(object.type);
  const accent = markColor(object.accent);

  return (
    <div
      className={
        "group flex items-center rounded-sm transition-colors duration-instant ease-out " +
        (selected ? "bg-selected" : "hover:bg-hover")
      }
    >
      <button
        type="button"
        onClick={() => onSelect(id)}
        className={
          "flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1 text-left " +
          "transition-colors duration-instant ease-out"
        }
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: `var(${plugin?.color ?? "--border-strong"})` }}
        />
        <span className="min-w-0 flex-1 truncate text-fg">{object.title || "Untitled"}</span>
        {/* The accent, on the far side of the title, so the type dot and the group dot are
            never mistaken for each other. */}
        {accent && (
          <span
            aria-hidden
            title={`Marked ${object.accent}`}
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: accent }}
          />
        )}
        {links > 0 && <span className="mono shrink-0">{links}</span>}
      </button>
      {onDelete && (
        <button
          type="button"
          aria-label={`Delete ${object.title || id}`}
          onClick={onDelete}
          className="mr-1 grid h-5 w-5 shrink-0 place-items-center rounded-sm p-0 text-fg-tertiary opacity-0 transition-colors duration-instant ease-out hover:bg-active hover:text-danger group-hover:opacity-100 focus:opacity-100"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="m3 3 6 6m0-6-6 6"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
