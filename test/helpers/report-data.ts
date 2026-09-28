/**
 * Builders for synthetic transcripts folders: runs written with the real transcript writer,
 * reviews appended with the real review store, and manual sessions in the manual JSON format.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  EnvironmentRecord,
  FlagResult,
  ManualSessionJson,
  PageRecord,
  PageSource,
  PageStatus,
  PassName,
  ReviewEntry,
  ReviewStatus,
  RunJson,
  SkippedRecord,
  StopReason,
  TranscriptJson,
} from "../../src/model.js";
import { pageSlug } from "../../src/pages/slug.js";
import { canonicalKey } from "../../src/pages/url.js";
import { appendReview } from "../../src/reviews/store.js";
import { manualSessionDir, pageDir } from "../../src/run/paths.js";
import { writeRunJson } from "../../src/run/store.js";
import { MAIN_COMMAND } from "../../src/transcripts/format.js";
import { writeTranscript } from "../../src/transcripts/write.js";

export const SITE = "https://example.illinois.gov/";

/** A 1x1 PNG, for branding tests. */
export const LOGO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export async function tempOutDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "voicecap-report-"));
}

export function environment(overrides: Partial<EnvironmentRecord> = {}): EnvironmentRecord {
  return {
    driver: { name: "guidepup", version: "0.34.0" },
    screenReader: { name: "NVDA", version: "2026.2", build: "0.2.1-2026.2", language: "en" },
    capture: "complete",
    browser: { name: "Chrome", version: "141.0.7390.55" },
    os: "Windows 11 Pro 24H2 (10.0.26100)",
    screenReaderSettings: {
      speech: { symbolLevel: 100, rate: 50 },
      documentFormatting: { reportLinks: true, reportHeadings: true },
      virtualBuffers: { autoSayAllOnPageLoad: false },
      keyboard: { speakTypedCharacters: true },
    },
    pageSource: { kind: "pages", file: "pages.csv", sha256: "a".repeat(64) },
    voicecap: { version: "0.1.0", configSha256: "c".repeat(64) },
    runId: "run",
    runStartedAt: "2026-09-26T14:05:00-05:00",
    ...overrides,
  };
}

export interface SyntheticPage {
  /** Path on the site, e.g. "/grants/fy27-jag". */
  path: string;
  label?: string;
  template?: string;
  notes?: string;
  /** Default "done". Only done pages get transcripts. */
  status?: PageStatus;
  /** Body lines per pass. Default: a short transcript for every pass of the run. */
  lines?: Partial<Record<PassName, string[]>>;
  stopReasons?: Partial<Record<PassName, StopReason>>;
  flags?: FlagResult[];
  errors?: string[];
  skip?: SkippedRecord;
  finalUrl?: string;
  attempts?: number;
}

export interface SyntheticRun {
  id: string;
  createdAt?: string;
  /** Written to run.json. Default "completed". */
  status?: "incomplete" | "completed";
  replayed?: boolean;
  source?: PageSource;
  passes?: PassName[];
  pages: SyntheticPage[];
  skipped?: SkippedRecord[];
  environment?: Partial<EnvironmentRecord>;
  /** Environments of later sessions (resumes), as overrides of the first. */
  resumedWith?: Partial<EnvironmentRecord>[];
  sourceWarnings?: string[];
  /**
   * Default true. False writes run.json as incomplete even for a completed run, the state a run
   * is in while its snapshot report is written just before sealing.
   */
  sealed?: boolean;
}

const DEFAULT_STOP: Record<PassName, StopReason> = {
  read: "end-reached",
  headings: "no-next-heading",
  tab: "left-document",
};

export function defaultLines(pagePath: string): Record<PassName, string[]> {
  return {
    read: [
      `banner landmark, link, Skip to main content`,
      `heading, level 1, Page ${pagePath}`,
      `Some text on ${pagePath}.`,
      `content info landmark, © 2026 Example Agency`,
      `© 2026 Example Agency`,
      `© 2026 Example Agency`,
    ],
    headings: [`heading, level 1, Page ${pagePath}`, "no next heading"],
    tab: ["Skip to main content, link", `Home, link`, "Address and search bar, edit"],
  };
}

