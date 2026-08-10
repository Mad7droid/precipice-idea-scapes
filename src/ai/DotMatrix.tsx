/**
 * The waiting signal.
 *
 * A model can take several seconds before its first tool call lands, and a still screen in
 * that window reads as a broken app. This is a small dot grid with a wave running through
 * it — quiet, no bounce, no spinner. Under `prefers-reduced-motion` the global rule stops
 * the loop and the dots simply rest; the label beside it carries the meaning either way.
 */
const COLS = 3;
const ROWS = 3;

export function DotMatrix({ label }: { label?: string }) {
  return (
    <span
      className="inline-flex h-4 items-center gap-2 leading-none"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden className="grid grid-flow-col gap-[3px] leading-none">
        {Array.from({ length: COLS }, (_, col) => (
          <span key={col} className="grid gap-[3px]">
            {Array.from({ length: ROWS }, (_, row) => (
              <span
                key={row}
                className="animate-dot-wave block h-[3px] w-[3px] rounded-full bg-fg-secondary"
                // The wave travels along the diagonal, so it reads as motion across the
                // grid rather than three columns blinking in step.
                style={{ animationDelay: `${(col + row) * 90}ms` }}
              />
            ))}
          </span>
        ))}
      </span>
      {label && <span className="mono normal-case leading-none tracking-normal">{label}</span>}
    </span>
  );
}
