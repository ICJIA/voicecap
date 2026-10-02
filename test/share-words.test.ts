/**
 * The sentences of the shareable page as strings and lines with no markup and nothing escaped: the
 * words both copies say. The first half (the top, the summary, "How voicecap works", "Every page",
 * "What the flags found", and the appendix), then the second (what changed since the last run, the
 * problems during the runs, the evidence, the story, and the footer). The demo runs of 29 September
 * 2026 are the real case; runs built in memory cover the rest. Each is also set beside what the page
 * says, so the two can't disagree.
 */
import { describe, expect, it } from "vitest";

import type { AttemptRecord, FlagResult, PassName, RunJson } from "../src/model.js";
import type { Changes, OnlyInOnePage, PageChange, PassChange } from "../src/share/changes.js";
import { renderChanges } from "../src/share/html/changes.js";
import {
  renderCoverage,
  renderEvidence,
  renderFooter,
  renderStory,
} from "../src/share/html/evidence.js";
import { renderAppendix, renderFlags, renderPages } from "../src/share/html/pages.js";
import { renderProblems } from "../src/share/html/problems.js";
import { renderHow, renderTop } from "../src/share/html/top.js";
import { firstSentenceBold, lineText, type Line } from "../src/share/line.js";
import type { ShareInput } from "../src/share/load.js";
import { buildShareModel, type PageCard, type ShareModel } from "../src/share/model.js";
import { KIND_ROWS, type Problem } from "../src/share/problems.js";
import {
  APPENDIX_TEXT,
  CHANGES_TEXT,
  COVERAGE_TEXT,
  EVIDENCE_TEXT,
  FLAGS_TEXT,
  FOOTER_TEXT,
  HOW_LEAD,
  HOW_TEXT,
  ISSUES_URL,
  PAGES_TEXT,
  PASS_TITLE,
  PASS_WORDS,
  PROBLEMS_TEXT,
  STORY,
  STORY_TEXT,
  SUMMARY_TEXT,
  TIMELINE,
  TOP_TEXT,
} from "../src/share/text.js";
import {
  appendixGist,
  changedRules,
  changesGist,
  countsOf,
  decidedFrom,
  evidenceGist,
  fileFingerprint,
  flagsGist,
  flagsLine,
  fromRun,
  generatedLine,
  heardTitle,
  howLead,
  manualLine,
  numbersOf,
  onlyInOneLead,
  originOf,
  pagesGist,
  resultsCaption,
  sentence,
  shareOf,
  sizesOf,
  spokenDuration,
  timelineDay,
  timeOfDay,
  titleOf,
  took,
  topLead,
  transcriptsInside,
  unreadableNote,
  whenOf,
  whereOf,
  whyLine,
} from "../src/share/words.js";
import { failedAttempt, shareRun, type SharePageSpec } from "./helpers/share-data.js";
import { attributes, termsOf, textOf } from "./helpers/share-html.js";
import {
  demoModel,
  inputOf as inputWithoutTranscripts,
  LINES,
  storeOf,
  TRANSCRIPTS,
  type Lines,
} from "./helpers/share-model.js";

const NV_ACCESS = "https://www.nvaccess.org/";

/** What the model is built from, for runs built in memory, with their transcripts held in memory. */
function inputOf(runs: RunJson[], overrides: Partial<ShareInput> = {}): ShareInput {
  return inputWithoutTranscripts(runs, { transcripts: storeOf(), ...overrides });
}

const LINK_FLAG: FlagResult = {
  rule: "generic-link-text",
  pass: "read",
  count: 1,
  found: [{ text: "click here", count: 1 }],
  message: 'Generic link text announced 1 time in the read pass: "click here" ×1.',
};

/** A page read in full, with its three transcripts. */
function done(pagePath: string, extra: Partial<SharePageSpec> = {}): SharePageSpec {
  return {
    path: pagePath,
    title: `Page ${pagePath}`,
    files: TRANSCRIPTS,
    passes: LINES,
    ...extra,
  };
}

/** A page that failed in every attempt. */
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

/** A site whose latest run listed no pages. */
function noPagesModel(): ShareModel {
  return buildShareModel(inputOf([shareRun({ id: "r1", pages: [] })]));
}

/** A page read in full whose Tab transcript can't be read here. */
function lostModel(): ShareModel {
  return modelOf([done("/a")], {
    transcripts: storeOf(() => ({ read: LINES.read, headings: LINES.headings })),
  });
}

/** The model with some of the summary's numbers changed. */
function withNumbers(
  model: ShareModel,
  numbers: Partial<ShareModel["summary"]["numbers"]>,
): ShareModel {
  return {
    ...model,
    summary: { ...model.summary, numbers: { ...model.summary.numbers, ...numbers } },
  };
}

/** The first paragraph of the class in some markup, as the words a reader gets of it. */
function paragraphOf(html: string, className: string): string {
  return textOf(new RegExp(`<p class="${className}">(.*?)</p>`, "s").exec(html)?.[1] ?? "", "");
}

/** The pieces of a line that link out. */
const linksOf = (line: Line) =>
  line.filter((piece) => typeof piece !== "string" && piece.href !== undefined);

describe("the top", () => {
  it("leads with what the page is, with NVDA linked to its makers", async () => {
    const { header } = await demoModel();
    const lead = topLead(header);

    expect(lineText(lead)).toBe(
      "How its pages read aloud with NVDA, a free screen reader, tested on 29 September 2026. voicecap took NVDA through every page, pressing its keys the way a person would. Every word shown here is what NVDA said.",
    );
    expect(linksOf(lead)).toEqual([{ text: "NVDA", href: NV_ACCESS }]);
  });

  it("dates runs that took more than a day as from one day to another", async () => {
    const { header } = await demoModel();

    expect(lineText(topLead({ ...header, tested: "29 to 30 September 2026" }))).toContain(
      "a free screen reader, tested from 29 to 30 September 2026. voicecap took NVDA",
    );
    expect(lineText(topLead({ ...header, tested: "30 September to 2 October 2026" }))).toContain(
      "tested from 30 September to 2 October 2026.",
    );
  });

  it("says what voicecap does, not what it did, when no run counts", () => {
    const { header } = noRunModel();

    expect(header.tested).toBeNull();
    expect(lineText(topLead(header))).toBe(
      "How its pages read aloud with NVDA, a free screen reader. No live run counts yet, so there's no test date. voicecap takes NVDA through every page, pressing its keys the way a person would. Every word shown here is what NVDA said.",
    );
  });

  it("names another screen reader throughout, and links only NVDA to its makers", async () => {
    const { header } = await demoModel();
    const lead = topLead({ ...header, screenReader: "VoiceOver" });

    expect(lineText(lead)).toBe(
      "How its pages read aloud with VoiceOver, a free screen reader, tested on 29 September 2026. voicecap took VoiceOver through every page, pressing its keys the way a person would. Every word shown here is what VoiceOver said.",
    );
    expect(linksOf(lead)).toEqual([]);
  });

  it("says what it's given as it is, never escaped", async () => {
    const { header } = await demoModel();

    expect(lineText(topLead({ ...header, tested: `29 <b> & "x" 2026` }))).toContain(
      `tested on 29 <b> & "x" 2026.`,
    );
  });

  it("is what the page's lead says", async () => {
    for (const model of [await demoModel(), noRunModel()]) {
      expect(lineText(topLead(model.header))).toBe(paragraphOf(renderTop(model), "mast-lead"));
    }
  });
});