/** Write a run: transcripts for done pages, then run.json. Returns the run as written. */
export async function writeSyntheticRun(outDir: string, spec: SyntheticRun): Promise<RunJson> {
  const passes = spec.passes ?? ["read", "headings", "tab"];
  const createdAt = spec.createdAt ?? "2026-09-26T14:05:00-05:00";
  const source = spec.source ?? { kind: "pages", file: "pages.csv", sha256: "a".repeat(64) };
  const env = environment({
    pageSource: source,
    runId: spec.id,
    runStartedAt: createdAt,
    ...(spec.replayed
      ? {
          driver: { name: "replay", version: "0.1.0" },
          replay: {
            from: "fixture/replay-run",
            sourceRun: "2026-09-20_0930",
            sourceDriver: "hand-written",
          },
        }
      : {}),
    ...spec.environment,
  });

  const pages: PageRecord[] = [];
  for (const page of spec.pages) {
    const url = new URL(page.path, SITE).href;
    const key = canonicalKey(url);
    const slug = pageSlug(key);
    const status = page.status ?? "done";
    const record: PageRecord = {
      url,
      key,
      slug,
      ...(page.label === undefined ? {} : { label: page.label }),
      ...(page.template === undefined ? {} : { template: page.template }),
      ...(page.notes === undefined ? {} : { notes: page.notes }),
      status,
      attempts: page.attempts ?? (status === "pending" ? 0 : 1),
      passes: {},
      files: {},
      flags: page.flags ?? [],
      errors: page.errors ?? [],
      ...(page.skip ? { skip: page.skip } : {}),
    };
    if (status === "done") {
      record.finalUrl = page.finalUrl ?? url;
      record.httpStatus = 200;
      record.session = 1;
      record.startedAt = createdAt;
      record.durationMs = 60_000;
      const lines = { ...defaultLines(page.path), ...page.lines };
      for (const pass of passes) {
        const passLines = lines[pass];
        const transcript: TranscriptJson = {
          schemaVersion: 1,
          voicecap: "0.1.0",
          replayed: spec.replayed ?? false,
          run: spec.id,
          pass,
          page: { url, key, slug, finalUrl: record.finalUrl, ...labels(page) },
          capturedAt: createdAt,
          durationMs: passLines.length * 1000,
          stepCount: passLines.length,
          stopReason: page.stopReasons?.[pass] ?? DEFAULT_STOP[pass],
          warnings: [],
          errors: [],
          environment: env,
          steps: passLines.map((spoken, index) => ({
            n: index + 1,
            command: MAIN_COMMAND[pass],
            spoken,
            durationMs: 1000,
            offsetMs: (index + 1) * 1000,
            ...(pass === "tab"
              ? {
                  inDocument: index < passLines.length - 1,
                  focused:
                    index < passLines.length - 1
                      ? { tag: "a", role: "link", name: spoken, inMain: index > 0, href: "#main" }
                      : null,
                }
              : {}),
          })),
        };
        const written = await writeTranscript(pageDir(outDir, spec.id, slug), transcript);
        Object.assign(record.files, written.files);
        record.passes[pass] = {
          steps: passLines.length,
          stopReason: transcript.stopReason,
          durationMs: transcript.durationMs,
          contentSha256: written.contentSha256,
          errors: [],
          warnings: [],
        };
      }
    }
    pages.push(record);
  }

  const status = spec.status ?? "completed";
  const sessions: RunJson["sessions"] = [
    {
      n: 1,
      startedAt: createdAt,
      endedAt: spec.resumedWith?.length ? "2026-09-26T15:00:00-05:00" : createdAt,
      endReason: spec.resumedWith?.length
        ? "interrupted"
        : status === "completed"
          ? "completed"
          : "interrupted",
      pagesDone: pages.filter((page) => page.status === "done").length,
      environment: env,
    },
    ...(spec.resumedWith ?? []).map((overrides, index) => ({
      n: index + 2,
      startedAt: "2026-09-26T16:00:00-05:00",
      endedAt: "2026-09-26T17:00:00-05:00",
      endReason: "completed" as const,
      pagesDone: 0,
      environment: { ...env, ...overrides },
    })),
  ];
  const run: RunJson = {
    schemaVersion: 1,
    id: spec.id,
    name: null,
    status,
    createdAt,
    completedAt: status === "completed" ? createdAt.replace("T14", "T18") : null,
    site: SITE,
    settings: {
      site: SITE,
      source,
      passes,
      include: [],
      exclude: [],
      limit: null,
      driver: spec.replayed ? "replay" : "guidepup",
      replayFrom: spec.replayed ? "fixture/replay-run" : null,
      capture: "complete",
      stepCaps: { read: 400, headings: 200, tab: 300 },
      nvdaSettings: {},
      browser: { channel: "chrome", fallbackToChromium: true },
    },
    settingsHash: "s".repeat(64),
    configSha256: "c".repeat(64),
    flagRulesSha256: "f".repeat(64),
    replayed: spec.replayed ?? false,
    source: {
      kind: source.kind,
      ...(source.kind === "sitemap"
        ? { sitemaps: [{ url: source.url, urls: spec.pages.length }] }
        : source.kind === "pages"
          ? {
              file: source.file,
              sha256: source.sha256,
              format: "csv" as const,
              encoding: "utf-8" as const,
            }
          : {}),
      listed: spec.pages.length + (spec.skipped?.length ?? 0),
      duplicates: 0,
      invalid: [],
      excludedByFilter: 0,
      excludedByLimit: 0,
      warnings: spec.sourceWarnings ?? [],
    },
    compareTo: null,
    sessions,
    skipped: spec.skipped ?? [],
    pages,
  };
  await writeRunJson(
    outDir,
    spec.sealed === false ? { ...run, status: "incomplete", completedAt: null } : run,
  );
  return run;
}

