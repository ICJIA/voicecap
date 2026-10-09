/**
 * The website's Technical details page, `technical-details.html`, as a pure function of what it's
 * given: how voicecap works, for auditors and developers, in the shape of the audit tool's
 * technical page. Its words are ./technical-text.ts's. What voicecap's code holds, the page takes
 * from the code, so it can't fall behind it: its passes (PASS_NAMES), its built-in flag rules and
 * how many there are (BUILT_IN_RULES), and its defaults (DEFAULT_CONFIG). What the build knows comes
 * in its input: the version and the day it was released, what its release recorded of its tests,
 * how many shares a site keeps (KEPT_PER_SITE, which ./build.ts passes, so this module needn't
 * import it), and what the records count. So building the same records with the same package
 * writes the same bytes, as the website's other pages do.
 *
 * It's one of the website's pages, in the website's frame (./frame.ts): the same head, with one
 * style block (SITE_CSS, which embeds no font) and one script (SITE_SCRIPT); the skip link; the bar;
 * and the footer. It sets no `style` attribute, since a Content Security Policy that hashes its
 * style block and its script allows nothing else.
 *
 * Its main part, in order: a kicker over the page's heading, an h1, then its lead and the version it
 * is from; "On this page", a navigation with a numbered link to each part; and the parts, each a
 * section with a kicker over its heading, an h2 with an id, and, inside it, h3s where it needs them:
 *
 *   1. what voicecap does;
 *   2. how a run works: an ordered list drawn as a flow of boxes, whose arrows are the style's, so a
 *      screen reader hears the list; then the commands, in a table;
 *   3. NVDA's passes, in a table, why a pass stops, how NVDA's words are caught, and the
 *      defaults, in a table;
 *   4. what a run records: the transcripts home, as a tree, and what a run keeps of the computer;
 *   5. the flags: the built-in rules, in a table;
 *   6. fingerprints, seals, and `voicecap verify`;
 *   7. how this website is built and protected, and what it shows now;
 *   8. the toolchain, in a table, each tool linked to its package on npm or to its source;
 *   9. privacy and security;
 *  10. the limits;
 *  11. verify for yourself: the code at the version's tag, how to check a copy, and how the version
 *      was tested;
 *  12. related documents, a card of four cards.
 *
 * Each table is in a box of its own, which scrolls when the table is wider than the window, so the
 * page never is: the box can take focus, so a keyboard can scroll it, and it's a region named by
 * the table's heading. Each column's header says it's one, and each row's first cell names its
 * row. The page follows the website's rules: headings in order, landmarks, a skip link, visible
 * keyboard focus, and complete without JavaScript, as it has no fold. What the facts hold goes
 * through `esc`, and so do the fixed words, which are plain text.
 */
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { BUILT_IN_RULES } from "../flags/evaluate.js";
import { PASS_NAMES } from "../model.js";
import { esc } from "../report/html.js";
import { count } from "../share/format.js";
import { HOW_TEXT } from "../share/text.js";
import type { RecordFacts, VoicecapFacts } from "./facts.js";
import { siteBar, sitePage } from "./frame.js";
import type { SiteContent } from "./render.js";
import {
  buildCommand,
  duration,
  TECHNICAL_TEXT,
  toolHref,
  type FlowStep,
  type TreeEntry,
} from "./technical-text.js";
import { day, SITE_TEXT, type Sentence } from "./text.js";

/** What the page is drawn from. */
export interface TechnicalInput {
  /** What it says of voicecap: its version, its release's day, and what its release recorded. */
  voicecap: VoicecapFacts;
  /** What it says of the records, counted from what the website shows (recordFactsOf). */
  records: RecordFacts;
  /** What the website shows: only for the bar's links to the views of its own page (siteBar). */
  content: SiteContent;
  /** How many of a site's shares the website keeps: KEPT_PER_SITE, which the build passes. */
  keptPerSite: number;
}

/**
 * What each of the page's lists whose markers are removed says it is, as the website's other pages'
 * lists do (IS_A_LIST in ./render.ts): WebKit takes a list's semantics from one whose markers are
 * removed, and the role keeps it one.
 */
const IS_A_LIST = ' role="list"';

/** A sentence as HTML: each piece escaped, each command in the fixed-width font, each link made. */
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

/** A table's cell as HTML: its words escaped, and what's in backticks in the fixed-width font. */
function cellHtml(text: string): string {
  return text
    .split("`")
    .map((piece, index) => (index % 2 === 1 ? `<code>${esc(piece)}</code>` : esc(piece)))
    .join("");
}

/** What a part is known by: its heading's id, its kicker, and its heading. */
interface PartWords {
  id: string;
  kicker: string;
  heading: string | Sentence;
}

