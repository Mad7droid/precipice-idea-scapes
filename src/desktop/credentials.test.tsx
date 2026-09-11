import { act } from "react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { render, type Mounted } from "@/test/react";
const native = vi.hoisted(() => ({ desktop: true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.desktop, invoke: native.invoke }));
vi.mock("@/persistence/settings", () => ({
  settingsRepository: { get: vi.fn(async () => undefined), set: vi.fn() },
}));
import { AppSettingsProvider, useAppSettings } from "@/app/useAppSettings";
import { transportSettings } from "@/ai/provider";
let state: ReturnType<typeof useAppSettings>;
function Probe() {
  state = useAppSettings();
  return <output>{state.apiKey}</output>;
}
let view: Mounted;
async function mount() {
  view = render(
    <AppSettingsProvider>
      <Probe />
    </AppSettingsProvider>,
  );
  await act(async () => {});
}
beforeEach(() => {
  native.desktop = true;
  native.invoke.mockReset().mockResolvedValue(null);
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  view?.unmount();
  vi.restoreAllMocks();
});
describe("desktop credentials", () => {
  it("restores from Keychain and never writes credentials into browser storage", async () => {
    sessionStorage.setItem("anthropic.apiKey", "stale-browser-key");
    native.invoke.mockResolvedValueOnce("sk-ant-saved");
    const sessionWrite = vi.spyOn(Storage.prototype, "setItem");
    await mount();
    expect(state.apiKey).toBe("sk-ant-saved");
    expect(state.ready).toBe(true);
    expect(state.credentials.saved).toBe(true);
    act(() => state.setApiKey("sk-ant-temporary"));
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("anthropic.apiKey")).toBeNull();
    expect(sessionWrite).not.toHaveBeenCalled();
    await act(async () => {
      await state.credentials.persist("sk-ant-replacement");
    });
    expect(native.invoke).toHaveBeenLastCalledWith("save_api_key", { key: "sk-ant-replacement" });
    expect(state.apiKey).toBe("sk-ant-replacement");
    expect(sessionWrite).not.toHaveBeenCalled();
    await act(async () => {
      await state.credentials.persist(null);
    });
    expect(state.apiKey).toBe("");
    expect(state.credentials.saved).toBe(false);
  });
  it("does not claim a denied deletion succeeded or erase the usable session key", async () => {
    native.invoke.mockResolvedValueOnce("sk-ant-saved");
    await mount();
    native.invoke.mockRejectedValueOnce(new Error("secret native diagnostic"));
    await act(async () => {
      expect(await state.credentials.persist(null)).toBe(false);
    });
    expect(state.credentials.saved).toBe(true);
    expect(state.apiKey).toBe("sk-ant-saved");
    expect(state.credentials.error).toContain("still in Keychain");
    expect(state.credentials.error).not.toContain("secret");
  });
  it("allows session use after a read failure without silently persisting", async () => {
    native.invoke.mockRejectedValueOnce(new Error("locked"));
    await mount();
    expect(state.ready).toBe(true);
    expect(state.credentials.error).toContain("Could not read");
    act(() => state.setApiKey("sk-ant-session"));
    expect(state.apiKey).toBe("sk-ant-session");
    expect(sessionStorage.length).toBe(0);
  });
  it("keeps the old saved value when replacement fails", async () => {
    native.invoke.mockResolvedValueOnce("sk-ant-old");
    await mount();
    native.invoke.mockRejectedValueOnce(new Error("denied"));
    await act(async () => {
      await state.credentials.persist("sk-ant-new");
    });
    expect(state.apiKey).toBe("sk-ant-old");
    expect(state.credentials.saved).toBe(true);
    expect(state.credentials.error).toContain("Could not save");
  });
  it("serializes writes and ignores overlapping removal", async () => {
    await mount();
    let finish!: () => void;
    native.invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let save!: Promise<boolean>;
    act(() => {
      save = state.credentials.persist("sk-ant-new");
    });
    await act(async () => {
      expect(await state.credentials.persist(null)).toBe(false);
    });
    await act(async () => {
      finish();
      await save;
    });
    expect(state.credentials.saved).toBe(true);
  });
  it("leaves the web session-only and uses the existing proxy", async () => {
    native.desktop = false;
    await mount();
    act(() => state.setApiKey("sk-ant-web"));
    expect(sessionStorage.getItem("anthropic.apiKey")).toBe("sk-ant-web");
    expect(native.invoke).not.toHaveBeenCalled();
    expect(transportSettings().baseURL).toContain("precipice-ai-proxy");
    expect(transportSettings().headers).toBeUndefined();
  });
  it("routes desktop generations and conversations directly to Anthropic", () => {
    expect(transportSettings()).toEqual({
      baseURL: "https://api.anthropic.com/v1",
      headers: { "anthropic-dangerous-direct-browser-access": "true" },
    });
  });
});
