/**
 * The shareable page's model: what buildShareModel makes of a site folder that loadShareInput has
 * read. The demo runs of 29 September 2026 (voicecap 0.4.1, in test/fixtures/share/) are the real
 * case; site folders written as voicecap writes them, and runs built in memory, cover the rest.
 */
import { readFileSync } from "node:fs";
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { VoicecapConfig } from "../src/config/schema.js";
import { gestureOf } from "../src/drivers/guidepup/nvda-log.js";
import type { PageScreenshot } from "../src/drivers/types.js";
import { flagRulesSha256 } from "../src/flags/evaluate.js";
import type {
  EnvironmentRecord,
  FlagResult,
  MachineRecord,
  PageSource,
  ReviewEntry,
  ReviewsFile,
  ReviewStatus,
  RunEvent,
  RunJson,
  ScreenshotRecord,
  StepRecord,
} from "../src/model.js";
import { pageSlug } from "../src/pages/slug.js";
import { canonicalKey } from "../src/pages/url.js";
import { describeChanges } from "../src/report/compare.js";
import { runAudit } from "../src/run/audit.js";
import { readEventLog } from "../src/run/events.js";
import { redactHome } from "../src/run/failure.js";
import { eventLogFile, pageDir, runJsonPath, siteFolder } from "../src/run/paths.js";
import { attentionWords } from "../src/share/attention-words.js";
import type { AttentionCard } from "../src/share/attention.js";
import { CHECK_LIBRARY, type CheckData } from "../src/share/check.js";
import { loadShareInput, type ShareInput, type TranscriptStore } from "../src/share/load.js";
import {
  buildShareModel,
  type PageCard,
  type RunEvidence,
  type ShareModel,
} from "../src/share/model.js";
import { verdictOf } from "../src/share/verdict.js";
import {
  parseWalkthrough,
  walkthroughJson,
  walkthroughOf,
  walkthroughProblem,
} from "../src/share/walkthrough.js";
import { writeWalkthrough } from "../src/share/write-walkthrough.js";
import { bodyLines, extractBody } from "../src/transcripts/format.js";
import { fileHash } from "../src/transcripts/write.js";
import { sealOf } from "../src/util/hash.js";
import { createMemoryLogger } from "../src/util/log.js";
import { isoLocal } from "../src/util/time.js";
import {
  addManualSession,
  addReview,
  defaultLines,
  SITE,
  tempOutDir,
  writeSyntheticRun,
  type SyntheticRun,
} from "./helpers/report-data.js";
import { TINY_JPEG, TINY_RECORD } from "./helpers/jpeg.js";
import {
  addEarlierRun,
  addLaterRun,
  keptLogsRun,
  type KeptLogs,
  NVDA_FIXTURE,
  nvdaFixtureSite,
} from "./helpers/nvda-log.js";
import {
  config as runConfig,
  options as runOptions,
  setup as setupSite,
  sitePages,
} from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";
import { failedAttempt, shareRun, type SharePageSpec } from "./helpers/share-data.js";
import { DEMO_DAY, demoRun } from "./helpers/share-fixture.js";
import {
  DEMO_SITE,
  demoModel,
  downloadOf,
  fileBytes,
  homeModel,
  inputOf,
  LINES,
  LOG_HASH,
  logged,
  loggedRun,
  picturesOf,
  resumedLoggedRun,
  STEP_LIMIT_PROBLEM,
  storeOf,
  TRANSCRIPTS,
  txtOf,
  type Lines,
  withNestedSettings,
  withOwnFiles,
  withoutReadTxt,
  withoutTxt,
  withStepLimit,
} from "./helpers/share-model.js";

const CHRIS = "Christopher Schweda";
const PAT = "Pat Lee";
const SAM = "Sam Roe";

/** The demo pages the tests look at closely. */
const HOME = "home";
const HOW = "how-a-run-works-fd116f9328";
const COMMON = "common-mistakes-db8c98dbfa";

/** What a run from before voicecap recorded something says in its place. */
const BEFORE_0_6 = "Not recorded: this run used voicecap 0.4.1.";

/** The rows of a run's test environment that describe the computer itself. */
const COMPUTER = [
  "Processor",
  "Memory",
  "Display",
  "Browser window",
  "Time zone",
  "Display language",
  "Software",
];

/** A demo transcript file, exactly as on disk. */
function demoFile(time: "1315" | "1402", slug: string, name: string): string {
  return readFileSync(`${DEMO_DAY}${time}/pages/${slug}/${name}`, "utf8");
}

/**
 * A run written as voicecap writes one (writeSyntheticRun), then sealed as a completed run is.
 * `change` edits the record before the seal, for what writeSyntheticRun doesn't write: titles,
 * reviewers, and listeners' answers.
 */
async function sealedRun(
  siteDir: string,
  spec: SyntheticRun,
  change?: (run: RunJson) => void,
): Promise<RunJson> {
  const run = await writeSyntheticRun(siteDir, spec);
  change?.(run);
  const sealed: RunJson = { ...run, seal: sealOf(run) };
  // writeRunJson never touches a completed run's record, so this writes it as complete() does.
  await writeFile(runJsonPath(siteDir, run.id), `${JSON.stringify(sealed, null, 2)}\n`);
  return sealed;
}

/** A flag voicecap raises now for two "click here" links in the read pass. */
const LINK_FLAG: FlagResult = {
  rule: "generic-link-text",
  pass: "read",
  count: 2,
  found: [{ text: "click here", count: 2 }],
  message: 'Generic link text announced 2 times in the read pass: "click here" ×2.',
};

/** The flag voicecap raises when a page's read pass stops at its step cap before the page's end. */
const NOT_FINISHED: FlagResult = {
  rule: "read-not-finished",
  pass: "read",
  message:
    "The read pass stopped at its step cap (2 steps) instead of reaching the end of the page.",
};

/** A read pass with two links that say only "click here". */
const CLICK_HERE_LINES = [
  "banner landmark, link, Skip to main content",
  "heading, level 1, Grants",
  "To apply,, link, click here, dot",
  "To read the rules,, link, click here, dot",
  "content info landmark, © 2026 Example Agency",
  "© 2026 Example Agency",
  "© 2026 Example Agency",
];

/** A computer as voicecap 0.6.0 records it. */
const MACHINE: MachineRecord = {
  os: { name: "Windows 11 Pro 25H2", build: "10.0.26200.9550", arch: "x64" },
  cpu: { name: "Intel Core Ultra 7 265F", baseMhz: 2400, physicalCores: 20, logicalProcessors: 20 },
  memoryBytes: 34_045_000_000,
  display: { width: 3440, height: 1440, refreshHz: 59, scalePercent: 110 },
  browserWindow: { width: 1280, height: 960 },
  timeZone: "America/Chicago",
  utcOffset: "-05:00",
  language: "en-US",
  software: { node: "24.19.0", voicecap: "0.6.0", guidepup: "0.34.0", playwright: "1.63.0" },
};

/** The fingerprint check's results, from the script the page carries. */
interface Checked {
  files: { label: string; ok: boolean }[];
  runs: { id: string; ok: boolean }[];
  reviewProblems: string[];
  line: string;
}

// The check's library as a browser gets it: plain script, with nothing but TextEncoder from outside.
const library = vm.runInNewContext(`${CHECK_LIBRARY};({ checkAll })`, { TextEncoder }) as {
  checkAll: (data: CheckData) => Promise<Checked>;
};

/** The page's own check of its data, as plain data. */
async function check(data: CheckData): Promise<Checked> {
  return JSON.parse(JSON.stringify(await library.checkAll(data))) as Checked;
}

/** Every string in a value, however deep. */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

/**
 * What the page shows of a model: everything but the records it carries as they are, for the
 * fingerprint check and for the renderers to read fingerprints from. A walkthrough file the page
 * carries for download is shown as the words in it: its base64 would hide a folder's name.
 */
function shown(model: ShareModel): unknown {
  return {
    ...model,
    check: null,
    evidence: model.evidence.map((each) => ({
      ...each,
      run: null,
      walkthrough:
        "problem" in each.walkthrough
          ? each.walkthrough
          : { ...each.walkthrough, base64: fileBytes(each.walkthrough).toString("utf8") },
    })),
    changes: model.changes && { ...model.changes, before: null, after: null },
  };
}

/** The evidence of the first run a model draws on, the latest. */
function latestEvidence(model: ShareModel): RunEvidence {
  const [first] = model.evidence;
  if (first === undefined) throw new Error("The model has no run that counts.");
  return first;
}

/** Whether text holds the home folder, however its separators are written. */
function mentionsHome(text: string): boolean {
  const home = os.homedir().toLowerCase();
  const lowered = text.toLowerCase();
  return lowered.includes(home) || lowered.includes(home.replaceAll("\\", "/"));
}

