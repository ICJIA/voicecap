/** Windows details for the Guidepup driver: processes, the OS version, NVDA's language. */
import { execFile, spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { PROFILE_PREFIX } from "./paths.js";

const run = promisify(execFile);

/** Process ids of running programs with this image name, e.g. "nvda.exe". */
export async function listProcesses(image: string): Promise<number[]> {
  const { stdout } = await run("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"], {
    windowsHide: true,
  });
  return parseTasklist(stdout);
}

/**
 * Asks Windows whether this session is locked: WTSQuerySessionInformation's WTSSessionInfoEx
 * (class 25) for the current session (-1). In WTSINFOEX, the Level (4 bytes) is followed by a
 * union aligned to 8 bytes (it holds 64-bit times): SessionId at 8, SessionState at 12, and
 * SessionFlags at 16 (0 locked, 1 unlocked). Checked on Windows 11 against the session's id.
 */
const SESSION_STATE = [
  "Add-Type -Namespace Voicecap -Name Wts -MemberDefinition '",
  '[DllImport("wtsapi32.dll")] public static extern bool WTSQuerySessionInformation(IntPtr server, int sessionId, int infoClass, out IntPtr buffer, out int bytes);',
  '[DllImport("wtsapi32.dll")] public static extern void WTSFreeMemory(IntPtr memory);',
  "';",
  "$buffer = [IntPtr]::Zero; $bytes = 0;",
  "if ([Voicecap.Wts]::WTSQuerySessionInformation([IntPtr]::Zero, -1, 25, [ref]$buffer, [ref]$bytes)) {",
  "$flags = [Runtime.InteropServices.Marshal]::ReadInt32($buffer, 16); [Voicecap.Wts]::WTSFreeMemory($buffer);",
  "if ($flags -eq 0) { 'locked' } elseif ($flags -eq 1) { 'unlocked' } else { 'unknown' }",
  "} else { 'unknown' }",
].join(" ");

/**
 * Whether this Windows session is locked (Win+L, a screen saver, a lock policy): NVDA can't press
 * keys or speak then. Null when Windows doesn't say.
 */
export async function sessionLocked(): Promise<boolean | null> {
  const answer = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", SESSION_STATE],
    { windowsHide: true, timeout: 30_000 },
  ).then(
    ({ stdout }) => stdout,
    () => "",
  );
  return parseSessionState(answer);
}

export function parseSessionState(answer: string): boolean | null {
  const state = answer.trim();
  return state === "locked" ? true : state === "unlocked" ? false : null;
}

/**
 * Holds ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED (SetThreadExecutionState), says
 * whether Windows took it, and keeps it until its input closes.
 */
const KEEP_AWAKE = [
  "Add-Type -Namespace Voicecap -Name Power -MemberDefinition '",
  '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);',
  "';",
  "if ([Voicecap.Power]::SetThreadExecutionState(2147483651) -ne 0) { 'awake' } else { 'refused' };",
  "[void][Console]::In.ReadToEnd()",
].join(" ");

export interface AwakeRequest {
  /** Whether Windows took the request. */
  readonly ready: Promise<boolean>;
  /** Settles once the request has ended with its helper. */
  readonly ended: Promise<void>;
  /** End the request (synchronously, so it can run as the process exits). */
  release(): void;
}

/**
 * Keep Windows from sleeping or turning the screen off (and locking because of either) until
 * release(), as video players do. A hidden PowerShell holds the request; Windows ends it when that
 * process exits, which it also does when voicecap exits, however that happens.
 */
export function keepAwake(): AwakeRequest {
  const helper = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", KEEP_AWAKE],
    { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
  );
  helper.stdin.on("error", () => {});
  const ended = new Promise<void>((resolve) => {
    helper.once("exit", () => resolve());
    helper.once("error", () => resolve());
  });
  const ready = new Promise<boolean>((resolve) => {
    let answer = "";
    helper.stdout.setEncoding("utf8");
    helper.stdout.on("data", (chunk: string) => {
      answer += chunk;
      if (answer.includes("\n")) resolve(answer.trim() === "awake");
    });
    void ended.then(() => resolve(answer.trim() === "awake"));
  });
  return {
    ready,
    ended,
    release: () => {
      helper.kill();
    },
  };
}

/** This Windows ("Windows 11 Pro 25H2 (10.0.26200)") and its display language ("en-US"). */
export function windowsSystemInfo(): { os: string; uiLocale: string | null } {
  const query = spawnSync(
    "reg",
    ["query", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", "/v", "DisplayVersion"],
    { encoding: "utf8", windowsHide: true },
  );
  const displayVersion = /DisplayVersion\s+REG_SZ\s+(\S+)/.exec(query.stdout ?? "")?.[1] ?? null;
  const culture = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "(Get-UICulture).Name"],
    { encoding: "utf8", windowsHide: true, timeout: 20_000 },
  );
  const uiLocale = (culture.stdout ?? "").trim() || null;
  return {
    os: describeWindows({ version: os.version(), release: os.release(), displayVersion }),
    uiLocale,
  };
}

