/**
 * Handing a file to the browser.
 *
 * Two exporters now share this — `.scape` and PDF — and both want the same filename from the
 * same scape name, so the slug lives here rather than being reinvented per format.
 */

/** `"Onboarding Flow!"` → `"onboarding-flow"`. Never empty, so a download always has a name. */
export function filenameFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "scape";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
