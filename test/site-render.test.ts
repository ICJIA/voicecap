/**
 * The website's page, from what's published (src/site/render.ts): one file with one style block and
 * one script, its headings in order, each site's current report with its links, its earlier ones a
 * line each, every report's files in a fold, what isn't there, and every report by date when two
 * sites or more have reports. The content is small (test/helpers/site-content.ts): a demo, two
 * sites with three reports, a Word copy that isn't published, and a report with no walkthrough file.
 *
 * The frame that every page of the website shares (src/site/frame.ts) is here too: the top bar, with
 * the website's name, its three pages, and the theme button; the bottom bar, with GitHub, the
 * CHANGELOG, the three pages, and the version; the way back to the test results that the other
 * three pages open with; and the shell around a page, the same bars on each of the four pages but
 * for the link of the page the reader is on.
 *
 * What the page does in a browser is in test/site-page-browser.test.ts.
 */
import { createHash } from "node:crypto";
import vm from "node:vm";

import { beforeAll, describe, expect, it } from "vitest";

import { DEMO_CANONICAL } from "../src/demo/server.js";
import { SHARE_SCRIPT } from "../src/share/html/client.js";
import { SHARE_CSS, THEME_CSS } from "../src/share/html/style.js";
import { SITE_SCRIPT } from "../src/site/client.js";
import { backLink, siteBar, siteFooter, sitePage, type SitePage } from "../src/site/frame.js";
import { inlineHashes } from "../src/site/headers.js";
import {
  fileKind,
  type PublishedReport,
  renderSiteIndex,
  type SiteContent,
} from "../src/site/render.js";
import { SITE_CSS } from "../src/site/style.js";
import { renderTechnical } from "../src/site/technical.js";
import { SITE_TEXT } from "../src/site/text.js";
import { renderTrustPage } from "../src/site/trust.js";
import { renderWhatsNew } from "../src/site/whats-new.js";
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
import { FACTS, RECORDS } from "./helpers/trust-facts.js";

const GITHUB = "https://github.com/ICJIA/voicecap";
/** voicecap's CHANGELOG on GitHub, which the bottom bar links to. */
const CHANGELOG = "https://github.com/ICJIA/voicecap/blob/main/CHANGELOG.md";
/** Where the build publishes the demo's own pages, from the site's top: a relative link goes there. */
const DEMO_PAGES_HREF = "demo-site/";
/** The website's four pages, beside each other: a relative link goes to each. */
const INDEX_HREF = "index.html";
const TRUST_PAGE_HREF = "trust.html";
const WHATS_NEW_HREF = "whats-new.html";
const TECHNICAL_HREF = "technical-details.html";
/** The website's four pages, as the frame knows them. */
const PAGES: SitePage[] = ["index", "trust", "whats-new", "technical"];
/** Each page's own link, in both bars: the front page's is the website's name, in the top bar alone. */
const OWN_HREF: Record<SitePage, string> = {
  index: INDEX_HREF,
  trust: TRUST_PAGE_HREF,
  "whats-new": WHATS_NEW_HREF,
  technical: TECHNICAL_HREF,
};

/** The website's own page, drawn by the voicecap of FACTS: its bottom bar says FACTS's version. */
const frontPage = (content: SiteContent): string => renderSiteIndex(content, FACTS);

/** The website's four pages, each drawn from the tests' facts, by the page it is. */
function fourPages(): [SitePage, string][] {
  return [
    ["index", frontPage(CONTENT)],
    ["trust", renderTrustPage({ voicecap: FACTS, records: RECORDS })],
    ["whats-new", renderWhatsNew({ voicecap: FACTS })],
    ["technical", renderTechnical({ voicecap: FACTS, records: RECORDS, keptPerSite: 3 })],
  ];
}

/** The system's own fonts, as the audit tool uses them: the words', and the big numbers' and commands'. */
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace';

/**
 * The rules at a style's top level, each as what comes before its block (a selector, or an at-rule
 * such as `@media print`) and what's inside it. Comments are left out.
 */
function cssRules(css: string): { prelude: string; body: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: { prelude: string; body: string }[] = [];
  let depth = 0;
  let start = 0;
  let open = 0;
  for (let at = 0; at < text.length; at++) {
    if (text[at] === "{") {
      if (depth === 0) open = at;
      depth++;
    } else if (text[at] === "}") {
      depth--;
      if (depth === 0) {
        rules.push({ prelude: text.slice(start, open).trim(), body: text.slice(open + 1, at) });
        start = at + 1;
      }
    }
  }
  return rules;
}

/** A block's declarations, each as "name: value", with its white space made single spaces. */
function declarationsIn(body: string): string[] {
  return body
    .split(";")
    .map((declaration) => declaration.replace(/\s+/g, " ").trim())
    .filter((declaration) => declaration !== "");
}

/** The declarations of each top-level rule of `css` whose prelude is `prelude`, in order. */
function declarationsOf(css: string, prelude: string): string[] {
  return cssRules(css)
    .filter((rule) => rule.prelude === prelude)
    .flatMap((rule) => declarationsIn(rule.body));
}

/** The declarations of each top-level rule of `css` whose list of selectors holds `selector`. */
function declarationsFor(css: string, selector: string): string[] {
  return cssRules(css)
    .filter((rule) => rule.prelude.split(",").some((each) => each.trim() === selector))
    .flatMap((rule) => declarationsIn(rule.body));
}

/** What's inside the top-level rule of `css` whose prelude is `prelude`, such as `@media print`. */
function blockOf(css: string, prelude: string): string {
  const rule = cssRules(css).find((each) => each.prelude === prelude);
  if (rule === undefined) throw new Error(`The style has no ${prelude}.`);
  return rule.body;
}

/** How a policy names the hash of `text`: 'sha256-' and its SHA-256 as base64, in single quotes. */
function hashOf(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/** `text` as a pattern that matches only it. */
function patternOf(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

/** The top bar: the website's name, its navigation, and the theme button. */
const topBarOf = (markup: string): string =>
  /<header class="bar">[\s\S]*?<\/header>/.exec(markup)?.[0] ?? "";

/** The bottom bar. */
const bottomBarOf = (markup: string): string =>
  /<footer>[\s\S]*?<\/footer>/.exec(markup)?.[0] ?? "";

/** The front page's "On this page" row: the navigation of its views. */
const rowOf = (markup: string): string =>
  /<nav\b[^>]*\saria-label="On this page"[^>]*>[\s\S]*?<\/nav>/.exec(markup)?.[0] ?? "";

/** The front page's What's New banner: the newest release. */
const newsOf = (markup: string): string =>
  /<div class="news">[\s\S]*?<\/div>/.exec(markup)?.[0] ?? "";

/** Some markup's words as a screen reader gets them: without what it doesn't read. */
function heardOf(html: string): string {
  return textOf(html.replace(/<span[^>]*\saria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, ""), "");
}

/**
 * Each link in some markup, in order: where it goes, as a reader gets it, its words, and whether it
 * says it's the page the reader is on.
 */
function linksWithWordsOf(html: string): { href: string; words: string; current: boolean }[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, tag = "", inner = ""]) => ({
    href: decode(/\shref="([^"]*)"/.exec(tag)?.[1] ?? ""),
    words: textOf(inner, ""),
    current: /\saria-current="page"/.test(tag),
  }));
}

