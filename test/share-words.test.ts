/**
 * The sentences of the page's first half (the top, the summary, "How voicecap works", "Every page",
 * "What the flags found", and the appendix) as strings and lines with no markup and nothing escaped:
 * the words both copies say. The demo runs of 29 September 2026 are the real case; runs built in
 * memory cover the rest. Each is also set beside what the page says, so the two can't disagree.
 */
import { describe, expect, it } from "vitest";

import type { FlagResult, PassName, RunJson } from "../src/model.js";
import { renderAppendix, renderFlags, renderPages } from "../src/share/html/pages.js";
import { renderHow, renderTop } from "../src/share/html/top.js";
import { lineText, type Line } from "../src/share/line.js";
import type { ShareInput } from "../src/share/load.js";
import { buildShareModel, type PageCard, type ShareModel } from "../src/share/model.js";
import {
  APPENDIX_TEXT,
  FLAGS_TEXT,
  HOW_LEAD,
  HOW_TEXT,
  PAGES_TEXT,
  PASS_TITLE,
  PASS_WORDS,
  SUMMARY_TEXT,
  TOP_TEXT,
} from "../src/share/text.js";
import {
  appendixGist,
  fileFingerprint,
  flagsGist,
  fromRun,
  heardTitle,
  howLead,
  manualLine,
  numbersOf,
  originOf,
  pagesGist,
  resultsCaption,
  shareOf,
  spokenDuration,
  titleOf,
  took,
  topLead,
  transcriptsInside,
} from "../src/share/words.js";
import { failedAttempt, shareRun, type SharePageSpec } from "./helpers/share-data.js";
import { textOf } from "./helpers/share-html.js";
import {
  demoModel,
  inputOf as inputWithoutTranscripts,
  LINES,
  storeOf,
  TRANSCRIPTS,
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
});
