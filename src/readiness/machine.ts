/**
 * Machine-info helpers shared by the platform readiness modules: bytes as whole GiB, a locale's
 * display name, a path shown under the home folder, and free/total disk space.
 */
import type { StatsFs } from "node:fs";
import { statfs as realStatfs } from "node:fs/promises";
import type { PlatformPath } from "node:path";

/** Rounds bytes to whole GiB and appends " GB", e.g. 17179869184 -> "16 GB". */
export function gigabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 ** 3)} GB`;
}

/** The statfs fields diskSpace reads. */
type DiskStats = Pick<StatsFs, "bavail" | "bsize" | "blocks">;

/** Free and total bytes on the disk holding `dir`; null when it can't be read (statfs throws). */
export async function diskSpace(
  dir: string,
  statfs: (dir: string) => Promise<DiskStats> = realStatfs,
): Promise<{ free: number; total: number } | null> {
  try {
    const stats = await statfs(dir);
    return { free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize };
  } catch {
    return null;
  }
}

/**
 * A locale like "en_US" or "en-US" read as "English (United States)"; null for null. Falls back
 * to the given locale text if Intl can't format it (an unrecognized tag).
 */
export function languageName(locale: string | null): string | null {
  if (locale === null) return null;
  const tag = locale.replace(/_/g, "-");
  try {
    const displayNames = new Intl.DisplayNames(["en"], {
      type: "language",
      languageDisplay: "standard",
    });
    return displayNames.of(tag) ?? locale;
  } catch {
    return locale;
  }
}

/**
 * A path under `home` shown as "~/…", with forward slashes; a path outside `home` is unchanged.
 * `paths` are the path functions of the system the two paths come from, whatever computer this
 * is: path.posix for a Mac's, as the tests run on Windows too.
 */
export function homePath(file: string, home: string, paths: PlatformPath): string {
  const relative = paths.relative(home, file);
  if (paths.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${paths.sep}`)) {
    return file;
  }
  return `~/${relative.split(paths.sep).join("/")}`;
}
