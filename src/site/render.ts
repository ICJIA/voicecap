/**
 * The website's own page, `index.html`, as a pure function of what's published: every report voicecap
 * has shared, by site and by date, with the demo's. It's in the look of the audit tool,
 * audit.icjia.app (see ./style.ts): one self-contained file, dark by default with a switch to light,
 * with one style block (SITE_CSS) and one script (SITE_SCRIPT), and nothing loaded from outside it,
 * not even a font. The page sets no `style` attribute, since a Content Security Policy that hashes
 * its style block and its script allows nothing else.
 *
 * The head, the skip link, the bar, the footer, and the script are the website's frame (./frame.ts),
 * which its other page, the trust page, has too; this module draws what is between the bar and the
 * footer. In order: the head; a skip link to the main content; the bar, whose links go to the views
 * and, last, to the trust page, and which holds the theme button; `main`, with the page's heading
 * and lead, the views (the demo's, the sites', and, when two sites or more have reports, every
 * report by date), and what to know about a file's fingerprint and a walkthrough file; the footer;
 * and last, the script. What the model or a record supplies goes through `esc`, and so does the
 * fixed text (./text.ts), which is plain words.
 *
 * A site leads with what a reader came for: its name, with a link to the site itself, then its
 * current report, with its verdict as a pill, a bar of the pages NVDA read, and links to open its
 * page and to download its Word copy. Its earlier reports are a line each under it, and every
 * report's files, with their sizes and fingerprints, are in a fold, closed, for whoever checks a
 * copy. Each view's heading and each site's name has a picture before it, and the views of the
 * sites and of every report by date say beside their headings how many they hold (from 0.13.1).
 *
 * The page is a page about accessibility, so it follows the report's rules: headings in order (the
 * page, then each view, then each site, then each report), landmarks, a skip link, visible keyboard
 * focus, and complete without JavaScript.
 */
import type { ShareResult } from "../model.js";
import { canonicalName, recordedCanonical } from "../pages/canonical.js";
import { esc } from "../report/html.js";
import { folderSafe } from "../run/paths.js";
import { count as countWords, sizeWords } from "../share/format.js";
import { track } from "../share/html/parts.js";
import { verdictOf } from "../share/verdict.js";
import { listsByDate, siteBar, sitePage } from "./frame.js";
import { SITE_ICONS } from "./icons.js";
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
  /**
   * What its copies say of the site, as its share recorded it (from 0.12.3): the card of a site's
   * current report says it. None for a share from before.
   */
  result?: ShareResult;
}

