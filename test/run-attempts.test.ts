/**
 * A page's failed attempts stay in its record whatever happens next: each is written to run.json as
 * it ends, before any restart, and numbered as the page's attempt across every session.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ForegroundError } from "../src/drivers/types.js";
import type { AttemptRecord } from "../src/model.js";
import { runAudit } from "../src/run/audit.js";
import { readEventLog } from "../src/run/events.js";
import { eventLogFile } from "../src/run/paths.js";
import { listRuns, readRunJson, writeRunJson } from "../src/run/store.js";
import { EnvironmentError } from "../src/util/errors.js";
import { config, options, outDir, setup, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

const lost = () => new ForegroundError("The browser lost the foreground to another window.");

/** A scripted driver whose first Down Arrow loses the foreground, and no other does. */
function losesTheForegroundOnce(): ScriptedDriver {
  let lines = 0;
  return new ScriptedDriver(sitePages(), {
    fail: (command) => (command === "nextLine" && ++lines === 1 ? lost() : null),
  });
}

describe("a page's failed attempts, whatever ends the session", () => {
  it("keeps an attempt that failed before Ctrl+C, and the resumed page numbers on from it", async () => {
    const dir = await setup(["/"]);
    const controller = new AbortController();
    const first = losesTheForegroundOnce();
    // Ctrl+C as the second attempt opens the page, once the restart for it has finished.
    const openPage = first.openPage.bind(first);
    let opens = 0;
    first.openPage = (url) => {
      if (++opens === 2) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit(options(dir, first, { signal: controller.signal }));
    expect(interrupted.outcome).toBe("interrupted");

    // The page is still pending, and the attempt Ctrl+C stopped isn't counted.
    const saved = (await readRunJson(outDir(dir), interrupted.runId)).pages[0]!;
    expect(saved).toMatchObject({ status: "pending", attempts: 1 });
    expect(saved.failedAttempts).toEqual([
      expect.objectContaining({ n: 1, cause: "foreground", restarted: true }),
    ]);

    // Resumed, the page's next attempt is its second, in whichever session it comes.
    const resumed = await runAudit(options(dir, losesTheForegroundOnce()));
    expect(resumed).toMatchObject({ runId: interrupted.runId, outcome: "completed" });
    const page = resumed.run.pages[0]!;
    expect(page).toMatchObject({ status: "done", attempts: 3 });
    expect(page.failedAttempts!.map((attempt) => [attempt.n, attempt.cause])).toEqual([
      [1, "foreground"],
      [2, "foreground"],
    ]);
  });

  it("writes an attempt before the restart it's followed by, and keeps it when that fails", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages(), {
      fail: (command) => (command === "nextLine" ? lost() : null),
    });
    // The screen reader won't start again for the page's second attempt. What run.json holds by
    // then is what a crash or a closed window at that moment would leave.
    const start = driver.start.bind(driver);
    let starts = 0;
    let onDiskAtRestart: AttemptRecord[] | undefined;
    driver.start = async () => {
      if (++starts === 1) return start();
      const [run] = await listRuns(outDir(dir));
      onDiskAtRestart = run?.pages[0]?.failedAttempts;
      throw new EnvironmentError("NVDA didn't start", { failure: "screen-reader-stopped" });
    };
    await expect(runAudit(options(dir, driver))).rejects.toThrow("NVDA didn't start");

    expect(onDiskAtRestart).toEqual([
      expect.objectContaining({ n: 1, cause: "foreground", restarted: false }),
    ]);
    const [stored] = await listRuns(outDir(dir));
    expect(stored?.sessions[0]?.endReason).toBe("environment-failure");
    expect(stored?.pages[0]).toMatchObject({ status: "pending", attempts: 1 });
    // The restart never finished, so the attempt says the page wasn't tried on a fresh start.
    expect(stored?.pages[0]?.failedAttempts).toEqual([
      expect.objectContaining({ n: 1, cause: "foreground", restarted: false }),
    ]);
  });

  it("numbers on from the attempts a 0.5.0 record counted for a page", async () => {
    const dir = await setup(["/", "/about", "/resources"]);
    const broken = new Error("NVDA is not responding");
    const controller = new AbortController();
    const first = new ScriptedDriver(sitePages({ about: { openError: broken } }));
    // Ctrl+C as /resources opens, once /about has failed all three of its attempts.
    const openPage = first.openPage.bind(first);
    first.openPage = (url) => {
      if (url.endsWith("/resources")) controller.abort();
      return openPage(url);
    };
    const interrupted = await runAudit({
      ...options(dir, first, { signal: controller.signal }),
      config: config({ pageAttempts: 3 }),
    });
    expect(interrupted.outcome).toBe("interrupted");

    // As 0.5.0 recorded /about: three attempts counted, with no record of each.
    const record = await readRunJson(outDir(dir), interrupted.runId);
    const about = record.pages[1]!;
    expect(about).toMatchObject({ status: "failed", attempts: 3 });
    delete about.failedAttempts;
    await writeRunJson(outDir(dir), record);

    const resumed = await runAudit(
      options(
        dir,
        new ScriptedDriver(sitePages({ about: { openError: broken, openErrorTimes: 1 } })),
      ),
    );
    expect(resumed).toMatchObject({ runId: interrupted.runId, outcome: "completed" });
    const page = resumed.run.pages[1]!;
    expect(page).toMatchObject({ status: "done", attempts: 5 });
    expect(page.failedAttempts!.map((attempt) => attempt.n)).toEqual([4]);
  });
});

