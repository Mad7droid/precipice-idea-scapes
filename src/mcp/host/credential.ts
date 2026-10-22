import { isDesktop } from "@/desktop/runtime";
import { readSession } from "@/publish/session";
export type HostCredential = { token: string; expiresAt: number };
const KEY = "precipice.agent.hostCredential";
/** Not a secret: whether the Mac app has a saved host sign-in worth reading from Keychain. */
const DESKTOP_SIGNED_IN = "precipice.agent.desktopSignedIn";
let desktopCredential: HostCredential | null = null;
export function hostToken(): string | null {
  if (isDesktop()) return desktopCredential?.token ?? null;
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as HostCredential | null;
    if (stored?.token) return stored.token;
  } catch {
    /* no saved host */
  }
  return readSession()?.token ?? null;
}
/**
 * The token publishing calls use. The Mac app cannot run Turnstile or Google OAuth inside its
 * webview, so it publishes with the Keychain host credential from the system-browser sign-in;
 * the Worker limits that credential to publication endpoints.
 */
export function publishToken(): string | null {
  return isDesktop() ? (desktopCredential?.token ?? null) : (readSession()?.token ?? null);
}

export const HOST_AUTH_EVENT = "precipice-agent-auth";

export async function saveHostCredential(value: HostCredential | null) {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_agent_session", { value: value ? JSON.stringify(value) : null });
    desktopCredential = value;
    try {
      localStorage.setItem(DESKTOP_SIGNED_IN, value ? "1" : "0");
    } catch {
      /* the next launch reads Keychain once to find out */
    }
  } else {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  }
  window.dispatchEvent(new Event(HOST_AUTH_EVENT));
}
/**
 * Restores the Mac host sign-in. Skipped when the app knows there is none, so launching
 * without an agent sign-in never prompts for Keychain access.
 */
export async function loadHostCredential() {
  if (!isDesktop()) return;
  let signedIn: string | null = null;
  try {
    signedIn = localStorage.getItem(DESKTOP_SIGNED_IN);
  } catch {
    /* unknown: read Keychain to find out */
  }
  if (signedIn === "0") return;
  const { invoke } = await import("@tauri-apps/api/core");
  const value = await invoke<string | null>("read_agent_session");
  desktopCredential = value ? JSON.parse(value) : null;
  try {
    localStorage.setItem(DESKTOP_SIGNED_IN, value ? "1" : "0");
  } catch {
    /* unavailable */
  }
  window.dispatchEvent(new Event(HOST_AUTH_EVENT));
}
