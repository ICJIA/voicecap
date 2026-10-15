/**
 * The shareable page as a reader gets it: written to a folder by writeShareFiles from a site's
 * records, then opened from a file in headless Chromium. It's checked for accessibility (axe, in
 * both themes, with its folds closed and open), for loading nothing from outside the file, for what
 * its scripts do with its folds, and for its fingerprint check, run on the page's own data.
 *
 * Six sites make the pages: the demo runs of 29 September 2026 (copied, so the page goes in the
 * copy), where each run failed a page the other read, as Review Focus 5 describes; a site made by
 * voicecap's own commands, with reviews, a manual session, a page that sounds different, and a
 * page that failed, whose runs record their event logs; a site whose transcripts hold markup and a
 * closing script tag; a site whose host is one long word, with no name set and no title on its home
 * page; a site whose config gives it a canonical address and a long name, which the page leads
 * with; and a site whose only run was a replay, as in CI's smoke test. Ten more pages are written
 * from models: a run whose event log has all a chart can draw, three of what needs attention, with
 * 5 cards, 6 cards, and i2i's one card on 32 pages, two with no problem to name: one where every
 * page was read, and one with a page skipped; one of 13 pages, whose 11 with nothing to note
 * fold behind one line, each card holding a fold of its own transcript; two of the real run of
 * 6 October 2026 with NVDA's own log checked against its transcripts: one where every line agrees,
 * and one with a line that differs in each direction and steps that weren't checked; and a problem
 * whose record has NVDA's own warnings and errors in it, a traceback among them.
 *
 * axe finds no background for words drawn in an SVG, so the words of an event log's chart are
 * measured here instead, against the bars and the fold they're drawn on, in both themes.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { keptAxeResults } from "../src/axe/results.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { gestureOf } from "../src/drivers/guidepup/nvda-log.js";
import { addManualSession } from "../src/manual-add.js";
import { addReview } from "../src/reviews/review.js";
import { runAudit } from "../src/run/audit.js";
import { runDir, sharePath } from "../src/run/paths.js";
import { fontFaceCss } from "../src/share/fonts.js";
import { renderSharePage } from "../src/share/html/document.js";
import { loadShareInput } from "../src/share/load.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import { renderVoicePage } from "../src/share/voice-page.js";
import { walkthroughJson, walkthroughOf } from "../src/share/walkthrough.js";
import { writeShareFiles } from "../src/share/write.js";
import { fileHash } from "../src/transcripts/write.js";
import { createMemoryLogger } from "../src/util/log.js";
import { identicalLinks, launchBrowser, violations } from "./helpers/axe.js";
import { footerInTwoWindows, footerPlacement } from "./helpers/footer.js";
import { TINY_JPEG } from "./helpers/jpeg.js";
import { keptLogsModel, nvdaFixtureSite, problemEntry } from "./helpers/nvda-log.js";
import { rawAxe, rawNode, rawRule } from "./helpers/raw-axe.js";
import { config, options, outDir, setup, SITE, sitePages } from "./helpers/run-site.js";
import { element, ScriptedDriver } from "./helpers/scripted-driver.js";
import { i2iModel, linkModel } from "./helpers/share-attention.js";
import { failedAttempt, shareRun } from "./helpers/share-data.js";
import { demoRun } from "./helpers/share-fixture.js";
import {
  DEMO_SITE,
  heldRecordings,
  inputOf,
  LINES,
  loggedModel,
  manyPages,
  recordedVoice,
  recordingsOf,
  storeOf,
  TRANSCRIPTS,
  VOICE_PAGE,
  VOICE_RECORDED_AT,
  voiceRecord,
} from "./helpers/share-model.js";
import { busySound, speechAndPauses } from "./helpers/voice-signal.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = (...parts: string[]) => path.join(ROOT, "fixture", ...parts);

/**
 * The demo page /how-a-run-works/, by its name in the page's ids and data. Run 1402 failed it, so
 * the page shows run 1315's transcripts of it.
 */
const HOW = "how-a-run-works-fd116f9328";

/** The check's result on the demo's page as written: the mockup's own line. */
const MATCHING =
  "Checked just now, in this browser. " +
  "21 of 21 transcripts match their fingerprints, and both runs' seals check out.";

/** Markup, a closing script tag, a comment, and the two line separators JSON allows. */
const HOSTILE_LINES = [
  "</script><script>window.__pwned = true</script>",
  "<!-- not a comment, and <script> not a script -->",
  "<b>bold</b> & “quoted” \"straight\" 'single'",
  `separators ${String.fromCharCode(0x2028, 0x2029)} and 😀`,
];

/**
 * A page's address as long ones are on real sites: a title's words joined by hyphens, and a run of
 * short segments a line can't be broken at. The page's names are whole addresses.
 */
const LONG_PATH =
  "/researchhub/articles/a-very-long-article-title-about-trauma-informed-practice-in-illinois-courts-2026-update" +
  "/with/another/very/long/segment/that/continues/for/quite/a/while/more";

/**
 * A site's host as long as the sub-site of an agency can have: 30 characters, in one word. With no
 * name set for the site and no title on its home page, it's the page's name and its address.
 */
const LONG_HOST = "researchhub.icjia.illinois.gov";

/**
 * The address people visit a site at, as its config says it, and the name the config gives the
 * site: long enough to need more than a line of a phone's window, and one of its words as long as a
 * name can be. The site is read at SITE, which no reader meets.
 */
const CANONICAL = "https://dvfr.illinois.gov/";
const SITE_NAME = `Domestic Violence Fatality Review of the Illinois Criminal Justice Information Authority ${"x".repeat(40)}`;

/** The phrases the default rules call generic link text, each of which makes a card of its own. */
const PHRASES = ["click here", "read more", "learn more", "here", "more", "more info", "details"];

/** The ids of the demo's five cards of what needs attention, all open as the page is written. */
const DEMO_CARDS = ["need-1", "need-2", "need-3", "need-4", "need-5"];

/**
 * An error of NVDA's own log with a traceback: lines with the spaces that indent them, markup and
 * an ampersand, and a blank line, as a problem's record shows it line by line.
 */
const TRACEBACK = [
  "Error accepting connection",
  "Traceback (most recent call last):",
  '  File "_remoteClient\\server.pyc", line 385, in acceptNewConnection',
  "    <b>raise</b> OSError & more",
  "",
  "ssl.SSLEOFError: [SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred in violation of protocol",
];

/** What the check's data holds, as far as these tests look at it. */
interface Data {
  runs: {
    id: string;
    pages: { slug: string; files: Record<string, { sha256: string }> }[];
  }[];
  files: { run: string; slug: string; name: string; text: string }[];
}

/** Each folder made for the sites, to remove at the end. */
const folders: string[] = [];

/** The page voicecap writes for a site folder, or what stopped it. */
async function pageOf(siteDir: string, now?: Date): Promise<string> {
  const logger = createMemoryLogger();
  const files = await writeShareFiles({
    siteDir,
    config: DEFAULT_CONFIG,
    logger,
    ...(now === undefined ? {} : { now }),
  });
  if (files === null || files.page === null) {
    throw new Error(`The page wasn't written: ${logger.text("warn")}`);
  }
  return files.page;
}

/** The demo runs, in a copy, with the page written in the copy. */
async function demoPage(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "voicecap-share-demo-"));
  folders.push(root);
  const siteDir = path.join(root, path.basename(DEMO_SITE));
  await cp(DEMO_SITE, siteDir, { recursive: true });
  return pageOf(siteDir, new Date("2026-09-30T09:00:00-05:00"));
}

/**
 * Two runs, a review, a fixed issue, and a manual session, all through voicecap's own commands,
 * each of which writes the page again. In the second run the home page and /about are read (and
 * /about sounds different), and the page with the long address (LONG_PATH) can't be opened, so its
 * transcripts are the first run's. A person said they heard NVDA speaking in both runs, the whole
 * time. Each page that's loaded takes a screenshot (TINY_JPEG): the page shows three of them, each
 * on its card.
 */
async function richPage(): Promise<string> {
  const dir = await setup(["/", "/about", LONG_PATH]);
  folders.push(dir);
  const logger = createMemoryLogger();
  const picture = { screenshot: { jpeg: TINY_JPEG } };
  const titled = { title: "Example Agency", ...picture };
  const long = { url: `${SITE}${LONG_PATH}` };
  const run = (driver: ScriptedDriver, when: Date, attempts: number) =>
    runAudit({
      ...options(dir, driver, {
        logger,
        fresh: true,
        now: () => when,
        askListener: () => Promise.resolve("all" as const),
      }),
      config: config({ pageAttempts: attempts }),
    });

  await run(
    new ScriptedDriver(
      sitePages({ home: titled, about: picture, resources: { ...long, ...picture } }),
    ),
    new Date(2026, 8, 26, 14, 5),
    1,
  );
  await run(
    new ScriptedDriver(
      sitePages({
        home: titled,
        about: {
          lines: ["heading, level 1, About us", "We have a new address.", "© 2026 Example Agency"],
          ...picture,
        },
        resources: { ...long, openError: new Error("NVDA is not responding") },
      }),
    ),
    new Date(2026, 8, 27, 9, 30),
    2,
  );
  const common = { cwd: dir, env: {}, logger, config: config() };
  await addReview({ ...common, page: "/about", status: "reviewed", reviewer: "Pat Reviewer" });
  await addReview({
    ...common,
    page: LONG_PATH,
    status: "issue",
    note: "Two links say only Read more.",
    reviewer: "Pat Reviewer",
  });
  await addReview({ ...common, page: LONG_PATH, status: "fixed", reviewer: "Pat Reviewer" });
  await addManualSession({
    ...common,
    file: fixture("manual", "nvda-io-log.txt"),
    page: "/",
    date: "2026-09-25",
    redactTyping: true,
    reviewer: "Sam Tester",
  });
  expect(logger.text("warn")).not.toContain("shareable page");
  expect(logger.text("warn")).not.toContain("Word copy");
  // It shows what the demo's page can't: a review, a manual session, a page that sounds different,
  // and the error that stopped the second run reading the page with the long address.
  const page = await readFile(sharePath(outDir(dir)), "utf8");
  for (const shown of [
    "Pat Reviewer",
    "Sam Tester",
    "sounds different",
    "NVDA is not responding",
  ]) {
    expect(page, shown).toContain(shown);
  }
  return sharePath(outDir(dir));
}

/** One run, whose home page has a title, headings, and transcripts full of markup. */
async function hostilePage(): Promise<{ file: string; siteDir: string; runId: string }> {
  const dir = await setup();
  folders.push(dir);
  const pages = sitePages({
    home: {
      title: "Grants </title></script><b>Agency</b>",
      lines: ["link, Skip to main content", ...HOSTILE_LINES],
      headings: ["heading, level 1, <b>Welcome</b> </script>"],
      stops: [{ spoken: "</script><!-- link", focused: element("</script><!--") }],
    },
  });
  const result = await runAudit(options(dir, new ScriptedDriver(pages)));
  expect(result.outcome).toBe("completed");
  return { file: sharePath(result.siteDir), siteDir: result.siteDir, runId: result.runId };
}

/** One run of the scripted site's pages on a host that is LONG_HOST, with no title for any page. */
async function longHostPage(): Promise<string> {
  const dir = await setup();
  folders.push(dir);
  const site = `https://${LONG_HOST}`;
  const scripted = sitePages().map((page) => ({ ...page, url: page.url.replace(SITE, site) }));
  const result = await runAudit({ ...options(dir, new ScriptedDriver(scripted)), site });
  expect(result.outcome).toBe("completed");
  // Its name is the host, since nothing else names it.
  const written = await readFile(sharePath(result.siteDir), "utf8");
  expect(written).toContain(`<h1>${LONG_HOST}</h1>`);
  return sharePath(result.siteDir);
}

/**
 * One run of the scripted site, read at SITE, whose config gives it a canonical address and a name:
 * the page leads with the canonical name and when it was tested, then the name the config gave, and
 * shows the root last, as a link.
 */
async function namedPage(): Promise<string> {
  const dir = await setup();
  folders.push(dir);
  const result = await runAudit({
    ...options(dir, new ScriptedDriver(sitePages())),
    config: config({ report: { canonical: CANONICAL, siteName: SITE_NAME } }),
  });
  expect(result.outcome).toBe("completed");
  const written = await readFile(sharePath(result.siteDir), "utf8");
  expect(written).toContain("<h1>dvfr.illinois.gov</h1>");
  return sharePath(result.siteDir);
}

/**
 * The page of a run whose event log has all a chart can draw: the lock, voicecap's NVDA and the
 * computer's own, the pages, a page that failed, and the program that took the screen, over two
 * sessions (test/helpers/share-model.ts's loggedRun). Written as the page is, from its model.
 */
async function loggedPage(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "voicecap-share-logged-"));
  folders.push(folder);
  const file = path.join(folder, "logged.html");
  await writeFile(file, renderSharePage(loggedModel(), { fontCss: await fontFaceCss() }));
  return file;
}

/** The page of a model, written as the page is, to a folder of its own. */
async function modelPage(model: ShareModel, name: string): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "voicecap-share-cards-"));
  folders.push(folder);
  const file = path.join(folder, `${name}.html`);
  await writeFile(file, renderSharePage(model, { fontCss: await fontFaceCss() }));
  return file;
}

/**
 * The model of the real run of 6 October 2026 as a voicecap that keeps NVDA's log could have made
 * it. With `differing`, NVDA's log says something else of two steps (one more word in one, one
 * fewer in the other), so the check lists a line in each direction, and two groups of steps weren't
 * checked.
 */
async function nvdaLogModel(differing: boolean): Promise<ShareModel> {
  const { siteDir } = await nvdaFixtureSite({
    change: (parts) => {
      if (!differing) return;
      parts.copy = parts.copy
        .replace(
          "'This small site shows how voicecap works, one page at a time.'",
          "'This small site shows how voicecap works, one page at a time, today.'",
        )
        .replace("'Welcome to the voicecap demo'", "'Welcome'");
    },
  });
  const model = buildShareModel(
    await loadShareInput({ siteDir, config: DEFAULT_CONFIG, gestureOf }),
  );
  const [first, ...rest] = model.evidence;
  if (!differing || first === undefined || !("agree" in first.nvdaLog)) return model;
  const notChecked = [
    {
      steps: 8,
      from: "2026-10-06T08:08:14.442-05:00",
      why: "reason" as const,
      detail: "NVDA's log wasn't there.",
    },
    { steps: 3, from: null, why: "unread" as const, detail: null },
  ];
  return { ...model, evidence: [{ ...first, nvdaLog: { ...first.nvdaLog, notChecked } }, ...rest] };
}

/**
 * A run of voicecap 0.18.0 whose pages NVDA's voice was recorded on, as a share makes the page, with
 * the voice page beside it: the home page, a page with a label of a dozen words and an hour's
 * recording, a page at a long address, and a page that failed after it was recorded, so its card has
 * a line and no transcripts. A fifth page has no recording, and no line. The details link to the
 * voice page.
 */
function voiceCardsModel(): ShareModel {
  const read = { files: TRANSCRIPTS, passes: LINES };
  const run = shareRun({
    id: "2026-10-09_0900",
    voicecapVersion: "0.18.0",
    pages: [
      { path: "/", label: "Home", ...read, voice: voiceRecord(134.2) },
      {
        path: "/grants/",
        label: "A grant program with a label of a dozen words that can't fit one line of a phone",
        ...read,
        voice: voiceRecord(3_725),
      },
      { path: LONG_PATH, ...read, voice: voiceRecord(61) },
      {
        path: "/apply/",
        status: "failed",
        failedAttempts: [failedAttempt({ n: 1 })],
        voice: voiceRecord(7),
      },
      { path: "/about/", ...read },
    ],
  });
  return buildShareModel(
    inputOf([run], {
      transcripts: storeOf(),
      recordings: heldRecordings([run]),
      voiceName: VOICE_PAGE,
    }),
  );
}

/** A word as long as an element's HTML can be in an axe.json (300 code units), less its markup. */
const LONG_WORD = "x".repeat(280);

/**
 * One run whose driver checked each page with axe, written as voicecap writes the page. The home
 * page's results are what a card's fold holds at its most: an issue of each impact, the most
 * severe given last; a rule that found 60 elements, of which the file keeps 50; an element whose
 * selector and HTML are each one long word; axe's words and an element's HTML holding markup and a
 * closing script tag; and what needs review. /about's results have nothing, and axe couldn't check
 * /resources. Each fold is on its page's card, and each file's text is in the page's data.
 */
async function axePage(): Promise<string> {
  const dir = await setup();
  folders.push(dir);
  const home = rawAxe({
    violations: [
      rawRule("link-name", {
        impact: "minor",
        help: "Links must have discernible text",
        nodes: [
          rawNode("a.more", {
            html: '<a class="more" href="/x"></script><script>window.__pwned = true</script> & </a>',
            failureSummary: "Fix all of the following:\n  <b>bold</b> & “quoted” words",
          }),
        ],
      }),
      rawRule("region", {
        impact: "moderate",
        tags: ["cat.keyboard", "best-practice"],
        help: "All page content should be contained by landmarks",
        nodes: [
          rawNode("#promo", { html: `<div id="promo" data-note="${LONG_WORD}">Grants</div>` }),
        ],
      }),
      rawRule("color-contrast", {
        tags: ["cat.color", "wcag2aa", "wcag143"],
        help: "Elements must meet minimum color contrast ratio thresholds",
        nodes: [
          rawNode(".pale", {
            target: [`html > body > main > div.${LONG_WORD} > p`],
            html: `<p class="${LONG_WORD}">Apply by 1 May</p>`,
          }),
        ],
      }),
      rawRule("button-name", {
        impact: "critical",
        help: "Buttons must have discernible text",
        nodes: Array.from({ length: 60 }, (_, index) => rawNode(`#button-${index}`)),
      }),
    ],
    incomplete: [
      rawRule("color-contrast", {
        tags: ["cat.color", "wcag2aa", "wcag143"],
        help: "Elements must meet minimum color contrast ratio thresholds",
        nodes: [rawNode(".hero h2", { html: "<h2>Welcome</h2>" })],
      }),
    ],
    passes: 41,
    inapplicable: 50,
  });
  const pagesChecked = sitePages({
    home: { title: "Example Agency", axe: keptAxeResults(home, `${SITE}/`) },
    about: { axe: keptAxeResults(rawAxe({ passes: 30, inapplicable: 60 }), `${SITE}/about`) },
    resources: { axe: { error: "timed out after 20s" } },
  });
  const result = await runAudit(options(dir, new ScriptedDriver(pagesChecked)));
  expect(result.outcome).toBe("completed");
  return sharePath(result.siteDir);
}

/** One run, a replay of the fixture's recorded run: it never counts, so nothing counts yet. */
async function replayPage(): Promise<{ file: string; runId: string }> {
  const dir = await setup();
  folders.push(dir);
  const result = await runAudit({
    ...options(dir, undefined),
    site: "http://127.0.0.1:4747",
    pages: fixture("pages.json"),
    replayFrom: fixture("replay-run"),
  });
  expect(result.outcome).toBe("completed");
  return { file: sharePath(result.siteDir), runId: result.runId };
}

let browser: Browser;
/** The page files, by the site they were written for. */
let pages: {
  demo: string;
  rich: string;
  hostile: string;
  longHost: string;
  named: string;
  replay: string;
  logged: string;
  /** NVDA's own log, checked against the transcripts: every line agrees, and lines that differ. */
  nvdaAgree: string;
  nvdaDiffers: string;
  /** A problem's record with NVDA's own warnings and errors among its rows, a traceback too. */
  nvdaRecord: string;
  /** What needs attention: 5 cards (all open), 6 (all folded), and i2i's one card on 32 pages. */
  five: string;
  six: string;
  i2i: string;
  /** No card to name: every page was read, and one page was read and one skipped. */
  none: string;
  skipped: string;
  /** 13 pages read in full, 2 with flags: the other 11 are folded, each card holding its transcripts. */
  many: string;
  /** A run whose driver checked each page with axe: each card holds what axe found, in a fold. */
  axe: string;
  /** A run whose pages NVDA's voice was recorded on: each card links to its place on the voice page. */
  voice: string;
};
/** Where the site with markup in its transcripts kept its run, and the id of the replayed run. */
let hostileRun: { siteDir: string; runId: string };
let replayRunId: string;
const contexts: BrowserContext[] = [];
/** What each page opened in a test reported going wrong: errors thrown, and written to its console. */
const reported: string[] = [];

beforeAll(async () => {
  browser = await launchBrowser();
  // One after the other, so a site that fails to build never leaves another still being written
  // while the folders are removed.
  const demo = await demoPage();
  const rich = await richPage();
  const hostile = await hostilePage();
  const longHost = await longHostPage();
  const named = await namedPage();
  const replay = await replayPage();
  const logged = await loggedPage();
  const nvdaAgree = await modelPage(await nvdaLogModel(false), "nvda-agree");
  const nvdaDiffers = await modelPage(await nvdaLogModel(true), "nvda-differs");
  const nvdaRecord = await modelPage(
    keptLogsModel([
      problemEntry(
        "WARNING",
        "14:04:10.000",
        "Invalid voice: HKEY_LOCAL_MACHINE\\SOFTWARE\\Voices",
      ),
      problemEntry("ERROR", "14:04:20.123", ...TRACEBACK),
    ]),
    "nvda-record",
  );
  const five = await modelPage(linkModel(PHRASES.slice(0, 5)), "five");
  const six = await modelPage(linkModel(PHRASES.slice(0, 6)), "six");
  const i2i = await modelPage(i2iModel(), "i2i");
  // Nothing needs attention, with every page read, and with a page skipped: no card, and no flag
  // raised, so the details say so in place of their bar of flags by rule.
  const ofPages = (pagesRead: { path: string; status?: "skipped" }[]) =>
    buildShareModel(inputOf([shareRun({ id: "r1", pages: pagesRead })]));
  const none = await modelPage(ofPages([{ path: "/" }]), "none");
  const skipped = await modelPage(
    ofPages([{ path: "/" }, { path: "/file-1/", status: "skipped" }]),
    "skipped",
  );
  // More pages than a page shows in the open (12): the cards with nothing to note are folded, and
  // each holds a fold of its own transcript.
  const many = await modelPage(manyPages(13, 2), "many");
  const axe = await axePage();
  const voice = await modelPage(voiceCardsModel(), "voice");
  pages = {
    demo,
    rich,
    hostile: hostile.file,
    longHost,
    named,
    replay: replay.file,
    logged,
    nvdaAgree,
    nvdaDiffers,
    nvdaRecord,
    five,
    six,
    i2i,
    none,
    skipped,
    many,
    axe,
    voice,
  };
  hostileRun = hostile;
  replayRunId = replay.runId;
});

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
  // Nothing the pages did went wrong, in any test.
  expect(reported.splice(0)).toEqual([]);
});

