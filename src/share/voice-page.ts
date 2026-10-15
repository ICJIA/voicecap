/**
 * The voice page: the companion of the shareable page that plays what NVDA said aloud on each page,
 * from the recordings a run keeps of it (plan 11, from voicecap 0.18.0). It's one file, like the
 * shareable page: each recording is in it as a `data:audio/webm;base64,` address, in an audio
 * element, so it can be sent on its own, and a Content Security Policy can allow exactly what it
 * holds and makes (one style block, one script, the media its own addresses hold, and the slowed
 * copies its script makes of them, which it plays as `blob:` addresses).
 *
 * The recording is evidence. The person's review is made from the transcripts, by reading what NVDA
 * said (NVDA speaks too fast to follow), so the page says so, and plays each recording at a speed a
 * person can follow: 1×, 0.75×, 0.5×, and 0.3×. 1× is the recording as recorded. A slower speed is
 * a copy that voicecap's own stretcher (./voice-stretch.ts) makes in the reader's browser, from the
 * recording the page holds, with the pitch kept, which a second player plays in the first one's
 * place. Where the browser can't make one, the page slows the recording with the browser's own
 * stretcher instead (`playbackRate`, and `preservesPitch` set on, never left to the browser's
 * default).
 *
 * In order: the head, with the page's one style block (the fonts, if the caller has them, then
 * SHARE_CSS and VOICE_CSS); a skip link; the top, which leads with the site's name and when it was
 * tested, never an address (the same name, date, and theme button as the shareable page's); `main`,
 * with a section for each page the shareable page has a card for, in its order, and the check;
 * the footer; and last the page's one script: the shareable page's own (SHARE_SCRIPT, for the
 * theme), then the fingerprint check's (CHECK_SCRIPT), then this page's (VOICE_SCRIPT).
 *
 * A page's section is its number and name, the run its recording is from when that isn't the latest,
 * and then either its player (an audio element with `controls` and `preload="none"`, named for the
 * page, which loads nothing until it's played), its speed choice, and what is said of its file (its
 * length, the sound lost by the recorder when it lost any, and its size and SHA-256), or the words
 * that say why it has no player (see `voiceOf`).
 *
 * Which recording a page's section plays is the one its card speaks for: the run whose transcripts
 * the card shows, else, for a page never transcribed, its latest failure's, and no other run's
 * recording is of what the transcripts say. The model says which record that is, once, for each
 * card (`PageCard.speaksFor`: the run, and the page's slug in it), as the loader files each file
 * and the card's line on its recording finds it, so the card's line and its section can't be of
 * different recordings. The record itself is found among the records the model keeps for its check,
 * which are exactly the runs its cards draw on. The recordings come in by run and slug, as the
 * loader holds them (`<run>/<slug>`), only when a file is as its record has it.
 *
 * The recording is audio alone, so its text alternative is one step away (WCAG 1.2.1): each section
 * with a page whose transcripts the shareable page has links to them, at the id of their fold there
 * (`transcriptAnchor`), and the footer links to the shareable page by name. Both links are relative,
 * to the file beside this one, so they work in the folder, in the two files of an email opened side
 * by side, and on the website, where a share's files are published in one folder.
 *
 * What the model or a record supplies goes through `esc`, a reason included: the recorder's own
 * words in a reason are text, with the home folder already replaced when the run recorded it. No
 * `style` attribute is set, and the only links are to the page's own parts, to the shareable page
 * beside it, and to voicecap's page. Nothing is loaded from outside it, and nothing plays by itself.
 */
import { VOICE_FILE, type PageRecord, type RunJson, type VoiceRecord } from "../model.js";
import { esc, idFragment } from "../report/html.js";
import { transcriptAnchor, voiceAnchor } from "./anchors.js";
import { CHECK_SCRIPT, checkDataJson, type CheckData } from "./check.js";
import { longDate } from "./format.js";
import { SHARE_SCRIPT } from "./html/client.js";
import {
  CHECK_BUTTONS,
  CHECK_RESULT,
  checkedList,
  EXACT_COPIES,
  NO_SCRIPT,
} from "./html/evidence.js";
import { heading } from "./html/pages.js";
import { lineHtml, notRecorded } from "./html/parts.js";
import { SHARE_CSS, VOICE_CSS } from "./html/style.js";
import { firstSentenceBold } from "./line.js";
import type { PageCard, ShareModel } from "./model.js";
import { voiceRecordOf } from "./records.js";
import {
  driverRecordsVoice,
  keepsVoice,
  notRecordedBy,
  sessionVersion,
  versionOf,
} from "./run-evidence.js";
import { standingOf } from "./standing.js";
import { ABOUT, EVIDENCE_TEXT, FOOTER_TEXT, PAGES_TEXT, TOP_TEXT, VOICE_TEXT } from "./text.js";
import { STRETCH_LIBRARY } from "./voice-stretch.js";
import { generatedLine, testedLine } from "./words.js";

