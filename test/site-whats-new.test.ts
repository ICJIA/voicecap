/**
 * The website's What's New page (src/site/whats-new.ts), drawn from the facts it's given (see
 * test/helpers/trust-facts.ts): a card for each release of voicecap's CHANGELOG, newest first, with
 * its version, its day, its headline, its points, and a link to its entry; every word of it from the
 * CHANGELOG, as text; what it says when no release is recorded; and the website's rules for a page:
 * one file, with one style block and one script under its own policy, and no style attribute.
 *
 * What the page does in a browser is in test/site-page-browser.test.ts.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { changelogHref } from "../src/site/changelog.js";
import { SITE_SCRIPT } from "../src/site/client.js";
import {
  readVoicecapFacts,
  voicecapFactsOf,
  type ReleaseItem,
  type VoicecapFacts,
  type VoicecapRelease,
} from "../src/site/facts.js";
import { siteBar, siteFooter } from "../src/site/frame.js";
import { inlineHashes } from "../src/site/headers.js";
import type { SiteContent } from "../src/site/render.js";
import { SITE_CSS } from "../src/site/style.js";
import { renderWhatsNew } from "../src/site/whats-new.js";
import { decode, textOf } from "./helpers/share-html.js";
import { CONTENT } from "./helpers/site-content.js";
import { FACTS } from "./helpers/trust-facts.js";

const GITHUB = "https://github.com/ICJIA/voicecap";

/** What the page says in place of the cards, when the CHANGELOG records no release. */
const NONE = "No release is recorded in this build of voicecap.";

/** Points for FACTS's three releases: the first two have code in one, and the third has none. */
const POINTS: ReleaseItem[][] = [
  [
    ["A link to it ends the bar"],
    ["Every number is generated, as ", { code: "package.json" }, " says"],
  ],
  [
    ['Each site\'s name has "Visit the site" beside it'],
    [{ code: "buildSite" }, "'s ", { code: "SiteContent" }, " gives each site its address"],
  ],
  [],
];

/** FACTS, its releases with their points. */
const WITH_POINTS: VoicecapFacts = {
  ...FACTS,
  releases: FACTS.releases.map((release, index) => ({ ...release, items: POINTS[index] ?? [] })),
};

/** The page the tests mostly read: the facts with points, and the tests' content. */
function pageWith(voicecap: VoicecapFacts = WITH_POINTS, content: SiteContent = CONTENT): string {
  return renderWhatsNew({ voicecap, content });
}

