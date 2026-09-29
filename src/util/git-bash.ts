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
 * How the explanation below shows the rewriting and the ways around it: an example that begins
 * with "/", and the fix. --sitemap reads a name from the site's root with or without the slash
 * (sitemap.xml is /sitemap.xml), so leaving it off is its first fix; every other option's is a
 * full URL, or a pattern without the slash.
 */
const REWRITE_HELP: Record<string, { example: string; fix: string[] }> = {
  "--sitemap": {
    example: "/sitemap.xml",
    fix: [
      "To fix it, leave off the leading slash (--sitemap sitemap.xml), use a full URL",
      "(https://dvfr.illinois.gov/sitemap.xml), or turn the rewriting off with MSYS_NO_PATHCONV=1, e.g.",
    ],
  },
};
const DEFAULT_REWRITE_HELP = {
  example: "/about",
  fix: [
    "To fix it, use a full URL (https://dvfr.illinois.gov/about/), leave off the leading slash in",
    "patterns (--include 'news/*'), or turn the rewriting off with MSYS_NO_PATHCONV=1, e.g.",
  ],
};

/**
 * Git Bash (MSYS) rewrites arguments that begin with "/" into Windows paths, so --page /about
 * arrives as "C:/Program Files/Git/about", and --sitemap /sitemap.xml as
 * "C:/Program Files/Git/sitemap.xml". A URL, a sitemap's name, or a URL pattern never looks like a
 * drive path, so any such value means the argument was mangled on the way in: explain the cause
 * and the fix.
 */
export function assertNotRewritten(option: string, value: string): void {
  if (!WINDOWS_PATH.test(value)) return;
  const { example, fix } = REWRITE_HELP[option] ?? DEFAULT_REWRITE_HELP;
  const rewritten = `C:/Program Files/Git${example}`;
  const cause = GIT_INSTALL_DIR.test(value)
    ? `Git Bash rewrote it: arguments that begin with "/" are turned into Windows paths (for example ${example} becomes ${rewritten}).`
    : `If you're using Git Bash, it rewrites arguments that begin with "/" into Windows paths (for example ${example} becomes ${rewritten}).`;
  throw new UsageError(
    [
      `${option} "${value}" looks like a Windows path, not a URL.`,
      cause,
      ...fix,
      `  MSYS_NO_PATHCONV=1 npx @icjia/voicecap ${option} ${example} ...`,
    ].join("\n"),
  );
}
