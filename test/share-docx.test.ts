/**
 * The Word copy's blocks, and the .docx they make: what the file's XML says of the page, its styles,
 * its tables, its links, its properties, and its footer, read back out of the zip. Two builds of one
 * document differ in bytes, so nothing here compares bytes.
 */
import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it, vi } from "vitest";

import { docxOf } from "../src/share/docx.js";
import {
  PAGE_BREAK,
  cell,
  heading,
  list,
  mono,
  monoCell,
  para,
  table,
  title,
  wordsOf,
  type Block,
} from "../src/share/word/blocks.js";
import { linksOf, paragraphsOf, tablesOf, unzipDocx } from "./helpers/docx.js";

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

describe("the Word copy's blocks", () => {
  it("makes each kind of block as plain data", () => {
    expect(title("Demo")).toEqual({ kind: "title", text: "Demo" });
    expect(heading(2, "Next")).toEqual({ kind: "heading", level: 2, text: "Next" });
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

  it("has no image, so none lacks alt text", async () => {
    expect((await unzipDocx(await docxOf(BLOCKS, PROPERTIES))).document).not.toContain(
      "<w:drawing",
    );
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
    const sizes = ["Title", "Heading1", "Heading2", "Heading3"].map((id) => {
      const style = styleXml(styles, id);
      expect(style).toContain('<w:color w:val="000000"/>');
      expect(style).toContain("<w:b/>");
      return Number(/<w:sz w:val="(\d+)"\/>/.exec(style)?.[1]);
    });
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(new Set(sizes).size).toBe(4);
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
    const said = [...footer.matchAll(/<w:(?:t|instrText)[^>]*>(.*?)<\/w:(?:t|instrText)>/g)].map(
      ([, words]) => words,
    );

    expect(said).toEqual(["Demo, as of 30 September 2026. Page ", "PAGE", " of ", "NUMPAGES"]);
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
