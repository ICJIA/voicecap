/**
 * The website's own page, `index.html`, as a pure function of what's published: every report voicecap
 * has shared, by site and by date, with the demo's. It's in the shareable page's design (see
 * ../share/html/document.ts): one self-contained file, dark by default with a switch to light, with
 * one style block (the fonts, then SITE_CSS) and one script (SITE_SCRIPT), and nothing loaded from
 * outside it. The page sets no `style` attribute, since a Content Security Policy that hashes its
 * style block and its script allows nothing else.
 *
 * In order: the head; a skip link to the main content; the bar, whose links go to the views and
 * which holds the theme button; `main`, with the page's heading and lead, the three views (the
 * demo's, the sites', and every report by date), and what to know about a file's fingerprint and a
 * walkthrough file; the footer; and last, the script. What the model or a record supplies goes
 * through `esc`, and so does the fixed text (./text.ts), which is plain words.
 *
 * The page is a page about accessibility, so it follows the report's rules: headings in order (the
 * page, then each view, then each site, then each report), landmarks, a skip link, visible keyboard
 * focus, and complete without JavaScript.
 */
import { esc } from "../report/html.js";
import { sizeWords } from "../share/format.js";
import { SITE_SCRIPT } from "./client.js";
import { SITE_CSS } from "./style.js";
import { SITE_TEXT, type Sentence } from "./text.js";

/** A file the site publishes. */
export interface PublishedFile {
  kind: "page" | "word" | "walkthrough" | "other";
  name: string;
  /** Its address from the site's top: "dvfr.illinois.gov/dvfr.illinois.gov_2026-10-03.html". */
  href: string;
  bytes: number;
  sha256: string;
  /** The run a walkthrough file is of; null for any other file. */
  run: string | null;
}

/** One share, as the site shows it. */
export interface PublishedReport {
  /** Its site's folder on the site; "demo" for the demo's. */
  folder: string;
  /** Its anchor: "report-<folder>-<seq>", or "report-demo". */
  id: string;
  at: string;
  by: string;
  files: PublishedFile[];
  /** Each file the record names that isn't published: changed since it was shared, or missing. */
  notPublished: { name: string; reason: "changed" | "missing" }[];
}

/** Everything the page shows. */
export interface SiteContent {
  demo: PublishedReport | null;
  /** By folder name; each site's reports the newest first. */
  sites: { folder: string; reports: PublishedReport[] }[];
}

/**
 * A file's kind, by its extension: `.html` is the page, `.docx` the Word copy, `.json` a walkthrough
 * file, and anything else other.
 */
export function fileKind(name: string): PublishedFile["kind"] {
  if (name.endsWith(".html")) return "page";
  if (name.endsWith(".docx")) return "word";
  if (name.endsWith(".json")) return "walkthrough";
  return "other";
}

/** The id of the heading that names a section, from the section's own id. */
const headingId = (id: string): string => `heading-${id}`;

/**
 * What each of the page's lists says it is. WebKit takes the semantics of a list from one whose
 * markers are removed (`list-style: none`), and a screen reader there (VoiceOver) then doesn't
 * announce it as a list. The role keeps it one.
 */
const IS_A_LIST = ' role="list"';

/** A sentence as HTML: each piece escaped, and each command in the fixed-width font. */
function sentenceHtml(sentence: Sentence): string {
  return sentence
    .map((piece) => (typeof piece === "string" ? esc(piece) : `<code>${esc(piece.code)}</code>`))
    .join("");
}

/** A section named by its heading, whose level is `level`; `inside` is HTML, already escaped. */
function section(
  className: string,
  id: string,
  level: 2 | 3,
  title: string,
  inside: string[],
): string {
  return [
    `<section class="${esc(className)}" id="${esc(id)}" aria-labelledby="${esc(headingId(id))}">`,
    `<h${level} id="${esc(headingId(id))}">${esc(title)}</h${level}>`,
    ...inside,
    "</section>",
  ].join("\n");
}

/** What a file is: its label, a link named by its name, its size, and its fingerprint. */
function fileItem(file: PublishedFile): string {
  const label =
    file.kind === "walkthrough"
      ? SITE_TEXT.files.walkthrough(file.run)
      : SITE_TEXT.files[file.kind];
  // The page opens in the browser. Every other file is a download.
  const download = file.kind === "page" ? "" : " download";
  return [
    `<li><span class="kind">${esc(label)}</span>`,
    `<a href="${esc(file.href)}"${download}>${esc(file.name)}</a>`,
    `<span class="meta">${esc(sizeWords(file.bytes))}, ${esc(SITE_TEXT.sha256)} <code>${esc(file.sha256)}</code></span></li>`,
  ].join(" ");
}

/**
 * A report: when it was shared, who prepared it, its files, what the record names that isn't
 * here, and, when it has no walkthrough file, that none was shared. A walkthrough file the record
 * names that isn't here is not "none shared": its own line says it isn't here. `level` is the
 * report's heading's.
 */