describe("loadShareInput", () => {
  it("reads a site folder's records, as of the time it's given", async () => {
    const now = new Date("2026-10-01T14:00:00Z");
    const config: VoicecapConfig = {
      ...DEFAULT_CONFIG,
      report: { ...DEFAULT_CONFIG.report, siteName: "The voicecap demo" },
    };
    const input = await loadShareInput({ siteDir: DEMO_SITE, config, now });

    expect(input).toMatchObject({
      readOrigin: "http://127.0.0.1:4848",
      siteName: "The voicecap demo",
      flagRules: DEFAULT_CONFIG.flags,
      flagRulesSha256: flagRulesSha256(DEFAULT_CONFIG.flags),
      generatedAt: isoLocal(now),
      home: os.homedir(),
      platform: process.platform,
      fileName: "current.html",
      wordName: "current.docx",
    });
    // Every run, oldest first, each record exactly as its run.json holds it.
    expect(input.records).toEqual((["1315", "1402", "1415", "1419"] as const).map(demoRun));
    expect(input.runs.map((run) => run.id)).toEqual(input.records.map((run) => run.id));
    expect(input.transcripts.txt("2026-09-29_1315", HOW, "read")).toBe(
      demoFile("1315", HOW, "read.txt"),
    );
    expect(input.transcripts.steps("2026-09-29_1402", HOME, "tab")).toHaveLength(9);
    // A run's transcripts the page doesn't show aren't read.
    expect(input.transcripts.txt("2026-09-29_1315", HOME, "read")).toBeNull();

    const named = await loadShareInput({
      siteDir: DEMO_SITE,
      config: DEFAULT_CONFIG,
      fileName: "127.0.0.1_4848_2026-10-01.html",
      wordName: "127.0.0.1_4848_2026-10-01.docx",
    });
    expect(named).toMatchObject({
      siteName: null,
      fileName: "127.0.0.1_4848_2026-10-01.html",
      wordName: "127.0.0.1_4848_2026-10-01.docx",
    });
  });

  it("refuses a site folder with no run, which has nothing to share", async () => {
    const siteDir = await tempOutDir();
    await expect(loadShareInput({ siteDir, config: DEFAULT_CONFIG })).rejects.toThrow(
      `There's no run in ${siteDir} yet, so there's nothing to share.`,
    );
  });

  describe("each run's event log", () => {
    /** A site folder with one run of the scripted site, which recorded its event log. */
    async function loggedSite(): Promise<{ siteDir: string; runId: string }> {
      const dir = await setupSite(["/", "/about"]);
      const result = await runAudit(runOptions(dir, new ScriptedDriver(sitePages())));
      expect(result.outcome).toBe("completed");
      return { siteDir: result.siteDir, runId: result.runId };
    }

    it("reads the log of each run the page draws on, as the run's record lists it", async () => {
      const { siteDir, runId } = await loggedSite();
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });
      const onDisk = readEventLog(await readFile(eventLogFile(siteDir, runId), "utf8"));

      expect([...input.events.keys()]).toEqual([runId]);
      expect(input.events.get(runId)).toEqual(onDisk);
      expect(onDisk.events.map((event) => event.type)).toEqual([
        "run-started",
        "page-started",
        "page-finished",
        "page-started",
        "page-finished",
        "run-ended",
      ]);
    });

    it("leaves out a log that isn't as its run recorded it, and the page says so", async () => {
      const { siteDir, runId } = await loggedSite();
      await appendFile(
        eventLogFile(siteDir, runId),
        '{"at":"2026-09-26T14:05:00.000-05:00","type":"computer-locked"}\n',
      );
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

      expect(input.events.has(runId)).toBe(false);
      expect(buildShareModel(input).evidence[0]?.timeline).toEqual({
        notRecorded:
          "Not shown: the event log isn't as the run recorded it; voicecap verify names it.",
      });
    });

    it("leaves out a log its run's record doesn't list, as one dropped into an older run's folder", async () => {
      const siteDir = path.join(await tempOutDir(), path.basename(DEMO_SITE));
      await cp(DEMO_SITE, siteDir, { recursive: true });
      await writeFile(
        eventLogFile(siteDir, "2026-09-29_1402"),
        '{"at":"2026-09-29T14:02:51.307-05:00","type":"run-started","session":1,"resumed":false}\n',
      );
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

      expect(input.events.size).toBe(0);
      expect(
        (await loadShareInput({ siteDir: DEMO_SITE, config: DEFAULT_CONFIG })).events.size,
      ).toBe(0);
    });
  });

  describe("each run's copies of NVDA's log", () => {
    const COPY = "nvda-log/1-1.txt";

    /** The site's one run, written with its copy listed in its record (the real run, with its log). */
    async function copySite(options: Parameters<typeof nvdaFixtureSite>[0] = {}) {
      const site = await nvdaFixtureSite(options);
      const input = await loadShareInput({
        siteDir: site.siteDir,
        config: DEFAULT_CONFIG,
        gestureOf,
      });
      return { ...site, input };
    }

    it("reads the copies each run the page draws on lists, by their path from the run's folder", async () => {
      const { input, runId } = await copySite();

      expect([...input.nvdaLogs.keys()]).toEqual([runId]);
      expect([...(input.nvdaLogs.get(runId)?.keys() ?? [])]).toEqual([COPY]);
      expect(input.nvdaLogs.get(runId)?.get(COPY)).toBe(await NVDA_FIXTURE.copy());
    });

    it("leaves out a copy that isn't as its run recorded it: longer, changed in place, or missing", async () => {
      const longer = await nvdaFixtureSite();
      await appendFile(path.join(longer.runFolder, "nvda-log", "1-1.txt"), "# edited\n");
      expect(
        (await loadShareInput({ siteDir: longer.siteDir, config: DEFAULT_CONFIG, gestureOf }))
          .nvdaLogs.size,
      ).toBe(0);

      // One word said otherwise, of the same length: only its fingerprint can tell.
      const changed = await nvdaFixtureSite();
      const file = path.join(changed.runFolder, "nvda-log", "1-1.txt");
      const text = await readFile(file, "utf8");
      await writeFile(file, text.replace("'Calculator'", "'Calculatoz'"));
      expect((await readFile(file, "utf8")).length).toBe(text.length);
      expect(
        (await loadShareInput({ siteDir: changed.siteDir, config: DEFAULT_CONFIG, gestureOf }))
          .nvdaLogs.size,
      ).toBe(0);

      const missing = await nvdaFixtureSite();
      await rm(path.join(missing.runFolder, "nvda-log", "1-1.txt"));
      expect(
        (await loadShareInput({ siteDir: missing.siteDir, config: DEFAULT_CONFIG, gestureOf }))
          .nvdaLogs.size,
      ).toBe(0);
    });

    it("leaves out a copy its run's record doesn't list, as one dropped into the folder", async () => {
      const { input } = await copySite({ unlisted: true });

      expect(input.nvdaLogs.size).toBe(0);
    });

    it("reads only a path that is a copy's, so a record can't send it anywhere else", async () => {
      const { siteDir, runFolder, runId } = await nvdaFixtureSite();
      const events = await readFile(path.join(runFolder, "events.jsonl"));
      // The record lists a path that climbs out of the copies' folder, with the fingerprint of a file
      // that is there: it is not a copy, and it isn't read.
      const { seal: _seal, ...record } = JSON.parse(
        await readFile(path.join(runFolder, "run.json"), "utf8"),
      ) as RunJson;
      const files = { ...record.files, "nvda-log/../events.jsonl": fileHash(events) };
      const changed = { ...record, files };
      await writeFile(
        path.join(runFolder, "run.json"),
        JSON.stringify({ ...changed, seal: sealOf(changed) }),
      );
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG, gestureOf });

      expect([...(input.nvdaLogs.get(runId)?.keys() ?? [])]).toEqual([COPY]);
    });

    it("has none for a run whose record lists none, as every run before the copies were kept", async () => {
      const input = await loadShareInput({
        siteDir: DEMO_SITE,
        config: DEFAULT_CONFIG,
        gestureOf,
      });

      expect(input.nvdaLogs.size).toBe(0);
    });

    it("reads every pass of every page of a run that kept copies, not only those the page shows", async () => {
      const { siteDir, runId } = await nvdaFixtureSite();
      const later = await addLaterRun(siteDir);
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG, gestureOf });
      const run = input.records.find((record) => record.id === runId)!;

      // The later run is the latest: the page shows its transcripts of the seven pages, not the
      // first run's. The first run's steps are read all the same, for its copy to be checked against.
      expect(input.records.map((record) => record.id)).toEqual([runId, later]);
      expect(run.pages).toHaveLength(7);
      for (const page of run.pages) {
        for (const pass of ["read", "headings", "tab"] as const) {
          const steps = input.transcripts.steps(runId, page.slug, pass);
          expect(steps, `${page.slug} ${pass}`).toHaveLength(page.passes[pass]!.steps);
        }
      }
      // Its TXT isn't read: the page doesn't show it.
      expect(input.transcripts.txt(runId, run.pages[0]!.slug, "read")).toBeNull();
    });

    it("reads the steps of no run that kept no copy, whose pages the page doesn't show", async () => {
      const { siteDir, runId } = await nvdaFixtureSite();
      const earlier = await addEarlierRun(siteDir);
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG, gestureOf });
      const [page] = input.records.find((record) => record.id === earlier)!.pages;

      // The fixture's run is the latest and shows its pages; the earlier run is the run before it,
      // drawn on, with nothing to check its pages against.
      expect(input.records.map((record) => record.id)).toEqual([earlier, runId]);
      expect(input.transcripts.steps(earlier, page!.slug, "read")).toBeNull();
      expect(input.transcripts.steps(runId, page!.slug, "read")).not.toBeNull();
    });

    it("reads no steps it has no use for: none for a run without copies, and none when the page is made without NVDA's keys", async () => {
      const { siteDir, runId } = await nvdaFixtureSite();
      await addLaterRun(siteDir);
      const withoutKeys = await loadShareInput({
        siteDir,
        config: DEFAULT_CONFIG,
        gestureOf: null,
      });
      const [page] = withoutKeys.records.find((record) => record.id === runId)!.pages;

      expect(withoutKeys.transcripts.steps(runId, page!.slug, "read")).toBeNull();
      // The copies are read all the same: they are what the page's problems draw on.
      expect(withoutKeys.nvdaLogs.get(runId)?.size).toBe(1);
      expect(withoutKeys.gestureOf).toBeNull();

      const later = await loadShareInput({ siteDir, config: DEFAULT_CONFIG, gestureOf });
      expect(later.gestureOf).toBe(gestureOf);
      expect(later.nvdaLogs.has("2026-10-07_0900")).toBe(false);
    });
  });

  describe("each page's screenshot", () => {
    const NOT_SHOWN = "Not shown: the file isn't as the run recorded it; voicecap verify names it.";
    const UNREADABLE_RECORD = "Not shown: the run's record of this screenshot couldn't be read.";
    const PICTURE: PageScreenshot = { jpeg: TINY_JPEG };

    /** A site folder with one run of the scripted site, each of whose pages took `screenshot`. */
    async function shotSite(screenshot: PageScreenshot = PICTURE) {
      const dir = await setupSite(["/", "/about"]);
      const pages = sitePages({ home: { screenshot }, about: { screenshot } });
      const result = await runAudit(runOptions(dir, new ScriptedDriver(pages)));
      expect(result.outcome).toBe("completed");
      return { siteDir: result.siteDir, run: result.run };
    }

    /** Where a page of a run keeps its screenshot. */
    const shotFile = (siteDir: string, run: RunJson, index: number): string =>
      path.join(pageDir(siteDir, run.id, run.pages[index]?.slug ?? ""), "screenshot.jpg");

    it("reads the screenshot of each page the page shows, as the run's record lists it", async () => {
      const { siteDir, run } = await shotSite();
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

      expect([...input.screenshots.keys()].sort()).toEqual(
        run.pages.map((page) => `${run.id}/${page.slug}`).sort(),
      );
      for (const bytes of input.screenshots.values()) {
        expect(Buffer.compare(bytes, TINY_JPEG)).toBe(0);
      }
      // The page shows them.
      const { pages } = buildShareModel(input);
      expect(pages.map((card) => "dataUri" in card.screenshot)).toEqual([true, true]);
    });

    it("leaves out a screenshot whose file is missing, or changed since its run's seal, and the page says verify names it", async () => {
      const { siteDir, run } = await shotSite();
      await rm(shotFile(siteDir, run, 0));
      await appendFile(shotFile(siteDir, run, 1), Buffer.from([0]));
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

      expect(input.screenshots.size).toBe(0);
      expect(buildShareModel(input).pages.map((card) => card.screenshot)).toEqual([
        { notRecorded: NOT_SHOWN },
        { notRecorded: NOT_SHOWN },
      ]);
    });

    it("reads no file for a record no voicecap writes, and the page says it couldn't read the record, rather than stop", async () => {
      const { siteDir, run } = await shotSite();
      const file = runJsonPath(siteDir, run.id);
      const recorded = JSON.parse(await readFile(file, "utf8")) as RunJson;
      // As an edit, or a later voicecap, might leave them: no object, and an object of neither kind.
      const odd: unknown[] = [null, "screenshot.jpg"];
      const { seal: _seal, ...unsealed } = {
        ...recorded,
        pages: recorded.pages.map((page, index) => ({ ...page, screenshot: odd[index] })),
      };
      await writeFile(file, JSON.stringify({ ...unsealed, seal: sealOf(unsealed) }, null, 2));
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });
      const model = buildShareModel(input);

      expect(input.screenshots.size).toBe(0);
      expect(model.pages.map((card) => card.screenshot)).toEqual([
        { notRecorded: UNREADABLE_RECORD },
        { notRecorded: UNREADABLE_RECORD },
      ]);
      expect(model.evidence[0]?.fingerprints.map(({ file: name }) => name)).not.toContain(
        "screenshot.jpg",
      );
    });

    it("reads no file for a page whose record says why it has none", async () => {
      const { siteDir } = await shotSite({ error: "timed out after 5s" });
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

      expect(input.screenshots.size).toBe(0);
      expect(buildShareModel(input).pages.map((card) => card.screenshot)).toEqual([
        { notRecorded: "Not recorded: the screenshot couldn't be taken (timed out after 5s)." },
        { notRecorded: "Not recorded: the screenshot couldn't be taken (timed out after 5s)." },
      ]);
    });

    it("reads the screenshot of a page that failed after it loaded, which the page's card shows beside its failure", async () => {
      const dir = await setupSite(["/"]);
      // Every attempt's read pass times out at its first Down Arrow, so the page is never transcribed.
      const driver = new ScriptedDriver(sitePages({ home: { screenshot: PICTURE } }), {
        hang: (command) => command === "nextLine",
      });
      const result = await runAudit(
        runOptions(dir, driver, { config: runConfig({ pageAttempts: 2 }) }),
      );
      expect(result.run.pages[0]).toMatchObject({ status: "failed", attempts: 2 });
      const input = await loadShareInput({ siteDir: result.siteDir, config: DEFAULT_CONFIG });
      const [card] = buildShareModel(input).pages;

      expect([...input.screenshots.keys()]).toEqual([
        `${result.runId}/${result.run.pages[0]?.slug}`,
      ]);
      expect(card).toMatchObject({ status: "never", screenshot: { width: 16, height: 12 } });
    });

    it("reads the screenshot of the record the page shows, and no other: not that of a later failure of the page", async () => {
      const dir = await setupSite(["/", "/about"]);
      const both = sitePages({ home: { screenshot: PICTURE }, about: { screenshot: PICTURE } });
      const first = await runAudit(
        runOptions(dir, new ScriptedDriver(both), { now: () => new Date(2026, 8, 26, 14, 5) }),
      );
      // The second run reads the home page, and the page /about fails after its picture was taken.
      const second = await runAudit(
        runOptions(
          dir,
          new ScriptedDriver(both, {
            hang: (command, url) => command === "nextLine" && url.endsWith("/about"),
          }),
          {
            fresh: true,
            now: () => new Date(2026, 8, 27, 9, 30),
            config: runConfig({ pageAttempts: 1 }),
          },
        ),
      );
      expect(second.run.pages.map((page) => page.status)).toEqual(["done", "failed"]);
      expect(second.run.pages[1]?.screenshot).toMatchObject({ width: 16, height: 12 });
      const input = await loadShareInput({ siteDir: first.siteDir, config: DEFAULT_CONFIG });

      // /about is shown from the first run, with its transcripts: its picture is the first run's.
      expect([...input.screenshots.keys()].sort()).toEqual(
        [
          `${second.runId}/${second.run.pages[0]?.slug}`,
          `${first.runId}/${first.run.pages[1]?.slug}`,
        ].sort(),
      );
      expect(buildShareModel(input).pages.map((card) => card.statusText)).toEqual([
        "Transcribed",
        `Failed in run ${second.runId} · transcribed in run ${first.runId}`,
      ]);
    });
  });
});

