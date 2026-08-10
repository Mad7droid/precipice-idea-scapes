import type { Action } from "@/core/actions";
import { emptyScape } from "@/core/fixtures";
import { newScapeId } from "@/core/ids";
import type {
  LoggedAction,
  PublicationRecord,
  PublicationStore,
  Scape,
  ScapeId,
  ScapeMeta,
  ScapeRepository,
  ScapeSummary,
  SettingsRepository,
} from "@/core/types";
import { summarize } from "./summary";

/**
 * The same repository, backed by a Map.
 *
 * It exists so the other workstreams are never blocked on IndexedDB, and so the conformance
 * suite has a second implementation to run against — a contract with one implementation is
 * just that implementation's shape written down twice.
 */
export class MemoryScapeRepository implements ScapeRepository {
  private scapes = new Map<ScapeId, Scape>();
  private actions = new Map<ScapeId, LoggedAction[]>();
  private lastSeq = new Map<ScapeId, number>();
  readonly publications = new MemoryPublicationStore();

  async list(): Promise<ScapeSummary[]> {
    return [...this.scapes.values()].map(summarize).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: ScapeId): Promise<Scape | undefined> {
    const scape = this.scapes.get(id);
    return scape ? structuredClone(scape) : undefined;
  }

  async create(name = "Untitled scape", meta?: ScapeMeta): Promise<Scape> {
    const scape = emptyScape(newScapeId(), name, meta);
    scape.createdAt = Date.now();
    scape.updatedAt = scape.createdAt;
    this.scapes.set(scape.id, scape);
    return structuredClone(scape);
  }

  async rename(id: ScapeId, name: string): Promise<void> {
    const scape = this.scapes.get(id);
    if (!scape) return;
    this.scapes.set(id, { ...scape, name, updatedAt: Date.now() });
  }

  /** The copy is unpublished. See the Dexie implementation for why the row is not carried. */
  async duplicate(id: ScapeId): Promise<Scape> {
    const source = this.scapes.get(id);
    if (!source) throw new Error(`No scape ${id}`);
    const copy: Scape = {
      ...structuredClone(source),
      id: newScapeId(),
      name: `${source.name} copy`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.scapes.set(copy.id, copy);
    return structuredClone(copy);
  }

  async remove(id: ScapeId): Promise<void> {
    this.scapes.delete(id);
    this.actions.delete(id);
    this.lastSeq.delete(id);
    // Never leave a publication row keyed on a scape that is gone.
    await this.publications.remove(id);
  }

  async saveSnapshot(scape: Scape, seq: number): Promise<void> {
    // Writes can interleave; a snapshot older than one already written is dropped.
    const last = this.lastSeq.get(scape.id) ?? -1;
    if (seq <= last) return;
    this.lastSeq.set(scape.id, seq);
    this.scapes.set(scape.id, structuredClone(scape));
  }

  async appendActions(scapeId: ScapeId, actions: Action[]): Promise<void> {
    if (actions.length === 0) return;
    const log = this.actions.get(scapeId) ?? [];
    for (const action of actions) {
      log.push({ scapeId, ts: action.ts, txId: action.txId, action });
    }
    this.actions.set(scapeId, log);
  }

  async getActionLog(scapeId: ScapeId): Promise<LoggedAction[]> {
    return structuredClone(this.actions.get(scapeId) ?? []);
  }

  /** Test seam: put a known Scape in without going through create(). */
  async put(scape: Scape): Promise<void> {
    this.scapes.set(scape.id, structuredClone(scape));
  }
}

export class MemoryPublicationStore implements PublicationStore {
  private rows = new Map<ScapeId, PublicationRecord>();

  async get(scapeId: ScapeId): Promise<PublicationRecord | undefined> {
    const row = this.rows.get(scapeId);
    return row ? { ...row } : undefined;
  }

  async all(): Promise<PublicationRecord[]> {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }

  async put(record: PublicationRecord): Promise<void> {
    this.rows.set(record.scapeId, { ...record });
  }

  async remove(scapeId: ScapeId): Promise<void> {
    this.rows.delete(scapeId);
  }
}

export class MemorySettingsRepository implements SettingsRepository {
  private values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async all(): Promise<Record<string, unknown>> {
    return Object.fromEntries(this.values);
  }
}
