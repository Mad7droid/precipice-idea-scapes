import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ActionPayload } from "@/core/actions";
import { newObjectId, newRelId } from "@/core/ids";
import { allPlugins } from "@/core/registry";
import { useScapeStore } from "@/core/store";
import type { ObjectId, RelationshipId } from "@/core/types";
import { starterFor, type EdgeMode, type LayoutMode } from "@/starters";
import { prefersReducedMotion, useFocusObject, useViewportPersistence } from "./camera";
import { mergeFlowNodes, toFlowEdges, OBJECT_NODE_TYPE, type ObjectNodeData } from "./edges";
import { layoutAction, widthFor } from "./layout";
import { ObjectNode } from "./ObjectNode";
import { AddPalette, ConnectMenu } from "./pickers";
import { ReadOnlyContext } from "./readOnly";
import { Toolbar } from "./Toolbar";

/** Stable identity — a fresh object here remounts every node on every render. */
const NODE_TYPES = { [OBJECT_NODE_TYPE]: ObjectNode };

/** The viewport a new Scape starts with, before the user has panned or zoomed. */
const isUntouchedViewport = (v: { x: number; y: number; zoom: number }) =>
  v.x === 0 && v.y === 0 && v.zoom === 1;

/**
 * View preferences are per-browser rather than part of the Scape document: how you want to
 * look at a scape is not a property of the scape, and it should not travel to whoever you
 * export it to.
 *
 * Edge visibility is keyed by scape, because its sensible default is not global — a mind map
 * without its edges is not a mind map, and a wall of screens threaded with lines is
 * unreadable. The starter supplies the default and this remembers an override.
 */
const EDGE_MODE_KEY = "precipice.view.edges";
const HIDDEN_TYPES_KEY = "precipice.view.hiddenTypes";

function readEdgeModes(): Record<string, EdgeMode> {
  try {
    const raw = localStorage.getItem(EDGE_MODE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    // Was a bare string before edge visibility became per-scape. Ignore rather than migrate:
    // it is a view preference, and the starter's default is a better answer than the old one.
    if (parsed && typeof parsed === "object") return parsed as Record<string, EdgeMode>;
  } catch {
    /* private mode, or a malformed value we should not die on */
  }
  return {};
}

function readHiddenTypes(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_TYPES_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* private mode, or a malformed value we should not die on */
  }
  return new Set();
}

// 0.25 was too high to frame a large scape at all: "fit view" would silently stop at the
// limit and leave half the canvas off-screen, which reads as the button being broken. Cards
// are unreadable this far out, but that is what fit is for — you are looking at the shape.
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;
/** Arrow-key nudge, per the keyboard spec. */
const NUDGE = 8;

/** Where a menu was opened: on screen, for placement, and in the canvas, for what it creates. */
interface Anchor {
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
  /** Set when the menu was opened by dragging a connection out of a node. */
  from?: ObjectId;
}

/** The connection that led to an "add" choice, held on screen while that choice is open. */
interface PendingConnection {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

function eventPoint(event: MouseEvent | TouchEvent) {
  const point = "changedTouches" in event ? event.changedTouches[0] : event;
  return point ? { x: point.clientX, y: point.clientY } : null;
}

/**
 * React Flow removes its live connection line as soon as a drag ends. Leaving a low-key,
 * dotted version in place while the add palette is open makes the resulting relationship
 * explicit — the palette is completing that line, not starting an unrelated action.
 */
function PendingConnectionLine({ connection }: { connection: PendingConnection }) {
  const distance = Math.abs(connection.endX - connection.startX);
  const bend = Math.max(36, Math.min(120, distance * 0.45));
  const path = `M ${connection.startX} ${connection.startY} C ${connection.startX + bend} ${connection.startY}, ${connection.endX - bend} ${connection.endY}, ${connection.endX} ${connection.endY}`;

  return (
    <svg
      aria-hidden
      className="pointer-events-none fixed inset-0 z-10 h-full w-full overflow-visible"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--edge-stroke-active)"
        strokeDasharray="3 6"
        strokeLinecap="round"
        strokeWidth="2"
        opacity="0.62"
      />
      <circle cx={connection.endX} cy={connection.endY} r="4" fill="var(--accent)" opacity="0.72" />
    </svg>
  );
}

