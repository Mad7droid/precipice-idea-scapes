import { useState } from "react";
import { useScapeStore } from "@/core/store";
import type { ScapeObject } from "@/core/types";
import { useCanvasReadOnly } from "@/canvas/readOnly";
import { NoteBody, type NoteEditField } from "./Body";
import type { NoteData } from "./schema";

/**
 * The editable card. Display lives in `Body.tsx`, which the public viewer also renders — this
 * file is the editing state and the dispatch around it, and nothing else.
 */
export function NoteNode({ object }: { object: ScapeObject; selected: boolean }) {
  const data = object.data as Partial<NoteData>;
  const [editing, setEditing] = useState<NoteEditField | null>(null);
  const readOnly = useCanvasReadOnly();

  const commitTitle = (title: string) => {
    if (readOnly) return;
    useScapeStore
      .getState()
      .dispatchTx([{ type: "UpdateObject", id: object.id, patch: { title } }]);
  };

  const commitBody = (body: string) => {
    if (readOnly) return;
    useScapeStore
      .getState()
      .dispatchTx([{ type: "MergeObjectData", id: object.id, data: { body } }]);
  };

  if (editing === "title") {
    return (
      <input
        autoFocus
        defaultValue={object.title}
        onBlur={(e) => {
          setEditing(null);
          commitTitle(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(null);
        }}
        className="nodrag nopan w-full rounded-sm border border-focus bg-raised px-1 text-sm font-medium text-fg focus-self"
      />
    );
  }

  if (editing === "body") {
    return (
      <>
        <h4
          onClick={() => !readOnly && setEditing("title")}
          className="nodrag cursor-text text-sm font-medium leading-snug text-fg"
        >
          {object.title || "Untitled"}
        </h4>
        <textarea
          autoFocus
          defaultValue={data.body ?? ""}
          onBlur={(e) => {
            setEditing(null);
            commitBody(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(null);
          }}
          className="nodrag nopan mt-1.5 w-full resize-none rounded-sm border border-focus bg-raised px-1 text-xs text-fg-secondary focus-self"
          rows={Math.max(4, Math.min(12, Math.ceil((data.body ?? "").length / 42)))}
        />
      </>
    );
  }

  return <NoteBody object={object} {...(readOnly ? {} : { onEdit: setEditing })} />;
}