/** A page's recording as its run keeps it: the file's fingerprint, its length, and the sound lost. */
type KeptVoice = Exclude<VoiceRecord, { error: string }>;

/** The record a card speaks for: the run, and its record of the page. */
interface Source {
  run: RunJson;
  page: PageRecord;
}

/**
 * What a page's section has: its recording, with its record, the file's bytes, and the record it's
 * from; or, in place of a player, the words that say why the page has none.
 */
type Voice = { record: KeptVoice; bytes: Uint8Array; source: Source } | { why: string };

/** One page's section: its card and number, where its recording is from, and what it has of it. */
interface Section {
  card: PageCard;
  number: number;
  source: Source | null;
  voice: Voice;
}

/** A number a record can give a length or a size: finite, as JSON has it. */
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * A reason a page has no recording, as a sentence holds it: on one line, with no full stop at its
 * end, which the sentence puts after it. It's the record's own words, which already have the home
 * folder replaced (the run replaced it as it recorded the reason), so it's only made one line.
 */
function reasonOf(error: unknown): string {
  const said = typeof error === "string" ? error : "";
  return said
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "");
}

/**
 * What a page has of its recording, as its card's screenshot has of its picture: the recording itself,
 * when its record has a file's fingerprint and the loader holds the file (it holds only a file as its
 * record has it); otherwise the words that say why there's none, as VOICE_TEXT has them: the file
 * isn't as the run recorded it, the run's record of it is of no kind voicecap writes (read through
 * `voiceRecordOf`), or the recorder couldn't record it (with the reason the run recorded).
 *
 * A record with no recording says it as every part a run didn't record is said, when its run is from
 * before voicecap recorded NVDA's voice (KEEPS_VOICE_FROM). From then on, it goes by the run's driver,
 * as its settings name it (`driverRecordsVoice`): one that records gave every page it read a record,
 * so this page wasn't read (it was skipped, it answered with an HTTP error, or it wouldn't open),
 * though no page of the run has a record, as when none was read; one that can't (the replay driver,
 * the AT Driver stub) is said not to record. A driver this version doesn't know is judged by the
 * run's pages: it recorded this one's neighbors, or none. `recordedAny` remembers, by run, whether
 * any page of it has a record of a recording.
 *
 * A page no record speaks for (`source` is null: no run read it, which only a run that left the page
 * pending has) says the same of `latestVersion`, the latest run's: from a voicecap that records, that
 * the page wasn't read, and from one that didn't, that the run used it.
 */
function voiceOf(
  source: Source | null,
  latestVersion: string | null,
  recordings: ReadonlyMap<string, Uint8Array>,
  recordedAny: Map<RunJson, boolean>,
): Voice {
  if (source === null) {
    return { why: keepsVoice(latestVersion) ? VOICE_TEXT.notRead : notRecordedBy(latestVersion) };
  }
  const { run, page } = source;
  const version = sessionVersion(run, page.session);
  const record = voiceRecordOf(page);
  if (record === "unreadable") return { why: VOICE_TEXT.unreadable };
  if (record === undefined) {
    if (!keepsVoice(version)) return { why: notRecordedBy(version) };
    const records = driverRecordsVoice(run.settings.driver);
    if (records !== null) return { why: records ? VOICE_TEXT.notRead : VOICE_TEXT.noDriver };
    let recorded = recordedAny.get(run);
    if (recorded === undefined) {
      recorded = run.pages.some((each) => each.voice !== undefined);
      recordedAny.set(run, recorded);
    }
    return { why: recorded ? VOICE_TEXT.notRead : VOICE_TEXT.noDriver };
  }
  if ("error" in record) return { why: VOICE_TEXT.failed(reasonOf(record.error)) };
  // The loader holds a file only when it's as its record has it.
  const bytes = recordings.get(`${run.id}/${page.slug}`);
  if (bytes === undefined) return { why: VOICE_TEXT.changed };
  return { record, bytes, source };
}

