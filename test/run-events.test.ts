import type * as Fs from "node:fs";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForegroundError, type EventRecorder } from "../src/drivers/types.js";
import type { AttemptRecord, RunEvent } from "../src/model.js";
import { runAudit } from "../src/run/audit.js";
import { copiesInFolder, EVENT_LOG, openEventLog, readEventLog } from "../src/run/events.js";
import { eventLogFile, linkPath } from "../src/run/paths.js";
import { listRuns, readRunJson, writeRunJson } from "../src/run/store.js";
import { fileHash } from "../src/transcripts/write.js";
import { EnvironmentError } from "../src/util/errors.js";
import { sealOf } from "../src/util/hash.js";
import { createMemoryLogger } from "../src/util/log.js";
import { isoLocalMs } from "../src/util/time.js";
import { verifyHome } from "../src/verify.js";
import { config, ISO_MS, options, outDir, setup, SITE, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

// Every write and removal of a file goes through as it did, and is kept, so that a test can make
// one fail: a write that stops partway through a copy, and a removal that can't be done.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync), rmSync: vi.fn(actual.rmSync) };
});

/** An event as it's written, less its time. */
const bare = ({ at: _at, ...event }: RunEvent) => event;

const types = (events: RunEvent[]) => events.map((event) => event.type);

/** Why a `screen-reader-log` event says there is no copy: null for any other event, and for a copy. */
const whyNoCopy = (event: RunEvent | undefined) =>
  event?.type === "screen-reader-log" ? event.reason : null;

/** A run's event log, read back. */
async function eventsOf(dir: string, runId: string) {
  return readEventLog(await readFile(eventLogFile(outDir(dir), runId), "utf8"));
}

/** A driver for sitePages() that interrupts the run as it opens the page whose address ends so. */
function interruptingAt(ending: string, controller: AbortController): ScriptedDriver {
  const driver = new ScriptedDriver(sitePages());
  const openPage = driver.openPage.bind(driver);
  driver.openPage = (url) => {
    if (url.endsWith(ending)) controller.abort();
    return openPage(url);
  };
  return driver;
}

const LOST = "The browser lost the foreground to another window";

/** A line cut short: it starts as an event's does, and nothing ends it. */
const CUT_LINE = '{"at":"2026';

