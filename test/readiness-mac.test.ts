import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { loadPlatformReadiness, type ReadinessOptions } from "../src/drivers/readiness.js";
import {
  APPLESCRIPT_ENABLED_FILE,
  automationDeniedProblem,
  permissionPromptProblem,
  SETTINGS_PAGES,
  type CommandResult,
  type ProcessRow,
} from "../src/drivers/voiceover/macos.js";
import {
  guidepupCacheDir,
  lockVoiceOver,
  macReadiness,
  realMacLiveDeps,
  voiceOverAsset,
  voiceOverLockFile,
  type MacReadinessDeps,
} from "../src/drivers/voiceover/readiness-mac.js";
import type { Check } from "../src/readiness/model.js";
import { EnvironmentError } from "../src/util/errors.js";
import { silentLogger } from "../src/util/log.js";
import { isoLocal } from "../src/util/time.js";
import { fakeCommands } from "./helpers/fake-commands.js";

const AGAIN = "npx @icjia/voicecap doctor";
const GIB = 1024 ** 3;
const HOME = "/Users/cschweda";
const PID = 4321;
const LOCK = "/Users/cschweda/Library/Caches/voicecap/voiceover.lock";
const CACHE_DIR = "/Users/cschweda/Library/Caches/guidepup";
const ASSET_FILE = `${CACHE_DIR}/voiceover/25/0.0.1-VoiceOver4/guidepup-voiceover-preferences-macos-26.dmg`;
/** VoiceOver's group container's Preferences folder, where Guidepup links voicecap's settings in. */
const GROUP_PREFS =
  "/Users/cschweda/Library/Group Containers/group.com.apple.VoiceOver/Library/Preferences";
/** Guidepup's other choice, when the group container isn't there. */
const USER_PREFS = "/Users/cschweda/Library/Preferences";
/** VoiceOver's own settings file, which it creates the first time it's turned on. */
const LOCAL_PLIST = "com.apple.VoiceOver4.local.plist";
const VSCODE_BUNDLE = "/Applications/Visual Studio Code.app";
const CHROME_PATH =
  "/Users/cschweda/Library/Caches/ms-playwright/chromium-1243/chrome-mac/Chromium.app/Contents/MacOS/Chromium";
const TRANSCRIPTS = "/Users/cschweda/webdev/voicecap-transcripts";

const MANIFEST = {
  screenReaders: [
    { id: "nvda", assets: [{ version: "0.2.1-2026.2", platformVersion: "win32" }] },
    {
      id: "voiceover",
      assets: [
        {
          version: "0.0.1-VoiceOver4",
          platformVersion: "21",
          asset: "guidepup-voiceover-preferences-macos-14.dmg",
        },
        {
          version: "0.0.1-VoiceOver4",
          platformVersion: "22",
          asset: "guidepup-voiceover-preferences-macos-14.dmg",
        },
        {
          version: "0.0.1-VoiceOver4",
          platformVersion: "23",
          asset: "guidepup-voiceover-preferences-macos-14.dmg",
        },
        {
          version: "0.0.1-VoiceOver4",
          platformVersion: "24",
          asset: "guidepup-voiceover-preferences-macos-15.dmg",
        },
        {
          version: "0.0.1-VoiceOver4",
          platformVersion: "25",
          asset: "guidepup-voiceover-preferences-macos-26.dmg",
        },
      ],
    },
  ],
};

const OPTIONS: Omit<ReadinessOptions, "platform"> = {
  config: DEFAULT_CONFIG,
  logger: silentLogger,
  env: {},
  cwd: "/Users/cschweda/webdev/voicecap",
  again: AGAIN,
};

type Answer = readonly [(file: string, args: string[]) => boolean, Partial<CommandResult>];

const VSCODE_CHAIN: ProcessRow[] = [
  { pid: PID, ppid: 1, command: `${VSCODE_BUNDLE}/Contents/MacOS/Electron` },
];
const NO_APP_CHAIN: ProcessRow[] = [{ pid: PID, ppid: PID, command: "zsh" }];

function psAnswer(rows: ProcessRow[]): Answer {
  const stdout = rows.map((row) => `  ${row.pid}  ${row.ppid}  ${row.command}`).join("\n");
  return [(file, args) => file === "ps" && args.includes("-A"), { stdout }];
}

function plutilAnswer(key: string, plistIncludes: string, value: string | null): Answer {
  return [
    (file, args) =>
      file === "plutil" && args[1] === key && (args[args.length - 1] ?? "").includes(plistIncludes),
    value === null ? { code: 1, stdout: "" } : { code: 0, stdout: value },
  ];
}