afterAll(async () => {
  await browser.close();
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A page's file as an address, with `hash` after it. */
const addressOf = (file: string, hash = ""): string => pathToFileURL(file).href + hash;

/** A context that reports what its pages do wrong, and is closed after the test. */
async function newContext(): Promise<BrowserContext> {
  const context = await browser.newContext();
  contexts.push(context);
  context.on("page", (page) => {
    page.on("pageerror", (error) => reported.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") reported.push(message.text());
    });
  });
  return context;
}

/** A page, open from its file, at `hash` when there is one. */
async function open(file: string, hash = ""): Promise<Page> {
  const page = await (await newContext()).newPage();
  await page.goto(addressOf(file, hash));
  return page;
}

/** Each fold's id (its place on the page, for one with none) and whether it's open. */
const foldStates = (page: Page): Promise<Record<string, boolean>> =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("details")].map((fold, index) => [
        fold.id || `fold ${index + 1}`,
        fold.open,
      ]),
    ),
  );

/** The cards of what needs attention, by id, and whether each is open. */
const cardStates = async (page: Page): Promise<Record<string, boolean>> =>
  Object.fromEntries(
    Object.entries(await foldStates(page)).filter(([id]) => /^need-\d+$/.test(id)),
  );

/** The folds that are open, in page order. */
const openFolds = (states: Record<string, boolean>): string[] =>
  Object.entries(states)
    .filter(([, open]) => open)
    .map(([id]) => id);

/**
 * Whether what `selector` finds is inside the window, from its top to its bottom, to within a
 * pixel: a browser that scrolls a heading to the window's top can leave it a fraction of one above.
 */
const inView = (page: Page, selector: string): Promise<boolean> =>
  page.evaluate((selected) => {
    const box = document.querySelector(selected)?.getBoundingClientRect();
    return box !== undefined && box.top >= -1 && box.bottom <= window.innerHeight + 1;
  }, selector);

const dispatch = (page: Page, type: string): Promise<void> =>
  page.evaluate((name) => {
    window.dispatchEvent(new Event(name));
  }, type);

const result = async (page: Page): Promise<string> =>
  (await page.locator("#fp-result").textContent()) ?? "";

/**
 * What runs out of its box or past the window: how far the page is wider than the window, and each
 * box whose contents are wider than it is (clipped by it, or running out of it). A box the reader
 * scrolls on purpose isn't counted, nor what's in it.
 */
const overflowOf = (page: Page): Promise<{ beyondTheWindow: number; boxes: string[] }> =>
  page.evaluate(() => {
    const root = document.documentElement;
    const boxes = [...document.querySelectorAll("body *")]
      .filter(
        (box) =>
          !box.closest("svg, .sr, .scroll, .events") &&
          box.clientWidth > 0 &&
          box.scrollWidth > box.clientWidth + 1 &&
          !["auto", "scroll"].includes(getComputedStyle(box).overflowX),
      )
      .map(
        (box) =>
          `${box.tagName.toLowerCase()}.${box.className}: ${(box.textContent ?? "").trim().slice(0, 40)}`,
      );
    return { beyondTheWindow: root.scrollWidth - root.clientWidth, boxes };
  });

/** A box as it is drawn, in pixels from the window's top left corner. */
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

/** The ids of the headings of the details' three parts that are a panel under a heading. */
const PANEL_PARTS = ["todo-h", "complete-h", "whenhow-h"];

/**
 * The details' three plain parts as they are drawn: the details' own box, and for each part its
 * title and its panel's box, in page order.
 */
async function partsOf(page: Page): Promise<{ details: Box; panels: (Box & { title: string })[] }> {
  return page.evaluate((ids) => {
    const boxOf = (element: Element) => {
      const { left, right, top, bottom, width } = element.getBoundingClientRect();
      return { left, right, top, bottom, width };
    };
    const found = document.querySelector("#details");
    if (found === null) throw new Error("The page has no details.");
    return {
      details: boxOf(found),
      panels: ids.map((id) => {
        const heading = document.getElementById(id);
        const panel = heading?.parentElement?.querySelector(":scope > .panel");
        if (heading === null || heading === undefined || !panel) {
          throw new Error(`The details have no panel under ${id}.`);
        }
        return { title: heading.textContent ?? "", ...boxOf(panel) };
      }),
    };
  }, PANEL_PARTS);
}

/**
 * Each line NVDA said on a card, as it is drawn, by place in page order: its key's box ("Down
 * Arrow:", with its words) and its quote's box.
 */
function quotesOf(
  page: Page,
  card: string,
): Promise<{ key: Box & { text: string }; quote: Box }[][]> {
  return page.evaluate((id) => {
    const boxOf = (element: Element) => {
      const { left, right, top, bottom, width } = element.getBoundingClientRect();
      return { left, right, top, bottom, width };
    };
    return [...document.querySelectorAll(`#${id} .place`)].map((place) =>
      [...place.querySelectorAll(":scope > p")].flatMap((line) => {
        const key = line.querySelector(".pass");
        const quote = line.querySelector("code");
        return key === null || quote === null
          ? []
          : [{ key: { text: key.textContent ?? "", ...boxOf(key) }, quote: boxOf(quote) }];
      }),
    );
  }, card);
}

/** Whether two boxes share any area, past half a pixel: boxes that only touch don't meet. */
function meet(a: Box, b: Box): boolean {
  const overlap = (from: number, to: number, start: number, end: number) =>
    Math.min(to, end) - Math.max(from, start) > 0.5;
  return overlap(a.left, a.right, b.left, b.right) && overlap(a.top, a.bottom, b.top, b.bottom);
}

/**
 * The letters of the lines NVDA said that are drawn outside their quote's box, as the browser lays
 * them out: a line of text, of each quote, whose box isn't inside the quote's border box. axe's
 * contrast check needs every one inside, to know what it's drawn on.
 */
function lettersOutside(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const outside: string[] = [];
    document.querySelectorAll(".place code").forEach((quote, at) => {
      const box = quote.getBoundingClientRect();
      for (const node of quote.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const line of range.getClientRects()) {
          const inside =
            line.left >= box.left - 0.01 &&
            line.right <= box.right + 0.01 &&
            line.top >= box.top - 0.01 &&
            line.bottom <= box.bottom + 0.01;
          if (!inside) {
            outside.push(
              `quote ${at + 1}: letters at ${line.left.toFixed(2)} to ${line.right.toFixed(2)} px, its box ${box.left.toFixed(2)} to ${box.right.toFixed(2)} px`,
            );
          }
        }
      }
    });
    return outside;
  });
}

/**
 * The contrast of each word of each chart of a run's event log, as WCAG measures it: its fill
 * against what it's drawn on, which is the bar it's written in (the shape just before it) or else
 * whatever is behind the chart. axe finds no background for text drawn in an SVG, so it can't measure
 * these (test/helpers/axe.ts): this does.
 */
const chartContrasts = (page: Page): Promise<{ words: string; ratio: number }[]> =>
  page.evaluate(() => {
    const luminance = (color: string): number => {
      const [r = 0, g = 0, b = 0] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
        const share = Number(value) / 255;
        return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const behind = (text: Element): string => {
      const shape = text.previousElementSibling;
      if (shape?.tagName === "rect" && /\bt-(?:in|note)\b/.test(text.getAttribute("class") ?? "")) {
        return getComputedStyle(shape).fill;
      }
      for (let box = text.closest("svg")?.parentElement; box; box = box.parentElement) {
        const color = getComputedStyle(box).backgroundColor;
        if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
      }
      return "rgb(255, 255, 255)";
    };
    return [...document.querySelectorAll("svg.timeline text")].map((text) => {
      const [high = 0, low = 0] = [
        luminance(getComputedStyle(text).fill),
        luminance(behind(text)),
      ].sort((a, b) => b - a);
      return { words: text.textContent ?? "", ratio: (high + 0.05) / (low + 0.05) };
    });
  });

/** Four runs of axe over a page 20,000 pixels tall take a while, more on a slow computer. */
const AXE_TIMEOUT = 120_000;

/**
 * What axe finds with the window as tall as the page. A line of text that runs past the window's
 * bottom edge has no known background there, which axe reports as contrast it couldn't check,
 * so the result would depend on where the window ends.
 */
async function axeFindings(page: Page, width = 1280): Promise<string[]> {
  // The page's height depends on its width, so the width is set first.
  await page.setViewportSize({ width, height: 900 });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height });
  return violations(page);
}

describe("axe, in Chromium", () => {
  it.each([
    ["the demo's page", "demo"],
    ["a page with reviews, flags, a changed page, and a failed page", "rich"],
  ] as const)(
    "has no axe violations, folds closed and open, dark and light: %s",
    async (_, which) => {
      const page = await open(pages[which]);
      const theme = () => page.getAttribute("html", "data-theme");
      const waitForResult = (start: RegExp) =>
        expect.poll(() => result(page), { timeout: 10_000 }).toMatch(start);

      expect(await theme()).toBe("dark");
      // The details: its eleven parts, each a heading one level under its own, and the sample of
      // what NVDA said folded in the one on how voicecap works. Nothing else in them is an h3.
      expect(await page.locator("#details > h2").count()).toBe(1);
      expect(await page.locator("#details h3").count()).toBe(11);
      expect(await page.locator("#details > section > h3").count()).toBe(11);
      expect(await page.locator("#how-h ~ details.heard-fold").count()).toBe(1);
      if (which === "rich") {
        // Its runs recorded their event logs: each has a chart and a folded table of its events.
        expect(await page.locator("svg.timeline").count()).toBe(2);
        expect(await page.locator("details.log").count()).toBe(2);
        // And a screenshot of each page, on its card, each with its alt text.
        expect(await page.locator("img").count()).toBe(3);
        expect(
          await page
            .locator("img")
            .evaluateAll((images) =>
              images
                .map((image) => image.getAttribute("alt") ?? "")
                .filter((alt) => alt.trim() === ""),
            ),
        ).toEqual([]);
      }
      expect(await axeFindings(page), "dark, folds closed").toEqual([]);

      // Open, with the check's list of every file checked, and a mismatch in it, in red.
      await page.locator("#open-all").click();
      expect(openFolds(await foldStates(page)).length).toBeGreaterThan(5);
      // Each run's walkthrough file is among what axe checks: its download is in view, open.
      const downloads = page.locator("a[download]");
      expect(await downloads.count()).toBe(2);
      for (const download of await downloads.all()) expect(await download.isVisible()).toBe(true);
      // The two downloads read alike, so each is named by its run: axe has no links to review.
      expect(await identicalLinks(page), "links that read alike").toEqual([]);
      await page.locator("#fp-demo").click();
      await waitForResult(/^Demonstration, on a copy/);
      expect(await axeFindings(page), "dark, folds open, a change caught").toEqual([]);

      // Open, in the light version, with everything matching.
      await page.locator("#theme-toggle").click();
      expect(await theme()).toBe("light");
      await page.locator("#fp-run").click();
      await waitForResult(/^Checked just now/);
      expect(await axeFindings(page), "light, folds open, everything matching").toEqual([]);

      await page.locator("#open-all").click();
      expect(await axeFindings(page), "light, folds closed").toEqual([]);
    },
    AXE_TIMEOUT,
  );

  it.each([
    ["390 px, the width of a phone", 390],
    ["320 px, the narrowest window WCAG's reflow rule asks a page to fit", 320],
  ] as const)(
    "has no axe violations at %s, on pages with long names",
    async (_, width) => {
      // What a narrow window holds worst: the page's names are whole addresses, and a site's host
      // is one word. One page has a long address, and the other a long host.
      // A third has a long name set for it, as a line under its canonical name, and the root of its
      // canonical address as a link, which in a narrow window is as long as its window.
      for (const which of ["rich", "longHost", "named"] as const) {
        const page = await open(pages[which]);
        expect(await axeFindings(page, width), `${which}, dark, folds closed`).toEqual([]);
        await page.locator("#open-all").click();
        await page.locator("#theme-toggle").click();
        expect(await axeFindings(page, width), `${which}, light, folds open`).toEqual([]);
      }
    },
    AXE_TIMEOUT,
  );

  it.each([1280, 390, 320])(
    "has no axe violations at %i px on a page with a run's event log in full, folds closed and open, dark and light",
    async (width) => {
      const page = await open(pages.logged);

      // Each session's chart, with all four lanes, and each session's table of events.
      expect(await page.locator("svg.timeline").count()).toBe(2);
      expect(await page.locator("svg.timeline >> nth=0").locator("text.t-lane").count()).toBe(4);
      expect(await page.locator("details.log").count()).toBe(2);
      expect(await axeFindings(page, width), "dark, folds closed").toEqual([]);
      await page.locator("#open-all").click();
      expect(await axeFindings(page, width), "dark, folds open").toEqual([]);
      await page.locator("#theme-toggle").click();
      expect(await axeFindings(page, width), "light, folds open").toEqual([]);
      await page.locator("#open-all").click();
      expect(await axeFindings(page, width), "light, folds closed").toEqual([]);
    },
    AXE_TIMEOUT,
  );

  it.each([1280, 390, 320])(
    "has no axe violations at %i px on a page with NVDA's own log checked against the transcripts, folds closed and open, dark and light",
    async (width) => {
      // The check: three tiles, a line that differs in each direction (two in each list), and two
      // groups of steps that weren't checked. The first page has every line agreeing.
      for (const which of ["nvdaAgree", "nvdaDiffers"] as const) {
        const page = await open(pages[which]);
        const lists = which === "nvdaDiffers" ? 2 : 0;

        expect(await axeFindings(page, width), `${which}, dark, folds closed`).toEqual([]);
        await page.locator("#open-all").click();
        // Open, the part is in view: its tiles, and its lists of lines.
        const part = page.locator(".log-check").first();
        expect(await part.isVisible(), which).toBe(true);
        expect(await part.locator(".cross > div").count(), which).toBe(3);
        expect(await part.locator("ul.diffs").count(), which).toBe(lists);
        expect(await part.locator("h5").count(), which).toBe(lists);
        for (const line of await part.locator("ul.diffs li").all()) {
          expect(await line.isVisible(), which).toBe(true);
        }
        expect(await axeFindings(page, width), `${which}, dark, folds open`).toEqual([]);
        await page.locator("#theme-toggle").click();
        expect(await axeFindings(page, width), `${which}, light, folds open`).toEqual([]);
        await page.locator("#open-all").click();
        expect(await axeFindings(page, width), `${which}, light, folds closed`).toEqual([]);
      }
    },
    AXE_TIMEOUT,
  );

  it.each([1280, 390, 320])(
    "has no axe violations at %i px on a problem's record with NVDA's own warnings and errors in it, a traceback among them, folds closed and open, dark and light",
    async (width) => {
      const page = await open(pages.nvdaRecord);

      expect(await axeFindings(page, width), "dark, folds closed").toEqual([]);
      await page.locator("#open-all").click();
      // Open, the record has a row from NVDA's log for each entry, and the traceback's lines in view.
      const rows = page
        .locator("table.logtable tr")
        .filter({ has: page.locator("td.src", { hasText: /^nvda-log$/ }) });
      expect(await rows.count()).toBe(2);
      for (const row of await rows.all()) expect(await row.isVisible()).toBe(true);
      expect(await axeFindings(page, width), "dark, folds open").toEqual([]);
      await page.locator("#theme-toggle").click();
      expect(await axeFindings(page, width), "light, folds open").toEqual([]);
      await page.locator("#open-all").click();
      expect(await axeFindings(page, width), "light, folds closed").toEqual([]);
    },
    AXE_TIMEOUT,
  );

  it("draws an entry of NVDA's own log line by line, each line with its spaces, so a traceback keeps its indentation", async () => {
    const page = await open(pages.nvdaRecord);
    await page.locator("#open-all").click();

    // The traceback's cell: the second row from NVDA's log. Each line's text is a node of its own,
    // between the line breaks (the blank line has none).
    const drawn = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("table.logtable td.src")].filter(
        (cell) => cell.textContent === "nvda-log",
      );
      const code = rows[1]?.nextElementSibling?.querySelector("code");
      if (!code) throw new Error("The record has no traceback from NVDA's log.");
      const box = code.getBoundingClientRect();
      const lines = [...code.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => {
          // Where the line's first word begins: after the spaces that indent it.
          const text = node.textContent ?? "";
          const spaces = text.length - text.trimStart().length;
          const range = document.createRange();
          range.setStart(node, spaces);
          range.setEnd(node, spaces + 1);
          const first = range.getBoundingClientRect();
          return { text, indent: first.left - box.left, top: first.top };
        });
      return {
        whiteSpace: getComputedStyle(code).whiteSpace,
        breaks: code.querySelectorAll("br").length,
        lines,
      };
    });

    expect(drawn.whiteSpace).toBe("break-spaces");
    expect(drawn.breaks).toBe(TRACEBACK.length - 1);
    // The words as written, markup and all, each line in order, the first after the entry's level,
    // and the blank line between.
    const [message = "", ...traceback] = TRACEBACK;
    expect(drawn.lines.map(({ text }) => text)).toEqual(
      [`ERROR: ${message}`, ...traceback].filter((line) => line !== ""),
    );
    const [first, second, indented, deeper, last] = drawn.lines.map(({ indent }) => indent);
    expect([first, second, last].map((indent) => Math.round(indent ?? NaN))).toEqual([0, 0, 0]);
    // Two spaces, then four: each drawn as wide as it is, not collapsed to nothing.
    expect(indented).toBeGreaterThan(5);
    expect(deeper).toBeGreaterThan((indented ?? 0) + 5);
    // Each on a row of its own, in order.
    const tops = drawn.lines.map(({ top }) => top);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    expect(new Set(tops).size).toBe(tops.length);
  });

  it.each(["dark", "light"])(
    "draws every word of a chart of the event log in colors that meet WCAG AA against what it's on: %s",
    async (theme) => {
      for (const which of ["logged", "rich"] as const) {
        const page = await open(pages[which]);
        if (theme === "light") await page.locator("#theme-toggle").click();
        await page.locator("#open-all").click();
        const measured = await chartContrasts(page);

        // The full chart has its lanes' names, its minutes, and words in its bars: a process, a
        // page's number, the computer's own NVDA off, and where a page failed.
        expect(measured.length, which).toBeGreaterThan(which === "logged" ? 20 : 2);
        if (which === "logged") {
          expect(measured.map(({ words }) => words)).toEqual(
            expect.arrayContaining([
              "NVDA lock",
              "process 65720",
              "1",
              "off while voicecap ran",
              "page 2 failed",
              "14:03",
            ]),
          );
        }
        expect(
          measured.filter(({ ratio }) => !(ratio >= 4.5)),
          which,
        ).toEqual([]);
      }
    },
  );

  it.each([390, 320])(
    "has no axe violations at %i px on a page whose runs recorded their events, folds closed and open, dark and light",
    async (width) => {
      const page = await open(pages.rich);
      const charts = page.locator("svg.timeline");
      const tables = page.locator("details.log .events");

      expect(await charts.count()).toBe(2);
      expect(await axeFindings(page, width), "dark, folds closed").toEqual([]);
      await page.locator("#open-all").click();
      // Open, each table of events is in view, with a row for every event.
      for (const table of await tables.all()) expect(await table.isVisible()).toBe(true);
      expect(await page.locator("details.log tbody tr").count()).toBeGreaterThan(10);
      expect(await axeFindings(page, width), "dark, folds open").toEqual([]);
      await page.locator("#theme-toggle").click();
      expect(await axeFindings(page, width), "light, folds open").toEqual([]);
      await page.locator("#open-all").click();
      expect(await axeFindings(page, width), "light, folds closed").toEqual([]);
    },
    AXE_TIMEOUT,
  );

  it(
    "has no axe violations on the page of a site named by its canonical address, with a name set for it, at 1280 px",
    async () => {
      const page = await open(pages.named);

      expect(await axeFindings(page), "dark, folds closed").toEqual([]);
      await page.locator("#open-all").click();
      expect(await axeFindings(page), "dark, folds open").toEqual([]);
      await page.locator("#theme-toggle").click();
      expect(await axeFindings(page), "light, folds open").toEqual([]);
      await page.locator("#open-all").click();
      expect(await axeFindings(page), "light, folds closed").toEqual([]);
    },
    AXE_TIMEOUT,
  );

  it.each([1280, 390, 320])(
    "has no axe violations at %i px on the pages of what needs attention, with its cards open, folded, and every fold open, dark and light",
    async (width) => {
      // 5 cards, all open; 6, all folded; and i2i's one, with 32 pages in a fold of its own.
      for (const which of ["five", "six", "i2i"] as const) {
        const page = await open(pages[which]);

        expect(await page.locator("#need-h").count(), which).toBe(1);
        expect(await axeFindings(page, width), `${which}, dark, as written`).toEqual([]);
        await page.locator("#open-all").click();
        expect(Object.values(await cardStates(page)).every(Boolean), which).toBe(true);
        expect(await axeFindings(page, width), `${which}, dark, every fold open`).toEqual([]);
        await page.locator("#theme-toggle").click();
        expect(await axeFindings(page, width), `${which}, light, every fold open`).toEqual([]);
        await page.locator("#open-all").click();
        expect(await axeFindings(page, width), `${which}, light, folds as written`).toEqual([]);
      }
    },
    AXE_TIMEOUT,
  );

  it.each([1280, 390, 320])(
    "has no axe violations at %i px on the cards with what NVDA said first and their full transcripts, every fold closed and every fold open, dark and light",
    async (width) => {
      // The demo's 7 cards, each with a fold of its own, and 13 pages, whose 11 quiet cards are
      // folded behind one line, each holding a fold of its own: a fold inside a fold.
      for (const [which, transcripts] of [
        ["demo", 7],
        ["many", 13],
      ] as const) {
        const page = await open(pages[which]);

        expect(await page.locator("#pages figure.heard-first").count(), which).toBe(transcripts);
        expect(await page.locator("#pages details.tx-page").count(), which).toBe(transcripts);
        expect(await axeFindings(page, width), `${which}, dark, every fold closed`).toEqual([]);
        await page.locator("#open-all").click();
        expect(Object.values(await foldStates(page)).every(Boolean), which).toBe(true);
        expect(await axeFindings(page, width), `${which}, dark, every fold open`).toEqual([]);
        await page.locator("#theme-toggle").click();
        expect(await axeFindings(page, width), `${which}, light, every fold open`).toEqual([]);
        await page.locator("#open-all").click();
        expect(await axeFindings(page, width), `${which}, light, folds as written`).toEqual([]);
      }
    },
    AXE_TIMEOUT,
  );

  it.each([1280, 390, 320])(
    "has no axe violations at %i px on the cards' folds of what axe found, every fold closed and every fold open, dark and light",
    async (width) => {
      const page = await open(pages.axe);

      // Each card has its fold: results with issues, results with none, and why there's none.
      expect(await page.locator("#pages details.axe-page").count()).toBe(3);
      expect(await axeFindings(page, width), "dark, every fold closed").toEqual([]);
      await page.locator("#open-all").click();
      expect(Object.values(await foldStates(page)).every(Boolean)).toBe(true);
      // Open, every element the files keep is there: 50 of the 60 buttons, and one of each other.
      expect(await page.locator("#pages dl.axe-node").count()).toBe(50 + 3 + 1);
      expect(await page.locator("#pages .axe-rules h5").count()).toBe(5);
      expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
      expect(await axeFindings(page, width), "dark, every fold open").toEqual([]);
      // The links to axe's pages on its rules read apart: one name for each rule.
      expect(await identicalLinks(page), "links that read alike").toEqual([]);
      await page.locator("#theme-toggle").click();
      expect(await axeFindings(page, width), "light, every fold open").toEqual([]);
      await page.locator("#open-all").click();
      expect(await axeFindings(page, width), "light, folds as written").toEqual([]);
    },
    AXE_TIMEOUT,
  );

  it.each([1280, 390, 320])(
    "has no axe violations at %i px on the cards' lines that link to the voice page, and the details' link to it, dark and light, with nothing wider than 320",
    async (width) => {
      const page = await open(pages.voice);

      // A line on each of the four recorded pages' cards, a link to the voice page in the details,
      // and no line on the fifth card, which has no recording.
      expect(await page.locator("#pages article.card a[href*='.voice.html#voice-']").count()).toBe(
        4,
      );
      expect(await page.locator("#pages article.card").count()).toBe(5);
      expect(await page.locator("#details a[href$='.voice.html']").count()).toBe(1);
      expect(await axeFindings(page, width), "dark, folds closed").toEqual([]);
      // The links read apart: each card's names its page, so no two read alike.
      expect(await identicalLinks(page), "links that read alike").toEqual([]);
      const wide = await overflowOf(page);
      expect(wide.beyondTheWindow).toBeLessThanOrEqual(0);
      expect(wide.boxes).toEqual([]);
      await page.locator("#open-all").click();
      expect(await axeFindings(page, width), "dark, folds open").toEqual([]);
      await page.locator("#theme-toggle").click();
      expect(await axeFindings(page, width), "light, folds open").toEqual([]);
      await page.locator("#open-all").click();
      expect(await axeFindings(page, width), "light, folds closed").toEqual([]);
      expect((await overflowOf(page)).beyondTheWindow).toBeLessThanOrEqual(0);
    },
    AXE_TIMEOUT,
  );

  it.each([1280, 390, 320])(
    "has no axe violations at %i px on the details' parts when no flag was raised and nothing needs attention, or a page was skipped, dark and light, folds closed and open",
    async (width) => {
      // With flags and problems, the parts are checked above, on the demo's page and the pages of
      // what needs attention. Here the bar of flags by rule is a line, not rows, and no card is
      // left to name.
      for (const which of ["none", "skipped"] as const) {
        const page = await open(pages[which]);

        // The three plain parts, each a panel under its heading, and the two bars.
        expect(await page.locator("#details > section > h3 + .panel").count(), which).toBe(3);
        expect(await page.locator("#details > section > h3 + .meter").count(), which).toBe(2);
        expect(await page.locator("#rules-h + .meter .rule").count(), which).toBe(0);
        expect(await axeFindings(page, width), `${which}, dark`).toEqual([]);
        await page.locator("#theme-toggle").click();
        expect(await axeFindings(page, width), `${which}, light`).toEqual([]);
        await page.locator("#open-all").click();
        expect(await axeFindings(page, width), `${which}, light, folds open`).toEqual([]);
      }
    },
    AXE_TIMEOUT,
  );

  it.each([1280, 390, 320])(
    "has no axe violations at %i px on At a glance, whatever its verdict: problems to fix, none, and a page not read, dark and light",
    async (width) => {
      // The ring's number and unit are words laid over its picture, and axe finds no background
      // of words on a picture unless the words' own boxes say what they're on.
      for (const [which, kind] of [
        ["demo", "warn"],
        ["none", "ok"],
        ["skipped", "bad"],
      ] as const) {
        const page = await open(pages[which]);

        expect(await page.locator("p.verdict").getAttribute("class"), which).toBe(
          `verdict ${kind}`,
        );
        expect(await axeFindings(page, width), `${which}, dark`).toEqual([]);
        await page.locator("#theme-toggle").click();
        expect(await axeFindings(page, width), `${which}, light`).toEqual([]);
      }
    },
    AXE_TIMEOUT,
  );

  it("has no axe violations on the page of a site where no run counts yet", async () => {
    const page = await open(pages.replay);

    expect(await axeFindings(page), "dark, folds closed").toEqual([]);
    await page.locator("#open-all").click();
    await page.locator("#theme-toggle").click();
    expect(await axeFindings(page), "light, folds open").toEqual([]);
  });
});

