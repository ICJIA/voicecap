/**
 * Builds fixture/replay-run/ (a hand-written run folder), fixture/reviews.json, and
 * fixture/manual/speech-viewer.txt from the hand-written steps in fixture/replay-src/.
 *
 *   pnpm fixture:replay
 *
 * The transcripts are written with voicecap's own writers, so every file matches what a real run
 * writes. Output is deterministic: timestamps and step durations come from the source, never from
 * the clock. Each pass is checked against the core's stop rules (docs/plan.md section 5, default
 * config) so replaying the run stops exactly where the recording does.
 *
 * Phase B replaces replay-run/ with output captured from real NVDA.
 */
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { FocusedElement } from "../src/drivers/types.js";
import type {
  DriverCommand,
  EnvironmentRecord,
  PageRecord,
  PassName,
  PassSummary,
  ReviewEntry,
  ReviewsFile,
  RunJson,
  RunSettings,
  SkippedRecord,
  SourceDetails,
  StepRecord,
  StopReason,
  TranscriptJson,
} from "../src/model.js";
import { canonicalKey, nonHtmlExtension, sameOrigin } from "../src/pages/url.js";
import { pageSlug } from "../src/pages/slug.js";
import { writeTranscript } from "../src/transcripts/write.js";
import { writeFileAtomic } from "../src/util/atomic-write.js";
import { hashJson, sha256 } from "../src/util/hash.js";
import { voicecapVersion } from "../src/util/version.js";

const FIXTURE_DIR = fileURLToPath(new URL("../fixture/", import.meta.url));
export const REPLAY_SRC_DIR = path.join(FIXTURE_DIR, "replay-src");
export const REPLAY_RUN_DIR = path.join(FIXTURE_DIR, "replay-run");
export const REVIEWS_FILE = path.join(FIXTURE_DIR, "reviews.json");
export const SPEECH_VIEWER_FILE = path.join(FIXTURE_DIR, "manual", "speech-viewer.txt");
const SITE_DIR = path.join(FIXTURE_DIR, "site");

const PASSES: readonly PassName[] = ["read", "headings", "tab"];

/** Browser load, readiness wait, foreground check, and move into web content, per pass. */
const OPEN_PAGE_MS = 3200;
/** Loading a page that turns out to be skipped (redirect off-origin, non-HTML response). */
const SKIPPED_PAGE_MS = 2100;
const DRIVER_START_MS = 1500;
const DRIVER_STOP_MS = 800;
/** All timestamps in the fixture use Illinois daylight time. */
const UTC_OFFSET = "-05:00";

// ---------------------------------------------------------------------------------------------
// Source format (fixture/replay-src/*.json)
// ---------------------------------------------------------------------------------------------

/**
 * One step's speech as NVDA's speech items (one utterance). A read step is either a bare array
 * (a nextLine step) or { command, items } for setup steps (toBottom, toTop).
 */
type ReadStepSource = string[] | { command: DriverCommand; items: string[] };
interface TabStepSource {
  items: string[];
  focused?: FocusedElement | null;
  /** false for the step where focus left the page for browser UI. */
  inDocument?: boolean;
}
export interface PageSource {
  url: string;
  read: ReadStepSource[];
  headings: string[][];
  tab: TabStepSource[];
}
interface ReviewSource {
  status: ReviewEntry["status"];
  reviewer: string;
  at: string;
  note: string;
  /** Review of a fictional earlier run whose read transcript differed ("changed since review"). */
  earlierRun?: string;
}
interface RunSource {
  id: string;
  name: string;
  site: string;
  sitemap: string;
  startedAt: string;
  pages: string[];
  skippedOnLoad: SkippedRecord[];
  environment: Omit<EnvironmentRecord, "pageSource" | "voicecap" | "runId" | "runStartedAt">;
  reviews: Record<string, ReviewSource[]>;
}

/** A recorded step as the core sees it. */
export interface SourceStep {
  command: DriverCommand;
  /** Speech items as NVDA produced them, before Guidepup's formatting. */
  items: string[];
  focused?: FocusedElement | null;
  inDocument?: boolean;
}

