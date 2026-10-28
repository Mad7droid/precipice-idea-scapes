/**
 * Snapshot write sequence shared by every writer in this tab.
 *
 * Repositories drop a snapshot whose sequence is not newer than the last one they applied
 * (see `ScapeRepository.saveSnapshot`). That map outlives any single editor session, so a
 * counter that restarted at 1 per session — or a one-off write keyed on `Date.now()` — would
 * leave later autosaves looking stale and silently dropped. One module-level counter, seeded
 * from the clock in microseconds, is strictly increasing across sessions and always ahead of
 * any legacy millisecond-timestamp sequence.
 */
let last = 0;

export function nextSnapshotSeq(): number {
  last = Math.max(last + 1, Date.now() * 1000);
  return last;
}
