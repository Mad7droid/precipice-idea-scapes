import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { newObjectId, newRelId } from "@/core/ids";
import { useScapeStore } from "@/core/store";
import type { ObjectId } from "@/core/types";
import { prefersReducedMotion, useFocusObject, useViewportPersistence } from "./camera";
import { mergeFlowNodes, toFlowEdges, OBJECT_NODE_TYPE, type ObjectNodeData } from "./edges";
import { layoutAction, type Direction } from "./layout";
import { ObjectNode } from "./ObjectNode";

/** Stable identity — a fresh object here remounts every node on every render. */
const NODE_TYPES = { [OBJECT_NODE_TYPE]: ObjectNode };

/** The viewport a new Scape starts with, before the user has panned or zoomed. */
const isUntouchedViewport = (v: { x: number; y: number; zoom: number }) =>
  v.x === 0 && v.y === 0 && v.zoom === 1;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
/** Below this, 12px body text renders under ~7px. Plugins tag such content `lod-body`. */
const LOD_THRESHOLD = 0.6;
/** Arrow-key nudge, per the keyboard spec. */
const NUDGE = 8;

/**
 * Imperative operations the canvas owns because they need measured node geometry.
 *
 * Handed to the parent via `onReady` rather than reached for through a global, so that
 * callers outside this directory — the AI apply loop, in particular — receive them as a
 * plain callback and never import from src/canvas.
 */
export interface CanvasCommands {
  /** Re-runs Dagre and commits the result as a single LayoutScape action: one undo. */
  relayout: (direction?: Direction) => void;
  focus: (id: ObjectId) => void;
}

export interface CanvasProps {
  /** Double-click, or Enter on a selected node. Selection alone does not open the inspector. */
  onOpenInspector?: (id: ObjectId) => void;
  onReady?: (commands: CanvasCommands) => void;
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasSurface {...props} />
    </ReactFlowProvider>
  );
}

