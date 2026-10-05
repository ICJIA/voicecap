import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type {
  AttemptRecord,
  FailureCause,
  NewRunEvent,
  PassName,
  RunEvent,
  RunJson,
} from "../src/model.js";
import { buildShareModel } from "../src/share/model.js";
import {
  KIND_ROWS,
  kindFromWording,
  problemsOf,
  type Problem,
  type ProblemKind,
} from "../src/share/problems.js";
import { standingOf } from "../src/share/standing.js";
import { findPage, SITE } from "./helpers/report-data.js";
import { failedAttempt, shareRun, type SharePageSpec } from "./helpers/share-data.js";
import { demoRun } from "./helpers/share-fixture.js";
import { inputOf, logged, loggedModel, loggedRun, PRIVATE_TITLE } from "./helpers/share-model.js";

// What voicecap 0.4.1 and 0.5.0 wrote into a page's errors, word for word (from the drivers in
// src/drivers/guidepup-nvda.ts, guidepup/chrome.ts, and guidepup/nvda.ts, the timeouts in
// src/passes/steps.ts, and the page runner's own forms in src/run/page-runner.ts).
const FOREGROUND =
  "The browser lost the foreground to another window, so this step's keystroke and speech were discarded. Keep the computer free while voicecap runs.";
const NOT_BROUGHT_FORWARD =
  "The browser window couldn't be brought to the front, so keystrokes would have gone to another window. Keep the computer free while voicecap runs: close dialogs, and don't use other windows.";
const LOCKED =
  "Windows is locked, so NVDA can't press keys or speak. Unlock the computer and keep it unlocked while voicecap runs: voicecap keeps Windows from sleeping or turning the screen off, but Win+L, a screen saver, or a workplace lock policy still lock it.";
const NVDA_STOPPED =
  "NVDA stopped running (it may have crashed), so this step's silence says nothing about the page.";
const NVDA_CONNECTION =
  "Guidepup has lost its connection to NVDA, so it no longer sends keys or hears speech.";
const STEP_TIMEOUT = "nextLine did not finish within 30s";
const OPEN_TIMEOUT = "Opening the page did not finish within 45s";
const PAGE_TIMEOUT = "The whole page did not finish within 5m 0s";
// What Playwright's error for a navigation says: the first line, then its call log.
const NAME_NOT_RESOLVED =
  'page.goto: net::ERR_NAME_NOT_RESOLVED at https://example.gov/\nCall log:\n  - navigating to "https://example.gov/", waiting until "load"';
const BROWSER_START = "Chrome didn't start: it didn't open its DevTools port within 30s";
const BROWSER_CHANGED =
  "The browser changed during the run: Chrome 141.0.7390.55 was recorded, and Chrome 142.0.7444.60 started now (browsers update themselves). Transcripts from different browser versions aren't comparable, so run the same command again to resume with the new version recorded.";

const options = { home: os.homedir(), platform: process.platform };

const problemsFor = (...runs: RunJson[]) => problemsOf(standingOf(runs), options);

/** The path of the page a problem is about. */
const pathOf = (problem: Problem) => new URL(problem.page.url).pathname;

/**
 * What each problem has in a field, by its page's path and attempt: "/a 2", or "/a -" for a problem
 * written as text without a number. Not in order: most tests don't care what order the problems are in.
 */
const field = (problems: Problem[], name: "did" | "verdict" | "happened" | "effect") =>
  Object.fromEntries(
    problems.map((problem) => [`${pathOf(problem)} ${problem.n ?? "-"}`, problem[name]]),
  );

/** A time on 26 September 2026 at 14:<minute>:<second>.<ms>, local (-05:00). */
const at = (minute: number, second = 0, ms = 0) =>
  `2026-09-26T14:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.${String(ms).padStart(3, "0")}-05:00`;

/** A failed attempt at an HTTP error: the page answered, so no step was under way. */
const httpAttempt = (n: number, status = 503) =>
  failedAttempt({ n, cause: "http", message: `HTTP ${status}`, step: null, command: null });

/** The errors of a run's failed pages. */
const errorsOfFailed = (run: RunJson) =>
  run.pages.filter((page) => page.status === "failed").flatMap((page) => page.errors);

describe("kindFromWording", () => {
  type Wording = { kind: ProblemKind; pass: PassName | null; n: number | null; message: string };
  const wording = (
    kind: ProblemKind,
    pass: PassName | null,
    n: number | null,
    message: string,
  ): Wording => ({ kind, pass, n, message });

  const WORDING: [string, string, Wording][] = [
    [
      "a pass's error (the demo's 1315)",
      `read pass: ${FOREGROUND}`,
      wording("foreground", "read", null, FOREGROUND),
    ],
    [
      "a pass's error (the demo's 1402)",
      `headings pass: ${FOREGROUND}`,
      wording("foreground", "headings", null, FOREGROUND),
    ],
    [
      "a page that couldn't be opened (the demo's 1419)",
      `Could not open the page for the read pass: ${FOREGROUND}`,
      wording("foreground", "read", null, FOREGROUND),
    ],
    [
      "a retry, with its attempt",
      `Attempt 2 failed (read pass: ${FOREGROUND}); retrying.`,
      wording("foreground", "read", 2, FOREGROUND),
    ],
    [
      "a retry of a page that couldn't be opened",
      `Attempt 1 failed (Could not open the page for the tab pass: ${NOT_BROUGHT_FORWARD}); retrying.`,
      wording("foreground", "tab", 1, NOT_BROUGHT_FORWARD),
    ],
    ["the computer locked", `tab pass: ${LOCKED}`, wording("locked", "tab", null, LOCKED)],
    [
      "NVDA stopping",
      `read pass: ${NVDA_STOPPED}`,
      wording("screen-reader-stopped", "read", null, NVDA_STOPPED),
    ],
    [
      "a retry after NVDA stopped, whose message has parentheses of its own",
      `Attempt 3 failed (read pass: ${NVDA_STOPPED}); retrying.`,
      wording("screen-reader-stopped", "read", 3, NVDA_STOPPED),
    ],
    [
      "Guidepup losing its connection to NVDA",
      `headings pass: ${NVDA_CONNECTION}`,
      wording("screen-reader-stopped", "headings", null, NVDA_CONNECTION),
    ],
    [
      "a step's timeout",
      `read pass: ${STEP_TIMEOUT}`,
      wording("timeout", "read", null, STEP_TIMEOUT),
    ],
    [
      "a page that took too long to open",
      `Could not open the page for the read pass: ${OPEN_TIMEOUT}`,
      wording("timeout", "read", null, OPEN_TIMEOUT),
    ],
    [
      "the whole page's timeout, in a retry",
      `Attempt 4 failed (read pass: ${PAGE_TIMEOUT}); retrying.`,
      wording("timeout", "read", 4, PAGE_TIMEOUT),
    ],
    ["an HTTP 5xx", "HTTP 503", wording("http", null, null, "HTTP 503")],
    [
      "a retry after an HTTP 5xx",
      "Attempt 1 failed (HTTP 502); retrying.",
      wording("http", null, 1, "HTTP 502"),
    ],
    ["an HTTP 4xx", "HTTP 404", wording("http", null, null, "HTTP 404")],
    [
      "a browser that didn't start",
      `Could not open the page for the read pass: ${BROWSER_START}`,
      wording("browser", "read", null, BROWSER_START),
    ],
    [
      "a browser that changed during the run",
      `Could not open the page for the headings pass: ${BROWSER_CHANGED}`,
      wording("browser", "headings", null, BROWSER_CHANGED),
    ],
    [
      "an error voicecap's own wording doesn't cover",
      "read pass: Cannot read properties of undefined (reading 'name')",
      wording("unexpected", "read", null, "Cannot read properties of undefined (reading 'name')"),
    ],
    [
      "a network error Chrome reported, as voicecap 0.5.0 recorded it",
      "Could not open the page for the read pass: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4848/",
      wording(
        "unreachable",
        "read",
        null,
        "page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4848/",
      ),
    ],
    [
      "a network error with Playwright's call log, in a retry",
      `Attempt 2 failed (Could not open the page for the tab pass: ${NAME_NOT_RESOLVED}); retrying.`,
      wording("unreachable", "tab", 2, NAME_NOT_RESOLVED),
    ],
    [
      "a network error without the method's name",
      "Could not open the page for the headings pass: net::ERR_INTERNET_DISCONNECTED at https://example.gov/",
      wording(
        "unreachable",
        "headings",
        null,
        "net::ERR_INTERNET_DISCONNECTED at https://example.gov/",
      ),
    ],
    [
      "a network error with nothing around it",
      "page.goto: net::ERR_CONNECTION_RESET at http://127.0.0.1:4848/",
      wording(
        "unreachable",
        null,
        null,
        "page.goto: net::ERR_CONNECTION_RESET at http://127.0.0.1:4848/",
      ),
    ],
    [
      "another browser library error, which voicecap didn't word",
      "Could not open the page for the read pass: page.evaluate: Execution context was destroyed, most likely because of a navigation",
      wording(
        "unexpected",
        "read",
        null,
        "page.evaluate: Execution context was destroyed, most likely because of a navigation",
      ),
    ],
    [
      "a network error of Node's, not Chrome's",
      "Could not open the page for the read pass: connect ECONNREFUSED 127.0.0.1:4848",
      wording("unexpected", "read", null, "connect ECONNREFUSED 127.0.0.1:4848"),
    ],
    [
      "something that is no form voicecap wrote",
      "Something went wrong",
      wording("unexpected", null, null, "Something went wrong"),
    ],
    [
      "words about HTTP that aren't a status",
      "HTTP errors are common",
      wording("unexpected", null, null, "HTTP errors are common"),
    ],
  ];

  it.each(WORDING)(
    "reads the wording voicecap 0.4.1 and 0.5.0 wrote: %s",
    (_name, entry, expected) => {
      expect(kindFromWording(entry)).toEqual(expected);
    },
  );

  it("reads the demo runs' own errors", () => {
    const entries = [
      ...errorsOfFailed(demoRun("1315")),
      ...errorsOfFailed(demoRun("1402")),
      ...errorsOfFailed(demoRun("1419")),
    ];

    expect(entries.map((entry) => kindFromWording(entry).kind)).toEqual([
      "foreground",
      "foreground",
      "foreground",
    ]);
    expect(entries.map((entry) => kindFromWording(entry).pass)).toEqual([
      "read",
      "headings",
      "read",
    ]);
  });
});

