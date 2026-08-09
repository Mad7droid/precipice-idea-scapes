import type { Action } from "@/core/actions";
import { emptyScape } from "@/core/fixtures";
import { newScapeId } from "@/core/ids";
import { notify } from "@/core/notify";
import { toPlainScape } from "@/core/serialize";
import type {
  LoggedAction,
  Scape,
  ScapeId,
  ScapeMeta,
  ScapeRepository,
  ScapeSummary,
} from "@/core/types";
import { db, type PrecipiceDb, type ScapeRow } from "./db";
import { CURRENT_DOC_VERSION, migrateScape } from "./migrate";
import { summarize } from "./summary";

/**
 * How much history a scape keeps. Roughly a week of hard editing; well under the point where
 * the log outweighs the snapshots it accompanies.
 */
const MAX_LOGGED_ACTIONS = 5000;

/** Counting rows on every append would cost more than the trim saves. */
const TRIM_CHECK_EVERY = 200;

export class DexieScapeRepository implements ScapeRepository {
  /**
   * Highest snapshot sequence written per scape. Dexie writes are async and can complete out
   * of order; without this, a slow write of an older snapshot can land on top of a newer one
   * and silently roll the document back.
   */
  private lastSeq = new Map<ScapeId, number>();

  /** Appends since this scape's log was last measured. See `trimActionLog`. */
  private appendsSinceTrim = new Map<ScapeId, number>();

  private readonly maxLoggedActions: number;
  private readonly trimCheckEvery: number;

  constructor(
    private readonly database: PrecipiceDb = db,
    limits: { maxLoggedActions?: number; trimCheckEvery?: number } = {},
  ) {
    this.maxLoggedActions = limits.maxLoggedActions ?? MAX_LOGGED_ACTIONS;
    this.trimCheckEvery = limits.trimCheckEvery ?? TRIM_CHECK_EVERY;
  }

  async list(): Promise<ScapeSummary[]> {
    // Derived from the snapshot rather than the row's denormalised columns: the row is already
    // being read whole, and a summary that can drift from the document it describes is worse
    // than one that costs a map.
    const rows = await this.database.scapes.orderBy("updatedAt").reverse().toArray();
    return rows.flatMap((row) => {
      const snapshot = this.upgrade(row);
      return snapshot ? [summarize(snapshot)] : [];
    });
  }

  async get(id: ScapeId): Promise<Scape | undefined> {
    const row = await this.database.scapes.get(id);
    return row ? (this.upgrade(row) ?? undefined) : undefined;
  }

  /**
   * Brings a stored snapshot up to the shape this build understands.
   *
   * A row this build cannot read — written by a newer version, in a browser profile synced
   * from a machine running ahead — is skipped rather than thrown, so one such scape does not
   * take the whole library down with it. The document itself is left untouched on disk.
   */
  private upgrade(row: ScapeRow): Scape | null {
    try {
      return migrateScape(row.snapshot as unknown as Record<string, unknown>, row.version);
    } catch (error) {
      notify.error(
        `Could not open “${row.name}”`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  async create(name = "Untitled scape", meta?: ScapeMeta): Promise<Scape> {
    const scape = emptyScape(newScapeId(), name, meta);
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
    this.appendsSinceTrim.delete(id);
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

    const since = (this.appendsSinceTrim.get(scapeId) ?? 0) + actions.length;
    if (since < this.trimCheckEvery) {
      this.appendsSinceTrim.set(scapeId, since);
      return;
    }
    this.appendsSinceTrim.set(scapeId, 0);
    await this.trimActionLog(scapeId);
  }

  /**
   * The log is append-only and the browser's quota is not. A long-lived scape can accumulate
   * more history than the document it describes, and the snapshot — not the log — is what a
   * load reads, so the oldest entries are the cheapest thing in the database to give up.
   *
   * Trimming by count rather than by age: a scape edited hard for one afternoon and then left
   * alone should keep that afternoon.
   */
  private async trimActionLog(scapeId: ScapeId): Promise<void> {
    await this.guard(async () => {
      const table = this.database.actions;
      const total = await table.where("scapeId").equals(scapeId).count();
      if (total <= this.maxLoggedActions) return;

      // Insertion order, which is what `++id` gives us — `ts` comes from the action and can
      // repeat across a burst.
      const excess = total - this.maxLoggedActions;
      const oldest = await table.where("scapeId").equals(scapeId).sortBy("id");
      const doomed = oldest.slice(0, excess).map((row) => row.id!);
      await table.bulkDelete(doomed);
    });
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
        version: CURRENT_DOC_VERSION,
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