describe("a run's event log", () => {
  it("records a run's events in order", async () => {
    const dir = await setup(["/", "/about"]);
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    expect(result.outcome).toBe("completed");

    const { events, unreadable } = await eventsOf(dir, result.runId);
    expect(unreadable).toBe(0);
    expect(events.map(bare)).toEqual([
      { type: "run-started", session: 1, resumed: false },
      { type: "page-started", page: `${SITE}/`, attempt: 1 },
      { type: "page-finished", page: `${SITE}/`, attempt: 1, status: "done" },
      { type: "page-started", page: `${SITE}/about`, attempt: 1 },
      { type: "page-finished", page: `${SITE}/about`, attempt: 1, status: "done" },
      { type: "run-ended", session: 1, reason: "completed" },
    ]);
    for (const { at } of events) expect(at).toMatch(ISO_MS);
  });

  it("writes each event on a line of its own, with its time first", async () => {
    const dir = await setup(["/"]);
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    const lines = (await readFile(eventLogFile(outDir(dir), result.runId), "utf8")).split("\n");
    // A newline ends every line, so what follows the last one is nothing.
    expect(lines.pop()).toBe("");
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(Object.keys(JSON.parse(line) as object).slice(0, 2)).toEqual(["at", "type"]);
    }
  });

  it("records a retry, and why voicecap restarted", async () => {
    const dir = await setup(["/about"]);
    const lost = new ForegroundError(LOST);
    const driver = new ScriptedDriver(sitePages({ about: { openError: lost, openErrorTimes: 1 } }));
    const logger = createMemoryLogger();
    const result = await runAudit(options(dir, driver, { logger }));
    expect(result.outcome).toBe("completed");
    expect(result.exitCode).toBe(0);

    const { events } = await eventsOf(dir, result.runId);
    expect(types(events)).toEqual([
      "run-started",
      "page-started",
      "page-failed",
      "screen-reader-restarting",
      "page-started",
      "page-finished",
      "run-ended",
    ]);
    const failed = events.findIndex((event) => event.type === "page-failed");
    expect(events.slice(failed, failed + 3).map(bare)).toEqual([
      {
        type: "page-failed",
        page: `${SITE}/about`,
        attempt: 1,
        cause: "foreground",
        message: LOST,
      },
      {
        type: "screen-reader-restarting",
        reason: { kind: "retry", page: `${SITE}/about`, attempt: 2, of: 5 },
      },
      { type: "page-started", page: `${SITE}/about`, attempt: 2 },
    ]);
    expect(bare(events.at(-2)!)).toEqual({
      type: "page-finished",
      page: `${SITE}/about`,
      attempt: 2,
      status: "done",
    });
    // The log line says it in the words it always has.
    expect(logger.text("info")).toContain(
      `Restarting the screen reader and browser (retrying ${SITE}/about: attempt 2 of 5).`,
    );
  });

  it("numbers a page's attempts as its record does, across sessions", async () => {
    const dir = await setup(["/about"]);
    const lost = new ForegroundError(LOST);
    const limits = config({ pageAttempts: 2, maxConsecutiveFailures: 1 });

    // The first session gives up on the page after its 2 attempts, and stops the run.
    const first = await runAudit(
      options(dir, new ScriptedDriver(sitePages({ about: { openError: lost } })), {
        config: limits,
      }),
    );
    expect(first.outcome).toBe("stopped");

    // The next tries the page again: its attempts 3 and 4.
    const logger = createMemoryLogger();
    const second = await runAudit(
      options(
        dir,
        new ScriptedDriver(sitePages({ about: { openError: lost, openErrorTimes: 1 } })),
        { config: limits, logger },
      ),
    );
    expect(second).toMatchObject({ runId: first.runId, outcome: "completed" });
    expect(second.run.pages[0]).toMatchObject({ status: "done", attempts: 4 });

    const about = `${SITE}/about`;
    const failed = (attempt: number) => ({
      type: "page-failed",
      page: about,
      attempt,
      cause: "foreground",
      message: LOST,
    });
    expect((await eventsOf(dir, first.runId)).events.map(bare)).toEqual([
      { type: "run-started", session: 1, resumed: false },
      { type: "page-started", page: about, attempt: 1 },
      failed(1),
      {
        type: "screen-reader-restarting",
        reason: { kind: "retry", page: about, attempt: 2, of: 2 },
      },
      { type: "page-started", page: about, attempt: 2 },
      failed(2),
      { type: "run-ended", session: 1, reason: "environment-failure" },
      { type: "run-started", session: 2, resumed: true },
      { type: "page-started", page: about, attempt: 3 },
      failed(3),
      // Counted as the page's record counts, so this is its attempt 4, the last of this session's.
      {
        type: "screen-reader-restarting",
        reason: { kind: "retry", page: about, attempt: 4, of: 4 },
      },
      { type: "page-started", page: about, attempt: 4 },
      { type: "page-finished", page: about, attempt: 4, status: "done" },
      { type: "run-ended", session: 2, reason: "completed" },
    ]);
    expect(logger.text("info")).toContain(
      `Restarting the screen reader and browser (retrying ${about}: attempt 4 of 4).`,
    );
  });

  it("records the restart every n pages", async () => {
    const dir = await setup();
    const logger = createMemoryLogger();
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        config: config({ restartEvery: 1 }),
        logger,
      }),
    );
    expect(result.outcome).toBe("completed");

    const { events } = await eventsOf(dir, result.runId);
    const restarts = events.filter((event) => event.type === "screen-reader-restarting");
    expect(restarts.map(bare)).toEqual([
      { type: "screen-reader-restarting", reason: { kind: "every", pages: 1 } },
      { type: "screen-reader-restarting", reason: { kind: "every", pages: 1 } },
    ]);
    // Each is between two pages.
    for (const restart of restarts) {
      const at = events.indexOf(restart);
      expect(events[at - 1]?.type).toBe("page-finished");
      expect(events[at + 1]?.type).toBe("page-started");
    }
    expect(logger.text("info")).toContain(
      "Restarting the screen reader and browser (every 1 pages).",
    );
  });

  it("records the restart after a failed page", async () => {
    const dir = await setup(["/about", "/resources"]);
    const lost = new ForegroundError(LOST);
    const driver = new ScriptedDriver(sitePages({ about: { openError: lost } }));
    const logger = createMemoryLogger();
    const result = await runAudit(
      options(dir, driver, { config: config({ pageAttempts: 1 }), logger }),
    );
    expect(result.exitCode).toBe(3);

    const { events } = await eventsOf(dir, result.runId);
    expect(events.map(bare)).toEqual([
      { type: "run-started", session: 1, resumed: false },
      { type: "page-started", page: `${SITE}/about`, attempt: 1 },
      {
        type: "page-failed",
        page: `${SITE}/about`,
        attempt: 1,
        cause: "foreground",
        message: LOST,
      },
      { type: "screen-reader-restarting", reason: { kind: "failed-page" } },
      { type: "page-started", page: `${SITE}/resources`, attempt: 1 },
      { type: "page-finished", page: `${SITE}/resources`, attempt: 1, status: "done" },
      { type: "run-ended", session: 1, reason: "completed" },
    ]);
    expect(logger.text("info")).toContain(
      "Restarting the screen reader and browser (after a failed page).",
    );
  });

  it("records a page the site answered with an error, and a page it skipped", async () => {
    const dir = await setup(["/", "/gone", "/feed"]);
    const driver = new ScriptedDriver([
      ...sitePages().slice(0, 1),
      { url: `${SITE}/gone`, status: 404 },
      { url: `${SITE}/feed`, contentType: "application/rss+xml" },
    ]);
    const result = await runAudit(options(dir, driver));
    expect(result.exitCode).toBe(3);

    const { events } = await eventsOf(dir, result.runId);
    expect(events.slice(3, 7).map(bare)).toEqual([
      { type: "page-started", page: `${SITE}/gone`, attempt: 1 },
      { type: "page-failed", page: `${SITE}/gone`, attempt: 1, cause: "http", message: "HTTP 404" },
      { type: "page-started", page: `${SITE}/feed`, attempt: 1 },
      { type: "page-finished", page: `${SITE}/feed`, attempt: 1, status: "skipped" },
    ]);
  });

  it("ends the log with how the session ended", async () => {
    // Interrupted, with pages left to do.
    const dir = await setup(["/", "/about"]);
    const controller = new AbortController();
    const interrupted = await runAudit(
      options(dir, interruptingAt("/about", controller), { signal: controller.signal }),
    );
    expect((await eventsOf(dir, interrupted.runId)).events.at(-1)).toMatchObject({
      type: "run-ended",
      session: 1,
      reason: "interrupted",
    });

    // Stopped, as the screen reader or the browser seems unusable.
    const stoppedDir = await setup(["/about", "/resources"]);
    const lost = new ForegroundError(LOST);
    const stopped = await runAudit(
      options(stoppedDir, new ScriptedDriver(sitePages({ about: { openError: lost } })), {
        config: config({ pageAttempts: 1, maxConsecutiveFailures: 1 }),
      }),
    );
    expect(stopped.outcome).toBe("stopped");
    expect((await eventsOf(stoppedDir, stopped.runId)).events.at(-1)).toMatchObject({
      type: "run-ended",
      reason: "environment-failure",
    });

    // An error nobody expected, which is thrown on once the log has its last line.
    const brokenDir = await setup(["/"]);
    const broken = new ScriptedDriver(sitePages());
    broken.getEnvironmentInfo = () => Promise.reject(new Error("The driver broke."));
    await expect(runAudit(options(brokenDir, broken))).rejects.toThrow("The driver broke.");
    const [run] = await listRuns(outDir(brokenDir));
    expect((await eventsOf(brokenDir, run!.id)).events.map(bare)).toEqual([
      { type: "run-started", session: 1, resumed: false },
      { type: "run-ended", session: 1, reason: "error" },
    ]);
  });

  it("seals the event log with the run", async () => {
    const dir = await setup(["/", "/about"]);
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    expect(result.outcome).toBe("completed");

    const run = await readRunJson(outDir(dir), result.runId);
    const log = await readFile(eventLogFile(outDir(dir), result.runId));
    expect(run.files?.[EVENT_LOG]).toEqual(fileHash(log));
    expect(run.seal).toBe(sealOf(run));
    // Nothing was written after the log was hashed: its last line is the session's end.
    expect((await eventsOf(dir, result.runId)).events.at(-1)?.type).toBe("run-ended");

    const home = path.join(dir, "transcripts");
    expect((await verifyHome({ home, logger: createMemoryLogger() })).problems).toBe(0);
  });

  it("keeps a resumed run's events after a line cut short", async () => {
    const dir = await setup();
    const controller = new AbortController();
    const first = await runAudit(
      options(dir, interruptingAt("/about", controller), { signal: controller.signal }),
    );
    expect(first.outcome).toBe("interrupted");

    // A window closed as a line was being written.
    const log = eventLogFile(outDir(dir), first.runId);
    await appendFile(log, CUT_LINE);

    const second = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    expect(second).toMatchObject({ runId: first.runId, outcome: "completed" });

    const { events, unreadable } = readEventLog(await readFile(log, "utf8"));
    expect(unreadable).toBe(1);
    expect(types(events)).toEqual([
      // The first session, interrupted as it opened the second page.
      "run-started",
      "page-started",
      "page-finished",
      "page-started",
      "run-ended",
      // The second.
      "run-started",
      "page-started",
      "page-finished",
      "page-started",
      "page-finished",
      "run-ended",
    ]);
    expect(events.filter((event) => event.type === "run-started").map(bare)).toEqual([
      { type: "run-started", session: 1, resumed: false },
      { type: "run-started", session: 2, resumed: true },
    ]);
    // The cut line is left as it is, and the next line starts on a line of its own: each other
    // line is an event, and the last one ends in the newline that ends the file. (The events'
    // times come from the real clock, so nothing here goes by what they say.)
    const lines = (await readFile(log, "utf8")).split("\n");
    expect(lines.pop()).toBe("");
    expect(lines).toContain(CUT_LINE);
    expect(lines.filter((line) => line !== CUT_LINE)).toHaveLength(events.length);

    const home = path.join(dir, "transcripts");
    expect((await verifyHome({ home, logger: createMemoryLogger() })).problems).toBe(0);
  });

  it("never stops a run when its log can't be written", async () => {
    const dir = await setup(["/", "/about"]);
    const controller = new AbortController();
    controller.abort();
    const first = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), { signal: controller.signal }),
    );
    expect(first.outcome).toBe("interrupted");

    // A folder where the log goes: nothing can be written there.
    const log = eventLogFile(outDir(dir), first.runId);
    await rm(log);
    await mkdir(log);

    const logger = createMemoryLogger();
    const second = await runAudit(options(dir, new ScriptedDriver(sitePages()), { logger }));
    expect(second).toMatchObject({ runId: first.runId, outcome: "completed", exitCode: 0 });
    const warnings = logger.entries
      .filter((entry) => entry.level === "warn")
      .map((entry) => entry.message);
    expect(warnings).toEqual([expect.stringMatching(/^The event log couldn't be written: .+\.$/)]);
  });

  it("gives the driver the recorder before it starts", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages());
    expect(driver.recorder).toBeNull();

    // What the driver holds as each of its first calls begins. Its start reports an event through it.
    const held: [string, EventRecorder | null][] = [];
    const cleanupStale = driver.cleanupStale.bind(driver);
    driver.cleanupStale = () => {
      held.push(["cleanupStale", driver.recorder]);
      return cleanupStale();
    };
    const start = driver.start.bind(driver);
    driver.start = () => {
      held.push(["start", driver.recorder]);
      driver.recorder?.record({ type: "screen-reader-started", pid: 4242 });
      return start();
    };

    const result = await runAudit(options(dir, driver));
    expect(held.map(([call, recorder]) => [call, recorder !== null])).toEqual([
      ["cleanupStale", true],
      ["start", true],
    ]);
    // It's the run's own log: the event is in it, after the run's start and before its pages.
    const { events } = await eventsOf(dir, result.runId);
    expect(events.map(bare).slice(0, 3)).toEqual([
      { type: "run-started", session: 1, resumed: false },
      { type: "screen-reader-started", pid: 4242 },
      { type: "page-started", page: `${SITE}/`, attempt: 1 },
    ]);
  });

  it("runs a driver that has no recorder to give, and records the run all the same", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages());
    // As a driver written before the event log is: it has no setEventRecorder.
    (driver as { setEventRecorder?: unknown }).setEventRecorder = undefined;
    const result = await runAudit(options(dir, driver));
    expect(result.outcome).toBe("completed");
    expect(driver.recorder).toBeNull();
    expect(types((await eventsOf(dir, result.runId)).events)).toEqual([
      "run-started",
      "page-started",
      "page-finished",
      "run-ended",
    ]);
  });
});

