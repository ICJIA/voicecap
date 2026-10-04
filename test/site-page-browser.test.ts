/**
 * The website's page as a reader gets it: written to a file by renderSiteIndex, with the fonts
 * embedded, and opened from there in headless Chromium. It's checked for accessibility (axe, in both
 * themes, and at a phone's width), for fitting a window 320 pixels wide, for what the bar does at a
 * wide window (it stays in view, and never hides what has focus or what a link points to), for the
 * theme button, and for being complete without JavaScript.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { fontFaceCss } from "../src/share/fonts.js";
import { renderSiteIndex, type SiteContent } from "../src/site/render.js";
import { identicalLinks, launchBrowser, violations } from "./helpers/axe.js";
import { CONTENT, filesOf, published, reportsOf } from "./helpers/site-content.js";

/** The page's background in each theme. */
const DARK = "rgb(11, 16, 21)";
const LIGHT = "rgb(255, 255, 255)";

/**
 * A site whose names are as long as a name can be: a host of 88 characters, a person's name that is
 * one word, and file names that hold both. Nothing in the page may run past a window 320 pixels wide.
 */
function longContent(): SiteContent {
  const folder = "research-hub-of-the-criminal-justice-information-authority.example.illinois.gov";
  const run = `2026-10-03_${"1".repeat(80)}`;
  const files = [
    published("page", folder, `${folder}_2026-10-03.html`, 324),
    published("word", folder, `${folder}_2026-10-03.docx`, 51),
    published("walkthrough", folder, `${folder}_2026-10-03_${run}_walkthrough.json`, 5, run),
  ];
  return {
    demo: null,
    sites: [
      {
        folder,
        reports: [
          {
            folder,
            id: `report-${folder}-1`,
            at: "2026-10-03T14:05:00-05:00",
            by: "Maximilian-Alexander-Bartholomew-Wolfeschlegelsteinhausenbergerdorff-Junior",
            files,
            notPublished: [
              { name: `${folder}_2026-10-03_${"x".repeat(60)}.docx`, reason: "missing" },
            ],
          },
        ],
      },
    ],
  };
}

let browser: Browser;
let folder: string;
/** The page files: the tests' content, and a site with names as long as they can be. */
let files: { page: string; long: string };
const contexts: BrowserContext[] = [];
/** What each page opened in a test reported going wrong: errors thrown, and errors in its console. */
const reported: string[] = [];

