import type { Action } from "./actions";

export type ObjectId = string;
export type RelationshipId = string;
export type ScapeId = string;
export type TxId = string;

/**
 * `Object` in the domain, `Artifact` only in user-facing copy — but a type literally named
 * `Object` shadows the JS global in every module that imports it, so it is `ScapeObject`.
 * The word "Artifact" appears nowhere in the codebase.
 */
export interface ScapeObject {
  id: ObjectId;
  /** Registry key. Unregistered types render a fallback card rather than crashing. */
  type: string;
  title: string;
  /** Plugin-owned. Validated by the plugin's Zod schema, never by the reducer. */
  data: Record<string, unknown>;
  x: number;
  y: number;
  createdAt: number;
  updatedAt: number;
}

export interface Relationship {
  id: RelationshipId;
  from: ObjectId;
  to: ObjectId;
  label?: string;
}

export interface ViewState {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Records give the reducer O(1) lookup and make inverses trivial to compute; `objectOrder`
 * carries the stable ordering that layout and keyboard navigation depend on.
 */
export interface Scape {
  id: ScapeId;
  name: string;
  objects: Record<ObjectId, ScapeObject>;
  objectOrder: ObjectId[];
  relationships: Record<RelationshipId, Relationship>;
  viewState: ViewState;
  createdAt: number;
  updatedAt: number;
}

export interface ScapeSummary {
  id: ScapeId;
  name: string;
  updatedAt: number;
  objectCount: number;
}

export interface LoggedAction {
  scapeId: ScapeId;
  ts: number;
  txId: TxId;
  action: Action;
}

/**
 * Everyone talks to this interface. Nobody outside src/persistence imports Dexie.
 * Two implementations ship: Dexie-backed and in-memory, and the same suite runs against both.
 */
export interface ScapeRepository {
  list(): Promise<ScapeSummary[]>;
  get(id: ScapeId): Promise<Scape | undefined>;
  create(name?: string): Promise<Scape>;
  rename(id: ScapeId, name: string): Promise<void>;
  duplicate(id: ScapeId): Promise<Scape>;
  remove(id: ScapeId): Promise<void>;
  /**
   * `seq` is a monotonically increasing write sequence. Dexie writes are async and can
   * interleave; implementations drop a write whose seq is older than the last one applied.
   */
  saveSnapshot(scape: Scape, seq: number): Promise<void>;
  appendActions(scapeId: ScapeId, actions: Action[]): Promise<void>;
  getActionLog(scapeId: ScapeId): Promise<LoggedAction[]>;
}

export type ThemePreference = "system" | "light" | "dark";

export interface SettingsRepository {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  all(): Promise<Record<string, unknown>>;
}

export const SETTING_KEYS = {
  apiKey: "anthropic.apiKey",
  model: "anthropic.model",
  theme: "ui.theme",
  lastScapeId: "ui.lastScapeId",
} as const;
