/**
 * The screenshot a driver takes of each page as it loads: the run keeps it in the page's folder, and
 * records it in the page's record, apart from the page's transcripts.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { PageScreenshot } from "../src/drivers/types.js";
import { runAudit, type RunAuditResult } from "../src/run/audit.js";
import { attemptsDir, pageDir } from "../src/run/paths.js";
import { readRunJson } from "../src/run/store.js";
import { fileHash } from "../src/transcripts/write.js";
import { sealOf } from "../src/util/hash.js";
import { createMemoryLogger } from "../src/util/log.js";
import { verifyHome } from "../src/verify.js";
import { TINY_JPEG } from "./helpers/jpeg.js";
import { config, hangOnce, ISO_MS, options, outDir, setup, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

/** `TINY_JPEG` with a comment added: the same 16 x 12 picture, in other bytes. */
function commented(text: string): Uint8Array {
  const note = new TextEncoder().encode(text);
  const length = note.length + 2;
  return Uint8Array.from([
    ...TINY_JPEG.subarray(0, 2),
    ...[0xff, 0xfe, length >> 8, length & 0xff],
    ...note,
    ...TINY_JPEG.subarray(2),
  ]);
}

/** Where a page's screenshot is in the folder of the page itself, and in an earlier attempt's. */
const shotOf = (dir: string, run: RunAuditResult, slug = "home") =>
  path.join(pageDir(outDir(dir), run.runId, slug), "screenshot.jpg");
const earlierShotOf = (dir: string, run: RunAuditResult, attempt: number) =>
  path.join(attemptsDir(outDir(dir), run.runId, "home"), String(attempt), "screenshot.jpg");

/** The same bytes: Buffer.compare reads a Buffer and a plain Uint8Array alike. */
const sameBytes = async (file: string, expected: Uint8Array) =>
  Buffer.compare(await readFile(file), expected) === 0;

/** Check the home as `voicecap verify` does; the number of problems it found. */
async function problemsIn(dir: string): Promise<number> {
  const home = path.join(dir, "transcripts");
  return (await verifyHome({ home, logger: createMemoryLogger() })).problems;
}

/** A run of the scripted site's home page alone, with this screenshot for it (none, for none). */
async function runHome(screenshot: PageScreenshot | undefined) {
  const dir = await setup(["/"]);
  const pages = sitePages({ home: screenshot ? { screenshot } : {} });
  const run = await runAudit(options(dir, new ScriptedDriver(pages)));
  return { dir, run, page: run.run.pages[0]! };
}

