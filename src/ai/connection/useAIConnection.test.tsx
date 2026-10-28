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
    // Restoring the saved connection, then checking it natively, spans several task turns.
    for (let round = 0; round < 3; round++)
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
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
  it("defaults to the Claude plan and checks only the selected connection", async () => {
    const view = await mount();
    expect(settings.connection.provider).toBe("claude-plan");
    expect(settings.aiReady).toBe(true);
    const commands = invoke.mock.calls.map(([name]) => name);
    expect(commands).toContain("claude_status");
    expect(commands).not.toContain("chatgpt_status");
    // The one-time 0.1.15 upgrade check looks for a legacy key once, then records the default.
    expect(commands.filter((name) => name === "read_api_key")).toHaveLength(1);
    expect(commands).not.toContain("read_typesafe_key");
    expect(set).toHaveBeenCalledWith("ai.connection", "claude-plan");
    view.unmount();
  });
  it("keeps 0.1.15 users with a saved Anthropic key on the API key connection", async () => {
    const base = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (command, args) =>
      command === "read_api_key" ? "sk-ant-legacy" : base(command, args),
    );
    const view = await mount();
    expect(settings.connection.provider).toBe("anthropic");
    expect(set).toHaveBeenCalledWith("ai.connection", "anthropic");
    view.unmount();
  });
  it("keeps 0.1.15 users with a saved Anthropic model on the API key connection", async () => {
    values.set("anthropic.model", "claude-sonnet-5-5");
    const view = await mount();
    expect(settings.connection.provider).toBe("anthropic");
    expect(set).toHaveBeenCalledWith("ai.connection", "anthropic");
    view.unmount();
  });
  it("does not migrate once a connection has been saved", async () => {
    values.set("ai.connection", "claude-plan");
    values.set("anthropic.model", "claude-sonnet-5-5");
    const view = await mount();
    expect(settings.connection.provider).toBe("claude-plan");
    expect(set).not.toHaveBeenCalledWith("ai.connection", expect.anything());
    view.unmount();
  });
  it("remembers a model for each connection separately", async () => {
    values.set("ai.connection", "claude-plan");
    values.set("ai.chatgpt.model", "chatgpt/gpt-test");
    const view = await mount();
    act(() => settings.setModelId("claude-plan/haiku"));
    expect(set).toHaveBeenCalledWith("ai.claudePlan.model", "claude-plan/haiku");
    expect(set).not.toHaveBeenCalledWith("ai.chatgpt.model", expect.anything());
    act(() => settings.connection.choose("anthropic"));
    expect(settings.models.some((model) => model.id === settings.modelId)).toBe(true);
    expect(settings.modelId.startsWith("claude-plan/")).toBe(false);
    act(() => settings.connection.choose("claude-plan"));
    expect(settings.modelId).toBe("claude-plan/haiku");
    view.unmount();
  });
  it("keeps a disconnected plan selected and never reads the unused API key", async () => {
    values.set("ai.connection", "chatgpt");
    const base = invoke.getMockImplementation()!;
    invoke.mockImplementation((command) =>
      command === "read_api_key" ? Promise.resolve("sk-ant-present") : base(command),
    );
    const view = await mount();
    expect(settings.apiKey).toBe("");
    expect(invoke.mock.calls.some(([name]) => name === "read_api_key")).toBe(false);
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
    values.set("ai.connection", "chatgpt");
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
    expect(settings.connection.chatgptAvailable).toBe(true);
    expect(settings.aiReady).toBe(false);
    expect(settings.connection.error).toContain("Keychain access");
    // A generic read failure mentions Keychain but is not a refusal: no "Allow" banner.
    expect(settings.keychainDenied).toBe(false);
    view.unmount();
  });
  it("asks for Keychain access again only after an explicit retry", async () => {
    values.set("ai.connection", "chatgpt");
    let denied = true;
    const base = invoke.getMockImplementation()!;
    invoke.mockImplementation((command) =>
      command === "chatgpt_status" && denied
        ? Promise.reject("Keychain access was not allowed. Choose Allow Keychain access.")
        : base(command),
    );
    const view = await mount();
    expect(settings.keychainDenied).toBe(true);
    denied = false;
    await act(async () => {
      await settings.allowKeychain();
    });
    expect(invoke).toHaveBeenCalledWith("keychain_retry");
    // The agent host sign-in lives in the same vault item and is reloaded too.
    expect(invoke).toHaveBeenCalledWith("read_agent_session");
    expect(settings.keychainDenied).toBe(false);
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
