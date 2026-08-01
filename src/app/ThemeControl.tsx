import type { ThemePreference } from "@/core/types";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/**
 * Three explicit states, not a two-state toggle that silently drops the "follow my OS"
 * option. One click reaches any of them — nothing is hidden behind a cycle.
 */
export function ThemeControl({
  value,
  onChange,
  compact = false,
}: {
  value: ThemePreference;
  onChange: (next: ThemePreference) => void;
  /** Icon-only, for the sidebar footer where there is no room for words. */
  compact?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-full border border-subtle bg-inset p-0.5"
    >
      {OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={
              "flex flex-1 items-center justify-center gap-1.5 rounded-full transition-colors " +
              "duration-instant ease-out " +
              (compact ? "px-2 py-1 " : "px-2.5 py-1 ") +
              (active
                ? "bg-raised text-fg shadow-sm"
                : "text-fg-tertiary hover:text-fg-secondary")
            }
          >
            <ThemeIcon preference={option.value} />
            {!compact && <span className="text-xs">{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "light") {
    return (
      <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden fill="none">
        <circle cx="7" cy="7" r="2.9" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M7 .8v1.6M7 11.6v1.6M13.2 7h-1.6M2.4 7H.8M11.4 2.6l-1.1 1.1M3.7 10.3l-1.1 1.1M11.4 11.4l-1.1-1.1M3.7 3.7L2.6 2.6"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (preference === "dark") {
    return (
      <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden fill="none">
        <path
          d="M12 8.5A5.4 5.4 0 0 1 5.5 2 5.5 5.5 0 1 0 12 8.5Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden fill="none">
      <rect x="1.2" y="2.2" width="11.6" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.8 12.4h4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
