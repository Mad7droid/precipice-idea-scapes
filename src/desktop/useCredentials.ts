import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./runtime";

export function useCredentials() {
  const desktop = isDesktop();
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(!desktop);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const locked = useRef(false);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    const version = revision.current;
    // Desktop credentials never go into WebKit's browser storage.
    try {
      sessionStorage.removeItem("anthropic.apiKey");
    } catch {
      /* unavailable */
    }
    void invoke<string | null>("read_api_key")
      .then((value) => {
        if (!active) return;
        setSaved(value !== null);
        if (revision.current === version) setKey(value ?? "");
      })
      .catch(() => {
        if (active)
          setError(
            "Could not read Keychain. Unlock your login keychain and reopen the app, or use a key for this session.",
          );
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [desktop]);

  const change = (value: string) => {
    revision.current++;
    setKey(value);
  };

  const persist = async (value: string | null): Promise<boolean> => {
    if (!desktop || !ready || locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      if (value === null) await invoke("remove_api_key");
      else await invoke("save_api_key", { key: value.trim() });
      setSaved(value !== null);
      change(value?.trim() ?? "");
      return true;
    } catch {
      setError(
        value === null
          ? "Could not remove the saved key. It is still in Keychain. Unlock your login keychain and try again."
          : "Could not save the replacement in Keychain. The previous saved key, if any, is unchanged.",
      );
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return { desktop, key, change, saved, ready, busy, error, persist };
}
export type DesktopCredentials = ReturnType<typeof useCredentials>;
