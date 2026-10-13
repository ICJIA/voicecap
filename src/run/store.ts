import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { RunJson } from "../model.js";
import { isPageSlug } from "../pages/slug.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { UsageError, VoicecapError } from "../util/errors.js";
import { inertText } from "../util/inert.js";
import { DATE_FOLDER, latestPath, runJsonPath } from "./paths.js";
import { isRunIdShape } from "./run-id.js";

/**
 * Read a run's record. `runId` must be of the shape allocateRunId makes (isRunIdShape), since it's
 * made into a path: `latest.txt`, `--run`, `--compare`, and a record's `compareTo` all come here, and
 * each can say anything. The record must be the run's own (see runRecordProblem).
 */
export async function readRunJson(outDir: string, runId: string): Promise<RunJson> {
  if (!isRunIdShape(runId)) {
    throw new UsageError(`"${inertText(runId)}" isn't a run id, such as 2026-10-10_1405.`);
  }
  const file = runJsonPath(outDir, runId);
  if (!existsSync(file)) throw new UsageError(`No run "${runId}" in ${outDir}.`);
  let record: unknown;
  try {
    record = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new UsageError(`Could not read ${file}: it is not valid JSON.`, { cause: error });
  }
  const problem = runRecordProblem(record, runId);
  if (problem !== null) throw new UsageError(`Could not read ${file}: ${problem}.`);
  return record as RunJson;
}

/**
 * What is wrong with `record` as the record of run `id`, in a few words; null when nothing is. A
 * run's record is in the folder its id names (runDir), and its pages are folders in it (pageDir), so
 * a record counts only when it's an object whose `id` is `id`, and whose `pages` is a list of
 * objects that each have a slug voicecap makes (isPageSlug). A record is read as found: it can say
 * any id, and a run that resumed it would write where that id points. The id and the slug it
 * refuses are the record's own words, so they aren't repeated.
 */
export function runRecordProblem(record: unknown, id: string): string | null {
  if (!isObject(record)) return "it isn't a record";
  if (record.id !== id) return "its id isn't its folder's";
  if (!Array.isArray(record.pages)) return "its pages aren't a list";
  for (const page of record.pages as unknown[]) {
    if (!isObject(page)) return "a page in it isn't a record";
    if (!isPageSlug(page.slug)) return "a page in it has a slug voicecap never makes";
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every run with a readable run.json, oldest first. Each dated folder under the site folder is
 * checked; anything in there without one (a damaged run.json, or, later, a manual session) is
 * skipped, and resume and reports ignore it. So is a record that isn't its folder's own
 * (runRecordProblem): `voicecap share` says of it that it couldn't be read.
 */
export async function listRuns(outDir: string): Promise<RunJson[]> {
  if (!existsSync(outDir)) return [];
  const runs: RunJson[] = [];
  for (const dateEntry of await readdir(outDir, { withFileTypes: true })) {
    if (!dateEntry.isDirectory() || !DATE_FOLDER.test(dateEntry.name)) continue;
    const dateDir = path.join(outDir, dateEntry.name);
    for (const runEntry of await readdir(dateDir, { withFileTypes: true })) {
      if (!runEntry.isDirectory()) continue;
      const runId = `${dateEntry.name}_${runEntry.name}`;
      try {
        const record: unknown = JSON.parse(await readFile(runJsonPath(outDir, runId), "utf8"));
        if (runRecordProblem(record, runId) === null) runs.push(record as RunJson);
      } catch {
        // Not a run folder, or a damaged run.json; resume and reports ignore it.
      }
    }
  }
  return runs.sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/** The id in latest.txt: the most recently completed run. */
export async function readLatestRunId(outDir: string): Promise<string | null> {
  const file = latestPath(outDir);
  if (!existsSync(file)) return null;
  const id = (await readFile(file, "utf8")).trim();
  return id === "" ? null : id;
}

export async function writeLatestRunId(outDir: string, runId: string): Promise<void> {
  await writeFileAtomic(latestPath(outDir), `${runId}\n`);
}

/**
 * Write run.json atomically. Completed runs are sealed: once run.json on disk says "completed",
 * nothing in the run folder may change, so this refuses.
 */
export async function writeRunJson(outDir: string, run: RunJson): Promise<void> {
  await assertRunWritable(outDir, run.id);
  await writeFileAtomic(runJsonPath(outDir, run.id), `${JSON.stringify(run, null, 2)}\n`);
}

/** Throws if the run on disk is completed. Call before writing anything into a run folder. */
export async function assertRunWritable(outDir: string, runId: string): Promise<void> {
  const file = runJsonPath(outDir, runId);
  if (!existsSync(file)) return;
  let status: string | undefined;
  try {
    status = (JSON.parse(await readFile(file, "utf8")) as RunJson).status;
  } catch {
    return;
  }
  if (status === "completed") {
    throw new VoicecapError(`Run ${runId} is completed; its folder is never modified.`);
  }
}
