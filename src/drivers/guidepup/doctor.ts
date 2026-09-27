/**
 * voicecap doctor: check the environment and print a summary to paste into a bug report.
 *
 * The live check runs the real driver against a tiny page served on 127.0.0.1: NVDA starts, the
 * browser comes to the front (checked with NVDA+T), and speech is captured, exactly as in a run.
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import os from "node:os";

import type { VoicecapConfig } from "../../config/schema.js";
import { InterruptedError, withTimeout } from "../../passes/steps.js";
import { errorMessage, ExitCode } from "../../util/errors.js";
import { isStale, readLockHolder, type LockHolder } from "../../util/lock-file.js";
import type { Logger } from "../../util/log.js";
import { voicecapVersion } from "../../util/version.js";
import { createGuidepupNvdaDriver } from "../guidepup-nvda.js";
import {
  ForegroundError,
  type EnvironmentInfo,
  type ScreenReaderDriver,
  type Speech,
} from "../types.js";
import { resolveBrowser, type BrowserExecutable } from "./chrome.js";
import {
  guidepupInstall,
  nvdaLockFile,
  nvdaVersionFromBuild,
  readGuidepupPackage,
  unsafePathMessage,
  type GuidepupInstall,
  type GuidepupPackage,
} from "./paths.js";
import { listProcesses, sessionLocked, windowsSystemInfo } from "./windows.js";

/** What the live check saw. */
export interface LiveCheck {
  environment: EnvironmentInfo;
  /** What NVDA said for the check's steps (the top of the page, then the first Tab). */
  speech: Speech[];
  /** Average time per step. */
  stepMs: number;
}

export interface DoctorDeps {
  platform: NodeJS.Platform;
  nodeVersion: string;
  voicecapVersion: string;
  guidepup: GuidepupPackage;
  setupVersion: string;
  install: GuidepupInstall;
  exists: (file: string) => boolean;
  runningNvda: () => Promise<number[]>;
  /** Another voicecap holding the NVDA lock, if one is running. */
  otherVoicecap: () => Promise<LockHolder | null>;
  /** The NVDA lock's file. */
  nvdaLockFile: string;
  /** Whether Windows is locked (null when it doesn't say). */
  sessionLocked: () => Promise<boolean | null>;
  system: () => { os: string; uiLocale: string | null };
  resolveBrowser: () => BrowserExecutable;
  /** Start NVDA and the browser, open a test page, and capture a few steps. */
  liveCheck: (signal?: AbortSignal) => Promise<LiveCheck>;
  now: () => Date;
}

type Status = "OK" | "WARN" | "FAIL";

interface Check {
  status: Status;
  name: string;
  detail: string;
}

/** The oldest Node.js voicecap supports (package.json engines; @guidepup/setup needs it). */
const MIN_NODE = [22, 19, 0];

/**
 * Returns the exit code: 0 when everything voicecap needs works, 2 otherwise, and 130 when the
 * signal (Ctrl+C) stops the live check.
 */
