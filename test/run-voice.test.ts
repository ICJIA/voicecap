/**
 * The recording a driver makes of NVDA's voice on each attempt at a page: the run keeps it in the
 * page's folder (voice.webm), and records it in the page's record, apart from the page's transcripts
 * and beside the page's screenshot and axe's results. A recording that can't be kept is recorded as
 * the reason, and the page is read as usual.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ForegroundError } from "../src/drivers/types.js";
import type * as Api from "../src/index.js";
import type { FileHash, PageRecord } from "../src/model.js";
import { runAudit, type RunAuditOptions, type RunAuditResult } from "../src/run/audit.js";
import { attemptsDir, pageDir } from "../src/run/paths.js";
import { readRunJson } from "../src/run/store.js";
import { voiceRecordOf } from "../src/share/records.js";
import { fileHash } from "../src/transcripts/write.js";
import { EnvironmentError } from "../src/util/errors.js";
import { sealOf } from "../src/util/hash.js";
import { createMemoryLogger } from "../src/util/log.js";
import { verifyHome } from "../src/verify.js";
import type * as Encode from "../src/voice/encode.js";
import { encodeVoice } from "../src/voice/encode.js";
import { config, ISO_MS, options, outDir, setup, sitePages } from "./helpers/run-site.js";
import {
  ScriptedDriver,
  type ScriptedOptions,
  type ScriptedPage,
  type ScriptedVoice,
} from "./helpers/scripted-driver.js";
import { busySound, silence, speechAndPauses } from "./helpers/voice-signal.js";

// The encoder is the real one, except in the one test that makes it fail.
vi.mock("../src/voice/encode.js", async (importOriginal) => {
  const actual = await importOriginal<typeof Encode>();
  return { ...actual, encodeVoice: vi.fn(actual.encodeVoice) };
});

/** Two seconds of speech and pauses: what a page's recording is, unless a test says otherwise. */
const SPEECH = speechAndPauses();

/** Where a page's voice.webm is in the folder of the page itself, and in an earlier attempt's. */
const voiceOf = (dir: string, run: RunAuditResult, slug = "home") =>
  path.join(pageDir(outDir(dir), run.runId, slug), "voice.webm");
const earlierVoiceOf = (dir: string, run: RunAuditResult, attempt: number) =>
  path.join(attemptsDir(outDir(dir), run.runId, "home"), String(attempt), "voice.webm");

/** Whether a file holds exactly these bytes. */
const holds = async (file: string, bytes: Uint8Array) =>
  Buffer.compare(await readFile(file), Buffer.from(bytes)) === 0;

/** The file the encoder makes of this sound. */
const encoded = async (samples: Int16Array) => (await encodeVoice(samples)).webm;

/** Check the home as `voicecap verify` does; the number of problems it found. */
async function problemsIn(dir: string): Promise<number> {
  const home = path.join(dir, "transcripts");
  return (await verifyHome({ home, logger: createMemoryLogger() })).problems;
}

/** Whether any PCM file a scripted driver made is still there. */
const pcmLeft = (driver: ScriptedDriver) => driver.pcmFiles.filter((file) => existsSync(file));

/**
 * A scripted driver that keeps a timeline of what happens in a run: each call to the driver, as it's
 * made ("recordVoice"), and each event of the run's log, as it's recorded ("event page-started"; the
 * run and the driver share the log). `fail` makes a call fail, as the driver's own option does.
 */
function watched(pages: ScriptedPage[], fail: NonNullable<ScriptedOptions["fail"]> = () => null) {
  const timeline: string[] = [];
  const driver = new ScriptedDriver(pages, {
    fail: (command, url, call) => {
      timeline.push(command);
      return fail(command, url, call);
    },
  });
  const given = driver.setEventRecorder.bind(driver);
  driver.setEventRecorder = (recorder) => {
    const record = recorder.record.bind(recorder);
    recorder.record = (event, at) => {
      timeline.push(`event ${event.type}`);
      record(event, at);
    };
    given(recorder);
  };
  return { driver, timeline };
}

/**
 * A run of the scripted site's home page alone, whose recording gives `voice` (none, for a driver
 * that can't record); `page` changes the page, and `extra` the run's options.
 */
