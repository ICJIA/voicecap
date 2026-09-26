import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { RunJson } from "../src/model.js";
import { acquireRunLock, LOCK_FILE } from "../src/run/lock.js";
import { runDir } from "../src/run/paths.js";
import { allocateRunId, sanitizeRunName } from "../src/run/run-id.js";
import {
  assertRunWritable,
  listRuns,
  readLatestRunId,
  writeLatestRunId,
  writeRunJson,
} from "../src/run/store.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "voicecap-store-"));

function minimalRun(
  id: string,
  createdAt: string,
  status: RunJson["status"] = "incomplete",
): RunJson {
  return { id, createdAt, status } as RunJson;
}

describe("run ids", () => {
  it("uses local date and time, adds the run name, and suffixes -2, -3 when taken", async () => {
    const out = await tmp();
    const when = new Date(2026, 8, 26, 14, 5, 30);
    expect(await allocateRunId(out, when, null)).toBe("2026-09-26_1405");
    expect(await allocateRunId(out, when, null)).toBe("2026-09-26_1405-2");
    expect(await allocateRunId(out, when, null)).toBe("2026-09-26_1405-3");
    expect(await allocateRunId(out, when, "Exhaustive run")).toBe("2026-09-26_1405_Exhaustive-run");
    expect(existsSync(runDir(out, "2026-09-26_1405-3"))).toBe(true);
  });

  it("sanitizes run names for Windows", () => {
    expect(sanitizeRunName("  nightly: all/pages?  ")).toBe("nightly-allpages");
    expect(sanitizeRunName("...hidden...")).toBe("hidden");
    expect(() => sanitizeRunName("???")).toThrow(/no usable characters/);
  });
});

describe("run store", () => {
  it("lists runs oldest first and skips damaged folders", async () => {
    const out = await tmp();
    await writeRunJson(out, minimalRun("b", "2026-09-21T09:00:00-05:00"));
    await writeRunJson(out, minimalRun("a", "2026-09-20T09:00:00-05:00"));
    await writeFile(path.join(out, "runs", "junk.txt"), "not a run");
    await writeFile(path.join(runDir(out, "b"), "..", "c-broken"), "");
    expect((await listRuns(out)).map((run) => run.id)).toEqual(["a", "b"]);
  });

  it("seals a completed run: run.json can't be written again", async () => {
    const out = await tmp();
    await writeRunJson(out, minimalRun("r", "2026-09-20T09:00:00-05:00"));
    await writeRunJson(out, minimalRun("r", "2026-09-20T09:00:00-05:00", "completed"));
    await expect(writeRunJson(out, minimalRun("r", "2026-09-20T09:00:00-05:00"))).rejects.toThrow(
      /never modified/,
    );
    await expect(assertRunWritable(out, "r")).rejects.toThrow();
  });

  it("writes latest.txt as a plain file", async () => {
    const out = await tmp();
    expect(await readLatestRunId(out)).toBeNull();
    await writeLatestRunId(out, "2026-09-26_1405");
    expect(await readLatestRunId(out)).toBe("2026-09-26_1405");
  });
});

describe("run lock", () => {
  it("refuses a second run in the same output folder", async () => {
    const out = await tmp();
    const release = await acquireRunLock(out);
    await expect(acquireRunLock(out)).rejects.toThrow(/Another voicecap run/);
    await release();
    const again = await acquireRunLock(out);
    await again();
  });

  it("takes over a lock left by a process that no longer exists", async () => {
    const out = await tmp();
    await writeFile(
      path.join(out, LOCK_FILE),
      JSON.stringify({
        pid: 999_999_999,
        host: os.hostname(),
        startedAt: "2026-09-20T09:00:00-05:00",
      }),
    );
    const release = await acquireRunLock(out);
    await release();
    expect(existsSync(path.join(out, LOCK_FILE))).toBe(false);
  });
});
