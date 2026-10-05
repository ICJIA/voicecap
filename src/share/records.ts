/**
 * What the shareable page reads of a run's record before it uses it. A record is data: a later
 * voicecap, or an edit, can give a field another shape than this version writes, and the page must
 * still be made, saying what it can't read, rather than stop. Pure.
 */
import type { FileHash } from "../model.js";

/** Whether a value is a file's fingerprint as voicecap records one: its SHA-256 and its size. */
export function isFileHash(value: unknown): value is FileHash {
  if (typeof value !== "object" || value === null) return false;
  const { sha256, bytes } = value as Record<string, unknown>;
  return typeof sha256 === "string" && typeof bytes === "number";
}
