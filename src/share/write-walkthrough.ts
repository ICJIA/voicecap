/**
 * `voicecap walkthrough`: write a run's walkthrough file (./walkthrough.ts), the recipe that anyone
 * can repeat the run from, to a file the person names.
 *
 * The file is never written over: it's opened with the `wx` flag, which refuses any name that's
 * taken, and it's written and synced to disk before it's closed. One that can't be written whole is
 * taken away again, so the same name can be tried again. And nothing is written, not even the
 * file's folder, for a run that can't be repeated, or whose file voicecap itself would refuse to
 * read (a step limit above 100,000, say).
 */
import { mkdir, open, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";

import type { RunJson } from "../model.js";
import { plural } from "../report/html.js";
import { resolveHome } from "../run/paths.js";
import { chooseSiteDir } from "../run/site-dir.js";
import { listRuns } from "../run/store.js";
import { formatCommand } from "../util/command-line.js";
import { errorMessage, UsageError } from "../util/errors.js";
import { resolveUserPath } from "../util/git-bash.js";
import { createConsoleLogger, type Logger } from "../util/log.js";
import {
  walkthroughJson,
  walkthroughOf,
  walkthroughProblem,
  type Walkthrough,
} from "./walkthrough.js";

export interface WriteWalkthroughOptions {
  /** Where to write it, resolved against `cwd`. Never overwritten. */
  file: string;
  /** Any URL on the site. Default: the home's only site. */
  site?: string | null;
  /**
   * The run to write it from, by its id. It has to have completed. Default: the latest completed
   * run, by when it was created, a replayed one included.
   */
  run?: string | null;
  /** The transcripts home. Default: VOICECAP_TRANSCRIPTS, else "transcripts". */
  out?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
}

export interface WriteWalkthroughResult {
  /** The file written: its full path. */
  file: string;
  runId: string;
  walkthrough: Walkthrough;
}

/**
 * Write the walkthrough of a run of a site to a new file, and say where it is and how to repeat the
 * run from it. Refuses with a UsageError, writing nothing, when the site has no completed run, when
 * the run named isn't there or didn't complete, when the run's file couldn't be read back, and when
 * something is at `file` already.
 */
export async function writeWalkthrough(
  options: WriteWalkthroughOptions,
): Promise<WriteWalkthroughResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const logger = options.logger ?? createConsoleLogger();
  const home = resolveHome({ out: options.out, env, cwd });
  const siteDir = await chooseSiteDir({ home, site: options.site ?? null });

  const run = chooseRun(await listRuns(siteDir), options.run ?? null, siteDir);
  // A run that didn't complete is refused here, in walkthroughOf's words.
  const walkthrough = walkthroughOf(run);
  // The config allows runs that a file can't hold: never write one that voicecap would refuse.
  const problem = walkthroughProblem(walkthrough);
  if (problem !== null) {
    throw new UsageError(`Run ${run.id}'s walkthrough file can't be written: ${problem}`);
  }

  const file = resolveUserPath(cwd, options.file);
  await writeNew(file, walkthroughJson(walkthrough), logger);
  logger.info(
    `Wrote the walkthrough of run ${run.id} (${plural(walkthrough.pages.length, "page")}) to ${file}.`,
  );
  logger.info(`To repeat the run: ${formatCommand(["--walkthrough", file])}`);
  return { file, runId: run.id, walkthrough };
}

/**
 * The run to write the walkthrough of: the one `id` names, or else the latest completed one. `runs`
 * is oldest first, by when each was created, which is what listRuns gives. Whether the named run
 * completed isn't asked here: walkthroughOf refuses one that didn't.
 */
function chooseRun(runs: readonly RunJson[], id: string | null, siteDir: string): RunJson {
  if (id !== null) {
    const named = runs.find((run) => run.id === id);
    if (named === undefined) throw new UsageError(`There's no run ${id} in ${siteDir}.`);
    return named;
  }
  const latest = runs.findLast((run) => run.status === "completed");
  if (latest === undefined) {
    throw new UsageError(
      `There's no completed run in ${siteDir} yet, so there's nothing to repeat.`,
    );
  }
  return latest;
}

/**
 * Write `text` to a new file, making its folder if it's missing: written and synced to disk before
 * it's closed. A file that can't be written whole is taken away again, and the error comes through.
 */
async function writeNew(file: string, text: string, logger: Logger): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await openNew(file);
  try {
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await takeAway(file, logger);
    throw error;
  }
}

/**
 * `file`, opened to be written as a new file. The `wx` flag refuses anything that's there already (a
 * file, a folder, or a link, even one that points nowhere), and a UsageError says so.
 */
async function openNew(file: string): Promise<FileHandle> {
  try {
    return await open(file, "wx");
  } catch (error) {
    // EEXIST is how the `wx` flag says that something is there already: any other error is given.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new UsageError(
      `${file} is already there. voicecap doesn't overwrite it: give another name, or move that file first.`,
    );
  }
}

/**
 * Take away a file this began and couldn't finish, and say so if it can't be (a program holding the
 * new file, say), since the next try would be refused for it. The error that stopped the write is the
 * one given, so a removal that fails never replaces it.
 */
async function takeAway(file: string, logger: Logger): Promise<void> {
  try {
    // A few tries: Windows refuses to remove a file for a moment while a scanner has it open.
    await rm(file, { force: true, maxRetries: 3 });
  } catch (error) {
    logger.warn(
      `${file} is incomplete, and couldn't be removed (${errorMessage(error)}). Delete it before you try again.`,
    );
  }
}
