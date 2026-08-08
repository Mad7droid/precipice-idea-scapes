import { getPlugin } from "@/core/registry";
import type { ScapePreview } from "@/core/types";

/**
 * A scape at 56×36, drawn from the positions already in the snapshot.
 *
 * Not a render of the canvas. Rendering one offscreen would mean a rendering pipeline, a
 * cache, and an invalidation story for a picture nobody looks at closely. A dot per object,
 * tinted by type, with hairlines for the relationships, costs none of that and does the one
 * job a thumbnail has here: you can tell a mind map from a flow from a sheet of screens
 * without reading the name.
 */
export function ScapeThumbnail({ preview }: { preview?: ScapePreview }) {
  const width = 56;
  const height = 36;
  const pad = 5;

  if (!preview || preview.nodes.length === 0) {
    return (
      <div
        className="grid shrink-0 place-items-center rounded-sm border border-subtle bg-inset"
        style={{ width, height }}
        aria-hidden
      >
        <span className="block h-1 w-1 rounded-full bg-[var(--border-strong)]" />
      </div>
    );
  }

  const at = (n: { x: number; y: number }) => ({
    cx: pad + n.x * (width - pad * 2),
    cy: pad + n.y * (height - pad * 2),
  });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 rounded-sm border border-subtle bg-inset"
      aria-hidden
    >
      {preview.edges.map(([from, to], i) => {
        const a = preview.nodes[from];
        const b = preview.nodes[to];
        if (!a || !b) return null;
        const p = at(a);
        const q = at(b);
        return (
          <line
            key={i}
            x1={p.cx}
            y1={p.cy}
            x2={q.cx}
            y2={q.cy}
            stroke="var(--edge-stroke)"
            strokeWidth={0.6}
          />
        );
      })}
      {preview.nodes.map((node, i) => {
        const plugin = getPlugin(node.type);
        const { cx, cy } = at(node);
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={1.7}
            fill={plugin ? `var(${plugin.color})` : "var(--border-strong)"}
          />
        );
      })}
    </svg>
  );
}
