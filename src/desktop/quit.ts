/**
 * Flush-before-quit for the Mac app. On Cmd+Q or closing the window, the native side emits
 * `app://flush-before-quit`, waits up to 1.5s for `quit_ready`, then exits regardless.
 * Editors register a flush (for example the autosave flush) while they are mounted.
 */

type Flush = () => Promise<unknown> | unknown;

const flushes = new Set<Flush>();

/** Registers a flush to run before the app quits. Returns an unregister function. */
export function registerQuitFlush(flush: Flush): () => void {
  flushes.add(flush);
  return () => flushes.delete(flush);
}

/** Runs every registered flush; one failing flush never blocks the others. */
export async function runQuitFlushes(): Promise<void> {
  await Promise.allSettled([...flushes].map(async (flush) => flush()));
}

export async function listenForQuit(): Promise<() => void> {
  const [{ listen }, { invoke }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/core"),
  ]);
  return listen("app://flush-before-quit", () => {
    void runQuitFlushes().finally(() => void invoke("quit_ready").catch(() => undefined));
  });
}
