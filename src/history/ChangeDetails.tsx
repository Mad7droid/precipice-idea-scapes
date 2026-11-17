import { getViewPlugin } from "@/core/viewRegistry";
import type { Scape, ScapeObject } from "@/core/types";
import { starterFor } from "@/starters";
import type { Change } from "./model";

/** Use full read-only views: the plugins' short toText summaries truncate long edits. */
export function ChangeDetails({
  change,
  before,
  after,
}: {
  change: Change;
  before: Scape;
  after: Scape;
}) {
  const blockChange =
    !change.scope &&
    ["Added", "Removed", "Edited"].includes(change.kind) &&
    (before.objects[change.id] || after.objects[change.id]);
  return (
    <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
      {[
        { title: "Saved version", scape: before, text: change.before },
        { title: "Current version", scape: after, text: change.after },
      ].map((side) => (
        <div key={side.title} className="min-w-0">
          <h3 className="mb-1 text-fg-secondary">{side.title}</h3>
          <div className="max-h-56 overflow-auto rounded-md bg-base p-3">
            {blockChange ? (
              <SnapshotBlock object={side.scape.objects[change.id]} />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-sans">
                {documentText(change.id, side.scape, side.text)}
              </pre>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
function SnapshotBlock({ object }: { object?: ScapeObject }) {
  if (!object) return <p className="text-fg-secondary">Not present in this version.</p>;
  const plugin = getViewPlugin(object.type);
  return (
    <div>
      {plugin ? (
        <plugin.View object={object} />
      ) : (
        <>
          <h4 className="font-medium">{object.title || "Untitled"}</h4>
          <p className="text-fg-secondary">Preview unavailable for this block type.</p>
        </>
      )}
      {object.tags?.length || object.accent ? (
        <p className="mt-2 text-fg-secondary">
          {[
            object.accent && `Marker: ${object.accent}`,
            object.tags?.length && `Tags: ${object.tags.join(", ")}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
function documentText(id: string, scape: Scape, fallback?: string) {
  if (id === "relationships")
    return (
      Object.values(scape.relationships)
        .map(
          (r) =>
            `${scape.objects[r.from]?.title || "Untitled"} → ${scape.objects[r.to]?.title || "Untitled"}${r.label ? ` · ${r.label}` : ""}`,
        )
        .join("\n") || "No connections"
    );
  if (id === "meta")
    return `Template: ${starterFor(scape).label}\n${Object.entries(scape.meta ?? {})
      .filter(([key]) => key !== "starter")
      .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join("\n")}`;
  return fallback || "(empty)";
}
