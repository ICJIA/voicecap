import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { DEMO_PAGES, startDemoServer, type DemoServer } from "../src/demo/server.js";
import { runTour, type TourDeps } from "../src/demo/tour.js";
import type { Prompter } from "../src/init/prompt.js";
import type { FlagResult } from "../src/model.js";
import { InterruptedError } from "../src/passes/steps.js";
import type { Check, CheckRunner, PlatformReadiness, Problem } from "../src/readiness/model.js";
import { runAudit, type RunAuditOptions, type RunAuditResult } from "../src/run/audit.js";
import { runDir, siteFolder } from "../src/run/paths.js";
import { readRunJson } from "../src/run/store.js";
import { EnvironmentError } from "../src/util/errors.js";
import { fakeSignals } from "./helpers/fake-signals.js";
import { writeSyntheticRun, type SyntheticPage } from "./helpers/report-data.js";
import { scriptedScreen } from "./helpers/screen.js";
import { element, ScriptedDriver, type ScriptedPage } from "./helpers/scripted-driver.js";

const ORIGIN = "http://127.0.0.1:4848";
const RUN_ID = "2026-09-29_1405";

// ---- The computers ----

function runner(check: Check): CheckRunner {
  return { id: check.id, run: () => Promise.resolve(check) };
}

/** A ready Windows PC: NVDA, every check OK, and a live test that passes. */
function windows(overrides: Partial<PlatformReadiness> = {}): PlatformReadiness {
  return {
    screenReader: "NVDA",
    cannotRunYet: null,
    readyTip: null,
    liveTestNotice: [
      "The live test takes about 20 seconds. NVDA speaks and takes over the keyboard, so keep your hands off.",
    ],
    checkingNotice: [],
    machineInfo: () =>
      Promise.resolve({
        lines: [{ label: "System", value: "Windows 11 Pro 24H2, x64" }],
        screenReader: "NVDA 2026.2",
        system: "Windows 11 Pro 24H2",
      }),
    quickChecks: () => [runner({ id: "nvda", status: "OK", summary: "NVDA 2026.2 is installed" })],
    liveTest: () =>
      Promise.resolve([{ id: "liveSpeech", status: "OK", summary: 'NVDA speaks: "Check page"' }]),
    ...overrides,
  };
}

/** A ready Mac before the VoiceOver driver: set up for VoiceOver, but voicecap can't run it yet. */
function mac(overrides: Partial<PlatformReadiness> = {}): PlatformReadiness {
  return windows({
    screenReader: "VoiceOver",
    cannotRunYet:
      "voicecap can't run VoiceOver yet: that comes with its VoiceOver driver. For now, run this command on a Windows computer.",
    readyTip: "Tip: turn on Do Not Disturb, so notifications don't interrupt VoiceOver.",
    liveTestNotice: [
      "The live test takes about 20 seconds. VoiceOver speaks and takes over the keyboard, so keep your hands off.",
    ],
    checkingNotice: [
      'Checking this Mac. If macOS asks for access to control "System Events", click Allow.',
    ],
    machineInfo: () =>
      Promise.resolve({
        lines: [{ label: "System", value: "macOS 26.6.2 (25G83), Apple silicon" }],
        screenReader: "VoiceOver 10",
        system: "macOS 26.6.2",
      }),
    quickChecks: () => [
      runner({
        id: "appleScript",
        status: "OK",
        summary: "VoiceOver can be controlled by AppleScript",
      }),
    ],
    liveTest: () =>
      Promise.resolve([
        { id: "liveHear", status: "OK", summary: 'VoiceOver hears the page ("Check page")' },
      ]),
    ...overrides,
  });
}

/** Linux: no screen reader, and a preflight that always FAILs, as otherReadiness's does. */
function linux(): PlatformReadiness {
  return {
    screenReader: null,
    cannotRunYet: "voicecap drives NVDA on Windows and VoiceOver on macOS.",
    readyTip: null,
    liveTestNotice: [],
    checkingNotice: [],
    liveTest: null,
    machineInfo: () =>
      Promise.resolve({ lines: [], screenReader: null, system: "Linux 6.8.0-45-generic" }),
    quickChecks: () => [
      runner({
        id: "platform",
        status: "FAIL",
        summary: "This is Linux: voicecap drives NVDA on Windows and VoiceOver on macOS",
        problem: {
          title: "No screen reader to drive here",
          whatsWrong:
            "voicecap drives NVDA on Windows and VoiceOver on macOS, and neither runs here.",
          fix: [
            "Use replay runs here: add --replay-from <run folder> to the command.",
            "Run real audits on a Windows computer or a Mac.",
          ],
          setupHelps: false,
        },
      }),
    ],
  };
}

const NVDA_MISSING: Problem = {
  title: "NVDA for voicecap",
  whatsWrong: "voicecap uses Guidepup's own copy of NVDA, and it isn't installed yet.",
  fix: ["Run npx @icjia/voicecap setup."],
  setupHelps: true,
};

// ---- The run ----

function flag(rule: string, pass: FlagResult["pass"]): FlagResult {
  return { rule, pass, message: `${rule} in the ${pass} pass.` };
}

