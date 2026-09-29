import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { activeLockHolder, type LockHolder } from "../src/util/lock-file.js";
import { isoLocal } from "../src/util/time.js";

let dir: string;
let lockFile: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-lock-file-test-"));
  lockFile = path.join(dir, "test.lock");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Writes a lock file the way acquireLockFile does: JSON, one trailing newline. */
async function writeLock(holder: LockHolder): Promise<void> {
  await writeFile(lockFile, `${JSON.stringify(holder)}\n`);
}

describe("activeLockHolder", () => {
  it("gives null when there's no lock file", async () => {
    expect(await activeLockHolder(lockFile)).toBeNull();
  });

  it("gives null when the lock is this process's own", async () => {
    await writeLock({ pid: process.pid, host: os.hostname(), startedAt: isoLocal(new Date()) });
    expect(await activeLockHolder(lockFile)).toBeNull();
  });

  it("gives null when the lock's holder is stale (started before this boot)", async () => {
    // A different pid than this process's own, so this specifically exercises isStale's
    // before-boot check rather than the "it's my own lock" short-circuit.
    await writeLock({
      pid: process.pid + 1,
      host: os.hostname(),
      startedAt: "1970-01-01T00:00:00.000Z",
    });
    expect(await activeLockHolder(lockFile)).toBeNull();
  });

  it("gives the holder when it's a live process, other than this one, on this host", async () => {
    // process.ppid is guaranteed alive for the life of this test (it's this process's parent),
    // and isn't this process's own pid.
    const holder: LockHolder = {
      pid: process.ppid,
      host: os.hostname(),
      startedAt: isoLocal(new Date()),
    };
    await writeLock(holder);
    expect(await activeLockHolder(lockFile)).toEqual(holder);
  });
});