describe("the words of an error a page's attempts record", () => {
  // An error's message can name a file of the account that ran voicecap, and the records are kept in
  // Git and shown on a website: the home folder is written as %USERPROFILE%, or ~ away from Windows.
  const mark = process.platform === "win32" ? "%USERPROFILE%" : "~";
  const message = `can't read ${path.join(os.homedir(), "secret.txt")}`;
  const kept = `can't read ${mark}${path.sep}secret.txt`;

  it("name the home folder as %USERPROFILE%: in the page's errors, the attempt's message, and the event log", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages(), {
      fail: (command) => (command === "nextLine" ? new Error(message) : null),
    });

    const { run, runId } = await runAudit({
      ...options(dir, driver),
      config: config({ pageAttempts: 2 }),
    });

    const page = run.pages[0]!;
    expect(page).toMatchObject({ status: "failed", attempts: 2 });
    // The page's errors: what each attempt said, and the line that retries it.
    expect(page.errors).toEqual([
      `Attempt 1 failed (read pass: ${kept}); retrying.`,
      `read pass: ${kept}`,
    ]);
    // Each failed attempt's message, which is an unexpected error's, so its stack is kept too.
    expect(page.failedAttempts!.map((attempt) => attempt.message)).toEqual([kept, kept]);
    expect(page.failedAttempts![0]).toMatchObject({ cause: "unexpected" });
    // The pass's own record, which the transcript's header repeats as its errors.
    expect(page.passes.read?.errors).toEqual([kept]);

    // The event log's line for each attempt that failed.
    const log = readEventLog(readFileSync(eventLogFile(outDir(dir), runId), "utf8"));
    const failed = log.events.filter((event) => event.type === "page-failed");
    expect(failed.map((event) => (event as { message?: string }).message)).toEqual([kept, kept]);

    // Nothing the run kept of the attempts holds the home folder, whatever way it is spelled.
    const onDisk = JSON.stringify(await readRunJson(outDir(dir), runId));
    expect(onDisk).not.toContain(JSON.stringify(os.homedir()).slice(1, -1));
    expect(onDisk).not.toContain(os.homedir().replaceAll("\\", "/"));
  });

  it("name it as %USERPROFILE% for a page that wouldn't open, too", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages({ home: { openError: new Error(message) } }));

    const { run } = await runAudit({
      ...options(dir, driver),
      config: config({ pageAttempts: 2 }),
    });

    const page = run.pages[0]!;
    expect(page.status).toBe("failed");
    expect(page.errors).toEqual([
      `Attempt 1 failed (Could not open the page for the read pass: ${kept}); retrying.`,
      `Could not open the page for the read pass: ${kept}`,
    ]);
    expect(page.failedAttempts!.map((attempt) => attempt.message)).toEqual([kept, kept]);
  });
});
