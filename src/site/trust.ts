/**
 * The website's "Can I trust this?" page, `trust.html`, as a pure function of the facts it states
 * (./facts.ts): what voicecap does and who built it, how what it records can be checked, and how it
 * tests itself, for a manager who shouldn't have to take one person's tool on trust. Its words are
 * ./trust-text.ts's, and every number and date about voicecap in them is one of the facts, never
 * typed in, so building the same records with the same package writes the same bytes, as the
 * website's own page does. A fact that isn't there is said not to be, in its place, and a big
 * number that isn't there is a "—", which a screen reader hears as "not recorded".
 *
 * It's the website's other page, in the website's frame (./frame.ts): the same head, with one style
 * block (the fonts, then SITE_CSS) and one script (SITE_SCRIPT); the skip link; the bar, whose link
 * to this page says it's the page the reader is on; and the footer. It sets no `style` attribute,
 * since a Content Security Policy that hashes its style block and its script allows nothing else.
 *
 * Its main part, in order:
 * - its banner, in the website's banner style (`view-head`): the shield, in its circle, and the
 *   page's heading, an h1; then a kicker, the lead, the stamp of where its numbers come from, and
 *   four big numbers, each with a line that says what it counts and a link to where it's shown;
 * - eight sections, each a region named by its heading, an h2, with its kicker above it: what it
 *   does; that the screen reader is the real one; the law, a card for each of its three names; the
 *   evidence; how it's tested; what it doesn't do; the objection that one person built it, answered
 *   in six cards; and how it got here, the newest five releases, with the rest in a fold;
 * - a line of links to voicecap, on GitHub, its CHANGELOG, and npm, and its version.
 *
 * The page follows the website's rules: headings in order (the page, then each section, then each
 * card), landmarks, a skip link, visible keyboard focus, and complete without JavaScript, as its
 * one fold is `details`. What the facts hold goes through `esc`, and so do the fixed words, which
 * are plain text.
 */
import { esc } from "../report/html.js";
import { count } from "../share/format.js";
import { lineHtml } from "../share/html/parts.js";
import type { Line } from "../share/line.js";
import type { RecordFacts, ReleaseFacts, VoicecapFacts, VoicecapRelease } from "./facts.js";
import { siteBar, sitePage } from "./frame.js";
import { SITE_ICONS } from "./icons.js";
import type { SiteContent } from "./render.js";
import { TRUST_TEXT } from "./trust-text.js";

/** What the page is drawn from. */
export interface TrustInput {
  /** What it says of voicecap: its version, its releases, and what its release recorded. */
  voicecap: VoicecapFacts;
  /** What it says of the records, counted from what the website shows (recordFactsOf). */
  records: RecordFacts;
  /** What the website shows: only for the bar's links to the views of its own page (siteBar). */
  content: SiteContent;
}

/** The reports, on the website's own page, beside this one: its view of the sites. */
const REPORTS_HREF = "index.html#sites";

/** How many releases the page lists, the newest first. The others are in a fold, closed. */
const SHOWN = 5;

/** The page's sections, by their ids: the big numbers link to three of them. */
const PARTS = {
  does: "does",
  nvda: "nvda",
  law: "law",
  evidence: "evidence",
  tested: "tested",
  limits: "limits",
  builder: "builder",
  releases: "releases",
} as const;

/** The id of the heading that names a section, from the section's own, as on the website's page. */
const headingId = (id: string): string => `heading-${id}`;

/**
 * What each of the page's lists says it is, as on the website's page (IS_A_LIST in ./render.ts):
 * WebKit takes a list's semantics from one whose markers are removed, and the role keeps it one.
 */
const IS_A_LIST = ' role="list"';

/**
 * What sets two links of a line apart, as on the website's page: a dot that a reader sees, and a
 * screen reader doesn't read.
 */
const SEPARATOR = '<span class="sep" aria-hidden="true">·</span>';

/** A link: its words, and where it goes. */
interface Link {
  words: string;
  href: string;
}

/** A link as HTML. */
function linkHtml({ words, href }: Link): string {
  return `<a href="${esc(href)}">${esc(words)}</a>`;
}

/** Words as HTML: plain words escaped, or a line, whose command is in the fixed-width font. */
function wordsHtml(words: string | Line): string {
  return typeof words === "string" ? esc(words) : lineHtml(words);
}

/** A big number: a count, a part of a whole ("41 of 41"), or none, for a fact that isn't there. */
type Big = { count: number } | { part: number; whole: number } | null;

/**
 * A big number as HTML. None is a "—", which a screen reader hears as "not recorded": the dash is
 * hidden from it, and the words are hidden from view.
 */