describe("a page in a narrow window", () => {
  const FITS = { beyondTheWindow: 0, boxes: [] };

  it.each([1280, 390, 320])(
    "keeps every box's contents, and the page, inside the window at %i px, with folds closed and open",
    async (width) => {
      for (const which of [
        "demo",
        "rich",
        "longHost",
        "named",
        "logged",
        "nvdaRecord",
        "six",
        "i2i",
        "many",
        "axe",
      ] as const) {
        const page = await open(pages[which]);
        await page.setViewportSize({ width, height: 900 });
        expect(await overflowOf(page), `${which}, folds closed`).toEqual(FITS);
        await page.locator("#open-all").click();
        expect(await overflowOf(page), `${which}, folds open`).toEqual(FITS);
      }
    },
  );

  // The timeline is a table of three columns in a box that scrolls. At a phone's width it's laid
  // out to fit the box, so none of it is cut off at the box's edge, out of sight (and out of axe's
  // reach: it can't check the contrast of text it can't see).
  it.each([320, 390])("fits the timeline's table in its box at %i px", async (width) => {
    const page = await open(pages.demo);
    await page.setViewportSize({ width, height: 900 });

    const sizes = await page.evaluate(() => {
      const box = document.querySelector("table.tracks")?.closest(".scroll");
      if (!box) throw new Error("The page has no timeline in a box.");
      return { box: box.clientWidth, content: box.scrollWidth };
    });

    expect(sizes.content, `the table's width in a box ${sizes.box} px wide`).toBeLessThanOrEqual(
      sizes.box,
    );
  });

  // A name is a whole address, and can be one word longer than any box: the kinds of text it can be
  // in break it where they must, rather than run out of their boxes, or out of the window.
  it.each([
    ["a paragraph", "main p"],
    ["a list item", "main li"],
    ["a section's heading", "main h3"],
    ["a part's heading in the details", "#details > section > h3"],
    ["a heading inside a part of the details", "#details h4"],
    ["a transcript's heading, in a card", "#pages .tx h4"],
    ["a line NVDA said first, in a card", ".heard-first li"],
    ["a fold's line", "main summary"],
    ["a term", "main dt"],
    ["what a term means", "main dd"],
    ["a caption", "main figcaption"],
    // What NVDA said, and a fix's code: a card quotes lines of speech, and shows code in blocks.
    ["a line NVDA said, in a card", ".place code"],
    ["the code of a fix", ".fix pre"],
    ["the command that verifies the records", ".verify pre"],
    // The command that verifies the records has words of its own in a span; this one has none.
    ["the command that repeats a run", ".run-inside .verify:not(:has(span)) pre"],
    ["the words of a walkthrough file's download", ".run-inside a[download]"],
    ["the site's name", ".mast h1"],
    ["the site's address", ".mast-meta .addr"],
    ["a file name in the footer", "footer .mono"],
  ])("breaks a word longer than the window in %s", async (_, selector) => {
    const page = await open(pages.demo);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.locator("#open-all").click();

    await page.evaluate((selected) => {
      const text = document.querySelector(selected);
      if (text === null) throw new Error(`The page has no ${selected}.`);
      text.textContent = "w".repeat(150);
    }, selector);

    expect(await overflowOf(page)).toEqual(FITS);
  });

  // The same for what the top says under the name, on a page that has each: the name the config
  // gives the site, when it was tested, and the address, a link.
  it.each([
    ["the name set for the site", ".mast-site"],
    ["when it was tested", ".mast-tested"],
    ["the link to the site's address", ".mast-meta .addr a"],
  ])("breaks a word longer than the window in %s", async (_, selector) => {
    const page = await open(pages.named);
    await page.setViewportSize({ width: 320, height: 900 });

    await page.evaluate((selected) => {
      const text = document.querySelector(selected);
      if (text === null) throw new Error(`The page has no ${selected}.`);
      text.textContent = "w".repeat(150);
    }, selector);

    expect(await overflowOf(page)).toEqual(FITS);
  });
});

describe("the top of the page", () => {
  it("leads with the canonical name, then the name set for the site and when it was tested, and ends with the address as a link", async () => {
    const page = await open(pages.named);

    // What a reader sees of the header, in order: the buttons are the page's own.
    const lines = (await page.locator(".mast").innerText())
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    const at = (text: string) => lines.findIndex((line) => line.includes(text));

    expect(await page.locator("h1").allTextContents()).toEqual(["dvfr.illinois.gov"]);
    expect(await page.locator(".mast-site").textContent()).toBe(SITE_NAME);
    expect(await page.locator(".mast-tested").textContent()).toMatch(
      /^Tested \d{1,2} [A-Z][a-z]+ \d{4}, \d{2}:\d{2}$/,
    );
    const order = [
      "SCREEN READER TEST RESULTS",
      "dvfr.illinois.gov",
      SITE_NAME.slice(0, 20),
      "Tested ",
      "How its pages read aloud",
      "As of ",
      "Site address",
    ].map(at);
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The address is the canonical root: a link to it, with its words.
    const link = page.locator(".mast-meta .addr a");
    expect(await link.getAttribute("href")).toBe(CANONICAL);
    expect(await link.textContent()).toBe(CANONICAL);
    // Nothing a reader meets, with every fold open, holds the address voicecap read.
    await page.locator("#open-all").click();
    expect(await page.locator("body").innerText()).not.toContain("example.illinois.gov");
  });
});

describe("At a glance", () => {
  /** A page for each kind of verdict, with its words and the sign they are drawn after. */
  const KINDS = [
    ["problems to fix", "demo", "warn", "⚠", "5 problems need attention, on 2 pages"],
    ["nothing to fix", "none", "ok", "✓", "Nothing needs attention"],
    ["a page not read", "skipped", "bad", "⚠", "Nothing needs attention on the pages read"],
  ] as const;

  /** The boxes of what At a glance draws, as they are laid out. */
  const boxesOf = (page: Page): Promise<{ ring: Box; number: Box; unit: Box; legend: Box }> =>
    page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (element === null) throw new Error(`The page has no ${selector}.`);
        const { left, right, top, bottom, width } = element.getBoundingClientRect();
        return { left, right, top, bottom, width };
      };
      return {
        ring: box(".ring"),
        number: box(".ring-n"),
        unit: box(".ring-k"),
        legend: box(".ring-legend"),
      };
    });

  it("draws each kind of verdict's sign before its words, in a color of its own in both themes, which a screen reader doesn't read", async () => {
    const colors: Record<string, string[]> = { dark: [], light: [] };

    for (const [, which, , sign] of KINDS) {
      const page = await open(pages[which]);
      for (const theme of ["dark", "light"]) {
        const before = await page.locator("p.verdict").evaluate((line) => {
          const style = getComputedStyle(line, "::before");
          return { content: style.content, color: style.color };
        });

        // The sign, with no words for a screen reader to read: the line's own words say it.
        expect(before.content, `${which}, ${theme}`).toBe(`"${sign}" / ""`);
        colors[theme]?.push(before.color);
        if (theme === "dark") await page.locator("#theme-toggle").click();
      }
    }
    // Green, amber, and red: the three differ, in each theme.
    for (const theme of ["dark", "light"]) {
      expect(new Set(colors[theme]).size, theme).toBe(3);
    }
  });

  it("gives a screen reader the verdict's words alone, with no sign in them", async () => {
    for (const [, which, , , headline] of KINDS) {
      const page = await open(pages[which]);
      // What Chromium's accessibility tree gives a screen reader: the words, in a text of their own.
      const client = await page.context().newCDPSession(page);
      try {
        const { nodes } = await client.send("Accessibility.getFullAXTree");
        const names = nodes
          .map((node): unknown => node.name?.value)
          .filter((name): name is string => typeof name === "string");

        expect(names, which).toContain(headline);
        expect(
          names.filter((name) => /[✓⚠]/.test(name)),
          which,
        ).toEqual([]);
      } finally {
        await client.detach();
      }
    }
  });

  /** A node of the accessibility tree Chromium gives a screen reader. */
  type AxNode = Awaited<ReturnType<typeof axTreeOf>>[number];

  /** The tree itself: every node, with what is hidden from a screen reader in it, marked `ignored`. */
  async function axTreeOf(page: Page) {
    const client = await page.context().newCDPSession(page);
    try {
      return (await client.send("Accessibility.getFullAXTree")).nodes;
    } finally {
      await client.detach();
    }
  }

  /** A node's role and its name, when it has them as words. */
  const axRole = (node: AxNode): unknown => node.role?.value;
  const axName = (node: AxNode): string | undefined => {
    const name: unknown = node.name?.value;
    return typeof name === "string" ? name : undefined;
  };

  /** The words under a node, in order: the text of each node there that a screen reader gets. */
  function axWordsUnder(nodes: AxNode[], node: AxNode): string[] {
    const byId = new Map(nodes.map((each) => [each.nodeId, each]));
    const walk = (each: AxNode): string[] => [
      ...(axRole(each) === "StaticText" && !each.ignored ? [axName(each) ?? ""] : []),
      ...(each.childIds ?? []).flatMap((id) => {
        const child = byId.get(id);
        return child === undefined ? [] : walk(child);
      }),
    ];
    return walk(node);
  }

  it("gives a screen reader the ring's total, with its unit, as the name of the list of its parts", async () => {
    for (const [which, total, parts] of [
      ["demo", "7 pages", ["Read, no problems: 5", "Read, with problems: 2", "Not read: 0"]],
      ["none", "1 page", ["Read, no problems: 1", "Read, with problems: 0", "Not read: 0"]],
    ] as const) {
      const page = await open(pages[which]);
      const nodes = await axTreeOf(page);
      const lists = nodes.filter(
        (node) => !node.ignored && axRole(node) === "list" && axName(node) === total,
      );

      // The ring is a picture a screen reader skips, number and all. The list it gets says the
      // total, as the sighted reader sees it in the ring's hole, and then each part with its count.
      expect(lists, which).toHaveLength(1);
      const [legend] = lists;
      const items = nodes.filter(
        (node) => axRole(node) === "listitem" && legend?.childIds?.includes(node.nodeId),
      );
      expect(
        items.map((item) => axWordsUnder(nodes, item).join(" ")),
        which,
      ).toEqual(parts);
    }
  });

  it("says 'On this page' once to a screen reader, as the navigation's name, and not again as words", async () => {
    for (const [which, links] of [
      ["demo", ["What needs attention", "Every page", "The details"]],
      ["none", ["Every page", "The details"]],
      ["replay", ["Every page", "The details"]],
    ] as const) {
      const page = await open(pages[which]);
      const nodes = await axTreeOf(page);
      const heard = nodes.filter(
        (node) => !node.ignored && (axName(node) ?? "").includes("On this page"),
      );

      // Once: the navigation is named by it. The visible words before its links are for the eye,
      // since a screen reader that read them too would say it twice.
      expect(
        heard.map((node) => [axRole(node), axName(node)]),
        which,
      ).toEqual([["navigation", "On this page"]]);
      const [nav] = heard;
      expect(nav === undefined ? [] : axWordsUnder(nodes, nav), which).toEqual(links);
    }
  });

  it("sets the ring and its legend side by side from 40em wide, and one above the other below it", async () => {
    const page = await open(pages.demo);

    for (const width of [1280, 800, 640]) {
      await page.setViewportSize({ width, height: 900 });
      const { ring, legend } = await boxesOf(page);

      expect(
        legend.left,
        `${width} px: the legend starts where the ring ends`,
      ).toBeGreaterThanOrEqual(ring.right);
      // In the same row: each starts before the other ends.
      expect(legend.top, `${width} px`).toBeLessThan(ring.bottom);
      expect(ring.top, `${width} px`).toBeLessThan(legend.bottom);
    }
    for (const width of [639, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const { ring, legend } = await boxesOf(page);

      expect(legend.top, `${width} px: the legend is under the ring`).toBeGreaterThanOrEqual(
        ring.bottom,
      );
    }
  });

  it("puts the number of pages in the middle of the ring, inside its hole, at every width", async () => {
    const page = await open(pages.demo);

    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const { ring, number, unit } = await boxesOf(page);
      const middle = { x: (ring.left + ring.right) / 2, y: (ring.top + ring.bottom) / 2 };
      // The hole is 80 of the ring's 120 units across: its radius is a third of the ring's width.
      const hole = ring.width / 3;

      expect(ring.width, `${width} px`).toBeGreaterThanOrEqual(120);
      for (const [name, word] of [
        ["the number", number],
        ["its unit", unit],
      ] as const) {
        for (const corner of [
          [word.left, word.top],
          [word.right, word.top],
          [word.left, word.bottom],
          [word.right, word.bottom],
        ] as const) {
          const [x, y] = corner;
          expect(
            Math.hypot(x - middle.x, y - middle.y),
            `${width} px: ${name} is inside the ring's hole`,
          ).toBeLessThan(hole);
        }
      }
      // The number above its unit, both on the ring's vertical middle line.
      expect(number.bottom, `${width} px`).toBeLessThanOrEqual(unit.top + 1);
      for (const word of [number, unit]) {
        expect(Math.abs((word.left + word.right) / 2 - middle.x), `${width} px`).toBeLessThan(1);
      }
    }
  });

  it.each(["dark", "light"])(
    "draws the ring's arcs from the top, clockwise, as long as each part's share of the pages: %s",
    async (theme) => {
      const page = await open(pages.demo);
      if (theme === "light") await page.locator("#theme-toggle").click();
      const colorOf = (kind: string): Promise<string> =>
        page.locator(`.ring-part.${kind}`).evaluate((arc) => getComputedStyle(arc).stroke);
      const ok = await colorOf("ok");
      const warn = await colorOf("warn");

      // The demo's 7 pages: 5 without a problem, a share of 257 degrees from the top, then 2 that
      // need attention, to the top again. A picture of the ring, read where the arcs run (the
      // circle's radius is 48 of its 120 units), at each angle clockwise from the top.
      const picture = (await page.locator(".ring").screenshot()).toString("base64");
      const seen = await page.evaluate(
        async ({ base64, angles }) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d");
          if (context === null) throw new Error("There's no canvas to read a picture with.");
          context.drawImage(image, 0, 0);
          const middle = image.width / 2;
          const radius = (48 / 120) * image.width;
          return angles.map((angle) => {
            const turn = (angle * Math.PI) / 180;
            const x = Math.round(middle + radius * Math.sin(turn));
            const y = Math.round(middle - radius * Math.cos(turn));
            const [r = 0, g = 0, b = 0] = context.getImageData(x, y, 1, 1).data;
            return `rgb(${r}, ${g}, ${b})`;
          });
        },
        { base64: picture, angles: [10, 90, 180, 250, 265, 300, 350] },
      );

      expect(seen).toEqual([ok, ok, ok, ok, warn, warn, warn]);
    },
  );

  it("sets the ring's swatches to print in color, since backgrounds are left off the paper", async () => {
    const page = await open(pages.demo);

    expect(
      await page
        .locator(".ring-legend .sw")
        .first()
        .evaluate((swatch) => getComputedStyle(swatch).getPropertyValue("print-color-adjust")),
    ).toBe("exact");
  });

  it("lays four tiles out two across and then four, never leaving one alone in a row, at any width", async () => {
    const page = await open(pages.demo);
    const rows = (): Promise<{ counts: number[]; cutOff: number }> =>
      page.evaluate(() => {
        const tiles = [...document.querySelectorAll(".tiles > .tile")];
        const tops = tiles.map((tile) => Math.round(tile.getBoundingClientRect().top));
        return {
          counts: [...new Set(tops)].map((top) => tops.filter((other) => other === top).length),
          // A tile whose contents are wider than it is: its number or its words cut off.
          cutOff: tiles.filter((tile) => tile.scrollWidth > tile.clientWidth).length,
        };
      });
    const acrossAt = new Map<number, number>();

    for (let width = 320; width <= 1400; width += 20) {
      await page.setViewportSize({ width, height: 900 });
      const { counts, cutOff } = await rows();
      const [across = 0] = counts;

      // The same number in every row, so no tile is alone in one: one, two, or four across.
      expect(
        counts.every((count) => count === across),
        `${width} px: ${counts.join(", ")}`,
      ).toBe(true);
      expect([1, 2, 4], `${width} px`).toContain(across);
      expect(cutOff, `${width} px`).toBe(0);
      acrossAt.set(width, across);
    }
    expect(acrossAt.get(1280)).toBe(4);
    expect(acrossAt.get(400)).toBe(2);
    expect(acrossAt.get(320)).toBe(1);
  });
});

describe("the footer", () => {
  it("keeps each line to 80 characters of its smaller text, as wide as the page's 72, on a wide window", async () => {
    const page = await open(pages.demo);
    await page.setViewportSize({ width: 1600, height: 900 });

    // How wide each of the footer's lines is, and how wide 80 characters of its own text are.
    const lines = await page.evaluate(async () => {
      await Promise.all([...document.fonts].map((face) => face.load()));
      const context = document.createElement("canvas").getContext("2d");
      if (context === null) throw new Error("There's no canvas to measure text with.");
      return [...document.querySelectorAll("footer > *")].map((element) => {
        const style = getComputedStyle(element);
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        return {
          width: element.getBoundingClientRect().width,
          eighty: context.measureText("0".repeat(80)).width,
        };
      });
    });

    // What voicecap is, when the page was made, and the file's name with its Word copy's. A layout
    // that rounds a character's width to a whole pixel, as Chromium on Linux does, and a canvas that
    // doesn't, can differ by up to 2%.
    expect(lines).toHaveLength(3);
    for (const { width, eighty } of lines) expect(width).toBeLessThanOrEqual(eighty * 1.02);
  });

  it("puts the footer at the window's bottom when the page is shorter than the window", async () => {
    const page = await open(pages.demo);

    const { long, short } = await footerInTwoWindows(page);

    expect(short.scrolls).toBe(false);
    expect(
      Math.abs(short.gapBelow - long.gapBelow),
      `${short.gapBelow} px below the footer in a window taller than the page, ${long.gapBelow} px in one shorter`,
    ).toBeLessThanOrEqual(1);
  });

  it("keeps the sections together at the top when the page is shorter than the window", async () => {
    const page = await open(pages.demo);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(async () => {
      await Promise.all([...document.fonts].map((face) => face.load()));
    });
    // Where each section starts, and how tall it is.
    const sections = (): Promise<number[][]> =>
      page.evaluate(() =>
        [...document.querySelectorAll("main > *")].map((section) => {
          const box = section.getBoundingClientRect();
          return [Math.round(box.top + window.scrollY), Math.round(box.height)];
        }),
      );
    const before = await sections();
    const height = await page.evaluate(() => document.documentElement.scrollHeight);

    await page.setViewportSize({ width: 1280, height: height + 400 });

    // The demo's sections: At a glance, what needs attention (it has cards), every page, and the
    // details, so a count that found none of them can't pass for this.
    expect(before).toHaveLength(4);
    expect(await sections()).toEqual(before);
  });

  it("leaves a long page's footer after its content", async () => {
    const page = await open(pages.demo);
    await page.setViewportSize({ width: 1280, height: 800 });

    const { scrolls } = await footerPlacement(page);
    const { mainBottom, footerTop } = await page.evaluate(() => ({
      mainBottom: document.querySelector("main")?.getBoundingClientRect().bottom ?? NaN,
      footerTop: document.querySelector("footer")?.getBoundingClientRect().top ?? NaN,
    }));

    expect(scrolls).toBe(true);
    expect(footerTop).toBeGreaterThanOrEqual(mainBottom);
  });

  it("prints as before: the page is no flex column in print", async () => {
    const page = await open(pages.demo);

    await page.emulateMedia({ media: "print" });

    expect(await page.evaluate(() => getComputedStyle(document.body).display)).not.toBe("flex");
  });
});

