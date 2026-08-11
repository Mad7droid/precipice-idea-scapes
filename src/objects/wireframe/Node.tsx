import { useState } from "react";
import { useScapeStore } from "@/core/store";
import type { ScapeObject } from "@/core/types";
import { useCanvasReadOnly } from "@/canvas/readOnly";
import { WireframeBody } from "./Body";

/**
 * The editable card. Display lives in `Body.tsx`, which the public viewer also renders — this
 * file is the title's editing state and the dispatch around it, and nothing else. The
 * primitives have never been editable on the card; they belong to the inspector.
 */
export function WireframeNode({ object }: { object: ScapeObject; selected: boolean }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const readOnly = useCanvasReadOnly();

  return (
    <WireframeBody
      object={object}
      {...(readOnly ? {} : { onEdit: () => setEditingTitle(true) })}
      {...(editingTitle
        ? {
            renderTitle: (
              <input
                autoFocus
                defaultValue={object.title}
                onBlur={(e) => {
                  setEditingTitle(false);
                  if (!readOnly) {
                    useScapeStore
                      .getState()
                      .dispatchTx([
                        {
                          type: "UpdateObject",
                          id: object.id,
                          patch: { title: e.currentTarget.value },
                        },
                      ]);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                className="nodrag nopan w-full rounded-sm border border-focus bg-raised px-1 text-sm font-medium text-fg focus-self"
              />
            ),
          }
        : {})}
    />
  );
}
