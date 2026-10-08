/**
 * The website's page as a reader gets it: written to a file by renderSiteIndex, with the fonts
 * embedded, and opened from there in headless Chromium. It's checked for accessibility (axe, in both
 * themes, and at a phone's width, with the folds of files open; and the landmarks in Chromium's own
 * accessibility tree), for fitting a window 320 pixels wide, for what the bar does (it stays in view
 * where it fits, at the reader's text size, and never hides what has focus or what a link points
 * to), for the bar the trust page has (its own link told apart from the others by more than color,
 * and its links to the views going to this page), for the theme button, and for being complete
 * without JavaScript, its folds too.
 *
 * The trust page (renderTrustPage) is checked the same ways, with its facts and with none: axe in
 * both themes at 1280, 390, and 320 pixels, its fit at 320, its landmarks, what has focus never
 * under the bar, its fold, and its bar's link to it, the page the reader is on.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { fontFaceCss } from "../src/share/fonts.js";
import { recordFactsOf } from "../src/site/facts.js";
import { siteBar, sitePage } from "../src/site/frame.js";
import { type PublishedReport, renderSiteIndex, type SiteContent } from "../src/site/render.js";
import { renderTrustPage } from "../src/site/trust.js";
import { identicalLinks, launchBrowser, violations } from "./helpers/axe.js";
import { footerInTwoWindows } from "./helpers/footer.js";
import { CONTENT, DEMO_REPORT, filesOf, published, reportsOf } from "./helpers/site-content.js";
import { EARLIER_RELEASES, FACTS, RECORDS, RESULTS_CONTENT } from "./helpers/trust-facts.js";

/** The page's background in each theme. */
const DARK = "rgb(11, 16, 21)";
const LIGHT = "rgb(255, 255, 255)";

/**
 * A site whose names are as long as a name can be: a host of 88 characters, a person's name that is
 * one word, and file names that hold both, in its current report and in an earlier one. Nothing in
 * the page may run past a window 320 pixels wide.
 */
function longContent(): SiteContent {
  const folder = "research-hub-of-the-criminal-justice-information-authority.example.illinois.gov";
  const by = "Maximilian-Alexander-Bartholomew-Wolfeschlegelsteinhausenbergerdorff-Junior";
  const run = `2026-10-03_${"1".repeat(80)}`;
  const files = (day: string) => [
    published("page", folder, `${folder}_${day}.html`, 324),
    published("word", folder, `${folder}_${day}.docx`, 51),
    published("walkthrough", folder, `${folder}_${day}_${run}_walkthrough.json`, 5, run),
  ];
  return {
    demo: null,
    sites: [
      {
        name: folder,
        folders: [folder],
        // The link to the site, beside its long name.
        address: `https://${folder}/`,
        reports: [
          {
            folder,
            id: `report-${folder}-2`,
            at: "2026-10-03T14:05:00-05:00",
            by,
            files: files("2026-10-03"),
            notPublished: [
              { name: `${folder}_2026-10-03_${"x".repeat(60)}.docx`, reason: "missing" },
            ],
          },
          {
            folder,
            id: `report-${folder}-1`,
            at: "2026-10-02T09:30:00-05:00",
            by,
            files: files("2026-10-02"),
            notPublished: [],
          },
        ],
      },
    ],
  };
}

/**
 * Three sites whose current reports say each kind of verdict: nothing needs attention, problems that
 * need attention, and pages NVDA didn't read.
 */
function verdictContent(): SiteContent {
  const results: NonNullable<PublishedReport["result"]>[] = [
    { pages: 9, read: 9, problems: 0, problemPages: 0 },
    { pages: 32, read: 32, problems: 1, problemPages: 32 },
    { pages: 9, read: 7, problems: 2, problemPages: 2 },
  ];
  return {
    demo: null,
    sites: results.map((result, index) => {
      const folder = `site-${index + 1}.example.illinois.gov`;
      const report: PublishedReport = {
        folder,
        id: `report-${folder}-1`,
        at: `2026-10-0${index + 1}T10:00:00-05:00`,
        by: "Pat Lee",
        files: [
          published("page", folder, `${folder}_2026-10-0${index + 1}.html`, 100),
          published("word", folder, `${folder}_2026-10-0${index + 1}.docx`, 40),
        ],
        notPublished: [],
        result,
      };
      return { name: folder, folders: [folder], reports: [report], address: `https://${folder}/` };
    }),
  };
}

/** A demo and 14 sites of one report each: more sites than anyone wants to meet as landmarks. */
function manyContent(): SiteContent {
  const day = (index: number): string => String(index + 1).padStart(2, "0");
  return {
    demo: DEMO_REPORT,
    sites: Array.from({ length: 14 }, (_, index) => {
      const folder = `site-${day(index)}.example.illinois.gov`;
      const report: PublishedReport = {
        folder,
        id: `report-${folder}-1`,
        at: `2026-10-${day(index)}T10:00:00-05:00`,
        by: "Pat Lee",
        files: [published("page", folder, `${folder}_2026-10-${day(index)}.html`, 100)],
        notPublished: [],
      };
      return { name: folder, folders: [folder], reports: [report] };
    }),
  };
}

