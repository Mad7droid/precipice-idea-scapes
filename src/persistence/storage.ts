import { notify } from "@/core/notify";

/**
 * Keeping the browser from throwing the user's work away.
 *
 * IndexedDB is "best effort" storage by default: under disk pressure a browser may evict a
 * whole origin without asking and without telling anyone afterwards. For an app whose pitch is
 * that your thinking is still there when you come back, that is not an edge case, it is the
 * product failing. `navigator.storage.persist()` moves the origin to "persistent", which
 * browsers exempt from automatic eviction.
 */

/** What the browser said. `unsupported` is Safari before 17 and any non-secure context. */
export type PersistenceState = "persisted" | "denied" | "unsupported";

/**
 * Ask once for durable storage.
 *
 * Chrome grants this silently based on engagement signals; Firefox shows a permission prompt.
 * That prompt is the reason this is called after the user creates their first scape rather
 * than on first paint: a storage permission dialog over an empty screen, before the app has
 * done anything, is asking someone to vouch for a product they have not seen yet.
 */
export async function requestPersistence(): Promise<PersistenceState> {
  const storage = globalThis.navigator?.storage;
  if (!storage?.persist || !storage.persisted) return "unsupported";
  try {
    if (await storage.persisted()) return "persisted";
    return (await storage.persist()) ? "persisted" : "denied";
  } catch {
    // A browser that refuses to answer is not a reason to fail the action the user asked for.
    return "unsupported";
  }
}

/** Fraction of the origin's quota in use, or null when the browser will not estimate. */
export async function storagePressure(): Promise<number | null> {
  const storage = globalThis.navigator?.storage;
  if (!storage?.estimate) return null;
  try {
    const { usage, quota } = await storage.estimate();
    if (!usage || !quota) return null;
    return usage / quota;
  } catch {
    return null;
  }
}

/**
 * Warn before the write that fails, not after.
 *
 * `DexieScapeRepository` already surfaces `QuotaExceededError`, but by then the save has been
 * lost and the user is being told about it mid-edit. This runs at boot instead.
 */
const WARN_ABOVE = 0.9;

export async function warnIfStorageTight(): Promise<void> {
  const pressure = await storagePressure();
  if (pressure === null || pressure < WARN_ABOVE) return;
  notify.error(
    "This browser is nearly out of storage",
    "Export the scapes you want to keep, then delete the ones you no longer need.",
  );
}
