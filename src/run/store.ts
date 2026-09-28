import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { RunJson } from "../model.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { UsageError, VoicecapError } from "../util/errors.js";
import { DATE_FOLDER, latestPath, runJsonPath } from "./paths.js";

export async function readRunJson(outDir: string, runId: string): Promise<RunJson> {
  const file = runJsonPath(outDir, runId);
  if (!existsSync(file)) throw new UsageError(`No run "${runId}" in ${outDir}.`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as RunJson;
  } catch (error) {
    throw new UsageError(`Could not read ${file}: it is not valid JSON.`, { cause: error });
  }
}

/**
 * Every run with a readable run.json, oldest first. Each dated folder under the site folder is
 * checked; anything in there without one (a damaged run.json, or, later, a manual session) is
 * skipped, and resume and reports ignore it.
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
        runs.push(JSON.parse(await readFile(runJsonPath(outDir, runId), "utf8")) as RunJson);
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