/**
 * Clean up after a voicecap run that crashed or was killed: shut down Guidepup's NVDA (found by
 * its exact executable path, so another NVDA is never touched), close browsers whose profile is a
 * voicecap-chrome-* folder in `tmpDir`, and delete those profiles. Only called when no voicecap
 * holds the NVDA lock, so none of them is in use. Returns what was done, for the console.
 */
export async function cleanupOrphans(tmpDir: string, nvdaExe: string): Promise<string[]> {
  const notes: string[] = [];
  const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
  const marker = path.join(tmpDir, PROFILE_PREFIX);
  const script = [
    "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe' OR Name='nvda.exe'\"",
    "| ForEach-Object {",
    `  if ($_.Name -eq 'nvda.exe') { if ($_.ExecutablePath -eq ${quote(nvdaExe)}) { "nvda,$($_.ProcessId)" } }`,
    `  elseif ($_.CommandLine -and $_.CommandLine.Contains(${quote(marker)})) { "browser,$($_.ProcessId),$($_.ParentProcessId)" }`,
    "}",
  ].join(" ");
  const found = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    timeout: 60_000,
  }).then(
    ({ stdout }) => stdout,
    () => null,
  );
  if (found === null) {
    notes.push("Couldn't look for processes left by an earlier run (PowerShell didn't answer).");
  } else {
    const lines = found.split(/\r?\n/).map((line) => line.trim().split(","));
    const nvdaPids = lines.filter(([kind]) => kind === "nvda").map(([, pid]) => Number(pid));
    if (nvdaPids.length > 0) {
      await quitNvda(nvdaExe, nvdaPids);
      notes.push(
        `Shut down Guidepup's NVDA, which an earlier run left running (process ${nvdaPids.join(", ")}).`,
      );
    }
    const browsers = lines
      .filter(([kind]) => kind === "browser")
      .map(([, pid, parent]) => [Number(pid), Number(parent)] as const);
    const pids = new Set(browsers.map(([pid]) => pid));
    // Kill each browser's main process with its tree; its helpers are its children.
    const roots = browsers.filter(([, parent]) => !pids.has(parent)).map(([pid]) => pid);
    for (const pid of roots) {
      await run("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }).catch(
        () => {},
      );
    }
    if (roots.length > 0) {
      notes.push(`Closed ${plural(roots.length, "browser")} left by an earlier run.`);
    }
  }

  let deleted = 0;
  const leftovers = existsSync(tmpDir)
    ? readdirSync(tmpDir).filter((name) => name.startsWith(PROFILE_PREFIX))
    : [];
  for (const name of leftovers) {
    const dir = path.join(tmpDir, name);
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
      () => {},
    );
    if (!existsSync(dir)) deleted++;
  }
  if (deleted > 0)
    notes.push(`Deleted ${plural(deleted, "browser profile")} left by an earlier run.`);
  return notes;
}

/** Ask NVDA to quit (as Guidepup does), and end the process if it's still there after a while. */
async function quitNvda(nvdaExe: string, pids: number[]): Promise<void> {
  spawnSync(nvdaExe, ["--quit"], { stdio: "ignore", timeout: 15_000, windowsHide: true });
  for (let i = 0; i < 20 && pids.some(isRunning); i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  for (const pid of pids.filter(isRunning)) {
    await run("taskkill", ["/PID", String(pid), "/F"], { windowsHide: true }).catch(() => {});
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Process ids from `tasklist /FO CSV /NH` output ("INFO: No tasks ..." when there are none). */
export function parseTasklist(output: string): number[] {
  const pids: number[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^"[^"]*","(\d+)"/.exec(line.trim());
    if (match) pids.push(Number(match[1]));
  }
  return pids;
}

/** "Windows 11 Pro 25H2 (10.0.26200)" from os.version(), os.release(), and the registry's DisplayVersion. */
export function describeWindows(info: {
  version: string;
  release: string;
  displayVersion: string | null;
}): string {
  const name = info.displayVersion ? `${info.version} ${info.displayVersion}` : info.version;
  return `${name} (${info.release})`;
}

/**
 * NVDA's interface language. Its default, "Windows", follows the Windows display language, which is
 * what decides the phrasing voicecap matches.
 */
export function nvdaLanguage(configured: unknown, uiLocale: string | null): string | null {
  const value = typeof configured === "string" && configured !== "" ? configured : "Windows";
  return value === "Windows" ? uiLocale : value;
}

/**
 * Whether NVDA+T (report title) spoke a window whose title starts with `marker`. The comparison
 * ignores case and the punctuation NVDA may drop or say differently.
 *
 * Adapted from the window-title check in navigateToWebContent, @guidepup/playwright 0.19.1,
 * lib/nvdaTest.js, by Craig Morten, MIT License. Unlike the original, the marker must be followed
 * by the end of the title or a space.
 */
export function titleMatches(spoken: string, marker: string): boolean {
  const said = cleanTitle(spoken);
  const wanted = cleanTitle(marker);
  if (wanted === "" || !said.startsWith(wanted)) return false;
  return said.length === wanted.length || said[wanted.length] === " ";
}

function cleanTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/[|¦:;'"`\-‐–—·_()[\]{}\\^~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