describe("problemsOf: which problems, and their kinds", () => {
  it("takes the kind from the cause code", () => {
    const causes: [FailureCause, ProblemKind][] = [
      ["foreground", "foreground"],
      ["locked", "locked"],
      ["screen-reader-stopped", "screen-reader-stopped"],
      ["browser", "browser"],
      ["http", "http"],
      ["unreachable", "unreachable"],
      ["open-timeout", "timeout"],
      ["step-timeout", "timeout"],
      ["page-timeout", "timeout"],
      ["unexpected", "unexpected"],
    ];
    const run = shareRun({
      id: "r1",
      pages: causes.map(([cause], index) => ({
        path: `/${cause}`,
        status: "failed" as const,
        failedAttempts: [
          failedAttempt({ n: 1, cause, startedAt: at(index), endedAt: at(index, 30) }),
        ],
      })),
    });
    const { problems } = problemsFor(run);

    expect(problems.map((problem) => [pathOf(problem), problem.kind])).toEqual(
      causes.map(([cause, kind]) => [`/${cause}`, kind]),
    );
    expect(problems.every((problem) => !problem.fromWording)).toBe(true);
  });

  it("reads a cause code it doesn't know as an unexpected error", () => {
    // A newer voicecap's code: the spec's rule is that any other error is unexpected.
    const stack = "Error: a newer failure\n    at somewhere (file:///C:/voicecap/dist/x.js:1:1)";
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/a",
          status: "failed",
          failedAttempts: [
            failedAttempt({
              n: 1,
              cause: "some-newer-cause" as never,
              message: "A newer voicecap's message",
              stack,
              startedAt: at(7),
              endedAt: at(7, 5),
            }),
          ],
        },
      ],
    });
    const { problems, line, unexpected } = problemsFor(run);

    expect(problems.map((problem) => [problem.kind, problem.fromWording])).toEqual([
      ["unexpected", false],
    ]);
    expect(problems[0]?.happened).toBe(
      "During the read pass, at step 12 (Down Arrow), an unexpected error came up.",
    );
    // The record keeps the code as it was written, and an unexpected error shows its stack.
    expect(problems[0]?.record).toEqual([
      { time: at(7), source: "run.json", entry: "Attempt 1 started" },
      {
        time: at(7, 5),
        source: "run.json",
        entry: "Failed: some-newer-cause: A newer voicecap's message",
      },
      { time: at(7, 5), source: "stack", entry: stack },
    ]);
    expect(unexpected).toBe(1);
    expect(line).toBe(
      "1 problem: an unexpected error. It wasn't tried again. 1 was an unexpected error, the kind that could mean a problem in voicecap itself: see its record.",
    );
  });

  it("takes every failed attempt of the runs the standing draws on, and no others", () => {
    const older = shareRun({
      id: "r0",
      createdAt: "2026-09-18T09:30:00-05:00",
      pages: [{ path: "/", failedAttempts: [failedAttempt({ n: 1 })] }],
    });
    const before = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      pages: [{ path: "/", failedAttempts: [failedAttempt({ n: 1 })] }],
    });
    const latest = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      pages: [
        { path: "/", failedAttempts: [failedAttempt({ n: 1 }), failedAttempt({ n: 2 })] },
        { path: "/b" },
      ],
    });
    const unfinished = shareRun({
      id: "r3",
      createdAt: "2026-09-27T14:05:00-05:00",
      status: "incomplete",
      pages: [{ path: "/", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] }],
    });
    const replayed = shareRun({
      id: "r4",
      createdAt: "2026-09-28T14:05:00-05:00",
      replayed: true,
      pages: [{ path: "/", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] }],
    });

    // The oldest run counts, but the standing doesn't draw on it: every result it has is a later run's.
    const { problems } = problemsFor(older, before, latest, unfinished, replayed);

    expect(problems.map((problem) => [problem.run, problem.n])).toEqual([
      ["r1", 1],
      ["r2", 1],
      ["r2", 2],
    ]);
  });

  it("takes a page's problems from its attempt records, and from its errors when it has none", () => {
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.5.0",
      pages: [
        {
          path: "/recorded",
          failedAttempts: [failedAttempt({ n: 1 })],
          // 0.6.0 keeps its errors too, naming the same attempts: they aren't problems of their own.
          errors: [`Attempt 1 failed (read pass: ${FOREGROUND}); retrying.`],
        },
        {
          path: "/two",
          status: "failed",
          attempts: 2,
          errors: [
            `Attempt 1 failed (read pass: ${STEP_TIMEOUT}); retrying.`,
            `read pass: ${STEP_TIMEOUT}`,
          ],
        },
        {
          path: "/written",
          attempts: 2,
          errors: [`Attempt 1 failed (read pass: ${STEP_TIMEOUT}); retrying.`],
        },
        { path: "/nothing" },
      ],
    });
    const { problems } = problemsFor(run);

    expect(problems.map((problem) => [pathOf(problem), problem.kind, problem.fromWording])).toEqual(
      [
        // What's written as text is from the run's earlier session, so it comes first, in page order.
        ["/two", "timeout", true],
        ["/two", "timeout", true],
        ["/written", "timeout", true],
        ["/recorded", "foreground", false],
      ],
    );
  });

  it("lists the attempts oldest first, by when each began", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        // A resumed run tries the pages that failed before last, so the page order isn't the time order.
        {
          path: "/first-listed",
          status: "failed",
          failedAttempts: [failedAttempt({ n: 1, startedAt: at(20), endedAt: at(20, 9) })],
        },
        {
          path: "/second-listed",
          status: "failed",
          failedAttempts: [
            failedAttempt({ n: 1, startedAt: at(10, 30), endedAt: at(10, 40) }),
            failedAttempt({ n: 2, startedAt: at(10, 50), endedAt: at(10, 59) }),
          ],
        },
      ],
    });
    const later = shareRun({
      id: "r2",
      createdAt: "2026-09-27T09:00:00-05:00",
      pages: [
        {
          path: "/first-listed",
          failedAttempts: [failedAttempt({ n: 1, startedAt: "2026-09-27T09:01:00.000-05:00" })],
        },
      ],
    });
    const { problems } = problemsFor(run, later);

    expect(problems.map((problem) => [problem.run, pathOf(problem), problem.n])).toEqual([
      ["r1", "/second-listed", 1],
      ["r1", "/second-listed", 2],
      ["r1", "/first-listed", 1],
      ["r2", "/first-listed", 1],
    ]);
  });

  it("lists the problems written as text by run, then page order", () => {
    const first = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      voicecapVersion: "0.4.1",
      pages: [
        { path: "/b", status: "failed", errors: [`read pass: ${LOCKED}`] },
        { path: "/a", status: "failed", errors: [`headings pass: ${FOREGROUND}`] },
      ],
    });
    const second = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      voicecapVersion: "0.4.1",
      pages: [{ path: "/a", status: "failed", errors: [`tab pass: ${NVDA_STOPPED}`] }],
    });
    const { problems } = problemsFor(first, second);

    expect(problems.map((problem) => [problem.run, pathOf(problem), problem.kind])).toEqual([
      ["r1", "/b", "locked"],
      ["r1", "/a", "foreground"],
      ["r2", "/a", "screen-reader-stopped"],
    ]);
    // Nothing records when an attempt began or ended, or which one it was.
    expect(problems.map((problem) => [problem.n, problem.startedAt, problem.endedAt])).toEqual([
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ]);
  });
});

describe("problemsOf: what happened, and what voicecap did", () => {
  it("names the pass, the step, and the key in plain words", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/a",
          failedAttempts: [
            failedAttempt({ n: 1, pass: "read", step: 12, command: "nextLine" }),
            failedAttempt({
              n: 2,
              pass: "headings",
              step: 3,
              command: "nextHeading",
              cause: "locked",
            }),
            failedAttempt({
              n: 3,
              pass: "tab",
              step: 5,
              command: "nextFocusable",
              cause: "step-timeout",
            }),
            failedAttempt({
              n: 4,
              pass: "read",
              step: 2,
              command: "toTop",
              cause: "screen-reader-stopped",
            }),
            failedAttempt({ n: 5, pass: "read", step: 1, command: "toBottom", cause: "browser" }),
            failedAttempt({
              n: 6,
              pass: "tab",
              step: null,
              command: "openPage",
              cause: "unreachable",
            }),
            httpAttempt(7, 502),
            failedAttempt({
              n: 8,
              pass: "headings",
              step: 4,
              command: "nextHeading",
              cause: "unexpected",
              message: "boom",
            }),
          ],
        },
      ],
    });
    const { problems } = problemsFor(run);

    expect(field(problems, "happened")).toEqual({
      "/a 1": "During the read pass, at step 12 (Down Arrow), another window took the screen.",
      "/a 2": "During the headings pass, at step 3 (H), the computer locked.",
      "/a 3": "During the tab pass, at step 5 (Tab), a step took too long.",
      "/a 4": "During the read pass, at step 2 (Ctrl+Home), NVDA stopped running.",
      "/a 5": "During the read pass, at step 1 (Ctrl+End), the browser stopped or didn't start.",
      "/a 6": "The website couldn't be reached while opening the page for the tab pass.",
      "/a 7": "The website answered with an error while loading the page for the read pass.",
      "/a 8": "During the headings pass, at step 4 (H), an unexpected error came up.",
    });
    expect(
      Object.fromEntries(
        problems.map((problem) => [
          String(problem.n),
          [problem.pass, problem.step, problem.command],
        ]),
      ),
    ).toEqual({
      1: ["read", 12, "nextLine"],
      2: ["headings", 3, "nextHeading"],
      3: ["tab", 5, "nextFocusable"],
      4: ["read", 2, "toTop"],
      5: ["read", 1, "toBottom"],
      6: ["tab", null, "openPage"],
      7: ["read", null, null],
      8: ["headings", 4, "nextHeading"],
    });
  });

  it("says what it can when a record leaves out the key or the pass", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/a",
          failedAttempts: [
            failedAttempt({ n: 1, pass: "tab", step: 3, command: null, cause: "step-timeout" }),
            failedAttempt({ n: 2, pass: null, step: null, command: null, cause: "browser" }),
            // A key voicecap has no plain name for is named as it is.
            failedAttempt({ n: 3, step: 4, command: "someFutureCommand" as never }),
          ],
        },
      ],
    });
    const { problems } = problemsFor(run);

    expect(field(problems, "happened")).toEqual({
      "/a 1": "During the tab pass, at step 3, a step took too long.",
      "/a 2": "The browser stopped or didn't start while the page was being transcribed.",
      "/a 3":
        "During the read pass, at step 4 (someFutureCommand), another window took the screen.",
    });
  });

  it("names the page as its record does", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        { path: "/named", label: "Grants", failedAttempts: [failedAttempt({ n: 1 })] },
        { path: "/plain", failedAttempts: [failedAttempt({ n: 1 })] },
      ],
    });
    const { problems } = problemsFor(run);
    const named = findPage(run, "/named");
    const plain = findPage(run, "/plain");

    expect(problems.map((problem) => problem.page)).toEqual([
      { key: named.key, slug: named.slug, url: named.url, label: "Grants" },
      { key: plain.key, slug: plain.slug, url: plain.url },
    ]);
    expect("label" in (problems[1]?.page ?? {})).toBe(false);
  });

  it("says what it can of a problem written as text", () => {
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.5.0",
      pages: [
        { path: "/pass", status: "failed", errors: [`headings pass: ${FOREGROUND}`] },
        {
          path: "/opening",
          status: "failed",
          errors: [`Could not open the page for the read pass: ${FOREGROUND}`],
        },
        { path: "/status", status: "failed", errors: ["HTTP 503"] },
        { path: "/other", status: "failed", errors: ["Something went wrong"] },
      ],
    });
    const { problems } = problemsFor(run);

    expect(field(problems, "happened")).toEqual({
      "/pass -": "During the headings pass, another window took the screen.",
      "/opening -": "Another window took the screen while opening the page for the read pass.",
      "/status -": "The website answered with an error while loading the page.",
      "/other -": "An unexpected error came up while the page was being transcribed.",
    });
    expect(
      Object.fromEntries(
        problems.map((problem) => [pathOf(problem), [problem.pass, problem.step, problem.command]]),
      ),
    ).toEqual({
      "/pass": ["headings", null, null],
      "/opening": ["read", null, "openPage"],
      "/status": [null, null, null],
      "/other": [null, null, null],
    });
  });

  it("says what voicecap did after each failed attempt", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        { path: "/restarted", failedAttempts: [failedAttempt({ n: 1, restarted: true })] },
        { path: "/server", failedAttempts: [httpAttempt(1, 503)] },
        // The restart didn't finish, or the run was resumed: it isn't known that NVDA started afresh.
        {
          path: "/unfinished",
          failedAttempts: [failedAttempt({ n: 1, cause: "step-timeout", restarted: false })],
        },
        {
          path: "/gave-up",
          status: "failed",
          failedAttempts: [failedAttempt({ n: 1, restarted: true }), failedAttempt({ n: 2 })],
        },
        { path: "/missing", status: "failed", failedAttempts: [httpAttempt(1, 404)] },
        {
          path: "/down",
          status: "failed",
          failedAttempts: [httpAttempt(1, 503), httpAttempt(2, 503)],
        },
      ],
    });
    const { problems } = problemsFor(run);
    const restarted =
      "Threw the step out, restarted NVDA and the browser, and tried again (attempt 2)";

    expect(field(problems, "did")).toEqual({
      "/restarted 1": restarted,
      "/server 1": "Tried again (attempt 2)",
      "/unfinished 1": "Tried again (attempt 2)",
      "/gave-up 1": restarted,
      "/gave-up 2": "Recorded the page as failed",
      "/missing 1": "Recorded the page as failed: trying again can't help with an HTTP 4xx",
      "/down 1": "Tried again (attempt 2)",
      "/down 2": "Recorded the page as failed",
    });
  });

  it("says what voicecap did after a problem written as text", () => {
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.5.0",
      pages: [
        {
          path: "/retried",
          attempts: 2,
          errors: [`Attempt 1 failed (read pass: ${STEP_TIMEOUT}); retrying.`],
        },
        {
          path: "/failed",
          status: "failed",
          attempts: 3,
          errors: [
            `Attempt 1 failed (read pass: ${STEP_TIMEOUT}); retrying.`,
            `Attempt 2 failed (read pass: ${STEP_TIMEOUT}); retrying.`,
            `read pass: ${STEP_TIMEOUT}`,
          ],
        },
        // A page read in full has no final error to record: nothing says what was done about this.
        { path: "/odd", errors: [`read pass: ${STEP_TIMEOUT}`] },
      ],
    });
    const { problems } = problemsFor(run);

    expect(field(problems, "did")).toEqual({
      "/retried 1": "Tried again (attempt 2)",
      "/failed 1": "Tried again (attempt 2)",
      "/failed 2": "Tried again (attempt 3)",
      "/failed -": "Recorded the page as failed",
      "/odd -": "Not recorded: this run used voicecap 0.5.0.",
    });
  });
});