let browser: Browser;
let folder: string;
/**
 * The page files: the tests' content, a site with names as long as they can be, many sites, no
 * report at all, each kind of verdict, and a page with the bar the trust page has. And the trust
 * page, with its facts and seven releases, so that two are in its fold; and with no release facts
 * and no report.
 */
let files: {
  page: string;
  long: string;
  many: string;
  empty: string;
  verdicts: string;
  trustBar: string;
  trust: string;
  trustBare: string;
};
const contexts: BrowserContext[] = [];
/** What each page opened in a test reported going wrong: errors thrown, and errors in its console. */
const reported: string[] = [];

beforeAll(async () => {
  browser = await launchBrowser();
  folder = await mkdtemp(path.join(tmpdir(), "voicecap-site-page-"));
  const fontCss = await fontFaceCss();
  const writeHtml = async (name: string, html: string): Promise<string> => {
    const file = path.join(folder, name);
    await writeFile(file, html);
    return file;
  };
  const write = (name: string, content: SiteContent): Promise<string> =>
    writeHtml(name, renderSiteIndex(content, { fontCss }));
  files = {
    page: await write("index.html", CONTENT),
    long: await write("long.html", longContent()),
    many: await write("many.html", manyContent()),
    empty: await write("empty.html", { demo: null, sites: [] }),
    verdicts: await write("verdicts.html", verdictContent()),
    // The shell and the bar of the trust page, over a main part of one heading. It sits beside
    // index.html, which the links of its bar go to.
    trustBar: await writeHtml(
      "trust-bar.html",
      sitePage(
        {
          title: "A page with the trust page's bar",
          bar: siteBar(CONTENT, "trust"),
          main: ["<h1>A page with the trust page's bar</h1>"],
        },
        { fontCss },
      ),
    ),
    // The trust page, beside index.html, as the website has it.
    trust: await writeHtml(
      "trust.html",
      renderTrustPage(
        {
          voicecap: { ...FACTS, releases: [...FACTS.releases, ...EARLIER_RELEASES] },
          records: RECORDS,
          content: RESULTS_CONTENT,
        },
        { fontCss },
      ),
    ),
    trustBare: await writeHtml(
      "trust-bare.html",
      renderTrustPage(
        {
          voicecap: { ...FACTS, release: null },
          records: recordFactsOf({ demo: null, sites: [] }),
          content: { demo: null, sites: [] },
        },
        { fontCss },
      ),
    ),
  };
});

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
  // Nothing the pages did went wrong, in any test.
  expect(reported.splice(0)).toEqual([]);
});

afterAll(async () => {
  await browser.close();
  await rm(folder, { recursive: true, force: true });
});

interface OpenOptions {
  /** The browser to open it in. Default: the one of these tests, with its own text size. */
  browser?: Browser;
  width?: number;
  height?: number;
  /** Whether the page's script runs. Default: it does. */
  scripts?: boolean;
  /** Code that runs in the page first, ahead of its own script. */
  before?: string;
}

/** A page, open from its file, with every font it declares loaded, so its layout is the final one. */
async function open(file: string, options: OpenOptions = {}): Promise<Page> {
  const context = await (options.browser ?? browser).newContext({
    javaScriptEnabled: options.scripts ?? true,
    viewport: { width: options.width ?? 1280, height: options.height ?? 800 },
  });
  contexts.push(context);
  if (options.before !== undefined) await context.addInitScript(options.before);
  const page = await context.newPage();
  page.on("pageerror", (error) => reported.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") reported.push(message.text());
  });
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(async () => {
    await Promise.all([...document.fonts].map((face) => face.load()));
  });
  return page;
}

const theme = (page: Page): Promise<string | null> => page.getAttribute("html", "data-theme");

const background = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** The stored choice of theme, which the reports keep under the same name. */
const stored = (page: Page): Promise<string | null> =>
  page.evaluate(() => window.localStorage.getItem("voicecap-theme"));

/**
 * What the Tab key reaches: the page's links, but those in a closed fold, its button once the script
 * has shown it, and each fold's summary.
 */
const STOPS = "a[href]:not(details:not([open]) > :not(summary) a), button:not([hidden]), summary";

/** Open every fold of the page, so that what's in it is drawn, and checked. */
async function openFolds(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const fold of document.querySelectorAll("details")) fold.open = true;
  });
}

/**
 * Tabs through every stop of the page, and says which of them ends up under the bar, one line each.
 * Each stop is tried twice. Before the Tab, the page is scrolled so that the stop is 10 pixels from
 * the top of the window, which is under the bar: a browser that doesn't know about the bar takes it
 * for a stop in view, and leaves it there. And so that it is 1 pixel inside the edge that
 * `scroll-padding-top` keeps clear: a stop that is already in view stays where it is, so a bar
 * taller than its padding covers it. What is at the middle of a stop, and at its top edge, is the
 * stop or is inside it. A bar that doesn't stick has no such edge, so each stop is tried once.
 */
