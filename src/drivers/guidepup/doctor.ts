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
import { errorMessage } from "../../util/errors.js";
import type { Logger } from "../../util/log.js";
import { voicecapVersion } from "../../util/version.js";
import { createGuidepupNvdaDriver } from "../guidepup-nvda.js";
import { ForegroundError, type EnvironmentInfo, type Speech } from "../types.js";
import { resolveBrowser, type BrowserExecutable } from "./chrome.js";
import {
  guidepupInstall,
  nvdaVersionFromBuild,
  readGuidepupPackage,
  spaceInPathMessage,
  type GuidepupInstall,
  type GuidepupPackage,
} from "./paths.js";
import { listProcesses, windowsSystemInfo } from "./windows.js";

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
  system: () => { os: string; uiLocale: string | null };
  resolveBrowser: () => BrowserExecutable;
  /** Start NVDA and the browser, open a test page, and capture a few steps. */
  liveCheck: () => Promise<LiveCheck>;
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

/** Returns the exit code: 0 when everything voicecap needs works, 2 otherwise. */
export async function runDoctor(
  options: { config: VoicecapConfig; logger: Logger },
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
  if (/\s/.test(install.cacheDir)) {
    add("FAIL", "Guidepup folder", spaceInPathMessage(install));
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
  add(
    running.length > 0 ? "WARN" : "OK",
    "Other NVDA",
    running.length > 0
      ? `running (process ${running.join(", ")}); voicecap shuts it down when it starts NVDA`
      : "none running",
  );

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
      const live = await deps.liveCheck();
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
      add(
        "FAIL",
        error instanceof ForegroundError ? "Foreground" : "NVDA speech",
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
async function realLiveCheck(options: {
  config: VoicecapConfig;
  logger: Logger;
}): Promise<LiveCheck> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(CHECK_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const driver = createGuidepupNvdaDriver(options);
  try {
    for (const note of await driver.cleanupStale()) options.logger.info(`Cleaned up: ${note}`);
    await driver.start();
    const environment = await driver.getEnvironmentInfo();
    await driver.openPage(`http://127.0.0.1:${port}/`);
    const started = performance.now();
    const speech = [await driver.toTop(), await driver.nextFocusable()];
    return { environment, speech, stepMs: (performance.now() - started) / speech.length };
  } finally {
    await driver.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function realDoctorDeps(options: { config: VoicecapConfig; logger: Logger }): DoctorDeps {
  const guidepup = readGuidepupPackage();
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
    system: windowsSystemInfo,
    resolveBrowser: () => resolveBrowser(options.config.browser, process.env),
    liveCheck: () => realLiveCheck(options),
    now: () => new Date(),
  };
}