describe("problemsOf: did it happen again?", () => {
  const NOT_KNOWN =
    "Not known: this run didn't try the page again, and no other run read it in full.";
  const ON_THIS_COMPUTER =
    "That points to something on this computer, such as another program, rather than a one-off.";
  const THIS_PAGE_OR_VOICECAP = "That points to this page, or to voicecap, rather than a one-off.";

  it("says no, read in full on a later attempt, with NVDA started fresh", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        { path: "/a", failedAttempts: [failedAttempt({ n: 1, restarted: true })] },
        // The attempt before the one that read it didn't restart (an HTTP 5xx is tried again as it is).
        { path: "/b", failedAttempts: [httpAttempt(1)] },
      ],
    });
    const { problems } = problemsFor(run);

    expect(field(problems, "verdict")).toEqual({
      "/a 1": "No: read in full on attempt 2, with NVDA and the browser started fresh.",
      "/b 1": "No: read in full on attempt 2.",
    });
    expect(problems.map((problem) => problem.again)).toEqual(["no", "no"]);
  });

  it("names the attempt that read the page in full, however many failed before it", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/a",
          failedAttempts: [
            failedAttempt({ n: 1, restarted: true }),
            failedAttempt({ n: 2, cause: "step-timeout", restarted: true }),
          ],
        },
      ],
    });
    const { problems } = problemsFor(run);

    // Neither was followed by a failure of its own kind, so neither happened again.
    expect(field(problems, "verdict")).toEqual({
      "/a 1": "No: read in full on attempt 3, with NVDA and the browser started fresh.",
      "/a 2": "No: read in full on attempt 3, with NVDA and the browser started fresh.",
    });
  });

  it("says no only when a later run read the page in full; an earlier one doesn't say", () => {
    const failedFirst = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      pages: [
        { path: "/a", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
        { path: "/b" },
      ],
    });
    const failedLast = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      pages: [
        { path: "/a" },
        { path: "/b", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
      ],
    });
    const { problems } = problemsFor(failedFirst, failedLast);

    // Nothing that came after r2's failure read /b: that r1 read it before shows nothing about it.
    expect(problems.map((problem) => [problem.run, pathOf(problem), problem.verdict])).toEqual([
      ["r1", "/a", "No: read in full in run r2."],
      [
        "r2",
        "/b",
        "Not known: this run didn't try the page again; run r1, before it, read it in full.",
      ],
    ]);
    expect(problems.map((problem) => problem.again)).toEqual(["no", "unknown"]);
  });

  it("names the nearest run that read the page in full: the next after it, else the last before", () => {
    const attempt = (path: string) => ({
      path,
      status: "failed" as const,
      failedAttempts: [failedAttempt({ n: 1 })],
    });
    // /x keeps the first run among those the standing draws on: it's where /x was last read.
    const { problems } = problemsFor(
      shareRun({
        id: "ra",
        createdAt: "2026-09-18T09:30:00-05:00",
        pages: [attempt("/a"), { path: "/x" }],
      }),
      shareRun({
        id: "rb",
        createdAt: "2026-09-20T09:30:00-05:00",
        pages: [{ path: "/a" }, attempt("/x")],
      }),
      shareRun({
        id: "rc",
        createdAt: "2026-09-26T14:05:00-05:00",
        pages: [{ path: "/a" }, attempt("/x")],
      }),
    );

    expect(problems.map((problem) => [problem.run, pathOf(problem), problem.verdict])).toEqual([
      ["ra", "/a", "No: read in full in run rb."],
      [
        "rb",
        "/x",
        "Not known: this run didn't try the page again; run ra, before it, read it in full.",
      ],
      [
        "rc",
        "/x",
        "Not known: this run didn't try the page again; run ra, before it, read it in full.",
      ],
    ]);
    expect(problems.map((problem) => problem.again)).toEqual(["no", "unknown", "unknown"]);
  });

  it("says yes, then read in full, when the next attempt failed the same way and the page got through", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/a",
          failedAttempts: [
            failedAttempt({ n: 1, restarted: true }),
            failedAttempt({ n: 2, restarted: true }),
          ],
        },
      ],
    });
    const { problems, line } = problemsFor(run);

    expect(field(problems, "verdict")).toEqual({
      "/a 1": "Yes, on attempt 2, then read in full on attempt 3.",
      "/a 2": "No: read in full on attempt 3, with NVDA and the browser started fresh.",
    });
    expect(problems.map((problem) => problem.again)).toEqual(["same", "no"]);
    expect(line).toBe(
      "2 problems, both outside voicecap: another window took the screen. 1 happened again, and 1 didn't happen again. Neither was an unexpected error, the kind that could mean a problem in voicecap itself.",
    );
  });

  it("counts a later failure of the same kind even when another kind came between", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/a",
          failedAttempts: [
            failedAttempt({ n: 1, restarted: true }),
            failedAttempt({ n: 2, cause: "step-timeout", restarted: true }),
            failedAttempt({ n: 3, restarted: true }),
          ],
        },
      ],
    });
    const { problems } = problemsFor(run);

    expect(field(problems, "verdict")).toEqual({
      "/a 1": "Yes, on attempt 3, then read in full on attempt 4.",
      "/a 2": "No: read in full on attempt 4, with NVDA and the browser started fresh.",
      "/a 3": "No: read in full on attempt 4, with NVDA and the browser started fresh.",
    });
    expect(problems.map((problem) => problem.again)).toEqual(["same", "no", "no"]);
  });

  it.each<[string, FailureCause, string]>([
    ["a foreground loss", "foreground", ON_THIS_COMPUTER],
    ["the computer locked", "locked", ON_THIS_COMPUTER],
    ["NVDA stopping", "screen-reader-stopped", THIS_PAGE_OR_VOICECAP],
    ["a browser that didn't start", "browser", THIS_PAGE_OR_VOICECAP],
    ["a step that took too long", "step-timeout", THIS_PAGE_OR_VOICECAP],
    ["an unexpected error", "unexpected", THIS_PAGE_OR_VOICECAP],
    ["an HTTP error", "http", "That points to the website."],
    ["a website that couldn't be reached", "unreachable", "That points to the website."],
  ])(
    "says yes, on every attempt, and what failing every time points to, for each kind: %s",
    (_name, cause, points) => {
      const run = shareRun({
        id: "r1",
        pages: [
          {
            path: "/a",
            status: "failed",
            failedAttempts: [1, 2, 3].map((n) =>
              failedAttempt({
                n,
                cause,
                ...(cause === "http" ? { message: "HTTP 503", step: null, command: null } : {}),
                restarted: n < 3,
              }),
            ),
          },
        ],
      });
      const { problems } = problemsFor(run);

      // The page never got through in this run, so every problem says it failed every time, the
      // last as much as the others.
      const every = `Yes, on every attempt (3 of 3). ${points}`;
      expect(problems.map((problem) => problem.verdict)).toEqual([every, every, every]);
      expect(problems.map((problem) => problem.again)).toEqual(["same", "same", "same"]);
    },
  );

  it("says yes, on every attempt, for a page that failed all five the same way", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/a",
          status: "failed",
          failedAttempts: [1, 2, 3, 4, 5].map((n) => failedAttempt({ n, restarted: n < 5 })),
        },
      ],
    });
    const { problems, line } = problemsFor(run);

    const every = `Yes, on every attempt (5 of 5). ${ON_THIS_COMPUTER}`;
    expect(field(problems, "verdict")).toEqual({
      "/a 1": every,
      "/a 2": every,
      "/a 3": every,
      "/a 4": every,
      "/a 5": every,
    });
    expect(problems.map((problem) => problem.again)).toEqual(Array<string>(5).fill("same"));
    expect(line).toBe(
      "5 problems, all outside voicecap: another window took the screen. All happened again. None was an unexpected error, the kind that could mean a problem in voicecap itself.",
    );
  });

  it("says yes on every attempt, whatever another run read of the page", () => {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      pages: [{ path: "/a" }],
    });
    const latest = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      pages: [
        {
          path: "/a",
          status: "failed",
          failedAttempts: [failedAttempt({ n: 1 }), failedAttempt({ n: 2 })],
        },
      ],
    });
    const { problems } = problemsFor(earlier, latest);

    // It failed on both attempts here, which an earlier run's read of the page doesn't change.
    const every = `Yes, on every attempt (2 of 2). ${ON_THIS_COMPUTER}`;
    expect(problems.map((problem) => problem.verdict)).toEqual([every, every]);
    expect(problems.map((problem) => problem.again)).toEqual(["same", "same"]);
  });

  it("says yes, on the attempt it happened again, when not every attempt failed that way", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/a",
          status: "failed",
          failedAttempts: [
            failedAttempt({ n: 1, restarted: true }),
            failedAttempt({ n: 2, cause: "step-timeout", restarted: true }),
            failedAttempt({ n: 3 }),
          ],
        },
      ],
    });
    const { problems } = problemsFor(run);

    expect(field(problems, "verdict")).toEqual({
      "/a 1": "Yes, on attempt 3.",
      "/a 2": "Yes, in different ways: another window took the screen (attempt 3).",
      // Nothing followed the last, so it says how the page failed over all its attempts.
      "/a 3":
        "Yes, in different ways: another window took the screen (attempts 1 and 3), and a step took too long (attempt 2).",
    });
    expect(problems.map((problem) => problem.again)).toEqual(["same", "different", "different"]);
  });

  it("says yes, in different ways, on every attempt of a page that failed three different ways", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/a",
          status: "failed",
          failedAttempts: [
            failedAttempt({ n: 1, restarted: true }),
            failedAttempt({ n: 2, cause: "step-timeout", restarted: true }),
            failedAttempt({ n: 3, cause: "browser" }),
          ],
        },
      ],
    });
    const { problems, line } = problemsFor(run);

    expect(field(problems, "verdict")).toEqual({
      // What followed each of the first two.
      "/a 1":
        "Yes, in different ways: a step took too long (attempt 2), and the browser stopped or didn't start (attempt 3).",
      "/a 2": "Yes, in different ways: the browser stopped or didn't start (attempt 3).",
      // Nothing followed the last: all three attempts, each kind with its number.
      "/a 3":
        "Yes, in different ways: another window took the screen (attempt 1), a step took too long (attempt 2), and the browser stopped or didn't start (attempt 3).",
    });
    expect(problems.map((problem) => problem.again)).toEqual(Array<string>(3).fill("different"));
    expect(line).toBe(
      "3 problems: another window took the screen (1), the browser stopped or didn't start (1), and a step took too long (1). All happened again. None was an unexpected error, the kind that could mean a problem in voicecap itself.",
    );
  });

  it("says yes, in different ways, naming what followed", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/b",
          status: "failed",
          failedAttempts: [
            failedAttempt({ n: 1, restarted: true }),
            failedAttempt({ n: 2, cause: "step-timeout", restarted: true }),
            failedAttempt({ n: 3, cause: "browser" }),
          ],
        },
      ],
    });
    const { problems } = problemsFor(run);

    expect(field(problems, "verdict")).toEqual({
      "/b 1":
        "Yes, in different ways: a step took too long (attempt 2), and the browser stopped or didn't start (attempt 3).",
      "/b 2": "Yes, in different ways: the browser stopped or didn't start (attempt 3).",
      "/b 3":
        "Yes, in different ways: another window took the screen (attempt 1), a step took too long (attempt 2), and the browser stopped or didn't start (attempt 3).",
    });
    expect(problems.map((problem) => problem.again)).toEqual([
      "different",
      "different",
      "different",
    ]);
  });

  it("lists two, three, or more attempts of a kind that followed", () => {
    const failing = (kinds: FailureCause[]) => ({
      status: "failed" as const,
      failedAttempts: kinds.map((cause, index) =>
        failedAttempt({ n: index + 1, cause, restarted: true }),
      ),
    });
    const run = shareRun({
      id: "r1",
      pages: [
        { path: "/two", ...failing(["step-timeout", "foreground", "foreground"]) },
        { path: "/three", ...failing(["step-timeout", "foreground", "foreground", "foreground"]) },
      ],
    });
    const { problems } = problemsFor(run);

    expect(field(problems, "verdict")).toEqual({
      "/two 1": "Yes, in different ways: another window took the screen (attempts 2 and 3).",
      "/two 2": "Yes, on attempt 3.",
      "/two 3":
        "Yes, in different ways: a step took too long (attempt 1), and another window took the screen (attempts 2 and 3).",
      "/three 1": "Yes, in different ways: another window took the screen (attempts 2, 3, and 4).",
      "/three 2": "Yes, on attempt 3.",
      "/three 3": "Yes, on attempt 4.",
      "/three 4":
        "Yes, in different ways: a step took too long (attempt 1), and another window took the screen (attempts 2, 3, and 4).",
    });
  });

  it("says what a problem written as text came to", () => {
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.5.0",
      pages: [
        // Read in full on its second attempt: the text doesn't say whether NVDA started afresh.
        {
          path: "/retried",
          attempts: 2,
          errors: [`Attempt 1 failed (read pass: ${STEP_TIMEOUT}); retrying.`],
        },
        {
          path: "/every-time",
          status: "failed",
          attempts: 3,
          errors: [
            "Attempt 1 failed (HTTP 503); retrying.",
            "Attempt 2 failed (HTTP 503); retrying.",
            "HTTP 503",
          ],
        },
        {
          path: "/in-ways",
          status: "failed",
          attempts: 2,
          errors: [
            `Attempt 1 failed (read pass: ${FOREGROUND}); retrying.`,
            `read pass: ${STEP_TIMEOUT}`,
          ],
        },
        {
          path: "/then-read",
          attempts: 3,
          errors: [
            `Attempt 1 failed (read pass: ${FOREGROUND}); retrying.`,
            `Attempt 2 failed (read pass: ${FOREGROUND}); retrying.`,
          ],
        },
      ],
    });
    const { problems } = problemsFor(run);
    const everyTime = "Yes, on every attempt (3 of 3). That points to the website.";

    expect(field(problems, "verdict")).toEqual({
      "/retried 1": "No: read in full on attempt 2.",
      "/every-time 1": everyTime,
      "/every-time 2": everyTime,
      "/every-time -": everyTime,
      "/in-ways 1": "Yes, in different ways: a step took too long (attempt 2).",
      "/in-ways -":
        "Yes, in different ways: another window took the screen (attempt 1), and a step took too long (attempt 2).",
      "/then-read 1": "Yes, on attempt 2, then read in full on attempt 3.",
      "/then-read 2": "No: read in full on attempt 3.",
    });
  });

  it("says it isn't known when the page wasn't tried again and no other run read it", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        { path: "/a", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
        { path: "/b", status: "failed", failedAttempts: [httpAttempt(1, 404)] },
        {
          path: "/c",
          status: "failed",
          attempts: 1,
          errors: [`read pass: ${FOREGROUND}`],
        },
      ],
    });
    const { problems } = problemsFor(run);

    expect(problems.map((problem) => problem.verdict)).toEqual([NOT_KNOWN, NOT_KNOWN, NOT_KNOWN]);
    expect(problems.map((problem) => problem.again)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("says no, not unknown, once a later run the standing draws on read the page in full", () => {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      pages: [{ path: "/a", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] }],
    });
    const latest = shareRun({ id: "r2", pages: [{ path: "/a" }] });
    const { problems } = problemsFor(earlier, latest);

    expect(problems.map((problem) => [problem.verdict, problem.again])).toEqual([
      ["No: read in full in run r2.", "no"],
    ]);
  });

  it("says it isn't known, naming the run before, when only an earlier run read the page in full", () => {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      pages: [{ path: "/a" }],
    });
    const latest = shareRun({
      id: "r2",
      pages: [{ path: "/a", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] }],
    });
    const { problems, line } = problemsFor(earlier, latest);

    expect(problems.map((problem) => [problem.verdict, problem.again])).toEqual([
      [
        "Not known: this run didn't try the page again; run r1, before it, read it in full.",
        "unknown",
      ],
    ]);
    expect(line).toBe(
      "1 problem, outside voicecap: another window took the screen. It wasn't tried again. It wasn't an unexpected error, the kind that could mean a problem in voicecap itself.",
    );
  });

  it("says when a later attempt loaded the page and voicecap skipped it", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/a",
          status: "skipped",
          failedAttempts: [failedAttempt({ n: 1, cause: "step-timeout", restarted: true })],
        },
      ],
    });
    const { problems } = problemsFor(run);

    expect(problems.map((problem) => [problem.verdict, problem.again])).toEqual([
      ["No: attempt 2 loaded the page, and voicecap skipped it.", "no"],
    ]);
  });

  it("says what followed a failure on a page that was skipped in the end", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/same",
          status: "skipped",
          failedAttempts: [failedAttempt({ n: 1 }), failedAttempt({ n: 2 })],
        },
        {
          path: "/other",
          status: "skipped",
          failedAttempts: [failedAttempt({ n: 1 }), failedAttempt({ n: 2, cause: "step-timeout" })],
        },
      ],
    });
    const { problems } = problemsFor(run);

    expect(field(problems, "verdict")).toEqual({
      "/same 1": "Yes, on attempt 2.",
      "/same 2": "No: attempt 3 loaded the page, and voicecap skipped it.",
      "/other 1": "Yes, in different ways: a step took too long (attempt 2).",
      "/other 2": "No: attempt 3 loaded the page, and voicecap skipped it.",
    });
    expect(problems.map((problem) => problem.again)).toEqual(["same", "no", "different", "no"]);
  });
});

