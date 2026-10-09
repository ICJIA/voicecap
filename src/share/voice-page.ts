/**
 * The voice page: the companion of the shareable page that plays what NVDA said aloud on each page,
 * from the recordings a run keeps of it (plan 11, from voicecap 0.18.0). It's one file, like the
 * shareable page: each recording is in it as a `data:audio/webm;base64,` address, in an audio
 * element, so it can be sent on its own, and a Content Security Policy can allow exactly what it
 * holds (one style block, one script, and the media its own addresses hold).
 *
 * The recording is evidence. The person's review is made from the transcripts, by reading what NVDA
 * said (NVDA speaks too fast to follow), so the page says so, and plays each recording at a speed a
 * person can follow: 1×, 0.75×, 0.5×, and 0.25×, with the pitch kept (`playbackRate`, and
 * `preservesPitch` set on, never left to the browser's default).
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
 * What the model or a record supplies goes through `esc`, a reason included: the recorder's own
 * words in a reason are text, with the home folder already replaced when the run recorded it. No
 * `style` attribute is set, and the only links are to the page's own parts and to voicecap's page.
 * Nothing is loaded from outside it, and nothing plays by itself.
 */
import { VOICE_FILE, type PageRecord, type RunJson, type VoiceRecord } from "../model.js";
import { esc, idFragment } from "../report/html.js";
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
import { lineHtml, notRecorded } from "./html/parts.js";
import { SHARE_CSS, VOICE_CSS } from "./html/style.js";
import { firstSentenceBold } from "./line.js";
import type { PageCard, ShareModel } from "./model.js";
import { voiceRecordOf } from "./records.js";
import { keepsVoice, notRecordedBy, sessionVersion, versionOf } from "./run-evidence.js";
import { standingOf } from "./standing.js";
import { ABOUT, EVIDENCE_TEXT, FOOTER_TEXT, PAGES_TEXT, TOP_TEXT, VOICE_TEXT } from "./text.js";
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

/** The id of a page's section, which the shareable page's card links to: `voice-` and its slug. */
export function voiceAnchor(slug: string): string {
  return `voice-${idFragment(slug)}`;
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
 * before voicecap recorded NVDA's voice (KEEPS_VOICE_FROM). From then on, either its run's driver
 * recorded none of its pages (a driver that can't), or this page wasn't read (it was skipped, or it
 * failed before it loaded). `recordedAny` remembers, by run, whether any page of it
 * has a record of a recording.
 */
function voiceOf(
  source: Source | null,
  latest: string | null,
  recordings: ReadonlyMap<string, Uint8Array>,
  recordedAny: Map<RunJson, boolean>,
): Voice {
  if (source === null) return { why: notRecordedBy(latest) };
  const { run, page } = source;
  const version = sessionVersion(run, page.session);
  const record = voiceRecordOf(page);
  if (record === "unreadable") return { why: VOICE_TEXT.unreadable };
  if (record === undefined) {
    if (!keepsVoice(version)) return { why: notRecordedBy(version) };
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

/**
 * A page's number and its name, as its card has them: its label with its address on the site beside
 * it, else its address on the site alone.
 */
function heading(card: PageCard, number: number): string {
  const named = card.labeled
    ? `${esc(card.name)} <span class="sub">${esc(card.path)}</span>`
    : esc(card.path);
  return `<h3><span class="num">${number}</span> ${named}</h3>`;
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
 * The speed choice: a group of radio buttons under the legend "Speed", 1× chosen, named for the page
 * for a screen reader alone. It sets the player's speed, and does nothing without the script, so it
 * starts hidden and the script shows it, as the check's buttons are. Every group has a name of its
 * own, which its page's slug makes.
 */
function speeds(card: PageCard): string {
  const { speed } = VOICE_TEXT;
  const name = `speed-${idFragment(card.slug)}`;
  const choices = speed.rates.map(
    (rate) =>
      `<label><input type="radio" name="${name}" value="${rate}"${rate === 1 ? " checked" : ""}> ${esc(speed.label(rate))}</label>`,
  );
  const legend = `<legend>${esc(speed.legend)}<span class="sr">${esc(speed.on(card.path))}</span></legend>`;
  return `<fieldset class="speeds" hidden>${legend}<div class="speed-choices">${choices.join("")}</div></fieldset>`;
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
  return `<ul class="voice-facts">${items.join("")}</ul>`;
}

/** A page's section: its card, as the shareable page's cards are, with a player or the reason. */
function sectionOf({ card, number, source, voice }: Section, latest: RunJson | null): string {
  const body =
    "why" in voice
      ? [notRecorded(voice.why)]
      : [player(card, voice.source.page, voice.bytes), speeds(card), facts(voice.record)];
  const parts = [heading(card, number), originLine(source, latest), ...body];
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
 * (so, as theirs do, it starts and ends on a new line and keeps its names inside one function), and
 * it does one thing: it gives each speed choice its work, and shows it.
 * - A choice sets its player's speed (`playbackRate`) and its pitch kept (`preservesPitch`, set on
 *   each time, never left to the browser's default), and the speed it keeps if the browser loads the
 *   file again (`defaultPlaybackRate`). A browser throws for a speed it won't play at (Chromium, for
 *   one outside 0.0625 to 16): the player stays as it was, and the choice shows that, so a refusal
 *   is never left looking like a speed the player is at.
 * - The choice follows the player: when something else changes its speed (the browser's own
 *   controls have a menu for it), the speed it's at is the one shown, and none is shown when it's at
 *   a speed the page doesn't offer. The page starts with each player at 1×, with its pitch kept, set
 *   as a choice is, and the choice showing it: a browser that loads a page again may bring back the
 *   button a person chose, while the player starts over.
 * - Each choice starts hidden, since it does nothing without this script, and the script shows it;
 *   a page whose markup isn't there is left alone.
 * Nothing here plays a sound.
 */
export const VOICE_SCRIPT = String.raw`
(function () {
  "use strict";
  function choose(group) {
    var card = group.closest("article");
    var sound = card ? card.querySelector("audio") : null;
    if (!sound) return;
    var radios = group.querySelectorAll('input[type="radio"]');
    function show() {
      Array.prototype.forEach.call(radios, function (radio) {
        radio.checked = Math.abs(Number(radio.value) - sound.playbackRate) < 0.001;
      });
    }
    function set(rate) {
      try {
        sound.preservesPitch = true;
        sound.playbackRate = rate;
        sound.defaultPlaybackRate = rate;
      } catch (error) {
        // The browser won't play at this speed: the player stays as it was.
      }
      show();
    }
    group.addEventListener("change", function (event) {
      var radio = event.target;
      if (radio && radio.checked) set(Number(radio.value));
    });
    sound.addEventListener("ratechange", show);
    set(1);
    group.hidden = false;
  }
  Array.prototype.forEach.call(document.querySelectorAll("fieldset.speeds"), function (group) {
    try {
      choose(group);
    } catch (error) {
      if (window.console) window.console.error(error);
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
  const used = new Set(sections.flatMap(({ source }) => (source === null ? [] : [source.run.id])));
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
    sections.map((section) => sectionOf(section, latest)).join("\n"),
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
