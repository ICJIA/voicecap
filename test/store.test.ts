import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { RunJson } from "../src/model.js";
import { acquireRunLock, LOCK_FILE } from "../src/run/lock.js";
import { runDir } from "../src/run/paths.js";
import { allocateRunId, isRunIdShape, sanitizeRunName } from "../src/run/run-id.js";
import {
  assertRunWritable,
  listRuns,
  readLatestRunId,
  readRunJson,
  runRecordProblem,
  writeLatestRunId,
  writeRunJson,
} from "../src/run/store.js";
import { UsageError } from "../src/util/errors.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "voicecap-store-"));

/** A site's folder in the share fixtures' demo home: four runs that voicecap wrote. */
const DEMO_SITE = fileURLToPath(
  new URL("./fixtures/share/demo-2026-09-29/127.0.0.1_4848", import.meta.url),
);

function minimalRun(
  id: string,
  createdAt: string,
  status: RunJson["status"] = "incomplete",
  pages: unknown[] = [],
): RunJson {
  return { id, createdAt, status, pages } as RunJson;
}

/** A run.json written by hand into `folder` of `out`, as a folder holds whatever is put there. */
async function putRecord(out: string, folder: string, record: unknown): Promise<void> {
  const dir = path.join(out, ...folder.split("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "run.json"), `${JSON.stringify(record)}\n`);
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

  it("knows every id it makes, and no other shape", async () => {
    const out = await tmp();
    const when = new Date(2026, 8, 26, 14, 5, 30);
    const made = [
      await allocateRunId(out, when, null),
      await allocateRunId(out, when, null),
      await allocateRunId(out, when, "Exhaustive run"),
      await allocateRunId(out, when, "a".repeat(40)),
      await allocateRunId(out, when, "nightly-2"),
      await allocateRunId(out, when, "v1.2_beta"),
    ];
    expect(new Set(made).size).toBe(6);
    for (const id of made) expect(isRunIdShape(id), id).toBe(true);
    for (const id of [
      "",
      ".",
      "..",
      "../x",
      "2026-10-10_1405/../../x",
      "2026-10-10_1405\\..\\x",
      "2026-10-10",
      "2026-10-10_14",
      "2026-10-10_1405_",
      `2026-10-10_1405_${"a".repeat(25)}`,
      "2026-10-10_1405 ",
      "2026-10-10_1405\n",
      "2026-10-10_1405_na me",
      "2026-10-10_1405-x",
      "r",
    ]) {
      expect(isRunIdShape(id), JSON.stringify(id)).toBe(false);
    }
  });
});

describe("run store", () => {
  it("lists runs oldest first and skips damaged folders", async () => {
    const out = await tmp();
    await writeRunJson(out, minimalRun("2026-09-21_0900", "2026-09-21T09:00:00-05:00"));
    await writeRunJson(out, minimalRun("2026-09-20_0900", "2026-09-20T09:00:00-05:00"));
    // A folder that isn't a date (voicecap 0.2.0's top-level manual/ folder, say) is skipped.
    await mkdir(path.join(out, "manual", "faq"), { recursive: true });
    // Within a date folder: a file, and a folder with no run.json, are both skipped.
    await writeFile(path.join(out, "2026-09-21", "junk.txt"), "not a run");
    await mkdir(path.join(out, "2026-09-21", "no-run-json"));
    expect((await listRuns(out)).map((run) => run.id)).toEqual([
      "2026-09-20_0900",
      "2026-09-21_0900",
    ]);
  });

  it("leaves out a record whose id isn't its folder's", async () => {
    const out = await tmp();
    const at = "2026-09-21T09:00:00-05:00";
    await writeRunJson(out, minimalRun("2026-09-20_0900", at));
    await putRecord(out, "2026-09-21/0900", minimalRun("../../x", at));
    // Another date's id is a run id too, and still not this folder's.
    await putRecord(out, "2026-09-22/0900", minimalRun("2026-09-20_0900", at));
    await putRecord(out, "2026-09-23/0900", { createdAt: at, pages: [] });
    await putRecord(out, "2026-09-24/0900", []);
    await putRecord(out, "2026-09-25/0900", "a run");
    expect((await listRuns(out)).map((run) => run.id)).toEqual(["2026-09-20_0900"]);
  });

  it("leaves out a record with a page whose slug voicecap never makes", async () => {
    const out = await tmp();
    const at = "2026-09-21T09:00:00-05:00";
    const withPages = (id: string, pages: unknown) => ({ ...minimalRun(id, at), pages });
    await putRecord(
      out,
      "2026-09-20/0900",
      withPages("2026-09-20_0900", [{ slug: "home" }, { slug: "grants-1a2b3c4d5e" }]),
    );
    await putRecord(
      out,
      "2026-09-21/0900",
      withPages("2026-09-21_0900", [{ slug: "../../../Documents/notes" }]),
    );
    await putRecord(
      out,
      "2026-09-22/0900",
      withPages("2026-09-22_0900", [{ slug: "home" }, { slug: 7 }]),
    );
    await putRecord(out, "2026-09-23/0900", withPages("2026-09-23_0900", "home"));
    await putRecord(out, "2026-09-24/0900", withPages("2026-09-24_0900", ["home"]));
    await putRecord(out, "2026-09-25/0900", withPages("2026-09-25_0900", [{}]));
    expect((await listRuns(out)).map((run) => run.id)).toEqual(["2026-09-20_0900"]);
  });

  it("keeps every record of the demo home that ships with the tests", async () => {
    expect((await listRuns(DEMO_SITE)).map((run) => run.id)).toEqual([
      "2026-09-29_1315",
      "2026-09-29_1402",
      "2026-09-29_1415",
      "2026-09-29_1419",
    ]);
  });

  it("reads a run by its id", async () => {
    const out = await tmp();
    await writeRunJson(out, minimalRun("2026-09-20_0900", "2026-09-20T09:00:00-05:00"));
    expect((await readRunJson(out, "2026-09-20_0900")).id).toBe("2026-09-20_0900");
    await expect(readRunJson(out, "2026-09-21_0900")).rejects.toThrow(
      /No run "2026-09-21_0900" in /,
    );
  });

  it("refuses an id of any other shape before it reads anything", async () => {
    const root = await tmp();
    const out = path.join(root, "site");
    const at = "2026-09-20T09:00:00-05:00";
    // Records a path built from these ids would reach, each naming its own id.
    await putRecord(root, "x", minimalRun("../x", at));
    await putRecord(out, "x", minimalRun("2026-10-10_1405/../../x", at));
    await putRecord(out, "2026-10-10/1405", minimalRun("2026-10-10_1405", at));
    for (const id of ["../x", "2026-10-10_1405/../../x", "..", "."]) {
      const error = await readRunJson(out, id).catch((caught: unknown) => caught);
      expect(error, id).toBeInstanceOf(UsageError);
      expect((error as Error).message).toBe(`"${id}" isn't a run id, such as 2026-10-10_1405.`);
    }
    expect((await readRunJson(out, "2026-10-10_1405")).id).toBe("2026-10-10_1405");
  });

  it("writes an id it refuses as an escape when it says so", async () => {
    const error = await readRunJson(await tmp(), "2026-10-10_1405\u001b[2J").catch(
      (caught: unknown) => caught,
    );
    expect((error as Error).message).toBe(
      `"2026-10-10_1405\\u{1b}[2J" isn't a run id, such as 2026-10-10_1405.`,
    );
  });

  it("refuses a record that names another id than its folder's", async () => {
    const out = await tmp();
    await putRecord(out, "2026-09-21/0900", minimalRun("2026-09-20_0900", "x"));
    const error = await readRunJson(out, "2026-09-21_0900").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toMatch(/: its id isn't its folder's\.$/);
    // The other id is the record's own words, so it isn't repeated.
    expect((error as Error).message).not.toContain("2026-09-20_0900");
  });

  it("refuses a record with a slug voicecap never makes", async () => {
    const out = await tmp();
    await putRecord(
      out,
      "2026-09-21/0900",
      minimalRun("2026-09-21_0900", "x", "incomplete", [{ slug: "../x" }]),
    );
    const error = await readRunJson(out, "2026-09-21_0900").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toMatch(/slug/);
    // The slug is the record's own words, so they aren't repeated.
    expect((error as Error).message).not.toContain("../x");
  });

  it("says what is wrong with a record, or nothing when it's a run's", () => {
    const id = "2026-09-21_0900";
    const run = minimalRun(id, "x", "incomplete", [{ slug: "home" }]);
    expect(runRecordProblem(run, id)).toBeNull();
    expect(runRecordProblem(minimalRun(id, "x"), id)).toBeNull();
    for (const record of [null, 7, "run", [], {}, { id }, { id, pages: {} }]) {
      expect(runRecordProblem(record, id), JSON.stringify(record)).toEqual(expect.any(String));
    }
    expect(runRecordProblem(run, "2026-09-22_0900")).toMatch(/id/);
    expect(runRecordProblem({ ...run, pages: [null] }, id)).toMatch(/page/);
    expect(runRecordProblem({ ...run, pages: [{ slug: "A" }] }, id)).toMatch(/slug/);
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
