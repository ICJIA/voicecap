/**
 * The website's page as a reader gets it: written to a file by renderSiteIndex, in the system's own
 * fonts (it embeds none), and opened from there in headless Chromium. It's checked for
 * accessibility (axe, in both themes, and at a phone's width, with the folds of files open; and the
 * landmarks in Chromium's own accessibility tree), for fitting a window 320 pixels wide, for its
 * layout (the audit tool's columns and gutters), for what the bar does (it scrolls with the page,
 * at the reader's text size too, and never hides what has focus or what a link points to), for the
 * bar the trust page has (its own link told apart from the others by more than color, and its links
 * to the views going to this page), for the theme button, and for being complete without
 * JavaScript, its folds too.
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

import { recordFactsOf } from "../src/site/facts.js";
import { siteBar, sitePage } from "../src/site/frame.js";
import { type PublishedReport, renderSiteIndex, type SiteContent } from "../src/site/render.js";
import { renderTrustPage } from "../src/site/trust.js";
import { TRUST_TEXT } from "../src/site/trust-text.js";
import { identicalLinks, launchBrowser, violations } from "./helpers/axe.js";
import { footerInTwoWindows } from "./helpers/footer.js";
import { CONTENT, DEMO_REPORT, filesOf, published, reportsOf } from "./helpers/site-content.js";
import { EARLIER_RELEASES, FACTS, RECORDS, RESULTS_CONTENT } from "./helpers/trust-facts.js";

/** The page's background in each theme: the audit tool's, #0a0a0a and #f9fafb. */
const DARK = "rgb(10, 10, 10)";
const LIGHT = "rgb(249, 250, 251)";

