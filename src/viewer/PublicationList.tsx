import { useMemo } from "react";
import { getViewPlugin, type ViewObject } from "@/core/viewRegistry";
import type { PublishedScape } from "@/publish/contract";
import { prepare } from "./publication";

/**
 * A published scape as a document you scroll, for screens too small to read a canvas on.
 *
 * Same objects, same plugin views, same schema filtering as the canvas (it goes through
 * `prepare`), laid out in reading order: top to bottom, then left to right, which is how the
 * author's arrangement reads. Each card names what it connects to, and those names jump to the
 * card, so the relationships a canvas shows as lines survive the change of form.
 */
export function PublicationList({ scape }: { scape: PublishedScape }) {
  const { order, links, dropped } = useMemo(() => {
    const prepared = prepare(scape);
    const objects = prepared.nodes.map((node) => node.data.object);
    const byId = new Map(objects.map((object) => [object.id, object]));
    const links = new Map<string, { id: string; title: string; label?: string }[]>();
    for (const edge of prepared.edges) {
      const target = byId.get(edge.target);
      if (!target) continue;
      const label = typeof edge.label === "string" && edge.label ? edge.label : undefined;
      const list = links.get(edge.source) ?? [];
      list.push({ id: target.id, title: target.title || "Untitled", ...(label ? { label } : {}) });
      links.set(edge.source, list);
    }
    return { order: readingOrder(objects), links, dropped: prepared.dropped };
  }, [scape]);

  return (
    <main className="scroll-contain h-full overflow-y-auto bg-base">
      <ol className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pb-[calc(var(--space-8)+var(--safe-bottom))] pt-4">
        {order.map((object) => (
          <li key={object.id} id={anchorFor(object.id)} className="scroll-mt-4">
            <ListCard object={object} links={links.get(object.id) ?? []} />
          </li>
        ))}
      </ol>
      {dropped > 0 && (
        <p className="pb-8 text-center text-2xs text-fg-tertiary">
          {dropped} {dropped === 1 ? "block" : "blocks"} could not be displayed
        </p>
      )}
    </main>
  );
}

function ListCard({
  object,
  links,
}: {
  object: ViewObject;
  links: { id: string; title: string; label?: string }[];
}) {
  const plugin = getViewPlugin(object.type);
  const colour = plugin ? `var(${plugin.color})` : "var(--border-strong)";
  return (
    <article className="overflow-hidden rounded-lg border border-subtle bg-surface">
      <div
        className="flex items-center gap-1.5 px-3 py-1"
        style={{ background: `color-mix(in srgb, ${colour} 14%, transparent)` }}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: colour }}
          aria-hidden
        />
        <span className="text-2xs font-medium text-fg-secondary">
          {plugin?.label ?? object.type}
        </span>
      </div>
      <div className="px-3 pb-3 pt-2">
        {plugin ? (
          <plugin.View object={object} />
        ) : (
          <h2 className="text-sm font-medium text-fg">{object.title || "Untitled"}</h2>
        )}
      </div>
      {links.length > 0 && (
        <nav
          aria-label="Connected to"
          className="flex flex-wrap gap-1.5 border-t border-subtle px-3 py-2"
        >
          {links.map((link) => (
            <a
              key={link.id}
              href={`#${anchorFor(link.id)}`}
              className="inline-flex min-h-hit items-center rounded-full border border-subtle px-2.5 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
            >
              {link.label ? `${link.label} → ` : "→ "}
              {link.title}
            </a>
          ))}
        </nav>
      )}
    </article>
  );
}

/** Ids are author data; prefix them so they can never collide with anything on the page. */
function anchorFor(id: string): string {
  return `block-${id}`;
}

/**
 * The order a person would read the author's arrangement in.
 *
 * A layout that runs left to right (wider than tall, which is how auto-layout lays out a
 * flow) reads column by column; one that runs top to bottom reads row by row. Within a lane,
 * cards whose leading edges are within half a lane of the lane's first card belong to it, so a
 * slightly ragged column does not read as a staircase.
 */
export function readingOrder<T extends { x: number; y: number }>(objects: readonly T[]): T[] {
  if (objects.length < 2) return [...objects];
  const xs = objects.map((o) => o.x);
  const ys = objects.map((o) => o.y);
  const wide = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  const lane = (o: T) => (wide ? o.x : o.y);
  const along = (o: T) => (wide ? o.y : o.x);
  const LANE = 120;

  const sorted = [...objects].sort((a, b) => lane(a) - lane(b));
  const lanes: T[][] = [];
  for (const object of sorted) {
    const current = lanes[lanes.length - 1];
    if (current && lane(object) - lane(current[0]) < LANE / 2) current.push(object);
    else lanes.push([object]);
  }
  return lanes.flatMap((group) => group.sort((a, b) => along(a) - along(b)));
}
