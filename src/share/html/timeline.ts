/**
 * "Minute by minute": each session of a run's event log as the page draws it, ported from the
 * approved mockup's run 1402 panel. For each session: its name, when the run's sessions are named
 * (`sessionLine`); the sentences that sum it up; its chart, an image those sentences name, in a box
 * a keyboard can reach and scroll sideways; its table of every event, to the millisecond, in a fold;
 * and, under the last, how many lines of the log couldn't be read. A session of the run the log has
 * no line of says so, and why, in its place among them.
 *
 * The chart has the mockup's lanes, named for the run's screen reader: the lock, voicecap's screen
 * reader, the pages, and the computer's own screen reader, off while voicecap ran. A lane with
 * nothing in it isn't drawn: a driver that records only the run's own events gives a chart of its
 * pages. Each span is a bar from its start to its end, on the session's own clock, with its words in
 * it where they fit: a process's id, a page's number, and the computer's own screen reader being
 * off. A page that failed is red, with a dashed line where it failed. The minutes are marked at a
 * step that keeps them to about 12, however long the session.
 *
 * Its words are the model's (the window's title is never in them) and ../text.ts's, each through
 * `esc`. No `style` attribute is set: the page's style block draws the chart's parts by the mockup's
 * own classes, and its print rule lets a chart narrow to the paper.
 */
import { esc, idFragment } from "../../report/html.js";
import { count } from "../format.js";
import { EVIDENCE_TEXT, TIMELINE_TEXT } from "../text.js";
import type { SessionTimeline, Span, UnloggedSession } from "../timeline.js";
import { recordTime, sessionLine } from "../words.js";
import { notRecorded, scroll } from "./parts.js";

/**
 * The chart's frame, in its viewBox's units, the mockup's: its width, the right edge of its plot,
 * where the minutes are written, where the grid starts, where the first lane is and how far apart
 * the lanes are, how tall a bar is, and the room left inside the plot's edges.
 */
const CHART = {
  width: 990,
  right: 970,
  axis: 32,
  gridTop: 40,
  laneTop: 56,
  pitch: 44,
  bar: 20,
  inset: 10,
  /** Where a failed page's line, and its words, begin. */
  failTop: 44,
  failText: 48,
} as const;

/** About how wide a character of the chart's words is, in its units: a lane's, the mono, the body. */
const CHAR = { lane: 7.2, mono: 7, body: 6.6 } as const;

/** The steps, in minutes, the chart can mark the minutes at: the first that gives at most 12. */
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440];
const MOST_TICKS = 12;
const MINUTE = 60_000;

/** A position as the chart writes it, to a tenth. */
const at = (value: number): string => value.toFixed(1);

/** A bar of a lane: its span, its class, and its words, when it has any. */
interface Bar {
  span: Span;
  className: string;
  label: { text: string; className: "t-in" | "t-note" } | null;
}

interface Lane {
  name: string;
  bars: Bar[];
}

/** The lanes a session's chart draws, in the mockup's order: only those with something in them. */
function lanesOf(timeline: SessionTimeline, sr: string): Lane[] {
  const { lanes } = TIMELINE_TEXT;
  const all: Lane[] = [
    {
      name: lanes.lock(sr),
      bars: timeline.lock.map((span) => ({ span, className: "b-lock", label: null })),
    },
    {
      name: lanes.screenReader(sr),
      bars: timeline.screenReader.map((span) => ({
        span,
        className: "b-nvda",
        label:
          span.pid === null ? null : { text: TIMELINE_TEXT.process(span.pid), className: "t-in" },
      })),
    },
    {
      name: lanes.pages,
      bars: timeline.pages.map((span) => ({
        span,
        className: span.failed ? "b-fail" : "b-page",
        label: { text: String(span.n), className: "t-in" },
      })),
    },
    {
      name: lanes.own(sr),
      bars: timeline.own.map((span) => ({
        span,
        className: "b-own",
        label: { text: TIMELINE_TEXT.off, className: "t-note" },
      })),
    },
  ];
  return all.filter((lane) => lane.bars.length > 0);
}

