/**
 * The Word copy's "What these results cover", "The evidence behind these results", "How voicecap came
 * to be", and its footer, as blocks (./blocks.ts). Each takes the model, and says the words of the
 * page's renderer (../html/evidence.ts) in the same order: the fixed ones come from ../text.ts, the
 * ones worked out from the model from ../words.ts, and what only the Word copy says (what stands in
 * for the page's fingerprint check, how to get a run's walkthrough file, the first sentence of the
 * runs left out, the heads of the timeline's table, the footer's heading, the document's own words)
 * from `WORD_TEXT`. So the two copies can't say different things.
 *
 * The Word copy folds nothing: each run is a heading 2 with what its fold holds under it, and the
 * rest of the story and the six cards are in the open. It has no fingerprint check of its own, so it
 * leaves out everything of the page's: its buttons, its result line, its list of every file checked,
 * its line on the sealed records the page carries, its line for a page without scripts, and its note
 * on the transcripts the check leaves out (each page says which of its transcripts couldn't be
 * read, under its own heading). It says in their place what a reader can check, and that the web
 * page can check the transcripts it shows. It also leaves out the words the page says for a screen
 * reader alone that its own headings say in view (a table's caption, a box's name), the summary
 * lines of its folds, the page's links to its own sections, which follow one another in this copy,
 * and the link that downloads a run's walkthrough file, which a Word document can't carry: it says
 * how to get the file instead. Each section is built from a heading 1 of its own; the details set
 * each one level down (./details.ts). Pure.
 */
import { firstSentenceBold, lineOfMarkup, type Line } from "../line.js";
import { nvdaLogWords } from "../log-words.js";
import type { EvidenceRow, RunEvidence, ShareModel } from "../model.js";
import {
  ABOUT,
  COVERAGE_TEXT,
  EVIDENCE_TEXT,
  FOOTER_TEXT,
  STORY,
  STORY_TEXT,
  TIMELINE,
  TIMELINE_TEXT,
  TOP_TEXT,
  WORD_TEXT,
  WORTH_KNOWING,
  type TimelineRow,
} from "../text.js";
import {
  byteCount,
  evidenceGist,
  generatedLine,
  inRun,
  notRecordedLine,
  readCopyNote,
  recordTime,
  runTitle,
  sessionLine,
  timelineDay,
  whenOf,
  whyLine,
} from "../words.js";
import {
  cell,
  heading,
  list,
  mono,
  monoCell,
  para,
  table,
  type Block,
  type Cell,
} from "./blocks.js";

// What these results cover.

/** A panel of the coverage: its title and its lines as a list, or nothing when it has no lines. */
function panelBlocks(title: string, lines: string[]): Block[] {
  return lines.length === 0 ? [] : [heading(2, title), list(lines)];
}

/**
 * "What these results cover": what is covered, and the technical limits, as the model words them,
 * each a list under its own heading. A panel with no lines is left out, as on the page: with no run
 * that counts there are no limits to name. The page links one line to the section that explains
 * every problem; here the words stand as they are.
 */
export function wordCoverage(model: ShareModel): Block[] {
  const { covered, limits } = model.coverage;
  return [
    heading(1, COVERAGE_TEXT.title),
    ...panelBlocks(COVERAGE_TEXT.covered, covered),
    ...panelBlocks(COVERAGE_TEXT.limits, limits),
  ];
}

// The evidence.

/**
 * What a reader can check, in place of the page's check: that a Word document can't check itself,
 * the two checks that show whether anything has changed (this file's own fingerprint against the
 * one its sender recorded, and the command that checks the originals), and that the report's web
 * page can check the transcripts it shows. `verify` is that command, and `fileName` the web page's.
 */
function checksBlocks(verify: string, fileName: string): Block[] {
  const { evidence } = WORD_TEXT;
  return [
    para(evidence.checks),
    list([evidence.compare(), evidence.verify(verify)]),
    para(...evidence.webPage(fileName)),
  ];
}

