/**
 * The only place that maps driver names to modules. Drivers load lazily, so choosing one never
 * loads another's libraries (Guidepup and Playwright stay out of replay runs).
 */
import path from "node:path";

import type { VoicecapConfig } from "../config/schema.js";
import { EnvironmentError, UsageError } from "../util/errors.js";
import { fromGitBash } from "../util/git-bash.js";
import type { Logger } from "../util/log.js";
import type { ScreenReaderDriver } from "./types.js";

export type DriverName = VoicecapConfig["driver"];

export interface DriverSelection {
  name: DriverName;
  /** Replay driver: the run folder, absolute. */
  replayFrom: string | null;
  /** Replay driver: the folder as the user wrote it (Git Bash's form read), for transcripts and settings. */
  replayLabel: string | null;
}

/** --replay-from selects the replay driver; otherwise the config's `driver` setting decides. */
export function selectDriver(
  config: VoicecapConfig,
  replayFromOption: string | null | undefined,
  cwd: string,
): DriverSelection {
  const replayFrom = replayFromOption ?? (config.driver === "replay" ? config.replayFrom : null);
  if (replayFromOption || config.driver === "replay") {
    if (!replayFrom) {
      throw new UsageError(
        "The replay driver needs a run folder: pass --replay-from <dir> or set replayFrom in voicecap.config.",
      );
    }
    const folder = fromGitBash(replayFrom);
    return {
      name: "replay",
      replayFrom: path.resolve(cwd, folder),
      replayLabel: folder.split(path.sep).join("/"),
    };
  }
  return { name: config.driver, replayFrom: null, replayLabel: null };
}

/** What a driver needs from the run: the config (browser, capture, NVDA settings, readiness) and a logger. */
export interface DriverContext {
  config: VoicecapConfig;
  logger: Logger;
}

export async function createDriver(
  selection: DriverSelection,
  context: DriverContext,
  platform: NodeJS.Platform = process.platform,
): Promise<ScreenReaderDriver> {
  switch (selection.name) {
    case "replay": {
      const { ReplayDriver } = await import("./replay.js");
      return new ReplayDriver(selection.replayFrom ?? "", selection.replayLabel ?? undefined);
    }
    case "at-driver": {
      requireWindows("at-driver", platform);
      const { AtDriverNvdaDriver } = await import("./at-driver-nvda.js");
      return new AtDriverNvdaDriver();
    }
    case "guidepup": {
      requireWindows("guidepup", platform);
      const { createGuidepupNvdaDriver } = await import("./guidepup-nvda.js");
      return createGuidepupNvdaDriver(context, platform);
    }
  }
}

function requireWindows(driver: string, platform: NodeJS.Platform): void {
  if (platform !== "win32") {
    throw new EnvironmentError(
      `The ${driver} driver runs NVDA, which only runs on Windows. On macOS and Linux, use the replay driver: --replay-from <run folder>.`,
    );
  }
}