/**
 * The demo's home page as NVDA reads it in browse mode, top to bottom: what the scripted driver
 * says for it in a real run (HOME_READ is its read.txt).
 */
const HOME_LINES = [
  "same page, link, Skip to main content",
  "banner landmark, voicecap demo",
  "Tour, navigation landmark, list, with 1 item, link, Next: Before you start",
  "main landmark, heading, level 1, Welcome to the voicecap demo",
  "This small site shows how voicecap works, one page at a time.",
  "content info landmark, This demo site comes with voicecap, and runs only on this computer.",
];

/** What NVDA said on the demo's home page, as read.txt has it after its header. */
const HOME_READ = [
  "[to bottom] content info landmark, This demo site comes with voicecap, and runs only on this computer.",
  "[to top] same page, link, Skip to main content",
  "banner landmark, voicecap demo",
  "Tour, navigation landmark, list, with 1 item, link, Next: Before you start",
  "main landmark, heading, level 1, Welcome to the voicecap demo",
  "This small site shows how voicecap works, one page at a time.",
];

/** The demo's seven pages, as a run on Windows ends: flags on /common-mistakes/ only. */
function demoPages(changes: Record<string, Partial<SyntheticPage>> = {}): SyntheticPage[] {
  const pages: SyntheticPage[] = [
    { path: "/", lines: { read: HOME_READ } },
    { path: "/before-you-start/" },
    { path: "/how-a-run-works/" },
    { path: "/reading-transcripts/" },
    { path: "/the-report/" },
    { path: "/ask-a-question/" },
    {
      path: "/common-mistakes/",
      flags: [
        flag("generic-link-text", "read"),
        flag("generic-link-text", "tab"),
        flag("unlabeled", "read"),
        flag("unlabeled", "tab"),
        flag("headings", "headings"),
      ],
    },
  ];
  return pages.map((page) => ({ ...page, ...changes[page.path] }));
}

/** A run of `pages` written where runAudit would write it, and the result runAudit returns. */
async function finishedRun(
  options: RunAuditOptions,
  pages: SyntheticPage[] = demoPages(),
): Promise<RunAuditResult> {
  const siteDir = path.join(options.cwd!, options.out!, siteFolder(options.site));
  const run = await writeSyntheticRun(siteDir, { id: RUN_ID, pages });
  const failedPages = run.pages.filter((page) => page.status === "failed").length;
  return {
    runId: RUN_ID,
    siteDir,
    runDir: runDir(siteDir, RUN_ID),
    outcome: "completed",
    exitCode: failedPages > 0 ? 3 : 0,
    run,
    failedPages,
  };
}

/**
 * A run that goes until its signal aborts, then ends as an interrupted run does. `during` runs once
 * it has started: it's where a test presses Ctrl+C or closes the window. Once stopped, it says so,
 * as a run shutting down would, before it ends.
 */
function untilStopped(during: () => void) {
  return async (options: RunAuditOptions): Promise<RunAuditResult> => {
    const signal = options.signal!;
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
      during();
    });
    options.logger!.info(RUN_SHUTS_DOWN);
    return { ...(await finishedRun(options)), outcome: "interrupted", exitCode: 130 };
  };
}
const RUN_SHUTS_DOWN = "(the run shuts NVDA and the browser down)";

/** The demo's pages other than the home page, by their first heading. */
const DEMO_TITLES: Record<string, string> = {
  "/before-you-start/": "Before you start",
  "/how-a-run-works/": "How a run works",
  "/reading-transcripts/": "Reading transcripts",
  "/the-report/": "The report",
  "/ask-a-question/": "Ask a question",
  "/common-mistakes/": "Common mistakes (on purpose)",
};

/** What NVDA says on each of the demo's pages at `origin`, for the scripted driver. */
function spokenDemo(
  origin: string,
  changes: Record<string, Partial<ScriptedPage>> = {},
): ScriptedPage[] {
  const skipLink = {
    spoken: "Skip to main content, same page link",
    focused: element("Skip to main content", { href: "#main" }),
  };
  return DEMO_PAGES.map((pagePath): ScriptedPage => {
    const title = DEMO_TITLES[pagePath] ?? "Welcome to the voicecap demo";
    const page: ScriptedPage = {
      url: `${origin}${pagePath}`,
      lines:
        pagePath === "/"
          ? HOME_LINES
          : [
              "same page, link, Skip to main content",
              `main landmark, heading, level 1, ${title}`,
              "content info landmark, This demo site comes with voicecap.",
            ],
      headings: [`heading, level 1, ${title}`],
      stops: [skipLink],
    };
    return { ...page, ...changes[pagePath] };
  });
}

/**
 * The real runAudit, with the scripted driver standing in for NVDA and the browser, as the run
 * tests inject it: the run reads the real demo site's sitemap, and writes real transcripts and a
 * real report. `changes` changes what NVDA says on some pages, and `opening` runs as each page
 * opens: it's where a test presses Ctrl+C mid-run.
 */
