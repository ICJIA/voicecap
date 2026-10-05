/**
 * The last parts of the shareable page, in the approved mockup's markup and class names: "What these
 * results cover", "The evidence behind these results" (with its fingerprint check, and a fold for each
 * run), "How voicecap came to be", and the footer. Each takes the model and returns HTML.
 *
 * What the model or a record supplies goes through `esc`; so does the fixed text (../text.ts), which
 * is plain words, except a timeline cell, which is inserted as written (it has `<b>` and `<code>` in
 * it, and is fixed). Each line worked out from the model (../words.ts) goes through `esc` or
 * `lineHtml`. The page's own words about its check (its buttons, and what it does without scripts)
 * are written as they are. No `style` attribute is set. The only links are to the page's own
 * sections, voicecap's GitHub page, and the Deque study the story cites, and, for each run, to its
 * walkthrough file: a data address that carries the file, which the reader downloads. Nothing is
 * loaded from it.
 *
 * Of a run's record (`RunEvidence.run`, which the model keeps exactly as recorded, home folder and
 * all, since its seal covers every field) only its id and its dates are used. Everything else shown
 * of a run comes from the model's own rows, which are redacted, and its own walkthrough file.
 *
 * The mockup showed the evidence with two sample runs and a timeline drawn from a watcher's log,
 * which no record has yet: where a run didn't record something, the model says "Not recorded: this
 * run used voicecap <version>", and so does the page. The walkthrough file the mockup showed is
 * made of each run's record (../run-evidence.ts).
 *
 * Where the mockup set a style attribute, the page's style block gives the same look instead: the
 * box of the two panels (`.limits`), the story's first two paragraphs (`#story-h + .gist`, and the
 * one after it), the headings of a run's parts (`.run-inside h3`), the command under a table, and
 * the command that repeats a run (both `.verify`), and the paragraphs in the story's fold each need
 * a rule.
 */
import { esc, idFragment, plural } from "../../report/html.js";
import { checkDataJson } from "../check.js";
import { sizeWords } from "../format.js";
import { firstSentenceBold, type Line } from "../line.js";
import type { EvidenceRow, RunEvidence, ShareModel } from "../model.js";
import {
  ABOUT,
  COVERAGE_TEXT,
  EVIDENCE_TEXT,
  FOOTER_TEXT,
  STORY,
  STORY_TEXT,
  TIMELINE,
  TOP_TEXT,
  WORTH_KNOWING,
  type TimelineRow,
} from "../text.js";
import {
  byteCount,
  evidenceGist,
  generatedLine,
  inRun,
  readCopyNote,
  runTitle,
  timelineDay,
  unreadableNote,
  whenOf,
  whyLine,
} from "../words.js";
import { chip, fold, lineHtml, notRecorded, scroll } from "./parts.js";

/** The header cells of a table, from the words of each column. */
const columns = (words: string[]): string =>
  `<thead><tr>${words.map((each) => `<th scope="col">${esc(each)}</th>`).join("")}</tr></thead>`;

// What these results cover.

/** The line that says every problem is explained: its last words link to where. */
const PROBLEMS_LINE =
  /^(Every problem during the runs is explained under )(Problems during the runs)(\.)$/;

function coverageItem(line: string): string {
  const found = PROBLEMS_LINE.exec(line);
  if (found === null) return `<li>${esc(line)}</li>`;
  const [, before = "", title = "", after = ""] = found;
  return `<li>${esc(before)}<a href="#prob-h">${esc(title)}</a>${esc(after)}</li>`;
}

/** A panel of lines, or nothing when it has none. */
function coveragePanel(title: string, lines: string[]): string {
  return lines.length === 0
    ? ""
    : `<div><h3>${esc(title)}</h3><ul>${lines.map(coverageItem).join("")}</ul></div>`;
}

/**
 * "What these results cover": what is covered, and the technical limits, as the model words them.
 * With no run that counts there are no limits to name, so that panel is left out rather than empty.
 */
