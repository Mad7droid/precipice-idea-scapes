import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/react";
import { AppSettingsProvider, useAppSettings } from "@/app/useAppSettings";

const { invoke, values, set } = vi.hoisted(() => ({
  invoke: vi.fn(),
  values: new Map<string, unknown>(),
  set: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/desktop/runtime", () => ({ isDesktop: () => true }));
vi.mock("@/persistence/settings", () => ({
  settingsRepository: { get: async (key: string) => values.get(key), set },
}));

describe("desktop AI connection settings", () => {
  let settings!: ReturnType<typeof useAppSettings>;
  beforeEach(() => {
    values.clear();
    invoke.mockReset();
    set.mockReset();
    invoke.mockImplementation(async (command) => {
      if (command === "chatgpt_status")
        return { available: true, status: "disconnected", models: [] };
      if (command === "claude_status")
        return {
          installed: true,
          connected: true,
          email: "claude@example.test",
          connectionId: "workspace-a",
        };
      return null;
    });
  });
  async function mount() {
    function Probe() {
      settings = useAppSettings();
      return null;
    }
    const view = render(
      <AppSettingsProvider>
        <Probe />
      </AppSettingsProvider>,
    );
    await act(async () => {});
    return view;
  }
  it("restores Claude plan and makes Scapi ready with no Anthropic API key", async () => {
    values.set("ai.connection", "claude-plan");
    const view = await mount();
    expect(settings.connection.provider).toBe("claude-plan");
    expect(settings.connection.connectionId).toBe("workspace-a");
    expect(settings.aiReady).toBe(true);
    expect(settings.apiKey).toBe("");
    expect(settings.models.map((model) => model.id)).toEqual([
      "claude-plan/sonnet",
      "claude-plan/haiku",
      "claude-plan/opus",
    ]);
    act(() => settings.setModelId("claude-plan/opus"));
    expect(settings.modelId).toBe("claude-plan/opus");
    view.unmount();
  });
  it("keeps a disconnected plan selected even when an API key is available", async () => {
    values.set("ai.connection", "chatgpt");
    const base = invoke.getMockImplementation()!;
    invoke.mockImplementation((command) =>
      command === "read_api_key" ? Promise.resolve("sk-ant-present") : base(command),
    );
    const view = await mount();
    expect(settings.apiKey).toBe("sk-ant-present");
    expect(settings.connection.provider).toBe("chatgpt");
    expect(settings.aiReady).toBe(false);
    expect(settings.models[0]).toMatchObject({
      id: "chatgpt/unavailable",
      label: "Connect ChatGPT",
    });
    expect(set).not.toHaveBeenCalledWith("ai.connection", "anthropic");
    view.unmount();
  });
  it("starts ChatGPT sign-in natively and preserves the draft-side connection choice", async () => {
    const view = await mount();
    await act(async () => {
      await settings.connection.connect();
    });
    expect(invoke).toHaveBeenCalledWith("chatgpt_connect", { newAccount: false });
    expect(settings.connection.provider).toBe("chatgpt");
    expect(set).toHaveBeenCalledWith("ai.connection", "chatgpt");
    view.unmount();
  });
  it("cancels an in-progress sign-in without deleting the existing account", async () => {
    const base = invoke.getMockImplementation()!;
    invoke.mockImplementation((command) =>
      command === "chatgpt_status"
        ? Promise.resolve({ available: true, status: "connecting", models: [] })
        : base(command),
    );
    const view = await mount();
    await act(async () => {
      await settings.connection.disconnect();
    });
    expect(invoke).toHaveBeenCalledWith("chatgpt_cancel_login");
    expect(invoke.mock.calls.some(([name]) => name === "chatgpt_disconnect")).toBe(false);
    view.unmount();
  });
  it("discloses unconfirmed remote revocation without switching billing", async () => {
    values.set("ai.connection", "chatgpt");
    const base = invoke.getMockImplementation()!;
    invoke.mockImplementation((command) =>
      command === "chatgpt_disconnect"
        ? Promise.resolve({ revocationConfirmed: false })
        : base(command),
    );
    const view = await mount();
    await act(async () => {
      await settings.connection.disconnect();
    });
    expect(settings.connection.error).toContain("Remote revocation could not be confirmed");
    expect(settings.connection.provider).toBe("chatgpt");
    expect(settings.aiReady).toBe(false);
    view.unmount();
  });
  it("surfaces Keychain failures and still offers sign-in recovery", async () => {
    values.set("ai.connection", "chatgpt");
    const base = invoke.getMockImplementation()!;
    invoke.mockImplementation((command) =>
      command === "chatgpt_status" ? Promise.reject("Keychain denied") : base(command),
    );
    const view = await mount();
    expect(settings.connection.available).toBe(true);
    expect(settings.aiReady).toBe(false);
    expect(settings.connection.error).toContain("Keychain access");
    view.unmount();
  });
  it("selects a saved registration by ID and refreshes its model catalogue", async () => {
    const view = await mount();
    await act(async () => {
      await settings.connection.selectAccount("registration-two");
    });
    expect(invoke).toHaveBeenCalledWith("chatgpt_select", { connectionId: "registration-two" });
    expect(settings.connection.provider).toBe("chatgpt");
    view.unmount();
  });
});
