/**
 * The Word copy's "What these results cover", "The evidence behind these results", "How voicecap came
 * to be", and its footer, as blocks: what they say, in the page's order. The demo runs of 29 September
 * 2026 (voicecap 0.4.1, in test/fixtures/share/) are the real case: two runs from before voicecap
 * recorded most of the evidence, and two interrupted runs left out. Runs built in memory cover the
 * rest: a run from after voicecap recorded the computer, a run whose record lists no file, no run
 * that counts, and words that must stay words. The blocks are plain data, so nothing here opens a
 * .docx (the whole document's tests, in share-word-outline.test.ts, do).
 *
 * Two runs of one voicecap say the same "Not recorded" lines, and a check that some words are
 * somewhere in the evidence could pass on another run's identical words. So the tests look at each
 * run's own part of the outline.
 */
import { describe, expect, it } from "vitest";

import type { MachineRecord, PassName } from "../src/model.js";
import {
  renderCoverage,
  renderEvidence,
  renderFooter,
  renderStory,
} from "../src/share/html/evidence.js";
import { firstSentenceBold, lineOfMarkup, lineText } from "../src/share/line.js";
import type { ShareInput, TranscriptStore } from "../src/share/load.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import {
  ABOUT,
  EVIDENCE_TEXT,
  FOOTER_TEXT,
  STORY,
  STORY_TEXT,
  TIMELINE,
  TOP_TEXT,
  WORD_TEXT,
  WORTH_KNOWING,
  type TimelineRow,
} from "../src/share/text.js";
import type { SessionTimeline } from "../src/share/timeline.js";
import {
  byteCount,
  evidenceGist,
  generatedLine,
  inRun,
  timelineDay,
  whenOf,
  whyLine,
} from "../src/share/words.js";
import { heading, mono, monoCell, para, wordsOf, type Block } from "../src/share/word/blocks.js";
import { wordCoverage, wordEvidence, wordFooter, wordStory } from "../src/share/word/evidence.js";
import { TINY_RECORD } from "./helpers/jpeg.js";
import { shareRun, type SharePageSpec } from "./helpers/share-data.js";
import { foldsIn, rowsOf, termsOf, textOf } from "./helpers/share-html.js";
import {
  DEMO_ROOT,
  demoModel,
  downloadOf,
  inputOf,
  LINES,
  LOG_HASH,
  loggedModel,
  loggedRun,
  resumedLoggedRun,
  STEP_LIMIT_PROBLEM,
  storeOf,
  TRANSCRIPTS,
  withOwnFiles,
  withStepLimit,
} from "./helpers/share-model.js";
import {
  boldIn,
  cellLines,
  hrefsOf,
  linesIn,
  outlineOf,
  partsAt,
  saysOf,
  tableAt,
  tablesIn,
  under,
} from "./helpers/word.js";

/** The demo's two runs, the latest first. */
const DEMO_RUNS = ["2026-09-29_1402", "2026-09-29_1315"];

/** What the demo runs, from voicecap 0.4.1, say of what they didn't record. */
const NOT_RECORDED = "Not recorded: this run used voicecap 0.4.1.";

/** Why a run is left out, as the page says it. */
const PAGE_LEFT_OUT_LEAD =
  "These runs aren't counted in any result on this page. A run counts only when it completed, was sealed, and wasn't a replay.";

/**
 * The same, as the Word copy says it: "in this report" where the page says "on this page", since in
 * a Word document "this page" reads as the printed page.
 */
const LEFT_OUT_LEAD =
  "These runs aren't counted in any result in this report. A run counts only when it completed, was sealed, and wasn't a replay.";

/** The computer a session recorded, as voicecap 0.6.0 and later record it. */
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

/** A page read in full, with its three transcripts. */
function done(pagePath: string): SharePageSpec {
  return { path: pagePath, files: TRANSCRIPTS, passes: LINES };
}

/** One run of the pages given, with every transcript they list readable. */
function modelOf(pages: SharePageSpec[], overrides: Partial<ShareInput> = {}): ShareModel {
  return buildShareModel(
    inputOf([shareRun({ id: "r1", pages })], { transcripts: storeOf(), ...overrides }),
  );
}

/** A site whose only run was a replay, so no run counts. */
function noRunModel(): ShareModel {
  return buildShareModel(
    inputOf([shareRun({ id: "2026-09-26_1405", replayed: true, pages: [{ path: "/" }] })]),
  );
}

/**
 * Two runs of one site from two times of voicecap: one from before it recorded the computer, and a
 * later one from after, with the person's name and what they heard. The later one reads one page.
 */
function twoEraModel(): ShareModel {
  const earlier = shareRun({
    id: "old",
    createdAt: "2026-09-26T14:05:00-05:00",
    pages: [done("/"), done("/a/")],
  });
  const latest = shareRun({
    id: "new",
    createdAt: "2026-09-27T09:30:00-05:00",
    voicecapVersion: "0.6.0",
    sessions: [{ reviewer: "Pat Lee", listener: "all", environment: { machine: MACHINE } }],
    pages: [done("/")],
  });
  return buildShareModel(inputOf([earlier, latest], { transcripts: storeOf() }));
}

/** A run of two pages, Home and About, whose transcripts `gone` names can't be read. */
function unreadableModel(gone: [path: string, pass: PassName][]): ShareModel {
  const run = shareRun({
    id: "r1",
    pages: [
      { path: "/", label: "Home", files: TRANSCRIPTS, passes: LINES },
      { path: "/about/", label: "About", files: TRANSCRIPTS, passes: LINES },
    ],
  });
  const slugOf = (path: string) =>
    run.pages.find((page) => new URL(page.url).pathname === path)?.slug ?? "";
  const keys = new Set(gone.map(([path, pass]) => `${slugOf(path)}|${pass}`));
  const all = storeOf();
  const transcripts: TranscriptStore = {
    txt: (id, slug, pass) => (keys.has(`${slug}|${pass}`) ? null : all.txt(id, slug, pass)),
    steps: (id, slug, pass) => all.steps(id, slug, pass),
  };
  return buildShareModel(inputOf([run], { transcripts }));
}

/** The model with some fields of its footer changed. */
function withFooter(model: ShareModel, footer: Partial<ShareModel["footer"]>): ShareModel {
  return { ...model, footer: { ...model.footer, ...footer } };
}

/** The parts of the evidence that are a run's: a heading 2 and what is inside it, latest first. */
function runParts(model: ShareModel): Block[][] {
  return partsAt(wordEvidence(model), 2).slice(0, model.evidence.length);
}

/** The part of the evidence that is the runs left out, when there are any. */
function leftOutPart(model: ShareModel): Block[] | undefined {
  return partsAt(wordEvidence(model), 2)[model.evidence.length];
}

/** A run's part, which a test reads by place. */
function partOf(parts: Block[][], at: number): Block[] {
  const found = parts[at];
  if (found === undefined) throw new Error(`No part at ${at}`);
  return found;
}

describe("wordCoverage", () => {
  it("says the model's two lists, each as a list under its own heading", async () => {
    const model = await demoModel();
    const blocks = wordCoverage(model);

    expect(outlineOf(blocks)).toEqual([
      "1 What these results cover",
      "2 Covered",
      "2 Technical limits",
    ]);
    expect(blocks.map(({ kind }) => kind)).toEqual([
      "heading",
      "heading",
      "list",
      "heading",
      "list",
    ]);
    expect(wordsOf(under(blocks, "Covered"))).toEqual(model.coverage.covered);
    expect(wordsOf(under(blocks, "Technical limits"))).toEqual(model.coverage.limits);
    // The demo's own: the sitemap, the three passes, the problems, and the Chrome that updated.
    expect(model.coverage.covered[0]).toBe(
      "7 pages from the sitemap http://127.0.0.1:4848/sitemap.xml.",
    );
    expect(model.coverage.limits).toHaveLength(3);
  });

  it("says each line as a line of its own, as it is", async () => {
    const model = await demoModel();
    const lists = wordCoverage(model).filter((block) => block.kind === "list");

    expect(lists.map((block) => (block.kind === "list" ? block.items : []))).toEqual([
      model.coverage.covered.map((line) => [line]),
      model.coverage.limits.map((line) => [line]),
    ]);
  });

  it("says the line on problems in plain words, since it links to a part of the page this copy has in order", async () => {
    const model = await demoModel();
    const blocks = wordCoverage(model);

    expect(wordsOf(blocks)).toContain(
      "Every problem during the runs is explained under Problems during the runs.",
    );
    expect(hrefsOf(blocks)).toEqual([]);
    // The page links it to the section.
    expect(renderCoverage(model)).toContain('<a href="#prob-h">Problems during the runs</a>');
  });

  it("leaves out a panel with no lines, rather than show it empty", async () => {
    const model = await demoModel();
    const none = noRunModel();

    expect(none.coverage.limits).toEqual([]);
    expect(wordsOf(wordCoverage(none))).toEqual([
      "What these results cover",
      "Covered",
      "No live run counts yet, so these results cover no pages.",
    ]);
    expect(outlineOf(wordCoverage(none))).toEqual(["1 What these results cover", "2 Covered"]);
    expect(
      outlineOf(wordCoverage({ ...model, coverage: { covered: [], limits: ["A limit."] } })),
    ).toEqual(["1 What these results cover", "2 Technical limits"]);
  });

  it("keeps what the model says as words, never as markup", async () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const blocks = wordCoverage({
      ...(await demoModel()),
      coverage: { covered: [hostile], limits: ["<b>Chrome</b> & more"] },
    });

    expect(wordsOf(blocks)).toEqual([
      "What these results cover",
      "Covered",
      hostile,
      "Technical limits",
      "<b>Chrome</b> & more",
    ]);
  });

  it("says what the page says: its heading, its two panels' titles, and each line", async () => {
    let seen = 0;

    for (const model of [await demoModel(), noRunModel(), twoEraModel()]) {
      const html = renderCoverage(model);
      const words = wordsOf(wordCoverage(model));
      const said = [
        ...[...html.matchAll(/<h[23][^>]*>(.*?)<\/h[23]>/g)].map((found) => found[1] ?? ""),
        ...[...html.matchAll(/<li>(.*?)<\/li>/g)].map((found) => found[1] ?? ""),
      ].map((piece) => textOf(piece, ""));

      for (const piece of said) expect(words, piece).toContain(piece);
      seen += said.length;
    }
    expect(seen).toBeGreaterThan(15);
  });
});

