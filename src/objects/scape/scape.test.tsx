import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ReadOnlyContext } from "@/canvas/readOnly";
import { fixtureScape } from "@/core/fixtures";
import { useScapeStore } from "@/core/store";
import { render, type as typeInto } from "@/test/react";
import { DocumentText } from "../ui";
import { ScapeBlockBody } from "./Body";
import { ScapeBlockNode } from "./Node";
import view from "./view";

const store = () => useScapeStore.getState();
const OBJECT_ID = "verification-spec";

beforeEach(() => store().loadScape(fixtureScape()));

function mount(selected: boolean, readOnly = false) {
  const object = store().scape!.objects[OBJECT_ID];
  return render(
    <ReadOnlyContext.Provider value={readOnly}>
      <ScapeBlockNode object={object} selected={selected} />
    </ReadOnlyContext.Provider>,
  );
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("the three states", () => {
  it("renders Markdown and offers nothing to click while unselected", () => {
    const node = mount(false);
    expect(node.container.querySelector("h2")?.textContent).toBe("Document scan");
    expect(node.container.querySelector("textarea")).toBeNull();
    expect(node.container.querySelector(".cursor-text")).toBeNull();
    node.unmount();
  });

  it("still renders Markdown when selected — selection alone never opens the editor", () => {
    const node = mount(true);
    expect(node.container.querySelector("table")).not.toBeNull();
    expect(node.container.querySelector("textarea")).toBeNull();
    expect(node.container.querySelector(".cursor-text")).not.toBeNull();
    node.unmount();
  });

  it("opens the editor on a click that arrives while already selected", () => {
    const node = mount(true);
    click(node.container.querySelector(".rich-text")!);

    const field = node.container.querySelector("textarea")!;
    expect(field).not.toBeNull();
    expect(field.value).toContain("## Document scan");
    node.unmount();
  });

  it("commits on Escape and goes back to rendered Markdown", () => {
    const node = mount(true);
    click(node.container.querySelector(".rich-text")!);
    typeInto(node.container.querySelector("textarea")!, "# Rewritten");
    act(() => {
      node.container
        .querySelector("textarea")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(node.container.querySelector("textarea")).toBeNull();
    expect(store().scape!.objects[OBJECT_ID].data.body).toBe("# Rewritten");
    node.unmount();
  });

  it("keeps Escape away from the canvas, which reads it as clear selection", () => {
    const seen: string[] = [];
    const spy = (event: KeyboardEvent) => seen.push(event.key);
    window.addEventListener("keydown", spy);
    const node = mount(true);
    click(node.container.querySelector(".rich-text")!);
    act(() => {
      node.container
        .querySelector("textarea")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    window.removeEventListener("keydown", spy);

    expect(seen).toEqual([]);
    node.unmount();
  });

  it("edits as one transaction, so a single undo puts the document back", () => {
    const before = store().scape!.objects[OBJECT_ID].data.body;
    const node = mount(true);
    click(node.container.querySelector(".rich-text")!);
    typeInto(node.container.querySelector("textarea")!, "# Rewritten");
    act(() => {
      node.container
        .querySelector("textarea")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    act(() => store().undo());
    expect(store().scape!.objects[OBJECT_ID].data.body).toBe(before);
    node.unmount();
  });
});

describe("Enter", () => {
  it("opens the editor for a lone selected block", () => {
    const node = mount(true);
    act(() => store().setSelection([OBJECT_ID]));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(node.container.querySelector("textarea")).not.toBeNull();
    node.unmount();
  });

  it("stays out of the way when more than one object is selected", () => {
    const node = mount(true);
    act(() => store().setSelection([OBJECT_ID, "brief"]));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(node.container.querySelector("textarea")).toBeNull();
    node.unmount();
  });
});

describe("read-only", () => {
  it("never reaches an editor, however many times it is clicked", () => {
    const node = mount(true, true);
    const target = node.container.querySelector(".rich-text")!;
    click(target);
    click(target);

    expect(node.container.querySelector("textarea")).toBeNull();
    expect(node.container.querySelector(".cursor-text")).toBeNull();
    node.unmount();
  });
});

describe("the viewer half", () => {
  it("renders the same body inert — no `onEdit`, no affordance", () => {
    const object = store().scape!.objects[OBJECT_ID];
    const node = render(<view.View object={object} selected />);

    expect(node.container.querySelector("h2")).not.toBeNull();
    expect(node.container.querySelector(".cursor-text")).toBeNull();
    expect(node.container.textContent).not.toContain("Click to edit");
    node.unmount();
  });

  it("is the same component the editor uses", () => {
    expect(view.View).toBe(ScapeBlockBody);
  });
});

describe("DocumentText", () => {
  it("renders the structure a note deliberately cannot", () => {
    const node = render(
      <DocumentText value={"# Title\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n---\n\n    code"} />,
    );

    expect(node.container.querySelector("h1")?.textContent).toBe("Title");
    expect(node.container.querySelectorAll("td")).toHaveLength(2);
    expect(node.container.querySelector("hr")).not.toBeNull();
    expect(node.container.querySelector("pre")).not.toBeNull();
    node.unmount();
  });

  it("still drops images, raw HTML and unsafe links", () => {
    const node = render(
      <DocumentText
        value={
          "<img src=x onerror=alert(1)> ![shot](https://tracker.example/p.gif) " +
          "[bad](javascript:alert(1)) [good](https://example.com)"
        }
      />,
    );

    expect(node.container.querySelector("img")).toBeNull();
    expect(node.container.querySelector("[onerror]")).toBeNull();
    const links = node.container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("https://example.com/");
    node.unmount();
  });
});