/** Where each link of some markup that says it's the page the reader is on goes. */
const currentIn = (html: string): string[] =>
  linksWithWordsOf(html)
    .filter(({ current }) => current)
    .map(({ href }) => href);

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

  beforeAll(() => {
    html = frontPage(CONTENT);
  });

  it("is one file: one style block, one script last, no style attribute, nothing from outside", () => {
    expect(html.match(/<style\b/g)).toHaveLength(1);
    expect(html.match(/<script\b/g)).toHaveLength(1);
    // The script is the last thing in the page.
    expect(html).toMatch(/<\/script>\n<\/body>\n<\/html>\n$/);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    // Nothing is loaded, linked, or framed, and no font is in the page, not even as data.
    for (const outside of ["src=", "srcset", "<link", "<iframe", "@import", "url("]) {
      expect(html, outside).not.toContain(outside);
    }
    // Its own code is what a Content Security Policy hashes: the one style block, and the one script.
    expect(inlineHashes(html)).toEqual({
      styles: [hashOf(`\n${SITE_CSS}`)],
      scripts: [hashOf(SITE_SCRIPT)],
    });
    // The commands are in <code>, so no backtick is in the page.
    expect(html).not.toContain("`");
  });

  it("draws the website in the system's fonts, and embeds none", () => {
    const page = frontPage(CONTENT);
    const style = /<style>([\s\S]*?)<\/style>/.exec(page)?.[1] ?? "";

    // No font is in the page, nor loaded from anywhere: its words are in the system's own fonts.
    expect(page).not.toContain("@font-face");
    expect(page).not.toContain("data:font/");
    expect(style).toContain(SANS);
    expect(style).toContain(MONO);
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

  it("links only to its files, its own anchors, the website's pages, the demo's pages, voicecap on GitHub and its CHANGELOG, and each site's own address", () => {
    const links = linksOf(html);
    const files = filesOf(CONTENT);
    const anchors = ["#main", "#demo", "#sites", "#by-date"];
    const allowed = [
      ...anchors,
      INDEX_HREF,
      TRUST_PAGE_HREF,
      WHATS_NEW_HREF,
      TECHNICAL_HREF,
      DEMO_PAGES_HREF,
      GITHUB,
      CHANGELOG,
      DVFR_ADDRESS,
      ...files.map(({ href }) => href),
    ];

    expect(links.filter(({ href }) => !allowed.includes(href))).toEqual([]);
    expect(new Set(links.map(({ href }) => href))).toEqual(new Set(allowed));
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
    // The three views are named by their headings; the top bar's navigation and the "On this page"
    // row by their labels, and the theme button by its own: no more.
    expect(html.match(/\saria-labelledby=/g)).toHaveLength(3);
    expect([...html.matchAll(/\saria-label="([^"]*)"/g)].map(([, label]) => label)).toEqual([
      "This website",
      "Switch to the light theme",
      "On this page",
    ]);
  });

  it("heads a site by its name, which needn't be a folder's, and makes its section's id from the name", () => {
    const page = frontPage({
      demo: null,
      sites: [
        {
          name: "voicecap.icjia.app",
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
    });

    expect(textsOf(sectionOf(page, "sites"), "h3")).toEqual([
      "voicecap.icjia.app",
      "dvfr.illinois.gov:8443",
    ]);
    for (const [id, name] of [
      ["site-voicecap.icjia.app", "voicecap.icjia.app"],
      ["site-dvfr.illinois.gov_8443", "dvfr.illinois.gov:8443"],
    ] as const) {
      expect(textsOf(sectionOf(page, id), "h3")[0], id).toBe(name);
    }
    // No section is made from a folder's name. A folder's name is only where its files are.
    expect(page).not.toContain('id="site-127.0.0.1_4848"');
    expect(page).not.toContain('id="site-localhost_3000"');
    // The report's page, linked from the current report and from the fold of files.
    expect(linksOf(sectionOf(page, "site-voicecap.icjia.app")).map(({ href }) => href)).toEqual([
      "127.0.0.1_4848/127.0.0.1_4848_page.html",
      "127.0.0.1_4848/127.0.0.1_4848_page.html",
    ]);
    // A screen reader hears each report's links named by the site's name, not its folder's.
    expect(textsOf(sectionOf(page, "site-voicecap.icjia.app"), "a")[0]).toBe(
      "Open the report of voicecap.icjia.app, 3 October 2026, 10:00",
    );
  });

  it("shows the reports of a site's folders under the site's one heading, as it was given them", () => {
    const folders = ["127.0.0.1_4848", DVFR];
    const reports = [
      { ...reportAt(DVFR, "2026-10-04T10:00:00-05:00"), id: `report-${DVFR}-2` },
      reportAt("127.0.0.1_4848", "2026-10-03T10:00:00-05:00"),
      reportAt(DVFR, "2026-10-02T10:00:00-05:00"),
    ];
    const page = frontPage({ demo: null, sites: [{ name: DVFR, folders, reports }] });

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
    const page = frontPage({ demo: null, sites: [{ name: DVFR, folders: [DVFR], reports }] });

    const site = sectionOf(page, `site-${DVFR}`);
    expect(reportIdsOf(site)).toEqual(reports.map(({ id }) => id));
    expect(earlierItemsOf(site)).toHaveLength(4);
    expect(sharedBlocksOf(site)).toHaveLength(5);
  });

  it("gives every id once, whatever the sites are named", () => {
    const page = frontPage({
      ...sitesAt(
        ["x", "2026-10-03T10:00:00-05:00"],
        ["x-h", "2026-10-02T10:00:00-05:00"],
        ["demo-h", "2026-10-01T10:00:00-05:00"],
        ["sites", "2026-09-30T10:00:00-05:00"],
      ),
      demo: DEMO_REPORT,
    });
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
    const page = frontPage({
      demo: null,
      sites: names.map((name, index) => ({
        name,
        folders: [`folder-${index}`],
        reports: [reportAt(`folder-${index}`, "2026-10-03T10:00:00-05:00")],
      })),
    });

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
          frontPage({
            demo: null,
            sites: [{ name, folders: [DVFR], reports: [DVFR_NEWEST], address }],
          }),
          `site-${name}`,
        ),
        "site",
      );

    // A site at a path of its host is a root too.
    const demo = "https://voicecap.icjia.app/demo-site/";
    expect(linksOf(withAddress(demo, "voicecap.icjia.app"))).toEqual([
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
    const one = frontPage(sitesAt([DVFR, "2026-10-03T14:05:00-05:00"]));
    expect(textsOf(headOf(sectionOf(one, "sites"), "view"), "span")).toEqual(["1 site"]);
    // With no report shared, there's nothing to count.
    const none = frontPage({ demo: null, sites: [] });
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
        frontPage({
          demo: null,
          sites: [{ name: DVFR, folders: [DVFR], reports: [DVFR_NEWEST, ...earlier] }],
        }),
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
        frontPage({
          demo: null,
          sites: [{ name: DVFR, folders: [DVFR], reports: [{ ...DVFR_NEWEST, result }] }],
        }),
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
      const page = frontPage({
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
      });

      expect(page.match(/class="verdict /g)).toHaveLength(1);
      expect(page.match(/class="reading"/g)).toHaveLength(1);
      expect(earlierItemsOf(page).join("")).not.toContain("attention");
    });

    it("gives the demo's card its verdict too", () => {
      const page = frontPage({
        demo: { ...DEMO_REPORT, result: { pages: 7, read: 7, problems: 3, problemPages: 2 } },
        sites: [],
      });
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
        frontPage({
          demo: null,
          sites: [{ name: DVFR, folders: [DVFR], reports: [report] }],
        }),
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
    const page = frontPage({
      demo: null,
      sites: [{ name: DVFR, folders: [DVFR], reports: [DVFR_NEWEST, withWord, wordOnly] }],
    });
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
      frontPage({
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
      });
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
    const page = frontPage({
      demo: null,
      sites: [{ name: DVFR, folders: [DVFR], reports: [empty] }],
    });
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
    // site that has them, the list by date, the "On this page" row's list of the views, and the
    // bottom bar's list of six: no other list.
    expect(tags.filter((tag) => /\sclass="files"/.test(tag))).toHaveLength(withFiles.length);
    expect(tags.filter((tag) => /\sclass="earlier"/.test(tag))).toHaveLength(withEarlier.length);
    expect(tags.filter((tag) => tag.startsWith("<ol"))).toHaveLength(1);
    expect(tags).toHaveLength(withFiles.length + withEarlier.length + 1 + 2);
    for (const tag of tags) expect(tag).toMatch(/\srole="list"/);
    expect(sectionOf(html, "by-date")).toMatch(/<ol\b[^>]*\srole="list"/);
    expect(rowOf(html)).toMatch(/<ul\b[^>]*\srole="list"/);
    expect(bottomBarOf(html)).toMatch(/<ul\b[^>]*\srole="list"/);
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
    const page = frontPage({
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
    });
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
    const page = frontPage(
      sitesAt(
        ["a.example.gov", "2026-10-03T03:00:00+02:00"],
        ["b.example.gov", "2026-10-03T00:30:00-05:00"],
        ["c.example.gov", "2026-10-02T23:00:00-05:00"],
      ),
    );

    expect(namesByDate(page)).toEqual(["b.example.gov", "c.example.gov", "a.example.gov"]);
  });

  it("keeps the order it was given for reports of the same moment", () => {
    const page = frontPage(
      sitesAt(
        ["a.example.gov", "2026-10-03T10:00:00-05:00"],
        ["b.example.gov", "2026-10-03T15:00:00Z"],
        ["c.example.gov", "2026-10-03T10:00:00-05:00"],
      ),
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
    const page = frontPage({
      demo: null,
      sites: [{ name: DVFR, folders: [DVFR], reports: [wordOnly] }, ...CONTENT.sites.slice(1)],
    });

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
      `voicecap&#39;s report on its own small demo site, as an example of what it makes. The site&#39;s pages are at <a href="${DEMO_PAGES_HREF}">voicecap.icjia.app/demo-site/</a>.`,
    );
    expect(linksOf(demo).filter(({ href }) => href === DEMO_PAGES_HREF)).toEqual([
      { href: DEMO_PAGES_HREF, download: false },
    ]);
    // Only the demo view has it, and the link's words are its address: the demo's canonical one.
    expect(linksOf(html).filter(({ href }) => href === DEMO_PAGES_HREF)).toHaveLength(1);
    expect(textsOf(demo, "a")[0]).toBe("voicecap.icjia.app/demo-site/");
    expect(`https://${textsOf(demo, "a")[0]}`).toBe(DEMO_CANONICAL);
    expect(demo).not.toMatch(/\shref="(?:[a-z][a-z0-9+.-]*:|\/)/i);
  });

  it("links the front page's views from its 'On this page' row", () => {
    const hrefs = (page: string): string[] => linksOf(rowOf(page)).map(({ href }) => href);

    // The views that are there, by their anchors on this page, in their order, each named by its
    // heading.
    expect(hrefs(html)).toEqual(["#demo", "#sites", "#by-date"]);
    expect(textsOf(rowOf(html), "a")).toEqual(["The demo", "The sites", "Every report, by date"]);
    for (const href of hrefs(html)) expect(html, href).toContain(`id="${href.slice(1)}"`);
    // No demo, no link to it; one site, no list by date, and no link to it; no report at all, the
    // sites alone.
    expect(hrefs(frontPage({ ...CONTENT, demo: null }))).toEqual(["#sites", "#by-date"]);
    expect(hrefs(frontPage({ demo: DEMO_REPORT, sites: CONTENT.sites.slice(0, 1) }))).toEqual([
      "#demo",
      "#sites",
    ]);
    expect(hrefs(frontPage({ demo: null, sites: [] }))).toEqual(["#sites"]);
    // A navigation, named for a screen reader, whose name stands before its links for the eye too,
    // hidden from a screen reader, which would otherwise hear it twice.
    expect(rowOf(html)).toMatch(/^<nav\b[^>]*\saria-label="On this page"/);
    expect(rowOf(html)).toContain('<p class="kicker" aria-hidden="true">On this page</p>');
    // After the page's heading and its lead, and before the first view.
    const places = ["<h1>", '<p class="lead">', rowOf(html), 'id="demo"'].map((part) =>
      html.indexOf(part),
    );
    expect(places.every((place) => place > 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    // The top bar holds none of them: its links are the website's pages.
    expect(linksOf(topBarOf(html)).map(({ href }) => href)).toEqual([
      INDEX_HREF,
      TRUST_PAGE_HREF,
      WHATS_NEW_HREF,
      TECHNICAL_HREF,
    ]);
    expect(topBarOf(html)).not.toMatch(/\shref="[^"]*#/);
  });

  it("puts the kicker over the front page's heading", () => {
    // The banner of the newest release opens the main part, above the kicker, which is left out
    // here: the kicker is the first thing after it.
    const banner = newsOf(html);
    expect(banner).not.toBe("");
    const main = (/<main id="main">\n([\s\S]*?)\n<\/main>/.exec(html)?.[1] ?? "").replace(
      `${banner}\n`,
      "",
    );
    const kicker = /^<p class="kicker">([\s\S]*?)<\/p>\n<h1>/.exec(main)?.[1] ?? "";

    // It's right over the heading, as the audit tool's trust page heads itself.
    expect(kicker).not.toBe("");
    // A reader sees its parts set apart by dots; a screen reader hears commas for them, and no dot.
    expect(textOf(withoutHidden(kicker), "")).toBe(
      "ICJIA · Built for Title II of the ADA · WCAG · Illinois IITAA",
    );
    expect(heardOf(kicker)).toBe("ICJIA, Built for Title II of the ADA, WCAG, Illinois IITAA");
    // Each dot after a space that doesn't break, so a dot ends a line rather than start one.
    expect(kicker.match(/<span aria-hidden="true">[^<]*<\/span>/g)).toEqual(
      Array.from({ length: 3 }, () => '<span aria-hidden="true">\u00a0·</span>'),
    );
    expect(kicker.match(/<span class="sr">[^<]*<\/span>/g)).toEqual(
      Array.from({ length: 3 }, () => '<span class="sr">,</span>'),
    );
    // The three names are the words that matter in it, in --act.
    expect(
      [...kicker.matchAll(/<span class="act">([^<]*)<\/span>/g)].map(([, name]) => name),
    ).toEqual(["Title II of the ADA", "WCAG", "Illinois IITAA"]);
    // Its words are the page's own, written in ordinary case, as pieces that mark the names.
    expect(SITE_TEXT.kicker).toEqual([
      ["ICJIA"],
      ["Built for ", { name: "Title II of the ADA" }],
      [{ name: "WCAG" }],
      [{ name: "Illinois IITAA" }],
    ]);
    // The same on a page with no demo, no site, and no release, where the kicker opens the main part.
    const bare = renderSiteIndex({ demo: null, sites: [] }, { ...FACTS, releases: [] });
    expect(bare).toContain(`<main id="main">\n<p class="kicker">${kicker}</p>\n<h1>`);
  });

  it("opens the main part with the newest release, above the kicker and the heading, and before 'On this page'", () => {
    const banner = newsOf(html);
    const [newest] = FACTS.releases;
    if (newest === undefined) throw new Error("The facts have a release.");

    // A card that's no landmark: "What's new", as a kicker; the version, a pill in --good; its
    // headline; and the day it was released, with the link to every update.
    expect(banner).toMatch(/^<div class="news">\n<p class="kicker">What&#39;s new<\/p>\n/);
    expect(banner).toContain(`<span class="pill good">${newest.version}</span>`);
    expect(textsOf(banner, "p")).toEqual([
      "What's new",
      newest.headline,
      "Released 9 October 2026 · See all updates",
    ]);
    // The dot after the day is after a space that doesn't break, so it ends a line rather than
    // start one.
    expect(banner).toContain(
      `<p class="released">Released <time datetime="${newest.date}">9 October 2026</time>\u00a0<span class="sep" aria-hidden="true">·</span> <a href="whats-new.html">See all updates</a></p>`,
    );
    expect(linksWithWordsOf(banner)).toEqual([
      { href: WHATS_NEW_HREF, words: "See all updates", current: false },
    ]);
    expect(banner).not.toMatch(
      /<(?:section|nav|aside|header|footer|h[1-6])\b|\srole=|\saria-label/,
    );
    // The main part opens with it, as the audit tool's front page opens with its own, and the
    // kicker comes next; "On this page" follows the lead, with nothing between them.
    expect(html).toContain(`<main id="main">\n${banner}\n<p class="kicker">`);
    expect(html).toMatch(/<p class="lead">[^<]*<\/p>\n<nav class="jump"/);
    expect(html.match(/<div class="news">/g)).toHaveLength(1);

    // It's the newest release the facts give, the CHANGELOG's first: here, one of 8 October.
    const older = newsOf(renderSiteIndex(CONTENT, { ...FACTS, releases: FACTS.releases.slice(1) }));
    expect(older).toContain('<span class="pill good">0.13.1</span>');
    expect(textsOf(older, "p")).toEqual([
      "What's new",
      "The website's headings say more at a glance, and each site links to the site itself",
      "Released 8 October 2026 · See all updates",
    ]);
  });

  it("puts the banner before the kicker and the heading, and the page's first heading is still its h1", () => {
    // The page's headings, each as its level and its words, in order.
    const outlineOf = (page: string): [number, string][] =>
      [...page.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map(
        ([, level = "", inner = ""]): [number, string] => [Number(level), textOf(inner, "")],
      );
    const banner = newsOf(html);
    const heading = html.indexOf("<h1>");
    // The banner has a kicker of its own, so the page's is the last before its heading.
    const kicker = html.lastIndexOf('<p class="kicker">', heading);

    // The banner comes first in the main part, then the kicker, the h1, its lead, and "On this
    // page", each after the one before.
    expect(banner).not.toBe("");
    const places = [
      html.indexOf('<main id="main">'),
      html.indexOf(banner),
      kicker,
      heading,
      html.indexOf('<p class="lead">'),
      html.indexOf(rowOf(html)),
    ];
    expect(places.every((place) => place > 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(new Set(places).size).toBe(places.length);
    // The page's kicker starts after the banner ends: it isn't the banner's own.
    expect(kicker).toBeGreaterThanOrEqual(html.indexOf(banner) + banner.length);
    // The banner is no heading, so what it opens above doesn't change the page's outline: its first
    // heading is the h1, the page's one, and the outline is what it is with no banner.
    expect(banner).not.toMatch(/<h[1-6]\b/);
    const bare = renderSiteIndex(CONTENT, { ...FACTS, releases: [] });
    expect(newsOf(bare)).toBe("");
    expect(outlineOf(html)[0]).toEqual([1, "Screen reader test results"]);
    expect(outlineOf(html).filter(([level]) => level === 1)).toHaveLength(1);
    expect(outlineOf(html)).toEqual(outlineOf(bare));
    // Nor is the banner a landmark: the page's landmarks are the same with it and without it.
    const landmarks = (page: string): string[] =>
      [...page.matchAll(/<(header|nav|main|footer|section|aside)\b[^>]*>/g)].map(
        ([tag = ""]) => tag,
      );
    expect(landmarks(html)).toEqual(landmarks(bare));
  });

  it("shows no banner when no release is recorded", () => {
    const page = renderSiteIndex(CONTENT, { ...FACTS, releases: [] });

    expect(page).not.toContain('class="news"');
    expect(page).not.toContain("What&#39;s new");
    expect(page).not.toContain("See all updates");
    // The kicker opens the main part, as it did before there was a banner.
    expect(page).toMatch(/<main id="main">\n<p class="kicker">[\s\S]*?<\/p>\n<h1>/);
    // The lead is followed by "On this page", with nothing between them.
    expect(page).toMatch(/<p class="lead">[^<]*<\/p>\n<nav class="jump"/);
    // A release with no headline has a banner with none, and no empty paragraph.
    const plain = newsOf(
      renderSiteIndex(CONTENT, {
        ...FACTS,
        releases: [{ version: "0.15.0", date: "2026-10-09", headline: "", items: [] }],
      }),
    );
    expect(textsOf(plain, "p")).toEqual([
      "What's new",
      "Released 9 October 2026 · See all updates",
    ]);
    expect(plain).not.toContain('class="headline"');
  });

  it("draws the newest release's words in the banner as plain text, whatever they hold", () => {
    // A CHANGELOG line with markup in it, an ampersand, and quotes, and a version that would end an
    // attribute. (A headline has no backtick, which the CHANGELOG's reader takes out, and a date is
    // always YYYY-MM-DD: it takes no other.)
    const hostile = "<script>alert(1)</script> & a lone ' and \" too";
    const banner = newsOf(
      renderSiteIndex(CONTENT, {
        ...FACTS,
        releases: [
          { version: '0.15.0"><b>x</b>', date: "2026-10-09", headline: hostile, items: [] },
          ...FACTS.releases,
        ],
      }),
    );

    expect(banner).toContain(
      '<p class="headline">&lt;script&gt;alert(1)&lt;/script&gt; &amp; a lone &#39; and &quot; too</p>',
    );
    expect(banner).toContain('<span class="pill good">0.15.0&quot;&gt;&lt;b&gt;x&lt;/b&gt;</span>');
    expect(textsOf(banner, "p")[1]).toBe(hostile);
    const { elements, attributes } = namesIn(banner);
    expect(elements.filter((element) => ["script", "b"].includes(element))).toEqual([]);
    expect(attributes.filter((name) => /^(?:on|style$|src)/.test(name))).toEqual([]);
  });

  it("has no demo view, and no link to one, without a demo", () => {
    const page = frontPage({ ...CONTENT, demo: null });

    expect(page).not.toContain('id="demo"');
    expect(page).not.toContain('href="#demo"');
    expect(page).not.toContain("The demo");
    expect(page).not.toContain("report-demo");
    expect(page).not.toContain("demo-site");
    // The row's links go to the views that are there.
    expect(textsOf(rowOf(page), "a")).toEqual(["The sites", "Every report, by date"]);
  });

  it("lists reports by date, with its link in the 'On this page' row, only when two sites or more have reports", () => {
    // With one site, the list would be that site's own again.
    const one = frontPage({ demo: DEMO_REPORT, sites: CONTENT.sites.slice(0, 1) });
    expect(one).not.toContain('id="by-date"');
    expect(one).not.toContain('href="#by-date"');
    expect(one).not.toContain("Every report, by date");
    expect(one).not.toMatch(/<ol\b/);
    expect(textsOf(rowOf(one), "a")).toEqual(["The demo", "The sites"]);
    // Two views are regions, named by their headings.
    expect(one.match(/\saria-labelledby=/g)).toHaveLength(2);

    // With two, it's there, after the sites, and in the row, after the sites' link.
    expect(textsOf(rowOf(html), "a")).toEqual(["The demo", "The sites", "Every report, by date"]);
    expect(html.indexOf('id="by-date"')).toBeGreaterThan(html.indexOf('id="sites"'));
  });

  it("says no reports have been shared yet when there are none", () => {
    const page = frontPage({ demo: null, sites: [] });

    expect(textsOf(sectionOf(page, "sites"), "p")).toEqual(["No reports have been shared yet."]);
    expect(page).not.toContain('id="by-date"');
    // No report, no list, no fold: the page's only lists are its row's and its bottom bar's.
    const main = (/<main id="main">([\s\S]*?)<\/main>/.exec(page)?.[1] ?? "").replace(
      rowOf(page),
      "",
    );
    expect(main).not.toMatch(/<article\b|<ol\b|<ul\b|<li\b|<details\b/);
    expect(textsOf(rowOf(page), "a")).toEqual(["The sites"]);

    // The demo isn't a site: with a demo and no site, the sites still have none.
    const withDemo = frontPage({ demo: DEMO_REPORT, sites: [] });
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
    const page = frontPage({
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
    });

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
        "voicecap's report on its own small demo site, as an example of what it makes. The site's pages are at voicecap.icjia.app/demo-site/.",
        "Each site's current report, with up to two earlier ones below it.",
        "Every site's reports, the newest first, each with its page.",
        "A file's SHA-256 fingerprint is the one recorded when it was shared, so a copy can be checked against it: Get-FileHash <file> in PowerShell, or shasum -a 256 <file> on a Mac. PowerShell shows the same letters in capitals.",
        "A walkthrough file repeats its run, with the same pages, passes, and limits: npx @icjia/voicecap --walkthrough <file>.",
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
    // The top bar: the website's name, and the label of its navigation, which names the website,
    // since its links go to its pages; the button, which is hidden until the script shows it, and
    // whose words are for a screen reader.
    expect(html).toContain(
      '<a class="name" href="index.html" aria-current="page">ICJIA Screen Reader Tests</a>',
    );
    expect(html).toContain('<nav aria-label="This website">');
    expect(html).toContain(
      '<button class="theme" id="theme-toggle" type="button" hidden aria-label="Switch to the light theme">',
    );
    // The bottom bar: its five links' words, and the version, as a reader sees it and as a screen
    // reader hears it.
    expect(textsOf(bottomBarOf(html), "a")).toEqual([
      "GitHub",
      "Changelog",
      "What's New",
      "Can I trust this?",
      "Technical details",
    ]);
    expect(bottomBarOf(html)).toContain(
      '<span aria-hidden="true">v0.13.2</span><span class="sr">voicecap version 0.13.2</span>',
    );
  });

  it("puts the skip link and the top bar first, then the main part with its banner, kicker, heading, row, and views, then the bottom bar and the script", () => {
    const places = [
      '<a class="skip" href="#main">Skip to main content</a>',
      '<header class="bar">',
      '<a class="name"',
      '<nav aria-label="This website">',
      '<main id="main">',
      '<div class="news">',
      // The page's own kicker: the banner's, inside its card, is the first `<p class="kicker">`.
      '<p class="kicker">ICJIA',
      "<h1>",
      '<p class="lead">',
      'aria-label="On this page"',
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
    // The bottom bar is a list, and nothing else: no line of words about voicecap.
    expect(textsOf(bottomBarOf(html), "p")).toEqual([]);
    expect(textsOf(bottomBarOf(html), "li")).toHaveLength(6);
  });

  it("never calls voicecap automated, or says a person listened", () => {
    const text = textOf(markupOf(html));

    expect(text).not.toMatch(/automat/i);
    expect(text).not.toMatch(/listen/i);
  });
});

describe("siteBar", () => {
  it("heads every page with the website's name, then three links, then the theme button", () => {
    const bar = siteBar("trust");

    // The website's name, a link to the front page.
    expect(bar).toContain('<a class="name" href="index.html">ICJIA Screen Reader Tests</a>');
    // Then the navigation, named for the website, with its three pages in this order, by their
    // names.
    const nav = /<nav aria-label="This website">([\s\S]*?)<\/nav>/.exec(bar)?.[1] ?? "";
    expect(linksWithWordsOf(nav)).toEqual([
      { href: TRUST_PAGE_HREF, words: "Can I trust this?", current: true },
      { href: WHATS_NEW_HREF, words: "What's New", current: false },
      { href: TECHNICAL_HREF, words: "Technical details", current: false },
    ]);
    // Then the theme button, the bar's last.
    const places = [
      '<a class="name"',
      '<nav aria-label="This website">',
      `href="${TRUST_PAGE_HREF}"`,
      `href="${WHATS_NEW_HREF}"`,
      `href="${TECHNICAL_HREF}"`,
      '<button class="theme"',
    ].map((part) => bar.indexOf(part));
    expect(places.every((place) => place >= 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    // On the trust page, only the trust link is the page the reader is on; on the front page, only
    // the name is.
    expect(currentIn(bar)).toEqual([TRUST_PAGE_HREF]);
    expect(currentIn(siteBar("index"))).toEqual([INDEX_HREF]);
    expect(siteBar("index")).toContain(
      '<a class="name" href="index.html" aria-current="page">ICJIA Screen Reader Tests</a>',
    );
    expect(SITE_TEXT.siteName).toBe("ICJIA Screen Reader Tests");
  });

  it.each(PAGES)(
    "on the %s page, says the page's own link, and no other, is the page the reader is on",
    (page) => {
      expect(currentIn(siteBar(page))).toEqual([OWN_HREF[page]]);
    },
  );

  it("is the same bar on every page but for which link is the page it's on, so the four can't drift apart", () => {
    const bars = PAGES.map((page) => siteBar(page).replace(' aria-current="page"', ""));

    expect(new Set(bars).size).toBe(1);
    // It's the header, the name, and the navigation with its three links and the button: nothing
    // else, and none of the front page's views, which its "On this page" row links to.
    expect(siteBar("whats-new")).toMatch(
      /^<header class="bar">\n<a class="name" href="index\.html">[^<]*<\/a>\n<nav aria-label="This website">\n(?:<a href="[^"#]*"[^>]*>[^<]*<\/a>\n){3}<button\b[^>]*>[\s\S]*<\/button>\n<\/nav>\n<\/header>$/,
    );
  });

  it("makes the theme button an icon with words for a screen reader", () => {
    const button = /<button\b[^>]*>([\s\S]*?)<\/button>/.exec(siteBar("index"));
    const inside = button?.[1] ?? "";

    // Hidden until the script shows it, as without the script it would do nothing. Its words are
    // its label's: what it switches to.
    expect(button?.[0]).toMatch(
      /^<button class="theme" id="theme-toggle" type="button" hidden aria-label="Switch to the light theme">/,
    );
    expect(SITE_TEXT.theme.light).toBe("Switch to the light theme");
    // A sun and a moon, of which the style shows the one for the theme, each hidden from a screen
    // reader, and no words for the eye.
    const icons = [...inside.matchAll(/<svg\b([^>]*)>/g)].map(([, tag = ""]) => tag);
    expect(icons.map((tag) => /\sclass="([^"]*)"/.exec(tag)?.[1])).toEqual([
      "icon sun",
      "icon moon",
    ]);
    for (const tag of icons) expect(tag).toMatch(/\saria-hidden="true"/);
    expect(textOf(inside)).toBe("");
  });
});

describe("siteFooter", () => {
  /** Each item of a bottom bar's list, as markup. */
  const itemsOf = (footer: string): string[] =>
    [
      ...(/<ul\b[^>]*>([\s\S]*?)<\/ul>/.exec(footer)?.[1] ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g),
    ].map(([, item = ""]) => item);

  it("ends every page with a list of six", () => {
    const footer = siteFooter("technical", "0.15.0");
    const items = itemsOf(footer);

    // A list, and nothing else, so a screen reader hears a list of six, and no dividers: those are
    // the style's.
    expect(footer).toMatch(/^<footer>\n<ul role="list">\n(?:<li>.*<\/li>\n){6}<\/ul>\n<\/footer>$/);
    expect(items).toHaveLength(6);
    // GitHub, the CHANGELOG, and the website's three pages, by their names, each in the same tab.
    expect(linksWithWordsOf(footer)).toEqual([
      { href: GITHUB, words: "GitHub", current: false },
      { href: CHANGELOG, words: "Changelog", current: false },
      { href: WHATS_NEW_HREF, words: "What's New", current: false },
      { href: TRUST_PAGE_HREF, words: "Can I trust this?", current: false },
      { href: TECHNICAL_HREF, words: "Technical details", current: true },
    ]);
    expect(footer).not.toContain("target=");
    // Then the version, which a reader sees as "v0.15.0", and a screen reader hears as "voicecap
    // version 0.15.0".
    expect(items[5]).toBe(
      '<span aria-hidden="true">v0.15.0</span><span class="sr">voicecap version 0.15.0</span>',
    );
    // An icon before each link's words, each hidden from a screen reader.
    const icons = footer.match(/<svg\b[^>]*>/g) ?? [];
    expect(icons).toHaveLength(5);
    for (const icon of icons) expect(icon).toMatch(/\saria-hidden="true"/);
    for (const item of items.slice(0, 5)) expect(item).toMatch(/^<a\b[^>]*><svg\b/);
  });

  it.each(PAGES)(
    "on the %s page, says its own link, when it has one, is the page the reader is on",
    (page) => {
      // The front page's own link is the website's name, in the top bar.
      expect(currentIn(siteFooter(page, "0.15.0"))).toEqual(
        page === "index" ? [] : [OWN_HREF[page]],
      );
    },
  );

  it("is the same on every page but for which link is the page it's on", () => {
    const footers = PAGES.map((page) =>
      siteFooter(page, "0.15.0").replace(' aria-current="page"', ""),
    );

    expect(new Set(footers).size).toBe(1);
  });

  it("draws the version it's given as text", () => {
    const footer = siteFooter("index", '0.15.0<b>"x"</b>');

    expect(footer).toContain(
      '<span aria-hidden="true">v0.15.0&lt;b&gt;&quot;x&quot;&lt;/b&gt;</span><span class="sr">voicecap version 0.15.0&lt;b&gt;&quot;x&quot;&lt;/b&gt;</span>',
    );
    expect(footer).not.toContain("<b>");
  });
});

describe("backLink", () => {
  it("leads back to the test results, after an arrow a screen reader skips", () => {
    expect(backLink()).toMatch(
      /^<a class="back" href="index\.html"><svg\b[^>]*\saria-hidden="true"[^>]*>[\s\S]*?<\/svg>Back to the test results<\/a>$/,
    );
  });
});

describe("sitePage", () => {
  const PARTS = {
    title: "A page of the website",
    current: "whats-new",
    version: "0.15.0",
    main: ["<h1>The page</h1>", "<p>Its words</p>"],
  } as const;

  it("is the shell around what it's given: the head, the skip link, the top bar of its page, the main part, the bottom bar with the version, and the script", () => {
    // The style block is the website's style alone: no font goes ahead of it.
    expect(sitePage({ ...PARTS, main: [...PARTS.main] })).toBe(
      [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="robots" content="noindex, nofollow, noarchive">',
        "<title>A page of the website</title>",
        `<style>\n${SITE_CSS}</style>`,
        "</head>",
        "<body>",
        '<a class="skip" href="#main">Skip to main content</a>',
        siteBar("whats-new"),
        '<main id="main">',
        "<h1>The page</h1>",
        "<p>Its words</p>",
        "</main>",
        siteFooter("whats-new", "0.15.0"),
        `<script>${SITE_SCRIPT}</script>`,
        "</body>",
        "</html>",
        "",
      ].join("\n"),
    );
  });

  it("escapes the title, which is text, and takes the main part as the markup it is", () => {
    const page = sitePage({
      title: 'Q & A <i>"x"</i>',
      current: "index",
      version: "0.15.0",
      main: ["<h1>A &amp; B</h1>"],
    });

    expect(page).toContain("<title>Q &amp; A &lt;i&gt;&quot;x&quot;&lt;/i&gt;</title>");
    expect(page).toContain('\n<main id="main">\n<h1>A &amp; B</h1>\n</main>\n');
  });
});

describe("the website's four pages", () => {
  it("gives each the two bars of its page, the same but for the link of the page it's on", () => {
    const pages = fourPages();

    for (const [current, html] of pages) {
      expect(html, current).toContain(`\n${siteBar(current)}\n<main id="main">\n`);
      expect(html, current).toContain(`\n</main>\n${siteFooter(current, FACTS.version)}\n<script>`);
    }
    // Every page's bars are the same, but for the link that says it's the page the reader is on.
    const frames = pages.map(([, html]) =>
      `${topBarOf(html)}\n${bottomBarOf(html)}`.replaceAll(' aria-current="page"', ""),
    );
    expect(new Set(frames).size).toBe(1);
    // Each page's own link, in both bars, is the one that says so.
    for (const [current, html] of pages) {
      expect(currentIn(`${topBarOf(html)}${bottomBarOf(html)}`), current).toEqual(
        current === "index" ? [INDEX_HREF] : [OWN_HREF[current], OWN_HREF[current]],
      );
    }
  });

  it("opens the trust page, Technical details, and What's New with the way back", () => {
    const mainOf = (html: string): string =>
      /<main id="main">\n([\s\S]*?)\n<\/main>/.exec(html)?.[1] ?? "";

    for (const [current, html] of fourPages()) {
      if (current === "index") {
        // The front page is where it leads: it has none.
        expect(html).not.toContain('class="back"');
        continue;
      }
      expect(mainOf(html).startsWith(`${backLink()}\n`), current).toBe(true);
      expect(html.match(/<a class="back"/g), current).toHaveLength(1);
      const back = linksWithWordsOf(backLink());
      expect(back).toEqual([
        { href: INDEX_HREF, words: "Back to the test results", current: false },
      ]);
    }
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

// The shared reports keep their look: the website's style no longer takes their theme (see SITE_CSS).
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
  /** The audit tool's colors, as the spec gives them: each token, its dark value, and its light one. */
  const TOKENS = [
    ["--bg", "#0a0a0a", "#f9fafb"],
    ["--panel", "#111111", "#ffffff"],
    ["--panel-2", "#141414", "#f3f4f6"],
    ["--line", "#222222", "#e5e7eb"],
    ["--heading", "#ffffff", "#111827"],
    ["--text", "#f5f5f5", "#1f2937"],
    ["--text-2", "#d4d4d4", "#374151"],
    ["--muted", "#a3a3a3", "#4b5563"],
    ["--link", "#60a5fa", "#2563eb"],
    ["--good", "#34d399", "#196549"],
    ["--warn", "#fbbf24", "#705510"],
    ["--bad", "#f87171", "#8b3f3f"],
    ["--act", "#67e8f9", "#2c626a"],
  ] as const;

  it.each(TOKENS)(
    "has the audit tool's colors, dark first, light when picked, light in print: %s",
    (token, dark, light) => {
      expect(declarationsOf(SITE_CSS, ":root")).toContain(`${token}: ${dark}`);
      expect(declarationsOf(SITE_CSS, ':root[data-theme="light"]')).toContain(`${token}: ${light}`);
      expect(declarationsOf(blockOf(SITE_CSS, "@media print"), ":root")).toContain(
        `${token}: ${light}`,
      );
    },
  );

  it("is dark first, light when picked, and light in print, where the theme button is left out", () => {
    expect(declarationsOf(SITE_CSS, ":root")).toContain("color-scheme: dark");
    expect(declarationsOf(SITE_CSS, ':root[data-theme="light"]')).toContain("color-scheme: light");
    const print = blockOf(SITE_CSS, "@media print");
    expect(declarationsOf(print, ":root")).toContain("color-scheme: light");
    expect(declarationsOf(print, ".theme")).toEqual(["display: none"]);
    // The dark colors come first, and the light ones after them, which take their place.
    expect(SITE_CSS.indexOf(":root {")).toBeLessThan(SITE_CSS.indexOf(':root[data-theme="light"]'));
    expect(SITE_CSS.indexOf(':root[data-theme="light"]')).toBeLessThan(
      SITE_CSS.indexOf("@media print"),
    );
  });

  it.each(["--good", "--warn", "--bad", "--act"])(
    "tints %s at 12%, for what sits behind a pill or a box, in whichever theme",
    (token) => {
      // Made from the token, on the root, so it follows the theme the token is in.
      expect(declarationsOf(SITE_CSS, ":root")).toContain(
        `${token}-tint: color-mix(in srgb, var(${token}) 12%, transparent)`,
      );
    },
  );

  it("sets headlines at weight 900 and kickers at 700, in capitals set by the style", () => {
    expect(declarationsFor(SITE_CSS, "h1")).toEqual(
      expect.arrayContaining([
        "font-weight: 900",
        "color: var(--heading)",
        "font-size: clamp(2.125rem, 6vw, 3.875rem)",
        "line-height: 1.05",
      ]),
    );
    expect(declarationsFor(SITE_CSS, "h2")).toEqual(
      expect.arrayContaining([
        "font-weight: 900",
        "color: var(--heading)",
        "font-size: clamp(1.625rem, 4.2vw, 2.5rem)",
      ]),
    );
    // A kicker is written in ordinary case, so a screen reader reads words, not letters: the
    // capitals are the style's, drawn as small capitals, which leave the words as they're written.
    // A small capital is about as tall as a lowercase letter, so it's drawn at the caps scale, 1.4
    // times the spec's 0.8125rem, to stand as tall as the spec's capitals; its spacing and its line
    // are divided by the scale, so they stay the spec's.
    expect(declarationsFor(SITE_CSS, ".kicker")).toEqual(
      expect.arrayContaining([
        "font-size: calc(0.8125rem * var(--caps-scale))",
        "font-weight: 700",
        "letter-spacing: calc(0.14em / var(--caps-scale))",
        "line-height: calc(1.4 / var(--caps-scale))",
        "font-variant-caps: all-small-caps",
        "color: var(--muted)",
      ]),
    );
  });

  it("draws every capital it sets as a small capital, and never changes the words themselves", () => {
    // Chromium gives a screen reader the words as `text-transform` makes them, in capitals, letter
    // for letter. A small capital is only how a letter is drawn: the words reach a screen reader as
    // they're written. A kicker, a pill, a law's tag, and a table's header row are the parts in
    // capitals; a verdict is a pill, but a sentence, in ordinary case.
    expect(SITE_CSS).not.toMatch(/text-transform:\s*uppercase/);
    for (const selector of [".kicker", ".pill", ".tag", "th"]) {
      expect(declarationsFor(SITE_CSS, selector), selector).toContain(
        "font-variant-caps: all-small-caps",
      );
    }
    expect(declarationsFor(SITE_CSS, ".verdict").join("; ")).not.toContain("font-variant-caps");
  });

  it("draws its short labels, a kicker, a law's tag, and a table's header, at the caps scale, 1.4 times the spec's size, with the spec's spacing and line", () => {
    // One scale for all three, on the root.
    expect(declarationsOf(SITE_CSS, ":root")).toContain("--caps-scale: 1.4");
    // A law's tag: the spec's 0.8125rem and 0.06em, a line of 1.4, and 0.22em inside above and
    // below, a pixel more than a pill at the browser's own text size and more as the text grows,
    // so its text's box, taller than its line, stays on its own color at any size.
    expect(declarationsFor(SITE_CSS, ".tag")).toEqual(
      expect.arrayContaining([
        "font-size: calc(0.8125rem * var(--caps-scale))",
        "letter-spacing: calc(0.06em / var(--caps-scale))",
        "line-height: calc(1.4 / var(--caps-scale))",
        "font-variant-caps: all-small-caps",
        "padding-block: 0.22em",
      ]),
    );
    // A table's header: the spec's 0.75rem and 0.08em, and the body's line of 1.55, which it
    // would otherwise take on.
    expect(declarationsFor(SITE_CSS, "th")).toEqual(
      expect.arrayContaining([
        "font-size: calc(0.75rem * var(--caps-scale))",
        "letter-spacing: calc(0.08em / var(--caps-scale))",
        "line-height: calc(1.55 / var(--caps-scale))",
        "font-variant-caps: all-small-caps",
      ]),
    );
    // A pill's own size is the spec's: a version is digits, which small capitals leave as they are.
    expect(declarationsFor(SITE_CSS, ".pill")).toEqual(
      expect.arrayContaining(["font-size: 0.8125rem", "letter-spacing: 0.06em"]),
    );
  });

  it("sets the words at the audit tool's sizes, in the system's fonts", () => {
    expect(declarationsOf(SITE_CSS, ":root")).toEqual(
      expect.arrayContaining([`--sans: ${SANS}`, `--mono: ${MONO}`]),
    );
    expect(declarationsFor(SITE_CSS, "body")).toEqual(
      expect.arrayContaining([
        "font-family: var(--sans)",
        "font-size: 1.0625rem",
        "color: var(--text)",
        "background: var(--bg)",
      ]),
    );
    expect(declarationsFor(SITE_CSS, ".lead")).toEqual(
      expect.arrayContaining([
        "font-size: clamp(1rem, 2vw, 1.1875rem)",
        "color: var(--muted)",
        "max-width: 64ch",
      ]),
    );
    expect(declarationsFor(SITE_CSS, "code")).toContain("font-family: var(--mono)");
  });

  it("lets the bar scroll with the page", () => {
    // As the audit tool's does: nothing sticks, so no room is kept clear of it either.
    expect(SITE_CSS).not.toContain("position: sticky");
    expect(SITE_CSS).not.toContain("scroll-padding-top");
  });

  it("draws the audit tool's parts: a card, a part of a page, a pill, a big number, a table, and a button", () => {
    // A card: on the panel, a thin line around it, round corners, and 22 by 20 pixels inside.
    expect(declarationsFor(SITE_CSS, ".card")).toEqual(
      expect.arrayContaining([
        "background: var(--panel)",
        "border: 1px solid var(--line)",
        "border-radius: 14px",
        "padding: 22px 20px",
      ]),
    );
    // A part: 44 pixels above and below it, and a line between it and the part before.
    expect(declarationsFor(SITE_CSS, ".part")).toEqual(
      expect.arrayContaining(["padding-block: 44px", "border-top: 1px solid var(--line)"]),
    );
    // A pill: small, in small capitals, at 700, in its color on its color's tint, corners of 6
    // pixels.
    expect(declarationsFor(SITE_CSS, ".pill")).toEqual(
      expect.arrayContaining([
        "font-weight: 700",
        "font-variant-caps: all-small-caps",
        "border-radius: 6px",
      ]),
    );
    for (const color of ["good", "warn", "bad", "act"]) {
      expect(declarationsFor(SITE_CSS, `.pill.${color}`), color).toEqual(
        expect.arrayContaining([`color: var(--${color})`, `background: var(--${color}-tint)`]),
      );
    }
    // A law's tag is a pill in --act, and a card's words leave its color alone.
    expect(declarationsFor(SITE_CSS, ".tag")).toEqual(
      expect.arrayContaining(["color: var(--act)", "background: var(--act-tint)"]),
    );
    expect(cssRules(SITE_CSS).map(({ prelude }) => prelude)).not.toContain(".card > p");
    // A big number: heavy, in the fixed-width font with figures of one width, sized to its card.
    expect(declarationsFor(SITE_CSS, ".n")).toEqual(
      expect.arrayContaining([
        "font-weight: 900",
        "font-family: var(--mono)",
        "font-variant-numeric: tabular-nums",
        "font-size: clamp(1.5rem, 17cqi, 2.375rem)",
      ]),
    );
    expect(declarationsFor(SITE_CSS, ".tile")).toContain("container-type: inline-size");
    // A table scrolls in its own box, and its header row is small, in small capitals, on the second
    // panel.
    expect(declarationsFor(SITE_CSS, ".scroll")).toContain("overflow-x: auto");
    expect(declarationsFor(SITE_CSS, "th")).toEqual(
      expect.arrayContaining([
        "font-variant-caps: all-small-caps",
        "color: var(--muted)",
        "background: var(--panel-2)",
      ]),
    );
    // A button: an outline in the line's color, with words in the headline's on the panel.
    for (const button of [".action", ".visit"]) {
      expect(declarationsFor(SITE_CSS, button), button).toEqual(
        expect.arrayContaining([
          "border: 1px solid var(--line)",
          "color: var(--heading)",
          "background: var(--panel)",
        ]),
      );
    }
  });

  it("draws the front page's banner as a card, its version's pill at its left and its words beside it", () => {
    // The card's look, from the card's own rule.
    expect(declarationsFor(SITE_CSS, ".news")).toEqual(
      expect.arrayContaining([
        "background: var(--panel)",
        "border: 1px solid var(--line)",
        "border-radius: 14px",
        "padding: 22px 20px",
      ]),
    );
    expect(cssRules(SITE_CSS).some(({ prelude }) => prelude === ".card, .news")).toBe(true);
    // The pill in a column of its own, no wider than 40% of the card, so a long version breaks in
    // it; the kicker, the headline, and the day beside it, in a column that shrinks to nothing.
    expect(declarationsFor(SITE_CSS, ".news")).toEqual(
      expect.arrayContaining([
        "grid-template-columns: fit-content(40%) minmax(0, 1fr)",
        'grid-template-areas: "pill kicker" "pill headline" "pill released"',
      ]),
    );
    for (const [part, area] of [
      [".news > .pill", "pill"],
      [".news > .kicker", "kicker"],
      [".news > .headline", "headline"],
      [".news > .released", "released"],
    ] as const) {
      expect(declarationsFor(SITE_CSS, part), part).toContain(`grid-area: ${area}`);
    }
    // The day it was released and the link to every update are quieter and smaller.
    expect(declarationsFor(SITE_CSS, ".news > .released")).toEqual(
      expect.arrayContaining(["color: var(--muted)", "font-size: 0.875rem"]),
    );
    // It opens the main part, under the top bar, which the main part's own padding keeps it clear
    // of: it has no room above it, and 28 pixels under it, a clear gap before the page's kicker.
    expect(declarationsFor(SITE_CSS, ".news")).toContain("margin-bottom: 28px");
    expect(
      declarationsFor(SITE_CSS, ".news").filter((declaration) =>
        /^margin(?:-top)?:/.test(declaration),
      ),
    ).toEqual([]);
  });

  it("draws the trust page's stamp as the audit tool's amber box, and a headline's second line in --good, on a line of its own", () => {
    // A 2px line in --warn round it, on --warn-tint, in --warn: its label at its left, and the
    // records' date at its right, at weight 900, which goes under the label where there's no room.
    expect(declarationsFor(SITE_CSS, ".stamp")).toEqual(
      expect.arrayContaining([
        "border: 2px solid var(--warn)",
        "background: var(--warn-tint)",
        "color: var(--warn)",
        "display: flex",
        "flex-wrap: wrap",
        "justify-content: space-between",
      ]),
    );
    expect(declarationsFor(SITE_CSS, ".stamp > .date")).toContain("font-weight: 900");
    expect(declarationsFor(SITE_CSS, ".stamp > .source")).toContain("font-weight: 700");
    expect(declarationsFor(SITE_CSS, "h1 .good")).toEqual(["color: var(--good)", "display: block"]);
  });

  it("draws a card's title that's a link as a link on every page, and a release's version as What's New's pill", () => {
    // A link is in --link, and underlined, as the spec's colors have every link: a card's heading
    // leaves a link in it alone, the trust page's cards' in --good and Technical details' related
    // documents' in the headline's color alike. No rule anywhere gives a heading's link its own
    // color.
    expect(declarationsFor(SITE_CSS, ".card > h3")).toContain("color: var(--good)");
    expect(declarationsFor(SITE_CSS, ".related-cards > .card > h3")).toContain(
      "color: var(--heading)",
    );
    expect(
      cssRules(SITE_CSS)
        .flatMap(({ prelude }) => prelude.split(","))
        .map((selector) => selector.trim())
        .filter((selector) => /\bh[1-6]\b[^,]*\ba\b/.test(selector)),
    ).toEqual([]);
    // A release's line on the trust page is What's New's: its version a pill, and its day quieter.
    expect(declarationsFor(SITE_CSS, ".releases .on")).toEqual(
      declarationsFor(SITE_CSS, ".update-line"),
    );
    expect(declarationsFor(SITE_CSS, ".releases .on time")).toEqual(["color: var(--muted)"]);
    expect(cssRules(SITE_CSS).map(({ prelude }) => prelude)).not.toContain(".releases .version");
    // The trust page's line of links is gone: the bottom bar has them.
    expect(cssRules(SITE_CSS).map(({ prelude }) => prelude)).not.toContain(".links");
  });

  it("draws the verdicts in the audit tool's colors: green as good, amber as warn, red as bad", () => {
    for (const [kind, color] of [
      ["ok", "good"],
      ["warn", "warn"],
      ["bad", "bad"],
    ] as const) {
      expect(declarationsFor(SITE_CSS, `.verdict.${kind}`), kind).toEqual(
        expect.arrayContaining([`color: var(--${color})`, `background: var(--${color}-tint)`]),
      );
      expect(declarationsFor(SITE_CSS, `.reading .c-${kind}`), kind).toEqual([
        `color: var(--${color})`,
      ]);
    }
  });

  it("is the website's own, not the shareable page's theme, and takes that page's rules for focus, the skip link, .sr, and [hidden], focus in the website's link color", () => {
    // It begins with its own colors, and holds none of the shareable page's theme or its names.
    expect(SITE_CSS.startsWith(":root {\n  --bg: #0a0a0a;")).toBe(true);
    expect(SITE_CSS).not.toContain(THEME_CSS);
    for (const name of ["--accent", "--fg", "--ok", "--mac", "--display", "--body"]) {
      expect(SITE_CSS, name).not.toContain(`var(${name})`);
    }
    const shared = SHARE_CSS.split("\n");
    const mine = SITE_CSS.split("\n");
    for (const rule of [/^\.skip \{/, /^\.sr \{/, /^\[hidden\] \{/]) {
      const line = shared.find((candidate) => rule.test(candidate));
      expect(line, String(rule)).toBeDefined();
      expect(mine, String(rule)).toContain(line);
    }
    // Visible keyboard focus is the same rule, in the website's link color.
    const focus = shared.find((candidate) => candidate.startsWith("a { color: var(--accent); }"));
    expect(focus).toMatch(/a:focus-visible, button:focus-visible, summary:focus-visible \{/);
    expect(mine).toContain(focus?.replaceAll("var(--accent)", "var(--link)"));
  });

  it("holds nothing from outside, and nothing that could end the page's one style block", () => {
    expect(SITE_CSS).not.toMatch(/<\/style|<!--/i);
    expect(SITE_CSS).not.toMatch(/@import|url\(/);
    expect(SITE_CSS).toMatch(/\n$/);
  });

  it("widens its gutter from 40em, which is 640 pixels at 16, measures every width in em, and wraps what is long", () => {
    // The gutter is 16 pixels on a phone and 24 from 40em, for the main part and for what's in the
    // bars, whose content is a column of 72rem, as the main part is one of 56rem.
    expect(blockOf(SITE_CSS, "@media (min-width: 40em)")).toContain(
      "main { max-width: calc(56rem + 48px); padding-inline: 24px; }",
    );
    expect(declarationsFor(SITE_CSS, "main")).toEqual(
      expect.arrayContaining(["max-width: calc(56rem + 32px)", "padding: 48px 16px 64px"]),
    );
    expect(declarationsFor(SITE_CSS, ".bar")).toContain(
      "padding-inline: max(16px, calc(50% - 36rem))",
    );
    expect(SITE_CSS).toContain("overflow-wrap: anywhere");
    // An em in a media query is the reader's own text size, so a reader who has made it larger gets
    // the narrower layout in a wider window: a width in pixels would give the wider one to a window
    // that a larger size makes narrow. The trust page's four big numbers go two across from 36em,
    // and four from 60em, and Technical details' steps of a run two a row from 36em, and three
    // from 60em, by the same measure. The one other is no width at all: `screen`, for the footer at
    // the window's bottom, which print leaves as it was.
    const queries = [...SITE_CSS.matchAll(/@media ([^{]*)\{/g)].map(([, query = ""]) =>
      query.trim(),
    );
    expect(queries).toEqual([
      "print",
      "(min-width: 40em)",
      "(min-width: 36em)",
      "(min-width: 60em)",
      "(min-width: 36em)",
      "(min-width: 60em)",
      "screen",
    ]);
  });

  it("tells the link of the page the reader is on from the others by more than color, in both bars: bold, and underlined more heavily", () => {
    // The line is 0.15em thick, not a number of pixels: the others' underline is the browser's own,
    // which grows with the text, so a fixed thickness would be the lighter of the two at a large size.
    for (const selector of ['.bar nav a[aria-current="page"]', 'footer a[aria-current="page"]']) {
      expect(declarationsFor(SITE_CSS, selector), selector).toEqual(
        expect.arrayContaining([
          "color: var(--heading)",
          "font-weight: 700",
          "text-decoration: underline",
          "text-decoration-thickness: 0.15em",
        ]),
      );
    }
  });

  it("draws the top bar as the audit tool's: the website's name at 600 in the headline's color, and links in the quieter one, turning the headline's under the pointer", () => {
    expect(declarationsFor(SITE_CSS, ".bar .name")).toEqual(
      expect.arrayContaining(["font-weight: 600", "color: var(--heading)"]),
    );
    for (const links of [".bar nav a", "footer a", ".back"]) {
      expect(declarationsFor(SITE_CSS, links), links).toContain("color: var(--muted)");
      expect(declarationsFor(SITE_CSS, `${links}:hover`), links).toContain("color: var(--heading)");
    }
  });

  it("draws the bottom bar as a centered row that wraps, small and quieter, with dividers the style draws", () => {
    expect(declarationsFor(SITE_CSS, "footer")).toEqual(
      expect.arrayContaining([
        "font-size: 0.875rem",
        "color: var(--muted)",
        "border-top: 1px solid var(--line)",
      ]),
    );
    expect(declarationsFor(SITE_CSS, "footer ul")).toEqual(
      expect.arrayContaining([
        "list-style: none",
        "display: flex",
        "flex-wrap: wrap",
        "justify-content: center",
      ]),
    );
    // A thin line before each item but the first, which a screen reader doesn't hear: it hears a
    // list of six.
    expect(declarationsFor(SITE_CSS, "footer li + li")).toEqual([
      "border-left: 1px solid var(--line)",
    ]);
  });

  it("shows the theme button's sun in the dark theme and its moon in the light one, and keeps its corners when it has focus", () => {
    // Dark first: the sun, and the moon left out until the light theme is picked.
    expect(declarationsFor(SITE_CSS, ".theme .moon")).toEqual(["display: none"]);
    expect(declarationsFor(SITE_CSS, ':root[data-theme="light"] .theme .sun')).toEqual([
      "display: none",
    ]);
    expect(declarationsFor(SITE_CSS, ':root[data-theme="light"] .theme .moon')).toEqual([
      "display: block",
    ]);
    // The focus ring of a button rounds its corners at 4 pixels; the theme button keeps its own.
    const radius = declarationsFor(SITE_CSS, ".theme").find((each) =>
      each.startsWith("border-radius:"),
    );
    expect(radius).toEqual(expect.any(String));
    expect(declarationsFor(SITE_CSS, ".theme:focus-visible")).toContain(radius);
  });
});

describe("SITE_SCRIPT", () => {
  it("is one function, with nothing in it that can end the page's one script", () => {
    expect(SITE_SCRIPT.trim()).toMatch(/^\(function \(\) \{\n[\s\S]*\n\}\)\(\);$/);
    expect(SITE_SCRIPT).not.toMatch(/<!--|<\/?script/i);
    expect(SITE_SCRIPT).not.toMatch(/\b(style|src|href)\s*=/i);
    expect(() => new vm.Script(SITE_SCRIPT)).not.toThrow();
  });

  it("is the shareable page's theme, kept under the same name, but for the button's words, which are its label", () => {
    const themeOf = (script: string): string => {
      const start = script.indexOf("  function theme() {");
      const end = script.indexOf("\n  }\n", start);
      return script.slice(start, end + "\n  }\n".length);
    };
    const shared = themeOf(SHARE_SCRIPT);
    const sharedWords =
      'button.textContent = choice === "light" ? "Dark version" : "Light version";';

    expect(themeOf(SITE_SCRIPT)).toContain('var KEY = "voicecap-theme";');
    // The same theme as the shareable page's, so a choice carries between them; only the button's
    // words differ. The website's button is an icon, which the style changes with the theme, so its
    // words are its label, for a screen reader, where the shareable page's button has them as text.
    expect(shared).toContain(sharedWords);
    expect(themeOf(SITE_SCRIPT)).toBe(
      shared.replace(
        sharedWords,
        'button.setAttribute("aria-label", choice === "light" ? "Switch to the dark theme" : "Switch to the light theme");',
      ),
    );
    expect(SITE_SCRIPT).not.toContain("textContent");
    // The words of the button are the page's own.
    expect(SITE_SCRIPT).toContain(`"${SITE_TEXT.theme.dark}" : "${SITE_TEXT.theme.light}"`);
    expect(SITE_TEXT.theme).toEqual({
      light: "Switch to the light theme",
      dark: "Switch to the dark theme",
    });
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
