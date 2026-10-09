/**
 * What the shareable page reads and says of each page's axe results: the view of a page's axe.json
 * (axeViewOf) and the words worked out from it; the loader, which holds a file only as its run
 * recorded it; each card's results, or why it has none, as a screenshot's place says it; the
 * fingerprint check's data, which carries each file shown, as its exact text; and each run's
 * fingerprints. The verdict, the ring, and What needs attention are the same with axe's results as
 * without them: they are evidence beside the person's review, never its verdict.
 */
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AXE_TAGS, keptAxeResults, MAX_NODES } from "../src/axe/results.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { AxeCapture } from "../src/drivers/types.js";
import type { AxeRecord, RunJson } from "../src/model.js";
import { runAudit } from "../src/run/audit.js";
import { pageDir, runJsonPath } from "../src/run/paths.js";
import { axeCriteria, axeFix, axeRulesRun, axeSelector, axeViewOf } from "../src/share/axe-view.js";
import { renderAttention } from "../src/share/html/attention.js";
import { renderGlance } from "../src/share/html/top.js";
import { loadShareInput } from "../src/share/load.js";
import { buildShareModel, type PageCard, type ShareModel } from "../src/share/model.js";
import { verdictOf } from "../src/share/verdict.js";
import { fileHash } from "../src/transcripts/write.js";
import { sealOf } from "../src/util/hash.js";
import { TINY_RECORD } from "./helpers/jpeg.js";
import { rawAxe, rawNode, rawRule } from "./helpers/raw-axe.js";
import { options as runOptions, setup as setupSite, SITE, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";
import { failedAttempt, shareRun, type SharePageSpec } from "./helpers/share-data.js";
import {
  AXE_RAN_AT,
  axeFilesOf,
  demoModel,
  inputOf,
  keptAxe,
  LINES,
  LINK_FLAG,
  storeOf,
  TRANSCRIPTS,
} from "./helpers/share-model.js";

/** What a card says of a file it can't show: one that isn't as the run recorded it. */
const CHANGED = "Not shown: axe.json isn't as the run recorded it; voicecap verify names it.";
/** What a card says of a record of no kind voicecap writes. */
const UNREADABLE = "Not shown: the run's record of this page's axe check couldn't be read.";
/** What a card says of a page that wasn't read, in a run whose driver checks pages with axe. */
const NOT_READ = "Not checked: axe didn't check this page, since it wasn't read.";
/** What a card says of a page of a run whose driver doesn't check pages with axe. */
const NO_DRIVER = "Not checked: this run's driver doesn't check pages with axe.";
/** What a card says of a file as its run recorded it that isn't axe's results as voicecap keeps them. */
const NOT_RESULTS =
  "Not shown: axe.json is as the run recorded it, but it isn't axe's results as voicecap keeps them.";

/** A rule that found one element, with the tags of a WCAG criterion or of a best practice. */
const rule = (id: string, impact: string | null, tags: string[], help = `The ${id} rule's help`) =>
  rawRule(id, { impact, tags, help });

/** WCAG 2.0 A 4.1.2: what button-name, label, and link-name test, among others. */
const NAME_ROLE = ["cat.name-role-value", "wcag2a", "wcag412", "section508", "EN-301-549", "ACT"];
/** WCAG 2.0 AA 1.4.3: color-contrast. */
const CONTRAST = ["cat.color", "wcag2aa", "wcag143", "TTv5", "EN-9.1.4.3", "ACT"];
/** A best practice, which names no WCAG criterion: region, and page-has-heading-one. */
const BEST = ["cat.keyboard", "best-practice"];

/**
 * What axe found on a page with three issues and one thing to review, given in axe's order, which
 * isn't the order of how much each matters: the page's card shows the most severe first.
 */
function found(): ReturnType<typeof keptAxe> {
  return keptAxe({
    violations: [
      rule("region", "moderate", BEST, "All page content should be contained by landmarks"),
      rule("button-name", "critical", NAME_ROLE, "Buttons must have discernible text"),
      rule("color-contrast", "serious", CONTRAST, "Elements must meet minimum color contrast"),
    ],
    incomplete: [rule("aria-valid-attr-value", "critical", NAME_ROLE)],
    passes: 41,
    inapplicable: 50,
  });
}

/** What axe found on a page with nothing wrong. */
const clean = (): ReturnType<typeof keptAxe> => keptAxe({ passes: 30, inapplicable: 60 });

/** A run of voicecap 0.16.0 (or `voicecapVersion`), the first to check pages with axe. */
const runOf = (pages: SharePageSpec[], voicecapVersion = "0.16.0", id = "r1"): RunJson =>
  shareRun({ id, voicecapVersion, pages });

/** A page read in full, with its three transcripts. */
const done = (pagePath: string, extra: Partial<SharePageSpec> = {}): SharePageSpec => ({
  path: pagePath,
  files: TRANSCRIPTS,
  passes: LINES,
  ...extra,
});

/** The model of some runs, with their transcripts and the axe files keptAxe made of their records. */
const modelOf = (runs: RunJson[]): ShareModel =>
  buildShareModel(inputOf(runs, { transcripts: storeOf(), axeFiles: axeFilesOf(runs) }));

/** The cards of some runs. */
const cardsOf = (...runs: RunJson[]): PageCard[] => modelOf(runs).pages;

/** What a card says in place of axe's results, or null when it shows them. */
function said(card: PageCard | undefined): string | null {
  const axe = card?.axe;
  if (axe === undefined) throw new Error("The card says nothing of axe.");
  return "notRecorded" in axe ? axe.notRecorded : null;
}

/** The results a card shows. */
function shownOf(
  card: PageCard | undefined,
): Exclude<PageCard["axe"], { notRecorded: string } | undefined> {
  const axe = card?.axe;
  if (axe === undefined || "notRecorded" in axe) {
    throw new Error(`The card shows no results: ${axe === undefined ? "none" : axe.notRecorded}`);
  }
  return axe;
}

describe("axeViewOf", () => {
  it("reads a page's axe.json, with its issues and what needs review each most severe first", () => {
    const { text } = found();
    const view = axeViewOf(text);

    expect(view).not.toBeNull();
    expect(view?.axeVersion).toBe("4.13.0");
    expect(view?.tags).toEqual([...AXE_TAGS]);
    expect(view?.counts).toEqual({ violations: 3, incomplete: 1, passes: 41, inapplicable: 50 });
    // axe gave region, button-name, then color-contrast: the most severe come first.
    expect(view?.violations.map(({ id, impact }) => [id, impact])).toEqual([
      ["button-name", "critical"],
      ["color-contrast", "serious"],
      ["region", "moderate"],
    ]);
    expect(view?.incomplete.map(({ id }) => id)).toEqual(["aria-valid-attr-value"]);
    // Each rule as the file keeps it: its words, its address, its tags, and its elements.
    expect(view?.violations[0]).toEqual({
      id: "button-name",
      impact: "critical",
      help: "Buttons must have discernible text",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/button-name?application=axeAPI",
      tags: NAME_ROLE,
      nodes: [
        {
          target: [".button-name"],
          html: '<a href="/next/" class="button-name"></a>',
          failureSummary:
            "Fix any of the following:\n  Element does not have text that is visible to screen readers",
        },
      ],
      moreNodes: 0,
    });
  });

  it("keeps axe's order among rules of one impact, and puts a rule axe gave no impact last", () => {
    const { text } = keptAxe({
      violations: [
        rule("no-impact", null, BEST),
        rule("minor-1", "minor", BEST),
        rule("serious-1", "serious", BEST),
        rule("minor-2", "minor", BEST),
        rule("serious-2", "serious", BEST),
        rule("critical-1", "critical", BEST),
      ],
    });

    expect(axeViewOf(text)?.violations.map(({ id }) => id)).toEqual([
      "critical-1",
      "serious-1",
      "serious-2",
      "minor-1",
      "minor-2",
      "no-impact",
    ]);
  });

  it("reads what voicecap keeps of a rule's elements: 50 of them, and how many more", () => {
    const nodes = Array.from({ length: 400 }, (_, index) => rawNode(`#b-${index}`));
    const view = axeViewOf(keptAxe({ violations: [rawRule("button-name", { nodes })] }).text);

    expect(view?.violations[0]?.nodes).toHaveLength(MAX_NODES);
    expect(view?.violations[0]?.moreNodes).toBe(350);
  });

  it("is null for a text that isn't a page's axe.json as voicecap keeps it", () => {
    const kept = JSON.parse(found().text) as Record<string, unknown>;
    const [first] = kept.violations as Record<string, unknown>[];
    const changed = (patch: Record<string, unknown>) => JSON.stringify({ ...kept, ...patch });
    const ruleChanged = (patch: Record<string, unknown>) =>
      changed({
        violations: [{ ...first, ...patch }],
        counts: { ...(kept.counts as object), violations: 1 },
      });
    const odd = [
      "",
      "not JSON",
      "null",
      "[]",
      '"axe.json"',
      "{}",
      changed({ schemaVersion: 2 }),
      changed({ axeVersion: 4 }),
      changed({ tags: "wcag2a" }),
      changed({ violations: null }),
      // Counts that aren't the rules the file lists.
      changed({ counts: { violations: 2, incomplete: 1, passes: 41, inapplicable: 50 } }),
      changed({ counts: { violations: 3, incomplete: 1, passes: -1, inapplicable: 50 } }),
      ruleChanged({ help: null }),
      // A rule axe names with no id at all, which no heading could name if its words were none.
      ruleChanged({ id: "" }),
      ruleChanged({ impact: "huge" }),
      ruleChanged({ moreNodes: -1 }),
      ruleChanged({ nodes: [{ target: [".a"], failureSummary: "" }] }),
      ruleChanged({ nodes: [{ target: ".a", html: "<a>", failureSummary: "" }] }),
    ];

    for (const text of odd) expect(axeViewOf(text), text.slice(0, 80)).toBeNull();
    // The file as written is one, and so is one with fields a later voicecap might add.
    expect(axeViewOf(found().text)).not.toBeNull();
    expect(axeViewOf(changed({ later: true }))).not.toBeNull();
  });
});

describe("the words of what axe found", () => {
  it("names the rules axe ran, by WCAG's versions and levels, and best practices", () => {
    expect(axeRulesRun(AXE_TAGS)).toBe(
      "WCAG 2.0 and 2.1 at levels A and AA, WCAG 2.2 at level AA, and best practices",
    );
    expect(axeRulesRun(["wcag2a"])).toBe("WCAG 2.0 at level A");
    expect(axeRulesRun(["wcag2a", "wcag2aa", "wcag2aaa"])).toBe(
      "WCAG 2.0 at levels A, AA, and AAA",
    );
    expect(axeRulesRun(["best-practice"])).toBe("best practices");
    // A tag this version doesn't know is named as it is.
    expect(axeRulesRun(["wcag21aa", "section508"])).toBe("WCAG 2.1 at level AA and section508");
    expect(axeRulesRun([])).toBe("");
  });

  it("names the WCAG success criteria a rule's tags name, with their version and level, or a best practice", () => {
    expect(axeCriteria(NAME_ROLE)).toBe("WCAG 2.0 A 4.1.2");
    expect(axeCriteria(CONTRAST)).toBe("WCAG 2.0 AA 1.4.3");
    expect(axeCriteria(["cat.color", "wcag21aa", "wcag1410"])).toBe("WCAG 2.1 AA 1.4.10");
    expect(axeCriteria(["cat.sensory", "wcag22aa", "wcag258"])).toBe("WCAG 2.2 AA 2.5.8");
    expect(axeCriteria(["cat.name-role-value", "wcag2a", "wcag244", "wcag412"])).toBe(
      "WCAG 2.0 A 2.4.4 and 4.1.2",
    );
    expect(axeCriteria(BEST)).toBe("best practice");
    expect(axeCriteria(["cat.x", "wcag2a", "wcag412", "best-practice"])).toBe(
      "WCAG 2.0 A 4.1.2 and best practice",
    );
    expect(axeCriteria(["cat.parsing", "TTv5"])).toBe("");
  });

  it("sets out axe's words on how to fix an element: each lead, and the things under it", () => {
    expect(
      axeFix(
        "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty",
      ),
    ).toEqual([
      {
        lead: "Fix any of the following:",
        items: [
          "Element does not have inner text that is visible to screen readers",
          "aria-label attribute does not exist or is empty",
        ],
      },
    ]);
    expect(
      axeFix(
        "Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element has a value attribute and the value attribute is empty",
      ),
    ).toEqual([
      {
        lead: "Fix all of the following:",
        items: ["Element is in tab order and does not have accessible text"],
      },
      {
        lead: "Fix any of the following:",
        items: ["Element has a value attribute and the value attribute is empty"],
      },
    ]);
    // Words laid out some other way are kept, as they are, line by line; none are nothing.
    expect(axeFix("Element has insufficient color contrast\r\nof 2.1")).toEqual([
      { lead: "Element has insufficient color contrast", items: ["of 2.1"] },
    ]);
    expect(axeFix("")).toEqual([]);
    expect(axeFix(" \n \n")).toEqual([]);
  });

  it("gives an element's selectors, one for each frame from the page in", () => {
    expect(axeSelector(["#menu > button"])).toBe("#menu > button");
    expect(axeSelector(["iframe#chat", "button.send"])).toBe("iframe#chat button.send");
  });
});

describe("loadShareInput: each page's axe results", () => {
  /** What axe found on the scripted site's two pages, as the Guidepup driver keeps it. */
  const captures = {
    home: keptAxeResults(rawAxe({ violations: [rawRule("button-name")], passes: 12 }), `${SITE}/`),
    about: keptAxeResults(rawAxe({ passes: 20 }), `${SITE}/about`),
  };

  /** A site folder with one run of the scripted site, each of whose pages axe checked. */
  async function axeSite(home: AxeCapture = captures.home) {
    const dir = await setupSite(["/", "/about"]);
    const pages = sitePages({ home: { axe: home }, about: { axe: captures.about } });
    const result = await runAudit(runOptions(dir, new ScriptedDriver(pages)));
    expect(result.outcome).toBe("completed");
    return { siteDir: result.siteDir, run: result.run, dir };
  }

  /** Where a page of a run keeps its axe results. */
  const axeFile = (siteDir: string, run: RunJson, index: number): string =>
    path.join(pageDir(siteDir, run.id, run.pages[index]?.slug ?? ""), "axe.json");

  it("reads the axe file of each page the page shows, as the run's record lists it", async () => {
    const { siteDir, run, dir } = await axeSite();
    try {
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

      expect([...input.axeFiles.keys()].sort()).toEqual(
        run.pages.map((page) => `${run.id}/${page.slug}`).sort(),
      );
      expect(input.axeFiles.get(`${run.id}/${run.pages[0]?.slug}`)).toBe(
        await readFile(axeFile(siteDir, run, 0), "utf8"),
      );
      expect(input.axeFiles.get(`${run.id}/${run.pages[0]?.slug}`)).toBe(captures.home.json);
      // The cards show them: one issue on the home page, and none on /about.
      const { pages } = buildShareModel(input);
      expect(pages.map((card) => shownOf(card).view.violations.length)).toEqual([1, 0]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves out a file that's missing, or changed since its run's seal, and the card says verify names it", async () => {
    const { siteDir, run, dir } = await axeSite();
    try {
      await rm(axeFile(siteDir, run, 0));
      await appendFile(axeFile(siteDir, run, 1), " ");
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

      expect(input.axeFiles.size).toBe(0);
      expect(buildShareModel(input).pages.map(said)).toEqual([CHANGED, CHANGED]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves out a file changed to the same size", async () => {
    const { siteDir, run, dir } = await axeSite();
    try {
      const file = axeFile(siteDir, run, 0);
      const text = await readFile(file, "utf8");
      await writeFile(file, text.replace('"button-name"', '"button-nAme"'));
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

      expect(input.axeFiles.has(`${run.id}/${run.pages[0]?.slug}`)).toBe(false);
      expect(input.axeFiles.has(`${run.id}/${run.pages[1]?.slug}`)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads no file for a page whose record says why it has none", async () => {
    const { siteDir, dir } = await axeSite({ error: "timed out after 20s" });
    try {
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });

      expect(input.axeFiles.size).toBe(1);
      expect(said(buildShareModel(input).pages[0])).toBe(
        "axe couldn't check this page: timed out after 20s.",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads no file for a record no voicecap writes, and the card says it couldn't read the record, rather than stop", async () => {
    const { siteDir, run, dir } = await axeSite();
    try {
      const file = runJsonPath(siteDir, run.id);
      const recorded = JSON.parse(await readFile(file, "utf8")) as RunJson;
      const odd: unknown[] = [null, "axe.json"];
      const { seal: _seal, ...unsealed } = {
        ...recorded,
        pages: recorded.pages.map((page, index) => ({ ...page, axe: odd[index] })),
      };
      await writeFile(file, JSON.stringify({ ...unsealed, seal: sealOf(unsealed) }, null, 2));
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });
      const model = buildShareModel(input);

      expect(input.axeFiles.size).toBe(0);
      expect(model.pages.map(said)).toEqual([UNREADABLE, UNREADABLE]);
      expect(model.evidence[0]?.fingerprints.map(({ file: name }) => name)).not.toContain(
        "axe.json",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("holds a file as its run recorded it that isn't UTF-8 text as no results, and the card says so", async () => {
    const { siteDir, run, dir } = await axeSite();
    try {
      // Bytes that aren't UTF-8, which no text the page could carry encodes back to: recorded as
      // the home page's axe file, and the run sealed again, as a record that matches them.
      const bytes = Buffer.from([0x7b, 0xff, 0xfe, 0x7d, 0x0a]);
      await writeFile(axeFile(siteDir, run, 0), bytes);
      const file = runJsonPath(siteDir, run.id);
      const recorded = JSON.parse(await readFile(file, "utf8")) as RunJson;
      const { seal: _seal, ...unsealed } = {
        ...recorded,
        pages: recorded.pages.map((page, index) =>
          index === 0 ? { ...page, axe: { ...page.axe, ...fileHash(bytes) } } : page,
        ),
      };
      await writeFile(file, JSON.stringify({ ...unsealed, seal: sealOf(unsealed) }, null, 2));
      const input = await loadShareInput({ siteDir, config: DEFAULT_CONFIG });
      const model = buildShareModel(input);

      expect(input.axeFiles.get(`${run.id}/${run.pages[0]?.slug}`)).toBe("");
      expect(model.pages.map(said)).toEqual([NOT_RESULTS, null]);
      // The page carries only the file it shows: never one it couldn't carry as it is.
      expect(model.check.axe.map(({ slug }) => slug)).toEqual([run.pages[1]?.slug]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("a page's axe results, on its card", () => {
  it("are the file's view, its exact text, and its fingerprint as the run recorded it", () => {
    const kept = found();
    const run = runOf([done("/about/", { axe: kept.record })]);
    const axe = shownOf(cardsOf(run)[0]);

    expect(axe.text).toBe(kept.text);
    expect(axe.view).toEqual(axeViewOf(kept.text));
    expect(axe).toMatchObject({ bytes: kept.record.bytes, sha256: fileHash(kept.text).sha256 });
    expect(axe.bytes).toBe(Buffer.byteLength(kept.text));
  });

  it("are drawn from the file alone: the record's own counts are never read, so odd ones change nothing", () => {
    // The record's fingerprint names the file, and the file is what the card shows and the check
    // checks, whatever voicecap's version: the record's summary of it is for the run's record.
    const kept = clean();
    const odd = { ...kept.record, counts: "many", impacts: null } as unknown as AxeRecord;
    const run = runOf([done("/", { axe: odd })], "0.14.0");

    expect(shownOf(cardsOf(run)[0]).view.counts.passes).toBe(30);
  });

  describe("says why a page has no results", () => {
    it("for a run from before voicecap checked pages with axe, as it says of every part such a run didn't record", () => {
      for (const version of ["0.15.0", "0.11.0", "0.4.1"]) {
        expect(said(cardsOf(runOf([done("/")], version))[0]), version).toBe(
          `Not recorded: this run used voicecap ${version}.`,
        );
      }
    });

    it("for a check axe couldn't make, with the reason the run recorded", () => {
      const run = runOf([
        done("/", { axe: { error: "timed out after 20s", ranAt: AXE_RAN_AT } }),
        done("/a", { axe: { error: "Execution context was destroyed.", ranAt: AXE_RAN_AT } }),
        done("/b", {
          axe: { error: ` couldn't read ${os.homedir()}/axe.min.js. \n`, ranAt: AXE_RAN_AT },
        }),
        done("/c", { axe: { error: " . ", ranAt: AXE_RAN_AT } }),
      ]);
      const home = process.platform === "win32" ? "%USERPROFILE%" : "~";

      expect(cardsOf(run).map(said)).toEqual([
        "axe couldn't check this page: timed out after 20s.",
        "axe couldn't check this page: Execution context was destroyed.",
        `axe couldn't check this page: couldn't read ${home}/axe.min.js.`,
        "axe couldn't check this page.",
      ]);
    });

    it("for a run of voicecap 0.16.0 or later whose driver checks no page: that it doesn't", () => {
      for (const version of ["0.16.0", "0.17.2", "1.0.0"]) {
        expect(cardsOf(runOf([done("/"), done("/a")], version)).map(said), version).toEqual([
          NO_DRIVER,
          NO_DRIVER,
        ]);
      }
    });

    it("for a page of a run whose driver checks pages, that wasn't read: skipped, or failed before it loaded", () => {
      const run = runOf([
        done("/", { axe: clean().record }),
        { path: "/pdf", status: "skipped" },
        {
          path: "/down",
          status: "failed",
          failedAttempts: [failedAttempt({ n: 1, command: "openPage", pass: "read", step: null })],
        },
      ]);

      expect(cardsOf(run).map(said)).toEqual([null, NOT_READ, NOT_READ]);
    });

    it("for a file the page can't show: that it isn't as the run recorded it, and that verify names it", () => {
      const kept = clean();
      const run = runOf([done("/", { axe: kept.record })]);
      const slug = run.pages[0]?.slug ?? "";

      // The loader holds a file only when it's as its record has it, so a page without one is that.
      expect(said(buildShareModel(inputOf([run])).pages[0])).toBe(CHANGED);
      // A file of another run's page, or another page's, isn't this page's.
      for (const key of [`r0/${slug}`, "r1/another-page"]) {
        const input = inputOf([run], { axeFiles: new Map([[key, kept.text]]) });
        expect(said(buildShareModel(input).pages[0]), key).toBe(CHANGED);
      }
    });

    it("for a file as the run recorded it that isn't axe's results as voicecap keeps them", () => {
      const text = '{"schemaVersion": 1, "note": "not axe"}\n';
      const record: AxeRecord = { ...clean().record, ...fileHash(text) };
      const run = runOf([done("/", { axe: record })]);
      const slug = run.pages[0]?.slug ?? "";
      const input = inputOf([run], { axeFiles: new Map([[`r1/${slug}`, text]]) });

      expect(said(buildShareModel(input).pages[0])).toBe(NOT_RESULTS);
    });

    it("for a record no voicecap writes, rather than stop", () => {
      const records: unknown[] = [null, "axe.json", 42, [], {}, { ranAt: AXE_RAN_AT }];
      const run = runOf([
        done("/", { axe: clean().record }),
        ...records.map((axe, index) => done(`/odd-${index}`, { axe: axe as AxeRecord })),
      ]);
      const model = modelOf([run]);

      expect(model.pages.map(said)).toEqual([null, ...records.map(() => UNREADABLE)]);
      expect(model.check.axe).toHaveLength(1);
      expect(
        model.evidence[0]?.fingerprints.filter(({ file }) => file === "axe.json"),
      ).toHaveLength(1);
    });
  });

  describe("is the check of the record the card speaks for", () => {
    it("the transcripts' run, for a page whose latest run failed it, though that failure has results of its own", () => {
      const earlier = shareRun({
        id: "r1",
        createdAt: "2026-09-25T10:00:00-05:00",
        voicecapVersion: "0.16.0",
        pages: [done("/", { axe: found().record })],
      });
      // The latest run loaded the page, checked it, and then failed it.
      const latest = shareRun({
        id: "r2",
        voicecapVersion: "0.16.0",
        pages: [
          {
            path: "/",
            status: "failed",
            axe: clean().record,
            failedAttempts: [failedAttempt({ n: 1 })],
          },
        ],
      });
      const model = modelOf([earlier, latest]);

      expect(shownOf(model.pages[0]).view.violations).toHaveLength(3);
      expect(model.check.axe.map(({ run }) => run)).toEqual(["r1"]);
    });

    it("the latest failure's, for a page that was never transcribed", () => {
      const run = runOf([
        {
          path: "/",
          status: "failed",
          axe: found().record,
          failedAttempts: [failedAttempt({ n: 1 })],
        },
      ]);
      const [card] = cardsOf(run);

      expect(card?.status).toBe("never");
      expect(shownOf(card).view.violations).toHaveLength(3);
    });

    it("the run's own: a page of a run begun on 0.15.0 and resumed on 0.16.0 says what its own session's voicecap did", () => {
      const run = shareRun({
        id: "r1",
        voicecapVersion: "0.15.0",
        sessions: [
          {},
          { environment: { voicecap: { version: "0.16.0", configSha256: "c".repeat(64) } } },
        ],
        pages: [
          done("/", { session: 1 }),
          done("/a", { session: 2, axe: clean().record }),
          { path: "/b", session: 2, status: "skipped" },
        ],
      });
      const cards = cardsOf(run);

      expect(said(cards[0])).toBe("Not recorded: this run used voicecap 0.15.0.");
      expect(said(cards[1])).toBeNull();
      expect(said(cards[2])).toBe(NOT_READ);
    });
  });

  it("is listed for the page's fingerprint check once for each page that shows one, with its exact text", () => {
    const shown = found();
    const missing = clean();
    const run = runOf([
      done("/a", { axe: shown.record }),
      done("/b"),
      done("/c", { axe: { error: "timed out after 20s", ranAt: AXE_RAN_AT } }),
      done("/d", { axe: { ...missing.record, sha256: "d".repeat(64), bytes: 400 } }),
      { path: "/e", status: "skipped" },
    ]);
    const [a, , , d] = run.pages;
    const model = modelOf([run]);

    expect(model.check.axe).toEqual([
      { run: "r1", slug: a?.slug, name: "axe.json", text: shown.text },
    ]);
    // The evidence lists what the record lists, after the page's transcripts, shown or not.
    expect(model.evidence[0]?.fingerprints.filter(({ file }) => file === "axe.json")).toEqual([
      {
        page: "/a",
        file: "axe.json",
        bytes: shown.record.bytes,
        sha256: fileHash(shown.text).sha256,
      },
      { page: "/d", file: "axe.json", bytes: 400, sha256: "d".repeat(64) },
    ]);
    expect(d?.axe).toMatchObject({ bytes: 400 });
    // The check's copy of the run's record is as recorded, which the seal covers.
    expect(model.check.runs[0]?.pages[0]?.axe).toEqual(shown.record);
  });

  it("follows the page's screenshot among the run's fingerprints", () => {
    const kept = clean();
    const run = runOf([
      done("/", { files: ["read.txt"], screenshot: TINY_RECORD, axe: kept.record }),
    ]);

    expect(modelOf([run]).evidence[0]?.fingerprints.map(({ file }) => file)).toEqual([
      "read.txt",
      "screenshot.jpg",
      "axe.json",
    ]);
  });

  it("is in no run of the demo, which recorded none", async () => {
    const model = await demoModel();

    expect(model.check.axe).toEqual([]);
    expect(model.pages.map(said)).toEqual(
      model.pages.map(() => "Not recorded: this run used voicecap 0.4.1."),
    );
    expect(
      model.evidence.flatMap((each) => each.fingerprints).filter((f) => f.file === "axe.json"),
    ).toEqual([]);
  });
});

describe("axe's results beside the verdict", () => {
  it("keeps the verdict, the ring, the numbers, and What needs attention as they are without them", () => {
    // The same pages, with flags, a failure, and a skip, with axe's results and without them.
    const pages = (withAxe: boolean): SharePageSpec[] => [
      done("/", { flags: [LINK_FLAG], ...(withAxe ? { axe: found().record } : {}) }),
      done("/a", withAxe ? { axe: clean().record } : {}),
      {
        path: "/b",
        status: "failed",
        failedAttempts: [failedAttempt({ n: 1 })],
        ...(withAxe ? { axe: found().record } : {}),
      },
      { path: "/c", status: "skipped" },
    ];
    const [plain, checked] = [false, true].map((withAxe) =>
      modelOf([runOf(pages(withAxe), "0.16.0")]),
    ) as [ShareModel, ShareModel];

    // The axe results are there, and say there are issues.
    expect(checked.pages.map((card) => card.axe !== undefined && "view" in card.axe)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(checked.result).toEqual(plain.result);
    expect(checked.ring).toEqual(plain.ring);
    expect(checked.attention).toEqual(plain.attention);
    expect(checked.summary).toEqual(plain.summary);
    expect(verdictOf(checked.result)).toEqual(verdictOf(plain.result));
    // And so At a glance and What needs attention are drawn the same.
    expect(renderGlance(checked)).toBe(renderGlance(plain));
    expect(renderAttention(checked)).toBe(renderAttention(plain));
    // A card's other parts are its own as before: only `axe` is new.
    expect(checked.pages.map(({ axe: _axe, ...rest }) => rest)).toEqual(
      plain.pages.map(({ axe: _axe, ...rest }) => rest),
    );
  });
});
