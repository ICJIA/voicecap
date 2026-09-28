import { UsageError } from "./errors.js";

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
