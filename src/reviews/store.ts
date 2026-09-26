import { isDeepStrictEqual } from "node:util";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { ReviewEntry, ReviewsFile } from "../model.js";
import { reviewsPath } from "../run/paths.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { UsageError } from "../util/errors.js";

/** Read transcripts/reviews.json. A missing file is an empty history. */
export async function readReviews(outDir: string): Promise<ReviewsFile> {
  const file = reviewsPath(outDir);
  if (!existsSync(file)) return { schemaVersion: 1, pages: {} };
  return parseReviews(await readFile(file, "utf8"), file);
}

/**
 * Append one entry to a page's history. Existing entries are never edited or deleted: the file is
 * re-read, checked, extended, verified to still contain every earlier entry unchanged, and
 * written atomically. A damaged file is never overwritten.
 */
export async function appendReview(
  outDir: string,
  pageKey: string,
  entry: ReviewEntry,
): Promise<ReviewsFile> {
  const file = reviewsPath(outDir);
  const before = existsSync(file)
    ? parseReviews(await readFile(file, "utf8"), file)
    : { schemaVersion: 1 as const, pages: {} };
  const after: ReviewsFile = structuredClone(before);
  (after.pages[pageKey] ??= []).push(entry);

  for (const [key, entries] of Object.entries(before.pages)) {
    const kept = after.pages[key]?.slice(0, entries.length);
    if (!isDeepStrictEqual(kept, entries)) {
      throw new Error(`Refusing to write reviews.json: history for ${key} would change.`);
    }
  }
  await writeFileAtomic(file, `${JSON.stringify(after, null, 2)}\n`);
  return after;
}

/** The page's current review: the latest entry, if any. */
export function latestReview(reviews: ReviewsFile, pageKey: string): ReviewEntry | undefined {
  return reviews.pages[pageKey]?.at(-1);
}

function parseReviews(text: string, file: string): ReviewsFile {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new UsageError(
      `${file} is not valid JSON. voicecap never overwrites review history: fix the file or restore it from version control.`,
      { cause: error },
    );
  }
  const pages = (data as { pages?: unknown } | null)?.pages;
  if (
    (data as { schemaVersion?: unknown } | null)?.schemaVersion !== 1 ||
    pages === null ||
    typeof pages !== "object" ||
    Array.isArray(pages) ||
    !Object.values(pages).every(Array.isArray)
  ) {
    throw new UsageError(
      `${file} doesn't look like a voicecap review history (expected schemaVersion 1 and a "pages" object of arrays).`,
    );
  }
  return data as ReviewsFile;
}