async function stopsUnderTheBar(page: Page): Promise<string[]> {
  const count = await page.evaluate(
    (selector) => document.querySelectorAll(selector).length,
    STOPS,
  );
  const padding = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
  );
  const found: string[] = [];
  for (const offset of Number.isFinite(padding) ? [10, padding + 1] : [10]) {
    for (let stop = 0; stop < count; stop++) {
      await page.evaluate(
        ({ selector, at, offset }) => {
          const stops = document.querySelectorAll<HTMLElement>(selector);
          // The stop before has focus, without the page moving, so the Tab goes on from it. For the
          // first stop, the body has it: where a Tab starts from the top of the page, even after a
          // tour that ended at the last stop.
          const before = stops[at - 1];
          if (before !== undefined) {
            before.focus({ preventScroll: true });
          } else {
            document.body.tabIndex = -1;
            document.body.focus({ preventScroll: true });
            document.body.removeAttribute("tabindex");
          }
          const next = stops[at];
          // A stop in the bar is in view wherever the page is scrolled.
          if (next === undefined || next.closest(".bar") !== null) return;
          window.scrollTo(
            0,
            Math.max(0, next.getBoundingClientRect().top + window.scrollY - offset),
          );
        },
        { selector: STOPS, at: stop, offset },
      );
      await page.keyboard.press("Tab");

      const problem = await page.evaluate(
        ({ selector, at }) => {
          const focused = document.activeElement;
          const expected = document.querySelectorAll(selector)[at];
          const name = (element: Element | null): string =>
            element === null
              ? "nothing"
              : `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 40)}"`;
          if (focused === null || focused !== expected) {
            return `${name(focused)} has focus, not ${name(expected ?? null)}`;
          }
          const box = focused.getClientRects()[0] ?? focused.getBoundingClientRect();
          const middle = box.left + box.width / 2;
          for (const [where, top] of [
            ["middle", box.top + box.height / 2],
            ["top edge", box.top + 1],
          ] as const) {
            const hit = document.elementFromPoint(middle, top);
            if (hit === null || (hit !== focused && !focused.contains(hit))) {
              return `its ${where} is under ${name(hit)}`;
            }
          }
          return null;
        },
        { selector: STOPS, at: stop },
      );
      if (problem !== null) {
        found.push(`stop ${stop + 1} of ${count}, ${offset} px from the top: ${problem}`);
      }
    }
  }
  return found;
}

/** The roles that make a landmark. */
const LANDMARK_ROLES = new Set([
  "banner",
  "complementary",
  "contentinfo",
  "form",
  "main",
  "navigation",
  "region",
  "search",
]);

type Landmark = [role: string, name: string];

const byRoleThenName = ([roleA, nameA]: Landmark, [roleB, nameB]: Landmark): number =>
  roleA.localeCompare(roleB) || nameA.localeCompare(nameB);

/** The page's landmarks as Chromium's own accessibility tree has them, by role and then by name. */
async function landmarksOf(page: Page): Promise<Landmark[]> {
  const client = await page.context().newCDPSession(page);
  try {
    const { nodes } = await client.send("Accessibility.getFullAXTree");
    return nodes
      .flatMap((node): Landmark[] => {
        const role: unknown = node.role?.value;
        const name: unknown = node.name?.value;
        if (node.ignored || typeof role !== "string" || !LANDMARK_ROLES.has(role)) return [];
        return [[role, typeof name === "string" ? name : ""]];
      })
      .sort(byRoleThenName);
  } finally {
    await client.detach();
  }
}

/** Axe over a page as tall as its content takes a while, more on a slow computer. */
const AXE_TIMEOUT = 120_000;

/**
 * What axe finds with the window as tall as the page. A line of text that runs past the window's
 * bottom edge has no known background there, which axe reports as contrast it couldn't check, so
 * the result would depend on where the window ends.
 */
async function axeFindings(page: Page, width: number): Promise<string[]> {
  // The page's height depends on its width, so the width is set first.
  await page.setViewportSize({ width, height: 900 });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height });
  return violations(page);
}

/**
 * What in a page runs past the right edge of a window 320 pixels wide, where WCAG's reflow rule is
 * measured, whether or not it makes the page scroll: nothing may.
 */
async function widerThan320(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((element) => !element.closest(".skip, .sr"))
      .filter((element) => element.getBoundingClientRect().right > 320 + 0.5)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
  );
}

