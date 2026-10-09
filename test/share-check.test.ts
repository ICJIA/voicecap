/**
 * The shareable page's fingerprint check: the library the page carries (run here in node:vm, the
 * way a browser runs it: plain script, no imports, only TextEncoder from outside), the data it
 * checks, and its wiring in real Chromium. The demo runs of 29 September 2026 are the real case.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { keptAxeResults } from "../src/axe/results.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { ReviewEntry, ReviewsFile, ReviewStatus, RunJson } from "../src/model.js";
import { esc } from "../src/report/html.js";
import { runAudit } from "../src/run/audit.js";
import { CHECK_LIBRARY, CHECK_SCRIPT, checkDataJson, type CheckData } from "../src/share/check.js";
import { renderSharePage } from "../src/share/html/document.js";
import { loadShareInput } from "../src/share/load.js";
import { buildShareModel } from "../src/share/model.js";
import { extractBody } from "../src/transcripts/format.js";
import { canonicalJson, sealOf } from "../src/util/hash.js";
import { launchBrowser } from "./helpers/axe.js";
import { TINY_JPEG, TINY_RECORD } from "./helpers/jpeg.js";
import { rawAxe, rawRule } from "./helpers/raw-axe.js";
import { options as runOptions, setup as setupSite, SITE, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";
import { DEMO_DAY, demoRun } from "./helpers/share-fixture.js";
import { keptAxe } from "./helpers/share-model.js";

interface Checked {
  files: { label: string; ok: boolean }[];
  screenshots: { label: string; ok: boolean }[];
  axe: { label: string; ok: boolean }[];
  runs: { id: string; ok: boolean }[];
  reviewProblems: string[];
  line: string;
}

type Digest = (bytes: Uint8Array) => string | Promise<string>;

/** What the page shows of a file the data holds: its text, or null when the page doesn't show it. */
type Shown = (file: CheckData["files"][number]) => string | null;

/** The bytes of each copy of a screenshot the page shows, from its address: none for none shown. */
type Pictures = (shot: CheckData["screenshots"][number]) => Uint8Array[];

interface Library {
  sha256Hex: (bytes: Uint8Array) => string;
  canonicalJson: (value: unknown) => string;
  sealOf: (record: object) => string;
  checkAll: (
    data: CheckData,
    digest?: Digest,
    shown?: Shown,
    pictures?: Pictures,
  ) => Promise<Checked>;
}

// The library as a browser gets it, with nothing but TextEncoder from outside.
const library = vm.runInNewContext(
  CHECK_LIBRARY + ";({ sha256Hex, canonicalJson, sealOf, checkAll })",
  { TextEncoder },
) as Library;

/** Node's SHA-256, the reference. */
function nodeHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** What the page does when the browser has Web Crypto: its digest, as hex. */
async function webCryptoHex(bytes: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Buffer.from(buffer).toString("hex");
}

/** A result from the library's realm as plain data, so equality doesn't depend on the realm. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function check(
  data: CheckData,
  digest: Digest = library.sha256Hex,
  shown?: Shown,
  pictures?: Pictures,
): Promise<Checked> {
  return plain(await library.checkAll(data, digest, shown, pictures));
}

/** What a card's fold shows of each file: its body, the file without its header, as the page has it. */
const asShown: Shown = (file) => extractBody(file.text).join("\n");

const TRANSCRIPTS = ["read.txt", "headings.txt", "tab.txt"] as const;

/**
 * The data as the page will carry it: both demo runs' records, and the three transcripts of every
 * page, each from the latest run that read the page in full. In run 1402 the page
 * /how-a-run-works/ failed, so its three come from run 1315, and the other six pages' from 1402:
 * 21 files.
 */
function demoData(): CheckData {
  const earlier = demoRun("1315");
  const latest = demoRun("1402");
  const files: CheckData["files"] = [];
  for (const page of latest.pages) {
    const source = [latest, earlier].find((run) =>
      run.pages.some((candidate) => candidate.slug === page.slug && candidate.status === "done"),
    );
    if (source === undefined) throw new Error(`No demo run read ${page.slug} in full.`);
    for (const name of TRANSCRIPTS) {
      const text = readFileSync(
        `${DEMO_DAY}${source.id.slice(-4)}/pages/${page.slug}/${name}`,
        "utf8",
      );
      files.push({ run: source.id, slug: page.slug, name, text });
    }
  }
  return { runs: [earlier, latest], files, screenshots: [], axe: [], reviews: null };
}

/** The demo's data with a screenshot of TINY_JPEG recorded for each of the pages of run 1402 named. */
function shotData(slugs: string[] = ["home", REPORT]): CheckData {
  const data = demoData();
  const latest = data.runs.find((run) => run.id === "2026-09-29_1402")!;
  for (const slug of slugs) {
    latest.pages.find((page) => page.slug === slug)!.screenshot = TINY_RECORD;
    data.screenshots.push({ run: latest.id, slug, name: "screenshot.jpg" });
  }
  // The record has a new field, so it's sealed again, as voicecap sealed it with the field there.
  latest.seal = sealOf(latest);
  return data;
}

/** Each screenshot of the page as the page shows it unchanged: once, as TINY_JPEG. */
const asEmbedded: Pictures = () => [TINY_JPEG];

/**
 * The demo's data (or `data`) with axe's results recorded for each of the pages of run 1402 named,
 * and carried as the page carries them: each file's exact text, by its run, its page's slug, and its
 * name. The first page's has an issue, and the others' none.
 */
function axeData(slugs: string[] = ["home", REPORT], data: CheckData = demoData()): CheckData {
  const latest = data.runs.find((run) => run.id === "2026-09-29_1402")!;
  for (const [at, slug] of slugs.entries()) {
    const kept = keptAxe(at === 0 ? { violations: [rawRule("button-name")] } : { passes: 12 });
    latest.pages.find((page) => page.slug === slug)!.axe = kept.record;
    data.axe.push({ run: latest.id, slug, name: "axe.json", text: kept.text });
  }
  // The record has a new field, so it's sealed again, as voicecap sealed it with the field there.
  latest.seal = sealOf(latest);
  return data;
}

/** `text` with the character at `at` replaced by another one. */
function changeOneCharacter(text: string, at: number): string {
  const replacement = text[at] === "X" ? "Y" : "X";
  return text.slice(0, at) + replacement + text.slice(at + 1);
}

const REPORT = "the-report-03940c2f88";
const ASK = "ask-a-question-dec13fb322";

/**
 * Review entries chained and sealed as voicecap appends them: `seq` counted across every page, each
 * `prev` the seal of the entry before, each entry sealed with sealOf.
 */
function reviewChain(
  steps: { slug: string; status: ReviewStatus; note?: string }[],
): ReviewsFile["pages"] {
  const run = demoRun("1402");
  const pages: ReviewsFile["pages"] = {};
  let previous: ReviewEntry | undefined;
  for (const [index, step] of steps.entries()) {
    const page = run.pages.find((candidate) => candidate.slug === step.slug);
    if (page === undefined) throw new Error(`The demo run has no page ${step.slug}.`);
    const entry: ReviewEntry = {
      status: step.status,
      reviewer: "Pat Reviewer",
      at: `2026-09-30T10:0${index}:00-05:00`,
      note: step.note ?? null,
      run: run.id,
      url: page.url,
      files: {},
      content: {},
      seq: index + 1,
      prev: previous?.seal ?? null,
    };
    entry.seal = sealOf(entry);
    previous = entry;
    (pages[page.key] ??= []).push(entry);
  }
  return pages;
}

/** Three entries on two pages: reviewed, then an issue found, then fixed. */
function history(): ReviewsFile["pages"] {
  return reviewChain([
    { slug: REPORT, status: "reviewed" },
    { slug: ASK, status: "issue", note: "The edit field has no name." },
    { slug: ASK, status: "fixed" },
  ]);
}

/** The entry numbered `seq`, to change in place. */
function entryNumbered(pages: ReviewsFile["pages"], seq: number): ReviewEntry {
  const found = Object.values(pages)
    .flat()
    .find((entry) => entry.seq === seq);
  if (found === undefined) throw new Error(`No entry numbered ${seq}.`);
  return found;
}

/** The history without the entry numbered `seq`. */
function without(pages: ReviewsFile["pages"], seq: number): ReviewsFile["pages"] {
  return Object.fromEntries(
    Object.entries(pages).map(([key, entries]) => [key, entries.filter((e) => e.seq !== seq)]),
  );
}

