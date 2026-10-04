/**
 * The website as Netlify serves it: built by buildSite from a home with reports shared in it, then
 * served over HTTP with each path's headers from the site's _headers (test/helpers/site-server.ts),
 * and opened in headless Chromium. The pages' own tests open them from files, where no Content
 * Security Policy applies. Here each page runs under the policy its own bytes make, and a download is
 * an attachment. Nothing here starts a screen reader or Word.
 */
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseSitemapXml } from "../src/pages/sitemap.js";
import { readShares } from "../src/share/shares.js";
import { buildSite, type BuildSiteResult } from "../src/site/build.js";
import type { SiteContent } from "../src/site/render.js";
import { sha256 } from "../src/util/hash.js";
import { silentLogger } from "../src/util/log.js";
import { launchBrowser } from "./helpers/axe.js";
import {
  EXAMPLE_FOLDER,
  EXAMPLE_STEM,
  FIXTURE_FOLDER,
  homeWithShares,
  recordOf,
  sealedEntry,
  writeRecord,
} from "./helpers/site-home.js";
import { serveSite, type SiteServer } from "./helpers/site-server.js";

/** What a report's check says when every fingerprint matches (as the page's own tests have it). */
const MATCHING =
  "Checked just now, in this browser. " +
  "21 of 21 transcripts match their fingerprints, and both runs' seals check out.";

/** How every page's policy starts: nothing is allowed but the page's own script, by its hash. */
const A_HASHED_POLICY = /^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'/;

/**
 * Runs in each page before the page's own code, and keeps what the browser reports of each policy
 * violation in `window.violations`.
 */
const COLLECT_VIOLATIONS = `
  window.violations = [];
  document.addEventListener("securitypolicyviolation", function (event) {
    window.violations.push(event.effectiveDirective + " blocked " + (event.blockedURI || "inline"));
  });
`;

/** The policy of the demo's own pages: each address a page answers at has it, from a rule of its own. */
const DEMO_POLICY =
  "default-src 'none'; style-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
/** The demo's canonical address: the website's /demo-site/, which each of its pages names. */
const DEMO_CANONICAL = "https://voicecap.netlify.app/demo-site/";
/** The demo's pages by their path under /demo-site/ ("" is the home page): the tour's, then the form's answer. */
const DEMO_PAGE_PATHS = [
  "",
  "before-you-start/",
  "how-a-run-works/",
  "reading-transcripts/",
  "the-report/",
  "ask-a-question/",
  "common-mistakes/",
  "ask-a-question/sent.html",
];

