/**
 * The walkthrough file's format: built from a run's record, written as the file holds it, and read
 * back strictly, since a walkthrough file may come from anyone.
 */
import { describe, expect, it, vi } from "vitest";

import type { PageSource, PassName, RunJson } from "../src/model.js";
import {
  MAX_ADDRESS_LENGTH,
  MAX_NVDA_SETTINGS_DEPTH,
  MAX_WALKTHROUGH_PAGES,
  parseWalkthrough,
  walkthroughJson,
  walkthroughOf,
  walkthroughProblem,
  type Walkthrough,
} from "../src/share/walkthrough.js";
import { UsageError } from "../src/util/errors.js";
import { shareRun } from "./helpers/share-data.js";
import { demoRun } from "./helpers/share-fixture.js";

const READ = [
  "banner landmark, link, Skip to main content",
  "heading, level 1, Home",
  "content info landmark, © 2026 Example Agency",
];
const HEADINGS = ["heading, level 1, Home", "no next heading"];
const TAB = ["Skip to main content, link", "Home, link"];

/**
 * A completed run of five pages: the first read in all three passes, the second and third in some,
 * the fourth failed after its read pass had begun, and the fifth skipped.
 */
function sampleRun(): RunJson {
  const run = shareRun({
    id: "2026-09-26_1405",
    pages: [
      { path: "/", label: "Home", passes: { read: READ, headings: HEADINGS, tab: TAB } },
      { path: "/grants/fy27-jag", label: "FY27 JAG", passes: { read: ["a"], headings: ["b"] } },
      { path: "/resources", passes: { read: ["c"] } },
      { path: "/broken", status: "failed", passes: { read: ["partial"] } },
      { path: "/contact", status: "skipped" },
    ],
  });
  run.pages[1]!.template = "grants";
  run.pages[1]!.notes = "Check the table.";
  return run;
}

/** What a page's pass said, as its record fingerprints it. */
function said(run: RunJson, index: number, pass: PassName): string {
  const summary = run.pages[index]?.passes[pass];
  if (summary === undefined) throw new Error(`Page ${index + 1} has no ${pass} pass.`);
  return summary.contentSha256;
}

/** The value at a path of keys and positions in parsed JSON. */
function at(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>(
    (current, key) => (current as Record<string | number, unknown>)[key],
    value,
  );
}

/** The keys of the object at a path, in the order the file holds them. */
function keysAt(value: unknown, ...path: (string | number)[]): string[] {
  return Object.keys(at(value, ...path) as object);
}

/**
 * Ways a file's path may have been recorded, each with a folder in it that must not travel. Each
 * path ends in "grants.csv": a test of a walkthrough's file says "w.json" in its place.
 */
const RECORDED_PATHS: [name: string, recorded: string, folders: string][] = [
  ["a Windows path with its drive and user name", "C:\\Users\\Pat\\sites\\grants.csv", "Pat"],
  ["a path relative to the working folder", "lists/grants.csv", "lists"],
  ["a path on a network share", "\\\\server\\share\\lists\\grants.csv", "server"],
  ["a path with both kinds of separator", "C:/Users/Pat\\sites/grants.csv", "Pat"],
  ["a path on a Mac", "/Users/pat/sites/grants.csv", "pat"],
];

