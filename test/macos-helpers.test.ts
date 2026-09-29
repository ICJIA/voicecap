import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  accessibilityTrusted,
  APPLESCRIPT_ENABLED_FILE,
  askVoiceOver,
  automationDeniedProblem,
  bundleVersion,
  canWriteVoiceOverPrefs,
  detachGuidepupPreferences,
  guidepupPrefsDir,
  macSystem,
  messageOr,
  openTarget,
  parseProcessTable,
  pause,
  pauseSync,
  permissionPromptProblem,
  PROBE_TIMEOUT_MS,
  raiseProcess,
  readDefault,
  runCommand,
  runCommandSync,
  SETTINGS_PAGES,
  SHORT_TIMEOUT_MS,
  startVoiceOver,
  stopVoiceOver,
  stopVoiceOverSync,
  runAppleScript,
  systemEventsAccess,
  terminalApp,
  terminalAppBundle,
  voiceOverPrefsDir,
  voiceOverRunning,
  voiceOverVersion,
  VOICEOVER_LOCAL_PREFS,
  VOICEOVER_STARTER,
  waitForVoiceOver,
  waitUntilVoiceOverRunsSync,
  writeDefault,
  type CommandResult,
  type ProcessRow,
  type RunCommandSync,
} from "../src/drivers/voiceover/macos.js";
import { EnvironmentError } from "../src/util/errors.js";
import { fakeCommands } from "./helpers/fake-commands.js";

const AGAIN = "npx @icjia/voicecap doctor";

