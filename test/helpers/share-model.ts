/**
 * What the shareable page's tests build models from: the input of runs built in memory
 * (`inputOf`), the demo runs of 29 September 2026 as a model (`demoModel`), transcripts held in
 * memory (`storeOf`), screenshots held in memory (`picturesOf`), and a run with its event log held
 * in memory (`loggedRun`). The tests that render the page, and the one that builds its model, share
 * them, so each file says only what it adds.
 */
import os from "node:os";
import path from "node:path";

import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type {
  FileHash,
  NewRunEvent,
  PassName,
  ReviewsFile,
  RunEvent,
  RunJson,
} from "../../src/model.js";
import { loadShareInput, type ShareInput, type TranscriptStore } from "../../src/share/load.js";
import {
  buildShareModel,
  type RunEvidence,
  type ShareModel,
  type WalkthroughDownload,
} from "../../src/share/model.js";
import { MAIN_COMMAND } from "../../src/transcripts/format.js";
import { sealOf } from "../../src/util/hash.js";
import { TINY_JPEG } from "./jpeg.js";
import { SITE } from "./report-data.js";
import { failedAttempt, settingsNested, shareRun } from "./share-data.js";
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
    readOrigin: SITE,
    canonical: null,
    runs,
    records: runs,
    reviews: NO_REVIEWS,
    manual: [],
    transcripts: NO_TRANSCRIPTS,
    events: new Map(),
    screenshots: new Map(),
    flagsAsRecorded: [],
    unreadableRuns: [],
    siteName: null,
    flagRules: DEFAULT_CONFIG.flags,
    flagRulesSha256: "f".repeat(64),
    generatedAt: "2026-09-30T09:00:00-05:00",
    home: os.homedir(),
    platform: process.platform,
    fileName: "current.html",
    wordName: "current.docx",
    ...overrides,
  };
}

/**
 * The screenshot files of some runs as the loader holds them: TINY_JPEG for each page whose record
 * has the fingerprint of a picture, by run id and slug (`ShareInput.screenshots`).
 */
export function picturesOf(runs: RunJson[]): Map<string, Uint8Array> {
  return new Map(
    runs.flatMap((run) =>
      run.pages.flatMap((page): [string, Uint8Array][] =>
        page.screenshot !== undefined && "sha256" in page.screenshot
          ? [[`${run.id}/${page.slug}`, TINY_JPEG]]
          : [],
      ),
    ),
  );
}

/**
 * The run with `files` as the files of its own that its record lists beside its pages
 * (RunJson.files, which holds its event log from voicecap 0.11.0), sealed again when it was sealed.
 */
export function withOwnFiles(run: RunJson, files: Record<string, unknown>): RunJson {
  const { seal: _seal, ...unsealed } = run;
  const listed = { ...unsealed, files: files as Record<string, FileHash> };
  return run.seal === undefined ? listed : { ...listed, seal: sealOf(listed) };
}

/** The fingerprint of an event log as a run's record lists it, for a run built in memory. */
export const LOG_HASH: FileHash = { sha256: "e".repeat(64), bytes: 10_240 };

/** The run with its read pass's step limit set to `limit`. */
export function withStepLimit(run: RunJson, limit: number): RunJson {
  const { settings } = run;
  return { ...run, settings: { ...settings, stepCaps: { ...settings.stepCaps, read: limit } } };
}

/** The run with the NVDA settings it recorded nested `levels` deep (see settingsNested). */
export function withNestedSettings(run: RunJson, levels: number): RunJson {
  const { settings } = run;
  return { ...run, settings: { ...settings, nvdaSettings: settingsNested(levels) } };
}

/**
 * Why no walkthrough file can be made of a run whose step limit is 100,001: a file holds a step
 * limit of 100,000 at most. A sentence that ends with its period already.
 */
export const STEP_LIMIT_PROBLEM =
  "its settings.stepCaps.read: must be a whole number from 1 to 100,000.";

/**
 * The walkthrough file a run's evidence offers, which a test says the run has: the evidence's own,
 * or an error that says why the run has none.
 */
