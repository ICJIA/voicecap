# Plan 8: The review replay

**Goal:** `voicecap review --replay`, a guided review session. For each page, voicecap reads the page's saved transcript aloud in the computer's own voice, at a normal speed, shows each line as it's read, and then records what the person decided, as `voicecap review` records a decision. Ship it as 0.14.0.

**Architecture:** six small modules in a new `src/review-replay/`, each with one job:
- `keys.ts`: the keys a person presses, read from the terminal in raw mode for the whole session, and the note they type;
- `voice.ts`: the computer's voice. On Windows that's one long-lived Windows PowerShell running System.Speech, fed JSON lines on its input. On a Mac it's one `say` per line;
- `player.ts`: a pure state machine for one page's transcripts, plus the loop that drives it with a voice and the keys;
- `pages.ts`: which pages to play, from the shareable page's own model ("What needs attention" names them), and each page's lines and marks, from its shown transcripts with the flag rules' own matching;
- `session.ts`: the session, from the first page to the last, with each decision recorded through `addReview` and the live report written once at the end;
- `text.ts`: every word a person sees.

`src/cli/main.ts` gives `review` the options `--replay`, `--all`, and `--rate`.

**Tech Stack:** TypeScript strict ESM, Node 22.19+, pnpm, Vitest, and commander 15. The terminal's keys come from `node:readline`'s `emitKeypressEvents`, and the voices' programs from `node:child_process`'s `spawn`, never with a shell. The voices are Windows PowerShell 5.1 with System.Speech, and macOS `say`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-06-review-replay-design.md`, as amended in 272442d. This plan builds all of it, with the corrections below.

**Branch:** `plan-8-review-replay`, in the worktree `C:/Users/cschw/code/voicecap-replay`. Main (0.13.0) was merged into it at 8e8300a. Run `pnpm install` in the worktree first: it has no `node_modules` of its own.

## Corrections to the spec (found while planning)

- **C1, PowerShell runs the voice's script with `-Command`, not `-File`.**
  - The spec has voicecap ship `src/review-replay/speak.ps1`, copied into `dist`, and start it with `-File`. Windows' default execution policy on Windows 10 and 11 is "Restricted", which refuses to run any `.ps1` file. A policy set by Group Policy also overrides `-ExecutionPolicy Bypass`, as it may on an agency's PCs.
  - A script given with `-Command` isn't subject to the policy, and voicecap's other PowerShell work already runs that way, after `powershellCommand`'s UTF-8 line (`src/drivers/guidepup/windows.ts`).
  - So the script is a constant, `SPEAK_SCRIPT`, in `voice.ts`. There's no `.ps1` file, and the build doesn't change.
  - Everything the spec asks for still holds:
    - the words reach PowerShell only on its standard input, never in its command line;
    - nothing goes through `cmd /c` or a shell;
    - the script never evaluates what it reads.
  - Task 6 writes this into the spec.
- **C2, "the same pages What needs attention counts" is the rule for the default pages.**
  - The spec describes them as "every page with flags no one has decided on, and every page that reads differently since its review (the same pages 'What needs attention' counts)". What needs attention also names a page with an open issue, and one whose read stopped short.
  - The plan takes the parenthesis as the rule (D2): the default is the pages a card of What needs attention names, among those NVDA read. That is the ring's "Read, with problems", worked out as `ringOf` works it out.
- **C3, a page plays from its shown transcripts, and the decision is recorded against that run.** `addReview`'s own default run is the newest run with transcripts for the page, a replayed or unsealed run included. So the session passes the shown run's id as `addReview`'s `run`, though the person can't give `--run`.

## Decisions this plan makes (the owner reviews them with the plan)

- **D1:** C1, the script given with `-Command`.
- **D2:** C2, the default pages are What needs attention's pages that NVDA read. Open issues, and reads that stopped short, are in too.
- **D3, a decision is one key, 1 to 4.**
  - No other key answers the question, Enter alone included, so a stray key never records a decision. That's the reason the end-of-run question defaults to "No".
  - For 2 and 3, the note ends with Enter.
- **D4, the speed.**
  - `--rate` is a whole number of words a minute, from 60 to 540, with 180 as the default. **+** and **−** change it by 20 within that range.
  - On Windows the rate is `round(10 × log₃(wpm ÷ 180))`, kept within −10 to 10. So 180 is the voice's normal speed (0), 540 its fastest (10), and 60 its slowest (−10).
  - **+** is also `=`, and **−** is also `-` and `_`, so neither needs Shift.
- **D5, what a mark says.**
  - For unlabeled and generic-link-text, a line's mark is what the rule found ("⚑ unlabeled graphic", "⚑ read more").
  - For every other rule, it's the rule's id ("⚑ headings"), as the page's chips name rules.
  - Those rules mark the lines `flagQuotes` gives, at most 3 a flag.
- **D6, what plays.**
  - Each pass plays its content steps, the steps the flag rules read (`contentSteps`). So the read pass:
    - starts at Ctrl+Home's line, "[to top] …";
    - leaves out Ctrl+End's line;
    - doesn't repeat its last line.
  - Each line keeps its number in the TXT transcript, so line 4 on screen is the body's line 4, step 4.
  - A line is shown as the transcript writes it, with "[to top]" or "[no speech]". The voice says it without the label, and says nothing for "[no speech]".
- **D7, keys while paused.** ← → N H T R move to their line while paused, show it, and don't speak it. That way a person can step through the lines in silence, and Space speaks from there.
- **D8, how it ends.**
  - Ctrl+C ends the session with exit code 130, as an interrupted run does.
  - The live report is written once, at the end, and only when at least one decision was recorded (the spec's Safety: nothing new is written otherwise).
  - Every way out ends by saying how many decisions were recorded.

## Global Constraints

- **Wording:** voicecap is a human review, sped up, never "automated". The replay reads a page's saved words aloud; it isn't NVDA reading the page again. A person hears, reads, and decides; never say a person "listened".
- **No shell:** every program starts through `spawn(file, args, VOICE_SPAWN_OPTIONS)`, which has no `shell` key. A transcript's words reach a voice only on its standard input, as one line of JSON on Windows, or as `say`'s input on a Mac. Nothing goes through `cmd /c`.
- **What the session writes:** review entries, through `addReview` with `regenerateReport: false` and the shown run's `run`, and the live report once at the end (D8). Nothing else.
- **The person's own NVDA** is never stopped, started, or changed. When it's running, the session says so and waits for Enter.
- **Copy the spec pins, word for word:**
  - `Page 3 of 7: /biographies/ (2 flags)`;
  - a line: its number right-aligned in four columns, two spaces, and the line, as in `  12  banner landmark, …`;
  - a mark: `⚑ unlabeled graphic`, after the line;
  - `What did you decide?  1 Reviewed, no issues   2 Issue found   3 Fixed   4 Skip`;
  - the two lines when NVDA is running: `NVDA is running, and it will read these lines too, over the replay's voice.` and `Mute it (NVDA+S changes its speech mode) or quit it, then press Enter.`;
  - the options `--replay`, `--all`, and `--rate <n>` (default 180).
