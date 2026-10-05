import { readFileSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ForegroundError, type EventRecorder } from "../src/drivers/types.js";
import type { RunEvent } from "../src/model.js";
import { runAudit } from "../src/run/audit.js";
import { EVENT_LOG, openEventLog, readEventLog } from "../src/run/events.js";
import { eventLogFile } from "../src/run/paths.js";
import { listRuns, readRunJson } from "../src/run/store.js";
import { fileHash } from "../src/transcripts/write.js";
import { sealOf } from "../src/util/hash.js";
import { createMemoryLogger } from "../src/util/log.js";
import { isoLocalMs } from "../src/util/time.js";
import { verifyHome } from "../src/verify.js";
import { config, ISO_MS, options, outDir, setup, SITE, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

/** An event as it's written, less its time. */
const bare = ({ at: _at, ...event }: RunEvent) => event;

const types = (events: RunEvent[]) => events.map((event) => event.type);

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

describe("openEventLog", () => {
  const NOW = new Date(2026, 8, 27, 11, 2, 3, 456);
  const STAMP = isoLocalMs(NOW);
  const LOCKED = `{"at":"${STAMP}","type":"computer-locked"}\n`;

  async function logFile(): Promise<string> {
    return path.join(await mkdtemp(path.join(os.tmpdir(), "voicecap-events-")), EVENT_LOG);
  }

  it("writes each event as a line, with its time first", async () => {
    const file = await logFile();
    const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger() });
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
    });
    log.record({ type: "computer-locked" });
    log.record({ type: "computer-locked" });
    expect(readEventLog(readFileSync(file, "utf8")).events.map((event) => event.at)).toEqual([
      isoLocalMs(new Date(2026, 8, 27, 11, 2, 3, 0)),
      isoLocalMs(new Date(2026, 8, 27, 11, 2, 3, 1)),
    ]);
  });

  it("makes no file until there's an event to write", async () => {
    const file = await logFile();
    openEventLog(file, { now: () => NOW, logger: createMemoryLogger() });
    expect(() => readFileSync(file)).toThrow(/ENOENT/);
  });

  it("adds to a log that's there, with no blank line between", async () => {
    const file = await logFile();
    await writeFile(file, "kept\n");
    const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger() });
    log.record({ type: "computer-locked" });
    expect(readFileSync(file, "utf8")).toBe(`kept\n${LOCKED}`);
  });

  it("starts its first line on a new line when the log ends with a line cut short", async () => {
    const file = await logFile();
    await writeFile(file, 'kept\n{"at":"2026-09-27T11:0');
    const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger() });
    log.record({ type: "computer-locked" });
    log.record({ type: "computer-locked" });
    // Only the first needs it: the second follows the newline the first ended with.
    expect(readFileSync(file, "utf8")).toBe(`kept\n{"at":"2026-09-27T11:0\n${LOCKED}${LOCKED}`);
  });

  it("writes nothing after it's closed", async () => {
    const file = await logFile();
    const log = openEventLog(file, { now: () => NOW, logger: createMemoryLogger() });
    log.record({ type: "computer-locked" });
    log.close();
    log.record({ type: "computer-locked" });
    expect(readFileSync(file, "utf8")).toBe(LOCKED);

    // A log closed before it wrote anything makes no file.
    const never = await logFile();
    const closed = openEventLog(never, { now: () => NOW, logger: createMemoryLogger() });
    closed.close();
    closed.record({ type: "computer-locked" });
    expect(() => readFileSync(never)).toThrow(/ENOENT/);
  });

  it("warns once when it can't write, and never throws", async () => {
    const file = await logFile();
    // A folder where the file goes.
    await mkdir(file);
    const logger = createMemoryLogger();
    const log = openEventLog(file, { now: () => NOW, logger });
    for (let i = 0; i < 3; i++) log.record({ type: "computer-locked" });
    log.close();
    expect(logger.entries.map((entry) => entry.level)).toEqual(["warn"]);
    expect(logger.entries[0]?.message).toMatch(/^The event log couldn't be written: .+\.$/);
  });

  it("starts a new line after a write that failed, which may have left a line cut short", async () => {
    const file = await logFile();
    const logger = createMemoryLogger();
    const log = openEventLog(file, { now: () => NOW, logger });
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
    const log = openEventLog(file, { now: () => NOW, logger });
    // The folder isn't there yet.
    log.record({ type: "computer-locked" });
    await mkdir(folder);
    log.record({ type: "browser-handed-over" });
    log.record({ type: "browser-handed-over" });
    const handed = `{"at":"${STAMP}","type":"browser-handed-over"}\n`;
    expect(readFileSync(file, "utf8")).toBe(`${handed}${handed}`);
    expect(logger.entries).toHaveLength(1);
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