/**
 * Imperative operations the canvas owns because they need measured node geometry.
 *
 * Handed to the parent via `onReady` rather than reached for through a global, so that
 * callers outside this directory — the AI apply loop and the outline panel, in particular —
 * receive them as plain callbacks and never import from src/canvas.
 */
export interface CanvasCommands {
  /** Re-runs layout and commits the result as a single LayoutScape action: one undo. */
  relayout: (mode?: LayoutMode) => void;
  focus: (id: ObjectId) => void;
  /** Clears the store selection *and* React Flow's own node.selected mirror — the two are
   * separate, so a caller outside the canvas (e.g. an inspector close button) needs both. */
  clearSelection: () => void;
  /** Adds an object of the given type at the centre of the current view. */
  addObject: (objectType: string) => void;
  fit: () => void;
  resetZoom: () => void;
}

export interface CanvasProps {
  /** Double-click, or Enter on a selected node. Selection alone does not open the inspector. */
  onOpenInspector?: (id: ObjectId) => void;
  onReady?: (commands: CanvasCommands) => void;
  /** True while the AI is streaming objects in — gates the one entrance spring the design
   * language allows onto nodes that actually arrived that way. */
  isGenerating?: boolean;
  /** Keeps React Flow's own palette in step with the app's. Left unset it defaults to light,
   * which reads wrong on a dark canvas. */
  colorMode?: "light" | "dark";
  /** Selecting an edge opens the relationship inspector, which the app shell owns. */
  onEdgeSelect?: (id: RelationshipId | null) => void;
  /** Opens the app-level guide; the canvas owns only the visible trigger. */
  onOpenHelp?: () => void;
  /**
   * Another tab holds this scape's lease, so nothing here may change the document.
   *
   * Reading stays fully live: pan, zoom, fit, filters, selection and the inspector all work,
   * because a tab you opened to look something up should let you look it up. Only the paths
   * that dispatch an action are closed.
   */
  readOnly?: boolean;
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <ReadOnlyContext.Provider value={props.readOnly ?? false}>
        <CanvasSurface {...props} />
      </ReadOnlyContext.Provider>
    </ReactFlowProvider>
  );
}

