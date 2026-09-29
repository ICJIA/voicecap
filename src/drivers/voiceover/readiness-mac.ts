/**
 * macOS readiness: this computer, VoiceOver and the browser described, the quick checks that
 * decide whether a Mac can drive VoiceOver, the machine-info lines "This computer" shows, and the
 * live test (live-test.ts), given the terminal app's name the quick checks found.
 * src/drivers/readiness.ts loads it on macOS only.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { browserCheck, nodeCheck, otherVoicecapCheck } from "../../readiness/common-checks.js";
import { serveCheckPage } from "../../readiness/live-check.js";
import { diskSpace, gigabytes, homePath, languageName } from "../../readiness/machine.js";
import type { Check, CheckRunner, MachineInfo, PlatformReadiness } from "../../readiness/model.js";
import { resolveHome } from "../../run/paths.js";
import { acquireLockFile, activeLockHolder, type LockHolder } from "../../util/lock-file.js";
import { voicecapVersion } from "../../util/version.js";
import { launchChrome, resolveBrowser, type BrowserExecutable } from "../guidepup/chrome.js";
import { envValue } from "../guidepup/paths.js";
import type { ReadinessOptions } from "../readiness.js";
import { loadGuidepupVoiceOver, macLiveTest, type MacLiveDeps } from "./live-test.js";
import {
  accessibilityTrusted,
  APPLESCRIPT_ENABLED_FILE,
  automationDeniedProblem,
  bundleVersion,
  canWriteVoiceOverPrefs,
  guidepupPrefsDir,
  macSystem,
  messageOr,
  pause,
  pauseSync,
  permissionPromptProblem,
  readDefault,
  runCommand,
  runCommandSync,
  SETTINGS_PAGES,
  systemEventsAccess,
  terminalApp,
  terminalAppBundle,
  VOICEOVER_LOCAL_PREFS,
  voiceOverRunning,
  voiceOverVersion,
  type RunCommand,
} from "./macos.js";

// ---- Paths Guidepup and voicecap use on the Mac ----

/**
 * The Mac's paths are built the Mac's way on every computer, as tests run on Windows too. Node's
 * own `path` stays only for the files voicecap reads on this computer: Guidepup's package.
 */
const macPath = path.posix;

/** voicecap's own lock for VoiceOver, like Windows' nvda.lock: only one voicecap drives it at a time. */
export function voiceOverLockFile(home: string): string {
  return macPath.join(home, "Library", "Caches", "voicecap", "voiceover.lock");
}

/**
 * Takes the VoiceOver lock, giving back its release. Refuses with an EnvironmentError, in the
 * NVDA driver's words for its own lock, while another voicecap holds it.
 */
export function lockVoiceOver(file: string): Promise<() => Promise<void>> {
  return acquireLockFile(file, {
    held: (holder) =>
      `Another voicecap (process ${holder.pid}, started ${holder.startedAt}) is using VoiceOver on this computer, and only one can at a time. Wait for it to finish, or stop it first. If no other voicecap is running, delete its lock: ${file}`,
    otherHost: (holder) =>
      `The VoiceOver lock ${file} was taken on another computer (${holder.host}). If no voicecap is running here, delete it.`,
  });
}

/**
 * Where Guidepup caches VoiceOver's asset: GUIDEPUP_SCREEN_READERS_PATH when set (resolved), else
 * <home>/Library/Caches/guidepup. Mirrors @guidepup/guidepup 0.34.0's lib/resolveCachePath.js.
 */
export function guidepupCacheDir(env: NodeJS.ProcessEnv, home: string): string {
  const override = envValue(env, "GUIDEPUP_SCREEN_READERS_PATH");
  return override ? macPath.resolve(override) : macPath.join(home, "Library", "Caches", "guidepup");
}

// ---- Guidepup's manifest: which macOS versions it can drive VoiceOver on ----

/** One entry in Guidepup's manifest.json screenReaders[id=voiceover].assets. */
interface VoiceOverManifestAsset {
  version: string;
  platformVersion: string;
  asset: string;
}

/** The shape voiceOverAsset reads out of Guidepup's manifest.json; anything else in it is ignored. */
interface GuidepupManifest {
  screenReaders?: { id: string; assets?: VoiceOverManifestAsset[] }[];
}

/**
 * The macOS major version a Darwin major version reports as, e.g. from `uname -r`'s leading
 * number. Darwin 21-24 are macOS 12-15; Darwin 25 is macOS 26, when Apple's numbering jumped to
 * match the year.
 */