/** The system's own fonts, which the words are in, and the fixed-width one, the big numbers'. */
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace';

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
  const writeHtml = async (name: string, html: string): Promise<string> => {
    const file = path.join(folder, name);
    await writeFile(file, html);
    return file;
  };
  const write = (name: string, content: SiteContent): Promise<string> =>
    writeHtml(name, renderSiteIndex(content));
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
      sitePage({
        title: "A page with the trust page's bar",
        bar: siteBar(CONTENT, "trust"),
        main: ["<h1>A page with the trust page's bar</h1>"],
      }),
    ),
    // The trust page, beside index.html, as the website has it.
    trust: await writeHtml(
      "trust.html",
      renderTrustPage({
        voicecap: { ...FACTS, releases: [...FACTS.releases, ...EARLIER_RELEASES] },
        records: RECORDS,
        content: RESULTS_CONTENT,
      }),
    ),
    trustBare: await writeHtml(
      "trust-bare.html",
      renderTrustPage({
        voicecap: { ...FACTS, release: null },
        records: recordFactsOf({ demo: null, sites: [] }),
        content: { demo: null, sites: [] },
      }),
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

/**
 * A page, open from its file, with every font it declares loaded, so its layout is the final one.
 * The website's pages declare none (see "draws its words in the system's fonts").
 */
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

/** Where stopsUnderTheBar puts each stop before the Tab: this many pixels from the window's top. */
const STOP_OFFSET = 10;

/**
 * Tabs through every stop of the page, and says which of them ends up under the bar, or under
 * anything else, one line each. Before the Tab, the page is scrolled so that the stop is 10 pixels
 * from the top of the window, where a bar that stuck would be: a browser takes a stop there for one
 * in view, and leaves it there, so a bar that covered it would hide it. The website's bar scrolls
 * with the page, so nothing should: what is at the middle of a stop, and at its top edge, is the
 * stop or is inside it.
 */
async function stopsUnderTheBar(page: Page): Promise<string[]> {
  const count = await page.evaluate(
    (selector) => document.querySelectorAll(selector).length,
    STOPS,
  );
  const found: string[] = [];
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
        // A stop in the bar is where the bar is, wherever the page is scrolled.
        if (next === undefined || next.closest(".bar") !== null) return;
        window.scrollTo(0, Math.max(0, next.getBoundingClientRect().top + window.scrollY - offset));
      },
      { selector: STOPS, at: stop, offset: STOP_OFFSET },
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
    if (problem !== null) found.push(`stop ${stop + 1} of ${count}: ${problem}`);
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

/**
 * The words Chromium's accessibility tree gives a screen reader, in order: the name of each piece of
 * text (`StaticText`), as the browser hands it on, whatever the style draws.
 */
async function spokenTexts(page: Page): Promise<string[]> {
  const client = await page.context().newCDPSession(page);
  try {
    const { nodes } = await client.send("Accessibility.getFullAXTree");
    return nodes
      .filter((node) => node.role?.value === "StaticText")
      .map((node): unknown => node.name?.value)
      .filter((name): name is string => typeof name === "string");
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
          return {
            content: before.content,
            color: before.color,
            words: getComputedStyle(line).color,
            caps: getComputedStyle(line).fontVariantCaps,
          };
        }),
      );
    // The audit tool's colors: green as --good, amber as --warn, and red as --bad, in each theme.
    const colors = {
      dark: ["rgb(52, 211, 153)", "rgb(251, 191, 36)", "rgb(248, 113, 113)"],
      light: ["rgb(25, 101, 73)", "rgb(112, 85, 16)", "rgb(139, 63, 63)"],
    };

    for (const theme of ["dark", "light"] as const) {
      const seen = await signs();
      // The sign, with no words for a screen reader to read: the line's own words say it.
      expect(
        seen.map(({ content }) => content),
        theme,
      ).toEqual(['"✓" / ""', '"⚠" / ""', '"⚠" / ""']);
      // The sign and the words are in the verdict's color.
      expect(
        seen.map(({ color }) => color),
        theme,
      ).toEqual(colors[theme]);
      expect(
        seen.map(({ words }) => words),
        theme,
      ).toEqual(colors[theme]);
      // A verdict is a sentence, drawn in ordinary case: no capitals, small or not.
      expect(
        seen.map(({ caps }) => caps),
        theme,
      ).toEqual(["normal", "normal", "normal"]);
      if (theme === "dark") await page.locator("#theme-toggle").click();
    }
    // What Chromium's accessibility tree gives a screen reader for each line: its words alone, with no
    // sign, and as they're written.
    const texts = (await spokenTexts(page)).filter((name) => /needs? attention/i.test(name));
    expect(texts.some((name) => /[✓⚠]/.test(name))).toBe(false);
    expect(texts).toEqual([
      "Nothing needs attention",
      "1 problem needs attention, on 32 pages",
      "2 problems need attention, on 2 pages",
    ]);
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

  it("draws its words in the system's fonts, and its big numbers in the fixed-width one, and loads no font, on both pages", async () => {
    for (const [which, number] of [
      ["page", ".view-head > .count b"],
      ["trust", ".tile > .n"],
    ] as const) {
      const page = await open(files[which]);

      const fonts = await page.evaluate(
        (selector) => ({
          declared: document.fonts.size,
          words: getComputedStyle(document.body).fontFamily,
          number: getComputedStyle(document.querySelector(selector) ?? document.body).fontFamily,
        }),
        number,
      );

      // No font is in the page, nor loaded from anywhere.
      expect(fonts, which).toEqual({ declared: 0, words: SANS, number: MONO });
    }
  });

  it("lays the page out in the audit tool's columns: what's in the bars in 72rem, the main part in 56rem, across the window's middle, with a gutter of 16 pixels, and 24 from 40em", async () => {
    const page = await open(files.page, { width: 1600 });
    /** Where the content of the bar, of the footer, and of the main part starts and ends. */
    const columns = () =>
      page.evaluate(() => {
        const contentOf = (selector: string) => {
          const element = document.querySelector(selector);
          if (element === null) throw new Error(`The page has no ${selector}.`);
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const left = box.left + parseFloat(style.paddingLeft);
          const right = box.right - parseFloat(style.paddingRight);
          return { left, right, width: right - left };
        };
        return {
          window: document.documentElement.clientWidth,
          parts: { bar: contentOf(".bar"), footer: contentOf("footer"), main: contentOf("main") },
        };
      });

    // At 16 pixels, the browser's own text size, 72rem is 1152 pixels, and 56rem 896.
    const wide = await columns();
    expect(wide.parts.bar.width).toBe(1152);
    expect(wide.parts.footer.width).toBe(1152);
    expect(wide.parts.main.width).toBe(896);
    for (const [name, part] of Object.entries(wide.parts)) {
      expect(Math.abs((part.left + part.right) / 2 - wide.window / 2), name).toBeLessThanOrEqual(
        0.5,
      );
    }
    // Narrower than its column, each starts and ends a gutter from the window's edges: 16 pixels on
    // a phone, and 24 from 40em, which is 640 pixels at 16.
    for (const [width, gutter] of [
      [320, 16],
      [639, 16],
      [640, 24],
      [900, 24],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      const narrow = await columns();
      for (const [name, part] of Object.entries(narrow.parts)) {
        expect(part.left, `${name}, ${width} px`).toBe(gutter);
        expect(narrow.window - part.right, `${name}, ${width} px`).toBe(gutter);
      }
    }
  });

  it("centers the footer's lines under the page, each no longer to read than a note's, on a wide window", async () => {
    const page = await open(files.page, { width: 1600 });

    const { middle, lines, notes } = await page.evaluate(() => {
      const boxes = (selector: string) =>
        [...document.querySelectorAll(selector)].map((element) => element.getBoundingClientRect());
      return {
        middle: document.documentElement.clientWidth / 2,
        lines: boxes("footer > p").map(({ left, right, width }) => ({
          centre: (left + right) / 2,
          width,
        })),
        notes: Math.max(...boxes("p.note").map(({ width }) => width)),
      };
    });

    // As the audit tool's footer is: each line across the window's middle. A line is 80 characters
    // of its smaller text at the most, so it's no longer to read than a note's 72.
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(Math.abs(line.centre - middle)).toBeLessThanOrEqual(0.5);
      expect(line.width).toBeLessThanOrEqual(notes + 1);
    }
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
  ] as const)("keeps the main part as wide as its column, %s", async (_, which) => {
    const page = await open(files[which]);

    const width = await page.locator("main").evaluate((main) => {
      const style = getComputedStyle(main);
      return (
        main.getBoundingClientRect().width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight)
      );
    });

    // 56rem, 896 pixels at the browser's own text size, in a window 1280 wide, however little is in it.
    expect(width).toBe(896);
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

    // Only the link to the trust page is the page the reader is on. The others are regular, with the
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
      Array.from({ length: 3 }, () => ({ weight: "400", line: "underline", thickness: "auto" })),
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

  it("lets the bar scroll away with the page, at any width", async () => {
    const page = await open(files.page, { width: 1100, height: 600 });

    for (const width of [1100, 640, 639, 320]) {
      await page.setViewportSize({ width, height: 600 });
      const bar = await page.evaluate(() => {
        window.scrollTo(0, 400);
        const header = document.querySelector(".bar");
        return {
          position: header === null ? "" : getComputedStyle(header).position,
          top: header?.getBoundingClientRect().top ?? NaN,
          padding: getComputedStyle(document.documentElement).scrollPaddingTop,
          scrolled: window.scrollY,
        };
      });

      // As the audit tool's bar does: it's in the page's flow, so it went up with the page, and no
      // room is kept clear for it.
      expect(bar.scrolled, `${width} px`).toBe(400);
      expect(bar.position, `${width} px`).toBe("static");
      expect(bar.top, `${width} px`).toBeLessThan(0);
      expect(bar.padding, `${width} px`).toBe("auto");
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

  it("gives a screen reader its kickers' words and its law's tags as they're written, not in the capitals they're drawn in", async () => {
    const page = await open(files.trust);

    const texts = await spokenTexts(page);

    // The banner's kicker, two parts' kickers, and the law's three tags: each is drawn in small
    // capitals, and each reaches a screen reader in ordinary case, so it reads words, not letters.
    const written = [
      TRUST_TEXT.hero.kicker,
      TRUST_TEXT.does.kicker,
      TRUST_TEXT.law.kicker,
      ...TRUST_TEXT.law.cards.map(({ tag }) => tag),
    ];
    expect(written).toHaveLength(6);
    for (const words of written) {
      expect(texts, words).toContain(words);
      expect(texts, words).not.toContain(words.toUpperCase());
    }
  });

  it("draws its short labels, a kicker, a law's tag, and a table's header, in small capitals at 1.4 times the spec's size, with the spec's spacing, on the spec's line, and wraps a kicker at 320 pixels", async () => {
    const page = await open(files.trust);
    const closeTo = (value: number): unknown => expect.closeTo(value, 2);

    const looks = await page.evaluate(() => {
      // The page has no table: one is put in it, so that the style draws a table's header.
      const table = document.createElement("table");
      table.innerHTML = "<thead><tr><th>A header</th></tr></thead>";
      document.querySelector("main")?.append(table);
      const look = (selector: string) => {
        const element = document.querySelector(selector);
        if (element === null) throw new Error(`The page has no ${selector}.`);
        const style = getComputedStyle(element);
        return {
          size: parseFloat(style.fontSize),
          spacing: parseFloat(style.letterSpacing),
          line: parseFloat(style.lineHeight),
          caps: style.fontVariantCaps,
        };
      };
      return { kicker: look(".hero > .kicker"), tag: look(".card > .tag"), header: look("th") };
    });

    // A small capital is about as tall as a lowercase letter, so each is drawn at 1.4 times the
    // spec's size, to stand as tall as the spec's capitals. A kicker and a tag: 0.8125rem, 13
    // pixels at the browser's own size, times 1.4, spaced as 0.14em and 0.06em of 13 pixels were,
    // on a line as tall as 1.4 of 13 pixels was.
    expect(looks.kicker).toEqual({
      size: closeTo(18.2),
      spacing: closeTo(1.82),
      line: closeTo(18.2),
      caps: "all-small-caps",
    });
    expect(looks.tag).toEqual({
      size: closeTo(18.2),
      spacing: closeTo(0.78),
      line: closeTo(18.2),
      caps: "all-small-caps",
    });
    // A table's header: 0.75rem, 12 pixels, times 1.4, spaced as 0.08em of 12 pixels was, on the
    // body's line of 1.55 of 12 pixels.
    expect(looks.header).toEqual({
      size: closeTo(16.8),
      spacing: closeTo(0.96),
      line: closeTo(18.6),
      caps: "all-small-caps",
    });

    // A tag has a color of its own behind it, so its text's box, which is taller than its line,
    // stays inside the tag, where axe can tell what each letter is drawn on.
    const outside = await page.locator(".tag").evaluateAll((tags) =>
      tags.flatMap((tag) => {
        const box = tag.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(tag);
        return [...range.getClientRects()].flatMap((text) =>
          text.top < box.top ||
          text.bottom > box.bottom ||
          text.left < box.left ||
          text.right > box.right
            ? [
                `${tag.textContent ?? ""}: its text runs from ${text.top} to ${text.bottom}, the tag from ${box.top} to ${box.bottom}`,
              ]
            : [],
        );
      }),
    );
    expect(outside).toEqual([]);

    // In a window 320 pixels wide, the banner's kicker takes two lines or more, inside the window.
    await page.setViewportSize({ width: 320, height: 800 });
    const kicker = await page.locator(".hero > .kicker").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        lines: box.height / parseFloat(getComputedStyle(element).lineHeight),
        right: box.right,
      };
    });
    expect(Math.round(kicker.lines)).toBeGreaterThanOrEqual(2);
    expect(kicker.right).toBeLessThanOrEqual(320);
  });

  it("draws its parts in the audit tool's colors, in both themes: a law's tag in --act, and a card's heading, its link, and a big number in --good", async () => {
    const page = await open(files.trust);
    const colors = () =>
      page.evaluate(() => {
        const color = (selector: string): string => {
          const element = document.querySelector(selector);
          if (element === null) throw new Error(`The page has no ${selector}.`);
          return getComputedStyle(element).color;
        };
        return {
          tag: color(".card > .tag"),
          heading: color(".card > h3"),
          headingLink: color(".card > h3 > a"),
          number: color(".tile > .n:not(.none)"),
        };
      });

    // #67e8f9 and #34d399, dark; #2c626a and #196549, light.
    const good = { dark: "rgb(52, 211, 153)", light: "rgb(25, 101, 73)" };
    const act = { dark: "rgb(103, 232, 249)", light: "rgb(44, 98, 106)" };
    for (const theme of ["dark", "light"] as const) {
      expect(await colors(), theme).toEqual({
        tag: act[theme],
        heading: good[theme],
        headingLink: good[theme],
        number: good[theme],
      });
      if (theme === "dark") await page.locator("#theme-toggle").click();
    }
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
   * it the bar's links, and then its button, take lines of their own, and the bar still scrolls with
   * the page, and covers nothing.
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
    "scrolls with the page, and hides nothing that has focus, at %i pixels",
    async (size) => {
      const own = sized.get(size);
      if (own === undefined) throw new Error(`No browser was started for a text size of ${size}.`);

      // 640 pixels, and 40em, where the gutter widens: 640 pixels at 16, and wider as the text gets
      // larger.
      for (const width of [640, 40 * size]) {
        const page = await open(files.page, { browser: own, width, height: 500 });
        const bar = await page.evaluate(() => {
          const header = document.querySelector(".bar");
          return {
            text: getComputedStyle(document.documentElement).fontSize,
            position: header === null ? "" : getComputedStyle(header).position,
          };
        });
        const where = `${width} px wide, text at ${size} px`;

        expect(bar.text, where).toBe(`${size}px`);
        expect(bar.position, where).toBe("static");
        expect(await stopsUnderTheBar(page), where).toEqual([]);
      }
    },
  );
});