function accessibilityAnswer(trusted: boolean): Answer {
  return [
    (file, args) => file === "osascript" && args[0] === "-l",
    { code: 0, stdout: trusted ? "true" : "false" },
  ];
}

function systemEventsAnswer(result: Partial<CommandResult>): Answer {
  return [
    (file, args) =>
      file === "osascript" && args[0] === "-e" && (args[1] ?? "").includes("System Events"),
    result,
  ];
}

function welcomeAnswer(value: string | null): Answer {
  return [
    (file, args) =>
      file === "defaults" && args[0] === "read" && args[1] === "com.apple.VoiceOverTraining",
    value === null ? { code: 1, stdout: "" } : { code: 0, stdout: value },
  ];
}

function voiceOverRunningAnswer(running: boolean): Answer {
  return [
    (file) => file === "pgrep",
    running ? { code: 0, stdout: "1234\n" } : { code: 1, stdout: "" },
  ];
}

/** A computer with every check passing: VS Code, Full Disk Access OK, VoiceOver off. */
const BASE_ANSWERS: Answer[] = [
  psAnswer(VSCODE_CHAIN),
  plutilAnswer("CFBundleDisplayName", VSCODE_BUNDLE, "Visual Studio Code"),
  plutilAnswer("CFBundleShortVersionString", "VoiceOver.app", "10"),
  plutilAnswer("CFBundleVersion", "VoiceOver.app", "993"),
  plutilAnswer("CFBundleShortVersionString", "Chromium.app", "153.0.8010.12"),
  [(file, args) => file === "sw_vers" && args[0] === "-productVersion", { stdout: "26.6.2\n" }],
  [(file, args) => file === "sw_vers" && args[0] === "-buildVersion", { stdout: "25G83\n" }],
  [(file, args) => file === "uname" && args[0] === "-m", { stdout: "arm64\n" }],
  [
    (file) => file === "system_profiler",
    {
      stdout: JSON.stringify({
        SPHardwareDataType: [
          { machine_name: "Mac mini", machine_model: "Mac16,10", chip_type: "Apple M4" },
        ],
      }),
    },
  ],
  [(file) => file === "scutil", { stdout: "cschweda's Mac mini\n" }],
  [
    (file, args) => file === "defaults" && args[0] === "read" && args[1] === "-g",
    { stdout: "en_US\n" },
  ],
  welcomeAnswer("1"),
  accessibilityAnswer(true),
  systemEventsAnswer({ code: 0, stdout: "Visual Studio Code\n" }),
  voiceOverRunningAnswer(false),
];

function readyRun(extra: Answer[] = []) {
  return fakeCommands([...extra, ...BASE_ANSWERS]);
}

function fakeDeps(overrides: Partial<MacReadinessDeps> = {}): MacReadinessDeps {
  return {
    run: readyRun().run,
    pid: PID,
    home: HOME,
    env: {},
    nodeVersion: "22.22.2",
    voicecapVersion: "0.4.0",
    guidepup: { version: "0.34.0", manifest: MANIFEST },
    darwinMajor: 25,
    exists: (file) =>
      [APPLESCRIPT_ENABLED_FILE, ASSET_FILE, GROUP_PREFS, `${GROUP_PREFS}/${LOCAL_PLIST}`].includes(
        file,
      ),
    writeVoiceOverPrefs: () => Promise.resolve({ ok: true }),
    otherVoicecap: () => Promise.resolve(null),
    lockFile: LOCK,
    resolveBrowser: () => ({
      name: "Chrome for Testing",
      path: CHROME_PATH,
      playwrightBuild: true,
    }),
    transcripts: TRANSCRIPTS,
    totalmem: () => 16 * GIB,
    disk: () => Promise.resolve({ free: 72 * GIB, total: 228 * GIB }),
    ...overrides,
  };
}

function mac(overrides: Partial<MacReadinessDeps> = {}) {
  return macReadiness({ platform: "darwin", ...OPTIONS }, fakeDeps(overrides));
}

async function quickCheck(id: string, overrides: Partial<MacReadinessDeps> = {}) {
  const runner = mac(overrides)
    .quickChecks()
    .find((candidate) => candidate.id === id);
  if (!runner) throw new Error(`There's no quick check "${id}".`);
  return runner.run();
}

const CHECK_ORDER = [
  "version",
  "node",
  "terminal",
  "assets",
  "appleScript",
  "welcome",
  "accessibility",
  "fullDiskAccess",
  "systemEvents",
  "otherVoicecap",
  "browser",
  "voiceOverOn",
];