function macOSForDarwin(darwinMajor: number): number {
  return darwinMajor >= 25 ? darwinMajor + 1 : darwinMajor - 9;
}

function voiceOverManifestAssets(manifest: unknown): VoiceOverManifestAsset[] {
  const reader = (manifest as GuidepupManifest).screenReaders?.find(
    (candidate) => candidate.id === "voiceover",
  );
  return reader?.assets ?? [];
}

/**
 * The macOS versions Guidepup's VoiceOver asset supports (oldest to newest), and where this
 * computer's Darwin major version's asset lives under `cacheDir`; `file` is null when this Darwin
 * major isn't in the manifest at all.
 */
export function voiceOverAsset(
  manifest: unknown,
  darwinMajor: number,
  cacheDir: string,
): { supported: string[]; file: string | null } {
  const assets = voiceOverManifestAssets(manifest);
  const supported = assets.map((asset) => String(macOSForDarwin(Number(asset.platformVersion))));
  const match = assets.find((asset) => Number(asset.platformVersion) === darwinMajor);
  const file = match
    ? `${cacheDir}/voiceover/${match.platformVersion}/${match.version}/${match.asset}`
    : null;
  return { supported, file };
}

// ---- Deps ----

/** Everything the Mac checks and machine info read from the computer, so tests can fake it. */
export interface MacReadinessDeps {
  run: RunCommand;
  /** voicecap's own process id: the start of the walk up to the terminal app. */
  pid: number;
  home: string;
  env: NodeJS.ProcessEnv;
  nodeVersion: string;
  voicecapVersion: string;
  guidepup: { version: string; manifest: unknown };
  darwinMajor: number;
  exists: (file: string) => boolean;
  /** canWriteVoiceOverPrefs: creates and removes a file in `dir`, the Full Disk Access probe. */
  writeVoiceOverPrefs: (
    dir: string,
  ) => Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  /** Another voicecap holding the VoiceOver lock, if one is running. */
  otherVoicecap: () => Promise<LockHolder | null>;
  /** The VoiceOver lock's file. */
  lockFile: string;
  /** The browser voicecap would launch; throws when there's none. */
  resolveBrowser: () => BrowserExecutable;
  /** Where transcripts are written. */
  transcripts: string;
  /** Memory, in bytes. */
  totalmem: () => number;
  /** Free and total bytes on the disk that holds the home folder. */
  disk: () => Promise<{ free: number; total: number } | null>;
  /**
   * Starts VoiceOver and the browser, brings the browser forward, and captures VoiceOver's speech
   * (live-test.ts). `app` is the terminal app's name, from the quick checks' lookup. Left out,
   * macReadiness reports liveTest: null.
   */
  liveTest?: (app: string, signal?: AbortSignal) => Promise<Check[]>;
}

export function macReadiness(
  options: ReadinessOptions,
  deps: MacReadinessDeps = realMacDeps(options),
): PlatformReadiness {
  const { again } = options;
  // Shared by every quickChecks() call this PlatformReadiness ever returns, and by
  // liveTestNotice: the "terminal" runner's lookup is cached here, so a later runner (or a
  // liveTestNotice read after the checks ran) sees the same terminal app without asking again.
  const terminal = terminalCache(deps);
  return {
    screenReader: "VoiceOver",
    cannotRunYet:
      "voicecap can't run VoiceOver yet: that comes with its VoiceOver driver. For now, run this command on a Windows computer.",
    readyTip: "Tip: turn on Do Not Disturb, so notifications don't interrupt VoiceOver.",
    // A getter, not a fixed array: before the quick checks run (or when none finds a terminal
    // app), it names the fallback; once the "terminal" runner has cached a name, it uses that.
    get liveTestNotice(): string[] {
      return [
        "The live test takes about 20 seconds. VoiceOver speaks and takes over the keyboard, so keep your hands off.",
        `If macOS asks whether ${terminal.name()} can control VoiceOver, click Allow.`,
      ];
    },
    // macOS's own prompt names the terminal app, so this doesn't have to.
    checkingNotice: [
      'Checking this Mac. If macOS asks for access to control "System Events", click Allow.',
    ],
    machineInfo: () => machineInfo(deps),
    quickChecks: () => quickChecks(deps, again, terminal),
    liveTest: withTerminalApp(deps.liveTest, terminal),
  };
}

