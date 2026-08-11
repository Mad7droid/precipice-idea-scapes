import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { objectWidth } from "@/core/geometry";
import { getViewPlugin, type ViewObject } from "@/core/viewRegistry";

export interface ViewerNodeData extends Record<string, unknown> {
  object: ViewObject;
}

export const VIEWER_NODE_TYPE = "publishedObject";

/**
 * React Flow only computes an edge when each endpoint has a source/target handle. The viewer
 * must therefore keep anchors even though it deliberately has no editable connection affordance.
 * These occupy a one-pixel, inert point at each card edge: enough for layout measurement, never
 * visible or reachable to a visitor.
 */
const READ_ONLY_HANDLE =
  "!pointer-events-none !h-px !w-px !border-0 !bg-transparent !opacity-0";

/**
 * The card, in the viewer. The same chrome the editor draws — surface, radius, the tinted type
 * band, the plugin's body — minus every affordance that would imply you can change something:
 * no connection handles, no resize grip, no click-to-edit.
 *
 * An unregistered type renders a fallback naming the type rather than crashing or rendering
 * blank. A publication written by a newer build will contain types this one has never heard of,
 * and a stranger's first experience of the product should not be a white screen.
 */
function ViewerNodeImpl({ data, selected }: NodeProps) {
  const { object } = data as unknown as ViewerNodeData;
  const plugin = getViewPlugin(object.type);
  const colour = plugin ? `var(${plugin.color})` : "var(--border-strong)";

  return (
    <div
      style={{ width: objectWidth(object) }}
      className={`relative overflow-hidden rounded-lg bg-surface shadow-sm transition-shadow duration-fast ${
        selected ? "ring-2 ring-accent shadow-md" : ""
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={READ_ONLY_HANDLE}
        aria-hidden
      />

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
      </div>

      <div className="px-3 pb-2.5 pt-2">
        {plugin ? (
          <plugin.View object={object} />
        ) : (
          <>
            <h4 className="text-sm font-medium text-fg">{object.title || "Untitled"}</h4>
            <p className="mono mt-1.5">unregistered type</p>
          </>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={READ_ONLY_HANDLE}
        aria-hidden
      />
    </div>
  );
}

export const ViewerNode = memo(ViewerNodeImpl);
