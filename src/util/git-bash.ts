import path from "node:path";

import { UsageError } from "./errors.js";

/** A single Windows drive letter written Git Bash's way, e.g. "/c/Users/me". */
const GIT_BASH_DRIVE = /^\/([A-Za-z])(\/.*)?$/;

/**
 * `value`, translated from Git Bash's form for a Windows path (one drive letter, e.g.
 * "/c/Users/me") to the Windows form ("C:/Users/me"), on Windows only. Git Bash translates it
 * itself for the programs it starts, but not with MSYS_NO_PATHCONV=1 set, and never in an answer
 * typed into `init`. Anything else, or off Windows, is returned unchanged.
 */
export function fromGitBash(value: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return value;
  const match = GIT_BASH_DRIVE.exec(value);
  return match ? `${match[1]!.toUpperCase()}:${match[2] ?? "/"}` : value;
}

/** A path someone gave voicecap, resolved against `cwd`, with Git Bash's form read as above. */
export function resolveUserPath(
  cwd: string,
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return path.resolve(cwd, fromGitBash(value, platform));
}

/** A Windows drive path, e.g. C:/Program Files/Git/about or C:\Users\me. */
const WINDOWS_PATH = /^[a-zA-Z]:[\\/]/;
/** Git for Windows' install folder, which MSYS puts in front of arguments that begin with "/". */
const GIT_INSTALL_DIR = /[\\/]Git[\\/]/i;

/**
 * Git Bash (MSYS) rewrites arguments that begin with "/" into Windows paths, so --page /about
 * arrives as "C:/Program Files/Git/about". A URL or URL pattern never looks like a drive path, so
 * any such value means the argument was mangled on the way in: explain the cause and the fix.
 */
export function assertNotRewritten(option: string, value: string): void {
  if (!WINDOWS_PATH.test(value)) return;
  const cause = GIT_INSTALL_DIR.test(value)
    ? `Git Bash rewrote it: arguments that begin with "/" are turned into Windows paths (for example /about becomes C:/Program Files/Git/about).`
    : `If you're using Git Bash, it rewrites arguments that begin with "/" into Windows paths (for example /about becomes C:/Program Files/Git/about).`;
  throw new UsageError(
    [
      `${option} "${value}" looks like a Windows path, not a URL.`,
      cause,
      "To fix it, use a full URL (https://dvfr.illinois.gov/about/), leave off the leading slash in",
      "patterns (--include 'news/*'), or turn the rewriting off with MSYS_NO_PATHCONV=1, e.g.",
      `  MSYS_NO_PATHCONV=1 npx @icjia/voicecap ${option} /about ...`,
    ].join("\n"),
  );
}
