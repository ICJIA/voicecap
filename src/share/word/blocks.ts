/**
 * The outline of the Word copy: a few kinds of plain block, in the order the document has them. The
 * builders of this folder make blocks from the page's model, and `docxOf` (../docx.ts) makes a
 * .docx from blocks. A block holds words and nothing of the library, so what a builder says is
 * tested as data. Pure.
 */
import { lineText, type Inline, type Line } from "../line.js";

/**
 * A picture: a JPEG, its size in pixels (which gives its proportions), and its alt text, the words
 * a screen reader says of it.
 */
export interface Picture {
  jpeg: Uint8Array;
  width: number;
  height: number;
  alt: string;
}

/** A table cell: its lines, each a paragraph of its own; `mono` sets them in the fixed-width font. */
export interface Cell {
  lines: Line[];
  mono?: true;
}

/** A part of the outline. Nothing in one is escaped: `docxOf` sets each word in a run of its own. */
export type Block =
  | { kind: "title"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  /** `keepNext`: kept on the printed page with the block after it (see `leadIn`). */
  | { kind: "para"; line: Line; keepNext?: true }
  | { kind: "list"; items: Line[] }
  | { kind: "table"; head: string[]; rows: Cell[][]; widths?: number[] }
  /** Lines in the fixed-width font, as one paragraph with a line break after each. */
  | { kind: "mono"; lines: string[] }
  /** A picture, in a paragraph of its own. */
  | ({ kind: "image" } & Picture)
  | { kind: "pageBreak" };

/** A line, from plain words or as it is. */
function lineOf(line: Line | string): Line {
  return typeof line === "string" ? [line] : line;
}

/** The document's title: the site's name, at the top. */
export function title(text: string): Block {
  return { kind: "title", text };
}

/**
 * A heading: level 1 for a section, and 2 to 4 inside one, in order and never skipping a level. The
 * document's styles (../docx.ts) go no further than Heading 4.
 */
export function heading(level: 1 | 2 | 3 | 4, text: string): Block {
  return { kind: "heading", level, text };
}

/**
 * Some blocks with each heading one level down: a section's level 1 is a part's level 2, and what
 * is inside it goes down with it, so no heading skips a level. Every other block is as it is.
 * Throws for a heading that is level 4 already, since the document has no level 5.
 */
export function demoted(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    if (block.kind !== "heading") return block;
    if (block.level === 4) throw new Error("A heading can't go below level 4.");
    return { ...block, level: (block.level + 1) as 2 | 3 | 4 };
  });
}

/** A paragraph of one line, made of pieces of words. */
export function para(...line: Inline[]): Block {
  return { kind: "para", line };
}

/**
 * A paragraph that leads into what follows it, such as a label in bold: kept on the printed page
 * with the block after it, whatever that is, so it never ends a page alone. (A paragraph that a
 * picture or a list follows is kept with it anyway: see `docxOf`.)
 */
export function leadIn(...line: Inline[]): Block {
  return { kind: "para", line, keepNext: true };
}

/** A bulleted list, an item for each line (or plain words). */
export function list(items: (Line | string)[]): Block {
  return { kind: "list", items: items.map(lineOf) };
}

/** A table's cell from what its row has for it: plain words, a line, or a cell as it is. */
function cellOf(item: Cell | Line | string): Cell {
  if (typeof item === "string") return { lines: [[item]] };
  return Array.isArray(item) ? { lines: [item] } : item;
}

/**
 * A table with a header row, and a row for each of `rows`, each with a cell for each heading.
 * `widths` are each column's share of the text width, and add up to 100; equal without them.
 * Throws for a table that wouldn't come out even: no headings, a row with more or fewer cells than
 * headings, or widths that aren't a number above 0 for each heading.
 */
export function table(head: string[], rows: (Cell | Line | string)[][], widths?: number[]): Block {
  if (head.length === 0) throw new Error("A table needs at least one heading.");
  const uneven = rows.findIndex((row) => row.length !== head.length);
  if (uneven !== -1) {
    throw new Error(`Row ${uneven + 1} of a table doesn't have a cell for each heading.`);
  }
  const unfit =
    widths !== undefined && (widths.length !== head.length || widths.some((width) => !(width > 0)));
  if (unfit) throw new Error("A table's widths need a number above 0 for each heading.");
  return {
    kind: "table",
    head,
    rows: rows.map((row) => row.map(cellOf)),
    ...(widths === undefined ? {} : { widths }),
  };
}

/** A cell of lines, a paragraph for each. */
export function cell(...lines: (Line | string)[]): Cell {
  return { lines: lines.map(lineOf) };
}

/** A cell of lines in the fixed-width font, a paragraph for each. */
export function monoCell(...lines: string[]): Cell {
  return { lines: lines.map((line) => [line]), mono: true };
}

/** Lines in the fixed-width font: one paragraph, with a line break after each line but the last. */
export function mono(lines: string[]): Block {
  return { kind: "mono", lines };
}

/** A picture, in a paragraph of its own. */
export function image(picture: Picture): Block {
  return { kind: "image", ...picture };
}

/** The end of a page. */
export const PAGE_BREAK: Block = { kind: "pageBreak" };

/** A cell's words: its lines, set apart by " / ". */
function cellWords(of: Cell): string {
  return of.lines.map(lineText).join(" / ");
}

/**
 * Every word of some blocks: a string for each title, heading, paragraph, list item, table row (its
 * cells joined by " | ", a cell's lines by " / "), fixed-width line, and picture (its alt text). A
 * table's first row is its headings.
 */
export function wordsOf(blocks: Block[]): string[] {
  return blocks.flatMap((block): string[] => {
    switch (block.kind) {
      case "title":
      case "heading":
        return [block.text];
      case "para":
        return [lineText(block.line)];
      case "list":
        return block.items.map(lineText);
      case "table":
        return [block.head, ...block.rows.map((row) => row.map(cellWords))].map((cells) =>
          cells.join(" | "),
        );
      case "mono":
        return block.lines;
      case "image":
        return [block.alt];
      case "pageBreak":
        return [];
    }
  });
}
