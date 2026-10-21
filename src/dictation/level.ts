/** Per-session signal. Only the meter subscribes, keeping audio ticks out of the composer. */
export function createLevelSignal() {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next: number) => {
      const safe = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 0;
      if (safe === value) return;
      value = safe;
      listeners.forEach((listener) => listener());
    },
  };
}
export type LevelSignal = ReturnType<typeof createLevelSignal>;