export async function loadRunSource(): Promise<RunSource> {
  return JSON.parse(await readFile(path.join(REPLAY_SRC_DIR, "run.json"), "utf8")) as RunSource;
}

export async function loadPageSource(file: string): Promise<PageSource> {
  return JSON.parse(await readFile(path.join(REPLAY_SRC_DIR, file), "utf8")) as PageSource;
}

/** A page's recorded steps for one pass, with each step's command. */
export function passSteps(page: PageSource, pass: PassName): SourceStep[] {
  switch (pass) {
    case "read":
      return page.read.map((step) =>
        Array.isArray(step) ? { command: "nextLine", items: step } : step,
      );
    case "headings":
      return page.headings.map((items) => ({ command: "nextHeading", items }));
    case "tab":
      return page.tab.map((step) => ({
        command: "nextFocusable",
        items: step.items,
        inDocument: step.inDocument ?? true,
        focused: step.inDocument === false ? null : (step.focused ?? null),
      }));
  }
}

/**
 * Guidepup's speech format (verified in @guidepup/guidepup 0.34.0, NVDAClient.js): each item
 * trimmed with whitespace runs collapsed, items joined with ", ". (Utterances would be joined
 * with ". "; every fixture step is a single utterance.)
 */
export function guidepupSpeech(items: readonly string[]): string {
  return items.map((item) => item.trim().replaceAll(/\s\s+/g, " ")).join(", ");
}

/** NVDA's Speech Viewer format (speechViewer.py): items as-is, joined with two spaces. */
export function speechViewerLine(items: readonly string[]): string {
  return items.join("  ");
}

// ---------------------------------------------------------------------------------------------
// The core's stop rules (docs/plan.md section 5), used to validate the recordings
// ---------------------------------------------------------------------------------------------

export interface StopRules {
  endConfirmations: number;
  repeatLimit: number;
  stepCaps: Record<PassName, number>;
  noNextHeading: RegExp;
}

/** voicecap's default config. */
export const DEFAULT_STOP_RULES: StopRules = {
  endConfirmations: 1,
  repeatLimit: 10,
  stepCaps: { read: 400, headings: 200, tab: 300 },
  noNextHeading: /^no next heading$/i,
};

const normalize = (text: string): string => text.trim().replace(/\s+/g, " ");

/** The end-of-page match: the repeated line equals the Ctrl+End line, or ends it at an item boundary. */
function lineMatches(last: string, line: string): boolean {
  return last === line || last.endsWith(`, ${line}`) || last.endsWith(`. ${line}`);
}

/**
 * Where the core stops a pass over these steps, or null if the recording ends before the core
 * would stop. `steps` counts every step, setup steps included.
 */
export function detectStop(
  pass: PassName,
  steps: readonly { command: DriverCommand; spoken: string; inDocument?: boolean }[],
  rules: StopRules = DEFAULT_STOP_RULES,
): { steps: number; stopReason: StopReason } | null {
  const cap = rules.stepCaps[pass];
  if (pass === "read") {
    if (steps[0]?.command !== "toBottom" || steps[1]?.command !== "toTop") {
      throw new Error("A read pass starts with toBottom, then toTop.");
    }
    const last = normalize(steps[0].spoken);
    let prev = normalize(steps[1].spoken);
    let run = 1;
    let i = 2;
    for (;;) {
      if (i >= cap) return { steps: i, stopReason: "step-cap" };
      const step = steps[i];
      if (step === undefined) return null;
      const line = normalize(step.spoken);
      i++;
      run = line === prev ? run + 1 : 1;
      if (line === prev && lineMatches(last, line)) {
        let differing: string | null = null;
        for (let c = 0; c < rules.endConfirmations; c++) {
          if (i >= cap) return { steps: i, stopReason: "step-cap" };
          const confirm = steps[i];
          if (confirm === undefined) return null;
          i++;
          const text = normalize(confirm.spoken);
          if (text !== line) {
            differing = text;
            break;
          }
          run++;
        }
        if (differing === null) return { steps: i, stopReason: "end-reached" };
        prev = differing;
        run = 1;
        continue;
      }
      if (run >= rules.repeatLimit) return { steps: i, stopReason: "repeat-limit" };
      prev = line;
    }
  }

  let prev: string | null = null;
  let run = 0;
  for (let i = 0; ; i++) {
    if (i >= cap) return { steps: i, stopReason: "step-cap" };
    const step = steps[i];
    if (step === undefined) return null;
    const text = normalize(step.spoken);
    if (pass === "headings" && rules.noNextHeading.test(text)) {
      return { steps: i + 1, stopReason: "no-next-heading" };
    }
    if (pass === "tab" && step.inDocument === false) {
      return { steps: i + 1, stopReason: "left-document" };
    }
    run = text === prev ? run + 1 : 1;
    prev = text;
    if (run >= rules.repeatLimit) return { steps: i + 1, stopReason: "repeat-limit" };
  }
}

