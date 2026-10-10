import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { powershellCommand } from "../src/drivers/guidepup/windows.js";
import {
  RECORDER_SCRIPT,
  recorderIsGone,
  RECORDER_SPAWN_OPTIONS,
  startRecorder,
  type RecorderChild,
  type RecorderStop,
  type SpawnRecorder,
} from "../src/drivers/guidepup/voice-recorder.js";
import { EnvironmentError, errorMessage } from "../src/util/errors.js";

/** The fake helper: a Node script that speaks the recorder's JSON lines (see its own comment). */
const FAKE = fileURLToPath(new URL("./helpers/fake-recorder.mjs", import.meta.url));

/** What the fake does, as its one argument says (see test/helpers/fake-recorder.mjs). */
interface FakeScript {
  failed?: string;
  ready?: false;
  stderr?: string;
  exit?: number;
  stopped?: RecorderStop;
  stopErrors?: string[];
  exitedAfterStart?: true;
  ignore?: ("target" | "start" | "stop" | "quit")[];
  exitOn?: "target" | "start" | "stop";
  stay?: true;
  refuse?: number[];
}

/** Every fake started, so none outlives its test. */
const started: ChildProcess[] = [];

afterEach(async () => {
  const running = started.splice(0).filter((child) => !ended(child));
  for (const child of running) child.kill();
  await Promise.all(running.map((child) => once(child, "exit")));
});

