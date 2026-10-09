/**
 * The Word copy's blocks, and the .docx they make: what the file's XML says of the page, its styles,
 * its tables, its links, its properties, and its footer, read back out of the zip. Two builds of one
 * document differ in bytes, so nothing here compares bytes.
 */
import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it, vi } from "vitest";

import type { RunJson } from "../src/model.js";
import { docxOf, renderWordCopy } from "../src/share/docx.js";
import { buildShareModel } from "../src/share/model.js";
import { wordProblems } from "../src/share/word/problems.js";
import {
  PAGE_BREAK,
  cell,
  demoted,
  heading,
  image,
  list,
  mono,
  monoCell,
  para,
  table,
  title,
  wordsOf,
  type Block,
  type Picture,
} from "../src/share/word/blocks.js";
import {
  bodyTags,
  drawingsOf,
  keptWithNext,
  linksOf,
  paragraphsOf,
  tablesOf,
  unzipDocx,
} from "./helpers/docx.js";
import { TINY_JPEG, TINY_RECORD } from "./helpers/jpeg.js";
import { keptLogsModel, problemEntry } from "./helpers/nvda-log.js";
import { SITE } from "./helpers/report-data.js";
import { failedAttempt, shareRun } from "./helpers/share-data.js";
import { inputOf, LINES, storeOf, TRANSCRIPTS } from "./helpers/share-model.js";

const PROPERTIES = {
  title: "Demo: how its pages read aloud with NVDA",
  author: "Pat Lee",
  footer: "Demo, as of 30 September 2026",
};
const BLOCKS = [
  title("Demo"),
  heading(1, "Summary"),
  para(
    { text: "Bold.", bold: true },
    " Then ",
    { text: "code", mono: true },
    ", and ",
    { text: "a link", href: "https://github.com/ICJIA/voicecap" },
    ".",
  ),
  list(["one", "two"]),
  table(["Rule", "NVDA said"], [["generic-link-text", cell("“click here”", "“read more”")]]),
  mono(["line 1", "line 2", "line 3"]),
  PAGE_BREAK,
  heading(2, "Next"),
  heading(3, "Inside"),
];