describe("buildShareModel", () => {
  // The home page's title and the report.siteName setting named a site before 0.10.0. A site is
  // named now by the host of its canonical address, or, with none known, by the host voicecap read
  // (test/share-canonical.test.ts has the rest of the rule).
  it("names the site by the host voicecap read when no canonical address is known, never by its home page's title", async () => {
    const titled = shareRun({
      id: "r1",
      pages: [
        { path: "/about", title: "About us" },
        { path: "/", title: " Example Agency " },
      ],
    });
    expect(buildShareModel(inputOf([titled])).header).toMatchObject({
      name: "example.illinois.gov",
      site: SITE,
    });

    // A site with a port is named with it, as its folder is.
    expect((await demoModel()).header).toMatchObject({
      name: "127.0.0.1:4848",
      site: "http://127.0.0.1:4848",
    });
  });

  it("builds a card for every page in scope, with its status in words", () => {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [{ path: "/" }, { path: "/moved", title: "Moved" }, { path: "/now-skipped" }],
    });
    const latest = shareRun({
      id: "r2",
      pages: [
        {
          path: "/",
          title: "Home",
          passes: { read: ["One", "Two"], headings: ["Heading"], tab: ["A", "B", "C"] },
        },
        { path: "/flagged", title: "Flagged", flags: [LINK_FLAG] },
        {
          path: "/moved",
          status: "failed",
          title: "Moved, and failing",
          failedAttempts: [
            failedAttempt({ n: 1 }),
            failedAttempt({
              n: 2,
              cause: "step-timeout",
              message: "Step 12 of the read pass did not finish within 30s.",
            }),
          ],
        },
        {
          path: "/never",
          status: "failed",
          title: null,
          errors: [
            "read pass: The browser lost the foreground to another window, so this step's keystroke and speech were discarded. Keep the computer free while voicecap runs.",
          ],
        },
        { path: "/now-skipped", status: "skipped", title: "Now skipped" },
        { path: "/skipped", status: "skipped", title: null, skip: "redirect-off-origin" },
      ],
    });
    const { pages } = buildShareModel(inputOf([earlier, latest]));

    // The flags get chips of their own, so the status of a page with transcripts is only that.
    expect(pages.map((card) => [card.path, card.status, card.statusText])).toEqual([
      ["/", "no-flags", "Transcribed"],
      ["/flagged", "flags", "Transcribed"],
      ["/moved", "failed", "Failed in run r2 · transcribed in run r1"],
      ["/never", "never", "Failed in run r2 · never transcribed"],
      ["/now-skipped", "skipped", "Skipped in run r2 · transcribed in run r1"],
      ["/skipped", "skipped", "Skipped in run r2 · never transcribed"],
    ]);
    expect(pages.map((card) => card.failure)).toEqual([
      null,
      null,
      "It failed on both attempts. On the last, during the read pass, at step 12 (Down Arrow), a step took too long.",
      "During the read pass, another window took the screen.",
      "voicecap skipped it: the site didn't answer with an HTML page.",
      "voicecap skipped it: it redirected to another site.",
    ]);
    const older = { run: "r1", date: "25 September 2026" };
    expect(pages.map((card) => card.from)).toEqual([null, null, older, null, older, null]);
    expect(pages.map((card) => card.needsAttention)).toEqual([false, true, true, true, true, true]);
    expect(pages.map((card) => card.flags)).toEqual([[], [LINK_FLAG], [], [], [], []]);

    expect(pages[0]).toMatchObject({
      name: SITE,
      title: "Home",
      counts: { read: 2, headings: 1, tab: 3 },
      // The record keeps no time for the page: a run from before voicecap recorded one.
      timeMs: { notRecorded: "Not recorded: this run used voicecap 0.1.0." },
      strip: [],
      reviewChips: [],
      manual: [],
      screenshot: { notRecorded: "Not recorded: this run used voicecap 0.1.0." },
    });
    // A page shown from an older run has the title recorded with its transcripts, which a run that
    // didn't record titles doesn't have; a page never transcribed has its latest record's.
    expect(pages.map((card) => card.title)).toEqual([
      "Home",
      "Flagged",
      "Moved",
      null,
      { notRecorded: "Not recorded: this run used voicecap 0.1.0." },
      null,
    ]);
    expect(pages.map((card) => card.counts)).toEqual([
      { read: 2, headings: 1, tab: 3 },
      { read: null, headings: null, tab: null },
      { read: null, headings: null, tab: null },
      null,
      { read: null, headings: null, tab: null },
      null,
    ]);
  });

  it("lowers only a first word that isn't a name, a word of one letter too", () => {
    const run = shareRun({
      id: "r1",
      pages: [
        {
          path: "/",
          status: "failed",
          failedAttempts: [
            failedAttempt({ n: 1 }),
            failedAttempt({
              n: 2,
              cause: "open-timeout",
              pass: "read",
              step: null,
              command: "openPage",
              message: "The page didn't open within 30s.",
            }),
          ],
        },
        {
          path: "/a",
          status: "failed",
          failedAttempts: [
            failedAttempt({ n: 1 }),
            failedAttempt({
              n: 2,
              cause: "screen-reader-stopped",
              pass: "read",
              step: null,
              command: "openPage",
              message: "NVDA stopped running.",
            }),
          ],
        },
      ],
    });

    expect(buildShareModel(inputOf([run])).pages.map((card) => card.failure)).toEqual([
      "It failed on both attempts. On the last, a step took too long while opening the page for the read pass.",
      "It failed on both attempts. On the last, NVDA stopped running while opening the page for the read pass.",
    ]);
  });

  it("never folds away a page with no transcripts, whatever its record says", () => {
    // A completed run has no page still pending; were there one, its card would still show.
    const run = shareRun({ id: "r1", pages: [{ path: "/" }, { path: "/a", status: "pending" }] });
    const [, pending] = buildShareModel(inputOf([run])).pages;

    expect(pending).toMatchObject({
      status: "never",
      statusText: "Never transcribed",
      needsAttention: true,
    });
  });

  it("says a page whose read stopped before its end was transcribed, never read in full", () => {
    const notFinished: FlagResult = {
      rule: "read-not-finished",
      pass: "read",
      message:
        "The read pass stopped at its step cap (2 steps) instead of reaching the end of the page.",
    };
    const run = shareRun({
      id: "r1",
      pages: [
        { path: "/", passes: { read: ["One", "Two"] } },
        {
          path: "/long",
          passes: { read: ["One", "Two"] },
          stopped: { read: "step-cap" },
          flags: [notFinished],
        },
        // The repeat safety net stopped it, and the rule that flags that is turned off: the card
        // says so all the same.
        { path: "/looping", passes: { read: ["One", "One"] }, stopped: { read: "repeat-limit" } },
      ],
    });
    const { pages } = buildShareModel(inputOf([run]));

    expect(
      pages.map((card) => [card.path, card.status, card.statusText, card.readStopped]),
    ).toEqual([
      ["/", "no-flags", "Transcribed", null],
      ["/long", "flags", "Transcribed; its read stopped at the step limit", "step-cap"],
      [
        "/looping",
        "no-flags",
        "Transcribed; its read stopped before the end of the page",
        "repeat-limit",
      ],
    ]);
    // Never folded away as having nothing to note.
    expect(pages.map((card) => card.needsAttention)).toEqual([false, true, true]);
  });

  it("puts the person's review on each card, as far as the records show it", async () => {
    const siteDir = await tempOutDir();
    const paths = ["/", "/issue", "/fixed", "/changed", "/part", "/unreviewed"];
    const run = await sealedRun(
      siteDir,
      { id: "2026-09-26_1405", pages: paths.map((each) => ({ path: each })), resumedWith: [{}] },
      (record) => {
        const [first, second] = record.sessions;
        const answered = (answer: "all" | "part", at: string) => ({
          answer,
          askedAt: at,
          answeredAt: at,
        });
        Object.assign(first ?? {}, {
          reviewer: { name: CHRIS, source: "option" },
          listener: answered("all", "2026-09-26T15:00:00.000-05:00"),
        });
        Object.assign(second ?? {}, {
          reviewer: { name: PAT, source: "option" },
          listener: answered("part", "2026-09-26T17:00:00.000-05:00"),
        });
        const part = record.pages.find((page) => page.url.endsWith("/part"));
        if (part) part.session = 2;
      },
    );
    await addReview(siteDir, run, "/", "reviewed", { reviewer: CHRIS });
    await addReview(siteDir, run, "/issue", "issue", {
      reviewer: CHRIS,
      note: "The search box has no name.",
    });
    await addReview(siteDir, run, "/fixed", "issue", { reviewer: CHRIS, note: "No skip link." });
    await addReview(siteDir, run, "/fixed", "fixed", {
      reviewer: CHRIS,
      at: "2026-09-26T17:30:00-05:00",
    });
    // A review of other transcripts than the ones shown.
    const other: RunJson = {
      ...run,
      pages: run.pages.map((page) =>
        page.url.endsWith("/changed")
          ? { ...page, passes: { read: { ...page.passes.read!, contentSha256: "0".repeat(64) } } }
          : page,
      ),
    };
    await addReview(siteDir, other, "/changed", "reviewed", { reviewer: CHRIS });
    await addManualSession(siteDir, "/", "2026-09-25_2358", { reviewer: SAM });

    const { pages } = buildShareModel(await loadShareInput({ siteDir, config: DEFAULT_CONFIG }));

    const live = `Heard live by ${CHRIS}`;
    expect(Object.fromEntries(pages.map((card) => [card.path, card.reviewChips]))).toEqual({
      "/": [live, "Reviewed, no issues"],
      "/issue": [live, "Issue found"],
      "/fixed": [live, "Fixed"],
      "/changed": [live, "Reviewed, no issues", "Changed since review"],
      "/part": [`${PAT} heard part of this session`],
      "/unreviewed": [live],
    });
    expect(pages.map((card) => card.manual)).toEqual([
      [{ at: "25 September 2026", reviewer: SAM }],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(pages.map((card) => card.needsAttention)).toEqual([
      false,
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  it("says a review of a page with flags as a check, with who made it and when, and a clean page's as before", () => {
    const flagged = (path: string): SharePageSpec => ({
      path,
      passes: { read: ["One", "Two"] },
      flags: [LINK_FLAG],
    });
    // A read that stopped at its step cap, which the rules flag, and with a flag of another rule too.
    const stopped = (path: string, flags: FlagResult[]): SharePageSpec => ({
      path,
      passes: { read: ["One", "Two"] },
      stopped: { read: "step-cap" },
      flags,
    });
    const run = shareRun({
      id: "r1",
      pages: [
        flagged("/checked"),
        flagged("/checked-by-pat"),
        { path: "/clean", passes: { read: ["One", "Two"] } },
        flagged("/changed"),
        flagged("/issue"),
        flagged("/fixed"),
        flagged("/unreviewed"),
        stopped("/stopped", [NOT_FINISHED]),
        stopped("/stopped-and-flagged", [NOT_FINISHED, LINK_FLAG]),
      ],
    });
    // A review of the page as the run shows it, unless `content` says it saw other transcripts.
    const entryOf = (
      path: string,
      status: ReviewStatus,
      options: { reviewer?: string; at?: string; content?: ReviewEntry["content"] } = {},
    ): [key: string, entry: ReviewEntry] => {
      const page = run.pages.find((candidate) => new URL(candidate.url).pathname === path);
      if (page === undefined) throw new Error(`No page ${path}`);
      return [
        page.key,
        {
          status,
          reviewer: options.reviewer ?? CHRIS,
          at: options.at ?? "2026-10-06T14:00:00-05:00",
          note: null,
          run: run.id,
          url: page.url,
          files: {},
          content:
            options.content ??
            Object.fromEntries(
              Object.entries(page.passes).map(([pass, summary]) => [pass, summary.contentSha256]),
            ),
        },
      ];
    };
    const reviews: ReviewsFile = {
      schemaVersion: 1,
      pages: Object.fromEntries(
        [
          entryOf("/checked", "reviewed"),
          entryOf("/checked-by-pat", "reviewed", {
            reviewer: PAT,
            at: "2026-10-05T09:30:00-05:00",
          }),
          entryOf("/clean", "reviewed"),
          // The transcripts changed since the review: it checked other words than these.
          entryOf("/changed", "reviewed", { content: { read: "0".repeat(64) } }),
          entryOf("/issue", "issue"),
          entryOf("/fixed", "fixed"),
          entryOf("/stopped", "reviewed"),
          entryOf("/stopped-and-flagged", "reviewed"),
        ].map(([key, entry]) => [key, [entry]]),
      ),
    };

    const { pages } = buildShareModel(
      inputOf([run], { reviews, generatedAt: "2026-10-07T09:00:00-05:00" }),
    );

    expect(Object.fromEntries(pages.map((card) => [card.path, card.reviewChips]))).toEqual({
      // A review after the run that raised a page's flags checks them.
      "/checked": ["Checked by Christopher Schweda, 6 October 2026: not an issue"],
      "/checked-by-pat": ["Checked by Pat Lee, 5 October 2026: not an issue"],
      // Nothing to check on a page with no flags.
      "/clean": ["Reviewed, no issues"],
      // A review of other transcripts checks nothing of these.
      "/changed": ["Reviewed, no issues", "Changed since review"],
      "/issue": ["Issue found"],
      "/fixed": ["Fixed"],
      "/unreviewed": [],
      // A review doesn't settle a read that stopped before the page's end: a page whose only flag
      // is that one has none to check. With another flag, the review checks that one.
      "/stopped": ["Reviewed, no issues"],
      "/stopped-and-flagged": ["Checked by Christopher Schweda, 6 October 2026: not an issue"],
    });
  });

  it("shows a failed page's failure beside its older transcripts, and checks those", async () => {
    const model = await demoModel();
    const card = model.pages.find((page) => page.slug === HOW);

    expect(card).toMatchObject({
      path: "/how-a-run-works/",
      status: "failed",
      statusText: "Failed in run 2026-09-29_1402 · transcribed in run 2026-09-29_1315",
      from: { run: "2026-09-29_1315", date: "29 September 2026" },
      failure: "During the headings pass, another window took the screen.",
      counts: { read: 18, headings: 4, tab: 3 },
      timeMs: 51_507,
      needsAttention: true,
    });
    expect(card?.strip).toHaveLength(18);
    // The fingerprint check holds that run's three transcripts of the page, exactly as on disk,
    // and both runs' records.
    expect(model.check.files.filter((file) => file.slug === HOW)).toEqual(
      TRANSCRIPTS.map((name) => ({
        run: "2026-09-29_1315",
        slug: HOW,
        name,
        text: demoFile("1315", HOW, name),
      })),
    );
    expect(model.check.files).toHaveLength(21);
    expect(model.check.runs).toEqual([demoRun("1315"), demoRun("1402")]);
    // The appendix shows them, with that run's fingerprints.
    const recorded = demoRun("1315").pages.find((page) => page.slug === HOW)?.files ?? {};
    expect(model.appendix.find((page) => page.slug === HOW)?.files).toMatchObject(
      TRANSCRIPTS.map((name) => ({ name, sha256: recorded[name]?.sha256 })),
    );
  });

  it("says what runs from 0.4.1 didn't record", async () => {
    const model = await demoModel();

    expect(model.evidence.map((each) => each.run.id)).toEqual([
      "2026-09-29_1402",
      "2026-09-29_1315",
    ]);
    for (const each of model.evidence) {
      const rows = new Map(each.environment.map((row) => [row.label, row.value]));
      for (const label of COMPUTER) expect(rows.get(label)).toBe(BEFORE_0_6);
      // Every version recorded the operating system as a line of text.
      expect(rows.get("Operating system")).toBe("Windows 11 Pro 25H2 (10.0.26200)");
      expect(rows.get("Run by")).toBe(BEFORE_0_6);
      expect(each.timeline).toEqual({ notRecorded: BEFORE_0_6 });
      expect(each.nvdaLog).toEqual({ notRecorded: BEFORE_0_6 });
      const facts = new Map(each.facts.map((fact) => [fact.label, fact.value]));
      for (const label of ["NVDA restarts", "Run by", "Whether NVDA was heard"]) {
        expect(facts.get(label)).toBe(BEFORE_0_6);
      }
    }
    for (const card of model.pages) {
      expect(card.title).toEqual({ notRecorded: BEFORE_0_6 });
      expect(card.screenshot).toEqual({ notRecorded: BEFORE_0_6 });
    }
  });

  it("says no live run counts yet, and lists what it left out", async () => {
    const siteDir = await tempOutDir();
    await writeSyntheticRun(siteDir, {
      id: "2026-09-26_1405",
      replayed: true,
      pages: [{ path: "/" }],
    });
    const model = buildShareModel(await loadShareInput({ siteDir, config: DEFAULT_CONFIG }));

    expect(model.pages).toEqual([]);
    expect(model.leftOut).toEqual([
      {
        id: "2026-09-26_1405",
        text: "2026-09-26_1405: replayed, so it never counts as a live result",
      },
    ]);
    expect(model.summary.sentence).toBe(
      "No live run counts yet: voicecap shows only completed, sealed runs with a real screen reader.",
    );
    expect(model.header).toMatchObject({
      name: "example.illinois.gov",
      site: SITE,
      siteName: null,
      tested: null,
      testedAt: null,
      preparedBy: null,
      screenReader: "NVDA",
      readFrom: null,
    });
    expect(model).toMatchObject({
      heard: null,
      changes: null,
      noLongerListed: [],
      evidence: [],
      appendix: [],
      check: { runs: [], files: [], screenshots: [], reviews: null },
      coverage: {
        covered: ["No live run counts yet, so these results cover no pages."],
        limits: [],
      },
    });
  });

  it("names each change of tools between the runs it draws on", () => {
    const tools = (version: string): Partial<EnvironmentRecord> => ({
      screenReader: { name: "NVDA", version, build: `0.2.1-${version}`, language: "en" },
    });
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      sessions: [{ environment: tools("2026.1") }],
      pages: [{ path: "/" }],
    });
    const latest = shareRun({
      id: "r2",
      sessions: [{ environment: tools("2026.2") }],
      pages: [{ path: "/" }],
    });
    const { coverage } = buildShareModel(inputOf([earlier, latest]));

    const [change] = describeChanges(
      earlier.sessions[0]!.environment!,
      latest.sessions[0]!.environment!,
    );
    expect(change).toBe(
      "Screen reader differs: NVDA 2026.1 (build 0.2.1-2026.1) → NVDA 2026.2 (build 0.2.1-2026.2)",
    );
    expect(coverage.limits).toEqual([
      "Results come from NVDA 2026.2 (en) and Chrome 141.0.7390.55.",
      "Flags match NVDA's English phrasing, and the person reviewing decides what they mean.",
      `${change} (run r1 → run r2).`,
    ]);

    // A run resumed with other tools says so too.
    const resumed = shareRun({
      id: "r3",
      sessions: [{ environment: tools("2026.1") }, { environment: tools("2026.2") }],
      pages: [{ path: "/" }],
    });
    expect(buildShareModel(inputOf([resumed])).coverage.limits).toContain(
      `${change} (during run r3).`,
    );
  });

  it("lists every run it left out, with what each did", async () => {
    expect((await demoModel()).leftOut).toEqual([
      { id: "2026-09-29_1415", text: "2026-09-29_1415: interrupted after 1 of 7 pages" },
      { id: "2026-09-29_1419", text: "2026-09-29_1419: interrupted after 2 of 7 pages" },
    ]);

    const unsealed = shareRun({ id: "r1", sealed: false, pages: [{ path: "/" }] });
    const unfinished = shareRun({
      id: "r2",
      status: "incomplete",
      endReason: "error",
      pages: [{ path: "/" }, { path: "/a", status: "pending" }],
    });
    expect(buildShareModel(inputOf([unsealed, unfinished])).leftOut).toEqual([
      { id: "r1", text: "r1: completed without a seal (recorded before voicecap sealed runs)" },
      { id: "r2", text: "r2: not finished: 1 of 2 pages" },
    ]);
    // voicecap seals every run it completes from 0.3.0 on: an unsealed one from then has no such
    // reason to give.
    const sinceSeals = shareRun({
      id: "r3",
      sealed: false,
      voicecapVersion: "0.5.0",
      pages: [{ path: "/" }],
    });
    expect(buildShareModel(inputOf([sinceSeals])).leftOut).toEqual([
      { id: "r3", text: "r3: completed without a seal" },
    ]);
  });

  it("checks its own fingerprints, and finds everything matching, as the page will", async () => {
    const demoChecked = await check((await demoModel()).check);
    expect(demoChecked.line).toBe(
      "21 of 21 transcripts match their fingerprints, and both runs' seals check out",
    );
    expect(demoChecked.files.every((file) => file.ok)).toBe(true);

    // A site folder written as voicecap writes one, with reviews sealed and chained.
    const siteDir = await tempOutDir();
    const earlier = await sealedRun(siteDir, {
      id: "2026-09-25_1000",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [{ path: "/" }, { path: "/a" }],
    });
    const latest = await sealedRun(siteDir, {
      id: "2026-09-26_1405",
      pages: [{ path: "/" }, { path: "/a", status: "failed", errors: ["Timed out"] }],
    });
    await addReview(siteDir, latest, "/", "reviewed");
    await addReview(siteDir, earlier, "/a", "issue", { note: "No skip link." });
    const model = buildShareModel(await loadShareInput({ siteDir, config: DEFAULT_CONFIG }));

    expect(model.check.files.map((file) => [file.run, file.slug, file.name])).toEqual([
      ...TRANSCRIPTS.map((name) => ["2026-09-26_1405", "home", name]),
      ...TRANSCRIPTS.map((name) => ["2026-09-25_1000", "a-7774d4bf1f", name]),
    ]);
    expect(model.check.reviews).not.toBeNull();
    const siteChecked = await check(model.check);
    expect(siteChecked.line).toBe(
      "6 of 6 transcripts match their fingerprints, and both runs' seals check out, and the review entries' seals and chain check out",
    );
  });

  it("computes the shown flags with the current rules, and embeds the records as sealed", async () => {
    const siteDir = await tempOutDir();
    const run = await sealedRun(siteDir, {
      id: "2026-09-26_1405",
      pages: [{ path: "/", lines: { read: CLICK_HERE_LINES } }],
    });
    const model = buildShareModel(await loadShareInput({ siteDir, config: DEFAULT_CONFIG }));

    // The record has no flags: it was written before the rules found these.
    expect(run.pages[0]?.flags).toEqual([]);
    expect(model.pages[0]?.flags).toEqual([LINK_FLAG]);
    // The summary counts it by its rule, as the model computes it now.
    expect(model.summary.bars.flagsByRule).toEqual([{ rule: "generic-link-text", count: 1 }]);
    // The record is embedded exactly as on disk, so its seal still checks out.
    const onDisk = JSON.parse(readFileSync(runJsonPath(siteDir, run.id), "utf8")) as RunJson;
    expect(model.check.runs).toEqual([onDisk]);
    expect(sealOf(onDisk)).toBe(onDisk.seal);
  });

  it("replaces the home folder in everything the page shows, and embeds the records unchanged", async () => {
    const home = os.homedir();
    const redact = (text: string) => redactHome(text, home, process.platform);
    const list = path.join(home, "sites", "pages.csv");
    const notes = path.join(home, "notes.txt");
    const config: VoicecapConfig = {
      ...DEFAULT_CONFIG,
      flags: {
        ...DEFAULT_CONFIG.flags,
        custom: [
          {
            id: "noted-text",
            description: `Text noted in ${notes}`,
            passes: ["read"],
            pattern: "^Some text",
            minCount: 1,
          },
        ],
      },
    };
    const siteDir = await tempOutDir();
    const run = await sealedRun(siteDir, {
      id: "2026-09-26_1405",
      source: { kind: "pages", file: list, sha256: "a".repeat(64) },
      pages: [{ path: "/" }],
    });
    await addReview(siteDir, run, "/", "issue", { note: `As noted in ${notes}` });
    const model = buildShareModel(await loadShareInput({ siteDir, config }));

    expect(model.coverage.covered[0]).toBe(`1 page from the page list ${redact(list)}.`);
    expect(model.pages[0]?.flags.map((flag) => flag.message)).toEqual([
      `Text noted in ${redact(notes)} (1 match in the read pass).`,
    ]);
    // The issue's card carries the reviewer's note with the home folder replaced.
    expect(model.attention[0]).toMatchObject({ kind: "issue" });
    expect(model.attention[0]?.pages[0]?.detail).toContain(`As noted in ${redact(notes)}`);
    // Nothing the page shows holds the home folder. The records, review entries, and transcripts it
    // carries for the fingerprint check are exactly as recorded, since a seal covers every field.
    expect(stringsIn(shown(model)).filter(mentionsHome)).toEqual([]);
    // That includes the walkthrough file it offers, which keeps the page list by its name alone.
    const offered = fileBytes(downloadOf(latestEvidence(model))).toString("utf8");
    expect(parseWalkthrough(offered, "w.json").original.source).toEqual({
      kind: "pages",
      file: "pages.csv",
      sha256: "a".repeat(64),
    });
    expect(mentionsHome(offered)).toBe(false);
    expect(model.check.runs[0]?.settings.source).toEqual({
      kind: "pages",
      file: list,
      sha256: "a".repeat(64),
    });
    expect(Object.values(model.check.reviews ?? {}).flat()).toMatchObject([
      { note: `As noted in ${notes}` },
    ]);
  });

  it("replaces the home folder in the name of a custom rule's card, on a page flagged with no issue", () => {
    const home = os.homedir();
    const redact = (text: string) => redactHome(text, home, process.platform);
    const notes = path.join(home, "notes.txt");
    // The description is the person's own words in the config, and may hold the home folder.
    const flagRules = {
      ...DEFAULT_CONFIG.flags,
      custom: [
        {
          id: "noted-text",
          description: `Text noted in ${notes}`,
          passes: ["read" as const],
          pattern: "^Some text",
          minCount: 1,
        },
      ],
    };
    const flag: FlagResult = {
      rule: "noted-text",
      pass: "read",
      count: 1,
      message: `Text noted in ${notes} (1 match in the read pass).`,
    };
    const lines = { read: ["Some text on the page."] };
    const run = shareRun({ id: "r1", pages: [{ path: "/", passes: lines, flags: [flag] }] });

    const model = buildShareModel(inputOf([run], { flagRules, transcripts: storeOf(() => lines) }));

    // The page has the rule's card, named by its description with the home folder replaced, as the
    // flag's message is, and its title says it so.
    expect(model.attention.map((card) => [card.kind, card.subject])).toEqual([
      ["custom", `Text noted in ${redact(notes)}`],
    ]);
    expect(model.attention.map((card) => attentionWords(card).title)).toEqual([
      `Text noted in ${redact(notes)}`,
    ]);
    expect(redact(notes)).not.toBe(notes);
    // Nothing the page shows holds the home folder.
    expect(stringsIn(shown(model)).filter(mentionsHome)).toEqual([]);
  });

  it("hears the home page three ways, with how long each line took", async () => {
    const { heard } = await demoModel();

    // The read pass's first two steps, Ctrl+End and Ctrl+Home, set the pass up: they aren't lines.
    // Each line took 1.27 to 1.32 seconds: voicecap waits for NVDA to be quiet after each key.
    expect(heard).toEqual({
      page: "http://127.0.0.1:4848/",
      passes: [
        {
          pass: "read",
          lines: [
            { text: "banner landmark, voicecap demo", took: "1.3 s" },
            {
              text: "Tour, navigation landmark, list, with 1 item, link, Next: Before you start",
              took: "1.3 s",
            },
            {
              text: "out of list, main landmark, heading, level 1, Welcome to the voicecap demo",
              took: "1.3 s",
            },
          ],
        },
        {
          pass: "headings",
          lines: [
            {
              text: "main landmark, Welcome to the voicecap demo, heading, level 1",
              took: "1.3 s",
            },
            { text: "The tour's pages, heading, level 2", took: "1.3 s" },
            { text: "no next heading", took: "1.3 s" },
          ],
        },
        {
          pass: "tab",
          lines: [
            { text: "Skip to main content, same page, link", took: "1.3 s" },
            {
              text: "Tour, navigation landmark, list, with 1 item, Next: Before you start, link",
              took: "1.3 s",
            },
            { text: "main landmark, list, with 6 items, Before you start, link", took: "1.3 s" },
          ],
        },
      ],
    });
  });

  // The sample follows the rule a card's Heard first follows: a pass's lines are quoted only when
  // that pass's TXT can be read here, since the page shows that file and nothing else of it.
  describe("hears the home page only in the passes whose TXT can be read here", () => {
    it("leaves out a pass whose TXT can't be read, though its steps can, and keeps the others in order", () => {
      const transcripts = withoutTxt(storeOf(), (_slug, pass) => pass === "headings");
      const model = homeModel(transcripts);

      // The headings pass's steps are there to read: it is the file the page shows that is not.
      expect(transcripts.steps("r1", HOME, "headings")).not.toBeNull();
      expect(transcripts.txt("r1", HOME, "headings")).toBeNull();
      expect(model.heard?.passes.map(({ pass }) => pass)).toEqual(["read", "tab"]);
      expect(model.heard?.passes.map(({ lines }) => lines.length)).toEqual([3, 2]);
    });

    it("has no sample when no pass's TXT can be read, as a page with nothing to quote has none", () => {
      const transcripts = withoutTxt(storeOf());
      const model = homeModel(transcripts);

      expect(transcripts.steps("r1", HOME, "read")).not.toBeNull();
      expect(model.heard).toBeNull();
    });

    it("agrees with the home page's card: no lines of the read pass in one when the other has none", () => {
      const lost = homeModel(withoutReadTxt(storeOf()));
      const whole = homeModel();

      expect(lost.pages[0]?.heardFirst).toEqual([]);
      expect(lost.heard?.passes.map(({ pass }) => pass)).toEqual(["headings", "tab"]);
      expect(whole.pages[0]?.heardFirst).toEqual(LINES.read.slice(0, 3));
      expect(whole.heard?.passes[0]).toEqual({
        pass: "read",
        lines: LINES.read.slice(0, 3).map((text) => ({ text, took: "1.2 s" })),
      });
    });
  });

  it("quotes NVDA's own words in each card, from the lines of the demo's transcripts that raised its flags", async () => {
    const model = await demoModel();
    const said = ({ places }: AttentionCard) =>
      places.flatMap((place) => place.said.map(({ pass, line }) => `${pass}: ${line}`));

    // The demo's flags are all on the one page, and the one page that couldn't be read has a card of
    // its own, with no line to quote.
    expect(model.attention.map(({ pages }) => pages.map((page) => page.slug))).toEqual([
      [COMMON],
      [COMMON],
      [COMMON],
      [COMMON],
      ["how-a-run-works-fd116f9328"],
    ]);
    expect(model.attention.map((card) => [card.id, card.kind, card.subject, said(card)])).toEqual([
      // Not the browser's own "Tab search, button" after focus left the page: no rule hears it.
      ["need-1", "button-unnamed", null, ["read: button", "tab: button"]],
      ["need-2", "field-unlabeled", "edit", ["tab: main landmark. edit, blank"]],
      [
        "need-3",
        "link-generic",
        "click here",
        ["read: To see how a run works,, link, click here, dot", "tab: click here, link"],
      ],
      [
        "need-4",
        "first-heading",
        null,
        ["headings: main landmark, Common mistakes (on purpose), heading, level 2"],
      ],
      ["need-5", "unread", null, []],
    ]);
  });

  it("gives the summary the problems of its cards and the pages they're on, and each card its title", async () => {
    const model = await demoModel();

    // The demo's five cards: four on /common-mistakes/, and the page the latest run couldn't read.
    expect(model.attention.map((card) => card.id)).toEqual([
      "need-1",
      "need-2",
      "need-3",
      "need-4",
      "need-5",
    ]);
    expect(model.attention.map((card) => attentionWords(card).title)).toEqual([
      'A button is read only as "button": likely an icon button with no name',
      'A form field is read only as "edit": likely a missing label',
      'Links read as "click here": link text that doesn\'t say where it goes',
      "The first heading is level 2, not 1: likely a missing <h1>",
      "A page the latest run couldn't read",
    ]);
    expect(model.summary.attention).toEqual({ problems: 5, pages: 2 });
    // The sentence counts no problems: the verdict does, every card (see `result`, below).
    expect(model.summary.sentence).toBe("NVDA read all 7 pages.");
  });

  it("carries the result its copies say, and the ring's three parts", async () => {
    const model = await demoModel();

    // What `voicecap share` records for the website's card: the summary's counts, every card among
    // the problems.
    expect(model.result).toEqual({ pages: 7, read: 7, problems: 5, problemPages: 2 });
    expect(model.result).toEqual({
      pages: model.summary.numbers.pagesInScope,
      read: model.summary.numbers.transcribed,
      problems: model.summary.attention.problems,
      problemPages: model.summary.attention.pages,
    });
    // /common-mistakes/ and /how-a-run-works/ (which the latest run couldn't read, though an earlier
    // run's transcripts are shown) are on a card; the other five pages have no problem.
    expect(model.ring).toEqual({ noProblems: 5, needAttention: 2, notRead: 0 });
    const { noProblems, needAttention, notRead } = model.ring;
    expect(noProblems + needAttention + notRead).toBe(model.result.pages);
    expect(verdictOf(model.result)).toEqual({
      kind: "warn",
      headline: "5 problems need attention, on 2 pages",
    });
  });

  it("has an empty result and an empty ring when no run counts", () => {
    const replay = shareRun({ id: "r1", replayed: true, pages: [{ path: "/" }] });
    const model = buildShareModel(inputOf([replay]));

    expect(model.header.tested).toBeNull();
    expect(model.result).toEqual({ pages: 0, read: 0, problems: 0, problemPages: 0 });
    expect(model.ring).toEqual({ noProblems: 0, needAttention: 0, notRead: 0 });
  });

  it("counts a page never read as not read, and each other page once, by whether a card is on it", () => {
    // /never failed in the latest run and no run transcribed it, so it has no transcripts, though
    // its failure is on a card of its own; /flagged is read, with a problem on a card.
    const run = shareRun({
      id: "r1",
      pages: [
        { path: "/", files: TRANSCRIPTS, passes: LINES },
        { path: "/flagged", files: TRANSCRIPTS, passes: LINES, flags: [LINK_FLAG] },
        { path: "/never", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
      ],
    });
    const model = buildShareModel(inputOf([run], { transcripts: storeOf() }));

    expect(model.pages.map((card) => [card.path, card.counts === null])).toEqual([
      ["/", false],
      ["/flagged", false],
      ["/never", true],
    ]);
    expect(model.attention.map(({ kind }) => kind).sort()).toEqual(["link-generic", "unread"]);
    // The page that was never read is on a card, and is counted as not read, not twice.
    expect(model.ring).toEqual({ noProblems: 1, needAttention: 1, notRead: 1 });
    expect(model.result).toEqual({ pages: 3, read: 2, problems: 2, problemPages: 2 });
    expect(verdictOf(model.result).kind).toBe("bad");
  });

  it("counts a page whose latest run failed but whose earlier transcripts are shown as needing attention, not as not read", () => {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [{ path: "/", files: TRANSCRIPTS, passes: LINES }],
    });
    const latest = shareRun({
      id: "r2",
      pages: [{ path: "/", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] }],
    });
    const model = buildShareModel(inputOf([earlier, latest], { transcripts: storeOf() }));

    // The page has transcripts (from run r1), so NVDA read it; the latest run couldn't, which is a
    // problem on a card.
    expect(model.ring).toEqual({ noProblems: 0, needAttention: 1, notRead: 0 });
    expect(model.result).toEqual({ pages: 1, read: 1, problems: 1, problemPages: 1 });
    expect(verdictOf(model.result).kind).toBe("warn");
  });

  describe("gives each card the first three lines NVDA said on it", () => {
    it("is the first lines of the read pass the transcript carries, after the two steps that set it up", async () => {
      const model = await demoModel();
      const home = model.pages.find((card) => card.slug === HOME);
      const read = model.appendix
        .find((page) => page.slug === HOME)
        ?.files.find((file) => file.pass === "read");
      const lines = read?.text.split("\n") ?? [];

      // The read pass's first two steps, Ctrl+End and Ctrl+Home, set the pass up: they are lines of
      // the transcript, and not what NVDA said as it read the page.
      expect(lines.slice(0, 2)).toEqual([
        "[to bottom] content info landmark, This demo site comes with voicecap, and runs only on this computer.",
        "[to top] same page, link, Skip to main content",
      ]);
      expect(home?.heardFirst).toEqual([
        "banner landmark, voicecap demo",
        "Tour, navigation landmark, list, with 1 item, link, Next: Before you start",
        "out of list, main landmark, heading, level 1, Welcome to the voicecap demo",
      ]);
      expect(lines.slice(2, 5)).toEqual(home?.heardFirst);
    });

    it("gives every demo page that has a read transcript its first three lines", async () => {
      const model = await demoModel();

      for (const card of model.pages) {
        const lines =
          model.appendix
            .find((page) => page.slug === card.slug)
            ?.files.find((file) => file.pass === "read")
            ?.text.split("\n") ?? [];
        expect(card.heardFirst, card.name).toHaveLength(3);
        expect(lines.slice(2, 5), card.name).toEqual(card.heardFirst);
      }
    });

    // A page of the example site by its path, to give its transcripts lines of their own.
    const slugOf = (path: string) => pageSlug(canonicalKey(new URL(path, SITE).href));

    it("gives what a page has when its read pass has fewer lines, and none for a page with no transcripts", () => {
      const run = shareRun({
        id: "r1",
        pages: [
          { path: "/long", files: TRANSCRIPTS, passes: LINES },
          { path: "/two", files: TRANSCRIPTS, passes: { read: ["One", "Two"] } },
          { path: "/one", files: TRANSCRIPTS, passes: { read: ["Only"] } },
          { path: "/never", status: "failed", failedAttempts: [failedAttempt({ n: 1 })] },
        ],
      });
      const own: Record<string, Lines> = {
        [slugOf("/two")]: { read: ["One", "Two"] },
        [slugOf("/one")]: { read: ["Only"] },
      };
      const { pages } = buildShareModel(
        inputOf([run], { transcripts: storeOf((slug) => own[slug] ?? LINES) }),
      );

      expect(pages.map((card) => [card.path, card.heardFirst])).toEqual([
        ["/long", LINES.read.slice(0, 3)],
        ["/two", ["One", "Two"]],
        ["/one", ["Only"]],
        ["/never", []],
      ]);
    });

    it("gives none for a page whose read transcript can't be read here, or that was skipped", () => {
      const run = shareRun({
        id: "r1",
        pages: [
          // Read, but only its headings transcript can be read here.
          { path: "/lost", files: TRANSCRIPTS, passes: LINES },
          { path: "/skipped", status: "skipped" },
        ],
      });
      const own: Record<string, Lines> = { [slugOf("/lost")]: { headings: LINES.headings } };
      const { pages } = buildShareModel(
        inputOf([run], { transcripts: storeOf((slug) => own[slug] ?? LINES) }),
      );

      expect(pages.map((card) => [card.path, card.counts === null, card.heardFirst])).toEqual([
        ["/lost", false, []],
        ["/skipped", true, []],
      ]);
    });

    // The card's fold shows the read transcript's TXT, and says so when it can't be read: the lines
    // it quotes are of that transcript, so with the TXT unreadable there are none to quote, though
    // the steps in the read pass's JSON can still be read.
    it("gives none for a page whose read TXT can't be read, though its read JSON can", () => {
      const run = shareRun({
        id: "r1",
        pages: [
          { path: "/split", files: TRANSCRIPTS, passes: LINES },
          { path: "/whole", files: TRANSCRIPTS, passes: LINES },
        ],
      });
      const transcripts = withoutReadTxt(storeOf(), (slug) => slug === slugOf("/split"));
      const model = buildShareModel(inputOf([run], { transcripts }));

      // The steps are there: the card still counts and draws what NVDA said, from its JSON.
      expect(transcripts.steps("r1", slugOf("/split"), "read")).not.toBeNull();
      expect(model.pages.map((card) => [card.path, card.heardFirst])).toEqual([
        ["/split", []],
        ["/whole", LINES.read.slice(0, 3)],
      ]);
      // And the fold says the read transcript couldn't be read, where the other page shows it.
      expect(model.appendix.map((entry) => [entry.slug, entry.unreadable])).toEqual([
        [slugOf("/split"), ["read"]],
        [slugOf("/whole"), []],
      ]);
    });

    it("takes the lines as the transcript writes them, not the steps that set the pass up", () => {
      const step = (n: number, command: StepRecord["command"], spoken: string): StepRecord => ({
        n,
        command,
        spoken,
        durationMs: 1200,
        offsetMs: n * 1200,
      });
      const run = shareRun({
        id: "r1",
        pages: [{ path: "/", files: TRANSCRIPTS, passes: LINES }],
      });
      const steps = [
        step(1, "toBottom", "content info landmark, End"),
        step(2, "toTop", "banner landmark"),
        // On two lines; a transcript's line is one line.
        step(3, "nextLine", 'heading, level 1,\nTerms & <conditions> "apply"'),
        step(4, "nextLine", ""),
        step(5, "nextLine", "  link, Back  "),
        step(6, "nextLine", "never reached: only three are kept"),
      ];
      const transcripts: TranscriptStore = {
        // The read transcript's TXT is there, as the transcript writes these steps: it is what the
        // card's fold shows, and the card quotes it only when it can be read.
        txt: (_run, slug, pass) =>
          pass === "read" ? txtOf(slug, pass, bodyLines({ pass, steps })) : null,
        steps: (_run, _slug, pass) => (pass === "read" ? steps : null),
      };
      const [card] = buildShareModel(inputOf([run], { transcripts })).pages;

      // As the page will draw them: the words themselves, not escaped here.
      expect(card?.heardFirst).toEqual([
        'heading, level 1, Terms & <conditions> "apply"',
        "[no speech]",
        "link, Back",
      ]);
    });
  });

  it("counts the lines NVDA spoke, and how long the runs it draws on held NVDA", async () => {
    const { summary } = await demoModel();

    // 177 lines from run 1402's six pages, and 27 from run 1315's /how-a-run-works/.
    expect(summary.numbers.linesSpoken).toBe(204);
    // 13:15:48 to 13:21:59, and 14:02:51 to 14:09:14.
    expect(summary.numbers.nvdaMs).toBe(371_000 + 383_000);
    expect(summary.numbers.sessionsWithoutEnd).toBe(0);

    // A session that never recorded its end held NVDA for a time no record gives: it isn't counted,
    // and the page says so.
    const resumed = shareRun({
      id: "r1",
      sessions: [
        { startedAt: "2026-09-26T14:05:00-05:00", endReason: null },
        { startedAt: "2026-09-26T15:00:00-05:00", endedAt: "2026-09-26T15:10:00-05:00" },
      ],
      pages: [{ path: "/" }],
    });
    expect(buildShareModel(inputOf([resumed])).summary.numbers).toMatchObject({
      nvdaMs: 600_000,
      sessionsWithoutEnd: 1,
    });
  });

  it("covers the pages on the list and its passes, and says what limits the results", async () => {
    const { coverage } = await demoModel();

    expect(coverage).toEqual({
      covered: [
        "7 pages from the sitemap http://127.0.0.1:4848/sitemap.xml.",
        "3 passes on each page: line by line (Down Arrow), heading by heading (H), and control by control (Tab).",
        "Every problem during the runs is explained under Problems during the runs.",
      ],
      limits: [
        "Results come from NVDA 2026.2 (en-US) and Chrome 154.0.8037.58.",
        "Flags match NVDA's English phrasing, and the person reviewing decides what they mean.",
        "Browser differs: Chrome 153.0.8010.53 → Chrome 154.0.8037.58 (run 2026-09-29_1315 → run 2026-09-29_1402).",
      ],
    });
  });

  it("says when a page shown from an earlier run had fewer passes", () => {
    const quick = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      passes: ["read"],
      pages: [{ path: "/", passes: { read: ["Home"] } }],
    });
    const full = shareRun({
      id: "r2",
      pages: [
        { path: "/", status: "failed" },
        { path: "/a", passes: { read: ["A"], headings: ["A heading"], tab: ["A link"] } },
      ],
    });
    const { coverage, pages } = buildShareModel(inputOf([quick, full]));

    expect(coverage.covered[1]).toBe(
      "3 passes on each page, except 1 page shown from an earlier run, which had fewer: line by line (Down Arrow), heading by heading (H), and control by control (Tab).",
    );
    expect(pages[0]?.counts).toEqual({ read: 1, headings: null, tab: null });
  });

  it.each<[name: string, source: PageSource, from: string]>([
    [
      "a sitemap",
      { kind: "sitemap", url: "https://example.illinois.gov/sitemap.xml" },
      "the sitemap https://example.illinois.gov/sitemap.xml",
    ],
    [
      "a page list",
      { kind: "pages", file: "pages.csv", sha256: "a".repeat(64) },
      "the page list pages.csv",
    ],
    ["--page", { kind: "urls", urls: ["https://example.illinois.gov/a"] }, "the pages given"],
  ])("names the list the pages in scope came from: %s", (_name, source, from) => {
    const run = shareRun({ id: "r1", source, pages: [{ path: "/a" }, { path: "/b" }] });

    expect(buildShareModel(inputOf([run])).coverage.covered[0]).toBe(`2 pages from ${from}.`);
  });

  it("names a walkthrough run's pages as from the walkthrough, by its file and its run", () => {
    const run = shareRun({
      id: "2026-09-30_0900",
      source: {
        kind: "walkthrough",
        file: "w.json",
        sha256: "a".repeat(64),
        run: "2026-09-29_1402",
        from: "sitemap",
      },
      pages: [{ path: "/" }],
    });

    expect(buildShareModel(inputOf([run])).coverage.covered[0]).toBe(
      "1 page from the walkthrough w.json from run 2026-09-29_1402.",
    );
  });

  it("replaces the home folder in a walkthrough's file, as in a page list's", () => {
    const home = os.homedir();
    const file = path.join(home, "walks", "w.json");
    const run = shareRun({
      id: "2026-09-30_0900",
      source: {
        kind: "walkthrough",
        file,
        sha256: "a".repeat(64),
        run: "2026-09-29_1402",
        from: "sitemap",
      },
      pages: [{ path: "/" }],
    });

    const covered = buildShareModel(inputOf([run])).coverage.covered[0];

    expect(covered).toBe(
      `1 page from the walkthrough ${redactHome(file, home, process.platform)} from run 2026-09-29_1402.`,
    );
    expect(mentionsHome(covered ?? "")).toBe(false);
  });

  it("compares the latest run with the run before", async () => {
    const { changes } = await demoModel();

    expect(changes?.before.id).toBe("2026-09-29_1315");
    expect(changes?.after.id).toBe("2026-09-29_1402");
    expect(changes?.line).toBe("Every page read in full in both runs sounds exactly the same.");
  });

  it("shows every transcript word for word, with its size and fingerprint", async () => {
    const { appendix } = await demoModel();

    expect(appendix.map((page) => page.slug)).toEqual(
      demoRun("1402").pages.map((page) => page.slug),
    );
    const recorded = demoRun("1402").pages[0]?.files ?? {};
    expect(appendix[0]).toEqual({
      slug: HOME,
      name: "http://127.0.0.1:4848/",
      files: TRANSCRIPTS.map((name, index) => {
        const lines = extractBody(demoFile("1402", HOME, name));
        return {
          pass: ["read", "headings", "tab"][index],
          // Which of the check's files it is.
          run: "2026-09-29_1402",
          slug: HOME,
          name,
          text: lines.join("\n"),
          lines: lines.length,
          bytes: recorded[name]?.bytes,
          sha256: recorded[name]?.sha256,
        };
      }),
      unreadable: [],
    });
    expect(appendix[0]?.files.map((file) => file.lines)).toEqual([18, 3, 9]);
  });

  it("says which transcripts it couldn't read", async () => {
    const siteDir = await tempOutDir();
    const earlier = await sealedRun(siteDir, {
      id: "2026-09-25_1000",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [{ path: "/" }],
    });
    const latest = await sealedRun(siteDir, {
      id: "2026-09-26_1405",
      pages: [{ path: "/", lines: { read: ["A new first line.", ...defaultLines("/").read] } }],
    });
    await rm(path.join(pageDir(siteDir, earlier.id, HOME), "read.txt"));
    await rm(path.join(pageDir(siteDir, latest.id, HOME), "tab.txt"));
    const model = buildShareModel(await loadShareInput({ siteDir, config: DEFAULT_CONFIG }));

    // The run before's read transcript is gone, so the change can't be shown, only named.
    expect(model.changes?.changed).toMatchObject([
      { slug: HOME, passes: [], unreadable: ["read"] },
    ]);
    // The latest's Tab transcript is gone: the appendix says so, and the check can't count it.
    expect(model.appendix[0]?.files.map((file) => file.name)).toEqual(["read.txt", "headings.txt"]);
    expect(model.appendix[0]?.unreadable).toEqual(["tab"]);
    expect(model.check.files.map((file) => file.name)).toEqual(["read.txt", "headings.txt"]);
  });

  it("has no first lines for a page whose read.txt is gone but whose read.json is there", async () => {
    const siteDir = await tempOutDir();
    const run = await sealedRun(siteDir, {
      id: "2026-09-26_1405",
      pages: [{ path: "/" }, { path: "/about" }],
    });
    const [home, about] = run.pages;
    if (home === undefined || about === undefined) throw new Error("The run has no two pages.");
    await rm(path.join(pageDir(siteDir, run.id, about.slug), "read.txt"));

    const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });
    const model = buildShareModel(input);

    // The loader reads each file apart: /about's steps can be read, and its TXT, which its card's
    // fold shows, can't. The card quotes nothing from a transcript its fold says it couldn't read.
    expect(input.transcripts.steps(run.id, about.slug, "read")?.length).toBeGreaterThan(3);
    expect(input.transcripts.txt(run.id, about.slug, "read")).toBeNull();
    expect(model.pages.map((card) => [card.path, card.heardFirst.length])).toEqual([
      ["/", 3],
      ["/about", 0],
    ]);
    expect(model.appendix.map((entry) => [entry.slug, entry.unreadable])).toEqual([
      [home.slug, []],
      [about.slug, ["read"]],
    ]);
  });

  // The page folds each page's transcripts in its card, and has no other place for them, so a page
  // listed with transcripts but with no card would show them nowhere. Nothing on the page would say
  // so, and its fingerprint check wouldn't either: it compares only the transcripts the page shows.
  it("lists transcripts only for pages that have a card", async () => {
    // The demo's latest run failed /how-a-run-works/, which the run before read.
    const demo = await demoModel();
    // A run that failed a page an earlier run read (/b), and a page no run read (/c).
    const read = (pagePath: string): SharePageSpec => ({
      path: pagePath,
      files: TRANSCRIPTS,
      passes: LINES,
    });
    const failed = (pagePath: string): SharePageSpec => ({
      path: pagePath,
      status: "failed",
      failedAttempts: [failedAttempt({ n: 1 })],
    });
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [read("/a"), read("/b")],
    });
    const latest = shareRun({ id: "r2", pages: [read("/a"), failed("/b"), failed("/c")] });
    const model = buildShareModel(inputOf([earlier, latest], { transcripts: storeOf() }));

    for (const [name, each] of [
      ["the demo", demo],
      ["a latest run that failed a page", model],
    ] as const) {
      const cards = new Set(each.pages.map(({ slug }) => slug));

      expect(each.appendix.length, name).toBeGreaterThan(0);
      for (const { slug } of each.appendix) expect(cards.has(slug), `${name}: ${slug}`).toBe(true);
    }
    // /b keeps its older transcripts and its card; /c, which no run read, is a card with none.
    const [a, b] = model.pages.map(({ slug }) => slug);
    expect(model.pages.map(({ path: where }) => where)).toEqual(["/a", "/b", "/c"]);
    expect(model.appendix.map(({ slug }) => slug)).toEqual([a, b]);
  });

  it("marks a page whose flags are as its run recorded them, when a JSON transcript is gone", async () => {
    const siteDir = await tempOutDir();
    const run = await sealedRun(siteDir, {
      id: "2026-09-26_1405",
      pages: [{ path: "/" }, { path: "/about" }],
    });
    const about = run.pages[1]!;
    await rm(path.join(pageDir(siteDir, run.id, about.slug), "tab.json"));

    const model = buildShareModel(await loadShareInput({ siteDir, config: DEFAULT_CONFIG }));

    // The flags of /about couldn't be worked out with the current rules: its card says so.
    expect(model.pages.map((card) => [card.path, card.flagsAsRecorded])).toEqual([
      ["/", false],
      ["/about", true],
    ]);
  });

  it("lists a run whose record couldn't be read among the runs left out", async () => {
    const siteDir = await tempOutDir();
    await sealedRun(siteDir, { id: "2026-09-26_1405", pages: [{ path: "/" }] });
    const damaged = path.join(siteDir, "2026-09-25", "0900");
    await mkdir(damaged, { recursive: true });
    await writeFile(path.join(damaged, "run.json"), "{ not a whole record");
    // A folder with no record at all (as a manual session's is) isn't a run, and isn't listed.
    await mkdir(path.join(siteDir, "2026-09-25", "1000_manual_home"), { recursive: true });

    const model = buildShareModel(await loadShareInput({ siteDir, config: DEFAULT_CONFIG }));

    expect(model.leftOut).toEqual([
      { id: "2026-09-25_0900", text: "2026-09-25_0900: its record couldn't be read" },
    ]);
    expect(model.evidence.map((each) => each.run.id)).toEqual(["2026-09-26_1405"]);
  });

  it("replaces the home folder in the tools the two runs differ in", () => {
    // Written with forward slashes, which a setting's JSON keeps as they are (backslashes it
    // doubles), so the text can be searched for the folder.
    const home = os.homedir().replaceAll(path.sep, "/");
    const settings = (synth: string) => ({ screenReaderSettings: { speech: { synth } } });
    const before = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      sessions: [{ environment: settings(`${home}/synths/old`) }],
      pages: [{ path: "/", passes: { read: ["a"] } }],
    });
    const after = shareRun({
      id: "r2",
      sessions: [{ environment: settings(`${home}/synths/new`) }],
      pages: [{ path: "/", passes: { read: ["b"] } }],
    });

    const tools = buildShareModel(inputOf([before, after])).changes?.tools ?? [];

    expect(tools.join(" ")).toContain("speech.synth");
    expect(tools.filter(mentionsHome)).toEqual([]);
  });

  it("dates the page, and names who prepared it", async () => {
    const earlier = shareRun({
      id: "r1",
      createdAt: "2026-09-29T13:15:00-05:00",
      pages: [{ path: "/" }],
    });
    const latest = shareRun({
      id: "r2",
      createdAt: "2026-09-30T09:00:00-05:00",
      sessions: [{ reviewer: PAT }, { reviewer: CHRIS }],
      pages: [{ path: "/" }],
    });
    const model = buildShareModel(
      inputOf([earlier, latest], {
        generatedAt: "2026-10-01T08:30:00-05:00",
        fileName: "example.illinois.gov_2026-10-01.html",
        wordName: "example.illinois.gov_2026-10-01.docx",
      }),
    );

    // Every page's results are the latest run's: the run before is only compared with it, so its
    // day isn't a day these results were tested.
    expect(model.header).toEqual({
      name: "example.illinois.gov",
      site: SITE,
      siteName: null,
      tested: "30 September 2026",
      testedAt: "30 September 2026, 09:00",
      asOf: "1 October 2026",
      preparedBy: CHRIS,
      screenReader: "NVDA",
      readFrom: null,
    });
    expect(model.footer).toEqual({
      generatedAt: "2026-10-01T08:30:00-05:00",
      fileName: "example.illinois.gov_2026-10-01.html",
      wordName: "example.illinois.gov_2026-10-01.docx",
      offsets: ["UTC−05:00"],
    });
    expect(model.flagRulesSha256).toBe("f".repeat(64));

    // No name recorded for the latest run's last session: no one is named.
    const unnamed = shareRun({ id: "r3", pages: [{ path: "/" }] });
    expect(buildShareModel(inputOf([unnamed])).header.preparedBy).toBeNull();
    // The demo's runs were both on 29 September.
    expect((await demoModel()).header.tested).toBe("29 September 2026");
    // A page shown from the earlier run makes its day one of the days tested.
    const failedLater = shareRun({
      id: "r2",
      createdAt: "2026-09-30T09:00:00-05:00",
      pages: [{ path: "/", status: "failed" }],
    });
    expect(buildShareModel(inputOf([earlier, failedLater])).header.tested).toBe(
      "29 to 30 September 2026",
    );
  });

  it("names the page's file and its Word copy's, for the footer", () => {
    const run = shareRun({ id: "r1", pages: [{ path: "/" }] });

    expect(
      buildShareModel(
        inputOf([run], { fileName: "x_2026-09-30.html", wordName: "x_2026-09-30.docx" }),
      ).footer,
    ).toMatchObject({ fileName: "x_2026-09-30.html", wordName: "x_2026-09-30.docx" });
  });

  it("names each UTC offset the runs recorded their times in, for the footer", () => {
    // A run recorded in Chicago in September, and one recorded in New York, resumed in Chicago.
    const chicago = shareRun({
      id: "r1",
      createdAt: "2026-09-29T13:15:00-05:00",
      pages: [{ path: "/" }],
    });
    const travelled = shareRun({
      id: "r2",
      createdAt: "2026-09-30T09:00:00-04:00",
      sessions: [
        { startedAt: "2026-09-30T09:00:00-04:00" },
        { startedAt: "2026-09-30T10:00:00-05:00" },
      ],
      pages: [{ path: "/" }, { path: "/a", session: 2 }],
    });

    expect(buildShareModel(inputOf([chicago, travelled])).footer.offsets).toEqual([
      "UTC−05:00",
      "UTC−04:00",
    ]);
    // No run counts: no run's times to speak of.
    const replayed = shareRun({ id: "r3", replayed: true, pages: [{ path: "/" }] });
    expect(buildShareModel(inputOf([replayed])).footer.offsets).toEqual([]);
  });

  it("names the UTC offsets of the events its runs' logs recorded, for the footer", () => {
    // A run that went on past the end of daylight saving time: its log's later events are an hour
    // behind its record's times. A line whose time isn't a time names no offset.
    const run = shareRun({
      id: "r1",
      createdAt: "2026-11-01T01:40:00-05:00",
      pages: [{ path: "/" }],
    });
    const events = [
      { at: "2026-11-01T01:40:00.000-05:00", type: "run-started", session: 1, resumed: false },
      { at: "2026-11-01T01:05:00.000-06:00", type: "screen-reader-lock-released" },
      { at: "sometime-03:30", type: "computer-locked" },
    ] as RunEvent[];

    expect(
      buildShareModel(inputOf([run], { events: new Map([[run.id, { events, unreadable: 0 }]]) }))
        .footer.offsets,
    ).toEqual(["UTC−05:00", "UTC−06:00"]);
  });

  it("says what each run recorded: when, its pages, who ran it, what they said, and the computer", () => {
    // Completed a minute after its session ended, once the answer was kept (shareRun completes a
    // run as it starts). Nothing here checks the seal.
    const run: RunJson = {
      ...shareRun({
        id: "r1",
        createdAt: "2026-09-26T14:05:00-05:00",
        sessions: [
          {
            reviewer: CHRIS,
            listener: "all",
            endedAt: "2026-09-26T14:31:00-05:00",
            environment: { machine: MACHINE },
          },
        ],
        pages: [
          { path: "/", files: ["read.txt"] },
          { path: "/a" },
          { path: "/b", status: "failed" },
        ],
      }),
      completedAt: "2026-09-26T14:32:00-05:00",
    };
    const [evidence] = buildShareModel(inputOf([run])).evidence;

    expect(evidence?.facts).toEqual([
      { label: "Started", value: "26 September 2026, 14:05" },
      { label: "Finished", value: "26 September 2026, 14:32" },
      { label: "Pages", value: "2 transcribed and 1 failed" },
      { label: "Transcripts shown", value: "2 pages" },
      { label: "NVDA restarts", value: "Not recorded: this run used voicecap 0.1.0." },
      { label: "Run by", value: CHRIS },
      {
        label: "Whether NVDA was heard",
        value: `Yes, the whole time. Asked as the session ended, and answered at 14:31 by ${CHRIS}.`,
      },
    ]);
    const rows = new Map(evidence?.environment.map((row) => [row.label, row.value]));
    expect(
      Object.fromEntries(
        ["Run by", "Operating system", ...COMPUTER].map((label) => [label, rows.get(label)]),
      ),
    ).toEqual({
      "Run by": CHRIS,
      "Operating system": "Windows 11 Pro 25H2, build 10.0.26200.9550, x64",
      Processor: "Intel Core Ultra 7 265F, 2.40 GHz base, 20 cores, 20 logical processors",
      Memory: "31.7 GB",
      Display: "3440 × 1440 at 59 Hz, 110% scaling",
      "Browser window": "1280 × 960",
      "Time zone": "America/Chicago (UTC-05:00 as the session started)",
      "Display language": "en-US",
      Software: "Node.js 24.19.0, voicecap 0.6.0, Guidepup 0.34.0, Playwright 1.63.0",
    });
    expect(rows.get("Screen reader")).toBe("NVDA 2026.2 (build 0.2.1-2026.2, language en)");
    expect(evidence?.fingerprints).toEqual([
      { page: "/", file: "read.txt", bytes: 1, sha256: "0".repeat(64) },
    ]);
    // It checks every site in the home, so it names none.
    expect(evidence?.verify).toBe("npx @icjia/voicecap verify");
  });

  it("gives each session's statement, and says when a session ended without one", () => {
    const resumed = shareRun({
      id: "r1",
      sessions: [
        { reviewer: null, environment: { machine: MACHINE } },
        {
          reviewer: PAT,
          listener: "part",
          endedAt: "2026-09-26T16:20:00-05:00",
          environment: { machine: MACHINE },
        },
      ],
      pages: [{ path: "/" }],
    });
    const [evidence] = buildShareModel(inputOf([resumed])).evidence;

    expect(evidence?.facts.slice(-3)).toEqual([
      { label: "Run by", value: PAT },
      {
        label: "Whether NVDA was heard, session 1",
        value: "Not recorded: the session ended without an answer.",
      },
      {
        label: "Whether NVDA was heard, session 2",
        value: `Part of the time. Asked as the session ended, and answered at 16:20 by ${PAT}.`,
      },
    ]);
  });

  describe("lists every file the run's record lists", () => {
    it("the run's own first, its event log, as the run's, then each page's, each with its size and fingerprint", () => {
      const run = withOwnFiles(
        shareRun({
          id: "r1",
          voicecapVersion: "0.11.0",
          pages: [{ path: "/", files: ["read.txt"], screenshot: TINY_RECORD }],
        }),
        { "events.jsonl": LOG_HASH },
      );
      const [evidence] = buildShareModel(inputOf([run])).evidence;

      expect(evidence?.fingerprints).toEqual([
        { page: "The run", file: "events.jsonl", ...LOG_HASH },
        { page: "/", file: "read.txt", bytes: 1, sha256: "0".repeat(64) },
        {
          page: "/",
          file: "screenshot.jpg",
          bytes: TINY_RECORD.bytes,
          sha256: TINY_RECORD.sha256,
        },
      ]);
    });

    it("the run's own when no page lists one, as for a run whose pages were all skipped", () => {
      const run = withOwnFiles(
        shareRun({
          id: "r1",
          voicecapVersion: "0.11.0",
          pages: [{ path: "/", status: "skipped" }],
        }),
        { "events.jsonl": LOG_HASH },
      );
      const [evidence] = buildShareModel(inputOf([run])).evidence;

      expect(evidence?.fingerprints).toEqual([
        { page: "The run", file: "events.jsonl", ...LOG_HASH },
      ]);
    });

    it("only what the record has as a file's fingerprint, among the run's own", () => {
      const run = withOwnFiles(shareRun({ id: "r1", pages: [{ path: "/" }] }), {
        "events.jsonl": LOG_HASH,
        "notes.txt": "not a fingerprint",
        "other.txt": { sha256: 42, bytes: 1 },
        "empty.txt": null,
      });
      const [evidence] = buildShareModel(inputOf([run])).evidence;

      expect(evidence?.fingerprints).toEqual([
        { page: "The run", file: "events.jsonl", ...LOG_HASH },
      ]);
    });
  });
});

