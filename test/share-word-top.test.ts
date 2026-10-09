/**
 * The Word copy's top, At a glance, and "How voicecap works", and the five parts of the details that
 * were the summary's panels and bars, as blocks: what they say, in the page's order. The demo runs
 * of 29 September 2026 (voicecap 0.4.1, in test/fixtures/share/) are the real case; runs built in
 * memory cover the rest. The blocks are plain data, so nothing here opens a .docx.
 */
import { describe, expect, it } from "vitest";

import { esc } from "../src/report/html.js";
import { renderGlance, renderTop, reviewPart, rulesPart } from "../src/share/html/top.js";
import { lineText } from "../src/share/line.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import type { Summary } from "../src/share/summary.js";
import {
  AXE_TEXT,
  HOW_LEAD,
  HOW_STEPS,
  HOW_TEXT,
  SUMMARY_TEXT,
  TOP_TEXT,
  WHEN_TO_RUN,
} from "../src/share/text.js";
import { glanceNumbersOf, heardTitle, testedLine, topLead } from "../src/share/words.js";
import {
  PAGE_BREAK,
  heading,
  monoCell,
  para,
  wordsOf,
  type Block,
} from "../src/share/word/blocks.js";
import {
  completeBlocks,
  reviewBlocks,
  rulesBlocks,
  todoBlocks,
  whenHowBlocks,
  wordGlance,
  wordHow,
  wordTop,
} from "../src/share/word/top.js";
import { SITE } from "./helpers/report-data.js";
import { shareRun } from "./helpers/share-data.js";
import { textOf } from "./helpers/share-html.js";
import {
  DEMO_ROOT,
  demoModel,
  homeModel,
  inputOf,
  LINES,
  storeOf,
  withoutTxt,
} from "./helpers/share-model.js";
import {
  boldIn,
  cellLines,
  hrefsOf,
  linesIn,
  outlineOf,
  tableAt,
  tablesIn,
  under,
} from "./helpers/word.js";

/** Where a copy of the demo site runs on the tester's computer. */
const READ = "http://127.0.0.1:4848";

/** A site whose only run was a replay, so no run counts. */
function noRunModel(): ShareModel {
  return buildShareModel(inputOf([shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] })]));
}

/** One run of one page, with no flags, and no run before it. */
function cleanModel(): ShareModel {
  return buildShareModel(inputOf([shareRun({ id: "r1", pages: [{ path: "/" }] })]));
}

/** The same run, whose session Pat Lee ran. */
function patsModel(): ShareModel {
  const run = shareRun({ id: "r1", sessions: [{ reviewer: "Pat Lee" }], pages: [{ path: "/" }] });
  return buildShareModel(inputOf([run]));
}

/**
 * The demo site as voicecap read it on a copy on the tester's computer, named by its canonical
 * address, with a name set for it: Pat Lee's run of one page, begun at 14:02 on 29 September 2026.
 */
function copyModel(siteName: string | null = "The voicecap demo"): ShareModel {
  const run = shareRun({
    id: "2026-09-29_1402",
    site: READ,
    createdAt: "2026-09-29T14:02:00-05:00",
    sessions: [{ reviewer: "Pat Lee" }],
    pages: [{ path: "/" }],
  });
  return buildShareModel(inputOf([run], { readOrigin: READ, canonical: DEMO_ROOT, siteName }));
}

/** The model with some parts of its summary changed. */
function withSummary(model: ShareModel, parts: Partial<Summary>): ShareModel {
  return { ...model, summary: { ...model.summary, ...parts } };
}

/** The model with some of the summary's numbers changed. */
function withNumbers(model: ShareModel, numbers: Partial<Summary["numbers"]>): ShareModel {
  return withSummary(model, { numbers: { ...model.summary.numbers, ...numbers } });
}

/** The model with some of the result the verdict goes by changed. */
function withResult(model: ShareModel, result: Partial<ShareModel["result"]>): ShareModel {
  return { ...model, result: { ...model.result, ...result } };
}

/** The three builders' blocks, in the order the Word copy has them. */
function topThree(model: ShareModel): Block[] {
  return [...wordTop(model), ...wordGlance(model), ...wordHow(model)];
}

