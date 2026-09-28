/** Published snapshots are served by the hosted viewer, including when shared from desktop. */
export function publicationUrl(path: string): string {
  return new URL(path, "https://precipice.pages.dev").toString();
}