/** The script and the style of a page as an older voicecap could have written it: not today's. */
const OLDER_SCRIPT = '/* an older script */ document.documentElement.dataset.older = "ran";';
const OLDER_STYLE = "body { margin: 3rem; }";
const OLDER_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>An older page</title><style>${OLDER_STYLE}</style></head>
<body><p>An older page.</p><script>${OLDER_SCRIPT}</script></body></html>
`;
/** Its name, and so its place on the site, beside the example site's own report. */
const OLDER_NAME = `${EXAMPLE_FOLDER}_2027-01-15.html`;
const OLDER_HREF = `${EXAMPLE_FOLDER}/${OLDER_NAME}`;

let browser: Browser;
/** The folders these tests made, which are taken away at the end. */
const folders: string[] = [];
const servers: SiteServer[] = [];
const contexts: BrowserContext[] = [];
/** What each page opened in a test reported going wrong: errors thrown, and errors in its console. */
const reported: string[] = [];
/** The site of the home homeWithShares makes, built, and served. */
let built: BuildSiteResult;
let server: SiteServer;

/** A home with reports shared in it, in a folder of its own that is taken away at the end. */
async function newHome(): Promise<string> {
  const home = await homeWithShares();
  folders.push(path.dirname(home));
  return home;
}

/** The site of `home`, built beside it in a folder of its own, with nothing said of it. */
function build(home: string): Promise<BuildSiteResult> {
  const root = path.dirname(home);
  return buildSite({
    home,
    out: path.join(root, "site"),
    cwd: root,
    env: {},
    logger: silentLogger,
  });
}

beforeAll(async () => {
  browser = await launchBrowser();
  built = await build(await newHome());
  server = await serveSite(built.out);
  servers.push(server);
});

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
  // Nothing the pages did went wrong, in any test.
  expect(reported.splice(0)).toEqual([]);
});

afterAll(async () => {
  await Promise.all(servers.map((each) => each.close()));
  await browser.close();
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A context that keeps each page's policy violations, and reports what its pages do wrong. */
async function newContext(): Promise<BrowserContext> {
  const context = await browser.newContext();
  contexts.push(context);
  await context.addInitScript(COLLECT_VIOLATIONS);
  context.on("page", (page) => {
    page.on("pageerror", (error) => reported.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") reported.push(message.text());
    });
  });
  return context;
}

async function newPage(): Promise<Page> {
  return (await newContext()).newPage();
}

/** Go to `address`, and give the policy its response came with: its Content-Security-Policy header. */
async function visit(page: Page, address: string): Promise<string | undefined> {
  const response = await page.goto(address);
  expect(response?.status(), address).toBe(200);
  return response?.headers()["content-security-policy"];
}

/** Each policy violation the page being looked at has reported since it was opened. */
const violationsOf = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as Window & { violations?: string[] }).violations ?? []);

const result = async (page: Page): Promise<string> =>
  (await page.locator("#fp-result").textContent()) ?? "";

const theme = (page: Page): Promise<string | null> => page.getAttribute("html", "data-theme");

/** How a policy names the hash of a text: 'sha256-', its base64, in quotes. */
function sourceOf(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/** Each page the site publishes, by its address from the site's top. */
function pagesOf(content: SiteContent): string[] {
  const reports = [content.demo, ...content.sites.flatMap((site) => site.reports)];
  return reports
    .flatMap((report) => (report === null ? [] : report.files))
    .filter(({ kind }) => kind === "page")
    .map(({ href }) => href);
}

/** The home with one more report on the example site, whose page is OLDER_PAGE, sealed by hand. */
async function addAnOlderReport(home: string): Promise<void> {
  const siteDir = path.join(home, EXAMPLE_FOLDER);
  const page = Buffer.from(OLDER_PAGE);
  await writeFile(path.join(siteDir, "share", OLDER_NAME), page);
  const { shares } = await readShares(siteDir);
  await writeRecord(siteDir, [
    ...shares,
    sealedEntry(2, "2027-01-15T10:00:00-06:00", [recordOf(OLDER_NAME, page)]),
  ]);
}

describe("the site, served as Netlify serves it", () => {
  it("runs every page under its own policy, with no violation", async () => {
    const page = await newPage();

    // The site's page, at the site's top.
    expect(await visit(page, server.url)).toMatch(A_HASHED_POLICY);
    expect(await page.locator("#theme-toggle").isVisible()).toBe(true);
    await page.locator("#theme-toggle").click();
    expect(await violationsOf(page), "the site's page").toEqual([]);

    // Each page of a report: the three shared, and the one written by hand.
    const pages = pagesOf(built.content);
    expect(pages.toSorted()).toEqual(
      [
        `demo/${FIXTURE_FOLDER}_2027-01-16.html`,
        `${FIXTURE_FOLDER}/${FIXTURE_FOLDER}_2027-01-15-2.html`,
        `${FIXTURE_FOLDER}/${FIXTURE_FOLDER}_2027-01-15.html`,
        `${EXAMPLE_FOLDER}/${EXAMPLE_STEM}.html`,
      ].toSorted(),
    );
    const checked: string[] = [];
    for (const href of pages) {
      expect(await visit(page, new URL(href, server.url).href), href).toMatch(A_HASHED_POLICY);
      if (href.startsWith(`${EXAMPLE_FOLDER}/`)) {
        // Written by hand: its one script sets an attribute on the page.
        expect(await page.evaluate(() => document.documentElement.dataset.written), href).toBe(
          "by hand",
        );
      } else {
        // The page's script shows its buttons, and each does its work.
        for (const button of ["#theme-toggle", "#open-all", "#fp-run"]) {
          expect(await page.locator(button).isVisible(), `${href} ${button}`).toBe(true);
        }
        await page.locator("#theme-toggle").click();
        await page.locator("#open-all").click();
        await page.locator("#fp-run").click();
        await expect.poll(() => result(page), { timeout: 10_000 }).toBe(MATCHING);
        await page.locator("#fp-demo").click();
        await expect
          .poll(() => result(page), { timeout: 10_000 })
          .toMatch(/^Demonstration, on a copy/);
        checked.push(href);
      }
      expect(await violationsOf(page), href).toEqual([]);
    }
    expect(checked).toHaveLength(3);
  });

  it("runs an older page under its own policy", async () => {
    const home = await newHome();
    await addAnOlderReport(home);
    const older = await build(home);
    expect(pagesOf(older.content)).toContain(OLDER_HREF);
    const olderServer = await serveSite(older.out);
    servers.push(olderServer);
    const address = new URL(OLDER_HREF, olderServer.url).href;
    const page = await newPage();

    const policy = await visit(page, address);

    // The policy is made from this page's own script and style, which no other page has.
    expect(policy).toContain(`script-src ${sourceOf(OLDER_SCRIPT)};`);
    expect(policy).toContain(`style-src ${sourceOf(OLDER_STYLE)};`);
    expect(await page.evaluate(() => document.documentElement.dataset.older)).toBe("ran");
    expect(await violationsOf(page)).toEqual([]);

    // Under the policy of a page written today it's blocked, so a violation would have been seen.
    const today = await visit(
      page,
      new URL(`${FIXTURE_FOLDER}/${FIXTURE_FOLDER}_2027-01-15.html`, olderServer.url).href,
    );
    await page.route(address, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), "content-security-policy": today ?? "" },
      });
    });
    await page.goto(address);
    expect(await violationsOf(page)).not.toEqual([]);
    expect(await page.evaluate(() => document.documentElement.dataset.older)).toBeUndefined();
    expect(reported.splice(0).join("\n")).toContain("Content Security Policy");
  });

  it("downloads a Word copy and a walkthrough file as attachments", async () => {
    const page = await newPage();
    await page.goto(server.url);
    const site = built.content.sites.find(({ folders }) => folders.includes(FIXTURE_FOLDER));
    const report = site?.reports[0];
    expect(report?.files.map(({ kind }) => kind)).toEqual([
      "page",
      "word",
      "walkthrough",
      "walkthrough",
    ]);

    for (const kind of ["word", "walkthrough"]) {
      const file = report?.files.find((each) => each.kind === kind);
      if (file === undefined) throw new Error(`The report has no ${kind} file.`);
      const address = new URL(file.href, server.url).href;

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator(`a[href="${file.href}"]`).click(),
      ]);

      // A browser reports no response for a download, so the address is asked for again.
      const response = await page.request.get(address);
      expect(response.status(), file.name).toBe(200);
      expect(response.headers()["content-disposition"], file.name).toBe("attachment");
      expect(download.suggestedFilename()).toBe(file.name);
      const saved = await download.path();
      if (saved === null) throw new Error(`The browser kept no file for ${file.name}.`);
      // The bytes it saved are the file as it was shared.
      const bytes = await readFile(saved);
      expect({ bytes: bytes.length, sha256: sha256(bytes) }).toEqual({
        bytes: file.bytes,
        sha256: file.sha256,
      });
    }
  });

  it("carries the theme from the site to a report", async () => {
    const page = await newPage();
    await page.goto(server.url);
    expect(await theme(page)).toBe("dark");

    await page.locator("#theme-toggle").click();
    expect(await theme(page)).toBe("light");

    // Follow a link to a report's page, as a reader does: it opens in the theme the site was left in.
    const href = `${FIXTURE_FOLDER}/${FIXTURE_FOLDER}_2027-01-15.html`;
    await Promise.all([
      page.waitForURL(new URL(href, server.url).href),
      page.locator(`a[href="${href}"]`).first().click(),
    ]);
    expect(await theme(page)).toBe("light");
    expect(await page.locator("#theme-toggle").textContent()).toBe("Dark version");
  });
});

// The demo's own pages are published inside the website at /demo-site/, which is their canonical
// address. They hold no script and no style block, so a rule of _headers gives each address a page
// answers at the same policy, which allows their style sheet and their form. There is no wildcard
// rule: each address is written out, and the server here gives a rule only to its exact path.
describe("the demo's own pages, served as Netlify serves them", () => {
  const demoAddress = (where: string): string => new URL(`demo-site/${where}`, server.url).href;
  /**
   * The addresses a page answers at, by its path under /demo-site/: a page in a folder is at the
   * folder's address and at its index.html, and the form's answer is at its own.
   */
  const addressesOf = (where: string): string[] =>
    where === "" || where.endsWith("/") ? [where, `${where}index.html`] : [where];

  it("loads each page with its style, at every address it answers at, under the demo's policy, naming its own address, with no violation", async () => {
    const page = await newPage();
    const visited: string[] = [];

    for (const where of DEMO_PAGE_PATHS) {
      for (const at of addressesOf(where)) {
        expect(await visit(page, demoAddress(at)), at).toBe(DEMO_POLICY);
        // The style sheet beside the pages loaded under the policy: the page has its text color,
        // and without it would have the browser's black.
        expect(await page.locator('link[rel="stylesheet"]').count(), at).toBe(1);
        expect(await page.evaluate(() => getComputedStyle(document.body).color), at).toBe(
          "rgb(24, 31, 58)",
        );
        // Whichever address it is read at, it names the one address it has: its folder's.
        expect(await page.locator('link[rel="canonical"]').getAttribute("href"), at).toBe(
          `${DEMO_CANONICAL}${where}`,
        );
        expect(await violationsOf(page), at).toEqual([]);
        visited.push(at);
      }
    }
    // The home page's two, each of the six other pages' two, and the form's answer's one.
    expect(visited).toHaveLength(2 + 6 * 2 + 1);
  });

  it("leads every link, style sheet, and form of the pages to a file under /demo-site/", async () => {
    const page = await newPage();
    const base = demoAddress("");
    const followed = new Set<string>();

    for (const where of DEMO_PAGE_PATHS) {
      await visit(page, demoAddress(where));
      // The addresses as the browser resolved them, except the links that stay in the page.
      const addresses = await page.evaluate(() => [
        ...[...document.querySelectorAll("a[href]")]
          .filter((link) => !link.getAttribute("href")?.startsWith("#"))
          .map((link) => (link as HTMLAnchorElement).href),
        ...[...document.querySelectorAll('link[rel="stylesheet"]')].map(
          (link) => (link as HTMLLinkElement).href,
        ),
        ...[...document.querySelectorAll("form[action]")].map(
          (form) => (form as HTMLFormElement).action,
        ),
      ]);
      expect(addresses.length, where).toBeGreaterThanOrEqual(2);
      for (const address of addresses) {
        expect(address.startsWith(base), `${where}: ${address}`).toBe(true);
        expect((await page.request.get(address)).status(), `${where}: ${address}`).toBe(200);
        followed.add(address);
      }
    }
    // Every page of the tour is reached by a link, and the form's answer by the form.
    for (const where of DEMO_PAGE_PATHS) expect(followed, where).toContain(demoAddress(where));
  });

  it("answers the question form with sent.html, under the same policy", async () => {
    const page = await newPage();
    await visit(page, demoAddress("ask-a-question/"));
    await page.fill("#question", "Does this go anywhere?");

    const [answer] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/ask-a-question/sent.html")),
      page.click("button[type=submit]"),
    ]);

    expect(answer.status()).toBe(200);
    expect(answer.headers()["content-security-policy"]).toBe(DEMO_POLICY);
    expect(new URL(page.url()).pathname).toBe("/demo-site/ask-a-question/sent.html");
    expect(await page.title()).toBe("Nothing was sent | voicecap demo");
    expect(await violationsOf(page)).toEqual([]);
  });

  it("is reached from the website's page, by the demo view's link", async () => {
    const page = await newPage();
    await page.goto(server.url);

    await Promise.all([
      page.waitForURL(demoAddress("")),
      page.locator('#demo a[href="demo-site/"]').click(),
    ]);

    expect(await page.title()).toBe("Welcome | voicecap demo");
  });

  it("serves its sitemap, listing the pages at their canonical address", async () => {
    const page = await newPage();

    const response = await page.request.get(demoAddress("sitemap.xml"));

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^application\/xml/);
    expect(parseSitemapXml(await response.text())).toEqual({
      kind: "urlset",
      locs: DEMO_PAGE_PATHS.slice(0, 7).map((where) => `${DEMO_CANONICAL}${where}`),
    });
  });
});
