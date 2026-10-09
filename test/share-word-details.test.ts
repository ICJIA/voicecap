/**
 * The Word copy's "The details, for reviewers and auditors", as blocks: its heading and line, and
 * each part under it, in the page's order. The five parts that were the summary's panels and bars
 * come from the top's builders (./share-word-top.test.ts tests their words); the rest are the
 * sections that follow the pages on the page, each set one level down. The demo runs of 29
 * September 2026 (voicecap 0.4.1, in test/fixtures/share/) are the real case; runs built in memory
 * cover a site where no run counts. The blocks are plain data, so nothing here opens a .docx.
 */
import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "vitest";

import { renderDetails } from "../src/share/html/details.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import { DETAILS_TEXT } from "../src/share/text.js";
import { demoted, heading, para, wordsOf, type Block } from "../src/share/word/blocks.js";
import { wordChanges } from "../src/share/word/changes.js";
import { wordDetails } from "../src/share/word/details.js";
import { wordCoverage, wordEvidence, wordStory } from "../src/share/word/evidence.js";
import { wordProblems } from "../src/share/word/problems.js";
import {
  completeBlocks,
  reviewBlocks,
  rulesBlocks,
  todoBlocks,
  whenHowBlocks,
  wordHow,
} from "../src/share/word/top.js";
import { keptLogsModel, problemEntry } from "./helpers/nvda-log.js";
import { shareRun } from "./helpers/share-data.js";
import { textOf } from "./helpers/share-html.js";
import { demoModel, inputOf } from "./helpers/share-model.js";
import { hrefsOf, outlineOf, partsAt } from "./helpers/word.js";

/** A site whose only run was a replay, so no run counts. */
function noRunModel(): ShareModel {
  return buildShareModel(inputOf([shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] })]));
}

/** The parts of the details, as the words of their headings 2, in order. */
function partsOf(blocks: Block[]): string[] {
  return outlineOf(blocks)
    .filter((each) => each.startsWith("2 "))
    .map((each) => each.slice(2));
}

/** Whether some blocks are among others, whole and in order, one right after another. */
function includesRun(blocks: Block[], run: Block[]): boolean {
  return blocks.some((_, at) =>
    run.every((block, offset) => isDeepStrictEqual(blocks[at + offset], block)),
  );
}

/** The parts of the page's details: the words of each heading 3 that has an id, in order. */
function pageParts(model: ShareModel): { id: string; words: string }[] {
  return [...renderDetails(model).matchAll(/<h3 id="([^"]+)">(.*?)<\/h3>/g)].map(
    ([, id = "", words = ""]) => ({ id, words: textOf(words) }),
  );
}

