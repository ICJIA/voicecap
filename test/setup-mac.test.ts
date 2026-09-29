import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { SETTINGS_PAGES } from "../src/drivers/voiceover/macos.js";
import { runMacSetup, type MacSetupDeps } from "../src/drivers/voiceover/setup-mac.js";
import { InterruptedError } from "../src/passes/steps.js";
import type { Check, PlatformReadiness, Problem } from "../src/readiness/model.js";
import { EnvironmentError } from "../src/util/errors.js";
import { fakeCommands } from "./helpers/fake-commands.js";
import { scriptedPlatform } from "./helpers/scripted-platform.js";
import { scriptedScreen } from "./helpers/screen.js";

const SETUP_CLI = {
  version: "0.28.0",
  bin: "/Users/pat/.npm/_npx/1/node_modules/@guidepup/setup/bin/guidepup",
};
const GUIDEPUP_DIR = "/Users/pat/.npm/_npx/1/node_modules/@guidepup/guidepup";
const CHROMIUM = {
  name: "Chromium",
  path: "/Users/pat/Library/Caches/ms-playwright/chromium-1243/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
};
const VSCODE = "/Applications/Visual Studio Code.app";
/** voicecap, under a shell, under Visual Studio Code's terminal, as `ps -A -o pid=,ppid=,comm=` lists it. */
const PROCESSES = [
  `${process.pid} 900 node`,
  "  900   800 /bin/zsh",
  `  800     1 ${VSCODE}/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)`,
].join("\n");

const WELCOME_UNDO =
  "Turned off VoiceOver's welcome screen (to undo: defaults delete com.apple.VoiceOverTraining doNotShowSplashScreen).";
const APPLESCRIPT_UNDO =
  'Turned on VoiceOver\'s own "allow AppleScript" setting (to undo: defaults delete com.apple.VoiceOver4/default SCREnableAppleScript).';
const RESTART_LINE =
  "When Visual Studio Code reopens, run npx @icjia/voicecap setup again to finish.";
/** The Mac's checking notice, said as each check pass begins: a check can raise macOS's prompt. */
const CHECKING =
  'Checking this Mac. If macOS asks for access to control "System Events", click Allow.';

/** A scripted Mac: its quick checks answer from `script`, and it has the Mac's checking notice. */
function macPlatform(
  script: Parameters<typeof scriptedPlatform>[0],
  overrides: Partial<PlatformReadiness> = {},
) {
  return scriptedPlatform(script, { checkingNotice: [CHECKING], ...overrides });
}

const ACCESSIBILITY: Problem = {
  title: "Accessibility for Visual Studio Code",
  whatsWrong:
    "voicecap presses VoiceOver's keys through macOS's Accessibility features, which need your OK for Visual Studio Code.",
  fix: [
    "Open System Settings, then Privacy & Security, then Accessibility.",
    "Switch on Visual Studio Code. If it isn't listed, click + and choose it.",
    "Run npx @icjia/voicecap setup again.",
  ],
  setupHelps: true,
  open: SETTINGS_PAGES.accessibility,
};
const FULL_DISK_ACCESS: Problem = {
  title: "Full Disk Access for Visual Studio Code",
  whatsWrong:
    "voicecap keeps its VoiceOver settings apart from yours by linking them into a folder macOS protects, and macOS blocks Visual Studio Code from that folder.",
  fix: [
    "Open System Settings, then Privacy & Security, then Full Disk Access.",
    "Switch on Visual Studio Code. If it isn't listed, click + and choose it.",
    "When macOS asks, quit and reopen Visual Studio Code.",
    "Run npx @icjia/voicecap setup again.",
  ],
  setupHelps: true,
  open: SETTINGS_PAGES.fullDiskAccess,
  needsRestart: true,
};
/** VoiceOver has never been turned on for this user, so its own settings file isn't there yet. */
const NOT_SET_UP_FAIL: Check = {
  id: "fullDiskAccess",
  status: "FAIL",
  summary: "VoiceOver: not set up for this user yet",
  problem: {
    title: "Setting up VoiceOver for this user",
    whatsWrong:
      "voicecap links its VoiceOver settings in beside yours, and VoiceOver creates yours the first time it's turned on. It hasn't been turned on yet for this user.",
    fix: [
      "Press Command-F5 to turn VoiceOver on.",
      "When VoiceOver starts speaking, press Command-F5 again to turn it off.",
      "Run npx @icjia/voicecap setup again.",
    ],
    setupHelps: false,
  },
};
const ANOTHER_VOICECAP: Problem = {
  title: "Another voicecap",
  whatsWrong:
    "Another voicecap (process 4321, started 2026-09-28 11:02) is using VoiceOver on this computer, and only one can at a time.",
  fix: ["Wait for it to finish, or stop it.", "Run npx @icjia/voicecap setup again."],
  setupHelps: false,
};

