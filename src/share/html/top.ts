/**
 * The first three parts of the shareable page, in the approved mockup's markup and class names:
 * the top (the header), the Summary, and "How voicecap works". They are open: nothing in them is
 * folded. Each takes the model and returns HTML.
 *
 * What the model or a record supplies goes through `esc`; so does the fixed text (../text.ts),
 * which is plain words. The page's own static words are written as they are. No `style` attribute
 * is set (bars and pictures are SVG, sized and colored by attributes and classes), and the only
 * links are to voicecap's GitHub page, NV Access, and the page's own sections.
 *
 * Where the mockup is sample data, nothing of it is here. Where it set a style attribute, the
 * page's style block gives the same look instead: the second line under the summary's sentence
 * (`.verdict + .gist`) and the caption under the sample of what NVDA said (`.heard > .sub`) each
 * need a margin rule.
 */
import type { PassName } from "../../model.js";
import { esc, idFragment, plural } from "../../report/html.js";
import { formatDuration } from "../../util/time.js";
import type { ShareModel } from "../model.js";
import type { Summary } from "../summary.js";
import { HOW_LEAD, HOW_STEPS, WHEN_TO_RUN } from "../text.js";
import { STEP_ICONS } from "./icons.js";
import { bar, count, notRecorded, track } from "./parts.js";

const GITHUB = "https://github.com/ICJIA/voicecap";
const NV_ACCESS = "https://www.nvaccess.org/";

// The top.

/** "tested on 29 September 2026", or "tested from 29 to 30 September 2026" for more than a day. */
function testedPhrase(tested: string): string {
  return `${tested.includes(" to ") ? "tested from" : "tested on"} ${esc(tested)}`;
}

/**
 * The page's header: the site's name as the headline, two plain lines on what the page is, who
 * and when, the site's address, and the two buttons the page's script wires up.
 *
 * The buttons do nothing without the script, so they start hidden and the script shows them. The
 * theme's says what it switches to ("Light version", then "Dark version"), so it has no pressed
 * state: one that changed with its words would say "pressed" of the theme it no longer names.
 *
 * When no run counts there is no date to give, so the line says so, and says what voicecap does
 * rather than what it did: no run that counts took the screen reader through any page.
 */
export function renderTop(model: ShareModel): string {
  const { header } = model;
  const { tested } = header;
  const reader = esc(header.screenReader);
  const readerLink = header.screenReader === "NVDA" ? `<a href="${NV_ACCESS}">NVDA</a>` : reader;
  const dated =
    tested === null
      ? ". No live run counts yet, so there's no test date."
      : `, ${testedPhrase(tested)}.`;
  const meta = [
    `<span>As of <b>${esc(header.asOf)}</b></span>`,
    ...(header.preparedBy === null
      ? []
      : [`<span>Prepared by <b>${esc(header.preparedBy)}</b></span>`]),
    `<span>Made with <a href="${GITHUB}">voicecap</a></span>`,
    `<span class="addr">Site address ${esc(header.site)}</span>`,
  ];
  return [
    `<header class="mast">`,
    `  <div class="mast-top">`,
    `    <div class="eyebrow">Screen reader test results</div>`,
    `    <div class="chips"><button class="theme" id="open-all" type="button" hidden>Open every section</button><button class="theme" id="theme-toggle" type="button" hidden>Light version</button></div>`,
    `  </div>`,
    `  <h1>${esc(header.siteName)}</h1>`,
    `  <p class="mast-lead">How its pages read aloud with ${readerLink}, a free screen reader${dated} voicecap ${tested === null ? "takes" : "took"} ${reader} through every page, pressing its keys the way a person would. Every word shown here is what ${reader} said.</p>`,
    `  <div class="mast-meta">${meta.join("")}</div>`,
    `</header>`,
  ].join("\n");
}

// The summary.

/** A tile's tone: complete is "ok", a flag or a gap "warn", a plain count "quiet". */
type Tone = "ok" | "warn" | "quiet";

const tile = (tone: Tone, big: string, label: string): string =>
  `<div class="tile ${tone}"><span class="n">${big}</span><span class="k">${esc(label)}</span></div>`;

/** "7/7" as it looks in a tile, and "7 of 7" as a screen reader says it. */
const fraction = (part: number, whole: number): string =>
  `${count(part)}<small aria-hidden="true">/${count(whole)}</small><span class="sr"> of ${count(whole)}</span>`;

