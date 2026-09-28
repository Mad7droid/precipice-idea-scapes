import { isDesktop } from "@/desktop/runtime";
import { readSession } from "@/publish/session";
export type HostCredential = { token: string; expiresAt: number };
const KEY = "precipice.agent.hostCredential";
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
export async function saveHostCredential(value: HostCredential | null) {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_agent_session", { value: value ? JSON.stringify(value) : null });
    desktopCredential = value;
  } else {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  }
}
export async function loadHostCredential() {
  if (!isDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const value = await invoke<string | null>("read_agent_session");
  desktopCredential = value ? JSON.parse(value) : null;
}