export function renderCoverage(model: ShareModel): string {
  const { covered, limits } = model.coverage;
  return [
    `<section aria-labelledby="lim-h">`,
    `  <h2 id="lim-h">${esc(COVERAGE_TEXT.title)}</h2>`,
    `  <div class="limits">${coveragePanel(COVERAGE_TEXT.covered, covered)}${coveragePanel(COVERAGE_TEXT.limits, limits)}</div>`,
    `</section>`,
  ].join("\n");
}

// The evidence.

/** Why the check can recompute a seal: the page carries the records as they were written. */
const EXACT_COPIES = `<p class="fp-what">This page carries the sealed records exactly as voicecap wrote them, so the check can recompute their seals.</p>`;

/** The check's two buttons. They start hidden: the page's script shows them. */
const CHECK_BUTTONS = `<div class="fp-row"><button type="button" id="fp-run" class="fp-button" hidden>Check the fingerprints</button><button type="button" id="fp-demo" class="fp-demo" hidden>Show a change being caught</button></div>`;

/** Where the check says what it found. A live region, so a screen reader says it as it appears. */
const CHECK_RESULT = `<p id="fp-result" class="fp-result" role="status"></p>`;

/**
 * Said where the buttons would be. It shows unless the script hides it, so nothing but the
 * `hidden` attribute may stand in the way of it.
 */
const NO_SCRIPT = `<p class="fp-result fp-noscript">To check the fingerprints without scripts, use those two commands.</p>`;

/** Every file the check looked at, in a fold that stays hidden until a check has run. */
function checkedList(): string {
  const head = columns(["File", "Recorded fingerprint", "Result"]);
  const table = `<table class="plain"><caption class="sr">Files checked</caption>${head}<tbody id="fp-rows"></tbody></table>`;
  const summary = `<span class="what">Every file checked</span> <span class="sub" id="fp-count"></span>`;
  return fold(summary, scroll("Files checked, table", table), { id: "fp-list", hidden: true });
}

/**
 * What the check proves, and what it can't, with the two stronger checks: the file's own
 * fingerprint, and the command that checks the originals.
 */
function checkProves(verify: string): string {
  return `<p class="sub fp-limit">${lineHtml(EVIDENCE_TEXT.proves(verify))}</p>`;
}

/**
 * The transcripts the check leaves out because they couldn't be read here, by page, so its "21 of
 * 21" never reads as complete when a file is missing from it.
 */
function unreadableParagraph(model: ShareModel): string {
  const note = unreadableNote(model);
  return note === null ? "" : `<p class="fp-what">${lineHtml(note)}</p>`;
}

/** The check: what a fingerprint is, the two buttons, where the result and every file checked show. */
function checkBox(model: ShareModel, verify: string): string {
  const parts = [
    `<p class="fp-what">${lineHtml(firstSentenceBold(EVIDENCE_TEXT.fingerprint))}</p>`,
    EXACT_COPIES,
    CHECK_BUTTONS,
    CHECK_RESULT,
    unreadableParagraph(model),
    checkedList(),
    checkProves(verify),
    NO_SCRIPT,
  ];
  return `<div class="fp-check">\n    ${parts.filter((part) => part !== "").join("\n    ")}\n  </div>`;
}

/** A part of a run's fold: its heading names the run, so a reader going by headings can tell them apart. */
const runPart = (title: string, run: string, inside: string): string =>
  `<div><h3>${esc(title)} <span class="sr">${esc(inRun(run))}</span></h3>${inside}</div>`;

