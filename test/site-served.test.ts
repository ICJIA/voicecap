/**
 * The website as Netlify serves it: built by buildSite from a home with reports shared in it, then
 * served over HTTP with each path's headers from the site's _headers (test/helpers/site-server.ts),
 * and opened in headless Chromium. The pages' own tests open them from files, where no Content
 * Security Policy applies. Here each page runs under the policy its own bytes make, and a download is
 * an attachment. A share's voice page loads the recordings it holds, and the slowed copies its
 * script makes of them, under its own policy, which lets it, and would be refused the recordings
 * under the shareable page's: they are loaded and measured, and never played. Nothing here starts a
 * screen reader or Word, or makes a sound.
 */
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseSitemapXml } from "../src/pages/sitemap.js";
import { readShares } from "../src/share/shares.js";
import { buildSite, type BuildSiteResult } from "../src/site/build.js";
import { contentSecurityPolicy, inlineHashes } from "../src/site/headers.js";
import type { SiteContent, SitesJson } from "../src/site/render.js";
import { sha256 } from "../src/util/hash.js";
import { silentLogger } from "../src/util/log.js";
import { launchBrowser } from "./helpers/axe.js";
import {
  EXAMPLE_FOLDER,
  EXAMPLE_STEM,
  FIXTURE_FOLDER,
  FIXTURE_NAME,
  homeWithShares,
  homeWithVoiceShare,
  recordOf,
  sealedEntry,
  VOICE_FOLDER,
  VOICE_PAGE,
  VOICE_STEM,
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
const DEMO_CANONICAL = "https://voicecap.icjia.app/demo-site/";
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

    // The site's page, at the site's top: under the policy of its own bytes, which allows no font,
    // since the page embeds none.
    const index = await readFile(path.join(built.out, "index.html"), "utf8");
    const indexPolicy = await visit(page, server.url);
    expect(indexPolicy).toMatch(A_HASHED_POLICY);
    expect(indexPolicy).toBe(contentSecurityPolicy(inlineHashes(index), { fonts: false }));
    expect(indexPolicy).toContain("; font-src 'none';");
    expect(await page.locator("#theme-toggle").isVisible()).toBe(true);
    await page.locator("#theme-toggle").click();
    expect(await violationsOf(page), "the site's page").toEqual([]);

    // The trust page, at both its addresses: under the policy of its own bytes, which the page's
    // style block and script run under, and which allows no font, since the page embeds none; and
    // its theme button works.
    const trust = await readFile(path.join(built.out, "trust.html"), "utf8");
    const trustPolicy = contentSecurityPolicy(inlineHashes(trust), { fonts: false });
    for (const where of ["trust", "trust.html"]) {
      expect(await visit(page, new URL(where, server.url).href), where).toMatch(A_HASHED_POLICY);
      const response = await page.request.get(new URL(where, server.url).href);
      expect(response.headers()["content-security-policy"], where).toBe(trustPolicy);
      expect(await response.text(), where).toBe(trust);
      const before = await theme(page);
      expect(await page.locator("#theme-toggle").isVisible(), where).toBe(true);
      await page.locator("#theme-toggle").click();
      expect(await theme(page), where).not.toBe(before);
      expect(await violationsOf(page), where).toEqual([]);
    }

    // What's New, at both its addresses: under the policy of its own bytes, which the page's style
    // block and script run under, and which allows no font, since the page embeds none; and its
    // theme button works.
    const whatsNew = await readFile(path.join(built.out, "whats-new.html"), "utf8");
    const whatsNewPolicy = contentSecurityPolicy(inlineHashes(whatsNew), { fonts: false });
    expect(whatsNewPolicy).toContain("; font-src 'none';");
    for (const where of ["whats-new", "whats-new.html"]) {
      expect(await visit(page, new URL(where, server.url).href), where).toMatch(A_HASHED_POLICY);
      const response = await page.request.get(new URL(where, server.url).href);
      expect(response.headers()["content-security-policy"], where).toBe(whatsNewPolicy);
      expect(await response.text(), where).toBe(whatsNew);
      expect(await page.title(), where).toBe("What's New · Screen reader test results");
      const before = await theme(page);
      expect(await page.locator("#theme-toggle").isVisible(), where).toBe(true);
      await page.locator("#theme-toggle").click();
      expect(await theme(page), where).not.toBe(before);
      expect(await violationsOf(page), where).toEqual([]);
    }

    // Technical details, at both its addresses: under the policy of its own bytes, which the page's
    // style block and script run under, and which allows no font, since the page embeds none; and
    // its theme button works. Its tables' boxes take focus, as a keyboard reaches them.
    const technical = await readFile(path.join(built.out, "technical-details.html"), "utf8");
    const technicalPolicy = contentSecurityPolicy(inlineHashes(technical), { fonts: false });
    expect(technicalPolicy).toContain("; font-src 'none';");
    for (const where of ["technical-details", "technical-details.html"]) {
      expect(await visit(page, new URL(where, server.url).href), where).toMatch(A_HASHED_POLICY);
      const response = await page.request.get(new URL(where, server.url).href);
      expect(response.headers()["content-security-policy"], where).toBe(technicalPolicy);
      expect(await response.text(), where).toBe(technical);
      expect(await page.title(), where).toBe("Technical details · Screen reader test results");
      const before = await theme(page);
      expect(await page.locator("#theme-toggle").isVisible(), where).toBe(true);
      await page.locator("#theme-toggle").click();
      expect(await theme(page), where).not.toBe(before);
      await page.locator(".scroll").first().focus();
      expect(await page.evaluate(() => document.activeElement?.className), where).toBe("scroll");
      expect(await violationsOf(page), where).toEqual([]);
    }

    // Each page of a report: the three shared, and the one written by hand.
    const pages = pagesOf(built.content);
    expect(pages.toSorted()).toEqual(
      [
        `demo/${FIXTURE_NAME}_2027-01-16.html`,
        `${FIXTURE_FOLDER}/${FIXTURE_NAME}_2027-01-15-2.html`,
        `${FIXTURE_FOLDER}/${FIXTURE_NAME}_2027-01-15.html`,
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
      new URL(`${FIXTURE_FOLDER}/${FIXTURE_NAME}_2027-01-15.html`, olderServer.url).href,
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
      "markdown",
      "data",
      "walkthrough",
      "walkthrough",
    ]);

    // The walkthrough files are in the fold of files, which a reader opens first.
    for (const summary of await page.locator("summary").all()) await summary.click();
    for (const kind of ["word", "walkthrough"]) {
      const file = report?.files.find((each) => each.kind === kind);
      if (file === undefined) throw new Error(`The report has no ${kind} file.`);
      const address = new URL(file.href, server.url).href;

      // The Word copy is linked twice: from the current report, and in the fold.
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator(`a[href="${file.href}"]`).first().click(),
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

  it("downloads a share's Markdown and JSON from the links under its current card's buttons: with their names and types, under the policy that runs nothing in them, and as shared", async () => {
    const page = await newPage();
    await page.goto(server.url);
    const site = built.content.sites.find(({ folders }) => folders.includes(FIXTURE_FOLDER));
    const report = site?.reports[0];
    const types = {
      markdown: "text/markdown; charset=utf-8",
      data: "application/json; charset=utf-8",
    } as const;

    for (const kind of ["markdown", "data"] as const) {
      const file = report?.files.find((each) => each.kind === kind);
      if (file === undefined) throw new Error(`The report has no ${kind} file.`);
      const address = new URL(file.href, server.url).href;

      // The card's line for AI tools links each format, and the link's `download` saves it.
      const link = page.locator(`p.ai a[href="${file.href}"]`);
      expect(await link.count(), file.name).toBe(1);
      const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);

      // A browser reports no response for a download, so the address is asked for again. The file
      // is sent as the type it is, under a policy that loads and runs nothing in it, and with no
      // attachment header: the link saves it, and its address shows it (see the test below).
      const response = await page.request.get(address);
      expect(response.status(), file.name).toBe(200);
      expect(response.headers()["content-type"], file.name).toBe(types[kind]);
      expect(response.headers()["content-security-policy"], file.name).toBe(
        "default-src 'none'; sandbox",
      );
      expect(response.headers()["content-disposition"], file.name).toBeUndefined();
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

  it("serves a share's Markdown and JSON to be read in the browser: with their types, no attachment, a policy that runs nothing in them, and the text as it was shared", async () => {
    const page = await newPage();
    const site = built.content.sites.find(({ folders }) => folders.includes(FIXTURE_FOLDER));
    const report = site?.reports[0];
    const types = {
      markdown: "text/markdown; charset=utf-8",
      data: "application/json; charset=utf-8",
    } as const;

    for (const kind of ["markdown", "data"] as const) {
      const file = report?.files.find((each) => each.kind === kind);
      if (file === undefined) throw new Error(`The report has no ${kind} file.`);
      const address = new URL(file.href, server.url).href;

      // The browser opens it, as it does a page: a download would never finish a navigation.
      const response = await page.goto(address);
      expect(response?.status(), file.name).toBe(200);
      expect(response?.headers()["content-type"], file.name).toBe(types[kind]);
      expect(response?.headers()["content-disposition"], file.name).toBeUndefined();
      // Under a policy that loads nothing and runs nothing in it: the text is shown all the same.
      expect(response?.headers()["content-security-policy"], file.name).toBe(
        "default-src 'none'; sandbox",
      );
      // What it shows is the file's text, whole, as shared.
      const shared = await readFile(path.join(built.out, file.href), "utf8");
      expect(await page.locator("pre").textContent(), file.name).toBe(shared);
      expect(sha256(Buffer.from(shared)), file.name).toBe(file.sha256);
    }
  });

  it("serves llms.txt as text, at the site's top, with each link answering", async () => {
    const page = await newPage();

    const response = await page.request.get(new URL("llms.txt", server.url).href);

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("text/plain; charset=utf-8");
    const text = await response.text();
    expect(text).toBe(await readFile(path.join(built.out, "llms.txt"), "utf8"));
    expect(text.startsWith("# ICJIA Screen Reader Tests\n")).toBe(true);
    // Each link is to a file the site serves, relative to llms.txt: the reports' files, and the
    // two pages.
    const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map(([, href = ""]) => href);
    expect(links).toHaveLength(4);
    for (const href of links) {
      expect((await page.request.get(new URL(href, server.url).href)).status(), href).toBe(200);
    }
  });

  it("serves sites.json as JSON, at the site's top, with each link answering", async () => {
    const page = await newPage();
    const address = new URL("sites.json", server.url).href;

    const response = await page.request.get(address);

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/json; charset=utf-8");
    expect(response.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");
    const text = await response.text();
    expect(text).toBe(await readFile(path.join(built.out, "sites.json"), "utf8"));
    const { sites } = JSON.parse(text) as SitesJson;
    expect(sites.length).toBeGreaterThan(0);
    // Each site's link, read from sites.json's own address, is the front page's, at the id of an
    // element on it; each current report's page answers.
    await page.goto(new URL("index.html", server.url).href);
    for (const { href, current } of sites) {
      const link = new URL(href, address);
      expect(link.pathname, href).toBe("/");
      expect(await page.locator(`[id="${decodeURIComponent(link.hash.slice(1))}"]`).count()).toBe(
        1,
      );
      if (current?.page != null) {
        const pageResponse = await page.request.get(new URL(current.page, address).href);
        expect(pageResponse.status(), current.page).toBe(200);
      }
    }
  });

  it("sends a reader of an older report's page, at either of its addresses, to the site's current report", async () => {
    // The example site's report of 13 January, and three later ones: it's the fourth newest, so
    // it's no longer on the site.
    const home = await newHome();
    const siteDir = path.join(home, EXAMPLE_FOLDER);
    const { shares } = await readShares(siteDir);
    const later = [14, 15, 16].map((day) => ({
      name: `${EXAMPLE_FOLDER}_2027-01-${day}.html`,
      bytes: Buffer.from(OLDER_PAGE.replace("An older page.", `The report of ${day} January.`)),
      at: `2027-01-${day}T10:00:00-06:00`,
    }));
    for (const { name, bytes } of later) await writeFile(path.join(siteDir, "share", name), bytes);
    await writeRecord(siteDir, [
      ...shares,
      ...later.map(({ name, bytes, at }, index) =>
        sealedEntry(index + 2, at, [recordOf(name, bytes)]),
      ),
    ]);
    const kept = await build(home);
    const keptServer = await serveSite(kept.out);
    servers.push(keptServer);
    const current = `${EXAMPLE_FOLDER}/${EXAMPLE_FOLDER}_2027-01-16.html`;
    const older = `${EXAMPLE_FOLDER}/${EXAMPLE_STEM}`;
    expect(pagesOf(kept.content)).not.toContain(`${older}.html`);

    // Asked for, each address of the older page answers with a 302 to the current report's page,
    // which a browser doesn't keep, since the current report changes with each share.
    for (const address of [`${older}.html`, older]) {
      const response = await (
        await newContext()
      ).request.get(new URL(address, keptServer.url).href, {
        maxRedirects: 0,
      });
      expect(response.status(), address).toBe(302);
      expect(response.headers()["location"], address).toBe(`/${current}`);
    }
    // A reader who follows a link to it lands on the current report, under its own policy.
    const page = await newPage();
    const policy = await visit(page, new URL(`${older}.html`, keptServer.url).href);
    expect(page.url()).toBe(new URL(current, keptServer.url).href);
    expect(await page.locator("p").textContent()).toBe("The report of 16 January.");
    expect(policy).toContain(`script-src ${sourceOf(OLDER_SCRIPT)};`);
    expect(await violationsOf(page)).toEqual([]);
    // The older report's Word copy isn't sent anywhere: it's simply not there.
    const word = await page.request.get(
      new URL(`${EXAMPLE_FOLDER}/${EXAMPLE_STEM}.docx`, keptServer.url).href,
      { maxRedirects: 0 },
    );
    expect(word.status()).toBe(404);
  });

  it("carries the theme from the site to a report", async () => {
    const page = await newPage();
    await page.goto(server.url);
    expect(await theme(page)).toBe("dark");

    await page.locator("#theme-toggle").click();
    expect(await theme(page)).toBe("light");

    // Follow a link to a report's page, as a reader does: it opens in the theme the site was left in.
    const href = `${FIXTURE_FOLDER}/${FIXTURE_NAME}_2027-01-15.html`;
    await Promise.all([
      page.waitForURL(new URL(href, server.url).href),
      page.locator(`a[href="${href}"]`).first().click(),
    ]);
    expect(await theme(page)).toBe("light");
    expect(await page.locator("#theme-toggle").textContent()).toBe("Dark version");
  });

  it("reaches the trust page from the site's bar", async () => {
    const page = await newPage();
    await page.goto(server.url);

    await Promise.all([
      page.waitForURL(new URL("trust.html", server.url).href),
      page.locator(".bar").getByRole("link", { name: "Can I trust this?" }).click(),
    ]);

    // It's the trust page, whose own bar says it's the page the reader is on.
    expect(await page.title()).toBe("Can I trust this? · Screen reader test results");
    expect(await page.locator("h1").textContent()).toBe("Built to be checked. See for yourself.");
    expect(await page.locator('.bar nav a[aria-current="page"]').textContent()).toBe(
      "Can I trust this?",
    );
    expect(await violationsOf(page)).toEqual([]);
  });

  it("reaches the site's page from the trust page's bar, by the website's name", async () => {
    const page = await newPage();
    await page.goto(server.url);
    const siteTitle = await page.title();
    await page.goto(new URL("trust.html", server.url).href);

    await Promise.all([
      page.waitForURL(new URL("index.html", server.url).href),
      page.getByRole("link", { name: "ICJIA Screen Reader Tests" }).click(),
    ]);

    expect(await page.title()).toBe(siteTitle);
    expect(await violationsOf(page)).toEqual([]);
  });

  it("follows every link of both bars on all four pages to a page that's there", async () => {
    const page = await newPage();
    // Where each link is followed to, in a page of its own, so the page it's on stays as it is.
    const other = await newPage();
    const titles = new Set([
      "Screen reader test results",
      "Can I trust this? · Screen reader test results",
      "What's New · Screen reader test results",
      "Technical details · Screen reader test results",
    ]);
    const followed = new Set<string>();

    for (const where of ["", "trust", "whats-new.html", "technical-details"]) {
      await visit(page, new URL(where, server.url).href);
      // Each link of the top bar, of the bottom bar, and the way back, as the browser resolves it.
      const links = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLAnchorElement>(".bar a, footer a, main > a.back")].map(
          (link) => link.href,
        ),
      );
      expect(links.length, where).toBeGreaterThanOrEqual(4 + 5);
      // The website's own pages answer here; voicecap on GitHub and its CHANGELOG are on GitHub,
      // which the tests never reach.
      const own = links.filter((link) => link.startsWith(server.url));
      expect(links.filter((link) => !own.includes(link)).toSorted(), where).toEqual(
        [
          "https://github.com/ICJIA/voicecap",
          "https://github.com/ICJIA/voicecap/blob/main/CHANGELOG.md",
        ].toSorted(),
      );
      for (const link of own) {
        await visit(other, link);
        expect(titles.has(await other.title()), `${where}: ${link}`).toBe(true);
        expect(await violationsOf(other), link).toEqual([]);
        followed.add(new URL(link).pathname);
      }
    }
    // Between them, the bars reach each of the four pages.
    expect([...followed].toSorted()).toEqual(
      ["/index.html", "/trust.html", "/whats-new.html", "/technical-details.html"].toSorted(),
    );
  });

  it("draws every page whole without JavaScript, dark and with no theme button, its bars' links all answering", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    contexts.push(context);
    const page = await context.newPage();

    for (const where of ["", "trust.html", "whats-new", "technical-details.html"]) {
      const response = await page.goto(new URL(where, server.url).href);
      expect(response?.status(), where).toBe(200);
      // The button does nothing without the script, so it stays hidden, and the page is dark.
      expect(await page.locator("#theme-toggle").isHidden(), where).toBe(true);
      expect(await page.getAttribute("html", "data-theme"), where).toBeNull();
      expect(
        await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
        where,
      ).toBe("rgb(10, 10, 10)");
      // Both bars are there, whole: the name and three links above, and six items below.
      expect(await page.locator(".bar a").count(), where).toBe(4);
      expect(await page.locator("footer li").count(), where).toBe(6);
      for (const bar of await page.locator(".bar, footer").all()) {
        expect(await bar.isVisible(), where).toBe(true);
      }
      // Each of their links to the website's pages answers.
      const links = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLAnchorElement>(".bar a, footer a")].map(
          (link) => link.href,
        ),
      );
      for (const link of links.filter((each) => each.startsWith(server.url))) {
        expect((await page.request.get(link)).status(), `${where}: ${link}`).toBe(200);
      }
    }
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
   * folder's address, at its index.html, and at its index; the form's answer is at its own address
   * and at the same without ".html", which is how Netlify serves a page too.
   */
  const addressesOf = (where: string): string[] =>
    where === "" || where.endsWith("/")
      ? [where, `${where}index.html`, `${where}index`]
      : [where, where.slice(0, -".html".length)];

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
    // The home page's three, each of the six other pages' three, and the form's answer's two.
    expect(visited).toHaveLength(3 + 6 * 3 + 2);
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
    expect(await page.title()).toBe("Practice form | voicecap demo");
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

// A share's voice page is published beside its report, and plays the recordings it holds: each is in
// its player's address, as data:, which its policy allows (and the shareable page's doesn't), and a
// slower speed plays a copy its script makes of it, from a blob: address, which the policy allows
// too. The recordings and the copies are loaded and measured here, never played: nothing in these
// tests makes a sound.
describe("a share's voice page, served as Netlify serves it", () => {
  let voiceBuilt: BuildSiteResult;
  let voiceServer: SiteServer;
  /** The pair's page and the voice page, as addresses from the site's top. */
  const PAGE_HREF = `${VOICE_FOLDER}/${VOICE_STEM}.html`;
  const VOICE_HREF = `${VOICE_FOLDER}/${VOICE_PAGE}`;
  const addressOf = (href: string): string => new URL(href, voiceServer.url).href;

  beforeAll(async () => {
    const home = await homeWithVoiceShare();
    folders.push(path.dirname(home));
    voiceBuilt = await build(home);
    voiceServer = await serveSite(voiceBuilt.out);
    servers.push(voiceServer);
  });

  /** Ask each player of the page how long its recording is, which loads it: nothing is played. */
  const lengthsOf = (page: Page): Promise<number[]> =>
    page.evaluate(() =>
      Promise.all(
        [...document.querySelectorAll("audio")].map(
          (sound) =>
            new Promise<number>((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("No length in 10 s.")), 10_000);
              sound.addEventListener(
                "loadedmetadata",
                () => {
                  clearTimeout(timer);
                  resolve(sound.duration);
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

  it("loads each recording from the address it holds, under its policy, with no violation, and plays none", async () => {
    const page = await newPage();
    const voice = await readFile(path.join(voiceBuilt.out, VOICE_HREF), "utf8");

    const policy = await visit(page, addressOf(VOICE_HREF));

    // The policy of its own bytes, which allows its style and script by their hashes, and the data:
    // addresses of its recordings (and the blob: addresses of its copies of them) as media.
    expect(policy).toMatch(A_HASHED_POLICY);
    expect(policy).toBe(contentSecurityPolicy(inlineHashes(voice), { media: true }));
    expect(policy).toContain("; img-src data:; media-src data: blob:; font-src data:;");
    // Each of the three pages has a player, and the browser knows how long its file is: two seconds
    // of the first page's sound, and a second and a half of each other's.
    const lengths = await lengthsOf(page);
    expect(lengths).toHaveLength(3);
    expect(lengths.toSorted((a, b) => a - b)).toEqual([
      expect.closeTo(1.5, 2),
      expect.closeTo(1.5, 2),
      expect.closeTo(2, 2),
    ]);
    expect(await violationsOf(page)).toEqual([]);
    // Loaded and never played, from the start.
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll("audio")].map((sound) => [sound.paused, sound.currentTime]),
      ),
    ).toEqual([
      [true, 0],
      [true, 0],
      [true, 0],
    ]);
  });

  it("would be refused its recordings under the shareable page's policy, so media-src data: blob: is what lets it play", async () => {
    const page = await newPage();
    const address = addressOf(VOICE_HREF);
    const voice = await readFile(path.join(voiceBuilt.out, VOICE_HREF), "utf8");
    // The same page, as the shareable page's policy of its own bytes would serve it.
    const shareable = contentSecurityPolicy(inlineHashes(voice));
    expect(shareable).not.toContain("media-src");
    await page.route(address, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), "content-security-policy": shareable },
      });
    });

    await page.goto(address);
    // Its own style and script run, as they do under the policy it has: only the sound is refused.
    expect(await page.locator("fieldset.speeds").first().isVisible()).toBe(true);
    await page.evaluate(() => {
      for (const sound of document.querySelectorAll("audio")) {
        sound.preload = "metadata";
        sound.load();
      }
    });

    // Each of the three players is refused twice: once as the page loads (its element holds the
    // recording's address, and that is a load the policy refuses), and once more when it's asked to
    // load, above. The page is held until every refusal has come, here and in the console's messages,
    // which reach the test a moment after the page's own, and which are read just after: one that
    // came later would be taken for something the page did wrong, when the test ends.
    const players = await page.locator("audio").count();
    expect(players).toBe(3);
    await expect.poll(async () => (await violationsOf(page)).length).toBe(players * 2);
    await expect.poll(() => reported.length).toBe(players * 2);
    const refused = await violationsOf(page);
    expect(refused.every((violation) => violation.startsWith("media-src blocked data"))).toBe(true);
    // What the browser reported to its console is those refusals, and nothing else.
    const messages = reported.splice(0);
    expect(messages).toHaveLength(players * 2);
    for (const message of messages) expect(message).toContain("Content Security Policy");
  });

  /**
   * Waits until the page shows a copy of a recording that its script made: a second player (it has
   * no data-file) whose address is a blob: one and which has loaded far enough to know its length.
   * Nothing is played.
   */
  const copyLoaded = (page: Page): Promise<void> =>
    expect
      .poll(
        () =>
          page.evaluate(() => {
            const copy = document.querySelector<HTMLAudioElement>("audio:not([data-file])");
            return copy !== null && copy.src.startsWith("blob:") && copy.duration > 0;
          }),
        { timeout: 20_000 },
      )
      .toBe(true);

  it("runs its speed choice and its check under the policy, and the check matches its recordings", async () => {
    const page = await newPage();
    await visit(page, addressOf(VOICE_HREF));

    // The script showed each choice, and a choice makes a slowed copy in the page, which a second
    // player loads from its blob: address, while the first player is as it was, at the 0.3× it
    // starts at, the browser's own way.
    const group = page.locator("fieldset.speeds").first();
    await group.getByRole("radio", { name: "0.5×" }).check();
    await copyLoaded(page);
    expect(
      await page.evaluate(() => {
        const sound = document.querySelector<HTMLAudioElement>("audio[data-file]");
        return sound === null ? null : [sound.playbackRate, sound.preservesPitch, sound.paused];
      }),
    ).toEqual([0.3, true, true]);
    // The check reads each recording from its own address and hashes it, with nothing sent anywhere.
    await page.locator("#fp-run").click();
    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Checked just now, in this browser. " +
          "9 of 9 transcripts match their fingerprints, and " +
          "3 of 3 recordings match their fingerprints, and the run's seal checks out.",
      );
    await page.locator("#theme-toggle").click();
    expect(await violationsOf(page)).toEqual([]);
  });

  // Review Focus 4. The copy is played as the recordings are here: loaded from its blob: address,
  // which only the policy's media-src lets a page do, and measured, and never played.
  it("makes and plays a copy under its policy, with no violation", async () => {
    const page = await newPage();
    const policy = await visit(page, addressOf(VOICE_HREF));
    expect(policy).toContain("; media-src data: blob:;");

    // The page starts at 0.3×, and its copy is made when the first player is played: a play event
    // stands for a person pressing play, with no sound played.
    expect(
      await page.locator("fieldset.speeds").first().locator("input:checked").getAttribute("value"),
    ).toBe("0.3");
    await page
      .locator("audio[data-file]")
      .first()
      .evaluate((sound) => sound.dispatchEvent(new Event("play")));
    await copyLoaded(page);

    // It is a second player in view, from a blob: address, and never played.
    const copy = await page.evaluate(() => {
      const second = document.querySelector<HTMLAudioElement>("audio:not([data-file])");
      return second === null
        ? null
        : { address: second.src.slice(0, 5), hidden: second.hidden, paused: second.paused };
    });
    expect(copy).toEqual({ address: "blob:", hidden: false, paused: true });
    expect(await violationsOf(page)).toEqual([]);
  });

  it("is where the report's cards link to, at each page's section, from both the report's addresses", async () => {
    const page = await newPage();
    for (const where of [PAGE_HREF, PAGE_HREF.replace(/\.html$/, "")]) {
      await visit(page, addressOf(where));
      // Each recorded page's card links to its section of the voice page, and the details link to
      // the page itself: all in the share's own folder, as the report is.
      const links = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLAnchorElement>('a[href*=".voice.html"]')].map(
          (link) => link.href,
        ),
      );
      expect(links.length, where).toBeGreaterThanOrEqual(4);
      for (const link of links) {
        expect(link.startsWith(addressOf(VOICE_HREF)), `${where}: ${link}`).toBe(true);
      }
      // A page listed on a card of what needs attention links to its section too, so a section
      // may be linked from more than one place.
      const sections = [
        ...new Set(links.flatMap((link) => (link.includes("#") ? [link.split("#")[1] ?? ""] : []))),
      ];
      expect(sections).toHaveLength(3);
      // The page they lead to is there, under its policy, and each lands on a section of it that
      // has its player.
      const policy = await visit(page, addressOf(VOICE_HREF));
      expect(policy, where).toContain("; media-src data: blob:;");
      for (const section of sections) {
        expect(await page.locator(`article[id="${section}"] audio`).count(), section).toBe(1);
      }
      expect(await violationsOf(page), where).toEqual([]);
    }
  });

  it("is listed with the report's files on the site's page, as NVDA's voice, and opens there under its policy", async () => {
    const page = await newPage();
    await page.goto(voiceServer.url);

    // In the fold of the report's files, which a reader opens first; it's no download.
    for (const summary of await page.locator("summary").all()) await summary.click();
    const item = page.locator("li", { hasText: "NVDA's voice" });
    expect(await item.count()).toBe(1);
    expect(await item.locator(`a[href="${VOICE_HREF}"]`).getAttribute("download")).toBeNull();
    await Promise.all([
      page.waitForURL(addressOf(VOICE_HREF)),
      item.locator(`a[href="${VOICE_HREF}"]`).click(),
    ]);

    expect(await page.title()).toMatch(/^NVDA's voice: example\.illinois\.gov, /);
    const response = await page.request.get(addressOf(VOICE_HREF));
    expect(response.headers()["content-security-policy"]).toContain("; media-src data: blob:;");
    expect(response.headers()["content-disposition"]).toBeUndefined();
    expect(await violationsOf(page)).toEqual([]);
  });
});
