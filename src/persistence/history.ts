import type { Action } from "@/core/actions";
import type { Scape } from "@/core/types";
import { toPlainScape } from "@/core/serialize";
import {
  contentKey,
  changesBetween,
  type Checkpoint,
  type CheckpointReason,
  type HistoryRepository,
} from "@/history/model";
import { CURRENT_DOC_VERSION, migrateScape } from "./migrate";
import type { PrecipiceDb } from "./db";

const MAX_CHECKPOINTS = 200;
const MAX_HISTORY_BYTES = 50 * 1024 * 1024;

function summarizeChanges(before: Scape, after: Scape) {
  const counts = new Map<string, number>();
  for (const change of changesBetween(before, after))
    counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);
  return [...counts].map(([kind, n]) => `${n} ${kind.toLowerCase()}`).join(" · ") || "Same content";
}

function shouldCapture(
  last: Checkpoint | undefined,
  scape: Scape,
  reason: CheckpointReason,
  label?: string,
) {
  // Check the cheap clock gate before serializing a potentially large document.
  if (reason === "automatic" && last && Date.now() - last.capturedAt < 30_000) return false;
  return !(
    last &&
    contentKey(last.snapshot) === contentKey(scape) &&
    !label &&
    reason !== "restore" &&
    reason !== "before-restore"
  );
}

function prepareCapture(
  rows: Checkpoint[],
  scape: Scape,
  reason: CheckpointReason,
  label?: string,
  restoredFromId?: string,
) {
  const last = rows.at(-1);
  const cleanLabel = label?.trim().slice(0, 120) || undefined;
  if (!shouldCapture(last, scape, reason, cleanLabel)) return;
  const snapshot = toPlainScape(scape);
  const next: Checkpoint = {
    id: crypto.randomUUID(),
    scapeId: scape.id,
    ordinal: (last?.ordinal ?? 0) + 1,
    capturedAt: Date.now(),
    documentVersion: CURRENT_DOC_VERSION,
    reason: !last && reason === "automatic" ? "baseline" : reason,
    label: cleanLabel,
    snapshot,
    restoredFromId,
    summary: last ? summarizeChanges(last.snapshot, scape) : "Initial checkpoint",
    bytes: new TextEncoder().encode(JSON.stringify(snapshot)).length,
  };
  const all = [...rows, next];
  const safety = all
    .slice()
    .reverse()
    .find((r) => r.reason === "before-restore")?.id;
  let bytes = all.reduce((n, r) => n + r.bytes, 0);
  let count = all.length;
  const doomed: string[] = [];
  for (const row of all) {
    if (count <= MAX_CHECKPOINTS && bytes <= MAX_HISTORY_BYTES) break;
    if (row.id === next.id || row.label || row.id === safety) continue;
    doomed.push(row.id);
    bytes -= row.bytes;
    count--;
  }
  if (bytes > MAX_HISTORY_BYTES || count > MAX_CHECKPOINTS)
    throw new Error(
      "Version history is full. Delete older named versions to make room. Your current scape is still saved.",
    );
  return { next, doomed };
}

/** Called inside a transaction including checkpoints. Payloads are immutable. */
export async function captureCheckpoint(
  database: PrecipiceDb,
  scape: Scape,
  reason: CheckpointReason = "automatic",
  label?: string,
  restoredFromId?: string,
) {
  const last = await database.checkpoints
    .where("[scapeId+ordinal]")
    .between([scape.id, 0], [scape.id, Number.MAX_SAFE_INTEGER])
    .reverse()
    .first();
  if (
    last &&
    reason === "manual" &&
    label?.trim() &&
    contentKey(last.snapshot) === contentKey(scape)
  ) {
    await database.checkpoints.update(last.id, { label: label.trim().slice(0, 120) });
    return;
  }
  if (!shouldCapture(last, scape, reason, label?.trim())) return;
  const rows = await database.checkpoints.where("scapeId").equals(scape.id).sortBy("ordinal");
  const capture = prepareCapture(rows, scape, reason, label, restoredFromId);
  if (!capture) return;
  await database.checkpoints.bulkDelete(capture.doomed);
  await database.checkpoints.add(capture.next);
}