const ACCESSIBILITY_FAIL: Check = {
  id: "accessibility",
  status: "FAIL",
  summary: "Accessibility: Visual Studio Code isn't allowed",
  problem: ACCESSIBILITY,
};
const ACCESSIBILITY_OK: Check = {
  id: "accessibility",
  status: "OK",
  summary: "Accessibility: Visual Studio Code is allowed",
};
const FULL_DISK_ACCESS_FAIL: Check = {
  id: "fullDiskAccess",
  status: "FAIL",
  summary: "Full Disk Access: Visual Studio Code isn't allowed",
  problem: FULL_DISK_ACCESS,
};
const OTHER_VOICECAP_FAIL: Check = {
  id: "otherVoicecap",
  status: "FAIL",
  summary: "Another voicecap is using VoiceOver",
  problem: ANOTHER_VOICECAP,
};
const LIVE_OK: Check = {
  id: "liveHear",
  status: "OK",
  summary: 'VoiceOver speaks: "voicecap doctor check, heading level 1"',
};
const LIVE_FAIL: Check = {
  id: "liveHear",
  status: "FAIL",
  summary: "VoiceOver started, but voicecap heard nothing from it",
  problem: {
    title: "VoiceOver's speech",
    whatsWrong: "VoiceOver started, but voicecap captured no speech from it.",
    fix: ["Run npx @icjia/voicecap setup again."],
    setupHelps: true,
  },
};
const NOTICE = [
  "The live test takes about 20 seconds. VoiceOver speaks and takes over the keyboard, so keep your hands off.",
  "If macOS asks whether Visual Studio Code can control VoiceOver, click Allow.",
];

/**
 * A Mac whose quick checks answer from `script` (ready, by default), with a live test that answers
 * `live` (or throws it). `signals` records the signal each live test was given.
 */
function macWith(
  script: Record<string, Check[]> = { accessibility: [ACCESSIBILITY_OK] },
  live: Check[] | Error = [LIVE_OK],
) {
  const signals: (AbortSignal | undefined)[] = [];
  const scripted = macPlatform(script, {
    readyTip: "Tip: turn on Do Not Disturb, so notifications don't interrupt VoiceOver.",
    liveTestNotice: NOTICE,
    liveTest: (signal) => {
      signals.push(signal);
      return live instanceof Error ? Promise.reject(live) : Promise.resolve(live);
    },
  });
  return { platform: scripted.platform, signals };
}

/**
 * runMacSetup with every command, installer, and prompt faked. `answers` are typed at its
 * questions; null means no one can answer (stdin isn't a terminal), so there's no prompter.
 */
function macSetupWith(
  options: {
    platform?: PlatformReadiness;
    answers?: string[] | null;
    installer?: number;
  } = {},
) {
  const commands = fakeCommands([
    [(file, args) => file === "defaults" && args[0] === "write", {}],
    [(file) => file === "ps", { stdout: PROCESSES }],
    [
      (file, args) => file === "plutil" && args[1] === "CFBundleDisplayName",
      { stdout: "Visual Studio Code\n" },
    ],
  ]);
  const installs: { script: string; args: string[]; cwd: string }[] = [];
  const opened: NonNullable<Problem["open"]>[] = [];
  let browsers = 0;
  const screen = scriptedScreen(options.answers ?? []);
  const deps: MacSetupDeps = {
    run: commands.run,
    setupCli: SETUP_CLI,
    guidepup: { dir: GUIDEPUP_DIR },
    runNode: (script, args, cwd) => {
      installs.push({ script, args, cwd });
      return Promise.resolve(options.installer ?? 0);
    },
    ensureBrowser: () => {
      browsers++;
      return Promise.resolve(CHROMIUM);
    },
    platform: () => Promise.resolve(options.platform ?? macPlatform({}).platform),
    open: (target) => {
      opened.push(target);
      return Promise.resolve(true);
    },
  };
  const prompter = options.answers === null ? null : screen.prompter;
  return {
    commands,
    installs,
    opened,
    browsers: () => browsers,
    screen,
    run: async () => {
      try {
        return await runMacSetup({ config: DEFAULT_CONFIG, logger: screen.logger, prompter }, deps);
      } finally {
        screen.close();
      }
    },
  };
}

