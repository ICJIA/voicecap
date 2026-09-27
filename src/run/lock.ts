import path from "node:path";

import { acquireLockFile } from "../util/lock-file.js";

export const LOCK_FILE = ".voicecap.lock";

/**
 * Take the output folder's run lock, so two runs never write the same transcripts folder at once.
 * A lock left by a process that no longer exists (a crash, a reboot) is taken over.
 * Returns a function that releases the lock.
 */
export function acquireRunLock(outDir: string): Promise<() => Promise<void>> {
  const file = path.join(outDir, LOCK_FILE);
  return acquireLockFile(file, {
    held: (holder) =>
      `Another voicecap run (process ${holder.pid}, started ${holder.startedAt}) is using ${outDir}. Wait for it to finish, or stop it first.`,
    otherHost: (holder) =>
      `${outDir} is locked by a voicecap run on another computer (${holder.host}, started ${holder.startedAt}). If that run is gone, delete ${file}.`,
  });
}
