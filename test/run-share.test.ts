/**
 * The shareable page, written wherever the live report is: when a run completes, and after a
 * review, a manual session, and `voicecap report`. A page that can't be written is said in a
 * warning, and never fails any of them. No real screen reader starts here: runs use the scripted
 * driver, or replay a recorded run.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { addManualSession } from "../src/manual-add.js";
import { addReview } from "../src/reviews/review.js";
import { runAudit } from "../src/run/audit.js";
import { regenerateLiveFiles, regenerateLiveReport } from "../src/run/live-report.js";
import { liveReportPath, sharePath } from "../src/run/paths.js";
import { readRunJson } from "../src/run/store.js";
import { writeSharePage } from "../src/share/write.js";
import { writeFileAtomic } from "../src/util/atomic-write.js";
import { createMemoryLogger, type Logger } from "../src/util/log.js";
import { config, options, outDir, setup, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

// Every write goes through as it did, and is kept, so a test can see what was written how.
vi.mock("../src/util/atomic-write.js", async (importOriginal) => {
  const actual = await importOriginal<{
    writeFileAtomic: (file: string, data: string | Uint8Array) => Promise<void>;
  }>();
  return { ...actual, writeFileAtomic: vi.fn(actual.writeFileAtomic) };
});

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = (...parts: string[]) => path.join(ROOT, "fixture", ...parts);

/** What a warning about the page says, whatever the reason the page couldn't be written. */
const NOT_UPDATED = /^The shareable page wasn't updated: .+/;

/** A site folder with one completed run of the scripted site's three pages. */
async function siteWithRun(): Promise<{ dir: string; site: string }> {
  const dir = await setup();
  const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
  expect(result.outcome).toBe("completed");
  return { dir, site: outDir(dir) };
}

/** A site folder where the page can't go: a file is in the place of its folder. */
async function blockShareFolder(site: string): Promise<void> {
  await rm(path.join(site, "share"), { recursive: true, force: true });
  await mkdir(site, { recursive: true });
  await writeFile(path.join(site, "share"), "A file where the folder would go.\n");
}

describe("share/current.html, written where report.html is", () => {
  it("is written beside report.html when a run completes", async () => {
    const dir = await setup();
    const logger = createMemoryLogger();

    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        logger,
        now: () => new Date(2026, 8, 27, 11, 2),
      }),
    );

    expect(result).toMatchObject({ outcome: "completed", exitCode: 0 });
    const site = outDir(dir);
    expect(existsSync(liveReportPath(site))).toBe(true);
    const page = await readFile(sharePath(site), "utf8");
    expect(page.startsWith("<!doctype html>\n")).toBe(true);
    expect(page).toContain(
      "<title>example.illinois.gov: how its pages read aloud with NVDA</title>",
    );
    // Dated by the run's clock, as the run's own times are.
    expect(page).toMatch(/Generated on 27 September 2026 at 11:02 \(UTC[−+]\d\d:\d\d\)\./);
    // Its fonts are inside it, and its pages are the run's.
    expect(page).toContain("data:font/woff2;base64,");
    for (const pagePath of ["/about", "/resources"]) {
      expect(page).toContain(`https://example.illinois.gov${pagePath}`);
    }
    // Written whole, with nothing left beside it.
    expect(await readdir(path.join(site, "share"))).toEqual(["current.html"]);
    expect(logger.text("warn")).toBe("");
  });

  it.each([
    {
      way: "a review",
      shows: "Two Read more links.",
      act: (dir: string, logger: Logger) =>
        addReview({
          page: "/resources",
          status: "issue",
          note: "Two Read more links.",
          reviewer: "Pat Reviewer",
          cwd: dir,
          env: {},
          logger,
          config: config(),
        }),
    },
    {
      way: "a manual session",
      shows: "Manual NVDA session, 25 September 2026, by Sam Tester",
      act: (dir: string, logger: Logger) =>
        addManualSession({
          file: fixture("manual", "nvda-io-log.txt"),
          page: "/",
          date: "2026-09-25",
          redactTyping: true,
          reviewer: "Sam Tester",
          cwd: dir,
          env: {},
          logger,
          config: config(),
        }),
    },
    {
      way: "the live report",
      shows: null,
      act: (dir: string, logger: Logger) =>
        regenerateLiveReport({ outDir: outDir(dir), config: config().config, logger }),
    },
  ])("is rewritten by $way", async ({ act, shows }) => {
    const { dir, site } = await siteWithRun();
    // Gone, so only what comes next can write it.
    await rm(path.join(site, "share"), { recursive: true, force: true });

    await act(dir, createMemoryLogger());

    const page = await readFile(sharePath(site), "utf8");
    expect(page.startsWith("<!doctype html>\n")).toBe(true);
    if (shows !== null) expect(page).toContain(shows);
  });

  it("completes the run, and says so, when the page can't be written", async () => {
    const dir = await setup();
    const site = outDir(dir);
    await blockShareFolder(site);
    const logger = createMemoryLogger();

    const result = await runAudit(options(dir, new ScriptedDriver(sitePages()), { logger }));

    // The run is done and sealed, its report is written, and the exit code is the run's.
    expect(result).toMatchObject({ outcome: "completed", exitCode: 0 });
    expect((await readRunJson(site, result.runId)).status).toBe("completed");
    expect(existsSync(liveReportPath(site))).toBe(true);
    expect(logger.text("info")).toContain(`Run ${result.runId} complete. Report: `);
    // One warning, and the file that was in the way is as it was.
    expect(logger.entries.filter((entry) => entry.level === "warn")).toEqual([
      { level: "warn", message: expect.stringMatching(NOT_UPDATED) as string },
    ]);
    expect(await readFile(path.join(site, "share"), "utf8")).toBe(
      "A file where the folder would go.\n",
    );
  });
});