- **One source of words:** what a person sees is in `REPLAY_TEXT` (`src/review-replay/text.ts`), except the voices' error messages, which live in `voice.ts`.
- **Platforms:** Windows (System.Speech) and macOS (`say`). Elsewhere `--replay` stops before anything is recorded.
- **Commits:** a plain subject line with no trailers of any kind, and no push until the release.
- **What the work never does:**
  - start NVDA, or any desktop program;
  - run voicecap, except through the test suite, and never `voicecap review --replay` outside it: it speaks aloud and records decisions;
  - pass a composed command through `cmd /c` or any shell;
  - touch the owner's transcripts home;
  - play audio. The tests use fake voices. The one test of the real script (Task 2) sends its speech to `SetOutputToNull()`.

## Review Focus

1. **Every way out puts the terminal back and ends the voice:** the last page, Ctrl+C, the keys ending, a closed window, the voice failing, and `addReview` throwing. Raw mode is off, the voice's program has ended, and what was recorded stays. Tasks 1, 5, and 6 test it.
2. **Speech outside ASCII** ("José", "…", curly quotes, an emoji) on a PC whose Windows PowerShell reads its input in the console's code page. The voice says it as written, because each JSON line is ASCII (`\uXXXX` escapes). Task 2 tests it.
3. **A transcript line that looks like a command, PowerShell, or JSON** (`"; Remove-Item -Recurse C:\ #`, `{"stop":true}`) is only ever words to say: one JSON line of data, never evaluated. Task 2 tests it.
4. **Keys pressed faster than lines are spoken:** each key acts in turn, none is lost, and no `say()` is left waiting. Task 3 tests it.
5. **The voice's program dies mid-session** (PowerShell ended, an audio device removed): the session ends and says so, never hangs, and keeps what was recorded. Tasks 2 and 5 test it.

---

### Task 1: Keys, and the replay's words

**Files:**
- Create: `src/review-replay/keys.ts`.
- Create: `src/review-replay/text.ts`.
- Create: `test/helpers/replay.ts`: `keyQueue()` and `ttyInput()` (Interfaces). Later tasks add to it.
- Test: `test/review-replay-keys.test.ts` (new).

**Interfaces:**
- Produces:
  - **`export type Key`:** `{ name: "enter" | "space" | "left" | "right" | "backspace" | "escape" | "ctrl-c" }`, or `{ name: "char"; char: string }`.
  - **`export interface KeySource { next(): Promise<Key | null>; waiting(): Promise<void>; close(): Promise<void> }`:**
    - `next()` waits for the next key and takes it. It gives null once the input has ended or the session's signal has aborted.
    - `waiting()` resolves once a key is waiting, or the keys have ended, without taking it. The player races it against the voice, so a key is taken only when it acts, and none is lost between lines or pages.
  - **`export function keyOf(str: string | undefined, key: { name?: string; ctrl?: boolean } | undefined): Key | null`**, from a `keypress` event:
    - `key.ctrl` with "c" gives "ctrl-c";
    - "return" or "enter" gives "enter";
    - "space", "left", "right", "backspace", and "escape" give themselves;
    - any other printable `str` gives `{ name: "char", char: str }`;
    - anything else gives null.
  - **`export function terminalKeys(input: NodeJS.ReadableStream, signal?: AbortSignal): KeySource`.**
    - It calls `emitKeypressEvents(input)`, calls `setRawMode(true)` when the input has it, and resumes the input. Each key goes into a queue, so a key pressed before it's asked for waits its turn, in order.
    - `close()` stops listening and pauses the input. Then, on the next turn (`setImmediate` from `node:timers/promises`), it calls `setRawMode(false)`. That's the Windows Terminal lesson in `src/cli/listener.ts`'s `dropWaitingInput`.
    - It keeps raw mode for the whole session, so Ctrl+C reaches voicecap as a key, not as a console signal that would also end the voice's PowerShell.
  - **`export async function readNote(keys: KeySource, out: OutputStream): Promise<string | null>`:**
    - it writes each `char` as it's typed;
    - Backspace takes the last character off and writes `"\b \b"`;
    - Enter writes `"\n"` and gives the note, trimmed;
    - Ctrl+C, or the keys ending, gives null.
  - **`export const REPLAY_TEXT`**, with exactly these words (`plural` from `src/report/html.ts`):
    - `page(n, of, path, flags)`: `` `Page ${n} of ${of}: ${path} (${flags === 0 ? "no flags" : plural(flags, "flag")})` ``;
    - `line(n, text, marks)`: `` `${String(n).padStart(4)}  ${text}${marks.map((mark) => `  ⚑ ${mark}`).join("")}` ``;
    - `pass(pass, lines)`: "Read transcript, 33 lines:", "Headings transcript, …", "Tab transcript, …";
    - `noLines(pass)`: "No lines in the read transcript.", "… headings …", and "… Tab …";
    - `noFlagAfter`: "No flagged line after this one.";
    - `paused`: "Paused. Press Space to go on.";
    - `speed(wpm)`: "Speed: 200 words a minute.";
    - `keys`: "Keys: Space pauses and goes on · ← → a line back or ahead · N the next flagged line · H T R the headings, Tab, and read transcripts · + − faster, slower · Enter decide · Ctrl+C end";
    - `question`: the spec's line, word for word;
    - `note`: "Note (Enter for none): ";
    - `nvda`: the spec's two lines, as a two-item array;
    - `leftOut(paths)`: `` `Left out, with no transcripts to hear: ${paths.join(", ")}.` ``;
    - `nothingDefault`: "Nothing to hear: no page that NVDA read needs attention. Add --all to hear every page, or --page <url> to hear one.";
    - `nothingAll`: "Nothing to hear: no page has transcripts yet.";
    - `recorded(n)`: "Recorded no decisions.", "Recorded 1 decision.", or "Recorded 2 decisions.";
    - `noTerminal`: "--replay needs a terminal: it takes each key as you press it, and shows each line as it's read. Run it in a terminal window, with nothing redirected."
  - **Test helpers:**
    - `keyQueue(): KeySource & { push(...keys: (Key | string)[]): void; end(): void; closed: boolean }`, where a string is a `char` key;
    - `ttyInput(): PassThrough & { isTTY: true; setRawMode: (mode: boolean) => void; rawModes: boolean[] }`.

