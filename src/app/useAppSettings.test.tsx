import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/react";

const settings = vi.hoisted(() => ({
  get: vi.fn<(key: string) => Promise<unknown>>(),
  set: vi.fn<(key: string, value: unknown) => Promise<void>>(),
}));

vi.mock("@/persistence/settings", () => ({ settingsRepository: settings }));

import { SETTING_KEYS } from "@/core/types";
import { AppSettingsProvider, useAppSettings } from "./useAppSettings";

function FirstProbe() {
  const { apiKey, modelId, types, setApiKey, setModelId, setTypes, ready } = useAppSettings();
  return (
    <>
      <output data-testid="first">{JSON.stringify({ apiKey, modelId, types, ready })}</output>
      <button type="button" onClick={() => setApiKey("sk-ant-session-only")}>
        Set key
      </button>
      <button type="button" onClick={() => setApiKey("")}>
        Clear key
      </button>
      <button type="button" onClick={() => setModelId("model-next")}>
        Set model
      </button>
      <button type="button" onClick={() => setTypes(["note"])}>
        Set types
      </button>
    </>
  );
}

function SecondProbe() {
  const { apiKey } = useAppSettings();
  return <output data-testid="second">{apiKey}</output>;
}

describe("app settings", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("restores an API key from the current tab session, not IndexedDB", async () => {
    sessionStorage.setItem("anthropic.apiKey", "sk-ant-session-key");
    settings.get.mockImplementation(async (key) => {
      if (key === SETTING_KEYS.model) return "saved-model";
      if (key === SETTING_KEYS.generateTypes) return ["journey"];
      return "stale-api-key";
    });
    settings.set.mockResolvedValue();

    const view = render(
      <AppSettingsProvider>
        <FirstProbe />
        <SecondProbe />
      </AppSettingsProvider>,
    );

    await act(async () => {});

    expect(view.container.querySelector('[data-testid="first"]')!.textContent).toContain(
      '"apiKey":"sk-ant-session-key"',
    );
    expect(view.container.querySelector('[data-testid="first"]')!.textContent).toContain(
      '"modelId":"saved-model"',
    );
    expect(settings.get).not.toHaveBeenCalledWith("anthropic.apiKey");

    const buttons = [...view.container.querySelectorAll("button")];
    act(() => buttons[0].click());
    expect(view.container.querySelector('[data-testid="second"]')!.textContent).toBe(
      "sk-ant-session-only",
    );
    expect(sessionStorage.getItem("anthropic.apiKey")).toBe("sk-ant-session-only");
    expect(settings.set).not.toHaveBeenCalledWith("anthropic.apiKey", expect.anything());

    act(() => buttons[1].click());
    expect(sessionStorage.getItem("anthropic.apiKey")).toBeNull();

    act(() => buttons[2].click());
    act(() => buttons[3].click());
    expect(settings.set).toHaveBeenCalledWith(SETTING_KEYS.model, "model-next");
    expect(settings.set).toHaveBeenCalledWith(SETTING_KEYS.generateTypes, ["note"]);

    view.unmount();
  });
});