/** A character XML 1.0 forbids: any but tab, newline, carriage return, and the ranges it allows. */
const FORBIDDEN = /[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/u;

/** The .docx of some blocks, opened. */
async function opened(blocks: Block[]) {
  return unzipDocx(await docxOf(blocks, PROPERTIES));
}

/** A style's XML, by its id. */
function styleXml(styles: string, id: string): string {
  const found = new RegExp(`<w:style [^>]*w:styleId="${id}"[^>]*>.*?</w:style>`, "s").exec(styles);
  if (found === null) throw new Error(`No ${id} style`);
  return found[0];
}

/** The runs of a document, each as its XML. */
function runsIn(document: string): string[] {
  return document.match(/<w:r>.*?<\/w:r>/gs) ?? [];
}

/** What a footer says, in order: each run of its words, and the code of each of its fields. */
function footerSaid(footer: string): string[] {
  return [...footer.matchAll(/<w:(?:t|instrText)[^>]*>(.*?)<\/w:(?:t|instrText)>/g)].map(
    ([, said = ""]) => said,
  );
}

/**
 * The words the library turns into a page-number field when it is handed one in a run's `children`
 * (the values of its `PageNumber`).
 */
const PAGE_NUMBER_WORDS = ["CURRENT", "TOTAL_PAGES", "TOTAL_PAGES_IN_SECTION", "SECTION"];

describe("the Word copy's blocks", () => {
  it("makes each kind of block as plain data", () => {
    expect(title("Demo")).toEqual({ kind: "title", text: "Demo" });
    expect(heading(2, "Next")).toEqual({ kind: "heading", level: 2, text: "Next" });
    expect(heading(4, "Deep")).toEqual({ kind: "heading", level: 4, text: "Deep" });
    expect(para("a ", { text: "b", bold: true })).toEqual({
      kind: "para",
      line: ["a ", { text: "b", bold: true }],
    });
    expect(list(["one", ["two ", { text: "x", mono: true }]])).toEqual({
      kind: "list",
      items: [["one"], ["two ", { text: "x", mono: true }]],
    });
    expect(mono(["a", "b"])).toEqual({ kind: "mono", lines: ["a", "b"] });
    expect(PAGE_BREAK).toEqual({ kind: "pageBreak" });
  });

  it("makes a table's cells from a string, a line, or a cell", () => {
    expect(
      table(
        ["A", "B", "C", "D"],
        [
          [
            "one",
            ["two ", { text: "x", bold: true }],
            cell("p", ["q", { text: "r", mono: true }]),
            monoCell("m", "n"),
          ],
        ],
        [10, 20, 30, 40],
      ),
    ).toEqual({
      kind: "table",
      head: ["A", "B", "C", "D"],
      rows: [
        [
          { lines: [["one"]] },
          { lines: [["two ", { text: "x", bold: true }]] },
          { lines: [["p"], ["q", { text: "r", mono: true }]] },
          { lines: [["m"], ["n"]], mono: true },
        ],
      ],
      widths: [10, 20, 30, 40],
    });
    // With no widths, the block says none: the columns are equal.
    expect(table(["A"], [["x"]])).toStrictEqual({
      kind: "table",
      head: ["A"],
      rows: [[{ lines: [["x"]] }]],
    });
  });

  it("refuses a table whose rows or widths don't fit its headings", () => {
    expect(() => table([], [])).toThrow("at least one heading");
    expect(() => table(["A", "B"], [["a", "b"], ["only one"]])).toThrow(
      "Row 2 of a table doesn't have a cell for each heading",
    );
    expect(() => table(["A", "B"], [["a", "b"]], [100])).toThrow("above 0 for each heading");
    expect(() => table(["A", "B"], [["a", "b"]], [100, 0])).toThrow("above 0 for each heading");
  });

  it("says every word of some blocks, a string for each", () => {
    expect(wordsOf(BLOCKS)).toEqual([
      "Demo",
      "Summary",
      "Bold. Then code, and a link.",
      "one",
      "two",
      "Rule | NVDA said",
      "generic-link-text | “click here” / “read more”",
      "line 1",
      "line 2",
      "line 3",
      "Next",
      "Inside",
    ]);
  });

  it("sets the headings of some blocks one level down, and leaves every other block as it is", () => {
    const blocks = [
      heading(1, "Section"),
      para("Words."),
      heading(2, "Part"),
      list(["one"]),
      heading(3, "Piece"),
      mono(["x"]),
      PAGE_BREAK,
    ];

    expect(demoted(blocks)).toEqual([
      heading(2, "Section"),
      para("Words."),
      heading(3, "Part"),
      list(["one"]),
      heading(4, "Piece"),
      mono(["x"]),
      PAGE_BREAK,
    ]);
    // The blocks it was given are not changed, and no blocks come out as no blocks.
    expect(blocks[0]).toEqual(heading(1, "Section"));
    expect(demoted([])).toEqual([]);
  });

  it("refuses to set a heading below level 4, since Word has no heading it can be", () => {
    const refusal = "A heading can't go below level 4.";

    expect(() => demoted([heading(4, "Too deep")])).toThrow(refusal);
    expect(() => demoted([heading(1, "Fine"), para("Words."), heading(4, "Too deep")])).toThrow(
      refusal,
    );
    // Level 3 is the last that can be set down.
    expect(demoted([heading(3, "Last")])).toEqual([heading(4, "Last")]);
  });
});

describe("docxOf", () => {
  it("is US Letter, in Word's own styles, with a header row that repeats", async () => {
    const parts = await unzipDocx(await docxOf(BLOCKS, PROPERTIES));
    expect(parts.document).toContain('<w:pgSz w:w="12240" w:h="15840"');
    expect(
      paragraphsOf(parts.document).filter(({ style }) => /^(Title|Heading\d)$/.test(style)),
    ).toEqual([
      { style: "Title", text: "Demo" },
      { style: "Heading1", text: "Summary" },
      { style: "Heading2", text: "Next" },
      { style: "Heading3", text: "Inside" },
    ]);
    expect(tablesOf(parts.document)).toEqual([
      {
        header: true,
        rows: [
          ["Rule", "NVDA said"],
          ["generic-link-text", "“click here”\n“read more”"],
        ],
      },
    ]);
    expect(linksOf(parts)).toEqual(["https://github.com/ICJIA/voicecap"]);
  });

  it("sets the title, the author, and the language", async () => {
    const { core, styles } = await unzipDocx(await docxOf(BLOCKS, PROPERTIES));
    expect(core).toContain("<dc:title>Demo: how its pages read aloud with NVDA</dc:title>");
    expect(core).toContain("<dc:creator>Pat Lee</dc:creator>");
    expect(core).toContain("<cp:lastModifiedBy>Pat Lee</cp:lastModifiedBy>");
    expect(styles).toContain('<w:lang w:val="en-US"');
  });

  it("numbers its pages in the footer", async () => {
    const { footer } = await unzipDocx(await docxOf(BLOCKS, PROPERTIES));
    expect(footer).toContain("Demo, as of 30 September 2026");
    expect(footer).toMatch(/PAGE<\/w:instrText>[\s\S]*NUMPAGES<\/w:instrText>/);
  });

  // Review Focus 3: a transcript is one paragraph, however many lines it has.
  it("writes fixed-width lines as one paragraph, a line break after each", async () => {
    const { document } = await unzipDocx(
      await docxOf([mono(["line 1", "line 2", "line 3"])], PROPERTIES),
    );
    expect(paragraphsOf(document)).toEqual([{ style: "Mono", text: "line 1\nline 2\nline 3" }]);
  });

  // Review Focus 2: characters XML forbids.
  it("shows a character XML forbids as U+FFFD, so the file still opens", async () => {
    const odd = [
      para("a\u0000b\u0001c\u000Bd\u{FFFE}e"),
      mono(["x\u001By"]),
      table(["H"], [["z\u0008"]]),
    ];
    const { document } = await unzipDocx(await docxOf(odd, PROPERTIES));
    expect(XMLValidator.validate(document)).toBe(true);
    // None is left: not one outside what XML allows.
    expect(FORBIDDEN.test(document)).toBe(false);
    expect(paragraphsOf(document)[0]?.text).toBe("a\u{FFFD}b\u{FFFD}c\u{FFFD}d\u{FFFD}e");
  });

  it("has no picture unless a block is one, so none lacks alt text", async () => {
    const parts = await opened(BLOCKS);

    expect(parts.document).not.toContain("<w:drawing");
    expect(drawingsOf(parts)).toEqual([]);
    expect(parts.media.size).toBe(0);
  });

  it("shows a character XML forbids as U+FFFD in every word the document holds", async () => {
    const bad = "x\u0000y\u{D800}z\u{FFFF}";
    const good = "x\u{FFFD}y\u{FFFD}z\u{FFFD}";
    const parts = await unzipDocx(
      await docxOf(
        [
          title(bad),
          heading(1, bad),
          list([bad]),
          para({ text: bad, bold: true }, { text: bad, href: `https://a.gov/?q=${bad}` }),
          mono([bad]),
          table([bad, bad], [[cell(bad), monoCell(bad)]]),
        ],
        { title: bad, author: bad, footer: bad },
      ),
    );

    for (const name of ["document", "styles", "core", "footer", "rels"] as const) {
      expect(XMLValidator.validate(parts[name]), name).toBe(true);
      expect(FORBIDDEN.test(parts[name]), name).toBe(false);
    }
    expect(paragraphsOf(parts.document).map(({ text }) => text)).toEqual([
      good,
      good,
      good,
      `${good}${good}`,
      good,
    ]);
    expect(tablesOf(parts.document)).toEqual([
      {
        header: true,
        rows: [
          [good, good],
          [good, good],
        ],
      },
    ]);
    expect(parts.core).toContain(`<dc:title>${good}</dc:title>`);
    expect(parts.core).toContain(`<dc:creator>${good}</dc:creator>`);
    expect(parts.core).toContain(`<cp:lastModifiedBy>${good}</cp:lastModifiedBy>`);
    expect(parts.footer).toContain(`>${good}. Page </w:t>`);
    expect(linksOf(parts)).toEqual([`https://a.gov/?q=${good}`]);
  });

  it("keeps the characters XML allows as they are, emoji and a tab among them", async () => {
    const allowed = "a\t\u{1F600}\u{E9}\u{FFFD}\u{2028}b";
    const { document } = await opened([para(allowed)]);
    expect(XMLValidator.validate(document)).toBe(true);
    expect(paragraphsOf(document)).toEqual([{ style: "", text: allowed }]);
  });

  // A word is a word: the library reads these four, handed to it as a run's `children`, as fields.
  it.each(PAGE_NUMBER_WORDS)("keeps the word %s as a word, wherever it is said", async (word) => {
    const { document } = await opened([
      title(word),
      heading(1, word),
      para(word),
      para({ text: word, bold: true }),
      para({ text: word, mono: true }),
      para({ text: word, href: "https://github.com/ICJIA/voicecap" }),
      para(`first\n${word}`),
      para(`before\t${word}`),
      list([word]),
      mono([word]),
      mono(["first", word]),
      table([word], [[word], [cell(word, word)], [monoCell(word)]]),
    ]);

    expect(paragraphsOf(document).map(({ text }) => text)).toEqual([
      word, // the title
      word, // the heading
      word, // a paragraph
      word, // a bold piece
      word, // a fixed-width piece
      word, // a link
      `first\n${word}`, // after a line break
      `before\t${word}`, // after a tab
      word, // a list item
      word, // a fixed-width line
      `first\n${word}`, // a fixed-width line after another
    ]);
    expect(tablesOf(document)).toEqual([
      { header: true, rows: [[word], [word], [`${word}\n${word}`], [word]] },
    ]);
    // The footer has fields of its own; the body has none.
    expect(document).not.toContain("<w:fldChar");
    expect(document).not.toContain("<w:instrText");
  });

  it("keeps the footer's own words as words, and makes only its two page numbers fields", async () => {
    for (const word of PAGE_NUMBER_WORDS) {
      const { footer } = await unzipDocx(
        await docxOf([para("x")], { ...PROPERTIES, footer: word }),
      );

      expect(footerSaid(footer), word).toEqual([`${word}. Page `, "PAGE", " of ", "NUMPAGES"]);
      expect(footer.match(/<w:fldChar w:fldCharType="begin"\/>/g), word).toHaveLength(2);
    }
  });

  it("describes the document as made with voicecap", async () => {
    const { core } = await opened(BLOCKS);
    expect(core).toContain("<dc:description>Made with voicecap</dc:description>");
  });

  it("has 1-inch margins", async () => {
    const { document } = await opened(BLOCKS);
    expect(document).toContain(
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"',
    );
  });

  it("sets the body in Calibri 11 pt, a table's text in 10 pt, and fixed-width text in Consolas 9 pt", async () => {
    const { styles, document } = await opened([
      ...BLOCKS,
      table(["Name", "Record"], [["a", monoCell("b", "c")]]),
    ]);
    const defaults = /<w:docDefaults>.*?<\/w:docDefaults>/s.exec(styles)?.[0] ?? "";
    expect(defaults).toContain('w:ascii="Calibri"');
    expect(defaults).toContain('<w:sz w:val="22"/>');
    expect(styleXml(styles, "TableText")).toContain('<w:sz w:val="20"/>');
    expect(styleXml(styles, "Mono")).toContain('w:ascii="Consolas"');
    expect(styleXml(styles, "Mono")).toContain('<w:sz w:val="18"/>');

    // Every paragraph of a table is in the table's style, or in the fixed-width one in a cell that
    // says so.
    for (const one of document.match(/<w:tbl>.*?<\/w:tbl>/gs) ?? []) {
      const paragraphs = one.match(/<w:p>/g) ?? [];
      const styled = one.match(/<w:pStyle w:val="(?:TableText|Mono)"\/>/g) ?? [];
      expect(paragraphs.length).toBeGreaterThan(0);
      expect(styled).toHaveLength(paragraphs.length);
    }
    expect(document.match(/<w:pStyle w:val="Mono"\/>/g)).toHaveLength(3);
  });

  it("sets the titles and headings in black, bold, and in order of size", async () => {
    const { styles } = await opened(BLOCKS);
    const sizes = ["Title", "Heading1", "Heading2", "Heading3", "Heading4"].map((id) => {
      const style = styleXml(styles, id);
      expect(style).toContain('<w:color w:val="000000"/>');
      expect(style).toContain("<w:b/>");
      return Number(/<w:sz w:val="(\d+)"\/>/.exec(style)?.[1]);
    });
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(new Set(sizes).size).toBe(5);
  });

  it("sets a level-4 heading in the Heading 4 style, kept with what follows it and an outline level of its own", async () => {
    const { document, styles } = await opened([
      heading(1, "Section"),
      heading(2, "Part"),
      heading(3, "Piece"),
      heading(4, "Detail"),
      para("Words."),
    ]);
    const style = styleXml(styles, "Heading4");

    expect(paragraphsOf(document)).toEqual([
      { style: "Heading1", text: "Section" },
      { style: "Heading2", text: "Part" },
      { style: "Heading3", text: "Piece" },
      { style: "Heading4", text: "Detail" },
      { style: "", text: "Words." },
    ]);
    // Heading 4 is as the others are: a style of Word's own that its navigation pane lists at the
    // fourth level, kept with the paragraph that follows.
    expect(style).toContain('<w:outlineLvl w:val="3"/>');
    expect(style).toContain("<w:keepNext/>");
    expect(style).toContain("<w:keepLines/>");
  });

  it("sets a piece in bold, in the fixed-width font, and linked, each as a run of its own", async () => {
    const { document } = await opened([
      ...BLOCKS,
      para({
        text: "all three",
        bold: true,
        mono: true,
        href: "https://github.com/ICJIA/voicecap",
      }),
    ]);
    const runOf = (words: string) =>
      runsIn(document).find((run) => run.includes(`>${words}</w:t>`));

    expect(runOf("Bold.")).toContain("<w:b/>");
    expect(runOf(" Then ")).not.toMatch(/<w:b\/>|Consolas|Hyperlink/);
    expect(runOf("code")).toMatch(/w:ascii="Consolas".*<w:sz w:val="18"\/>/s);
    expect(runOf("code")).not.toContain("<w:b/>");
    expect(runOf("a link")).toContain('<w:rStyle w:val="Hyperlink"/>');
    expect(runOf("all three")).toMatch(/<w:b\/>/);
    expect(runOf("all three")).toMatch(/Consolas/);
    expect(runOf("all three")).toMatch(/Hyperlink/);
  });

  it("sets a link in blue and underlined", async () => {
    const { styles } = await opened(BLOCKS);
    expect(styleXml(styles, "Hyperlink")).toContain('<w:color w:val="0563C1"/>');
    expect(styleXml(styles, "Hyperlink")).toContain('<w:u w:val="single"/>');
  });

  it("writes a newline in a line's words as a line break, and a tab as a tab", async () => {
    const { document } = await opened([para("first\r\nsecond\nthird\tfourth")]);
    expect(paragraphsOf(document)).toEqual([{ style: "", text: "first\nsecond\nthird\tfourth" }]);
    expect(document.match(/<w:br\/>/g)).toHaveLength(2);
    expect(document).toContain("<w:tab/>");
    // None inside the words of a run, where Word would show them as spaces.
    expect(document).not.toMatch(/<w:t[ >][^<]*[\n\r\t]/);
  });

  it("writes an entry of several lines in a problem's record as one fixed-width paragraph, a line break after each line, with its spaces", async () => {
    const lines = [
      "Error accepting connection",
      "Traceback (most recent call last):",
      '  File "ssl.pyc", line 1418, in accept',
      "",
      "ssl.SSLEOFError: EOF occurred",
    ];
    const model = keptLogsModel([problemEntry("ERROR", "14:04:20.123", ...lines)]);
    const { document } = await opened(wordProblems(model));

    // The record's cell holds every line of it, the blank one too.
    const record = tablesOf(document).find(
      (each) => each.rows[0]?.[1] === "From" && each.rows[1]?.[2] === "Attempt 1 started",
    );
    const [, , entry] = record?.rows.find((cells) => cells[1] === "nvda-log") ?? [];
    expect(entry).toBe(lines.join("\n"));
    // One paragraph in the fixed-width style, a line break after each line but the last.
    const paragraph =
      /<w:p>(?:(?!<\/w:p>).)*Error accepting connection(?:(?!<\/w:p>).)*<\/w:p>/s.exec(
        document,
      )?.[0] ?? "";
    expect(paragraph).toContain('<w:pStyle w:val="Mono"/>');
    expect(paragraph.match(/<w:br\/>/g)).toHaveLength(lines.length - 1);
    // The indentation is kept: Word drops the spaces that begin a run's words unless told to keep them.
    expect(paragraph).toContain('<w:t xml:space="preserve">  File &quot;ssl.pyc&quot;, line 1418');
  });

  it("keeps a long transcript to one paragraph", async () => {
    const lines = Array.from({ length: 3000 }, (_, index) => `line ${index + 1}`);
    const paragraphs = paragraphsOf((await opened([mono(lines)])).document);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.text).toBe(lines.join("\n"));
  });

  it("keeps an empty line in fixed-width text, and writes nothing for no lines or items", async () => {
    const { document } = await opened([mono(["a", "", "b"]), mono([]), list([]), para("end")]);
    expect(paragraphsOf(document)).toEqual([
      { style: "Mono", text: "a\n\nb" },
      { style: "", text: "end" },
    ]);
  });

  it("breaks the page with a paragraph of its own", async () => {
    const { document } = await opened([para("before"), PAGE_BREAK, para("after")]);
    expect(document.match(/<w:br w:type="page"\/>/g)).toHaveLength(1);
    expect(paragraphsOf(document)).toEqual([
      { style: "", text: "before" },
      { style: "", text: "" },
      { style: "", text: "after" },
    ]);
  });

  it("puts a small paragraph between two tables that would touch, since Word joins them into one, and between nothing else", async () => {
    const { document } = await opened([
      table(["A"], [["a"]]),
      table(["B"], [["b"]]),
      table(["C"], [["c"]]),
      para("after"),
      table(["D"], [["d"]]),
      list(["item"]),
      table(["E"], [["e"]]),
    ]);

    // One paragraph between each two tables that would touch, and none after a paragraph or a list,
    // nor after the last table.
    expect(bodyTags(document)).toEqual([
      ...["w:tbl", "w:p", "w:tbl", "w:p", "w:tbl", "w:p", "w:tbl", "w:p", "w:tbl"],
      "w:sectPr",
    ]);
    // The two between tables hold nothing; the others are the blocks' own.
    expect(paragraphsOf(document)).toEqual([
      { style: "", text: "" },
      { style: "", text: "" },
      { style: "", text: "after" },
      { style: "ListParagraph", text: "item" },
    ]);
    expect(tablesOf(document).map(({ rows }) => rows[0]?.[0])).toEqual(["A", "B", "C", "D", "E"]);
    // Small: a line of exactly 6 pt or less, with no space around it, so two tables are apart and
    // no more.
    const spacers = (document.match(/<w:p>.*?<\/w:p>/gs) ?? []).filter((paragraph) =>
      paragraph.includes('w:lineRule="exact"'),
    );
    expect(spacers).toHaveLength(2);
    for (const spacer of spacers) {
      const spacing = /<w:spacing ([^>]*)\/>/.exec(spacer)?.[1] ?? "";
      expect(spacing).toContain('w:before="0"');
      expect(spacing).toContain('w:after="0"');
      expect(Number(/w:line="(\d+)"/.exec(spacing)?.[1])).toBeLessThanOrEqual(120);
    }
  });

  it("keeps two tables apart, and a label with its list, across a block that writes nothing", async () => {
    const { document } = await opened([
      table(["A"], [["a"]]),
      mono([]),
      list([]),
      table(["B"], [["b"]]),
      para("Heard first"),
      mono([]),
      list(["one"]),
    ]);

    // Fixed-width text with no lines and a list with no items write nothing, so they are not what
    // stands between the two tables, nor between the label and its list.
    expect(bodyTags(document)).toEqual(["w:tbl", "w:p", "w:tbl", "w:p", "w:p", "w:sectPr"]);
    expect(keptWithNext(document)).toEqual(["Heard first"]);
  });

  it("keeps the paragraph before a list with it, so a label is never left at the foot of a page with its list on the next", async () => {
    const { document } = await opened([
      para("Heard first"),
      list(["one", "two"]),
      para("after"),
      para("more"),
      list(["three"]),
    ]);

    // A paragraph that leads into a list: the one before the list, and no other paragraph.
    expect(keptWithNext(document)).toEqual(["Heard first", "more"]);
  });

  it("writes a list as bulleted paragraphs, one for each item", async () => {
    const link = { text: "a link", href: "https://github.com/ICJIA/voicecap" };
    const { document } = await opened([list(["one", ["two, ", link]])]);
    expect(paragraphsOf(document)).toEqual([
      { style: "ListParagraph", text: "one" },
      { style: "ListParagraph", text: "two, a link" },
    ]);
    expect(document.match(/<w:numPr>/g)).toHaveLength(2);
  });

  it("sets a header row in bold on light gray, and no other row", async () => {
    const { document } = await opened([table(["Rule", "NVDA said"], [["a", "b"]])]);
    const [header = "", row = ""] = document.match(/<w:tr>.*?<\/w:tr>/gs) ?? [];

    expect(header).toContain("<w:tblHeader/>");
    expect(header.match(/w:fill="D9D9D9"/g)).toHaveLength(2);
    expect(header.match(/<w:b\/>/g)).toHaveLength(2);
    expect(row).not.toMatch(/w:fill=|<w:b\/>|tblHeader/);
    // The header row is marked as the table's first row too.
    expect(document).toMatch(/<w:tblLook [^>]*w:firstRow="(?:true|1)"/);
    // No row breaks across two pages.
    expect(header).toContain("<w:cantSplit/>");
    expect(row).toContain("<w:cantSplit/>");
  });

  it("gives a table fixed columns, as wide as it was asked for, and as wide as the text", async () => {
    const { document } = await opened([
      table(["A", "B"], [["x", "y"]], [30, 70]),
      table(["A", "B", "C"], [["x", "y", "z"]]),
      table(["A", "B", "C", "D", "E", "F", "G"], [["1", "2", "3", "4", "5", "6", "7"]]),
    ]);
    const grids = [...document.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/gs)].map(([, grid = ""]) =>
      [...grid.matchAll(/w:w="(\d+)"/g)].map(([, width = ""]) => Number(width)),
    );

    expect(grids.slice(0, 2)).toEqual([
      [2808, 6552],
      [3120, 3120, 3120],
    ]);
    // Seven equal columns can't divide the text width, so the last takes what's left.
    expect(grids[2]).toHaveLength(7);
    expect(Math.max(...(grids[2] ?? [])) - Math.min(...(grids[2] ?? []))).toBeLessThanOrEqual(6);
    for (const grid of grids) expect(grid.reduce((sum, width) => sum + width, 0)).toBe(9360);
    expect(document.match(/<w:tblLayout w:type="fixed"\/>/g)).toHaveLength(3);
    expect(document.match(/<w:tblW w:type="dxa" w:w="9360"\/>/g)).toHaveLength(3);
    // Each cell has the width of its column, as Word and the others each read them.
    expect(document.match(/<w:tcW w:type="dxa" w:w="2808"\/>/g)).toHaveLength(2);
  });

  it("gives an empty cell a paragraph, as Word needs", async () => {
    const { document } = await opened([table(["A", "B"], [[cell(), monoCell()]])]);
    const cells = document.match(/<w:tc>.*?<\/w:tc>/gs) ?? [];

    expect(cells).toHaveLength(4);
    for (const one of cells) expect(one).toContain("<w:p>");
    expect(tablesOf(document)[0]?.rows[1]).toEqual(["", ""]);
  });

  it("sets a fixed-width cell's lines in the Mono style, a paragraph for each", async () => {
    const { document } = await opened([table(["Name", "Record"], [["a", monoCell("b", "c")]])]);
    expect(tablesOf(document)[0]?.rows[1]).toEqual(["a", "b\nc"]);
    expect(document.match(/<w:pStyle w:val="Mono"\/>/g)).toHaveLength(2);
  });

  it("links each address once, in order, however it's written", async () => {
    const one = "https://github.com/ICJIA/voicecap";
    const two = `https://a.gov/?q=1&r='2'&s="3"<`;
    const parts = await opened([
      para({ text: "a", href: one }),
      list([
        [
          { text: "b", href: two },
          { text: "c", href: one },
        ],
      ]),
      table(["H"], [[[{ text: "d", href: two }]]]),
      para({ text: "not a link" }),
    ]);

    expect(linksOf(parts)).toEqual([one, two]);
    expect(XMLValidator.validate(parts.rels)).toBe(true);
  });

  it("centers the footer in 9 pt: its words, then the page number out of the pages", async () => {
    const { footer } = await opened(BLOCKS);

    expect(footerSaid(footer)).toEqual([
      "Demo, as of 30 September 2026. Page ",
      "PAGE",
      " of ",
      "NUMPAGES",
    ]);
    expect(footer).toContain('<w:jc w:val="center"/>');
    expect(footer.match(/<w:sz w:val="18"\/>/g)).toHaveLength(4);
  });

  it("loads docx when a document is made, and not before", async () => {
    vi.resetModules();
    const loaded: string[] = [];
    vi.doMock("docx", async (importOriginal) => {
      loaded.push("docx");
      return importOriginal();
    });
    try {
      const fresh = await import("../src/share/docx.js");
      expect(loaded).toEqual([]);
      await fresh.docxOf([para("x")], PROPERTIES);
      expect(loaded).toEqual(["docx"]);
    } finally {
      vi.doUnmock("docx");
      vi.resetModules();
    }
  });
});