describe("a run's NVDA log, checked against its transcripts", () => {
  /** What the real run of 6 October 2026 comes to: all 204 steps agree (see share-log-check). */
  const EVERY_STEP = {
    transcriptLines: 204,
    logLines: 204,
    agree: 204,
    onlyInLog: [],
    onlyInTranscripts: [],
    outside: 177,
    notChecked: [],
  };

  /** The model of a site folder voicecap 0.17.0 could have made of the real run, as `share` reads it. */
  async function fixtureModel(
    options: Parameters<typeof nvdaFixtureSite>[0] = {},
    keys: typeof gestureOf | null = gestureOf,
  ): Promise<ShareModel> {
    const { siteDir } = await nvdaFixtureSite(options);
    return buildShareModel(
      await loadShareInput({ siteDir, config: DEFAULT_CONFIG, gestureOf: keys }),
    );
  }

  /** The run that keeps its copies, with its record listing none of them: only its event log. */
  function withoutListedCopies(kept: KeptLogs): KeptLogs {
    return { ...kept, run: withOwnFiles(kept.run, { "events.jsonl": LOG_HASH }) };
  }

  /** The model of the three-session run that keeps its copies, with parts of its input changed. */
  function keptModel(
    change: (kept: KeptLogs) => Partial<ShareInput> = () => ({}),
    kept: KeptLogs = keptLogsRun(),
  ): ShareModel {
    return buildShareModel(
      inputOf([kept.run], {
        transcripts: kept.transcripts,
        events: new Map([[kept.run.id, kept.log]]),
        nvdaLogs: new Map([[kept.run.id, kept.copies]]),
        ...change(kept),
      }),
    );
  }

  it("checks the real run's 204 steps against its log, and every one agrees", async () => {
    const model = await fixtureModel();

    expect(latestEvidence(model).nvdaLog).toEqual(EVERY_STEP);
  });

  it("checks the run's steps, and not what NVDA said outside them: the log's other windows aren't on the page", async () => {
    const model = await fixtureModel();
    const shownWords = stringsIn(shown(model)).join("\n");

    // NVDA said these before the run began, and as pages opened: counted, never shown.
    for (const outside of ["Calculator", "Connected as controlled computer", "Display is 0"]) {
      expect(shownWords, outside).not.toContain(outside);
    }
  });

  it("lists a line that differs under its page, pass, and step, in both lists", async () => {
    const model = await fixtureModel({
      change: (parts) => {
        parts.copy = parts.copy.replace(
          "'This small site shows how voicecap works, one page at a time.'",
          "'This small site shows how voicecap work, one page at a time.'",
        );
      },
    });

    expect(latestEvidence(model).nvdaLog).toEqual({
      ...EVERY_STEP,
      agree: 203,
      onlyInLog: [
        {
          page: "/",
          pass: "read",
          step: 6,
          text: "This small site shows how voicecap work, one page at a time.",
        },
      ],
      onlyInTranscripts: [
        {
          page: "/",
          pass: "read",
          step: 6,
          text: "This small site shows how voicecap works, one page at a time.",
        },
      ],
    });
  });

  it("checks a run it draws on though none of its pages is shown, as the run before the latest", async () => {
    const { siteDir, runId } = await nvdaFixtureSite();
    const later = await addLaterRun(siteDir);
    const model = buildShareModel(
      await loadShareInput({ siteDir, config: DEFAULT_CONFIG, gestureOf }),
    );

    expect(model.evidence.map((each) => each.run.id)).toEqual([later, runId]);
    expect(model.evidence[1]?.nvdaLog).toEqual(EVERY_STEP);
    // The later run kept no copy.
    expect(model.evidence[0]?.nvdaLog).toEqual({
      notRecorded: "Not recorded: this run kept no copy of NVDA's log.",
    });
  });

  it("names a page by its label, else by its address without the site's", async () => {
    const { siteDir } = await nvdaFixtureSite({
      change: (parts) => {
        parts.copy = parts.copy.replace(
          "'This small site shows how voicecap works, one page at a time.'",
          "'Something else.'",
        );
        const home = parts.run.pages[0]!;
        parts.run = {
          ...parts.run,
          pages: [{ ...home, label: "  The home page " }, ...parts.run.pages.slice(1)],
        };
      },
    });
    const model = buildShareModel(
      await loadShareInput({ siteDir, config: DEFAULT_CONFIG, gestureOf }),
    );
    const log = latestEvidence(model).nvdaLog;

    expect("onlyInLog" in log ? log.onlyInLog.map(({ page }) => page) : []).toEqual([
      "The home page",
    ]);
  });

  describe("adds the NVDA sessions of a run up, each checked with its own copy", () => {
    it("checks all three of a run that restarted NVDA and resumed", () => {
      expect(latestEvidence(keptModel()).nvdaLog).toEqual({
        transcriptLines: 24,
        logLines: 24,
        agree: 24,
        onlyInLog: [],
        onlyInTranscripts: [],
        outside: 21,
        notChecked: [],
      });
    });

    it("counts the steps of a session that has no copy, with its reason, and lists none of them", () => {
      const model = keptModel((kept) => ({
        events: new Map([
          [
            kept.run.id,
            {
              unreadable: 0,
              events: kept.log.events.map((event) =>
                event.type === "screen-reader-log" && event.file === "nvda-log/1-2.txt"
                  ? { ...event, file: null, reason: "NVDA's log wasn't there." }
                  : event,
              ),
            },
          ],
        ]),
      }));

      expect(latestEvidence(model).nvdaLog).toEqual({
        transcriptLines: 16,
        logLines: 16,
        agree: 16,
        onlyInLog: [],
        onlyInTranscripts: [],
        outside: 15,
        notChecked: [
          {
            steps: 8,
            from: "2026-09-26T14:04:45.729-05:00",
            why: "reason",
            detail: "NVDA's log wasn't there.",
          },
        ],
      });
    });
  });

  describe("says why a run's NVDA log isn't checked, in place of the check", () => {
    const logOf = (model: ShareModel) => latestEvidence(model).nvdaLog;

    it("says a run of a voicecap before the one that keeps NVDA's log used that voicecap", async () => {
      // The real run's own record: voicecap 0.11.0-rc.0.
      expect(logOf(await fixtureModel({ version: "0.11.0-rc.0" }))).toEqual({
        notRecorded: "Not recorded: this run used voicecap 0.11.0-rc.0.",
      });
      expect(logOf(await fixtureModel({ version: "0.16.9" }))).toEqual({
        notRecorded: "Not recorded: this run used voicecap 0.16.9.",
      });
      // A run whose sessions recorded no environment doesn't say which.
      const run = keptLogsRun().run;
      const unknown = keptModel(() => ({
        runs: [
          {
            ...run,
            sessions: run.sessions.map((session) => ({ ...session, environment: null })),
          },
        ],
      }));
      expect(logOf(unknown)).toEqual({
        notRecorded: "Not recorded: this run used an earlier version of voicecap.",
      });
    });

    it("keeps to the demo runs' own words: they are from before NVDA's log was kept", async () => {
      for (const each of (await demoModel()).evidence) {
        expect(each.nvdaLog).toEqual({ notRecorded: BEFORE_0_6 });
      }
    });

    it("says a run of the voicecap that keeps NVDA's log, whose record lists no copy, kept none, where its event log says no more", () => {
      const kept = withoutListedCopies(keptLogsRun());
      // Each NVDA session ended with no event of a copy.
      const silent = kept.log.events.filter((event) => event.type !== "screen-reader-log");
      const none = keptModel(
        () => ({
          nvdaLogs: new Map(),
          events: new Map([[kept.run.id, { events: silent, unreadable: 0 }]]),
        }),
        kept,
      );
      expect(logOf(none)).toEqual({
        notRecorded: "Not recorded: this run kept no copy of NVDA's log.",
      });
      // And where the page can't read the event log that would say why.
      const unread = keptModel(() => ({ nvdaLogs: new Map(), events: new Map() }), kept);
      expect(logOf(unread)).toEqual({
        notRecorded: "Not recorded: this run kept no copy of NVDA's log.",
      });
    });

    it("gives each NVDA session's reason from the event log, when the run's record lists no copy", () => {
      const kept = withoutListedCopies(keptLogsRun());
      // The first two sessions' logs couldn't be had, each for its reason; the third's stop has no
      // event of its copy, so the log says nothing of it.
      const reasons = new Map([
        ["nvda-log/1-1.txt", "NVDA's log wasn't there."],
        ["nvda-log/1-2.txt", "EBUSY: resource busy or locked"],
      ]);
      const events = kept.log.events.flatMap((event): RunEvent[] => {
        if (event.type !== "screen-reader-log" || event.file === null) return [event];
        const reason = reasons.get(event.file);
        return reason === undefined ? [] : [{ ...event, file: null, reason }];
      });
      const said = {
        notRecorded:
          "Not shown: no step could be checked. " +
          "8 steps from the NVDA session that started 26 September 2026, 14:02 weren't checked: NVDA's log wasn't there. " +
          "8 steps from the NVDA session that started 26 September 2026, 14:04 weren't checked: EBUSY: resource busy or locked. " +
          "8 steps from the NVDA session that started 28 September 2026, 09:00 weren't checked: voicecap kept no copy of NVDA's log for that session.",
      };
      const input =
        (keys: Partial<ShareInput> = {}) =>
        () => ({
          nvdaLogs: new Map(),
          events: new Map([[kept.run.id, { events, unreadable: 0 }]]),
          ...keys,
        });

      expect(logOf(keptModel(input(), kept))).toEqual(said);
      // The reasons don't need NVDA's keys, which only a copy is checked by.
      expect(logOf(keptModel(input({ gestureOf: null }), kept))).toEqual(said);
    });

    it("says a copy the event log names, which the run's record doesn't list, isn't as the run recorded it", async () => {
      const altered = {
        notRecorded:
          "Not shown: NVDA's log isn't as the run recorded it; voicecap verify names it.",
      };
      expect(logOf(await fixtureModel({ unlisted: true }))).toEqual(altered);
      const none = keptModel(() => ({ nvdaLogs: new Map() }), withoutListedCopies(keptLogsRun()));
      expect(logOf(none)).toEqual(altered);
    });

    it("says a run's copy that isn't as the run recorded it isn't shown", async () => {
      const { siteDir, runFolder } = await nvdaFixtureSite();
      await appendFile(path.join(runFolder, "nvda-log", "1-1.txt"), "# edited\n");
      const model = buildShareModel(
        await loadShareInput({ siteDir, config: DEFAULT_CONFIG, gestureOf }),
      );

      expect(logOf(model)).toEqual({
        notRecorded:
          "Not shown: NVDA's log isn't as the run recorded it; voicecap verify names it.",
      });
      // Copies the loader didn't read, for all three sessions, say the same.
      expect(logOf(keptModel(() => ({ nvdaLogs: new Map() })))).toEqual({
        notRecorded:
          "Not shown: NVDA's log isn't as the run recorded it; voicecap verify names it.",
      });
    });

    it("says a run of a screen reader other than NVDA has no such check", () => {
      const kept = keptLogsRun();
      const sessions = kept.run.sessions.map((session) =>
        session.environment?.screenReader
          ? {
              ...session,
              environment: {
                ...session.environment,
                screenReader: { ...session.environment.screenReader, name: "VoiceOver" },
              },
            }
          : session,
      );
      const model = keptModel(() => ({ runs: [{ ...kept.run, sessions }] }));

      expect(logOf(model)).toEqual({
        notRecorded:
          "Not recorded: this check is NVDA's only, since VoiceOver keeps no log of what it says.",
      });
    });

    it("says a run that kept only the first thing NVDA said for each step can't be checked", () => {
      const kept = keptLogsRun();
      const run = { ...kept.run, settings: { ...kept.run.settings, capture: "initial" as const } };

      expect(logOf(keptModel(() => ({ runs: [run] })))).toEqual({
        notRecorded:
          "Not shown: this run kept only the first thing NVDA said for each step, so a step can't be compared with all that NVDA's log has.",
      });
    });

    it("says a copy with no speech in it can't be checked", () => {
      const model = keptModel((kept) => ({
        nvdaLogs: new Map([
          [
            kept.run.id,
            new Map(
              [...kept.copies].map(([name]) => [name, "# NVDA's own log, with no speech.\n"]),
            ),
          ],
        ]),
      }));

      expect(logOf(model)).toEqual({
        notRecorded:
          "Not shown: NVDA's log has no speech in it, as when NVDA's logging level is below input and output.",
      });
    });

    it("says what the check needs of the event log when the page has none", () => {
      const model = keptModel(() => ({ events: new Map() }));

      expect(logOf(model)).toEqual({
        notRecorded:
          "Not shown: the event log isn't as the run recorded it; voicecap verify names it. NVDA's log is paired with the steps by the event log, so it can't be checked here.",
      });
    });

    it("says the same when the page has the event log but no line of it can be read", () => {
      const model = keptModel((kept) => ({
        events: new Map([[kept.run.id, { events: [], unreadable: 5 }]]),
      }));

      expect(logOf(model)).toEqual({
        notRecorded:
          "Not shown: no line of the event log could be read. NVDA's log is paired with the steps by the event log, so it can't be checked here.",
      });
    });

    it("says a page made without NVDA's keys can't make the check, which each copy says of itself", () => {
      expect(logOf(keptModel(() => ({ gestureOf: null })))).toEqual({ withoutKeys: true });
    });

    it("says a run with no steps has nothing to check against", () => {
      const kept = keptLogsRun();
      const run = {
        ...kept.run,
        pages: kept.run.pages.map((page) => ({ ...page, status: "failed" as const })),
      };

      expect(logOf(keptModel(() => ({ runs: [run] })))).toEqual({
        notRecorded: "Not recorded: this run has no transcripts to check NVDA's log against.",
      });
    });

    it("says each group of steps that weren't checked when the reasons differ", () => {
      const model = keptModel((kept) => {
        const copies = new Map(kept.copies);
        copies.delete("nvda-log/1-2.txt");
        return {
          nvdaLogs: new Map([[kept.run.id, copies]]),
          events: new Map([
            [
              kept.run.id,
              {
                unreadable: 0,
                events: kept.log.events
                  .filter(
                    (event) =>
                      event.type !== "screen-reader-log" || event.file !== "nvda-log/1-1.txt",
                  )
                  .map((event) =>
                    event.type === "screen-reader-log" && event.file === "nvda-log/2-1.txt"
                      ? { ...event, file: null, reason: "EBUSY: resource busy or locked" }
                      : event,
                  ),
              },
            ],
          ]),
        };
      });

      expect(logOf(model)).toEqual({
        notRecorded:
          "Not shown: no step could be checked. " +
          "8 steps from the NVDA session that started 26 September 2026, 14:02 weren't checked: voicecap kept no copy of NVDA's log for that session. " +
          "8 steps from the NVDA session that started 26 September 2026, 14:04 weren't checked: NVDA's log isn't as the run recorded it; voicecap verify names it. " +
          "8 steps from the NVDA session that started 28 September 2026, 09:00 weren't checked: EBUSY: resource busy or locked.",
      });
    });
  });

  describe("is kept apart from what the page's verdict goes by", () => {
    /**
     * What the verdict, the ring, the cards, and the summary say, as the page gives them, and the
     * problems as they count: all of each but its record and what it lacks, which show NVDA's own
     * log (its warnings and errors, or why the page has none) and nothing else.
     */
    const verdictOfModel = (model: ShareModel) => ({
      result: model.result,
      ring: model.ring,
      attention: model.attention,
      summary: model.summary,
      problems: {
        ...model.problems,
        problems: model.problems.problems.map(
          ({ record: _record, notRecorded: _notRecorded, ...counted }) => counted,
        ),
      },
    });

    it("changes nothing the verdict goes by, whether every line agrees, some differ, or none was checked", () => {
      const bare = verdictOfModel(keptModel(() => ({ nvdaLogs: new Map() })));
      // NVDA said otherwise of every step in Apply's copy.
      const differing = verdictOfModel(
        keptModel((each) => ({
          nvdaLogs: new Map([
            [
              each.run.id,
              new Map(
                [...each.copies].map(([name, text]): [string, string] => [
                  name,
                  text.replaceAll("'Grants'", "'Grant'"),
                ]),
              ),
            ],
          ]),
        })),
      );

      expect(verdictOfModel(keptModel())).toEqual(bare);
      expect(differing).toEqual(bare);
      expect(Object.keys(keptModel().result)).toEqual([
        "pages",
        "read",
        "problems",
        "problemPages",
      ]);
    });
  });
});

