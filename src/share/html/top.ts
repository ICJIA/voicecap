/**
 * The first parts of the shareable page, in the approved mockup's markup and class names: the top
 * (the header), At a glance, and "How voicecap works"; and five parts of the details, which were
 * the Summary's panels and bars: What's still to do, How complete the test was, When and how, Flags
 * by rule, and The human review. They are open, but for the one fold: the sample of what NVDA said
 * in "How voicecap works". Each takes the model and returns HTML.
 *
 * What the model or a record supplies goes through `esc`; so does the fixed text (../text.ts),
 * which is plain words, and so does each line worked out from the model (../words.ts), through
 * `lineHtml`. No `style` attribute is set (bars and pictures are SVG, sized and colored by
 * attributes and classes), and the only links are to voicecap's GitHub page, NV Access, the site's
 * canonical address (when it has one), and the page's own sections.
 *
 * Where the mockup is sample data, nothing of it is here. Where it set a style attribute, the
 * page's style block gives the same look instead: the spacing of At a glance's parts, in its grid,
 * and the sign before the verdict (`.verdict::before`), which only repeats its words, so it is
 * drawn by the style with no alternative text, never put in the markup, where a character that is
 * no text fails axe's contrast check. The caption under the sample of what NVDA said is in its
 * fold, where a fold's own rule gives a paragraph none.
 */
import { esc } from "../../report/html.js";
import { formatDuration } from "../../util/time.js";
import type { ShareModel } from "../model.js";
import type { Summary } from "../summary.js";
import {
  ATTENTION_TEXT,
  DETAILS_TEXT,
  GLANCE_TEXT,
  HOW_STEPS,
  HOW_TEXT,
  PAGES_TEXT,
  SUMMARY_TEXT,
  TOP_TEXT,
  WHEN_TO_RUN,
} from "../text.js";
import { verdictOf } from "../verdict.js";
import {
  glanceNumbersOf,
  heardTitle,
  howLead,
  spokenDuration,
  testedLine,
  topLead,
  type NumberTile,
} from "../words.js";
import { STEP_ICONS } from "./icons.js";
import { count, fold, lineHtml, notRecorded, ring, track, type RingPart } from "./parts.js";

// The top.

/**
 * The site's address, last and small in the line of who and when. A site with a canonical address
 * shows its root, as a link a reader can open (a root is always a web address, and only one is
 * linked). Without one it shows the address voicecap read, as it was and as words only: it may be a
 * copy on the tester's computer, which a reader can't open, and it comes from a record, which can
 * hold any text.
 */
function siteAddress({ site, readFrom }: ShareModel["header"]): string {
  const address = esc(site);
  const linked = readFrom !== null && /^https?:\/\//i.test(site);
  const shown = linked ? `<a href="${address}">${address}</a>` : address;
  return `<span class="addr">${esc(TOP_TEXT.siteAddress)} ${shown}</span>`;
}

/**
 * The page's header, top to bottom: the line above the name, with the two buttons the page's script
 * wires up; the site's canonical name as the headline (the host voicecap read, for a site with no
 * canonical address); the name set for the site, when one is; the date and time the latest run
 * began; two plain lines on what the page is; who and when; and the site's address, last and small.
 *
 * The name set for the site and when it was tested are paragraphs, not headings: the name is the
 * page's one `h1`. The date and time are plain words, as every time on the page is.
 *
 * The buttons do nothing without the script, so they start hidden and the script shows them. The
 * theme's says what it switches to ("Light version", then "Dark version"), so it has no pressed
 * state: one that changed with its words would say "pressed" of the theme it no longer names.
 *
 * When no run counts there is no date to give, so there is no line for when it was tested, and the
 * lead says so (topLead).
 */
