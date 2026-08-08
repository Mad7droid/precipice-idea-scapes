import { STARTERS, type Starter } from "@/starters";

/**
 * The starter row under the composer.
 *
 * A starter is a recipe, not an object type: picking "Mind map" does not unlock a new schema,
 * it constrains the generation to notes, switches the layout to radial and turns the
 * relationship graph on. So the cards say what you get, and the choice has to visibly change
 * the canvas or this is decoration.
 */
export function StarterPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div>
      <p className="mono px-1 pb-2">Start with</p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {STARTERS.map((starter) => (
          <button
            key={starter.id}
            type="button"
            aria-pressed={value === starter.id}
            onClick={() => onChange(starter.id)}
            title={starter.blurb}
            className={
              "flex flex-col items-start gap-2 rounded-lg border p-3 text-left " +
              "transition-colors duration-fast ease-out " +
              (value === starter.id
                ? "border-focus bg-selected"
                : "border-subtle bg-surface hover:bg-raised")
            }
          >
            <StarterMark starter={starter} active={value === starter.id} />
            <span className="text-fg">{starter.label}</span>
            <span className="text-xs text-fg-secondary">{starter.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Each mark is a diagram of the layout that starter produces: a chain for the flow, a hub for
 * the mind map, a sheet of frames for screens. They are the same information as the blurb, for
 * whoever is scanning rather than reading.
 */
function StarterMark({ starter, active }: { starter: Starter; active: boolean }) {
  const stroke = active ? "var(--accent)" : "var(--text-tertiary)";
  const common = { stroke, strokeWidth: 1.2, fill: "none" } as const;

  return (
    <svg width="28" height="20" viewBox="0 0 28 20" aria-hidden>
      {starter.id === "journey-map" && (
        <>
          <rect x="1" y="7" width="7" height="6" rx="1.5" {...common} />
          <rect x="10.5" y="7" width="7" height="6" rx="1.5" {...common} />
          <rect x="20" y="7" width="7" height="6" rx="1.5" {...common} />
          <path d="M8 10h2.5M17.5 10H20" {...common} />
        </>
      )}
      {starter.id === "mind-map" && (
        <>
          <circle cx="14" cy="10" r="3" {...common} />
          <circle cx="3.5" cy="4.5" r="2" {...common} />
          <circle cx="3.5" cy="15.5" r="2" {...common} />
          <circle cx="24.5" cy="5.5" r="2" {...common} />
          <circle cx="24.5" cy="14.5" r="2" {...common} />
          <path
            d="M11.2 8.4 5.4 5.6M11.2 11.6 5.4 14.4M16.8 8.7l5.8-2.4M16.8 11.3l5.8 2.4"
            {...common}
          />
        </>
      )}
      {starter.id === "screen-flow" && (
        <>
          <rect x="1.5" y="1.5" width="11" height="7.5" rx="1.5" {...common} />
          <rect x="15.5" y="1.5" width="11" height="7.5" rx="1.5" {...common} />
          <rect x="1.5" y="11" width="11" height="7.5" rx="1.5" {...common} />
          <rect x="15.5" y="11" width="11" height="7.5" rx="1.5" {...common} />
        </>
      )}
      {starter.id === "blank" && (
        <rect x="4" y="2" width="20" height="16" rx="2" {...common} strokeDasharray="3 2.5" />
      )}
    </svg>
  );
}
