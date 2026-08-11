import { describe, expect, it } from "vitest";
import {
  continueList,
  insertLink,
  richTextToBlocks,
  richTextToPlainText,
  toggleWrap,
  type TextSelection,
} from "./markdownText";

/** `a|b` marks a collapsed caret, `a[bc]d` marks a selection. Keeps the cases readable. */
function parse(marked: string): TextSelection {
  if (marked.includes("|")) {
    const start = marked.indexOf("|");
    return { value: marked.replace("|", ""), start, end: start };
  }
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return { value: marked.replace("[", "").replace("]", ""), start, end };
}

function show(state: TextSelection): string {
  if (state.start === state.end)
    return `${state.value.slice(0, state.start)}|${state.value.slice(state.start)}`;
  return `${state.value.slice(0, state.start)}[${state.value.slice(state.start, state.end)}]${state.value.slice(state.end)}`;
}

describe("toggleWrap", () => {
  it("wraps a selection and keeps it selected", () => {
    expect(show(toggleWrap(parse("say [hello] there"), "bold"))).toBe("say **[hello]** there");
  });

  it("italicises with a single underscore, not an asterisk", () => {
    expect(show(toggleWrap(parse("say [hello]"), "italic"))).toBe("say _[hello]_");
  });

  it("unwraps when the markers are inside the selection", () => {
    expect(show(toggleWrap(parse("say [**hello**] there"), "bold"))).toBe("say [hello] there");
  });

  it("unwraps when the markers sit just outside the selection", () => {
    expect(show(toggleWrap(parse("say **[hello]** there"), "bold"))).toBe("say [hello] there");
  });

  it("does not nest on a second press — the shortcut toggles", () => {
    const once = toggleWrap(parse("[x]"), "bold");
    expect(toggleWrap(once, "bold").value).toBe("x");
  });

  it("inserts the pair and puts the caret between them with no selection", () => {
    expect(show(toggleWrap(parse("a|b"), "bold"))).toBe("a**|**b");
  });
});

describe("insertLink", () => {
  it("keeps the selection as the label and selects the url to type over", () => {
    expect(show(insertLink(parse("see [docs] now")))).toBe("see [docs]([url]) now");
  });

  it("selects the placeholder label when there is no selection", () => {
    expect(show(insertLink(parse("see |")))).toBe("see [[text]](url)");
  });
});

describe("continueList", () => {
  it("continues a bullet list", () => {
    expect(show(continueList(parse("- one|"))!)).toBe("- one\n- |");
  });

  it("continues and increments an ordered list", () => {
    expect(show(continueList(parse("1. one|"))!)).toBe("1. one\n2. |");
  });

  it("preserves indentation", () => {
    expect(show(continueList(parse("  - one|"))!)).toBe("  - one\n  - |");
  });

  it("ends the list when the item is empty, instead of adding another bullet", () => {
    expect(show(continueList(parse("- one\n- |"))!)).toBe("- one\n|");
  });

  it("returns null outside a list, so the browser inserts the newline and undo still works", () => {
    expect(continueList(parse("just prose|"))).toBeNull();
  });

  it("returns null when there is a selection", () => {
    expect(continueList(parse("- [one]"))).toBeNull();
  });
});

describe("richTextToPlainText", () => {
  it("flattens to one line for the model's budget", () => {
    expect(richTextToPlainText("**bold** and _italic_ and `code`")).toBe(
      "bold and italic and code",
    );
  });

  it("keeps a link's label and drops its url", () => {
    expect(richTextToPlainText("see [the docs](https://example.com)")).toBe("see the docs");
  });
});

describe("richTextToBlocks", () => {
  it("strips inline syntax so a PDF never prints asterisks", () => {
    expect(richTextToBlocks("This is **bold** text")).toEqual([
      { text: "This is bold text", list: false },
    ]);
  });

  it("keeps a bullet list as separate items rather than one run-on paragraph", () => {
    expect(richTextToBlocks("- one\n- two")).toEqual([
      { text: "• one", list: true },
      { text: "• two", list: true },
    ]);
  });

  it("keeps ordered list numbering", () => {
    expect(richTextToBlocks("1. first\n2. second")).toEqual([
      { text: "1. first", list: true },
      { text: "2. second", list: true },
    ]);
  });

  it("joins soft-wrapped lines into one paragraph and splits on blank lines", () => {
    expect(richTextToBlocks("one\ntwo\n\nthree")).toEqual([
      { text: "one two", list: false },
      { text: "three", list: false },
    ]);
  });

  it("treats a paragraph that merely contains a dash as prose", () => {
    expect(richTextToBlocks("a sentence - with a dash")).toEqual([
      { text: "a sentence - with a dash", list: false },
    ]);
  });

  it("drops heading markers but keeps the heading text", () => {
    expect(richTextToBlocks("## Overview")).toEqual([{ text: "Overview", list: false }]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(richTextToBlocks("")).toEqual([]);
    expect(richTextToBlocks("   \n\n  ")).toEqual([]);
  });
});
