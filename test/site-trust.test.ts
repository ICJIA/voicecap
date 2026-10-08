/**
 * The website's "Can I trust this?" page (src/site/trust.ts), drawn from the facts it's given (see
 * test/helpers/trust-facts.ts): what it says of voicecap, of how it can be checked, and of how it's
 * tested, in the words the design gives it (src/site/trust-text.ts); every number and date from the
 * facts, and none typed in; what it says when a fact isn't there; its headings, its sections, and
 * its links; and the website's rules for a page: one file, with one style block and one script
 * under its own policy, and no style attribute.
 *
 * What the page does in a browser is in test/site-page-browser.test.ts.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { fontFaceCss } from "../src/share/fonts.js";
import { SITE_SCRIPT } from "../src/site/client.js";
import {
  recordFactsOf,
  type RecordFacts,
  type ReleaseFacts,
  type VoicecapFacts,
} from "../src/site/facts.js";
import { siteFooter } from "../src/site/frame.js";
import { inlineHashes } from "../src/site/headers.js";
import type { SiteContent } from "../src/site/render.js";
import { SITE_CSS } from "../src/site/style.js";
import { renderTrustPage, type TrustInput } from "../src/site/trust.js";
import { decode, textOf } from "./helpers/share-html.js";
import { CONTENT, DEMO_REPORT, DVFR, DVFR_NEWEST } from "./helpers/site-content.js";
import { EARLIER_RELEASES, FACTS, RECORDS, RESULTS_CONTENT } from "./helpers/trust-facts.js";

const NO_FONTS = { fontCss: "" };

const GITHUB = "https://github.com/ICJIA/voicecap";
const CHANGELOG = "https://github.com/ICJIA/voicecap/blob/main/CHANGELOG.md";
const NPM = "https://www.npmjs.com/package/@icjia/voicecap";
/** The parts of the README the page links to, by their headings' anchors on GitHub. */
const README = {
  auditRecord: "https://github.com/ICJIA/voicecap#the-audit-record",
  verify: "https://github.com/ICJIA/voicecap#checking-the-record-voicecap-verify",
  walkthrough: "https://github.com/ICJIA/voicecap#repeating-a-run-the-walkthrough-file",
};
/** The law's sources: the rule on ada.gov, DoIT's page on accessibility, and W3C's on WCAG. */
const LAW = [
  "https://www.ada.gov/resources/2024-03-08-web-rule/",
  "https://doit.illinois.gov/initiatives/accessibility.html",
  "https://www.w3.org/WAI/standards-guidelines/wcag/",
];
/** The page's sections after its banner, in order, by their ids. */
const SECTIONS = ["does", "nvda", "law", "evidence", "tested", "limits", "builder", "releases"];

/** What a line says in place of a fact the build doesn't have, such as a build not released. */
const NOT_RECORDED = "not recorded in this build of voicecap";

/** The page the tests mostly read: FACTS, and the records of the tests' content with results. */
const INPUT: TrustInput = { voicecap: FACTS, records: RECORDS, content: RESULTS_CONTENT };

/** The page, with some of its input changed. */
function pageWith(changes: Partial<TrustInput> = {}): string {
  return renderTrustPage({ ...INPUT, ...changes }, NO_FONTS);
}

/** The release facts of FACTS, which the tests change a part of. */
function releaseOf(facts: VoicecapFacts): ReleaseFacts {
  if (facts.release === null) throw new Error("These facts have no release facts.");
  return facts.release;
}

/** FACTS, with the release's test counts changed. */
function withTests(tests: Partial<ReleaseFacts["tests"]>): VoicecapFacts {
  const release = releaseOf(FACTS);
  return { ...FACTS, release: { ...release, tests: { ...release.tests, ...tests } } };
}

/** The records of a website with no report at all, not even the demo's. */
const NO_REPORTS: RecordFacts = recordFactsOf({ demo: null, sites: [] });

/** How a policy names the hash of `text`: 'sha256-' and its SHA-256 as base64, in single quotes. */
function hashOf(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
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

/** Some markup's words as a reader sees them: without what only a screen reader gets. */
function seen(html: string): string {
  return textOf(html.replace(/<span class="sr">[\s\S]*?<\/span>/g, ""), "");
}

/** Some markup's words as a screen reader gets them: without what it doesn't read. */
function heard(html: string): string {
  return textOf(html.replace(/<span aria-hidden="true">[\s\S]*?<\/span>/g, ""), "");
}

/** The text of each element of a kind in some markup, in order, as a reader gets it. */
function textsOf(html: string, tag: string): string[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map(
    ([, inner = ""]) => textOf(inner, ""),
  );
}

/** Each link in some markup: where it goes, as a reader gets it, and its words. */
function linksOf(html: string): { href: string; words: string }[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, tag = "", inner = ""]) => ({
    href: decode(/\shref="([^"]*)"/.exec(tag)?.[1] ?? ""),
    words: textOf(inner, ""),
  }));
}