describe("the site's page", () => {
  it(
    "passes axe with zero violations, dark and light",
    async () => {
      const page = await open(files.page);
      // Closed, a fold's files aren't drawn, so axe wouldn't check them.
      await openFolds(page);

      expect(await theme(page)).toBe("dark");
      expect(await axeFindings(page, 1280), "dark").toEqual([]);
      // A person going by the links alone can tell them apart: none reads like another that goes
      // somewhere else.
      expect(await identicalLinks(page), "links that read alike").toEqual([]);

      await page.locator("#theme-toggle").click();
      expect(await theme(page)).toBe("light");
      expect(await axeFindings(page, 1280), "light").toEqual([]);
    },
    AXE_TIMEOUT,
  );

  it(
    "passes axe with zero violations, dark and light, with each kind of verdict on a card",
    async () => {
      const page = await open(files.verdicts);
      expect(await page.locator("p.verdict").count()).toBe(3);

      expect(await axeFindings(page, 1280), "dark").toEqual([]);
      await page.locator("#theme-toggle").click();
      expect(await axeFindings(page, 1280), "light").toEqual([]);
    },
    AXE_TIMEOUT,
  );

  it("draws each kind of verdict's sign before its words, in a color of its own in both themes, which a screen reader doesn't read", async () => {
    const page = await open(files.verdicts);
    const signs = () =>
      page.locator("p.verdict").evaluateAll((lines) =>
        lines.map((line) => {
          const before = getComputedStyle(line, "::before");
          return { content: before.content, color: before.color };
        }),
      );

    for (const theme of ["dark", "light"]) {
      const seen = await signs();
      // The sign, with no words for a screen reader to read: the line's own words say it.
      expect(
        seen.map(({ content }) => content),
        theme,
      ).toEqual(['"✓" / ""', '"⚠" / ""', '"⚠" / ""']);
      expect(new Set(seen.map(({ color }) => color)).size, theme).toBe(3);
      if (theme === "dark") await page.locator("#theme-toggle").click();
    }
    // What Chromium's accessibility tree gives a screen reader for each line: its words alone.
    const client = await page.context().newCDPSession(page);
    try {
      const { nodes } = await client.send("Accessibility.getFullAXTree");
      const texts = nodes
        .map((node): unknown => node.name?.value)
        .filter((name): name is string => typeof name === "string")
        .filter((name) => /needs? attention/.test(name));
      expect(texts.some((name) => /[✓⚠]/.test(name))).toBe(false);
      expect(texts).toContain("Nothing needs attention");
    } finally {
      await client.detach();
    }
  });

  it.each([
    ["the tests' content", 390, "page"],
    ["the tests' content", 320, "page"],
    ["names as long as they can be", 390, "long"],
    ["names as long as they can be", 320, "long"],
    ["each kind of verdict", 320, "verdicts"],
  ] as const)(
    "passes axe with zero violations, dark and light, at a phone's width: %s, %i px",
    async (_, width, which) => {
      const page = await open(files[which], { width });
      await openFolds(page);

      expect(await axeFindings(page, width), "dark").toEqual([]);
      await page.locator("#theme-toggle").click();
      expect(await axeFindings(page, width), "light").toEqual([]);
    },
    AXE_TIMEOUT,
  );

  it("fits a window 320 pixels wide, with its folds open", async () => {
    for (const which of ["page", "long", "verdicts"] as const) {
      const page = await open(files[which], { width: 320 });
      await openFolds(page);
      const width = (): Promise<number> =>
        page.evaluate(() => document.documentElement.scrollWidth);

      expect(await width(), `${which}, dark`).toBeLessThanOrEqual(320);
      await page.locator("#theme-toggle").click();
      expect(await width(), `${which}, light`).toBeLessThanOrEqual(320);
      // Nothing in it is wider than the window, whether or not it makes the page scroll.
      expect(await widerThan320(page), which).toEqual([]);
    }
  });

  it("keeps each heading beside its picture, 320 pixels wide, however long its words", async () => {
    for (const which of ["page", "long"] as const) {
      const page = await open(files[which], { width: 320 });
      // Every view's heading and every site's name is in a title row with its picture.
      const heads = await page.locator(".view-head, .site-head").count();
      expect(await page.locator(".view-head > .title, .site-head > .title").count(), which).toBe(
        heads,
      );
      const apart = await page.evaluate(() =>
        [...document.querySelectorAll(".view-head > .title, .site-head > .title")].flatMap(
          (title) => {
            const icon = title.querySelector("svg")?.getBoundingClientRect();
            const heading = title.querySelector("h2, h3")?.getBoundingClientRect();
            if (icon === undefined || heading === undefined) return ["a title row missing a part"];
            // Beside it: the heading starts right of the picture, and above the picture's bottom.
            return heading.left >= icon.right - 0.5 && heading.top < icon.bottom
              ? []
              : [title.textContent ?? ""];
          },
        ),
      );
      expect(apart, which).toEqual([]);
    }
  });

  it("names the link to a site as a screen reader hears it: its words, then the site's name", async () => {
    const page = await open(files.page);

    await expect(
      page
        .getByRole("link", {
          name: "Visit the site at dvfr.illinois.gov, in a new tab",
          exact: true,
        })
        .count(),
    ).resolves.toBe(1);
  });

  it("ends the footer's lines where the notes' lines end, on a wide window", async () => {
    const page = await open(files.page, { width: 1600 });

    // Both start where the main part's words do, so their widths say where their lines end.
    const width = await page.evaluate(() => {
      const widest = (selector: string): number =>
        Math.max(
          ...[...document.querySelectorAll(selector)].map(
            (element) => element.getBoundingClientRect().width,
          ),
        );
      return { notes: widest("p.note"), footer: widest("footer > p") };
    });

    // The footer's smaller text keeps the notes' measure, so a line of it is no longer to read: its
    // 80 characters are as wide as their 72. Where a character's width is rounded to a whole pixel,
    // as in Chromium on Linux, the footer's can come out up to 2% short of theirs, but never wider.
    expect(width.footer).toBeLessThanOrEqual(width.notes + 1);
    expect(width.footer).toBeGreaterThanOrEqual(width.notes * 0.98);
  });

  it.each([
    ["with no report at all", "empty"],
    ["with the demo and two sites", "page"],
  ] as const)(
    "puts the footer at the window's bottom when the page is shorter than the window, %s",
    async (_, which) => {
      const page = await open(files[which]);

      const { long, short } = await footerInTwoWindows(page);

      expect(short.scrolls).toBe(false);
      expect(
        Math.abs(short.gapBelow - long.gapBelow),
        `${short.gapBelow} px below the footer in a window taller than the page, ${long.gapBelow} px in one shorter`,
      ).toBeLessThanOrEqual(1);
    },
  );

  it.each([
    ["with no report at all", "empty"],
    ["with the demo and two sites", "page"],
  ] as const)("keeps the main part as wide as its box allows, %s", async (_, which) => {
    const page = await open(files[which]);

    const width = await page.locator("main").evaluate((main) => main.getBoundingClientRect().width);

    // 1120 pixels in a window 1280 wide, however little is in it.
    expect(width).toBe(1120);
  });

  it("prints as before: the page is no flex column in print", async () => {
    const page = await open(files.page);

    await page.emulateMedia({ media: "print" });

    expect(await page.evaluate(() => getComputedStyle(document.body).display)).not.toBe("flex");
  });

  it("never hides what has focus under the bar, 1100 pixels wide, with its folds closed or open", async () => {
    const page = await open(files.page, { width: 1100, height: 500 });
    const stops = (): Promise<number> =>
      page.evaluate((selector) => document.querySelectorAll(selector).length, STOPS);
    // The skip link, the bar's four links (the three views, and the trust page) and its button, the
    // link to the demo's pages, the link to the first site itself (the second has no address people
    // visit), the current reports' links (the demo's two, the first site's two, and the second
    // site's one: its Word copy is missing), the earlier report's one (its Word copy changed), the
    // three folds' summaries, each report's page by date, and the footer's link.
    const closed = 1 + 4 + 1 + 1 + 1 + 5 + 1 + 3 + reportsOf(CONTENT).length + 1;
    expect(await stops()).toBe(closed);
    expect(await stopsUnderTheBar(page)).toEqual([]);

    // Open, each file's link too.
    await openFolds(page);
    expect(await stops()).toBe(closed + filesOf(CONTENT).length);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(1500);
    expect(await stopsUnderTheBar(page)).toEqual([]);
  });

  it("puts what a link in the bar points to below the bar, 1100 pixels wide", async () => {
    // A window short enough that each view can be scrolled to the top of it.
    const page = await open(files.page, { width: 1100, height: 300 });

    for (const view of ["demo", "sites", "by-date"]) {
      await page.locator(`nav a[href="#${view}"]`).click();

      const result = await page.evaluate((id) => {
        const heading = document.querySelector(`#${id} > .view-head > .title > h2`);
        const bar = document.querySelector(".bar");
        if (heading === null || bar === null) return "the view or the bar isn't there";
        const box = heading.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + 20, box.top + box.height / 2);
        const barBottom = bar.getBoundingClientRect().bottom;
        return hit === heading && box.top >= barBottom
          ? null
          : `the heading is at ${box.top}, and the bar ends at ${barBottom}`;
      }, view);
      expect(result, view).toBeNull();
    }
  });

  it("tells the link of the page it is on from the others by more than color: bold, and underlined more heavily", async () => {
    const page = await open(files.trustBar);

    const links = await page.locator(".bar nav a").evaluateAll((all) =>
      all.map((link) => {
        const style = getComputedStyle(link);
        return {
          words: link.textContent ?? "",
          current: link.getAttribute("aria-current"),
          weight: style.fontWeight,
          line: style.textDecorationLine,
          thickness: style.textDecorationThickness,
          size: style.fontSize,
        };
      }),
    );

    const look = ({ weight, line, thickness }: (typeof links)[number]) => ({
      weight,
      line,
      thickness,
    });
    const here = links.filter(({ current }) => current === "page");
    const others = links.filter(({ current }) => current !== "page");

    // Only the link to the trust page is the page the reader is on. The others are medium, with the
    // browser's own underline (`auto`, which grows with the text); it is bold, with a heavier one,
    // 0.15 of its text's size thick, so that it stays heavier as the text grows.
    expect(here.map(({ words }) => words)).toEqual(["Can I trust this?"]);
    expect(here.map(({ weight, line }) => ({ weight, line }))).toEqual([
      { weight: "700", line: "underline" },
    ]);
    expect(here.map(({ thickness, size }) => parseFloat(thickness) / parseFloat(size))).toEqual([
      expect.closeTo(0.15, 3),
    ]);
    expect(others.map(look)).toEqual(
      Array.from({ length: 3 }, () => ({ weight: "500", line: "underline", thickness: "auto" })),
    );
  });

  it("takes a link of the trust page's bar to its view on the website's own page", async () => {
    const page = await open(files.trustBar);

    await page.locator("nav a", { hasText: "The sites" }).click();

    // index.html sits beside the trust page's file, as the website's pages sit beside each other.
    const url = new URL(page.url());
    expect(url.pathname.endsWith("/index.html")).toBe(true);
    expect(url.hash).toBe("#sites");
    expect(await page.locator("#sites > .view-head > .title > h2").textContent()).toBe("The sites");
  });

  it("keeps the bar in view from 640 pixels wide, and scrolls it away on a narrower window", async () => {
    // At the browser's own text size, 16 pixels, 40em is 640 pixels.
    const page = await open(files.page, { width: 1100, height: 600 });

    for (const [width, sticks] of [
      [1100, true],
      [640, true],
      [639, false],
      [320, false],
    ] as const) {
      await page.setViewportSize({ width, height: 600 });
      const bar = await page.evaluate(() => {
        window.scrollTo(0, 400);
        const header = document.querySelector(".bar");
        return {
          position: header === null ? "" : getComputedStyle(header).position,
          top: header?.getBoundingClientRect().top ?? NaN,
          height: header?.getBoundingClientRect().height ?? NaN,
          padding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
          scrolled: window.scrollY,
        };
      });

      expect(bar.scrolled, `${width} px`).toBe(400);
      expect(bar.position, `${width} px`).toBe(sticks ? "sticky" : "static");
      if (sticks) {
        expect(bar.top, `${width} px`).toBe(0);
        // The bar is one line even at 640 pixels, and what has focus is kept below all of it.
        expect(bar.height, `${width} px`).toBeLessThan(bar.padding);
      } else {
        expect(bar.top, `${width} px`).toBeLessThan(0);
      }
    }
  });

  it("switches the theme and keeps the choice", async () => {
    const page = await open(files.page);
    const toggle = page.locator("#theme-toggle");

    // Dark until the reader picks light, and the button says what it switches to.
    expect(await theme(page)).toBe("dark");
    expect(await background(page)).toBe(DARK);
    expect(await toggle.isVisible()).toBe(true);
    expect(await toggle.textContent()).toBe("Light version");

    await toggle.click();
    expect(await theme(page)).toBe("light");
    expect(await background(page)).toBe(LIGHT);
    expect(await toggle.textContent()).toBe("Dark version");
    expect(await stored(page)).toBe("light");

    // Kept: the page opens as it was left.
    await page.reload();
    expect(await theme(page)).toBe("light");
    expect(await background(page)).toBe(LIGHT);
    expect(await page.locator("#theme-toggle").textContent()).toBe("Dark version");

    await page.locator("#theme-toggle").click();
    expect(await theme(page)).toBe("dark");
    expect(await stored(page)).toBe("dark");
    await page.reload();
    expect(await background(page)).toBe(DARK);
    expect(await page.locator("#theme-toggle").textContent()).toBe("Light version");
  });

  it("opens in the theme a report was left in, under the same name", async () => {
    const page = await open(files.page, {
      before: 'window.localStorage.setItem("voicecap-theme", "light");',
    });

    expect(await theme(page)).toBe("light");
    expect(await background(page)).toBe(LIGHT);
    expect(await page.locator("#theme-toggle").textContent()).toBe("Dark version");
  });

  it("is light in print, without the theme button", async () => {
    const page = await open(files.page);

    expect(await background(page)).toBe(DARK);
    await page.emulateMedia({ media: "print" });
    expect(await background(page)).toBe(LIGHT);
    expect(await page.locator("#theme-toggle").isVisible()).toBe(false);
  });

  it("is complete without JavaScript, and its folds open by mouse and by keyboard", async () => {
    const page = await open(files.page, { scripts: false });

    // Every view, every report's links, and every report by date are there, and in view.
    expect(await page.locator("main h2").allTextContents()).toEqual([
      "The demo",
      "The sites",
      "Every report, by date",
    ]);
    for (const heading of await page.locator("main h2").all()) {
      expect(await heading.isVisible()).toBe(true);
    }
    const actions = page.locator("a.action");
    expect(await actions.count()).toBe(5);
    for (const link of await actions.all()) expect(await link.isVisible()).toBe(true);
    expect(await page.locator(".earlier a").count()).toBe(1);
    expect(await page.locator(".earlier a").isVisible()).toBe(true);
    expect(await page.locator("#by-date li").count()).toBe(reportsOf(CONTENT).length);

    // Each report's files are in its site's fold, closed, which opens from its summary.
    const links = page.locator(".files a");
    expect(await links.allTextContents()).toEqual(filesOf(CONTENT).map(({ name }) => name));
    for (const link of await links.all()) expect(await link.isVisible()).toBe(false);
    const summaries = page.locator("summary");
    expect(await summaries.count()).toBe(3);
    await summaries.nth(0).click();
    await summaries.nth(1).focus();
    await page.keyboard.press("Enter");
    await summaries.nth(2).focus();
    await page.keyboard.press("Space");
    for (const link of await links.all()) expect(await link.isVisible()).toBe(true);

    // The button does nothing without the script, so it's hidden, and the page is dark.
    expect(await page.locator("#theme-toggle").isVisible()).toBe(false);
    expect(await background(page)).toBe(DARK);
  });

  it("has the page's landmarks and a region for each of its three views, and none for a site, however many sites", async () => {
    // As Chromium's own accessibility tree has them. A site's section has no name, so it isn't a
    // region: with many sites that would be a long list of landmarks, and each site's heading, an
    // h3, already leads to it.
    const landmarks: Landmark[] = [
      ["banner", ""],
      ["navigation", "This website"],
      ["main", ""],
      ["region", "The demo"],
      ["region", "The sites"],
      ["region", "Every report, by date"],
      ["contentinfo", ""],
    ];

    for (const which of ["page", "many"] as const) {
      const page = await open(files[which]);
      expect(await landmarksOf(page), which).toEqual([...landmarks].sort(byRoleThenName));
    }
    // The second page does have the sites, each with its heading.
    const many = await open(files.many);
    expect(await many.locator("section.site").count()).toBe(14);
    expect(await many.locator("section.site > .site-head > .title > h3").count()).toBe(14);
  });
});

