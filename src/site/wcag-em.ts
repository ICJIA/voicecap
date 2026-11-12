/**
 * The website's WCAG-EM page, `wcag-em.html`: how the pages of a large site's report are chosen, for
 * a manager or an auditor who has never heard of WCAG-EM, as a pure function of what it's given. Its
 * words are ./wcag-em-text.ts's; what it says of the reports that are samples comes from the
 * records, so it can't fall behind them.
 *
 * It's one of the website's pages, in the website's frame (./frame.ts), and starts with the way back
 * to the test results. Its pictures are drawn by the style from real HTML, not from images or a
 * script, so a screen reader hears each as what it is: the five steps are an ordered list; the
 * parts of a sample are lists under their labels; the random part's size is a bar the eye sees and
 * a caption that says it; the template's pages are a grid the eye sees, with its caption; the
 * comparison of the two samples is an ordered list whose last step has two answers; and each
 * sampled report's share of its site is a `meter`, with its words beside it. What's only for the
 * eye (the grid's squares, the bar's two parts, the arrows, the check marks) is hidden from a
 * screen reader. Nothing is loaded from outside the page, and it sets no `style` attribute, since
 * its Content Security Policy hashes its one style block and its one script and allows nothing else.
 */
import { esc } from "../report/html.js";
import { count } from "../share/format.js";
import type { VoicecapFacts } from "./facts.js";
import { backLink, sitePage } from "./frame.js";
import { type Sentence } from "./text.js";
import { WCAG_EM_TEXT } from "./wcag-em-text.js";

/** A report that's a sample of its site, as the page lists it. */
export interface SampledReport {
  /** The site's name, as the front page shows it. */
  name: string;
  /** The pages the report covers, and the pages its sitemap lists. */
  pages: number;
  sitePages: number;
  /** The report's page, beside this one, when it's published. */
  href: string | null;
}

export interface WcagEmInput {
  voicecap: VoicecapFacts;
  sampled: readonly SampledReport[];
}

const IS_A_LIST = ' role="list"';
const TEXT = WCAG_EM_TEXT;
const P = TEXT.parts;

function sentenceHtml(sentence: Sentence | string): string {
  if (typeof sentence === "string") return esc(sentence);
  return sentence
    .map((piece) => {
      if (typeof piece === "string") return esc(piece);
      if ("code" in piece) return `<code>${esc(piece.code)}</code>`;
      return `<a href="${esc(piece.href)}">${esc(piece.link)}</a>`;
    })
    .join("");
}

/** A part of the page: a section, its kicker over its heading, an h2 with its id, then what's inside. */
function part(words: { id: string; kicker: string; heading: string }, inside: string[]): string {
  return [
    '<section class="part">',
    `<p class="kicker">${esc(words.kicker)}</p>`,
    `<h2 id="${esc(words.id)}">${esc(words.heading)}</h2>`,
    ...inside,
    "</section>",
  ].join("\n");
}

/** The page's head, then its four big numbers. */
function hero(): string {
  return [
    '<div class="hero">',
    `<p class="kicker">${esc(TEXT.kicker)}</p>`,
    `<h1>${esc(TEXT.heading)}</h1>`,
    `<p class="lead">${sentenceHtml(TEXT.lead)}</p>`,
    `<ul class="tiles em-numbers"${IS_A_LIST}>`,
    ...TEXT.numbers.map(
      ({ n, k }) => `<li class="tile"><p class="n">${esc(n)}</p><p class="k">${esc(k)}</p></li>`,
    ),
    "</ul>",
    "</div>",
  ].join("\n");
}

/** What WCAG-EM is: WCAG, the what, beside WCAG-EM, the how. */
function what(): string {
  const words = P.what;
  return part(words, [
    ...words.paragraphs.map((p) => `<p>${sentenceHtml(p)}</p>`),
    `<ul class="em-pair"${IS_A_LIST}>`,
    ...words.pair.map(
      (card) =>
        `<li class="card em-doc"><p class="kicker">${esc(card.tag)}</p><p class="em-name">${esc(card.name)}</p><p class="em-long">${esc(card.long)}</p><p>${esc(card.words)}</p><a href="${esc(card.href)}">${esc(card.link)}</a></li>`,
    ),
    "</ul>",
    `<p class="em-callout">${esc(words.after)}</p>`,
  ]);
}

