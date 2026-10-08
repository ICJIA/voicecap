/**
 * The computer's own voice, which `voicecap review --replay` reads a page's saved transcript aloud
 * with: Windows' (System.Speech) and macOS's (`say`). It says the words NVDA said, as the
 * transcript keeps them; it isn't NVDA reading the page again.
 *
 * No transcript's words ever reach a command line or a shell. On Windows, one Windows PowerShell
 * runs SPEAK_SCRIPT for the whole session and reads each line as a line of JSON on its standard
 * input, as data it never evaluates. On a Mac, `say` reads each line on its standard input. Every
 * program starts through `spawn(file, args, VOICE_SPAWN_OPTIONS)`, with no shell.
 *
 * The voices' error messages are here, beside what goes wrong. Every other word a person sees
 * during a replay is in text.ts.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { powershellCommand } from "../drivers/guidepup/windows.js";
import { EnvironmentError } from "../util/errors.js";

/** The computer's voice, saying one line at a time. */
export interface Voice {
  /**
   * Says `text` at `wpm` words a minute. Resolves once the line is spoken, or once stop() stops it,
   * and rejects when the voice has stopped working. One line at a time: calling it while a line is
   * waiting throws an Error, as that's a bug in the caller.
   */
  say(text: string, wpm: number): Promise<void>;
  /** Stops the line being spoken, if any. */
  stop(): void;
  /** Ends the voice's program. It's safe to call twice. */
  close(): Promise<void>;
}

