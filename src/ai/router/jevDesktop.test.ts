import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "./types";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/desktop/runtime", () => ({ isDesktop: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

const context: RouteContext = {
  input: "voice",
  selection: { count: 0, types: [] },
  objects: [],
  availableTypes: [],
  commands: false,
};

describe("Jev in the Mac app", () => {
  it("routes through the native command, never a browser fetch that CORS would block", async () => {
    const { askJev } = await import("./jev");
    const fetcher = vi.spyOn(globalThis, "fetch");
    native.invoke.mockResolvedValue(
      JSON.stringify({ answers: { intent: { choice: "ask", confidence: 0.9 } } }),
    );
    const result = await askJev("what is missing here", context, "configured");
    expect(native.invoke).toHaveBeenCalledWith("jev_route", { body: expect.any(String) });
    expect(JSON.stringify(native.invoke.mock.calls[0])).not.toContain("configured");
    expect(fetcher).not.toHaveBeenCalled();
    expect(result?.intent?.value).toBe("ask");
  });

  it("falls back quietly when the native call fails", async () => {
    const { askJev } = await import("./jev");
    native.invoke.mockRejectedValue("TypeSafe refused the routing request");
    expect(await askJev("what is missing here", context, "configured")).toBeNull();
  });
});
