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

import type { ReviewEntry, ReviewsFile, ReviewStatus } from "../src/model.js";
import { CHECK_LIBRARY, CHECK_SCRIPT, checkDataJson, type CheckData } from "../src/share/check.js";
import { canonicalJson, sealOf } from "../src/util/hash.js";
import { launchBrowser } from "./helpers/axe.js";
import { DEMO_DAY, demoRun } from "./helpers/share-fixture.js";

interface Checked {
  files: { label: string; ok: boolean }[];
  runs: { id: string; ok: boolean }[];
  reviewProblems: string[];
  line: string;
}

type Digest = (bytes: Uint8Array) => string | Promise<string>;

interface Library {
  sha256Hex: (bytes: Uint8Array) => string;
  canonicalJson: (value: unknown) => string;
  sealOf: (record: object) => string;
  checkAll: (data: CheckData, digest?: Digest) => Promise<Checked>;
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

async function check(data: CheckData, digest: Digest = library.sha256Hex): Promise<Checked> {
  return plain(await library.checkAll(data, digest));
}

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
  return { runs: [earlier, latest], files, reviews: null };
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
    const onlyReviews = await check({ runs: [], files: [], reviews: history() });

    expect(noTranscripts.line).toBe("Both runs' seals check out");
    expect(onlyReviews.line).toBe("The review entries' seals and chain check out");
  });

  it("says so when the page holds nothing to check", async () => {
    const result = await check({ runs: [], files: [], reviews: null });

    expect(result).toEqual({
      files: [],
      runs: [],
      reviewProblems: [],
      line: "This page holds no transcripts or run records to check",
    });
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

/** A stand-in for the page's evidence section: the elements the check's wiring names, and its data. */
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
<script>${CHECK_SCRIPT}</script>
</body></html>
`;
}

describe("the check in a browser", () => {
  let browser: Browser;
  let folder: string;
  /** The page with the demo runs' transcripts, and the same with a review history besides. */
  let pageUrl: string;
  let reviewsUrl: string;
  const contexts: BrowserContext[] = [];

  beforeAll(async () => {
    browser = await launchBrowser();
    folder = await mkdtemp(path.join(tmpdir(), "voicecap-check-"));
    const plain = path.join(folder, "check.html");
    const reviewed = path.join(folder, "check-reviews.html");
    await writeFile(plain, checkPage(demoData()));
    await writeFile(reviewed, checkPage({ ...demoData(), reviews: history() }));
    pageUrl = pathToFileURL(plain).href;
    reviewsUrl = pathToFileURL(reviewed).href;
  });

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.close()));
  });

  afterAll(async () => {
    await browser.close();
    await rm(folder, { recursive: true, force: true });
  });

  /** The page, open. `webCrypto: false` takes crypto.subtle away, as an insecure origin has it. */
  async function open(
    options: { webCrypto?: boolean; scripts?: boolean; reviews?: boolean } = {},
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
    await page.goto(options.reviews === true ? reviewsUrl : pageUrl);
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

    await expect.poll(() => page.locator("#fp-run").isVisible()).toBe(true);
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
});
