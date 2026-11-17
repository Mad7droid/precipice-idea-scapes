import type { Scape } from "@/core/types";

export type CheckpointReason =
  | "baseline"
  | "automatic"
  | "manual"
  | "ai"
  | "ai-partial"
  | "agent"
  | "before-restore"
  | "restore";
export interface Checkpoint {
  id: string;
  scapeId: string;
  ordinal: number;
  capturedAt: number;
  documentVersion: number;
  label?: string;
  reason: CheckpointReason;
  restoredFromId?: string;
  snapshot: Scape;
  bytes: number;
  summary?: string;
}
export type CheckpointSummary = Omit<Checkpoint, "snapshot">;
export interface HistoryRepository {
  list(scapeId: string): Promise<CheckpointSummary[]>;
  get(id: string): Promise<Checkpoint | undefined>;
  remove(id: string, scapeId: string): Promise<void>;
  rename(id: string, scapeId: string, label: string): Promise<void>;
  capture(scape: Scape, reason?: CheckpointReason, label?: string): Promise<void>;
  restore(
    before: Scape,
    after: Scape,
    checkpointId: string,
    canWrite: () => boolean,
    action: import("@/core/actions").Action,
  ): Promise<void>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function contentKey(scape: Scape): string {
  const { viewState: _v, updatedAt: _u, createdAt: _c, instructions, ...rest } = scape;
  return canonical({
    ...rest,
    instructions: instructions?.body,
    objects: Object.fromEntries(
      Object.entries(scape.objects).map(([id, object]) => {
        const { createdAt: _a, updatedAt: _b, ...content } = object;
        return [id, content];
      }),
    ),
  });
}
export interface Change {
  scope?: "scape";
  id: string;
  title: string;
  kind: "Added" | "Removed" | "Edited" | "Moved" | "Resized";
  before?: string;
  after?: string;
}
export function changesBetween(before: Scape, after: Scape): Change[] {
  const changes: Change[] = [];
  for (const id of new Set([...before.objectOrder, ...after.objectOrder])) {
    const a = before.objects[id],
      b = after.objects[id];
    if (!a || !b) {
      changes.push({
        id,
        title: (b ?? a).title || "Untitled",
        kind: b ? "Added" : "Removed",
        before: a ? JSON.stringify(a.data, null, 2) : "",
        after: b ? JSON.stringify(b.data, null, 2) : "",
      });
      continue;
    }
    const { x: ax, y: ay, width: aw, createdAt: _ac, updatedAt: _au, ...aContent } = a;
    const { x: bx, y: by, width: bw, createdAt: _bc, updatedAt: _bu, ...bContent } = b;
    if (canonical(aContent) !== canonical(bContent))
      changes.push({
        id,
        title: b.title || "Untitled",
        kind: "Edited",
        before: JSON.stringify(aContent, null, 2),
        after: JSON.stringify(bContent, null, 2),
      });
    if (aw !== bw)
      changes.push({
        id,
        title: b.title || "Untitled",
        kind: "Resized",
        before: aw ? `${aw}px` : "Default width",
        after: bw ? `${bw}px` : "Default width",
      });
    if (ax !== bx || ay !== by)
      changes.push({
        id,
        title: b.title || "Untitled",
        kind: "Moved",
        before: `${Math.round(ax)}, ${Math.round(ay)}`,
        after: `${Math.round(bx)}, ${Math.round(by)}`,
      });
  }
  if (before.name !== after.name)
    changes.push({
      scope: "scape",
      id: "name",
      title: "Scape name",
      kind: "Edited",
      before: before.name,
      after: after.name,
    });
  if (before.instructions?.body !== after.instructions?.body)
    changes.push({
      scope: "scape",
      id: "instructions",
      title: "Instructions",
      kind: "Edited",
      before: before.instructions?.body ?? "",
      after: after.instructions?.body ?? "",
    });
  if (canonical(before.relationships) !== canonical(after.relationships))
    changes.push({
      scope: "scape",
      id: "relationships",
      title: "Connections",
      kind: "Edited",
      before: JSON.stringify(before.relationships, null, 2),
      after: JSON.stringify(after.relationships, null, 2),
    });
  const sharedBefore = before.objectOrder.filter((id) => after.objects[id]);
  const sharedAfter = after.objectOrder.filter((id) => before.objects[id]);
  if (canonical(sharedBefore) !== canonical(sharedAfter))
    changes.push({
      scope: "scape",
      id: "order",
      title: "Block order",
      kind: "Edited",
      before: sharedBefore.map((id) => before.objects[id].title || "Untitled").join(" → "),
      after: sharedAfter.map((id) => after.objects[id].title || "Untitled").join(" → "),
    });
  if (canonical(before.meta) !== canonical(after.meta))
    changes.push({
      scope: "scape",
      id: "meta",
      title: "Scape settings",
      kind: "Edited",
      before: JSON.stringify(before.meta, null, 2),
      after: JSON.stringify(after.meta, null, 2),
    });
  return changes;
}