- [ ] **Step 1: Write the failing tests** in `test/review-replay-keys.test.ts`:
  - **"names each key the replay uses":** an `it.each` of `keyOf` inputs and the key they give:
    - `(" ", {name:"space"})` gives space;
    - `(undefined, {name:"left"})` gives left, and the same for right;
    - `("\r", {name:"return"})` gives enter;
    - `("\u0003", {name:"c", ctrl:true})` gives ctrl-c;
    - `("\x7f", {name:"backspace"})` gives backspace;
    - `("n", {name:"n"})` gives `{name:"char", char:"n"}`;
    - `("+", {})` gives `{name:"char", char:"+"}`;
    - `(undefined, {name:"f5"})` gives null.
  - **"reads keys from a terminal in raw mode, and leaves it after"** (Review Focus 1):
    - on `ttyInput()`, writing `"n"` then `"\x1b[C"` gives the char "n", then right;
    - `rawModes` is `[true]`, and `[true, false]` after `await close()`.
  - **"keeps keys pressed before they're asked for, in order":** writing `"abc"` at once gives a, b, then c.
  - **"says a key is waiting without taking it":** after writing `"n"`, `waiting()` resolves, and `next()` still gives "n". On an empty queue, `waiting()` stays pending until a key arrives, or the input ends.
  - **"gives null when the input ends, or the session stops":**
    - after `input.end()`, `next()` gives null;
    - a pending `next()` gives null once its signal aborts.
  - **`readNote`:**
    - the keys B, a, d, backspace, g, enter give "Bag", and the output is `"Bad\b \bg\n"`;
    - enter alone gives "";
    - x then ctrl-c gives null;
    - an ended queue gives null.
  - **`REPLAY_TEXT`:**
    - `page(3, 7, "/biographies/", 2)` is the spec's line;
    - `page(1, 1, "/", 0)` ends "(no flags)", and with 1 it ends "(1 flag)";
    - `line(12, "banner landmark, link", [])` is `"  12  banner landmark, link"`;
    - `line(4, "x", ["unlabeled graphic"])` is `"   4  x  ⚑ unlabeled graphic"`;
    - `line(123, "y", ["a", "b"])` is `" 123  y  ⚑ a  ⚑ b"`;
    - `question` and the two `nvda` lines equal the spec's, word for word;
    - `recorded(0)`, `recorded(1)`, and `recorded(2)` read as listed above.
- [ ] **Step 2:** Run `pnpm vitest run test/review-replay-keys.test.ts`. Expected: FAIL, since the modules don't exist yet.
- [ ] **Step 3: Implement** `keys.ts`, `text.ts`, and the two helpers.
- [ ] **Step 4:** Run it. Expected: PASS. Then run `pnpm lint && pnpm typecheck`.
- [ ] **Step 5:** Commit: `Read the replay's keys from the terminal in raw mode, with the note a person types, and set out its words`.

### Task 2: The computer's voice

**Files:**
- Create: `src/review-replay/voice.ts`.
- Modify: `test/helpers/replay.ts`: add `fakeChild()`.
- Test: `test/review-replay-voice.test.ts` (new).

**Interfaces:**
- Consumes: `powershellCommand(script)` from `src/drivers/guidepup/windows.ts` (the UTF-8 line before a script), and `EnvironmentError` from `src/util/errors.ts`.
- Produces:
  - **`export interface Voice`:**
    - `say(text: string, wpm: number): Promise<void>` resolves once the line is spoken, or once `stop()` stops it. It rejects when the voice has stopped working. Only one `say` at a time: a second while one is waiting throws an `Error`, which is a bug in the caller.
    - `stop(): void` stops the line being spoken, if any.
    - `close(): Promise<void>` ends the voice's program. It's safe to call twice.
  - **`export interface VoiceChild`:** `stdin: Writable`, `stdout: Readable`, `kill(): boolean`, and `once("exit", (code: number | null) => void)` and `once("error", (error: Error) => void)`.
  - **`export type SpawnVoice = (file: string, args: readonly string[], options: typeof VOICE_SPAWN_OPTIONS) => VoiceChild`.** The default is `node:child_process`'s `spawn`.
  - **`export const VOICE_SPAWN_OPTIONS = { windowsHide: true, stdio: "pipe" } as const`**, with no `shell` key.
  - **`export function asciiJson(value: unknown): string`:** `JSON.stringify(value)`, with every UTF-16 unit from U+007F up written as `\uXXXX` in lowercase hex.
  - **`export function sapiRate(wpm: number): number`:** `Math.max(-10, Math.min(10, Math.round((10 * Math.log(wpm / 180)) / Math.log(3))))` (D4).
  - **`export const SPEAK_SCRIPT: string`.** These statements, joined with single spaces, as `NVDA_PROCESSES` is. There's no double-quote character in them, and every statement ends with `;` or a closing brace:

    ```powershell
    $ErrorActionPreference = 'Stop';
    try {
    Add-Type -AssemblyName System.Speech;
    $voice = New-Object System.Speech.Synthesis.SpeechSynthesizer;
    if (@($voice.GetInstalledVoices() | Where-Object { $_.Enabled }).Count -eq 0) { throw 'no voice is installed' };
    $voice.SetOutputToDefaultAudioDevice();
    } catch {
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ error = $_.Exception.Message }));
    exit 1
    };
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ ready = $true; voice = $voice.Voice.Name }));
    $in = New-Object System.IO.StreamReader([Console]::OpenStandardInput());
    $next = $in.ReadLineAsync();
    $prompt = $null;
    while ($true) {
    if ($null -ne $prompt -and $prompt.IsCompleted) { $prompt = $null; [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ done = $true })) };
    if (-not $next.Wait(40)) { continue };
    $line = $next.Result;
    if ($null -eq $line) { break };
    $next = $in.ReadLineAsync();
    $message = ConvertFrom-Json -InputObject $line;
    if ($message.stop) { $voice.SpeakAsyncCancelAll(); continue };
    try { $voice.Rate = [int]$message.rate; $prompt = $voice.SpeakAsync([string]$message.say) }
    catch { [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ done = $true; error = $_.Exception.Message })) }
    };
    $voice.SpeakAsyncCancelAll();
    $voice.Dispose()
    ```

    Each `say` gets exactly one `{"done":true}`, spoken or cancelled. A `stop` with nothing speaking gets none. The end of the input ends the script.
  - **`export function windowsVoice(options?: { spawnVoice?: SpawnVoice; script?: string; readyMs?: number; closeMs?: number }): Promise<Voice>`:**
    - It spawns `"powershell.exe"`, `["-NoProfile", "-NonInteractive", "-Command", powershellCommand(script ?? SPEAK_SCRIPT)]`, and reads its stdout a line at a time (`node:readline`, UTF-8).
    - It resolves on `{"ready":…}`. On `{"error": m}` it rejects with `EnvironmentError("The computer's voice didn't start: <m>.")`. It rejects the same way, naming why, on an exit, an `error` event, or no answer within `readyMs` (20,000), and then kills the child.
    - `say` writes `asciiJson({ say: text, rate: sapiRate(wpm) }) + "\n"`. It resolves on the next `{"done":true}`.
    - A done with `error` rejects with `"The computer's voice couldn't say a line: <m>."`.
    - An exit while a line is waiting rejects with `"The computer's voice stopped."`, and so does every later `say`.
    - `stop()` writes `{"stop":true}\n`, only while a `say` is waiting.
    - `close()` ends stdin, then kills the child if it hasn't exited after `closeMs` (2,000).
  - **`export function macVoice(options?: { spawnVoice?: SpawnVoice }): Promise<Voice>`:**
    - It starts by running `say -v ?`, and resolves when that exits with 0 after printing something. Otherwise it rejects with `EnvironmentError("macOS's voice didn't start: <why>.")`.
    - `say` spawns `"say"`, `["-r", String(Math.round(wpm)), "-f", "-"]`, writes `text + "\n"`, and ends stdin. It resolves on exit code 0, or on any exit after `stop()`. It rejects with `"macOS's voice stopped."` on an `error` event or any other exit.
    - `stop()` and `close()` kill the current `say`.
  - **`export function startSystemVoice(platform: NodeJS.Platform, spawnVoice?: SpawnVoice): Promise<Voice>`:** `"win32"` gives `windowsVoice`, and `"darwin"` gives `macVoice`. Any other platform rejects with `EnvironmentError("--replay reads the transcripts aloud with Windows' or macOS's own voice, so it runs on Windows or a Mac, not on <platform>.")`, with no spawn.
  - **Test helper:** `fakeChild(): VoiceChild & { written(): string; answer(json: object): void; exit(code: number | null): void; killed: boolean; ended: boolean }`.

