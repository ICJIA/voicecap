/**
 * The last parts of the shareable page, in the approved mockup's markup and class names: "What these
 * results cover", "The evidence behind these results" (with its fingerprint check, and a fold for each
 * run), "How voicecap came to be", and the footer. Each takes the model and returns HTML.
 *
 * What the model or a record supplies goes through `esc`; so does the fixed text (../text.ts), which
 * is plain words, except a timeline cell, which is inserted as written (it has `<b>` and `<code>` in
 * it, and is fixed). The page's own static words are written as they are. No `style` attribute is
 * set. The only links are to the page's own sections, voicecap's GitHub page, and the Deque study
 * the story cites.
 *
 * Of a run's record (`RunEvidence.run`, which the model keeps exactly as recorded, home folder and
 * all, since its seal covers every field) only its id and its dates are used. Everything else shown
 * of a run comes from the model's own rows, which are redacted.
 *
 * The mockup showed the evidence with two sample runs, a timeline drawn from a watcher's log, and a
 * walkthrough file, none of which a record has yet: where a run didn't record something, the model
 * says "Not recorded: this run used voicecap <version>", and so does the page.
 *
 * Where the mockup set a style attribute, the page's style block gives the same look instead: the
 * box of the two panels (`.limits`), the story's first paragraph (`#story-h + .gist`), the headings
 * of a run's parts (`.run-inside h3`), the command under a table (`.verify`), and the paragraphs in
 * the story's fold each need a rule.
 */
import type { RunJson } from "../../model.js";
import { esc, idFragment, plural } from "../../report/html.js";
import { checkDataJson } from "../check.js";
import { clock, dayMonth, longDate, names, utcOffset } from "../format.js";
import type { EvidenceRow, RunEvidence, ShareModel } from "../model.js";
import { runEnd, runStart } from "../run-evidence.js";
import { ABOUT, STORY, TIMELINE, WORTH_KNOWING, type TimelineRow } from "../text.js";
import { chip, fold, notRecorded, scroll } from "./parts.js";

const GITHUB = "https://github.com/ICJIA/voicecap";

/** The header cells of a table, from the words of each column. */
const columns = (words: string[]): string =>
  `<thead><tr>${words.map((each) => `<th scope="col">${each}</th>`).join("")}</tr></thead>`;

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
    : `<div><h3>${title}</h3><ul>${lines.map(coverageItem).join("")}</ul></div>`;
}

/**
 * "What these results cover": what is covered, and the technical limits, as the model words them.
 * With no run that counts there are no limits to name, so that panel is left out rather than empty.
 */
export function renderCoverage(model: ShareModel): string {
  const { covered, limits } = model.coverage;
  return [
    `<section aria-labelledby="lim-h">`,
    `  <h2 id="lim-h">What these results cover</h2>`,
    `  <div class="limits">${coveragePanel("Covered", covered)}${coveragePanel("Technical limits", limits)}</div>`,
    `</section>`,
  ].join("\n");
}

// The evidence.

/** What a fingerprint is, in the design's own words. */
const FINGERPRINT = `<p class="fp-what"><b>What's a fingerprint?</b> A fingerprint (SHA-256) is a code computed from a file's exact contents: change one character, and it changes completely. voicecap took one of every file as it wrote it, so a matching fingerprint shows the file hasn't changed since.</p>`;

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
  return `<p class="sub fp-limit"><b>What the check proves:</b> this page is consistent with itself, so the transcripts shown are exactly the ones the sealed records list. It can't prove the page itself wasn't changed, since whoever changed it could change the fingerprints too. For that, compare this file's own fingerprint with the one the sender recorded (<code>Get-FileHash &lt;file&gt;</code> in PowerShell, or <code>shasum -a 256 &lt;file&gt;</code> on a Mac, shows it), or run <code>${esc(verify)}</code> on the transcripts folder.</p>`;
}

/**
 * The transcripts the check leaves out because they couldn't be read here, by page, so its "21 of
 * 21" never reads as complete when a file is missing from it.
 */
function unreadableNote({ appendix }: ShareModel): string {
  const pages = appendix.filter(({ unreadable }) => unreadable.length > 0);
  const total = pages.reduce((sum, { unreadable }) => sum + unreadable.length, 0);
  if (total === 0) return "";
  const where = pages.map(
    ({ name, unreadable }) => `${name} (${names(unreadable.map((pass) => `${pass}.txt`))})`,
  );
  return `<p class="fp-what"><b>${plural(total, "transcript")} couldn't be read, so the check leaves ${total === 1 ? "it" : "them"} out:</b> ${esc(where.join("; "))}.</p>`;
}

