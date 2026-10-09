/**
 * The Word copy's "Every page", as blocks: each page with its picture, its status, the lines NVDA
 * said first, what axe found, and its three transcripts, in the page's order. The demo runs of 29
 * September 2026 (voicecap 0.4.1, in test/fixtures/share/) are the real case; runs built in memory
 * cover the rest. The blocks are plain data, so nothing here opens a .docx but the test of axe's
 * words as the file holds them.
 */
import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";

import { MAX_NODES } from "../src/axe/results.js";
import type { AxeRecord, FlagResult, RunJson } from "../src/model.js";
import { esc } from "../src/report/html.js";
import {
  axeCriteria,
  axeFix,
  axeRulePage,
  axeRulesRun,
  axeSelector,
  axeSharedFix,
  axeViewOf,
  type AxeView,
  type AxeViewRule,
} from "../src/share/axe-view.js";
import { renderWordCopy } from "../src/share/docx.js";
import { renderPages } from "../src/share/html/pages.js";
import { lineText, type Line } from "../src/share/line.js";
import type { ShareInput } from "../src/share/load.js";
import { buildShareModel, type PageCard, type ShareModel } from "../src/share/model.js";
import { APPENDIX_TEXT, AXE_TEXT, PAGES_TEXT, STORY, WORD_TEXT } from "../src/share/text.js";
import { axeFingerprint, byteCount, fileFingerprint, pagesGist } from "../src/share/words.js";
import {
  heading,
  image,
  leadIn,
  list,
  mono,
  para,
  wordsOf,
  type Block,
} from "../src/share/word/blocks.js";
import { wordOutline } from "../src/share/word/outline.js";
import { wordPages } from "../src/share/word/pages.js";
import { NO_SPEECH } from "../src/transcripts/format.js";
import { fileHash } from "../src/transcripts/write.js";
import { keptWithNext, linksOf, paragraphsOf, unzipDocx } from "./helpers/docx.js";
import { TINY_JPEG, TINY_RECORD } from "./helpers/jpeg.js";
import { rawNode, rawRule } from "./helpers/raw-axe.js";
import { failedAttempt, shareRun, type SharePageSpec } from "./helpers/share-data.js";
import { textOf } from "./helpers/share-html.js";
import {
  AXE_RAN_AT,
  axeFilesOf,
  demoModel,
  inputOf as inputWithoutTranscripts,
  keptAxe,
  LINES,
  picturesOf,
  storeOf,
  TRANSCRIPTS,
  withoutReadTxt,
} from "./helpers/share-model.js";
import {
  boldIn,
  hrefsOf,
  linesIn,
  outlineOf,
  partsAt,
  tableAt,
  tablesIn,
  under,
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

/** One page whose tab transcript couldn't be read here, so its blocks say so in its place. */
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

/** The pieces of a line that are in the fixed-width font, as their words. */
function monoIn(line: Line): string[] {
  return line.flatMap((piece) => (typeof piece !== "string" && piece.mono ? [piece.text] : []));
}

/**
 * The blocks of each page of the section, one list for each, from its heading 2 to the next page's:
 * its heading, its screenshot, its status, the lines NVDA said first, and its transcripts. The
 * pages no longer listed, which follow them, are not among them.
 */
function pagePartsOf(blocks: Block[], model: ShareModel): Block[][] {
  return partsAt(blocks, 2).slice(0, model.pages.length);
}

/** One page's blocks: the page at a place among the model's pages, counting from 0. */
function pageAt(model: ShareModel, at: number): Block[] {
  const found = pagePartsOf(wordPages(model), model)[at];
  if (found === undefined) throw new Error(`No page at ${at}`);
  return found;
}

/**
 * The line that says a page's title, status, flags, and review, in one paragraph: the one after its
 * screenshot, which a picture comes between when the page has one.
 */
function statusOf(part: Block[]): Line {
  const block = part[part[2]?.kind === "image" ? 3 : 2];
  if (block?.kind !== "para") throw new Error("A page has no paragraph of its status.");
  return block.line;
}

/** The words of a page's status paragraph. */
function statusWords(part: Block[]): string {
  return lineText(statusOf(part));
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

// What axe found.

/** WCAG 2.0 A 4.1.2: what button-name tests. */
const NAME_ROLE = ["cat.name-role-value", "wcag2a", "wcag412", "section508", "ACT"];
/** WCAG 2.0 AA 1.4.3: color-contrast. */
const CONTRAST = ["cat.color", "wcag2aa", "wcag143", "EN-301-549"];
/** A best practice, which names no WCAG criterion. */
const BEST = ["cat.keyboard", "best-practice"];

/** axe's words on how to fix an element that has no text, as rawNode gives them. */
const NO_TEXT = "Element does not have text that is visible to screen readers";

/**
 * What axe found on /about/: three issues and one to review, given in axe's order, which isn't the
 * order of how much each matters. button-name found two elements, whose words on how to fix them
 * differ; each of the others found one.
 */
const aboutAxe = () =>
  keptAxe({
    violations: [
      rawRule("region", {
        impact: "moderate",
        tags: BEST,
        help: "All page content should be contained by landmarks",
        nodes: [rawNode("#promo", { html: '<div id="promo">Grants</div>' })],
      }),
      rawRule("button-name", {
        impact: "critical",
        tags: NAME_ROLE,
        help: "Buttons must have discernible text",
        nodes: [
          rawNode("#menu", {
            html: '<button id="menu"></button>',
            failureSummary:
              "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n\nFix all of the following:\n  Element is in tab order and does not have accessible text",
          }),
          rawNode("#search", { html: '<button id="search"><svg></svg></button>' }),
        ],
      }),
      rawRule("color-contrast", {
        impact: "serious",
        tags: CONTRAST,
        help: "Elements must meet minimum color contrast ratio thresholds",
        nodes: [rawNode(".pale", { html: '<p class="pale">Apply by 1 May</p>' })],
      }),
    ],
    incomplete: [
      rawRule("color-contrast", {
        impact: "serious",
        tags: CONTRAST,
        help: "Elements must meet minimum color contrast ratio thresholds",
        nodes: [
          rawNode(".hero h2", {
            html: "<h2>Welcome</h2>",
            failureSummary:
              "Fix any of the following:\n  Element's background color could not be determined due to a background image",
          }),
        ],
      }),
    ],
    passes: 41,
    inapplicable: 50,
  });

/** A run of voicecap 0.16.0, the first to check pages with axe, of these pages. */
function axeRunOf(pages: SharePageSpec[], voicecapVersion = "0.16.0"): RunJson {
  return shareRun({ id: "r1", voicecapVersion, pages });
}

/** The model of a run, with its transcripts and the axe files keptAxe made of its records. */
function axeModelOf(run: RunJson): ShareModel {
  return buildShareModel(inputOf([run], { axeFiles: axeFilesOf([run]) }));
}

/**
 * Pages in each state their axe results can be in: checked, with issues and things to review;
 * checked, with none; and one axe couldn't check.
 */
function axeResultsModel(): ShareModel {
  return axeModelOf(
    axeRunOf([
      done("/about/", { axe: aboutAxe().record }),
      done("/clean", { axe: keptAxe({ passes: 30, inapplicable: 60 }).record }),
      done("/error", { axe: { error: "timed out after 20s", ranAt: AXE_RAN_AT } }),
    ]),
  );
}

/** Every character XML 1.0 forbids: a Word file with one in it is no XML, and opens in nothing. */
const FORBIDDEN = /[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/u;

/** The addresses the report links to outside itself, whatever a run's pages hold. */
const REPORT_LINKS = new Set([
  "https://github.com/ICJIA/voicecap",
  "https://github.com/ICJIA/voicecap/issues",
  "https://www.nvaccess.org/",
  STORY.deque.url,
]);

/**
 * The words of a card's axe results that its fold and the Word copy both say, in the order both say
 * them: what axe is, its version, the counts' labels, the issues' heading, then each issue's name,
 * impact, criteria, axe's words on how to fix its elements (once for the rule, or with each
 * element), each element's labels and its selector and HTML, how many more there were, and the words
 * of its link; what needs review, the same; and the file's fingerprint.
 */
function anchorsOf({ view, bytes, sha256 }: Extract<PageCard["axe"], { view: AxeView }>): string[] {
  const fix = (summary: string): string[] =>
    axeFix(summary).flatMap(({ lead, items }) => [lead, ...items]);
  const rule = (each: AxeViewRule): string[] => {
    const shared = axeSharedFix(each);
    const criteria = axeCriteria(each.tags);
    return [
      each.help || each.id,
      AXE_TEXT.impact(each.impact),
      ...(criteria === "" ? [] : [criteria]),
      ...(shared === null ? [] : [AXE_TEXT.fixShared(each.nodes.length), ...fix(shared)]),
      ...each.nodes.flatMap(({ target, html, failureSummary }) => [
        AXE_TEXT.element,
        axeSelector(target),
        AXE_TEXT.html,
        html,
        ...(shared !== null || fix(failureSummary).length === 0
          ? []
          : [AXE_TEXT.fix, ...fix(failureSummary)]),
      ]),
      ...(each.moreNodes > 0 ? [AXE_TEXT.more(each.moreNodes)] : []),
      ...(axeRulePage(each.helpUrl) === null ? [] : [AXE_TEXT.rulePage(each.id)]),
    ];
  };
  return [
    AXE_TEXT.what,
    AXE_TEXT.version(view.axeVersion, axeRulesRun(view.tags)),
    ...Object.values(AXE_TEXT.counts),
    AXE_TEXT.issues.title,
    AXE_TEXT.issues.after,
    ...view.violations.flatMap(rule),
    AXE_TEXT.review,
    AXE_TEXT.reviewLead,
    ...view.incomplete.flatMap(rule),
    `axe.json: ${byteCount(bytes)}, SHA-256 ${sha256}`,
  ];
}

/** What a card says in place of axe's results, which it has none of. */
function reasonOf(card: PageCard | undefined): string {
  const axe = card?.axe;
  if (axe === undefined || !("notRecorded" in axe)) {
    throw new Error("The card shows axe's results, or says nothing of axe.");
  }
  return axe.notRecorded;
}

/**
 * What a page's blocks say of axe: from the bold label that heads it up to the run its transcripts
 * are from (or the first transcript's heading, or the end of the page), which it comes before. None
 * for a page that says nothing of axe.
 */
function axePartOf(part: Block[]): Block[] {
  const start = part.findIndex(
    (block) => block.kind === "para" && lineText(block.line) === AXE_TEXT.title,
  );
  if (start === -1) return [];
  const end = part.findIndex(
    (block, at) =>
      at > start &&
      (block.kind === "heading" ||
        (block.kind === "para" && lineText(block.line).startsWith("From run"))),
  );
  return part.slice(start, end === -1 ? part.length : end);
}

describe("wordPages", () => {
  it("opens with its heading and the line on how many pages were read in full, then a heading 2 for each page", async () => {
    const model = await demoModel();
    const pages = wordPages(model);

    expect(pages.slice(0, 2)).toEqual([heading(1, "Every page"), para(...pagesGist(model))]);
    expect(wordsOf(pages.slice(0, 2))).toEqual([
      "Every page",
      "7 pages: 6 read in full and 1 failed in the latest run. For each page: its result, the person's review as far as the records show it, and what each pass captured.",
    ]);
    // No table of the pages: each page has blocks of its own, in the latest run's order.
    expect(tablesIn(pages)).toEqual([]);
    expect(outlineOf(pages).filter((each) => each.startsWith("2 "))).toEqual([
      "2 1 /",
      "2 2 /before-you-start/",
      "2 3 /how-a-run-works/",
      "2 4 /reading-transcripts/",
      "2 5 /the-report/",
      "2 6 /ask-a-question/",
      "2 7 /common-mistakes/",
    ]);
  });

  it("gives the home page its heading, its picture, what NVDA said first, and its three transcripts, in that order", () => {
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.11.0",
      pages: [done("/", { screenshot: { ...TINY_RECORD, width: 632, height: 419 } })],
    });
    const model = buildShareModel(inputOf([run], { screenshots: picturesOf([run]) }));
    const [home] = pagePartsOf(wordPages(model), model);
    const files = model.appendix[0]?.files ?? [];

    expect(home?.map(({ kind }) => kind)).toEqual([
      "heading",
      "para",
      "image",
      "para",
      "para",
      "list",
      // What axe found: its label, and why there's nothing (this run is from before 0.16.0).
      "para",
      "para",
      "para",
      ...["heading", "para", "mono"],
      ...["heading", "para", "mono"],
      ...["heading", "para", "mono"],
    ]);
    expect(home?.[0]).toEqual(heading(2, "1 /"));
    // Its picture, at the size its record gives, after the label that names it.
    expect(home?.[1]).toEqual(para({ text: "Screenshot:", bold: true }));
    expect(home?.[2]).toEqual(
      image({
        jpeg: TINY_JPEG,
        width: 632,
        height: 419,
        alt: "The page https://example.illinois.gov/ as it loaded, before NVDA read it",
      }),
    );
    // What NVDA said first: a label, and the three lines in curly quotes, as the page has them.
    expect(model.pages[0]?.heardFirst).toHaveLength(3);
    expect(home?.[4]).toEqual(para({ text: "Heard first", bold: true }));
    expect(home?.[5]).toEqual(list((model.pages[0]?.heardFirst ?? []).map((line) => `“${line}”`)));
    // Then what axe found, after them: a bold label, and, for a run from before voicecap checked
    // pages with axe, why there's nothing.
    expect(home?.[6]).toEqual(leadIn({ text: "What axe found", bold: true }));
    expect(home?.[7]).toEqual(para("Not recorded: this run used voicecap 0.11.0."));
    // Then the run its transcripts are from, and the three transcripts: the read pass first, each a
    // heading 3, the file's fingerprint, and its lines as one fixed-width block.
    expect(home?.[8]).toEqual(para("From run ", { text: "r1", mono: true }));
    expect(outlineOf(home ?? [])).toEqual([
      "2 1 /",
      "3 Read transcript of /, 4 lines",
      "3 Headings transcript of /, 2 lines",
      "3 Tab transcript of /, 2 lines",
    ]);
    expect(files.map(({ pass }) => pass)).toEqual(["read", "headings", "tab"]);
    for (const [index, file] of files.entries()) {
      const at = 9 + index * 3;
      expect(home?.[at + 1]).toEqual(para(...fileFingerprint(file)));
      expect(home?.[at + 2]).toEqual(mono(file.text.split("\n")));
    }
  });

  it("gives each page of the demo its first lines, quoted, and its three transcripts", async () => {
    const model = await demoModel();
    const pages = wordPages(model);
    const [home] = pagePartsOf(pages, model);

    // The home page's screenshot line (the demo's runs took none), its status, and then its first
    // three lines, in the order NVDA said them, each in curly quotes.
    expect(wordsOf(home?.slice(1, 4) ?? [])).toEqual([
      "Screenshot: Not recorded: this run used voicecap 0.4.1.",
      "Title: Not recorded: this run used voicecap 0.4.1. Transcribed. No flags. Read: 18 lines; Headings: 2; Tab stops: 8; Time: 55.1 s.",
      "Heard first",
    ]);
    expect(home?.[4]).toEqual(
      list([
        "“banner landmark, voicecap demo”",
        "“Tour, navigation landmark, list, with 1 item, link, Next: Before you start”",
        "“out of list, main landmark, heading, level 1, Welcome to the voicecap demo”",
      ]),
    );
    expect(outlineOf(home ?? [])).toEqual([
      "2 1 /",
      "3 Read transcript of /, 18 lines",
      "3 Headings transcript of /, 3 lines",
      "3 Tab transcript of /, 9 lines",
    ]);
    // Every page of the demo has its own, as its card's model gives them, and three transcripts.
    for (const [index, card] of model.pages.entries()) {
      const part = pagePartsOf(pages, model)[index] ?? [];
      const lists = part.filter((block) => block.kind === "list");

      expect(card.heardFirst, card.path).toHaveLength(3);
      expect(lists, card.path).toEqual([list(card.heardFirst.map((line) => `“${line}”`))]);
      expect(
        part.filter((block) => block.kind === "mono"),
        card.path,
      ).toHaveLength(3);
      expect(
        part.filter((block) => block.kind === "heading" && block.level === 3),
        card.path,
      ).toHaveLength(3);
    }
  });

  it("has none of those transcripts for a page never read, and says why it has none of its words", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        done("/read"),
        { path: "/failed", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
        { path: "/skipped", status: "skipped" },
      ],
    });
    const model = buildShareModel(inputOf([run]));
    const [read, ...unread] = pagePartsOf(wordPages(model), model);

    // The ring counts the two as not read, and neither one's blocks has the lines or a transcript.
    expect(model.ring.notRead).toBe(2);
    expect(model.pages.map((card) => card.heardFirst.length)).toEqual([3, 0, 0]);
    expect(unread).toHaveLength(2);
    for (const [index, part] of unread.entries()) {
      // Its heading, its screenshot, its status, and what axe found: its label and why there's
      // nothing (the page wasn't read, so axe didn't check it).
      expect(part.map(({ kind }) => kind)).toEqual(["heading", "para", "para", "para", "para"]);
      expect(outlineOf(part)).toHaveLength(1);
      expect(wordsOf(part).join("\n")).not.toContain("Heard first");
      expect(part.some((block) => block.kind === "mono" || block.kind === "list")).toBe(false);
      expect(wordsOf(part.slice(3))).toEqual([
        "What axe found",
        "Not recorded: this run used voicecap 0.1.0.",
      ]);
      expect(reasonOf(model.pages[index + 1])).toBe("Not recorded: this run used voicecap 0.1.0.");
    }
    expect(outlineOf(unread[0] ?? [])).toEqual(["2 2 /failed"]);
    expect(outlineOf(unread[1] ?? [])).toEqual(["2 3 /skipped"]);
    // The page that was read has both.
    expect(wordsOf(read ?? [])).toContain("Heard first");
    expect(read?.some((block) => block.kind === "mono")).toBe(true);
  });

  // Review Focus 4: the words NVDA said are text, whatever they hold.
  it("sets a first line that holds markup as plain text in the list, never as markup", async () => {
    const line = 'link, <b> & "x"';
    const model = withCard(await demoModel(), 0, { heardFirst: [line] });
    const home = pageAt(model, 0);

    // Nothing is escaped: the document holds words, and the library sets each in a run of its own.
    expect(home).toContainEqual(list([`“${line}”`]));
    expect(wordsOf(home)).toContain(`“${line}”`);
    expect(wordsOf(home).join("\n")).not.toMatch(/&lt;|&gt;|&amp;|&quot;|&#39;/);
    // The page shows the same words, escaped.
    expect(renderPages(model)).toContain("<li>“link, &lt;b&gt; &amp; &quot;x&quot;”</li>");
  });

  it("sets a step where NVDA said nothing as the marker the transcript writes, without the quotes of NVDA's words", async () => {
    const lines = ["banner landmark", NO_SPEECH, "link, Back"];
    const model = withCard(await demoModel(), 0, { heardFirst: lines });
    const home = pageAt(model, 0);

    // A note that NVDA said nothing, not words it said: in curly quotes it would read as though NVDA
    // had said them. The lines it did say keep theirs.
    expect(home).toContainEqual(list(["“banner landmark”", "[no speech]", "“link, Back”"]));
    expect(wordsOf(home)).not.toContain("“[no speech]”");
    // The page sets the same three the same way.
    const [card = ""] = renderPages(model).split('<article class="card"').slice(1);
    expect(card).toContain("<li>“banner landmark”</li><li>[no speech]</li><li>“link, Back”</li>");
  });

  it("names each page by its number and its path, or its label with its path after it, and gives its title in its paragraph", () => {
    const model = modelOf([
      done("/about", { label: "About us" }),
      done("/contact"),
      done("/team", { label: "https://example.illinois.gov/team-page" }),
    ]);
    const [about, contact, team] = pagePartsOf(wordPages(model), model);

    expect(model.pages.map((card) => card.labeled)).toEqual([true, false, true]);
    // A label is the page's name, and its path follows; a page with none is named by its path, as
    // its card is (the site's address is at the top of the copy).
    expect(about?.[0]).toEqual(heading(2, "1 About us /about"));
    expect(contact?.[0]).toEqual(heading(2, "2 /contact"));
    // A label that looks like an address is still the page's label.
    expect(team?.[0]).toEqual(heading(2, "3 https://example.illinois.gov/team-page /team"));
    expect(statusWords(about ?? [])).toMatch(/^Title: Page \/about\. /);
    expect(statusWords(contact ?? [])).toMatch(/^Title: Page \/contact\. /);
    // The whole address of a page with no label isn't in the section.
    expect(wordsOf(wordPages(model)).join("\n")).not.toContain(
      "https://example.illinois.gov/contact",
    );
  });

  it("gives a page's title, says when it wasn't recorded, and leaves it out for a page with none", async () => {
    const model = await demoModel();
    const status = (patch: Partial<PageCard>) => statusWords(pageAt(withCard(model, 0, patch), 0));

    // The demo's runs are from before voicecap recorded titles, and say so in the model's words.
    expect(status({})).toMatch(
      /^Title: Not recorded: this run used voicecap 0\.4\.1\. Transcribed\./,
    );
    expect(status({ title: "Grants | Example Agency" })).toMatch(
      /^Title: Grants \| Example Agency\. Transcribed\./,
    );
    expect(status({ title: null })).toMatch(/^Transcribed\./);
    expect(status({ title: "  " })).toMatch(/^Transcribed\./);
  });

  it("says the result in words, with a failure and the run an older page's transcripts come from", async () => {
    const model = await demoModel();
    const [first, , failed] = pagePartsOf(wordPages(model), model);

    expect(model.pages[2]).toMatchObject({ path: "/how-a-run-works/", status: "failed" });
    expect(statusWords(first ?? [])).toContain("Transcribed. ");
    expect(statusWords(failed ?? [])).toBe(
      "Title: Not recorded: this run used voicecap 0.4.1. " +
        "Failed in run 2026-09-29_1402 · transcribed in run 2026-09-29_1315. " +
        "During the headings pass, another window took the screen. " +
        "From run 2026-09-29_1315, on 29 September 2026. " +
        "No flags. " +
        "Read: 18 lines; Headings: 4; Tab stops: 3; Time: 51.5 s.",
    );
  });

  it("says a read that stopped short was transcribed, and not in full", () => {
    const model = modelOf([done("/a"), done("/b", { stopped: { read: "step-cap" } })]);
    const [a, b] = pagePartsOf(wordPages(model), model);

    expect(statusWords(a ?? [])).toContain("Transcribed. ");
    expect(statusWords(b ?? [])).toContain("Transcribed; its read stopped at the step limit. ");
    expect(lineText(pagesGist(model))).toContain("1 transcribed but not in full");
  });

  it("names the rules that raised a flag, each once and in the fixed-width font, or says there are none", async () => {
    const model = await demoModel();
    const flagged = statusOf(pageAt(model, 6));

    expect(model.pages[6]?.flags).toHaveLength(5);
    // Five flags from three rules: the rules once each, in the order they were raised.
    expect(lineText(flagged)).toContain(" Flags raised: generic-link-text, unlabeled, headings. ");
    expect(monoIn(flagged)).toEqual(["generic-link-text", "unlabeled", "headings"]);
    // The label is the page's, which it says for a screen reader alone before its chips.
    expect(PAGES_TEXT.flagsRaised).toBe("Flags raised");
    expect(renderPages(model)).toContain(`<span class="sr">${PAGES_TEXT.flagsRaised}: </span>`);
    // A page with transcripts and no flags says so, in words, and names no rule.
    expect(statusWords(pageAt(model, 0))).toContain(" No flags. ");
    expect(statusWords(pageAt(model, 0))).toContain(` ${PAGES_TEXT.noFlags}. `);
    expect(monoIn(statusOf(pageAt(model, 0)))).toEqual([]);
  });

  it("says a page's flags are as its run recorded them, not the current rules'", async () => {
    const model = await demoModel();
    const recorded = (index: number) =>
      statusOf(pageAt(withCard(model, index, { flagsAsRecorded: true }), index));

    expect(lineText(recorded(0))).toContain(" No flags. Flags as recorded. ");
    expect(lineText(recorded(6))).toContain(
      " Flags raised: generic-link-text, unlabeled, headings. Flags as recorded. ",
    );
    // Only its rules are in the fixed-width font; the words that say where they're from are plain.
    expect(monoIn(recorded(6))).toEqual(["generic-link-text", "unlabeled", "headings"]);
    expect(wordsOf(pageAt(model, 0)).join("\n")).not.toContain("Flags as recorded");
  });

  it("never leaves the flags of a page that wasn't read looking like none", () => {
    const never = buildShareModel(
      inputOf([shareRun({ id: "r1", pages: [{ path: "/", status: "failed" }] })]),
    );
    expect(wordsOf(wordPages(never)).join("\n")).toContain("Nothing was read to flag");

    // Each page the latest run couldn't read, with no transcripts of an earlier run to show: no
    // flags to speak of, and no counts. A page with older transcripts has what they say.
    const model = everyStateModel();
    const parts = pagePartsOf(wordPages(model), model);

    expect(model.pages.map((card) => card.status)).toEqual([
      "flags",
      "failed",
      "skipped",
      "never",
      "skipped",
    ]);
    expect(
      parts.map(
        (part) =>
          /(?:Flags raised: [^.]+|No flags|Nothing was read to flag)\./.exec(
            statusWords(part),
          )?.[0],
      ),
    ).toEqual([
      "Flags raised: generic-link-text.",
      "No flags.",
      "No flags.",
      "Nothing was read to flag.",
      "Nothing was read to flag.",
    ]);
    expect(WORD_TEXT.pages.nothingToFlag).toBe("Nothing was read to flag");
    // A page with no transcripts has nothing captured, and its result says why.
    expect(parts.map((part) => statusWords(part).includes("Read: "))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(statusWords(parts[3] ?? [])).toContain("Failed in run r2 · never transcribed.");
    expect(statusWords(parts[4] ?? [])).toContain("Skipped in run r2 · never transcribed.");
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

    expect(statusWords(pageAt(model, 0))).toContain(
      " No flags. Heard live by Pat Lee. Reviewed, no issues. Issue found. Fixed. " +
        "Changed since review. Sam Roe heard part of this session. " +
        "Manual NVDA session, 25 September 2026, by Sam <Roe>. " +
        "Manual NVDA session, 26 September 2026. Read: ",
    );
  });

  it("says nothing of a review for a page whose records show none, since a copy never says what a person hasn't done", async () => {
    const model = await demoModel();

    for (const [index, card] of model.pages.entries()) {
      expect(card.reviewChips, card.path).toEqual([]);
      expect(statusWords(pageAt(model, index)), card.path).not.toMatch(
        /Heard live|Reviewed|Issue found|Manual NVDA/,
      );
    }
  });

  it("says what each pass captured, the lines read and the headings and Tab stops found, and how long the page took", async () => {
    const model = await demoModel();
    const parts = pagePartsOf(wordPages(model), model);
    const captured = parts.map((part) => /Read: .*$/.exec(statusWords(part))?.[0]);

    expect(captured).toEqual([
      "Read: 18 lines; Headings: 2; Tab stops: 8; Time: 55.1 s.",
      "Read: 19 lines; Headings: 3; Tab stops: 3; Time: 51.6 s.",
      "Read: 18 lines; Headings: 4; Tab stops: 3; Time: 51.5 s.",
      "Read: 19 lines; Headings: 3; Tab stops: 3; Time: 51.0 s.",
      "Read: 18 lines; Headings: 4; Tab stops: 3; Time: 51.7 s.",
      "Read: 21 lines; Headings: 1; Tab stops: 7; Time: 56.9 s.",
      "Read: 22 lines; Headings: 4; Tab stops: 7; Time: 1 min 2 s.",
    ]);
  });

  it("says 'Not read' for a pass the run didn't read, never 0, and says when the time wasn't recorded", async () => {
    const model = await demoModel();
    const captured = (patch: Partial<PageCard>) =>
      /Read: .*$/.exec(statusWords(pageAt(withCard(model, 0, patch), 0)))?.[0];
    const unrecorded = "Not recorded: this run used voicecap 0.4.1.";

    expect(
      captured({
        counts: { read: 1, headings: null, tab: null },
        timeMs: { notRecorded: unrecorded },
      }),
    ).toBe(`Read: 1 line; Headings: Not read; Tab stops: Not read; Time: ${unrecorded}`);
    // Any pass can be the one that wasn't read: the read pass, too.
    expect(captured({ counts: { read: null, headings: 2, tab: 3 } })).toBe(
      "Read: Not read; Headings: 2; Tab stops: 3; Time: 55.1 s.",
    );
    // A pass that read nothing is 0: a pass that wasn't read isn't.
    expect(captured({ counts: { read: 0, headings: 0, tab: 0 } })).toBe(
      "Read: 0 lines; Headings: 0; Tab stops: 0; Time: 55.1 s.",
    );
    expect(captured({ counts: { read: 1_204, headings: 1_000, tab: 12 } })).toBe(
      "Read: 1,204 lines; Headings: 1,000; Tab stops: 12; Time: 55.1 s.",
    );
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
      expect(statusWords(pageAt(withCard(model, 0, { timeMs }), 0)), said).toMatch(
        new RegExp(`Time: ${said}\\.$`),
      );
    }
  });

  it("lists the pages no longer listed after the pages: a heading, its line, and a table", () => {
    const model = noLongerModel();
    const pages = wordPages(model);
    const last = pages.slice(-3);

    expect(model.noLongerListed.map((page) => page.lastRun)).toEqual(["r1", "r1"]);
    expect(outlineOf(pages).at(-1)).toBe("2 No longer listed");
    expect(last.map(({ kind }) => kind)).toEqual(["heading", "para", "table"]);
    expect(wordsOf(under(pages, "No longer listed"))).toEqual([
      "Pages that earlier runs tested and the latest page list no longer has, with what the last run that had each one recorded.",
      "Page | Last run that had it | What it recorded",
      "Old news / https://example.illinois.gov/gone | r1 | Transcribed",
      "https://example.illinois.gov/moved | r1 | Transcribed",
    ]);
    // The name is in bold, with the address beneath it when the name isn't the address.
    const [gone, moved] = tableAt(pages, 0).rows;
    expect(gone?.[0]?.lines.map(boldIn)).toEqual([["Old news"], []]);
    expect(moved?.[0]?.lines.map(boldIn)).toEqual([["https://example.illinois.gov/moved"]]);
    expect(PAGES_TEXT.noLongerListedHead).toEqual(tableAt(pages, 0).head);
  });

  it("has no table of pages no longer listed when none is, and no table of the pages at all", async () => {
    const pages = wordPages(await demoModel());

    expect(tablesIn(pages)).toEqual([]);
    expect(wordsOf(pages).join("\n")).not.toContain("No longer listed");
    expect(wordsOf(wordPages(modelOf([done("/")]))).join("\n")).not.toContain("No longer listed");
  });

  it("says there are no pages when no run counts or the latest run listed none, and draws nothing else", () => {
    const empty = buildShareModel(inputOf([shareRun({ id: "r1", pages: [] })]));

    for (const model of [noRunModel(), empty]) {
      expect(wordPages(model)).toEqual([heading(1, "Every page"), para(...pagesGist(model))]);
    }
    expect(wordsOf(wordPages(noRunModel()))[1]).toBe(
      "No live run counts yet. There are no pages to show.",
    );
    expect(wordsOf(wordPages(empty))[1]).toBe("The latest run listed no pages.");
  });

  it("folds nothing, whatever the number of pages: a heading and three transcripts for each of thirteen, flagged or not", () => {
    const model = manyPages(13, 5);
    const pages = wordPages(model);
    const parts = pagePartsOf(pages, model);

    expect(parts).toHaveLength(13);
    expect(outlineOf(pages).filter((each) => each.startsWith("2 "))).toEqual(
      Array.from({ length: 13 }, (_, index) => `2 ${index + 1} /page-${index + 1}`),
    );
    for (const part of parts) {
      expect(part.filter((block) => block.kind === "mono")).toHaveLength(3);
    }
  });
});

