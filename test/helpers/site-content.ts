/**
 * What the website's page is drawn from, in the tests: a demo, two sites with three reports, a Word
 * copy that isn't published (changed since it was shared, and missing), and a report with no
 * walkthrough file. The reports' times are mixed so that a site's newest report isn't the newest of
 * all: by date, the two sites' reports interleave.
 */
import { createHash } from "node:crypto";

import type { PublishedFile, PublishedReport, SiteContent } from "../../src/site/render.js";

const KILOBYTE = 1024;

export const DVFR = "dvfr.illinois.gov";
export const EXAMPLE = "example.illinois.gov";

/** The SHA-256 of a name, as hex: a fingerprint that differs from one file to the next. */
export function fingerprintOf(name: string): string {
  return createHash("sha256").update(name).digest("hex");
}

/** A published file, addressed from the site's top as the site writes it: its folder, then its name. */
export function published(
  kind: PublishedFile["kind"],
  folder: string,
  name: string,
  kilobytes: number,
  run: string | null = null,
): PublishedFile {
  return {
    kind,
    name,
    href: `${folder}/${name}`,
    bytes: kilobytes * KILOBYTE,
    sha256: fingerprintOf(name),
    run,
  };
}

/** The demo's report: its page, its Word copy, and the walkthrough file of one run. */
export const DEMO_REPORT: PublishedReport = {
  folder: "demo",
  id: "report-demo",
  at: "2026-09-29T15:40:00-05:00",
  by: "Sam Demo",
  files: [
    published("page", "demo", "127.0.0.1_4848_2026-09-29.html", 311),
    published("word", "demo", "127.0.0.1_4848_2026-09-29.docx", 47),
    published(
      "walkthrough",
      "demo",
      "127.0.0.1_4848_2026-09-29_2026-09-29_1315_walkthrough.json",
      4,
      "2026-09-29_1315",
    ),
  ],
  notPublished: [],
};

/** A site's second report, and the newest of all: everything is published. */
export const DVFR_NEWEST: PublishedReport = {
  folder: DVFR,
  id: `report-${DVFR}-2`,
  at: "2026-10-03T14:05:00-05:00",
  by: "Pat Lee",
  files: [
    published("page", DVFR, `${DVFR}_2026-10-03.html`, 324),
    published("word", DVFR, `${DVFR}_2026-10-03.docx`, 51),
    published(
      "walkthrough",
      DVFR,
      `${DVFR}_2026-10-03_2026-10-03_1330_walkthrough.json`,
      5,
      "2026-10-03_1330",
    ),
  ],
  notPublished: [],
};

/** The same site's first report: no walkthrough file, and a Word copy that changed since it was shared. */
export const DVFR_OLDEST: PublishedReport = {
  folder: DVFR,
  id: `report-${DVFR}-1`,
  at: "2026-09-29T16:20:00-05:00",
  by: "Pat Lee",
  files: [published("page", DVFR, `${DVFR}_2026-09-29.html`, 296)],
  notPublished: [{ name: `${DVFR}_2026-09-29.docx`, reason: "changed" }],
};

/**
 * The other site's only report, between the two: the walkthrough files of two runs (the second's run
 * isn't known), a file of another kind, and a Word copy that is missing.
 */
export const EXAMPLE_REPORT: PublishedReport = {
  folder: EXAMPLE,
  id: `report-${EXAMPLE}-1`,
  at: "2026-10-02T09:30:00-05:00",
  by: "Sam Rivera",
  files: [
    published("page", EXAMPLE, `${EXAMPLE}_2026-10-02.html`, 270),
    published(
      "walkthrough",
      EXAMPLE,
      `${EXAMPLE}_2026-10-02_2026-10-01_1100_walkthrough.json`,
      3,
      "2026-10-01_1100",
    ),
    published("walkthrough", EXAMPLE, `${EXAMPLE}_2026-10-02_older_walkthrough.json`, 2),
    published("other", EXAMPLE, `${EXAMPLE}_2026-10-02_summary.pdf`, 88),
  ],
  notPublished: [{ name: `${EXAMPLE}_2026-10-02.docx`, reason: "missing" }],
};

/** The demo, then the two sites by name, each site's reports the newest first. */
export const CONTENT: SiteContent = {
  demo: DEMO_REPORT,
  sites: [
    { name: DVFR, folders: [DVFR], reports: [DVFR_NEWEST, DVFR_OLDEST] },
    { name: EXAMPLE, folders: [EXAMPLE], reports: [EXAMPLE_REPORT] },
  ],
};

/** Every report of every site, in the content's order: the demo's isn't one. */
export function reportsOf(content: SiteContent): PublishedReport[] {
  return content.sites.flatMap(({ reports }) => reports);
}

/** Every published file of the content, the demo's included. */
export function filesOf(content: SiteContent): PublishedFile[] {
  return [...(content.demo === null ? [] : [content.demo]), ...reportsOf(content)].flatMap(
    ({ files }) => files,
  );
}
