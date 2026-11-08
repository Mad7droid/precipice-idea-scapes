import { useEffect } from "react";
import { create } from "zustand";
import { SETTING_KEYS, type InterfaceStyle } from "@/core/types";
import { notify } from "@/core/notify";
import { settingsRepository } from "@/persistence/settings";
import { applyInterfaceStyle, interfaceStyle, readInterfaceStyle } from "@/design/interfaceStyle";

const useStyle = create<{ style: InterfaceStyle }>(() => ({ style: readInterfaceStyle() }));
let revision = 0;
let writes: Promise<void> = Promise.resolve();
let durableStyle = useStyle.getState().style;

/** Older queued writes cannot complete after newer ones; failures leave the queue usable. */
export function setInterfaceStyle(next: InterfaceStyle): Promise<void> {
  const style = interfaceStyle(next);
  const ticket = ++revision;
  applyInterfaceStyle(style);
  useStyle.setState({ style });
  const write = writes.then(async () => {
    await settingsRepository.set(SETTING_KEYS.interfaceStyle, style);
    durableStyle = style;
  });
  writes = write.catch(() => {});
  return write.catch(() => {
    if (ticket === revision) {
      // Earlier queued writes may have succeeded. Restore the durable choice, not an
      // optimistic choice which may itself have failed.
      applyInterfaceStyle(durableStyle);
      useStyle.setState({ style: durableStyle });
      notify.error("Could not save interface style", "Try again. Your scapes have not changed.");
    }
  });
}

/** App lifetime only: hydrate once without letting a late read undo a user's new choice. */
export function useInitializeInterfaceStyle(): void {
  useEffect(() => {
    let live = true;
    const ticket = revision;
    applyInterfaceStyle(useStyle.getState().style);
    void settingsRepository
      .get<unknown>(SETTING_KEYS.interfaceStyle)
      .then((stored) => {
        if (!live || ticket !== revision) return;
        const style = stored === undefined ? readInterfaceStyle() : interfaceStyle(stored);
        durableStyle = style;
        applyInterfaceStyle(style);
        useStyle.setState({ style });
      })
      .catch(() => {
        // The pre-paint mirror remains usable when IndexedDB is unavailable.
      });
    return () => {
      live = false;
    };
  }, []);
}

export function useInterfaceStyle(): [InterfaceStyle, typeof setInterfaceStyle] {
  return [useStyle((state) => state.style), setInterfaceStyle];
}
