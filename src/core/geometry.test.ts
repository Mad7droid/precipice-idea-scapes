import { describe, expect, it } from "vitest";
import { NODE_WIDTH, objectWidth, widthFor } from "./geometry";

const note = (body: string, width?: number) => ({
  type: "note",
  data: { body },
  ...(width ? { width } : {}),
});
const step = (label: string, detail?: string) => ({ id: label, label, detail });

describe("objectWidth", () => {
  it("keeps the default width for short content", () => {
    expect(objectWidth(note("one\ntwo\nthree\nfour"))).toBe(NODE_WIDTH);
    expect(objectWidth({ type: "note", data: {} })).toBe(NODE_WIDTH);
  });

  it("widens a note once it would wrap past four lines", () => {
    expect(objectWidth(note("1\n2\n3\n4\n5"))).toBeGreaterThan(NODE_WIDTH);
    expect(objectWidth(note("word ".repeat(40)))).toBeGreaterThan(NODE_WIDTH);
  });

  it("ignores blank lines", () => {
    expect(objectWidth(note("1\n\n\n2\n\n3\n\n4"))).toBe(NODE_WIDTH);
  });

  it("widens a journey on step count and detail text", () => {
    const short = { type: "journey", data: { steps: [step("a"), step("b"), step("c")] } };
    const long = {
      type: "journey",
      data: { steps: [step("a"), step("b"), step("c"), step("d"), step("e")] },
    };
    const detailed = { type: "journey", data: { steps: [step("a", "detail ".repeat(20))] } };
    expect(objectWidth(short)).toBe(NODE_WIDTH);
    expect(objectWidth(long)).toBeGreaterThan(NODE_WIDTH);
    expect(objectWidth(detailed)).toBeGreaterThan(NODE_WIDTH);
  });

  it("widens a scape block beyond its default", () => {
    const body = "line\n".repeat(6);
    expect(objectWidth({ type: "scape", data: { body } })).toBeGreaterThan(widthFor("scape"));
    expect(objectWidth({ type: "scape", data: { body: "short" } })).toBe(widthFor("scape"));
  });

  it("lets a stored width win, clamped", () => {
    expect(objectWidth(note("1\n2\n3\n4\n5\n6", 250))).toBe(250);
    expect(objectWidth(note("short", 5000))).toBe(900);
  });

  it("leaves wireframes and unknown types alone", () => {
    expect(objectWidth({ type: "wireframe", data: { primitives: [] } })).toBe(380);
    expect(objectWidth({ type: "mystery", data: { body: "x\n".repeat(10) } })).toBe(NODE_WIDTH);
  });

  it("tolerates malformed data", () => {
    expect(objectWidth({ type: "journey", data: { steps: [null, 3, {}] } })).toBe(NODE_WIDTH);
    expect(objectWidth({ type: "note", data: { body: 7 } })).toBe(NODE_WIDTH);
  });
});
