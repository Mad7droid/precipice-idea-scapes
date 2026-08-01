import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { allPlugins } from "@/core/registry";
import { useScapeStore } from "@/core/store";
import type { ObjectId } from "@/core/types";
import { prefersReducedMotion, useFocusObject, useViewportPersistence } from "./camera";
import {
  mergeFlowNodes,
  toFlowEdges,
  OBJECT_NODE_TYPE,
  type EdgeMode,
  type ObjectNodeData,
} from "./edges";
import { layoutAction, widthFor, type Direction } from "./layout";
import { ObjectNode } from "./ObjectNode";

/** Stable identity — a fresh object here remounts every node on every render. */
const NODE_TYPES = { [OBJECT_NODE_TYPE]: ObjectNode };

/** The viewport a new Scape starts with, before the user has panned or zoomed. */
const isUntouchedViewport = (v: { x: number; y: number; zoom: number }) =>
  v.x === 0 && v.y === 0 && v.zoom === 1;

/**
 * View preferences are per-browser rather than per-scape, and deliberately not part of the
 * Scape document: how you want to look at a scape is not a property of the scape, and it
 * should not travel to whoever you export it to.
 */
const EDGE_MODE_KEY = "precipice.view.edges";
const HIDDEN_TYPES_KEY = "precipice.view.hiddenTypes";

function readEdgeMode(): EdgeMode {
  try {
    const raw = localStorage.getItem(EDGE_MODE_KEY);
    if (raw === "none" || raw === "selected" || raw === "all") return raw;
  } catch {
    /* private mode */
  }
  return "none";
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
  /** Clears the store selection *and* React Flow's own node.selected mirror — the two are
   * separate, so a caller outside the canvas (e.g. an inspector close button) needs both. */
  clearSelection: () => void;
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
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasSurface {...props} />
    </ReactFlowProvider>
  );
}