describe("walkthroughOf", () => {
  it("holds every page of the run, in its order, with what it said", () => {
    const run = sampleRun();
    const walkthrough = walkthroughOf(run);
    const { pages } = walkthrough;

    expect(walkthrough.voicecapWalkthrough).toBe(1);
    expect(walkthrough.site).toBe(run.site);
    expect(pages.map((page) => page.url)).toEqual(run.pages.map((page) => page.url));

    // A page that was read says what each pass said, where it read it.
    expect(pages[0]).toStrictEqual({
      url: "https://example.illinois.gov/",
      label: "Home",
      original: {
        status: "done",
        passes: {
          read: said(run, 0, "read"),
          headings: said(run, 0, "headings"),
          tab: said(run, 0, "tab"),
        },
      },
    });
    expect(pages[1]).toStrictEqual({
      url: "https://example.illinois.gov/grants/fy27-jag",
      label: "FY27 JAG",
      template: "grants",
      notes: "Check the table.",
      original: {
        status: "done",
        passes: { read: said(run, 1, "read"), headings: said(run, 1, "headings") },
      },
    });
    // A page with no label, template, or notes has no such keys at all, not empty ones.
    expect(pages[2]).toStrictEqual({
      url: "https://example.illinois.gov/resources",
      original: { status: "done", passes: { read: said(run, 2, "read") } },
    });
  });

  it("says nothing of what a page that wasn't read said, though its record kept a partial pass", () => {
    const run = sampleRun();
    expect(run.pages[3]!.passes.read).toBeDefined();

    const { pages } = walkthroughOf(run);

    expect(pages[3]).toStrictEqual({
      url: "https://example.illinois.gov/broken",
      original: { status: "failed", passes: {} },
    });
    expect(pages[4]).toStrictEqual({
      url: "https://example.illinois.gov/contact",
      original: { status: "skipped", passes: {} },
    });
  });

  it("takes the settings that decide what's read, and records the rest", () => {
    const base = sampleRun();
    const run: RunJson = {
      ...base,
      settings: {
        ...base.settings,
        passes: ["tab", "read"],
        capture: "initial",
        stepCaps: { tab: 70, read: 120, headings: 40 },
        readiness: { networkIdleTimeoutMs: 4000, settleMs: 250, readySelector: "#app" },
        nvdaSettings: { speech: { rate: 40 }, "keyboard.speakTypedCharacters": false },
        browser: { channel: "msedge", fallbackToChromium: false },
      },
    };

    const { settings, original } = walkthroughOf(run);

    expect(settings).toStrictEqual({
      passes: ["tab", "read"],
      stepCaps: { read: 120, headings: 40, tab: 70 },
      capture: "initial",
      readiness: { readySelector: "#app", settleMs: 250, networkIdleTimeoutMs: 4000 },
    });
    expect(original.nvdaSettings).toStrictEqual({
      speech: { rate: 40 },
      "keyboard.speakTypedCharacters": false,
    });
    expect(original.browserChannel).toBe("msedge");
  });

  it("shares nothing with the record it was built from", () => {
    const base = sampleRun();
    const run: RunJson = {
      ...base,
      settings: { ...base.settings, nvdaSettings: { speech: { rate: 40 } } },
    };

    const walkthrough = walkthroughOf(run);
    walkthrough.settings.passes.push("tab");
    walkthrough.settings.stepCaps.read = 1;
    (walkthrough.original.nvdaSettings.speech as { rate: number }).rate = 99;

    expect(run.settings.passes).toEqual(["read", "headings", "tab"]);
    expect(run.settings.stepCaps.read).toBe(400);
    expect(run.settings.nvdaSettings).toEqual({ speech: { rate: 40 } });
  });

  it("says where it came from", () => {
    const run = shareRun({
      id: "2026-09-26_1405",
      createdAt: "2026-09-26T14:05:00-05:00",
      replayed: true,
      source: { kind: "pages", file: "pages.csv", sha256: "b".repeat(64) },
      sessions: [
        {
          environment: {
            voicecap: { version: "0.6.0", configSha256: "c".repeat(64) },
            screenReader: { name: "NVDA", version: "2026.1", build: "b1", language: "en" },
            browser: { name: "Chrome", version: "140.0.1" },
          },
        },
        {
          environment: {
            voicecap: { version: "0.7.0", configSha256: "c".repeat(64) },
            screenReader: {
              name: "NVDA",
              version: "2026.3",
              build: "0.2.2-2026.3",
              language: "en",
            },
            browser: { name: "Edge", version: "141.0.2" },
          },
        },
      ],
      pages: [{ path: "/" }],
    });
    run.source.file = "pages.csv";
    run.source.sha256 = "b".repeat(64);

    expect(walkthroughOf(run).original).toStrictEqual({
      run: "2026-09-26_1405",
      seal: run.seal,
      createdAt: "2026-09-26T14:05:00-05:00",
      completedAt: "2026-09-26T14:05:00-05:00",
      replayed: true,
      source: { kind: "pages", file: "pages.csv", sha256: "b".repeat(64) },
      sourceFingerprints: [{ name: "pages.csv", sha256: "b".repeat(64) }],
      // The last session's, with no more of the screen reader's record than its name and version.
      voicecap: "0.7.0",
      screenReader: { name: "NVDA", version: "2026.3" },
      browser: { name: "Edge", version: "141.0.2" },
      nvdaSettings: {},
      browserChannel: "chrome",
    });
  });

  it("takes the versions from the last session that recorded an environment", () => {
    const run = shareRun({
      id: "2026-09-26_1405",
      sessions: [
        { environment: { voicecap: { version: "0.6.0", configSha256: "c".repeat(64) } } },
        { environment: { voicecap: { version: "0.7.0", configSha256: "c".repeat(64) } } },
        {},
      ],
      pages: [{ path: "/" }],
    });
    // The last session never got as far as a driver.
    run.sessions[2]!.environment = null;

    expect(walkthroughOf(run).original.voicecap).toBe("0.7.0");
  });

  it("writes null for a screen reader or a browser the environment didn't record", () => {
    const run = shareRun({
      id: "2026-09-26_1405",
      sessions: [{ environment: { screenReader: null, browser: null } }],
      pages: [{ path: "/" }],
    });

    const { original } = walkthroughOf(run);

    expect(original.screenReader).toBeNull();
    expect(original.browser).toBeNull();
    expect(original.voicecap).toBe("0.1.0");
  });

  it("lists the sitemaps it read, by address, and leaves out one it couldn't read", () => {
    const index = "https://example.illinois.gov/sitemap.xml";
    const child = "https://example.illinois.gov/sitemap-pages.xml";
    const run = shareRun({
      id: "2026-09-26_1405",
      source: { kind: "sitemap", url: index },
      pages: [{ path: "/" }],
    });
    run.source.sitemaps = [
      { url: index, urls: 0, sha256: "1".repeat(64) },
      { url: child, urls: 5, sha256: "2".repeat(64) },
      { url: "https://example.illinois.gov/sitemap-news.xml", urls: 0, error: "HTTP 404" },
    ];

    const { original } = walkthroughOf(run);

    expect(original.source).toStrictEqual({ kind: "sitemap", url: index });
    expect(original.sourceFingerprints).toStrictEqual([
      { name: index, sha256: "1".repeat(64) },
      { name: child, sha256: "2".repeat(64) },
    ]);
  });

  it("has no source fingerprints for pages given with --page", () => {
    const urls = ["https://example.illinois.gov/", "https://example.illinois.gov/faq/"];
    const run = shareRun({
      id: "2026-09-26_1405",
      source: { kind: "urls", urls },
      pages: [{ path: "/" }, { path: "/faq/" }],
    });

    const { original } = walkthroughOf(run);

    expect(original.source).toStrictEqual({ kind: "urls", urls });
    expect(original.sourceFingerprints).toStrictEqual([]);
  });

  it.each(RECORDED_PATHS)(
    "keeps a page list's file by its name alone: %s",
    (_name, recorded, folders) => {
      const sha256 = "b".repeat(64);
      const run = shareRun({
        id: "2026-09-26_1405",
        source: { kind: "pages", file: recorded, sha256 },
        pages: [{ path: "/" }],
      });
      run.source.file = recorded;
      run.source.sha256 = sha256;

      const walkthrough = walkthroughOf(run);

      expect(walkthrough.original.source).toStrictEqual({
        kind: "pages",
        file: "grants.csv",
        sha256,
      });
      expect(walkthrough.original.sourceFingerprints).toStrictEqual([
        { name: "grants.csv", sha256 },
      ]);
      // None of the folders is anywhere in the file, which goes to auditors and into the page.
      expect(walkthroughJson(walkthrough)).not.toContain(folders);
      // The record keeps what it recorded: only the file leaves its folders out.
      expect(run.settings.source).toStrictEqual({ kind: "pages", file: recorded, sha256 });
      expect(run.source.file).toBe(recorded);
    },
  );

  it("says where a repeat came from: the walkthrough it read its pages from", () => {
    const sha256 = "c".repeat(64);
    const run = shareRun({
      id: "2026-09-30_0900",
      source: { kind: "walkthrough", file: "w.json", sha256, run: "2026-09-29_1402" },
      pages: [{ path: "/" }],
    });
    run.source.file = "w.json";
    run.source.sha256 = sha256;

    const { original } = walkthroughOf(run);

    expect(original.source).toStrictEqual({
      kind: "walkthrough",
      file: "w.json",
      sha256,
      run: "2026-09-29_1402",
    });
    expect(original.sourceFingerprints).toStrictEqual([{ name: "w.json", sha256 }]);
  });

  it.each(RECORDED_PATHS)(
    "keeps a walkthrough's file by its name alone, as a page list's: %s",
    (_name, listed, folders) => {
      const recorded = listed.replace("grants.csv", "w.json");
      const sha256 = "b".repeat(64);
      const run = shareRun({
        id: "2026-09-30_0900",
        source: { kind: "walkthrough", file: recorded, sha256, run: "2026-09-29_1402" },
        pages: [{ path: "/" }],
      });
      run.source.file = recorded;
      run.source.sha256 = sha256;

      const walkthrough = walkthroughOf(run);

      expect(walkthrough.original.source).toStrictEqual({
        kind: "walkthrough",
        file: "w.json",
        sha256,
        run: "2026-09-29_1402",
      });
      expect(walkthrough.original.sourceFingerprints).toStrictEqual([{ name: "w.json", sha256 }]);
      // None of the folders is anywhere in the file, which goes to auditors and into the page.
      expect(walkthroughJson(walkthrough)).not.toContain(folders);
      // The record keeps what it recorded: only the file leaves its folders out.
      expect(run.settings.source).toStrictEqual({
        kind: "walkthrough",
        file: recorded,
        sha256,
        run: "2026-09-29_1402",
      });
      expect(run.source.file).toBe(recorded);
    },
  );

  it("keeps a sitemap's address and the --page addresses whole, folders and all", () => {
    const sitemap = "https://example.illinois.gov/sitemaps/pages/sitemap.xml";
    const bySitemap = shareRun({
      id: "2026-09-26_1405",
      source: { kind: "sitemap", url: sitemap },
      pages: [{ path: "/" }],
    });
    bySitemap.source.sitemaps = [{ url: sitemap, urls: 1, sha256: "1".repeat(64) }];
    const urls = ["https://example.illinois.gov/a/b/", "https://example.illinois.gov/c/d/e/"];
    const byPage = shareRun({
      id: "2026-09-26_1405",
      source: { kind: "urls", urls },
      pages: [{ path: "/a/b/" }, { path: "/c/d/e/" }],
    });

    const sitemapOrigin = walkthroughOf(bySitemap).original;

    expect(sitemapOrigin.source).toStrictEqual({ kind: "sitemap", url: sitemap });
    expect(sitemapOrigin.sourceFingerprints).toStrictEqual([
      { name: sitemap, sha256: "1".repeat(64) },
    ]);
    expect(walkthroughOf(byPage).original.source).toStrictEqual({ kind: "urls", urls });
  });

  it("writes nulls where an older run recorded nothing", () => {
    const run = demoRun("1402");

    const walkthrough = walkthroughOf(run);

    // Voicecap 0.4.1 didn't record the readiness settings, so the file says it has none to give.
    expect(walkthrough.site).toBe("http://127.0.0.1:4848");
    expect(walkthrough.settings.readiness).toBeNull();
    expect(walkthrough.original.voicecap).toBe("0.4.1");
    expect(walkthrough.original).toStrictEqual({
      run: "2026-09-29_1402",
      seal: "d5dde0403c8b18e9aec8aa88b0d53c0c1da9945fb87784af3605a67642875985",
      createdAt: "2026-09-29T14:02:51-05:00",
      completedAt: "2026-09-29T14:09:14-05:00",
      replayed: false,
      source: { kind: "sitemap", url: "http://127.0.0.1:4848/sitemap.xml" },
      sourceFingerprints: [
        {
          name: "http://127.0.0.1:4848/sitemap.xml",
          sha256: "1eec317b01d1ccc487845b3f8cb316a1be2c4b612508da25f04ecbd78ae79481",
        },
      ],
      voicecap: "0.4.1",
      screenReader: { name: "NVDA", version: "2026.2" },
      browser: { name: "Chrome", version: "154.0.8037.58" },
      nvdaSettings: {},
      browserChannel: "chrome",
    });
    expect(walkthrough.pages).toHaveLength(7);
    // The third page failed, though its record kept two passes it had begun.
    expect(run.pages[2]!.passes.read).toBeDefined();
    expect(walkthrough.pages[2]).toStrictEqual({
      url: "http://127.0.0.1:4848/how-a-run-works/",
      original: { status: "failed", passes: {} },
    });
  });

  it("writes null for the seal and the versions of a record that has none", () => {
    const { seal: _seal, ...unsealed } = demoRun("1402");
    const bare: RunJson = {
      ...unsealed,
      sessions: unsealed.sessions.map((session) => ({ ...session, environment: null })),
    };

    expect(walkthroughOf(bare).original).toMatchObject({
      seal: null,
      voicecap: null,
      screenReader: null,
      browser: null,
    });
  });

  it("refuses an incomplete run", () => {
    const run = shareRun({
      id: "2026-09-26_1405",
      status: "incomplete",
      pages: [{ path: "/" }, { path: "/faq/", status: "pending" }],
    });

    expect(() => walkthroughOf(run)).toThrow(UsageError);
    expect(() => walkthroughOf(run)).toThrow(
      "Run 2026-09-26_1405 didn't complete, so it can't be repeated. Run it to the end first.",
    );
  });

  it("refuses a record that says completed but has no time it completed", () => {
    const run: RunJson = { ...sampleRun(), completedAt: null };

    expect(() => walkthroughOf(run)).toThrow(
      "Run 2026-09-26_1405 didn't complete, so it can't be repeated. Run it to the end first.",
    );
  });
});

