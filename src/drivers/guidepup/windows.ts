/**
 * Windows details for the Guidepup driver: processes, the OS version, NVDA's language, and this
 * computer's details for a run's record.
 */
import { execFile, spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { MachineRecord } from "../../model.js";
import type { MachineProbe } from "../../run/machine-record.js";
import { PROFILE_PREFIX, type GuidepupInstall } from "./paths.js";

const run = promisify(execFile);

/**
 * Has PowerShell write its answer in UTF-8, as execFile reads it. Windows PowerShell writes to a
 * pipe in the console's code page (437 on US English), which garbles a path like C:\Users\José.
 * A host without a console can't set it, so a failure there is ignored.
 */
const UTF8_ANSWER =
  "try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch {}; ";

/** A script as powershell() runs it: unchanged, after UTF8_ANSWER. */
export function powershellCommand(script: string): string {
  return UTF8_ANSWER + script;
}

/** Runs a PowerShell script, hidden, for up to 20 seconds; resolves to what it printed. */
async function powershell(script: string): Promise<string> {
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", powershellCommand(script)],
    { windowsHide: true, timeout: 20_000 },
  );
  return stdout;
}

/**
 * `text` as a PowerShell string that it reads as it is: in single quotes, with each quote inside
 * doubled. PowerShell takes the curly single quotes for quotes too, so they're doubled as well.
 */
export function powershellString(text: string): string {
  return `'${text.replace(/['\u2018\u2019\u201A\u201B]/g, "$&$&")}'`;
}

/** Process ids of running programs with this image name, e.g. "nvda.exe". */
export async function listProcesses(image: string): Promise<number[]> {
  const { stdout } = await run("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"], {
    windowsHide: true,
  });
  return parseTasklist(stdout);
}

/** A running nvda.exe. */
export interface NvdaProcess {
  pid: number;
  /** Null when Windows doesn't give it, as for another user's process. */
  path: string | null;
}

/**
 * Every running nvda.exe as "<pid>|<path>" lines. The path comes from QueryFullProcessImageName,
 * which needs only the limited query right. An installed NVDA runs with UI Access, at a higher
 * integrity level than voicecap, and Windows gives a lower level that right but not the ones
 * WMI's ExecutablePath needs, so WMI's path for it is empty. The C# is compiled only when an
 * nvda.exe is running.
 */
const NVDA_PROCESSES = [
  "$running = @(Get-Process -Name nvda -ErrorAction SilentlyContinue);",
  "if ($running.Count -gt 0) {",
  "Add-Type -Namespace Voicecap -Name Image -MemberDefinition '",
  '[DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);',
  '[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr process, int flags, System.Text.StringBuilder name, ref int size);',
  '[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);',
  "';",
  "foreach ($nvda in $running) {",
  // PROCESS_QUERY_LIMITED_INFORMATION
  "$path = ''; $handle = [Voicecap.Image]::OpenProcess(0x1000, $false, $nvda.Id);",
  "if ($handle -ne [IntPtr]::Zero) {",
  "$name = New-Object Text.StringBuilder 32768; $size = $name.Capacity;",
  "if ([Voicecap.Image]::QueryFullProcessImageName($handle, 0, $name, [ref]$size)) { $path = $name.ToString() }",
  "[void][Voicecap.Image]::CloseHandle($handle) }",
  '"$($nvda.Id)|$path" } }',
].join(" ");

/**
 * Every running nvda.exe, Guidepup's or anyone else's, with its path, so the person's own NVDA can
 * be told from Guidepup's. Throws "PowerShell didn't answer" when it can't tell.
 */
export async function nvdaProcesses(): Promise<NvdaProcess[]> {
  const found = await powershell(NVDA_PROCESSES).catch((error: unknown) => {
    throw new Error("PowerShell didn't answer", { cause: error });
  });
  return parseNvdaProcesses(found);
}

/**
 * The person's own NVDA among the running nvda.exe: every one but Guidepup's. One whose path
 * Windows doesn't give counts: Guidepup's NVDA runs as the person running voicecap, so its path is
 * always given.
 */