/** The run's facts, as the model has them: a tile for each. */
function factsOf(rows: EvidenceRow[]): string {
  const tiles = rows.map(
    ({ label, value }) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`,
  );
  return `<dl class="facts">${tiles.join("")}</dl>`;
}

/** The test environment: a row for each part of it the model has. */
function environmentTable(rows: EvidenceRow[], run: string): string {
  const body = rows.map(
    ({ label, value }) => `<tr><th scope="row">${esc(label)}</th><td>${esc(value)}</td></tr>`,
  );
  const table = `<table class="plain"><caption class="sr">Test environment of run ${esc(run)}</caption>${columns(EVIDENCE_TEXT.rowsHead)}<tbody>${body.join("")}</tbody></table>`;
  return scroll(`Test environment, run ${run}, table`, table);
}

/** Every file the run's record lists: its page, its name, its size, and its fingerprint. */
function fingerprintTable(files: RunEvidence["fingerprints"], run: string): string {
  if (files.length === 0) return `<p>${esc(EVIDENCE_TEXT.noFiles)}</p>`;
  const body = files.map(
    ({ page, file, bytes, sha256 }) =>
      `<tr><td>${esc(page)}</td><td>${esc(file)}</td><td>${byteCount(bytes)}</td><td><code>${esc(sha256)}</code></td></tr>`,
  );
  const table = `<table class="plain"><caption class="sr">Fingerprints of run ${esc(run)}</caption>${columns(EVIDENCE_TEXT.filesHead)}<tbody>${body.join("")}</tbody></table>`;
  return scroll(`Fingerprints, run ${run}, table`, table);
}

/** The command that checks the originals against the run's record. */
const verifyBox = (verify: string): string =>
  `<div class="verify"><span>${esc(EVIDENCE_TEXT.verify)}</span><pre>${esc(verify)}</pre></div>`;

/**
 * The command that repeats a run, in the same fixed-width box, with no words of its own: the lead
 * above it, which ends "then run:", says what it does.
 */
const repeatBox = (repeat: string): string => `<div class="verify"><pre>${esc(repeat)}</pre></div>`;

/**
 * A run's walkthrough file: the lead, a link whose address carries the file itself (a data address
 * of JSON in base64, which a browser saves under the `download` name), the command that repeats the
 * run from it, and what a repeat can't promise. A run that can't have a file says why in place of
 * all of that, as the model words it.
 *
 * Every run's link says the same words, so each is named for its run too, as a page card's link is
 * named for its page: its `aria-label` is the link's own words, then the run ("Download the
 * walkthrough file (4 KB) in run 2026-09-29_1402"). A person who goes by the links alone can tell
 * them apart, and the words come first, so one who says them to a voice control finds the link.
 */
function walkthroughBody({ run, walkthrough }: RunEvidence): string {
  const words = EVIDENCE_TEXT.walkthrough;
  if ("problem" in walkthrough) return `<p>${esc(words.problem(walkthrough.problem))}</p>`;
  const address = esc(`data:application/json;base64,${walkthrough.base64}`);
  const download = words.download(sizeWords(walkthrough.bytes));
  const name = esc(`${download} ${inRun(run.id)}`);
  return [
    `<p>${esc(words.lead)}</p>`,
    `<p><a download="${esc(walkthrough.fileName)}" href="${address}" aria-label="${name}">${esc(download)}</a></p>`,
    repeatBox(walkthrough.repeat),
    `<p>${esc(words.promise)}</p>`,
  ].join("");
}

/**
 * A run's fold, behind its id, when it ran, and chips that say it completed and was sealed. Inside:
 * its facts, then five parts: the event log and NVDA's own log, which no version of voicecap records
 * yet (each says so, as the model words it), the test environment, the fingerprints, and the
 * walkthrough file that repeats the run.
 */
function runFold(each: RunEvidence): string {
  const { run } = each;
  const { parts } = EVIDENCE_TEXT;
  const chips = [chip("ok", EVIDENCE_TEXT.completed), chip("ok", EVIDENCE_TEXT.sealed)].join(" ");
  const summary = `<span class="what">${esc(runTitle(run.id))}</span> <span class="sub">${esc(whenOf(run))}</span> <span class="chips">${chips}</span>`;
  const body = [
    factsOf(each.facts),
    runPart(parts.timeline, run.id, notRecorded(each.timeline.notRecorded)),
    runPart(parts.nvdaLog, run.id, notRecorded(each.nvdaLog.notRecorded)),
    runPart(parts.environment, run.id, environmentTable(each.environment, run.id)),
    runPart(
      parts.fingerprints,
      run.id,
      `${fingerprintTable(each.fingerprints, run.id)}${verifyBox(each.verify)}`,
    ),
    runPart(parts.walkthrough, run.id, walkthroughBody(each)),
  ];
  return fold(summary, body.join(""), {
    id: `run-${idFragment(run.id)}`,
    insideClassName: "run-inside",
  });
}

/** The runs left out, each as the model words it, with why a run is left out. */
function leftOutPanel(leftOut: ShareModel["leftOut"]): string {
  if (leftOut.length === 0) return "";
  const items = leftOut.map(({ text }) => `<li>${esc(text)}</li>`);
  const { title, lead, why } = EVIDENCE_TEXT.leftOut;
  return `<div class="panel"><h3>${esc(title)}</h3><p>${esc(`${lead} ${why}`)}</p><ul>${items.join("")}</ul></div>`;
}

/**
 * "The evidence behind these results": how many runs, that each completed and was sealed, and the
 * fingerprint of the flag rules; that the runs read a copy of the site, when they did; what a
 * fingerprint is, and the check the page runs; a fold for each run, the latest first; and the runs
 * it left out.
 *
 * The check's data is the model's own: the records and transcripts as recorded. With no run that
 * counts there is nothing to check, and the section says so, with what it left out.
 */
export function renderEvidence(model: ShareModel): string {
  const { evidence, leftOut } = model;
  const [latest] = evidence;
  const heading = `<h2 id="ev-h">${esc(EVIDENCE_TEXT.title)}</h2>`;
  const gist = `<p class="gist">${lineHtml(evidenceGist(model))}</p>`;
  const note = readCopyNote(model);
  const copy = note === null ? "" : `<p class="gist">${esc(note)}</p>`;
  const parts =
    latest === undefined
      ? [heading, gist, leftOutPanel(leftOut)]
      : [
          heading,
          gist,
          copy,
          checkBox(model, latest.verify),
          `<script type="application/json" id="fp-data">${checkDataJson(model.check)}</script>`,
          `<div class="folds">${evidence.map(runFold).join("")}</div>`,
          leftOutPanel(leftOut),
        ];
  return `<section aria-labelledby="ev-h">\n  ${parts.filter((each) => each !== "").join("\n  ")}\n</section>`;
}

// How voicecap came to be.

/**
 * A timeline entry's cells: one across both tracks, or one for each, an empty cell for a track
 * with nothing. What isn't done yet is "next". The cells are fixed HTML (`<b>` and `<code>`).
 */
function timelineCells({ date, pc, mac, both }: TimelineRow): string {
  const next = date === null ? " next" : "";
  if (both !== null) return `<td colspan="2" class="both${next}">${both}</td>`;
  const cell = (track: string, html: string | null): string =>
    html === null ? `<td class="none"></td>` : `<td class="${track}${next}">${html}</td>`;
  return `${cell("pc", pc)}${cell("mac", mac)}`;
}

/**
 * A timeline entry's row header: its day (a date is read as the day it begins), with the year when
 * it's the first date or the year changes (`timelineDay`). The entries of one day share a header,
 * which spans them (`entries`). What isn't done yet has no date, and is headed "Next".
 */
function timelineHeader(date: string | null, entries: number, lastYear: string | null): string {
  if (date === null) return `<th scope="row">${esc(STORY_TEXT.timeline.next)}</th>`;
  const span = entries > 1 ? ` rowspan="${entries}"` : "";
  return `<th scope="row"${span}><time datetime="${esc(date)}">${esc(timelineDay(date, lastYear))}</time></th>`;
}

/**
 * The timeline as a table with two tracks, a row for each entry. An entry of the same day as the one
 * before has no header of its own: the day's header spans them both.
 */
function timelineTable(): string {
  const { timeline } = STORY_TEXT;
  const rows: string[] = [];
  let lastYear: string | null = null;
  for (const [index, row] of TIMELINE.entries()) {
    const { date } = row;
    if (date !== null && TIMELINE[index - 1]?.date === date) {
      rows.push(`<tr>${timelineCells(row)}</tr>`);
      continue;
    }
    // The entries of this day, which follow one another, up to the first of another.
    const other = TIMELINE.slice(index).findIndex((entry) => entry.date !== date);
    const entries = other === -1 ? TIMELINE.length - index : other;
    rows.push(`<tr>${timelineHeader(date, entries, lastYear)}${timelineCells(row)}</tr>`);
    if (date !== null) lastYear = date.slice(0, 4);
  }
  const tracks = [
    `<th scope="col">${esc(timeline.when)}</th>`,
    `<th scope="col"><span class="plat pc">${esc(timeline.pc.name)}</span>, ${esc(timeline.pc.reader)}</th>`,
    `<th scope="col"><span class="plat mac">${esc(timeline.mac.name)}</span>, ${esc(timeline.mac.reader)}</th>`,
  ];
  const caption = `<caption>${esc(timeline.caption)}</caption>`;
  const table = `<table class="tracks">${caption}<thead><tr>${tracks.join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  return scroll("voicecap's timeline, table", table);
}

/**
 * "How voicecap came to be": how it began, then why it exists, with the Deque study linked, both in
 * the open; the rest of the story in a fold; the timeline on a Windows PC and on a Mac; and a few
 * things worth knowing, folded. All of it is fixed text, so it takes nothing from the model.
 */
export function renderStory(_model: ShareModel): string {
  const rest = fold(
    `<span class="what">${esc(STORY_TEXT.rest.title)}</span> <span class="sub">${esc(STORY_TEXT.rest.inside)}</span>`,
    `<p>${esc(STORY.usual)}</p><p>${esc(STORY.answer)}</p>`,
  );
  const cards = WORTH_KNOWING.map(
    ({ title, text }) => `<div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`,
  );
  const worth = fold(
    `<span class="what">${esc(STORY_TEXT.worth)}</span> <span class="sub">${plural(WORTH_KNOWING.length, "point")}</span>`,
    `<div class="worth">${cards.join("")}</div>`,
  );
  const parts = [
    `<h2 id="story-h">${esc(STORY_TEXT.title)}</h2>`,
    `<p class="gist">${esc(STORY.began)}</p>`,
    `<p class="gist">${lineHtml(whyLine())}</p>`,
    `<div class="folds">${rest}</div>`,
    timelineTable(),
    `<div class="folds">${worth}</div>`,
  ];
  return `<section aria-labelledby="story-h">\n  ${parts.join("\n  ")}\n</section>`;
}

// The footer.

/**
 * The footer's line on the file and its Word copy (`FOOTER_TEXT.page`), every word escaped. The
 * footer sets a name in the fixed-width font as a `<span class="mono">`, where `lineHtml` writes a
 * `<code>`, so this one line is drawn here. Its pieces are plain words and names, nothing else.
 */
function fileLine(line: Line): string {
  return line
    .map((piece) => {
      if (typeof piece === "string") return esc(piece);
      return piece.mono ? `<span class="mono">${esc(piece.text)}</span>` : esc(piece.text);
    })
    .join("");
}

/**
 * What voicecap is, with the link again; when the page was made, with its offset from UTC, and the
 * offsets the runs recorded their times in, since each time is shown as its run recorded it (a run
 * recorded elsewhere keeps its own); and the file's own name, with its Word copy's.
 */
export function renderFooter(model: ShareModel): string {
  const { fileName, wordName } = model.footer;
  return [
    `<footer>`,
    `  <span>${lineHtml([`${ABOUT} `, { text: FOOTER_TEXT.address, href: TOP_TEXT.github }])}</span>`,
    `  <span>${esc(generatedLine(model.footer))}</span>`,
    `  <span>${fileLine(FOOTER_TEXT.page(fileName, wordName))}</span>`,
    `</footer>`,
  ].join("\n");
}
