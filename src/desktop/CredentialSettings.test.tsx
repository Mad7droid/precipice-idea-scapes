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
    denied: false,
    change: vi.fn(),
    persist: vi.fn(async () => true),
    reload: vi.fn(),
  };
}
function submit(view: ReturnType<typeof render>) {
  return act(async () =>
    view.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(),
  );
}
describe("desktop credential controls", () => {
  it("keeps the saved key out of the input and saves a replacement to Keychain", async () => {
    const c = credentials();
    const view = render(<CredentialSettings credentials={c} />);
    const input = view.container.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(input.value).toBe("");
    expect(view.container.textContent).not.toContain(c.key);
    type(input, "sk-ant-replacement");
    await submit(view);
    expect(c.persist).toHaveBeenCalledWith("sk-ant-replacement");
    expect(c.change).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    view.unmount();
  });
  it("retains a replacement draft when Keychain rejects the write", async () => {
    const c = credentials();
    c.persist = vi.fn(async () => false);
    const view = render(<CredentialSettings credentials={c} />);
    const input = view.container.querySelector<HTMLInputElement>('input[type="password"]')!;
    type(input, "sk-ant-replacement");
    await submit(view);
    expect(input.value).toBe("sk-ant-replacement");
    view.unmount();
  });
  it("removes a saved key only from an explicit click", async () => {
    const c = credentials();
    const view = render(<CredentialSettings credentials={c} />);
    const remove = [...view.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Remove",
    )!;
    await act(async () => remove.click());
    expect(c.persist).toHaveBeenCalledWith(null);
    view.unmount();
  });
});
