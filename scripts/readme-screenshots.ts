/**
 * Makes the README's screenshots of what voicecap makes, from the i2i v3 run of 6 October 2026: the
 * new version of i2i.illinois.gov, not yet live, as NVDA read its 32 pages that day (voicecap
 * 0.11.0, with each page's screenshot and the run's event log). The run is kept in
 * fixture/i2i-v3-run/, named by its canonical address, v3--i2i.netlify.app. The screenshots are of
 * the i2i v3 report, the shareable page, and of the website built from the report shared. No screen
 * reader, no run, and no Word: `voicecap share` makes the pages from the recorded run, and Chromium
 * draws them.
 *
 *   pnpm readme:screenshots [folder]     # writes the screenshots into [folder], by default
 *                                        # assets/screenshots, and prints each file's path
 *
 * It writes eight files, drawn in a 1200 × 900 window at twice its size:
 *
 *   report-top.png           the page's masthead, and At a glance down to its links: the verdict, the
 *                            ring of the pages, and the four big numbers
 *   report-heard.png         "Heard on …": a sample of what NVDA said on the site's home page,
 *                            in its fold, in the details, opened
 *   report-attention.png     "What needs attention", with its card open and its pages shut behind their fold
 *   report-pages.png         "Every page": a row of its cards (two, in this window), each with its
 *                            page's screenshot, what NVDA said first on it ("Heard first"), and its
 *                            full transcript, in its fold, shut: the first row with no card for a
 *                            page at an address in AVOIDED, which keeps out a /biographies/ page's
 *                            photo and name, and a /contact/ page's test-mode notice
 *   report-timeline.png      the run's evidence, with its minute-by-minute timeline open
 *   report-fingerprints.png  the fingerprint check, after it has run
 *   website-dark.png         the website's bar, through the site under "The sites": its current
 *                            report, its two earlier ones, and its fold of files, closed, dark
 *   website-light.png        the same, light
 *
 * No shot may show an IP address or `localhost`: before each one is taken, the text inside the part
 * of the page it will draw is read, and a shot that would show one stops the script. Nothing is
 * written until every shot is taken, so a refusal leaves the folder as it was. Everything is made in
 * a temporary folder, which is taken away at the end, and nothing here reads or writes a person's
 * own transcripts home: the run is copied from the repository, and the copy is what is shared.
 *
 * It draws with Playwright's Chromium (`pnpm exec playwright install chromium`, once). Run it again
 * when the page's or the site's design changes, and commit what it writes. The README links to each
 * file on GitHub, so npm's copy of the README shows them too. All eight come out the same every
 * time. Each run makes the Word copies again, whose bytes differ (each records when it was made),
 * but the website shows their fingerprints only in its fold of files, which is closed in its shots.
 */
import { copyFile, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type Browser, type Page } from "playwright";

import { resolveConfig, type LoadedConfig } from "../src/config/load.js";
import { shareReport } from "../src/share/share.js";
import { buildSite } from "../src/site/build.js";
import { hashJson } from "../src/util/hash.js";
import { silentLogger } from "../src/util/log.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Where the screenshots go when no folder is given. */
export const SCREENSHOTS_DIR = path.join(ROOT, "assets", "screenshots");
/**
 * The i2i v3 run of 6 October 2026, as a transcripts home with the one site's folder in it
 * (v3--i2i.netlify.app: its latest.txt, and the run's folder, 2026-10-06/1134). The run recorded the
 * site's canonical address, which is the address it read, so the report names the site by it.
 */
export const SOURCE_HOME = path.join(ROOT, "fixture", "i2i-v3-run");
/**
 * When the pictures show the report as shared: 6 October 2026 at 15:00, a local time, so it's that
 * day anywhere, after the run ended (at 12:32). It's fixed, so the pictures come out the same each
 * time. It isn't when anyone really shared the report. It's the last of the script's three shares
 * (see SHARED_BEFORE), so the shared page is the third of the day, named "-3": no picture of the
 * report shows its name.
 */