function report(shared: PublishedReport, level: 3 | 4): string {
  const { files, notPublished } = shared;
  const hadWalkthrough =
    files.some(({ kind }) => kind === "walkthrough") ||
    notPublished.some(({ name }) => fileKind(name) === "walkthrough");
  return [
    `<article class="report" id="${esc(shared.id)}">`,
    `<h${level}>${esc(SITE_TEXT.reportLine(shared.at))}</h${level}>`,
    `<p>${esc(SITE_TEXT.preparedBy(shared.by))}</p>`,
    // No list with nothing in it: a screen reader would announce it.
    ...(files.length === 0
      ? []
      : [`<ul class="files"${IS_A_LIST}>`, ...files.map(fileItem), "</ul>"]),
    ...notPublished.map(
      ({ name, reason }) => `<p class="gone">${esc(SITE_TEXT.gone[reason](name))}</p>`,
    ),
    ...(hadWalkthrough ? [] : [`<p class="quiet">${esc(SITE_TEXT.noWalkthrough)}</p>`]),
    "</article>",
  ].join("\n");
}

/** The demo's view: its one report, whose heading is one level below the view's. */
function demoView(demo: PublishedReport): string {
  const { title, lead } = SITE_TEXT.views.demo;
  return section("view", "demo", 2, title, [`<p>${esc(lead)}</p>`, report(demo, 3)]);
}

/** One site: its folder, how many reports it has, and its reports as they were given. */
function site({ folder, reports }: SiteContent["sites"][number]): string {
  return section("site", `site-${folder}`, 3, folder, [
    `<p class="count">${esc(SITE_TEXT.reports(reports.length))}</p>`,
    ...reports.map((each) => report(each, 4)),
  ]);
}

/** The sites' view: each site, or, with none, that no report has been shared. */
function sitesView(sites: SiteContent["sites"]): string {
  const { title, lead } = SITE_TEXT.views.sites;
  const inside =
    sites.length === 0
      ? [`<p>${esc(SITE_TEXT.noReports)}</p>`]
      : [`<p>${esc(lead)}</p>`, ...sites.map(site)];
  return section("view", "sites", 2, title, inside);
}

/**
 * The view of every report, across the sites (the demo isn't a site's), newest first by the moment
 * each names. Reports of the same moment stay in the order they were given. Each item has its time,
 * its site, who prepared it, and a link to its page, or says the page isn't here.
 */
function byDateView(sites: SiteContent["sites"]): string {
  const { title, lead } = SITE_TEXT.views.byDate;
  const reports = sites
    .flatMap((each) => each.reports)
    .map((each, index) => ({ each, index, moment: Date.parse(each.at) }))
    .sort((a, b) => b.moment - a.moment || a.index - b.index);
  const item = ({ each }: (typeof reports)[number]): string => {
    const page = each.files.find(({ kind }) => kind === "page");
    const where =
      page === undefined
        ? esc(SITE_TEXT.pageGone)
        : `<a href="${esc(page.href)}">${esc(page.name)}</a>`;
    return `<li><time datetime="${esc(each.at)}">${esc(SITE_TEXT.reportLine(each.at))}</time>, ${esc(each.folder)}, ${esc(SITE_TEXT.listedBy(each.by))}: ${where}</li>`;
  };
  const inside =
    reports.length === 0
      ? [`<p>${esc(SITE_TEXT.noReports)}</p>`]
      : [`<p>${esc(lead)}</p>`, `<ol class="dates"${IS_A_LIST}>`, ...reports.map(item), "</ol>"];
  return section("view", "by-date", 2, title, inside);
}

/** The bar: a link to each view that's there, and the theme button, hidden until the script shows it. */
function bar(content: SiteContent): string {
  const { views } = SITE_TEXT;
  const links = [
    ...(content.demo === null ? [] : [{ id: "demo", title: views.demo.title }]),
    { id: "sites", title: views.sites.title },
    { id: "by-date", title: views.byDate.title },
  ];
  return [
    '<header class="bar">',
    `<nav aria-label="${esc(SITE_TEXT.nav)}">`,
    ...links.map(({ id, title }) => `<a href="#${esc(id)}">${esc(title)}</a>`),
    "</nav>",
    `<button class="theme" id="theme-toggle" type="button" hidden>${esc(SITE_TEXT.theme.light)}</button>`,
    "</header>",
  ].join("\n");
}

/** The footer: what voicecap is, and the link to it. */
function footer(): string {
  return [
    "<footer>",
    `<p>${esc(SITE_TEXT.about)}</p>`,
    `<p>${esc(SITE_TEXT.madeWith)} <a href="${esc(SITE_TEXT.github)}">${esc(SITE_TEXT.madeWithLink)}</a></p>`,
    "</footer>",
  ].join("\n");
}

/**
 * The page, from what's published. `fontCss` is the fonts' `@font-face` rules (fontFaceCss in
 * ../share/fonts.ts), which the page's style block holds ahead of its own styles. Pure.
 */
export function renderSiteIndex(content: SiteContent, assets: { fontCss: string }): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow, noarchive">',
    `<title>${esc(SITE_TEXT.title)}</title>`,
    `<style>\n${assets.fontCss}\n${SITE_CSS}</style>`,
    "</head>",
    "<body>",
    `<a class="skip" href="#main">${esc(SITE_TEXT.skip)}</a>`,
    bar(content),
    '<main id="main">',
    `<h1>${esc(SITE_TEXT.title)}</h1>`,
    `<p class="lead">${esc(SITE_TEXT.lead)}</p>`,
    ...(content.demo === null ? [] : [demoView(content.demo)]),
    sitesView(content.sites),
    byDateView(content.sites),
    `<p class="note">${sentenceHtml(SITE_TEXT.fingerprint)}</p>`,
    `<p class="note">${sentenceHtml(SITE_TEXT.walkthrough)}</p>`,
    "</main>",
    footer(),
    `<script>${SITE_SCRIPT}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