- [ ] **Step 1: Write the failing tests** in `test/review-replay-voice.test.ts`:
  - **"starts PowerShell with no shell, and the words only on its input"** (Review Focus 3):
    - the fake spawn's file is `"powershell.exe"`, and its args are the first three above, then `powershellCommand(SPEAK_SCRIPT)`;
    - its options `toEqual(VOICE_SPAWN_OPTIONS)`, with no `shell` key;
    - after `answer({ ready: true })`, `say("Read more, link", 180)` writes exactly `{"say":"Read more, link","rate":0}\n`;
    - no argument contains "Read more".
  - **"writes each line as ASCII"** (Review Focus 2): `asciiJson({ say: "José … 👋", rate: 0 })` is `{"say":"Jos\u00e9 \u2026 \ud83d\udc4b","rate":0}`, with each backslash written literally, and `JSON.parse` gives back the words.
  - **"keeps a line that looks like a command or JSON as one line of data"** (Review Focus 3): `` say(`"; Remove-Item -Recurse C:\\ # {"stop":true}`, 180) `` writes one line, with one `\n` at its end, whose `JSON.parse(...).say` is the text.
  - **"maps words a minute onto the voice's scale":** `it.each` of `[180, 0], [540, 10], [60, -10], [240, 3], [120, -4], [200, 1], [1000, 10], [20, -10]`.
  - **"resolves a line when it's done, and stops it on stop()":**
    - `say` is waiting;
    - `stop()` writes `{"stop":true}\n`;
    - `answer({ done: true })` resolves it.
  - **"says why when it doesn't start":**
    - `answer({ error: "no voice is installed" })` rejects with `EnvironmentError`, and the message `The computer's voice didn't start: no voice is installed.`;
    - an exit with code 1 before ready rejects;
    - `readyMs: 50` with no answer rejects, and the child was killed.
  - **"rejects, rather than hangs, when the voice stops mid-line"** (Review Focus 5): after ready, with a `say` waiting, `exit(1)` rejects it with `"The computer's voice stopped."`, and a later `say` rejects at once.
  - **"ends PowerShell by ending its input":**
    - `close()` ends stdin, and resolves on exit;
    - with `closeMs: 50` and no exit, the child is killed.
  - **The Mac:**
    - **"starts say for each line, with the words on its input":**
      - the spawn is `"say"`, `["-r", "180", "-f", "-"]`, `VOICE_SPAWN_OPTIONS`;
      - its stdin got `"Read more, link\n"` and ended;
      - an exit with 0 resolves;
      - `stop()` kills it, and the exit then resolves;
      - an exit with 1 that no `stop()` caused rejects.
    - **"checks for a voice first":** `say -v ?` printing a line and exiting with 0 starts the voice. An exit with 1 rejects with `EnvironmentError`.
  - **"runs on Windows and a Mac only":** `startSystemVoice("linux", spawn)` rejects with the message above, and the spawn was never called.
  - **"speaks through the real script, silently"**, only on Windows (`describe.runIf(process.platform === "win32")`), and covering Review Focus 2, 3, and 5:
    - it runs `windowsVoice({ script: SPEAK_SCRIPT.replace("SetOutputToDefaultAudioDevice()", "SetOutputToNull()") })`, and asserts the replace changed the script;
    - when it rejects with "no voice is installed", the test checks that message and skips the rest (`ctx.skip()`), since a CI image may have no voice;
    - otherwise:
      - `say("José … \"; Remove-Item x #", 540)` resolves;
      - a `say` of a 2,000-character line, followed at once by `stop()`, resolves;
      - `close()` resolves within 5 seconds.
- [ ] **Step 2:** Run the file. Expected: FAIL.
- [ ] **Step 3: Implement** `voice.ts` and `fakeChild()`.
- [ ] **Step 4:** Run the file. Expected: PASS, with the real-script test running on Windows. Then run `pnpm lint && pnpm typecheck`.
- [ ] **Step 5:** Commit: `Give the replay the computer's own voice: System.Speech in one PowerShell fed JSON lines on Windows, and say on a Mac, with the words never on a command line`.

### Task 3: The player

**Files:**
- Create: `src/review-replay/player.ts`.
- Modify: `test/helpers/replay.ts`: add `fakeVoice()`.
- Test: `test/review-replay-player.test.ts` (new).

