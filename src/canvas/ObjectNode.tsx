import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { getPlugin } from "@/core/registry";
import { NODE_WIDTH } from "./layout";
import type { ObjectNodeData } from "./edges";

/**
 * The one React Flow node type. It owns the card — surface, radius, shadow, the type-coloured
 * bar and the id — and delegates the middle to whichever plugin the object's type resolves to.
 *
 * An unregistered type renders a fallback card naming the type in mono. It never crashes and
 * never renders blank, because a Scape imported from a newer version of the app will contain
 * types this build has never heard of.
 */
function ObjectNodeImpl({ data, selected }: NodeProps) {
  const { object } = data as unknown as ObjectNodeData;
  const plugin = getPlugin(object.type);

  return (
    <div
      style={{ width: NODE_WIDTH }}
      className={
        "animate-node-enter rounded-lg bg-surface shadow-sm " +
        // Selection is a ring, not a shadow change: the card must not appear to lift.
        (selected ? "ring-2 ring-accent" : "")
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-[var(--border-strong)]"
      />

      {/* The only colour on the card. Type also has a label, so nothing is colour-only. */}
      <div
        className="h-0.5 rounded-t-lg"
        style={{ background: plugin ? `var(${plugin.color})` : "var(--border-strong)" }}
      />

      <div className="px-3 pb-2 pt-2.5">
        {plugin ? (
          <plugin.Node object={object} selected={!!selected} />
        ) : (
          <>
            <h4 className="text-sm font-medium text-fg">{object.title || "Untitled"}</h4>
            <p className="mono lod-body mt-1.5">unregistered type · {object.type}</p>
          </>
        )}
        <p className="mono mt-2">{object.id}</p>
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
