/**
 * NVDA's own log, checked against the transcripts step by step (checkAgainstLog): the real run of
 * 6 October 2026 in fixture/nvda-io-run, and made-up logs for each case.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { gestureOf } from "../src/drivers/guidepup/nvda-log.js";
import type {
  DriverCommand,
  PassName,
  RunEvent,
  RunJson,
  StepRecord,
  TranscriptJson,
} from "../src/model.js";
import {
  CantCheckError,
  type PassSteps,
  checkAgainstLog,
  spokenAsLogged,
} from "../src/share/log-check.js";

const DAY = 86_400_000;
const T0 = 8 * 3_600_000; // 08:00:00.000
const HOME = "https://example.org/";
const ABOUT = "https://example.org/about/";

/** "HH:MM:SS.mmm", as NVDA logs a time, for milliseconds since midnight (the next day's, too). */
function clock(ms: number): string {
  const time = ms % DAY;
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const [h, m, s] = [3_600_000, 60_000, 1000].map(
    (unit, i) => Math.floor(time / unit) % (i === 0 ? 24 : 60),
  );
  return `${pad(h!)}:${pad(m!)}:${pad(s!)}.${pad(time % 1000, 3)}`;
}

/** A local ISO time on 9 October 2026 (or a day after), as a run records an attempt's. */
function iso(ms: number): string {
  return `2026-10-${String(9 + Math.floor(ms / DAY)).padStart(2, "0")}T${clock(ms)}-05:00`;
}

/** A key voicecap pressed, as NVDA logs it. */
function key(ms: number, gesture: string): string[] {
  return [
    `IO - inputCore.InputManager.executeGesture (${clock(ms)}) - winInputHook (5200):`,
    `Input: kb(desktop):${gesture}`,
  ];
}

/** What NVDA said, as it logs it: its text items, among the commands it adds. */
function said(ms: number, ...items: string[]): string[] {
  const texts = items.map((item) => `'${item.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`);
  return [
    `IO - speech.speech.speak (${clock(ms)}) - MainThread (4100):`,
    `Speaking [LangChangeCommand ('en_US'), ${[...texts, "CancellableSpeech (still valid)"].join(", ")}]`,
  ];
}

/** A cleaned copy of NVDA's log: a first line that says what it is, then its entries. */
function copyOf(...entries: string[][]): string {
  return ["# NVDA's own log of one NVDA session in this run.", ...entries.flat(), ""].join("\n");
}

/** As in the real run: each step takes 1.28 s, its key 0.27 s in, and NVDA speaks 0.04 s later. */
const STEP_MS = 1280;
const KEY_MS = 270;
const SPEECH_MS = 40;
/** As in the real run: an attempt began 2 s or more before its page opened (NVDA+T). */
const BEFORE_MS = 2000;

interface Line {
  command: DriverCommand;
  /** What the transcript holds. */
  spoken: string;
  /**
   * What NVDA's log has for the step: the items of each of its Speaking entries, or [] for none.
   * By default one entry, the spoken text's items.
   */
  logged?: string[][];
  /** false: NVDA logged no key for the step, as for the first Tab, which goes to the browser. */
  key?: boolean;
  /** How long the step took, if not STEP_MS. */
  ms?: number;
  /** How much later in its step the key came than KEY_MS (more waiting for quiet first). */
  later?: number;
  /** When each of its Speaking entries came after the key, if not 40 ms, then 9 ms apart. */
  at?: number[];
}

interface Pass {
  entries: string[][];
  record: PassSteps;
  /** When the page opened for the pass (its NVDA+T), and when the pass's last step ended. */
  start: number;
  end: number;
}

/**
 * One pass, as a run reads it from `start`: voicecap opens the page (NVDA+T, with what NVDA says
 * of the window; Escape; Ctrl+Home, with the page's first line), then presses each step's key. It's
 * read in a kept attempt of its own, from 2 s before the page opened to just after its last step;
 * `attempt` puts a page's passes in one.
 */
function passAt(start: number, page: string, pass: PassName, lines: Line[]): Pass {
  const entries: string[][] = [
    key(start, "NVDA+t"),
    said(start + 3, "Example - Browser"),
    key(start + 1000, "escape"),
    key(start + 1260, "control+home"),
    said(start + 1263, "Top of the page"),
  ];
  const begin = start + 2300;
  let elapsed = 0;
  const steps = lines.map((line, index): StepRecord => {
    const durationMs = line.ms ?? STEP_MS;
    const pressed = begin + elapsed + KEY_MS + (line.later ?? 0);
    if (line.key !== false) entries.push(key(pressed, gestureOf(line.command)!));
    const logged = line.logged ?? [line.spoken.split(", ")];
    logged.forEach((items, k) => {
      entries.push(said(pressed + (line.at?.[k] ?? SPEECH_MS + 9 * k), ...items));
    });
    elapsed += durationMs;
    return {
      n: index + 1,
      command: line.command,
      spoken: line.spoken,
      durationMs,
      offsetMs: elapsed,
    };
  });
  const end = begin + elapsed;
  const within = { from: iso(start - BEFORE_MS), to: iso(end + 50) };
  return { entries, record: { page, pass, steps, within }, start, end };
}

/** A page's passes, read in one kept attempt: from 2 s before the first opened, to `to` (ms). */
function attempt(passes: Pass[], to = passes.at(-1)!.end + 50): Pass[] {
  const within = { from: iso(passes[0]!.start - BEFORE_MS), to: iso(to) };
  return passes.map((pass) => ({ ...pass, record: { ...pass.record, within } }));
}

