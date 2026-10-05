/**
 * The middle and the end of the shareable page, in the approved mockup's markup and class names:
 * "Every page" (a card for each page, and the pages no longer listed), "What the flags found", and
 * "Appendix: every transcript". Each takes the model and returns HTML.
 *
 * What the model or a record supplies goes through `esc`; so does the fixed text (../text.ts), which
 * is plain words, and so does each line worked out from the model (../words.ts), through
 * `lineHtml`. No `style` attribute is set, and the only links go to the page's own parts: a card to
 * its transcripts in the appendix.
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
import { PASS_NAMES, SCREENSHOT_FILE, type PassName } from "../../model.js";
import { esc, idFragment } from "../../report/html.js";
import type { AppendixFile, FlaggedPage, PageCard, ShareModel } from "../model.js";
import { APPENDIX_TEXT, FLAGS_TEXT, PAGES_TEXT, PASS_TITLE } from "../text.js";
import {
  appendixGist,
  capturedOf,
  fileFingerprint,
  flagCount,
  flagsGist,
  fromRun,
  lineCount,
  manualLine,
  originOf,
  pagesGist,
  sentence,
  titleOf,
  transcriptsInside,
} from "../words.js";
import { chip, count, fold, lineHtml, notRecorded, scroll, strip } from "./parts.js";

/** More pages than this, and the cards with nothing to note fold behind one line. */
const MOST_PAGES_OPEN = 12;

/** More flagged pages than this, and each page's quotes fold. */
const MOST_QUOTES_OPEN = 3;

/**
 * What the appendix's opening line says of its folds. The page's alone: a copy that folds nothing,
 * as the Word copy doesn't, has no page to open (`appendixGist`).
 */
const OPEN_A_PAGE = "Open a page to read them.";

type Kind = "ok" | "warn" | "bad" | "quiet";

/**
 * A page's screenshot as the markup of the two places it can be: the picture, as the mockup has it,
 * or the line that stands in for it when it isn't there (not recorded, or not shown), named for a
 * screen reader.
 *
 * The picture is laid out at the size its record gives, which the browser then holds the room for
 * as the page loads. It names its page and file (`data-slug`, `data-file`), so the page's
 * fingerprint check can find every copy of it: the card's, and the appendix's.
 */
function screenshotOf(
  shot: PageCard["screenshot"],
  slug: string,
): { picture: string; missing: string } {
  if ("notRecorded" in shot) {
    return {
      picture: "",
      missing: `<div role="group" aria-label="${esc(PAGES_TEXT.screenshot)}">${notRecorded(shot.notRecorded)}</div>`,
    };
  }
  const size = `width="${Number(shot.width)}" height="${Number(shot.height)}"`;
  const names = `data-slug="${esc(slug)}" data-file="${SCREENSHOT_FILE}"`;
  return {
    picture: `<img src="${esc(shot.dataUri)}" alt="${esc(shot.alt)}" ${size} loading="lazy" ${names}>`,
    missing: "",
  };
}

/** A line under a card's heading, or a section's: small, in the muted color. */
const small = (text: string): string => `<p class="sub">${esc(text)}</p>`;

/** Where a page's shown transcripts come from, when it isn't the latest run. */
function fromLine(card: PageCard): string {
  const said = fromRun(card);
  return said === null ? "" : small(said);
}

// Every page.

/** The page's path, or the label its page list gave it with its path beside it. */
function heading(card: PageCard, number: number): string {
  const named = card.labeled
    ? `${esc(card.name)} <span class="sub">${esc(card.path)}</span>`
    : esc(card.path);
  return `<h3><span class="num">${number}</span> ${named}</h3>`;
}

/** The title the browser reported, or the words that say it wasn't recorded. A page with none has no line. */
function titleLine(card: PageCard): string {
  const said = titleOf(card);
  return said === null ? "" : small(said);
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
        ? [chip("quiet", PAGES_TEXT.noFlags)]
        : ['<span class="sr">Flags raised: </span>', ...rules.map((rule) => chip("warn", rule))];
  const recorded = card.flagsAsRecorded ? [chip("quiet", PAGES_TEXT.flagsAsRecorded)] : [];
  const review = card.reviewChips.map((words) => chip(reviewKind(words), words));
  return `<div class="chips">${[chip(resultKind(card), card.statusText), ...flags, ...recorded, ...review].join("")}</div>`;
}

