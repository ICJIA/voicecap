/**
 * Builds fixture/reviews.json, a sample review history for the pages of fixture/replay-run (a real
 * NVDA run, captured with `pnpm fixture:capture`). It references the run's real transcript hashes,
 * except one entry made against an earlier, fictional run, so the report shows that page as changed
 * since review.
 *
 *   pnpm fixture:reviews
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PassName, ReviewEntry, ReviewsFile, RunJson } from "../src/model.js";
import { canonicalKey } from "../src/pages/url.js";
import { writeFileAtomic } from "../src/util/atomic-write.js";
import { sha256 } from "../src/util/hash.js";

const FIXTURE_DIR = fileURLToPath(new URL("../fixture/", import.meta.url));
export const REPLAY_RUN_DIR = path.join(FIXTURE_DIR, "replay-run");
export const REVIEWS_FILE = path.join(FIXTURE_DIR, "reviews.json");
export const SPEECH_VIEWER_FILE = path.join(FIXTURE_DIR, "manual", "speech-viewer.txt");

const PASSES: readonly PassName[] = ["read", "headings", "tab"];
const HOUR = 3_600_000;

interface SampleEntry {
  status: ReviewEntry["status"];
  reviewer: string;
  /** When, relative to the run's completion. */
  hoursAfterRun: number;
  note: string;
  /** Reviewed against an earlier run, whose read transcript differed. */
  earlierRun?: boolean;
}

/** The sample history, by page path. */
const SAMPLE: Record<string, SampleEntry[]> = {
  "/": [
    {
      status: "reviewed",
      reviewer: "Sample Reviewer",
      hoursAfterRun: 26,
      note: "Skip link comes first in the tab pass; headings start at level 1.",
    },
    {
      status: "issue",
      reviewer: "Second Reviewer",
      hoursAfterRun: 55,
      note: 'In the read pass the search field is announced as "Search this site, edit" with an empty item after it; confirm with a manual NVDA test.',
    },
    {
      status: "fixed",
      reviewer: "Sample Reviewer",
      hoursAfterRun: 98,
      note: 'Resolved: when the field gets focus it is announced as "Search this site, edit, blank" (tab pass step 7).',
    },
  ],
  "/flawed/": [
    {
      status: "issue",
      reviewer: "Sample Reviewer",
      hoursAfterRun: 27,
      note: 'Three "Read more" links, a "Click here" link, an image-only link, an unlabeled edit and button, no skip link, and the first heading is level 2.',
    },
  ],
  "/duplicates/": [
    {
      status: "reviewed",
      reviewer: "Second Reviewer",
      hoursAfterRun: -20,
      note: 'Reviewed before the footer\'s "Back to top" link was added, so the read transcript has changed since.',
      earlierRun: true,
    },
  ],
};

export function buildFixtureReviews(run: RunJson): ReviewsFile {
  const completed = run.completedAt ?? run.createdAt;
  const earlierRunId = `${shiftIso(run.createdAt, -24 * HOUR).slice(0, 10)}_1600_real-nvda`;
  const pages: Record<string, ReviewEntry[]> = {};
  for (const [pagePath, entries] of Object.entries(SAMPLE)) {
    const key = canonicalKey(new URL(pagePath, run.site).href);
    const page = run.pages.find(
      (candidate) => candidate.key === key && candidate.status === "done",
    );
    if (!page) throw new Error(`reviews: the run has no transcribed page ${key}`);
    pages[key] = entries.map((entry) => {
      const earlier = entry.earlierRun ? earlierRunId : null;
      const files = Object.fromEntries(
        Object.entries(page.files).map(([name, hash]) => [
          name,
          earlier ? sha256(`${earlier}/${page.slug}/${name}`) : hash.sha256,
        ]),
      );
      const content: ReviewEntry["content"] = {};
      for (const pass of PASSES) {
        const current = page.passes[pass]?.contentSha256;
        if (current === undefined) continue;
        // The earlier run's read transcript differed; its other passes matched.
        content[pass] = earlier && pass === "read" ? sha256(`${earlier} read body`) : current;
      }
      return {
        status: entry.status,
        reviewer: entry.reviewer,
        at: shiftIso(completed, entry.hoursAfterRun * HOUR),
        note: entry.note,
        run: earlier ?? run.id,
        url: page.url,
        files,
        content,
      };
    });
  }
  return { schemaVersion: 1, pages };
}

/**
 * An ISO timestamp moved by `ms`, keeping its UTC offset, so the sample doesn't depend on the time
 * zone of the computer that regenerates it. Rounded to the minute.
 */
function shiftIso(iso: string, ms: number): string {
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  const offsetMs = offset
    ? (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * HOUR + Number(offset[3]) * 60_000)
    : 0;
  const local = new Date(Date.parse(iso) + ms + offsetMs);
  const minute = new Date(Math.round(local.getTime() / 60_000) * 60_000);
  const text = minute.toISOString().slice(0, 19);
  return `${text}${offset ? offset[0] : "Z"}`;
}

export async function writeFixtureReviews(): Promise<ReviewsFile> {
  const run = JSON.parse(await readFile(path.join(REPLAY_RUN_DIR, "run.json"), "utf8")) as RunJson;
  const reviews = buildFixtureReviews(run);
  await writeFileAtomic(REVIEWS_FILE, `${JSON.stringify(reviews, null, 2)}\n`);
  return reviews;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const reviews = await writeFixtureReviews();
  console.log(
    `Wrote ${path.relative(process.cwd(), REVIEWS_FILE)} (${Object.keys(reviews.pages).length} pages).`,
  );
}
