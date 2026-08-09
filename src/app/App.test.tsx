import "fake-indexeddb/auto";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "@/test/react";
import { App } from "./App";

describe("development routes", () => {
  afterEach(() => {
    window.location.hash = "#/";
  });

  it("shows a loading state while a lazily loaded harness resolves", async () => {
    const view = render(<App />);
    try {
      act(() => {
        window.location.hash = "#/dev/objects";
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      expect(view.container.querySelector('[role="status"]')?.textContent).toBe(
        "Loading development harness…",
      );

      // Module loading competes with every other worker in a full Vitest run. A fixed 25ms
      // delay made this assertion race the lazy import, then left a mounted React tree behind
      // on failure. Poll inside `act` so this tests the rendered outcome rather than timing.
      await act(async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (view.container.textContent?.includes("Object plugins")) return;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      });
      expect(view.container.textContent).toContain("Object plugins");
    } finally {
      view.unmount();
    }
  });
});