const READ: Line[] = [
  { command: "toBottom", spoken: "content info landmark, Example footer" },
  { command: "toTop", spoken: "Skip to content, link" },
  { command: "nextLine", spoken: "heading, level 1, Welcome" },
  { command: "nextLine", spoken: "Read the guide." },
];

const ABOUT_READ: Line[] = [
  ...READ.slice(0, 2),
  { command: "nextLine", spoken: "heading, level 1, About us" },
  { command: "nextLine", spoken: "We make examples." },
];

function check(logs: string[], passes: Pass[], thrownOut: { from: string; to: string }[] = []) {
  return checkAgainstLog({ logs, steps: passes.map((pass) => pass.record), thrownOut, gestureOf });
}

const AGREED = { onlyInLog: [], onlyInTranscripts: [] };

describe("checkAgainstLog on the real run of 6 October 2026 (fixture/nvda-io-run)", () => {
  const FIXTURE = fileURLToPath(new URL("../fixture/nvda-io-run/", import.meta.url));
  const read = (...parts: string[]) => readFileSync(path.join(FIXTURE, ...parts), "utf8");
  const run = JSON.parse(read("run", "run.json")) as RunJson;
  const events = read("run", "events.jsonl")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RunEvent);
  // Each page was read in one attempt, which the event log says began and ended when.
  const moment = (type: "page-started" | "page-finished", page: string) =>
    events.find((event) => event.type === type && event.page === page)!.at;
  const transcript = (slug: string, pass: PassName) =>
    JSON.parse(read("run", "pages", slug, `${pass}.json`)) as TranscriptJson;
  // The pages' three passes each, in the pages' order.
  const stepsOf = (pages: RunJson["pages"]) =>
    pages.flatMap((page) =>
      run.settings.passes.map((pass) => ({
        page: page.url,
        pass,
        steps: transcript(page.slug, pass).steps,
        within: { from: moment("page-started", page.url), to: moment("page-finished", page.url) },
      })),
    );
  // In the order the run read them.
  const steps = stepsOf(run.pages);
  const log = read("nvda-log", "1-1.txt");
  const everyStep = {
    transcriptLines: 204,
    logLines: 204,
    agree: 204,
    onlyInLog: [],
    onlyInTranscripts: [],
    // Of NVDA's 392 Speaking entries, 215 are the steps' (ten steps' speech spans two or three
    // entries). The 177 outside are: 7 before voicecap's first key (the window that was in front,
    // and the browser coming forward); 28 title checks (NVDA+T, as each of the 21 passes opened
    // its page, and once at the end of each tab pass); 21 lines at the top of each page as it
    // opened (Ctrl+Home, before each pass); and 121 between passes, as one browser closed and
    // the next opened (another window, the new browser window, and its first focus).
    outside: 177,
  };

  it("agrees on every one of the run's 204 steps", () => {
    expect(checkAgainstLog({ logs: [log], steps, thrownOut: [], gestureOf })).toEqual(everyStep);
  });

  it("pairs each page in its own attempt's time, whatever order the pages come in", () => {
    const reordered = stepsOf(run.pages.toReversed());
    expect(checkAgainstLog({ logs: [log], steps: reordered, thrownOut: [], gestureOf })).toEqual(
      everyStep,
    );
  });

  it("holds what the check has to allow for: NVDA logs text before it speaks symbols", () => {
    // NVDA logs what it was asked to say; the transcript has what it said, with "." said as "dot",
    // quotation marks and "|" left out, and "macOS" said as "mac OS".
    const page = run.pages.find((each) => each.slug.startsWith("reading-transcripts"))!;
    expect(transcript(page.slug, "read").steps[6]!.spoken).toBe(
      "Each page gets a folder, with read dot txt, headings dot txt, and tab dot txt in it.",
    );
    expect(log).toContain(
      "'Each page gets a folder, with read.txt, headings.txt, and tab.txt in it.'",
    );
    // And the first Tab of each page has no key in the log: it goes to the browser, not NVDA.
    const tabSteps = run.pages.reduce((sum, each) => sum + each.passes.tab!.steps, 0);
    expect(tabSteps).toBe(41);
    expect(log.match(/^Input: kb\(desktop\):tab$/gm)).toHaveLength(34);
  });
});

