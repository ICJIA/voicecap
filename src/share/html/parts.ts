/**
 * The parts every section of the shareable page draws with: a fold, a chip, a "Not recorded" line,
 * a scroll box, a line of words, a verdict line, a track, the strip of spoken lines, and the ring of
 * the pages. Each returns HTML. `demoted` takes some markup and sets its headings one level down.
 *
 * None sets a `style` attribute: the page's Content Security Policy hashes its one style block and
 * allows nothing else. So sizes are attributes, and colors are classes the style block gives
 * their colors to (`c-ok`, `c-warn`, `c-bad`, and `c-quiet`, the chips' own), which an SVG shape
 * takes as its fill with `fill="currentColor"`; the ring's arcs take their kind's class, and the
 * stroke the style block gives it.
 *
 * What the callers pass is HTML only where a parameter says so (a fold's summary line and body, and
 * what a scroll box holds); it is escaped by whoever builds it. Every other string is text, and
 * escaped here.
 */
import { esc, idFragment, plural } from "../../report/html.js";
import { count, seconds } from "../format.js";
import { firstSentenceBold, type Line } from "../line.js";
import { GLANCE_TEXT } from "../text.js";
import { notRecordedLine } from "../words.js";

/**
 * A heading in a summary line: an `h1` to `h6`, or any tag given the role. Only real tags count:
 * text is escaped, so a `<` is always a tag's.
 */
