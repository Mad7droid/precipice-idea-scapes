import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { Scape } from "@/core/types";
import { useScapeStore } from "@/core/store";
import { applyAction } from "@/core/reducer";
import type { Action } from "@/core/actions";
import { newTxId } from "@/core/ids";
import { scapeRepository } from "@/persistence/scapeRepository";
import { ViewerNode, VIEWER_NODE_TYPE } from "@/viewer/ViewerNode";
import { Button } from "@/design/Button";
import { useDialogFocus } from "@/app/home/Dialog";
import { ChangeDetails } from "./ChangeDetails";
import { changesBetween, contentKey, type Checkpoint, type CheckpointSummary } from "./model";

function HistoryNode(props: NodeProps) {
  const label = props.data.changeLabel as string | undefined;
  return (
    <div className="relative">
      {label && (
        <span className="absolute -top-6 left-0 rounded-md border border-default bg-surface px-2 py-0.5 text-2xs font-medium text-fg">
          {label}
        </span>
      )}
      <ViewerNode {...props} />
    </div>
  );
}
const nodeTypes = { [VIEWER_NODE_TYPE]: HistoryNode };
const date = (time: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(time);
const reasonLabel = (row: CheckpointSummary) =>
  row.label ||
  {
    baseline: "History started",
    automatic: "Automatic version",
    manual: "Saved version",
    ai: "AI changes",
    "ai-partial": "Partial AI changes",
    agent: "Agent changes",
    "before-restore": "Before restore",
    restore: "Restored version",
  }[row.reason];

export function HistoryWorkspace(props: {
  current: Scape;
  canWrite: () => boolean;
  flush: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <ReactFlowProvider>
      <HistoryContent {...props} />
    </ReactFlowProvider>
  );
}
function HistoryContent({
  current: liveCurrent,
  canWrite,
  flush,
  onClose,
}: {
  current: Scape;
  canWrite: () => boolean;
  flush: () => Promise<void>;
  onClose: () => void;
}) {
  const [current] = useState(liveCurrent);
  const [rows, setRows] = useState<CheckpointSummary[]>([]);
  const [selected, setSelected] = useState<Checkpoint | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [compare, setCompare] = useState(true);
  const [showCurrent, setShowCurrent] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(true);
  const [detail, setDetail] = useState<string | null>(null);
  const busyRef = useRef(false);
  const request = useRef(0);
  const close = () => {
    if (!busyRef.current) onClose();
  };
  const root = useDialogFocus(close);
  const flow = useReactFlow();
  const initial = useRef({ current, canWrite });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (initial.current.canWrite()) {
          try {
            await scapeRepository.history.capture(initial.current.current, "manual");
          } catch (e) {
            if (!cancelled) setError(message(e));
          }
        }
        const versions = await scapeRepository.history.list(initial.current.current.id);
        if (!cancelled) setRows(versions);
      } catch (e) {
        if (!cancelled) setError(message(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      request.current++;
    };
  }, []);
  const choose = async (id: string | null) => {
    const ticket = ++request.current;
    setNaming(false);
    setName("");
    setSelectedId(id);
    setSelected(null);
    setConfirming(false);
    setDeleting(false);
    setError("");
    setDetail(null);
    setShowCurrent(false);
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const version = await scapeRepository.history.get(id);
      if (ticket !== request.current) return;
      if (!version) throw new Error("This version is no longer available.");
      setSelected(version);
      setVersionsOpen(false);
    } catch (e) {
      if (ticket === request.current) setError(message(e));
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  };
  const currentMatches = contentKey(liveCurrent) === contentKey(current);
  const changes = useMemo(
    () => (selected ? changesBetween(selected.snapshot, current) : []),
    [selected, current],
  );
  const changeLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const change of changes)
      if (!change.scope)
        labels.set(change.id, [labels.get(change.id), change.kind].filter(Boolean).join(" · "));
    return labels;
  }, [changes]);
  const visible = selected && !showCurrent ? selected.snapshot : current;
  const nodes: Node[] = useMemo(
    () =>
      visible.objectOrder.flatMap((id) => {
        const object = visible.objects[id];
        if (!object) return [];
        const changeLabel = compare && selected ? changeLabels.get(id) : undefined;
        return [
          {
            id,
            type: VIEWER_NODE_TYPE,
            position: { x: object.x, y: object.y },
            data: { object, changeLabel },
            style: changeLabel
              ? {
                  outline: "2px solid var(--accent)",
                  outlineOffset: 4,
                  borderRadius: "var(--r-lg)",
                }
              : undefined,
          },
        ];
      }),
    [visible, changeLabels, compare, selected],
  );
  const edges = useMemo(
    () =>
      Object.values(visible.relationships).map((r) => ({
        id: r.id,
        source: r.from,
        target: r.to,
        label: r.label,
        style: { stroke: "var(--text-tertiary)" },
        labelStyle: { fill: "var(--text-secondary)" },
        labelBgStyle: { fill: "var(--bg-surface)" },
      })),
    [visible],
  );
  const different = selected && contentKey(selected.snapshot) !== contentKey(current);
  const saveName = async () => {
    if (!name.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (!canWrite()) throw new Error("Open this scape for editing to save a named version.");
      if (selected) await scapeRepository.history.rename(selected.id, current.id, name.trim());
      else await scapeRepository.history.capture(current, "manual", name.trim());
      setRows(await scapeRepository.history.list(current.id));
      setSelected((value) => (value ? { ...value, label: name.trim() } : value));
      setNaming(false);
      setName("");
    } catch (e) {
      setError(message(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const removeVersion = async () => {
    if (!selected || busyRef.current || !canWrite()) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await scapeRepository.history.remove(selected.id, current.id);
      setRows(await scapeRepository.history.list(current.id));
      await choose(null);
    } catch (e) {
      setError(message(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!selected || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await useScapeStore.getState().commit(async (token) => {
        if (!canWrite() || useScapeStore.getState().generating)
          throw new Error("Wait for editing to finish and try again.");
        await flush();
        const before = useScapeStore.getState().scape;
        if (!before || contentKey(before) !== contentKey(current))
          throw new Error("The scape changed. Return to current and try again.");
        const { name, objects, objectOrder, relationships, meta, instructions } = selected.snapshot;
        const action: Action = {
          type: "RestoreScapeContent",
          txId: newTxId(),
          ts: Date.now(),
          content: { name, objects, objectOrder, relationships, meta, instructions },
        };
        const after = applyAction(before, action).state;
        await scapeRepository.history.restore(before, after, selected.id, canWrite, action);
        useScapeStore.getState().dispatch(action, token);
        useScapeStore.getState().drainActionLog();
      });
      busyRef.current = false;
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Version history"
      tabIndex={-1}
      className="fixed inset-0 z-modal flex flex-col bg-base text-fg coarse:[&_button]:min-h-hit"
      onKeyDown={(e) => {
        if (e.key !== "Tab" && e.key !== "Escape") e.stopPropagation();
      }}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-subtle bg-surface px-4 pb-3 pt-[max(12px,var(--safe-top))]">
        <div className="min-w-0">
          <h1 className="text-sm font-medium">Version history</h1>
          <p className="truncate text-xs text-fg-secondary">{current.name}</p>
        </div>
        <Button variant="secondary" onClick={close} disabled={busy}>
          Back to current <span aria-hidden>↗</span>
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <aside className="flex shrink-0 flex-col border-b border-subtle bg-surface sm:w-72 sm:border-b-0 sm:border-r">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <span className="text-xs font-medium">Versions</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVersionsOpen((v) => !v)}
              className="sm:hidden"
              aria-expanded={versionsOpen}
            >
              {versionsOpen ? "Hide" : "Browse"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setName(selected?.label ?? "");
                setNaming((v) => !v);
              }}
              disabled={!canWrite() || busy || loading}
            >
              {selected ? "Name this version" : "Save named version"}
            </Button>
          </div>
          {naming && (
            <form
              className="flex gap-2 px-4 pb-3"
              onSubmit={(e) => {
                e.preventDefault();
                void saveName();
              }}
            >
              <input
                autoFocus
                aria-label="Version name"
                maxLength={120}
                placeholder="e.g. First concept"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-default bg-base px-2 text-sm"
              />
              <Button type="submit" size="sm" disabled={!name.trim() || busy}>
                Save
              </Button>
            </form>
          )}
          <div
            className={`${versionsOpen ? "" : "hidden"} max-h-[30vh] overflow-y-auto px-2 pb-3 sm:block sm:max-h-none sm:flex-1`}
            aria-label="Saved versions"
          >
            <button
              disabled={busy}
              onClick={() => void choose(null)}
              aria-pressed={!selectedId}
              className="mb-2 flex w-full flex-col rounded-lg px-3 py-3 text-left hover:bg-hover aria-pressed:bg-selected"
            >
              <span className="text-sm font-medium">Current version</span>
              <span className="mt-1 text-xs text-fg-secondary">Your latest work</span>
            </button>
            {rows.map((row) => (
              <button
                key={row.id}
                disabled={busy}
                onClick={() => void choose(row.id)}
                aria-pressed={selectedId === row.id}
                className="flex w-full flex-col gap-1 rounded-lg px-3 py-3 text-left hover:bg-hover aria-pressed:bg-selected"
              >
                <span className="text-sm">{reasonLabel(row)}</span>
                <span className="text-xs text-fg-secondary">{date(row.capturedAt)}</span>
                {row.summary && <span className="text-xs text-fg-tertiary">{row.summary}</span>}
              </button>
            ))}
            {!loading && !rows.length && (
              <p className="px-3 py-4 text-xs text-fg-secondary">
                History starts with this version. Future changes will appear here.
              </p>
            )}
          </div>
          <p className="hidden border-t border-subtle px-4 py-3 text-xs text-fg-tertiary sm:block">
            Saved locally. Exports include the current scape, without version history.
          </p>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle bg-surface px-4 py-2">
            <div className="text-xs text-fg-secondary" aria-live="polite">
              {loading
                ? "Loading version…"
                : selected
                  ? `Viewing ${date(selected.capturedAt)}`
                  : "Viewing current version"}{" "}
              · Read only
            </div>
            {selected && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={compare}
                  onClick={() => setCompare((v) => !v)}
                >
                  {compare ? "Hide changes" : "Show changes"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-pressed={showCurrent}
                  onClick={() => setShowCurrent((v) => !v)}
                >
                  {showCurrent ? "Show saved version" : "Show current"}
                </Button>
              </div>
            )}
          </div>
          {!currentMatches && (
            <p role="status" className="border-b border-subtle px-4 py-3 text-sm text-fg-secondary">
              The current scape changed in another session. Return to current before restoring.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="border-b border-subtle bg-surface px-4 py-3 text-sm text-danger"
            >
              {error}
            </p>
          )}
          <div
            className="publication-canvas relative min-h-0 flex-1 bg-canvas"
            aria-label="Version preview"
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
              minZoom={0.1}
              maxZoom={2}
              nodesDraggable={false}
              nodesConnectable={false}
              deleteKeyCode={null}
              panOnScroll
              proOptions={{ hideAttribution: true }}
            >
              <Background color="var(--canvas-dot)" gap={20} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
            {!visible.objectOrder.length && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-fg-tertiary">
                This version has no blocks.
              </div>
            )}
          </div>
          {selected && compare && (
            <section
              aria-label="Changes to current"
              className="max-h-[28vh] shrink-0 overflow-y-auto border-t border-subtle bg-surface px-4 py-3"
            >
              <h2 className="mb-2 text-xs font-medium">
                Changes from this version to current · {changes.length}
              </h2>
              {!changes.length && (
                <p className="text-xs text-fg-secondary">Same content as current.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {changes.map((change) => (
                  <Button
                    key={`${change.scope ?? "block"}:${change.id}:${change.kind}`}
                    size="sm"
                    variant="secondary"
                    aria-expanded={
                      detail === `${change.scope ?? "block"}:${change.id}:${change.kind}`
                    }
                    onClick={() => {
                      setDetail(
                        detail === `${change.scope ?? "block"}:${change.id}:${change.kind}`
                          ? null
                          : `${change.scope ?? "block"}:${change.id}:${change.kind}`,
                      );
                      if (change.scope) return;
                      if (!visible.objects[change.id]) {
                        if (current.objects[change.id]) setShowCurrent(true);
                        else if (selected.snapshot.objects[change.id]) setShowCurrent(false);
                      }
                      requestAnimationFrame(() => {
                        void flow.fitView({ nodes: [{ id: change.id }], padding: 0.5, maxZoom: 1 });
                      });
                    }}
                  >
                    {change.kind} · {change.title}
                  </Button>
                ))}
              </div>
              {changes
                .filter(
                  (c) =>
                    `${c.scope ?? "block"}:${c.id}:${c.kind}` === detail &&
                    (c.before !== undefined || c.after !== undefined),
                )
                .map((c) => (
                  <ChangeDetails
                    key={`${c.scope ?? "block"}:${c.id}:${c.kind}`}
                    change={c}
                    before={selected.snapshot}
                    after={current}
                  />
                ))}
            </section>
          )}
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-subtle bg-surface px-4 pb-[max(12px,var(--safe-bottom))] pt-3">
            <p className="max-w-md text-xs text-fg-secondary">
              {deleting
                ? "Delete this saved version permanently? Your current scape will stay unchanged."
                : confirming
                  ? "Make this your current version? Your current work will remain in history."
                  : selected
                    ? "Explore this version without changing your work."
                    : "Automatic versions preserve your work as you edit."}
            </p>
            <div className="ml-auto flex gap-2">
              {selected && !confirming && (
                <Button
                  variant="ghost"
                  disabled={busy || !canWrite()}
                  onClick={() => (deleting ? void removeVersion() : setDeleting(true))}
                >
                  {deleting ? "Delete permanently" : "Delete version"}
                </Button>
              )}
              {(confirming || deleting) && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    setDeleting(false);
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button
                variant="primary"
                disabled={!different || !currentMatches || loading || busy || !canWrite()}
                onClick={() => {
                  setDeleting(false);
                  if (confirming) void restore();
                  else setConfirming(true);
                }}
              >
                {busy ? "Saving…" : confirming ? "Confirm restore" : "Restore this version"}
              </Button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
function message(error: unknown) {
  return error instanceof Error ? error.message : "Could not load version history. Try again.";
}