export function personsNvda(processes: NvdaProcess[], guidepupExe: string): NvdaProcess[] {
  const guidepups = samePath(guidepupExe);
  return processes.filter((nvda) => nvda.path === null || samePath(nvda.path) !== guidepups);
}

/**
 * The process id of the NVDA voicecap started, among the running nvda.exe: the one run from
 * Guidepup's executable, with its path compared as personsNvda compares it. Null when none runs
 * from there; a process Windows gives no path for is never taken for it, as Guidepup's NVDA runs as
 * the person running voicecap, so its path is always given. Should more than one run from there,
 * the first listed.
 */
export function startedNvda(processes: NvdaProcess[], guidepupExe: string): number | null {
  const guidepups = samePath(guidepupExe);
  const started = processes.find((nvda) => nvda.path !== null && samePath(nvda.path) === guidepups);
  return started?.pid ?? null;
}

/**
 * Where the person's own running NVDA was started from, each path once, so voicecap can start it
 * again after Guidepup's NVDA has shut it down. One whose path Windows doesn't give is left out:
 * it can't be started again. Throws "PowerShell didn't answer" when it can't tell.
 */
export async function ownNvdaPaths(
  install: GuidepupInstall,
  running: () => Promise<NvdaProcess[]> = nvdaProcesses,
): Promise<string[]> {
  const paths = new Map<string, string>();
  for (const nvda of personsNvda(await running(), install.nvdaExe)) {
    if (nvda.path !== null && !paths.has(samePath(nvda.path))) {
      paths.set(samePath(nvda.path), nvda.path);
    }
  }
  return [...paths.values()];
}

/**
 * The PowerShell that starts a program as a shortcut does, through ShellExecute: an installed NVDA
 * asks for UI Access, and Windows can refuse to start such a program any other way.
 */
export function startProcessScript(exe: string): string {
  return `Start-Process -FilePath ${powershellString(exe)}`;
}

/**
 * Start the person's own NVDA again from its path. Resolves once Windows has started it; throws
 * "PowerShell didn't start it" when it hasn't.
 */
export async function restartNvda(exe: string): Promise<void> {
  await powershell(startProcessScript(exe)).catch((error: unknown) => {
    throw new Error("PowerShell didn't start it", { cause: error });
  });
}

/**
 * The PowerShell that starts the person's NVDA (`exe`) once no nvda.exe runs from `after`
 * (Guidepup's), waiting at most `waitSeconds`: an NVDA still quitting could otherwise take the new
 * one down with it. Guidepup's NVDA runs as the person running voicecap, so its path is always
 * given.
 */
export function restartAfterScript(exe: string, after: string, waitSeconds: number): string {
  return [
    `$until = (Get-Date).AddSeconds(${waitSeconds});`,
    "while ((Get-Date) -lt $until -and",
    `@(Get-Process -Name nvda -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${powershellString(after)} }).Count -gt 0)`,
    "{ Start-Sleep -Milliseconds 100 };",
    startProcessScript(exe),
  ].join(" ");
}

/**
 * restartNvda() without waiting, for when voicecap is exiting: a detached PowerShell starts NVDA
 * once Guidepup's NVDA (`after`) has quit (restartAfterScript), so the start still happens after
 * voicecap has gone.
 */
export function restartNvdaDetached(exe: string, after: string): void {
  const helper = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      powershellCommand(restartAfterScript(exe, after, 20)),
    ],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  // Node reports a PowerShell that can't start as an event after spawn() has returned; with
  // nothing listening, that event would end voicecap.
  helper.on("error", () => {});
  helper.unref();
}

