import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@/app/router";
import { Canvas, type CanvasCommands } from "@/canvas/Canvas";
import type { Action } from "@/core/actions";
import { describeAction } from "@/core/actions";
import { fixtureScape } from "@/core/fixtures";
import { newObjectId } from "@/core/ids";
import { useScapeStore } from "@/core/store";

/**
 * Workstream B's harness. Every gesture on the left produces a visible action on the right —
 * that is the whole point of the panel. If a gesture mutates the canvas without an action
 * appearing, the single-mutation-path rule has been broken somewhere.
 */
export function DevCanvas() {
  const scape = useScapeStore((s) => s.scape);
  const selection = useScapeStore((s) => s.selection);
  const undoStack = useScapeStore((s) => s.undoStack);
  const redoStack = useScapeStore((s) => s.redoStack);
  const dispatchTx = useScapeStore((s) => s.dispatchTx);
  const commands = useRef<CanvasCommands | null>(null);

  const [log, setLog] = useState<Action[]>([]);

  useEffect(() => {
    useScapeStore.getState().loadScape(fixtureScape());
    setLog([]);
    // Drain the store's log the same way autosave will, so the display and the persistence
    // queue exercise the same contract.
    return useScapeStore.subscribe(() => {
      const drained = useScapeStore.getState().drainActionLog();
      if (drained.length) setLog((prev) => [...prev, ...drained]);
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) useScapeStore.getState().redo();
      else useScapeStore.getState().undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onReady = useCallback((c: CanvasCommands) => {
    commands.current = c;
  }, []);

  const reset = () => {
    useScapeStore.getState().loadScape(fixtureScape());
    setLog([]);
  };

  return (
    <div className="flex h-full bg-base">
      <div className="min-w-0 flex-1">
        <Canvas onReady={onReady} onOpenInspector={(id) => commands.current?.focus(id)} />
      </div>

      <aside className="flex w-[340px] shrink-0 flex-col border-l border-subtle bg-base">
        <div className="border-b border-subtle p-4">
          <Link to="/dev" className="mono">
            ← dev
          </Link>
          <h1 className="mt-2 text-lg text-fg">Canvas</h1>
          <p className="mt-1 text-xs text-fg-secondary">
            Drag a node, drag handle to handle, select and press Delete, Cmd+D to duplicate, arrows
            to nudge, Escape to clear, Cmd+Z to undo.
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <Command onClick={() => commands.current?.relayout("LR")}>Layout LR</Command>
            <Command onClick={() => commands.current?.relayout("TB")}>Layout TB</Command>
            <Command
              onClick={() => {
                const scape = useScapeStore.getState().scape;
                if (!scape) return;
                const ids = scape.objectOrder;
                commands.current?.focus(ids[Math.floor(Math.random() * ids.length)]);
              }}
            >
              Fly to
            </Command>
            <Command
              onClick={() =>
                dispatchTx(
                  selection.map((id) => ({
                    type: "DuplicateObject" as const,
                    id,
                    newId: newObjectId(),
                  })),
                )
              }
              disabled={!selection.length}
            >
              Duplicate
            </Command>
            <Command
              onClick={() =>
                dispatchTx(selection.map((id) => ({ type: "DeleteObject" as const, id })))
              }
              disabled={!selection.length}
            >
              Delete
            </Command>
            <Command onClick={() => useScapeStore.getState().undo()} disabled={!undoStack.length}>
              Undo ({undoStack.length})
            </Command>
            <Command onClick={() => useScapeStore.getState().redo()} disabled={!redoStack.length}>
              Redo ({redoStack.length})
            </Command>
            <Command onClick={reset}>Reset</Command>
          </div>

          <p className="mono mt-3">
            objects · {scape ? scape.objectOrder.length : 0} · relationships ·{" "}
            {scape ? Object.keys(scape.relationships).length : 0}
          </p>
          <p className="mono mt-1">selected · {selection.length ? selection.join(", ") : "none"}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <h2 className="mono mb-2">action log · {log.length}</h2>
          {log.length === 0 ? (
            <p className="text-xs text-fg-tertiary">
              Interact with the canvas. Every gesture appears here.
            </p>
          ) : (
            <ol className="space-y-1">
              {log
                .map((action, i) => ({ action, i }))
                .reverse()
                .map(({ action, i }) => (
                  <li key={i} className="animate-ribbon-line rounded-sm bg-surface px-2 py-1.5">
                    <div className="mono normal-case tracking-normal text-fg-secondary">
                      {action.type}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-fg-tertiary">
                      {describeAction(action)}
                    </div>
                  </li>
                ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}

function Command({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-subtle px-2.5 py-1 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