function realRun(
  options: {
    changes?: Record<string, Partial<ScriptedPage>>;
    opening?: (url: string) => void;
  } = {},
) {
  return (runOptions: RunAuditOptions): Promise<RunAuditResult> => {
    const driver = new ScriptedDriver(spokenDemo(runOptions.site, options.changes));
    const openPage = driver.openPage.bind(driver);
    driver.openPage = (url) => {
      options.opening?.(url);
      return openPage(url);
    };
    return runAudit({ ...runOptions, driver, now: () => new Date(2026, 8, 29, 14, 5) });
  };
}

// ---- The tour ----

/** Ctrl+C at the terminal (the prompter's signal) and the process's signals, for a test to send. */
function stopper() {
  return { ctrlC: new AbortController(), signals: fakeSignals("win32") };
}
type Stopper = ReturnType<typeof stopper>;

/**
 * The prompter, with Ctrl+C pressed at its `at`-th question (each Enter, and the report's y/n), as
 * a terminal prompter has it: `interrupted` aborts, and the question rejects.
 */
function pressCtrlC(prompter: Prompter, ctrlC: AbortController, at: number | null): Prompter {
  let asked = 0;
  const stopAt = <T>(ask: () => Promise<T>): Promise<T> => {
    asked++;
    if (asked !== at) return ask();
    ctrlC.abort(new InterruptedError());
    return Promise.reject(new InterruptedError());
  };
  return {
    ...prompter,
    ask: (question, options) => stopAt(() => prompter.ask(question, options)),
    confirm: (question, defaultYes) => stopAt(() => prompter.confirm(question, defaultYes)),
    interrupted: ctrlC.signal,
  };
}

interface TourOptions {
  platform: PlatformReadiness;
  os?: NodeJS.Platform;
  /** An answer per question, in order: "" is Enter. */
  answers: string[];
  /** The question (1-based) that gets Ctrl+C instead of its answer. */
  ctrlCAt?: number;
  /** Ctrl+C and the signals the tour sees: a test that sends one makes its own. */
  stop?: Stopper;
  /** Stands in for runAudit. Default: a finished run of the demo's pages (finishedRun). */
  run?: (options: RunAuditOptions) => Promise<RunAuditResult>;
  /** The demo site's origin, or why it couldn't start. */
  server?: string | Error;
  /** Serve the real demo site instead: startDemoServer, on any free port. */
  realSite?: boolean;
  /** Runs as the demo site starts, before the run: where a test presses Ctrl+C that early. */
  whileStarting?: () => void;
  /** A voicecap.config.json in the current folder, as written: the tour never reads it. */
  folderConfig?: string;
  /** What the file opener answers. */
  opens?: boolean;
}

/**
 * Runs the tour with everything outside it faked: the screen reader, the demo site, the run, the
 * file opener, and the process's signals. `events` records what happened outside, in order, and
 * `error` is what the tour threw, if it did.
 */
async function tour(options: TourOptions) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "voicecap-demo-"));
  if (options.folderConfig !== undefined) {
    await writeFile(path.join(cwd, "voicecap.config.json"), options.folderConfig);
  }
  const screen = scriptedScreen(options.answers);
  const stop = options.stop ?? stopper();
  const events: string[] = [];
  const runs: RunAuditOptions[] = [];
  let checked = 0;
  const { liveTest } = options.platform;
  const platform: PlatformReadiness = {
    ...options.platform,
    quickChecks: () => {
      checked++;
      return options.platform.quickChecks();
    },
    liveTest: liveTest
      ? (signal) => {
          events.push("live test");
          return liveTest(signal);
        }
      : null,
  };
  const deps: TourDeps = {
    platform,
    os: options.os ?? "win32",
    prompter: pressCtrlC(screen.prompter, stop.ctrlC, options.ctrlCAt ?? null),
    logger: screen.logger,
    cwd,
    // Set, and never used: the run's --out is voicecap-demo.
    env: { VOICECAP_TRANSCRIPTS: path.join(cwd, "audit-record") },
    now: () => new Date(2026, 8, 29, 14, 5),
    startServer: async (): Promise<DemoServer> => {
      options.whileStarting?.();
      const server = options.server ?? ORIGIN;
      if (server instanceof Error) throw server;
      // Port 0: any free port, so a demo running on this computer doesn't matter.
      const real = options.realSite ? await startDemoServer({ port: 0 }) : null;
      events.push("demo site started");
      return {
        origin: real?.origin ?? server,
        close: async () => {
          events.push("demo site stopped");
          await real?.close();
        },
      };
    },
    runAudit: (runOptions) => {
      events.push("run");
      runs.push(runOptions);
      return (options.run ?? ((given) => finishedRun(given)))(runOptions);
    },
    openFile: (file) => {
      events.push(`opened ${file}`);
      return Promise.resolve(options.opens ?? true);
    },
    signals: stop.signals.source,
  };
  let code: number | null = null;
  let error: unknown = null;
  try {
    code = await runTour(deps);
  } catch (thrown) {
    error = thrown;
  } finally {
    screen.close();
  }
  return {
    code,
    error,
    screen: screen.text(),
    errors: screen.errors(),
    events,
    runs,
    cwd,
    checked,
    unused: screen.unused(),
    listening: stop.signals.listening(),
    /** Every signal listened for, in order, and every exit asked for. */
    added: stop.signals.added,
    exits: stop.signals.exits,
  };
}

