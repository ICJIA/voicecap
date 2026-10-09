/**
 * The website's What's New page, `whats-new.html`, as a pure function of the facts it states
 * (./facts.ts): every release of voicecap, newest first, from its CHANGELOG, a card each, for
 * whoever wants the detail of what changed and when. Its words are ./text.ts's
 * (`SITE_TEXT.whatsNew`), and everything it says of a release (its version, its day, its headline,
 * its points) is the CHANGELOG's, never typed in, so building the same records with the same
 * package writes the same bytes, as the website's other pages do. The CHANGELOG ships with the
 * package and is read at each build, so a new release appears on its own, once a build runs with
 * it.
 *
 * It's one of the website's pages, in the website's frame (./frame.ts): the same head, with one
 * style block (SITE_CSS, which embeds no font) and one script (SITE_SCRIPT); the skip link; the
 * bar; and the footer. It sets no `style` attribute, since a Content Security Policy that hashes its
 * style block and its script allows nothing else.
 *
 * Its main part, in order: a kicker over the page's heading, an h1, then its lead; and an ordered
 * list of cards, one for each release, in the order the facts give them, which is the CHANGELOG's,
 * the newest first. Each card holds, in order:
 *
 *   - its first line: the version, as a pill; its day, in a `time` that holds the day it names; and,
 *     on the version that built the website, "the current version";
 *   - its headline, an h2, when its entry has one;
 *   - its points, a list, when it has any: each piece escaped, with code in `<code>`;
 *   - the link to its entry in the CHANGELOG on GitHub, "The full entry in the CHANGELOG", which a
 *     screen reader hears with the version after it, so no two links sound alike.
 *
 * With no release recorded, it says so in their place, and draws no list.
 *
 * Every word of a release is plain text from the CHANGELOG, escaped: a code span is the fixed-width
 * font, and nothing else becomes markup, whatever a line holds (a `<script>`, an `&`, a lone
 * backtick). The one `<script>` the page has is its own. The page follows the website's rules:
 * headings in order (the page, then each release), landmarks, a skip link, visible keyboard focus,
 * and complete without JavaScript, as it has no fold.
 */
import { esc } from "../report/html.js";
import { changelogHref } from "./changelog.js";
import type { ReleaseItem, VoicecapFacts, VoicecapRelease } from "./facts.js";
import { siteBar, sitePage } from "./frame.js";
import type { SiteContent } from "./render.js";
import { SITE_TEXT } from "./text.js";

/** What the page is drawn from. */
export interface WhatsNewInput {
  /** What it says of voicecap: its version, and each release its CHANGELOG records. */
  voicecap: VoicecapFacts;
  /** What the website shows: only for the bar's links to the views of its own page (siteBar). */
  content: SiteContent;
}

/**
 * What the page's list says it is, as the website's other pages' lists do (IS_A_LIST in
 * ./render.ts): WebKit takes a list's semantics from one whose markers are removed, and the role
 * keeps it one.
 */
const IS_A_LIST = ' role="list"';

/** What sets two parts of a line apart: a dot that a reader sees, and a screen reader skips. */
const SEPARATOR = '<span class="sep" aria-hidden="true">·</span>';

/** An item as HTML: each piece escaped, and each code span in the fixed-width font. */
function itemHtml(item: ReleaseItem): string {
  return item
    .map((piece) => (typeof piece === "string" ? esc(piece) : `<code>${esc(piece.code)}</code>`))
    .join("");
}

/**
 * A release's card: its first line (the version in a pill, its day, and, when `current`, the words
 * that say it built the website), its headline and its points when it has them, and the link to its
 * entry. The link's visible words are the same on every card, and the version after them is for a
 * screen reader alone.
 */
function card(release: VoicecapRelease, current: boolean): string {
  const words = SITE_TEXT.whatsNew;
  const { version, date, headline, items } = release;
  const day = `<time datetime="${esc(date)}">${esc(words.day(date))}</time>`;
  const marker = current ? `<span class="current">${SEPARATOR} ${esc(words.current)}</span>` : "";
  return [
    '<li class="card update">',
    `<p class="update-line"><span class="pill good">${esc(version)}</span> ${day}${marker}</p>`,
    ...(headline === "" ? [] : [`<h2>${esc(headline)}</h2>`]),
    // No list with nothing in it: a screen reader would announce it.
    ...(items.length === 0
      ? []
      : ["<ul>", ...items.map((item) => `<li>${itemHtml(item)}</li>`), "</ul>"]),
    `<a href="${esc(changelogHref(release))}">${esc(words.link)}<span class="sr">${esc(words.linkFor(version))}</span></a>`,
    "</li>",
  ].join("\n");
}

/**
 * The page, from the facts it states: its main part, in the website's frame (sitePage in
 * ./frame.ts), with the bar of this page, whose links to the views follow `content`. Each release
 * the facts give is a card, in their order; the one that is `voicecap.version` says it's the
 * current version. Pure.
 */
export function renderWhatsNew({ voicecap, content }: WhatsNewInput): string {
  const words = SITE_TEXT.whatsNew;
  const { releases, version } = voicecap;
  return sitePage({
    title: words.title,
    bar: siteBar(content, "whats-new"),
    main: [
      '<div class="hero">',
      `<p class="kicker">${esc(words.kicker)}</p>`,
      `<h1>${esc(words.heading)}</h1>`,
      `<p class="lead">${esc(words.lead)}</p>`,
      "</div>",
      releases.length === 0
        ? `<p>${esc(words.none)}</p>`
        : [
            `<ol class="updates"${IS_A_LIST}>`,
            ...releases.map((release) => card(release, release.version === version)),
            "</ol>",
          ].join("\n"),
    ],
  });
}
