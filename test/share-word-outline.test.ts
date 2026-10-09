/**
 * The Word copy as one document: its sections in the page's order, its words, and the .docx they make,
 * opened and read back. The demo runs of 29 September 2026 (voicecap 0.4.1, in test/fixtures/share/)
 * are the real case; runs built in memory cover a site where no run counts, a named preparer, and a
 * site whose name holds characters XML escapes. The sections are tested on their own, in the files
 * of each builder; this file tests what only the whole has: the order, the document's properties, and
 * that the file opens.
 */
import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";

import { attentionWords } from "../src/share/attention-words.js";
import { renderWordCopy } from "../src/share/docx.js";
import { renderSharePage } from "../src/share/html/document.js";
import { lineOfMarkup, lineText } from "../src/share/line.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import {
  ABOUT,
  AXE_TEXT,
  HOW_LEAD,
  HOW_STEPS,
  STORY,
  TIMELINE,
  TOP_TEXT,
  WHEN_TO_RUN,
  WORD_TEXT,
  WORTH_KNOWING,
} from "../src/share/text.js";
import { documentTitle } from "../src/share/words.js";
import { wordsOf, type Block } from "../src/share/word/blocks.js";
import { wordFooter, wordStory } from "../src/share/word/evidence.js";
import { wordOutline, wordProperties } from "../src/share/word/outline.js";
import {
  bodyTags,
  footerWords,
  keptWithNext,
  linksOf,
  paragraphsOf,
  propertyOf,
  tablesOf,
  unzipDocx,
} from "./helpers/docx.js";
import { SITE } from "./helpers/report-data.js";
import { shareRun } from "./helpers/share-data.js";
import { decode, textOf } from "./helpers/share-html.js";
import { demoModel, inputOf } from "./helpers/share-model.js";
import { hrefsOf, outlineOf, tablesIn } from "./helpers/word.js";

/** A site whose only run was a replay, so no run counts. */
function noRunModel(): ShareModel {
  return buildShareModel(inputOf([shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] })]));
}

/** One run of one page, which Pat Lee ran, under `name` when one is given, else the site's own. */
function patsModel(name: string | null = null): ShareModel {
  const run = shareRun({ id: "r1", sessions: [{ reviewer: "Pat Lee" }], pages: [{ path: "/" }] });
  const model = buildShareModel(inputOf([run]));
  return name === null ? model : { ...model, header: { ...model.header, name } };
}

/** The level 1 headings among the blocks, as their words, in order. */
function sectionsOf(blocks: Block[]): string[] {
  return blocks.flatMap((block) =>
    block.kind === "heading" && block.level === 1 ? [block.text] : [],
  );
}