describe("Mac readiness", () => {
  it("is for VoiceOver, which can't run real audits yet, and warns before the live test", () => {
    const platform = mac();
    expect(platform.screenReader).toBe("VoiceOver");
    expect(platform.cannotRunYet).toBe(
      "voicecap can't run VoiceOver yet: that comes with its VoiceOver driver. For now, run this command on a Windows computer.",
    );
    expect(platform.readyTip).toBe(
      "Tip: turn on Do Not Disturb, so notifications don't interrupt VoiceOver.",
    );
    expect(platform.liveTestNotice).toEqual([
      "The live test takes about 20 seconds. VoiceOver speaks and takes over the keyboard, so keep your hands off.",
      "If macOS asks whether the app voicecap runs in can control VoiceOver, click Allow.",
    ]);
    // The System Events check can raise macOS's prompt, which names the app itself.
    expect(platform.checkingNotice).toEqual([
      'Checking this Mac. If macOS asks for access to control "System Events", click Allow.',
    ]);
  });

  it("runs its quick checks in order", () => {
    expect(
      mac()
        .quickChecks()
        .map((runner) => runner.id),
    ).toEqual(CHECK_ORDER);
  });

  it("is what voicecap loads on darwin, with the real live test (never run here)", async () => {
    const platform = await loadPlatformReadiness({ platform: "darwin", ...OPTIONS });
    expect(platform.screenReader).toBe("VoiceOver");
    expect(platform.quickChecks().map((runner) => runner.id)).toEqual(CHECK_ORDER);
    expect(platform.liveTest).toEqual(expect.any(Function));
  });

  it("has no live test when its deps give none", () => {
    expect(mac().liveTest).toBeNull();
  });

  it("runs deps.liveTest with the terminal app's name, forwarding the abort signal", async () => {
    const controller = new AbortController();
    const given: { app?: string; signal?: AbortSignal } = {};
    const result: Check[] = [{ id: "liveHear", status: "OK", summary: "VoiceOver speaks" }];
    const platform = mac({
      liveTest: (app, signal) => {
        given.app = app;
        given.signal = signal;
        return Promise.resolve(result);
      },
    });
    expect(await platform.liveTest?.(controller.signal)).toEqual(result);
    expect(given.app).toBe("Visual Studio Code");
    expect(given.signal).toBe(controller.signal);
  });

  it("gives the live test the terminal app the quick checks found, without looking again", async () => {
    const commands = readyRun();
    const given: { app?: string } = {};
    const platform = mac({
      run: commands.run,
      liveTest: (app) => {
        given.app = app;
        return Promise.resolve([]);
      },
    });
    await platform
      .quickChecks()
      .find((runner) => runner.id === "terminal")
      ?.run();
    await platform.liveTest?.();
    expect(given.app).toBe("Visual Studio Code");
    expect(commands.calls.filter((call) => call.file === "ps")).toHaveLength(1);
  });

  it('gives the live test "the app voicecap runs in" when there is no terminal app', async () => {
    const given: { app?: string } = {};
    const platform = mac({
      run: readyRun([psAnswer(NO_APP_CHAIN)]).run,
      liveTest: (app) => {
        given.app = app;
        return Promise.resolve([]);
      },
    });
    await platform.liveTest?.();
    expect(given.app).toBe("the app voicecap runs in");
  });

  it("looks up the terminal app once and reuses it for later checks", async () => {
    const commands = readyRun();
    const runners = mac({ run: commands.run }).quickChecks();
    await runners.find((r) => r.id === "terminal")?.run();
    await runners.find((r) => r.id === "accessibility")?.run();
    await runners.find((r) => r.id === "fullDiskAccess")?.run();
    await runners.find((r) => r.id === "systemEvents")?.run();
    expect(commands.calls.filter((call) => call.file === "ps")).toHaveLength(1);
  });

  it("is safe to call a later check even when the terminal check never ran first", async () => {
    const check = await quickCheck("systemEvents");
    expect(check.status).toBe("OK");
  });
});

