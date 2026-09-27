import { readFileSync, unlinkSync } from "node:fs";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EnvironmentError } from "./errors.js";
import { isoLocal } from "./time.js";

/** Who holds a lock file. */
export interface LockHolder {
  pid: number;
  host: string;
  startedAt: string;
}

export interface LockMessages {
  /** The lock is held by a live process on this computer. */
  held(holder: LockHolder): string;
  /** The lock was taken on another computer (the folder is shared), so voicecap can't tell if it's stale. */
  otherHost(holder: LockHolder, file: string): string;
}

/**
 * Take a lock file. A lock left by a process that no longer exists (a crash, a reboot) is taken
 * over; one held by a live process is refused with messages.held. Returns a function that
 * releases the lock. The lock is also released when the process exits.
 */
export async function acquireLockFile(
  file: string,
  messages: LockMessages,
): Promise<() => Promise<void>> {
  await mkdir(path.dirname(file), { recursive: true });
  const info: LockHolder = {
    pid: process.pid,
    host: os.hostname(),
    startedAt: isoLocal(new Date()),
  };

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
      const holder = await readLockHolder(file);
      if (holder && holder.host !== os.hostname()) {
        throw new EnvironmentError(messages.otherHost(holder, file));
      }
      if (holder && !isStale(holder)) throw new EnvironmentError(messages.held(holder));
      await unlink(file).catch(() => {});
    }
  }
  throw new EnvironmentError(`Could not take the lock ${file}.`);
}

/** The lock's holder, or null if there's no lock (or it can't be read). */
export async function readLockHolder(file: string): Promise<LockHolder | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as LockHolder;
  } catch {
    return null;
  }
}

/**
 * Whether a lock taken on this computer was left behind: its process is gone, or it was taken
 * before the last reboot. Locks from other computers are never considered stale.
 */
export function isStale(holder: LockHolder): boolean {
  if (holder.host !== os.hostname()) return false;
  const bootedAt = Date.now() - os.uptime() * 1000;
  return Date.parse(holder.startedAt) < bootedAt || !isAlive(holder.pid);
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
    const holder = JSON.parse(readFileSync(file, "utf8")) as LockHolder;
    if (holder.pid === process.pid) unlinkSync(file);
  } catch {
    // Already gone.
  }
}
