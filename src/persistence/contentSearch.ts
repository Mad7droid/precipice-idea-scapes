import type { ScapeObject, ScapeRepository } from "@/core/types";

export interface ContentMatch {
  scapeId: string;
  scapeName: string;
  objectId?: string;
  title: string;
  excerpt: string;
}
type Entry = {
  revision: number;
  name: string;
  limited: boolean;
  rows: Array<{ id: string; title: string; text: string }>;
};
const MAX_DOCUMENT_CHARACTERS = 250000;
const MAX_CACHED_CHARACTERS = 8000000;
// Character budget is the real memory bound; the entry cap only stops pathological tiny libraries.
const MAX_CACHED_ENTRIES = 1000;

/** Bounded text extraction from document content only: no instructions, credentials or drafts. */
function objectText(object: ScapeObject): string {
  const parts = [object.type, object.title, ...(object.tags ?? [])];
  let remaining = 50000;
  const visit = (value: unknown, depth: number) => {
    if (remaining <= 0 || depth > 8) return;
    if (typeof value === "string") {
      const text = value.slice(0, remaining);
      parts.push(text);
      remaining -= text.length;
    } else if (Array.isArray(value)) value.slice(0, 1000).forEach((v) => visit(v, depth + 1));
    else if (value && typeof value === "object")
      Object.values(value)
        .slice(0, 1000)
        .forEach((v) => visit(v, depth + 1));
  };
  visit(object.data, 0);
  return parts.join(" ");
}

/** In-memory, rebuildable cache. Each query refreshes revisions and drops deleted documents.
 * Read one snapshot at a time, yield between reads and stop abandoned queries promptly. */
export class ContentSearch {
  private index = new Map<string, Entry>();
  partial = false;
  constructor(private readonly repository: Pick<ScapeRepository, "list" | "get">) {}
  async search(query: string, signal?: AbortSignal): Promise<ContentMatch[]> {
    const terms = query.trim().slice(0, 200).toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    this.partial = false;
    const summaries = await this.repository.list();
    const alive = new Set(summaries.map((s) => s.id));
    for (const id of this.index.keys()) if (!alive.has(id)) this.index.delete(id);
    const results: ContentMatch[] = [];
    for (const summary of summaries) {
      if (signal?.aborted) return [];
      let entry = this.index.get(summary.id);
      if (entry) {
        // Refresh recency so the eviction below drops least-recently-used documents.
        this.index.delete(summary.id);
        this.index.set(summary.id, entry);
      }
      if (!entry || entry.revision !== summary.updatedAt || entry.name !== summary.name) {
        const scape = await this.repository.get(summary.id);
        if (signal?.aborted) return [];
        if (!scape) {
          this.index.delete(summary.id);
          continue;
        }
        let remaining = MAX_DOCUMENT_CHARACTERS;
        entry = {
          revision: summary.updatedAt,
          name: summary.name,
          limited: false,
          rows: scape.objectOrder.slice(0, 2000).flatMap((id) => {
            const object = scape.objects[id];
            if (!object || remaining <= 0) return [];
            const text = objectText(object).slice(0, remaining);
            remaining -= text.length;
            return [{ id, title: object.title, text }];
          }),
        };
        entry.limited = remaining <= 0 || scape.objectOrder.length > 2000;
        this.index.set(summary.id, entry);
        let cached = [...this.index.values()].reduce(
          (sum, value) => sum + value.rows.reduce((n, row) => n + row.text.length, 0),
          0,
        );
        while (this.index.size > MAX_CACHED_ENTRIES || cached > MAX_CACHED_CHARACTERS) {
          const id = this.index.keys().next().value!;
          const removed = this.index.get(id)!;
          cached -= removed.rows.reduce((n, row) => n + row.text.length, 0);
          this.index.delete(id);
        }
      }
      if (entry.limited) this.partial = true;
      const matches = (text: string) =>
        terms.every((term) => text.toLocaleLowerCase().includes(term));
      const nameMatches = matches(summary.name);
      if (nameMatches)
        results.push({
          scapeId: summary.id,
          scapeName: summary.name,
          title: summary.name,
          excerpt: "Scape",
        });
      for (const row of entry.rows) {
        // A name hit is reported once above; blocks must match on their own content. Without a
        // name hit, terms may span name and block, but at least one must be in the block.
        const lower = row.text.toLocaleLowerCase();
        const own = matches(row.text);
        if (
          !own &&
          (nameMatches ||
            !matches(`${summary.name} ${row.text}`) ||
            !terms.some((term) => lower.includes(term)))
        )
          continue;
        const first = terms.find((term) => lower.includes(term)) ?? terms[0];
        const start = Math.max(0, lower.indexOf(first) - 50);
        results.push({
          scapeId: summary.id,
          scapeName: summary.name,
          objectId: row.id,
          title: row.title || "Untitled block",
          excerpt: `${start ? "…" : ""}${row.text.slice(start, start + 180)}`,
        });
        if (results.length >= 60) return results;
      }
      if (results.length >= 60) return results;
    }
    return results;
  }
}