describe("checkAgainstLog on made-up logs", () => {
  it("lists a step NVDA said differently in both lists, with its page, pass, and step", () => {
    const pass = passAt(T0, HOME, "read", [
      ...READ.slice(0, 3),
      { command: "nextLine", spoken: "Read the guide.", logged: [["Read the guides."]] },
    ]);
    expect(check([copyOf(...pass.entries)], [pass])).toEqual({
      transcriptLines: 4,
      logLines: 4,
      agree: 3,
      onlyInLog: [{ page: HOME, pass: "read", step: 4, text: "Read the guides." }],
      onlyInTranscripts: [{ page: HOME, pass: "read", step: 4, text: "Read the guide." }],
      outside: 2,
    });
  });

  it("lists a step with no speech in the log in onlyInTranscripts only", () => {
    // NVDA logged the key and said nothing.
    const silent = passAt(T0, HOME, "read", [
      ...READ.slice(0, 3),
      { command: "nextLine", spoken: "Read the guide.", logged: [] },
    ]);
    expect(check([copyOf(...silent.entries)], [silent])).toEqual({
      transcriptLines: 4,
      logLines: 4,
      agree: 3,
      onlyInLog: [],
      onlyInTranscripts: [{ page: HOME, pass: "read", step: 4, text: "Read the guide." }],
      outside: 2,
    });
    // NVDA logged neither the key nor any speech.
    const missing = passAt(T0, HOME, "read", [
      ...READ.slice(0, 3),
      { command: "nextLine", spoken: "Read the guide.", logged: [], key: false },
    ]);
    expect(check([copyOf(...missing.entries)], [missing])).toMatchObject({
      transcriptLines: 4,
      logLines: 3,
      agree: 3,
      onlyInLog: [],
      onlyInTranscripts: [{ page: HOME, pass: "read", step: 4, text: "Read the guide." }],
    });
  });

  it("counts speech before voicecap's first key, and never lists it", () => {
    const pass = passAt(T0, HOME, "read", [
      ...READ.slice(0, 3),
      { command: "nextLine", spoken: "Read the guide.", logged: [["Read the guides."]] },
    ]);
    const before = [said(T0 - 5000, "Inbox - Mail"), said(T0 - 4990, "Inbox - Mail", "window")];
    const result = check([copyOf(...before, ...pass.entries)], [pass]);
    expect(result.outside).toBe(4);
    expect(result.onlyInLog).toEqual([
      { page: HOME, pass: "read", step: 4, text: "Read the guides." },
    ]);
    expect(JSON.stringify(result)).not.toContain("Inbox");
  });

  it("never pairs a thrown-out attempt's keys and speech with the kept attempt's steps", () => {
    // The first attempt read the page, then failed as the next pass opened it; the second read it.
    const failed = passAt(T0, HOME, "read", [
      { command: "toBottom", spoken: "Old footer" },
      { command: "toTop", spoken: "Old top" },
      { command: "nextLine", spoken: "Old line" },
    ]);
    const kept = passAt(failed.end + 6000, HOME, "read", READ.slice(0, 3));
    const window = { from: iso(T0 - 400), to: iso(failed.end + 2000) };
    // The kept pass's window may be the page's whole time in the session, both attempts in it (as
    // its record's startedAt and durationMs give it): the thrown-out window still sets the first
    // attempt aside.
    const wide = {
      ...kept,
      record: { ...kept.record, within: attempt([failed, kept])[0]!.record.within },
    };
    const result = check([copyOf(...failed.entries, ...kept.entries)], [wide], [window]);
    // Outside: the failed attempt's 5 Speaking entries, and the kept one's 2 as it opened.
    expect(result).toEqual({ transcriptLines: 3, logLines: 3, agree: 3, ...AGREED, outside: 7 });
  });

  it("walks two logs (a restart), in either order, pairing each pass in its attempt's time", () => {
    const home = passAt(T0, HOME, "read", READ);
    const about = passAt(home.end + 30_000, ABOUT, "read", ABOUT_READ);
    const logs = [copyOf(...home.entries), copyOf(...about.entries)];
    const expected = { transcriptLines: 8, logLines: 8, agree: 8, ...AGREED, outside: 4 };
    expect(check(logs, [home, about])).toEqual(expected);
    expect(check(logs.toReversed(), [home, about])).toEqual(expected);
  });

  it("pairs pages given out of time order (a resumed run reads its retried pages last)", () => {
    const about = passAt(T0, ABOUT, "read", ABOUT_READ);
    const home = passAt(about.end + 30_000, HOME, "read", READ);
    expect(check([copyOf(...about.entries, ...home.entries)], [home, about])).toEqual({
      transcriptLines: 8,
      logLines: 8,
      agree: 8,
      ...AGREED,
      outside: 4,
    });
  });

  it("agrees on a step whose speech spans two Speaking entries, joined by '. '", () => {
    const pass = passAt(T0, HOME, "tab", [
      { command: "nextFocusable", spoken: "Skip to content, link", key: false },
      {
        command: "nextFocusable",
        spoken: "Home - Example - Browser, region. Tab search, button, collapsed",
        logged: [
          ["Home - Example - Browser", "region"],
          ["Tab search", "button", "collapsed"],
        ],
      },
    ]);
    expect(check([copyOf(...pass.entries)], [pass])).toEqual({
      transcriptLines: 2,
      logLines: 2,
      agree: 2,
      ...AGREED,
      outside: 2,
    });
  });

  it("finds the speech of a step NVDA logged no key for (the first Tab) by the pass's own times", () => {
    const tab: Line[] = [
      { command: "nextFocusable", spoken: "Skip to content, same page, link", key: false },
      { command: "nextFocusable", spoken: "Home, link" },
      { command: "nextFocusable", spoken: "About, link" },
    ];
    const pass = passAt(T0, HOME, "tab", tab);
    expect(check([copyOf(...pass.entries)], [pass])).toEqual({
      transcriptLines: 3,
      logLines: 3,
      agree: 3,
      ...AGREED,
      outside: 2,
    });
    // When NVDA said that step differently, it's that step that differs, not every step after it.
    const differs = passAt(T0, HOME, "tab", [
      { ...tab[0]!, logged: [["Skip to main content", "same page", "link"]] },
      ...tab.slice(1),
    ]);
    expect(check([copyOf(...differs.entries)], [differs])).toMatchObject({
      agree: 2,
      onlyInLog: [
        { page: HOME, pass: "tab", step: 1, text: "Skip to main content, same page, link" },
      ],
      onlyInTranscripts: [
        { page: HOME, pass: "tab", step: 1, text: "Skip to content, same page, link" },
      ],
    });
  });

  it("finds a long first Tab's speech, and never reaches back before its pass began", () => {
    const tab = (ms: number): Line[] => [
      { command: "nextFocusable", spoken: "Skip to content, link", key: false, ms },
      { command: "nextFocusable", spoken: "Home, link" },
      { command: "nextFocusable", spoken: "About, link" },
    ];
    // Half of 2.7 s reaches back past the Ctrl+Home voicecap pressed as the page opened.
    const long = passAt(T0, HOME, "tab", tab(2700));
    expect(check([copyOf(...long.entries)], [long])).toEqual({
      transcriptLines: 3,
      logLines: 3,
      agree: 3,
      ...AGREED,
      outside: 2,
    });
    // Half of 7 s reaches back to before the page opened, where another window spoke.
    const longer = passAt(T0, HOME, "tab", tab(7000));
    const before = said(T0 - 600, "Inbox - Mail");
    const result = check([copyOf(before, ...longer.entries)], [longer]);
    expect(result).toEqual({ transcriptLines: 3, logLines: 3, agree: 3, ...AGREED, outside: 3 });
  });

  it("leaves out what NVDA said after a pause as long as half the step, inside the attempt", () => {
    const first: Line[] = [
      { command: "nextHeading", spoken: "Welcome, heading, level 1" },
      { command: "nextHeading", spoken: "no next heading" },
    ];
    const one = passAt(T0, HOME, "headings", first);
    // Another window comes forward for a moment, inside the last step's time but after its words,
    // and before the attempt has ended.
    const between = [
      said(one.end + 200, "Inbox - Mail"),
      said(one.end + 220, "Inbox - Mail", "window"),
    ];
    const kept = attempt([one], one.end + 1000);
    const two = passAt(one.end + 4000, ABOUT, "headings", [
      { command: "nextHeading", spoken: "About us, heading, level 1" },
      { command: "nextHeading", spoken: "no next heading" },
    ]);
    const log = copyOf(...one.entries, ...between, ...two.entries);
    expect(check([log], [...kept, two])).toEqual({
      transcriptLines: 4,
      logLines: 4,
      agree: 4,
      ...AGREED,
      outside: 6,
    });
    // A last step that differs lists only its own words.
    const changed = attempt(
      [passAt(T0, HOME, "headings", [first[0]!, { ...first[1]!, logged: [["No next heading"]] }])],
      one.end + 1000,
    );
    const result = check(
      [copyOf(...changed[0]!.entries, ...between, ...two.entries)],
      [...changed, two],
    );
    expect(result.onlyInLog).toEqual([
      { page: HOME, pass: "headings", step: 2, text: "No next heading" },
    ]);
    expect(JSON.stringify(result)).not.toContain("Inbox");
  });

  it("ends a step's speech when the step's time is up, pause or no pause", () => {
    const pass = passAt(T0, HOME, "headings", [
      { command: "nextHeading", spoken: "Welcome, heading, level 1" },
      {
        command: "nextHeading",
        spoken: "no next heading. Saving draft. Saving draft",
        logged: [["no next heading"]],
      },
    ]);
    // NVDA kept talking, never pausing for half a step, past the moment the step ended.
    const pressed = T0 + 2300 + STEP_MS + KEY_MS;
    const more = [
      said(pressed + 600, "Saving draft"),
      said(pressed + 1150, "Saving draft"),
      said(pressed + 1700, "Draft saved"),
    ];
    const kept = attempt([pass], pass.end + 2000);
    const result = check([copyOf(...pass.entries, ...more)], kept);
    expect(result).toEqual({ transcriptLines: 2, logLines: 2, agree: 2, ...AGREED, outside: 3 });
  });

  it("allows for how NVDA speaks symbols, and keeps every word", () => {
    const pass = passAt(T0, HOME, "read", [
      {
        command: "toBottom",
        spoken: "Home voicecap demo - Google Chrome, region",
        logged: [["Home | voicecap demo - Google Chrome", "region"]],
      },
      {
        command: "toTop",
        spoken: "Each page has read dot txt in it.",
        logged: [["Each page has read.txt in it."]],
      },
      {
        command: "nextLine",
        spoken: "The screen reader says only edit .",
        logged: [['The screen reader says only "edit".']],
      },
      {
        command: "nextLine",
        spoken: "To see more,, link, click here, dot",
        logged: [["To see more, ", "link", "click here", "."]],
      },
      {
        command: "nextLine",
        spoken: "On a Mac, setup asks for the permissions mac OS asks for.",
        logged: [["On a Mac, setup asks for the permissions macOS asks for."]],
      },
    ]);
    expect(check([copyOf(...pass.entries)], [pass])).toMatchObject({ agree: 5, ...AGREED });
  });

  it("keeps empty items and drops NVDA's speech commands, as the transcripts do", () => {
    const pass = passAt(T0, HOME, "read", [
      ...READ.slice(0, 3),
      { command: "nextLine", spoken: "section, Your name, edit, ", logged: [] },
    ]);
    const pressed = T0 + 2300 + 3 * STEP_MS + KEY_MS;
    const entries = [
      ...pass.entries,
      [
        `IO - speech.speech.speak (${clock(pressed + SPEECH_MS)}) - MainThread (4100):`,
        "Speaking [LangChangeCommand ('en_US'), 'section', 'Your name', 'edit', ' ', BreakCommand(time=100), CancellableSpeech (still valid)]",
      ],
    ];
    expect(check([copyOf(...entries)], [pass])).toMatchObject({ agree: 4, ...AGREED });
  });

  it("isn't thrown by a page voicecap opened and then skipped (an off-site redirect)", () => {
    const home = passAt(T0, HOME, "read", READ);
    // The page opened, then turned out to be elsewhere: its keys are in the log, with no pass.
    const skipped = passAt(home.end + 3000, "https://example.org/away", "read", []);
    const about = passAt(skipped.end + 6000, ABOUT, "read", READ);
    const logs = [copyOf(...home.entries, ...skipped.entries, ...about.entries)];
    expect(check(logs, [home, about])).toEqual({
      transcriptLines: 8,
      logLines: 8,
      agree: 8,
      ...AGREED,
      outside: 6,
    });
  });

  it("pairs the steps around a step NVDA logged no key for by their times, not one off", () => {
    const pass = passAt(T0, HOME, "read", [
      ...READ,
      { command: "nextLine", spoken: "Then read the next one.", logged: [], key: false },
      { command: "nextLine", spoken: "And the last." },
      { command: "nextLine", spoken: "And the last." },
    ]);
    expect(check([copyOf(...pass.entries)], [pass])).toEqual({
      transcriptLines: 7,
      logLines: 6,
      agree: 6,
      onlyInLog: [],
      onlyInTranscripts: [{ page: HOME, pass: "read", step: 5, text: "Then read the next one." }],
      outside: 2,
    });
  });

  it("leaves a pass whose only step has no key out, without taking a later pass's keys", () => {
    // The first Tab left the page at once, so NVDA logged no key for the pass at all.
    const home = passAt(T0, HOME, "tab", [
      { command: "nextFocusable", spoken: "Address and search bar, edit", key: false },
    ]);
    const about = passAt(home.end + 5000, ABOUT, "tab", [
      { command: "nextFocusable", spoken: "Skip to content, link", key: false },
      { command: "nextFocusable", spoken: "Home, link" },
      { command: "nextFocusable", spoken: "About, link" },
    ]);
    expect(check([copyOf(...home.entries, ...about.entries)], [home, about])).toEqual({
      transcriptLines: 4,
      logLines: 3,
      agree: 3,
      onlyInLog: [],
      onlyInTranscripts: [
        { page: HOME, pass: "tab", step: 1, text: "Address and search bar, edit" },
      ],
      outside: 5,
    });
  });

  it("within a page, gives a stretch two passes fit to the one that pairs more of its keys", () => {
    // Two passes of one page that press the same key (the check is general): the first's only
    // step has no key, so the stretch it fits is the second's.
    const one = passAt(T0, HOME, "tab", [
      { command: "nextFocusable", spoken: "Address and search bar, edit", key: false },
    ]);
    const two = passAt(one.end + 5000, HOME, "tab", [
      { command: "nextFocusable", spoken: "Skip to content, link", key: false },
      { command: "nextFocusable", spoken: "Home, link" },
      { command: "nextFocusable", spoken: "About, link" },
    ]);
    const log = copyOf(...one.entries, ...two.entries);
    expect(check([log], attempt([one, two]))).toEqual({
      transcriptLines: 4,
      logLines: 3,
      agree: 3,
      onlyInLog: [],
      onlyInTranscripts: [
        { page: HOME, pass: "tab", step: 1, text: "Address and search bar, edit" },
      ],
      outside: 5,
    });
  });

  it("lists a page's differences under that page, in a run of only tab passes", () => {
    // Page 1's only Tab left the page (no key); page 2's log differs from its transcripts on both
    // steps; page 3 says what page 2's transcripts say. Nothing moves to another page.
    const one = passAt(T0, "P1", "tab", [
      { command: "nextFocusable", spoken: "Address and search bar, edit", key: false },
    ]);
    const two = passAt(one.end + 5000, "P2", "tab", [
      {
        command: "nextFocusable",
        spoken: "Skip to content, link",
        key: false,
        logged: [["Skip to MAIN content", "link"]],
      },
      {
        command: "nextFocusable",
        spoken: "Address and search bar, edit",
        logged: [["Something else entirely"]],
      },
    ]);
    const three = passAt(two.end + 5000, "P3", "tab", [
      { command: "nextFocusable", spoken: "Skip to content, link", key: false },
      { command: "nextFocusable", spoken: "Address and search bar, edit" },
    ]);
    const log = copyOf(...one.entries, ...two.entries, ...three.entries);
    expect(check([log], [one, two, three])).toEqual({
      transcriptLines: 5,
      logLines: 4,
      agree: 2,
      onlyInLog: [
        { page: "P2", pass: "tab", step: 1, text: "Skip to MAIN content, link" },
        { page: "P2", pass: "tab", step: 2, text: "Something else entirely" },
      ],
      onlyInTranscripts: [
        { page: "P1", pass: "tab", step: 1, text: "Address and search bar, edit" },
        { page: "P2", pass: "tab", step: 1, text: "Skip to content, link" },
        { page: "P2", pass: "tab", step: 2, text: "Address and search bar, edit" },
      ],
      // The three pages' lines as they opened, and page 1's Tab, which has no key to pair.
      outside: 7,
    });
  });

  it("never pairs or lists an attempt Ctrl+C stopped, which leaves no record", () => {
    // Page A's last pass is a tab pass whose only Tab left the page; then Ctrl+C stopped the
    // next page's attempt in its tab pass.
    const a = attempt([
      passAt(T0, HOME, "read", READ),
      passAt(T0 + 15_000, HOME, "headings", [
        { command: "nextHeading", spoken: "no next heading" },
      ]),
      passAt(T0 + 25_000, HOME, "tab", [
        { command: "nextFocusable", spoken: "Home - Browser, region", key: false },
      ]),
    ]);
    const stopped = [
      passAt(T0 + 35_000, ABOUT, "read", ABOUT_READ),
      passAt(T0 + 50_000, ABOUT, "headings", [
        { command: "nextHeading", spoken: "no next heading" },
      ]),
      passAt(T0 + 60_000, ABOUT, "tab", [
        { command: "nextFocusable", spoken: "About secret link one", key: false },
        { command: "nextFocusable", spoken: "About secret link two" },
      ]),
    ];
    const log = copyOf(...[...a, ...stopped].flatMap((pass) => pass.entries));
    const result = check([log], a);
    expect(result).toEqual({
      transcriptLines: 6,
      logLines: 5,
      agree: 5,
      onlyInLog: [],
      onlyInTranscripts: [{ page: HOME, pass: "tab", step: 1, text: "Home - Browser, region" }],
      // A's three openings and its Tab's speech; the stopped attempt's three openings and steps.
      outside: 6 + 1 + 6 + 7,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("takes only speech inside the pass's attempt, even within a step's time", () => {
    const pass = passAt(T0, HOME, "headings", [
      { command: "nextHeading", spoken: "Welcome, heading, level 1" },
      {
        command: "nextHeading",
        spoken: "no next heading. Saving draft",
        logged: [["no next heading"], ["Saving draft"]],
      },
    ]);
    // The attempt's record ends between the step's two entries, 40 and 49 ms after its key.
    const pressed = T0 + 2300 + STEP_MS + KEY_MS;
    const cut = attempt([pass], pressed + SPEECH_MS + 4);
    expect(check([copyOf(...pass.entries)], cut)).toEqual({
      transcriptLines: 2,
      logLines: 2,
      agree: 1,
      onlyInLog: [{ page: HOME, pass: "headings", step: 2, text: "no next heading" }],
      onlyInTranscripts: [
        { page: HOME, pass: "headings", step: 2, text: "no next heading. Saving draft" },
      ],
      outside: 3,
    });
  });

  it("leaves out what was said after the attempt ended, even within its last step's time", () => {
    // A page read with no tab pass, so no NVDA+T closes it. Its last step's speech runs on, its
    // attempt ends 10 ms after the step, and the next page's attempt begins 8 ms later.
    const read = passAt(T0, HOME, "read", READ);
    const headings = passAt(read.end + 5000, HOME, "headings", [
      { command: "nextHeading", spoken: "Welcome, heading, level 1" },
      {
        command: "nextHeading",
        spoken: "no next heading. Saving draft. Draft saved",
        logged: [["no next heading"], ["Saving draft"], ["Draft saved"]],
        at: [40, 940, 1840],
        ms: 3500,
      },
    ]);
    const ended = headings.end + 10;
    const home = attempt([read, headings], ended);
    const next = passAt(ended + 8 + BEFORE_MS + 400, ABOUT, "read", ABOUT_READ);
    const within = { from: iso(ended + 8), to: iso(next.end + 50) };
    const about = { ...next, record: { ...next.record, within } };
    for (const after of [100, 240]) {
      const spoken = said(ended + after, "Calculator");
      const log = copyOf(...read.entries, ...headings.entries, spoken, ...next.entries);
      const result = check([log], [...home, about]);
      expect(result).toEqual({
        transcriptLines: 10,
        logLines: 10,
        agree: 10,
        ...AGREED,
        outside: 7,
      });
      expect(JSON.stringify(result)).not.toContain("Calculator");
    }
  });

  it("finds the first Tab's speech when the pass's later keys came later in their steps", () => {
    // The later steps each waited once more for quiet before their keys, so the pass's clock, set
    // by their keys, puts the first Tab's key that much later than it came.
    for (const later of [60, 300]) {
      const pass = passAt(T0, HOME, "tab", [
        { command: "nextFocusable", spoken: "Skip to content, link", key: false },
        { command: "nextFocusable", spoken: "Home, link", later },
        { command: "nextFocusable", spoken: "About, link", later },
        { command: "nextFocusable", spoken: "Contact, link", later },
      ]);
      expect(check([copyOf(...pass.entries)], [pass])).toEqual({
        transcriptLines: 4,
        logLines: 4,
        agree: 4,
        ...AGREED,
        outside: 2,
      });
    }
  });

  it("doesn't give a read pass a person's Down Arrow, pressed as the page loaded", () => {
    const read = passAt(T0, HOME, "read", READ);
    // Inside the attempt, before the page opened: one key of the pass's, at a step's moment.
    const stray = [key(T0 - 1000, "downArrow"), said(T0 - 960, "Inbox - Mail, 3 unread")];
    const result = check([copyOf(...stray, ...read.entries)], [read]);
    expect(result).toEqual({ transcriptLines: 4, logLines: 4, agree: 4, ...AGREED, outside: 3 });
    expect(JSON.stringify(result)).not.toContain("Inbox");
  });

  it("keeps a page's passes in order: a person's Tab as the page loaded isn't the tab pass's", () => {
    const read = passAt(T0, HOME, "read", READ);
    const headings = passAt(read.end + 5000, HOME, "headings", [
      { command: "nextHeading", spoken: "Welcome, heading, level 1" },
      { command: "nextHeading", spoken: "no next heading" },
    ]);
    const tab = passAt(headings.end + 5000, HOME, "tab", [
      { command: "nextFocusable", spoken: "Skip to content, link", key: false },
      { command: "nextFocusable", spoken: "Home, link" },
    ]);
    // Inside the attempt, before the page opened for its first pass.
    const stray = [key(T0 - 1000, "tab"), said(T0 - 960, "Inbox - Mail, 3 unread")];
    const log = copyOf(stray[0]!, stray[1]!, ...read.entries, ...headings.entries, ...tab.entries);
    const result = check([log], attempt([read, headings, tab]));
    expect(result).toEqual({ transcriptLines: 8, logLines: 8, agree: 8, ...AGREED, outside: 7 });
    expect(JSON.stringify(result)).not.toContain("Inbox");
  });

  it("follows a log across midnight, with a thrown-out attempt that spans it", () => {
    const late = DAY - 5000; // 23:59:55
    const failed = passAt(late, HOME, "read", READ);
    expect(clock(failed.end)).toMatch(/^00:00:/);
    const kept = passAt(failed.end + 6000, HOME, "read", [
      ...READ.slice(0, 3),
      { command: "nextLine", spoken: "Read the new guide." },
    ]);
    const window = { from: iso(late - 100), to: iso(failed.end + 1000) };
    expect(window.to).toMatch(/^2026-10-10T00:00:/);
    // The kept pass's window is the page's whole time, from before midnight.
    const [, wide] = attempt([failed, kept]);
    expect(check([copyOf(...failed.entries, ...kept.entries)], [wide!], [window])).toEqual({
      transcriptLines: 4,
      logLines: 4,
      agree: 4,
      ...AGREED,
      // The failed attempt's 2 lines as it opened and 4 steps' speech; the kept one's 2.
      outside: 8,
    });
  });

  it("can't check a log against a thrown-out window whose times can't be read", () => {
    const pass = passAt(T0, HOME, "read", READ);
    const window = { from: "yesterday", to: "today" };
    expect(() => check([copyOf(...pass.entries)], [pass], [window])).toThrow(
      'the window of a thrown-out attempt ("yesterday" to "today")',
    );
  });

  it("says it can't check with an error of its own kind, which a caller tells apart by its class, not its words", () => {
    const pass = passAt(T0, HOME, "read", READ);
    const unreadable = { ...pass, record: { ...pass.record, within: { from: "?", to: "?" } } };
    const backwards = {
      ...pass,
      record: { ...pass.record, within: { from: iso(pass.end), to: iso(T0) } },
    };
    for (const [steps, thrownOut] of [
      [[unreadable], []],
      [[backwards], []],
      [[pass], [{ from: "yesterday", to: "today" }]],
    ] as const) {
      const attempt = () => check([copyOf(...pass.entries)], [...steps], [...thrownOut]);
      expect(attempt).toThrow(CantCheckError);
      expect(attempt).toThrow(expect.objectContaining({ name: "CantCheckError" }));
    }
  });

  it("can't check a pass whose attempt's times can't be read, or end before they begin", () => {
    const pass = passAt(T0, HOME, "read", READ);
    const unreadable = {
      ...pass,
      record: { ...pass.record, within: { from: "soon", to: "later" } },
    };
    expect(() => check([copyOf(...pass.entries)], [unreadable])).toThrow(
      `the window of the read pass at ${HOME} ("soon" to "later")`,
    );
    const backwards = {
      ...pass,
      record: { ...pass.record, within: { from: iso(pass.end), to: iso(T0) } },
    };
    expect(() => check([copyOf(...pass.entries)], [backwards])).toThrow(
      "the window of the read pass at",
    );
  });

  it("with no copy of the log, has no step in it", () => {
    const pass = passAt(T0, HOME, "read", READ.slice(0, 2));
    expect(check([], [pass])).toEqual({
      transcriptLines: 2,
      logLines: 0,
      agree: 0,
      onlyInLog: [],
      onlyInTranscripts: [
        { page: HOME, pass: "read", step: 1, text: "content info landmark, Example footer" },
        { page: HOME, pass: "read", step: 2, text: "Skip to content, link" },
      ],
      outside: 0,
    });
  });
});

describe("spokenAsLogged: what NVDA logged (its entries' items), against the transcript's line", () => {
  it.each<[string[][], string, string]>([
    [[["Welcome | demo - Browser", "region"]], "Welcome demo - Browser, region", "'|' left out"],
    [[["with read.txt in it."]], "with read dot txt in it.", "'.' said by name"],
    [[['says only "edit".']], "says only edit .", "quotation marks left out, the period kept"],
    [[["click here", "."]], "click here, dot", "an item that's only a '.', said by name"],
    [[["the permissions macOS asks for."]], "the permissions mac OS asks for.", "a word split"],
    [[["Done! Next"]], "Done bang! Next", "a symbol said by name, and kept"],
    [[["Up 5% today"]], "Up 5 percent today", "a symbol after a digit, said by name"],
    [[["Read the guide."]], "Read the guide.", "a sentence's last mark that ends an item, kept"],
    [[["Read the guide."]], "Read the guide", "a sentence's last mark that ends an item, left out"],
    [[["Read more..."]], "Read more", "an ellipsis that ends an item, left out"],
    [[["Your name:"]], "Your name", "a phrase's last mark that ends an item, left out"],
    [
      [["Read the guide ."]],
      "Read the guide dot",
      "a mark that ends an item after a space, said by name",
    ],
    // Any other symbol that ends an item can still be said by name, as NVDA says it.
    [[["Up 5%"]], "Up 5 percent", "a symbol that ends an item after a digit, said by name"],
    [[["Name*"]], "Name star", "a symbol that ends an item after a letter, said by name"],
    [[["Name*", "edit"]], "Name star, edit", "a symbol that ends an item, then an item"],
    // The words for any symbol but a closing mark right after a letter or digit at an item's end are
    // any one to four whole words: they aren't compared with NVDA's own names for it, so these agree
    // though NVDA never says them.
    [[["Price: 10"]], "Price is not 10", "a symbol inside an item, as any few words"],
    [[["Hello - World"]], "Hello not World", "a symbol inside an item, as any word"],
    [[["Up 5%"]], "Up 5 is not good", "a symbol that ends an item, as any few words"],
    [[["Name*"]], "Name is not required", "another symbol that ends an item, as any few words"],
    [[["Really?!"]], "Really now please", "a closing mark that follows another, as any words"],
    [[["Next"], ["•"]], "Next. bullet", "an entry that's only a symbol, said by name"],
    [[["Two   spaces"]], "Two spaces", "spaces"],
    [[["A"], []], "A.", "an entry with no text, come through"],
    [[["A"], []], "A", "an entry with no text, not come through"],
    [[["A"], [], ["B"]], "A. . B", "an entry with no text between two, come through"],
    [[["A"], [], ["B"]], "A. B", "an entry with no text between two, not come through"],
  ])("agrees: %j and %j (%s)", (logged, spoken) => {
    expect(spokenAsLogged(logged, spoken)).toBe(true);
  });

  it.each<[string[][], string, string]>([
    [[["Read the guide."]], "Read the guides.", "a word differs"],
    [[["Home"]], "home", "a letter's case differs"],
    [[["Room 1."]], "Room 2.", "a digit differs"],
    [[["Next", "link"]], "Next, link. Previous, link", "the transcript has more"],
    [
      [
        ["Next", "link"],
        ["Previous", "link"],
      ],
      "Next, link",
      "the log has more",
    ],
    [[["section", "Your name", "edit"]], "section, Your name, edit, ", "an item the log lacks"],
    [[["AB"]], "A dot B", "a name with no symbol to stand for"],
    [[["a.b"]], "adotb", "a name that isn't a word of its own"],
    [[["Home", "link"]], "Home extra words here, link", "words where an item ends"],
    [[["Welcome"], ["Next"]], "Welcome and goodbye. Next", "words where an entry ends"],
    [[["A", "", "B"]], "A, X, B", "a word for an empty item"],
    [[["Next"], ["•"]], "Next", "an entry that's only a symbol, gone"],
    [[["A"], [], ["B"]], "A B", "no joiner at all between two entries"],
    // A sentence's or a phrase's mark (. , ; : ! ? or an ellipsis) that ends an item right after a
    // letter or digit is kept or left out, never said by name: NVDA's usual symbol level doesn't
    // say these, and words after a line's last mark are words the log doesn't have.
    [[["Read the guide."]], "Read the guide now please", "words after an item's last mark"],
    [[["Read the guide."]], "Read the guide now", "a word after an item's last mark"],
    [
      [["Read the guide.", "link"]],
      "Read the guide now, link",
      "a word after a mark, then an item",
    ],
    [[["Read more…"]], "Read more now please", "words after an ellipsis that ends an item"],
    [[["Read more..."]], "Read more now please", "words after three dots that end an item"],
    [[["Your name:"]], "Your name is not", "words after a phrase's last mark"],
    // NVDA says "!" by name only at its highest symbol level, and here it is the sentence's mark:
    // so this is a difference, even though NVDA could have said it.
    [[["Done!"]], "Done bang!", "a sentence's mark that ends an item, said by name and kept"],
    [[["Hello - World"]], "Hello one two three four five World", "five words for one symbol"],
  ])("differs: %j and %j (%s)", (logged, spoken) => {
    expect(spokenAsLogged(logged, spoken)).toBe(false);
  });

  describe("a step too long to search", () => {
    /** A line of `n` file names, and the same as NVDA says it: each "." by name. */
    const names = (n: number): [string[][], string] => [
      [[Array.from({ length: n }, (_, k) => `read${k % 10}.txt`).join(" ")]],
      Array.from({ length: n }, (_, k) => `read${k % 10} dot txt`).join(" "),
    ];

    it("agrees as NVDA says its symbols while it's short enough to search", () => {
      expect(spokenAsLogged(...names(100))).toBe(true);
    });

    it("agrees only as it is once its two sides would take over 4 million places to search", () => {
      // 400 names: 3,600 characters of the log's, spaces aside, against 5,599 of the transcript's.
      expect(spokenAsLogged(...names(400))).toBe(false);
      const [logged] = names(400);
      expect(spokenAsLogged(logged, logged[0]![0]!)).toBe(true);
    });

    it("lists a very long step that differs as a difference, without a search as long as its square", () => {
      const words = Array.from({ length: 4000 }, (_, k) => `word${k % 10}.`).join(" ");
      const spoken = `${words.slice(0, -20)} and a different end`;

      expect(spokenAsLogged([[words]], spoken)).toBe(false);
    });
  });
});
