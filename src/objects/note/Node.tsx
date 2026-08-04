import { useState } from "react";
import { useScapeStore } from "@/core/store";
import type { ScapeObject } from "@/core/types";
import { EmptyHint } from "../ui";
import type { NoteData } from "./schema";

export function NoteNode({ object }: { object: ScapeObject; selected: boolean }) {
  const data = object.data as Partial<NoteData>;
  const body = data.body?.trim() ?? "";
  const [editing, setEditing] = useState<"title" | "body" | null>(null);

  const commit = (patch: { title?: string } | { data: Partial<NoteData> }) =>
    useScapeStore.getState().dispatchTx([{ type: "UpdateObject", id: object.id, patch }]);

  if (editing === "title") {
    return (
      <input
        autoFocus
        defaultValue={object.title}
        onBlur={(e) => {
          setEditing(null);
          commit({ title: e.currentTarget.value });
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
          commit({ data: { body: e.currentTarget.value } });
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
        onClick={() => setEditing("title")}
        className="nodrag cursor-text text-sm font-medium leading-snug text-fg"
      >
        {object.title || "Untitled"}
      </h4>
      <div className="mt-1.5">
        {body ? (
          <p
            onClick={() => setEditing("body")}
            className="nodrag cursor-text text-xs text-fg-secondary"
          >
            {body}
          </p>
        ) : (
          <span onClick={() => setEditing("body")} className="nodrag cursor-text">
            <EmptyHint>No body yet</EmptyHint>
          </span>
        )}
      </div>
    </>
  );
}
