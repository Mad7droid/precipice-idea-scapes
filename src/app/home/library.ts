import type { PublicationRecord, ScapeSummary } from "@/core/types";
import { acquireScapeLease } from "@/persistence/lease";

export type LibraryPreferences = {
  filter: "all" | "pinned" | "published";
  sort: "edited" | "name";
  view: "gallery" | "list";
};
export const DEFAULT_PREFERENCES: LibraryPreferences = {
  filter: "all",
  sort: "edited",
  view: "gallery",
};
export const HOME_KEYS = {
  preferences: "home.library",
  pin: "home.pin.",
  explore: "home.exploreDismissed",
};
export function readPreferences(value: unknown): LibraryPreferences {
  const v = value as Partial<LibraryPreferences> | null;
  return {
    filter: v?.filter === "pinned" || v?.filter === "published" ? v.filter : "all",
    sort: v?.sort === "name" ? "name" : "edited",
    view: v?.view === "list" ? "list" : "gallery",
  };
}
export function selectScapes(
  scapes: ScapeSummary[],
  query: string,
  prefs: LibraryPreferences,
  pins: Set<string>,
  publications: Map<string, PublicationRecord>,
) {
  const term = query.trim().toLocaleLowerCase();
  return scapes
    .filter(
      (s) =>
        s.name.toLocaleLowerCase().includes(term) &&
        (prefs.filter !== "pinned" || pins.has(s.id)) &&
        (prefs.filter !== "published" || publications.get(s.id)?.status === "published"),
    )
    .sort(
      (a, b) =>
        (prefs.sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt - a.updatedAt) ||
        a.id.localeCompare(b.id),
    );
}
/** Hold the same lease as the editor for document mutations; never take over another tab. */
export async function withHomeLease<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const lease = acquireScapeLease({
    scapeId: id,
    holderId: `home_${crypto.randomUUID()}`,
    onChange: () => {},
  });
  try {
    if ((await lease.settled) !== "holder")
      throw new Error(
        "This scape is open in another tab. Open it there to make this change, or close that tab and try again.",
      );
    return await operation();
  } finally {
    lease.stop();
  }
}
