/**
 * The middle and the end of the shareable page, in the approved mockup's markup and class names:
 * "Every page" (a card for each page, and the pages no longer listed), "What the flags found", and
 * "Appendix: every transcript". Each takes the model and returns HTML.
 *
 * What the model or a record supplies goes through `esc`; the page's own static words are written
 * as they are. No `style` attribute is set, and the only links go to the page's own parts: a card
 * to its transcripts in the appendix.
 *
 * Most of this starts folded, as the design says: with more than 12 pages, the cards with nothing
 * to note; with more than 3 flagged pages, each page's quotes; and each page's transcripts. A
 * section's heading is never in a fold, and a fold's summary line never holds a heading (`fold`
 * refuses both).
 *
 * Where the mockup is sample data, nothing of it is here. Where it had nothing to say (a page's
 * title, its manual sessions, the run its transcripts come from, a pass that wasn't read, a
 * transcript that couldn't be read), the words are new, and use the mockup's own classes.
 */
import { PASS_NAMES, type PassName } from "../../model.js";
import { esc, idFragment, plural } from "../../report/html.js";
import { names, seconds } from "../format.js";
import type { AppendixFile, FlaggedPage, PageCard, ShareModel } from "../model.js";
import { chip, count, fold, notRecorded, scroll, strip } from "./parts.js";

/** More pages than this, and the cards with nothing to note fold behind one line. */
const MOST_PAGES_OPEN = 12;

/** More flagged pages than this, and each page's quotes fold. */
const MOST_QUOTES_OPEN = 3;

/** The size the mockup gives every screenshot, which its card crops to 4:3. */
const SHOT = { width: 640, height: 480 } as const;

/** What a pass is called as a heading, and in a sentence. */
const PASS_TITLE: Record<PassName, string> = { read: "Read", headings: "Headings", tab: "Tab" };
const PASS_WORDS: Record<PassName, string> = { read: "read", headings: "headings", tab: "Tab" };

/** What a card says of a pass the shown run didn't read, which is never "0". */
const NOT_READ = "Not read";

type Kind = "ok" | "warn" | "bad" | "quiet";

/**
 * A page's screenshot as the markup of the two places it can be: the picture, as the mockup has it,
 * or the line that stands in for it when it wasn't recorded, named for a screen reader.
 */
function screenshotOf(shot: PageCard["screenshot"]): { picture: string; missing: string } {
  if ("notRecorded" in shot) {
    return {
      picture: "",
      missing: `<div role="group" aria-label="Screenshot">${notRecorded(shot.notRecorded)}</div>`,
    };
  }
  const size = `width="${SHOT.width}" height="${SHOT.height}"`;
  return {
    picture: `<img src="${esc(shot.dataUri)}" alt="${esc(shot.alt)}" ${size} loading="lazy">`,
    missing: "",
  };
}

/** A line under a card's heading, or a section's: small, in the muted color. */
const small = (text: string): string => `<p class="sub">${esc(text)}</p>`;

/** Where a page's shown transcripts come from, when it isn't the latest run. */
const fromLine = ({ from }: PageCard): string =>
  from === null ? "" : small(`From run ${from.run}, on ${from.date}`);

// Every page.

/** The page's path, or the label its page list gave it with its path beside it. */
function heading(card: PageCard, number: number): string {
  const named = card.labeled
    ? `${esc(card.name)} <span class="sub">${esc(card.path)}</span>`
    : esc(card.path);
  return `<h3><span class="num">${number}</span> ${named}</h3>`;
}

/** The title the browser reported, or the words that say it wasn't recorded. A page with none has no line. */
function titleLine({ title }: PageCard): string {
  const text = typeof title === "string" ? title.trim() : title === null ? "" : title.notRecorded;
  return text === "" ? "" : small(`Title: ${text}`);
}

/**
 * The result's color: red for a page that failed or never had transcripts, amber for a skip or a
 * read that stopped before the page's end.
 */
function resultKind(card: PageCard): Kind {
  switch (card.status) {
    case "no-flags":
    case "flags":
      return card.readStopped === null ? "ok" : "warn";
    case "skipped":
      return card.counts === null ? "bad" : "warn";
    case "failed":
    case "never":
      return "bad";
  }
}