export class DexieHistoryRepository implements HistoryRepository {
  constructor(private database: PrecipiceDb) {}
  async list(scapeId: string) {
    const rows = await this.database.checkpoints.where("scapeId").equals(scapeId).sortBy("ordinal");
    return rows.reverse().map(({ snapshot: _snapshot, ...summary }) => summary);
  }
  async get(id: string) {
    const row = await this.database.checkpoints.get(id);
    if (!row) return undefined;
    return {
      ...row,
      snapshot: toPlainScape(
        migrateScape(row.snapshot as unknown as Record<string, unknown>, row.documentVersion),
      ),
    };
  }
  async rename(id: string, scapeId: string, label: string) {
    await this.database.transaction("rw", this.database.checkpoints, async () => {
      const row = await this.database.checkpoints.get(id);
      if (!row || row.scapeId !== scapeId) throw new Error("This version is no longer available.");
      await this.database.checkpoints.update(id, {
        label: label.trim().slice(0, 120) || undefined,
      });
    });
  }
  async remove(id: string, scapeId: string) {
    await this.database.transaction("rw", this.database.checkpoints, async () => {
      const row = await this.database.checkpoints.get(id);
      if (row?.scapeId === scapeId) await this.database.checkpoints.delete(id);
    });
  }
  async capture(scape: Scape, reason: CheckpointReason = "manual", label?: string) {
    await this.database.transaction(
      "rw",
      this.database.scapes,
      this.database.checkpoints,
      async () => {
        const head = await this.database.scapes.get(scape.id);
        if (!head || contentKey(head.snapshot) !== contentKey(scape))
          throw new Error("The scape changed. Return to current and try again.");
        await captureCheckpoint(this.database, scape, reason, label);
      },
    );
  }
  async restore(
    before: Scape,
    after: Scape,
    checkpointId: string,
    canWrite: () => boolean,
    action: Action,
  ) {
    await this.database.transaction(
      "rw",
      this.database.scapes,
      this.database.checkpoints,
      this.database.actions,
      async () => {
        const row = await this.database.scapes.get(before.id);
        const selected = await this.database.checkpoints.get(checkpointId);
        if (!canWrite()) throw new Error("This scape is read-only.");
        if (
          !row ||
          !selected ||
          selected.scapeId !== before.id ||
          contentKey(row.snapshot) !== contentKey(before)
        )
          throw new Error("The scape changed. Return to current and try again.");
        await captureCheckpoint(this.database, before, "before-restore");
        const snapshot = toPlainScape(after);
        await this.database.scapes.put({
          ...row,
          snapshot,
          name: snapshot.name,
          updatedAt: snapshot.updatedAt,
          objectCount: snapshot.objectOrder.length,
          version: CURRENT_DOC_VERSION,
        });
        await this.database.actions.add({
          scapeId: before.id,
          ts: action.ts,
          txId: action.txId,
          action,
        });
        await captureCheckpoint(this.database, snapshot, "restore", undefined, checkpointId);
        if (!canWrite()) throw new Error("The editing lease changed. Try again.");
      },
    );
  }
}

export class MemoryHistoryRepository implements HistoryRepository {
  private rows: Checkpoint[] = [];
  constructor(
    private getHead: (id: string) => Promise<Scape | undefined>,
    private putHead: (s: Scape) => Promise<void>,
    private append: (id: string, actions: Action[]) => Promise<void>,
  ) {}
  async list(scapeId: string) {
    return this.rows
      .filter((r) => r.scapeId === scapeId)
      .slice()
      .reverse()
      .map(({ snapshot: _s, ...r }) => structuredClone(r));
  }
  async get(id: string) {
    return structuredClone(this.rows.find((r) => r.id === id));
  }
  async rename(id: string, scapeId: string, label: string) {
    const row = this.rows.find((r) => r.id === id && r.scapeId === scapeId);
    if (!row) throw new Error("This version is no longer available.");
    row.label = label.trim().slice(0, 120) || undefined;
  }
  async remove(id: string, scapeId: string) {
    this.rows = this.rows.filter((r) => r.id !== id || r.scapeId !== scapeId);
  }
  async capture(scape: Scape, reason: CheckpointReason = "manual", label?: string) {
    const head = await this.getHead(scape.id);
    if (!head || contentKey(head) !== contentKey(scape))
      throw new Error("The scape changed. Return to current and try again.");
    const last = this.rows.filter((r) => r.scapeId === scape.id).at(-1);
    if (
      last &&
      reason === "manual" &&
      label?.trim() &&
      contentKey(last.snapshot) === contentKey(scape)
    ) {
      last.label = label.trim().slice(0, 120);
      return;
    }
    const capture = prepareCapture(
      this.rows.filter((r) => r.scapeId === scape.id),
      scape,
      reason,
      label,
    );
    if (!capture) return;
    this.rows = [...this.rows.filter((r) => !capture.doomed.includes(r.id)), capture.next];
  }
  async restore(before: Scape, after: Scape, id: string, canWrite: () => boolean, action: Action) {
    const head = await this.getHead(before.id),
      selected = await this.get(id);
    if (
      !canWrite() ||
      !head ||
      !selected ||
      selected.scapeId !== before.id ||
      contentKey(head) !== contentKey(before)
    )
      throw new Error("The scape changed.");
    const beforeRows = this.rows;
    try {
      await this.capture(before, "before-restore");
      const capture = prepareCapture(
        this.rows.filter((r) => r.scapeId === before.id),
        after,
        "restore",
        undefined,
        id,
      );
      if (!canWrite()) throw new Error("The editing lease changed.");
      await this.putHead(after);
      await this.append(before.id, [action]);
      if (capture)
        this.rows = [...this.rows.filter((r) => !capture.doomed.includes(r.id)), capture.next];
    } catch (error) {
      this.rows = beforeRows;
      throw error;
    }
  }
  removeScape(id: string) {
    this.rows = this.rows.filter((r) => r.scapeId !== id);
  }
}
