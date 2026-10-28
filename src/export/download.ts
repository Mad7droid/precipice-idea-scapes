import { saveDownload } from "@/desktop/download";

/**
 * Handing a file to the browser.
 *
 * Two exporters now share this — `.scape` and PDF — and both want the same filename from the
 * same scape name, so the slug lives here rather than being reinvented per format.
 */

/**
 * `"Onboarding Flow!"` → `"onboarding-flow"`, `"Café plan"` → `"café-plan"`. Letters and digits
 * in any script are kept; punctuation, path separators and control characters are not. Never
 * empty, so a download always has a name.
 */
export function filenameFor(name: string): string {
  const slug = name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "scape";
}

/** Delegates to the shared saver so the Mac app's native download handler sees it. */
export function downloadBlob(blob: Blob, filename: string): void {
  saveDownload(blob, filename);
}