describe("walkthroughJson", () => {
  it("reads back exactly what it wrote, keys in the type's order", () => {
    const walkthrough = walkthroughOf(sampleRun());

    const text = walkthroughJson(walkthrough);

    expect(parseWalkthrough(text, "w.json")).toStrictEqual(walkthrough);
    expect(Object.keys(JSON.parse(text) as object)).toEqual([
      "voicecapWalkthrough",
      "site",
      "pages",
      "settings",
      "original",
    ]);
    expect(text.startsWith('{\n  "voicecapWalkthrough": 1,\n  "site": ')).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.endsWith("}\n\n")).toBe(false);
  });

  it.each(["1315", "1402"] as const)("reads back what it wrote of demo run %s", (time) => {
    const walkthrough = walkthroughOf(demoRun(time));

    expect(parseWalkthrough(walkthroughJson(walkthrough), "w.json")).toStrictEqual(walkthrough);
  });

  it("keeps the type's key order at every level, whatever order the record kept", () => {
    const run = sampleRun();
    // A record whose keys are in other orders than the type's, in each place a walkthrough copies.
    run.settings = {
      ...run.settings,
      source: { sha256: "a".repeat(64), file: "pages.csv", kind: "pages" },
      stepCaps: { tab: 300, read: 400, headings: 200 },
      readiness: { networkIdleTimeoutMs: 15000, settleMs: 500, readySelector: null },
    };
    const first = run.pages[0]!;
    first.passes = {
      tab: first.passes.tab!,
      headings: first.passes.headings!,
      read: first.passes.read!,
    };
    run.sessions[0]!.environment = {
      ...run.sessions[0]!.environment!,
      screenReader: { language: "en", build: "b1", version: "2026.2", name: "NVDA" },
      browser: { version: "141.0.7390.55", name: "Chrome" },
    };

    const file = JSON.parse(walkthroughJson(walkthroughOf(run))) as unknown;

    expect(keysAt(file, "pages", 0)).toEqual(["url", "label", "original"]);
    expect(keysAt(file, "pages", 1)).toEqual(["url", "label", "template", "notes", "original"]);
    expect(keysAt(file, "pages", 0, "original")).toEqual(["status", "passes"]);
    expect(keysAt(file, "pages", 0, "original", "passes")).toEqual(["read", "headings", "tab"]);
    expect(keysAt(file, "settings")).toEqual(["passes", "stepCaps", "capture", "readiness"]);
    expect(keysAt(file, "settings", "stepCaps")).toEqual(["read", "headings", "tab"]);
    expect(keysAt(file, "settings", "readiness")).toEqual([
      "readySelector",
      "settleMs",
      "networkIdleTimeoutMs",
    ]);
    expect(keysAt(file, "original")).toEqual([
      "run",
      "seal",
      "createdAt",
      "completedAt",
      "replayed",
      "source",
      "sourceFingerprints",
      "voicecap",
      "screenReader",
      "browser",
      "nvdaSettings",
      "browserChannel",
    ]);
    expect(keysAt(file, "original", "source")).toEqual(["kind", "file", "sha256"]);
    expect(keysAt(file, "original", "screenReader")).toEqual(["name", "version"]);
    expect(keysAt(file, "original", "browser")).toEqual(["name", "version"]);
  });

  it("keeps a walkthrough source's keys in the type's order, whatever order the record kept", () => {
    const run = sampleRun();
    run.settings = {
      ...run.settings,
      source: {
        run: "2026-09-29_1402",
        sha256: "a".repeat(64),
        file: "w.json",
        kind: "walkthrough",
      },
    };

    const file = JSON.parse(walkthroughJson(walkthroughOf(run))) as unknown;

    expect(keysAt(file, "original", "source")).toEqual(["kind", "file", "sha256", "run"]);
  });

  it.each<[name: string, settings: Partial<RunJson["settings"]>]>([
    [
      "the least",
      {
        stepCaps: { read: 1, headings: 1, tab: 1 },
        readiness: { readySelector: "main", settleMs: 0, networkIdleTimeoutMs: 1 },
      },
    ],
    [
      "the most",
      {
        stepCaps: { read: 100_000, headings: 100_000, tab: 100_000 },
        readiness: { readySelector: null, settleMs: 600_000, networkIdleTimeoutMs: 600_000 },
      },
    ],
  ])("reads back a run whose settings are %s its config allows of them", (_name, settings) => {
    const base = sampleRun();
    const walkthrough = walkthroughOf({ ...base, settings: { ...base.settings, ...settings } });

    expect(parseWalkthrough(walkthroughJson(walkthrough), "w.json")).toStrictEqual(walkthrough);
  });

  it.each<[name: string, source: PageSource]>([
    ["a sitemap", { kind: "sitemap", url: "https://example.illinois.gov/sitemap.xml" }],
    ["a page list", { kind: "pages", file: "pages.csv", sha256: "a".repeat(64) }],
    [
      "a walkthrough",
      { kind: "walkthrough", file: "w.json", sha256: "a".repeat(64), run: "2026-09-29_1402" },
    ],
    [
      "--page",
      {
        kind: "urls",
        urls: ["https://example.illinois.gov/", "https://example.illinois.gov/faq/"],
      },
    ],
  ])("reads back a run whose pages came from %s", (_name, source) => {
    const run = shareRun({ id: "2026-09-26_1405", source, pages: [{ path: "/" }] });
    const walkthrough = walkthroughOf(run);

    expect(walkthrough.original.source).toStrictEqual(source);
    expect(parseWalkthrough(walkthroughJson(walkthrough), "w.json")).toStrictEqual(walkthrough);
  });
});

/** The first words of every refusal. */
const NOT_A_WALKTHROUGH = "w.json isn't a voicecap walkthrough file: ";