export function downloadOf(each: RunEvidence): WalkthroughDownload {
  if ("problem" in each.walkthrough) {
    throw new Error(`Run ${each.run.id} has no walkthrough file: ${each.walkthrough.problem}`);
  }
  return each.walkthrough;
}

/** The bytes of a walkthrough file a download carries: its base64, decoded. */
export function fileBytes(download: Pick<WalkthroughDownload, "base64">): Buffer {
  return Buffer.from(download.base64, "base64");
}

/** The demo's canonical address: where `voicecap site` publishes the demo's own pages. */
export const DEMO_ROOT = "https://voicecap.netlify.app/demo-site/";

const demos = new Map<string | null, Promise<ShareModel>>();

/**
 * The demo site's page, as made the next morning. `canonical` is the root `report.canonical` names
 * the site by, when a test sets one: by default there is none, and the site is named by the
 * address its runs read, `http://127.0.0.1:4848`.
 */
export function demoModel(canonical: string | null = null): Promise<ShareModel> {
  let model = demos.get(canonical);
  if (model === undefined) {
    const config = { ...DEFAULT_CONFIG, report: { ...DEFAULT_CONFIG.report, canonical } };
    model = loadShareInput({ siteDir: DEMO_SITE, config }).then((input) =>
      buildShareModel({ ...input, generatedAt: "2026-09-30T09:00:00-05:00" }),
    );
    demos.set(canonical, model);
  }
  return model;
}

/** An event of a log: when it was recorded, on a day as `day` gives it, and what happened. */
export function logged(day: string, time: string, event: NewRunEvent): RunEvent {
  return { at: `${day}T${time}-05:00`, ...event };
}

/** The days of the logged run's two sessions. */
const FIRST_DAY = "2026-09-26";
const SECOND_DAY = "2026-09-28";

/** What the driver's error said when another window took the screen. */
const LOST_FOREGROUND =
  "The browser lost the foreground to another window, so this step's keystroke and speech were discarded. Keep the computer free while voicecap runs.";

/** The title of the window that took the screen, which the log keeps and no report shows. */
export const PRIVATE_TITLE = "Re: salary review - Inbox";

/**
 * A run of voicecap 0.11.0, its record and its event log, in two sessions two days apart: on 26
 * September, Home is read, then another window (Microsoft Teams, whose title is PRIVATE_TITLE) takes
 * the screen from Apply, and voicecap starts NVDA and the browser again and reads it on its second
 * attempt; the person stops the run there. On 28 September the run is resumed, and Contact is read.
 * The log is what the NVDA driver and the run record: the lock, the computer's own NVDA, voicecap's
 * NVDA, each browser, and each page.
 */
