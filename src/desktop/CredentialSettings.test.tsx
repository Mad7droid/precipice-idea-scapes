import { act } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, type } from "@/test/react";
import { CredentialSettings } from "./CredentialSettings";
import type { DesktopCredentials } from "./useCredentials";
function credentials(): DesktopCredentials {
  return {
    desktop: true,
    key: "sk-ant-saved-secret",
    saved: true,
    ready: true,
    busy: false,
    error: "",
    change: vi.fn(),
    persist: vi.fn(async () => true),
  };
}
describe("desktop credential controls", () => {
  it("keeps the saved key out of the input and requires an explicit opt-in for replacement", async () => {
    const c = credentials();
    const view = render(<CredentialSettings credentials={c} />);
    const input = view.container.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(input.value).toBe("");
    expect(view.container.textContent).not.toContain(c.key);
    type(input, "sk-ant-temporary");
    await act(async () => view.container.querySelector("button")!.click());
    expect(c.change).toHaveBeenCalledWith("sk-ant-temporary");
    expect(c.persist).not.toHaveBeenCalled();
    type(input, "sk-ant-replacement");
    act(() => view.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => view.container.querySelector("button")!.click());
    expect(c.persist).toHaveBeenCalledWith("sk-ant-replacement");
    expect(input.value).toBe("");
    view.unmount();
  });
  it("retains a replacement draft when Keychain rejects the write", async () => {
    const c = credentials();
    c.persist = vi.fn(async () => false);
    const view = render(<CredentialSettings credentials={c} />);
    const input = view.container.querySelector<HTMLInputElement>('input[type="password"]')!;
    type(input, "sk-ant-replacement");
    act(() => view.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => view.container.querySelector("button")!.click());
    expect(input.value).toBe("sk-ant-replacement");
    view.unmount();
  });
});
