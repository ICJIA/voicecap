/**
 * Each session of a run as its event log tells it (src/share/timeline.ts): the spans the chart
 * draws, the sentences that sum it up, and a row in the page's words for every event; and how the
 * chart and the table draw them (src/share/html/timeline.ts). Pure: the events are written here, as
 * the NVDA driver and the run write them (test/helpers/share-model.ts's loggedRun). A window's
 * title, which the log keeps, reaches none of it.
 */
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { NewRunEvent, RunEvent } from "../src/model.js";
import { redactHome } from "../src/run/failure.js";
import { renderSharePage } from "../src/share/html/document.js";
import { renderTimelines } from "../src/share/html/timeline.js";
import {
  attemptEvents,
  attemptWindow,
  eventText,
  eventWordsOf,
  timelinesOf,
  type EventWords,
  type SessionTimeline,
} from "../src/share/timeline.js";
import { wordsOf } from "../src/share/word/blocks.js";
import { wordOutline } from "../src/share/word/outline.js";
import { SITE } from "./helpers/report-data.js";
import { shareRun } from "./helpers/share-data.js";
import { attributes, textOf } from "./helpers/share-html.js";
import { logged, loggedModel, loggedRun, PRIVATE_TITLE } from "./helpers/share-model.js";

const home = os.homedir();
const redact = (text: string) => redactHome(text, home, process.platform);
/** What the home folder is shown as. */
const REPLACED = process.platform === "win32" ? "%USERPROFILE%" : "~";

/** The logged run's words: each page by its label, and its number in the run. */
function wordsOfLogged(): EventWords {
  return eventWordsOf(loggedRun().run, (page) => page.label ?? page.url, redact);
}

/** The logged run's timelines. */
function loggedTimelines(): SessionTimeline[] {
  const { run, log } = loggedRun();
  return timelinesOf(run, log, wordsOfLogged());
}

/** The timeline of one session, which a test reads by its place. */
function sessionAt(timelines: SessionTimeline[], at: number): SessionTimeline {
  const found = timelines[at];
  if (found === undefined) throw new Error(`No session at ${at}`);
  return found;
}

const DAY = "2026-09-26";
/** An event of 26 September 2026. */
const on = (time: string, event: NewRunEvent): RunEvent => logged(DAY, time, event);
/** A time of 26 September 2026, as the log writes it. */
const at = (time: string) => `${DAY}T${time}-05:00`;

/** The three pages of the runs written here, as their records name them. */
const HOME = SITE;
const APPLY = `${SITE}apply/`;
const CONTACT = `${SITE}contact/`;

/** Words for the runs written here: each page by its path, numbered as in the logged run. */
const WORDS: EventWords = {
  screenReader: "NVDA",
  pageName: (url) => new URL(url).pathname,
  pageNumber: (url) => [HOME, APPLY, CONTACT].indexOf(url) + 1,
  redact,
};

/** A session written here: run-started first and run-ended last, the events between them. */
function session(events: RunEvent[], end = "14:09:00.000"): RunEvent[] {
  return [
    on("14:00:00.000", { type: "run-started", session: 1, resumed: false }),
    ...events,
    on(end, { type: "run-ended", session: 1, reason: "completed" }),
  ];
}

/** The timelines of events written here, with WORDS. */
function timelinesFor(events: RunEvent[], unreadable = 0): SessionTimeline[] {
  return timelinesOf(loggedRun().run, { events, unreadable }, WORDS);
}

