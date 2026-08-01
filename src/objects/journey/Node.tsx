import { useState } from "react";
import { useScapeStore } from "@/core/store";
import type { ScapeObject } from "@/core/types";
import { EmptyHint, ExpandToggle } from "../ui";
import { VISIBLE_STEPS, type JourneyData, type JourneyStep } from "./schema";

export function JourneyNode({ object }: { object: ScapeObject; selected: boolean }) {
  const steps = ((object.data as Partial<JourneyData>).steps ?? []).filter(Boolean);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? steps : steps.slice(0, VISIBLE_STEPS);
  const overflow = steps.length - shown.length;
  const [editing, setEditing] = useState<"title" | number | null>(null);

  const dispatch = useScapeStore.getState().dispatchTx;

  const commitTitle = (title: string) =>
    dispatch([{ type: "UpdateObject", id: object.id, patch: { title } }]);

  const commitStep = (index: number, label: string) => {
    const next: JourneyStep[] = steps.map((s, i) => (i === index ? { ...s, label } : s));
    dispatch([{ type: "UpdateObject", id: object.id, patch: { data: { steps: next } } }]);
  };

  return (
    <>
      {editing === "title" ? (
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
      ) : (
        <h4
          onClick={() => setEditing("title")}
          className="nodrag cursor-text text-sm font-medium leading-snug text-fg"
        >
          {object.title || "Untitled"}
        </h4>
      )}
      <div className="lod-body mt-2">
        {steps.length === 0 ? (
          <EmptyHint>No steps yet</EmptyHint>
        ) : (
          <>
            {/*
              Numbering is legitimate here: the order carries real information about the
              sequence a user moves through, unlike a decorative list.
            */}
            <ol className="space-y-1.5">
              {shown.map((step, i) => (
                <li key={step.id} className="flex gap-2 text-xs">
                  <span className="mono w-3 shrink-0 pt-px text-right normal-case tracking-normal">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    {editing === i ? (
                      <input
                        autoFocus
                        defaultValue={step.label}
                        onBlur={(e) => {
                          setEditing(null);
                          commitStep(i, e.currentTarget.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditing(null);
                        }}
                        className="nodrag nopan w-full rounded-sm border border-focus bg-raised px-1 text-fg-secondary focus-self"
                      />
                    ) : (
                      <span
                        onClick={() => setEditing(i)}
                        className={
                          "nodrag block cursor-text text-fg-secondary " +
                          (expanded ? "" : "line-clamp-1")
                        }
                      >
                        {step.label}
                      </span>
                    )}
                    {/*
                      The detail was previously inspector-only, which meant the card showed
                      an outline and the actual content lived somewhere you had to click to
                      reach. If it was worth writing, it is worth showing.
                    */}
                    {step.detail && (
                      <span
                        className={
                          "mt-0.5 block text-2xs leading-snug text-fg-tertiary " +
                          (expanded ? "" : "line-clamp-1")
                        }
                      >
                        {step.detail}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <ExpandToggle
              expanded={expanded}
              hiddenCount={overflow}
              canExpand={steps.some((s) => s.detail)}
              onToggle={() => setExpanded((e) => !e)}
              moreLabel="steps"
            />
          </>
        )}
      </div>
    </>
  );
}
