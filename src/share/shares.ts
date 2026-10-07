/**
 * <site>/share/shares.json, the record of what `voicecap share` sent: one entry each time it made
 * copies of the shareable page and its Word copy to send, and of each run's walkthrough file, with
 * when, who by, the root of the site the copies name (their file names are made from it), the runs
 * the copies drew on, what the copies say of the site (see shareResultOf), and each file's name,
 * size, and SHA-256 (a walkthrough file's also names its run). Entries are chained and sealed as
 * reviews.json's are (see ../reviews/store.ts), and never edited or deleted once they're recorded.
 * An entry recorded before 0.10.0 has no site, and one recorded before 0.12.3 no result.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import type { ShareEntry, SharedFile, ShareResult } from "../model.js";
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

/** As read: only that each entry is an object is checked, so a caller checks each field it uses. */
export interface SharesAsRead {
  schemaVersion: 1;
  shares: Record<string, unknown>[];
}

/**
 * A site folder's shares.json. A missing file is an empty record. A file that isn't JSON, or isn't
 * `{ schemaVersion: 1, shares: [...] }` with an object for each entry, is refused with a
 * UsageError: it's never overwritten. Of each entry it checks only that it's an object, so its
 * seq, seal, and files are whatever a person left there: the type says so (SharesAsRead), and a
 * caller checks each field it uses.
 */
export async function readShares(siteDir: string): Promise<SharesAsRead> {
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
  // An entry with no site has no such key, as the entries recorded before 0.10.0 have none, and
  // one with no result none, as those recorded before 0.12.3.
  const { result } = entry;
  const unsealed: Omit<ShareEntry, "seal"> = {
    seq,
    prev,
    at: entry.at,
    by: entry.by,
    ...(entry.site === undefined ? {} : { site: entry.site }),
    runs: entry.runs,
    ...(result === undefined
      ? {}
      : {
          result: {
            pages: result.pages,
            read: result.read,
            problems: result.problems,
            problemPages: result.problemPages,
          },
        }),
    files: entry.files,
  };
  const sealed: ShareEntry = { ...unsealed, seal: sealOf(unsealed) };

  const after = structuredClone(before);
  // A spread: an interface (ShareEntry) isn't a Record<string, unknown>, but its fields are.
  after.shares.push({ ...sealed });
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
 * The files an entry records, each as { name, bytes, sha256 } and, when it's text, its run, last:
 * built key by key, so that nothing else a person left in a file is carried on. Null unless `files`
 * is a list of such files. A name isn't checked here (see isPlainName).
 */
export function recordedFiles(files: unknown): SharedFile[] | null {
  if (!Array.isArray(files)) return null;
  const listed: SharedFile[] = [];
  for (const file of files as unknown[]) {
    if (
      !isObject(file) ||
      typeof file.name !== "string" ||
      typeof file.bytes !== "number" ||
      typeof file.sha256 !== "string"
    ) {
      return null;
    }
    const recorded: SharedFile = { name: file.name, bytes: file.bytes, sha256: file.sha256 };
    if (typeof file.run === "string") recorded.run = file.run;
    listed.push(recorded);
  }
  return listed;
}

/**
 * Whether `name` is a file in share/ itself: not empty, ".", or "..", and with no separator in it
 * (nor a null character, which no file name has and which makes a read throw).
 */
export function isPlainName(name: string): boolean {
  return (
    name !== "" &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0")
  );
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
 * The result an entry records (from 0.12.3), as voicecap writes one: four whole numbers of 0 or
 * more, with no more pages read, or with a problem, than there are, and a page with a problem only
 * when there's a problem. A count it doesn't know is left out, so a later voicecap's isn't a reason
 * to doubt the four. Null for anything else, and for an entry that records none.
 */
export function shareResultOf(value: unknown): ShareResult | null {
  if (!isObject(value)) return null;
  const { pages, read, problems, problemPages } = value;
  const counts = [pages, read, problems, problemPages];
  if (!counts.every((count) => typeof count === "number" && Number.isSafeInteger(count))) {
    return null;
  }
  const result = { pages, read, problems, problemPages } as ShareResult;
  const fits =
    counts.every((count) => (count as number) >= 0) &&
    result.read <= result.pages &&
    result.problemPages <= result.pages &&
    (result.problems > 0 || result.problemPages === 0);
  return fits ? result : null;
}

/**
 * Whether an entry's seal holds. An entry nested too deep for sealOf, which reads it by recursion,
 * can't be sealed as voicecap seals one, so its seal doesn't hold: it's one that changed, and the
 * read goes on. One that lost its seal was changed, just like one that no longer matches it.
 */
export function sealHolds(entry: Record<string, unknown>): boolean {
  try {
    return entry.seal === sealOf(entry);
  } catch {
    return false;
  }
}

/**
 * The newest of a record's entries that can be trusted: the one with the highest seq of those whose
 * seal holds. An entry that was changed after it was recorded vouches for nothing, and one with no
 * usable seq has no place in the chain. Undefined for a record with none.
 */
export function newestSealed(
  shares: readonly Record<string, unknown>[],
): Record<string, unknown> | undefined {
  let newest: { entry: Record<string, unknown>; seq: number } | undefined;
  for (const entry of shares) {
    const { seq } = entry;
    if (!isSeq(seq) || !sealHolds(entry)) continue;
    if (newest === undefined || seq > newest.seq) newest = { entry, seq };
  }
  return newest?.entry;
}

/**
 * "share 2 (<time>)", or "a share at <time>" for one without a seq. An entry holds whatever a
 * person left in it, so one whose time can't be made into text (an object whose toString isn't a
 * function, or a list nested too deep) is just "a share": naming an entry never stops a caller.
 */
export function describeShare(entry: Record<string, unknown>): string {
  try {
    return isSeq(entry.seq)
      ? `share ${entry.seq} (${String(entry.at)})`
      : `a share at ${String(entry.at)}`;
  } catch {
    return "a share";
  }
}

/**
 * The seq and prev for the next entry: one past the highest seq in the file (1, when there is
 * none), and the seal of the entry that has it (null, when there is none, or when it isn't text).
 * Only a seq that isSeq counts. Reading checks only that each entry is an object, so one may have
 * no usable seq (none, text, 2.5, 0, or 1e999, which reads as Infinity), and takes no part in the
 * chain.
 */
function nextInChain(file: SharesAsRead): { seq: number; prev: string | null } {
  let seq = 0;
  let prev: string | null = null;
  for (const candidate of file.shares) {
    if (isSeq(candidate.seq) && candidate.seq > seq) {
      seq = candidate.seq;
      prev = typeof candidate.seal === "string" ? candidate.seal : null;
    }
  }
  return { seq: seq + 1, prev };
}

/**
 * Parse the file's text as the record. A leading byte order mark (a Windows editor adds one) is
 * skipped. Of each entry, only that it's an object is checked: whether its seal holds, and its
 * place in the chain, are for `voicecap verify`.
 */
function parseShares(text: string, file: string): SharesAsRead {
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
  return data as SharesAsRead;
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