export async function runDoctor(
  options: { config: VoicecapConfig; logger: Logger; signal?: AbortSignal },
  deps: DoctorDeps = realDoctorDeps(options),
): Promise<number> {
  const checks: Check[] = [];
  const add = (status: Status, name: string, detail: string) =>
    checks.push({ status, name, detail });

  if (deps.platform !== "win32") {
    add("FAIL", "Windows", `this is ${deps.platform}; NVDA runs only on Windows`);
    return report(options.logger, deps, checks);
  }
  add("OK", "Windows", deps.system().os);
  add(
    nodeIsSupported(deps.nodeVersion) ? "OK" : "FAIL",
    "Node.js",
    nodeIsSupported(deps.nodeVersion)
      ? deps.nodeVersion
      : `${deps.nodeVersion}; voicecap needs ${MIN_NODE.join(".")} or later`,
  );
  add("OK", "voicecap", deps.voicecapVersion);
  add(
    "OK",
    "Guidepup",
    `@guidepup/guidepup ${deps.guidepup.version}, @guidepup/setup ${deps.setupVersion}`,
  );

  const { install } = deps;
  let canStart = true;
  const unsafePath = unsafePathMessage(install);
  if (unsafePath) {
    add("FAIL", "Guidepup folder", unsafePath);
    canStart = false;
  }
  const nvdaVersion = nvdaVersionFromBuild(install.build) ?? install.build;
  if (deps.exists(install.nvdaExe)) {
    add(
      "OK",
      "NVDA build",
      `${install.build} (NVDA ${nvdaVersion}), installed at ${install.nvdaExe}`,
    );
  } else {
    add("FAIL", "NVDA build", `${install.build} isn't installed; run: npx @icjia/voicecap setup`);
    canStart = false;
  }

  const running = await deps.runningNvda();
  const other = await deps.otherVoicecap();
  if (other) {
    add(
      "FAIL",
      "Other voicecap",
      `process ${other.pid} (started ${other.startedAt}) is using NVDA, so NVDA can't be checked now. Run voicecap doctor again when it has finished. If no other voicecap is running, delete its lock: ${deps.nvdaLockFile}`,
    );
    canStart = false;
  }
  add(
    running.length > 0 ? "WARN" : "OK",
    "Other NVDA",
    running.length === 0
      ? "none running"
      : other
        ? `running (process ${running.join(", ")}), most likely the other voicecap's`
        : `running (process ${running.join(", ")}); voicecap shuts it down when it starts NVDA`,
  );

  const locked = await deps.sessionLocked();
  if (locked === true) {
    add(
      "FAIL",
      "Session",
      "Windows is locked, so NVDA can't press keys or speak. Unlock the computer, then run voicecap doctor again.",
    );
    canStart = false;
  } else {
    add(
      locked === false ? "OK" : "WARN",
      "Session",
      locked === false
        ? "unlocked"
        : "Windows didn't say whether it's locked; keep it unlocked while voicecap runs",
    );
  }

  let browser: BrowserExecutable | null = null;
  try {
    browser = deps.resolveBrowser();
  } catch (error) {
    add("FAIL", "Browser", errorMessage(error));
    canStart = false;
  }

  if (canStart && browser) {
    options.logger.info(
      "Starting NVDA and the browser for a short check (about 20 seconds). Don't use the keyboard or mouse until it's done.",
    );
    try {
      const live = await deps.liveCheck(options.signal);
      const version = live.environment.browser?.version;
      add("OK", "Browser", `${browser.name}${version ? ` ${version}` : ""} (${browser.path})`);
      if (live.speech.every((speech) => speech.trim() !== "")) {
        add(
          "OK",
          "NVDA speech",
          `captured ("${live.speech.join('" / "')}"), ${(live.stepMs / 1000).toFixed(1)} s per step`,
        );
      } else {
        add(
          "FAIL",
          "NVDA speech",
          "NVDA started, but voicecap captured no speech from it. Try again; if it persists, run voicecap setup again.",
        );
      }
      add("OK", "Foreground", "the browser came to the front (checked with NVDA+T)");
      const language = live.environment.screenReader?.language ?? null;
      const english = language?.toLowerCase().startsWith("en") ?? false;
      add(
        english ? "OK" : "WARN",
        "NVDA language",
        english
          ? (language ?? "")
          : `${language ?? "unknown"}; voicecap's end-of-page detection and flags expect NVDA's English phrasing`,
      );
    } catch (error) {
      if (error instanceof InterruptedError) {
        options.logger.warn("Interrupted: NVDA and the browser were shut down.");
        return ExitCode.interrupted;
      }
      add("OK", "Browser", `${browser.name} (${browser.path})`);
      add(
        "FAIL",
        error instanceof ForegroundError ? "Foreground" : "Live check",
        errorMessage(error),
      );
    }
  } else if (browser) {
    add("OK", "Browser", `${browser.name} (${browser.path})`);
  }
  return report(options.logger, deps, checks);
}

function report(logger: Logger, deps: DoctorDeps, checks: Check[]): number {
  const stamp = deps.now();
  const pad = (n: number) => String(n).padStart(2, "0");
  const when = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;
  const failures = checks.filter((check) => check.status === "FAIL").length;
  const lines = [
    `voicecap doctor, ${when}`,
    "",
    ...checks.map((check) => `${check.status.padEnd(6)}${check.name}: ${check.detail}`),
    "",
    failures === 0
      ? "Everything voicecap needs is working."
      : `${failures} problem${failures === 1 ? "" : "s"}: fix the FAIL lines above, then run voicecap doctor again.`,
  ];
  logger.info(lines.join("\n"));
  return failures === 0 ? 0 : 2;
}

