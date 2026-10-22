import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** Profile folders the driver's browsers use (in the temp folder); any left by a crashed run are deleted. */
export const PROFILE_PREFIX = "voicecap-chrome-";

/** The start of a voice folder's name (see voiceFolder), which the process id follows. */
const VOICE_FOLDER_PREFIX = "voicecap-voice-";

/**
 * The folder one voicecap process's recordings of NVDA's voice are written to before they're
 * encoded (in the temp folder, outside every run's folders), named for the process: its sound is
 * deleted once the run has read it, and the folder when the recorder is closed. A folder left by a
 * run that crashed, or that a second Ctrl+C ended, is deleted by the next run's cleanup once its
 * process is gone (see cleanupOrphans).
 */
export function voiceFolder(tmpDir: string, pid: number): string {
  return path.join(tmpDir, `${VOICE_FOLDER_PREFIX}${pid}`);
}

/**
 * The process id a folder's name gives, when it's the name of a voice folder (see voiceFolder), and
 * null for any other name: one that has more after the id, or none, a zero before it, or an id too
 * large for a process (Node can't ask after one past 2,147,483,647).
 */
export function voiceFolderPid(name: string): number | null {
  const match = new RegExp(`^${VOICE_FOLDER_PREFIX}([1-9][0-9]*)$`).exec(name);
  const pid = Number(match?.[1]);
  return Number.isSafeInteger(pid) && pid <= 2_147_483_647 ? pid : null;
}

/** The installed @guidepup/guidepup (voicecap's pinned dependency). */
export interface GuidepupPackage {
  version: string;
  /** Its folder: `@guidepup/setup install` must run where this resolves. */
  dir: string;
  /** The NVDA build its manifest.json pins, e.g. "0.2.1-2026.2". */
  nvdaBuild: string;
}

export function readGuidepupPackage(): GuidepupPackage {
  const packageJson = createRequire(import.meta.url).resolve("@guidepup/guidepup/package.json");
  const dir = path.dirname(packageJson);
  const { version } = JSON.parse(readFileSync(packageJson, "utf8")) as { version: string };
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as {
    screenReaders?: { id: string; assets?: { version: string }[] }[];
  };
  const nvdaBuild = manifest.screenReaders?.find((reader) => reader.id === "nvda")?.assets?.[0]
    ?.version;
  if (!nvdaBuild) throw new Error(`@guidepup/guidepup ${version}'s manifest names no NVDA build.`);
  return { version, dir, nvdaBuild };
}

/**
 * Where Guidepup keeps its portable NVDA build. Mirrors @guidepup/guidepup 0.36.4
 * (lib/resolveCachePath.js and lib/windows/NVDA/getNVDAInstallationPath.js), so voicecap can check
 * the install and explain problems before Guidepup reports a bare "NVDA is not installed".
 */
export interface GuidepupInstall {
  /** Guidepup's NVDA build id, e.g. "0.2.1-2026.2". */
  build: string;
  cacheDir: string;
  nvdaExe: string;
}

export function guidepupInstall(
  build: string,
  env: NodeJS.ProcessEnv,
  homedir: string,
): GuidepupInstall {
  const win = path.win32;
  const override = envValue(env, "GUIDEPUP_SCREEN_READERS_PATH");
  const cacheDir = override
    ? win.resolve(override)
    : win.resolve(
        envValue(env, "LOCALAPPDATA") ?? win.join(homedir, "AppData", "Local"),
        "guidepup",
      );
  return {
    build,
    cacheDir,
    nvdaExe: win.join(cacheDir, "nvda", "all", build, "extracted", "nvda.exe"),
  };
}

/**
 * The lock that lets only one voicecap drive NVDA at a time. It's per Windows user, while NVDA's
 * port is shared by the whole computer: two users running voicecap at once aren't prevented.
 */
export function nvdaLockFile(env: NodeJS.ProcessEnv, homedir: string): string {
  const localAppData = envValue(env, "LOCALAPPDATA") ?? path.join(homedir, "AppData", "Local");
  return path.join(localAppData, "voicecap", "nvda.lock");
}

/** The NVDA version inside a Guidepup build id: "0.2.1-2026.2" → "2026.2". */
export function nvdaVersionFromBuild(build: string): string | null {
  return /-(\d+(?:\.\d+)+)$/.exec(build)?.[1] ?? null;
}

/**
 * An environment variable, looked up without regard to case. process.env ignores case on Windows,
 * but a copy of it (or a test's plain object) doesn't: "ProgramFiles" vs "PROGRAMFILES".
 */
export function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === wanted && value !== undefined && value !== "") return value;
  }
  return undefined;
}
