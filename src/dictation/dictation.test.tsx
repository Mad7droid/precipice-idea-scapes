import "fake-indexeddb/auto";
import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/react";
import { useScapeStore } from "@/core/store";
import { SETTING_KEYS, type Scape } from "@/core/types";
import { settingsRepository } from "@/persistence/settings";
import {
  dictationEngine,
  setDictationEngineForTests,
  type DictationEngine,
  type DictationHandlers,
  type DictationStatus,
} from "./engine";
import { MicButton } from "./MicButton";
import { useDictation } from "./useDictation";
import { appendPhrase, dictationVocabulary } from "./vocabulary";

function fakeEngine(initial: DictationStatus) {
  let handlers: DictationHandlers[] = [];
  const engine: DictationEngine = {
    status: vi.fn(async () => initial),
    install: vi.fn(async () => {}),
    cancelInstall: vi.fn(async () => {}),
    prepare: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    subscribe: (h) => {
      handlers.push(h);
      return () => (handlers = handlers.filter((x) => x !== h));
    },
  };
  const emit = {
    status: (s: DictationStatus) => act(() => handlers.forEach((h) => h.status?.(s))),
    phrase: (t: string) => act(() => handlers.forEach((h) => h.phrase?.(t))),
  };
  return { engine, emit };
}

function Harness() {
  const [draft, setDraft] = useState("Draft:");
  const dictation = useDictation((phrase) => setDraft((d) => appendPhrase(d, phrase)));
  return (
    <div>
      <output>{draft}</output>
      <MicButton dictation={dictation} />
    </div>
  );
}

const flush = () => act(async () => {});
const button = (root: HTMLElement) => root.querySelector("button")!;

afterEach(() => setDictationEngineForTests(null));

describe("dictation vocabulary", () => {
  it("lists the scape's own words, deduplicated and bounded", () => {
    const scape = {
      name: "Launch",
      objectOrder: ["a", "b"],
      objects: {
        a: { title: "Roadmap", tags: ["Q3"] },
        b: { title: "Roadmap", tags: [] },
      },
    } as unknown as Scape;
    expect(dictationVocabulary(scape)).toBe("Precipice, Scapi, scape, Launch, Roadmap, Q3");
    const big = {
      name: "x",
      objectOrder: Array.from({ length: 200 }, (_, i) => `${i}`),
      objects: Object.fromEntries(
        Array.from({ length: 200 }, (_, i) => [`${i}`, { title: `Card number ${i}` }]),
      ),
    } as unknown as Scape;
    expect(dictationVocabulary(big).length).toBeLessThanOrEqual(600);
  });

  it("appends phrases with single spacing", () => {
    expect(appendPhrase("", " Hello ")).toBe("Hello");
    expect(appendPhrase("Hello", "world")).toBe("Hello world");
    expect(appendPhrase("Hello\n", "world")).toBe("Hello\nworld");
    expect(appendPhrase("Hello", "  ")).toBe("Hello");
  });
});

describe("mic button", () => {
  it("is absent where dictation cannot run", async () => {
    expect((await dictationEngine().status()).kind).toBe("unavailable");
    const view = render(<Harness />);
    await flush();
    expect(view.container.querySelector("button")).toBeNull();
    view.unmount();
  });

  it("asks before downloading the model", async () => {
    const { engine } = fakeEngine({ kind: "needs-model", bytes: 574_041_195 });
    setDictationEngineForTests(engine);
    const view = render(<Harness />);
    await flush();
    act(() => button(view.container).click());
    expect(view.container.textContent).toContain("574 MB");
    expect(engine.install).not.toHaveBeenCalled();
    const download = [...view.container.querySelectorAll("button")].find(
      (b) => b.textContent === "Download",
    )!;
    act(() => download.click());
    expect(engine.install).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("starts in the chosen language, appends phrases, and never sends", async () => {
    await settingsRepository.set(SETTING_KEYS.dictationLanguage, "hi");
    useScapeStore.setState({ scape: null });
    const { engine, emit } = fakeEngine({ kind: "ready" });
    setDictationEngineForTests(engine);
    const view = render(<Harness />);
    await flush();
    await act(async () => button(view.container).click());
    expect(engine.start).toHaveBeenCalledWith({
      language: "hi",
      prompt: "Precipice, Scapi, scape",
    });
    expect(button(view.container).getAttribute("aria-label")).toBe("Stop dictation");
    emit.phrase("कल की बैठक");
    emit.phrase("for notes");
    expect(view.container.querySelector("output")!.textContent).toBe("Draft: कल की बैठक for notes");
    act(() => button(view.container).click());
    expect(engine.stop).toHaveBeenCalledOnce();
    emit.status({ kind: "ready" });
    expect(button(view.container).getAttribute("aria-label")).toBe("Dictate");
    view.unmount();
  });

  it("discards on Escape and ignores another composer's session", async () => {
    const { engine, emit } = fakeEngine({ kind: "ready" });
    setDictationEngineForTests(engine);
    const view = render(<Harness />);
    await flush();
    // Someone else's session: phrases are not ours to take.
    emit.status({ kind: "listening" });
    emit.phrase("not mine");
    expect(view.container.querySelector("output")!.textContent).toBe("Draft:");
    emit.status({ kind: "ready" });

    await act(async () => button(view.container).click());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(engine.cancel).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("explains an error that ends a session", async () => {
    const { engine, emit } = fakeEngine({ kind: "ready" });
    setDictationEngineForTests(engine);
    const view = render(<Harness />);
    await flush();
    await act(async () => button(view.container).click());
    emit.status({ kind: "error", message: "Microphone access is off." });
    expect(view.container.textContent).toContain("Microphone access is off.");
    view.unmount();
  });
});