/** Whether `parts` appear in `text` in this order. */
function inOrder(text: string, parts: string[]): boolean {
  let from = 0;
  for (const part of parts) {
    const at = text.indexOf(part, from);
    if (at === -1) return false;
    from = at + part.length;
  }
  return true;
}

const STEPS = [
  "Step 1 of 7 · Welcome",
  "Step 2 of 7 · Checking this computer",
  "Step 3 of 7 · The live test",
  "Step 4 of 7 · Auditing the demo site",
  "Step 5 of 7 · The transcripts",
  "Step 6 of 7 · The report",
  "Step 7 of 7 · Your own site",
] as const;
/** Every question on a ready Windows PC: Enter at five pauses, then y to open the report. */
const WINDOWS_ANSWERS = ["", "", "", "", "", "y"];
/** Every question on a Mac: Enter at four pauses, before steps 2, 3, 4, and 7. */
const MAC_ANSWERS = ["", "", "", ""];
const STOPPED = "Stopped. Nothing is left running.\n";
const DURING_THE_RUN = ["live test", "demo site started", "run", "demo site stopped"];
/** What step 4 says the moment the audit is stopped. */
const STOPPING = "Stopping: shutting down NVDA and the browser. This can take a minute.\n";

/** How many times `part` appears in `text`. */
function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("the tour on a ready Windows PC", () => {
  it("walks all seven steps in order, and exits 0", async () => {
    const result = await tour({ platform: windows(), answers: WINDOWS_ANSWERS });
    expect(result.code).toBe(0);
    expect(inOrder(result.screen, ["voicecap demo: a guided first run", ...STEPS])).toBe(true);
    expect(result.unused).toEqual([]);
    expect(result.events).toEqual([
      ...DURING_THE_RUN,
      `opened ${path.join(result.cwd, "voicecap-demo", "127.0.0.1_4848", "report.html")}`,
    ]);
    expect(result.listening).toEqual([]);
  });

  it("says step 2's preflight as init does, with no demo line", async () => {
    const result = await tour({ platform: windows(), answers: WINDOWS_ANSWERS });
    expect(result.screen).toContain(
      "that's: npx @icjia/voicecap preflight\n\nvoicecap preflight, 2026-09-29 14:05\n",
    );
    expect(result.screen).toContain("  OK    NVDA 2026.2 is installed\n");
    expect(result.screen).toContain("Ready: this computer can run NVDA for voicecap.\n");
    expect(result.screen).not.toContain("The full demo runs on a Windows PC");
  });

  it("runs the command step 4 shows, without checking again", async () => {
    const result = await tour({ platform: windows(), answers: WINDOWS_ANSWERS });
    expect(result.screen).toContain(
      "  npx @icjia/voicecap --site http://127.0.0.1:4848 --sitemap sitemap.xml --out voicecap-demo --fresh\n",
    );
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      site: ORIGIN,
      sitemap: "sitemap.xml",
      out: "voicecap-demo",
      fresh: true,
      cwd: result.cwd,
      // Stopped early, the run says to start the demo again: it's --fresh, and can't resume.
      again: "npx @icjia/voicecap demo",
    });
    // Step 2's result goes to the run, which uses it instead of checking again.
    expect(result.runs[0]!.preflight?.ready).toBe(true);
    expect(result.checked).toBe(1);
  });

  it("names the port the demo site got, in the command and the folders", async () => {
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      server: "http://127.0.0.1:51234",
    });
    expect(result.screen).toContain("--site http://127.0.0.1:51234 --sitemap sitemap.xml");
    expect(result.runs[0]!.site).toBe("http://127.0.0.1:51234");
    expect(result.screen).toContain(
      "Saved in voicecap-demo/127.0.0.1_51234/2026-09-29/1405/pages/",
    );
  });

  it("shows the transcripts and the report from the run's own folders", async () => {
    const result = await tour({ platform: windows(), answers: WINDOWS_ANSWERS });
    expect(result.screen).toContain(
      "Saved in voicecap-demo/127.0.0.1_4848/2026-09-29/1405/pages/, one folder per page, each with\n",
    );
    expect(result.screen).toContain(
      [
        "What NVDA said on the home page (read.txt, the first 5 lines after its header):",
        ...HOME_READ.slice(0, 5).map((line) => `  ${line}`),
      ].join("\n"),
    );
    expect(result.screen).toContain(
      "voicecap-demo/127.0.0.1_4848/report.html shows every page, what each pass captured, and flags\n",
    );
    expect(result.screen).toContain(
      "Flags: 3 on /common-mistakes/ (generic-link-text, unlabeled, headings), none on the other pages.\n",
    );
    expect(result.screen).toContain("Open the report now? [Y/n]: y\nOpening the report…\n");
  });

  it("leaves the report alone on no, and says where it is when it can't open it", async () => {
    const declined = await tour({ platform: windows(), answers: ["", "", "", "", "", "n"] });
    expect(declined.code).toBe(0);
    expect(declined.events).toEqual(DURING_THE_RUN);

    const failed = await tour({ platform: windows(), answers: WINDOWS_ANSWERS, opens: false });
    expect(failed.code).toBe(0);
    // The whole path, in this computer's own form, to paste into a browser.
    const report = path.join(failed.cwd, "voicecap-demo", "127.0.0.1_4848", "report.html");
    expect(path.isAbsolute(report)).toBe(true);
    expect(failed.screen).toContain(`Couldn't open it. Open ${report} in your browser.\n`);
    expect(failed.screen).toContain(STEPS[6]);
  });

  // I2: a project's own voicecap.config.* in this folder never changes the demo.
  it("runs with voicecap's own settings, never the folder's config file, and says so", async () => {
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      folderConfig: JSON.stringify({ driver: "replay", replayFrom: "elsewhere", passes: ["read"] }),
    });
    expect(result.code).toBe(0);
    expect(result.runs[0]!.config).toMatchObject({ file: null, config: DEFAULT_CONFIG });
    expect(result.screen).toContain(
      "The tour uses voicecap's own settings, not a voicecap.config file in this folder.\n",
    );
  });

  it("points out a failed page in steps 5 and 6, and exits 3", async () => {
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      run: (options) =>
        finishedRun(options, demoPages({ "/how-a-run-works/": { status: "failed" } })),
    });
    expect(result.code).toBe(3);
    expect(
      inOrder(result.screen, [
        STEPS[4],
        "1 page failed, so its folder may be missing transcripts: /how-a-run-works/.",
        STEPS[5],
        "The report shows why 1 page failed: /how-a-run-works/.",
        STEPS[6],
      ]),
    ).toBe(true);
  });
});