// A driver that runs a screen reader with a log of its own hands the run a cleaned copy each time
// the screen reader quits (EventRecorder.screenReaderLog). The run keeps each in its folder, names it
// in the event log, and records it in run.json's files, so the seal covers it and verify checks it.
describe("a run's copies of NVDA's log", () => {
  const LOG =
    "# A cleaned copy of NVDA's log.\n" +
    "IO - speech.speech.speak (09:00:02.100) - MainThread (4100):\n" +
    "Speaking ['Welcome ©']\n";

  /**
   * Has the driver hand the run a copy of NVDA's log whenever it's stopped, as the NVDA driver does
   * as NVDA quits: `copy` is given the number of the stop, counting from 1.
   */
  function keepingLog<T extends ScriptedDriver>(driver: T, copy: (stop: number) => string): T {
    const stop = driver.stop.bind(driver);
    driver.stop = (stopOptions) => {
      driver.recorder?.screenReaderLog?.(copy(driver.stops + 1));
      return stop(stopOptions);
    };
    return driver;
  }

  /** A run's folder: where its event log is. */
  const folderOf = (dir: string, runId: string) => path.dirname(eventLogFile(outDir(dir), runId));

  it("keeps the copy in the run's folder, names it in the event log, and seals it with the run", async () => {
    const dir = await setup(["/", "/about"]);
    const driver = keepingLog(new ScriptedDriver(sitePages()), () => LOG);
    const result = await runAudit(options(dir, driver));
    expect(result.outcome).toBe("completed");

    expect(
      await readFile(path.join(folderOf(dir, result.runId), "nvda-log", "1-1.txt"), "utf8"),
    ).toBe(LOG);
    // The log names it as the driver stops, after the pages and before the session ends.
    const { events, unreadable } = await eventsOf(dir, result.runId);
    expect(unreadable).toBe(0);
    expect(types(events)).toEqual([
      "run-started",
      "page-started",
      "page-finished",
      "page-started",
      "page-finished",
      "screen-reader-log",
      "run-ended",
    ]);
    expect(bare(events.at(-2)!)).toEqual({
      type: "screen-reader-log",
      file: "nvda-log/1-1.txt",
      reason: null,
    });
    for (const { at } of events) expect(at).toMatch(ISO_MS);

    // The run lists it beside its event log, with its size and SHA-256, and its seal covers both.
    const run = await readRunJson(outDir(dir), result.runId);
    expect(Object.keys(run.files ?? {})).toEqual([EVENT_LOG, "nvda-log/1-1.txt"]);
    expect(run.files?.["nvda-log/1-1.txt"]).toEqual(fileHash(LOG));
    expect(run.seal).toBe(sealOf(run));
    const { "nvda-log/1-1.txt": _copy, ...listedWithout } = run.files ?? {};
    expect(sealOf({ ...run, files: listedWithout })).not.toBe(run.seal);

    const home = path.join(dir, "transcripts");
    expect((await verifyHome({ home, logger: createMemoryLogger() })).problems).toBe(0);
  });

  it("keeps a copy for each time the screen reader quit, restarts included, in order", async () => {
    const dir = await setup();
    const driver = keepingLog(new ScriptedDriver(sitePages()), (stop) => `copy ${stop}\n`);
    const result = await runAudit(options(dir, driver, { config: config({ restartEvery: 1 }) }));
    expect(result.outcome).toBe("completed");
    // Two restarts, between the pages, and the final stop.
    expect(driver.stopOptions).toEqual([{ restarting: true }, { restarting: true }, undefined]);

    const folder = path.join(folderOf(dir, result.runId), "nvda-log");
    for (const n of [1, 2, 3]) {
      expect(await readFile(path.join(folder, `1-${n}.txt`), "utf8")).toBe(`copy ${n}\n`);
    }
    const { events } = await eventsOf(dir, result.runId);
    expect(events.filter((event) => event.type === "screen-reader-log").map(bare)).toEqual([
      { type: "screen-reader-log", file: "nvda-log/1-1.txt", reason: null },
      { type: "screen-reader-log", file: "nvda-log/1-2.txt", reason: null },
      { type: "screen-reader-log", file: "nvda-log/1-3.txt", reason: null },
    ]);
    // Each restart's copy is made as the screen reader stops for it, before the next page.
    const copyAt = (n: number) =>
      events.findIndex(
        (event) => event.type === "screen-reader-log" && event.file === `nvda-log/1-${n}.txt`,
      );
    expect(events[copyAt(1) - 1]?.type).toBe("screen-reader-restarting");
    expect(events[copyAt(1) + 1]?.type).toBe("page-started");
    expect(events[copyAt(3) + 1]?.type).toBe("run-ended");

    const run = await readRunJson(outDir(dir), result.runId);
    expect(Object.keys(run.files ?? {})).toEqual([
      EVENT_LOG,
      "nvda-log/1-1.txt",
      "nvda-log/1-2.txt",
      "nvda-log/1-3.txt",
    ]);
    for (const n of [1, 2, 3]) {
      expect(run.files?.[`nvda-log/1-${n}.txt`]).toEqual(fileHash(`copy ${n}\n`));
    }
    const home = path.join(dir, "transcripts");
    expect((await verifyHome({ home, logger: createMemoryLogger() })).problems).toBe(0);
  });

  it("numbers a resumed run's copies by its session, so its second session writes nvda-log/2-1.txt", async () => {
    const dir = await setup(["/", "/about"]);
    const controller = new AbortController();
    const first = await runAudit(
      options(
        dir,
        keepingLog(interruptingAt("/about", controller), () => "first session\n"),
        { signal: controller.signal },
      ),
    );
    expect(first.outcome).toBe("interrupted");
    // The first session's copy is recorded as it ends, before the run is complete.
    expect(Object.keys((await readRunJson(outDir(dir), first.runId)).files ?? {})).toEqual([
      EVENT_LOG,
      "nvda-log/1-1.txt",
    ]);

    const second = await runAudit(
      options(
        dir,
        keepingLog(new ScriptedDriver(sitePages()), () => "second session\n"),
      ),
    );
    expect(second).toMatchObject({ runId: first.runId, outcome: "completed" });

    const folder = path.join(folderOf(dir, first.runId), "nvda-log");
    expect(await readFile(path.join(folder, "1-1.txt"), "utf8")).toBe("first session\n");
    expect(await readFile(path.join(folder, "2-1.txt"), "utf8")).toBe("second session\n");
    const { events } = await eventsOf(dir, first.runId);
    expect(events.filter((event) => event.type === "screen-reader-log").map(bare)).toEqual([
      { type: "screen-reader-log", file: "nvda-log/1-1.txt", reason: null },
      { type: "screen-reader-log", file: "nvda-log/2-1.txt", reason: null },
    ]);

    // Both are in the sealed record: the first session's, kept as it was, and the second's.
    const run = await readRunJson(outDir(dir), first.runId);
    expect(Object.keys(run.files ?? {})).toEqual([
      EVENT_LOG,
      "nvda-log/1-1.txt",
      "nvda-log/2-1.txt",
    ]);
    expect(run.files?.["nvda-log/1-1.txt"]).toEqual(fileHash("first session\n"));
    expect(run.files?.["nvda-log/2-1.txt"]).toEqual(fileHash("second session\n"));
    expect(run.seal).toBe(sealOf(run));
    // The copies' session numbers are the session records' own.
    expect(run.sessions.map((session) => session.n)).toEqual([1, 2]);
    const home = path.join(dir, "transcripts");
    expect((await verifyHome({ home, logger: createMemoryLogger() })).problems).toBe(0);
  });

  // A session that's killed (a crash, its window closed, the power gone) never reaches its end, which
  // is what lists its copies in run.json. The event log is hashed whole by every session's end, so a
  // later session covers it. The copies must be covered the same way, or a run that a later session
  // completes fails verify for evidence nothing was wrong with.
  describe("when a session never reached its end", () => {
    /** A run's first session, interrupted after a restart and a final stop: copies 1-1 and 1-2. */
    async function killedFirstSession(dir: string) {
      const controller = new AbortController();
      const first = await runAudit(
        options(
          dir,
          keepingLog(
            interruptingAt("/about", controller),
            (stop) => `first session, copy ${stop}\n`,
          ),
          { signal: controller.signal, config: config({ restartEvery: 1 }) },
        ),
      );
      expect(first.outcome).toBe("interrupted");
      // What a killed session leaves: its copies on disk, and a run.json that lists no file, as
      // the session's end never ran to set them.
      const killed = await readRunJson(outDir(dir), first.runId);
      expect(Object.keys(killed.files ?? {})).toEqual([
        EVENT_LOG,
        "nvda-log/1-1.txt",
        "nvda-log/1-2.txt",
      ]);
      delete killed.files;
      await writeRunJson(outDir(dir), killed);
      return first;
    }

    const verifyProblems = async (dir: string) =>
      (await verifyHome({ home: path.join(dir, "transcripts"), logger: createMemoryLogger() }))
        .sites[0]!.problems;

    it("lists the copies it kept, with the copies of the session that completes the run", async () => {
      const dir = await setup(["/", "/about"]);
      const first = await killedFirstSession(dir);

      const second = await runAudit(
        options(
          dir,
          keepingLog(new ScriptedDriver(sitePages()), () => "second session\n"),
        ),
      );
      expect(second).toMatchObject({ runId: first.runId, outcome: "completed" });

      const run = await readRunJson(outDir(dir), first.runId);
      expect(Object.keys(run.files ?? {})).toEqual([
        EVENT_LOG,
        "nvda-log/1-1.txt",
        "nvda-log/1-2.txt",
        "nvda-log/2-1.txt",
      ]);
      expect(run.files?.["nvda-log/1-1.txt"]).toEqual(fileHash("first session, copy 1\n"));
      expect(run.files?.["nvda-log/1-2.txt"]).toEqual(fileHash("first session, copy 2\n"));
      expect(run.files?.["nvda-log/2-1.txt"]).toEqual(fileHash("second session\n"));
      // The seal covers them, and verify finds nothing wrong.
      expect(run.seal).toBe(sealOf(run));
      expect(await verifyProblems(dir)).toEqual([]);
    });

    it("leaves a copy it already lists as it recorded it, so an edit made since is still caught", async () => {
      const dir = await setup(["/", "/about"]);
      const controller = new AbortController();
      const first = await runAudit(
        options(
          dir,
          keepingLog(interruptingAt("/about", controller), () => "first session\n"),
          {
            signal: controller.signal,
          },
        ),
      );
      expect(first.outcome).toBe("interrupted");
      // This session did reach its end: its copy is listed. Someone edits it before the next.
      const copy = path.join(folderOf(dir, first.runId), "nvda-log", "1-1.txt");
      await appendFile(copy, "An added line\n");

      const second = await runAudit(
        options(
          dir,
          keepingLog(new ScriptedDriver(sitePages()), () => "second session\n"),
        ),
      );
      expect(second).toMatchObject({ runId: first.runId, outcome: "completed" });

      const run = await readRunJson(outDir(dir), first.runId);
      expect(run.files?.["nvda-log/1-1.txt"]).toEqual(fileHash("first session\n"));
      const home = path.join(dir, "transcripts");
      expect(await verifyProblems(dir)).toEqual([
        `${linkPath(home, copy)}: changed since it was recorded (SHA-256 differs)`,
      ]);
    });

    it("leaves anything else in the folder unlisted, for verify to name", async () => {
      const dir = await setup(["/", "/about"]);
      const first = await killedFirstSession(dir);
      // What isn't a copy of this run's own sessions: another name, another extension, a number
      // above the session's, and numbers voicecap never writes (it counts from 1, in plain digits).
      const strays = [
        "notes.txt",
        "1-1.txt.bak",
        "1-3.log",
        "x-1.txt",
        "1-x.txt",
        "3-1.txt",
        "01-1.txt",
        "1-02.txt",
        "0-1.txt",
        "1-0.txt",
      ];
      const second = keepingLog(new ScriptedDriver(sitePages()), () => "second session\n");
      const stop = second.stop.bind(second);
      second.stop = async (stopOptions) => {
        await stop(stopOptions);
        for (const name of strays) {
          await writeFile(path.join(folderOf(dir, first.runId), "nvda-log", name), "left here\n");
        }
      };
      const result = await runAudit(options(dir, second));
      expect(result).toMatchObject({ runId: first.runId, outcome: "completed" });

      // The first session's copies and the second's are listed; no stray is.
      const run = await readRunJson(outDir(dir), first.runId);
      expect(Object.keys(run.files ?? {})).toEqual([
        EVENT_LOG,
        "nvda-log/1-1.txt",
        "nvda-log/1-2.txt",
        "nvda-log/2-1.txt",
      ]);
      const home = path.join(dir, "transcripts");
      const shown = linkPath(home, path.join(folderOf(dir, first.runId), "nvda-log"));
      expect(await verifyProblems(dir)).toEqual(
        strays.map((name) => `${shown}/${name}: not recorded by the run`).sort(),
      );
    });
  });

  it("keeps no folder, and lists nothing, for a driver that hands over no copy", async () => {
    const dir = await setup(["/"]);
    const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
    expect(result.outcome).toBe("completed");
    const run = await readRunJson(outDir(dir), result.runId);
    expect(Object.keys(run.files ?? {})).toEqual([EVENT_LOG]);
    expect(types((await eventsOf(dir, result.runId)).events)).not.toContain("screen-reader-log");
    await expect(readFile(path.join(folderOf(dir, result.runId), "nvda-log"))).rejects.toThrow(
      /ENOENT/,
    );
  });

  it("records a copy it couldn't write as none, with why, and the run goes on", async () => {
    const dir = await setup(["/", "/about"]);
    const driver = keepingLog(new ScriptedDriver(sitePages()), () => LOG);
    // Something that isn't a folder takes the folder's place, once the run's folder is there.
    const start = driver.start.bind(driver);
    driver.start = async () => {
      const [run] = await listRuns(outDir(dir));
      await writeFile(path.join(folderOf(dir, run!.id), "nvda-log"), "in the way");
      return start();
    };
    const result = await runAudit(options(dir, driver));
    expect(result).toMatchObject({ outcome: "completed", exitCode: 0 });

    const { events } = await eventsOf(dir, result.runId);
    const [none, ...others] = events.filter((event) => event.type === "screen-reader-log");
    expect(others).toEqual([]);
    expect(none).toMatchObject({ type: "screen-reader-log", file: null });
    expect(whyNoCopy(none)).toMatch(/^E[A-Z]+: /);
    // Nothing is listed for it: no file was kept.
    const run = await readRunJson(outDir(dir), result.runId);
    expect(Object.keys(run.files ?? {})).toEqual([EVENT_LOG]);
    expect(run.seal).toBe(sealOf(run));
  });
});