describe("the trust page", () => {
  /** The headings of its sections, in order. */
  const SECTION_HEADINGS = [
    "One job: hear a website the way a screen reader user hears it.",
    "Real NVDA, not a simulation.",
    "Title II. IITAA. WCAG.",
    "Every word can be checked.",
    "It tests itself before every release.",
    "What it doesn't do.",
    '"One person built this."',
    "How it got here.",
  ];

  it.each([
    ["with its facts", 1280, "trust"],
    ["with its facts", 390, "trust"],
    ["with its facts", 320, "trust"],
    ["with no release facts and no report", 1280, "trustBare"],
    ["with no release facts and no report", 390, "trustBare"],
    ["with no release facts and no report", 320, "trustBare"],
  ] as const)(
    "passes axe with zero violations, dark and light, %s, at %i pixels",
    async (_, width, which) => {
      const page = await open(files[which], { width });
      // Closed, the fold's releases aren't drawn, so axe wouldn't check them.
      await openFolds(page);

      expect(await theme(page)).toBe("dark");
      expect(await axeFindings(page, width), "dark").toEqual([]);
      await page.locator("#theme-toggle").click();
      expect(await theme(page)).toBe("light");
      expect(await axeFindings(page, width), "light").toEqual([]);
    },
    AXE_TIMEOUT,
  );

  it("has no two links that read alike and go to different places", async () => {
    const page = await open(files.trust);
    await openFolds(page);

    expect(await identicalLinks(page)).toEqual([]);
  });

  it("fits a window 320 pixels wide, with its fold open", async () => {
    for (const which of ["trust", "trustBare"] as const) {
      const page = await open(files[which], { width: 320 });
      await openFolds(page);
      const width = (): Promise<number> =>
        page.evaluate(() => document.documentElement.scrollWidth);

      expect(await width(), `${which}, dark`).toBeLessThanOrEqual(320);
      await page.locator("#theme-toggle").click();
      expect(await width(), `${which}, light`).toBeLessThanOrEqual(320);
      expect(await widerThan320(page), which).toEqual([]);
    }
  });

  it("puts its four big numbers one a row at 320 pixels, and four across at 1280, with their links in a line", async () => {
    for (const [width, rows] of [
      [320, 4],
      [1280, 1],
    ] as const) {
      const page = await open(files.trust, { width });
      const topsOf = (selector: string): Promise<number[]> =>
        page
          .locator(selector)
          .evaluateAll((all) => all.map((each) => Math.round(each.getBoundingClientRect().top)));

      const tops = await topsOf(".tile");
      expect(tops, `${width} px`).toHaveLength(4);
      expect(new Set(tops).size, `${width} px`).toBe(rows);
      // A row's links line up, however long each line above them is.
      expect(new Set(await topsOf(".tile > a")).size, `${width} px`).toBe(rows);
    }
  });

  it("is complete without JavaScript, and its fold opens by mouse and by keyboard", async () => {
    const page = await open(files.trust, { scripts: false });

    // Every section, and every big number's link, is there, and in view.
    expect(await page.locator("main h2").allTextContents()).toEqual(SECTION_HEADINGS);
    for (const heading of await page.locator("main h2").all()) {
      expect(await heading.isVisible()).toBe(true);
    }
    const tileLinks = page.locator(".tile a");
    expect(await tileLinks.count()).toBe(4);
    for (const link of await tileLinks.all()) expect(await link.isVisible()).toBe(true);

    // The newest five releases are in view, and the two before them are in the fold, closed.
    expect(await page.locator("#releases > ol > li").count()).toBe(5);
    const folded = page.locator("#releases details li");
    expect(await folded.count()).toBe(2);
    const inView = async (): Promise<boolean[]> =>
      Promise.all((await folded.all()).map((item) => item.isVisible()));
    expect(await inView()).toEqual([false, false]);

    // By mouse, open and closed again; then by keyboard, Enter and Space each turn it.
    const summary = page.locator("#releases summary");
    await summary.click();
    expect(await inView()).toEqual([true, true]);
    await summary.click();
    expect(await inView()).toEqual([false, false]);
    await summary.focus();
    await page.keyboard.press("Enter");
    expect(await inView()).toEqual([true, true]);
    await page.keyboard.press("Space");
    expect(await inView()).toEqual([false, false]);

    // The button does nothing without the script, so it's hidden, and the page is dark.
    expect(await page.locator("#theme-toggle").isVisible()).toBe(false);
    expect(await background(page)).toBe(DARK);
  });

  it("marks its own link in the bar as the page the reader is on: bold, and underlined more heavily", async () => {
    const page = await open(files.trust);
    const current = page.locator('.bar nav a[aria-current="page"]');

    expect(await current.count()).toBe(1);
    expect(await current.textContent()).toBe("Can I trust this?");
    expect(await current.getAttribute("href")).toBe("trust.html");
    const { thickness, ...look } = await current.evaluate((link) => {
      const style = getComputedStyle(link);
      return {
        weight: style.fontWeight,
        line: style.textDecorationLine,
        thickness: parseFloat(style.textDecorationThickness) / parseFloat(style.fontSize),
      };
    });
    expect(look).toEqual({ weight: "700", line: "underline" });
    // Its line is 0.15 of its text's size thick, so it stays the heavier as the text grows.
    expect(thickness).toBeCloseTo(0.15, 3);
  });

  it("has the page's landmarks, and a region for each of its sections", async () => {
    const landmarks: Landmark[] = [
      ["banner", ""],
      ["navigation", "This website"],
      ["main", ""],
      ...SECTION_HEADINGS.map((heading): Landmark => ["region", heading]),
      ["contentinfo", ""],
    ];

    for (const which of ["trust", "trustBare"] as const) {
      const page = await open(files[which]);
      expect(await landmarksOf(page), which).toEqual([...landmarks].sort(byRoleThenName));
    }
  });

  it("says a big number it doesn't have to a screen reader as not recorded, and shows a dash", async () => {
    const page = await open(files.trustBare);
    const tile = page.locator(".tile").first();

    // What Chromium gives a screen reader: the words, and not the dash.
    const heard = await tile.ariaSnapshot();
    expect(heard).toContain("not recorded");
    expect(heard).not.toContain("—");
    // What a reader sees: the dash, and the words no wider than a pixel, out of sight.
    expect(await tile.locator('.n > span[aria-hidden="true"]').innerText()).toBe("—");
    const words = await tile.locator(".n > .sr").boundingBox();
    expect(words?.width).toBeLessThanOrEqual(1);
  });

  it("never hides what has focus under the bar, 1100 pixels wide, with its fold closed or open", async () => {
    const page = await open(files.trust, { width: 1100, height: 500 });

    expect(await stopsUnderTheBar(page)).toEqual([]);
    await openFolds(page);
    expect(await stopsUnderTheBar(page)).toEqual([]);
  });

  it("puts the part a big number's link points to below the bar, 1100 pixels wide", async () => {
    // A window short enough that each part can be scrolled to the top of it.
    const page = await open(files.trust, { width: 1100, height: 300 });

    for (const [words, id] of [
      ["How it's tested", "tested"],
      ["How to check a copy", "evidence"],
      ["How it got here", "releases"],
    ] as const) {
      await page.locator(".tile a", { hasText: words }).click();

      const result = await page.evaluate((id) => {
        const kicker = document.querySelector(`#${id} > .kicker`);
        const bar = document.querySelector(".bar");
        if (kicker === null || bar === null) return "the part or the bar isn't there";
        const box = kicker.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + 10, box.top + box.height / 2);
        const barBottom = bar.getBoundingClientRect().bottom;
        return hit === kicker && box.top >= barBottom
          ? null
          : `its kicker is at ${box.top}, and the bar ends at ${barBottom}`;
      }, id);
      expect(result, id).toBeNull();
    }
  });
});