/** How a unit of `formatDuration` is said, in the singular and the plural. */
const UNITS: Record<string, [string, string]> = {
  ms: ["millisecond", "milliseconds"],
  s: ["second", "seconds"],
  m: ["minute", "minutes"],
  h: ["hour", "hours"],
  d: ["day", "days"],
};

/** "12m 34s" in a tile with its units small, and "12 minutes 34 seconds" for a screen reader. */
function duration(ms: number): string {
  const text = formatDuration(ms);
  const looks = text.replace(/(\d+)([a-z]+)/g, "$1<small>$2</small>");
  const said = text.replace(/(\d+)([a-z]+)/g, (_, amount: string, unit: string) => {
    const [one, many] = UNITS[unit] ?? [unit, unit];
    return `${amount} ${Number(amount) === 1 ? one : many}`;
  });
  return `<span aria-hidden="true">${looks}</span><span class="sr">${said}</span>`;
}

/**
 * The six numbers. A count out of its total is in the tone of whether it's complete; the page
 * says each in words, never by tone alone.
 */
function tiles(model: ShareModel): string {
  const { numbers } = model.summary;
  const { pagesInScope, transcribed, flagged, rules, listened, linesSpoken, nvdaMs } = numbers;
  const { sessionsWithoutEnd: uncounted } = numbers;
  const left =
    uncounted === 0
      ? ""
      : `; ${plural(uncounted, "session")} without a recorded end ${uncounted === 1 ? "isn't" : "aren't"} counted`;
  const flagsLabel = `${flagged === 1 ? "page" : "pages"} with flags${flagged > 0 ? `, ${plural(rules, "rule")}` : ""}`;
  const transcribedTone =
    pagesInScope === 0 ? "quiet" : transcribed === pagesInScope ? "ok" : "warn";
  return `<div class="tiles">${[
    tile("quiet", count(pagesInScope), pagesInScope === 1 ? "page in scope" : "pages in scope"),
    tile(transcribedTone, fraction(transcribed, pagesInScope), "transcribed by NVDA"),
    tile(flagged > 0 ? "warn" : "quiet", count(flagged), flagsLabel),
    tile(
      transcribed > 0 && listened === transcribed ? "ok" : "quiet",
      fraction(listened, transcribed),
      "listened to live by a person",
    ),
    tile("quiet", count(linesSpoken), linesSpoken === 1 ? "line NVDA spoke" : "lines NVDA spoke"),
    tile(
      "quiet",
      duration(nvdaMs),
      `of NVDA time, across ${plural(model.evidence.length, "run")}${left}`,
    ),
  ].join("")}</div>`;
}

/** "What needs attention": each page, linked to its card, with what a listener hears on it. */
function attentionPanel({ attention }: Summary): string {
  if (attention.length === 0) {
    return `<div class="panel"><h3>What needs attention</h3><p>No page has flags or an open issue.</p></div>`;
  }
  const lines = attention.map(({ slug, name, clauses }) => {
    const link = `<a href="#pg-${idFragment(slug)}"><b>${esc(name)}</b></a>`;
    return `<p>${link}${clauses === "" ? "" : `: ${esc(clauses)}.`}</p>`;
  });
  return `<div class="panel attention"><h3>What needs attention</h3>${lines.join("")}</div>`;
}

/**
 * "How complete the test was": the model's lines, with a way to the problems beside the line that
 * says them, and the run before's line, when there is one, last.
 */
function completePanel(model: ShareModel): string {
  const { complete, changesLine } = model.summary;
  const items = complete.map(
    (line) =>
      `<li>${esc(line)}${line === model.problems.line ? ' <a href="#prob-h">What happened</a>' : ""}</li>`,
  );
  if (changesLine !== null) {
    items.push(`<li>${esc(changesLine)} <a href="#chg-h">What changed</a></li>`);
  }
  return `<div class="panel"><h3>How complete the test was</h3><ul>${items.join("")}</ul></div>`;
}

function todoPanel({ todo }: Summary): string {
  const items = todo.map((line) => `<li>${esc(line)}</li>`);
  return `<div class="panel"><h3>What's still to do</h3><ul>${items.join("")}</ul></div>`;
}

function whenHowPanel({ whenHow }: Summary): string {
  const items = whenHow.map(({ label, value }) => `<li><b>${esc(label)}</b>: ${esc(value)}</li>`);
  return `<div class="panel"><h3>When and how</h3><ul>${items.join("")}</ul></div>`;
}

