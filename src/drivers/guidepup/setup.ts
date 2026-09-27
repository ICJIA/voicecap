/**
 * voicecap setup: install the NVDA build that voicecap's pinned Guidepup expects.
 *
 * It runs voicecap's own pinned @guidepup/setup (`install nvda`). That installer reads the NVDA
 * build from the manifest.json of whichever @guidepup/guidepup resolves from its working folder,
 * so it runs in voicecap's installed @guidepup/guidepup package: someone running
 * `npx @icjia/voicecap setup` from a site's folder has no Guidepup there. The installer
 * downloads from GitHub (honoring HTTPS_PROXY) into %LOCALAPPDATA%\guidepup
 * (GUIDEPUP_SCREEN_READERS_PATH overrides it). setup also makes sure a browser is available.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import type { VoicecapConfig } from "../../config/schema.js";
import { EnvironmentError } from "../../util/errors.js";
import type { Logger } from "../../util/log.js";
import { resolveBrowser, type BrowserExecutable } from "./chrome.js";
import {
  guidepupInstall,
  readGuidepupPackage,
  spaceInPathMessage,
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
}

export async function runSetup(
  options: { config: VoicecapConfig; logger: Logger },
  deps: SetupDeps = realSetupDeps(options.config),
): Promise<void> {
  const { logger } = options;
  const { install, guidepup } = deps;
  if (deps.platform !== "win32") {
    throw new EnvironmentError(
      "voicecap setup installs NVDA, which only runs on Windows. On macOS and Linux, use the replay driver: --replay-from <run folder>.",
    );
  }
  if (/\s/.test(install.cacheDir)) throw new EnvironmentError(spaceInPathMessage(install));

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
      "Next, check everything with: npx @icjia/voicecap doctor",
    ].join("\n"),
  );
}

async function ensureBrowser(
  options: { config: VoicecapConfig; logger: Logger },
  deps: SetupDeps,
): Promise<BrowserExecutable> {
  try {
    return deps.resolveBrowser();
  } catch (error) {
    if (!(error instanceof EnvironmentError) || !options.config.browser.fallbackToChromium) {
      throw error;
    }
  }
  options.logger.info(
    `The configured browser (${options.config.browser.channel}) isn't installed, so voicecap will use Playwright's Chromium. Installing it now. (For transcripts that match what most people use, install Google Chrome.)`,
  );
  const code = await deps.runNode(
    deps.playwrightCli,
    ["install", "chromium"],
    path.dirname(deps.playwrightCli),
  );
  if (code !== 0) {
    throw new EnvironmentError(
      `Installing Playwright's Chromium failed (exit code ${code}); its messages are above. Install Google Chrome instead, then run voicecap setup again.`,
    );
  }
  return deps.resolveBrowser();
}

function realSetupDeps(config: VoicecapConfig): SetupDeps {
  const require = createRequire(import.meta.url);
  const guidepup = readGuidepupPackage();
  const setupPackageJson = require.resolve("@guidepup/setup/package.json");
  const setupPackage = JSON.parse(readFileSync(setupPackageJson, "utf8")) as {
    version: string;
    bin?: Record<string, string>;
  };
  const bin = path.join(
    path.dirname(setupPackageJson),
    setupPackage.bin?.guidepup ?? "bin/guidepup",
  );
  return {
    platform: process.platform,
    guidepup,
    setupCli: { version: setupPackage.version, bin },
    playwrightCli: path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js"),
    install: guidepupInstall(guidepup.nvdaBuild, process.env, os.homedir()),
    exists: existsSync,
    runNode: (script, args, cwd) =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, ...args], { cwd, stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (exitCode) => resolve(exitCode ?? 1));
      }),
    resolveBrowser: () => resolveBrowser(config.browser, process.env),
  };
}