describe("wordTop", () => {
  // A reader who isn't technical meets a title, the site's name, and when it was tested first,
  // never an address such as 127.0.0.1:4848: the address comes last.
  it("leads with the canonical name and the date and time it was tested", async () => {
    const model = await demoModel(DEMO_ROOT);
    const top = wordTop(model);

    expect(top[0]).toEqual({ kind: "title", text: TOP_TEXT.eyebrow });
    expect(top[1]).toEqual(para({ text: "voicecap.netlify.app", bold: true }));
    expect(wordsOf(top)[2]).toBe(
      "Tested 29 September 2026, 14:02. This copy was made 30 September 2026.",
    );
    expect(wordsOf(top)).toContain(lineText(topLead(model.header)));
    // The runs read a copy at http://127.0.0.1:4848, and not a word of the top says so.
    expect(wordsOf(top).join("\n")).not.toMatch(/127\.0\.0\.1|localhost/);
  });

  it("says when it was tested as the page does, and when the copy was made as the page's As of does", async () => {
    const model = await demoModel(DEMO_ROOT);
    const [, , dates] = wordTop(model);
    const page = renderTop(model);

    expect(model.header.testedAt).toBe("29 September 2026, 14:02");
    expect(testedLine(model.header)).toBe("Tested 29 September 2026, 14:02");
    expect(wordsOf([dates!])).toEqual([
      `${testedLine(model.header)}. This copy was made ${model.header.asOf}.`,
    ]);
    expect(page).toContain(`<p class="mast-tested">${testedLine(model.header)}</p>`);
    expect(page).toContain(`<span>As of <b>${model.header.asOf}</b></span>`);
  });

  it("has six lines: what it is, the site, when, how its pages were read, who made it, and the site's address", async () => {
    const top = wordTop(await demoModel(DEMO_ROOT));

    expect(top.map(({ kind }) => kind)).toEqual(["title", "para", "para", "para", "para", "para"]);
    expect(wordsOf(top)).toEqual([
      "Screen reader test results",
      "voicecap.netlify.app",
      "Tested 29 September 2026, 14:02. This copy was made 30 September 2026.",
      "How its pages read aloud with NVDA, a free screen reader, tested on 29 September 2026. voicecap took NVDA through every page, pressing its keys the way a person would. Every word shown here is what NVDA said.",
      "Made with voicecap.",
      `Site address ${DEMO_ROOT}.`,
    ]);
  });

  it("says the name set for the site on a line of its own, under the name, when there is one", () => {
    const named = wordTop(copyModel("The voicecap demo"));
    const unnamed = wordTop(copyModel(null));

    expect(wordsOf(named).slice(0, 4)).toEqual([
      "Screen reader test results",
      "voicecap.netlify.app",
      "The voicecap demo",
      "Tested 29 September 2026, 14:02. This copy was made 30 September 2026.",
    ]);
    expect(named[2]).toEqual(para("The voicecap demo"));
    expect(named).toHaveLength(7);
    // Without it, the line isn't there.
    expect(unnamed).toHaveLength(6);
    expect(wordsOf(unnamed)[2]).toMatch(/^Tested /);
  });

  it("names the site in bold on a line of its own, and says its address after everything else", () => {
    const read = patsModel();
    const top = wordTop(read);
    const [, site] = top;

    // No canonical address names this site: the host voicecap read is its name, as before.
    expect(wordsOf(top)[1]).toBe("example.illinois.gov");
    expect(site?.kind === "para" ? boldIn(site.line) : []).toEqual(["example.illinois.gov"]);
    expect(wordsOf(top).at(-1)).toBe(`Site address ${SITE}.`);
    // The name isn't followed by its address: the lines that come first say none.
    expect(wordsOf(top).slice(0, 3).join("\n")).not.toContain("Site address");

    // Named by its canonical address, the name is its host, and the address last is its root.
    const canonical = wordTop(copyModel());
    expect(wordsOf(canonical)[1]).toBe("voicecap.netlify.app");
    expect(wordsOf(canonical).at(-1)).toBe(`Site address ${DEMO_ROOT}.`);
    expect(boldIn(canonical[1]?.kind === "para" ? canonical[1].line : [])).toEqual([
      "voicecap.netlify.app",
    ]);
  });

  it("never makes the site's address or host the title", async () => {
    for (const model of [await demoModel(), patsModel(), noRunModel()]) {
      const [first] = wordTop(model);

      expect(first).toEqual({ kind: "title", text: "Screen reader test results" });
      expect(wordsOf([first!]).join("")).not.toContain(new URL(model.header.site).host);
    }
  });

  it("names who prepared it, in bold, only when the records name someone", async () => {
    // The demo runs are from before voicecap recorded who ran a session.
    const demo = wordTop(await demoModel());
    const pats = wordTop(patsModel());
    // Who made it comes before the site's address, which is last.
    const about = pats.at(-2);

    expect(wordsOf(demo).join("\n")).not.toContain("Prepared by");
    expect(wordsOf(pats).at(-2)).toBe("Prepared by Pat Lee. Made with voicecap.");
    expect(about?.kind === "para" ? boldIn(about.line) : []).toEqual(["Pat Lee"]);
  });

  it("links voicecap to its page on GitHub, and NVDA to its makers", async () => {
    const model = await demoModel();
    const top = wordTop(model);

    expect(hrefsOf(top)).toEqual([TOP_TEXT.nvAccess, TOP_TEXT.github]);
    expect(linesIn(top).at(-2)).toContainEqual({
      text: "voicecap",
      href: "https://github.com/ICJIA/voicecap",
    });
    // The link's words are the top's own text, which the page's link says too.
    expect(TOP_TEXT.madeWithLink).toBe("voicecap");
    expect(renderTop(model)).toContain(
      `<a href="${TOP_TEXT.github}">${esc(TOP_TEXT.madeWithLink)}</a>`,
    );
    // A screen reader other than NVDA is named, and isn't linked to NVDA's makers.
    const other = wordTop({ ...model, header: { ...model.header, screenReader: "VoiceOver" } });
    expect(wordsOf(other)[3]).toContain("How its pages read aloud with VoiceOver, a free");
    expect(hrefsOf(other)).toEqual([TOP_TEXT.github]);
  });

  it("says plainly that no run counts, and still says which site, when the copy was made, and who made it", () => {
    const none = noRunModel();
    const words = wordsOf(wordTop(none));

    expect(none.header.tested).toBeNull();
    expect(none.header.testedAt).toBeNull();
    expect(words[0]).toBe("Screen reader test results");
    expect(words[1]).toBe("example.illinois.gov");
    // Nothing was tested, so there is no date and time to say, only when the copy was made.
    expect(words[2]).toBe("This copy was made 30 September 2026.");
    expect(words[3]).toContain("No live run counts yet, so there's no test date.");
    expect(words[4]).toBe("Made with voicecap.");
    expect(words[5]).toBe(`Site address ${SITE}.`);
    expect(testedLine(none.header)).toBeNull();
  });
});

