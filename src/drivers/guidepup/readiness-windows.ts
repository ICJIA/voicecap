/**
 * Windows readiness: this computer, NVDA and the browser described, today's doctor checks as
 * quick checks (plus the person's own NVDA), and the live test with the Guidepup NVDA driver.
 * src/drivers/readiness.ts loads it on Windows only.
 */
import { existsSync } from "node:fs";
import os from "node:os";

import { InterruptedError } from "../../passes/steps.js";
import { browserCheck, nodeCheck, otherVoicecapCheck } from "../../readiness/common-checks.js";
import { runLiveCheck, serveCheckPage, type LiveCheck } from "../../readiness/live-check.js";
import { diskSpace, gigabytes, languageName } from "../../readiness/machine.js";
import type { Check, CheckRunner, MachineInfo, PlatformReadiness } from "../../readiness/model.js";
import { resolveHome } from "../../run/paths.js";
import { errorMessage } from "../../util/errors.js";
import { activeLockHolder, type LockHolder } from "../../util/lock-file.js";
import { voicecapVersion } from "../../util/version.js";
import { createGuidepupNvdaDriver } from "../guidepup-nvda.js";
import type { ReadinessOptions } from "../readiness.js";
import { ForegroundError } from "../types.js";
import { resolveBrowser, type BrowserExecutable } from "./chrome.js";
import {
  guidepupInstall,
  nvdaLockFile,
  nvdaVersionFromBuild,
  readGuidepupPackage,
  unsafePathProblem,
  type GuidepupInstall,
  type GuidepupPackage,
} from "./paths.js";
import {
  nvdaProcesses,
  personsNvda,
  sessionLocked,
  windowsBrowserVersion,
  windowsComputerModel,
  windowsSystemInfo,
  type NvdaProcess,
} from "./windows.js";

/** Everything the Windows checks read from the computer, so tests can fake it. */
export interface WindowsReadinessDeps {
  nodeVersion: string;
  voicecapVersion: string;
  guidepup: GuidepupPackage;
  install: GuidepupInstall;
  exists: (file: string) => boolean;
  /** Every running nvda.exe, Guidepup's or the person's. */
  nvdaProcesses: () => Promise<NvdaProcess[]>;
  /** Another voicecap holding the NVDA lock, if one is running. */
  otherVoicecap: () => Promise<LockHolder | null>;
  /** The NVDA lock's file. */
  nvdaLockFile: string;
  /** Whether Windows is locked (null when it doesn't say). */
  sessionLocked: () => Promise<boolean | null>;
  system: () => { os: string; uiLocale: string | null };
  /** The computer's maker and model, e.g. "Dell Inc. OptiPlex 7010". */
  computerModel: () => Promise<string | null>;
  hostname: () => string;
  username: () => string;
  /** The processor's name. */
  cpu: () => string | null;
  /** Memory, in bytes. */
  totalmem: () => number;
  /** Free and total bytes on the disk that holds the home folder. */
  disk: () => Promise<{ free: number; total: number } | null>;
  /** The browser voicecap would launch; throws when there's none. */
  resolveBrowser: () => BrowserExecutable;
  /** The version of the browser whose executable this is. */
  browserVersion: (file: string) => Promise<string | null>;
  /** Where transcripts are written. */
  transcripts: string;
  /** Start NVDA and the browser, open the check page, and capture a few steps. */
  liveCheck: (signal?: AbortSignal) => Promise<LiveCheck>;
}

export function windowsReadiness(
  options: ReadinessOptions,
  deps: WindowsReadinessDeps = realWindowsDeps(options),
): PlatformReadiness {
  const { again } = options;
  return {
    screenReader: "NVDA",
    cannotRunYet: null,
    readyTip: null,
    liveTestNotice: [
      "The live test takes about 20 seconds. NVDA speaks and takes over the keyboard, so keep your hands off.",
    ],
    // Windows' checks raise no prompt.
    checkingNotice: [],
    machineInfo: () => machineInfo(deps),
    quickChecks: () => quickChecks(deps, again),
    liveTest: (signal) => liveTest(deps, again, signal),
  };
}

/** The NVDA version in Guidepup's build, e.g. "2026.2" (the whole build id if it has none). */
function nvdaVersion(install: GuidepupInstall): string {
  return nvdaVersionFromBuild(install.build) ?? install.build;
}

