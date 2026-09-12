import { describe, expect, it } from "vitest";
import {
  annotations,
  approvalTools,
  byteLength,
  changeSchema,
  descriptions,
  failure,
  toolSchemas,
  writes,
  type ToolName,
} from "./contracts";

const create = (over: Record<string, unknown> = {}) => ({
  type: "CreateObject",
  id: "obj_a",
  objectType: "note",
  title: "A note",
  data: { body: "hello" },
  ...over,
});

describe("changeSchema", () => {
  it("accepts one branch per object type, validating data against that type's schema", () => {
    expect(changeSchema.safeParse(create()).success).toBe(true);
    expect(
      changeSchema.safeParse(
        create({ objectType: "journey", data: { steps: [{ id: "s1", label: "Sign up" }] } }),
      ).success,
    ).toBe(true);
    expect(
      changeSchema.safeParse(create({ objectType: "scape", data: { body: "# Brief" } })).success,
    ).toBe(true);

    // A note's data is not a journey's data, even though both are objects.
    expect(changeSchema.safeParse(create({ data: { steps: [] } })).success).toBe(false);
    expect(
      changeSchema.safeParse(create({ objectType: "journey", data: { body: "hello" } })).success,
    ).toBe(false);
  });

  it("rejects an object type that has no plugin", () => {
    expect(changeSchema.safeParse(create({ objectType: "wireframes" })).success).toBe(false);
    expect(changeSchema.safeParse(create({ objectType: "__proto__" })).success).toBe(false);
  });

  /** The locked rule: a model emits objects and relationships, never coordinates. */
  it("rejects coordinates smuggled onto any change", () => {
    expect(changeSchema.safeParse(create({ x: 10, y: 20 })).success).toBe(false);
    expect(changeSchema.safeParse({ type: "MoveObject", id: "obj_a", x: 1, y: 2 }).success).toBe(
      false,
    );
    expect(
      changeSchema.safeParse({ type: "UpdateObject", id: "obj_a", patch: { title: "T", x: 1 } })
        .success,
    ).toBe(false);
  });

  it("rejects unknown keys rather than silently dropping them", () => {
    expect(changeSchema.safeParse(create({ owner: "someone-else" })).success).toBe(false);
    expect(
      changeSchema.safeParse({ type: "DeleteObject", id: "obj_a", cascade: true }).success,
    ).toBe(false);
  });

  it("constrains ids to an opaque, path-safe alphabet", () => {
    for (const id of ["", "obj a", "../../etc/passwd", "obj/a", "obj.a", "a".repeat(129)]) {
      expect(changeSchema.safeParse(create({ id })).success).toBe(false);
    }
    expect(changeSchema.safeParse(create({ id: "a".repeat(128) })).success).toBe(true);
  });

  it("accepts the relationship and rename branches", () => {
    expect(
      changeSchema.safeParse({ type: "ConnectObjects", id: "r1", from: "a", to: "b" }).success,
    ).toBe(true);
    expect(
      changeSchema.safeParse({
        type: "ConnectObjects",
        id: "r1",
        from: "a",
        to: "b",
        label: "then",
      }).success,
    ).toBe(true);
    expect(changeSchema.safeParse({ type: "DisconnectObjects", id: "r1" }).success).toBe(true);
    expect(changeSchema.safeParse({ type: "RenameScape", name: "Onboarding" }).success).toBe(true);
    expect(changeSchema.safeParse({ type: "RenameScape", name: "" }).success).toBe(false);
  });
});

describe("tool schemas", () => {
  it("requires an idempotency key and an expected revision on every mutation", () => {
    const parsed = toolSchemas.apply_changes.safeParse({
      connection_id: "cx_1",
      scape_id: "scp_1",
      actions: [create()],
    });
    expect(parsed.success).toBe(false);

    expect(
      toolSchemas.apply_changes.safeParse({
        connection_id: "cx_1",
        scape_id: "scp_1",
        idempotency_key: "key_1",
        expected_revision: "abc",
        actions: [create()],
      }).success,
    ).toBe(true);
  });

  it("bounds batch size and page size so one call cannot ask for the world", () => {
    const batch = (count: number) => ({
      connection_id: "cx_1",
      scape_id: "scp_1",
      idempotency_key: "key_1",
      expected_revision: "abc",
      actions: Array.from({ length: count }, (_, index) => create({ id: `obj_${index}` })),
    });
    expect(toolSchemas.apply_changes.safeParse(batch(0)).success).toBe(false);
    expect(toolSchemas.apply_changes.safeParse(batch(100)).success).toBe(true);
    expect(toolSchemas.apply_changes.safeParse(batch(101)).success).toBe(false);

    const page = (limit: number) =>
      toolSchemas.search.safeParse({
        connection_id: "cx_1",
        scape_id: "scp_1",
        query: "kyc",
        limit,
      });
    expect(page(20).success).toBe(true);
    expect(page(21).success).toBe(false);
    expect(page(0).success).toBe(false);
  });

  it("defaults pagination so a caller that omits it still gets a bounded page", () => {
    const parsed = toolSchemas.search.parse({
      connection_id: "cx_1",
      scape_id: "scp_1",
      query: "kyc",
    });
    expect(parsed).toMatchObject({ offset: 0, limit: 20 });
  });

  it("requires explicit targeting on every scoped tool, so there is no implicit active scape", () => {
    const scoped = Object.entries(toolSchemas).filter(
      ([name]) => name !== "get_capabilities" && name !== "list_connected_scapes",
    );
    for (const [name, schema] of scoped) {
      expect(schema.safeParse({}).success, `${name} accepted an unscoped call`).toBe(false);
    }
    expect(toolSchemas.get_capabilities.safeParse({}).success).toBe(true);
    expect(toolSchemas.list_connected_scapes.safeParse({}).success).toBe(true);
  });
});

describe("tool metadata", () => {
  const names = Object.keys(toolSchemas) as ToolName[];

  it("describes every tool", () => {
    for (const name of names) {
      expect(descriptions[name], name).toBeTruthy();
    }
    expect(Object.keys(descriptions)).toHaveLength(names.length);
  });

  it("annotates reads as read-only and writes as not", () => {
    expect(annotations("get_scape")).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(annotations("apply_changes")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(annotations("publish_scape").openWorldHint).toBe(true);
    expect(annotations("get_scape").openWorldHint).toBe(false);
  });

  it("keeps writes and approvalTools consistent with the tool list", () => {
    for (const name of [...writes, ...approvalTools]) expect(names).toContain(name);
    // Anything needing in-app approval is, by definition, a write.
    for (const name of approvalTools) expect(writes.has(name)).toBe(true);
  });
});

describe("helpers", () => {
  it("builds a failed outcome that carries the code as its own message by default", () => {
    expect(failure("browser_unavailable")).toEqual({
      status: "failed",
      error: "browser_unavailable",
      message: "browser_unavailable",
    });
    expect(failure("conflict", "The scape changed. Read it again.").message).toBe(
      "The scape changed. Read it again.",
    );
  });

  it("measures bytes as UTF-8, not as characters", () => {
    expect(byteLength("ab")).toBe(4); // JSON quotes count
    expect(byteLength("é")).toBeGreaterThan(byteLength("e"));
  });
});