describe("wordGlance", () => {
  it("says At a glance first: the verdict in bold, the sentence, the ring of the pages, four numbers, and the method line", async () => {
    const model = await demoModel();
    const glance = wordGlance(model);

    expect(glance.map(({ kind }) => kind)).toEqual([
      "heading",
      "para",
      "para",
      "table",
      "table",
      "para",
      "pageBreak",
    ]);
    expect(glance[0]).toEqual(heading(1, "At a glance"));
    // The verdict, in words, with its sign before them and the whole line in bold.
    expect(glance[1]).toEqual(
      para({ text: "⚠ 5 problems need attention, on 2 pages", bold: true }),
    );
    // Then the result in a sentence, the ring and the numbers as tables, and the line on what
    // voicecap and the person each did; then a page break, so At a glance has the first page.
    expect(glance[2]).toEqual(para(model.summary.sentence));
    expect(wordsOf(glance.slice(2, 3))).toEqual(["NVDA read all 7 pages."]);
    expect(glance[5]).toEqual(para(model.summary.second));
    expect(glance.at(-1)).toEqual(PAGE_BREAK);
  });

  it("says the verdict as the page does, with ✓ before nothing to attend to and ⚠ before anything else", async () => {
    const demo = await demoModel();
    const cases: [string, Partial<ShareModel["result"]>, string][] = [
      [
        "nothing left",
        { pages: 3, read: 3, problems: 0, problemPages: 0 },
        "✓ Nothing needs attention",
      ],
      [
        "one problem",
        { pages: 3, read: 3, problems: 1, problemPages: 1 },
        "⚠ 1 problem needs attention, on 1 page",
      ],
      [
        "problems",
        { pages: 3, read: 3, problems: 5, problemPages: 2 },
        "⚠ 5 problems need attention, on 2 pages",
      ],
      [
        "a page not read",
        { pages: 3, read: 2, problems: 0, problemPages: 0 },
        "⚠ Nothing needs attention on the pages read",
      ],
      [
        "a page not read, and problems",
        { pages: 3, read: 2, problems: 2, problemPages: 2 },
        "⚠ 2 problems need attention, on 2 pages",
      ],
    ];

    for (const [name, result, said] of cases) {
      const model = withResult(demo, result);
      const verdict = wordGlance(model)[1];
      const page = /<p class="verdict (\w+)">(.*?)<\/p>/s.exec(renderGlance(model));

      expect(wordsOf(verdict ? [verdict] : []), name).toEqual([said]);
      expect(verdict?.kind === "para" ? boldIn(verdict.line) : [], name).toEqual([said]);
      // The page says the same words, and draws the sign itself: ✓ for its green, ⚠ for the rest.
      expect(textOf(page?.[2] ?? "", ""), name).toBe(said.slice(2));
      expect(said.slice(0, 1), name).toBe(page?.[1] === "ok" ? "✓" : "⚠");
    }
  });

  it("gives the ring of the pages as a table of its three parts and their pages, as the page's legend counts them", async () => {
    const model = await demoModel();
    const ring = tableAt(wordGlance(model), 0);
    const legend = [
      ...renderGlance(model).matchAll(
        /<li class="[^"]*"><span class="sw" aria-hidden="true"><\/span>(.*?): <b>(.*?)<\/b><\/li>/g,
      ),
    ].map(([, part, pages]) => `${part} | ${pages}`);

    expect(model.ring).toEqual({ noProblems: 5, needAttention: 2, notRead: 0 });
    expect(ring.head).toEqual(["Part", "Pages"]);
    expect(wordsOf([ring])).toEqual([
      "Part | Pages",
      "Read, no problems | 5",
      "Read, with problems | 2",
      "Not read | 0",
    ]);
    // A part with no pages keeps its row, with 0, as the page's legend keeps its line.
    expect(ring.rows).toHaveLength(3);
    expect(wordsOf([ring]).slice(1)).toEqual(legend);
    // Counts have their thousands set apart.
    const many = { ...model, ring: { noProblems: 1204, needAttention: 2, notRead: 0 } };
    expect(wordsOf([tableAt(wordGlance(many), 0)])[1]).toBe("Read, no problems | 1,204");
  });

  // The owner's choice of 2026-10-07 (D6): the parts say whether NVDA read the page, so the
  // legend can't say "Need attention: 0" under a verdict that says a problem needs attention on a
  // page that was never read.
  it("names the ring's three parts by whether NVDA read the page, on the page's legend and in Word's table, in order", async () => {
    const demo = await demoModel();
    // One page of each part, and none left over: three read with no problems, one read with
    // problems, three not read.
    const model = {
      ...withResult(demo, { pages: 7, read: 4 }),
      ring: { noProblems: 3, needAttention: 1, notRead: 3 },
    };
    const legend = (html: string): string[] =>
      [
        ...html.matchAll(
          /<li class="[^"]*"><span class="sw" aria-hidden="true"><\/span>(.*?)<\/li>/g,
        ),
      ].map(([, item = ""]) => textOf(item, ""));

    expect(legend(renderGlance(model))).toEqual([
      "Read, no problems: 3",
      "Read, with problems: 1",
      "Not read: 3",
    ]);
    expect(wordsOf([tableAt(wordGlance(model), 0)]).slice(1)).toEqual([
      "Read, no problems | 3",
      "Read, with problems | 1",
      "Not read | 3",
    ]);
    // The old words are gone from both, wherever they stood.
    for (const old of ["No problems", "Need attention"]) {
      expect(legend(renderGlance(model)).join("\n")).not.toContain(old);
      expect(wordsOf([tableAt(wordGlance(model), 0)]).join("\n")).not.toContain(old);
    }
  });

  it("gives the four numbers as a table, each as the page's tiles say it: pages read out of the pages, the problems, the lines, and a time in words", async () => {
    const model = await demoModel();
    const numbers = tableAt(wordGlance(model), 1);

    expect(numbers.head).toEqual(["Number", "What it counts"]);
    expect(wordsOf([numbers])).toEqual([
      "Number | What it counts",
      "7 of 7 | pages read by NVDA",
      "5 | problems to fix",
      "204 | lines NVDA spoke",
      "12 minutes 34 seconds | of NVDA time, across 2 runs",
    ]);
    // Four rows, the numbers At a glance has from the one place that works them out; none counts
    // the pages a person heard NVDA read.
    expect(numbers.rows).toHaveLength(4);
    expect(numbers.rows.map(([, what]) => cellLines(what)[0])).toEqual(
      glanceNumbersOf(model).map(({ label }) => label),
    );
    expect(wordsOf([numbers]).join("\n")).not.toMatch(/heard/i);
  });

  it("sets a count's thousands apart, and says a long time in words", async () => {
    const model = withNumbers(await demoModel(), { linesSpoken: 1204, nvdaMs: 7_500_000 });
    const rows = wordsOf(wordGlance(model));

    expect(rows).toContain("1,204 | lines NVDA spoke");
    expect(rows).toContain("2 hours 5 minutes | of NVDA time, across 2 runs");
  });

  it("goes by the result for what it says, so the verdict and the numbers' first rows can't differ", async () => {
    const model = withResult(await demoModel(), {
      pages: 9,
      read: 8,
      problems: 1,
      problemPages: 1,
    });
    const glance = wordGlance(model);

    expect(wordsOf(glance.slice(1, 2))).toEqual(["⚠ 1 problem needs attention, on 1 page"]);
    expect(wordsOf([tableAt(glance, 1)]).slice(1, 3)).toEqual([
      "8 of 9 | pages read by NVDA",
      "1 | problem to fix",
    ]);
  });

  it("says only its sentence and the method line, under its heading, when no run counts", () => {
    const none = noRunModel();
    const glance = wordGlance(none);

    expect(none.header.tested).toBeNull();
    expect(glance.map(({ kind }) => kind)).toEqual(["heading", "para", "para", "pageBreak"]);
    expect(wordsOf(glance)).toEqual(["At a glance", none.summary.sentence, none.summary.second]);
    expect(none.summary.sentence).toContain("No live run counts yet");
    expect(tablesIn(glance)).toEqual([]);
  });

  it("gives no verdict, ring, or numbers for a run that counts but lists no page, as the page gives none", () => {
    const empty = buildShareModel(inputOf([shareRun({ id: "r1", pages: [] })]));
    const glance = wordGlance(empty);

    // The verdict says "Nothing needs attention" of no page, which no one read: it isn't shown.
    expect(empty.header.tested).not.toBeNull();
    expect(empty.result.pages).toBe(0);
    expect(glance.map(({ kind }) => kind)).toEqual(["heading", "para", "para", "pageBreak"]);
    expect(wordsOf(glance)).toEqual(["At a glance", empty.summary.sentence, empty.summary.second]);
    expect(wordsOf(glance).join("\n")).not.toContain("Nothing needs attention");
  });

  it("links to nothing, since the Word copy's sections follow one another", async () => {
    for (const model of [await demoModel(), cleanModel(), noRunModel()]) {
      expect(hrefsOf(wordGlance(model))).toEqual([]);
    }
  });
});

