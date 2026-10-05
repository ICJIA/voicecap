/**
 * What the shareable page reads of a run's record before it uses it. A record is data: a later
 * voicecap, or an edit, can give a field another shape than this version writes, and the page must
 * still be made, saying what it can't read, rather than stop. Pure.
 */
import type { FileHash, PageRecord, ScreenshotRecord } from "../model.js";

/** Whether a value is a file's fingerprint as voicecap records one: its SHA-256 and its size. */
export function isFileHash(value: unknown): value is FileHash {
  if (typeof value !== "object" || value === null) return false;
  const { sha256, bytes } = value as Record<string, unknown>;
  return typeof sha256 === "string" && typeof bytes === "number";
}

/**
 * A page's screenshot record (PageRecord.screenshot), read for what it is: undefined when the page
 * has none; the record, when it's of a kind voicecap writes, the reason none could be taken (an
 * object with `error`, whose reason is read where it's said) or the file's fingerprint; and
 * "unreadable" for anything else (null, a string, an object of neither kind), which the page says it
 * couldn't read, and which names no file. The loader, the cards, and the evidence each read a record
 * through this, so none of them stops on one, and they never disagree about it.
 */
export function screenshotRecordOf(page: PageRecord): ScreenshotRecord | "unreadable" | undefined {
  const record: unknown = page.screenshot;
  if (record === undefined) return undefined;
  if (typeof record !== "object" || record === null || Array.isArray(record)) return "unreadable";
  if ("error" in record || isFileHash(record)) return record as ScreenshotRecord;
  return "unreadable";
}
