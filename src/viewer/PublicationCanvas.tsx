import { useMemo } from "react";
import { Background, BackgroundVariant, Controls, ReactFlow } from "@xyflow/react";
import type { PublishedScape } from "@/publish/contract";
import { stagePublicCopy } from "@/shared/publicCopy";
import { prepare } from "./publication";
import { ViewerExportMenu } from "./ViewerExportMenu";
import { ViewerNode, VIEWER_NODE_TYPE } from "./ViewerNode";

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

      {embed ? <EmbedBadge name={scape.name} /> : <ViewerHeader scape={scape} />}
    </div>
  );
}

function ViewerHeader({ scape }: { scape: PublishedScape }) {
  const copyAndEdit = () => {
    if (!stagePublicCopy(scape)) return;
    window.location.assign(`${window.location.origin}/#/`);
  };

  return (
    <header className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex items-start gap-2">
      <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border-default bg-surface px-3 py-2 shadow-md">
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium leading-none text-fg">
            {scape.name || "Untitled"}
          </h1>
          <p className="mono mt-1 text-fg-tertiary">Published scape</p>
        </div>
      </div>
      <ViewerExportMenu scape={scape} />
      <button
        type="button"
        onClick={copyAndEdit}
        className="pointer-events-auto rounded-lg border border-border-default bg-surface px-3 py-2 text-xs font-medium text-fg-secondary shadow-md transition-colors hover:bg-hover hover:text-fg"
      >
        Copy &amp; edit
      </button>
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
