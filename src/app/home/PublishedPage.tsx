import type { PublicationRecord, ScapeSummary } from "@/core/types";
import { Button } from "@/design/Button";
import { relativeTime } from "./library";
import { PageHeader } from "./PageHeader";
import type { CardAction } from "./ScapeCard";

/**
 * Every scape that has, or had, a public link. Publishing itself happens in the editor, where
 * the person can see exactly what the snapshot will contain.
 */
export function PublishedPage({
  scapes,
  publications,
  busy,
  onAction,
}: {
  scapes: ScapeSummary[];
  publications: Map<string, PublicationRecord>;
  busy: Set<string>;
  onAction: (scape: ScapeSummary, action: CardAction) => void;
}) {
  const rows = scapes
    .filter((scape) => publications.has(scape.id))
    .sort(
      (a, b) =>
        Number(publications.get(b.id)?.status === "published") -
          Number(publications.get(a.id)?.status === "published") ||
        (publications.get(b.id)?.updatedAt ?? 0) - (publications.get(a.id)?.updatedAt ?? 0),
    );
  return (
    <>
      <PageHeader title="Published">
        Read-only links you have shared. Your edits stay private until you update.
      </PageHeader>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-default px-6 py-12 text-center">
          <p className="text-fg">Nothing published yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-fg-secondary">
            Choose Publish from a scape’s ⋯ menu.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-subtle rounded-xl border border-subtle bg-surface">
          {rows.map((scape) => {
            const row = publications.get(scape.id)!;
            const live = row.status === "published";
            return (
              <li key={scape.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onAction(scape, "open")}
                    className="block max-w-full truncate text-left text-sm font-medium text-fg"
                  >
                    {scape.name}
                  </button>
                  <p className="text-xs text-fg-tertiary">
                    <span
                      aria-hidden
                      className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${live ? "bg-success" : "bg-[var(--border-strong)]"}`}
                    />
                    {live ? "Live" : "Unpublished, link reserved"} · updated{" "}
                    {relativeTime(row.updatedAt)}
                    {live && scape.updatedAt > row.updatedAt && " · has edits not yet published"}
                  </p>
                </div>
                <div className="flex gap-1">
                  {live && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy.has(scape.id)}
                        onClick={() => onAction(scape, "copy")}
                      >
                        Copy link
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onAction(scape, "public")}>
                        View
                      </Button>
                    </>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => onAction(scape, "publish")}>
                    Manage
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
