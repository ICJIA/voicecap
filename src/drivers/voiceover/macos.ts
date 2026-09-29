/**
 * macOS command helpers for VoiceOver readiness: osascript (AppleScript and JavaScript, with
 * timeouts), the terminal app that owns voicecap's permissions, the two permission probes, the
 * files and defaults VoiceOver's setup touches, starting, stopping, and raising processes,
 * System Settings addresses, the permission problems the quick checks and the live test share,
 * and this Mac's details. Only `runCommand` and `runCommandSync` touch node:child_process; every
 * other function takes an injected `run`, so tests (test/helpers/fake-commands.ts) never start a
 * real process.
 */
import { execFile, spawn, spawnSync, type ExecFileException } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";

import type { Problem } from "../../readiness/model.js";
import { EnvironmentError } from "../../util/errors.js";

/** What runCommand (or a fake) resolves to. Never a rejection, even for a non-zero exit. */
export interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs `file args…`, resolving to its result; test/helpers/fake-commands.ts fakes this. Aborting
 * `signal` (Ctrl+C) kills the command.
 */
export type RunCommand = (
  file: string,
  args: string[],
  options?: { timeoutMs?: number; signal?: AbortSignal },
) => Promise<CommandResult>;

/** The two permission probes' wait: System Events, and asking VoiceOver to answer. */
export const PROBE_TIMEOUT_MS = 60_000;
/** Every other command's wait. */
export const SHORT_TIMEOUT_MS = 10_000;

/** What a command killed by its timeout or by Ctrl+C gives, before it has written anything. */
const KILLED: CommandResult = { code: null, signal: "SIGTERM", stdout: "", stderr: "" };

/** execFile's error.code is the exit code when it's a number; a spawn failure or signal kill leave it null. */
function exitCode(error: ExecFileException | null): number | null {
  if (!error) return 0;
  return typeof error.code === "number" ? error.code : null;
}

/**
 * One of the two functions that touch node:child_process, with runCommandSync: execFile, with no
 * shell. Kills the process at `timeoutMs`, or as soon as `signal` aborts, with Node's default
 * signal, SIGTERM; a command whose signal has aborted already never starts. Never rejects: not for
 * a non-zero exit, and not for an abort, which resolves as a timeout's kill does.
 */
export const runCommand: RunCommand = (file, args, options = {}) => {
  if (options.signal?.aborted) return Promise.resolve({ ...KILLED });
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: options.timeoutMs, signal: options.signal },
      (error, stdout, stderr) => {
        // An abort kills the process as a timeout does, but execFile reports it as an AbortError,
        // which names no signal.
        if (error?.name === "AbortError") resolve({ ...KILLED, stdout, stderr });
        else resolve({ code: exitCode(error), signal: error?.signal ?? null, stdout, stderr });
      },
    );
  });
};

/**
 * Runs `file args…` from a hook the process runs as it exits, where only synchronous work gets
 * done: waits for the command and gives its exit code, or, with `detached: true`, only starts it,
 * to carry on after voicecap has exited. The exit code is null when the command was killed or
 * couldn't start, and for a detached one. test/mac-live-test.test.ts fakes this.
 */
export type RunCommandSync = (
  file: string,
  args: string[],
  options?: { detached?: boolean },
) => number | null;

/** How long runCommandSync waits for a command: exiting mustn't hang. */
const SYNC_TIMEOUT_MS = 5000;

/**
 * The other function that touches node:child_process: spawnSync with no shell and its output
 * ignored, killed at 5 seconds; or, detached, spawn in a process group of its own with its output
 * ignored, unref'd, so it outlives voicecap. Never throws: as the process exits, there's nothing
 * to be done about a command that fails.
 */
export const runCommandSync: RunCommandSync = (file, args, options = {}) => {
  try {
    if (options.detached) {
      const child = spawn(file, args, { detached: true, stdio: "ignore" });
      // Node reports a command that can't start as an event after spawn() has returned; with
      // nothing listening, that event would end voicecap.
      child.on("error", () => {});
      child.unref();
      return null;
    }
    return spawnSync(file, args, { stdio: "ignore", timeout: SYNC_TIMEOUT_MS }).status;
  } catch {
    // Nothing more can be done for it.
    return null;
  }
};