function bigHtml(big: Big): string {
  if (big === null) {
    return `<p class="n none"><span aria-hidden="true">—</span><span class="sr">${esc(TRUST_TEXT.notRecorded)}</span></p>`;
  }
  if ("count" in big) return `<p class="n">${esc(count(big.count))}</p>`;
  const of = `<span class="of">${esc(TRUST_TEXT.tiles.pages.of)}</span>`;
  return `<p class="n">${esc(count(big.part))} ${of} ${esc(count(big.whole))}</p>`;
}

/** One of the four big numbers: the number, a line that says what it counts, and its link. */
function tile(big: Big, line: string, link: Link): string {
  return `<li class="tile">${bigHtml(big)}<p class="k">${esc(line)}</p>${linkHtml(link)}</li>`;
}

/**
 * The page's banner: the shield and the page's heading, in the website's banner style, then the
 * kicker, the lead, the stamp, and the four big numbers. The tests that passed, the pages NVDA read
 * of the pages in scope, the files published, and the releases, each linked to where it's shown:
 * how it's tested, the reports, the evidence, and how it got here.
 */
function hero({ voicecap, records }: TrustInput): string {
  const { hero: words, tiles } = TRUST_TEXT;
  const tests = voicecap.release?.tests ?? null;
  const releases = voicecap.releases.length;
  const { reading, files } = records;
  return [
    '<div class="hero">',
    `<div class="view-head"><div class="title">${SITE_ICONS.trust}<h1>${esc(words.heading)}</h1></div></div>`,
    `<p class="kicker">${esc(words.kicker)}</p>`,
    `<p class="lead">${esc(words.lead)}</p>`,
    `<p class="stamp">${esc(words.stamp(voicecap.version, voicecap.released, records.newest))}</p>`,
    `<ul class="tiles"${IS_A_LIST}>`,
    tile(tests === null ? null : { count: tests.passed }, tiles.tests.line(tests), {
      words: tiles.tests.link,
      href: `#${PARTS.tested}`,
    }),
    tile(
      reading === null ? null : { part: reading.read, whole: reading.pages },
      tiles.pages.line(records),
      { words: tiles.pages.link, href: REPORTS_HREF },
    ),
    tile({ count: files.published }, tiles.files.line(files), {
      words: tiles.files.link,
      href: `#${PARTS.evidence}`,
    }),
    tile(
      releases === 0 ? null : { count: releases },
      tiles.releases.line(releases, voicecap.release?.commits ?? null),
      { words: tiles.releases.link, href: `#${PARTS.releases}` },
    ),
    "</ul>",
    "</div>",
  ].join("\n");
}

/**
 * One of the page's sections: a region named by its heading, an h2, as the website's views are
 * named by theirs, with its kicker above it. `inside` is HTML, already escaped.
 */
function part(id: string, words: { kicker: string; heading: string }, inside: string[]): string {
  return [
    `<section class="part" id="${esc(id)}" aria-labelledby="${esc(headingId(id))}">`,
    `<p class="kicker">${esc(words.kicker)}</p>`,
    `<h2 id="${esc(headingId(id))}">${esc(words.heading)}</h2>`,
    ...inside,
    "</section>",
  ].join("\n");
}

/** A point of a section's list: its words, and a link to where it's shown, when it has one. */
interface Point {
  words: string | Line;
  link?: Link;
}

/** A section's points, a list of them. */
function points(list: readonly Point[]): string {
  return [
    `<ul class="points"${IS_A_LIST}>`,
    ...list.map(
      ({ words, link }) =>
        `<li><p>${wordsHtml(words)}</p>${link === undefined ? "" : linkHtml(link)}</li>`,
    ),
    "</ul>",
  ].join("\n");
}

/**
 * A card: its tag, when it has one; its heading, an h3, which is a link to its source when it has
 * one (`href`); its words, a paragraph each; and a link after them, when it has one.
 */
interface Card {
  tag?: string;
  heading: string;
  href?: string;
  words: (string | Line)[];
  link?: Link;
}

/** A section's cards, a list of them. */
function cards(list: readonly Card[]): string {
  const card = ({ tag, heading, href, words, link }: Card): string =>
    [
      '<li class="card">',
      ...(tag === undefined ? [] : [`<p class="tag">${esc(tag)}</p>`]),
      `<h3>${href === undefined ? esc(heading) : linkHtml({ words: heading, href })}</h3>`,
      ...words.map((each) => `<p>${wordsHtml(each)}</p>`),
      ...(link === undefined ? [] : [linkHtml(link)]),
      "</li>",
    ].join("");
  return [`<ul class="cards"${IS_A_LIST}>`, ...list.map(card), "</ul>"].join("\n");
}

/** The law's three names, a card each, whose heading links to its source. */
function law(): string {
  const words = TRUST_TEXT.law;
  return part(PARTS.law, words, [`<p class="lead">${esc(words.lead)}</p>`, cards(words.cards)]);
}

