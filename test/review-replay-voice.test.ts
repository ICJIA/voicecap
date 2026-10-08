import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it, vi, type TestContext } from "vitest";

import { powershellCommand } from "../src/drivers/guidepup/windows.js";
import {
  SPEAK_SCRIPT,
  VOICE_SPAWN_OPTIONS,
  asciiJson,
  macVoice,
  sapiRate,
  startSystemVoice,
  windowsVoice,
  type SpawnVoice,
  type Voice,
} from "../src/review-replay/voice.js";
import { EnvironmentError, errorMessage } from "../src/util/errors.js";
import { fakeChild } from "./helpers/replay.js";

type FakeChild = ReturnType<typeof fakeChild>;

/** Whether `promise` has settled after a few turns of the event loop: for one that must wait. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  await delay(30);
  return done;
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

/** A spawn that starts a new fake program each time it's called, and keeps them in order. */
function fakeSpawn(): { spawn: ReturnType<typeof vi.fn<SpawnVoice>>; children: FakeChild[] } {
  const children: FakeChild[] = [];
  const spawn = vi.fn<SpawnVoice>(() => {
    const child = fakeChild();
    children.push(child);
    return child;
  });
  return { spawn, children };
}

/** The Windows voice, on a fake PowerShell that has said it's ready. */
async function readyWindowsVoice(options: { closeMs?: number } = {}) {
  const { spawn, children } = fakeSpawn();
  const starting = windowsVoice({ spawnVoice: spawn, ...options });
  const child = children[0]!;
  child.answer({ ready: true, voice: "Microsoft Zira Desktop" });
  return { voice: await starting, child, spawn };
}

/** The Mac voice, on a fake `say -v ?` that has listed a voice. */
async function readyMacVoice() {
  const { spawn, children } = fakeSpawn();
  const starting = macVoice({ spawnVoice: spawn });
  const check = children[0]!;
  check.stdout.push("Samantha            en_US    # Hello! My name is Samantha.\n");
  check.exit(0);
  return { voice: await starting, spawn, children };
}

