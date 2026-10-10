import { InstructionsField } from "@/ai/Instructions";
import { MAX_INSTRUCTIONS } from "@/core/types";
import { PageHeader } from "./PageHeader";

const SUGGESTIONS = [
  "Write in British English.",
  "Keep every note under 60 words.",
  "Turn assumptions into open-question notes rather than stating them as fact.",
  "Name screens after what the person is doing, not the feature.",
];

/**
 * Standing instructions for every generation in this library. Says plainly where they apply
 * and where they do not, because a rule that silently does nothing is worse than no rule.
 */
export function InstructionsPage({
  value,
  onChange,
  where,
}: {
  value: string;
  onChange: (next: string) => void;
  where: string;
}) {
  const add = (line: string) => onChange(value.trim() ? `${value.trim()}\n${line}` : line);
  return (
    <>
      <PageHeader title="Instructions">
        Rules AI follows in every scape {where}. Saved as you type.
      </PageHeader>
      <div className="grid max-w-4xl gap-6 lg:grid-cols-[1fr_14rem]">
        <div>
          <label htmlFor="library-instructions" className="mb-2 block text-sm text-fg">
            Instructions for every scape
          </label>
          <InstructionsField
            id="library-instructions"
            value={value}
            onChange={onChange}
            maxLength={MAX_INSTRUCTIONS}
            rows={10}
            placeholder="For example: Write for a fintech audience. Prefer short notes. Flag every risk as its own note."
          />
          <div className="mt-3" />
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.filter((line) => !value.includes(line)).map((line) => (
              <button
                key={line}
                type="button"
                onClick={() => add(line)}
                className="rounded-full border border-subtle px-3 py-1 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
              >
                + {line}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs leading-5 text-fg-tertiary">
          Applies to AI drafts and Scapi. Agents use each scape’s own instructions, set from its
          composer.
        </p>
      </div>
    </>
  );
}
