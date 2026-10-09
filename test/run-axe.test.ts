/**
 * The axe-core check a driver makes of each page as it first loads: the run keeps its results in the
 * page's folder (axe.json), and records them in the page's record, apart from the page's transcripts
 * and beside the page's screenshot.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { keptAxeResults } from "../src/axe/results.js";
import { ForegroundError, type AxeCapture } from "../src/drivers/types.js";
import type * as Api from "../src/index.js";
import type { FileHash, PageRecord } from "../src/model.js";
import { runAudit, type RunAuditOptions, type RunAuditResult } from "../src/run/audit.js";
import { attemptsDir, pageDir } from "../src/run/paths.js";
import { readRunJson } from "../src/run/store.js";
import { axeRecordOf } from "../src/share/records.js";
import { fileHash } from "../src/transcripts/write.js";
import { EnvironmentError } from "../src/util/errors.js";
import { sealOf } from "../src/util/hash.js";
import { createMemoryLogger } from "../src/util/log.js";
import { verifyHome } from "../src/verify.js";
import { rawAxe, rawRule, type RawAxeRule } from "./helpers/raw-axe.js";
import {
  config,
  hangOnce,
  ISO_MS,
  options,
  outDir,
  setup,
  SITE,
  sitePages,
} from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

/** What axe gives for the page at `url` with these rules failing, kept as the Guidepup driver keeps it. */
function results(url: string, violations: RawAxeRule[] = []) {
  return keptAxeResults(rawAxe({ violations, passes: 30, inapplicable: 60 }), url);
}

/** Where a page's axe.json is in the folder of the page itself, and in an earlier attempt's. */
const axeOf = (dir: string, run: RunAuditResult, slug = "home") =>
  path.join(pageDir(outDir(dir), run.runId, slug), "axe.json");
const earlierAxeOf = (dir: string, run: RunAuditResult, attempt: number) =>
  path.join(attemptsDir(outDir(dir), run.runId, "home"), String(attempt), "axe.json");

/** Whether a file holds exactly this text. */
const holds = async (file: string, text: string) =>
  Buffer.compare(await readFile(file), Buffer.from(text, "utf8")) === 0;

/** Check the home as `voicecap verify` does; the number of problems it found. */
async function problemsIn(dir: string): Promise<number> {
  const home = path.join(dir, "transcripts");
  return (await verifyHome({ home, logger: createMemoryLogger() })).problems;
}

/** A run of the scripted site's home page alone, with this axe check for it (none, for a driver that can't check). */
async function runHome(axe: AxeCapture | undefined, extra: Partial<RunAuditOptions> = {}) {
  const dir = await setup(["/"]);
  const driver = new ScriptedDriver(sitePages(axe ? { home: { axe } } : {}));
  const run = await runAudit(options(dir, driver, extra));
  return { dir, driver, run, page: run.run.pages[0]! };
}

const TRANSCRIPTS = [
  "headings.json",
  "headings.txt",
  "read.json",
  "read.txt",
  "tab.json",
  "tab.txt",
];