/**
 * What a run recorded, as a table with a row for each: its label in bold, as the page's row headers
 * are, and what the run recorded, under the heads of the page's table of the test environment. A
 * run's facts are a table too, where the page draws a tile for each.
 */
function rowsTable(rows: EvidenceRow[]): Block {
  const body = rows.map(({ label, value }): (string | Line)[] => [
    [{ text: label, bold: true }],
    value,
  ]);
  return table(EVIDENCE_TEXT.rowsHead, body, [28, 72]);
}

/**
 * Every file a run's record lists, as a table with a row for each: its page, its name, its size,
 * and its fingerprint in the fixed-width font. A run whose record lists none says so, rather than
 * show an empty table.
 */
function fingerprintBlocks(files: RunEvidence["fingerprints"]): Block[] {
  if (files.length === 0) return [para(EVIDENCE_TEXT.noFiles)];
  const rows = files.map(({ page, file, bytes, sha256 }) => [
    page,
    file,
    byteCount(bytes),
    monoCell(sha256),
  ]);
  return [table(EVIDENCE_TEXT.filesHead, rows, [22, 14, 14, 50])];
}

/**
 * A part of a run: a heading 3 that names the run, so a reader going by headings can tell the parts
 * of two runs apart (the page says the run for a screen reader alone), and what is under it.
 */
function partBlocks(title: string, run: string, inside: Block[]): Block[] {
  return [heading(3, `${title} ${inRun(run)}`), ...inside];
}

/**
 * A run's walkthrough file. The Word copy can't carry the file, as the page does in a link, so it
 * says how to get it, from the web page or with the command that writes it, then the command that
 * repeats the run, each as a fixed-width block, and what a repeat can't promise, as the page says
 * it. A run that can't have a file says why in place of all of that, as the page does.
 */
function walkthroughBlocks({ walkthrough }: RunEvidence): Block[] {
  const { promise, problem } = EVIDENCE_TEXT.walkthrough;
  if ("problem" in walkthrough) return [para(problem(walkthrough.problem))];
  const { lead, then } = WORD_TEXT.evidence.walkthrough;
  return [
    para(lead),
    mono([walkthrough.get]),
    para(then),
    mono([walkthrough.repeat]),
    para(promise),
  ];
}

/**
 * A run's event log, where the page has a chart and a fold for each session: each session's name,
 * when the run's sessions are named, in bold; its summary, the chart's text; its table of every
 * event, the time to the millisecond in the fixed-width font; and, after the last, how many lines of
 * the log couldn't be read. A session the log has no line of says why in its place, as the page
 * says it. Where the page can't show the log, it says why, as the page does.
 */
function eventLogBlocks({ timeline, unlogged }: RunEvidence): Block[] {
  if (!Array.isArray(timeline)) return [para(notRecordedLine(timeline.notRecorded))];
  const sessions = [
    ...timeline.map((session) => {
      const named = sessionLine(timeline, session, unlogged);
      const rows = session.rows.map(({ time, text }) => [monoCell(recordTime(time)), text]);
      const blocks = [
        ...(named === null ? [] : [para({ text: named, bold: true })]),
        ...(session.summary.length === 0 ? [] : [para(session.summary.join(" "))]),
        table(TIMELINE_TEXT.head, rows, [22, 78]),
        ...(session.unreadable > 0 ? [para(TIMELINE_TEXT.unreadable(session.unreadable))] : []),
      ];
      return { n: session.session, blocks };
    }),
    ...unlogged.map(({ session, notRecorded }) => ({
      n: session,
      blocks: [para(notRecordedLine(notRecorded))],
    })),
  ];
  return sessions.sort((a, b) => a.n - b.n).flatMap(({ blocks }) => blocks);
}