describe("a page's transcripts", () => {
  it("are each one fixed-width block, with its fingerprint above it", async () => {
    const model = await demoModel();
    const pages = wordPages(model);
    const files = model.appendix.flatMap((entry) => entry.files);

    expect(pages.filter((block) => block.kind === "mono")).toHaveLength(
      files.filter((file) => file.lines > 0).length,
    );
    const first = files[0]!;
    // The text is split at its line breaks and nothing is dropped: the model's text is its lines
    // joined by newlines, with no final newline, so a blank last line is a line.
    expect(pages).toContainEqual(mono(first.text.split(/\r?\n/)));
    expect(wordsOf(pages)).toContain(lineText(fileFingerprint(first)));
    // Every transcript's lines are its block's lines, in order, with nothing added or lost, and as
    // many as its heading counts.
    for (const file of files) expect(pages).toContainEqual(mono(file.text.split("\n")));
    expect(pages.flatMap((block) => (block.kind === "mono" ? [block.lines.length] : []))).toEqual(
      files.map((file) => file.lines),
    );
    expect(files).toHaveLength(21);
  });

  it("put the fingerprint right above the transcript, as a paragraph with the fingerprint in the fixed-width font", async () => {
    const model = await demoModel();
    const [file] = model.appendix.flatMap((entry) => entry.files);
    const [home] = pagePartsOf(wordPages(model), model);
    const [fingerprint, transcript] = under(home ?? [], "Read transcript of /, 18 lines");

    expect(fingerprint).toEqual(para(...fileFingerprint(file!)));
    expect(fingerprint?.kind === "para" ? monoIn(fingerprint.line) : []).toEqual([file!.sha256]);
    expect(lineText(fileFingerprint(file!))).toBe(
      `The whole file, its header included: 2,306 bytes, SHA-256 ${file!.sha256}`,
    );
    expect(transcript).toEqual(mono(file!.text.split("\n")));
    expect(transcript?.kind === "mono" && transcript.lines).toHaveLength(18);
  });

  it("are headed by their pass, their page, and their lines, one level under their page's heading", async () => {
    const model = await demoModel();
    const outline = outlineOf(wordPages(model));

    expect(outline.slice(0, 6)).toEqual([
      "1 Every page",
      "2 1 /",
      "3 Read transcript of /, 18 lines",
      "3 Headings transcript of /, 3 lines",
      "3 Tab transcript of /, 9 lines",
      "2 2 /before-you-start/",
    ]);
    // A heading for each page and each of its transcripts: seven pages, three transcripts each.
    expect(outline.filter((each) => each.startsWith("2 "))).toHaveLength(7);
    expect(outline.filter((each) => each.startsWith("3 "))).toHaveLength(21);
    expect(outline[9]).toBe("2 3 /how-a-run-works/");
  });

  it("name their page in each heading, as the page's hidden words do, so no two read alike to someone moving by headings", async () => {
    const model = await demoModel();
    const page = renderPages(model);
    const headings = outlineOf(wordPages(model))
      .filter((each) => each.startsWith("3 "))
      .map((each) => each.slice(2));

    // 21 transcripts, 21 headings, and no two the same: the pass, the words the page says for a
    // screen reader alone, the page's address, and the lines.
    expect(headings).toHaveLength(21);
    expect(new Set(headings).size).toBe(21);
    for (const [index, card] of model.pages.entries()) {
      const own = headings.slice(index * 3, index * 3 + 3);

      expect(
        own.map((each) => each.split(",")[0]),
        card.path,
      ).toEqual([
        `Read ${APPENDIX_TEXT.transcriptOf} ${card.path}`,
        `Headings ${APPENDIX_TEXT.transcriptOf} ${card.path}`,
        `Tab ${APPENDIX_TEXT.transcriptOf} ${card.path}`,
      ]);
      // The page says the same words and the address in each heading of its page's fold, hidden
      // from sight; Word can't hide words, so its headings have them in view.
      expect(page, card.path).toContain(
        `<span class="sr">${APPENDIX_TEXT.transcriptOf} ${card.path}</span>`,
      );
    }
    expect(APPENDIX_TEXT.transcriptOf).toBe("transcript of");
  });

  it("go with the page that has them: a page that failed shows its older run's, and says which", async () => {
    const model = await demoModel();
    const pages = pagePartsOf(wordPages(model), model);
    const origins = (part: Block[]) =>
      part.flatMap((block) =>
        block.kind === "para" && lineText(block.line).startsWith("From run")
          ? [lineText(block.line)]
          : [],
      );

    expect(model.evidence.map(({ run }) => run.id)).toEqual(["2026-09-29_1402", "2026-09-29_1315"]);
    expect(origins(pages[0] ?? [])).toEqual(["From run 2026-09-29_1402"]);
    // The page that failed shows an older run's transcripts, and its date.
    expect(origins(pages[2] ?? [])).toEqual(["From run 2026-09-29_1315, on 29 September 2026"]);
    // The run's id is in the fixed-width font.
    const origin = (pages[0] ?? []).find(
      (block) => block.kind === "para" && lineText(block.line).startsWith("From run"),
    );
    expect(origin?.kind === "para" ? monoIn(origin.line) : []).toEqual(["2026-09-29_1402"]);
  });

  it("name the run only when it knows it", async () => {
    const model = await demoModel();
    const origins = (blocks: Block[]) =>
      blocks.flatMap((block) =>
        block.kind === "para" && lineText(block.line).startsWith("From run")
          ? [lineText(block.line)]
          : [],
      );

    expect(origins(wordPages(model))).toHaveLength(7);
    // With no run that counts, the page that failed still names the older run it comes from.
    expect(origins(wordPages({ ...model, evidence: [] }))).toEqual([
      "From run 2026-09-29_1315, on 29 September 2026",
    ]);
  });

  it("keep their words exactly, their markup, their quotes, their blank lines, and all of them", () => {
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
    const pages = wordPages(model);

    // Nothing is escaped (the document holds words, not markup), and a blank line stays one.
    expect(pages).toContainEqual(mono(hostile));
    expect(pages).toContainEqual(mono(["", "first", "last"]));
    expect(pages).toContainEqual(mono(["<b>"]));
    expect(wordsOf(pages)).toContain("Read transcript of /a, 5 lines");
  });

  it("keep every line a transcript has, as many as its heading counts, a blank last line too", () => {
    /** The model of one page whose read pass has these lines, and the section it makes. */
    const readOf = (lines: string[]) => {
      const model = modelOf([done("/a")], {
        transcripts: storeOf(() => ({ read: lines, headings: LINES.headings, tab: LINES.tab })),
      });
      return { file: model.appendix[0]?.files[0], pages: wordPages(model) };
    };

    // A last line that is blank: the model's text is its lines joined by newlines, so it ends with
    // one, and the block has both lines, as the heading says.
    const two = readOf(["a", ""]);
    expect(two.file).toMatchObject({ text: "a\n", lines: 2 });
    expect(wordsOf(two.pages)).toContain("Read transcript of /a, 2 lines");
    expect(two.pages).toContainEqual(mono(["a", ""]));

    // A transcript that is one blank line has one line, not none.
    const one = readOf([""]);
    expect(one.file).toMatchObject({ text: "", lines: 1 });
    expect(wordsOf(one.pages)).toContain("Read transcript of /a, 1 line");
    expect(one.pages).toContainEqual(mono([""]));
    expect(wordsOf(one.pages)).not.toContain(APPENDIX_TEXT.noLines);

    // A blank line first, between, and last, and more than one in a row: all of them, in order.
    for (const lines of [
      ["", ""],
      ["", "a"],
      ["a", "", "b"],
      ["a", "", ""],
      ["", "a", ""],
    ]) {
      const { file, pages } = readOf(lines);

      expect(file?.lines, JSON.stringify(lines)).toBe(lines.length);
      expect(pages, JSON.stringify(lines)).toContainEqual(mono(lines));
      expect(wordsOf(pages)).toContain(`Read transcript of /a, ${lines.length} lines`);
    }
  });

  it("split a text made by hand at either kind of line break", () => {
    const model = lostModel();
    const [first] = model.appendix.flatMap((entry) => entry.files);
    const [card] = model.pages;
    const blocks = (text: string, lines: number) =>
      wordPages({
        ...model,
        appendix: [
          { slug: card!.slug, name: "a", files: [{ ...first!, text, lines }], unreadable: [] },
        ],
      }).filter((block) => block.kind === "mono");

    expect(blocks("one\ntwo", 2)).toEqual([mono(["one", "two"])]);
    expect(blocks("one\r\ntwo", 2)).toEqual([mono(["one", "two"])]);
    expect(blocks("one\r\n\r\ntwo", 3)).toEqual([mono(["one", "", "two"])]);
  });

  it("make one block of each transcript, however many lines it has: a site of 30 pages and 150 lines a pass", () => {
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
    const pages = wordPages(model);
    const blocks = pages.filter((block) => block.kind === "mono");

    // A block for each of 90 transcripts, each of 150 lines: never a block for a line.
    expect(blocks).toHaveLength(90);
    expect(blocks.every((block) => block.kind === "mono" && block.lines.length === 150)).toBe(true);
    // The heading and the line under it; then for each page its heading, screenshot, status, Heard
    // first and its lines, what axe found (its label, and why there's nothing), the run its
    // transcripts are from, and a heading, fingerprint, and block for each pass.
    expect(pages.length).toBe(2 + 30 * (1 + 1 + 1 + 2 + 2 + 1 + 3 * 3));
    expect(wordsOf(pages)).toContain("Read transcript of /page-30, 150 lines");
  });

  it("say a transcript with no lines has none, rather than a block with nothing in it", () => {
    const model = modelOf([done("/a")], {
      transcripts: storeOf(() => ({ read: LINES.read, headings: [], tab: LINES.tab })),
    });
    const pages = wordPages(model);
    const empty = under(pages, "Headings transcript of /a, 0 lines");

    expect(wordsOf(empty)).toEqual([
      "The whole file, its header included: 1 byte, SHA-256 " + "0".repeat(64),
      "This transcript has no lines.",
    ]);
    expect(empty.map(({ kind }) => kind)).toEqual(["para", "para"]);
    expect(wordsOf(empty)[1]).toBe(APPENDIX_TEXT.noLines);
    // The others have theirs.
    expect(pages.filter((block) => block.kind === "mono")).toEqual([
      mono(LINES.read),
      mono(LINES.tab),
    ]);
  });

  it("count a transcript of one line in the singular", () => {
    const model = modelOf([done("/a")], {
      transcripts: storeOf(() => ({
        read: ["Only line"],
        headings: LINES.headings,
        tab: LINES.tab,
      })),
    });

    expect(wordsOf(wordPages(model))).toContain("Read transcript of /a, 1 line");
  });

  it("say a transcript that couldn't be read couldn't be, in its place, and say nothing of the page's fingerprint check", () => {
    const model = lostModel();
    const pages = wordPages(model);
    const lost = under(pages, "Tab transcript of /a");

    expect(model.appendix[0]?.unreadable).toEqual(["tab"]);
    expect(outlineOf(pages)).toEqual([
      "1 Every page",
      "2 1 /a",
      "3 Read transcript of /a, 4 lines",
      "3 Headings transcript of /a, 2 lines",
      "3 Tab transcript of /a",
    ]);
    expect(wordsOf(lost)).toEqual([
      "This transcript was recorded, but its file couldn't be read here, so it isn't shown.",
    ]);
    expect(lost.map(({ kind }) => kind)).toEqual(["para"]);
    // The others are shown, and this one isn't: two blocks of words.
    expect(pages.filter((block) => block.kind === "mono")).toEqual([
      mono(LINES.read),
      mono(LINES.headings),
    ]);
    // The page says the same, and goes on to say what its check does with it.
    expect(APPENDIX_TEXT.unreadable).toBe(
      "This transcript was recorded, but its file couldn't be read here, so it isn't shown",
    );
    expect(APPENDIX_TEXT.unreadableCheck).toBe(", and the fingerprint check leaves it out");
    expect(renderPages(model)).toContain(
      `<p>${esc(`${APPENDIX_TEXT.unreadable}${APPENDIX_TEXT.unreadableCheck}.`)}</p>`,
    );
    expect(wordsOf(pages).join("\n")).not.toMatch(/fingerprint check/i);
    // A page that can't be read at all is still a page, with all three said.
    const gone = modelOf([done("/a")], { transcripts: storeOf(() => ({})) });
    const words = wordsOf(wordPages(gone));
    expect(words.filter((line) => line === `${APPENDIX_TEXT.unreadable}.`)).toHaveLength(3);
    expect(outlineOf(wordPages(gone))).toEqual([
      "1 Every page",
      "2 1 /a",
      "3 Read transcript of /a",
      "3 Headings transcript of /a",
      "3 Tab transcript of /a",
    ]);
    expect(wordPages(gone).some((block) => block.kind === "mono")).toBe(false);
  });

  it("has no first lines beside a read transcript it says couldn't be read, though the read pass's steps can be", () => {
    // The split: /split's read.json can be read and its read.txt can't. Its transcripts are under
    // its heading, and say the read one couldn't be read, so no lines are quoted from it above them.
    const model = modelOf([done("/split"), done("/whole")], {
      transcripts: withoutReadTxt(storeOf(), (slug) => slug.startsWith("split")),
    });
    const split = pageAt(model, 0);
    const whole = pageAt(model, 1);

    expect(model.appendix.map(({ unreadable }) => unreadable)).toEqual([["read"], []]);
    expect(outlineOf(split)).toEqual([
      "2 1 /split",
      "3 Read transcript of /split",
      "3 Headings transcript of /split, 2 lines",
      "3 Tab transcript of /split, 2 lines",
    ]);
    expect(wordsOf(under(split, "Read transcript of /split"))).toEqual([
      "This transcript was recorded, but its file couldn't be read here, so it isn't shown.",
    ]);
    expect(wordsOf(split)).not.toContain("Heard first");
    expect(split.some((block) => block.kind === "list")).toBe(false);
    // The page whose read transcript is shown still has its first lines, in curly quotes.
    expect(wordsOf(whole)).toContain("Heard first");
    expect(whole).toContainEqual(list(LINES.read.slice(0, 3).map((line) => `“${line}”`)));
  });

  it("say a page whose record lists no transcript files has none", () => {
    const model = modelOf([done("/a", { files: [] })], { transcripts: storeOf(() => ({})) });
    const pages = wordPages(model);
    const [card] = model.pages;
    const shot = card?.screenshot;
    const unrecorded = shot !== undefined && "notRecorded" in shot ? shot.notRecorded : "";

    expect(unrecorded).toMatch(/^Not recorded: this run used voicecap /);
    expect(outlineOf(pages)).toEqual(["1 Every page", "2 1 /a"]);
    expect(wordsOf(pages.slice(3))).toEqual([
      `Screenshot: ${unrecorded}`,
      expect.stringMatching(/^Title: Page \/a\. Transcribed\./),
      "What axe found",
      reasonOf(card),
      "From run r1",
      "This run's record lists no transcript files for the page.",
    ]);
    expect(pages.some((block) => block.kind === "mono")).toBe(false);
  });
});