/**
 * One of the page's parts: a section, with its kicker over its heading, an h2 with its id, which
 * "On this page" links to, then what's `inside` it, which is HTML already escaped. The section has
 * no name, so it isn't a landmark: the parts are reached by their headings.
 */
function part(words: PartWords, inside: string[]): string {
  return [
    '<section class="part">',
    `<p class="kicker">${esc(words.kicker)}</p>`,
    `<h2 id="${esc(words.id)}">${sentenceHtml(words.heading)}</h2>`,
    ...inside,
    "</section>",
  ].join("\n");
}

/** A heading of the third level in a part, with an id when a table's box is named by it. */
function subheading(words: string, id?: string): string {
  return id === undefined ? `<h3>${esc(words)}</h3>` : `<h3 id="${esc(id)}">${esc(words)}</h3>`;
}

/** A paragraph of a part, in the card's words' color. */
function paragraph(words: string | Sentence): string {
  return `<p>${sentenceHtml(words)}</p>`;
}

/** A part's points: a list with its markers, each point a sentence. */
function list(points: readonly Sentence[]): string {
  return [
    '<ul class="list">',
    ...points.map((point) => `<li>${sentenceHtml(point)}</li>`),
    "</ul>",
  ].join("\n");
}

/**
 * A table, of the class `name`, in its box: the box scrolls when the table is wider than the
 * window, takes focus so a keyboard can scroll it, and is a region named by the heading whose id is
 * `labelledBy`. Each column's header is a `th` of the column, and each row's first cell a `th` of
 * the row. `rows` are each row's cells, as HTML already escaped.
 */
function table(
  name: string,
  labelledBy: string,
  columns: readonly string[],
  rows: readonly string[][],
): string {
  const header = columns.map((column) => `<th scope="col">${esc(column)}</th>`).join("");
  return [
    `<div class="scroll" tabindex="0" role="region" aria-labelledby="${esc(labelledBy)}">`,
    `<table class="${name}">`,
    `<thead><tr>${header}</tr></thead>`,
    "<tbody>",
    ...rows.map(
      ([first = "", ...rest]) =>
        `<tr><th scope="row">${first}</th>${rest.map((cell) => `<td>${cell}</td>`).join("")}</tr>`,
    ),
    "</tbody>",
    "</table>",
    "</div>",
  ].join("\n");
}

/** Words in the fixed-width font, as HTML. */
const code = (words: string): string => `<code>${esc(words)}</code>`;

/**
 * The page's head: its kicker, its heading, its lead, and the version it's from, with the day that
 * version was released, which is a time that holds the day it names, or that the day isn't
 * recorded.
 */
function hero({ version, released }: VoicecapFacts): string {
  const { stamp } = TECHNICAL_TEXT;
  const when =
    released === null
      ? esc(stamp.notRecorded)
      : `${esc(stamp.released)} <time datetime="${esc(released)}">${esc(day(released))}</time>`;
  return [
    '<div class="hero">',
    `<p class="kicker">${esc(TECHNICAL_TEXT.kicker)}</p>`,
    `<h1>${esc(TECHNICAL_TEXT.heading)}</h1>`,
    `<p class="lead">${sentenceHtml(TECHNICAL_TEXT.lead)}</p>`,
    `<p class="version-line">${esc(stamp.from(version))}, ${when}.</p>`,
    "</div>",
  ].join("\n");
}

/** How a run works: its steps, a box each, in an ordered list whose arrows the style draws. */
function flow(steps: readonly FlowStep[]): string {
  return [
    `<ol class="flow"${IS_A_LIST}>`,
    ...steps.map(({ title, words }) =>
      [
        '<li><div class="card box">',
        `<p class="step-title">${esc(title)}</p>`,
        ...words.map(paragraph),
        "</div></li>",
      ].join(""),
    ),
    "</ol>",
  ].join("\n");
}

/**
 * The transcripts home, as a tree: each entry's name in the fixed-width font, what it holds under
 * it, and what's in it, a list in the list. The tree is a card.
 */
function tree(entries: readonly TreeEntry[], top = true): string {
  return [
    top ? `<ul class="card tree"${IS_A_LIST}>` : `<ul${IS_A_LIST}>`,
    ...entries.map(
      ({ name, words, inside }) =>
        `<li>${code(name)}<p>${sentenceHtml(words)}</p>${inside === undefined ? "" : tree(inside, false)}</li>`,
    ),
    "</ul>",
  ].join("");
}

/** 1. What voicecap does. */
function does(): string {
  const words = TECHNICAL_TEXT.parts.does;
  return part(words, [list(words.points)]);
}