describe("the summary's numbers", () => {
  it("are the six, in order, with what each counts", async () => {
    const model = await demoModel();

    expect(numbersOf(model).map(({ label }) => label)).toEqual([
      "pages in scope",
      "transcribed by NVDA",
      expect.stringMatching(/^pages? with flags/),
      "heard live by a person",
      "lines NVDA spoke",
      expect.stringMatching(/^of NVDA time, across 2 runs/),
    ]);
  });

  it("give each its tone and its value, a count out of its total as both", async () => {
    expect(numbersOf(await demoModel())).toEqual([
      { tone: "quiet", value: { count: 7 }, label: "pages in scope" },
      { tone: "ok", value: { part: 7, whole: 7 }, label: "transcribed by NVDA" },
      { tone: "warn", value: { count: 1 }, label: "page with flags, 3 rules" },
      { tone: "quiet", value: { part: 0, whole: 7 }, label: "heard live by a person" },
      { tone: "quiet", value: { count: 204 }, label: "lines NVDA spoke" },
      { tone: "quiet", value: { ms: 754_000 }, label: "of NVDA time, across 2 runs" },
    ]);
  });

  it("word each label in the singular for one", async () => {
    const one = {
      pagesInScope: 1,
      transcribed: 1,
      flagged: 1,
      rules: 1,
      listened: 1,
      linesSpoken: 1,
    };
    const tiles = numbersOf(withNumbers(await demoModel(), one));

    expect(tiles.map(({ label }) => label)).toEqual([
      "page in scope",
      "transcribed by NVDA",
      "page with flags, 1 rule",
      "heard live by a person",
      "line NVDA spoke",
      "of NVDA time, across 2 runs",
    ]);
    expect(tiles.map(({ tone }) => tone)).toEqual(["quiet", "ok", "warn", "ok", "quiet", "quiet"]);
  });

  it("call a count out of its total complete only when it is, and name no rule when none has flags", async () => {
    const some = { pagesInScope: 3, transcribed: 2, flagged: 0, rules: 0, listened: 0 };
    const tiles = numbersOf(withNumbers(await demoModel(), some));

    expect(tiles.map(({ tone }) => tone)).toEqual([
      "quiet",
      "warn",
      "quiet",
      "quiet",
      "quiet",
      "quiet",
    ]);
    expect(tiles[2]?.label).toBe("pages with flags");
    // Nothing in scope is nothing complete.
    const none = numbersOf(
      withNumbers(await demoModel(), { pagesInScope: 0, transcribed: 0, listened: 0 }),
    );
    expect(none.map(({ tone }) => tone).slice(0, 2)).toEqual(["quiet", "quiet"]);
    expect(none[1]?.value).toEqual({ part: 0, whole: 0 });
  });

  it("say how many sessions the NVDA time leaves out, having no recorded end", async () => {
    const label = async (sessionsWithoutEnd: number) =>
      numbersOf(withNumbers(await demoModel(), { sessionsWithoutEnd })).at(-1)?.label;

    expect(await label(0)).toBe("of NVDA time, across 2 runs");
    expect(await label(1)).toBe(
      "of NVDA time, across 2 runs; 1 session without a recorded end isn't counted",
    );
    expect(await label(2)).toBe(
      "of NVDA time, across 2 runs; 2 sessions without a recorded end aren't counted",
    );
  });

  it("have a time of any length in words", () => {
    const times: [number, string][] = [
      [850, "850 milliseconds"],
      [1000, "1 second"],
      [12_000, "12 seconds"],
      [383_000, "6 minutes 23 seconds"],
      [754_000, "12 minutes 34 seconds"],
      [3_900_000, "1 hour 5 minutes"],
      [7_500_000, "2 hours 5 minutes"],
      [183_600_000, "2 days 3 hours"],
    ];

    for (const [ms, said] of times) expect(spokenDuration(ms), said).toBe(said);
  });

  it("give a share as a whole number, or say there's nothing to count", () => {
    expect([shareOf(3, 7), shareOf(0, 0)]).toEqual(["43%", "nothing to count"]);
    expect([shareOf(0, 5), shareOf(5, 5), shareOf(2, 3), shareOf(1, 8)]).toEqual([
      "0%",
      "100%",
      "67%",
      "13%",
    ]);
  });

  it("caption the bar of results with the pages each kind counts, and none that count nothing", () => {
    expect(resultsCaption({ done: 5, flagged: 1, never: 0 })).toBe(
      "5 pages without flags, 1 page with flags",
    );
    expect(resultsCaption({ done: 4, flagged: 2, never: 1 })).toBe(
      "4 pages without flags, 2 pages with flags, 1 page never transcribed",
    );
    expect(resultsCaption({ done: 0, flagged: 0, never: 3 })).toBe("3 pages never transcribed");
    expect(resultsCaption({ done: 0, flagged: 0, never: 0 })).toBe("");
  });
});

describe("how voicecap works", () => {
  it("is the lead, with the words that say the person reads the transcripts in bold", () => {
    const lead = howLead();

    expect(lineText(lead)).toBe(HOW_LEAD);
    expect(lead.filter((piece) => typeof piece !== "string")).toEqual([
      { text: "The person running it reads the transcripts", bold: true },
    ]);
  });

  it("titles the sample with the page, and how many ways through it were heard", async () => {
    const { heard } = await demoModel();
    if (!heard) throw new Error("The demo lost its sample.");
    const first = (passes: number) => ({ page: "/", passes: heard.passes.slice(0, passes) });

    expect(heardTitle(heard)).toBe("Heard on this site: http://127.0.0.1:4848/, three ways");
    expect([1, 2, 3].map((passes) => heardTitle(first(passes)))).toEqual([
      "Heard on this site: /, one way",
      "Heard on this site: /, two ways",
      "Heard on this site: /, three ways",
    ]);
    expect(heardTitle({ ...first(1), page: "<i>Home</i> & more" })).toBe(
      "Heard on this site: <i>Home</i> & more, one way",
    );
  });

  it("is what the page's lead and heading for the sample say", async () => {
    const model = await demoModel();
    const html = renderHow(model);

    expect(paragraphOf(html, "gist")).toBe(lineText(howLead()));
    expect(textOf(/<div class="heard">\s*<h3>(.*?)<\/h3>/s.exec(html)?.[1] ?? "")).toBe(
      model.heard ? heardTitle(model.heard) : "",
    );
  });
});