// The driver names the program that took the screen in the log (as foreground-lost) and on the
// error it throws. The run keeps the name, and only the name, in the record of the failed attempt.
describe("the program that took the screen, in a failed attempt's record", () => {
  /** A driver whose first Down Arrow fails with `error`, and no other step does. */
  function failingOnce(error: Error): ScriptedDriver {
    let lines = 0;
    return new ScriptedDriver(sitePages(), {
      fail: (command) => (command === "nextLine" && ++lines === 1 ? error : null),
    });
  }

  /** What run.json keeps of the one attempt at the run's one page that failed. */
  async function kept(dir: string, runId: string): Promise<AttemptRecord> {
    const attempts = (await readRunJson(outDir(dir), runId)).pages[0]?.failedAttempts;
    expect(attempts).toHaveLength(1);
    return attempts![0]!;
  }

  it("keeps the program a step lost the foreground to", async () => {
    const dir = await setup(["/about"]);
    const taken = new ForegroundError(LOST, { program: "Microsoft Teams" });
    const result = await runAudit(options(dir, failingOnce(taken)));
    expect(result.outcome).toBe("completed");
    expect(await kept(dir, result.runId)).toMatchObject({
      n: 1,
      pass: "read",
      command: "nextLine",
      cause: "foreground",
      message: LOST,
      program: "Microsoft Teams",
    });
  });

  it("keeps the program a page that couldn't be opened lost the foreground to", async () => {
    const dir = await setup(["/about"]);
    const taken = new ForegroundError(LOST, { program: "Microsoft Teams" });
    const driver = new ScriptedDriver(
      sitePages({ about: { openError: taken, openErrorTimes: 1 } }),
    );
    const result = await runAudit(options(dir, driver));
    expect(result.outcome).toBe("completed");
    expect(await kept(dir, result.runId)).toMatchObject({
      n: 1,
      command: "openPage",
      cause: "foreground",
      program: "Microsoft Teams",
    });
  });

  it("keeps null when Windows didn't say which program it was", async () => {
    const dir = await setup(["/about"]);
    const result = await runAudit(
      options(dir, failingOnce(new ForegroundError(LOST, { program: null }))),
    );
    const attempt = await kept(dir, result.runId);
    expect(attempt).toMatchObject({ cause: "foreground", program: null });
  });

  it("keeps no program for a lost foreground that no program was looked up for", async () => {
    const dir = await setup(["/about"]);
    const result = await runAudit(options(dir, failingOnce(new ForegroundError(LOST))));
    const attempt = await kept(dir, result.runId);
    expect(attempt).toMatchObject({ cause: "foreground" });
    expect(attempt).not.toHaveProperty("program");
    // Nor in the run's record in memory, though JSON would write it without a program anyway.
    expect(result.run.pages[0]?.failedAttempts?.[0]).not.toHaveProperty("program");
  });

  it("keeps no program for a failure of another kind", async () => {
    const failures = [
      new EnvironmentError("Windows is locked.", { failure: "locked" }),
      new Error("NVDA went away"),
      // Not a ForegroundError, whatever it carries.
      Object.assign(new Error(LOST), { failure: "foreground", program: "Microsoft Teams" }),
    ];
    for (const error of failures) {
      const dir = await setup(["/about"]);
      const result = await runAudit(options(dir, failingOnce(error)));
      const attempt = await kept(dir, result.runId);
      expect(attempt, error.message).not.toHaveProperty("program");
      expect(result.run.pages[0]?.failedAttempts?.[0], error.message).not.toHaveProperty("program");
    }
  });
});

