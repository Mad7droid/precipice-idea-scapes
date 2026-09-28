import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { emptyScape } from "@/core/fixtures";
import { useScapeStore } from "@/core/store";
import { db } from "@/persistence/db";
import type { McpOperation } from "@/mcp/contracts";
import { liveEditor } from "./liveEditor";
const receipt = (): McpOperation => ({
  key: "op_live",
  scapeId: "live",
  command: { id: "call", tool: "apply_changes", args: {} },
  fingerprint: "fp",
  expiresAt: Date.now() + 60000,
  result: { status: "running" },
});
const changes = [
  {
    type: "CreateObject" as const,
    id: "note",
    objectType: "note",
    title: "A note",
    data: { body: "hello" },
  },
];
beforeEach(async () => {
  await db.scapes.clear();
  await db.mcpOperations.clear();
  await db.actions.clear();
  useScapeStore.getState().loadScape(emptyScape("live"));
});
it("persists before exposing a batch and puts its layout in the same undo step", async () => {
  const editor = liveEditor({
    scapeId: "live",
    canWrite: () => true,
    flush: async () => {},
    focus: () => {},
  });
  const operation = receipt();
  await editor.apply(changes, "tx_agent", "LR", operation);
  expect(useScapeStore.getState().scape!.objects.note).toBeTruthy();
  expect((await db.scapes.get("live"))!.snapshot.objects.note).toBeTruthy();
  expect((await db.mcpOperations.get(operation.key))!.result.status).toBe("applied");
  expect(useScapeStore.getState().undoStack).toHaveLength(1);
  useScapeStore.getState().undo();
  expect(useScapeStore.getState().scape!.objects.note).toBeUndefined();
});
it("does not change the canvas or persist when the write lease is lost", async () => {
  let writable = true;
  const editor = liveEditor({
    scapeId: "live",
    canWrite: () => writable,
    flush: async () => {
      writable = false;
    },
    focus: () => {},
  });
  await expect(editor.apply(changes, "tx_agent", null, receipt())).rejects.toThrow("read_only");
  expect(useScapeStore.getState().scape!.objects.note).toBeUndefined();
  expect(await db.mcpOperations.count()).toBe(0);
  expect(useScapeStore.getState().committing).toBe(false);
});
