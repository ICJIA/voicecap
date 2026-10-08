/**
 * The website's page, from what's published (src/site/render.ts): one file with one style block and
 * one script, its headings in order, each site's current report with its links, its earlier ones a
 * line each, every report's files in a fold, what isn't there, and every report by date when two
 * sites or more have reports. The content is small (test/helpers/site-content.ts): a demo, two
 * sites with three reports, a Word copy that isn't published, and a report with no walkthrough file.
 *
 * The bar, the footer, and the shell that every page of the website shares (src/site/frame.ts) are
 * here too: the bar of this page and of the trust page, whose last link is the one to the trust page.
 *
 * What the page does in a browser is in test/site-page-browser.test.ts.
 */
import { createHash } from "node:crypto";
import vm from "node:vm";

import { beforeAll, describe, expect, it } from "vitest";

import { DEMO_CANONICAL } from "../src/demo/server.js";
import { fontFaceCss } from "../src/share/fonts.js";
import { SHARE_SCRIPT } from "../src/share/html/client.js";
import { SHARE_CSS, THEME_CSS } from "../src/share/html/style.js";
import { ABOUT } from "../src/share/text.js";
import { SITE_SCRIPT } from "../src/site/client.js";
import { siteBar, siteFooter, sitePage } from "../src/site/frame.js";
import { inlineHashes } from "../src/site/headers.js";
import {
  fileKind,
  type PublishedReport,
  renderSiteIndex,
  type SiteContent,
} from "../src/site/render.js";
import { SITE_CSS } from "../src/site/style.js";
import { SITE_TEXT } from "../src/site/text.js";
import { decode, summariesIn, textOf } from "./helpers/share-html.js";
import {
  CONTENT,
  DEMO_REPORT,
  DVFR,
  DVFR_ADDRESS,
  DVFR_NEWEST,
  DVFR_OLDEST,
  EXAMPLE,
  EXAMPLE_REPORT,
  filesOf,
  fingerprintOf,
  published,
  reportsOf,
} from "./helpers/site-content.js";

const GITHUB = "https://github.com/ICJIA/voicecap";
/** Where the build publishes the demo's own pages, from the site's top: a relative link goes there. */
const DEMO_PAGES_HREF = "demo-site/";
/** Where the build publishes the trust page, beside this one: a relative link goes there. */
const TRUST_PAGE_HREF = "trust.html";
/** The words of the bar's last link, which goes to the trust page. */
const TRUST_WORDS = "Can I trust this?";

const NO_FONTS = { fontCss: "" };

/** How a policy names the hash of `text`: 'sha256-' and its SHA-256 as base64, in single quotes. */
function hashOf(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/** `text` as a pattern that matches only it. */
function patternOf(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The page with its fonts' data left out: base64 is letters, and could spell anything. */
function withoutFontData(html: string): string {
  return html.replace(/data:font\/woff2;base64,[A-Za-z0-9+/=]+/g, "data:font/woff2;base64,");
}

/** The page's markup, with what its style and script elements hold left out. */
function markupOf(html: string): string {
  return html
    .replace(/(<style>)[\s\S]*?(<\/style>)/g, "$1$2")
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/g, "$1$2");
}

/** The text of each element of a kind in some markup, in order, as a reader gets it. */
function textsOf(html: string, tag: string): string[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map(
    ([, inner = ""]) => textOf(inner, ""),
  );
}

/** The names of the elements, and of the attributes, that some markup has. */
function namesIn(markup: string): { elements: string[]; attributes: string[] } {
  const elements = new Set<string>();
  const attributes = new Set<string>();
  for (const [, element = "", rest = ""] of markup.matchAll(
    /<([a-z][a-z0-9]*)((?:"[^"]*"|[^>"])*)>/gi,
  )) {
    elements.add(element.toLowerCase());
    // With each quoted value emptied, what's left of a tag is its attributes' names.
    for (const [, name = ""] of rest.replace(/"[^"]*"/g, '""').matchAll(/([a-z][a-z-]*)/gi)) {
      attributes.add(name.toLowerCase());
    }
  }
  return { elements: [...elements].sort(), attributes: [...attributes].sort() };
}

/** Each article's markup, by its id. An article holds no other. */
function articlesOf(html: string): Map<string, string> {
  return new Map(
    [...html.matchAll(/<article\b[^>]*\bid="([^"]*)"[^>]*>([\s\S]*?)<\/article>/g)].map(
      ([, id = "", inner = ""]): [string, string] => [id, inner],
    ),
  );
}

/** One article's markup. */
function articleOf(html: string, id: string): string {
  const article = articlesOf(html).get(id);
  if (article === undefined) throw new Error(`The page has no article ${id}.`);
  return article;
}

/** A section's opening tag. */
function openingOf(html: string, id: string): RegExpExecArray {
  const opening = new RegExp(`<section\\b[^>]*\\bid="${patternOf(id)}"[^>]*>`).exec(html);
  if (opening === null) throw new Error(`The page has no section ${id}.`);
  return opening;
}

/** A section's markup, from its opening tag to its closing one, whatever sections are inside it. */
function sectionOf(html: string, id: string): string {
  const opening = openingOf(html, id);
  const tags = /<(\/?)section\b/g;
  tags.lastIndex = opening.index + opening[0].length;
  let depth = 1;
  for (let tag = tags.exec(html); tag !== null; tag = tags.exec(html)) {
    depth += tag[1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(opening.index, html.indexOf(">", tag.index) + 1);
  }
  throw new Error(`The section ${id} never ends.`);
}

/** Each link: its address, as a reader gets it, and whether it downloads. */
function linksOf(html: string): { href: string; download: boolean }[] {
  return [...html.matchAll(/<a\b([^>]*)>/g)].map(([, tag = ""]) => ({
    href: decode(/\shref="([^"]*)"/.exec(tag)?.[1] ?? ""),
    download: /\sdownload(?=[\s=]|$)/.test(tag),
  }));
}

/** The text of each file's item in a report, as a reader gets it. */
const filesIn = (article: string): string[] => textsOf(article, "li");

/** Some markup without the words only a screen reader gets: what a reader sees. */
function withoutHidden(html: string): string {
  return html.replace(/<span class="sr">[\s\S]*?<\/span>/g, "");
}

/**
 * Each block of the folds of files in some markup, in order: one for each report, with when it was
 * shared, who prepared it, its files, and what isn't here.
 */
function sharedBlocksOf(html: string): string[] {
  return [...html.matchAll(/<div class="shared">([\s\S]*?)<\/div>/g)].map(
    ([, inner = ""]) => inner,
  );
}

/** The ids of the reports in some markup, in order: each current report's, and each earlier one's. */
function reportIdsOf(html: string): string[] {
  return [...html.matchAll(/<(?:article class="report"|li) id="([^"]*)"/g)].map(
    ([, id = ""]) => id,
  );
}

/** Each item of the lists of earlier reports in some markup, as markup. */
function earlierItemsOf(html: string): string[] {
  return [...html.matchAll(/<ul class="earlier"[^>]*>([\s\S]*?)<\/ul>/g)].flatMap(([, list = ""]) =>
    [...list.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)].map(([item]) => item),
  );
}

/** The bar's navigation. */
const barOf = (markup: string): string => /<nav\b[\s\S]*?<\/nav>/.exec(markup)?.[0] ?? "";

/**
 * What heads a view's section, or a site's: its title row (its picture and its heading), then what's
 * beside it. The head is one line of the page's markup.
 */
function headOf(html: string, kind: "view" | "site"): string {
  return new RegExp(`<div class="${kind}-head">(.*)</div>`).exec(html)?.[1] ?? "";
}

/** The sites' names in a list of reports by date, as the list gives them. */
function namesByDate(html: string): (string | undefined)[] {
  return textsOf(sectionOf(html, "by-date"), "li").map((item) => item.split(", ")[2]);
}

/** A report that was shared at `at`: only what its place by date needs. */
function reportAt(folder: string, at: string, by = "Pat Lee"): PublishedReport {
  return {
    folder,
    id: `report-${folder}-1`,
    at,
    by,
    files: [published("page", folder, `${folder}_page.html`, 10)],
    notPublished: [],
  };
}

/**
 * A content of one site with one report each of these folders, which were shared at these times.
 * Each site is named for its folder, as a site with no canonical address is.
 */
function sitesAt(...shared: [folder: string, at: string][]): SiteContent {
  return {
    demo: null,
    sites: shared.map(([folder, at]) => ({
      name: folder,
      folders: [folder],
      reports: [reportAt(folder, at)],
    })),
  };
}

