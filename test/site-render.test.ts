/**
 * The website's page, from what's published (src/site/render.ts): one file with one style block and
 * one script, its headings in order, each report with its files, what isn't there, and every
 * report by date. The content is small (test/helpers/site-content.ts): a demo, two sites with three
 * reports, a Word copy that isn't published, and a report with no walkthrough file.
 *
 * What the page does in a browser is in test/site-page-browser.test.ts.
 */
import { createHash } from "node:crypto";
import vm from "node:vm";

import { beforeAll, describe, expect, it } from "vitest";

import { fontFaceCss } from "../src/share/fonts.js";
import { SHARE_SCRIPT } from "../src/share/html/client.js";
import { SHARE_CSS, THEME_CSS } from "../src/share/html/style.js";
import { ABOUT } from "../src/share/text.js";
import { SITE_SCRIPT } from "../src/site/client.js";
import { inlineHashes } from "../src/site/headers.js";
import {
  fileKind,
  type PublishedReport,
  renderSiteIndex,
  type SiteContent,
} from "../src/site/render.js";
import { SITE_CSS } from "../src/site/style.js";
import { SITE_TEXT } from "../src/site/text.js";
import { decode, textOf } from "./helpers/share-html.js";
import {
  CONTENT,
  DEMO_REPORT,
  DVFR,
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

/** The folders of a list of reports by date, as the list gives them. */
function foldersByDate(html: string): (string | undefined)[] {
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

/** A content of one site with one report each of these folders, which were shared at these times. */
function sitesAt(...shared: [folder: string, at: string][]): SiteContent {
  return {
    demo: null,
    sites: shared.map(([folder, at]) => ({ folder, reports: [reportAt(folder, at)] })),
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

  it("links only to its files, its own anchors, and voicecap's GitHub page", () => {
    const links = linksOf(html);
    const files = filesOf(CONTENT);
    const anchors = ["#main", "#demo", "#sites", "#by-date"];
    const allowed = [...anchors, GITHUB, ...files.map(({ href }) => href)];

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

    expect(headings).toEqual([
      [1, "Screen reader test results"],
      [2, "The demo"],
      [3, "29 September 2026, 15:40"],
      [2, "The sites"],
      [3, DVFR],
      [4, "3 October 2026, 14:05"],
      [4, "29 September 2026, 16:20"],
      [3, EXAMPLE],
      [4, "2 October 2026, 09:30"],
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

  it("lists each report's files with their labels, sizes, and fingerprints", () => {
    const item = (label: string, name: string, size: string) =>
      `${label} ${name} ${size}, SHA-256 ${fingerprintOf(name)}`;

    expect(filesIn(articleOf(html, DEMO_REPORT.id))).toEqual([
      item("The report, to open", "127.0.0.1_4848_2026-09-29.html", "311 KB"),
      item("The Word copy", "127.0.0.1_4848_2026-09-29.docx", "47 KB"),
      item(
        "The walkthrough file of run 2026-09-29_1315",
        "127.0.0.1_4848_2026-09-29_2026-09-29_1315_walkthrough.json",
        "4 KB",
      ),
    ]);
    expect(filesIn(articleOf(html, DVFR_NEWEST.id))).toEqual([
      item("The report, to open", `${DVFR}_2026-10-03.html`, "324 KB"),
      item("The Word copy", `${DVFR}_2026-10-03.docx`, "51 KB"),
      item(
        "The walkthrough file of run 2026-10-03_1330",
        `${DVFR}_2026-10-03_2026-10-03_1330_walkthrough.json`,
        "5 KB",
      ),
    ]);
    // Only what's published is listed.
    expect(filesIn(articleOf(html, DVFR_OLDEST.id))).toEqual([
      item("The report, to open", `${DVFR}_2026-09-29.html`, "296 KB"),
    ]);
    // A walkthrough file whose run isn't known, and a file of another kind, are named for what
    // they are.
    expect(filesIn(articleOf(html, EXAMPLE_REPORT.id))).toEqual([
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
    const article = articleOf(html, DVFR_NEWEST.id);
    expect([...article.matchAll(/<code>(.*?)<\/code>/g)].map(([, code]) => code)).toEqual(
      DVFR_NEWEST.files.map(({ sha256 }) => sha256),
    );
    expect(textsOf(article, "a")).toEqual(DVFR_NEWEST.files.map(({ name }) => name));
  });

  it("says what isn't here, and when no walkthrough file was shared", () => {
    // A report with everything: nothing but who prepared it.
    expect(textsOf(articleOf(html, DVFR_NEWEST.id), "p")).toEqual(["Prepared by Pat Lee"]);
    // A copy that changed since it was shared, in a report that has no walkthrough file.
    expect(textsOf(articleOf(html, DVFR_OLDEST.id), "p")).toEqual([
      "Prepared by Pat Lee",
      `${DVFR}_2026-09-29.docx isn't here: it no longer matches the fingerprint recorded when it was shared.`,
      "No walkthrough file was shared with this report.",
    ]);
    // A copy that is missing, in a report that has walkthrough files.
    expect(textsOf(articleOf(html, EXAMPLE_REPORT.id), "p")).toEqual([
      "Prepared by Sam Rivera",
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
              folder: DVFR,
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
      textsOf(articleOf(withoutWalkthrough(reason), DVFR_NEWEST.id), "p");

    expect(lines("missing")).toEqual([
      "Prepared by Pat Lee",
      `${DVFR}_2026-10-03_walkthrough.json isn't here: the file is missing.`,
    ]);
    expect(lines("changed")).toEqual([
      "Prepared by Pat Lee",
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
      { demo: null, sites: [{ folder: DVFR, reports: [empty] }] },
      NO_FONTS,
    );
    const article = articleOf(page, empty.id);

    // No list with nothing in it, for a screen reader to announce.
    expect(article).not.toMatch(/<ul\b|<li\b/);
    expect(textsOf(article, "p")).toEqual([
      "Prepared by Pat Lee",
      `${DVFR}_2026-09-29.html isn't here: it no longer matches the fingerprint recorded when it was shared.`,
      "No walkthrough file was shared with this report.",
    ]);
  });

  it("gives each of its lists the role of a list, which WebKit takes from a list with no markers", () => {
    const tags = [...html.matchAll(/<(?:ul|ol)\b[^>]*>/g)].map(([tag]) => tag);
    const files = tags.filter((tag) => tag.startsWith("<ul"));
    const withFiles = [DEMO_REPORT, ...reportsOf(CONTENT)].filter(
      (shared) => shared.files.length > 0,
    );

    // A list of files for each report that has one published, and the list by date: no other list.
    expect(files).toHaveLength(withFiles.length);
    expect(tags.filter((tag) => tag.startsWith("<ol"))).toHaveLength(1);
    for (const tag of files) expect(tag).toMatch(/\sclass="files"/);
    for (const tag of tags) expect(tag).toMatch(/\srole="list"/);
    expect(sectionOf(html, "by-date")).toMatch(/<ol\b[^>]*\srole="list"/);
  });

  it("counts each site's reports", () => {
    expect(textsOf(sectionOf(html, `site-${DVFR}`), "p")[0]).toBe("2 reports");
    expect(textsOf(sectionOf(html, `site-${EXAMPLE}`), "p")[0]).toBe("1 report");

    const reports = Array.from({ length: 1204 }, (_, index) => ({
      ...reportAt(DVFR, "2026-10-03T10:00:00-05:00"),
      id: `report-${DVFR}-${index + 1}`,
    }));
    const many = renderSiteIndex({ demo: null, sites: [{ folder: DVFR, reports }] }, NO_FONTS);
    expect(textsOf(sectionOf(many, `site-${DVFR}`), "p")[0]).toBe("1,204 reports");
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

    expect(foldersByDate(page)).toEqual(["b.example.gov", "c.example.gov", "a.example.gov"]);
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

    expect(foldersByDate(page)).toEqual(["a.example.gov", "b.example.gov", "c.example.gov"]);
  });

  it("says a report's page isn't here, in its place by date, when it isn't published", () => {
    const wordOnly: PublishedReport = {
      ...DVFR_NEWEST,
      files: DVFR_NEWEST.files.filter(({ kind }) => kind === "word"),
      notPublished: [{ name: `${DVFR}_2026-10-03.html`, reason: "changed" }],
    };
    const page = renderSiteIndex(
      { demo: null, sites: [{ folder: DVFR, reports: [wordOnly] }] },
      NO_FONTS,
    );

    const [item] = [...sectionOf(page, "by-date").matchAll(/<li>([\s\S]*?)<\/li>/g)];
    expect(item?.[1]).toBe(
      `<time datetime="2026-10-03T14:05:00-05:00">3 October 2026, 14:05</time>, ${DVFR}, prepared by Pat Lee: its page isn&#39;t here`,
    );
    expect(textOf(item?.[1] ?? "")).toContain("its page isn't here");
  });

  it("has no demo view, and no link to one, without a demo", () => {
    const page = renderSiteIndex({ ...CONTENT, demo: null }, NO_FONTS);
    const barOf = (markup: string) => /<nav\b[\s\S]*?<\/nav>/.exec(markup)?.[0] ?? "";

    expect(page).not.toContain('id="demo"');
    expect(page).not.toContain('href="#demo"');
    expect(page).not.toContain("The demo");
    expect(page).not.toContain("report-demo");
    // The bar's links go to the views that are there.
    expect(textsOf(barOf(page), "a")).toEqual(["The sites", "Every report, by date"]);
    expect(textsOf(barOf(html), "a")).toEqual(["The demo", "The sites", "Every report, by date"]);
  });

  it("says no reports have been shared yet when there are none", () => {
    const page = renderSiteIndex({ demo: null, sites: [] }, NO_FONTS);

    expect(textsOf(sectionOf(page, "sites"), "p")).toEqual(["No reports have been shared yet."]);
    expect(textsOf(sectionOf(page, "by-date"), "p")).toEqual(["No reports have been shared yet."]);
    expect(page).not.toMatch(/<article\b|<ol\b|<li\b/);

    // The demo isn't a site: with a demo and no site, the sites still have none.
    const withDemo = renderSiteIndex({ demo: DEMO_REPORT, sites: [] }, NO_FONTS);
    expect(textsOf(sectionOf(withDemo, "sites"), "p")).toEqual([
      "No reports have been shared yet.",
    ]);
    expect(textsOf(sectionOf(withDemo, "demo"), "h3")).toEqual(["29 September 2026, 15:40"]);
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
    const page = renderSiteIndex(
      { demo: null, sites: [{ folder: 'a"b&c', reports: [report] }] },
      NO_FONTS,
    );

    const markup = markupOf(page);
    expect(markup).not.toContain("<img");
    expect(markup).toContain("Prepared by &lt;img src=x onerror=alert(1)&gt;");
    expect(markup).toContain("prepared by &lt;img src=x onerror=alert(1)&gt;");
    // A name, an address, a fingerprint, and a run, in text and in an attribute.
    expect(markup).toContain('href="a&amp;b/a&amp;b&quot;.html"');
    expect(markup).toContain(">a&amp;b&lt;i&gt;.html</a>");
    expect(markup).toContain("<code>&lt;b&gt;0&lt;/b&gt;</code>");
    expect(markup).toContain("The walkthrough file of run &lt;u&gt;run&lt;/u&gt;");
    expect(markup).toContain("&lt;script&gt;x&lt;/script&gt;.docx isn&#39;t here");
    // A folder, an id, and a time, which are attributes and text too.
    expect(markup).toContain('id="report-&quot;&gt;&lt;b&gt;x&lt;/b&gt;"');
    expect(markup).toMatch(/<section\b[^>]*\bid="site-a&quot;b&amp;c"/);
    expect(markup).toContain(
      'datetime="2026-10-03T14:05:00-05:00&quot; onmouseover=&quot;alert(1)"',
    );
    expect(markup).toContain(", a&quot;b&amp;c, prepared by");
    // Nothing the record holds became markup: no element it names, and no attribute it adds.
    const { elements, attributes } = namesIn(markup);
    expect(elements.filter((element) => ["img", "b", "u", "i"].includes(element))).toEqual([]);
    expect(attributes.filter((name) => /^(?:on|style$|src)/.test(name))).toEqual([]);
  });

  it("says what it says in the words the design gives it", () => {
    const sentences = textsOf(markupOf(html), "p");

    expect(sentences).toEqual(
      expect.arrayContaining([
        "Each report is a person's review of a website with a real screen reader, sped up by voicecap. Every transcript in a report is what the screen reader said, word for word, and every decision in it is a person's.",
        "voicecap's report on its own small demo site, as an example of what it makes.",
        "Each site's reports, the newest first.",
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
    // The bar's label, the button, which is hidden until the script shows it, and the footer's link.
    expect(html).toContain('<nav aria-label="Views">');
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
    // grow taller than the space kept clear for it.
    const queries = [...SITE_CSS.matchAll(/@media ([^{]*)\{/g)].map(([, query = ""]) =>
      query.trim(),
    );
    expect(queries).toEqual(["print", "(min-width: 40em)"]);
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
