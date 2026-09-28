import { existsSync } from "node:fs";
import { mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";

import { attemptsDir, pageDir } from "./paths.js";

/** Windows refuses renames while antivirus or the search indexer holds the file open. */
const RETRYABLE_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Move a page's current folder into `attempts/<slug>/<n>` (the first free `n`, from 1) before a
 * retry starts writing over it, so an earlier attempt (or a resumed page's partial one) is kept
 * rather than deleted. Returns the new path, or null when there's nothing to keep: no folder yet,
 * or an empty one.
 */
export async function keepEarlierAttempt(
  siteDir: string,
  runId: string,
  slug: string,
): Promise<string | null> {
  const from = pageDir(siteDir, runId, slug);
  if (!existsSync(from) || (await readdir(from)).length === 0) return null;

  const base = attemptsDir(siteDir, runId, slug);
  await mkdir(base, { recursive: true });
  for (let n = 1; ; n++) {
    const to = path.join(base, String(n));
    if (existsSync(to)) continue;
    await renameWithRetry(from, to);
    return to;
  }
}

/** Same retry policy as writeFileAtomic's rename: keep trying for 10 s, backing off each time. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let delay = 25;
  for (;;) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === undefined || !RETRYABLE_CODES.has(code) || Date.now() + delay > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 250);
    }
  }
}
