/// <reference lib="dom" />
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { DEMO_PAGES, DEMO_SITE_DIR, startDemoServer, type DemoServer } from "../src/demo/server.js";
import { fetchSitemap } from "../src/pages/sitemap.js";
import { packageRoot } from "../src/util/version.js";
import { launchBrowser, violations } from "./helpers/axe.js";

const MISTAKES = "/common-mistakes/";
const GOOD_PAGES = DEMO_PAGES.filter((page) => page !== MISTAKES);

let browser: Browser;
let server: DemoServer;

beforeAll(async () => {
  browser = await launchBrowser();
  // Port 0: any free port, so a demo running on this computer doesn't matter.
  server = await startDemoServer({ port: 0 });
});

afterAll(async () => {
  await server?.close();
  await browser?.close();
});

/**
 * A page of the demo site, in a window the size voicecap's browser uses, in a context of its own
 * (axe needs one). Close it with close().
 */
async function open(pagePath: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  const page = await context.newPage();
  await page.goto(`${server.origin}${pagePath}`);
  return page;
}

function close(page: Page): Promise<void> {
  return page.context().close();
}

/** The rule ids of a page's axe violations. */
async function ruleIds(page: Page): Promise<string[]> {
  return (await violations(page)).map((line) => line.slice(0, line.indexOf(":"))).sort();
}

/** The tag names of a page's headings, in order. */
function headingTags(page: Page): Promise<string[]> {
  return page
    .locator("h1, h2, h3, h4, h5, h6")
    .evaluateAll((headings) => headings.map((heading) => heading.tagName));
}

describe("the demo site", () => {
  // Review Focus: npx runs dist/demo/server.js, and tests run src/demo/server.ts. Both sit two
  // folders below the package root, which must ship demo/.
  it("is found in the package, which ships it", async () => {
    expect(path.resolve(DEMO_SITE_DIR)).toBe(path.join(packageRoot(), "demo", "site"));
    const pkg = JSON.parse(await readFile(path.join(packageRoot(), "package.json"), "utf8")) as {
      files: string[];
    };
    expect(pkg.files).toContain("demo");
    const build = JSON.parse(
      await readFile(path.join(packageRoot(), "tsconfig.build.json"), "utf8"),
    ) as { compilerOptions: { rootDir: string; outDir: string } };
    expect(build.compilerOptions).toMatchObject({ rootDir: "src", outDir: "dist" });
  });

  // publish.sh refuses to publish a package that's missing a file it can't do without.
  it("is among the files publish.sh requires in the packed package", async () => {
    const publish = await readFile(path.join(packageRoot(), "publish.sh"), "utf8");
    const required = /^for required in (.+); do$/m.exec(publish)?.[1]?.split(" ") ?? [];
    expect(required).toContain("dist/cli.js");
    expect(required).toContain("demo/site/index.html");
  });

  it("is plain HTML and CSS, with no scripts", async () => {
    const entries = await readdir(DEMO_SITE_DIR, { recursive: true, withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile());
    expect(files.length).toBeGreaterThan(DEMO_PAGES.length);
    for (const file of files) {
      expect(file.name).toMatch(/\.(html|css)$/);
      const content = await readFile(path.join(file.parentPath, file.name), "utf8");
      expect(content, file.name).not.toMatch(/<script/i);
    }
  });

  it("has every page its sitemap lists", async () => {
    const sitemap = await fetchSitemap(`${server.origin}/sitemap.xml`);
    expect(sitemap.urls).toHaveLength(DEMO_PAGES.length);
    for (const { loc } of sitemap.urls) {
      const response = await fetch(loc);
      expect(response.status, loc).toBe(200);
      expect(response.headers.get("content-type"), loc).toMatch(/^text\/html/);
    }
  });
});

describe("the demo site's accessibility (axe-core in Chromium)", () => {
  it("has no violations on the six good pages", async () => {
    expect(GOOD_PAGES).toHaveLength(6);
    for (const pagePath of GOOD_PAGES) {
      const page = await open(pagePath);
      expect(await violations(page), pagePath).toEqual([]);
      await close(page);
    }
  });

  it("has exactly its three mistakes on /common-mistakes/", async () => {
    const page = await open(MISTAKES);
    expect(await ruleIds(page)).toEqual(["button-name", "label", "page-has-heading-one"]);
    await close(page);
  });

  it("has no violations on the form's answer, or on the 404 page", async () => {
    const page = await open("/ask-a-question/");
    await page.fill("#question", "Does this go anywhere?");
    await page.click("button[type=submit]");
    await page.waitForFunction(() => document.title.startsWith("Nothing was sent"));
    expect(await violations(page)).toEqual([]);
    await page.goto(`${server.origin}/no-such-page/`);
    expect(await page.title()).toBe("Page not found | voicecap demo");
    expect(await violations(page)).toEqual([]);
    await close(page);
  });
});

// Review Focus: voicecap's own flag rules read what the screen reader says, so a good page's words
// could trip them: "unlabeled" anywhere in its text, a link named only "More", or a first heading
// below level 1. And /common-mistakes/ must keep what trips the headings and generic-link-text
// rules. Axe sees none of this.
describe("the demo site and voicecap's flag rules", () => {
  it("gives the flag rules nothing to match on the six good pages", async () => {
    const { unlabeled, genericLinkText } = DEFAULT_CONFIG.flags;
    const generic = new Set(genericLinkText.phrases.map((phrase) => phrase.toLowerCase()));
    for (const pagePath of GOOD_PAGES) {
      const page = await open(pagePath);
      const text = (await page.locator("body").innerText()).toLowerCase();
      for (const phrase of unlabeled.phrases) expect(text, pagePath).not.toContain(phrase);
      const links = (await page.locator("a").allInnerTexts()).map((name) =>
        name.trim().toLowerCase(),
      );
      expect(
        links.filter((name) => name === "" || generic.has(name)),
        pagePath,
      ).toEqual([]);
      expect((await headingTags(page))[0], pagePath).toBe("H1");
      await close(page);
    }
  });

  it('keeps /common-mistakes/\'s level 2 first heading and its three "click here" links', async () => {
    const page = await open(MISTAKES);
    expect((await headingTags(page))[0]).toBe("H2");
    const links = await page.locator("main a").allInnerTexts();
    expect(links.map((name) => name.trim().toLowerCase())).toEqual([
      "click here",
      "click here",
      "click here",
    ]);
    await close(page);
  });
});