/** A review chip's color: a problem is amber, part of a session is quiet, the rest is good. */
function reviewKind(words: string): Kind {
  if (words === "Issue found" || words === "Changed since review") return "warn";
  // With a name the chip ends "… heard part of this session"; with none it starts "Heard part".
  return /heard part of this session$/i.test(words) ? "quiet" : "ok";
}

/**
 * The result, the flags, and the review, each a chip that says it in words. The result is one chip
 * ("Transcribed", or what the latest run did); each rule that raised a flag is a chip of its own, or
 * "No flags" for a page with transcripts and none; a page with no transcripts has neither, since
 * nothing was read to flag. Flags that are the run's record's, not the current rules', say so
 * ("Flags as recorded").
 */
function chipsOf(card: PageCard): string {
  const rules = [...new Set(card.flags.map(({ rule }) => rule))];
  const flags =
    card.counts === null
      ? []
      : rules.length === 0
        ? [chip("quiet", "No flags")]
        : ['<span class="sr">Flags raised: </span>', ...rules.map((rule) => chip("warn", rule))];
  const recorded = card.flagsAsRecorded ? [chip("quiet", "Flags as recorded")] : [];
  const review = card.reviewChips.map((words) => chip(reviewKind(words), words));
  return `<div class="chips">${[chip(resultKind(card), card.statusText), ...flags, ...recorded, ...review].join("")}</div>`;
}

/** How long a page took, as the mockup writes it: "55.1 s", then "1 min 2 s". */
function took(ms: number): string {
  if (Math.round(Math.max(0, ms) / 100) < 600) return seconds(ms);
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} min ${total % 60} s`;
}

/** What each pass captured, and the time, for a page with transcripts. */
function passesOf({ counts, timeMs }: PageCard): string {
  if (counts === null) return "";
  const box = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  return `<dl class="passes">${[
    box("Read", counts.read === null ? NOT_READ : plural(counts.read, "line")),
    box("Headings", counts.headings === null ? NOT_READ : count(counts.headings)),
    box("Tab stops", counts.tab === null ? NOT_READ : count(counts.tab)),
    box(
      "Time",
      typeof timeMs === "number" ? took(timeMs) : esc(timeMs?.notRecorded ?? "Not recorded"),
    ),
  ].join("")}</dl>`;
}

/** One bar for each line of the read pass, with its caption. A page with no lines has no strip. */
function stripOf({ strip: lines }: PageCard): string {
  if (lines.length === 0) return "";
  const caption = "Read pass: one bar per line NVDA spoke, as wide as it took";
  return `<figure class="strip-fig">${strip(lines, "Read pass")}<figcaption>${caption}</figcaption></figure>`;
}

/**
 * A page's card, in the mockup's order: the picture, then the heading, the chips, what each pass
 * captured, the strip, and the link to its transcripts. What the mockup had no place for (the title,
 * the failure, the run the transcripts come from, the manual sessions) comes between.
 */
function cardOf(card: PageCard, number: number, linked: boolean): string {
  const { picture, missing } = screenshotOf(card.screenshot);
  const manual = card.manual.map(({ at, reviewer }) =>
    small(`Manual NVDA session, ${at}${reviewer === null ? "" : `, by ${reviewer}`}`),
  );
  const link = `<a class="more" href="#tx-${idFragment(card.slug)}" aria-label="${esc(`Transcripts and fingerprints for ${card.path}`)}">Transcripts and fingerprints</a>`;
  const body = [
    missing,
    heading(card, number),
    titleLine(card),
    chipsOf(card),
    card.failure === null ? "" : `<p>${esc(card.failure)}</p>`,
    fromLine(card),
    ...manual,
    passesOf(card),
    stripOf(card),
    linked ? link : "",
  ].filter((part) => part !== "");
  const parts = [picture, `<div class="card-body">\n    ${body.join("\n    ")}\n  </div>`];
  return `<article class="card" id="pg-${idFragment(card.slug)}">\n  ${parts.filter((part) => part !== "").join("\n  ")}\n</article>`;
}

/** The cards, as the mockup lays them out. */
const cardsBox = (cards: string[]): string => `<div class="cards">${cards.join("\n")}</div>`;

/**
 * The line that opens "Every page": how many pages there are and how many were read in full in the
 * latest run, then what each card has. A page whose read stopped before its end was transcribed,
 * but never counts as read in full.
 */
function pagesGist({ pages, header }: ShareModel): string {
  if (pages.length === 0) {
    return header.tested === null
      ? "<b>No live run counts yet.</b> There are no pages to show."
      : "<b>The latest run listed no pages.</b>";
  }
  const total = pages.length;
  const of = (status: PageCard["status"]) => pages.filter((card) => card.status === status).length;
  const transcribed = pages.filter(({ status }) => status === "no-flags" || status === "flags");
  const read = transcribed.filter((card) => card.readStopped === null).length;
  const results = [
    [read, "read in full"],
    [transcribed.length - read, "transcribed but not in full"],
    [of("failed"), "failed in the latest run"],
    [of("skipped"), "skipped in the latest run"],
    [of("never"), "never transcribed"],
  ] as const;
  const said = names(
    results.filter(([some]) => some > 0).map(([some, words]) => `${count(some)} ${words}`),
  );
  const headline =
    read < total
      ? `${plural(total, "page")}: ${said}.`
      : total === 1
        ? "1 page, read in full."
        : `${count(total)} pages, all read in full.`;
  return `<b>${headline}</b> For each page: its result, the person's review as far as the records show it, and what each pass captured.`;
}

