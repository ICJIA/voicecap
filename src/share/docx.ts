/**
 * The Word copy as a .docx: an outline of blocks (word/blocks.ts) made into a Word document with the
 * `docx` library, and `renderWordCopy`, which makes the whole report's copy from its model. This is
 * the only file that uses the library, and it loads it when a document is made, so no other command
 * pays for loading it.
 *
 * The document is US Letter with 1-inch margins, black on white, in Word's own styles: Title, and
 * Heading 1 to Heading 4. Body text is Calibri 11 pt, a table's text 10 pt, and fixed-width text
 * Consolas 9 pt, in a paragraph style named Mono. A table has a header row, in bold on light gray,
 * that repeats on every page; a link is blue and underlined. The footer of every page says where
 * the page is in the document. A picture is a JPEG, 400 pixels wide with its height in proportion
 * (or as wide as the table cell it's in, when that's narrower), whose alt text is its description.
 *
 * What the library leaves to us:
 * - It writes every character as it is, those XML forbids too, and a file with one of them in it is
 *   no XML and opens in nothing. So each word is cleaned first (`clean`).
 * - A newline in a run's text is no line break in Word. So a newline is made a break, and a tab a
 *   tab, as Word writes them.
 * - A paragraph costs time: a site of 400 pages took 32 seconds to write with a paragraph for each
 *   line of a transcript, and 1 second with one for each transcript. So a block of fixed-width
 *   lines is one paragraph, with a line break after each line, never a paragraph for each.
 * - It writes the alt text of a picture as it is too, so that is cleaned like every other word.
 */
import type * as DocxModule from "docx";

import type { Inline, Line } from "./line.js";
import type { ShareModel } from "./model.js";
import type { Block, Cell, Picture } from "./word/blocks.js";
import { wordOutline, wordProperties } from "./word/outline.js";

type Docx = typeof DocxModule;
/** What a document's body, or a table's cell, holds. */
type Child = DocxModule.Paragraph | DocxModule.Table;
/** What a paragraph holds of a line: its words, as runs, and its links. */
type LineChild = DocxModule.TextRun | DocxModule.ExternalHyperlink;

/** What a Word copy's properties and footer say. */
export interface WordProperties {
  /** The document's title. */
  title: string;
  /** Its author: the preparer, or "voicecap" when the records name no one. */
  author: string;
  /** What each page's footer says before "Page 3 of 41". */
  footer: string;
}

// Sizes are in twentieths of a point, and type sizes in half-points, as Word's file has them.

/** US Letter. */
const PAGE_WIDTH = 12240;
const PAGE_HEIGHT = 15840;
/** An inch, on every side. */
const MARGIN = 1440;
/** The width between the margins, which a table fills. */
const TEXT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

const BODY_FONT = "Calibri";
const MONO_FONT = "Consolas";
/** 11 pt, for the body; 10 pt for a table's text; 9 pt for fixed-width text and the footer. */
const BODY_SIZE = 22;
const TABLE_SIZE = 20;
const MONO_SIZE = 18;
const FOOTER_SIZE = 18;

/** The paragraph style of fixed-width text, and the one of a table's text. */
const MONO_STYLE = "Mono";
const TABLE_STYLE = "TableText";

const BLACK = "000000";
/** A header row's light gray. */
const HEADER_FILL = "D9D9D9";
/** The lines of a table: thin (half a point) and gray. */
const BORDER: DocxModule.IBorderOptions = { style: "single", size: 4, color: "A6A6A6" };
/** The space between a cell's edge and its words. */
const CELL_MARGINS = { top: 50, bottom: 50, left: 100, right: 100 };
/** The space between two paragraphs of one cell. */
const CELL_GAP = 60;

/** How wide a picture is on the page, in pixels, unless the table cell it's in is narrower. */
const PICTURE_WIDTH = 400;
/** A pixel in twentieths of a point, at 96 to the inch: what a cell's width is counted in. */
const TWIPS_PER_PIXEL = 15;

const DESCRIPTION = "Made with voicecap";