/**
 * The record each page's card speaks for, by the page's key, as the model says it (`speaksFor`):
 * the run, and the page in it, found among the records the model keeps for its check. And the latest
 * run, which decides the pages in scope (a section whose recording is of another run says which),
 * from the standing of those records, which holds the run itself.
 */
function sourcesOf(model: ShareModel): { sources: Map<string, Source>; latest: RunJson | null } {
  const runs = new Map(model.check.runs.map((run): [string, RunJson] => [run.id, run]));
  const sources = new Map<string, Source>();
  for (const card of model.pages) {
    const filed = card.speaksFor;
    const run = filed === null ? undefined : runs.get(filed.run);
    const page = run?.pages.find((each) => each.slug === filed?.slug);
    if (run !== undefined && page !== undefined) sources.set(card.key, { run, page });
  }
  return { sources, latest: standingOf(model.check.runs).latest };
}

/** Where the recording is from, when it isn't the latest run's, as the page's card says it. */
function originLine(source: Source | null, latest: RunJson | null): string {
  if (source === null || source.run === latest) return "";
  const date = longDate(source.run.createdAt);
  return `<p class="sub">${esc(VOICE_TEXT.from(source.run.id, date))}</p>`;
}

/**
 * The player: an audio element with its controls, which loads nothing until it's played
 * (`preload="none"`) and never plays by itself, with the recording as its address. It's named for
 * its page, and names its page and file (`data-slug`, `data-file`), so the fingerprint check can
 * find it and hold what it plays to its run's record.
 */
function player(card: PageCard, page: PageRecord, bytes: Uint8Array): string {
  const address = `data:audio/webm;base64,${Buffer.from(bytes).toString("base64")}`;
  const names = `aria-label="${esc(VOICE_TEXT.player(card.path))}" data-slug="${esc(page.slug)}" data-file="${VOICE_FILE}"`;
  return `<audio controls preload="none" src="${address}" ${names}></audio>`;
}

/**
 * What stands for the speed in the words a speed choice carries (`VOICE_TEXT.speed.making`, `made`,
 * and `slowed` are given it as their speed). The page's script says those words, and the markup is
 * made before any speed is chosen, so the script puts the chosen speed's label ("0.3×") in its place.
 */
export const SPEED_TOKEN = "{speed}";

/**
 * The speed choice: a group of radio buttons under the legend "Speed", 1× chosen, named for the page
 * for a screen reader alone, and under them a status line, empty (`role="status"`, so what the
 * script writes in it is said politely). Its choice sets the speed the recording plays at, and does
 * nothing without the script, so it starts hidden and the script shows it, as the check's buttons
 * are. Every group has a name of its own, which its page's slug makes.
 *
 * The words the script says are VOICE_TEXT's, so that it holds none of its own: the group carries
 * them in `data-` attributes, escaped as every value is, with `SPEED_TOKEN` where the speed goes.
 * They are what the status line says while a copy is made (`data-making`) and when it's ready
 * (`data-made`), what it says where the browser slows the player itself (`data-own`), and the name
 * of the slowed copy's player, which holds this page's address (`data-slowed`).
 */
function speeds(card: PageCard): string {
  const { speed } = VOICE_TEXT;
  const name = `speed-${idFragment(card.slug)}`;
  const choices = speed.rates.map(
    (rate) =>
      `<label><input type="radio" name="${name}" value="${rate}"${rate === 1 ? " checked" : ""}> ${esc(speed.label(rate))}</label>`,
  );
  const legend = `<legend>${esc(speed.legend)}<span class="sr">${esc(speed.on(card.path))}</span></legend>`;
  const words = Object.entries({
    making: speed.making(SPEED_TOKEN),
    made: speed.made(SPEED_TOKEN),
    own: speed.own,
    slowed: VOICE_TEXT.slowed(card.path, SPEED_TOKEN),
  })
    .map(([key, said]) => ` data-${key}="${esc(said)}"`)
    .join("");
  const status = `<p class="speed-status" role="status"></p>`;
  return `<fieldset class="speeds" hidden${words}>${legend}<div class="speed-choices">${choices.join("")}</div>${status}</fieldset>`;
}

