/**
 * What every page of the website shares: the bar, the footer, and the shell around a page's main
 * part. The website has four pages, its own (`index.html`, drawn by ./render.ts), the trust page
 * (`trust.html`), What's New (`whats-new.html`), and Technical details (`technical-details.html`),
 * and each takes these from here, so the four bars, and the four footers, can't drift apart.
 *
 * The shell is built as the shareable page's is (see ../share/html/document.ts), in the look of the
 * audit tool, audit.icjia.app (see ./style.ts): one self-contained file, dark by default with a
 * switch to light, with one style block (SITE_CSS) and one script (SITE_SCRIPT), and nothing loaded
 * from outside it, not even a font: its words are in the system's own fonts. It sets no `style`
 * attribute, since a Content Security Policy that hashes the style block and the script allows
 * nothing else.
 *
 * In order: the head; a skip link to the main content; the bar; `main`, which a page fills; the
 * footer; and last, the script. The bar has a link to each view of the website's own page that's
 * there, the link to the trust page after them, and the theme button, hidden until the script shows
 * it. What a record supplies goes through `esc`, and so does the fixed text (./text.ts), which is
 * plain words.
 */
import { esc } from "../report/html.js";
import { SITE_SCRIPT } from "./client.js";
import type { SiteContent } from "./render.js";
import { SITE_CSS } from "./style.js";
import { SITE_TEXT } from "./text.js";

/** The pages of the website: its own, the trust page, What's New, and Technical details. */
export type SitePage = "index" | "trust" | "whats-new" | "technical";

/** The website's own page, as the other pages link to it: beside them. */
const INDEX_HREF = "index.html";

/** The trust page, as the website's own page links to it: beside it. */
const TRUST_HREF = "trust.html";

/**
 * Whether the website's own page lists every report by date: only when two sites or more have
 * reports. With one, the list would be that site's own again. The page has the view, and the bar of
 * either page a link to it, only then.
 */
export function listsByDate(content: SiteContent): boolean {
  return content.sites.length > 1;
}

/**
 * The bar of the page `current`: a link to each view of the website's own page that's there (the
 * demo's, the sites', and, when `listsByDate` says so, every report by date), then the link to the
 * trust page, and the theme button. The views are on the website's own page, so on any other page
 * each view's link goes to its place there (`index.html#sites`) and not to a place on the page the
 * reader is on. On the trust page, the link to it is the page the reader is on, and says so
 * (`aria-current="page"`): the page's style (see ./style.ts) draws it by more than its color. The
 * bar has no link to What's New or to Technical details, so on either no link is the page the
 * reader is on.
 */
export function siteBar(content: SiteContent, current: SitePage): string {
  const { views } = SITE_TEXT;
  const links = [
    ...(content.demo === null ? [] : [{ id: "demo", title: views.demo.title }]),
    { id: "sites", title: views.sites.title },
    ...(listsByDate(content) ? [{ id: "by-date", title: views.byDate.title }] : []),
  ];
  const onTrustPage = current === "trust";
  // The views are on the website's own page, so from every other page each link names that page.
  const viewsAt = current === "index" ? "" : INDEX_HREF;
  return [
    '<header class="bar">',
    `<nav aria-label="${esc(SITE_TEXT.nav)}">`,
    ...links.map(({ id, title }) => `<a href="${viewsAt}#${esc(id)}">${esc(title)}</a>`),
    `<a href="${TRUST_HREF}"${onTrustPage ? ' aria-current="page"' : ""}>${esc(SITE_TEXT.trust)}</a>`,
    "</nav>",
    `<button class="theme" id="theme-toggle" type="button" hidden>${esc(SITE_TEXT.theme.light)}</button>`,
    "</header>",
  ].join("\n");
}

/** The footer: what voicecap is, and the link to it. */
export function siteFooter(): string {
  return [
    "<footer>",
    `<p>${esc(SITE_TEXT.about)}</p>`,
    `<p>${esc(SITE_TEXT.madeWith)} <a href="${esc(SITE_TEXT.github)}">${esc(SITE_TEXT.madeWithLink)}</a></p>`,
    "</footer>",
  ].join("\n");
}

/**
 * A page of the website, from the parts only it has: its `title`, which is plain text and is escaped
 * here; its `bar` (siteBar); and the lines of its `main` part, which go in `<main id="main">`. The
 * bar and the main part are HTML already, with whatever a record or a fact supplies through `esc`.
 * The page's one style block is SITE_CSS, which embeds no font. Pure.
 */
export function sitePage(parts: { title: string; bar: string; main: string[] }): string {
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
    parts.bar,
    '<main id="main">',
    ...parts.main,
    "</main>",
    siteFooter(),
    `<script>${SITE_SCRIPT}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
