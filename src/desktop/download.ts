/**
 * Saves a generated file. On the web this is the usual anchor download. In the Mac app the
 * same anchor download is accepted natively only for blob/data URLs, written to ~/Downloads
 * under a non-clobbering name, and revealed in Finder (see `on_download` in main.rs).
 */
export function saveDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // WKWebView reads the blob asynchronously; revoke later rather than immediately.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