describe("a page's screenshot, in a run", () => {
  it("is kept in the page's folder, and recorded apart from its transcripts", async () => {
    const { dir, run, page } = await runHome({ jpeg: TINY_JPEG });
    expect(run.outcome).toBe("completed");

    expect(await sameBytes(shotOf(dir, run), TINY_JPEG)).toBe(true);
    expect(page.screenshot).toEqual({
      ...fileHash(TINY_JPEG),
      takenAt: expect.stringMatching(ISO_MS) as unknown,
      width: 16,
      height: 12,
    });
    // Not one of the page's files: a review keeps those to find a page that changed since.
    expect(Object.keys(page.files).sort()).toEqual([
      "headings.json",
      "headings.txt",
      "read.json",
      "read.txt",
      "tab.json",
      "tab.txt",
    ]);
    // The record on disk says the same, and the run's seal covers it, so the run verifies.
    const stored = await readRunJson(outDir(dir), run.runId);
    expect(stored.pages[0]?.screenshot).toEqual(page.screenshot);
    expect(stored.seal).toBe(sealOf(stored));
    expect(await problemsIn(dir)).toBe(0);
  });

  it("is kept for each page, in the page's own folder", async () => {
    const dir = await setup();
    const shots: Record<string, Uint8Array> = {
      "/": commented("home"),
      "/about": commented("about"),
      "/resources": commented("resources"),
    };
    const pages = sitePages({
      home: { screenshot: { jpeg: shots["/"]! } },
      about: { screenshot: { jpeg: shots["/about"]! } },
      resources: { screenshot: { jpeg: shots["/resources"]! } },
    });
    const run = await runAudit(options(dir, new ScriptedDriver(pages)));
    expect(run.run.pages).toHaveLength(3);
    for (const page of run.run.pages) {
      const shot = shots[new URL(page.url).pathname]!;
      expect(await sameBytes(shotOf(dir, run, page.slug), shot), page.url).toBe(true);
      expect(page.screenshot, page.url).toMatchObject(fileHash(shot));
    }
    expect(await problemsIn(dir)).toBe(0);
  });

  it("is the one taken as the page first loaded, though each pass loads the page again", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages());
    const shots = ["first", "second", "third"].map(commented);
    const openPage = driver.openPage.bind(driver);
    let loads = 0;
    driver.openPage = async (url) => ({
      ...(await openPage(url)),
      screenshot: { jpeg: shots[loads++]! },
    });

    const run = await runAudit(options(dir, driver));
    expect(loads).toBe(3);
    expect(await sameBytes(shotOf(dir, run), shots[0]!)).toBe(true);
    expect(run.run.pages[0]?.screenshot).toMatchObject(fileHash(shots[0]!));
    expect(await problemsIn(dir)).toBe(0);
  });

  it("is recorded as the reason when the driver couldn't take it, and the page is read all the same", async () => {
    const { dir, run, page } = await runHome({ error: "timed out" });
    expect(page.status).toBe("done");
    expect(page.screenshot).toEqual({
      error: "timed out",
      takenAt: expect.stringMatching(ISO_MS) as unknown,
    });
    expect(existsSync(shotOf(dir, run))).toBe(false);
    expect(Object.keys(page.files)).toHaveLength(6);
    expect(await problemsIn(dir)).toBe(0);
  });

  it("is recorded as a failure when the bytes aren't a JPEG voicecap can read, and none is kept", async () => {
    const { dir, run, page } = await runHome({ jpeg: Uint8Array.of(1, 2, 3) });
    expect(page.status).toBe("done");
    expect(page.screenshot).toEqual({
      error: "the picture wasn't a JPEG voicecap could read",
      takenAt: expect.stringMatching(ISO_MS) as unknown,
    });
    expect(existsSync(shotOf(dir, run))).toBe(false);
    expect(await problemsIn(dir)).toBe(0);
  });

  it("is left out of the record when the driver takes none", async () => {
    const { dir, run, page } = await runHome(undefined);
    expect(page.status).toBe("done");
    expect(page).not.toHaveProperty("screenshot");
    expect(existsSync(shotOf(dir, run))).toBe(false);
    expect(await readFile(path.join(run.runDir, "run.json"), "utf8")).not.toContain("screenshot");
    expect(await problemsIn(dir)).toBe(0);
  });

  // The driver may take one of any page it loads; the run keeps the pictures of pages it reads.
  it("isn't kept for a page that's skipped, or one the site answered with an error", async () => {
    const dir = await setup();
    const screenshot = { jpeg: TINY_JPEG };
    const pages = sitePages({
      home: { contentType: "application/pdf", screenshot },
      about: { finalUrl: "https://elsewhere.example/about", screenshot },
      resources: { status: 404, screenshot },
    });
    const run = await runAudit(options(dir, new ScriptedDriver(pages)));
    expect(run.run.pages.map((page) => page.status)).toEqual(["skipped", "skipped", "failed"]);
    for (const page of run.run.pages) {
      expect(page).not.toHaveProperty("screenshot");
      expect(existsSync(shotOf(dir, run, page.slug))).toBe(false);
    }
    expect(await problemsIn(dir)).toBe(0);
  });

  it("is kept for a page that failed after the picture was taken, so the record accounts for the file", async () => {
    const dir = await setup(["/"]);
    const pages = sitePages({ home: { screenshot: { jpeg: TINY_JPEG } } });
    // Every attempt's read pass times out at its first Down Arrow.
    const driver = new ScriptedDriver(pages, { hang: (command) => command === "nextLine" });
    const run = await runAudit(options(dir, driver, { config: config({ pageAttempts: 2 }) }));
    const page = run.run.pages[0]!;
    expect(run.outcome).toBe("completed");
    expect(page).toMatchObject({ status: "failed", attempts: 2 });
    expect(page.screenshot).toMatchObject({ ...fileHash(TINY_JPEG), width: 16, height: 12 });
    expect(await sameBytes(shotOf(dir, run), TINY_JPEG)).toBe(true);
    expect(await problemsIn(dir)).toBe(0);
  });

  it("moves aside with the transcripts when the page is tried again, and the record is the last attempt's", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages(), { hang: hangOnce("nextLine") });
    // A new picture for each load: the first attempt's read pass is load 1, and its second attempt's
    // read pass is load 2.
    const shots = ["first", "second", "third", "fourth"].map(commented);
    const openPage = driver.openPage.bind(driver);
    let loads = 0;
    driver.openPage = async (url) => ({
      ...(await openPage(url)),
      screenshot: { jpeg: shots[loads++]! },
    });

    const run = await runAudit(options(dir, driver));
    expect(run.run.pages[0]).toMatchObject({ status: "done", attempts: 2 });
    expect(await sameBytes(earlierShotOf(dir, run, 1), shots[0]!)).toBe(true);
    expect(existsSync(path.join(path.dirname(earlierShotOf(dir, run, 1)), "read.txt"))).toBe(true);
    expect(await sameBytes(shotOf(dir, run), shots[1]!)).toBe(true);
    expect(run.run.pages[0]?.screenshot).toMatchObject(fileHash(shots[1]!));
    expect(await problemsIn(dir)).toBe(0);
  });

  it("leaves no screenshot in the record of a page whose next attempt took none", async () => {
    const dir = await setup(["/"]);
    // The first session: the page fails after its picture is taken, and the run stops there.
    const first = new ScriptedDriver(sitePages({ home: { screenshot: { jpeg: TINY_JPEG } } }), {
      hang: (command) => command === "nextLine",
    });
    const stopped = await runAudit(
      options(dir, first, { config: config({ pageAttempts: 1, maxConsecutiveFailures: 1 }) }),
    );
    expect(stopped.outcome).toBe("stopped");
    expect(stopped.run.pages[0]?.screenshot).toMatchObject(fileHash(TINY_JPEG));

    // The next session tries the failed page again, with a driver that takes no screenshots.
    const resumed = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    expect(resumed).toMatchObject({ runId: stopped.runId, outcome: "completed" });
    expect(resumed.run.pages[0]).toMatchObject({ status: "done", attempts: 2 });
    expect(resumed.run.pages[0]).not.toHaveProperty("screenshot");
    // The first session's picture stays with its attempt.
    expect(existsSync(shotOf(dir, resumed))).toBe(false);
    expect(await sameBytes(earlierShotOf(dir, resumed, 1), TINY_JPEG)).toBe(true);
    expect(await problemsIn(dir)).toBe(0);
  });
});
