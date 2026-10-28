import "fake-indexeddb/auto";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyScape } from "@/core/fixtures";
import { useScapeStore } from "@/core/store";
import { scapeRepository } from "@/persistence/scapeRepository";
import { nextSnapshotSeq } from "@/persistence/sequence";
import { render, type as typeInto, type Mounted } from "@/test/react";
import { Editor } from "./Editor";

vi.mock("@/persistence/scapeRepository", async () => {
  const { MemoryScapeRepository } = await import("@/persistence/memoryRepository");
  return { scapeRepository: new MemoryScapeRepository() };
});
vi.mock("@/persistence/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/persistence/settings")>();
  const { MemorySettingsRepository } = await import("@/persistence/memoryRepository");
  return { ...actual, settingsRepository: new MemorySettingsRepository() };
});
vi.mock("@/persistence/lease", () => ({
  acquireScapeLease: () => ({
    status: () => "holder",
    settled: Promise.resolve("holder"),
    stop() {},
    async takeOver() {},
  }),
}));
vi.mock("@/mcp/bridge", () => ({ useMcpBridge: () => ({}) }));
vi.mock("@/components/scapi/Scapi", () => ({ Scapi: () => null }));
vi.mock("./useAppSettings", () => {
  const settings = {
    apiKey: "",
    aiReady: false,
    ready: true,
    modelId: "claude-sonnet-4-6",
    models: [],
    types: [],
    instructions: "",
    routeChips: false,
    jevRouting: false,
    jevOnly: false,
    jevKey: "",
    credentials: { desktop: false },
    connection: {
      provider: "anthropic",
      providers: ["anthropic"],
      status: "disconnected",
      models: [],
      chatgpt: { available: false, models: [] },
      claude: { checked: false },
    },
  };
  return { useAppSettings: () => settings };
});

const store = () => useScapeStore.getState();
let mounted: Mounted | undefined;

beforeEach(async () => {
  vi.useFakeTimers();
  store().loadScape(null);
  for (const scape of await scapeRepository.list()) await scapeRepository.remove(scape.id);
  await scapeRepository.saveSnapshot(
    emptyScape("scp_focus", "Fictional focus test"),
    nextSnapshotSeq(),
  );
  await act(async () => {
    mounted = render(<Editor scapeId="scp_focus" />);
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
});

function key(key: string) {
  const surface = mounted!.container.querySelector(".react-flow")!.parentElement!;
  act(() => surface.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
}
function finishFocus() {
  // Creation defers inspector opening, then focuses after the panel has rendered.
  act(() => vi.advanceTimersByTime(1));
  act(() => vi.advanceTimersByTime(32));
}

describe("editor block focus", () => {
  it.each([
    ["n", "note"],
    ["j", "journey"],
    ["w", "wireframe"],
    ["s", "scape"],
  ])("%s creates a %s and puts typing in its title rather than tags", (shortcut, objectType) => {
    key(shortcut);
    finishFocus();
    const id = store().selection[0];
    expect(store().scape!.objects[id].type).toBe(objectType);
    const title = mounted!.container.querySelector<HTMLInputElement>(
      "input[placeholder='Untitled']",
    )!;
    expect(title).not.toBeNull();
    expect(document.activeElement).toBe(title);
    typeInto(title, "Fictional title jws");
    // Typing these letters in the focused field must not create blocks.
    for (const letter of "jws") {
      act(() => title.dispatchEvent(new KeyboardEvent("keydown", { key: letter, bubbles: true })));
    }
    act(() => vi.advanceTimersByTime(250));
    expect(store().scape!.objects[id].title).toBe("Fictional title jws");
    expect(store().scape!.objects[id].tags ?? []).toEqual([]);
    expect(store().scape!.objectOrder).toEqual([id]);
  });

  it("does not steal focus when selection changes before a scheduled focus runs", () => {
    key("n");
    finishFocus();
    const first = store().selection[0];
    key("j");
    act(() => vi.advanceTimersByTime(1));
    act(() => store().setSelection([first]));
    const otherField = document.createElement("input");
    document.body.appendChild(otherField);
    try {
      otherField.focus();
      act(() => vi.advanceTimersByTime(32));
      expect(document.activeElement).toBe(otherField);
    } finally {
      otherField.remove();
    }
  });

  it.each(["Enter", "double-click"])(
    "%s reopens a collapsed inspector and focuses content",
    (gesture) => {
      key("n");
      finishFocus();
      const title = document.activeElement as HTMLInputElement;
      act(() => title.blur());
      const collapse = mounted!.container.querySelector<HTMLButtonElement>(
        "[aria-label='Collapse inspector']",
      )!;
      act(() => collapse.click());
      if (gesture === "Enter") key("Enter");
      else {
        const node = mounted!.container.querySelector(".react-flow__node")!;
        act(() => node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
      }
      finishFocus();
      expect(document.activeElement).toBe(
        mounted!.container.querySelector("input[placeholder='Untitled']"),
      );
    },
  );
});