const EXPECTED_STOP: Record<PassName, StopReason> = {
  read: "end-reached",
  headings: "no-next-heading",
  tab: "left-document",
};

// ---------------------------------------------------------------------------------------------
// Deterministic time
// ---------------------------------------------------------------------------------------------

/** A timestamp `ms` after `iso`, formatted in the fixture's fixed UTC offset. */
function isoAfter(iso: string, ms: number): string {
  const offsetMinutes = -5 * 60;
  const wall = new Date(Date.parse(iso) + ms + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}` +
    `T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}${UTC_OFFSET}`
  );
}

/** Complete capture waits for 1 s of silence after each keystroke: about 1.25–1.6 s per step. */
function stepDurationMs(n: number, spoken: string): number {
  return 1250 + ((n * 97 + spoken.length * 13) % 350);
}

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

interface SitemapDocument {
  url: string;
  locs: string[];
  sha256: string;
  /** Child sitemaps, for an index. */
  children: string[];
}

async function readSitemap(url: string): Promise<SitemapDocument> {
  const bytes = await readFile(path.join(SITE_DIR, ...new URL(url).pathname.split("/")));
  const xml = bytes.toString("utf8");
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((match) => match[1]!);
  const isIndex = /<sitemapindex[\s>]/.test(xml);
  return {
    url,
    locs: isIndex ? [] : locs,
    children: isIndex ? locs : [],
    sha256: sha256(bytes),
  };
}

export interface BuildResult {
  run: RunJson;
  reviews: ReviewsFile;
}

/** Regenerate fixture/replay-run/, fixture/reviews.json and fixture/manual/speech-viewer.txt. */
export async function buildReplayFixture(): Promise<BuildResult> {
  const source = await loadRunSource();
  const site = new URL(`${source.site}/`);
  const version = voicecapVersion();

  const index = await readSitemap(source.sitemap);
  const documents = [index, ...(await Promise.all(index.children.map(readSitemap)))];
  const listed = documents.flatMap((doc) => doc.locs);

  const settings: RunSettings = {
    site: source.site,
    source: { kind: "sitemap", url: source.sitemap },
    passes: [...PASSES],
    include: [],
    exclude: [],
    limit: null,
    driver: source.environment.driver.name,
    replayFrom: null,
    capture: source.environment.capture,
    stepCaps: { ...DEFAULT_STOP_RULES.stepCaps },
    nvdaSettings: {},
    browser: { channel: "chrome", fallbackToChromium: true },
  };
  const environment: EnvironmentRecord = {
    ...source.environment,
    pageSource: { kind: "sitemap", url: source.sitemap },
    voicecap: { version, configSha256: "hand-written" },
    runId: source.id,
    runStartedAt: source.startedAt,
  };

  // Skipped before the run, by the same rules a run applies.
  const skipped: SkippedRecord[] = [];
  const toProcess: string[] = [];
  for (const url of listed) {
    const parsed = new URL(url);
    if (!sameOrigin(parsed, site)) skipped.push({ url, reason: "off-origin" });
    else if (nonHtmlExtension(parsed) !== null) skipped.push({ url, reason: "non-html-extension" });
    else toProcess.push(url);
  }

  const pageSources = new Map<string, PageSource>();
  for (const file of source.pages) {
    const page = await loadPageSource(file);
    pageSources.set(canonicalKey(page.url), page);
  }
  const skippedOnLoad = new Map(source.skippedOnLoad.map((skip) => [canonicalKey(skip.url), skip]));

  await rm(REPLAY_RUN_DIR, { recursive: true, force: true });
  let clock = DRIVER_START_MS;
  const pages: PageRecord[] = [];

  for (const url of toProcess) {
    const key = canonicalKey(url);
    const slug = pageSlug(key);
    const pageStart = clock;
    const skip = skippedOnLoad.get(key);
    if (skip) {
      clock += SKIPPED_PAGE_MS;
      skipped.push(skip);
      pages.push({
        url,
        key,
        slug,
        status: "skipped",
        attempts: 1,
        finalUrl: skip.finalUrl ?? url,
        httpStatus: skip.status ?? null,
        skip,
        session: 1,
        startedAt: isoAfter(source.startedAt, pageStart),
        durationMs: SKIPPED_PAGE_MS,
        passes: {},
        files: {},
        flags: [],
        errors: [],
      });
      continue;
    }
    const page = pageSources.get(key);
    if (!page) throw new Error(`No replay source for ${url} (add it to replay-src/run.json).`);

    const record: PageRecord = {
      url,
      key,
      slug,
      status: "done",
      attempts: 1,
      finalUrl: url,
      httpStatus: 200,
      session: 1,
      startedAt: isoAfter(source.startedAt, pageStart),
      passes: {},
      files: {},
      flags: [],
      errors: [],
    };
    for (const pass of PASSES) {
      clock += OPEN_PAGE_MS;
      const passStart = clock;
      const steps: StepRecord[] = [];
      let offset = 0;
      passSteps(page, pass).forEach((sourceStep, index) => {
        const spoken = guidepupSpeech(sourceStep.items);
        const durationMs = stepDurationMs(index + 1, spoken);
        offset += durationMs;
        const step: StepRecord = {
          n: index + 1,
          command: sourceStep.command,
          spoken,
          durationMs,
          offsetMs: offset,
        };
        if (pass === "tab") {
          step.inDocument = sourceStep.inDocument ?? true;
          step.focused = sourceStep.focused ?? null;
        }
        steps.push(step);
      });
      clock += offset;

      const detected = detectStop(pass, steps);
      if (detected?.steps !== steps.length || detected.stopReason !== EXPECTED_STOP[pass]) {
        throw new Error(
          `${url} ${pass}: the core would stop with ${JSON.stringify(detected)}, but the recording has ${steps.length} steps ending in ${EXPECTED_STOP[pass]}.`,
        );
      }

      const transcript: TranscriptJson = {
        schemaVersion: 1,
        voicecap: version,
        replayed: false,
        run: source.id,
        pass,
        page: { url, key, slug, finalUrl: url },
        capturedAt: isoAfter(source.startedAt, passStart),
        durationMs: offset,
        stepCount: steps.length,
        stopReason: detected.stopReason,
        warnings: [],
        errors: [],
        ...(pass === "tab" ? { initialFocus: null } : {}),
        environment,
        steps,
      };
      const written = await writeTranscript(path.join(REPLAY_RUN_DIR, "pages", slug), transcript);
      Object.assign(record.files, written.files);
      const summary: PassSummary = {
        steps: steps.length,
        stopReason: detected.stopReason,
        durationMs: offset,
        contentSha256: written.contentSha256,
        errors: [],
        warnings: [],
      };
      record.passes[pass] = summary;
    }
    record.durationMs = clock - pageStart;
    pages.push(record);
  }
  const endedAt = isoAfter(source.startedAt, clock + DRIVER_STOP_MS);

  const sourceDetails: SourceDetails = {
    kind: "sitemap",
    sitemaps: documents.map((doc) => ({ url: doc.url, urls: doc.locs.length, sha256: doc.sha256 })),
    listed: listed.length,
    duplicates: 0,
    invalid: [],
    excludedByFilter: 0,
    excludedByLimit: 0,
    warnings: [],
  };
  const run: RunJson = {
    schemaVersion: 1,
    id: source.id,
    name: source.name,
    status: "completed",
    createdAt: source.startedAt,
    completedAt: endedAt,
    site: source.site,
    settings,
    settingsHash: hashJson(settings),
    configSha256: "hand-written",
    // Empty: flags weren't computed by voicecap, so reports recompute them with the current rules.
    flagRulesSha256: "",
    replayed: false,
    source: sourceDetails,
    compareTo: null,
    sessions: [
      {
        n: 1,
        startedAt: source.startedAt,
        endedAt,
        endReason: "completed",
        pagesDone: pages.filter((page) => page.status === "done").length,
        environment,
      },
    ],
    skipped,
    pages,
  };
  await writeFileAtomic(path.join(REPLAY_RUN_DIR, "run.json"), `${JSON.stringify(run, null, 2)}\n`);

  const reviews = buildReviews(source, run);
  await writeFileAtomic(REVIEWS_FILE, `${JSON.stringify(reviews, null, 2)}\n`);

  const home = pageSources.get(canonicalKey(`${source.site}/`));
  if (!home) throw new Error("The home page source is missing.");
  await writeFileAtomic(SPEECH_VIEWER_FILE, speechViewerCapture(home));

  return { run, reviews };
}

function buildReviews(source: RunSource, run: RunJson): ReviewsFile {
  const pages: Record<string, ReviewEntry[]> = {};
  for (const [key, entries] of Object.entries(source.reviews)) {
    const page = run.pages.find(
      (candidate) => candidate.key === key && candidate.status === "done",
    );
    if (!page) throw new Error(`reviews: no transcribed page with key ${key}`);
    pages[key] = entries.map((entry) => {
      const files = Object.fromEntries(
        Object.entries(page.files).map(([name, hash]) => [
          name,
          entry.earlierRun ? sha256(`${entry.earlierRun}/${page.slug}/${name}`) : hash.sha256,
        ]),
      );
      const content: ReviewEntry["content"] = {};
      for (const pass of PASSES) {
        const current = page.passes[pass]?.contentSha256;
        if (current === undefined) continue;
        // The earlier run's read transcript differed; its other passes matched.
        content[pass] =
          entry.earlierRun && pass === "read" ? sha256(`${entry.earlierRun} read body`) : current;
      }
      return {
        status: entry.status,
        reviewer: entry.reviewer,
        at: entry.at,
        note: entry.note,
        run: entry.earlierRun ?? run.id,
        url: page.url,
        files,
        content,
      };
    });
  }
  return { schemaVersion: 1, pages };
}

/**
 * The home page read top to bottom with Down Arrow, as NVDA's Speech Viewer shows it: from
 * Ctrl+Home through the first Down Arrow at the last line (which re-speaks it). CRLF line
 * endings, as when the Speech Viewer text is pasted into Notepad and saved.
 */
export function speechViewerCapture(home: PageSource): string {
  return speechViewerSteps(home)
    .map((step) => `${speechViewerLine(step.items)}\r\n`)
    .join("");
}

/** The read steps a Speech Viewer capture of the page covers (see speechViewerCapture). */
export function speechViewerSteps(page: PageSource): SourceStep[] {
  const steps = passSteps(page, "read");
  // Skip Ctrl+End (a person reading from the top doesn't press it) and the core's extra repeats.
  return steps.slice(1, steps.length - 2);
}

async function main(): Promise<void> {
  const { run, reviews } = await buildReplayFixture();
  const done = run.pages.filter((page) => page.status === "done").length;
  console.log(
    `Wrote ${path.relative(process.cwd(), REPLAY_RUN_DIR)} (${done} pages, ${run.skipped.length} skipped), ` +
      `${path.relative(process.cwd(), REVIEWS_FILE)} (${Object.keys(reviews.pages).length} pages), ` +
      `and ${path.relative(process.cwd(), SPEECH_VIEWER_FILE)}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