describe("openEventLog", () => {
  const NOW = new Date(2026, 8, 27, 11, 2, 3, 456);
  const STAMP = isoLocalMs(NOW);
  const LOCKED = `{"at":"${STAMP}","type":"computer-locked"}\n`;

  async function logFile(): Promise<string> {
    return path.join(await mkdtemp(path.join(os.tmpdir(), "voicecap-events-")), EVENT_LOG);
  }

  it("writes each event as a line, with its time first", async () => {
    const file = await logFile();
    const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger(), session: 1 });
    log.record({ type: "run-started", session: 1, resumed: false });
    log.record({ type: "browser-launched", pid: null });
    expect(readFileSync(file, "utf8")).toBe(
      `{"at":"${STAMP}","type":"run-started","session":1,"resumed":false}\n` +
        `{"at":"${STAMP}","type":"browser-launched","pid":null}\n`,
    );
  });

  it("stamps each event as it's recorded", async () => {
    const file = await logFile();
    let ms = 0;
    const log = openEventLog(file, {
      now: () => new Date(2026, 8, 27, 11, 2, 3, ms++),
      logger: createMemoryLogger(),
      session: 1,
    });
    log.record({ type: "computer-locked" });
    log.record({ type: "computer-locked" });
    expect(readEventLog(readFileSync(file, "utf8")).events.map((event) => event.at)).toEqual([
      isoLocalMs(new Date(2026, 8, 27, 11, 2, 3, 0)),
      isoLocalMs(new Date(2026, 8, 27, 11, 2, 3, 1)),
    ]);
  });

  it("stamps an event with the moment it happened, when it's given one, and keeps the lines in the order recorded", async () => {
    const file = await logFile();
    const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger(), session: 1 });
    const earlier = new Date(2026, 8, 27, 11, 1, 59, 7);
    log.record({ type: "screen-reader-lock-taken" });
    // Recorded after the lock, but it happened two seconds before.
    log.record({ type: "own-screen-reader-closed", pids: [4321] }, earlier);
    log.record({ type: "computer-locked" });

    expect(readFileSync(file, "utf8")).toBe(
      `{"at":"${STAMP}","type":"screen-reader-lock-taken"}\n` +
        `{"at":"${isoLocalMs(earlier)}","type":"own-screen-reader-closed","pids":[4321]}\n` +
        LOCKED,
    );
  });

  it("stamps an event with now when the moment it's given isn't one", async () => {
    const file = await logFile();
    const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger(), session: 1 });
    log.record({ type: "computer-locked" }, new Date(Number.NaN));

    expect(readFileSync(file, "utf8")).toBe(LOCKED);
  });

  it("makes no file until there's an event to write", async () => {
    const file = await logFile();
    openEventLog(file, { now: () => NOW, logger: createMemoryLogger(), session: 1 });
    expect(() => readFileSync(file)).toThrow(/ENOENT/);
  });

  it("adds to a log that's there, with no blank line between", async () => {
    const file = await logFile();
    await writeFile(file, "kept\n");
    const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger(), session: 1 });
    log.record({ type: "computer-locked" });
    expect(readFileSync(file, "utf8")).toBe(`kept\n${LOCKED}`);
  });

  it("starts its first line on a new line when the log ends with a line cut short", async () => {
    const file = await logFile();
    await writeFile(file, 'kept\n{"at":"2026-09-27T11:0');
    const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger(), session: 1 });
    log.record({ type: "computer-locked" });
    log.record({ type: "computer-locked" });
    // Only the first needs it: the second follows the newline the first ended with.
    expect(readFileSync(file, "utf8")).toBe(`kept\n{"at":"2026-09-27T11:0\n${LOCKED}${LOCKED}`);
  });

  it("writes nothing after it's closed", async () => {
    const file = await logFile();
    const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger(), session: 1 });
    log.record({ type: "computer-locked" });
    log.close();
    log.record({ type: "computer-locked" });
    expect(readFileSync(file, "utf8")).toBe(LOCKED);

    // A log closed before it wrote anything makes no file.
    const never = await logFile();
    const closed = openEventLog(never, {
      now: () => NOW,
      logger: createMemoryLogger(),
      session: 1,
    });
    closed.close();
    closed.record({ type: "computer-locked" });
    expect(() => readFileSync(never)).toThrow(/ENOENT/);
  });

  it("warns once when it can't write, and never throws", async () => {
    const file = await logFile();
    // A folder where the file goes.
    await mkdir(file);
    const logger = createMemoryLogger();
    const log = openEventLog(file, { now: () => NOW, logger, session: 1 });
    for (let i = 0; i < 3; i++) log.record({ type: "computer-locked" });
    log.close();
    expect(logger.entries.map((entry) => entry.level)).toEqual(["warn"]);
    expect(logger.entries[0]?.message).toMatch(/^The event log couldn't be written: .+\.$/);
  });

  it("starts a new line after a write that failed, which may have left a line cut short", async () => {
    const file = await logFile();
    const logger = createMemoryLogger();
    const log = openEventLog(file, { now: () => NOW, logger, session: 1 });
    log.record({ type: "computer-locked" });
    // A write that fails: a folder takes the file's place.
    await rm(file);
    await mkdir(file);
    log.record({ type: "computer-locked" });
    // What a write that fails halfway leaves: a line cut short.
    await rm(file, { recursive: true });
    await writeFile(file, '{"at":"2026-09-27T11:0');
    log.record({ type: "browser-handed-over" });
    expect(readFileSync(file, "utf8")).toBe(
      `{"at":"2026-09-27T11:0\n{"at":"${STAMP}","type":"browser-handed-over"}\n`,
    );
    expect(logger.entries).toHaveLength(1);
  });

  it("writes again once it can, and doesn't warn again", async () => {
    const file = await logFile();
    const folder = path.dirname(file);
    await rm(folder, { recursive: true });
    const logger = createMemoryLogger();
    const log = openEventLog(file, { now: () => NOW, logger, session: 1 });
    // The folder isn't there yet.
    log.record({ type: "computer-locked" });
    await mkdir(folder);
    log.record({ type: "browser-handed-over" });
    log.record({ type: "browser-handed-over" });
    const handed = `{"at":"${STAMP}","type":"browser-handed-over"}\n`;
    expect(readFileSync(file, "utf8")).toBe(`${handed}${handed}`);
    expect(logger.entries).toHaveLength(1);
  });

  // The copies of a screen reader's own log, which the driver hands over as each session ends.
  describe("a copy of the screen reader's log", () => {
    const copy = (n: number) => `nvda-log/2-${n}.txt`;
    const NAMED = (n: number) =>
      `{"at":"${STAMP}","type":"screen-reader-log","file":"${copy(n)}","reason":null}\n`;

    it("is written as nvda-log/<session>-<n>.txt in the log's folder, counting from 1", async () => {
      const file = await logFile();
      const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger(), session: 2 });
      log.screenReaderLog("first ©\r\nsecond\n");
      log.screenReaderLog("another\n");
      const folder = path.join(path.dirname(file), "nvda-log");
      // Its text as it's given, written as UTF-8.
      expect(readFileSync(path.join(folder, "2-1.txt"), "utf8")).toBe("first ©\r\nsecond\n");
      expect(readFileSync(path.join(folder, "2-2.txt"), "utf8")).toBe("another\n");
      expect(readdirSync(folder).sort()).toEqual(["2-1.txt", "2-2.txt"]);
    });

    it("is recorded with the file's path from the run's folder, and no reason", async () => {
      const file = await logFile();
      const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger(), session: 2 });
      log.record({ type: "computer-locked" });
      log.screenReaderLog("first\n");
      log.screenReaderLog("second\n");
      expect(readFileSync(file, "utf8")).toBe(`${LOCKED}${NAMED(1)}${NAMED(2)}`);
    });

    it("is remembered, by the path it was recorded with, in the order it was kept", async () => {
      const file = await logFile();
      const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger(), session: 2 });
      expect(log.copies()).toEqual([]);
      log.screenReaderLog("first\n");
      log.screenReaderLog("second\n");
      expect(log.copies()).toEqual([copy(1), copy(2)]);
      // What it gives is a list of its own: changing it changes nothing here.
      log.copies().push("nvda-log/other.txt");
      expect(log.copies()).toEqual([copy(1), copy(2)]);
    });

    it("counts from 1 for each log it opens, and names its copies by its own session", async () => {
      const file = await logFile();
      const options = { now: () => NOW, logger: createMemoryLogger() };
      // A session's log opened for the run's next session counts again, and names its own.
      const first = openEventLog(file, { ...options, session: 1 });
      first.screenReaderLog("session 1\n");
      first.close();
      const second = openEventLog(file, { ...options, session: 2 });
      second.screenReaderLog("session 2\n");
      expect(second.copies()).toEqual([copy(1)]);
      expect(readdirSync(path.join(path.dirname(file), "nvda-log")).sort()).toEqual([
        "1-1.txt",
        "2-1.txt",
      ]);
    });

    it("is recorded as none, with why, and never throws, when it can't be written", async () => {
      const file = await logFile();
      const folder = path.join(path.dirname(file), "nvda-log");
      // Something that isn't a folder where the folder goes.
      await writeFile(folder, "in the way");
      const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger(), session: 2 });
      expect(() => log.screenReaderLog("first\n")).not.toThrow();
      expect(log.copies()).toEqual([]);
      const { events, unreadable } = readEventLog(readFileSync(file, "utf8"));
      expect(unreadable).toBe(0);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "screen-reader-log", file: null });
      expect(whyNoCopy(events[0])).toMatch(/^E[A-Z]+: /);
    });

    // A write that fails partway (a disk that fills) can leave part of a copy. It isn't one: the
    // record says none was kept, so none should be there for verify to call unrecorded.
    describe("that can't be written whole", () => {
      // Going through as they did, with no call counted: before each test, and after it, so that
      // what one left unused (a failure it never reached) never reaches another.
      const restore = () => {
        vi.mocked(writeFileSync).mockReset();
        vi.mocked(rmSync).mockReset();
      };
      beforeEach(restore);
      afterEach(restore);

      const NO_SPACE = () =>
        Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });

      it("is taken away, with whatever part of it was written, so the folder matches the record", async () => {
        const file = await logFile();
        const folder = path.join(path.dirname(file), "nvda-log");
        const real = await vi.importActual<typeof Fs>("node:fs");
        // The disk fills as the copy is written: the first of it lands, and the write fails.
        vi.mocked(writeFileSync).mockImplementationOnce((target, data, writeOptions) => {
          real.writeFileSync(
            target,
            typeof data === "string" ? data.slice(0, 4) : "",
            writeOptions,
          );
          throw NO_SPACE();
        });
        const log = openEventLog(file, {
          now: () => NOW,
          logger: createMemoryLogger(),
          session: 2,
        });
        expect(() => log.screenReaderLog("a whole copy\n")).not.toThrow();

        expect(log.copies()).toEqual([]);
        expect(readdirSync(folder)).toEqual([]);
        expect(rmSync).toHaveBeenCalledWith(path.join(folder, "2-1.txt"), { force: true });
        // The event says no copy was kept, and why.
        const [event] = readEventLog(readFileSync(file, "utf8")).events;
        expect(event).toMatchObject({ type: "screen-reader-log", file: null });
        expect(whyNoCopy(event)).toMatch(/^ENOSPC: /);
      });

      it("goes on, with the write's reason, when what was left can't be taken away either", async () => {
        const file = await logFile();
        vi.mocked(writeFileSync).mockImplementationOnce(() => {
          throw NO_SPACE();
        });
        vi.mocked(rmSync).mockImplementationOnce(() => {
          throw Object.assign(new Error("EBUSY: resource busy or locked, unlink"), {
            code: "EBUSY",
          });
        });
        const log = openEventLog(file, {
          now: () => NOW,
          logger: createMemoryLogger(),
          session: 2,
        });
        expect(() => log.screenReaderLog("a whole copy\n")).not.toThrow();

        expect(log.copies()).toEqual([]);
        // Why no copy was kept is why the write failed, not why the removal did.
        const { events, unreadable } = readEventLog(readFileSync(file, "utf8"));
        expect(unreadable).toBe(0);
        expect(events).toHaveLength(1);
        expect(whyNoCopy(events[0])).toMatch(/^ENOSPC: /);
      });

      it("is never tried for a copy that was kept", async () => {
        const file = await logFile();
        const log = openEventLog(file, {
          now: () => NOW,
          logger: createMemoryLogger(),
          session: 2,
        });
        log.screenReaderLog("a whole copy\n");
        expect(rmSync).not.toHaveBeenCalled();
        expect(log.copies()).toEqual([copy(1)]);
      });
    });

    it("doesn't reuse a name after one it couldn't write, so each name is its session's nth copy", async () => {
      const file = await logFile();
      const folder = path.join(path.dirname(file), "nvda-log");
      await writeFile(folder, "in the way");
      const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger(), session: 2 });
      log.screenReaderLog("lost\n");
      await rm(folder);
      log.screenReaderLog("kept\n");
      expect(log.copies()).toEqual([copy(2)]);
      expect(readdirSync(folder)).toEqual(["2-2.txt"]);
      expect(readFileSync(path.join(folder, "2-2.txt"), "utf8")).toBe("kept\n");
    });

    it("leaves the account's folder out of why it couldn't be written", async () => {
      // The reason is kept in the log, which the transcripts' Git history keeps.
      const home = await mkdtemp(path.join(os.tmpdir(), "voicecap-events-home-"));
      const file = path.join(home, "run", EVENT_LOG);
      await mkdir(path.dirname(file));
      await writeFile(path.join(path.dirname(file), "nvda-log"), "in the way");
      const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger(), session: 1 });
      const homedir = vi.spyOn(os, "homedir").mockReturnValue(home);
      try {
        log.screenReaderLog("first\n");
      } finally {
        homedir.mockRestore();
      }
      const [event] = readEventLog(readFileSync(file, "utf8")).events;
      const reason = whyNoCopy(event);
      expect(reason).not.toContain(home);
      expect(reason).toMatch(/^E[A-Z]+: .*'(%USERPROFILE%|~)[\\/]run[\\/]nvda-log'$/);
    });

    it("writes nothing, and records nothing, after the log is closed", async () => {
      const file = await logFile();
      const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger(), session: 2 });
      log.screenReaderLog("first\n");
      log.close();
      log.screenReaderLog("second\n");
      expect(log.copies()).toEqual([copy(1)]);
      expect(readFileSync(file, "utf8")).toBe(NAMED(1));
      expect(readdirSync(path.join(path.dirname(file), "nvda-log"))).toEqual(["2-1.txt"]);
    });
  });
});