/**
 * What is said of a recording, in a list a screen reader counts: its length (for a screen reader,
 * the word that names it comes first), the sound the recorder lost by falling behind when it lost
 * any, and its file's size and SHA-256. A record is data, so a length or a lost time that isn't a
 * number is left unsaid, never shown as one.
 */
function facts(record: KeptVoice): string {
  const items: string[] = [];
  if (isNumber(record.seconds) && record.seconds >= 0) {
    const label = `<span class="sr">${esc(VOICE_TEXT.lengthLabel)} </span>`;
    items.push(`<li>${label}${esc(VOICE_TEXT.length(record.seconds))}</li>`);
  }
  if (isNumber(record.lostMs) && record.lostMs > 0) {
    items.push(`<li>${esc(VOICE_TEXT.lost(record.lostMs))}</li>`);
  }
  items.push(`<li>${lineHtml(VOICE_TEXT.file(record.bytes, record.sha256))}</li>`);
  // role="list": with its markers taken away, some screen readers (VoiceOver) drop its list role.
  return `<ul class="voice-facts" role="list">${items.join("")}</ul>`;
}

/**
 * A section's link to its page's full transcript on the shareable page beside this one, in a
 * paragraph of its own as the shareable page's line on a recording is: the text of what the
 * recording says. It's relative, by the shareable page's name (`page`), at the id of the fold that
 * holds the transcript, which the page's script opens. A page with no fold there (no run read it in
 * full) has no transcript and no link. The words the link shows are whole and first in its name, and
 * its page's follow them for a screen reader alone, in the page's visually hidden class (`sr`), so
 * that the name holds the label (WCAG 2.5.3) and no two links read alike.
 */
function transcriptLink(card: PageCard, page: string, folds: ReadonlySet<string>): string {
  if (!folds.has(card.slug)) return "";
  const { transcript } = VOICE_TEXT;
  const words = `${esc(transcript.link)}<span class="sr">${esc(transcript.of(card.path))}</span>`;
  return `<p class="sub"><a href="${esc(page)}#${esc(transcriptAnchor(card.slug))}">${words}</a></p>`;
}

/**
 * A page's section: its card, as the shareable page's cards are, with a player or the reason, and,
 * last, its link to the page's transcripts.
 */
function sectionOf(
  { card, number, source, voice }: Section,
  latest: RunJson | null,
  link: { page: string; folds: ReadonlySet<string> },
): string {
  const body =
    "why" in voice
      ? [notRecorded(voice.why)]
      : [player(card, voice.source.page, voice.bytes), speeds(card), facts(voice.record)];
  const parts = [
    heading(card, number),
    originLine(source, latest),
    ...body,
    transcriptLink(card, link.page, link.folds),
  ];
  return `<article class="card" id="${voiceAnchor(card.slug)}">\n  <div class="card-body">\n    ${parts.filter((part) => part !== "").join("\n    ")}\n  </div>\n</article>`;
}

/**
 * The page's top, built as the shareable page's is (its markup and classes, so it looks and switches
 * alike): the line above the name, with the button the page's script wires up for the theme; the
 * site's canonical name as the headline; the name set for the site, when one is; when the latest run
 * began; the lead; and who made the page and when. The lead is this page's own, and there's no
 * address and no button to open folds, as the page has none.
 */
function top(model: ShareModel): string {
  const { header } = model;
  const tested = testedLine(header);
  const meta = [
    `<span>${esc(TOP_TEXT.asOf)} <b>${esc(header.asOf)}</b></span>`,
    ...(header.preparedBy === null
      ? []
      : [`<span>${esc(TOP_TEXT.preparedBy)} <b>${esc(header.preparedBy)}</b></span>`]),
    `<span>${esc(TOP_TEXT.madeWith)} <a href="${esc(TOP_TEXT.github)}">${esc(TOP_TEXT.madeWithLink)}</a></span>`,
  ];
  return [
    `<header class="mast">`,
    `  <div class="mast-top">`,
    `    <div class="eyebrow">${esc(VOICE_TEXT.eyebrow)}</div>`,
    `    <div class="chips"><button class="theme" id="theme-toggle" type="button" hidden>Light version</button></div>`,
    `  </div>`,
    `  <h1>${esc(header.name)}</h1>`,
    ...(header.siteName === null ? [] : [`  <p class="mast-site">${esc(header.siteName)}</p>`]),
    ...(tested === null ? [] : [`  <p class="mast-tested">${esc(tested)}</p>`]),
    `  <p class="mast-lead">${esc(VOICE_TEXT.lead)}</p>`,
    `  <div class="mast-meta">${meta.join("")}</div>`,
    `</header>`,
  ].join("\n");
}