describe("a run's walkthrough file", () => {
  it("downloads as the file voicecap writes of the run, under its own name", async () => {
    const page = await open(pages.demo);
    await page.locator("#open-all").click();

    for (const time of ["1402", "1315"] as const) {
      const run = demoRun(time);
      const name = `127.0.0.1_4848_${run.id}_walkthrough.json`;
      // Found by what a screen reader says of it: the link's words, then its run.
      const link = page.getByRole("link", {
        name: `Download the walkthrough file (4 KB) in run ${run.id}`,
        exact: true,
      });

      expect(await link.count()).toBe(1);
      expect(await link.getAttribute("download")).toBe(name);
      const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);

      expect(download.suggestedFilename()).toBe(name);
      const saved = await download.path();
      if (saved === null) throw new Error(`The browser kept no file for ${name}.`);
      expect((await readFile(saved)).toString("utf8")).toBe(walkthroughJson(walkthroughOf(run)));
    }
  });
});

describe("the story's opening", () => {
  it("sets how voicecap began, and why it exists, in the text color, and every other gist in the muted one", async () => {
    const page = await open(pages.demo);

    const colors = await page.evaluate(() => {
      const color = (element: Element): string => getComputedStyle(element).color;
      const opening = [...document.querySelectorAll("#story-h ~ p.gist")];
      const others = [...document.querySelectorAll("p.gist")].filter(
        (paragraph) => !opening.includes(paragraph),
      );
      return { text: color(document.body), opening: opening.map(color), others: others.map(color) };
    });

    // The two paragraphs the story opens with, as its one paragraph always was.
    expect(colors.opening).toEqual([colors.text, colors.text]);
    // The line under every other section's heading is set back, in the muted color.
    expect(colors.others.length).toBeGreaterThan(0);
    expect(colors.others.filter((color) => color === colors.text)).toEqual([]);
  });
});

describe("a page that needs nothing from outside its file", () => {
  it("loads nothing from outside the file", async () => {
    const context = await newContext();
    const requested: string[] = [];
    // Every request goes through here, and only the file itself is let through.
    await context.route("**/*", (route) => {
      const url = route.request().url();
      requested.push(url);
      return url.startsWith("file:") ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const failed: string[] = [];
    page.on("requestfailed", (request) => failed.push(request.url()));
    await page.goto(addressOf(pages.demo));
    await page.waitForLoadState("networkidle");
    // The fonts come from the file too: each face the page declares is asked for, so none rests
    // unused, and its data loads from the file.
    const faces = await page.evaluate(async () => {
      await Promise.all([...document.fonts].map((face) => face.load()));
      return [...document.fonts].map(
        (face) => `${face.family} ${face.style} ${face.weight} ${face.status}`,
      );
    });
    // Its scripts ask for nothing either.
    await page.locator("#open-all").click();
    await page.locator("#fp-run").click();
    await expect.poll(() => result(page), { timeout: 10_000 }).toBe(MATCHING);

    expect(
      requested.map((url) => (url.startsWith("file:") ? path.resolve(fileURLToPath(url)) : url)),
    ).toEqual([path.resolve(pages.demo)]);
    expect(failed).toEqual([]);
    expect(faces).toHaveLength(9);
    expect(faces.filter((face) => !face.endsWith(" loaded"))).toEqual([]);
  });
});

// The owner's choice of 2026-10-07 (D5): two cards a row on a wide window, where each gets at least
// 420 px, and one a row where they would not. The grid holds the cards under Every page and the
// quiet cards' fold alike.
describe("Every page's cards", () => {
  /** A card's box, in CSS pixels from the window's top left corner. */
  interface Box {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
  }

  /**
   * The cards `selector` finds, row by row (cards at the same height are a row, as the grid sets
   * them), and how wide the grid is that holds them. A card in a closed fold has no box, so its fold
   * is opened first.
   */
  const cardsIn = (page: Page, selector: string): Promise<{ rows: Box[][]; grid: number }> =>
    page.evaluate((target) => {
      const rows: Box[][] = [];
      for (const card of document.querySelectorAll(target)) {
        const { left, right, top, bottom, width } = card.getBoundingClientRect();
        const row = rows.find((each) => Math.abs((each[0]?.top ?? Number.NaN) - top) < 1);
        const box = { left, right, top, bottom, width };
        if (row === undefined) rows.push([box]);
        else row.push(box);
      }
      const grid = document.querySelector(target)?.parentElement?.getBoundingClientRect().width;
      return { rows, grid: grid ?? Number.NaN };
    }, selector);

  /** How many cards are in each row. */
  const across = (rows: Box[][]): number[] => rows.map((row) => row.length);

  it("puts two cards in a row on a wide window: the first two share a row, and the third starts the next", async () => {
    const page = await open(pages.demo);
    await page.setViewportSize({ width: 1280, height: 900 });

    const { rows, grid } = await cardsIn(page, "#pages .card");
    const [first, second] = rows[0] ?? [];
    const [third] = rows[1] ?? [];

    // The demo's seven cards: three rows of two, and the last card on its own.
    expect(across(rows)).toEqual([2, 2, 2, 1]);
    // The first two are side by side, at the same height, and the third is under both.
    expect(second?.left).toBeGreaterThanOrEqual(first?.right ?? Number.NaN);
    expect(Math.abs((first?.top ?? 0) - (second?.top ?? 100))).toBeLessThan(1);
    expect(third?.top).toBeGreaterThanOrEqual(Math.max(first?.bottom ?? 0, second?.bottom ?? 0));
    // The page is 1120 px wide at 1280, with 16 px between the cards: about 560 px each.
    expect(grid).toBeCloseTo(1120, 0);
    for (const card of rows.flat()) expect(card.width).toBeCloseTo((1120 - 16) / 2, 0);
  });

  it("puts one card in a row on a phone's window, as wide as the page", async () => {
    const page = await open(pages.demo);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const { rows, grid } = await cardsIn(page, "#pages .card");

      expect(across(rows), `${width} px`).toEqual([1, 1, 1, 1, 1, 1, 1]);
      for (const card of rows.flat()) expect(card.width, `${width} px`).toBeCloseTo(grid, 0);
    }
  });

  it("shows two a row whenever both get at least 420 px, and one a row otherwise, at any width", async () => {
    const page = await open(pages.demo);
    const widths = [
      ...Array.from({ length: 55 }, (_, step) => 320 + step * 20),
      // Where the card grid is 856 px wide, the least that gives two cards 420 px each and the
      // 16 px between them: every width around it, to the pixel.
      ...Array.from({ length: 51 }, (_, step) => 880 + step),
    ];
    const shown = new Set<number>();

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      const { rows, grid } = await cardsIn(page, "#pages .card");
      const two = grid >= 2 * 420 + 16;
      const said = `${width} px, a grid ${grid} px wide: ${across(rows).join(", ")} across`;

      // The same number in every row but the last, which has that many or fewer.
      expect(
        across(rows)
          .slice(0, -1)
          .every((each) => each === (two ? 2 : 1)),
        said,
      ).toBe(true);
      expect(across(rows).at(-1), said).toBeLessThanOrEqual(two ? 2 : 1);
      // Two only where both get 420 px, and never a card wider than its box.
      for (const card of rows.flat()) {
        expect(card.width, said).toBeGreaterThanOrEqual(Math.min(420, grid) - 0.5);
        expect(card.width, said).toBeLessThanOrEqual(grid + 0.5);
      }
      shown.add(two ? 2 : 1);
    }

    // Both outcomes were met, so the scan went over the edge.
    expect([...shown].sort()).toEqual([1, 2]);
  });

  it("puts one card in a row on portrait Letter paper, which has no room for two of 420 px", async () => {
    const page = await open(pages.demo);
    // 8.5 inches at 96 to the inch, with no margin: the paper is narrower than that in all.
    await page.setViewportSize({ width: 816, height: 1056 });
    await page.emulateMedia({ media: "print" });

    const { rows } = await cardsIn(page, "#pages .card");

    expect(across(rows)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it("puts two cards in a row on landscape Letter paper, which has the room", async () => {
    const page = await open(pages.demo);
    // 11 inches at 96 to the inch is 1056 px; the browser's usual margin of 0.4 inch (38 px) on each
    // side leaves 980, and the page's own 24 px at each side leaves a grid 932 px wide.
    await page.setViewportSize({ width: 1056 - 2 * 38, height: 816 });
    await page.emulateMedia({ media: "print" });

    const { rows, grid } = await cardsIn(page, "#pages .card");

    expect(grid).toBeGreaterThanOrEqual(2 * 420 + 16);
    expect(across(rows)).toEqual([2, 2, 2, 1]);
  });

  it("lays the quiet cards' fold out the same way, two a row where there is room and one where there is not", async () => {
    const page = await open(pages.many);
    await page.locator("#pages .folds > details > summary").click();

    // 13 pages: the 2 with flags are in the open, and the 11 with nothing to note in the fold.
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(across((await cardsIn(page, "#pages > .cards .card")).rows)).toEqual([2]);
    const wide = await cardsIn(page, "#pages .folds .card");
    expect(across(wide.rows)).toEqual([2, 2, 2, 2, 2, 1]);
    for (const card of wide.rows.flat()) expect(card.width).toBeGreaterThanOrEqual(420);

    await page.setViewportSize({ width: 390, height: 900 });
    expect(across((await cardsIn(page, "#pages .folds .card")).rows)).toEqual(
      Array.from({ length: 11 }, () => 1),
    );
  });
});

describe("a page's screenshots", () => {
  it("draws each of them from the file itself, with nothing requested from outside it", async () => {
    const context = await newContext();
    const requested: string[] = [];
    // Every request goes through here, and only the file itself is let through.
    await context.route("**/*", (route) => {
      const url = route.request().url();
      requested.push(url);
      return url.startsWith("file:") ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    await page.goto(addressOf(pages.rich));
    await page.waitForLoadState("networkidle");
    await page.locator("#open-all").click();
    // The window as tall as the page, so each picture is near enough to the window to load.
    await page.setViewportSize({
      width: 1280,
      height: await page.evaluate(() => document.documentElement.scrollHeight),
    });

    // Three pages, a picture on each card, and none anywhere else: all drawn.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [...document.images].map((image) => (image.complete ? image.naturalWidth : 0)),
          ),
        { timeout: 10_000 },
      )
      .toEqual([16, 16, 16]);
    expect(
      requested.map((url) => (url.startsWith("file:") ? path.resolve(fileURLToPath(url)) : url)),
    ).toEqual([path.resolve(pages.rich)]);
  });

  it("shows a card's picture whole, at its own proportions, not cropped to the 4:3 the cards were drawn for", async () => {
    // A real JPEG 160 wide and 100 high (8:5), blue on its left half and red on its right.
    const maker = await (await newContext()).newPage();
    await maker.setViewportSize({ width: 200, height: 200 });
    await maker.setContent(
      '<body style="margin:0;background:#c33"><div style="width:80px;height:100px;background:#33c"></div></body>',
    );
    const jpeg = await maker.screenshot({
      type: "jpeg",
      clip: { x: 0, y: 0, width: 160, height: 100 },
    });
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.11.0",
      pages: [
        {
          path: "/",
          files: TRANSCRIPTS,
          passes: LINES,
          screenshot: {
            ...fileHash(jpeg),
            takenAt: "2026-09-26T14:05:03.120-05:00",
            width: 160,
            height: 100,
          },
        },
      ],
    });
    const slug = run.pages[0]?.slug ?? "";
    const model = buildShareModel(
      inputOf([run], { transcripts: storeOf(), screenshots: new Map([[`r1/${slug}`, jpeg]]) }),
    );
    const folder = await mkdtemp(path.join(tmpdir(), "voicecap-share-wide-"));
    folders.push(folder);
    const file = path.join(folder, "wide.html");
    await writeFile(file, renderSharePage(model, { fontCss: "" }));

    const page = await open(file);
    const picture = await page.locator("#pg-home img").evaluate((image) => ({
      // The picture's box, inside its border: as wide and high as the picture is, in proportion.
      ratio: image.clientWidth / image.clientHeight,
      fit: getComputedStyle(image).objectFit,
    }));

    expect(picture.ratio).toBeGreaterThan(1.58);
    expect(picture.ratio).toBeLessThan(1.62);
    expect(picture.fit).toBe("fill");
  });

  it("names each one as the page it shows, as it loaded, before NVDA read it", async () => {
    const page = await open(pages.rich);

    const alts = await page
      .locator("#pages .card img")
      .evaluateAll((images) => images.map((image) => image.getAttribute("alt")));

    expect(alts).toEqual([
      `The page ${SITE}/ as it loaded, before NVDA read it`,
      `The page ${SITE}/about as it loaded, before NVDA read it`,
      `The page ${SITE}${LONG_PATH} as it loaded, before NVDA read it`,
    ]);
  });
});

describe("Open every section, and printing", () => {
  it("opens every fold, and a second press puts each back as it was, a hand-opened one too", async () => {
    const page = await open(pages.demo);
    const button = page.locator("#open-all");
    const asWritten = await foldStates(page);
    // The page starts with the demo's five cards of what needs attention open, and every other fold
    // closed.
    expect(openFolds(asWritten)).toEqual(DEMO_CARDS);
    // The reader opens another by hand.
    await page.locator("#tx-home > summary").click();
    const byHand = await foldStates(page);
    expect(openFolds(byHand)).toEqual([...openFolds(asWritten), "tx-home"]);

    expect(await button.textContent()).toBe("Open every section");
    await button.click();
    expect(openFolds(await foldStates(page))).toEqual(Object.keys(byHand));
    expect(await button.textContent()).toBe("Fold every section again");

    await button.click();
    expect(await foldStates(page)).toEqual(byHand);
    expect(await button.textContent()).toBe("Open every section");

    // It goes back and forth as often as it's pressed.
    await button.click();
    expect(openFolds(await foldStates(page))).toEqual(Object.keys(byHand));
    await button.click();
    expect(await foldStates(page)).toEqual(byHand);
  });

  // Every picture is loaded lazily, and most sit in folds that only printing opens: printing opens
  // them first (beforeprint), and each picture still reaches the paper.
  it("prints every screenshot, those in folds that printing opens too", async () => {
    // Thirteen pages, each with a picture of its own: a real JPEG of a color of its own, 32 by 24.
    const maker = await (await newContext()).newPage();
    await maker.setViewportSize({ width: 64, height: 64 });
    const jpegs: Buffer[] = [];
    for (let index = 0; index < 13; index++) {
      await maker.setContent(
        `<body style="margin:0;background:hsl(${index * 27} 70% 45%)"><b>${index}</b></body>`,
      );
      jpegs.push(
        await maker.screenshot({ type: "jpeg", clip: { x: 0, y: 0, width: 32, height: 24 } }),
      );
    }
    // The first two have flags, so their cards are in the open; the other 11 have nothing to note,
    // so theirs are in a fold.
    const flag = {
      rule: "generic-link-text",
      pass: "read" as const,
      count: 1,
      found: [{ text: "click here", count: 1 }],
      message: 'Generic link text announced 1 time in the read pass: "click here" ×1.',
    };
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.11.0",
      pages: jpegs.map((jpeg, index) => ({
        path: `/page-${index + 1}`,
        ...(index < 2 ? { flags: [flag] } : {}),
        screenshot: {
          ...fileHash(jpeg),
          takenAt: "2026-09-26T14:05:03.120-05:00",
          width: 32,
          height: 24,
        },
      })),
    });
    const model = buildShareModel(
      inputOf([run], {
        screenshots: new Map(run.pages.map((page, index) => [`r1/${page.slug}`, jpegs[index]!])),
      }),
    );
    const folder = await mkdtemp(path.join(tmpdir(), "voicecap-share-print-"));
    folders.push(folder);
    const file = path.join(folder, "print.html");
    await writeFile(file, renderSharePage(model, { fontCss: "" }));

    const page = await open(file);
    // As written, only the two flagged pages' pictures are in the open: the other 11 are folded.
    expect(
      await page.evaluate(
        () => [...document.images].filter((image) => image.closest("details:not([open])")).length,
      ),
    ).toBe(11);
    const before = await foldStates(page);
    const pdf = await page.pdf();

    // Each picture's own JPEG is in the printed file: none was left out by its fold or its loading.
    const missing = jpegs.flatMap((jpeg, index) => (pdf.includes(jpeg) ? [] : [index + 1]));
    expect(missing).toEqual([]);
    // Printing puts every fold back as it was.
    expect(await foldStates(page)).toEqual(before);
  });

  it("opens every fold for printing, and puts each back as it was afterwards", async () => {
    const page = await open(pages.demo);
    await page.locator("#tx-home > summary").click();
    const before = await foldStates(page);
    expect(openFolds(before)).toEqual([...DEMO_CARDS, "tx-home"]);

    await dispatch(page, "beforeprint");
    expect(openFolds(await foldStates(page))).toEqual(Object.keys(before));
    // A second beforeprint, as a browser can send, doesn't take the open folds for the page's own.
    await dispatch(page, "beforeprint");
    await dispatch(page, "afterprint");
    expect(await foldStates(page)).toEqual(before);
    // An afterprint with no beforeprint before it changes nothing.
    await dispatch(page, "afterprint");
    expect(await foldStates(page)).toEqual(before);

    // After Open every section, printing leaves everything open, and a press still puts it back.
    await page.locator("#open-all").click();
    await dispatch(page, "beforeprint");
    await dispatch(page, "afterprint");
    expect(openFolds(await foldStates(page))).toEqual(Object.keys(before));
    await page.locator("#open-all").click();
    expect(await foldStates(page)).toEqual(before);
  });
});

describe("a link into a fold", () => {
  /** The page's address changing to `hash`, as one the browser has just followed. */
  const goTo = (page: Page, hash: string): Promise<void> =>
    page.evaluate((id) => {
      history.replaceState(null, "", `#${id}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }, hash);

  it("opens the fold an address points into, and brings it into view", async () => {
    const page = await open(pages.demo);
    const fold = `tx-${HOW}`;
    const before = await foldStates(page);
    expect(before[fold]).toBe(false);

    // A link to something in plain view opens nothing.
    await page.locator('a[href="#prob-h"]').first().click();
    expect(await foldStates(page)).toEqual(before);

    // An address pointing to a page's transcript: the card holds the fold, which opens, and the
    // page is scrolled to it.
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await inView(page, `#${fold} > summary`)).toBe(false);
    await goTo(page, fold);
    expect(await foldStates(page)).toEqual({ ...before, [fold]: true });
    await expect.poll(() => inView(page, `#${fold} > summary`), { timeout: 10_000 }).toBe(true);

    // Shut again and scrolled away, the same address finds its way back.
    await page.locator(`#${fold} > summary`).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await inView(page, `#${fold} > summary`)).toBe(false);
    await goTo(page, fold);
    expect((await foldStates(page))[fold]).toBe(true);
    expect(await inView(page, `#${fold} > summary`)).toBe(true);
  });

  // A link to a page's transcript is an address, such as one sent in an email: no part of the page
  // links to one now that each card holds its own. On a page of 13, the cards with nothing to note
  // are folded behind one line, each holding a fold of its own transcript.
  it("a link to a page's transcript opens its fold, and the fold of quiet pages around it", async () => {
    // The fold of the 11 quiet pages, and what is open as the page is written: the cards of what
    // needs attention, which the two flagged pages make.
    const quiet = "#pages .folds > details";
    const isOpen = (fold: Element): boolean => (fold as HTMLDetailsElement).open;
    const asWritten = await open(pages.many);
    const written = await foldStates(asWritten);
    const transcripts = Object.keys(written).filter((id) => id.startsWith("tx-"));
    expect(transcripts).toHaveLength(13);
    expect(await asWritten.locator(quiet).evaluate(isOpen)).toBe(false);
    expect(transcripts.filter((id) => written[id])).toEqual([]);
    // The fourth and the ninth page: both are among the quiet.
    const first = transcripts[3] ?? "";
    const second = transcripts[8] ?? "";
    const openCount = (states: Record<string, boolean>): number => openFolds(states).length;

    // The page opened at a quiet page's transcript: that fold and the quiet fold around it open,
    // and no other.
    const page = await open(pages.many, `#${first}`);
    const afterFirst = await foldStates(page);
    expect(await page.locator(quiet).evaluate(isOpen)).toBe(true);
    expect(transcripts.filter((id) => afterFirst[id])).toEqual([first]);
    expect(openCount(afterFirst)).toBe(openCount(written) + 2);
    await expect.poll(() => inView(page, `#${first} > summary`), { timeout: 10_000 }).toBe(true);

    // The address changing to another quiet page's: its fold opens too, and the first stays open.
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await inView(page, `#${second} > summary`)).toBe(false);
    await goTo(page, second);
    const afterSecond = await foldStates(page);
    expect(transcripts.filter((id) => afterSecond[id])).toEqual([first, second]);
    expect(openCount(afterSecond)).toBe(openCount(written) + 3);
    await expect.poll(() => inView(page, `#${second} > summary`), { timeout: 10_000 }).toBe(true);

    // Open every section opens every fold: the quiet one, all 13 transcripts, and the 13 folds of
    // what axe found.
    await page.locator("#open-all").click();
    expect(await page.locator("details:not([open])").count()).toBe(0);
    expect(await page.locator("#pages details[open]").count()).toBe(1 + 13 + 13);
  });

  it("opens every fold around what a link points to, however deep", async () => {
    const page = await open(pages.demo);
    await page.evaluate(() => {
      // Added after the page's own, so it runs after: the link then goes nowhere, and Chromium's
      // own opening of the folds around a target (which a fold in another browser may not get)
      // can't be what opens them.
      document.addEventListener("click", (event) => event.preventDefault());
      document.body.insertAdjacentHTML(
        "beforeend",
        '<details id="outer"><summary>Outer</summary><details id="inner"><summary>Inner</summary>' +
          '<p id="deep">Deep</p></details></details><a id="to-deep" href="#deep">To the deep</a>',
      );
    });

    await page.locator("#to-deep").click();

    const states = await foldStates(page);
    expect([states.outer, states.inner]).toEqual([true, true]);
    expect(await page.evaluate(() => window.location.hash)).toBe("");
  });

  it("opens the fold a page's address points into, as the page loads", async () => {
    const fold = `tx-${HOW}`;
    const asWritten = await foldStates(await open(pages.demo));

    const page = await open(pages.demo, `#${fold}`);

    expect(await foldStates(page)).toEqual({ ...asWritten, [fold]: true });
    await expect.poll(() => inView(page, `#${fold} > summary`), { timeout: 10_000 }).toBe(true);
  });

  it("opens a card's fold of what axe found that a page's address points to, and no other", async () => {
    const asWritten = await foldStates(await open(pages.axe));
    expect(asWritten["axe-home"]).toBe(false);

    const page = await open(pages.axe, "#axe-home");

    expect(await foldStates(page)).toEqual({ ...asWritten, "axe-home": true });
    await expect.poll(() => inView(page, "#axe-home > summary"), { timeout: 10_000 }).toBe(true);
  });

  it("leaves the folds alone for an address that points to nothing, or to what's in view", async () => {
    const asWritten = await foldStates(await open(pages.demo));

    for (const hash of ["#no-such-part", "#prob-h", "#", "#%E0%A4%A"]) {
      const page = await open(pages.demo, hash);
      expect(await foldStates(page), hash).toEqual(asWritten);
    }
  });
});

