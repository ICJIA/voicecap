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
import type { PageScreenshot } from "../src/drivers/types.js";
import { flagRulesSha256 } from "../src/flags/evaluate.js";
import type {
  EnvironmentRecord,
  FlagResult,
  MachineRecord,
  PageSource,
  RunEvent,
  RunJson,
} from "../src/model.js";
import { describeChanges } from "../src/report/compare.js";
import { runAudit } from "../src/run/audit.js";
import { readEventLog } from "../src/run/events.js";
import { redactHome } from "../src/run/failure.js";
import { eventLogFile, pageDir, runJsonPath, siteFolder } from "../src/run/paths.js";
import { CHECK_LIBRARY, type CheckData } from "../src/share/check.js";
import { loadShareInput } from "../src/share/load.js";
import {
  buildShareModel,
  type PageCard,
  type RunEvidence,
  type ShareModel,
} from "../src/share/model.js";
import {
  parseWalkthrough,
  walkthroughJson,
  walkthroughOf,
  walkthroughProblem,
} from "../src/share/walkthrough.js";
import { writeWalkthrough } from "../src/share/write-walkthrough.js";
import { extractBody } from "../src/transcripts/format.js";
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
  inputOf,
  LOG_HASH,
  logged,
  loggedRun,
  picturesOf,
  resumedLoggedRun,
  STEP_LIMIT_PROBLEM,
  storeOf,
  TRANSCRIPTS,
  withNestedSettings,
  withOwnFiles,
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

  describe("each page's screenshot", () => {
    const NOT_SHOWN = "Not shown: the file isn't as the run recorded it; voicecap verify names it.";
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
      flagged: [],
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
    expect(model.summary.numbers.flagged).toBe(1);
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
    expect(model.summary.attention[0]?.clauses).toContain(`As noted in ${redact(notes)}`);
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

  it("quotes NVDA's own words for each flag", async () => {
    const model = await demoModel();

    expect(model.flagged.map((each) => each.card)).toEqual([
      model.pages.find((card) => card.slug === COMMON),
    ]);
    expect(model.flagged[0]?.quotes).toEqual([
      {
        rule: "generic-link-text",
        text: "3 links say only “click here”.",
        said: [
          "To see how a run works,, link, click here, dot",
          "To read about transcripts,, link, click here, dot",
          "To learn about the report,, link, click here, dot",
        ],
      },
      {
        rule: "unlabeled",
        text: "2 items have no names, so NVDA says only “button” and “edit”.",
        // Not the browser's own "Tab search, button" after focus left the page: no rule hears it.
        said: ["button", "main landmark. edit, blank"],
      },
      {
        rule: "headings",
        text: "Its first heading is level 2, not 1.",
        said: ["main landmark, Common mistakes (on purpose), heading, level 2"],
      },
    ]);
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
    // Bytes that aren't a picture with a size aren't what the run recorded either.
    const odd = runOf([{ path: "/", screenshot: { ...TINY_RECORD, width: 0 } }]);
    const slug = odd.pages[0]?.slug ?? "";
    const bytes = Uint8Array.of(1, 2, 3);
    expect(
      saidInPlace(
        buildShareModel(inputOf([odd], { screenshots: new Map([[`r1/${slug}`, bytes]]) })).pages[0],
      ),
    ).toBe(NOT_SHOWN);
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