describe("regenerateLiveFiles", () => {
  it("gives the report's path and the page's", async () => {
    const { site } = await siteWithRun();
    await rm(path.join(site, "share"), { recursive: true, force: true });

    const files = await regenerateLiveFiles({
      outDir: site,
      config: DEFAULT_CONFIG,
      logger: createMemoryLogger(),
    });

    expect(files).toEqual({ report: liveReportPath(site), share: sharePath(site) });
    expect(existsSync(sharePath(site))).toBe(true);
  });

  it("gives the report's path alone, and a warning, when the page can't be written", async () => {
    const { site } = await siteWithRun();
    await blockShareFolder(site);
    const logger = createMemoryLogger();

    const files = await regenerateLiveFiles({ outDir: site, config: DEFAULT_CONFIG, logger });

    expect(files).toEqual({ report: liveReportPath(site), share: null });
    expect(logger.entries.map((entry) => [entry.level, NOT_UPDATED.test(entry.message)])).toEqual([
      ["warn", true],
    ]);
  });

  it("writes nothing, and says there's no run yet, for a site with no completed run", async () => {
    const site = await mkdtemp(path.join(os.tmpdir(), "voicecap-share-"));
    const logger = createMemoryLogger();

    expect(await regenerateLiveFiles({ outDir: site, config: DEFAULT_CONFIG, logger })).toBeNull();

    expect(logger.entries).toEqual([
      { level: "info", message: "No completed run yet, so the report wasn't updated." },
    ]);
    expect(await readdir(site)).toEqual([]);
  });
});