describe("a run whose event log doesn't cover all its sessions", () => {
  /** The evidence of a run whose event log the page has read. */
  function evidenceOf({ run, log }: ReturnType<typeof loggedRun>): RunEvidence {
    const model = buildShareModel(
      inputOf([run], { transcripts: storeOf(), events: new Map([[run.id, log]]) }),
    );
    const [evidence] = model.evidence;
    if (evidence === undefined) throw new Error("The run has no evidence.");
    return evidence;
  }
  const restarts = (evidence: RunEvidence) =>
    evidence.facts.find(({ label }) => label === "NVDA restarts")?.value;
  const sessionsOf = (evidence: RunEvidence) =>
    Array.isArray(evidence.timeline) ? evidence.timeline.map(({ session }) => session) : [];

  it("says, for a run begun on 0.10.0 and finished on 0.11.0, that its first session isn't recorded, and why", () => {
    const evidence = evidenceOf(resumedLoggedRun("0.10.0"));

    expect(sessionsOf(evidence)).toEqual([2]);
    expect(evidence.unlogged).toEqual([
      { session: 1, notRecorded: "Session 1: not recorded: it used voicecap 0.10.0." },
    ]);
  });

  it("says which sessions its restarts are counted in, and why the others aren't", () => {
    const resumed = resumedLoggedRun("0.10.0");

    expect(restarts(evidenceOf(resumed))).toBe(
      "None in session 2. Session 1: not recorded: it used voicecap 0.10.0.",
    );
    // A restart in the session the log covers is counted there, with why.
    const restarted = logged("2026-09-28", "09:01:03.000", {
      type: "screen-reader-restarting",
      reason: { kind: "failed-page" },
    });
    const events = [...resumed.log.events, restarted].sort((a, b) => a.at.localeCompare(b.at));
    expect(restarts(evidenceOf({ ...resumed, log: { events, unreadable: 0 } }))).toBe(
      "1 in session 2: after a failed page. Session 1: not recorded: it used voicecap 0.10.0.",
    );
  });

  it("says a session of a voicecap that keeps the log, which has no line of it, has none", () => {
    const evidence = evidenceOf(resumedLoggedRun("0.11.0"));

    expect(evidence.unlogged).toEqual([
      { session: 1, notRecorded: "Session 1: not recorded: the event log has no line of it." },
    ]);
    expect(restarts(evidence)).toBe(
      "None in session 2. Session 1: not recorded: the event log has no line of it.",
    );
  });

  it("says the same of a later session the log doesn't cover, as for a run finished with an older voicecap", () => {
    const { run, log } = loggedRun();
    const sessions = run.sessions.map((session) =>
      session.n === 2 && session.environment !== null
        ? {
            ...session,
            environment: {
              ...session.environment,
              voicecap: { ...session.environment.voicecap, version: "0.10.0" },
            },
          }
        : session,
    );
    const first = log.events.filter((event) => event.at.startsWith("2026-09-26"));
    const evidence = evidenceOf({
      run: { ...run, sessions },
      log: { events: first, unreadable: 0 },
    });

    expect(sessionsOf(evidence)).toEqual([1]);
    expect(evidence.unlogged).toEqual([
      { session: 2, notRecorded: "Session 2: not recorded: it used voicecap 0.10.0." },
    ]);
    expect(restarts(evidence)).toBe(
      "1 in session 1: to try Apply again (attempt 2 of 5). Session 2: not recorded: it used voicecap 0.10.0.",
    );
  });

  it("says nothing more of a run whose log covers every session", () => {
    const evidence = evidenceOf(loggedRun());

    expect(sessionsOf(evidence)).toEqual([1, 2]);
    expect(evidence.unlogged).toEqual([]);
    expect(restarts(evidence)).toBe("1: to try Apply again (attempt 2 of 5)");
  });

  it("says nothing of sessions for a run whose log the page doesn't show, which says why once", () => {
    const { run } = resumedLoggedRun("0.10.0");
    const [evidence] = buildShareModel(inputOf([run])).evidence;

    expect(evidence?.timeline).toEqual({
      notRecorded: "Not recorded: this run's record lists no event log.",
    });
    expect(evidence?.unlogged).toEqual([]);
  });
});