// The VoiceOver lock goes when the process exits (lock-file.ts), and a hard exit's hook may still
// be quitting or starting VoiceOver: the lock must outlast it, or another voicecap could take
// VoiceOver meanwhile.
describe("the Mac live test's real exit hook", () => {
  it("runs ahead of every exit listener already added, such as the VoiceOver lock's", () => {
    const deps = realMacLiveDeps({ platform: "darwin", ...OPTIONS }, LOCK, "Visual Studio Code");
    const lockRelease = () => {};
    const hook = () => {};
    process.once("exit", lockRelease);
    const remove = deps.onExit(hook);
    try {
      const listeners = process.listeners("exit");
      expect(listeners[0]).toBe(hook);
      expect(listeners).toContain(lockRelease);
    } finally {
      remove();
      process.removeListener("exit", lockRelease);
    }
    expect(process.listeners("exit")).not.toContain(hook);
    expect(process.listeners("exit")).not.toContain(lockRelease);
  });
});

describe("Mac readiness: liveTestNotice", () => {
  it("names the fallback before any check has run", () => {
    const platform = mac();
    expect(platform.liveTestNotice[1]).toBe(
      "If macOS asks whether the app voicecap runs in can control VoiceOver, click Allow.",
    );
  });

  it("names the cached terminal app once the terminal check has run", async () => {
    const platform = mac();
    await platform
      .quickChecks()
      .find((runner) => runner.id === "terminal")
      ?.run();
    expect(platform.liveTestNotice).toEqual([
      "The live test takes about 20 seconds. VoiceOver speaks and takes over the keyboard, so keep your hands off.",
      "If macOS asks whether Visual Studio Code can control VoiceOver, click Allow.",
    ]);
  });

  it("keeps the fallback when no terminal app was found", async () => {
    const platform = mac({ run: readyRun([psAnswer(NO_APP_CHAIN)]).run });
    await platform
      .quickChecks()
      .find((runner) => runner.id === "terminal")
      ?.run();
    expect(platform.liveTestNotice[1]).toBe(
      "If macOS asks whether the app voicecap runs in can control VoiceOver, click Allow.",
    );
  });

  it("shares one terminal cache across separate quickChecks() calls, not a fresh one each time", async () => {
    const commands = readyRun();
    const platform = mac({ run: commands.run });
    await platform
      .quickChecks()
      .find((runner) => runner.id === "terminal")
      ?.run();
    // A second, independent quickChecks() call: its "accessibility" runner should reuse the same
    // cached lookup rather than asking `ps` again.
    await platform
      .quickChecks()
      .find((runner) => runner.id === "accessibility")
      ?.run();
    expect(commands.calls.filter((call) => call.file === "ps")).toHaveLength(1);
    expect(platform.liveTestNotice[1]).toBe(
      "If macOS asks whether Visual Studio Code can control VoiceOver, click Allow.",
    );
  });
});

describe("Mac machine info", () => {
  it("describes this computer the way the design spec's sample does", async () => {
    const info = await mac().machineInfo();
    expect(info.lines).toEqual([
      { label: "Computer", value: "cschweda's Mac mini, user cschweda" },
      {
        label: "Model",
        value: "Mac mini (Mac16,10), Apple M4, 16 GB memory, 72 GB free of 228 GB",
      },
      { label: "System", value: "macOS 26.6.2 (25G83), Apple silicon" },
      { label: "Terminal app", value: "Visual Studio Code (macOS gives permissions to this app)" },
      { label: "Node.js", value: "22.22.2" },
      { label: "voicecap", value: "0.4.0, with @guidepup/guidepup 0.34.0" },
      { label: "Screen reader", value: "VoiceOver 10 (build 993)" },
      { label: "Browser", value: "Chrome for Testing 153.0.8010.12 (Playwright's)" },
      { label: "Language", value: "English (United States)" },
      { label: "Transcripts", value: TRANSCRIPTS },
      { label: "Guidepup files", value: CACHE_DIR },
      {
        label: "Browser path",
        value:
          "~/Library/Caches/ms-playwright/chromium-1243/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
      },
    ]);
    expect(info.screenReader).toBe("VoiceOver 10");
    expect(info.system).toBe("macOS 26.6.2");
  });

  it("says when there's no browser, and has no browser path line then", async () => {
    const info = await mac({
      resolveBrowser: () => {
        throw new Error("Google Chrome isn't installed.");
      },
    }).machineInfo();
    expect(info.lines.find((line) => line.label === "Browser")?.value).toBe("none found");
    expect(info.lines.map((line) => line.label)).not.toContain("Browser path");
  });

  it("says unknown when there's no language", async () => {
    const info = await mac({
      run: readyRun([
        [
          (file, args) => file === "defaults" && args[0] === "read" && args[1] === "-g",
          { code: 1, stdout: "" },
        ],
      ]).run,
    }).machineInfo();
    expect(info.lines.find((line) => line.label === "Language")?.value).toBe("unknown");
  });

  it("says none found for the terminal app when voicecap isn't running inside one", async () => {
    const info = await mac({ run: readyRun([psAnswer(NO_APP_CHAIN)]).run }).machineInfo();
    expect(info.lines.find((line) => line.label === "Terminal app")?.value).toBe("none found");
  });
});