describe("the tour on a Mac, until the VoiceOver driver", () => {
  it("flags a Windows PC, runs the live test, explains step 4, skips 5 and 6, and exits 0", async () => {
    const result = await tour({ platform: mac(), os: "darwin", answers: MAC_ANSWERS });
    expect(result.code).toBe(0);
    expect(result.unused).toEqual([]);
    expect(result.screen).toContain("For now, a Windows PC runs the full tour. On this Mac,");
    expect(result.screen).toContain(
      'Checking this Mac. If macOS asks for access to control "System Events", click Allow.\n',
    );
    expect(result.screen).toContain(
      "  OK    VoiceOver can be controlled by AppleScript\n  WARN  The full demo runs on a Windows PC for now: on this Mac, the tour stops after the live test\n",
    );
    expect(result.screen).toContain(
      "Ready: this computer is set up for VoiceOver, but voicecap can't run VoiceOver yet: that comes with its VoiceOver driver.\n",
    );
    expect(result.screen).toContain(
      "voicecap can't run VoiceOver yet: that comes with its VoiceOver driver.\nOn a Windows PC,",
    );
    expect(result.screen).toContain(
      "Press Enter for step 7 (your own site), or Ctrl+C to stop here: ",
    );
    expect(inOrder(result.screen, [STEPS[0], STEPS[1], STEPS[2], STEPS[3], STEPS[6]])).toBe(true);
    expect(result.screen).not.toContain(STEPS[4]);
    expect(result.screen).not.toContain(STEPS[5]);
    // The live test ran; the demo site, a run, and the opener never did.
    expect(result.events).toEqual(["live test"]);
    // With no audit, Ctrl+C as a SIGINT is never listened for, and nothing listens at the end.
    expect(result.added).not.toContain("SIGINT");
    expect(result.listening).toEqual([]);
  });
});