describe("a page's screenshot", () => {
  const ALT = "The page Read as it loaded, before NVDA read it";

  /** A run of voicecap 0.11.0 whose pages took TINY_JPEG, as the loader holds it. */
  function shotModel(pages: SharePageSpec[]): ShareModel {
    const run = shareRun({ id: "r1", voicecapVersion: "0.11.0", pages });
    return buildShareModel(inputOf([run], { screenshots: picturesOf([run]) }));
  }

  it("says its words as they are, with 'Not recorded' in front of a line that doesn't say so", async () => {
    const model = await demoModel();
    const said = (screenshot: PageCard["screenshot"]) =>
      wordsOf(pageAt(withCard(model, 0, { screenshot }), 0))[1];

    expect(said({ notRecorded: "Not recorded: this run used voicecap 0.4.1." })).toBe(
      "Screenshot: Not recorded: this run used voicecap 0.4.1.",
    );
    // A gap never reads as a pass, as the page's own line makes sure of.
    expect(said({ notRecorded: "this run used voicecap 0.4.1." })).toBe(
      "Screenshot: Not recorded: this run used voicecap 0.4.1.",
    );
    expect(renderPages(withCard(model, 0, { screenshot: { notRecorded: "x" } }))).toContain(
      '<p class="not-recorded">Not recorded: x</p>',
    );
    // A line that says it isn't shown is as it is: it doesn't say "Not recorded" first.
    expect(said({ notRecorded: "Not shown: the file isn't as the run recorded it." })).toBe(
      "Screenshot: Not shown: the file isn't as the run recorded it.",
    );
    // Its label is in bold.
    const label = pageAt(model, 0)[1];
    expect(label?.kind === "para" ? boldIn(label.line) : []).toEqual(["Screenshot:"]);
  });

  it("is after the label that names it, in its page's blocks: the file's bytes, at the size its record gives, with its alt text", () => {
    const model = shotModel([
      done("/read", { label: "Read", screenshot: { ...TINY_RECORD, width: 632, height: 419 } }),
    ]);
    const [label, picture] = pageAt(model, 0).slice(1, 3);

    // The label is in bold, as the line that says a screenshot wasn't recorded has it.
    expect(label?.kind === "para" ? boldIn(label.line) : []).toEqual(["Screenshot:"]);
    expect(wordsOf([label ?? mono([])])).toEqual(["Screenshot:"]);
    expect(picture).toEqual(image({ jpeg: TINY_JPEG, width: 632, height: 419, alt: ALT }));
    // Its alt text is among the document's words, once.
    expect(wordsOf(wordPages(model)).filter((words) => words === ALT)).toHaveLength(1);
  });

  it("is the exact bytes the page has in its address, whatever they are", () => {
    const bytes = Uint8Array.of(0xff, 0xd8, 0xfb, 0xff, 0xfe, 0x00, 0x7f, 0x80);
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.11.0",
      pages: [done("/read", { screenshot: { ...TINY_RECORD, width: 4, height: 2 } })],
    });
    const slug = run.pages[0]?.slug ?? "";
    const model = buildShareModel(
      inputOf([run], { screenshots: new Map([[`r1/${slug}`, bytes]]) }),
    );
    const [picture] = wordPages(model).filter((block) => block.kind === "image");

    expect(picture?.kind === "image" ? Array.from(picture.jpeg) : []).toEqual(Array.from(bytes));
  });

  it("is one for each page that has a picture, and the reason for each page that has none", () => {
    const model = shotModel([
      done("/a", { screenshot: TINY_RECORD }),
      done("/c", { screenshot: { error: "timed out", takenAt: TINY_RECORD.takenAt } }),
      done("/d", { screenshot: TINY_RECORD }),
    ]);
    const pages = wordPages(model);

    expect(pages.filter((block) => block.kind === "image")).toHaveLength(2);
    // Each page says its screenshot once: the label, with the picture after it or the reason.
    expect(wordsOf(pages).filter((words) => words.startsWith("Screenshot:"))).toEqual([
      "Screenshot:",
      "Screenshot: Not recorded: the screenshot couldn't be taken (timed out).",
      "Screenshot:",
    ]);
  });

  it("is on a page that was never read, which took one before it failed, and has no transcripts", () => {
    const model = shotModel([
      done("/read"),
      {
        path: "/never",
        status: "failed",
        failedAttempts: [failedAttempt({ n: 1 })],
        screenshot: { ...TINY_RECORD, width: 632, height: 419 },
      },
    ]);
    const never = pageAt(model, 1);
    const alt = "The page https://example.illinois.gov/never as it loaded, before NVDA read it";

    // Its heading, its screenshot and its picture, its status, and what axe found: a label, and why
    // there's nothing.
    expect(never.map(({ kind }) => kind)).toEqual([
      "heading",
      "para",
      "image",
      "para",
      "para",
      "para",
    ]);
    expect(never[2]).toEqual(image({ jpeg: TINY_JPEG, width: 632, height: 419, alt }));
    expect(wordsOf(never)).toContain(alt);
  });

  it("is said once in each page's own blocks: the label, then its picture or the reason it has none", async () => {
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
      const everything = wordsOf(pages).join("\n");

      for (const [index, card] of model.pages.entries()) {
        const where = `${name}, ${card.path}`;
        const line = `Screenshot: ${shots[index]}`;

        // Once in the whole section, and in this page's own blocks.
        expect(everything.split(line).length - 1, where).toBe(1);
        expect(wordsOf(pagePartsOf(pages, model)[index] ?? []), where).toContain(line);
      }
      // A line for each page, and no other.
      expect(everything.match(/Screenshot:/g) ?? [], name).toHaveLength(model.pages.length);
    }
  });
});

