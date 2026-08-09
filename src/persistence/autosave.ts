import { useScapeStore } from "@/core/store";
import type { Scape, ScapeRepository } from "@/core/types";

const DEBOUNCE_MS = 300;

export interface AutosaveHandle {
  /** Writes immediately, bypassing the debounce. */
  flush: () => void;
  /** Number of snapshot writes performed. Exposed for the dev route and the tests. */
  writes: () => number;
  lastSavedAt: () => number | null;
  stop: () => void;
}

export interface AutosaveOptions {
  /**
   * False while another tab holds the scape's lease. A snapshot is the whole document, so a
   * read-only tab that wrote one would replace the holder's work with its own stale copy —
   * the exact data loss the lease exists to prevent.
   */
  canWrite?: () => boolean;
}

/**
 * Debounced full-snapshot autosave, plus an append-only action log.
 *
 * There is no Save button, so the guarantee this has to make is that anything you can see on
 * screen is either already written or will be within 300ms — and that closing the tab does
 * not cost you the last 300ms of work.
 */
export function startAutosave(
  repository: ScapeRepository,
  { canWrite }: AutosaveOptions = {},
): AutosaveHandle {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Scape | null = null;
  let seq = 0;
  let writes = 0;
  let lastSavedAt: number | null = null;
  let stopped = false;

  const write = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    const scape = pending;
    pending = null;

    // Drain regardless of whether there is a snapshot to write, so the queue cannot grow
    // unboundedly while no scape is loaded.
    const actions = useScapeStore.getState().drainActionLog();
    if (!scape) return;

    // A follower tab drains and discards. Its edits are not persisted anywhere, which is why
    // the UI is read-only while it follows; on promotion it reloads from the repository, so
    // there is nothing here worth keeping.
    if (canWrite && !canWrite()) return;

    writes += 1;
    lastSavedAt = Date.now();
    // Sequence numbers make out-of-order completion harmless: a stale write is dropped.
    void repository.saveSnapshot(scape, ++seq);
    if (actions.length) void repository.appendActions(scape.id, actions);
  };

  const unsubscribe = useScapeStore.subscribe((state, previous) => {
    if (stopped) return;
    // Only document changes matter. Selection is view state and is not persisted.
    if (state.scape === previous.scape) return;
    if (!state.scape) return;

    pending = state.scape;
    if (timer) clearTimeout(timer);
    // A node drag emits one action, but a generation emits dozens in a burst. Coalescing
    // here is what stops forty IndexedDB transactions from a single gesture.
    timer = setTimeout(write, DEBOUNCE_MS);
  });

  /**
   * Losing the last 250ms of work because someone closed a tab is the bug this exists to
   * prevent. `pagehide` and a hidden `visibilitychange` are the last reliable moments to
   * write on every platform — `beforeunload` does not fire on mobile Safari.
   */
  const onPageHide = () => write();
  const onVisibility = () => {
    if (document.visibilityState === "hidden") write();
  };

  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibility);

  return {
    flush: write,
    writes: () => writes,
    lastSavedAt: () => lastSavedAt,
    stop: () => {
      // Flush first. Leaving the editor is a navigation, not a discard, and the last edit
      // before it is routinely inside the 300ms debounce window.
      write();
      stopped = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
