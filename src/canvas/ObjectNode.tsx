import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { getPlugin } from "@/core/registry";
import { widthFor } from "./layout";
import type { ObjectNodeData } from "./edges";

/**
 * The one React Flow node type. It owns the card — surface, radius, shadow, the type band
 * and the id — and delegates the middle to whichever plugin the object's type resolves to.
 *
 * An unregistered type renders a fallback card naming the type in mono. It never crashes and
 * never renders blank, because a Scape imported from a newer version of the app will contain
 * types this build has never heard of.
 */
function ObjectNodeImpl({ data, selected }: NodeProps) {
  const { object, justGenerated } = data as unknown as ObjectNodeData;
  const plugin = getPlugin(object.type);
  const colour = plugin ? `var(${plugin.color})` : "var(--border-strong)";

  return (
    <div
      style={{ width: widthFor(object.type) }}
      className={
        "overflow-hidden rounded-lg bg-surface shadow-sm " +
        // The one spring the design language allows: a node arriving from the AI stream.
        // Manual creation (duplicate, import, relayout) mounts with no entrance animation.
        (justGenerated ? "animate-node-enter " : "") +
        // Selection is a ring, not a shadow change: the card must not appear to lift.
        (selected ? "ring-2 ring-accent" : "")
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-[var(--border-strong)]"
      />

      {/*
        A tinted band, not a hairline. A 2px rule is invisible at the zoom people actually
        read a whole scape at, which left every card looking identical. The band keeps its
        colour at any scale, and it is deliberately *not* tagged `lod-body`: when the body
        drops out at low zoom, type identity is the one thing that must survive.
      */}
      <div
        className="flex items-center gap-1.5 px-3 py-1"
        style={{
          background: `color-mix(in srgb, ${colour} 14%, transparent)`,
          boxShadow: `inset 0 -1px 0 0 color-mix(in srgb, ${colour} 28%, transparent)`,
        }}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: colour }}
          aria-hidden
        />
        <span className="text-2xs font-medium text-fg-secondary">
          {plugin?.label ?? object.type}
        </span>
        <span className="mono lod-body ml-auto truncate">{object.id}</span>
      </div>

      <div className="px-3 pb-2.5 pt-2">
        {plugin ? (
          <plugin.Node object={object} selected={!!selected} />
        ) : (
          <>
            <h4 className="text-sm font-medium text-fg">{object.title || "Untitled"}</h4>
            <p className="mono lod-body mt-1.5">unregistered type</p>
          </>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-[var(--border-strong)]"
      />
    </div>
  );
}

/**
 * Memoized hard. A 200-node scape re-rendering every node on every drag frame feels broken,
 * and React Flow re-renders the node list on each frame of a drag by design.
 */
export const ObjectNode = memo(ObjectNodeImpl, (prev, next) => {
  const a = (prev.data as unknown as ObjectNodeData).object;
  const b = (next.data as unknown as ObjectNodeData).object;
  return prev.selected === next.selected && a === b;
});
