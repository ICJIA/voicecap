/**
 * The website's own page, `index.html`, as a pure function of what's published: every report voicecap
 * has shared, by site and by date, with the demo's. It's in the look of the audit tool,
 * audit.icjia.app (see ./style.ts): one self-contained file, dark by default with a switch to light,
 * with one style block (SITE_CSS) and one script (SITE_SCRIPT), and nothing loaded from outside it,
 * not even a font. The page sets no `style` attribute, since a Content Security Policy that hashes
 * its style block and its script allows nothing else.
 *
 * The head, the skip link, the two bars, and the script are the website's frame (./frame.ts), which
 * its other pages, the trust page, What's New, and Technical details, have too; this module draws
 * what is between the bars. In order: the head; a skip link to the main content; the top bar, whose
 * name is this page; `main`, which opens with the banner of the newest release ("What's new", when
 * the CHANGELOG records one), as the audit tool's front page opens with its own, above the page's
 * heading; then the kicker, as the audit tool's trust page heads itself ("ICJIA · Built for Title II
 * of the ADA · WCAG · Illinois IITAA", the law's three names marked), the page's heading and lead,
 * "On this page", a row of links to the views that are there, the views (the demo's, the sites',
 * and, when two sites or more have reports, every report by date), and what to know about a file's
 * fingerprint and a walkthrough file; the bottom bar, which says the version of voicecap that built
 * the page; and last, the script. What the model, a record, or the CHANGELOG supplies goes through
 * `esc`, and so does the fixed text (./text.ts), which is plain words.
 *
 * A site leads with what a reader came for: its name, with a link to the site itself, then its
 * current report, with its verdict as a pill, a bar of the pages NVDA read, and links to open its
 * page and to download its Word copy; and, when its share has the report for AI tools, as Markdown
 * and as JSON, a line under them that links both. Its earlier reports are a line each under it, and
 * every report's files, with their sizes and fingerprints, are in a fold, closed, for whoever
 * checks a copy: a share's voice page (from 0.18.0), which plays NVDA's recordings, is one of them,
 * listed as NVDA's voice, and is no part of a report's card or line, which are of its page, its
 * Word copy, and, on the card, its report for AI tools. Each view's heading and each site's name
 * has a picture before it, and the views of the sites and of every report by date say beside their
 * headings how many they hold (from 0.13.1).
 *
 * llms.txt (`renderLlmsTxt`) and sites.json (`renderSitesJson`) are the website's other files of
 * this kind, at its top: llms.txt is plain text, for AI tools, that points to each site's current
 * report as Markdown and as JSON, and sites.json lists each site and its current report as JSON, for
 * another website that links to the results.
 *
 * The page is a page about accessibility, so it follows the report's rules: headings in order (the
 * page, then each view, then each site, then each report), landmarks, a skip link, visible keyboard
 * focus, and complete without JavaScript. The banner above the heading has no heading of its own
 * and is no landmark, so the page's outline is as it is without it: its first heading is the h1.
 */
import type { ShareResult } from "../model.js";
import { canonicalName, recordedCanonical } from "../pages/canonical.js";
import { esc } from "../report/html.js";
import { folderSafe } from "../run/paths.js";
import { markdownInline } from "../share/ai/escape.js";
import { count as countWords, longDate, sizeWords } from "../share/format.js";
import { track } from "../share/html/parts.js";
import { verdictOf, type VerdictKind } from "../share/verdict.js";
import type { VoicecapFacts, VoicecapRelease } from "./facts.js";
import { sitePage, TECHNICAL_HREF, TRUST_HREF, WHATS_NEW_HREF } from "./frame.js";
import { SITE_ICONS } from "./icons.js";
import { printable } from "./records.js";
import { type KickerPart, SITE_TEXT, type Sentence } from "./text.js";