// ---- Machine info ----

/** The outermost .app bundle containing `executable`, the way terminalAppBundle finds one. */
function appBundleOf(executable: string): string | null {
  return terminalAppBundle([{ pid: 0, ppid: 0, command: executable }], 0);
}

/** The browser voicecap would launch, or null when there's none (the browser check says why). */
function foundBrowser(deps: MacReadinessDeps): BrowserExecutable | null {
  try {
    return deps.resolveBrowser();
  } catch {
    return null;
  }
}

async function machineInfo(deps: MacReadinessDeps): Promise<MachineInfo> {
  const cacheDir = guidepupCacheDir(deps.env, deps.home);
  const browser = foundBrowser(deps);
  const browserBundle = browser ? appBundleOf(browser.path) : null;
  const [system, voiceOver, app, disk, browserVersion] = await Promise.all([
    macSystem(deps.run),
    voiceOverVersion(deps.run),
    terminalApp(deps.run, deps.pid),
    deps.disk(),
    browserBundle ? bundleVersion(deps.run, browserBundle) : Promise.resolve(null),
  ]);

  const username = macPath.basename(deps.home);
  const systemLabel = `macOS ${system.version}`;
  // A part that isn't known is left out.
  const modelName = system.identifier
    ? [system.model, `(${system.identifier})`].filter((part) => part !== null).join(" ")
    : system.model;
  const model = [
    modelName,
    system.chip,
    `${gigabytes(deps.totalmem())} memory`,
    disk && `${gigabytes(disk.free)} free of ${gigabytes(disk.total)}`,
  ].filter((part): part is string => part !== null && part !== undefined && part !== "");
  const terminalValue = app ? `${app.name} (macOS gives permissions to this app)` : "none found";
  const screenReaderLabel = voiceOver ? `VoiceOver ${voiceOver.version}` : "VoiceOver";
  const screenReaderValue = voiceOver
    ? `VoiceOver ${voiceOver.version} (build ${voiceOver.build})`
    : "VoiceOver isn't installed";
  const browserValue = browser
    ? [browser.name, browserVersion].filter((part) => part !== null).join(" ") +
      (browser.playwrightBuild ? " (Playwright's)" : "")
    : "none found";

  return {
    lines: [
      { label: "Computer", value: `${system.computerName ?? "this Mac"}, user ${username}` },
      { label: "Model", value: model.join(", ") },
      { label: "System", value: `${systemLabel} (${system.build}), ${system.arch}` },
      { label: "Terminal app", value: terminalValue },
      { label: "Node.js", value: deps.nodeVersion },
      {
        label: "voicecap",
        value: `${deps.voicecapVersion}, with @guidepup/guidepup ${deps.guidepup.version}`,
      },
      { label: "Screen reader", value: screenReaderValue },
      { label: "Browser", value: browserValue },
      { label: "Language", value: languageName(system.locale) ?? "unknown" },
      { label: "Transcripts", value: deps.transcripts },
      { label: "Guidepup files", value: cacheDir },
      ...(browser
        ? [{ label: "Browser path", value: homePath(browser.path, deps.home, macPath) }]
        : []),
    ],
    screenReader: screenReaderLabel,
    system: systemLabel,
  };
}

// ---- Quick checks ----

/**
 * `app`'s name for a check's text, or the fallback voicecap uses when no terminal app was found.
 * Mac setup names the app the same way.
 */
export function appName(app: { name: string; bundle: string } | null): string {
  return app?.name ?? "the app voicecap runs in";
}

/**
 * Looks up the terminal app once (get() memoizes the lookup itself) and remembers what it found
 * (or that it found nothing) so name() can report it synchronously afterwards — for
 * liveTestNotice, read after the quick checks have run. Before get() has resolved, name() gives
 * the same fallback as an app-less lookup: there's nothing yet to tell "not run yet" from "ran,
 * found nothing" for a person reading the notice.
 */
interface TerminalCache {
  get(): Promise<{ name: string; bundle: string } | null>;
  name(): string;
}

function terminalCache(deps: MacReadinessDeps): TerminalCache {
  let promise: Promise<{ name: string; bundle: string } | null> | null = null;
  let found: { name: string; bundle: string } | null = null;
  return {
    get: () => {
      promise ??= terminalApp(deps.run, deps.pid).then((app) => {
        found = app;
        return app;
      });
      return promise;
    },
    name: () => appName(found),
  };
}

