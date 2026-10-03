/**
 * The shareable page's model: what buildShareModel makes of a site folder that loadShareInput has
 * read. The demo runs of 29 September 2026 (voicecap 0.4.1, in test/fixtures/share/) are the real
 * case; site folders written as voicecap writes them, and runs built in memory, cover the rest.
 */
import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { VoicecapConfig } from "../src/config/schema.js";
import { flagRulesSha256 } from "../src/flags/evaluate.js";
import type {
  EnvironmentRecord,
  FlagResult,
  MachineRecord,
  PageSource,
  RunJson,
} from "../src/model.js";
import { describeChanges } from "../src/report/compare.js";
import { redactHome } from "../src/run/failure.js";
import { pageDir, runJsonPath } from "../src/run/paths.js";
import { CHECK_LIBRARY, type CheckData } from "../src/share/check.js";
import { loadShareInput } from "../src/share/load.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import { extractBody } from "../src/transcripts/format.js";
import { sealOf } from "../src/util/hash.js";
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
import { failedAttempt, shareRun } from "./helpers/share-data.js";
import { DEMO_DAY, demoRun } from "./helpers/share-fixture.js";
import { DEMO_SITE, demoModel, inputOf, TRANSCRIPTS } from "./helpers/share-model.js";

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
 * fingerprint check and for the renderers to read fingerprints from.
 */
function shown(model: ShareModel): unknown {
  return {
    ...model,
    check: null,
    evidence: model.evidence.map((each) => ({ ...each, run: null })),
    changes: model.changes && { ...model.changes, before: null, after: null },
  };
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
      site: "http://127.0.0.1:4848",
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
});

describe("buildShareModel", () => {
  it("names the site from the setting, the home page's title, or its host", async () => {
    const titled = shareRun({
      id: "r1",
      pages: [
        { path: "/about", title: "About us" },
        { path: "/", title: " Example Agency " },
      ],
    });
    expect(
      buildShareModel(inputOf([titled], { siteName: "Example Agency's website" })).header.siteName,
    ).toBe("Example Agency's website");
    // Without the setting: the title of the page at "/", as the browser reported it.
    expect(buildShareModel(inputOf([titled])).header.siteName).toBe("Example Agency");

    // With no page at "/": the first page's.
    const noHome = shareRun({
      id: "r1",
      pages: [
        { path: "/about", title: "About us" },
        { path: "/contact", title: "Contact" },
      ],
    });
    expect(buildShareModel(inputOf([noHome])).header.siteName).toBe("About us");

    // A home page the latest run didn't read in full, or that has no title: the host.
    const homes = [
      { status: "failed", title: "Example Agency" },
      { status: "skipped", title: "Example Agency" },
      { title: null },
      {},
    ] as const;
    for (const home of homes) {
      const run = shareRun({ id: "r1", pages: [{ path: "/", ...home }] });
      expect(buildShareModel(inputOf([run])).header.siteName).toBe("example.illinois.gov");
    }

    // A replayed run never counts, so its titles never name the site.
    const live = shareRun({ id: "r1", pages: [{ path: "/" }] });
    const replayed = shareRun({
      id: "r2",
      createdAt: "2026-09-27T10:00:00-05:00",
      replayed: true,
      pages: [{ path: "/", title: "Replayed" }],
    });
    expect(buildShareModel(inputOf([live, replayed])).header.siteName).toBe("example.illinois.gov");

    // A site with a port is named with it, as its folder is.
    expect((await demoModel()).header.siteName).toBe("127.0.0.1:4848");
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
      siteName: "example.illinois.gov",
      site: SITE,
      tested: null,
      preparedBy: null,
      screenReader: "NVDA",
    });
    expect(model).toMatchObject({
      heard: null,
      changes: null,
      noLongerListed: [],
      flagged: [],
      evidence: [],
      appendix: [],
      check: { runs: [], files: [], reviews: null },
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
      siteName: "example.illinois.gov",
      site: SITE,
      tested: "30 September 2026",
      asOf: "1 October 2026",
      preparedBy: CHRIS,
      screenReader: "NVDA",
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
    expect(evidence?.verify).toBe(`npx @icjia/voicecap verify --site ${SITE}`);
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
});
