import { describe, expect, it } from "vitest";
import { fixtureScape } from "@/core/fixtures";
import type { Scape } from "@/core/types";
import { MemoryScapeRepository } from "@/persistence/memoryRepository";
import type { McpOperation } from "./contracts";
import { createCommandService, type Envelope, type Grant, type ServiceDeps } from "./service";

const grant = (overrides: Partial<Grant> = {}): Grant => ({
  clientId: "client_1",
  clientName: "Claude",
  scapes: "all",
  mode: "direct",
  write: true,
  ...overrides,
});

let seq = 0;
const call = (tool: Envelope["tool"], args: unknown, g: Grant = grant()): Envelope => ({
  id: `cmd_${++seq}`,
  tool,
  args,
  grant: g,
});

async function setup(overrides: Partial<ServiceDeps> = {}) {
  const repository = new MemoryScapeRepository();
  const scape = fixtureScape();
  await repository.saveSnapshot(scape, 1);
  const operations = new Map<string, McpOperation>();
  const reviews: McpOperation[] = [];
  const deps: ServiceDeps = {
    library: {
      list: () => repository.list(),
      get: (id) => repository.get(id),
      create: (name) => repository.create(name),
      duplicate: (id) => repository.duplicate(id),
      remove: (id) => repository.remove(id),
      async commit(operation, next?: Scape) {
        if (next) await repository.saveSnapshot(next, Date.now() + Math.random());
        operations.set(operation.key, structuredClone(operation));
      },
    },
    operations: {
      get: async (key) => structuredClone(operations.get(key)),
      put: async (op) => void operations.set(op.key, structuredClone(op)),
      forScape: async (id, offset, limit) =>
        [...operations.values()].filter((op) => op.scapeId === id).slice(offset, offset + limit),
    },
    live: () => null,
    requestReview: (op) => reviews.push(op),
    capabilities: () => [{ type: "note", hint: "A note", example: { body: "" } }],
    markdown: (s) => `# ${s.name}`,
    ...overrides,
  };
  return { service: createCommandService(deps), repository, scape, reviews };
}

const note = (id: string) => ({
  type: "CreateObject",
  id,
  objectType: "note",
  title: `Note ${id}`,
  data: { body: "hello" },
});