describe("the opening lines of Every page, What the flags found, and the appendix", () => {
  const OPEN = "Open a page to read them.";

  it("say how many pages were read in full, and how many weren't, the count in bold", async () => {
    const demo = await demoModel();
    const html = /<p class="gist">(.*?)<\/p>/s.exec(renderPages(demo))?.[1] ?? "";

    expect(lineText(pagesGist(demo))).toBe(textOf(html));
    expect(lineText(pagesGist(demo))).toBe(
      "7 pages: 6 read in full and 1 failed in the latest run. For each page: its result, the person's review as far as the records show it, and what each pass captured.",
    );
    expect(pagesGist(demo)[0]).toEqual({
      text: "7 pages: 6 read in full and 1 failed in the latest run.",
      bold: true,
    });
    expect(lineText(pagesGist(modelOf([done("/a")])))).toMatch(/^1 page, read in full\. For each/);
    expect(lineText(pagesGist(modelOf([done("/a"), done("/b")])))).toMatch(
      /^2 pages, all read in full\. For each/,
    );
    expect(lineText(pagesGist(noRunModel()))).toBe(
      "No live run counts yet. There are no pages to show.",
    );
    expect(lineText(pagesGist(noPagesModel()))).toBe("The latest run listed no pages.");
  });

  it("say how many pages have flags, and from how many rules", async () => {
    const flagged = modelOf([done("/a", { flags: [LINK_FLAG] }), done("/b")]);

    expect(lineText(flagsGist(await demoModel()))).toBe(
      "1 page has flags, from 3 rules. Flags point a person to pages worth a closer listen. Each quotes what NVDA actually said.",
    );
    expect(lineText(flagsGist(flagged))).toMatch(/^1 page has flags, from 1 rule\. Flags point/);
    expect(lineText(flagsGist(modelOf([done("/a"), done("/b")])))).toBe(
      "No page has flags. Flags point a person to pages worth a closer listen; none was raised.",
    );
    expect(lineText(flagsGist(modelOf([FAILED])))).toBe(
      "No page has transcripts yet. There are no flags to show.",
    );
    expect(lineText(flagsGist(noRunModel()))).toBe(
      "No live run counts yet. There are no flags to show.",
    );
  });

  it("say how many pages and transcripts there are, and any that couldn't be read", async () => {
    const demo = await demoModel();

    expect(lineText(appendixGist(demo))).toBe(
      "7 pages, 21 transcripts. What NVDA said on each page, word for word, with each file's fingerprint.",
    );
    expect(appendixGist(demo)[0]).toEqual({ text: "7 pages, 21 transcripts.", bold: true });
    expect(lineText(appendixGist(lostModel()))).toBe(
      "1 page, 2 transcripts. What NVDA said on each page, word for word, with each file's fingerprint. 1 transcript couldn't be read, and says so under its page.",
    );
    const gone = modelOf([done("/a")], { transcripts: storeOf(() => ({})) });
    expect(lineText(appendixGist(gone))).toBe(
      "1 page, no transcripts shown. What NVDA said on each page, word for word, with each file's fingerprint. 3 transcripts couldn't be read, and each says so under its page.",
    );
    expect(lineText(appendixGist(modelOf([FAILED])))).toBe(
      "No transcripts to show. No page has been read in full yet.",
    );
    expect(lineText(appendixGist(noRunModel()))).toBe(
      "No live run counts yet. There are no transcripts to show.",
    );
  });

  it("put the sentence the page gives about opening a page where the page has it, and nowhere else", async () => {
    expect(lineText(appendixGist(await demoModel(), OPEN))).toBe(
      "7 pages, 21 transcripts. What NVDA said on each page, word for word, with each file's fingerprint. Open a page to read them.",
    );
    expect(lineText(appendixGist(lostModel(), OPEN))).toBe(
      "1 page, 2 transcripts. What NVDA said on each page, word for word, with each file's fingerprint. Open a page to read them. 1 transcript couldn't be read, and says so under its page.",
    );
    // Nothing to open when there's nothing to show.
    expect(lineText(appendixGist(modelOf([FAILED]), OPEN))).toBe(
      "No transcripts to show. No page has been read in full yet.",
    );
  });

  it("are the first lines of the page's sections, with only the page's own sentence added", async () => {
    const models: [string, ShareModel][] = [
      ["the demo's", await demoModel()],
      ["no counted run", noRunModel()],
      ["no pages", noPagesModel()],
      ["no transcripts", modelOf([FAILED])],
      ["a page read in full", modelOf([done("/a")])],
      ["flags", modelOf([done("/a", { flags: [LINK_FLAG] }), done("/b")])],
      ["a transcript that can't be read", lostModel()],
    ];

    for (const [name, model] of models) {
      expect(paragraphOf(renderPages(model), "gist"), name).toBe(lineText(pagesGist(model)));
      expect(paragraphOf(renderFlags(model), "gist"), name).toBe(lineText(flagsGist(model)));
      expect(paragraphOf(renderAppendix(model), "gist"), name).toBe(
        lineText(appendixGist(model, OPEN)),
      );
    }
  });
});

describe("a card's lines", () => {
  /** The demo's first card (read in the latest run) and its third (read in an earlier one). */
  async function cards(): Promise<[PageCard, PageCard]> {
    const [first, , third] = (await demoModel()).pages;
    if (!first || !third) throw new Error("The demo lost a page.");
    return [first, third];
  }

  it("writes how long a page took as the mockup does", () => {
    const times: [number, string][] = [
      [0, "0.0 s"],
      [850, "0.9 s"],
      [55_114, "55.1 s"],
      [59_940, "59.9 s"],
      [59_960, "1 min 0 s"],
      [61_931, "1 min 2 s"],
      [95_000, "1 min 35 s"],
      [185_000, "3 min 5 s"],
    ];

    for (const [ms, said] of times) expect(took(ms), said).toBe(said);
  });

  it("gives a page's title, the words that say it wasn't recorded, or nothing", async () => {
    const [card] = await cards();

    expect(titleOf({ ...card, title: "Grants | Example Agency" })).toBe(
      "Title: Grants | Example Agency",
    );
    expect(titleOf({ ...card, title: "  Home  " })).toBe("Title: Home");
    expect(titleOf(card)).toBe("Title: Not recorded: this run used voicecap 0.4.1.");
    expect(titleOf({ ...card, title: null })).toBeNull();
    expect(titleOf({ ...card, title: "  " })).toBeNull();
    // As the card has it, never escaped.
    expect(titleOf({ ...card, title: '<b>"Home"</b> & more' })).toBe('Title: <b>"Home"</b> & more');
  });

  it("gives the run an older page's transcripts come from, and the day it was", async () => {
    const [latest, older] = await cards();

    expect(fromRun(older)).toBe("From run 2026-09-29_1315, on 29 September 2026");
    expect(fromRun(latest)).toBeNull();
  });

  it("gives a manual NVDA session, with who imported it when the records say", () => {
    expect(manualLine({ at: "29 September 2026", reviewer: "Pat Lee" })).toBe(
      "Manual NVDA session, 29 September 2026, by Pat Lee",
    );
    expect(manualLine({ at: "29 September 2026", reviewer: null })).toBe(
      "Manual NVDA session, 29 September 2026",
    );
  });

  it("is what the page's cards say", async () => {
    const model = await demoModel();
    const [first, older] = await cards();
    const session = { at: "25 September 2026", reviewer: "Sam Roe" };
    const html = renderPages({
      ...model,
      pages: model.pages.map((card, index) =>
        index === 0 ? { ...card, manual: [session] } : card,
      ),
    });
    const [, firstCard = "", , olderCard = ""] = html.split('<article class="card"');
    const said = (card: string) =>
      [...card.matchAll(/<p class="sub">(.*?)<\/p>/g)].map((found) => textOf(found[1] ?? "", ""));

    expect(said(firstCard)).toEqual([titleOf(first), manualLine(session)]);
    expect(said(olderCard)).toContain(fromRun(older));
  });
});

