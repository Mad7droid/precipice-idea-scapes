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
  return { service: createCommandService(deps), repository, scape, reviews, operations, deps };
}

const note = (id: string) => ({
  type: "CreateObject",
  id,
  objectType: "note",
  title: `Note ${id}`,
  data: { body: "hello" },
});

function previewAuth(result: Record<string, any>) {
  return {
    scape_id: result.scape_id,
    preview_id: result.operation_id,
    confirmation_token: result._meta.confirmation_token,
  };
}

describe("chat flow previews", () => {
  it("keeps a new flow out of the library until chat confirmation, then commits it once", async () => {
    const { service, repository, reviews } = await setup();
    const before = await repository.list();
    const preview = await service.execute(
      call("preview_flow", { name: "Signup", actions: [note("signup")] }),
    );
    expect(preview).toMatchObject({ status: "preview", objects: 1 });
    expect(await repository.list()).toEqual(before);
    expect(reviews).toHaveLength(0);
    const args = { ...previewAuth(preview), approve: true };
    const [first, second] = await Promise.all([
      service.execute(call("confirm_flow", args, grant({ mode: "review" }))),
      service.execute(call("confirm_flow", args, grant({ mode: "review" }))),
    ]);
    expect(first).toMatchObject({ status: "applied", scape_id: preview.scape_id });
    expect(second).toEqual(first);
    expect(await repository.list()).toHaveLength(before.length + 1);
    const stored = await repository.get(String(preview.scape_id));
    expect(stored?.objects.signup.data).toEqual({ body: "hello" });
    expect(stored?.objects.signup.x).toBe(
      preview._meta && (preview._meta as any).preview.objects[0].x,
    );
  });

  it("previews existing edits without mutating, rejects a stale draft and commits a fresh draft as one revertible batch", async () => {
    const { service, repository, scape } = await setup();
    const preview = await service.execute(
      call("preview_flow", { scape_id: scape.id, actions: [note("new_note")] }),
    );
    expect((await repository.get(scape.id))?.objects.new_note).toBeUndefined();
    await service.execute(call("apply_changes", { scape_id: scape.id, actions: [note("other")] }));
    expect(
      await service.execute(call("confirm_flow", { ...previewAuth(preview), approve: true })),
    ).toMatchObject({ error: "revision_conflict" });
    const fresh = await service.execute(
      call("preview_flow", { scape_id: scape.id, actions: [note("new_note")] }),
    );
    const done = await service.execute(
      call("confirm_flow", { ...previewAuth(fresh), approve: true }),
    );
    expect(done.status).toBe("applied");
    expect(
      await service.execute(
        call("revert_operation", { scape_id: scape.id, operation_id: done.operation_id }),
      ),
    ).toMatchObject({ status: "applied" });
    expect((await repository.get(scape.id))?.objects.new_note).toBeUndefined();
    expect((await repository.get(scape.id))?.objects.other).toBeTruthy();
  });

  it("binds confirmation to a private capability, originating connection, host and target", async () => {
    const { service, repository, scape } = await setup();
    const preview = await service.execute(
      call("preview_flow", { scape_id: scape.id, actions: [note("protected")] }),
    );
    const args = { ...previewAuth(preview), approve: true };
    for (const [changed, g] of [
      [{ ...args, confirmation_token: "wrong" }, grant()],
      [{ ...args, scape_id: "other" }, grant()],
      [args, grant({ clientId: "other" })],
      [args, grant({ host: "desktop" })],
      [args, grant({ scapes: [] })],
    ] as const)
      expect(await service.execute(call("confirm_flow", changed, g))).toMatchObject({
        error: "not_found",
      });
    expect(
      await service.execute(call("confirm_flow", args, grant({ write: false }))),
    ).toMatchObject({ error: "forbidden" });
    expect(
      await service.execute(call("confirm_flow", { ...args, actions: [note("replacement")] })),
    ).toMatchObject({ status: "failed" });
    expect((await repository.get(scape.id))?.objects.protected).toBeUndefined();
  });

  it("cannot use the preview confirmation path to approve a pending publishing or deletion request", async () => {
    const { service, scape } = await setup();
    const pending = await service.execute(call("delete_scape", { scape_id: scape.id }));
    expect(
      await service.execute(
        call("confirm_flow", {
          scape_id: scape.id,
          preview_id: pending.operation_id,
          confirmation_token: "anything",
          approve: true,
        }),
      ),
    ).toMatchObject({ error: "not_found" });
  });

  it("expires drafts and makes discard terminal without creating an empty scape", async () => {
    let now = 1000;
    const { service, repository } = await setup({ now: () => now });
    const preview = await service.execute(call("preview_flow", { actions: [note("expired")] }));
    now += 11 * 60_000;
    expect(
      await service.execute(call("confirm_flow", { ...previewAuth(preview), approve: true })),
    ).toMatchObject({ error: "expired" });
    const fresh = await service.execute(call("preview_flow", { actions: [note("discarded")] }));
    expect(
      await service.execute(call("confirm_flow", { ...previewAuth(fresh), approve: false })),
    ).toMatchObject({ status: "cancelled" });
    expect(
      await service.execute(call("confirm_flow", { ...previewAuth(fresh), approve: true })),
    ).toMatchObject({ status: "cancelled" });
    expect(await repository.list()).toHaveLength(1);
  });

  it("persists drafts across service restarts and honors the original capability", async () => {
    const { service, deps, repository } = await setup();
    const preview = await service.execute(call("preview_flow", { actions: [note("restored")] }));
    const restarted = createCommandService(deps);
    expect(
      await restarted.execute(call("confirm_flow", { ...previewAuth(preview), approve: true })),
    ).toMatchObject({ status: "applied" });
    expect((await repository.get(String(preview.scape_id)))?.objects.restored).toBeTruthy();
  });

  it("permits read-only inspection but not creation or sharing, and limits new drafts to all-scapes grants", async () => {
    const { service, scape } = await setup();
    expect(
      await service.execute(
        call("preview_flow", { actions: [note("new")] }, grant({ scapes: [scape.id] })),
      ),
    ).toMatchObject({ status: "failed" });
    const g = grant({ write: false, scapes: [scape.id] });
    const preview = await service.execute(
      call("preview_flow", { scape_id: scape.id, actions: [note("read_only")] }, g),
    );
    expect(preview.status).toBe("preview");
    expect((preview._meta as any).can_write).toBe(false);
    expect(
      await service.execute(call("share_flow_preview", previewAuth(preview), g)),
    ).toMatchObject({ error: "forbidden" });
  });

  it("shares only after explicit chat disclosure, deduplicates sharing, and permits withdrawal after expiry", async () => {
    let now = 1000;
    const shares: any[] = [];
    const { service, repository } = await setup({
      now: () => now,
      sharePreview: async (scape, existing, withdraw) => {
        shares.push({ scape, existing, withdraw });
        return withdraw
          ? { message: "Withdrawn" }
          : {
              publication_id: "pub_preview",
              url: "https://example.test/p/pub_preview",
              iframe: "<iframe></iframe>",
            };
      },
    });
    const preview = await service.execute(call("preview_flow", { actions: [note("public")] }));
    expect(shares).toHaveLength(0);
    const args = previewAuth(preview);
    const shared = await service.execute(call("share_flow_preview", args));
    expect(shared).toMatchObject({ status: "ok", publication_id: "pub_preview" });
    expect(await service.execute(call("share_flow_preview", args))).toEqual(shared);
    expect(shares).toHaveLength(1);
    expect(shares[0].scape.objects.public.data).toEqual({ body: "hello" });
    expect(await repository.list()).toHaveLength(1);
    expect(
      await service.execute(call("get_operation", { operation_id: preview.operation_id })),
    ).toMatchObject({
      status: "preview",
      _meta: { share: { publication_id: "pub_preview" } },
    });
    expect(
      await service.execute(
        call("get_operation", { operation_id: preview.operation_id }, grant({ clientId: "other" })),
      ),
    ).toMatchObject({ error: "not_found" });
    now += 11 * 60_000;
    expect(
      await service.execute(call("share_flow_preview", { ...args, withdraw: true })),
    ).toMatchObject({ status: "ok" });
    expect(shares[1]).toMatchObject({ existing: "pub_preview", withdraw: true });
    expect(await service.execute(call("share_flow_preview", args))).toMatchObject({
      error: "expired",
    });
  });
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

describe("concurrent agent calls", () => {
  it("keeps both simultaneous write batches", async () => {
    const { service, repository, scape } = await setup();
    const results = await Promise.all(
      ["parallel_a", "parallel_b"].map((id) =>
        service.execute(call("apply_changes", { scape_id: scape.id, actions: [note(id)] })),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
    const stored = (await repository.get(scape.id))!;
    expect(stored.objects.parallel_a).toBeTruthy();
    expect(stored.objects.parallel_b).toBeTruthy();
  });
  it("lets clients retrieve an idempotent operation by the returned key", async () => {
    const { service, scape } = await setup();
    const args = {
      scape_id: scape.id,
      idempotency_key: "retry_key",
      actions: [note("retry_note")],
    };
    const [first, second] = await Promise.all([
      service.execute(call("apply_changes", args)),
      service.execute(call("apply_changes", args)),
    ]);
    expect(second).toEqual(first);
    expect(
      await service.execute(call("get_operation", { operation_id: first.operation_id })),
    ).toEqual(first);
  });
  it("does not approve expired review cards", async () => {
    let now = 1000;
    const { service, scape, repository } = await setup({ now: () => now });
    const result = await service.execute(
      call(
        "apply_changes",
        { scape_id: scape.id, actions: [note("expired_note")] },
        grant({ mode: "review" }),
      ),
    );
    now += 11 * 60_000;
    expect(await service.resolveReview(result.operation_id!, true)).toMatchObject({
      error: "expired",
    });
    expect((await repository.get(scape.id))!.objects.expired_note).toBeUndefined();
  });
});

it("publishing always waits for confirmation, even for a trusted agent", async () => {
  let published = false;
  const { service, scape } = await setup({
    publish: async () => {
      published = true;
      return { url: "https://example.test/public" };
    },
  });
  const result = await service.execute(call("publish_scape", { scape_id: scape.id }));
  expect(result.status).toBe("awaiting_review");
  expect(published).toBe(false);
  expect(await service.resolveReview(result.operation_id!, true)).toMatchObject({
    status: "applied",
    url: "https://example.test/public",
  });
  expect(published).toBe(true);
});