// The one function that starts real processes. Its child here is node itself, never an OS command.
describe("runCommand", () => {
  const node = process.execPath;
  /** A child that would run for a minute. */
  const LINGERS = ["-e", "setTimeout(() => {}, 60000)"];

  it("resolves a zero exit with what the command wrote", async () => {
    expect(await runCommand(node, ["-e", "process.stdout.write('hello')"])).toEqual({
      code: 0,
      signal: null,
      stdout: "hello",
      stderr: "",
    });
  });

  it("resolves a non-zero exit with its code and what it wrote, rather than rejecting", async () => {
    expect(
      await runCommand(node, ["-e", "process.stderr.write('broke'); process.exitCode = 3"]),
    ).toEqual({ code: 3, signal: null, stdout: "", stderr: "broke" });
  });

  it("kills a command that outlives its time, saying a signal ended it", async () => {
    const result = await runCommand(node, LINGERS, { timeoutMs: 200 });
    expect(result.code).toBeNull();
    expect(result.signal).not.toBeNull();
  });

  it("kills a command at once when its signal aborts, resolving like a killed one", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const running = runCommand(node, LINGERS, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    expect(await running).toMatchObject({ code: null, signal: "SIGTERM" });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("starts nothing when its signal has aborted already", async () => {
    const started = Date.now();
    expect(
      await runCommand(node, ["-e", "process.stdout.write('ran')"], {
        signal: AbortSignal.abort(),
      }),
    ).toEqual({ code: null, signal: "SIGTERM", stdout: "", stderr: "" });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

// For an exit hook: its child here is node too.
describe("runCommandSync", () => {
  const node = process.execPath;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-run-sync-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A script for node that writes an empty `file`, after `ms`. */
  const writes = (file: string, ms = 0) =>
    `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(file)}, ""), ${ms})`;

  it("waits for the command before it returns", () => {
    const file = path.join(dir, "waited");
    runCommandSync(node, ["-e", writes(file)]);
    expect(existsSync(file)).toBe(true);
  });

  it("gives the command's exit code once it has finished", () => {
    expect(runCommandSync(node, ["-e", ""])).toBe(0);
    expect(runCommandSync(node, ["-e", "process.exitCode = 3"])).toBe(3);
  });

  it("only starts a detached command, which carries on by itself, and gives no exit code", async () => {
    const file = path.join(dir, "detached");
    expect(runCommandSync(node, ["-e", writes(file, 300)], { detached: true })).toBeNull();
    expect(existsSync(file)).toBe(false);
    const deadline = Date.now() + 10_000;
    while (!existsSync(file) && Date.now() < deadline) await pause(20);
    expect(existsSync(file)).toBe(true);
  });

  it("never throws, even for a command that can't start, which gives no exit code", () => {
    const missing = path.join(dir, "voicecap-no-such-program");
    expect(runCommandSync(missing, [])).toBeNull();
    expect(runCommandSync(missing, [], { detached: true })).toBeNull();
  });
});

describe("pauseSync", () => {
  it("blocks for the time it's given, without an OS command", () => {
    const started = Date.now();
    pauseSync(50);
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  });
});

// For the exit hook: stopVoiceOver's work, with synchronous commands and waits only.
describe("stopVoiceOverSync", () => {
  const PKILL = {
    file: "pkill",
    args: ["-15", "-f", "VoiceOver.app/Contents/MacOS/VoiceOver launchd -s"],
  };
  const PGREP = { file: "pgrep", args: ["-f", "VoiceOver launchd -s"] };

  /** A Mac whose pgrep finds VoiceOver for its first `found` checks, answering pgrep with `code`. */
  function syncMac(found: number, code: number | null = 1) {
    const calls: { file: string; args: string[] }[] = [];
    const waits: number[] = [];
    let checks = 0;
    const runSync: RunCommandSync = (file, args) => {
      calls.push({ file, args });
      if (file !== "pgrep") return 0;
      return ++checks <= found ? 0 : code;
    };
    const sleep = (ms: number) => {
      waits.push(ms);
    };
    return { runSync, sleep, calls, waits };
  }

  it("stops VoiceOver's process with pkill, then checks every 100 ms until pgrep no longer finds it", () => {
    const mac = syncMac(2);
    expect(stopVoiceOverSync(mac.runSync, mac.sleep)).toBe(true);
    expect(mac.calls).toEqual([PKILL, PGREP, PGREP, PGREP]);
    expect(mac.waits).toEqual([100, 100]);
  });

  it("doesn't wait at all when VoiceOver is gone at once", () => {
    const mac = syncMac(0);
    expect(stopVoiceOverSync(mac.runSync, mac.sleep)).toBe(true);
    expect(mac.calls).toEqual([PKILL, PGREP]);
    expect(mac.waits).toEqual([]);
  });

  it("gives up after 5 seconds, saying VoiceOver is still on", () => {
    const mac = syncMac(Infinity);
    expect(stopVoiceOverSync(mac.runSync, mac.sleep)).toBe(false);
    expect(mac.calls.filter((call) => call.file === "pgrep")).toHaveLength(51);
    expect(mac.waits).toEqual(Array<number>(50).fill(100));
  });

  it("takes a pgrep that doesn't run as VoiceOver gone, as voiceOverRunning does", () => {
    const mac = syncMac(0, null);
    expect(stopVoiceOverSync(mac.runSync, mac.sleep)).toBe(true);
    expect(mac.waits).toEqual([]);
  });
});

// For the exit hook: waiting for a VoiceOver that's still starting, until a time on a clock.
describe("waitUntilVoiceOverRunsSync", () => {
  const PGREP = { file: "pgrep", args: ["-f", "VoiceOver launchd -s"] };

  /** A Mac whose VoiceOver appears at `appearsAt` on a clock that each wait moves on. */
  function startingMac(appearsAt: number, startClock = 0) {
    let clock = startClock;
    const calls: { file: string; args: string[] }[] = [];
    const waits: number[] = [];
    const runSync: RunCommandSync = (file, args) => {
      calls.push({ file, args });
      return clock >= appearsAt ? 0 : 1;
    };
    const sleep = (ms: number) => {
      waits.push(ms);
      clock += ms;
    };
    return { runSync, sleep, now: () => clock, calls, waits };
  }

  it("checks every 100 ms until VoiceOver is running, then says so", () => {
    const mac = startingMac(300);
    expect(waitUntilVoiceOverRunsSync(mac.runSync, 10_000, mac.now, mac.sleep)).toBe(true);
    expect(mac.calls).toEqual([PGREP, PGREP, PGREP, PGREP]);
    expect(mac.waits).toEqual([100, 100, 100]);
  });

  it("gives up once the clock reaches its end, saying VoiceOver isn't running", () => {
    const mac = startingMac(Infinity, 9_750);
    expect(waitUntilVoiceOverRunsSync(mac.runSync, 10_000, mac.now, mac.sleep)).toBe(false);
    expect(mac.waits).toEqual([100, 100, 100]);
    expect(mac.calls).toHaveLength(4);
  });

  it("checks once, without waiting, when its time is up already", () => {
    const mac = startingMac(Infinity, 12_000);
    expect(waitUntilVoiceOverRunsSync(mac.runSync, 10_000, mac.now, mac.sleep)).toBe(false);
    expect(mac.calls).toEqual([PGREP]);
    expect(mac.waits).toEqual([]);
  });
});

describe("pause", () => {
  it("waits the time it's given", async () => {
    const started = Date.now();
    await pause(50);
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  });

  it("ends early, without rejecting, when its signal aborts", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const waiting = pause(60_000, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(waiting).resolves.toBeUndefined();
    await expect(pause(60_000, AbortSignal.abort())).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("runAppleScript", () => {
  it("gives osascript the abort signal, so Ctrl+C kills it", async () => {
    const commands = fakeCommands([[() => true, { code: 0, stdout: "x\n" }]]);
    const signal = new AbortController().signal;
    await runAppleScript(commands.run, 'return "x"', { timeoutMs: SHORT_TIMEOUT_MS, signal });
    expect(commands.calls[0]?.signal).toBe(signal);
  });

  it("takes osascript killed by Ctrl+C as no answer", async () => {
    const commands = fakeCommands([[() => true, { code: null, signal: "SIGTERM", stderr: "" }]]);
    const answer = await runAppleScript(commands.run, 'tell application "x" to y', {
      timeoutMs: PROBE_TIMEOUT_MS,
      signal: AbortSignal.abort(),
    });
    expect(answer).toEqual({ ok: false, reason: "no-answer", message: "" });
  });

  it("classifies a denied Apple event by its -1743 error", async () => {
    const commands = fakeCommands([
      [
        () => true,
        {
          code: 1,
          stderr: "execution error: Not authorized to send Apple events to System Events. (-1743)",
        },
      ],
    ]);
    const answer = await runAppleScript(commands.run, 'tell application "x" to y', {
      timeoutMs: SHORT_TIMEOUT_MS,
    });
    expect(answer).toEqual({
      ok: false,
      reason: "denied",
      message: "execution error: Not authorized to send Apple events to System Events. (-1743)",
    });
  });

  it("classifies a run killed at its timeout as no-answer", async () => {
    const commands = fakeCommands([[() => true, { code: null, signal: "SIGTERM", stderr: "" }]]);
    const answer = await runAppleScript(commands.run, 'tell application "x" to y', {
      timeoutMs: SHORT_TIMEOUT_MS,
    });
    expect(answer).toEqual({ ok: false, reason: "no-answer", message: "" });
  });

  it("classifies stderr containing -1712 as no-answer, even without a signal", async () => {
    const commands = fakeCommands([
      [() => true, { code: 1, stderr: "Apple Event timed out. (-1712)" }],
    ]);
    const answer = await runAppleScript(commands.run, 'tell application "x" to y', {
      timeoutMs: SHORT_TIMEOUT_MS,
    });
    expect(answer).toEqual({
      ok: false,
      reason: "no-answer",
      message: "Apple Event timed out. (-1712)",
    });
  });

  it("classifies any other stderr as failed, with the trimmed message", async () => {
    const commands = fakeCommands([
      [() => true, { code: 1, stderr: "  osascript: syntax error  \n" }],
    ]);
    const answer = await runAppleScript(commands.run, "broken", { timeoutMs: SHORT_TIMEOUT_MS });
    expect(answer).toEqual({ ok: false, reason: "failed", message: "osascript: syntax error" });
  });

  it("gives the trimmed stdout on a clean exit", async () => {
    const commands = fakeCommands([[() => true, { code: 0, stdout: "x\n" }]]);
    const answer = await runAppleScript(commands.run, 'return "x"', {
      timeoutMs: SHORT_TIMEOUT_MS,
    });
    expect(answer).toEqual({ ok: true, value: "x" });
  });

  it("wraps AppleScript in its own timeout block, and kills the process 5 seconds later", async () => {
    const commands = fakeCommands([[() => true, { code: 0, stdout: "" }]]);
    await runAppleScript(commands.run, 'tell application "Foo" to bar', {
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    expect(commands.calls).toEqual([
      {
        file: "osascript",
        args: ["-e", 'with timeout of 60 seconds\ntell application "Foo" to bar\nend timeout'],
        timeoutMs: 65_000,
      },
    ]);
  });

  it("sends JavaScript unwrapped, with -l JavaScript", async () => {
    const commands = fakeCommands([[() => true, { code: 0, stdout: "" }]]);
    await runAppleScript(commands.run, "1 + 1", { timeoutMs: SHORT_TIMEOUT_MS, javascript: true });
    expect(commands.calls).toEqual([
      { file: "osascript", args: ["-l", "JavaScript", "-e", "1 + 1"], timeoutMs: 15_000 },
    ]);
  });
});

describe("parseProcessTable", () => {
  it("reads pid, ppid, and command, though lines lead with spaces and comm has spaces in it", () => {
    const stdout = [
      "    1     0 /sbin/launchd",
      "  100     1 /Applications/Visual Studio Code.app/Contents/MacOS/Code",
      "",
    ].join("\n");
    expect(parseProcessTable(stdout)).toEqual([
      { pid: 1, ppid: 0, command: "/sbin/launchd" },
      { pid: 100, ppid: 1, command: "/Applications/Visual Studio Code.app/Contents/MacOS/Code" },
    ]);
  });

  it("skips blank lines and gives an empty list for empty output", () => {
    expect(parseProcessTable("")).toEqual([]);
    expect(parseProcessTable("\n\n")).toEqual([]);
  });
});

describe("terminalAppBundle", () => {
  it("names the outer app when a nested helper is the first bundle found, walking up from VS Code's terminal", () => {
    const rows: ProcessRow[] = [
      { pid: 1, ppid: 2, command: "zsh" },
      { pid: 2, ppid: 3, command: "claude" },
      { pid: 3, ppid: 4, command: "zsh" },
      {
        pid: 4,
        ppid: 5,
        command:
          "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper",
      },
      { pid: 5, ppid: 6, command: "/Applications/Visual Studio Code.app/Contents/MacOS/Code" },
    ];
    expect(terminalAppBundle(rows, 1)).toBe("/Applications/Visual Studio Code.app");
  });

  it("names Terminal.app", () => {
    const rows: ProcessRow[] = [
      {
        pid: 10,
        ppid: 1,
        command: "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal",
      },
    ];
    expect(terminalAppBundle(rows, 10)).toBe("/System/Applications/Utilities/Terminal.app");
  });

  it("names iTerm.app", () => {
    const rows: ProcessRow[] = [
      { pid: 20, ppid: 1, command: "/Applications/iTerm.app/Contents/MacOS/iTerm2" },
    ];
    expect(terminalAppBundle(rows, 20)).toBe("/Applications/iTerm.app");
  });

  it("gives null when no ancestor is inside an app bundle, as over SSH", () => {
    const rows: ProcessRow[] = [
      { pid: 30, ppid: 31, command: "sshd-session" },
      { pid: 31, ppid: 1, command: "zsh" },
    ];
    expect(terminalAppBundle(rows, 30)).toBeNull();
  });

  it("gives null for an unknown starting pid, without looping forever on a cycle", () => {
    expect(terminalAppBundle([], 999)).toBeNull();
    const cyclic: ProcessRow[] = [
      { pid: 1, ppid: 2, command: "a" },
      { pid: 2, ppid: 1, command: "b" },
    ];
    expect(terminalAppBundle(cyclic, 1)).toBeNull();
  });
});

const VSCODE_BUNDLE = "/Applications/Visual Studio Code.app";
const VSCODE_CHAIN: ProcessRow[] = [
  { pid: 1, ppid: 2, command: "zsh" },
  { pid: 2, ppid: 1, command: `${VSCODE_BUNDLE}/Contents/MacOS/Code` },
];
const SSH_CHAIN: ProcessRow[] = [
  { pid: 1, ppid: 2, command: "sshd-session" },
  { pid: 2, ppid: 1, command: "zsh" },
];

function psAnswer(
  rows: ProcessRow[],
): [(file: string, args: string[]) => boolean, { stdout: string }] {
  const stdout = rows.map((row) => `  ${row.pid}  ${row.ppid}  ${row.command}`).join("\n");
  return [(file, args) => file === "ps" && args.includes("-A"), { stdout }];
}

function plutilAnswer(
  key: string,
  plist: string,
  value: string | null,
): [(file: string, args: string[]) => boolean, { code: number; stdout: string }] {
  return [
    (file, args) => file === "plutil" && args[1] === key && args[args.length - 1] === plist,
    value === null ? { code: 1, stdout: "" } : { code: 0, stdout: value },
  ];
}

describe("terminalApp", () => {
  const plist = `${VSCODE_BUNDLE}/Contents/Info.plist`;

  it("names the app from CFBundleDisplayName when it's there", async () => {
    const commands = fakeCommands([
      psAnswer(VSCODE_CHAIN),
      plutilAnswer("CFBundleDisplayName", plist, "Visual Studio Code"),
    ]);
    expect(await terminalApp(commands.run, 1)).toEqual({
      name: "Visual Studio Code",
      bundle: VSCODE_BUNDLE,
    });
  });

  it("falls back to CFBundleName when there's no CFBundleDisplayName", async () => {
    const commands = fakeCommands([
      psAnswer(VSCODE_CHAIN),
      plutilAnswer("CFBundleDisplayName", plist, null),
      plutilAnswer("CFBundleName", plist, "Code"),
    ]);
    expect(await terminalApp(commands.run, 1)).toEqual({ name: "Code", bundle: VSCODE_BUNDLE });
  });

  it("falls back to the bundle's file name without .app when plutil gives neither", async () => {
    const commands = fakeCommands([
      psAnswer(VSCODE_CHAIN),
      plutilAnswer("CFBundleDisplayName", plist, null),
      plutilAnswer("CFBundleName", plist, null),
    ]);
    expect(await terminalApp(commands.run, 1)).toEqual({
      name: "Visual Studio Code",
      bundle: VSCODE_BUNDLE,
    });
  });

  it("gives null when no ancestor is inside an app bundle", async () => {
    const commands = fakeCommands([psAnswer(SSH_CHAIN)]);
    expect(await terminalApp(commands.run, 1)).toBeNull();
  });
});

describe("accessibilityTrusted", () => {
  it("is true when AXIsProcessTrusted answers true", async () => {
    const commands = fakeCommands([[() => true, { code: 0, stdout: "true\n" }]]);
    expect(await accessibilityTrusted(commands.run)).toBe(true);
    expect(commands.calls).toEqual([
      {
        file: "osascript",
        args: [
          "-l",
          "JavaScript",
          "-e",
          'ObjC.import("ApplicationServices"); $.AXIsProcessTrusted()',
        ],
        timeoutMs: SHORT_TIMEOUT_MS + 5000,
      },
    ]);
  });

  it("is false when AXIsProcessTrusted answers false", async () => {
    const commands = fakeCommands([[() => true, { code: 0, stdout: "false\n" }]]);
    expect(await accessibilityTrusted(commands.run)).toBe(false);
  });

  it("is false when the probe fails outright", async () => {
    const commands = fakeCommands([[() => true, { code: 1, stderr: "boom" }]]);
    expect(await accessibilityTrusted(commands.run)).toBe(false);
  });
});

describe("systemEventsAccess and askVoiceOver", () => {
  it("asks System Events who's frontmost, waiting PROBE_TIMEOUT_MS", async () => {
    const commands = fakeCommands([[() => true, { code: 0, stdout: "Finder\n" }]]);
    const answer = await systemEventsAccess(commands.run);
    expect(answer).toEqual({ ok: true, value: "Finder" });
    expect(commands.calls).toEqual([
      {
        file: "osascript",
        args: [
          "-e",
          'with timeout of 60 seconds\ntell application "System Events" to get name of first process whose frontmost is true\nend timeout',
        ],
        timeoutMs: PROBE_TIMEOUT_MS + 5000,
      },
    ]);
  });

  it("asks VoiceOver for the text under the cursor, waiting PROBE_TIMEOUT_MS", async () => {
    const commands = fakeCommands([[() => true, { code: 0, stdout: "Home\n" }]]);
    const answer = await askVoiceOver(commands.run);
    expect(answer).toEqual({ ok: true, value: "Home" });
    expect(commands.calls).toEqual([
      {
        file: "osascript",
        args: [
          "-e",
          'with timeout of 60 seconds\ntell application "VoiceOver" to get text under cursor of vo cursor\nend timeout',
        ],
        timeoutMs: PROBE_TIMEOUT_MS + 5000,
      },
    ]);
  });

  it("lets Ctrl+C stop VoiceOver's 60-second question", async () => {
    const commands = fakeCommands([[() => true, { code: 0, stdout: "Home\n" }]]);
    const signal = new AbortController().signal;
    await askVoiceOver(commands.run, signal);
    expect(commands.calls[0]?.signal).toBe(signal);
  });
});

describe("voiceOverPrefsDir", () => {
  it("is under the home folder's Group Containers", () => {
    expect(voiceOverPrefsDir("/Users/cschweda")).toBe(
      "/Users/cschweda/Library/Group Containers/group.com.apple.VoiceOver/Library/Preferences",
    );
  });
});

describe("guidepupPrefsDir", () => {
  const GROUP = voiceOverPrefsDir("/Users/cschweda");

  it("is VoiceOver's group container's Preferences folder when it exists, as Guidepup chooses", () => {
    expect(guidepupPrefsDir("/Users/cschweda", (file) => file === GROUP)).toEqual({
      dir: GROUP,
      groupContainer: true,
    });
  });

  it("is the home folder's Library/Preferences when it doesn't", () => {
    expect(guidepupPrefsDir("/Users/cschweda", () => false)).toEqual({
      dir: "/Users/cschweda/Library/Preferences",
      groupContainer: false,
    });
  });

  it("needs VoiceOver's own settings file there, the one Guidepup's start checks for", () => {
    expect(VOICEOVER_LOCAL_PREFS).toBe("com.apple.VoiceOver4.local.plist");
  });
});

describe("canWriteVoiceOverPrefs", () => {
  it("writes and removes a marker file named with this process's pid", async () => {
    const written: string[] = [];
    const removed: string[] = [];
    const result = await canWriteVoiceOverPrefs("/Users/cschweda/prefs", {
      writeFile: (file) => {
        written.push(file);
        return Promise.resolve();
      },
      rm: (file) => {
        removed.push(file);
        return Promise.resolve();
      },
    });
    expect(result).toEqual({ ok: true });
    expect(written).toEqual([`/Users/cschweda/prefs/.voicecap-check-${process.pid}`]);
    expect(removed).toEqual([`/Users/cschweda/prefs/.voicecap-check-${process.pid}`]);
  });

  it("gives EPERM when the write fails, as macOS 26 does without Full Disk Access", async () => {
    const error = Object.assign(new Error("Operation not permitted"), { code: "EPERM" });
    const result = await canWriteVoiceOverPrefs("/Users/cschweda/prefs", {
      writeFile: () => Promise.reject(error),
      rm: () => Promise.resolve(),
    });
    expect(result).toMatchObject({ ok: false, code: "EPERM" });
  });
});

describe("APPLESCRIPT_ENABLED_FILE", () => {
  it("is the file VoiceOver Utility's AppleScript checkbox creates", () => {
    expect(APPLESCRIPT_ENABLED_FILE).toBe(
      "/private/var/db/Accessibility/.VoiceOverAppleScriptEnabled",
    );
  });
});

describe("readDefault and writeDefault", () => {
  it("reads a default, trimmed", async () => {
    const commands = fakeCommands([[() => true, { code: 0, stdout: "1\n" }]]);
    expect(
      await readDefault(commands.run, "com.apple.VoiceOverTraining", "doNotShowSplashScreen"),
    ).toBe("1");
    expect(commands.calls).toEqual([
      {
        file: "defaults",
        args: ["read", "com.apple.VoiceOverTraining", "doNotShowSplashScreen"],
        timeoutMs: SHORT_TIMEOUT_MS,
      },
    ]);
  });

  it("gives null when defaults exits non-zero, e.g. the key isn't set", async () => {
    const commands = fakeCommands([[() => true, { code: 1, stderr: "does not exist" }]]);
    expect(await readDefault(commands.run, "com.example", "missing")).toBeNull();
  });

  it("writes a bool default", async () => {
    const commands = fakeCommands([[() => true, { code: 0 }]]);
    await writeDefault(commands.run, "com.apple.VoiceOverTraining", "doNotShowSplashScreen", true);
    expect(commands.calls).toEqual([
      {
        file: "defaults",
        args: ["write", "com.apple.VoiceOverTraining", "doNotShowSplashScreen", "-bool", "true"],
        timeoutMs: SHORT_TIMEOUT_MS,
      },
    ]);
  });

  it("throws EnvironmentError when defaults write fails", async () => {
    const commands = fakeCommands([[() => true, { code: 1, stderr: "Permission denied" }]]);
    await expect(
      writeDefault(commands.run, "com.apple.VoiceOverTraining", "doNotShowSplashScreen", false),
    ).rejects.toThrow(EnvironmentError);
  });
});

describe("voiceOverRunning", () => {
  it("is true when pgrep finds VoiceOver's launchd process", async () => {
    const commands = fakeCommands([[() => true, { code: 0, stdout: "1234\n" }]]);
    expect(await voiceOverRunning(commands.run)).toBe(true);
    expect(commands.calls).toEqual([
      { file: "pgrep", args: ["-f", "VoiceOver launchd -s"], timeoutMs: SHORT_TIMEOUT_MS },
    ]);
  });

  it("is false when pgrep finds nothing", async () => {
    const commands = fakeCommands([[() => true, { code: 1, stdout: "" }]]);
    expect(await voiceOverRunning(commands.run)).toBe(false);
  });

  /** pgrep killed by a signal (a closed terminal's SIGHUP) its first `kills` times, then `then`. */
  function killedPgrep(kills: number, then: Partial<CommandResult>) {
    let asked = 0;
    return fakeCommands([
      [() => ++asked <= kills, { code: null, signal: "SIGHUP" }],
      [() => true, then],
    ]);
  }

  // A signal that reaches voicecap's whole process group kills pgrep too, and its non-zero exit
  // would read as "VoiceOver is off".
  it("asks again when a signal killed pgrep, and goes by the real answer", async () => {
    const running = killedPgrep(2, { code: 0, stdout: "1234\n" });
    expect(await voiceOverRunning(running.run)).toBe(true);
    expect(running.calls).toHaveLength(3);
    const off = killedPgrep(1, { code: 1 });
    expect(await voiceOverRunning(off.run)).toBe(false);
    expect(off.calls).toHaveLength(2);
  });

  it("asks at most 3 times more, then goes by the last answer, as before", async () => {
    const commands = killedPgrep(Infinity, { code: 0 });
    expect(await voiceOverRunning(commands.run)).toBe(false);
    expect(commands.calls).toHaveLength(4);
  });
});

describe("startVoiceOver", () => {
  it("is the real VoiceOverStarter path", () => {
    expect(VOICEOVER_STARTER).toBe(
      "/System/Library/CoreServices/VoiceOver.app/Contents/MacOS/VoiceOverStarter",
    );
  });

  it("runs VoiceOverStarter with no arguments", async () => {
    const commands = fakeCommands([[() => true, { code: 0 }]]);
    await startVoiceOver(commands.run);
    expect(commands.calls).toEqual([
      {
        file: "/System/Library/CoreServices/VoiceOver.app/Contents/MacOS/VoiceOverStarter",
        args: [],
        timeoutMs: SHORT_TIMEOUT_MS,
      },
    ]);
  });
});

/** pgrep finds VoiceOver for its first `running` checks, then no longer. */
function goesAfter(running: number) {
  let checks = 0;
  return fakeCommands([
    [(file) => file === "pgrep" && ++checks <= running, { code: 0, stdout: "1234\n" }],
    [(file) => file === "pgrep", { code: 1 }],
  ]);
}

/** pgrep finds nothing for its first `stopped` checks, then finds VoiceOver. */
function startsAfter(stopped: number) {
  let checks = 0;
  return fakeCommands([
    [(file) => file === "pgrep" && ++checks <= stopped, { code: 1 }],
    [(file) => file === "pgrep", { code: 0, stdout: "1234\n" }],
  ]);
}

/** A sleep that returns at once, noting each wait. */
function recordedSleep() {
  const waited: number[] = [];
  const sleep = (ms: number) => {
    waited.push(ms);
    return Promise.resolve();
  };
  return { waited, sleep };
}

describe("waitForVoiceOver", () => {
  it("checks every 250 ms until VoiceOver is gone, then says it got there", async () => {
    const commands = goesAfter(2);
    const { waited, sleep } = recordedSleep();
    expect(await waitForVoiceOver(commands.run, "stopped", 5000, sleep)).toBe(true);
    expect(commands.calls).toHaveLength(3);
    expect(waited).toEqual([250, 250]);
  });

  it("waits for VoiceOver to be running the same way, and doesn't wait at all when it already is", async () => {
    const late = startsAfter(3);
    const lateSleep = recordedSleep();
    expect(await waitForVoiceOver(late.run, "running", 10_000, lateSleep.sleep)).toBe(true);
    expect(lateSleep.waited).toEqual([250, 250, 250]);

    const already = startsAfter(0);
    const alreadySleep = recordedSleep();
    expect(await waitForVoiceOver(already.run, "running", 10_000, alreadySleep.sleep)).toBe(true);
    expect(already.calls).toHaveLength(1);
    expect(alreadySleep.waited).toEqual([]);
  });

  it("gives up once its time is spent, and says it didn't get there", async () => {
    const commands = goesAfter(Infinity);
    const { waited, sleep } = recordedSleep();
    expect(await waitForVoiceOver(commands.run, "stopped", 1000, sleep)).toBe(false);
    expect(waited).toEqual([250, 250, 250, 250]);
    expect(commands.calls).toHaveLength(5);
  });
});

describe("stopVoiceOver", () => {
  const pgrep = {
    file: "pgrep",
    args: ["-f", "VoiceOver launchd -s"],
    timeoutMs: SHORT_TIMEOUT_MS,
  };

  it("asks VoiceOver to quit, stops its process with pkill, and says so once pgrep no longer finds it", async () => {
    let checks = 0;
    const commands = fakeCommands([
      [(file) => file === "osascript", { code: 0 }],
      // VoiceOver quit already, so pkill finds nothing to stop: that isn't an error.
      [(file) => file === "pkill", { code: 1 }],
      // Its process takes two checks to go.
      [(file) => file === "pgrep" && ++checks <= 2, { code: 0, stdout: "1234\n" }],
      [(file) => file === "pgrep", { code: 1 }],
    ]);
    const { waited, sleep } = recordedSleep();
    expect(await stopVoiceOver(commands.run, sleep)).toBe(true);
    expect(commands.calls).toEqual([
      {
        file: "osascript",
        args: [
          "-e",
          'with timeout of 10 seconds\ntell application "VoiceOver" to quit\nend timeout',
        ],
        timeoutMs: 15_000,
      },
      // Guidepup 0.34.0's own pattern for stopping VoiceOver (terminateVoiceOverProcess), which
      // is more specific than the one pgrep checks with (its isRunning).
      {
        file: "pkill",
        args: ["-15", "-f", "VoiceOver.app/Contents/MacOS/VoiceOver launchd -s"],
        timeoutMs: SHORT_TIMEOUT_MS,
      },
      pgrep,
      pgrep,
      pgrep,
    ]);
    expect(waited).toEqual([250, 250]);
  });

  it("still stops VoiceOver's process when VoiceOver refuses to quit, as when voicecap may not control it", async () => {
    const commands = fakeCommands([
      [
        (file) => file === "osascript",
        { code: 1, stderr: "Not authorized to send Apple events to VoiceOver. (-1743)" },
      ],
      [(file) => file === "pkill", { code: 0 }],
      [(file) => file === "pgrep", { code: 1 }],
    ]);
    await stopVoiceOver(commands.run, recordedSleep().sleep);
    expect(commands.calls.map((call) => call.file)).toEqual(["osascript", "pkill", "pgrep"]);
  });

  it("gives up after 5 seconds, without throwing, and says VoiceOver is still on when it doesn't go", async () => {
    const commands = fakeCommands([
      [(file) => file === "osascript" || file === "pkill", { code: 0 }],
      [(file) => file === "pgrep", { code: 0, stdout: "1234\n" }],
    ]);
    const { waited, sleep } = recordedSleep();
    expect(await stopVoiceOver(commands.run, sleep)).toBe(false);
    expect(waited.reduce((total, ms) => total + ms, 0)).toBe(5000);
    expect(new Set(waited)).toEqual(new Set([250]));
  });
});

describe("detachGuidepupPreferences", () => {
  it("detaches Guidepup's settings disk image with hdiutil", async () => {
    const commands = fakeCommands([[(file) => file === "hdiutil", { code: 0 }]]);
    await detachGuidepupPreferences(commands.run);
    expect(commands.calls).toEqual([
      {
        file: "hdiutil",
        args: ["detach", "/Volumes/GuidepupVoiceOverPreferences"],
        timeoutMs: SHORT_TIMEOUT_MS,
      },
    ]);
  });

  it("doesn't mind hdiutil failing, as it does when the image isn't attached", async () => {
    const commands = fakeCommands([
      [(file) => file === "hdiutil", { code: 1, stderr: "hdiutil: detach failed - No such file" }],
    ]);
    await expect(detachGuidepupPreferences(commands.run)).resolves.toBeUndefined();
  });
});

describe("raiseProcess", () => {
  const noSleep = () => Promise.resolve();

  it("succeeds when the target pid ends up frontmost", async () => {
    const commands = fakeCommands([
      [(file, args) => args.some((arg) => arg.includes("set frontmost")), { code: 0, stdout: "" }],
      [
        (file, args) => args.some((arg) => arg.includes("get unix id")),
        { code: 0, stdout: "1234\n" },
      ],
    ]);
    expect(await raiseProcess(commands.run, 1234, noSleep)).toEqual({ ok: true });
  });

  it("reports the pid that's actually frontmost when it isn't the target", async () => {
    const commands = fakeCommands([
      [(file, args) => args.some((arg) => arg.includes("set frontmost")), { code: 0, stdout: "" }],
      [
        (file, args) => args.some((arg) => arg.includes("get unix id")),
        { code: 0, stdout: "99\n" },
      ],
    ]);
    const result = await raiseProcess(commands.run, 1234, noSleep);
    expect(result).toMatchObject({ ok: false, frontmostPid: 99 });
  });

  it("waits 300 ms between raising and checking, via the injected sleep hook", async () => {
    const commands = fakeCommands([
      [(file, args) => args.some((arg) => arg.includes("set frontmost")), { code: 0, stdout: "" }],
      [(file, args) => args.some((arg) => arg.includes("get unix id")), { code: 0, stdout: "5\n" }],
    ]);
    const waited: number[] = [];
    await raiseProcess(commands.run, 5, (ms) => {
      waited.push(ms);
      return Promise.resolve();
    });
    expect(waited).toEqual([300]);
  });

  it("really waits about 300 ms by default, with a real timer", async () => {
    const commands = fakeCommands([
      [(file, args) => args.some((arg) => arg.includes("set frontmost")), { code: 0, stdout: "" }],
      [(file, args) => args.some((arg) => arg.includes("get unix id")), { code: 0, stdout: "7\n" }],
    ]);
    const started = Date.now();
    await raiseProcess(commands.run, 7);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  it("gives the abort signal to both questions to System Events and to the wait between", async () => {
    const commands = fakeCommands([
      [(file, args) => args.some((arg) => arg.includes("set frontmost")), { code: 0, stdout: "" }],
      [(file, args) => args.some((arg) => arg.includes("get unix id")), { code: 0, stdout: "5\n" }],
    ]);
    const signal = new AbortController().signal;
    const waits: (AbortSignal | undefined)[] = [];
    await raiseProcess(
      commands.run,
      5,
      (_ms, waitSignal) => {
        waits.push(waitSignal);
        return Promise.resolve();
      },
      signal,
    );
    expect(commands.calls.map((call) => call.signal)).toEqual([signal, signal]);
    expect(waits).toEqual([signal]);
  });

  it("gives no frontmost pid when raising itself is denied", async () => {
    const commands = fakeCommands([
      [
        (file, args) => args.some((arg) => arg.includes("set frontmost")),
        { code: 1, stderr: "Not authorized to send Apple events (-1743)" },
      ],
    ]);
    const result = await raiseProcess(commands.run, 1234, noSleep);
    expect(result).toMatchObject({ ok: false, frontmostPid: null });
  });
});

describe("SETTINGS_PAGES", () => {
  it("has the three Privacy & Security addresses", () => {
    expect(SETTINGS_PAGES).toEqual({
      accessibility: {
        kind: "settings",
        url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        page: "Accessibility",
      },
      fullDiskAccess: {
        kind: "settings",
        url: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
        page: "Full Disk Access",
      },
      automation: {
        kind: "settings",
        url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
        page: "Automation",
      },
    });
  });
});

describe("openTarget", () => {
  it("opens a settings page by its URL, and says it did", async () => {
    const commands = fakeCommands([[() => true, { code: 0 }]]);
    expect(await openTarget(commands.run, SETTINGS_PAGES.accessibility)).toBe(true);
    expect(commands.calls).toEqual([
      {
        file: "open",
        args: ["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"],
        timeoutMs: SHORT_TIMEOUT_MS,
      },
    ]);
  });

  it("opens an app by name, and says it did", async () => {
    const commands = fakeCommands([[() => true, { code: 0 }]]);
    expect(await openTarget(commands.run, { kind: "app", name: "VoiceOver Utility" })).toBe(true);
    expect(commands.calls).toEqual([
      { file: "open", args: ["-a", "VoiceOver Utility"], timeoutMs: SHORT_TIMEOUT_MS },
    ]);
  });

  it("says it didn't when open fails", async () => {
    const commands = fakeCommands([
      [() => true, { code: 1, stderr: "Unable to find application named 'VoiceOver Utility'" }],
    ]);
    expect(await openTarget(commands.run, SETTINGS_PAGES.accessibility)).toBe(false);
    expect(await openTarget(commands.run, { kind: "app", name: "VoiceOver Utility" })).toBe(false);
  });
});

describe("automationDeniedProblem and permissionPromptProblem", () => {
  it("gives automationDeniedProblem's exact text for VoiceOver", () => {
    expect(automationDeniedProblem("Visual Studio Code", "VoiceOver", AGAIN)).toEqual({
      title: "Control of VoiceOver",
      whatsWrong:
        "voicecap drives VoiceOver through AppleScript, and macOS asks you once whether Visual Studio Code may control it. It was turned down.",
      fix: [
        "Open System Settings, then Privacy & Security, then Automation.",
        "Under Visual Studio Code, switch on VoiceOver.",
        "Run npx @icjia/voicecap doctor again.",
      ],
      // Only the live test finds this one, so setup has no step for it.
      setupHelps: false,
      open: SETTINGS_PAGES.automation,
    });
  });

  it("offers setup for System Events, which setup walks through", () => {
    expect(automationDeniedProblem("Visual Studio Code", "System Events", AGAIN).setupHelps).toBe(
      true,
    );
  });

  it("gives messageOr's fallback only when the message says nothing", () => {
    expect(messageOr("osascript: broke", "No reason given.")).toBe("osascript: broke");
    expect(messageOr("", "No reason given.")).toBe("No reason given.");
    expect(messageOr(" \n", "No reason given.")).toBe("No reason given.");
  });

  it("gives permissionPromptProblem's exact text for System Events", () => {
    expect(permissionPromptProblem("Visual Studio Code", "System Events", AGAIN)).toEqual({
      title: "A permission prompt",
      whatsWrong:
        'macOS may be waiting for you to answer "Visual Studio Code wants access to control System Events".',
      fix: [
        "If that prompt is on screen, click Allow.",
        "Run npx @icjia/voicecap doctor again.",
        "If the prompt doesn't close when you click it, log out and back in, then run npx @icjia/voicecap doctor again.",
      ],
      setupHelps: false,
    });
  });

  it("names System Events' own reason when it, not VoiceOver, is denied", () => {
    const problem = automationDeniedProblem("Visual Studio Code", "System Events", AGAIN);
    expect(problem.title).toBe("Control of System Events");
    expect(problem.whatsWrong).toBe(
      "voicecap sends VoiceOver's keys through System Events, and macOS asks you once whether Visual Studio Code may control it. It was turned down.",
    );
  });
});

describe("macSystem", () => {
  type Overrides = Partial<
    Record<
      "productVersion" | "buildVersion" | "uname" | "hardware" | "computerName" | "locale",
      Partial<CommandResult>
    >
  >;

  function macCommands(overrides: Overrides = {}) {
    return fakeCommands([
      [
        (file, args) => file === "sw_vers" && args[0] === "-productVersion",
        overrides.productVersion ?? { stdout: "26.6.2\n" },
      ],
      [
        (file, args) => file === "sw_vers" && args[0] === "-buildVersion",
        overrides.buildVersion ?? { stdout: "25G83\n" },
      ],
      [
        (file, args) => file === "uname" && args[0] === "-m",
        overrides.uname ?? { stdout: "arm64\n" },
      ],
      [
        (file) => file === "system_profiler",
        overrides.hardware ?? {
          stdout: JSON.stringify({
            SPHardwareDataType: [
              { machine_name: "Mac mini", machine_model: "Mac16,10", chip_type: "Apple M4" },
            ],
          }),
        },
      ],
      [(file) => file === "scutil", overrides.computerName ?? { stdout: "cschweda's Mac mini\n" }],
      [
        (file, args) => file === "defaults" && args[0] === "read",
        overrides.locale ?? { stdout: "en_US\n" },
      ],
    ]);
  }

  it("parses a recorded system_profiler JSON, sw_vers, uname, and scutil", async () => {
    const commands = macCommands();
    expect(await macSystem(commands.run)).toEqual({
      version: "26.6.2",
      build: "25G83",
      arch: "Apple silicon",
      model: "Mac mini",
      identifier: "Mac16,10",
      chip: "Apple M4",
      computerName: "cschweda's Mac mini",
      locale: "en_US",
    });
  });

  it("calls an Intel Mac Intel, not Apple silicon", async () => {
    const commands = macCommands({ uname: { stdout: "x86_64\n" } });
    expect((await macSystem(commands.run)).arch).toBe("Intel");
  });

  it("leaves hardware fields null when system_profiler's JSON doesn't parse", async () => {
    const commands = macCommands({ hardware: { stdout: "not json" } });
    const system = await macSystem(commands.run);
    expect(system.model).toBeNull();
    expect(system.identifier).toBeNull();
    expect(system.chip).toBeNull();
  });

  it("falls back to cpu_type when there's no chip_type, as on an Intel Mac", async () => {
    const commands = macCommands({
      hardware: {
        stdout: JSON.stringify({
          SPHardwareDataType: [
            {
              machine_name: "MacBook Pro",
              machine_model: "MacBookPro16,1",
              cpu_type: "Intel Core i9",
            },
          ],
        }),
      },
    });
    expect((await macSystem(commands.run)).chip).toBe("Intel Core i9");
  });

  it("gives null computerName and locale when those commands fail", async () => {
    const commands = macCommands({
      computerName: { code: 1, stdout: "" },
      locale: { code: 1, stdout: "" },
    });
    const system = await macSystem(commands.run);
    expect(system.computerName).toBeNull();
    expect(system.locale).toBeNull();
  });
});

describe("bundleVersion", () => {
  it("gives CFBundleShortVersionString from the bundle's Info.plist", async () => {
    const commands = fakeCommands([[() => true, { code: 0, stdout: "1.2.3\n" }]]);
    expect(await bundleVersion(commands.run, "/Applications/Foo.app")).toBe("1.2.3");
    expect(commands.calls).toEqual([
      {
        file: "plutil",
        args: [
          "-extract",
          "CFBundleShortVersionString",
          "raw",
          "-o",
          "-",
          "/Applications/Foo.app/Contents/Info.plist",
        ],
        timeoutMs: SHORT_TIMEOUT_MS,
      },
    ]);
  });

  it("gives null when plutil fails", async () => {
    const commands = fakeCommands([[() => true, { code: 1, stdout: "" }]]);
    expect(await bundleVersion(commands.run, "/Applications/Foo.app")).toBeNull();
  });
});

describe("voiceOverVersion", () => {
  it("gives VoiceOver.app's version and build", async () => {
    const commands = fakeCommands([
      [(file, args) => args[1] === "CFBundleShortVersionString", { code: 0, stdout: "10\n" }],
      [(file, args) => args[1] === "CFBundleVersion", { code: 0, stdout: "993\n" }],
    ]);
    expect(await voiceOverVersion(commands.run)).toEqual({ version: "10", build: "993" });
  });

  it("gives null when either plutil call fails", async () => {
    const commands = fakeCommands([
      [(file, args) => args[1] === "CFBundleShortVersionString", { code: 1, stdout: "" }],
      [(file, args) => args[1] === "CFBundleVersion", { code: 0, stdout: "993\n" }],
    ]);
    expect(await voiceOverVersion(commands.run)).toBeNull();
  });
});

describe("fakeCommands", () => {
  it("lets the first matching answer win, and records every call", async () => {
    const commands = fakeCommands([
      [(file) => file === "echo", { stdout: "first\n" }],
      [() => true, { stdout: "second\n" }],
    ]);
    const result = await commands.run("echo", ["hi"], { timeoutMs: 1000 });
    expect(result).toEqual({ code: 0, signal: null, stdout: "first\n", stderr: "" });
    expect(commands.calls).toEqual([{ file: "echo", args: ["hi"], timeoutMs: 1000 }]);
  });

  it("fails loudly on an unmatched command", async () => {
    const commands = fakeCommands([]);
    const result = await commands.run("nope", ["--flag"]);
    expect(result).toEqual({
      code: 1,
      signal: null,
      stdout: "",
      stderr: "unexpected command: nope --flag",
    });
  });
});