describe("the appendix's lines", () => {
  it("names the run a page's transcripts are from, with its id in the fixed-width font", async () => {
    const { pages } = await demoModel();
    const [latest, , older] = pages;

    expect(originOf(older, "2026-09-29_1402")).toEqual([
      "From run ",
      { text: "2026-09-29_1315", mono: true },
      ", on 29 September 2026",
    ]);
    expect(originOf(latest, "2026-09-29_1402")).toEqual([
      "From run ",
      { text: "2026-09-29_1402", mono: true },
    ]);
    // A page with no card has the latest run's, and none at all says nothing.
    expect(originOf(undefined, "2026-09-29_1402")).toEqual([
      "From run ",
      { text: "2026-09-29_1402", mono: true },
    ]);
    expect(originOf(latest, null)).toBeNull();
    expect(originOf(undefined, null)).toBeNull();
    expect(lineText(originOf(older, null) ?? [])).toBe(
      "From run 2026-09-29_1315, on 29 September 2026",
    );
  });

  it("names the transcripts a page's fold has, as many as it has", () => {
    const names: [PassName[], string][] = [
      [["read", "headings", "tab"], "read, headings, and Tab transcripts"],
      [["read", "tab"], "read and Tab transcripts"],
      [["headings"], "headings transcript"],
      [[], "no transcripts"],
    ];

    for (const [passes, said] of names) expect(transcriptsInside(passes), said).toBe(said);
  });

  it("gives a transcript's size and fingerprint, the fingerprint in the fixed-width font", async () => {
    const { appendix } = await demoModel();
    const file = appendix[0]?.files[0];
    if (!file) throw new Error("The demo lost a transcript.");
    const line = fileFingerprint(file);

    expect(lineText(line)).toBe(
      `The whole file, its header included: 2,306 bytes, SHA-256 ${file.sha256}`,
    );
    expect(line.at(-1)).toEqual({ text: file.sha256, mono: true });
    expect(lineText(fileFingerprint({ ...file, bytes: 1 }))).toContain(": 1 byte, SHA-256 ");
  });
});

// The second half.

/** The two runs compared are made on these days: "26 September" and "27 September". */
const BEFORE = "2026-09-26T14:05:00-05:00";
const AFTER = "2026-09-27T09:30:00-05:00";

/**
 * What the page says of its folds in the line on the pages that sound different. The page's alone:
 * the Word copy folds nothing, so it gives `changesGist` none.
 */
const OPEN_TO_SEE = "A page that sounds different opens to show what changed.";

/** A page read in full, with the lines of each pass it gives. */
function pageOf(
  pagePath: string,
  passes: Lines,
  extra: Partial<SharePageSpec> = {},
): SharePageSpec {
  return { path: pagePath, files: TRANSCRIPTS, passes, ...extra };
}

/**
 * Two runs of pages, oldest first: the model of what changed from the first to the second. Each
 * page's transcripts are the lines its spec gives, in the run it is in; `readable` says which can be
 * read at all (every one, by default).
 */
function changedModel(
  before: SharePageSpec[],
  after: SharePageSpec[],
  readable: (run: string, pass: PassName) => boolean = () => true,
): ShareModel {
  const specs = [
    { id: "r1", createdAt: BEFORE, pages: before },
    { id: "r2", createdAt: AFTER, pages: after },
  ];
  const runs = specs.map((spec) => shareRun(spec));
  const lines = new Map<string, Lines>();
  specs.forEach((spec, index) => {
    spec.pages.forEach((page, at) => {
      const slug = runs[index]?.pages[at]?.slug;
      if (slug !== undefined) lines.set(`${spec.id}|${slug}`, page.passes ?? {});
    });
  });
  const store = storeOf((slug, run) => lines.get(`${run}|${slug}`) ?? {});
  const transcripts: ShareInput["transcripts"] = {
    txt: (run, slug, pass) => (readable(run, pass) ? store.txt(run, slug, pass) : null),
    steps: (run, slug, pass) => store.steps(run, slug, pass),
  };
  return buildShareModel(inputOf(runs, { transcripts }));
}

/** What the model says changed. */
function changesOf(model: ShareModel): Changes {
  if (model.changes === null) throw new Error("The model has no earlier run to compare with.");
  return model.changes;
}

const NO_FLAG_CHANGES: PageChange["flags"] = {
  resolved: [],
  added: [],
  unchanged: [],
  changed: [],
  uncompared: [],
};

/** A page that sounds different, with the changes a test says. */
function pageChange(extra: Partial<PageChange> = {}): PageChange {
  return {
    key: "a",
    slug: "a",
    url: "https://127.0.0.1:4848/a/",
    passes: [],
    unreadable: [],
    flags: NO_FLAG_CHANGES,
    ...extra,
  };
}

/** A pass that sounds different, with the lines it lost and gained. */
function passChange(pass: PassName, removed: number, added: number): PassChange {
  return { pass, removed, added, lines: [] };
}

/** A flag of a rule, as a page's record has it. */
function flagOf(rule: string, extra: Partial<FlagResult> = {}): FlagResult {
  return { rule, message: `The ${rule} rule found something.`, ...extra };
}

/** The paragraphs of some markup, as the words a reader gets of each. */
function paragraphsOf(html: string): string[] {
  return [...html.matchAll(/<p(?: class="(?:gist|fp-what)")?>(.*?)<\/p>/gs)].map((found) =>
    textOf(found[1] ?? "", ""),
  );
}