// The copies already in a run's folder, which a session's end lists beside the ones it kept: those
// of an earlier session that never reached its own end.
describe("copiesInFolder", () => {
  /** A run's folder with a folder of copies holding `files`, and a folder named `folders` in it. */
  async function runFolder(files: string[], folders: string[] = []): Promise<string> {
    const run = await mkdtemp(path.join(os.tmpdir(), "voicecap-copies-"));
    await mkdir(path.join(run, "nvda-log"));
    for (const name of files) await writeFile(path.join(run, "nvda-log", name), "A copy.\n");
    for (const name of folders) await mkdir(path.join(run, "nvda-log", name));
    return run;
  }

  it("names each copy of a session up to the last, by its path from the run's folder", async () => {
    const run = await runFolder(["1-1.txt", "1-2.txt", "2-1.txt", "3-1.txt"]);
    expect(copiesInFolder(run, 2)).toEqual([
      "nvda-log/1-1.txt",
      "nvda-log/1-2.txt",
      "nvda-log/2-1.txt",
    ]);
    expect(copiesInFolder(run, 1)).toEqual(["nvda-log/1-1.txt", "nvda-log/1-2.txt"]);
    expect(copiesInFolder(run, 3)).toHaveLength(4);
    expect(copiesInFolder(run, 0)).toEqual([]);
  });

  it("puts them in the order of their numbers, not their letters", async () => {
    const run = await runFolder([
      "10-1.txt",
      "1-10.txt",
      "2-1.txt",
      "1-2.txt",
      "1-1.txt",
      "2-10.txt",
    ]);
    expect(copiesInFolder(run, 10)).toEqual([
      "nvda-log/1-1.txt",
      "nvda-log/1-2.txt",
      "nvda-log/1-10.txt",
      "nvda-log/2-1.txt",
      "nvda-log/2-10.txt",
      "nvda-log/10-1.txt",
    ]);
  });

  it("leaves out any file named another way, and any folder, even one named like a copy", async () => {
    const run = await runFolder(
      [
        "1-1.txt",
        "notes.txt",
        "1-1.txt.bak",
        "1-3.log",
        "x-1.txt",
        "1-x.txt",
        "01-1.txt",
        "1-02.txt",
        "0-1.txt",
        "1-0.txt",
        "-1.txt",
        "1-.txt",
        "1-1-1.txt",
        ".DS_Store",
      ],
      ["1-2.txt"],
    );
    expect(copiesInFolder(run, 9)).toEqual(["nvda-log/1-1.txt"]);
  });

  it("gives none when the run has no folder of copies, or a file stands where it goes", async () => {
    const run = await mkdtemp(path.join(os.tmpdir(), "voicecap-copies-"));
    expect(copiesInFolder(run, 3)).toEqual([]);
    await writeFile(path.join(run, "nvda-log"), "in the way");
    expect(copiesInFolder(run, 3)).toEqual([]);
    expect(copiesInFolder(path.join(run, "missing"), 3)).toEqual([]);
  });
});