/**
 * The check, as the shareable page's evidence draws it (its elements, which the check's script
 * finds by their ids): what a fingerprint is, its two buttons, its result, its list of every file
 * checked, what it proves (this page's own words), and, where the buttons would be for a page read
 * without scripts, how to check without them. Then its data, which never runs.
 */
function checks(model: ShareModel, data: CheckData): string {
  const verify = model.evidence[0]?.verify ?? "voicecap verify";
  const parts = [
    `<p class="fp-what">${lineHtml(firstSentenceBold(EVIDENCE_TEXT.fingerprint))}</p>`,
    EXACT_COPIES,
    CHECK_BUTTONS,
    CHECK_RESULT,
    checkedList(),
    `<p class="sub fp-limit">${lineHtml(VOICE_TEXT.check.proves(verify))}</p>`,
    NO_SCRIPT,
  ];
  return [
    `<section aria-labelledby="check-h">`,
    `  <h2 id="check-h">${esc(VOICE_TEXT.check.title)}</h2>`,
    `  <div class="fp-check">\n    ${parts.join("\n    ")}\n  </div>`,
    `  <script type="application/json" id="fp-data">${checkDataJson(data)}</script>`,
    `</section>`,
  ].join("\n");
}

/**
 * What voicecap is, with the link; when the page was made, with its offset from UTC and the offsets
 * the runs recorded their times in; and the shareable page this one belongs to, and its Word copy,
 * by their file names. The voice page's own name is the shareable page's stem with `.voice.html`,
 * which the share chooses and gives the model (`voicePage`), so the page and the report's details
 * link to it; the page itself has no need to say it.
 */
function footer(model: ShareModel): string {
  const { fileName, wordName } = model.footer;
  return [
    `<footer>`,
    `  <span>${lineHtml([`${ABOUT} `, { text: FOOTER_TEXT.address, href: TOP_TEXT.github }])}</span>`,
    `  <span>${esc(generatedLine(model.footer))}</span>`,
    `  <span>${lineHtml(VOICE_TEXT.footer(fileName, wordName))}</span>`,
    `</footer>`,
  ].join("\n");
}