function CanvasSurface({
  onOpenInspector,
  onReady,
  isGenerating = false,
  colorMode = "light",
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

  const [nodes, setNodes] = useState<Node<ObjectNodeData>[]>([]);
  const [zoom, setZoom] = useState(scape?.viewState.zoom ?? 1);
  /** Handle-drag is the primary way to connect two nodes, but it relies on knowing React
   * Flow's handle convention. This context menu is the discoverable fallback. */
  const [connectMenu, setConnectMenu] = useState<{ from: ObjectId; x: number; y: number } | null>(
    null,
  );
  const [edgeMode, setEdgeMode] = useState<EdgeMode>(readEdgeMode);
  /** Object types the user has switched off for this canvas. */
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(readHiddenTypes);

  useEffect(() => {
    try {
      localStorage.setItem(EDGE_MODE_KEY, edgeMode);
      localStorage.setItem(HIDDEN_TYPES_KEY, JSON.stringify([...hiddenTypes]));
    } catch {
      /* private mode — the view preference just will not persist */
    }
  }, [edgeMode, hiddenTypes]);
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

  const edges = useMemo(
    () => (scape ? toFlowEdges(scape, selection, edgeMode, hiddenTypes) : []),
    [scape, selection, edgeMode, hiddenTypes],
  );

  const visibleNodes = useMemo(
    () => (hiddenTypes.size === 0 ? nodes : nodes.filter((n) => !hiddenTypes.has(n.data.object.type))),
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

  const connectTo = useCallback(
    (to: ObjectId) => {
      if (connectMenu) {
        dispatchTx([{ type: "ConnectObjects", id: newRelId(), from: connectMenu.from, to }]);
      }
      setConnectMenu(null);
    },
    [connectMenu, dispatchTx],
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

  const clearSelection = useCallback(() => {
    setSelection([]);
    setNodes((prev) => prev.map((n) => (n.selected ? { ...n, selected: false } : n)));
  }, [setSelection]);

  const fit = useCallback(() => {
    fitView({ padding: 0.15, maxZoom: 1, duration: prefersReducedMotion() ? 0 : 420 });
  }, [fitView]);

  /**
   * Manual object creation. Until now the only way to get an object onto the canvas was to
   * ask the model for one.
   *
   * `CreateObject` carries no coordinates by design, so the new object lands at 0,0 and a
   * `MoveObject` in the *same transaction* places it at the centre of what the user is
   * currently looking at. One action pair, one undo.
   */
  const addObject = useCallback(
    (objectType: string) => {
      const plugin = allPlugins().find((p) => p.type === objectType);
      if (!plugin) return;

      const rect = surface.current?.getBoundingClientRect();
      const centre = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 0, y: 0 };

      const id = newObjectId();
      dispatchTx([
        {
          type: "CreateObject",
          id,
          objectType,
          title: `New ${plugin.label.toLowerCase()}`,
          data: plugin.defaults() as Record<string, unknown>,
        },
        // Centre the card, not its top-left corner.
        {
          type: "MoveObject",
          id,
          x: Math.round(centre.x - widthFor(objectType) / 2),
          y: Math.round(centre.y - 60),
        },
      ]);
      // Select it so the inspector opens ready to edit — a new object with a placeholder
      // title is not finished, and the next thing anyone does is rename it.
      setSelection([id]);
    },
    [dispatchTx, screenToFlowPosition, setSelection],
  );

  // Hand the parent the imperative surface once. `relayout`, `focus` and `clearSelection` are
  // all stable.
  useEffect(() => {
    onReady?.({ relayout, focus, clearSelection });
  }, [onReady, relayout, focus, clearSelection]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Never steal keys from a field — the inspector sits right next to the canvas.
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) {
        return;
      }

      const ids = useScapeStore.getState().selection;
      const meta = event.metaKey || event.ctrlKey;

      if (event.key === "Escape") {
        clearSelection();
        setConnectMenu(null);
        return;
      }

      // Shift+1 mirrors the "zoom to fit" binding common to canvas/design tools.
      if (event.shiftKey && event.key === "1") {
        event.preventDefault();
        fit();
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
    [clearSelection, dispatchTx, fit, onOpenInspector, setSelection],
  );

  if (!scape) return <div className="h-full bg-canvas" />;

  return (
    <div
      ref={surface}
      tabIndex={0}
      onKeyDown={onKeyDown}
      // Plugins tag low-priority content `lod-body`; below the threshold it drops out rather
      // than rendering as unreadable mush.
      data-lod={zoom < LOD_THRESHOLD ? "low" : "high"}
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
        onNodeDoubleClick={(_, node) => onOpenInspector?.(node.id)}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          setConnectMenu({ from: node.id, x: event.clientX, y: event.clientY });
        }}
        onPaneClick={() => setConnectMenu(null)}
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
        zoom={zoom}
        canUndo={undoDepth > 0}
        canRedo={redoDepth > 0}
        onUndo={() => useScapeStore.getState().undo()}
        onRedo={() => useScapeStore.getState().redo()}
        onZoomIn={() => zoomIn({ duration: prefersReducedMotion() ? 0 : 130 })}
        onZoomOut={() => zoomOut({ duration: prefersReducedMotion() ? 0 : 130 })}
        onZoomReset={() => zoomTo(1, { duration: prefersReducedMotion() ? 0 : 130 })}
        onFit={fit}
        onTidy={() => relayout()}
        onAdd={addObject}
      />

      {connectMenu && (
        <ConnectMenu
          x={connectMenu.x}
          y={connectMenu.y}
          options={scape.objectOrder
            .filter((id) => id !== connectMenu.from)
            .map((id) => ({ id, title: scape.objects[id]?.title || "Untitled" }))}
          onPick={connectTo}
          onClose={() => setConnectMenu(null)}
        />
      )}
    </div>
  );
}

/**
 * The canvas utility rail.
 *
 * Two of these were previously unreachable from the app: `Tidy` (auto-layout existed only as
 * a command the AI called after a generation) and `Add` (there was no way to put an object on
 * the canvas without asking the model for one). Undo and redo existed as keystrokes only.
 */