describe("the bar at a larger default text size", () => {
  /**
   * Sizes a reader can set the browser's text to, in pixels: its own is 16. A browser starts a page
   * at that size, and an em in a media query is that size too, so each of these is a browser of its
   * own, started with the size set. They go to three and a half times the default size: past twice
   * it the bar's links, and then its button, take lines of their own, and the bar has to stay
   * shorter than the room kept clear for it all the same.
   */
  const SIZES = [24, 32, 40, 48, 56];
  const sized = new Map<number, Browser>();

  beforeAll(async () => {
    for (const size of SIZES) {
      sized.set(size, await launchBrowser([`--blink-settings=defaultFontSize=${size}`]));
    }
  });

  afterAll(async () => {
    await Promise.all([...sized.values()].map((each) => each.close()));
  });

  it.each(SIZES)(
    "sticks from 40em wide, is shorter than the room kept clear for it, and hides nothing that has focus, at %i pixels",
    async (size) => {
      const own = sized.get(size);
      if (own === undefined) throw new Error(`No browser was started for a text size of ${size}.`);
      // The bar sticks from 40em wide: 640 pixels at 16, and wider as the text gets larger.
      const sticksFrom = 40 * size;

      for (const width of [640, sticksFrom - 1, sticksFrom]) {
        const page = await open(files.page, { browser: own, width, height: 500 });
        const bar = await page.evaluate(() => {
          const header = document.querySelector(".bar");
          return {
            text: getComputedStyle(document.documentElement).fontSize,
            position: header === null ? "" : getComputedStyle(header).position,
            height: header?.getBoundingClientRect().height ?? NaN,
            padding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
          };
        });
        const where = `${width} px wide, text at ${size} px`;

        expect(bar.text, where).toBe(`${size}px`);
        expect(bar.position, where).toBe(width >= sticksFrom ? "sticky" : "static");
        // Where it sticks it's shorter than the room kept clear for it, however many lines it takes.
        if (width >= sticksFrom) expect(bar.height, where).toBeLessThan(bar.padding);
        expect(await stopsUnderTheBar(page), where).toEqual([]);
      }
    },
  );
});
