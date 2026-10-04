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
import { folderSafe } from "../run/paths.js";
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
  /**
   * The site folder its files are published in, on the site; "demo" for the demo's. It isn't the
   * name the page shows of its site, which can be another (see `SiteContent`).
   */
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
  /**
   * By name. A site's name is the canonical name its newest share records (see the build in
   * ./build.ts), or else its folder's name; the site folders that have one name are one site, with
   * `folders` their names, and `reports` those of all of them, the newest first.
   */
  sites: { name: string; folders: string[]; reports: PublishedReport[] }[];
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

/** The id of the heading that names a view's section, from the section's own id. */
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

/**
 * One of the three views: a section named by its heading, an h2, which makes it a region, one of
 * the page's landmarks. `inside` is HTML, already escaped.
 */
function view(id: string, title: string, inside: string[]): string {
  return [
    `<section class="view" id="${esc(id)}" aria-labelledby="${esc(headingId(id))}">`,
    `<h2 id="${esc(headingId(id))}">${esc(title)}</h2>`,
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
  return view("demo", title, [`<p>${esc(lead)}</p>`, report(demo, 3)]);
}

/**
 * `id`, or, when `taken` holds it, `id` with "-2" added, then "-3", and so on, until it's one `taken`
 * doesn't hold. The id that's given is added to `taken`.
 */
function uniqueId(id: string, taken: Set<string>): string {
  let unique = id;
  for (let count = 2; taken.has(unique); count++) unique = `${id}-${count}`;
  taken.add(unique);
  return unique;
}

/**
 * One site: its name, how many reports it has, and its reports as they were given, which may be in
 * more than one folder. Its section has no name. A named section is a region, one more landmark, and
 * with many sites that is a long list of them; the site's heading, an h3, already leads to it. `id`
 * is the section's.
 */
function site({ name, reports }: SiteContent["sites"][number], id: string): string {
  return [
    `<section class="site" id="${esc(id)}">`,
    `<h3>${esc(name)}</h3>`,
    `<p class="count">${esc(SITE_TEXT.reports(reports.length))}</p>`,
    ...reports.map((each) => report(each, 4)),
    "</section>",
  ].join("\n");
}

/**
 * The sites' view: each site, or, with none, that no report has been shared. A site's section has an
 * id made from its name, written as a folder's name is (see folderSafe): "site-example.gov_8080" for
 * "example.gov:8080". Two names can be the same once written so, so a later site's id has "-2" added,
 * then "-3", and the page gives each id once.
 */
function sitesView(sites: SiteContent["sites"]): string {
  const { title, lead } = SITE_TEXT.views.sites;
  const taken = new Set<string>();
  const inside =
    sites.length === 0
      ? [`<p>${esc(SITE_TEXT.noReports)}</p>`]
      : [
          `<p>${esc(lead)}</p>`,
          ...sites.map((each) => site(each, uniqueId(`site-${folderSafe(each.name)}`, taken))),
        ];
  return view("sites", title, inside);
}

/**
 * The view of every report, across the sites (the demo isn't a site's), newest first by the moment
 * each names. Reports of the same moment stay in the order they were given. Each item has its time,
 * its site's name, who prepared it, and a link to its page, or says the page isn't here.
 */
function byDateView(sites: SiteContent["sites"]): string {
  const { title, lead } = SITE_TEXT.views.byDate;
  const reports = sites
    .flatMap(({ name, reports: own }) => own.map((each) => ({ each, name })))
    .map((made, index) => ({ ...made, index, moment: Date.parse(made.each.at) }))
    .sort((a, b) => b.moment - a.moment || a.index - b.index);
  const item = ({ each, name }: (typeof reports)[number]): string => {
    const page = each.files.find(({ kind }) => kind === "page");
    const where =
      page === undefined
        ? esc(SITE_TEXT.pageGone)
        : `<a href="${esc(page.href)}">${esc(page.name)}</a>`;
    return `<li><time datetime="${esc(each.at)}">${esc(SITE_TEXT.reportLine(each.at))}</time>, ${esc(name)}, ${esc(SITE_TEXT.listedBy(each.by))}: ${where}</li>`;
  };
  const inside =
    reports.length === 0
      ? [`<p>${esc(SITE_TEXT.noReports)}</p>`]
      : [`<p>${esc(lead)}</p>`, `<ol class="dates"${IS_A_LIST}>`, ...reports.map(item), "</ol>"];
  return view("by-date", title, inside);
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