beforeAll(async () => {
  browser = await launchBrowser();
  folder = await mkdtemp(path.join(tmpdir(), "voicecap-site-page-"));
  const fontCss = await fontFaceCss();
  const write = async (name: string, content: SiteContent): Promise<string> => {
    const file = path.join(folder, name);
    await writeFile(file, renderSiteIndex(content, { fontCss }));
    return file;
  };
  files = {
    page: await write("index.html", CONTENT),
    long: await write("long.html", longContent()),
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
  width?: number;
  height?: number;
  /** Whether the page's script runs. Default: it does. */
  scripts?: boolean;
  /** Code that runs in the page first, ahead of its own script. */
  before?: string;
}

/** A page, open from its file, with every font it declares loaded, so its layout is the final one. */
async function open(file: string, options: OpenOptions = {}): Promise<Page> {
  const context = await browser.newContext({
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

describe("the site's page", () => {
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

  it(
    "passes axe with zero violations, dark and light",
    async () => {
      const page = await open(files.page);

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

  it.each([
    ["the tests' content", 390, "page"],
    ["the tests' content", 320, "page"],
    ["names as long as they can be", 390, "long"],
    ["names as long as they can be", 320, "long"],
  ] as const)(
    "passes axe with zero violations, dark and light, at a phone's width: %s, %i px",
    async (_, width, which) => {
      const page = await open(files[which], { width });

      expect(await axeFindings(page, width), "dark").toEqual([]);
      await page.locator("#theme-toggle").click();
      expect(await axeFindings(page, width), "light").toEqual([]);
    },
    AXE_TIMEOUT,
  );

  it("fits a window 320 pixels wide", async () => {
    for (const which of ["page", "long"] as const) {
      const page = await open(files[which], { width: 320 });
      const width = (): Promise<number> =>
        page.evaluate(() => document.documentElement.scrollWidth);

      expect(await width(), `${which}, dark`).toBeLessThanOrEqual(320);
      await page.locator("#theme-toggle").click();
      expect(await width(), `${which}, light`).toBeLessThanOrEqual(320);
      // Nothing in it is wider than the window, whether or not it makes the page scroll.
      const wider = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((element) => !element.closest(".skip, .sr"))
          .filter((element) => element.getBoundingClientRect().right > 320 + 0.5)
          .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
      );
      expect(wider, which).toEqual([]);
    }
  });

  it("never hides what has focus under the bar, 1100 pixels wide", async () => {
    const page = await open(files.page, { width: 1100, height: 500 });
    const focusable = "a[href], button:not([hidden])";
    // The skip link, the bar's three links and its button, each file's link, each report's page by
    // date, and the footer's link.
    const stops = await page.evaluate(
      (selector) => document.querySelectorAll(selector).length,
      focusable,
    );
    expect(stops).toBe(1 + 3 + 1 + filesOf(CONTENT).length + reportsOf(CONTENT).length + 1);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(1500);

    for (let stop = 0; stop < stops; stop++) {
      // Before each Tab, the page is scrolled so the next stop is 10 pixels below the top of the
      // window, which is under the bar. A browser that doesn't know about the bar takes that stop
      // for one in view, and leaves it there.
      await page.evaluate(
        ({ selector, index }) => {
          const next = document.querySelectorAll(selector)[index];
          const top = (next?.getBoundingClientRect().top ?? 0) + window.scrollY;
          window.scrollTo(0, Math.max(0, top - 10));
        },
        { selector: focusable, index: stop },
      );
      await page.keyboard.press("Tab");

      const result = await page.evaluate(
        ({ selector, index }) => {
          const focused = document.activeElement;
          const expected = document.querySelectorAll(selector)[index];
          const name = (element: Element | null): string =>
            element === null
              ? "nothing"
              : `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 40)}"`;
          if (focused === null || focused !== expected) {
            return `${name(focused)} has focus, not ${name(expected ?? null)}`;
          }
          // What is at the middle of the focused element's first line is it, or inside it.
          const box = focused.getClientRects()[0] ?? focused.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          if (hit !== null && (hit === focused || focused.contains(hit))) return null;
          return `${name(focused)} is under ${name(hit)}`;
        },
        { selector: focusable, index: stop },
      );
      expect(result, `stop ${stop + 1} of ${stops}`).toBeNull();
    }
  });

  it("puts what a link in the bar points to below the bar, 1100 pixels wide", async () => {
    // A window short enough that each view can be scrolled to the top of it.
    const page = await open(files.page, { width: 1100, height: 300 });

    for (const view of ["demo", "sites", "by-date"]) {
      await page.locator(`nav a[href="#${view}"]`).click();

      const result = await page.evaluate((id) => {
        const heading = document.querySelector(`#${id} > h2`);
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

  it("keeps the bar in view from 640 pixels wide, and scrolls it away on a narrower window", async () => {
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

  it("is complete without JavaScript", async () => {
    const page = await open(files.page, { scripts: false });

    // Every view, every report's files, and every report by date are there, and in view.
    expect(await page.locator("main h2").allTextContents()).toEqual([
      "The demo",
      "The sites",
      "Every report, by date",
    ]);
    for (const heading of await page.locator("main h2").all()) {
      expect(await heading.isVisible()).toBe(true);
    }
    const links = page.locator(".files a");
    expect(await links.count()).toBe(filesOf(CONTENT).length);
    expect(await links.allTextContents()).toEqual(filesOf(CONTENT).map(({ name }) => name));
    for (const link of await links.all()) expect(await link.isVisible()).toBe(true);
    expect(await page.locator("#by-date li").count()).toBe(reportsOf(CONTENT).length);
    // The button does nothing without the script, so it's hidden, and the page is dark.
    expect(await page.locator("#theme-toggle").isVisible()).toBe(false);
    expect(await background(page)).toBe(DARK);
  });
});