/**
 * The voice page's own script, plain browser JavaScript (ES2017, no imports), held as a string as
 * the shareable page's is. It follows the page's script and the check's in the page's one `<script>`
 * (so, as theirs do, it starts and ends on a new line), and keeps its names inside one function,
 * which holds the stretcher's library (STRETCH_LIBRARY) too. It does one thing: it gives each speed
 * choice its work, and shows it.
 * - 1× is the recording as recorded: the section's first player, which holds it as its address,
 *   and which this script never changes, so the check reads it as it was. A slower speed is a copy
 *   of the recording at that speed, which a second player shows in the first one's place. That
 *   player is made the first time a copy is shown, right after the first, with its controls and
 *   none of the first's names (`data-slug`, `data-file`), and is named for its page and speed
 *   (`data-slowed`); until then the page has its first players alone.
 * - The copy is made when its speed is chosen, while the player in view carries on, and the status
 *   line says that it's being made (`data-making`) and then that it's ready (`data-made`). The
 *   first player's address is decoded to samples at the stretcher's rate (`decodeAudioData`, on an
 *   `OfflineAudioContext`), the stretcher makes the copy in slices of about 20 ms of work with the
 *   page free between them, and then the finisher filters the copy, scales it to the recording's
 *   loudness, and writes it as a WAV file, in slices of the same size: the stretch, the filter, the
 *   loudness match, and the file are all done in slices of about 20 ms, however long the recording,
 *   apart from two closing steps of under 0.1 s each (the stretcher's last call, which evens out
 *   the whole copy, and the `Blob` made of the whole file). The second player plays the file from
 *   a `blob:` address. Nothing else of a copy's making is kept, as the stretcher is let go when the
 *   finishing begins, and the decoded recording with it. A choice made while a copy is being made
 *   drops that copy and starts the one chosen: each slice first checks that its copy is still the
 *   choice made last, so the last choice wins, and a copy finished for an earlier choice never
 *   takes the place of the one chosen last.
 * - The copies are kept for the visit, so a speed made once is shown again at once, but on the page
 *   as a whole at most 4 are: a list of them in the order they were shown, to the end of which a
 *   copy made or shown again goes. While there are more than 4, the one shown longest ago that
 *   isn't in view (a visible second player's address) is let go of: its address is revoked and
 *   it's out of its section's copies, so choosing that speed again makes it anew. A copy in view
 *   is never let go of, and each section can have one, so the page holds more than 4 while more
 *   than 4 sections show one.
 * - The place in the speech is the player in view's `currentTime` times its speed (1 for the first
 *   player); the player shown is put at that place divided by its own speed. If the player in view
 *   was playing it's paused, and the one shown plays on; if it wasn't, nothing plays. If it had the
 *   focus (a person had the keyboard on it) the one shown has it, without scrolling, so that a key,
 *   to pause it, still reaches the player in view and never falls to the page.
 * - Where the browser can't decode a recording or make its copy (it has no `OfflineAudioContext`,
 *   `decodeAudioData` refuses the recording, or making the copy throws), that section slows the
 *   recording the browser's own way for the rest of the visit, and its status line says so
 *   (`data-own`). A browser that can't decode is ordinary, and falls back without a word; a throw
 *   from voicecap's own work (its stretcher, its finisher, or the copy's file and address) is not:
 *   its error is written to the console first, as an error in the wiring is, so that the fallback
 *   never hides it. A choice then sets the first player's speed (`playbackRate`) and its pitch kept
 *   (`preservesPitch`, set on each time, never left to the browser's default), and the speed it
 *   keeps if the browser loads the file again (`defaultPlaybackRate`). A browser throws for a speed
 *   it won't play at (Chromium, for one outside 0.0625 to 16): the player stays as it was, and the
 *   choice shows that, so a refusal is never left looking like a speed the player is at. Every
 *   other section carries on as it was.
 * - The choice follows the player: it shows the speed chosen while the player in view is at its
 *   normal speed, and none while it isn't (the browser's own controls have a menu for the speed);
 *   where the browser slows the recording itself it shows the speed the player is at, and none when
 *   that's a speed the page doesn't offer. The page starts with each player at 1×, with its pitch
 *   kept, set as a choice is, and the choice showing it: a browser that loads a page again may
 *   bring back the button a person chose, while the player starts over.
 * - Each choice starts hidden, since it does nothing without this script, and the script shows it;
 *   a page whose markup isn't there is left alone, and the script uses nothing of the window until
 *   a choice is made.
 * Nothing here plays by itself: a copy plays only where the player in view was playing.
 */
