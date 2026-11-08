import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, type as typeInto, type Mounted } from "@/test/react";
import { workspaceRepository } from "@/persistence/workspace";
import { ContentSearch } from "@/persistence/contentSearch";
import { WorkspaceTools } from "./WorkspaceTools";
import { openWorkspaceTool } from "./workspaceEvents";
import { useNotifications } from "@/core/notify";

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  vi.restoreAllMocks();
  useNotifications.setState({ toasts: [] });
});
describe("shared workspace tools", () => {
  it("gives typed, placeholder and selected text explicit semantic colors in both workspace dialogs", () => {
    mounted = render(<WorkspaceTools />);
    for (const tool of ["search", "capture"] as const) {
      act(() => openWorkspaceTool(tool));
      const field = mounted.container.querySelector("input, textarea")!;
      for (const token of [
        "text-fg",
        "placeholder:text-fg-tertiary",
        "selection:bg-selected",
        "selection:text-fg",
      ])
        expect(field.classList.contains(token), `${tool}: ${token}`).toBe(true);
      expect(
        mounted.container.querySelector('[role="dialog"]')!.classList.contains("text-fg"),
      ).toBe(true);
    }
  });
  it("keeps dictation's shortcut free and opens capture with the separate app shortcut", () => {
    mounted = render(<WorkspaceTools />);
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", code: "Space", metaKey: true, shiftKey: true }),
      ),
    );
    expect(mounted.container.querySelector('[role="dialog"]')).toBeNull();
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "n", code: "KeyN", metaKey: true, altKey: true }),
      ),
    );
    expect(mounted.container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(
      "Capture a note",
    );
  });
  it("preserves text on save failure and only clears it after successful persistence", async () => {
    const capture = vi
      .spyOn(workspaceRepository, "capture")
      .mockRejectedValueOnce(new Error("Storage full"));
    mounted = render(<WorkspaceTools />);
    act(() => openWorkspaceTool("capture"));
    typeInto(mounted.container.querySelector("textarea")!, "Fictional capture for testing");
    await act(async () => {
      mounted!.container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mounted.container.querySelector("textarea")?.value).toBe(
      "Fictional capture for testing",
    );
    expect(
      useNotifications.getState().toasts.some((toast) => toast.message === "Saved to Inbox."),
    ).toBe(false);
    capture.mockResolvedValueOnce({
      id: crypto.randomUUID(),
      text: "Fictional capture for testing",
      createdAt: 1,
      updatedAt: 1,
      archived: false,
    });
    await act(async () => {
      mounted!.container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mounted.container.querySelector('[role="dialog"]')).toBeNull();
    act(() => openWorkspaceTool("capture"));
    expect(mounted.container.querySelector("textarea")?.value).toBe("");
  });
  it("moves through search results with arrow keys and opens the active one with Enter", async () => {
    vi.useFakeTimers();
    try {
      const results = ["One", "Two"].map((title) => ({
        scapeId: "scp_x",
        scapeName: "Fictional",
        objectId: `obj_${title}`,
        title,
        excerpt: title,
      }));
      vi.spyOn(ContentSearch.prototype, "search").mockResolvedValue(results);
      mounted = render(<WorkspaceTools />);
      act(() => openWorkspaceTool("search"));
      const input = mounted.container.querySelector("input")!;
      typeInto(input, "fictional");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      const selected = () =>
        mounted!.container.querySelector('[aria-selected="true"]')?.textContent ?? "";
      expect(selected()).toContain("One");
      act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      });
      expect(selected()).toContain("Two");
      expect(input.getAttribute("aria-activedescendant")).toBe("content-search-1");
      act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      expect(mounted.container.querySelector('[role="dialog"]')).toBeNull();
      expect(window.location.hash).toContain("scp_x");
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps an unsaved capture after closing, and clears it on discard", () => {
    mounted = render(<WorkspaceTools />);
    act(() => openWorkspaceTool("capture"));
    typeInto(mounted.container.querySelector("textarea")!, "Half-finished fictional thought");
    const button = (name: string) =>
      [...mounted!.container.querySelectorAll("button")].find((el) => el.textContent === name)!;
    act(() => button("Close").click());
    act(() => openWorkspaceTool("capture"));
    expect(mounted.container.querySelector("textarea")!.value).toBe(
      "Half-finished fictional thought",
    );
    expect(sessionStorage.getItem("precipice.capture.draft")).toBe(
      "Half-finished fictional thought",
    );
    act(() => button("Discard").click());
    expect(mounted.container.querySelector("textarea")!.value).toBe("");
    expect(sessionStorage.getItem("precipice.capture.draft")).toBeNull();
  });
});
