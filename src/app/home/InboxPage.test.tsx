import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, type as typeInto, type Mounted } from "@/test/react";
import { workspaceRepository } from "@/persistence/workspace";
import { InboxPage } from "./InboxPage";
import { useNotifications } from "@/core/notify";

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  vi.restoreAllMocks();
  useNotifications.setState({ toasts: [] });
});

it("reveals destination controls on request and keeps the source visible when promotion fails", async () => {
  vi.spyOn(workspaceRepository, "listCaptures").mockResolvedValue([
    {
      id: crypto.randomUUID(),
      text: "A note worth keeping",
      createdAt: 1,
      updatedAt: 1,
      archived: false,
    },
  ]);
  const promote = vi
    .spyOn(workspaceRepository, "promote")
    .mockRejectedValue(new Error("Scape is open elsewhere"));
  await act(async () => {
    mounted = render(<InboxPage scapes={[]} onChanged={() => {}} />);
  });
  const button = (name: string) =>
    [...mounted!.container.querySelectorAll("button")].find((el) => el.textContent === name)!;
  expect(mounted!.container.querySelector("select")).toBeNull();
  act(() => button("Add to scape").click());
  expect(button("Add to scape").getAttribute("aria-expanded")).toBe("true");
  expect(mounted!.container.querySelector("select")).not.toBeNull();
  await act(async () => {
    button("Add note").click();
  });
  expect(promote).toHaveBeenCalledTimes(1);
  expect(mounted!.container.textContent).toContain("A note worth keeping");
  expect(mounted!.container.querySelector("select")).not.toBeNull();
  act(() => button("Add to scape").click());
  expect(mounted!.container.querySelector("select")).toBeNull();
});

it("cancels an edit without changing the saved note and guards archive while editing", async () => {
  vi.spyOn(workspaceRepository, "listCaptures").mockResolvedValue([
    {
      id: crypto.randomUUID(),
      text: "Keep the original note",
      createdAt: 1,
      updatedAt: 1,
      archived: false,
    },
  ]);
  const update = vi.spyOn(workspaceRepository, "updateCapture");
  await act(async () => {
    mounted = render(<InboxPage scapes={[]} onChanged={() => {}} />);
  });
  const button = (name: string) =>
    [...mounted!.container.querySelectorAll("button")].find((el) => el.textContent === name)!;
  expect(button("Inbox").getAttribute("aria-pressed")).toBe("true");
  act(() => button("Edit").click());
  const input = mounted!.container.querySelector("textarea")!;
  expect(input.classList.contains("text-fg")).toBe(true);
  typeInto(input, "Uncommitted draft");
  expect(button("Archive").disabled).toBe(true);
  act(() => button("Cancel").click());
  expect(mounted!.container.textContent).toContain("Keep the original note");
  expect(update).not.toHaveBeenCalled();
  act(() => button("Edit").click());
  expect(mounted!.container.querySelector("textarea")!.value).toBe("Keep the original note");
});

it("deletes archived notes only after confirmation and hides links to deleted scapes", async () => {
  const id = crypto.randomUUID();
  vi.spyOn(workspaceRepository, "listCaptures").mockResolvedValue([
    {
      id,
      text: "Added then archived",
      createdAt: 1,
      updatedAt: 1,
      archived: true,
      promotedTo: "scp_gone",
      objectId: "obj_gone",
    },
  ]);
  const remove = vi.spyOn(workspaceRepository, "deleteCapture").mockResolvedValue();
  await act(async () => {
    mounted = render(<InboxPage scapes={[]} onChanged={() => {}} />);
  });
  const button = (name: string) =>
    [...mounted!.container.querySelectorAll("button")].find((el) => el.textContent === name);
  act(() => button("Archived")!.click());
  expect(button("Open scape")).toBeUndefined();
  expect(mounted!.container.textContent).toContain("has been deleted");
  act(() => button("Delete")!.click());
  expect(remove).not.toHaveBeenCalled();
  act(() => button("Keep")!.click());
  act(() => button("Delete")!.click());
  await act(async () => {
    button("Delete permanently")!.click();
  });
  expect(remove).toHaveBeenCalledWith(id);
});