/** A heading's style: as large as its level says, bold, and black, kept with what follows it. */
function headingStyle(
  outlineLevel: number,
  size: number,
  before: number,
  after: number,
): DocxModule.IBaseParagraphStyleOptions {
  return {
    run: { size, bold: true, color: BLACK },
    paragraph: { spacing: { before, after }, keepNext: true, keepLines: true, outlineLevel },
  };
}

/**
 * The document's styles: its text, its title and headings (black, where the library's are blue),
 * and the two it adds, for fixed-width text and a table's text.
 */
const STYLES: DocxModule.IStylesOptions = {
  default: {
    document: {
      run: { font: BODY_FONT, size: BODY_SIZE, language: { value: "en-US" } },
      paragraph: { spacing: { after: 120, line: 264 } },
    },
    title: {
      run: { size: 56, bold: true, color: BLACK },
      paragraph: { spacing: { after: 120 } },
    },
    heading1: headingStyle(0, 32, 360, 120),
    heading2: headingStyle(1, 28, 240, 80),
    heading3: headingStyle(2, 24, 200, 60),
    heading4: headingStyle(3, 22, 160, 40),
    // A list's items sit together, with the space after the list rather than between its items.
    listParagraph: { paragraph: { contextualSpacing: true } },
  },
  paragraphStyles: [
    {
      id: MONO_STYLE,
      name: "Mono",
      basedOn: "Normal",
      run: { font: MONO_FONT, size: MONO_SIZE },
      paragraph: { spacing: { before: 0, after: 120, line: 240 } },
    },
    {
      id: TABLE_STYLE,
      name: "Table Text",
      basedOn: "Normal",
      run: { size: TABLE_SIZE },
      paragraph: { spacing: { before: 0, after: 0, line: 240 } },
    },
  ],
};

/**
 * Every character XML 1.0 forbids: any but tab, newline, carriage return, U+0020 to U+D7FF,
 * U+E000 to U+FFFD, and U+10000 to U+10FFFF. A lone surrogate is one.
 */