describe("voiceOverLockFile and guidepupCacheDir", () => {
  it("is <home>/Library/Caches/voicecap/voiceover.lock", () => {
    expect(voiceOverLockFile(HOME)).toBe(LOCK);
  });

  it("is <home>/Library/Caches/guidepup by default", () => {
    expect(guidepupCacheDir({}, HOME)).toBe(CACHE_DIR);
  });

  it("resolves GUIDEPUP_SCREEN_READERS_PATH when it's set", () => {
    expect(guidepupCacheDir({ GUIDEPUP_SCREEN_READERS_PATH: "/tmp/guidepup" }, HOME)).toBe(
      "/tmp/guidepup",
    );
  });
});

// A real lock file in a temporary folder.
describe("lockVoiceOver", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-voiceover-lock-test-"));
    file = path.join(dir, "voiceover.lock");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("takes the lock, and gives it back", async () => {
    const release = await lockVoiceOver(file);
    expect(existsSync(file)).toBe(true);
    await release();
    expect(existsSync(file)).toBe(false);
  });

  it("refuses while another voicecap on this computer holds it, naming it and the lock", async () => {
    // process.ppid is alive for the whole test, and isn't this process.
    const startedAt = isoLocal(new Date());
    await writeFile(
      file,
      `${JSON.stringify({ pid: process.ppid, host: os.hostname(), startedAt })}\n`,
    );
    const taking = lockVoiceOver(file);
    await expect(taking).rejects.toBeInstanceOf(EnvironmentError);
    await expect(taking).rejects.toThrow(
      new EnvironmentError(
        `Another voicecap (process ${process.ppid}, started ${startedAt}) is using VoiceOver on this computer, and only one can at a time. Wait for it to finish, or stop it first. If no other voicecap is running, delete its lock: ${file}`,
      ),
    );
  });

  it("refuses a lock taken on another computer, which it can't tell is stale", async () => {
    await writeFile(
      file,
      `${JSON.stringify({ pid: 12345, host: "another-mac.local", startedAt: isoLocal(new Date()) })}\n`,
    );
    await expect(lockVoiceOver(file)).rejects.toThrow(
      new EnvironmentError(
        `The VoiceOver lock ${file} was taken on another computer (another-mac.local). If no voicecap is running here, delete it.`,
      ),
    );
  });
});

describe("voiceOverAsset", () => {
  it("finds Darwin 25's asset in the cache folder", () => {
    expect(voiceOverAsset(MANIFEST, 25, CACHE_DIR)).toEqual({
      supported: ["12", "13", "14", "15", "26"],
      file: ASSET_FILE,
    });
  });

  it("gives file: null for an unsupported Darwin major", () => {
    expect(voiceOverAsset(MANIFEST, 30, CACHE_DIR)).toEqual({
      supported: ["12", "13", "14", "15", "26"],
      file: null,
    });
  });
});

describe("Mac quick checks: version", () => {
  it("passes a supported macOS version", async () => {
    expect(await quickCheck("version")).toEqual({
      id: "version",
      status: "OK",
      summary: "macOS 26 is supported",
    });
  });

  it("fails an unsupported Darwin major, naming macOS 12 through 26", async () => {
    expect(await quickCheck("version", { darwinMajor: 20 })).toEqual({
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
    });
  });
});

describe("Mac quick checks: node", () => {
  it("delegates to nodeCheck", async () => {
    expect(await quickCheck("node")).toEqual({
      id: "node",
      status: "OK",
      summary: "Node.js 22.22.2",
    });
  });
});

describe("Mac quick checks: terminal", () => {
  it("passes when a terminal app is found", async () => {
    expect(await quickCheck("terminal")).toEqual({
      id: "terminal",
      status: "OK",
      summary: "Terminal app: Visual Studio Code",
    });
  });

  it("fails when no ancestor is inside an app bundle, as over SSH", async () => {
    const check = await quickCheck("terminal", { run: readyRun([psAnswer(NO_APP_CHAIN)]).run });
    expect(check).toEqual({
      id: "terminal",
      status: "FAIL",
      summary: "No terminal app found",
      problem: {
        title: "The terminal app",
        whatsWrong:
          "macOS gives the permissions VoiceOver automation needs to an app, such as Terminal or Visual Studio Code, and voicecap isn't running inside one (over SSH, for example).",
        fix: [`Open Terminal (or Visual Studio Code) on this Mac and run ${AGAIN} there.`],
        setupHelps: false,
      },
    });
  });
});