export function loggedRun(): { run: RunJson; log: { events: RunEvent[]; unreadable: number } } {
  const first = (time: string, event: NewRunEvent) => logged(FIRST_DAY, time, event);
  const second = (time: string, event: NewRunEvent) => logged(SECOND_DAY, time, event);
  const home = `${SITE}`;
  const apply = `${SITE}apply/`;
  const contact = `${SITE}contact/`;
  const run = shareRun({
    id: "2026-09-26_1402",
    createdAt: `${FIRST_DAY}T14:02:51-05:00`,
    voicecapVersion: "0.11.0",
    sessions: [
      {
        reviewer: "Pat Lee",
        startedAt: `${FIRST_DAY}T14:02:51-05:00`,
        endedAt: `${FIRST_DAY}T14:06:30-05:00`,
        endReason: "interrupted",
      },
      {
        reviewer: "Pat Lee",
        startedAt: `${SECOND_DAY}T09:00:00-05:00`,
        endedAt: `${SECOND_DAY}T09:02:10-05:00`,
        endReason: "completed",
      },
    ],
    pages: [
      { path: "/", label: "Home", files: TRANSCRIPTS, passes: LINES, session: 1 },
      {
        path: "/apply/",
        label: "Apply",
        files: TRANSCRIPTS,
        passes: LINES,
        session: 1,
        attempts: 2,
        failedAttempts: [
          failedAttempt({
            n: 1,
            startedAt: `${FIRST_DAY}T14:03:56.000-05:00`,
            endedAt: `${FIRST_DAY}T14:04:41.300-05:00`,
            message: LOST_FOREGROUND,
            program: "Microsoft Teams",
            restarted: true,
          }),
        ],
      },
      { path: "/contact/", label: "Contact", files: TRANSCRIPTS, passes: LINES, session: 2 },
    ],
  });
  const events: RunEvent[] = [
    first("14:02:51.307", { type: "run-started", session: 1, resumed: false }),
    first("14:02:51.320", { type: "screen-reader-lock-taken" }),
    first("14:02:56.418", { type: "own-screen-reader-closed", pids: [55892] }),
    first("14:02:56.681", { type: "screen-reader-started", pid: 65720 }),
    first("14:02:58.102", { type: "browser-launched", pid: 7001 }),
    first("14:03:00.000", { type: "page-started", page: home, attempt: 1 }),
    first("14:03:55.000", { type: "page-finished", page: home, attempt: 1, status: "done" }),
    first("14:03:55.400", { type: "browser-launched", pid: 7002 }),
    first("14:03:55.900", { type: "browser-closed", pid: 7001 }),
    first("14:03:56.000", { type: "page-started", page: apply, attempt: 1 }),
    first("14:04:41.250", {
      type: "foreground-lost",
      program: "Microsoft Teams",
      title: PRIVATE_TITLE,
    }),
    first("14:04:41.300", {
      type: "page-failed",
      page: apply,
      attempt: 1,
      cause: "foreground",
      message: LOST_FOREGROUND,
    }),
    first("14:04:41.350", {
      type: "screen-reader-restarting",
      reason: { kind: "retry", page: apply, attempt: 2, of: 5 },
    }),
    first("14:04:43.900", { type: "screen-reader-stopped", pid: 65720, restarting: true }),
    first("14:04:44.100", { type: "browser-closed", pid: 7002 }),
    first("14:04:44.150", { type: "screen-reader-lock-released" }),
    first("14:04:44.160", { type: "screen-reader-lock-taken" }),
    first("14:04:45.729", { type: "screen-reader-started", pid: 54568 }),
    first("14:04:47.000", { type: "browser-launched", pid: 7003 }),
    first("14:04:48.000", { type: "page-started", page: apply, attempt: 2 }),
    first("14:05:40.000", { type: "page-finished", page: apply, attempt: 2, status: "done" }),
    first("14:06:28.174", { type: "screen-reader-stopped", pid: 54568, restarting: false }),
    first("14:06:28.300", { type: "browser-closed", pid: 7003 }),
    first("14:06:29.965", { type: "own-screen-reader-restarted", ok: true }),
    first("14:06:29.966", { type: "screen-reader-lock-released" }),
    first("14:06:30.000", { type: "run-ended", session: 1, reason: "interrupted" }),
    second("09:00:00.120", { type: "run-started", session: 2, resumed: true }),
    second("09:00:00.130", { type: "screen-reader-lock-taken" }),
    second("09:00:05.002", { type: "own-screen-reader-closed", pids: [61234] }),
    second("09:00:05.310", { type: "screen-reader-started", pid: 40400 }),
    second("09:00:06.800", { type: "browser-launched", pid: 7101 }),
    second("09:00:08.000", { type: "page-started", page: contact, attempt: 1 }),
    second("09:01:02.000", { type: "page-finished", page: contact, attempt: 1, status: "done" }),
    second("09:02:05.500", { type: "screen-reader-stopped", pid: 40400, restarting: false }),
    second("09:02:05.700", { type: "browser-closed", pid: 7101 }),
    second("09:02:09.900", { type: "own-screen-reader-restarted", ok: true }),
    second("09:02:09.910", { type: "screen-reader-lock-released" }),
    second("09:02:10.000", { type: "run-ended", session: 2, reason: "completed" }),
  ];
  return { run, log: { events, unreadable: 0 } };
}

/** The logged run's model, with every transcript it lists readable and its event log read. */
export function loggedModel(overrides: Partial<ShareInput> = {}): ShareModel {
  const { run, log } = loggedRun();
  return buildShareModel(
    inputOf([run], { transcripts: storeOf(), events: new Map([[run.id, log]]), ...overrides }),
  );
}
