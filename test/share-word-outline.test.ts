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

import { renderWordCopy } from "../src/share/docx.js";
import { renderSharePage } from "../src/share/html/document.js";
import { lineOfMarkup, lineText } from "../src/share/line.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import {
  ABOUT,
  HOW_LEAD,
  HOW_STEPS,
  STORY,
  TIMELINE,
  WHEN_TO_RUN,
  WORD_TEXT,
  WORTH_KNOWING,
} from "../src/share/text.js";
import { documentTitle } from "../src/share/words.js";
import { wordsOf, type Block } from "../src/share/word/blocks.js";
import { wordFooter, wordStory } from "../src/share/word/evidence.js";
import { wordOutline, wordProperties } from "../src/share/word/outline.js";
import {
  footerWords,
  linksOf,
  paragraphsOf,
  propertyOf,
  tablesOf,
  unzipDocx,
} from "./helpers/docx.js";
import { shareRun } from "./helpers/share-data.js";
import { decode, textOf } from "./helpers/share-html.js";
import { demoModel, inputOf } from "./helpers/share-model.js";
import { hrefsOf, tablesIn } from "./helpers/word.js";

/** A site whose only run was a replay, so no run counts. */
function noRunModel(): ShareModel {
  return buildShareModel(inputOf([shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] })]));
}

/** One run of one page, which Pat Lee ran, under a site name set to `siteName`. */
function patsModel(siteName: string | null = null): ShareModel {
  const run = shareRun({ id: "r1", sessions: [{ reviewer: "Pat Lee" }], pages: [{ path: "/" }] });
  return buildShareModel(inputOf([run], { siteName }));
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

describe("wordOutline", () => {
  // The page has ten sections, and its footer is a landmark with no heading, which a screen reader
  // announces. In Word, a footer with no heading would belong to the last transcript's heading 3,
  // in the navigation pane and for a screen reader alike, and only a change of font would mark where
  // it begins. So the Word copy has eleven level-1 headings: the page's ten, then the footer's.
  it("has eleven sections: the page's ten, in the page's order, and then a heading of its own for the footer", async () => {
    const model = await demoModel();
    const sections = sectionsOf(wordOutline(model));
    const page = renderSharePage(model, { fontCss: "" });

    expect(sections).toEqual([
      "Summary",
      "How voicecap works",
      "Every page",
      "What the flags found",
      "What changed since the last run",
      "Problems during the runs",
      "What these results cover",
      "The evidence behind these results",
      "How voicecap came to be",
      "Appendix: every transcript",
      "About this report",
    ]);
    expect(pageSections(page)).toHaveLength(10);
    expect(sections.slice(0, 10)).toEqual(pageSections(page));
    expect(sections.at(-1)).toBe("About this report");
  });

  it("has the same eleven sections for a site where no run counts too", () => {
    const none = noRunModel();
    const sections = sectionsOf(wordOutline(none));

    expect(sections).toHaveLength(11);
    expect(sections.slice(0, 10)).toEqual(pageSections(renderSharePage(none, { fontCss: "" })));
    expect(sections.at(-1)).toBe("About this report");
  });

  it("starts with the site's name, as the one title, and ends with the footer, heading and all", async () => {
    const model = await demoModel();
    const blocks = wordOutline(model);

    expect(blocks[0]).toEqual({ kind: "title", text: model.header.siteName });
    expect(blocks.filter((block) => block.kind === "title")).toHaveLength(1);
    expect(blocks.slice(-4)).toEqual(wordFooter(model));
    expect(blocks.slice(-4).map(({ kind }) => kind)).toEqual(["heading", "para", "para", "para"]);
  });

  it("puts the footer under a heading of its own, never under the last transcript's, with no page break before it", async () => {
    for (const model of [await demoModel(), noRunModel()]) {
      const blocks = wordOutline(model);
      const at = blocks.findLastIndex((block) => block.kind === "heading");

      // The outline's last heading is the footer's, at level 1, so its paragraphs are under it and
      // no longer under the last transcript's heading 3.
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

  it("sets its headings in order, an h1 first, and never a level skipped, for each site", async () => {
    for (const model of [await demoModel(), noRunModel(), patsModel()]) {
      const blocks = wordOutline(model);
      const levels = blocks.flatMap((block) => (block.kind === "heading" ? [block.level] : []));

      expect(levels[0]).toBe(1);
      for (const [index, level] of levels.entries()) {
        if (index > 0) expect(level - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
      }
    }
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
    expect(paragraphsOf(parts.document)[0]).toEqual({
      style: "Title",
      text: model.header.siteName,
    });
    expect(propertyOf(parts.core, "dc:title")).toBe(
      `${model.header.siteName}: how its pages read aloud with NVDA`,
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

  it("has a heading 1 in the file for each section of the outline, in its order: the page's ten, then the footer's", async () => {
    const model = await demoModel();
    const { document } = await unzipDocx(await renderWordCopy(model));
    const sections = paragraphsOf(document).flatMap(({ style, text }) =>
      style === "Heading1" ? [text] : [],
    );

    expect(sections).toEqual(sectionsOf(wordOutline(model)));
    expect(sections).toHaveLength(11);
    expect(sections.at(-1)).toBe("About this report");
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
    expect(paragraphsOf(parts.document)[0]).toEqual({ style: "Title", text: name });
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