describe("problemsOf: the effect, and the record", () => {
  // A failure that a later attempt followed had its partial transcripts moved into attempts/<slug>/
  // when that attempt began, if it left any. An attempt record lists no files to say whether it did.
  const kept = (slug: string) =>
    `Earlier attempts' partial transcripts, if any, are kept in attempts/${slug}/ in the run's folder.`;

  it("says which attempt's transcripts are shown, and where a failure a later attempt followed left its own", () => {
    const run = shareRun({
      id: "r1",
      pages: [{ path: "/a", files: ["read.txt"], failedAttempts: [failedAttempt({ n: 1 })] }],
    });
    const { problems } = problemsFor(run);

    expect(problems.map((problem) => problem.effect)).toEqual([
      `The transcripts shown are from attempt 2. ${kept(findPage(run, "/a").slug)}`,
    ]);
  });

  it("says nothing of earlier attempts' folders for a page's only attempt", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        // A 404 answers before any pass begins, and trying again can't help: one attempt, no files.
        { path: "/missing", status: "failed", failedAttempts: [httpAttempt(1, 404)] },
        {
          path: "/read-some",
          status: "failed",
          files: ["read.txt"],
          failedAttempts: [
            failedAttempt({ n: 1, pass: "headings", step: 1, command: "nextHeading" }),
          ],
        },
      ],
    });
    const { problems } = problemsFor(run);

    expect(field(problems, "effect")).toEqual({
      "/missing 1": "No transcripts from this run: the page failed.",
      "/read-some 1": `No transcripts from this run: the page failed. The partial transcripts it left are in pages/${findPage(run, "/read-some").slug}/.`,
    });
  });

  it("says where the last attempt's partial transcripts are, and where the earlier ones' are kept", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/read-some",
          status: "failed",
          files: ["read.txt", "read.json"],
          failedAttempts: [
            failedAttempt({ n: 1, restarted: true }),
            failedAttempt({ n: 2, restarted: true }),
            failedAttempt({ n: 3 }),
          ],
        },
      ],
    });
    const { problems } = problemsFor(run);
    const slug = findPage(run, "/read-some").slug;

    // The last attempt's files stay in pages/<slug>/: nothing followed it to move them.
    expect(field(problems, "effect")).toEqual({
      "/read-some 1": `No transcripts from this run: the page failed. ${kept(slug)}`,
      "/read-some 2": `No transcripts from this run: the page failed. ${kept(slug)}`,
      "/read-some 3": `No transcripts from this run: the page failed. The partial transcripts it left are in pages/${slug}/.`,
    });
  });

  it("says when the page was skipped, or its transcripts come from a later run, or aren't shown", () => {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-20T09:30:00-05:00",
      pages: [
        { path: "/skipped", status: "skipped", failedAttempts: [failedAttempt({ n: 1 })] },
        { path: "/read-again", failedAttempts: [failedAttempt({ n: 1 })] },
        { path: "/removed", failedAttempts: [failedAttempt({ n: 1 })] },
        { path: "/" },
      ],
    });
    const latest = shareRun({
      id: "r2",
      createdAt: "2026-09-26T14:05:00-05:00",
      pages: [{ path: "/skipped" }, { path: "/read-again" }, { path: "/" }],
    });
    const { problems } = problemsFor(earlier, latest);
    const slug = (path: string) => findPage(earlier, path).slug;

    expect(field(problems, "effect")).toEqual({
      "/skipped 1": `No transcripts from this run: the page was skipped. ${kept(slug("/skipped"))}`,
      "/read-again 1": `The transcripts shown are from run r2, a later run that read the page in full. ${kept(slug("/read-again"))}`,
      "/removed 1": `The page is no longer on the list, so its transcripts aren't shown. ${kept(slug("/removed"))}`,
    });
  });

  describe("a problem written as text", () => {
    const pages = (): SharePageSpec[] => [
      {
        path: "/a",
        status: "failed",
        attempts: 2,
        files: ["read.txt"],
        errors: [
          `Attempt 1 failed (read pass: ${STEP_TIMEOUT}); retrying.`,
          `read pass: ${STEP_TIMEOUT}`,
        ],
      },
    ];
    const slug = findPage(shareRun({ id: "x", pages: pages() }), "/a").slug;
    const earlierAttempts = `Earlier attempts' partial transcripts, if any, are kept in attempts/${slug}/ in the run's folder.`;
    const left = `The partial transcripts it left are in pages/${slug}/.`;

    // Voicecap 0.3.0 was the first to keep an earlier attempt's folder (src/run/attempts.ts).
    it.each(["1.0.0", "0.10.0", "0.5.0", "0.4.1", "0.3.1", "0.3.0"])(
      "says where it left its transcripts, in a run from voicecap %s",
      (version) => {
        const { problems } = problemsFor(
          shareRun({ id: "r1", voicecapVersion: version, pages: pages() }),
        );

        // The retry was followed by another attempt, which moved its files. The last wasn't.
        expect(problems.map((problem) => problem.effect)).toEqual([
          `No transcripts from this run: the page failed. ${earlierAttempts}`,
          `No transcripts from this run: the page failed. ${left}`,
        ]);
      },
    );

    it("claims only what its record shows, in a run from before 0.3.0 or from an unknown version", () => {
      const from020 = problemsFor(shareRun({ id: "r1", voicecapVersion: "0.2.0", pages: pages() }));
      const unknown = problemsFor({ ...shareRun({ id: "r1", pages: pages() }), sessions: [] });

      for (const { problems } of [from020, unknown]) {
        expect(problems.map((problem) => problem.effect)).toEqual([
          "No transcripts from this run: the page failed.",
          `No transcripts from this run: the page failed. ${left}`,
        ]);
      }
    });

    it("says nothing of earlier attempts' folders for a page's only attempt", () => {
      const run = shareRun({
        id: "r1",
        voicecapVersion: "0.4.1",
        pages: [
          { path: "/gone", status: "failed", attempts: 1, errors: ["HTTP 404"] },
          {
            path: "/read-some",
            status: "failed",
            attempts: 1,
            files: ["read.txt"],
            errors: [`read pass: ${FOREGROUND}`],
          },
        ],
      });
      const { problems } = problemsFor(run);

      expect(field(problems, "effect")).toEqual({
        "/gone -": "No transcripts from this run: the page failed.",
        "/read-some -": `No transcripts from this run: the page failed. The partial transcripts it left are in pages/${findPage(run, "/read-some").slug}/.`,
      });
    });

    it("says where a failure a later attempt followed left its transcripts, for a page read in full", () => {
      const { problems } = problemsFor(
        shareRun({
          id: "r1",
          voicecapVersion: "0.5.0",
          pages: [
            {
              path: "/a",
              attempts: 2,
              errors: [`Attempt 1 failed (read pass: ${STEP_TIMEOUT}); retrying.`],
            },
          ],
        }),
      );

      expect(problems.map((problem) => problem.effect)).toEqual([
        `The transcripts shown are from attempt 2. ${earlierAttempts}`,
      ]);
    });
  });

  it("records an attempt's start and its failure, word for word, with a stack for an unexpected error", () => {
    const stack = "Error: boom\n    at step (file:///C:/voicecap/dist/passes/steps.js:10:5)";
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/a",
          failedAttempts: [
            failedAttempt({
              n: 2,
              startedAt: at(7, 0, 250),
              endedAt: at(7, 9, 800),
              cause: "step-timeout",
              message: STEP_TIMEOUT,
            }),
            failedAttempt({
              n: 3,
              startedAt: at(8, 0, 100),
              endedAt: at(8, 4, 900),
              cause: "unexpected",
              message: "boom",
              stack,
            }),
            // Only an unexpected error has a stack to show.
            failedAttempt({
              n: 4,
              startedAt: at(9),
              endedAt: at(9, 5),
              message: "lost it",
              stack: "Error: lost it\n    at somewhere",
            }),
          ],
        },
      ],
    });
    const { problems } = problemsFor(run);

    expect(problems.map((problem) => problem.record)).toEqual([
      [
        { time: at(7, 0, 250), source: "run.json", entry: "Attempt 2 started" },
        { time: at(7, 9, 800), source: "run.json", entry: `Failed: step-timeout: ${STEP_TIMEOUT}` },
      ],
      [
        { time: at(8, 0, 100), source: "run.json", entry: "Attempt 3 started" },
        { time: at(8, 4, 900), source: "run.json", entry: "Failed: unexpected: boom" },
        { time: at(8, 4, 900), source: "stack", entry: stack },
      ],
      [
        { time: at(9), source: "run.json", entry: "Attempt 4 started" },
        { time: at(9, 5), source: "run.json", entry: "Failed: foreground: lost it" },
      ],
    ]);
    expect(problems.map((problem) => [problem.startedAt, problem.endedAt, problem.stack])).toEqual([
      [at(7, 0, 250), at(7, 9, 800), null],
      [at(8, 0, 100), at(8, 4, 900), stack],
      [at(9), at(9, 5), null],
    ]);
    expect(problems.map((problem) => problem.message)).toEqual([STEP_TIMEOUT, "boom", "lost it"]);
  });

  it("records a problem written as text as the entry, word for word", () => {
    const entry = `Attempt 1 failed (read pass: ${FOREGROUND}); retrying.`;
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.5.0",
      pages: [{ path: "/a", attempts: 2, errors: [entry] }],
    });
    const { problems } = problemsFor(run);

    expect(problems.map((problem) => problem.record)).toEqual([
      [{ time: null, source: "run.json", entry }],
    ]);
    // What the problem says it was is the message inside the entry.
    expect(problems.map((problem) => problem.message)).toEqual([FOREGROUND]);
    expect(problems.map((problem) => problem.stack)).toEqual([null]);
  });

  it("replaces the home folder in what it shows", () => {
    const home = os.homedir();
    const message = `ENOENT: no such file or directory, open '${path.join(home, "voicecap-demo", "x.txt")}'`;
    const stack = `Error: ${message}\n    at open (${path.join(home, "code", "voicecap", "dist", "run.js")}:10:5)`;
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.5.0",
      pages: [
        {
          path: "/recorded",
          status: "failed",
          failedAttempts: [failedAttempt({ n: 1, cause: "unexpected", message, stack })],
        },
        { path: "/written", status: "failed", errors: [`read pass: ${message}`] },
      ],
    });
    const recorded = structuredClone(run);
    const { problems } = problemsFor(run);

    expect(problems).toHaveLength(2);
    const replacement = process.platform === "win32" ? "%USERPROFILE%" : "~";
    for (const problem of problems) {
      const shown = [
        problem.message,
        problem.stack ?? "",
        problem.happened,
        problem.did,
        problem.verdict,
        problem.effect,
        ...problem.record.map((row) => row.entry),
        ...problem.notRecorded,
      ];
      for (const text of shown) expect(text).not.toContain(home);
      expect(problem.message).toContain(replacement);
      expect(problem.record.at(-1)?.entry).toContain(replacement);
    }
    expect(problems.find((problem) => pathOf(problem) === "/recorded")?.stack).toContain(
      replacement,
    );
    // The records themselves are as they were.
    expect(run).toEqual(recorded);
    expect(findPage(run, "/recorded").failedAttempts?.[0]?.message).toBe(message);
  });

  it("says what an older run didn't record", () => {
    const pages = (): SharePageSpec[] => [
      { path: "/window", status: "failed", errors: [`read pass: ${FOREGROUND}`] },
      { path: "/slow", status: "failed", errors: [`read pass: ${STEP_TIMEOUT}`] },
    ];
    const older = problemsFor(shareRun({ id: "r1", voicecapVersion: "0.5.0", pages: pages() }));
    const run = shareRun({ id: "r1", pages: pages() });
    const noVersion = problemsFor({
      ...run,
      sessions: run.sessions.map((session) => ({ ...session, environment: null })),
    });
    const stepAndKey = (used: string) =>
      `The step and the key: not recorded: this run used ${used}.`;
    const program = (used: string) =>
      `Which program came to the front: not recorded: this run used ${used}.`;
    const events = (used: string) =>
      `The event log and NVDA's own log: not recorded: this run used ${used}.`;

    // An error written as text doesn't give its step or its key. The program in front is for a
    // foreground loss only; the event log and NVDA's own log, for every problem.
    expect(older.problems.map((problem) => problem.notRecorded)).toEqual([
      [stepAndKey("voicecap 0.5.0"), program("voicecap 0.5.0"), events("voicecap 0.5.0")],
      [stepAndKey("voicecap 0.5.0"), events("voicecap 0.5.0")],
    ]);
    expect(noVersion.problems.map((problem) => problem.notRecorded)).toEqual([
      [
        stepAndKey("an earlier version of voicecap"),
        program("an earlier version of voicecap"),
        events("an earlier version of voicecap"),
      ],
      [stepAndKey("an earlier version of voicecap"), events("an earlier version of voicecap")],
    ]);
  });

  it("says the step and the key weren't recorded only for an error from a pass's step", () => {
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.5.0",
      pages: [
        { path: "/step", status: "failed", errors: [`read pass: ${FOREGROUND}`] },
        {
          path: "/retried-step",
          attempts: 2,
          errors: [`Attempt 1 failed (headings pass: ${STEP_TIMEOUT}); retrying.`],
        },
        // A page that couldn't be opened, and an HTTP error, have no step to name.
        {
          path: "/opening",
          status: "failed",
          errors: [`Could not open the page for the read pass: ${FOREGROUND}`],
        },
        {
          path: "/retried-opening",
          attempts: 2,
          errors: [
            `Attempt 1 failed (Could not open the page for the tab pass: ${NOT_BROUGHT_FORWARD}); retrying.`,
          ],
        },
        { path: "/status", status: "failed", errors: ["HTTP 404"] },
        {
          path: "/retried-status",
          attempts: 2,
          errors: ["Attempt 1 failed (HTTP 503); retrying."],
        },
        // Nor does text that isn't a pass's error at all.
        { path: "/other", status: "failed", errors: ["Something went wrong"] },
      ],
    });
    const { problems } = problemsFor(run);
    const line = "The step and the key: not recorded: this run used voicecap 0.5.0.";

    expect(
      Object.fromEntries(
        problems.map((problem) => [pathOf(problem), problem.notRecorded.includes(line)]),
      ),
    ).toEqual({
      "/step": true,
      "/retried-step": true,
      "/opening": false,
      "/retried-opening": false,
      "/status": false,
      "/retried-status": false,
      "/other": false,
    });
  });

  it("doesn't say the step and the key weren't recorded when an attempt record has them", () => {
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.6.0",
      pages: [
        { path: "/a", failedAttempts: [failedAttempt({ n: 1 })] },
        { path: "/b", failedAttempts: [httpAttempt(1)] },
      ],
    });
    const { problems } = problemsFor(run);
    const events = "The event log and NVDA's own log: not recorded: this run used voicecap 0.6.0.";

    expect(problems.map((problem) => problem.notRecorded)).toEqual([
      ["Which program came to the front: not recorded: this run used voicecap 0.6.0.", events],
      [events],
    ]);
  });
});