const FORBIDDEN = /[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu;

/** Words as a Word file can hold them: each character XML forbids shown as U+FFFD. */
function clean(words: string): string {
  return words.replace(FORBIDDEN, "\u{FFFD}");
}

/** How a run differs from the text around it. */
interface Look {
  bold?: true;
  /** In the fixed-width font, where the paragraph's own style isn't. */
  mono?: true;
  /** Where the run links to. */
  href?: string;
}

/** A line ends at a newline, or a carriage return with or without one. */
const LINE_END = /\r\n|\r|\n/;

/**
 * Runs for some words: a run for each stretch of them, a run for each tab, and a line break at the
 * start of each line after the first (a line with no words is a run of the break alone). No words,
 * no runs.
 *
 * The words go to the library as a run's `text`, never in its `children`: a `children` string that
 * is "CURRENT", "TOTAL_PAGES", "TOTAL_PAGES_IN_SECTION", or "SECTION" is read as a page-number
 * field, and the word would be gone.
 */
function runsOf(d: Docx, words: string, look: Look): DocxModule.TextRun[] {
  const text = clean(words);
  if (text === "") return [];
  const shared: DocxModule.IRunOptions = {
    bold: look.bold,
    font: look.mono ? MONO_FONT : undefined,
    size: look.mono ? MONO_SIZE : undefined,
    style: look.href === undefined ? undefined : "Hyperlink",
  };
  const runs: DocxModule.TextRun[] = [];
  for (const [index, line] of text.split(LINE_END).entries()) {
    // The line's first run carries the break that starts it.
    let lineBreak = index === 0 ? undefined : 1;
    const add = (own: DocxModule.IRunOptions) => {
      runs.push(new d.TextRun({ ...shared, ...own, break: lineBreak }));
      lineBreak = undefined;
    };
    for (const [at, piece] of line.split("\t").entries()) {
      if (at > 0) add({ children: [new d.Tab()] });
      if (piece !== "") add({ text: piece });
    }
    if (lineBreak !== undefined) add({});
  }
  return runs;
}

/** A piece of a line: its runs, inside a link when it has an address. */
function pieceOf(d: Docx, piece: Inline, within: Look): LineChild[] {
  const own: Exclude<Inline, string> = typeof piece === "string" ? { text: piece } : piece;
  const runs = runsOf(d, own.text, {
    bold: within.bold ?? own.bold,
    mono: within.mono ?? own.mono,
    href: own.href,
  });
  if (own.href === undefined || runs.length === 0) return runs;
  return [new d.ExternalHyperlink({ link: clean(own.href), children: runs })];
}

/** What a paragraph holds for a line. */
function lineOf(d: Docx, line: Line, within: Look = {}): LineChild[] {
  return line.flatMap((piece) => pieceOf(d, piece, within));
}

/**
 * A picture as a run of a paragraph: a JPEG `width` pixels wide, as high as its proportions make it.
 * Its alt text is its description, and its name and title too, so every reader of the file has the
 * words; each is cleaned as every word is.
 */
function pictureRun(d: Docx, picture: Picture, width: number): DocxModule.ImageRun {
  const alt = clean(picture.alt);
  return new d.ImageRun({
    type: "jpg",
    data: picture.jpeg,
    transformation: {
      width,
      height: Math.max(1, Math.round((width * picture.height) / picture.width)),
    },
    altText: { name: alt, description: alt, title: alt },
  });
}

/**
 * A cell's paragraphs, one for each line, and one for no line: Word needs a cell to hold a
 * paragraph. A cell's picture follows them in a paragraph of its own, as wide as the cell holds
 * (`room`, in pixels, inside its margins) but never wider than a picture is on the page.
 */
function cellParagraphs(
  d: Docx,
  cell: Cell,
  header: boolean,
  room: number,
): DocxModule.Paragraph[] {
  const lines: Line[] = cell.lines.length === 0 ? [[]] : cell.lines;
  const last = lines.length - 1;
  const words = lines.map(
    (line, index) =>
      new d.Paragraph({
        style: cell.mono ? MONO_STYLE : TABLE_STYLE,
        spacing: { before: 0, after: index === last && !cell.picture ? 0 : CELL_GAP },
        children: lineOf(d, line, header ? { bold: true } : {}),
      }),
  );
  if (cell.picture === undefined) return words;
  const width = Math.max(1, Math.min(PICTURE_WIDTH, room));
  return [
    ...words,
    new d.Paragraph({
      style: TABLE_STYLE,
      spacing: { before: 0, after: 0 },
      children: [pictureRun(d, cell.picture, width)],
    }),
  ];
}

/**
 * The width of each column: its share of the text width, in whole twentieths of a point that add up
 * to the text width. Equal shares without any.
 */
function columnWidths(shares: number[] | undefined, columns: number): number[] {
  const parts = shares ?? Array.from({ length: columns }, () => 1);
  const total = parts.reduce((sum, part) => sum + part, 0);
  let through = 0;
  let edge = 0;
  return parts.map((part) => {
    through += part;
    const next = Math.round((TEXT_WIDTH * through) / total);
    const width = next - edge;
    edge = next;
    return width;
  });
}

/**
 * A table of fixed columns, as wide as the text. The widths are given to the table, to its grid,
 * and to each cell, as Word, Pages, and Google Docs each read them. The header row repeats on every
 * page, and no row breaks across two.
 */
function tableOf(d: Docx, block: Extract<Block, { kind: "table" }>): DocxModule.Table {
  const widths = columnWidths(block.widths, block.head.length);
  const headings = block.head.map((text): Cell => ({ lines: [[text]] }));
  // What a column holds of a picture: its width less its cell's margins, in whole pixels.
  const roomIn = (column: number): number =>
    Math.floor(((widths[column] ?? 0) - CELL_MARGINS.left - CELL_MARGINS.right) / TWIPS_PER_PIXEL);
  const rowOf = (cells: Cell[], header: boolean) =>
    new d.TableRow({
      // Only the header row says so: the library writes an "off" for any other.
      tableHeader: header ? true : undefined,
      cantSplit: true,
      children: cells.map(
        (cell, column) =>
          new d.TableCell({
            width: { size: widths[column] ?? 0, type: d.WidthType.DXA },
            shading: header
              ? { type: d.ShadingType.CLEAR, color: "auto", fill: HEADER_FILL }
              : undefined,
            children: cellParagraphs(d, cell, header, roomIn(column)),
          }),
      ),
    });
  return new d.Table({
    width: { size: TEXT_WIDTH, type: d.WidthType.DXA },
    columnWidths: widths,
    layout: d.TableLayoutType.FIXED,
    borders: {
      top: BORDER,
      bottom: BORDER,
      left: BORDER,
      right: BORDER,
      insideHorizontal: BORDER,
      insideVertical: BORDER,
    },
    margins: CELL_MARGINS,
    tableLook: { firstRow: true },
    rows: [rowOf(headings, true), ...block.rows.map((row) => rowOf(row, false))],
  });
}

/**
 * A block as what the document holds: a paragraph or a table, or more than one, or none. `next` is
 * the block after it: a paragraph that a picture follows is kept with it, so a line that names the
 * picture is never left at the foot of a page with the picture on the next.
 */
function blockOf(d: Docx, block: Block, next: Block | undefined): Child[] {
  switch (block.kind) {
    case "title":
      return [
        new d.Paragraph({
          heading: d.HeadingLevel.TITLE,
          children: runsOf(d, block.text, {}),
        }),
      ];
    case "heading": {
      const levels = {
        1: d.HeadingLevel.HEADING_1,
        2: d.HeadingLevel.HEADING_2,
        3: d.HeadingLevel.HEADING_3,
        4: d.HeadingLevel.HEADING_4,
      } as const;
      return [
        new d.Paragraph({ heading: levels[block.level], children: runsOf(d, block.text, {}) }),
      ];
    }
    case "para":
      return [
        new d.Paragraph({
          keepNext: next?.kind === "image" ? true : undefined,
          children: lineOf(d, block.line),
        }),
      ];
    case "list":
      return block.items.map(
        (item) => new d.Paragraph({ bullet: { level: 0 }, children: lineOf(d, item) }),
      );
    case "table":
      return [tableOf(d, block)];
    case "mono":
      return block.lines.length === 0
        ? []
        : [
            new d.Paragraph({
              style: MONO_STYLE,
              children: runsOf(d, block.lines.join("\n"), {}),
            }),
          ];
    case "image":
      return [new d.Paragraph({ children: [pictureRun(d, block, PICTURE_WIDTH)] })];
    case "pageBreak":
      return [new d.Paragraph({ children: [new d.PageBreak()] })];
  }
}

/**
 * The footer of every page: its words, then "Page 3 of 41", centered in 9 pt. The words are a run's
 * `text`, as everywhere (see `runsOf`); only the two page numbers are in `children`, and they are
 * the library's own `PageNumber` values.
 */
function footerOf(d: Docx, words: string): DocxModule.Footer {
  const run = (options: DocxModule.IRunOptions) => new d.TextRun({ ...options, size: FOOTER_SIZE });
  return new d.Footer({
    children: [
      new d.Paragraph({
        alignment: d.AlignmentType.CENTER,
        spacing: { after: 0 },
        children: [
          run({ text: `${clean(words)}. Page ` }),
          run({ children: [d.PageNumber.CURRENT] }),
          run({ text: " of " }),
          run({ children: [d.PageNumber.TOTAL_PAGES] }),
        ],
      }),
    ],
  });
}

/** The blocks as a .docx. Loads `docx` when called. */
export async function docxOf(blocks: Block[], properties: WordProperties): Promise<Uint8Array> {
  const d = await import("docx");
  const author = clean(properties.author);
  const document = new d.Document({
    creator: author,
    lastModifiedBy: author,
    title: clean(properties.title),
    description: DESCRIPTION,
    styles: STYLES,
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        footers: { default: footerOf(d, properties.footer) },
        children: blocks.flatMap((block, index) => blockOf(d, block, blocks[index + 1])),
      },
    ],
  });
  return d.Packer.toBuffer(document);
}

/**
 * The Word copy of the shareable report, from the model: its outline (word/outline.ts) and its
 * properties made into a .docx. Loads `docx` when called.
 */
export async function renderWordCopy(model: ShareModel): Promise<Uint8Array> {
  return docxOf(wordOutline(model), wordProperties(model));
}
