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
        // Pinning is a promise to keep something within reach, so a pin outranks the sort.
        Number(pins.has(b.id)) - Number(pins.has(a.id)) ||
        (prefs.sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt - a.updatedAt) ||
        a.id.localeCompare(b.id),
    );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Recent times read as elapsed; older ones read as a date. Nobody counts back 40 days. */
export function relativeTime(ts: number, now = Date.now()): string {
  const delta = now - ts;
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  const date = new Date(ts);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  });
}

/** "3 notes · 1 journey · 4 connections", from the counts the summary already carries. */
export function describeContents(
  scape: Pick<ScapeSummary, "objectCount" | "typeCounts" | "relationshipCount">,
  labelFor: (type: string) => string,
): string {
  if (scape.objectCount === 0) return "Empty";
  const parts = Object.entries(scape.typeCounts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => plural(count, labelFor(type).toLocaleLowerCase()));
  if (scape.relationshipCount > 0) parts.push(plural(scape.relationshipCount, "connection"));
  return parts.join(" · ");
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
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