**Interfaces:**
- Consumes: `Key` and `KeySource` (Task 1), `REPLAY_TEXT` (Task 1), and `Voice` (Task 2).
- Produces:
  - **`export interface PlayLine`:**
    - `n: number`, its line number in the TXT transcript;
    - `text: string`, as the transcript writes it;
    - `spoken: string`, what the voice says, "" for none;
    - `marks: string[]`.
  - **`export type Transcripts = Partial<Record<PassName, PlayLine[]>>`.**
  - **`export const RATE = { start: 180, min: 60, max: 540, step: 20 } as const`.**
  - **`export type PlayerKey`:** "pause", "back", "ahead", "next-flag", "headings", "tab", "read", "faster", "slower", "decide", or "quit".
  - **`export interface PlayerState`:** `transcripts`, `pass: PassName`, `index: number`, `paused: boolean`, `rate: number`, `outcome: "playing" | "decide" | "quit"`, and `notice: string | null`.
  - **`startState(transcripts, rate)`:** the read pass at index 0, playing. When the read transcript has no lines, its outcome is "decide".
  - **`onKey(state, key)`**, pure. Every key clears the last notice.
    - pause: toggles `paused`;
    - back: index − 1, not below 0;
    - ahead: index + 1, and "decide" past the last line;
    - next-flag: the next line after this one, in this pass, with a mark. With none, the notice is `noFlagAfter`, and nothing else changes;
    - headings, tab, and read: that pass from its start, even when it's the one playing. For a pass with no lines, the notice is `noLines(pass)`, and nothing else changes;
    - faster and slower: the rate ± `RATE.step`, within `RATE.min`–`RATE.max`, with the notice `speed(rate)`;
    - decide and quit: their outcomes;
    - moving never changes `paused` (D7).
  - **`onLineSpoken(state)`**, pure: index + 1, or "decide" past the last line.
  - **`playerKeyOf(key: Key): PlayerKey | null`:**
    - space gives pause, left back, right ahead, enter decide, and ctrl-c quit;
    - n or N gives next-flag; h or H headings; t or T tab; r or R read;
    - `+` or `=` gives faster, and `-` or `_` slower;
    - anything else gives null.
  - **`playPage({ transcripts, rate, voice, keys, out }): Promise<{ outcome: "decide" | "quit"; rate: number }>`**, the loop:
    - It shows a line (`REPLAY_TEXT.line`) when the line becomes the current one: not again when it's said again after a key or a pause.
    - It shows `REPLAY_TEXT.pass(pass, count)` on a switch, and each notice.
    - It speaks the current line when it isn't paused and its `spoken` isn't "". A silent line is shown, and passed at once.
    - While a line is spoken, it waits for whichever comes first: the voice, or `keys.waiting()`.
    - A waiting key stops the voice, waits for that `say()` to resolve, and is then taken with `keys.next()` and acts. When a key is already waiting as a line starts, it acts first.
    - A key is taken only when it acts, so no key is lost between lines, or to the question after the page.
    - `null` from the keys ends it with "quit".
    - A rejected `say()` rejects `playPage`.
  - **Test helper:** `fakeVoice(options?: { auto?: boolean }): Voice & { said: { text: string; wpm: number }[]; stops: number; closed: boolean; finish(): void; fail(error: Error): void; starting: Promise<void> }`. With `auto`, each `say` resolves at once. `finish` resolves the waiting line, and `stop()` resolves it too. `starting` resolves when the next `say` is called.

- [ ] **Step 1: Write the failing tests** in `test/review-replay-player.test.ts`. Most use a fixture of three read lines (line 3 marked), two headings lines, and an empty Tab transcript:
  - **"moves as each key says"**, an `it.each` of start state, key, and what it gives:
    - ahead from 0 gives index 1, and ahead at 2 gives "decide";
    - back at 0 stays at 0;
    - next-flag at 0 gives 2, and at 2 gives the notice "No flagged line after this one." at index 2;
    - headings gives that pass at 0;
    - tab gives the notice "No lines in the Tab transcript.", with the pass unchanged;
    - read at index 2 of read gives index 0;
    - faster at 540 stays at 540, and slower from 180 gives 160, with the notice "Speed: 160 words a minute.";
    - pause twice gives `paused` false;
    - decide and quit give their outcomes;
    - `onLineSpoken` at the last line gives "decide".
  - **"speaks each line in turn, and asks once the transcript ends":** with `fakeVoice({ auto: true })`:
    - the output shows the three lines in order;
    - `said` is their `spoken`, at 180;
    - the outcome is "decide".
  - **"stops the voice for a key, then acts"** (Review Focus 4): while line 1 is spoken, push right three times. Then `said` is lines 1, 2, and 3, `stops` is 3, the outcome is "decide", and no `say` is still waiting.
  - **"pauses, and says the line again on Space":**
    - space while line 1 is spoken gives `stops` 1, and the output has "Paused. Press Space to go on.";
    - space again says line 1 again;
    - line 1 is shown once.
  - **"moves while paused without speaking"** (D7): pause, then right. Line 2 is shown, and `said` is still line 1 alone.
  - **"passes a silent line without speaking it":** a line whose `spoken` is "" and whose text is "[no speech]" is shown, and never said.
  - **"ends with quit when the keys end, and rejects when the voice fails":** `end()` gives "quit". `fail(new Error("gone"))` rejects with that error.
  - **"keeps the speed for the next page":** faster during the page gives `rate` 200.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement** `player.ts` and `fakeVoice()`.
- [ ] **Step 4:** PASS. Then run `pnpm lint && pnpm typecheck`.
- [ ] **Step 5:** Commit: `Play a page's transcripts line by line, with keys to pause, move, jump to a flagged line, switch transcripts, and change the speed`.

### Task 4: Which pages, and their lines

**Files:**
- Create: `src/review-replay/pages.ts`.
- Modify: `src/share/model.ts`: export `namedByAttention`, and have `ringOf` use it.
- Test: `test/review-replay-pages.test.ts` (new). `test/share-model.test.ts` must pass unchanged.

**Interfaces:**
- Consumes:
  - `PlayLine` and `Transcripts` (Task 3);
  - `loadShareInput` and `ShareInput` (`src/share/load.ts`), `buildShareModel` (`src/share/model.ts`), `standingOf` (`src/share/standing.ts`), and `shownPasses` (`src/share/cards.ts`);
  - `contentSteps`, `flagItemLines`, `flagQuotes`, `FlagRules`, and `PagePasses` (`src/flags/evaluate.ts`);
  - `stepLine` (`src/transcripts/format.ts`), and `normalizeSpeech` (`src/passes/steps.ts`).
- Produces:
  - **`export function namedByAttention(attention: AttentionCard[]): Set<string>`:** the slugs of every page on any card. `ringOf` uses it, with its results unchanged.
  - **`export function transcriptsOf(passes: PagePasses, flags: FlagResult[], rules: FlagRules): Transcripts`.** For each pass in `passes`, `contentSteps(pass, data)` gives the lines (D6): `{ n: step.n, text: stepLine(step, pass), spoken: normalizeSpeech(step.spoken), marks }`. A line's marks, each once:
    - first, every `flagItemLines(passes, rules)` entry for the same pass whose rule raised a flag in `flags` for that pass, and whose `spoken` equals the line's `spoken`, as its `item`;
    - then, for each other flag in `flags`, in order, `flag.rule` when one of `flagQuotes(passes, rules, flag)` equals the line's `spoken`, in `flag.pass` (D5).
  - **`export interface ReplayPage { key: string; url: string; path: string; run: string; flags: number; transcripts: Transcripts }`:**
    - `url` is the URL as the shown run recorded it;
    - `path` is the card's;
    - `run` is the shown run's id;
    - `flags` is the shown record's number of flags.
  - **`export interface ReplayChoice { page: string | null; all: boolean }`.** `page` is a page key.
  - **`export function replayPagesOf(input: ShareInput, model: ShareModel, choice: ReplayChoice): { pages: ReplayPage[]; leftOut: string[] }`:**
    - It takes `standingOf(input.runs)` and pairs `model.pages[i]` with `standing.pages[i]`, throwing `Error("The page cards and the standing disagree at <key>.")` when their keys differ.
    - With `choice.page`, the page it names. With `choice.all`, every page. Otherwise, each page whose card has `counts` and whose slug is in `namedByAttention(model.attention)` (D2).
    - Each picked page whose shown transcripts include a readable read pass is a `ReplayPage`. Its passes come from `shownPasses(shown, input.transcripts)`, and its flags from `shown.page.flags`.
    - Any other picked page's `path` goes into `leftOut`.
    - Both lists are in `model.pages`' order, the latest run's.
    - With `choice.page`, `UsageError`s:
      - `"<key> isn't one of the pages in scope, so there's no transcript of it to hear."`;
      - `"No run that counts has transcripts for <key> yet."`;
      - `"The read transcript of <path> can't be read here."`.