describe("command service", () => {
  it("lists only the scapes a grant allows", async () => {
    const { service, repository, scape } = await setup();
    await repository.create("Other");
    const all = await service.execute(call("list_scapes", {}));
    expect((all.scapes as unknown[]).length).toBe(2);
    const limited = await service.execute(call("list_scapes", {}, grant({ scapes: [scape.id] })));
    expect(limited.scapes).toEqual([expect.objectContaining({ scape_id: scape.id })]);
  });

  it("hides scapes outside the grant, as not found rather than forbidden", async () => {
    const { service, scape } = await setup();
    const result = await service.execute(
      call("get_scape", { scape_id: scape.id }, grant({ scapes: ["scp_other"] })),
    );
    expect(result).toMatchObject({ status: "failed", error: "not_found" });
  });

  it("applies a batch atomically, lays out new objects and records a revertible receipt", async () => {
    const { service, repository, scape } = await setup();
    const before = scape.objectOrder.length;
    const applied = await service.execute(
      call("apply_changes", {
        scape_id: scape.id,
        actions: [
          note("n1"),
          { type: "ConnectObjects", id: "r1", from: "n1", to: scape.objectOrder[0] },
        ],
      }),
    );
    expect(applied).toMatchObject({ status: "applied" });
    const stored = (await repository.get(scape.id))!;
    expect(stored.objectOrder.length).toBe(before + 1);
    expect(stored.relationships.r1).toBeTruthy();

    const reverted = await service.execute(
      call("revert_operation", { scape_id: scape.id, operation_id: applied.operation_id }),
    );
    expect(reverted).toMatchObject({ status: "applied" });
    const restored = (await repository.get(scape.id))!;
    expect(restored.objectOrder.length).toBe(before);
    expect(restored.relationships.r1).toBeUndefined();
  });

  it("applies nothing when any change in the batch is invalid", async () => {
    const { service, repository, scape } = await setup();
    const result = await service.execute(
      call("apply_changes", {
        scape_id: scape.id,
        actions: [note("n1"), { type: "DeleteObject", id: "missing" }],
      }),
    );
    expect(result).toMatchObject({ status: "failed", error: "not_found" });
    expect((await repository.get(scape.id))!.objects.n1).toBeUndefined();
  });

  it("returns the stored outcome for a repeated idempotency key", async () => {
    const { service, repository, scape } = await setup();
    const args = { scape_id: scape.id, idempotency_key: "k1", actions: [note("n1")] };
    const first = await service.execute(call("apply_changes", args));
    const second = await service.execute(call("apply_changes", args));
    expect(second).toEqual(first);
    expect((await repository.get(scape.id))!.objectOrder.filter((id) => id === "n1")).toHaveLength(
      1,
    );
    const conflict = await service.execute(
      call("apply_changes", { ...args, actions: [note("n2")] }),
    );
    expect(conflict).toMatchObject({ error: "idempotency_conflict" });
  });

  it("rejects a stale expected revision", async () => {
    const { service, scape } = await setup();
    const result = await service.execute(
      call("apply_changes", {
        scape_id: scape.id,
        expected_revision: "stale",
        actions: [note("n1")],
      }),
    );
    expect(result).toMatchObject({ error: "revision_conflict" });
  });

  it("holds review-mode batches until the person approves", async () => {
    const { service, repository, scape, reviews } = await setup();
    const pending = await service.execute(
      call(
        "apply_changes",
        { scape_id: scape.id, actions: [note("n1")] },
        grant({ mode: "review" }),
      ),
    );
    expect(pending.status).toBe("awaiting_review");
    expect(reviews).toHaveLength(1);
    expect((await repository.get(scape.id))!.objects.n1).toBeUndefined();

    const status = await service.execute(
      call("get_operation", { operation_id: pending.operation_id }),
    );
    expect(status.status).toBe("awaiting_review");

    await service.resolveReview(pending.operation_id as string, true);
    expect((await repository.get(scape.id))!.objects.n1).toBeTruthy();
    const done = await service.execute(
      call("get_operation", { operation_id: pending.operation_id }),
    );
    expect(done.status).toBe("applied");
  });

  it("always asks before deleting a scape, even in direct mode", async () => {
    const { service, repository, scape } = await setup();
    const pending = await service.execute(call("delete_scape", { scape_id: scape.id }));
    expect(pending.status).toBe("awaiting_review");
    expect(await repository.get(scape.id)).toBeTruthy();
    await service.resolveReview(pending.operation_id as string, false);
    expect(await repository.get(scape.id)).toBeTruthy();
  });

  it("refuses writes on a read-only connection", async () => {
    const { service, scape } = await setup();
    const result = await service.execute(
      call("apply_changes", { scape_id: scape.id, actions: [note("n1")] }, grant({ write: false })),
    );
    expect(result).toMatchObject({ error: "forbidden" });
  });

  it("routes writes to the open editor instead of the stored snapshot", async () => {
    let live = fixtureScape();
    const applied: unknown[] = [];
    const { service, repository, scape } = await setup({
      live: (id) =>
        id === live.id
          ? {
              current: () => live,
              canWrite: () => true,
              apply: async (payloads, _tx, layout) => {
                applied.push({ payloads, layout });
                live = { ...live, name: "changed in editor" };
                return { inverses: [] };
              },
              focus: () => undefined,
              selection: () => [],
            }
          : null,
    });
    const result = await service.execute(
      call("apply_changes", { scape_id: scape.id, actions: [note("n1")] }),
    );
    expect(result.status).toBe("applied");
    expect(applied).toEqual([{ payloads: [expect.objectContaining({ id: "n1" })], layout: "LR" }]);
    expect((await repository.get(scape.id))!.objects.n1).toBeUndefined();
  });

  it("searches and fetches by the returned ID", async () => {
    const { service, scape } = await setup();
    const first = scape.objects[scape.objectOrder[0]];
    const found = await service.execute(
      call("search", { scape_id: scape.id, query: first.title.slice(0, 6) }),
    );
    const hit = (found.results as { id: string }[])[0];
    const fetched = await service.execute(call("fetch", { id: hit.id }));
    expect(fetched.status).toBe("ok");
    expect(fetched.object).toBeTruthy();
  });
});