describe("a card's fold of its page's transcripts", () => {
  it("is named by the words it shows, then its page for a screen reader, each fold apart from the rest", async () => {
    // 13 pages: each card has a fold of its own, and every fold's line reads the same on screen.
    const model = manyPages(13, 2);
    const page = await open(pages.many);
    // The folds of the 11 quiet cards are in the accessibility tree once their own fold is open.
    await page.locator("#open-all").click();
    // The words each fold shows, as everyone sees them: its line less the words set apart for a
    // screen reader alone (sr).
    const shown = await page.locator("details.tx-page > summary").evaluateAll((lines) =>
      lines.map((line) => {
        const seen = line.cloneNode(true) as HTMLElement;
        for (const hidden of seen.querySelectorAll(".sr")) hidden.remove();
        return (seen.textContent ?? "").replace(/\s+/g, " ").trim();
      }),
    );
    const client = await page.context().newCDPSession(page);
    try {
      const { nodes } = await client.send("Accessibility.getFullAXTree");
      // What Chromium gives a screen reader of each fold: the triangle that opens it, named by its
      // line, the words set apart for a screen reader among them. Chromium puts a space around
      // those, which is taken out here, as any run of spaces is.
      const names = nodes
        .filter((node) => node.role?.value === "DisclosureTriangle")
        .map((node): unknown => node.name?.value)
        .filter((name): name is string => typeof name === "string")
        .filter((name) => name.startsWith("The full transcript"))
        .map((name) => name.replace(/\s+/g, " ").trim());
      const expected = model.pages.map(
        ({ path: where }) => `The full transcript: read, headings, and Tab transcripts of ${where}`,
      );

      // Each page's own, compared sorted: the cards in the open come first in the page, which is
      // the page's order only when the pages with flags are its first.
      expect([...names].sort()).toEqual([...expected].sort());
      expect(new Set(names).size).toBe(13);
      // Every fold shows the same line, and each name starts with it, whole (WCAG 2.5.3, label in
      // name), so a voice command that says the words on the screen finds the fold. The page's
      // words come after.
      expect(shown).toHaveLength(13);
      expect(new Set(shown)).toEqual(
        new Set(["The full transcript: read, headings, and Tab transcripts"]),
      );
      for (const name of names) expect(name.startsWith(shown[0] ?? "\0"), name).toBe(true);
    } finally {
      await client.detach();
    }
  });

  it("looks as it did to everyone else: the words that name its page take no room", async () => {
    const page = await open(pages.many);
    await page.locator("#open-all").click();

    // Where each fold's line and its two parts are with those words, then without them: a sighted
    // reader sees the same line, as the words are clipped to a point.
    const boxes = await page.locator("details.tx-page > summary").evaluateAll((lines) => {
      const rectOf = (element: Element | null): number[] => {
        const { x, y, width, height } = element?.getBoundingClientRect() ?? new DOMRect();
        return [x, y, width, height];
      };
      return lines.map((line) => {
        const sr = line.querySelector(".sr");
        const measured = () => [
          rectOf(line),
          rectOf(line.querySelector(".what")),
          rectOf(line.querySelector(".sub")),
        ];
        const hidden = rectOf(sr);
        const withWords = measured();
        sr?.remove();
        return { withWords, without: measured(), hidden };
      });
    });

    expect(boxes).toHaveLength(13);
    for (const { withWords, without, hidden } of boxes) {
      expect(withWords[1]?.[2]).toBeGreaterThan(0);
      expect(withWords[2]?.[2]).toBeGreaterThan(0);
      for (const [at, box] of withWords.entries()) {
        for (const [edge, value] of (box ?? []).entries()) {
          expect(value).toBeCloseTo(without[at]?.[edge] ?? NaN, 0);
        }
      }
      // They are clipped to a point: one pixel by one.
      expect(hidden?.slice(2)).toEqual([1, 1]);
    }
  });
});

describe("the details' parts", () => {
  const TITLES = ["What's still to do", "How complete the test was", "When and how"];
  /** A page for each way the details are written: with problems, with none to name, and with a page skipped. */
  const STATES = [
    ["naming problems", "five"],
    ["with none to name", "none"],
    ["with a page skipped", "skipped"],
  ] as const;

  /** `actual` is `expected`, to within a pixel: a layout puts an edge a fraction of a pixel off. */
  function near(actual: number, expected: number, what: string): void {
    const found = `${actual} px, not ${expected} px`;
    expect(Math.abs(actual - expected), `${what}: ${found}`).toBeLessThanOrEqual(1);
  }

  // Each part's panel is a row of its own, as wide as the details, in a wide window and in a narrow
  // one, one under another in the order the spec sets them out.
  it.each(
    [1280, 1200, 390, 320].flatMap((width) =>
      STATES.map(([state, which]) => [width, state, which] as const),
    ),
  )(
    "gives each of the three plain parts' panels the details' whole width, one under another, in order, at %i px: %s",
    async (width, state, which) => {
      const page = await open(pages[which]);
      await page.setViewportSize({ width, height: 900 });

      const { details, panels } = await partsOf(page);
      const titles = panels.map(({ title }) => title);

      expect(titles, state).toEqual(TITLES);
      for (const [at, panel] of panels.entries()) {
        near(panel.left, details.left, `${state}: the left edge of ${panel.title}`);
        near(panel.right, details.right, `${state}: the right edge of ${panel.title}`);
        near(panel.width, details.width, `${state}: the width of ${panel.title}`);
        // Each is under the one before it: its top is at or below that one's bottom.
        const above = panels[at - 1];
        if (above !== undefined) {
          const place = `${state}: ${panel.title} is under ${above.title}`;
          expect(panel.top, place).toBeGreaterThanOrEqual(above.bottom);
        }
      }
    },
  );

  // A part's heading looks like a section's, a step smaller: between a section's (an h2) and a
  // step's or an item's (the h4 inside a part), at every width.
  it.each([1280, 390, 320])(
    "sets a part's heading between a section's and an item's in size, at %i px",
    async (width) => {
      const page = await open(pages.demo);
      await page.setViewportSize({ width, height: 900 });

      const sizes = await page.evaluate(() => {
        const size = (selector: string): number => {
          const element = document.querySelector(selector);
          if (element === null) throw new Error(`The page has no ${selector}.`);
          return Number.parseFloat(getComputedStyle(element).fontSize);
        };
        return {
          section: size("#details-h"),
          part: size("#todo-h"),
          item: size("#how-h ~ .flow h4"),
        };
      });

      expect(sizes.part, "a part, under a section").toBeLessThan(sizes.section);
      expect(sizes.part, "a part, over an item").toBeGreaterThan(sizes.item);
    },
  );

  // A panel is the details' whole width, but a line of its text stops at 80 characters, as wide as
  // 80 "0"s of its own font (`80ch`), or a line of 150 characters is hard to follow. A box set to
  // 80ch inside each paragraph and list item, from the script, is how wide that is there.
  it.each([...STATES, ["with i2i's long list of pages", "i2i"] as const])(
    "keeps a line of the plain parts' paragraphs and list items to 80 characters, though each panel is the details' width, at 1280 px: %s",
    async (state, which) => {
      const page = await open(pages[which]);
      await page.setViewportSize({ width: 1280, height: 900 });

      const { details, panels } = await partsOf(page);
      const texts = await page.evaluate((ids) => {
        const inPanels = ids.flatMap((id) => {
          const panel = document
            .getElementById(id)
            ?.parentElement?.querySelector(":scope > .panel");
          return [...(panel?.querySelectorAll("p, li") ?? [])];
        });
        return inPanels.map((text) => {
          const eighty = document.createElement("span");
          eighty.style.display = "block";
          eighty.style.width = "80ch";
          text.append(eighty);
          const measure = eighty.getBoundingClientRect().width;
          eighty.remove();
          return {
            words: (text.textContent ?? "").slice(0, 40),
            width: text.getBoundingClientRect().width,
            measure,
          };
        });
      }, PANEL_PARTS);

      // The panels are as wide as ever, so it is the text that is kept short of that.
      for (const panel of panels) near(panel.width, details.width, `${state}: ${panel.title}`);
      expect(texts.length, state).toBeGreaterThan(5);
      for (const { words, width, measure } of texts) {
        expect(measure, `${state}: 80 characters, for "${words}"`).toBeGreaterThan(200);
        expect(measure, `${state}: 80 characters, for "${words}"`).toBeLessThan(details.width);
        expect(width, `${state}: "${words}" is ${width} px wide`).toBeLessThanOrEqual(measure + 1);
      }
    },
  );
});

describe("what needs attention", () => {
  it("opens every card when there are 5, and folds every card when there are 6", async () => {
    const five = await open(pages.five);
    const six = await open(pages.six);

    expect(await cardStates(five)).toEqual({
      "need-1": true,
      "need-2": true,
      "need-3": true,
      "need-4": true,
      "need-5": true,
    });
    expect(await cardStates(six)).toEqual({
      "need-1": false,
      "need-2": false,
      "need-3": false,
      "need-4": false,
      "need-5": false,
      "need-6": false,
    });
    // What a folded card's line says is still there to read: its number, its title, and its count.
    expect(await six.locator("#need-6 > summary").innerText()).toContain(
      'Links read as "more info": link text that doesn\'t say where it goes',
    );
    expect(await six.locator("#need-1 > summary .sub").innerText()).toBe("4 pages, 4 times");
    // The folded card's own words are hidden, and open when its line is pressed.
    expect(await six.locator("#need-6 .place").first().isVisible()).toBe(false);
    await six.locator("#need-6 > summary").click();
    expect((await cardStates(six))["need-6"]).toBe(true);
    expect(await six.locator("#need-6 .place").first().isVisible()).toBe(true);
  });

  it("shows a card's pages when it is on 3, and folds them behind a line that counts them when it is on 4", async () => {
    const page = await open(pages.five);
    const links = (card: string) => page.locator(`#${card} a[href^="#pg-"]`);

    // "click here" is on 4 pages, and its fold of them is closed; "read more" is on 3, in the open.
    expect(await links("need-1").count()).toBe(4);
    expect(await links("need-1").first().isVisible()).toBe(false);
    expect(await page.locator("#need-1 details > summary").innerText()).toBe("The 4 pages");
    expect(await page.locator("#need-2 details").count()).toBe(0);
    expect(await links("need-2").count()).toBe(3);
    for (const link of await links("need-2").all()) expect(await link.isVisible()).toBe(true);

    await page.locator("#need-1 details > summary").click();
    for (const link of await links("need-1").all()) expect(await link.isVisible()).toBe(true);
    expect(await links("need-1").allInnerTexts()).toEqual(["Page A", "Page B", "Page C", "Page D"]);
  });

  it("sets what NVDA said, and the code of a fix, to keep their lines and break a long word", async () => {
    const page = await open(pages.demo);

    const wraps = await page.evaluate(() =>
      [".place code", ".fix pre"].map((selector) => {
        const style = getComputedStyle(document.querySelector(selector) ?? document.body);
        return [selector, style.whiteSpace, style.overflowWrap];
      }),
    );

    // What NVDA said keeps its spaces, and a space where a line wraps takes room in the line rather
    // than hang past the quote's box (break-spaces, not pre-wrap): see the next two tests.
    expect(wraps).toEqual([
      [".place code", "break-spaces", "anywhere"],
      [".fix pre", "pre-wrap", "anywhere"],
    ]);
  });

  it.each([320, 1280])(
    "lays each line NVDA said under its key, so no quote's box meets its key's or another quote's, at %i px",
    async (width) => {
      const page = await open(pages.i2i);
      await page.setViewportSize({ width, height: 900 });

      const places = await quotesOf(page, "need-1");

      // The header's two lines, Down Arrow's and Tab's, and the main content's one.
      expect(places.map((lines) => lines.map(({ key }) => key.text))).toEqual([
        ["Down Arrow:", "Tab:"],
        ["Down Arrow:"],
      ]);
      for (const [at, lines] of places.entries()) {
        for (const { key, quote } of lines) {
          const where = `place ${at + 1}, ${key.text.replace(/:$/, "")}`;
          // Under its key, never beside it on the key's line, and starting where the key starts.
          expect(quote.top, `${where}: under its key`).toBeGreaterThanOrEqual(key.bottom - 0.5);
          expect(Math.abs(quote.left - key.left), `${where}: at its key's left`).toBeLessThan(1);
          for (const other of lines) {
            expect(meet(quote, other.key), `${where} meets ${other.key.text}`).toBe(false);
            if (other.quote !== quote) {
              expect(
                meet(quote, other.quote),
                `${where} meets the quote of ${other.key.text}`,
              ).toBe(false);
            }
          }
        }
      }
    },
  );

  // Where a quote wraps depends on the fonts and on how the system rounds their widths. With
  // pre-wrap, a line whose last word ended less than a space's width from the box's edge left that
  // space hanging past the box: at 320 px on Linux in CI, and at 313, 321, and 336 px, among 16
  // widths, on Windows. axe then can't tell what those letters are drawn on, and calls the box
  // "partially obscured". So this checks every width from 300 to 480 px, not one.
  it("keeps every letter of each line NVDA said inside its quote's box, at every width from 300 to 480 px", async () => {
    const page = await open(pages.i2i);
    const outside: string[] = [];

    for (let width = 300; width <= 480; width += 1) {
      await page.setViewportSize({ width, height: 900 });
      outside.push(...(await lettersOutside(page)).map((line) => `${width} px: ${line}`));
    }

    expect(outside).toEqual([]);
  });

  it("brings the section into view from At a glance's link to it, and opens no card", async () => {
    const page = await open(pages.six);
    const asWritten = await cardStates(page);

    // At a glance names no card, as a panel once did: it has the link to the section, whose
    // heading is in plain view, so the link opens nothing.
    const toSection = page.locator('.toc a[href="#need-h"]');
    expect(await toSection.innerText()).toBe("What needs attention");
    await toSection.click();

    expect(await cardStates(page)).toEqual(asWritten);
    await expect.poll(() => inView(page, "#need-h"), { timeout: 10_000 }).toBe(true);
  });

  it("opens the card an address points to, as the page loads", async () => {
    const asWritten = await cardStates(await open(pages.six));

    const page = await open(pages.six, "#need-6");

    expect(await cardStates(page)).toEqual({ ...asWritten, "need-6": true });
    await expect.poll(() => inView(page, "#need-6 > summary"), { timeout: 10_000 }).toBe(true);
  });

  it("links each of i2i's 32 pages to its card under Every page, which the link brings into view", async () => {
    const page = await open(pages.i2i);
    expect(await cardStates(page)).toEqual({ "need-1": true });
    await page.locator("#need-1 details > summary").click();
    const links = page.locator('#need-1 a[href^="#pg-"]');
    expect(await links.count()).toBe(32);
    // Each link's address is the id of a card that is there.
    const hrefs = await links.evaluateAll((all) => all.map((a) => a.getAttribute("href") ?? ""));
    for (const href of hrefs) expect(await page.locator(href).count(), href).toBe(1);

    await links.nth(31).click();
    await expect
      .poll(() => inView(page, "#pages .card:last-of-type"), { timeout: 10_000 })
      .toBe(true);
    // The link opened nothing: the card and its pages are the only folds open.
    expect(openFolds(await foldStates(page))).toHaveLength(2);
  });
});

describe("the fingerprint check, on the page's own data", () => {
  it("finds every fingerprint matching on the page as written", async () => {
    const page = await open(pages.demo);
    await page.locator("#fp-run").click();

    await expect.poll(() => result(page), { timeout: 10_000 }).toBe(MATCHING);

    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result good");
    expect(await result(page)).not.toContain("doesn't match");
    expect(await page.locator("#fp-count").textContent()).toBe("23 checked, 0 not matching");
    expect(await page.locator("#fp-rows .c-ok").count()).toBe(23);
    expect(await page.locator("#fp-rows .c-bad").count()).toBe(0);
  });

  it("checks each screenshot of a page whose runs took them, with its transcripts and its seals", async () => {
    const page = await open(pages.rich);
    await page.locator("#fp-run").click();

    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toContain("3 of 3 screenshots match their fingerprints");

    expect(await result(page)).not.toContain("doesn't match");
    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result good");
    // Each is listed with the transcripts and the seals, and each matches.
    const rows = await page.locator("#fp-rows tr").allTextContents();
    expect(rows.filter((row) => row.includes("screenshot.jpg"))).toHaveLength(3);
    expect(await page.locator("#fp-rows .c-bad").count()).toBe(0);
  });

  it("checks each page's axe results with its transcripts and its seal, and catches a change in one", async () => {
    const page = await open(pages.axe);
    await page.locator("#fp-run").click();

    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toMatch(
        /^Checked just now, in this browser\. 9 of 9 transcripts match their fingerprints, and 2 of 2 axe results match their fingerprints, and the run's seal checks out\.$/,
      );
    const rows = await page.locator("#fp-rows tr").allTextContents();
    expect(rows.filter((row) => row.includes("axe.json"))).toHaveLength(2);
    expect(await page.locator("#fp-rows .c-bad").count()).toBe(0);

    // A change caught: one character of a transcript, and one of an axe file.
    await page.locator("#fp-demo").click();
    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toMatch(/ · \/ · axe\.json doesn't match its fingerprint\. /);
    expect(await result(page)).toContain("1 of 2 axe results match their fingerprints");
    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
  });

  it("names the one file changed in the copy, and leaves the page as it was", async () => {
    const page = await open(pages.demo);
    // The data as the file holds it: what the page's must be afterwards, character for character.
    const html = await readFile(pages.demo, "utf8");
    const inFile = /<script type="application\/json" id="fp-data">([\s\S]*?)<\/script>/.exec(html);
    expect(inFile?.[1]).toEqual(expect.any(String));
    expect(await page.locator("#fp-data").textContent()).toBe(inFile?.[1]);
    const transcript = await page.locator("#tx-home pre").first().textContent();

    await page.locator("#fp-demo").click();
    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Demonstration, on a copy with one character changed " +
          "(the first character of Run 1402 · / · read.txt, “#” to “$”); the page itself is unchanged. " +
          "Run 1402 · / · read.txt doesn't match its fingerprint. " +
          "20 of 21 transcripts match their fingerprints, and both runs' seals check out.",
      );

    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
    expect(await page.locator("#fp-data").textContent()).toBe(inFile?.[1]);
    expect(await page.locator("#tx-home pre").first().textContent()).toBe(transcript);

    // Checked again, the page itself matches throughout.
    await page.locator("#fp-run").click();
    await expect.poll(() => result(page), { timeout: 10_000 }).toBe(MATCHING);
    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result good");
  });

  it("names a transcript changed in the page's data", async () => {
    const page = await open(pages.demo);
    await page.evaluate(() => {
      const source = document.getElementById("fp-data");
      if (source === null) throw new Error("No data.");
      const data = JSON.parse(source.textContent ?? "") as Data;
      const file = data.files.find(
        (each) => each.slug === "common-mistakes-db8c98dbfa" && each.name === "tab.txt",
      );
      if (file === undefined) throw new Error("No such transcript.");
      file.text += " ";
      source.textContent = JSON.stringify(data);
    });
    await page.locator("#fp-run").click();

    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Checked just now, in this browser. " +
          "Run 1402 · /common-mistakes/ · tab.txt doesn't match its fingerprint. " +
          "20 of 21 transcripts match their fingerprints, and both runs' seals check out.",
      );
    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
    // It's listed, in words, with the others.
    const rows = await page.locator("#fp-rows tr").allTextContents();
    expect(rows.filter((row) => row.includes("doesn’t match"))).toEqual([
      expect.stringContaining("Run 1402 · /common-mistakes/ · tab.txt"),
    ]);
  });

  it("Check the fingerprints catches a changed character in a card's transcript", async () => {
    const page = await open(pages.demo);
    // Someone changes one character of what the home page's card shows of its read transcript, in
    // its fold, and nothing else: the data and the records still match.
    const changed = await page.evaluate(() => {
      const shown = document.querySelector("#pg-home details.tx-page section.tx pre");
      if (shown === null) throw new Error("The home page's card shows no transcript.");
      const text = shown.textContent ?? "";
      const at = text.indexOf("landmark");
      shown.textContent = `${text.slice(0, at)}L${text.slice(at + 1)}`;
      return text.slice(at, at + 8);
    });
    expect(changed).toBe("landmark");
    await page.locator("#fp-run").click();

    // In words: the file named, and that the text shown is not its own.
    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Checked just now, in this browser. " +
          "Run 1402 · / · read.txt: the text shown doesn't match its file. " +
          "20 of 21 transcripts match their fingerprints, and both runs' seals check out.",
      );
    // And in red: the line, and the file's row in the list of every file checked.
    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
    const rows = await page.locator("#fp-rows tr").allTextContents();
    expect(rows.filter((row) => row.includes("doesn’t match"))).toEqual([
      expect.stringContaining("Run 1402 · / · read.txt"),
    ]);
    const red = "rgb(242, 117, 117)";
    expect(await page.locator("#fp-result").evaluate((line) => getComputedStyle(line).color)).toBe(
      red,
    );
    const chips = page.locator("#fp-rows .c-bad");
    expect(await chips.count()).toBe(1);
    expect(await chips.evaluate((chip) => getComputedStyle(chip).color)).toBe(red);
    // The one character, and no other file, is what it names.
    expect(await page.locator("#fp-count").textContent()).toBe("23 checked, 1 not matching");
  });

  it("checks the older run's record for a page shown from it", async () => {
    const page = await open(pages.demo);
    // Run 1402 failed /how-a-run-works/, so the page shows run 1315's transcripts of it, and
    // carries run 1315's record to check them by.
    const data = JSON.parse((await page.locator("#fp-data").textContent()) ?? "") as Data;
    expect(
      data.files.filter((file) => file.slug === HOW).map((file) => [file.run, file.name]),
    ).toEqual([
      ["2026-09-29_1315", "read.txt"],
      ["2026-09-29_1315", "headings.txt"],
      ["2026-09-29_1315", "tab.txt"],
    ]);

    await page.locator("#fp-run").click();
    await expect.poll(() => result(page), { timeout: 10_000 }).toBe(MATCHING);
    const rows = await page.locator("#fp-rows tr").allTextContents();
    expect(rows.filter((row) => row.includes("/how-a-run-works/"))).toEqual([
      expect.stringMatching(/^Run 1315 · \/how-a-run-works\/ · read\.txt.*matches$/),
      expect.stringMatching(/^Run 1315 · \/how-a-run-works\/ · headings\.txt.*matches$/),
      expect.stringMatching(/^Run 1315 · \/how-a-run-works\/ · tab\.txt.*matches$/),
    ]);

    // Run 1315's record of the file is what it's held to: changed, the file and the seal say so.
    await page.evaluate(() => {
      const source = document.getElementById("fp-data");
      if (source === null) throw new Error("No data.");
      const changed = JSON.parse(source.textContent ?? "") as Data;
      const record = changed.runs.find((run) => run.id === "2026-09-29_1315");
      const hash = record?.pages.find((each) => each.slug === "how-a-run-works-fd116f9328")?.files[
        "read.txt"
      ];
      if (hash === undefined) throw new Error("No such record.");
      hash.sha256 = "0".repeat(64);
      source.textContent = JSON.stringify(changed);
    });
    await page.locator("#fp-run").click();
    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Checked just now, in this browser. " +
          "Run 1315 · /how-a-run-works/ · read.txt doesn't match its fingerprint. " +
          "Run 1315's record doesn't match its seal. " +
          "20 of 21 transcripts match their fingerprints, and 1 of 2 runs' seals check out.",
      );
  });

  it("keeps a transcript's </script> intact, and its check matches", async () => {
    const page = await open(pages.hostile);

    // The page is whole: its script ran, and nothing in a transcript did.
    expect(await page.locator("#fp-run").isVisible()).toBe(true);
    expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
    expect(await page.locator("script").count()).toBe(2);
    // The home page's card shows each line as text, markup and all, in its fold and in what NVDA
    // said first: three lines, in quotes, the first two of them markup.
    const read = await page.locator('#tx-home [aria-label^="Read transcript"] pre').textContent();
    for (const line of HOSTILE_LINES) expect(read).toContain(line);
    expect(await page.locator("#tx-home pre b").count()).toBe(0);
    expect(await page.locator("#pg-home .heard-first li").allTextContents()).toEqual(
      [HOSTILE_LINES[0], HOSTILE_LINES[1], HOSTILE_LINES[2]].map((line) => `“${line}”`),
    );
    expect(await page.locator("#pg-home .heard-first li *").count()).toBe(0);
    // A page's title, with markup in it, is text too. It names no site: the home page's card shows
    // it, and the site is named by its host.
    expect(await page.title()).toBe("example.illinois.gov: how its pages read aloud with NVDA");
    expect(await page.locator("h1").textContent()).toBe("example.illinois.gov");
    expect(await page.locator("#pg-home p.sub").allTextContents()).toContain(
      "Title: Grants </title></script><b>Agency</b>",
    );
    expect(await page.locator("#pg-home p.sub b").count()).toBe(0);

    // The data holds each file exactly as it is on disk.
    const data = JSON.parse((await page.locator("#fp-data").textContent()) ?? "") as Data;
    const home = data.files.find((file) => file.slug === "home" && file.name === "read.txt");
    const onDisk = await readFile(
      path.join(runDir(hostileRun.siteDir, hostileRun.runId), "pages", "home", "read.txt"),
      "utf8",
    );
    expect(home?.text).toBe(onDisk);
    expect(home?.text).toContain("</script><script>window.__pwned = true</script>");

    await page.locator("#fp-run").click();
    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Checked just now, in this browser. " +
          "9 of 9 transcripts match their fingerprints, and the run's seal checks out.",
      );
  });
});

