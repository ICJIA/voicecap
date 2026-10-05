/**
 * writeWalkthrough, which `voicecap walkthrough` runs: the file of a run's pages, in order, and its
 * settings, so anyone can repeat the run. Each home is made with real scripted runs, or is a copy of
 * the demo runs voicecap 0.4.1 recorded. No real screen reader starts here.
 */
import { existsSync } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { cp, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";

import type * as Api from "../src/index.js";
import type { RunJson } from "../src/model.js";
import { runAudit } from "../src/run/audit.js";
import { runJsonPath } from "../src/run/paths.js";
import {
  parseWalkthrough,
  walkthroughJson,
  walkthroughOf,
  walkthroughProblem,
  type Walkthrough,
} from "../src/share/walkthrough.js";
import { writeWalkthrough, type WriteWalkthroughOptions } from "../src/share/write-walkthrough.js";
import { formatCommand } from "../src/util/command-line.js";
import { UsageError } from "../src/util/errors.js";
import { createMemoryLogger, type MemoryLogger } from "../src/util/log.js";
import { gitBashForm } from "./helpers/git-bash.js";
import {
  homeWithCountedRun,
  options as runOptions,
  setup,
  SITE,
  sitePages,
} from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

// Every call goes through as it did, and is kept, so a test can see the steps a file is written in,
// or make a write fail, or the removal of what it wrote.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, open: vi.fn(actual.open), rm: vi.fn(actual.rm) };
});

/** The folders these tests made, which are taken away after each. */
const folders: string[] = [];

afterEach(async () => {
  // Back to going through, with no call kept and no failure waiting, whatever a test did.
  vi.mocked(open).mockReset();
  vi.mocked(rm).mockReset();
  await Promise.all(
    folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})),
  );
});

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = (...parts: string[]) => path.join(ROOT, "fixture", ...parts);

/** The demo runs voicecap 0.4.1 recorded on 29 September 2026: a home, with one site's folder. */
const DEMO_HOME = fileURLToPath(new URL("./fixtures/share/demo-2026-09-29", import.meta.url));
const DEMO_SITE = "http://127.0.0.1:4848";
const DEMO_FOLDER = "127.0.0.1_4848";
/** The replay's site: a replayed run is made of fixture/replay-run. */
const REPLAY_SITE = "http://127.0.0.1:4747";

/** A new folder with a page list of `entries`, taken away after the test. */
async function newFolder(entries?: string[]): Promise<string> {
  const dir = await setup(entries);
  folders.push(dir);
  return dir;
}

/** A home with one completed, sealed, live run of the scripted site (three pages, by default). */
async function homeWithRun(entries?: string[]) {
  return homeWithCountedRun(await newFolder(entries));
}

/** A home with two completed runs of the scripted site: the first at 10:00, the second at 11:00. */
async function homeWithTwoRuns() {
  const dir = await newFolder();
  const runAt = (hour: number) =>
    runAudit(
      runOptions(dir, new ScriptedDriver(sitePages()), { now: () => new Date(2027, 0, 15, hour) }),
    );
  const first = await runAt(10);
  const second = await runAt(11);
  expect([first.outcome, second.outcome]).toEqual(["completed", "completed"]);
  return { dir, first, second };
}

/** A copy of the demo runs, as a home: 1315 and 1402 completed, 1415 and 1419 interrupted. */
async function demoHome() {
  const home = await mkdtemp(path.join(os.tmpdir(), "voicecap-walkthrough-"));
  folders.push(home);
  await cp(DEMO_HOME, home, { recursive: true });
  return { home, siteDir: path.join(home, DEMO_FOLDER) };
}

/**
 * The options that write `file` from SITE's folder in the transcripts home of `dir`, run from `dir`,
 * and the logger they say it to. `extra` changes any option.
 */
function writing(
  dir: string,
  file: string,
  extra: Partial<WriteWalkthroughOptions> = {},
): { logger: MemoryLogger; options: WriteWalkthroughOptions } {
  const logger = createMemoryLogger();
  return {
    logger,
    options: {
      file,
      out: path.join(dir, "transcripts"),
      site: SITE,
      cwd: dir,
      env: {},
      logger,
      ...extra,
    },
  };
}

/** The same, for the demo home. */
function writingDemo(home: string, file: string, extra: Partial<WriteWalkthroughOptions> = {}) {
  return writing(home, file, { out: home, site: DEMO_SITE, ...extra });
}

/** The walkthrough in `file`, read back as `voicecap --walkthrough` reads it. */
async function writtenIn(file: string): Promise<Walkthrough> {
  return parseWalkthrough(await readFile(file, "utf8"), file);
}

