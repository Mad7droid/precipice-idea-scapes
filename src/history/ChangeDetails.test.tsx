import { expect, it } from "vitest";
import { emptyScape } from "@/core/fixtures";
import { applyAction } from "@/core/reducer";
import { render } from "@/test/react";
import { ChangeDetails } from "./ChangeDetails";
import { changesBetween } from "./model";

it("shows the complete before/after content including edits beyond short plugin summaries", () => {
  const before = applyAction(emptyScape("s"), {
    type: "CreateObject",
    id: "note",
    objectType: "note",
    title: "Long note",
    data: { body: `${"Context ".repeat(40)}Original ending` },
    ts: 1,
    txId: "t",
  }).state;
  const after = structuredClone(before);
  after.objects.note.data.body = `${"Context ".repeat(40)}Revised ending`;
  const mounted = render(
    <ChangeDetails change={changesBetween(before, after)[0]} before={before} after={after} />,
  );
  expect(mounted.container.textContent).toContain("Original ending");
  expect(mounted.container.textContent).toContain("Revised ending");
  mounted.unmount();
});
