import { useState } from "react";
import { useScapeStore } from "@/core/store";
import type { ScapeObject } from "@/core/types";
import { useCanvasReadOnly } from "@/canvas/readOnly";
import { JourneyBody, type JourneyEditField } from "./Body";
import type { JourneyData, JourneyStep } from "./schema";

/**
 * The editable card. Display lives in `Body.tsx`, which the public viewer also renders — this
 * file is the editing state and the dispatch around it, and nothing else.
 */
export function JourneyNode({ object }: { object: ScapeObject; selected: boolean }) {
  const steps = ((object.data as Partial<JourneyData>).steps ?? []).filter(Boolean);
  const [editing, setEditing] = useState<JourneyEditField | null>(null);
  const readOnly = useCanvasReadOnly();

  const dispatch = useScapeStore.getState().dispatchTx;

  const commitTitle = (title: string) =>
    !readOnly && dispatch([{ type: "UpdateObject", id: object.id, patch: { title } }]);

  const commitStep = (index: number, label: string) => {
    const next: JourneyStep[] = steps.map((s, i) => (i === index ? { ...s, label } : s));
    if (!readOnly) {
      dispatch([{ type: "MergeObjectData", id: object.id, data: { steps: next } }]);
    }
  };

  return (
    <JourneyBody
      object={object}
      {...(readOnly ? {} : { onEdit: setEditing })}
      {...(editing === "title"
        ? {
            renderTitle: (
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
                className="nodrag nopan min-h-7 w-full rounded-sm border border-focus bg-raised px-1.5 py-1 text-sm font-medium leading-snug text-fg focus-self"
              />
            ),
          }
        : {})}
      renderStepLabel={(i) =>
        editing === i ? (
          <input
            autoFocus
            defaultValue={steps[i]?.label ?? ""}
            onBlur={(e) => {
              setEditing(null);
              commitStep(i, e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(null);
            }}
            className="nodrag nopan min-h-6 w-full rounded-sm border border-focus bg-raised px-1.5 py-0.5 leading-snug text-fg-secondary focus-self"
          />
        ) : undefined
      }
    />
  );
}