describe("the lines of what changed since the last run", () => {
  it("counts the lines a pass lost and gained as a reader says it, never 'and 0 added'", () => {
    const sizes: [removed: number, added: number, words: string][] = [
      [3, 2, "3 lines removed and 2 added"],
      [1, 1, "1 line removed and 1 added"],
      [1, 0, "1 line removed"],
      [0, 2, "2 lines added"],
      [1204, 1, "1,204 lines removed and 1 added"],
      [0, 0, "no lines removed or added"],
    ];

    for (const [removed, added, words] of sizes) expect(sizesOf(removed, added), words).toBe(words);
  });

  it("counts each pass that sounds different, in pass order, and names a pass that can't be read here", () => {
    const page = pageChange({
      passes: [passChange("tab", 1, 0), passChange("read", 3, 2)],
      unreadable: ["headings"],
    });

    expect(countsOf(page)).toBe(
      "read: 3 lines removed and 2 added; headings: couldn't be read here; Tab: 1 line removed",
    );
    expect(countsOf(pageChange({ unreadable: ["read"] }))).toBe("read: couldn't be read here");
    expect(countsOf(pageChange())).toBe("");
  });

  it("names the two runs in the fixed-width font, and counts the pages that sound the same", () => {
    const grants = changesOf(
      changedModel([pageOf("/a/", { read: ["old"] })], [pageOf("/a/", { read: ["new"] })]),
    );
    const mixed = changesOf(
      changedModel(
        [pageOf("/a/", { read: ["old"] }), pageOf("/b/", { read: ["x"] })],
        [pageOf("/a/", { read: ["new"] }), pageOf("/b/", { read: ["x"] })],
      ),
    );
    const calm = changesOf(
      changedModel(
        [pageOf("/a/", { read: ["x"] }), pageOf("/b/", { read: ["x"] })],
        [pageOf("/a/", { read: ["x"] }), pageOf("/b/", { read: ["x"] })],
      ),
    );

    expect(changesGist(grants)).toEqual([
      "Compared: run ",
      { text: "r1", mono: true },
      " (before) and run ",
      { text: "r2", mono: true },
      " (latest).",
    ]);
    expect(lineText(changesGist(mixed) ?? [])).toBe(
      "Compared: run r1 (before) and run r2 (latest). 1 page sounds the same, and is counted, not shown.",
    );
    expect(lineText(changesGist(calm) ?? [])).toBe(
      "Compared: run r1 (before) and run r2 (latest). 2 pages sound the same, and are counted, not shown.",
    );
  });

  it("puts the sentence the page gives about opening a page last, where a page sounds different, and nowhere else", () => {
    const grants = changesOf(
      changedModel([pageOf("/a/", { read: ["old"] })], [pageOf("/a/", { read: ["new"] })]),
    );
    const mixed = changesOf(
      changedModel(
        [pageOf("/a/", { read: ["old"] }), pageOf("/b/", { read: ["x"] })],
        [pageOf("/a/", { read: ["new"] }), pageOf("/b/", { read: ["x"] })],
      ),
    );
    const calm = changesOf(
      changedModel([pageOf("/a/", { read: ["x"] })], [pageOf("/a/", { read: ["x"] })]),
    );
    const none = changesOf(
      changedModel(
        [pageOf("/a/", { read: ["x"] })],
        [{ path: "/a/", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] }],
      ),
    );

    expect(lineText(changesGist(grants, OPEN_TO_SEE) ?? [])).toBe(
      "Compared: run r1 (before) and run r2 (latest). A page that sounds different opens to show what changed.",
    );
    expect(lineText(changesGist(mixed, OPEN_TO_SEE) ?? [])).toBe(
      "Compared: run r1 (before) and run r2 (latest). 1 page sounds the same, and is counted, not shown. A page that sounds different opens to show what changed.",
    );
    // No page sounds different, so none opens.
    expect(lineText(changesGist(calm, OPEN_TO_SEE) ?? [])).toBe(
      "Compared: run r1 (before) and run r2 (latest). 1 page sounds the same, and is counted, not shown.",
    );
    // Nothing was compared, so there is no line, and nothing to open.
    expect(changesGist(none)).toBeNull();
    expect(changesGist(none, OPEN_TO_SEE)).toBeNull();
  });

  it("leads the pages read in only one of the two runs, in the singular for one", () => {
    const page = (reason: OnlyInOnePage["reason"]): OnlyInOnePage => ({
      key: "a",
      url: "https://127.0.0.1:4848/a/",
      reason,
    });

    expect(lineText(onlyInOneLead([page("new")]))).toBe(
      "1 page was read in full in only one of the two runs, so it wasn't compared:",
    );
    expect(lineText(onlyInOneLead([page("new"), page("no longer listed")]))).toBe(
      "2 pages were read in full in only one of the two runs, so they weren't compared:",
    );
    expect(onlyInOneLead([page("new"), page("new")])[0]).toEqual({
      text: "2 pages were read in full in only one of the two runs,",
      bold: true,
    });
  });

  it("names the rules a page's chips say are resolved and new", () => {
    const link = flagOf("generic-link-text", { pass: "read", count: 2 });
    const headings = flagOf("headings", { pass: "headings" });
    const unlabeled = flagOf("unlabeled", { pass: "read", count: 1 });

    expect(
      changedRules({
        ...NO_FLAG_CHANGES,
        resolved: [link],
        added: [headings],
        unchanged: [unlabeled],
      }),
    ).toEqual({ resolved: ["generic-link-text"], fresh: ["headings"] });
    // A rule is named once, however many passes raised it, and in the order the flags have them.
    expect(
      changedRules({
        ...NO_FLAG_CHANGES,
        resolved: [flagOf("a", { pass: "read" }), flagOf("b"), flagOf("a", { pass: "tab" })],
        added: [flagOf("c"), flagOf("d", { pass: "tab" })],
      }),
    ).toEqual({ resolved: ["a", "b"], fresh: ["c", "d"] });
  });

  it("names no rule that a flag still raises, in any pass the runs both read, or one only the later run read", () => {
    const link = (pass: PassName) => flagOf("generic-link-text", { pass, count: 2 });
    const none = { resolved: [], fresh: [] };

    // Its count changed: neither gone nor new.
    expect(
      changedRules({
        ...NO_FLAG_CHANGES,
        changed: [{ before: link("read"), after: { ...link("read"), count: 1 } }],
      }),
    ).toEqual(none);
    // Gone from the read pass, still there in the Tab pass.
    expect(
      changedRules({ ...NO_FLAG_CHANGES, resolved: [link("read")], unchanged: [link("tab")] }),
    ).toEqual(none);
    // Moved from one pass to another.
    expect(
      changedRules({ ...NO_FLAG_CHANGES, resolved: [link("read")], added: [link("tab")] }),
    ).toEqual(none);
    // Gone from a pass both runs read, but a pass only the later run read still raises it.
    expect(
      changedRules({ ...NO_FLAG_CHANGES, resolved: [link("read")], uncompared: [link("tab")] }),
    ).toEqual(none);
    // Already raised in another pass: not new.
    expect(
      changedRules({ ...NO_FLAG_CHANGES, added: [link("tab")], unchanged: [link("read")] }),
    ).toEqual(none);
  });

  it("says each flag between the runs: resolved, then new, then changed, then unchanged, each rule in bold", () => {
    const flags: PageChange["flags"] = {
      resolved: [flagOf("generic-link-text", { pass: "read", count: 2 })],
      added: [flagOf("headings", { pass: "headings" })],
      changed: [],
      unchanged: [flagOf("unlabeled", { pass: "read", count: 1 })],
      uncompared: [],
    };
    const line = flagsLine(flags) ?? [];

    expect(lineText(line)).toBe(
      "Flags: generic-link-text (read pass), 2 before, none now (resolved). headings (headings pass), none before, new. unlabeled (read pass), unchanged.",
    );
    expect(line.filter((piece) => typeof piece !== "string")).toEqual([
      { text: "generic-link-text", bold: true },
      { text: "headings", bold: true },
      { text: "unlabeled", bold: true },
    ]);
    expect(flagsLine(NO_FLAG_CHANGES)).toBeNull();
  });

  it("says a flag changed with both counts, or with what it finds now when it has no count", () => {
    const flags: PageChange["flags"] = {
      ...NO_FLAG_CHANGES,
      changed: [
        {
          before: flagOf("generic-link-text", { pass: "read", count: 2 }),
          after: flagOf("generic-link-text", { pass: "read", count: 1 }),
        },
        {
          before: flagOf("headings", {
            pass: "headings",
            message: "The first heading is level 2, not level 1.",
          }),
          after: flagOf("headings", {
            pass: "headings",
            message: "The first heading is level 3, not level 1.",
          }),
        },
      ],
    };

    expect(lineText(flagsLine(flags) ?? [])).toBe(
      "Flags: generic-link-text (read pass), 2 before, 1 now (changed). headings (headings pass), changed: now its first heading is level 3, not 1.",
    );
  });

  it("says a flag with no count, and one that belongs to the page as a whole, in fewer words", () => {
    const flags: PageChange["flags"] = {
      ...NO_FLAG_CHANGES,
      resolved: [flagOf("tab-no-stops", { pass: "tab" })],
      added: [flagOf("generic-link-text", { pass: "tab", count: 2 })],
      unchanged: [flagOf("repeated-phrase")],
    };

    expect(lineText(flagsLine(flags) ?? [])).toBe(
      "Flags: tab-no-stops (Tab pass), none now (resolved). generic-link-text (Tab pass), none before, 2 now (new). repeated-phrase, unchanged.",
    );
  });

  it("is what the page says: the line on the two runs, the lead on the pages in only one, and each flag", () => {
    const model = changedModel(
      [
        pageOf(
          "/a/",
          { read: ["old"], headings: ["h"] },
          {
            flags: [
              flagOf("generic-link-text", { pass: "read", count: 2 }),
              flagOf("unlabeled", { pass: "read", count: 1 }),
            ],
          },
        ),
        pageOf("/b/", { read: ["x"] }),
      ],
      [
        pageOf(
          "/a/",
          { read: ["new"], headings: ["h"] },
          {
            flags: [
              flagOf("unlabeled", { pass: "read", count: 1 }),
              flagOf("headings", { pass: "headings" }),
            ],
          },
        ),
        pageOf("/b/", { read: ["x"] }),
        pageOf("/c/", { read: ["x"] }),
      ],
    );
    const changes = changesOf(model);
    const [page] = changes.changed;
    if (page === undefined) throw new Error("The page sounds different.");
    const html = renderChanges(model);

    const paragraphs = paragraphsOf(html);
    expect(paragraphs).toContain(lineText(changesGist(changes, OPEN_TO_SEE) ?? []));
    expect(paragraphs).toContain(lineText(onlyInOneLead(changes.onlyInOne)));
    expect(paragraphs).toContain(lineText(flagsLine(page.flags) ?? []));
    expect(html).toContain(`<span class="sub">${countsOf(page)}</span>`);
    const { resolved, fresh } = changedRules(page.flags);
    for (const rule of resolved) {
      expect(html).toContain(
        `<span class="chip c-ok">${rule} ${CHANGES_TEXT.rules.resolved}</span>`,
      );
    }
    for (const rule of fresh) {
      expect(html).toContain(
        `<span class="chip c-warn">${rule} ${CHANGES_TEXT.rules.fresh}</span>`,
      );
    }
  });

  it("is what the page says of a pass that sounds different but can't be read here", () => {
    const model = changedModel(
      [pageOf("/a/", { read: ["old"], tab: ["t old"] })],
      [pageOf("/a/", { read: ["new"], tab: ["t new"] })],
      (run, pass) => !(run === "r2" && pass === "tab"),
    );
    const html = renderChanges(model);
    const [page] = changesOf(model).changed;

    expect(paragraphsOf(html)).toContain(CHANGES_TEXT.unreadable("tab"));
    expect(CHANGES_TEXT.unreadable("tab")).toBe(
      "The Tab pass sounds different, but its transcript couldn't be read here.",
    );
    expect(countsOf(page ?? pageChange())).toBe(
      "read: 1 line removed and 1 added; Tab: couldn't be read here",
    );
  });
});

