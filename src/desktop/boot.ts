import { installExternalLinks } from "@/desktop/external";
import { listenForQuit } from "@/desktop/quit";

let booted = false;

/** Desktop-only global hooks, installed once at startup (see runtime.ts). */
export function bootDesktop() {
  if (booted) return;
  booted = true;
  installExternalLinks();
  void listenForQuit().catch(() => undefined);
}
