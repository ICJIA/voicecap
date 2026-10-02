/**
 * The Word copy's top, its summary, and "How voicecap works", as blocks: what they say, in the
 * page's order. The demo runs of 29 September 2026 (voicecap 0.4.1, in test/fixtures/share/) are
 * the real case; runs built in memory cover the rest. The blocks are plain data, so nothing here
 * opens a .docx.
 */
import { describe, expect, it } from "vitest";

import { lineText, type Line } from "../src/share/line.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import type { Summary } from "../src/share/summary.js";
import {
  HOW_LEAD,
  HOW_STEPS,
  HOW_TEXT,
  SUMMARY_TEXT,
  TOP_TEXT,
  WHEN_TO_RUN,
  WORD_TEXT,
} from "../src/share/text.js";
import { heardTitle, shareOf, topLead } from "../src/share/words.js";
import { PAGE_BREAK, heading, para, wordsOf, type Block } from "../src/share/word/blocks.js";
import { wordHow, wordSummary, wordTop } from "../src/share/word/top.js";
import { SITE } from "./helpers/report-data.js";
import { shareRun } from "./helpers/share-data.js";
import { demoModel, inputOf } from "./helpers/share-model.js";

type Table = Extract<Block, { kind: "table" }>;

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

/** The model with some parts of its summary changed. */
function withSummary(model: ShareModel, parts: Partial<Summary>): ShareModel {
  return { ...model, summary: { ...model.summary, ...parts } };
}

/** The model with some of the summary's six numbers changed. */
function withNumbers(model: ShareModel, numbers: Partial<Summary["numbers"]>): ShareModel {
  return withSummary(model, { numbers: { ...model.summary.numbers, ...numbers } });
}

/** The tables among the blocks, in order. */
function tablesIn(blocks: Block[]): Table[] {
  return blocks.filter((block): block is Table => block.kind === "table");
}

/** The table at a place among the blocks' tables, counting from 0. */
function tableAt(blocks: Block[], at: number): Table {
  const found = tablesIn(blocks)[at];
  if (found === undefined) throw new Error(`No table at ${at}`);
  return found;
}

/** The headings among the blocks, in order, each as its level and its words: "2 Flags by rule". */
function outlineOf(blocks: Block[]): string[] {
  return blocks.flatMap((block) =>
    block.kind === "heading" ? [`${block.level} ${block.text}`] : [],
  );
}

/** The blocks under a heading: those after it, up to the next heading or the end. */
function under(blocks: Block[], words: string): Block[] {
  const start = blocks.findIndex((block) => block.kind === "heading" && block.text === words);
  if (start === -1) throw new Error(`No heading "${words}"`);
  const rest = blocks.slice(start + 1);
  const end = rest.findIndex((block) => block.kind === "heading");
  return end === -1 ? rest : rest.slice(0, end);
}

/** The pieces of a line that are in bold, as their words. */
function boldIn(line: Line): string[] {
  return line.flatMap((piece) => (typeof piece !== "string" && piece.bold ? [piece.text] : []));
}

