/**
 * <site>/share/shares.json, the record of what `voicecap share` sent: one entry each time it made
 * copies of the shareable page and its Word copy to send, with when, who by, the runs the copies
 * drew on, and each file's name, size, and SHA-256. Entries are chained and sealed as reviews.json's
 * are (see ../reviews/store.ts), and never edited or deleted once they're recorded.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import type { ShareEntry, SharesFile } from "../model.js";
import { sharesPath } from "../run/paths.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { UsageError } from "../util/errors.js";
import { sealOf } from "../util/hash.js";

/**
 * What both refusals end with. A copy that was sent is checked against this record, so a file
 * voicecap can't use is left for a person to fix, and is never replaced with a new one.
 */
const NEVER_OVERWRITES =
  "voicecap never overwrites the record of what was shared: fix the file or restore it from version control.";

/**
 * A site folder's shares.json. A missing file is an empty record. A file that isn't JSON, or isn't
 * `{ schemaVersion: 1, shares: [...] }` with an object for each entry, is refused with a
 * UsageError: it's never overwritten. Of each entry it checks only that it's an object, so its
 * seq, seal, and files are whatever a person left there, and a caller reads each as unknown.
 */
export async function readShares(siteDir: string): Promise<SharesFile> {
  const file = sharesPath(siteDir);
  if (!existsSync(file)) return { schemaVersion: 1, shares: [] };
  return parseShares(await readFile(file, "utf8"), file);
}

/**
 * Append one entry, chained and sealed. Earlier entries are never edited or deleted: the file is
 * re-read, checked, extended, verified to still hold every earlier entry unchanged, and written
 * atomically, in a share/ folder made if the site has none yet. A file that can't be read is never
 * overwritten (see readShares). The entry's seq, prev, and seal are set here, whatever it brings;
 * what's returned is the entry as it was written, not the file.
 */
export async function appendShare(
  siteDir: string,
  entry: Omit<ShareEntry, "seq" | "prev" | "seal">,
): Promise<ShareEntry> {
  const file = sharesPath(siteDir);
  const before = await readShares(siteDir);
  const { seq, prev } = nextInChain(before);
  // Built key by key, in the order the file reads them, whatever order or extras the entry brings.
  const unsealed: Omit<ShareEntry, "seal"> = {
    seq,
    prev,
    at: entry.at,
    by: entry.by,
    runs: entry.runs,
    files: entry.files,
  };
  const sealed: ShareEntry = { ...unsealed, seal: sealOf(unsealed) };

  const after = structuredClone(before);
  after.shares.push(sealed);
  if (!isDeepStrictEqual(after.shares.slice(0, before.shares.length), before.shares)) {
    throw new Error("Refusing to write shares.json: an earlier share would change.");
  }
  await writeFileAtomic(file, `${JSON.stringify(after, null, 2)}\n`);
  return sealed;
}

/**
 * The file names the record gives its copies. Reading the record checks only that each entry is an
 * object, so an entry may hold anything a person left in it: one whose files aren't a list, or
 * whose items aren't objects with a name, names nothing.
 */
export function recordedNames(shares: readonly unknown[]): Set<string> {
  const names = new Set<string>();
  for (const share of shares) {
    const files = isObject(share) ? share.files : undefined;
    if (!Array.isArray(files)) continue;
    for (const file of files as unknown[]) {
      if (isObject(file) && typeof file.name === "string") names.add(file.name);
    }
  }
  return names;
}

/**
 * Whether `value` can be an entry's seq: a whole number, 1 or more. It's the one rule for a place in
 * the chain: the next entry is numbered by it (see nextInChain), and `voicecap verify` checks the
 * chain by it.
 */
export function isSeq(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * The seq and prev for the next entry: one past the highest seq in the file (1, when there is
 * none), and the seal of the entry that has it (null, when there is none). Only a seq that isSeq
 * counts. Reading checks only that each entry is an object, so one may have no usable seq (none,
 * text, 2.5, 0, or 1e999, which reads as Infinity), and takes no part in the chain.
 */
function nextInChain(file: SharesFile): { seq: number; prev: string | null } {
  let latest: ShareEntry | undefined;
  for (const candidate of file.shares) {
    if (isSeq(candidate.seq) && candidate.seq > (latest?.seq ?? 0)) {
      latest = candidate;
    }
  }
  return { seq: (latest?.seq ?? 0) + 1, prev: latest?.seal ?? null };
}

/**
 * Parse the file's text as the record. A leading byte order mark (a Windows editor adds one) is
 * skipped. Of each entry, only that it's an object is checked: whether its seal holds, and its
 * place in the chain, are for `voicecap verify`.
 */
function parseShares(text: string, file: string): SharesFile {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new UsageError(`${file} is not valid JSON. ${NEVER_OVERWRITES}`, { cause: error });
  }
  if (!hasSharesShape(data)) {
    throw new UsageError(
      `${file} doesn't look like voicecap's record of what was shared (expected schemaVersion 1 and a "shares" list with an object for each entry). ${NEVER_OVERWRITES}`,
    );
  }
  return data as SharesFile;
}

/** Whether `data` is `{ schemaVersion: 1, shares: [...] }`, with an object for each entry. */
function hasSharesShape(data: unknown): boolean {
  if (!isObject(data)) return false;
  const { schemaVersion, shares } = data;
  return schemaVersion === 1 && Array.isArray(shares) && shares.every(isObject);
}

/** Whether `value` is an object: not null, and not a list. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