describe("Mac quick checks: assets", () => {
  it("passes when VoiceOver's files for Guidepup are installed", async () => {
    expect(await quickCheck("assets")).toEqual({
      id: "assets",
      status: "OK",
      summary: "VoiceOver's files for Guidepup are installed",
    });
  });

  it("fails when they aren't, naming the cache folder", async () => {
    const check = await quickCheck("assets", { exists: () => false });
    expect(check).toEqual({
      id: "assets",
      status: "FAIL",
      summary: "VoiceOver's files for Guidepup aren't installed",
      problem: {
        title: "VoiceOver's files for Guidepup",
        whatsWrong: `Guidepup starts VoiceOver with its own settings file, which isn't in ${CACHE_DIR} yet.`,
        fix: ["Run npx @icjia/voicecap setup."],
        setupHelps: true,
      },
    });
  });

  it("fails when this Darwin major has no asset at all (file: null)", async () => {
    const check = await quickCheck("assets", { darwinMajor: 30 });
    expect(check.status).toBe("FAIL");
  });
});

describe("Mac quick checks: appleScript", () => {
  it("passes when VoiceOver's AppleScript control file exists", async () => {
    expect(await quickCheck("appleScript")).toEqual({
      id: "appleScript",
      status: "OK",
      summary: "VoiceOver can be controlled by AppleScript",
    });
  });

  it("fails, pointing at VoiceOver Utility, when it doesn't", async () => {
    const check = await quickCheck("appleScript", { exists: () => false });
    expect(check).toEqual({
      id: "appleScript",
      status: "FAIL",
      summary: "VoiceOver can't be controlled by AppleScript",
      problem: {
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
      },
    });
  });
});

describe("Mac quick checks: welcome", () => {
  it("passes when the welcome screen default is set", async () => {
    expect(await quickCheck("welcome")).toEqual({
      id: "welcome",
      status: "OK",
      summary: "VoiceOver's welcome screen is off",
    });
  });

  it("fails when it isn't set", async () => {
    const check = await quickCheck("welcome", { run: readyRun([welcomeAnswer("0")]).run });
    expect(check).toEqual({
      id: "welcome",
      status: "FAIL",
      summary: "VoiceOver's welcome screen is on",
      problem: {
        title: "VoiceOver's welcome screen",
        whatsWrong:
          "VoiceOver shows a welcome screen when it starts, which would stop voicecap's run.",
        fix: ["Run npx @icjia/voicecap setup, which turns it off."],
        setupHelps: true,
      },
    });
  });

  it("fails when defaults has never seen the key at all", async () => {
    const check = await quickCheck("welcome", { run: readyRun([welcomeAnswer(null)]).run });
    expect(check.status).toBe("FAIL");
  });
});

describe("Mac quick checks: accessibility", () => {
  it("passes when the terminal app is trusted", async () => {
    expect(await quickCheck("accessibility")).toEqual({
      id: "accessibility",
      status: "OK",
      summary: "Accessibility: Visual Studio Code is allowed",
    });
  });

  it("fails, naming System Settings, when it isn't", async () => {
    const check = await quickCheck("accessibility", {
      run: readyRun([accessibilityAnswer(false)]).run,
    });
    expect(check).toEqual({
      id: "accessibility",
      status: "FAIL",
      summary: "Accessibility: Visual Studio Code isn't allowed",
      problem: {
        title: "Accessibility for Visual Studio Code",
        whatsWrong:
          "voicecap presses VoiceOver's keys through macOS's Accessibility features, which need your OK for Visual Studio Code.",
        fix: [
          "Open System Settings, then Privacy & Security, then Accessibility.",
          "Switch on Visual Studio Code. If it isn't listed, click + and choose it.",
          `Run ${AGAIN} again.`,
        ],
        setupHelps: true,
        open: SETTINGS_PAGES.accessibility,
      },
    });
  });

  it('says "the app voicecap runs in" when there is no terminal app', async () => {
    const check = await quickCheck("accessibility", {
      run: readyRun([psAnswer(NO_APP_CHAIN), accessibilityAnswer(false)]).run,
    });
    expect(check.summary).toBe("Accessibility: the app voicecap runs in isn't allowed");
    expect(check.problem?.title).toBe("Accessibility for the app voicecap runs in");
  });
});