/** The message parseWalkthrough refuses a file with, once it has checked it's a UsageError. */
function refusal(text: string): string {
  let error: unknown;
  try {
    parseWalkthrough(text, "w.json");
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(UsageError);
  return (error as UsageError).message;
}

/** The walkthrough with page `index`'s address changed. */
function withPageUrl(walkthrough: Walkthrough, index: number, url: string): Walkthrough {
  return {
    ...walkthrough,
    pages: walkthrough.pages.map((page, place) => (place === index ? { ...page, url } : page)),
  };
}

/** The walkthrough with page 1's fingerprint for its read pass changed. */
function withPassFingerprint(walkthrough: Walkthrough, fingerprint: string): unknown {
  return withPageOriginal(walkthrough, {
    status: "done",
    passes: { ...walkthrough.pages[0]!.original.passes, read: fingerprint },
  });
}

/** The walkthrough with page 1's `original` replaced by anything. */
function withPageOriginal(walkthrough: Walkthrough, original: unknown): unknown {
  return {
    ...walkthrough,
    pages: walkthrough.pages.map((page, index) => (index === 0 ? { ...page, original } : page)),
  };
}

/** A file text from what a test broke: a string is the text itself, anything else is JSON. */
function textOf(file: unknown): string {
  return typeof file === "string" ? file : JSON.stringify(file, null, 2);
}

// The limits Rulings P15 and P14 set, written out here so a change to either shows in a test.
const ADDRESS_LIMIT = 8_192;
const SETTINGS_LEVELS = 32;

/** An address on the site (the sample's) that is exactly `length` characters long. */
function addressOfLength(length: number): string {
  const start = "https://example.illinois.gov/";
  return start + "a".repeat(length - start.length);
}

/**
 * NVDA settings nested `levels` deep: the settings are the first level, and each next level is an
 * object inside the one before.
 */
function settingsNested(levels: number): Record<string, unknown> {
  let settings: Record<string, unknown> = {};
  for (let level = 1; level < levels; level += 1) settings = { inner: settings };
  return settings;
}

/**
 * NVDA settings with `lists` lists inside one another under one key. Lists are levels as objects
 * are: with the settings themselves, that is `lists` + 1 levels.
 */
function settingsWithLists(lists: number): Record<string, unknown> {
  let list: unknown[] = [];
  for (let count = 1; count < lists; count += 1) list = [list];
  return { list };
}

/** The walkthrough with its NVDA settings replaced by anything. */
function withNvdaSettings(walkthrough: Walkthrough, nvdaSettings: unknown): unknown {
  return { ...walkthrough, original: { ...walkthrough.original, nvdaSettings } };
}

/** The walkthrough with the page source its original recorded replaced by anything. */
function withSource(walkthrough: Walkthrough, source: unknown): unknown {
  return { ...walkthrough, original: { ...walkthrough.original, source } };
}

/** What a walkthrough's source is when it's right: a walkthrough, here, for a test to break. */
const WALKTHROUGH_SOURCE = {
  kind: "walkthrough",
  file: "w.json",
  sha256: "a".repeat(64),
  run: "2026-09-29_1402",
};

/**
 * A run whose walkthrough has a value in every place the format has one, with its pages from
 * `source`: every optional page field on one page, every pass on another, and the settings,
 * versions, seal, and fingerprints a run can record.
 */
function completeRun(source: "sitemap" | "pages" | "walkthrough" | "urls"): RunJson {
  const sitemap = "https://example.illinois.gov/sitemap.xml";
  const pageSource: PageSource =
    source === "sitemap"
      ? { kind: "sitemap", url: sitemap }
      : source === "pages"
        ? { kind: "pages", file: "pages.csv", sha256: "b".repeat(64) }
        : source === "walkthrough"
          ? { kind: "walkthrough", file: "w.json", sha256: "b".repeat(64), run: "2026-09-29_1402" }
          : {
              kind: "urls",
              urls: ["https://example.illinois.gov/", "https://example.illinois.gov/faq/"],
            };
  const run = shareRun({
    id: "2026-09-26_1405",
    source: pageSource,
    pages: [
      { path: "/", label: "Home", passes: { read: READ, headings: HEADINGS, tab: TAB } },
      { path: "/grants/fy27-jag", label: "FY27 JAG", passes: { read: ["a"] } },
    ],
  });
  run.pages[1]!.template = "grants";
  run.pages[1]!.notes = "Check the table.";
  run.settings = {
    ...run.settings,
    readiness: { readySelector: "#app", settleMs: 250, networkIdleTimeoutMs: 4000 },
    nvdaSettings: { speech: { rate: 40 } },
  };
  if (source === "sitemap") {
    run.source.sitemaps = [{ url: sitemap, urls: 2, sha256: "1".repeat(64) }];
  }
  if (pageSource.kind === "pages" || pageSource.kind === "walkthrough") {
    run.source.file = pageSource.file;
    run.source.sha256 = pageSource.sha256;
  }
  return run;
}

/** A place in parsed JSON, as the keys and positions that lead to it. */
type Place = (string | number)[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every place in parsed JSON that holds a value, the whole file (the empty place) first. Not what's
 * inside the NVDA settings, which are recorded and not read, and hold anything.
 */
function placesIn(value: unknown, place: Place = []): Place[] {
  const inside =
    place.join(".") !== "original.nvdaSettings" && typeof value === "object" && value !== null
      ? Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
          placesIn(item, [...place, Array.isArray(value) ? Number(key) : key]),
        )
      : [];
  return [place, ...inside];
}

/** What a place holds is `value`, in this file. */
function setAt(file: unknown, place: Place, value: unknown): void {
  (at(file, ...place.slice(0, -1)) as Record<string | number, unknown>)[place.at(-1)!] = value;
}

/** What a place held is gone from this file, key and all. */
function removeAt(file: unknown, place: Place): void {
  delete (at(file, ...place.slice(0, -1)) as Record<string | number, unknown>)[place.at(-1)!];
}

/** Whether the place is one of the items of a list. */
function isInsideList(file: unknown, place: Place): boolean {
  return Array.isArray(at(file, ...place.slice(0, -1)));
}

/**
 * Whether a file may leave a place out: a page's label, template, or notes, and the fingerprint of a
 * pass the page wasn't read in.
 */
function isOptional(place: Place): boolean {
  if (place[0] !== "pages") return false;
  if (place.length === 3) return ["label", "template", "notes"].includes(String(place[2]));
  return place.length === 5 && place[2] === "original" && place[3] === "passes";
}

describe("parseWalkthrough", () => {
  const valid = (): Walkthrough => walkthroughOf(sampleRun());

  it.each<[name: string, file: (walkthrough: Walkthrough) => unknown, reason: string]>([
    ["a file that isn't JSON", () => "{ not json", "it isn't JSON"],
    ["a format version of 2", (w) => ({ ...w, voicecapWalkthrough: 2 }), "its format version is 2"],
    ["a list of no pages", (w) => ({ ...w, pages: [] }), "it lists no pages"],
    [
      "page 3's address on the local disk",
      (w) => withPageUrl(w, 2, "file:///C:/x"),
      "page 3's address, file:///C:/x, isn't on its site",
    ],
    [
      "a page at another site",
      (w) => withPageUrl(w, 1, "https://elsewhere.example/"),
      "isn't on its site",
    ],
    [
      "a page at a script address",
      (w) => withPageUrl(w, 0, "javascript:alert(1)"),
      "isn't on its site",
    ],
    [
      "a site on the local disk",
      (w) => ({ ...w, site: "file:///C:/" }),
      "its site isn't a web address",
    ],
    [
      "a pass listed twice",
      (w) => ({ ...w, settings: { ...w.settings, passes: ["read", "read"] } }),
      "passes",
    ],
    [
      "a pass voicecap doesn't have",
      (w) => ({ ...w, settings: { ...w.settings, passes: ["speak"] } }),
      "passes",
    ],
    [
      "a step limit of 0",
      (w) => ({
        ...w,
        settings: { ...w.settings, stepCaps: { ...w.settings.stepCaps, read: 0 } },
      }),
      "stepCaps",
    ],
    ["a key it doesn't have", (w) => ({ ...w, run: "2026-09-26_1405" }), "run"],
    [
      "more pages than a walkthrough may list",
      (w) => ({
        ...w,
        pages: Array.from({ length: MAX_WALKTHROUGH_PAGES + 1 }, (_, index) => ({
          url: `https://example.illinois.gov/page-${index}/`,
          original: { status: "failed", passes: {} },
        })),
      }),
      "more than 10,000 pages",
    ],
  ])("refuses %s, saying why", (_name, file, reason) => {
    const message = refusal(textOf(file(valid())));

    expect(message.startsWith(NOT_A_WALKTHROUGH)).toBe(true);
    expect(message).toContain(reason);
  });

  it.each<[name: string, file: (walkthrough: Walkthrough) => unknown, message: string]>([
    [
      "text that isn't JSON",
      () => "{ not json",
      "w.json isn't a voicecap walkthrough file: it isn't JSON.",
    ],
    [
      "a format version it doesn't read",
      (w) => ({ ...w, voicecapWalkthrough: 2 }),
      "w.json isn't a voicecap walkthrough file: its format version is 2, and this voicecap reads version 1.",
    ],
    [
      "no pages",
      (w) => ({ ...w, pages: [] }),
      "w.json isn't a voicecap walkthrough file: it lists no pages.",
    ],
    [
      "a page at another site",
      (w) => withPageUrl(w, 1, "https://elsewhere.example/"),
      "w.json isn't a voicecap walkthrough file: page 2's address, https://elsewhere.example/, isn't on its site.",
    ],
    [
      "a site that isn't a web address",
      (w) => ({ ...w, site: "file:///C:/" }),
      "w.json isn't a voicecap walkthrough file: its site isn't a web address.",
    ],
    [
      "a pass listed twice",
      (w) => ({ ...w, settings: { ...w.settings, passes: ["read", "read"] } }),
      "w.json isn't a voicecap walkthrough file: its settings.passes name a pass more than once.",
    ],
    [
      "a step limit of 0",
      (w) => ({ ...w, settings: { ...w.settings, stepCaps: { ...w.settings.stepCaps, read: 0 } } }),
      "w.json isn't a voicecap walkthrough file: its settings.stepCaps.read: must be a whole number from 1 to 100,000.",
    ],
    [
      "a key it doesn't have",
      (w) => ({ ...w, run: "2026-09-26_1405" }),
      "w.json isn't a voicecap walkthrough file: it has a key voicecap doesn't know: \"run\".",
    ],
    [
      "a walkthrough source with an empty file name",
      (w) => withSource(w, { ...WALKTHROUGH_SOURCE, file: "" }),
      "w.json isn't a voicecap walkthrough file: its original.source.file: must be a file's name.",
    ],
    [
      "a walkthrough source with an empty run",
      (w) => withSource(w, { ...WALKTHROUGH_SOURCE, run: "" }),
      "w.json isn't a voicecap walkthrough file: its original.source.run: must be a run's id.",
    ],
    [
      "an address with an escape sequence in it",
      (w) => withPageUrl(w, 2, "https://example.illinois.gov/\u{1b}[2J\u{1b}]0;pwned\u{7}"),
      "w.json isn't a voicecap walkthrough file: page 3's address has a space or a control character in it.",
    ],
    [
      "a site with a space in front of it",
      (w) => ({ ...w, site: " https://example.illinois.gov" }),
      "w.json isn't a voicecap walkthrough file: its site has a space or a control character in it.",
    ],
    [
      "an address of 8,193 characters",
      (w) => withPageUrl(w, 2, addressOfLength(ADDRESS_LIMIT + 1)),
      "w.json isn't a voicecap walkthrough file: page 3's address is longer than 8,192 characters.",
    ],
    [
      "a site of 8,193 characters",
      (w) => ({ ...w, site: addressOfLength(ADDRESS_LIMIT + 1) }),
      "w.json isn't a voicecap walkthrough file: its site is longer than 8,192 characters.",
    ],
    [
      "NVDA settings nested 33 levels deep",
      (w) => withNvdaSettings(w, settingsNested(SETTINGS_LEVELS + 1)),
      "w.json isn't a voicecap walkthrough file: its original.nvdaSettings is nested more than 32 levels deep.",
    ],
  ])("says it in plain words: %s", (_name, file, message) => {
    expect(refusal(textOf(file(valid())))).toBe(message);
  });

  it("gives one reason, the first it comes to, when several things are wrong", () => {
    const w = valid();
    const text = textOf({
      ...w,
      site: "file:///C:/",
      settings: { ...w.settings, capture: "everything" },
      run: "2026-09-26_1405",
    });

    // The site comes before the capture mode in a walkthrough, and a key it doesn't have last.
    expect(refusal(text)).toBe(
      "w.json isn't a voicecap walkthrough file: its site isn't a web address.",
    );
  });

  it("names the file it refused, as it was given", () => {
    expect(() => parseWalkthrough("[", "C:/walks/site one.json")).toThrow(
      "C:/walks/site one.json isn't a voicecap walkthrough file: it isn't JSON",
    );
  });

  it.each<[name: string, file: unknown, reason: string]>([
    ["JSON that is a list", [], "it isn't a JSON object"],
    ["JSON that is nothing", null, "it isn't a JSON object"],
    ["JSON that is text", '"hello"', "it isn't a JSON object"],
    [
      "a run's record, which has no format version",
      { schemaVersion: 1, id: "x" },
      'it has no "voicecapWalkthrough" format version',
    ],
    ["a format version in text", { voicecapWalkthrough: "1" }, 'its format version is "1"'],
    ["a format version of nothing", { voicecapWalkthrough: null }, "its format version is null"],
    [
      "a format version that is a list",
      { voicecapWalkthrough: [1] },
      "its format version is a list",
    ],
    [
      "a format version that is an object",
      { voicecapWalkthrough: { number: 1 } },
      "its format version is an object",
    ],
  ])("refuses %s before looking at the rest", (_name, file, reason) => {
    const message = refusal(textOf(file));

    expect(message.startsWith(NOT_A_WALKTHROUGH)).toBe(true);
    expect(message).toContain(reason);
  });

  it("refuses a format version nested too deep to write out, as it refuses any other", () => {
    const depth = 50_000;
    const text = `{"voicecapWalkthrough":${"[".repeat(depth)}${"]".repeat(depth)}}`;

    expect(refusal(text).startsWith(NOT_A_WALKTHROUGH)).toBe(true);
  });

  it.each<[name: string, file: (walkthrough: Walkthrough) => unknown, reason: string]>([
    [
      "an address that isn't a full one",
      (w) => withPageUrl(w, 3, "/about"),
      "page 4's address, /about, isn't a full web address",
    ],
    [
      "an empty address",
      (w) => withPageUrl(w, 0, ""),
      "page 1's address, \"\", isn't a full web address",
    ],
    [
      "the site's address over a different scheme",
      (w) => withPageUrl(w, 0, "http://example.illinois.gov/"),
      "page 1's address, http://example.illinois.gov/, isn't on its site",
    ],
    [
      "the site's address on another port",
      (w) => withPageUrl(w, 0, "https://example.illinois.gov:8443/"),
      "isn't on its site",
    ],
    [
      "an address that only starts like the site's",
      (w) => withPageUrl(w, 0, "https://example.illinois.gov.elsewhere.example/"),
      "isn't on its site",
    ],
    [
      "an address whose user name is the site's",
      (w) => withPageUrl(w, 0, "https://example.illinois.gov@elsewhere.example/"),
      "isn't on its site",
    ],
    [
      "an address of another kind altogether",
      (w) => withPageUrl(w, 0, "data:text/html,<h1>hi</h1>"),
      "isn't on its site",
    ],
    [
      // A blob: address has the origin of the address inside it, so the origin alone isn't enough.
      "a blob: address that carries the site's origin",
      (w) =>
        withPageUrl(w, 0, "blob:https://example.illinois.gov/6f1c2f7e-0000-4000-8000-000000000000"),
      "page 1's address, blob:https://example.illinois.gov/6f1c2f7e-0000-4000-8000-000000000000, isn't on its site",
    ],
    [
      "a web socket address on the site's host",
      (w) => withPageUrl(w, 0, "wss://example.illinois.gov/"),
      "isn't on its site",
    ],
    [
      // The host with a dot after it is another host to a browser, and to the origin.
      "a host with a dot at its end",
      (w) => withPageUrl(w, 0, "https://example.illinois.gov./x"),
      "page 1's address, https://example.illinois.gov./x, isn't on its site",
    ],
    [
      "an address that starts with two slashes, as a page could write it",
      (w) => withPageUrl(w, 0, "//example.illinois.gov/x"),
      "page 1's address, //example.illinois.gov/x, isn't a full web address",
    ],
    [
      "a host that looks like the site's, with a letter from another script",
      (w) => withPageUrl(w, 0, "https://ex\u{430}mple.illinois.gov/x"),
      "page 1's address, https://ex\u{430}mple.illinois.gov/x, isn't on its site",
    ],
    [
      "the same look-alike host, written as punycode",
      (w) => withPageUrl(w, 0, "https://xn--exmple-cua.illinois.gov/x"),
      "page 1's address, https://xn--exmple-cua.illinois.gov/x, isn't on its site",
    ],
    [
      "backslashes where another host's address has slashes",
      (w) => withPageUrl(w, 0, "https:\\\\evil\\x"),
      "page 1's address, https:\\\\evil\\x, isn't on its site",
    ],
    [
      "a site that isn't an address",
      (w) => ({ ...w, site: "example.illinois.gov" }),
      "its site isn't a web address",
    ],
    ["a site that isn't text", (w) => ({ ...w, site: 5 }), "its site"],
  ])("refuses a file with %s, naming the page or the site", (_name, file, reason) => {
    const message = refusal(textOf(file(valid())));

    expect(message.startsWith(NOT_A_WALKTHROUGH)).toBe(true);
    expect(message).toContain(reason);
  });

  it("accepts the site's own address in any case, with or without a trailing slash on the site", () => {
    const walkthrough: Walkthrough = {
      ...withPageUrl(valid(), 0, "HTTPS://EXAMPLE.ILLINOIS.GOV/Home"),
      site: "https://example.illinois.gov",
    };

    expect(parseWalkthrough(textOf(walkthrough), "w.json")).toStrictEqual(walkthrough);
  });

  it("refuses a list too long for its size without reading a page of it", () => {
    // None of these is a page, but the size is what the refusal says: a list of a million isn't
    // read page by page before it's turned away.
    const pages = Array.from({ length: MAX_WALKTHROUGH_PAGES + 1 }, () => 5);

    const message = refusal(textOf({ ...valid(), pages }));

    expect(message).toContain("it lists more than 10,000 pages");
  });

  it("accepts exactly the most pages a walkthrough may list", () => {
    const walkthrough: Walkthrough = {
      ...valid(),
      pages: Array.from({ length: MAX_WALKTHROUGH_PAGES }, (_, index) => ({
        url: `https://example.illinois.gov/page-${index}/`,
        original: { status: "failed", passes: {} },
      })),
    };

    expect(parseWalkthrough(walkthroughJson(walkthrough), "w.json").pages).toHaveLength(
      MAX_WALKTHROUGH_PAGES,
    );
  });

  it("shows a long address cut short, however it goes on", () => {
    const long = `https://elsewhere.example/${"x".repeat(5_000)}`;

    const message = refusal(textOf(withPageUrl(valid(), 0, long)));

    expect(message).toBe(
      `${NOT_A_WALKTHROUGH}page 1's address, ${long.slice(0, 80)}\u{2026}, isn't on its site.`,
    );
  });

  // An address is checked as the URL standard reads it, which drops some characters and rewrites
  // others, and then kept as it was written: so what it's written with is checked first.
  it.each<[name: string, address: string]>([
    [
      "an escape and a bell in the path",
      "https://example.illinois.gov/\u{1b}[2J\u{1b}]0;pwned\u{7}",
    ],
    ["a space in front", " https://example.illinois.gov/x"],
    ["a tab in front", "\thttps://example.illinois.gov/x"],
    ["a space at the end", "https://example.illinois.gov/x "],
    ["a newline at the end", "https://example.illinois.gov/x\n"],
    ["a tab inside the host", "https://exam\tple.illinois.gov/x"],
    ["a space inside the path", "https://example.illinois.gov/a b"],
    ["a non-breaking space", "https://example.illinois.gov/a\u{a0}b"],
    ["an ideographic space", "https://example.illinois.gov/a\u{3000}b"],
    ["a line separator", "https://example.illinois.gov/a\u{2028}b"],
    ["a zero-width space inside the host", "https://exam\u{200b}ple.illinois.gov/x"],
    ["a soft hyphen inside the host", "https://exam\u{ad}ple.illinois.gov/x"],
    ["a right-to-left override", "https://example.illinois.gov/\u{202e}x"],
    ["a byte-order mark", "https://example.illinois.gov/\u{feff}x"],
    ["a null character", "https://example.illinois.gov/\u{0}x"],
    ["a delete character", "https://example.illinois.gov/\u{7f}x"],
    ["a control character from the C1 block", "https://example.illinois.gov/\u{9b}x"],
  ])(
    "refuses an address with %s, in a page and in the site, and doesn't repeat it",
    (_name, address) => {
      const inPage = refusal(textOf(withPageUrl(valid(), 2, address)));
      const inSite = refusal(textOf({ ...valid(), site: address }));

      expect(inPage).toBe(
        `${NOT_A_WALKTHROUGH}page 3's address has a space or a control character in it.`,
      );
      expect(inSite).toBe(`${NOT_A_WALKTHROUGH}its site has a space or a control character in it.`);
    },
  );

  it.each<[name: string, address: string]>([
    ["the site's own credentials", "https://user:pass@example.illinois.gov/x"],
    ["a query and a fragment", "https://example.illinois.gov/x?y=1&z=2#top"],
    ["a space and a newline written percent-encoded", "https://example.illinois.gov/a%20b%0Ac"],
    ["exactly 8,192 characters", addressOfLength(ADDRESS_LIMIT)],
  ])("accepts an address with %s", (_name, address) => {
    const walkthrough = withPageUrl(valid(), 0, address);

    expect(parseWalkthrough(textOf(walkthrough), "w.json")).toStrictEqual(walkthrough);
    expect(walkthroughProblem(walkthrough)).toBeNull();
  });

  it("accepts a site of exactly 8,192 characters, and pages on it", () => {
    const walkthrough: Walkthrough = { ...valid(), site: addressOfLength(ADDRESS_LIMIT) };

    expect(parseWalkthrough(textOf(walkthrough), "w.json")).toStrictEqual(walkthrough);
  });

  it.each<
    [name: string, put: (walkthrough: Walkthrough, address: string) => unknown, reason: string]
  >([
    [
      "a page address",
      (w, address) => withPageUrl(w, 2, address),
      "page 3's address is longer than 8,192 characters.",
    ],
    [
      "the site",
      (w, address) => ({ ...w, site: address }),
      "its site is longer than 8,192 characters.",
    ],
  ])("turns away %s with a very long international host, unparsed", (_name, put, reason) => {
    const address = `https://${"\u{e9}".repeat(200_000)}.illinois.gov/x`;
    const text = textOf(put(valid(), address));

    const started = performance.now();
    const message = refusal(text);
    const elapsed = performance.now() - started;

    expect(message).toBe(`${NOT_A_WALKTHROUGH}${reason}`);
    // Some versions of Node take seconds to parse an address like this, so it's never tried.
    expect(elapsed).toBeLessThan(1_000);
  });

  // The cost of parsing a long address depends on the version of Node, so this doesn't time it: it
  // watches what the URL parser is handed.
  it("never hands the URL parser an address that is too long or has a control character", () => {
    const handed: string[] = [];
    vi.stubGlobal(
      "URL",
      class extends URL {
        constructor(input: string | URL, base?: string | URL) {
          handed.push(String(input));
          super(input, base);
        }
      },
    );
    const tooLong = `https://${"\u{e9}".repeat(ADDRESS_LIMIT)}.illinois.gov/x`;
    const withControl = "https://example.illinois.gov/\u{1b}[2J";
    try {
      for (const address of [tooLong, withControl]) {
        refusal(textOf(withPageUrl(valid(), 2, address)));
        refusal(textOf({ ...valid(), site: address }));
      }
    } finally {
      vi.unstubAllGlobals();
    }

    expect(handed.length).toBeGreaterThan(0);
    expect(handed).not.toContain(tooLong);
    expect(handed).not.toContain(withControl);
  });

  it("names the limits it holds a file's addresses and NVDA settings to", () => {
    expect(MAX_ADDRESS_LENGTH).toBe(ADDRESS_LIMIT);
    expect(MAX_NVDA_SETTINGS_DEPTH).toBe(SETTINGS_LEVELS);
  });

  it("accepts NVDA settings nested 32 levels deep, and writes them back", () => {
    const walkthrough = withNvdaSettings(valid(), settingsNested(SETTINGS_LEVELS)) as Walkthrough;

    expect(parseWalkthrough(walkthroughJson(walkthrough), "w.json")).toStrictEqual(walkthrough);
    expect(walkthroughProblem(walkthrough)).toBeNull();
  });

  // Lists are levels too: the settings are the first, and each list inside another is one more.
  it.each<[name: string, lists: number, refused: boolean]>([
    ["31 lists inside one another, which makes 32 levels", 31, false],
    ["32 lists inside one another, which makes 33 levels", 32, true],
  ])("with %s in the NVDA settings, takes or refuses them", (_name, lists, refused) => {
    const walkthrough = withNvdaSettings(valid(), settingsWithLists(lists)) as Walkthrough;

    if (refused) {
      expect(refusal(textOf(walkthrough))).toBe(
        `${NOT_A_WALKTHROUGH}its original.nvdaSettings is nested more than 32 levels deep.`,
      );
    } else {
      expect(parseWalkthrough(textOf(walkthrough), "w.json")).toStrictEqual(walkthrough);
    }
  });

  it("accepts wide, shallow NVDA settings of any size", () => {
    const settings = Object.fromEntries(
      Array.from({ length: 20_000 }, (_, index) => [
        `setting${index}`,
        { value: index, list: [index] },
      ]),
    );
    const walkthrough = withNvdaSettings(valid(), settings) as Walkthrough;

    expect(parseWalkthrough(walkthroughJson(walkthrough), "w.json")).toStrictEqual(walkthrough);
  });

  it("refuses NVDA settings nested a hundred thousand levels deep, however it's asked", () => {
    const depth = 100_000;
    const deep = `${'{"a":'.repeat(depth)}1${"}".repeat(depth)}`;
    const text = walkthroughJson(valid()).replace('"nvdaSettings": {}', `"nvdaSettings": ${deep}`);
    const reason = "its original.nvdaSettings is nested more than 32 levels deep.";
    expect(text).toContain('"nvdaSettings": {"a":{"a":');

    expect(refusal(text)).toBe(`${NOT_A_WALKTHROUGH}${reason}`);
    // And for the object, which JSON can't write out at this depth.
    expect(walkthroughProblem(JSON.parse(text) as Walkthrough)).toBe(reason);
  });

  it("stops at the first level too deep in NVDA settings that hold themselves", () => {
    // A walk that never stopped would never end, so this one throws if it goes on too long.
    let visits = 0;
    const loop: Record<string, unknown> = {
      get again() {
        visits += 1;
        if (visits > 1_000) throw new Error("walked the NVDA settings without end");
        return loop;
      },
    };

    expect(walkthroughProblem(withNvdaSettings(valid(), loop) as Walkthrough)).toBe(
      "its original.nvdaSettings is nested more than 32 levels deep.",
    );
    expect(visits).toBeLessThanOrEqual(SETTINGS_LEVELS + 1);
  });

  it("shows a key it doesn't have with its control characters escaped", () => {
    const message = refusal(textOf({ ...valid(), "\u{1b}[31mred": 1 }));

    expect(message).not.toMatch(/\p{Cc}/u);
    expect(message).toContain('"\\u{1b}[31mred"');
  });

  it.each<[name: string, file: (walkthrough: Walkthrough) => unknown, reason: string]>([
    [
      "a step limit above the ceiling",
      (w) => ({
        ...w,
        settings: { ...w.settings, stepCaps: { ...w.settings.stepCaps, read: 100_001 } },
      }),
      "its settings.stepCaps.read: must be a whole number from 1 to 100,000",
    ],
    [
      "a step limit that isn't whole",
      (w) => ({
        ...w,
        settings: { ...w.settings, stepCaps: { ...w.settings.stepCaps, headings: 1.5 } },
      }),
      "its settings.stepCaps.headings: must be a whole number from 1 to 100,000",
    ],
    [
      "a step limit in text",
      (w) => ({
        ...w,
        settings: { ...w.settings, stepCaps: { ...w.settings.stepCaps, tab: "300" } },
      }),
      "its settings.stepCaps.tab",
    ],
    [
      "step limits with one pass left out",
      (w) => ({ ...w, settings: { ...w.settings, stepCaps: { read: 400, headings: 200 } } }),
      "its settings.stepCaps.tab",
    ],
    [
      "step limits for a pass voicecap doesn't have",
      (w) => ({
        ...w,
        settings: { ...w.settings, stepCaps: { ...w.settings.stepCaps, speak: 9 } },
      }),
      'its settings.stepCaps has a key voicecap doesn\'t know: "speak"',
    ],
    [
      "no passes at all",
      (w) => ({ ...w, settings: { ...w.settings, passes: [] } }),
      "its settings.passes: must name at least one pass",
    ],
    [
      "a pass listed twice",
      (w) => ({ ...w, settings: { ...w.settings, passes: ["tab", "read", "tab"] } }),
      "its settings.passes name a pass more than once",
    ],
    [
      "a capture mode voicecap doesn't have",
      (w) => ({ ...w, settings: { ...w.settings, capture: "everything" } }),
      "its settings.capture",
    ],
    [
      "a wait of less than nothing",
      (w) => ({
        ...w,
        settings: {
          ...w.settings,
          readiness: { readySelector: null, settleMs: -1, networkIdleTimeoutMs: 15000 },
        },
      }),
      "its settings.readiness.settleMs: must be a whole number from 0 to 600,000",
    ],
    [
      "no time to wait for the network",
      (w) => ({
        ...w,
        settings: {
          ...w.settings,
          readiness: { readySelector: null, settleMs: 500, networkIdleTimeoutMs: 0 },
        },
      }),
      "its settings.readiness.networkIdleTimeoutMs: must be a whole number from 1 to 600,000",
    ],
    [
      "a wait above the ceiling",
      (w) => ({
        ...w,
        settings: {
          ...w.settings,
          readiness: { readySelector: null, settleMs: 600_001, networkIdleTimeoutMs: 1 },
        },
      }),
      "its settings.readiness.settleMs: must be a whole number from 0 to 600,000",
    ],
    [
      "an empty selector to wait for",
      (w) => ({
        ...w,
        settings: {
          ...w.settings,
          readiness: { readySelector: "", settleMs: 500, networkIdleTimeoutMs: 1 },
        },
      }),
      "its settings.readiness.readySelector",
    ],
    [
      "a readiness setting left out",
      (w) => ({
        ...w,
        settings: { ...w.settings, readiness: { readySelector: null, settleMs: 500 } },
      }),
      "its settings.readiness.networkIdleTimeoutMs",
    ],
    [
      "a readiness setting voicecap doesn't have",
      (w) => ({
        ...w,
        settings: {
          ...w.settings,
          readiness: { readySelector: null, settleMs: 500, networkIdleTimeoutMs: 1, extra: 1 },
        },
      }),
      'its settings.readiness has a key voicecap doesn\'t know: "extra"',
    ],
    [
      "a fingerprint in capital letters",
      (w) => withPassFingerprint(w, "A".repeat(64)),
      "page 1's original.passes.read: must be a SHA-256 fingerprint: 64 lower-case hex digits",
    ],
    [
      "a fingerprint that's too short",
      (w) => withPassFingerprint(w, "a".repeat(63)),
      "page 1's original.passes.read: must be a SHA-256 fingerprint",
    ],
    [
      "a fingerprint that isn't hex",
      (w) => withPassFingerprint(w, "g".repeat(64)),
      "page 1's original.passes.read: must be a SHA-256 fingerprint",
    ],
    [
      "a fingerprint of a pass voicecap doesn't have",
      (w) => withPageOriginal(w, { status: "done", passes: { speak: "a".repeat(64) } }),
      "page 1's original.passes has a key voicecap doesn't know: \"speak\"",
    ],
    [
      "a page status voicecap doesn't have",
      (w) => withPageOriginal(w, { status: "running", passes: {} }),
      "page 1's original.status",
    ],
    [
      "a key a page doesn't have",
      (w) => ({ ...w, pages: w.pages.map((page, i) => (i === 1 ? { ...page, extra: 1 } : page)) }),
      'page 2 has a key voicecap doesn\'t know: "extra"',
    ],
    [
      "a label that isn't text",
      (w) => ({ ...w, pages: w.pages.map((page, i) => (i === 0 ? { ...page, label: 5 } : page)) }),
      "page 1's label",
    ],
    [
      "a page that isn't an object",
      (w) => ({ ...w, pages: [...w.pages.slice(0, 1), "x"] }),
      "page 2",
    ],
    ["pages that aren't a list", (w) => ({ ...w, pages: { first: 1 } }), "its pages"],
    [
      "a seal that isn't a fingerprint",
      (w) => ({ ...w, original: { ...w.original, seal: "d5dde04" } }),
      "its original.seal: must be a SHA-256 fingerprint",
    ],
    [
      "a source of a kind voicecap doesn't know",
      (w) => ({ ...w, original: { ...w.original, source: { kind: "ftp", host: "x" } } }),
      "its original.source.kind",
    ],
    [
      "a page list with no fingerprint",
      (w) => ({ ...w, original: { ...w.original, source: { kind: "pages", file: "pages.csv" } } }),
      "its original.source.sha256",
    ],
    [
      "a source with a key it doesn't have",
      (w) => ({
        ...w,
        original: {
          ...w.original,
          source: { kind: "sitemap", url: "https://example.illinois.gov/s.xml", extra: 1 },
        },
      }),
      'its original.source has a key voicecap doesn\'t know: "extra"',
    ],
    [
      "a walkthrough source with no fingerprint",
      (w) => withSource(w, { kind: "walkthrough", file: "w.json", run: "2026-09-29_1402" }),
      "its original.source.sha256",
    ],
    [
      "a walkthrough source whose fingerprint is in capital letters",
      (w) => withSource(w, { ...WALKTHROUGH_SOURCE, sha256: "A".repeat(64) }),
      "its original.source.sha256: must be a SHA-256 fingerprint: 64 lower-case hex digits",
    ],
    [
      "a walkthrough source with no file",
      (w) => withSource(w, { kind: "walkthrough", sha256: "a".repeat(64), run: "2026-09-29_1402" }),
      "its original.source.file",
    ],
    [
      "a walkthrough source with an empty file name",
      (w) => withSource(w, { ...WALKTHROUGH_SOURCE, file: "" }),
      "its original.source.file: must be a file's name",
    ],
    [
      "a walkthrough source with no run",
      (w) => withSource(w, { kind: "walkthrough", file: "w.json", sha256: "a".repeat(64) }),
      "its original.source.run",
    ],
    [
      "a walkthrough source with an empty run",
      (w) => withSource(w, { ...WALKTHROUGH_SOURCE, run: "" }),
      "its original.source.run: must be a run's id",
    ],
    [
      "a walkthrough source with a run that isn't text",
      (w) => withSource(w, { ...WALKTHROUGH_SOURCE, run: 5 }),
      "its original.source.run",
    ],
    [
      "a walkthrough source with a key it doesn't have",
      (w) => withSource(w, { ...WALKTHROUGH_SOURCE, extra: 1 }),
      'its original.source has a key voicecap doesn\'t know: "extra"',
    ],
    [
      "a page list source with a run, which only a walkthrough has",
      (w) => withSource(w, { kind: "pages", file: "pages.csv", sha256: "a".repeat(64), run: "x" }),
      'its original.source has a key voicecap doesn\'t know: "run"',
    ],
    [
      "a source fingerprint that isn't one",
      (w) => ({
        ...w,
        original: { ...w.original, sourceFingerprints: [{ name: "pages.csv", sha256: "x" }] },
      }),
      "its original.sourceFingerprints[1].sha256",
    ],
    [
      "NVDA settings that aren't an object",
      (w) => ({ ...w, original: { ...w.original, nvdaSettings: ["speech"] } }),
      "its original.nvdaSettings isn't an object",
    ],
    [
      "a key the original's record doesn't have",
      (w) => ({ ...w, original: { ...w.original, compareTo: null } }),
      'its original has a key voicecap doesn\'t know: "compareTo"',
    ],
    [
      "a screen reader with a key it doesn't have",
      (w) => ({
        ...w,
        original: { ...w.original, screenReader: { name: "NVDA", version: "2026.2", build: "x" } },
      }),
      'its original.screenReader has a key voicecap doesn\'t know: "build"',
    ],
    [
      "a replayed flag that isn't true or false",
      (w) => ({ ...w, original: { ...w.original, replayed: "no" } }),
      "its original.replayed",
    ],
  ])("refuses %s, naming where", (_name, file, reason) => {
    const message = refusal(textOf(file(valid())));

    expect(message.startsWith(NOT_A_WALKTHROUGH)).toBe(true);
    expect(message).toContain(reason);
  });

  // Every place in a file that holds a value, whichever kind of page source its run had: a value
  // of the wrong kind, a key left out, and a key added are each refused, wherever they are.
  describe.each<[name: string, source: "sitemap" | "pages" | "walkthrough" | "urls"]>([
    ["a sitemap", "sitemap"],
    ["a page list", "pages"],
    ["a walkthrough", "walkthrough"],
    ["--page", "urls"],
  ])("a file of a run whose pages came from %s", (_name, source) => {
    /** The file's JSON, with a value in every place the format has one. */
    const complete = (): unknown => JSON.parse(walkthroughJson(walkthroughOf(completeRun(source))));

    /** Whether the file, as it's changed here, reads. */
    const reads = (file: unknown): boolean => {
      try {
        parseWalkthrough(JSON.stringify(file), "w.json");
        return true;
      } catch (error) {
        expect(error).toBeInstanceOf(UsageError);
        return false;
      }
    };

    it("has a value in every place, so the checks below reach each one", () => {
      expect(reads(complete())).toBe(true);
      const places = placesIn(complete()).map((place) => place.join("."));
      expect(places).toEqual(
        expect.arrayContaining([
          "pages.1.template",
          "pages.1.notes",
          "pages.0.original.passes.tab",
          "settings.readiness.readySelector",
          "original.seal",
          "original.screenReader.version",
          "original.browser.name",
          "original.nvdaSettings",
          ...(source === "pages"
            ? ["original.source.sha256", "original.sourceFingerprints.0.name"]
            : []),
          ...(source === "walkthrough"
            ? [
                "original.source.file",
                "original.source.sha256",
                "original.source.run",
                "original.sourceFingerprints.0.name",
              ]
            : []),
          ...(source === "sitemap"
            ? ["original.source.url", "original.sourceFingerprints.0.sha256"]
            : []),
          ...(source === "urls" ? ["original.source.urls.1"] : []),
        ]),
      );
    });

    it("refuses a value of the wrong kind in any place", () => {
      // An object is wrong wherever it is. Text, a number, or true or false is wrong where the place
      // holds something else; where it holds the same kind, it may well be right, so it's skipped.
      const wrongValues: unknown[] = [{ wrong: "kind" }, "text", 5, true];
      const accepted = placesIn(complete()).filter((place) => {
        if (place.length === 0) return false;
        return wrongValues.some((wrong) => {
          const file = complete();
          if (typeof wrong !== "object" && typeof wrong === typeof at(file, ...place)) return false;
          setAt(file, place, wrong);
          return reads(file);
        });
      });

      // The NVDA settings are recorded, not read: they may hold any object.
      expect(accepted.map((place) => place.join("."))).toEqual(["original.nvdaSettings"]);
    });

    it("refuses a key left out of any place that needs it", () => {
      const accepted = placesIn(complete()).filter((place) => {
        if (place.length === 0 || isOptional(place) || isInsideList(complete(), place))
          return false;
        const file = complete();
        removeAt(file, place);
        return reads(file);
      });

      expect(accepted.map((place) => place.join("."))).toEqual([]);
    });

    it("refuses a key it doesn't have, added to any object", () => {
      const accepted = placesIn(complete()).filter((place) => {
        const file = complete();
        const object = at(file, ...place);
        if (!isPlainObject(object) || place.join(".") === "original.nvdaSettings") return false;
        object["extra"] = 1;
        return reads(file);
      });

      expect(accepted.map((place) => place.join("."))).toEqual([]);
    });
  });

  it("names every key it doesn't have when there are several", () => {
    const message = refusal(textOf({ ...valid(), run: 1, seal: 2 }));

    expect(message).toContain('it has keys voicecap doesn\'t know: "run", "seal"');
  });

  it("reads a file with a byte-order mark", () => {
    const walkthrough = valid();

    const read = parseWalkthrough(`\u{FEFF}${walkthroughJson(walkthrough)}`, "w.json");

    expect(read).toStrictEqual(walkthrough);
  });

  it("keeps every key of the recorded NVDA settings, a key named __proto__ too", () => {
    const file = JSON.parse(walkthroughJson(valid())) as { original: { nvdaSettings: unknown } };
    file.original.nvdaSettings = JSON.parse(
      '{ "__proto__": { "rate": 40 }, "speech": { "rate": 50 } }',
    ) as unknown;

    const read = parseWalkthrough(JSON.stringify(file), "w.json");

    expect(Object.keys(read.original.nvdaSettings)).toEqual(["__proto__", "speech"]);
    expect(Object.hasOwn(read.original.nvdaSettings, "__proto__")).toBe(true);
    // The key is data like any other: nothing it holds shows up on the object, or on any other.
    expect(Object.getPrototypeOf(read.original.nvdaSettings)).toBe(Object.prototype);
    expect(({} as { rate?: number }).rate).toBeUndefined();
    expect(JSON.stringify(read.original.nvdaSettings)).toBe(
      '{"__proto__":{"rate":40},"speech":{"rate":50}}',
    );
  });

  it("refuses a key named __proto__ where the file may hold no such key", () => {
    const text = JSON.stringify(valid()).replace(
      '{"voicecapWalkthrough":1,',
      '{"__proto__":1,"voicecapWalkthrough":1,',
    );

    expect(refusal(text)).toContain('it has a key voicecap doesn\'t know: "__proto__"');
  });
});

describe("walkthroughProblem", () => {
  const valid = (): Walkthrough => walkthroughOf(sampleRun());

  /** The walkthrough of a run with `changes` to its settings: walkthroughOf builds it, whatever they are. */
  const withSettings = (changes: Partial<RunJson["settings"]>): Walkthrough => {
    const base = sampleRun();
    return walkthroughOf({ ...base, settings: { ...base.settings, ...changes } });
  };

  /**
   * Runs the config allows but a walkthrough file can't hold, and why. walkthroughOf still builds
   * a walkthrough of each; this is how a writer, or the page, finds out it couldn't be read back.
   */
  const beyond: [name: string, build: () => Walkthrough, reason: string][] = [
    [
      "10,001 pages",
      () =>
        walkthroughOf(
          shareRun({
            id: "2026-09-26_1405",
            pages: Array.from({ length: MAX_WALKTHROUGH_PAGES + 1 }, (_, index) => ({
              path: `/page-${index}/`,
            })),
          }),
        ),
      "it lists more than 10,000 pages.",
    ],
    [
      "a step limit of 100,001",
      () => withSettings({ stepCaps: { read: 100_001, headings: 200, tab: 300 } }),
      "its settings.stepCaps.read: must be a whole number from 1 to 100,000.",
    ],
    [
      "a settleMs of 600,001",
      () =>
        withSettings({
          readiness: { readySelector: null, settleMs: 600_001, networkIdleTimeoutMs: 15_000 },
        }),
      "its settings.readiness.settleMs: must be a whole number from 0 to 600,000.",
    ],
    [
      "a page address of 8,193 characters",
      () =>
        walkthroughOf(
          shareRun({
            id: "2026-09-26_1405",
            pages: [{ path: new URL(addressOfLength(ADDRESS_LIMIT + 1)).pathname }],
          }),
        ),
      "page 1's address is longer than 8,192 characters.",
    ],
    [
      "NVDA settings nested 33 levels deep",
      () => withSettings({ nvdaSettings: settingsNested(SETTINGS_LEVELS + 1) }),
      "its original.nvdaSettings is nested more than 32 levels deep.",
    ],
  ];

  it.each<[name: string, run: () => RunJson]>([
    ["a sample run", sampleRun],
    ["demo run 1402, recorded by 0.4.1", () => demoRun("1402")],
    ["a run whose pages came from a sitemap", () => completeRun("sitemap")],
    ["a run whose pages came from a page list", () => completeRun("pages")],
    ["a run whose pages came from a walkthrough", () => completeRun("walkthrough")],
    ["a run whose pages came from --page", () => completeRun("urls")],
  ])("gives null for the walkthrough of %s, which parseWalkthrough would read", (_name, run) => {
    const walkthrough = walkthroughOf(run());

    expect(walkthroughProblem(walkthrough)).toBeNull();
    expect(parseWalkthrough(walkthroughJson(walkthrough), "w.json")).toStrictEqual(walkthrough);
  });

  it.each(beyond)(
    "says why a walkthrough of a run with %s couldn't be read back",
    (_name, build, reason) => {
      // walkthroughOf builds it; only the check says it couldn't be read back.
      expect(walkthroughProblem(build())).toBe(reason);
    },
  );

  it.each(beyond)(
    "says what parseWalkthrough says of a file of a run with %s, after the file's name",
    (_name, build) => {
      const walkthrough = build();

      expect(refusal(walkthroughJson(walkthrough))).toBe(
        `${NOT_A_WALKTHROUGH}${walkthroughProblem(walkthrough)}`,
      );
    },
  );

  // One checker reads a walkthrough for both, so what they say of the same one can't differ. This
  // is the check on that, over each kind of fault: the object here, and its text there.
  it.each<[name: string, file: (walkthrough: Walkthrough) => unknown]>([
    ["JSON that is a list", () => []],
    ["a run's record, which has no format version", () => ({ schemaVersion: 1, id: "x" })],
    ["a format version of 2", (w) => ({ ...w, voicecapWalkthrough: 2 })],
    ["no pages", (w) => ({ ...w, pages: [] })],
    [
      "more items than a file may list, none of them pages",
      (w) => ({ ...w, pages: Array.from({ length: MAX_WALKTHROUGH_PAGES + 1 }, () => 5) }),
    ],
    ["a page on the local disk", (w) => withPageUrl(w, 2, "file:///C:/x")],
    [
      "a blob: address with the site's origin",
      (w) =>
        withPageUrl(w, 0, "blob:https://example.illinois.gov/6f1c2f7e-0000-4000-8000-000000000000"),
    ],
    ["an address that isn't a full one", (w) => withPageUrl(w, 3, "/about")],
    [
      "an address with a control character",
      (w) => withPageUrl(w, 0, "https://x.example/\u{1b}[2J"),
    ],
    ["a site that isn't a web address", (w) => ({ ...w, site: "file:///C:/" })],
    [
      "a pass listed twice",
      (w) => ({ ...w, settings: { ...w.settings, passes: ["read", "read"] } }),
    ],
    [
      "a step limit of 0",
      (w) => ({ ...w, settings: { ...w.settings, stepCaps: { ...w.settings.stepCaps, read: 0 } } }),
    ],
    [
      "a wait of less than nothing",
      (w) => ({
        ...w,
        settings: {
          ...w.settings,
          readiness: { readySelector: null, settleMs: -1, networkIdleTimeoutMs: 15_000 },
        },
      }),
    ],
    ["a fingerprint in capital letters", (w) => withPassFingerprint(w, "A".repeat(64))],
    [
      "a source of a kind it doesn't know",
      (w) => ({ ...w, original: { ...w.original, source: { kind: "ftp" } } }),
    ],
    [
      "a walkthrough source with an empty file name",
      (w) => withSource(w, { ...WALKTHROUGH_SOURCE, file: "" }),
    ],
    [
      "a walkthrough source with no run",
      (w) => withSource(w, { kind: "walkthrough", file: "w.json", sha256: "a".repeat(64) }),
    ],
    [
      "NVDA settings that aren't an object",
      (w) => ({ ...w, original: { ...w.original, nvdaSettings: ["speech"] } }),
    ],
    [
      "a label that isn't text",
      (w) => ({ ...w, pages: w.pages.map((page, i) => (i === 0 ? { ...page, label: 5 } : page)) }),
    ],
    ["two keys it doesn't have", (w) => ({ ...w, run: 1, seal: 2 })],
    ["several things wrong at once", (w) => ({ ...w, site: "file:///C:/", run: 1 })],
    [
      "an address with an escape sequence in it",
      (w) => withPageUrl(w, 2, "https://example.illinois.gov/\u{1b}[2J\u{1b}]0;pwned\u{7}"),
    ],
    [
      "an address with a space in front",
      (w) => withPageUrl(w, 0, " https://example.illinois.gov/x"),
    ],
    [
      "an address with a newline at its end",
      (w) => withPageUrl(w, 0, "https://example.illinois.gov/x\n"),
    ],
    [
      "an address with a tab inside its host",
      (w) => withPageUrl(w, 0, "https://exam\tple.illinois.gov/x"),
    ],
    [
      "a site with a space in front of it",
      (w) => ({ ...w, site: " https://example.illinois.gov" }),
    ],
    [
      "an address of 8,193 characters",
      (w) => withPageUrl(w, 0, addressOfLength(ADDRESS_LIMIT + 1)),
    ],
    ["a site of 8,193 characters", (w) => ({ ...w, site: addressOfLength(ADDRESS_LIMIT + 1) })],
    [
      "an address with a very long international host",
      (w) => withPageUrl(w, 0, `https://${"\u{e9}".repeat(200_000)}.illinois.gov/x`),
    ],
    ["a host with a dot at its end", (w) => withPageUrl(w, 0, "https://example.illinois.gov./x")],
    [
      "an address that starts with two slashes",
      (w) => withPageUrl(w, 0, "//example.illinois.gov/x"),
    ],
    [
      "NVDA settings nested 33 levels deep",
      (w) => withNvdaSettings(w, settingsNested(SETTINGS_LEVELS + 1)),
    ],
    [
      "NVDA settings with lists nested to 33 levels deep",
      (w) => withNvdaSettings(w, settingsWithLists(SETTINGS_LEVELS)),
    ],
  ])("says what parseWalkthrough says of a file with %s, after the file's name", (_name, file) => {
    const broken = file(valid());

    expect(refusal(textOf(broken))).toBe(
      `${NOT_A_WALKTHROUGH}${walkthroughProblem(broken as Walkthrough)}`,
    );
  });

  it("doesn't change the walkthrough it's given", () => {
    const walkthrough = valid();
    const before = structuredClone(walkthrough);

    walkthroughProblem(walkthrough);
    walkthroughProblem({ ...walkthrough, site: "file:///C:/" });

    expect(walkthrough).toStrictEqual(before);
  });
});

describe("a 400-page walkthrough", () => {
  it("writes and reads back quickly", () => {
    const run = shareRun({
      id: "2026-09-26_1405",
      pages: Array.from({ length: 400 }, (_, index) => ({
        path: `/section-${Math.floor(index / 20)}/page-${index}/`,
        label: `Page ${index}`,
        passes: {
          read: [`heading, level 1, Page ${index}`, ...READ],
          headings: [`heading, level 1, Page ${index}`, "no next heading"],
          tab: [`Skip to main content, link`, `Page ${index}, link`],
        },
      })),
    });

    const started = performance.now();
    const walkthrough = walkthroughOf(run);
    const text = walkthroughJson(walkthrough);
    const read = parseWalkthrough(text, "w.json");
    const elapsed = performance.now() - started;

    expect(read.pages).toHaveLength(400);
    expect(read).toStrictEqual(walkthrough);
    // Far more than it takes; this is here to catch something that grows with the square of the
    // pages, not to time a runner.
    expect(elapsed).toBeLessThan(2000);
  });
});
