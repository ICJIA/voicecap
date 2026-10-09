/**
 * What every page of the website shares: the top bar, the bottom bar, the way back to the test
 * results, and the shell around a page's main part. The website has four pages, its own
 * (`index.html`, drawn by ./render.ts), the trust page (`trust.html`), What's New
 * (`whats-new.html`), and Technical details (`technical-details.html`), and each takes these from
 * here, so the four pages' bars can't drift apart: they're the same on each, but for the link of
 * the page the reader is on.
 *
 * The shell is built as the shareable page's is (see ../share/html/document.ts), in the look of the
 * audit tool, audit.icjia.app (see ./style.ts): one self-contained file, dark by default with a
 * switch to light, with one style block (SITE_CSS) and one script (SITE_SCRIPT), and nothing loaded
 * from outside it, not even a font: its words are in the system's own fonts. It sets no `style`
 * attribute, since a Content Security Policy that hashes the style block and the script allows
 * nothing else.
 *
 * In order: the head; a skip link to the main content; the top bar; `main`, which a page fills; the
 * bottom bar; and last, the script. The bars are the audit tool's:
 * - the top bar has the website's name, a link to the front page, then a navigation, "This
 *   website", with a link to each of the website's three other pages, and the theme button, an
 *   icon, hidden until the script shows it, since without the script it would do nothing;
 * - the bottom bar is a list of six: voicecap on GitHub, its CHANGELOG, and the website's three
 *   other pages, each link an icon and its words, and the version of voicecap that built the
 *   website, which a screen reader hears as "voicecap version 0.15.0". It's a list and nothing
 *   else, so a screen reader hears six items: the lines between them are the style's.
 *
 * The link of the page the reader is on says so (`aria-current="page"`), in both bars: on the front
 * page, that's the website's name, which the bottom bar has no link for. The page's style draws it
 * by more than its color. Every link goes to a page beside this one, or to GitHub, in the same tab,
 * as the audit tool's do. What a record or a fact supplies goes through `esc`, and so does the
 * fixed text (./text.ts), which is plain words.
 */
import { esc } from "../report/html.js";
import { CHANGELOG_URL } from "./changelog.js";
import { SITE_SCRIPT } from "./client.js";
import { FRAME_ICONS } from "./icons.js";
import { SITE_CSS } from "./style.js";
import { SITE_TEXT } from "./text.js";

/** The pages of the website: its own, the trust page, What's New, and Technical details. */
export type SitePage = "index" | "trust" | "technical" | "whats-new";

/** The website's own page, with the test results, as the other pages link to it: beside them. */
const INDEX_HREF = "index.html";

/** One of the website's three other pages: its address beside this page, its words, and its icon. */
interface OtherPage {
  page: SitePage;
  href: string;
  words: string;
  icon: string;
}

const TRUST: OtherPage = {
  page: "trust",
  href: "trust.html",
  words: SITE_TEXT.trust,
  icon: FRAME_ICONS.trust,
};
const WHATS_NEW: OtherPage = {
  page: "whats-new",
  href: "whats-new.html",
  words: SITE_TEXT.whatsNew.heading,
  icon: FRAME_ICONS.whatsNew,
};
const TECHNICAL: OtherPage = {
  page: "technical",
  href: "technical-details.html",
  words: SITE_TEXT.technical,
  icon: FRAME_ICONS.technical,
};

/**
 * The three pages in each bar's order, as the audit tool's bars give theirs: the top bar leads with
 * the trust page, and the bottom bar, after GitHub and the CHANGELOG, with What's New.
 */
const TOP_BAR_PAGES: readonly OtherPage[] = [TRUST, WHATS_NEW, TECHNICAL];
const BOTTOM_BAR_PAGES: readonly OtherPage[] = [WHATS_NEW, TRUST, TECHNICAL];

/** What a link's tag says when it's the link of the page the reader is on, and nothing else. */
const currentIf = (here: boolean): string => (here ? ' aria-current="page"' : "");

