import type { ScapeObject } from "@/core/types";
import { EmptyHint } from "../ui";
import { VISIBLE_STEPS, type JourneyData } from "./schema";

export function JourneyNode({ object }: { object: ScapeObject; selected: boolean }) {
  const steps = ((object.data as Partial<JourneyData>).steps ?? []).filter(Boolean);
  const shown = steps.slice(0, VISIBLE_STEPS);
  const overflow = steps.length - shown.length;

  return (
    <>
      <h4 className="text-sm font-medium leading-snug text-fg">{object.title || "Untitled"}</h4>
      <div className="lod-body mt-2">
        {steps.length === 0 ? (
          <EmptyHint>No steps yet</EmptyHint>
        ) : (
          <>
            {/*
              Numbering is legitimate here: the order carries real information about the
              sequence a user moves through, unlike a decorative list.
            */}
            <ol className="space-y-1">
              {shown.map((step, i) => (
                <li key={step.id} className="flex gap-2 text-xs">
                  <span className="mono w-3 shrink-0 pt-px text-right normal-case tracking-normal">
                    {i + 1}
                  </span>
                  <span className="line-clamp-1 text-fg-secondary">{step.label}</span>
                </li>
              ))}
            </ol>
            {overflow > 0 && (
              <p className="mt-1 pl-5 text-xs text-fg-tertiary">+{overflow} more</p>
            )}
          </>
        )}
      </div>
    </>
  );
}
