import { guidepupInstall, readGuidepupPackage } from "../drivers/guidepup/paths.js";

/** Whether this computer can run a composed command now, or the one-line reason it can't. */
export type Readiness = { canRun: true } | { canRun: false; reason: string };

const NOT_WINDOWS =
  "voicecap runs NVDA, which only runs on Windows. Run this command on a Windows computer.";
const NOT_INSTALLED =
  "NVDA for voicecap isn't installed yet. Install it with: npx @icjia/voicecap setup, then run the command above.";

/**
 * Whether `init` can offer to run the command here: only on Windows, and only once Guidepup's NVDA
 * (the one `voicecap setup` installs) has its nvda.exe in place.
 */
export function checkReadiness(options: {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homedir: string;
  exists: (file: string) => boolean;
}): Readiness {
  if (options.platform !== "win32") return { canRun: false, reason: NOT_WINDOWS };
  const { nvdaExe } = guidepupInstall(
    readGuidepupPackage().nvdaBuild,
    options.env,
    options.homedir,
  );
  if (!options.exists(nvdaExe)) return { canRun: false, reason: NOT_INSTALLED };
  return { canRun: true };
}