describe("the Windows voice", () => {
  it("starts PowerShell with no shell, and the words only on its input", async () => {
    const { voice, child, spawn } = await readyWindowsVoice();
    expect(spawn).toHaveBeenCalledTimes(1);
    const [file, args, options] = spawn.mock.calls[0]!;
    expect(file).toBe("powershell.exe");
    expect(args).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      powershellCommand(SPEAK_SCRIPT),
    ]);
    expect(options).toEqual(VOICE_SPAWN_OPTIONS);
    expect(options).not.toHaveProperty("shell");
    // A double quote in a command line is quoted again on its way to PowerShell; the script has none.
    expect(args.filter((arg) => arg.includes('"'))).toEqual([]);

    const saying = voice.say("Read more, link", 180);
    expect(child.written()).toBe('{"say":"Read more, link","rate":0}\n');
    expect(args.filter((arg) => arg.includes("Read more"))).toEqual([]);
    child.answer({ done: true });
    await saying;
  });

  it("writes each line as ASCII", async () => {
    const line = asciiJson({ say: "José … 👋", rate: 0 });
    expect(line).toBe(String.raw`{"say":"Jos\u00e9 \u2026 \ud83d\udc4b","rate":0}`);
    expect(line).toMatch(/^[\x20-\x7e]*$/);
    expect(JSON.parse(line)).toEqual({ say: "José … 👋", rate: 0 });

    const { voice, child } = await readyWindowsVoice();
    void voice.say("José … 👋", 180);
    expect(child.written()).toBe(`${line}\n`);
  });

  it("keeps a line that looks like a command or JSON as one line of data", async () => {
    const { voice, child } = await readyWindowsVoice();
    const text = `"; Remove-Item -Recurse C:\\ # {"stop":true}`;
    void voice.say(text, 180);
    const written = child.written();
    expect(written.indexOf("\n")).toBe(written.length - 1);
    expect(JSON.parse(written)).toEqual({ say: text, rate: 0 });
  });

  it.each([
    [180, 0],
    [540, 10],
    [60, -10],
    [240, 3],
    [120, -4],
    [200, 1],
    [1000, 10],
    [20, -10],
  ])("maps words a minute onto the voice's scale: %i is %i", (wpm, rate) => {
    expect(sapiRate(wpm)).toBe(rate);
  });

  it("resolves a line when it's done, and stops it on stop()", async () => {
    const { voice, child } = await readyWindowsVoice();
    // With nothing being said, there's nothing to stop.
    voice.stop();
    expect(child.written()).toBe("");

    const saying = voice.say("Skip to main content, link", 180);
    expect(await settled(saying)).toBe(false);
    const line = child.written();
    voice.stop();
    expect(child.written()).toBe(`${line}{"stop":true}\n`);
    // A stopped line is done once the script says so.
    expect(await settled(saying)).toBe(false);
    child.answer({ done: true });
    await expect(saying).resolves.toBeUndefined();
    voice.stop();
    expect(child.written()).toBe(`${line}{"stop":true}\n`);
  });

  it("says one line at a time", async () => {
    const { voice, child } = await readyWindowsVoice();
    const saying = voice.say("Home", 180);
    const line = child.written();
    expect(() => voice.say("About", 180)).toThrow(Error);
    expect(child.written()).toBe(line);
    child.answer({ done: true });
    await saying;
    void voice.say("About", 180);
    expect(child.written()).toBe(`${line}{"say":"About","rate":0}\n`);
  });

  it("rejects a line the voice couldn't say, and says the next", async () => {
    const { voice, child } = await readyWindowsVoice();
    const saying = voice.say("Home", 180);
    child.answer({ done: true, error: "Speak error occurred." });
    await rejectsWith(saying, "The computer's voice couldn't say a line: Speak error occurred.");
    const next = voice.say("About", 180);
    child.answer({ done: true });
    await expect(next).resolves.toBeUndefined();
  });

  it("says why when it doesn't start", async () => {
    const noVoice = fakeSpawn();
    const answered = windowsVoice({ spawnVoice: noVoice.spawn });
    noVoice.children[0]!.answer({ error: "no voice is installed" });
    await rejectsWith(answered, "The computer's voice didn't start: no voice is installed.");
    expect(noVoice.children[0]!.killed).toBe(true);

    const ended = fakeSpawn();
    const exiting = windowsVoice({ spawnVoice: ended.spawn });
    ended.children[0]!.exit(1);
    await rejectsWith(
      exiting,
      "The computer's voice didn't start: PowerShell ended with exit code 1.",
    );

    const silent = fakeSpawn();
    const waiting = windowsVoice({ spawnVoice: silent.spawn, readyMs: 50 });
    await rejectsWith(
      waiting,
      "The computer's voice didn't start: PowerShell didn't answer within 0.05 seconds.",
    );
    expect(silent.children[0]!.killed).toBe(true);
  });

  it("says why when PowerShell can't be started", async () => {
    const { spawn, children } = fakeSpawn();
    const starting = windowsVoice({ spawnVoice: spawn });
    children[0]!.fail(new Error("spawn powershell.exe ENOENT"));
    await rejectsWith(
      starting,
      "The computer's voice didn't start: PowerShell couldn't be started (spawn powershell.exe ENOENT).",
    );
    // A later error, as a kill that fails reports, is heard too: one no one hears ends voicecap.
    expect(() => children[0]!.fail(new Error("kill EPERM"))).not.toThrow();
  });

  // Node can report a program's exit before the last of what it printed.
  it("reads PowerShell's last answer, even when its exit is reported first", async () => {
    const { spawn, children } = fakeSpawn();
    const starting = windowsVoice({ spawnVoice: spawn });
    children[0]!.exit(1);
    children[0]!.answer({ error: "no voice is installed" });
    await rejectsWith(starting, "The computer's voice didn't start: no voice is installed.");
  });

  it("rejects, rather than hangs, when the voice stops mid-line", async () => {
    const { voice, child } = await readyWindowsVoice();
    const saying = voice.say("Home", 180);
    // Writing to a PowerShell that has ended fails, before its exit is heard.
    child.stdin.destroy(new Error("write EPIPE"));
    child.exit(1);
    await rejectsWith(saying, "The computer's voice stopped.");
    const written = child.written();
    await rejectsWith(voice.say("About", 180), "The computer's voice stopped.");
    expect(child.written()).toBe(written);
  });

  // PowerShell writes why the script failed to its error output, and the person is asked to paste
  // what the terminal shows when something goes wrong.
  it("says why the voice stopped, from the first lines PowerShell wrote to its error output", async () => {
    const { voice, child } = await readyWindowsVoice();
    const saying = voice.say("Home", 180);
    child.complain(
      [
        'Exception calling "SpeakAsync" with "1" argument(s): "The device is busy."',
        "",
        "At line:1 char:1442",
        "+ ... [void]$voice.SpeakAsync([string]$message.say) ...",
        "    + CategoryInfo          : NotSpecified: (:) [], MethodInvocationException",
        "",
      ].join("\r\n"),
    );
    child.exit(1);
    // The first three lines with words, each on one line.
    const why =
      'The computer\'s voice stopped (Exception calling "SpeakAsync" with "1" argument(s): "The device is busy." At line:1 char:1442 + ... [void]$voice.SpeakAsync([string]$message.say) ...).';
    await rejectsWith(saying, why);
    await rejectsWith(voice.say("About", 180), why);

    // With nothing written there, it only says the voice stopped.
    const quiet = await readyWindowsVoice();
    const said = quiet.voice.say("Home", 180);
    quiet.child.exit(1);
    await rejectsWith(said, "The computer's voice stopped.");
  });

  it("says why PowerShell ended before the voice started, from its error output", async () => {
    const { spawn, children } = fakeSpawn();
    const starting = windowsVoice({ spawnVoice: spawn });
    children[0]!.complain("The term 'Add-Type' is not recognized.\r\n");
    children[0]!.exit(1);
    await rejectsWith(
      starting,
      "The computer's voice didn't start: PowerShell ended with exit code 1 (The term 'Add-Type' is not recognized).",
    );
  });

  it("reads PowerShell's error output as it comes, so it never fills and stalls the script", async () => {
    const { child } = await readyWindowsVoice();
    for (let line = 0; line < 100; line++) child.complain(`${"x".repeat(1_000)}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    expect(child.stderr.readableLength).toBe(0);
  });

  it("ends PowerShell by ending its input", async () => {
    const { voice, child } = await readyWindowsVoice();
    const closing = voice.close();
    expect(child.ended).toBe(true);
    expect(await settled(closing)).toBe(false);
    child.exit(0);
    await closing;
    expect(child.killed).toBe(false);
    // It's safe to call twice.
    await voice.close();

    const stuck = await readyWindowsVoice({ closeMs: 50 });
    await stuck.voice.close();
    expect(stuck.child.ended).toBe(true);
    expect(stuck.child.killed).toBe(true);
  });

  it("stops the line being said when it closes, and says no more", async () => {
    const { voice, child } = await readyWindowsVoice();
    const saying = voice.say("Home", 180);
    const closing = voice.close();
    await expect(saying).resolves.toBeUndefined();
    child.exit(0);
    await closing;
    await rejectsWith(voice.say("About", 180), "The computer's voice stopped.");
  });
});

describe("the Mac voice", () => {
  it("starts say for each line, with the words on its input", async () => {
    const { voice, spawn, children } = await readyMacVoice();
    const saying = voice.say("Read more, link", 180);
    expect(spawn).toHaveBeenLastCalledWith("say", ["-r", "180", "-f", "-"], VOICE_SPAWN_OPTIONS);
    const spoken = children[1]!;
    expect(spoken.written()).toBe("Read more, link\n");
    expect(spoken.ended).toBe(true);
    spoken.exit(0);
    await expect(saying).resolves.toBeUndefined();

    const stopping = voice.say("Skip to main content", 180);
    voice.stop();
    expect(children[2]!.killed).toBe(true);
    children[2]!.exit(null);
    await expect(stopping).resolves.toBeUndefined();

    const failing = voice.say("Home", 180);
    children[3]!.exit(1);
    await rejectsWith(failing, "macOS's voice stopped.");

    const unstarted = voice.say("About", 180);
    children[4]!.fail(new Error("spawn say ENOENT"));
    await rejectsWith(unstarted, "macOS's voice stopped.");
  });

  it("checks for a voice first", async () => {
    const { spawn } = await readyMacVoice();
    expect(spawn.mock.calls[0]).toEqual(["say", ["-v", "?"], VOICE_SPAWN_OPTIONS]);

    const failing = fakeSpawn();
    const starting = macVoice({ spawnVoice: failing.spawn });
    failing.children[0]!.exit(1);
    await rejectsWith(starting, "macOS's voice didn't start: say ended with exit code 1.");

    const empty = fakeSpawn();
    const listing = macVoice({ spawnVoice: empty.spawn });
    empty.children[0]!.exit(0);
    await rejectsWith(listing, "macOS's voice didn't start: no voice is installed.");

    // Node can report the exit before what `say -v ?` printed.
    const late = fakeSpawn();
    const reading = macVoice({ spawnVoice: late.spawn });
    late.children[0]!.exit(0);
    late.children[0]!.stdout.push("Samantha            en_US    # Hello! My name is Samantha.\n");
    await expect(reading).resolves.toBeDefined();
  });

  it("kills the line being said when it closes", async () => {
    const { voice, children } = await readyMacVoice();
    const saying = voice.say("Home", 180);
    await voice.close();
    expect(children[1]!.killed).toBe(true);
    children[1]!.exit(null);
    await expect(saying).resolves.toBeUndefined();
    await voice.close();
  });
});

describe("startSystemVoice", () => {
  it("runs on Windows and a Mac only", async () => {
    const spawn = vi.fn<SpawnVoice>();
    await rejectsWith(
      startSystemVoice("linux", spawn),
      "--replay reads the transcripts aloud with Windows' or macOS's own voice, so it runs on Windows or a Mac, not on linux.",
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it("starts PowerShell on Windows, and say on a Mac", async () => {
    const windows = fakeSpawn();
    const onWindows = startSystemVoice("win32", windows.spawn);
    expect(windows.spawn.mock.calls[0]?.[0]).toBe("powershell.exe");
    windows.children[0]!.exit(1);
    await expect(onWindows).rejects.toThrow(EnvironmentError);

    const mac = fakeSpawn();
    const onMac = startSystemVoice("darwin", mac.spawn);
    expect(mac.spawn.mock.calls[0]?.[0]).toBe("say");
    mac.children[0]!.exit(1);
    await expect(onMac).rejects.toThrow(EnvironmentError);
  });
});

// The four tests of the real script: Windows PowerShell with System.Speech, its speech sent nowhere,
// or, in one, to a stream too small for it. None is heard.
describe.runIf(process.platform === "win32")("the real script, on Windows", () => {
  const silent = SPEAK_SCRIPT.replace("SetOutputToDefaultAudioDevice()", "SetOutputToNull()");

  /**
   * The real script, started. A computer with no voice installed, as a CI image may be, skips the
   * test. `closeMs` is longer than the 5 seconds a close may take, so a close that finishes in time
   * shows the script ended on its input's end, not that it was killed. It's closed when the test
   * finishes, whether or not the test did, so a failed one leaves no PowerShell running.
   */
  async function startOrSkip(ctx: TestContext, script: string): Promise<Voice> {
    let voice: Voice;
    try {
      voice = await windowsVoice({ script, closeMs: 10_000 });
    } catch (error) {
      expect(errorMessage(error)).toBe("The computer's voice didn't start: no voice is installed.");
      ctx.skip("no voice is installed");
    }
    ctx.onTestFinished(() => voice.close());
    return voice;
  }

  it("speaks through the real script, silently", async (ctx) => {
    expect(silent).not.toBe(SPEAK_SCRIPT);
    const voice = await startOrSkip(ctx, silent);
    await voice.say('José … "; Remove-Item x #', 540);
    const long = voice.say("word ".repeat(400), 180);
    voice.stop();
    await long;
    // A stopped line leaves the voice ready for the next.
    await voice.say("Done.", 540);
    const closing = performance.now();
    await voice.close();
    expect(performance.now() - closing).toBeLessThan(5_000);
  }, 60_000);

  // The script reads each line's words as they were written, outside ASCII too, and as data only.
  it("hands the script each line's words as they're written", async (ctx) => {
    const echo = silent.replace(
      "[void]$voice.SpeakAsync([string]$message.say)",
      "throw [string]$message.say",
    );
    expect(echo).not.toBe(silent);
    const voice = await startOrSkip(ctx, echo);
    const words = `José … “quoted” ‘single’ 👋 "; Remove-Item x # {"stop":true}`;
    await rejectsWith(voice.say(words, 180), `The computer's voice couldn't say a line: ${words}.`);
    await voice.close();
  }, 60_000);

  /** Checks that `saying` rejects as a line the voice couldn't say. */
  async function couldntSay(saying: Promise<void>): Promise<void> {
    const error = await saying.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(EnvironmentError);
    // The rest is Windows' own message, in Windows' language.
    expect(errorMessage(error)).toMatch(/^The computer's voice couldn't say a line: \S.*\.$/);
  }

  // System.Speech completes a line whose audio fails, as it would with its audio device removed,
  // rather than throwing. Here the audio goes to a stream too small for it, so nothing is heard.
  it("rejects a line whose audio fails, rather than counting it as said", async (ctx) => {
    const failing = SPEAK_SCRIPT.replace(
      "SetOutputToDefaultAudioDevice()",
      "SetOutputToWaveStream([System.IO.MemoryStream]::new([byte[]]::new(64)))",
    );
    expect(failing).not.toBe(SPEAK_SCRIPT);
    const voice = await startOrSkip(ctx, failing);
    await couldntSay(voice.say("Skip to main content, link", 180));
    await voice.close();
  }, 60_000);

  // Only a stop the replay asked for ends a line early without an error.
  it("rejects a line cancelled when no stop was asked for", async (ctx) => {
    const cancelling = silent.replace(
      "[void]$voice.SpeakAsync([string]$message.say)",
      "[void]$voice.SpeakAsync([string]$message.say); $voice.SpeakAsyncCancelAll()",
    );
    expect(cancelling).not.toBe(silent);
    const voice = await startOrSkip(ctx, cancelling);
    await couldntSay(voice.say("word ".repeat(400), 180));
    await voice.close();
  }, 60_000);
});
