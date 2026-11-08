import { z } from "zod";
import { applyAction } from "@/core/reducer";
import { emptyScape } from "@/core/fixtures";
import { toPlainScape } from "@/core/serialize";
import type { Action } from "@/core/actions";
import type { Scape } from "@/core/types";
import { db, type PrecipiceDb } from "./db";
import { acquireScapeLease } from "./lease";
import { CURRENT_DOC_VERSION, migrateScape } from "./migrate";

export const WORKSPACE_KEYS = {
  capture: "workspace.capture.",
  state: "workspace.state.",
  opened: "workspace.opened.",
  session: "workspace.session.",
} as const;
export const MAX_CAPTURE_LENGTH = 20000;
export const MAX_CAPTURES = 1000;
export const workStateSchema = z.enum(["active", "parked", "done"]);
export type WorkState = z.infer<typeof workStateSchema>;
export const captureSchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().min(1).max(MAX_CAPTURE_LENGTH),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  archived: z.boolean().default(false),
  promotedTo: z.string().optional(),
  objectId: z.string().optional(),
});
export type Capture = z.infer<typeof captureSchema>;

export function capturesFromSettings(settings: Record<string, unknown>): Capture[] {
  return Object.entries(settings)
    .flatMap(([key, value]) => {
      if (!key.startsWith(WORKSPACE_KEYS.capture)) return [];
      const parsed = captureSchema.safeParse(value);
      return parsed.success && key === WORKSPACE_KEYS.capture + parsed.data.id ? [parsed.data] : [];
    })
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

/** Separate settings records avoid rewriting a shared Inbox array under concurrent capture. */
export class WorkspaceRepository {
  constructor(private readonly database: PrecipiceDb = db) {}

  async listCaptures(): Promise<Capture[]> {
    const rows = await this.database.settings
      .where("key")
      .startsWith(WORKSPACE_KEYS.capture)
      .toArray();
    return capturesFromSettings(Object.fromEntries(rows.map((row) => [row.key, row.value])));
  }

  async capture(text: string): Promise<Capture> {
    const now = Date.now();
    const item = captureSchema.parse({
      id: crypto.randomUUID(),
      text,
      createdAt: now,
      updatedAt: now,
    });
    await this.database.transaction("rw", this.database.settings, async () => {
      const count = await this.database.settings
        .where("key")
        .startsWith(WORKSPACE_KEYS.capture)
        .count();
      if (count >= MAX_CAPTURES)
        throw new Error("Inbox has reached 1,000 notes. Delete archived notes to add more.");
      await this.database.settings.add({ key: WORKSPACE_KEYS.capture + item.id, value: item });
    });
    return item;
  }

  async updateCapture(id: string, patch: { text?: string; archived?: boolean }): Promise<void> {
    await this.database.transaction(
      "rw",
      this.database.settings,
      this.database.scapes,
      async () => {
        const key = WORKSPACE_KEYS.capture + id;
        const row = await this.database.settings.get(key);
        if (!row) throw new Error("This Inbox item is no longer available.");
        const item = captureSchema.parse(row.value);
        if (patch.archived === false && item.promotedTo) {
          const destination = await this.database.scapes.get(item.promotedTo);
          if (!destination?.snapshot.objects[item.objectId ?? ""]) {
            delete item.promotedTo;
            delete item.objectId;
          }
        }
        if (item.promotedTo && patch.text !== undefined)
          throw new Error("This item has been added to a scape. Edit the note there.");
        await this.database.settings.put({
          key,
          value: captureSchema.parse({ ...item, ...patch, updatedAt: Date.now() }),
        });
      },
    );
  }

  /** Permanent removal is limited to archived notes, so an active note is never lost by one click.
   * A note already added to a scape stays in that scape; only the Inbox record goes. */
  async deleteCapture(id: string): Promise<void> {
    await this.database.transaction("rw", this.database.settings, async () => {
      const key = WORKSPACE_KEYS.capture + id;
      const row = await this.database.settings.get(key);
      if (!row) return;
      if (!captureSchema.parse(row.value).archived)
        throw new Error("Archive this note before deleting it.");
      await this.database.settings.delete(key);
    });
  }

  /** A single transaction commits note + source receipt together. Retry returns the same note.
   * No active editor is overwritten: obtain its normal lease, never take one over. */
  async promote(id: string, destination?: string): Promise<{ scapeId: string; objectId: string }> {
    const target = destination ?? `scp_inbox_${id}`;
    const lease = acquireScapeLease({
      scapeId: target,
      holderId: `capture_${crypto.randomUUID()}`,
      onChange: () => {},
    });
    try {
      if ((await lease.settled) !== "holder")
        throw new Error("This scape is open for editing. Close it before adding the Inbox note.");
      return await this.database.transaction(
        "rw",
        this.database.settings,
        this.database.scapes,
        this.database.actions,
        async () => {
          if (lease.status() !== "holder")
            throw new Error("Editing moved to another window. Try again.");
          const key = WORKSPACE_KEYS.capture + id;
          const source = await this.database.settings.get(key);
          if (!source) throw new Error("This Inbox item is no longer available.");
          const item = captureSchema.parse(source.value);
          if (item.promotedTo && item.objectId)
            return { scapeId: item.promotedTo, objectId: item.objectId };
          const row = await this.database.scapes.get(target);
          if (destination && !row) throw new Error("The destination scape is no longer available.");
          const title = item.text.split("\n")[0].slice(0, 100);
          const base = row
            ? migrateScape(row.snapshot as unknown as Record<string, unknown>, row.version)
            : emptyScape(target, title, { starter: "blank" });
          const objectId = `obj_inbox_${id}`;
          const action: Action = {
            type: "CreateObject",
            id: objectId,
            objectType: "note",
            title,
            data: { body: item.text },
            txId: `tx_inbox_${id}`,
            ts: Date.now(),
          };
          let snapshot = applyAction(base, action).state;
          const existing = Object.values(base.objects);
          const move: Action = {
            type: "MoveObject",
            id: objectId,
            x: existing.length ? Math.max(...existing.map((o) => o.x)) + 360 : 0,
            y: 0,
            txId: action.txId,
            ts: action.ts,
          };
          snapshot = toPlainScape(applyAction(snapshot, move).state);
          if (lease.status() !== "holder")
            throw new Error("Editing moved to another window. Try again.");
          await this.database.scapes.put({
            id: target,
            name: snapshot.name,
            updatedAt: snapshot.updatedAt,
            objectCount: snapshot.objectOrder.length,
            snapshot,
            version: CURRENT_DOC_VERSION,
          });
          await this.database.actions.bulkAdd(
            [action, move].map((a) => ({ scapeId: target, ts: a.ts, txId: a.txId, action: a })),
          );
          await this.database.settings.put({
            key,
            value: { ...item, archived: true, promotedTo: target, objectId, updatedAt: Date.now() },
          });
          return { scapeId: target, objectId };
        },
      );
    } finally {
      lease.stop();
    }
  }
}

/** Existing version-1 library readers restore captures as ordinary note scapes. */
export function captureAsScape(item: Capture): Scape {
  const base = emptyScape(
    `scp_capture_${item.id}`,
    `Inbox · ${item.text.split("\n")[0].slice(0, 80)}`,
    {
      starter: "blank",
      inboxCapture: { version: 1, archived: item.archived },
    },
  );
  const scape = applyAction(base, {
    type: "CreateObject",
    id: `obj_capture_${item.id}`,
    objectType: "note",
    title: item.text.split("\n")[0].slice(0, 100),
    data: { body: item.text },
    txId: `tx_capture_${item.id}`,
    ts: item.createdAt,
  }).state;
  return { ...scape, createdAt: item.createdAt, updatedAt: item.updatedAt };
}

export function captureFromScape(scape: Scape): Capture | undefined {
  const marker = z
    .object({ version: z.literal(1), archived: z.boolean() })
    .safeParse(scape.meta?.inboxCapture);
  const object = scape.objects[scape.objectOrder[0]];
  if (
    !marker.success ||
    scape.objectOrder.length !== 1 ||
    object?.type !== "note" ||
    typeof object.data.body !== "string"
  )
    return;
  // A malformed note is imported as an ordinary scape rather than failing the whole library.
  const capture = captureSchema.safeParse({
    id: crypto.randomUUID(),
    text: object.data.body,
    createdAt: scape.createdAt,
    updatedAt: scape.updatedAt,
    archived: marker.data.archived,
  });
  return capture.success ? capture.data : undefined;
}

export const workspaceRepository = new WorkspaceRepository();