/** Everything the page shows. */
export interface SiteContent {
  demo: PublishedReport | null;
  /**
   * By name. A site's name is the canonical name its newest share records (see the build in
   * ./build.ts), or else its folder's name; the site folders that have one name are one site, with
   * `folders` their names, and `reports` those of all of them, the newest first. `address` is where
   * people visit it (from 0.13.1): the root that gives it its name. None for a site its folder names.
   */
  sites: { name: string; folders: string[]; reports: PublishedReport[]; address?: string }[];
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

/**
 * A sentence as HTML: each piece escaped, each command in the fixed-width font, and each link made
 * from its words and where it goes.
 */
function sentenceHtml(sentence: Sentence): string {
  return sentence
    .map((piece) => {
      if (typeof piece === "string") return esc(piece);
      if ("code" in piece) return `<code>${esc(piece.code)}</code>`;
      return `<a href="${esc(piece.href)}">${esc(piece.link)}</a>`;
    })
    .join("");
}

/**
 * One of the three views: a section named by its heading, an h2, which makes it a region, one of
 * the page's landmarks. Its head is a banner: a title row, the heading with its picture before it
 * (`icon`, which a screen reader skips), which stay on one line together; and, beside them, how
 * many the view holds (`count`), when it says, as a big number with its word after it ("2 sites").
 * The count isn't in the heading, which keeps its own words: a screen reader reads it after.
 * `inside` is HTML, already escaped.
 */
function view(
  id: string,
  title: string,
  icon: string,
  inside: string[],
  count?: { n: number; unit: string },
): string {
  const beside =
    count === undefined
      ? ""
      : `<span class="count"><b>${esc(countWords(count.n))}</b> ${esc(count.unit)}</span>`;
  return [
    `<section class="view" id="${esc(id)}" aria-labelledby="${esc(headingId(id))}">`,
    `<div class="view-head"><div class="title">${icon}<h2 id="${esc(headingId(id))}">${esc(title)}</h2></div>${beside}</div>`,
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

/** Words that only a screen reader gets, as HTML: the page hides them from view (`.sr`). */
function hidden(text: string): string {
  return `<span class="sr">${esc(text)}</span>`;
}

/** What sets two links of a line apart: a dot that a reader sees, and a screen reader doesn't read. */
const SEPARATOR = '<span class="sep" aria-hidden="true">·</span>';

/** A report's line, as a `time` that holds the moment it names. */
function timeOf(at: string): string {
  return `<time datetime="${esc(at)}">${esc(SITE_TEXT.reportLine(at))}</time>`;
}

/**
 * What a report's copies say of the site, as two lines of its card. The first is the verdict's
 * headline, as a pill. Its kind is its class: `ok` when nothing needs attention, `warn` when
 * something does, and `bad` when NVDA didn't read every page. The page's style draws a sign before
 * it that only repeats the words (✓, ⚠, and ⚠ in red), as decoration a screen reader doesn't read
 * (see ./style.ts). The second is how many pages NVDA read: a bar as long as their share of the
 * pages, in the verdict's color, which a screen reader skips (the shareable page's `track`), with
 * the words beside it. Nothing for a report that records no result (one shared before 0.12.3), or
 * one of no page.
 */
function verdict(result: ShareResult | undefined): string[] {
  if (result === undefined || result.pages === 0) return [];
  const { kind, headline } = verdictOf(result);
  return [
    `<p class="verdict ${kind}">${esc(headline)}</p>`,
    `<div class="reading">${track(result.read, result.pages, kind)}<p>${esc(SITE_TEXT.reading(result))}</p></div>`,
  ];
}

/** A report's page, or its Word copy, when it's published. */
function fileOf(shared: PublishedReport, kind: "page" | "word"): PublishedFile | undefined {
  return shared.files.find((file) => file.kind === kind);
}

/**
 * A site's current report: a heading that says it's the current one, with its line; who prepared
 * it; and the two links a reader wants, to open its page and to download its Word copy. A screen
 * reader hears the site's name, `name`, and the report's line after each link's words, so that no
 * two links on the page read alike. Of the two files, one that isn't published has its line in
 * place of its link. What else the record names that isn't here is said in the fold (see
 * filesFold). `level` is the heading's.
 */
function currentReport(shared: PublishedReport, level: 3 | 4, name: string): string {
  const page = fileOf(shared, "page");
  const word = fileOf(shared, "word");
  const of = hidden(SITE_TEXT.of(name, shared.at));
  const links = [
    ...(page === undefined
      ? []
      : [`<a class="action" href="${esc(page.href)}">${esc(SITE_TEXT.open)}${of}</a>`]),
    ...(word === undefined
      ? []
      : [
          `<a class="action" href="${esc(word.href)}" download>${esc(SITE_TEXT.download)}${of}</a>`,
        ]),
  ];
  const gone = shared.notPublished.filter(({ name: file }) => {
    const kind = fileKind(file);
    return kind === "page" || kind === "word";
  });
  return [
    `<article class="report" id="${esc(shared.id)}">`,
    `<h${level}><span class="label">${esc(SITE_TEXT.current)}</span> ${timeOf(shared.at)}</h${level}>`,
    // What a manager asks first: did it pass?
    ...verdict(shared.result),
    `<p class="by">${esc(SITE_TEXT.preparedBy(shared.by))}</p>`,
    // No paragraph with no link in it.
    ...(links.length === 0 ? [] : [`<p class="actions">${links.join(" ")}</p>`]),
    ...gone.map(
      ({ name: file, reason }) => `<p class="gone">${esc(SITE_TEXT.gone[reason](file))}</p>`,
    ),
    "</article>",
  ].join("\n");
}

/**
 * A site's reports before its current one, under a heading of their own, a line each: when it was
 * shared, who prepared it, and its links, to its page and to its Word copy, as the current report's
 * are. A page that isn't published is said so in its link's place, and a Word copy that isn't is
 * left out: the fold says why. Beside the heading is how many there are, for the eye alone: their
 * list says it to a screen reader, and a bare number after the heading would say nothing more.
 * Nothing, when there are none.
 */
function earlierReports(reports: readonly PublishedReport[], name: string): string[] {
  if (reports.length === 0) return [];
  const item = (shared: PublishedReport): string => {
    const page = fileOf(shared, "page");
    const word = fileOf(shared, "word");
    const of = hidden(SITE_TEXT.of(name, shared.at));
    const links = [
      page === undefined
        ? esc(SITE_TEXT.pageGone)
        : `<a href="${esc(page.href)}">${esc(SITE_TEXT.open)}${of}</a>`,
      ...(word === undefined
        ? []
        : [`<a href="${esc(word.href)}" download>${esc(SITE_TEXT.word)}${of}</a>`]),
    ];
    return `<li id="${esc(shared.id)}">${timeOf(shared.at)}, ${esc(SITE_TEXT.listedBy(shared.by))}: ${links.join(` ${SEPARATOR} `)}</li>`;
  };
  return [
    `<div class="sub-head"><h4>${esc(SITE_TEXT.earlier)}</h4><span class="count" aria-hidden="true">${reports.length}</span></div>`,
    `<ul class="earlier"${IS_A_LIST}>`,
    ...reports.map(item),
    "</ul>",
  ];
}

/**
 * The fold of every report's files, closed until a reader opens it: what a reviewer or an auditor
 * checks a copy against. For each report, the newest first: when it was shared and who prepared it;
 * its files, each with its label, its size, and its fingerprint; what the record names that isn't
 * here; and, when it has no walkthrough file, that none was shared. A walkthrough file the record
 * names that isn't here is not "none shared": its own line says it isn't here. The fold is
 * complete without JavaScript, as `details` is.
 */
function filesFold(reports: readonly PublishedReport[]): string {
  const block = ({ at, by, files, notPublished }: PublishedReport): string => {
    const hadWalkthrough =
      files.some(({ kind }) => kind === "walkthrough") ||
      notPublished.some(({ name }) => fileKind(name) === "walkthrough");
    return [
      '<div class="shared">',
      `<p class="when">${timeOf(at)}, ${esc(SITE_TEXT.listedBy(by))}</p>`,
      // No list with nothing in it: a screen reader would announce it.
      ...(files.length === 0
        ? []
        : [`<ul class="files"${IS_A_LIST}>`, ...files.map(fileItem), "</ul>"]),
      ...notPublished.map(
        ({ name, reason }) => `<p class="gone">${esc(SITE_TEXT.gone[reason](name))}</p>`,
      ),
      ...(hadWalkthrough ? [] : [`<p class="quiet">${esc(SITE_TEXT.noWalkthrough)}</p>`]),
      "</div>",
    ].join("\n");
  };
  return [
    '<details class="fold">',
    `<summary>${esc(SITE_TEXT.fold)}</summary>`,
    '<div class="inside">',
    ...reports.map(block),
    "</div>",
    "</details>",
  ].join("\n");
}

/**
 * The demo's view: its lead, which links to the demo's own pages in demo-site/ (see ./build.ts), its
 * one report as the current one, whose heading is one level below the view's, and the fold of its
 * files.
 */
function demoView(demo: PublishedReport): string {
  const { title, lead } = SITE_TEXT.views.demo;
  return view("demo", title, SITE_ICONS.demo, [
    `<p>${sentenceHtml(lead)}</p>`,
    currentReport(demo, 3, SITE_TEXT.demoName),
    filesFold([demo]),
  ]);
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
 * The link to a site itself, beside its name: its words, then the site's name, which only a screen
 * reader hears, and an arrow, which it doesn't. Only to the root of a site people visit, as a share
 * records one (see recordedCanonical), at the host the heading names: never an address on
 * someone's computer, one with a name and password in it, anything that isn't a web address, or
 * another site than the one its heading names. It opens the site in a new tab, so a reader can go
 * back and forth between the report and the site, and its hidden words say so. `noopener` gives
 * the site no hold on this page, and `noreferrer`, as the site's Referrer-Policy does (see
 * ./netlify.ts), keeps the page's own address from it. Nothing, for a site with no such address.
 */
function visit(name: string, address: string | undefined): string {
  if (address === undefined || recordedCanonical(address) !== address) return "";
  if (canonicalName(address) !== name) return "";
  return `<a class="visit" href="${esc(address)}" target="_blank" rel="noopener noreferrer">${esc(SITE_TEXT.visit)}${hidden(SITE_TEXT.visitAt(name))}${SITE_ICONS.visit}</a>`;
}

/**
 * One site: its name, after its picture, with the link to the site itself beside it when there's an
 * address people visit; the first of its reports as they were given, which is its current report;
 * the others, its earlier reports, a line each; and the fold of every report's files. Its reports
 * may be in more than one folder. The build gives a site's newest reports only, the newest first
 * (see KEPT_PER_SITE in ./build.ts): here, every report given is shown. Its section has no name. A
 * named section is a region, one more landmark, and with many sites that is a long list of them;
 * the site's heading, an h3, already leads to it. `id` is the section's.
 */
function site({ name, reports, address }: SiteContent["sites"][number], id: string): string {
  const [current, ...earlier] = reports;
  return [
    `<section class="site" id="${esc(id)}">`,
    `<div class="site-head"><div class="title">${SITE_ICONS.site}<h3>${esc(name)}</h3></div>${visit(name, address)}</div>`,
    ...(current === undefined ? [] : [currentReport(current, 4, name)]),
    ...earlierReports(earlier, name),
    ...(reports.length === 0 ? [] : [filesFold(reports)]),
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
  if (sites.length === 0) {
    return view("sites", title, SITE_ICONS.sites, [`<p>${esc(SITE_TEXT.noReports)}</p>`]);
  }
  return view(
    "sites",
    title,
    SITE_ICONS.sites,
    [
      `<p>${esc(lead)}</p>`,
      ...sites.map((each) => site(each, uniqueId(`site-${folderSafe(each.name)}`, taken))),
    ],
    { n: sites.length, unit: SITE_TEXT.siteUnit(sites.length) },
  );
}

/**
 * The view of every report, across the sites (the demo isn't a site's), newest first by the moment
 * each names. Reports of the same moment stay in the order they were given. Each item has its time,
 * its site's name, who prepared it, and a link to its page, or says the page isn't here. It's on the
 * page only when two sites or more have reports (see listsByDate in ./frame.ts, which the bar's link
 * to it follows too).
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
    return `<li>${timeOf(each.at)}, ${esc(name)}, ${esc(SITE_TEXT.listedBy(each.by))}: ${where}</li>`;
  };
  return view(
    "by-date",
    title,
    SITE_ICONS.byDate,
    [`<p>${esc(lead)}</p>`, `<ol class="dates"${IS_A_LIST}>`, ...reports.map(item), "</ol>"],
    { n: reports.length, unit: SITE_TEXT.reportUnit(reports.length) },
  );
}

/**
 * The page, from what's published: its main part, in the website's frame (sitePage in ./frame.ts)
 * with the bar of its own page. Pure.
 */
export function renderSiteIndex(content: SiteContent): string {
  return sitePage({
    title: SITE_TEXT.title,
    bar: siteBar(content, "index"),
    main: [
      `<h1>${esc(SITE_TEXT.title)}</h1>`,
      `<p class="lead">${esc(SITE_TEXT.lead)}</p>`,
      ...(content.demo === null ? [] : [demoView(content.demo)]),
      sitesView(content.sites),
      ...(listsByDate(content) ? [byDateView(content.sites)] : []),
      `<p class="note">${sentenceHtml(SITE_TEXT.fingerprint)}</p>`,
      `<p class="note">${sentenceHtml(SITE_TEXT.walkthrough)}</p>`,
    ],
  });
}