describe("the tour where the computer isn't ready", () => {
  it("stops at step 2 on Linux, with the preflight's own FAIL, and exits 2", async () => {
    const result = await tour({ platform: linux(), os: "linux", answers: [""] });
    expect(result.code).toBe(2);
    expect(result.screen).toContain("Not ready: 1 problem.\n\n1. No screen reader to drive here");
    expect(result.screen).not.toContain("The full demo runs on a Windows PC");
    expect(result.screen).not.toContain(STEPS[2]);
    expect(result.events).toEqual([]);
    expect(result.listening).toEqual([]);
  });

  // M8: Linux can't become ready, and the demo takes no --replay-from.
  it("says where the tour runs on Linux, with none of the advice it can't take", async () => {
    const result = await tour({ platform: linux(), os: "linux", answers: [""] });
    expect(result.code).toBe(2);
    // The platform's other fix step stays, numbered as the only one.
    expect(result.screen).toContain(
      "   How to fix:\n     1. Run real audits on a Windows computer or a Mac.\n",
    );
    expect(result.screen).not.toContain("--replay-from");
    expect(result.screen).not.toContain("When this computer is ready");
    expect(result.screen).toMatch(
      /\n\nThe tour runs on a Windows PC, or on a Mac for the checks: run npx @icjia\/voicecap demo there\.\n$/,
    );
  });

  // T6: step 2 is rendered with offerSetup: true.
  it("offers setup in step 2 when it helps, and the problem's own steps don't already say so", async () => {
    const platform = windows({
      quickChecks: () => [
        runner({
          id: "nvda",
          status: "FAIL",
          summary: "NVDA for voicecap is out of date",
          problem: {
            title: "NVDA for voicecap",
            whatsWrong: "voicecap's own copy of NVDA is older than this version of voicecap needs.",
            fix: ["Close any NVDA that's running."],
            setupHelps: true,
          },
        }),
      ],
    });
    const result = await tour({ platform, answers: [""] });
    expect(result.code).toBe(2);
    expect(result.screen).toContain(
      "     1. Close any NVDA that's running.\n   Or run npx @icjia/voicecap setup, which walks you through it.\n",
    );
    expect(result.screen).toContain(
      "\n\nWhen this computer is ready, run npx @icjia/voicecap demo again.\n",
    );
  });

  it("gives the numbered diagnosis, saying when setup helps, and never starts the demo site", async () => {
    const platform = windows({
      quickChecks: () => [
        runner({
          id: "nvda",
          status: "FAIL",
          summary: "NVDA for voicecap isn't installed",
          problem: NVDA_MISSING,
        }),
      ],
    });
    const result = await tour({ platform, answers: [""] });
    expect(result.code).toBe(2);
    expect(result.screen).toContain("1. NVDA for voicecap\n");
    expect(result.screen).toContain("     1. Run npx @icjia/voicecap setup.\n");
    expect(result.screen).toContain(
      "When this computer is ready, run npx @icjia/voicecap demo again.",
    );
    expect(result.events).toEqual([]);
  });

  it("stops after a failed live test, with its problems, before step 4", async () => {
    const platform = windows({
      liveTest: () =>
        Promise.resolve([
          {
            id: "liveSpeech",
            status: "FAIL",
            summary: "NVDA started, but voicecap heard nothing from it",
            problem: {
              title: "NVDA's speech",
              whatsWrong: "NVDA started, but voicecap captured no speech from it.",
              fix: ["Run npx @icjia/voicecap demo again."],
              setupHelps: true,
            },
          },
        ]),
    });
    const result = await tour({ platform, answers: ["", ""] });
    expect(result.code).toBe(2);
    expect(result.screen).toContain("Not ready: 1 problem.\n\n1. NVDA's speech");
    expect(result.screen).not.toContain(STEPS[3]);
    expect(result.events).toEqual(["live test"]);
  });
});