/** The pages earlier runs tested that the latest list no longer has, with their last record. */
function noLongerListed({ noLongerListed: gone }: ShareModel): string[] {
  if (gone.length === 0) return [];
  const rows = gone.map(({ name, url, lastRun, lastStatus }) => {
    const address = name === url ? "" : ` <span class="sub">${esc(url)}</span>`;
    return `<tr><th scope="row">${esc(name)}${address}</th><td>${esc(lastRun)}</td><td>${esc(lastStatus)}</td></tr>`;
  });
  const head = ["Page", "Last run that had it", "What it recorded"]
    .map((words) => `<th scope="col">${words}</th>`)
    .join("");
  const table = `<table class="plain"><caption class="sr">Pages no longer listed</caption><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  return [
    `<div class="panel"><h3>No longer listed</h3><p>Pages that earlier runs tested and the latest page list no longer has, with what the last run that had each one recorded.</p>${scroll("Pages no longer listed, table", table)}</div>`,
  ];
}

/**
 * "Every page": a card for each page, in the latest run's order. With more than 12 pages, the cards
 * with nothing to note fold behind one line, and those that need attention (flags, a failure or a
 * skip, an open issue, no transcripts, or transcripts that changed since their review) always show.
 * The pages no longer listed follow in a small table.
 */
export function renderPages(model: ShareModel): string {
  const linked = new Set(model.appendix.map(({ slug }) => slug));
  const entries = model.pages.map((card, index) => ({
    card,
    html: cardOf(card, index + 1, linked.has(card.slug)),
  }));
  const folding = entries.length > MOST_PAGES_OPEN;
  const shown = folding ? entries.filter(({ card }) => card.needsAttention) : entries;
  const quiet = folding ? entries.filter(({ card }) => !card.needsAttention) : [];
  const other = quiet.length === 1 ? "The other page" : `The other ${count(quiet.length)} pages`;
  const summary = `<span class="what">${other}:</span> <span class="sub">nothing to note, all read in full</span>`;
  const parts = [
    `<h2 id="pages-h">Every page</h2>`,
    `<p class="gist">${pagesGist(model)}</p>`,
    ...(shown.length === 0 ? [] : [cardsBox(shown.map(({ html }) => html))]),
    ...(quiet.length === 0
      ? []
      : [`<div class="folds">${fold(summary, cardsBox(quiet.map(({ html }) => html)))}</div>`]),
    ...noLongerListed(model),
  ];
  return `<section id="pages" aria-labelledby="pages-h">\n  ${parts.join("\n  ")}\n</section>`;
}

// What the flags found.

/** The line that opens "What the flags found": how many pages have flags, and from how many rules. */
function flagsGist({ flagged, pages, header }: ShareModel): string {
  if (header.tested === null) return "<b>No live run counts yet.</b> There are no flags to show.";
  if (pages.every(({ counts }) => counts === null)) {
    return "<b>No page has transcripts yet.</b> There are no flags to show.";
  }
  if (flagged.length === 0) {
    return "<b>No page has flags.</b> Flags point a person to pages worth a closer listen; none was raised.";
  }
  const rules = new Set(flagged.flatMap(({ quotes }) => quotes.map(({ rule }) => rule))).size;
  const has = flagged.length === 1 ? "has" : "have";
  return `<b>${plural(flagged.length, "page")} ${has} flags, from ${plural(rules, "rule")}.</b> Flags point a person to pages worth a closer listen. Each quotes what NVDA actually said.`;
}

/** The line a flagged page folds behind: its name, how many flags, and which rules raised them. */
function flagSummary({ name, flags }: PageCard): string {
  const rules = [...new Set(flags.map(({ rule }) => rule))];
  const chips = rules.map((rule) => chip("warn", rule)).join("");
  return `<span class="what">${esc(name)}:</span> <span class="sub">${plural(flags.length, "flag")}</span> <span class="chips">${chips}</span>`;
}

/**
 * A row for each rule that raised a flag: the rule, what it found, and the lines NVDA spoke that
 * raised it, each in its own code, in quotes, with a stop between them that a screen reader hears.
 * A rule with no line to quote (a page with no headings, Tab reaching nothing) says so, never an
 * empty quote.
 */
function flagBody({ card, quotes }: FlaggedPage): string {
  const rows = quotes.map(({ rule, text, said }) => {
    const spoken =
      said.length === 0
        ? '<span class="sub">No line to quote</span>'
        : said.map((line) => `<code>“${esc(line)}”</code>`).join('<span class="sr">;</span> ');
    return `<tr><th scope="row">${chip("warn", rule)}</th><td>${esc(text)}</td><td class="said">${spoken}</td></tr>`;
  });
  const head = ["Rule", "What NVDA showed", "NVDA said"]
    .map((words) => `<th scope="col">${words}</th>`)
    .join("");
  const table = `<table class="plain"><caption class="sr">Flags on ${esc(card.path)}</caption><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  return `${fromLine(card)}${scroll(`Flags table, ${card.path}`, table)}`;
}

