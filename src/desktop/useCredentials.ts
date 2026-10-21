import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./runtime";

/**
 * One Keychain-backed credential. Each has its own restricted Tauri commands and its own
 * Keychain item, so granting the TypeSafe key never widens what can read the Anthropic one.
 */
export interface CredentialSpec {
  read: string;
  save: string;
  remove: string;
  /** A browser-session copy from before the desktop app, cleared rather than migrated. */
  legacySessionKey?: string;
}

export const ANTHROPIC_CREDENTIAL: CredentialSpec = {
  read: "read_api_key",
  save: "save_api_key",
  remove: "remove_api_key",
  legacySessionKey: "anthropic.apiKey",
};

export const TYPESAFE_CREDENTIAL: CredentialSpec = {
  read: "read_typesafe_key",
  save: "save_typesafe_key",
  remove: "remove_typesafe_key",
};

export function useCredentials(spec: CredentialSpec = ANTHROPIC_CREDENTIAL) {
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
      if (spec.legacySessionKey) sessionStorage.removeItem(spec.legacySessionKey);
    } catch {
      /* unavailable */
    }
    void invoke<string | null>(spec.read)
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
  }, [desktop, spec]);

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
      if (value === null) await invoke(spec.remove);
      else await invoke(spec.save, { key: value.trim() });
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
