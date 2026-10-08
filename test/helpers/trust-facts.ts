/**
 * What the trust page is drawn from, in the tests (test/site-trust.test.ts, and the page in a
 * browser in test/site-page-browser.test.ts): voicecap's facts as a release has them, and the
 * records' facts, counted from the tests' content (./site-content.ts) with what each site's current
 * report found.
 */
import type { ShareResult } from "../../src/model.js";
import {
  recordFactsOf,
  type RecordFacts,
  type VoicecapFacts,
  type VoicecapRelease,
} from "../../src/site/facts.js";
import type { PublishedReport, SiteContent } from "../../src/site/render.js";
import {
  DEMO_REPORT,
  DVFR,
  DVFR_ADDRESS,
  DVFR_NEWEST,
  DVFR_OLDEST,
  EXAMPLE,
  EXAMPLE_REPORT,
} from "./site-content.js";

/**
 * voicecap 0.13.2, released on 9 October 2026, with three releases in its CHANGELOG, and what its
 * release recorded: 5,012 tests passed on Windows (2 skipped, in 125 files), 412 commits since 26
 * September 2026, and CI's matrix of three systems and two Node versions.
 */
export const FACTS: VoicecapFacts = {
  version: "0.13.2",
  released: "2026-10-09",
  releases: [
    {
      version: "0.13.2",
      date: "2026-10-09",
      headline: "A page that shows how voicecap can be checked",
    },
    {
      version: "0.13.1",
      date: "2026-10-08",
      headline:
        "The website's headings say more at a glance, and each site links to the site itself",
    },
    {
      version: "0.13.0",
      date: "2026-10-08",
      headline: "The shareable page has a new order, and its Word copy follows it",
    },
  ],
  release: {
    tests: { passed: 5012, skipped: 2, files: 125, system: "Windows" },
    commits: { count: 412, first: "2026-09-26" },
    ci: { systems: ["Ubuntu", "macOS", "Windows"], node: ["22", "24"] },
  },
};

/** Four releases older than FACTS's, the newest first: with them, there are seven. */
export const EARLIER_RELEASES: VoicecapRelease[] = [
  {
    version: "0.12.3",
    date: "2026-10-07",
    headline: "The website's card says what a report found",
  },
  {
    version: "0.12.2",
    date: "2026-10-07",
    headline: "The website shows each site's newest three reports, and leads with the current one",
  },
  {
    version: "0.12.1",
    date: "2026-10-07",
    headline: "The summary's four panels are full-width rows",
  },
  {
    version: "0.12.0",
    date: "2026-10-07",
    headline: "What needs attention is a section of its own",
  },
];

/** `report`, with what its share said of the site. */
function saying(report: PublishedReport, result: ShareResult): PublishedReport {
  return { ...report, result };
}

/**
 * The tests' content, with each site's current report saying what it found: 9 pages of 9 read, with
 * no problem, and 32 of 32, with 1 problem. The first site's older report says nothing, as a share
 * from before 0.12.3 does.
 */
export const RESULTS_CONTENT: SiteContent = {
  demo: DEMO_REPORT,
  sites: [
    {
      name: DVFR,
      folders: [DVFR],
      reports: [
        saying(DVFR_NEWEST, { pages: 9, read: 9, problems: 0, problemPages: 0 }),
        DVFR_OLDEST,
      ],
      address: DVFR_ADDRESS,
    },
    {
      name: EXAMPLE,
      folders: [EXAMPLE],
      reports: [saying(EXAMPLE_REPORT, { pages: 32, read: 32, problems: 1, problemPages: 32 })],
    },
  ],
};

/**
 * The records' facts of RESULTS_CONTENT: 2 sites, 3 reports, 41 pages read of 41 with 1 problem, 11
 * files published (the demo's 3, the first site's 3 and 1, and the second's 4) and 2 left out (a
 * Word copy that changed, and one that is missing), and the newest shared on 3 October 2026, 14:05.
 */
export const RECORDS: RecordFacts = recordFactsOf(RESULTS_CONTENT);
