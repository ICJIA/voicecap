/// <reference lib="dom" />
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import {
  DEMO_CANONICAL,
  DEMO_PAGES,
  DEMO_SITE_DIR,
  startDemoServer,
  type DemoServer,
} from "../src/demo/server.js";
import { canonicalRootFrom } from "../src/pages/canonical.js";
import { fetchSitemap } from "../src/pages/sitemap.js";
import { inlineHashes } from "../src/site/headers.js";
import { packageRoot } from "../src/util/version.js";
import { launchBrowser, violations } from "./helpers/axe.js";

const MISTAKES = "/common-mistakes/";
const GOOD_PAGES = DEMO_PAGES.filter((page) => page !== MISTAKES);
/** The demo's canonical address: its pages are published inside voicecap's website, at /demo-site/. */
const CANONICAL = "https://voicecap.netlify.app/demo-site/";
/** The page the server gives for any address it has nothing at: it names no address of its own. */
const NOT_FOUND = "404.html";

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

/**
 * Every page of the demo site's folder, by its path from there with forward slashes, sorted: the
 * seven pages and the form's answer. The 404 page is the server's own, so it isn't one.
 */
async function pageFiles(): Promise<string[]> {
  const entries = await readdir(DEMO_SITE_DIR, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) =>
      path
        .relative(DEMO_SITE_DIR, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/"),
    )
    .filter((file) => file !== NOT_FOUND)
    .sort();
}

/** The address the server gives a page's file: a folder's index.html is the folder's own address. */
const localPath = (file: string): string => `/${file.replace(/(^|\/)index\.html$/, "$1")}`;

/** The value of each attribute of that name in a page's source, in order. */
function attributeValues(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, "g"))].map(([, value = ""]) => value);
}

/** The `<link rel="canonical">` tags of a page's source. */
const canonicalTags = (html: string): string[] =>
  html.match(/<link\b[^>]*\brel="canonical"[^>]*>/g) ?? [];

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

