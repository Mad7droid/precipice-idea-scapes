import { useEffect, useState } from "react";
import { useScapeStore } from "@/core/store";
import type { ScapeObject } from "@/core/types";
import { useCanvasReadOnly } from "@/canvas/readOnly";
import { RichTextEditor, useDebouncedText } from "../ui";
import { ScapeBlockBody, type ScapeBlockEditField } from "./Body";
import type { ScapeBlockData } from "./schema";

/**
 * The scape block's three states:
 *
 *   unselected            rendered Markdown, inert
 *   selected              rendered Markdown, with the click and ⏎ affordances
 *   editing               Markdown source, with the bold/italic/link/list shortcuts
 *
 * This is the one plugin that reads the `selected` prop React Flow has always passed down.
 * Editing a long document belongs on the canvas next to everything it refers to, not in a
 * 280px inspector column — but a card you can fall into by clicking once is a card you cannot
 * read, so entering source always takes a deliberate second action.
 */
export function ScapeBlockNode({ object, selected }: { object: ScapeObject; selected: boolean }) {
  const data = object.data as Partial<ScapeBlockData>;
  const [editing, setEditing] = useState<ScapeBlockEditField | null>(null);
  const readOnly = useCanvasReadOnly();

  const [body, setBody, flushBody] = useDebouncedText(data.body ?? "", (next) => {
    if (readOnly) return;
    useScapeStore
      .getState()
      .dispatchTx([{ type: "MergeObjectData", id: object.id, data: { body: next } }]);
  });

  // Deselecting has to commit, not strand a draft. `useDebouncedText` keeps the in-flight
  // string local, so leaving edit mode without flushing would silently lose the last words
  // typed before the click that moved the selection away.
  useEffect(() => {
    if (selected) return;
    setEditing((current) => {
      if (current) flushBody();
      return null;
    });
  }, [selected, flushBody]);

  // Enter opens the inspector for every other type. For a scape block the useful thing is one
  // step closer: put the caret in the document. Captured on `document` so it lands before the
  // canvas's own handler, and only ever for a lone selected block.
  useEffect(() => {
    if (!selected || editing || readOnly) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey) return;
      // Never steal Enter from a field — the inspector sits right next to the canvas. The
      // target is not always an element (a key with nothing focused lands on the document).
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable]")
      ) {
        return;
      }
      if (useScapeStore.getState().selection.length !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      setEditing("body");
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [selected, editing, readOnly]);

  const exit = () => {
    flushBody();
    setEditing(null);
  };

  if (editing === "title") {
    return (
      <input
        autoFocus
        defaultValue={object.title}
        onBlur={(e) => {
          setEditing(null);
          if (readOnly) return;
          useScapeStore
            .getState()
            .dispatchTx([
              { type: "UpdateObject", id: object.id, patch: { title: e.currentTarget.value } },
            ]);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(null);
          e.stopPropagation();
        }}
        className="nodrag nopan w-full rounded-sm border border-focus bg-raised px-1 text-sm font-medium text-fg focus-self"
      />
    );
  }

  if (editing === "body") {
    return (
      <>
        <h4
          onClick={() => setEditing("title")}
          className="nodrag cursor-text text-sm font-medium leading-snug text-fg"
        >
          {object.title || "Untitled"}
        </h4>
        <RichTextEditor
          autoFocus
          value={body}
          onChange={setBody}
          onBlur={exit}
          onEscape={exit}
          placeholder="Write the document. Headings, tables and lists all render."
          className="nodrag nopan nowheel mt-1.5 min-h-40 text-xs"
          rows={Math.max(8, Math.min(24, Math.ceil(body.length / 52)))}
        />
      </>
    );
  }

  return (
    <ScapeBlockBody
      object={object}
      selected={selected && !readOnly}
      {...(readOnly ? {} : { onEdit: setEditing })}
    />
  );
}
