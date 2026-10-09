/**
 * NVDA's own log, checked against the transcripts step by step (checkAgainstLog): the real run of
 * 6 October 2026 in fixture/nvda-io-run, and made-up logs for each case.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { gestureOf } from "../src/drivers/guidepup/nvda-log.js";
import type { DriverCommand, PassName, RunJson, StepRecord, TranscriptJson } from "../src/model.js";
import { checkAgainstLog, spokenAsLogged } from "../src/share/log-check.js";

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
}

interface Pass {
  entries: string[][];
  record: { page: string; pass: PassName; steps: StepRecord[] };
  /** When the pass's last step ended. */
  end: number;
}

/**
 * One pass, as a run reads it from `start`: voicecap opens the page (NVDA+T, with what NVDA says
 * of the window; Escape; Ctrl+Home, with the page's first line), then presses each step's key.
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
  const steps = lines.map((line, index): StepRecord => {
    const pressed = begin + index * STEP_MS + KEY_MS;
    if (line.key !== false) entries.push(key(pressed, gestureOf(line.command)!));
    const logged = line.logged ?? [line.spoken.split(", ")];
    logged.forEach((items, k) => entries.push(said(pressed + SPEECH_MS + 9 * k, ...items)));
    return {
      n: index + 1,
      command: line.command,
      spoken: line.spoken,
      durationMs: STEP_MS,
      offsetMs: (index + 1) * STEP_MS,
    };
  });
  return { entries, record: { page, pass, steps }, end: begin + lines.length * STEP_MS };
}

const READ: Line[] = [
  { command: "toBottom", spoken: "content info landmark, Example footer" },
  { command: "toTop", spoken: "Skip to content, link" },
  { command: "nextLine", spoken: "heading, level 1, Welcome" },
  { command: "nextLine", spoken: "Read the guide." },
];

function check(logs: string[], passes: Pass[], thrownOut: { from: string; to: string }[] = []) {
  return checkAgainstLog({ logs, steps: passes.map((pass) => pass.record), thrownOut, gestureOf });
}

const AGREED = { onlyInLog: [], onlyInTranscripts: [] };

describe("checkAgainstLog on the real run of 6 October 2026 (fixture/nvda-io-run)", () => {
  const FIXTURE = fileURLToPath(new URL("../fixture/nvda-io-run/", import.meta.url));
  const read = (...parts: string[]) => readFileSync(path.join(FIXTURE, ...parts), "utf8");
  const run = JSON.parse(read("run", "run.json")) as RunJson;
  const transcript = (slug: string, pass: PassName) =>
    JSON.parse(read("run", "pages", slug, `${pass}.json`)) as TranscriptJson;
  // The seven pages' three passes, in the order the run read them.
  const steps = run.pages.flatMap((page) =>
    run.settings.passes.map((pass) => ({
      page: page.url,
      pass,
      steps: transcript(page.slug, pass).steps,
    })),
  );
  const log = read("nvda-log", "1-1.txt");

  it("agrees on every one of the run's 204 steps", () => {
    expect(checkAgainstLog({ logs: [log], steps, thrownOut: [], gestureOf })).toEqual({
      transcriptLines: 204,
      logLines: 204,
      agree: 204,
      onlyInLog: [],
      onlyInTranscripts: [],
      // Of NVDA's 392 Speaking entries, 215 are the steps' (seven steps' speech spans two or three
      // entries). The 177 outside are: 7 before voicecap's first key (the window that was in front,
      // and the browser coming forward); 28 title checks (NVDA+T, as each of the 21 passes opened
      // its page, and once at the end of each tab pass); 21 lines at the top of each page as it
      // opened (Ctrl+Home, before each pass); and 121 between passes, as one browser closed and
      // the next opened (another window, the new browser window, and its first focus).
      outside: 177,
    });
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
    const result = check([copyOf(...failed.entries, ...kept.entries)], [kept], [window]);
    // Outside: the failed attempt's 5 Speaking entries, and the kept one's 2 as it opened.
    expect(result).toEqual({ transcriptLines: 3, logLines: 3, agree: 3, ...AGREED, outside: 7 });
  });

  it("walks two logs (a restart) in order", () => {
    const home = passAt(T0, HOME, "read", READ);
    const about = passAt(home.end + 30_000, ABOUT, "read", [
      { command: "toBottom", spoken: "content info landmark, Example footer" },
      { command: "toTop", spoken: "Skip to content, link" },
      { command: "nextLine", spoken: "heading, level 1, About us" },
      { command: "nextLine", spoken: "We make examples." },
    ]);
    const logs = [copyOf(...home.entries), copyOf(...about.entries)];
    expect(check(logs, [home, about])).toEqual({
      transcriptLines: 8,
      logLines: 8,
      agree: 8,
      ...AGREED,
      outside: 4,
    });
    // In the other order, each page's steps would meet the other page's speech.
    expect(check(logs.toReversed(), [home, about]).agree).toBeLessThan(8);
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

  it("leaves out what NVDA said after a pass's last step, as the next page opened", () => {
    const first: Line[] = [
      { command: "nextHeading", spoken: "Welcome, heading, level 1" },
      { command: "nextHeading", spoken: "no next heading" },
    ];
    const one = passAt(T0, HOME, "headings", first);
    // Another window comes forward for a moment, inside the last step's time but after its words.
    const between = [
      said(one.end + 200, "Inbox - Mail"),
      said(one.end + 220, "Inbox - Mail", "window"),
    ];
    const two = passAt(one.end + 4000, ABOUT, "headings", [
      { command: "nextHeading", spoken: "About us, heading, level 1" },
      { command: "nextHeading", spoken: "no next heading" },
    ]);
    expect(check([copyOf(...one.entries, ...between, ...two.entries)], [one, two])).toEqual({
      transcriptLines: 4,
      logLines: 4,
      agree: 4,
      ...AGREED,
      outside: 6,
    });
    // A last step that differs lists only its own words.
    const changed = passAt(T0, HOME, "headings", [
      first[0]!,
      { ...first[1]!, logged: [["No next heading"]] },
    ]);
    const result = check([copyOf(...changed.entries, ...between, ...two.entries)], [changed, two]);
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
    const result = check([copyOf(...pass.entries, ...more)], [pass]);
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
    expect(check([copyOf(...failed.entries, ...kept.entries)], [kept], [window])).toEqual({
      transcriptLines: 4,
      logLines: 4,
      agree: 4,
      ...AGREED,
      // The failed attempt's 2 lines as it opened and 4 steps' speech; the kept one's 2.
      outside: 8,
    });
  });

  it("ignores a thrown-out window whose times can't be read", () => {
    const pass = passAt(T0, HOME, "read", READ);
    const window = { from: "yesterday", to: "today" };
    expect(check([copyOf(...pass.entries)], [pass], [window])).toMatchObject({
      agree: 4,
      ...AGREED,
    });
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

describe("spokenAsLogged: what NVDA logged, against what the transcript says it said", () => {
  it.each([
    ["Welcome | demo - Browser, region", "Welcome demo - Browser, region", "'|' left out"],
    ["with read.txt in it.", "with read dot txt in it.", "'.' said by name"],
    ['says only "edit".', "says only edit .", "quotation marks left out, the period kept"],
    ["click here, .", "click here, dot", "a '.' on its own, said by name"],
    ["for the permissions macOS asks for.", "for the permissions mac OS asks for.", "a word split"],
    ["Done!", "Done bang!", "a symbol said by name, and kept"],
    ["Up 5%", "Up 5 percent", "a symbol after a digit, said by name"],
    ["  Two   spaces ", "Two spaces", "spaces"],
  ])("agrees: %j and %j (%s)", (logged, spoken) => {
    expect(spokenAsLogged(logged, spoken)).toBe(true);
  });

  it.each([
    ["Read the guide.", "Read the guides.", "a word differs"],
    ["Home", "home", "a letter's case differs"],
    ["Next, link", "Next, link. Previous, link", "the transcript has more"],
    ["Next, link. Previous, link", "Next, link", "the log has more"],
    ["section, Your name, edit", "section, Your name, edit, ", "an item the log doesn't have"],
    ["AB", "A dot B", "a name with no symbol to stand for"],
    ["a.b", "adotb", "a name that isn't a word of its own"],
    ["Room 1.", "Room 2.", "a digit differs"],
  ])("differs: %j and %j (%s)", (logged, spoken) => {
    expect(spokenAsLogged(logged, spoken)).toBe(false);
  });
});
