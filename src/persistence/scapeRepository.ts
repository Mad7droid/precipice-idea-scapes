import type { Action } from "@/core/actions";
import { emptyScape } from "@/core/fixtures";
import { newScapeId } from "@/core/ids";
import { notify } from "@/core/notify";
import { toPlainScape } from "@/core/serialize";
import type { LoggedAction, Scape, ScapeId, ScapeRepository, ScapeSummary } from "@/core/types";
import { db, type PrecipiceDb } from "./db";

export class DexieScapeRepository implements ScapeRepository {
  /**
   * Highest snapshot sequence written per scape. Dexie writes are async and can complete out
   * of order; without this, a slow write of an older snapshot can land on top of a newer one
   * and silently roll the document back.
   */
  private lastSeq = new Map<ScapeId, number>();

  constructor(private readonly database: PrecipiceDb = db) {}

  async list(): Promise<ScapeSummary[]> {
    const rows = await this.database.scapes.orderBy("updatedAt").reverse().toArray();
    return rows.map(({ id, name, updatedAt, objectCount }) => ({
      id,
      name,
      updatedAt,
      objectCount,
    }));
  }

  async get(id: ScapeId): Promise<Scape | undefined> {
    return (await this.database.scapes.get(id))?.snapshot;
  }

  async create(name = "Untitled scape"): Promise<Scape> {
    const scape = emptyScape(newScapeId(), name);
    scape.createdAt = Date.now();
    scape.updatedAt = scape.createdAt;
    await this.write(scape);
    return scape;
  }

  async rename(id: ScapeId, name: string): Promise<void> {
    const row = await this.database.scapes.get(id);
    if (!row) return;
    await this.write({ ...row.snapshot, name, updatedAt: Date.now() });
  }

  async duplicate(id: ScapeId): Promise<Scape> {
    const row = await this.database.scapes.get(id);
    if (!row) throw new Error(`No scape ${id}`);
    const copy: Scape = {
      ...structuredClone(row.snapshot),
      id: newScapeId(),
      name: `${row.snapshot.name} copy`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.write(copy);
    return copy;
  }

  async remove(id: ScapeId): Promise<void> {
    await this.database.transaction("rw", this.database.scapes, this.database.actions, async () => {
      await this.database.scapes.delete(id);
      await this.database.actions.where("scapeId").equals(id).delete();
    });
    this.lastSeq.delete(id);
  }

  async saveSnapshot(scape: Scape, seq: number): Promise<void> {
    const last = this.lastSeq.get(scape.id) ?? -1;
    if (seq <= last) return; // stale write, a newer snapshot already landed
    this.lastSeq.set(scape.id, seq);
    await this.write(scape);
  }

  async appendActions(scapeId: ScapeId, actions: Action[]): Promise<void> {
    if (actions.length === 0) return;
    await this.guard(() =>
      this.database.actions.bulkAdd(
        actions.map((action) => ({ scapeId, ts: action.ts, txId: action.txId, action })),
      ),
    );
  }

  async getActionLog(scapeId: ScapeId): Promise<LoggedAction[]> {
    const rows = await this.database.actions.where("scapeId").equals(scapeId).toArray();
    return rows
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
      .map(({ scapeId: id, ts, txId, action }) => ({ scapeId: id, ts, txId, action }));
  }

  private async write(scape: Scape): Promise<void> {
    // Serialize through the core schema so a stray non-cloneable field can never reach disk.
    const snapshot = toPlainScape(scape);
    await this.guard(() =>
      this.database.scapes.put({
        id: snapshot.id,
        name: snapshot.name,
        updatedAt: snapshot.updatedAt,
        objectCount: snapshot.objectOrder.length,
        snapshot,
      }),
    );
  }

  /** Quota exhaustion is real for large scapes. Surface it; never swallow it. */
  private async guard<T>(operation: () => Promise<T>): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === "QuotaExceededError") {
        notify.error(
          "Out of browser storage",
          "Export this scape to a file, then delete scapes you no longer need.",
        );
      } else {
        notify.error(
          "Could not save to this browser",
          error instanceof Error ? error.message : String(error),
        );
      }
      return undefined;
    }
  }
}

export const scapeRepository = new DexieScapeRepository();
