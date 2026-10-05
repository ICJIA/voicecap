/**
 * The shareable page and its Word copy, written to a site folder's share/current.html and
 * share/current.docx: the page one self-contained file, the Word copy one .docx, each with the
 * site's standing from its sealed runs, always the latest, and both made from one model. Whatever
 * writes the site's live report writes them too (a completed run, a review, a manual session, and
 * `voicecap report`).
 *
 * It never fails what asks for it: a file that can't be made or written is a warning, and null, so
 * a run, a review, or a report is never lost to it. And neither file depends on the other: one that
 * fails never stops the other being written.
 */
import path from "node:path";

import type { VoicecapConfig } from "../config/schema.js";
import { sharePath, shareWordPath } from "../run/paths.js";
import { listRuns } from "../run/store.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { formatCommand } from "../util/command-line.js";
import { errorMessage } from "../util/errors.js";
import type { Logger } from "../util/log.js";
import { renderWordCopy } from "./docx.js";
import { fontFaceCss } from "./fonts.js";
import { renderSharePage } from "./html/document.js";
import { loadShareInput, type ShareInput } from "./load.js";
import { buildShareModel, type ShareModel } from "./model.js";

export interface WriteShareFilesOptions {
  /** The site's folder in the transcripts home, not the home itself (see siteDirFor). */
  siteDir: string;
  config: VoicecapConfig;
  logger: Logger;
  /** When the files are made, as their date and their "as of" time. Default: now. */
  now?: Date;
  /** Replaces fs.rename in both writes (tests). */
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * The files written: each one's path, or null when it couldn't be made or written, which was said
 * as a warning.
 */
export interface ShareFiles {
  page: string | null;
  word: string | null;
}

/**
 * How long a refused rename of the Word copy is tried again. A document Word has open can't be
 * replaced for as long as it's open, so waiting only helps for a moment's hold (an antivirus scan,
 * say), and a run or a review that's ending shouldn't wait on a person's Word.
 */
const WORD_RETRY_MS = 1000;

/** The codes the OS gives for a file another program holds (the ones writeFileAtomic retries). */
const HELD_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

const pageNotUpdated = (error: unknown): string =>
  `The shareable page wasn't updated: ${errorMessage(error)}`;

const wordNotUpdated = (reason: string): string => `The Word copy wasn't updated: ${reason}`;

/**
 * The OS's code when it refused because another program has the file open, as Word does a document;
 * null for any other error.
 */
function heldCode(error: unknown): string | null {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return code !== undefined && HELD_CODES.has(code) ? code : null;
}

/**
 * Why the Word copy wasn't updated when its file is held, in plain words, none of them the OS's:
 * what couldn't be done, with its code, when that happens, and what to do, ending with the exact
 * command to run then. A bare `voicecap report` isn't it: it refuses in a home of several sites
 * without `--site`, and it looks in the default home, not one that `--out` gave. So the command
 * names the site by the address voicecap read, as terminal output does, which finds the site's
 * folder, and the home that the folder is in.
 */
function heldReason(code: string, site: string, siteDir: string): string {
  const command = formatCommand(["report", "--site", site, "--out", path.dirname(siteDir)]);
  return `current.docx couldn't be replaced (${code}). That happens while it's open in Word. If it is, close it, then run: ${command}`;
}

/**
 * Write the site's page, and then its Word copy, from one model, and give their paths. Null, with
 * nothing said, when the site folder holds no run yet (an ordinary case: there's nothing to share).
 *
 * Each file is made and written on its own: one that can't be is a warning and a null path, and the
 * other is written all the same. When nothing can be made of the site's records, neither file can
 * be: each says so, the page's first, with the same reason, and both paths are null. When the OS
 * says another program holds the Word copy's file, its warning says why in plain words, and to
 * close it in Word and run the exact `voicecap report` command that writes it again.
 */
export async function writeShareFiles(options: WriteShareFilesOptions): Promise<ShareFiles | null> {
  const { siteDir, config, logger, now, rename } = options;
  let input: ShareInput;
  let model: ShareModel;
  try {
    if ((await listRuns(siteDir)).length === 0) return null;
    input = await loadShareInput({ siteDir, config, now });
    model = buildShareModel(input);
  } catch (error) {
    // Neither file was tried, so no file of Word's was refused: the reason is all there is to say.
    logger.warn(pageNotUpdated(error));
    logger.warn(wordNotUpdated(errorMessage(error)));
    return { page: null, word: null };
  }
  const page = await writePage(model, siteDir, rename, logger);
  const word = await writeWord(model, input.readOrigin, siteDir, rename, logger);
  return { page, word };
}

/** The page, made and written: its path, or null with a warning. */
async function writePage(
  model: ShareModel,
  siteDir: string,
  rename: WriteShareFilesOptions["rename"],
  logger: Logger,
): Promise<string | null> {
  try {
    const html = renderSharePage(model, { fontCss: await fontFaceCss() });
    const file = sharePath(siteDir);
    await writeFileAtomic(file, html, { rename });
    return file;
  } catch (error) {
    logger.warn(pageNotUpdated(error));
    return null;
  }
}

/**
 * The Word copy, made and written: its path, or null with a warning. `readOrigin` is the address
 * voicecap read the site at, which the warning's command names.
 */
async function writeWord(
  model: ShareModel,
  readOrigin: string,
  siteDir: string,
  rename: WriteShareFilesOptions["rename"],
  logger: Logger,
): Promise<string | null> {
  try {
    const bytes = await renderWordCopy(model);
    const file = shareWordPath(siteDir);
    await writeFileAtomic(file, bytes, { retryForMs: WORD_RETRY_MS, rename });
    return file;
  } catch (error) {
    const held = heldCode(error);
    logger.warn(
      wordNotUpdated(held === null ? errorMessage(error) : heldReason(held, readOrigin, siteDir)),
    );
    return null;
  }
}