/** The page's headings, in order: each one's level and words. */
function headingsOf(html: string): [number, string][] {
  return [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map(
    ([, level = "", inner = ""]): [number, string] => [Number(level), textOf(inner, "")],
  );
}

/** A section's markup, by its id. The page's sections hold no section. */
function sectionOf(html: string, id: string): string {
  const found = new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?</section>`).exec(html);
  if (found === null) throw new Error(`The page has no section ${id}.`);
  return found[0];
}

/** One of the four big numbers: how it looks, what a screen reader hears, its line, its link. */
interface Tile {
  looks: string;
  heard: string;
  line: string;
  link: { href: string; words: string } | undefined;
}

/** The page's four big numbers, in order. */
function tilesOf(html: string): Tile[] {
  return [...html.matchAll(/<li class="tile">([\s\S]*?)<\/li>/g)].map(([, tile = ""]) => {
    const big = /<p class="n[^"]*">([\s\S]*?)<\/p>/.exec(tile)?.[1] ?? "";
    const line = /<p class="k">([\s\S]*?)<\/p>/.exec(tile)?.[1] ?? "";
    return { looks: seen(big), heard: heard(big), line: textOf(line, ""), link: linksOf(tile)[0] };
  });
}

/** The tile of the page's tiles at `index`. */
function tileOf(html: string, index: number): Tile {
  const tile = tilesOf(html)[index];
  if (tile === undefined) throw new Error(`The page has no tile ${index + 1}.`);
  return tile;
}

/** The stamp under the page's lead, as a reader gets it. */
function stampOf(html: string): string {
  return textOf(/<p class="stamp">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "", "");
}

/** Each item of a section's list of points: its words, and its link, when it has one. */
function pointsOf(section: string): { words: string; link?: { href: string; words: string } }[] {
  const list = /<ul class="points"[^>]*>([\s\S]*?)<\/ul>/.exec(section)?.[1] ?? "";
  return [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, item = ""]) => {
    const [link] = linksOf(item.replace(/<p>[\s\S]*?<\/p>/g, ""));
    return { words: textsOf(item, "p").join(" "), ...(link === undefined ? {} : { link }) };
  });
}

/** Each card of a section: its tag, when it has one, its heading, its words, and its links. */
function cardsOf(section: string): {
  tag?: string;
  heading: string;
  words: string[];
  links: { href: string; words: string }[];
}[] {
  return [...section.matchAll(/<li class="card">([\s\S]*?)<\/li>/g)].map(([, card = ""]) => {
    const tag = /<p class="tag">([\s\S]*?)<\/p>/.exec(card)?.[1];
    return {
      ...(tag === undefined ? {} : { tag: textOf(tag, "") }),
      heading: textsOf(card, "h3")[0] ?? "",
      words: textsOf(card.replace(/<p class="tag">[\s\S]*?<\/p>/, ""), "p"),
      links: linksOf(card),
    };
  });
}

/** Each release in some markup's lists: its line, then its headline, when it has one. */
function releasesIn(html: string): string[][] {
  return [...html.matchAll(/<ol class="releases"[^>]*>([\s\S]*?)<\/ol>/g)].flatMap(
    ([, list = ""]) =>
      [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, item = ""]) => textsOf(item, "p")),
  );
}

/** The versions of the releases in some markup's lists of releases, in order. */
function versionsIn(html: string): string[] {
  return releasesIn(html).map(([line = ""]) => line.split(" · ")[0] ?? "");
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

/** Every number in some text, as written: "5,012", "0.13.2", "14:05". */
function numbersIn(text: string): string[] {
  return [...new Set(text.match(/\d+(?:[.,:]\d+)*/g) ?? [])].sort();
}

describe("renderTrustPage", () => {
  const html = pageWith();

  it("is one file, under its own policy: one style block, one script last, no style attribute, nothing from outside", async () => {
    const fontCss = await fontFaceCss();
    const page = renderTrustPage(INPUT, { fontCss });
    const plain = withoutFontData(page);

    expect(plain.match(/<style\b/g)).toHaveLength(1);
    expect(plain.match(/<script\b/g)).toHaveLength(1);
    // The script is the last thing in the page.
    expect(page).toMatch(/<\/script>\n<\/body>\n<\/html>\n$/);
    expect(plain).not.toMatch(/\sstyle\s*=/i);
    for (const outside of ["src=", "srcset", "<link", "<iframe", "@import", "url(http"]) {
      expect(plain, outside).not.toContain(outside);
    }
    // Its own code is what a Content Security Policy hashes: the one style block, and the script.
    expect(inlineHashes(page)).toEqual({
      styles: [hashOf(`\n${fontCss}\n${SITE_CSS}`)],
      scripts: [hashOf(SITE_SCRIPT)],
    });
  });

  it("has its own title, the bar of the trust page, and the website's footer", () => {
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">\n<head>\n/);
    expect(html).toContain("<title>Can I trust this? · Screen reader test results</title>");
    // The bar's views are on the website's own page, and the link to this page is the current one.
    const bar = /<nav\b[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect(linksOf(bar)).toEqual([
      { href: "index.html#demo", words: "The demo" },
      { href: "index.html#sites", words: "The sites" },
      { href: "index.html#by-date", words: "Every report, by date" },
      { href: "trust.html", words: "Can I trust this?" },
    ]);
    expect(bar).toContain('<a href="trust.html" aria-current="page">');
    expect(html).toContain(siteFooter());
  });

  it("takes the bar's views from the content it's given, and nothing else from it", () => {
    // One site and no demo: the bar has no link to the demo, and none to the list by date.
    const oneSite: SiteContent = {
      demo: null,
      sites: [{ name: DVFR, folders: [DVFR], reports: [] }],
    };
    const page = pageWith({ content: oneSite });

    const bar = /<nav\b[\s\S]*?<\/nav>/.exec(page)?.[0] ?? "";
    expect(linksOf(bar).map(({ href }) => href)).toEqual(["index.html#sites", "trust.html"]);
    // What the page says of the records is the records' facts, not the content's.
    expect(page.replace(bar, "")).toBe(html.replace(/<nav\b[\s\S]*?<\/nav>/, ""));
  });

  it("puts its headings in order", () => {
    const headings = headingsOf(html);

    // The page's heading, then a heading for each section, and one for each card.
    expect(headings).toEqual([
      [1, "Built to be checked. See for yourself."],
      [2, "One job: hear a website the way a screen reader user hears it."],
      [2, "Real NVDA, not a simulation."],
      [2, "Title II. IITAA. WCAG."],
      [3, "Title II of the ADA"],
      [3, "IITAA"],
      [3, "WCAG"],
      [2, "Every word can be checked."],
      [2, "It tests itself before every release."],
      [2, "What it doesn't do."],
      [2, '"One person built this."'],
      [3, "The code is public"],
      [3, "The real screen reader"],
      [3, "Every word on the record"],
      [3, "Fingerprints anyone can check"],
      [3, "5,012 tests"],
      [3, "A public, dated record"],
      [2, "How it got here."],
    ]);
    // None skips a level on the way down.
    const levels = headings.map(([level]) => level);
    levels.forEach((level, index) => {
      expect(level - (levels[index - 1] ?? 0), headings[index]?.[1]).toBeLessThanOrEqual(1);
    });
    // The h3s are the cards', only under the law and under the objection.
    for (const id of SECTIONS.filter((each) => each !== "law" && each !== "builder")) {
      expect(sectionOf(html, id), id).not.toContain("<h3");
    }
  });

  it("names each section by its heading, an h2, under its kicker", () => {
    expect([...html.matchAll(/<section\b[^>]*\bid="([^"]*)"/g)].map(([, id]) => id)).toEqual(
      SECTIONS,
    );
    for (const id of SECTIONS) {
      const section = sectionOf(html, id);
      const labelled = /\saria-labelledby="([^"]*)"/.exec(section)?.[1];
      expect(labelled, id).toEqual(expect.any(String));
      // The section's first heading is an h2, and it's the one that names it.
      const heading = /<h([1-6]) id="([^"]*)"/.exec(section);
      expect(heading?.[1], id).toBe("2");
      expect(heading?.[2], id).toBe(labelled);
      // Its kicker is above it.
      const kicker = section.indexOf('<p class="kicker">');
      expect(kicker, id).toBeGreaterThan(0);
      expect(kicker, id).toBeLessThan(section.indexOf("<h2"));
    }
  });

  it("puts its heading in the website's banner, with its picture, and its kicker, lead, stamp, and four big numbers after it", () => {
    const main = /<main id="main">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? "";
    const banner = /<div class="view-head"><div class="title">(<svg[\s\S]*?<\/svg>)<h1>/.exec(main);

    // The picture, which a screen reader skips, is a shield with a check mark.
    expect(banner?.[1]).toMatch(/^<svg class="icon" [^>]*aria-hidden="true">/);
    const places = [
      '<div class="view-head">',
      "<h1>",
      '<p class="kicker">voicecap · a human review, sped up</p>',
      '<p class="lead">',
      '<p class="stamp">',
      '<ul class="tiles"',
      '<section class="part" id="does"',
    ].map((part) => main.indexOf(part));
    expect(places.every((place) => place >= 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(tilesOf(html)).toHaveLength(4);
  });

  it("says every number from the facts it's given", () => {
    // The facts' own: the tests that passed, the pages of the two sites' current reports (9 of 9
    // and 32 of 32), the files published (the demo's 3, the first site's 3 and 1, and the second's
    // 4), and the releases.
    expect(RECORDS.files.published).toBe(11);
    expect(tilesOf(html).map(({ looks }) => looks)).toEqual(["5,012", "41 of 41", "11", "3"]);
    expect(tileOf(html, 1).line).toMatch(/, where 1 problem needs attention$/);

    // Each fact changes the page where it's said, and only there.
    const passed = pageWith({ voicecap: withTests({ passed: 5013 }) });
    expect(tileOf(passed, 0).looks).toBe("5,013");
    expect(pointsOf(sectionOf(passed, "tested"))[0]?.words).toMatch(
      /^Before this release: the lint and the type checks, then 5,013 tests passed on Windows,/,
    );
    expect(cardsOf(sectionOf(passed, "builder"))[4]?.heading).toBe("5,013 tests");
    expect(passed).not.toContain("5,012");

    const reading = RECORDS.reading;
    if (reading === null) throw new Error("The records count the pages read.");
    const fewerRead = pageWith({ records: { ...RECORDS, reading: { ...reading, read: 40 } } });
    expect(tileOf(fewerRead, 1).looks).toBe("40 of 41");

    const files = { ...RECORDS.files, published: RECORDS.files.published + 1 };
    const moreFiles = pageWith({ records: { ...RECORDS, files } });
    expect(tileOf(moreFiles, 2).looks).toBe("12");
    expect(pointsOf(sectionOf(moreFiles, "evidence"))[3]?.words).toContain(": 12 today, and");

    const releases = [...FACTS.releases, ...EARLIER_RELEASES.slice(0, 1)];
    const fourth = pageWith({ voicecap: { ...FACTS, releases } });
    expect(tileOf(fourth, 3).looks).toBe("4");
    expect(cardsOf(sectionOf(fourth, "builder"))[5]?.words).toEqual([
      "4 releases and 412 public changes since 26 September 2026, each release dated in the CHANGELOG.",
    ]);
    expect(versionsIn(sectionOf(fourth, "releases"))).toEqual([
      "0.13.2",
      "0.13.1",
      "0.13.0",
      "0.12.3",
    ]);
  });

  it("says no number that the facts it's given don't, but the law's and one of voicecap's history, each a count", () => {
    // Facts whose numbers are none of FACTS's, so that a number typed into the page would show;
    // each count that can pass a thousand does, so that one not written as a count would show too,
    // with no comma.
    const voicecap: VoicecapFacts = {
      version: "9.8.7",
      released: "2025-03-03",
      releases: [
        { version: "9.8.7", date: "2025-03-03", headline: "Another release" },
        { version: "9.8.6", date: "2025-02-02", headline: "The one before" },
      ],
      release: {
        tests: { passed: 4321, skipped: 1007, files: 1098, system: "Linux" },
        commits: { count: 1777, first: "2025-01-15" },
        ci: { systems: ["Ubuntu", "Windows"], node: ["20", "26"] },
      },
    };
    const records: RecordFacts = {
      sites: 1003,
      reports: 1005,
      reading: { read: 1017, pages: 1019, problems: 1006, sitesCounted: 1002 },
      files: { published: 1023, leftOut: 1004 },
      newest: "2025-03-04T08:09:00-06:00",
    };
    const page = pageWith({ voicecap, records });

    expect(numbersIn(textOf(markupOf(page)))).toEqual(
      [
        // The version, the release dates' days and years, and the newest share's day and time.
        "9.8.7",
        "9.8.6",
        "3",
        "2",
        "2025",
        "4",
        "08:09",
        // The tests: passed, skipped, and in how many files; CI's Node versions, and its 2 by 2.
        "4,321",
        "1,007",
        "1,098",
        "20",
        "26",
        // The pages read, of the pages, in 1,002 of 1,003 sites, with 1,006 problems; the files and
        // those left out; the commits, and the first one's day.
        "1,017",
        "1,019",
        "1,002",
        "1,003",
        "1,006",
        "1,023",
        "1,004",
        "1,777",
        "15",
        // The law's: WCAG 2.1, its two compliance dates, 50,000 people; and SHA-256.
        "2.1",
        "2027",
        "2028",
        "50,000",
        "256",
        // voicecap's history: the version whose reports began to keep a screenshot of each page.
        "0.11.0",
      ].sort(),
    );
    expect(page).not.toContain("5,012");
  });

  it("stamps the version, its release date, and the newest share", () => {
    expect(stampOf(html)).toBe(
      "voicecap 0.13.2, released 9 October 2026 · records as of 3 October 2026, 14:05",
    );
    // The newest share of every report shown, the demo's too.
    expect(RECORDS.newest).toBe(DVFR_NEWEST.at);
  });

  it("says what isn't recorded, and never invents it", () => {
    // No release facts, as in a build that wasn't released.
    const unreleased = pageWith({ voicecap: { ...FACTS, release: null } });
    expect(tileOf(unreleased, 0)).toEqual({
      looks: "—",
      heard: "not recorded",
      line: `tests passed before this release: ${NOT_RECORDED}`,
      link: { href: "#tested", words: "How it's tested" },
    });
    expect(textOf(markupOf(unreleased))).not.toContain("tests passed on");
    expect(tileOf(unreleased, 3)).toMatchObject({
      looks: "3",
      line: `releases, each dated in the CHANGELOG; the public changes behind them are ${NOT_RECORDED}`,
    });
    expect(pointsOf(sectionOf(unreleased, "tested")).slice(0, 2)).toEqual([
      {
        // With no count, it's what every release does, in the order publish.sh does it.
        words: `Before each release: the lint and the type checks, then every test, then a check that the package installs and runs. The count is ${NOT_RECORDED}.`,
      },
      { words: `On every change: the same tests, on every system in its CI; ${NOT_RECORDED}.` },
    ]);
    const cards = cardsOf(sectionOf(unreleased, "builder"));
    expect(cards[4]).toMatchObject({
      heading: "Its own tests",
      words: [
        `Every release passes them first, and CI runs them on every change. Their count is ${NOT_RECORDED}.`,
      ],
    });
    expect(cards[5]?.words).toEqual([
      `3 releases, each dated in the CHANGELOG. The public changes behind them are ${NOT_RECORDED}.`,
    ]);

    // No release date, as for a version the CHANGELOG has no entry for.
    expect(stampOf(pageWith({ voicecap: { ...FACTS, released: null } }))).toBe(
      "voicecap 0.13.2, whose release date isn't recorded in this build · records as of 3 October 2026, 14:05",
    );

    // No report at all, not even the demo's. With no file, there is nothing to say "each" of.
    const empty = pageWith({ records: NO_REPORTS, content: { demo: null, sites: [] } });
    expect(stampOf(empty)).toBe(
      "voicecap 0.13.2, released 9 October 2026 · no report has been shared yet",
    );
    expect(tileOf(empty, 1)).toMatchObject({
      looks: "—",
      heard: "not recorded",
      line: "pages NVDA read in the current reports on this website: no site's report has been shared yet",
    });
    expect(tileOf(empty, 2)).toMatchObject({ looks: "0", line: "files on this website" });
  });

  it("says no site's report has been shared yet when only the demo's has, and counts the demo's time and files", () => {
    const demoOnly: SiteContent = { demo: DEMO_REPORT, sites: [] };
    const records = recordFactsOf(demoOnly);
    // The demo's report is no site's, so no report counts; its time and its three files do.
    expect(records).toMatchObject({
      sites: 0,
      reports: 0,
      reading: null,
      files: { published: 3, leftOut: 0 },
      newest: DEMO_REPORT.at,
    });

    const page = pageWith({ records, content: demoOnly });

    expect(stampOf(page)).toBe(
      "voicecap 0.13.2, released 9 October 2026 · records as of 29 September 2026, 15:40",
    );
    expect(tileOf(page, 1)).toEqual({
      looks: "—",
      heard: "not recorded",
      line: "pages NVDA read in the current reports on this website: no site's report has been shared yet",
      link: { href: "index.html#sites", words: "See the reports" },
    });
    expect(tileOf(page, 2)).toMatchObject({
      looks: "3",
      line: "files on this website, each matching the fingerprint recorded when it was shared",
    });
  });

  it("says the pages read aren't recorded in the shares when no current report's share records them", () => {
    // The tests' content as it is: three reports, none of whose shares records what it found.
    const records = recordFactsOf(CONTENT);
    expect(records).toMatchObject({ reports: 3, reading: null });

    expect(tileOf(pageWith({ records, content: CONTENT }), 1)).toEqual({
      looks: "—",
      heard: "not recorded",
      line: "pages NVDA read in the current reports: not recorded in the shares on this website",
      link: { href: "index.html#sites", words: "See the reports" },
    });
  });

  it("says how many sites it counted the pages of, when it didn't count them all", () => {
    const records: RecordFacts = {
      ...RECORDS,
      reading: { read: 9, pages: 9, problems: 0, sitesCounted: 1 },
    };

    expect(tileOf(pageWith({ records }), 1)).toMatchObject({
      looks: "9 of 9",
      line: "pages NVDA read in the current reports on this website, in 1 of its 2 sites, where nothing needs attention",
    });
  });

  it.each([
    [41, 0, ", where nothing needs attention"],
    [41, 1, ", where 1 problem needs attention"],
    [41, 2, ", where 2 problems need attention"],
    [41, 1204, ", where 1,204 problems need attention"],
    // With fewer read than are in scope, nothing needs attention only on the pages read, as
    // voicecap's verdict says it (src/share/verdict.ts); problems are counted as they are.
    [40, 0, ", where nothing needs attention on the pages read"],
    [40, 2, ", where 2 problems need attention"],
  ])(
    "says what needs attention in the pages it counted, when %i of 41 were read and the problems are %i",
    (read, problems, ending) => {
      const records: RecordFacts = {
        ...RECORDS,
        reading: { read, pages: 41, problems, sitesCounted: 2 },
      };

      expect(tileOf(pageWith({ records }), 1).line).toBe(
        `pages NVDA read in the current reports on this website${ending}`,
      );
    },
  );

  it.each([
    [
      11,
      0,
      "files on this website, each matching the fingerprint recorded when it was shared",
      "This website publishes only files that still match the fingerprints recorded when they were shared: 11 today.",
    ],
    [
      11,
      1,
      "files on this website, each matching the fingerprint recorded when it was shared; 1 left out, missing or changed since it was shared",
      "This website publishes only files that still match the fingerprints recorded when they were shared: 11 today, and 1 left out.",
    ],
    [
      1,
      2,
      "file on this website, matching the fingerprint recorded when it was shared; 2 left out, missing or changed since they were shared",
      "This website publishes only files that still match the fingerprints recorded when they were shared: 1 today, and 2 left out.",
    ],
    // None published: nothing to say "each" of, and those left out are said as they are with some.
    [
      0,
      0,
      "files on this website",
      "This website publishes only files that still match the fingerprints recorded when they were shared: 0 today.",
    ],
    [
      0,
      1,
      "files on this website; 1 left out, missing or changed since it was shared",
      "This website publishes only files that still match the fingerprints recorded when they were shared: 0 today, and 1 left out.",
    ],
    [
      0,
      2,
      "files on this website; 2 left out, missing or changed since they were shared",
      "This website publishes only files that still match the fingerprints recorded when they were shared: 0 today, and 2 left out.",
    ],
  ])(
    "says how many files it publishes, and how many it leaves out: %i and %i",
    (published, leftOut, line, evidence) => {
      const page = pageWith({ records: { ...RECORDS, files: { published, leftOut } } });

      expect(tileOf(page, 2).line).toBe(line);
      expect(pointsOf(sectionOf(page, "evidence"))[3]).toEqual({ words: evidence });
    },
  );

  it("says the releases aren't recorded when the CHANGELOG has none, and never that there are none", () => {
    // A CHANGELOG ships with every package, so one with no release in it wasn't read.
    const noChangelog = pageWith({ voicecap: { ...FACTS, releases: [] } });
    expect(tileOf(noChangelog, 3)).toMatchObject({
      looks: "—",
      heard: "not recorded",
      line: `releases: ${NOT_RECORDED}`,
    });
    expect(cardsOf(sectionOf(noChangelog, "builder"))[5]?.words).toEqual([
      `412 public changes since 26 September 2026. The releases are ${NOT_RECORDED}.`,
    ]);
    const section = sectionOf(noChangelog, "releases");
    expect(section).not.toContain("<ol");
    expect(textsOf(section, "p")).toContain(`The releases are ${NOT_RECORDED}.`);
    expect(linksOf(section)).toEqual([{ href: CHANGELOG, words: "The full CHANGELOG" }]);

    // Nor the public changes.
    const neither = pageWith({ voicecap: { ...FACTS, releases: [], release: null } });
    expect(cardsOf(sectionOf(neither, "builder"))[5]?.words).toEqual([
      `The releases, and the public changes behind them, are ${NOT_RECORDED}.`,
    ]);
    expect(tileOf(neither, 3).line).toBe(`releases: ${NOT_RECORDED}`);
  });

  it("links each big number to where what it counts is shown", () => {
    expect(tilesOf(html).map(({ link }) => link)).toEqual([
      { href: "#tested", words: "How it's tested" },
      { href: "index.html#sites", words: "See the reports" },
      { href: "#evidence", words: "How to check a copy" },
      { href: "#releases", words: "How it got here" },
    ]);
  });

  it("says what its banner and four big numbers say, in the words the design gives them", () => {
    expect(textsOf(html, "h1")).toEqual(["Built to be checked. See for yourself."]);
    expect(textsOf(html, "p").slice(0, 2)).toEqual([
      "voicecap · a human review, sped up",
      "Every claim on this page can be checked without taking anyone's word for it, the builder's included.",
    ]);
    expect(tilesOf(html).map(({ line }) => line)).toEqual([
      "tests passed on Windows before this release: every one must pass, or nothing is published",
      "pages NVDA read in the current reports on this website, where 1 problem needs attention",
      // One Word copy changed since it was shared, and one is missing: "left out" is both.
      "files on this website, each matching the fingerprint recorded when it was shared; 2 left out, missing or changed since they were shared",
      "releases, and 412 public changes, since 26 September 2026: every step on the record",
    ]);
  });

  it("says what it does, and that the screen reader is the real one, in the words the design gives them", () => {
    expect(textsOf(sectionOf(html, "does"), "p")).toEqual([
      "what it does",
      "Many people who are blind or can't see well use a screen reader: software that reads what's on the screen out loud. voicecap has a real screen reader, NVDA, read every page of a website three ways (line by line, heading by heading, and control by control) and saves every word it says. A person then reads what it said, and decides what each page needs. It's a human review, sped up.",
    ]);
    expect(textsOf(sectionOf(html, "nvda"), "p")).toEqual([
      "the screen reader",
      "voicecap drives NVDA, the free screen reader many blind people use on Windows, and records exactly what it says on each page. Every transcript is NVDA's own words, so what you read is what a screen reader user hears.",
    ]);
  });

  it("names the builder, and the law with its sources", () => {
    expect(textOf(markupOf(html))).toContain("Built by Christopher Schweda at ICJIA.");

    const law = sectionOf(html, "law");
    expect(textsOf(law, "p").slice(0, 2)).toEqual([
      "the law · three names, one idea",
      'Government information must work for everyone. Two laws say so; one rulebook defines "works."',
    ]);
    expect(cardsOf(law)).toEqual([
      {
        tag: "federal law",
        heading: "Title II of the ADA",
        words: [
          "The Department of Justice rule for state and local government. It names WCAG 2.1 Level AA as the standard, and its compliance dates are April 26, 2027 for entities serving 50,000 people or more and April 26, 2028 for smaller ones and special districts.",
        ],
        links: [{ href: LAW[0], words: "Title II of the ADA" }],
      },
      {
        tag: "Illinois law",
        heading: "IITAA",
        words: [
          "The Illinois Information Technology Accessibility Act, our state's own accessibility law, older than the federal rule, also built on WCAG 2.1 AA. It applies to Illinois state agencies and universities.",
        ],
        links: [{ href: LAW[1], words: "IITAA" }],
      },
      {
        tag: "the rulebook",
        heading: "WCAG",
        words: [
          "The Web Content Accessibility Guidelines, the international rulebook both laws point to.",
          "For voicecap: what NVDA says is how a screen reader user meets a page, so its transcripts show, word for word, how a page's images, headings, links, and controls come across against that rulebook; the person reviewing decides.",
        ],
        links: [{ href: LAW[2], words: "WCAG" }],
      },
    ]);
    // Each card's heading is its link to its source.
    expect(law).toContain(`<h3><a href="${LAW[0]}">Title II of the ADA</a></h3>`);
  });

  it("says how every word can be checked, with where each part is shown", () => {
    const evidence = sectionOf(html, "evidence");

    expect(textsOf(evidence, "p")[0]).toBe("the evidence");
    expect(pointsOf(evidence)).toEqual([
      {
        words:
          "Every transcript and screenshot has a SHA-256 fingerprint. Every run's record is sealed, and every share and every review is chained to the one before it.",
        link: { href: README.auditRecord, words: "The audit record" },
      },
      {
        words: "voicecap verify checks a whole audit record against its seals and fingerprints.",
        link: { href: README.verify, words: "How to check a record" },
      },
      {
        words:
          'Each report checks its own fingerprints in your browser, with no network: open a report and press "Check the fingerprints".',
        link: { href: "index.html#sites", words: "See the reports" },
      },
      {
        words:
          "This website publishes only files that still match the fingerprints recorded when they were shared: 11 today, and 2 left out.",
      },
      {
        words:
          "Each report's walkthrough file repeats its run, page for page, so anyone can run it again and compare.",
        link: { href: README.walkthrough, words: "The walkthrough file" },
      },
    ]);
    // The command is in the fixed-width font.
    expect(evidence).toContain("<code>voicecap verify</code> checks a whole audit record");
  });

  it("says how it's tested, from what the release recorded", () => {
    const tested = sectionOf(html, "tested");

    expect(textsOf(tested, "p")[0]).toBe("the tests");
    expect(pointsOf(tested)).toEqual([
      {
        // The count and the system are this release's own run's, in the order publish.sh runs
        // its checks: the lint and the type checks first, the check of the package last.
        words:
          "Before this release: the lint and the type checks, then 5,012 tests passed on Windows, with 2 skipped, in 125 files, then a check that the package installs and runs. If one test fails, nothing is published.",
      },
      {
        // Three systems by two Node versions: 6 combinations.
        words:
          "On every change: the same tests on Ubuntu, macOS, and Windows, with Node 22 and 24: 6 combinations, and a run of the command line with its replay driver.",
      },
      {
        // Only the pages whose tests run axe in both themes and at a phone's width: the shareable
        // page (test/share-browser.test.ts) and this website's two pages
        // (test/site-page-browser.test.ts). A run's own report and the demo site's pages aren't
        // checked that way, so they aren't named.
        words:
          "The shareable page (the report you open from this website) and this website itself are checked with axe, an accessibility testing engine, in a real browser, in both themes and at a phone's width.",
      },
      {
        words:
          "A run with real NVDA at a PC comes before any release that changes how voicecap drives NVDA.",
      },
    ]);

    // Two systems with one Node version: "A and B", and 2 combinations.
    const release = releaseOf(FACTS);
    const ci = { systems: ["Ubuntu", "Windows"], node: ["24"] };
    const fewer = pageWith({ voicecap: { ...FACTS, release: { ...release, ci } } });
    expect(pointsOf(sectionOf(fewer, "tested"))[1]?.words).toBe(
      "On every change: the same tests on Ubuntu and Windows, with Node 24: 2 combinations, and a run of the command line with its replay driver.",
    );
  });

  it("says what it doesn't do", () => {
    const limits = sectionOf(html, "limits");

    expect(textsOf(limits, "p")[0]).toBe("the limits");
    expect(pointsOf(limits)).toEqual([
      { words: "It doesn't decide what's accessible: a person does, from what NVDA said." },
      { words: "It uses NVDA only, for now. VoiceOver on a Mac comes later." },
      { words: "A transcript shows what NVDA said, not what every screen reader would say." },
      {
        words:
          "Automated checkers such as axe find what code can find; a person's review finds the rest.",
      },
    ]);
  });

  it("answers that one person built it, card by card", () => {
    const builder = sectionOf(html, "builder");

    expect(textsOf(builder, "p").slice(0, 2)).toEqual([
      "the objection",
      "Built by Christopher Schweda at ICJIA. You don't have to take that on trust:",
    ]);
    expect(cardsOf(builder)).toEqual([
      {
        heading: "The code is public",
        words: [
          "Every line is on GitHub, free under the MIT license, for anyone to read, run, or check.",
        ],
        links: [{ href: GITHUB, words: "voicecap on GitHub" }],
      },
      {
        heading: "The real screen reader",
        words: [
          "voicecap records NVDA itself, the screen reader people use, not an imitation of one.",
        ],
        links: [],
      },
      {
        heading: "Every word on the record",
        words: [
          "Each report keeps every transcript, word for word, and, since voicecap 0.11.0, a screenshot of each page NVDA read.",
        ],
        links: [],
      },
      {
        heading: "Fingerprints anyone can check",
        words: [
          "A report checks its own files in your browser, and voicecap verify checks the whole record.",
        ],
        links: [],
      },
      {
        heading: "5,012 tests",
        words: ["This release passed them first, on Windows, and CI runs them on every change."],
        links: [],
      },
      {
        heading: "A public, dated record",
        words: [
          "3 releases and 412 public changes since 26 September 2026, each release dated in the CHANGELOG.",
        ],
        links: [{ href: CHANGELOG, words: "The CHANGELOG" }],
      },
    ]);
  });

  it("lists each release, the newest first, with its version and date, then its headline", () => {
    const releases = sectionOf(html, "releases");

    expect(textsOf(releases, "p")[0]).toBe("the record");
    expect(releasesIn(releases)).toEqual([
      ["0.13.2 · 9 October 2026", "A page that shows how voicecap can be checked"],
      [
        "0.13.1 · 8 October 2026",
        "The website's headings say more at a glance, and each site links to the site itself",
      ],
      [
        "0.13.0 · 8 October 2026",
        "The shareable page has a new order, and its Word copy follows it",
      ],
    ]);
    // Each date is a time, which holds the day it names.
    expect(releases).toContain('<time datetime="2026-10-09">9 October 2026</time>');
    // Three is fewer than five: nothing is folded.
    expect(releases).not.toContain("<details");
    expect(linksOf(releases)).toEqual([{ href: CHANGELOG, words: "The full CHANGELOG" }]);
  });

  it("says nothing after a release's date when its entry has no headline", () => {
    const releases = [
      { version: "0.13.2", date: "2026-10-09", headline: "" },
      ...FACTS.releases.slice(1),
    ];

    const listed = releasesIn(
      sectionOf(pageWith({ voicecap: { ...FACTS, releases } }), "releases"),
    );

    expect(listed[0]).toEqual(["0.13.2 · 9 October 2026"]);
    expect(listed[1]).toHaveLength(2);
  });

  it("shows the newest five releases, and folds the rest", () => {
    const seven = [...FACTS.releases, ...EARLIER_RELEASES];
    const section = sectionOf(pageWith({ voicecap: { ...FACTS, releases: seven } }), "releases");
    const fold = /<details class="fold">([\s\S]*?)<\/details>/.exec(section)?.[0] ?? "";

    expect(versionsIn(section.replace(fold, ""))).toEqual([
      "0.13.2",
      "0.13.1",
      "0.13.0",
      "0.12.3",
      "0.12.2",
    ]);
    expect(versionsIn(fold)).toEqual(["0.12.1", "0.12.0"]);
    expect(textsOf(fold, "summary")).toEqual(["Every earlier release (2)"]);
    // The fold is closed until a reader opens it, and comes before the link to the CHANGELOG.
    expect(fold).toMatch(/^<details class="fold">\n?<summary>/);
    expect(section.indexOf(fold)).toBeLessThan(section.indexOf(CHANGELOG));

    // Five are shown with nothing folded, and a sixth is folded alone.
    const five = sectionOf(
      pageWith({ voicecap: { ...FACTS, releases: seven.slice(0, 5) } }),
      "releases",
    );
    expect(five).not.toContain("<details");
    expect(versionsIn(five)).toHaveLength(5);
    const six = sectionOf(
      pageWith({ voicecap: { ...FACTS, releases: seven.slice(0, 6) } }),
      "releases",
    );
    expect(textsOf(six, "summary")).toEqual(["Every earlier release (1)"]);
  });

  it("ends its main part with a line of links to voicecap and its version, above the footer", () => {
    const main = /<main id="main">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? "";
    const line = /<p class="links">([\s\S]*?)<\/p>\s*$/.exec(main)?.[1] ?? "";

    expect(linksOf(line)).toEqual([
      { href: GITHUB, words: "voicecap on GitHub" },
      { href: CHANGELOG, words: "The CHANGELOG" },
      { href: NPM, words: "voicecap on npm" },
    ]);
    // A reader sees a dot between each two, which a screen reader skips; the version ends the line.
    expect(seen(line)).toBe(
      "voicecap on GitHub · The CHANGELOG · voicecap on npm · voicecap 0.13.2",
    );
    expect(textOf(line.replace(/<span class="sep" aria-hidden="true">·<\/span>/g, ""))).toBe(
      "voicecap on GitHub The CHANGELOG voicecap on npm voicecap 0.13.2",
    );
  });

  it("links only where it says", () => {
    const pages = [
      html,
      pageWith({ voicecap: { ...FACTS, releases: [...FACTS.releases, ...EARLIER_RELEASES] } }),
    ];
    const allowed = new Set([
      "#main",
      "#tested",
      "#evidence",
      "#releases",
      "index.html#demo",
      "index.html#sites",
      "index.html#by-date",
      "trust.html",
      GITHUB,
      CHANGELOG,
      NPM,
      ...Object.values(README),
      ...LAW,
    ]);

    for (const page of pages) {
      const hrefs = linksOf(page).map(({ href }) => href);
      expect(hrefs.filter((href) => !allowed.has(href))).toEqual([]);
      // And it links to each of them: the bar's views (a demo and two sites), its own parts, the
      // README's, the law's sources, GitHub, the CHANGELOG, and npm.
      expect(new Set(hrefs)).toEqual(allowed);
      // Each of its own anchors lands on something in the page.
      for (const href of hrefs.filter((each) => each.startsWith("#"))) {
        expect(page, href).toContain(`id="${href.slice(1)}"`);
      }
    }
  });

  it("never calls voicecap automated, or says a person listened, or names Guidepup", () => {
    const pages = [
      html,
      pageWith({ voicecap: { ...FACTS, release: null, released: null } }),
      pageWith({ records: NO_REPORTS, content: { demo: null, sites: [] } }),
      pageWith({ records: recordFactsOf(CONTENT), content: CONTENT }),
      pageWith({ voicecap: { ...FACTS, releases: [] } }),
    ];

    for (const page of pages) {
      const text = textOf(markupOf(page));
      // Its only "automated" describes another tool.
      expect(text.match(/automat\w*/gi)).toEqual(["Automated"]);
      expect(text).toContain("Automated checkers such as axe");
      expect(text).not.toMatch(/listen/i);
      expect(text).not.toMatch(/guidepup/i);
    }
  });

  it("escapes what the facts hold", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const release = releaseOf(FACTS);
    const page = pageWith({
      voicecap: {
        ...FACTS,
        version: "0.13.2<i>x</i>",
        releases: [
          { version: "0.13.2<u>x</u>", date: "2026-10-09", headline: hostile },
          ...FACTS.releases.slice(1),
        ],
        release: {
          ...release,
          tests: { ...release.tests, system: '"><b>' },
          ci: { systems: ["<s>Ubuntu</s>", "Windows"], node: ['24"><q>'] },
        },
      },
    });

    const markup = markupOf(page);
    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(markup).toContain("tests passed on &quot;&gt;&lt;b&gt; before this release");
    expect(markup).toContain("voicecap 0.13.2&lt;i&gt;x&lt;/i&gt;, released 9 October 2026");
    expect(markup).toContain("0.13.2&lt;u&gt;x&lt;/u&gt;");
    expect(markup).toContain(
      "the same tests on &lt;s&gt;Ubuntu&lt;/s&gt; and Windows, with Node 24&quot;&gt;&lt;q&gt;: 2 combinations",
    );
    // Nothing the facts hold became markup: no element they name, and no attribute they add.
    const { elements, attributes } = namesIn(markup);
    expect(
      elements.filter((element) => ["img", "b", "i", "u", "s", "q"].includes(element)),
    ).toEqual([]);
    expect(attributes.filter((name) => /^(?:on|style$|src)/.test(name))).toEqual([]);
  });

  it("is the same page for the same facts, and changes none of them", () => {
    const before = structuredClone(INPUT);

    expect(pageWith()).toBe(html);
    expect(INPUT).toEqual(before);
  });
});