/** A file the site publishes. */
export interface PublishedFile {
  /**
   * What the file is: the report's page, a share's voice page (from 0.18.0, the page that plays NVDA's
   * recordings: it opens in the browser, as the page does, but is never the report's page), its Word
   * copy, its report for AI tools as Markdown (`markdown`) or as JSON (`data`), a walkthrough file,
   * or another file. See `fileKind`.
   */
  kind: "page" | "voice" | "word" | "markdown" | "data" | "walkthrough" | "other";
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
  /**
   * The runs its copies are of, as its share recorded them (see SiteEntry in ./records.ts), each
   * named by when it began: when NVDA read the site, which the card of a site's current report
   * shows, and which puts the sites in their order on the page. None given, or none recorded, says
   * nothing of when.
   */
  runs?: readonly string[];
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
 * A file's kind, by its name: `.voice.html` is a share's voice page, any other `.html` the page,
 * `.docx` the Word copy, `.md` the report for AI tools as Markdown, a name ending `_walkthrough.json`
 * a walkthrough file, any other `.json` the report as JSON (the kind "data"), and anything else
 * other. The voice page is named for its pair, the pair's name and `.voice.html` (`voicecap share`
 * writes it so), and the pair's page is named with its day or its number last, so no report's page
 * ends `.voice.html`. Only that ending, in lower case as voicecap writes it, makes a voice page: any
 * other page, which plays nothing, is the page, and has the page's policy (see rulesFor in
 * ./build.ts). The report's JSON is `<stem>.json`, named for the share alone: only a walkthrough
 * file's name, which has its run in it, ends `_walkthrough.json`, so that JSON isn't taken for one,
 * and a walkthrough file isn't taken for it.
 */
export function fileKind(name: string): PublishedFile["kind"] {
  if (name.endsWith(".voice.html")) return "voice";
  if (name.endsWith(".html")) return "page";
  if (name.endsWith(".docx")) return "word";
  if (name.endsWith(".md")) return "markdown";
  if (name.endsWith("_walkthrough.json")) return "walkthrough";
  if (name.endsWith(".json")) return "data";
  return "other";
}

/**
 * The id of the shareable page's "Every page" section, its card for each page (see
 * ../share/html/pages.ts), which a current report's "See every page" links to.
 */
const PAGES_ANCHOR = "pages";

/** The id of the heading that names a view's section, from the section's own id. */
const headingId = (id: string): string => `heading-${id}`;

/**
 * Whether the page lists every report by date: only when two sites or more have reports. With one,
 * the list would be that site's own again. The page has the view, and "On this page" a link to it,
 * only then.
 */
function listsByDate(content: SiteContent): boolean {
  return content.sites.length > 1;
}

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
  // The page opens in the browser, and so does the voice page, which is a page that plays sound.
  // Every other file's link saves it: the report for AI tools is read in the browser when its
  // address is opened, and the link's `download` saves it instead.
  const download = file.kind === "page" || file.kind === "voice" ? "" : " download";
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
 * Whether a report's result has a verdict to give: it counted pages. A report that records no result
 * (one shared before 0.12.3) says nothing, and one of no page has nothing to say. The card and
 * llms.txt both go by it.
 */
function hasVerdict(result: ShareResult | undefined): result is ShareResult {
  return result !== undefined && result.pages > 0;
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
  if (!hasVerdict(result)) return [];
  const { kind, headline } = verdictOf(result);
  return [
    `<p class="verdict ${kind}">${esc(headline)}</p>`,
    `<div class="reading">${track(result.read, result.pages, kind)}<p>${esc(SITE_TEXT.reading(result))}</p></div>`,
  ];
}

/** A report's file of this kind, its page or its Word copy, say, when it's published. */
function fileOf(shared: PublishedReport, kind: PublishedFile["kind"]): PublishedFile | undefined {
  return shared.files.find((file) => file.kind === kind);
}

/**
 * The line under a current report's buttons, when its share has the report for AI tools and the site
 * published it: "For AI tools such as Claude or ChatGPT: the report as Markdown, or as JSON", each
 * format a link that saves the file. Of the two files, one that isn't published has no link, and the
 * line is of the other alone: what isn't here is said in the fold (see filesFold). Nothing for a
 * share from before the report for AI tools, which has neither. `of` is what only a screen reader
 * hears after each link's words (the site's name and the report's line), so that no two links on
 * the page read alike, and is HTML, already escaped.
 */
