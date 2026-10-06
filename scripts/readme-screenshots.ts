/**
 * Makes the README's screenshots of what voicecap makes, from its demo site: the shareable page of
 * the demo runs of 29 September 2026 (what NVDA said on voicecap's demo site, as voicecap recorded
 * it), and the website, built from that report shared on 30 September. No screen reader, no run, and
 * no Word: `voicecap share` makes the pages from the recorded runs, and Chromium draws them.
 *
 *   pnpm readme:screenshots [folder]     # writes the screenshots into [folder], by default
 *                                        # assets/screenshots, and prints each file's path
 *
 * It writes six files, drawn in a 1200 × 900 window at twice its size:
 *
 *   report-top.png           the page's masthead, and its summary down to the end of its panels
 *   report-heard.png         "Heard on …": a sample of what NVDA said on the site's home page
 *   report-flags.png         "What needs attention", with each fold open
 *   report-fingerprints.png  the fingerprint check, after it has run
 *   website-dark.png         the website's bar, through the demo's report, dark
 *   website-light.png        the same, light
 *
 * The demo is named by its canonical address, voicecap.netlify.app/demo-site/, as a shared copy of it
 * is, and no shot may show an IP address or `localhost`: before each one is taken, the text inside
 * the part of the page it will draw is read, and a shot that would show one stops the script.
 * Nothing is written until every shot is taken, so a refusal leaves the folder as it was.
 * Everything is made in a temporary folder, which is taken away at the end, and nothing here reads
 * or writes a person's own transcripts home.
 *
 * It draws with Playwright's Chromium (`pnpm exec playwright install chromium`, once). Run it again
 * when the page's or the site's design changes, and commit what it writes. The README links to each
 * file on GitHub, so npm's copy of the README shows them too. The four of the report come out the
 * same every time. The two of the website don't: each run makes the Word copy again, whose bytes
 * differ (it records when it was made), and the website shows its fingerprint.
 */
import { copyFile, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type Browser, type Page } from "playwright";

import { resolveConfig, type LoadedConfig } from "../src/config/load.js";
import { DEMO_CANONICAL } from "../src/demo/server.js";
import { DEMO_OUT } from "../src/demo/words.js";
import { shareReport } from "../src/share/share.js";
import { buildSite } from "../src/site/build.js";
import { hashJson } from "../src/util/hash.js";
import { silentLogger } from "../src/util/log.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Where the screenshots go when no folder is given. */
export const SCREENSHOTS_DIR = path.join(ROOT, "assets", "screenshots");
/** The demo runs of 29 September 2026, which the tests share too. */
const FIXTURE_HOME = path.join(ROOT, "test", "fixtures", "share", "demo-2026-09-29");
const FIXTURE_FOLDER = "127.0.0.1_4848";
/** The address the fixture's runs read: a copy of the demo on the computer that ran them. */
const DEMO_READ = "http://127.0.0.1:4848";
/** The day the report is shared, the day after the runs. A local time, so it's that day anywhere. */
const SHARED_ON = new Date(2026, 8, 30, 9, 0);
/** Who shared it: a stand-in, since the demo is no one's own review. */
const SHARED_BY = "Demo Reviewer";

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

/** The six files this writes, in the order it takes them. */
export const SCREENSHOTS = [
  "report-top.png",
  "report-heard.png",
  "report-flags.png",
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
 * The settings of a share of the demo: the report names its site by `canonical`, since the runs
 * themselves (made by voicecap 0.4.1) recorded no root. A config of its own, so no file in the
 * folder this runs from, and no person's config, is read.
 */
function demoConfig(canonical: string | null): LoadedConfig {
  const config = resolveConfig({ report: { canonical } });
  return { config, file: null, sha256: hashJson(config) };
}

/**
 * A transcripts home with the demo's report shared twice, as a person would share it: in the site's
 * own folder (the sites, and every report by date), and in voicecap-demo/ (the site's demo). Both
 * are named by `canonical`, the demo's canonical address unless it's null: then the only name the
 * demo has is the address the runs read, an IP address, and voicecap refuses to share it. Returns
 * the home and the shared page's path.
 */
export async function demoHome(
  root: string,
  canonical: string | null = DEMO_CANONICAL,
): Promise<{ home: string; page: string }> {
  const home = path.join(root, "transcripts");
  await cp(FIXTURE_HOME, home, { recursive: true });
  const demo = path.join(home, DEMO_OUT);
  await cp(path.join(FIXTURE_HOME, FIXTURE_FOLDER), path.join(demo, FIXTURE_FOLDER), {
    recursive: true,
  });
  const config = demoConfig(canonical);
  const share = (out: string) =>
    shareReport({
      out,
      site: DEMO_READ,
      reviewer: SHARED_BY,
      now: SHARED_ON,
      config,
      logger: silentLogger,
      // The folder the home is in has no config, and no environment is read.
      cwd: root,
      env: {},
    });
  const shared = await share(home);
  await share(demo);
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
 * next), at the README's size, with every font it declares loaded.
 */
async function open(browser: Browser, file: string): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(async () => {
    await Promise.all([...document.fonts].map((face) => face.load()));
    await document.fonts.ready;
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

/** `selector`'s element, with `margin` of the page around it. */
async function around(page: Page, selector: string, margin: number): Promise<Region> {
  const { left, top, right, bottom } = await boxOf(page, selector);
  const x = Math.max(0, Math.floor(left - margin));
  const y = Math.max(0, Math.floor(top - margin));
  return { x, y, width: Math.ceil(right + margin) - x, height: Math.ceil(bottom + margin) - y };
}

/** The edges of `selector`'s element, in CSS pixels from the page's top left corner. */
async function boxOf(
  page: Page,
  selector: string,
): Promise<Record<"left" | "top" | "right" | "bottom", number>> {
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

/** The report's four shots, from the shared page at `file`. */
async function shootReport(browser: Browser, file: string, shoot: Shoot): Promise<void> {
  const page = await open(browser, file);
  try {
    // The masthead, the six numbers, and the four panels. The three bars under them are left out.
    await shoot(
      page,
      "report-top.png",
      await fromTop(page, "section.glance .panels", SLICE_MARGIN),
    );
    await shoot(page, "report-heard.png", await around(page, "div.heard", PANEL_MARGIN));

    const attention = "section:has(> #need-h)";
    await openFolds(page, attention, true);
    await shoot(page, "report-flags.png", await around(page, attention, SLICE_MARGIN));

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

/** The website's two shots, from its index at `file`: its bar through the demo's report, twice. */
async function shootWebsite(browser: Browser, file: string, shoot: Shoot): Promise<void> {
  const page = await open(browser, file);
  try {
    // The site is dark until a reader picks light, and picking it keeps it, so dark comes first.
    await shoot(page, "website-dark.png", await fromTop(page, "#demo", SLICE_MARGIN));
    await page.locator("#theme-toggle").click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await shoot(page, "website-light.png", await fromTop(page, "#demo", SLICE_MARGIN));
  } finally {
    await page.context().close();
  }
}

/**
 * Make the six screenshots in `out` (made when it isn't there), and give each one's path. They are
 * taken in a temporary folder first and copied to `out` once all six are, so a shot that is refused
 * leaves `out` as it was. `canonical` is what the demo is named by (see demoHome): a test gives
 * none, which voicecap refuses to share, so that nothing is written.
 */
export async function makeScreenshots(
  out: string,
  canonical: string | null = DEMO_CANONICAL,
): Promise<string[]> {
  const root = await mkdtemp(path.join(os.tmpdir(), "voicecap-readme-"));
  try {
    const { home, page: sharedPage } = await demoHome(root, canonical);
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