function Toolbar({
  edgeMode,
  onEdgeModeChange,
  hiddenTypes,
  onToggleType,
  zoom,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFit,
  onTidy,
  onAdd,
}: {
  edgeMode: EdgeMode;
  onEdgeModeChange: (mode: EdgeMode) => void;
  hiddenTypes: Set<string>;
  onToggleType: (type: string) => void;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFit: () => void;
  onTidy: () => void;
  onAdd: (objectType: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);

  return (
    <div className="absolute bottom-4 right-4 z-panel flex flex-col items-end gap-1.5">
      {viewOpen && (
        <div
          className="mb-0.5 w-52 rounded-md border border-subtle bg-surface p-1 shadow-lg"
          onMouseLeave={() => setViewOpen(false)}
        >
          <p className="mono px-2 py-1 text-fg-tertiary">Lines</p>
          {(
            [
              ["none", "Off"],
              ["selected", "Only for selection"],
              ["all", "All"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => onEdgeModeChange(mode)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-fg transition-colors duration-instant ease-out hover:bg-hover"
            >
              <Tick on={edgeMode === mode} />
              {label}
            </button>
          ))}

          <p className="mono mt-1 border-t border-subtle px-2 pb-1 pt-2 text-fg-tertiary">Show</p>
          {allPlugins().map((plugin) => (
            <button
              key={plugin.type}
              type="button"
              onClick={() => onToggleType(plugin.type)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-fg transition-colors duration-instant ease-out hover:bg-hover"
            >
              <Tick on={!hiddenTypes.has(plugin.type)} />
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: `var(${plugin.color})` }}
              />
              {plugin.label}
            </button>
          ))}
        </div>
      )}

      {addOpen && (
        <div
          className="mb-0.5 rounded-md border border-subtle bg-surface p-1 shadow-lg"
          onMouseLeave={() => setAddOpen(false)}
        >
          {allPlugins().map((plugin) => (
            <button
              key={plugin.type}
              type="button"
              onClick={() => {
                onAdd(plugin.type);
                setAddOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-fg transition-colors duration-instant ease-out hover:bg-hover"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: `var(${plugin.color})` }}
              />
              {plugin.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col overflow-hidden rounded-md border border-subtle bg-surface shadow-sm">
        <ToolButton
          label="Add object"
          onClick={() => {
            setViewOpen(false);
            setAddOpen((open) => !open);
          }}
        >
          <path d="M7 2.5v9M2.5 7h9" strokeLinecap="round" />
        </ToolButton>
        <ToolButton
          label={`View — lines ${edgeMode === "none" ? "off" : edgeMode}`}
          onClick={() => {
            setAddOpen(false);
            setViewOpen((open) => !open);
          }}
        >
          <path d="M1 7s2.2-3.8 6-3.8S13 7 13 7s-2.2 3.8-6 3.8S1 7 1 7Z" strokeLinejoin="round" />
          <circle cx="7" cy="7" r="1.6" />
        </ToolButton>

        <Divider />

        <ToolButton label="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo}>
          <path d="M3 6.5h5.2a2.8 2.8 0 0 1 0 5.6H5.5" strokeLinecap="round" />
          <path d="M5.2 3.6 2.4 6.5l2.8 2.9" strokeLinecap="round" strokeLinejoin="round" />
        </ToolButton>
        <ToolButton label="Redo (⇧⌘Z)" onClick={onRedo} disabled={!canRedo}>
          <path d="M11 6.5H5.8a2.8 2.8 0 0 0 0 5.6h2.7" strokeLinecap="round" />
          <path d="M8.8 3.6l2.8 2.9-2.8 2.9" strokeLinecap="round" strokeLinejoin="round" />
        </ToolButton>

        <Divider />

        <ToolButton label="Zoom in" onClick={onZoomIn}>
          <path d="M7 3.5v7M3.5 7h7" strokeLinecap="round" />
        </ToolButton>
        <button
          type="button"
          title="Reset zoom to 100%"
          onClick={onZoomReset}
          className="mono px-1 py-1 text-center text-fg-tertiary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
        >
          {Math.round(zoom * 100)}
        </button>
        <ToolButton label="Zoom out" onClick={onZoomOut}>
          <path d="M3.5 7h7" strokeLinecap="round" />
        </ToolButton>

        <Divider />

        <ToolButton label="Fit view (⇧1)" onClick={onFit}>
          <path d="M1.5 5V1.5h3.5M12.5 5V1.5H9M1.5 9v3.5h3.5M12.5 9v3.5H9" />
        </ToolButton>
        <ToolButton label="Tidy layout" onClick={onTidy}>
          <path d="M2 2.5h4v3.5H2zM8 2.5h4v9H8zM2 8h4v3.5H2z" strokeLinejoin="round" />
        </ToolButton>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={
        "grid h-8 w-8 place-items-center transition-colors duration-instant ease-out " +
        "disabled:pointer-events-none disabled:opacity-30 " +
        "text-fg-secondary hover:bg-hover hover:text-fg"
      }
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

function Divider() {
  return <span className="h-px bg-[var(--border-subtle)]" aria-hidden />;
}

function Tick({ on }: { on: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
      {on && (
        <path
          d="M2.5 6.2l2.4 2.4 4.6-5"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function ConnectMenu({
  x,
  y,
  options,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  options: { id: ObjectId; title: string }[];
  onPick: (id: ObjectId) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="z-popover fixed rounded-md border border-subtle bg-surface p-1 shadow-lg"
      style={{ left: x, top: y }}
      onMouseLeave={onClose}
    >
      <p className="mono px-2 py-1 text-fg-tertiary">Connect to</p>
      {options.length === 0 ? (
        <p className="px-2 py-1 text-xs text-fg-tertiary">No other objects</p>
      ) : (
        <ul className="max-h-64 overflow-auto">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => onPick(o.id)}
                className="block w-full truncate rounded-sm px-2 py-1 text-left text-fg transition-colors duration-instant ease-out hover:bg-hover"
              >
                {o.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