/** Whether `child` has exited. */
function ended(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * The recorder's helper, faked: `spawnRecorder` starts the fake, scripted by `script`, in place of
 * Windows PowerShell, and keeps what it was asked to start (`calls`). `read` is each line the fake
 * read, as it echoed it: the command, and the line as it came.
 */
function fake(script: FakeScript = {}) {
  const calls: Parameters<SpawnRecorder>[] = [];
  const children: ChildProcess[] = [];
  const read: { command: unknown; line: string }[] = [];
  const spawnRecorder: SpawnRecorder = (file, args, options) => {
    calls.push([file, args, options]);
    const child = spawn(process.execPath, [FAKE, JSON.stringify(script)], options);
    started.push(child);
    children.push(child);
    createInterface({ input: child.stdout }).on("line", (line) => {
      const echo = JSON.parse(line) as { read?: unknown; line?: string };
      if ("read" in echo) read.push({ command: echo.read, line: echo.line ?? "" });
    });
    return child;
  };
  return { spawnRecorder, calls, children, read };
}

/** Checks that `promise` rejects with an EnvironmentError that says exactly `message`. */
async function rejectsWith(promise: Promise<unknown>, message: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(EnvironmentError);
  expect(errorMessage(error)).toBe(message);
}

/** Resolves once `child` has exited, at once when it already has. */
async function exit(child: ChildProcess): Promise<void> {
  if (!ended(child)) await once(child, "exit");
}

const NVDA = String.raw`C:\Users\cschw\AppData\Local\guidepup\nvda\all\0.2.1-2026.2\extracted\nvda.exe`;
const HOME = String.raw`C:\Users\cschw\AppData\Local\Temp\voicecap-voice-4242\home.pcm`;
const ABOUT = String.raw`C:\Users\cschw\AppData\Local\Temp\voicecap-voice-4242\about.pcm`;
const STOPPED: RecorderStop = {
  frames: 24_016,
  lostMs: 30,
  peak: 9_123,
  firstSampleAt: "2026-10-09T14:03:07.215Z",
  targetExited: false,
};
const DEVICE_GONE =
  "the recording failed: the sound device changed or went away (0x88890004 AUDCLNT_E_DEVICE_INVALIDATED)";

describe("the recorder", () => {
  it("starts, targets, records, and stops", async () => {
    const helper = fake({ stopped: STOPPED });
    const recorder = await startRecorder({ spawnRecorder: helper.spawnRecorder });
    // Windows PowerShell, started with no shell, and the paths only on its input.
    expect(helper.calls).toEqual([
      [
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", powershellCommand(RECORDER_SCRIPT)],
        RECORDER_SPAWN_OPTIONS,
      ],
    ]);
    expect(RECORDER_SPAWN_OPTIONS).not.toHaveProperty("shell");

    await recorder.target(4242, NVDA);
    await recorder.start(HOME);
    await expect(recorder.stop()).resolves.toEqual(STOPPED);
    // A page after it records again, with the same helper.
    await recorder.start(ABOUT);
    await expect(recorder.stop()).resolves.toEqual(STOPPED);
    await recorder.close();

    expect(helper.read.map(({ command }) => command)).toEqual([
      { target: { pid: 4242, image: NVDA } },
      { start: { pcm: HOME } },
      { stop: true },
      { start: { pcm: ABOUT } },
      { stop: true },
      { quit: true },
    ]);
    expect(helper.calls[0]![1].join(" ")).not.toContain("voicecap-voice-4242");
  });

  it("sends paths with spaces and non-ASCII letters intact", async () => {
    const helper = fake();
    const recorder = await startRecorder({ spawnRecorder: helper.spawnRecorder });
    const image = String.raw`C:\Users\José Smith\AppData\Local\guidepup\nvda\nvda.exe`;
    const pcm = String.raw`C:\Users\José Smith\AppData\Local\Temp\voicecap-voice-4242\a b “quoted” ‘x’ 👋.pcm`;
    await recorder.target(4242, image);
    await recorder.start(pcm);
    await recorder.stop();
    await recorder.close();

    const [targeted, recorded] = helper.read;
    expect(targeted?.command).toEqual({ target: { pid: 4242, image } });
    expect(recorded?.command).toEqual({ start: { pcm } });
    // Each line is ASCII alone, whatever the code page PowerShell reads its input in.
    for (const { line } of helper.read) expect(line).toMatch(/^[\x20-\x7e]+$/);
    expect(recorded?.line).toBe(
      String.raw`{"start":{"pcm":"C:\\Users\\Jos\u00e9 Smith\\AppData\\Local\\Temp\\voicecap-voice-4242\\a b \u201cquoted\u201d \u2018x\u2019 \ud83d\udc4b.pcm"}}`,
    );
  });

  it("rejects with the helper's reason when it can't start", async () => {
    const helper = fake({
      failed:
        "recording one program's sound needs Windows 11 or Windows Server 2022 (Windows build 20348 or later); this is build 19045.",
      stderr: [
        'Exception setting "OutputEncoding": "The handle is invalid."',
        "",
        "At line:1 char:7",
        "+ try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } ...",
        "    + CategoryInfo          : NotSpecified: (:) [], SetValueInvocationException",
        "",
      ].join("\r\n"),
    });
    await rejectsWith(
      startRecorder({ spawnRecorder: helper.spawnRecorder }),
      "the recorder didn't start: recording one program's sound needs Windows 11 or Windows Server 2022 (Windows build 20348 or later); this is build 19045 " +
        '(Exception setting "OutputEncoding": "The handle is invalid." At line:1 char:7 + try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } ...)',
    );
    // It ended by itself, having said why.
    await exit(helper.children[0]!);
    expect(helper.children[0]!.exitCode).toBe(1);
    expect(helper.children[0]!.killed).toBe(false);
  });

  it("says why when PowerShell ends or can't be started", async () => {
    const ending = fake({
      ready: false,
      stderr: "The term 'Add-Type' is not recognized.\r\n",
      exit: 1,
    });
    await rejectsWith(
      startRecorder({ spawnRecorder: ending.spawnRecorder }),
      "the recorder didn't start: PowerShell ended with exit code 1 (The term 'Add-Type' is not recognized)",
    );

    const missing: SpawnRecorder = (_file, args, options) =>
      spawn("voicecap-no-such-program", [...args], options);
    await rejectsWith(
      startRecorder({ spawnRecorder: missing }),
      "the recorder didn't start: PowerShell couldn't be started (spawn voicecap-no-such-program ENOENT)",
    );
  });

  it("kills a helper that isn't ready within readyMs", async () => {
    const helper = fake({ ready: false });
    await rejectsWith(
      startRecorder({ spawnRecorder: helper.spawnRecorder, readyMs: 300 }),
      "the recorder didn't start: PowerShell didn't answer within 0.3 seconds",
    );
    expect(helper.children[0]!.killed).toBe(true);
    await exit(helper.children[0]!);
  });

  // As a helper that has ended gives what PowerShell said, a helper that is only slow does too: a
  // person told that it didn't answer is told what it was saying while they waited.
  it("gives what PowerShell said while it was slow to be ready, as it does for one that ends", async () => {
    const helper = fake({ ready: false, stderr: "Add-Type is taking its time.\r\n" });
    await rejectsWith(
      startRecorder({ spawnRecorder: helper.spawnRecorder, readyMs: 1_500 }),
      "the recorder didn't start: PowerShell didn't answer within 1.5 seconds (Add-Type is taking its time)",
    );
    expect(helper.children[0]!.killed).toBe(true);
    await exit(helper.children[0]!);
  });

  // The one command the fake ignores is the only one that has commandMs to be answered in: the
  // others are never asked of it, so a slow runner can't make this one fail for the wrong command.
  it("ends a helper that doesn't answer within commandMs, and every later call rejects with 'the recorder stopped answering'", async () => {
    const helper = fake({ ignore: ["target"] });
    const recorder = await startRecorder({ spawnRecorder: helper.spawnRecorder, commandMs: 300 });
    await rejectsWith(recorder.target(4242, NVDA), "the recorder stopped answering");
    expect(helper.children[0]!.killed).toBe(true);
    await exit(helper.children[0]!);

    await rejectsWith(recorder.target(4242, NVDA), "the recorder stopped answering");
    await rejectsWith(recorder.start(HOME), "the recorder stopped answering");
    await rejectsWith(recorder.stop(), "the recorder stopped answering");
    await recorder.close();
  });

  // The same, in the middle of a recording, with a time that gives the helper's other answers room:
  // it's the stop that the fake never answers.
  it("ends a helper that stops answering in the middle of a recording", async () => {
    const helper = fake({ ignore: ["stop"] });
    const recorder = await startRecorder({ spawnRecorder: helper.spawnRecorder, commandMs: 2_000 });
    await recorder.target(4242, NVDA);
    await recorder.start(HOME);
    await rejectsWith(recorder.stop(), "the recorder stopped answering");
    expect(helper.children[0]!.killed).toBe(true);
    await exit(helper.children[0]!);
    await rejectsWith(recorder.start(ABOUT), "the recorder stopped answering");
    await recorder.close();
  });

  it("says why when the helper ends, and every later call rejects with that", async () => {
    const helper = fake({ exitOn: "start" });
    const recorder = await startRecorder({ spawnRecorder: helper.spawnRecorder });
    await recorder.target(4242, NVDA);
    const why =
      "the recorder stopped: PowerShell ended with exit code 3 (The fake recorder ended on start)";
    await rejectsWith(recorder.start(HOME), why);
    await rejectsWith(recorder.stop(), why);
    await rejectsWith(recorder.start(ABOUT), why);
    await recorder.close();
  });

  it("keeps a target's exit for the next stop", async () => {
    const helper = fake({ exitedAfterStart: true, stopped: STOPPED });
    const recorder = await startRecorder({ spawnRecorder: helper.spawnRecorder });
    await recorder.target(4242, NVDA);
    await recorder.start(HOME);
    // The helper said the target exited, though its stop doesn't.
    await expect(recorder.stop()).resolves.toEqual({ ...STOPPED, targetExited: true });
    // A process that has exited stays exited: so it is at each stop, until another is the target.
    await recorder.start(ABOUT);
    await expect(recorder.stop()).resolves.toEqual({ ...STOPPED, targetExited: true });
    await recorder.target(5353, NVDA);
    await recorder.start(ABOUT);
    await expect(recorder.stop()).resolves.toEqual(STOPPED);
    await recorder.close();
  });

  // Review Focus 1: after NVDA restarts, a recording is of the new NVDA or of nothing, never the old.
  it("records nothing after a target it refuses, never the program before it", async () => {
    const helper = fake({ refuse: [5353] });
    const recorder = await startRecorder({ spawnRecorder: helper.spawnRecorder });
    await recorder.target(4242, NVDA);
    await recorder.start(HOME);
    await recorder.stop();
    await rejectsWith(
      recorder.target(5353, NVDA),
      String.raw`process 5353 runs C:\Windows\System32\notepad.exe, not ${NVDA}`,
    );
    await rejectsWith(recorder.start(ABOUT), "the recorder has no program to record");
    await recorder.close();
  });

  it("gives a stream error as that stop's reason, and records again at the next start", async () => {
    const helper = fake({ stopErrors: [DEVICE_GONE], stopped: STOPPED });
    const recorder = await startRecorder({ spawnRecorder: helper.spawnRecorder });
    await recorder.target(4242, NVDA);
    await recorder.start(HOME);
    await rejectsWith(recorder.stop(), DEVICE_GONE);
    await recorder.start(ABOUT);
    await expect(recorder.stop()).resolves.toEqual(STOPPED);
    await recorder.close();
    expect(helper.read.map(({ command }) => command)).toEqual([
      { target: { pid: 4242, image: NVDA } },
      { start: { pcm: HOME } },
      { stop: true },
      { start: { pcm: ABOUT } },
      { stop: true },
      { quit: true },
    ]);
  });

  it("rejects a stop whose numbers it can't read", async () => {
    const helper = fake({ stopped: { ...STOPPED, frames: -1 } });
    const recorder = await startRecorder({ spawnRecorder: helper.spawnRecorder });
    await recorder.target(4242, NVDA);
    await recorder.start(HOME);
    await rejectsWith(recorder.stop(), "the recorder's answer to a stop couldn't be read");
    // It's still answering.
    await recorder.start(ABOUT);
    await recorder.close();
  });

  it("answers one command at a time", async () => {
    const helper = fake();
    const recorder = await startRecorder({ spawnRecorder: helper.spawnRecorder });
    const targeting = recorder.target(4242, NVDA);
    expect(() => recorder.start(HOME)).toThrow("The recorder is already answering a command.");
    await targeting;
    await recorder.close();
  });

  it("ends the helper when its stdin ends", async () => {
    // A helper that doesn't take a quit ends when its input does.
    const helper = fake({ ignore: ["quit"] });
    const recorder = await startRecorder({ spawnRecorder: helper.spawnRecorder });
    await recorder.target(4242, NVDA);
    await recorder.start(HOME);
    await recorder.close();
    const child = helper.children[0]!;
    expect(ended(child)).toBe(true);
    expect(child.killed).toBe(false);
    expect(child.exitCode).toBe(0);
    expect(helper.read.at(-1)?.command).toEqual({ quit: true });
    // It's safe to call twice, and nothing is sent after it.
    await recorder.close();
    await rejectsWith(recorder.stop(), "the recorder was closed");

    // One that keeps running is killed.
    const stuck = fake({ stay: true });
    const kept = await startRecorder({ spawnRecorder: stuck.spawnRecorder, commandMs: 300 });
    await kept.close();
    expect(stuck.children[0]!.killed).toBe(true);
    await exit(stuck.children[0]!);
  });

  it("fits its script on a Windows command line", () => {
    // Windows' limit is 32,767 characters, and the script is one argument of it, quoted: each
    // double quote gets a backslash, and so, at most, does each backslash.
    const command = powershellCommand(RECORDER_SCRIPT);
    const quoted = command.length + 2 + (command.match(/["\\]/g) ?? []).length;
    expect("powershell.exe -NoProfile -NonInteractive -Command ".length + quoted).toBeLessThan(
      32_767,
    );
  });
});

/**
 * A helper played line by line by the test, in this process: nothing runs, so what the client reads,
 * and when, is exactly what the test says. `say` writes one line of the helper's output and waits
 * until the client has read it; `sent` is each command the client wrote.
 */
function played() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const events = new EventEmitter();
  const sent: unknown[] = [];
  createInterface({ input: stdin }).on("line", (line) => sent.push(JSON.parse(line)));
  const child: RecorderChild = {
    stdin,
    stdout,
    stderr,
    kill: () => true,
    once(event: "exit" | "error", listener: (value: never) => void) {
      return events.once(event, listener as (...args: unknown[]) => void);
    },
  };
  const say = async (value: unknown): Promise<void> => {
    stdout.write(`${JSON.stringify(value)}\n`);
    // Streams and readline pass a line on a turn of the event loop at a time.
    for (let turn = 0; turn < 4; turn++) await new Promise((resolve) => setImmediate(resolve));
  };
  return { spawnRecorder: (() => child) as SpawnRecorder, say, sent };
}

/** A recorder that is ready, with the program 4242 targeted and a recording of it started. */
async function recordingNvda() {
  const helper = played();
  const starting = startRecorder({ spawnRecorder: helper.spawnRecorder });
  await helper.say({ ready: { build: 26200 } });
  const recorder = await starting;
  const targeting = recorder.target(4242, NVDA);
  await helper.say({ targeted: { pid: 4242 } });
  await targeting;
  const recording = recorder.start(HOME);
  await helper.say({ started: { at: STOPPED.firstSampleAt } });
  await recording;
  return { recorder, helper };
}

/** What a helper says when it refuses the target for 5353. */
const REFUSED = {
  error: String.raw`process 5353 runs C:\Windows\System32\notepad.exe, not ${NVDA}`,
};

// The helper forgets its target as soon as it's sent another, whether or not it takes it, and the
// client does too: what it kept of the program before, and of that program's exit, is gone. Both are
// told apart here, by when the exit is said: before the new target is sent, or after it's refused.
describe("the recorder's memory of the program it records", () => {
  it("forgets that the program exited when it's sent another, though the helper refuses it", async () => {
    const { recorder, helper } = await recordingNvda();
    await helper.say({ "target-exited": { pid: 4242 } });

    const refused = rejectsWith(recorder.target(5353, NVDA), REFUSED.error);
    await helper.say(REFUSED);
    await refused;

    // The exit was of the program it had before: a stop doesn't say it exited.
    const stopping = recorder.stop();
    await helper.say({ stopped: STOPPED });
    await expect(stopping).resolves.toEqual(STOPPED);
  });

  it("forgets the program itself when it's sent another, and hears nothing of its exit after", async () => {
    const { recorder, helper } = await recordingNvda();
    const refused = rejectsWith(recorder.target(5353, NVDA), REFUSED.error);
    await helper.say(REFUSED);
    await refused;
    // Said late, of a program that's let go of: it's no one's exit now.
    await helper.say({ "target-exited": { pid: 4242 } });

    const stopping = recorder.stop();
    await helper.say({ stopped: STOPPED });
    await expect(stopping).resolves.toEqual(STOPPED);
  });

  it("keeps an exit said of the program it records, as before", async () => {
    // The control: with no new target, the same exit is kept, so the two tests above tell the
    // forgetting from not hearing the exit at all.
    const { recorder, helper } = await recordingNvda();
    await helper.say({ "target-exited": { pid: 4242 } });
    const stopping = recorder.stop();
    await helper.say({ stopped: STOPPED });
    await expect(stopping).resolves.toEqual({ ...STOPPED, targetExited: true });
  });
});

// The C# only runs on Windows, and its test (test/voice-recorder-windows.test.ts) only with
// VOICECAP_SOUND_TEST=1, never in CI. What no test of the fake helper can see is pinned here, line by
// line, as the script is written: each is a line a review found missing or wrong, and each a place a
// stray edit could take away unseen, as the tests that do run would pass without it.
describe("the helper's C#, line by line", () => {
  const lines = RECORDER_SCRIPT.split("\n");
  const at = (line: string): number => lines.indexOf(line);

  const STOP = "if (Running) { try { client.Stop(); } catch (Exception) { } }";
  const CAPTURE = "if (capture != null) Marshal.ReleaseComObject(capture);";
  const CLIENT = "if (client != null) Marshal.ReleaseComObject(client);";
  const OPERATION = "if (operation != null) Marshal.FinalReleaseComObject(operation);";
  const FINISHED = "Started.Set(); Finished.Set();";

  it("stops the stream it started, whatever ended the recording, and never lets that stop the cleanup", () => {
    expect(at(STOP)).toBeGreaterThan(-1);
    // A Stop that throws is caught, so every release after it still runs, and Finished is set: the
    // thread PowerShell waits on is never left waiting.
    expect(at(STOP)).toBeLessThan(at(CAPTURE));
    expect(at(FINISHED)).toBeGreaterThan(at(OPERATION));
  });

  it("releases the operation fully, after the objects it holds: the activation's wrapper counts twice", () => {
    expect([at(CAPTURE), at(CLIENT), at(OPERATION)].every((place) => place > -1)).toBe(true);
    expect(at(CAPTURE)).toBeLessThan(at(CLIENT));
    expect(at(CLIENT)).toBeLessThan(at(OPERATION));
    // ReleaseComObject would leave it, and the IAudioClient it holds, to a garbage collection.
    expect(lines).not.toContain("if (operation != null) Marshal.ReleaseComObject(operation);");
  });

  it("writes silence for a buffer that has no address, as for one flagged silent", () => {
    // GetBuffer can say success with no buffer; copying from it would crash the helper.
    expect(lines).toContain(
      "if ((flags & 2) != 0 || data == IntPtr.Zero) Silence(frames - skip); else Copy(data, skip, frames - skip);",
    );
  });
});

// The run tells the person once, in the console, when the helper is gone for the rest of the run
// (see audit.ts), and what it goes by is how a page's reason begins. The reasons below are the ones
// the client really gives, got from it as a helper fails in each way, so that rewording a message
// can't quietly stop the run saying so.
describe("which of the recorder's reasons say that it is gone for the rest of the run", () => {
  /** What the promise rejects with, as its message. */
  async function messageOf(promise: Promise<unknown>): Promise<string> {
    return errorMessage(
      await promise.then(
        () => null,
        (reason: unknown) => reason,
      ),
    );
  }

  it("is each reason the client gives for a helper that didn't start, stopped answering, or ended", async () => {
    const reasons: string[] = [];
    // It says it can't start, and PowerShell ends, can't be started, or is never ready.
    reasons.push(
      await messageOf(
        startRecorder({ spawnRecorder: fake({ failed: "no Add-Type here" }).spawnRecorder }),
      ),
      await messageOf(
        startRecorder({ spawnRecorder: fake({ ready: false, exit: 1 }).spawnRecorder }),
      ),
      await messageOf(
        startRecorder({
          spawnRecorder: (_file, args, options) =>
            spawn("voicecap-no-such-program", [...args], options),
        }),
      ),
      await messageOf(
        startRecorder({ spawnRecorder: fake({ ready: false }).spawnRecorder, readyMs: 300 }),
      ),
    );
    // It stops answering, and every call after that says so.
    const silent = await startRecorder({
      spawnRecorder: fake({ ignore: ["target"] }).spawnRecorder,
      commandMs: 300,
    });
    reasons.push(await messageOf(silent.target(4242, NVDA)), await messageOf(silent.start(HOME)));
    // It ends in the middle of the run, and every call after that says why.
    const ending = await startRecorder({ spawnRecorder: fake({ exitOn: "start" }).spawnRecorder });
    await ending.target(4242, NVDA);
    reasons.push(await messageOf(ending.start(HOME)), await messageOf(ending.stop()));

    expect(reasons).toHaveLength(8);
    for (const reason of reasons) {
      expect(reason.startsWith("the recorder "), reason).toBe(true);
      expect(recorderIsGone(reason), reason).toBe(true);
    }
    // And as a page's record keeps one: its first line, cut at 300 characters, unchanged at its start.
    expect(recorderIsGone(`${reasons[0]}\nat the second line`)).toBe(true);
    await Promise.all([silent.close(), ending.close()]);
  });

  it("is no reason that is one page's: a refusal, a failed recording, a bad answer, a recorder that was closed", async () => {
    const helper = fake({
      refuse: [5353],
      stopErrors: [DEVICE_GONE],
      stopped: { ...STOPPED, frames: -1 },
    });
    const recorder = await startRecorder({ spawnRecorder: helper.spawnRecorder });
    const reasons = [await messageOf(recorder.target(5353, NVDA))];
    reasons.push(await messageOf(recorder.start(HOME)));
    await recorder.target(4242, NVDA);
    await recorder.start(HOME);
    reasons.push(await messageOf(recorder.stop()));
    await recorder.start(ABOUT);
    reasons.push(await messageOf(recorder.stop()));
    await recorder.close();
    reasons.push(await messageOf(recorder.start(HOME)));
    reasons.push(
      "the recording couldn't start: the PCM file couldn't be created (Access is denied)",
      "the recorder can't change programs while it records",
      "NVDA's process wasn't found",
      "NVDA's process ended during the recording",
      "the recording is silent",
      "the recording's folder couldn't be made (EPERM)",
      "Starting the recording did not finish within 60 seconds",
      "",
    );

    expect(reasons.slice(0, 5)).toEqual([
      String.raw`process 5353 runs C:\Windows\System32\notepad.exe, not ${NVDA}`,
      "the recorder has no program to record",
      DEVICE_GONE,
      "the recorder's answer to a stop couldn't be read",
      "the recorder was closed",
    ]);
    for (const reason of reasons) expect(recorderIsGone(reason), reason).toBe(false);
  });
});