// Guidepup 0.34.0's start links voicecap's VoiceOver settings into VoiceOver's group container
// when there is one, else into ~/Library/Preferences (getPreferencesDirectory), and first needs
// VoiceOver's own settings file there (ensureLocalPreferencesExist). The check predicts exactly
// that, then tries creating a file there, which macOS 26 allows only with Full Disk Access.
describe("Mac quick checks: fullDiskAccess", () => {
  /** A Mac where only these of VoiceOver's settings folders and files exist, and the writes tried. */
  function prefs(present: string[], write?: MacReadinessDeps["writeVoiceOverPrefs"]) {
    const writes: string[] = [];
    const overrides: Partial<MacReadinessDeps> = {
      exists: (file) => [APPLESCRIPT_ENABLED_FILE, ASSET_FILE, ...present].includes(file),
      writeVoiceOverPrefs: (dir) => {
        writes.push(dir);
        return write ? write(dir) : Promise.resolve({ ok: true });
      },
    };
    return { overrides, writes };
  }

  const FULL_DISK_ACCESS = {
    title: "Full Disk Access for Visual Studio Code",
    whatsWrong:
      "voicecap keeps its VoiceOver settings apart from yours by linking them into a folder macOS protects, and macOS blocks Visual Studio Code from that folder.",
    fix: [
      "Open System Settings, then Privacy & Security, then Full Disk Access.",
      "Switch on Visual Studio Code. If it isn't listed, click + and choose it.",
      "When macOS asks, quit and reopen Visual Studio Code.",
      `Run ${AGAIN} again.`,
    ],
    setupHelps: true,
    open: SETTINGS_PAGES.fullDiskAccess,
    needsRestart: true,
  };
  const NOT_SET_UP: Check = {
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
        `Run ${AGAIN} again.`,
      ],
      setupHelps: false,
    },
  };

  it("passes when voicecap can create a file in VoiceOver's group container", async () => {
    const mac = prefs([GROUP_PREFS, `${GROUP_PREFS}/${LOCAL_PLIST}`]);
    expect(await quickCheck("fullDiskAccess", mac.overrides)).toEqual({
      id: "fullDiskAccess",
      status: "OK",
      summary: "Full Disk Access: Visual Studio Code is allowed",
    });
    expect(mac.writes).toEqual([GROUP_PREFS]);
  });

  it("says Full Disk Access isn't needed when there's no group container, and VoiceOver's settings are in ~/Library/Preferences", async () => {
    const mac = prefs([`${USER_PREFS}/${LOCAL_PLIST}`]);
    expect(await quickCheck("fullDiskAccess", mac.overrides)).toEqual({
      id: "fullDiskAccess",
      status: "OK",
      summary: "Full Disk Access: not needed on this Mac",
    });
    expect(mac.writes).toEqual([USER_PREFS]);
  });

  it("says VoiceOver isn't set up for this user yet when neither folder has its settings, writing nothing", async () => {
    const mac = prefs([]);
    expect(await quickCheck("fullDiskAccess", mac.overrides)).toEqual(NOT_SET_UP);
    expect(mac.writes).toEqual([]);
  });

  it("says the same when the group container has no settings file, whatever ~/Library/Preferences has", async () => {
    const mac = prefs([GROUP_PREFS, `${USER_PREFS}/${LOCAL_PLIST}`]);
    expect(await quickCheck("fullDiskAccess", mac.overrides)).toEqual(NOT_SET_UP);
    expect(mac.writes).toEqual([]);
  });

  it("fails with EPERM, naming the app, System Settings, and needsRestart", async () => {
    const check = await quickCheck("fullDiskAccess", {
      writeVoiceOverPrefs: () =>
        Promise.resolve({ ok: false, code: "EPERM", message: "operation not permitted" }),
    });
    expect(check).toEqual({
      id: "fullDiskAccess",
      status: "FAIL",
      summary: "Full Disk Access: Visual Studio Code isn't allowed",
      problem: FULL_DISK_ACCESS,
    });
  });

  it("gives the same problem for any other error, with its code in the summary", async () => {
    const check = await quickCheck("fullDiskAccess", {
      writeVoiceOverPrefs: () =>
        Promise.resolve({ ok: false, code: "EACCES", message: "permission denied" }),
    });
    expect(check).toEqual({
      id: "fullDiskAccess",
      status: "FAIL",
      summary: "Full Disk Access: couldn't write to VoiceOver's settings folder (EACCES)",
      problem: FULL_DISK_ACCESS,
    });
  });
});