/** The screen's lines. */
function lines(text: string): string[] {
  return text.split("\n");
}

/** How many times `part` appears in `text`. */
function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("runMacSetup", () => {
  it("installs Guidepup's VoiceOver files with voicecap's pinned installer, in Guidepup's folder", async () => {
    const setup = macSetupWith();
    expect(await setup.run()).toBe(0);
    expect(setup.installs).toEqual([
      { script: SETUP_CLI.bin, args: ["install", "voiceover"], cwd: GUIDEPUP_DIR },
    ]);
    expect(lines(setup.screen.text())[0]).toBe(
      "Installing Guidepup's VoiceOver files, with @guidepup/setup 0.28.0.",
    );
  });

  it("stops with the installer's exit code, pointing at proxies, before changing anything", async () => {
    const setup = macSetupWith({ installer: 3 });
    const error = await setup.run().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EnvironmentError);
    expect((error as Error).message).toBe(
      "Installing Guidepup's VoiceOver files failed (the installer exited with code 3); its messages are above. It downloads from github.com: behind a proxy, set HTTPS_PROXY (and NO_PROXY), then run voicecap setup again.",
    );
    expect(setup.commands.calls).toEqual([]);
    expect(setup.browsers()).toBe(0);
  });

  it("stops with the macOS version's problem before downloading or changing anything", async () => {
    const version: Check = {
      id: "version",
      status: "FAIL",
      summary: "macOS 11 isn't supported by voicecap's Guidepup",
      problem: {
        title: "macOS 11",
        whatsWrong:
          "voicecap drives VoiceOver through Guidepup 0.34.0, which supports macOS 12 through 26.",
        fix: ["Use a Mac with a supported version of macOS."],
        setupHelps: false,
      },
    };
    const setup = macSetupWith({ platform: macPlatform({ version: [version] }).platform });
    const error = await setup.run().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EnvironmentError);
    expect((error as Error).message).toMatch(/^Not ready: 1 problem\.\n\n1\. macOS 11\n/);
    expect((error as Error).message).toContain("Use a Mac with a supported version of macOS.");
    expect(setup.installs).toEqual([]);
    expect(setup.browsers()).toBe(0);
    expect(setup.commands.calls).toEqual([]);
    expect(setup.screen.text()).toBe("");
  });

  it("checks the macOS version first, then installs as usual when it's supported", async () => {
    /** How many installs there had been each time the version was checked. */
    const installsAtCheck: number[] = [];
    const platform = macPlatform(
      {},
      {
        quickChecks: () => [
          {
            id: "version",
            run: () => {
              installsAtCheck.push(setup.installs.length);
              return Promise.resolve({
                id: "version",
                status: "OK",
                summary: "macOS 26 is supported",
              });
            },
          },
        ],
      },
    ).platform;
    const setup = macSetupWith({ platform });
    expect(await setup.run()).toBe(0);
    // Before the installer, then again in the preflight.
    expect(installsAtCheck).toEqual([0, 1]);
  });

  it("makes sure there's a browser, after the VoiceOver files", async () => {
    const setup = macSetupWith();
    await setup.run();
    expect(setup.browsers()).toBe(1);
    expect(lines(setup.screen.text()).slice(0, 2)).toEqual([
      "Installing Guidepup's VoiceOver files, with @guidepup/setup 0.28.0.",
      `Browser: Chromium (${CHROMIUM.path}).`,
    ]);
  });

  it("turns off VoiceOver's welcome screen and turns on its AppleScript setting, saying how to undo each", async () => {
    const setup = macSetupWith();
    await setup.run();

    expect(setup.commands.calls.filter((call) => call.file === "defaults")).toEqual([
      {
        file: "defaults",
        args: ["write", "com.apple.VoiceOverTraining", "doNotShowSplashScreen", "-bool", "true"],
        timeoutMs: 10_000,
      },
      {
        file: "defaults",
        args: ["write", "com.apple.VoiceOver4/default", "SCREnableAppleScript", "-bool", "true"],
        timeoutMs: 10_000,
      },
    ]);
    expect(lines(setup.screen.text()).slice(2, 4)).toEqual([WELCOME_UNDO, APPLESCRIPT_UNDO]);
  });

  it("walks through each missing permission, naming the terminal app, then shows the preflight", async () => {
    const setup = macSetupWith({
      platform: macPlatform({ accessibility: [ACCESSIBILITY_FAIL, ACCESSIBILITY_OK] }).platform,
      answers: [""],
    });

    expect(await setup.run()).toBe(0);
    const text = setup.screen.text();
    expect(text).toContain(
      [
        APPLESCRIPT_UNDO,
        "",
        CHECKING,
        "",
        "Step 1 of 1: Accessibility for Visual Studio Code",
        "  voicecap presses VoiceOver's keys through macOS's Accessibility features, which need your OK for Visual Studio Code.",
        "  Opening System Settings at Privacy & Security, Accessibility…",
        "  Switch on Visual Studio Code. If it isn't listed, click + and choose it.",
        "Press Enter when it's on, or type s to skip: ",
        "  OK: Accessibility: Visual Studio Code is allowed",
        "",
        CHECKING,
        "",
        "voicecap preflight, ",
      ].join("\n"),
    );
    expect(text).toContain("Ready: this computer can run VoiceOver for voicecap.");
    expect(setup.opened).toEqual([SETTINGS_PAGES.accessibility]);
  });

  it("says it's checking, and to click Allow, as each check pass begins", async () => {
    // What the screen showed as each preflight began (machineInfo is each one's first call).
    const shown: string[] = [];
    let screenText = (): string => "";
    const platform = macPlatform(
      { accessibility: [ACCESSIBILITY_FAIL, ACCESSIBILITY_OK] },
      {
        machineInfo: () => {
          shown.push(screenText());
          return Promise.resolve({ lines: [], screenReader: "VoiceOver 10", system: "macOS 26" });
        },
      },
    ).platform;
    const setup = macSetupWith({ platform, answers: [""] });
    screenText = () => setup.screen.text();

    expect(await setup.run()).toBe(0);
    expect(shown).toHaveLength(2);
    // The first pass: straight after the settings. The last one: after the walk-through.
    expect(shown[0]?.endsWith(`${APPLESCRIPT_UNDO}\n\n${CHECKING}\n`)).toBe(true);
    expect(
      shown[1]?.endsWith(`  OK: Accessibility: Visual Studio Code is allowed\n\n${CHECKING}\n`),
    ).toBe(true);
  });

  it("returns 2 when Full Disk Access needs the terminal app to reopen, without the preflight", async () => {
    const setup = macSetupWith({
      platform: macPlatform({ fullDiskAccess: [FULL_DISK_ACCESS_FAIL] }).platform,
      answers: [""],
    });

    expect(await setup.run()).toBe(2);
    const text = setup.screen.text();
    expect(text.endsWith(`\n${RESTART_LINE}\n`)).toBe(true);
    expect(text).not.toContain("voicecap preflight");
    // Said before the one check pass there was: there's none after a walk that stops here.
    expect(occurrences(text, CHECKING)).toBe(1);
    expect(setup.screen.unused()).toEqual([]);
  });

  // Granting Full Disk Access can't create VoiceOver's own settings file, so this isn't a step:
  // no System Settings page, and no "reopen the app, then run setup again".
  it("lists VoiceOver not being set up for this user yet, opening nothing and saying nothing of a restart", async () => {
    const setup = macSetupWith({
      platform: macPlatform({ fullDiskAccess: [NOT_SET_UP_FAIL] }).platform,
      // Someone can answer, but there's nothing to ask: a question would end the input.
      answers: [],
    });

    expect(await setup.run()).toBe(2);
    const text = setup.screen.text();
    expect(text).toContain("  FAIL  VoiceOver: not set up for this user yet");
    expect(text).toContain(
      [
        "Not ready: 1 problem.",
        "",
        "1. Setting up VoiceOver for this user",
        "   What's wrong: voicecap links its VoiceOver settings in beside yours, and VoiceOver",
        "   creates yours the first time it's turned on. It hasn't been turned on yet for this user.",
        "   How to fix:",
        "     1. Press Command-F5 to turn VoiceOver on.",
        "     2. When VoiceOver starts speaking, press Command-F5 again to turn it off.",
        "     3. Run npx @icjia/voicecap setup again.",
      ].join("\n"),
    );
    expect(text).not.toContain("Step 1");
    expect(text).not.toContain(RESTART_LINE);
    expect(setup.opened).toEqual([]);
  });

  it("ends with the preflight and offers the live test when ready and someone can answer", async () => {
    const mac = macWith();
    const setup = macSetupWith({ platform: mac.platform, answers: ["n"] });

    expect(await setup.run()).toBe(0);
    const text = setup.screen.text();
    expect(text).toContain([APPLESCRIPT_UNDO, "", CHECKING, "", "voicecap preflight, "].join("\n"));
    expect(occurrences(text, CHECKING)).toBe(1);
    expect(text).toContain(
      [
        "Ready: this computer can run VoiceOver for voicecap.",
        "Tip: turn on Do Not Disturb, so notifications don't interrupt VoiceOver.",
        "",
        ...NOTICE,
        "Test VoiceOver now? [y/N]: n",
        "",
      ].join("\n"),
    );
    expect(text.endsWith("Test VoiceOver now? [y/N]: n\n")).toBe(true);
    expect(mac.signals).toEqual([]);
  });

  it("runs the live test on a yes and shows its checks", async () => {
    const mac = macWith();
    const setup = macSetupWith({ platform: mac.platform, answers: ["y"] });

    expect(await setup.run()).toBe(0);
    expect(setup.screen.text()).toContain(
      [
        "Test VoiceOver now? [y/N]: y",
        "",
        "Checks",
        '  OK    VoiceOver speaks: "voicecap doctor check, heading level 1"',
        "",
      ].join("\n"),
    );
    // Ctrl+C at the terminal stops the live test.
    expect(mac.signals).toHaveLength(1);
    expect(mac.signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("returns 2 with the problem when the live test fails", async () => {
    const setup = macSetupWith({
      platform: macWith(undefined, [LIVE_FAIL]).platform,
      answers: ["y"],
    });

    expect(await setup.run()).toBe(2);
    expect(setup.screen.text()).toContain(
      [
        "Checks",
        "  FAIL  VoiceOver started, but voicecap heard nothing from it",
        "",
        "Not ready: 1 problem.",
        "",
        "1. VoiceOver's speech",
      ].join("\n"),
    );
    // Setup is where this is, so its problems don't offer setup.
    expect(setup.screen.text()).not.toContain("which walks you through it");
  });

  it("returns 130 when Ctrl+C stops the live test", async () => {
    const setup = macSetupWith({
      platform: macWith(undefined, new InterruptedError()).platform,
      answers: ["y"],
    });

    expect(await setup.run()).toBe(130);
    expect(setup.screen.errors()).toBe(
      "Warning: Interrupted: the screen reader and the browser were shut down.\n",
    );
    // Nothing after the answer: no live checks, and no verdict.
    expect(setup.screen.text().endsWith("Test VoiceOver now? [y/N]: y\n")).toBe(true);
  });

  it("doesn't offer the live test when no one can answer", async () => {
    const mac = macWith();
    const setup = macSetupWith({ platform: mac.platform, answers: null });

    expect(await setup.run()).toBe(0);
    expect(setup.screen.text()).not.toContain("Test VoiceOver now?");
    expect(mac.signals).toEqual([]);
  });

  it("doesn't offer the live test when the computer isn't ready", async () => {
    const mac = macWith({ otherVoicecap: [OTHER_VOICECAP_FAIL] });
    // No answers: a question would end the input, and fail the test.
    const setup = macSetupWith({ platform: mac.platform, answers: [] });

    expect(await setup.run()).toBe(2);
    expect(setup.screen.text()).toContain("Not ready: 1 problem.");
    expect(setup.screen.text()).not.toContain("Test VoiceOver now?");
    expect(mac.signals).toEqual([]);
  });

  it("without anyone to answer, lists what's left once, in the preflight after the settings", async () => {
    const setup = macSetupWith({
      platform: macPlatform({ accessibility: [ACCESSIBILITY_FAIL] }).platform,
      answers: null,
    });

    expect(await setup.run()).toBe(2);
    const text = setup.screen.text();
    expect(text).toContain(`${APPLESCRIPT_UNDO}\n\n${CHECKING}\n\nvoicecap preflight, `);
    expect(occurrences(text, CHECKING)).toBe(1);
    expect(occurrences(text, "Not ready: 1 problem.")).toBe(1);
    expect(occurrences(text, "1. Accessibility for Visual Studio Code")).toBe(1);
    expect(text.indexOf("Not ready: 1 problem.")).toBeGreaterThan(
      text.indexOf("voicecap preflight, "),
    );
    expect(text).not.toContain("Step 1 of 1");
    expect(setup.opened).toEqual([]);
  });
});
