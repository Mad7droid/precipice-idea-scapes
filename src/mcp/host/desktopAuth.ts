import { notify } from "@/core/notify";
import { MCP_ORIGIN } from "./relay";
import { saveHostCredential, type HostCredential } from "./credential";
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
        window.dispatchEvent(new Event("precipice-agent-auth"));
        notify.success(
          "This Mac is connected.",
          "Choose the desktop library when connecting your agent.",
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
