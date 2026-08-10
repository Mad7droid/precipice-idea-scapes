import { useState } from "react";
import { useScapeStore } from "@/core/store";
import type { ScapeObject } from "@/core/types";
import { useCanvasReadOnly } from "@/canvas/readOnly";
import { EmptyHint } from "../ui";
import type { NoteData } from "./schema";

export function NoteNode({ object }: { object: ScapeObject; selected: boolean }) {
  const data = object.data as Partial<NoteData>;
  const body = data.body?.trim() ?? "";
  const [editing, setEditing] = useState<"title" | "body" | null>(null);
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
        rows={3}
      />
    );
  }

  return (
    <>
      <h4
        onClick={() => !readOnly && setEditing("title")}
        className="nodrag cursor-text text-sm font-medium leading-snug text-fg"
      >
        {object.title || "Untitled"}
      </h4>
      <div className="mt-1.5">
        {body ? (
          <p
            onClick={() => !readOnly && setEditing("body")}
            className="nodrag cursor-text text-xs text-fg-secondary"
          >
            {body}
          </p>
        ) : (
          <span onClick={() => !readOnly && setEditing("body")} className="nodrag cursor-text">
            <EmptyHint>No body yet</EmptyHint>
          </span>
        )}
      </div>
    </>
  );
}