export function renderTop(model: ShareModel): string {
  const { header } = model;
  const tested = testedLine(header);
  const meta = [
    `<span>${esc(TOP_TEXT.asOf)} <b>${esc(header.asOf)}</b></span>`,
    ...(header.preparedBy === null
      ? []
      : [`<span>${esc(TOP_TEXT.preparedBy)} <b>${esc(header.preparedBy)}</b></span>`]),
    `<span>${esc(TOP_TEXT.madeWith)} <a href="${esc(TOP_TEXT.github)}">${esc(TOP_TEXT.madeWithLink)}</a></span>`,
    siteAddress(header),
  ];
  return [
    `<header class="mast">`,
    `  <div class="mast-top">`,
    `    <div class="eyebrow">${esc(TOP_TEXT.eyebrow)}</div>`,
    `    <div class="chips"><button class="theme" id="open-all" type="button" hidden>Open every section</button><button class="theme" id="theme-toggle" type="button" hidden>Light version</button></div>`,
    `  </div>`,
    `  <h1>${esc(header.name)}</h1>`,
    ...(header.siteName === null ? [] : [`  <p class="mast-site">${esc(header.siteName)}</p>`]),
    ...(tested === null ? [] : [`  <p class="mast-tested">${esc(tested)}</p>`]),
    `  <p class="mast-lead">${lineHtml(topLead(header))}</p>`,
    `  <div class="mast-meta">${meta.join("")}</div>`,
    `</header>`,
  ].join("\n");
}

// At a glance.

const tile = (tone: NumberTile["tone"], big: string, label: string): string =>
  `<div class="tile ${tone}"><span class="n">${big}</span><span class="k">${esc(label)}</span></div>`;

/** "7/7" as it looks in a tile, and "7 of 7" as a screen reader says it. */
const fraction = (part: number, whole: number): string =>
  `${count(part)}<small aria-hidden="true">/${count(whole)}</small><span class="sr"> of ${count(whole)}</span>`;

/** "12m 34s" in a tile with its units small, and "12 minutes 34 seconds" for a screen reader. */
function duration(ms: number): string {
  const looks = formatDuration(ms).replace(/(\d+)([a-z]+)/g, "$1<small>$2</small>");
  return `<span aria-hidden="true">${looks}</span><span class="sr">${spokenDuration(ms)}</span>`;
}

/** A tile's big number as it looks: a count, a count out of its total, or a time. */
const bigOf = (value: NumberTile["value"]): string =>
  "count" in value
    ? count(value.count)
    : "part" in value
      ? fraction(value.part, value.whole)
      : duration(value.ms);

/** The four numbers (../words.ts), each in a tile. */
function tiles(model: ShareModel): string {
  const items = glanceNumbersOf(model).map(({ tone, value, label }) =>
    tile(tone, bigOf(value), label),
  );
  return `<div class="tiles">${items.join("")}</div>`;
}

/**
 * The ring of the pages, with its legend, in a row: the pages in scope, by whether they have no
 * problems, need attention (a card of What needs attention is on them), or weren't read. Its middle
 * is the number of pages in scope, which the three parts add up to.
 */
function ringRow(model: ShareModel): string {
  const { parts } = GLANCE_TEXT;
  const { noProblems, needAttention, notRead } = model.ring;
  const row: RingPart[] = [
    { label: parts.noProblems, value: noProblems, kind: "ok" },
    { label: parts.needAttention, value: needAttention, kind: "warn" },
    { label: parts.notRead, value: notRead, kind: "bad" },
  ];
  return `<div class="ring-row">${ring(row, model.result.pages)}</div>`;
}

/**
 * The verdict: its words, with its kind as its class (`ok`, `warn`, or `bad`), which the style
 * block draws its sign for. It is a paragraph, not a heading: the section's own is above it.
 */
function verdict(result: ShareModel["result"]): string {
  const { kind, headline } = verdictOf(result);
  return `<p class="verdict ${kind}">${esc(headline)}</p>`;
}

/**
 * The links to the page's sections: What needs attention, which is there only when there is a card,
 * Every page, and The details. Each says its section's own words, and goes to its heading's id.
 */
function onThisPage(model: ShareModel): string {
  const sections: [id: string, words: string][] = [];
  if (model.attention.length > 0) sections.push(["need-h", ATTENTION_TEXT.title]);
  sections.push(["pages-h", PAGES_TEXT.title], ["details-h", DETAILS_TEXT.link]);
  const links = sections.map(([id, words]) => `<a href="#${id}">${esc(words)}</a>`);
  const label = esc(GLANCE_TEXT.onThisPage);
  return `<nav class="toc" aria-label="${label}"><span class="sub">${label}:</span>${links.join("")}</nav>`;
}

