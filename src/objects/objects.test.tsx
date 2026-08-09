import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionPayload } from "@/core/actions";
import { allPlugins, getPlugin } from "@/core/registry";
import type { ScapeObject } from "@/core/types";
import { fixtureScape } from "@/core/fixtures";
import { render, type as typeInto } from "@/test/react";
import { wireframeSchema } from "./wireframe/schema";

const EXPECTED_TYPES = ["journey", "note", "wireframe"];

describe("registry", () => {
  it("discovers every plugin by glob, with no manual registration anywhere", () => {
    expect(allPlugins().map((p) => p.type)).toEqual(EXPECTED_TYPES);
  });

  it("returns undefined rather than throwing for an unregistered type", () => {
    expect(getPlugin("persona")).toBeUndefined();
  });

  it("declares colour as a token name, never a hex value", () => {
    for (const plugin of allPlugins()) {
      expect(plugin.color, plugin.type).toMatch(/^--obj-/);
    }
  });
});

describe("plugin schemas", () => {
  it("each schema accepts its own defaults()", () => {
    for (const plugin of allPlugins()) {
      const result = plugin.schema.safeParse(plugin.defaults());
      expect(result.success, `${plugin.type}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it("each schema accepts the fixture data for its type", () => {
    const scape = fixtureScape();
    for (const object of Object.values(scape.objects)) {
      const plugin = getPlugin(object.type);
      if (!plugin) continue;
      const result = plugin.schema.safeParse(object.data);
      expect(result.success, `${object.id}: ${JSON.stringify(result)}`).toBe(true);
    }
  });
});

describe("toText", () => {
  it("stays under 120 characters for every fixture object", () => {
    const scape = fixtureScape();
    for (const object of Object.values(scape.objects)) {
      const plugin = getPlugin(object.type);
      if (!plugin) continue;
      const text = plugin.toText(object);
      expect(text.length, `${object.id} → ${text}`).toBeLessThan(120);
    }
  });

  it("stays under 120 characters for deliberately over-full objects", () => {
    const overfull: Array<[string, Record<string, unknown>]> = [
      ["note", { body: "Sentence about the problem space. ".repeat(50) }],
      [
        "journey",
        {
          steps: Array.from({ length: 40 }, (_, i) => ({
            id: `s${i}`,
            label: `A fairly wordy step label number ${i}`,
            detail: "And a detail line that goes on for a while as well.",
          })),
        },
      ],
      [
        "wireframe",
        {
          primitives: Array.from({ length: 30 }, (_, i) => ({
            id: `p${i}`,
            kind: "box" as const,
            label: `Element with a long label ${i}`,
            span: 12,
          })),
        },
      ],
    ];

    for (const [type, data] of overfull) {
      const plugin = getPlugin(type)!;
      const object: ScapeObject = {
        id: "x",
        type,
        title: "A title that is itself not especially short",
        data,
        x: 0,
        y: 0,
        createdAt: 0,
        updatedAt: 0,
      };
      const text = plugin.toText(object);
      expect(text.length, `${type} → ${text}`).toBeLessThan(120);
    }
  });

  it("is dense and factual — no newlines, no runs of whitespace", () => {
    const scape = fixtureScape();
    for (const object of Object.values(scape.objects)) {
      const plugin = getPlugin(object.type);
      if (!plugin) continue;
      expect(plugin.toText(object)).not.toMatch(/\s\s|\n/);
    }
  });
});

describe("node rendering", () => {
  const base = { x: 0, y: 0, createdAt: 0, updatedAt: 0 };

  it("renders the complete note body without an expansion control", () => {
    const body = "A long note body that remains visible at every canvas zoom. ".repeat(12);
    const object: ScapeObject = {
      ...base,
      id: "expanded-note",
      type: "note",
      title: "Expanded note",
      data: { body },
    };
    const plugin = getPlugin("note")!;
    const { container, unmount } = render(<plugin.Node object={object} selected={false} />);

    expect(container.textContent).toContain(body.trim());
    expect(container.textContent).not.toMatch(/Show more|Show less/);
    unmount();
  });

  it("renders every journey step and detail without an expansion control", () => {
    const steps = Array.from({ length: 7 }, (_, i) => ({
      id: `step-${i}`,
      label: `Journey step ${i + 1}`,
      detail: `Journey detail ${i + 1}`,
    }));
    const object: ScapeObject = {
      ...base,
      id: "expanded-journey",
      type: "journey",
      title: "Expanded journey",
      data: { steps },
    };
    const plugin = getPlugin("journey")!;
    const { container, unmount } = render(<plugin.Node object={object} selected={false} />);

    expect(container.textContent).toContain("Journey step 7");
    expect(container.textContent).toContain("Journey detail 7");
    expect(container.textContent).not.toMatch(/Show more|Show less/);
    unmount();
  });

  it("renders every wireframe primitive and label without an expansion control", () => {
    const primitives = Array.from({ length: 12 }, (_, i) => ({
      id: `primitive-${i}`,
      kind: "box" as const,
      label: `Wireframe element ${i + 1}`,
      span: 12,
    }));
    const object: ScapeObject = {
      ...base,
      id: "expanded-wireframe",
      type: "wireframe",
      title: "Expanded wireframe",
      data: { primitives },
    };
    const plugin = getPlugin("wireframe")!;
    const { container, unmount } = render(<plugin.Node object={object} selected={false} />);

    expect(container.textContent).toContain("Wireframe element 12");
    expect(container.textContent).not.toMatch(/Show more|Show less/);
    unmount();
  });
});

describe("inspectors dispatch UpdateObject", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function mountInspector(type: string) {
    const plugin = getPlugin(type)!;
    const object = Object.values(fixtureScape().objects).find((o) => o.type === type)!;
    const dispatch = vi.fn<(payload: ActionPayload) => void>();
    const mounted = render(<plugin.Inspector object={object} dispatch={dispatch} />);
    return { ...mounted, dispatch, object };
  }

  for (const type of EXPECTED_TYPES) {
    it(`${type}: typing produces exactly one action per pause, not one per keystroke`, () => {
      const { container, dispatch, object, unmount } = mountInspector(type);
      const input = container.querySelector<HTMLInputElement>('input[placeholder="Untitled"]')!;

      // Eight keystrokes in rapid succession.
      for (const value of ["A", "Ab", "Abc", "Abcd", "Abcde", "Abcdef", "Abcdefg", "Abcdefgh"]) {
        typeInto(input, value);
        act(() => void vi.advanceTimersByTime(20));
      }
      expect(dispatch).not.toHaveBeenCalled();

      act(() => void vi.advanceTimersByTime(200));
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith({
        type: "UpdateObject",
        id: object.id,
        patch: { title: "Abcdefgh" },
      });

      unmount();
    });
  }

  it("journey: adding a step dispatches one UpdateObject carrying the whole step list", () => {
    const { container, dispatch, object, unmount } = mountInspector("journey");
    const before = (object.data as { steps: unknown[] }).steps.length;

    const addButton = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Add step",
    )!;
    act(() => addButton.click());

    expect(dispatch).toHaveBeenCalledTimes(1);
    const payload = dispatch.mock.calls[0][0] as unknown as {
      type: string;
      patch: { data: { steps: unknown[] } };
    };
    expect(payload.type).toBe("UpdateObject");
    expect(payload.patch.data.steps).toHaveLength(before + 1);

    unmount();
  });
});

describe("wireframe layout", () => {
  const wireframe = () =>
    Object.values(fixtureScape().objects).find((o) => o.type === "wireframe")!;

  it("accepts a wireframe written before width, columns, align and size existed", () => {
    const legacy = {
      primitives: [
        { id: "a", kind: "heading", label: "Sign in", span: 12 },
        { id: "b", kind: "input", span: 6 },
      ],
    };
    expect(wireframeSchema.safeParse(legacy).success).toBe(true);
  });

  it("rejects a width outside what a card can usefully be", () => {
    // Card width is shared object geometry, not plugin data. The wireframe schema remains
    // strict so an obsolete v1 export must go through the document migration.
    expect(wireframeSchema.safeParse({ primitives: [], width: 480 }).success).toBe(false);
  });

  it("keeps existing elements and gives every inserted one a fresh id", () => {
    const object = wireframe();
    const dispatch = vi.fn<(payload: ActionPayload) => void>();
    const plugin = getPlugin("wireframe")!;
    const { container, unmount } = render(<plugin.Inspector object={object} dispatch={dispatch} />);

    const open = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Insert a layout",
    )!;
    act(() => open.click());
    const preset = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Sign-up form"),
    )!;
    act(() => preset.click());

    const payload = dispatch.mock.calls[0][0] as unknown as {
      patch: { data: { primitives: Array<{ id: string }> } };
    };
    const before = (object.data as { primitives: Array<{ id: string }> }).primitives;
    const after = payload.patch.data.primitives;

    expect(after.length).toBeGreaterThan(before.length);
    expect(after.slice(0, before.length).map((p) => p.id)).toEqual(before.map((p) => p.id));
    expect(new Set(after.map((p) => p.id)).size).toBe(after.length);

    unmount();
  });

  it("carries the rest of data through when one key changes", () => {
    const object = { ...wireframe(), width: 520 };
    const dispatch = vi.fn<(payload: ActionPayload) => void>();
    const plugin = getPlugin("wireframe")!;
    const { container, unmount } = render(<plugin.Inspector object={object} dispatch={dispatch} />);

    const add = [...container.querySelectorAll("button")].find((b) => b.textContent === "+ text")!;
    act(() => add.click());

    const payload = dispatch.mock.calls[0][0] as unknown as {
      patch: { data: { primitives: unknown[] } };
    };
    expect(payload.patch.data).not.toHaveProperty("width");
    expect(payload.patch.data.primitives.length).toBeGreaterThan(0);

    unmount();
  });
});
