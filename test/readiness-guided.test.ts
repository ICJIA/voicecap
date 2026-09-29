import { describe, expect, it } from "vitest";

import {
  automationDeniedProblem,
  permissionPromptProblem,
  SETTINGS_PAGES,
} from "../src/drivers/voiceover/macos.js";
import { InputEndedError } from "../src/init/prompt.js";
import { InterruptedError } from "../src/passes/steps.js";
import { guideThrough, offerLiveTest } from "../src/readiness/guided.js";
import type { Check, PlatformReadiness, Problem } from "../src/readiness/model.js";
import type { SignalSource } from "../src/run/signals.js";
import { fakeSignals } from "./helpers/fake-signals.js";
import { scriptedPlatform } from "./helpers/scripted-platform.js";
import { scriptedScreen } from "./helpers/screen.js";

const APP = "Visual Studio Code";
const AGAIN = "npx @icjia/voicecap setup";
/** The step's question as the screen shows it, before the answer's echo. */
const ASK = "Press Enter when it's on, or type s to skip: ";

// The Mac's problems, worded as readiness-mac.ts words them for setup.
const APPLESCRIPT: Problem = {
  title: "AppleScript control of VoiceOver",
  whatsWrong:
    "voicecap sends VoiceOver its commands through AppleScript, which VoiceOver accepts only once you allow it.",
  fix: [
    "Open VoiceOver Utility (in Applications, then Utilities).",
    'Under General, tick "Allow VoiceOver to be controlled with AppleScript", and enter your Mac\'s password when asked.',
    `Run ${AGAIN} again.`,
  ],
  setupHelps: true,
  open: { kind: "app", name: "VoiceOver Utility" },
};
const ACCESSIBILITY: Problem = {
  title: `Accessibility for ${APP}`,
  whatsWrong: `voicecap presses VoiceOver's keys through macOS's Accessibility features, which need your OK for ${APP}.`,
  fix: [
    "Open System Settings, then Privacy & Security, then Accessibility.",
    `Switch on ${APP}. If it isn't listed, click + and choose it.`,
    `Run ${AGAIN} again.`,
  ],
  setupHelps: true,
  open: SETTINGS_PAGES.accessibility,
};
const FULL_DISK_ACCESS: Problem = {
  title: `Full Disk Access for ${APP}`,
  whatsWrong: `voicecap keeps its VoiceOver settings apart from yours by linking them into a folder macOS protects, and macOS blocks ${APP} from that folder.`,
  fix: [
    "Open System Settings, then Privacy & Security, then Full Disk Access.",
    `Switch on ${APP}. If it isn't listed, click + and choose it.`,
    `When macOS asks, quit and reopen ${APP}.`,
    `Run ${AGAIN} again.`,
  ],
  setupHelps: true,
  open: SETTINGS_PAGES.fullDiskAccess,
  needsRestart: true,
};
const ASSETS: Problem = {
  title: "VoiceOver's files for Guidepup",
  whatsWrong:
    "Guidepup starts VoiceOver with its own settings file, which isn't in /Users/pat/Library/Caches/guidepup yet.",
  fix: ["Run npx @icjia/voicecap setup."],
  setupHelps: true,
};
const MACOS_VERSION: Problem = {
  title: "macOS 27",
  whatsWrong:
    "voicecap drives VoiceOver through Guidepup 0.34.0, which supports macOS 12 through 26.",
  fix: ["Use a Mac with a supported version of macOS."],
  setupHelps: false,
};

const fail = (id: string, summary: string, problem: Problem): Check => ({
  id,
  status: "FAIL",
  summary,
  problem,
});
const ok = (id: string, summary: string): Check => ({ id, status: "OK", summary });