const SHARED_ON = new Date(2026, 9, 6, 15, 0);
/**
 * The two shares before it, at 13:00 and 14:00 that day, so that the website shows what a site that
 * has been shared a few times shows: its current report, and two earlier ones, a line each. They're
 * fixed too, and aren't when anyone really shared the report.
 */
const SHARED_BEFORE = [new Date(2026, 9, 6, 13, 0), new Date(2026, 9, 6, 14, 0)];
/** Who shares it: the person who ran the review, as the run's record names them. */
const SHARED_BY = "Christopher Schweda";

/** A browser window as wide as a laptop's, drawn at twice its size, so the text is sharp. */
const VIEWPORT = { width: 1200, height: 900 };
const SCALE = 2;
/**
 * The page's own background around a shot, in CSS pixels: a slice of the page has some below it,
 * and a panel or a section some on every side, so no border or letter touches the edge of the
 * picture. Less than the gap to whatever is next to each, so nothing of that is drawn.
 */
const SLICE_MARGIN = 16;
const PANEL_MARGIN = 8;
/**
 * What the address of a page has in it that keeps its card out of the shot of page cards. The shot
 * leaves out every row that has a card for a page at one of these addresses, and nothing else: a
 * page at another address that shows the same would still be drawn. So when the fixture changes,
 * look at that shot.
 *
 * - `/biographies/`: each page of the i2i team's biographies shows a person's photo and name.
 * - `/contact/`: its screenshot carries the branch deploy's test-mode notice, a red "SITE BUILD
 *   NOTICE" that names the mailer's test inbox and a checklist in the site's docs, which a public
 *   README shouldn't lead its cards with.
 */
export const AVOIDED = ["/biographies/", "/contact/"] as const;

/** The eight files this writes, in the order it takes them. */
export const SCREENSHOTS = [
  "report-top.png",
  "report-heard.png",
  "report-attention.png",
  "report-pages.png",
  "report-timeline.png",
  "report-fingerprints.png",
  "website-dark.png",
  "website-light.png",
] as const;

/**
 * What no screenshot may show: `localhost`, and an IP address, whether written as four numbers
 * (each up to 255, so a browser's version, `153.0.8010.53`, is none) or as an IPv6 address in
 * brackets (which has two colons at least, as a time in brackets doesn't).
 */
const LOCAL_ADDRESS =
  /localhost|\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b|\[[0-9a-f]*:[0-9a-f]*:[0-9a-f:.]*\]/i;

/**
 * Stop, with an error that names it, when `text` holds an IP address or `localhost`. `shot` is the
 * file that would show `text`.
 */
export function refuseLocalAddress(shot: string, text: string): void {
  const found = LOCAL_ADDRESS.exec(text);
  if (found !== null) {
    throw new Error(
      `${shot} would show "${found[0]}", an IP address or a local address. Nothing is written.`,
    );
  }
}

/**
 * The settings of a share of the run: the defaults. The run recorded the site's canonical address,
 * so the report needs no `report.canonical`. A config of its own, so no file in the folder this runs
 * from, and no person's config, is read.
 */
function shareConfig(): LoadedConfig {
  const config = resolveConfig({});
  return { config, file: null, sha256: hashJson(config) };
}

/**
 * A transcripts home with the report of the run in `source` shared in it, as a person would share
 * it: a copy of `source` (a home with one site's folder, which isn't changed), and three shares made
 * in the copy's site folder, at SHARED_BEFORE's times and then at SHARED_ON. A site whose run
 * recorded no canonical address and was read at an IP address isn't shared: voicecap refuses it.
 * Returns the home and the path of the last share's page, which the shots of the report are of.
 */
export async function sharedHome(
  root: string,
  source: string = SOURCE_HOME,
): Promise<{ home: string; page: string }> {
  const home = path.join(root, "transcripts");
  await cp(source, home, { recursive: true });
  const share = (now: Date) =>
    shareReport({
      out: home,
      reviewer: SHARED_BY,
      now,
      config: shareConfig(),
      logger: silentLogger,
      // The folder the home is in has no config, and no environment is read.
      cwd: root,
      env: {},
    });
  for (const now of SHARED_BEFORE) await share(now);
  const shared = await share(SHARED_ON);
  const page = shared.files.find((file) => file.name.endsWith(".html"));
  if (page === undefined) throw new Error("voicecap share wrote no page.");
  return { home, page: page.path };
}

