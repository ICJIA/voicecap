/**
 * The shareable page, written to a site folder's share/current.html: one self-contained file with
 * the site's standing from its sealed runs, always the latest. Whatever writes the site's live
 * report writes it too (a completed run, a review, a manual session, and `voicecap report`).
 *
 * It never fails what asks for it: a page that can't be made or written is a warning, and null, so
 * a run, a review, or a report is never lost to it.
 */
import type { VoicecapConfig } from "../config/schema.js";
import { sharePath } from "../run/paths.js";
import { listRuns } from "../run/store.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { errorMessage } from "../util/errors.js";
import type { Logger } from "../util/log.js";
import { fontFaceCss } from "./fonts.js";
import { renderSharePage } from "./html/document.js";
import { loadShareInput } from "./load.js";
import { buildShareModel } from "./model.js";

export interface WriteSharePageOptions {
  /** The site's folder in the transcripts home, not the home itself (see siteDirFor). */
  siteDir: string;
  config: VoicecapConfig;
  logger: Logger;
  /** When the page is made, as its date and its "as of" time. Default: now. */
  now?: Date;
}

/**
 * Write the site's page, and return its path. Null, with nothing said, when the site folder holds
 * no run yet (an ordinary case: there's nothing to share); null, with a warning, when the page
 * can't be made or written.
 */
export async function writeSharePage(options: WriteSharePageOptions): Promise<string | null> {
  const { siteDir, config, logger, now } = options;
  try {
    if ((await listRuns(siteDir)).length === 0) return null;
    const input = await loadShareInput({ siteDir, config, now });
    const html = renderSharePage(buildShareModel(input), { fontCss: await fontFaceCss() });
    const file = sharePath(siteDir);
    await writeFileAtomic(file, html);
    return file;
  } catch (error) {
    logger.warn(`The shareable page wasn't updated: ${errorMessage(error)}`);
    return null;
  }
}