/** How every word can be checked: a point each, and how many files the website publishes. */
function evidence(files: RecordFacts["files"]): string {
  const words = TRUST_TEXT.evidence;
  return part(PARTS.evidence, words, [
    points([
      words.sealed,
      words.verify,
      { words: words.browser.words, link: { words: words.browser.link, href: REPORTS_HREF } },
      { words: words.published(files) },
      words.walkthrough,
    ]),
  ]);
}

/** How voicecap tests itself, from what its release recorded, or that it isn't recorded. */
function tested(release: ReleaseFacts | null): string {
  const words = TRUST_TEXT.tested;
  return part(PARTS.tested, words, [
    points([
      { words: words.release(release?.tests ?? null) },
      { words: words.change(release?.ci ?? null) },
      { words: words.axe },
      { words: words.nvda },
    ]),
  ]);
}

/** The objection that one person built it, and its answer in six cards. */
function builder({ releases, release }: VoicecapFacts): string {
  const words = TRUST_TEXT.builder;
  const tests = release?.tests ?? null;
  const { code, reader, record, fingerprints, dated } = words;
  return part(PARTS.builder, words, [
    `<p class="lead">${esc(words.lead)}</p>`,
    cards([
      { heading: code.heading, words: [code.words], link: code.link },
      { heading: reader.heading, words: [reader.words] },
      { heading: record.heading, words: [record.words] },
      { heading: fingerprints.heading, words: [fingerprints.words] },
      { heading: words.tests.heading(tests), words: [words.tests.words(tests)] },
      {
        heading: dated.heading,
        words: [dated.words(releases.length, release?.commits ?? null)],
        link: dated.link,
      },
    ]),
  ]);
}

/**
 * A release: its version and its day, which is a time that holds the day it names, then its
 * headline, when its entry has one. With none, nothing follows the day.
 */
function releaseItem({ version, date, headline }: VoicecapRelease): string {
  const day = `<time datetime="${esc(date)}">${esc(TRUST_TEXT.releases.day(date))}</time>`;
  const line = `<p class="on"><span class="version">${esc(version)}</span> · ${day}</p>`;
  return `<li>${line}${headline === "" ? "" : `<p>${esc(headline)}</p>`}</li>`;
}

/** Releases, a list of them, in the order given. */
function releaseList(releases: readonly VoicecapRelease[]): string {
  return [`<ol class="releases"${IS_A_LIST}>`, ...releases.map(releaseItem), "</ol>"].join("\n");
}

/**
 * How it got here: the newest five releases; the others in a fold, closed until a reader opens it,
 * which says how many it holds; and the link to the CHANGELOG. With no release, it says they
 * aren't recorded.
 */
function history(releases: readonly VoicecapRelease[]): string {
  const words = TRUST_TEXT.releases;
  const earlier = releases.slice(SHOWN);
  const fold = [
    '<details class="fold">',
    `<summary>${esc(words.earlier(earlier.length))}</summary>`,
    '<div class="inside">',
    releaseList(earlier),
    "</div>",
    "</details>",
  ].join("\n");
  return part(PARTS.releases, words, [
    releases.length === 0 ? `<p>${esc(words.none)}</p>` : releaseList(releases.slice(0, SHOWN)),
    ...(earlier.length === 0 ? [] : [fold]),
    `<p class="more">${linkHtml(words.changelog)}</p>`,
  ]);
}

/**
 * The line above the footer: links to voicecap on GitHub, to its CHANGELOG, and on npm, then its
 * version, which is no link.
 */
function links(version: string): string {
  const words = TRUST_TEXT.links;
  const line = [linkHtml(words.github), linkHtml(words.changelog), linkHtml(words.npm)];
  return `<p class="links">${[...line, esc(words.version(version))].join(` ${SEPARATOR} `)}</p>`;
}

/**
 * The page, from the facts it states: its main part, in the website's frame (sitePage in
 * ./frame.ts), with the bar of this page, whose links to the views follow `content`. `fontCss` is
 * the fonts' `@font-face` rules (fontFaceCss in ../share/fonts.ts), which the page's style block
 * holds ahead of its own styles. Pure.
 */
export function renderTrustPage(input: TrustInput, assets: { fontCss: string }): string {
  const { voicecap, records, content } = input;
  const { does, nvda, limits } = TRUST_TEXT;
  return sitePage(
    {
      title: TRUST_TEXT.title,
      bar: siteBar(content, "trust"),
      main: [
        hero(input),
        part(PARTS.does, does, [`<p class="lead">${esc(does.text)}</p>`]),
        part(PARTS.nvda, nvda, [`<p class="lead">${esc(nvda.text)}</p>`]),
        law(),
        evidence(records.files),
        tested(voicecap.release),
        part(PARTS.limits, limits, [points(limits.items.map((words) => ({ words })))]),
        builder(voicecap),
        history(voicecap.releases),
        links(voicecap.version),
      ],
    },
    assets,
  );
}