/**
 * At a glance, written for a manager who reads nothing else, in this order: the verdict, in words
 * (the one rule for it is `verdictOf`, and the style block draws its sign); the result in a
 * sentence; the ring of the pages; four numbers; the line on what voicecap and the person each did;
 * and the links to the page's sections. Its panels and bars are parts of the details now (`todoPart`
 * and the rest, below).
 *
 * When no run counts, there are no pages to count: it has only its sentence, which says why, the
 * line on what each did, and the links. The same goes for a run that lists no page: the verdict says
 * "Nothing needs attention" of a result of no page, which no one read, so it isn't shown, as the
 * website's card shows none for a report of no page.
 */
export function renderGlance(model: ShareModel): string {
  const { summary, result } = model;
  const counted = result.pages > 0;
  const parts = [
    `<h2 id="glance-h">${esc(GLANCE_TEXT.title)}</h2>`,
    ...(counted ? [verdict(result)] : []),
    `<p class="lead">${esc(summary.sentence)}</p>`,
    ...(counted ? [ringRow(model), tiles(model)] : []),
    `<p class="gist">${esc(summary.second)}</p>`,
    onThisPage(model),
  ];
  return `<section class="glance" aria-labelledby="glance-h">\n  ${parts.join("\n  ")}\n</section>`;
}

// The details' parts that were the summary's panels and bars.

/**
 * A part of the details: a section named by its own heading, an `h3` since the details' own is the
 * `h2`, with its box under the heading. `title` and `box` are HTML, already escaped. Every part is
 * open, and the box is the panel or meter the summary once drew it in.
 */
const detailsPart = (id: string, title: string, box: string): string =>
  `<section aria-labelledby="${id}"><h3 id="${id}">${title}</h3>${box}</section>`;

/** A panel of a list: the box of a part that is a few lines. */
const panelOf = (items: string[]): string => `<div class="panel"><ul>${items.join("")}</ul></div>`;

/** "What's still to do": the model's lines of what is left to do. */
export function todoPart({ todo }: Summary): string {
  const items = todo.map((line) => `<li>${esc(line)}</li>`);
  return detailsPart("todo-h", esc(SUMMARY_TEXT.todo), panelOf(items));
}

/**
 * "How complete the test was": the model's lines, with a way to the problems beside the line that
 * says them, and the run before's line, when there is one, last.
 */
export function completePart(model: ShareModel): string {
  const { complete, changesLine } = model.summary;
  const items = complete.map(
    (line) =>
      `<li>${esc(line)}${line === model.problems.line ? ' <a href="#prob-h">What happened</a>' : ""}</li>`,
  );
  if (changesLine !== null) {
    items.push(`<li>${esc(changesLine)} <a href="#chg-h">What changed</a></li>`);
  }
  return detailsPart("complete-h", esc(SUMMARY_TEXT.complete), panelOf(items));
}

/** "When and how": the date, who ran it, and the tools, as the model has them. */
export function whenHowPart({ whenHow }: Summary): string {
  const items = whenHow.map(({ label, value }) => `<li><b>${esc(label)}</b>: ${esc(value)}</li>`);
  return detailsPart("whenhow-h", esc(SUMMARY_TEXT.whenHow), panelOf(items));
}

/**
 * "Flags by rule": a row for each rule, as long as its count is against the most. A rule's count is
 * how many times it was raised, once for each page and pass, as the phrase after the title says.
 */
export function rulesPart({ bars }: Summary): string {
  const { flagsByRule } = bars;
  const most = flagsByRule.reduce((top, { count: times }) => Math.max(top, times), 0);
  const rows = flagsByRule.map(
    ({ rule, count: times }) =>
      `<div class="rule"><span class="mono">${esc(rule)}</span>${track(times, most, "warn")}<span class="c">${count(times)}</span></div>`,
  );
  const body =
    rows.length === 0
      ? `<p class="sub">${esc(SUMMARY_TEXT.noFlagsRaised)}</p>`
      : `<div class="rules">${rows.join("")}</div>`;
  const title = `${esc(SUMMARY_TEXT.rules)} <span class="sub">${esc(SUMMARY_TEXT.rulesNote)}</span>`;
  return detailsPart("rules-h", title, `<div class="meter">${body}</div>`);
}

