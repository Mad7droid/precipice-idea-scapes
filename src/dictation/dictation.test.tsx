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
    level: (rms: number) => act(() => handlers.forEach((h) => h.level?.(rms))),
    phrase: (t: string) => act(() => handlers.forEach((h) => h.phrase?.(t))),
  };
  return { engine, emit };
}

function Harness() {
  const [draft, setDraft] = useState("Draft:");
  const dictation = useDictation((phrase) => setDraft((d) => appendPhrase(d, phrase)));
  return (
    <div>
      <textarea aria-label="Draft" value={draft} readOnly onKeyDown={dictation.handleShortcut} />
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
    await flush();
    expect(engine.cancel).toHaveBeenCalledOnce();
    view.unmount();
  });

  it("keeps delivered text and drops late phrases immediately on cancel", async () => {
    const { engine, emit } = fakeEngine({ kind: "ready" });
    setDictationEngineForTests(engine);
    const view = render(<Harness />);
    await flush();
    await act(async () => button(view.container).click());
    emit.phrase("keep this");
    act(() =>
      view.container.querySelector<HTMLButtonElement>('[aria-label="Cancel dictation"]')!.click(),
    );
    emit.phrase("late phrase");
    await flush();
    expect(engine.cancel).toHaveBeenCalledOnce();
    expect(view.container.querySelector("output")!.textContent).toBe("Draft: keep this");
    view.unmount();
  });

  it("toggles from the focused field without restarting on key repeat", async () => {
    const { engine } = fakeEngine({ kind: "ready" });
    setDictationEngineForTests(engine);
    const view = render(<Harness />);
    await flush();
    const field = view.container.querySelector("textarea")!;
    await act(async () =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", ctrlKey: true, shiftKey: true, bubbles: true }),
      ),
    );
    expect(engine.start).toHaveBeenCalledOnce();
    act(() =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          ctrlKey: true,
          shiftKey: true,
          repeat: true,
          bubbles: true,
        }),
      ),
    );
    expect(engine.stop).not.toHaveBeenCalled();
    act(() =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", metaKey: true, shiftKey: true, bubbles: true }),
      ),
    );
    expect(engine.stop).toHaveBeenCalledOnce();
    expect(button(view.container).disabled).toBe(true);
    view.unmount();
  });

  it("waits for startup before cancelling and prevents competing composers", async () => {
    const { engine, emit } = fakeEngine({ kind: "ready" });
    let finish!: () => void;
    engine.start = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    setDictationEngineForTests(engine);
    const first = render(<Harness />);
    const second = render(<Harness />);
    await flush();
    await act(async () => button(first.container).click());
    expect(button(first.container).getAttribute("aria-label")).toBe("Starting dictation");
    act(() => button(second.container).click());
    expect(engine.start).toHaveBeenCalledOnce();
    act(() =>
      first.container.querySelector<HTMLButtonElement>('[aria-label="Cancel dictation"]')!.click(),
    );
    expect(engine.cancel).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(engine.cancel).toHaveBeenCalledOnce();
    emit.phrase("cancelled");
    expect(first.container.querySelector("output")!.textContent).toBe("Draft:");
    first.unmount();
    second.unmount();
  });

  it("returns keyboard focus to the model prompt trigger on Escape", async () => {
    const { engine } = fakeEngine({ kind: "needs-model", bytes: 574_041_195 });
    setDictationEngineForTests(engine);
    const view = render(<Harness />);
    await flush();
    const trigger = button(view.container);
    act(() => trigger.click());
    expect(view.container.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(
      true,
    );
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(engine.install).not.toHaveBeenCalled();
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

it("updates the live meter without re-rendering the composer", async () => {
  const { engine, emit } = fakeEngine({ kind: "ready" });
  setDictationEngineForTests(engine);
  let renders = 0;
  let controls!: ReturnType<typeof useDictation>;
  function MeterProbe() {
    renders++;
    controls = useDictation(() => {});
    return <MicButton dictation={controls} />;
  }
  const view = render(<MeterProbe />);
  await flush();
  await act(async () => controls.toggle());
  const before = renders;
  const bars = () => [...view.container.querySelectorAll<HTMLElement>(".transition-transform")];
  const initial = bars().map((bar) => bar.style.transform);
  emit.level(0.2);
  expect(renders).toBe(before);
  expect(bars().map((bar) => bar.style.transform)).not.toEqual(initial);
  await act(async () => controls.cancel());
  view.unmount();
});