/** A part of the page, in CSS pixels from the page's top left corner (not the window's). */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A page, open from its file in a window of its own (so the theme one page keeps never reaches the
 * next), at the README's size, with every font it declares loaded, and every picture: a page's
 * screenshots wait to load until they're near the window, and a shot of a part far down the page
 * would be taken before they had.
 */
async function open(browser: Browser, file: string): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(async () => {
    await Promise.all([...document.fonts].map((face) => face.load()));
    await document.fonts.ready;
    const pictures = [...document.images];
    for (const picture of pictures) picture.loading = "eager";
    await Promise.all(pictures.map((picture) => picture.decode()));
  });
  return page;
}

/**
 * Open the folds that `selector`'s element is in, and, with `inside`, the folds inside it too. A
 * fold opens with a click, but a script sets the attribute, which is what a click does.
 */
async function openFolds(page: Page, selector: string, inside: boolean): Promise<void> {
  await page.evaluate(
    ({ target, within }) => {
      const element = document.querySelector(target);
      if (element === null) throw new Error(`${target} isn't on the page.`);
      let fold = element.closest("details");
      while (fold !== null) {
        fold.open = true;
        fold = fold.parentElement?.closest("details") ?? null;
      }
      if (within) for (const each of element.querySelectorAll("details")) each.open = true;
    },
    { target: selector, within: inside },
  );
}

/** The page's width and the bottom edge of `selector`'s element: the top of the page to there. */
async function fromTop(page: Page, selector: string, margin: number): Promise<Region> {
  const { bottom } = await boxOf(page, selector);
  return { x: 0, y: 0, width: VIEWPORT.width, height: Math.ceil(bottom + margin) };
}

/** The edges of a part of the page, in CSS pixels from the page's top left corner. */
type Box = Record<"left" | "top" | "right" | "bottom", number>;

/** `box`, with `margin` of the page around it. */
function withMargin(box: Box, margin: number): Region {
  const x = Math.max(0, Math.floor(box.left - margin));
  const y = Math.max(0, Math.floor(box.top - margin));
  return {
    x,
    y,
    width: Math.ceil(box.right + margin) - x,
    height: Math.ceil(box.bottom + margin) - y,
  };
}

/** `selector`'s element, with `margin` of the page around it. */
async function around(page: Page, selector: string, margin: number): Promise<Region> {
  return withMargin(await boxOf(page, selector), margin);
}

/**
 * `selector`'s element from its top down to the bottom edge of `last`'s, with `margin` of the page
 * around it: a part of an element, from its start to where one of its own parts ends.
 */
async function downTo(page: Page, selector: string, last: string, margin: number): Promise<Region> {
  const box = await boxOf(page, selector);
  const { bottom } = await boxOf(page, last);
  return withMargin({ ...box, bottom }, margin);
}

/**
 * The first row of `cards`, the elements of a grid, with no card that has any of `avoid` in its
 * text, and `margin` of the page around it. The cards that start as high as each other are a row,
 * and the row is as wide as its cards and as tall as the tallest, so none is cut off. Stops when
 * every row has a card with one of `avoid` in it. The page's shot of its cards gives AVOIDED, each
 * address kept out for a reason of its own.
 */