/**
 * "What the flags found": for each flagged page, a row for each rule, with what it found and NVDA's
 * own words. Each page's quotes are open, until more than 3 pages have flags: then each folds.
 */
export function renderFlags(model: ShareModel): string {
  const open = model.flagged.length <= MOST_QUOTES_OPEN;
  const folds = model.flagged.map((page) => fold(flagSummary(page.card), flagBody(page), { open }));
  const parts = [
    `<h2 id="find-h">What the flags found</h2>`,
    `<p class="gist">${flagsGist(model)}</p>`,
    ...(folds.length === 0 ? [] : [`<div class="folds">${folds.join("")}</div>`]),
  ];
  return `<section aria-labelledby="find-h">\n  ${parts.join("\n  ")}\n</section>`;
}

// The appendix.

/**
 * A transcript's heading: its pass, with the page's address for a screen reader (every page has
 * a "Read", a "Headings", and a "Tab", which a reader going by headings couldn't tell apart).
 */
function transcriptHeading(pass: PassName, path: string, sub = ""): string {
  const after = sub === "" ? "" : ` <span class="sub">${sub}</span>`;
  return `<h3>${PASS_TITLE[pass]} <span class="sr">transcript of ${esc(path)}</span>${after}</h3>`;
}

/**
 * A transcript: its pass, how many lines it has, its file's size and fingerprint (the whole file's,
 * its header included, as its run recorded them), and what NVDA said, word for word, in a box to
 * scroll. A transcript with no lines says so rather than show an empty box. A browser drops the
 * newline right after `<pre>`, so a first line that's blank needs one more. Its section names its
 * file (`data-run`, `data-slug`, `data-file`), so the fingerprint check can compare the text shown
 * with the file the page carries.
 */
function transcriptOf(file: AppendixFile, path: string): string {
  const title = PASS_TITLE[file.pass];
  const lead = file.text.startsWith("\n") ? "\n" : "";
  const words =
    file.lines === 0
      ? '<p class="sub">This transcript has no lines.</p>'
      : scroll(`${title} transcript, ${path}`, `<pre>${lead}${esc(file.text)}</pre>`);
  const names = `data-run="${esc(file.run)}" data-slug="${esc(file.slug)}" data-file="${esc(file.name)}"`;
  const heading = transcriptHeading(file.pass, path, plural(file.lines, "line"));
  const fingerprint = `<p class="fp">The whole file, its header included: ${plural(file.bytes, "byte")}, SHA-256 <code>${esc(file.sha256)}</code></p>`;
  return `<section class="tx" ${names}>${heading}\n${fingerprint}\n${words}</section>`;
}