function reseal(entry: ReviewEntry): void {
  entry.seal = sealOf(entry);
}

describe("the check's SHA-256", () => {
  it("gives Node's SHA-256 on the test vectors", () => {
    for (const text of ["", "abc", "a".repeat(1_000_000), "naïve — 😀\r\n"]) {
      const bytes = new TextEncoder().encode(text);

      expect(library.sha256Hex(bytes), `${bytes.length} bytes of ${text.slice(0, 12)}`).toBe(
        nodeHex(bytes),
      );
    }
  });

  it("pads every message length as FIPS 180-4 does, through both sides of a block's end", () => {
    // 55 bytes is the longest message whose padding fits in its one block; 56 to 63 need a second.
    const bytes = new Uint8Array(200).map((_, index) => (index * 37 + 11) % 256);
    for (let length = 0; length <= 200; length++) {
      expect(library.sha256Hex(bytes.subarray(0, length)), `${length} bytes`).toBe(
        nodeHex(bytes.subarray(0, length)),
      );
    }
  });
});

describe("the check's JSON and seals", () => {
  it("writes JSON with sorted keys exactly as voicecap seals it", () => {
    const run = demoRun("1402");
    const entry = entryNumbered(history(), 2);
    const awkward = {
      z: [3, { b: undefined, a: "naïve — 😀 </script>" }],
      y: null,
      a: { c: 1, b: 2 },
    };

    for (const value of [run, entry, awkward, "a string", 7, null, [{ b: 1, a: 2 }]]) {
      expect(library.canonicalJson(value)).toBe(canonicalJson(value));
    }
    expect(library.sealOf(run)).toBe(sealOf(run));
    expect(library.sealOf(run)).toBe(run.seal);
    expect(library.sealOf(entry)).toBe(sealOf(entry));
    expect(library.sealOf(entry)).toBe(entry.seal);
    expect(library.sealOf({ ...entry, seal: "not the seal" })).toBe(entry.seal);
  });

  it("counts a key named __proto__ as any other key, as voicecap's seals do", () => {
    const run = demoRun("1402");
    // Added to the record's text, as an edit would be: JSON.parse makes it an ordinary key.
    const tampered = JSON.parse(
      JSON.stringify(run).replace(/^\{/, '{"__proto__":{"status":"incomplete"},'),
    ) as RunJson;
    const nested = JSON.parse('{"a":{"b":1,"__proto__":2}}') as object;

    expect(library.canonicalJson(tampered)).toBe(canonicalJson(tampered));
    expect(library.canonicalJson(nested)).toBe(canonicalJson(nested));
    expect(library.sealOf(tampered)).toBe(sealOf(tampered));
    expect(library.sealOf(tampered)).not.toBe(run.seal);
  });
});

describe("checkAll", () => {
  it("finds everything matching on the data as written", async () => {
    const data = demoData();

    const result = await check(data);

    expect(data.files).toHaveLength(21);
    expect(result.files).toHaveLength(21);
    expect(result.files.every((file) => file.ok)).toBe(true);
    expect(result.runs).toEqual([
      { id: "2026-09-29_1315", ok: true },
      { id: "2026-09-29_1402", ok: true },
    ]);
    expect(result.reviewProblems).toEqual([]);
    expect(result.line).toBe(
      "21 of 21 transcripts match their fingerprints, and both runs' seals check out",
    );
    expect(result.files.slice(0, 3).map((file) => file.label)).toEqual([
      "Run 1402 · / · read.txt",
      "Run 1402 · / · headings.txt",
      "Run 1402 · / · tab.txt",
    ]);
    expect(result.files.slice(6, 9).map((file) => file.label)).toEqual([
      "Run 1315 · /how-a-run-works/ · read.txt",
      "Run 1315 · /how-a-run-works/ · headings.txt",
      "Run 1315 · /how-a-run-works/ · tab.txt",
    ]);
  });

  it("gives the same result with Web Crypto's digest, which is async", async () => {
    const data = demoData();
    data.files[4]!.text = changeOneCharacter(data.files[4]!.text, 30);

    expect(await check(data, webCryptoHex)).toEqual(await check(data));
  });

  it("names a transcript changed by one character", async () => {
    const data = demoData();
    const target = data.files.find((file) => file.slug === REPORT && file.name === "read.txt")!;
    target.text = changeOneCharacter(target.text, 100);

    const result = await check(data);

    expect(result.files.filter((file) => !file.ok).map((file) => file.label)).toEqual([
      "Run 1402 · /the-report/ · read.txt",
    ]);
    expect(result.files.filter((file) => file.ok)).toHaveLength(20);
    expect(result.runs.every((run) => run.ok)).toBe(true);
    expect(result.line).toBe(
      "Run 1402 · /the-report/ · read.txt doesn't match its fingerprint. " +
        "20 of 21 transcripts match their fingerprints, and both runs' seals check out",
    );
  });

  it("names a transcript the run's record doesn't list", async () => {
    const data = demoData();
    data.files.push({ run: "2026-09-29_1402", slug: "home", name: "extra.txt", text: "abc" });
    data.files.push({ run: "2026-01-01_0000", slug: "home", name: "read.txt", text: "abc" });

    const result = await check(data);

    expect(result.files.slice(21)).toEqual([
      { label: "Run 1402 · / · extra.txt", ok: false },
      { label: "Run 0000 · home · read.txt", ok: false },
    ]);
    expect(result.line).toContain("Run 1402 · / · extra.txt doesn't match its fingerprint.");
    expect(result.line).toContain("21 of 23 transcripts match their fingerprints");
  });

  it("names a run whose record was changed", async () => {
    const data = demoData();
    data.runs[1]!.pages[0]!.title = "A title someone changed afterwards";

    const result = await check(data);

    expect(result.runs).toEqual([
      { id: "2026-09-29_1315", ok: true },
      { id: "2026-09-29_1402", ok: false },
    ]);
    expect(result.files.every((file) => file.ok)).toBe(true);
    expect(result.line).toBe(
      "Run 1402's record doesn't match its seal. " +
        "21 of 21 transcripts match their fingerprints, and 1 of 2 runs' seals check out",
    );
  });

  it("names a run whose record was changed to match a changed transcript", async () => {
    const data = demoData();
    const target = data.files.find((file) => file.slug === REPORT && file.name === "tab.txt")!;
    target.text = changeOneCharacter(target.text, 60);
    // Whoever did that also puts the new fingerprint in the run's record. The file now matches the
    // record, so only the run's seal gives it away.
    const page = data.runs[1]!.pages.find((candidate) => candidate.slug === REPORT)!;
    page.files["tab.txt"]!.sha256 = nodeHex(new TextEncoder().encode(target.text));

    const result = await check(data);

    expect(result.files.every((file) => file.ok)).toBe(true);
    expect(result.runs.map((run) => run.ok)).toEqual([true, false]);
    expect(result.line).toContain("Run 1402's record doesn't match its seal.");
  });

  it("words the number of runs the seals check out for", async () => {
    const data = demoData();
    const third = { ...structuredClone(data.runs[1]!), id: "2026-09-29_1500" };
    third.seal = sealOf(third);
    const one = { ...data, runs: [data.runs[1]!], files: data.files.slice(0, 3) };
    const many = { ...data, runs: [...data.runs, third] };
    const same = { ...data, runs: [...data.runs, { ...third, id: "2026-09-28_1402" }] };
    same.runs[2]!.seal = sealOf(same.runs[2]!);

    expect((await check(one)).line).toBe(
      "3 of 3 transcripts match their fingerprints, and the run's seal checks out",
    );
    expect((await check(many)).line).toBe(
      "21 of 21 transcripts match their fingerprints, and all 3 runs' seals check out",
    );
    // Two runs begun at the same time on different days: each is named by its whole id.
    const broken = structuredClone(same);
    broken.runs[2]!.name = "changed";
    expect((await check(broken)).line).toBe(
      "Run 2026-09-28_1402's record doesn't match its seal. " +
        "21 of 21 transcripts match their fingerprints, and 2 of 3 runs' seals check out",
    );
  });

  it("finds a review history's seals and chain matching", async () => {
    const data = { ...demoData(), reviews: history() };

    const result = await check(data);

    expect(result.reviewProblems).toEqual([]);
    expect(result.line).toBe(
      "21 of 21 transcripts match their fingerprints, and both runs' seals check out, " +
        "and the review entries' seals and chain check out",
    );
  });

  it("names a review entry changed, or a break in the chain", async () => {
    const cases: [string, (pages: ReviewsFile["pages"]) => ReviewsFile["pages"], string[]][] = [
      [
        "an entry changed after it was sealed",
        (pages) => {
          entryNumbered(pages, 2).note = "Changed afterwards.";
          return pages;
        },
        ["Review entry 2 (/ask-a-question/) doesn't match its seal"],
      ],
      [
        "an entry that lost its seal",
        (pages) => {
          delete entryNumbered(pages, 1).seal;
          return pages;
        },
        ["Review entry 1 (/the-report/) doesn't match its seal"],
      ],
      [
        "an entry missing from the middle",
        (pages) => without(pages, 2),
        ["Review entry 2 is missing"],
      ],
      ["the first entry missing", (pages) => without(pages, 1), ["Review entry 1 is missing"]],
      [
        "an entry that doesn't follow the one before it",
        (pages) => {
          const entry = entryNumbered(pages, 3);
          entry.prev = "0".repeat(64);
          reseal(entry);
          return pages;
        },
        ["Review entry 3 doesn't follow review entry 2"],
      ],
      [
        "a first entry that follows another",
        (pages) => {
          const entry = entryNumbered(pages, 1);
          entry.prev = "f".repeat(64);
          reseal(entry);
          return pages;
        },
        [
          "Review entry 1 follows an entry that isn't there",
          // Its seal changed with it, so the entry after no longer follows it either.
          "Review entry 2 doesn't follow review entry 1",
        ],
      ],
      [
        "two entries with one number",
        (pages) => {
          const entry = entryNumbered(pages, 3);
          entry.seq = 2;
          reseal(entry);
          return pages;
        },
        [
          "More than one review entry is numbered 2",
          "Review entry 2 doesn't follow review entry 1",
        ],
      ],
      [
        "a sealed entry with no number",
        (pages) => {
          const entry = entryNumbered(pages, 1);
          delete entry.seq;
          reseal(entry);
          return pages;
        },
        [
          "A review entry for /the-report/ is outside the chain (it has no number)",
          "Review entry 1 is missing",
        ],
      ],
    ];

    for (const [what, damage, problems] of cases) {
      const result = await check({ ...demoData(), reviews: damage(history()) });

      expect(result.reviewProblems, what).toEqual(problems);
      expect(result.line, what).toBe(
        problems.map((problem) => `${problem}. `).join("") +
          "21 of 21 transcripts match their fingerprints, and both runs' seals check out",
      );
      expect(
        result.files.every((file) => file.ok),
        what,
      ).toBe(true);
      expect(
        result.runs.every((run) => run.ok),
        what,
      ).toBe(true);
    }
  });

  it("leaves out review entries from before seals", async () => {
    const pages = history();
    const old: ReviewEntry = {
      status: "reviewed",
      reviewer: "Pat Reviewer",
      at: "2026-09-01T09:00:00-05:00",
      note: null,
      run: null,
      url: "http://127.0.0.1:4848/",
      files: {},
      content: {},
    };
    (pages["http://127.0.0.1:4848/"] ??= []).push(old);
    const onlyOld = { "http://127.0.0.1:4848/": [old] };

    const withHistory = await check({ ...demoData(), reviews: pages });
    const beforeSeals = await check({ ...demoData(), reviews: onlyOld });

    expect(withHistory.reviewProblems).toEqual([]);
    expect(withHistory.line).toMatch(/, and the review entries' seals and chain check out$/);
    expect(beforeSeals.reviewProblems).toEqual([]);
    expect(beforeSeals.line).toBe(
      "21 of 21 transcripts match their fingerprints, and both runs' seals check out",
    );
  });

  it("words the line for a page with runs but no transcripts, or reviews but no runs", async () => {
    const data = demoData();

    const noTranscripts = await check({ ...data, files: [], reviews: null });
    const onlyReviews = await check({
      runs: [],
      files: [],
      screenshots: [],
      axe: [],
      reviews: history(),
    });

    expect(noTranscripts.line).toBe("Both runs' seals check out");
    expect(onlyReviews.line).toBe("The review entries' seals and chain check out");
  });

  it("says so when the page holds nothing to check", async () => {
    const result = await check({ runs: [], files: [], screenshots: [], axe: [], reviews: null });

    expect(result).toEqual({
      files: [],
      screenshots: [],
      axe: [],
      runs: [],
      reviewProblems: [],
      line: "This page holds no transcripts or run records to check",
    });
  });
});

describe("checkAll: the transcripts shown", () => {
  /** What the page shows, with the text of the file `changed` names changed to `to`. */
  const showing =
    (changed: { slug: string; name: string }, to: (text: string) => string): Shown =>
    (file) =>
      file.slug === changed.slug && file.name === changed.name
        ? to(asShown(file) ?? "")
        : asShown(file);

  it("finds each transcript shown matching its file, as the page is written", async () => {
    const result = await check(demoData(), library.sha256Hex, asShown);

    expect(result.files.every((file) => file.ok)).toBe(true);
    expect(result.line).toBe(
      "21 of 21 transcripts match their fingerprints, and both runs' seals check out",
    );
  });

  it("names a transcript whose text shown doesn't match its file", async () => {
    const shown = showing({ slug: REPORT, name: "read.txt" }, (text) => `${text} (edited)`);

    const result = await check(demoData(), library.sha256Hex, shown);

    expect(result.files.filter((file) => !file.ok).map((file) => file.label)).toEqual([
      "Run 1402 · /the-report/ · read.txt",
    ]);
    expect(result.line).toBe(
      "Run 1402 · /the-report/ · read.txt: the text shown doesn't match its file. " +
        "20 of 21 transcripts match their fingerprints, and both runs' seals check out",
    );
  });

  it("names a file that doesn't match its fingerprint once, whatever the page shows of it", async () => {
    const data = demoData();
    const target = data.files.find((file) => file.slug === REPORT && file.name === "tab.txt")!;
    // The page shows the transcript as it was; its data was changed after.
    const before = asShown({ ...target });
    target.text = `${target.text}One more line.\n`;

    const result = await check(data, library.sha256Hex, (file) =>
      file === target ? before : asShown(file),
    );

    // The file is what changed, and that's what's said: the text shown is the file as it was.
    expect(result.line).toBe(
      "Run 1402 · /the-report/ · tab.txt doesn't match its fingerprint. " +
        "20 of 21 transcripts match their fingerprints, and both runs' seals check out",
    );
  });

  it("compares the text shown with the file's body, whatever the line endings", async () => {
    const shown = showing({ slug: REPORT, name: "read.txt" }, (text) =>
      text.replaceAll("\n", "\r\n"),
    );

    const result = await check(demoData(), library.sha256Hex, shown);

    expect(result.files.every((file) => file.ok)).toBe(true);
  });

  it("compares the body of a file whose own lines end in CRLF", async () => {
    const data = demoData();
    const target = data.files.find((file) => file.slug === ASK && file.name === "read.txt")!;
    const crlf = target.text.replaceAll("\n", "\r\n");
    target.text = crlf;
    // The run records the file as it is, and is sealed again, so only the text shown is in question.
    const run = data.runs.find((candidate) => candidate.id === target.run)!;
    run.pages.find((page) => page.slug === target.slug)!.files["read.txt"] = {
      sha256: nodeHex(new TextEncoder().encode(crlf)),
      bytes: Buffer.byteLength(crlf),
    };
    run.seal = sealOf(run);

    const result = await check(data, library.sha256Hex, asShown);

    expect(result.line).toBe(
      "21 of 21 transcripts match their fingerprints, and both runs' seals check out",
    );
  });

  it("leaves a file the page doesn't show out of the comparison", async () => {
    const result = await check(demoData(), library.sha256Hex, (file) =>
      file.slug === REPORT ? null : asShown(file),
    );

    expect(result.files.every((file) => file.ok)).toBe(true);
  });

  it("matches a body with a null character in it, which a browser leaves out of what it shows", async () => {
    const data = demoData();
    const target = data.files[0]!;
    const withNull = `${target.text}A line with a \u0000 in it.\n`;
    target.text = withNull;
    const run = data.runs.find((candidate) => candidate.id === target.run)!;
    run.pages.find((page) => page.slug === target.slug)!.files[target.name] = {
      sha256: nodeHex(new TextEncoder().encode(withNull)),
      bytes: Buffer.byteLength(withNull),
    };
    run.seal = sealOf(run);

    const result = await check(data, library.sha256Hex, (file) =>
      (asShown(file) ?? "").replaceAll("\u0000", ""),
    );

    expect(result.files.every((file) => file.ok)).toBe(true);
  });
});

describe("checkAll, with the screenshots a page shows", () => {
  const HOME_LABEL = "Run 1402 · / · screenshot.jpg";
  const REPORT_LABEL = "Run 1402 · /the-report/ · screenshot.jpg";

  /** TINY_JPEG with its last byte changed: a picture that isn't the one the run recorded. */
  const changed = Uint8Array.from(TINY_JPEG, (byte, at) =>
    at === TINY_JPEG.length - 1 ? ~byte & 0xff : byte,
  );

  it("finds each screenshot the page shows matching its run's record, and counts it in words of its own", async () => {
    const result = await check(shotData(), library.sha256Hex, asShown, asEmbedded);

    expect(result.screenshots).toEqual([
      { label: HOME_LABEL, ok: true },
      { label: REPORT_LABEL, ok: true },
    ]);
    expect(result.files).toHaveLength(21);
    expect(result.line).toBe(
      "21 of 21 transcripts match their fingerprints, and 2 of 2 screenshots match their fingerprints, " +
        "and both runs' seals check out",
    );
  });

  it("names a screenshot changed by one byte, by its page, and says how many match", async () => {
    const pictures: Pictures = (shot) => [shot.slug === REPORT ? changed : TINY_JPEG];

    const result = await check(shotData(), library.sha256Hex, asShown, pictures);

    expect(result.screenshots).toEqual([
      { label: HOME_LABEL, ok: true },
      { label: REPORT_LABEL, ok: false },
    ]);
    expect(result.files.every((file) => file.ok)).toBe(true);
    expect(result.line).toBe(
      `${REPORT_LABEL} doesn't match its fingerprint. ` +
        "21 of 21 transcripts match their fingerprints, and 1 of 2 screenshots match their fingerprints, " +
        "and both runs' seals check out",
    );
  });

  it("checks every copy the page has of a screenshot, and names the screenshot once", async () => {
    // One copy is as it was, and another the page has of it has been changed: a copy someone added,
    // since the page itself shows each picture once, on its card.
    const pictures: Pictures = (shot) =>
      shot.slug === "home" ? [TINY_JPEG, changed] : [TINY_JPEG];

    const result = await check(shotData(), library.sha256Hex, asShown, pictures);

    expect(result.screenshots).toEqual([
      { label: HOME_LABEL, ok: false },
      { label: REPORT_LABEL, ok: true },
    ]);
    expect(result.line.match(/doesn't match its fingerprint/g)).toHaveLength(1);
  });

  it("names a screenshot the page doesn't show any copy of, since it can't match what isn't there", async () => {
    const pictures: Pictures = (shot) => (shot.slug === "home" ? [] : [TINY_JPEG]);

    const result = await check(shotData(), library.sha256Hex, asShown, pictures);

    expect(result.screenshots.filter(({ ok }) => !ok).map(({ label }) => label)).toEqual([
      HOME_LABEL,
    ]);
    expect(result.line).toContain(`${HOME_LABEL} doesn't match its fingerprint.`);
  });

  it("names a screenshot its run's record doesn't list, or a run the page doesn't carry", async () => {
    const data = shotData();
    // The page /ask-a-question/ has a record of why it has no screenshot, which has no fingerprint.
    data.runs[1]!.pages.find((page) => page.slug === ASK)!.screenshot = {
      error: "timed out after 5s",
      takenAt: "2026-09-29T14:03:00.000-05:00",
    };
    data.runs[1]!.seal = sealOf(data.runs[1]!);
    data.screenshots.push({ run: "2026-09-29_1402", slug: ASK, name: "screenshot.jpg" });
    data.screenshots.push({ run: "2026-01-01_0000", slug: "home", name: "screenshot.jpg" });

    const result = await check(data, library.sha256Hex, asShown, asEmbedded);

    expect(result.screenshots.slice(2)).toEqual([
      { label: "Run 1402 · /ask-a-question/ · screenshot.jpg", ok: false },
      { label: "Run 0000 · home · screenshot.jpg", ok: false },
    ]);
    expect(result.line).toContain("2 of 4 screenshots match their fingerprints");
  });

  it("names a run whose record was changed to match a changed screenshot, by its seal", async () => {
    const data = shotData();
    const page = data.runs[1]!.pages.find((candidate) => candidate.slug === "home")!;
    // Whoever changed the picture also puts its new fingerprint in the run's record: the picture
    // now matches the record, so only the run's seal gives it away.
    page.screenshot = { ...TINY_RECORD, sha256: nodeHex(changed), bytes: changed.length };
    const pictures: Pictures = (shot) => [shot.slug === "home" ? changed : TINY_JPEG];

    const result = await check(data, library.sha256Hex, asShown, pictures);

    expect(result.screenshots).toEqual([
      { label: HOME_LABEL, ok: true },
      { label: REPORT_LABEL, ok: true },
    ]);
    expect(result.runs.map((run) => run.ok)).toEqual([true, false]);
    expect(result.line).toContain("Run 1402's record doesn't match its seal.");
  });

  it("gives the same result with Web Crypto's digest, which is async", async () => {
    const pictures: Pictures = (shot) => [shot.slug === REPORT ? changed : TINY_JPEG];

    expect(await check(shotData(), webCryptoHex, asShown, pictures)).toEqual(
      await check(shotData(), library.sha256Hex, asShown, pictures),
    );
  });

  it("leaves the screenshots out when it's given no way to read them, as it leaves out the text a page shows", async () => {
    const result = await check(shotData());

    expect(result.screenshots).toEqual([]);
    expect(result.line).toBe(
      "21 of 21 transcripts match their fingerprints, and both runs' seals check out",
    );
  });

  it("words one screenshot in the singular, and none as nothing to say", async () => {
    const one = shotData(["home"]);

    expect((await check(one, library.sha256Hex, asShown, asEmbedded)).line).toBe(
      "21 of 21 transcripts match their fingerprints, and 1 of 1 screenshot matches its fingerprint, " +
        "and both runs' seals check out",
    );
    expect((await check(one, library.sha256Hex, asShown, () => [changed])).line).toContain(
      "0 of 1 screenshot matches its fingerprint",
    );
    // A page that shows none, and data from before it carried a list of them, say nothing of them.
    const { screenshots: _list, ...older } = demoData();
    for (const data of [demoData(), older as CheckData]) {
      expect((await check(data, library.sha256Hex, asShown, asEmbedded)).line).toBe(
        "21 of 21 transcripts match their fingerprints, and both runs' seals check out",
      );
    }
  });
});

describe("checkAll, with the axe results a page carries", () => {
  const HOME_LABEL = "Run 1402 · / · axe.json";
  const REPORT_LABEL = "Run 1402 · /the-report/ · axe.json";

  it("checks each axe file against its run's record, and counts them in words of their own", async () => {
    const result = await check(axeData(), library.sha256Hex, asShown);

    expect(result.axe).toEqual([
      { label: HOME_LABEL, ok: true },
      { label: REPORT_LABEL, ok: true },
    ]);
    expect(result.files).toHaveLength(21);
    expect(result.line).toBe(
      "21 of 21 transcripts match their fingerprints, and 2 of 2 axe results match their fingerprints, " +
        "and both runs' seals check out",
    );
  });

  it("names an axe file changed by one character, by its page, and says how many match", async () => {
    const data = axeData();
    const target = data.axe[1]!;
    target.text = changeOneCharacter(target.text, 40);

    const result = await check(data, library.sha256Hex, asShown);

    expect(result.axe).toEqual([
      { label: HOME_LABEL, ok: true },
      { label: REPORT_LABEL, ok: false },
    ]);
    expect(result.files.every((file) => file.ok)).toBe(true);
    expect(result.line).toBe(
      `${REPORT_LABEL} doesn't match its fingerprint. ` +
        "21 of 21 transcripts match their fingerprints, and 1 of 2 axe results match their fingerprints, " +
        "and both runs' seals check out",
    );
  });

  it("checks an axe file's whole text, which has no header to leave out, and compares nothing shown with it", async () => {
    const data = axeData();
    // A change in the file's first line, which a transcript's check reads as part of its header,
    // since that's where a transcript's header is.
    const target = data.axe[0]!;
    target.text = target.text.replace('"axeVersion": "4.13.0"', '"axeVersion": "4.13.1"');
    // The page shows its words in a fold, never its text: the check never asks what it shows.
    const shown: Shown = (file) => {
      if (file.name === "axe.json")
        throw new Error("The check asked for an axe file's text shown.");
      return asShown(file);
    };

    const result = await check(data, library.sha256Hex, shown);

    expect(result.axe.map(({ ok }) => ok)).toEqual([false, true]);
    expect(result.line).toContain(`${HOME_LABEL} doesn't match its fingerprint.`);
    expect((await check(axeData(), library.sha256Hex, shown)).axe.every(({ ok }) => ok)).toBe(true);
  });

  it("names an axe file its run's record doesn't list, or lists only the reason for, or a run the page doesn't carry", async () => {
    const data = axeData();
    const latest = data.runs[1]!;
    // The page /ask-a-question/ has a record of why axe has no result, which has no fingerprint.
    latest.pages.find((page) => page.slug === ASK)!.axe = {
      error: "timed out after 20s",
      ranAt: "2026-09-29T14:03:00.000-05:00",
    };
    latest.seal = sealOf(latest);
    const text = data.axe[0]!.text;
    data.axe.push({ run: latest.id, slug: ASK, name: "axe.json", text });
    data.axe.push({ run: "2026-01-01_0000", slug: "home", name: "axe.json", text });

    const result = await check(data, library.sha256Hex, asShown);

    expect(result.axe.slice(2)).toEqual([
      { label: "Run 1402 · /ask-a-question/ · axe.json", ok: false },
      { label: "Run 0000 · home · axe.json", ok: false },
    ]);
    expect(result.line).toContain("2 of 4 axe results match their fingerprints");
  });

  it("names a run whose record was changed to match a changed axe file, by its seal", async () => {
    const data = axeData();
    const changed = changeOneCharacter(data.axe[0]!.text, 40);
    data.axe[0]!.text = changed;
    // Whoever changed the file also puts its new fingerprint in the run's record: the file now
    // matches the record, so only the run's seal gives it away.
    const page = data.runs[1]!.pages.find((candidate) => candidate.slug === "home")!;
    const recorded = page.axe;
    if (recorded === undefined || "error" in recorded) throw new Error("No fingerprint to change.");
    page.axe = { ...recorded, sha256: nodeHex(new TextEncoder().encode(changed)) };

    const result = await check(data, library.sha256Hex, asShown);

    expect(result.axe.map(({ ok }) => ok)).toEqual([true, true]);
    expect(result.runs.map((run) => run.ok)).toEqual([true, false]);
    expect(result.line).toContain("Run 1402's record doesn't match its seal.");
  });

  it("gives the same result with Web Crypto's digest, which is async", async () => {
    const data = axeData();
    data.axe[1]!.text = changeOneCharacter(data.axe[1]!.text, 7);

    expect(await check(data, webCryptoHex, asShown)).toEqual(
      await check(data, library.sha256Hex, asShown),
    );
  });

  it("counts the axe results after the screenshots and before the seals", async () => {
    // Both kinds on run 1402's pages, its record sealed again with both.
    const data = axeData(["home", REPORT], shotData());

    expect((await check(data, library.sha256Hex, asShown, asEmbedded)).line).toBe(
      "21 of 21 transcripts match their fingerprints, and 2 of 2 screenshots match their fingerprints, " +
        "and 2 of 2 axe results match their fingerprints, and both runs' seals check out",
    );
  });

  it("words one axe result in the singular, and none as nothing to say", async () => {
    const one = axeData(["home"]);

    expect((await check(one, library.sha256Hex, asShown)).line).toBe(
      "21 of 21 transcripts match their fingerprints, and 1 of 1 axe result matches its fingerprint, " +
        "and both runs' seals check out",
    );
    one.axe[0]!.text += " ";
    expect((await check(one, library.sha256Hex, asShown)).line).toContain(
      "0 of 1 axe result matches its fingerprint",
    );
    // A page that carries none, and data from before it carried a list of them, say nothing of them.
    const { axe: _list, ...older } = demoData();
    for (const data of [demoData(), older as CheckData]) {
      const result = await check(data, library.sha256Hex, asShown);
      expect(result.axe).toEqual([]);
      expect(result.line).toBe(
        "21 of 21 transcripts match their fingerprints, and both runs' seals check out",
      );
    }
  });
});

describe("checkDataJson", () => {
  it("keeps </script> and <!-- in a transcript intact through the page's data", async () => {
    // Text that would end or hide the data block if it went in as it is, and the two line
    // separators JSON allows but older scripts don't.
    const separators = String.fromCharCode(0x2028, 0x2029);
    const tricky =
      "# voicecap transcript\n</script><script>alert(1)</script>\n<!-- a comment <script> -->\n" +
      `a < b && c > d, "quoted" \\ and ${separators} and 😀\r\n`;
    const data = demoData();
    const target = data.files[0]!;
    target.text = tricky;
    // The run records the file as it really is, and is sealed again, so the check can match it.
    const run = data.runs.find((candidate) => candidate.id === target.run)!;
    run.pages.find((page) => page.slug === target.slug)!.files["read.txt"] = {
      sha256: nodeHex(new TextEncoder().encode(tricky)),
      bytes: Buffer.byteLength(tricky),
    };
    run.seal = sealOf(run);
    data.reviews = history();

    const json = checkDataJson(data);

    expect(json).not.toContain("<");
    expect(JSON.parse(json)).toEqual(data);
    expect((await check(JSON.parse(json) as CheckData)).line).toBe(
      "21 of 21 transcripts match their fingerprints, and both runs' seals check out, " +
        "and the review entries' seals and chain check out",
    );
  });
});

describe("the check's script text", () => {
  it("can sit inside the page's one script, among the page's rules for its text", () => {
    for (const text of [CHECK_LIBRARY, CHECK_SCRIPT]) {
      // Nothing that would end the script early or hide the rest of it in a comment, and nothing the
      // page's own checks for style, src, and href attributes would take for one.
      expect(text).not.toMatch(/<!--|<\/?script/i);
      expect(text).not.toMatch(/\b(style|src|href)\s*=/i);
    }
    expect(CHECK_SCRIPT.startsWith(CHECK_LIBRARY)).toBe(true);
  });

  it("follows a script that lacks its last semicolon, and leaves a page without its markup alone", () => {
    const page = {
      getElementById: () => null,
      querySelectorAll: () => {
        throw new Error("The script touched a page it has no markup in.");
      },
    };
    const context = vm.createContext({ document: page, TextEncoder });

    expect(() => {
      vm.runInContext("(function () { globalThis.before = 1; })()" + CHECK_SCRIPT, context);
    }).not.toThrow();
    expect(vm.runInContext("[before, typeof checkAll]", context)).toEqual([1, "function"]);
  });
});

/**
 * Each transcript as a page's card shows it in its fold: a section that names its file, with the
 * file's body in a `<pre>` (a browser drops the newline right after `<pre>`, so a blank first line
 * needs one more), or no `<pre>` for a transcript with no lines.
 */
function transcriptsIn(data: CheckData): string {
  return data.files
    .map((file) => {
      const body = extractBody(file.text).join("\n");
      const lead = body.startsWith("\n") ? "\n" : "";
      const shown =
        body === "" ? "<p>This transcript has no lines.</p>" : `<pre>${lead}${esc(body)}</pre>`;
      return `<section class="tx" data-run="${esc(file.run)}" data-slug="${esc(file.slug)}" data-file="${esc(file.name)}">${shown}</section>`;
    })
    .join("\n");
}

/**
 * Each screenshot the data lists as the page shows it: on the card of its page, and again as a
 * second copy, such as someone could add (the page itself shows each once, but the check holds every
 * copy there is to the fingerprint). Each is an image that names its page and file, whose address
 * holds its bytes in base64.
 */
function picturesIn(data: CheckData): string {
  return data.screenshots
    .flatMap((shot) =>
      ["card", "copy"].map(
        (place) =>
          `<img class="${place}" src="data:image/jpeg;base64,${Buffer.from(TINY_JPEG).toString("base64")}" alt="" width="16" height="12" data-slug="${esc(shot.slug)}" data-file="${esc(shot.name)}">`,
      ),
    )
    .join("\n");
}

/**
 * A stand-in for the page's evidence section and its cards: the elements the check's wiring names,
 * its data, each transcript as a card's fold shows it, and each screenshot as the page shows it.
 */
function checkPage(data: CheckData): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Check</title></head><body>
<button type="button" id="fp-run" hidden>Check the fingerprints</button>
<button type="button" id="fp-demo" hidden>Show a change being caught</button>
<p class="fp-noscript">To check the fingerprints without scripts, use those two commands.</p>
<p id="fp-result" class="fp-result" role="status"></p>
<details id="fp-list" hidden><summary>Every file checked <span id="fp-count"></span></summary>
<table><thead><tr><th scope="col">File</th><th scope="col">Recorded fingerprint</th><th scope="col">Result</th></tr></thead><tbody id="fp-rows"></tbody></table></details>
<script type="application/json" id="fp-data">${checkDataJson(data)}</script>
${transcriptsIn(data)}
${picturesIn(data)}
<script>${CHECK_SCRIPT}</script>
</body></html>
`;
}

/**
 * The page voicecap writes for a run of the scripted site, each of whose three pages took a
 * screenshot (and, `withAxe`, was checked with axe, the home page with an issue): written from the
 * run's own records, as a reader gets it. Gives the folder the run's home is in, to remove, and the
 * page's file.
 */
async function generatedPage(
  folder: string,
  withAxe = false,
): Promise<{ home: string; file: string }> {
  const home = await setupSite(["/", "/about", "/resources"]);
  const page = (path: string, issues: number) => ({
    screenshot: { jpeg: TINY_JPEG },
    ...(withAxe
      ? {
          axe: keptAxeResults(
            rawAxe({
              violations: Array.from({ length: issues }, (_, at) => rawRule(`rule-${at}`)),
              passes: 20,
            }),
            `${SITE}${path}`,
          ),
        }
      : {}),
  });
  const driver = new ScriptedDriver(
    sitePages({ home: page("/", 1), about: page("/about", 0), resources: page("/resources", 0) }),
  );
  const ran = await runAudit(runOptions(home, driver, { now: () => new Date(2026, 8, 26, 14, 5) }));
  const model = buildShareModel(
    await loadShareInput({ siteDir: ran.siteDir, config: DEFAULT_CONFIG }),
  );
  const file = path.join(folder, withAxe ? "generated-axe.html" : "generated.html");
  await writeFile(file, renderSharePage(model, { fontCss: "" }));
  return { home, file };
}

describe("the check in a browser", () => {
  let browser: Browser;
  let folder: string;
  /** The homes of the runs the generated pages were written for. */
  let generatedHomes: string[];
  /**
   * The page with the demo runs' transcripts, and the same with a review history besides, with
   * two screenshots, and with two axe results; and a page as voicecap generates it, with three
   * screenshots, and the same with three axe results besides.
   */
  let pageUrl: string;
  let reviewsUrl: string;
  let shotsUrl: string;
  let axeUrl: string;
  let generatedUrl: string;
  let generatedAxeUrl: string;
  const contexts: BrowserContext[] = [];

  beforeAll(async () => {
    browser = await launchBrowser();
    folder = await mkdtemp(path.join(tmpdir(), "voicecap-check-"));
    const plain = path.join(folder, "check.html");
    const reviewed = path.join(folder, "check-reviews.html");
    const shots = path.join(folder, "check-shots.html");
    const axe = path.join(folder, "check-axe.html");
    await writeFile(plain, checkPage(demoData()));
    await writeFile(reviewed, checkPage({ ...demoData(), reviews: history() }));
    await writeFile(shots, checkPage(shotData()));
    await writeFile(axe, checkPage(axeData()));
    const generated = await generatedPage(folder);
    const generatedAxe = await generatedPage(folder, true);
    generatedHomes = [generated.home, generatedAxe.home];
    pageUrl = pathToFileURL(plain).href;
    reviewsUrl = pathToFileURL(reviewed).href;
    shotsUrl = pathToFileURL(shots).href;
    axeUrl = pathToFileURL(axe).href;
    generatedUrl = pathToFileURL(generated.file).href;
    generatedAxeUrl = pathToFileURL(generatedAxe.file).href;
  });

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.close()));
  });

  afterAll(async () => {
    await browser.close();
    await rm(folder, { recursive: true, force: true });
    for (const home of generatedHomes) await rm(home, { recursive: true, force: true });
  });

  /**
   * The page, open: the demo's, or with `reviews`, `shots`, `axe`, `generated`, or `generatedAxe`,
   * the one of those. `webCrypto: false` takes crypto.subtle away, as an insecure origin has it.
   */
  async function open(
    options: {
      webCrypto?: boolean;
      scripts?: boolean;
      reviews?: boolean;
      shots?: boolean;
      axe?: boolean;
      generated?: boolean;
      generatedAxe?: boolean;
    } = {},
  ): Promise<Page> {
    const context = await browser.newContext({ javaScriptEnabled: options.scripts ?? true });
    contexts.push(context);
    // Scripts that run in the page before its own: one takes Web Crypto away, the other counts the
    // digests Web Crypto computes.
    await context.addInitScript(
      options.webCrypto === false
        ? `Object.defineProperty(window.crypto, "subtle", { value: undefined });`
        : `window.digests = 0;
           const digest = SubtleCrypto.prototype.digest;
           SubtleCrypto.prototype.digest = function (...args) {
             window.digests += 1;
             return digest.apply(this, args);
           };`,
    );
    const page = await context.newPage();
    const url = options.reviews
      ? reviewsUrl
      : options.shots
        ? shotsUrl
        : options.axe
          ? axeUrl
          : options.generated
            ? generatedUrl
            : options.generatedAxe
              ? generatedAxeUrl
              : pageUrl;
    await page.goto(url);
    return page;
  }

  const MATCHING =
    "Checked just now, in this browser. " +
    "21 of 21 transcripts match their fingerprints, and both runs' seals check out.";

  async function result(page: Page): Promise<string> {
    return (await page.locator("#fp-result").textContent()) ?? "";
  }

  it("shows the buttons and hides the no-script line once the script runs", async () => {
    const page = await open();

    await expect.poll(() => page.locator("#fp-run").isVisible(), { timeout: 10_000 }).toBe(true);
    expect(await page.locator("#fp-demo").isVisible()).toBe(true);
    expect(await page.locator(".fp-noscript").isVisible()).toBe(false);
    expect(await page.locator("#fp-list").isVisible()).toBe(false);
  });

  it("leaves the buttons hidden and the no-script line showing without scripts", async () => {
    const page = await open({ scripts: false });

    expect(await page.locator("#fp-run").isVisible()).toBe(false);
    expect(await page.locator("#fp-demo").isVisible()).toBe(false);
    expect(await page.locator(".fp-noscript").isVisible()).toBe(true);
  });

  it("checks every file with Web Crypto on a click, and lists each", async () => {
    const page = await open();
    await page.locator("#fp-run").click();

    await expect.poll(() => result(page), { timeout: 10_000 }).toBe(MATCHING);

    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result good");
    expect(await page.locator("#fp-count").textContent()).toBe("23 checked, 0 not matching");
    expect(await page.locator("#fp-list").isVisible()).toBe(true);
    const rows = page.locator("#fp-rows tr");
    expect(await rows.count()).toBe(23);
    expect(await rows.nth(0).locator("td").allTextContents()).toEqual([
      "Run 1402 · / · read.txt",
      "f30b29d0b01e…f365fe",
      "matches",
    ]);
    expect((await rows.nth(21).locator("td").allTextContents())[0]).toBe(
      "Run 1315 · its record's seal",
    );
    expect(await page.evaluate(() => (window as unknown as { digests: number }).digests)).toBe(23);
  });

  it("checks with the built-in SHA-256 where Web Crypto is missing", async () => {
    const page = await open({ webCrypto: false });
    expect(await page.evaluate(() => typeof crypto.subtle)).toBe("undefined");
    await page.locator("#fp-run").click();

    await expect.poll(() => result(page), { timeout: 10_000 }).toBe(MATCHING);
    expect(await page.locator("#fp-rows tr").count()).toBe(23);
  });

  it("shows a change being caught, and leaves the page's data as it was", async () => {
    const page = await open();
    const before = await page.locator("#fp-data").textContent();
    await page.locator("#fp-demo").click();

    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Demonstration, on a copy with one character changed " +
          "(the first character of Run 1402 · / · read.txt, “#” to “$”); the page itself is unchanged. " +
          "Run 1402 · / · read.txt doesn't match its fingerprint. " +
          "20 of 21 transcripts match their fingerprints, and both runs' seals check out.",
      );

    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
    expect(await page.locator("#fp-count").textContent()).toBe("23 checked, 1 not matching");
    const first = page.locator("#fp-rows tr").nth(0).locator("td");
    expect(await first.nth(2).textContent()).toBe("doesn’t match");
    expect(await page.locator("#fp-data").textContent()).toBe(before);

    await page.locator("#fp-run").click();
    await expect.poll(() => result(page), { timeout: 10_000 }).toBe(MATCHING);
    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result good");
  });

  it("names a transcript changed in the page's own data", async () => {
    const page = await open();
    await page.evaluate(() => {
      const element = document.getElementById("fp-data")!;
      const data = JSON.parse(element.textContent ?? "") as { files: { text: string }[] };
      data.files[3]!.text += " ";
      element.textContent = JSON.stringify(data);
    });
    await page.locator("#fp-run").click();

    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Checked just now, in this browser. " +
          "Run 1402 · /before-you-start/ · read.txt doesn't match its fingerprint. " +
          "20 of 21 transcripts match their fingerprints, and both runs' seals check out.",
      );
    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
  });

  it("names a transcript whose text the page shows was changed", async () => {
    const page = await open();
    await page.evaluate(() => {
      const shown = document.querySelectorAll("section.tx pre")[3]!;
      shown.textContent = `${shown.textContent ?? ""} (edited)`;
    });
    await page.locator("#fp-run").click();

    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Checked just now, in this browser. " +
          "Run 1402 · /before-you-start/ · read.txt: the text shown doesn't match its file. " +
          "20 of 21 transcripts match their fingerprints, and both runs' seals check out.",
      );
    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
    expect(await page.locator("#fp-count").textContent()).toBe("23 checked, 1 not matching");
  });

  it("lists the review entries as one row when their seals and chain check out", async () => {
    const page = await open({ reviews: true });
    await page.locator("#fp-run").click();

    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Checked just now, in this browser. " +
          "21 of 21 transcripts match their fingerprints, and both runs' seals check out, " +
          "and the review entries' seals and chain check out.",
      );

    expect(await page.locator("#fp-count").textContent()).toBe("24 checked, 0 not matching");
    const last = page.locator("#fp-rows tr").nth(23).locator("td");
    expect(await last.allTextContents()).toEqual([
      "Review entries (3): each seal, and the chain",
      "",
      "matches",
    ]);
  });

  it("names a break in the review chain in the page's own data", async () => {
    const page = await open({ reviews: true });
    await page.evaluate(() => {
      const element = document.getElementById("fp-data")!;
      const data = JSON.parse(element.textContent ?? "") as {
        reviews: Record<string, { seq: number }[]>;
      };
      for (const [key, entries] of Object.entries(data.reviews)) {
        data.reviews[key] = entries.filter((entry) => entry.seq !== 2);
      }
      element.textContent = JSON.stringify(data);
    });
    await page.locator("#fp-run").click();

    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toBe(
        "Checked just now, in this browser. Review entry 2 is missing. " +
          "21 of 21 transcripts match their fingerprints, and both runs' seals check out.",
      );

    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
    expect(await page.locator("#fp-count").textContent()).toBe("24 checked, 1 not matching");
    const last = page.locator("#fp-rows tr").nth(23).locator("td");
    expect(await last.allTextContents()).toEqual([
      "Review entry 2 is missing",
      "",
      "doesn’t match",
    ]);
  });

  it("says what went wrong when the page's data can't be read", async () => {
    const page = await open();
    await page.evaluate(() => {
      document.getElementById("fp-data")!.textContent = "not JSON";
    });
    await page.locator("#fp-run").click();

    await expect
      .poll(() => result(page), { timeout: 10_000 })
      .toMatch(/^The check couldn't run: .+\.$/);
    expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
  });

  describe("with the screenshots a page shows", () => {
    const SHOTS_MATCHING =
      "Checked just now, in this browser. " +
      "21 of 21 transcripts match their fingerprints, and 2 of 2 screenshots match their fingerprints, " +
      "and both runs' seals check out.";

    it.each([true, false])(
      "checks each screenshot's bytes against its run's record, and lists each, with Web Crypto: %s",
      async (webCrypto) => {
        const page = await open({ shots: true, webCrypto });
        await page.locator("#fp-run").click();

        await expect.poll(() => result(page), { timeout: 10_000 }).toBe(SHOTS_MATCHING);

        expect(await page.locator("#fp-count").textContent()).toBe("25 checked, 0 not matching");
        const rows = page.locator("#fp-rows tr");
        // After the transcripts and before the seals, each with the fingerprint its run recorded.
        expect(await rows.nth(21).locator("td").allTextContents()).toEqual([
          "Run 1402 · / · screenshot.jpg",
          `${TINY_RECORD.sha256.slice(0, 12)}…${TINY_RECORD.sha256.slice(-6)}`,
          "matches",
        ]);
        expect((await rows.nth(22).locator("td").allTextContents())[0]).toBe(
          "Run 1402 · /the-report/ · screenshot.jpg",
        );
        expect((await rows.nth(23).locator("td").allTextContents())[0]).toBe(
          "Run 1315 · its record's seal",
        );
        if (webCrypto) {
          // 21 transcripts, 4 copies of 2 screenshots, and 2 seals.
          expect(
            await page.evaluate(() => (window as unknown as { digests: number }).digests),
          ).toBe(21 + 4 + 2);
        }
      },
    );

    it("names a screenshot changed by one character of its base64, whichever copy it's in", async () => {
      for (const place of ["card", "copy"]) {
        const page = await open({ shots: true });
        await page.evaluate((copy) => {
          const image = document.querySelector(`img.${copy}[data-slug="home"]`);
          if (image === null) throw new Error(`The page has no ${copy} copy of the picture.`);
          const address = image.getAttribute("src") ?? "";
          const at = "data:image/jpeg;base64,".length + 40;
          image.setAttribute(
            "src",
            `${address.slice(0, at)}${address[at] === "A" ? "B" : "A"}${address.slice(at + 1)}`,
          );
        }, place);
        await page.locator("#fp-run").click();

        await expect
          .poll(() => result(page), { timeout: 10_000 })
          .toBe(
            "Checked just now, in this browser. " +
              "Run 1402 · / · screenshot.jpg doesn't match its fingerprint. " +
              "21 of 21 transcripts match their fingerprints, and 1 of 2 screenshots match their fingerprints, " +
              "and both runs' seals check out.",
          );
        expect(await page.locator("#fp-result").getAttribute("class"), place).toBe("fp-result bad");
        const rows = await page.locator("#fp-rows tr").allTextContents();
        expect(rows.filter((row) => row.includes("doesn’t match"))).toEqual([
          expect.stringContaining("Run 1402 · / · screenshot.jpg"),
        ]);
      }
    });

    it("names a screenshot that isn't a JPEG in an address, and one with no copy on the page", async () => {
      const page = await open({ shots: true });
      await page.evaluate(() => {
        const [first, second] = document.querySelectorAll(`img[data-slug="home"]`);
        // The right bytes under another type, which this check won't take for the recorded JPEG.
        first?.setAttribute(
          "src",
          first.getAttribute("src")?.replace("image/jpeg", "image/png") ?? "",
        );
        second?.setAttribute("src", "data:image/jpeg;base64,not*base64");
        document.querySelectorAll(`img[data-slug="the-report-03940c2f88"]`).forEach((image) => {
          image.remove();
        });
      });
      await page.locator("#fp-run").click();

      await expect
        .poll(() => result(page), { timeout: 10_000 })
        .toBe(
          "Checked just now, in this browser. " +
            "Run 1402 · / · screenshot.jpg doesn't match its fingerprint. " +
            "Run 1402 · /the-report/ · screenshot.jpg doesn't match its fingerprint. " +
            "21 of 21 transcripts match their fingerprints, and 0 of 2 screenshots match their fingerprints, " +
            "and both runs' seals check out.",
        );
    });

    it("shows a change being caught, with the screenshots matching in the count", async () => {
      const page = await open({ shots: true });
      await page.locator("#fp-demo").click();

      await expect
        .poll(() => result(page), { timeout: 10_000 })
        .toBe(
          "Demonstration, on a copy with one character changed " +
            "(the first character of Run 1402 · / · read.txt, “#” to “$”); the page itself is unchanged. " +
            "Run 1402 · / · read.txt doesn't match its fingerprint. " +
            "20 of 21 transcripts match their fingerprints, and 2 of 2 screenshots match their fingerprints, " +
            "and both runs' seals check out.",
        );
    });
  });

  describe("with the axe results a page carries", () => {
    const AXE_MATCHING =
      "Checked just now, in this browser. " +
      "21 of 21 transcripts match their fingerprints, and 2 of 2 axe results match their fingerprints, " +
      "and both runs' seals check out.";

    it.each([true, false])(
      "checks each axe file against its run's record, and lists each, with Web Crypto: %s",
      async (webCrypto) => {
        const page = await open({ axe: true, webCrypto });
        await page.locator("#fp-run").click();

        await expect.poll(() => result(page), { timeout: 10_000 }).toBe(AXE_MATCHING);

        expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result good");
        expect(await page.locator("#fp-count").textContent()).toBe("25 checked, 0 not matching");
        const rows = page.locator("#fp-rows tr");
        // After the transcripts and before the seals, each with the fingerprint its run recorded.
        const recorded = axeData().runs[1]!.pages.find((each) => each.slug === "home")!.axe;
        const sha256 = recorded && "sha256" in recorded ? recorded.sha256 : "";
        expect(await rows.nth(21).locator("td").allTextContents()).toEqual([
          "Run 1402 · / · axe.json",
          `${sha256.slice(0, 12)}…${sha256.slice(-6)}`,
          "matches",
        ]);
        expect((await rows.nth(22).locator("td").allTextContents())[0]).toBe(
          "Run 1402 · /the-report/ · axe.json",
        );
        expect((await rows.nth(23).locator("td").allTextContents())[0]).toBe(
          "Run 1315 · its record's seal",
        );
      },
    );

    it("names an axe file changed in the page's own data", async () => {
      const page = await open({ axe: true });
      await page.evaluate(() => {
        const element = document.getElementById("fp-data")!;
        const data = JSON.parse(element.textContent ?? "") as { axe: { text: string }[] };
        data.axe[1]!.text = data.axe[1]!.text.replace('"passes": 12', '"passes": 13');
        element.textContent = JSON.stringify(data);
      });
      await page.locator("#fp-run").click();

      await expect
        .poll(() => result(page), { timeout: 10_000 })
        .toBe(
          "Checked just now, in this browser. " +
            "Run 1402 · /the-report/ · axe.json doesn't match its fingerprint. " +
            "21 of 21 transcripts match their fingerprints, and 1 of 2 axe results match their fingerprints, " +
            "and both runs' seals check out.",
        );
      expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
      expect(await page.locator("#fp-count").textContent()).toBe("25 checked, 1 not matching");
    });

    it("shows a change being caught in a transcript and in an axe file, and leaves the page's data as it was", async () => {
      const page = await open({ axe: true });
      const before = await page.locator("#fp-data").textContent();
      await page.locator("#fp-demo").click();

      await expect
        .poll(() => result(page), { timeout: 10_000 })
        .toBe(
          "Demonstration, on a copy with one character changed in each of two files " +
            "(the first character of Run 1402 · / · read.txt, “#” to “$”, and of Run 1402 · / · axe.json, “{” to “#”); " +
            "the page itself is unchanged. " +
            "Run 1402 · / · read.txt doesn't match its fingerprint. " +
            "Run 1402 · / · axe.json doesn't match its fingerprint. " +
            "20 of 21 transcripts match their fingerprints, and 1 of 2 axe results match their fingerprints, " +
            "and both runs' seals check out.",
        );
      expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
      expect(await page.locator("#fp-count").textContent()).toBe("25 checked, 2 not matching");
      expect(await page.locator("#fp-data").textContent()).toBe(before);

      await page.locator("#fp-run").click();
      await expect.poll(() => result(page), { timeout: 10_000 }).toBe(AXE_MATCHING);
    });
  });

  describe("on a page as voicecap generates it", () => {
    const GENERATED_MATCHING =
      "Checked just now, in this browser. " +
      "9 of 9 transcripts match their fingerprints, and 3 of 3 screenshots match their fingerprints, " +
      "and the run's seal checks out.";

    it("checks each page's axe results, carried once in its data, with its transcripts and its screenshot", async () => {
      const page = await open({ generatedAxe: true });

      // Each page's results are in a fold of its card, and each file's text is in the page's data.
      expect(await page.locator("#pg-home details#axe-home").count()).toBe(1);
      expect(await page.locator("details.axe-page").count()).toBe(3);
      await page.locator("#fp-run").click();

      await expect
        .poll(() => result(page), { timeout: 10_000 })
        .toBe(
          "Checked just now, in this browser. " +
            "9 of 9 transcripts match their fingerprints, and 3 of 3 screenshots match their fingerprints, " +
            "and 3 of 3 axe results match their fingerprints, and the run's seal checks out.",
        );
      expect(await page.locator("#fp-count").textContent()).toBe("16 checked, 0 not matching");
      await page.locator("#fp-demo").click();
      await expect
        .poll(() => result(page), { timeout: 10_000 })
        .toMatch(
          /^Demonstration, on a copy with one character changed in each of two files \(the first character of Run 1405 · \/ · read\.txt, “#” to “\$”, and of Run 1405 · \/ · axe\.json, “\{” to “#”\); the page itself is unchanged\. Run 1405 · \/ · read\.txt doesn't match its fingerprint\. Run 1405 · \/ · axe\.json doesn't match its fingerprint\. 8 of 9 transcripts match their fingerprints, and 3 of 3 screenshots match their fingerprints, and 2 of 3 axe results match their fingerprints, and the run's seal checks out\.$/,
        );
    });

    it("finds every transcript and screenshot matching, a page's picture on its card and its transcripts in the card's fold", async () => {
      const page = await open({ generated: true });

      // Each page's picture once, on its card, naming its page and file; the fold in the card holds
      // the page's transcripts, and no picture.
      expect(await page.locator("img[data-file]").count()).toBe(3);
      expect(await page.locator("#pg-home img[data-file]").count()).toBe(1);
      expect(await page.locator("#pg-home details#tx-home section.tx[data-file]").count()).toBe(3);
      expect(await page.locator("#tx-home img[data-file]").count()).toBe(0);
      await page.locator("#fp-run").click();

      await expect.poll(() => result(page), { timeout: 10_000 }).toBe(GENERATED_MATCHING);
      expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result good");
      expect(await page.locator("#fp-count").textContent()).toBe("13 checked, 0 not matching");
    });

    it("names the page's screenshot when one character of its base64 is changed on its card", async () => {
      const page = await open({ generated: true });
      await page.evaluate(() => {
        const image = document.querySelector("#pg-home img");
        if (image === null) throw new Error("The home page's card has no picture.");
        const address = image.getAttribute("src") ?? "";
        const at = "data:image/jpeg;base64,".length + 40;
        image.setAttribute(
          "src",
          `${address.slice(0, at)}${address[at] === "A" ? "B" : "A"}${address.slice(at + 1)}`,
        );
      });
      await page.locator("#fp-run").click();

      await expect
        .poll(() => result(page), { timeout: 10_000 })
        .toBe(
          "Checked just now, in this browser. " +
            "Run 1405 · / · screenshot.jpg doesn't match its fingerprint. " +
            "9 of 9 transcripts match their fingerprints, and 2 of 3 screenshots match their fingerprints, " +
            "and the run's seal checks out.",
        );
      expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
      expect(await page.locator("#fp-count").textContent()).toBe("13 checked, 1 not matching");
    });

    it("names a transcript changed by one character in its card's fold", async () => {
      const page = await open({ generated: true });
      await page.evaluate(() => {
        const shown = document.querySelector("#pg-home details#tx-home section.tx pre");
        if (shown === null) throw new Error("The home page's card shows no transcript.");
        const text = shown.textContent ?? "";
        shown.textContent = `${text.slice(0, -1)}${text.endsWith("x") ? "y" : "x"}`;
      });
      await page.locator("#fp-run").click();

      await expect
        .poll(() => result(page), { timeout: 10_000 })
        .toBe(
          "Checked just now, in this browser. " +
            "Run 1405 · / · read.txt: the text shown doesn't match its file. " +
            "8 of 9 transcripts match their fingerprints, and 3 of 3 screenshots match their fingerprints, " +
            "and the run's seal checks out.",
        );
      expect(await page.locator("#fp-result").getAttribute("class")).toBe("fp-result bad");
    });
  });
});