/** What runAppleScript resolves to. */
export type AppleScriptAnswer =
  | { ok: true; value: string }
  | { ok: false; reason: "denied" | "no-answer" | "failed"; message: string };

/** AppleScript's own `with timeout of … seconds` block, so a stuck dialog doesn't hang osascript. */
function withAppleScriptTimeout(script: string, timeoutMs: number): string {
  const seconds = Math.ceil(timeoutMs / 1000);
  return `with timeout of ${seconds} seconds\n${script}\nend timeout`;
}

/**
 * Runs an AppleScript (wrapped in its own `with timeout of` block) or, with `javascript: true`, a
 * JXA script (unwrapped: JXA has no such block) through osascript, killing the process at
 * `timeoutMs + 5000` so a script that ignores its own timeout still gets classified, or when
 * `signal` aborts. The result is `denied` (macOS refused the Apple event), `no-answer` (a
 * permission prompt is probably still on screen, or Ctrl+C killed it), `failed` (anything else),
 * or `ok` with stdout trimmed.
 */
export async function runAppleScript(
  run: RunCommand,
  script: string,
  options: { timeoutMs: number; javascript?: boolean; signal?: AbortSignal },
): Promise<AppleScriptAnswer> {
  const { timeoutMs, javascript = false, signal } = options;
  const args = javascript
    ? ["-l", "JavaScript", "-e", script]
    : ["-e", withAppleScriptTimeout(script, timeoutMs)];
  const result = await run("osascript", args, { timeoutMs: timeoutMs + 5000, signal });
  if (result.code === 0) return { ok: true, value: result.stdout.trim() };
  const message = result.stderr.trim();
  if (
    result.stderr.includes("-1743") ||
    result.stderr.includes("Not authorized to send Apple events")
  ) {
    return { ok: false, reason: "denied", message };
  }
  if (result.signal !== null || result.stderr.includes("-1712")) {
    return { ok: false, reason: "no-answer", message };
  }
  return { ok: false, reason: "failed", message };
}

// ---- Processes: the terminal app that owns voicecap's permissions ----

/** One line of `ps -A -o pid=,ppid=,comm=`. */
export interface ProcessRow {
  pid: number;
  ppid: number;
  command: string;
}

/**
 * Reads `ps -A -o pid=,ppid=,comm=` output. Each line has leading spaces, and `comm` (the last
 * field) can itself contain spaces, e.g. "/Applications/Visual Studio Code.app/…/Code Helper", so
 * only the first two runs of whitespace are split on.
 */
export function parseProcessTable(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" });
  }
  return rows;
}

/**
 * `command`'s outermost `.app` bundle, e.g. ".../Visual Studio Code.app/Contents/MacOS/Code" ->
 * "/Applications/Visual Studio Code.app"; null when `command` isn't inside one.
 */
function firstAppBundle(command: string): string | null {
  const end = command.indexOf(".app/");
  return end === -1 ? null : command.slice(0, end + 4);
}

/**
 * Walks up from `startPid` through its parents (by ppid) to the first whose command is inside an
 * `.app` bundle, and returns that bundle's outermost path: a helper nested inside the app it
 * belongs to (VS Code's "Code Helper.app" inside "Visual Studio Code.app") names the outer one.
 * Null when no ancestor is inside a bundle, as over SSH.
 */
export function terminalAppBundle(rows: ProcessRow[], startPid: number): string | null {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const seen = new Set<number>();
  let current = byPid.get(startPid);
  while (current && !seen.has(current.pid)) {
    seen.add(current.pid);
    const bundle = firstAppBundle(current.command);
    if (bundle) return bundle;
    current = byPid.get(current.ppid);
  }
  return null;
}

/** `bundle`'s file name with a trailing ".app" removed, e.g. "/Applications/Foo.app" -> "Foo". */
function bundleFileName(bundle: string): string {
  const name = bundle.slice(bundle.lastIndexOf("/") + 1);
  return name.endsWith(".app") ? name.slice(0, -4) : name;
}