/** A local time's offset from UTC, in minutes: -300 for "-05:00". */
function offsetMinutes(iso: string): number {
  const found = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  if (found === null) return 0;
  const [, sign, hours = "0", minutes = "0"] = found;
  return (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

/**
 * The minutes the chart marks, from its first moment to its last, on the session's own clock (its
 * first event's offset): whole multiples of the first step that gives at most 12 of them.
 */
function ticksOf(fromIso: string, from: number, to: number): { ms: number; label: string }[] {
  const offset = offsetMinutes(fromIso) * MINUTE;
  let ticks: { ms: number; label: string }[] = [];
  for (const step of STEPS) {
    const size = step * MINUTE;
    ticks = [];
    for (
      let local = Math.ceil((from + offset) / size) * size;
      local <= to + offset;
      local += size
    ) {
      ticks.push({ ms: local - offset, label: new Date(local).toISOString().slice(11, 16) });
    }
    if (ticks.length <= MOST_TICKS) break;
  }
  return ticks;
}

/**
 * A session's chart: an image named by its title and the sentences above it (`labelledBy`), with a
 * lane for each of `lanes`, the minutes marked across its top, and a dashed line where each page
 * failed. A session shorter than a minute is drawn across a minute.
 */
function chartOf(
  timeline: SessionTimeline,
  lanes: Lane[],
  title: { id: string; text: string },
  labelledBy: string,
): string {
  const gutter = Math.max(130, 30 + Math.max(...lanes.map(({ name }) => name.length * CHAR.lane)));
  const from = Date.parse(timeline.from);
  const to = Math.max(Date.parse(timeline.to), from + MINUTE);
  const left = gutter + CHART.inset;
  const right = CHART.right - CHART.inset;
  const x = (ms: number) => left + ((ms - from) / (to - from)) * (right - left);
  const gridBottom = CHART.laneTop + (lanes.length - 1) * CHART.pitch + CHART.bar + 6;

  const ticks = ticksOf(timeline.from, from, to).map(({ ms, label }) => {
    const across = at(x(ms));
    return `<line x1="${across}" x2="${across}" y1="${CHART.gridTop}" y2="${gridBottom}" class="grid"/><text x="${across}" y="${CHART.axis}" class="t-axis" text-anchor="middle">${esc(label)}</text>`;
  });
  const drawn = lanes.map((lane, index) => {
    const top = CHART.laneTop + index * CHART.pitch;
    const name = `<text x="16" y="${top + 14}" class="t-lane">${esc(lane.name)}</text>`;
    const bars = lane.bars.map(({ span, className, label }) => {
      const start = x(Date.parse(span.from));
      const width = Math.max(2, x(Date.parse(span.to)) - start);
      const rect = `<rect x="${at(start)}" y="${top}" width="${at(width)}" height="${CHART.bar}" rx="4" class="${className}"/>`;
      const room =
        label === null
          ? 0
          : label.text.length * CHAR[label.className === "t-in" ? "mono" : "body"] + 8;
      return label === null || room > width
        ? rect
        : `${rect}<text x="${at(start + width / 2)}" y="${top + 14}" class="${label.className}" text-anchor="middle">${esc(label.text)}</text>`;
    });
    return name + bars.join("");
  });
  // Where each page failed: a dashed line, and its words after it (before it, near the chart's right
  // edge), unless they'd run into the words of the failure before it.
  let clear = -Infinity;
  const failures = timeline.pages
    .filter(({ failed }) => failed)
    .map(({ n, to: failedAt }) => {
      const across = x(Date.parse(failedAt));
      const line = `<line x1="${at(across)}" x2="${at(across)}" y1="${CHART.failTop}" y2="${gridBottom}" class="fail-line"/>`;
      const words = TIMELINE_TEXT.failed(n);
      const wide = words.length * CHAR.body;
      const after = across + 6 + wide <= CHART.width - 6;
      const begins = after ? across + 6 : across - 6 - wide;
      if (begins < clear + 8) return line;
      clear = begins + wide;
      const anchor = after
        ? `x="${at(begins)}" text-anchor="start"`
        : `x="${at(begins + wide)}" text-anchor="end"`;
      return `${line}<text ${anchor} y="${CHART.failText}" class="t-fail">${esc(words)}</text>`;
    });
  const height = gridBottom + 22;
  return `<svg class="timeline" viewBox="0 0 ${CHART.width} ${height}" role="img" aria-labelledby="${esc(labelledBy)}"><title id="${esc(title.id)}">${esc(title.text)}</title>${ticks.join("")}${drawn.join("")}${failures.join("")}</svg>`;
}

/**
 * A session's table of every event, to the millisecond, in a fold whose line says how many: a row
 * for each, marked with its kind (`ev-<kind>`), its time to the millisecond in the fixed-width font,
 * in a box a keyboard can reach and scroll.
 */
function eventsFold(timeline: SessionTimeline, which: string): string {
  const head = TIMELINE_TEXT.head.map((words) => `<th scope="col">${esc(words)}</th>`).join("");
  const rows = timeline.rows.map(
    ({ time, text, kind }) =>
      `<tr class="ev-${esc(kind)}"><td class="mono">${esc(recordTime(time))}</td><td>${esc(text)}</td></tr>`,
  );
  const table = `<table class="plain"><caption class="sr">${esc(`Every event, ${which}`)}</caption><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  const box = `<div class="events" tabindex="0" role="region" aria-label="${esc(`Every event, ${which}, table`)}">${table}</div>`;
  return `<details class="log"><summary>${esc(TIMELINE_TEXT.fold(count(timeline.rows.length)))}</summary>${box}</details>`;
}

/**
 * A session: its name, when the run's sessions are named; its summary; its chart, when it has
 * a lane to draw; its table of events; and the lines of the log that couldn't be read, when any.
 * `run` is the run's id, and `sr` its screen reader. Each part's id, and each box's name, says the run
 * and, where the sessions are named, the session, so no two are the same on the page.
 */
function sessionOf(
  timelines: SessionTimeline[],
  timeline: SessionTimeline,
  run: string,
  sr: string,
  unlogged: UnloggedSession[],
): string {
  const named = sessionLine(timelines, timeline, unlogged);
  const which = named === null ? `run ${run}` : `run ${run}, session ${timeline.session}`;
  const id = `tl-${idFragment(run)}-${timeline.session}`;
  const summary =
    timeline.summary.length === 0
      ? ""
      : `<p class="t-sum" id="${esc(id)}-sum">${esc(timeline.summary.join(" "))}</p>`;
  const lanes = lanesOf(timeline, sr);
  const title = { id: `${id}-title`, text: `${EVIDENCE_TEXT.parts.timeline}, ${which}` };
  const labelledBy = summary === "" ? title.id : `${title.id} ${id}-sum`;
  const chart =
    lanes.length === 0
      ? ""
      : scroll(`${title.text}, chart`, chartOf(timeline, lanes, title, labelledBy));
  const unreadable =
    timeline.unreadable > 0 ? `<p>${esc(TIMELINE_TEXT.unreadable(timeline.unreadable))}</p>` : "";
  const heading = named === null ? "" : `<h4>${esc(named)}</h4>`;
  return `<div class="t-session">${heading}${summary}${chart}${eventsFold(timeline, which)}${unreadable}</div>`;
}

/**
 * Each session of a run, in order: `run` is the run's id, and `sr` its screen reader. A session the
 * log has no line of (`unlogged`) says why in its place, so none is left out without a word.
 */
export function renderTimelines(
  timelines: SessionTimeline[],
  run: string,
  sr: string,
  unlogged: UnloggedSession[] = [],
): string {
  const sessions = [
    ...timelines.map((timeline) => ({
      n: timeline.session,
      html: sessionOf(timelines, timeline, run, sr, unlogged),
    })),
    ...unlogged.map(({ session, notRecorded: said }) => ({
      n: session,
      html: `<div class="t-session">${notRecorded(said)}</div>`,
    })),
  ];
  return sessions
    .sort((a, b) => a.n - b.n)
    .map(({ html }) => html)
    .join("");
}
