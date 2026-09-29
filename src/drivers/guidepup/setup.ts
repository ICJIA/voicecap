/**
 * voicecap setup on Windows: install the NVDA build that voicecap's pinned Guidepup expects, then
 * check the computer.
 *
 * It runs voicecap's own pinned @guidepup/setup (`install nvda`). That installer reads the NVDA
 * build from the manifest.json of whichever @guidepup/guidepup resolves from its working folder,
 * so it runs in voicecap's installed @guidepup/guidepup package: someone running
 * `npx @icjia/voicecap setup` from a site's folder has no Guidepup there. The installer
 * downloads from GitHub (honoring HTTPS_PROXY) into %LOCALAPPDATA%\guidepup
 * (GUIDEPUP_SCREEN_READERS_PATH overrides it). setup also makes sure a browser is available, and
 * ends with the preflight and the offer of the live test. The Mac's setup (voiceover/setup-mac.ts)
 * shares the installer and browser parts.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import type { VoicecapConfig } from "../../config/schema.js";
import type { Prompter } from "../../init/prompt.js";
import { finishSetup } from "../../readiness/guided.js";
import type { PlatformReadiness } from "../../readiness/model.js";
import { runPreflight } from "../../readiness/preflight.js";
import { renderCheckingNotice } from "../../readiness/render.js";
import { EnvironmentError } from "../../util/errors.js";
import type { Logger } from "../../util/log.js";
import { loadPlatformReadiness } from "../readiness.js";
import { resolveBrowser, type BrowserExecutable } from "./chrome.js";
import {
  guidepupInstall,
  readGuidepupPackage,
  unsafePathMessage,
  type GuidepupInstall,
  type GuidepupPackage,
} from "./paths.js";

export interface SetupDeps {
  platform: NodeJS.Platform;
  guidepup: GuidepupPackage;
  /** @guidepup/setup's command-line script. */
  setupCli: { version: string; bin: string };
  /** Playwright's command-line script, to install its Chromium. */
  playwrightCli: string;
  install: GuidepupInstall;
  exists: (file: string) => boolean;
  /** Run a Node.js script with its output on the console; resolves to its exit code. */
  runNode: (script: string, args: string[], cwd: string) => Promise<number>;
  /** The browser to use; throws EnvironmentError when none is installed. */
  resolveBrowser: () => BrowserExecutable;
  /** This computer's readiness checks and live test, for the preflight setup ends with. */
  platformReadiness: () => Promise<PlatformReadiness>;
}

/** What setup needs from the command line: a prompter only when someone can answer. */
export interface SetupOptions {
  config: VoicecapConfig;
  logger: Logger;
  /** Asks whether to run the live test; null when stdin isn't a terminal. */
  prompter: Prompter | null;
}

/**
 * Installs NVDA and the browser, then logs the preflight and, when the computer is ready and
 * someone can answer, offers the live test. Returns the exit code: 0 ready, 2 not ready (or the
 * live test failed), 130 on Ctrl+C during the live test. Throws EnvironmentError when an install
 * fails, or anywhere but Windows.
 */
export async function runSetup(
  options: SetupOptions,
  deps: SetupDeps = realSetupDeps(options),
): Promise<number> {
  const { logger } = options;
  const { install, guidepup } = deps;
  // The CLI runs this only on Windows: a Mac has its own setup (voiceover/setup-mac.ts).
  if (deps.platform !== "win32") {
    throw new EnvironmentError(
      "voicecap's Windows setup installs NVDA, which only runs on Windows.",
    );
  }
  const unsafePath = unsafePathMessage(install);
  if (unsafePath) throw new EnvironmentError(unsafePath);

  logger.info(
    `Installing NVDA for voicecap: Guidepup's NVDA build ${install.build}, which @guidepup/guidepup ${guidepup.version} expects, with @guidepup/setup ${deps.setupCli.version}.`,
  );
  const code = await deps.runNode(deps.setupCli.bin, ["install", "nvda"], guidepup.dir);
  if (code !== 0) {
    throw new EnvironmentError(
      `Installing NVDA failed (the installer exited with code ${code}); its messages are above. It downloads from github.com: behind a proxy, set HTTPS_PROXY (and NO_PROXY), then run voicecap setup again.`,
    );
  }
  if (!deps.exists(install.nvdaExe)) {
    throw new EnvironmentError(
      `The installer finished, but ${install.nvdaExe} isn't there. Run voicecap setup again; if that doesn't help, delete ${install.cacheDir} first.`,
    );
  }
  logger.info(`NVDA ${install.build} is installed: ${install.nvdaExe}`);

  const browser = await ensureBrowser(options, deps);
  logger.info(`Browser: ${browser.name} (${browser.path}).`);
  logger.info(
    [
      "",
      "The first time voicecap starts NVDA, Windows may ask whether NVDA can communicate on networks.",
      "voicecap talks to NVDA only on this computer (127.0.0.1); it doesn't need network access.",
      "",
    ].join("\n"),
  );

  const platform = await deps.platformReadiness();
  const notice = renderCheckingNotice(platform.checkingNotice);
  if (notice) logger.info(notice);
  return finishSetup(platform, await runPreflight(platform), options);
}