/**
 * A run's NVDA log, checked against the transcripts, in the page's words (../log-words.ts): its three
 * counts as a list, the steps that weren't checked, straight under them, as the page says them, that
 * every line agrees, or each list of the lines that differ under a bold line of its own, and how many
 * lines NVDA spoke outside the steps. The part is under a heading 3, which the details set to a 4,
 * and a Word heading goes no lower, so the lists have no headings: each bold line is followed by its
 * list, which the document keeps with it. Where there is no check, why, as the model words it.
 */
function nvdaLogBlocks({ nvdaLog }: RunEvidence): Block[] {
  if ("notRecorded" in nvdaLog) return [para(notRecordedLine(nvdaLog.notRecorded))];
  const words = nvdaLogWords(nvdaLog);
  return [
    list(words.tiles.map(({ big, label }) => `${big} ${label}`)),
    ...words.notChecked.map((line) => para(line)),
    ...(words.same === null ? [] : [para(...firstSentenceBold(words.same))]),
    ...words.lists.flatMap(({ title, lines }) => [
      para({ text: title, bold: true }),
      list(
        lines.map(({ where, words: said }): Line => [
          { text: `${where}: `, bold: true },
          `“${said}”`,
        ]),
      ),
    ]),
    para(words.outside),
  ];
}

/**
 * A run: its title as a heading 2, when it ran and that it completed and was sealed, its facts, and
 * its five parts. The event log, minute by minute, is each session's summary and its table of
 * events (from voicecap 0.11.0); NVDA's own log, checked against the transcripts (from 0.17.0), is
 * the counts and the lines that differ, or says why not, as the model words it. The test
 * environment is a table. The fingerprints are a table, and after it how to check them against the
 * recorded files, with the command as a fixed-width block. The walkthrough file is last.
 */
function runBlocks(each: RunEvidence): Block[] {
  const { run } = each;
  const { parts } = EVIDENCE_TEXT;
  return [
    heading(2, runTitle(run.id)),
    para(`${whenOf(run)}. ${WORD_TEXT.evidence.status}`),
    rowsTable(each.facts),
    ...partBlocks(parts.timeline, run.id, eventLogBlocks(each)),
    ...partBlocks(parts.nvdaLog, run.id, nvdaLogBlocks(each)),
    ...partBlocks(parts.environment, run.id, [rowsTable(each.environment)]),
    ...partBlocks(parts.fingerprints, run.id, [
      ...fingerprintBlocks(each.fingerprints),
      para(EVIDENCE_TEXT.verify),
      mono([each.verify]),
    ]),
    ...partBlocks(parts.walkthrough, run.id, walkthroughBlocks(each)),
  ];
}

/**
 * The runs left out: a heading, why a run is left out, and a line for each. None when none were. The
 * lead's first sentence is the Word copy's own, "in this report", since "this page" would read as
 * the printed page; the sentence after it is the page's.
 */
function leftOutBlocks(leftOut: ShareModel["leftOut"]): Block[] {
  if (leftOut.length === 0) return [];
  const { title, why } = EVIDENCE_TEXT.leftOut;
  return [
    heading(2, title),
    para(`${WORD_TEXT.evidence.leftOutLead} ${why}`),
    list(leftOut.map(({ text }) => text)),
  ];
}

/**
 * "The evidence behind these results": how many runs there are, that each completed and was sealed,
 * and the fingerprint of the flag rules; that the runs read a copy of the site, when they did; what
 * a fingerprint is; what a reader can check; each run, the latest first; and the runs left out.
 *
 * With no run that counts there is nothing to check, and the section says so, with what it left out.
 */
export function wordEvidence(model: ShareModel): Block[] {
  const { evidence, leftOut } = model;
  const [latest] = evidence;
  const copy = readCopyNote(model);
  const opening = [
    heading(1, EVIDENCE_TEXT.title),
    para(...evidenceGist(model)),
    ...(copy === null ? [] : [para(copy)]),
  ];
  if (latest === undefined) return [...opening, ...leftOutBlocks(leftOut)];
  return [
    ...opening,
    para(...firstSentenceBold(EVIDENCE_TEXT.fingerprint)),
    ...checksBlocks(latest.verify, model.footer.fileName),
    ...evidence.flatMap(runBlocks),
    ...leftOutBlocks(leftOut),
  ];
}

