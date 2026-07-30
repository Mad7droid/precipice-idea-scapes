import Dexie, { type EntityTable } from "dexie";
import type { Action } from "@/core/actions";
import type { Scape, ScapeId } from "@/core/types";

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

export class PrecipiceDb extends Dexie {
  scapes!: EntityTable<ScapeRow, "id">;
  actions!: EntityTable<ActionRow, "id">;
  settings!: EntityTable<SettingRow, "key">;

  constructor(name = "precipice") {
    super(name);
    // Version 1. Only this module ever bumps it.
    this.version(1).stores({
      scapes: "id, updatedAt",
      actions: "++id, scapeId, ts, txId",
      settings: "key",
    });
  }
}

export const db = new PrecipiceDb();
