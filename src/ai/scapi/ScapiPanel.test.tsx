import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "@/test/react";
import { ScapiPanel } from "./ScapiPanel";
import type { Turn } from "./types";

const mounted: Array<{ unmount: () => void }> = [];

afterEach(() => mounted.splice(0).forEach((view) => view.unmount()));

function streamingTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: "turn_live",
    question: "What should I focus on?",
    pinned: [],
    reasoning: "I will compare the connected and orphaned objects.",
    body: "",
    activity: [
      { kind: "reading-scape", objects: 8 },
      { kind: "reading-objects", ids: ["obj_a", "obj_b"] },
    ],
    sources: [],
    status: "streaming",
    error: null,
    ...overrides,
  };
}

function panel(turn: Turn) {
  const view = render(
    <ScapiPanel turns={[turn]} streaming onSend={() => {}} onCancel={() => {}} />,
  );
  mounted.push(view);
  return view.container;
}

describe("ScapiPanel streaming states", () => {
  it("makes current work clear and leaves the details expandable", () => {
    const container = panel(streamingTurn());
    const working = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Working"),
    );

    expect(working?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("reading 2 objects in full");
    expect(container.textContent).toContain("Approach");

    act(() => working?.click());
    expect(working?.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows research evidence before answer prose arrives", () => {
    const container = panel(
      streamingTurn({
        sources: [
          { id: "source_1", title: "Canvas research", url: "https://example.com/research" },
        ],
      }),
    );

    expect(container.textContent).toContain("Research");
    expect(container.textContent).toContain("Canvas research");
  });

  it("renders valid GFM comparison tables", () => {
    const container = panel(
      streamingTurn({
        body: "| Editor | Viewer |\n| --- | --- |\n| Author | Reader |",
        status: "done",
      }),
    );
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(container.textContent).toContain("Author");
  });
});
