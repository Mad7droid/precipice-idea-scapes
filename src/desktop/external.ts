import { isDesktop } from "@/desktop/runtime";

/**
 * External links in the Mac app. WKWebView never opens new windows (main.rs denies them), so
 * `target="_blank"` anchors and `window.open` route through the restricted `open_external`
 * command, which only accepts http(s) URLs and hands them to the default browser.
 */

/** The URL if it may leave the app: absolute http(s) without embedded credentials. */
export function externalWebUrl(raw: string | URL | undefined | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(String(raw), window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Opens a web URL in the system browser on desktop, or a new tab on the web. */
export async function openExternal(raw: string | URL): Promise<void> {
  const url = externalWebUrl(raw);
  if (!url) throw new Error("Only web links can be opened.");
  if (!isDesktop()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_external", { url });
}

/** Opens `url` natively, never rejecting; failures are logged without the URL. */
function launch(url: string, invoke: (url: string) => Promise<void>) {
  void invoke(url).catch(() => console.warn("Could not open an external link."));
}

/**
 * Installs one delegated click handler and a `window.open` shim. Returns an uninstaller.
 * `invoke` is injectable for tests.
 */
export function installExternalLinks(
  invoke: (url: string) => Promise<void> = async (url) => {
    const core = await import("@tauri-apps/api/core");
    await core.invoke("open_external", { url });
  },
): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button > 1) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const newWindow = anchor.target === "_blank" || event.metaKey || event.button === 1;
    if (!newWindow || anchor.hasAttribute("download")) return;
    const url = externalWebUrl(anchor.href);
    if (!url || new URL(url).origin === window.location.origin) return;
    event.preventDefault();
    launch(url, invoke);
  };
  const original = window.open;
  window.open = function open(target?: string | URL, name?: string, features?: string) {
    const url = externalWebUrl(target ?? null);
    if (url && new URL(url).origin !== window.location.origin) {
      launch(url, invoke);
      return null;
    }
    return original.call(window, target, name, features);
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", onClick, true);
  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("auxclick", onClick, true);
    window.open = original;
  };
}