function forAi(shared: PublishedReport, of: string): string[] {
  const words = SITE_TEXT.forAi;
  const links = (
    [
      ["markdown", words.markdown],
      ["data", words.json],
    ] as const
  ).flatMap(([kind, format]) => {
    const file = fileOf(shared, kind);
    return file === undefined
      ? []
      : [`<a href="${esc(file.href)}" download>${esc(format)}${of}</a>`];
  });
  if (links.length === 0) return [];
  return [`<p class="ai">${esc(words.lead)}${links.join(esc(words.or))}</p>`];
}

/**
 * When NVDA read the site for a report, from the runs its share records (see PublishedReport): the
 * newest run's start, as a local time ("2026-10-14T06:26"), the first run's, and how many runs there
 * are. A run's id begins with its local date and time (see isRunIdShape in ../run/run-id.ts). Null
 * for a report that records no run.
 */
function capturedOf(shared: PublishedReport): { at: string; first: string; runs: number } | null {
  const times = (shared.runs ?? [])
    .map((run) => `${run.slice(0, 10)}T${run.slice(11, 13)}:${run.slice(13, 15)}`)
    .sort();
  const [first] = times;
  const at = times.at(-1);
  if (first === undefined || at === undefined) return null;
  return { at, first, runs: times.length };
}

/**
 * The moment a site's sections are ordered by, newest first (see bySiteOrder): when NVDA last read
 * the site for its current report (see capturedOf), or, for a report that records no run, when it
 * was shared, as a local time to the minute, as a run's is; for a site with no report, nothing,
 * which comes last.
 */
function capturedMoment(site: SiteContent["sites"][number]): string {
  const [current] = site.reports;
  if (current === undefined) return "";
  return capturedOf(current)?.at ?? current.at.slice(0, 16);
}

/**
 * The sites in the page's order: the one NVDA read last first, by capturedMoment, and sites of the
 * same moment in the order given (by name: see ./build.ts). Each comes with the id of its section
 * (see withSectionIds), which is made in the order given, so a site's id doesn't change when another
 * site is read. The page's sections and llms.txt go by it; sites.json keeps the order given.
 */
function bySiteOrder(
  sites: SiteContent["sites"],
): [site: SiteContent["sites"][number], id: string][] {
  return withSectionIds(sites)
    .map((pair, index) => ({ pair, index, moment: capturedMoment(pair[0]) }))
    .sort((a, b) => (a.moment < b.moment ? 1 : a.moment > b.moment ? -1 : a.index - b.index))
    .map(({ pair }) => pair);
}

/**
 * The two tiles at the top of a site's current report's card, side by side where they fit (see
 * ./style.ts). The first says when NVDA read the site: its label, the day, big, in a `time`, and
 * under it the time, and how many runs the report is of, when more than one (see capturedOf); a
 * report that records no run has no first tile. The second is the report's recording: with its
 * voice page here, the tile is a link to it, whose label a screen reader doesn't hear, since the
 * link's words say it, and after whose words it hears `of`, the site's name and the report's line,
 * as after the card's other links; with none, the tile says there's no recording, and why. A
 * tile's parts are apart by a space, which its column doesn't draw, so that a screen reader, and a
 * copy of its words, has them as words apart. A
 * report that records no run and has no recording, one shared before voicecap recorded either, has
 * no tiles: there would be nothing at a glance but what it lacks.
 */