/**
 * The configured browser, installing Playwright's Chromium first when that's the configured
 * browser, or the fallback for a missing one. Throws EnvironmentError when there's none to use.
 */
export async function ensureBrowser(
  options: { config: VoicecapConfig; logger: Logger },
  deps: Pick<SetupDeps, "resolveBrowser" | "runNode" | "playwrightCli">,
): Promise<BrowserExecutable> {
  const { channel, fallbackToChromium } = options.config.browser;
  const chromiumConfigured = channel === "chromium";
  try {
    return deps.resolveBrowser();
  } catch (error) {
    if (!(error instanceof EnvironmentError) || !(chromiumConfigured || fallbackToChromium)) {
      throw error;
    }
  }
  options.logger.info(
    chromiumConfigured
      ? "Installing Playwright's Chromium, the configured browser."
      : `The configured browser (${channel}) isn't installed, so voicecap will use Playwright's Chromium. Installing it now. (For transcripts that match what most people use, install Google Chrome.)`,
  );
  const code = await deps.runNode(
    deps.playwrightCli,
    ["install", "chromium"],
    path.dirname(deps.playwrightCli),
  );
  if (code !== 0) {
    const next = chromiumConfigured
      ? "It downloads from Playwright's servers: behind a proxy, set HTTPS_PROXY (and NO_PROXY), then run voicecap setup again."
      : "Install Google Chrome instead, then run voicecap setup again.";
    throw new EnvironmentError(
      `Installing Playwright's Chromium failed (exit code ${code}); its messages are above. ${next}`,
    );
  }
  return deps.resolveBrowser();
}

/** voicecap's pinned @guidepup/setup: its version and its command-line script. */
export function guidepupSetupCli(): { version: string; bin: string } {
  const require = createRequire(import.meta.url);
  const setupPackageJson = require.resolve("@guidepup/setup/package.json");
  const setupPackage = JSON.parse(readFileSync(setupPackageJson, "utf8")) as {
    version: string;
    bin?: Record<string, string>;
  };
  const bin = path.join(
    path.dirname(setupPackageJson),
    setupPackage.bin?.guidepup ?? "bin/guidepup",
  );
  return { version: setupPackage.version, bin };
}

/** Playwright's command-line script, to install its Chromium. */
export function playwrightCli(): string {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");
}

/** Runs a Node.js script in `cwd` with its output on the console; resolves to its exit code. */
export function runNodeScript(script: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
}

export function realSetupDeps(options: SetupOptions): SetupDeps {
  const guidepup = readGuidepupPackage();
  return {
    platform: process.platform,
    guidepup,
    setupCli: guidepupSetupCli(),
    playwrightCli: playwrightCli(),
    install: guidepupInstall(guidepup.nvdaBuild, process.env, os.homedir()),
    exists: existsSync,
    runNode: runNodeScript,
    resolveBrowser: () => resolveBrowser(options.config.browser, process.env),
    platformReadiness: () =>
      loadPlatformReadiness({
        platform: process.platform,
        config: options.config,
        logger: options.logger,
        env: process.env,
        cwd: process.cwd(),
        again: "npx @icjia/voicecap setup",
      }),
  };
}