describe("timelinesOf", () => {
  it("gives one timeline per session, from its start to its end, however far apart", () => {
    const timelines = loggedTimelines();

    expect(timelines.map(({ session, from, to }) => ({ session, from, to }))).toEqual([
      {
        session: 1,
        from: "2026-09-26T14:02:51.307-05:00",
        to: "2026-09-26T14:06:30.000-05:00",
      },
      {
        session: 2,
        from: "2026-09-28T09:00:00.120-05:00",
        to: "2026-09-28T09:02:10.000-05:00",
      },
    ]);
  });

  it("draws the lock from when voicecap took it to when it let it go, each time", () => {
    const [first, second] = loggedTimelines();

    // A restart lets go of the lock and takes it again.
    expect(first?.lock).toEqual([
      { from: at("14:02:51.320"), to: at("14:04:44.150") },
      { from: at("14:04:44.160"), to: at("14:06:29.966") },
    ]);
    expect(second?.lock).toEqual([
      { from: "2026-09-28T09:00:00.130-05:00", to: "2026-09-28T09:02:09.910-05:00" },
    ]);
  });

  it("draws each process of voicecap's screen reader, from its start to its stop", () => {
    const [first, second] = loggedTimelines();

    expect(first?.screenReader).toEqual([
      { from: at("14:02:56.681"), to: at("14:04:43.900"), pid: 65720 },
      { from: at("14:04:45.729"), to: at("14:06:28.174"), pid: 54568 },
    ]);
    expect(second?.screenReader).toEqual([
      { from: "2026-09-28T09:00:05.310-05:00", to: "2026-09-28T09:02:05.500-05:00", pid: 40400 },
    ]);
  });

  it("draws the computer's own screen reader as off, from its shutdown to its start again", () => {
    const [first] = loggedTimelines();

    expect(first?.own).toEqual([{ from: at("14:02:56.418"), to: at("14:06:29.965") }]);
  });

  it("draws each attempt at a page, numbered as in the run, and marks the one that failed", () => {
    const [first, second] = loggedTimelines();

    expect(first?.pages).toEqual([
      { from: at("14:03:00.000"), to: at("14:03:55.000"), n: 1, failed: false },
      { from: at("14:03:56.000"), to: at("14:04:41.300"), n: 2, failed: true },
      { from: at("14:04:48.000"), to: at("14:05:40.000"), n: 2, failed: false },
    ]);
    expect(second?.pages).toEqual([
      {
        from: "2026-09-28T09:00:08.000-05:00",
        to: "2026-09-28T09:01:02.000-05:00",
        n: 3,
        failed: false,
      },
    ]);
  });

  it("sums each session up: the lock, the processes, the computer's own screen reader, and the pages", () => {
    const [first, second] = loggedTimelines();

    // The lock was let go and taken again within a second, which a time to the minute can't show:
    // the first sentence says it once.
    expect(first?.summary).toEqual([
      "voicecap held the NVDA lock from 14:02 to 14:06.",
      "voicecap's NVDA ran as process 65720, then 54568.",
      "The computer's own NVDA was shut down at 14:02 and started again at 14:06.",
      "2 pages ran in order; page 2 failed at 14:04.",
    ]);
    expect(second?.summary).toEqual([
      "voicecap held the NVDA lock from 09:00 to 09:02.",
      "voicecap's NVDA ran as process 40400.",
      "The computer's own NVDA was shut down at 09:00 and started again at 09:02.",
      "1 page ran in order.",
    ]);
  });

  it("says each time the lock was let go for longer, and each page that failed", () => {
    const [timeline] = timelinesFor(
      session([
        on("14:00:01.000", { type: "screen-reader-lock-taken" }),
        on("14:00:10.000", { type: "page-started", page: HOME, attempt: 1 }),
        on("14:01:10.000", {
          type: "page-failed",
          page: HOME,
          attempt: 1,
          cause: "http",
          message: "HTTP 503",
        }),
        on("14:01:20.000", { type: "screen-reader-lock-released" }),
        on("14:03:30.000", { type: "screen-reader-lock-taken" }),
        on("14:03:40.000", { type: "page-started", page: APPLY, attempt: 1 }),
        on("14:04:40.000", { type: "page-finished", page: APPLY, attempt: 1, status: "done" }),
        on("14:04:41.000", { type: "page-started", page: CONTACT, attempt: 1 }),
        on("14:05:12.500", {
          type: "page-failed",
          page: CONTACT,
          attempt: 1,
          cause: "locked",
          message: "Windows is locked",
        }),
        on("14:05:20.000", { type: "screen-reader-lock-released" }),
      ]),
    );

    expect(timeline?.summary).toEqual([
      "voicecap held the NVDA lock from 14:00 to 14:01, then from 14:03 to 14:05.",
      "3 pages ran in order; page 1 failed at 14:01; page 3 failed at 14:05.",
    ]);
  });

  it("says only what applies: a run's own events, with no screen reader's, sum up as its pages", () => {
    // What a driver that records nothing of its own leaves: the run's events alone.
    const [timeline] = timelinesFor(
      session([
        on("14:00:10.000", { type: "page-started", page: HOME, attempt: 1 }),
        on("14:01:10.000", { type: "page-finished", page: HOME, attempt: 1, status: "done" }),
        on("14:01:11.000", { type: "page-started", page: APPLY, attempt: 1 }),
        on("14:02:00.000", { type: "page-finished", page: APPLY, attempt: 1, status: "skipped" }),
      ]),
    );

    expect(timeline?.lock).toEqual([]);
    expect(timeline?.screenReader).toEqual([]);
    expect(timeline?.own).toEqual([]);
    expect(timeline?.pages).toHaveLength(2);
    expect(timeline?.summary).toEqual(["2 pages ran in order."]);
  });

  it("lists every event of a session as a row, in the order recorded, with its kind and its words", () => {
    const [first, second] = loggedTimelines();

    expect(first?.rows).toEqual([
      { time: at("14:02:51.307"), kind: "run", text: "The run started" },
      { time: at("14:02:51.320"), kind: "lock", text: "voicecap took the NVDA lock" },
      {
        time: at("14:02:56.418"),
        kind: "own",
        text: "The computer's own NVDA was shut down while voicecap ran: process 55892",
      },
      {
        time: at("14:02:56.681"),
        kind: "screen-reader",
        text: "voicecap's NVDA started: process 65720",
      },
      { time: at("14:02:58.102"), kind: "browser", text: "The browser started: process 7001" },
      { time: at("14:03:00.000"), kind: "page", text: "Page 1 started: Home" },
      { time: at("14:03:55.000"), kind: "page", text: "Page 1 read in full: Home" },
      { time: at("14:03:55.400"), kind: "browser", text: "The browser started: process 7002" },
      { time: at("14:03:55.900"), kind: "browser", text: "The browser closed: process 7001" },
      { time: at("14:03:56.000"), kind: "page", text: "Page 2 started: Apply" },
      {
        time: at("14:04:41.250"),
        kind: "fail",
        text: "Another window came to the front: Microsoft Teams",
      },
      {
        time: at("14:04:41.300"),
        kind: "fail",
        text: "Page 2 failed: another window took the screen",
      },
      {
        time: at("14:04:41.350"),
        kind: "screen-reader",
        text: "voicecap restarted NVDA: to try Apply again (attempt 2 of 5)",
      },
      {
        time: at("14:04:43.900"),
        kind: "screen-reader",
        text: "voicecap's NVDA stopped: process 65720, to restart",
      },
      { time: at("14:04:44.100"), kind: "browser", text: "The browser closed: process 7002" },
      { time: at("14:04:44.150"), kind: "lock", text: "voicecap released the NVDA lock" },
      { time: at("14:04:44.160"), kind: "lock", text: "voicecap took the NVDA lock" },
      {
        time: at("14:04:45.729"),
        kind: "screen-reader",
        text: "voicecap's NVDA started: process 54568",
      },
      { time: at("14:04:47.000"), kind: "browser", text: "The browser started: process 7003" },
      { time: at("14:04:48.000"), kind: "page", text: "Page 2 started: Apply (attempt 2)" },
      { time: at("14:05:40.000"), kind: "page", text: "Page 2 read in full: Apply" },
      {
        time: at("14:06:28.174"),
        kind: "screen-reader",
        text: "voicecap's NVDA stopped: process 54568",
      },
      { time: at("14:06:28.300"), kind: "browser", text: "The browser closed: process 7003" },
      { time: at("14:06:29.965"), kind: "own", text: "The computer's own NVDA was started again" },
      { time: at("14:06:29.966"), kind: "lock", text: "voicecap released the NVDA lock" },
      {
        time: at("14:06:30.000"),
        kind: "run",
        text: "The run ended: stopped by the person running it",
      },
    ]);
    expect(second?.rows.map(({ text }) => text)).toEqual([
      "The run resumed (session 2)",
      "voicecap took the NVDA lock",
      "The computer's own NVDA was shut down while voicecap ran: process 61234",
      "voicecap's NVDA started: process 40400",
      "The browser started: process 7101",
      "Page 3 started: Contact",
      "Page 3 read in full: Contact",
      "voicecap's NVDA stopped: process 40400",
      "The browser closed: process 7101",
      "The computer's own NVDA was started again",
      "voicecap released the NVDA lock",
      "The run ended: complete",
    ]);
    // Every event is in one session's rows, each once.
    const { log } = loggedRun();
    expect(loggedTimelines().flatMap(({ rows }) => rows)).toHaveLength(log.events.length);
  });

  it("shows an event of a type it doesn't know as its type", () => {
    const [timeline] = timelinesFor(
      session([
        on("14:00:05.000", { type: "screen-reader-paused", for: 3 } as unknown as NewRunEvent),
      ]),
    );

    expect(timeline?.rows[1]).toEqual({
      time: at("14:00:05.000"),
      kind: "run",
      text: "screen-reader-paused",
    });
  });

  it("carries the lines of the log it couldn't read, on the last session, since no line says which it was", () => {
    const { run, log } = loggedRun();
    const timelines = timelinesOf(run, { ...log, unreadable: 2 }, wordsOfLogged());

    expect(timelines.map(({ unreadable }) => unreadable)).toEqual([0, 2]);
    expect(loggedTimelines().map(({ unreadable }) => unreadable)).toEqual([0, 0]);
  });

  it("counts an event whose time isn't a time as a line it couldn't read, and leaves it out", () => {
    const odd = { at: "yesterday", type: "screen-reader-lock-taken" } as RunEvent;
    const [timeline] = timelinesFor(session([odd]), 1);

    expect(timeline?.unreadable).toBe(2);
    expect(timeline?.rows.map(({ text }) => text)).toEqual([
      "The run started",
      "The run ended: complete",
    ]);
    expect(timeline?.lock).toEqual([]);
  });

  it("numbers each session after the one before it, even where a log numbers two alike", () => {
    // A hand-edited log, or one written by hand: the page names each session's parts by its number.
    const timelines = timelinesFor([
      on("14:00:00.000", { type: "run-started", session: 1, resumed: false }),
      on("14:00:20.000", { type: "run-ended", session: 1, reason: "interrupted" }),
      on("15:00:00.000", { type: "run-started", session: 1, resumed: true }),
      on("15:01:10.000", { type: "run-ended", session: 1, reason: "completed" }),
    ]);

    expect(timelines.map(({ session }) => session)).toEqual([1, 2]);
  });

  it("gives an attempt Ctrl+C stopped, whose number the next session takes again, to its own session", () => {
    const timelines = timelinesFor([
      on("14:00:00.000", { type: "run-started", session: 1, resumed: false }),
      on("14:00:10.000", { type: "page-started", page: APPLY, attempt: 1 }),
      on("14:00:20.000", { type: "run-ended", session: 1, reason: "interrupted" }),
      on("15:00:00.000", { type: "run-started", session: 2, resumed: true }),
      on("15:00:10.000", { type: "page-started", page: APPLY, attempt: 1 }),
      on("15:01:00.000", { type: "page-finished", page: APPLY, attempt: 1, status: "done" }),
      on("15:01:10.000", { type: "run-ended", session: 2, reason: "completed" }),
    ]);

    // Stopped midway, so it ran until its session ended, and didn't fail.
    expect(timelines.map(({ pages }) => pages)).toEqual([
      [{ from: at("14:00:10.000"), to: at("14:00:20.000"), n: 2, failed: false }],
      [{ from: at("15:00:10.000"), to: at("15:01:00.000"), n: 2, failed: false }],
    ]);
  });

  describe("the computer's own screen reader, which the log can leave unpaired", () => {
    it("never says it wasn't started again when the log doesn't say so: off until the log ends", () => {
      // A restore put off until voicecap exits: the exit starts it, after the log has closed.
      const [timeline] = timelinesFor(
        session([on("14:00:05.000", { type: "own-screen-reader-closed", pids: [4321] })]),
      );

      expect(timeline?.own).toEqual([{ from: at("14:00:05.000"), to: at("14:09:00.000") }]);
      expect(timeline?.summary).toEqual(["The computer's own NVDA was shut down at 14:00."]);
      expect(timeline?.summary.join(" ")).not.toMatch(/never|wasn't|not started/i);
    });

    it("says it couldn't be started again only where the log says so", () => {
      const [timeline] = timelinesFor(
        session([
          on("14:00:05.000", { type: "own-screen-reader-closed", pids: [4321, 4322] }),
          on("14:08:00.000", { type: "own-screen-reader-restarted", ok: false }),
        ]),
      );

      expect(timeline?.own).toEqual([{ from: at("14:00:05.000"), to: at("14:09:00.000") }]);
      expect(timeline?.summary).toEqual(["The computer's own NVDA was shut down at 14:00."]);
      expect(timeline?.rows.map(({ text }) => text).slice(1, 3)).toEqual([
        "The computer's own NVDA was shut down while voicecap ran: process 4321, 4322",
        "The computer's own NVDA couldn't be started again",
      ]);
    });

    it("draws nothing for a start again that no shutdown came before, as after a start that failed", () => {
      const [timeline] = timelinesFor(
        session([on("14:08:00.000", { type: "own-screen-reader-restarted", ok: true })]),
      );

      expect(timeline?.own).toEqual([]);
      expect(timeline?.summary).toEqual([]);
      expect(timeline?.rows[1]?.text).toBe("The computer's own NVDA was started again");
    });
  });

  it("reads each event's fields for what they are, and shows one it can't read as its type", () => {
    const odd = (event: Record<string, unknown>) =>
      ({ at: at("14:00:05.000"), ...event }) as RunEvent;
    const [timeline] = timelinesFor(
      session([
        odd({ type: "screen-reader-started", pid: "65720" }),
        odd({ type: "page-started", page: 7, attempt: 1 }),
        odd({ type: "page-finished", page: HOME, attempt: 1, status: "maybe" }),
        odd({ type: "screen-reader-restarting", reason: { kind: "whim" } }),
        odd({ type: "run-ended", session: 1, reason: "boredom" }),
        odd({ type: "page-started", page: `${SITE}not-in-the-run/`, attempt: 1 }),
      ]),
    );

    expect(timeline?.rows.map(({ text }) => text).slice(1, -1)).toEqual([
      // A process id that isn't a number is no id: the event says so without one.
      "voicecap's NVDA started",
      "page-started",
      "page-finished",
      "screen-reader-restarting",
      "run-ended",
      "page-started",
    ]);
    // The screen reader still ran, as far as the log shows: from its start to the session's end.
    expect(timeline?.screenReader).toEqual([
      { from: at("14:00:05.000"), to: at("14:09:00.000"), pid: null },
    ]);
    expect(timeline?.summary).toEqual(["voicecap's NVDA ran."]);
    expect(timeline?.pages).toEqual([]);
  });
});

describe("eventText", () => {
  const words = WORDS;
  const say = (event: NewRunEvent) => eventText({ at: at("14:00:00.000"), ...event }, words);

  it.each<[NewRunEvent, string]>([
    [{ type: "run-started", session: 1, resumed: false }, "The run started"],
    [{ type: "run-started", session: 3, resumed: true }, "The run resumed (session 3)"],
    [{ type: "run-ended", session: 1, reason: "completed" }, "The run ended: complete"],
    [
      { type: "run-ended", session: 1, reason: "interrupted" },
      "The run ended: stopped by the person running it",
    ],
    [
      { type: "run-ended", session: 1, reason: "environment-failure" },
      "The run ended: stopped by a problem on the computer",
    ],
    [
      { type: "run-ended", session: 1, reason: "error" },
      "The run ended: stopped by an unexpected error",
    ],
    [{ type: "screen-reader-lock-taken" }, "voicecap took the NVDA lock"],
    [{ type: "screen-reader-lock-released" }, "voicecap released the NVDA lock"],
    [{ type: "screen-reader-started", pid: 65720 }, "voicecap's NVDA started: process 65720"],
    [{ type: "screen-reader-started", pid: null }, "voicecap's NVDA started"],
    [
      { type: "screen-reader-stopped", pid: 65720, restarting: false },
      "voicecap's NVDA stopped: process 65720",
    ],
    [
      { type: "screen-reader-stopped", pid: 65720, restarting: true },
      "voicecap's NVDA stopped: process 65720, to restart",
    ],
    [
      { type: "screen-reader-restarting", reason: { kind: "every", pages: 10 } },
      "voicecap restarted NVDA: after every 10 pages",
    ],
    [
      { type: "screen-reader-restarting", reason: { kind: "failed-page" } },
      "voicecap restarted NVDA: after a failed page",
    ],
    [
      {
        type: "screen-reader-restarting",
        reason: { kind: "retry", page: APPLY, attempt: 2, of: 5 },
      },
      "voicecap restarted NVDA: to try /apply/ again (attempt 2 of 5)",
    ],
    [
      { type: "own-screen-reader-closed", pids: [55892] },
      "The computer's own NVDA was shut down while voicecap ran: process 55892",
    ],
    [
      { type: "own-screen-reader-restarted", ok: true },
      "The computer's own NVDA was started again",
    ],
    [
      { type: "own-screen-reader-restarted", ok: false },
      "The computer's own NVDA couldn't be started again",
    ],
    [{ type: "browser-launched", pid: 7001 }, "The browser started: process 7001"],
    [{ type: "browser-closed", pid: 7001 }, "The browser closed: process 7001"],
    [
      { type: "browser-handed-over" },
      "The browser handed over to a new copy of itself to finish an update",
    ],
    [{ type: "page-started", page: APPLY, attempt: 1 }, "Page 2 started: /apply/"],
    [{ type: "page-started", page: APPLY, attempt: 3 }, "Page 2 started: /apply/ (attempt 3)"],
    [
      { type: "page-finished", page: APPLY, attempt: 1, status: "done" },
      "Page 2 read in full: /apply/",
    ],
    [
      { type: "page-finished", page: APPLY, attempt: 1, status: "skipped" },
      "Page 2 skipped: /apply/",
    ],
    [
      { type: "page-failed", page: APPLY, attempt: 1, cause: "step-timeout", message: "x" },
      "Page 2 failed: a step took too long",
    ],
    [
      { type: "page-failed", page: APPLY, attempt: 1, cause: "unexpected", message: "x" },
      "Page 2 failed: an unexpected error",
    ],
    [{ type: "computer-locked" }, "The computer was locked"],
    [
      { type: "foreground-lost", program: "Microsoft Teams", title: PRIVATE_TITLE },
      "Another window came to the front: Microsoft Teams",
    ],
    [
      { type: "foreground-lost", program: null, title: PRIVATE_TITLE },
      "Another window came to the front",
    ],
    [
      { type: "screen-reader-log", file: "nvda-log/1-2.txt", reason: null },
      "voicecap kept a copy of NVDA's own log: nvda-log/1-2.txt",
    ],
    [
      { type: "screen-reader-log", file: null, reason: "NVDA's log wasn't there." },
      "voicecap kept no copy of NVDA's own log: NVDA's log wasn't there.",
    ],
    [
      { type: "screen-reader-log", file: null, reason: null },
      "voicecap kept no copy of NVDA's own log",
    ],
  ])("says %j as the page words it", (event, text) => {
    expect(say(event)).toBe(text);
  });

  it("names the screen reader in the words of its own log, and shows the home folder as it does everywhere", () => {
    const voiceOver = { ...words, screenReader: "VoiceOver" };
    const reason = `EBUSY: ${path.join(home, "AppData", "Local", "Temp", "nvda.log")}`;
    const event = { type: "screen-reader-log", file: null, reason } as const;

    expect(eventText({ at: at("14:00:00.000"), ...event }, voiceOver)).toContain(
      "voicecap kept no copy of VoiceOver's own log: EBUSY: ",
    );
    expect(say(event)).not.toContain(home);
    expect(say(event)).toContain(REPLACED);
    // A path the record gives for a copy is a record's too: the page never shows the account's name.
    const kept = say({ type: "screen-reader-log", file: path.join(home, "1-1.txt"), reason: null });
    expect(kept).not.toContain(home);
    expect(kept).toContain(REPLACED);
  });

  it("shows a screen reader's log event whose fields it can't read as its type", () => {
    const odd = (event: Record<string, unknown>) =>
      eventText({ at: at("14:00:00.000"), ...event } as RunEvent, words);

    expect(odd({ type: "screen-reader-log", file: 7, reason: null })).toBe("screen-reader-log");
    expect(odd({ type: "screen-reader-log", file: "  ", reason: null })).toBe("screen-reader-log");
    expect(odd({ type: "screen-reader-log", reason: "x" })).toBe("screen-reader-log");
    expect(odd({ type: "screen-reader-log", file: null, reason: ["x"] })).toBe("screen-reader-log");
  });

  it("names the screen reader as the run's environment records it", () => {
    const voiceOver = { ...words, screenReader: "VoiceOver" };

    expect(eventText({ at: at("14:00:00.000"), type: "screen-reader-lock-taken" }, voiceOver)).toBe(
      "voicecap took the VoiceOver lock",
    );
  });

  it("never says a window's title, only the program's name", () => {
    const said = say({ type: "foreground-lost", program: "Outlook", title: PRIVATE_TITLE });

    expect(said).toBe("Another window came to the front: Outlook");
    expect(said).not.toContain("salary");
  });

  it("shows the home folder as it's shown everywhere on the page", () => {
    const program = path.join(home, "AppData", "Local", "Programs", "Tool", "tool.exe");
    const said = say({ type: "foreground-lost", program, title: null });

    expect(said).not.toContain(home);
    expect(said).toContain(REPLACED);
  });

  it("names a page the run doesn't have by its address, and no number, as its type", () => {
    expect(say({ type: "page-started", page: `${SITE}elsewhere/`, attempt: 1 })).toBe(
      "page-started",
    );
  });
});

describe("eventWordsOf", () => {
  it("names the run's screen reader, and each page by the name given and its place in the run", () => {
    const { run } = loggedRun();
    const words = eventWordsOf(run, (page) => `named ${page.label ?? ""}`, redact);

    expect(words.screenReader).toBe("NVDA");
    expect(words.pageName(APPLY)).toBe("named Apply");
    expect([HOME, APPLY, CONTACT].map(words.pageNumber)).toEqual([1, 2, 3]);
    // An address the run doesn't have: its address, with the home folder replaced, and no number.
    const file = `file:///${path.join(home, "x.html").replaceAll("\\", "/")}`;
    expect(words.pageNumber(file)).toBe(0);
    expect(words.pageName(file)).not.toContain(home.replaceAll("\\", "/"));
  });

  it("says 'screen reader' when no session recorded which one", () => {
    const run = shareRun({ id: "r1", pages: [{ path: "/" }] });
    const bare = { ...run, sessions: run.sessions.map((each) => ({ ...each, environment: null })) };

    expect(eventWordsOf(bare, (page) => page.url, redact).screenReader).toBe("screen reader");
  });
});

describe("attemptWindow", () => {
  /** An attempt at Apply, as its record times it: the times of day of 26 September 2026. */
  const attempt = (n: number, startedAt: string, endedAt: string) => ({
    n,
    startedAt: at(startedAt),
    endedAt: at(endedAt),
  });
  const started = (n: number, time: string) =>
    on(time, { type: "page-started", page: APPLY, attempt: n });
  const failed = (n: number, time: string) =>
    on(time, {
      type: "page-failed",
      page: APPLY,
      attempt: n,
      cause: "foreground",
      message: "Another window.",
    });
  const lock = (time: string) => on(time, { type: "screen-reader-lock-released" });

  it("covers an attempt from its start until the next attempt's start, which is not in it", () => {
    const events = session([
      started(1, "14:01:00.000"),
      failed(1, "14:01:30.000"),
      lock("14:01:40.000"),
      started(2, "14:02:00.000"),
      lock("14:02:30.000"),
    ]);
    const window = attemptWindow({ events }, APPLY, attempt(1, "14:01:00.000", "14:01:30.000"));

    expect(window).toEqual({
      events: [events[1], events[2], events[3]],
      from: at("14:01:00.000"),
      lasts: 60_000,
      inclusive: false,
    });
  });

  it("covers an attempt nothing followed until 10 seconds after it ended, that moment too", () => {
    const events = session([
      started(1, "14:01:00.000"),
      failed(1, "14:01:30.000"),
      lock("14:01:40.000"),
      lock("14:01:40.001"),
    ]);
    const window = attemptWindow({ events }, APPLY, attempt(1, "14:01:00.000", "14:01:30.000"));

    expect(window?.events).toEqual([events[1], events[2], events[3]]);
    expect(window?.from).toBe(at("14:01:00.000"));
    // 10 seconds after it ended is 40 seconds after it began.
    expect(window?.lasts).toBe(40_000);
    expect(window?.inclusive).toBe(true);
  });

  it("ends where a later session's attempt at the page starts, when that is within those 10 seconds", () => {
    const events = [
      on("14:00:00.000", { type: "run-started", session: 1, resumed: false }),
      started(1, "14:01:00.000"),
      failed(1, "14:01:30.000"),
      on("14:01:31.000", { type: "run-ended", session: 1, reason: "interrupted" }),
      on("14:01:33.000", { type: "run-started", session: 2, resumed: true }),
      started(2, "14:01:35.000"),
    ];
    const window = attemptWindow({ events }, APPLY, attempt(1, "14:01:00.000", "14:01:30.000"));

    expect(window?.events).toEqual([events[1], events[2], events[3], events[4]]);
    expect(window?.lasts).toBe(35_000);
    expect(window?.inclusive).toBe(false);
  });

  it("begins at the attempt's own start in the record when the log has no event in its time", () => {
    const events = session([started(1, "14:05:00.000")]);
    const window = attemptWindow({ events }, APPLY, attempt(1, "14:01:00.000", "14:01:30.000"));

    expect(window).toEqual({
      events: [],
      from: at("14:01:00.000"),
      lasts: 40_000,
      inclusive: true,
    });
  });

  it("has no window where the attempt's times can't be read", () => {
    const events = session([started(1, "14:01:00.000")]);

    expect(
      attemptWindow({ events }, APPLY, { n: 1, startedAt: "soon", endedAt: "later" }),
    ).toBeNull();
    expect(attemptEvents({ events }, APPLY, { n: 1, startedAt: "soon", endedAt: "later" })).toEqual(
      [],
    );
  });

  it("gives attemptEvents its events, and leaves out an event whose time can't be read", () => {
    const events = session([
      started(1, "14:01:00.000"),
      { at: "not a time", type: "screen-reader-lock-released" },
      failed(1, "14:01:30.000"),
    ]);
    const given = attempt(1, "14:01:00.000", "14:01:30.000");

    expect(attemptEvents({ events }, APPLY, given)).toEqual(
      attemptWindow({ events }, APPLY, given)?.events,
    );
    // The lock let go at "not a time" is a line that couldn't be read, and the run's end is later.
    expect(attemptEvents({ events }, APPLY, given).map((event) => event.type)).toEqual([
      "page-started",
      "page-failed",
    ]);
  });
});

describe("renderTimelines", () => {
  /** The words of the lanes a chart draws, in order. */
  const lanes = (html: string) =>
    [...html.matchAll(/<text [^>]*class="t-lane"[^>]*>(.*?)<\/text>/g)].map(([, name]) => name);

  it("draws a lane for the lock, voicecap's screen reader, the pages, and the computer's own", () => {
    const html = renderTimelines(loggedTimelines(), "2026-09-26_1402", "NVDA");
    const [first = ""] = html.split("</svg>");

    expect(lanes(first)).toEqual([
      "NVDA lock",
      "voicecap&#39;s NVDA",
      "Pages",
      "The computer&#39;s own NVDA",
    ]);
  });

  it("draws no lane that has nothing in it", () => {
    const timelines = timelinesFor(
      session([
        on("14:00:10.000", { type: "page-started", page: HOME, attempt: 1 }),
        on("14:01:10.000", { type: "page-finished", page: HOME, attempt: 1, status: "done" }),
      ]),
    );
    const html = renderTimelines(timelines, "r1", "NVDA");

    expect(lanes(html)).toEqual(["Pages"]);
    expect(html).not.toContain("b-lock");
    expect(html).not.toContain("b-nvda");
    expect(html).not.toContain("b-own");
  });

  it("marks the minutes at a step that keeps them to about 12, however long the session", () => {
    for (const [end, most] of [
      ["14:06:30.000", 7],
      ["17:00:00.000", 12],
      ["23:30:00.000", 12],
    ] as const) {
      const timelines = timelinesFor(
        session(
          [
            on("14:00:10.000", { type: "page-started", page: HOME, attempt: 1 }),
            on(end, { type: "page-finished", page: HOME, attempt: 1, status: "done" }),
          ],
          end,
        ),
      );
      const ticks = [
        ...renderTimelines(timelines, "r1", "NVDA").matchAll(
          /<text [^>]*class="t-axis"[^>]*>(\d\d:\d\d)<\/text>/g,
        ),
      ].map(([, time]) => time);

      expect(ticks.length, end).toBeGreaterThan(2);
      expect(ticks.length, end).toBeLessThanOrEqual(most);
      // Whole minutes, evenly apart.
      const minutes = ticks.map(
        (time = "") => Number(time.slice(0, 2)) * 60 + Number(time.slice(3)),
      );
      const steps = new Set(
        minutes.slice(1).map((minute, index) => minute - (minutes[index] ?? 0)),
      );
      expect(steps.size, end).toBe(1);
    }
  });

  it("marks at most 12 times, and quickly, on a session that spans months or years, as after the clock jumped", () => {
    for (const day of ["2026-10-26", "2027-09-26", "2043-09-26"]) {
      const events = [
        on("14:00:00.000", { type: "run-started", session: 1, resumed: false }),
        on("14:00:10.000", { type: "page-started", page: HOME, attempt: 1 }),
        logged(day, "14:01:10.000", {
          type: "page-finished",
          page: HOME,
          attempt: 1,
          status: "done",
        }),
        logged(day, "14:09:00.000", { type: "run-ended", session: 1, reason: "completed" }),
      ];
      const timelines = timelinesFor(events);
      const began = performance.now();
      const html = renderTimelines(timelines, "r1", "NVDA");
      const took = performance.now() - began;
      const ticks = html.match(/class="t-axis"/g) ?? [];

      expect(ticks.length, day).toBeGreaterThanOrEqual(2);
      expect(ticks.length, day).toBeLessThanOrEqual(12);
      expect(took, day).toBeLessThan(1000);
    }
  });

  it("is an image named by its summary, in a box a keyboard can reach and scroll, and sets no style", () => {
    const timelines = loggedTimelines();
    const html = renderTimelines(timelines, "2026-09-26_1402", "NVDA");
    const charts = [...html.matchAll(/<svg [^>]*>/g)].map(([tag]) => tag);

    expect(charts).toHaveLength(2);
    for (const [index, chart] of charts.entries()) {
      expect(chart).toContain('class="timeline"');
      expect(chart).toContain('role="img"');
      const named = attributes(chart, "aria-labelledby")[0]?.split(" ") ?? [];
      const said = named.map((id) => {
        const found = new RegExp(`<([a-z]+)\\b[^>]*\\sid="${id}"[^>]*>(.*?)</\\1>`, "s").exec(html);
        return textOf(found?.[2] ?? "");
      });
      expect(said.join(" ")).toContain(sessionAt(timelines, index).summary.join(" "));
    }
    expect(html).not.toMatch(/\sstyle=/);
  });
});

describe("a window's title", () => {
  it("reaches no row, no sentence, no chart, no table, no page, and no Word copy", () => {
    const timelines = loggedTimelines();
    const model = loggedModel();
    const said = [
      ...timelines.flatMap(({ rows, summary }) => [...rows.map(({ text }) => text), ...summary]),
      renderTimelines(timelines, "2026-09-26_1402", "NVDA"),
      renderSharePage(model, { fontCss: "" }),
      ...wordsOf(wordOutline(model)),
    ].join("\n");

    // The program that took the screen is there, so the log was read.
    expect(said).toContain("Microsoft Teams");
    expect(said).not.toContain(PRIVATE_TITLE);
    expect(said).not.toContain("salary");
  });
});