/** A Windows path in one spelling, for comparing: Windows ignores letter case in paths. */
function samePath(file: string): string {
  return path.win32.normalize(file).toLowerCase();
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

const COMPUTER_MODEL = `Get-CimInstance Win32_ComputerSystem | ForEach-Object { "$($_.Manufacturer)|$($_.Model)" }`;

/** This computer's maker and model, e.g. "Dell Inc. OptiPlex 7010"; null when Windows doesn't say. */
export async function windowsComputerModel(): Promise<string | null> {
  return parseComputerModel(await powershell(COMPUTER_MODEL).catch(() => ""));
}

/** A browser's version, e.g. "142.0.7444.60", from its executable; null when Windows doesn't say. */
export async function windowsBrowserVersion(file: string): Promise<string | null> {
  const script = `(Get-Item -LiteralPath ${powershellString(file)}).VersionInfo.ProductVersion`;
  const version = (await powershell(script).catch(() => "")).trim();
  return version === "" ? null : version;
}

/**
 * Everything windowsMachineProbe asks, in one start of PowerShell, answered as one line of JSON
 * (see parseWindowsMachine): the system's name and version, the registry's display version and
 * update revision, the first processor's speed and core count, the display that has a resolution
 * (its size and refresh rate), the scaling Windows applied (AppliedDPI, in dots per inch), and the
 * display language. Its answer holds nothing that names the computer, its maker or model, or the
 * account. What it reads holds more, among it the computer's name in Win32_OperatingSystem
 * (CSName) and the registered owner in CurrentVersion (RegisteredOwner): only the fields it picks
 * leave PowerShell.
 */
const MACHINE_SCRIPT = [
  "$os = Get-CimInstance Win32_OperatingSystem;",
  "$cv = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';",
  "$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1;",
  "$vc = Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution } | Select-Object -First 1;",
  "$dpi = (Get-ItemProperty 'HKCU:\\Control Panel\\Desktop\\WindowMetrics' -ErrorAction SilentlyContinue).AppliedDPI;",
  "[pscustomobject]@{ caption = $os.Caption; displayVersion = $cv.DisplayVersion; version = $os.Version; ubr = $cv.UBR;",
  "cpuMhz = $cpu.MaxClockSpeed; cores = $cpu.NumberOfCores; width = $vc.CurrentHorizontalResolution;",
  "height = $vc.CurrentVerticalResolution; refresh = $vc.CurrentRefreshRate; dpi = $dpi;",
  "language = (Get-UICulture).Name } | ConvertTo-Json -Compress",
].join(" ");

/**
 * This Windows computer's details for a run's record. PowerShell is asked once, when a part is
 * first read, and every part reads from that one answer. When it gives none (it failed, or said
 * something that isn't the JSON asked for), that isn't kept: the next part read asks again. `ask`
 * runs the script; tests replace it.
 */
export function windowsMachineProbe(
  ask: (script: string) => Promise<string> = powershell,
): MachineProbe {
  let answer: Promise<WindowsMachine> | undefined;
  const read = () =>
    (answer ??= ask(MACHINE_SCRIPT)
      .then(parseWindowsMachine)
      .catch((error: unknown) => {
        answer = undefined;
        throw error;
      }));
  return {
    os: async () => (await read()).os,
    cpu: async () => (await read()).cpu,
    display: async () => (await read()).display,
    language: async () => (await read()).language,
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
  const marker = path.join(tmpDir, PROFILE_PREFIX);
  const script = [
    "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe' OR Name='nvda.exe'\"",
    "| ForEach-Object {",
    `  if ($_.Name -eq 'nvda.exe') { if ($_.ExecutablePath -eq ${powershellString(nvdaExe)}) { "nvda,$($_.ProcessId)" } }`,
    `  elseif ($_.CommandLine -and $_.CommandLine.Contains(${powershellString(marker)})) { "browser,$($_.ProcessId),$($_.ParentProcessId)" }`,
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

/**
 * Close every browser whose command line names `profileDir`, each with its helpers: one that took
 * over a voicecap profile when the browser voicecap started handed over to a new copy of itself,
 * as Chrome does to finish installing an update. Resolves to how many were closed (0 when
 * PowerShell didn't answer).
 */
export async function closeBrowsersUsing(profileDir: string): Promise<number> {
  const script = [
    "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\"",
    "| ForEach-Object {",
    `  if ($_.CommandLine -and $_.CommandLine.Contains(${powershellString(profileDir)})) { "$($_.ProcessId),$($_.ParentProcessId)" }`,
    "}",
  ].join(" ");
  const found = await powershell(script).catch(() => "");
  const browsers = found
    .split(/\r?\n/)
    .map((line) => line.trim().split(",").map(Number))
    .filter(([pid, parent]) => Number.isInteger(pid) && Number.isInteger(parent))
    .map(([pid, parent]) => [pid!, parent!] as const);
  const pids = new Set(browsers.map(([pid]) => pid));
  // Kill each browser's main process with its tree; its helpers are its children.
  const roots = browsers.filter(([, parent]) => !pids.has(parent)).map(([pid]) => pid);
  for (const pid of roots) {
    await run("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }).catch(() => {});
  }
  return roots.length;
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

/** nvdaProcesses' "<pid>|<path>" lines; an empty path is null, and other lines are skipped. */
export function parseNvdaProcesses(stdout: string): NvdaProcess[] {
  const found: NvdaProcess[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(\d+)\|(.*)$/.exec(line.trim());
    if (match) found.push({ pid: Number(match[1]), path: match[2]?.trim() || null });
  }
  return found;
}

/**
 * "Dell Inc. OptiPlex 7010" from windowsComputerModel's "<Manufacturer>|<Model>" line, leaving out
 * a blank part. A model that already starts with the maker's name is shown alone: "HP EliteBook
 * 840", not "HP HP EliteBook 840".
 */
export function parseComputerModel(stdout: string): string | null {
  const [line = ""] = stdout.trim().split(/\r?\n/);
  const bar = line.indexOf("|");
  const maker = (bar === -1 ? line : line.slice(0, bar)).trim();
  const model = (bar === -1 ? "" : line.slice(bar + 1)).trim();
  const namesMaker =
    maker !== "" &&
    model.toLowerCase().startsWith(maker.toLowerCase()) &&
    (model.length === maker.length || model[maker.length] === " ");
  const name = namesMaker ? model : [maker, model].filter((part) => part !== "").join(" ");
  return name === "" ? null : name;
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

/** What windowsMachineProbe's script says, as the parts of a MachineProbe. */
export interface WindowsMachine {
  os: { name: string; build: string | null };
  cpu: { baseMhz: number | null; physicalCores: number | null };
  display: MachineRecord["display"];
  language: string | null;
}

/**
 * The parts of the computer's details in MACHINE_SCRIPT's JSON. The system's name is the caption
 * without its leading "Microsoft ", then the display version: "Windows 11 Pro 25H2". Its build is
 * the version and the update revision joined by a dot: "10.0.26200.9550". The scaling is
 * AppliedDPI as a percent of 96, rounded. Whatever PowerShell gave no answer for (null, or 0 where
 * a number is wanted) is left out: null, and "Windows" for a system with no caption. So is a
 * refresh rate outside 2 to 1000 Hz: Windows gives 0 or 1 for the display's default rate and
 * 4294967295 for one it doesn't know.
 */
export function parseWindowsMachine(json: string): WindowsMachine {
  const data = (JSON.parse(json) ?? {}) as Record<string, unknown>;
  const caption = text(data.caption)?.replace(/^Microsoft\s+/i, "") ?? "Windows";
  const displayVersion = text(data.displayVersion);
  const version = text(data.version);
  const revision = count(data.ubr);
  const width = positive(data.width);
  const height = positive(data.height);
  const dpi = positive(data.dpi);
  return {
    os: {
      name: displayVersion === null ? caption : `${caption} ${displayVersion}`,
      build: version !== null && revision !== null ? `${version}.${revision}` : version,
    },
    cpu: { baseMhz: positive(data.cpuMhz), physicalCores: positive(data.cores) },
    display:
      width === null || height === null
        ? null
        : {
            width,
            height,
            refreshHz: hertz(data.refresh),
            scalePercent: dpi === null ? null : Math.round((dpi / 96) * 100),
          },
    language: text(data.language),
  };
}

/** A string that isn't blank, trimmed; null for anything else. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** A number above zero; null for anything else. */
function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** A display's refresh rate, 2 to 1000 Hz; null for anything else, Windows's sentinels included. */
function hertz(value: unknown): number | null {
  return typeof value === "number" && value >= 2 && value <= 1000 ? value : null;
}

/** A whole number, zero included; null for anything else. */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
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