// The demo's canonical address is https://voicecap.netlify.app/demo-site/: the website publishes
// the demo's own pages there. Each page names its own address under it, so a run on the copy at
// this computer learns the real name, and its links are relative, so the pages work at either
// address.
describe("the demo site's addresses", () => {
  it("names its canonical address on every page, and each tag fits the page it is on", async () => {
    // The address the build publishes the pages at, and the sitemap it writes of them, is this one.
    expect(DEMO_CANONICAL).toBe(CANONICAL);
    const files = await pageFiles();
    // The seven pages, and the form's answer.
    expect(files).toHaveLength(DEMO_PAGES.length + 1);
    for (const file of files) {
      const html = await readFile(path.join(DEMO_SITE_DIR, file), "utf8");
      const tags = canonicalTags(html);
      expect(tags, file).toHaveLength(1);
      const [href] = attributeValues(tags[0] ?? "", "href");
      expect(href, file).toBe(`${CANONICAL}${localPath(file).slice(1)}`);
      // As voicecap reads it on the copy at this computer: the website's demo-site/ is the root.
      expect(canonicalRootFrom(`http://127.0.0.1:4848${localPath(file)}`, href ?? null), file).toBe(
        CANONICAL,
      );
    }
    // The values themselves, so that a rule above that went wrong can't make a wrong tag right.
    const tagOf = async (file: string) =>
      canonicalTags(await readFile(path.join(DEMO_SITE_DIR, file), "utf8"))[0];
    expect(await tagOf("index.html")).toBe(
      '<link rel="canonical" href="https://voicecap.netlify.app/demo-site/" />',
    );
    expect(await tagOf("before-you-start/index.html")).toBe(
      '<link rel="canonical" href="https://voicecap.netlify.app/demo-site/before-you-start/" />',
    );
    expect(await tagOf("ask-a-question/sent.html")).toBe(
      '<link rel="canonical" href="https://voicecap.netlify.app/demo-site/ask-a-question/sent.html" />',
    );
  });

  it("gives the 404 page no canonical address: the server gives it for any address", async () => {
    const html = await readFile(path.join(DEMO_SITE_DIR, NOT_FOUND), "utf8");

    expect(canonicalTags(html)).toEqual([]);
  });

  it("links no page root-relatively, except the 404 page, which the server gives at any depth", async () => {
    for (const file of await pageFiles()) {
      const html = await readFile(path.join(DEMO_SITE_DIR, file), "utf8");
      const addresses = [...attributeValues(html, "href"), ...attributeValues(html, "action")];
      expect(
        addresses.filter((address) => address.startsWith("/")),
        file,
      ).toEqual([]);
    }
    // It's given for an address at any depth, so its links go from the site's top.
    const notFound = await readFile(path.join(DEMO_SITE_DIR, NOT_FOUND), "utf8");
    expect(attributeValues(notFound, "href")).toEqual(["/style.css", "#main", "/"]);
  });

  it("links relatively: style.css and each page's folder from the home page, ../style.css and ../ from a page", async () => {
    const hrefs = async (file: string) =>
      attributeValues(await readFile(path.join(DEMO_SITE_DIR, file), "utf8"), "href");

    expect(await hrefs("index.html")).toEqual([
      CANONICAL,
      "style.css",
      "#main",
      "before-you-start/",
      "before-you-start/",
      "how-a-run-works/",
      "reading-transcripts/",
      "the-report/",
      "ask-a-question/",
      "common-mistakes/",
    ]);
    expect(await hrefs("before-you-start/index.html")).toEqual([
      `${CANONICAL}before-you-start/`,
      "../style.css",
      "#main",
      "../",
      "../how-a-run-works/",
    ]);
    expect(await hrefs("the-report/index.html")).toEqual([
      `${CANONICAL}the-report/`,
      "../style.css",
      "#main",
      "../reading-transcripts/",
      "../ask-a-question/",
    ]);
    expect(await hrefs("ask-a-question/sent.html")).toEqual([
      `${CANONICAL}ask-a-question/sent.html`,
      "../style.css",
      "#main",
      "../ask-a-question/",
      "../common-mistakes/",
    ]);
  });

  it("has every link, its style sheet, and its form lead to a file of the site, from any page", async () => {
    for (const file of await pageFiles()) {
      const html = await readFile(path.join(DEMO_SITE_DIR, file), "utf8");
      const [tag = ""] = canonicalTags(html);
      const [canonical] = attributeValues(tag, "href");
      const addresses = [...attributeValues(html, "href"), ...attributeValues(html, "action")]
        .filter((address) => address !== canonical)
        .filter((address) => !address.startsWith("#"));
      // At least its style sheet and a link.
      expect(addresses.length, file).toBeGreaterThanOrEqual(2);
      for (const address of addresses) {
        // No scheme and no host: the address is a path from the page, wherever the page is.
        expect(address, `${file}: ${address}`).not.toMatch(/^(?:[a-z][a-z0-9+.-]*:|\/)/i);
        const target = new URL(address, new URL(localPath(file), server.origin));
        expect((await fetch(target)).status, `${file}: ${address}`).toBe(200);
      }
    }
  });

  it("holds no code of its own, so the policy it is published under needs no hashes", async () => {
    for (const file of [...(await pageFiles()), NOT_FOUND]) {
      const html = await readFile(path.join(DEMO_SITE_DIR, file), "utf8");
      expect(inlineHashes(html), file).toEqual({ styles: [], scripts: [] });
      expect(html, file).not.toMatch(/\sstyle\s*=/i);
    }
  });

  // A static host can't answer a post, so the form is a GET to a page that's a file, which the
  // server gives here, and the website gives there.
  it("answers the question form with sent.html, as a file", async () => {
    const page = await open("/ask-a-question/");
    expect(
      await page
        .locator("form")
        .evaluate((form) => [form.getAttribute("method"), form.getAttribute("action")]),
    ).toEqual(["get", "sent.html"]);

    await page.fill("#question", "Does this go anywhere?");
    await page.click("button[type=submit]");
    await page.waitForURL(/\/ask-a-question\/sent\.html\?/);

    const answered = new URL(page.url());
    expect([answered.origin, answered.pathname]).toEqual([
      server.origin,
      "/ask-a-question/sent.html",
    ]);
    expect(await page.title()).toBe("Practice form | voicecap demo");
    await close(page);
  });
});

// The same pages are read on this computer and on the website, so what they say of where the demo
// runs, and of what the form does with what a visitor types, has to be true at both.
describe("the demo site's words", () => {
  const FOOTER = "This demo site comes with voicecap, for trying it out.";
  const NOTE =
    "This is a practice form: sending it only shows a thank-you page, so don't type anything private.";

  it("ends every page, the 404 page too, with a footer that is true wherever the demo is served", async () => {
    const pages = [...DEMO_PAGES, "/ask-a-question/sent.html", "/no-such-page/"];
    expect(pages).toHaveLength(9);
    for (const pagePath of pages) {
      const page = await open(pagePath);
      expect(await page.locator("footer").innerText(), pagePath).toBe(FOOTER);
      await close(page);
    }
  });

  it("tells whoever is at the question form that it is for practice, and not to type anything private", async () => {
    const page = await open("/ask-a-question/");
    const notes = await page.locator("main p").allInnerTexts();

    expect(notes).toContain(NOTE);
    expect(notes.join(" ")).not.toContain("Nothing you type is sent anywhere");
    await close(page);
  });

  it("tells whoever is at the form's answer that the form is for practice, in its title and its heading, and not that nothing was sent", async () => {
    const page = await open("/ask-a-question/sent.html");

    expect(await page.title()).toBe("Practice form | voicecap demo");
    expect(await page.locator("h1").allInnerTexts()).toEqual([
      "This is a practice form, so no one will answer it.",
    ]);
    expect(await page.locator("body").innerText()).not.toContain("Nothing was sent");
    await close(page);
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
    await page.waitForFunction(() => document.title.startsWith("Practice form"));
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
