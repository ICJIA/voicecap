/**
 * The website's "Can I trust this?" page, `trust.html`, as a pure function of the facts it states
 * (./facts.ts): what voicecap does and who built it, how what it records can be checked, and how it
 * tests itself, for a manager who shouldn't have to take one person's tool on trust. Its words are
 * ./trust-text.ts's, and every number and date about voicecap in them is one of the facts, never
 * typed in, so building the same records with the same package writes the same bytes, as the
 * website's own page does. A fact that isn't there is said not to be, in its place, and a big
 * number that isn't there is a "—", which a screen reader hears as "not recorded".
 *
 * It's one of the website's pages, in the website's frame (./frame.ts): the same head, with one
 * style block (SITE_CSS, which embeds no font) and one script (SITE_SCRIPT); the skip link; and the
 * two bars, whose links to this page say it's the page the reader is on, the bottom one with the
 * version of voicecap that built it. It sets no `style` attribute, since a Content Security Policy
 * that hashes its style block and its script allows nothing else.
 *
 * Its main part, in order:
 * - the way back to the test results, on the website's front page;
 * - its head, as the audit tool's trust page heads itself: a kicker over the page's heading, an h1
 *   in two lines, the second in the color of what's good; then the lead; the stamp, in the audit
 *   tool's amber box, of where its counts come from, at its left, and the records' date, at its
 *   right; and four big numbers, each in the color the audit tool's tiles give it, with a line that
 *   says what it counts and a link to where it's shown;
 * - eight sections, each a region named by its heading, an h2, with its kicker above it: what it
 *   does; that the screen reader is the real one; the law, a card for each of its three names; the
 *   evidence, with how to check a copy of a file, where the files tile links; how it's tested;
 *   what it doesn't do; the objection that one person built it, answered in six cards; and how it
 *   got here, the newest five releases, each version a pill as on What's New, then, when there are
 *   more, a link to What's New, which has every one, and the link to the CHANGELOG.
 *
 * Nothing follows the last section: the bottom bar, on every page, links to voicecap on GitHub and
 * to its CHANGELOG, and says the version.
 *
 * The page follows the website's rules: headings in order (the page, then each section, then each
 * card), landmarks, a skip link, visible keyboard focus, and complete without JavaScript, as it has
 * no fold and no part the script draws. What the facts hold goes through `esc`, and so do the fixed
 * words, which are plain text.
 */
import { esc } from "../report/html.js";
import { count } from "../share/format.js";
import { lineHtml } from "../share/html/parts.js";
import type { Line } from "../share/line.js";
import type { RecordFacts, ReleaseFacts, VoicecapFacts, VoicecapRelease } from "./facts.js";
import { backLink, sitePage, WHATS_NEW_HREF } from "./frame.js";
import { TRUST_TEXT } from "./trust-text.js";

/** What the page is drawn from. */
export interface TrustInput {
  /** What it says of voicecap: its version, its releases, and what its release recorded. */
  voicecap: VoicecapFacts;
  /** What it says of the records, counted from what the website shows (recordFactsOf). */
  records: RecordFacts;
}

/** The reports, on the website's own page, beside this one: its view of the sites. */
const REPORTS_HREF = "index.html#sites";

/**
 * How many releases the page lists, the newest first. With more, a link after them goes to What's
 * New, which has every one.
 */
const SHOWN = 5;

/**
 * The id of the evidence part's point on how to check a copy of a file, which the files tile links
 * to: no section's, and no heading's.
 */
const CHECK = "check";

/** The page's sections, by their ids: the big numbers link to two of them. */
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

/** A big number's color, as the audit tool's tiles have theirs: one of the style's own (`.n.good`). */
type BigColor = "good" | "act" | "warn";

/**
 * A big number as HTML, in its color. None is a "—", which a screen reader hears as "not
 * recorded": the dash is hidden from it, and the words are hidden from view. It has no color of its
 * own: the style draws it quieter than a number.
 */
function bigHtml(big: Big, color: BigColor): string {
  if (big === null) {
    return `<p class="n none"><span aria-hidden="true">—</span><span class="sr">${esc(TRUST_TEXT.notRecorded)}</span></p>`;
  }
  if ("count" in big) return `<p class="n ${color}">${esc(count(big.count))}</p>`;
  const of = `<span class="of">${esc(TRUST_TEXT.tiles.pages.of)}</span>`;
  return `<p class="n ${color}">${esc(count(big.part))} ${of} ${esc(count(big.whole))}</p>`;
}

/** One of the four big numbers: the number, a line that says what it counts, and its link. */
function tile(big: Big, color: BigColor, line: string, link: Link): string {
  return `<li class="tile">${bigHtml(big, color)}<p class="k">${esc(line)}</p>${linkHtml(link)}</li>`;
}

/**
 * The stamp, in the audit tool's amber box: at its left, its label, which says where the counts
 * come from, the version of voicecap, the day it was released, and the records; at its right, the
 * records' date, when the newest report was shared, or that none has been.
 */
function stamp({ version, released }: VoicecapFacts, newest: string | null): string {
  const { label, date } = TRUST_TEXT.hero.stamp;
  return `<div class="stamp"><p class="source">${esc(label(version, released))}</p><p class="date">${esc(date(newest))}</p></div>`;
}