/** A transcript the run recorded but that couldn't be read here: said in words, in its place. */
function unreadableOf(pass: PassName, path: string): string {
  return `<section class="tx">${transcriptHeading(pass, path)}<p>This transcript was recorded, but its file couldn't be read here, so it isn't shown, and the fingerprint check leaves it out.</p></section>`;
}

/** The run a page's transcripts are from: its id, and its date for a run before the latest. */
function originOf(card: PageCard | undefined, latest: string | null): string {
  if (card?.from) {
    return `<p class="fp">From run <code>${esc(card.from.run)}</code>, on ${esc(card.from.date)}</p>`;
  }
  return latest === null ? "" : `<p class="fp">From run <code>${esc(latest)}</code></p>`;
}

/**
 * One page's fold: its screenshot and its transcripts, one for each pass the run recorded. Its
 * line says which, as many as there are ("read, headings, and Tab transcripts").
 */
function appendixPage(
  entry: ShareModel["appendix"][number],
  number: number,
  card: PageCard | undefined,
  latest: string | null,
): string {
  const passes = PASS_NAMES.filter(
    (pass) => entry.files.some((file) => file.pass === pass) || entry.unreadable.includes(pass),
  );
  const inside =
    passes.length === 0
      ? "no transcripts"
      : `${names(passes.map((pass) => PASS_WORDS[pass]))} ${passes.length === 1 ? "transcript" : "transcripts"}`;
  const summary = `<span class="num">${number}</span> <span class="what">${esc(entry.name)}:</span> <span class="sub">${inside}</span>`;
  const path = card?.path ?? entry.name;
  const sections = passes.map((pass) => {
    const file = entry.files.find((each) => each.pass === pass);
    return file === undefined ? unreadableOf(pass, path) : transcriptOf(file, path);
  });
  const none =
    passes.length === 0 ? "<p>This run's record lists no transcript files for the page.</p>" : "";
  const { picture, missing } =
    card === undefined ? { picture: "", missing: "" } : screenshotOf(card.screenshot);
  const body = `<div class="tx-grid">${picture}${missing}<div>${originOf(card, latest)}${sections.join("")}${none}</div></div>`;
  return fold(summary, body, { id: `tx-${idFragment(entry.slug)}` });
}

/** The line that opens the appendix: how many pages and transcripts, and any that couldn't be read. */
function appendixGist({ appendix, header }: ShareModel): string {
  if (header.tested === null) {
    return "<b>No live run counts yet.</b> There are no transcripts to show.";
  }
  if (appendix.length === 0) {
    return "<b>No transcripts to show.</b> No page has been read in full yet.";
  }
  const shown = appendix.reduce((sum, { files }) => sum + files.length, 0);
  const lost = appendix.reduce((sum, { unreadable }) => sum + unreadable.length, 0);
  const headline = `${plural(appendix.length, "page")}, ${shown === 0 ? "no transcripts shown" : plural(shown, "transcript")}.`;
  const unread =
    lost === 0
      ? ""
      : ` ${plural(lost, "transcript")} couldn't be read, and ${lost === 1 ? "says" : "each says"} so under its page.`;
  return `<b>${headline}</b> What NVDA said on each page, word for word, with each file's fingerprint. Open a page to read them.${unread}`;
}

/**
 * "Appendix: every transcript": each page with transcripts folds behind a line that says what's
 * inside. A card's "Transcripts and fingerprints" link opens its page's fold.
 */
export function renderAppendix(model: ShareModel): string {
  const cards = new Map(model.pages.map((card, index) => [card.slug, { card, number: index + 1 }]));
  const latest = model.evidence[0]?.run.id ?? null;
  const folds = model.appendix.map((entry, index) => {
    const found = cards.get(entry.slug);
    return appendixPage(entry, found?.number ?? index + 1, found?.card, latest);
  });
  const parts = [
    `<h2 id="app-h">Appendix: every transcript</h2>`,
    `<p class="gist">${appendixGist(model)}</p>`,
    ...(folds.length === 0 ? [] : [`<div class="appendix">${folds.join("")}</div>`]),
  ];
  return `<section aria-labelledby="app-h">\n  ${parts.join("\n  ")}\n</section>`;
}