describe("writeSharePage", () => {
  it("writes the site's page, and gives its path", async () => {
    const { site } = await siteWithRun();
    await rm(path.join(site, "share"), { recursive: true, force: true });
    const logger = createMemoryLogger();

    const file = await writeSharePage({ siteDir: site, config: DEFAULT_CONFIG, logger });

    expect(file).toBe(sharePath(site));
    expect(await readFile(sharePath(site), "utf8")).toContain("how its pages read aloud");
    expect(await readdir(path.dirname(sharePath(site)))).toEqual(["current.html"]);
    expect(logger.entries).toEqual([]);
  });

  it("writes the whole page in one call to writeFileAtomic", async () => {
    const { site } = await siteWithRun();
    vi.mocked(writeFileAtomic).mockClear();

    await writeSharePage({ siteDir: site, config: DEFAULT_CONFIG, logger: createMemoryLogger() });

    const writes = vi
      .mocked(writeFileAtomic)
      .mock.calls.filter(([file]) => file === sharePath(site));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[1]).toBe(await readFile(sharePath(site), "utf8"));
  });

  it("dates the page from the time it's given", async () => {
    const { site } = await siteWithRun();

    await writeSharePage({
      siteDir: site,
      config: DEFAULT_CONFIG,
      logger: createMemoryLogger(),
      now: new Date(2027, 0, 5, 9, 30),
    });

    const page = await readFile(sharePath(site), "utf8");
    expect(page).toContain("As of <b>5 January 2027</b>");
    expect(page).toMatch(/Generated on 5 January 2027 at 09:30 \(UTC[−+]\d\d:\d\d\)\./);
  });

  it("takes the site's name from the config", async () => {
    const { site } = await siteWithRun();

    await writeSharePage({
      siteDir: site,
      config: { ...DEFAULT_CONFIG, report: { ...DEFAULT_CONFIG.report, siteName: "The agency" } },
      logger: createMemoryLogger(),
    });

    expect(await readFile(sharePath(site), "utf8")).toContain(
      "<title>The agency: how its pages read aloud with NVDA</title>",
    );
  });

  // Where neither HOME (USERPROFILE on Windows) nor the account's entry gives one, Node throws.
  it("writes the page where Node can't find a home folder, which leaves nothing to replace", async () => {
    const dir = await setup();
    const homedir = vi.spyOn(os, "homedir").mockImplementation(() => {
      throw new Error("A system error occurred: uv_os_homedir returned ENOENT");
    });
    try {
      const logger = createMemoryLogger();

      const result = await runAudit(options(dir, new ScriptedDriver(sitePages()), { logger }));

      expect(result.outcome).toBe("completed");
      expect(logger.text("warn")).toBe("");
      expect(await readFile(sharePath(outDir(dir)), "utf8")).toContain("how its pages read aloud");
    } finally {
      homedir.mockRestore();
    }
  });

  it("says nothing, writes nothing, and gives null for a site with no run to share", async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), "voicecap-share-"));
    const nowhere = path.join(empty, "no-such-site");
    const logger = createMemoryLogger();

    expect(await writeSharePage({ siteDir: empty, config: DEFAULT_CONFIG, logger })).toBeNull();
    expect(await writeSharePage({ siteDir: nowhere, config: DEFAULT_CONFIG, logger })).toBeNull();

    // Not a failure: there's just nothing yet.
    expect(logger.entries).toEqual([]);
    expect(await readdir(empty)).toEqual([]);
  });

  it("gives null, with one warning, when the page can't be written, and never throws", async () => {
    const { site } = await siteWithRun();
    await blockShareFolder(site);
    const logger = createMemoryLogger();

    const file = await writeSharePage({ siteDir: site, config: DEFAULT_CONFIG, logger });

    expect(file).toBeNull();
    expect(logger.entries).toEqual([
      { level: "warn", message: expect.stringMatching(NOT_UPDATED) as string },
    ]);
  });

  it("gives null, with a warning, when the site's records can't be made into a page", async () => {
    const { site } = await siteWithRun();
    // A damaged review history: voicecap refuses to read it rather than show less than there is.
    await writeFile(path.join(site, "reviews.json"), "{ not json");
    const logger = createMemoryLogger();

    expect(await writeSharePage({ siteDir: site, config: DEFAULT_CONFIG, logger })).toBeNull();

    expect(logger.entries).toEqual([
      { level: "warn", message: expect.stringMatching(NOT_UPDATED) as string },
    ]);
  });

  it("gives a site whose only run was a replay a page that says no live run counts yet", async () => {
    // As CI's smoke test runs it: a replay of the fixture's recorded run.
    const dir = await setup();
    const result = await runAudit({
      ...options(dir, undefined),
      site: "http://127.0.0.1:4747",
      pages: fixture("pages.json"),
      replayFrom: fixture("replay-run"),
    });
    expect(result.outcome).toBe("completed");

    const page = await readFile(sharePath(result.siteDir), "utf8");

    expect(page).toContain("No live run counts yet");
    expect(page).toContain("data:font/woff2;base64,");
    // Nothing counts, so there's nothing for the fingerprint check to carry.
    expect(page).not.toContain('id="fp-data"');
  });
});
