import { act } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, type, byLabel, type Mounted } from "@/test/react";
import { emptyScape } from "@/core/fixtures";
import { useNotifications } from "@/core/notify";
import { Home } from "./Home";
import { scapeRepository } from "@/persistence/scapeRepository";
import { settingsRepository } from "@/persistence/settings";
import { deletePublication } from "@/publish/client";
import { navigate } from "./router";
import { downloadScape, importScape } from "@/persistence/portable";
import { exportScapePdf } from "@/export/pdf";
const mocks = vi.hoisted(() => ({ key: "", settings: {} as Record<string, unknown> }));
vi.mock("./useAppSettings", () => ({
  useAppSettings: () => ({
    apiKey: mocks.key,
    setApiKey: vi.fn(),
    ready: true,
    modelId: "test",
    setModelId: vi.fn(),
    types: [],
    setTypes: vi.fn(),
  }),
}));
vi.mock("@/persistence/scapeRepository", () => ({
  scapeRepository: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    duplicate: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    publications: { all: vi.fn(), get: vi.fn() },
  },
}));
vi.mock("@/persistence/settings", () => ({
  applyTheme: vi.fn(),
  settingsRepository: { all: vi.fn(), get: vi.fn(), set: vi.fn() },
}));
vi.mock("@/persistence/storage", () => ({
  requestPersistence: vi.fn(),
  warnIfStorageTight: vi.fn(),
}));
vi.mock("@/persistence/portable", () => ({ downloadScape: vi.fn(), importScape: vi.fn() }));
vi.mock("@/export/pdf", () => ({ exportScapePdf: vi.fn() }));
vi.mock("@/publish/client", () => ({ deletePublication: vi.fn() }));
vi.mock("@/publish/session", () => ({ readSession: () => ({ token: "test" }) }));
vi.mock("./router", () => ({ navigate: vi.fn(), scapeRoute: (id: string) => `/s/${id}` }));
vi.mock("./home/library", async (original) => ({
  ...(await original<typeof import("./home/library")>()),
  withHomeLease: (_id: string, operation: () => Promise<void>) => operation(),
}));
let view: Mounted;
const sample = {
  id: "a",
  name: "Alpha",
  updatedAt: 1,
  objectCount: 0,
  relationshipCount: 0,
  typeCounts: {},
};
const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const button = (label: string) =>
  [...view.container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label,
  )!;
