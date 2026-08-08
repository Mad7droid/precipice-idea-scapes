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
 * Document-level settings that are not themselves content.
 *
 * `starter` is the recipe a scape was created from — it decides the layout mode, which object
 * types the model may create, and whether relationships are drawn by default. It lives on the
 * document rather than in browser settings because it has to survive an export: a mind map
 * that re-imports as a left-to-right flow chart is not the same document.
 *
 * Open-ended on purpose. Everything in here is advisory — a scape with an unrecognised
 * starter falls back to the defaults and still opens.
 */
export interface ScapeMeta {
  starter?: string;
  [key: string]: unknown;
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
  meta?: ScapeMeta;
  createdAt: number;
  updatedAt: number;
}

export interface ScapeSummary {
  id: ScapeId;
  name: string;
  updatedAt: number;
  objectCount: number;
  relationshipCount: number;
  /** Type counts, for the composition strip in the scape list. */
  typeCounts: Record<string, number>;
  starter?: string;
  /** Enough geometry to draw a thumbnail without loading the whole snapshot. */
  preview?: ScapePreview;
}

/** Normalised positions in a unit box, plus the edges between them. Drawn, never edited. */
export interface ScapePreview {
  nodes: Array<{ x: number; y: number; type: string }>;
  edges: Array<[number, number]>;
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
  create(name?: string, meta?: ScapeMeta): Promise<Scape>;
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
  model: "anthropic.model",
  theme: "ui.theme",
  lastScapeId: "ui.lastScapeId",
  /** Which object types a generation may create, when the scape's starter does not decide. */
  generateTypes: "ui.generateTypes",
} as const;
