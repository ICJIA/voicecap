/// <reference lib="dom" />
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import type { Browser, BrowserContextOptions, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { generateReport } from "../src/report/index.js";
import { liveCompareDir } from "../src/run/paths.js";
import { launchBrowser, violations } from "./helpers/axe.js";
import { LOGO, buildRichFixture, tempOutDir } from "./helpers/report-data.js";

let browser: Browser;
let reportUrl: string;
let reportHtml: string;
let totalRows: number;

const VIEWPORT = { width: 3000, height: 1600 };

async function openReport(options: BrowserContextOptions = {}): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT, ...options });
  const page = await context.newPage();
  await page.goto(reportUrl);
  // Page scripts (and so the style injection) can't run with JavaScript disabled.
  if (options.javaScriptEnabled !== false) await showWholeTable(page);
  return page;
}

/**
 * The pages table is wider than main's max-width, so it scrolls sideways inside its region, and
 * axe can't reliably check the contrast of cells clipped by that region: depending on the
 * platform's rendering it reports them as incomplete ("partially obscured"), which happened on
 * Linux in CI. Lay the whole table out unclipped, in a viewport wide enough for it. Colors don't
 * depend on layout, so this checks the same contrast.
 */
async function showWholeTable(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      ".page-header, main, .page-footer { max-width: none !important; }" +
      " .table-scroll { overflow: visible !important; }",
  });
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  if (width > VIEWPORT.width) {
    await page.setViewportSize({ width: width + 40, height: VIEWPORT.height });
  }
}

async function visibleRows(page: Page): Promise<number> {
  return page.locator("#pages-table tbody tr:not([hidden])").count();
}

beforeAll(async () => {
  browser = await launchBrowser();
  const outDir = await tempOutDir();
  const { base, run } = await buildRichFixture(outDir);
  totalRows = run.pages.length;
  const { file } = await generateReport({
    outDir,
    run,
    target: "live",
    config: {
      ...DEFAULT_CONFIG,
      report: { title: "Agency NVDA report", agency: "Example Agency", logo: LOGO },
    },
    compare: { base, diffDir: liveCompareDir(outDir, base.id, run.id) },
  });
  reportUrl = pathToFileURL(file).href;
  reportHtml = await readFile(file, "utf8");
});

afterAll(async () => {
  await browser?.close();
});

describe("report accessibility (axe-core in Chromium)", () => {
  it("has no violations in the light color scheme", async () => {
    const page = await openReport({ colorScheme: "light" });
    await expect(page.locator("#filters").isVisible()).resolves.toBe(true);
    expect(await violations(page)).toEqual([]);
  });

  it("has no violations in the dark color scheme", async () => {
    const page = await openReport({ colorScheme: "dark" });
    expect(await violations(page)).toEqual([]);
  });

  it("filters rows, announces the count, and stays accessible", async () => {
    const page = await openReport();
    const status = page.locator("#row-count");
    await expect(status.getAttribute("role")).resolves.toBe("status");
    await expect(status.textContent()).resolves.toBe(`Showing ${totalRows} of ${totalRows} pages`);

    await page.selectOption("#filter-flagged", "yes");
    await expect(status.textContent()).resolves.toBe(`Showing 1 of ${totalRows} pages`);
    expect(await visibleRows(page)).toBe(1);
    await expect(
      page.locator("#pages-table tbody tr:not([hidden]) th").textContent(),
    ).resolves.toContain("Resources");
    expect(await violations(page)).toEqual([]);

    await page.selectOption("#filter-flagged", "");
    await page.check("#filter-changed");
    await expect(status.textContent()).resolves.toBe(`Showing 1 of ${totalRows} pages`);
    await page.uncheck("#filter-changed");

    await page.selectOption("#filter-review", "unreviewed");
    // New page, the failed page, and the skipped page have no reviews.
    await expect(status.textContent()).resolves.toBe(`Showing 3 of ${totalRows} pages`);

    await page.selectOption("#filter-review", "");
    await page.selectOption("#filter-template", "grants");
    expect(await visibleRows(page)).toBe(1);

    await page.selectOption("#filter-template", "");
    await page.check("#filter-manual");
    expect(await visibleRows(page)).toBe(2);

    await page.check("#filter-compare");
    expect(await visibleRows(page)).toBe(0);
    await expect(status.textContent()).resolves.toBe(`Showing 0 of ${totalRows} pages`);

    await page.click("button[type=reset]");
    await page.waitForFunction(
      (total) =>
        document.getElementById("row-count")?.textContent === `Showing ${total} of ${total} pages`,
      totalRows,
    );
    expect(await visibleRows(page)).toBe(totalRows);
  });

  it("keeps the whole table without JavaScript, with no dead controls", async () => {
    const page = await openReport({ javaScriptEnabled: false });
    expect(await visibleRows(page)).toBe(totalRows);
    await expect(page.locator("#filters").isVisible()).resolves.toBe(false);
    await expect(page.locator("#pages-table").isVisible()).resolves.toBe(true);
    await expect(page.locator("#row-count").textContent()).resolves.toBe(
      `Showing ${totalRows} of ${totalRows} pages`,
    );
  });

  it("has no violations without JavaScript", async () => {
    // axe can't run in a context with JavaScript disabled (it hangs), so load the report's
    // markup with its own script removed: the same DOM a browser without JavaScript shows.
    const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
    const withoutScript = reportHtml.replace(/<script>[\s\S]*?<\/script>/, "");
    expect(withoutScript).not.toContain("<script>");
    await page.setContent(withoutScript, { waitUntil: "load" });
    await showWholeTable(page);
    await expect(page.locator("#filters").isVisible()).resolves.toBe(false);
    expect(await visibleRows(page)).toBe(totalRows);
    expect(await violations(page)).toEqual([]);
  });
});
