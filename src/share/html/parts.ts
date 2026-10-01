/**
 * The parts every section of the shareable page draws with: a fold, a chip, a "Not recorded" line,
 * a scroll box, a verdict line, a bar, and the strip of spoken lines. Each returns HTML.
 *
 * None sets a `style` attribute: the page's Content Security Policy hashes its one style block and
 * allows nothing else. So sizes are attributes, and colors are classes the style block gives
 * their colors to (`c-ok`, `c-warn`, `c-bad`, and `c-quiet`, the chips' own), which an SVG shape
 * takes as its fill with `fill="currentColor"`.
 *
 * What the callers pass is HTML only where a parameter says so (a fold's summary line and body, and
 * what a scroll box holds); it is escaped by whoever builds it. Every other string is text, and
 * escaped here.
 */
import { esc, idFragment, plural } from "../../report/html.js";
import { seconds } from "../format.js";

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
  /** More classes for the details element, after "fold". */
  className?: string;
}

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
  const id = options.id === undefined ? "" : ` id="${esc(options.id)}"`;
  return `<details class="${esc(classes)}"${id}${options.open ? " open" : ""}><summary>${summary}</summary><div class="inside">${body}</div></details>`;
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
 * those words put in front, so a gap never reads as a pass.
 */
export function notRecorded(text: string): string {
  const line = text.trim();
  const said = /\bnot recorded\b/i.test(line) ? line : `Not recorded: ${line}`;
  return `<p class="not-recorded">${esc(said)}</p>`;
}

/**
 * A box a keyboard can reach (Tab) and scroll, and a screen reader names: every table that can be
 * wider than the page, and every block of code, sits in one. `inner` is HTML, already escaped.
 */
export function scroll(label: string, inner: string): string {
  return `<div class="scroll" tabindex="0" role="region" aria-label="${esc(label)}">${inner}</div>`;
}

/**
 * A section's verdict line: its first sentence in bold, as the mockup sets it, and the rest as it
 * is. `text` is plain words, escaped here. A sentence ends at a ".", "!", or "?" that a space or the
 * end follows, so a version number in it ("0.4.1") never ends it.
 */
export function verdictLine(text: string): string {
  const end = /[.!?](?=\s|$)/.exec(text);
  const cut = end === null ? text.length : end.index + 1;
  const rest = text.slice(cut).trim();
  return `<p class="prob-verdict"><b>${esc(text.slice(0, cut))}</b>${rest === "" ? "" : ` ${esc(rest)}`}</p>`;
}

/** A part of a bar: the number it counts, what it counts, and its color's kind. */
export interface BarSegment {
  label: string;
  value: number;
  kind: string;
}

/** A whole number as the page writes it, on any computer: "1,204". */
export const count = (value: number): string => value.toLocaleString("en-US");

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

/** The class a legend entry takes: "l-ok", "l-warn", "l-bad", and "l-q" for quiet. */
const legendClass = (kind: string): string => `l-${kind === "quiet" ? "q" : idFragment(kind)}`;

/**
 * A bar of segments as wide as their shares of `total`, with the numbers it shows in text beside
 * it as a legend: each segment's value and what it counts, so the bar never stands alone. The bar
 * is an image named `caption`, a sentence that gives its numbers too. It's two sibling elements,
 * the SVG and the legend.
 */
export function bar(segments: BarSegment[], total: number, caption: string): string {
  const legend = segments
    .map(
      ({ label, value, kind }) =>
        `<span class="${legendClass(kind)}"><b>${count(value)}</b> ${esc(label)}</span>`,
    )
    .join("");
  return `<svg class="bar" width="100%" height="14" role="img" aria-label="${esc(caption)}">${rectangles(segments, total)}</svg><div class="legend">${legend}</div>`;
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