/** What each pass captured, and the time, for a page with transcripts. */
function passesOf(card: PageCard): string {
  const captured = capturedOf(card);
  if (captured === null) return "";
  const boxes = captured.map(
    ({ label, value }) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`,
  );
  return `<dl class="passes">${boxes.join("")}</dl>`;
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
  const { picture, missing } = screenshotOf(card.screenshot, card.slug);
  const manual = card.manual.map((session) => small(manualLine(session)));
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

/** The pages earlier runs tested that the latest list no longer has, with their last record. */
function noLongerListed({ noLongerListed: gone }: ShareModel): string[] {
  if (gone.length === 0) return [];
  const rows = gone.map(({ name, url, lastRun, lastStatus }) => {
    const address = name === url ? "" : ` <span class="sub">${esc(url)}</span>`;
    return `<tr><th scope="row">${esc(name)}${address}</th><td>${esc(lastRun)}</td><td>${esc(lastStatus)}</td></tr>`;
  });
  const head = PAGES_TEXT.noLongerListedHead
    .map((words) => `<th scope="col">${esc(words)}</th>`)
    .join("");
  const table = `<table class="plain"><caption class="sr">Pages no longer listed</caption><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  return [
    `<div class="panel"><h3>${esc(PAGES_TEXT.noLongerListed)}</h3><p>${esc(PAGES_TEXT.noLongerListedLead)}</p>${scroll("Pages no longer listed, table", table)}</div>`,
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
    `<h2 id="pages-h">${esc(PAGES_TEXT.title)}</h2>`,
    `<p class="gist">${lineHtml(pagesGist(model))}</p>`,
    ...(shown.length === 0 ? [] : [cardsBox(shown.map(({ html }) => html))]),
    ...(quiet.length === 0
      ? []
      : [`<div class="folds">${fold(summary, cardsBox(quiet.map(({ html }) => html)))}</div>`]),
    ...noLongerListed(model),
  ];
  return `<section id="pages" aria-labelledby="pages-h">\n  ${parts.join("\n  ")}\n</section>`;
}

// What the flags found.

/** The line a flagged page folds behind: its name, how many flags, and which rules raised them. */
function flagSummary({ name, flags }: PageCard): string {
  const rules = [...new Set(flags.map(({ rule }) => rule))];
  const chips = rules.map((rule) => chip("warn", rule)).join("");
  return `<span class="what">${esc(name)}:</span> <span class="sub">${esc(flagCount(flags.length))}</span> <span class="chips">${chips}</span>`;
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
        ? `<span class="sub">${esc(FLAGS_TEXT.noLine)}</span>`
        : said.map((line) => `<code>“${esc(line)}”</code>`).join('<span class="sr">;</span> ');
    return `<tr><th scope="row">${chip("warn", rule)}</th><td>${esc(text)}</td><td class="said">${spoken}</td></tr>`;
  });
  const head = FLAGS_TEXT.head.map((words) => `<th scope="col">${esc(words)}</th>`).join("");
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
    `<h2 id="find-h">${esc(FLAGS_TEXT.title)}</h2>`,
    `<p class="gist">${lineHtml(flagsGist(model))}</p>`,
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
  return `<h3>${esc(PASS_TITLE[pass])} <span class="sr">${esc(APPENDIX_TEXT.transcriptOf)} ${esc(path)}</span>${after}</h3>`;
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
      ? `<p class="sub">${esc(APPENDIX_TEXT.noLines)}</p>`
      : scroll(`${title} transcript, ${path}`, `<pre>${lead}${esc(file.text)}</pre>`);
  const names = `data-run="${esc(file.run)}" data-slug="${esc(file.slug)}" data-file="${esc(file.name)}"`;
  const heading = transcriptHeading(file.pass, path, esc(lineCount(file.lines)));
  const fingerprint = `<p class="fp">${lineHtml(fileFingerprint(file))}</p>`;
  return `<section class="tx" ${names}>${heading}\n${fingerprint}\n${words}</section>`;
}

/**
 * A transcript the run recorded but that couldn't be read here: said in words, in its place, with
 * what the page's fingerprint check does with it.
 */
function unreadableOf(pass: PassName, path: string): string {
  const said = sentence(`${APPENDIX_TEXT.unreadable}${APPENDIX_TEXT.unreadableCheck}`);
  return `<section class="tx">${transcriptHeading(pass, path)}<p>${esc(said)}</p></section>`;
}

/** The run a page's transcripts are from: its id, and its date for a run before the latest. */
function originLine(card: PageCard | undefined, latest: string | null): string {
  const origin = originOf(card, latest);
  return origin === null ? "" : `<p class="fp">${lineHtml(origin)}</p>`;
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
  const inside = esc(transcriptsInside(passes));
  const summary = `<span class="num">${number}</span> <span class="what">${esc(entry.name)}:</span> <span class="sub">${inside}</span>`;
  const path = card?.path ?? entry.name;
  const sections = passes.map((pass) => {
    const file = entry.files.find((each) => each.pass === pass);
    return file === undefined ? unreadableOf(pass, path) : transcriptOf(file, path);
  });
  const none = passes.length === 0 ? `<p>${esc(APPENDIX_TEXT.noFiles)}</p>` : "";
  const { picture, missing } =
    card === undefined ? { picture: "", missing: "" } : screenshotOf(card.screenshot, card.slug);
  const body = `<div class="tx-grid">${picture}${missing}<div>${originLine(card, latest)}${sections.join("")}${none}</div></div>`;
  return fold(summary, body, { id: `tx-${idFragment(entry.slug)}` });
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
    `<h2 id="app-h">${esc(APPENDIX_TEXT.title)}</h2>`,
    `<p class="gist">${lineHtml(appendixGist(model, OPEN_A_PAGE))}</p>`,
    ...(folds.length === 0 ? [] : [`<div class="appendix">${folds.join("")}</div>`]),
  ];
  return `<section aria-labelledby="app-h">\n  ${parts.join("\n  ")}\n</section>`;
}
