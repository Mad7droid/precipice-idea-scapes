/**
 * The app's one dropdown.
 *
 * A native `<select>` draws its own disclosure arrow, positioned by the platform, hard against
 * the control's padding box. With symmetric horizontal padding that arrow ends up crowding the
 * right border and the control reads like an accident. `appearance-none` is the only way to
 * take that back, so the chevron here is ours: reserved space on the right, an SVG that
 * inherits colour, and `pointer-events-none` so the whole control still opens on click.
 */

export type SelectVariant = "field" | "pill";

export interface SelectOption {
  value: string;
  label: string;
  title?: string;
}

const BASE =
  "appearance-none cursor-pointer bg-none pr-7 transition-colors duration-instant ease-out " +
  // The field lights up its own border on focus, so it opts out of the global focus ring.
  // See the `.focus-self` comment in tokens.css for why suppressing the outline alone is a trap.
  "focus-self disabled:cursor-default disabled:opacity-40";

const VARIANTS: Record<SelectVariant, string> = {
  field: "rounded-md border border-subtle bg-inset pl-2.5 py-1.5 text-fg focus:border-focus",
  pill:
    "mono rounded-full border border-subtle bg-transparent pl-2.5 py-1 normal-case " +
    "tracking-normal text-fg-secondary hover:bg-hover hover:text-fg",
};

export function Select({
  label,
  value,
  onChange,
  options,
  disabled,
  variant = "field",
  className = "",
}: {
  /** Accessible name. Rendered as `aria-label`, so pair it with a visible label when there
   * is one. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  variant?: SelectVariant;
  className?: string;
}) {
  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${BASE} ${VARIANTS[variant]} w-full`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} title={option.title}>
            {option.label}
          </option>
        ))}
      </select>
      <SelectChevron />
    </span>
  );
}

/** The chevron, sitting in the space `pr-7` reserved for it. */
export function SelectChevron() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden
      className="pointer-events-none absolute right-2.5 text-fg-tertiary"
    >
      <path
        d="M2 4l3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