export async function firstRowWithout(
  page: Page,
  cards: string,
  avoid: readonly string[],
  margin: number,
): Promise<Region> {
  const row = await page.evaluate(
    ({ target, texts }) => {
      const rows: Element[][] = [];
      let top = Number.NEGATIVE_INFINITY;
      for (const card of document.querySelectorAll(target)) {
        const at = card.getBoundingClientRect().top;
        if (Math.abs(at - top) >= 2) rows.push([]);
        top = at;
        rows.at(-1)?.push(card);
      }
      const found = rows.find((each) =>
        each.every((card) => {
          const words = card.textContent ?? "";
          return !texts.some((text) => words.includes(text));
        }),
      );
      if (found === undefined) return null;
      const boxes = found.map((card) => card.getBoundingClientRect());
      return {
        left: Math.min(...boxes.map((box) => box.left)) + window.scrollX,
        top: Math.min(...boxes.map((box) => box.top)) + window.scrollY,
        right: Math.max(...boxes.map((box) => box.right)) + window.scrollX,
        bottom: Math.max(...boxes.map((box) => box.bottom)) + window.scrollY,
      };
    },
    { target: cards, texts: avoid },
  );
  if (row === null) {
    const names = avoid.map((each) => `"${each}"`).join(" or ");
    throw new Error(`Every row of ${cards} has ${names} in it.`);
  }
  return withMargin(row, margin);
}

/** The edges of `selector`'s element. */
async function boxOf(page: Page, selector: string): Promise<Box> {
  return page.evaluate((target) => {
    const element = document.querySelector(target);
    if (element === null) throw new Error(`${target} isn't on the page.`);
    const box = element.getBoundingClientRect();
    return {
      left: box.left + window.scrollX,
      top: box.top + window.scrollY,
      right: box.right + window.scrollX,
      bottom: box.bottom + window.scrollY,
    };
  }, selector);
}

/**
 * The text a reader would see in `region`: every text that is drawn, whole or in part, in it. Text
 * that isn't drawn (a script's, a closed fold's, text that is hidden or fully transparent) isn't in
 * it, though a closed fold's text has a place on the page, which is why each text's element is
 * asked whether a reader could see it.
 */
async function textIn(page: Page, region: Region): Promise<string> {
  return page.evaluate(({ x, y, width, height }) => {
    const seen: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const shown = node.parentElement?.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      });
      if (shown !== true) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const drawn = [...range.getClientRects()].some((rect) => {
        const left = rect.left + window.scrollX;
        const top = rect.top + window.scrollY;
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          left < x + width &&
          left + rect.width > x &&
          top < y + height &&
          top + rect.height > y
        );
      });
      if (drawn) seen.push(node.textContent ?? "");
    }
    return seen.join(" ");
  }, region);
}

/** Takes a shot of a region of a page, once its text has been read and found to hold no address. */
export type Shoot = (page: Page, name: string, region: Region) => Promise<void>;

/** The shots taken so far are named in `taken`, and written to `into`. */
export function shooter(into: string, taken: string[]): Shoot {
  return async (page, name, region) => {
    refuseLocalAddress(name, await textIn(page, region));
    await page.screenshot({
      path: path.join(into, name),
      fullPage: true,
      animations: "disabled",
      clip: region,
    });
    taken.push(name);
  };
}

