import type { PageRecord, PassName, ReviewEntry } from "../model.js";

/**
 * Whether a page's transcripts changed since its last review: the review recorded the TXT-body
 * hash of each pass it saw; compare them with the run being shown.
 *
 * Returns null when there's nothing to compare: no review, a latest entry that is "unreviewed",
 * or a page the run has no transcripts for.
 */
export function changedSinceReview(
  entry: ReviewEntry | undefined,
  page: PageRecord | undefined,
): boolean | null {
  if (!entry || entry.status === "unreviewed") return null;
  if (!page || page.status !== "done") return null;
  const passes = new Set<PassName>([
    ...(Object.keys(page.passes) as PassName[]),
    ...(Object.keys(entry.content) as PassName[]),
  ]);
  for (const pass of passes) {
    if (page.passes[pass]?.contentSha256 !== entry.content[pass]) return true;
  }
  return false;
}