/**
 * The live test, given the terminal app's name through the same cache, so it names the app the
 * quick checks found without looking again (or looks now, when the checks haven't run).
 */
function withTerminalApp(
  liveTest: MacReadinessDeps["liveTest"],
  terminal: TerminalCache,
): PlatformReadiness["liveTest"] {
  if (!liveTest) return null;
  return async (signal) => liveTest(appName(await terminal.get()), signal);
}

function assetStatus(deps: MacReadinessDeps): {
  cacheDir: string;
  macOS: number;
  supported: string[];
  file: string | null;
} {
  const cacheDir = guidepupCacheDir(deps.env, deps.home);
  const macOS = macOSForDarwin(deps.darwinMajor);
  const { supported, file } = voiceOverAsset(deps.guidepup.manifest, deps.darwinMajor, cacheDir);
  return { cacheDir, macOS, supported, file };
}

function versionCheck(deps: MacReadinessDeps): Check {
  const { macOS, supported, file } = assetStatus(deps);
  if (file !== null) {
    return { id: "version", status: "OK", summary: `macOS ${macOS} is supported` };
  }
  const first = supported[0] ?? "unknown";
  const last = supported[supported.length - 1] ?? "unknown";
  return {
    id: "version",
    status: "FAIL",
    summary: `macOS ${macOS} isn't supported by voicecap's Guidepup`,
    problem: {
      title: `macOS ${macOS}`,
      whatsWrong: `voicecap drives VoiceOver through Guidepup ${deps.guidepup.version}, which supports macOS ${first} through ${last}.`,
      fix: ["Use a Mac with a supported version of macOS."],
      setupHelps: false,
    },
  };
}

function terminalCheck(app: { name: string; bundle: string } | null, again: string): Check {
  if (app) {
    return { id: "terminal", status: "OK", summary: `Terminal app: ${app.name}` };
  }
  return {
    id: "terminal",
    status: "FAIL",
    summary: "No terminal app found",
    problem: {
      title: "The terminal app",
      whatsWrong:
        "macOS gives the permissions VoiceOver automation needs to an app, such as Terminal or Visual Studio Code, and voicecap isn't running inside one (over SSH, for example).",
      fix: [`Open Terminal (or Visual Studio Code) on this Mac and run ${again} there.`],
      setupHelps: false,
    },
  };
}

function assetsCheck(deps: MacReadinessDeps): Check {
  const { cacheDir, file } = assetStatus(deps);
  if (file !== null && deps.exists(file)) {
    return { id: "assets", status: "OK", summary: "VoiceOver's files for Guidepup are installed" };
  }
  return {
    id: "assets",
    status: "FAIL",
    summary: "VoiceOver's files for Guidepup aren't installed",
    problem: {
      title: "VoiceOver's files for Guidepup",
      whatsWrong: `Guidepup starts VoiceOver with its own settings file, which isn't in ${cacheDir} yet.`,
      fix: ["Run npx @icjia/voicecap setup."],
      setupHelps: true,
    },
  };
}

function appleScriptCheck(deps: MacReadinessDeps, again: string): Check {
  if (deps.exists(APPLESCRIPT_ENABLED_FILE)) {
    return {
      id: "appleScript",
      status: "OK",
      summary: "VoiceOver can be controlled by AppleScript",
    };
  }
  return {
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
        `Run ${again} again.`,
      ],
      setupHelps: true,
      open: { kind: "app", name: "VoiceOver Utility" },
    },
  };
}

async function welcomeCheck(deps: MacReadinessDeps): Promise<Check> {
  const value = await readDefault(deps.run, "com.apple.VoiceOverTraining", "doNotShowSplashScreen");
  if (value === "1") {
    return { id: "welcome", status: "OK", summary: "VoiceOver's welcome screen is off" };
  }
  return {
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
  };
}

async function accessibilityCheck(
  deps: MacReadinessDeps,
  app: { name: string; bundle: string } | null,
  again: string,
): Promise<Check> {
  const name = appName(app);
  const trusted = await accessibilityTrusted(deps.run);
  if (trusted) {
    return { id: "accessibility", status: "OK", summary: `Accessibility: ${name} is allowed` };
  }
  return {
    id: "accessibility",
    status: "FAIL",
    summary: `Accessibility: ${name} isn't allowed`,
    problem: {
      title: `Accessibility for ${name}`,
      whatsWrong: `voicecap presses VoiceOver's keys through macOS's Accessibility features, which need your OK for ${name}.`,
      fix: [
        "Open System Settings, then Privacy & Security, then Accessibility.",
        `Switch on ${name}. If it isn't listed, click + and choose it.`,
        `Run ${again} again.`,
      ],
      setupHelps: true,
      open: SETTINGS_PAGES.accessibility,
    },
  };
}