const HEADING_IN_SUMMARY = /<h[1-6]\b|<[^>]*\brole\s*=\s*["']?heading\b/i;

/** A section heading, which is never inside a fold. */
const SECTION_HEADING = /<h([12])\b/i;

/** The words in some HTML: what's left when the tags are dropped. */
function wordsOf(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

export interface FoldOptions {
  /** The fold's id, so a link can point to it. */
  id?: string;
  /** Starts open. Default: closed. */
  open?: boolean;
  /** Starts hidden, for a fold a script shows once it has something to say. Default: shown. */
  hidden?: boolean;
  /** More classes for the details element, after "fold". */
  className?: string;
  /** More classes for the inside box, after "inside". */
  insideClassName?: string;
  /**
   * Data attributes for the details element, after its id, each name as it follows "data-" ("run"
   * for `data-run`): what names a fold for the page's fingerprint check. Each value is escaped.
   */
  data?: Record<string, string>;
}

/** A data attribute's name, as it follows "data-": lowercase letters, digits, and hyphens. */
const DATA_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * A `<details>` whose `<summary>` is one line that says what's inside, and whose body is in an
 * inside box. `summary` and `body` are HTML, already escaped.
 *
 * It throws on what the page's rules forbid, so a mistake shows in the first test that renders it:
 * a heading in the summary line (some screen readers don't announce a heading inside one), a
 * summary line with no words, and a section heading (`h1` or `h2`) in the body, since every
 * section must be reachable by heading, never folded away. A fold's own parts start at `h3`.
 */
export function fold(summary: string, body: string, options: FoldOptions = {}): string {
  if (HEADING_IN_SUMMARY.test(summary)) {
    throw new Error(
      "A fold's summary line can't hold a heading: some screen readers don't announce a heading inside a summary.",
    );
  }
  if (wordsOf(summary) === "") throw new Error("A fold's summary line needs words.");
  const section = SECTION_HEADING.exec(body)?.[1];
  if (section !== undefined) {
    throw new Error(
      `A fold can't hold a section heading (h${section}): section headings are never inside a fold. Its own parts start at h3.`,
    );
  }
  const classes = options.className ? `fold ${options.className}` : "fold";
  const insideClasses = options.insideClassName ? `inside ${options.insideClassName}` : "inside";
  const id = options.id === undefined ? "" : ` id="${esc(options.id)}"`;
  const data = Object.entries(options.data ?? {}).map(([name, value]) => {
    if (!DATA_NAME.test(name)) throw new Error(`Not a data attribute's name: ${name}`);
    return ` data-${name}="${esc(value)}"`;
  });
  return `<details class="${esc(classes)}"${id}${data.join("")}${options.open ? " open" : ""}${options.hidden ? " hidden" : ""}><summary>${summary}</summary><div class="${esc(insideClasses)}">${body}</div></details>`;
}

/**
 * Some markup with every heading one level down: an `h1` to `h5` becomes the next one (`h2` to
 * `h6`), its closing tag too, with its attributes and words as they were. The details are made
 * with it: each section that follows the cards is built as it always was, folds and all, and set
 * one level down to be a part of the details, with what is inside it one level down as well.
 *
 * Only a real tag moves. A `<` in a word is written `&lt;`, and in the check's data as a unicode
 * escape, so the words of a transcript, a card's code, or a heading that someone wrote about
 * headings stay as they are. Nothing goes below `h6`: it throws rather than leave a heading in the
 * wrong place.
 */
export function demoted(html: string): string {
  if (/<\/?h6(?=[\s>])/i.test(html)) throw new Error("A heading can't go below h6.");
  return html.replace(
    /(<\/?h)([1-5])(?=[\s>])/gi,
    (_tag, start: string, level: string) => `${start}${Number(level) + 1}`,
  );
}

/**
 * A chip: a short status in words, colored by its kind ("ok", "warn", "bad", or "quiet"). The
 * words are what says it, never the color alone, so a chip with none is refused.
 */
export function chip(kind: string, words: string): string {
  if (words.trim() === "") {
    throw new Error("A chip says its meaning in words, never by color alone.");
  }
  return `<span class="chip c-${idFragment(kind)}">${esc(words)}</span>`;
}

/**
 * A line that says something wasn't recorded, as a paragraph. `text` is the whole line, which the
 * model words ("Not recorded: this run used voicecap 0.4.1.", or, for a line about one thing, "The
 * step and the key: not recorded: this run used voicecap 0.4.1."). A line that doesn't say so gets
 * those words put in front (`notRecordedLine`, which the Word copy says its lines with too), so a
 * gap never reads as a pass.
 */
export function notRecorded(text: string): string {
  return `<p class="not-recorded">${esc(notRecordedLine(text))}</p>`;
}

/**
 * A box a keyboard can reach (Tab) and scroll, and a screen reader names: every table that can be
 * wider than the page, a session's chart, and every block that keeps its long lines (a transcript,
 * a stack trace) sits in one. A fix's code, on a card of what needs attention, wraps instead, so it
 * needs none. `inner` is HTML, already escaped.
 */
export function scroll(label: string, inner: string): string {
  return `<div class="scroll" tabindex="0" role="region" aria-label="${esc(label)}">${inner}</div>`;
}

/**
 * A line of words (../line.ts) as HTML, every word escaped: a piece in bold is a `<b>`, one in the
 * fixed-width font a `<code>`, and one linked out an `<a href>`, outside the other two. A line has
 * no markup of its own, so a `<` in it is always a word's.
 */
export function lineHtml(line: Line): string {
  return line
    .map((piece) => {
      if (typeof piece === "string") return esc(piece);
      const words = esc(piece.text);
      const fixed = piece.mono ? `<code>${words}</code>` : words;
      const set = piece.bold ? `<b>${fixed}</b>` : fixed;
      return piece.href === undefined ? set : `<a href="${esc(piece.href)}">${set}</a>`;
    })
    .join("");
}

/**
 * A section's verdict line: its first sentence in bold, as the mockup sets it, and the rest as it
 * is. `text` is plain words, escaped here. A sentence ends at a ".", "!", or "?" that a space or the
 * end follows, so a version number in it ("0.4.1") never ends it.
 */
export function verdictLine(text: string): string {
  return `<p class="prob-verdict">${lineHtml(firstSentenceBold(text))}</p>`;
}

/**
 * A whole number as the page writes it, on any computer: "1,204". It lives in ../format.ts, so a
 * copy with no markup writes it the same way.
 */
export { count };

/** A part of a track as a percentage, to two decimals. A bare 0 for none. */
function percent(part: number, total: number): string {
  if (!(part > 0) || !(total > 0)) return "0";
  return `${Number(((part / total) * 100).toFixed(2))}%`;
}

/**
 * Rectangles laid end to end along a track that holds `total`, each as wide as its share. They
 * never run past the end of the track, whatever they add up to, and a segment with nothing in it
 * draws nothing.
 */
function rectangles(segments: { value: number; kind: string }[], total: number): string {
  let used = 0;
  return segments
    .map(({ value, kind }) => {
      const width = Math.min(value, total - used);
      if (!(width > 0)) return "";
      const start = used;
      used += width;
      return `<rect class="c-${idFragment(kind)}" x="${percent(start, total)}" y="0" width="${percent(width, total)}" height="100%" fill="currentColor"/>`;
    })
    .join("");
}

/**
 * A bar with no numbers of its own, for a row that has them beside it as text (a label and a
 * count). It's hidden from screen readers, since the row says it all.
 */
export function track(value: number, total: number, kind: string): string {
  return `<svg class="track" width="100%" height="10" aria-hidden="true">${rectangles([{ value, kind }], total)}</svg>`;
}

/** The strip's own units: its width and height, and the line its bars stand on. */
const STRIP = { width: 300, height: 36, top: 4, base: 34, gap: 0.8, least: 1.5 } as const;

/** A number as a short decimal: at most two places, none when they'd be zeros. */
const decimal = (value: number): number => Number(value.toFixed(2));

/** A length of time as a screen reader says it: "55.1 seconds". */
const spoken = (ms: number): string => seconds(ms).replace(/ s$/, " seconds");

/** A measure that can be drawn: a finite number, and never below nothing. */
const measure = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

/**
 * One bar for each line NVDA spoke: as wide as the line took (the widths share the strip's width
 * by time) and as tall as the square root of its length (the longest line fills the strip's
 * height), all standing on one line. The root keeps one long line from flattening the rest.
 *
 * The strip is an image named `label` and summed up in words: how many lines, over how long, and
 * how long the longest took. A line with no time shares equally when none has any, and a line with
 * no words still shows, as the least height.
 */
export function strip(lines: { ms: number; chars: number }[], label: string): string {
  const open = `<svg class="strip" viewBox="0 0 ${STRIP.width} ${STRIP.height}" width="${STRIP.width}" height="${STRIP.height}" preserveAspectRatio="none" role="img"`;
  if (lines.length === 0) return `${open} aria-label="${esc(`${label}: no lines`)}"></svg>`;

  const measured = lines.map(({ ms, chars }) => ({
    ms: measure(ms),
    root: Math.sqrt(measure(chars)),
  }));
  const total = measured.reduce((sum, { ms }) => sum + ms, 0);
  const longest = measured.reduce((most, { ms }) => Math.max(most, ms), 0);
  const tallest = measured.reduce((most, { root }) => Math.max(most, root), 0);

  // The gaps narrow with the number of lines, so a long pass still fits: half a gap at each end.
  const gap = Math.min(STRIP.gap, (STRIP.width * 0.1) / lines.length);
  const room = STRIP.width - gap * lines.length;
  let x = gap / 2;
  const bars = measured.map(({ ms, root }) => {
    const width = total > 0 ? (room * ms) / total : room / lines.length;
    const height =
      tallest > 0
        ? Math.max(STRIP.least, ((STRIP.base - STRIP.top) * root) / tallest)
        : STRIP.least;
    const rect = `<rect x="${decimal(x)}" y="${decimal(STRIP.base - height)}" width="${decimal(width)}" height="${decimal(height)}" rx="1.2"/>`;
    x += width + gap;
    return rect;
  });

  const sum = `${plural(lines.length, "line")} over ${spoken(total)}; the longest took ${spoken(longest)}`;
  return `${open} aria-label="${esc(`${label}: ${sum}`)}">${bars.join("")}</svg>`;
}

/** A part of the ring of the pages: what it counts, how many pages are in it, and its kind. */
export interface RingPart {
  label: string;
  value: number;
  kind: "ok" | "warn" | "bad";
}

/** The ring's circle in its picture's 120 by 120 units: its middle, its radius, and how wide it is. */
const RING = { middle: 60, radius: 48, width: 16 } as const;

/** The circle's own attributes, which its track and every arc share: they are drawn on one circle. */
const CIRCLE_SHAPE = `cx="${RING.middle}" cy="${RING.middle}" r="${RING.radius}" fill="none" stroke-width="${RING.width}"`;

/** How long the circle is, 2π × 48, to two places: 301.59. Every arc takes its share of it. */
const CIRCUMFERENCE = decimal(2 * Math.PI * RING.radius);

/**
 * The ring of the pages, and, apart from it, its legend: two sibling elements.
 *
 * The ring is a picture, hidden from screen readers, of one circle with an arc for each part that has
 * pages in it, as long as its share of `total`, one after another from the top, clockwise, and with
 * the number of pages in its middle. A part with no pages draws no arc, and no arc runs past the
 * circle's end, whatever the parts add up to; with the parts adding up to `total`, a ring of one part
 * is the whole circle.
 *
 * An arc is the circle itself, drawn as one dash as long as the arc (`stroke-dasharray`: the dash,
 * then a gap that makes the length up to the circle's, so that it never repeats), moved forward
 * along the circle to where the arc starts (`stroke-dashoffset`). A circle starts at three o'clock,
 * so the picture is turned a quarter turn back. The style block gives the track and each kind its
 * stroke.
 *
 * The legend is what a screen reader gets, and what a reader who can't tell the colors apart does: a
 * line for every part, those with no pages too, saying its words and its count. The list is named by
 * the total with its unit (`GLANCE_TEXT.ringName`, "7 pages"), the number the ring shows in its
 * middle, which a screen reader doesn't get from a picture it skips.
 */
export function ring(parts: RingPart[], total: number): string {
  let start = 0;
  const arcs = parts.flatMap(({ value, kind }) => {
    if (!(value > 0) || !(total > 0)) return [];
    const length = Math.min((CIRCUMFERENCE * value) / total, CIRCUMFERENCE - start);
    if (!(length > 0)) return [];
    const arc = `<circle class="ring-part ${idFragment(kind)}" ${CIRCLE_SHAPE} stroke-dasharray="${decimal(length)} ${decimal(CIRCUMFERENCE - length)}" stroke-dashoffset="${decimal(-start)}"/>`;
    start += length;
    return [arc];
  });
  const picture = `<svg viewBox="0 0 120 120" width="120" height="120"><g transform="rotate(-90 ${RING.middle} ${RING.middle})"><circle class="ring-track" ${CIRCLE_SHAPE}/>${arcs.join("")}</g></svg>`;
  const middle = `<span class="ring-n">${count(total)}</span><span class="ring-k">${esc(GLANCE_TEXT.ringUnit(total))}</span>`;
  const legend = parts.map(
    ({ label, value, kind }) =>
      `<li class="${idFragment(kind)}"><span class="sw" aria-hidden="true"></span>${esc(label)}: <b>${count(value)}</b></li>`,
  );
  const name = esc(GLANCE_TEXT.ringName(total));
  return `<div class="ring" aria-hidden="true">${picture}${middle}</div><ul class="ring-legend" role="list" aria-label="${name}">${legend.join("")}</ul>`;
}
