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

    act(() => {
      window.location.hash = "#/dev/objects";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(view.container.querySelector('[role="status"]')?.textContent).toBe(
      "Loading development harness…",
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(view.container.textContent).toContain("Object plugins");

    view.unmount();
  });
});
