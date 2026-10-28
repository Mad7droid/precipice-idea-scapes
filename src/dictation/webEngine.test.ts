import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTING_KEYS } from "@/core/types";
import { settingsRepository } from "@/persistence/settings";
import type { DictationStatus } from "./engine";
import { webEngine, webSpeechSupported } from "./webEngine";

type Availability = "available" | "downloadable" | "downloading" | "unavailable";

let availability: Availability;
let instances: FakeRecognition[];

class FakeRecognition {
  static available = vi.fn(async () => availability);
  static install = vi.fn(async () => true);
  lang = "";
  continuous = false;
  interimResults = true;
  processLocally = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn(() => this.onend?.());
  constructor() {
    instances.push(this);
  }
  final(text: string, isFinal = true) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal })],
    });
  }
}

const track = { stop: vi.fn() };
beforeEach(() => {
  availability = "available";
  instances = [];
  Object.assign(window, { SpeechRecognition: FakeRecognition });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
  });
  Object.assign(window, {
    AudioContext: class {
      createAnalyser = () => ({ fftSize: 0, getFloatTimeDomainData: () => {} });
      createMediaStreamSource = () => ({ connect: () => {} });
      close = async () => {};
    },
  });
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  vi.clearAllMocks();
});

function listen(engine: ReturnType<typeof webEngine>) {
  const statuses: DictationStatus[] = [];
  const phrases: string[] = [];
  engine.subscribe({ status: (s) => statuses.push(s), phrase: (p) => phrases.push(p) });
  return { statuses, phrases };
}

describe("web dictation", () => {
  it("is unavailable without on-device recognition, never falling back to a cloud service", async () => {
    Object.assign(window, { SpeechRecognition: class {} });
    expect(webSpeechSupported()).toBe(false);
    expect((await webEngine().status()).kind).toBe("unavailable");
  });

  it("maps browser language-pack states and asks only for on-device processing", async () => {
    await settingsRepository.set(SETTING_KEYS.dictationLanguage, "hi");
    const engine = webEngine();
    availability = "downloadable";
    expect(await engine.status()).toEqual({ kind: "needs-model", bytes: 0 });
    expect(FakeRecognition.available).toHaveBeenCalledWith(
      expect.objectContaining({ langs: ["hi-IN"], processLocally: true }),
    );
    availability = "downloading";
    expect((await engine.status()).kind).toBe("installing");
    availability = "unavailable";
    expect((await engine.status()).kind).toBe("error");
    availability = "available";
    expect(await engine.status()).toEqual({ kind: "ready" });
    await settingsRepository.set(SETTING_KEYS.dictationLanguage, "en");
  });

  it("installs the language pack on request", async () => {
    const engine = webEngine();
    const { statuses } = listen(engine);
    await engine.install();
    expect(FakeRecognition.install).toHaveBeenCalledWith(
      expect.objectContaining({ processLocally: true }),
    );
    expect(statuses.map((s) => s.kind)).toEqual(["installing", "ready"]);
  });

  it("delivers final phrases only, locally, and releases the microphone on stop", async () => {
    const engine = webEngine();
    const { statuses, phrases } = listen(engine);
    await engine.start({ language: "en", prompt: "" });
    const recognition = instances[0]!;
    expect(recognition.processLocally).toBe(true);
    expect(recognition.lang).toBe("en-US");
    recognition.final("half a thou", false);
    recognition.final(" add a checkout step ");
    await engine.stop();
    expect(phrases).toEqual(["add a checkout step"]);
    expect(track.stop).toHaveBeenCalled();
    expect(statuses.at(-1)).toEqual({ kind: "ready" });
  });

  it("drops phrases after cancel", async () => {
    const engine = webEngine();
    const { phrases } = listen(engine);
    await engine.start({ language: "en", prompt: "" });
    const recognition = instances[0]!;
    await engine.cancel();
    recognition.final("too late");
    expect(phrases).toEqual([]);
  });

  it("explains a blocked microphone", async () => {
    const engine = webEngine();
    const { statuses } = listen(engine);
    await engine.start({ language: "en", prompt: "" });
    instances[0]!.onerror?.({ error: "not-allowed" });
    expect(statuses.at(-1)).toMatchObject({ kind: "error", message: /Microphone access/ });
  });
});

describe("language pack download", () => {
  it("can stop waiting for a download and offers it again", async () => {
    FakeRecognition.install.mockImplementationOnce(() => new Promise(() => {}));
    const engine = webEngine();
    const { statuses } = listen(engine);
    const pending = engine.install();
    await vi.waitFor(() => expect(FakeRecognition.install).toHaveBeenCalled());
    await engine.cancelInstall();
    await pending;
    expect(statuses.at(-1)).toEqual({ kind: "needs-model", bytes: 0 });
  });
  it("reports a download that never finishes instead of spinning forever", async () => {
    FakeRecognition.install.mockImplementationOnce(() => new Promise(() => {}));
    const engine = webEngine({ installTimeoutMs: 20 });
    const { statuses } = listen(engine);
    await engine.install();
    const last = statuses.at(-1);
    expect(last?.kind).toBe("error");
    expect(last?.kind === "error" && last.message).toContain("taking too long");
  });
});