describe("stopping the tour", () => {
  for (let at = 1; at <= WINDOWS_ANSWERS.length; at++) {
    it(`stops at Windows' question ${at} on Ctrl+C, with nothing left running (130)`, async () => {
      const result = await tour({ platform: windows(), answers: WINDOWS_ANSWERS, ctrlCAt: at });
      expect(result.code).toBe(130);
      expect(result.screen.endsWith(STOPPED)).toBe(true);
      // The demo site runs only during step 4's run, so it has stopped by every pause.
      expect(result.events.filter((event) => event.startsWith("demo site"))).toEqual(
        at <= 3 ? [] : ["demo site started", "demo site stopped"],
      );
      expect(result.events.some((event) => event.startsWith("opened"))).toBe(false);
      // Ctrl+C at a pause after the audit isn't the audit stopping: it says nothing of that.
      expect(result.screen).not.toContain(STOPPING);
      expect(result.listening).toEqual([]);
    });
  }

  for (let at = 1; at <= MAC_ANSWERS.length; at++) {
    it(`stops at the Mac's question ${at} on Ctrl+C (130)`, async () => {
      const result = await tour({
        platform: mac(),
        os: "darwin",
        answers: MAC_ANSWERS,
        ctrlCAt: at,
      });
      expect(result.code).toBe(130);
      expect(result.screen.endsWith(STOPPED)).toBe(true);
      expect(result.events.filter((event) => event !== "live test")).toEqual([]);
    });
  }

  it("stops during the live test on Ctrl+C, after its clean-up (130)", async () => {
    const stop = stopper();
    const platform = windows({
      liveTest: (signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener("abort", () => reject(new InterruptedError()), { once: true });
          stop.ctrlC.abort();
        }),
    });
    const result = await tour({ platform, answers: WINDOWS_ANSWERS, stop });
    expect(result.code).toBe(130);
    expect(result.errors).toContain(
      "Warning: Interrupted: the screen reader and the browser were shut down.",
    );
    expect(result.screen.endsWith(STOPPED)).toBe(true);
    expect(result.events).toEqual(["live test"]);
    expect(result.listening).toEqual([]);
  });

  // Review Focus: the audit takes minutes, hands off, and the tour invites Ctrl+C during it.
  it("stops the audit on Ctrl+C through the run's signal, stops the demo site, and skips steps 5 and 6", async () => {
    const stop = stopper();
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      stop,
      run: untilStopped(() => stop.ctrlC.abort()),
    });
    expect(result.code).toBe(130);
    expect(result.events).toEqual(DURING_THE_RUN);
    expect(result.screen).not.toContain(STEPS[4]);
    expect(result.screen.endsWith(STOPPED)).toBe(true);
    expect(result.listening).toEqual([]);
  });

  // I1: the shutdown can take a minute, so the tour says at once that it's stopping.
  it("says once, the moment Ctrl+C stops the audit, that it's stopping", async () => {
    const stop = stopper();
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      stop,
      run: untilStopped(() => stop.ctrlC.abort()),
    });
    expect(count(result.screen, STOPPING)).toBe(1);
    // Said before the run has finished shutting down, and before the tour's last word.
    expect(inOrder(result.screen, [STEPS[3], STOPPING, RUN_SHUTS_DOWN, STOPPED])).toBe(true);
  });

  it("stops the audit the same way when the window is closed", async () => {
    const stop = stopper();
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      stop,
      run: untilStopped(() => stop.signals.send("SIGHUP")),
    });
    expect(result.code).toBe(130);
    expect(result.events).toEqual(DURING_THE_RUN);
    expect(result.listening).toEqual([]);
    expect(count(result.screen, STOPPING)).toBe(1);
    expect(inOrder(result.screen, [STEPS[3], STOPPING, RUN_SHUTS_DOWN, STOPPED])).toBe(true);
  });

  it("says it only once when Ctrl+C and a closed window both stop the audit", async () => {
    const stop = stopper();
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      stop,
      run: untilStopped(() => {
        stop.ctrlC.abort();
        stop.signals.send("SIGHUP");
      }),
    });
    expect(result.code).toBe(130);
    expect(count(result.screen, STOPPING)).toBe(1);
  });

  // I1: if the terminal leaves raw mode during the run, Ctrl+C arrives as a SIGINT instead of
  // reaching the prompter. With no listener, Node would end at once, leaving NVDA running.
  it("stops the audit on a SIGINT, when Ctrl+C arrives as a signal", async () => {
    const stop = stopper();
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      stop,
      run: untilStopped(() => stop.signals.send("SIGINT")),
    });
    expect(result.code).toBe(130);
    expect(result.events).toEqual(DURING_THE_RUN);
    expect(result.screen).not.toContain(STEPS[4]);
    expect(count(result.screen, STOPPING)).toBe(1);
    expect(result.screen.endsWith(STOPPED)).toBe(true);
    expect(result.exits).toEqual([]);
    expect(result.listening).toEqual([]);
  });

  it("exits at once (130) on a second SIGINT during the audit", async () => {
    const stop = stopper();
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      stop,
      run: untilStopped(() => {
        stop.signals.send("SIGINT");
        stop.signals.send("SIGINT");
      }),
    });
    expect(result.exits).toEqual([130]);
    expect(count(result.screen, STOPPING)).toBe(1);
    expect(result.listening).toEqual([]);
  });

  it("listens for SIGINT only while the audit runs", async () => {
    const stop = stopper();
    let duringTheRun: string[] = [];
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      stop,
      run: (options) => {
        duringTheRun = stop.signals.listening();
        return finishedRun(options);
      },
    });
    expect(result.code).toBe(0);
    expect(duringTheRun).toContain("SIGINT");
    expect(result.added.filter((signal) => signal === "SIGINT")).toHaveLength(1);
    expect(result.listening).toEqual([]);
    expect(result.screen).not.toContain(STOPPING);
  });

  it("says it's stopping when Ctrl+C comes as the demo site starts, before the run", async () => {
    const stop = stopper();
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      stop,
      whileStarting: () => stop.ctrlC.abort(),
      run: untilStopped(() => {}),
    });
    expect(result.code).toBe(130);
    expect(count(result.screen, STOPPING)).toBe(1);
    expect(result.listening).toEqual([]);
  });

  it("ends when the run stops after failed pages in a row, which it has explained (exit 2)", async () => {
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      run: async (options) => ({
        ...(await finishedRun(options)),
        outcome: "stopped",
        exitCode: 2,
      }),
    });
    expect(result.code).toBe(2);
    expect(result.events).toEqual(DURING_THE_RUN);
    expect(result.screen).not.toContain(STEPS[4]);
    // I3: the tour's own next step, since the run can't be resumed.
    expect(result.screen).toMatch(
      /\n\nRun npx @icjia\/voicecap preflight to see what to fix, then npx @icjia\/voicecap demo again\.\n$/,
    );
    expect(result.listening).toEqual([]);
  });
});

describe("the tour when the audit can't go as planned", () => {
  // Review Focus: the run lock is held by another voicecap, NVDA won't start, or the demo site
  // can't listen.
  it("passes on the run's error, having stopped the demo site", async () => {
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      run: () => Promise.reject(new EnvironmentError("NVDA didn't start.")),
    });
    expect(result.error).toBeInstanceOf(EnvironmentError);
    expect((result.error as EnvironmentError).exitCode).toBe(2);
    expect(result.events).toEqual(DURING_THE_RUN);
    expect(result.listening).toEqual([]);
  });

  it("says so when the demo site can't start (exit 2)", async () => {
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      server: Object.assign(new Error("listen EADDRNOTAVAIL: address not available"), {
        code: "EADDRNOTAVAIL",
      }),
    });
    expect(result.error).toBeInstanceOf(EnvironmentError);
    expect((result.error as Error).message).toBe(
      "The demo site couldn't start: listen EADDRNOTAVAIL: address not available",
    );
    expect(result.events).toEqual(["live test"]);
    expect(result.listening).toEqual([]);
  });

  // Review Focus: the first page is where a run most often fails, and it's the page step 5 quotes.
  it("goes on when the home page failed, with no read.txt to quote (exit 3)", async () => {
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      run: (options) => finishedRun(options, demoPages({ "/": { status: "failed" } })),
    });
    expect(result.code).toBe(3);
    expect(result.screen).toContain("There's no read.txt for the home page to show here.\n");
    expect(result.screen).toContain("The report shows why 1 page failed: /.\n");
    expect(inOrder(result.screen, [STEPS[4], STEPS[5], STEPS[6]])).toBe(true);
  });
});