function labels(page: SyntheticPage): { label?: string; template?: string; notes?: string } {
  return {
    ...(page.label === undefined ? {} : { label: page.label }),
    ...(page.template === undefined ? {} : { template: page.template }),
    ...(page.notes === undefined ? {} : { notes: page.notes }),
  };
}

export function findPage(run: RunJson, pagePath: string): PageRecord {
  const key = canonicalKey(new URL(pagePath, SITE).href);
  const page = run.pages.find((candidate) => candidate.key === key);
  if (!page) throw new Error(`No page ${pagePath} in run ${run.id}`);
  return page;
}

/** Append a review of a page as it was in `run`, with that run's transcript hashes. */
export async function addReview(
  outDir: string,
  run: RunJson,
  pagePath: string,
  status: ReviewStatus,
  options: { reviewer?: string; at?: string; note?: string | null } = {},
): Promise<ReviewEntry> {
  const page = findPage(run, pagePath);
  const entry: ReviewEntry = {
    status,
    reviewer: options.reviewer ?? "Pat Reviewer",
    at: options.at ?? "2026-09-26T16:00:00-05:00",
    note: options.note ?? null,
    run: run.id,
    url: page.url,
    files: Object.fromEntries(
      Object.entries(page.files).map(([file, hash]) => [file, hash.sha256]),
    ),
    content: Object.fromEntries(
      Object.entries(page.passes).map(([pass, summary]) => [pass, summary.contentSha256]),
    ),
  };
  await appendReview(outDir, page.key, entry);
  return entry;
}

/** Write a manual session (session.json, session.txt, and optionally raw/) in its dated folder. */
export async function addManualSession(
  outDir: string,
  pagePath: string,
  id: string,
  options: {
    format?: ManualSessionJson["input"]["format"];
    raw?: "kept" | "no-raw" | "withheld-for-privacy";
    redacted?: boolean;
    reviewer?: string;
  } = {},
): Promise<ManualSessionJson> {
  const url = new URL(pagePath, SITE).href;
  const key = canonicalKey(url);
  const slug = pageSlug(key);
  const format = options.format ?? "nvda-log";
  const rawName = `${format}.txt`;
  const raw = options.raw ?? "kept";
  const json: ManualSessionJson = {
    schemaVersion: 1,
    voicecap: "0.1.0",
    id,
    page: { url, key, slug },
    input: {
      format,
      fileName: format === "nvda-log" ? "nvda.log" : "speech-viewer.txt",
      sha256: "d".repeat(64),
      bytes: 1234,
      raw: raw === "kept" ? { kept: true, path: `raw/${rawName}` } : { kept: false, reason: raw },
    },
    session: {
      date: id.slice(0, 10),
      dateSource: "option",
      start: format === "nvda-log" ? `${id.slice(0, 10)}T23:58:10-05:00` : null,
      end: format === "nvda-log" ? "2026-09-26T00:03:00-05:00" : null,
      from: null,
      to: null,
      crossesMidnight: format === "nvda-log",
    },
    nvdaVersion: format === "nvda-log" ? "2026.2" : null,
    importedAt: "2026-09-26T09:00:00-05:00",
    reviewer: options.reviewer ?? "Sam Tester",
    redaction: {
      applied: options.redacted ?? false,
      keystrokes: options.redacted ? 15 : 0,
      speech: options.redacted ? 15 : 0,
      note: null,
    },
    warnings: [],
    entries: [
      { at: "2026-09-25T23:58:10-05:00", type: "key", text: "downArrow" },
      { at: "2026-09-25T23:58:11-05:00", type: "speech", text: "heading, level 1, Welcome" },
    ],
  };
  const dir = manualSessionDir(outDir, id, slug);
  await mkdir(path.join(dir, "raw"), { recursive: true });
  await writeFile(path.join(dir, "session.json"), `${JSON.stringify(json, null, 2)}\n`);
  await writeFile(
    path.join(dir, "session.txt"),
    "# manual session\n\n[downArrow]\nheading, level 1, Welcome\n",
  );
  if (raw === "kept") await writeFile(path.join(dir, "raw", rawName), "raw original\n");
  return json;
}

