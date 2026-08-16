/**
 * Markdown as text, and Markdown as something you type.
 *
 * Deliberately React-free and dependency-free, so the PDF export can strip syntax without
 * pulling `react-markdown` into the export chunk — `src/objects/ui.tsx` imports React, and
 * `src/export/pdf/describe.ts` must not.
 *
 * It is a file rather than a folder because the plugin registry globs
 * `/src/objects/*​/index.ts`; a `markdown/` directory with an `index.ts` would be registered
 * as an object type and warn. Same reason `ui.tsx` is a file.
 */

/** Inline syntax only: emphasis, code, strikethrough, links. Never touches line structure. */
function stripInline(text: string): string {
  return (
    text
      // Links and images before emphasis, so the label survives and the URL does not.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/(\*\*\*|___)(.+?)\1/g, "$2")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(\*|_)(.+?)\1/g, "$2")
      .replace(/~~(.+?)~~/g, "$1")
  );
}

/**
 * One flat line, for the model and for `toText`.
 *
 * Structure is thrown away on purpose: this feeds a 118-character budget, where a bullet
 * costs as much as a word. Kept as the previous implementation behaved so `toText` output
 * does not shift underneath the AI prompts that were tuned against it.
 */
export function richTextToPlainText(value: string): string {
  return stripInline(value)
    .replace(/[*_~>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A block of prose, or one list item. `text` is already stripped of Markdown syntax. */
export interface RichTextBlock {
  text: string;
  list: boolean;
  /** The block was a Markdown heading. Callers that have a heading style may use it; the ones
   *  that don't get the text with the `#` already removed, as before. */
  heading?: boolean;
}

const BULLET = /^\s*[-*+]\s+/;
const ORDERED = /^\s*(\d+)([.)])\s+/;
const HEADING = /^\s*#{1,6}\s+/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
/** `|---|:--:|` — the rule under a table's header row, which carries no content. */
const TABLE_RULE = /^\s*\|[\s:|-]+\|\s*$/;

/**
 * Markdown to printable blocks, preserving the structure a page has room for.
 *
 * `richTextToPlainText` is wrong for a document: it replaces every `-` with a space, so a
 * bullet list prints as one run-on paragraph. Here a list stays a list — which is the whole
 * reason someone wrote one.
 *
 * Not a Markdown parser, and not trying to be. Blocks are split on blank lines, soft wraps
 * inside a paragraph are joined, and anything that is not a list is prose.
 */
export function richTextToBlocks(value: string): RichTextBlock[] {
  return value
    .split(/\n{2,}/)
    .flatMap((block) => {
      const lines = block.split("\n").filter((line) => line.trim().length > 0);
      if (lines.length === 0) return [];

      // A table cannot be drawn in a text line, so it prints as one indented row per line with
      // the cells separated. Losing the grid is better than printing the pipes.
      if (lines.length > 1 && lines.every((line) => TABLE_ROW.test(line))) {
        return lines.flatMap((line) => {
          if (TABLE_RULE.test(line)) return [];
          const cells = line
            .trim()
            .slice(1, -1)
            .split("|")
            .map((cell) => stripInline(cell).trim())
            .filter((cell) => cell.length > 0);
          return cells.length ? [{ text: cells.join(" · "), list: true }] : [];
        });
      }

      // A heading is its own block and keeps its identity, so a printed document can style it.
      if (lines.length === 1 && HEADING.test(lines[0])) {
        const text = stripInline(lines[0].replace(HEADING, "")).trim();
        return text ? [{ text, list: false, heading: true }] : [];
      }

      // A block counts as a list only if every line is an item; one stray bullet inside a
      // paragraph is prose that happens to start with a dash.
      const isList = lines.every((line) => BULLET.test(line) || ORDERED.test(line));
      if (isList) {
        return lines.flatMap((line) => {
          const ordered = line.match(ORDERED);
          const body = stripInline(line.replace(BULLET, "").replace(ORDERED, "")).trim();
          if (!body) return [];
          return [{ text: ordered ? `${ordered[1]}. ${body}` : `• ${body}`, list: true }];
        });
      }

      const text = stripInline(lines.join(" ").replace(HEADING, "")).replace(/\s+/g, " ").trim();
      return text ? [{ text, list: false }] : [];
    })
    .filter((block) => block.text.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Editing                                                                     */
/* -------------------------------------------------------------------------- */

/** A textarea's editable state. Pure in, pure out, so every rule below is unit-testable. */
export interface TextSelection {
  value: string;
  start: number;
  end: number;
}

const WRAPPERS = { bold: "**", italic: "_" } as const;

export type WrapKind = keyof typeof WRAPPERS;

/**
 * Cmd+B / Cmd+I. Wraps the selection, or unwraps it when it is already wrapped, so the
 * shortcut toggles rather than nesting `****bold****` on a second press.
 *
 * With no selection it inserts the pair and puts the caret between them, which is what every
 * other editor does and what makes the shortcut usable before you have typed anything.
 */
export function toggleWrap(state: TextSelection, kind: WrapKind): TextSelection {
  const token = WRAPPERS[kind];
  const { value, start, end } = state;
  const selected = value.slice(start, end);

  // `**bold**` selected whole.
  if (selected.length >= token.length * 2 && selected.startsWith(token) && selected.endsWith(token))
    return {
      value: value.slice(0, start) + selected.slice(token.length, -token.length) + value.slice(end),
      start,
      end: end - token.length * 2,
    };

  // `bold` selected with the markers just outside it.
  const before = value.slice(Math.max(0, start - token.length), start);
  const after = value.slice(end, end + token.length);
  if (before === token && after === token)
    return {
      value: value.slice(0, start - token.length) + selected + value.slice(end + token.length),
      start: start - token.length,
      end: end - token.length,
    };

  return {
    value: value.slice(0, start) + token + selected + token + value.slice(end),
    start: start + token.length,
    end: end + token.length,
  };
}

/**
 * Cmd+K. Selects the part you still have to type: the URL when there is link text already,
 * the link text when there is not.
 */
export function insertLink(state: TextSelection): TextSelection {
  const { value, start, end } = state;
  const selected = value.slice(start, end);
  const label = selected || "text";
  const inserted = `[${label}](url)`;
  const target = selected ? "url" : "text";
  const offset = inserted.lastIndexOf(target);
  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    start: start + offset,
    end: start + offset + target.length,
  };
}

/**
 * Enter inside a list continues it.
 *
 * Returns `null` when the caret is not in a list, so the caller lets the browser insert the
 * newline itself and native undo keeps working for the ordinary case.
 *
 * Enter on an *empty* item ends the list instead of adding another empty bullet — without
 * that, the only way out of a list is to backspace the marker you did not ask for.
 */
export function continueList(state: TextSelection): TextSelection | null {
  const { value, start, end } = state;
  if (start !== end) return null;

  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const line = value.slice(lineStart, start);

  const ordered = line.match(ORDERED);
  const bullet = line.match(BULLET);
  if (!ordered && !bullet) return null;

  const marker = (ordered ?? bullet)![0];
  const indent = /^\s*/.exec(line)![0];

  // Empty item: drop the marker and leave the caret on a blank line.
  if (line.slice(marker.length).trim() === "") {
    return {
      value: value.slice(0, lineStart) + value.slice(start),
      start: lineStart,
      end: lineStart,
    };
  }

  // `1)` and `1.` are both valid ordered markers; carry over whichever the author used.
  const next = ordered ? `${indent}${Number(ordered[1]) + 1}${ordered[2]} ` : marker;
  const insertion = `\n${next}`;
  return {
    value: value.slice(0, start) + insertion + value.slice(start),
    start: start + insertion.length,
    end: start + insertion.length,
  };
}