function nodeIsSupported(version: string): boolean {
  const parts = version.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < MIN_NODE.length; i++) {
    const have = parts[i] ?? 0;
    const need = MIN_NODE[i] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}

const CHECK_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>voicecap doctor</title></head>
  <body>
    <main>
      <h1>voicecap doctor check</h1>
      <p>If NVDA reads this, voicecap can hear it.</p>
      <button type="button">Doctor button</button>
    </main>
  </body>
</html>
`;

/** The real live check: the Guidepup driver against CHECK_PAGE, served on 127.0.0.1. */
async function realLiveCheck(
  options: { config: VoicecapConfig; logger: Logger },
  signal?: AbortSignal,
): Promise<LiveCheck> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(CHECK_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const driver = createGuidepupNvdaDriver(options);
    return await runLiveCheck(driver, `http://127.0.0.1:${port}/`, options.config, signal, (note) =>
      options.logger.info(`Cleaned up: ${note}`),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * Start the driver, open the page, and capture two steps, with a run's timeouts, stopping when
 * the signal (Ctrl+C) aborts. NVDA and the browser are stopped however it ends.
 */
export async function runLiveCheck(
  driver: ScreenReaderDriver,
  url: string,
  config: VoicecapConfig,
  signal?: AbortSignal,
  onCleanup: (note: string) => void = () => {},
): Promise<LiveCheck> {
  const { stepMs, driverStartMs } = config.timeouts;
  const within = <T>(what: string, action: () => Promise<T>, ms: number) =>
    withTimeout(what, action, ms, signal);
  try {
    const notes = await within(
      "Cleaning up after earlier runs",
      () => driver.cleanupStale(),
      driverStartMs,
    );
    for (const note of notes) onCleanup(note);
    await within("Starting NVDA and the browser", () => driver.start(), driverStartMs);
    const environment = await within(
      "Reading the environment",
      () => driver.getEnvironmentInfo(),
      stepMs,
    );
    await within(
      "Opening the check page",
      () => driver.openPage(url),
      config.readiness.networkIdleTimeoutMs + stepMs,
    );
    const started = performance.now();
    const speech = [
      await within("Moving to the top of the page", () => driver.toTop(), stepMs),
      await within("Pressing Tab", () => driver.nextFocusable(), stepMs),
    ];
    return { environment, speech, stepMs: (performance.now() - started) / speech.length };
  } finally {
    await driver.stop();
  }
}

/** Another voicecap holding the NVDA lock (a run, or another doctor), if one is running. */
async function otherVoicecap(lockFile: string): Promise<LockHolder | null> {
  const holder = await readLockHolder(lockFile);
  return holder && holder.pid !== process.pid && !isStale(holder) ? holder : null;
}

function realDoctorDeps(options: { config: VoicecapConfig; logger: Logger }): DoctorDeps {
  const guidepup = readGuidepupPackage();
  const lockFile = nvdaLockFile(process.env, os.homedir());
  const setupPackageJson = createRequire(import.meta.url).resolve("@guidepup/setup/package.json");
  const { version: setupVersion } = JSON.parse(readFileSync(setupPackageJson, "utf8")) as {
    version: string;
  };
  return {
    platform: process.platform,
    nodeVersion: process.versions.node,
    voicecapVersion: voicecapVersion(),
    guidepup,
    setupVersion,
    install: guidepupInstall(guidepup.nvdaBuild, process.env, os.homedir()),
    exists: existsSync,
    runningNvda: () => listProcesses("nvda.exe"),
    otherVoicecap: () => otherVoicecap(lockFile),
    sessionLocked,
    nvdaLockFile: lockFile,
    system: windowsSystemInfo,
    resolveBrowser: () => resolveBrowser(options.config.browser, process.env),
    liveCheck: (signal) => realLiveCheck(options, signal),
    now: () => new Date(),
  };
}