async function runHome(
  voice: ScriptedVoice | readonly ScriptedVoice[] | undefined,
  extra: Partial<RunAuditOptions> = {},
  page: Partial<ScriptedPage> = {},
) {
  const dir = await setup(["/"]);
  const driver = new ScriptedDriver(sitePages({ home: { ...(voice ? { voice } : {}), ...page } }));
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

/** A sound that peaks at `peak`: silence but for one sample. */
function peakingAt(peak: number): Int16Array {
  const samples = silence(2);
  samples[100] = peak;
  return samples;
}

/** The home page with nothing for NVDA to say: no lines, no headings, nothing to Tab to. */
const NO_WORDS: Partial<ScriptedPage> = { lines: [], headings: [], stops: [], leaving: "" };

describe("a page's recording of NVDA's voice, in a run", () => {
  it("records each attempt from its start to its end", async () => {
    const dir = await setup();
    const voice = { samples: SPEECH };
    const { driver, timeline } = watched(
      sitePages({ home: { voice }, about: { voice }, resources: { voice } }),
    );
    const run = await runAudit(options(dir, driver));
    expect(run.outcome).toBe("completed");

    // Each page's attempt: recorded before it's begun, stopped once it has ended.
    const marks = [
      "recordVoice",
      "event page-started",
      "stopVoice",
      "event page-finished",
      "discardVoice",
    ];
    expect(timeline.filter((mark) => marks.includes(mark))).toEqual(
      Array.from({ length: 3 }, () => [
        "recordVoice",
        "event page-started",
        "stopVoice",
        "event page-finished",
      ]).flat(),
    );
    // The recording is begun before the page opens, and stopped after the last pass's last step:
    // nothing the driver does comes between its stop and the attempt's end.
    const start = timeline.indexOf("recordVoice");
    expect(timeline.slice(start, start + 3)).toEqual([
      "recordVoice",
      "event page-started",
      "openPage",
    ]);
    const stop = timeline.indexOf("stopVoice");
    expect(timeline[stop + 1]).toBe("event page-finished");
    expect(["nextFocusable", "focusedElement", "focusInDocument"]).toContain(timeline[stop - 1]);
    expect(timeline.lastIndexOf("openPage", stop)).toBeGreaterThan(start);
    // Each page's recording is its own.
    expect(driver.calls.filter((call) => call === "recordVoice")).toHaveLength(3);
    expect(new Set(driver.pcmFiles).size).toBe(3);
  });

  it("writes voice.webm, and records its fingerprint, length, and lost time with the page", async () => {
    const { dir, run, page } = await runHome({ samples: SPEECH, lostMs: 40 });
    expect(run.outcome).toBe("completed");

    const webm = await encoded(SPEECH);
    expect(await holds(voiceOf(dir, run), webm)).toBe(true);
    expect(page.voice).toEqual({
      ...fileHash(webm),
      seconds: 2,
      lostMs: 40,
      recordedAt: expect.stringMatching(ISO_MS) as unknown,
    });
    // Not one of the page's files: a review keeps those to find a page that changed since.
    expect(Object.keys(page.files).sort()).toEqual(TRANSCRIPTS);
    // The record on disk says the same, and the run's seal covers it, so the run verifies.
    const stored = await readRunJson(outDir(dir), run.runId);
    expect(stored.pages[0]?.voice).toEqual(page.voice);
    expect(stored.seal).toBe(sealOf(stored));
    expect(await problemsIn(dir)).toBe(0);
  });

  it("records the recorder's reason as its first line, cut at 300 characters, and reads the page as usual", async () => {
    const reason = "the recorder didn't start: PowerShell couldn't compile its C#: no good";
    const { dir, run, page } = await runHome({
      error: `${reason}\nat the second line\n  and more`,
    });
    expect(page.status).toBe("done");
    expect(page.voice).toEqual({
      error: reason,
      recordedAt: expect.stringMatching(ISO_MS) as unknown,
    });
    expect(existsSync(voiceOf(dir, run))).toBe(false);
    expect(Object.keys(page.files).sort()).toEqual(TRANSCRIPTS);
    expect(await problemsIn(dir)).toBe(0);

    const long = await runHome({ error: "x".repeat(400) });
    expect(long.page.voice).toMatchObject({ error: "x".repeat(300) });
    expect(long.page.status).toBe("done");
  });

  // The recorder's words are kept as it said them, and some name a path: a program a refused target
  // runs, the file .NET couldn't make, the script Add-Type compiled. The record and the page that
  // shows it must not name the account, so the home folder is replaced, as it is in a failure's stack.
  describe("a reason that names the account's home folder", () => {
    const home = os.homedir();
    /** What replaces the home folder: Windows' name for it there, and ~ elsewhere. */
    const token = process.platform === "win32" ? "%USERPROFILE%" : "~";
    const rest = path.join("AppData", "Local", "guidepup", "nvda.exe");
    /** What the recorder might say, and what the record keeps of it. */
    const said = `process 4242 runs ${path.join(home, rest)}, not elsewhere`;
    const kept = `process 4242 runs ${token}${path.sep}${rest}, not elsewhere`;
    const keptAs = (error: string): unknown => ({
      error,
      recordedAt: expect.stringMatching(ISO_MS) as unknown,
    });

    it("has it replaced in what the driver gives as the reason", async () => {
      const { page } = await runHome({ error: said });
      expect(page.status).toBe("done");
      expect(page.voice).toEqual(keptAs(kept));
      expect(JSON.stringify(page.voice)).not.toContain(JSON.stringify(home).slice(1, -1));
    });

    it("has it replaced wherever a reason comes from: a recording that can't begin, a stop that throws, and the encoder", async () => {
      // A recordVoice that throws gives the page its reason through a stand-in recording.
      const began = new ScriptedDriver(sitePages({ home: { voice: { samples: SPEECH } } }), {
        fail: (command) => (command === "recordVoice" ? new EnvironmentError(said) : null),
      });
      const beganRun = await runAudit(options(await setup(["/"]), began));
      expect(beganRun.run.pages[0]?.voice).toEqual(keptAs(kept));

      // A stop that throws, which the run catches.
      const stopped = new ScriptedDriver(sitePages({ home: { voice: { samples: SPEECH } } }), {
        fail: (command) => (command === "stopVoice" ? new Error(said) : null),
      });
      const stoppedRun = await runAudit(options(await setup(["/"]), stopped));
      expect(stoppedRun.run.pages[0]?.voice).toEqual(keptAs(kept));

      // The encoder's message, which the run puts after its own words.
      vi.mocked(encodeVoice).mockRejectedValueOnce(new Error(said));
      const { page } = await runHome({ samples: SPEECH });
      expect(page.voice).toEqual(keptAs(`the recording couldn't be encoded: ${kept}`));
    });

    it("has it replaced before the reason is cut, so a path across the limit leaves none of it", async () => {
      // The home folder begins before the 300th character and ends after it: cut first, a path
      // that's all there but its last letter would be kept, and name the account.
      const lead = "x".repeat(300 - (home.length - 1));
      const { page } = await runHome({ error: `${lead}${home}${path.sep}more` });
      const { error } = page.voice as { error: string };
      expect(error.startsWith(lead)).toBe(true);
      expect(error.length).toBeLessThanOrEqual(300);
      expect(error).not.toContain(home.slice(0, -1));
    });

    it("keeps a reason as it is where Node can't find a home folder", async () => {
      const homedir = vi.spyOn(os, "homedir").mockImplementation(() => {
        throw new Error("A system error occurred: uv_os_homedir returned ENOENT");
      });
      try {
        const { page } = await runHome({ error: said });
        expect(page.status).toBe("done");
        expect(page.voice).toEqual(keptAs(said));
      } finally {
        homedir.mockRestore();
      }
    });
  });

  describe("a recording that makes no file", () => {
    it("is the reason 'the recording is silent' when NVDA said words, whatever peaks at 2 or less", async () => {
      // Silence, and the loudest sample either way up at 2, which is as loud as silence gets.
      for (const samples of [silence(2), peakingAt(2), peakingAt(-2)]) {
        const { dir, driver, run, page } = await runHome({ samples });
        expect(page.status).toBe("done");
        expect(page.voice).toEqual({
          error: "the recording is silent",
          recordedAt: expect.stringMatching(ISO_MS) as unknown,
        });
        expect(existsSync(voiceOf(dir, run))).toBe(false);
        expect(Object.keys(page.files).sort()).toEqual(TRANSCRIPTS);
        expect(pcmLeft(driver)).toEqual([]);
        expect(await problemsIn(dir)).toBe(0);
      }
    });

    it("is kept as a file when the sound peaks at 3, which a page's own quiet can reach", async () => {
      const samples = peakingAt(3);
      const { dir, run, page } = await runHome({ samples });
      expect(page.voice).toMatchObject({ ...fileHash(await encoded(samples)), seconds: 2 });
      expect(existsSync(voiceOf(dir, run))).toBe(true);
    });

    it("keeps a quiet recording of a page with no words, as the file it is", async () => {
      const samples = peakingAt(1);
      // Only the read pass, whose lines are all empty: the other passes say "no next heading" and
      // where Tab goes, which are words.
      const { dir, run, page } = await runHome({ samples }, { passes: ["read"] }, NO_WORDS);
      expect(page.status).toBe("done");
      const steps = (
        JSON.parse(
          await readFile(path.join(pageDir(outDir(dir), run.runId, "home"), "read.json"), "utf8"),
        ) as { steps: { spoken: string }[] }
      ).steps;
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.every((step) => step.spoken === "")).toBe(true);

      expect(page.voice).toMatchObject({ ...fileHash(await encoded(samples)), seconds: 2 });
      expect(await holds(voiceOf(dir, run), await encoded(samples))).toBe(true);
      expect(await problemsIn(dir)).toBe(0);
    });

    it("is the reason 'the recording is empty' for a file with no sound in it, never 'silent'", async () => {
      const { dir, driver, run, page } = await runHome({ bytes: new Uint8Array(0), peak: 0 });
      expect(page.status).toBe("done");
      expect(page.voice).toEqual({
        error: "the recording is empty",
        recordedAt: expect.stringMatching(ISO_MS) as unknown,
      });
      expect(existsSync(voiceOf(dir, run))).toBe(false);
      expect(pcmLeft(driver)).toEqual([]);
    });

    it("is a reason for a file with a half sample at its end, which isn't 16-bit sound", async () => {
      const { dir, driver, run, page } = await runHome({ bytes: new Uint8Array(1001) });
      expect(page.status).toBe("done");
      expect(page.voice).toEqual({
        error: "the recording's file isn't 16-bit sound: it has an odd number of bytes (1001)",
        recordedAt: expect.stringMatching(ISO_MS) as unknown,
      });
      expect(existsSync(voiceOf(dir, run))).toBe(false);
      expect(pcmLeft(driver)).toEqual([]);
      expect(await problemsIn(dir)).toBe(0);
    });

    it("is a reason for a file that can't be read, without naming where it was", async () => {
      const { page } = await runHome({ missing: true });
      expect(page.status).toBe("done");
      expect(page.voice).toEqual({
        error: "the recording's file couldn't be read (ENOENT)",
        recordedAt: expect.stringMatching(ISO_MS) as unknown,
      });
    });

    it("is the encoder's reason when it fails, and the sound is deleted all the same", async () => {
      vi.mocked(encodeVoice).mockRejectedValueOnce(
        new Error(
          "WebAssembly.instantiate(): Out of memory\n    at createEncoder (libopus.js:1:1)",
        ),
      );
      const { dir, driver, run, page } = await runHome({ samples: SPEECH });
      expect(page.status).toBe("done");
      expect(page.voice).toEqual({
        error: "the recording couldn't be encoded: WebAssembly.instantiate(): Out of memory",
        recordedAt: expect.stringMatching(ISO_MS) as unknown,
      });
      expect(existsSync(voiceOf(dir, run))).toBe(false);
      expect(pcmLeft(driver)).toEqual([]);
      expect(await problemsIn(dir)).toBe(0);
    });
  });

  describe("a driver whose recording fails", () => {
    it("gives the page the reason when recordVoice throws, and reads the page as usual", async () => {
      const dir = await setup(["/"]);
      const driver = new ScriptedDriver(sitePages({ home: { voice: { samples: SPEECH } } }), {
        fail: (command) =>
          command === "recordVoice"
            ? new EnvironmentError("the recorder didn't start: nobody answered\nsecond line")
            : null,
      });
      const run = await runAudit(options(dir, driver));
      const page = run.run.pages[0]!;
      expect(page.status).toBe("done");
      expect(page.voice).toEqual({
        error: "the recorder didn't start: nobody answered",
        recordedAt: expect.stringMatching(ISO_MS) as unknown,
      });
      // Nothing was recorded, so nothing was stopped or discarded.
      expect(driver.calls).not.toContain("stopVoice");
      expect(driver.calls).not.toContain("discardVoice");
      expect(Object.keys(page.files).sort()).toEqual(TRANSCRIPTS);
      expect(await problemsIn(dir)).toBe(0);
    });

    it("gives the page the reason when a recording doesn't begin in the time a page has, and reads it as usual", async () => {
      const dir = await setup(["/"]);
      const driver = new ScriptedDriver(sitePages({ home: { voice: { samples: SPEECH } } }), {
        hang: (command) => command === "recordVoice",
      });
      const timeouts = { stepMs: 100, pageMs: 400, driverStartMs: 2000 };
      const run = await runAudit(options(dir, driver, { config: config({ timeouts }) }));
      const page = run.run.pages[0]!;
      expect(page.status).toBe("done");
      expect(page.voice).toEqual({
        error: expect.stringMatching(/^Starting the recording did not finish within /) as unknown,
        recordedAt: expect.stringMatching(ISO_MS) as unknown,
      });
      expect(Object.keys(page.files).sort()).toEqual(TRANSCRIPTS);
      expect(await problemsIn(dir)).toBe(0);
    });

    it("gives the page the reason when a stop throws, and reads the page as usual", async () => {
      const dir = await setup(["/"]);
      const driver = new ScriptedDriver(sitePages({ home: { voice: { samples: SPEECH } } }), {
        fail: (command) =>
          command === "stopVoice" ? new Error("the recorder stopped answering") : null,
      });
      const run = await runAudit(options(dir, driver));
      const page = run.run.pages[0]!;
      expect(page.status).toBe("done");
      expect(page.voice).toEqual({
        error: "the recorder stopped answering",
        recordedAt: expect.stringMatching(ISO_MS) as unknown,
      });
      expect(existsSync(voiceOf(dir, run))).toBe(false);
      expect(await problemsIn(dir)).toBe(0);
    });
  });

  describe("when Ctrl+C comes", () => {
    it("discards the recording of an attempt it stopped, and keeps none", async () => {
      const dir = await setup(["/"]);
      const controller = new AbortController();
      const driver = new ScriptedDriver(sitePages({ home: { voice: { samples: SPEECH } } }));
      // Ctrl+C as the read pass's first key goes out.
      driver.toBottom = () => {
        setTimeout(() => controller.abort(), 20);
        return new Promise(() => {});
      };
      const run = await runAudit(options(dir, driver, { signal: controller.signal }));
      expect(run.outcome).toBe("interrupted");

      expect(driver.calls.filter((call) => call === "recordVoice")).toHaveLength(1);
      expect(driver.calls.filter((call) => call === "discardVoice")).toHaveLength(1);
      expect(driver.calls).not.toContain("stopVoice");
      const saved = (await readRunJson(outDir(dir), run.runId)).pages[0]!;
      expect(saved).toMatchObject({ status: "pending", attempts: 0 });
      expect(saved).not.toHaveProperty("voice");
      expect(existsSync(voiceOf(dir, run))).toBe(false);
      // The driver deleted the sound when it was discarded.
      expect(driver.pcmFiles).toHaveLength(1);
      expect(pcmLeft(driver)).toEqual([]);
    });

    it("is still an interruption when the recording can't be discarded", async () => {
      const dir = await setup(["/"]);
      const controller = new AbortController();
      const driver = new ScriptedDriver(sitePages({ home: { voice: { samples: SPEECH } } }), {
        fail: (command) =>
          command === "discardVoice" ? new Error("the recorder is already gone") : null,
      });
      driver.toBottom = () => {
        setTimeout(() => controller.abort(), 20);
        return new Promise(() => {});
      };
      const run = await runAudit(options(dir, driver, { signal: controller.signal }));
      expect(run.outcome).toBe("interrupted");
      expect(driver.calls).toContain("discardVoice");
    });

    it("doesn't wait for a recording that won't begin", async () => {
      const dir = await setup(["/"]);
      const controller = new AbortController();
      const driver = new ScriptedDriver(sitePages({ home: { voice: { samples: SPEECH } } }), {
        hang: (command) => command === "recordVoice",
      });
      setTimeout(() => controller.abort(), 50);
      // A page has two minutes: only Ctrl+C can end the wait, which a short page time would too.
      const timeouts = { stepMs: 300, pageMs: 120_000, driverStartMs: 2000 };
      const run = await runAudit(
        options(dir, driver, { signal: controller.signal, config: config({ timeouts }) }),
      );
      expect(run.outcome).toBe("interrupted");
      // The attempt never began.
      expect(driver.calls).not.toContain("openPage");
      const saved = (await readRunJson(outDir(dir), run.runId)).pages[0]!;
      expect(saved).toMatchObject({ status: "pending", attempts: 0 });
      expect(saved).not.toHaveProperty("voice");
    });
  });

  describe("when an attempt fails", () => {
    /** A read pass whose first Down Arrow fails, as when another window takes the foreground. */
    const losesForeground = (failures: number) => {
      let reads = 0;
      return (command: string) =>
        command === "nextLine" && ++reads <= failures
          ? new ForegroundError("The browser lost the foreground to another window")
          : null;
    };

    it("moves its voice.webm to attempts/ with its folder, and seals the last attempt's", async () => {
      const dir = await setup(["/"]);
      const first = busySound(1, 3);
      const { driver, timeline } = watched(
        sitePages({ home: { voice: [{ samples: first }, { samples: SPEECH }] } }),
        losesForeground(1),
      );
      const run = await runAudit(options(dir, driver));
      const page = run.run.pages[0]!;
      expect(page).toMatchObject({ status: "done", attempts: 2 });

      // Each attempt is recorded before it begins, and stopped before its end is recorded: the
      // failed one's too, ahead of the failure.
      const marks = [
        "recordVoice",
        "event page-started",
        "stopVoice",
        "event page-failed",
        "event page-finished",
      ];
      expect(timeline.filter((mark) => marks.includes(mark))).toEqual([
        "recordVoice",
        "event page-started",
        "stopVoice",
        "event page-failed",
        "recordVoice",
        "event page-started",
        "stopVoice",
        "event page-finished",
      ]);

      // Each attempt had a recording of its own, stopped as it ended.
      expect(driver.calls.filter((call) => call === "recordVoice")).toHaveLength(2);
      expect(driver.calls.filter((call) => call === "stopVoice")).toHaveLength(2);
      // The first attempt's, with the rest of its folder, unsealed.
      expect(await holds(earlierVoiceOf(dir, run, 1), await encoded(first))).toBe(true);
      expect(existsSync(path.join(path.dirname(earlierVoiceOf(dir, run, 1)), "read.txt"))).toBe(
        true,
      );
      // The last attempt's, which the record is of.
      expect(await holds(voiceOf(dir, run), await encoded(SPEECH))).toBe(true);
      expect(page.voice).toMatchObject({ ...fileHash(await encoded(SPEECH)), seconds: 2 });
      expect(pcmLeft(driver)).toEqual([]);
      expect(await problemsIn(dir)).toBe(0);
    });

    it("is kept for a page whose last attempt failed, so the record accounts for the file", async () => {
      const dir = await setup(["/"]);
      const driver = new ScriptedDriver(sitePages({ home: { voice: { samples: SPEECH } } }), {
        fail: losesForeground(2),
      });
      const run = await runAudit(options(dir, driver, { config: config({ pageAttempts: 2 }) }));
      const page = run.run.pages[0]!;
      expect(page).toMatchObject({ status: "failed", attempts: 2 });
      expect(page.voice).toMatchObject({ ...fileHash(await encoded(SPEECH)), seconds: 2 });
      expect(await holds(voiceOf(dir, run), await encoded(SPEECH))).toBe(true);
      expect(await holds(earlierVoiceOf(dir, run, 1), await encoded(SPEECH))).toBe(true);
      expect(pcmLeft(driver)).toEqual([]);
      expect(await problemsIn(dir)).toBe(0);
    });

    it("leaves no voice in the record of a page whose next attempt couldn't record", async () => {
      const dir = await setup(["/"]);
      // The first session: the page fails after its recording, and the run stops there.
      const first = new ScriptedDriver(sitePages({ home: { voice: { samples: SPEECH } } }), {
        fail: losesForeground(1),
      });
      const stopped = await runAudit(
        options(dir, first, { config: config({ pageAttempts: 1, maxConsecutiveFailures: 1 }) }),
      );
      expect(stopped.outcome).toBe("stopped");
      expect(stopped.run.pages[0]?.voice).toMatchObject(fileHash(await encoded(SPEECH)));

      // The next session tries the failed page again, with a driver that can't record.
      const resumed = await runAudit(options(dir, new ScriptedDriver(sitePages())));
      expect(resumed).toMatchObject({ runId: stopped.runId, outcome: "completed" });
      expect(resumed.run.pages[0]).toMatchObject({ status: "done", attempts: 2 });
      expect(resumed.run.pages[0]).not.toHaveProperty("voice");
      // The first session's recording stays with its attempt.
      expect(existsSync(voiceOf(dir, resumed))).toBe(false);
      expect(await holds(earlierVoiceOf(dir, resumed, 1), await encoded(SPEECH))).toBe(true);
      expect(await problemsIn(dir)).toBe(0);
    });
  });

  it("keeps no recording of a page it skips, or one that answered 4xx or 5xx", async () => {
    const dir = await setup();
    const voice = { samples: SPEECH };
    const pages = sitePages({
      home: { contentType: "application/pdf", voice },
      about: { finalUrl: "https://elsewhere.example/about", voice },
      resources: { status: 404, voice },
    });
    const driver = new ScriptedDriver(pages);
    const run = await runAudit(options(dir, driver));
    expect(run.run.pages.map((page) => page.status)).toEqual(["skipped", "skipped", "failed"]);
    for (const page of run.run.pages) {
      expect(page).not.toHaveProperty("voice");
      expect(existsSync(voiceOf(dir, run, page.slug))).toBe(false);
    }
    // Each was recorded as its attempt began, and the recording thrown away as it ended.
    expect(driver.calls.filter((call) => call === "recordVoice")).toHaveLength(3);
    expect(driver.calls.filter((call) => call === "discardVoice")).toHaveLength(3);
    expect(driver.calls).not.toContain("stopVoice");
    expect(pcmLeft(driver)).toEqual([]);
    expect(await problemsIn(dir)).toBe(0);

    // A 5xx is tried again, and is no more kept for it.
    const failing = await setup(["/"]);
    const unwell = new ScriptedDriver(sitePages({ home: { status: 503, voice } }));
    const tried = await runAudit(options(failing, unwell, { config: config({ pageAttempts: 2 }) }));
    expect(tried.run.pages[0]).toMatchObject({ status: "failed", attempts: 2 });
    expect(tried.run.pages[0]).not.toHaveProperty("voice");
    expect(existsSync(voiceOf(failing, tried))).toBe(false);
    expect(unwell.calls.filter((call) => call === "recordVoice")).toHaveLength(2);
    expect(unwell.calls.filter((call) => call === "discardVoice")).toHaveLength(2);
    expect(unwell.calls).not.toContain("stopVoice");
    expect(pcmLeft(unwell)).toEqual([]);
    expect(await problemsIn(failing)).toBe(0);
  });

  it("keeps no recording of a page that wouldn't open, which was never read", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(
      sitePages({
        home: {
          voice: { samples: SPEECH },
          openError: new ForegroundError("The browser lost the foreground to another window"),
        },
      }),
    );
    const run = await runAudit(options(dir, driver, { config: config({ pageAttempts: 2 }) }));
    expect(run.run.pages[0]).toMatchObject({ status: "failed", attempts: 2 });
    expect(run.run.pages[0]).not.toHaveProperty("voice");
    expect(driver.calls).not.toContain("stopVoice");
    expect(driver.calls.filter((call) => call === "discardVoice")).toHaveLength(2);
    expect(pcmLeft(driver)).toEqual([]);
  });

  it("records no voice for a driver that can't record", async () => {
    const { dir, driver, run, page } = await runHome(undefined);
    expect(page.status).toBe("done");
    expect(driver.recordVoice).toBeUndefined();
    expect(page).not.toHaveProperty("voice");
    expect(existsSync(voiceOf(dir, run))).toBe(false);
    expect(await readFile(path.join(run.runDir, "run.json"), "utf8")).not.toContain('"voice"');
    expect(await problemsIn(dir)).toBe(0);
  });

  it("deletes the PCM after encoding, and after a discard", async () => {
    // After encoding: every attempt's file is read, encoded, and deleted.
    const { driver, page } = await runHome({ samples: SPEECH });
    expect(page.voice).toHaveProperty("sha256");
    expect(driver.pcmFiles).toHaveLength(1);
    expect(pcmLeft(driver)).toEqual([]);
    // The scripted driver's own folder for them went when the run stopped it.
    expect(existsSync(path.dirname(driver.pcmFiles[0]!))).toBe(false);

    // After a discard: the page was never read.
    const skipped = await runHome({ samples: SPEECH }, {}, { contentType: "application/pdf" });
    expect(skipped.driver.pcmFiles).toHaveLength(1);
    expect(skipped.driver.calls).toContain("discardVoice");
    expect(pcmLeft(skipped.driver)).toEqual([]);
  });

  it("seals the voice record with the run", async () => {
    const { dir, run } = await runHome({ samples: SPEECH });
    const stored = await readRunJson(outDir(dir), run.runId);
    expect(stored.seal).toBe(sealOf(stored));

    // A record changed after the seal doesn't match it, and verify names the run.
    (stored.pages[0]!.voice as FileHash).bytes += 1;
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
});

describe("a page's voice record, read for the shareable page", () => {
  /** A page record holding only what voiceRecordOf reads: this in place of its voice record. */
  const withVoice = (voice: unknown) => ({ voice }) as unknown as PageRecord;
  const recordedAt = "2026-10-09T11:02:05.000-05:00";
  const kept = { ...fileHash("a recording"), seconds: 2, lostMs: 0, recordedAt };

  it("is none for a page that has none", () => {
    expect(voiceRecordOf(withVoice(undefined))).toBeUndefined();
    expect(voiceRecordOf({} as PageRecord)).toBeUndefined();
  });

  it("is the record, when it's the fingerprint of a recording or the reason there's none", () => {
    expect(voiceRecordOf(withVoice(kept))).toEqual(kept);
    const error = { error: "the recording is silent", recordedAt };
    expect(voiceRecordOf(withVoice(error))).toEqual(error);
  });

  it("is unreadable when it's of no kind voicecap writes", () => {
    for (const odd of [null, "voice", 7, true, [], [kept], {}, { recordedAt }, { sha256: "abc" }]) {
      expect(voiceRecordOf(withVoice(odd)), JSON.stringify(odd)).toBe("unreadable");
    }
  });
});

describe("the package's entry", () => {
  it("exports the name of a page's voice file", async () => {
    const api = await import("../src/index.js");

    expect(api.VOICE_FILE).toBe("voice.webm");
  });

  it("exports the types of a driver's recording of NVDA's voice, and of what a page's record keeps of it", () => {
    // This compiles only if the entry exports each of these types.
    const types: [
      // What `ScreenReaderDriver.recordVoice` gives, and what its `stop()` gives: the sound's file
      // and what it comes to, or why there's none.
      Api.VoiceRecording | null,
      Api.VoiceCapture | null,
      // The record itself (`PageRecord.voice`).
      Api.VoiceRecord | null,
    ] = [null, null, null];

    expect(types).toHaveLength(3);
  });
});