/** Every line the blocks hold, in order: a paragraph's, each list item's, and each cell's lines. */
function linesIn(blocks: Block[]): Line[] {
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
function hrefsOf(blocks: Block[]): string[] {
  return linesIn(blocks).flatMap((line) =>
    line.flatMap((piece) =>
      typeof piece === "string" || piece.href === undefined ? [] : [piece.href],
    ),
  );
}

/** The three builders' blocks, in the order the Word copy has them. */
function topThree(model: ShareModel): Block[] {
  return [...wordTop(model), ...wordSummary(model), ...wordHow(model)];
}

describe("wordTop", () => {
  it("leads with the site's name, and what the page is", async () => {
    const model = await demoModel();
    const top = wordTop(model);

    expect(top[0]).toEqual({ kind: "title", text: model.header.siteName });
    expect(wordsOf(top)).toContain(lineText(topLead(model.header)));
  });

  it("has four lines: the site, what the page is, how it came to be, and who made it and where", async () => {
    const model = await demoModel();
    const top = wordTop(model);
    const [, , , about] = top;

    expect(top.map(({ kind }) => kind)).toEqual(["title", "para", "para", "para"]);
    expect(wordsOf(top)).toEqual([
      "127.0.0.1:4848",
      "Screen reader test results",
      "How its pages read aloud with NVDA, a free screen reader, tested on 29 September 2026. voicecap took NVDA through every page, pressing its keys the way a person would. Every word shown here is what NVDA said.",
      "As of 30 September 2026. Made with voicecap. Site address http://127.0.0.1:4848.",
    ]);
    // What the page is, in bold; and the date, in bold, in the last line.
    expect(top[1]).toEqual(para({ text: TOP_TEXT.eyebrow, bold: true }));
    expect(about?.kind === "para" ? boldIn(about.line) : []).toEqual(["30 September 2026"]);
  });

  it("names who prepared it, in bold, only when the records name someone", async () => {
    // The demo runs are from before voicecap recorded who ran a session.
    const demo = wordTop(await demoModel());
    const pats = wordTop(patsModel());
    const [, , , about] = pats;

    expect(wordsOf(demo).join("\n")).not.toContain("Prepared by");
    expect(wordsOf(pats).at(-1)).toBe(
      `As of 30 September 2026. Prepared by Pat Lee. Made with voicecap. Site address ${SITE}.`,
    );
    expect(about?.kind === "para" ? boldIn(about.line) : []).toEqual([
      "30 September 2026",
      "Pat Lee",
    ]);
  });

  it("links voicecap to its page on GitHub, and NVDA to its makers", async () => {
    const model = await demoModel();
    const top = wordTop(model);

    expect(hrefsOf(top)).toEqual([TOP_TEXT.nvAccess, TOP_TEXT.github]);
    expect(linesIn(top).at(-1)).toContainEqual({
      text: "voicecap",
      href: "https://github.com/ICJIA/voicecap",
    });
    // A screen reader other than NVDA is named, and isn't linked to NVDA's makers.
    const other = wordTop({ ...model, header: { ...model.header, screenReader: "VoiceOver" } });
    expect(wordsOf(other)[2]).toContain("How its pages read aloud with VoiceOver, a free");
    expect(hrefsOf(other)).toEqual([TOP_TEXT.github]);
  });

  it("says plainly that no run counts, and still says who made it and where", () => {
    const none = noRunModel();
    const words = wordsOf(wordTop(none));

    expect(none.header.tested).toBeNull();
    expect(words[2]).toContain("No live run counts yet, so there's no test date.");
    expect(words[3]).toBe(`As of 30 September 2026. Made with voicecap. Site address ${SITE}.`);
  });
});

describe("wordSummary", () => {
  it("gives the summary's numbers as a table, each as the model has it", async () => {
    const model = await demoModel();
    const { numbers } = model.summary;
    const rows = wordsOf(wordSummary(model));

    expect(rows).toContain("Number | What it counts");
    expect(rows).toContain(`${numbers.pagesInScope} | pages in scope`);
    expect(rows).toContain(
      `${numbers.transcribed} of ${numbers.pagesInScope} | transcribed by NVDA`,
    );
    expect(rows).toContain(
      `${numbers.listened} of ${numbers.transcribed} | heard live by a person`,
    );
  });

  it("says the six numbers as the page's tiles do: a count, a count out of its total, a time in words", async () => {
    const numbers = tableAt(wordSummary(await demoModel()), 0);

    expect(wordsOf([numbers])).toEqual([
      "Number | What it counts",
      "7 | pages in scope",
      "7 of 7 | transcribed by NVDA",
      "1 | page with flags, 3 rules",
      "0 of 7 | heard live by a person",
      "204 | lines NVDA spoke",
      "12 minutes 34 seconds | of NVDA time, across 2 runs",
    ]);
  });

  it("sets a count's thousands apart, and says a long time in words", async () => {
    const model = withNumbers(await demoModel(), { linesSpoken: 1204, nvdaMs: 7_500_000 });
    const rows = wordsOf(wordSummary(model));

    expect(rows).toContain("1,204 | lines NVDA spoke");
    expect(rows).toContain("2 hours 5 minutes | of NVDA time, across 2 runs");
  });

  it("turns the three bars into tables, with counts and shares", async () => {
    const model = await demoModel();
    const rows = wordsOf(wordSummary(model));
    const { done, flagged, never } = model.summary.bars.results;
    const total = done + flagged + never;

    expect(rows).toContain("Result | Pages | Share");
    expect(rows).toContain(`Without flags | ${done} | ${shareOf(done, total)}`);
    expect(rows).toContain("What | Count | Out of | Share");
  });

  it("ends the summary with a page break, and says the model's sentence first", async () => {
    const model = await demoModel();
    const summary = wordSummary(model);

    expect(summary.at(-1)).toEqual(PAGE_BREAK);
    expect(summary.slice(0, 2)).toEqual([
      heading(1, "Summary"),
      para({ text: model.summary.sentence, bold: true }),
    ]);
    // Then the line on what voicecap and the person each did.
    expect(wordsOf(summary)[2]).toBe(model.summary.second);
  });

  it("says only its sentences when no run counts", () => {
    const none = noRunModel();
    const summary = wordSummary(none);

    expect(summary.map(({ kind }) => kind)).toEqual(["heading", "para", "para"]);
    expect(wordsOf(summary)).toEqual(["Summary", none.summary.sentence, none.summary.second]);
    expect(none.summary.sentence).toContain("No live run counts yet");
  });

  it("sets its parts under their headings, in the page's order", async () => {
    expect(outlineOf(wordSummary(await demoModel()))).toEqual([
      "1 Summary",
      "2 What needs attention",
      "2 How complete the test was",
      "2 What's still to do",
      "2 When and how",
      "2 Every page's latest result",
      "2 Flags by rule",
      "2 The human review",
    ]);
  });

  it("lists each page that needs attention, its name in bold, with what a listener hears", async () => {
    const model = await demoModel();
    const attention = under(wordSummary(model), "What needs attention");

    expect(wordsOf(attention)).toEqual([
      "http://127.0.0.1:4848/how-a-run-works/: the latest run couldn't read it (another window took the screen); its transcripts are from run 2026-09-29_1315.",
      "http://127.0.0.1:4848/common-mistakes/: 3 links say only “click here”; 2 items have no names, so NVDA says only “button” and “edit”; its first heading is level 2, not 1.",
    ]);
    for (const [index, { name, clauses }] of model.summary.attention.entries()) {
      expect(attention[index]).toEqual(para({ text: name, bold: true }, `: ${clauses}.`));
    }
  });

  it("names a page that has nothing to say of it by its name alone", async () => {
    const model = withSummary(await demoModel(), {
      attention: [{ slug: "grants-1", name: "Grants", clauses: "" }],
    });

    expect(under(wordSummary(model), "What needs attention")).toEqual([
      para({ text: "Grants", bold: true }),
    ]);
  });

  it("says no page needs attention when none has flags or an open issue", () => {
    const model = cleanModel();

    expect(model.summary.attention).toEqual([]);
    expect(under(wordSummary(model), "What needs attention")).toEqual([
      para("No page has flags or an open issue."),
    ]);
  });

  it("lists how complete the test was, with the line on the run before last", async () => {
    const model = await demoModel();
    const complete = under(wordSummary(model), "How complete the test was");

    expect(model.summary.changesLine).toBe(
      "Since the last run on 29 September: every page read in full in both runs sounds the same.",
    );
    expect(complete.map(({ kind }) => kind)).toEqual(["list"]);
    expect(wordsOf(complete)).toEqual([...model.summary.complete, model.summary.changesLine]);
  });

  it("leaves out the line on the run before when there is none", () => {
    const model = cleanModel();

    expect(model.summary.changesLine).toBeNull();
    expect(wordsOf(under(wordSummary(model), "How complete the test was"))).toEqual(
      model.summary.complete,
    );
  });

  it("lists what's still to do, and when and how the test was run, each label in bold", async () => {
    const model = await demoModel();
    const summary = wordSummary(model);
    const [whenHow] = under(summary, "When and how");

    expect(under(summary, "What's still to do").map(({ kind }) => kind)).toEqual(["list"]);
    expect(wordsOf(under(summary, "What's still to do"))).toEqual(model.summary.todo);
    expect(wordsOf(under(summary, "When and how"))).toEqual([
      "Date: 29 September 2026",
      "Run by: Not recorded: this run used voicecap 0.4.1.",
      "Screen reader: NVDA 2026.2",
      "Browser: Chrome 154.0.8037.58",
      "Operating system: Windows 11 Pro 25H2 (10.0.26200)",
    ]);
    expect(whenHow?.kind === "list" ? whenHow.items.map(boldIn) : []).toEqual([
      ["Date"],
      ["Run by"],
      ["Screen reader"],
      ["Browser"],
      ["Operating system"],
    ]);
  });

  it("has a row for each kind of result, zeros too, and says when there are no pages to count", async () => {
    const model = await demoModel();
    const results = (done: number, flagged: number, never: number) =>
      withSummary(model, {
        bars: { ...model.summary.bars, results: { done, flagged, never } },
      });

    expect(wordsOf(under(wordSummary(model), "Every page's latest result"))).toEqual([
      "Result | Pages | Share",
      "Without flags | 6 | 86%",
      "With flags | 1 | 14%",
      "Never transcribed | 0 | 0%",
    ]);
    // A page never transcribed is a share of the pages as the other two are.
    expect(wordsOf(under(wordSummary(results(4, 2, 1)), "Every page's latest result"))).toEqual([
      "Result | Pages | Share",
      "Without flags | 4 | 57%",
      "With flags | 2 | 29%",
      "Never transcribed | 1 | 14%",
    ]);
    expect(wordsOf(under(wordSummary(results(0, 0, 0)), "Every page's latest result"))).toEqual([
      "Result | Pages | Share",
      "Without flags | 0 | nothing to count",
      "With flags | 0 | nothing to count",
      "Never transcribed | 0 | nothing to count",
    ]);
  });

  it("has a row for each rule: how many times it was raised, and its share of every flag raised", async () => {
    const model = await demoModel();

    expect(wordsOf(under(wordSummary(model), "Flags by rule"))).toEqual([
      "Rule | Times raised | Share of all flags raised",
      "generic-link-text | 2 | 40%",
      "unlabeled | 2 | 40%",
      "headings | 1 | 20%",
    ]);
  });

  it("says no flags were raised, rather than draw an empty table", () => {
    const model = cleanModel();

    expect(model.summary.bars.flagsByRule).toEqual([]);
    expect(under(wordSummary(model), "Flags by rule")).toEqual([para("No flags were raised.")]);
  });

  it("has the human review as counts out of their totals, so nothing looks complete that isn't", async () => {
    const model = await demoModel();

    expect(wordsOf(under(wordSummary(model), "The human review"))).toEqual([
      "What | Count | Out of | Share",
      "Heard live | 0 | 7 | 0%",
      "Transcripts reviewed | 0 | 7 | 0%",
      "Issues fixed | 0 | 0 | nothing to count",
    ]);
    const some = withSummary(model, {
      bars: {
        ...model.summary.bars,
        review: { listened: [1, 3], reviewed: [3, 3], fixed: [0, 0] },
      },
    });
    expect(wordsOf(under(wordSummary(some), "The human review"))).toEqual([
      "What | Count | Out of | Share",
      "Heard live | 1 | 3 | 33%",
      "Transcripts reviewed | 3 | 3 | 100%",
      "Issues fixed | 0 | 0 | nothing to count",
    ]);
  });

  it("calls the three results what the page's words call them, with a capital", () => {
    const { results } = WORD_TEXT.summary;
    const { resultWords } = SUMMARY_TEXT;

    for (const kind of ["done", "flagged", "never"] as const) {
      expect(results[kind].toLowerCase()).toBe(resultWords[kind]);
      expect(results[kind]).toMatch(/^[A-Z]/);
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

describe("the top, the summary, and how voicecap works together", () => {
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