export const VOICE_SCRIPT = String.raw`
(function () {
  "use strict";
${STRETCH_LIBRARY}
// A player's speed, its pitch kept; a browser throws for a speed it won't play at.
function pace(sound, rate) {
  try {
    sound.preservesPitch = true;
    sound.playbackRate = rate;
    sound.defaultPlaybackRate = rate;
  } catch (error) {
    // The browser won't play at this speed: the player stays as it was.
  }
}
// A player's recording as samples at VOICE_RATE; fail() where it can't be decoded.
function decode(sound, done, fail) {
  new Promise(function (resolve, reject) {
    var text = atob(sound.getAttribute("src").split(",")[1]), bytes = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    var Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var asked = new Context(1, 1, VOICE_RATE).decodeAudioData(bytes.buffer, resolve, reject);
    if (asked && asked.then) asked.then(resolve, reject);
  }).then(function (buffer) { done(buffer.getChannelData(0)); }, fail);
}
// An error of voicecap's own to the console, so the fallback it leads to doesn't hide it.
function report(error) {
  if (window.console) window.console.error(error);
}
// A copy at this speed, made in slices of about 20 ms, as the address of its WAV file: the stretch,
// then the finish (the filter, the loudness, the file). A slice that finds it's no longer wanted stops.
// Where this work throws, the error goes to the console and fail() is called.
function slow(signal, speed, current, done, fail) {
  if (!current()) return;
  var level, made, finish = null;
  try { level = voiceRms(signal); made = voiceStretcher(signal, speed); } catch (error) { report(error); return fail(); }
  // One step: 8 frames of the stretch; when it's whole, the finish begins with the stretcher let go,
  // and goes on in steps of 16384 samples.
  function step() {
    if (!made) return finish.next(16384);
    if (made.next(8)) {
      finish = voiceFinisher(made.output, level);
      made = null;
    }
    return false;
  }
  function slice() {
    if (!current()) { made = finish = null; return; }
    var address = "", finished, start = performance.now();
    try {
      finished = step();
      while (!finished && performance.now() - start < 20) finished = step();
      if (finished) address = URL.createObjectURL(new Blob([finish.wav], { type: "audio/wav" }));
    } catch (error) { made = finish = null; report(error); return fail(); }
    if (!finished) { setTimeout(slice, 0); return; }
    finish = null;
    done(address);
  }
  slice();
}
// The copies kept on the page, in the order they were shown (the latest last), as { section, speed,
// url }, where a section is its own copies by speed.
var copies = [];
// Whether a second player in view has this address.
function inView(url) {
  var seconds = document.querySelectorAll("audio:not([data-file])");
  return Array.prototype.some.call(seconds, function (player) {
    return !player.hidden && player.src === url;
  });
}
// Keeps a copy as the one shown last. While there are more than 4, the one shown longest ago that
// isn't in view is let go of: its address revoked, and it's out of its section's copies.
function keep(section, speed, url) {
  copies = copies.filter(function (each) { return each.url !== url; });
  copies.push({ section: section, speed: speed, url: url });
  var spare = copies.filter(function (each) { return !inView(each.url); });
  while (copies.length > 4 && spare.length) {
    var gone = spare.shift();
    copies.splice(copies.indexOf(gone), 1);
    URL.revokeObjectURL(gone.url);
    delete gone.section[gone.speed];
  }
}
// One speed choice's work: its players, copies, status line, and radios.
function wire(group) {
  var card = group.closest("article"), sound = card ? card.querySelector("audio[data-file]") : null;
  var status = group.querySelector(".speed-status"), radios = group.querySelectorAll('input[type="radio"]');
  if (!sound || !status) return;
  // State: the second player, the copies by speed, the speed in view (1 is the first player), the
  // speed chosen, the choice's number, and whether this browser slows the recording itself.
  var copy = null, kept = {}, shown = 1, chosen = 1, job = 0, fallen = false;
  function view() { return shown === 1 ? sound : copy; }
  function said(key, label) { return (group.dataset[key] || "").split("${SPEED_TOKEN}").join(label); }
  // The radios show the chosen speed, or none if the player in view is at another rate.
  function mark() {
    var rate = view().playbackRate, speed = fallen ? rate : Math.abs(rate - 1) < 0.001 ? chosen : 0;
    for (var i = 0; i < radios.length; i++) radios[i].checked = Math.abs(Number(radios[i].value) - speed) < 0.001;
  }
  // Puts a player in view at the place in the speech, in place of the one in view: it plays on if
  // that was playing, and has the focus (without scrolling) if that had it.
  function put(player, speed, address) {
    var from = view(), at = from.currentTime * shown, playing = !from.paused;
    var focused = document.activeElement === from;
    if (player !== from) { if (playing) from.pause(); from.hidden = true; }
    if (address) player.src = address;
    if (address || player !== from) player.currentTime = at / speed;
    player.hidden = false;
    if (focused && player !== from) player.focus({ preventScroll: true });
    shown = speed;
    var started = playing ? player.play() : null;
    if (started && started.catch) started.catch(function () {});
  }
  // Shows the copy at this speed in the second player, made the first time, after the first.
  function showCopy(speed, label) {
    if (!copy) {
      copy = document.createElement("audio");
      copy.controls = true;
      copy.preload = "auto";
      copy.addEventListener("ratechange", mark);
      sound.parentNode.insertBefore(copy, sound.nextSibling);
    }
    copy.setAttribute("aria-label", said("slowed", label));
    put(copy, speed, kept[speed]);
    keep(kept, speed, kept[speed]);
    status.textContent = said("made", label);
    mark();
  }
  // Shows the first player at this speed: 1x as recorded, any other the browser's own way.
  function first(speed) {
    put(sound, 1);
    pace(sound, speed);
    status.textContent = speed === 1 ? "" : said("own");
    mark();
  }
  group.addEventListener("change", function (event) {
    var radio = event.target;
    if (!radio || !radio.checked) return;
    var speed = Number(radio.value), label = radio.parentNode.textContent.trim(), mine = ++job;
    function current() { return job === mine; }
    // Where the copy can't be made, this section slows the recording itself from now on.
    function failed() { if (current()) { fallen = true; first(speed); } }
    chosen = speed;
    if (speed === 1 || fallen) first(speed);
    else if (kept[speed]) showCopy(speed, label);
    else {
      status.textContent = said("making", label);
      decode(sound, function (signal) {
        slow(signal, speed, current, function (address) {
          kept[speed] = address;
          showCopy(speed, label);
        }, failed);
      }, failed);
    }
  });
  sound.addEventListener("ratechange", mark);
  first(1); // The page starts at 1x, as a choice of it leaves the player.
  group.hidden = false;
}
Array.prototype.forEach.call(document.querySelectorAll("fieldset.speeds"), function (group) {
  try {
    wire(group);
  } catch (error) {
    report(error);
  }
});
})();
`;