/** How a policy names the hash of `text`: 'sha256-' and its SHA-256 as base64, in single quotes. */
function hashOf(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
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

/** The markup of the page's cards, one for each item of its list, in order. */
function cardsOf(html: string): string[] {
  const list = /<ol\b[^>]*>([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? "";
  return list.split('<li class="card update">').slice(1);
}

/** What a card's first line says: its version, its day, and what follows the day, as a reader sees it. */
function lineOf(card: string): string {
  const line = /<p class="update-line">([\s\S]*?)<\/p>/.exec(card)?.[1] ?? "";
  return textOf(line.replace(/<span class="sr">[\s\S]*?<\/span>/g, ""), " ");
}

/** The words of each point of a card, as a reader gets them, and its markup. */
function pointsOf(card: string): { words: string; markup: string }[] {
  const list = /<ul>([\s\S]*?)<\/ul>/.exec(card)?.[1] ?? "";
  return [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, markup = ""]) => ({
    words: textOf(markup, ""),
    markup,
  }));
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

describe("renderWhatsNew", () => {
  const html = pageWith();

  it("is one file, under its own policy: one style block, one script last, no style attribute, nothing from outside", () => {
    expect(html.match(/<style\b/g)).toHaveLength(1);
    expect(html.match(/<script\b/g)).toHaveLength(1);
    // The script is the last thing in the page.
    expect(html).toMatch(/<\/script>\n<\/body>\n<\/html>\n$/);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    // Nothing is loaded, linked, or framed, and no font is in the page, not even as data.
    for (const outside of ["src=", "srcset", "<link", "<iframe", "@import", "url(", "@font-face"]) {
      expect(html, outside).not.toContain(outside);
    }
    // Its own code is what a Content Security Policy hashes: the one style block, and the script.
    expect(inlineHashes(html)).toEqual({
      styles: [hashOf(`\n${SITE_CSS}`)],
      scripts: [hashOf(SITE_SCRIPT)],
    });
  });

  it("has its own title, the bar the website's other pages have, with the views on the website's own page, and the website's footer", () => {
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">\n<head>\n/);
    expect(textsOf(html, "title")).toEqual(["What's New · Screen reader test results"]);
    const bar = /<nav\b[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect(linksOf(bar)).toEqual([
      { href: "index.html#demo", words: "The demo" },
      { href: "index.html#sites", words: "The sites" },
      { href: "index.html#by-date", words: "Every report, by date" },
      { href: "trust.html", words: "Can I trust this?" },
    ]);
    // None of its links is this page: the bar doesn't link to it yet.
    expect(bar).not.toContain("aria-current");
    expect(html).toContain(`\n${siteBar(CONTENT, "whats-new")}\n`);
    expect(html).toContain(siteFooter());
  });

  it("takes the bar's views from the content it's given, and nothing else from it", () => {
    const oneSite: SiteContent = {
      demo: null,
      sites: [{ name: "a.gov", folders: ["a.gov"], reports: [] }],
    };

    const page = pageWith(WITH_POINTS, oneSite);

    const bar = /<nav\b[\s\S]*?<\/nav>/.exec(page)?.[0] ?? "";
    expect(linksOf(bar).map(({ href }) => href)).toEqual(["index.html#sites", "trust.html"]);
    expect(page.replace(bar, "")).toBe(html.replace(/<nav\b[\s\S]*?<\/nav>/, ""));
  });

  it("opens with its kicker, its heading, and its lead, in the words the design gives them", () => {
    const main = /<main id="main">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? "";

    expect(textsOf(main, "p").slice(0, 2)).toEqual([
      "Every release",
      "Every release of voicecap, newest first, from its CHANGELOG. The front page shows the newest one.",
    ]);
    expect(textsOf(html, "h1")).toEqual(["What's New"]);
    // The kicker is above the heading, and the lead is under it, and the cards come after.
    const places = ['<p class="kicker">', "<h1>", '<p class="lead">', '<ol class="updates"'].map(
      (part) => main.indexOf(part),
    );
    expect(places.every((place) => place >= 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
  });

  it("lists every release, newest first, one card each, in an ordered list", () => {
    expect(html.match(/<ol\b/g)).toHaveLength(1);
    expect(html).toContain('<ol class="updates" role="list">');

    const cards = cardsOf(html);

    expect(cards).toHaveLength(FACTS.releases.length);
    expect(cards.map((card) => /<span class="pill good">([^<]*)<\/span>/.exec(card)?.[1])).toEqual(
      FACTS.releases.map(({ version }) => version),
    );
    expect(FACTS.releases.map(({ version }) => version)).toEqual(["0.13.2", "0.13.1", "0.13.0"]);
  });

  it("lists the releases in the order it's given them, and draws more than the front page's five", () => {
    const releases: VoicecapRelease[] = Array.from({ length: 12 }, (_, index) => ({
      version: `0.${20 - index}.0`,
      date: "2026-10-08",
      headline: `Release ${20 - index}`,
      items: [],
    }));

    const page = pageWith({ ...FACTS, releases });

    expect(cardsOf(page)).toHaveLength(12);
    expect(
      headingsOf(page)
        .slice(1)
        .map(([, words]) => words),
    ).toEqual(releases.map(({ headline }) => headline));
  });

  it("marks the version that built the website as the current one", () => {
    const current = (facts: VoicecapFacts): string[] =>
      cardsOf(pageWith(facts))
        .filter((card) => textOf(card).includes("the current version"))
        .map((card) => /<span class="pill good">([^<]*)<\/span>/.exec(card)?.[1] ?? "");

    // Only the card of FACTS's own version says so.
    expect(FACTS.version).toBe("0.13.2");
    expect(current(WITH_POINTS)).toEqual(["0.13.2"]);
    expect((html.match(/the current version/g) ?? []).length).toBe(1);
    // An older version built it: its card is the one, and the newest isn't.
    expect(current({ ...WITH_POINTS, version: "0.13.1" })).toEqual(["0.13.1"]);
    // A build that is ahead of its CHANGELOG, or has no release of its own, marks none.
    expect(current({ ...WITH_POINTS, version: "0.14.0" })).toEqual([]);
  });

  it("gives each card a first line of its version in a pill, its day in a time, and, on the current one, a dot a screen reader skips and the words that say so", () => {
    const [newest, older] = cardsOf(html);

    expect(lineOf(newest ?? "")).toBe("0.13.2 9 October 2026 · the current version");
    expect(lineOf(older ?? "")).toBe("0.13.1 8 October 2026");
    expect(newest).toContain('<time datetime="2026-10-09">9 October 2026</time>');
    expect(older).toContain('<time datetime="2026-10-08">8 October 2026</time>');
    // The dot is for the eye alone.
    expect(newest).toContain('<span class="sep" aria-hidden="true">·</span>');
    expect(older).not.toContain("·");
  });

  it("heads each card with its headline, under the page's h1", () => {
    const headings = headingsOf(html);

    expect(headings).toEqual([
      [1, "What's New"],
      [2, "A page that shows how voicecap can be checked"],
      [2, "The website's headings say more at a glance, and each site links to the site itself"],
      [2, "The shareable page has a new order, and its Word copy follows it"],
    ]);
    // One h2 in each card, and none skips a level on the way down.
    for (const card of cardsOf(html)) expect(card.match(/<h2\b/g)).toHaveLength(1);
    const levels = headings.map(([level]) => level);
    levels.forEach((level, index) => {
      expect(level - (levels[index - 1] ?? 0), headings[index]?.[1]).toBeLessThanOrEqual(1);
    });
  });

  it("gives each card its points as a list: the code in the fixed-width font, each piece escaped", () => {
    const [first, second, third] = cardsOf(html);

    expect(pointsOf(first ?? "").map(({ words }) => words)).toEqual([
      "A link to it ends the bar",
      "Every number is generated, as package.json says",
    ]);
    expect(pointsOf(first ?? "")[1]?.markup).toBe(
      "Every number is generated, as <code>package.json</code> says",
    );
    expect(pointsOf(second ?? "").map(({ markup }) => markup)).toEqual([
      "Each site&#39;s name has &quot;Visit the site&quot; beside it",
      "<code>buildSite</code>&#39;s <code>SiteContent</code> gives each site its address",
    ]);
    // A release with no point has no list: a screen reader would announce an empty one.
    expect(third).not.toContain("<ul");
    expect(first).toMatch(/<\/h2>\n<ul>\n/);
  });

  it("leaves out the heading and the list a release has none to put in", () => {
    const bare: VoicecapRelease = { version: "0.3.0", date: "2026-09-28", headline: "", items: [] };

    const page = pageWith({ ...FACTS, version: "0.3.0", releases: [bare] });

    const [card] = cardsOf(page);
    expect(headingsOf(page)).toEqual([[1, "What's New"]]);
    expect(card).not.toContain("<h2");
    expect(card).not.toContain("<ul");
    // It's still a card: its version, its day, and the link to its entry.
    expect(lineOf(card ?? "")).toBe("0.3.0 28 September 2026 · the current version");
    expect(linksOf(card ?? "")).toEqual([
      { href: changelogHref(bare), words: "The full entry in the CHANGELOG for 0.3.0" },
    ]);
  });

  it("links each card to its entry, naming its version for a screen reader", () => {
    const cards = cardsOf(html);

    expect(cards).toHaveLength(FACTS.releases.length);
    FACTS.releases.forEach((release, index) => {
      const card = cards[index] ?? "";
      // Each href is the release's heading on GitHub, and the one link of the card.
      expect(linksOf(card), release.version).toEqual([
        {
          href: changelogHref(release),
          words: `The full entry in the CHANGELOG for ${release.version}`,
        },
      ]);
      // The version is for a screen reader alone, after the link's own words.
      expect(card).toContain(
        `>The full entry in the CHANGELOG<span class="sr"> for ${release.version}</span></a>`,
      );
    });
    // So no two links read alike, though each goes to a place of its own.
    const words = cards.flatMap((card) => linksOf(card).map((link) => link.words));
    expect(new Set(words).size).toBe(words.length);
    expect(
      linksOf(html)
        .filter((link) => link.href.includes("CHANGELOG.md#"))
        .map((link) => link.href),
    ).toEqual(FACTS.releases.map((release) => changelogHref(release)));
  });

  it("draws every word from the CHANGELOG as text", () => {
    const hostile = "<script>alert(1)</script> & <b>";
    const release: VoicecapRelease = {
      version: "0.13.2<u>x</u>",
      date: "2026-10-09",
      headline: hostile,
      items: [[hostile], ["a ", { code: hostile }, " b"]],
    };

    const page = pageWith({ ...FACTS, version: release.version, releases: [release] });

    const markup = markupOf(page);
    expect(markup).toContain("<h2>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;</h2>");
    expect(markup).toContain("<li>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;</li>");
    expect(markup).toContain(
      "<li>a <code>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;</code> b</li>",
    );
    expect(markup).toContain("0.13.2&lt;u&gt;x&lt;/u&gt;");
    // Nothing the CHANGELOG holds became markup: no element it names, and no attribute it adds. The
    // page has no script but its own.
    expect(page.match(/<script\b/g)).toHaveLength(1);
    const { elements, attributes } = namesIn(markup);
    expect(elements.filter((element) => ["b", "u"].includes(element))).toEqual([]);
    expect(attributes.filter((name) => /^(?:on|style$|src)/.test(name))).toEqual([]);
  });

  it("draws the CHANGELOG's own lines as plain text: a script, an ampersand, a tag, and a lone backtick", () => {
    const text = [
      "## [1.0.0] - 2026-01-01",
      "",
      "- **<script>alert(1)</script> & <b>bold</b>.** <i>more</i>",
      '  - **A lone ` tick, an & and a <img src=x onerror=alert(1)>:** "quoted"',
      "  - <i>a point</i> & more: <b>x</b>",
      "",
    ].join("\n");
    const facts = voicecapFactsOf({ version: "1.0.0" }, text, undefined);

    const page = pageWith(facts);

    const markup = markupOf(page);
    expect(markup).toContain(
      "<h2>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt;</h2>",
    );
    const [card] = cardsOf(page);
    expect(pointsOf(card ?? "").map(({ markup }) => markup)).toEqual([
      "A lone ` tick, an &amp; and a &lt;img src=x onerror=alert(1)&gt;",
      "&lt;i&gt;a point&lt;/i&gt; &amp; more",
    ]);
    expect(page.match(/<script\b/g)).toHaveLength(1);
    const { elements, attributes } = namesIn(markup);
    expect(elements.filter((element) => ["b", "i", "img"].includes(element))).toEqual([]);
    expect(attributes.filter((name) => /^(?:on|style$|src)/.test(name))).toEqual([]);
  });

  it("says when no release is recorded, with no list and no card", () => {
    for (const content of [CONTENT, { demo: null, sites: [] }] as SiteContent[]) {
      const page = pageWith({ ...FACTS, releases: [] }, content);

      expect(textsOf(page, "p")).toContain(NONE);
      expect(page).not.toContain("<ol");
      expect(cardsOf(page)).toEqual([]);
      // The rest is there: the heading and the lead, and no link to a CHANGELOG entry.
      expect(textsOf(page, "h1")).toEqual(["What's New"]);
      expect(headingsOf(page)).toEqual([[1, "What's New"]]);
      expect(linksOf(page).filter((link) => link.href.includes("CHANGELOG.md"))).toEqual([]);
    }
    // With releases, it doesn't say so.
    expect(textOf(markupOf(html))).not.toContain(NONE);
  });

  it("draws a website with no report yet, whole", () => {
    const page = pageWith(WITH_POINTS, { demo: null, sites: [] });

    expect(cardsOf(page)).toHaveLength(3);
    // The bar's one view is the sites', and each link goes to a page of the website.
    const bar = /<nav\b[\s\S]*?<\/nav>/.exec(page)?.[0] ?? "";
    expect(linksOf(bar).map(({ href }) => href)).toEqual(["index.html#sites", "trust.html"]);
  });

  it("links only where it says: the bar's pages, the skip link, each release's entry, and voicecap on GitHub", () => {
    const allowed = new Set([
      "#main",
      "index.html#demo",
      "index.html#sites",
      "index.html#by-date",
      "trust.html",
      GITHUB,
      ...FACTS.releases.map((release) => changelogHref(release)),
    ]);

    const hrefs = linksOf(html).map(({ href }) => href);

    expect(hrefs.filter((href) => !allowed.has(href))).toEqual([]);
    expect(new Set(hrefs)).toEqual(allowed);
  });

  it("names Guidepup only where the CHANGELOG's own words do, and never calls voicecap automated, or says a person listened", () => {
    // Its own words, over FACTS's releases, name none of the three.
    const own = textOf(markupOf(pageWith(FACTS)));
    expect(own).not.toMatch(/guidepup/i);
    expect(own).not.toMatch(/automat/i);
    expect(own).not.toMatch(/listen/i);

    // A release whose points name it says so, as the CHANGELOG does: the page leaves its words as
    // they are. (The CHANGELOG's own headlines never do: see test/site-changelog.test.ts.)
    const release: VoicecapRelease = {
      version: "0.2.0",
      date: "2026-09-27",
      headline: "Phase B",
      items: [
        ["The Guidepup NVDA driver"],
        ["After a closed terminal window, your NVDA starts once Guidepup's has quit"],
      ],
    };
    const page = pageWith({ ...FACTS, version: "0.2.0", releases: [release] });
    expect(pointsOf(cardsOf(page)[0] ?? "").map(({ words }) => words)).toEqual([
      "The Guidepup NVDA driver",
      "After a closed terminal window, your NVDA starts once Guidepup's has quit",
    ]);
  });

  it("draws a card for each release the real CHANGELOG records, each with its own link", async () => {
    const facts = await readVoicecapFacts();

    const page = pageWith(facts);

    const cards = cardsOf(page);
    expect(facts.releases.length).toBeGreaterThan(10);
    expect(cards).toHaveLength(facts.releases.length);
    // The package that runs these tests is the current version, in its own card.
    const version = facts.version;
    expect(
      cards
        .filter((card) => textOf(card).includes("the current version"))
        .map((card) => lineOf(card).split(" ")[0]),
    ).toEqual([version]);
    // Each card has a heading, its headline, and the link to its entry; no card has an empty list.
    expect(
      headingsOf(page)
        .slice(1)
        .map(([, words]) => words),
    ).toEqual(facts.releases.map(({ headline }) => headline));
    expect(page).not.toMatch(/<ul>\s*<\/ul>/);
    expect(page).not.toMatch(/<h2>\s*<\/h2>/);
    expect(
      linksOf(page)
        .filter((link) => link.href.includes("CHANGELOG.md#"))
        .map((link) => link.href),
    ).toEqual(facts.releases.map((release) => changelogHref(release)));
  });

  it("is the same page for the same facts, and changes none of them", () => {
    const before = structuredClone({ voicecap: WITH_POINTS, content: CONTENT });

    expect(pageWith()).toBe(html);
    expect({ voicecap: WITH_POINTS, content: CONTENT }).toEqual(before);
  });
});