describe("a page's screenshot", () => {
  /** The address a JPEG has as an image in the page: its bytes, in base64. */
  const addressOf = (bytes: Uint8Array): string =>
    `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;

  /** A run of voicecap 0.11.0 (or `voicecapVersion`), the first to take screenshots. */
  const runOf = (pages: SharePageSpec[], voicecapVersion = "0.11.0"): RunJson =>
    shareRun({ id: "r1", voicecapVersion, pages });

  /** The cards of a run, with the screenshots of its pages as the loader holds them. */
  const cardsOf = (run: RunJson): PageCard[] =>
    buildShareModel(inputOf([run], { screenshots: picturesOf([run]) })).pages;

  /** What a card says in place of its picture, or null when it has a picture. */
  function saidInPlace(card: PageCard | undefined): string | null {
    const shot = card?.screenshot;
    return shot !== undefined && "notRecorded" in shot ? shot.notRecorded : null;
  }

  const TAKEN = "2026-09-26T14:05:03.120-05:00";

  /** What a card says of a file it can't show: one that isn't as the run recorded it. */
  const NOT_SHOWN = "Not shown: the file isn't as the run recorded it; voicecap verify names it.";

  it("is the address of its file, with its alt text and the size its record gives", () => {
    const run = runOf([
      {
        path: "/about",
        label: "About us",
        screenshot: { ...TINY_RECORD, width: 632, height: 419 },
      },
      { path: "/contact", screenshot: TINY_RECORD },
    ]);

    expect(cardsOf(run).map((card) => card.screenshot)).toEqual([
      {
        dataUri: addressOf(TINY_JPEG),
        alt: "The page About us as it loaded, before NVDA read it",
        // The record's size, not the file's own: the page lays the picture out by it.
        width: 632,
        height: 419,
      },
      {
        dataUri: addressOf(TINY_JPEG),
        alt: `The page ${SITE}contact as it loaded, before NVDA read it`,
        width: 16,
        height: 12,
      },
    ]);
  });

  it("is the bytes of its file in base64, as they are, whatever they are", () => {
    // These three bytes spell "+//+" in base64 and "-__-" in base64url: the page needs the first.
    const bytes = Uint8Array.of(0xfb, 0xff, 0xfe);
    const run = runOf([{ path: "/", screenshot: TINY_RECORD }]);
    const slug = run.pages[0]?.slug ?? "";
    const { pages } = buildShareModel(
      inputOf([run], { screenshots: new Map([[`r1/${slug}`, bytes]]) }),
    );

    expect(pages[0]?.screenshot).toMatchObject({ dataUri: "data:image/jpeg;base64,+//+" });
  });

  it("names the run's own screen reader in its alt text", () => {
    const run = shareRun({
      id: "r1",
      voicecapVersion: "0.11.0",
      sessions: [
        {
          environment: {
            screenReader: { name: "VoiceOver", version: "14", build: "14", language: "en" },
          },
        },
      ],
      pages: [{ path: "/", label: "Home", screenshot: TINY_RECORD }],
    });

    expect(cardsOf(run)[0]?.screenshot).toMatchObject({
      alt: "The page Home as it loaded, before VoiceOver read it",
    });
  });

  it("takes the size the picture itself says when its record's isn't a size", () => {
    const run = runOf([
      { path: "/", screenshot: { ...TINY_RECORD, width: 0, height: Number.NaN } },
      { path: "/a", screenshot: { ...TINY_RECORD, width: 1.5, height: -3 } },
    ]);

    // TINY_JPEG is 16 pixels wide and 12 high.
    expect(cardsOf(run).map((card) => card.screenshot)).toMatchObject([
      { width: 16, height: 12 },
      { width: 16, height: 12 },
    ]);
    // Bytes that are as the run recorded them, but aren't a picture with a size, can't be shown:
    // the page says that, and never that verify names a file that matches its record.
    const odd = runOf([{ path: "/", screenshot: { ...TINY_RECORD, width: 0 } }]);
    const slug = odd.pages[0]?.slug ?? "";
    const bytes = Uint8Array.of(1, 2, 3);
    expect(
      saidInPlace(
        buildShareModel(inputOf([odd], { screenshots: new Map([[`r1/${slug}`, bytes]]) })).pages[0],
      ),
    ).toBe(
      "Not shown: the file is as the run recorded it, but it isn't a picture voicecap can show.",
    );
  });

  it("says it couldn't read a record no voicecap writes, and lists no file for it, rather than stop", () => {
    const records: unknown[] = [
      null,
      "screenshot.jpg",
      42,
      [],
      {},
      { takenAt: TAKEN },
      { sha256: TINY_RECORD.sha256, takenAt: TAKEN },
    ];
    const run = runOf([
      { path: "/", screenshot: TINY_RECORD },
      ...records.map((screenshot, index) => ({
        path: `/odd-${index}`,
        screenshot: screenshot as ScreenshotRecord,
      })),
    ]);
    const model = buildShareModel(inputOf([run], { screenshots: picturesOf([run]) }));

    expect(model.pages.map(saidInPlace)).toEqual([
      null,
      ...records.map(() => "Not shown: the run's record of this screenshot couldn't be read."),
    ]);
    expect(model.evidence[0]?.fingerprints.filter(({ file }) => file === "screenshot.jpg")).toEqual(
      [{ page: "/", file: "screenshot.jpg", bytes: TINY_RECORD.bytes, sha256: TINY_RECORD.sha256 }],
    );
    expect(model.check.screenshots).toHaveLength(1);
  });

  describe("says why a page has no picture", () => {
    it("for a run from before voicecap took screenshots, as it says of every part such a run didn't record", () => {
      for (const version of ["0.10.0", "0.4.1"]) {
        const run = runOf([{ path: "/" }], version);

        expect(saidInPlace(cardsOf(run)[0]), version).toBe(
          `Not recorded: this run used voicecap ${version}.`,
        );
      }
    });

    it("for a picture the browser couldn't take, with the reason it gave", () => {
      const run = runOf([
        { path: "/", screenshot: { error: "timed out after 5s", takenAt: TAKEN } },
      ]);

      expect(saidInPlace(cardsOf(run)[0])).toBe(
        "Not recorded: the screenshot couldn't be taken (timed out after 5s).",
      );
    });

    it("for a picture the browser couldn't take, with the reason tidied into the sentence and the home folder replaced", () => {
      const home = process.platform === "win32" ? "%USERPROFILE%" : "~";
      const run = runOf([
        {
          path: "/",
          screenshot: {
            error: `Protocol error (Page.captureScreenshot):\n  couldn't write  ${os.homedir()}/shot.jpg.\n`,
            takenAt: TAKEN,
          },
        },
        { path: "/a", screenshot: { error: " . \n", takenAt: TAKEN } },
      ]);
      const [first, second] = cardsOf(run);

      expect(saidInPlace(first)).toBe(
        `Not recorded: the screenshot couldn't be taken (Protocol error (Page.captureScreenshot): couldn't write ${home}/shot.jpg).`,
      );
      expect(saidInPlace(first)).not.toContain(os.homedir());
      // A reason that says nothing leaves the sentence without its brackets.
      expect(saidInPlace(second)).toBe("Not recorded: the screenshot couldn't be taken.");
    });

    it("for a run of voicecap 0.11.0 or later whose screen reader driver takes none: that it doesn't", () => {
      for (const version of ["0.11.0", "0.12.3", "1.0.0"]) {
        const run = runOf([{ path: "/" }, { path: "/a" }], version);

        expect(cardsOf(run).map(saidInPlace), version).toEqual([
          "Not recorded: this run's screen reader driver doesn't take screenshots.",
          "Not recorded: this run's screen reader driver doesn't take screenshots.",
        ]);
      }
    });

    it("for a page of a run whose driver took some that wasn't read: skipped, or failed before it loaded", () => {
      const run = runOf([
        { path: "/", screenshot: TINY_RECORD },
        { path: "/pdf", status: "skipped" },
        {
          path: "/down",
          status: "failed",
          failedAttempts: [failedAttempt({ n: 1, command: "openPage", pass: "read", step: null })],
        },
      ]);
      const wasntRead = "Not recorded: no screenshot was taken, since the page wasn't read.";

      expect(cardsOf(run).map(saidInPlace)).toEqual([null, wasntRead, wasntRead]);
    });

    it("for a record whose file the page can't show: that it isn't as the run recorded it, and that verify names it", () => {
      const run = runOf([{ path: "/", screenshot: TINY_RECORD }]);
      const slug = run.pages[0]?.slug ?? "";

      // The loader holds a file only when it's as its record has it, so a page without one is that.
      expect(saidInPlace(buildShareModel(inputOf([run])).pages[0])).toBe(NOT_SHOWN);
      // A file of another run's page, or another page's, isn't this page's.
      for (const key of [`r0/${slug}`, "r1/another-page"]) {
        const other = inputOf([run], { screenshots: new Map([[key, TINY_JPEG]]) });

        expect(saidInPlace(buildShareModel(other).pages[0]), key).toBe(NOT_SHOWN);
      }
    });
  });

  describe("is the picture of the record the card speaks for", () => {
    const slugOf = (run: RunJson, path: string): string =>
      run.pages.find((page) => page.url.endsWith(path))?.slug ?? "";

    it("the transcripts' run, for a page whose latest run failed it, though that failure has a picture of its own", () => {
      const earlier = shareRun({
        id: "r1",
        createdAt: "2026-09-25T10:00:00-05:00",
        voicecapVersion: "0.11.0",
        pages: [{ path: "/", screenshot: TINY_RECORD }],
      });
      // The latest run loaded the page, took its picture, and then failed it.
      const latest = shareRun({
        id: "r2",
        voicecapVersion: "0.11.0",
        pages: [
          {
            path: "/",
            status: "failed",
            screenshot: { ...TINY_RECORD, width: 99, height: 66 },
            failedAttempts: [failedAttempt({ n: 1 })],
          },
        ],
      });
      const slug = slugOf(earlier, "/");
      const model = buildShareModel(
        inputOf([earlier, latest], {
          screenshots: new Map<string, Uint8Array>([
            [`r1/${slug}`, TINY_JPEG],
            [`r2/${slug}`, Uint8Array.of(1, 2, 3)],
          ]),
        }),
      );

      expect(model.pages[0]?.screenshot).toEqual({
        dataUri: addressOf(TINY_JPEG),
        alt: `The page ${SITE} as it loaded, before NVDA read it`,
        width: 16,
        height: 12,
      });
      expect(model.check.screenshots).toEqual([{ run: "r1", slug, name: "screenshot.jpg" }]);
    });

    it("the latest failure's, for a page that was never transcribed", () => {
      const run = runOf([
        {
          path: "/",
          status: "failed",
          screenshot: TINY_RECORD,
          failedAttempts: [failedAttempt({ n: 1 })],
        },
      ]);
      const [card] = cardsOf(run);

      expect(card).toMatchObject({ status: "never", screenshot: { width: 16, height: 12 } });
      expect(card?.screenshot).toHaveProperty("dataUri", addressOf(TINY_JPEG));
    });

    it("the run's own: a page of a run begun on 0.10.0 and resumed on 0.11.0 says what its own session's voicecap did", () => {
      const run = shareRun({
        id: "r1",
        voicecapVersion: "0.10.0",
        sessions: [
          {},
          { environment: { voicecap: { version: "0.11.0", configSha256: "c".repeat(64) } } },
        ],
        pages: [
          { path: "/", session: 1 },
          { path: "/a", session: 2, screenshot: TINY_RECORD },
          { path: "/b", session: 2, status: "skipped" },
        ],
      });
      const cards = cardsOf(run);

      expect(saidInPlace(cards[0])).toBe("Not recorded: this run used voicecap 0.10.0.");
      expect(cards[1]?.screenshot).toHaveProperty("dataUri");
      expect(saidInPlace(cards[2])).toBe(
        "Not recorded: no screenshot was taken, since the page wasn't read.",
      );
    });
  });

  it("is listed for the page's fingerprint check once for each page that shows one, and each fingerprint is in the run's evidence", () => {
    const run = runOf([
      { path: "/a", files: ["read.txt"], screenshot: TINY_RECORD },
      { path: "/b" },
      { path: "/c", screenshot: { error: "timed out", takenAt: TAKEN } },
      { path: "/d", screenshot: { ...TINY_RECORD, sha256: "d".repeat(64), bytes: 400 } },
    ]);
    const [a, , , d] = run.pages;
    // The page shows /a's picture, and /d's file isn't as its record has it.
    const model = buildShareModel(
      inputOf([run], { screenshots: new Map([[`r1/${a?.slug}`, TINY_JPEG]]) }),
    );

    expect(model.check.screenshots).toEqual([{ run: "r1", slug: a?.slug, name: "screenshot.jpg" }]);
    // The evidence lists what the record lists, after the page's transcripts, shown or not.
    expect(model.evidence[0]?.fingerprints).toEqual([
      { page: "/a", file: "read.txt", bytes: 1, sha256: "0".repeat(64) },
      { page: "/a", file: "screenshot.jpg", bytes: TINY_RECORD.bytes, sha256: TINY_RECORD.sha256 },
      { page: "/d", file: "screenshot.jpg", bytes: 400, sha256: "d".repeat(64) },
    ]);
    expect(d?.screenshot).toMatchObject({ bytes: 400 });
    // The check's copy of the run's record is as recorded, which the seal covers.
    expect(model.check.runs[0]?.pages[0]?.screenshot).toEqual(TINY_RECORD);
  });

  it("is in no run of the demo, which recorded none", async () => {
    const model = await demoModel();

    expect(model.check.screenshots).toEqual([]);
    expect(
      model.evidence.flatMap((each) => each.fingerprints).filter((f) => f.file.endsWith(".jpg")),
    ).toEqual([]);
  });
});