describe("a page's axe results", () => {
  /** The words of a page's axe part, each paragraph and each list item one string. */
  const wordsAt = (model: ShareModel, at = 0): string[] => wordsOf(axePartOf(pageAt(model, at)));

  /** The kind of each block. */
  const kindsOf = (blocks: Block[]): string[] => blocks.map(({ kind }) => kind);

  /** The pieces of every paragraph that are in bold, as their words. */
  const boldOf = (blocks: Block[]): string[] =>
    blocks.flatMap((block) => (block.kind === "para" ? boldIn(block.line) : []));

  /** The pieces of every list item that are in the fixed-width font, as their words. */
  const monoOf = (blocks: Block[]): string[] =>
    blocks.flatMap((block) => (block.kind === "list" ? block.items.flatMap(monoIn) : []));

  const AXE_RULES = "https://dequeuniversity.com/rules/axe/4.13";

  it("writes what axe found after Heard first and before the run its transcripts are from: a bold label, what axe is, its version, the counts, the issues most severe first, what needs review, and the file's fingerprint", () => {
    const kept = aboutAxe();
    const model = axeModelOf(axeRunOf([done("/about/", { axe: kept.record })]));
    const part = pageAt(model, 0);
    const axe = axePartOf(part);
    const at = part.indexOf(axe[0] ?? mono([]));

    // Right after the lines NVDA said first, and right before the run its transcripts are from.
    expect(at).toBe(5);
    expect(part[at - 2]).toEqual(para({ text: "Heard first", bold: true }));
    expect(part[at - 1]?.kind).toBe("list");
    expect(wordsOf(part.slice(at + axe.length, at + axe.length + 1))).toEqual(["From run r1"]);
    expect(wordsOf(axe)).toEqual([
      "What axe found",
      "axe is an automated checker: it tests a page's code against rules, and finds what code can find. A person's review finds the rest.",
      "axe-core 4.13.0, with its rules for WCAG 2.0 and 2.1 at levels A and AA, WCAG 2.2 at level AA, and best practices.",
      "Issues: 3; Critical: 1; Serious: 1; Moderate: 1; Minor: 0; Needs review: 1; Rules passed: 41.",
      "Issues, most severe first",
      // button-name, the most severe: its two elements' words on how to fix them differ, so each has
      // its own.
      "Buttons must have discernible text\nImpact: critical · WCAG 2.0 A 4.1.2",
      `Element: #menu\nIts HTML: <button id="menu"></button>\nHow to fix it, in axe's words:\nFix any of the following:\n– Element does not have inner text that is visible to screen readers\n– aria-label attribute does not exist or is empty\nFix all of the following:\n– Element is in tab order and does not have accessible text`,
      `Element: #search\nIts HTML: <button id="search"><svg></svg></button>\nHow to fix it, in axe's words:\nFix any of the following:\n– ${NO_TEXT}`,
      "axe's page on button-name",
      // color-contrast, then region, which names no WCAG criterion: each found one element, so its
      // words on how to fix it come once, before it.
      "Elements must meet minimum color contrast ratio thresholds\nImpact: serious · WCAG 2.0 AA 1.4.3",
      `How to fix the element listed, in axe's words:\nFix any of the following:\n– ${NO_TEXT}`,
      `Element: .pale\nIts HTML: <p class="pale">Apply by 1 May</p>`,
      "axe's page on color-contrast",
      "All page content should be contained by landmarks\nImpact: moderate · best practice",
      `How to fix the element listed, in axe's words:\nFix any of the following:\n– ${NO_TEXT}`,
      `Element: #promo\nIts HTML: <div id="promo">Grants</div>`,
      "axe's page on region",
      "Needs review",
      "axe couldn't decide these, so each needs a person to check it.",
      "Elements must meet minimum color contrast ratio thresholds\nImpact: serious · WCAG 2.0 AA 1.4.3",
      "How to fix the element listed, in axe's words:\nFix any of the following:\n– Element's background color could not be determined due to a background image",
      "Element: .hero h2\nIts HTML: <h2>Welcome</h2>",
      "axe's page on color-contrast",
      `axe.json: ${byteCount(kept.record.bytes)}, SHA-256 ${kept.record.sha256}`,
    ]);
    // Each issue is a paragraph, and its elements a list.
    expect(kindsOf(axe)).toEqual([
      ...["para", "para", "para", "para", "para"],
      ...["para", "list", "para"],
      ...["para", "para", "list", "para"],
      ...["para", "para", "list", "para"],
      ...["para", "para"],
      ...["para", "para", "list", "para"],
      "para",
    ]);
  });

  it("sets the labels and each issue's name in bold, an element's selector and HTML in the fixed-width font, and the file's fingerprint in it, as a transcript's is", () => {
    const kept = aboutAxe();
    const model = axeModelOf(axeRunOf([done("/about/", { axe: kept.record })]));
    const axe = axePartOf(pageAt(model, 0));

    expect(boldOf(axe)).toEqual([
      "What axe found",
      "Issues, most severe first",
      "Buttons must have discernible text",
      "Elements must meet minimum color contrast ratio thresholds",
      "All page content should be contained by landmarks",
      "Needs review",
      "Elements must meet minimum color contrast ratio thresholds",
    ]);
    expect(monoOf(axe)).toEqual([
      ...["#menu", '<button id="menu"></button>'],
      ...["#search", '<button id="search"><svg></svg></button>'],
      ...[".pale", '<p class="pale">Apply by 1 May</p>'],
      ...["#promo", '<div id="promo">Grants</div>'],
      ...[".hero h2", "<h2>Welcome</h2>"],
    ]);
    const last = axe.at(-1);
    expect(last).toEqual(para(...axeFingerprint(kept.record)));
    expect(last?.kind === "para" ? monoIn(last.line) : []).toEqual([kept.record.sha256]);
  });

  it("keeps each bold label, each issue's bold line, and the line that leads into what needs review with what follows it in the file, so none ends a printed page alone", async () => {
    const kept = aboutAxe();
    const model = axeModelOf(axeRunOf([done("/about/", { axe: kept.record })]));
    const { document } = await unzipDocx(await renderWordCopy(model));
    const together = keptWithNext(document);
    const CONTRAST_LINE =
      "Elements must meet minimum color contrast ratio thresholds\nImpact: serious · WCAG 2.0 AA 1.4.3";

    for (const label of ["What axe found", "Issues, most severe first", "Needs review"]) {
      expect(
        together.filter((text) => text === label),
        label,
      ).toHaveLength(1);
    }
    expect(together).toContain(
      "Buttons must have discernible text\nImpact: critical · WCAG 2.0 A 4.1.2",
    );
    expect(together).toContain(
      "All page content should be contained by landmarks\nImpact: moderate · best practice",
    );
    // color-contrast is an issue, and something to review too.
    expect(together.filter((text) => text === CONTRAST_LINE)).toHaveLength(2);
    expect(together).toContain(AXE_TEXT.reviewLead);
    // What leads into nothing stays as it was: what axe is, its counts, a link, the fingerprint.
    for (const line of [
      AXE_TEXT.what,
      "Issues: 3; Critical: 1; Serious: 1; Moderate: 1; Minor: 0; Needs review: 1; Rules passed: 41.",
      "axe's page on button-name",
      `axe.json: ${byteCount(kept.record.bytes)}, SHA-256 ${kept.record.sha256}`,
    ]) {
      expect(together, line).not.toContain(line);
    }
  });

  it("links to axe's own page on each rule, by the rule's name, as the fold does, and to no other address", () => {
    const model = axeModelOf(
      axeRunOf([
        done("/", {
          axe: keptAxe({
            violations: [
              rawRule("button-name"),
              rawRule("label", { helpUrl: "https://example.com/rules/label" }),
              rawRule("link-name", { helpUrl: "javascript:alert(1)" }),
              rawRule("region", {
                helpUrl: "https://dequeuniversity.com.example/rules/axe/4.13/x",
              }),
              rawRule("heading-order", { helpUrl: "" }),
            ],
            incomplete: [rawRule("color-contrast")],
          }).record,
        }),
      ]),
    );
    const axe = axePartOf(pageAt(model, 0));

    expect(hrefsOf(axe)).toEqual([
      `${AXE_RULES}/button-name?application=axeAPI`,
      `${AXE_RULES}/color-contrast?application=axeAPI`,
    ]);
    // The link's words name the rule; a rule whose address isn't axe's own page has no link at all.
    const links = linesIn(axe).flatMap((line) =>
      line.filter((piece) => typeof piece !== "string" && piece.href !== undefined),
    );
    expect(links).toEqual([
      { text: "axe's page on button-name", href: `${AXE_RULES}/button-name?application=axeAPI` },
      {
        text: "axe's page on color-contrast",
        href: `${AXE_RULES}/color-contrast?application=axeAPI`,
      },
    ]);
    expect(wordsOf(axe).filter((words) => words.startsWith("axe's page on "))).toHaveLength(2);
  });

  it("says the counts with their labels as the fold has them, in thousands as the page writes them", () => {
    const rules = Array.from({ length: 3 }, (_, index) => rawRule(`rule-${index}`));
    const model = axeModelOf(
      axeRunOf([
        done("/", { axe: keptAxe({ violations: rules, passes: 1_204 }).record }),
        done("/none", { axe: keptAxe({}).record }),
      ]),
    );

    expect(wordsAt(model, 0)[3]).toBe(
      "Issues: 3; Critical: 0; Serious: 3; Moderate: 0; Minor: 0; Needs review: 0; Rules passed: 1,204.",
    );
    expect(wordsAt(model, 1)[3]).toBe(
      "Issues: 0; Critical: 0; Serious: 0; Moderate: 0; Minor: 0; Needs review: 0; Rules passed: 0.",
    );
    // A rule axe rated no impact is an issue, and in no impact's count.
    const unrated = axeModelOf(
      axeRunOf([
        done("/", { axe: keptAxe({ violations: [rawRule("x", { impact: null })] }).record }),
      ]),
    );
    expect(wordsAt(unrated)[3]).toBe(
      "Issues: 1; Critical: 0; Serious: 0; Moderate: 0; Minor: 0; Needs review: 0; Rules passed: 0.",
    );
    expect(wordsAt(unrated)).toContain("The x rule's help\nImpact: not given · WCAG 2.0 A 4.1.2");
  });

  it("says axe found no issues, with the counts, and lists what needs review under it", () => {
    const quiet = keptAxe({ passes: 30, inapplicable: 60 });
    const toReview = keptAxe({
      incomplete: [rawRule("color-contrast", { tags: CONTRAST })],
      passes: 30,
    });
    const model = axeModelOf(
      axeRunOf([done("/", { axe: quiet.record }), done("/a", { axe: toReview.record })]),
    );
    const [first = [], second = []] = [0, 1].map((at) => wordsAt(model, at));

    expect(first).toEqual([
      "What axe found",
      AXE_TEXT.what,
      "axe-core 4.13.0, with its rules for WCAG 2.0 and 2.1 at levels A and AA, WCAG 2.2 at level AA, and best practices.",
      "Issues: 0; Critical: 0; Serious: 0; Moderate: 0; Minor: 0; Needs review: 0; Rules passed: 30.",
      "axe found no issues on this page.",
      `axe.json: ${byteCount(quiet.record.bytes)}, SHA-256 ${quiet.record.sha256}`,
    ]);
    // With nothing to review it has no heading for it, and with no issues no heading for them.
    expect(first).not.toContain("Needs review");
    expect(first).not.toContain("Issues, most severe first");
    expect(second.slice(3, 8)).toEqual([
      "Issues: 0; Critical: 0; Serious: 0; Moderate: 0; Minor: 0; Needs review: 1; Rules passed: 30.",
      "axe found no issues on this page.",
      "Needs review",
      "axe couldn't decide these, so each needs a person to check it.",
      "The color-contrast rule's help\nImpact: serious · WCAG 2.0 AA 1.4.3",
    ]);
    expect(second).not.toContain("Issues, most severe first");
  });

  it("names a rule by its id when axe gave no words for it, and says an impact it didn't give", () => {
    const model = axeModelOf(
      axeRunOf([
        done("/", {
          axe: keptAxe({ violations: [rawRule("label", { help: "", impact: null, tags: BEST })] })
            .record,
        }),
      ]),
    );
    const axe = axePartOf(pageAt(model, 0));

    expect(wordsOf(axe)).toContain("label\nImpact: not given · best practice");
    expect(boldOf(axe)).toContain("label");
  });

  it("writes an issue that has no elements kept as its paragraph and its link, with no list", () => {
    const model = axeModelOf(
      axeRunOf([
        done("/", {
          axe: keptAxe({ violations: [rawRule("image-alt", { help: "Images", nodes: [] })] })
            .record,
        }),
      ]),
    );
    const blocks = axePartOf(pageAt(model, 0)).slice(5, -1);

    expect(kindsOf(blocks)).toEqual(["para", "para"]);
    expect(wordsOf(blocks)).toEqual([
      "Images\nImpact: serious · WCAG 2.0 A 4.1.2",
      "axe's page on image-alt",
    ]);
  });

  describe("axe's words on how to fix a rule's elements", () => {
    /** axe's words on how to fix an image with no text, as every element of a rule can share them. */
    const SHARED =
      "Fix any of the following:\n  Element does not have an alt attribute\n  aria-label attribute does not exist or is empty";
    /** The same, as the Word copy sets them out: each lead on a line, and each thing under it after a dash. */
    const SHARED_LINES =
      "Fix any of the following:\n– Element does not have an alt attribute\n– aria-label attribute does not exist or is empty";
    const ISSUE = "Images must have alt\nImpact: critical · WCAG 2.0 A 4.1.2";
    const LINK = "axe's page on image-alt";
    /** An element as the copy lists it when its rule says the words on how to fix it once. */
    const plain = (at: number): string => `Element: #img-${at}\nIts HTML: <img src="/${at}.jpg">`;

    /** The blocks of the one rule a page's axe results hold, whose elements have these words each. */
    const ruleWith = (summaries: string[]): Block[] => {
      const nodes = summaries.map((failureSummary, at) =>
        rawNode(`#img-${at}`, { html: `<img src="/${at}.jpg">`, failureSummary }),
      );
      const rule = rawRule("image-alt", {
        impact: "critical",
        help: "Images must have alt",
        nodes,
      });
      const model = axeModelOf(
        axeRunOf([done("/", { axe: keptAxe({ violations: [rule] }).record })]),
      );
      // After the label, what axe is, its version, the counts, and the issues' label, and before
      // the file's fingerprint.
      return axePartOf(pageAt(model, 0)).slice(5, -1);
    };

    it("says them once, between the rule and its elements, when every element shares them", () => {
      const blocks = ruleWith([SHARED, SHARED, SHARED]);

      expect(kindsOf(blocks)).toEqual(["para", "para", "list", "para"]);
      expect(wordsOf(blocks)).toEqual([
        ISSUE,
        `How to fix each element listed, in axe's words:\n${SHARED_LINES}`,
        plain(0),
        plain(1),
        plain(2),
        LINK,
      ]);
      expect(
        wordsOf(blocks)
          .join("\n")
          .match(/How to fix/g),
      ).toHaveLength(1);
    });

    it("says one element's words once too, as the words for the element listed", () => {
      const blocks = ruleWith([SHARED]);

      expect(wordsOf(blocks)).toEqual([
        ISSUE,
        `How to fix the element listed, in axe's words:\n${SHARED_LINES}`,
        plain(0),
        LINK,
      ]);
    });

    it("keeps each element's words with it when they differ", () => {
      const other = "Fix all of the following:\n  Element is in tab order and has no text";
      const blocks = ruleWith([SHARED, other, SHARED]);
      const fix = (lines: string) => `\nHow to fix it, in axe's words:\n${lines}`;

      expect(kindsOf(blocks)).toEqual(["para", "list", "para"]);
      expect(wordsOf(blocks)).toEqual([
        ISSUE,
        `${plain(0)}${fix(SHARED_LINES)}`,
        `${plain(1)}${fix("Fix all of the following:\n– Element is in tab order and has no text")}`,
        `${plain(2)}${fix(SHARED_LINES)}`,
        LINK,
      ]);
    });

    it("says nothing on how to fix an element whose words are none, among others', or when every element's are", () => {
      expect(wordsOf(ruleWith([SHARED, ""]))).toEqual([
        ISSUE,
        `${plain(0)}\nHow to fix it, in axe's words:\n${SHARED_LINES}`,
        plain(1),
        LINK,
      ]);
      const none = ruleWith(["", "", ""]);

      expect(kindsOf(none)).toEqual(["para", "list", "para"]);
      expect(wordsOf(none)).toEqual([ISSUE, plain(0), plain(1), plain(2), LINK]);
      expect(wordsOf(none).join("\n")).not.toContain("How to fix");
    });

    it("says them once for 50 kept of 400 elements that share them, and doesn't claim the 350 not kept", () => {
      const blocks = ruleWith(Array.from({ length: 400 }, () => SHARED));

      expect(kindsOf(blocks)).toEqual(["para", "para", "list", "para", "para"]);
      expect(wordsOf(blocks.slice(0, 2))).toEqual([
        ISSUE,
        `How to fix each element listed, in axe's words:\n${SHARED_LINES}`,
      ]);
      const items = blocks[2];
      expect(items?.kind === "list" ? items.items : []).toHaveLength(MAX_NODES);
      expect(wordsOf(blocks.slice(3))).toEqual(["and 350 more elements", LINK]);
      expect(
        wordsOf(blocks)
          .join("\n")
          .match(/How to fix/g),
      ).toHaveLength(1);
      // One more is said in the singular.
      expect(wordsOf(ruleWith(Array.from({ length: 51 }, () => SHARED))).at(-2)).toBe(
        "and 1 more element",
      );
    });
  });

  it("writes what axe found on a page that was never read, which axe checked before it failed, after its status and as the end of its page", () => {
    const run = axeRunOf([
      done("/read", { axe: keptAxe({ passes: 5 }).record }),
      {
        path: "/never",
        status: "failed",
        failedAttempts: [failedAttempt({ n: 1 })],
        axe: aboutAxe().record,
      },
    ]);
    const never = pageAt(axeModelOf(run), 1);

    // No lines NVDA said, and no transcripts: what axe found follows the page's status paragraph,
    // and is the end of the page.
    expect(never.map(({ kind }) => kind).slice(0, 4)).toEqual(["heading", "para", "para", "para"]);
    expect(wordsOf(never)[3]).toBe("What axe found");
    expect(axePartOf(never)).toEqual(never.slice(3));
    expect(wordsOf(never).at(-1)).toMatch(/^axe\.json: /);
    expect(wordsOf(never)).toContain(
      "Issues: 3; Critical: 1; Serious: 1; Moderate: 1; Minor: 0; Needs review: 1; Rules passed: 41.",
    );
  });

  it("says nothing of axe for a card the model didn't make for it, as the page has no fold for it", async () => {
    const model = await demoModel();
    const without = withCard(model, 0, { axe: undefined });

    expect(axePartOf(pageAt(without, 0))).toEqual([]);
    expect(wordsOf(pageAt(without, 0))).not.toContain("What axe found");
    expect(wordsOf(pageAt(without, 1))).toContain("What axe found");
  });

  it("changes nothing else: the verdict, the ring, the numbers, and What needs attention are as they are without axe's results, and so is every other block of a page", () => {
    // The same pages, with a flag, a failure, and a skip, with axe's results and without them.
    const pages = (withAxe: boolean): SharePageSpec[] => [
      done("/", { flags: [LINK_FLAG], ...(withAxe ? { axe: aboutAxe().record } : {}) }),
      done("/a", withAxe ? { axe: keptAxe({ passes: 30 }).record } : {}),
      {
        path: "/b",
        status: "failed",
        failedAttempts: [failedAttempt({ n: 1 })],
        ...(withAxe ? { axe: aboutAxe().record } : {}),
      },
      { path: "/c", status: "skipped" },
    ];
    const [plain, checked] = [false, true].map((withAxe) =>
      axeModelOf(axeRunOf(pages(withAxe))),
    ) as [ShareModel, ShareModel];
    const sections = (model: ShareModel) => partsAt(wordOutline(model), 1);

    // The results are there: the pages that were checked have issues and a count of rules passed.
    expect(checked.pages.map((card) => card.axe !== undefined && "view" in card.axe)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    // At a glance and What needs attention, in the same order, word for word.
    expect(outlineOf(wordOutline(checked)).slice(0, 4)).toEqual(
      outlineOf(wordOutline(plain)).slice(0, 4),
    );
    expect(sections(checked).slice(0, 2)).toEqual(sections(plain).slice(0, 2));
    expect(sections(plain)[1]?.[0]).toEqual(heading(1, "What needs attention"));
    // Each page is the same but for what it says of axe.
    for (const [index, card] of plain.pages.entries()) {
      const apart = (part: Block[]) => part.filter((block) => !axePartOf(part).includes(block));

      expect(axePartOf(pageAt(checked, index)).length, card.path).toBeGreaterThan(1);
      expect(apart(pageAt(checked, index)), card.path).toEqual(apart(pageAt(plain, index)));
    }
  });

  describe("writes why there's none", () => {
    const CHANGED = "Not shown: axe.json isn't as the run recorded it; voicecap verify names it.";
    const NOT_RESULTS =
      "Not shown: axe.json is as the run recorded it, but it isn't axe's results as voicecap keeps them.";
    const UNREADABLE = "Not shown: the run's record of this page's axe check couldn't be read.";
    const NOT_READ = "Not checked: axe didn't check this page, since it wasn't read.";
    const NO_DRIVER = "Not checked: this run's driver doesn't check pages with axe.";

    it("under the label, in the card's words: a check axe couldn't make, a file the page can't show, a record it can't read, and a page that wasn't read", () => {
      const clean = keptAxe({ passes: 2 });
      const missing = { ...keptAxe({ passes: 1 }).record, sha256: "d".repeat(64) };
      const text = '{"schemaVersion": 1, "note": "not axe"}\n';
      const notAxe: AxeRecord = { ...clean.record, ...fileHash(text) };
      const run = axeRunOf([
        done("/ok", { axe: clean.record }),
        done("/error", { axe: { error: "timed out after 20s", ranAt: AXE_RAN_AT } }),
        done("/missing", { axe: missing }),
        done("/not-axe", { axe: notAxe }),
        done("/odd", { axe: null as unknown as AxeRecord }),
        { path: "/pdf", status: "skipped" },
      ]);
      const files = new Map([
        ...axeFilesOf([run]),
        [`r1/${run.pages[3]?.slug}`, text] as [string, string],
      ]);
      const model = buildShareModel(inputOf([run], { axeFiles: files }));
      const reasons = [
        "axe couldn't check this page: timed out after 20s.",
        CHANGED,
        NOT_RESULTS,
        UNREADABLE,
        NOT_READ,
      ];

      // The page that was checked has results, not a reason.
      expect(model.pages[0]?.axe).toHaveProperty("view");
      expect(wordsAt(model, 0)[0]).toBe("What axe found");
      expect(wordsAt(model, 0)).toContain("axe found no issues on this page.");
      for (const [at, reason] of reasons.entries()) {
        const index = at + 1;
        const where = model.pages[index]?.path;

        // The label in bold, and the card's reason as a paragraph under it: nothing else.
        expect(axePartOf(pageAt(model, index)), where).toEqual([
          leadIn({ text: "What axe found", bold: true }),
          para(reason),
        ]);
        expect(reasonOf(model.pages[index]), where).toBe(reason);
        // The fold says the same words.
        expect(renderPages(model), where).toContain(`<p class="not-recorded">${esc(reason)}</p>`);
      }
    });

    it("for a run from before voicecap checked pages with axe, as it says of every part such a run didn't record, and for a run whose driver checks none", () => {
      for (const version of ["0.15.0", "0.11.0", "0.4.1"]) {
        const older = axeModelOf(axeRunOf([done("/")], version));

        expect(wordsAt(older), version).toEqual([
          "What axe found",
          `Not recorded: this run used voicecap ${version}.`,
        ]);
      }
      expect(wordsAt(axeModelOf(axeRunOf([done("/"), done("/a")])), 1)).toEqual([
        "What axe found",
        NO_DRIVER,
      ]);
    });

    it("with 'Not recorded' in front of a line that doesn't say it wasn't recorded, shown, or checked, so a gap never reads as a pass, as the page does", async () => {
      const model = await demoModel();
      const said = (notRecorded: string) =>
        wordsAt(withCard(model, 0, { axe: { notRecorded } }), 0).at(-1);

      expect(said("this run used voicecap 0.4.1.")).toBe(
        "Not recorded: this run used voicecap 0.4.1.",
      );
      // A line that says so already is as it is.
      for (const line of [NO_DRIVER, NOT_READ, CHANGED, "axe couldn't check this page."]) {
        expect(said(line), line).toBe(line);
      }
      expect(renderPages(withCard(model, 0, { axe: { notRecorded: "gone" } }))).toContain(
        '<p class="not-recorded">Not recorded: gone</p>',
      );
    });

    it("on every page of the demo, whose runs are from before voicecap kept it", async () => {
      const model = await demoModel();

      expect(model.pages).toHaveLength(7);
      for (const [index, card] of model.pages.entries()) {
        expect(wordsAt(model, index), card.path).toEqual([
          "What axe found",
          "Not recorded: this run used voicecap 0.4.1.",
        ]);
      }
    });
  });

  // Review Focus 3: the words axe supplies are text, whatever they hold.
  describe("writes axe's HTML as text, and everything else axe supplies", () => {
    const script = "<script>alert(1)</script>";
    // Characters XML forbids, which a page's text can hold and a Word file can't.
    const CONTROL = "<p>x\u0000y\u0001z\uD800</p>";
    const hostile = () =>
      keptAxe({
        violations: [
          rawRule(`x"><img src=x onerror=alert(1)>`, {
            help: `Help ${script} & more`,
            helpUrl: "javascript:alert(1)",
            tags: ["wcag2a", "<b>tag</b>"],
            nodes: [
              rawNode(".a", {
                html: `<div title="a & b">${script} &amp; &lt;</div>`,
                target: [`div[title="${script}"]`],
                failureSummary: `Fix any of the following:\n  ${script} & "quoted"`,
              }),
            ],
          }),
          rawRule("link-name", {
            helpUrl: `${AXE_RULES}/x"><evil/>&a='1'`,
            nodes: [
              rawNode(".b"),
              rawNode(".c", { failureSummary: `Fix all of the following:\n  ${script}` }),
            ],
          }),
          rawRule("image-alt", { helpUrl: "", nodes: [rawNode(".d", { html: CONTROL })] }),
        ],
      });

    it("as the words it is: the HTML of an element holding a script, its markup, quotes, and entities, never escaped", () => {
      const model = axeModelOf(axeRunOf([done("/", { axe: hostile().record })]));
      const axe = axePartOf(pageAt(model, 0));
      const words = wordsOf(axe);

      expect(words).toContain(`Help ${script} & more\nImpact: serious · WCAG 2.0 A`);
      expect(words).toContain(
        `How to fix the element listed, in axe's words:\nFix any of the following:\n– ${script} & "quoted"`,
      );
      expect(words).toContain(
        `Element: div[title="${script}"]\nIts HTML: <div title="a & b">${script} &amp; &lt;</div>`,
      );
      expect(words).toContain(`Element: .d\nIts HTML: ${CONTROL}`);
      expect(monoOf(axe)).toContain(`<div title="a & b">${script} &amp; &lt;</div>`);
      expect(monoOf(axe)).toContain(`div[title="${script}"]`);
      // Nothing is escaped: the document holds words, and the library sets each in a run of its own.
      expect(words.join("\n")).not.toMatch(/&lt;script|&gt;|&quot;|&#39;/);
      // An address that isn't axe's own page on a rule is never a link; one that is, is the link.
      expect(hrefsOf(axe)).toEqual([`${AXE_RULES}/x"><evil/>&a='1'`]);
    });

    it("in the .docx: text in a run, a file that opens, and no link but axe's own pages", async () => {
      const model = axeModelOf(axeRunOf([done("/", { axe: hostile().record })]));
      const parts = await unzipDocx(await renderWordCopy(model));
      const paragraphs = paragraphsOf(parts.document).map(({ text }) => text);

      for (const name of ["document", "rels"] as const) {
        expect(XMLValidator.validate(parts[name]), name).toBe(true);
      }
      // The script is XML text, read back as the words axe gave, and no element of the file.
      expect(parts.document).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(parts.document).not.toContain("<script");
      expect(parts.document).not.toContain("<img");
      expect(parts.document).not.toContain("<evil");
      expect(paragraphs).toContain(
        `Element: div[title="${script}"]\nIts HTML: <div title="a & b">${script} &amp; &lt;</div>`,
      );
      expect(paragraphs).toContain(`Help ${script} & more\nImpact: serious · WCAG 2.0 A`);
      expect(paragraphs).toContain(
        `Element: .c\nIts HTML: <a href="/next/" class="c"></a>\nHow to fix it, in axe's words:\nFix all of the following:\n– ${script}`,
      );
      // A character XML forbids is shown as U+FFFD, so the file is XML and opens.
      expect(parts.document).not.toMatch(FORBIDDEN);
      expect(paragraphs).toContain("Element: .d\nIts HTML: <p>x\u{FFFD}y\u{FFFD}z\u{FFFD}</p>");
      // Beyond the report's own four addresses, the file links to axe's page on a rule, read back
      // whole, and to no other: not the rule whose address is a script.
      expect(linksOf(parts).filter((link) => !REPORT_LINKS.has(link))).toEqual([
        `${AXE_RULES}/x"><evil/>&a='1'`,
      ]);
      expect(linksOf(parts).join("\n")).not.toContain("javascript:");
    });
  });

  it("says the words of the card's fold in the fold's order, unfolded: what axe is, its version, the counts, each issue and its elements, what needs review, and the fingerprint", () => {
    // One rule's elements differ in their words on how to fix them, and another's share them (51
    // of its elements, so 50 are kept and one is counted), so both ways of saying them are here.
    const shared = "Fix any of the following:\n  Element does not have an alt attribute";
    const kept = keptAxe({
      violations: [
        rawRule("button-name", {
          impact: "critical",
          tags: NAME_ROLE,
          help: "Buttons must have discernible text",
          nodes: [
            rawNode("#menu", {
              failureSummary:
                "Fix any of the following:\n  Element has no inner text\n\nFix all of the following:\n  Element is in tab order",
            }),
            rawNode("#search"),
          ],
        }),
        rawRule("image-alt", {
          impact: "serious",
          tags: ["cat.text-alternatives", "wcag2a", "wcag111"],
          help: "Images must have alternative text",
          nodes: Array.from({ length: 51 }, (_, at) =>
            rawNode(`#img-${at}`, { html: `<img src="/${at}.jpg">`, failureSummary: shared }),
          ),
        }),
        rawRule("region", { impact: "moderate", tags: BEST, help: "Use landmarks" }),
      ],
      incomplete: [
        rawRule("color-contrast", { tags: CONTRAST, help: "Contrast needs a person to check" }),
      ],
      passes: 41,
    });
    const model = axeModelOf(axeRunOf([done("/about/", { axe: kept.record })]));
    const [card = ""] = renderPages(model).split('<article class="card"').slice(1);
    const fold = /<details class="fold axe-page"[^>]*>(.*?)<\/div><\/details>/s.exec(card)?.[1];
    const shown = model.pages[0]?.axe;
    if (fold === undefined) throw new Error("The card has no fold of what axe found.");
    if (shown === undefined || "notRecorded" in shown) throw new Error("The card has no results.");
    const anchors = anchorsOf(shown);

    // Many words are checked, and in both places, in the same order: each is found after the one
    // before it.
    expect(anchors.length).toBeGreaterThan(60);
    expect(anchors).toContain(AXE_TEXT.more(1));
    expect(anchors).toContain(AXE_TEXT.fixShared(51));
    expect(anchors).toContain(AXE_TEXT.fix);
    const places = [
      ["the fold", textOf(fold, "")],
      ["the Word copy", wordsAt(model).join(" ").replace(/\s+/g, " ")],
    ] as const;
    for (const [name, text] of places) {
      let from = 0;
      for (const anchor of anchors) {
        const words = anchor.replace(/\s+/g, " ");
        const at = text.indexOf(words, from);

        expect(at, `${name}: ${anchor}`).toBeGreaterThanOrEqual(0);
        from = at + words.length;
      }
    }
  });
});

describe("the section together", () => {
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
    ["axe's results", axeResultsModel()],
  ];

  it("sets its headings in order: one h1, an h2 for each page, and an h3 for each transcript", async () => {
    for (const [name, model] of await models()) {
      const blocks = wordPages(model);
      const levels = blocks.flatMap((block) => (block.kind === "heading" ? [block.level] : []));

      expect(
        levels.filter((level) => level === 1),
        name,
      ).toHaveLength(1);
      expect(levels[0], name).toBe(1);
      expect(Math.max(...levels), name).toBeLessThanOrEqual(3);
      for (const [index, level] of levels.entries()) {
        if (index > 0) expect(level - (levels[index - 1] ?? 0), name).toBeLessThanOrEqual(1);
      }
      expect(
        blocks.some((block) => block.kind === "title"),
        name,
      ).toBe(false);
    }
    expect(outlineOf(wordPages(await demoModel())).filter((line) => line.startsWith("1 "))).toEqual(
      ["1 Every page"],
    );
  });

  it("never gives a table a heading with no words, since Word flags an empty header cell", async () => {
    for (const [name, model] of await models()) {
      for (const { head, rows } of tablesIn(wordPages(model))) {
        expect(
          head.every((words) => words.trim() !== ""),
          name,
        ).toBe(true);
        // A table has a cell for each heading, in every row.
        for (const row of rows) expect(row, name).toHaveLength(head.length);
      }
    }
  });

  it("has one table at most, of the pages no longer listed: a page is never a row", async () => {
    for (const [name, model] of await models()) {
      expect(tablesIn(wordPages(model)), name).toHaveLength(
        model.noLongerListed.length > 0 ? 1 : 0,
      );
    }
    // The tables of two models, so a count of nothing can't pass for this.
    expect(tablesIn(wordPages(manyPages(13, 5)))).toHaveLength(0);
    expect(tablesIn(wordPages(noLongerModel()))).toHaveLength(1);
  });

  it("gives every page its blocks, in the latest run's order, and each transcript to the page it is of", async () => {
    for (const [name, model] of await models()) {
      const pages = wordPages(model);
      const parts = pagePartsOf(pages, model);
      const entries = new Map(model.appendix.map((entry) => [entry.slug, entry]));

      expect(parts, name).toHaveLength(model.pages.length);
      for (const [index, card] of model.pages.entries()) {
        const entry = entries.get(card.slug);
        const transcripts = (parts[index] ?? []).filter(
          (block) => block.kind === "heading" && block.level === 3,
        );

        expect(transcripts, `${name}, ${card.path}`).toHaveLength(
          (entry?.files.length ?? 0) + (entry?.unreadable.length ?? 0),
        );
      }
    }
  });

  it("links to nothing but axe's own page on a rule, since the page's other links go to its own parts, which this copy has in order", async () => {
    for (const [name, model] of await models()) {
      const links = linesIn(wordPages(model)).flatMap((line) =>
        line.flatMap((piece) =>
          typeof piece !== "string" && piece.href !== undefined ? [piece.href] : [],
        ),
      );

      expect(hrefsOf(wordPages(model)), name).toEqual(links);
      for (const href of links)
        expect(href.startsWith(AXE_TEXT.rulePages), `${name}: ${href}`).toBe(true);
      // Only the model with axe's results has any.
      expect(links.length > 0, name).toBe(name === "axe's results");
    }
  });

  it("says nothing of the page's folds or its fingerprint check, which the Word copy has none of", async () => {
    for (const [name, model] of await models()) {
      // The transcripts are NVDA's words, and any words may be in one.
      const words = wordsOf(wordPages(model).filter((block) => block.kind !== "mono")).join("\n");

      expect(words, name).not.toMatch(/fingerprint check|Open a page|opens to show/i);
    }
  });

  it("never calls voicecap automated, and never says a person listened", async () => {
    for (const [name, model] of await models()) {
      const words = wordsOf(wordPages(model).filter((block) => block.kind !== "mono"));
      for (const line of words) {
        expect(line, name).not.toMatch(/voicecap[^.]*\bautomated\b/i);
        expect(line, name).not.toMatch(/\blistened\b/i);
      }
    }
  });

  it("sets the page's fixed words as the page says them", async () => {
    const model = await demoModel();
    const said = (blocks: Block[]) => wordsOf(blocks).join("\n");

    for (const words of [PAGES_TEXT.title, PAGES_TEXT.noFlags, PAGES_TEXT.heardFirst]) {
      expect(said(wordPages(model)), words).toContain(words);
    }
    expect(said(wordPages(noLongerModel()))).toContain(PAGES_TEXT.noLongerListedLead);
    expect(said(wordPages(lostModel()))).toContain(`${APPENDIX_TEXT.unreadable}.`);
    // The page says each of these in its own headings and lines.
    const page = renderPages(model);
    for (const words of [PAGES_TEXT.title, PAGES_TEXT.heardFirst, PAGES_TEXT.fullTranscript]) {
      expect(page, words).toContain(words);
    }
  });

  /** Markup, a quote, and an ampersand: wherever a record's words are said, they stay so. */
  const MARKUP = `<x y="1">&'</x>`;
  const marked = (field: string): string => `${MARKUP}${field}`;

  /**
   * A model with every word a record can supply (the model's strings, in a card, a flag, the pages
   * no longer listed, and the transcripts) made of markup, each marked with the field it's in.
   */
  function markupModel(): ShareModel {
    const base = modelOf([done("/a"), done("/b")]);
    const [evidence, ...earlierEvidence] = base.evidence;
    const [first, second] = base.pages;
    if (!first || !second || !evidence) throw new Error("The fixture lost a page or a run.");
    // What axe supplies: a rule's id and words, an element's selector and HTML, axe's words on how
    // to fix it, and the words of what needs review.
    const kept = keptAxe({
      violations: [
        rawRule(marked("axe-rule"), {
          help: marked("axe-help"),
          nodes: [
            rawNode(".a", {
              html: marked("axe-html"),
              target: [marked("axe-selector")],
              failureSummary: marked("axe-fix"),
            }),
          ],
        }),
      ],
      incomplete: [rawRule("color-contrast", { help: marked("axe-review") })],
    });
    const view = axeViewOf(kept.text);
    if (view === null) throw new Error("The fixture's axe results can't be read.");
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
      heardFirst: [marked("first")],
      axe: {
        view,
        text: kept.text,
        bytes: 9,
        sha256: marked("axe-sha"),
        run: "r1",
        slug: first.slug,
      },
    };
    const other: PageCard = {
      ...second,
      name: marked("name-b"),
      labeled: false,
      path: marked("path-b"),
      from: { run: marked("run"), date: marked("date") },
      title: { notRecorded: marked("untitled") },
      flags: [{ rule: marked("flag-b"), message: "m" }],
      axe: { notRecorded: marked("axe-reason") },
    };
    return {
      ...base,
      pages: [home, other],
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
    const words = wordsOf(wordPages(markupModel())).join("\n");
    // No field's name is the start of another's, so each is found by its own words. A page with no
    // label of its own is said by its path alone, so `name-b` isn't said; and no transcript
    // entry's own name is, since each page's heading is its card's.
    const fields = [
      ...["name-a", "path-a", "title", "status", "review", "at", "reviewer", "shot", "failure"],
      ...["time", "flag-a", "first", "path-b", "run", "date", "untitled", "flag-b", "gone", "url"],
      ...["lastRun", "lastStatus", "words", "sha", "latest"],
      ...["axe-rule", "axe-help", "axe-html", "axe-selector", "axe-fix", "axe-review", "axe-sha"],
      "axe-reason",
    ];

    for (const field of fields) expect(words, field).toContain(marked(field));
    // Nothing is escaped: the document holds words, and the library sets each in a run of its own.
    expect(words).not.toContain("&lt;");
    expect(words).not.toContain("&amp;");
    expect(words).not.toContain("&#39;");
  });
});