describe("the lines of the problems during the runs", () => {
  /** The problems of one run in which a page failed, as the attempts say. */
  function problemsOf(...attempts: AttemptRecord[]): Problem[] {
    const page: SharePageSpec = { path: "/grants/", status: "failed", failedAttempts: attempts };
    return buildShareModel(inputOf([shareRun({ id: "r1", pages: [page] })])).problems.problems;
  }

  /** The only problem of a run in which a page failed once. */
  function onlyProblem(): Problem {
    const [problem] = problemsOf(failedAttempt({ n: 1 }));
    if (problem === undefined) throw new Error("The failed attempt is a problem.");
    return problem;
  }

  it("ends a sentence as a sentence does, which voicecap's 'did' lines don't of their own", () => {
    expect(sentence("Tried again (attempt 2)")).toBe("Tried again (attempt 2).");
    expect(sentence("Recorded the page as failed")).toBe("Recorded the page as failed.");
    for (const ended of ["No: read in full on attempt 2.", "Not known?", "Stopped!"]) {
      expect(sentence(ended)).toBe(ended);
    }
  });

  it("gives the time of day in an ISO time, to the millisecond when it has them", () => {
    expect(timeOfDay("2026-09-26T14:05:10.000-05:00")).toBe("14:05:10.000");
    expect(timeOfDay("2026-09-26T14:05:10-05:00")).toBe("14:05:10");
    expect(timeOfDay("not a time")).toBe("not a time");
  });

  it("says how the kind of an older run's problem was decided, which isn't the same for every kind", () => {
    const causes = "this run was recorded before voicecap noted a cause for each failure";

    expect(decidedFrom("unexpected")).toBe(
      `voicecap didn't recognize this error's wording, so it counts as unexpected: ${causes}.`,
    );
    expect(decidedFrom("unreachable")).toBe(
      "From the browser's own network error code in the error's wording.",
    );
    const rest = KIND_ROWS.flatMap(({ kind }) =>
      kind === "stopped" || kind === "unexpected" || kind === "unreachable" ? [] : [kind],
    );
    expect(rest).toHaveLength(6);
    for (const kind of rest) {
      expect(decidedFrom(kind), kind).toBe(
        `From the error's own wording, which voicecap wrote: ${causes}.`,
      );
    }
  });

  it("is what the page says of how an older run's problem was decided", () => {
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.4.1",
      pages: [
        {
          path: "/grants/",
          status: "failed",
          errors: ["read pass: page.goto: Timeout 30000ms exceeded."],
        },
      ],
    });
    const model = buildShareModel(inputOf([run]));
    const [problem] = model.problems.problems;
    const decided = termsOf(renderProblems(model)).find(
      ([term]) => term === PROBLEMS_TEXT.questions.decided,
    );

    expect(problem?.kind).toBe("unexpected");
    expect(decided?.[1]).toBe(decidedFrom(problem?.kind ?? "unexpected"));
  });

  it("says where a problem was: by its attempt, or by its place among the page's when a run didn't number them", () => {
    const problem = onlyProblem();

    expect(whereOf(problem, 1)).toBe("on /grants/ in run r1, attempt 1");
    // Its attempt says it, whatever its place.
    expect(whereOf(problem, 2)).toBe("on /grants/ in run r1, attempt 1");
    expect(whereOf({ ...problem, n: null }, 1)).toBe("on /grants/ in run r1");
    expect(whereOf({ ...problem, n: null }, 2)).toBe("on /grants/ in run r1, problem 2");
  });

  it("is what the page names each problem's boxes by", () => {
    const attempts = [failedAttempt({ n: 1 }), failedAttempt({ n: 2 })];
    const problems = problemsOf(...attempts);
    const page: SharePageSpec = { path: "/grants/", status: "failed", failedAttempts: attempts };
    const model = buildShareModel(inputOf([shareRun({ id: "r1", pages: [page] })]));

    expect(problems).toHaveLength(2);
    expect(attributes(renderProblems(model), "aria-label").slice(0, 2)).toEqual(
      problems.map((problem, at) => `The record of the problem ${whereOf(problem, at + 1)}, table`),
    );
  });
});

