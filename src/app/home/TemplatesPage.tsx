import { getPlugin } from "@/core/registry";
import { Button } from "@/design/Button";
import { STARTERS, type Starter } from "@/starters";
import { PageHeader } from "./PageHeader";
import { StarterMark } from "./StarterMark";

/**
 * Every template, with what it actually does. Generated from the starter data the editor and
 * the AI read, so the page cannot promise something the canvas will not do.
 */
export function TemplatesPage({
  busy,
  onUse,
  onStartEmpty,
}: {
  busy: boolean;
  /** Pick this template on Home and put the cursor in the prompt. */
  onUse: (starter: Starter) => void;
  onStartEmpty: (starter: Starter) => void;
}) {
  return (
    <>
      <PageHeader title="Templates">Pick a starting shape. You can add any block later.</PageHeader>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {STARTERS.map((starter) => {
          const focus = starter.types.map((type) => getPlugin(type)).filter((plugin) => !!plugin);
          return (
            <li
              key={starter.id}
              className="group flex flex-col rounded-xl border border-subtle bg-surface transition-colors duration-instant ease-out hover:border-default"
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => onUse(starter)}
                className="grid h-28 place-items-center rounded-t-xl bg-inset [&_svg]:h-10 [&_svg]:w-14"
                aria-label={`Use ${starter.label} with AI`}
              >
                <StarterMark starter={starter} active={false} />
              </button>
              <div className="flex flex-1 flex-col p-4">
                <h2 className="text-sm font-medium text-fg">{starter.label}</h2>
                <p className="mt-0.5 text-xs text-fg-secondary">{starter.blurb}</p>
                <div className="mt-3 flex flex-wrap gap-1.5 text-2xs text-fg-secondary">
                  {focus.map((plugin) => (
                    <span
                      key={plugin.type}
                      className="inline-flex items-center gap-1 rounded-full bg-inset px-2 py-0.5"
                    >
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: `var(${plugin.color})` }}
                      />
                      {plugin.label}s
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex gap-2 pt-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => onUse(starter)}
                  >
                    Use with AI
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    title={`Starts with ${starter.startsWith.toLowerCase()}`}
                    onClick={() => onStartEmpty(starter)}
                  >
                    Start empty
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
