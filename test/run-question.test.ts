/**
 * The question at the end of a session, and what's on disk around it: the session's end is written
 * before the question, whatever ended the session, so a window closed at the question (which can
 * end voicecap at once) still leaves the session ended.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { makeAskListener } from "../src/cli/listener.js";
import type { RunJson } from "../src/model.js";
import { runAudit, type RunAuditOptions } from "../src/run/audit.js";
import { handleInterrupts, type SignalSource } from "../src/run/signals.js";
import { listRuns, readRunJson } from "../src/run/store.js";
import { EnvironmentError } from "../src/util/errors.js";
import { sealOf } from "../src/util/hash.js";
import { createMemoryLogger } from "../src/util/log.js";
import { fakeSignals } from "./helpers/fake-signals.js";
import { config, options, outDir, setup, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

/** The one run in a site's folder, read at once: as it is on disk at this very moment. */
function runOnDiskNow(siteDir: string): RunJson {
  const [date] = readdirSync(siteDir).filter((name) => /^\d{4}-\d\d-\d\d$/.test(name));
  const [time] = readdirSync(path.join(siteDir, date!));
  return JSON.parse(readFileSync(path.join(siteDir, date!, time!, "run.json"), "utf8")) as RunJson;
}

/**
 * A person at a terminal who does `then` once the question is on screen: the question with no
 * wait for keys typed ahead, listening to `signals`.
 */
function atTheQuestion(signals: SignalSource, then: () => void) {
  const keyboard = Object.assign(new PassThrough(), { isTTY: true });
  const screen = {
    write: (chunk: string) => {
      if (chunk.includes("Choose [3]: ")) setImmediate(then);
      return true;
    },
  };
  return makeAskListener(keyboard, screen, { drainMs: 0, signals });
}

/** How each ending is set up: a run of the site's pages that reads at least one, then ends so. */
const endings: {
  ending: string;
  endReason: string;
  run: (dir: string, extra: Partial<RunAuditOptions>) => Promise<unknown>;
}[] = [
  {
    ending: "completes",
    endReason: "completed",
    run: (dir, extra) => runAudit(options(dir, new ScriptedDriver(sitePages()), extra)),
  },
  {
    ending: "is interrupted",
    endReason: "interrupted",
    run: (dir, extra) => {
      const controller = new AbortController();
      const driver = new ScriptedDriver(sitePages());
      const openPage = driver.openPage.bind(driver);
      driver.openPage = (url) => {
        if (url.endsWith("/about")) controller.abort();
        return openPage(url);
      };
      return runAudit(options(dir, driver, { signal: controller.signal, ...extra }));
    },
  },
  {
    ending: "stops after failed pages in a row",
    endReason: "environment-failure",
    run: (dir, extra) => {
      const broken = new Error("NVDA is not responding");
      const driver = new ScriptedDriver(
        sitePages({ home: { openError: broken }, about: { openError: broken } }),
      );
      return runAudit({
        ...options(dir, driver, extra),
        config: config({ maxConsecutiveFailures: 2, pageAttempts: 1 }),
      });
    },
  },
  {
    ending: "ends with an error",
    endReason: "environment-failure",
    run: (dir, extra) => {
      const driver = new ScriptedDriver(sitePages());
      const start = driver.start.bind(driver);
      let starts = 0;
      driver.start = () =>
        ++starts === 2 ? Promise.reject(new EnvironmentError("NVDA didn't start")) : start();
      const running = runAudit({
        ...options(dir, driver, extra),
        config: config({ restartEvery: 1 }),
      });
      return running.catch(() => undefined);
    },
  },
];

