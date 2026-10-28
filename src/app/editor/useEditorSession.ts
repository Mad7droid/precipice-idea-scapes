import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { notify } from "@/core/notify";
import { useScapeStore } from "@/core/store";
import { SETTING_KEYS } from "@/core/types";
import type { CanvasCommands } from "@/canvas/Canvas";
import { registerLiveScape } from "@/mcp/host/host";
import { liveEditor } from "@/mcp/host/liveEditor";
import { startAutosave, type AutosaveHandle } from "@/persistence/autosave";
import { acquireScapeLease, type ScapeLease } from "@/persistence/lease";
import { scapeRepository } from "@/persistence/scapeRepository";
import { settingsRepository } from "@/persistence/settings";
import { registerQuitFlush } from "@/desktop/quit";
import { navigate } from "../router";

/**
 * The editor's session with one scape: the cross-tab write lease, autosave, the initial load,
 * and registration with the local agent host. Everything here outlives individual renders.
 */
export function useEditorSession(
  scapeId: string,
  commands: MutableRefObject<CanvasCommands | null>,
) {
  const [booted, setBooted] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [takingOver, setTakingOver] = useState(false);
  const autosave = useRef<AutosaveHandle | null>(null);
  const lease = useRef<ScapeLease | null>(null);
  /** Identifies this tab to the other tabs, and breaks ties when two claim at once. */
  const tabId = useRef(`tab_${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    if (!booted || readOnly) return;
    return registerLiveScape(
      scapeId,
      liveEditor({
        scapeId,
        canWrite: () => lease.current?.status() === "holder",
        flush: async () => {
          await autosave.current?.flush();
        },
        focus: (ids) => {
          useScapeStore.getState().setSelection(ids);
          if (ids[0]) commands.current?.focus(ids[0]);
        },
      }),
    );
  }, [scapeId, booted, readOnly, commands]);

  // Boot: claim the scape's write lease, start autosave, load the scape named in the route.
  useEffect(() => {
    let cancelled = false;

    const reload = async () => {
      const fresh = await scapeRepository.get(scapeId);
      if (!cancelled && fresh) useScapeStore.getState().loadScape(fresh);
    };

    lease.current = acquireScapeLease({
      scapeId,
      holderId: tabId.current,
      // Flush before the other tab reads. Autosave still holds the lease at this point, by
      // construction — the lease downgrades only after this returns.
      onYield: () => autosave.current?.flush(),
      onChange: (status, change) => {
        if (cancelled) return;
        setReadOnly(status === "follower");
        if (status === "holder" && change === "promoted") {
          // Whatever this tab has in memory is older than what the outgoing holder just
          // wrote. Read theirs before writing anything, or the handover loses their edits.
          void reload();
          setTakingOver(false);
        }
      },
    });

    autosave.current = startAutosave(scapeRepository, {
      canWrite: () => lease.current?.status() === "holder",
    });
    // Quitting the Mac app must not drop the last debounce window of edits.
    const off = registerQuitFlush(() => autosave.current?.flush());

    void (async () => {
      const loaded = await scapeRepository.get(scapeId);
      if (cancelled) return;
      if (!loaded) {
        notify.error("That scape is gone", "It may have been deleted in another tab.");
        navigate("/");
        return;
      }
      useScapeStore.getState().loadScape(loaded);
      await settingsRepository.set(SETTING_KEYS.lastScapeId, scapeId);
      setBooted(true);
    })();

    return () => {
      cancelled = true;
      off();
      autosave.current?.stop();
      autosave.current = null;
      // Order matters: the flush inside stop() has to land while this tab still holds the
      // lease, because releasing it lets another tab read immediately.
      lease.current?.stop();
      lease.current = null;
    };
  }, [scapeId]);

  const takeOver = async () => {
    setTakingOver(true);
    await lease.current?.takeOver();
  };

  return { booted, readOnly, takingOver, takeOver };
}