- [ ] **Step 1: Write the failing tests** in `test/review-replay-pages.test.ts`. They build the input with `loadShareInput({ siteDir, config })` and the model with `buildShareModel(input)`. The config is `config().config` (`test/helpers/run-site.ts`) for `homeWithCountedRun()`, and `DEFAULT_CONFIG` for the i2i fixture:
  - **"takes the pages What needs attention names, every page, or one"**, on `homeWithCountedRun()` (`test/helpers/run-site.ts`):
    - the default gives `["/resources"]`;
    - `all` gives `["/", "/about", "/resources"]`;
    - the key of `/about` gives `["/about"]`;
    - each `run` is the counted run's id, and each `url` is its record's.
  - **"marks the lines that raised a flag, by what the rule found":** on `fixture/i2i-v3-run/v3--i2i.netlify.app`, read in place, choosing `https://v3--i2i.netlify.app/`:
    - `flags` is 2;
    - the read lines start at `n` 2, with the text "[to top] out of list, Skip links, navigation landmark, same page, link, Skip to main content", and `spoken` without "[to top] ";
    - the only marked read lines are `n` 4 and 11, each `["unlabeled graphic"]`;
    - no read line has `n` 1;
    - Tab line `n` 3 is `["unlabeled graphic"]`.
  - **"marks a heading the headings rule quoted, by the rule's id":** on `homeWithCountedRun()`'s `/resources`:
    - headings line 1's marks are `["headings"]`;
    - each read line "link, Read more" has the mark "read more";
    - the line "Text" has none.
  - **"follows the review, as What needs attention does"** (D2), on `homeWithCountedRun()`:
    - after an `addReview` of `/resources` as "reviewed", the default gives nothing;
    - after an "issue" entry, it gives `/resources` again.
  - **"leaves out a page with nothing to hear, and says so":** on a temporary copy of the i2i fixture with one page's `read.json` deleted, `all` gives 31 pages, and `leftOut` names that page's path.
  - **"says why one page can't be heard":**
    - a key not in scope gives the first message;
    - a page that no run read gives the second. Build its input with `inputOf` (`test/helpers/share-model.ts`), as `test/share-model.test.ts`'s "counts a page never read as not read" does.
  - **`test/share-model.test.ts`** passes unchanged.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement** `pages.ts` and `namedByAttention`.
- [ ] **Step 4:** PASS, with `test/share-model.test.ts` unchanged. Then run `pnpm lint && pnpm typecheck`.
- [ ] **Step 5:** Commit: `Pick the pages to hear as What needs attention names them, with each line's number and marks from the shown transcripts`.

### Task 5: The session

**Files:**
- Create: `src/review-replay/session.ts`.
- Test: `test/review-replay-session.test.ts` (new).

**Interfaces:**
- Consumes:
  - everything above;
  - `addReview` (`src/reviews/review.ts`), `resolveReviewer` (`src/reviews/reviewer.ts`), `resolveHome` (`src/run/paths.ts`), `chooseSiteDir` (`src/run/site-dir.ts`), `loadConfig` (`src/config/load.ts`), `resolvePageArgument` (`src/pages/page-argument.ts`), `listRuns` (`src/run/store.ts`), and `regenerateLiveReport` (`src/run/live-report.ts`).
- Produces:
  - **`export interface ReplayOptions`:** `{ page: string | null; all: boolean; rate: number; reviewer: string | null; site: string | null; out?: string; cwd: string; env: NodeJS.ProcessEnv }`.
  - **`export interface ReplayDeps`:** `{ out: OutputStream; keys: KeySource; logger: Logger; startVoice: () => Promise<Voice>; nvdaRunning: () => Promise<boolean>; writeReport?: (options: LiveReportOptions) => Promise<unknown> }`. `writeReport`'s default is `regenerateLiveReport`. `nvdaRunning` rejects when it can't tell.
  - **`export interface ReplayResult { decisions: number; outcome: "done" | "quit" }`.**
  - **`export async function replayReview(options: ReplayOptions, deps: ReplayDeps): Promise<ReplayResult>`**, in this order:
    1. Resolve the reviewer (`resolveReviewer`, which throws "No reviewer name…"), the home, the site's folder (`chooseSiteDir`, with the site and the page), and the config.
    2. With no run (`listRuns`), throw `UsageError("There's no run in <siteDir> yet, so there's nothing to hear.")`.
    3. Load the input (`loadShareInput`) and the model (`buildShareModel`). With no run that counts (`model.header.tested === null`), throw `UsageError("No run here counts yet (a replayed, interrupted, or unsealed run doesn't count), so there are no transcripts to hear.")`. Resolve `--page` to its key (`resolvePageArgument`), then call `replayPagesOf`.
    4. Print `leftOut(paths)` when any page is left out. With no page to play, print `nothingDefault` (or `nothingAll` with `all`), and return `{ decisions: 0, outcome: "done" }`, starting no voice.
    5. `deps.startVoice()`. A rejection propagates before anything is recorded.
    6. When `nvdaRunning()` gives true, print the two `nvda` lines and wait for Enter (other keys are ignored; Ctrl+C or the keys ending quits). A rejection counts as false.
    7. Print `keys`. Then, for each page:
       - print `page(i, count, path, flags)`;
       - call `playPage` at the session's rate, and carry its rate on;
       - on "decide", print `question`, and wait for 1, 2, 3, or 4, ignoring any other key (D3);
       - for 2 and 3, print `note` and call `readNote`;
       - record 1, 2, or 3 as "reviewed", "issue", or "fixed", through `addReview({ page: url, status, note, reviewer, run, site, out, cwd, env, config, logger, regenerateReport: false })`, and count it.
       
       Ctrl+C, or the keys ending, at any point quits: a page whose note was cut short records nothing.
    8. In a `finally`:
       - close the voice;
       - when at least one decision was recorded, `writeReport({ outDir: siteDir, config, logger })`, once;
       - print `recorded(decisions)`.
       
       Then return, or rethrow what went wrong.