/** The five steps: an ordered list, a card a step, drawn as a line of steps. */
function steps(): string {
  const words = P.steps;
  return part(words, [
    `<p class="lead">${esc(words.lead)}</p>`,
    `<ol class="em-steps"${IS_A_LIST}>`,
    ...words.list.map(
      (step, index) =>
        `<li class="card em-step"><p class="em-badge" aria-hidden="true">${index + 1}</p><h3><span class="sr">Step ${index + 1}: </span>${esc(step.name)}</h3><p>${esc(step.plain)}</p><ul class="em-subs"${IS_A_LIST}>${step.parts.map((sub) => `<li>${esc(sub)}</li>`).join("")}</ul><p class="em-here"><strong>${esc(words.hereLabel)}:</strong> ${esc(step.here)}</p></li>`,
    ),
    "</ol>",
  ]);
}

/** A labelled list of named boxes, for the parts of a sample. */
function boxes(
  label: string,
  items: readonly { name: string; words: string }[],
  kind: string,
): string {
  return [
    `<div class="em-stage ${kind}">`,
    `<p class="em-stage-label">${esc(label)}</p>`,
    `<ul class="em-boxes"${IS_A_LIST}>`,
    ...items.map(
      (item) =>
        `<li class="card"><p class="em-box-name">${esc(item.name)}</p><p>${esc(item.words)}</p></li>`,
    ),
    "</ul>",
    "</div>",
  ].join("\n");
}

/** What goes into a sample: what Step 2 finds, which feeds Step 3's three parts, and the random part's size. */
function sample(): string {
  const words = P.sample;
  const { bar } = words;
  return part(words, [
    `<p class="lead">${esc(words.lead)}</p>`,
    boxes(words.sources.label, words.sources.items, "from"),
    '<p class="em-down" aria-hidden="true">↓</p>',
    boxes(words.three.label, words.three.items, "into"),
    '<figure class="card em-figure">',
    `<h3>${esc(bar.heading)}</h3>`,
    '<div class="em-bar" aria-hidden="true"><span class="s"></span><span class="r"></span></div>',
    `<p class="em-legend" aria-hidden="true"><span class="sw s"></span>${esc(bar.structured)} <span class="sw r"></span>${esc(bar.random)} <strong>= ${esc(bar.total)}</strong></p>`,
    `<figcaption>${esc(bar.caption)}</figcaption>`,
    "</figure>",
    `<p class="em-callout">${esc(words.why)}</p>`,
  ]);
}

/** One template, many pages: the template's card, an arrow, and a grid of its pages, three of them read. */
function template(): string {
  const words = P.template;
  const { figure } = words;
  const squares = Array.from({ length: 48 }, (_, i) =>
    [5, 22, 39].includes(i) ? '<span class="read"></span>' : "<span></span>",
  ).join("");
  return part(words, [
    `<p class="lead">${esc(words.lead)}</p>`,
    '<figure class="card em-figure em-template">',
    '<div class="em-template-row">',
    `<div class="em-source" aria-hidden="true"><p class="em-name">${esc(figure.template)}</p><p>${esc(figure.templateWords)}</p></div>`,
    `<p class="em-arrow" aria-hidden="true"><span>${esc(figure.arrow)}</span></p>`,
    `<div class="em-pages" aria-hidden="true"><div class="em-grid">${squares}</div><p>${esc(figure.pages)}</p></div>`,
    "</div>",
    `<figcaption>${esc(figure.caption)}</figcaption>`,
    "</figure>",
    `<p class="em-callout">${esc(words.inspector)}</p>`,
  ]);
}

/** Step 4.3: test both parts, ask one question, and its two answers. */
function compare(): string {
  const words = P.compare;
  const answer = (kind: string, branch: { answer: string; words: string }): string =>
    `<li class="card em-branch ${kind}"><p class="em-answer">${esc(branch.answer)}</p><p>${esc(branch.words)}</p></li>`;
  return part(words, [
    `<p class="lead">${esc(words.lead)}</p>`,
    `<ol class="em-decide"${IS_A_LIST}>`,
    `<li class="card em-start">${esc(words.start)}</li>`,
    `<li class="card em-question">${esc(words.question)}<ul class="em-branches"${IS_A_LIST}>${answer("no", words.no)}${answer("yes", words.yes)}</ul></li>`,
    "</ol>",
  ]);
}

