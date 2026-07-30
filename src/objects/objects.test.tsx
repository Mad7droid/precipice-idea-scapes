import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionPayload } from "@/core/actions";
import { allPlugins, getPlugin } from "@/core/registry";
import type { ScapeObject } from "@/core/types";
import { fixtureScape } from "@/core/fixtures";
import { render, type as typeInto } from "@/test/react";

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