describe("Mac quick checks: systemEvents", () => {
  it("passes when the terminal app can control System Events", async () => {
    expect(await quickCheck("systemEvents")).toEqual({
      id: "systemEvents",
      status: "OK",
      summary: "Visual Studio Code can control System Events",
    });
  });

  it("fails when denied, with automationDeniedProblem", async () => {
    const check = await quickCheck("systemEvents", {
      run: readyRun([
        systemEventsAnswer({
          code: 1,
          stderr: "execution error: Not authorized to send Apple events to System Events. (-1743)",
        }),
      ]).run,
    });
    expect(check).toEqual({
      id: "systemEvents",
      status: "FAIL",
      summary: "Visual Studio Code isn't allowed to control System Events",
      problem: automationDeniedProblem("Visual Studio Code", "System Events", AGAIN),
    });
  });

  it("fails with no-answer when a prompt may still be unanswered", async () => {
    const check = await quickCheck("systemEvents", {
      run: readyRun([systemEventsAnswer({ code: null, signal: "SIGTERM", stderr: "" })]).run,
    });
    expect(check).toEqual({
      id: "systemEvents",
      status: "FAIL",
      summary: "No answer from System Events in 60 seconds",
      problem: permissionPromptProblem("Visual Studio Code", "System Events", AGAIN),
    });
  });

  // As when osascript can't even start: no exit code, no signal, and nothing written.
  it("says what's wrong even when the failure comes without a word", async () => {
    const check = await quickCheck("systemEvents", {
      run: readyRun([systemEventsAnswer({ code: null, signal: null, stderr: "" })]).run,
    });
    expect(check).toEqual({
      id: "systemEvents",
      status: "FAIL",
      summary: "System Events didn't answer",
      problem: {
        title: "System Events",
        whatsWrong: "System Events didn't answer voicecap's question, and macOS gave no reason.",
        fix: [`Run ${AGAIN} again.`],
        setupHelps: false,
      },
    });
  });

  it("fails with the message on any other failure", async () => {
    const check = await quickCheck("systemEvents", {
      run: readyRun([systemEventsAnswer({ code: 1, stderr: "osascript: something else broke" })])
        .run,
    });
    expect(check).toEqual({
      id: "systemEvents",
      status: "FAIL",
      summary: "System Events didn't answer: osascript: something else broke",
      problem: {
        title: "System Events",
        whatsWrong: "osascript: something else broke",
        fix: [`Run ${AGAIN} again.`],
        setupHelps: false,
      },
    });
  });
});

describe("Mac quick checks: otherVoicecap", () => {
  it("passes when no other voicecap holds the lock", async () => {
    expect(await quickCheck("otherVoicecap")).toEqual({
      id: "otherVoicecap",
      status: "OK",
      summary: "No other voicecap is using VoiceOver",
    });
  });

  it("fails, naming the lock file, when another voicecap holds it", async () => {
    const check = await quickCheck("otherVoicecap", {
      otherVoicecap: () =>
        Promise.resolve({
          pid: 999,
          host: "cschwedas-Mac-mini",
          startedAt: "2026-09-28T08:00:00-05:00",
        }),
    });
    expect(check.status).toBe("FAIL");
    expect(check.problem?.fix).toContain(
      `If no other voicecap is running, delete its lock: ${LOCK}`,
    );
  });
});

describe("Mac quick checks: browser", () => {
  it("passes the browser voicecap would launch", async () => {
    expect(await quickCheck("browser")).toEqual({
      id: "browser",
      status: "OK",
      summary: "Browser: Chrome for Testing",
    });
  });

  it("fails when there's no browser", async () => {
    const check = await quickCheck("browser", {
      resolveBrowser: () => {
        throw new Error("Google Chrome isn't installed.");
      },
    });
    expect(check.status).toBe("FAIL");
    expect(check.summary).toBe("No browser for voicecap");
  });
});

describe("Mac quick checks: voiceOverOn", () => {
  it("says VoiceOver is off, as OK, when it isn't running", async () => {
    expect(await quickCheck("voiceOverOn")).toEqual({
      id: "voiceOverOn",
      status: "OK",
      summary: "VoiceOver is off",
    });
  });

  it("warns, without failing, when VoiceOver is already on", async () => {
    const check = await quickCheck("voiceOverOn", {
      run: readyRun([voiceOverRunningAnswer(true)]).run,
    });
    expect(check).toEqual({
      id: "voiceOverOn",
      status: "WARN",
      summary: "VoiceOver is on: voicecap will use it, then turn it back on with your settings",
    });
  });
});