/** The message of the UsageError that `writing` is refused with. */
async function refusal(writing: Promise<unknown>): Promise<string> {
  const error = await writing.then(
    () => {
      throw new Error("It wasn't refused.");
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(UsageError);
  return (error as UsageError).message;
}

/** The two lines it says when it has written `file`, and nothing else. */
const wrote = (runId: string, pages: string, file: string) => [
  {
    level: "info",
    message: `Wrote the walkthrough of run ${runId} (${pages}) to ${file}.`,
  },
  {
    level: "info",
    message: `To repeat the run: ${formatCommand(["--walkthrough", file])}`,
  },
];

describe("writeWalkthrough", () => {
  it("writes the latest completed run's walkthrough, and says how to repeat it", async () => {
    const { dir, run } = await homeWithRun();
    const { logger, options } = writing(dir, path.join(dir, "walkthrough.json"));

    const result = await writeWalkthrough(options);

    const written = await writtenIn(options.file);
    expect(written.original.run).toBe(run.runId);
    expect(written.pages).toHaveLength(3);
    expect(result).toEqual({ file: options.file, runId: run.runId, walkthrough: written });
    expect(logger.entries).toEqual(wrote(run.runId, "3 pages", options.file));
  });

  it("writes the file as walkthroughJson gives it: two-space indents, and a final newline", async () => {
    const { dir } = await homeWithRun();
    const { options } = writing(dir, path.join(dir, "walkthrough.json"));

    const { walkthrough } = await writeWalkthrough(options);

    const text = await readFile(options.file, "utf8");
    expect(text).toBe(walkthroughJson(walkthrough));
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "voicecapWalkthrough": 1,\n');
  });

  it("writes the run --run names, an older one too", async () => {
    const { dir, first, second } = await homeWithTwoRuns();
    expect(first.runId).not.toBe(second.runId);
    const { options } = writing(dir, path.join(dir, "walkthrough.json"), { run: first.runId });

    const result = await writeWalkthrough(options);

    expect((await writtenIn(options.file)).original.run).toBe(first.runId);
    expect(result.runId).toBe(first.runId);
  });

  it("writes the later of two completed runs when it's not told which", async () => {
    const { dir, second } = await homeWithTwoRuns();
    const { options } = writing(dir, path.join(dir, "walkthrough.json"));

    await writeWalkthrough(options);

    expect((await writtenIn(options.file)).original.run).toBe(second.runId);
  });

  it("takes the latest completed run, though runs after it were interrupted", async () => {
    const { home } = await demoHome();
    const { options } = writingDemo(home, path.join(home, "walkthrough.json"));

    await writeWalkthrough(options);

    // 1415 and 1419 came after 1402, and neither finished.
    expect((await writtenIn(options.file)).original.run).toBe("2026-09-29_1402");
  });

  it("takes a replayed run as the latest completed one", async () => {
    const dir = await newFolder();
    const replay = await runAudit({
      ...runOptions(dir, undefined),
      site: REPLAY_SITE,
      pages: fixture("pages.json"),
      replayFrom: fixture("replay-run"),
    });
    expect(replay.outcome).toBe("completed");
    const { options } = writing(dir, path.join(dir, "walkthrough.json"), { site: REPLAY_SITE });

    await writeWalkthrough(options);

    expect((await writtenIn(options.file)).original).toMatchObject({
      run: replay.runId,
      replayed: true,
    });
  });

  it("takes the home's only site, and the home from the folder it's run in, when it's given neither", async () => {
    const { dir, run } = await homeWithRun();
    const file = path.join(dir, "walkthrough.json");

    await writeWalkthrough({ file, cwd: dir, env: {}, logger: createMemoryLogger() });

    expect((await writtenIn(file)).original.run).toBe(run.runId);
  });

  it("refuses an incomplete run, a missing run, and a home with no completed run", async () => {
    const { home, siteDir } = await demoHome();
    const file = path.join(home, "out", "walkthrough.json");
    const { logger, options } = writingDemo(home, file);

    // 1415 was interrupted.
    expect(await refusal(writeWalkthrough({ ...options, run: "2026-09-29_1415" }))).toBe(
      "Run 2026-09-29_1415 didn't complete, so it can't be repeated. Run it to the end first.",
    );
    expect(await refusal(writeWalkthrough({ ...options, run: "2026-09-29_0900" }))).toBe(
      `There's no run 2026-09-29_0900 in ${siteDir}.`,
    );
    // Only the two that were interrupted are left.
    for (const time of ["1315", "1402"]) {
      await rm(path.join(siteDir, "2026-09-29", time), { recursive: true });
    }
    expect(await refusal(writeWalkthrough(options))).toBe(
      `There's no completed run in ${siteDir} yet, so there's nothing to repeat.`,
    );

    // Nothing was written: not the file, and not the folder it was to go in.
    expect(existsSync(path.dirname(file))).toBe(false);
    expect(logger.entries).toEqual([]);
  });

  it("refuses a site that has no runs at all", async () => {
    const dir = await newFolder();
    const file = path.join(dir, "walkthrough.json");
    const { options } = writing(dir, file);

    expect(await refusal(writeWalkthrough(options))).toBe(
      `There's no completed run in ${path.join(dir, "transcripts", "example.illinois.gov")} yet, so there's nothing to repeat.`,
    );
    expect(existsSync(file)).toBe(false);
  });

  it("refuses a run whose walkthrough file voicecap couldn't read back, and writes nothing", async () => {
    const { dir, siteDir, run } = await homeWithRun();
    // The config allows a step limit above the 100,000 that a walkthrough file does.
    const record = JSON.parse(await readFile(runJsonPath(siteDir, run.runId), "utf8")) as RunJson;
    record.settings.stepCaps.read = 100_001;
    await writeFile(runJsonPath(siteDir, run.runId), JSON.stringify(record));
    const file = path.join(dir, "out", "walkthrough.json");
    const { logger, options } = writing(dir, file);

    expect(await refusal(writeWalkthrough(options))).toBe(
      `Run ${run.runId}'s walkthrough file can't be written: its settings.stepCaps.read: must be a whole number from 1 to 100,000.`,
    );

    expect(existsSync(path.dirname(file))).toBe(false);
    expect(logger.entries).toEqual([]);
  });

  it("refuses a run whose walkthrough file would be over 8 MB, and writes nothing", async () => {
    const { dir, siteDir, run } = await homeWithRun();
    // A page's notes may be of any length: nine megabytes of them make the run's file too large.
    const record = JSON.parse(await readFile(runJsonPath(siteDir, run.runId), "utf8")) as RunJson;
    record.pages[0]!.notes = "x".repeat(9 * 1024 * 1024);
    await writeFile(runJsonPath(siteDir, run.runId), JSON.stringify(record));
    const file = path.join(dir, "out", "walkthrough.json");
    const { logger, options } = writing(dir, file);

    expect(await refusal(writeWalkthrough(options))).toBe(
      `Run ${run.runId}'s walkthrough file can't be written: it's larger than 8 MB.`,
    );

    expect(existsSync(path.dirname(file))).toBe(false);
    expect(logger.entries).toEqual([]);
  });

  it("never overwrites a file", async () => {
    const { dir } = await homeWithRun();
    const file = path.join(dir, "walkthrough.json");
    await writeFile(file, "mine");
    const { logger, options } = writing(dir, file);

    expect(await refusal(writeWalkthrough(options))).toBe(
      `${file} is already there. voicecap doesn't overwrite it: give another name, or move that file first.`,
    );

    expect(await readFile(file, "utf8")).toBe("mine");
    expect(logger.entries).toEqual([]);
  });

  it("refuses a folder at the file's path as it does a file", async () => {
    const { dir } = await homeWithRun();
    const file = path.join(dir, "walkthrough.json");
    await mkdir(file);
    const { options } = writing(dir, file);

    expect(await refusal(writeWalkthrough(options))).toBe(
      `${file} is already there. voicecap doesn't overwrite it: give another name, or move that file first.`,
    );
  });

  it("writes from a run voicecap 0.4.1 recorded", async () => {
    const { home } = await demoHome();
    const file = path.join(home, "walkthrough.json");
    const { logger, options } = writingDemo(home, file, { run: "2026-09-29_1402" });

    await writeWalkthrough(options);

    const written = await writtenIn(file);
    expect(written.original).toMatchObject({ run: "2026-09-29_1402", voicecap: "0.4.1" });
    // 0.4.1 didn't record the readiness settings it waited with.
    expect(written.settings.readiness).toBeNull();
    expect(written.pages).toHaveLength(7);
    expect(logger.entries).toEqual(wrote("2026-09-29_1402", "7 pages", file));
  });

  // Ruling P17. A run of a copy of the site, whose folder is named for the copy's address, and the
  // live site's own folder, both name https://example.illinois.gov/: the command the copy's shared
  // page prints names the site by that address, and its run by its id.
  describe("given the site's canonical address and a run", () => {
    const CANONICAL = "https://example.illinois.gov/";

    /**
     * A home with a run of the live site (example.illinois.gov, 14 January at 09:00) and a replayed
     * run of a copy at REPLAY_SITE that recorded the live site's address (15 January at 10:00).
     */
    async function homeWithACopy() {
      const dir = await newFolder();
      const live = await runAudit(
        runOptions(dir, new ScriptedDriver(sitePages()), {
          now: () => new Date(2027, 0, 14, 9, 0),
        }),
      );
      const copy = await runAudit({
        ...runOptions(dir, undefined, {
          now: () => new Date(2027, 0, 15, 10, 0),
          canonical: CANONICAL,
        }),
        site: REPLAY_SITE,
        pages: fixture("pages.json"),
        replayFrom: fixture("replay-run"),
      });
      expect([live.outcome, copy.outcome]).toEqual(["completed", "completed"]);
      expect([live.runId, copy.runId]).toEqual(["2027-01-14_0900", "2027-01-15_1000"]);
      return { dir, live, copy };
    }

    it("writes the copy's run from the copy's folder, though the live site's folder is named for the address", async () => {
      const { dir, copy } = await homeWithACopy();
      const file = path.join(dir, "walkthrough.json");
      const { options } = writing(dir, file, { site: CANONICAL, run: copy.runId });

      const result = await writeWalkthrough(options);

      expect(result.runId).toBe(copy.runId);
      const written = await writtenIn(file);
      expect(written.original).toMatchObject({ run: copy.runId, replayed: true });
      // It repeats where the run read: the copy.
      expect(written.site).toBe(REPLAY_SITE);
    });

    it("writes the live site's run from its own folder", async () => {
      const { dir, live } = await homeWithACopy();
      const file = path.join(dir, "walkthrough.json");
      const { options } = writing(dir, file, { site: SITE, run: live.runId });

      await writeWalkthrough(options);

      const written = await writtenIn(file);
      expect(written.original.run).toBe(live.runId);
      expect(written.site).toBe(SITE);
    });

    it("names the run and the folders it looked in when none holds it, and writes nothing", async () => {
      const { dir } = await homeWithACopy();
      const file = path.join(dir, "out", "walkthrough.json");
      const { options } = writing(dir, file, { site: CANONICAL, run: "2027-01-16_0900" });
      const home = path.join(dir, "transcripts");

      expect(await refusal(writeWalkthrough(options))).toBe(
        `There's no run 2027-01-16_0900 in ${path.join(home, "example.illinois.gov")} or ${path.join(home, "127.0.0.1_4747")}.`,
      );
      expect(existsSync(path.dirname(file))).toBe(false);
    });
  });

  it("makes the file's folder when it's missing, and gives the full path of a file named relative to where it's run", async () => {
    const { dir, run } = await homeWithRun();
    const relative = path.join("reports", "2027", "walkthrough.json");
    const file = path.join(dir, relative);
    const { logger, options } = writing(dir, relative);

    const result = await writeWalkthrough(options);

    expect(result.file).toBe(file);
    expect((await writtenIn(file)).original.run).toBe(run.runId);
    expect(logger.entries).toEqual(wrote(run.runId, "3 pages", file));
  });

  // Git Bash translates /c/... itself, except with MSYS_NO_PATHCONV=1 set.
  it.runIf(process.platform === "win32")("writes to a file written Git Bash's way", async () => {
    const { dir, run } = await homeWithRun();
    const file = path.join(dir, "walkthrough.json");
    const { logger, options } = writing(dir, gitBashForm(file));

    const result = await writeWalkthrough(options);

    expect(result.file).toBe(file);
    expect((await writtenIn(file)).original.run).toBe(run.runId);
    expect(logger.entries).toEqual(wrote(run.runId, "3 pages", file));
  });

  it("says '1 page' for a run of one page", async () => {
    const { dir, run } = await homeWithRun(["/about"]);
    const { logger, options } = writing(dir, path.join(dir, "walkthrough.json"));

    await writeWalkthrough(options);

    expect(logger.entries).toEqual(wrote(run.runId, "1 page", options.file));
  });

  it("quotes a path with a space in the command that repeats the run", async () => {
    const { dir } = await homeWithRun();
    const file = path.join(dir, "my walkthroughs", "walkthrough.json");
    const { logger, options } = writing(dir, file);

    await writeWalkthrough(options);

    expect(logger.entries[1]?.message).toBe(
      `To repeat the run: npx @icjia/voicecap --walkthrough '${file}'`,
    );
  });

  it("opens the file as a new one, writes it, syncs it to disk, and closes it", async () => {
    const { dir } = await homeWithRun();
    const { options } = writing(dir, path.join(dir, "walkthrough.json"));
    const real = await vi.importActual<typeof FsPromises>("node:fs/promises");
    const steps: string[] = [];
    vi.mocked(open).mockImplementation(async (file, flags, mode) => {
      const handle = await real.open(file, flags, mode);
      if (String(file) !== options.file) return handle;
      steps.push(`open ${String(flags)}`);
      // The same handle, which says each step it's asked to take.
      return new Proxy(handle, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (typeof value !== "function") return value;
          return (...args: unknown[]): unknown => {
            if (["writeFile", "sync", "close"].includes(String(property))) {
              steps.push(String(property));
            }
            return (value as (...called: unknown[]) => unknown).apply(target, args);
          };
        },
      });
    });

    await writeWalkthrough(options);

    expect(steps).toEqual(["open wx", "writeFile", "sync", "close"]);
  });

  it("gives the error as it is when the file can't be opened for any reason but being there", async () => {
    const { dir } = await homeWithRun();
    const { options } = writing(dir, path.join(dir, "walkthrough.json"));
    const real = await vi.importActual<typeof FsPromises>("node:fs/promises");
    vi.mocked(open).mockImplementation((file, flags, mode) =>
      String(file) === options.file
        ? Promise.reject(
            Object.assign(new Error("EACCES: permission denied, open"), { code: "EACCES" }),
          )
        : real.open(file, flags, mode),
    );

    await expect(writeWalkthrough(options)).rejects.toThrow("EACCES: permission denied, open");
  });

  describe("a file that can't be written whole", () => {
    const FULL = "ENOSPC: no space left on device, write";

    /**
     * Have the write of `file` fail, as a full disk does, once it's open. Gives the file's close, as
     * it's called.
     */
    async function failWriting(file: string): Promise<MockInstance[]> {
      const real = await vi.importActual<typeof FsPromises>("node:fs/promises");
      const closes: MockInstance[] = [];
      vi.mocked(open).mockImplementation(async (target, flags, mode) => {
        const handle = await real.open(target, flags, mode);
        if (String(target) !== file) return handle;
        vi.spyOn(handle, "writeFile").mockRejectedValue(
          Object.assign(new Error(FULL), { code: "ENOSPC" }),
        );
        closes.push(vi.spyOn(handle, "close"));
        return handle;
      });
      return closes;
    }

    it("is taken away, with the error given, so the same name can be tried again", async () => {
      const { dir } = await homeWithRun();
      const { logger, options } = writing(dir, path.join(dir, "walkthrough.json"));
      const closes = await failWriting(options.file);

      await expect(writeWalkthrough(options)).rejects.toThrow(FULL);

      // Closed, though it wasn't written, and taken away.
      expect(closes).toHaveLength(1);
      expect(closes[0]).toHaveBeenCalledTimes(1);
      expect(existsSync(options.file)).toBe(false);
      expect(logger.entries).toEqual([]);
      // The disk has room again.
      vi.mocked(open).mockReset();
      await writeWalkthrough(options);
      expect((await writtenIn(options.file)).pages).toHaveLength(3);
    });

    it("is reported when it can't be taken away, and the error is still given", async () => {
      const { dir } = await homeWithRun();
      const { logger, options } = writing(dir, path.join(dir, "walkthrough.json"));
      await failWriting(options.file);
      // The removal is refused, as when a program is holding the new file.
      vi.mocked(rm).mockRejectedValueOnce(
        Object.assign(new Error("EPERM: operation not permitted, unlink"), { code: "EPERM" }),
      );

      await expect(writeWalkthrough(options)).rejects.toThrow(FULL);

      expect(logger.entries).toEqual([
        {
          level: "warn",
          message: `${options.file} is incomplete, and couldn't be removed (EPERM: operation not permitted, unlink). Delete it before you try again.`,
        },
      ]);
      expect(existsSync(options.file)).toBe(true);
    });
  });
});

describe("the package's entry", () => {
  it("exports the walkthrough file's functions", async () => {
    const api = await import("../src/index.js");

    expect(api.writeWalkthrough).toBe(writeWalkthrough);
    expect(api.parseWalkthrough).toBe(parseWalkthrough);
    expect(api.walkthroughOf).toBe(walkthroughOf);
    expect(api.walkthroughProblem).toBe(walkthroughProblem);
    expect(api.walkthroughJson).toBe(walkthroughJson);
  });

  it("exports its types", () => {
    // This compiles only if the entry exports each of these types.
    const types: [
      Api.WriteWalkthroughOptions | null,
      Api.WriteWalkthroughResult | null,
      Api.Walkthrough | null,
      Api.WalkthroughPage | null,
      Api.WalkthroughSettings | null,
      Api.WalkthroughOrigin | null,
    ] = [null, null, null, null, null, null];

    expect(types).toHaveLength(6);
  });
});
