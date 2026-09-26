import { readFileSync, unlinkSync } from "node:fs";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EnvironmentError } from "../util/errors.js";
import { isoLocal } from "../util/time.js";

interface LockInfo {
  pid: number;
  host: string;
  startedAt: string;
}

export const LOCK_FILE = ".voicecap.lock";

/**
 * Take the output folder's run lock, so two runs never write the same transcripts folder at once.
 * A lock left by a process that no longer exists (a crash, a reboot) is taken over.
 * Returns a function that releases the lock.
 */
export async function acquireRunLock(outDir: string): Promise<() => Promise<void>> {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, LOCK_FILE);
  const info: LockInfo = { pid: process.pid, host: os.hostname(), startedAt: isoLocal(new Date()) };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const handle = await open(file, "wx");
      await handle.writeFile(`${JSON.stringify(info)}\n`);
      await handle.close();
      const onExit = () => releaseSync(file);
      process.once("exit", onExit);
      return async () => {
        process.removeListener("exit", onExit);
        await unlink(file).catch(() => {});
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = await readLock(file);
      if (holder && holder.host === os.hostname() && isAlive(holder.pid)) {
        throw new EnvironmentError(
          `Another voicecap run (process ${holder.pid}, started ${holder.startedAt}) is using ${outDir}. Wait for it to finish, or stop it first.`,
        );
      }
      if (holder && holder.host !== os.hostname()) {
        throw new EnvironmentError(
          `${outDir} is locked by a voicecap run on another computer (${holder.host}, started ${holder.startedAt}). If that run is gone, delete ${file}.`,
        );
      }
      await unlink(file).catch(() => {});
    }
  }
  throw new EnvironmentError(`Could not take the run lock ${file}.`);
}

async function readLock(file: string): Promise<LockInfo | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as LockInfo;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function releaseSync(file: string): void {
  try {
    const holder = JSON.parse(readFileSync(file, "utf8")) as LockInfo;
    if (holder.pid === process.pid) unlinkSync(file);
  } catch {
    // Already gone.
  }
}
