import { useMemo } from "react";
import { allPlugins, getPlugin } from "@/core/registry";
import { useScapeStore } from "@/core/store";
import type { ObjectId, Scape } from "@/core/types";
import { starterFor } from "@/starters";

/**
 * What is on this canvas, as a list.
 *
 * The rail used to hold a list of every scape you own — a file browser welded to a document.
 * That moved to the home page, which freed this space for something contextual to the thing
 * you actually have open.
 *
 * It is deliberately not a flat layers panel. Objects are grouped by type, and everything with
 * no relationships at all is pulled out into "Loose ends" at the bottom, with the AI connect
 * action sitting right there. That section is the honest measure of whether a generation
 * finished its job, and it puts the fix where the problem is visible.
 */
export function Outline({
  scape,
  selection,
  onSelect,
  onAdd,
  onConnectLoose,
  busy,
}: {
  scape: Scape;
  selection: ObjectId[];
  /** Selects the object and flies the camera to it. */
  onSelect: (id: ObjectId) => void;
  onAdd: (objectType: string) => void;
  onConnectLoose: (ids: ObjectId[]) => void;
  busy: boolean;
}) {
  const dispatchTx = useScapeStore((s) => s.dispatchTx);
  const starter = starterFor(scape);

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
      if (degree.get(id) === 0) {
        loose.push(id);
        continue;
      }
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

  const addable = starter.types.length > 0 ? starter.types : allPlugins().map((p) => p.type);

  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-subtle bg-surface">
      <div className="flex-1 overflow-auto px-2 py-2">
        {scape.objectOrder.length === 0 ? (
          <p className="px-2 py-3 text-xs text-fg-tertiary">
            Nothing on the canvas yet. Add a block below, or describe what you want.
          </p>
        ) : (
          <>
            {groups.map(({ plugin, ids }) => (
              <Section key={plugin.type} label={plugin.label} count={ids.length}>
                {ids.map((id) => (
                  <Row
                    key={id}
                    scape={scape}
                    id={id}
                    links={degree.get(id) ?? 0}
                    selected={selection.includes(id)}
                    onSelect={onSelect}
                    onDelete={() => dispatchTx([{ type: "DeleteObject", id }])}
                  />
                ))}
              </Section>
            ))}

            {loose.length > 0 && (
              <Section label="Loose ends" count={loose.length}>
                {loose.map((id) => (
                  <Row
                    key={id}
                    scape={scape}
                    id={id}
                    links={0}
                    selected={selection.includes(id)}
                    onSelect={onSelect}
                    onDelete={() => dispatchTx([{ type: "DeleteObject", id }])}
                  />
                ))}
                <button
                  type="button"
                  disabled={busy || scape.objectOrder.length < 2}
                  onClick={() => onConnectLoose(loose)}
                  className={
                    "mt-1 w-full rounded-sm border border-subtle px-2 py-1.5 text-xs " +
                    "text-fg-secondary transition-colors duration-instant ease-out " +
                    "hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
                  }
                >
                  Connect these with AI
                </button>
              </Section>
            )}
          </>
        )}
      </div>

      <div className="border-t border-subtle p-2">
        <p className="mono px-1 pb-1.5">Add</p>
        <div className="flex flex-wrap gap-1">
          {addable.map((type) => {
            const plugin = getPlugin(type);
            if (!plugin) return null;
            return (
              <button
                key={type}
                type="button"
                onClick={() => onAdd(type)}
                className="flex items-center gap-1.5 rounded-full border border-subtle px-2.5 py-1 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: `var(${plugin.color})` }}
                />
                {plugin.label}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="pb-3">
      <p className="mono flex items-center justify-between px-2 pb-1">
        <span>{label}</span>
        <span>{count}</span>
      </p>
      {children}
    </section>
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
  onDelete: () => void;
}) {
  const object = scape.objects[id];
  if (!object) return null;
  const plugin = getPlugin(object.type);

  return (
    <div className="group flex items-center gap-1">
      <button
        type="button"
        onClick={() => onSelect(id)}
        className={
          "flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1 text-left " +
          "transition-colors duration-instant ease-out hover:bg-hover " +
          (selected ? "bg-selected" : "")
        }
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: `var(${plugin?.color ?? "--border-strong"})` }}
        />
        <span className="min-w-0 flex-1 truncate text-fg">{object.title || "Untitled"}</span>
        {links > 0 && <span className="mono shrink-0">{links}</span>}
      </button>
      <button
        type="button"
        aria-label={`Delete ${object.title || id}`}
        onClick={onDelete}
        className="shrink-0 rounded-sm px-1 py-1 text-fg-tertiary opacity-0 transition-colors duration-instant ease-out hover:text-danger group-hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}
