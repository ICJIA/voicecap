import { readdir, readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writeFileAtomic } from "../src/util/atomic-write.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "voicecap-atomic-"));

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("writeFileAtomic", () => {
  it("writes the file and leaves no temporary files behind", async () => {
    const dir = await tmp();
    const file = path.join(dir, "nested", "run.json");
    await writeFileAtomic(file, "first");
    await writeFileAtomic(file, "second");
    expect(await readFile(file, "utf8")).toBe("second");
    expect(await readdir(path.dirname(file))).toEqual(["run.json"]);
  });

  it("retries a rename that Windows refuses with EPERM or EBUSY", async () => {
    const dir = await tmp();
    const file = path.join(dir, "run.json");
    let failures = 0;
    await writeFileAtomic(file, "data", {
      rename: async (from, to) => {
        if (failures++ < 2) throw errno(failures === 1 ? "EPERM" : "EBUSY");
        await rename(from, to);
      },
    });
    expect(failures).toBe(3);
    expect(await readFile(file, "utf8")).toBe("data");
  });

  it("gives up after the retry window and cleans up the temporary file", async () => {
    const dir = await tmp();
    const file = path.join(dir, "run.json");
    await expect(
      writeFileAtomic(file, "data", {
        retryForMs: 100,
        rename: () => Promise.reject(errno("EBUSY")),
      }),
    ).rejects.toThrow("EBUSY");
    expect(await readdir(dir)).toEqual([]);
  });

  it("doesn't retry other errors", async () => {
    const dir = await tmp();
    let calls = 0;
    await expect(
      writeFileAtomic(path.join(dir, "x"), "data", {
        rename: () => {
          calls++;
          return Promise.reject(errno("ENOSPC"));
        },
      }),
    ).rejects.toThrow("ENOSPC");
    expect(calls).toBe(1);
  });
});
