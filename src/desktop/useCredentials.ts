import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./runtime";
import { isKeychainDenied } from "./keychain";

/**
 * One desktop credential. Each has its own restricted Tauri commands; the native side keeps
 * them all in one Keychain item so macOS asks at most once per launch.
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

/**
 * `enabled` defers the Keychain read until the credential is actually needed, so a feature
 * nobody uses never causes a Keychain prompt.
 */
export function useCredentials(spec: CredentialSpec = ANTHROPIC_CREDENTIAL, enabled = true) {
  const desktop = isDesktop();
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const revision = useRef(0);
  const locked = useRef(false);
  const ready = !desktop || !enabled || loaded;

  useEffect(() => {
    if (!desktop || !enabled) return;
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
        setDenied(false);
        setError("");
        if (revision.current === version) setKey(value ?? "");
      })
      .catch((failure) => {
        if (!active) return;
        setDenied(isKeychainDenied(failure));
        setError(
          isKeychainDenied(failure)
            ? "Precipice needs Keychain access to use your saved key."
            : "Could not read Keychain. Unlock your login keychain and try again.",
        );
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [desktop, spec, enabled, attempt]);

  /** Reads the saved key again, after Keychain access is allowed. */
  const reload = () => {
    setLoaded(false);
    setAttempt((value) => value + 1);
  };

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
    } catch (failure) {
      setDenied(isKeychainDenied(failure));
      setError(
        isKeychainDenied(failure)
          ? "Precipice needs Keychain access to save or remove keys."
          : value === null
            ? "Could not remove the saved key. It is still in Keychain. Unlock your login keychain and try again."
            : "Could not save the replacement in Keychain. The previous saved key, if any, is unchanged.",
      );
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return { desktop, key, change, saved, ready, busy, error, denied, persist, reload };
}
export type DesktopCredentials = ReturnType<typeof useCredentials>;