describe("wordDetails", () => {
  it("opens with its heading and the line that says what is here", async () => {
    const details = wordDetails(await demoModel());

    expect(details.slice(0, 2)).toEqual([
      heading(1, "The details, for reviewers and auditors"),
      para("How the test was run, what it covered, and the evidence behind it."),
    ]);
    expect(details[0]).toEqual(heading(1, DETAILS_TEXT.title));
    expect(wordsOf(details.slice(1, 2))).toEqual([DETAILS_TEXT.gist]);
    // One heading 1: everything else in it is a part, or inside one.
    expect(outlineOf(details).filter((each) => each.startsWith("1 "))).toHaveLength(1);
  });

  it("has the page's eleven parts, each a heading 2, in the page's order", async () => {
    const model = await demoModel();
    const parts = partsOf(wordDetails(model));

    expect(parts).toEqual([
      "What's still to do",
      "How complete the test was",
      "When and how",
      "What changed since the last run",
      "Problems during the runs",
      "What these results cover",
      "Flags by rule",
      "The human review",
      "The evidence behind these results",
      "How voicecap works",
      "How voicecap came to be",
    ]);
    // The page's details have the same parts in the same order, each a heading 3 with its own id.
    const page = pageParts(model);
    expect(page.map(({ id }) => id)).toEqual([
      "todo-h",
      "complete-h",
      "whenhow-h",
      "chg-h",
      "prob-h",
      "lim-h",
      "rules-h",
      "review-h",
      "ev-h",
      "how-h",
      "story-h",
    ]);
    for (const [index, part] of parts.entries()) {
      // A title the page follows with a phrase of its own ("Flags by rule times each rule…") is
      // still the Word copy's title first.
      expect(page[index]?.words.startsWith(part), part).toBe(true);
    }
  });

  it("has the six parts that aren't counts when no run counts, as the page does", () => {
    const none = noRunModel();
    const parts = partsOf(wordDetails(none));

    expect(none.header.tested).toBeNull();
    expect(parts).toEqual([
      "What changed since the last run",
      "Problems during the runs",
      "What these results cover",
      "The evidence behind these results",
      "How voicecap works",
      "How voicecap came to be",
    ]);
    const page = pageParts(none);
    expect(page.map(({ id }) => id)).toEqual([
      "chg-h",
      "prob-h",
      "lim-h",
      "ev-h",
      "how-h",
      "story-h",
    ]);
    for (const [index, part] of parts.entries()) {
      expect(page[index]?.words.startsWith(part), part).toBe(true);
    }
    // Nothing was counted, so it says so where it would show the evidence.
    expect(wordsOf(wordDetails(none))).toContain(
      "No live run counts yet. There is no evidence to show.",
    );
  });

  it("sets the five parts that were the summary's panels and bars as the top's builders give them", async () => {
    const model = await demoModel();
    const details = wordDetails(model);
    const { summary } = model;

    for (const part of [
      todoBlocks(summary),
      completeBlocks(summary),
      whenHowBlocks(summary),
      rulesBlocks(summary),
      reviewBlocks(summary),
    ]) {
      // Each is a heading 2 and what is under it, which is already one level under the details'.
      expect(part[0]?.kind === "heading" && part[0].level).toBe(2);
      expect(includesRun(details, part), outlineOf(part.slice(0, 1))[0]).toBe(true);
    }
    // Where the page has them: the three panels first, and the two bars after what the results cover.
    const parts = partsOf(details);
    expect(parts.slice(0, 3)).toEqual([
      "What's still to do",
      "How complete the test was",
      "When and how",
    ]);
    expect(parts.slice(6, 8)).toEqual(["Flags by rule", "The human review"]);
  });

  it("sets each section that follows the pages one level down: its heading 1 is a part's heading 2, and what is inside goes down with it", async () => {
    const model = await demoModel();
    const details = wordDetails(model);

    for (const section of [
      wordChanges,
      wordProblems,
      wordCoverage,
      wordEvidence,
      wordHow,
      wordStory,
    ]) {
      const down = demoted(section(model));

      expect(down[0]?.kind === "heading" && down[0].level, section.name).toBe(2);
      expect(includesRun(details, down), section.name).toBe(true);
    }
  });

  it("sets its headings in order, never skipping a level and going no deeper than level 4", async () => {
    // A traceback of NVDA's own log in a problem's record is a row of its table, with no heading.
    const nvda = keptLogsModel([problemEntry("ERROR", "14:04:20.123", "x", "y")]);
    for (const model of [await demoModel(), noRunModel(), nvda]) {
      const levels = wordDetails(model).flatMap((block) =>
        block.kind === "heading" ? [block.level] : [],
      );

      expect(levels[0]).toBe(1);
      expect(Math.max(...levels)).toBeLessThanOrEqual(4);
      for (const [index, level] of levels.entries()) {
        if (index > 0) expect(level - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("has a heading 4 for each part of a run, under the run's heading 3, in the evidence", async () => {
    const model = await demoModel();
    const [evidence] = partsAt(wordDetails(model), 2).filter((part) =>
      outlineOf(part.slice(0, 1))[0]?.endsWith("The evidence behind these results"),
    );
    const outline = outlineOf(evidence ?? []);
    const latest = outline.indexOf("3 Run 2026-09-29_1402");

    expect(outline[0]).toBe("2 The evidence behind these results");
    expect(outline.slice(latest, latest + 6)).toEqual([
      "3 Run 2026-09-29_1402",
      "4 Minute by minute in run 2026-09-29_1402",
      "4 NVDA's own log, checked against the transcripts in run 2026-09-29_1402",
      "4 Test environment in run 2026-09-29_1402",
      "4 Fingerprints (SHA-256) in run 2026-09-29_1402",
      "4 Walkthrough file in run 2026-09-29_1402",
    ]);
    // The evidence of two runs: ten parts, a heading 4 each.
    expect(outline.filter((each) => each.startsWith("4 "))).toHaveLength(10);
  });

  it("has no title and no page break of its own: At a glance has the first page, and the details follow the pages", async () => {
    for (const model of [await demoModel(), noRunModel()]) {
      const kinds = new Set(wordDetails(model).map(({ kind }) => kind));

      expect(kinds.has("title")).toBe(false);
      expect(kinds.has("pageBreak")).toBe(false);
    }
  });

  it("says the details' two lines as the page does", async () => {
    const page = renderDetails(await demoModel());

    expect(page).toContain(`<h2 id="details-h">${DETAILS_TEXT.title}</h2>`);
    expect(page).toContain(`<p class="gist">${DETAILS_TEXT.gist}</p>`);
  });

  it("never calls voicecap automated, and never says a person listened", async () => {
    for (const model of [await demoModel(), noRunModel()]) {
      // The fixed text speaks of other tools that are ("automated checkers"), and of "the
      // listen-through"; no sentence says voicecap is automated, or that a person listened (the
      // text's own test reads sentences up to a full stop, a colon, or a semicolon).
      for (const words of wordsOf(wordDetails(model).filter((block) => block.kind !== "mono"))) {
        expect(words).not.toMatch(/voicecap[^.:;]*\bautomated\b/i);
        expect(words).not.toMatch(/\blistened\b/i);
      }
    }
  });

  it("links only to the addresses the page links to outside itself", async () => {
    expect(new Set(hrefsOf(wordDetails(await demoModel())))).toEqual(
      new Set([
        "https://github.com/ICJIA/voicecap/issues",
        "https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/",
      ]),
    );
  });
});
