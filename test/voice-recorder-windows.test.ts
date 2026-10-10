import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it, type TestContext } from "vitest";

import { RECORDER_SCRIPT, startRecorder } from "../src/drivers/guidepup/voice-recorder.js";
import { EnvironmentError, errorMessage } from "../src/util/errors.js";

/**
 * The real helper, on Windows: Windows PowerShell running RECORDER_SCRIPT, with its C#. What it
 * records is a program that plays nothing, a Windows PowerShell that only sleeps, so no sound is
 * made, and no screen reader is started. It runs only when VOICECAP_SOUND_TEST=1 is set, and never
 * in CI.
 */
describe.runIf(process.platform === "win32" && process.env.VOICECAP_SOUND_TEST === "1")(
  "the real recorder, on Windows",
  () => {
    const POWERSHELL = path.join(
      process.env.SystemRoot ?? String.raw`C:\Windows`,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );

    /** A Windows PowerShell that sleeps `seconds` and plays nothing, ended when the test is. */
    function sleeper(ctx: TestContext, seconds: number): ChildProcess & { pid: number } {
      const child = spawn(
        POWERSHELL,
        ["-NoProfile", "-NonInteractive", "-Command", `Start-Sleep -Seconds ${seconds}`],
        { windowsHide: true, stdio: "ignore" },
      );
      ctx.onTestFinished(() => {
        child.kill();
      });
      if (child.pid === undefined) throw new Error("Windows PowerShell didn't start.");
      return child as ChildProcess & { pid: number };
    }

    /** A new folder whose path has spaces and a letter outside ASCII, deleted after the test. */
    async function folder(ctx: TestContext): Promise<string> {
      const made = await mkdtemp(path.join(os.tmpdir(), "voicecap-voice José Smith "));
      ctx.onTestFinished(() => rm(made, { recursive: true, force: true }));
      return made;
    }

    it("records a silent program on the wall clock", async (ctx) => {
      const target = sleeper(ctx, 3);
      const pcm = path.join(await folder(ctx), "a b.pcm");
      const recorder = await startRecorder();
      ctx.onTestFinished(() => recorder.close());
      await recorder.target(target.pid, POWERSHELL);

      const asked = Date.now();
      await recorder.start(pcm);
      const started = performance.now();
      const answered = Date.now();
      await delay(1_500);
      const measured = (performance.now() - started) / 1_000;
      const stop = await recorder.stop();
      await ctx.annotate(
        `${stop.frames} frames (${stop.frames / 16}ms) in ${(measured * 1_000).toFixed(2)}ms measured; peak ${stop.peak}, lost ${stop.lostMs}ms`,
      );

      expect(Math.abs(stop.frames / 16_000 - measured)).toBeLessThanOrEqual(0.005);
      expect(stop.peak).toBeLessThanOrEqual(2);
      expect(stop.lostMs).toBe(0);
      expect(stop.targetExited).toBe(false);
      // The file is at the path asked for, spaces, "é", and all.
      expect((await stat(pcm)).size).toBe(stop.frames * 2);
      // Frame 0 is the moment the recording started: after it was asked for, before it said so.
      const first = Date.parse(stop.firstSampleAt);
      expect(first).toBeGreaterThanOrEqual(asked - 1);
      expect(first).toBeLessThanOrEqual(answered + 1);

      const closing = performance.now();
      await recorder.close();
      expect(performance.now() - closing).toBeLessThan(5_000);
    }, 60_000);

    // Every other test here ends the helper with a quit. A voicecap that is killed sends none: its
    // input just ends, and the helper must stop recording and exit by itself, or it would outlive it.
    it("stops and exits by itself when its input ends in the middle of a recording", async (ctx) => {
      const target = sleeper(ctx, 8);
      const pcm = path.join(await folder(ctx), "input-ends.pcm");
      const helpers: ChildProcess[] = [];
      const recorder = await startRecorder({
        spawnRecorder: (file, args, options) => {
          const child = spawn(file, [...args], options);
          helpers.push(child);
          return child;
        },
      });
      ctx.onTestFinished(async () => {
        await recorder.close();
        for (const child of helpers) child.kill();
      });
      const running = helpers[0];
      if (running === undefined) throw new Error("The recorder started no helper.");
      await recorder.target(target.pid, POWERSHELL);

      await recorder.start(pcm);
      const started = performance.now();
      await delay(800);
      // No quit: the input ends, as it does when the process that owns it does.
      const ended = once(running, "exit");
      const inputEnded = performance.now();
      running.stdin?.end();
      const outcome = await Promise.race([
        ended.then(([code]) => ({ code: code as number | null })),
        delay(10_000).then(() => "never" as const),
      ]);
      const exited = performance.now();
      expect(outcome).toEqual({ code: 0 });
      // It ended itself: it wasn't killed, and the program it was recording wasn't touched.
      expect(running.killed).toBe(false);
      expect(target.exitCode).toBeNull();

      // The recording was stopped where the input ended, not abandoned: whole samples, of the time
      // between the start and the end of the input, give or take the frames either side of it.
      const bytes = (await stat(pcm)).size;
      const recorded = bytes / 32_000;
      await ctx.annotate(
        `${bytes} bytes (${(recorded * 1_000).toFixed(0)} ms) for ${(inputEnded - started).toFixed(0)} ms to the end of the input, and ${(exited - started).toFixed(0)} ms to the exit`,
      );
      expect(bytes % 2).toBe(0);
      expect(recorded).toBeGreaterThanOrEqual((inputEnded - started) / 1_000 - 0.1);
      expect(recorded).toBeLessThanOrEqual((exited - started) / 1_000 + 0.1);
    }, 60_000);

    it("says when the program it records has exited", async (ctx) => {
      const target = sleeper(ctx, 1);
      const recorder = await startRecorder();
      ctx.onTestFinished(() => recorder.close());
      await recorder.target(target.pid, POWERSHELL);
      await recorder.start(path.join(await folder(ctx), "exits.pcm"));
      if (target.exitCode === null) await once(target, "exit");
      // The helper looks every 20 ms.
      await delay(200);
      const stop = await recorder.stop();
      expect(stop.targetExited).toBe(true);
      expect(stop.peak).toBeLessThanOrEqual(2);
    }, 60_000);

    it("records only the program named", async (ctx) => {
      const target = sleeper(ctx, 3);
      const recorder = await startRecorder();
      ctx.onTestFinished(() => recorder.close());
      // Taken first, as the NVDA a run started is, then refused, as a new one could be.
      await recorder.target(target.pid, POWERSHELL);
      const nvda = String.raw`C:\Program Files (x86)\NVDA\nvda.exe`;
      const error = await recorder.target(target.pid, nvda).then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(EnvironmentError);
      expect(errorMessage(error).toLowerCase()).toBe(
        `process ${target.pid} runs ${POWERSHELL}, not ${nvda}`.toLowerCase(),
      );
      // The program it had before is forgotten: it records nothing, never that one.
      await expect(recorder.start(path.join(await folder(ctx), "none.pcm"))).rejects.toThrow(
        "the recorder has no program to record",
      );
    }, 60_000);

    it("says why it can't start", async () => {
      const lookup = String.raw`[int](Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuildNumber`;
      const older = RECORDER_SCRIPT.replace(lookup, "19045");
      expect(older).not.toBe(RECORDER_SCRIPT);
      await expect(startRecorder({ script: older })).rejects.toThrow(
        "the recorder didn't start: recording one program's sound needs Windows 11 or Windows Server 2022 (Windows build 20348 or later); this is build 19045",
      );

      // Constrained Language Mode, as AppLocker or WDAC can set, blocks Add-Type.
      const constrained = `$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'\n${RECORDER_SCRIPT}`;
      const error = await startRecorder({ script: constrained }).then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(EnvironmentError);
      // The rest is Windows' own message, in Windows' language.
      expect(errorMessage(error)).toMatch(
        /^the recorder didn't start: PowerShell couldn't compile its C#: \S.*$/,
      );
    }, 60_000);
  },
);