function CanvasSurface({
  onOpenInspector,
  onReady,
  isGenerating = false,
  colorMode = "light",
  onEdgeSelect,
  onOpenHelp,
  readOnly = false,
}: CanvasProps) {
  const scape = useScapeStore((s) => s.scape);
  const selection = useScapeStore((s) => s.selection);
  const dispatchTx = useScapeStore((s) => s.dispatchTx);
  const setSelection = useScapeStore((s) => s.setSelection);
  const onViewportChange = useViewportPersistence();
  const focus = useFocusObject();
  const { fitView, getInternalNode, zoomIn, zoomOut, zoomTo, screenToFlowPosition } =
    useReactFlow();
  const undoDepth = useScapeStore((s) => s.undoStack.length);
  const redoDepth = useScapeStore((s) => s.redoStack.length);
  const surface = useRef<HTMLDivElement>(null);

  // The scape's starter decides the arrangement and whether relationships are drawn.
  const starter = starterFor(scape);
  const scapeId = scape?.id ?? "";

  const [nodes, setNodes] = useState<Node<ObjectNodeData>[]>([]);
  const [zoom, setZoom] = useState(scape?.viewState.zoom ?? 1);
  const [connectMenu, setConnectMenu] = useState<Anchor | null>(null);
  const [addMenu, setAddMenu] = useState<Anchor | null>(null);
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<RelationshipId | null>(null);
  const [edgeModes, setEdgeModes] = useState<Record<string, EdgeMode>>(readEdgeModes);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(readHiddenTypes);

  const edgeMode = edgeModes[scapeId] ?? starter.edgeMode;
  // The starter supplies the first layout only. After the user chooses an arrangement, the
  // toolbar needs to reflect that choice instead of leaving its tick on the starter forever.
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(starter.layout);

  useEffect(() => setLayoutMode(starter.layout), [scapeId, starter.layout]);

  useEffect(() => {
    try {
      localStorage.setItem(EDGE_MODE_KEY, JSON.stringify(edgeModes));
      localStorage.setItem(HIDDEN_TYPES_KEY, JSON.stringify([...hiddenTypes]));
    } catch {
      /* private mode — the view preference just will not persist */
    }
  }, [edgeModes, hiddenTypes]);

  const setEdgeMode = useCallback(
    (mode: EdgeMode) => setEdgeModes((prev) => ({ ...prev, [scapeId]: mode })),
    [scapeId],
  );

  /** Selecting an edge and selecting a node are mutually exclusive: one inspector at a time. */
  const selectEdge = useCallback(
    (id: RelationshipId | null) => {
      setSelectedEdgeId(id);
      onEdgeSelect?.(id);
    },
    [onEdgeSelect],
  );

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
    setNodes((prev) => mergeFlowNodes(prev, scape, isGenerating));
  }, [scape, isGenerating]);

  // A relationship can be deleted out from under the inspector — by undo, by an AI
  // generation, or by deleting one of its endpoints.
  useEffect(() => {
    if (selectedEdgeId && scape && !scape.relationships[selectedEdgeId]) selectEdge(null);
  }, [scape, selectedEdgeId, selectEdge]);

  const edges = useMemo(
    () => (scape ? toFlowEdges(scape, selection, edgeMode, hiddenTypes, selectedEdgeId) : []),
    [scape, selection, edgeMode, hiddenTypes, selectedEdgeId],
  );

  const visibleNodes = useMemo(
    () =>
      hiddenTypes.size === 0 ? nodes : nodes.filter((n) => !hiddenTypes.has(n.data.object.type)),
    [nodes, hiddenTypes],
  );

  const onNodesChange = useCallback((changes: NodeChange<Node<ObjectNodeData>>[]) => {
    // Drag positions stay local until drag end. Removals never arrive: React Flow's delete
    // handler is disabled, and deletion goes through DeleteObject like everything else.
    setNodes((prev) => applyNodeChanges(changes, prev));
  }, []);

  /** One action per drag, on drag end. Forty per drag would poison undo and the action log. */
  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (readOnly) return;
      dispatchTx([
        {
          type: "MoveObject",
          id: node.id,
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        },
      ]);
    },
    [dispatchTx, readOnly],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selected }: OnSelectionChangeParams) => {
      setSelection(selected.map((n) => n.id));
      if (selected.length > 0) selectEdge(null);
    },
    [setSelection, selectEdge],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      if (!connection.source || !connection.target) return;
      dispatchTx([
        { type: "ConnectObjects", id: newRelId(), from: connection.source, to: connection.target },
      ]);
    },
    [dispatchTx, readOnly],
  );

  const anchorFrom = useCallback(
    (screenX: number, screenY: number, from?: ObjectId): Anchor => {
      const flow = screenToFlowPosition({ x: screenX, y: screenY });
      return { screenX, screenY, flowX: flow.x, flowY: flow.y, ...(from ? { from } : {}) };
    },
    [screenToFlowPosition],
  );

  /**
   * Dropping a connection on empty canvas offers to create the object it was heading for.
   *
   * This is the interaction a mind map is actually built with — drag out, name the thing,
   * repeat — and it is why the create and the connect land in one transaction: half a branch
   * is never a state worth being able to undo to.
   */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid) {
        setPendingConnection(null);
        return; // a real connection; onConnect already handled it
      }
      const from = state.fromNode?.id;
      if (!from) return;
      const point = eventPoint(event);
      if (!point) return;
      setConnectMenu(null);
      setAddMenu(anchorFrom(point.x, point.y, from));
      setPendingConnection((previous) => ({
        startX: previous?.startX ?? point.x,
        startY: previous?.startY ?? point.y,
        endX: point.x,
        endY: point.y,
      }));
    },
    [anchorFrom],
  );

  const connectTo = useCallback(
    (to: ObjectId) => {
      if (connectMenu?.from) {
        dispatchTx([{ type: "ConnectObjects", id: newRelId(), from: connectMenu.from, to }]);
      }
      setConnectMenu(null);
    },
    [connectMenu, dispatchTx],
  );

  const relayout = useCallback(
    (mode: LayoutMode = layoutMode) => {
      if (readOnly) return;
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
      dispatchTx([layoutAction(current, mode, measured)]);
      // Reflowing without refitting leaves the scape somewhere off-screen. Both move over
      // --dur-canvas so the reflow and the camera read as one motion.
      fitView({ padding: 0.15, maxZoom: 1, duration: prefersReducedMotion() ? 0 : 420 });
    },
    [dispatchTx, fitView, getInternalNode, layoutMode, readOnly],
  );

  const clearSelection = useCallback(() => {
    setSelection([]);
    setNodes((prev) => prev.map((n) => (n.selected ? { ...n, selected: false } : n)));
    selectEdge(null);
  }, [setSelection, selectEdge]);

  const fit = useCallback(() => {
    fitView({ padding: 0.15, maxZoom: 1, duration: prefersReducedMotion() ? 0 : 420 });
  }, [fitView]);

  /**
   * Manual object creation.
   *
   * `CreateObject` carries no coordinates by design, so the new object lands at 0,0 and a
   * `MoveObject` in the *same transaction* places it where it was asked for. When it came
   * from a dropped connection, the relationship joins the same transaction: one undo puts
   * the canvas back exactly as it was.
   */
  const createAt = useCallback(
    (objectType: string, at: { x: number; y: number }, from?: ObjectId, to?: ObjectId) => {
      if (readOnly) return;
      const plugin = allPlugins().find((p) => p.type === objectType);
      if (!plugin) return;

      const id = newObjectId();
      const payloads: ActionPayload[] = [
        {
          type: "CreateObject",
          id,
          objectType,
          title: `New ${plugin.label.toLowerCase()}`,
          data: plugin.defaults() as Record<string, unknown>,
        },
        // Centre the card on the point, not its top-left corner.
        {
          type: "MoveObject",
          id,
          x: Math.round(at.x - widthFor(objectType) / 2),
          y: Math.round(at.y - 60),
        },
      ];
      if (from) payloads.push({ type: "ConnectObjects", id: newRelId(), from, to: id });
      if (to) payloads.push({ type: "ConnectObjects", id: newRelId(), from: id, to });

      dispatchTx(payloads);
      // Select it so the inspector opens ready to edit — a new object with a placeholder
      // title is not finished, and the next thing anyone does is rename it.
      setSelection([id]);
      selectEdge(null);
      // A created object has a placeholder title. Let the next keystroke finish the thought.
      window.setTimeout(() => onOpenInspector?.(id), 0);
    },
    [dispatchTx, onOpenInspector, readOnly, setSelection, selectEdge],
  );

  const addObject = useCallback(
    (objectType: string) => {
      const rect = surface.current?.getBoundingClientRect();
      const centre = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 0, y: 0 };
      createAt(objectType, centre);
    },
    [createAt, screenToFlowPosition],
  );

  const openAddMenuAtCentre = useCallback(() => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    setConnectMenu(null);
    setAddMenu(anchorFrom(rect.left + rect.width / 2, rect.top + rect.height / 2));
  }, [anchorFrom]);

  const resetZoom = useCallback(() => {
    zoomTo(1, { duration: prefersReducedMotion() ? 0 : 130 });
  }, [zoomTo]);

  const extendSelection = useCallback(
    (id: ObjectId, direction: "forward" | "backward") => {
      const current = useScapeStore.getState().scape;
      const object = current?.objects[id];
      if (!object) return;
      const measured = getInternalNode(id)?.measured;
      const width = measured?.width ?? widthFor(object.type);
      const gap = 140;
      const point = {
        x: direction === "forward" ? object.x + width + gap : object.x - gap,
        y: object.y + (measured?.height ?? 120) / 2,
      };
      // Notes are the fastest neutral continuation of a thought. The connection direction
      // follows the spatial gesture: Tab extends out, Shift+Tab adds what leads into it.
      createAt(
        "note",
        point,
        direction === "forward" ? id : undefined,
        direction === "backward" ? id : undefined,
      );
    },
    [createAt, getInternalNode],
  );

  const focusNearest = useCallback(
    (id: ObjectId, direction: "up" | "down" | "left" | "right") => {
      const current = useScapeStore.getState().scape;
      const source = current?.objects[id];
      if (!current || !source) return;
      const candidates = current.objectOrder
        .map((candidateId) => current.objects[candidateId])
        .filter(
          (candidate): candidate is NonNullable<typeof candidate> =>
            !!candidate && candidate.id !== id,
        )
        .map((candidate) => {
          const dx = candidate.x - source.x;
          const dy = candidate.y - source.y;
          const inDirection =
            (direction === "left" && dx < 0) ||
            (direction === "right" && dx > 0) ||
            (direction === "up" && dy < 0) ||
            (direction === "down" && dy > 0);
          if (!inDirection) return undefined;
          // Prefer objects that are both close and actually in the requested lane.
          const axial = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
          const lateral =
            direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
          return { candidate, score: axial + lateral * 1.8 };
        })
        .filter(
          (candidate): candidate is { candidate: NonNullable<typeof source>; score: number } =>
            !!candidate,
        )
        .sort((a, b) => a.score - b.score)[0]?.candidate;
      if (!candidates) return;
      setSelection([candidates.id]);
      selectEdge(null);
      focus(candidates.id);
    },
    [focus, selectEdge, setSelection],
  );

  const deleteEdge = useCallback(
    (id: RelationshipId) => {
      dispatchTx([{ type: "DisconnectObjects", id }]);
      selectEdge(null);
    },
    [dispatchTx, selectEdge],
  );

  // Hand the parent the imperative surface once. All four are stable.
  useEffect(() => {
    onReady?.({ relayout, focus, clearSelection, addObject, fit, resetZoom });
  }, [onReady, relayout, focus, clearSelection, addObject, fit, resetZoom]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Never steal keys from a field — the inspector sits right next to the canvas.
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) {
        return;
      }

      const ids = useScapeStore.getState().selection;
      const meta = event.metaKey || event.ctrlKey;

      if (event.key === "0" && !meta) {
        event.preventDefault();
        resetZoom();
        return;
      }

      if (!readOnly && event.key === "Tab" && ids.length === 1) {
        event.preventDefault();
        extendSelection(ids[0], event.shiftKey ? "backward" : "forward");
        return;
      }

      const quickType = { n: "note", j: "journey", w: "wireframe" }[event.key.toLowerCase()];
      if (
        !readOnly &&
        !meta &&
        quickType &&
        (starter.types.length === 0 || starter.types.includes(quickType))
      ) {
        event.preventDefault();
        addObject(quickType);
        return;
      }

      if (event.key === "Escape") {
        clearSelection();
        setConnectMenu(null);
        setAddMenu(null);
        setPendingConnection(null);
        return;
      }

      // Shift+1 mirrors the "zoom to fit" binding common to canvas/design tools.
      if (event.shiftKey && event.key === "1") {
        event.preventDefault();
        fit();
        return;
      }

      // A selected relationship is deletable like anything else on the canvas. Before this,
      // `DisconnectObjects` existed in the protocol and was reachable only by the model.
      if (!readOnly && selectedEdgeId && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        deleteEdge(selectedEdgeId);
        return;
      }

      if (!ids.length) return;

      // Everything below changes the document. Alt+arrow is the exception and is handled
      // further down, because moving your attention is not an edit.
      if (readOnly && !(event.altKey && ids.length === 1)) return;

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
        if (event.altKey && ids.length === 1) {
          const direction =
            event.key === "ArrowUp"
              ? "up"
              : event.key === "ArrowDown"
                ? "down"
                : event.key === "ArrowLeft"
                  ? "left"
                  : "right";
          focusNearest(ids[0], direction);
          return;
        }
        const amount = event.shiftKey ? NUDGE * 10 : NUDGE;
        // One transaction for the whole nudge, so a multi-select nudge is one undo.
        dispatchTx(
          ids
            .map((id) => current.objects[id])
            .filter(Boolean)
            .map((o) => ({
              type: "MoveObject" as const,
              id: o.id,
              x: o.x + delta[0] * amount,
              y: o.y + delta[1] * amount,
            })),
        );
      }
    },
    [
      addObject,
      clearSelection,
      deleteEdge,
      dispatchTx,
      extendSelection,
      fit,
      focusNearest,
      onOpenInspector,
      readOnly,
      resetZoom,
      selectedEdgeId,
      setSelection,
      starter.types,
    ],
  );

  if (!scape) return <div className="h-full bg-canvas" />;

  return (
    <div
      ref={surface}
      tabIndex={0}
      onKeyDown={onKeyDown}
      // A focus ring around the entire viewport reads as a rendering fault, and selection is
      // what actually communicates focus here.
      className="focus-self relative h-full w-full bg-canvas"
    >
      <ReactFlow
        nodes={visibleNodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        colorMode={colorMode}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        onConnectStart={(event) => {
          const point = eventPoint(event);
          if (!point) return;
          setPendingConnection({ startX: point.x, startY: point.y, endX: point.x, endY: point.y });
        }}
        onConnectEnd={onConnectEnd}
        onNodeDoubleClick={(_, node) => onOpenInspector?.(node.id)}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          if (readOnly) return;
          setAddMenu(null);
          setPendingConnection(null);
          setConnectMenu(anchorFrom(event.clientX, event.clientY, node.id));
        }}
        onEdgeClick={(event, edge: Edge) => {
          event.stopPropagation();
          clearSelection();
          selectEdge(edge.id);
        }}
        onPaneClick={() => {
          setConnectMenu(null);
          setAddMenu(null);
          setPendingConnection(null);
          selectEdge(null);
        }}
        // Double-click on empty canvas adds an object there. The alternative — hunting for a
        // toolbar button and then dragging the result into place — is two steps too many.
        onDoubleClick={(event: React.MouseEvent) => {
          if (readOnly) return;
          if ((event.target as HTMLElement).closest(".react-flow__node")) return;
          setConnectMenu(null);
          setAddMenu(anchorFrom(event.clientX, event.clientY));
          setPendingConnection(null);
        }}
        onMove={(_, viewport) => {
          setZoom(viewport.zoom);
          if (!readOnly) onViewportChange(viewport);
        }}
        // Our own handlers, wired to applyAction. React Flow's built-ins would mutate state
        // behind the reducer's back and leave undo with nothing to reverse.
        deleteKeyCode={null}
        // Selection stays on in read-only: the point of the second tab is to look at things,
        // and the inspector is how you look at them.
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        // Fit only when the scape has no camera of its own yet; once the user has panned,
        // their viewport is persisted and overriding it on load would be a bug.
        //
        // These are mutually exclusive on purpose. Passing `fitView` and `defaultViewport`
        // together leaves React Flow's initialisation half-done: nodes are never measured,
        // stay `visibility: hidden`, and every edge is silently dropped because its
        // endpoints have no handle geometry. Spread so exactly one of the two is passed.
        {...(isUntouchedViewport(scape.viewState)
          ? { fitView: true, fitViewOptions: { padding: 0.15, maxZoom: 1 } }
          : { defaultViewport: scape.viewState })}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--canvas-dot)" />
      </ReactFlow>

      {pendingConnection && addMenu?.from && (
        <PendingConnectionLine connection={pendingConnection} />
      )}

      <Toolbar
        edgeMode={edgeMode}
        onEdgeModeChange={setEdgeMode}
        hiddenTypes={hiddenTypes}
        onToggleType={(type) =>
          setHiddenTypes((prev) => {
            const next = new Set(prev);
            if (next.has(type)) next.delete(type);
            else next.add(type);
            return next;
          })
        }
        layoutMode={layoutMode}
        onTidy={(mode) => {
          setLayoutMode(mode);
          relayout(mode);
        }}
        zoom={zoom}
        canUndo={undoDepth > 0}
        canRedo={redoDepth > 0}
        onUndo={() => useScapeStore.getState().undo()}
        onRedo={() => useScapeStore.getState().redo()}
        onZoomIn={() => zoomIn({ duration: prefersReducedMotion() ? 0 : 130 })}
        onZoomOut={() => zoomOut({ duration: prefersReducedMotion() ? 0 : 130 })}
        onZoomReset={resetZoom}
        onFit={fit}
        onAdd={openAddMenuAtCentre}
        onHelp={() => onOpenHelp?.()}
        readOnly={readOnly}
      />

      {addMenu && (
        <AddPalette
          x={addMenu.screenX}
          y={addMenu.screenY}
          availableTypes={starter.types}
          connectingFrom={addMenu.from}
          onPick={(type) => {
            createAt(type, { x: addMenu.flowX, y: addMenu.flowY }, addMenu.from);
            setAddMenu(null);
            setPendingConnection(null);
          }}
          onClose={() => {
            setAddMenu(null);
            setPendingConnection(null);
          }}
        />
      )}

      {connectMenu && (
        <ConnectMenu
          x={connectMenu.screenX}
          y={connectMenu.screenY}
          options={scape.objectOrder
            .filter((id) => id !== connectMenu.from && scape.objects[id])
            .map((id) => ({
              id,
              title: scape.objects[id]!.title || "Untitled",
              type: scape.objects[id]!.type,
            }))}
          onPick={connectTo}
          onClose={() => setConnectMenu(null)}
        />
      )}
    </div>
  );
}