describe("wordEvidence", () => {
  describe("for the demo runs of 29 September 2026", () => {
    it("opens with its heading, the line on how many runs there are, and what a fingerprint is, the question in bold", async () => {
      const model = await demoModel();
      const blocks = wordEvidence(model);

      expect(blocks.slice(0, 3)).toEqual([
        heading(1, "The evidence behind these results"),
        para(...evidenceGist(model)),
        para(...firstSentenceBold(EVIDENCE_TEXT.fingerprint)),
      ]);
      expect(wordsOf(blocks.slice(1, 3))).toEqual([
        `2 runs, both completed and sealed. The flags were computed with the current flag rules, fingerprint ${model.flagRulesSha256}.`,
        "What's a fingerprint? A fingerprint (SHA-256) is a code computed from a file's exact contents: change one character, and it changes completely. voicecap took one of every file as it wrote it, so a matching fingerprint shows the file hasn't changed since.",
      ]);
      const [, gist, what] = blocks;
      expect(gist?.kind === "para" ? boldIn(gist.line) : []).toEqual([
        "2 runs, both completed and sealed.",
      ]);
      expect(what?.kind === "para" ? boldIn(what.line) : []).toEqual(["What's a fingerprint?"]);
    });

    // The demo's runs read a copy at http://127.0.0.1:4848, on the tester's computer; its canonical
    // address is the demo's, on the website. The line says it read a copy, and never where.
    it("says the runs read a copy, and names no address, right under its opening line", async () => {
      const model = await demoModel(DEMO_ROOT);
      const blocks = wordEvidence(model);

      expect(model.header.readFrom).toBe("local");
      expect(blocks.slice(0, 4)).toEqual([
        heading(1, "The evidence behind these results"),
        para(...evidenceGist(model)),
        para("These runs read a copy of the site on the computer that ran them."),
        para(...firstSentenceBold(EVIDENCE_TEXT.fingerprint)),
      ]);
      // A copy anywhere else is said so too, with no more of an address.
      const elsewhere = wordEvidence({
        ...model,
        header: { ...model.header, readFrom: "elsewhere" },
      });
      expect(wordsOf(elsewhere.slice(2, 3))).toEqual([
        "These runs read a copy of the site at another address.",
      ]);
    });

    it("says nothing of a copy when the runs read the site itself, or no canonical address names it", async () => {
      const model = await demoModel(DEMO_ROOT);
      const said = (made: ShareModel) => saysOf(wordEvidence(made));

      expect(said({ ...model, header: { ...model.header, readFrom: "same" } })).not.toContain(
        "These runs read a copy",
      );
      expect(said(await demoModel())).not.toContain("These runs read a copy");
      expect(said({ ...model, evidence: [] })).not.toContain("These runs read a copy");
    });

    it("says what a reader can check in place of the page's check: that a Word document can't check itself, the two checks, and the web page's own", async () => {
      const model = await demoModel();
      const verify = "npx @icjia/voicecap verify";
      const checks = wordEvidence(model).slice(3, 6);

      expect(model.evidence[0]?.verify).toBe(verify);
      expect(model.footer.fileName).toBe("current.html");
      expect(checks.map(({ kind }) => kind)).toEqual(["para", "list", "para"]);
      expect(wordsOf(checks)).toEqual([
        "A Word document can't check itself. Two checks show whether anything has changed:",
        "Compare this file's own fingerprint with the one its sender recorded. voicecap share prints it, ready for the email that sends the file. Get-FileHash <file> in PowerShell, or shasum -a 256 <file> on a Mac, shows it for the file you received.",
        `Run ${verify} on the transcripts folder. It checks every recorded file against its fingerprint, and every sealed record against its seal.`,
        "This report's web page, current.html, can also check the transcripts it shows against their fingerprints, in any browser, offline.",
      ]);
      expect(checks).toEqual([
        para(WORD_TEXT.evidence.checks),
        { kind: "list", items: [WORD_TEXT.evidence.compare(), WORD_TEXT.evidence.verify(verify)] },
        para(...WORD_TEXT.evidence.webPage("current.html")),
      ]);
    });

    it("sets the commands and the web page's file name in the fixed-width font", async () => {
      const checks = wordEvidence(await demoModel()).slice(3, 6);
      const mono = linesIn(checks).flatMap((line) =>
        line.flatMap((piece) => (typeof piece !== "string" && piece.mono ? [piece.text] : [])),
      );

      expect(mono).toEqual([
        "voicecap share",
        "Get-FileHash <file>",
        "shasum -a 256 <file>",
        "npx @icjia/voicecap verify",
        "current.html",
      ]);
    });

    it("names the web page by the file name the model gives, and the command that checks the originals by the latest run's, each run's own beneath its fingerprints", async () => {
      const demo = await demoModel();
      const [first, ...rest] = demo.evidence;
      if (first === undefined) throw new Error("The demo has runs.");
      const command = "npx @icjia/voicecap verify --site http://other.example/";
      const model: ShareModel = {
        ...withFooter(demo, { fileName: "127.0.0.1_4848_2026-09-30.html" }),
        evidence: [{ ...first, verify: command }, ...rest],
      };
      const checks = wordsOf(wordEvidence(model).slice(3, 6));
      const [latest, earlier] = runParts(model);

      expect(checks[2]).toMatch(
        /^Run npx @icjia\/voicecap verify --site http:\/\/other\.example\/ on /,
      );
      expect(checks.at(-1)).toBe(
        "This report's web page, 127.0.0.1_4848_2026-09-30.html, can also check the transcripts it shows against their fingerprints, in any browser, offline.",
      );
      // Each run's own, under its fingerprints: the last line of that part.
      const fingerprints = (part: Block[] | undefined, id: string) =>
        under(part ?? [], `${EVIDENCE_TEXT.parts.fingerprints} ${inRun(id)}`);
      expect(wordsOf(fingerprints(latest, first.run.id)).at(-1)).toBe(command);
      expect(wordsOf(fingerprints(earlier, rest[0]?.run.id ?? "")).at(-1)).toBe(
        "npx @icjia/voicecap verify",
      );
    });

    it("says nothing of a check of its own: not the page's buttons, its result, its list of files, or its line on the sealed records", async () => {
      const model = await demoModel();
      const page = textOf(renderEvidence(model).replace(/<script.*?<\/script>/s, ""));
      const said = saysOf(wordEvidence(model));
      const phrases = [
        "Check the fingerprints",
        "Show a change being caught",
        "This page carries the sealed records exactly as voicecap wrote them",
        "Every file checked",
        "To check the fingerprints without scripts",
        "What the check proves",
      ];

      for (const phrase of phrases) {
        // The page says each, so a check for one that isn't there can't pass for nothing.
        expect(page, phrase).toContain(phrase);
        expect(said, phrase).not.toContain(phrase);
      }
      // What it says of a check is the web page's: nothing is said as the Word copy's own.
      expect(said).not.toMatch(/\b(?:this|the) check\b/i);
    });

    it("has a heading 2 for each run, the latest first, with its five parts as heading 3s that name the run", async () => {
      expect(outlineOf(wordEvidence(await demoModel()))).toEqual([
        "1 The evidence behind these results",
        ...DEMO_RUNS.flatMap((id) => [
          `2 Run ${id}`,
          `3 Minute by minute in run ${id}`,
          `3 NVDA's own log, checked against the transcripts in run ${id}`,
          `3 Test environment in run ${id}`,
          `3 Fingerprints (SHA-256) in run ${id}`,
          `3 Walkthrough file in run ${id}`,
        ]),
        "2 Runs left out",
      ]);
    });

    it("says when each run ran, and that it completed and was sealed, in a line of its own", async () => {
      const model = await demoModel();
      const parts = runParts(model);

      expect(parts).toHaveLength(2);
      expect(wordsOf(partOf(parts, 0).slice(0, 2))).toEqual([
        "Run 2026-09-29_1402",
        "29 September 2026, 14:02 to 14:09. Completed and sealed.",
      ]);
      expect(wordsOf(partOf(parts, 1).slice(0, 2))).toEqual([
        "Run 2026-09-29_1315",
        "29 September 2026, 13:15 to 13:21. Completed and sealed.",
      ]);
      for (const [index, each] of model.evidence.entries()) {
        expect(partOf(parts, index)[1]).toEqual(para(`${whenOf(each.run)}. Completed and sealed.`));
      }
    });

    it("lists each run's facts as a table of What and What the run recorded, a row for each the model has, the label in bold", async () => {
      const model = await demoModel();
      const parts = runParts(model);

      for (const [index, each] of model.evidence.entries()) {
        const facts = tableAt(partOf(parts, index), 0);

        expect(facts.head).toEqual(EVIDENCE_TEXT.rowsHead);
        expect(wordsOf([facts])).toEqual([
          "What | What the run recorded",
          ...each.facts.map(({ label, value }) => `${label} | ${value}`),
        ]);
        expect(facts.rows.map((row) => row[0]?.lines.flatMap(boldIn))).toEqual(
          each.facts.map(({ label }) => [label]),
        );
        // The label and the words are each a cell with one line in it.
        expect(facts.rows.every((row) => row.every((cell) => cell.lines.length === 1))).toBe(true);
      }
      expect(wordsOf([tableAt(partOf(parts, 0), 0)])).toContain(
        "Pages | 6 transcribed and 1 failed",
      );
    });

    it("gives each run its own facts: the transcripts each shows, and when it ran, never the other's", async () => {
      const parts = runParts(await demoModel());
      const [latest, earlier] = [partOf(parts, 0), partOf(parts, 1)].map(saysOf);

      expect(latest).toContain("Transcripts shown | 6 pages");
      expect(latest).toContain("Started | 29 September 2026, 14:02");
      expect(latest).not.toContain("Transcripts shown | 1 page");
      expect(latest).not.toContain("13:15");
      expect(earlier).toContain("Transcripts shown | 1 page");
      expect(earlier).toContain("Started | 29 September 2026, 13:15");
      expect(earlier).not.toContain("Transcripts shown | 6 pages");
      expect(earlier).not.toContain("14:02");
    });

    it("says what each run didn't record, as 'Not recorded', in the two parts no run records, in each run's own part", async () => {
      const model = await demoModel();
      const parts = runParts(model);

      for (const [index, each] of model.evidence.entries()) {
        const part = partOf(parts, index);
        const id = each.run.id;
        const timeline = under(part, `${EVIDENCE_TEXT.parts.timeline} ${inRun(id)}`);
        const log = under(part, `${EVIDENCE_TEXT.parts.nvdaLog} ${inRun(id)}`);

        expect(timeline, id).toEqual([para(NOT_RECORDED)]);
        expect(log, id).toEqual([para(NOT_RECORDED)]);
      }
    });

    it("shows each run's test environment as a table, a row for each the model has, with the parts the run didn't record saying so", async () => {
      const model = await demoModel();
      const parts = runParts(model);

      for (const [index, each] of model.evidence.entries()) {
        const environment = tableAt(partOf(parts, index), 1);

        expect(environment.head).toEqual(["What", "What the run recorded"]);
        expect(environment.rows).toHaveLength(each.environment.length);
        expect(wordsOf([environment])).toEqual([
          "What | What the run recorded",
          ...each.environment.map(({ label, value }) => `${label} | ${value}`),
        ]);
        // A run from before voicecap recorded the computer says so for each part of it.
        for (const label of [
          "Processor",
          "Memory",
          "Display",
          "Browser window",
          "Time zone",
          "Display language",
          "Software",
        ]) {
          expect(wordsOf([environment]), `${each.run.id}: ${label}`).toContain(
            `${label} | ${NOT_RECORDED}`,
          );
        }
        expect(wordsOf([environment])).toContain(
          "Operating system | Windows 11 Pro 25H2 (10.0.26200)",
        );
        expect(environment.rows.map((row) => row[0]?.lines.flatMap(boldIn))).toEqual(
          each.environment.map(({ label }) => [label]),
        );
      }
    });

    it("shows each run's fingerprints as a table, a row for each file its record lists, with the fingerprint in the fixed-width font", async () => {
      const model = await demoModel();
      const parts = runParts(model);

      for (const [index, each] of model.evidence.entries()) {
        const files = tableAt(partOf(parts, index), 2);

        expect(files.head).toEqual(["Page", "File", "Size", "SHA-256"]);
        expect(each.fingerprints.length).toBeGreaterThan(30);
        expect(files.rows.length).toBe(each.fingerprints.length);
        expect(wordsOf([files])).toEqual([
          "Page | File | Size | SHA-256",
          ...each.fingerprints.map(
            ({ page, file, bytes, sha256 }) =>
              `${page} | ${file} | ${byteCount(bytes)} | ${sha256}`,
          ),
        ]);
        expect(files.rows.map((row) => row[3])).toEqual(
          each.fingerprints.map(({ sha256 }) => monoCell(sha256)),
        );
        // Everything else in a row is in the ordinary font.
        expect(files.rows.flatMap((row) => row.slice(0, 3).map((cell) => cell.mono))).toEqual(
          each.fingerprints.flatMap(() => [undefined, undefined, undefined]),
        );
      }
    });

    it("lists a page's screenshot among the run's files, after the page's transcripts, as the page does", () => {
      const run = shareRun({
        id: "r1",
        pages: [
          { path: "/", files: ["read.txt"], screenshot: TINY_RECORD },
          { path: "/b", screenshot: { error: "timed out", takenAt: TINY_RECORD.takenAt } },
        ],
      });
      const part = partOf(runParts(buildShareModel(inputOf([run]))), 0);
      const files = tablesIn(part).find((table) => table.head[0] === "Page");

      // A record of why there's none lists no file.
      expect(files && wordsOf([files])).toEqual([
        "Page | File | Size | SHA-256",
        `/ | read.txt | ${byteCount(1)} | ${"0".repeat(64)}`,
        `/ | screenshot.jpg | ${byteCount(TINY_RECORD.bytes)} | ${TINY_RECORD.sha256}`,
      ]);
    });

    it("lists the run's own files first, its event log as the run's, as the page does", () => {
      const run = withOwnFiles(
        shareRun({ id: "r1", pages: [{ path: "/", files: ["read.txt"] }] }),
        { "events.jsonl": LOG_HASH },
      );
      const part = partOf(runParts(buildShareModel(inputOf([run]))), 0);
      const files = tablesIn(part).find((table) => table.head[0] === "Page");

      expect(files && wordsOf([files])).toEqual([
        "Page | File | Size | SHA-256",
        `The run | events.jsonl | ${byteCount(LOG_HASH.bytes)} | ${LOG_HASH.sha256}`,
        `/ | read.txt | ${byteCount(1)} | ${"0".repeat(64)}`,
      ]);
      expect(files?.rows[0]?.[3]).toEqual(monoCell(LOG_HASH.sha256));
    });

    it("gives each run its own fingerprints, never the other's", async () => {
      const parts = runParts(await demoModel());
      const latest = "f30b29d0b01e47a5e2eb629251018fd09b8392197d46fc64277c574ebef365fe";
      const before = "b4842f2d666dac322f576c0f87a97744b6fd0a769559729b449f28f1bd251d4e";

      expect(wordsOf([tableAt(partOf(parts, 0), 2)])[1]).toBe(
        `/ | read.txt | 2,306 bytes | ${latest}`,
      );
      expect(wordsOf([tableAt(partOf(parts, 1), 2)])[1]).toBe(
        `/ | read.txt | 2,306 bytes | ${before}`,
      );
      expect(saysOf(partOf(parts, 0))).not.toContain(before);
      expect(saysOf(partOf(parts, 1))).not.toContain(latest);
      // Nor the other's environment: the Chrome each used, and the config each ran with.
      expect(saysOf(partOf(parts, 0))).toContain("Chrome 154.0.8037.58");
      expect(saysOf(partOf(parts, 0))).not.toContain("Chrome 153.0.8010.53");
      expect(saysOf(partOf(parts, 1))).toContain("Chrome 153.0.8010.53");
      expect(saysOf(partOf(parts, 1))).not.toContain("Chrome 154.0.8037.58");
    });

    it("says, under each run's fingerprints, how to check them against the recorded files, and gives the command as a fixed-width block", async () => {
      const model = await demoModel();
      const parts = runParts(model);

      for (const [index, each] of model.evidence.entries()) {
        const id = each.run.id;
        const inside = under(
          partOf(parts, index),
          `${EVIDENCE_TEXT.parts.fingerprints} ${inRun(id)}`,
        );

        expect(
          inside.map(({ kind }) => kind),
          id,
        ).toEqual(["table", "para", "mono"]);
        expect(inside.slice(1), id).toEqual([para(EVIDENCE_TEXT.verify), mono([each.verify])]);
        expect(wordsOf(inside.slice(1))).toEqual([
          "To check these against the recorded files, anyone with the transcripts folder runs:",
          "npx @icjia/voicecap verify",
        ]);
      }
    });

    it("says how to get each run's walkthrough file, and how to repeat it, under its own heading: both commands as fixed-width blocks", async () => {
      const model = await demoModel();
      const parts = runParts(model);

      for (const [index, each] of model.evidence.entries()) {
        const id = each.run.id;
        const file = downloadOf(each);
        const part = partOf(parts, index);
        const inside = under(part, `${EVIDENCE_TEXT.parts.walkthrough} ${inRun(id)}`);

        expect(
          inside.map(({ kind }) => kind),
          id,
        ).toEqual(["para", "mono", "para", "mono", "para"]);
        expect(inside, id).toEqual([
          para(WORD_TEXT.evidence.walkthrough.lead),
          mono([file.get]),
          para(WORD_TEXT.evidence.walkthrough.then),
          mono([file.repeat]),
          para(EVIDENCE_TEXT.walkthrough.promise),
        ]);
        expect(wordsOf(inside), id).toEqual([
          "To repeat this run exactly, with the same pages in the same order and the same passes and limits, get its walkthrough file from the web page, or with:",
          `npx @icjia/voicecap walkthrough --site http://127.0.0.1:4848 --run ${id} 127.0.0.1_4848_${id}_walkthrough.json`,
          "then run:",
          `npx @icjia/voicecap --walkthrough 127.0.0.1_4848_${id}_walkthrough.json`,
          "A repeat reads the same pages the same way, but can't promise the same words: a changed site, or a newer screen reader or browser, changes what's said. After a repeat, voicecap says page by page whether each sounds the same.",
        ]);
        // The part comes after the fingerprints', and is the last of the run's.
        expect(part.at(-1), id).toEqual(para(EVIDENCE_TEXT.walkthrough.promise));
      }
    });

    it("gives each run its own commands, never the other's", async () => {
      const [latest, earlier] = runParts(await demoModel()).map(saysOf);

      expect(latest).toContain("--run 2026-09-29_1402 ");
      expect(latest).not.toContain("2026-09-29_1315_walkthrough");
      expect(earlier).toContain("--run 2026-09-29_1315 ");
      expect(earlier).not.toContain("2026-09-29_1402_walkthrough");
    });

    it("carries no download: it has no data address, no link, and none of the file", async () => {
      const model = await demoModel();
      const blocks = wordEvidence(model);
      const said = saysOf(blocks);

      expect(hrefsOf(blocks)).toEqual([]);
      for (const piece of ["data:", "base64", "Download the walkthrough file"]) {
        expect(said, piece).not.toContain(piece);
      }
      // The file's own words, as a download carries them in base64.
      for (const each of model.evidence) {
        expect(said).not.toContain(downloadOf(each).base64.slice(0, 40));
      }
    });

    it("says why there is no file, in place of the commands, for a run that can't have one", () => {
      const run = shareRun({ id: "r1", pages: [{ path: "/" }] });
      const model = buildShareModel(inputOf([withStepLimit(run, 100_001)]));
      const [part = []] = runParts(model);

      expect(under(part, "Walkthrough file in run r1")).toEqual([
        para(`This run's walkthrough file can't be made: ${STEP_LIMIT_PROBLEM}`),
      ]);
      expect(saysOf(part)).not.toContain("npx @icjia/voicecap walkthrough");
      expect(saysOf(part)).not.toContain("--walkthrough");
      expect(saysOf(part)).not.toContain("To repeat this run exactly");
      // Every run still has its five parts.
      expect(outlineOf(part)).toHaveLength(6);
    });

    it("keeps the commands as words, never as markup", () => {
      const hostile = '<img src=x onerror="alert(1)"> & more';
      const model = modelOf([done("/")]);
      const [first] = model.evidence;
      if (first === undefined) throw new Error("The model has a run.");
      const evidence = [
        {
          ...first,
          walkthrough: { ...downloadOf(first), get: hostile, repeat: `${hostile} --walkthrough` },
        },
      ];
      const inside = under(
        partOf(runParts({ ...model, evidence }), 0),
        "Walkthrough file in run r1",
      );

      expect(inside[1]).toEqual(mono([hostile]));
      expect(inside[3]).toEqual(mono([`${hostile} --walkthrough`]));
      expect(wordsOf(inside).join("\n")).not.toContain("&lt;");
      expect(wordsOf(inside).join("\n")).not.toContain("&amp;");
    });

    it("lists the runs left out last, with why a run is left out, and a line for each", async () => {
      const model = await demoModel();
      const part = leftOutPart(model) ?? [];

      expect(part.map(({ kind }) => kind)).toEqual(["heading", "para", "list"]);
      expect(wordsOf(part)).toEqual([
        "Runs left out",
        LEFT_OUT_LEAD,
        "2026-09-29_1415: interrupted after 1 of 7 pages",
        "2026-09-29_1419: interrupted after 2 of 7 pages",
      ]);
      expect(wordsOf(part).slice(2)).toEqual(model.leftOut.map(({ text }) => text));
      expect(wordEvidence(model).at(-1)).toEqual(part.at(-1));
    });

    it("links to nothing, since the page's links go to its own parts, which this copy has in order", async () => {
      expect(hrefsOf(wordEvidence(await demoModel()))).toEqual([]);
    });
  });

  describe("a run from after voicecap recorded the computer, beside one from before", () => {
    it("says the computer for the run that has it, and 'Not recorded' for the run that hasn't, each in its own part", () => {
      const model = twoEraModel();
      const [latest, earlier] = runParts(model);

      expect(model.evidence.map(({ run }) => run.id)).toEqual(["new", "old"]);
      const newer = wordsOf([tableAt(latest ?? [], 1)]);
      const older = wordsOf([tableAt(earlier ?? [], 1)]);

      expect(newer).toContain("Operating system | Windows 11 Pro 25H2, build 10.0.26200.9550, x64");
      expect(newer).toContain(
        "Processor | Intel Core Ultra 7 265F, 2.40 GHz base, 20 cores, 20 logical processors",
      );
      expect(newer).toContain("Memory | 31.7 GB");
      expect(newer).toContain("Display | 3440 × 1440 at 59 Hz, 110% scaling");
      expect(newer).toContain("Run by | Pat Lee");
      expect(older).toContain("Processor | Not recorded: this run used voicecap 0.1.0.");
      expect(older).toContain("Memory | Not recorded: this run used voicecap 0.1.0.");
      expect(older).not.toContain("Memory | 31.7 GB");
      expect(saysOf(earlier ?? [])).not.toContain("Intel Core Ultra");
    });

    it("says what each run's person heard, in the run that has an answer, and not for the other", () => {
      const model = twoEraModel();
      const [latest, earlier] = runParts(model);

      expect(wordsOf([tableAt(latest ?? [], 0)])).toContain(
        "Whether NVDA was heard | Yes, the whole time. Asked as the session ended, and answered at 09:30 by Pat Lee.",
      );
      expect(wordsOf([tableAt(earlier ?? [], 0)])).toContain(
        "Whether NVDA was heard | Not recorded: this run used voicecap 0.1.0.",
      );
    });

    it("gives each run the fingerprints of the files its own record lists", () => {
      const model = twoEraModel();
      const [latest, earlier] = runParts(model);

      expect(tableAt(latest ?? [], 2).rows).toHaveLength(3);
      expect(tableAt(earlier ?? [], 2).rows).toHaveLength(6);
      expect(wordsOf([tableAt(latest ?? [], 2)])).not.toContain(
        `/a/ | read.txt | 1 byte | ${"0".repeat(64)}`,
      );
      expect(wordsOf([tableAt(earlier ?? [], 2)])).toContain(
        `/a/ | read.txt | 1 byte | ${"0".repeat(64)}`,
      );
    });
  });

  describe("a run whose record lists no file", () => {
    it("says so in place of a table of fingerprints, and still gives how to check the run", () => {
      const model = modelOf([{ path: "/" }]);
      const [part = []] = runParts(model);
      const inside = under(part, "Fingerprints (SHA-256) in run r1");

      expect(model.evidence[0]?.fingerprints).toEqual([]);
      expect(inside).toEqual([
        para("This run's record lists no files."),
        para(EVIDENCE_TEXT.verify),
        mono(["npx @icjia/voicecap verify"]),
      ]);
      // Its facts and environment are still tables; no table has no rows to show.
      expect(tablesIn(part).map((table) => table.head)).toEqual([
        EVIDENCE_TEXT.rowsHead,
        EVIDENCE_TEXT.rowsHead,
      ]);
    });

    it("but that lists its own, shows those, never that it lists none, as for a run whose pages were all skipped", () => {
      const run = withOwnFiles(
        shareRun({
          id: "r1",
          voicecapVersion: "0.11.0",
          pages: [{ path: "/", status: "skipped" }],
        }),
        { "events.jsonl": LOG_HASH },
      );
      const [part = []] = runParts(buildShareModel(inputOf([run])));
      const inside = under(part, "Fingerprints (SHA-256) in run r1");

      expect(wordsOf(inside)).toEqual([
        "Page | File | Size | SHA-256",
        `The run | events.jsonl | ${byteCount(LOG_HASH.bytes)} | ${LOG_HASH.sha256}`,
        EVIDENCE_TEXT.verify,
        "npx @icjia/voicecap verify",
      ]);
      expect(saysOf(inside)).not.toContain("lists no files");
    });
  });

  describe("with no run that counts", () => {
    it("says so, and lists what it left out, with nothing to check", () => {
      const none = noRunModel();
      const blocks = wordEvidence(none);

      expect(wordsOf(blocks)).toEqual([
        "The evidence behind these results",
        "No live run counts yet. There is no evidence to show.",
        "Runs left out",
        LEFT_OUT_LEAD,
        "2026-09-26_1405: replayed, so it never counts as a live result",
      ]);
      expect(blocks.map(({ kind }) => kind)).toEqual([
        "heading",
        "para",
        "heading",
        "para",
        "list",
      ]);
      expect(blocks[1]).toEqual(para(...evidenceGist(none)));
      expect(outlineOf(blocks)).toEqual(["1 The evidence behind these results", "2 Runs left out"]);
      expect(tablesIn(blocks)).toEqual([]);
      expect(saysOf(blocks)).not.toContain("A Word document can't check itself");
    });

    it("says only that, when nothing was left out either", () => {
      const none = { ...noRunModel(), leftOut: [] };

      expect(wordsOf(wordEvidence(none))).toEqual([
        "The evidence behind these results",
        "No live run counts yet. There is no evidence to show.",
      ]);
    });
  });

  describe("runs left out", () => {
    it("has no part for them when every run counted", () => {
      const model = modelOf([{ path: "/" }]);

      expect(model.leftOut).toEqual([]);
      expect(runParts(model)).toHaveLength(1);
      expect(leftOutPart(model)).toBeUndefined();
      expect(saysOf(wordEvidence(model))).not.toContain("Runs left out");
    });
  });

  describe("a run's event log", () => {
    const RUN = "2026-09-26_1402";
    const MINUTE_BY_MINUTE = `${EVIDENCE_TEXT.parts.timeline} ${inRun(RUN)}`;

    /** The logged run's timelines, as the model has them. */
    function timelinesOf(model: ShareModel): SessionTimeline[] {
      const timeline = model.evidence[0]?.timeline;
      if (!Array.isArray(timeline)) throw new Error("The run has no timeline.");
      return timeline;
    }

    it("says each session's day, its summary, and its table of Time and Event, under the run's own heading", () => {
      const model = loggedModel();
      const inside = under(partOf(runParts(model), 0), MINUTE_BY_MINUTE);
      const timelines = timelinesOf(model);

      expect(inside.map(({ kind }) => kind)).toEqual([
        "para",
        "para",
        "table",
        "para",
        "para",
        "table",
      ]);
      expect(inside[0]).toEqual(para({ text: "Session 1, 26 September 2026", bold: true }));
      expect(inside[3]).toEqual(para({ text: "Session 2, 28 September 2026", bold: true }));
      for (const [index, timeline] of timelines.entries()) {
        expect(inside[index * 3 + 1]).toEqual(para(timeline.summary.join(" ")));
        const table = tableAt(inside, index);
        expect(table.head).toEqual(["Time", "Event"]);
        expect(wordsOf([table])).toEqual([
          "Time | Event",
          ...timeline.rows.map(({ time, text }) => `${time.slice(11, 23)} | ${text}`),
        ]);
        // Each time in the fixed-width font, as the page sets it.
        expect(table.rows.map((row) => row[0]?.mono)).toEqual(timeline.rows.map(() => true));
      }
      expect(wordsOf(inside)).toContain(
        "voicecap held the NVDA lock from 14:02 to 14:06. voicecap's NVDA ran as process 65720, then 54568. The computer's own NVDA was shut down at 14:02 and started again at 14:06. 2 pages ran in order; page 2 failed at 14:04.",
      );
    });

    it("says, in its place, that a session the log doesn't cover isn't recorded, and why: a run begun on 0.10.0 and finished on 0.11.0", () => {
      const { run, log } = resumedLoggedRun("0.10.0");
      const model = buildShareModel(
        inputOf([run], { transcripts: storeOf(), events: new Map([[run.id, log]]) }),
      );
      const part = partOf(runParts(model), 0);
      const inside = under(part, MINUTE_BY_MINUTE);

      expect(inside.slice(0, 2)).toEqual([
        para("Session 1: not recorded: it used voicecap 0.10.0."),
        para({ text: "Session 2, 28 September 2026", bold: true }),
      ]);
      expect(tablesIn(inside)).toHaveLength(1);
      expect(saysOf(part)).toContain(
        "NVDA restarts | None in session 2. Session 1: not recorded: it used voicecap 0.10.0.",
      );
    });

    it("says the lines of the log it couldn't read, after the last table", () => {
      const { run, log } = loggedRun();
      const model = loggedModel({ events: new Map([[run.id, { ...log, unreadable: 1 }]]) });
      const inside = under(partOf(runParts(model), 0), MINUTE_BY_MINUTE);

      expect(inside.at(-1)).toEqual(para("1 line of the event log couldn't be read."));
    });

    it("counts NVDA's restarts in the run's facts, with why each was", () => {
      expect(saysOf(partOf(runParts(loggedModel()), 0))).toContain(
        "NVDA restarts | 1: to try Apply again (attempt 2 of 5)",
      );
    });

    it("keeps the run's five parts, each in its place", () => {
      expect(outlineOf(partOf(runParts(loggedModel()), 0))).toEqual([
        `2 Run ${RUN}`,
        `3 Minute by minute in run ${RUN}`,
        `3 NVDA's own log, checked against the transcripts in run ${RUN}`,
        `3 Test environment in run ${RUN}`,
        `3 Fingerprints (SHA-256) in run ${RUN}`,
        `3 Walkthrough file in run ${RUN}`,
      ]);
    });

    it("says what the page's timeline says: each session's day and summary, every event, and the lines it couldn't read", () => {
      const { run, log } = loggedRun();
      const model = loggedModel({ events: new Map([[run.id, { ...log, unreadable: 2 }]]) });
      const html = renderEvidence(model);
      const fold = html.slice(html.indexOf('<details class="fold" id="run-'));
      const part = fold.slice(0, fold.indexOf("<h3>NVDA&#39;s own log"));
      const said = [
        ...[...part.matchAll(/<h4>(.*?)<\/h4>/gs)].map(([, words = ""]) => textOf(words, "")),
        ...[...part.matchAll(/<p\b[^>]*>(.*?)<\/p>/gs)].map(([, words = ""]) => textOf(words, "")),
        ...[...part.matchAll(/<table class="plain">.*?<\/table>/gs)].flatMap(([table]) =>
          rowsOf(table),
        ),
      ];
      const words = wordsOf(under(partOf(runParts(model), 0), MINUTE_BY_MINUTE));

      expect(said.length).toBeGreaterThan(40);
      for (const line of said) expect(words, line).toContain(line);
    });
  });

  describe("a transcript that couldn't be read", () => {
    it("leaves out the page's note on what its check leaves out, which the Word copy has no check to say it of, and says nothing of it", () => {
      const model = unreadableModel([
        ["/", "read"],
        ["/", "tab"],
        ["/about/", "headings"],
      ]);

      // The page names them beside its check.
      expect(textOf(renderEvidence(model))).toContain(
        "3 transcripts couldn't be read, so the check leaves them out",
      );
      expect(saysOf(wordEvidence(model))).not.toMatch(/couldn't be read|leaves? (?:it|them) out/);
      expect(wordEvidence(model)).toEqual(wordEvidence({ ...model, appendix: [] }));
    });
  });

  describe("what the page says", () => {
    /** What one run's fold on the page says, piece by piece. */
    function foldSays(fold: string) {
      const spans = (html: string, className: string) =>
        [...html.matchAll(new RegExp(`<span class="${className}">(.*?)</span>`, "gs"))].map(
          ([, said = ""]) => textOf(said, ""),
        );
      const summary = /<summary>(.*?)<\/summary>/s.exec(fold)?.[1] ?? "";
      const verify = /<div class="verify"><span>(.*?)<\/span><pre>(.*?)<\/pre><\/div>/s.exec(fold);
      // The walkthrough file is the fold's last part: its paragraphs, and the command in its box.
      const walkthrough = fold.slice(fold.indexOf("<div><h3>Walkthrough file "));
      return {
        title: spans(summary, "what")[0] ?? "",
        when: spans(summary, "sub")[0] ?? "",
        chips: [...summary.matchAll(/<span class="chip [^"]*">(.*?)<\/span>/g)].map(
          ([, said = ""]) => textOf(said, ""),
        ),
        facts: termsOf(fold),
        headings: [...fold.matchAll(/<h3>(.*?)<\/h3>/gs)].map(([, said = ""]) => textOf(said)),
        notRecorded: [...fold.matchAll(/<p class="not-recorded">(.*?)<\/p>/g)].map(
          ([, said = ""]) => textOf(said, ""),
        ),
        tables: [...fold.matchAll(/<table class="plain">.*?<\/table>/gs)].map(([table]) =>
          rowsOf(table),
        ),
        verify: [textOf(verify?.[1] ?? "", ""), textOf(verify?.[2] ?? "", "")],
        walkthrough: {
          said: [...walkthrough.matchAll(/<p>(.*?)<\/p>/gs)].map(([, said = ""]) =>
            textOf(said, ""),
          ),
          command: textOf(/<pre>(.*?)<\/pre>/s.exec(walkthrough)?.[1] ?? "", ""),
        },
      };
    }

    /** Each run's fold, from its opening tag to its closing one. */
    function runFolds(html: string): string[] {
      return foldsIn(html)
        .filter((fold) => fold.includes(' id="run-'))
        .map((fold) => fold.split("</details>")[0] ?? "");
    }

    it("says, run by run, every phrase of each run's fold in that run's own blocks", async () => {
      let seen = 0;

      for (const model of [await demoModel(), twoEraModel(), modelOf([done("/")])]) {
        const folds = runFolds(renderEvidence(model));
        const parts = runParts(model);

        expect(parts).toHaveLength(folds.length);
        for (const [index, fold] of folds.entries()) {
          const part = partOf(parts, index);
          const says = foldSays(fold);
          const words = wordsOf(part);

          // The fold's line: the run's title, when it ran, and its two chips, as one sentence.
          expect(words[0]).toBe(says.title);
          expect(words[1]?.toLowerCase()).toBe(
            `${says.when}. ${says.chips.join(" and ")}.`.toLowerCase(),
          );
          for (const [label, value] of says.facts)
            expect(words, label).toContain(`${label} | ${value}`);
          expect(outlineOf(part).slice(1)).toEqual(says.headings.map((words) => `3 ${words}`));
          for (const line of says.notRecorded) expect(words, line).toContain(line);
          const [environment, fingerprints] = says.tables;
          expect(wordsOf([tableAt(part, 1)])).toEqual(environment);
          if (fingerprints !== undefined) expect(wordsOf([tableAt(part, 2)])).toEqual(fingerprints);
          for (const line of says.verify) expect(words, line).toContain(line);
          // The walkthrough file: the page's lead, the download link's words, the command that repeats
          // the run, and what a repeat can't promise. The Word copy says each but the download link's,
          // which it can't carry: it says how to get the file instead, and the lead is its own, which
          // begins as the page's does.
          const [lead = "", download = "", promise = "", ...more] = says.walkthrough.said;
          expect(more).toEqual([]);
          expect(lead).toBe(EVIDENCE_TEXT.walkthrough.lead);
          expect(words).toContain(WORD_TEXT.evidence.walkthrough.lead);
          expect(words).toContain(says.walkthrough.command);
          expect(words).toContain(promise);
          expect(download).toMatch(/^Download the walkthrough file \(\d[\d,.]* (?:KB|MB)\)$/);
          expect(saysOf(part)).not.toContain("Download the walkthrough file");
          seen += says.facts.length + (environment?.length ?? 0) + (fingerprints?.length ?? 0) + 4;
        }
      }
      // Read at all, so a check of nothing can't pass.
      expect(seen).toBeGreaterThan(150);
    });

    it("says what the page says around its runs: the line that opens it, what a fingerprint is, and the runs left out", async () => {
      let seen = 0;

      // The demo named by its canonical address, whose runs read a copy, says so too.
      for (const model of [
        await demoModel(),
        await demoModel(DEMO_ROOT),
        twoEraModel(),
        noRunModel(),
      ]) {
        const html = renderEvidence(model).replace(/<script.*?<\/script>/s, "");
        const outside = html.replace(/<details.*<\/details>/s, "");
        const words = wordsOf(wordEvidence(model));
        const said = [
          ...outside.matchAll(/<p class="gist">(.*?)<\/p>/gs),
          ...outside.matchAll(/<p class="fp-what">(.*?)<\/p>/gs),
          ...outside.matchAll(/<h3>(.*?)<\/h3>/gs),
          ...outside.matchAll(/<div class="panel">.*?<p>(.*?)<\/p>/gs),
          ...outside.matchAll(/<li>(.*?)<\/li>/gs),
        ].map((found) => textOf(found[1] ?? "", ""));
        // The page's own words about its own check, which the Word copy leaves out.
        const own = [
          "This page carries the sealed records exactly as voicecap wrote them, so the check can recompute their seals.",
        ];
        // Each line as the Word copy says it: the same, but for the lead of the runs left out.
        const inWord = (line: string) => (line === PAGE_LEFT_OUT_LEAD ? LEFT_OUT_LEAD : line);

        for (const line of said.filter((piece) => !own.includes(piece))) {
          expect(words, line).toContain(inWord(line));
        }
        seen += said.length;
      }
      expect(seen).toBeGreaterThan(8);
    });
  });

  it("keeps what a record supplies as words, never as markup", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const run = shareRun({
      id: "r1",
      sessions: [{ reviewer: hostile, environment: { browser: { name: hostile, version: "1" } } }],
      pages: [{ path: "/search?a=1&b=2", files: TRANSCRIPTS, passes: LINES }],
    });
    const model = buildShareModel(inputOf([run], { transcripts: storeOf() }));
    const [part = []] = runParts(model);
    const words = wordsOf(part);

    expect(words).toContain(`Run by | ${hostile}`);
    expect(words).toContain(`Browser | ${hostile} 1`);
    expect(words).toContain(`/search?a=1&b=2 | read.txt | 1 byte | ${"0".repeat(64)}`);
    expect(words.join("\n")).not.toContain("&lt;");
    expect(words.join("\n")).not.toContain("&amp;");
  });

  it("sets its headings in order, an h1 for the section, an h2 for each run, and an h3 inside it, and gives no table a heading with no words", async () => {
    for (const model of [
      await demoModel(),
      twoEraModel(),
      modelOf([{ path: "/" }]),
      noRunModel(),
    ]) {
      const blocks = wordEvidence(model);
      const levels = blocks.flatMap((block) => (block.kind === "heading" ? [block.level] : []));

      expect(levels[0]).toBe(1);
      expect(levels.filter((level) => level === 1)).toHaveLength(1);
      for (const [index, level] of levels.entries()) {
        if (index > 0) expect(level - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
      }
      for (const { head, rows } of tablesIn(blocks)) {
        expect(head.every((words) => words.trim() !== "")).toBe(true);
        for (const row of rows) expect(row).toHaveLength(head.length);
      }
    }
  });
});

describe("wordStory", () => {
  it("tells how voicecap began, why it exists with the Deque study's headline linked, then the rest of the story, all in the open", async () => {
    const blocks = wordStory(await demoModel());

    expect(blocks.slice(0, 5)).toEqual([
      heading(1, "How voicecap came to be"),
      para(STORY.began),
      para(...whyLine()),
      para(STORY.usual),
      para(STORY.answer),
    ]);
    expect(wordsOf(blocks.slice(1, 5))).toEqual([
      STORY.began,
      STORY.why,
      STORY.usual,
      STORY.answer,
    ]);
    expect(hrefsOf(blocks)).toEqual([STORY.deque.url]);
    expect(linesIn(blocks.slice(2, 3))[0]).toContainEqual({
      text: STORY.deque.title,
      href: STORY.deque.url,
    });
  });

  it("says no fold's own line: the page's lines for opening the rest of the story and the cards", async () => {
    const model = await demoModel();
    const said = saysOf(wordStory(model));

    for (const line of ["The rest of the story", "the usual answer, and voicecap's", "6 points"]) {
      expect(textOf(renderStory(model)), line).toContain(line);
      expect(said, line).not.toContain(line);
    }
  });

  describe("the timeline", () => {
    it("is a caption in bold above a table of When and What happened", async () => {
      const blocks = wordStory(await demoModel());

      expect(blocks[5]).toEqual(para({ text: STORY_TEXT.timeline.caption, bold: true }));
      expect(wordsOf(blocks.slice(5, 6))).toEqual([
        "From the first line of code to today, on a Windows PC and on a Mac",
      ]);
      expect(blocks[6]?.kind).toBe("table");
      expect(tableAt(blocks, 0).head).toEqual(["When", "What happened"]);
      expect(tableAt(blocks, 0).head[0]).toBe(STORY_TEXT.timeline.when);
    });

    it("has a row for each entry, and what isn't done yet last, headed Next", async () => {
      const { rows } = tableAt(wordStory(await demoModel()), 0);

      expect(rows).toHaveLength(TIMELINE.length);
      expect(cellLines(rows.at(-1)?.[0])).toEqual(["Next"]);
      expect(STORY_TEXT.timeline.next).toBe("Next");
      expect(TIMELINE.at(-1)?.date).toBeNull();
      // No other row is headed Next.
      expect(rows.slice(0, -1).flatMap((row) => cellLines(row[0]))).not.toContain("Next");
    });

    it("gives each entry its day, with the year on the first date only, and the day again for a second entry of one day", async () => {
      const { rows } = tableAt(wordStory(await demoModel()), 0);
      const days = rows.map((row) => cellLines(row[0]));

      expect(days).toEqual([
        ["25 September 2026"],
        ["26 September"],
        ["27 September"],
        ["28 September"],
        ["28 September"],
        ["29 September"],
        ["30 September"],
        ["1 October"],
        ["2 October"],
        ["2 October"],
        ["3 October"],
        ["3 October"],
        ["4 October"],
        ["5 October"],
        ["Next"],
      ]);
      // Each day is what the page says: a date is read as the day it begins.
      let lastYear: string | null = null;
      for (const [index, { date }] of TIMELINE.entries()) {
        if (date === null) continue;
        expect(days[index], date).toEqual([timelineDay(date, lastYear)]);
        lastYear = date.slice(0, 4);
      }
      // The day is in bold, as the page's row header is.
      expect(rows.map((row) => row[0]?.lines.flatMap(boldIn))).toEqual(days);
    });

    it("writes the year again when it changes", async () => {
      const model = await demoModel();
      const later: TimelineRow = {
        date: "2027-01-02",
        release: null,
        pc: null,
        mac: null,
        both: "A line in the next year.",
      };
      const at = TIMELINE.length - 1;

      // The timeline is fixed text, so a later year is put in for this one test and taken out.
      TIMELINE.splice(at, 0, later);
      try {
        const { rows } = tableAt(wordStory(model), 0);

        expect(cellLines(rows[at]?.[0])).toEqual(["2 January 2027"]);
        expect(cellLines(rows[at]?.[1])).toEqual(["A line in the next year."]);
        expect(cellLines(rows[at - 1]?.[0])).toEqual(["5 October"]);
        expect(cellLines(rows.at(-1)?.[0])).toEqual(["Next"]);
      } finally {
        TIMELINE.splice(at, 1);
      }
      expect(TIMELINE).toHaveLength(at + 1);
    });

    it("says an entry across both tracks as its words alone, the release in bold and the command in the fixed-width font", async () => {
      const { rows } = tableAt(wordStory(await demoModel()), 0);

      expect(cellLines(rows[0]?.[1])).toEqual(["The first line of code."]);
      expect(cellLines(rows[1]?.[1])).toEqual([
        "0.1.0: runs, transcripts, flags, and the report, tried out on recorded runs on Windows, macOS, and Linux.",
      ]);
      expect(rows[1]?.[1]?.lines.flatMap(boldIn)).toEqual(["0.1.0"]);
      expect(cellLines(rows[3]?.[1])).toEqual([
        "0.3.0: the sealed audit record, and voicecap verify to check it.",
      ]);
      expect(rows[3]?.[1]?.lines[0]).toContainEqual({ text: "voicecap verify", mono: true });
    });

    it("says an entry with one track after the track's name and its screen reader, in bold", async () => {
      const { rows } = tableAt(wordStory(await demoModel()), 0);
      const windows = rows[2]?.[1];
      const mac = rows[4]?.[1];

      expect(cellLines(windows)).toEqual([
        "Windows PC, with NVDA: 0.2.0: the real NVDA, checked end to end on Windows 11.",
      ]);
      expect(windows?.lines[0]?.slice(0, 2)).toEqual([
        { text: "Windows PC, with NVDA:", bold: true },
        " ",
      ]);
      expect(cellLines(mac)).toEqual([
        "Mac, with VoiceOver: A first trial on a real Mac: VoiceOver taken through a test site three ways, outside voicecap.",
      ]);
      expect(mac?.lines[0]?.slice(0, 2)).toEqual([
        { text: "Mac, with VoiceOver:", bold: true },
        " ",
      ]);
      // The track's own words keep their own bold: the release.
      expect(windows?.lines.flatMap(boldIn)).toEqual(["Windows PC, with NVDA:", "0.2.0"]);
    });

    it("says an entry with both tracks as a line for each, the Windows PC first", async () => {
      const { rows } = tableAt(wordStory(await demoModel()), 0);

      expect(cellLines(rows[5]?.[1])).toEqual([
        "Windows PC, with NVDA: 0.4.0: checks before every run, and a 20-second live test. On a real Windows PC, the checks found four problems, all fixed that day.",
        "Mac, with VoiceOver: 0.4.0: setup, the same checks, and the live test with VoiceOver, checked on a real Mac.",
      ]);
    });

    it("says what isn't done yet as the others, a line for each track", async () => {
      const { rows } = tableAt(wordStory(await demoModel()), 0);

      expect(cellLines(rows.at(-1)?.[1])).toEqual([
        "Windows PC, with NVDA: NVDA's own log, checked against the transcripts, recorded at the PC.",
        "Mac, with VoiceOver: Full runs with VoiceOver, with voicecap's VoiceOver driver.",
      ]);
    });

    it("names the tracks as the page's column heads do", async () => {
      const model = await demoModel();
      const { timeline } = STORY_TEXT;
      const page = textOf(renderStory(model), "");

      expect(page).toContain(`${timeline.pc.name}, ${timeline.pc.reader}`);
      expect(page).toContain(`${timeline.mac.name}, ${timeline.mac.reader}`);
      expect(saysOf(wordStory(model))).toContain(`${timeline.pc.name}, ${timeline.pc.reader}:`);
      expect(saysOf(wordStory(model))).toContain(`${timeline.mac.name}, ${timeline.mac.reader}:`);
    });

    it("says every entry's words, each in its own row, and no word of another row's", async () => {
      const { rows } = tableAt(wordStory(await demoModel()), 0);

      for (const [index, entry] of TIMELINE.entries()) {
        const said = (rows[index]?.[1]?.lines ?? []).map(lineText).join("\n");
        const own = [entry.both, entry.pc, entry.mac].flatMap((cell) =>
          cell === null ? [] : [lineText(lineOfMarkup(cell))],
        );
        const others = TIMELINE.filter((_, at) => at !== index).flatMap((other) =>
          [other.both, other.pc, other.mac].flatMap((cell) =>
            cell === null ? [] : [lineText(lineOfMarkup(cell))],
          ),
        );

        expect(own.length, `row ${index}`).toBeGreaterThan(0);
        for (const words of own) expect(said, `row ${index}`).toContain(words);
        for (const words of others) expect(said, `row ${index}`).not.toContain(words);
      }
    });

    it("says what the page's table says of each row: the day, and each track's words", async () => {
      const model = await demoModel();
      const html = renderStory(model);
      const body = /<tbody>(.*?)<\/tbody>/s.exec(html)?.[1] ?? "";
      const pageRows = [...body.matchAll(/<tr>(.*?)<\/tr>/gs)].map(([, row = ""]) => row);
      const { rows } = tableAt(wordStory(model), 0);
      let day = "";

      expect(pageRows).toHaveLength(rows.length);
      for (const [index, row] of pageRows.entries()) {
        // A day's header spans its entries, so a row without one is of the day above it.
        const header = /<th scope="row"[^>]*>(.*?)<\/th>/s.exec(row)?.[1];
        if (header !== undefined) day = textOf(header, "");
        const tracks = [
          ...row.matchAll(/<td [^>]*class="(pc|mac|both)[^"]*"[^>]*>(.*?)<\/td>/gs),
        ].map(
          ([, track, said = ""]) => [track as "pc" | "mac" | "both", textOf(said, "")] as const,
        );
        const wordsOfRow = (rows[index]?.[1]?.lines ?? []).map(lineText);

        expect(cellLines(rows[index]?.[0]), `row ${index}`).toEqual([day]);
        expect(wordsOfRow.length, `row ${index}`).toBe(tracks.length);
        for (const [at, [track, said]] of tracks.entries()) {
          // The page says a track's name and screen reader in the head of its column.
          const head = track === "both" ? null : STORY_TEXT.timeline[track];
          const label = head === null ? "" : `${head.name}, ${head.reader}: `;
          expect(wordsOfRow[at], `row ${index}`).toBe(`${label}${said}`);
        }
      }
    });
  });

  describe("a few things worth knowing", () => {
    it("is a heading 2 and the six cards as a list, each title in bold, last in the section", async () => {
      const blocks = wordStory(await demoModel());
      const [cards] = under(blocks, STORY_TEXT.worth);

      expect(outlineOf(blocks)).toEqual([
        "1 How voicecap came to be",
        "2 A few things worth knowing",
      ]);
      expect(blocks.at(-1)).toBe(cards);
      expect(cards?.kind).toBe("list");
      expect(cards?.kind === "list" ? cards.items.map(lineText) : []).toEqual(
        WORTH_KNOWING.map(({ title, text }) => `${title}: ${text}`),
      );
      expect(cards?.kind === "list" ? cards.items.map(boldIn) : []).toEqual(
        WORTH_KNOWING.map(({ title }) => [title]),
      );
      expect(WORTH_KNOWING).toHaveLength(6);
    });

    it("says what the page's cards say, each title and each text", async () => {
      const model = await demoModel();
      const html = renderStory(model);
      const cards = [...html.matchAll(/<div><h3>(.*?)<\/h3><p>(.*?)<\/p><\/div>/gs)].map(
        ([, title = "", text = ""]) => `${textOf(title, "")}: ${textOf(text, "")}`,
      );
      const [list] = under(wordStory(model), STORY_TEXT.worth);

      expect(cards).toHaveLength(6);
      expect(list?.kind === "list" ? list.items.map(lineText) : []).toEqual(cards);
    });
  });

  it("says what the page says around its timeline: its two paragraphs, and what is folded", async () => {
    const model = await demoModel();
    const html = renderStory(model);
    const words = wordsOf(wordStory(model));
    const said = [
      ...html.matchAll(/<p class="gist">(.*?)<\/p>/gs),
      ...html.matchAll(/<div class="inside"><p>(.*?)<\/p><p>(.*?)<\/p><\/div>/gs),
      ...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/gs),
      ...html.matchAll(/<caption>(.*?)<\/caption>/gs),
    ].flatMap((found) => found.slice(1).map((piece) => textOf(piece ?? "", "")));

    for (const line of said) expect(words, line).toContain(line);
    expect(said.length).toBeGreaterThanOrEqual(6);
  });

  it("links only to the study, since the page's other links go to its own parts", async () => {
    expect(hrefsOf(wordStory(await demoModel()))).toEqual([STORY.deque.url]);
  });

  it("never names a library as how voicecap began", async () => {
    expect(saysOf(wordStory(await demoModel()))).not.toMatch(/guidepup/i);
  });

  it("is the same for every site, since it is all fixed text", async () => {
    expect(wordStory(noRunModel())).toEqual(wordStory(await demoModel()));
  });
});

