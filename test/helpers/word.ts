/**
 * Reading the Word copy's blocks (src/share/word/blocks.ts) in a test: the tables among them, the
 * headings in order, the blocks under a heading, the lines and the bold pieces they hold, the
 * addresses they link to, and what a part says. The blocks are plain data, so nothing here opens a
 * .docx. The tests of each builder in src/share/word/ share these, so each file says only what it
 * adds.
 */
import { lineText, type Line } from "../../src/share/line.js";
import { wordsOf, type Block, type Cell } from "../../src/share/word/blocks.js";

/** A table among the blocks. */
export type Table = Extract<Block, { kind: "table" }>;

/** The tables among the blocks, in order. */
export function tablesIn(blocks: Block[]): Table[] {
  return blocks.filter((block): block is Table => block.kind === "table");
}

/** The table at a place among the blocks' tables, counting from 0. */
export function tableAt(blocks: Block[], at: number): Table {
  const found = tablesIn(blocks)[at];
  if (found === undefined) throw new Error(`No table at ${at}`);
  return found;
}

/** The headings among the blocks, in order, each as its level and its words: "2 Flags by rule". */
export function outlineOf(blocks: Block[]): string[] {
  return blocks.flatMap((block) =>
    block.kind === "heading" ? [`${block.level} ${block.text}`] : [],
  );
}

/** The blocks under a heading: those after it, up to the next heading or the end. */
export function under(blocks: Block[], words: string): Block[] {
  const start = blocks.findIndex((block) => block.kind === "heading" && block.text === words);
  if (start === -1) throw new Error(`No heading "${words}"`);
  const rest = blocks.slice(start + 1);
  const end = rest.findIndex((block) => block.kind === "heading");
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * The blocks split at each heading of a level, one part for each: the heading, and what follows it
 * up to the next heading of its level or a higher one, so a heading 2's own heading 3s are inside
 * its part. Blocks before the first heading of the level are in no part. It tells each page, or
 * each problem, apart from the next, which a search for one's words in the whole outline can't:
 * another's identical words would stand in for them.
 */
export function partsAt(blocks: Block[], level: 1 | 2 | 3): Block[][] {
  const parts: Block[][] = [];
  let current: Block[] | null = null;
  for (const block of blocks) {
    if (block.kind === "heading" && block.level <= level) {
      current = block.level === level ? [block] : null;
      if (current !== null) parts.push(current);
    } else {
      current?.push(block);
    }
  }
  return parts;
}

/** The pieces of a line that are in bold, as their words. */
export function boldIn(line: Line): string[] {
  return line.flatMap((piece) => (typeof piece !== "string" && piece.bold ? [piece.text] : []));
}

/** The words of each line of a table's cell: one string for each paragraph the cell has. */
export function cellLines(cell: Cell | undefined): string[] {
  return (cell?.lines ?? []).map(lineText);
}

/** What one part of the outline says, a line for each string `wordsOf` gives. */
export function saysOf(blocks: Block[]): string {
  return wordsOf(blocks).join("\n");
}

/** Every line the blocks hold, in order: a paragraph's, each list item's, and each cell's lines. */
export function linesIn(blocks: Block[]): Line[] {
  return blocks.flatMap((block): Line[] => {
    switch (block.kind) {
      case "para":
        return [block.line];
      case "list":
        return block.items;
      case "table":
        return block.rows.flatMap((row) => row.flatMap((cell) => cell.lines));
      default:
        return [];
    }
  });
}

/** Every address the blocks link to, in order. */
export function hrefsOf(blocks: Block[]): string[] {
  return linesIn(blocks).flatMap((line) =>
    line.flatMap((piece) =>
      typeof piece === "string" || piece.href === undefined ? [] : [piece.href],
    ),
  );
}
