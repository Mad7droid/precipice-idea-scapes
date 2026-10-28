import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/test/react";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: native.invoke }));
import { TYPESAFE_CREDENTIAL, useCredentials } from "@/desktop/useCredentials";

let state: ReturnType<typeof useCredentials>;
function Probe() {
  state = useCredentials(TYPESAFE_CREDENTIAL);
  return null;
}

describe("presence-only credentials", () => {
  it("marks a TypeSafe key saved without ever holding the secret", async () => {
    native.invoke.mockResolvedValue(true);
    const view = render(<Probe />);
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expect(native.invoke).toHaveBeenCalledWith("read_typesafe_key");
    expect(state.saved).toBe(true);
    expect(state.key).toBe("");
    view.unmount();
  });
});