const ACCESSIBILITY_FAIL = fail(
  "accessibility",
  `Accessibility: ${APP} isn't allowed`,
  ACCESSIBILITY,
);
const ACCESSIBILITY_OK = ok("accessibility", `Accessibility: ${APP} is allowed`);
const FULL_DISK_ACCESS_FAIL = fail(
  "fullDiskAccess",
  `Full Disk Access: ${APP} isn't allowed`,
  FULL_DISK_ACCESS,
);
const APPLESCRIPT_FAIL = fail(
  "appleScript",
  "VoiceOver can't be controlled by AppleScript",
  APPLESCRIPT,
);
const SYSTEM_EVENTS_DENIED = fail(
  "systemEvents",
  `${APP} isn't allowed to control System Events`,
  automationDeniedProblem(APP, "System Events", AGAIN),
);
const SYSTEM_EVENTS_UNANSWERED = fail(
  "systemEvents",
  "No answer from System Events in 60 seconds",
  permissionPromptProblem(APP, "System Events", AGAIN),
);
const SYSTEM_EVENTS_OK = ok("systemEvents", `${APP} can control System Events`);
const VOICEOVER_ON: Check = {
  id: "voiceOverOn",
  status: "WARN",
  summary: "VoiceOver is on: voicecap will use it, then turn it back on with your settings",
};

/**
 * Runs guideThrough on a scripted platform, answering its questions from `answers` (null: no one
 * to answer, so no prompter), and returns what it returned, what it put on the screen, what it
 * opened, and which checks ran.
 */
async function guide(
  script: Record<string, (Check | Error)[]>,
  answers: string[] | null,
  options: { openFails?: boolean } = {},
) {
  const scripted = scriptedPlatform(script);
  const screen = scriptedScreen(answers ?? []);
  const opened: NonNullable<Problem["open"]>[] = [];
  try {
    const outcome = await guideThrough(scripted.platform, {
      prompter: answers === null ? null : screen.prompter,
      say: screen.say,
      open: (target) => {
        opened.push(target);
        return Promise.resolve(options.openFails !== true);
      },
      app: APP,
    });
    return {
      ...outcome,
      screen: screen.text(),
      opened,
      runs: scripted.runs,
      preflights: scripted.preflights(),
      unused: screen.unused(),
    };
  } finally {
    screen.close();
  }
}

/** The "Step i of n" lines on a screen. */
function stepLines(screen: string): string[] {
  return screen.split("\n").filter((line) => line.startsWith("Step "));
}