describe("problemsOf: the verdict line", () => {
  /**
   * Runs in which each page fails once, with the cause given. Unless `readAfter` is false, a later
   * run read every page in full, so none of the problems happened again; without it, the one
   * attempt is all there is, and nothing says what would have come after it.
   */
  const failing = (causes: FailureCause[], { readAfter = true } = {}): RunJson[] => {
    const failed = shareRun({
      id: "failed",
      pages: causes.map((cause, index) => ({
        path: `/${index}-${cause}`,
        status: "failed" as const,
        failedAttempts: [
          failedAttempt({ n: 1, cause, startedAt: at(index), endedAt: at(index, 5) }),
        ],
      })),
    });
    const after = shareRun({
      id: "after",
      createdAt: "2026-09-27T09:30:00-05:00",
      pages: causes.map((cause, index) => ({ path: `/${index}-${cause}` })),
    });
    return readAfter ? [failed, after] : [failed];
  };

  /** A page that failed, one attempt for each cause given, and was never read in full here. */
  const failedAs = (path: string, causes: FailureCause[]): SharePageSpec => ({
    path,
    status: "failed",
    failedAttempts: causes.map((cause, index) =>
      failedAttempt({ n: index + 1, cause, restarted: true }),
    ),
  });
  /** A run with these pages, and a later run that read the paths given in full. */
  const runsWith = (pages: SharePageSpec[], readLater: string[] = []): RunJson[] => {
    const failing = shareRun({ id: "failing", pages });
    if (readLater.length === 0) return [failing];
    const later = shareRun({
      id: "later",
      createdAt: "2026-09-27T09:30:00-05:00",
      pages: readLater.map((path) => ({ path })),
    });
    return [failing, later];
  };
  /** The sentence of a verdict line that says what became of the problems. */
  const againOf = (line: string) => line.split(". ")[1];
  const NOT_VOICECAP = "the kind that could mean a problem in voicecap itself.";

  it("says no problems when every page was read in full", () => {
    const section = problemsFor(shareRun({ id: "r1", pages: [{ path: "/" }, { path: "/a" }] }));

    expect(section).toEqual({
      problems: [],
      line: "No problems during the runs: every page was read in full.",
      unexpected: 0,
    });
  });

  it("says no problems, but never that every page was read in full, when a read stopped short", () => {
    // A read that stopped at its step limit, or one the repeat safety net stopped, was transcribed,
    // but not read to the page's end.
    const stoppedAt = (...stops: ("step-cap" | "repeat-limit")[]) =>
      problemsFor(
        shareRun({
          id: "r1",
          pages: [
            { path: "/", passes: { read: ["One"] } },
            ...stops.map((stop, index) => ({
              path: `/long-${index + 1}`,
              passes: { read: ["One", "Two"] },
              stopped: { read: stop },
            })),
          ],
        }),
      ).line;

    expect(stoppedAt("step-cap")).toBe(
      "No problems during the runs: no attempt failed. 1 page was transcribed; its read stopped at the step limit.",
    );
    expect(stoppedAt("step-cap", "step-cap")).toBe(
      "No problems during the runs: no attempt failed. 2 pages were transcribed; their reads stopped at the step limit.",
    );
    expect(stoppedAt("repeat-limit")).toBe(
      "No problems during the runs: no attempt failed. 1 page was transcribed; its read stopped before the end of the page.",
    );
    expect(stoppedAt("step-cap", "repeat-limit", "repeat-limit")).toBe(
      "No problems during the runs: no attempt failed. 1 page was transcribed; its read stopped at the step limit. 2 pages were transcribed; their reads stopped before the end of the page.",
    );
  });

  it("says so when there were no problems, but pages weren't read", () => {
    const one = problemsFor(
      shareRun({ id: "r1", pages: [{ path: "/" }, { path: "/doc.pdf", status: "skipped" }] }),
    );
    const two = problemsFor(
      shareRun({
        id: "r1",
        pages: [
          { path: "/a", status: "skipped" },
          { path: "/b", status: "skipped" },
          { path: "/" },
        ],
      }),
    );

    expect(one.line).toBe(
      "No problems during the runs: no attempt failed. 1 page was skipped, not read.",
    );
    expect(two.line).toBe(
      "No problems during the runs: no attempt failed. 2 pages were skipped, not read.",
    );
  });

  it("says a page the latest run skipped, with an earlier run's transcripts, was skipped in the latest run", () => {
    // The pages were read in full in run r1, so skipping one in r2 doesn't leave it unread.
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [{ path: "/" }, { path: "/a" }, { path: "/b" }],
    });
    const skipping = (...skipped: string[]) =>
      shareRun({
        id: "r2",
        createdAt: "2026-09-26T10:00:00-05:00",
        pages: ["/", "/a", "/b"].map((path) => ({
          path,
          ...(skipped.includes(path) ? { status: "skipped" as const } : {}),
        })),
      });

    expect(problemsFor(earlier, skipping("/a")).line).toBe(
      "No problems during the runs: no attempt failed. 1 page was skipped in the latest run.",
    );
    expect(problemsFor(earlier, skipping("/a", "/b")).line).toBe(
      "No problems during the runs: no attempt failed. 2 pages were skipped in the latest run.",
    );
  });

  it("says both when the latest run skipped pages an earlier run read, and pages no run read", () => {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [{ path: "/" }, { path: "/read-before" }, { path: "/never", status: "skipped" }],
    });
    const latest = shareRun({
      id: "r2",
      createdAt: "2026-09-26T10:00:00-05:00",
      pages: [
        { path: "/" },
        { path: "/read-before", status: "skipped" },
        { path: "/never", status: "skipped" },
      ],
    });

    expect(problemsFor(earlier, latest).line).toBe(
      "No problems during the runs: no attempt failed. 1 page was skipped, not read. 1 page was skipped in the latest run.",
    );
  });

  it("has no problems to report when no run counts", () => {
    const section = problemsFor(shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] }));

    expect(section).toEqual({
      problems: [],
      line: "No problems to report: no live run counts yet.",
      unexpected: 0,
    });
  });

  it("writes the verdict line of the demo runs of 29 September", () => {
    const section = problemsFor(demoRun("1315"), demoRun("1402"));

    expect(section.line).toBe(
      "2 problems, both outside voicecap: another window took the screen. 1 didn't happen again, and 1 wasn't tried again. Neither was an unexpected error, the kind that could mean a problem in voicecap itself.",
    );
    expect(section.unexpected).toBe(0);
    expect(section.problems).toHaveLength(2);

    const [first, second] = section.problems;
    expect(first).toMatchObject({
      run: "2026-09-29_1315",
      page: { slug: "the-report-03940c2f88", url: "http://127.0.0.1:4848/the-report/" },
      n: null,
      startedAt: null,
      endedAt: null,
      kind: "foreground",
      fromWording: true,
      pass: "read",
      step: null,
      command: null,
      message: FOREGROUND,
      stack: null,
      happened: "During the read pass, another window took the screen.",
      did: "Recorded the page as failed",
      verdict: "No: read in full in run 2026-09-29_1402.",
      again: "no",
      effect:
        "No transcripts from this run: the page failed. The partial transcripts it left are in pages/the-report-03940c2f88/.",
      record: [{ time: null, source: "run.json", entry: `read pass: ${FOREGROUND}` }],
      notRecorded: [
        "The step and the key: not recorded: this run used voicecap 0.4.1.",
        "Which program came to the front: not recorded: this run used voicecap 0.4.1.",
        "The event log and NVDA's own log: not recorded: this run used voicecap 0.4.1.",
      ],
    });
    expect(second).toMatchObject({
      run: "2026-09-29_1402",
      page: { slug: "how-a-run-works-fd116f9328" },
      kind: "foreground",
      pass: "headings",
      happened: "During the headings pass, another window took the screen.",
      verdict:
        "Not known: this run didn't try the page again; run 2026-09-29_1315, before it, read it in full.",
      again: "unknown",
      effect:
        "No transcripts from this run: the page failed. The partial transcripts it left are in pages/how-a-run-works-fd116f9328/.",
      record: [{ time: null, source: "run.json", entry: `headings pass: ${FOREGROUND}` }],
    });
  });

  it("leaves out the failures of runs that didn't finish", () => {
    const standing = standingOf([
      demoRun("1315"),
      demoRun("1402"),
      demoRun("1415"),
      demoRun("1419"),
    ]);
    const section = problemsOf(standing, options);

    expect(standing.leftOut.map((left) => left.run.id)).toEqual([
      "2026-09-29_1415",
      "2026-09-29_1419",
    ]);
    expect(section.problems.map((problem) => problem.run)).toEqual([
      "2026-09-29_1315",
      "2026-09-29_1402",
    ]);
  });

  it("says whose a single problem is, and that it didn't happen again", () => {
    const { line } = problemsFor(...failing(["foreground"]));

    expect(line).toBe(
      `1 problem, outside voicecap: another window took the screen. It didn't happen again. It wasn't an unexpected error, ${NOT_VOICECAP}`,
    );
  });

  it("says when a problem wasn't tried again, which isn't that it didn't happen again", () => {
    const one = problemsFor(...failing(["foreground"], { readAfter: false }));
    const two = problemsFor(...failing(["foreground", "locked"], { readAfter: false }));
    const three = problemsFor(
      ...failing(["foreground", "locked", "foreground"], { readAfter: false }),
    );

    expect(one.line).toBe(
      `1 problem, outside voicecap: another window took the screen. It wasn't tried again. It wasn't an unexpected error, ${NOT_VOICECAP}`,
    );
    expect(two.line).toBe(
      `2 problems, both outside voicecap: another window took the screen (1), and the computer locked (1). Neither was tried again. Neither was an unexpected error, ${NOT_VOICECAP}`,
    );
    expect(three.line).toBe(
      `3 problems, all outside voicecap: another window took the screen (2), and the computer locked (1). None was tried again. None was an unexpected error, ${NOT_VOICECAP}`,
    );
  });

  // A page that failed more than once, and never got through, has every problem happened again.
  // A page that got through after a failure has that failure happened again, and the one before the
  // read didn't. A page tried once is "didn't" if a later run read the page in full, and "wasn't
  // tried again" if not.
  it.each<[string, () => RunJson[], string]>([
    [
      "both of two attempts that failed",
      () => runsWith([failedAs("/a", ["foreground", "foreground"])]),
      "Both happened again",
    ],
    [
      "every one of three attempts that failed",
      () => runsWith([failedAs("/a", ["foreground", "foreground", "foreground"])]),
      "All happened again",
    ],
    [
      "both of two attempts that failed in different ways",
      () => runsWith([failedAs("/a", ["foreground", "step-timeout"])]),
      "Both happened again",
    ],
    [
      "one that happened again, and one that didn't, on a page that got through",
      () =>
        runsWith([
          {
            path: "/a",
            failedAttempts: [
              failedAttempt({ n: 1, restarted: true }),
              failedAttempt({ n: 2, restarted: true }),
            ],
          },
        ]),
      "1 happened again, and 1 didn't happen again",
    ],
    [
      "problems that happened again, and one that didn't",
      () =>
        runsWith(
          [failedAs("/a", ["foreground", "foreground"]), failedAs("/b", ["foreground"])],
          ["/b"],
        ),
      "2 happened again, and 1 didn't happen again",
    ],
    [
      "problems that happened again, and one that wasn't tried again",
      () =>
        runsWith([failedAs("/a", ["foreground", "foreground"]), failedAs("/b", ["foreground"])]),
      "2 happened again, and 1 wasn't tried again",
    ],
    [
      "one that didn't happen again, and one that wasn't tried again",
      () => runsWith([failedAs("/a", ["foreground"]), failedAs("/b", ["foreground"])], ["/a"]),
      "1 didn't happen again, and 1 wasn't tried again",
    ],
    [
      "one that didn't happen again, and two that weren't tried again",
      () =>
        runsWith(
          [
            failedAs("/a", ["foreground"]),
            failedAs("/b", ["foreground"]),
            failedAs("/c", ["locked"]),
          ],
          ["/a"],
        ),
      "1 didn't happen again, and 2 weren't tried again",
    ],
    [
      "every answer",
      () =>
        runsWith(
          [
            failedAs("/a", ["foreground", "foreground"]),
            failedAs("/b", ["foreground"]),
            failedAs("/c", ["foreground"]),
          ],
          ["/b"],
        ),
      "2 happened again, 1 didn't happen again, and 1 wasn't tried again",
    ],
  ])("counts what became of each problem when the answers differ: %s", (_name, runs, again) => {
    const { line } = problemsFor(...runs());

    expect(againOf(line)).toBe(again);
  });

  it("gives each problem the answer that belongs to what followed it, or to its page", () => {
    const { problems } = problemsFor(
      ...runsWith(
        [
          failedAs("/a", ["foreground", "foreground"]),
          failedAs("/b", ["foreground", "step-timeout"]),
          failedAs("/c", ["foreground"]),
          failedAs("/d", ["foreground"]),
        ],
        ["/c"],
      ),
    );

    expect(problems.map((problem) => [pathOf(problem), problem.n, problem.again])).toEqual([
      ["/a", 1, "same"],
      ["/a", 2, "same"],
      ["/b", 1, "different"],
      ["/b", 2, "different"],
      ["/c", 1, "no"],
      ["/d", 1, "unknown"],
    ]);
  });

  it("says outside voicecap only when every kind is another window or the lock", () => {
    const both = problemsFor(...failing(["foreground", "locked"])).line;
    const three = problemsFor(...failing(["foreground", "locked", "foreground"])).line;
    const mixed = problemsFor(...failing(["foreground", "browser"])).line;
    const one = problemsFor(...failing(["screen-reader-stopped"])).line;

    expect(both).toBe(
      `2 problems, both outside voicecap: another window took the screen (1), and the computer locked (1). Neither happened again. Neither was an unexpected error, ${NOT_VOICECAP}`,
    );
    expect(three).toBe(
      `3 problems, all outside voicecap: another window took the screen (2), and the computer locked (1). None happened again. None was an unexpected error, ${NOT_VOICECAP}`,
    );
    expect(mixed).toBe(
      `2 problems: another window took the screen (1), and the browser stopped or didn't start (1). Neither happened again. Neither was an unexpected error, ${NOT_VOICECAP}`,
    );
    expect(one).toBe(
      `1 problem: NVDA stopped running. It didn't happen again. It wasn't an unexpected error, ${NOT_VOICECAP}`,
    );
  });

  it("counts each kind when there are several", () => {
    const { line } = problemsFor(...failing(["foreground", "step-timeout", "foreground"]));

    expect(line).toBe(
      `3 problems: another window took the screen (2), and a step took too long (1). None happened again. None was an unexpected error, ${NOT_VOICECAP}`,
    );
  });

  it("lists the kinds most numerous first, then in the order of the table of kinds", () => {
    const { line } = problemsFor(
      ...failing([
        "unexpected",
        "http",
        "page-timeout",
        "unreachable",
        "http",
        "locked",
        "browser",
      ]),
    );

    expect(line.split(". ")[0]).toBe(
      "7 problems: the website answered with an error (2), the computer locked (1), the browser stopped or didn't start (1), the website couldn't be reached (1), a step took too long (1), and an unexpected error (1)",
    );
  });

  it("counts a problem that happened again, whether the same way or in a different one", () => {
    const { line } = problemsFor(
      ...runsWith([
        failedAs("/same", ["foreground", "foreground"]),
        failedAs("/different", ["foreground", "step-timeout"]),
      ]),
    );

    expect(line).toBe(
      `4 problems: another window took the screen (3), and a step took too long (1). All happened again. None was an unexpected error, ${NOT_VOICECAP}`,
    );
  });

  it("points to an unexpected error, which could mean a problem in voicecap itself", () => {
    const one = problemsFor(...failing(["foreground", "unexpected"]));
    const two = problemsFor(...failing(["unexpected", "foreground", "unexpected"]));

    expect(one.line).toBe(
      "2 problems: another window took the screen (1), and an unexpected error (1). Neither happened again. 1 was an unexpected error, the kind that could mean a problem in voicecap itself: see its record.",
    );
    expect(one.unexpected).toBe(1);
    expect(two.line).toBe(
      "3 problems: an unexpected error (2), and another window took the screen (1). None happened again. 2 were unexpected errors, the kind that could mean a problem in voicecap itself: see their records.",
    );
    expect(two.unexpected).toBe(2);
  });
});

