import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { getPlugin } from "@/core/registry";
import { useScapeStore } from "@/core/store";
import type { ScapeObject } from "@/core/types";
import { MAX_OBJECT_WIDTH, MIN_OBJECT_WIDTH, objectWidth } from "./layout";
import type { ObjectNodeData } from "./edges";

/**
 * Connection handles.
 *
 * Hidden until you hover the card, then large enough to read as an invitation rather than a
 * decorative dot. Dragging one is the primary way to connect two objects, so its hover state
 * gets the accent and a small halo without introducing a second visual language on the card.
 */
const HANDLE =
  // z-20 puts it above the resize grip. The grip now lives in the bottom corner rather than
  // reading as a scrollbar along the card's whole right edge, but the source handle remains
  // deliberately above it so a connection always wins in the shared edge territory.
  "!z-20 !h-4 !w-4 !border-2 !border-[var(--bg-surface)] !bg-[var(--border-strong)] " +
  "!opacity-0 !transition-all !duration-fast group-hover:!opacity-100 group-hover:!bg-[var(--accent)] " +
  "group-hover:!shadow-[0_0_0_3px_var(--accent-subtle)] hover:!h-5 hover:!w-5 hover:!bg-[var(--accent-hover)]";

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
  const { width, grip } = useResizeGrip(object);

  return (
    <div
      style={{ width }}
      className={
        "group relative overflow-hidden rounded-lg bg-surface shadow-sm " +
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
        className={HANDLE}
        aria-label="Connect into this card"
      />

      {/*
        A tinted band, not a hairline. A 2px rule is invisible at the zoom people actually
        read a whole scape at, which left every card looking identical. The band keeps its
        colour at any scale, so type identity remains visible alongside the expanded body.
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
        <span className="mono ml-auto truncate">{object.id}</span>
      </div>

      <div className="px-3 pb-2.5 pt-2">
        {plugin ? (
          <plugin.Node object={object} selected={!!selected} />
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
        className={HANDLE}
        aria-label="Drag to create a connection"
        title="Drag to connect"
      />

      {grip}
    </div>
  );
}

/**
 * Drag the card's right edge to set its width.
 *
 * A card is only as useful as the content you can read on it, and a twelve-column wireframe
 * needs more room than a note. Width is stored on the object's own `data`, so it survives a
 * reload and an export, and it is written once on pointer-up — one entry on the undo stack,
 * not one per frame. Dagre already prefers React Flow's measured width, so a resized card
 * lays out correctly on the next tidy with nothing else to tell it.
 */
function useResizeGrip(object: ScapeObject) {
  const stored = objectWidth(object);
  const [draft, setDraft] = useState<number | null>(null);
  const start = useRef({ x: 0, width: 0 });
  const { getZoom } = useReactFlow();

  // A width the user is mid-drag on is local; everything else comes from the store, so undo
  // and a collaborator's edit both land immediately.
  const width = draft ?? stored;

  const commit = useCallback(
    (next: number | undefined) => {
      const data = { ...object.data };
      if (next === undefined) delete data.width;
      else data.width = next;
      useScapeStore
        .getState()
        .dispatchTx([{ type: "UpdateObject", id: object.id, patch: { data } }]);
    },
    [object.data, object.id],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    start.current = { x: e.clientX, width: stored };
    setDraft(stored);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (draft === null) return;
    // Screen pixels are not canvas pixels once you have zoomed.
    const delta = (e.clientX - start.current.x) / (getZoom() || 1);
    setDraft(
      Math.round(
        Math.min(MAX_OBJECT_WIDTH, Math.max(MIN_OBJECT_WIDTH, start.current.width + delta)),
      ),
    );
  };

  const onPointerUp = () => {
    if (draft === null) return;
    if (draft !== stored) commit(draft);
    setDraft(null);
  };

  // Escape abandons the drag rather than committing whatever the pointer happened to be over.
  useEffect(() => {
    if (draft === null) return;
    const cancel = (e: KeyboardEvent) => e.key === "Escape" && setDraft(null);
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [draft]);

  const grip = (
    <div
      role="separator"
      aria-label="Resize card"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDraft(null)}
      // Double-click gives the card its type's default width back.
      onDoubleClick={(e) => {
        e.stopPropagation();
        commit(undefined);
      }}
      title="Drag to resize · double-click to reset"
      className={
        "nodrag nopan absolute bottom-0 right-0 z-10 h-7 w-7 cursor-ew-resize " +
        "transition-opacity duration-instant ease-out " +
        (draft !== null ? "opacity-100" : "opacity-0 group-hover:opacity-100")
      }
    >
      <span
        aria-hidden
        className="absolute bottom-2 right-2 block h-3 w-3 rounded-br-sm border-b-2 border-r-2 border-[var(--border-strong)]"
      />
    </div>
  );

  return { width, grip };
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