describe("guideThrough", () => {
  it("opens the page, waits for Enter, checks again, and says OK", async () => {
    const guided = await guide({ accessibility: [ACCESSIBILITY_FAIL, ACCESSIBILITY_OK] }, [""]);

    expect(guided.screen).toBe(
      [
        "",
        "Step 1 of 1: Accessibility for Visual Studio Code",
        "  voicecap presses VoiceOver's keys through macOS's Accessibility features, which need your OK for Visual Studio Code.",
        "  Opening System Settings at Privacy & Security, Accessibility…",
        "  Switch on Visual Studio Code. If it isn't listed, click + and choose it.",
        ASK,
        "  OK: Accessibility: Visual Studio Code is allowed",
        "",
      ].join("\n"),
    );
    expect(guided.opened).toEqual([SETTINGS_PAGES.accessibility]);
    expect(guided.restartNeeded).toBeNull();
    // The preflight, the step's check, then the preflight again to finish.
    expect(guided.runs).toEqual(["accessibility", "accessibility", "accessibility"]);
    expect(guided.preflights).toBe(2);
    expect(guided.result.ready).toBe(true);
    expect(guided.result.checks).toEqual([ACCESSIBILITY_OK]);
  });

  it("says so when System Settings doesn't open, and where to go by hand", async () => {
    const guided = await guide({ accessibility: [ACCESSIBILITY_FAIL, ACCESSIBILITY_OK] }, [""], {
      openFails: true,
    });

    expect(guided.screen).toBe(
      [
        "",
        "Step 1 of 1: Accessibility for Visual Studio Code",
        "  voicecap presses VoiceOver's keys through macOS's Accessibility features, which need your OK for Visual Studio Code.",
        "  Opening System Settings at Privacy & Security, Accessibility…",
        "  Couldn't open System Settings.",
        "  Open System Settings, then Privacy & Security, then Accessibility.",
        "  Switch on Visual Studio Code. If it isn't listed, click + and choose it.",
        ASK,
        "  OK: Accessibility: Visual Studio Code is allowed",
        "",
      ].join("\n"),
    );
  });

  it("says the same when an app doesn't open", async () => {
    const guided = await guide({ appleScript: [APPLESCRIPT_FAIL] }, ["s"], { openFails: true });

    expect(guided.screen).toContain(
      [
        "  Opening VoiceOver Utility…",
        "  Couldn't open VoiceOver Utility.",
        "  Open VoiceOver Utility (in Applications, then Utilities).",
        '  Under General, tick "Allow VoiceOver to be controlled with AppleScript", and enter your Mac\'s password when asked.',
        `${ASK}s`,
      ].join("\n"),
    );
  });

  it("moves on without checking again when told to skip", async () => {
    const guided = await guide(
      {
        appleScript: [APPLESCRIPT_FAIL],
        accessibility: [ACCESSIBILITY_FAIL, ACCESSIBILITY_OK],
      },
      ["s", ""],
    );

    expect(guided.screen).toContain(
      [
        "",
        "Step 1 of 2: AppleScript control of VoiceOver",
        "  voicecap sends VoiceOver its commands through AppleScript, which VoiceOver accepts only once you allow it.",
        "  Opening VoiceOver Utility…",
        '  Under General, tick "Allow VoiceOver to be controlled with AppleScript", and enter your Mac\'s password when asked.',
        `${ASK}s`,
        "",
        "Step 2 of 2: Accessibility for Visual Studio Code",
      ].join("\n"),
    );
    // appleScript runs only in the two preflights: the skip didn't check it again.
    expect(guided.runs).toEqual([
      "appleScript",
      "accessibility",
      "accessibility",
      "appleScript",
      "accessibility",
    ]);
    expect(guided.result.ready).toBe(false);
  });

  it("takes S as a skip too", async () => {
    const guided = await guide({ accessibility: [ACCESSIBILITY_FAIL] }, ["S"]);
    expect(guided.runs).toEqual(["accessibility", "accessibility"]);
  });

  it("says what's still wrong and asks again until the check passes", async () => {
    const guided = await guide(
      { accessibility: [ACCESSIBILITY_FAIL, ACCESSIBILITY_FAIL, ACCESSIBILITY_OK] },
      ["", ""],
    );

    expect(guided.screen).toContain(
      [
        ASK,
        "  Not yet: Accessibility: Visual Studio Code isn't allowed",
        ASK,
        "  OK: Accessibility: Visual Studio Code is allowed",
        "",
      ].join("\n"),
    );
    // Opened once, for the step, not again for each answer.
    expect(guided.opened).toEqual([SETTINGS_PAGES.accessibility]);
    expect(guided.result.ready).toBe(true);
  });

  it("stops when Full Disk Access still fails, since it passes only after the app reopens", async () => {
    const guided = await guide(
      {
        fullDiskAccess: [FULL_DISK_ACCESS_FAIL],
        systemEvents: [SYSTEM_EVENTS_DENIED, SYSTEM_EVENTS_OK],
      },
      ["", ""],
    );

    // Full Disk Access comes last, though it's checked before System Events.
    expect(stepLines(guided.screen)).toEqual([
      "Step 1 of 2: Control of System Events",
      "Step 2 of 2: Full Disk Access for Visual Studio Code",
    ]);
    // The restart line comes before the question too: quitting the app, as the step says to,
    // ends setup before Enter is ever pressed.
    expect(guided.screen).toContain(
      [
        "Step 2 of 2: Full Disk Access for Visual Studio Code",
        "  voicecap keeps its VoiceOver settings apart from yours by linking them into a folder macOS protects, and macOS blocks Visual Studio Code from that folder.",
        "  Opening System Settings at Privacy & Security, Full Disk Access…",
        "  Switch on Visual Studio Code. If it isn't listed, click + and choose it.",
        "  When macOS asks, quit and reopen Visual Studio Code.",
        "When Visual Studio Code reopens, run npx @icjia/voicecap setup again to finish.",
        ASK,
        "When Visual Studio Code reopens, run npx @icjia/voicecap setup again to finish.",
        "",
      ].join("\n"),
    );
    expect(guided.screen.endsWith("setup again to finish.\n")).toBe(true);
    expect(guided.restartNeeded).toEqual(FULL_DISK_ACCESS);
    // No more questions (a third would have ended the input), and no preflight to finish.
    expect(guided.unused).toEqual([]);
    expect(guided.preflights).toBe(1);
    // What's known so far: System Events passed on its step, Full Disk Access didn't.
    expect(guided.result.checks).toEqual([FULL_DISK_ACCESS_FAIL, SYSTEM_EVENTS_OK]);
    expect(guided.result.ready).toBe(false);
  });

  it("says what to do once the app reopens before asking, even for a step that's skipped", async () => {
    const guided = await guide({ fullDiskAccess: [FULL_DISK_ACCESS_FAIL] }, ["s"]);

    expect(guided.screen).toContain(
      [
        "  When macOS asks, quit and reopen Visual Studio Code.",
        "When Visual Studio Code reopens, run npx @icjia/voicecap setup again to finish.",
        `${ASK}s`,
        "",
      ].join("\n"),
    );
    expect(guided.screen.split("reopens, run npx").length - 1).toBe(1);
    expect(guided.restartNeeded).toBeNull();
  });

  it("opens each step's System Settings page or app, and says so", async () => {
    const guided = await guide(
      {
        appleScript: [APPLESCRIPT_FAIL],
        accessibility: [ACCESSIBILITY_FAIL],
        fullDiskAccess: [FULL_DISK_ACCESS_FAIL],
        systemEvents: [SYSTEM_EVENTS_DENIED],
      },
      ["s", "s", "s", "s"],
    );

    expect(guided.opened).toEqual([
      { kind: "app", name: "VoiceOver Utility" },
      SETTINGS_PAGES.accessibility,
      SETTINGS_PAGES.automation,
      SETTINGS_PAGES.fullDiskAccess,
    ]);
    expect(guided.screen.split("\n").filter((line) => line.startsWith("  Opening "))).toEqual([
      "  Opening VoiceOver Utility…",
      "  Opening System Settings at Privacy & Security, Accessibility…",
      "  Opening System Settings at Privacy & Security, Automation…",
      "  Opening System Settings at Privacy & Security, Full Disk Access…",
    ]);
  });

  it("walks through the FAILs setup helps with that have somewhere to open, and System Events", async () => {
    const guided = await guide(
      {
        version: [
          fail("version", "macOS 27 isn't supported by voicecap's Guidepup", MACOS_VERSION),
        ],
        // Setup's installer is what fixes this one: there's nothing to open.
        assets: [fail("assets", "VoiceOver's files for Guidepup aren't installed", ASSETS)],
        appleScript: [APPLESCRIPT_FAIL],
        accessibility: [ACCESSIBILITY_FAIL],
        fullDiskAccess: [FULL_DISK_ACCESS_FAIL],
        systemEvents: [SYSTEM_EVENTS_UNANSWERED],
        voiceOverOn: [VOICEOVER_ON],
      },
      ["s", "s", "s", "s"],
    );

    expect(stepLines(guided.screen)).toEqual([
      "Step 1 of 4: AppleScript control of VoiceOver",
      "Step 2 of 4: Accessibility for Visual Studio Code",
      "Step 3 of 4: A permission prompt",
      "Step 4 of 4: Full Disk Access for Visual Studio Code",
    ]);
  });

  it("for System Events' prompt, opens nothing: checking again raises the prompt", async () => {
    const guided = await guide({ systemEvents: [SYSTEM_EVENTS_UNANSWERED, SYSTEM_EVENTS_OK] }, [
      "",
    ]);

    expect(guided.screen).toBe(
      [
        "",
        "Step 1 of 1: A permission prompt",
        '  macOS may be waiting for you to answer "Visual Studio Code wants access to control System Events".',
        "  macOS will ask whether Visual Studio Code can control System Events: click Allow.",
        ASK,
        "  OK: Visual Studio Code can control System Events",
        "",
      ].join("\n"),
    );
    expect(guided.opened).toEqual([]);
    expect(guided.runs).toEqual(["systemEvents", "systemEvents", "systemEvents"]);
  });

  it("for System Events turned down, opens Automation and says what to switch on", async () => {
    const guided = await guide({ systemEvents: [SYSTEM_EVENTS_DENIED, SYSTEM_EVENTS_OK] }, [""]);

    expect(guided.screen).toBe(
      [
        "",
        "Step 1 of 1: Control of System Events",
        "  voicecap sends VoiceOver's keys through System Events, and macOS asks you once whether Visual Studio Code may control it. It was turned down.",
        "  Opening System Settings at Privacy & Security, Automation…",
        "  Under Visual Studio Code, switch on System Events.",
        ASK,
        "  OK: Visual Studio Code can control System Events",
        "",
      ].join("\n"),
    );
    expect(guided.opened).toEqual([SETTINGS_PAGES.automation]);
  });

  it("says a check that throws when checked again as not yet passing", async () => {
    const guided = await guide(
      { accessibility: [ACCESSIBILITY_FAIL, new Error("osascript vanished")] },
      ["", "s"],
    );

    expect(guided.screen).toContain(
      [ASK, "  Not yet: Couldn't check accessibility: osascript vanished", `${ASK}s`, ""].join(
        "\n",
      ),
    );
  });

  it("asks nothing, and doesn't check again, when there's nothing to walk through", async () => {
    const assetsFail = fail("assets", "VoiceOver's files for Guidepup aren't installed", ASSETS);
    const guided = await guide({ assets: [assetsFail], accessibility: [ACCESSIBILITY_OK] }, []);

    expect(guided.screen).toBe("");
    expect(guided.preflights).toBe(1);
    expect(guided.result).toMatchObject({ ready: false, checks: [assetsFail, ACCESSIBILITY_OK] });
    expect(guided.restartNeeded).toBeNull();
  });

  it("without anyone to answer, says nothing, asks nothing, and returns the preflight's result", async () => {
    const guided = await guide(
      {
        accessibility: [ACCESSIBILITY_FAIL],
        fullDiskAccess: [FULL_DISK_ACCESS_FAIL],
        voiceOverOn: [VOICEOVER_ON],
      },
      null,
    );

    // setup's preflight, printed next, lists the problems: saying them here too would repeat it.
    expect(guided.screen).toBe("");
    expect(guided.opened).toEqual([]);
    // The preflight's checks only: none is checked again.
    expect(guided.runs).toEqual(["accessibility", "fullDiskAccess", "voiceOverOn"]);
    expect(guided.preflights).toBe(1);
    expect(guided.result).toMatchObject({
      ready: false,
      checks: [ACCESSIBILITY_FAIL, FULL_DISK_ACCESS_FAIL, VOICEOVER_ON],
    });
    expect(guided.restartNeeded).toBeNull();
  });

  it("calls beforeCheck just before each preflight: the first, and the one after the walk", async () => {
    const scripted = scriptedPlatform({ accessibility: [ACCESSIBILITY_FAIL, ACCESSIBILITY_OK] });
    const screen = scriptedScreen([""]);
    const checksBefore: number[] = [];
    try {
      await guideThrough(scripted.platform, {
        prompter: screen.prompter,
        say: screen.say,
        open: () => Promise.resolve(true),
        app: APP,
        beforeCheck: () => {
          checksBefore.push(scripted.runs.length);
        },
      });
    } finally {
      screen.close();
    }

    // Nothing had run before the first; the preflight's check and the step's had run before the last.
    expect(checksBefore).toEqual([0, 2]);
    expect(scripted.preflights()).toBe(2);
  });

  it("calls beforeCheck once when there's no preflight after the walk", async () => {
    const cases: { script: Record<string, Check[]>; answers: string[] | null }[] = [
      // No one to answer.
      { script: { accessibility: [ACCESSIBILITY_FAIL] }, answers: null },
      // Nothing to walk through.
      { script: { accessibility: [ACCESSIBILITY_OK] }, answers: [] },
      // Full Disk Access needs the app to reopen.
      { script: { fullDiskAccess: [FULL_DISK_ACCESS_FAIL] }, answers: [""] },
    ];
    for (const { script, answers } of cases) {
      const scripted = scriptedPlatform(script);
      const screen = scriptedScreen(answers ?? []);
      let calls = 0;
      try {
        await guideThrough(scripted.platform, {
          prompter: answers === null ? null : screen.prompter,
          say: screen.say,
          open: () => Promise.resolve(true),
          app: APP,
          beforeCheck: () => {
            calls++;
          },
        });
      } finally {
        screen.close();
      }
      expect(calls).toBe(1);
      expect(scripted.preflights()).toBe(1);
    }
  });

  it("passes on the prompter's InputEndedError when the input ends at a question", async () => {
    await expect(guide({ accessibility: [ACCESSIBILITY_FAIL] }, [])).rejects.toBeInstanceOf(
      InputEndedError,
    );
  });
});

