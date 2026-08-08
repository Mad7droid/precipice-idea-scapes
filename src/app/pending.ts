import type { ActionPayload } from "@/core/actions";

/**
 * What the home page decided, handed to the editor that is about to open.
 *
 * Creating a scape navigates to it, so both a brief and a starter's seed have to survive one
 * route change. A module-level box is the honest way to do that with a hash router: the
 * alternative is a query parameter, which puts a paragraph of the user's prose in the URL bar
 * and in their history.
 *
 * The seed cannot simply be dispatched before navigating. Autosave only runs inside the
 * editor, so a seed applied on the home page is written to a store that is about to be
 * reloaded from a repository that never saw it — the object appears for one frame and is gone.
 * Handing it over and dispatching it after boot puts it on the normal persistence path.
 *
 * Written once, read once. `take` clears it so a refresh does not re-run a generation the user
 * has already paid for, or re-seed a canvas they deliberately emptied.
 */
export interface PendingWork {
  request?: string;
  seed?: ActionPayload[];
}

let pending: PendingWork | null = null;

export function setPendingWork(work: PendingWork): void {
  pending = work;
}

export function takePendingWork(): PendingWork | null {
  const work = pending;
  pending = null;
  return work;
}