/** 2. How a run works: its steps, then the commands. */
function run({ keptPerSite }: TechnicalInput): string {
  const words = TECHNICAL_TEXT.parts.run;
  const { commands } = words;
  return part(words, [
    `<p class="lead">${esc(words.lead)}</p>`,
    flow(words.steps(keptPerSite)),
    subheading(commands.heading, commands.id),
    paragraph(commands.lead),
    table(
      "commands",
      commands.id,
      commands.columns,
      TECHNICAL_TEXT.commands.map(({ name, job }) => [code(name), cellHtml(job)]),
    ),
  ]);
}

/**
 * 3. NVDA's passes: a row each, in their order, with the key a person presses for it (the shareable
 * page's own, HOW_TEXT); why a pass stops; how NVDA's words are caught; and voicecap's defaults,
 * each from DEFAULT_CONFIG.
 */
function passes(): string {
  const words = TECHNICAL_TEXT.parts.passes;
  const { caught, defaults } = words;
  const { stepCaps, timeouts, repeatLimit, pageAttempts, restartEvery, maxConsecutiveFailures } =
    DEFAULT_CONFIG;
  const setting = (name: string, value: string, what: string): string[] => [
    code(name),
    esc(value),
    esc(what),
  ];
  return part(words, [
    table(
      "passes",
      words.id,
      words.columns,
      PASS_NAMES.map((pass) => [
        code(pass),
        esc(HOW_TEXT.ways[pass].key),
        esc(words.passes[pass].start),
        esc(words.passes[pass].end),
      ]),
    ),
    paragraph(words.stops),
    subheading(caught.heading),
    list(caught.points),
    subheading(defaults.heading, defaults.id),
    paragraph(defaults.lead),
    table("defaults", defaults.id, defaults.columns, [
      ...PASS_NAMES.map((pass) =>
        setting(`stepCaps.${pass}`, count(stepCaps[pass]), defaults.stepCap(pass)),
      ),
      setting("repeatLimit", count(repeatLimit), defaults.repeatLimit),
      setting("timeouts.stepMs", duration(timeouts.stepMs), defaults.stepMs),
      setting("timeouts.pageMs", duration(timeouts.pageMs), defaults.pageMs),
      setting("pageAttempts", count(pageAttempts), defaults.pageAttempts),
      setting("restartEvery", count(restartEvery), defaults.restartEvery),
      setting(
        "maxConsecutiveFailures",
        count(maxConsecutiveFailures),
        defaults.maxConsecutiveFailures,
      ),
    ]),
  ]);
}

/** 4. What a run records: the transcripts home, then what a run keeps of the computer. */
function record(): string {
  const words = TECHNICAL_TEXT.parts.record;
  return part(words, [paragraph(words.lead), tree(words.tree), list(words.points)]);
}

/** 5. The flags: the built-in rules, a row each, in their order, and how many there are. */
function flags(): string {
  const words = TECHNICAL_TEXT.parts.flags;
  const { rules } = words;
  return part(words, [
    subheading(rules.heading, rules.id),
    table(
      "rules",
      rules.id,
      rules.columns,
      BUILT_IN_RULES.map((rule) => [code(rule), esc(TECHNICAL_TEXT.rules[rule])]),
    ),
    list(words.points),
  ]);
}

/** 6. Fingerprints, seals, and `voicecap verify`. */
function evidence(): string {
  const words = TECHNICAL_TEXT.parts.evidence;
  return part(words, [list(words.points)]);
}

/**
 * 7. How this website is built and protected: what's published, from how many shares a site keeps;
 * how each page is protected; how it's built, with the command this version writes; and what the
 * records count now.
 */
function website({ voicecap, records, keptPerSite }: TechnicalInput): string {
  const words = TECHNICAL_TEXT.parts.website;
  const { published, protection, built, now } = words;
  return part(words, [
    subheading(published.heading),
    list(published.points(keptPerSite)),
    subheading(protection.heading),
    list(protection.points),
    subheading(built.heading),
    list(built.points(buildCommand(voicecap.version))),
    subheading(now.heading),
    list(now.points(records)),
  ]);
}

/** 8. The toolchain: a row each, each tool's name a link to where it lives, when it has one. */
function toolchain(): string {
  const words = TECHNICAL_TEXT.parts.toolchain;
  const rows = TECHNICAL_TEXT.toolchain.map((tool) => {
    const href = toolHref(tool);
    const name = href === null ? esc(tool.tool) : `<a href="${esc(href)}">${esc(tool.tool)}</a>`;
    return [name, cellHtml(tool.job), esc(tool.license), cellHtml(tool.where)];
  });
  return part(words, [
    `<p class="lead">${esc(words.lead)}</p>`,
    table("toolchain", words.id, words.columns, rows),
    paragraph(words.after),
  ]);
}