describe("problemsOf", () => {
  it("doesn't change the records it reads", () => {
    const runs = [demoRun("1315"), demoRun("1402")];
    const recorded = structuredClone(runs);

    problemsFor(...runs);

    expect(runs).toEqual(recorded);
  });
});

describe("problemsOf: the program that took the screen", () => {
  /** The problems of a run of one page, which failed with the attempt given. */
  const problemsWith = (attempt: AttemptRecord, voicecapVersion = "0.11.0") =>
    problemsFor(
      shareRun({
        id: "r1",
        voicecapVersion,
        pages: [{ path: "/a", status: "failed", failedAttempts: [attempt] }],
      }),
    ).problems;
  const notRecorded = (version: string) =>
    `Which program came to the front: not recorded: this run used voicecap ${version}.`;

  it("names the program a run from 0.11.0 recorded, and says nothing of it as not recorded", () => {
    const [problem] = problemsWith(failedAttempt({ n: 1, program: "Microsoft Teams" }));

    expect(problem?.program).toBe("Microsoft Teams");
    expect(problem?.notRecorded).not.toContain(notRecorded("0.11.0"));
    expect(problem?.notRecorded.join(" ")).not.toContain("Which program");
  });

  it("keeps that Windows didn't say which program it was", () => {
    const [problem] = problemsWith(failedAttempt({ n: 1, program: null }));

    expect(problem).toHaveProperty("program", null);
    expect(problem?.notRecorded.join(" ")).not.toContain("Which program");
  });

  it("still says an older run didn't record the program", () => {
    const [problem] = problemsWith(failedAttempt({ n: 1 }), "0.10.0");

    expect(problem).not.toHaveProperty("program");
    expect(problem?.notRecorded).toContain(notRecorded("0.10.0"));
  });

  it("says a run of 0.11.0 whose driver didn't look didn't record the program, without blaming its voicecap", () => {
    const [problem] = problemsWith(failedAttempt({ n: 1 }), "0.11.0");

    expect(problem).not.toHaveProperty("program");
    expect(problem?.notRecorded).toContain(
      "Which program came to the front: not recorded: this run's screen reader driver doesn't record it.",
    );
    expect(problem?.notRecorded).not.toContain(notRecorded("0.11.0"));
  });

  it("names no program for a problem of another kind", () => {
    const [problem] = problemsWith(
      failedAttempt({ n: 1, cause: "step-timeout", message: STEP_TIMEOUT, program: "Teams" }),
    );

    expect(problem).not.toHaveProperty("program");
  });

  it("shows the home folder in a program's name as it does everywhere", () => {
    const program = path.join(os.homedir(), "AppData", "Local", "Tool", "tool.exe");
    const [problem] = problemsWith(failedAttempt({ n: 1, program }));

    expect(problem?.program).not.toContain(os.homedir());
    expect(problem?.program).toContain(process.platform === "win32" ? "%USERPROFILE%" : "~");
  });
});