/**
 * A live test that runs until its signal aborts, then throws InterruptedError, as the real ones
 * do after their clean-up. `during` runs once it has started.
 */
function untilStopped(during: () => void): NonNullable<PlatformReadiness["liveTest"]> {
  return (signal) =>
    new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new InterruptedError()), { once: true });
      during();
    });
}

/** offerLiveTest with the live test answered y (or `answer`), and `signals` for the process's. */
async function offer(
  liveTest: PlatformReadiness["liveTest"],
  signals: SignalSource,
  options: { answer?: string; interrupted?: AbortSignal } = {},
) {
  const screen = scriptedScreen([options.answer ?? "y"]);
  const prompter = options.interrupted
    ? { ...screen.prompter, interrupted: options.interrupted }
    : screen.prompter;
  try {
    const code = await offerLiveTest(scriptedPlatform({}, { liveTest }).platform, {
      prompter,
      logger: screen.logger,
      signals,
    });
    return { code, screen: screen.text(), errors: screen.errors() };
  } finally {
    screen.close();
  }
}

const INTERRUPTED = "Warning: Interrupted: the screen reader and the browser were shut down.\n";

// In init and setup, Ctrl+C reaches only the prompter, which keeps the terminal to itself. Closing
// the terminal's window sends SIGHUP instead, which reaches the process.
describe("offerLiveTest, when the window is closed", () => {
  for (const signal of ["SIGHUP", "SIGTERM"] as const) {
    it(`stops the live test on ${signal}, as Ctrl+C does`, async () => {
      const signals = fakeSignals();
      const offered = await offer(
        untilStopped(() => signals.send(signal)),
        signals.source,
      );
      expect(offered.code).toBe(130);
      expect(offered.errors).toBe(INTERRUPTED);
      expect(signals.exits).toEqual([]);
    });
  }

  it("exits at once with 130 on a second one, so the exit hooks still run", async () => {
    const signals = fakeSignals();
    const offered = await offer(
      untilStopped(() => {
        signals.send("SIGHUP");
        signals.send("SIGHUP");
      }),
      signals.source,
    );
    expect(signals.exits).toEqual([130]);
    expect(offered.code).toBe(130);
  });

  it("still stops on Ctrl+C, through the prompter", async () => {
    const signals = fakeSignals();
    const ctrlC = new AbortController();
    const offered = await offer(
      untilStopped(() => ctrlC.abort()),
      signals.source,
      { interrupted: ctrlC.signal },
    );
    expect(offered.code).toBe(130);
    expect(signals.exits).toEqual([]);
  });

  it("listens only while the live test runs, for SIGTERM and SIGHUP", async () => {
    const signals = fakeSignals();
    let during: string[] = [];
    const offered = await offer(() => {
      during = signals.listening();
      return Promise.resolve([{ id: "live", status: "OK", summary: "VoiceOver speaks" }]);
    }, signals.source);
    expect(offered.code).toBe(0);
    expect(during).toEqual(["SIGHUP", "SIGTERM"]);
    expect(signals.listening()).toEqual([]);
  });

  it("listens for SIGBREAK too on Windows", async () => {
    const signals = fakeSignals("win32");
    let during: string[] = [];
    await offer(() => {
      during = signals.listening();
      return Promise.resolve([]);
    }, signals.source);
    expect(during).toEqual(["SIGBREAK", "SIGHUP", "SIGTERM"]);
  });

  it("stops listening however the live test ends: a FAIL, or an error", async () => {
    const failing = fakeSignals();
    const failed = await offer(
      () =>
        Promise.resolve([
          {
            id: "live",
            status: "FAIL",
            summary: "VoiceOver said nothing",
            problem: {
              title: "VoiceOver",
              whatsWrong: "It said nothing.",
              fix: [],
              setupHelps: false,
            },
          },
        ]),
      failing.source,
    );
    expect(failed.code).toBe(2);
    expect(failing.listening()).toEqual([]);

    const throwing = fakeSignals();
    await expect(offer(() => Promise.reject(new Error("boom")), throwing.source)).rejects.toThrow(
      "boom",
    );
    expect(throwing.listening()).toEqual([]);
  });

  it("never listens when the live test is declined", async () => {
    const signals = fakeSignals();
    const offered = await offer(() => Promise.reject(new Error("never run")), signals.source, {
      answer: "n",
    });
    expect(offered.code).toBe(0);
    expect(signals.added).toEqual([]);
  });
});