/**
 * A realistic transcripts folder for report tests: an earlier run and a later one (with a
 * changed page, a new page, a failed page, a skipped page), reviews, and manual sessions.
 */
export async function buildRichFixture(
  outDir: string,
  options: { sealRun?: boolean } = {},
): Promise<{ base: RunJson; run: RunJson }> {
  const skipped: SkippedRecord[] = [
    { url: "https://www.example.com/partner/", reason: "off-origin" },
    { url: `${SITE}files/annual-report.pdf`, reason: "non-html-extension", line: 9 },
  ];
  const base = await writeSyntheticRun(outDir, {
    id: "2026-09-20_0930",
    createdAt: "2026-09-20T09:30:00-05:00",
    pages: [
      { path: "/", label: "Home", template: "home" },
      { path: "/grants/fy27-jag", label: "FY27 JAG", template: "grants" },
      { path: "/resources", label: "Resources", template: "content" },
      { path: "/retired-page", template: "content" },
    ],
    skipped,
  });
  const run = await writeSyntheticRun(outDir, {
    id: "2026-09-26_1405",
    createdAt: "2026-09-26T14:05:00-05:00",
    sealed: options.sealRun ?? true,
    environment: {
      screenReader: { name: "NVDA", version: "2026.3", build: "0.2.2-2026.3", language: "en" },
    },
    pages: [
      { path: "/", label: "Home", template: "home" },
      {
        path: "/grants/fy27-jag",
        label: "FY27 JAG",
        template: "grants",
        lines: {
          read: [
            "banner landmark, link, Skip to main content",
            "heading, level 1, FY27 JAG",
            "Applications are due October 31.",
            "content info landmark, © 2026 Example Agency",
            "© 2026 Example Agency",
            "© 2026 Example Agency",
          ],
        },
      },
      {
        path: "/resources",
        label: "Resources",
        template: "content",
        flags: [
          {
            rule: "generic-link-text",
            message: 'Generic link text announced 3 times in the tab pass ("Read more, link" ×3)',
            pass: "tab",
            count: 3,
          },
          { rule: "unlabeled", message: "Unlabeled button in the tab pass", pass: "tab", count: 1 },
        ],
      },
      { path: "/news/new-page", label: "New page", template: "news" },
      { path: "/broken", status: "failed", errors: ["Timed out twice; gave up"], attempts: 2 },
      {
        path: "/contact",
        status: "skipped",
        skip: {
          url: `${SITE}contact`,
          reason: "redirect-off-origin",
          finalUrl: "https://www.example.com/contact/",
        },
      },
    ],
    skipped: [
      ...skipped,
      {
        url: `${SITE}contact`,
        reason: "redirect-off-origin",
        finalUrl: "https://www.example.com/contact/",
      },
    ],
  });
  await addReview(outDir, base, "/", "reviewed", { at: "2026-09-21T10:00:00-05:00" });
  await addReview(outDir, base, "/", "issue", {
    at: "2026-09-22T11:00:00-05:00",
    note: "Skip link target is wrong.",
  });
  await addReview(outDir, run, "/", "fixed", { at: "2026-09-26T19:00:00-05:00" });
  await addReview(outDir, base, "/grants/fy27-jag", "reviewed", {
    at: "2026-09-21T10:30:00-05:00",
  });
  await addReview(outDir, run, "/resources", "issue", {
    at: "2026-09-26T19:30:00-05:00",
    note: 'Three "Read more" links.',
  });
  await addManualSession(outDir, "/resources", "2026-09-25_2358", {
    redacted: true,
    raw: "withheld-for-privacy",
  });
  await addManualSession(outDir, "/", "2026-09-24_1000", { format: "speech-viewer" });
  return { base, run };
}
