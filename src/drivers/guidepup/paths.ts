import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** Profile folders the driver's browsers use (in the temp folder); any left by a crashed run are deleted. */
export const PROFILE_PREFIX = "voicecap-chrome-";

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
 * Where Guidepup keeps its portable NVDA build. Mirrors @guidepup/guidepup 0.34.0
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

/** The machine-wide lock that lets only one voicecap drive NVDA at a time. */
export function nvdaLockFile(env: NodeJS.ProcessEnv, homedir: string): string {
  const localAppData = envValue(env, "LOCALAPPDATA") ?? path.join(homedir, "AppData", "Local");
  return path.join(localAppData, "voicecap", "nvda.lock");
}

/**
 * Guidepup 0.34.0 starts NVDA with spawn(path, args, { shell: true }), which doesn't quote the
 * path, so NVDA can't start from a folder whose path has a space (C:\Users\Jane Doe\...).
 */
export function spaceInPathMessage(install: GuidepupInstall): string {
  return [
    `Guidepup's NVDA is in ${install.cacheDir}, and that path has a space in it. Guidepup can't start NVDA from such a path (it runs nvda.exe through the shell without quoting its path).`,
    "Choose a folder without spaces, set GUIDEPUP_SCREEN_READERS_PATH to it, and install NVDA there. In Git Bash:",
    "  mkdir -p /c/guidepup && setx GUIDEPUP_SCREEN_READERS_PATH 'C:\\guidepup'",
    "then open a new terminal and run: npx @icjia/voicecap setup",
  ].join("\n");
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