/**
 * The voice page from the model and the recordings the loader holds (by run id and page slug,
 * "2026-09-29_1402/home", each only as its record has it), as one file; null when no page has a
 * recording to play, since there's then nothing for a page to be: a run's recordings are written
 * with its share only when it has one. `assets.fontCss` is the fonts' `@font-face` rules
 * (fontFaceCss in ./fonts.ts), which the page's style block holds ahead of its own styles. It's
 * required, as the shareable page's is, so a page that forgot its fonts can't be written (give ""
 * for the reader's own fonts). Pure.
 */
export function renderVoicePage(
  model: ShareModel,
  recordings: ReadonlyMap<string, Uint8Array>,
  assets: { fontCss: string },
): string | null {
  const { sources, latest } = sourcesOf(model);
  const latestVersion = latest === null ? null : versionOf(latest);
  // The pages whose transcripts the shareable page folds into their cards: every page with a run
  // that read it in full, as that page's own list of transcripts says (the model's `appendix`).
  const folds: ReadonlySet<string> = new Set(model.appendix.map((entry) => entry.slug));
  const recordedAny = new Map<RunJson, boolean>();
  const sections = model.pages.map((card, index): Section => {
    const source = sources.get(card.key) ?? null;
    return {
      card,
      number: index + 1,
      source,
      voice: voiceOf(source, latestVersion, recordings, recordedAny),
    };
  });
  const played = sections.flatMap(({ voice }) => ("why" in voice ? [] : [voice]));
  if (played.length === 0) return null;

  // What the check checks: the recordings the page plays, and the sealed record of each run they
  // and the reasons are from, exactly as recorded, once, oldest first (the model's order).
  // The latest run too, though every section may be from an older one: the page says what it says
  // of when the report was tested, and which run each recording is from, by that run's record.
  const used = new Set([
    ...sections.flatMap(({ source }) => (source === null ? [] : [source.run.id])),
    ...(latest === null ? [] : [latest.id]),
  ]);
  const data: CheckData = {
    runs: model.check.runs.filter((run) => used.has(run.id)),
    files: [],
    screenshots: [],
    axe: [],
    recordings: played.map(({ source }) => ({
      run: source.run.id,
      slug: source.page.slug,
      name: VOICE_FILE,
    })),
    reviews: null,
  };
  const { header } = model;
  const title = VOICE_TEXT.title(header.name, header.testedAt ?? header.asOf);
  const pages = [
    `<section id="pages" aria-labelledby="pages-h">`,
    `  <h2 id="pages-h">${esc(PAGES_TEXT.title)}</h2>`,
    `  <p class="gist">${esc(VOICE_TEXT.note)}</p>`,
    `  <div class="cards">`,
    sections
      .map((section) => sectionOf(section, latest, { page: model.footer.fileName, folds }))
      .join("\n"),
    `  </div>`,
    `</section>`,
  ].join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<style>\n${assets.fontCss}\n${SHARE_CSS}${VOICE_CSS}</style>`,
    "</head>",
    "<body>",
    '<a class="skip" href="#main">Skip to main content</a>',
    '<div class="wrap">',
    top(model),
    '<main id="main">',
    pages,
    checks(model, data),
    "</main>",
    footer(model),
    "</div>",
    `<script>${SHARE_SCRIPT}${CHECK_SCRIPT}${VOICE_SCRIPT}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