/** What the footer says after its heading: the words of its three paragraphs. */
function footerSays(model: ShareModel): string[] {
  return wordsOf(wordFooter(model).slice(1));
}

describe("wordFooter", () => {
  it("is a heading 1, About this report, and then three paragraphs, with nothing after them", async () => {
    const blocks = wordFooter(await demoModel());

    expect(blocks.map(({ kind }) => kind)).toEqual(["heading", "para", "para", "para"]);
    expect(blocks[0]).toEqual(heading(1, "About this report"));
    expect(blocks[0]).toEqual(heading(1, WORD_TEXT.footer.heading));
    // No page break: the heading and its paragraphs run on from the last transcript.
    expect(blocks.some(({ kind }) => kind === "pageBreak")).toBe(false);
  });

  it("has a heading where the page has none: its footer is a landmark, which a screen reader announces", async () => {
    const model = await demoModel();
    const page = renderFooter(model);

    expect(page).toMatch(/^<footer>/);
    expect(page).not.toMatch(/<h[1-6]/);
    // In Word, a footer with no heading would belong to the last transcript's heading 3.
    expect(wordFooter(model)[0]).toEqual(heading(1, "About this report"));
    expect(wordFooter(noRunModel())[0]).toEqual(heading(1, "About this report"));
  });

  it("says what voicecap is with its address linked, when the report was made, and which file it is, in that order", async () => {
    const model = await demoModel();
    const blocks = wordFooter(model);

    expect(blocks.slice(1)).toEqual([
      para(`${ABOUT} `, { text: "github.com/ICJIA/voicecap", href: TOP_TEXT.github }),
      para(generatedLine(model.footer)),
      para(...FOOTER_TEXT.word("current.html", "current.docx")),
    ]);
    expect(wordsOf(blocks)).toEqual([
      "About this report",
      `${ABOUT} github.com/ICJIA/voicecap`,
      "Generated on 30 September 2026 at 09:00 (UTC−05:00). Times are as each run recorded them (UTC−05:00).",
      "This file: current.docx. Its web page: current.html.",
    ]);
    expect(hrefsOf(blocks)).toEqual(["https://github.com/ICJIA/voicecap"]);
  });

  it("names the Word copy first and the web page after it, each in the fixed-width font", async () => {
    const [, , , file] = wordFooter(await demoModel());
    const named =
      file?.kind === "para" ? file.line.filter((piece) => typeof piece !== "string") : [];

    expect(named).toEqual([
      { text: "current.docx", mono: true },
      { text: "current.html", mono: true },
    ]);
  });

  it("names the files as the model has them, the day and time the report was made, and each offset its runs used", async () => {
    const model = withFooter(await demoModel(), {
      generatedAt: "2026-12-01T17:45:00-06:00",
      fileName: "127.0.0.1_4848_2026-12-01.html",
      wordName: "127.0.0.1_4848_2026-12-01.docx",
      offsets: ["UTC−05:00", "UTC−06:00"],
    });

    expect(footerSays(model).slice(1)).toEqual([
      "Generated on 1 December 2026 at 17:45 (UTC−06:00). Times are as each run recorded them (UTC−05:00 and UTC−06:00).",
      "This file: 127.0.0.1_4848_2026-12-01.docx. Its web page: 127.0.0.1_4848_2026-12-01.html.",
    ]);
  });

  it("says nothing of the runs' times when no run counts", () => {
    const none = noRunModel();

    expect(none.footer.offsets).toEqual([]);
    expect(footerSays(none)[1]).toBe("Generated on 30 September 2026 at 09:00 (UTC−05:00).");
  });

  it("keeps the file names and the offsets as words, never as markup", async () => {
    const model = withFooter(await demoModel(), {
      fileName: "<b>x</b>.html",
      wordName: "<u>w</u>.docx",
      offsets: ["<i>Zone</i>"],
    });
    const words = footerSays(model);

    expect(words[2]).toBe("This file: <u>w</u>.docx. Its web page: <b>x</b>.html.");
    expect(words[1]).toContain("(<i>Zone</i>)");
    expect(words.join("\n")).not.toContain("&lt;");
  });

  it("says what the page's footer says, with the file's other copy named for the page's", async () => {
    const model = await demoModel();
    const page = textOf(renderFooter(model), "");
    const [about, generated, file] = footerSays(model);

    expect(page).toContain(about);
    expect(page).toContain(generated);
    expect(page).toContain("This file: current.html. Its Word copy: current.docx.");
    expect(file).toBe("This file: current.docx. Its web page: current.html.");
  });
});