/** The check: what a fingerprint is, the two buttons, where the result and every file checked show. */
function checkBox(model: ShareModel, verify: string): string {
  const parts = [
    FINGERPRINT,
    EXACT_COPIES,
    CHECK_BUTTONS,
    CHECK_RESULT,
    unreadableNote(model),
    checkedList(),
    checkProves(verify),
    NO_SCRIPT,
  ];
  return `<div class="fp-check">\n    ${parts.filter((part) => part !== "").join("\n    ")}\n  </div>`;
}

/**
 * The line that opens the evidence. The standing draws only on runs that completed and were sealed
 * (and weren't replays), so each run here is both.
 */
function evidenceGist(model: ShareModel): string {
  const runs = model.evidence.length;
  const each = runs === 1 ? "" : runs === 2 ? " both" : " all";
  const recorded = model.pages.filter((card) => card.flagsAsRecorded).length;
  const except =
    recorded === 0
      ? ""
      : `, except on ${plural(recorded, "page")} marked “Flags as recorded”, whose transcripts couldn&#39;t all be read here: ${recorded === 1 ? "its flags are as its run" : "their flags are as their runs"} recorded them`;
  return `<p class="gist"><b>${plural(runs, "run")},${each} completed and sealed.</b> The flags were computed with the current flag rules, fingerprint <code>${esc(model.flagRulesSha256)}</code>${except}.</p>`;
}

/** When a run ran: "29 September 2026, 14:02 to 14:09", with the day again for a run that crossed one. */
function whenOf(run: RunJson): string {
  const [start, end] = [runStart(run), runEnd(run)];
  const first = `${longDate(start)}, ${clock(start)}`;
  return longDate(end) === longDate(start)
    ? `${first} to ${clock(end)}`
    : `${first} to ${longDate(end)}, ${clock(end)}`;
}

/** A part of a run's fold: its heading names the run, so a reader going by headings can tell them apart. */
const runPart = (title: string, run: string, inside: string): string =>
  `<div><h3>${title} <span class="sr">in run ${esc(run)}</span></h3>${inside}</div>`;

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
  const table = `<table class="plain"><caption class="sr">Test environment of run ${esc(run)}</caption>${columns(["What", "What the run recorded"])}<tbody>${body.join("")}</tbody></table>`;
  return scroll(`Test environment, run ${run}, table`, table);
}

/** Every file the run's record lists: its page, its name, its size, and its fingerprint. */
function fingerprintTable(files: RunEvidence["fingerprints"], run: string): string {
  if (files.length === 0) return `<p>This run's record lists no files.</p>`;
  const body = files.map(
    ({ page, file, bytes, sha256 }) =>
      `<tr><td>${esc(page)}</td><td>${esc(file)}</td><td>${plural(bytes, "byte")}</td><td><code>${esc(sha256)}</code></td></tr>`,
  );
  const table = `<table class="plain"><caption class="sr">Fingerprints of run ${esc(run)}</caption>${columns(["Page", "File", "Size", "SHA-256"])}<tbody>${body.join("")}</tbody></table>`;
  return scroll(`Fingerprints, run ${run}, table`, table);
}

/** The command that checks the originals against the run's record. */
const verifyBox = (verify: string): string =>
  `<div class="verify"><span>To check these against the recorded files, anyone with the transcripts folder runs:</span><pre>${esc(verify)}</pre></div>`;

/**
 * A run's fold, behind its id, when it ran, and chips that say it completed and was sealed. Inside:
 * its facts, then four parts: the event log and NVDA's own log, which no version of voicecap records
 * yet (each says so, as the model words it), the test environment, and the fingerprints.
 */