// M11: the seams the stand-ins above can't show. The real runAudit, with the scripted driver
// standing in for NVDA and the browser as the run tests inject it, against the real demo server
// and site: the run reads the site's own sitemap and writes real transcripts and a real report,
// which steps 5 and 6 then read. No real screen reader, browser, opener, or signal, and nothing
// beyond 127.0.0.1.
describe("the tour with a real run of the real demo site", () => {
  it("quotes the home page's read.txt in step 5, and names the report in step 6", async () => {
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      realSite: true,
      run: realRun(),
    });
    expect(result.error).toBeNull();
    expect(result.code).toBe(0);
    const folder = siteFolder(result.runs[0]!.site);
    const siteDir = path.join(result.cwd, "voicecap-demo", folder);
    const run = await readRunJson(siteDir, RUN_ID);
    // The run took its pages from the demo site's own sitemap: all seven, in the tour's order.
    expect(run.pages.map((page) => new URL(page.url).pathname)).toEqual([...DEMO_PAGES]);
    expect(run.pages.every((page) => page.status === "done")).toBe(true);
    expect(result.screen).toContain(`Saved in voicecap-demo/${folder}/2026-09-29/1405/pages/, `);
    expect(result.screen).toContain(
      [
        "What NVDA said on the home page (read.txt, the first 5 lines after its header):",
        ...HOME_READ.slice(0, 5).map((line) => `  ${line}`),
      ].join("\n"),
    );
    const report = path.join(siteDir, "report.html");
    expect(existsSync(report)).toBe(true);
    expect(result.screen).toContain(`\nvoicecap-demo/${folder}/report.html shows every page, `);
    expect(result.events).toEqual([...DURING_THE_RUN, `opened ${report}`]);
    // Never the VOICECAP_TRANSCRIPTS audit record.
    expect(existsSync(path.join(result.cwd, "audit-record"))).toBe(false);
    expect(result.listening).toEqual([]);
  });

  // I2: a project's own config in this folder, whether it would change the run or can't load.
  it.each([
    ["would change the run", JSON.stringify({ driver: "replay", passes: ["read"] })],
    ["isn't valid", JSON.stringify({ passes: "every one" })],
  ])(
    "runs with voicecap's own settings when the folder's config file %s",
    async (_what, folderConfig) => {
      const result = await tour({
        platform: windows(),
        answers: WINDOWS_ANSWERS,
        realSite: true,
        run: realRun(),
        folderConfig,
      });
      expect(result.error).toBeNull();
      expect(result.code).toBe(0);
      const siteDir = path.join(result.cwd, "voicecap-demo", siteFolder(result.runs[0]!.site));
      const run = await readRunJson(siteDir, RUN_ID);
      expect(run.settings).toMatchObject({
        driver: "guidepup",
        passes: ["read", "headings", "tab"],
      });
    },
  );

  // I1 and I3: stopped mid-run, the real run shuts down as any run does. It can't be resumed.
  it("stops the run on Ctrl+C, says so at once, and says to start the demo again", async () => {
    const stop = stopper();
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      stop,
      realSite: true,
      run: realRun({
        opening: (url) => {
          if (url.endsWith("/before-you-start/")) stop.ctrlC.abort(new InterruptedError());
        },
      }),
    });
    expect(result.code).toBe(130);
    expect(result.events).toEqual(DURING_THE_RUN);
    expect(count(result.screen, STOPPING)).toBe(1);
    expect(result.screen.endsWith(STOPPED)).toBe(true);
    expect(result.errors).toContain(
      "Warning: Interrupted. Progress is saved in 2026-09-29_1405; run npx @icjia/voicecap demo to start again.\n",
    );
    expect(result.errors).not.toContain("the same command");
    expect(result.listening).toEqual([]);
  });

  it("stops the run after failed pages in a row, and says what to do next (exit 2)", async () => {
    const broken: Partial<ScriptedPage> = { openError: new Error("NVDA is not responding") };
    const result = await tour({
      platform: windows(),
      answers: WINDOWS_ANSWERS,
      realSite: true,
      run: realRun({ changes: Object.fromEntries(DEMO_PAGES.map((page) => [page, broken])) }),
    });
    expect(result.code).toBe(2);
    expect(result.events).toEqual(DURING_THE_RUN);
    expect(result.errors).toContain(
      "Error: Stopped after 5 failed pages in a row: the screen reader or browser seems to be unusable. Fix the problem, then run npx @icjia/voicecap demo to start again.\n",
    );
    expect(result.errors).not.toContain("the same command");
    expect(result.screen).toMatch(
      /\n\nRun npx @icjia\/voicecap preflight to see what to fix, then npx @icjia\/voicecap demo again\.\n$/,
    );
    expect(result.listening).toEqual([]);
  });
});
