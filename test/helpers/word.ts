/**
 * Reading the Word copy's blocks (src/share/word/blocks.ts) in a test: the tables among them, the
 * headings in order, the blocks under a heading, and the lines and the bold pieces they hold. The
 * blocks are plain data, so nothing here opens a .docx. The tests of each builder in
 * src/share/word/ share these, so each file says only what it adds.
 */
import type { Line } from "../../src/share/line.js";
import type { Block } from "../../src/share/word/blocks.js";

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

/** The pieces of a line that are in bold, as their words. */
export function boldIn(line: Line): string[] {
  return line.flatMap((piece) => (typeof piece !== "string" && piece.bold ? [piece.text] : []));
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
