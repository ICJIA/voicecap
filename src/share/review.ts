/**
 * The human review of each page in a standing: who listened as its transcripts were made, what the
 * person who reviewed it decided, whether its transcripts have changed since, and its manual
 * sessions. Pure: it works from records already read, and reads no files.
 */
import type { ManualSessionFile } from "../manual/list.js";
import type { ReviewEntry, ReviewsFile } from "../model.js";
import { changedSinceReview } from "../reviews/changed.js";
import type { PageStanding, Standing } from "./standing.js";

export interface PageReview {
  /**
   * From the session that produced the shown transcripts: "all" or "part", with the session's
   * reviewer. Null when the session said "no", wasn't asked, or didn't answer, and when no
   * transcripts are shown.
   */
  listened: { answer: "all" | "part"; name: string | null } | null;
  /** The latest entry up to `asOf`. */
  latest: ReviewEntry | null;
  /** The latest review saw other transcripts than the ones shown. */
  changedSinceReview: boolean;
  /** Ever had an "issue" entry up to `asOf`, and the latest is "fixed". */
  fixed: boolean;
  /** The manual NVDA sessions on the page, in the order given. */
  manual: ManualSessionFile[];
}

/**
 * Each page in scope's review as of `asOf`: a review recorded after it isn't read. The map has a
 * review for every page in the standing's page list, and for no other.
 */
export function reviewOf(
  standing: Standing,
  reviews: ReviewsFile,
  manual: ManualSessionFile[],
  asOf: string,
): Map<string, PageReview> {
  const until = Date.parse(asOf);
  // A time that can't be read would leave out every review, so say so rather than show none.
  if (Number.isNaN(until)) throw new Error(`Not a time: ${JSON.stringify(asOf)}`);
  const manualByKey = new Map<string, ManualSessionFile[]>();
  for (const session of manual) {
    const key = session.json.page.key;
    manualByKey.set(key, [...(manualByKey.get(key) ?? []), session]);
  }

  const result = new Map<string, PageReview>();
  for (const page of standing.pages) {
    const entries = (reviews.pages[page.key] ?? []).filter(
      (entry) => Date.parse(entry.at) <= until,
    );
    const latest = entries.at(-1) ?? null;
    result.set(page.key, {
      listened: listenedOf(page),
      latest,
      changedSinceReview: changedSinceReview(latest ?? undefined, page.shown?.page) === true,
      fixed: latest?.status === "fixed" && entries.some((entry) => entry.status === "issue"),
      manual: manualByKey.get(page.key) ?? [],
    });
  }
  return result;
}

/** What the person said about the session that produced the page's shown transcripts. */
function listenedOf(page: PageStanding): PageReview["listened"] {
  const { shown } = page;
  if (shown === null) return null;
  const session = shown.run.sessions.find((candidate) => candidate.n === shown.page.session);
  const answer = session?.listener?.answer;
  if (answer !== "all" && answer !== "part") return null;
  return { answer, name: session?.reviewer?.name ?? null };
}
