import Dexie, { type EntityTable } from "dexie";
import type { Action } from "@/core/actions";
import type { PublicationRecord, Scape, ScapeId } from "@/core/types";

/**
 * The only module in the app that knows Dexie exists. Everything else talks to the
 * ScapeRepository / SettingsRepository interfaces in src/core/types.ts.
 */

export interface ScapeRow {
  id: ScapeId;
  name: string;
  updatedAt: number;
  objectCount: number;
  /** Full snapshot. Load is a read of this row, not a replay of the action log. */
  snapshot: Scape;
  /**
   * The document shape `snapshot` was written at — see migrate.ts. Absent on rows written
   * before versioning, which are version 1 by definition.
   *
   * This is deliberately not a Dexie schema version: Dexie's `version()` describes tables and
   * indexes, and the shape that actually changes is the blob inside this column. Bumping
   * Dexie for a field inside a blob it never reads would upgrade nothing.
   */
  version?: number;
}

export interface ActionRow {
  id?: number;
  scapeId: ScapeId;
  ts: number;
  txId: string;
  action: Action;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

/**
 * A scape's public publication, as far as this browser knows. See `PublicationRecord` in
 * `src/core/types.ts` for what each field means and why the id survives an unpublish.
 *
 * The server is the authority. Nothing here is trusted for access control; it exists so the
 * editor can render "published" or "update available" without a request on every load.
 */
export type PublicationRow = PublicationRecord;

export class PrecipiceDb extends Dexie {
  scapes!: EntityTable<ScapeRow, "id">;
  actions!: EntityTable<ActionRow, "id">;
  settings!: EntityTable<SettingRow, "key">;
  publications!: EntityTable<PublicationRow, "scapeId">;

  constructor(name = "precipice") {
    super(name);
    // Version 1. Only this module ever bumps it.
    this.version(1).stores({
      scapes: "id, updatedAt",
      actions: "++id, scapeId, ts, txId",
      settings: "key",
    });
    // Version 2 adds publications. Purely additive — Dexie carries the three existing stores
    // forward untouched, so there is no upgrade function and nothing to get wrong.
    //
    // This lands in wave 0, before the agent that consumes it starts, because a schema
    // migration is the one thing that must never be written twice in parallel: two branches
    // each defining a `version(2)` produce databases that disagree about what version 2 is,
    // and the loser's is already on a user's disk.
    //
    // `publicationId` is indexed for the reverse lookup (public URL → local scape), `status`
    // for counting what the quota actually counts.
    this.version(2).stores({
      publications: "scapeId, publicationId, status",
    });
  }
}

export const db = new PrecipiceDb();
