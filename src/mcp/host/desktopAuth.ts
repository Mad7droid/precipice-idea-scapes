import { notify } from "@/core/notify";
import { MCP_ORIGIN } from "./relay";
import { hostToken, saveHostCredential, type HostCredential } from "./credential";
const PENDING = "precipice.agent.pkce";
export async function startDesktopSignIn() {
  const verifier = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const challenge = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  sessionStorage.setItem(PENDING, JSON.stringify({ verifier, at: Date.now() }));
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_agent_signin", { url: `${MCP_ORIGIN}/host/start?challenge=${challenge}` });
}
export async function listenDesktopSignIn(onConnected: () => void) {
  const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
  let completing = false;
  const receive = async (urls: string[]) => {
    for (const raw of urls) {
      const url = new URL(raw);
      if (
        url.protocol !== "precipice:" ||
        url.host !== "auth" ||
        url.pathname !== "/callback" ||
        completing
      )
        continue;
      const saved = JSON.parse(sessionStorage.getItem(PENDING) ?? "null") as {
        verifier: string;
        at: number;
      } | null;
      if (!saved || Date.now() - saved.at > 10 * 60_000) continue;
      completing = true;
      try {
        const response = await fetch(`${MCP_ORIGIN}/host/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: url.searchParams.get("code"), verifier: saved.verifier }),
        });
        if (!response.ok) throw new Error("Sign-in expired. Try connecting this Mac again.");
        await saveHostCredential((await response.json()) as HostCredential);
        sessionStorage.removeItem(PENDING);
        onConnected();
        notify.success(
          "Signed in on this Mac.",
          "You can publish scapes and connect agents to the desktop library.",
        );
      } catch (error) {
        notify.error("Could not connect this Mac.", String(error));
      } finally {
        completing = false;
      }
    }
  };
  const stop = await onOpenUrl((urls) => void receive(urls));
  const initial = await getCurrent();
  if (initial) await receive(initial);
  return stop;
}

/** Revokes this Mac's credential on the server (best effort) and forgets it from the Keychain. */
export async function signOutDesktop() {
  const token = hostToken();
  if (token)
    await fetch(`${MCP_ORIGIN}/host/session`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  await saveHostCredential(null);
}