/** "Every page's latest result": no flags, flags, and never transcribed, as one bar. */
function resultsMeter({ bars }: Summary): string {
  const { done, flagged, never } = bars.results;
  const caption = (
    [
      [done, "without flags"],
      [flagged, "with flags"],
      [never, "never transcribed"],
    ] as const
  )
    .filter(([pages]) => pages > 0)
    .map(([pages, what]) => `${plural(pages, "page")} ${what}`)
    .join(", ");
  const segments = [
    { label: "no flags", value: done, kind: "ok" },
    { label: "flags", value: flagged, kind: "warn" },
    { label: "never transcribed", value: never, kind: "bad" },
  ];
  const html = bar(segments, done + flagged + never, caption === "" ? "No pages" : caption);
  return `<div class="meter"><h3>Every page's latest result</h3>${html}</div>`;
}

/**
 * "Flags by rule": a row for each rule, as long as its count is against the most. A rule's count is
 * how many times it was raised, once for each page and pass.
 */
function rulesMeter({ bars }: Summary): string {
  const { flagsByRule } = bars;
  const most = flagsByRule.reduce((top, { count: times }) => Math.max(top, times), 0);
  const rows = flagsByRule.map(
    ({ rule, count: times }) =>
      `<div class="rule"><span class="mono">${esc(rule)}</span>${track(times, most, "warn")}<span class="c">${count(times)}</span></div>`,
  );
  const body =
    rows.length === 0
      ? '<p class="sub">No flags were raised.</p>'
      : `<div class="rules">${rows.join("")}</div>`;
  return `<div class="meter"><h3>Flags by rule <span class="sub">times each rule was raised, across pages and passes</span></h3>${body}</div>`;
}

/** A count out of its total in a row: "3/3" as it looks, and "3 of 3" as a screen reader says it. */
const tally = (part: number, whole: number): string =>
  `<span class="c"><span aria-hidden="true">${count(part)}/${count(whole)}</span><span class="sr">${count(part)} of ${count(whole)}</span></span>`;

/** "The human review": each count out of its total, so nothing looks complete that isn't. */
function reviewMeter({ bars }: Summary): string {
  const rows: [string, [number, number]][] = [
    ["Listened to live", bars.review.listened],
    ["Transcripts reviewed", bars.review.reviewed],
    ["Issues fixed", bars.review.fixed],
  ];
  const html = rows.map(([label, [part, whole]]) => {
    const tone = part >= whole ? "ok" : "warn";
    return `<div class="rule"><span>${label}</span>${track(part, whole, tone)}${tally(part, whole)}</div>`;
  });
  return `<div class="meter"><h3>The human review <span class="sub">each out of its total</span></h3><div class="rules">${html.join("")}</div></div>`;
}

/** The later sections, in page order: each h2's id, and the words that link to it. */
const CONTENTS = [
  ["how-h", "How voicecap works"],
  ["pages-h", "Every page"],
  ["find-h", "What the flags found"],
  ["chg-h", "What changed since the last run"],
  ["prob-h", "Problems during the runs"],
  ["lim-h", "What these results cover"],
  ["ev-h", "The evidence"],
  ["story-h", "How voicecap came to be"],
  ["app-h", "Every transcript"],
] as const;

function contents(): string {
  const links = CONTENTS.map(([id, words]) => `<a href="#${id}">${words}</a>`);
  return `<nav class="toc" aria-label="The full report"><span class="sub">Read the full report:</span>${links.join("")}</nav>`;
}

/**
 * The Summary, written for a manager who reads nothing else: the result in a sentence, and the line
 * on what voicecap and the person each did; six numbers; four panels; three bars; and the way
 * into the rest.
 *
 * When no run counts, the summary has no pages to count: only its sentence, which says why, and
 * the way into the rest.
 */
export function renderSummary(model: ShareModel): string {
  const { summary } = model;
  const opening = [
    `<div>`,
    `    <h2 id="glance-h">Summary</h2>`,
    `    <p class="lead verdict">${esc(summary.sentence)}</p>`,
    `    <p class="gist">${esc(summary.second)}</p>`,
    `  </div>`,
  ].join("\n");
  const parts =
    model.header.tested === null
      ? [opening, contents()]
      : [
          opening,
          tiles(model),
          `<div class="panels">${[attentionPanel(summary), completePanel(model), todoPanel(summary), whenHowPanel(summary)].join("")}</div>`,
          `<div class="meters">${[resultsMeter(summary), rulesMeter(summary), reviewMeter(summary)].join("")}</div>`,
          contents(),
        ];
  return `<section class="glance" aria-labelledby="glance-h">\n  ${parts.join("\n  ")}\n</section>`;
}

