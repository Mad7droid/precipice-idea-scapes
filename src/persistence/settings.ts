import { db, type PrecipiceDb } from "./db";
import type { SettingsRepository, ThemePreference } from "@/core/types";
import { SETTING_KEYS } from "@/core/types";

/**
 * Key/value settings.
 *
 * The Anthropic API key is stored here in plain text. That is the locked decision for v1 —
 * there is nowhere in a browser to put it that would be meaningfully safer, and pretending
 * otherwise would be security theatre. Real encryption arrives with the desktop shell and
 * the OS keychain. The settings UI says all of this plainly.
 */
export class DexieSettingsRepository implements SettingsRepository {
  constructor(private readonly database: PrecipiceDb = db) {}

  async get<T>(key: string): Promise<T | undefined> {
    return (await this.database.settings.get(key))?.value as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.database.settings.put({ key, value });
    // The theme is mirrored into localStorage purely so the inline script in index.html can
    // read it synchronously before first paint. IndexedDB is async; a flash of the wrong
    // theme is a bug, not a nitpick.
    if (key === SETTING_KEYS.theme && typeof localStorage !== "undefined") {
      localStorage.setItem("precipice.theme", String(value));
    }
  }

  async remove(key: string): Promise<void> {
    await this.database.settings.delete(key);
  }

  async all(): Promise<Record<string, unknown>> {
    const rows = await this.database.settings.toArray();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}

export const settingsRepository = new DexieSettingsRepository();

/** Applies a theme preference to the document, matching what index.html does pre-paint. */
export function applyTheme(preference: ThemePreference): void {
  const dark =
    preference === "dark" ||
    (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}