/** One Info.plist string value, via plutil; null when the key is missing or plutil fails. */
async function plutilExtract(run: RunCommand, key: string, plist: string): Promise<string | null> {
  const result = await run("plutil", ["-extract", key, "raw", "-o", "-", plist], {
    timeoutMs: SHORT_TIMEOUT_MS,
  });
  if (result.code !== 0) return null;
  const value = result.stdout.trim();
  return value === "" ? null : value;
}

/**
 * The terminal app running voicecap: every macOS permission grant belongs to it, not to voicecap
 * itself. Its name is its bundle's file name, the one System Settings lists and macOS's prompts
 * use: "Visual Studio Code" and "iTerm", where their Info.plists say "Code" and "iTerm2". Null
 * when voicecap's ancestors never reach an app bundle (over SSH, say).
 */
export async function terminalApp(
  run: RunCommand,
  startPid: number = process.pid,
): Promise<{ name: string; bundle: string } | null> {
  const ps = await run("ps", ["-A", "-o", "pid=,ppid=,comm="], { timeoutMs: SHORT_TIMEOUT_MS });
  const bundle = terminalAppBundle(parseProcessTable(ps.stdout), startPid);
  if (!bundle) return null;
  return { name: bundleFileName(bundle), bundle };
}

// ---- Permission probes ----

/** Whether the terminal app is trusted for Accessibility (AXIsProcessTrusted, via JXA). */
export async function accessibilityTrusted(run: RunCommand): Promise<boolean> {
  const answer = await runAppleScript(
    run,
    'ObjC.import("ApplicationServices"); $.AXIsProcessTrusted()',
    { timeoutMs: SHORT_TIMEOUT_MS, javascript: true },
  );
  return answer.ok && answer.value === "true";
}

/** A harmless System Events query, to test (and, the first time, raise) that Automation grant. */
export function systemEventsAccess(run: RunCommand): Promise<AppleScriptAnswer> {
  return runAppleScript(
    run,
    'tell application "System Events" to get name of first process whose frontmost is true',
    { timeoutMs: PROBE_TIMEOUT_MS },
  );
}

/**
 * A harmless VoiceOver query, to test (and, the first time, raise) VoiceOver's Automation grant.
 * Ctrl+C (`signal`) ends its wait.
 */
export function askVoiceOver(run: RunCommand, signal?: AbortSignal): Promise<AppleScriptAnswer> {
  return runAppleScript(run, 'tell application "VoiceOver" to get text under cursor of vo cursor', {
    timeoutMs: PROBE_TIMEOUT_MS,
    signal,
  });
}

// ---- Files and settings ----

/**
 * VoiceOver's group container's Preferences folder: where Guidepup links voicecap's VoiceOver
 * settings in when it exists. macOS 26 lets an app create files here only with Full Disk Access.
 */
export function voiceOverPrefsDir(home: string): string {
  return `${home}/Library/Group Containers/group.com.apple.VoiceOver/Library/Preferences`;
}

/**
 * The folder Guidepup 0.34.0's start links voicecap's VoiceOver settings into, chosen as its
 * getPreferencesDirectory chooses: VoiceOver's group container's Preferences folder when that
 * exists, else <home>/Library/Preferences.
 */
export function guidepupPrefsDir(
  home: string,
  exists: (file: string) => boolean,
): { dir: string; groupContainer: boolean } {
  const groupContainer = voiceOverPrefsDir(home);
  if (exists(groupContainer)) return { dir: groupContainer, groupContainer: true };
  return { dir: `${home}/Library/Preferences`, groupContainer: false };
}

/**
 * VoiceOver's own settings file, which it creates the first time it's turned on for a user.
 * Guidepup's start stops unless it's in the folder above (ensureLocalPreferencesExist).
 */
export const VOICEOVER_LOCAL_PREFS = "com.apple.VoiceOver4.local.plist";

/** The minimum of node:fs/promises canWriteVoiceOverPrefs needs, so a fake can stand in for it. */
interface PrefsFs {
  writeFile: (file: string, data: string) => Promise<void>;
  rm: (file: string) => Promise<void>;
}

