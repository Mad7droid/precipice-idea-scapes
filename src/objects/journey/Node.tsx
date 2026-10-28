import { useState } from "react";
import { useScapeStore } from "@/core/store";
import type { ScapeObject } from "@/core/types";
import { useCanvasReadOnly } from "@/canvas/readOnly";
import { InlineTextEdit, InlineTitle } from "../InlineTitle";
import { JourneyBody, type JourneyEditField } from "./Body";
import type { JourneyData, JourneyStep } from "./schema";

/**
 * The editable card. Display lives in `Body.tsx`, which the public viewer also renders — this
 * file is the editing state and the dispatch around it, and nothing else.
 */
export function JourneyNode({ object, selected }: { object: ScapeObject; selected: boolean }) {
  const steps = ((object.data as Partial<JourneyData>).steps ?? []).filter(Boolean);
  const [editing, setEditing] = useState<JourneyEditField | null>(null);
  const readOnly = useCanvasReadOnly();

  const dispatch = useScapeStore.getState().dispatchTx;

  const commitStep = (index: number, label: string) => {
    const next: JourneyStep[] = steps.map((s, i) => (i === index ? { ...s, label } : s));
    if (!readOnly) {
      dispatch([{ type: "MergeObjectData", id: object.id, data: { steps: next } }]);
    }
  };

  return (
    <JourneyBody
      object={object}
      {...(readOnly || !selected ? {} : { onEdit: setEditing })}
      {...(editing === "title"
        ? {
            renderTitle: (
              <InlineTitle
                id={object.id}
                title={object.title}
                readOnly={readOnly}
                onDone={() => setEditing(null)}
                className="nodrag nopan min-h-7 w-full rounded-sm border border-focus bg-raised px-1.5 py-1 text-sm font-medium leading-snug text-fg focus-self"
              />
            ),
          }
        : {})}
      renderStepLabel={(i) =>
        editing === i ? (
          <InlineTextEdit
            value={steps[i]?.label ?? ""}
            ariaLabel={`Step ${i + 1}`}
            onDone={() => setEditing(null)}
            onCommit={(label) => commitStep(i, label)}
            className="nodrag nopan min-h-6 w-full rounded-sm border border-focus bg-raised px-1.5 py-0.5 leading-snug text-fg-secondary focus-self"
          />
        ) : undefined
      }
    />
  );
}
