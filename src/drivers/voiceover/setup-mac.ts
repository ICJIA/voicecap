/**
 * voicecap setup on the Mac: install what VoiceOver automation needs, change two VoiceOver
 * settings (saying how to undo each), walk through each missing permission, and end with the
 * preflight and the offer of the live test.
 *
 * Guidepup's VoiceOver files come from voicecap's own pinned @guidepup/setup (`install voiceover`),
 * run in voicecap's installed @guidepup/guidepup package, as `install nvda` is on Windows: the
 * installer reads which files to fetch from the manifest.json of whichever @guidepup/guidepup
 * resolves from its working folder. It downloads from GitHub (honoring HTTPS_PROXY) into
 * ~/Library/Caches/guidepup (GUIDEPUP_SCREEN_READERS_PATH overrides it). voicecap never changes a
 * privacy setting itself: it opens System Settings at the right page and says what to switch on.
 */
import type { VoicecapConfig } from "../../config/schema.js";
import type { Prompter } from "../../init/prompt.js";
import { finishSetup, guideThrough } from "../../readiness/guided.js";
import type { PlatformReadiness, Problem } from "../../readiness/model.js";
import { runCheck } from "../../readiness/preflight.js";
import { renderProblems } from "../../readiness/render.js";
import { EnvironmentError, ExitCode } from "../../util/errors.js";
import type { Logger } from "../../util/log.js";
import { resolveBrowser } from "../guidepup/chrome.js";
import { readGuidepupPackage } from "../guidepup/paths.js";
import {
  ensureBrowser,
  guidepupSetupCli,
  playwrightCli,
  runNodeScript,
} from "../guidepup/setup.js";
import { loadPlatformReadiness } from "../readiness.js";
import { openTarget, runCommand, terminalApp, writeDefault, type RunCommand } from "./macos.js";
import { appName } from "./readiness-mac.js";

export interface MacSetupDeps {
  run: RunCommand;
  /** @guidepup/setup's command-line script. */
  setupCli: { version: string; bin: string };
  /** voicecap's installed @guidepup/guidepup: the installer must run in its folder. */
  guidepup: { dir: string };
  /** Run a Node.js script with its output on the console; resolves to its exit code. */
  runNode(script: string, args: string[], cwd: string): Promise<number>;
  /** The browser voicecap will use, installing Playwright's Chromium when it has to. */
  ensureBrowser(): Promise<{ name: string; path: string }>;
  /** This Mac's readiness checks and live test. */
  platform(): Promise<PlatformReadiness>;
  /** Opens a problem's System Settings page, or its app; false when it couldn't. */
  open(target: NonNullable<Problem["open"]>): Promise<boolean>;
}

export interface MacSetupOptions {
  config: VoicecapConfig;
  logger: Logger;
  /** Answers each step and the offer of the live test; null when stdin isn't a terminal. */
  prompter: Prompter | null;
}

/**
 * Checks the macOS version, then installs Guidepup's VoiceOver files and the browser, turns off
 * VoiceOver's welcome screen and turns on its own AppleScript setting, walks through each missing
 * permission when someone can answer, and ends with the preflight, which lists whatever is left.
 * Returns the exit code: 2 when Full Disk Access needs the terminal app to reopen, else the
 * preflight's (0 ready, 2 not ready or the live test failed, 130 on Ctrl+C during the live test).
 * Throws EnvironmentError on a macOS voicecap's Guidepup can't drive (before anything is
 * downloaded), and when the installer fails or a setting can't be changed.
 */
export async function runMacSetup(
  options: MacSetupOptions,
  deps: MacSetupDeps = realMacSetupDeps(options),
): Promise<number> {
  const { logger, prompter } = options;

  const platform = await deps.platform();
  await requireSupportedMacOS(platform);
  logger.info(
    `Installing Guidepup's VoiceOver files, with @guidepup/setup ${deps.setupCli.version}.`,
  );
  const code = await deps.runNode(deps.setupCli.bin, ["install", "voiceover"], deps.guidepup.dir);
  if (code !== 0) {
    throw new EnvironmentError(
      `Installing Guidepup's VoiceOver files failed (the installer exited with code ${code}); its messages are above. It downloads from github.com: behind a proxy, set HTTPS_PROXY (and NO_PROXY), then run voicecap setup again.`,
    );
  }
  const browser = await deps.ensureBrowser();
  logger.info(`Browser: ${browser.name} (${browser.path}).`);

  // The only settings voicecap changes itself, each said with its undo.
  await writeDefault(deps.run, "com.apple.VoiceOverTraining", "doNotShowSplashScreen", true);
  logger.info(
    "Turned off VoiceOver's welcome screen (to undo: defaults delete com.apple.VoiceOverTraining doNotShowSplashScreen).",
  );
  await writeDefault(deps.run, "com.apple.VoiceOver4/default", "SCREnableAppleScript", true);
  logger.info(
    'Turned on VoiceOver\'s own "allow AppleScript" setting (to undo: defaults delete com.apple.VoiceOver4/default SCREnableAppleScript).',
  );

  const app = appName(await terminalApp(deps.run));
  const { result, restartNeeded } = await guideThrough(platform, {
    prompter,
    say: (text) => logger.info(text),
    open: (target) => deps.open(target),
    app,
    // The checks can raise macOS's System Events prompt, and wait up to 60 seconds for it.
    beforeCheck: () => {
      if (platform.checkingNotice.length === 0) return;
      logger.info("");
      for (const line of platform.checkingNotice) logger.info(line);
    },
  });
  if (restartNeeded) return ExitCode.environment;
  logger.info("");
  return finishSetup(platform, result, { logger, prompter });
}

/**
 * Throws the macOS version check's problem when voicecap's Guidepup can't drive VoiceOver on this
 * macOS: nothing setup would download or change could help.
 */
async function requireSupportedMacOS(platform: PlatformReadiness): Promise<void> {
  const version = platform.quickChecks().find((runner) => runner.id === "version");
  if (!version) return;
  const check = await runCheck(version);
  if (check.status === "FAIL") {
    throw new EnvironmentError(renderProblems([check], { offerSetup: false }));
  }
}

export function realMacSetupDeps(options: MacSetupOptions): MacSetupDeps {
  const { config, logger } = options;
  return {
    run: runCommand,
    setupCli: guidepupSetupCli(),
    guidepup: { dir: readGuidepupPackage().dir },
    runNode: runNodeScript,
    ensureBrowser: () =>
      ensureBrowser(options, {
        runNode: runNodeScript,
        playwrightCli: playwrightCli(),
        resolveBrowser: () => resolveBrowser(config.browser, process.env),
      }),
    platform: () =>
      loadPlatformReadiness({
        platform: "darwin",
        config,
        logger,
        env: process.env,
        cwd: process.cwd(),
        again: "npx @icjia/voicecap setup",
      }),
    open: (target) => openTarget(runCommand, target),
  };
}