describe("a site whose only run was a replay", () => {
  it("writes the page for a site where no run counts yet", async () => {
    const page = await open(pages.replay);

    expect(await page.locator("h1").textContent()).toBe("127.0.0.1:4747");
    const text = await page.locator("main").innerText();
    expect(text).toContain("No live run counts yet");
    // What it left out, with why.
    expect(text).toContain(`${replayRunId}: replayed, so it never counts as a live result`);
    // Nothing counts, so there's nothing to check: no data, and no button that would do nothing.
    expect(await page.locator("#fp-data").count()).toBe(0);
    expect(await page.locator("#fp-run").count()).toBe(0);
    // The page's own buttons work.
    await page.locator("#open-all").click();
    expect(Object.values(await foldStates(page)).every(Boolean)).toBe(true);
    await page.locator("#theme-toggle").click();
    expect(await page.getAttribute("html", "data-theme")).toBe("light");
  });
});

/**
 * The voice page (src/share/voice-page.ts) as a reader gets it: written to a folder from a model of
 * pages with real recordings (the encoder's own files), and opened from a file in Chromium. Nothing
 * here plays a sound: no test calls `play()`, and the players have no autoplay (where the page
 * itself calls `play()`, because the player in view was playing, the test's stand-in only records
 * the call). What's measured is what an element that's never played can say: its `playbackRate` and
 * `preservesPitch`, the place it's at, and the length it reports once its file is loaded. A slower
 * speed makes a copy of the recording in the page, which a second player shows: it's measured the
 * same way, and its length is the recording's length divided by the speed.
 */