describe("problemsOf: the record's lines from the event log", () => {
  /** A problem's record as rows of its time of day, where it's from, and what it says. */
  const rowsOf = (problem: Problem | undefined) =>
    (problem?.record ?? [])
      .filter((row) => row.source !== "stack")
      .map((row) => `${row.time?.slice(11, 23) ?? "-"} | ${row.source} | ${row.entry}`);

  it("adds the event log's lines from the attempt's start until the next attempt's start, by time", () => {
    const model = loggedModel();
    const [problem] = model.problems.problems;

    expect(rowsOf(problem)).toEqual([
      "14:03:56.000 | run.json | Attempt 1 started",
      "14:03:56.000 | events.jsonl | Page 2 started: Apply",
      "14:04:41.250 | events.jsonl | Another window came to the front: Microsoft Teams",
      `14:04:41.300 | run.json | Failed: foreground: ${FOREGROUND}`,
      "14:04:41.300 | events.jsonl | Page 2 failed: another window took the screen",
      "14:04:41.350 | events.jsonl | voicecap restarted NVDA: to try Apply again (attempt 2 of 5)",
      "14:04:43.900 | events.jsonl | voicecap's NVDA stopped: process 65720, to restart",
      "14:04:44.100 | events.jsonl | The browser closed: process 7002",
      "14:04:44.150 | events.jsonl | voicecap released the NVDA lock",
      "14:04:44.160 | events.jsonl | voicecap took the NVDA lock",
      "14:04:45.729 | events.jsonl | voicecap's NVDA started: process 54568",
      "14:04:47.000 | events.jsonl | The browser started: process 7003",
    ]);
  });

  it("adds them until 10 seconds after the attempt ended, when no attempt followed it", () => {
    const page = `${SITE}a`;
    const on = (time: string, event: NewRunEvent) => logged("2026-09-26", time, event);
    const failed = shareRun({
      id: "r1",
      voicecapVersion: "0.11.0",
      pages: [
        {
          path: "/a",
          status: "failed",
          failedAttempts: [
            failedAttempt({ n: 1, startedAt: at(5, 0), endedAt: at(5, 10), program: null }),
          ],
        },
      ],
    });
    const events = [
      on("14:04:00.000", { type: "run-started", session: 1, resumed: false }),
      on("14:05:00.000", { type: "page-started", page, attempt: 1 }),
      on("14:05:09.000", { type: "foreground-lost", program: null, title: PRIVATE_TITLE }),
      on("14:05:10.000", {
        type: "page-failed",
        page,
        attempt: 1,
        cause: "foreground",
        message: FOREGROUND,
      }),
      on("14:05:19.999", { type: "screen-reader-stopped", pid: 1, restarting: false }),
      on("14:05:20.000", { type: "screen-reader-lock-released" }),
      on("14:05:20.001", { type: "run-ended", session: 1, reason: "completed" }),
    ];
    const model = buildShareModel(
      inputOf([failed], { events: new Map([[failed.id, { events, unreadable: 0 }]]) }),
    );

    expect(
      rowsOf(model.problems.problems[0]).filter((row) => row.includes("events.jsonl")),
    ).toEqual([
      "14:05:00.000 | events.jsonl | Page 1 started: https://example.illinois.gov/a",
      "14:05:09.000 | events.jsonl | Another window came to the front",
      "14:05:10.000 | events.jsonl | Page 1 failed: another window took the screen",
      "14:05:19.999 | events.jsonl | voicecap's NVDA stopped: process 1",
      "14:05:20.000 | events.jsonl | voicecap released the NVDA lock",
    ]);
  });

  it("starts at the attempt's own start: the last before its end, when a resumed session took its number again", () => {
    const page = `${SITE}a`;
    const on = (day: string, time: string, event: NewRunEvent) => logged(day, time, event);
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.11.0",
      sessions: [
        { startedAt: "2026-09-26T14:00:00-05:00", endReason: "interrupted" },
        { startedAt: "2026-09-27T09:00:00-05:00" },
      ],
      pages: [
        {
          path: "/a",
          status: "failed",
          session: 2,
          failedAttempts: [
            failedAttempt({
              n: 1,
              startedAt: "2026-09-27T09:00:10.000-05:00",
              endedAt: "2026-09-27T09:00:20.000-05:00",
            }),
          ],
        },
      ],
    });
    const events = [
      on("2026-09-26", "14:00:00.000", { type: "run-started", session: 1, resumed: false }),
      // Ctrl+C stopped this attempt, so the page's record didn't count it.
      on("2026-09-26", "14:00:10.000", { type: "page-started", page, attempt: 1 }),
      on("2026-09-26", "14:00:12.000", { type: "run-ended", session: 1, reason: "interrupted" }),
      on("2026-09-27", "09:00:00.000", { type: "run-started", session: 2, resumed: true }),
      on("2026-09-27", "09:00:10.000", { type: "page-started", page, attempt: 1 }),
      on("2026-09-27", "09:00:20.000", {
        type: "page-failed",
        page,
        attempt: 1,
        cause: "foreground",
        message: FOREGROUND,
      }),
    ];
    const model = buildShareModel(
      inputOf([run], { events: new Map([[run.id, { events, unreadable: 0 }]]) }),
    );
    const record = model.problems.problems[0]?.record ?? [];

    expect(record.filter((row) => row.source === "events.jsonl").map((row) => row.time)).toEqual([
      "2026-09-27T09:00:10.000-05:00",
      "2026-09-27T09:00:20.000-05:00",
    ]);
  });

  it("says which voicecap kept no log, for each attempt of a run begun before voicecap kept one and resumed after", () => {
    const page = `${SITE}a`;
    const version = (used: string) => ({
      voicecap: { version: used, configSha256: "c".repeat(64) },
    });
    const run = shareRun({
      id: "r1",
      sessions: [
        {
          startedAt: "2026-09-26T14:00:00-05:00",
          endReason: "interrupted",
          environment: version("0.10.0"),
        },
        { startedAt: "2026-09-27T09:00:00-05:00", environment: version("0.11.0") },
      ],
      pages: [
        {
          path: "/a",
          attempts: 3,
          session: 2,
          failedAttempts: [
            failedAttempt({ n: 1, startedAt: at(0, 10), endedAt: at(0, 20) }),
            failedAttempt({
              n: 2,
              startedAt: "2026-09-27T09:00:10.000-05:00",
              endedAt: "2026-09-27T09:00:20.000-05:00",
              program: "Outlook",
              restarted: true,
            }),
          ],
        },
      ],
    });
    // Only the session that resumed it, the next day with 0.11.0, is in the log.
    const events = [
      logged("2026-09-27", "09:00:00.000", { type: "run-started", session: 2, resumed: true }),
      logged("2026-09-27", "09:00:10.000", { type: "page-started", page, attempt: 2 }),
      logged("2026-09-27", "09:00:20.000", {
        type: "page-failed",
        page,
        attempt: 2,
        cause: "foreground",
        message: FOREGROUND,
      }),
      logged("2026-09-27", "09:00:30.000", { type: "page-started", page, attempt: 3 }),
      logged("2026-09-27", "09:01:00.000", {
        type: "page-finished",
        page,
        attempt: 3,
        status: "done",
      }),
    ];
    const model = buildShareModel(
      inputOf([run], { events: new Map([[run.id, { events, unreadable: 0 }]]) }),
    );
    const [first, second] = model.problems.problems;

    // The first attempt's session used 0.10.0, which kept no log, and its record says so.
    expect(first?.record.map((row) => row.source)).toEqual(["run.json", "run.json"]);
    expect(first?.notRecorded).toEqual([
      "Which program came to the front: not recorded: this run used voicecap 0.10.0.",
      "The event log and NVDA's own log: not recorded: this run used voicecap 0.10.0.",
    ]);
    // The second's used 0.11.0: the log's lines are in its record, and only NVDA's own log isn't.
    expect(second?.record.map((row) => row.source)).toContain("events.jsonl");
    expect(second?.notRecorded).toEqual([
      "NVDA's own log: not recorded: this run used voicecap 0.11.0.",
    ]);
  });

  it("says the log has no line of an attempt of a voicecap that keeps it, never that its voicecap didn't keep one", () => {
    const page = `${SITE}a`;
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.11.0",
      sessions: [
        { startedAt: "2026-09-26T14:00:00-05:00", endReason: "interrupted" },
        { startedAt: "2026-09-27T09:00:00-05:00" },
      ],
      pages: [
        {
          path: "/a",
          attempts: 2,
          session: 2,
          failedAttempts: [failedAttempt({ n: 1, startedAt: at(0, 10), endedAt: at(0, 20) })],
        },
      ],
    });
    // The first session's lines aren't in the log, as when it couldn't write them.
    const events = [
      logged("2026-09-27", "09:00:00.000", { type: "run-started", session: 2, resumed: true }),
      logged("2026-09-27", "09:00:10.000", { type: "page-started", page, attempt: 2 }),
      logged("2026-09-27", "09:01:00.000", {
        type: "page-finished",
        page,
        attempt: 2,
        status: "done",
      }),
    ];
    const model = buildShareModel(
      inputOf([run], { events: new Map([[run.id, { events, unreadable: 0 }]]) }),
    );
    const [problem] = model.problems.problems;

    expect(problem?.record.map((row) => row.source)).toEqual(["run.json", "run.json"]);
    expect(problem?.notRecorded).toEqual([
      "Which program came to the front: not recorded: this run's screen reader driver doesn't record it.",
      "The event log: not recorded: it has no line of this attempt.",
      "NVDA's own log: not recorded: this run used voicecap 0.11.0.",
    ]);
  });

  it("shows the home folder in an event's words as it does everywhere", () => {
    const program = path.join(os.homedir(), "AppData", "Local", "Tool", "tool.exe");
    const { run, log } = loggedRun();
    const events = log.events.map((event) =>
      event.type === "foreground-lost" ? { ...event, program } : event,
    );
    const model = buildShareModel(
      inputOf([run], { events: new Map([[run.id, { events, unreadable: 0 }]]) }),
    );
    const entries = (model.problems.problems[0]?.record ?? []).map((row) => row.entry);
    const replaced = process.platform === "win32" ? "%USERPROFILE%" : "~";

    expect(entries.join("\n")).not.toContain(os.homedir());
    expect(entries).toContainEqual(
      expect.stringMatching(
        new RegExp(`^Another window came to the front: ${escapeRegExp(replaced)}`),
      ),
    );
  });

  it("says NVDA's own log isn't recorded, and no longer the event log, for a run whose log it read", () => {
    const [problem] = loggedModel().problems.problems;

    expect(problem?.notRecorded).toEqual([
      "NVDA's own log: not recorded: this run used voicecap 0.11.0.",
    ]);
  });

  describe("where the page doesn't have the log of a run of a voicecap that keeps one", () => {
    /** The logged run of 0.11.0, the log the page has of it (none, by default), and what each says. */
    function saidOf(
      run: RunJson,
      log?: { events: RunEvent[]; unreadable: number },
    ): { problem: string[]; timeline: unknown; restarts: string | undefined } {
      const model = buildShareModel(
        inputOf([run], { events: log === undefined ? new Map() : new Map([[run.id, log]]) }),
      );
      const [evidence] = model.evidence;
      return {
        problem: model.problems.problems[0]?.notRecorded ?? [],
        timeline: evidence?.timeline,
        restarts: evidence?.facts.find(({ label }) => label === "NVDA restarts")?.value,
      };
    }
    const NVDA_LOG = "NVDA's own log: not recorded: this run used voicecap 0.11.0.";

    it("says, as the evidence does, that the log its record lists isn't as the run recorded it", () => {
      const { run } = loggedRun();
      const listed = { ...run, files: { "events.jsonl": { sha256: "e".repeat(64), bytes: 10 } } };
      const part =
        "Not shown: the event log isn't as the run recorded it; voicecap verify names it.";

      expect(saidOf(listed)).toEqual({
        problem: [
          "The event log: not shown: it isn't as the run recorded it; voicecap verify names it.",
          NVDA_LOG,
        ],
        timeline: { notRecorded: part },
        restarts: part,
      });
    });

    it("says, as the evidence does, that its record lists none", () => {
      const { run } = loggedRun();

      expect(saidOf(run)).toEqual({
        problem: ["The event log: not recorded: this run's record lists none.", NVDA_LOG],
        timeline: { notRecorded: "Not recorded: this run's record lists no event log." },
        restarts: "Not recorded: this run's record lists no event log.",
      });
    });

    it("says, as the evidence does, that no line of it could be read", () => {
      const { run } = loggedRun();

      expect(saidOf(run, { events: [], unreadable: 3 })).toEqual({
        problem: ["The event log: not shown: no line of it could be read.", NVDA_LOG],
        timeline: { notRecorded: "Not shown: no line of the event log could be read." },
        restarts: "Not shown: no line of the event log could be read.",
      });
    });

    it("never says the run's voicecap didn't record the event log", () => {
      const { run } = loggedRun();
      const listed = { ...run, files: { "events.jsonl": { sha256: "e".repeat(64), bytes: 10 } } };
      const said = [saidOf(listed), saidOf(run), saidOf(run, { events: [], unreadable: 1 })]
        .flatMap(({ problem }) => problem)
        .filter((line) => line !== NVDA_LOG);

      // One line of the event log for each of the three.
      expect(said.length).toBe(3);
      expect(said.filter((line) => /this run used voicecap/.test(line))).toEqual([]);
    });
  });
});

/** Text as a regular expression that matches it as it is. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("KIND_ROWS", () => {
  it("has a row for each kind, and one for a run the person stopped", () => {
    expect(KIND_ROWS.map((row) => row.kind)).toEqual([
      "foreground",
      "locked",
      "screen-reader-stopped",
      "browser",
      "http",
      "unreachable",
      "timeout",
      "unexpected",
      "stopped",
    ]);
  });

  it("is the spec's table of kinds of problem, word for word", () => {
    const spec = readFileSync(
      new URL("../docs/superpowers/specs/2026-09-30-shareable-report-design.md", import.meta.url),
      "utf8",
    );
    const table = spec.split("**Kinds of problem.**")[1]?.split("**How the kind is decided:**")[0];
    const rows = (table ?? "")
      .split("\n")
      .filter((line) => line.startsWith("| ") && !line.startsWith("| Kind |"))
      .map((line) => line.slice(2, -2).split(" | "));

    expect(rows).toHaveLength(9);
    expect(KIND_ROWS.map((row) => [row.title, row.whose, row.meaning])).toEqual(rows);
  });
});
