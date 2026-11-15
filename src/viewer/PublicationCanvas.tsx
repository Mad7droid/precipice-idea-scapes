import { useMemo, useState } from "react";
import { layoutClassFor } from "@/core/viewport";
import { Background, BackgroundVariant, Controls, ReactFlow } from "@xyflow/react";
import type { PublishedScape } from "@/publish/contract";
import { stagePublicCopy } from "@/shared/publicCopy";
import { prepare } from "./publication";
import { ViewerExportMenu } from "./ViewerExportMenu";
import { ViewerNode, VIEWER_NODE_TYPE } from "./ViewerNode";
import { PublicationList } from "./PublicationList";

type ViewMode = "canvas" | "list";

const nodeTypes = { [VIEWER_NODE_TYPE]: ViewerNode };

/**
 * A published scape, readable and nothing else.
 *
 * Read-only does not mean a static image: pan, zoom and fit are the whole point of showing a
 * spatial document rather than a screenshot of one. What is off is every gesture that would
 * imply an edit — dragging a card, drawing a connection, selecting anything.
 *
 * The positions come from the payload. The viewer never runs layout, because the arrangement is
 * the author's meaning, not a rendering detail. The editor camera is deliberately *not* reused:
 * it is a private working context and may be zoomed far out while the author arranges a large
 * scape. A reader should arrive with the rendered content in view.
 */
export function PublicationCanvas({ scape, embed }: { scape: PublishedScape; embed: boolean }) {
  const { nodes, edges, dropped } = useMemo(() => prepare(scape), [scape]);
  // A canvas fitted into a portrait phone is too small to read, so phones open on the list.
  // The embed always stays a canvas: it lives inside someone else's page at their size.
  const [view, setView] = useState<ViewMode>(() =>
    !embed && layoutClassFor(window.innerWidth) === "compact" ? "list" : "canvas",
  );

  if (!embed && view === "list") {
    return (
      <div className="flex h-dvh w-full flex-col bg-base">
        <ViewerHeader scape={scape} view={view} onViewChange={setView} docked />
        <div className="min-h-0 flex-1">
          <PublicationList scape={scape} />
        </div>
      </div>
    );
  }

  return (
    <div className="publication-canvas relative h-dvh w-full bg-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: embed ? 0.22 : 0.16, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        edgesFocusable
        nodesFocusable
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--canvas-dot)" />
        {/*
          Inside someone else's page the controls are the only way to zoom without fighting the
          host's scrolling, so they stay in the embed. Fit-view is the one that matters at a
          Notion embed's default height.
        */}
        <Controls
          className="publication-controls"
          showInteractive={false}
          position="bottom-right"
        />
      </ReactFlow>

      {dropped > 0 && (
        <p className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-surface px-2.5 py-1.5 text-2xs text-fg-tertiary shadow-sm">
          {dropped} {dropped === 1 ? "block" : "blocks"} could not be displayed
        </p>
      )}

      {embed ? (
        <EmbedBadge name={scape.name} />
      ) : (
        <ViewerHeader scape={scape} view={view} onViewChange={setView} />
      )}
    </div>
  );
}

function ViewerHeader({
  scape,
  view,
  onViewChange,
  docked = false,
}: {
  scape: PublishedScape;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  /** A solid bar above the list, rather than chrome floating over the canvas. */
  docked?: boolean;
}) {
  const copyAndEdit = () => {
    if (!stagePublicCopy(scape)) return;
    window.location.assign(`${window.location.origin}/#/`);
  };
  // This page's own address is the public link: the reader is already on it.
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const share = () => {
    const url = `${window.location.origin}${window.location.pathname}`;
    navigator.share({ title: scape.name || "Untitled", url }).catch(() => {
      // Dismissing the share sheet rejects; that is the reader changing their mind, not an error.
    });
  };

  const button =
    "pointer-events-auto inline-flex min-h-hit items-center rounded-lg border border-border-default bg-surface px-3 py-2 text-xs font-medium text-fg-secondary shadow-md transition-colors hover:bg-hover hover:text-fg";

  return (
    <header
      className={
        docked
          ? "z-10 flex flex-wrap items-center gap-2 border-b border-subtle bg-surface px-3 pb-2 pt-[calc(var(--space-2)+var(--safe-top))]"
          : "pointer-events-none absolute left-3 right-3 top-[calc(var(--space-3)+var(--safe-top))] z-10 flex flex-wrap items-start gap-2"
      }
    >
      <div
        className={
          docked
            ? "flex min-w-0 flex-1 items-center gap-3"
            : "pointer-events-auto flex min-w-0 items-center gap-3 rounded-lg border border-border-default bg-surface px-3 py-2 shadow-md"
        }
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium leading-none text-fg">
            {scape.name || "Untitled"}
          </h1>
          <p className="mono mt-1 text-fg-tertiary">Published scape</p>
        </div>
      </div>
      <div
        role="group"
        aria-label="View as"
        className="pointer-events-auto flex rounded-lg border border-border-default bg-surface p-0.5 shadow-md"
      >
        {(["canvas", "list"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={view === mode}
            onClick={() => onViewChange(mode)}
            className={`min-h-hit rounded-md px-3 text-xs font-medium transition-colors ${
              view === mode ? "bg-selected text-fg" : "text-fg-secondary hover:text-fg"
            }`}
          >
            {mode === "canvas" ? "Canvas" : "List"}
          </button>
        ))}
      </div>
      <div className="pointer-events-none flex items-start gap-2 compact:basis-full">
        {canShare && (
          <button type="button" onClick={share} className={button}>
            Share
          </button>
        )}
        <ViewerExportMenu scape={scape} />
        <button type="button" onClick={copyAndEdit} className={button}>
          Copy &amp; edit
        </button>
      </div>
    </header>
  );
}

/**
 * The embed's only chrome. A link out, and nothing that performs an action — that emptiness is
 * what makes `frame-ancestors *` safe on this path, and `src/viewer/bundle.test.ts` asserts it.
 */
function EmbedBadge({ name }: { name: string }) {
  return (
    <div className="absolute left-3 top-3 z-10 flex max-w-[70%] items-center gap-2 rounded-lg border border-border-default bg-surface px-2.5 py-1.5 shadow-md">
      <span className="truncate text-2xs text-fg-secondary">{name || "Untitled"}</span>
      <a
        href="https://precipice.pages.dev/"
        target="_blank"
        rel="noopener noreferrer"
        className="mono shrink-0 text-accent underline-offset-2 hover:underline"
      >
        Open in Precipice
      </a>
    </div>
  );
}