/** The headings of the page's sections: its `h2`s, as the words a reader gets of them. */
function pageSections(page: string): string[] {
  return [...page.matchAll(/<h2 id="[^"]+">(.*?)<\/h2>/g)].map(([, words]) => textOf(words ?? ""));
}

/** One run of one page that NVDA read and that raised no flag, so no problem needs attention. */
function cleanModel(): ShareModel {
  const run = shareRun({ id: "r1", pages: [{ path: "/", passes: { read: ["Welcome"] } }] });
  return buildShareModel(inputOf([run]));
}

describe("wordOutline", () => {
  // The page's footer is a landmark with no heading, which a screen reader announces. In Word, a
  // footer with no heading would belong to the last heading before it, in the navigation pane and
  // for a screen reader alike, and only a change of font would mark where it begins. So the Word
  // copy has the page's sections as its level-1 headings, in the page's order, and one more for the
  // footer: the details' parts are headings 2 under The details, as the page's are headings 3.
  it("has the page's order: At a glance, What needs attention, every page, The details, and then a heading of its own for the footer", async () => {
    const model = await demoModel();
    const blocks = wordOutline(model);
    const sections = sectionsOf(blocks);
    const page = renderSharePage(model, { fontCss: "" });

    expect(sections).toEqual([
      "At a glance",
      "What needs attention",
      "Every page",
      "The details, for reviewers and auditors",
      "About this report",
    ]);
    // Exactly the page's sections, in its order, and then the footer's heading, which it has none of.
    expect(pageSections(page)).toEqual(sections.slice(0, -1));
    expect(sections.at(-1)).toBe("About this report");
    // There is no appendix (each page's transcripts are under it), and no Summary.
    expect(sections).not.toContain("Appendix: every transcript");
    expect(sections).not.toContain("Summary");
    expect(outlineOf(blocks)).toContain("2 How voicecap works");
    // The flags found are cards under what needs attention, which follows At a glance.
    expect(sections).not.toContain("What the flags found");
  });

  it("has the page's sections for a site where no run counts, or no card is left, too: no section on what needs attention", () => {
    for (const model of [noRunModel(), cleanModel()]) {
      const sections = sectionsOf(wordOutline(model));

      expect(model.attention).toEqual([]);
      expect(sections).toEqual([
        "At a glance",
        "Every page",
        "The details, for reviewers and auditors",
        "About this report",
      ]);
      expect(pageSections(renderSharePage(model, { fontCss: "" }))).toEqual(sections.slice(0, -1));
    }
  });

  it("puts what needs attention after At a glance and before every page, with a heading 2 for each card", async () => {
    const model = await demoModel();
    const headings = outlineOf(wordOutline(model));
    const at = (heading: string) => headings.indexOf(heading);
    const cards = headings.slice(at("1 What needs attention") + 1, at("1 Every page"));

    expect(at("1 At a glance")).toBeLessThan(at("1 What needs attention"));
    // The summary's own panel of the same name is gone: the section is the only heading of its name.
    expect(headings.filter((each) => each.endsWith(" What needs attention"))).toEqual([
      "1 What needs attention",
    ]);
    // A heading 2 for each card, numbered, in the cards' order, and nothing else under the section.
    expect(cards).toEqual(
      model.attention.map((card, index) => `2 ${index + 1}. ${attentionWords(card).title}`),
    );
    expect(cards).toHaveLength(5);
    expect(headings).not.toContain("1 What the flags found");
  });

  it("puts each page's transcripts under it, in Every page, and the details after the last page", async () => {
    const model = await demoModel();
    const headings = outlineOf(wordOutline(model));
    const pages = headings.slice(
      headings.indexOf("1 Every page"),
      headings.indexOf("1 The details, for reviewers and auditors"),
    );

    // Seven pages with three transcripts each, none in a section of their own after the pages.
    expect(pages.filter((each) => each.startsWith("2 "))).toHaveLength(7);
    expect(pages.filter((each) => each.startsWith("3 "))).toHaveLength(21);
    expect(pages.slice(0, 5)).toEqual([
      "1 Every page",
      "2 1 /",
      "3 Read transcript of /, 18 lines",
      "3 Headings transcript of /, 3 lines",
      "3 Tab transcript of /, 9 lines",
    ]);
    expect(headings.at(-1)).toBe("1 About this report");
    expect(headings.at(-2)).not.toMatch(/transcript/i);
  });

  it("starts with what it is, as the one title, and ends with the footer, heading and all", async () => {
    const model = await demoModel();
    const blocks = wordOutline(model);

    expect(blocks[0]).toEqual({ kind: "title", text: TOP_TEXT.eyebrow });
    expect(blocks.filter((block) => block.kind === "title")).toHaveLength(1);
    expect(blocks.slice(-4)).toEqual(wordFooter(model));
    expect(blocks.slice(-4).map(({ kind }) => kind)).toEqual(["heading", "para", "para", "para"]);
  });

  it("puts the footer under a heading of its own, never under the story's last heading, with no page break before it", async () => {
    for (const model of [await demoModel(), noRunModel()]) {
      const blocks = wordOutline(model);
      const at = blocks.findLastIndex((block) => block.kind === "heading");

      // The outline's last heading is the footer's, at level 1, so its paragraphs are under it and
      // no longer under the heading 3 of the last thing worth knowing.
      expect(blocks[at]).toEqual({ kind: "heading", level: 1, text: "About this report" });
      expect(blocks.slice(at)).toEqual(wordFooter(model));
      expect(blocks[at - 1]?.kind).not.toBe("pageBreak");
    }
  });

  it("says every word of the fixed text", async () => {
    const model = await demoModel();
    const text = wordsOf(wordOutline(model)).join("\n");
    const fixed = [
      HOW_LEAD,
      AXE_TEXT.how,
      ...HOW_STEPS.flatMap((step) => [step.title, step.text]),
      WHEN_TO_RUN.headline,
      WHEN_TO_RUN.text,
      ...WHEN_TO_RUN.stages.flatMap((stage) => [stage.title, stage.text]),
      STORY.began,
      STORY.why,
      STORY.usual,
      STORY.answer,
      ...WORTH_KNOWING.flatMap((card) => [card.title, card.text]),
      ABOUT,
      ...TIMELINE.flatMap((row) => [row.pc, row.mac, row.both]).flatMap((cell) =>
        cell === null ? [] : [lineText(lineOfMarkup(cell))],
      ),
    ];

    expect(fixed.length).toBeGreaterThan(40);
    for (const words of fixed) expect(text).toContain(words);
  });

  it("never names a library as how voicecap began", async () => {
    const model = await demoModel();

    expect(wordsOf(wordStory(model)).join("\n")).not.toMatch(/guidepup/i);
  });

  it("sets its headings in order, an h1 first, and never a level skipped or deeper than 4, for each site", async () => {
    for (const model of [await demoModel(), noRunModel(), patsModel(), cleanModel()]) {
      const blocks = wordOutline(model);
      const levels = blocks.flatMap((block) => (block.kind === "heading" ? [block.level] : []));

      expect(levels[0]).toBe(1);
      expect(Math.max(...levels)).toBeLessThanOrEqual(4);
      for (const [index, level] of levels.entries()) {
        if (index > 0) expect(level - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("has a heading 4 under The evidence behind these results, a part of the details", async () => {
    const outline = outlineOf(wordOutline(await demoModel()));
    const evidence = outline.indexOf("2 The evidence behind these results");
    const next = outline.findIndex((each, at) => at > evidence && each.startsWith("2 "));
    const inside = outline.slice(evidence, next);

    expect(evidence).toBeGreaterThan(outline.indexOf("1 The details, for reviewers and auditors"));
    // The run is a heading 3 under the part, and each of its parts a heading 4: five for each of
    // two runs.
    expect(inside.slice(0, 3)).toEqual([
      "2 The evidence behind these results",
      "3 Run 2026-09-29_1402",
      "4 Minute by minute in run 2026-09-29_1402",
    ]);
    expect(inside.filter((each) => each.startsWith("4 "))).toHaveLength(10);
  });

  it("gives no table a heading with no words, and a cell for each heading in every row", async () => {
    for (const model of [await demoModel(), noRunModel(), patsModel()]) {
      for (const { head, rows } of tablesIn(wordOutline(model))) {
        expect(head.every((words) => words.trim() !== "")).toBe(true);
        for (const row of rows) expect(row).toHaveLength(head.length);
      }
    }
  });

  it("links to the four addresses the page links to outside itself, and nothing else", async () => {
    expect(new Set(hrefsOf(wordOutline(await demoModel())))).toEqual(
      new Set([
        "https://github.com/ICJIA/voicecap",
        "https://github.com/ICJIA/voicecap/issues",
        "https://www.nvaccess.org/",
        STORY.deque.url,
      ]),
    );
  });
});

describe("wordProperties", () => {
  it("titles the document as the page's tab is titled, from the one sentence both say", async () => {
    const model = await demoModel();
    const page = renderSharePage(model, { fontCss: "" });
    const tab = /<title>(.*?)<\/title>/s.exec(page)?.[1] ?? "";

    expect(wordProperties(model).title).toBe("127.0.0.1:4848: how its pages read aloud with NVDA");
    expect(wordProperties(model).title).toBe(documentTitle(model.header));
    expect(decode(tab)).toBe(wordProperties(model).title);
  });

  it("names the preparer as its author, and voicecap when the records name no one", async () => {
    expect(wordProperties(await demoModel()).author).toBe("voicecap");
    expect(wordProperties(patsModel()).author).toBe("Pat Lee");
    expect(WORD_TEXT.document.author).toBe("voicecap");
  });

  it("starts each page's footer with the site's name and the date the report is as of", async () => {
    expect(wordProperties(await demoModel()).footer).toBe(
      "127.0.0.1:4848, as of 30 September 2026",
    );
    expect(wordProperties(patsModel("Grants Portal")).footer).toBe(
      "Grants Portal, as of 30 September 2026",
    );
  });
});

describe("renderWordCopy", () => {
  it("opens as a Word document with the right headings, properties, and links", async () => {
    const model = await demoModel();
    const parts = await unzipDocx(await renderWordCopy(model));

    expect(XMLValidator.validate(parts.document)).toBe(true);
    // The title, the site's name, and when it was tested and the copy made, first: no address.
    expect(paragraphsOf(parts.document).slice(0, 3)).toEqual([
      { style: "Title", text: "Screen reader test results" },
      { style: "", text: "127.0.0.1:4848" },
      {
        style: "",
        text: "Tested 29 September 2026, 14:02. This copy was made 30 September 2026.",
      },
    ]);
    expect(propertyOf(parts.core, "dc:title")).toBe(
      `${model.header.name}: how its pages read aloud with NVDA`,
    );
    expect(tablesOf(parts.document).length).toBeGreaterThan(10);
    expect(
      tablesOf(parts.document).every(
        ({ header, rows }) => header && (rows[0] ?? []).every((words) => words !== ""),
      ),
    ).toBe(true);
    expect(new Set(linksOf(parts))).toEqual(
      new Set([
        "https://github.com/ICJIA/voicecap",
        "https://github.com/ICJIA/voicecap/issues",
        "https://www.nvaccess.org/",
        STORY.deque.url,
      ]),
    );
  });

  it("has a heading 1 in the file for each section of the outline, in its order: the page's four, then the footer's", async () => {
    const model = await demoModel();
    const { document } = await unzipDocx(await renderWordCopy(model));
    const sections = paragraphsOf(document).flatMap(({ style, text }) =>
      style === "Heading1" ? [text] : [],
    );

    expect(sections).toEqual(sectionsOf(wordOutline(model)));
    expect(sections).toEqual([
      "At a glance",
      "What needs attention",
      "Every page",
      "The details, for reviewers and auditors",
      "About this report",
    ]);
  });

  // Word joins two tables with nothing between them into one: the second's header row lands in the
  // middle of the first, a screen reader takes it for no header, and the two sets of columns clash.
  it("leaves no two tables touching in the file, for each site", async () => {
    for (const model of [await demoModel(), noRunModel(), patsModel(), cleanModel()]) {
      const blocks = wordOutline(model);
      const { document } = await unzipDocx(await renderWordCopy(model));
      const tags = bodyTags(document);
      // The paragraph that keeps two tables apart has a line of an exact height, which no other
      // paragraph of the file has.
      const spacers = (document.match(/<w:p>.*?<\/w:p>/gs) ?? []).filter((paragraph) =>
        paragraph.includes('w:lineRule="exact"'),
      );
      const touching = blocks.filter(
        (block, at) => block.kind === "table" && blocks[at + 1]?.kind === "table",
      );

      expect(tags.filter((tag) => tag === "w:tbl").length).toBeGreaterThan(0);
      for (const [at, tag] of tags.entries()) {
        if (tag === "w:tbl") expect(tags[at + 1]).not.toBe("w:tbl");
      }
      // One for each two tables the outline sets one after the other.
      expect(spacers).toHaveLength(touching.length);
    }
  });

  it("sets a paragraph between the ring's table and the numbers' table, which the outline has one after the other", async () => {
    const model = await demoModel();
    const blocks = wordOutline(model);
    const ring = blocks.findIndex((block) => block.kind === "table" && block.head[0] === "Part");
    const { document } = await unzipDocx(await renderWordCopy(model));
    const tags = bodyTags(document);
    const tables = tablesOf(document);
    const first = tables.findIndex(({ rows }) => rows[0]?.[0] === "Part");
    const at = tags.flatMap((tag, index) => (tag === "w:tbl" ? [index] : []))[first] ?? -1;

    expect(blocks[ring + 1]).toMatchObject({ kind: "table", head: ["Number", "What it counts"] });
    expect(tables[first + 1]?.rows[0]).toEqual(["Number", "What it counts"]);
    expect(tags.slice(at, at + 3)).toEqual(["w:tbl", "w:p", "w:tbl"]);
  });

  it("keeps each page's Heard first label with its list in the file, so it is never left at the foot of a page", async () => {
    const { document } = await unzipDocx(await renderWordCopy(await demoModel()));
    const labels = paragraphsOf(document).filter(({ text }) => text === "Heard first");

    // Seven pages, each with the label; every one keeps with the list after it.
    expect(labels).toHaveLength(7);
    expect(keptWithNext(document).filter((text) => text === "Heard first")).toHaveLength(7);
  });

  it("has a heading 4 in the file under the evidence, in the Heading 4 style, and a transcript's heading 3 under its page's heading 2", async () => {
    const { document } = await unzipDocx(await renderWordCopy(await demoModel()));
    const headings = paragraphsOf(document).filter(({ style }) => /^Heading\d$/.test(style));
    const at = (style: string, text: string) =>
      headings.findIndex((each) => each.style === style && each.text === text);

    expect(at("Heading4", "Minute by minute in run 2026-09-29_1402")).toBeGreaterThan(
      at("Heading2", "The evidence behind these results"),
    );
    expect(headings.slice(at("Heading2", "1 /"), at("Heading2", "1 /") + 4)).toEqual([
      { style: "Heading2", text: "1 /" },
      { style: "Heading3", text: "Read transcript of /, 18 lines" },
      { style: "Heading3", text: "Headings transcript of /, 3 lines" },
      { style: "Heading3", text: "Tab transcript of /, 9 lines" },
    ]);
  });

  // Review Focus 4: the words NVDA said are text in the file, whatever they hold.
  it("sets a first line that holds markup as plain text in the file, and escapes it only in the XML", async () => {
    const line = 'link, <b> & "x"';
    const demo = await demoModel();
    const model: ShareModel = {
      ...demo,
      pages: demo.pages.map((card, at) => (at === 0 ? { ...card, heardFirst: [line] } : card)),
    };
    const { document } = await unzipDocx(await renderWordCopy(model));

    expect(XMLValidator.validate(document)).toBe(true);
    // As the XML holds it, the markup is escaped; read back, it is the words NVDA said.
    expect(document).toContain("link, &lt;b&gt; &amp; &quot;x&quot;");
    expect(document).not.toContain("<b>");
    expect(paragraphsOf(document).map(({ text }) => text)).toContain(`“${line}”`);
  });

  it("has the footer's three paragraphs after its heading in the file, with no other heading between and nothing after them", async () => {
    for (const model of [await demoModel(), noRunModel()]) {
      const { document } = await unzipDocx(await renderWordCopy(model));
      const paragraphs = paragraphsOf(document);
      const at = paragraphs.findLastIndex(({ style }) => style === "Heading1");
      const after = paragraphs.slice(at + 1);

      // The last Heading 1 of the file is the footer's.
      expect(paragraphs[at]).toEqual({ style: "Heading1", text: "About this report" });
      // Its three paragraphs follow, in the ordinary style, and they are the file's last.
      expect(after.map(({ text }) => text)).toEqual(wordsOf(wordFooter(model).slice(1)));
      expect(after.map(({ style }) => style)).toEqual(["", "", ""]);
      expect(after.at(-1)?.text).toBe("This file: current.docx. Its web page: current.html.");
      // So they are under that heading, and under no heading 3 of a transcript.
      expect(after.some(({ style }) => style.startsWith("Heading"))).toBe(false);
    }
  });

  it("sets the properties from the model: the title, the preparer as author, and the date in each page's footer", async () => {
    const parts = await unzipDocx(await renderWordCopy(patsModel()));

    expect(propertyOf(parts.core, "dc:title")).toBe(
      "example.illinois.gov: how its pages read aloud with NVDA",
    );
    expect(propertyOf(parts.core, "dc:creator")).toBe("Pat Lee");
    expect(propertyOf(parts.core, "cp:lastModifiedBy")).toBe("Pat Lee");
    expect(footerWords(parts.footer)[0]).toBe(
      "example.illinois.gov, as of 30 September 2026. Page ",
    );
    expect(
      propertyOf((await unzipDocx(await renderWordCopy(noRunModel()))).core, "dc:creator"),
    ).toBe("voicecap");
  });

  it("escapes a site name with an ampersand or a quote in its XML, and says it as it is when read back", async () => {
    const name = `Smith & Sons' "Grants" <portal>`;
    const model = patsModel(name);
    const parts = await unzipDocx(await renderWordCopy(model));

    expect(XMLValidator.validate(parts.document)).toBe(true);
    expect(parts.core).toContain("Smith &amp; Sons&apos; &quot;Grants&quot; &lt;portal&gt;");
    expect(propertyOf(parts.core, "dc:title")).toBe(`${name}: how its pages read aloud with NVDA`);
    expect(paragraphsOf(parts.document)[1]).toEqual({ style: "", text: name });
    // Its address is the last line of the top, after who made it.
    expect(paragraphsOf(parts.document)[5]).toEqual({ style: "", text: `Site address ${SITE}.` });
    expect(footerWords(parts.footer)[0]).toBe(`${name}, as of 30 September 2026. Page `);
  });

  it("still says so when no run counts", async () => {
    const none = noRunModel();

    expect(wordsOf(wordOutline(none)).join("\n")).toContain("No live run counts yet.");
    const parts = await unzipDocx(await renderWordCopy(none));
    expect(XMLValidator.validate(parts.document)).toBe(true);
    expect(paragraphsOf(parts.document).map(({ text }) => text)).toContain(
      "No live run counts yet. There is no evidence to show.",
    );
  });

  it("is the outline and the properties made into a document, in the file's order", async () => {
    const model = await demoModel();
    const { document } = await unzipDocx(await renderWordCopy(model));
    const said = paragraphsOf(document).map(({ text }) => text);

    // The first paragraphs of the file are the first blocks of the outline.
    expect(said.slice(0, 2)).toEqual(wordsOf(wordOutline(model)).slice(0, 2));
    // The last is the footer's own line: the file's name, then the page's.
    expect(said.at(-1)).toBe("This file: current.docx. Its web page: current.html.");
  });
});