describe("renderSiteIndex", () => {
  let html: string;
  let fontCss: string;

  beforeAll(async () => {
    html = renderSiteIndex(CONTENT, NO_FONTS);
    fontCss = await fontFaceCss();
  });

  it("is one file: one style block, one script last, no style attribute, nothing from outside", () => {
    const page = renderSiteIndex(CONTENT, { fontCss });
    const plain = withoutFontData(page);

    expect(plain.match(/<style\b/g)).toHaveLength(1);
    expect(plain.match(/<script\b/g)).toHaveLength(1);
    // The script is the last thing in the page.
    expect(page).toMatch(/<\/script>\n<\/body>\n<\/html>\n$/);
    expect(plain).not.toMatch(/\sstyle\s*=/i);
    // Nothing is loaded, linked, or framed, and the fonts are the file's own data.
    for (const outside of ["src=", "srcset", "<link", "<iframe", "@import", "url(http"]) {
      expect(plain, outside).not.toContain(outside);
    }
    expect(plain.match(/url\(/g)).toHaveLength(9);
    expect(plain.match(/url\(data:font\/woff2;base64,/g)).toHaveLength(9);
    // Its own code is what a Content Security Policy hashes: the one style block, and the one script.
    expect(inlineHashes(page)).toEqual({
      styles: [hashOf(`\n${fontCss}\n${SITE_CSS}`)],
      scripts: [hashOf(SITE_SCRIPT)],
    });
    // The commands are in <code>, so no backtick is in the page.
    expect(plain).not.toContain("`");
  });

  it("is a page with a language, a title, and a meta tag that keeps it out of search results", () => {
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">\n<head>\n/);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow, noarchive">');
    expect(html).toContain("<title>Screen reader test results</title>");
    // In order: the charset, the viewport, the robots meta, the title, then the one style block.
    const places = ["<meta charset", 'name="viewport"', 'name="robots"', "<title>", "<style>"].map(
      (part) => html.indexOf(part),
    );
    expect(places.every((place) => place > 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
  });

  it("links only to its files, its own anchors, the trust page, the demo's pages, voicecap's GitHub page, and each site's own address", () => {
    const links = linksOf(html);
    const files = filesOf(CONTENT);
    const anchors = ["#main", "#demo", "#sites", "#by-date"];
    const allowed = [
      ...anchors,
      TRUST_PAGE_HREF,
      DEMO_PAGES_HREF,
      GITHUB,
      DVFR_ADDRESS,
      ...files.map(({ href }) => href),
    ];

    expect(links.filter(({ href }) => !allowed.includes(href))).toEqual([]);
    // Each anchor lands on something in the page, and each published file is offered.
    for (const anchor of anchors) expect(html, anchor).toContain(`id="${anchor.slice(1)}"`);
    const offered = links.map((link) => link.href);
    for (const { href } of files) expect(offered, href).toContain(href);
    // The page opens in the browser. The Word copy, a walkthrough file, and any other are
    // downloaded.
    for (const { href, kind } of files) {
      for (const link of links.filter((each) => each.href === href)) {
        expect(link.download, href).toBe(kind !== "page");
      }
    }
    for (const extension of [".docx", ".json", ".html"]) {
      const these = links.filter(({ href }) => href.endsWith(extension));
      expect(these.length, extension).toBeGreaterThan(0);
      for (const link of these) expect(link.download, link.href).toBe(extension !== ".html");
    }
    // A file that isn't here isn't offered.
    expect(html).not.toContain(`${DVFR}_2026-09-29.docx"`);
    expect(html).not.toContain(`${EXAMPLE}_2026-10-02.docx"`);
  });

  it("puts its headings in order", () => {
    const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map(
      ([, level = "", inner = ""]): [number, string] => [Number(level), textOf(inner, "")],
    );

    // A site's current report is headed by its date, and its earlier ones by one heading: they're
    // a line each. Their files are in a fold, with no heading.
    expect(headings).toEqual([
      [1, "Screen reader test results"],
      [2, "The demo"],
      [3, "The current report 29 September 2026, 15:40"],
      [2, "The sites"],
      [3, DVFR],
      [4, "The current report 3 October 2026, 14:05"],
      [4, "Earlier reports"],
      [3, EXAMPLE],
      [4, "The current report 2 October 2026, 09:30"],
      [2, "Every report, by date"],
    ]);
    // None skips a level on the way down.
    const levels = headings.map(([level]) => level);
    levels.forEach((level, index) => {
      expect(level - (levels[index - 1] ?? 0), headings[index]?.[1]).toBeLessThanOrEqual(1);
    });
  });

  it("names each view's section by its heading, and gives a site's section no name, so a site is no landmark", () => {
    for (const id of ["demo", "sites", "by-date"]) {
      const labelled = /\saria-labelledby="([^"]*)"/.exec(openingOf(html, id)[0])?.[1];
      expect(labelled, id).toEqual(expect.any(String));
      // The first heading in the section is an h2, and it's the one that names it.
      const heading = /<h([1-6]) id="([^"]*)"/.exec(sectionOf(html, id));
      expect(heading?.[1], id).toBe("2");
      expect(heading?.[2], id).toBe(labelled);
    }
    // A named section is a region of its own, and with many sites that is a long list of landmarks.
    // A site's heading, an h3, already leads to it.
    for (const folder of [DVFR, EXAMPLE]) {
      const id = `site-${folder}`;
      expect(openingOf(html, id)[0], id).not.toMatch(/\saria-label(?:ledby)?=/);
      expect(/<h([1-6])\b/.exec(sectionOf(html, id))?.[1], id).toBe("3");
    }
    // The three views are named by their headings, and the bar's navigation by its label: no more.
    expect(html.match(/\saria-labelledby=/g)).toHaveLength(3);
    expect(html.match(/\saria-label=/g)).toHaveLength(1);
  });

  it("heads a site by its name, which needn't be a folder's, and makes its section's id from the name", () => {
    const page = renderSiteIndex(
      {
        demo: null,
        sites: [
          {
            name: "voicecap.netlify.app",
            folders: ["127.0.0.1_4848"],
            reports: [reportAt("127.0.0.1_4848", "2026-10-03T10:00:00-05:00")],
          },
          {
            // A name with a port: its id is made as a folder's name is, with "_" for the colon.
            name: "dvfr.illinois.gov:8443",
            folders: ["localhost_3000"],
            reports: [reportAt("localhost_3000", "2026-10-02T10:00:00-05:00")],
          },
        ],
      },
      NO_FONTS,
    );

    expect(textsOf(sectionOf(page, "sites"), "h3")).toEqual([
      "voicecap.netlify.app",
      "dvfr.illinois.gov:8443",
    ]);
    for (const [id, name] of [
      ["site-voicecap.netlify.app", "voicecap.netlify.app"],
      ["site-dvfr.illinois.gov_8443", "dvfr.illinois.gov:8443"],
    ] as const) {
      expect(textsOf(sectionOf(page, id), "h3")[0], id).toBe(name);
    }
    // No section is made from a folder's name. A folder's name is only where its files are.
    expect(page).not.toContain('id="site-127.0.0.1_4848"');
    expect(page).not.toContain('id="site-localhost_3000"');
    // The report's page, linked from the current report and from the fold of files.
    expect(linksOf(sectionOf(page, "site-voicecap.netlify.app")).map(({ href }) => href)).toEqual([
      "127.0.0.1_4848/127.0.0.1_4848_page.html",
      "127.0.0.1_4848/127.0.0.1_4848_page.html",
    ]);
    // A screen reader hears each report's links named by the site's name, not its folder's.
    expect(textsOf(sectionOf(page, "site-voicecap.netlify.app"), "a")[0]).toBe(
      "Open the report of voicecap.netlify.app, 3 October 2026, 10:00",
    );
  });

  it("shows the reports of a site's folders under the site's one heading, as it was given them", () => {
    const folders = ["127.0.0.1_4848", DVFR];
    const reports = [
      { ...reportAt(DVFR, "2026-10-04T10:00:00-05:00"), id: `report-${DVFR}-2` },
      reportAt("127.0.0.1_4848", "2026-10-03T10:00:00-05:00"),
      reportAt(DVFR, "2026-10-02T10:00:00-05:00"),
    ];
    const page = renderSiteIndex(
      { demo: null, sites: [{ name: DVFR, folders, reports }] },
      NO_FONTS,
    );

    expect(textsOf(sectionOf(page, "sites"), "h3")).toEqual([DVFR]);
    const site = sectionOf(page, `site-${DVFR}`);
    // The first is the current report, and the others are the earlier ones, in the order given.
    expect([...articlesOf(site).keys()]).toEqual([reports[0]?.id]);
    expect(reportIdsOf(site)).toEqual(reports.map(({ id }) => id));
    // One count, from 0.13.1: beside the earlier reports' heading, how many they are, for the eye.
    expect(site.match(/class="count"/g)).toHaveLength(1);
    expect(site).toContain('<span class="count" aria-hidden="true">2</span>');
    // Each report's files are at its own folder's address: the current one's link and each
    // earlier one's, then each in the fold, in the same order.
    const pages = reports.map(({ folder }) => `${folder}/${folder}_page.html`);
    expect(linksOf(site).map(({ href }) => href)).toEqual([...pages, ...pages]);
  });

  it("shows every report it's given: keeping a site's newest is the build's to do", () => {
    const reports = Array.from({ length: 5 }, (_, index) => ({
      ...reportAt(DVFR, `2026-10-0${5 - index}T10:00:00-05:00`),
      id: `report-${DVFR}-${5 - index}`,
    }));
    const page = renderSiteIndex(
      { demo: null, sites: [{ name: DVFR, folders: [DVFR], reports }] },
      NO_FONTS,
    );

    const site = sectionOf(page, `site-${DVFR}`);
    expect(reportIdsOf(site)).toEqual(reports.map(({ id }) => id));
    expect(earlierItemsOf(site)).toHaveLength(4);
    expect(sharedBlocksOf(site)).toHaveLength(5);
  });

  it("gives every id once, whatever the sites are named", () => {
    const page = renderSiteIndex(
      {
        ...sitesAt(
          ["x", "2026-10-03T10:00:00-05:00"],
          ["x-h", "2026-10-02T10:00:00-05:00"],
          ["demo-h", "2026-10-01T10:00:00-05:00"],
          ["sites", "2026-09-30T10:00:00-05:00"],
        ),
        demo: DEMO_REPORT,
      },
      NO_FONTS,
    );
    const ids = [...page.matchAll(/\sid="([^"]*)"/g)].map(([, id = ""]) => id);

    expect(ids.length).toBeGreaterThan(15);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    // Each id a label names is in the page.
    const named = [...page.matchAll(/\saria-labelledby="([^"]*)"/g)].map(([, id = ""]) => id);
    expect(named).toHaveLength(3);
    for (const id of named) expect(ids, id).toContain(id);
  });

  it("gives each site an id of its own when two names are the same once made safe", () => {
    // "example.gov:8080" is made safe as "example.gov_8080", which is the name of the folder a run
    // of that site makes, and a name can end in "-2" too.
    const names = ["example.gov:8080", "example.gov_8080", "example.gov_8080-2"];
    const page = renderSiteIndex(
      {
        demo: null,
        sites: names.map((name, index) => ({
          name,
          folders: [`folder-${index}`],
          reports: [reportAt(`folder-${index}`, "2026-10-03T10:00:00-05:00")],
        })),
      },
      NO_FONTS,
    );

    const sites = [...page.matchAll(/<section class="site" id="([^"]*)">/g)].map(
      ([, id = ""]) => id,
    );
    expect(sites).toEqual([
      "site-example.gov_8080",
      "site-example.gov_8080-2",
      "site-example.gov_8080-2-2",
    ]);
    // Each leads to the site it was made for.
    expect(sites.map((id) => textsOf(sectionOf(page, id), "h3")[0])).toEqual(names);
    const ids = [...page.matchAll(/\sid="([^"]*)"/g)].map(([, id = ""]) => id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it("lists each report's files with their labels, sizes, and fingerprints, in its site's fold", () => {
    const item = (label: string, name: string, size: string) =>
      `${label} ${name} ${size}, SHA-256 ${fingerprintOf(name)}`;
    const [demo] = sharedBlocksOf(sectionOf(html, "demo"));
    const [newest, oldest] = sharedBlocksOf(sectionOf(html, `site-${DVFR}`));
    const [example] = sharedBlocksOf(sectionOf(html, `site-${EXAMPLE}`));

    expect(filesIn(demo ?? "")).toEqual([
      item("The report, to open", "127.0.0.1_4848_2026-09-29.html", "311 KB"),
      item("The Word copy", "127.0.0.1_4848_2026-09-29.docx", "47 KB"),
      item(
        "The walkthrough file of run 2026-09-29_1315",
        "127.0.0.1_4848_2026-09-29_2026-09-29_1315_walkthrough.json",
        "4 KB",
      ),
    ]);
    expect(filesIn(newest ?? "")).toEqual([
      item("The report, to open", `${DVFR}_2026-10-03.html`, "324 KB"),
      item("The Word copy", `${DVFR}_2026-10-03.docx`, "51 KB"),
      item(
        "The walkthrough file of run 2026-10-03_1330",
        `${DVFR}_2026-10-03_2026-10-03_1330_walkthrough.json`,
        "5 KB",
      ),
    ]);
    // Only what's published is listed.
    expect(filesIn(oldest ?? "")).toEqual([
      item("The report, to open", `${DVFR}_2026-09-29.html`, "296 KB"),
    ]);
    // A walkthrough file whose run isn't known, and a file of another kind, are named for what
    // they are.
    expect(filesIn(example ?? "")).toEqual([
      item("The report, to open", `${EXAMPLE}_2026-10-02.html`, "270 KB"),
      item(
        "The walkthrough file of run 2026-10-01_1100",
        `${EXAMPLE}_2026-10-02_2026-10-01_1100_walkthrough.json`,
        "3 KB",
      ),
      item("A walkthrough file", `${EXAMPLE}_2026-10-02_older_walkthrough.json`, "2 KB"),
      item("A file", `${EXAMPLE}_2026-10-02_summary.pdf`, "88 KB"),
    ]);
    // A fingerprint is in <code>, and each link is named by its file's name.
    expect([...(newest ?? "").matchAll(/<code>(.*?)<\/code>/g)].map(([, code]) => code)).toEqual(
      DVFR_NEWEST.files.map(({ sha256 }) => sha256),
    );
    expect(textsOf(newest ?? "", "a")).toEqual(DVFR_NEWEST.files.map(({ name }) => name));
  });

  it("folds every report's files and fingerprints into one fold for each site, closed, and one for the demo", () => {
    for (const id of ["demo", `site-${DVFR}`, `site-${EXAMPLE}`]) {
      const section = sectionOf(html, id);
      // Closed: a fold with no open attribute, named for what's in it.
      expect(section.match(/<details\b[^>]*>/g), id).toEqual(['<details class="fold">']);
      expect(summariesIn(section), id).toEqual(["Files and fingerprints, to check a copy"]);
      // Last in its section: after the current report, and after the earlier ones.
      expect(section, id).toMatch(/<\/details>\n<\/section>$/);
    }
    // A block for each report, in the order given, the newest first: each opens with when it was
    // shared, and who prepared it.
    const opening = (id: string) =>
      sharedBlocksOf(sectionOf(html, id)).map((block) => textsOf(block, "p")[0]);
    expect(opening(`site-${DVFR}`)).toEqual([
      "3 October 2026, 14:05, prepared by Pat Lee",
      "29 September 2026, 16:20, prepared by Pat Lee",
    ]);
    expect(opening(`site-${EXAMPLE}`)).toEqual(["2 October 2026, 09:30, prepared by Sam Rivera"]);
    expect(opening("demo")).toEqual(["29 September 2026, 15:40, prepared by Sam Demo"]);
    expect(sharedBlocksOf(sectionOf(html, `site-${DVFR}`))[0]).toContain(
      '<time datetime="2026-10-03T14:05:00-05:00">3 October 2026, 14:05</time>',
    );
  });

  it("leads each site with its current report: its date, who prepared it, and links to open its page and download its Word copy", () => {
    const article = articleOf(html, DVFR_NEWEST.id);
    const of = ` of ${DVFR}, 3 October 2026, 14:05`;

    expect(textsOf(article, "h4")).toEqual(["The current report 3 October 2026, 14:05"]);
    expect(article).toContain(
      '<h4><span class="label">The current report</span> <time datetime="2026-10-03T14:05:00-05:00">3 October 2026, 14:05</time></h4>',
    );
    expect(textsOf(article, "p")).toEqual([
      "Prepared by Pat Lee",
      `Open the report${of} Download the Word copy${of}`,
    ]);
    // The page opens in the browser, and the Word copy is downloaded. The walkthrough files are
    // only in the fold.
    expect(linksOf(article)).toEqual([
      { href: `${DVFR}/${DVFR}_2026-10-03.html`, download: false },
      { href: `${DVFR}/${DVFR}_2026-10-03.docx`, download: true },
    ]);
    expect(article).toContain('<p class="actions"><a class="action" href=');
    // What a reader sees of each link is its words. A screen reader hears the site and the date
    // after them too, so no two links on the page read alike.
    expect(textsOf(withoutHidden(article), "a")).toEqual([
      "Open the report",
      "Download the Word copy",
    ]);
    expect(article).toContain(`Open the report<span class="sr">${of}</span></a>`);

    // The demo's is the same, a level up, under the demo's heading, and named for the demo.
    const demo = articleOf(html, DEMO_REPORT.id);
    expect(textsOf(demo, "h3")).toEqual(["The current report 29 September 2026, 15:40"]);
    expect(textsOf(demo, "a")).toEqual([
      "Open the report of the demo, 29 September 2026, 15:40",
      "Download the Word copy of the demo, 29 September 2026, 15:40",
    ]);
  });

  // 0.13.1: each site's heading leads to the site itself, at the address its records give.
  it("links a site to the site itself beside its heading, and a site known by its folder alone to nothing", () => {
    const head = headOf(sectionOf(html, `site-${DVFR}`), "site");

    expect(textsOf(head, "h3")).toEqual([DVFR]);
    expect(linksOf(head)).toEqual([{ href: DVFR_ADDRESS, download: false }]);
    // After the site's name. What a reader sees of the link is its words, and a screen reader hears
    // the site's name after them, so no two sites' links read alike.
    expect(head.indexOf("<a ")).toBeGreaterThan(head.indexOf("</h3>"));
    expect(textsOf(withoutHidden(head), "a")).toEqual(["Visit the site"]);
    expect(textsOf(head, "a")).toEqual([`Visit the site at ${DVFR}, in a new tab`]);
    // It opens the site in a new tab, so a reader can go between the report and the site, and the
    // site gets no hold on this page.
    expect(head).toMatch(
      /<a class="visit" href="[^"]*" target="_blank" rel="noopener noreferrer">/,
    );
    // The other site's records give no address people visit: its heading stands alone.
    const other = headOf(sectionOf(html, `site-${EXAMPLE}`), "site");
    expect(textsOf(other, "h3")).toEqual([EXAMPLE]);
    expect(linksOf(other)).toEqual([]);
  });

  it("links a site only to the root of a web site, as a record gives one, at the host its heading names", () => {
    const withAddress = (address: string, name = DVFR): string =>
      headOf(
        sectionOf(
          renderSiteIndex(
            {
              demo: null,
              sites: [{ name, folders: [DVFR], reports: [DVFR_NEWEST], address }],
            },
            NO_FONTS,
          ),
          `site-${name}`,
        ),
        "site",
      );

    // A site at a path of its host is a root too.
    const demo = "https://voicecap.netlify.app/demo-site/";
    expect(linksOf(withAddress(demo, "voicecap.netlify.app"))).toEqual([
      { href: demo, download: false },
    ]);
    // A root at another host than the heading names would send its reader to another site.
    expect(linksOf(withAddress(demo))).toEqual([]);
    for (const address of [
      "javascript:alert(1)",
      "ftp://dvfr.illinois.gov/",
      "dvfr.illinois.gov",
      "https://dvfr.illinois.gov/about",
      "https://dvfr.illinois.gov/?q=1",
      "https://user:secret@dvfr.illinois.gov/",
      'https://dvfr.illinois.gov/"><b>x</b>/',
      // An address on a tester's computer is no site's name, and no reader can visit it.
      "http://127.0.0.1:4848/",
      "http://localhost:3000/",
    ]) {
      const head = withAddress(address);
      expect(linksOf(head), address).toEqual([]);
      expect(textsOf(head, "h3"), address).toEqual([DVFR]);
    }
  });

  it("puts a picture before each view's heading, which a screen reader skips, and says beside it how many sites, and reports, it holds", () => {
    for (const id of ["demo", "sites", "by-date"]) {
      expect(headOf(sectionOf(html, id), "view"), id).toMatch(
        /^<div class="title"><svg\b[^>]*\saria-hidden="true"[^>]*>[\s\S]*?<\/svg><h2 id="heading-[^"]*">[^<]*<\/h2><\/div>/,
      );
    }
    // The number is the count's big part, and its word follows it, so a screen reader hears both.
    expect(headOf(sectionOf(html, "sites"), "view")).toContain(
      '</div><span class="count"><b>2</b> sites</span>',
    );
    // In words, after the heading, which keeps its own: two sites, and their three reports by
    // date. The demo is one report, of no site.
    expect(textsOf(headOf(sectionOf(html, "sites"), "view"), "span")).toEqual(["2 sites"]);
    expect(textsOf(headOf(sectionOf(html, "by-date"), "view"), "span")).toEqual(["3 reports"]);
    expect(headOf(sectionOf(html, "demo"), "view")).not.toContain("<span");
    // One of each is one.
    const one = renderSiteIndex(sitesAt([DVFR, "2026-10-03T14:05:00-05:00"]), NO_FONTS);
    expect(textsOf(headOf(sectionOf(one, "sites"), "view"), "span")).toEqual(["1 site"]);
    // With no report shared, there's nothing to count.
    const none = renderSiteIndex({ demo: null, sites: [] }, NO_FONTS);
    expect(headOf(sectionOf(none, "sites"), "view")).not.toContain("<span");
  });

  it("puts a picture before each site's name, which a screen reader skips, in a row of their own", () => {
    for (const folder of [DVFR, EXAMPLE]) {
      expect(headOf(sectionOf(html, `site-${folder}`), "site"), folder).toMatch(
        /^<div class="title"><svg\b[^>]*\saria-hidden="true"[^>]*>[\s\S]*?<\/svg><h3>[^<]*<\/h3><\/div>/,
      );
    }
  });

  it("counts a site's earlier reports beside their heading, for the eye: their list says how many to a screen reader", () => {
    const withEarlier = (...earlier: PublishedReport[]): string =>
      sectionOf(
        renderSiteIndex(
          {
            demo: null,
            sites: [{ name: DVFR, folders: [DVFR], reports: [DVFR_NEWEST, ...earlier] }],
          },
          NO_FONTS,
        ),
        `site-${DVFR}`,
      );
    const head = (site: string): string =>
      /<div class="sub-head">([\s\S]*?)<\/div>/.exec(site)?.[1] ?? "";

    expect(head(withEarlier(DVFR_OLDEST))).toBe(
      '<h4>Earlier reports</h4><span class="count" aria-hidden="true">1</span>',
    );
    expect(head(withEarlier(DVFR_OLDEST, { ...DVFR_OLDEST, id: `report-${DVFR}-0` }))).toBe(
      '<h4>Earlier reports</h4><span class="count" aria-hidden="true">2</span>',
    );
  });

  // 0.12.3: what a manager asks first, "did it pass?", answered on the card, from what the share
  // recorded of its copies. From 0.13.1 the verdict's headline is a pill, and how many pages NVDA
  // read is a bar with its words beside it.
  describe("the verdict on the current report's card", () => {
    /** The card of a site whose only report records `result`. */
    const cardWith = (result: PublishedReport["result"]): string =>
      articleOf(
        renderSiteIndex(
          {
            demo: null,
            sites: [{ name: DVFR, folders: [DVFR], reports: [{ ...DVFR_NEWEST, result }] }],
          },
          NO_FONTS,
        ),
        DVFR_NEWEST.id,
      );
    /** The card's verdict line: its markup, or null when it has none. */
    const verdictOf = (card: string): string | null =>
      /<p class="verdict [^"]*">[\s\S]*?<\/p>/.exec(card)?.[0] ?? null;
    /** The card's line of the pages NVDA read: its bar's markup, and its words. Null when it has none. */
    const readingOf = (card: string): { bar: string; words: string } | null => {
      const reading = /<div class="reading">(<svg\b[\s\S]*?<\/svg>)<p>([\s\S]*?)<\/p><\/div>/.exec(
        card,
      );
      return reading === null ? null : { bar: reading[1] ?? "", words: textOf(reading[2] ?? "") };
    };
    /** What a bar draws: each part's kind and width. */
    const partsOf = (bar: string): { kind: string; width: string }[] =>
      [...bar.matchAll(/<rect class="c-([a-z]+)"[^>]*\swidth="([^"]*)"/g)].map(
        ([, kind = "", width = ""]) => ({ kind, width }),
      );

    it("says nothing needs attention, as ok, when no problem is left and every page was read", () => {
      const card = cardWith({ pages: 9, read: 9, problems: 0, problemPages: 0 });

      expect(verdictOf(card)).toBe('<p class="verdict ok">Nothing needs attention</p>');
      expect(readingOf(card)?.words).toBe("NVDA read all 9 pages.");
      // Under the report's date, and above who prepared it and its links.
      expect(textsOf(card, "p")).toEqual([
        "Nothing needs attention",
        "NVDA read all 9 pages.",
        "Prepared by Pat Lee",
        `Open the report of ${DVFR}, 3 October 2026, 14:05 Download the Word copy of ${DVFR}, 3 October 2026, 14:05`,
      ]);
    });

    it("says how many problems need attention, on how many pages, as a warning", () => {
      const card = cardWith({ pages: 32, read: 32, problems: 1, problemPages: 32 });

      expect(verdictOf(card)).toBe(
        '<p class="verdict warn">1 problem needs attention, on 32 pages</p>',
      );
      expect(readingOf(card)?.words).toBe("NVDA read all 32 pages.");
      expect(
        textOf(verdictOf(cardWith({ pages: 3, read: 3, problems: 2, problemPages: 1 })) ?? ""),
      ).toBe("2 problems need attention, on 1 page");
    });

    it("says how many pages NVDA read when it didn't read them all, as bad", () => {
      const card = cardWith({ pages: 9, read: 7, problems: 2, problemPages: 2 });

      expect(verdictOf(card)).toBe(
        '<p class="verdict bad">2 problems need attention, on 2 pages</p>',
      );
      expect(readingOf(card)?.words).toBe("NVDA read 7 of the 9 pages.");
      // Pages skipped, not read, are on no card: nothing needs attention on the pages read.
      const skipped = cardWith({ pages: 9, read: 8, problems: 0, problemPages: 0 });
      expect(textOf(verdictOf(skipped) ?? "")).toBe("Nothing needs attention on the pages read");
      expect(readingOf(skipped)?.words).toBe("NVDA read 8 of the 9 pages.");
    });

    it("says a site of one page as one", () => {
      expect(readingOf(cardWith({ pages: 1, read: 1, problems: 0, problemPages: 0 }))?.words).toBe(
        "NVDA read 1 page.",
      );
    });

    it("draws the pages NVDA read as a bar as long as their share of the pages, in the verdict's color, which a screen reader skips", () => {
      const barWith = (result: PublishedReport["result"]): string =>
        readingOf(cardWith(result))?.bar ?? "";

      const all = barWith({ pages: 9, read: 9, problems: 0, problemPages: 0 });
      expect(all).toMatch(/^<svg class="track"[^>]*\saria-hidden="true"/);
      expect(partsOf(all)).toEqual([{ kind: "ok", width: "100%" }]);
      expect(partsOf(barWith({ pages: 32, read: 32, problems: 1, problemPages: 32 }))).toEqual([
        { kind: "warn", width: "100%" },
      ]);
      // Seven of nine pages, to two decimals.
      expect(partsOf(barWith({ pages: 9, read: 7, problems: 2, problemPages: 2 }))).toEqual([
        { kind: "bad", width: "77.78%" },
      ]);
      // With none read, the bar is empty.
      expect(partsOf(barWith({ pages: 9, read: 0, problems: 0, problemPages: 0 }))).toEqual([]);
    });

    it("says nothing for a report that records no result, or one of no page", () => {
      // The tests' content records none, as a share from before 0.12.3 doesn't.
      expect(html).not.toContain('class="verdict');
      expect(html).not.toContain('class="reading"');
      for (const result of [undefined, { pages: 0, read: 0, problems: 0, problemPages: 0 }]) {
        expect(verdictOf(cardWith(result))).toBeNull();
        expect(readingOf(cardWith(result))).toBeNull();
      }
    });

    it("gives no earlier report a verdict: only the current one answers for the site", () => {
      const page = renderSiteIndex(
        {
          demo: null,
          sites: [
            {
              name: DVFR,
              folders: [DVFR],
              reports: [
                { ...DVFR_NEWEST, result: { pages: 9, read: 9, problems: 0, problemPages: 0 } },
                { ...DVFR_OLDEST, result: { pages: 9, read: 9, problems: 3, problemPages: 2 } },
              ],
            },
          ],
        },
        NO_FONTS,
      );

      expect(page.match(/class="verdict /g)).toHaveLength(1);
      expect(page.match(/class="reading"/g)).toHaveLength(1);
      expect(earlierItemsOf(page).join("")).not.toContain("attention");
    });

    it("gives the demo's card its verdict too", () => {
      const page = renderSiteIndex(
        {
          demo: { ...DEMO_REPORT, result: { pages: 7, read: 7, problems: 3, problemPages: 2 } },
          sites: [],
        },
        NO_FONTS,
      );
      const card = articleOf(page, DEMO_REPORT.id);

      expect(textOf(verdictOf(card) ?? "")).toBe("3 problems need attention, on 2 pages");
      expect(readingOf(card)?.words).toBe("NVDA read all 7 pages.");
    });
  });

  it("says in the current report when its page or its Word copy isn't here, in place of its link", () => {
    // The example site's Word copy is missing: its page has its link, and the Word copy a line.
    const example = articleOf(html, EXAMPLE_REPORT.id);
    expect(textsOf(example, "p")).toEqual([
      "Prepared by Sam Rivera",
      `Open the report of ${EXAMPLE}, 2 October 2026, 09:30`,
      `${EXAMPLE}_2026-10-02.docx isn't here: the file is missing.`,
    ]);
    expect(example).toContain('<p class="gone">');

    const currentOf = (report: PublishedReport): string =>
      articleOf(
        renderSiteIndex(
          { demo: null, sites: [{ name: DVFR, folders: [DVFR], reports: [report] }] },
          NO_FONTS,
        ),
        report.id,
      );
    // A page that changed: only the Word copy's link, and the page's line.
    const wordOnly = currentOf({
      ...DVFR_NEWEST,
      files: DVFR_NEWEST.files.filter(({ kind }) => kind !== "page"),
      notPublished: [{ name: `${DVFR}_2026-10-03.html`, reason: "changed" }],
    });
    expect(textsOf(wordOnly, "p")).toEqual([
      "Prepared by Pat Lee",
      `Download the Word copy of ${DVFR}, 3 October 2026, 14:05`,
      `${DVFR}_2026-10-03.html isn't here: it no longer matches the fingerprint recorded when it was shared.`,
    ]);
    // Neither: no paragraph of links with nothing in it. A walkthrough file that isn't here is said
    // only in the fold.
    const neither = currentOf({
      ...DVFR_NEWEST,
      files: DVFR_NEWEST.files.filter(({ kind }) => kind === "walkthrough"),
      notPublished: [
        { name: `${DVFR}_2026-10-03.html`, reason: "missing" },
        { name: `${DVFR}_2026-10-03.docx`, reason: "missing" },
        { name: `${DVFR}_2026-10-03_other_walkthrough.json`, reason: "missing" },
      ],
    });
    expect(neither).not.toContain('class="actions"');
    expect(neither).not.toContain("<a ");
    expect(textsOf(neither, "p")).toEqual([
      "Prepared by Pat Lee",
      `${DVFR}_2026-10-03.html isn't here: the file is missing.`,
      `${DVFR}_2026-10-03.docx isn't here: the file is missing.`,
    ]);
  });

  it("lists a site's earlier reports under its current one, a line each: when, who, and links to the page and the Word copy", () => {
    const site = sectionOf(html, `site-${DVFR}`);
    const of = ` of ${DVFR}, 29 September 2026, 16:20`;

    expect(textsOf(site, "h4")).toEqual([
      "The current report 3 October 2026, 14:05",
      "Earlier reports",
    ]);
    // The Word copy of the oldest changed since it was shared: only its page has a link.
    expect(earlierItemsOf(site)).toEqual([
      `<li id="${DVFR_OLDEST.id}"><time datetime="2026-09-29T16:20:00-05:00">29 September 2026, 16:20</time>, prepared by Pat Lee: <a href="${DVFR}/${DVFR}_2026-09-29.html">Open the report<span class="sr">${of}</span></a></li>`,
    ]);
    // After the current report, and before the fold.
    expect(site.indexOf("Earlier reports")).toBeGreaterThan(site.indexOf("</article>"));
    expect(site.indexOf("Earlier reports")).toBeLessThan(site.indexOf("<details"));

    // With its Word copy, and with a page that isn't here.
    const withWord: PublishedReport = {
      ...DVFR_OLDEST,
      files: [...DVFR_OLDEST.files, published("word", DVFR, `${DVFR}_2026-09-29.docx`, 50)],
      notPublished: [],
    };
    const wordOnly: PublishedReport = {
      ...DVFR_OLDEST,
      id: `report-${DVFR}-0`,
      at: "2026-09-28T09:00:00-05:00",
      files: [published("word", DVFR, `${DVFR}_2026-09-28.docx`, 50)],
      notPublished: [{ name: `${DVFR}_2026-09-28.html`, reason: "missing" }],
    };
    const page = renderSiteIndex(
      {
        demo: null,
        sites: [{ name: DVFR, folders: [DVFR], reports: [DVFR_NEWEST, withWord, wordOnly] }],
      },
      NO_FONTS,
    );
    const separator = '<span class="sep" aria-hidden="true">·</span>';
    expect(earlierItemsOf(sectionOf(page, `site-${DVFR}`))).toEqual([
      `<li id="${DVFR_OLDEST.id}"><time datetime="2026-09-29T16:20:00-05:00">29 September 2026, 16:20</time>, prepared by Pat Lee: <a href="${DVFR}/${DVFR}_2026-09-29.html">Open the report<span class="sr">${of}</span></a> ${separator} <a href="${DVFR}/${DVFR}_2026-09-29.docx" download>Word copy<span class="sr">${of}</span></a></li>`,
      `<li id="report-${DVFR}-0"><time datetime="2026-09-28T09:00:00-05:00">28 September 2026, 09:00</time>, prepared by Pat Lee: its page isn&#39;t here ${separator} <a href="${DVFR}/${DVFR}_2026-09-28.docx" download>Word copy<span class="sr"> of ${DVFR}, 28 September 2026, 09:00</span></a></li>`,
    ]);
    // What a reader sees of a line, and what a screen reader hears: the dot between the links
    // isn't read.
    expect(
      textOf(withoutHidden(earlierItemsOf(sectionOf(page, `site-${DVFR}`))[0] ?? ""), ""),
    ).toBe("29 September 2026, 16:20, prepared by Pat Lee: Open the report · Word copy");
  });

  it("has no earlier reports for a site with one report", () => {
    const site = sectionOf(html, `site-${EXAMPLE}`);

    expect(textsOf(site, "h4")).toEqual(["The current report 2 October 2026, 09:30"]);
    expect(site).not.toContain('class="earlier"');
    expect(site).not.toContain("Earlier reports");
  });

  it("says in the fold what isn't here, and when no walkthrough file was shared", () => {
    const [newest, oldest] = sharedBlocksOf(sectionOf(html, `site-${DVFR}`));
    const [example] = sharedBlocksOf(sectionOf(html, `site-${EXAMPLE}`));

    // A report with everything: nothing but when, and who prepared it.
    expect(textsOf(newest ?? "", "p")).toEqual(["3 October 2026, 14:05, prepared by Pat Lee"]);
    // A copy that changed since it was shared, in a report that has no walkthrough file.
    expect(textsOf(oldest ?? "", "p")).toEqual([
      "29 September 2026, 16:20, prepared by Pat Lee",
      `${DVFR}_2026-09-29.docx isn't here: it no longer matches the fingerprint recorded when it was shared.`,
      "No walkthrough file was shared with this report.",
    ]);
    // A copy that is missing, in a report that has walkthrough files.
    expect(textsOf(example ?? "", "p")).toEqual([
      "2 October 2026, 09:30, prepared by Sam Rivera",
      `${EXAMPLE}_2026-10-02.docx isn't here: the file is missing.`,
    ]);
    // The line for no walkthrough file is said once, for the one report that has none.
    expect(html.match(/No walkthrough file was shared with this report\./g)).toHaveLength(1);
  });

  it("doesn't say no walkthrough file was shared when one was, and isn't here", () => {
    const withoutWalkthrough = (reason: "changed" | "missing"): string =>
      renderSiteIndex(
        {
          demo: null,
          sites: [
            {
              name: DVFR,
              folders: [DVFR],
              reports: [
                {
                  ...DVFR_NEWEST,
                  files: DVFR_NEWEST.files.filter(({ kind }) => kind !== "walkthrough"),
                  notPublished: [{ name: `${DVFR}_2026-10-03_walkthrough.json`, reason }],
                },
              ],
            },
          ],
        },
        NO_FONTS,
      );
    const lines = (reason: "changed" | "missing") =>
      textsOf(sharedBlocksOf(withoutWalkthrough(reason))[0] ?? "", "p");

    expect(lines("missing")).toEqual([
      "3 October 2026, 14:05, prepared by Pat Lee",
      `${DVFR}_2026-10-03_walkthrough.json isn't here: the file is missing.`,
    ]);
    expect(lines("changed")).toEqual([
      "3 October 2026, 14:05, prepared by Pat Lee",
      `${DVFR}_2026-10-03_walkthrough.json isn't here: it no longer matches the fingerprint recorded when it was shared.`,
    ]);
  });

  it("lists no files for a report with none published, and says what isn't here", () => {
    const empty: PublishedReport = {
      ...DVFR_OLDEST,
      files: [],
      notPublished: [{ name: `${DVFR}_2026-09-29.html`, reason: "changed" }],
    };
    const page = renderSiteIndex(
      { demo: null, sites: [{ name: DVFR, folders: [DVFR], reports: [empty] }] },
      NO_FONTS,
    );
    const [block] = sharedBlocksOf(page);

    // No list with nothing in it, for a screen reader to announce.
    expect(block).not.toMatch(/<ul\b|<li\b/);
    expect(textsOf(block ?? "", "p")).toEqual([
      "29 September 2026, 16:20, prepared by Pat Lee",
      `${DVFR}_2026-09-29.html isn't here: it no longer matches the fingerprint recorded when it was shared.`,
      "No walkthrough file was shared with this report.",
    ]);
  });

  it("gives each of its lists the role of a list, which WebKit takes from a list with no markers", () => {
    const tags = [...html.matchAll(/<(?:ul|ol)\b[^>]*>/g)].map(([tag]) => tag);
    const withFiles = [DEMO_REPORT, ...reportsOf(CONTENT)].filter(
      (shared) => shared.files.length > 0,
    );
    const withEarlier = CONTENT.sites.filter(({ reports }) => reports.length > 1);

    // A list of files for each report that has one published, a list of earlier reports for each
    // site that has them, and the list by date: no other list.
    expect(tags.filter((tag) => /\sclass="files"/.test(tag))).toHaveLength(withFiles.length);
    expect(tags.filter((tag) => /\sclass="earlier"/.test(tag))).toHaveLength(withEarlier.length);
    expect(tags.filter((tag) => tag.startsWith("<ol"))).toHaveLength(1);
    expect(tags).toHaveLength(withFiles.length + withEarlier.length + 1);
    for (const tag of tags) expect(tag).toMatch(/\srole="list"/);
    expect(sectionOf(html, "by-date")).toMatch(/<ol\b[^>]*\srole="list"/);
  });

  it("lists every report by date across the sites, newest first, without the demo", () => {
    const list = sectionOf(html, "by-date");
    const items = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, inner = ""]) => inner);

    expect(items).toEqual([
      `<time datetime="2026-10-03T14:05:00-05:00">3 October 2026, 14:05</time>, ${DVFR}, prepared by Pat Lee: <a href="${DVFR}/${DVFR}_2026-10-03.html">${DVFR}_2026-10-03.html</a>`,
      `<time datetime="2026-10-02T09:30:00-05:00">2 October 2026, 09:30</time>, ${EXAMPLE}, prepared by Sam Rivera: <a href="${EXAMPLE}/${EXAMPLE}_2026-10-02.html">${EXAMPLE}_2026-10-02.html</a>`,
      `<time datetime="2026-09-29T16:20:00-05:00">29 September 2026, 16:20</time>, ${DVFR}, prepared by Pat Lee: <a href="${DVFR}/${DVFR}_2026-09-29.html">${DVFR}_2026-09-29.html</a>`,
    ]);
    // An ordered list, and the demo's report isn't in it.
    expect(list).toMatch(/<ol\b[^>]*>/);
    expect(list).not.toContain("127.0.0.1_4848");
    expect(list).not.toContain("Sam Demo");
  });

  it("lists reports by date with their sites' names, as the headings give them, not their folders'", () => {
    const page = renderSiteIndex(
      {
        demo: null,
        sites: [
          // One site, whose reports are in two folders: a copy on a tester's computer, and the site's own.
          {
            name: DVFR,
            folders: ["127.0.0.1_4848", DVFR],
            reports: [
              reportAt("127.0.0.1_4848", "2026-10-03T14:05:00-05:00"),
              reportAt(DVFR, "2026-10-01T09:00:00-05:00"),
            ],
          },
          {
            name: EXAMPLE,
            folders: ["localhost_3000"],
            reports: [reportAt("localhost_3000", "2026-10-02T09:30:00-05:00", "Sam Rivera")],
          },
        ],
      },
      NO_FONTS,
    );
    const list = sectionOf(page, "by-date");

    expect([...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, inner = ""]) => inner)).toEqual([
      `<time datetime="2026-10-03T14:05:00-05:00">3 October 2026, 14:05</time>, ${DVFR}, prepared by Pat Lee: <a href="127.0.0.1_4848/127.0.0.1_4848_page.html">127.0.0.1_4848_page.html</a>`,
      `<time datetime="2026-10-02T09:30:00-05:00">2 October 2026, 09:30</time>, ${EXAMPLE}, prepared by Sam Rivera: <a href="localhost_3000/localhost_3000_page.html">localhost_3000_page.html</a>`,
      `<time datetime="2026-10-01T09:00:00-05:00">1 October 2026, 09:00</time>, ${DVFR}, prepared by Pat Lee: <a href="${DVFR}/${DVFR}_page.html">${DVFR}_page.html</a>`,
    ]);
    expect(namesByDate(page)).toEqual([DVFR, EXAMPLE, DVFR]);
  });

  it("orders them by the moment each names, not by the text of its time", () => {
    // The clocks read 03:00, 00:30, and 23:00 the day before. In UTC they are 01:00, 05:30, and 04:00.
    const page = renderSiteIndex(
      sitesAt(
        ["a.example.gov", "2026-10-03T03:00:00+02:00"],
        ["b.example.gov", "2026-10-03T00:30:00-05:00"],
        ["c.example.gov", "2026-10-02T23:00:00-05:00"],
      ),
      NO_FONTS,
    );

    expect(namesByDate(page)).toEqual(["b.example.gov", "c.example.gov", "a.example.gov"]);
  });

  it("keeps the order it was given for reports of the same moment", () => {
    const page = renderSiteIndex(
      sitesAt(
        ["a.example.gov", "2026-10-03T10:00:00-05:00"],
        ["b.example.gov", "2026-10-03T15:00:00Z"],
        ["c.example.gov", "2026-10-03T10:00:00-05:00"],
      ),
      NO_FONTS,
    );

    expect(namesByDate(page)).toEqual(["a.example.gov", "b.example.gov", "c.example.gov"]);
  });

  it("says a report's page isn't here, in its place by date, when it isn't published", () => {
    const wordOnly: PublishedReport = {
      ...DVFR_NEWEST,
      files: DVFR_NEWEST.files.filter(({ kind }) => kind === "word"),
      notPublished: [{ name: `${DVFR}_2026-10-03.html`, reason: "changed" }],
    };
    // Two sites, so that there's a list by date.
    const page = renderSiteIndex(
      {
        demo: null,
        sites: [{ name: DVFR, folders: [DVFR], reports: [wordOnly] }, ...CONTENT.sites.slice(1)],
      },
      NO_FONTS,
    );

    const [item] = [...sectionOf(page, "by-date").matchAll(/<li>([\s\S]*?)<\/li>/g)];
    expect(item?.[1]).toBe(
      `<time datetime="2026-10-03T14:05:00-05:00">3 October 2026, 14:05</time>, ${DVFR}, prepared by Pat Lee: its page isn&#39;t here`,
    );
    expect(textOf(item?.[1] ?? "")).toContain("its page isn't here");
  });

  it("links the demo view to the demo's own pages, with a relative link named by their address", () => {
    const demo = sectionOf(html, "demo");
    const [lead] = [...demo.matchAll(/<p>([\s\S]*?)<\/p>/g)];

    // The build publishes them in demo-site/, beside this page: a link from the page's own address.
    expect(lead?.[1]).toBe(
      `voicecap&#39;s report on its own small demo site, as an example of what it makes. The site&#39;s pages are at <a href="${DEMO_PAGES_HREF}">voicecap.netlify.app/demo-site/</a>.`,
    );
    expect(linksOf(demo).filter(({ href }) => href === DEMO_PAGES_HREF)).toEqual([
      { href: DEMO_PAGES_HREF, download: false },
    ]);
    // Only the demo view has it, and the link's words are its address: the demo's canonical one.
    expect(linksOf(html).filter(({ href }) => href === DEMO_PAGES_HREF)).toHaveLength(1);
    expect(textsOf(demo, "a")[0]).toBe("voicecap.netlify.app/demo-site/");
    expect(`https://${textsOf(demo, "a")[0]}`).toBe(DEMO_CANONICAL);
    expect(demo).not.toMatch(/\shref="(?:[a-z][a-z0-9+.-]*:|\/)/i);
  });

  it("links the bar to the trust page, last", () => {
    const bar = barOf(html);

    // The views, by their anchors on this page, then the trust page, a page of its own beside this one.
    expect(linksOf(bar).map(({ href }) => href)).toEqual([
      "#demo",
      "#sites",
      "#by-date",
      TRUST_PAGE_HREF,
    ]);
    expect(textsOf(bar, "a")).toEqual([
      "The demo",
      "The sites",
      "Every report, by date",
      TRUST_WORDS,
    ]);
    // This is the website's own page, not the trust page, so none of the links is the page it is on.
    expect(bar).not.toContain("aria-current");
  });

  it("has no demo view, and no link to one, without a demo", () => {
    const page = renderSiteIndex({ ...CONTENT, demo: null }, NO_FONTS);

    expect(page).not.toContain('id="demo"');
    expect(page).not.toContain('href="#demo"');
    expect(page).not.toContain("The demo");
    expect(page).not.toContain("report-demo");
    expect(page).not.toContain("demo-site");
    // The bar's links go to the views that are there, then to the trust page.
    expect(textsOf(barOf(page), "a")).toEqual(["The sites", "Every report, by date", TRUST_WORDS]);
    expect(textsOf(barOf(html), "a")).toEqual([
      "The demo",
      "The sites",
      "Every report, by date",
      TRUST_WORDS,
    ]);
  });

  it("lists reports by date, with its link in the bar, only when two sites or more have reports", () => {
    // With one site, the list would be that site's own again.
    const one = renderSiteIndex({ demo: DEMO_REPORT, sites: CONTENT.sites.slice(0, 1) }, NO_FONTS);
    expect(one).not.toContain('id="by-date"');
    expect(one).not.toContain('href="#by-date"');
    expect(one).not.toContain("Every report, by date");
    expect(one).not.toMatch(/<ol\b/);
    expect(textsOf(barOf(one), "a")).toEqual(["The demo", "The sites", TRUST_WORDS]);
    // Two views are regions, named by their headings.
    expect(one.match(/\saria-labelledby=/g)).toHaveLength(2);

    // With two, it's there, after the sites, and in the bar, ahead of the link to the trust page.
    expect(textsOf(barOf(html), "a")).toEqual([
      "The demo",
      "The sites",
      "Every report, by date",
      TRUST_WORDS,
    ]);
    expect(html.indexOf('id="by-date"')).toBeGreaterThan(html.indexOf('id="sites"'));
  });

  it("says no reports have been shared yet when there are none", () => {
    const page = renderSiteIndex({ demo: null, sites: [] }, NO_FONTS);

    expect(textsOf(sectionOf(page, "sites"), "p")).toEqual(["No reports have been shared yet."]);
    expect(page).not.toContain('id="by-date"');
    expect(page).not.toMatch(/<article\b|<ol\b|<ul\b|<li\b|<details\b/);
    expect(textsOf(barOf(page), "a")).toEqual(["The sites", TRUST_WORDS]);

    // The demo isn't a site: with a demo and no site, the sites still have none.
    const withDemo = renderSiteIndex({ demo: DEMO_REPORT, sites: [] }, NO_FONTS);
    expect(textsOf(sectionOf(withDemo, "sites"), "p")).toEqual([
      "No reports have been shared yet.",
    ]);
    expect(textsOf(sectionOf(withDemo, "demo"), "h3")).toEqual([
      "The current report 29 September 2026, 15:40",
    ]);
  });

  it("escapes what the record holds", () => {
    // Every field a record fills, with markup and quotes. The time is one that the page can read:
    // its first part is a date and a time, and what follows is an attribute's end and a handler.
    const hostile = "<img src=x onerror=alert(1)>";
    const report: PublishedReport = {
      folder: 'a"b&c',
      id: 'report-"><b>x</b>',
      at: '2026-10-03T14:05:00-05:00" onmouseover="alert(1)',
      by: hostile,
      files: [
        {
          kind: "page",
          name: "a&b<i>.html",
          href: 'a&b/a&b".html',
          bytes: 2048,
          sha256: "<b>0</b>",
          run: null,
        },
        {
          kind: "walkthrough",
          name: "run.json",
          href: "run.json",
          bytes: 1024,
          sha256: "ab",
          run: "<u>run</u>",
        },
      ],
      notPublished: [{ name: "<script>x</script>.docx", reason: "changed" }],
    };
    // A site's name is text, and its section's id too: made safe, as a folder's name is.
    const name = 'a"b&c<s>x</s>';
    // A second site, linked: a root may hold an ampersand, which URL leaves as it is. Its name is
    // its host, as the build gives a site its name, since a link goes only to the heading's host.
    const linked = { ...report, folder: "a.example.gov", id: "report-a.example.gov-1" };
    const page = renderSiteIndex(
      {
        demo: null,
        sites: [
          { name, folders: ['a"b&c'], reports: [report] },
          {
            name: "a.example.gov",
            folders: ["a.example.gov"],
            reports: [linked],
            address: "https://a.example.gov/a&b/",
          },
        ],
      },
      NO_FONTS,
    );

    const markup = markupOf(page);
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<s>");
    expect(markup).toContain("Prepared by &lt;img src=x onerror=alert(1)&gt;");
    expect(markup).toContain("prepared by &lt;img src=x onerror=alert(1)&gt;");
    // A name, an address, a fingerprint, and a run, in text and in an attribute.
    expect(markup).toContain('href="a&amp;b/a&amp;b&quot;.html"');
    expect(markup).toContain(">a&amp;b&lt;i&gt;.html</a>");
    expect(markup).toContain("<code>&lt;b&gt;0&lt;/b&gt;</code>");
    expect(markup).toContain("The walkthrough file of run &lt;u&gt;run&lt;/u&gt;");
    expect(markup).toContain("&lt;script&gt;x&lt;/script&gt;.docx isn&#39;t here");
    // A site's name, an id, and a time, which are attributes and text too.
    expect(markup).toContain('id="report-&quot;&gt;&lt;b&gt;x&lt;/b&gt;"');
    expect(markup).toContain("<h3>a&quot;b&amp;c&lt;s&gt;x&lt;/s&gt;</h3>");
    expect(markup).toMatch(/<section\b[^>]*\bid="site-a_b_c_s_x__s_"/);
    expect(markup).toContain(
      'datetime="2026-10-03T14:05:00-05:00&quot; onmouseover=&quot;alert(1)"',
    );
    // What a screen reader hears after a link: the site's name, then the date.
    expect(markup).toContain(
      '<span class="sr"> of a&quot;b&amp;c&lt;s&gt;x&lt;/s&gt;, 3 October 2026, 14:05</span>',
    );
    // The link to the second site: its address, and the site's name after its words.
    expect(markup).toContain(
      '<a class="visit" href="https://a.example.gov/a&amp;b/" target="_blank" rel="noopener noreferrer">',
    );
    expect(markup).toContain('<span class="sr"> at a.example.gov, in a new tab</span>');
    // Nothing the record holds became markup: no element it names, and no attribute it adds. The
    // page's own <b> holds a count's number, so the record's two are looked for as they'd appear.
    const { elements, attributes } = namesIn(markup);
    expect(elements.filter((element) => ["img", "u", "i", "s"].includes(element))).toEqual([]);
    for (const own of ["<b>x</b>", "<b>0</b>"]) expect(markup).not.toContain(own);
    expect(attributes.filter((name) => /^(?:on|style$|src)/.test(name))).toEqual([]);
  });

  it("says what it says in the words the design gives it", () => {
    const sentences = textsOf(markupOf(html), "p");

    expect(sentences).toEqual(
      expect.arrayContaining([
        "Each report is a person's review of a website with a real screen reader, sped up by voicecap. Every transcript in a report is what the screen reader said, word for word, and every decision in it is a person's.",
        "voicecap's report on its own small demo site, as an example of what it makes. The site's pages are at voicecap.netlify.app/demo-site/.",
        "Each site's current report, with up to two earlier ones below it.",
        "Every site's reports, the newest first, each with its page.",
        "A file's SHA-256 fingerprint is the one recorded when it was shared, so a copy can be checked against it: Get-FileHash <file> in PowerShell, or shasum -a 256 <file> on a Mac. PowerShell shows the same letters in capitals.",
        "A walkthrough file repeats its run, with the same pages, passes, and limits: npx @icjia/voicecap --walkthrough <file>.",
        ABOUT,
        "Made with voicecap",
      ]),
    );
    // The commands are in the fixed-width font.
    for (const command of [
      "Get-FileHash &lt;file&gt;",
      "shasum -a 256 &lt;file&gt;",
      "npx @icjia/voicecap --walkthrough &lt;file&gt;",
    ]) {
      expect(html).toContain(`<code>${command}</code>`);
    }
    // The fold of files, named for what it holds.
    expect(html).toContain(
      '<details class="fold">\n<summary>Files and fingerprints, to check a copy</summary>',
    );
    // The bar's label, which names the website, since its links go to the views and to the trust
    // page; the button, which is hidden until the script shows it; and the footer's link.
    expect(html).toContain('<nav aria-label="This website">');
    expect(html).toContain(
      '<button class="theme" id="theme-toggle" type="button" hidden>Light version</button>',
    );
    expect(html).toContain(`Made with <a href="${GITHUB}">voicecap</a>`);
  });

  it("puts the skip link and the bar first, then the main part with its views, then the footer and the script", () => {
    const places = [
      '<a class="skip" href="#main">Skip to main content</a>',
      '<header class="bar">',
      "<nav ",
      '<main id="main">',
      "<h1>",
      'id="demo"',
      'id="sites"',
      'id="by-date"',
      "</main>",
      "<footer>",
      "<script>",
    ].map((part) => html.indexOf(part));

    expect(places.every((place) => place > 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    // The two sentences about checking a file come after the three views, inside the main part.
    const note = html.indexOf("A file&#39;s SHA-256 fingerprint");
    expect(note).toBeGreaterThan(html.indexOf('id="by-date"'));
    expect(note).toBeLessThan(html.indexOf("</main>"));
    // The footer holds what voicecap is, and the link to it, in two paragraphs.
    const footer = /<footer>([\s\S]*?)<\/footer>/.exec(html)?.[1] ?? "";
    expect(textsOf(footer, "p")).toEqual([ABOUT, "Made with voicecap"]);
  });

  it("never calls voicecap automated, or says a person listened", () => {
    const text = textOf(markupOf(html));

    expect(text).not.toMatch(/automat/i);
    expect(text).not.toMatch(/listen/i);
  });
});

describe("siteBar", () => {
  /** Whether each link of a bar marks the page it's on, in order. */
  const currentOf = (bar: string): boolean[] =>
    [...barOf(bar).matchAll(/<a\b([^>]*)>/g)].map(([, tag = ""]) =>
      /\saria-current="page"/.test(tag),
    );

  it("on the trust page, links each view by its anchor on the website's own page, and marks the link to the trust page as the page it's on", () => {
    const bar = siteBar(CONTENT, "trust");

    expect(linksOf(barOf(bar)).map(({ href }) => href)).toEqual([
      "index.html#demo",
      "index.html#sites",
      "index.html#by-date",
      TRUST_PAGE_HREF,
    ]);
    expect(textsOf(barOf(bar), "a")).toEqual([
      "The demo",
      "The sites",
      "Every report, by date",
      TRUST_WORDS,
    ]);
    // Only the last link, the one to the trust page itself, is the page the reader is on.
    expect(currentOf(bar)).toEqual([false, false, false, true]);
  });

  it("is the same bar on both pages but for where its views go and which link is the page it's on, so the two can't drift apart", () => {
    const index = siteBar(CONTENT, "index");

    expect(siteBar(CONTENT, "trust")).toBe(
      index
        .replaceAll('href="#', 'href="index.html#')
        .replace(
          `<a href="${TRUST_PAGE_HREF}">`,
          `<a href="${TRUST_PAGE_HREF}" aria-current="page">`,
        ),
    );
    // Nothing else of the bar is left to differ: the header, the navigation, and the theme button.
    expect(index).toMatch(/^<header class="bar">\n<nav aria-label="This website">\n<a href="#/);
    expect(index).toMatch(
      /<\/a>\n<\/nav>\n<button class="theme" id="theme-toggle" type="button" hidden>Light version<\/button>\n<\/header>$/,
    );
  });

  it.each(["index", "trust"] as const)(
    "links the views that are there, on the %s page, and the trust page after them",
    (current) => {
      // The views are on the website's own page: from the trust page, a link to it names the page.
      const here = current === "index" ? "" : "index.html";
      const hrefs = (content: SiteContent): string[] =>
        linksOf(barOf(siteBar(content, current))).map(({ href }) => href);

      expect(hrefs(CONTENT)).toEqual([
        `${here}#demo`,
        `${here}#sites`,
        `${here}#by-date`,
        TRUST_PAGE_HREF,
      ]);
      // No demo, no link to it; one site, no list by date; and no report at all, the sites alone.
      expect(hrefs({ ...CONTENT, demo: null })).toEqual([
        `${here}#sites`,
        `${here}#by-date`,
        TRUST_PAGE_HREF,
      ]);
      expect(hrefs({ demo: DEMO_REPORT, sites: CONTENT.sites.slice(0, 1) })).toEqual([
        `${here}#demo`,
        `${here}#sites`,
        TRUST_PAGE_HREF,
      ]);
      expect(hrefs({ demo: null, sites: [] })).toEqual([`${here}#sites`, TRUST_PAGE_HREF]);
    },
  );

  it("is how the website's own page draws its bar", () => {
    expect(renderSiteIndex(CONTENT, NO_FONTS)).toContain(`\n${siteBar(CONTENT, "index")}\n`);
  });
});

describe("siteFooter", () => {
  it("says what voicecap is, and links to it", () => {
    const footer = siteFooter();

    expect(footer).toMatch(/^<footer>\n<p>[\s\S]*<\/p>\n<p>[\s\S]*<\/p>\n<\/footer>$/);
    expect(textsOf(footer, "p")).toEqual([ABOUT, "Made with voicecap"]);
    expect(linksOf(footer)).toEqual([{ href: GITHUB, download: false }]);
  });

  it("is how the website's own page draws its footer", () => {
    expect(renderSiteIndex(CONTENT, NO_FONTS)).toContain(`\n${siteFooter()}\n`);
  });
});

describe("sitePage", () => {
  const PARTS = {
    title: "A page of the website",
    bar: '<header class="bar">The bar</header>',
    main: ["<h1>The page</h1>", "<p>Its words</p>"],
  };

  it("is the shell around what it's given: the head, the skip link, the bar, the main part, the footer, and the script", () => {
    expect(sitePage(PARTS, { fontCss: "FONTS" })).toBe(
      [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="robots" content="noindex, nofollow, noarchive">',
        "<title>A page of the website</title>",
        `<style>\nFONTS\n${SITE_CSS}</style>`,
        "</head>",
        "<body>",
        '<a class="skip" href="#main">Skip to main content</a>',
        '<header class="bar">The bar</header>',
        '<main id="main">',
        "<h1>The page</h1>",
        "<p>Its words</p>",
        "</main>",
        siteFooter(),
        `<script>${SITE_SCRIPT}</script>`,
        "</body>",
        "</html>",
        "",
      ].join("\n"),
    );
  });

  it("escapes the title, which is text, and takes the bar and the main part as the markup they are", () => {
    const page = sitePage(
      {
        title: 'Q & A <i>"x"</i>',
        bar: "<header>The <b>bar</b></header>",
        main: ["<h1>A &amp; B</h1>"],
      },
      NO_FONTS,
    );

    expect(page).toContain("<title>Q &amp; A &lt;i&gt;&quot;x&quot;&lt;/i&gt;</title>");
    expect(page).toContain("\n<header>The <b>bar</b></header>\n");
    expect(page).toContain('\n<main id="main">\n<h1>A &amp; B</h1>\n</main>\n');
  });
});

describe("fileKind", () => {
  it("takes a file's kind from its extension: .html is the page, .docx the Word copy, .json a walkthrough file", () => {
    expect(fileKind("dvfr.illinois.gov_2026-10-03.html")).toBe("page");
    expect(fileKind("dvfr.illinois.gov_2026-10-03.docx")).toBe("word");
    expect(fileKind("dvfr.illinois.gov_2026-10-03_2026-10-03_1330_walkthrough.json")).toBe(
      "walkthrough",
    );
  });

  it("calls anything else other", () => {
    for (const name of [
      "summary.pdf",
      "notes.txt",
      "a.html.zip",
      "a.html.bak",
      "html",
      "json",
      "",
    ]) {
      expect(fileKind(name), name).toBe("other");
    }
  });

  it("gives each file of the tests' content the kind its extension does", () => {
    for (const { kind, name } of filesOf(CONTENT)) expect(kind, name).toBe(fileKind(name));
    expect(reportsOf(CONTENT)).toHaveLength(3);
  });
});

describe("THEME_CSS", () => {
  it("is the theme's rules, and the shareable page's style has them where they were", () => {
    expect(THEME_CSS.startsWith(":root {\n  --bg: #0b1015;")).toBe(true);
    expect(THEME_CSS).toContain('\n:root[data-theme="light"] {\n');
    expect(THEME_CSS).toMatch(
      /\n@media print \{ :root \{ --bg: #fff;[^\n]*color-scheme: light; \} \.theme \{ display: none; \} \}$/,
    );
    expect(THEME_CSS).not.toMatch(/^\s|\s$/);
    // The shareable page's style has them between its first comment and its first rule for the page.
    expect(SHARE_CSS).toMatch(
      new RegExp(`^/\\* Layout:[^\\n]*\\*/\\n${patternOf(THEME_CSS)}\\nbody \\{`),
    );
  });
});

describe("SITE_CSS", () => {
  it("begins with the theme's rules, and takes the shareable page's rules for focus, the skip link, .sr, and [hidden] as they are", () => {
    expect(SITE_CSS.startsWith(`${THEME_CSS}\n`)).toBe(true);
    const shared = SHARE_CSS.split("\n");
    const mine = SITE_CSS.split("\n");
    for (const rule of [
      /^a \{ color: var\(--accent\); \} a:focus-visible/,
      /^\.skip \{/,
      /^\.sr \{/,
      /^\[hidden\] \{/,
    ]) {
      const line = shared.find((candidate) => rule.test(candidate));
      expect(line, String(rule)).toBeDefined();
      expect(mine, String(rule)).toContain(line);
    }
  });

  it("holds nothing from outside, and nothing that could end the page's one style block", () => {
    expect(SITE_CSS).not.toMatch(/<\/style|<!--/i);
    expect(SITE_CSS).not.toMatch(/@import|url\(/);
    expect(SITE_CSS).toMatch(/\n$/);
  });

  it("keeps the bar in view from 40em wide, which is 640 pixels at 16, and wraps what is long", () => {
    expect(SITE_CSS).toMatch(/@media \(min-width: 40em\) \{[^}]*\.bar \{[^}]*position: sticky;/);
    expect(SITE_CSS).toMatch(/scroll-padding-top: [\d.]+rem/);
    expect(SITE_CSS).toContain("overflow-wrap: anywhere");
    // Only from 40em wide: the bar has no position of its own before it.
    expect(SITE_CSS.match(/position: sticky/g)).toHaveLength(1);
    expect(SITE_CSS.indexOf("position: sticky")).toBeGreaterThan(
      SITE_CSS.indexOf("@media (min-width: 40em)"),
    );
    // An em in a media query is the reader's own text size, so the bar sticks only where it fits on
    // one line at that size. A width in pixels would stick it where a larger size makes it wrap, and
    // grow taller than the space kept clear for it. The one other is no width at all: `screen`, for
    // the footer at the window's bottom, which print leaves as it was.
    const queries = [...SITE_CSS.matchAll(/@media ([^{]*)\{/g)].map(([, query = ""]) =>
      query.trim(),
    );
    expect(queries).toEqual(["print", "(min-width: 40em)", "screen"]);
  });

  it("tells the link of the page the reader is on from the others by more than color: bold, and underlined more heavily", () => {
    expect(SITE_CSS).toMatch(
      /\n\.bar nav a\[aria-current="page"\] \{[^}]*font-weight: 700;[^}]*text-decoration: underline;[^}]*text-decoration-thickness: 2px;/,
    );
  });
});

describe("SITE_SCRIPT", () => {
  it("is one function, with nothing in it that can end the page's one script", () => {
    expect(SITE_SCRIPT.trim()).toMatch(/^\(function \(\) \{\n[\s\S]*\n\}\)\(\);$/);
    expect(SITE_SCRIPT).not.toMatch(/<!--|<\/?script/i);
    expect(SITE_SCRIPT).not.toMatch(/\b(style|src|href)\s*=/i);
    expect(() => new vm.Script(SITE_SCRIPT)).not.toThrow();
  });

  it("is the shareable page's theme, kept under the same name, with the same words", () => {
    const themeOf = (script: string): string => {
      const start = script.indexOf("  function theme() {");
      const end = script.indexOf("\n  }\n", start);
      return script.slice(start, end + "\n  }\n".length);
    };

    expect(themeOf(SITE_SCRIPT)).toContain('var KEY = "voicecap-theme";');
    expect(themeOf(SITE_SCRIPT)).toBe(themeOf(SHARE_SCRIPT));
    // The words of the button are the page's own.
    expect(SITE_SCRIPT).toContain(`"${SITE_TEXT.theme.dark}" : "${SITE_TEXT.theme.light}"`);
    expect(SITE_TEXT.theme).toEqual({ light: "Light version", dark: "Dark version" });
  });

  it("adds no name to the page, and looks only for the theme's button", () => {
    const errors: unknown[] = [];
    const looked: string[] = [];
    const context = vm.createContext({
      window: {
        addEventListener: () => undefined,
        location: { hash: "" },
        console: { error: (error: unknown) => errors.push(error) },
      },
      document: {
        documentElement: { setAttribute: () => undefined, getAttribute: () => null },
        getElementById: (id: string) => {
          looked.push(id);
          return null;
        },
        querySelectorAll: () => [],
        addEventListener: () => undefined,
      },
    });
    const before = Object.keys(context).sort();

    vm.runInContext(SITE_SCRIPT, context);

    expect(looked).toEqual(["theme-toggle"]);
    expect(Object.keys(context).sort()).toEqual(before);
    expect(errors).toEqual([]);
  });
});
