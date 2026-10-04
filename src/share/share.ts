/**
 * `voicecap share`: a dated copy of a site's shareable page and of its Word copy, made to send, each
 * run's walkthrough file beside them, and the record of what was sent.
 *
 * share/current.html and share/current.docx change with every run, review, and report, so what's
 * sent can't be those. Each share makes a pair of its own, named for the site's folder and the day
 * (`example.illinois.gov_2027-01-15.html` and `.docx`, then `-2`, `-3` for a later share the same
 * day). Beside the pair it writes the walkthrough file of each run the pair draws on, named for the
 * pair and the run (`example.illinois.gov_2027-01-15_2027-01-14_0900_walkthrough.json`): the very
 * file the page offers to download, so a website of what was shared has one to offer. A run that
 * can't have a walkthrough file (see RunWalkthrough) is warned of, and the share goes on without it.
 *
 * share/shares.json (./shares.ts) records every file: when, who by, the runs the copies drew on,
 * and each file's size and SHA-256, with a walkthrough file's run. The output ends with a line to
 * paste into the email that sends the pair, so a receiver can check a file against the sender's own
 * fingerprint. The line names only the pair: the walkthrough files aren't what's emailed.
 *
 * A copy is never written over a file: each is opened with the `wx` flag, which refuses a name
 * that's taken, and a name that's taken meanwhile means the next number. And a share that fails with
 * an error leaves no copy that nothing records: it takes away what it wrote, so `voicecap verify`
 * finds none the record doesn't name. Two things can still leave one: a kill between writing and
 * recording, and a copy that can't be removed, which warns of it. `verify` names such a copy.
 *
 * No lock is taken, as `voicecap review` takes none: appendShare reads the record again just before
 * it writes it.
 */