describe("the lines of the evidence, the story, and the footer", () => {
  /** A run of the demo, as its record has it. */
  async function demoRun(time: string): Promise<RunJson> {
    const found = (await demoModel()).evidence.find(({ run }) => run.id === `2026-09-29_${time}`);
    if (found === undefined) throw new Error(`The demo has no run at ${time}.`);
    return found.run;
  }

  /** The model with `count` runs in its evidence: its first run's under ids of their own. */
  function withRuns(model: ShareModel, count: number): ShareModel {
    const [first] = model.evidence;
    if (first === undefined) throw new Error("The model has no run.");
    return {
      ...model,
      evidence: Array.from({ length: count }, (_, index) => ({
        ...first,
        run: { ...first.run, id: `r${index + 1}` },
      })),
    };
  }

  /** The model with the first `count` pages marked as having flags as their runs recorded them. */
  function withRecorded(model: ShareModel, count: number): ShareModel {
    return {
      ...model,
      pages: model.pages.map((card, index) =>
        index < count ? { ...card, flagsAsRecorded: true } : card,
      ),
    };
  }

  /** A run of two pages, Home and About, whose transcripts `gone` names can't be read. */
  function unreadableModel(gone: [path: string, pass: PassName][]): ShareModel {
    const run = shareRun({
      id: "r1",
      pages: [
        { path: "/", label: "Home", files: TRANSCRIPTS, passes: LINES },
        { path: "/about/", label: "About", files: TRANSCRIPTS, passes: LINES },
      ],
    });
    const slugOf = (path: string) =>
      run.pages.find((page) => new URL(page.url).pathname === path)?.slug ?? "";
    const keys = new Set(gone.map(([path, pass]) => `${slugOf(path)}|${pass}`));
    const all = storeOf();
    return buildShareModel(
      inputOf([run], {
        transcripts: {
          txt: (id, slug, pass) => (keys.has(`${slug}|${pass}`) ? null : all.txt(id, slug, pass)),
          steps: (id, slug, pass) => all.steps(id, slug, pass),
        },
      }),
    );
  }

  it("opens the evidence with how many runs there are, that each completed and was sealed, and the flag rules' fingerprint", async () => {
    const model = await demoModel();
    const line = evidenceGist(model);

    expect(lineText(line)).toMatch(
      /^2 runs, both completed and sealed\. The flags were computed with the current flag rules, fingerprint [0-9a-f]{64}\.$/,
    );
    expect(line[0]).toEqual({ text: "2 runs, both completed and sealed.", bold: true });
    expect(line.at(-2)).toEqual({ text: model.flagRulesSha256, mono: true });
  });

  it("says it as it reads for one run, two, and more", async () => {
    const demo = await demoModel();
    const first = (runs: number) => lineText(evidenceGist(withRuns(demo, runs)));

    expect(first(1)).toMatch(/^1 run, completed and sealed\. The flags/);
    expect(first(2)).toMatch(/^2 runs, both completed and sealed\. The flags/);
    expect(first(3)).toMatch(/^3 runs, all completed and sealed\. The flags/);
  });

  it("says which pages' flags aren't the current rules', when any are as recorded", async () => {
    const demo = await demoModel();
    const sha = demo.flagRulesSha256;

    expect(lineText(evidenceGist(withRecorded(demo, 1)))).toBe(
      `2 runs, both completed and sealed. The flags were computed with the current flag rules, fingerprint ${sha}, except on 1 page marked “Flags as recorded”, whose transcripts couldn't all be read here: its flags are as its run recorded them.`,
    );
    expect(lineText(evidenceGist(withRecorded(demo, 2)))).toBe(
      `2 runs, both completed and sealed. The flags were computed with the current flag rules, fingerprint ${sha}, except on 2 pages marked “Flags as recorded”, whose transcripts couldn't all be read here: their flags are as their runs recorded them.`,
    );
  });

  it("says there is no evidence when no run counts", () => {
    const none = buildShareModel(
      inputOf([shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] })]),
    );

    expect(lineText(evidenceGist(none))).toBe(
      "No live run counts yet. There is no evidence to show.",
    );
    expect(evidenceGist(none)[0]).toEqual({ text: "No live run counts yet.", bold: true });
  });

  it("names the transcripts the check leaves out, by page, and says nothing when none is", async () => {
    const lost = unreadableModel([
      ["/", "read"],
      ["/", "tab"],
      ["/about/", "headings"],
    ]);
    const one = unreadableModel([["/about/", "headings"]]);

    expect(lineText(unreadableNote(lost) ?? [])).toBe(
      "3 transcripts couldn't be read, so the check leaves them out: Home (read.txt and tab.txt); About (headings.txt).",
    );
    expect(lineText(unreadableNote(one) ?? [])).toBe(
      "1 transcript couldn't be read, so the check leaves it out: About (headings.txt).",
    );
    expect(unreadableNote(lost)?.[0]).toEqual({
      text: "3 transcripts couldn't be read, so the check leaves them out:",
      bold: true,
    });
    expect(unreadableNote(await demoModel())).toBeNull();
  });

  it("is what the page says: the line that opens the evidence, and the transcripts the check leaves out", async () => {
    const lost = unreadableModel([
      ["/", "read"],
      ["/about/", "headings"],
    ]);
    const none = buildShareModel(
      inputOf([shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] })]),
    );

    for (const model of [await demoModel(), lost, withRecorded(await demoModel(), 1), none]) {
      expect(paragraphsOf(renderEvidence(model))).toContain(lineText(evidenceGist(model)));
    }
    expect(paragraphsOf(renderEvidence(lost))).toContain(lineText(unreadableNote(lost) ?? []));
  });

  it("says when a run ran, with the day again for a run that crossed one", async () => {
    const run = await demoRun("1402");

    expect(whenOf(run)).toBe("29 September 2026, 14:02 to 14:09");
    expect(whenOf(await demoRun("1315"))).toBe("29 September 2026, 13:15 to 13:21");
    expect(whenOf({ ...run, completedAt: "2026-10-02T08:30:00-05:00" })).toBe(
      "29 September 2026, 14:02 to 2 October 2026, 08:30",
    );
  });

  it("is what each run's fold says of when it ran", async () => {
    const model = await demoModel();
    const html = renderEvidence(model);

    for (const { run } of model.evidence) {
      expect(html).toContain(`<span class="sub">${whenOf(run)}</span>`);
    }
  });

  it("says when the page was made and how its times are given, with the offsets the runs used", () => {
    const footer = {
      generatedAt: "2026-09-30T09:00:00-05:00",
      fileName: "current.html",
      offsets: ["UTC−05:00"],
    };

    expect(generatedLine(footer)).toBe(
      "Generated on 30 September 2026 at 09:00 (UTC−05:00). Times are as each run recorded them (UTC−05:00).",
    );
    expect(
      generatedLine({
        ...footer,
        generatedAt: "2026-12-01T17:45:00-06:00",
        offsets: ["UTC−05:00", "UTC−06:00"],
      }),
    ).toBe(
      "Generated on 1 December 2026 at 17:45 (UTC−06:00). Times are as each run recorded them (UTC−05:00 and UTC−06:00).",
    );
    // No run counts: no offset to say.
    expect(
      generatedLine({ ...footer, generatedAt: "2026-12-01T17:45:00+01:00", offsets: [] }),
    ).toBe("Generated on 1 December 2026 at 17:45 (UTC+01:00).");
  });

  it("is what the page's footer says of when it was made", async () => {
    const model = await demoModel();

    expect(textOf(renderFooter(model))).toContain(generatedLine(model.footer));
  });

  it("writes the year on a timeline's first date, and again only when it changes", () => {
    expect(timelineDay("2026-09-25", null)).toBe("25 September 2026");
    expect(timelineDay("2026-09-26", "2026")).toBe("26 September");
    expect(timelineDay("2027-01-02", "2026")).toBe("2 January 2027");
  });

  it("is what the page's timeline says of each day", async () => {
    const html = renderStory(await demoModel());
    let lastYear: string | null = null;

    for (const { date } of TIMELINE) {
      if (date === null) continue;
      const found = new RegExp(`<time datetime="${date}">(.*?)</time>`).exec(html);
      expect(found?.[1], date).toBe(timelineDay(date, lastYear));
      lastYear = date.slice(0, 4);
    }
    expect(lastYear).not.toBeNull();
  });

  it("gives why voicecap exists as a line, with the study's headline linked where it quotes it", () => {
    const line = whyLine();

    expect(lineText(line)).toBe(STORY.why);
    expect(line.filter((piece) => typeof piece !== "string")).toEqual([
      { text: STORY.deque.title, href: STORY.deque.url },
    ]);
    expect(line).toHaveLength(3);
  });
});