/** 9. Privacy and security: what stays on the computer, what goes out, and what's left alone. */
function privacy(): string {
  const words = TECHNICAL_TEXT.parts.privacy;
  const { stays, goes, needs } = words;
  return part(words, [
    subheading(stays.heading),
    list(stays.points),
    subheading(goes.heading),
    list(goes.points),
    subheading(needs.heading),
    list(needs.points),
  ]);
}

/** 10. What it can't do: the limits. */
function limits(): string {
  const words = TECHNICAL_TEXT.parts.limits;
  return part(words, [list(words.points)]);
}

/**
 * 11. Verify for yourself: the code that built this website, linked at its version's tag on GitHub;
 * how to check a copy; and how this version was tested, or that it isn't recorded.
 */
function verify({ voicecap }: TechnicalInput): string {
  const words = TECHNICAL_TEXT.parts.verify;
  const tag = `${SITE_TEXT.github}/tree/v${encodeURIComponent(voicecap.version)}/`;
  const links = TECHNICAL_TEXT.code.map(
    ({ label, path }) =>
      `<li><a href="${esc(`${tag}${path}`)}">${esc(label)}</a>: ${code(path)}</li>`,
  );
  return part(words, [
    subheading(words.code.heading),
    paragraph(words.code.lead(voicecap.version)),
    ['<ul class="list">', ...links, "</ul>"].join("\n"),
    subheading(words.copy.heading),
    list(words.copy.points),
    subheading(words.tested.heading),
    list(words.tested.points(voicecap.version, voicecap.release)),
  ]);
}

/**
 * 12. Related documents: a card holding four cards, as the audit tool's, its heading a small label
 * in the kicker's look, and each card a small label, its title, which is its link, and a line.
 */
function related(): string {
  const words = TECHNICAL_TEXT.parts.related;
  return [
    '<section class="part related">',
    '<div class="card">',
    `<h2 class="kicker" id="${esc(words.id)}">${esc(words.heading)}</h2>`,
    `<ul class="related-cards"${IS_A_LIST}>`,
    ...TECHNICAL_TEXT.related.map(
      ({ label, title, line, href }) =>
        `<li class="card"><p class="kicker">${esc(label)}</p><h3><a href="${esc(href)}">${esc(title)}</a></h3><p>${esc(line)}</p></li>`,
    ),
    "</ul>",
    "</div>",
    "</section>",
  ].join("\n");
}

/** The page's parts, in order: what each is known by, which "On this page" links to, and how. */
const PARTS: {
  words: { id: string; heading: string | Sentence };
  draw: (input: TechnicalInput) => string;
}[] = [
  { words: TECHNICAL_TEXT.parts.does, draw: does },
  { words: TECHNICAL_TEXT.parts.run, draw: run },
  { words: TECHNICAL_TEXT.parts.passes, draw: passes },
  { words: TECHNICAL_TEXT.parts.record, draw: record },
  { words: TECHNICAL_TEXT.parts.flags, draw: flags },
  { words: TECHNICAL_TEXT.parts.evidence, draw: evidence },
  { words: TECHNICAL_TEXT.parts.website, draw: website },
  { words: TECHNICAL_TEXT.parts.toolchain, draw: toolchain },
  { words: TECHNICAL_TEXT.parts.privacy, draw: privacy },
  { words: TECHNICAL_TEXT.parts.limits, draw: limits },
  { words: TECHNICAL_TEXT.parts.verify, draw: verify },
  { words: TECHNICAL_TEXT.parts.related, draw: related },
];

/**
 * "On this page": a navigation named for a screen reader, whose name stands before its links for
 * the eye too, hidden from a screen reader, which would otherwise say it twice; and a numbered link
 * to each part's heading, in its words.
 */
function onThisPage(): string {
  const name = esc(TECHNICAL_TEXT.onThisPage);
  return [
    `<nav class="card toc" aria-label="${name}">`,
    `<p class="kicker" aria-hidden="true">${name}</p>`,
    "<ol>",
    ...PARTS.map(
      ({ words }) => `<li><a href="#${esc(words.id)}">${sentenceHtml(words.heading)}</a></li>`,
    ),
    "</ol>",
    "</nav>",
  ].join("\n");
}

/**
 * The page, from what it's given: its main part, in the website's frame (sitePage in ./frame.ts),
 * with the bar of this page, whose links to the views follow `content`. Pure.
 */
export function renderTechnical(input: TechnicalInput): string {
  return sitePage({
    title: TECHNICAL_TEXT.title,
    bar: siteBar(input.content, "technical"),
    main: [hero(input.voicecap), onThisPage(), ...PARTS.map(({ draw }) => draw(input))],
  });
}