describe("readEventLog", () => {
  const STARTED =
    '{"at":"2026-09-27T11:02:03.456-05:00","type":"run-started","session":1,"resumed":false}';
  const LOCKED = '{"at":"2026-09-27T11:02:04.000-05:00","type":"computer-locked"}';

  it("reads each line's event, in order", () => {
    expect(readEventLog(`${STARTED}\n${LOCKED}\n`)).toEqual({
      events: [
        { at: "2026-09-27T11:02:03.456-05:00", type: "run-started", session: 1, resumed: false },
        { at: "2026-09-27T11:02:04.000-05:00", type: "computer-locked" },
      ],
      unreadable: 0,
    });
  });

  it("reads an empty log, and a last line that has no newline", () => {
    expect(readEventLog("")).toEqual({ events: [], unreadable: 0 });
    expect(readEventLog(LOCKED).events).toHaveLength(1);
  });

  it("skips blank lines, and doesn't count them as unreadable", () => {
    expect(readEventLog(`\n${STARTED}\n   \n\r\n${LOCKED}\n\n`)).toMatchObject({
      events: [{ type: "run-started" }, { type: "computer-locked" }],
      unreadable: 0,
    });
  });

  it("counts a line that isn't JSON, such as one cut short, as unreadable", () => {
    const text = `${STARTED}\n{"at":"2026-09-27T11:0\n${LOCKED}\nnot json at all\n`;
    expect(readEventLog(text)).toMatchObject({
      events: [{ type: "run-started" }, { type: "computer-locked" }],
      unreadable: 2,
    });
  });

  it("counts a line that isn't an object with a time and a type as unreadable", () => {
    const lines = [
      '{"type":"computer-locked"}',
      '{"at":"2026-09-27T11:02:04.000-05:00"}',
      '{"at":1790000000,"type":"computer-locked"}',
      '{"at":"2026-09-27T11:02:04.000-05:00","type":7}',
      "[]",
      '["at","type"]',
      "null",
      "7",
      '"computer-locked"',
      "{}",
    ];
    expect(readEventLog(`${lines.join("\n")}\n${LOCKED}\n`)).toMatchObject({
      events: [{ type: "computer-locked" }],
      unreadable: lines.length,
    });
  });

  it("keeps an event of a type it doesn't know", () => {
    const later = '{"at":"2027-01-15T09:00:00.000-06:00","type":"display-changed","width":2560}';
    expect(readEventLog(`${later}\n`)).toEqual({
      events: [{ at: "2027-01-15T09:00:00.000-06:00", type: "display-changed", width: 2560 }],
      unreadable: 0,
    });
  });

  it("reads a log with Windows line endings", () => {
    expect(readEventLog(`${STARTED}\r\n${LOCKED}\r\n`)).toMatchObject({
      events: [{ type: "run-started" }, { type: "computer-locked" }],
      unreadable: 0,
    });
  });
});
