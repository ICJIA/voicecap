import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { powershellCommand } from "../src/drivers/guidepup/windows.js";
import {
  RECORDER_SCRIPT,
  RECORDER_SPAWN_OPTIONS,
  startRecorder,
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
        "recording one program's sound needs Windows 10 build 20348 or later; this is build 19045.",
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
      "the recorder didn't start: recording one program's sound needs Windows 10 build 20348 or later; this is build 19045 " +
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

  it("ends a helper that doesn't answer within commandMs, and every later call rejects with 'the recorder stopped answering'", async () => {
    const helper = fake({ ignore: ["stop"] });
    const recorder = await startRecorder({ spawnRecorder: helper.spawnRecorder, commandMs: 300 });
    await recorder.target(4242, NVDA);
    await recorder.start(HOME);
    await rejectsWith(recorder.stop(), "the recorder stopped answering");
    expect(helper.children[0]!.killed).toBe(true);
    await exit(helper.children[0]!);

    await rejectsWith(recorder.target(4242, NVDA), "the recorder stopped answering");
    await rejectsWith(recorder.start(ABOUT), "the recorder stopped answering");
    await rejectsWith(recorder.stop(), "the recorder stopped answering");
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