// How voicecap came to be.

/**
 * A track's words, with the page's own head for its column before them, in bold: "Windows PC, with
 * NVDA:".
 */
function trackLine(track: { name: string; reader: string }, markup: string): Line {
  return [{ text: `${track.name}, ${track.reader}:`, bold: true }, " ", ...lineOfMarkup(markup)];
}

/**
 * What an entry says: its words alone when it runs across both tracks, else a line for each track
 * that has words, the Windows PC's first, each after its track's name and screen reader, which the
 * page says in the head of the track's column.
 */
function entryCell({ pc, mac, both }: TimelineRow): Cell {
  const { timeline } = STORY_TEXT;
  if (both !== null) return cell(lineOfMarkup(both));
  return cell(
    ...(pc === null ? [] : [trackLine(timeline.pc, pc)]),
    ...(mac === null ? [] : [trackLine(timeline.mac, mac)]),
  );
}

/**
 * The timeline: its caption in bold, then a table of When and What happened, a row for each entry. A
 * day is as the page says it (`timelineDay`): a date is read as the day it begins, with its year for
 * the first date and for the first of a later year. What isn't done yet has no date, and is headed
 * "Next". Two entries of one day each say it, since a row of a printed table is read apart from the
 * rows around it, where the page's header spans them.
 */
function timelineBlocks(): Block[] {
  const { timeline } = STORY_TEXT;
  const rows: Cell[][] = [];
  let lastYear: string | null = null;
  for (const entry of TIMELINE) {
    const day = entry.date === null ? timeline.next : timelineDay(entry.date, lastYear);
    if (entry.date !== null) lastYear = entry.date.slice(0, 4);
    rows.push([cell([{ text: day, bold: true }]), entryCell(entry)]);
  }
  return [
    para({ text: timeline.caption, bold: true }),
    table(WORD_TEXT.story.head, rows, [22, 78]),
  ];
}

/** "A few things worth knowing": a heading, and the cards as a list, each title in bold. */
function worthBlocks(): Block[] {
  const cards = WORTH_KNOWING.map(({ title, text }): Line => [
    { text: title, bold: true },
    `: ${text}`,
  ]);
  return [heading(2, STORY_TEXT.worth), list(cards)];
}

/**
 * "How voicecap came to be": how it began, then why it exists, with the Deque study's headline
 * linked, then the rest of the story, the timeline on a Windows PC and on a Mac, and a few things
 * worth knowing. All of it is fixed text, so it takes nothing from the model, and the Word copy
 * says all of it in the open.
 */
export function wordStory(_model: ShareModel): Block[] {
  return [
    heading(1, STORY_TEXT.title),
    para(STORY.began),
    para(...whyLine()),
    para(STORY.usual),
    para(STORY.answer),
    ...timelineBlocks(),
    ...worthBlocks(),
  ];
}

// The footer.

/**
 * The footer, under a heading 1 of its own: on the page the footer is a landmark, which a screen
 * reader announces, but a Word document has none, so without a heading its paragraphs would belong
 * to the heading before it (a heading 3 of the details, the last of the story's), in the
 * navigation pane and for a screen reader. Then what voicecap is, with its address linked; when the
 * report was made, with its offset from UTC, and the offsets the runs recorded their times in; and
 * the file's own name, with its web page's. The heading follows the details with no page break.
 */
export function wordFooter(model: ShareModel): Block[] {
  const { fileName, wordName } = model.footer;
  return [
    heading(1, WORD_TEXT.footer.heading),
    para(`${ABOUT} `, { text: FOOTER_TEXT.address, href: TOP_TEXT.github }),
    para(generatedLine(model.footer)),
    para(...FOOTER_TEXT.word(fileName, wordName)),
  ];
}