import { lstat, mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

import { loadConfig, type LoadedConfig } from "../config/load.js";
import type { ShareEntry, SharedFile } from "../model.js";
import { resolveReviewer } from "../reviews/reviewer.js";
import { ensureGitFiles } from "../run/git-files.js";
import { resolveHome, shareDir, sharesPath } from "../run/paths.js";
import { chooseSiteDir } from "../run/site-dir.js";
import { errorMessage, UsageError } from "../util/errors.js";
import { sha256 } from "../util/hash.js";
import { createConsoleLogger, type Logger } from "../util/log.js";
import { isoLocal, localDate } from "../util/time.js";
import { renderWordCopy } from "./docx.js";
import { fontFaceCss } from "./fonts.js";
import { MEGABYTE, sizeLine, sizeWords } from "./format.js";
import { renderSharePage } from "./html/document.js";
import { loadShareInput } from "./load.js";
import { buildShareModel, type RunEvidence } from "./model.js";
import { appendShare, readShares, recordedNames } from "./shares.js";
import { MAC_HASH, POWERSHELL_HASH } from "./text.js";

export interface ShareReportOptions {
  /** Any URL on the site. Default: the home's only site. */
  site?: string | null;
  /** The transcripts home. Default: VOICECAP_TRANSCRIPTS, else "transcripts". */
  out?: string;
  /** Who is sharing. Default: VOICECAP_REVIEWER, then git config user.name, then the config's reviewer. */
  reviewer?: string | null;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  config?: LoadedConfig;
  logger?: Logger;
  now?: Date;
}

export interface ShareReportResult {
  siteDir: string;
  /** The entry as shares.json holds it. */
  entry: ShareEntry;
  /**
   * The page, then its Word copy, then each run's walkthrough file, oldest run first: each file's
   * full path, with what the entry records of it.
   */
  files: (SharedFile & { path: string })[];
  /** The line to paste into the email that sends the page and its Word copy. */
  pasteLine: string;
}

/**
 * The size above which a copy is warned of: 20 MB, which is too big for most email. A copy of
 * exactly this size isn't.
 */
export const EMAIL_LIMIT_BYTES = 20 * 1024 * 1024;

/**
 * What to say of a copy over EMAIL_LIMIT_BYTES ("x.html is 23.4 MB, over 20 MB: too big for most
 * email."), and null for one that isn't.
 */
export function sizeWarning(name: string, bytes: number): string | null {
  return bytes > EMAIL_LIMIT_BYTES
    ? `${name} is ${sizeWords(bytes)}, over ${EMAIL_LIMIT_BYTES / MEGABYTE} MB: too big for most email.`
    : null;
}

/** A copy to write: its name in the share folder, and its exact bytes. */
interface Copy {
  name: string;
  bytes: Uint8Array;
  /** The run a walkthrough file is of. Only a walkthrough file has it. */
  run?: string;
}

/** The walkthrough file of a run the copies draw on: exactly the bytes the page's download carries. */
interface RunFile {
  run: string;
  bytes: Buffer;
}

/**
 * Make the dated pair of a site's shareable page and its Word copy, and the walkthrough file of each
 * run the pair draws on, write them beside the page that's kept current, record them with each
 * file's fingerprint, and say what was made, ending with the line to paste into the email that sends
 * the pair. Refuses with a UsageError when no run counts, when there's no name for who is sharing,
 * and when shares.json can't be read: it never replaces a record it can't use.
 */
export async function shareReport(options: ShareReportOptions = {}): Promise<ShareReportResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const logger = options.logger ?? createConsoleLogger();
  const now = options.now ?? new Date();
  const home = resolveHome({ out: options.out, env, cwd });
  const siteDir = await chooseSiteDir({ home, site: options.site ?? null });
  const { config } = options.config ?? (await loadConfig({ cwd }));
  const reviewer = resolveReviewer({
    option: options.reviewer,
    env,
    configReviewer: config.reviewer,
    cwd,
  });

  // Every record is read here, once: it's what takes the time. The model is built from it again for
  // each pair of names tried, which is cheap.
  const input = await loadShareInput({ siteDir, config, now });
  // The model as the current copies have it: it says whether a run counts, and it has each run's
  // walkthrough file, which no name changes.
  const current = buildShareModel(input);
  if (current.header.tested === null) {
    throw new UsageError(
      `No completed, sealed, live run in ${siteDir} yet, so there's nothing to share. Replayed, interrupted, and unsealed runs don't count.`,
    );
  }
  // Before any copy is written, so a record that can't be read stops the share with nothing made.
  const recorded = recordedNames((await readShares(siteDir)).shares);
  // Made once here, so that a run that can't have a walkthrough file is warned of once, however
  // many numbers are tried.
  const walkthroughs = walkthroughsOf(current.evidence, logger);

  const dir = shareDir(siteDir);
  const folder = path.basename(siteDir);
  const day = localDate(now);
  for (let number = 1; ; number++) {
    const stem = number === 1 ? `${folder}_${day}` : `${folder}_${day}-${number}`;
    const names = { page: `${stem}.html`, word: `${stem}.docx` };
    // Named for the pair and the run, so that every file of a share has the share's stem.
    const walkthroughCopies = walkthroughs.map(({ run, bytes }): Copy => ({
      name: `${stem}_${run}_walkthrough.json`,
      bytes,
      run,
    }));
    const everyName = [names.page, names.word, ...walkthroughCopies.map(({ name }) => name)];
    if (await isTaken(dir, everyName, recorded)) continue;

    // Each copy's footer names itself and the other, so a pair's model is its own.
    const model = buildShareModel({ ...input, fileName: names.page, wordName: names.word });
    const copies: Copy[] = [
      {
        name: names.page,
        bytes: Buffer.from(renderSharePage(model, { fontCss: await fontFaceCss() }), "utf8"),
      },
      { name: names.word, bytes: await renderWordCopy(model) },
      ...walkthroughCopies,
    ];
    await mkdir(dir, { recursive: true });
    // A name that was taken since it was chosen: whatever this wrote of the copies is gone, and the
    // next number is tried, from the model on.
    if (!(await writeNew(dir, copies, logger))) continue;

    let entry: ShareEntry;
    try {
      await ensureGitFiles(home);
      entry = await appendShare(siteDir, {
        at: isoLocal(now),
        by: reviewer.name,
        // The model lists the runs the copies draw on latest first.
        runs: model.evidence.map(({ run }) => run.id).reverse(),
        files: copies.map(recordOf),
      });
    } catch (error) {
      // Nothing records these copies, and nothing will: take them away, and give the error.
      await removeCopies(
        copies.map(({ name }) => path.join(dir, name)),
        logger,
      );
      throw error;
    }

    const files = entry.files.map((file) => ({ ...file, path: path.join(dir, file.name) }));
    // What's emailed is the page and its Word copy: the files with no run.
    const pasteLine = pasteLineOf(entry.files.filter(({ run }) => run === undefined));
    logger.info(
      `Shared ${folder}, as of ${model.header.asOf}: entry ${entry.seq} in ${sharesPath(siteDir)}.`,
    );
    for (const file of files) {
      logger.info(`  ${file.path}`);
      logger.info(`    ${sizeLine(file.bytes)}, SHA-256 ${file.sha256}`);
    }
    logger.info("To paste into the email that sends them:");
    logger.info(`  ${pasteLine}`);
    for (const file of files) {
      const warning = sizeWarning(file.name, file.bytes);
      if (warning !== null) logger.warn(warning);
    }
    return { siteDir, entry, files, pasteLine };
  }
}