function CanvasSurface({ onOpenInspector, onReady }: CanvasProps) {
  const scape = useScapeStore((s) => s.scape);
  const selection = useScapeStore((s) => s.selection);
  const dispatchTx = useScapeStore((s) => s.dispatchTx);
  const setSelection = useScapeStore((s) => s.setSelection);
  const onViewportChange = useViewportPersistence();
  const focus = useFocusObject();
  const { fitView, getInternalNode } = useReactFlow();

  const [nodes, setNodes] = useState<Node<ObjectNodeData>[]>([]);
  const [zoom, setZoom] = useState(scape?.viewState.zoom ?? 1);
  /**
   * React Flow would like to own node positions. It does not: the store is the source of
   * truth and this array is a mirror, kept only so a drag can animate at 60fps without
   * dispatching an action per frame. It is rebuilt whenever the Scape changes, preserving
   * React Flow's own selection state — which it does own.
   */
  useEffect(() => {
    if (!scape) {
      setNodes([]);
      return;
    }
    setNodes((prev) => mergeFlowNodes(prev, scape));
  }, [scape]);

  const edges = useMemo(() => (scape ? toFlowEdges(scape, selection) : []), [scape, selection]);

  const onNodesChange = useCallback((changes: NodeChange<Node<ObjectNodeData>>[]) => {
    // Drag positions stay local until drag end. Removals never arrive: React Flow's delete
    // handler is disabled, and deletion goes through DeleteObject like everything else.
    setNodes((prev) => applyNodeChanges(changes, prev));
  }, []);

  /** One action per drag, on drag end. Forty per drag would poison undo and the action log. */
  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      dispatchTx([
        {
          type: "MoveObject",
          id: node.id,
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        },
      ]);
    },
    [dispatchTx],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selected }: OnSelectionChangeParams) => setSelection(selected.map((n) => n.id)),
    [setSelection],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      dispatchTx([
        { type: "ConnectObjects", id: newRelId(), from: connection.source, to: connection.target },
      ]);
    },
    [dispatchTx],
  );

  const relayout = useCallback(
    (direction: Direction = "LR") => {
      const current = useScapeStore.getState().scape;
      if (!current) return;
      // Real measured heights beat the per-type fallbacks, so a five-step journey and a
      // one-line note get the vertical space they actually need.
      //
      // They come from getInternalNode, not from our own node array: React Flow v12 keeps
      // `measured` in its internal lookup and never writes it back to userland nodes.
      const measured: Record<string, { width: number; height: number }> = {};
      for (const id of current.objectOrder) {
        const internal = getInternalNode(id);
        const size = internal?.measured;
        if (size?.width && size?.height) {
          measured[id] = { width: size.width, height: size.height };
        }
      }
      dispatchTx([layoutAction(current, direction, measured)]);
      // Reflowing without refitting leaves the scape somewhere off-screen. Both move over
      // --dur-canvas so the reflow and the camera read as one motion.
      fitView({ padding: 0.15, maxZoom: 1, duration: prefersReducedMotion() ? 0 : 420 });
    },
    [dispatchTx, fitView, getInternalNode],
  );

  // Hand the parent the imperative surface once. `relayout` and `focus` are both stable.
  useEffect(() => {
    onReady?.({ relayout, focus });
  }, [onReady, relayout, focus]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Never steal keys from a field — the inspector sits right next to the canvas.
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) {
        return;
      }

      const ids = useScapeStore.getState().selection;
      const meta = event.metaKey || event.ctrlKey;

      if (event.key === "Escape") {
        setSelection([]);
        setNodes((prev) => prev.map((n) => (n.selected ? { ...n, selected: false } : n)));
        return;
      }

      if (!ids.length) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        dispatchTx(ids.map((id) => ({ type: "DeleteObject" as const, id })));
        setSelection([]);
        return;
      }

      if (meta && event.key.toLowerCase() === "d") {
        event.preventDefault();
        dispatchTx(
          ids.map((id) => ({ type: "DuplicateObject" as const, id, newId: newObjectId() })),
        );
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        onOpenInspector?.(ids[0]);
        return;
      }

      const delta = {
        ArrowUp: [0, -NUDGE],
        ArrowDown: [0, NUDGE],
        ArrowLeft: [-NUDGE, 0],
        ArrowRight: [NUDGE, 0],
      }[event.key];

      if (delta) {
        event.preventDefault();
        const current = useScapeStore.getState().scape;
        if (!current) return;
        // One transaction for the whole nudge, so a multi-select nudge is one undo.
        dispatchTx(
          ids
            .map((id) => current.objects[id])
            .filter(Boolean)
            .map((o) => ({
              type: "MoveObject" as const,
              id: o.id,
              x: o.x + delta[0],
              y: o.y + delta[1],
            })),
        );
      }
    },
    [dispatchTx, onOpenInspector, setSelection],
  );

  if (!scape) return <div className="h-full bg-canvas" />;

  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      // Plugins tag low-priority content `lod-body`; below the threshold it drops out rather
      // than rendering as unreadable mush.
      data-lod={zoom < LOD_THRESHOLD ? "low" : "high"}
      className="h-full w-full bg-canvas outline-none"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        onNodeDoubleClick={(_, node) => onOpenInspector?.(node.id)}
        onMove={(_, viewport) => {
          setZoom(viewport.zoom);
          onViewportChange(viewport);
        }}
        // Our own handlers, wired to applyAction. React Flow's built-ins would mutate state
        // behind the reducer's back and leave undo with nothing to reverse.
        deleteKeyCode={null}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        // Fit only when the scape has no camera of its own yet; once the user has panned,
        // their viewport is persisted and overriding it on load would be a bug.
        //
        // These are mutually exclusive on purpose. Passing `fitView` and `defaultViewport`
        // together leaves React Flow's initialisation half-done: nodes are never measured,
        // stay `visibility: hidden`, and every edge is silently dropped because its
        // endpoints have no handle geometry.
        // Fit only when the scape has no camera of its own yet; once the user has panned,
        // their viewport is persisted and overriding it on load would be a bug. Spread so
        // exactly one of the two is ever passed.
        {...(isUntouchedViewport(scape.viewState)
          ? { fitView: true, fitViewOptions: { padding: 0.15, maxZoom: 1 } }
          : { defaultViewport: scape.viewState })}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--canvas-dot)" />
      </ReactFlow>
    </div>
  );
}