/** A count out of its total in a row: "3/3" as it looks, and "3 of 3" as a screen reader says it. */
const tally = (part: number, whole: number): string =>
  `<span class="c"><span aria-hidden="true">${count(part)}/${count(whole)}</span><span class="sr">${count(part)} of ${count(whole)}</span></span>`;

/**
 * "The human review": each count out of its total, so nothing looks complete that isn't. It has no
 * row for the pages a person heard NVDA read, which is on each page's chip.
 */
export function reviewPart({ bars }: Summary): string {
  const { reviewRows } = SUMMARY_TEXT;
  const rows: [string, [number, number]][] = [
    [reviewRows.reviewed, bars.review.reviewed],
    [reviewRows.fixed, bars.review.fixed],
  ];
  const html = rows.map(([label, [part, whole]]) => {
    const tone = part >= whole ? "ok" : "warn";
    return `<div class="rule"><span>${esc(label)}</span>${track(part, whole, tone)}${tally(part, whole)}</div>`;
  });
  const title = `${esc(SUMMARY_TEXT.review)} <span class="sub">${esc(SUMMARY_TEXT.reviewNote)}</span>`;
  return detailsPart(
    "review-h",
    title,
    `<div class="meter"><div class="rules">${html.join("")}</div></div>`,
  );
}

// How voicecap works.

/** The six steps, each with its picture, in order. */
function steps(): string {
  const items = HOW_STEPS.map(
    (step, index) =>
      `<li><span class="ico" aria-hidden="true">${STEP_ICONS[step.icon]}</span><h3><span class="step-n">${index + 1}<span class="sr">.</span></span> ${esc(step.title)}</h3><p>${esc(step.text)}</p></li>`,
  );
  return `<ol class="flow" role="list">${items.join("")}</ol>`;
}

/**
 * A sample of what NVDA said on this site: the first lines of each pass on its home page, as the
 * transcripts shown have them, each with how long it took. It is a fold, behind a line that is its
 * title (the page, and how many ways through it), so the steps and the band on when to run voicecap
 * are what is open. Without a sample (no home page with transcripts, or none whose lines can be
 * read), there is nothing to fold: it says so, in the open, so a gap is never behind a click.
 */
function heard(sample: ShareModel["heard"]): string {
  if (sample === null) {
    return `<div class="heard"><h3>${esc(HOW_TEXT.heard)}</h3>${notRecorded(HOW_TEXT.noSample)}</div>`;
  }
  const lanes = sample.passes.map(({ pass, lines }) => {
    const { key, words } = HOW_TEXT.ways[pass];
    const said = lines.map(
      ({ text, took }) => `<li><span>“${esc(text)}”</span><span class="t">${esc(took)}</span></li>`,
    );
    return `<figure class="lane"><figcaption><kbd>${esc(key)}</kbd> ${esc(words)}</figcaption><ol class="said-list" role="list">${said.join("")}</ol></figure>`;
  });
  const body = `<div class="lanes">${lanes.join("")}</div><p class="sub">${esc(HOW_TEXT.heardNote)}</p>`;
  return fold(`<span class="what">${esc(heardTitle(sample))}</span>`, body, {
    className: "heard-fold",
  });
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
 * this site (folded), and when to run voicecap. It is built with its own h2 and h3, as every
 * section is; the details set it a level down (`demoted`) to be one of its parts.
 */
export function renderHow(model: ShareModel): string {
  return [
    `<section aria-labelledby="how-h">`,
    `  <h2 id="how-h">${esc(HOW_TEXT.title)}</h2>`,
    `  <p class="gist">${lineHtml(howLead())}</p>`,
    `  ${steps()}`,
    `  ${heard(model.heard)}`,
    `  ${when()}`,
    `</section>`,
  ].join("\n");
}