/**
 * The line for the email that sends the page and its Word copy (`files`): each one's name and
 * fingerprint, and how a receiver checks the file they were sent, with the commands the copies' own
 * check names (./text.ts). The fingerprints are in lower case, as the copies and the record have
 * them, and PowerShell prints a fingerprint in capitals, so the line ends by saying it's the same
 * letters.
 */
function pasteLineOf(files: SharedFile[]): string {
  const fingerprints = files.map(({ name, sha256: fingerprint }) => `${name} ${fingerprint}`);
  return `Fingerprints (SHA-256): ${fingerprints.join("; ")}. To check a file you received: ${POWERSHELL_HASH} in PowerShell, or ${MAC_HASH} on a Mac. PowerShell shows the same letters in capitals.`;
}

/**
 * The walkthrough file of each run the copies draw on, oldest first (the model lists them latest
 * first): exactly the bytes its download on the page carries. A run that can't have one (see
 * RunWalkthrough) is warned of, and has none: the file is an extra, so it never stops the share.
 */
function walkthroughsOf(evidence: readonly RunEvidence[], logger: Logger): RunFile[] {
  const files: RunFile[] = [];
  for (const { run, walkthrough } of evidence.toReversed()) {
    if ("problem" in walkthrough) {
      logger.warn(
        `Run ${run.id}'s walkthrough file can't be made, so it isn't shared: ${walkthrough.problem}`,
      );
    } else {
      files.push({ run: run.id, bytes: Buffer.from(walkthrough.base64, "base64") });
    }
  }
  return files;
}

/**
 * What the record keeps of a copy, built key by key: its name, size, and SHA-256, and a walkthrough
 * file's run last. The page's and the Word copy's have no run key.
 */
function recordOf({ name, bytes, run }: Copy): SharedFile {
  const file: SharedFile = { name, bytes: bytes.length, sha256: sha256(bytes) };
  if (run !== undefined) file.run = run;
  return file;
}

/** Whether anything is at `file`: a file, a folder, or a link, even one that points nowhere. */
async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // A folder that isn't there, or a file where the folder would be: nothing is at `file`.
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

/**
 * Whether any of the names a share would use (its page, its Word copy, and each walkthrough file) is
 * taken: the record names it (whether or not its file is still there), or anything at all has the
 * name in `dir`.
 */
async function isTaken(
  dir: string,
  names: readonly string[],
  recorded: ReadonlySet<string>,
): Promise<boolean> {
  for (const name of names) {
    if (recorded.has(name) || (await exists(path.join(dir, name)))) return true;
  }
  return false;
}

/**
 * Write each copy to a new file in `dir`: opened with the `wx` flag, so a file that's there is never
 * written over, then written and synced to disk before it's closed, so a copy that's recorded is on
 * disk. False, with only what this wrote of the copies taken away, when a name has been taken since
 * it was chosen. A copy that can't be written for any other reason takes the ones written before it
 * away too, and the error comes through.
 */
async function writeNew(dir: string, copies: Copy[], logger: Logger): Promise<boolean> {
  const written: string[] = [];
  try {
    for (const { name, bytes } of copies) {
      const file = path.join(dir, name);
      const handle = await open(file, "wx");
      // The file is ours from here, whole or not.
      written.push(file);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    return true;
  } catch (error) {
    await removeCopies(written, logger);
    // Only opening a file that's there says so: nothing else here can.
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/**
 * Take away files this share wrote, and say of any that can't be removed (a program holding the new
 * file, say) that it's there, since nothing records it. The error that stopped the share is the one
 * given, so a removal that fails never replaces it.
 */
async function removeCopies(files: string[], logger: Logger): Promise<void> {
  for (const file of files) {
    try {
      // A few tries: Windows refuses to remove a file for a moment while a scanner has it open.
      await rm(file, { force: true, maxRetries: 3 });
    } catch (error) {
      logger.warn(
        `Couldn't remove ${file}, which this share wrote and nothing records: ${errorMessage(error)}`,
      );
    }
  }
}