// How voicecap works.

/** The lead's first words, which the mockup sets in bold: that a person listens along. */
const LISTENS = "The person running it listens along,";

function lead(): string {
  return esc(HOW_LEAD).replace(LISTENS, (found) => `<b>${found}</b>`);
}

/** The six steps, each with its picture, in order. */
function steps(): string {
  const items = HOW_STEPS.map(
    (step, index) =>
      `<li><span class="ico" aria-hidden="true">${STEP_ICONS[step.icon]}</span><h3><span class="step-n">${index + 1}<span class="sr">.</span></span> ${esc(step.title)}</h3><p>${esc(step.text)}</p></li>`,
  );
  return `<ol class="flow" role="list">${items.join("")}</ol>`;
}

/**
 * The key each pass presses, and what it goes by: the keys NVDA's users press. Each key is named
 * in words. The mockup drew the first as an arrow, which a screen reader says twice ("downwards
 * arrow, Down Arrow"), and axe can't check the contrast of a character that isn't text.
 */
const WAYS: Record<PassName, { key: string; words: string }> = {
  read: { key: "Down Arrow", words: "line by line" },
  headings: { key: "H", words: "heading by heading" },
  tab: { key: "Tab", words: "control by control" },
};

/** How many ways through the page the sample has, in words. */
const HOW_MANY = ["no ways", "one way", "two ways", "three ways"];

/**
 * A sample of what NVDA said on this site: the first lines of each pass on its home page, as the
 * transcripts shown have them, each with how long it took. Without a sample (no home page with
 * transcripts, or none whose lines can be read), it says so.
 */
function heard(sample: ShareModel["heard"]): string {
  if (sample === null) {
    return `<div class="heard"><h3>Heard on this site</h3>${notRecorded("Not recorded: no sample of the home page's lines is available.")}</div>`;
  }
  const lanes = sample.passes.map(({ pass, lines }) => {
    const { key, words } = WAYS[pass];
    const said = lines.map(
      ({ text, took }) => `<li><span>“${esc(text)}”</span><span class="t">${esc(took)}</span></li>`,
    );
    return `<figure class="lane"><figcaption><kbd>${key}</kbd> ${words}</figcaption><ol class="said-list" role="list">${said.join("")}</ol></figure>`;
  });
  const ways = HOW_MANY[sample.passes.length] ?? HOW_MANY[3];
  return [
    `<div class="heard">`,
    `    <h3>Heard on this site: ${esc(sample.page)}, ${ways}</h3>`,
    `    <div class="lanes">${lanes.join("")}</div>`,
    `    <p class="sub">NVDA's own words: the first lines of each pass, from the transcripts below. Each time is how long that line took, which includes the wait for NVDA to finish speaking.</p>`,
    `  </div>`,
  ].join("\n");
}

/**
 * The band on when to run voicecap, as the fixed text has it: its headline and line read as one
 * passage, and the stage it stresses is set apart.
 */
function when(): string {
  const { headline, text, stages } = WHEN_TO_RUN;
  const colon = headline.indexOf(": ");
  const title =
    colon < 0
      ? esc(headline)
      : `${esc(headline.slice(0, colon + 2))}<span>${esc(headline.slice(colon + 2))}</span>`;
  const items = stages.map(
    (stage) =>
      `<li${stage.marked ? ' class="run"' : ""}><b>${esc(stage.title)}</b><span class="st">${esc(stage.text)}</span></li>`,
  );
  return [
    `<div class="when">`,
    `    <h3 class="when-title">${title}</h3>`,
    `    <p class="when-lead">${esc(text)}</p>`,
    `    <ol class="stages" role="list">${items.join("")}</ol>`,
    `  </div>`,
  ].join("\n");
}

/**
 * "How voicecap works": the lead, the six steps with their pictures, a sample of what NVDA said on
 * this site, and when to run voicecap.
 */
export function renderHow(model: ShareModel): string {
  return [
    `<section aria-labelledby="how-h">`,
    `  <h2 id="how-h">How voicecap works</h2>`,
    `  <p class="gist">${lead()}</p>`,
    `  ${steps()}`,
    `  ${heard(model.heard)}`,
    `  ${when()}`,
    `</section>`,
  ].join("\n");
}