/**
 * Predicts what Guidepup 0.34.0's start needs before it links voicecap's VoiceOver settings in
 * (mountGuidepupPreferences): VoiceOver's own settings file in the folder Guidepup chooses, and
 * the right to create files there, which macOS 26 gives only with Full Disk Access in VoiceOver's
 * group container. Without the settings file, it writes nothing: Full Disk Access can't help.
 */
async function fullDiskAccessCheck(
  deps: MacReadinessDeps,
  app: { name: string; bundle: string } | null,
  again: string,
): Promise<Check> {
  const name = appName(app);
  const prefs = guidepupPrefsDir(deps.home, deps.exists);
  if (!deps.exists(`${prefs.dir}/${VOICEOVER_LOCAL_PREFS}`)) return voiceOverNotSetUp(again);
  const result = await deps.writeVoiceOverPrefs(prefs.dir);
  if (result.ok) {
    return {
      id: "fullDiskAccess",
      status: "OK",
      summary: prefs.groupContainer
        ? `Full Disk Access: ${name} is allowed`
        : "Full Disk Access: not needed on this Mac",
    };
  }
  const summary =
    result.code === "EPERM"
      ? `Full Disk Access: ${name} isn't allowed`
      : `Full Disk Access: couldn't write to VoiceOver's settings folder (${result.code})`;
  return {
    id: "fullDiskAccess",
    status: "FAIL",
    summary,
    problem: {
      title: `Full Disk Access for ${name}`,
      whatsWrong: `voicecap keeps its VoiceOver settings apart from yours by linking them into a folder macOS protects, and macOS blocks ${name} from that folder.`,
      fix: [
        "Open System Settings, then Privacy & Security, then Full Disk Access.",
        `Switch on ${name}. If it isn't listed, click + and choose it.`,
        `When macOS asks, quit and reopen ${name}.`,
        `Run ${again} again.`,
      ],
      setupHelps: true,
      open: SETTINGS_PAGES.fullDiskAccess,
      needsRestart: true,
    },
  };
}

/**
 * VoiceOver has never been turned on for this user, so its own settings file, which Guidepup's
 * start needs, isn't there yet. Turning VoiceOver on once creates it.
 */
function voiceOverNotSetUp(again: string): Check {
  return {
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
        `Run ${again} again.`,
      ],
      setupHelps: false,
    },
  };
}

async function systemEventsCheck(
  deps: MacReadinessDeps,
  app: { name: string; bundle: string } | null,
  again: string,
): Promise<Check> {
  const name = appName(app);
  const answer = await systemEventsAccess(deps.run);
  if (answer.ok) {
    return { id: "systemEvents", status: "OK", summary: `${name} can control System Events` };
  }
  if (answer.reason === "denied") {
    return {
      id: "systemEvents",
      status: "FAIL",
      summary: `${name} isn't allowed to control System Events`,
      problem: automationDeniedProblem(name, "System Events", again),
    };
  }
  if (answer.reason === "no-answer") {
    return {
      id: "systemEvents",
      status: "FAIL",
      summary: "No answer from System Events in 60 seconds",
      problem: permissionPromptProblem(name, "System Events", again),
    };
  }
  return {
    id: "systemEvents",
    status: "FAIL",
    summary:
      answer.message === ""
        ? "System Events didn't answer"
        : `System Events didn't answer: ${answer.message}`,
    problem: {
      title: "System Events",
      whatsWrong: messageOr(
        answer.message,
        "System Events didn't answer voicecap's question, and macOS gave no reason.",
      ),
      fix: [`Run ${again} again.`],
      setupHelps: false,
    },
  };
}

async function voiceOverOnCheck(deps: MacReadinessDeps): Promise<Check> {
  const running = await voiceOverRunning(deps.run);
  if (running) {
    return {
      id: "voiceOverOn",
      status: "WARN",
      summary: "VoiceOver is on: voicecap will use it, then turn it back on with your settings",
    };
  }
  return { id: "voiceOverOn", status: "OK", summary: "VoiceOver is off" };
}