function glance(shared: PublishedReport, of: string): string[] {
  const words = SITE_TEXT.glance;
  const captured = capturedOf(shared);
  const voice = fileOf(shared, "voice");
  const voiceGone = shared.notPublished.some(({ name }) => fileKind(name) === "voice");
  if (captured === null && voice === undefined && !voiceGone) return [];
  const label = (icon: string, text: string, heard = true): string =>
    `<span class="glance-label"${heard ? "" : ' aria-hidden="true"'}>${icon}${esc(text)}</span>`;
  const tiles = [
    ...(captured === null
      ? []
      : [
          [
            '<p class="glance-tile">',
            label(SITE_ICONS.captured, words.captured),
            `<span class="glance-big"><time datetime="${esc(captured.at)}">${esc(longDate(captured.at))}</time></span>`,
            `<span class="glance-small">${esc(words.when(captured.at, captured.runs, captured.first))}</span>`,
            "</p>",
          ].join(" "),
        ]),
    voice === undefined
      ? [
          '<p class="glance-tile none">',
          label(SITE_ICONS.listen, words.listen),
          `<span class="glance-big">${esc(words.none)}</span>`,
          `<span class="glance-small">${esc(voiceGone ? words.voiceGone : words.noVoice)}</span>`,
          "</p>",
        ].join(" ")
      : [
          `<a class="glance-tile listen" href="${esc(voice.href)}">`,
          label(SITE_ICONS.listen, words.listen, false),
          // The link's words, then whose it is, for a screen reader, then what the recording is.
          `<span class="glance-big"><span aria-hidden="true">▶ </span>${esc(words.play)}</span>${of}`,
          `<span class="glance-small">${esc(words.voice)}</span>`,
          "</a>",
        ].join(" "),
  ];
  return [`<div class="glance">${tiles.join("")}</div>`];
}

/**
 * A site's current report: a heading that says it's the current one, with its line; who prepared
 * it; the links a reader wants, to open its page, to its page's "Every page" section (a card for
 * each page, with its screenshot), to its voice page when it has one, and to download its Word
 * copy; and, last, the line for AI tools, when its share has the report as Markdown and as JSON (see
 * forAi). A screen reader hears the site's name, `name`, and the report's line after each link's
 * words, so that no two links on the page read alike. Of the page and the Word copy, one that isn't
 * published has its line in place of its link. What else the record names that isn't here is said in the fold (see
 * filesFold). `level` is the heading's.
 */