function runFold(each: RunEvidence): string {
  const { run } = each;
  const chips = [chip("ok", "completed"), chip("ok", "sealed")].join(" ");
  const summary = `<span class="what">Run ${esc(run.id)}</span> <span class="sub">${esc(whenOf(run))}</span> <span class="chips">${chips}</span>`;
  const body = [
    factsOf(each.facts),
    runPart("Minute by minute", run.id, notRecorded(each.timeline.notRecorded)),
    runPart(
      "NVDA's own log, checked against the transcripts",
      run.id,
      notRecorded(each.nvdaLog.notRecorded),
    ),
    runPart("Test environment", run.id, environmentTable(each.environment, run.id)),
    runPart(
      "Fingerprints (SHA-256)",
      run.id,
      `${fingerprintTable(each.fingerprints, run.id)}${verifyBox(each.verify)}`,
    ),
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
  return `<div class="panel"><h3>Runs left out</h3><p>These runs aren't counted in any result on this page. A run counts only when it completed, was sealed, and wasn't a replay.</p><ul>${items.join("")}</ul></div>`;
}

/**
 * "The evidence behind these results": how many runs, that each completed and was sealed, and the
 * fingerprint of the flag rules; what a fingerprint is, and the check the page runs; a fold for each
 * run, the latest first; and the runs it left out.
 *
 * The check's data is the model's own: the records and transcripts as recorded. With no run that
 * counts there is nothing to check, and the section says so, with what it left out.
 */
export function renderEvidence(model: ShareModel): string {
  const { evidence, leftOut } = model;
  const [latest] = evidence;
  const heading = `<h2 id="ev-h">The evidence behind these results</h2>`;
  const parts =
    latest === undefined
      ? [
          heading,
          `<p class="gist"><b>No live run counts yet.</b> There is no evidence to show.</p>`,
          leftOutPanel(leftOut),
        ]
      : [
          heading,
          evidenceGist(model),
          checkBox(model, latest.verify),
          `<script type="application/json" id="fp-data">${checkDataJson(model.check)}</script>`,
          `<div class="folds">${evidence.map(runFold).join("")}</div>`,
          leftOutPanel(leftOut),
        ];
  return `<section aria-labelledby="ev-h">\n  ${parts.filter((each) => each !== "").join("\n  ")}\n</section>`;
}

// How voicecap came to be.

/**
 * Why voicecap exists. The study it rests on is quoted by its headline, once, and the headline is
 * the link, in place, to the article.
 */
function whyParagraph(): string {
  const { title, url } = STORY.deque;
  const pieces = STORY.why.split(title);
  const [before, after] = pieces;
  if (pieces.length !== 2 || before === undefined || after === undefined) {
    throw new Error("STORY.why must quote STORY.deque.title once, for the page to link it there.");
  }
  return `<p class="gist">${esc(before)}<a href="${esc(url)}">${esc(title)}</a>${esc(after)}</p>`;
}

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
 * it's the first date or the year changes. The entries of one day share a header, which spans them
 * (`entries`). What isn't done yet has no date, and is headed "Next".
 */
function timelineHeader(date: string | null, entries: number, lastYear: string | null): string {
  if (date === null) return `<th scope="row">Next</th>`;
  const day = `${date}T00:00`;
  const words = date.slice(0, 4) === lastYear ? dayMonth(day) : longDate(day);
  const span = entries > 1 ? ` rowspan="${entries}"` : "";
  return `<th scope="row"${span}><time datetime="${esc(date)}">${words}</time></th>`;
}

/**
 * The timeline as a table with two tracks, a row for each entry. An entry of the same day as the one
 * before has no header of its own: the day's header spans them both.
 */
function timelineTable(): string {
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
    `<th scope="col">When</th>`,
    `<th scope="col"><span class="plat pc">Windows PC</span>, with NVDA</th>`,
    `<th scope="col"><span class="plat mac">Mac</span>, with VoiceOver</th>`,
  ];
  const caption = `<caption>From the first line of code to today, on a Windows PC and on a Mac</caption>`;
  const table = `<table class="tracks">${caption}<thead><tr>${tracks.join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  return scroll("voicecap's timeline, table", table);
}

/**
 * "How voicecap came to be": why it exists, with the Deque study linked; the rest of the story in a
 * fold; the timeline on a Windows PC and on a Mac; and a few things worth knowing, folded. All of it
 * is fixed text, so it takes nothing from the model.
 */
export function renderStory(_model: ShareModel): string {
  const rest = fold(
    `<span class="what">The rest of the story</span> <span class="sub">the usual answer, and voicecap's</span>`,
    `<p>${esc(STORY.usual)}</p><p>${esc(STORY.answer)}</p>`,
  );
  const cards = WORTH_KNOWING.map(
    ({ title, text }) => `<div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`,
  );
  const worth = fold(
    `<span class="what">A few things worth knowing</span> <span class="sub">${plural(WORTH_KNOWING.length, "point")}</span>`,
    `<div class="worth">${cards.join("")}</div>`,
  );
  const parts = [
    `<h2 id="story-h">How voicecap came to be</h2>`,
    whyParagraph(),
    `<div class="folds">${rest}</div>`,
    timelineTable(),
    `<div class="folds">${worth}</div>`,
  ];
  return `<section aria-labelledby="story-h">\n  ${parts.join("\n  ")}\n</section>`;
}

// The footer.

/**
 * What voicecap is, with the link again; when the page was made, with its offset from UTC, and the
 * offsets the runs recorded their times in, since each time is shown as its run recorded it (a run
 * recorded elsewhere keeps its own); and the file's own name.
 */
export function renderFooter(model: ShareModel): string {
  const { generatedAt, fileName, offsets } = model.footer;
  const generated = `Generated on ${longDate(generatedAt)} at ${clock(generatedAt)} (${utcOffset(generatedAt)}).`;
  const times =
    offsets.length === 0 ? "" : ` Times are as each run recorded them (${names(offsets)}).`;
  return [
    `<footer>`,
    `  <span>${esc(ABOUT)} <a href="${GITHUB}">github.com/ICJIA/voicecap</a></span>`,
    `  <span>${esc(`${generated}${times}`)}</span>`,
    `  <span>This file: <span class="mono">${esc(fileName)}</span></span>`,
    `</footer>`,
  ].join("\n");
}