/**
 * `terminal` is shared with the PlatformReadiness object's liveTestNotice getter (see
 * macReadiness): every runner below that needs the terminal app's name reads it through the same
 * cache, however many times quickChecks() itself is called.
 */
function quickChecks(
  deps: MacReadinessDeps,
  again: string,
  terminal: TerminalCache,
): CheckRunner[] {
  return [
    { id: "version", run: () => Promise.resolve(versionCheck(deps)) },
    { id: "node", run: () => Promise.resolve(nodeCheck(deps.nodeVersion, again)) },
    { id: "terminal", run: async () => terminalCheck(await terminal.get(), again) },
    { id: "assets", run: () => Promise.resolve(assetsCheck(deps)) },
    { id: "appleScript", run: () => Promise.resolve(appleScriptCheck(deps, again)) },
    { id: "welcome", run: () => welcomeCheck(deps) },
    { id: "accessibility", run: async () => accessibilityCheck(deps, await terminal.get(), again) },
    {
      id: "fullDiskAccess",
      run: async () => fullDiskAccessCheck(deps, await terminal.get(), again),
    },
    { id: "systemEvents", run: async () => systemEventsCheck(deps, await terminal.get(), again) },
    {
      id: "otherVoicecap",
      run: async () =>
        otherVoicecapCheck(await deps.otherVoicecap(), deps.lockFile, "VoiceOver", again),
    },
    { id: "browser", run: () => Promise.resolve(browserCheck(deps.resolveBrowser)) },
    { id: "voiceOverOn", run: () => voiceOverOnCheck(deps) },
  ];
}

// ---- Real deps ----

/** Guidepup's own version and its manifest.json (unparsed beyond JSON, so voiceOverAsset reads it). */
function readGuidepupManifest(): { version: string; manifest: unknown } {
  const packageJson = createRequire(import.meta.url).resolve("@guidepup/guidepup/package.json");
  const dir = path.dirname(packageJson);
  const { version } = JSON.parse(readFileSync(packageJson, "utf8")) as { version: string };
  const manifest: unknown = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  return { version, manifest };
}

/**
 * The real live test's deps: VoiceOver through Guidepup, the configured browser, the check page
 * served on 127.0.0.1, and the VoiceOver lock. Making them starts nothing.
 */
export function realMacLiveDeps(
  options: ReadinessOptions,
  lockFile: string,
  app: string,
): MacLiveDeps {
  return {
    run: runCommand,
    app,
    again: options.again,
    loadVoiceOver: loadGuidepupVoiceOver,
    launchBrowser: (launchSignal) =>
      launchChrome({ browser: options.config.browser, env: options.env, signal: launchSignal }),
    serveCheckPage,
    lock: () => lockVoiceOver(lockFile),
    sleep: pause,
    warn: (message) => options.logger.alert(message),
    // Ahead of the exit listeners already added, the VoiceOver lock's included: the lock goes
    // only once the hook has put VoiceOver back, so no other voicecap takes it meanwhile.
    onExit: (hook) => {
      process.prependListener("exit", hook);
      return () => process.removeListener("exit", hook);
    },
    runSync: runCommandSync,
    sleepSync: pauseSync,
    now: () => performance.now(),
  };
}

/** The real live test, with realMacLiveDeps. */
function realLiveTest(
  options: ReadinessOptions,
  lockFile: string,
  app: string,
  signal?: AbortSignal,
): Promise<Check[]> {
  return macLiveTest(realMacLiveDeps(options, lockFile, app), signal);
}

function realMacDeps(options: ReadinessOptions): MacReadinessDeps {
  const home = os.homedir();
  const guidepup = readGuidepupManifest();
  const lockFile = voiceOverLockFile(home);
  return {
    run: runCommand,
    pid: process.pid,
    home,
    env: options.env,
    nodeVersion: process.versions.node,
    voicecapVersion: voicecapVersion(),
    guidepup,
    darwinMajor: Number(os.release().split(".")[0]),
    exists: existsSync,
    writeVoiceOverPrefs: (dir) => canWriteVoiceOverPrefs(dir),
    otherVoicecap: () => activeLockHolder(lockFile),
    lockFile,
    resolveBrowser: () => resolveBrowser(options.config.browser, options.env),
    transcripts: resolveHome({ env: options.env, cwd: options.cwd }),
    totalmem: () => os.totalmem(),
    disk: () => diskSpace(home),
    liveTest: (app, signal) => realLiveTest(options, lockFile, app, signal),
  };
}