describe("the voice page", () => {
  /** What the page's speed choice offers, in its order. */
  const SPEEDS = [1, 0.75, 0.5, 0.3];

  /** The page's file, and the slug of each of its pages in order. */
  let voice: { file: string; slugs: string[] };
  /** The record of each recording the page plays, by the page's slug. */
  const kept = new Map<string, Awaited<ReturnType<typeof recordedVoice>>["record"]>();

  beforeAll(async () => {
    const speech = await recordedVoice(speechAndPauses());
    const busy = await recordedVoice(busySound(3.4, 7), 250);
    const long = await recordedVoice(busySound(2.6, 8));
    const read = { files: TRANSCRIPTS, passes: LINES };
    const run = shareRun({
      id: "2026-09-29_1402",
      createdAt: "2026-09-29T14:02:51-05:00",
      voicecapVersion: "0.18.0",
      pages: [
        { path: "/", label: "Home", ...read, voice: speech.record },
        { path: "/about/", ...read, voice: busy.record },
        {
          path: "/apply/",
          ...read,
          voice: { error: `the recorder said ${"y".repeat(240)}`, recordedAt: VOICE_RECORDED_AT },
        },
        { path: LONG_PATH, ...read, voice: long.record },
        { path: "/report.pdf", status: "skipped" },
      ],
    });
    // A site named by its canonical address, with a long name set for it: the longest top.
    const model = buildShareModel(
      inputOf([run], { transcripts: storeOf(), canonical: CANONICAL, siteName: SITE_NAME }),
    );
    const html = renderVoicePage(model, recordingsOf([run]), { fontCss: await fontFaceCss() });
    if (html === null) throw new Error("The voice page wasn't made.");
    const folder = await mkdtemp(path.join(tmpdir(), "voicecap-share-voice-"));
    folders.push(folder);
    const file = path.join(folder, "voice.html");
    await writeFile(file, html);
    voice = { file, slugs: model.pages.map(({ slug }) => slug) };
    for (const [at, recorded] of [speech, busy, undefined, long].entries()) {
      const slug = voice.slugs[at];
      if (slug !== undefined && recorded !== undefined) kept.set(slug, recorded.record);
    }
  });

  /** Presses Tab until the focus is on an element `selector` finds, in at most `limit` presses. */
  async function tabTo(page: Page, selector: string, limit = 30): Promise<void> {
    for (let presses = 0; presses < limit; presses++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate((wanted) => document.activeElement?.matches(wanted), selector))
        return;
    }
    throw new Error(`Tab didn't reach ${selector} in ${limit} presses.`);
  }

  /**
   * Each first player's rate and pitch, and whether it has played: all a never-played player can
   * say. They are the players that hold the recordings (`audio[data-file]`), never a copy's.
   */
  const players = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLAudioElement>("audio[data-file]")].map((sound) => ({
        rate: sound.playbackRate,
        pitch: sound.preservesPitch,
        paused: sound.paused,
        at: sound.currentTime,
      })),
    );

  /** The value of each speed chosen in a group of them: one, or none. */
  const chosenIn = (group: Locator) =>
    group
      .locator("input:checked")
      .evaluateAll((all) => all.map((one) => one.getAttribute("value")));

  /** The sections that have a player, in order: the cards that have a speed choice. */
  const sections = (page: Page): Locator =>
    page.locator("article.card", { has: page.locator("fieldset.speeds") });

  /** How long the recording of the `at`th section that has a player is, as its record says. */
  const secondsOf = (at: number): number =>
    kept.get(voice.slugs[[0, 1, 3][at] ?? 0] ?? "")?.seconds ?? Number.NaN;

  /**
   * Waits until the `at`th section shows a copy at `speed`: a second player in view, whose address
   * is a blob: one, and whose length (which it knows once it has loaded) is its recording's length
   * divided by the speed, within 1%. While it waits it says what it found, so a failure says why.
   * `seconds` is the recording's length, which is this page's record of the `at`th section's unless
   * a test says it (for a page of its own).
   */
  async function copyShown(
    page: Page,
    at: number,
    speed: number,
    seconds = secondsOf(at),
  ): Promise<void> {
    await expect
      .poll(
        () =>
          sections(page)
            .nth(at)
            .evaluate((card, wanted) => {
              const second = card.querySelector<HTMLAudioElement>("audio:not([data-file])");
              if (second === null) return "no second player";
              if (second.hidden) return "the second player is hidden";
              if (!second.src.startsWith("blob:"))
                return `its address is ${second.src.slice(0, 30)}`;
              return Math.abs(second.duration - wanted) <= wanted * 0.01
                ? "shown"
                : `it is ${second.duration} s long, not ${wanted}`;
            }, seconds / speed),
        { timeout: 20_000 },
      )
      .toBe("shown");
  }

  /**
   * Chooses `speed` in the `at`th section that has a player, and waits until that section shows a
   * copy at it (`seconds` is how long its recording is, when it isn't one of this page's).
   */
  async function slowTo(page: Page, at: number, speed: number, seconds?: number): Promise<void> {
    await page
      .locator("fieldset.speeds")
      .nth(at)
      .getByRole("radio", { name: `${speed}×` })
      .check();
    await copyShown(page, at, speed, seconds);
  }

  /**
   * The `blob:` addresses a page has made and let go of, as `window.book` keeps them, in order: the
   * addresses alive are the first list less the second.
   */
  interface Book {
    made: string[];
    revoked: string[];
  }

  /** A context whose pages keep that book, as their addresses are made and let go of. */
  async function bookkeepingContext(): Promise<BrowserContext> {
    const context = await newContext();
    await context.addInitScript(() => {
      const book: Book = { made: [], revoked: [] };
      Object.assign(window, { book });
      const create = Reflect.get(URL, "createObjectURL");
      const revoke = Reflect.get(URL, "revokeObjectURL");
      URL.createObjectURL = (blob) => {
        const address = create.call(URL, blob);
        book.made.push(address);
        return address;
      };
      URL.revokeObjectURL = (address) => {
        book.revoked.push(address);
        revoke.call(URL, address);
      };
    });
    return context;
  }

  const bookOf = (page: Page) =>
    page.evaluate(() => {
      const { made, revoked } = (window as unknown as { book: Book }).book;
      return {
        made: [...made],
        revoked: [...revoked],
        alive: made.filter((address) => !revoked.includes(address)),
      };
    });

  /**
   * The address of the copy each section that has a player shows, in order: the visible second
   * player's, and "" for a section that shows its first player.
   */
  const shownCopies = (page: Page) =>
    sections(page).evaluateAll((cards) =>
      cards.map((card) => {
        const second = card.querySelector<HTMLAudioElement>("audio:not([data-file])");
        return second === null || second.hidden ? "" : second.src;
      }),
    );

  /**
   * A voice page of `count` pages that each have a player, all of /about/'s recording (`seconds`
   * long), written to a folder of its own: for what the page does when more sections than it keeps
   * copies for each show one (the page the other tests open has three).
   */
  async function pageOfPlayers(count: number): Promise<{ file: string; seconds: number }> {
    const about = kept.get(voice.slugs[1] ?? "");
    if (about === undefined) throw new Error("No recording of /about/.");
    const read = { files: TRANSCRIPTS, passes: LINES };
    const run = shareRun({
      id: "2026-09-29_1402",
      createdAt: "2026-09-29T14:02:51-05:00",
      voicecapVersion: "0.18.0",
      pages: Array.from({ length: count }, (_, at) => ({
        path: `/page-${at + 1}/`,
        ...read,
        voice: about,
      })),
    });
    const model = buildShareModel(inputOf([run], { transcripts: storeOf(), canonical: CANONICAL }));
    const html = renderVoicePage(model, recordingsOf([run]), { fontCss: "" });
    if (html === null) throw new Error("The voice page wasn't made.");
    const folder = await mkdtemp(path.join(tmpdir(), "voicecap-share-voice-"));
    folders.push(folder);
    const file = path.join(folder, "voice.html");
    await writeFile(file, html);
    return { file, seconds: about.seconds };
  }

  /**
   * A context whose pages keep every text the first status line is given, in order, as
   * `window.said`. A mutation record says what its change added, so two texts the page writes in
   * one turn are both kept; a line emptied adds none.
   */
  async function sayingContext(): Promise<BrowserContext> {
    const context = await newContext();
    await context.addInitScript(() => {
      const said: string[] = [];
      Object.assign(window, { said });
      new MutationObserver((records) => {
        const status = document.querySelector(".speed-status");
        for (const record of records) {
          if (record.target !== status) continue;
          for (const node of record.addedNodes) said.push(node.textContent ?? "");
        }
      }).observe(document, { childList: true, subtree: true });
    });
    return context;
  }

  const saidOf = (page: Page) =>
    page.evaluate(() => [...(window as unknown as { said: string[] }).said]);

  /**
   * A context of a browser that refuses to decode a recording: `decodeAudioData` answers with an
   * error, for `count` calls from the `from`th on (the first, by default). The page then slows a
   * recording the browser's own way, as it does where it can't decode.
   */
  async function refusingContext(count: number, from = 1): Promise<BrowserContext> {
    const context = await newContext();
    await context.addInitScript(
      ({ refusals, first }: { refusals: number; first: number }) => {
        const own = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, "decodeAudioData");
        const decode = own?.value as (...args: unknown[]) => Promise<AudioBuffer>;
        let calls = 0;
        BaseAudioContext.prototype.decodeAudioData = function (
          this: BaseAudioContext,
          ...args: unknown[]
        ) {
          calls++;
          return calls >= first && calls < first + refusals
            ? Promise.reject(new DOMException("This test refuses to decode.", "EncodingError"))
            : decode.apply(this, args);
        };
      },
      { refusals: count, first: from },
    );
    return context;
  }

  /**
   * What a slow clock keeps, as `window.clock`: how many times the page has read the clock
   * (`reads`), the reading at which the stretcher gave its copy (`stretched`, -1 until then; what
   * the page does after it is the copy's last steps), the size of each blob the page made
   * (`blobs`), and a click to make, as a task of its own, a number of readings (`after`) from the
   * start or from `stretched` (`trigger`).
   */
  interface SlowClock {
    reads: number;
    stretched: number;
    blobs: number[];
    trigger: { from: "start" | "stretched"; after: number; run: () => void } | null;
  }

  /**
   * A context whose pages have a slow clock: each reading of `performance.now()` moves it on 25
   * ms. The page works in slices of 20 ms by that clock, so each slice does one step (8 frames of
   * the stretcher, or a share of the last steps) and takes two readings, and a copy takes a slice
   * for each step, which a test can count and can act between, to the reading.
   */
  async function slowClockContext(): Promise<BrowserContext> {
    const context = await newContext();
    await context.addInitScript(() => {
      const clock: SlowClock = { reads: 0, stretched: -1, blobs: [], trigger: null };
      Object.assign(window, { clock });
      performance.now = () => {
        clock.reads++;
        const { trigger } = clock;
        const from = trigger?.from === "stretched" ? clock.stretched : 0;
        if (trigger !== null && from >= 0 && clock.reads - from === trigger.after) {
          clock.trigger = null;
          setTimeout(trigger.run, 0);
        }
        return clock.reads * 25;
      };
      // The stretcher takes its copy with `subarray` when it has made all of it, and the last
      // steps follow.
      const subarray = Reflect.get(Float32Array.prototype, "subarray");
      Float32Array.prototype.subarray = function (
        this: Float32Array,
        ...range: [number?, number?]
      ) {
        if (clock.stretched < 0) clock.stretched = clock.reads;
        return subarray.apply(this, range);
      };
      const create = Reflect.get(URL, "createObjectURL");
      URL.createObjectURL = (blob) => {
        if (blob instanceof Blob) clock.blobs.push(blob.size);
        return create.call(URL, blob);
      };
    });
    return context;
  }

  const clockOf = (page: Page) =>
    page.evaluate(() => {
      const { reads, stretched, blobs, trigger } = (window as unknown as { clock: SlowClock })
        .clock;
      return { reads, stretched, blobs: [...blobs], armed: trigger !== null };
    });

  /**
   * The voice page, opened in a browser where no player plays: `play()` and `pause()` only record
   * the player each is made on, "first" for the one that holds a recording and "second" for a
   * copy's, in `window.calls`, and `play()` answers as a player that started does.
   */
  async function recordingPlays(): Promise<Page> {
    const context = await newContext();
    await context.addInitScript(() => {
      const calls: string[] = [];
      Object.assign(window, { calls });
      const named = (sound: HTMLMediaElement) =>
        sound.hasAttribute("data-file") ? "first" : "second";
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        calls.push(`play ${named(this)}`);
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
        calls.push(`pause ${named(this)}`);
      };
    });
    const page = await context.newPage();
    await page.goto(addressOf(voice.file));
    return page;
  }

  const callsOf = (page: Page) =>
    page.evaluate(() => [...(window as unknown as { calls: string[] }).calls]);

  /** A player that says it's playing, as one that is would. */
  const playing = (player: Locator) =>
    player.evaluate((sound) => {
      Object.defineProperty(sound, "paused", { get: () => false });
    });

  it("has a player and a speed choice for each recorded page, and says why for each other", async () => {
    const page = await open(voice.file);

    expect(await page.locator("h1").textContent()).toBe("dvfr.illinois.gov");
    expect(await page.title()).toBe("NVDA's voice: dvfr.illinois.gov, 29 September 2026, 14:02");
    expect(await page.locator("article.card").count()).toBe(5);
    expect(await page.locator("audio").count()).toBe(3);
    expect(await page.locator("fieldset.speeds").count()).toBe(3);
    // The script shows each speed choice, which starts hidden, with 1× chosen.
    for (const group of await page.locator("fieldset.speeds").all()) {
      expect(await group.isVisible()).toBe(true);
      expect(await chosenIn(group)).toEqual(["1"]);
      expect(
        await group
          .locator("input")
          .evaluateAll((all) => all.map((one) => one.getAttribute("value"))),
      ).toEqual(SPEEDS.map(String));
    }
    expect(await page.locator("p.not-recorded").allTextContents()).toEqual([
      `Not recorded: the recorder said ${"y".repeat(240)}.`,
      "Not recorded: no recording was made, since the page wasn't read.",
    ]);
    // Each page's controls are named for it: its player, and its group of speeds.
    expect(await page.getByRole("group", { name: "Speed on /about/" }).count()).toBe(1);
    expect(await page.getByRole("radio", { name: "0.5×" }).count()).toBe(3);
    expect(await page.getByLabel("NVDA's voice on /about/").count()).toBe(1);
  });

  // WCAG 2.5.3, Label in Name, as the browser works a name out (text that is only visually hidden is
  // in it, and Chromium sets it apart from the words before it with a space): each link to a page's
  // transcripts begins with the words it shows, whole, and goes on to its page, so no two links are
  // alike.
  it("names each link to a page's transcripts by the words it shows, whole and first, and then by its page", async () => {
    const page = await open(voice.file);
    const shown = "The full transcript, on the shareable page";
    const links = page.locator("article.card p.sub a[href*='#tx-']");

    // The four pages read in full each have one; the file the run skipped has none.
    expect(await links.count()).toBe(4);
    for (const link of await links.all()) {
      // What the eye reads is the link's own text, not what is there for a screen reader alone.
      expect(
        await link.evaluate((anchor) =>
          [...anchor.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join(""),
        ),
      ).toBe(shown);
    }
    // Every name begins with those words; the name of each ends with its own page.
    expect(await page.getByRole("link", { name: new RegExp(`^${shown}\\s*:`) }).count()).toBe(4);
    for (const path of ["/", "/about/", "/apply/", LONG_PATH]) {
      const ending = path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      expect(
        await page.getByRole("link", { name: new RegExp(`^${shown}\\s*:\\s*${ending}$`) }).count(),
        path,
      ).toBe(1);
    }
  });

  it("makes a slowed copy and shows it in a second player in the first one's place", async () => {
    const page = await open(voice.file);
    const group = page.locator("fieldset.speeds").first();
    const first = sections(page).first().locator("audio[data-file]");
    const second = sections(page).first().locator("audio:not([data-file])");
    const address = await first.getAttribute("src");

    // Until a copy is shown the page has its first players alone, every one at 1× with its pitch
    // kept, and nothing is said.
    expect(address).toMatch(/^data:audio\/webm;base64,/);
    expect(await page.locator("audio").count()).toBe(3);
    expect(await players(page)).toEqual(
      Array.from({ length: 3 }, () => ({ rate: 1, pitch: true, paused: true, at: 0 })),
    );
    expect(await sections(page).first().locator(".speed-status").textContent()).toBe("");

    await group.getByRole("radio", { name: "0.3×" }).check();
    await copyShown(page, 0, 0.3);

    // The copy is in the first player's place: a visible player after it, which has its controls
    // and none of the data- names the check finds a recording by, named for its page and speed,
    // and never played. The first player is hidden, and holds the address it had.
    expect(await second.isVisible()).toBe(true);
    expect(await first.isVisible()).toBe(false);
    expect(await first.getAttribute("src")).toBe(address);
    expect(await first.evaluate((sound) => sound.nextElementSibling?.matches("audio"))).toBe(true);
    expect(
      await second.evaluate((element) => {
        const sound = element as HTMLAudioElement;
        return {
          controls: sound.controls,
          preload: sound.preload,
          data: sound.getAttributeNames().filter((name) => name.startsWith("data-")),
          name: sound.getAttribute("aria-label"),
          rate: sound.playbackRate,
          pitch: sound.preservesPitch,
          paused: sound.paused,
          at: sound.currentTime,
        };
      }),
    ).toEqual({
      controls: true,
      preload: "auto",
      data: [],
      name: "NVDA's voice on /, at 0.3×",
      rate: 1,
      pitch: true,
      paused: true,
      at: 0,
    });
    expect(await sections(page).first().locator(".speed-status").textContent()).toBe(
      "0.3× is ready.",
    );
    expect(await chosenIn(group)).toEqual(["0.3"]);
    // Nothing else changed: the first players are as they were, and no other section has a copy.
    expect(await players(page)).toEqual(
      Array.from({ length: 3 }, () => ({ rate: 1, pitch: true, paused: true, at: 0 })),
    );
    expect(await page.locator("audio:not([data-file])").count()).toBe(1);
  });

  it("says it's getting a copy ready, then that it's ready", async () => {
    const page = await (await sayingContext()).newPage();
    await page.goto(addressOf(voice.file));

    await page.locator("fieldset.speeds").first().getByRole("radio", { name: "0.5×" }).check();
    await copyShown(page, 0, 0.5);

    expect(await saidOf(page)).toEqual(["Getting 0.5× ready…", "0.5× is ready."]);
  });

  it("keeps each copy it made, and shows one again at once", async () => {
    const page = await (await sayingContext()).newPage();
    await page.goto(addressOf(voice.file));
    const group = page.locator("fieldset.speeds").first();
    const second = sections(page).first().locator("audio:not([data-file])");
    const status = sections(page).first().locator(".speed-status");

    await group.getByRole("radio", { name: "0.5×" }).check();
    await copyShown(page, 0, 0.5);
    const made = await second.getAttribute("src");
    await group.getByRole("radio", { name: "0.3×" }).check();
    await copyShown(page, 0, 0.3);
    expect(await second.getAttribute("src")).not.toBe(made);

    // 0.5× again is the copy it made, from the same address, and nothing is made: the status line
    // says it's ready as the choice is made, with no wait, and never that it's getting it ready.
    await group.getByRole("radio", { name: "0.5×" }).check();
    expect(await status.textContent()).toBe("0.5× is ready.");
    expect(await second.getAttribute("src")).toBe(made);
    await copyShown(page, 0, 0.5);
    expect(await saidOf(page)).toEqual([
      "Getting 0.5× ready…",
      "0.5× is ready.",
      "Getting 0.3× ready…",
      "0.3× is ready.",
      "0.5× is ready.",
    ]);
  });

  // Review Focus 2: the page keeps at most four copies at once, across its sections. A copy let go
  // of has its address revoked and is out of its section's copies, so it's made anew when chosen
  // again, and a copy a section has in view is never let go of.
  it("keeps at most four copies on the page, never the one in view", async () => {
    const page = await (await bookkeepingContext()).newPage();
    await page.goto(addressOf(voice.file));

    // Four copies, three in the first section and one in the second: nothing is let go of.
    await slowTo(page, 0, 0.3);
    await slowTo(page, 0, 0.5);
    await slowTo(page, 0, 0.75);
    await slowTo(page, 1, 0.3);
    const four = await bookOf(page);
    expect(four.alive).toHaveLength(4);
    expect(four.revoked).toEqual([]);

    // A fifth, in the third section: the first one made, the first section's 0.3×, is let go of.
    await slowTo(page, 2, 0.3);
    const five = await bookOf(page);
    expect(five.made).toHaveLength(5);
    expect(five.revoked).toEqual([five.made[0]]);
    expect(five.alive).toHaveLength(4);
    // Each section's copy in view is alive: the first's 0.75×, the second's 0.3×, the third's 0.3×.
    expect(await shownCopies(page)).toEqual([five.made[2], five.made[3], five.made[4]]);
    for (const address of await shownCopies(page)) expect(five.alive).toContain(address);

    // The first section's 0.3× again: it isn't kept, so it's made anew (a sixth address) and shown,
    // and to make room the first section's 0.5×, no longer in view and shown longest ago, goes.
    await slowTo(page, 0, 0.3);
    const six = await bookOf(page);
    expect(six.made).toHaveLength(6);
    expect((await shownCopies(page))[0]).toBe(six.made[5]);
    expect(await sections(page).first().locator(".speed-status").textContent()).toBe(
      "0.3× is ready.",
    );
    expect(six.revoked).toEqual([five.made[0], five.made[1]]);
    expect(six.alive).toHaveLength(4);
    for (const address of await shownCopies(page)) expect(six.alive).toContain(address);
  });

  // A copy made or shown again goes to the end of the list, so the one let go of is the one shown
  // longest ago, and not the one made first.
  it("lets go of the copy shown longest ago, so a copy shown again is kept", async () => {
    const page = await (await bookkeepingContext()).newPage();
    await page.goto(addressOf(voice.file));

    await slowTo(page, 0, 0.3);
    await slowTo(page, 0, 0.5);
    await slowTo(page, 0, 0.75);
    await slowTo(page, 1, 0.3);
    // The first section's 0.3× and then its 0.5× are shown again: both are kept, so nothing is made.
    await slowTo(page, 0, 0.3);
    await slowTo(page, 0, 0.5);
    expect((await bookOf(page)).made).toHaveLength(4);
    // A fifth copy: the first section's 0.75× has been out of view the longest, since it was shown
    // before the other two were shown again. (The first made, its 0.3×, would go if only the order
    // they were made in counted.)
    await slowTo(page, 2, 0.3);
    const book = await bookOf(page);
    expect(book.made).toHaveLength(5);
    expect(book.revoked).toEqual([book.made[2]]);
    expect(book.alive).toHaveLength(4);
  });

  // A copy isn't in view when its player is hidden (1× brings the first player back), though the
  // hidden player still has its address: it's let go of like any other, with no error from the player.
  it("lets go of a copy its player hides, and makes it anew when it's chosen again", async () => {
    const page = await (await bookkeepingContext()).newPage();
    await page.goto(addressOf(voice.file));
    const group = page.locator("fieldset.speeds").first();

    await slowTo(page, 0, 0.3);
    await group.getByRole("radio", { name: "1×" }).check();
    expect(await shownCopies(page)).toEqual(["", "", ""]);
    await slowTo(page, 1, 0.3);
    await slowTo(page, 1, 0.5);
    await slowTo(page, 2, 0.3);
    await slowTo(page, 2, 0.5);
    // The fifth copy: the first section's 0.3×, shown first and out of view since 1×, goes.
    const five = await bookOf(page);
    expect(five.made).toHaveLength(5);
    expect(five.revoked).toEqual([five.made[0]]);
    expect(await sections(page).first().locator("audio:not([data-file])").getAttribute("src")).toBe(
      five.made[0],
    );
    expect(await sections(page).first().locator("audio:not([data-file])").isVisible()).toBe(false);

    // Chosen again, it is made anew, and shown.
    await slowTo(page, 0, 0.3);
    const six = await bookOf(page);
    expect(six.made).toHaveLength(6);
    expect((await shownCopies(page))[0]).toBe(six.made[5]);
    expect(await sections(page).first().locator(".speed-status").textContent()).toBe(
      "0.3× is ready.",
    );
  });

  // A section's copy in view is never let go of, so when more sections than the page keeps copies
  // for each show one, it keeps all of them, which is more than four.
  it("keeps every copy that is in view, even when that is more than four", async () => {
    const { file, seconds } = await pageOfPlayers(6);
    const page = await (await bookkeepingContext()).newPage();
    await page.goto(addressOf(file));
    expect(await sections(page).count()).toBe(6);

    for (let at = 0; at < 6; at++) await slowTo(page, at, 0.5, seconds);
    const six = await bookOf(page);
    expect(six.made).toHaveLength(6);
    expect(six.revoked).toEqual([]);
    expect(await shownCopies(page)).toEqual(six.made);

    // A seventh, in the first section: its 0.5× is out of view now, and it alone is let go of.
    await slowTo(page, 0, 0.3, seconds);
    const seven = await bookOf(page);
    expect(seven.made).toHaveLength(7);
    expect(seven.revoked).toEqual([six.made[0]]);
    expect(seven.alive).toHaveLength(6);
    expect(await shownCopies(page)).toEqual([seven.made[6], ...six.made.slice(1)]);
  });

  // Review Focus 5: the place in the speech is the same across speeds. A recording is as long as it
  // is, and a copy 1 ÷ its speed times as long, so the place is the time in the player in view
  // times its speed, and the time in the player shown is the place ÷ its speed.
  it("keeps the place in the speech across speeds", async () => {
    const page = await open(voice.file);
    const group = page.locator("fieldset.speeds").first();
    const first = sections(page).first().locator("audio[data-file]");
    const second = sections(page).first().locator("audio:not([data-file])");
    const status = sections(page).first().locator(".speed-status");
    const place = (player: Locator) =>
      player.evaluate((sound) => (sound as HTMLAudioElement).currentTime);

    // The place is 1.2 s into the recording, in the first player, which was never played (a browser
    // keeps what is set as where the player starts).
    await first.evaluate((sound) => {
      (sound as HTMLAudioElement).currentTime = 1.2;
    });
    for (const [speed, wanted] of [
      [0.5, 2.4],
      [0.3, 4.0],
    ] as const) {
      await group.getByRole("radio", { name: `${speed}×` }).check();
      await copyShown(page, 0, speed);
      await expect
        .poll(async () => Math.abs((await place(second)) - wanted), { timeout: 5_000 })
        .toBeLessThan(0.1);
    }

    // 1× brings the first player back at the place the copy was at, shows it, and hides the copy.
    await group.getByRole("radio", { name: "1×" }).check();
    expect(await first.isVisible()).toBe(true);
    expect(await second.isVisible()).toBe(false);
    expect(Math.abs((await place(first)) - 1.2)).toBeLessThan(0.1);
    expect(await status.textContent()).toBe("");
    expect(await chosenIn(group)).toEqual(["1"]);
    expect((await players(page))[0]).toMatchObject({ rate: 1, pitch: true, paused: true });
  });

  // Review Focus 5: a player that was playing plays on. A browser's `play()` and `pause()` are
  // stand-ins here that only record the player each was made on, so nothing makes a sound.
  it("plays on in the copy when the player in view was playing", async () => {
    const page = await recordingPlays();
    const group = page.locator("fieldset.speeds").first();
    const first = sections(page).first().locator("audio[data-file]");
    const second = sections(page).first().locator("audio:not([data-file])");

    // The first player is playing: the copy takes over, and plays on.
    await playing(first);
    await group.getByRole("radio", { name: "0.5×" }).check();
    await copyShown(page, 0, 0.5);
    expect((await callsOf(page)).toSorted()).toEqual(["pause first", "play second"]);

    // And back to 1×, when the copy is playing: the first player plays on, and the copy stops.
    await playing(second);
    await group.getByRole("radio", { name: "1×" }).check();
    expect((await callsOf(page)).slice(2).toSorted()).toEqual(["pause second", "play first"]);
  });

  it("plays nothing when the player in view wasn't playing", async () => {
    const page = await recordingPlays();
    const group = page.locator("fieldset.speeds").first();

    await group.getByRole("radio", { name: "0.5×" }).check();
    await copyShown(page, 0, 0.5);
    await group.getByRole("radio", { name: "1×" }).check();
    await group.getByRole("radio", { name: "0.75×" }).check();
    await copyShown(page, 0, 0.75);

    expect(await callsOf(page)).toEqual([]);
    expect((await players(page)).every((player) => player.paused && player.at === 0)).toBe(true);
  });

  // The focus goes with the player in view. A copy comes in when it's ready, and 1× or a fallback
  // brings the first player back, each as a task of its own, so a person can have the keyboard on
  // the player that is being replaced: it hides, and a key (Space, to pause it) must still reach
  // the player that takes its place, and not fall to the page, which it would scroll.
  it("keeps the focus with the player in view when a copy, or the first player, takes its place", async () => {
    const page = await open(voice.file);
    const group = page.locator("fieldset.speeds").first();
    const focusIs = (selector: string) =>
      page.evaluate((wanted) => document.activeElement?.matches(wanted) ?? false, selector);
    const FIRST = "audio[data-file]";
    const SECOND = "audio:not([data-file])";

    // The first player has the focus when 0.5× is chosen, before its copy is ready (both in one
    // turn, so it can't be): the copy takes its place, and the focus goes to the copy. The focus is
    // read in that same turn, as the test identifies it: a copy of this short recording can be
    // ready within tens of milliseconds, so a round trip later it may have the focus already.
    const focusedFirst = await page.evaluate((wanted) => {
      document.querySelector<HTMLInputElement>('input[value="0.5"]')?.click();
      document.querySelector<HTMLElement>("audio[data-file]")?.focus();
      return document.activeElement?.matches(wanted) ?? false;
    }, FIRST);
    expect(focusedFirst).toBe(true);
    await copyShown(page, 0, 0.5);
    expect(await focusIs(SECOND)).toBe(true);

    // The copy has the focus when 1× is chosen: the first player comes back, and has it.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>("audio:not([data-file])")?.focus();
      document.querySelector<HTMLInputElement>('input[value="1"]')?.click();
    });
    expect(await focusIs(FIRST)).toBe(true);

    // And a player that doesn't have the focus doesn't take it: from the speed choice, a copy that
    // comes in leaves the focus on the choice.
    await group.getByRole("radio", { name: "0.75×" }).check();
    await copyShown(page, 0, 0.75);
    expect(await focusIs('input[name^="speed-"]')).toBe(true);
  });

  it("keeps the focus with the player in view when a fallback brings the first player back", async () => {
    // The first recording decoded is made into a copy; the second is refused.
    const page = await (await refusingContext(1_000, 2)).newPage();
    await page.goto(addressOf(voice.file));
    const group = page.locator("fieldset.speeds").first();

    await group.getByRole("radio", { name: "0.5×" }).check();
    await copyShown(page, 0, 0.5);
    // The copy has the focus when 0.3× is chosen, and the browser can't make that copy: the section
    // falls back, and the first player comes back, at 0.3×, with the focus.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>("audio:not([data-file])")?.focus();
      document.querySelector<HTMLInputElement>('input[value="0.3"]')?.click();
    });
    await expect.poll(async () => (await players(page))[0]?.rate).toBe(0.3);
    expect(
      await page.evaluate(() => document.activeElement?.matches("audio[data-file]") ?? false),
    ).toBe(true);
  });

  // Review Focus 1: a choice made while a copy is being made drops that copy. The copy for 0.3× is
  // the slower to make, so it would finish after the one for 0.5× if it weren't dropped.
  it("the last choice wins while a copy is being made", async () => {
    const page = await (await sayingContext()).newPage();
    await page.goto(addressOf(voice.file));
    const group = page.locator("fieldset.speeds").first();
    const status = sections(page).first().locator(".speed-status");

    // Two choices in one turn: 0.3×, then 0.5×, before either copy can be ready.
    await page.evaluate(() => {
      for (const value of ["0.3", "0.5"]) {
        document.querySelector<HTMLInputElement>(`input[value="${value}"]`)?.click();
      }
    });
    await copyShown(page, 0, 0.5);
    const settled = async () => ({
      status: await status.textContent(),
      chosen: await chosenIn(group),
    });
    expect(await settled()).toEqual({ status: "0.5× is ready.", chosen: ["0.5"] });

    // It stays so: the copy for the choice before it is never shown, and never kept.
    await page.waitForTimeout(1_000);
    await copyShown(page, 0, 0.5);
    expect(await settled()).toEqual({ status: "0.5× is ready.", chosen: ["0.5"] });
    expect(await saidOf(page)).toEqual([
      "Getting 0.3× ready…",
      "Getting 0.5× ready…",
      "0.5× is ready.",
    ]);
    await group.getByRole("radio", { name: "0.3×" }).check();
    await copyShown(page, 0, 0.3);
    expect((await saidOf(page)).slice(3)).toEqual(["Getting 0.3× ready…", "0.3× is ready."]);
  });

  // The page never stops answering while a copy is made: its work is in slices of about 20 ms, the
  // copy's last steps (the filter, the loudness, and the file: five passes over its samples, which
  // are many for a long recording) as the stretcher's are, not one block after them. With the slow
  // clock each slice is one step, so the steps can be counted, and a choice can come between them.
  it("makes the last steps of a copy in slices too, so the page keeps answering", async () => {
    const page = await (await slowClockContext()).newPage();
    await page.goto(addressOf(voice.file));

    await page.locator("fieldset.speeds").first().getByRole("radio", { name: "0.3×" }).check();
    await copyShown(page, 0, 0.3);

    // A slice reads the clock twice. After the stretcher's last step, the last steps of a copy of
    // 100,000 samples and more are many slices, not the one that a block would be.
    const { reads, stretched, blobs } = await clockOf(page);
    expect(stretched).toBeGreaterThan(0);
    expect((reads - stretched) / 2).toBeGreaterThanOrEqual(10);
    expect(blobs).toHaveLength(1);
  });

  // A job checks, before each slice, that it's still the choice made last. The two checks that
  // matter are in the copy's stretching and in its last steps: a choice made in the middle of
  // either, as a task between two slices, drops the copy being made, which is never shown and never
  // kept: no blob is made for it, and the page stops working on it at its next slice.
  it.each([
    ["stretching", "1×", "1", { from: "start", after: 20 }],
    ["last steps", "1×", "1", { from: "stretched", after: 6 }],
    ["stretching", "0.5×", "0.5", { from: "start", after: 20 }],
    ["last steps", "0.5×", "0.5", { from: "stretched", after: 6 }],
  ] as const)(
    "drops a copy in its %s when %s is chosen, so it's never shown",
    async (_phase, _choice, value, when) => {
      const page = await (await slowClockContext()).newPage();
      await page.goto(addressOf(voice.file));
      const group = page.locator("fieldset.speeds").first();
      const status = sections(page).first().locator(".speed-status");

      // The second choice is a click the page's clock makes, a task of its own, at the reading
      // given: it comes between two slices of the copy for 0.3×, which is being made.
      await page.evaluate(
        ([wanted, from, after]) => {
          const clock = (window as unknown as { clock: SlowClock }).clock;
          const radio = document.querySelector<HTMLInputElement>(`input[value="${wanted}"]`);
          clock.trigger = { from, after, run: () => radio?.click() };
        },
        [value, when.from, when.after] as const,
      );
      // Clicked, not checked: after its click, a check asks that the button's state has changed, and
      // the page's clock makes its own click, on 1× or 0.5×, some 20 to 40 ms after this one, which
      // can come first and leave 0.3× unchecked.
      await group.getByRole("radio", { name: "0.3×" }).click();
      await expect.poll(async () => (await clockOf(page)).armed, { timeout: 20_000 }).toBe(false);
      if (value === "1") await expect.poll(() => chosenIn(group)).toEqual(["1"]);
      else await copyShown(page, 0, 0.5);
      // Time enough for the copy that was dropped to be finished, if it were still being made.
      await page.waitForTimeout(1_000);

      const clock = await clockOf(page);
      if (value === "1") {
        // The first player is back, there was never a second, and nothing was made: no blob, and
        // the page stopped working on the copy at once: it read the clock a few times after the
        // click at most (a slice reads it twice), where working on at 20 ms a slice would be
        // hundreds of readings.
        expect(await page.locator("audio:not([data-file])").count()).toBe(0);
        expect(await status.textContent()).toBe("");
        expect(clock.blobs).toEqual([]);
        expect(clock.reads).toBeLessThanOrEqual(
          (when.from === "start" ? 0 : clock.stretched) + when.after + 4,
        );
        // In the last steps, the stretcher had made its copy; in the stretching, it hadn't.
        expect(clock.stretched >= 0).toBe(when.from === "stretched");
      } else {
        // The second player shows the copy for 0.5×, and it alone was made: one blob, the size of
        // that copy's file (44 bytes and two for each sample of a copy twice as long as the
        // recording), not the size the copy for 0.3× would have been.
        const wanted = 44 + 2 * ((secondsOf(0) * 16_000) / 0.5);
        expect(await status.textContent()).toBe("0.5× is ready.");
        expect(await chosenIn(group)).toEqual(["0.5"]);
        expect(clock.blobs).toHaveLength(1);
        expect(Math.abs((clock.blobs[0] ?? 0) - wanted)).toBeLessThan(wanted * 0.01);
      }
    },
  );

  it("falls back to the browser's own slow-down when it can't decode", async () => {
    const page = await (await refusingContext(1_000)).newPage();
    await page.goto(addressOf(voice.file));
    const groups = page.locator("fieldset.speeds");
    const status = (at: number) => sections(page).nth(at).locator(".speed-status");
    const rateOf = async (at: number) => (await players(page))[at]?.rate;
    const OWN = "This browser slows it down with its own stretcher.";

    // A browser's pitch may be off: the choice sets it, and touches only its own player.
    await page.evaluate(() => {
      for (const sound of document.querySelectorAll("audio")) sound.preservesPitch = false;
    });
    await groups.nth(0).getByRole("radio", { name: "0.3×" }).check();
    // The recording is refused: the first player is slowed the browser's own way, with the pitch
    // kept, and the section says so. There is no second player.
    await expect.poll(() => rateOf(0)).toBe(0.3);
    expect(await players(page)).toEqual([
      { rate: 0.3, pitch: true, paused: true, at: 0 },
      { rate: 1, pitch: false, paused: true, at: 0 },
      { rate: 1, pitch: false, paused: true, at: 0 },
    ]);
    expect(await status(0).textContent()).toBe(OWN);
    expect(await page.locator("audio:not([data-file])").count()).toBe(0);
    expect(await sections(page).first().locator("audio[data-file]").isVisible()).toBe(true);
    expect(await chosenIn(groups.first())).toEqual(["0.3"]);
    // And from then on every choice is the browser's, at once.
    await groups.nth(0).getByRole("radio", { name: "0.75×" }).check();
    expect(await rateOf(0)).toBe(0.75);
    expect(await status(0).textContent()).toBe(OWN);

    // Every speed, in any order, and back to 1×, in the next section (which falls back on its own
    // first choice, and says so), with 1× as recorded and the status line empty.
    await groups.nth(1).getByRole("radio", { name: "0.75×" }).check();
    await expect.poll(() => rateOf(1)).toBe(0.75);
    for (const speed of [0.5, 0.3, 1, 0.5]) {
      await groups
        .nth(1)
        .getByRole("radio", { name: `${speed}×` })
        .check();
      expect((await players(page))[1]).toEqual({ rate: speed, pitch: true, paused: true, at: 0 });
      expect(await status(1).textContent()).toBe(speed === 1 ? "" : OWN);
    }
    expect(await rateOf(0)).toBe(0.75);
    // The speed is the player's default too, so it keeps when the browser loads the file again.
    await page.evaluate(() => {
      document.querySelectorAll<HTMLAudioElement>("audio[data-file]")[1]?.load();
    });
    expect(await rateOf(1)).toBe(0.5);
  });

  // Review Focus 3: a recording the browser can't decode is that section's alone.
  it("falls back for one section, and the others still make copies", async () => {
    const page = await (await refusingContext(1)).newPage();
    await page.goto(addressOf(voice.file));
    const groups = page.locator("fieldset.speeds");
    const status = (at: number) => sections(page).nth(at).locator(".speed-status");

    // The first recording decoded is refused: the first section falls back at 0.5×.
    await groups.nth(0).getByRole("radio", { name: "0.5×" }).check();
    await expect.poll(async () => (await players(page))[0]?.rate).toBe(0.5);
    expect(await status(0).textContent()).toBe(
      "This browser slows it down with its own stretcher.",
    );
    // The second section makes its copy at 0.5× as it would anywhere.
    await groups.nth(1).getByRole("radio", { name: "0.5×" }).check();
    await copyShown(page, 1, 0.5);
    expect(await status(1).textContent()).toBe("0.5× is ready.");
    expect((await players(page))[1]).toEqual({ rate: 1, pitch: true, paused: true, at: 0 });
    expect(await page.locator("audio:not([data-file])").count()).toBe(1);

    // Each carries on its own way: the first section's later choices are the browser's, the
    // second's are copies.
    await groups.nth(0).getByRole("radio", { name: "0.3×" }).check();
    expect((await players(page))[0]?.rate).toBe(0.3);
    await groups.nth(1).getByRole("radio", { name: "0.3×" }).check();
    await copyShown(page, 1, 0.3);
    expect(await page.locator("audio:not([data-file])").count()).toBe(1);
  });

  // The page falls back wherever it can't make a copy, not only where a recording is refused: the
  // browser can be without the means, or decoding can throw as it's asked for. Both are ordinary
  // for a browser, so the page says nothing of either (every test ends by checking that).
  it.each([
    [
      "has no OfflineAudioContext",
      () => {
        Reflect.deleteProperty(window, "OfflineAudioContext");
        Reflect.deleteProperty(window, "webkitOfflineAudioContext");
      },
    ],
    [
      "throws as it's asked to decode",
      () => {
        BaseAudioContext.prototype.decodeAudioData = () => {
          throw new DOMException("This test throws.", "InvalidStateError");
        };
      },
    ],
  ])("falls back where the browser %s", async (_, breakIt) => {
    const context = await newContext();
    await context.addInitScript(breakIt);
    const page = await context.newPage();
    await page.goto(addressOf(voice.file));
    const group = page.locator("fieldset.speeds").first();

    await group.getByRole("radio", { name: "0.3×" }).check();
    await expect.poll(async () => (await players(page))[0]?.rate).toBe(0.3);
    expect(await sections(page).first().locator(".speed-status").textContent()).toBe(
      "This browser slows it down with its own stretcher.",
    );
    expect(await page.locator("audio:not([data-file])").count()).toBe(0);
    expect(await chosenIn(group)).toEqual(["0.3"]);
    // From then on its choices are the browser's own, at once.
    await group.getByRole("radio", { name: "0.5×" }).check();
    expect((await players(page))[0]?.rate).toBe(0.5);
  });

  // The page falls back where its own work throws too, but it doesn't hide that: it writes the
  // error to the console first, once, where a browser that can't decode says nothing. Each part is
  // made to throw by a stand-in for something only it calls: the stretcher is the first to take a
  // cosine (for its window), the finisher the only one to take a power (for its shelf), and the
  // address of the copy is made last.
  it.each([
    [
      "the stretcher",
      "The stretcher throws.",
      (message: string) => {
        Math.cos = () => {
          throw new Error(message);
        };
      },
    ],
    [
      "the finisher",
      "The finisher throws.",
      (message: string) => {
        Math.pow = () => {
          throw new Error(message);
        };
      },
    ],
    [
      "the copy's address",
      "The address throws.",
      (message: string) => {
        URL.createObjectURL = () => {
          throw new DOMException(message, "NotSupportedError");
        };
      },
    ],
  ] as const)(
    "falls back, and writes the error to the console, where %s throws",
    async (_, message, breakIt) => {
      const context = await newContext();
      await context.addInitScript(breakIt, message);
      const page = await context.newPage();
      await page.goto(addressOf(voice.file));
      const group = page.locator("fieldset.speeds").first();

      await group.getByRole("radio", { name: "0.3×" }).check();
      await expect.poll(async () => (await players(page))[0]?.rate, { timeout: 20_000 }).toBe(0.3);
      expect(await sections(page).first().locator(".speed-status").textContent()).toBe(
        "This browser slows it down with its own stretcher.",
      );
      expect(await page.locator("audio:not([data-file])").count()).toBe(0);
      expect(await chosenIn(group)).toEqual(["0.3"]);
      // One console error, which names what failed. It is expected, so the test takes it out of
      // what the pages reported, which every test ends by holding to be nothing.
      expect(reported.splice(0)).toEqual([expect.stringContaining(message)]);
    },
  );

  it("catches the error a browser throws for a speed it won't play at, and keeps showing the speed it's at", async () => {
    // A browser that can't decode, so the page slows the recording itself, with `playbackRate`.
    const context = await refusingContext(1_000);
    // As Chromium refuses a rate outside 0.0625 to 16, here one under 0.5 is refused.
    await context.addInitScript(() => {
      const own = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate");
      Object.defineProperty(HTMLMediaElement.prototype, "playbackRate", {
        ...own,
        set(this: HTMLMediaElement, value: number) {
          if (value < 0.5) {
            throw new DOMException(
              `The provided playback rate (${value}) is not in the supported playback range.`,
              "NotSupportedError",
            );
          }
          own?.set?.call(this, value);
        },
      });
    });
    const page = await context.newPage();
    await page.goto(addressOf(voice.file));
    const group = page.locator("fieldset.speeds").first();

    // The recording is refused, and the section falls back to the browser's own slow-down.
    await group.getByRole("radio", { name: "0.5×" }).check();
    await expect.poll(async () => (await players(page))[0]?.rate).toBe(0.5);
    // Clicked, not checked: a check asks that the button's state change, and here it won't.
    await group.getByRole("radio", { name: "0.3×" }).click();

    // The page reported nothing (the test ends by checking that), the player is where it was, and
    // the choice shows it: the browser's refusal isn't left looking like a speed it's at.
    expect((await players(page))[0]?.rate).toBe(0.5);
    expect(await chosenIn(group)).toEqual(["0.5"]);
    // The other speeds still work.
    await group.getByRole("radio", { name: "0.75×" }).check();
    expect((await players(page))[0]?.rate).toBe(0.75);
  });

  it("shows the speed a player is at when something else changes it", async () => {
    // In a browser that can't decode, where the browser slows the recording itself: its choice
    // follows the player's speed. (Where a copy is made, the player in view is at its own speed,
    // and its choice is the speed of the copy.)
    const page = await (await refusingContext(1_000)).newPage();
    await page.goto(addressOf(voice.file));
    const group = page.locator("fieldset.speeds").first();
    const setRate = (rate: number) =>
      page.evaluate((to) => {
        const sound = document.querySelector("audio");
        if (sound !== null) sound.playbackRate = to;
      }, rate);

    // The first choice is refused, and the section slows the recording the browser's own way.
    await group.getByRole("radio", { name: "0.5×" }).check();
    await expect.poll(async () => (await players(page))[0]?.rate).toBe(0.5);
    // The browser's own controls have a speed menu: its choice is the one shown.
    await setRate(0.75);
    await expect.poll(() => chosenIn(group)).toEqual(["0.75"]);
    // A speed this page doesn't offer is no choice it has: none is shown as chosen.
    await setRate(1.5);
    await expect.poll(() => chosenIn(group)).toEqual([]);
    await setRate(0.3);
    await expect.poll(() => chosenIn(group)).toEqual(["0.3"]);
  });

  // The browser's own controls have a speed menu, on a copy's player as on the first player's. A
  // copy plays at the rate it was made for, so while the player in view is at another one, the speed
  // it's at is none of the copies the page made, and no choice is shown chosen.
  it("shows no speed chosen while a copy plays at another speed", async () => {
    const page = await open(voice.file);
    const group = page.locator("fieldset.speeds").first();
    const second = sections(page).first().locator("audio:not([data-file])");
    const setRate = (rate: number) =>
      second.evaluate((sound, to) => {
        (sound as HTMLAudioElement).playbackRate = to;
      }, rate);

    await group.getByRole("radio", { name: "0.5×" }).check();
    await copyShown(page, 0, 0.5);
    expect(await chosenIn(group)).toEqual(["0.5"]);

    await setRate(1.5);
    await expect.poll(() => chosenIn(group)).toEqual([]);
    // Nothing else changes: the copy is still the player in view, and the first player is as it was.
    expect(await second.isVisible()).toBe(true);
    expect((await players(page))[0]).toMatchObject({ rate: 1, pitch: true, paused: true });
    expect(await sections(page).first().locator(".speed-status").textContent()).toBe(
      "0.5× is ready.",
    );
    await setRate(1);
    await expect.poll(() => chosenIn(group)).toEqual(["0.5"]);
  });

  it("shows the speed its player starts at, whatever the browser kept of an earlier choice", async () => {
    // A browser that loads a page again can bring back the button that was chosen (here, 0.3× in
    // the first player's group), while the player starts at 1× as it always does: the page's markup
    // as such a browser has it. The choice shows the player's speed, not the browser's memory.
    const kept = (await readFile(voice.file, "utf8"))
      .replace('value="1" checked>', 'value="1">')
      .replace('value="0.3">', 'value="0.3" checked>');
    const page = await (await newContext()).newPage();
    await page.setContent(kept, { waitUntil: "load" });

    expect((await players(page))[0]?.rate).toBe(1);
    expect(await chosenIn(page.locator("fieldset.speeds").first())).toEqual(["1"]);
  });

  it("keeps the pitch from the start, in a browser that doesn't unless the page says so", async () => {
    // One that can't decode too, so the page slows the recording itself.
    const context = await refusingContext(1_000);
    // A browser that lets the pitch follow the speed until the page says otherwise.
    await context.addInitScript(() => {
      const pitch = new WeakMap<object, boolean>();
      Object.defineProperty(HTMLMediaElement.prototype, "preservesPitch", {
        configurable: true,
        get(this: HTMLMediaElement) {
          return pitch.get(this) ?? false;
        },
        set(this: HTMLMediaElement, value: boolean) {
          pitch.set(this, value);
        },
      });
    });
    const page = await context.newPage();
    await page.goto(addressOf(voice.file));

    // Every player has it on before anything is chosen, and still has it on at a slower speed.
    expect((await players(page)).map(({ pitch }) => pitch)).toEqual([true, true, true]);
    await page.locator("fieldset.speeds").first().getByRole("radio", { name: "0.3×" }).check();
    await expect
      .poll(async () => (await players(page))[0])
      .toEqual({ rate: 0.3, pitch: true, paused: true, at: 0 });
  });

  it("plays each recording as a file the browser loads, as long as its record says", async () => {
    const page = await open(voice.file);
    // Loaded, not played: a player says how long its file is once it knows.
    const lengths = await page.evaluate(() =>
      Promise.all(
        [...document.querySelectorAll("audio")].map(
          (sound) =>
            new Promise<{ slug: string | null; seconds: number }>((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("No length in 10 s.")), 10_000);
              sound.addEventListener(
                "loadedmetadata",
                () => {
                  clearTimeout(timer);
                  resolve({ slug: sound.getAttribute("data-slug"), seconds: sound.duration });
                },
                { once: true },
              );
              sound.addEventListener("error", () => reject(new Error(sound.error?.message)), {
                once: true,
              });
              sound.preload = "metadata";
              sound.load();
            }),
        ),
      ),
    );

    expect(lengths.map(({ slug }) => slug)).toEqual(
      [voice.slugs[0], voice.slugs[1], voice.slugs[3]].map((slug) => slug ?? ""),
    );
    for (const { slug, seconds } of lengths) {
      expect(seconds).toBeCloseTo(kept.get(slug ?? "")?.seconds ?? Number.NaN, 2);
    }
    expect((await players(page)).every((player) => player.paused && player.at === 0)).toBe(true);
  });

  it("Check the fingerprints passes, and catches a recording changed by one byte", async () => {
    const page = await open(voice.file);
    // With a slowed copy in the first section: a copy is no recording the run kept, and has no
    // name for the check to find, so the check reads the three recordings and nothing else.
    await page.locator("fieldset.speeds").first().getByRole("radio", { name: "0.3×" }).check();
    await copyShown(page, 0, 0.3);
    await page.locator("#fp-run").click();

    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Checked just now, in this browser. " +
          "3 of 3 recordings match their fingerprints, and the run's seal checks out.",
      );
    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result good");
    expect(await page.locator("#fp-count").textContent()).toBe("4 checked, 0 not matching");
    const rows = await page.locator("#fp-rows tr td:first-child").allTextContents();
    expect(rows).toEqual([
      "Run 1402 · / · voice.webm",
      "Run 1402 · /about/ · voice.webm",
      `Run 1402 · ${LONG_PATH} · voice.webm`,
      "Run 1402 · its record's seal",
    ]);

    // One byte of /about/'s recording changed in the page, as someone could change it: the check
    // that passed now names it.
    const about = voice.slugs[1] ?? "";
    await page.evaluate((slug) => {
      const sound = document.querySelector(`audio[data-slug="${slug}"]`);
      if (sound === null) throw new Error("No player.");
      const prefix = "data:audio/webm;base64,";
      const binary = atob((sound.getAttribute("src") ?? "").slice(prefix.length));
      let changed = "";
      for (let at = 0; at < binary.length; at++) {
        const code = binary.charCodeAt(at);
        changed += String.fromCharCode(at === 300 ? code ^ 1 : code);
      }
      sound.setAttribute("src", prefix + btoa(changed));
    }, about);
    await page.locator("#fp-run").click();

    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Checked just now, in this browser. " +
          "Run 1402 · /about/ · voice.webm doesn't match its fingerprint. " +
          "2 of 3 recordings match their fingerprints, and the run's seal checks out.",
      );
    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
    expect(await page.locator("#fp-count").textContent()).toBe("4 checked, 1 not matching");
  });

  it("shows a change being caught in a recording, in memory only", async () => {
    const page = await open(voice.file);
    const before = await page.locator("#fp-data").textContent();
    const sources = () =>
      page.locator("audio").evaluateAll((all) => all.map((one) => one.getAttribute("src")));
    const addresses = await sources();
    await page.locator("#fp-demo").click();

    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Demonstration, on a copy with one byte changed (the first byte of Run 1402 · / · voice.webm); " +
          "the page itself is unchanged. " +
          "Run 1402 · / · voice.webm doesn't match its fingerprint. " +
          "2 of 3 recordings match their fingerprints, and the run's seal checks out.",
      );
    expect(await page.locator("#fp-data").textContent()).toBe(before);
    expect(await sources()).toEqual(addresses);

    await page.locator("#fp-run").click();
    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toContain("3 of 3 recordings match their fingerprints");
  });

  it.each([1280, 390, 320])(
    "is axe-clean in both themes at %i px, and nothing is wider than 320",
    async (width) => {
      const page = await open(voice.file);
      const fits = { beyondTheWindow: 0, boxes: [] };

      // With a slowed copy in view in the first section, as a reader has the page: its second
      // player in the first one's place, and the words of the status line under the speeds.
      await page.locator("fieldset.speeds").first().getByRole("radio", { name: "0.3×" }).check();
      await copyShown(page, 0, 0.3);
      expect(await sections(page).first().locator(".speed-status").textContent()).toBe(
        "0.3× is ready.",
      );
      expect(await axeFindings(page, width), "dark").toEqual([]);
      expect(await overflowOf(page), "dark").toEqual(fits);
      // With the check's result showing, which is more of the page.
      await page.locator("#fp-run").click();
      await expect.poll(() => result(page), { timeout: 10_000 }).toMatch(/^Checked just now/);
      expect(await axeFindings(page, width), "dark, checked").toEqual([]);
      await page.locator("#theme-toggle").click();
      expect(await page.getAttribute("html", "data-theme")).toBe("light");
      expect(await axeFindings(page, width), "light, checked").toEqual([]);
      expect(await overflowOf(page), "light").toEqual(fits);
      await page.locator("#fp-demo").click();
      await expect.poll(() => result(page), { timeout: 10_000 }).toMatch(/^Demonstration/);
      expect(await axeFindings(page, width), "light, a change caught").toEqual([]);
      // And its list of every file checked, open, at every width. Its file cells wrap (the voice
      // page's own rule, as a recording's name holds a page's long address), so no cell is scrolled
      // out of view at 390 or 320 and axe can tell the background of each.
      await page.locator("#fp-list > summary").click();
      // Its file cells wrap, so a page's long address never holds the table wide: it was about 460
      // px beyond its box at 390, and 530 at 320, before they did. It fits from 390 up; at 320 the
      // fingerprint column, which doesn't wrap, can need a little of the box's scroll, which is
      // labelled and reachable by keyboard, as every wide table's is.
      const scrolled = await page
        .locator("#fp-list .scroll")
        .evaluate((box) => box.scrollWidth - box.clientWidth);
      expect(scrolled, "the list open, how far its table scrolls").toBeLessThanOrEqual(
        width >= 390 ? 1 : 64,
      );
      expect(
        await page
          .locator("#fp-list tbody td:first-child")
          .evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).overflowWrap)),
        "the list open, its file cells",
      ).toEqual(Array.from({ length: 4 }, () => "anywhere"));
      expect(await axeFindings(page, width), "light, the list open").toEqual([]);
      expect(await overflowOf(page), "light, the list open").toEqual(fits);
      await page.locator("#theme-toggle").click();
      expect(await axeFindings(page, width), "dark, the list open").toEqual([]);
      expect(await overflowOf(page), "dark, the list open").toEqual(fits);
    },
    AXE_TIMEOUT,
  );

  it("is axe-clean with no script, as a browser without scripts shows it, in both themes", async () => {
    // axe can't run in a context with JavaScript disabled (it hangs), so the page is loaded without
    // its script: the same markup, as a browser that runs none has it.
    const html = (await readFile(voice.file, "utf8")).replace(/<script>[\s\S]*?<\/script>/, "");
    expect(html).not.toContain("<script>");
    const page = await (await newContext()).newPage();
    await page.setContent(html, { waitUntil: "load" });

    expect(await axeFindings(page, 1280), "dark").toEqual([]);
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    expect(await axeFindings(page, 320), "light, 320 px").toEqual([]);
  });

  // The status line as it's drawn once it has words. Its margin only applies if its rule is as
  // specific as the cards' own rule for every paragraph in them (which sets each margin to 0), and
  // a line of words only fits the height it keeps while it's empty if its line is no taller than
  // that: otherwise the card grows by a few pixels when the script writes in it.
  it("gives its status line its margin, and a line of words doesn't make its group grow", async () => {
    const page = await open(voice.file);
    const group = page.locator("fieldset.speeds").first();
    const status = sections(page).first().locator(".speed-status");
    const heightOf = async (box: Locator) => (await box.boundingBox())?.height ?? Number.NaN;

    expect(await status.textContent()).toBe("");
    const empty = { group: await heightOf(group), status: await heightOf(status) };
    await group.getByRole("radio", { name: "0.3×" }).check();
    await copyShown(page, 0, 0.3);
    expect(await status.textContent()).toBe("0.3× is ready.");

    expect(await status.evaluate((line) => getComputedStyle(line).marginTop)).toBe("4px");
    expect(await heightOf(status)).toBeCloseTo(empty.status, 0);
    expect(await heightOf(group)).toBeCloseTo(empty.group, 0);
  });

  it("works by keyboard alone", async () => {
    const page = await open(voice.file);
    const rate = async () => (await players(page))[0]?.rate;

    // The skip link comes first, then the page's button for the theme, then voicecap's link in the
    // top, and then the first player, whose controls take a few presses of Tab.
    await tabTo(page, "a.skip", 1);
    await tabTo(page, "#theme-toggle", 1);
    await tabTo(page, "audio", 3);
    // The first player's speed choice: Tab reaches it, past the player's own controls, and the
    // arrow keys choose the next speed or the one before, as they do in any group of radios.
    await tabTo(page, 'input[name^="speed-"]', 10);
    expect(await rate()).toBe(1);
    expect(
      await page.evaluate(() => {
        const focused = document.activeElement;
        if (focused === null) return false;
        const style = getComputedStyle(focused);
        return (
          focused.matches(":focus-visible") &&
          style.outlineStyle !== "none" &&
          parseFloat(style.outlineWidth) >= 2
        );
      }),
    ).toBe(true);
    // Each choice makes a copy, and the section shows it (the last is one it made before).
    for (const [key, speed] of [
      ["ArrowDown", 0.75],
      ["ArrowRight", 0.5],
      ["ArrowDown", 0.3],
      ["ArrowUp", 0.5],
    ] as const) {
      await page.keyboard.press(key);
      await copyShown(page, 0, speed);
    }
    // The focus stays on the speed choice while the copies come in and take the first player's place.
    expect(
      await page.evaluate(() => document.activeElement?.matches('input[name^="speed-"]') ?? false),
    ).toBe(true);
    // The first player is out of the page's order, as it's hidden: the player before the group is
    // the copy's, and from the group Tab goes on to the next section's controls and never to a
    // hidden player, as far as the check.
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(() => document.activeElement?.matches("audio:not([data-file])")),
    ).toBe(true);
    await tabTo(page, 'input[name^="speed-"]', 10);
    const stops: { id: string; audio: boolean; slug: string | null; visible: boolean }[] = [];
    for (let presses = 0; presses < 60 && stops.at(-1)?.id !== "fp-run"; presses++) {
      await page.keyboard.press("Tab");
      stops.push(
        await page.evaluate(() => {
          const focused = document.activeElement;
          return {
            id: focused?.id ?? "",
            audio: focused?.matches("audio") ?? false,
            slug: focused?.getAttribute("data-slug") ?? null,
            visible: focused instanceof HTMLElement && focused.offsetParent !== null,
          };
        }),
      );
    }
    expect(stops.at(-1)?.id).toBe("fp-run");
    expect(stops.find((stop) => stop.audio)?.slug).toBe(voice.slugs[1]);
    expect(stops.filter((stop) => stop.audio).every((stop) => stop.visible)).toBe(true);
    // Past every player, at the check: Enter runs it, and Space on its other button shows a change
    // being caught.
    await page.keyboard.press("Enter");
    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toMatch(/^Checked just now.*3 of 3 recordings/);
    await tabTo(page, "#fp-demo", 3);
    await page.keyboard.press("Space");
    await expect.poll(() => result(page), { timeout: 10_000 }).toMatch(/^Demonstration/);
    // The list of every file checked opens with Enter on its line.
    const opened = () =>
      page.locator("#fp-list").evaluate((fold) => (fold as HTMLDetailsElement).open);
    await tabTo(page, "#fp-list > summary", 3);
    expect(await opened()).toBe(false);
    await page.keyboard.press("Enter");
    expect(await opened()).toBe(true);
    // The theme's button, as a keyboard reaches it.
    await page.locator("#theme-toggle").focus();
    await page.keyboard.press("Enter");
    expect(await page.getAttribute("html", "data-theme")).toBe("light");
    // Nothing has played.
    expect((await players(page)).every((player) => player.paused && player.at === 0)).toBe(true);
    expect(
      await page
        .locator("audio:not([data-file])")
        .evaluateAll((all) => all.map((sound) => (sound as HTMLAudioElement).paused)),
    ).toEqual([true]);
  });

  it("plays with scripts off: the players still work, and only the speed choice and the check need the script", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(addressOf(voice.file));

    // Each player is there, with its controls, from its own address, and has a box to play in.
    const sounds = page.locator("audio");
    expect(await sounds.count()).toBe(3);
    for (const sound of await sounds.all()) {
      expect(await sound.isVisible()).toBe(true);
      expect(await sound.getAttribute("controls")).not.toBeNull();
      expect(await sound.getAttribute("src")).toMatch(/^data:audio\/webm;base64,[A-Za-z0-9+/]+=*$/);
      expect((await sound.boundingBox())?.width).toBeGreaterThan(150);
    }
    // What needs the script isn't offered, so no control is a dead one: no speeds, no theme or check
    // button; the line that says how to check without scripts is shown instead.
    for (const group of await page.locator("fieldset.speeds").all()) {
      expect(await group.isVisible()).toBe(false);
    }
    for (const selector of ["#theme-toggle", "#fp-run", "#fp-demo", "#fp-list"]) {
      expect(await page.locator(selector).isVisible(), selector).toBe(false);
    }
    expect(await page.locator(".fp-noscript").isVisible()).toBe(true);
    // The rest of the page is there to read: each page's section, and why a page has no player.
    expect(await page.locator("article.card").count()).toBe(5);
    expect(await page.locator("p.not-recorded").count()).toBe(2);
  });

  it("loads nothing from outside the file", async () => {
    const context = await newContext();
    const requested: string[] = [];
    await context.route("**/*", (route) => {
      const url = route.request().url();
      requested.push(url);
      return url.startsWith("file:") ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    await page.goto(addressOf(voice.file));
    await page.waitForLoadState("networkidle");
    // A slowed copy is made in the page and played from its own address: that loads nothing either.
    await page.locator("fieldset.speeds").first().getByRole("radio", { name: "0.3×" }).check();
    await copyShown(page, 0, 0.3);
    await page.waitForLoadState("networkidle");
    await page.locator("#fp-run").click();
    await expect.poll(() => result(page), { timeout: 10_000 }).toMatch(/^Checked just now/);

    expect(
      requested.map((url) => (url.startsWith("file:") ? path.resolve(fileURLToPath(url)) : url)),
    ).toEqual([path.resolve(voice.file)]);
  });
});