function currentReport(shared: PublishedReport, level: 3 | 4, name: string): string {
  const page = fileOf(shared, "page");
  const word = fileOf(shared, "word");
  const voice = fileOf(shared, "voice");
  const of = hidden(SITE_TEXT.of(name, shared.at));
  const links = [
    ...(page === undefined
      ? []
      : [`<a class="action" href="${esc(page.href)}">${esc(SITE_TEXT.open)}${of}</a>`]),
    ...(page === undefined
      ? []
      : [
          `<a class="action" href="${esc(page.href)}#${PAGES_ANCHOR}">${esc(SITE_TEXT.everyPage)}${of}</a>`,
        ]),
    ...(voice === undefined
      ? []
      : [`<a class="action" href="${esc(voice.href)}">${esc(SITE_TEXT.audio)}${of}</a>`]),
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
    // When NVDA read the site, and its recording, at a glance.
    ...glance(shared, of),
    // What a manager asks first: did it pass?
    ...verdict(shared.result),
    `<p class="by">${esc(SITE_TEXT.preparedBy(shared.by))}</p>`,
    // No paragraph with no link in it.
    ...(links.length === 0 ? [] : [`<p class="actions">${links.join(" ")}</p>`]),
    ...gone.map(
      ({ name: file, reason }) => `<p class="gone">${esc(SITE_TEXT.gone[reason](file))}</p>`,
    ),
    // The card's last line, under the buttons and what's said of the ones that aren't here.
    ...forAi(shared, of),
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
  const root = visitable(name, address);
  if (root === null) return "";
  return `<a class="visit" href="${esc(root)}" target="_blank" rel="noopener noreferrer">${esc(SITE_TEXT.visit)}${hidden(SITE_TEXT.visitAt(name))}${SITE_ICONS.visit}</a>`;
}

/**
 * The address the page links beside a site's name (see visit), or null: only the root a share
 * records as a site's canonical address (see recordedCanonical), at the host the site's name is.
 * sites.json gives a site's address by the same rule, so it never names one the page doesn't link.
 */
function visitable(name: string, address: string | undefined): string | null {
  if (address === undefined || recordedCanonical(address) !== address) return null;
  return canonicalName(address) === name ? address : null;
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
 * Each site, in the order given, with the id of its section on the page: made from its name, written
 * as a folder's name is (see folderSafe), "site-example.gov_8080" for "example.gov:8080". Two names
 * can be the same once written so, so a later site's id has "-2" added, then "-3", and each id is
 * given once. The page's sections and sites.json's links (renderSitesJson) both take their ids from
 * here, so a link can't miss its section.
 */
function withSectionIds(
  sites: SiteContent["sites"],
): [site: SiteContent["sites"][number], id: string][] {
  const taken = new Set<string>();
  return sites.map((each) => [each, uniqueId(`site-${folderSafe(each.name)}`, taken)]);
}

/**
 * The sites' view: each site, in its section (see withSectionIds), or, with none, that no report has
 * been shared.
 */
function sitesView(sites: SiteContent["sites"]): string {
  const { title, lead } = SITE_TEXT.views.sites;
  if (sites.length === 0) {
    return view("sites", title, SITE_ICONS.sites, [`<p>${esc(SITE_TEXT.noReports)}</p>`]);
  }
  return view(
    "sites",
    title,
    SITE_ICONS.sites,
    [`<p>${esc(lead)}</p>`, ...bySiteOrder(sites).map(([each, id]) => site(each, id))],
    { n: sites.length, unit: SITE_TEXT.siteUnit(sites.length) },
  );
}

/**
 * The view of every report, across the sites (the demo isn't a site's), newest first by the moment
 * each names. Reports of the same moment stay in the order they were given. Each item has its time,
 * its site's name, who prepared it, and a link to its page, or says the page isn't here. It's on the
 * page only when two sites or more have reports (see listsByDate, which the link to it in "On this
 * page" follows too).
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
 * What sets two parts of the kicker apart: a comma for a screen reader, which a reader doesn't see
 * (`.sr`), and a dot for the eye, which a screen reader doesn't read, after a space that doesn't
 * break, so the dot ends a line rather than start one; then a space for both. A reader sees "ICJIA ·
 * Built for", and a screen reader hears "ICJIA, Built for".
 */
const KICKER_SEPARATOR = '<span class="sr">,</span><span aria-hidden="true">\u00a0·</span> ';

/** What sets the day a release came out apart from the link after it, a dot that ends a line. */
const DAY_SEPARATOR = `\u00a0${SEPARATOR} `;

/**
 * The kicker over the page's heading, from its parts (SITE_TEXT.kicker): each piece escaped, and
 * each name that matters in it marked, for the style to draw in --act.
 */
function kicker(parts: readonly KickerPart[]): string {
  const part = (pieces: KickerPart): string =>
    pieces
      .map((piece) =>
        typeof piece === "string" ? esc(piece) : `<span class="act">${esc(piece.name)}</span>`,
      )
      .join("");
  return `<p class="kicker">${parts.map(part).join(KICKER_SEPARATOR)}</p>`;
}

/**
 * The banner of the newest release, the first the facts give, which opens the page's main part,
 * above its kicker and its heading, as the audit tool's front page opens with its own: a card
 * that's no landmark and has no heading, holding "What's new", as a kicker; the release's version,
 * as a pill; its headline, when its entry has one; and the day it was released, in a `time` that
 * holds the day it names, with the link to What's New, which has every release. Its words are the
 * CHANGELOG's, escaped, so a line with markup in it is plain text here. Nothing, when the CHANGELOG
 * is missing or records no release.
 */
function news(releases: readonly VoicecapRelease[]): string[] {
  const [newest] = releases;
  if (newest === undefined) return [];
  const words = SITE_TEXT.news;
  const { version, date, headline } = newest;
  const day = `<time datetime="${esc(date)}">${esc(words.day(date))}</time>`;
  return [
    [
      '<div class="news">',
      `<p class="kicker">${esc(words.kicker)}</p>`,
      `<span class="pill good">${esc(version)}</span>`,
      // No paragraph with nothing in it.
      ...(headline === "" ? [] : [`<p class="headline">${esc(headline)}</p>`]),
      `<p class="released">${esc(words.released)} ${day}${DAY_SEPARATOR}<a href="${WHATS_NEW_HREF}">${esc(words.all)}</a></p>`,
      "</div>",
    ].join("\n"),
  ];
}

/**
 * "On this page": a navigation of the page's views that are there, the demo's, the sites', and
 * every report by date, each a link to its view by the view's heading. Its name stands before its
 * links for the eye too, hidden from a screen reader, which would otherwise hear it twice, as
 * Technical details' "On this page" is (see ./technical.ts). The views were the bar's links before
 * 0.15.0; the bar is the website's now, and the same on every page.
 */
function onThisPage(content: SiteContent): string {
  const { views } = SITE_TEXT;
  const links = [
    ...(content.demo === null ? [] : [{ id: "demo", title: views.demo.title }]),
    { id: "sites", title: views.sites.title },
    ...(listsByDate(content) ? [{ id: "by-date", title: views.byDate.title }] : []),
  ];
  const name = esc(SITE_TEXT.onThisPage);
  return [
    `<nav class="jump" aria-label="${name}">`,
    `<p class="kicker" aria-hidden="true">${name}</p>`,
    `<ul${IS_A_LIST}>`,
    ...links.map(({ id, title }) => `<li><a href="#${esc(id)}">${esc(title)}</a></li>`),
    "</ul>",
    "</nav>",
  ].join("\n");
}

/**
 * The page, from what's published: its main part, in the website's frame (sitePage in ./frame.ts),
 * whose top bar says the page is the website's own, and whose bottom bar says the version of
 * `voicecap`, the voicecap that built it; the banner that opens the main part, above its kicker, is
 * the newest of its releases. Pure.
 */
export function renderSiteIndex(content: SiteContent, voicecap: VoicecapFacts): string {
  return sitePage({
    title: SITE_TEXT.title,
    current: "index",
    version: voicecap.version,
    main: [
      ...news(voicecap.releases),
      kicker(SITE_TEXT.kicker),
      `<h1>${esc(SITE_TEXT.title)}</h1>`,
      `<p class="lead">${esc(SITE_TEXT.lead)}</p>`,
      onThisPage(content),
      ...(content.demo === null ? [] : [demoView(content.demo)]),
      sitesView(content.sites),
      ...(listsByDate(content) ? [byDateView(content.sites)] : []),
      `<p class="note">${sentenceHtml(SITE_TEXT.fingerprint)}</p>`,
      `<p class="note">${sentenceHtml(SITE_TEXT.walkthrough)}</p>`,
    ],
  });
}

/**
 * llms.txt, the website's file for AI tools, from what's published, as the llms.txt convention has
 * it (llmstxt.org). It's plain text, in Markdown's shape: the website's name as its title; a line
 * that sums it up; for each site, in the page's order, a section headed by the site's name, with a
 * link to its current report's Markdown and to its JSON, each followed by the report's line and its
 * verdict, as its card says them; and last the website's other two pages, in the section the
 * convention calls Optional, which a tool with little room can skip. A site whose current report
 * has neither file (a share from before the report for AI tools) has no section, though an earlier
 * report of it has them, and so has the demo, which is no site's: only a site's current report is
 * pointed to. With no site to list, a line says so. Each link is to a file beside this one, as the
 * page links to its files: no address of the website is known to the build.
 *
 * What a record supplies, a site's name and each file's address, comes vetted from the build, and
 * is written so that it stays on its line all the same (see printable). A site's name is the words
 * of a heading, so it is set as Markdown words too (markdownInline), as the report for AI tools sets
 * every word of a record: nothing in it is emphasis, a link, HTML, or an address a viewer would
 * link. Pure.
 */
export function renderLlmsTxt(content: SiteContent): string {
  const words = SITE_TEXT.llms;
  const formats = [
    ["markdown", SITE_TEXT.forAi.markdown],
    ["data", SITE_TEXT.forAi.json],
  ] as const;
  const sections = bySiteOrder(content.sites).flatMap(([{ name, reports }]): string[][] => {
    const [current] = reports;
    if (current === undefined) return [];
    const lines = formats.flatMap(([kind, format]) => {
      const file = fileOf(current, kind);
      if (file === undefined) return [];
      const verdictWords = hasVerdict(current.result) ? verdictOf(current.result).headline : null;
      return [`- [${format}](${printable(file.href)}): ${words.report(current.at, verdictWords)}`];
    });
    return lines.length === 0 ? [] : [[`## ${markdownInline(printable(name))}`, "", ...lines]];
  });
  return [
    `# ${SITE_TEXT.siteName}`,
    "",
    `> ${words.summary}`,
    "",
    ...(sections.length === 0 ? [words.none, ""] : sections.flatMap((section) => [...section, ""])),
    `## ${words.optional}`,
    "",
    `- [${SITE_TEXT.trust}](${TRUST_HREF}): ${words.trust}`,
    `- [${SITE_TEXT.technical}](${TECHNICAL_HREF}): ${words.technical}`,
    "",
  ].join("\n");
}

/** sites.json, format 1 (see renderSitesJson). */
export interface SitesJson {
  format: 1;
  sites: SitesJsonSite[];
}

/** A site of sites.json, as the page shows it. */
export interface SitesJsonSite {
  /** The name the page heads it with: its canonical name, or else its folder's. */
  name: string;
  /**
   * Where people visit it, the root that names it, as the page links it (see visitable); null for a
   * site its folder names.
   */
  address: string | null;
  /** Its section of the front page, from sites.json: "./#site-dvfr.illinois.gov". */
  href: string;
  /** Its current report, its newest; null for a site with none. */
  current: SitesJsonReport | null;
}

/** A site's current report, as sites.json gives it. */
export interface SitesJsonReport {
  /** When it was shared: the share's `at`, a local ISO date and time, as recorded. */
  shared: string;
  /** The verdict's kind (see verdictOf); null for a report with no verdict (see hasVerdict). */
  status: VerdictKind | null;
  /** The verdict's headline, as its card says it: "Nothing needs attention"; null with no verdict. */
  verdict: string | null;
  /** How many pages NVDA read, as its card says it: "NVDA read all 9 pages."; null with no verdict. */
  reading: string | null;
  /**
   * Its page, from the site's top: "dvfr.illinois.gov/dvfr.illinois.gov_2026-10-03.html"; null when
   * it isn't published.
   */
  page: string | null;
}

/**
 * sites.json, the website's sites for another website that links to the results, such as ICJIA's
 * documentation index: JSON, with two spaces of indent and a line break at its end. It's format 1:
 * for each site of the page, in its order, its name, its address, the link to its section of the
 * page, and its current report: when it was shared, its verdict, as its card says it, and its page.
 * The demo is no site's, so it's never one. Each link is relative to the file, as llms.txt's are:
 * no address of the website is known to the build. The same content gives the same bytes: nothing in
 * it is the time of the build. Pure.
 */
export function renderSitesJson(content: SiteContent): string {
  const value: SitesJson = {
    format: 1,
    sites: withSectionIds(content.sites).map(([{ name, address, reports }, id]) => {
      const [current] = reports;
      return {
        name,
        address: visitable(name, address),
        href: `./#${id}`,
        current: current === undefined ? null : sitesJsonReport(current),
      };
    }),
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** A report as sites.json gives it: its verdict only when it has one to give (see hasVerdict). */
function sitesJsonReport(report: PublishedReport): SitesJsonReport {
  const { at: shared, result } = report;
  const page = fileOf(report, "page")?.href ?? null;
  if (!hasVerdict(result)) return { shared, status: null, verdict: null, reading: null, page };
  const { kind, headline } = verdictOf(result);
  return { shared, status: kind, verdict: headline, reading: SITE_TEXT.reading(result), page };
}