describe("the section words in text.ts", () => {
  /** Every string in some nested words, however deep. */
  function stringsIn(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(stringsIn);
    if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringsIn);
    return [];
  }

  it("are plain words, with no tag or entity, for each copy to set as it likes", () => {
    const words = stringsIn([
      TOP_TEXT,
      SUMMARY_TEXT,
      HOW_TEXT,
      PAGES_TEXT,
      FLAGS_TEXT,
      APPENDIX_TEXT,
      PASS_TITLE,
      PASS_WORDS,
    ]);

    // Read at all, so a check of nothing can't pass.
    expect(words.length).toBeGreaterThan(40);
    expect(words.filter((string) => /[<>&]/.test(string))).toEqual([]);
  });

  it("name each pass the way a heading and a sentence do", () => {
    expect(PASS_TITLE).toEqual({ read: "Read", headings: "Headings", tab: "Tab" });
    expect(PASS_WORDS).toEqual({ read: "read", headings: "headings", tab: "Tab" });
    // The key each pass presses, in words, for the page and for the Word copy's columns.
    expect(HOW_TEXT.ways).toEqual({
      read: { key: "Down Arrow", words: "line by line" },
      headings: { key: "H", words: "heading by heading" },
      tab: { key: "Tab", words: "control by control" },
    });
  });

  it("are plain words in the second half too, with no tag or entity", () => {
    const words = stringsIn([
      CHANGES_TEXT,
      PROBLEMS_TEXT,
      COVERAGE_TEXT,
      EVIDENCE_TEXT,
      STORY_TEXT,
      FOOTER_TEXT,
      ISSUES_URL,
    ]);

    // Read at all, so a check of nothing can't pass.
    expect(words.length).toBeGreaterThan(50);
    expect(words.filter((string) => /[<>&]/.test(string))).toEqual([]);
  });

  it("say why a page is in only one of the two runs, and the words of a pass's table, as the page does", () => {
    expect(CHANGES_TEXT.reasons).toEqual({
      new: "new, not in the run before",
      "no longer listed": "no longer listed, not in the latest run",
      "failed in one run": "failed in one run, read in full in the other",
      "skipped in one run": "skipped in one run, read in full in the other",
    });
    expect(CHANGES_TEXT.head).toEqual(["Change", "What NVDA said"]);
    expect(CHANGES_TEXT.rows).toEqual({
      same: "Same",
      removed: "Removed",
      added: "Added",
      collapsed: "…",
    });
    expect(CHANGES_TEXT.rules).toEqual({ resolved: "resolved", fresh: "new" });
  });

  it("give a line with something in bold, in code, or linked as data, never as markup", () => {
    expect(CHANGES_TEXT.tools()).toEqual([
      { text: "The tools differ between the two runs,", bold: true },
      " so anything that sounds different may come from the tools rather than the site:",
    ]);
    expect(ISSUES_URL).toBe("https://github.com/ICJIA/voicecap/issues");
    expect(PROBLEMS_TEXT.report()).toEqual([
      "This could be a problem in voicecap itself. Please report it, with this record, at ",
      { text: "github.com/ICJIA/voicecap/issues", href: ISSUES_URL },
      ".",
    ]);
    expect(firstSentenceBold(EVIDENCE_TEXT.fingerprint)[0]).toEqual({
      text: "What's a fingerprint?",
      bold: true,
    });
    const verify = "npx @icjia/voicecap verify --site http://127.0.0.1:4848";
    const proves = EVIDENCE_TEXT.proves(verify);
    expect(lineText(proves)).toBe(
      `What the check proves: this page is consistent with itself, so the transcripts shown are exactly the ones the sealed records list. It can't prove the page itself wasn't changed, since whoever changed it could change the fingerprints too. For that, compare this file's own fingerprint with the one the sender recorded (Get-FileHash <file> in PowerShell, or shasum -a 256 <file> on a Mac, shows it), or run ${verify} on the transcripts folder.`,
    );
    expect(proves.filter((piece) => typeof piece !== "string")).toEqual([
      { text: "What the check proves:", bold: true },
      { text: "Get-FileHash <file>", mono: true },
      { text: "shasum -a 256 <file>", mono: true },
      { text: verify, mono: true },
    ]);
  });

  it("name the problems' questions, and whether a problem happened again, as the page does", () => {
    expect(PROBLEMS_TEXT.questions).toEqual({
      happened: "What happened",
      decided: "How the kind was decided",
      did: "What voicecap did",
      again: "Did it happen again?",
      effect: "Effect on the results",
      report: "Report it",
    });
    expect(PROBLEMS_TEXT.again).toEqual({
      no: "Didn't happen again",
      same: "Happened again",
      different: "Happened again, in different ways",
      unknown: "Not tried again",
    });
    expect(CHANGES_TEXT.unreadable("headings")).toBe(
      "The headings pass sounds different, but its transcript couldn't be read here.",
    );
  });

  it("are the headings and fold lines the page draws for its second half", async () => {
    const model = await demoModel();
    const heading = (html: string, id: string) =>
      textOf(new RegExp(`<h2 id="${id}">(.*?)</h2>`, "s").exec(html)?.[1] ?? "");
    const html = renderStory(model);
    const { timeline } = STORY_TEXT;

    expect(heading(renderChanges(model), "chg-h")).toBe(CHANGES_TEXT.title);
    expect(heading(renderProblems(model), "prob-h")).toBe(PROBLEMS_TEXT.title);
    expect(heading(renderCoverage(model), "lim-h")).toBe(COVERAGE_TEXT.title);
    expect(heading(renderEvidence(model), "ev-h")).toBe(EVIDENCE_TEXT.title);
    expect(heading(html, "story-h")).toBe(STORY_TEXT.title);
    expect(textOf(html)).toContain(`${STORY_TEXT.rest.title} ${STORY_TEXT.rest.inside}`);
    expect(textOf(html)).toContain(STORY_TEXT.worth);
    expect(html).toContain(`<caption>${timeline.caption}</caption>`);
    expect(html).toContain(
      `<thead><tr><th scope="col">${timeline.when}</th><th scope="col"><span class="plat pc">${timeline.pc.name}</span>, ${timeline.pc.reader}</th><th scope="col"><span class="plat mac">${timeline.mac.name}</span>, ${timeline.mac.reader}</th></tr></thead>`,
    );
    expect(textOf(renderFooter(model))).toContain(`${FOOTER_TEXT.file} ${model.footer.fileName}`);
  });
});