- [ ] **Step 1: Write the failing tests** in `test/review-replay-session.test.ts`. They run on `homeWithCountedRun()`, with `reviewer: "Pat Reviewer"`, `out: <its home>`, `fakeVoice({ auto: true })` (unless a test says otherwise), and a `keyQueue()`.

  Each answer is pushed only when its question appears. That's `answering(keys, answers)` in `test/helpers/replay.ts`: an `OutputStream` that records the output, and pushes the next answers each time it sees `REPLAY_TEXT.question`, or the two `nvda` lines. So the player never takes an answer as a key. The note's keys go with its choice: "2, B, a, d, enter" is one answer.
  - **"records each decision through addReview, against the run it played, and writes the report once":** with `all` and the keys 1, 2, B, a, d, enter, 4:
    - `reviews.json` has `/` as "reviewed" (note null) and `/about` as "issue" with the note "Bad", both by Pat Reviewer against the counted run, and nothing for `/resources`;
    - `writeReport` was called once, with the site's folder;
    - the result is `{ decisions: 2, outcome: "done" }`;
    - the output has "Page 1 of 3: / (no flags)" and ends with "Recorded 2 decisions.".
  - **"answers the question only with 1 to 4":** the keys enter, x, 3, enter record one "fixed" entry, and nothing else.
  - **"ends on Ctrl+C, keeping what was recorded"** (Review Focus 1). Task 3 covers Ctrl+C while a line is spoken:
    - with 1, then ctrl-c as page 2's answer, the result is `{ decisions: 1, outcome: "quit" }`;
    - `writeReport` was called once;
    - the voice is closed.
  - **"records nothing for a page whose note was cut short":** the keys 2, x, ctrl-c record no entry, and `writeReport` isn't called.
  - **"writes nothing when nothing was decided":** the keys 4, 4, 4 leave no `reviews.json`. `writeReport` isn't called, and the output ends with "Recorded no decisions.".
  - **"waits for Enter while NVDA is running":**
    - with `nvdaRunning` giving true, the output has the two `nvda` lines, and `said` stays empty until enter is pushed;
    - with false, or a rejection, there are no such lines;
    - `nvdaRunning` is the session's one way to reach NVDA, and it only asks. `ReplayDeps` has nothing that stops or starts NVDA.
  - **"stops before anything is recorded when the voice doesn't start":** `startVoice` rejecting with an `EnvironmentError` makes `replayReview` reject with it. There's no `reviews.json`, and no key was read.
  - **"ends, and says so, when the voice stops mid-page"** (Review Focus 5):
    - with 1 on page 1 and the voice failing on page 2, it rejects with the voice's error;
    - page 1's entry stays;
    - `writeReport` was called once, and the voice closed.
  - **"closes the voice on every way out"** (Review Focus 1): each of these leaves `closed` true:
    - the last page;
    - Ctrl+C;
    - the voice failing;
    - `addReview` throwing. For that, write `"{ this is not json"` into `reviews.json` when the question appears, as `test/reviews.test.ts`'s "never overwrites a damaged history" does, so the session rejects with "never overwrites review history".
  - **"says when there's nothing to hear":**
    - after `/resources` is reviewed, the default prints `nothingDefault`;
    - the voice was never started;
    - the result is `{ decisions: 0, outcome: "done" }`.
  - **"names the pages it leaves out":** with `all`, and one page's `read.json` deleted, the output has `Left out, with no transcripts to hear: <path>.`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement** `session.ts`.
- [ ] **Step 4:** PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Hold the replay's session: each page in turn, the question after it, each decision recorded through addReview against the run it played, and the report once`.

### Task 6: `voicecap review --replay`

**Files:**
- Modify: `src/cli/main.ts`.
- Modify: the spec, with C1, C2, and C3, and D1 to D8 where they settle what the spec left open.
- Test: `test/cli.test.ts`.

**Interfaces:**
- Consumes:
  - `replayReview` (Task 5), `terminalKeys` and `REPLAY_TEXT` (Task 1), and `startSystemVoice`, `Voice`, and `RATE` (Tasks 2 and 3);
  - `nvdaProcesses` (`src/drivers/guidepup/windows.ts`), `stopOnClosedWindow` (`src/run/signals.ts`), and `isTerminalStream` (`src/util/terminal.ts`).
- Produces:
  - **`CliContext.replayVoice?: () => Promise<Voice>`**, which tests use to replace the computer's voice. It defaults to `() => startSystemVoice(ctx.platform)`.
  - **`CliContext.nvdaRunning?: () => Promise<boolean>`**, which tests use to replace the check for a running NVDA. It defaults to `async () => (await nvdaProcesses()).length > 0` on `"win32"`, and to `false` elsewhere.
  - **The `review` command:**
    - `--page` is no longer required;
    - `--status` keeps its choices, and isn't mandatory;
    - new options: `--replay` ("hear each page's saved transcript read aloud at a normal speed, and decide as you go"), `--all` ("with --replay: every page with transcripts"), and `--rate <wpm>` ("with --replay: the voice's speed in words a minute, 60 to 540 (default 180)").
  - **Its checks, all `UsageError`s:**
    - without `--replay`:
      - "--page is required, unless --replay is given.";
      - "--status is required, unless --replay is given.";
      - "--all and --rate go with --replay.";
    - with `--replay`:
      - "--replay asks for each decision itself, so it doesn't take --status, --note, or --run." when one of them is given;
      - "--all and --page can't be used together.";
      - `` `--rate is in words a minute, a whole number from 60 to 540 (got "${value}").` ``;
      - `REPLAY_TEXT.noTerminal` unless `ctx.stdin` and `ctx.stdout` are both terminals.
  - **Its wiring:**
    - `terminalKeys(ctx.stdin, closed.signal)`, where `closed` aborts on `stopOnClosedWindow`;
    - `replayReview` with `out: ctx.stdout` and the logger;
    - a `finally` that closes the keys and stops listening for the window;
    - exit code `ExitCode.interrupted` for "quit", and `ExitCode.ok` otherwise.
  - Without `--replay`, everything is as before.

- [ ] **Step 1: Write the failing tests** in `test/cli.test.ts`. Its `CliExtra` gains `replayVoice` and `nvdaRunning`:
  - **"review needs --page and --status, unless --replay is given":** `["review", "--status", "reviewed"]` and `["review", "--page", "/"]` each exit with 1, with their messages.
  - **"review --replay takes no --status, --note, or --run, and checks --rate":**
    - `["review", "--replay", "--status", "reviewed"]` exits with 1, with the message;
    - so does `["review", "--replay", "--rate", "20"]`;
    - `["review", "--page", "/", "--status", "reviewed", "--all"]` exits with 1: "--all and --rate go with --replay.".
  - **"--replay needs a terminal":** `cli(["review", "--replay"], dir, {}, { stdin: linesStream() })` exits with 1, with `REPLAY_TEXT.noTerminal`, and the `replayVoice` spy was never called.
  - **"hears a page at a terminal, and records the decision":** call `main` directly, as `atTerminal` does, on `homeWithCountedRun()`, with:
    - stdin `ttyInput()`;
    - stdout `terminalScreen(onWrite)`, which writes "1" to stdin once the question appears;
    - `replayVoice` giving `fakeVoice({ auto: true })`, and `nvdaRunning` giving false;
    - the args `["review", "--replay", "--page", "/about", "--reviewer", "Pat Reviewer", "--out", home]`.

    Then:
    - the code is 0;
    - `reviews.json`'s `/about` entry is "reviewed" by Pat Reviewer against the run;
    - `rawModes` is `[true, false]`;
    - the screen shows "Page 1 of 1: /about (no flags)" and "Recorded 1 decision.".
  - **"exits with 130 when Ctrl+C ends it":** the same, writing `"\u0003"` at the question, gives code 130, and "Recorded no decisions.".
  - Every existing `review` test passes unchanged.
