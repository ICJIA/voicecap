/**
 * The Word copy's "Every page", "What the flags found", and the appendix of transcripts, as blocks:
 * what they say, in the page's order. The demo runs of 29 September 2026 (voicecap 0.4.1, in
 * test/fixtures/share/) are the real case; runs built in memory cover the rest. The blocks are
 * plain data, so nothing here opens a .docx.
 */
import { describe, expect, it } from "vitest";

import type { FlagResult, RunJson } from "../src/model.js";
import { esc } from "../src/report/html.js";
import { renderAppendix, renderFlags, renderPages } from "../src/share/html/pages.js";
import { lineText, type Line } from "../src/share/line.js";
import type { ShareInput } from "../src/share/load.js";
import { buildShareModel, type PageCard, type ShareModel } from "../src/share/model.js";
import { APPENDIX_TEXT, FLAGS_TEXT, PAGES_TEXT, WORD_TEXT } from "../src/share/text.js";
import { appendixGist, fileFingerprint, flagsGist, pagesGist } from "../src/share/words.js";
import {
  PAGE_BREAK,
  heading,
  mono,
  monoCell,
  para,
  wordsOf,
  type Block,
  type Cell,
} from "../src/share/word/blocks.js";
import { wordAppendix, wordFlags, wordPages } from "../src/share/word/pages.js";
import { failedAttempt, shareRun, type SharePageSpec } from "./helpers/share-data.js";
import {
  demoModel,
  inputOf as inputWithoutTranscripts,
  LINES,
  storeOf,
  TRANSCRIPTS,
} from "./helpers/share-model.js";
import {
  boldIn,
  linesIn,
  outlineOf,
  tableAt,
  tablesIn,
  under,
  type Table,
} from "./helpers/word.js";

/** What the model is built from, for runs built in memory, with their transcripts in memory too. */
function inputOf(runs: RunJson[], overrides: Partial<ShareInput> = {}): ShareInput {
  return inputWithoutTranscripts(runs, { transcripts: storeOf(), ...overrides });
}

/** A page read in full, with its three transcripts, as the runs built here have them. */
function done(pagePath: string, extra: Partial<SharePageSpec> = {}): SharePageSpec {
  return { path: pagePath, title: `Page ${pagePath}`, files: TRANSCRIPTS, passes: LINES, ...extra };
}

/** A page that failed in every attempt, so it was never transcribed. */
const FAILED: SharePageSpec = {
  path: "/failed",
  status: "failed",
  failedAttempts: [failedAttempt({ n: 1 })],
};

/** The model of one run of these pages. */
function modelOf(pages: SharePageSpec[], overrides: Partial<ShareInput> = {}): ShareModel {
  return buildShareModel(inputOf([shareRun({ id: "r1", pages })], overrides));
}

/** A site whose only run was a replay, so no run counts. */
function noRunModel(): ShareModel {
  return buildShareModel(inputOf([shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] })]));
}

/** `total` pages read in full, the first `flagged` of them with flags. */
function manyPages(total: number, flagged: number): ShareModel {
  return modelOf(
    Array.from({ length: total }, (_, index) =>
      done(`/page-${index + 1}`, index < flagged ? { flags: [LINK_FLAG, HEADINGS_FLAG] } : {}),
    ),
  );
}

/** One page whose tab transcript couldn't be read here, so the appendix says so in its place. */
function lostModel(): ShareModel {
  return modelOf([done("/a")], {
    transcripts: storeOf(() => ({ read: LINES.read, headings: LINES.headings })),
  });
}

/** The model with one card changed, for a state the records don't easily make. */
function withCard(model: ShareModel, index: number, patch: Partial<PageCard>): ShareModel {
  return {
    ...model,
    pages: model.pages.map((card, at) => (at === index ? { ...card, ...patch } : card)),
  };
}

const LINK_FLAG: FlagResult = {
  rule: "generic-link-text",
  pass: "read",
  count: 1,
  found: [{ text: "click here", count: 1 }],
  message: 'Generic link text announced 1 time in the read pass: "click here" ×1.',
};

const HEADINGS_FLAG: FlagResult = {
  rule: "headings",
  pass: "headings",
  message: "The first heading is level 2, not 1.",
};

/** A flag that has no line of NVDA's to quote: Tab reached nothing. */
const NO_STOPS_FLAG: FlagResult = {
  rule: "tab-no-stops",
  pass: "tab",
  message: "Tab reached no focusable elements on the page.",
};

/** The three builders' blocks, in the order the Word copy has them. */
function threeSections(model: ShareModel): Block[] {
  return [...wordPages(model), ...wordFlags(model), ...wordAppendix(model)];
}

/** The words of each line of a table's cell: one string for each paragraph the cell has. */
function cellLines(cell: Cell | undefined): string[] {
  return (cell?.lines ?? []).map(lineText);
}

/** The row of a table at a place, counting from 0. */
function rowAt(table: Table, at: number): Cell[] {
  const found = table.rows[at];
  if (found === undefined) throw new Error(`No row at ${at}`);
  return found;
}

/** The pieces of a line that are in the fixed-width font, as their words. */
function monoIn(line: Line): string[] {
  return line.flatMap((piece) => (typeof piece !== "string" && piece.mono ? [piece.text] : []));
}

/** Two runs: the latest no longer lists two pages the earlier had, and labels one of its own. */
function noLongerModel(): ShareModel {
  const earlier = shareRun({
    id: "r1",
    createdAt: "2026-09-25T10:00:00-05:00",
    pages: [done("/"), done("/gone", { label: "Old news" }), done("/moved")],
  });
  const latest = shareRun({
    id: "r2",
    pages: [done("/"), done("/about", { label: "About us" }), done("/contact")],
  });
  return buildShareModel(inputOf([earlier, latest]));
}

/**
 * Pages in each state a page can be in the latest run: read in full and flagged, failed or skipped
 * with an older run's transcripts, and failed or skipped with none.
 */
