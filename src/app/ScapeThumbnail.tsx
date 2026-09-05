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
export function ScapeThumbnail({
  preview,
  large = false,
}: {
  preview?: ScapePreview;
  large?: boolean;
}) {
  const width = large ? 360 : 56;
  const height = large ? 160 : 36;
  const pad = large ? 32 : 5;

  if (!preview || preview.nodes.length === 0) {
    return (
      <div
        className="grid shrink-0 place-items-center rounded-sm border border-subtle bg-inset"
        style={{ width: large ? "100%" : width, height }}
        aria-hidden
      >
        {large ? (
          <span className="text-xs text-fg-tertiary">Your next idea starts here</span>
        ) : (
          <span className="block h-1 w-1 rounded-full bg-[var(--border-strong)]" />
        )}
      </div>
    );
  }

  const at = (n: { x: number; y: number }) => ({
    cx: preview.nodes.every((node) => node.x === preview.nodes[0].x)
      ? width / 2
      : pad + n.x * (width - pad * 2),
    cy: preview.nodes.every((node) => node.y === preview.nodes[0].y)
      ? height / 2
      : pad + n.y * (height - pad * 2),
  });

  return (
    <svg
      width={large ? "100%" : width}
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
            strokeWidth={large ? 1 : 0.6}
          />
        );
      })}
      {preview.nodes.map((node, i) => {
        const plugin = getPlugin(node.type);
        const { cx, cy } = at(node);
        if (large)
          return (
            <g key={i}>
              <rect
                x={cx - 13}
                y={cy - 9}
                width={26}
                height={18}
                rx={2}
                fill="var(--bg-surface)"
                stroke={plugin ? `var(${plugin.color})` : "var(--border-strong)"}
                strokeOpacity={0.65}
              />
              <path
                d={`M${cx - 8} ${cy - 3}h12M${cx - 8} ${cy + 2}h8`}
                stroke="var(--text-tertiary)"
                strokeOpacity={0.4}
              />
            </g>
          );
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
