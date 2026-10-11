import { Scapi } from "./Scapi";

/** A quiet cream backing keeps orange Scapi distinct from the action button in both themes. */
export function ScapiActionIcon() {
  return (
    <span
      aria-hidden
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--ash-50)]"
    >
      <Scapi size={24} animated={false} effects={false} />
    </span>
  );
}