describe("the walkthrough file each run's evidence offers", () => {
  it("is the file voicecap writes of the run, named for the site's folder and the run, with the commands that get it and repeat it", async () => {
    const model = await demoModel();

    expect(model.evidence.map((each) => each.run.id)).toEqual([
      "2026-09-29_1402",
      "2026-09-29_1315",
    ]);
    for (const each of model.evidence) {
      const time = each.run.id.endsWith("1402") ? "1402" : "1315";
      const text = walkthroughJson(walkthroughOf(demoRun(time)));
      const fileName = `127.0.0.1_4848_${each.run.id}_walkthrough.json`;

      expect(each.walkthrough, each.run.id).toEqual({
        fileName,
        base64: Buffer.from(text, "utf8").toString("base64"),
        bytes: Buffer.byteLength(text, "utf8"),
        get: `npx @icjia/voicecap walkthrough --site http://127.0.0.1:4848 --run ${each.run.id} ${fileName}`,
        repeat: `npx @icjia/voicecap --walkthrough ${fileName}`,
      });
    }
  });

  it("is a file voicecap reads back, a walkthrough of that run", async () => {
    for (const each of (await demoModel()).evidence) {
      const file = downloadOf(each);
      const read = parseWalkthrough(fileBytes(file).toString("utf8"), file.fileName);

      expect(read.original.run).toBe(each.run.id);
      expect(read.site).toBe("http://127.0.0.1:4848");
      expect(read.pages).toHaveLength(each.run.pages.length);
    }
  });

  it("is made from the run's record as its run.json holds it, so it is the file the get command writes", () => {
    const shownRun = shareRun({ id: "r1", pages: [{ path: "/", label: "As shown" }] });
    const recorded = shareRun({ id: "r1", pages: [{ path: "/", label: "As recorded" }] });
    const evidence = latestEvidence(buildShareModel(inputOf([shownRun], { records: [recorded] })));
    const text = fileBytes(downloadOf(evidence)).toString("utf8");

    expect(text).toBe(walkthroughJson(walkthroughOf(recorded)));
    expect(text).toContain("As recorded");
    expect(text).not.toContain("As shown");
  });

  it("holds the file as UTF-8 in base64, and says its size in bytes, which is more than its characters", () => {
    const run = shareRun({ id: "r1", pages: [{ path: "/", label: "Café – accueil ☕" }] });
    const file = downloadOf(latestEvidence(buildShareModel(inputOf([run]))));
    const text = walkthroughJson(walkthroughOf(run));
    const bytes = fileBytes(file);

    expect(text).toContain("Café – accueil ☕");
    expect(bytes.equals(Buffer.from(text, "utf8"))).toBe(true);
    expect(bytes.toString("utf8")).toBe(text);
    expect(file.bytes).toBe(bytes.length);
    expect(file.bytes).toBeGreaterThan(text.length);
  });

  it.each([
    ["https://example.illinois.gov/", "example.illinois.gov"],
    ["http://127.0.0.1:4848", "127.0.0.1_4848"],
    ["http://Localhost:3000/some/path", "localhost_3000"],
  ])("names the file for the site's folder, as siteFolder does: %s", (site, folder) => {
    // A run of that site, whose page is on it, as a walkthrough file needs.
    const home = new URL("/", site).href;
    const run = { ...shareRun({ id: "2026-09-26_1405", pages: [{ path: home }] }), site };
    const file = downloadOf(latestEvidence(buildShareModel(inputOf([run], { readOrigin: site }))));
    const name = `${folder}_2026-09-26_1405_walkthrough.json`;

    expect(file.fileName).toBe(name);
    expect(file.get).toBe(
      `npx @icjia/voicecap walkthrough --site ${site} --run 2026-09-26_1405 ${name}`,
    );
    expect(file.repeat).toBe(`npx @icjia/voicecap --walkthrough ${name}`);
  });

  // The commands are for pasting into a shell, so a value that a shell would read is quoted, as the
  // other commands voicecap prints are (formatCommand). An IPv6 address's brackets are the one such
  // thing a site's address can hold: zsh, a Mac's shell, reads them as a pattern, and stops with
  // "no matches found". The file's name and the run's id are made of characters a shell leaves be.
  it("quotes an IPv6 site's address in the commands that name it, and nothing else", () => {
    const site = "http://[::1]:4848";
    const run = {
      ...shareRun({ id: "2026-09-26_1405", pages: [{ path: new URL("/", site).href }] }),
      site,
    };
    const evidence = latestEvidence(buildShareModel(inputOf([run], { readOrigin: site })));
    const file = downloadOf(evidence);
    const name = `${siteFolder(site)}_2026-09-26_1405_walkthrough.json`;

    expect(name).toBe("___1__4848_2026-09-26_1405_walkthrough.json");
    expect(file.fileName).toBe(name);
    expect(file.get).toBe(
      `npx @icjia/voicecap walkthrough --site 'http://[::1]:4848' --run 2026-09-26_1405 ${name}`,
    );
    expect(evidence.verify).toBe("npx @icjia/voicecap verify");
    expect(file.repeat).toBe(`npx @icjia/voicecap --walkthrough ${name}`);
  });

  it("says why there is no file for a run beyond what a walkthrough file can hold, a step limit of 100,001", () => {
    const run = withStepLimit(shareRun({ id: "r1", pages: [{ path: "/" }] }), 100_001);

    // The reason is the one voicecap gives of the same run, and a sentence that ends with its period.
    expect(walkthroughProblem(walkthroughOf(run))).toBe(STEP_LIMIT_PROBLEM);
    const { walkthrough } = latestEvidence(buildShareModel(inputOf([run])));

    expect(walkthrough).toEqual({ problem: STEP_LIMIT_PROBLEM });
    expect(Object.keys(walkthrough)).toEqual(["problem"]);
  });

  it("says it of the run that has the problem only: the other run's file is still offered", () => {
    const fine = shareRun({
      id: "r1",
      createdAt: "2026-09-25T10:00:00-05:00",
      pages: [{ path: "/" }],
    });
    const over = withStepLimit(shareRun({ id: "r2", pages: [{ path: "/" }] }), 100_001);
    const { evidence } = buildShareModel(inputOf([fine, over]));
    const [latest, earlier] = evidence;

    expect(evidence.map((each) => each.run.id)).toEqual(["r2", "r1"]);
    expect(latest?.walkthrough).toEqual({ problem: STEP_LIMIT_PROBLEM });
    expect(earlier === undefined ? null : downloadOf(earlier).fileName).toBe(
      "example.illinois.gov_r1_walkthrough.json",
    );
  });

  it("is the very file `voicecap walkthrough` writes of the run", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-walkthrough-file-"));
    try {
      for (const each of (await demoModel()).evidence) {
        const file = path.join(dir, `${each.run.id}.json`);

        await writeWalkthrough({
          file,
          out: path.dirname(DEMO_SITE),
          site: "http://127.0.0.1:4848",
          run: each.run.id,
          cwd: dir,
          env: {},
          logger: createMemoryLogger(),
        });

        // Byte for byte what the page carries for download, so either way a person gets one file.
        const written = await readFile(file);
        expect(written.length, each.run.id).toBeGreaterThan(0);
        expect(written.equals(fileBytes(downloadOf(each))), each.run.id).toBe(true);
        expect(written.length, each.run.id).toBe(downloadOf(each).bytes);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe("for a run whose record it can't make a file of", () => {
    // The page is never stopped by one: it says why there is no file, as it does of a run beyond what
    // the format holds.
    it("says it couldn't read the record of a counted run that has no time it completed, its seal kept", () => {
      const run = { ...shareRun({ id: "r1", pages: [{ path: "/" }] }), completedAt: null };
      expect(run.seal).toMatch(/^[0-9a-f]{64}$/);

      const model = buildShareModel(inputOf([run]));

      expect(model.evidence.map((each) => each.run.id)).toEqual(["r1"]);
      expect(latestEvidence(model).walkthrough).toEqual({
        problem: "voicecap couldn't read its record.",
      });
    });

    it("gives the depth of NVDA settings nested 1,500 levels as the problem, and builds the model", () => {
      const run = withNestedSettings(shareRun({ id: "r1", pages: [{ path: "/" }] }), 1_500);

      const model = buildShareModel(inputOf([run]));

      expect(latestEvidence(model).walkthrough).toEqual({
        problem: "its original.nvdaSettings is nested more than 32 levels deep.",
      });
    });

    it("says it couldn't read the record when the file can't be written out, a value JSON can't hold", () => {
      const base = shareRun({ id: "r1", pages: [{ path: "/" }] });
      // A BigInt: a record read from run.json never holds one, but this one makes the file's own
      // serializing throw, after the file has been built and passed.
      const nvdaSettings = { speech: { rate: 40n } };
      const run = { ...base, settings: { ...base.settings, nvdaSettings } };
      expect(() => walkthroughJson(walkthroughOf(run))).toThrow(TypeError);

      const model = buildShareModel(inputOf([run]));

      expect(latestEvidence(model).walkthrough).toEqual({
        problem: "voicecap couldn't read its record.",
      });
    });

    it("leaves the other runs' files alone", () => {
      const fine = shareRun({
        id: "r1",
        createdAt: "2026-09-25T10:00:00-05:00",
        pages: [{ path: "/" }],
      });
      const unreadable = { ...shareRun({ id: "r2", pages: [{ path: "/" }] }), completedAt: null };
      const { evidence } = buildShareModel(inputOf([fine, unreadable]));
      const [latest, earlier] = evidence;

      expect(latest?.walkthrough).toEqual({ problem: "voicecap couldn't read its record." });
      expect(earlier === undefined ? null : downloadOf(earlier).fileName).toBe(
        "example.illinois.gov_r1_walkthrough.json",
      );
    });
  });
});
