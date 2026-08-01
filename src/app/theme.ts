import { useCallback, useEffect, useState } from "react";
import { SETTING_KEYS, type ThemePreference } from "@/core/types";
import { applyTheme, settingsRepository } from "@/persistence/settings";

/** Mirrored by the settings repository so index.html can read it before first paint. */
const MIRROR_KEY = "precipice.theme";

function storedPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* private mode — fall through to system */
  }
  return "system";
}

/**
 * The theme preference, applied to the document and persisted.
 *
 * All the plumbing already existed — `applyTheme`, the localStorage mirror, the pre-paint
 * script in index.html — but nothing in the app ever set it, so the theme was whatever the
 * OS happened to be and there was no way to change it. This hook is that missing wire.
 */
function resolve(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme(): [ThemePreference, (next: ThemePreference) => void, "light" | "dark"] {
  // Seeded from the same mirror the pre-paint script reads, so the control renders in the
  // right state on the first frame rather than flipping once IndexedDB answers.
  const [preference, setPreference] = useState<ThemePreference>(storedPreference);
  /** The preference collapsed to an actual theme — what anything that needs a concrete
   * light/dark answer (React Flow's own colour mode) has to be told. */
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(storedPreference()));

  useEffect(() => {
    void settingsRepository.get<ThemePreference>(SETTING_KEYS.theme).then((stored) => {
      const next = stored ?? storedPreference();
      setPreference(next);
      setResolved(resolve(next));
      applyTheme(next);
    });
  }, []);

  // "System" is a live subscription, not a one-time read: flipping the OS theme with the app
  // open should move the app with it.
  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyTheme("system");
      setResolved(resolve("system"));
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const set = useCallback((next: ThemePreference) => {
    setPreference(next);
    setResolved(resolve(next));
    applyTheme(next);
    void settingsRepository.set(SETTING_KEYS.theme, next);
  }, []);

  return [preference, set, resolved];
}
