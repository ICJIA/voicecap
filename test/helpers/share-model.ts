/**
 * What the shareable page's tests build models from: the input of runs built in memory
 * (`inputOf`), the demo runs of 29 September 2026 as a model (`demoModel`), and transcripts held in
 * memory (`storeOf`). The tests that render the page, and the one that builds its model, share
 * them, so each file says only what it adds.
 */
import os from "node:os";
import path from "node:path";

import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { PassName, ReviewsFile, RunJson } from "../../src/model.js";
import { loadShareInput, type ShareInput, type TranscriptStore } from "../../src/share/load.js";
import { buildShareModel, type ShareModel } from "../../src/share/model.js";
import { MAIN_COMMAND } from "../../src/transcripts/format.js";
import { SITE } from "./report-data.js";
import { DEMO_DAY } from "./share-fixture.js";

/** The demo site's folder in the transcripts home, which holds its runs of 29 September 2026. */
export const DEMO_SITE = path.dirname(DEMO_DAY);

export const NO_REVIEWS: ReviewsFile = { schemaVersion: 1, pages: {} };

/** No transcript can be read: what a model built from runs in memory has by default. */
export const NO_TRANSCRIPTS: TranscriptStore = { txt: () => null, steps: () => null };

/** The transcript files a page's record lists. */
export const TRANSCRIPTS = ["read.txt", "headings.txt", "tab.txt"];

/** What NVDA said, for every page of the runs built in memory. */
export const LINES: Record<PassName, string[]> = {
  read: [
    "banner landmark, link, Skip to main content",
    "heading, level 1, Grants",
    "To apply,, link, click here, dot",
    "content info landmark, © 2026 Example Agency",
  ],
  headings: ["heading, level 1, Grants", "no next heading"],
  tab: ["Skip to main content, link", "click here, link"],
};

export type Lines = Partial<Record<PassName, string[]>>;

/** A transcript as voicecap writes it: a header block, a blank line, then one line per step. */
export function txtOf(slug: string, pass: PassName, lines: string[]): string {
  return `${[`# voicecap transcript: ${pass} pass`, `# Page: ${slug}`, "", ...lines].join("\n")}\n`;
}

/**
 * The transcripts of every run in memory: each page's lines in each run as `linesOf` gives them,
 * and no transcript for a pass it leaves out, as a file that can't be read.
 */
export function storeOf(
  linesOf: (slug: string, run: string) => Lines = () => LINES,
): TranscriptStore {
  return {
    txt: (run, slug, pass) => {
      const lines = linesOf(slug, run)[pass];
      return lines === undefined ? null : txtOf(slug, pass, lines);
    },
    steps: (run, slug, pass) =>
      linesOf(slug, run)[pass]?.map((spoken, index) => ({
        n: index + 1,
        command: MAIN_COMMAND[pass],
        spoken,
        durationMs: 1200,
        offsetMs: (index + 1) * 1200,
      })) ?? null,
  };
}

/** What the model is built from, for runs built in memory, with no transcripts to read. */
export function inputOf(runs: RunJson[], overrides: Partial<ShareInput> = {}): ShareInput {
  return {
    site: SITE,
    runs,
    records: runs,
    reviews: NO_REVIEWS,
    manual: [],
    transcripts: NO_TRANSCRIPTS,
    siteName: null,
    flagRules: DEFAULT_CONFIG.flags,
    flagRulesSha256: "f".repeat(64),
    generatedAt: "2026-09-30T09:00:00-05:00",
    timeZone: "America/Chicago",
    home: os.homedir(),
    platform: process.platform,
    fileName: "current.html",
    ...overrides,
  };
}

let demo: Promise<ShareModel> | undefined;

/** The demo site's page, as made the next morning. */
export function demoModel(): Promise<ShareModel> {
  demo ??= loadShareInput({ siteDir: DEMO_SITE, config: DEFAULT_CONFIG }).then((input) =>
    buildShareModel({ ...input, generatedAt: "2026-09-30T09:00:00-05:00" }),
  );
  return demo;
}
