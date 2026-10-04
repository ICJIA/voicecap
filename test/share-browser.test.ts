/**
 * The shareable page as a reader gets it: written to a folder by writeShareFiles from a site's
 * records, then opened from a file in headless Chromium. It's checked for accessibility (axe, in
 * both themes, with its folds closed and open), for loading nothing from outside the file, for what
 * its scripts do with its folds, and for its fingerprint check, run on the page's own data.
 *
 * Five sites make the pages: the demo runs of 29 September 2026 (copied, so the page goes in the
 * copy), where each run failed a page the other read, as Review Focus 5 describes; a site made by
 * voicecap's own commands, with reviews, a manual session, a page that sounds different, and a
 * page that failed; a site whose transcripts hold markup and a closing script tag; a site whose
 * host is one long word, with no name set and no title on its home page; and a site whose only run
 * was a replay, as in CI's smoke test.
 */
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { addManualSession } from "../src/manual-add.js";
import { addReview } from "../src/reviews/review.js";
import { runAudit } from "../src/run/audit.js";
import { runDir, sharePath } from "../src/run/paths.js";
import { walkthroughJson, walkthroughOf } from "../src/share/walkthrough.js";
import { writeShareFiles } from "../src/share/write.js";
import { createMemoryLogger } from "../src/util/log.js";
import { identicalLinks, launchBrowser, violations } from "./helpers/axe.js";
import { config, options, outDir, setup, SITE, sitePages } from "./helpers/run-site.js";
import { element, ScriptedDriver } from "./helpers/scripted-driver.js";
import { demoRun } from "./helpers/share-fixture.js";
import { DEMO_SITE } from "./helpers/share-model.js";

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
 * time.
 */