describe("a page's axe results, in a run", () => {
  it("checks each page once, on its first load, after it opens and before its first key", async () => {
    const dir = await setup();
    const pages = sitePages({
      home: { axe: results(`${SITE}/`) },
      about: { axe: results(`${SITE}/about`) },
      resources: { axe: results(`${SITE}/resources`) },
    });
    const driver = new ScriptedDriver(pages);
    const run = await runAudit(options(dir, driver));
    expect(run.outcome).toBe("completed");

    // Each page loads once for each of its three passes, and is checked on one of those loads only.
    const { calls } = driver;
    expect(calls.filter((call) => call === "openPage")).toHaveLength(9);
    expect(calls.filter((call) => call === "checkWithAxe")).toHaveLength(3);
    // Right after the page opens, and before the read pass's first key (Ctrl+End).
    expect(calls.slice(0, 3)).toEqual(["openPage", "checkWithAxe", "toBottom"]);
    calls.forEach((call, index) => {
      if (call !== "checkWithAxe") return;
      expect(calls[index - 1]).toBe("openPage");
      expect(calls[index + 1]).toBe("toBottom");
    });
    // Each page kept the results of its own check.
    for (const page of run.run.pages) {
      const kept = JSON.parse(await readFile(axeOf(dir, run, page.slug), "utf8")) as {
        url: string;
      };
      expect(kept.url).toBe(page.url);
    }
  });

  it("writes axe.json, and records its fingerprint and counts with the page", async () => {
    const found = results(`${SITE}/`, [
      rawRule("image-alt"),
      rawRule("link-name", { impact: "minor" }),
    ]);
    const { dir, run, page } = await runHome(found);
    expect(run.outcome).toBe("completed");

    expect(await holds(axeOf(dir, run), found.json)).toBe(true);
    expect(found.summary.counts).toEqual({
      violations: 2,
      incomplete: 0,
      passes: 30,
      inapplicable: 60,
    });
    expect(page.axe).toEqual({
      ...fileHash(found.json),
      ranAt: expect.stringMatching(ISO_MS) as unknown,
      ...found.summary,
    });
    // Not one of the page's files: a review keeps those to find a page that changed since.
    expect(Object.keys(page.files).sort()).toEqual(TRANSCRIPTS);
    // The record on disk says the same, and the run's seal covers it, so the run verifies.
    const stored = await readRunJson(outDir(dir), run.runId);
    expect(stored.pages[0]?.axe).toEqual(page.axe);
    expect(stored.seal).toBe(sealOf(stored));
    expect(await problemsIn(dir)).toBe(0);
  });

  it("records axe's error, and reads the page as usual", async () => {
    const { dir, run, page } = await runHome({ error: "timed out after 20s" });
    expect(page.status).toBe("done");
    expect(page.axe).toEqual({
      error: "timed out after 20s",
      ranAt: expect.stringMatching(ISO_MS) as unknown,
    });
    expect(existsSync(axeOf(dir, run))).toBe(false);
    expect(Object.keys(page.files).sort()).toEqual(TRANSCRIPTS);
    expect(await problemsIn(dir)).toBe(0);
  });

  describe("when a check is still going at its limit", () => {
    /** What the driver gives for a check it stopped waiting for, which goes on in the page. */
    const LEFT_RUNNING: AxeCapture = { error: "timed out after 20s", leftRunning: true };

    it("opens the page again before the first key, so the check ends with its browser, and keeps the reason", async () => {
      const { dir, driver, run, page } = await runHome(LEFT_RUNNING);
      expect(page.status).toBe("done");

      // The check, then the page opened again, then the read pass's first key (Ctrl+End), on the
      // load opened after the check. The check isn't made again on it.
      expect(driver.calls.slice(0, 4)).toEqual([
        "openPage",
        "checkWithAxe",
        "openPage",
        "toBottom",
      ]);
      expect(driver.calls.filter((call) => call === "openPage")).toHaveLength(4);
      expect(driver.calls.filter((call) => call === "checkWithAxe")).toHaveLength(1);
      // The record keeps the reason, as for any check that gave none, and nothing more.
      expect(page.axe).toEqual({
        error: "timed out after 20s",
        ranAt: expect.stringMatching(ISO_MS) as unknown,
      });
      expect(existsSync(axeOf(dir, run))).toBe(false);
      expect(Object.keys(page.files).sort()).toEqual(TRANSCRIPTS);
      expect(page.passes.read?.warnings).toEqual([]);
      expect(await problemsIn(dir)).toBe(0);
    });

    it.each<[what: string, axe: AxeCapture]>([
      ["answered", results(`${SITE}/`, [rawRule("image-alt")])],
      ["failed before its limit", { error: "TypeError: axe.run is not a function" }],
    ])("doesn't open the page again after a check that %s", async (_, axe) => {
      const { driver, page } = await runHome(axe);
      expect(page.status).toBe("done");
      expect(driver.calls.slice(0, 3)).toEqual(["openPage", "checkWithAxe", "toBottom"]);
      expect(driver.calls.filter((call) => call === "openPage")).toHaveLength(3);
    });

    it("words a load that ends elsewhere as a warning, as for any load after the first", async () => {
      const dir = await setup(["/"]);
      const driver = new ScriptedDriver(sitePages({ home: { axe: LEFT_RUNNING } }));
      // The load after the check is redirected; the page's first load wasn't.
      const open = driver.openPage.bind(driver);
      let opens = 0;
      driver.openPage = async (url) => {
        const info = await open(url);
        return ++opens === 2 ? { ...info, finalUrl: `${SITE}/home/` } : info;
      };
      const run = await runAudit(options(dir, driver));
      const page = run.run.pages[0]!;

      expect(page).toMatchObject({ status: "done", finalUrl: `${SITE}/` });
      expect(page.passes.read?.warnings).toEqual([
        `This load ended at ${SITE}/home/; the page's first load ended at ${SITE}/.`,
      ]);
      // The transcript is of the load that was read.
      const read = JSON.parse(
        await readFile(path.join(pageDir(outDir(dir), run.runId, "home"), "read.json"), "utf8"),
      ) as { page: { finalUrl: string } };
      expect(read.page.finalUrl).toBe(`${SITE}/home/`);
    });

    describe("a page that won't open again", () => {
      const lost = new ForegroundError("The browser lost the foreground to another window");

      it("fails the attempt as a page that wouldn't open does, and tries the page again after a restart", async () => {
        const dir = await setup(["/"]);
        let opens = 0;
        const driver = new ScriptedDriver(sitePages({ home: { axe: LEFT_RUNNING } }), {
          fail: (command) => (command === "openPage" && ++opens === 2 ? lost : null),
        });
        const run = await runAudit(options(dir, driver));
        const page = run.run.pages[0]!;

        expect(page).toMatchObject({ status: "done", attempts: 2 });
        expect(page.failedAttempts).toEqual([
          expect.objectContaining({
            n: 1,
            pass: "read",
            step: null,
            command: "openPage",
            cause: "foreground",
            restarted: true,
          }),
        ]);
        expect(page.errors).toEqual([
          "Attempt 1 failed (Could not open the page for the read pass: The browser lost the foreground to another window); retrying.",
        ]);
        expect(driver.stops).toBeGreaterThanOrEqual(1);
        // The second attempt was checked, opened again, and read.
        expect(driver.calls.filter((call) => call === "checkWithAxe")).toHaveLength(2);
        expect(page.axe).toEqual({
          error: "timed out after 20s",
          ranAt: expect.stringMatching(ISO_MS) as unknown,
        });
        expect(await problemsIn(dir)).toBe(0);
      });

      it("records one that hangs as an open-timeout, within the time a page has to open", async () => {
        const dir = await setup(["/"]);
        let opens = 0;
        const driver = new ScriptedDriver(sitePages({ home: { axe: LEFT_RUNNING } }), {
          hang: (command) => command === "openPage" && ++opens === 2,
        });
        const run = await runAudit(options(dir, driver));
        const page = run.run.pages[0]!;

        expect(page).toMatchObject({ status: "done", attempts: 2 });
        expect(page.failedAttempts).toEqual([
          expect.objectContaining({
            n: 1,
            pass: "read",
            step: null,
            command: "openPage",
            cause: "open-timeout",
            message: expect.stringMatching(/^Opening the page did not finish within /) as unknown,
            restarted: true,
          }),
        ]);
      });

      it("leaves the page pending, and the attempt uncounted, when Ctrl+C comes as it opens again", async () => {
        const dir = await setup(["/"]);
        const controller = new AbortController();
        const driver = new ScriptedDriver(sitePages({ home: { axe: LEFT_RUNNING } }));
        const open = driver.openPage.bind(driver);
        let opens = 0;
        driver.openPage = (url) => {
          if (++opens === 1) return open(url);
          setTimeout(() => controller.abort(), 20);
          return new Promise(() => {});
        };
        const run = await runAudit(options(dir, driver, { signal: controller.signal }));
        expect(run.outcome).toBe("interrupted");
        // Before the read pass's first key.
        expect(driver.calls).not.toContain("toBottom");

        const saved = (await readRunJson(outDir(dir), run.runId)).pages[0]!;
        expect(saved).toMatchObject({ status: "pending", attempts: 0 });
        expect(saved).not.toHaveProperty("failedAttempts");
        expect(saved).not.toHaveProperty("axe");
      });
    });
  });

  it("doesn't check a page it skips, or one that answered 4xx or 5xx", async () => {
    const dir = await setup();
    const axe = results(`${SITE}/`);
    const pages = sitePages({
      home: { contentType: "application/pdf", axe },
      about: { finalUrl: "https://elsewhere.example/about", axe },
      resources: { status: 404, axe },
    });
    const driver = new ScriptedDriver(pages);
    const run = await runAudit(options(dir, driver));
    expect(run.run.pages.map((page) => page.status)).toEqual(["skipped", "skipped", "failed"]);
    for (const page of run.run.pages) {
      expect(page).not.toHaveProperty("axe");
      expect(existsSync(axeOf(dir, run, page.slug))).toBe(false);
    }
    expect(driver.calls).not.toContain("checkWithAxe");
    expect(await problemsIn(dir)).toBe(0);

    // A 5xx is tried again, and is no more checked for it.
    const failing = await setup(["/"]);
    const unwell = new ScriptedDriver(sitePages({ home: { status: 503, axe } }));
    const tried = await runAudit(options(failing, unwell, { config: config({ pageAttempts: 2 }) }));
    expect(tried.run.pages[0]).toMatchObject({ status: "failed", attempts: 2 });
    expect(tried.run.pages[0]).not.toHaveProperty("axe");
    expect(existsSync(axeOf(failing, tried))).toBe(false);
    expect(unwell.calls.filter((call) => call === "openPage")).toHaveLength(2);
    expect(unwell.calls).not.toContain("checkWithAxe");
    expect(await problemsIn(failing)).toBe(0);
  });

  it("records no axe for a driver that can't check a page", async () => {
    const { dir, driver, run, page } = await runHome(undefined);
    expect(page.status).toBe("done");
    expect(driver.checkWithAxe).toBeUndefined();
    expect(page).not.toHaveProperty("axe");
    expect(existsSync(axeOf(dir, run))).toBe(false);
    expect(await readFile(path.join(run.runDir, "run.json"), "utf8")).not.toContain('"axe"');
    expect(await problemsIn(dir)).toBe(0);
  });

  it("checks each page on its first load without the read pass", async () => {
    const found = results(`${SITE}/`, [rawRule("image-alt")]);
    const { dir, driver, run, page } = await runHome(found, { passes: ["headings", "tab"] });
    expect(Object.keys(page.passes)).toEqual(["headings", "tab"]);

    // The headings pass is the first load: checked right after it opens, before its first key (H).
    expect(driver.calls.slice(0, 3)).toEqual(["openPage", "checkWithAxe", "nextHeading"]);
    expect(driver.calls.filter((call) => call === "openPage")).toHaveLength(2);
    expect(driver.calls.filter((call) => call === "checkWithAxe")).toHaveLength(1);
    expect(page.axe).toMatchObject(fileHash(found.json));
    expect(await holds(axeOf(dir, run), found.json)).toBe(true);
    expect(await problemsIn(dir)).toBe(0);
  });

  it("is kept for a page that failed after the check, so the record accounts for the file", async () => {
    const dir = await setup(["/"]);
    const found = results(`${SITE}/`, [rawRule("image-alt")]);
    // Every attempt's read pass times out at its first Down Arrow.
    const driver = new ScriptedDriver(sitePages({ home: { axe: found } }), {
      hang: (command) => command === "nextLine",
    });
    const run = await runAudit(options(dir, driver, { config: config({ pageAttempts: 2 }) }));
    const page = run.run.pages[0]!;
    expect(run.outcome).toBe("completed");
    expect(page).toMatchObject({ status: "failed", attempts: 2 });
    expect(page.axe).toMatchObject(fileHash(found.json));
    expect(await holds(axeOf(dir, run), found.json)).toBe(true);
    expect(await problemsIn(dir)).toBe(0);
  });

  it("moves a retried page's axe.json to attempts/, and records the new attempt's own", async () => {
    const dir = await setup(["/"]);
    const captures = [
      results(`${SITE}/`, [rawRule("image-alt")]),
      results(`${SITE}/`, [rawRule("link-name"), rawRule("button-name")]),
    ];
    const driver = new ScriptedDriver(sitePages({ home: { axe: captures[0]! } }), {
      hang: hangOnce("nextLine"),
    });
    // A new result for each check: the first attempt's check is the first, the second's the second.
    const check = driver.checkWithAxe!;
    let checks = 0;
    driver.checkWithAxe = async () => {
      await check();
      return captures[checks++]!;
    };

    const run = await runAudit(options(dir, driver));
    expect(run.run.pages[0]).toMatchObject({ status: "done", attempts: 2 });
    expect(checks).toBe(2);
    expect(await holds(earlierAxeOf(dir, run, 1), captures[0]!.json)).toBe(true);
    expect(existsSync(path.join(path.dirname(earlierAxeOf(dir, run, 1)), "read.txt"))).toBe(true);
    expect(await holds(axeOf(dir, run), captures[1]!.json)).toBe(true);
    expect(run.run.pages[0]?.axe).toMatchObject({
      ...fileHash(captures[1]!.json),
      counts: { violations: 2 },
    });
    expect(await problemsIn(dir)).toBe(0);
  });

  it("leaves no axe in the record of a page whose next attempt couldn't be checked", async () => {
    const dir = await setup(["/"]);
    const found = results(`${SITE}/`, [rawRule("image-alt")]);
    // The first session: the page fails after its check, and the run stops there.
    const first = new ScriptedDriver(sitePages({ home: { axe: found } }), {
      hang: (command) => command === "nextLine",
    });
    const stopped = await runAudit(
      options(dir, first, { config: config({ pageAttempts: 1, maxConsecutiveFailures: 1 }) }),
    );
    expect(stopped.outcome).toBe("stopped");
    expect(stopped.run.pages[0]?.axe).toMatchObject(fileHash(found.json));

    // The next session tries the failed page again, with a driver that can't check a page.
    const resumed = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    expect(resumed).toMatchObject({ runId: stopped.runId, outcome: "completed" });
    expect(resumed.run.pages[0]).toMatchObject({ status: "done", attempts: 2 });
    expect(resumed.run.pages[0]).not.toHaveProperty("axe");
    // The first session's results stay with its attempt.
    expect(existsSync(axeOf(dir, resumed))).toBe(false);
    expect(await holds(earlierAxeOf(dir, resumed, 1), found.json)).toBe(true);
    expect(await problemsIn(dir)).toBe(0);
  });

  it("seals the axe record with the run", async () => {
    const found = results(`${SITE}/`, [rawRule("image-alt")]);
    const { dir, run } = await runHome(found);
    const stored = await readRunJson(outDir(dir), run.runId);
    expect(stored.seal).toBe(sealOf(stored));

    // A record changed after the seal doesn't match it, and verify names the run.
    (stored.pages[0]!.axe as FileHash).bytes += 1;
    expect(sealOf(stored)).not.toBe(stored.seal);
    await writeFile(path.join(run.runDir, "run.json"), `${JSON.stringify(stored, null, 2)}\n`);
    const verified = await verifyHome({
      home: path.join(dir, "transcripts"),
      logger: createMemoryLogger(),
    });
    expect(verified.sites[0]?.problems).toEqual([
      expect.stringMatching(/run\.json: changed since it was sealed$/) as unknown,
    ]);
  });

  describe("when the driver can't answer", () => {
    const gone = () =>
      new EnvironmentError("The browser closed or crashed while voicecap was using it.", {
        failure: "browser",
      });

    it("fails the attempt and tries the page again after a restart, as a browser that's gone does for any step", async () => {
      const dir = await setup(["/"]);
      const found = results(`${SITE}/`, [rawRule("image-alt")]);
      let checks = 0;
      const driver = new ScriptedDriver(sitePages({ home: { axe: found } }), {
        fail: (command) => (command === "checkWithAxe" && ++checks === 1 ? gone() : null),
      });
      const run = await runAudit(options(dir, driver));
      const page = run.run.pages[0]!;

      expect(run.outcome).toBe("completed");
      expect(page).toMatchObject({ status: "done", attempts: 2 });
      // Before the first pass began its first step: the page hadn't been read at all.
      expect(page.failedAttempts).toEqual([
        expect.objectContaining({
          n: 1,
          pass: "read",
          step: null,
          command: "openPage",
          cause: "browser",
          restarted: true,
        }),
      ]);
      expect(page.errors).toEqual([
        "Attempt 1 failed (Could not check the page with axe for the read pass: The browser closed or crashed while voicecap was using it.); retrying.",
      ]);
      expect(driver.stops).toBeGreaterThanOrEqual(1);
      // The second attempt's check is the one the page keeps; the first left nothing behind.
      expect(page.axe).toMatchObject(fileHash(found.json));
      expect(await holds(axeOf(dir, run), found.json)).toBe(true);
      expect(existsSync(earlierAxeOf(dir, run, 1))).toBe(false);
      expect(await problemsIn(dir)).toBe(0);
    });

    it("ends the attempt at the page's limit when a check never answers", async () => {
      const dir = await setup(["/"]);
      const driver = new ScriptedDriver(sitePages({ home: { axe: results(`${SITE}/`) } }), {
        hang: (command) => command === "checkWithAxe",
      });
      const run = await runAudit(
        options(dir, driver, {
          config: config({
            timeouts: { stepMs: 100, pageMs: 400, driverStartMs: 2000 },
            pageAttempts: 1,
          }),
        }),
      );
      const page = run.run.pages[0]!;
      expect(page).toMatchObject({ status: "failed", attempts: 1 });
      expect(page.failedAttempts).toEqual([
        expect.objectContaining({ step: null, command: "openPage", cause: "page-timeout" }),
      ]);
      expect(page).not.toHaveProperty("axe");
      expect(driver.calls).not.toContain("toBottom");
    });

    it("leaves the page pending, and the attempt uncounted, when Ctrl+C comes during a check", async () => {
      const dir = await setup(["/"]);
      const controller = new AbortController();
      const driver = new ScriptedDriver(sitePages({ home: { axe: results(`${SITE}/`) } }));
      // Ctrl+C while the check is under way.
      driver.checkWithAxe = () => {
        setTimeout(() => controller.abort(), 20);
        return new Promise<AxeCapture>(() => {});
      };
      const run = await runAudit(options(dir, driver, { signal: controller.signal }));
      expect(run.outcome).toBe("interrupted");

      const saved = (await readRunJson(outDir(dir), run.runId)).pages[0]!;
      expect(saved).toMatchObject({ status: "pending", attempts: 0 });
      expect(saved).not.toHaveProperty("failedAttempts");
      expect(saved).not.toHaveProperty("axe");
    });
  });
});