/** What a voice needs of the program it starts. Node's ChildProcess has it. */
export interface VoiceChild {
  stdin: Writable;
  stdout: Readable;
  kill(): boolean;
  once(event: "exit", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
}

/**
 * How a voice's program starts: hidden, with its standard streams as pipes. There's no `shell`
 * key, so Node starts the program itself, with each argument as it is, and no shell reads them.
 */
export const VOICE_SPAWN_OPTIONS = { windowsHide: true, stdio: "pipe" } as const;

/** Starts a voice's program. The default is `node:child_process`'s spawn; tests give a fake. */
export type SpawnVoice = (
  file: string,
  args: readonly string[],
  options: typeof VOICE_SPAWN_OPTIONS,
) => VoiceChild;

/**
 * `value` as JSON in ASCII alone: every UTF-16 unit from U+007F up is written as a `\uXXXX` escape,
 * in lowercase hex. An escape reads the same whatever encoding PowerShell reads its input in (a
 * console's code page would garble "José" or "…"), and JSON gives back the words as they were.
 */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Windows' rate for the voice (-10 to 10) for `wpm` words a minute (D4): 180 is its normal speed
 * (0), and each tripling is 10 steps, so 540 is its fastest and 60 its slowest. A speed beyond
 * those is kept within the scale.
 */
export function sapiRate(wpm: number): number {
  return Math.max(-10, Math.min(10, Math.round((10 * Math.log(wpm / 180)) / Math.log(3))));
}

/**
 * The script the Windows voice runs in Windows PowerShell, given with -Command (C1): Windows'
 * default execution policy refuses to run a .ps1 file, and Group Policy can keep it so, but no
 * policy applies to a script given with -Command.
 *
 * It answers on its output with one line of JSON at a time: {"ready":true,"voice":…} once
 * System.Speech has a voice, or {"error":…} and exit code 1 when it hasn't; then {"done":true}
 * once for each line it's given, spoken or stopped, with an "error" too when the voice couldn't
 * say it. It reads one line of JSON at a time on its input: {"say":…,"rate":…} says a line,
 * {"stop":true} stops it (a stop has no answer of its own, and with nothing being said it does
 * nothing), and the input's end ends the script. The words are only ever data: ConvertFrom-Json
 * reads them, and SpeakAsync says them. It waits for its input 40 ms at a time, so a line that's
 * done is answered within 40 ms.
 *
 * A line is done when System.Speech raises SpeakCompleted for it, which it does once for each
 * line, and the script takes that event from PowerShell's event queue. A line whose audio fails,
 * as it would with the audio device removed, is completed too, not thrown, with the failure as the
 * event's Error: that line's done carries the error, so the replay ends and says why instead of
 * going on in silence. A line the script stopped completes with an OperationCanceledException, and
 * is done with no error. A line cancelled when no stop was asked for counts as failed. At the end,
 * the script stops listening for the event first: PowerShell takes over a second to exit while it
 * still listens.
 *
 * Its statements are joined with single spaces, as NVDA_PROCESSES is. There's no double quote in
 * it, which the command line would quote again, and every statement ends with ; or a closing
 * brace.
 */
export const SPEAK_SCRIPT = [
  "$ErrorActionPreference = 'Stop';",
  "try {",
  "Add-Type -AssemblyName System.Speech;",
  "$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
  "if (@($voice.GetInstalledVoices() | Where-Object { $_.Enabled }).Count -eq 0) { throw 'no voice is installed' };",
  "$voice.SetOutputToDefaultAudioDevice();",
  "Register-ObjectEvent -InputObject $voice -EventName SpeakCompleted -SourceIdentifier spoke;",
  "} catch {",
  "[Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ error = $_.Exception.Message }));",
  "exit 1",
  "};",
  "[Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ ready = $true; voice = $voice.Voice.Name }));",
  "$in = New-Object System.IO.StreamReader([Console]::OpenStandardInput());",
  "$next = $in.ReadLineAsync();",
  "$stopping = $false;",
  "while ($true) {",
  "foreach ($spoke in @(Get-Event -SourceIdentifier spoke -ErrorAction SilentlyContinue)) {",
  "Remove-Event -EventIdentifier $spoke.EventIdentifier;",
  "$failure = $spoke.SourceEventArgs.Error;",
  "if ($null -eq $failure -or ($stopping -and $failure -is [OperationCanceledException])) { [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ done = $true })) }",
  "else { [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ done = $true; error = $failure.Message })) }",
  "};",
  "if (-not $next.Wait(40)) { continue };",
  "$line = $next.Result;",
  "if ($null -eq $line) { break };",
  "$next = $in.ReadLineAsync();",
  "$message = ConvertFrom-Json -InputObject $line;",
  "if ($message.stop) { $stopping = $true; $voice.SpeakAsyncCancelAll(); continue };",
  "try { $stopping = $false; $voice.Rate = [int]$message.rate; [void]$voice.SpeakAsync([string]$message.say) }",
  "catch { [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ done = $true; error = $_.Exception.Message })) }",
  "};",
  "Unregister-Event -SourceIdentifier spoke;",
  "$voice.SpeakAsyncCancelAll();",
  "$voice.Dispose()",
].join(" ");

/**
 * Windows' own voice: one Windows PowerShell, hidden, running `script` (SPEAK_SCRIPT) for the whole
 * session, fed one line of JSON (asciiJson) for each line it says.
 *
 * It resolves once the script says it's ready. It rejects with an EnvironmentError that says why
 * when the script can't find a voice, PowerShell can't be started or ends first, or there's no
 * answer within `readyMs`, and then it kills PowerShell. `close()` stops the line being said, as
 * stop() does, ends PowerShell's input, which ends the script, and kills PowerShell if it hasn't
 * ended after `closeMs`. After `close()`, or once PowerShell has ended, every line rejects.
 */
export async function windowsVoice(
  options: { spawnVoice?: SpawnVoice; script?: string; readyMs?: number; closeMs?: number } = {},
): Promise<Voice> {
  const spawnVoice: SpawnVoice = options.spawnVoice ?? spawn;
  const { script = SPEAK_SCRIPT, readyMs = 20_000, closeMs = 2_000 } = options;
  const child = spawnVoice(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", powershellCommand(script)],
    VOICE_SPAWN_OPTIONS,
  );
  // Writing to a program that has ended fails on its input. The end itself is heard below.
  child.stdin.on("error", () => {});

  /** Until the script has answered: gives null for ready, or why it isn't. */
  let answerStart: ((why: string | null) => void) | null = null;
  const starting = new Promise<string | null>((resolve) => {
    answerStart = (why) => {
      answerStart = null;
      resolve(why);
    };
  });
  /** The line being said, until the script says it's done. */
  let line: { resolve: () => void; reject: (error: Error) => void } | null = null;
  /** Set once the voice can say nothing more: PowerShell has ended, or the voice was closed. */
  let stopped = false;

  const ended = watch(child, (text) => {
    const answer = answerOf(text);
    if (answerStart !== null) {
      if (answer.ready === true) answerStart(null);
      else if (typeof answer.error === "string") answerStart(clause(answer.error));
    } else if (answer.done === true && line !== null) {
      const said = line;
      line = null;
      if (typeof answer.error === "string") {
        said.reject(
          new EnvironmentError(
            `The computer's voice couldn't say a line: ${clause(answer.error)}.`,
          ),
        );
      } else {
        said.resolve();
      }
    }
  });
  void ended.then((ending) => {
    stopped = true;
    answerStart?.(
      "error" in ending
        ? `PowerShell couldn't be started (${clause(ending.error.message)})`
        : endedWith("PowerShell", ending.code),
    );
    const said = line;
    line = null;
    said?.reject(new EnvironmentError("The computer's voice stopped."));
  });

  const timer = setTimeout(
    () => answerStart?.(`PowerShell didn't answer within ${readyMs / 1000} seconds`),
    readyMs,
  );
  const why = await starting;
  clearTimeout(timer);
  if (why !== null) {
    child.kill();
    throw new EnvironmentError(`The computer's voice didn't start: ${why}.`);
  }

  let closing: Promise<void> | null = null;
  return {
    say(text, wpm) {
      if (line !== null) throw new Error("The voice is already saying a line.");
      if (stopped) return Promise.reject(new EnvironmentError("The computer's voice stopped."));
      return new Promise<void>((resolve, reject) => {
        line = { resolve, reject };
        child.stdin.write(`${asciiJson({ say: text, rate: sapiRate(wpm) })}\n`);
      });
    },
    stop() {
      if (line !== null) child.stdin.write(`${asciiJson({ stop: true })}\n`);
    },
    close() {
      closing ??= (async () => {
        stopped = true;
        // Closing stops the line being said, as stop() does.
        const said = line;
        line = null;
        said?.resolve();
        child.stdin.end();
        if (!(await settlesWithin(ended, closeMs))) child.kill();
      })();
      return closing;
    },
  };
}

/**
 * macOS's own voice: `say`, started for each line with the words on its input. It resolves once
 * `say -v ?` has listed a voice, and rejects with an EnvironmentError that says why when it
 * hasn't. `stop()` and `close()` kill the `say` that's speaking, and the line it was saying
 * resolves. After `close()`, every line rejects.
 */
export async function macVoice(options: { spawnVoice?: SpawnVoice } = {}): Promise<Voice> {
  const spawnVoice: SpawnVoice = options.spawnVoice ?? spawn;
  const check = spawnVoice("say", ["-v", "?"], VOICE_SPAWN_OPTIONS);
  check.stdin.on("error", () => {});
  check.stdin.end();
  let listed = false;
  const checked = await watch(check, (text) => {
    if (text.trim() !== "") listed = true;
  });
  const why =
    "error" in checked
      ? `say couldn't be started (${clause(checked.error.message)})`
      : checked.code !== 0
        ? endedWith("say", checked.code)
        : listed
          ? null
          : "no voice is installed";
  if (why !== null) throw new EnvironmentError(`macOS's voice didn't start: ${why}.`);

  /** The `say` speaking the line being said, and whether stop() ended it. */
  let speaking: { child: VoiceChild; stopped: boolean } | null = null;
  let closed = false;
  const stop = (): void => {
    if (speaking === null) return;
    speaking.stopped = true;
    speaking.child.kill();
  };
  return {
    say(text, wpm) {
      if (speaking !== null) throw new Error("The voice is already saying a line.");
      if (closed) return Promise.reject(new EnvironmentError("macOS's voice stopped."));
      const child = spawnVoice(
        "say",
        ["-r", String(Math.round(wpm)), "-f", "-"],
        VOICE_SPAWN_OPTIONS,
      );
      const current = { child, stopped: false };
      speaking = current;
      child.stdin.on("error", () => {});
      child.stdin.write(`${text}\n`);
      child.stdin.end();
      return watch(child, () => {}).then((ending) => {
        speaking = null;
        if ("code" in ending && (ending.code === 0 || current.stopped)) return;
        throw new EnvironmentError("macOS's voice stopped.");
      });
    },
    stop,
    close() {
      closed = true;
      stop();
      return Promise.resolve();
    },
  };
}

/**
 * The computer's own voice on `platform`: Windows' or macOS's. Any other platform has neither, and
 * the replay stops before it starts anything.
 */
export async function startSystemVoice(
  platform: NodeJS.Platform,
  spawnVoice?: SpawnVoice,
): Promise<Voice> {
  if (platform === "win32") return windowsVoice({ spawnVoice });
  if (platform === "darwin") return macVoice({ spawnVoice });
  throw new EnvironmentError(
    `--replay reads the transcripts aloud with Windows' or macOS's own voice, so it runs on Windows or a Mac, not on ${platform}.`,
  );
}

/** How a voice's program ended: with its exit code (null when a signal ended it), or unstarted. */
type Ending = { code: number | null } | { error: Error };

/**
 * Reads `child`'s output a line at a time, in UTF-8, and settles once the program has ended: once
 * it has exited and its output has been read to the end (Node can report the exit before the last
 * of the output), or once it couldn't start.
 */
function watch(child: VoiceChild, onLine: (line: string) => void): Promise<Ending> {
  return new Promise((resolve) => {
    let code: number | null | undefined;
    let outputEnded = false;
    const settle = (): void => {
      if (code !== undefined && outputEnded) resolve({ code });
    };
    const output = createInterface({ input: child.stdout });
    output.on("line", onLine);
    const endOutput = (): void => {
      outputEnded = true;
      settle();
    };
    output.on("close", endOutput);
    // An output that fails gives nothing more either.
    output.on("error", endOutput);
    child.once("exit", (exitCode) => {
      code = exitCode;
      settle();
    });
    onEveryError(child, (error) => resolve({ error }));
  });
}

/**
 * Hears every "error" `child` reports, as Node reports a program that can't start: one that no one
 * hears would end voicecap. A VoiceChild has only `once`, so it listens again each time.
 */
function onEveryError(child: VoiceChild, hear: (error: Error) => void): void {
  child.once("error", (error) => {
    onEveryError(child, hear);
    hear(error);
  });
}

/** Whether `promise` settles within `ms` milliseconds. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A line the script printed, as the JSON object it is; {} for any other line. */
function answerOf(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Another program's message as part of a sentence: on one line, without its own full stop. */
function clause(message: string): string {
  return message.replace(/\s+/g, " ").trim().replace(/\.$/, "");
}

/** "PowerShell ended with exit code 1", or "PowerShell ended" when a signal ended it. */
function endedWith(program: string, code: number | null): string {
  return code === null ? `${program} ended` : `${program} ended with exit code ${code}`;
}