describe("the details' parts that were the summary's panels and bars", () => {
  /** The five builders' blocks, one list for each, in the order the details have them. */
  const parts = (model: ShareModel): Block[][] => {
    const { summary } = model;
    return [
      todoBlocks(summary),
      completeBlocks(summary),
      whenHowBlocks(summary),
      rulesBlocks(summary),
      reviewBlocks(summary),
    ];
  };

  it("each start with a heading 2, since the details' own heading is the one heading 1 above them", async () => {
    for (const model of [await demoModel(), cleanModel()]) {
      expect(parts(model).map((blocks) => outlineOf(blocks.slice(0, 1)))).toEqual([
        ["2 What's still to do"],
        ["2 How complete the test was"],
        ["2 When and how"],
        ["2 Flags by rule"],
        ["2 The human review"],
      ]);
      for (const blocks of parts(model)) {
        expect(outlineOf(blocks)).toHaveLength(1);
        expect(blocks.some((block) => block.kind === "pageBreak")).toBe(false);
      }
    }
  });

  it("list how complete the test was, with the line on the run before last", async () => {
    const model = await demoModel();
    const complete = under(completeBlocks(model.summary), "How complete the test was");

    expect(model.summary.changesLine).toBe(
      "Since the last run on 29 September: every page read in full in both runs sounds the same.",
    );
    expect(complete.map(({ kind }) => kind)).toEqual(["list"]);
    expect(wordsOf(complete)).toEqual([...model.summary.complete, model.summary.changesLine]);
  });

  it("leave out the line on the run before when there is none", () => {
    const model = cleanModel();

    expect(model.summary.changesLine).toBeNull();
    expect(wordsOf(under(completeBlocks(model.summary), "How complete the test was"))).toEqual(
      model.summary.complete,
    );
  });

  it("list what's still to do, and when and how the test was run, each label in bold", async () => {
    const model = await demoModel();
    const todo = todoBlocks(model.summary);
    const whenHow = whenHowBlocks(model.summary);
    const [list] = under(whenHow, "When and how");

    expect(under(todo, "What's still to do").map(({ kind }) => kind)).toEqual(["list"]);
    expect(wordsOf(under(todo, "What's still to do"))).toEqual(model.summary.todo);
    expect(wordsOf(under(whenHow, "When and how"))).toEqual([
      "Date: 29 September 2026",
      "Run by: Not recorded: this run used voicecap 0.4.1.",
      "Screen reader: NVDA 2026.2",
      "Browser: Chrome 154.0.8037.58",
      "Operating system: Windows 11 Pro 25H2 (10.0.26200)",
    ]);
    expect(list?.kind === "list" ? list.items.map(boldIn) : []).toEqual([
      ["Date"],
      ["Run by"],
      ["Screen reader"],
      ["Browser"],
      ["Operating system"],
    ]);
  });

  it("have a row for each rule: how many times it was raised, and its share of every flag raised", async () => {
    const model = await demoModel();

    expect(wordsOf(under(rulesBlocks(model.summary), "Flags by rule"))).toEqual([
      "Times each rule was raised, across pages and passes.",
      "Rule | Times raised | Share of all flags raised",
      "generic-link-text | 2 | 40%",
      "unlabeled | 2 | 40%",
      "headings | 1 | 20%",
    ]);
  });

  it("set each rule's name in the fixed-width font, as the page does, and its counts in plain", async () => {
    const model = await demoModel();
    const [rules] = tablesIn(under(rulesBlocks(model.summary), "Flags by rule"));

    expect(rules?.rows.map(([rule]) => rule)).toEqual(
      model.summary.bars.flagsByRule.map(({ rule }) => monoCell(rule)),
    );
    expect(rules?.rows.map((row) => row.slice(1).some((cell) => cell.mono === true))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("say no flags were raised, rather than draw an empty table", () => {
    const model = cleanModel();
    const rules = under(rulesBlocks(model.summary), "Flags by rule");

    expect(model.summary.bars.flagsByRule).toEqual([]);
    // After what a rule's count is, as the page has it in the title, and with no table.
    expect(wordsOf(rules)).toEqual([
      "Times each rule was raised, across pages and passes.",
      "No flags were raised.",
    ]);
    expect(rules.map(({ kind }) => kind)).toEqual(["para", "para"]);
  });

  it("have the human review as counts out of their totals, so nothing looks complete that isn't", async () => {
    const model = await demoModel();

    // A row for the pages reviewed and one for the issues fixed: none for the pages a person heard
    // NVDA read.
    expect(wordsOf(under(reviewBlocks(model.summary), "The human review"))).toEqual([
      "Each out of its total.",
      "What | Count | Out of | Share",
      "Transcripts reviewed | 0 | 7 | 0%",
      "Issues fixed | 0 | 0 | nothing to count",
    ]);
    const some = withSummary(model, {
      bars: { ...model.summary.bars, review: { reviewed: [2, 3], fixed: [1, 1] } },
    });
    expect(wordsOf(under(reviewBlocks(some.summary), "The human review"))).toEqual([
      "Each out of its total.",
      "What | Count | Out of | Share",
      "Transcripts reviewed | 2 | 3 | 67%",
      "Issues fixed | 1 | 1 | 100%",
    ]);
  });

  it("say under each bar's title, before its table, what the page says beside the title", async () => {
    const model = await demoModel();
    // The page's two bars are parts of its details, each with the phrase beside its title.
    const page = rulesPart(model.summary) + reviewPart(model.summary);
    const notes = [
      [
        "Flags by rule",
        rulesBlocks(model.summary),
        "rules-h",
        SUMMARY_TEXT.rulesNote,
        "Times each rule was raised, across pages and passes.",
      ],
      [
        "The human review",
        reviewBlocks(model.summary),
        "review-h",
        SUMMARY_TEXT.reviewNote,
        "Each out of its total.",
      ],
    ] as const;

    // The page's words, as its summary text has them, so that both copies say the same.
    expect(SUMMARY_TEXT.rulesNote).toBe("times each rule was raised, across pages and passes");
    expect(SUMMARY_TEXT.reviewNote).toBe("each out of its total");
    for (const [title, blocks, id, note, said] of notes) {
      const [first, second] = under(blocks, title);

      // The page still says it, beside the title. The Word copy says it as a paragraph of its own:
      // the same words, with a capital and a full stop, and then the table.
      expect(page, title).toContain(
        `<h3 id="${id}">${esc(title)} <span class="sub">${esc(note)}</span></h3>`,
      );
      expect([first?.kind, second?.kind], title).toEqual(["para", "table"]);
      expect(wordsOf(first ? [first] : []), title).toEqual([said]);
      expect(said.toLowerCase(), title).toBe(`${note}.`);
    }
  });
});

describe("wordHow", () => {
  it("opens with its heading and the lead, the words that say the person reads in bold", async () => {
    const [head, lead] = wordHow(await demoModel());

    expect(head).toEqual(heading(1, "How voicecap works"));
    expect(lead?.kind === "para" ? lineText(lead.line) : "").toBe(HOW_LEAD);
    expect(lead?.kind === "para" ? boldIn(lead.line) : []).toEqual([HOW_TEXT.leadBold]);
  });

  it("says, after the lead, that each page is checked with axe before NVDA reads it, as the page does", async () => {
    const [, , axe] = wordHow(await demoModel());

    expect(axe).toEqual(para(AXE_TEXT.how));
  });

  it("has the six steps as a numbered table, and the stages as four columns", async () => {
    const model = await demoModel();
    const how = wordHow(model);
    const tables = how.filter((block) => block.kind === "table");

    expect(tables[0]).toMatchObject({ head: ["No.", "Step", "What it means"] });
    expect(wordsOf([tableAt(how, 0)]).slice(1)).toEqual(
      HOW_STEPS.map((step, index) => `${index + 1} | ${step.title} | ${step.text}`),
    );
    expect(tables.at(-1)).toMatchObject({ head: WHEN_TO_RUN.stages.map((stage) => stage.title) });
  });

  it("sets each step's title in bold, and its number and what it means as they are", async () => {
    const steps = tableAt(wordHow(await demoModel()), 0);

    expect(steps.rows).toHaveLength(6);
    for (const [index, row] of steps.rows.entries()) {
      const [number, step, meaning] = row.map((cell) => cell.lines);
      expect(number).toEqual([[`${index + 1}`]]);
      expect(step?.map(boldIn)).toEqual([[HOW_STEPS[index]?.title]]);
      expect(meaning?.map(boldIn)).toEqual([[]]);
    }
  });

  it("gives the first lines of each pass on the home page as a table: a column for each pass, a row for each line", async () => {
    const model = await demoModel();
    const how = wordHow(model);
    const sample = tableAt(how, 1);
    const heard = under(how, "Heard on this site: http://127.0.0.1:4848/, three ways");

    expect(outlineOf(how)[1]).toBe("2 Heard on this site: http://127.0.0.1:4848/, three ways");
    expect(wordsOf([sample])).toEqual([
      "Down Arrow, line by line | H, heading by heading | Tab, control by control",
      "“banner landmark, voicecap demo” (1.3 s) | “main landmark, Welcome to the voicecap demo, heading, level 1” (1.3 s) | “Skip to main content, same page, link” (1.3 s)",
      "“Tour, navigation landmark, list, with 1 item, link, Next: Before you start” (1.3 s) | “The tour's pages, heading, level 2” (1.3 s) | “Tour, navigation landmark, list, with 1 item, Next: Before you start, link” (1.3 s)",
      "“out of list, main landmark, heading, level 1, Welcome to the voicecap demo” (1.3 s) | “no next heading” (1.3 s) | “main landmark, list, with 6 items, Before you start, link” (1.3 s)",
    ]);
    // Every line the model has, in the column of its pass.
    for (const [column, { lines }] of (model.heard?.passes ?? []).entries()) {
      const said = sample.rows.map((row) => lineText(row[column]?.lines[0] ?? []));
      expect(said).toEqual(lines.map(({ text, took }) => `“${text}” (${took})`));
    }
    // What the words are, and what each time is, said once, under the table.
    expect(heard).toEqual([sample, para(HOW_TEXT.heardNote)]);
  });

  it("says how many ways through the page it heard, and pads a pass with fewer lines than another", async () => {
    const model = await demoModel();
    const sample = {
      page: "/",
      passes: [
        {
          pass: "read" as const,
          lines: [
            { text: "a", took: "1.0 s" },
            { text: "b", took: "1.1 s" },
            { text: "c", took: "1.2 s" },
          ],
        },
        { pass: "tab" as const, lines: [{ text: "x", took: "0.9 s" }] },
      ],
    };
    const how = wordHow({ ...model, heard: sample });
    const table = tableAt(how, 1);

    expect(outlineOf(how)[1]).toBe(`2 ${heardTitle(sample)}`);
    expect(outlineOf(how)[1]).toBe("2 Heard on this site: /, two ways");
    expect(wordsOf([table])).toEqual([
      "Down Arrow, line by line | Tab, control by control",
      "“a” (1.0 s) | “x” (0.9 s)",
      "“b” (1.1 s) | ",
      "“c” (1.2 s) | ",
    ]);
    // A cell with no line is empty, and is still a cell: each row has one for each heading.
    expect(table.rows.map((row) => row.length)).toEqual([2, 2, 2]);
    expect(table.rows[1]?.[1]).toEqual({ lines: [] });
  });

  // The sample follows the rule a card's Heard first follows: a pass is quoted only when its
  // transcript, the file the page shows, can be read here.
  it("takes a column only for a pass whose transcript can be read here, and names the ways through the page by those", () => {
    const model = homeModel(withoutTxt(storeOf(), (_slug, pass) => pass === "headings"));
    const how = wordHow(model);

    expect(outlineOf(how)[1]).toBe(`2 Heard on this site: ${SITE}, two ways`);
    expect(wordsOf([tableAt(how, 1)])).toEqual([
      "Down Arrow, line by line | Tab, control by control",
      "“banner landmark, link, Skip to main content” (1.2 s) | “Skip to main content, link” (1.2 s)",
      "“heading, level 1, Grants” (1.2 s) | “click here, link” (1.2 s)",
      "“To apply,, link, click here, dot” (1.2 s) | ",
    ]);
  });

  it("says no sample is available when no pass's transcript can be read here", () => {
    const model = homeModel(withoutTxt(storeOf()));
    const how = wordHow(model);

    expect(model.heard).toBeNull();
    expect(under(how, "Heard on this site")).toEqual([
      para("Not recorded: no sample of the home page's lines is available."),
    ]);
    expect(tablesIn(how)).toHaveLength(2);
  });

  // A step where NVDA said nothing is the marker the transcript writes, a note and not words NVDA
  // said: a card's Heard first sets it bare, and so does the sample.
  it("sets a step where NVDA said nothing as the marker, with no quotes, as a card does", () => {
    const model = homeModel(
      storeOf(() => ({ ...LINES, read: ["banner landmark, Home", "", "heading, level 1, Home"] })),
    );
    const sample = tableAt(wordHow(model), 1);

    expect(wordsOf([sample]).slice(1)).toEqual([
      "“banner landmark, Home” (1.2 s) | “heading, level 1, Grants” (1.2 s) | “Skip to main content, link” (1.2 s)",
      "[no speech] (1.2 s) | “no next heading” (1.2 s) | “click here, link” (1.2 s)",
      "“heading, level 1, Home” (1.2 s) |  | ",
    ]);
    expect(wordsOf([sample]).join("\n")).not.toContain("“[no speech]”");
  });

  it("says no sample is available when no home page has transcripts to quote", () => {
    const model = noRunModel();
    const how = wordHow(model);

    expect(model.heard).toBeNull();
    expect(outlineOf(how)).toEqual([
      "1 How voicecap works",
      "2 Heard on this site",
      "2 When to run voicecap: before the site goes live.",
    ]);
    expect(under(how, "Heard on this site")).toEqual([
      para("Not recorded: no sample of the home page's lines is available."),
    ]);
    // The steps and the stages are still there, and there is no table of lines between them.
    expect(tablesIn(how)).toHaveLength(2);
  });

  it("closes with when to run voicecap: the headline, its line, and the four stages, the marked one's words in bold", async () => {
    const how = wordHow(await demoModel());
    const when = under(how, WHEN_TO_RUN.headline);
    const stages = tableAt(how, 2);

    expect(outlineOf(how).at(-1)).toBe("2 When to run voicecap: before the site goes live.");
    expect(when).toEqual([para(WHEN_TO_RUN.text), stages]);
    expect(wordsOf([stages])).toEqual([
      "In development | Before launch | Live | After a major update",
      WHEN_TO_RUN.stages.map((stage) => stage.text).join(" | "),
    ]);
    // One row, a cell for each stage, and only the marked stage's words in bold.
    expect(stages.rows).toHaveLength(1);
    expect(stages.rows[0]?.map((cell) => cell.lines.flatMap(boldIn))).toEqual(
      WHEN_TO_RUN.stages.map((stage) => (stage.marked ? [stage.text] : [])),
    );
    expect(WHEN_TO_RUN.stages.filter((stage) => stage.marked)).toHaveLength(1);
  });
});

describe("the top, At a glance, and how voicecap works together", () => {
  /** Each model: the demo's, a person's run, a clean run, and a site where no run counts. */
  const models = async (): Promise<[string, ShareModel][]> => [
    ["the demo's", await demoModel()],
    ["a person's run", patsModel()],
    ["a clean run", cleanModel()],
    ["no counted run", noRunModel()],
  ];

  it("sets its headings in order: the title first, an h1 for each of the two sections, and h2 inside", async () => {
    for (const [name, model] of await models()) {
      const blocks = topThree(model);
      const levels = blocks.flatMap((block) => (block.kind === "heading" ? [block.level] : []));

      expect(blocks[0]?.kind, name).toBe("title");
      expect(
        blocks.filter((block) => block.kind === "title"),
        name,
      ).toHaveLength(1);
      expect(levels[0], name).toBe(1);
      expect(
        levels.filter((level) => level === 1),
        name,
      ).toHaveLength(2);
      for (const [index, level] of levels.entries()) {
        if (index > 0) expect(level - (levels[index - 1] ?? 0), name).toBeLessThanOrEqual(1);
      }
    }
  });

  it("never gives a table a heading with no words, since Word flags an empty header cell", async () => {
    for (const [name, model] of await models()) {
      const tables = tablesIn(topThree(model));

      expect(tables.length, name).toBeGreaterThanOrEqual(2);
      for (const { head } of tables) {
        expect(
          head.every((words) => words.trim() !== ""),
          name,
        ).toBe(true);
      }
    }
  });

  it("links only voicecap and NVDA to their makers", async () => {
    for (const [name, model] of await models()) {
      expect(hrefsOf(topThree(model)), name).toEqual([TOP_TEXT.nvAccess, TOP_TEXT.github]);
    }
  });

  it("never calls voicecap automated", async () => {
    // Each line on its own, as a sentence about voicecap would sit in one: the lead's "automated
    // checkers" are other tools, and follow the heading "How voicecap works".
    for (const [name, model] of await models()) {
      for (const words of wordsOf(topThree(model))) {
        expect(words, name).not.toMatch(/voicecap[^.]*\bautomated\b/i);
      }
    }
  });
});
