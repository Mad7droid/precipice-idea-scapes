import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ScapeObject } from "@/core/types";
import { describeObject } from "@/export/pdf/describe";
import { entryLines } from "@/export/pdf/document";

const note = (body: string) =>
  ({ id: "obj_internal", type: "note", data: { body } }) as unknown as ScapeObject;
const plugin = { schema: z.object({ body: z.string() }) };

describe("PDF note description", () => {
  it("says when a note was shortened for print", () => {
    const lines = describeObject(note("word ".repeat(400)), plugin)[0]!.lines;
    expect(lines.at(-1)?.text).toMatch(/Shortened for print/);
    expect(describeObject(note("short"), plugin)[0]!.lines).toHaveLength(1);
  });

  it("does not print internal object ids", () => {
    const lines = entryLines({
      id: "obj_internal",
      sections: [{ lines: [{ text: "Body" }] }],
      outgoing: [],
      incoming: [],
    } as unknown as Parameters<typeof entryLines>[0]);
    expect(lines.map((line) => line.text)).not.toContain("obj_internal");
  });
});
