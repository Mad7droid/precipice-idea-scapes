import type { ViewObject } from "@/core/viewRegistry";
import { EmptyHint, RichText } from "../ui";
import type { JourneyData } from "./schema";

/**
 * A journey's steps, rendered. Shared by the editor's `Node.tsx` and the public viewer.
 *
 * `onEdit` is the only difference between the two: with it, the title and each step label are
 * click-to-edit; without it this is inert and reaches nothing that could change a document.
 * See the note plugin's `Body.tsx` for the reasoning.
 */
export type JourneyEditField = "title" | number;

export function JourneyBody({
  object,
  onEdit,
  renderTitle,
  renderStepLabel,
}: {
  object: ViewObject;
  selected?: boolean;
  onEdit?: (field: JourneyEditField) => void;
  /** The editor substitutes an input while the title is being edited. The viewer never does. */
  renderTitle?: React.ReactNode;
  /** The editor substitutes an input for the step being edited. The viewer never does. */
  renderStepLabel?: (index: number) => React.ReactNode | undefined;
}) {
  const steps = ((object.data as Partial<JourneyData>).steps ?? []).filter(Boolean);
  const editable = onEdit ? "nodrag cursor-text" : "";

  return (
    <>
      {renderTitle ?? (
        <h4
          onClick={onEdit && (() => onEdit("title"))}
          className={`text-sm font-medium leading-snug text-fg ${editable}`}
        >
          {object.title || "Untitled"}
        </h4>
      )}
      <div className="mt-2">
        {steps.length === 0 ? (
          <EmptyHint>No steps yet</EmptyHint>
        ) : (
          /*
            Numbering is legitimate here: the order carries real information about the
            sequence a user moves through, unlike a decorative list.
          */
          <ol className="space-y-1.5">
            {steps.map((step, i) => {
              const substituted = renderStepLabel?.(i);
              return (
                <li key={step.id} className="flex gap-2 text-xs">
                  <span className="mono w-3 shrink-0 pt-px text-right normal-case tracking-normal">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    {substituted ?? (
                      <span
                        onClick={onEdit && (() => onEdit(i))}
                        className={`block text-fg-secondary ${editable}`}
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
                      <RichText
                        value={step.detail}
                        className="mt-0.5 text-2xs leading-snug text-fg-tertiary"
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </>
  );
}