describe("the session's end, and the question after it", () => {
  it.each(endings)(
    "writes the session's end before asking, when the session $ending",
    async ({ endReason, run }) => {
      const dir = await setup();
      let onDiskWhenAsked: RunJson | undefined;
      await run(dir, {
        askListener: async () => {
          [onDiskWhenAsked] = await listRuns(outDir(dir));
          return "all";
        },
      });
      const session = onDiskWhenAsked?.sessions[0];
      expect(session?.endReason).toBe(endReason);
      expect(session?.endedAt).toEqual(expect.any(String));
      expect(session).not.toHaveProperty("listener");
      // Not yet sealed: the answer is still to come, and the seal covers it.
      expect(onDiskWhenAsked?.status).toBe("incomplete");
      expect(onDiskWhenAsked).not.toHaveProperty("seal");

      // Then the answer is written beside it.
      const [after] = await listRuns(outDir(dir));
      expect(after?.sessions[0]).toMatchObject({ endReason, listener: { answer: "all" } });
    },
  );

  it("ends a completed session when the screen reader stopped, not when the answer came", async () => {
    const dir = await setup(["/"]);
    const stopped = new Date(2026, 8, 30, 14, 30, 0).getTime();
    let time = stopped;
    const result = await runAudit(
      options(dir, new ScriptedDriver(sitePages()), {
        now: () => new Date(time),
        askListener: () => {
          // The person takes a minute to answer.
          time += 60_000;
          return Promise.resolve("all");
        },
      }),
    );
    const run = await readRunJson(outDir(dir), result.runId);
    expect(Date.parse(run.sessions[0]!.endedAt!)).toBe(stopped);
    // The run completed, and was sealed, once the answer was in.
    expect(Date.parse(run.completedAt!)).toBe(stopped + 60_000);
    expect(run.seal).toBe(sealOf(run));
  });
});

// Closing the terminal window sends SIGHUP. During a run interrupted by Ctrl+C, that's the second
// signal, and the CLI's handler exits at once.
describe("a window closed at the question", () => {
  it("leaves an interrupted session ended on disk, though voicecap exits at once", async () => {
    const dir = await setup();
    const signals = fakeSignals("win32");
    // What run.json held when the process exited: a real exit ends voicecap there and then.
    const onDiskAtExit: RunJson[] = [];
    const source: SignalSource = {
      ...signals.source,
      exit: (code) => {
        signals.source.exit(code);
        onDiskAtExit.push(runOnDiskNow(outDir(dir)));
      },
    };
    const controller = new AbortController();
    const unhook = handleInterrupts(controller, createMemoryLogger(), { source });
    try {
      const driver = new ScriptedDriver(sitePages());
      const openPage = driver.openPage.bind(driver);
      driver.openPage = (url) => {
        // Ctrl+C as /about opens.
        if (url.endsWith("/about")) signals.send("SIGINT");
        return openPage(url);
      };
      const result = await runAudit(
        options(dir, driver, {
          signal: controller.signal,
          askListener: atTheQuestion(source, () => signals.send("SIGHUP")),
        }),
      );
      expect(result.outcome).toBe("interrupted");
    } finally {
      unhook();
    }
    expect(signals.exits).toEqual([130]);
    expect(onDiskAtExit[0]?.sessions[0]).toMatchObject({
      endReason: "interrupted",
      pagesDone: 1,
      endedAt: expect.any(String) as unknown,
    });
    expect(onDiskAtExit[0]?.sessions[0]).not.toHaveProperty("listener");
  });

  it("seals a completed run, with its session ended and no statement", async () => {
    const dir = await setup(["/"]);
    const signals = fakeSignals("win32");
    const controller = new AbortController();
    const unhook = handleInterrupts(controller, createMemoryLogger(), { source: signals.source });
    let result: Awaited<ReturnType<typeof runAudit>>;
    try {
      result = await runAudit(
        options(dir, new ScriptedDriver(sitePages()), {
          signal: controller.signal,
          askListener: atTheQuestion(signals.source, () => signals.send("SIGHUP")),
        }),
      );
    } finally {
      unhook();
    }
    expect(result.outcome).toBe("completed");
    // The run's own handler took the signal as the first, and called nothing off but the question.
    expect(signals.exits).toEqual([]);
    const run = await readRunJson(outDir(dir), result.runId);
    expect(run.status).toBe("completed");
    expect(run.seal).toBe(sealOf(run));
    expect(run.sessions[0]?.endReason).toBe("completed");
    expect(run.sessions[0]).not.toHaveProperty("listener");
  });
});