describe("a page's axe record, read for the shareable page", () => {
  /** A page record holding only what axeRecordOf reads: this in place of its axe record. */
  const withAxe = (axe: unknown) => ({ axe }) as unknown as PageRecord;
  const ranAt = "2026-10-09T11:02:05.000-05:00";
  const found = results(`${SITE}/`, [rawRule("image-alt")]);
  const kept = { ...fileHash(found.json), ranAt, ...found.summary };

  it("is none for a page that has none", () => {
    expect(axeRecordOf(withAxe(undefined))).toBeUndefined();
    expect(axeRecordOf({} as PageRecord)).toBeUndefined();
  });

  it("is the record, when it's the fingerprint of results or the reason there are none", () => {
    expect(axeRecordOf(withAxe(kept))).toEqual(kept);
    const error = { error: "timed out after 20s", ranAt };
    expect(axeRecordOf(withAxe(error))).toEqual(error);
  });

  it("is unreadable when it's of no kind voicecap writes", () => {
    for (const odd of [null, "axe", 7, true, [], [kept], {}, { ranAt }, { sha256: "abc" }]) {
      expect(axeRecordOf(withAxe(odd)), JSON.stringify(odd)).toBe("unreadable");
    }
  });
});

describe("the package's entry", () => {
  it("exports the name of a page's axe file", async () => {
    const api = await import("../src/index.js");

    expect(api.AXE_FILE).toBe("axe.json");
  });

  it("exports the types of a driver's check with axe, and of what a page's record keeps of it", () => {
    // This compiles only if the entry exports each of these types.
    const types: [
      // What `ScreenReaderDriver.checkWithAxe` gives: the file's text and what it comes to, or why
      // there's none.
      Api.AxeCapture | null,
      // What a page's record keeps of the results, beside the file's fingerprint.
      Api.AxeSummary | null,
      // The record itself (`PageRecord.axe`).
      Api.AxeRecord | null,
    ] = [null, null, null];

    expect(types).toHaveLength(3);
  });
});