describe("a picture in the Word copy", () => {
  const ALT = 'The page "/" as it loaded, before NVDA read it';
  const PICTURE: Picture = { jpeg: TINY_JPEG, width: 16, height: 12, alt: ALT };

  /** Bytes that differ from TINY_JPEG's and from each other's: a comment added to the picture. */
  function commented(text: string): Uint8Array {
    const note = new TextEncoder().encode(text);
    const length = note.length + 2;
    return Uint8Array.from([
      ...TINY_JPEG.subarray(0, 2),
      ...[0xff, 0xfe, length >> 8, length & 0xff],
      ...note,
      ...TINY_JPEG.subarray(2),
    ]);
  }

  it("is made of its bytes, its size, and its alt text, which are the words it adds", () => {
    expect(image(PICTURE)).toEqual({ kind: "image", ...PICTURE });
    expect(wordsOf([para("before"), image(PICTURE), para("after")])).toEqual([
      "before",
      ALT,
      "after",
    ]);
  });

  it("is one drawing 400 pixels wide, its height in proportion, with its alt text as the words a screen reader says, and its file's exact bytes", async () => {
    const parts = await opened([para("before"), image(PICTURE), para("after")]);
    const drawings = drawingsOf(parts);

    expect(XMLValidator.validate(parts.document)).toBe(true);
    expect(parts.document.match(/<w:drawing>/g)).toHaveLength(1);
    // Word's alt text is the description; the name and the title say the same, so no reader of the
    // file gets less.
    expect(drawings).toEqual([
      {
        descr: ALT,
        name: ALT,
        title: ALT,
        id: expect.any(String) as unknown,
        width: 400,
        height: 300,
        file: expect.stringMatching(/\.jpe?g$/) as unknown,
      },
    ]);
    expect(parts.media.size).toBe(1);
    expect(
      Buffer.compare(parts.media.get(drawings[0]?.file ?? "") ?? new Uint8Array(), TINY_JPEG),
    ).toBe(0);
    // It stands between the paragraphs around it, in a paragraph of its own.
    expect(paragraphsOf(parts.document).map(({ text }) => text)).toEqual(["before", "", "after"]);
  });

  it("keeps the paragraph before a picture with it, and no other paragraph with what follows", async () => {
    const { document } = await opened([
      para("Screenshot:"),
      image(PICTURE),
      para("after"),
      para("more"),
    ]);
    const paragraphs = document.match(/<w:p>.*?<\/w:p>/gs) ?? [];

    // A label is never left at the foot of a page with its picture on the next.
    expect(paragraphs.map((paragraph) => paragraph.includes("<w:keepNext/>"))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it("keeps the proportions of the size it's recorded at, a little less than half the window's", async () => {
    const parts = await opened([
      image({ ...PICTURE, width: 632, height: 419 }),
      image({ ...PICTURE, width: 640, height: 480 }),
      image({ ...PICTURE, width: 200, height: 400 }),
    ]);

    expect(drawingsOf(parts).map(({ width, height }) => [width, height])).toEqual([
      [400, 265],
      [400, 300],
      [400, 800],
    ]);
  });

  it("gives each picture its own id, its own words, and its own file's bytes", async () => {
    const bytes = [commented("one"), commented("two"), TINY_JPEG];
    const alts = ["First page", "Second page", "Third page"];
    const parts = await opened(
      bytes.map((jpeg, index) => image({ ...PICTURE, jpeg, alt: alts[index] ?? "" })),
    );
    const drawings = drawingsOf(parts);

    expect(drawings.map(({ descr }) => descr)).toEqual(alts);
    expect(new Set(drawings.map(({ id }) => id)).size).toBe(3);
    expect(drawings.map(({ file }) => file)).toEqual([
      ...new Set(drawings.map(({ file }) => file)),
    ]);
    for (const [index, drawing] of drawings.entries()) {
      const file = parts.media.get(drawing.file) ?? new Uint8Array();
      expect(Buffer.compare(file, bytes[index] ?? new Uint8Array()), alts[index]).toBe(0);
    }
  });

  it("shows two pictures of the same bytes, each with its own words", async () => {
    const parts = await opened([
      image({ ...PICTURE, alt: "Home" }),
      image({ ...PICTURE, alt: "Another page" }),
    ]);
    const drawings = drawingsOf(parts);

    expect(drawings.map(({ descr }) => descr)).toEqual(["Home", "Another page"]);
    expect(new Set(drawings.map(({ id }) => id)).size).toBe(2);
    for (const drawing of drawings) {
      expect(Buffer.compare(parts.media.get(drawing.file) ?? new Uint8Array(), TINY_JPEG)).toBe(0);
    }
  });

  it("says its alt text as it is: markup and quotes stay words, and a character XML forbids shows as U+FFFD", async () => {
    const odd = `A <b>"page"</b> & more\u0000, 'quoted'\u{FFFE}`;
    const parts = await opened([image({ ...PICTURE, alt: odd })]);
    const [drawing] = drawingsOf(parts);
    const cleaned = `A <b>"page"</b> & more\u{FFFD}, 'quoted'\u{FFFD}`;

    expect(XMLValidator.validate(parts.document)).toBe(true);
    expect(FORBIDDEN.test(parts.document)).toBe(false);
    expect([drawing?.descr, drawing?.name, drawing?.title]).toEqual([cleaned, cleaned, cleaned]);
  });
});

describe("the Word copy of a site whose pages took screenshots", () => {
  /** TINY_JPEG with a comment added: the same 16 x 12 picture, in other bytes, one for each page. */
  function commented(text: string): Uint8Array {
    const note = new TextEncoder().encode(text);
    const length = note.length + 2;
    return Uint8Array.from([
      ...TINY_JPEG.subarray(0, 2),
      ...[0xff, 0xfe, length >> 8, length & 0xff],
      ...note,
      ...TINY_JPEG.subarray(2),
    ]);
  }

  /**
   * Five pages of a run of voicecap 0.11.0: Home and About were read in full (each has its
   * transcripts), Never failed after its picture was taken (it has no transcripts), Skipped took no
   * picture since it wasn't read, and Error's picture couldn't be taken.
   */
  function siteOf(): { run: RunJson; pictures: Map<string, Uint8Array> } {
    const read = { files: TRANSCRIPTS, passes: LINES };
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.11.0",
      pages: [
        { path: "/", label: "Home", ...read, screenshot: TINY_RECORD },
        { path: "/about/", ...read, screenshot: { ...TINY_RECORD, width: 632, height: 419 } },
        {
          path: "/never/",
          status: "failed",
          failedAttempts: [failedAttempt({ n: 1 })],
          screenshot: TINY_RECORD,
        },
        { path: "/skipped/", status: "skipped" },
        {
          path: "/error/",
          ...read,
          screenshot: { error: "timed out after 5s", takenAt: TINY_RECORD.takenAt },
        },
      ],
    });
    const pictures = new Map<string, Uint8Array>(
      ["home", "about", "never"].flatMap((name) => {
        const page = run.pages.find((each) => each.url.includes(name === "home" ? "/" : name));
        return page === undefined ? [] : [[`r1/${page.slug}`, commented(name)]];
      }),
    );
    return { run, pictures };
  }

  it("has one drawing for each page with a picture, with the page's alt text for a description, and each picture's exact bytes in word/media", async () => {
    const { run, pictures } = siteOf();
    const model = buildShareModel(
      inputOf([run], { transcripts: storeOf(), screenshots: pictures }),
    );
    const parts = await unzipDocx(await renderWordCopy(model));
    const drawings = drawingsOf(parts);
    const alt = (name: string) => `The page ${name} as it loaded, before NVDA read it`;
    const [home, about, never] = run.pages.map((page) => pictures.get(`r1/${page.slug}`));

    expect(XMLValidator.validate(parts.document)).toBe(true);
    // Each page has its picture in its own blocks, in the pages' order, whether it was read or not.
    expect(drawings.map(({ descr }) => descr)).toEqual([
      alt("Home"),
      alt(`${SITE}about/`),
      alt(`${SITE}never/`),
    ]);
    // 400 pixels wide, with the height its record gives.
    expect(drawings.map(({ width, height }) => [width, height])).toEqual([
      [400, 300],
      [400, 265],
      [400, 300],
    ]);
    expect(new Set(drawings.map(({ id }) => id)).size).toBe(3);
    expect(parts.media.size).toBe(3);
    for (const [index, bytes] of [home, about, never].entries()) {
      const file = parts.media.get(drawings[index]?.file ?? "") ?? new Uint8Array();
      expect(Buffer.compare(file, bytes ?? new Uint8Array()), alt(String(index))).toBe(0);
    }
  });

  it("says why a page has no picture, in the words the page says it in, and puts its label where the picture would be", async () => {
    const { run, pictures } = siteOf();
    const model = buildShareModel(
      inputOf([run], { transcripts: storeOf(), screenshots: pictures }),
    );
    const { document } = await unzipDocx(await renderWordCopy(model));
    const said = paragraphsOf(document).map(({ text }) => text);

    // A page says it in its own blocks, whether it was read or not.
    expect(said).toContain(
      "Screenshot: Not recorded: the screenshot couldn't be taken (timed out after 5s).",
    );
    expect(said).toContain(
      "Screenshot: Not recorded: no screenshot was taken, since the page wasn't read.",
    );
    // The pages with a picture have the label alone, and the picture after it.
    expect(said.filter((text) => text === "Screenshot:")).toHaveLength(3);
  });
});