async function richPage(): Promise<string> {
  const dir = await setup(["/", "/about", LONG_PATH]);
  folders.push(dir);
  const logger = createMemoryLogger();
  const titled = { title: "Example Agency" };
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
    new ScriptedDriver(sitePages({ home: titled, resources: long })),
    new Date(2026, 8, 26, 14, 5),
    1,
  );
  await run(
    new ScriptedDriver(
      sitePages({
        home: titled,
        about: {
          lines: ["heading, level 1, About us", "We have a new address.", "© 2026 Example Agency"],
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
let pages: { demo: string; rich: string; hostile: string; longHost: string; replay: string };
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
  const replay = await replayPage();
  pages = { demo, rich, hostile: hostile.file, longHost, replay: replay.file };
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

/** The folds that are open, in page order. */
const openFolds = (states: Record<string, boolean>): string[] =>
  Object.entries(states)
    .filter(([, open]) => open)
    .map(([id]) => id);

/** Whether what `selector` finds is inside the window, from its top to its bottom. */
const inView = (page: Page, selector: string): Promise<boolean> =>
  page.evaluate((selected) => {
    const box = document.querySelector(selected)?.getBoundingClientRect();
    return box !== undefined && box.top >= 0 && box.bottom <= window.innerHeight;
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

describe("axe, in Chromium", () => {
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
      for (const which of ["rich", "longHost"] as const) {
        const page = await open(pages[which]);
        expect(await axeFindings(page, width), `${which}, dark, folds closed`).toEqual([]);
        await page.locator("#open-all").click();
        await page.locator("#theme-toggle").click();
        expect(await axeFindings(page, width), `${which}, light, folds open`).toEqual([]);
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
      for (const which of ["demo", "rich", "longHost"] as const) {
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
    ["a fold's line", "main summary"],
    ["a term", "main dt"],
    ["what a term means", "main dd"],
    ["a caption", "main figcaption"],
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

    // What voicecap is, when the page was made, and the file's name with its Word copy's.
    expect(lines).toHaveLength(3);
    for (const { width, eighty } of lines) expect(width).toBeLessThanOrEqual(eighty + 1);
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

describe("Open every section, and printing", () => {
  it("opens every fold, and a second press puts each back as it was, a hand-opened one too", async () => {
    const page = await open(pages.demo);
    const button = page.locator("#open-all");
    const asWritten = await foldStates(page);
    // The page starts with the flags' fold open, and every other fold closed.
    expect(openFolds(asWritten)).toHaveLength(1);
    // The reader opens another by hand.
    await page.locator("#tx-home > summary").click();
    const byHand = await foldStates(page);
    expect(openFolds(byHand)).toEqual([...openFolds(asWritten), "tx-home"]);

    expect(await button.textContent()).toBe("Open every section");
    await button.click();
    expect(openFolds(await foldStates(page))).toEqual(Object.keys(byHand));
    expect(await button.textContent()).toBe("Fold the details again");

    await button.click();
    expect(await foldStates(page)).toEqual(byHand);
    expect(await button.textContent()).toBe("Open every section");

    // It goes back and forth as often as it's pressed.
    await button.click();
    expect(openFolds(await foldStates(page))).toEqual(Object.keys(byHand));
    await button.click();
    expect(await foldStates(page)).toEqual(byHand);
  });

  it("opens every fold for printing, and puts each back as it was afterwards", async () => {
    const page = await open(pages.demo);
    await page.locator("#tx-home > summary").click();
    const before = await foldStates(page);
    expect(openFolds(before)).toHaveLength(2);

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
  it("opens the fold a link points into, and brings it into view", async () => {
    const page = await open(pages.demo);
    const fold = `tx-${HOW}`;
    const before = await foldStates(page);
    expect(before[fold]).toBe(false);

    // A link to something in plain view opens nothing.
    await page.locator('a[href="#prob-h"]').first().click();
    expect(await foldStates(page)).toEqual(before);

    // The page card's "Transcripts and fingerprints" opens its transcripts.
    await page.locator(`a[href="#${fold}"]`).click();
    expect(await foldStates(page)).toEqual({ ...before, [fold]: true });
    await expect.poll(() => inView(page, `#${fold} > summary`), { timeout: 10_000 }).toBe(true);

    // An address pointing there, as one the browser has just followed: the fold is shut again,
    // the page is scrolled away, and the page finds its way back.
    await page.locator(`#${fold} > summary`).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await inView(page, `#${fold} > summary`)).toBe(false);
    await page.evaluate((id) => {
      history.replaceState(null, "", `#${id}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }, fold);
    expect((await foldStates(page))[fold]).toBe(true);
    expect(await inView(page, `#${fold} > summary`)).toBe(true);
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

  it("leaves the folds alone for an address that points to nothing, or to what's in view", async () => {
    const asWritten = await foldStates(await open(pages.demo));

    for (const hash of ["#no-such-part", "#prob-h", "#", "#%E0%A4%A"]) {
      const page = await open(pages.demo, hash);
      expect(await foldStates(page), hash).toEqual(asWritten);
    }
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

  it("names a transcript whose text the appendix shows was changed", async () => {
    const page = await open(pages.demo);
    // Someone changes what the page shows of the home page's read transcript, and nothing else: the
    // data and the records still match.
    await page.evaluate(() => {
      const shown = document.querySelector("#tx-home pre");
      if (shown === null) throw new Error("The appendix shows no transcript of the home page.");
      shown.textContent = `${shown.textContent ?? ""}\nA line no one heard.`;
    });
    await page.locator("#fp-run").click();

    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Checked just now, in this browser. " +
          "Run 1402 · / · read.txt: the text shown doesn't match its file. " +
          "20 of 21 transcripts match their fingerprints, and both runs' seals check out.",
      );
    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
    const rows = await page.locator("#fp-rows tr").allTextContents();
    expect(rows.filter((row) => row.includes("doesn’t match"))).toEqual([
      expect.stringContaining("Run 1402 · / · read.txt"),
    ]);
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
    // The appendix shows each line as text, markup and all.
    const read = await page.locator('#tx-home [aria-label^="Read transcript"] pre').textContent();
    for (const line of HOSTILE_LINES) expect(read).toContain(line);
    expect(await page.locator("#tx-home pre b").count()).toBe(0);
    // The site's name, from a title with markup in it, is text too.
    expect(await page.title()).toBe(
      "Grants </title></script><b>Agency</b>: how its pages read aloud with NVDA",
    );
    expect(await page.locator("h1").textContent()).toBe("Grants </title></script><b>Agency</b>");
    expect(await page.locator("h1 b").count()).toBe(0);

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