/** What a sample finds, beside what it can't promise, then how the rest is covered. */
function limits(): string {
  const words = P.limits;
  const column = (
    kind: string,
    mark: string,
    side: { heading: string; items: readonly string[] },
  ): string =>
    `<div class="card em-side ${kind}"><h3>${esc(side.heading)}</h3><ul class="em-marks"${IS_A_LIST}>${side.items
      .map((item) => `<li><span class="em-mark" aria-hidden="true">${mark}</span>${esc(item)}</li>`)
      .join("")}</ul></div>`;
  return part(words, [
    '<div class="em-sides">',
    column("finds", "✓", words.finds),
    column("cannot", "✗", words.cannot),
    "</div>",
    `<p class="em-callout">${esc(words.cover)}</p>`,
  ]);
}

/** The reports on this website that are samples, each with its share of its site as a meter. */
function reports(sampled: readonly SampledReport[]): string {
  const words = P.voicecap;
  if (sampled.length === 0) return part(words, [`<p>${esc(words.none)}</p>`]);
  return part(words, [
    `<p class="lead">${esc(words.lead)}</p>`,
    `<ul class="em-reports"${IS_A_LIST}>`,
    ...sampled.map((report) => {
      const line = words.line(count(report.pages), count(report.sitePages));
      return [
        '<li class="card">',
        `<h3>${esc(report.name)}</h3>`,
        `<meter min="0" max="${report.sitePages}" value="${report.pages}" aria-label="${esc(words.meter(report.pages, report.sitePages))}">${esc(line)}</meter>`,
        `<p>${esc(line)}</p>`,
        report.href === null
          ? ""
          : `<a href="${esc(report.href)}#sample-h">${esc(words.open)}<span class="sr"> of ${esc(report.name)}</span></a>`,
        "</li>",
      ].join("");
    }),
    "</ul>",
  ]);
}

/** Questions people ask, a card each. */
function questions(): string {
  const words = P.questions;
  return part(words, [
    `<ul class="em-questions"${IS_A_LIST}>`,
    ...words.list.map(
      ({ q, a }) => `<li class="card"><h3>${esc(q)}</h3><p>${sentenceHtml(a)}</p></li>`,
    ),
    "</ul>",
  ]);
}

/** The W3C's pages, a card each. */
function more(): string {
  const words = P.more;
  return part(words, [
    `<ul class="related-cards"${IS_A_LIST}>`,
    ...words.cards.map(
      ({ label, title, line, href }) =>
        `<li class="card"><p class="kicker">${esc(label)}</p><h3><a href="${esc(href)}">${esc(title)}</a></h3><p>${esc(line)}</p></li>`,
    ),
    "</ul>",
  ]);
}

const PARTS = [
  P.what,
  P.steps,
  P.sample,
  P.template,
  P.compare,
  P.limits,
  P.voicecap,
  P.questions,
  P.more,
];

/** "On this page": a numbered link to each part. */
function onThisPage(): string {
  const name = esc(TEXT.onThisPage);
  return [
    `<nav class="card toc" aria-label="${name}">`,
    `<p class="kicker" aria-hidden="true">${name}</p>`,
    "<ol>",
    ...PARTS.map((words) => `<li><a href="#${esc(words.id)}">${esc(words.heading)}</a></li>`),
    "</ol>",
    "</nav>",
  ].join("\n");
}

/** The page. Pure. */
export function renderWcagEm(input: WcagEmInput): string {
  return sitePage({
    title: TEXT.title,
    current: "wcag-em",
    version: input.voicecap.version,
    main: [
      backLink(),
      hero(),
      onThisPage(),
      what(),
      steps(),
      sample(),
      template(),
      compare(),
      limits(),
      reports(input.sampled),
      questions(),
      more(),
    ],
  });
}
