import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, type Mounted } from "@/test/react";
import { useScapeStore } from "@/core/store";
import { MemoryScapeRepository } from "@/persistence/memoryRepository";
import type { Scape } from "@/core/types";

const holder = vi.hoisted(() => ({ repo: null as unknown }));
vi.mock("@/persistence/scapeRepository", () => ({
  get scapeRepository() {
    return holder.repo;
  },
}));
vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
  ReactFlow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Background: () => null,
  Controls: () => null,
  useReactFlow: () => ({ fitView: vi.fn() }),
}));
vi.mock("@/viewer/ViewerNode", () => ({ VIEWER_NODE_TYPE: "preview", ViewerNode: () => null }));
import { HistoryWorkspace } from "./HistoryWorkspace";

let repo: MemoryScapeRepository, current: Scape, mounted: Mounted | undefined;
const close = vi.fn();
beforeEach(async () => {
  repo = new MemoryScapeRepository();
  holder.repo = repo;
  close.mockReset();
  const original = await repo.create("First idea");
  await repo.history.capture(original, "manual", "Original idea");
  current = { ...original, name: "Latest idea" };
  await repo.saveSnapshot(current, 1);
  useScapeStore.getState().loadScape(current);
  useScapeStore.getState().setHistoryPreview(true);
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  useScapeStore.getState().setHistoryPreview(false);
  vi.restoreAllMocks();
});
async function mount() {
  await act(async () => {
    mounted = render(
      <HistoryWorkspace
        current={current}
        canWrite={() => true}
        flush={async () => {}}
        onClose={close}
      />,
    );
  });
}
async function click(text: string) {
  const button = [...mounted!.container.querySelectorAll("button")].find((b) =>
    b.textContent?.trim().startsWith(text),
  );
  if (!button) throw new Error(`Missing ${text}`);
  await act(async () => {
    button.click();
  });
}
it("browses snapshots without changing live state and requires confirmation before restore", async () => {
  await mount();
  const before = useScapeStore.getState().scape;
  await click("Original idea");
  expect(useScapeStore.getState().scape).toBe(before);
  expect(mounted!.container.textContent).toContain("Scape name");
  await click("Restore this version");
  expect((await repo.get(current.id))?.name).toBe("Latest idea");
  await click("Confirm restore");
  expect((await repo.get(current.id))?.name).toBe("First idea");
  expect(useScapeStore.getState().scape?.name).toBe("First idea");
  expect(close).toHaveBeenCalledOnce();
});
it("keeps the preview and live state intact after a failed restore", async () => {
  await mount();
  await click("Original idea");
  vi.spyOn(repo.history, "restore").mockRejectedValueOnce(new Error("Storage unavailable"));
  await click("Restore this version");
  await click("Confirm restore");
  expect(mounted!.container.querySelector('[role="alert"]')?.textContent).toBe(
    "Storage unavailable",
  );
  expect(useScapeStore.getState().scape?.name).toBe("Latest idea");
  expect(close).not.toHaveBeenCalled();
});
it("still lists existing versions when a new checkpoint cannot be captured", async () => {
  vi.spyOn(repo.history, "capture").mockRejectedValueOnce(new Error("History is full"));
  await mount();
  expect(mounted!.container.textContent).toContain("History is full");
  expect(mounted!.container.textContent).toContain("Original idea");
});