async function machineInfo(deps: WindowsReadinessDeps): Promise<MachineInfo> {
  const { install } = deps;
  const browser = foundBrowser(deps);
  const [model, disk, browserVersion] = await Promise.all([
    deps.computerModel(),
    deps.disk(),
    browser ? deps.browserVersion(browser.path) : null,
  ]);
  const system = deps.system();
  // A part that isn't known is left out.
  const hardware = [
    model,
    deps.cpu(),
    `${gigabytes(deps.totalmem())} memory`,
    disk && `${gigabytes(disk.free)} free of ${gigabytes(disk.total)}`,
  ].filter((part) => part !== null);
  const browserName = browser
    ? [browser.name, browserVersion].filter((part) => part !== null).join(" ")
    : "none found";
  return {
    lines: [
      { label: "Computer", value: `${deps.hostname()}, user ${deps.username()}` },
      { label: "Model", value: hardware.join(", ") },
      { label: "System", value: `${system.os}, ${process.arch}` },
      { label: "Node.js", value: deps.nodeVersion },
      {
        label: "voicecap",
        value: `${deps.voicecapVersion}, with @guidepup/guidepup ${deps.guidepup.version}`,
      },
      {
        label: "Screen reader",
        value: `NVDA ${nvdaVersion(install)} (Guidepup's build ${install.build})`,
      },
      { label: "Browser", value: browserName },
      { label: "Language", value: languageName(system.uiLocale) ?? "unknown" },
      { label: "Transcripts", value: deps.transcripts },
      { label: "Guidepup files", value: install.cacheDir },
      ...(browser ? [{ label: "Browser path", value: browser.path }] : []),
    ],
    screenReader: `NVDA ${nvdaVersion(install)}`,
    system: system.os,
  };
}

/** The browser voicecap would launch, or null when there's none (the browser check says why). */
function foundBrowser(deps: WindowsReadinessDeps): BrowserExecutable | null {
  try {
    return deps.resolveBrowser();
  } catch {
    return null;
  }
}

function quickChecks(deps: WindowsReadinessDeps, again: string): CheckRunner[] {
  return [
    { id: "node", run: () => Promise.resolve(nodeCheck(deps.nodeVersion, again)) },
    { id: "guidepupFolder", run: () => Promise.resolve(guidepupFolderCheck(deps.install)) },
    { id: "nvda", run: () => Promise.resolve(nvdaCheck(deps)) },
    {
      id: "otherVoicecap",
      run: async () =>
        otherVoicecapCheck(await deps.otherVoicecap(), deps.nvdaLockFile, "NVDA", again),
    },
    { id: "ownNvda", run: () => ownNvdaCheck(deps) },
    { id: "session", run: async () => sessionCheck(await deps.sessionLocked(), again) },
    { id: "browser", run: () => Promise.resolve(browserCheck(deps.resolveBrowser)) },
  ];
}

function guidepupFolderCheck(install: GuidepupInstall): Check {
  const problem = unsafePathProblem(install);
  if (!problem) {
    return {
      id: "guidepupFolder",
      status: "OK",
      summary: `Guidepup's folder: ${install.cacheDir}`,
    };
  }
  return {
    id: "guidepupFolder",
    status: "FAIL",
    summary: "Guidepup's folder has a path NVDA can't start from",
    problem: { title: "Guidepup's folder", ...problem, setupHelps: false },
  };
}

function nvdaCheck(deps: WindowsReadinessDeps): Check {
  const { install } = deps;
  if (deps.exists(install.nvdaExe)) {
    return {
      id: "nvda",
      status: "OK",
      summary: `NVDA ${nvdaVersion(install)} (Guidepup's build ${install.build}) is installed`,
    };
  }
  return {
    id: "nvda",
    status: "FAIL",
    summary: "NVDA for voicecap isn't installed",
    problem: {
      title: "NVDA for voicecap",
      whatsWrong: `voicecap uses Guidepup's own copy of NVDA (build ${install.build}), and it isn't installed yet.`,
      fix: ["Run npx @icjia/voicecap setup."],
      setupHelps: true,
    },
  };
}

/**
 * WARN when an nvda.exe other than Guidepup's is running (personsNvda). Never a FAIL: not knowing
 * about the person's own NVDA doesn't stop a run.
 */
async function ownNvdaCheck(deps: WindowsReadinessDeps): Promise<Check> {
  let running: NvdaProcess[];
  try {
    running = await deps.nvdaProcesses();
  } catch (error) {
    return {
      id: "ownNvda",
      status: "WARN",
      summary: `Couldn't tell whether your NVDA is running (${errorMessage(error)})`,
    };
  }
  const yours = personsNvda(running, deps.install.nvdaExe);
  if (yours.length === 0) {
    return { id: "ownNvda", status: "OK", summary: "Your NVDA isn't running" };
  }
  // voicecap can start the person's NVDA again only from its path.
  const canRestart = yours.some((nvda) => nvda.path !== null);
  return {
    id: "ownNvda",
    status: "WARN",
    summary: canRestart
      ? "Your NVDA is running: voicecap will use its own NVDA, then turn yours back on"
      : "Your NVDA is running: voicecap will use its own NVDA. Afterwards, start yours again the way you usually do",
  };
}