/**
 * The page's head, as the audit tool's trust page heads itself: the kicker over the page's heading,
 * whose second line is in the color of what's good, then the lead, the stamp, and the four big
 * numbers, in the audit tool's tiles' colors (two in --good, one in --act, one in --warn): the
 * tests that passed, the pages NVDA read of the pages in scope, the files published, and the
 * releases, each linked to where it's shown: how it's tested, the reports, how to check a copy, and
 * how it got here.
 */
function hero({ voicecap, records }: TrustInput): string {
  const { hero: words, tiles } = TRUST_TEXT;
  const tests = voicecap.release?.tests ?? null;
  const releases = voicecap.releases.length;
  const { reading, files } = records;
  return [
    '<div class="hero">',
    `<p class="kicker">${esc(words.kicker)}</p>`,
    `<h1>${esc(words.heading.first)} <span class="good">${esc(words.heading.second)}</span></h1>`,
    `<p class="lead">${esc(words.lead)}</p>`,
    stamp(voicecap, records.newest),
    `<ul class="tiles"${IS_A_LIST}>`,
    tile(tests === null ? null : { count: tests.passed }, "good", tiles.tests.line(tests), {
      words: tiles.tests.link,
      href: `#${PARTS.tested}`,
    }),
    tile(
      reading === null ? null : { part: reading.read, whole: reading.pages },
      "good",
      tiles.pages.line(records),
      { words: tiles.pages.link, href: REPORTS_HREF },
    ),
    tile({ count: files.published }, "act", tiles.files.line(files), {
      words: tiles.files.link,
      href: `#${CHECK}`,
    }),
    tile(
      releases === 0 ? null : { count: releases },
      "warn",
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

/**
 * A point of a section's list: its words, a link to where it's shown, when it has one, and an id,
 * when a link on the page goes to it.
 */
interface Point {
  words: string | Line;
  link?: Link;
  id?: string;
}

/** A section's points, a list of them. */
function points(list: readonly Point[]): string {
  return [
    `<ul class="points"${IS_A_LIST}>`,
    ...list.map(
      ({ words, link, id }) =>
        `<li${id === undefined ? "" : ` id="${esc(id)}"`}><p>${wordsHtml(words)}</p>${link === undefined ? "" : linkHtml(link)}</li>`,
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

/**
 * How every word can be checked: a point each; how many files the website publishes; and, after
 * it, how to check a copy of one, where the files tile links, with a link to where the files and
 * their fingerprints are listed.
 */
function evidence(files: RecordFacts["files"]): string {
  const words = TRUST_TEXT.evidence;
  return part(PARTS.evidence, words, [
    points([
      words.sealed,
      words.verify,
      { words: words.browser.words, link: { words: words.browser.link, href: REPORTS_HREF } },
      { words: words.published(files) },
      {
        words: words.check.words,
        link: { words: words.check.link, href: REPORTS_HREF },
        id: CHECK,
      },
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
 * A release: its first line, as What's New's cards have it, its version as a pill and its day, which
 * is a time that holds the day it names; then its headline, when its entry has one. With none,
 * nothing follows the day.
 */
function releaseItem({ version, date, headline }: VoicecapRelease): string {
  const day = `<time datetime="${esc(date)}">${esc(TRUST_TEXT.releases.day(date))}</time>`;
  const line = `<p class="on"><span class="pill good">${esc(version)}</span> ${day}</p>`;
  return `<li>${line}${headline === "" ? "" : `<p>${esc(headline)}</p>`}</li>`;
}

/** Releases, a list of them, in the order given. */
function releaseList(releases: readonly VoicecapRelease[]): string {
  return [`<ol class="releases"${IS_A_LIST}>`, ...releases.map(releaseItem), "</ol>"].join("\n");
}

/**
 * How it got here: the newest five releases; then a line of links, set apart by a dot a screen
 * reader skips, after a space that doesn't break, so the dot ends a line rather than start one:
 * when there are more than five, one to What's New, which has every release and says how many
 * there are; and the one to the CHANGELOG. With no release, it says they aren't recorded.
 */
function history(releases: readonly VoicecapRelease[]): string {
  const words = TRUST_TEXT.releases;
  const rest =
    releases.length > SHOWN
      ? [linkHtml({ words: words.all(releases.length), href: WHATS_NEW_HREF })]
      : [];
  return part(PARTS.releases, words, [
    releases.length === 0 ? `<p>${esc(words.none)}</p>` : releaseList(releases.slice(0, SHOWN)),
    `<p class="more">${[...rest, linkHtml(words.changelog)].join(`\u00a0${SEPARATOR} `)}</p>`,
  ]);
}

/**
 * The page, from the facts it states: its main part, which starts with the way back to the test
 * results and ends with how it got here, in the website's frame (sitePage in ./frame.ts), with the
 * bars of this page, the bottom one linking to voicecap on GitHub and to its CHANGELOG, and saying
 * its version. Pure.
 */
export function renderTrustPage(input: TrustInput): string {
  const { voicecap, records } = input;
  const { does, nvda, limits } = TRUST_TEXT;
  return sitePage({
    title: TRUST_TEXT.title,
    current: "trust",
    version: voicecap.version,
    main: [
      backLink(),
      hero(input),
      part(PARTS.does, does, [`<p class="lead">${esc(does.text)}</p>`]),
      part(PARTS.nvda, nvda, [`<p class="lead">${esc(nvda.text)}</p>`]),
      law(),
      evidence(records.files),
      tested(voicecap.release),
      part(PARTS.limits, limits, [points(limits.items.map((words) => ({ words })))]),
      builder(voicecap),
      history(voicecap.releases),
    ],
  });
}
