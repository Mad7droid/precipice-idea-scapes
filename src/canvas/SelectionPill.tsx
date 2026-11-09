import { NodeToolbar, Position } from "@xyflow/react";
import type { ObjectId } from "@/core/types";

/**
 * The touch replacement for hover toolbars and right-click: a small floating bar above the
 * selected node. Every mobile canvas editor converges on this (see the Mobbin notes in the
 * mobile plan); a phone has nowhere else to put "what can I do with this".
 *
 * Rendered by React Flow's NodeToolbar, so it follows the node through pan and zoom and stays
 * a fixed size at any zoom.
 */
export function SelectionPill({
  nodeId,
  onEdit,
  onConnect,
  onAsk,
  onDuplicate,
  onDelete,
}: {
  nodeId: ObjectId;
  onEdit: () => void;
  onConnect: (point: { x: number; y: number }) => void;
  onAsk?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <NodeToolbar nodeId={nodeId} isVisible position={Position.Top} offset={10}>
      <div
        role="toolbar"
        aria-label="Selected block"
        className="flex items-center rounded-full border border-subtle bg-raised px-1 shadow-md"
      >
        <PillButton label="Edit" onClick={onEdit} />
        <PillButton
          label="Connect"
          onClick={(event) => {
            const r = event.currentTarget.getBoundingClientRect();
            onConnect({ x: r.left, y: r.bottom });
          }}
        />
        {onAsk && <PillButton label="Ask" onClick={onAsk} />}
        <PillButton label="Duplicate" onClick={onDuplicate} />
        <PillButton label="Delete" onClick={onDelete} danger />
      </div>
    </NodeToolbar>
  );
}

function PillButton({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-hit rounded-full px-2.5 text-xs transition-colors duration-instant ease-out active:bg-active ${
        danger ? "text-danger" : "text-fg"
      }`}
    >
      {label}
    </button>
  );
}