function sessionCheck(locked: boolean | null, again: string): Check {
  if (locked === false) return { id: "session", status: "OK", summary: "Windows is unlocked" };
  if (locked === null) {
    return {
      id: "session",
      status: "WARN",
      summary: "Windows didn't say whether it's locked: keep it unlocked while voicecap runs",
    };
  }
  return {
    id: "session",
    status: "FAIL",
    summary: "Windows is locked",
    problem: {
      title: "Windows is locked",
      whatsWrong: "NVDA can't press keys or speak while Windows is locked.",
      fix: ["Unlock the computer.", `Run ${again} again.`],
      setupHelps: false,
    },
  };
}

/** The live check's findings as checks. Ctrl+C (InterruptedError) isn't a finding: it's rethrown. */
async function liveTest(
  deps: WindowsReadinessDeps,
  again: string,
  signal?: AbortSignal,
): Promise<Check[]> {
  let live: LiveCheck;
  try {
    live = await deps.liveCheck(signal);
  } catch (error) {
    if (error instanceof InterruptedError) throw error;
    return [liveFailure(error, again)];
  }
  return [
    speechCheck(live, again),
    {
      id: "liveFront",
      status: "OK",
      summary: "The browser came to the front (checked with NVDA+T)",
    },
    languageCheck(live),
  ];
}

function speechCheck(live: LiveCheck, again: string): Check {
  if (live.speech.every((speech) => speech.trim() !== "")) {
    const said = live.speech.map((speech) => `"${speech}"`).join(" / ");
    const perStep = (live.stepMs / 1000).toFixed(1);
    return {
      id: "liveHear",
      status: "OK",
      summary: `NVDA speaks: ${said} (${perStep} s per step)`,
    };
  }
  return {
    id: "liveHear",
    status: "FAIL",
    summary: "NVDA started, but voicecap heard nothing from it",
    problem: {
      title: "NVDA's speech",
      whatsWrong: "NVDA started, but voicecap captured no speech from it.",
      fix: [`Run ${again} again.`, "If it happens again, run npx @icjia/voicecap setup."],
      setupHelps: true,
    },
  };
}

/** WARN unless NVDA speaks English: voicecap matches NVDA's English phrasing. */
function languageCheck(live: LiveCheck): Check {
  const language = live.environment.screenReader?.language ?? null;
  const name = languageName(language) ?? "unknown";
  if (language?.toLowerCase().startsWith("en")) {
    return { id: "liveLanguage", status: "OK", summary: `NVDA's language: ${name}` };
  }
  return {
    id: "liveLanguage",
    status: "WARN",
    summary: `NVDA's language is ${name}: voicecap's end-of-page detection and flags expect NVDA's English phrasing`,
  };
}

function liveFailure(error: unknown, again: string): Check {
  if (error instanceof ForegroundError) {
    return {
      id: "liveFront",
      status: "FAIL",
      summary: "The browser didn't come to the front",
      problem: {
        title: "The browser's window",
        whatsWrong: error.message,
        fix: ["Don't use the keyboard or mouse during the test.", `Run ${again} again.`],
        setupHelps: false,
      },
    };
  }
  return {
    id: "liveTest",
    status: "FAIL",
    summary: "The live test failed",
    problem: {
      title: "The live test",
      whatsWrong: errorMessage(error),
      fix: [`Run ${again} again.`],
      setupHelps: false,
    },
  };
}

/** The real live check: the Guidepup NVDA driver against the check page, served on 127.0.0.1. */
async function realLiveCheck(options: ReadinessOptions, signal?: AbortSignal): Promise<LiveCheck> {
  const page = await serveCheckPage();
  try {
    const driver = createGuidepupNvdaDriver(options);
    return await runLiveCheck(driver, page.url, options.config, signal, (note) =>
      options.logger.info(`Cleaned up: ${note}`),
    );
  } finally {
    await page.close();
  }
}

function realWindowsDeps(options: ReadinessOptions): WindowsReadinessDeps {
  const guidepup = readGuidepupPackage();
  const home = os.homedir();
  const lockFile = nvdaLockFile(options.env, home);
  // Asked once: it runs reg and PowerShell.
  let system: { os: string; uiLocale: string | null } | null = null;
  return {
    nodeVersion: process.versions.node,
    voicecapVersion: voicecapVersion(),
    guidepup,
    install: guidepupInstall(guidepup.nvdaBuild, options.env, home),
    exists: existsSync,
    nvdaProcesses,
    otherVoicecap: () => activeLockHolder(lockFile),
    nvdaLockFile: lockFile,
    sessionLocked,
    system: () => (system ??= windowsSystemInfo()),
    computerModel: windowsComputerModel,
    hostname: () => os.hostname(),
    username: () => os.userInfo().username,
    cpu: () => os.cpus()[0]?.model.trim() || null,
    totalmem: () => os.totalmem(),
    disk: () => diskSpace(home),
    resolveBrowser: () => resolveBrowser(options.config.browser, options.env),
    browserVersion: windowsBrowserVersion,
    transcripts: resolveHome({ env: options.env, cwd: options.cwd }),
    liveCheck: (signal) => realLiveCheck(options, signal),
  };
}