/** The report's six shots, from the shared page at `file`. */
async function shootReport(browser: Browser, file: string, shoot: Shoot): Promise<void> {
  const page = await open(browser, file);
  try {
    // The masthead, and At a glance: its verdict, its ring, its four numbers, and its links.
    await shoot(
      page,
      "report-top.png",
      await fromTop(page, "section.glance nav.toc", SLICE_MARGIN),
    );
    // The sample of what NVDA said, in the details, in its fold: the fold is opened first.
    const heard = "details.heard-fold";
    await openFolds(page, heard, false);
    await shoot(page, "report-heard.png", await around(page, heard, PANEL_MARGIN));

    // The card, open, with its pages behind their fold: it names how many there are, and their
    // addresses are a long list. Opening the card opens none of the folds inside it.
    const attention = "section:has(> #need-h)";
    await openFolds(page, `${attention} .folds > details`, false);
    await shoot(page, "report-attention.png", await around(page, attention, SLICE_MARGIN));

    // "Every page": a row of its cards, each with its page's screenshot, the lines NVDA said first,
    // and its full transcript, in its fold, shut: the first row with no card for a /biographies/ or
    // a /contact/ page (AVOIDED). The first keeps this fixture's team photos and names out of the
    // picture, and the second the branch deploy's test-mode notice, which names the mailer's test
    // inbox. The code checks only the address, so look at the shot for photos, names, and that
    // notice when the fixture changes. The row ends before the next one starts, so no card is cut
    // off.
    await shoot(
      page,
      "report-pages.png",
      await firstRowWithout(page, "#pages .card", AVOIDED, PANEL_MARGIN),
    );

    // The run's fold, open, down to the end of its minute by minute: the run's facts, the chart,
    // and the table of every event. Opening the table opens the fold of the run it is in.
    const run = "section:has(> #ev-h) > .folds > details";
    await openFolds(page, `${run} details.log`, false);
    await shoot(
      page,
      "report-timeline.png",
      await downTo(page, run, `${run} .run-inside > div`, PANEL_MARGIN),
    );

    // The check as a reader meets it: after a click, with the result it gives. Its list of every
    // file checked stays folded, as it is when the result first shows.
    const check = "div.fp-check";
    await openFolds(page, check, false);
    await page.locator("#fp-run").click();
    const result = page.locator("#fp-result");
    await page.locator("#fp-result.good, #fp-result.bad").waitFor();
    if (!(await result.evaluate((line) => line.classList.contains("good")))) {
      throw new Error(`The fingerprint check didn't pass: ${await result.innerText()}`);
    }
    await shoot(page, "report-fingerprints.png", await around(page, check, PANEL_MARGIN));
  } finally {
    await page.context().close();
  }
}

/** The website's two shots, from its index at `file`: its bar through the site's report, twice. */
async function shootWebsite(browser: Browser, file: string, shoot: Shoot): Promise<void> {
  const page = await open(browser, file);
  try {
    // The site is dark until a reader picks light, and picking it keeps it, so dark comes first.
    // The home holds one site, v3--i2i.netlify.app, and no share of the demo, so the page's first
    // site is its only one, and "The sites" is the first view under the bar.
    await shoot(page, "website-dark.png", await fromTop(page, "section.site", SLICE_MARGIN));
    await page.locator("#theme-toggle").click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await shoot(page, "website-light.png", await fromTop(page, "section.site", SLICE_MARGIN));
  } finally {
    await page.context().close();
  }
}

/**
 * Make the eight screenshots in `out` (made when it isn't there), and give each one's path. They
 * are taken in a temporary folder first and copied to `out` once all eight are, so a shot that is
 * refused leaves `out` as it was. `source` is the transcripts home the report is shared from (see
 * sharedHome): a test gives one whose run has no canonical address, which voicecap refuses to share,
 * so that nothing is written.
 */
export async function makeScreenshots(
  out: string,
  source: string = SOURCE_HOME,
): Promise<string[]> {
  const root = await mkdtemp(path.join(os.tmpdir(), "voicecap-readme-"));
  try {
    const { home, page: sharedPage } = await sharedHome(root, source);
    const site = await buildSite({
      home,
      out: path.join(root, "_site"),
      cwd: root,
      env: {},
      logger: silentLogger,
    });
    if (site.leftOut.length > 0) {
      throw new Error(
        `The website left out something, so it isn't shown:\n${site.leftOut.join("\n")}`,
      );
    }

    const shots = path.join(root, "shots");
    await mkdir(shots);
    const taken: string[] = [];
    const shoot = shooter(shots, taken);
    const browser = await chromium.launch();
    try {
      await shootReport(browser, sharedPage, shoot);
      await shootWebsite(browser, path.join(site.out, "index.html"), shoot);
    } finally {
      await browser.close();
    }
    if (taken.join() !== SCREENSHOTS.join()) {
      throw new Error(`Expected ${SCREENSHOTS.join(", ")}, took ${taken.join(", ")}.`);
    }

    await mkdir(out, { recursive: true });
    for (const name of SCREENSHOTS) await copyFile(path.join(shots, name), path.join(out, name));
    return SCREENSHOTS.map((name) => path.join(out, name));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const out = path.resolve(process.argv[2] ?? SCREENSHOTS_DIR);
  for (const file of await makeScreenshots(out)) console.log(file);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