const click = async (element: HTMLElement) => {
  expect(element).toBeTruthy();
  act(() => element.click());
  await flush();
};
async function mount() {
  view = render(<Home />);
  await flush();
}
async function menu(label: string) {
  await click(byLabel(view.container, "Actions for Alpha"));
  await click(button(label));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.key = "";
  mocks.settings = {};
  useNotifications.getState().clear();
  vi.mocked(scapeRepository.list).mockResolvedValue([]);
  vi.mocked(scapeRepository.publications.all).mockResolvedValue([]);
  vi.mocked(scapeRepository.publications.get).mockResolvedValue(undefined);
  vi.mocked(scapeRepository.get).mockResolvedValue({ ...emptyScape("a"), name: "Alpha" });
  vi.mocked(settingsRepository.get).mockResolvedValue(undefined);
  vi.mocked(settingsRepository.all).mockImplementation(async () => mocks.settings);
  vi.mocked(settingsRepository.set).mockImplementation(async (key, value) => {
    mocks.settings[key] = value;
  });
});
afterEach(() => {
  view?.unmount();
  vi.restoreAllMocks();
});
describe("home workflows", () => {
  it("guides first use and preserves the prompt and starter through missing-key settings", async () => {
    await mount();
    expect(view.container.textContent).toContain("Turn an idea into a working canvas");
    await click(
      [...view.container.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
        b.textContent?.startsWith("Product brief"),
      )!,
    );
    type(byLabel(view.container, "Prompt"), "A useful brief");
    await click(button("Generate"));
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(scapeRepository.create).not.toHaveBeenCalled();
    act(() =>
      view.container
        .querySelector('[role="dialog"]')!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(byLabel<HTMLTextAreaElement>(view.container, "Prompt").value).toBe("A useful brief");
    expect(view.container.querySelector('[aria-pressed="true"]')?.textContent).toContain(
      "Product brief",
    );
  });
  it("does not navigate after a failed save and prevents double creation", async () => {
    let resolve!: (scape: ReturnType<typeof emptyScape>) => void;
    vi.mocked(scapeRepository.create).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    vi.mocked(scapeRepository.get).mockResolvedValue(undefined);
    await mount();
    await click(button("Create without AI ↗"));
    act(() => button("Create without AI ↗").click());
    expect(scapeRepository.create).toHaveBeenCalledOnce();
    await act(async () => resolve(emptyScape("missing")));
    await flush();
    expect(navigate).not.toHaveBeenCalled();
    expect(useNotifications.getState().toasts.some((t) => t.level === "danger")).toBe(true);
  });
  it("shows returning users their library and persists pins and view preferences", async () => {
    vi.mocked(scapeRepository.list).mockResolvedValue([sample]);
    await mount();
    expect(view.container.textContent).toContain("Your workspace");
    await click(byLabel(view.container, "Pin Alpha"));
    expect(mocks.settings["home.pin.a"]).toBe(true);
    await click(button("List"));
    expect(mocks.settings["home.library"]).toEqual({ filter: "all", sort: "edited", view: "list" });
    expect(scapeRepository.rename).not.toHaveBeenCalled();
    type(byLabel(view.container, "Search scapes"), "missing");
    expect(view.container.textContent).toContain("No scapes match");
    await click(button("Clear filters"));
    expect(byLabel(view.container, "Actions for Alpha")).toBeTruthy();
  });
  it("cancels renaming without saving and restores focus", async () => {
    vi.mocked(scapeRepository.list).mockResolvedValue([sample]);
    await mount();
    await menu("Rename");
    type(byLabel(view.container, "Scape name"), "Changed");
    await click(button("Cancel"));
    expect(scapeRepository.rename).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Actions for Alpha");
  });
  it("keeps a published scape when unpublishing fails", async () => {
    const row = {
      scapeId: "a",
      publicationId: "p",
      status: "published" as const,
      version: 1,
      publishedHash: "hash",
      updatedAt: 1,
    };
    vi.mocked(scapeRepository.list).mockResolvedValue([sample]);
    vi.mocked(scapeRepository.publications.all).mockResolvedValue([row]);
    vi.mocked(scapeRepository.publications.get).mockResolvedValue(row);
    vi.mocked(deletePublication).mockRejectedValue(new Error("offline"));
    await mount();
    await menu("Delete");
    await click(button("Unpublish and delete"));
    expect(deletePublication).toHaveBeenCalledOnce();
    expect(scapeRepository.remove).not.toHaveBeenCalled();
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull();
  });
  it("exports both formats without opening the editor", async () => {
    vi.mocked(scapeRepository.list).mockResolvedValue([sample]);
    await mount();
    await menu("Export scape");
    await menu("Export PDF");
    expect(downloadScape).toHaveBeenCalledOnce();
    expect(exportScapePdf).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });
  it("reveals a duplicate and offers an explicit open action", async () => {
    vi.mocked(scapeRepository.list).mockResolvedValue([sample]);
    vi.mocked(scapeRepository.duplicate).mockResolvedValue({
      ...emptyScape("copy"),
      name: "Alpha copy",
    });
    await mount();
    await menu("Duplicate");
    expect(view.container.textContent).toContain("Created “Alpha copy”.");
    expect(mocks.settings["home.pin.copy"]).toBeUndefined();
    await click(button("Open copy"));
    expect(navigate).toHaveBeenCalledWith("/s/copy");
  });
  it("surfaces import failure without navigating", async () => {
    vi.mocked(importScape).mockRejectedValue(new Error("Invalid file"));
    await mount();
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [{ text: async () => "bad" }] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();
    expect(navigate).not.toHaveBeenCalled();
    expect(useNotifications.getState().toasts.some((t) => t.detail === "Invalid file")).toBe(true);
  });
  it("offers retry when loading fails", async () => {
    vi.mocked(scapeRepository.list).mockRejectedValueOnce(new Error("blocked"));
    await mount();
    expect(view.container.textContent).toContain("Could not load your library");
    await click(button("Retry"));
    expect(view.container.textContent).toContain("A home for your ideas");
  });
});