/**
 * The top bar of the page `current`: the website's name, a link to the front page; then the
 * navigation of the website, with a link to each of its three other pages and, last, the theme
 * button. Of the four links, the one to the page the reader is on says so. The button is an icon,
 * a sun and a moon, of which the style shows the one for the theme, and its words are its label,
 * which the script keeps in step with the theme: here, the dark one's, which the page starts in.
 * It's in the navigation so that it wraps with the links, after the last of them.
 */
export function siteBar(current: SitePage): string {
  return [
    '<header class="bar">',
    `<a class="name" href="${INDEX_HREF}"${currentIf(current === "index")}>${esc(SITE_TEXT.siteName)}</a>`,
    `<nav aria-label="${esc(SITE_TEXT.nav)}">`,
    ...TOP_BAR_PAGES.map(
      ({ page, href, words }) =>
        `<a href="${href}"${currentIf(page === current)}>${esc(words)}</a>`,
    ),
    `<button class="theme" id="theme-toggle" type="button" hidden aria-label="${esc(SITE_TEXT.theme.light)}">${FRAME_ICONS.sun}${FRAME_ICONS.moon}</button>`,
    "</nav>",
    "</header>",
  ].join("\n");
}

/**
 * The bottom bar of the page `current`: a list of six, voicecap on GitHub, its CHANGELOG, the
 * website's three other pages (What's New first, as the audit tool's bottom bar has it), each link
 * its icon, which a screen reader skips, and its words; and last, `version`, the version of
 * voicecap that built the website, as "v0.15.0" for the eye and "voicecap version 0.15.0" for a
 * screen reader. Of the three pages' links, the one to the page the reader is on says so.
 */
export function siteFooter(current: SitePage, version: string): string {
  const { footer } = SITE_TEXT;
  const link = (href: string, icon: string, words: string, here = false): string =>
    `<li><a href="${esc(href)}"${currentIf(here)}>${icon}${esc(words)}</a></li>`;
  return [
    "<footer>",
    '<ul role="list">',
    link(SITE_TEXT.github, FRAME_ICONS.github, footer.github),
    link(CHANGELOG_URL, FRAME_ICONS.changelog, footer.changelog),
    ...BOTTOM_BAR_PAGES.map(({ page, href, words, icon }) =>
      link(href, icon, words, page === current),
    ),
    `<li><span aria-hidden="true">${esc(footer.version(version))}</span><span class="sr">${esc(footer.versionHeard(version))}</span></li>`,
    "</ul>",
    "</footer>",
  ].join("\n");
}

/**
 * The way back to the test results, which the trust page, What's New, and Technical details start
 * their main part with: a link to the front page, after an arrow, which a screen reader skips.
 */
export function backLink(): string {
  return `<a class="back" href="${INDEX_HREF}">${FRAME_ICONS.back}${esc(SITE_TEXT.back)}</a>`;
}

/**
 * A page of the website, from the parts only it has: its `title`, which is plain text and is escaped
 * here; which page it is (`current`), for its bars; `version`, the version of voicecap that built
 * the website, which the bottom bar says; and the lines of its `main` part, which go in
 * `<main id="main">`, and are HTML already, with whatever a record or a fact supplies through
 * `esc`. The page's one style block is SITE_CSS, which embeds no font. Pure.
 */
export function sitePage(parts: {
  title: string;
  current: SitePage;
  version: string;
  main: string[];
}): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow, noarchive">',
    `<title>${esc(parts.title)}</title>`,
    `<style>\n${SITE_CSS}</style>`,
    "</head>",
    "<body>",
    `<a class="skip" href="#main">${esc(SITE_TEXT.skip)}</a>`,
    siteBar(parts.current),
    '<main id="main">',
    ...parts.main,
    "</main>",
    siteFooter(parts.current, parts.version),
    `<script>${SITE_SCRIPT}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