- [ ] **Step 2:** Run `pnpm vitest run test/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement,** and write C1–C3 and D1–D8 into the spec's "How it's built" and "The session".
- [ ] **Step 4:** PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Give voicecap review --replay, --all, and --rate: a review session that reads each page's saved transcript aloud, at a terminal`.

### Task 7: The README and the CHANGELOG

**Files:**
- Modify: `README.md`:
  - **Under "Reviews: the audit trail",** in its fold, a part headed **"Hearing pages again: `voicecap review --replay`"**, with two examples (`npx @icjia/voicecap review --replay` and `npx @icjia/voicecap review --replay --page /about --rate 160`). It says:
    - it reads each page's saved transcript aloud in the computer's own voice (Windows' built-in voice, or `say` on a Mac), at a normal speed. These are the saved words, not NVDA reading the page again;
    - each line is shown as it's read, numbered as in its transcript, with ⚑ and what the rule found on a line that raised a flag;
    - which pages it takes: by default What needs attention's pages that NVDA read, in page order, or `--page` and `--all`;
    - a table of the keys;
    - the question, with Enter alone never answering it, and the note;
    - that each decision is recorded as `review` records one, against the run it played, and that the report is written again at the end;
    - `--rate`;
    - that it needs a terminal;
    - that when your own NVDA is running, voicecap says so and waits for Enter, and never stops or starts it;
    - that it runs on Windows and on a Mac.
  - **The fold's summary line** adds "hearing pages again with `--replay`".
  - **"Other commands":** the line `voicecap review --replay [--page <url> | --all] [--rate <words a minute>] [--reviewer <name>] [--site <url>] [--out <dir>]`.
  - **"Exit codes":** 130 also when Ctrl+C ends `review --replay` (what was recorded stays recorded), and 2 when it finds no voice.
  - **Step 5 of how it works:** a sentence that `voicecap review --replay` reads a page's saved words aloud, at a speed a person can follow.
- Modify: `CHANGELOG.md`: under `## [Unreleased]`, `### Added`, one entry in the CHANGELOG's style:
  - what the replay is and why: NVDA is far too fast to follow during a run;
  - which pages;
  - the keys, the question, and the note;
  - `--rate`;
  - the person's own NVDA;
  - that it needs a terminal;
  - Windows and Mac.

- [ ] **Step 1:** Make the changes above, in the README's voice: "hear" and "read", never "listened" or "automated".
- [ ] **Step 2:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS, with `test/share-text.test.ts` unchanged: the timeline's row comes with the release.
- [ ] **Step 3:** Commit: `Describe voicecap review --replay in the README and the CHANGELOG`.

## At the PC, with the owner (before the release)

The controller builds the branch (`pnpm build`) and copies `fixture/i2i-v3-run` to a new temporary folder. The owner then follows these steps at the keyboard. NVDA doesn't run for voicecap here, so it isn't hands-off:
1. **Leave your own NVDA running** for this check, so you see its message.
2. **Open a terminal** in `C:\Users\cschw\code\voicecap-replay`.
3. **Run** `node dist/cli.js review --replay --page / --reviewer "Christopher Schweda" --out "<the copy>"`, and press Enter.
4. **When the two lines about NVDA appear** (after "Starting the computer's voice."), press NVDA+S until NVDA beeps or goes quiet (or quit NVDA), then press Enter in the terminal.
5. **Check the start,** each line shown as the computer's voice says it, at a normal speed:
   - the keys' line, which the voice says in words;
   - then "Page 1 of 1: / (2 flags)";
   - then "Read transcript, 31 lines:";
   - then line 2 ("[to top] out of list, Skip links, …").
6. **Press N:** the voice jumps to line 4, the logo line, which ends "⚑ unlabeled graphic", and reads it.
7. **Try the other keys:**
   - Space, twice: a pause, which the voice says ("Paused. Press Space to go on."), then the line again;
   - Left Arrow and Right Arrow;
   - + and −: the speed line, said at the new speed;
   - H, then T, then R: each transcript from its start, its name said first.
8. **Press Enter.** The question appears, and the voice says it.
9. **Press 2, type** `Logo has no alt text`, and press Enter.
10. **Check the end:** a line beginning `Recorded "issue" for https://v3--i2i.netlify.app/ by Christopher Schweda against run 2026-10-06_1134`; then "Recorded: issue found.", "Recorded 1 decision.", and "Turn NVDA's speech back on (NVDA+S changes its speech mode), or start it again if you quit it.", each said by the voice too; then the prompt.
11. **Turn NVDA's speech back on** (NVDA+S until it talks).
12. **If anything goes wrong,** press Ctrl+C, and paste what the terminal shows into the chat.

The controller then checks that the copy's `reviews.json` has that entry, and that the owner's own transcripts home hasn't changed.

## The release (the controller, with the owner)

1. Run the final review, then one fix wave and its re-review.
2. Push the branch, and get CI green on all six jobs. The real-script test runs on the Windows jobs.
3. Merge: `git switch main && git merge --no-ff plan-8-review-replay`.
4. **"Prepare 0.14.0":**
   - the CHANGELOG's `## [0.14.0] - <date>` and its compare link;
   - the timeline's 0.14.0 row in `src/share/text.ts`, before its last, undated row, under `both`: `<b>0.14.0</b>: the review replay: <code>voicecap review --replay</code> reads each page's saved transcript aloud at a normal speed, line by line, with keys to jump to a flagged line and to the other transcripts, and records each decision.`;
   - the tests that pin the timeline, as 8bc2246 changed them;
   - `docs/phase-c-handoff.md`'s "Published" and "Being built" lines.

   Run `pnpm audit`, push, and get CI green.
5. Run `./publish.sh --dry-run minor`. Then run `npm whoami`; if it fails, the owner logs in.
6. The owner gives a fresh 2FA code. Run `npm version minor --no-git-tag-version && npm publish --access public --ignore-scripts --otp <code>`.
7. Commit "Release v0.14.0", tag `v0.14.0` (annotated), and push with the tag.
8. Wait until the 0.14.0 tarball answers 200, and 10 minutes have passed since the publish. Then, in the transcripts repo, set `netlify.toml`'s command to `@0.14`, commit, and push (the owner's standing OK). The shareable page doesn't change, so no site needs sharing again.
9. Update the handoff and the memories. Next is plan 6c, as 0.15.0: merge main into `plan-6c-nvda-log` first.

## After execution

- **Task 2's `SPEAK_SCRIPT` isn't the one above:** Ruling R5 changed it to answer each line from System.Speech's `SpeakCompleted`, with the line's error when its audio fails. The spec's "Plan 8's corrections, decisions, and rulings" records R5 and the plan's other rulings, and `src/review-replay/voice.ts` has the script as built.