function everyStateModel(): ShareModel {
  const earlier = shareRun({
    id: "r1",
    createdAt: "2026-09-25T10:00:00-05:00",
    pages: [done("/a"), done("/b"), done("/c")],
  });
  const latest = shareRun({
    id: "r2",
    pages: [
      done("/a", { flags: [LINK_FLAG] }),
      { path: "/b", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
      { path: "/c", status: "skipped" },
      { path: "/new", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
      { path: "/new-skipped", status: "skipped" },
    ],
  });
  return buildShareModel(inputOf([earlier, latest]));
}

describe("wordPages", () => {
  it("opens with its heading and the line on how many pages were read in full, then the pages in one table", async () => {
    const model = await demoModel();
    const pages = wordPages(model);

    expect(pages.slice(0, 2)).toEqual([heading(1, "Every page"), para(...pagesGist(model))]);
    expect(pages.map(({ kind }) => kind)).toEqual(["heading", "para", "table"]);
    expect(wordsOf(pages.slice(0, 2))).toEqual([
      "Every page",
      "7 pages: 6 read in full and 1 failed in the latest run. For each page: its result, the person's review as far as the records show it, and what each pass captured.",
    ]);
  });

  it("has a row for every page, in order, with its result in words", async () => {
    const model = await demoModel();
    const [pages] = wordPages(model).filter((block) => block.kind === "table");

    expect(pages).toMatchObject({
      head: ["No.", "Page", "Result", "Flags", "The person's review", "What each pass captured"],
    });
    expect(pages!.kind === "table" && pages!.rows.length).toBe(model.pages.length);
    for (const card of model.pages) expect(wordsOf([pages!]).join("\n")).toContain(card.statusText);
    // In the page's order, each page by its number. None of the demo's pages has a label, so each
    // is named by its path, as its card is, and not by its whole address.
    const table = tableAt(wordPages(model), 0);
    for (const [index, card] of model.pages.entries()) {
      const [number, page, result] = rowAt(table, index);
      expect(card.labeled).toBe(false);
      expect(cellLines(number)).toEqual([`${index + 1}`]);
      expect(cellLines(page)[0]).toBe(card.path);
      expect(cellLines(result)[0]).toBe(card.statusText);
    }
    expect(table.rows.map((row) => cellLines(row[1])[0])).toEqual([
      "/",
      "/before-you-start/",
      "/how-a-run-works/",
      "/reading-transcripts/",
      "/the-report/",
      "/ask-a-question/",
      "/common-mistakes/",
    ]);
  });

  it("names each page in bold, by its label with its path under it, or by its path when it has none, and gives its title", () => {
    const model = modelOf([
      done("/about", { label: "About us" }),
      done("/contact"),
      done("/team", { label: "https://example.illinois.gov/team-page" }),
    ]);
    const [about, contact, team] = tableAt(wordPages(model), 0).rows.map((row) => row[1]);

    expect(model.pages.map((card) => card.labeled)).toEqual([true, false, true]);
    // A label is the page's name, and its path follows; a page with none is named by its path, as
    // its card is (the site's address is at the top of the copy).
    expect(cellLines(about)).toEqual(["About us", "/about", "Title: Page /about"]);
    expect(cellLines(contact)).toEqual(["/contact", "Title: Page /contact"]);
    // A label that looks like an address is still the page's label.
    expect(cellLines(team)).toEqual([
      "https://example.illinois.gov/team-page",
      "/team",
      "Title: Page /team",
    ]);
    // Only the name, or the path that stands for it, is in bold; a label's path and title aren't.
    expect(about?.lines.map(boldIn)).toEqual([["About us"], [], []]);
    expect(contact?.lines.map(boldIn)).toEqual([["/contact"], []]);
    expect(team?.lines.map(boldIn)).toEqual([["https://example.illinois.gov/team-page"], [], []]);
    expect(about?.mono).toBeUndefined();
    // The whole address of a page with no label isn't in the table.
    expect(wordsOf([tableAt(wordPages(model), 0)]).join("\n")).not.toContain(
      "https://example.illinois.gov/contact",
    );
  });

  it("gives a page's title, says when it wasn't recorded, and leaves it out for a page with none", async () => {
    const model = await demoModel();
    const titleCell = (patch: Partial<PageCard>) =>
      cellLines(rowAt(tableAt(wordPages(withCard(model, 0, patch)), 0), 0)[1]);

    // The demo's runs are from before voicecap recorded titles, and say so in the model's words.
    expect(titleCell({})).toEqual(["/", "Title: Not recorded: this run used voicecap 0.4.1."]);
    expect(titleCell({ title: "Grants | Example Agency" })).toEqual([
      "/",
      "Title: Grants | Example Agency",
    ]);
    expect(titleCell({ title: null })).toEqual(["/"]);
    expect(titleCell({ title: "  " })).toEqual(["/"]);
  });

  it("says the result in words, with a failure and the run an older page's transcripts come from", async () => {
    const model = await demoModel();
    const pages = tableAt(wordPages(model), 0);
    const [first, , failed] = pages.rows;

    expect(model.pages[2]).toMatchObject({ path: "/how-a-run-works/", status: "failed" });
    expect(cellLines(first?.[2])).toEqual(["Transcribed"]);
    expect(cellLines(failed?.[2])).toEqual([
      "Failed in run 2026-09-29_1402 · transcribed in run 2026-09-29_1315",
      "During the headings pass, another window took the screen.",
      "From run 2026-09-29_1315, on 29 September 2026",
    ]);
    // Its older run's counts and time, with the transcripts it shows.
    expect(cellLines(failed?.[5])).toEqual([
      "Read: 18 lines",
      "Headings: 4",
      "Tab stops: 3",
      "Time: 51.5 s",
    ]);
  });

  it("says the screenshot's line last in the result of a page with no entry in the appendix, its label in bold", () => {
    const model = modelOf([FAILED, { path: "/skipped", status: "skipped" }]);
    const pages = tableAt(wordPages(model), 0);
    const [failed, skipped] = model.pages;
    const shot = failed?.screenshot;
    const unrecorded = shot !== undefined && "notRecorded" in shot ? shot.notRecorded : "";

    // Never transcribed, so the appendix has no entry that says it for either.
    expect(model.appendix).toEqual([]);
    expect(unrecorded).toMatch(/^Not recorded: this run used voicecap /);
    expect(cellLines(rowAt(pages, 0)[2])).toEqual([
      "Failed in run r1 · never transcribed",
      failed?.failure ?? "",
      `Screenshot: ${unrecorded}`,
    ]);
    expect(cellLines(rowAt(pages, 1)[2])).toEqual([
      "Skipped in run r1 · never transcribed",
      skipped?.failure ?? "",
      `Screenshot: ${unrecorded}`,
    ]);
    // The label is in bold, as the appendix has it, and the lines before it are plain.
    expect(rowAt(pages, 0)[2]?.lines.map(boldIn)).toEqual([[], [], ["Screenshot:"]]);
    expect(rowAt(pages, 1)[2]?.lines.map(boldIn)).toEqual([[], [], ["Screenshot:"]]);
    // Last, after all the rest the cell says, even for a card the records can't make: one with the
    // run its transcripts are from, and no entry in the appendix.
    const odd = withCard(model, 0, { from: { run: "r0", date: "25 September 2026" } });
    expect(cellLines(rowAt(tableAt(wordPages(odd), 0), 0)[2])).toEqual([
      "Failed in run r1 · never transcribed",
      failed?.failure ?? "",
      "From run r0, on 25 September 2026",
      `Screenshot: ${unrecorded}`,
    ]);
  });

  it("says nothing of the screenshot in the row of a page that has an entry in the appendix, which says it", async () => {
    const model = await demoModel();
    const said = wordsOf(wordAppendix(model)).filter((words) => words.startsWith("Screenshot:"));

    expect(model.appendix).toHaveLength(model.pages.length);
    expect(wordsOf([tableAt(wordPages(model), 0)]).join("\n")).not.toContain("Screenshot");
    expect(said).toHaveLength(7);
  });

  it("says a read that stopped short was transcribed, and not in full", () => {
    const model = modelOf([done("/a"), done("/b", { stopped: { read: "step-cap" } })]);
    const pages = tableAt(wordPages(model), 0);

    expect(cellLines(rowAt(pages, 0)[2])).toEqual(["Transcribed"]);
    expect(cellLines(rowAt(pages, 1)[2])).toEqual([
      "Transcribed; its read stopped at the step limit",
    ]);
    expect(lineText(pagesGist(model))).toContain("1 transcribed but not in full");
  });

  it("names the rules that raised a flag, each once and in the fixed-width font, or says there are none", async () => {
    const model = await demoModel();
    const pages = tableAt(wordPages(model), 0);
    const flagged = rowAt(pages, 6)[3];

    expect(model.pages[6]?.flags).toHaveLength(5);
    // Five flags from three rules: the rules once each, in the order they were raised.
    expect(cellLines(flagged)).toEqual(["generic-link-text", "unlabeled", "headings"]);
    expect(flagged?.lines.map(monoIn)).toEqual([
      ["generic-link-text"],
      ["unlabeled"],
      ["headings"],
    ]);
    expect(flagged?.mono).toBeUndefined();
    // A page with transcripts and no flags says so, in words.
    expect(cellLines(rowAt(pages, 0)[3])).toEqual(["No flags"]);
    expect(cellLines(rowAt(pages, 0)[3])).toEqual([PAGES_TEXT.noFlags]);
  });

  it("says a page's flags are as its run recorded them, not the current rules'", async () => {
    const model = await demoModel();
    const plain = tableAt(wordPages(model), 0);
    const recorded = (index: number) =>
      tableAt(wordPages(withCard(model, index, { flagsAsRecorded: true })), 0);

    expect(cellLines(rowAt(recorded(0), 0)[3])).toEqual(["No flags", "Flags as recorded"]);
    expect(cellLines(rowAt(recorded(6), 6)[3])).toEqual([
      "generic-link-text",
      "unlabeled",
      "headings",
      "Flags as recorded",
    ]);
    // Only its rules are in the fixed-width font; the words that say where they're from are plain.
    expect(rowAt(recorded(6), 6)[3]?.lines.map(monoIn)).toEqual([
      ["generic-link-text"],
      ["unlabeled"],
      ["headings"],
      [],
    ]);
    expect(wordsOf([plain]).join("\n")).not.toContain("Flags as recorded");
  });

  it("never leaves the flags of a page that wasn't read looking like none", () => {
    const never = buildShareModel(
      inputOf([shareRun({ id: "r1", pages: [{ path: "/", status: "failed" }] })]),
    );
    expect(wordsOf(wordPages(never)).join("\n")).toContain("Nothing was read to flag");

    // Each page the latest run couldn't read, with no transcripts of an earlier run to show: no
    // flags to speak of, and no counts. A page with older transcripts has what they say.
    const model = everyStateModel();
    const pages = tableAt(wordPages(model), 0);

    expect(model.pages.map((card) => card.status)).toEqual([
      "flags",
      "failed",
      "skipped",
      "never",
      "skipped",
    ]);
    expect(pages.rows.map((row) => cellLines(row[3]))).toEqual([
      ["generic-link-text"],
      ["No flags"],
      ["No flags"],
      ["Nothing was read to flag"],
      ["Nothing was read to flag"],
    ]);
    expect(WORD_TEXT.pages.nothingToFlag).toBe("Nothing was read to flag");
    // A page with no transcripts has nothing captured: that cell is empty, and its result says why.
    expect(pages.rows.map((row) => row[5]?.lines.length)).toEqual([4, 4, 4, 0, 0]);
    expect(cellLines(rowAt(pages, 3)[2])[0]).toBe("Failed in run r2 · never transcribed");
    expect(cellLines(rowAt(pages, 4)[2])[0]).toBe("Skipped in run r2 · never transcribed");
  });

  it("says the person's review as it is recorded: each chip's words, then each manual session", async () => {
    const model = withCard(await demoModel(), 0, {
      reviewChips: [
        "Heard live by Pat Lee",
        "Reviewed, no issues",
        "Issue found",
        "Fixed",
        "Changed since review",
        "Sam Roe heard part of this session",
      ],
      manual: [
        { at: "25 September 2026", reviewer: "Sam <Roe>" },
        { at: "26 September 2026", reviewer: null },
      ],
    });
    const [first] = tableAt(wordPages(model), 0).rows;

    expect(cellLines(first?.[4])).toEqual([
      "Heard live by Pat Lee",
      "Reviewed, no issues",
      "Issue found",
      "Fixed",
      "Changed since review",
      "Sam Roe heard part of this session",
      "Manual NVDA session, 25 September 2026, by Sam <Roe>",
      "Manual NVDA session, 26 September 2026",
    ]);
  });

  it("leaves the review empty for a page whose records show none, since a copy never says what a person hasn't done", async () => {
    const pages = tableAt(wordPages(await demoModel()), 0);

    expect(pages.rows.map((row) => row[4])).toEqual(pages.rows.map(() => ({ lines: [] })));
    for (const row of pages.rows) expect(row).toHaveLength(pages.head.length);
    expect(wordsOf([pages]).join("\n")).not.toMatch(/Heard live|Reviewed|Issue found/);
    // Not a word about a review nobody made, but the cell is there: a table has no missing cells.
    expect(wordsOf([pages])[1]).toContain(" |  | ");
  });

  it("says what each pass captured, the lines read and the headings and Tab stops found, and how long the page took", async () => {
    const pages = tableAt(wordPages(await demoModel()), 0);

    expect(pages.rows.map((row) => cellLines(row[5]))).toEqual([
      ["Read: 18 lines", "Headings: 2", "Tab stops: 8", "Time: 55.1 s"],
      ["Read: 19 lines", "Headings: 3", "Tab stops: 3", "Time: 51.6 s"],
      ["Read: 18 lines", "Headings: 4", "Tab stops: 3", "Time: 51.5 s"],
      ["Read: 19 lines", "Headings: 3", "Tab stops: 3", "Time: 51.0 s"],
      ["Read: 18 lines", "Headings: 4", "Tab stops: 3", "Time: 51.7 s"],
      ["Read: 21 lines", "Headings: 1", "Tab stops: 7", "Time: 56.9 s"],
      ["Read: 22 lines", "Headings: 4", "Tab stops: 7", "Time: 1 min 2 s"],
    ]);
  });

  it("says 'Not read' for a pass the run didn't read, never 0, and says when the time wasn't recorded", async () => {
    const model = await demoModel();
    const captured = (patch: Partial<PageCard>) =>
      cellLines(rowAt(tableAt(wordPages(withCard(model, 0, patch)), 0), 0)[5]);
    const unrecorded = "Not recorded: this run used voicecap 0.4.1.";

    expect(
      captured({
        counts: { read: 1, headings: null, tab: null },
        timeMs: { notRecorded: unrecorded },
      }),
    ).toEqual(["Read: 1 line", "Headings: Not read", "Tab stops: Not read", `Time: ${unrecorded}`]);
    // Any pass can be the one that wasn't read: the read pass, too.
    expect(captured({ counts: { read: null, headings: 2, tab: 3 } })).toEqual([
      "Read: Not read",
      "Headings: 2",
      "Tab stops: 3",
      "Time: 55.1 s",
    ]);
    // A pass that read nothing is 0: a pass that wasn't read isn't.
    expect(captured({ counts: { read: 0, headings: 0, tab: 0 } })).toEqual([
      "Read: 0 lines",
      "Headings: 0",
      "Tab stops: 0",
      "Time: 55.1 s",
    ]);
    expect(captured({ counts: { read: 1_204, headings: 1_000, tab: 12 } })).toEqual([
      "Read: 1,204 lines",
      "Headings: 1,000",
      "Tab stops: 12",
      "Time: 55.1 s",
    ]);
  });

  it("writes how long a page took as the page does", async () => {
    const model = await demoModel();
    const times: [number, string][] = [
      [0, "0.0 s"],
      [850, "0.9 s"],
      [59_940, "59.9 s"],
      [59_960, "1 min 0 s"],
      [185_000, "3 min 5 s"],
    ];

    for (const [timeMs, said] of times) {
      const captured = cellLines(
        rowAt(tableAt(wordPages(withCard(model, 0, { timeMs })), 0), 0)[5],
      );
      expect(captured.at(-1), said).toBe(`Time: ${said}`);
    }
  });

  it("lists the pages no longer listed after the pages: a heading, its line, and a table", () => {
    const model = noLongerModel();
    const pages = wordPages(model);

    expect(model.noLongerListed.map((page) => page.lastRun)).toEqual(["r1", "r1"]);
    expect(outlineOf(pages)).toEqual(["1 Every page", "2 No longer listed"]);
    expect(pages.map(({ kind }) => kind)).toEqual([
      "heading",
      "para",
      "table",
      "heading",
      "para",
      "table",
    ]);
    expect(wordsOf(under(pages, "No longer listed"))).toEqual([
      "Pages that earlier runs tested and the latest page list no longer has, with what the last run that had each one recorded.",
      "Page | Last run that had it | What it recorded",
      "Old news / https://example.illinois.gov/gone | r1 | Transcribed",
      "https://example.illinois.gov/moved | r1 | Transcribed",
    ]);
    // The name is in bold, with the address beneath it when the name isn't the address.
    const [gone, moved] = tableAt(pages, 1).rows;
    expect(gone?.[0]?.lines.map(boldIn)).toEqual([["Old news"], []]);
    expect(moved?.[0]?.lines.map(boldIn)).toEqual([["https://example.illinois.gov/moved"]]);
    expect(PAGES_TEXT.noLongerListedHead).toEqual(tableAt(pages, 1).head);
  });

  it("has no table of pages no longer listed when none is", async () => {
    const pages = wordPages(await demoModel());

    expect(outlineOf(pages)).toEqual(["1 Every page"]);
    expect(wordsOf(pages).join("\n")).not.toContain("No longer listed");
    expect(wordsOf(wordPages(modelOf([done("/")]))).join("\n")).not.toContain("No longer listed");
  });

  it("says there are no pages when no run counts or the latest run listed none, and draws no table", () => {
    const empty = buildShareModel(inputOf([shareRun({ id: "r1", pages: [] })]));

    for (const model of [noRunModel(), empty]) {
      expect(wordPages(model)).toEqual([heading(1, "Every page"), para(...pagesGist(model))]);
    }
    expect(wordsOf(wordPages(noRunModel()))[1]).toBe(
      "No live run counts yet. There are no pages to show.",
    );
    expect(wordsOf(wordPages(empty))[1]).toBe("The latest run listed no pages.");
  });

  it("folds nothing, whatever the number of pages: a row for each of thirteen, flagged or not", () => {
    const model = manyPages(13, 5);
    const pages = wordPages(model);

    expect(tableAt(pages, 0).rows).toHaveLength(13);
    expect(tableAt(pages, 0).rows.map((row) => cellLines(row[0]))).toEqual(
      Array.from({ length: 13 }, (_, index) => [`${index + 1}`]),
    );
    // One heading, for the section: a page's row is never behind one of its own.
    expect(outlineOf(pages)).toEqual(["1 Every page"]);
  });
});

describe("wordFlags", () => {
  it("opens with its heading and the line on how many pages have flags", async () => {
    const model = await demoModel();
    const flags = wordFlags(model);

    expect(flags.slice(0, 2)).toEqual([
      heading(1, "What the flags found"),
      para(...flagsGist(model)),
    ]);
    expect(wordsOf(flags.slice(0, 2))[1]).toBe(
      "1 page has flags, from 3 rules. Flags point a person to pages worth a closer listen. Each quotes what NVDA actually said.",
    );
  });

  it("quotes what NVDA said for each rule", async () => {
    const model = await demoModel();
    const rows = wordsOf(wordFlags(model));

    expect(rows).toContain("Rule | What NVDA showed | NVDA said");
    for (const { quotes } of model.flagged) {
      for (const { said } of quotes) {
        for (const line of said) expect(rows.join("\n")).toContain(`“${line}”`);
      }
    }
  });

  it("names each flagged page and how many flags it has, then a table of its rules", async () => {
    const model = await demoModel();
    const flags = wordFlags(model);
    const found = under(flags, "http://127.0.0.1:4848/common-mistakes/: 5 flags");

    expect(model.flagged).toHaveLength(1);
    expect(outlineOf(flags)).toEqual([
      "1 What the flags found",
      "2 http://127.0.0.1:4848/common-mistakes/: 5 flags",
    ]);
    expect(found.map(({ kind }) => kind)).toEqual(["table"]);
    expect(wordsOf(found)).toEqual([
      "Rule | What NVDA showed | NVDA said",
      "generic-link-text | 3 links say only “click here”. | “To see how a run works,, link, click here, dot” / “To read about transcripts,, link, click here, dot” / “To learn about the report,, link, click here, dot”",
      "unlabeled | 2 items have no names, so NVDA says only “button” and “edit”. | “button” / “main landmark. edit, blank”",
      "headings | Its first heading is level 2, not 1. | “main landmark, Common mistakes (on purpose), heading, level 2”",
    ]);
    // The page's own heads, in its own words.
    expect(tableAt(flags, 0).head).toEqual(FLAGS_TEXT.head);
  });

  it("sets each rule's name in the fixed-width font, as the page does, and what it found and what NVDA said in plain", async () => {
    const model = await demoModel();
    const [flagged] = model.flagged;
    const table = tableAt(wordFlags(model), 0);

    expect(table.rows.map(([rule]) => rule)).toEqual(
      flagged?.quotes.map(({ rule }) => monoCell(rule)),
    );
    expect(table.rows.map((row) => row[1]?.mono)).toEqual([undefined, undefined, undefined]);
    expect(table.rows.map((row) => row[2]?.mono)).toEqual([undefined, undefined, undefined]);
  });

  it("puts each line NVDA said in curly quotes on a line of its own, in the fixed-width font the page sets it in", async () => {
    const model = await demoModel();
    const [flagged] = model.flagged;
    const table = tableAt(wordFlags(model), 0);

    for (const [index, quote] of (flagged?.quotes ?? []).entries()) {
      const said = rowAt(table, index)[2];
      expect(cellLines(said)).toEqual(quote.said.map((line) => `“${line}”`));
      expect(said?.lines.map(monoIn)).toEqual(quote.said.map((line) => [`“${line}”`]));
      expect(quote.said.length).toBeGreaterThan(0);
    }
    // Three lines for the first rule, two for the next, and one for the last.
    expect(table.rows.map((row) => row[2]?.lines.length)).toEqual([3, 2, 1]);
  });

  it("says there is no line to quote for a rule with none, never an empty quote", () => {
    const model = modelOf([done("/a", { flags: [LINK_FLAG, NO_STOPS_FLAG] })]);
    const [flagged] = model.flagged;
    const table = tableAt(wordFlags(model), 0);

    expect(flagged?.quotes.map((quote) => quote.said.length > 0)).toEqual([true, false]);
    // Tab reaching nothing: what the rule found, and that there is no line to quote.
    expect(wordsOf([table])[2]).toBe(
      "tab-no-stops | Tab reaches nothing on the page. | No line to quote",
    );
    expect(cellLines(rowAt(table, 1)[2])).toEqual([FLAGS_TEXT.noLine]);
    expect(rowAt(table, 1)[2]?.lines.map(monoIn)).toEqual([[]]);
    expect(wordsOf(wordFlags(model)).join("\n")).not.toContain("“”");
  });

  it("counts a page's flags in the singular for one, and a rule once however many passes raised it", () => {
    const one = wordFlags(modelOf([done("/a", { flags: [LINK_FLAG] })]));
    const twice = wordFlags(
      modelOf([done("/a", { flags: [LINK_FLAG, { ...LINK_FLAG, pass: "tab" }] })]),
    );

    expect(outlineOf(one)[1]).toBe("2 https://example.illinois.gov/a: 1 flag");
    expect(outlineOf(twice)[1]).toBe("2 https://example.illinois.gov/a: 2 flags");
    expect(tableAt(twice, 0).rows).toHaveLength(1);
  });

  it("says which run a flagged page's transcripts are from, when it isn't the latest", async () => {
    const model = await demoModel();
    // The failed page, with flags as if its older transcripts had some.
    const how = model.pages[2] as PageCard;
    const older = {
      ...model,
      flagged: [
        {
          card: { ...how, flags: [HEADINGS_FLAG] },
          quotes: [{ rule: "headings", text: "Its first heading is level 2, not 1.", said: [] }],
        },
      ],
    };
    const flags = wordFlags(older);
    const [name] = outlineOf(flags).slice(1);

    expect(name).toBe("2 http://127.0.0.1:4848/how-a-run-works/: 1 flag");
    expect(wordsOf(under(flags, name?.slice(2) ?? ""))[0]).toBe(
      "From run 2026-09-29_1315, on 29 September 2026",
    );
    expect(under(flags, name?.slice(2) ?? "").map(({ kind }) => kind)).toEqual(["para", "table"]);
    // A page read in the latest run says no run.
    expect(wordsOf(wordFlags(model)).join("\n")).not.toContain("From run");
  });

  it("has every flagged page in full, never folded behind a line, however many there are", () => {
    const four = wordFlags(manyPages(5, 4));

    expect(outlineOf(four)).toEqual([
      "1 What the flags found",
      ...[1, 2, 3, 4].map((n) => `2 https://example.illinois.gov/page-${n}: 2 flags`),
    ]);
    expect(tablesIn(four)).toHaveLength(4);
    expect(wordsOf(four).join("\n")).not.toContain("page-5");
    expect(wordsOf(four)[1]).toContain("4 pages have flags, from 2 rules.");
  });

  it("says there are no flags to show: no flags raised, no page with transcripts, no counted run", () => {
    const none = modelOf([done("/a"), done("/b")]);
    const unread = modelOf([FAILED]);

    for (const model of [none, unread, noRunModel()]) {
      expect(wordFlags(model)).toEqual([
        heading(1, "What the flags found"),
        para(...flagsGist(model)),
      ]);
    }
    expect(wordsOf(wordFlags(none))[1]).toBe(
      "No page has flags. Flags point a person to pages worth a closer listen; none was raised.",
    );
    expect(wordsOf(wordFlags(unread))[1]).toBe(
      "No page has transcripts yet. There are no flags to show.",
    );
    expect(wordsOf(wordFlags(noRunModel()))[1]).toBe(
      "No live run counts yet. There are no flags to show.",
    );
  });
});

describe("wordAppendix", () => {
  it("starts the appendix on a new page", async () => {
    const model = await demoModel();
    expect(wordAppendix(model)[0]).toEqual(PAGE_BREAK);
    expect(wordAppendix(model)[1]).toEqual(heading(1, "Appendix: every transcript"));
    // With nothing to show, too.
    expect(wordAppendix(noRunModel())[0]).toEqual(PAGE_BREAK);
  });

  it("says in its first line how many pages and transcripts there are, with no word about opening a page", async () => {
    const model = await demoModel();
    const [, , gist] = wordAppendix(model);

    expect(gist).toEqual(para(...appendixGist(model)));
    expect(wordsOf(gist ? [gist] : [])).toEqual([
      "7 pages, 21 transcripts. What NVDA said on each page, word for word, with each file's fingerprint.",
    ]);
    // The page says to open a page to read them; a copy that folds nothing says no such thing.
    expect(wordsOf(wordAppendix(model)).join("\n")).not.toContain("Open a page");
    // A transcript that couldn't be read: the line says so, and each says so under its page.
    expect(wordsOf(wordAppendix(lostModel()))[1]).toBe(
      "1 page, 2 transcripts. What NVDA said on each page, word for word, with each file's fingerprint. 1 transcript couldn't be read, and says so under its page.",
    );
  });

  it("has each transcript as one fixed-width block, with its fingerprint above it", async () => {
    const model = await demoModel();
    const appendix = wordAppendix(model);
    const files = model.appendix.flatMap((entry) => entry.files);

    expect(appendix.filter((block) => block.kind === "mono")).toHaveLength(
      files.filter((file) => file.lines > 0).length,
    );
    const first = files[0]!;
    // The text is split at its line breaks and nothing is dropped: the model's text is its lines
    // joined by newlines, with no final newline, so a blank last line is a line.
    expect(appendix).toContainEqual(mono(first.text.split(/\r?\n/)));
    expect(wordsOf(appendix)).toContain(lineText(fileFingerprint(first)));
    // Every transcript's lines are its block's lines, in order, with nothing added or lost, and as
    // many as its heading counts.
    for (const file of files) expect(appendix).toContainEqual(mono(file.text.split("\n")));
    expect(
      appendix.flatMap((block) => (block.kind === "mono" ? [block.lines.length] : [])),
    ).toEqual(files.map((file) => file.lines));
    expect(files).toHaveLength(21);
  });

  it("puts the fingerprint right above its transcript, as a paragraph with the fingerprint in the fixed-width font", async () => {
    const model = await demoModel();
    const [file] = model.appendix.flatMap((entry) => entry.files);
    const appendix = wordAppendix(model);
    const [fingerprint, transcript] = under(appendix, "Read transcript of /, 18 lines");

    expect(fingerprint).toEqual(para(...fileFingerprint(file!)));
    expect(fingerprint?.kind === "para" ? monoIn(fingerprint.line) : []).toEqual([file!.sha256]);
    expect(lineText(fileFingerprint(file!))).toBe(
      `The whole file, its header included: 2,306 bytes, SHA-256 ${file!.sha256}`,
    );
    expect(transcript).toEqual(mono(file!.text.split("\n")));
    expect(transcript?.kind === "mono" && transcript.lines).toHaveLength(18);
  });

  it("names each page by its number, its name, and the transcripts it has, and each transcript by its pass, its page, and its lines", async () => {
    const outline = outlineOf(wordAppendix(await demoModel()));

    expect(outline.slice(0, 5)).toEqual([
      "1 Appendix: every transcript",
      "2 1 http://127.0.0.1:4848/: read, headings, and Tab transcripts",
      "3 Read transcript of /, 18 lines",
      "3 Headings transcript of /, 3 lines",
      "3 Tab transcript of /, 9 lines",
    ]);
    // A heading for each page and each of its transcripts: seven pages, three transcripts each.
    expect(outline.filter((heading) => heading.startsWith("2 "))).toHaveLength(7);
    expect(outline.filter((heading) => heading.startsWith("3 "))).toHaveLength(21);
    expect(outline[9]).toBe(
      "2 3 http://127.0.0.1:4848/how-a-run-works/: read, headings, and Tab transcripts",
    );
  });

  it("numbers each page as its row does, and names a transcript's pass and path in its heading", () => {
    const run = shareRun({
      id: "r1",
      pages: [FAILED, done("/read", { label: "The <read> page" })],
    });
    const model = buildShareModel(inputOf([run]));

    // The page that has transcripts is the second page: its row says so, and so does its heading.
    expect(outlineOf(wordAppendix(model))).toEqual([
      "1 Appendix: every transcript",
      "2 2 The <read> page: read, headings, and Tab transcripts",
      "3 Read transcript of /read, 4 lines",
      "3 Headings transcript of /read, 2 lines",
      "3 Tab transcript of /read, 2 lines",
    ]);
  });

  it("names the run a page's transcripts are from, and says its screenshot wasn't recorded", async () => {
    const model = await demoModel();
    const appendix = wordAppendix(model);
    const [home] = model.pages;
    const unrecorded = "Not recorded: this run used voicecap 0.4.1.";
    const first = under(appendix, "1 http://127.0.0.1:4848/: read, headings, and Tab transcripts");
    const failed = under(
      appendix,
      "3 http://127.0.0.1:4848/how-a-run-works/: read, headings, and Tab transcripts",
    );

    expect(home?.screenshot).toEqual({ notRecorded: unrecorded });
    expect(wordsOf(first)).toEqual(["From run 2026-09-29_1402", `Screenshot: ${unrecorded}`]);
    // The page that failed shows an older run's transcripts, and its date.
    expect(wordsOf(failed)).toEqual([
      "From run 2026-09-29_1315, on 29 September 2026",
      `Screenshot: ${unrecorded}`,
    ]);
    // The run's id is in the fixed-width font, and the label of the screenshot is in bold.
    const [origin, shot] = first;
    expect(origin?.kind === "para" ? monoIn(origin.line) : []).toEqual(["2026-09-29_1402"]);
    expect(shot?.kind === "para" ? boldIn(shot.line) : []).toEqual(["Screenshot:"]);
  });

  it("says the screenshot's words as they are, with 'Not recorded' in front of a line that doesn't say so", async () => {
    const model = await demoModel();
    const said = (screenshot: PageCard["screenshot"]) =>
      wordsOf(
        under(
          wordAppendix(withCard(model, 0, { screenshot })),
          "1 http://127.0.0.1:4848/: read, headings, and Tab transcripts",
        ),
      )[1];

    expect(said({ notRecorded: "Not recorded: this run used voicecap 0.4.1." })).toBe(
      "Screenshot: Not recorded: this run used voicecap 0.4.1.",
    );
    // A gap never reads as a pass, as the page's own line makes sure of.
    expect(said({ notRecorded: "this run used voicecap 0.4.1." })).toBe(
      "Screenshot: Not recorded: this run used voicecap 0.4.1.",
    );
    expect(renderAppendix(withCard(model, 0, { screenshot: { notRecorded: "x" } }))).toContain(
      '<p class="not-recorded">Not recorded: x</p>',
    );
    // A recorded screenshot has its words for the picture, which this copy has no place for yet.
    expect(
      said({
        dataUri: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
        alt: "Screenshot of / as tested",
      }),
    ).toBe("Screenshot of / as tested");
  });

  it("names the run only when it knows it", async () => {
    const model = await demoModel();
    const origins = (blocks: Block[]) =>
      blocks.flatMap((block) =>
        block.kind === "para" && lineText(block.line).startsWith("From run")
          ? [lineText(block.line)]
          : [],
      );

    expect(origins(wordAppendix(model))).toHaveLength(7);
    // With no run that counts, the page that failed still names the older run it comes from.
    expect(origins(wordAppendix({ ...model, evidence: [] }))).toEqual([
      "From run 2026-09-29_1315, on 29 September 2026",
    ]);
    // A page with no card has the latest run's, and no screenshot to speak of.
    const bare = wordAppendix({ ...model, pages: [] });
    const home = under(bare, "1 http://127.0.0.1:4848/: read, headings, and Tab transcripts");
    expect(wordsOf(home)).toEqual(["From run 2026-09-29_1402"]);
    expect(outlineOf(bare)[2]).toBe("3 Read transcript of http://127.0.0.1:4848/, 18 lines");
  });

  it("keeps a transcript's words exactly, its markup, its quotes, its blank lines, and all of them", () => {
    const hostile = [
      "</script><script>alert(1)</script>",
      "<b>bold</b> & \"quoted\" 'single' <!-- comment -->",
      "&lt;already escaped&gt; &amp;",
      "",
      "<img src=x onerror=alert(1)>",
    ];
    const model = modelOf([done("/a")], {
      transcripts: storeOf(() => ({
        read: hostile,
        headings: ["", "first", "last"],
        tab: ["<b>"],
      })),
    });
    const appendix = wordAppendix(model);

    // Nothing is escaped (the document holds words, not markup), and a blank line stays one.
    expect(appendix).toContainEqual(mono(hostile));
    expect(appendix).toContainEqual(mono(["", "first", "last"]));
    expect(appendix).toContainEqual(mono(["<b>"]));
    expect(wordsOf(appendix)).toContain("Read transcript of /a, 5 lines");
  });

  it("keeps every line a transcript has, as many as its heading counts, a blank last line too", () => {
    /** The model of one page whose read pass has these lines, and the appendix it makes. */
    const readOf = (lines: string[]) => {
      const model = modelOf([done("/a")], {
        transcripts: storeOf(() => ({ read: lines, headings: LINES.headings, tab: LINES.tab })),
      });
      return { file: model.appendix[0]?.files[0], appendix: wordAppendix(model) };
    };

    // A last line that is blank: the model's text is its lines joined by newlines, so it ends with
    // one, and the block has both lines, as the heading says.
    const two = readOf(["a", ""]);
    expect(two.file).toMatchObject({ text: "a\n", lines: 2 });
    expect(wordsOf(two.appendix)).toContain("Read transcript of /a, 2 lines");
    expect(two.appendix).toContainEqual(mono(["a", ""]));

    // A transcript that is one blank line has one line, not none.
    const one = readOf([""]);
    expect(one.file).toMatchObject({ text: "", lines: 1 });
    expect(wordsOf(one.appendix)).toContain("Read transcript of /a, 1 line");
    expect(one.appendix).toContainEqual(mono([""]));
    expect(wordsOf(one.appendix)).not.toContain(APPENDIX_TEXT.noLines);

    // A blank line first, between, and last, and more than one in a row: all of them, in order.
    for (const lines of [
      ["", ""],
      ["", "a"],
      ["a", "", "b"],
      ["a", "", ""],
      ["", "a", ""],
    ]) {
      const { file, appendix } = readOf(lines);

      expect(file?.lines, JSON.stringify(lines)).toBe(lines.length);
      expect(appendix, JSON.stringify(lines)).toContainEqual(mono(lines));
      expect(wordsOf(appendix)).toContain(`Read transcript of /a, ${lines.length} lines`);
    }
  });

  it("splits a text made by hand at either kind of line break", () => {
    const model = lostModel();
    const [first] = model.appendix.flatMap((entry) => entry.files);
    const blocks = (text: string, lines: number) =>
      wordAppendix({
        ...model,
        appendix: [{ slug: "a", name: "a", files: [{ ...first!, text, lines }], unreadable: [] }],
      }).filter((block) => block.kind === "mono");

    expect(blocks("one\ntwo", 2)).toEqual([mono(["one", "two"])]);
    expect(blocks("one\r\ntwo", 2)).toEqual([mono(["one", "two"])]);
    expect(blocks("one\r\n\r\ntwo", 3)).toEqual([mono(["one", "", "two"])]);
  });

  it("makes one block of each transcript, however many lines it has: a site of 30 pages and 150 lines a pass", () => {
    const lines = (pass: string) =>
      Array.from({ length: 150 }, (_, index) => `${pass} line ${index + 1}`);
    const model = modelOf(
      Array.from({ length: 30 }, (_, index) => done(`/page-${index + 1}`)),
      {
        transcripts: storeOf(() => ({
          read: lines("read"),
          headings: lines("headings"),
          tab: lines("tab"),
        })),
      },
    );
    const appendix = wordAppendix(model);
    const blocks = appendix.filter((block) => block.kind === "mono");

    // A block for each of 90 transcripts, each of 150 lines: never a block for a line.
    expect(blocks).toHaveLength(90);
    expect(blocks.every((block) => block.kind === "mono" && block.lines.length === 150)).toBe(true);
    // Per page: a heading, the origin, the screenshot; then a heading, fingerprint, block a pass.
    expect(appendix.length).toBe(3 + 30 * (1 + 2 + 3 * 3));
    expect(wordsOf(appendix)).toContain("Read transcript of /page-30, 150 lines");
  });

  it("says a transcript with no lines has none, rather than a block with nothing in it", () => {
    const model = modelOf([done("/a")], {
      transcripts: storeOf(() => ({ read: LINES.read, headings: [], tab: LINES.tab })),
    });
    const appendix = wordAppendix(model);
    const empty = under(appendix, "Headings transcript of /a, 0 lines");

    expect(wordsOf(empty)).toEqual([
      "The whole file, its header included: 1 byte, SHA-256 " + "0".repeat(64),
      "This transcript has no lines.",
    ]);
    expect(empty.map(({ kind }) => kind)).toEqual(["para", "para"]);
    expect(wordsOf(empty)[1]).toBe(APPENDIX_TEXT.noLines);
    // The others have theirs.
    expect(appendix.filter((block) => block.kind === "mono")).toEqual([
      mono(LINES.read),
      mono(LINES.tab),
    ]);
  });

  it("counts a transcript of one line in the singular", () => {
    const model = modelOf([done("/a")], {
      transcripts: storeOf(() => ({
        read: ["Only line"],
        headings: LINES.headings,
        tab: LINES.tab,
      })),
    });

    expect(wordsOf(wordAppendix(model))).toContain("Read transcript of /a, 1 line");
  });

  it("says a transcript that couldn't be read couldn't be, in its place, and says nothing of the page's fingerprint check", () => {
    const model = lostModel();
    const appendix = wordAppendix(model);
    const lost = under(appendix, "Tab transcript of /a");

    expect(model.appendix[0]?.unreadable).toEqual(["tab"]);
    expect(wordsOf(lost)).toEqual([
      "This transcript was recorded, but its file couldn't be read here, so it isn't shown.",
    ]);
    expect(lost.map(({ kind }) => kind)).toEqual(["para"]);
    // The others are shown, and this one isn't: two blocks of words.
    expect(appendix.filter((block) => block.kind === "mono")).toEqual([
      mono(LINES.read),
      mono(LINES.headings),
    ]);
    // The page says the same, and goes on to say what its check does with it.
    expect(APPENDIX_TEXT.unreadable).toBe(
      "This transcript was recorded, but its file couldn't be read here, so it isn't shown",
    );
    expect(APPENDIX_TEXT.unreadableCheck).toBe(", and the fingerprint check leaves it out");
    expect(renderAppendix(model)).toContain(
      `<p>${esc(`${APPENDIX_TEXT.unreadable}${APPENDIX_TEXT.unreadableCheck}.`)}</p>`,
    );
    expect(wordsOf(appendix).join("\n")).not.toMatch(/fingerprint check/i);
    // A page that can't be read at all is still a page, with all three said.
    const gone = modelOf([done("/a")], { transcripts: storeOf(() => ({})) });
    const words = wordsOf(wordAppendix(gone));
    expect(words.filter((line) => line === `${APPENDIX_TEXT.unreadable}.`)).toHaveLength(3);
    expect(words[1]).toContain("1 page, no transcripts shown.");
    expect(words[1]).toContain("3 transcripts couldn't be read, and each says so under its page.");
  });

  it("says a page whose record lists no transcript files has none", () => {
    const model = modelOf([done("/a", { files: [] })]);
    const appendix = wordAppendix(model);
    const [card] = model.pages;
    const shot = card?.screenshot;
    const unrecorded = shot !== undefined && "notRecorded" in shot ? shot.notRecorded : "";

    expect(unrecorded).toMatch(/^Not recorded: this run used voicecap /);
    expect(outlineOf(appendix)).toEqual([
      "1 Appendix: every transcript",
      "2 1 https://example.illinois.gov/a: no transcripts",
    ]);
    expect(wordsOf(under(appendix, "1 https://example.illinois.gov/a: no transcripts"))).toEqual([
      "From run r1",
      `Screenshot: ${unrecorded}`,
      "This run's record lists no transcript files for the page.",
    ]);
    expect(appendix.some((block) => block.kind === "mono")).toBe(false);
  });

  it("says there is nothing to show when no page has transcripts, or no run counts", () => {
    const unread = modelOf([FAILED]);

    for (const model of [unread, noRunModel()]) {
      expect(wordAppendix(model)).toEqual([
        PAGE_BREAK,
        heading(1, "Appendix: every transcript"),
        para(...appendixGist(model)),
      ]);
    }
    expect(wordsOf(wordAppendix(unread))[1]).toBe(
      "No transcripts to show. No page has been read in full yet.",
    );
    expect(wordsOf(wordAppendix(noRunModel()))[1]).toBe(
      "No live run counts yet. There are no transcripts to show.",
    );
  });
});

describe("the three sections together", () => {
  /** A page whose address, label, title, and transcripts are all markup, and one never read. */
  const oddModel = (): ShareModel =>
    modelOf(
      [
        done("/a?b=<c>&d='e'", {
          label: '<i>"A"</i>',
          title: "</title><script>alert(1)</script>",
          flags: [LINK_FLAG, NO_STOPS_FLAG],
        }),
        { path: "/b", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
      ],
      {
        transcripts: storeOf(() => ({
          ...LINES,
          read: ['To apply,, link, <script>alert("x")</script> & more'],
        })),
      },
    );

  /** Each model: the demo's, every state a page can be in, and the sites with little to say. */
  const models = async (): Promise<[string, ShareModel][]> => [
    ["the demo's", await demoModel()],
    ["pages in every state", everyStateModel()],
    ["pages no longer listed", noLongerModel()],
    ["thirteen pages", manyPages(13, 5)],
    ["a transcript that can't be read", lostModel()],
    ["a page with no transcript files", modelOf([done("/a", { files: [] })])],
    ["no counted run", noRunModel()],
    ["no transcripts", modelOf([FAILED])],
    ["odd words", oddModel()],
  ];

  it("sets its headings in order: an h1 for each of the three sections, h2 inside, and h3 for a transcript", async () => {
    for (const [name, model] of await models()) {
      const blocks = threeSections(model);
      const levels = blocks.flatMap((block) => (block.kind === "heading" ? [block.level] : []));

      expect(
        levels.filter((level) => level === 1),
        name,
      ).toHaveLength(3);
      expect(levels[0], name).toBe(1);
      for (const [index, level] of levels.entries()) {
        if (index > 0) expect(level - (levels[index - 1] ?? 0), name).toBeLessThanOrEqual(1);
      }
      expect(
        blocks.some((block) => block.kind === "title"),
        name,
      ).toBe(false);
    }
    expect(
      outlineOf(threeSections(await demoModel())).filter((line) => line.startsWith("1 ")),
    ).toEqual(["1 Every page", "1 What the flags found", "1 Appendix: every transcript"]);
  });

  it("never gives a table a heading with no words, since Word flags an empty header cell", async () => {
    for (const [name, model] of await models()) {
      for (const { head, rows } of tablesIn(threeSections(model))) {
        expect(
          head.every((words) => words.trim() !== ""),
          name,
        ).toBe(true);
        // A table has a cell for each heading, in every row.
        for (const row of rows) expect(row, name).toHaveLength(head.length);
      }
    }
  });

  it("has one table of the pages, one for each flagged page, and one of the pages no longer listed", async () => {
    for (const [name, model] of await models()) {
      const expected =
        (model.pages.length > 0 ? 1 : 0) +
        model.flagged.length +
        (model.noLongerListed.length > 0 ? 1 : 0);

      expect(tablesIn(threeSections(model)), name).toHaveLength(expected);
    }
    // The tables of two models, so a count of nothing can't pass for this.
    expect(tablesIn(threeSections(manyPages(13, 5)))).toHaveLength(1 + 5);
    expect(tablesIn(threeSections(noLongerModel()))).toHaveLength(2);
  });

  it("says each page's screenshot once, page by page: in its own row when it has no entry in the appendix, and in its own entry when it has one", async () => {
    const bases: [string, ShareModel][] = [
      ["pages in every state", everyStateModel()],
      ["the demo's", await demoModel()],
      ["no page with transcripts", modelOf([FAILED, { path: "/skipped", status: "skipped" }])],
    ];

    for (const [name, base] of bases) {
      // Each page's own words for its screenshot, so one page's line can't be taken for another's.
      const shots = base.pages.map((card) => `Not recorded: the screenshot of ${card.path}.`);
      const model: ShareModel = {
        ...base,
        pages: base.pages.map((card, at) => ({
          ...card,
          screenshot: { notRecorded: shots[at] ?? "" },
        })),
      };
      const pages = wordPages(model);
      const appendix = wordAppendix(model);
      const everything = wordsOf([...pages, ...appendix]).join("\n");
      const listed = new Set(model.appendix.map(({ slug }) => slug));
      const table = tableAt(pages, 0);

      for (const [index, card] of model.pages.entries()) {
        const where = `${name}, ${card.path}`;
        const line = `Screenshot: ${shots[index]}`;
        const row = cellLines(rowAt(table, index)[2]);
        const inside = "read, headings, and Tab transcripts";

        // Once in the whole copy, and once where this page says it.
        expect(everything.split(line).length - 1, where).toBe(1);
        if (listed.has(card.slug)) {
          expect(row, where).not.toContain(line);
          expect(wordsOf(under(appendix, `${index + 1} ${card.name}: ${inside}`)), where).toContain(
            line,
          );
        } else {
          expect(row.at(-1), where).toBe(line);
        }
      }
      // A line for each page, and no other.
      expect(everything.match(/Screenshot:/g) ?? [], name).toHaveLength(model.pages.length);
    }
  });

  it("links to nothing, since the page's links go to its own parts, which this copy has in order", async () => {
    for (const [name, model] of await models()) {
      for (const line of linesIn(threeSections(model))) {
        expect(
          line.filter((piece) => typeof piece !== "string" && piece.href !== undefined),
          name,
        ).toEqual([]);
      }
    }
  });

  it("says nothing of the page's folds or its fingerprint check, which the Word copy has none of", async () => {
    for (const [name, model] of await models()) {
      // The transcripts are NVDA's words, and any words may be in one.
      const words = wordsOf(threeSections(model).filter((block) => block.kind !== "mono")).join(
        "\n",
      );

      expect(words, name).not.toMatch(/fingerprint check|Open a page|opens to show/i);
    }
  });

  it("never calls voicecap automated, and never says a person listened", async () => {
    for (const [name, model] of await models()) {
      const words = wordsOf(threeSections(model).filter((block) => block.kind !== "mono"));
      for (const line of words) {
        expect(line, name).not.toMatch(/voicecap[^.]*\bautomated\b/i);
        expect(line, name).not.toMatch(/\blistened\b/i);
      }
    }
  });

  it("sets the page's fixed words as the page says them, in each section", async () => {
    const model = await demoModel();
    const lost = lostModel();
    const said = (blocks: Block[]) => wordsOf(blocks).join("\n");

    for (const words of [PAGES_TEXT.title, PAGES_TEXT.noFlags]) {
      expect(said(wordPages(model)), words).toContain(words);
    }
    expect(said(wordPages(noLongerModel()))).toContain(PAGES_TEXT.noLongerListedLead);
    expect(said(wordFlags(model))).toContain(FLAGS_TEXT.title);
    expect(said(wordFlags(model))).toContain(FLAGS_TEXT.head.join(" | "));
    expect(said(wordAppendix(model))).toContain(APPENDIX_TEXT.title);
    expect(said(wordAppendix(lost))).toContain(`${APPENDIX_TEXT.unreadable}.`);
    // The page says each of these in its own headings and lines.
    expect(renderPages(model)).toContain(PAGES_TEXT.title);
    expect(renderFlags(model)).toContain(FLAGS_TEXT.title);
    expect(renderAppendix(model)).toContain(APPENDIX_TEXT.title);
  });

  /** Markup, a quote, and an ampersand: wherever a record's words are said, they stay so. */
  const MARKUP = `<x y="1">&'</x>`;
  const marked = (field: string): string => `${MARKUP}${field}`;

  /**
   * A model with every word a record can supply (the model's strings, in a card, a flag, the pages
   * no longer listed, and the appendix) made of markup, each marked with the field it's in.
   */
  function markupModel(): ShareModel {
    const base = modelOf([done("/a"), done("/b")]);
    const [evidence, ...earlierEvidence] = base.evidence;
    const [first, second] = base.pages;
    if (!first || !second || !evidence) throw new Error("The fixture lost a page or a run.");
    const home: PageCard = {
      ...first,
      name: marked("name-a"),
      labeled: true,
      path: marked("path-a"),
      title: marked("title"),
      statusText: marked("status"),
      reviewChips: [marked("review")],
      manual: [{ at: marked("at"), reviewer: marked("reviewer") }],
      screenshot: { notRecorded: marked("shot") },
      failure: marked("failure"),
      timeMs: { notRecorded: marked("time") },
      flags: [{ rule: marked("flag-a"), message: "m" }],
    };
    const other: PageCard = {
      ...second,
      name: marked("name-b"),
      labeled: false,
      path: marked("path-b"),
      from: { run: marked("run"), date: marked("date") },
      title: { notRecorded: marked("untitled") },
      flags: [{ rule: marked("flag-b"), message: "m" }],
    };
    return {
      ...base,
      pages: [home, other],
      flagged: [
        {
          card: home,
          quotes: [
            { rule: marked("rule-a"), text: marked("text-a"), said: [marked("said-a")] },
            { rule: marked("rule-b"), text: marked("text-b"), said: [] },
          ],
        },
        {
          card: other,
          quotes: [{ rule: marked("rule-c"), text: marked("text-c"), said: [marked("said-c")] }],
        },
      ],
      noLongerListed: [
        {
          name: marked("gone"),
          url: marked("url"),
          lastRun: marked("lastRun"),
          lastStatus: marked("lastStatus"),
        },
      ],
      appendix: [
        {
          slug: home.slug,
          name: marked("entry-a"),
          files: [
            {
              pass: "read",
              run: "r1",
              slug: home.slug,
              name: "read.txt",
              text: marked("words"),
              lines: 1,
              bytes: 9,
              sha256: marked("sha"),
            },
          ],
          unreadable: ["tab"],
        },
        { slug: other.slug, name: marked("entry-b"), files: [], unreadable: [] },
      ],
      evidence: [
        { ...evidence, run: { ...evidence.run, id: marked("latest") } },
        ...earlierEvidence,
      ],
    };
  }

  it("says every word a record supplies, as it is, wherever it's said", () => {
    const words = wordsOf(threeSections(markupModel())).join("\n");
    // No field's name is the start of another's, so each is found by its own words.
    const fields = [
      ...["name-a", "path-a", "title", "status", "review", "at", "reviewer", "shot", "failure"],
      ...["time", "flag-a", "name-b", "path-b", "run", "date", "untitled", "flag-b", "rule-a"],
      ...["text-a", "said-a", "rule-b", "text-b", "rule-c", "text-c", "said-c", "gone", "url"],
      ...["lastRun", "lastStatus", "entry-a", "words", "sha", "entry-b", "latest"],
    ];

    for (const field of fields) expect(words, field).toContain(marked(field));
    // Nothing is escaped: the document holds words, and the library sets each in a run of its own.
    expect(words).not.toContain("&lt;");
    expect(words).not.toContain("&amp;");
    expect(words).not.toContain("&#39;");
  });
});