/** Creates and removes a small marker file in `dir`: the Full Disk Access check's write. */
export async function canWriteVoiceOverPrefs(
  dir: string,
  fs: PrefsFs = { writeFile, rm },
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const file = `${dir}/.voicecap-check-${process.pid}`;
  try {
    await fs.writeFile(file, "");
    await fs.rm(file);
    return { ok: true };
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    return { ok: false, code: errno.code ?? "UNKNOWN", message: errno.message };
  }
}

/** VoiceOver Utility's "Allow VoiceOver to be controlled with AppleScript" creates this file. */
export const APPLESCRIPT_ENABLED_FILE =
  "/private/var/db/Accessibility/.VoiceOverAppleScriptEnabled";

/** `defaults read <domain> <key>`, trimmed; null on a non-zero exit (unset, or no such domain). */
export async function readDefault(
  run: RunCommand,
  domain: string,
  key: string,
): Promise<string | null> {
  const result = await run("defaults", ["read", domain, key], { timeoutMs: SHORT_TIMEOUT_MS });
  return result.code === 0 ? result.stdout.trim() : null;
}

/** `defaults write <domain> <key> -bool true|false`; throws EnvironmentError on a non-zero exit. */
export async function writeDefault(
  run: RunCommand,
  domain: string,
  key: string,
  value: boolean,
): Promise<void> {
  const flag = value ? "true" : "false";
  const result = await run("defaults", ["write", domain, key, "-bool", flag], {
    timeoutMs: SHORT_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || "defaults failed";
    throw new EnvironmentError(`Couldn't set ${domain} ${key}: ${detail}`);
  }
}

// ---- VoiceOver ----

/** pgrep's arguments for VoiceOver's process, as Guidepup 0.34.0's isRunning checks for it. */
const PGREP_VOICEOVER: readonly string[] = ["-f", "VoiceOver launchd -s"];

/** How many more times voiceOverRunning asks when a signal killed pgrep. */
const PGREP_RETRIES = 3;

/**
 * Whether VoiceOver is running, the same way Guidepup's isRunning checks. A signal that reaches
 * voicecap's whole process group (a closed terminal's SIGHUP, say) can kill pgrep, whose non-zero
 * exit would read as "off": it's asked again then, up to 3 more times, and the last answer counts.
 */
export async function voiceOverRunning(run: RunCommand): Promise<boolean> {
  for (let retries = 0; ; retries++) {
    const result = await run("pgrep", [...PGREP_VOICEOVER], { timeoutMs: SHORT_TIMEOUT_MS });
    if (result.signal === null || retries === PGREP_RETRIES) return result.code === 0;
  }
}

const VOICEOVER_APP = "/System/Library/CoreServices/VoiceOver.app";

/** Starts VoiceOver the way pressing Command-F5 does, without going through Guidepup. */
export const VOICEOVER_STARTER = `${VOICEOVER_APP}/Contents/MacOS/VoiceOverStarter`;

/** Runs VOICEOVER_STARTER, to bring back the person's own VoiceOver once voicecap is done. */
export async function startVoiceOver(run: RunCommand): Promise<void> {
  await run(VOICEOVER_STARTER, [], { timeoutMs: SHORT_TIMEOUT_MS });
}

/**
 * pkill's arguments for VoiceOver's process: SIGTERM, matched exactly as Guidepup 0.34.0's own
 * last resort matches it (terminateVoiceOverProcess). It needs no permission to control VoiceOver.
 */
const PKILL_VOICEOVER: readonly string[] = [
  "-15",
  "-f",
  "VoiceOver.app/Contents/MacOS/VoiceOver launchd -s",
];

/** A wait that Ctrl+C (`signal`) ends early. */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/**
 * Waits `ms`, or less when `signal` aborts first, and never rejects: after Ctrl+C, whoever waited
 * sees the signal and stops. The default wait for raiseProcess and the VoiceOver waits; tests
 * inject one that returns at once.
 */
export const pause: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

/** A wait that blocks, for an exit hook, where nothing asynchronous gets done. */
export type SleepSync = (ms: number) => void;

/** What pauseSync waits on: a value nothing ever changes. */
const NEVER_CHANGES = new Int32Array(new SharedArrayBuffer(4));

/**
 * Blocks this thread for `ms` with Atomics.wait, which gives up at its timeout when the value it
 * waits on doesn't change: no OS command. The wait between stopVoiceOverSync's checks; tests
 * inject one that returns at once.
 */
export const pauseSync: SleepSync = (ms) => {
  Atomics.wait(NEVER_CHANGES, 0, 0, ms);
};

/** How often waitForVoiceOver checks. */
const VOICEOVER_POLL_MS = 250;
/** How often stopVoiceOverSync checks: it blocks the exit meanwhile. */
const VOICEOVER_SYNC_POLL_MS = 100;
/** How long stopVoiceOver (and stopVoiceOverSync) wait for VoiceOver's process to go. */
const VOICEOVER_STOP_WAIT_MS = 5000;

/**
 * Checks every 250 ms, for up to `timeoutMs`, until VoiceOver is running (or stopped), and says
 * whether it got there. The time is counted in waits, not read from a clock, so a test's instant
 * sleep gets the same checks: one at once, then one after each wait.
 */
export async function waitForVoiceOver(
  run: RunCommand,
  want: "running" | "stopped",
  timeoutMs: number,
  sleep: Sleep = pause,
): Promise<boolean> {
  for (let waited = 0; ; waited += VOICEOVER_POLL_MS) {
    if ((await voiceOverRunning(run)) === (want === "running")) return true;
    if (waited >= timeoutMs) return false;
    await sleep(VOICEOVER_POLL_MS);
  }
}

/**
 * Quits a VoiceOver that voicecap started, without Guidepup: asks VoiceOver to quit through
 * AppleScript, then sends its process SIGTERM with pkill (PKILL_VOICEOVER), then waits up to 5
 * seconds for pgrep to stop finding it. Says whether VoiceOver is off at the end. Neither
 * command's answer matters: pkill exits 1 when VoiceOver already quit. It takes no abort signal:
 * it's part of clean-ups, which must finish.
 */
export async function stopVoiceOver(run: RunCommand, sleep: Sleep = pause): Promise<boolean> {
  await runAppleScript(run, 'tell application "VoiceOver" to quit', {
    timeoutMs: SHORT_TIMEOUT_MS,
  });
  await run("pkill", [...PKILL_VOICEOVER], { timeoutMs: SHORT_TIMEOUT_MS });
  return waitForVoiceOver(run, "stopped", VOICEOVER_STOP_WAIT_MS, sleep);
}

/**
 * stopVoiceOver for a hook the process runs as it exits, with synchronous commands and waits only
 * (no AppleScript, whose answer could wait on a prompt): sends VoiceOver's process SIGTERM with
 * pkill, then checks with pgrep every 100 ms, for up to 5 seconds, until it's gone. Says whether
 * it's gone. As in waitForVoiceOver, the time is counted in waits, and a pgrep that doesn't run
 * counts as VoiceOver gone.
 */
export function stopVoiceOverSync(runSync: RunCommandSync, sleep: SleepSync = pauseSync): boolean {
  runSync("pkill", [...PKILL_VOICEOVER]);
  for (let waited = 0; ; waited += VOICEOVER_SYNC_POLL_MS) {
    if (runSync("pgrep", [...PGREP_VOICEOVER]) !== 0) return true;
    if (waited >= VOICEOVER_STOP_WAIT_MS) return false;
    sleep(VOICEOVER_SYNC_POLL_MS);
  }
}

/**
 * waitForVoiceOver's wait for VoiceOver to be running, for a hook the process runs as it exits:
 * checks with pgrep every 100 ms until it is, or until `until` has passed on `now`'s clock (the
 * wait started before the hook did). Says whether it's running.
 */
export function waitUntilVoiceOverRunsSync(
  runSync: RunCommandSync,
  until: number,
  now: () => number,
  sleep: SleepSync = pauseSync,
): boolean {
  for (;;) {
    if (runSync("pgrep", [...PGREP_VOICEOVER]) === 0) return true;
    if (now() >= until) return false;
    sleep(VOICEOVER_SYNC_POLL_MS);
  }
}

/**
 * Where Guidepup mounts the disk image with voicecap's VoiceOver settings while its VoiceOver runs.
 * Mirrors Guidepup 0.34.0's MOUNT_POINT in lib/macOS/VoiceOver/preferences/constants.js.
 */
export const GUIDEPUP_PREFERENCES_VOLUME = "/Volumes/GuidepupVoiceOverPreferences";

/**
 * Detaches that disk image, as Guidepup's own stop does last (unmountGuidepupPreferences): for when
 * its stop gave up before getting there, since a VoiceOver started while the image is attached
 * gets voicecap's settings. hdiutil's answer doesn't matter: it fails when the image isn't there.
 */
export async function detachGuidepupPreferences(run: RunCommand): Promise<void> {
  await run("hdiutil", ["detach", GUIDEPUP_PREFERENCES_VOLUME], { timeoutMs: SHORT_TIMEOUT_MS });
}

/**
 * Brings the process with this pid to the front through System Events, waits 300 ms for macOS to
 * catch up, then reads which process is frontmost to confirm it worked. Ctrl+C (`signal`) ends
 * each command and the wait.
 */
export async function raiseProcess(
  run: RunCommand,
  pid: number,
  sleep: Sleep = pause,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; frontmostPid: number | null; message: string }> {
  const raise = await runAppleScript(
    run,
    `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
    { timeoutMs: SHORT_TIMEOUT_MS, signal },
  );
  if (!raise.ok) return { ok: false, frontmostPid: null, message: raise.message };
  await sleep(300, signal);
  const check = await runAppleScript(
    run,
    'tell application "System Events" to get unix id of first process whose frontmost is true',
    { timeoutMs: SHORT_TIMEOUT_MS, signal },
  );
  if (!check.ok) return { ok: false, frontmostPid: null, message: check.message };
  const frontmostPid = Number(check.value);
  if (frontmostPid === pid) return { ok: true };
  return {
    ok: false,
    frontmostPid,
    message: `Process ${pid} didn't come to the front (process ${frontmostPid} is).`,
  };
}

// ---- System Settings ----

/** The System Settings pages the checks send people to. */
export const SETTINGS_PAGES: Record<
  "accessibility" | "fullDiskAccess" | "automation",
  { kind: "settings"; url: string; page: string }
> = {
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
};

/**
 * Opens a Problem's `open` target: a System Settings page, or an app by name. Says whether `open`
 * managed it.
 */
export async function openTarget(
  run: RunCommand,
  target: NonNullable<Problem["open"]>,
): Promise<boolean> {
  const args = target.kind === "settings" ? [target.url] : ["-a", target.name];
  const result = await run("open", args, { timeoutMs: SHORT_TIMEOUT_MS });
  return result.code === 0;
}

// ---- Problems the quick checks and the live test share ----

/**
 * A problem's "What's wrong": `message`, or `fallback` when the command or error it came from said
 * nothing (osascript killed at its timeout, or unable to start, writes nothing).
 */
export function messageOr(message: string, fallback: string): string {
  return message.trim() === "" ? fallback : message;
}

const AUTOMATION_WHY: Record<"System Events" | "VoiceOver", string> = {
  "System Events": "voicecap sends VoiceOver's keys through System Events",
  VoiceOver: "voicecap drives VoiceOver through AppleScript",
};

/**
 * `app` isn't allowed to control `target`: macOS asked once, while it was denied. setup walks
 * through System Events; control of VoiceOver only turns up in the live test, so setup has no
 * step for it.
 */
export function automationDeniedProblem(
  app: string,
  target: "System Events" | "VoiceOver",
  again: string,
): Problem {
  return {
    title: `Control of ${target}`,
    whatsWrong: `${AUTOMATION_WHY[target]}, and macOS asks you once whether ${app} may control it. It was turned down.`,
    fix: [
      "Open System Settings, then Privacy & Security, then Automation.",
      `Under ${app}, switch on ${target}.`,
      `Run ${again} again.`,
    ],
    setupHelps: target === "System Events",
    open: SETTINGS_PAGES.automation,
  };
}

/** macOS's "<app> wants access to control <target>" prompt may still be on screen, unanswered. */
export function permissionPromptProblem(
  app: string,
  target: "System Events" | "VoiceOver",
  again: string,
): Problem {
  return {
    title: "A permission prompt",
    whatsWrong: `macOS may be waiting for you to answer "${app} wants access to control ${target}".`,
    fix: [
      "If that prompt is on screen, click Allow.",
      `Run ${again} again.`,
      `If the prompt doesn't close when you click it, log out and back in, then run ${again} again.`,
    ],
    setupHelps: false,
  };
}

// ---- This Mac ----

async function swVers(run: RunCommand, flag: string): Promise<string> {
  const result = await run("sw_vers", [flag], { timeoutMs: SHORT_TIMEOUT_MS });
  return result.stdout.trim();
}

async function unameArch(run: RunCommand): Promise<string> {
  const result = await run("uname", ["-m"], { timeoutMs: SHORT_TIMEOUT_MS });
  return result.stdout.trim();
}

interface HardwareInfo {
  model: string | null;
  identifier: string | null;
  chip: string | null;
}

/** `system_profiler SPHardwareDataType -json`'s machine_name, machine_model, and chip/cpu_type. */
function parseHardwareInfo(stdout: string): HardwareInfo {
  try {
    const parsed = JSON.parse(stdout) as {
      SPHardwareDataType?: {
        machine_name?: string;
        machine_model?: string;
        chip_type?: string;
        cpu_type?: string;
      }[];
    };
    const entry = parsed.SPHardwareDataType?.[0];
    return {
      model: entry?.machine_name ?? null,
      identifier: entry?.machine_model ?? null,
      chip: entry?.chip_type ?? entry?.cpu_type ?? null,
    };
  } catch {
    return { model: null, identifier: null, chip: null };
  }
}

async function hardwareInfo(run: RunCommand): Promise<HardwareInfo> {
  const result = await run("system_profiler", ["SPHardwareDataType", "-json"], {
    timeoutMs: SHORT_TIMEOUT_MS,
  });
  return parseHardwareInfo(result.stdout);
}

async function scutilComputerName(run: RunCommand): Promise<string | null> {
  const result = await run("scutil", ["--get", "ComputerName"], { timeoutMs: SHORT_TIMEOUT_MS });
  if (result.code !== 0) return null;
  const value = result.stdout.trim();
  return value === "" ? null : value;
}

/** This Mac: its macOS version, architecture, hardware, computer name, and locale. */
export async function macSystem(run: RunCommand): Promise<{
  version: string;
  build: string;
  arch: "Apple silicon" | "Intel";
  model: string | null;
  identifier: string | null;
  chip: string | null;
  computerName: string | null;
  locale: string | null;
}> {
  const [version, build, arch, hardware, computerName, locale] = await Promise.all([
    swVers(run, "-productVersion"),
    swVers(run, "-buildVersion"),
    unameArch(run),
    hardwareInfo(run),
    scutilComputerName(run),
    // "defaults read -g AppleLocale": readDefault's "domain" argument is the next argv, so the
    // global-domain flag "-g" works there exactly as it does on the real command line.
    readDefault(run, "-g", "AppleLocale"),
  ]);
  return {
    version,
    build,
    arch: arch === "arm64" ? "Apple silicon" : "Intel",
    ...hardware,
    computerName,
    locale,
  };
}

/** One Info.plist's CFBundleShortVersionString, e.g. an app's version. */
export function bundleVersion(run: RunCommand, bundle: string): Promise<string | null> {
  return plutilExtract(run, "CFBundleShortVersionString", `${bundle}/Contents/Info.plist`);
}

/** VoiceOver.app's own version and build, e.g. { version: "10", build: "993" }. */
export async function voiceOverVersion(
  run: RunCommand,
): Promise<{ version: string; build: string } | null> {
  const plist = `${VOICEOVER_APP}/Contents/Info.plist`;
  const [version, build] = await Promise.all([
    plutilExtract(run, "CFBundleShortVersionString", plist),
    plutilExtract(run, "CFBundleVersion", plist),
  ]);
  return version !== null && build !== null ? { version, build } : null;
}
