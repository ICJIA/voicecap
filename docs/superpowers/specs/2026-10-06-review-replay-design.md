# Review replay: hearing a page's transcript at a normal speed while reviewing

## Why

During a run, NVDA speaks far too fast to follow, which is why voicecap saves every word as transcripts. The person reviewing reads those transcripts and decides what each page needs. The owner asked on 2026-10-06 for a way to *hear* a page during a review, at a speed a person can follow: "a 'review' flag that can replay the page at normal speed for a person to review." Hearing it is how a screen reader user meets the page, and it helps the person decide.

## What it is

`voicecap review --replay` is a guided review session: for each page, voicecap reads the page's saved transcript aloud in the computer's own voice, at a normal speed, and then asks what the person decided. It records each decision as `voicecap review` records one today. The owner chose each part of this on 2026-10-06:
- the saved words, read aloud (not NVDA reading the live page again);
- a flag on `review` (not a command of its own);
- the line-by-line transcript, with keys to jump to flagged lines and to switch to the other two transcripts.

It's still the person's review: voicecap plays what NVDA said, and the person hears it, reads it, and decides.

## The session

**Which pages:**
- `--page <url>`: that page.
- Otherwise, the pages "What needs attention" names, among those NVDA read, in the latest run's page order (C2, D2). That's every page with flags no one has decided on, every page that reads differently since its review, a page with an open issue, and a page whose read stopped short: the ring's "Read, with problems", worked out as the ring works it out.
- `--all`: every page with transcripts, in that order. It can't be given with `--page`.
- `--site` and `--out` as `review` takes them; `--reviewer` as today (default: `VOICECAP_REVIEWER`, then `git config user.name`).

A page plays from its shown transcripts: the latest run that read it, as the shareable page shows it. Each decision on it is recorded against that run (C3). voicecap gives `addReview` the run itself, though the person can't give `--run`: `addReview`'s own default, the newest run with transcripts of the page, can be a replayed or unsealed run.

A page picked with nothing to hear (no run that counts read it, or its read transcript can't be read here) is left out, and named before the first page. With no page to hear at all, voicecap says so, and starts no voice.

**Each page, in order:**
1. A line names it: `Page 3 of 7: /biographies/ (2 flags)`.
2. The voice reads the read pass (Down Arrow), line by line. Each line is shown as it's read, with its number: `  12  banner landmark, same page, link, current page, Unlabeled graphic, i 2i Logo…`. A line that raised a flag carries a mark after it, in words: `⚑ unlabeled graphic`.
   - **What plays (D6):** each pass plays its content steps, the steps the flag rules read. So the read pass starts at Ctrl+Home's line, "[to top] …", leaves out Ctrl+End's line, and doesn't repeat its last line. Each line keeps its number in the TXT transcript, so line 4 on screen is line 4 of `read.txt`. A line is shown as the transcript writes it, with "[to top]" or "[no speech]". The voice says it without the label, and says nothing for "[no speech]".
   - **What a mark says (D5):** for unlabeled and generic-link-text, what the rule found on the line ("⚑ unlabeled graphic", "⚑ read more"). For every other rule, the rule's id ("⚑ headings"), as the page's chips name rules.
   - **Which lines carry it (D5, Ruling R8):** unlabeled and generic-link-text mark each line they found something on. A rule whose quotes stand for a place on the page marks that place alone: the lines `flagQuotes` gives, at most 3 a flag, where they were said. Those rules are headings (the first heading), tab-before-main (the stops before the main content), and read-not-finished (the last line read), and the same words said elsewhere carry no mark. The rules whose quotes stand for their words (repeated-phrase, and a custom rule) mark every line that says the quoted words.
3. When the transcript ends, or the person presses Enter, voicecap asks:

   ```
   What did you decide?  1 Reviewed, no issues   2 Issue found   3 Fixed   4 Skip
   ```

   For 2 and 3 it asks for a note (Enter for none). The answer is recorded at once, through `addReview`: who, when, the run, and the transcripts' fingerprints, sealed and chained as every review entry is. Skip records nothing.
   - **A decision is one key, 1 to 4 (D3).** No other key answers the question, Enter alone included, so a stray key never records a decision. That's the same reason the question at the end of a run defaults to "No".
   - **The note** ends with Enter. Enter alone records no note (Ruling R2).
4. On to the next page. After the last, voicecap writes the report again once, and says how many decisions it recorded.

**How it ends (D8):**
- It ends after the last page, or when the person ends it: Ctrl+C, or the keys ending, as they do when the window is closed. Ended early, it exits with code 130, as an interrupted run does.
- The live report is written again once, at the end, and only when at least one decision was recorded. Otherwise nothing new is written (see Safety).
- Once the voice has started, every way out says how many decisions were recorded: the last page, Ctrl+C, the keys ending, and a failure, such as the voice stopping or `addReview` refusing, which is then shown. Before the voice starts, nothing could have been asked, so there's no count (Ruling R3): a usage error, nothing to hear, or a voice that doesn't start.

**Keys while a transcript plays:**
- **Space:** pause, and resume. Pausing stops the voice; resuming starts the current line again.
- **←** and **→:** back a line, and ahead a line. While the page plays, they pass over the lines with no words ("[no speech]"), as the page passes them at once: ← goes to the nearest line before that has words, or says the line again when there's none, and → to the nearest line after that has words, or to the question when there's none (Ruling R12). While paused, they go line by line (D7).
- **N:** the next line that raised a flag.
- **H**, **T**, and **R:** the headings transcript, the Tab transcript, and back to the read transcript, each from its start.
- **+** and **−:** faster and slower, for the rest of the session: 20 words a minute at a time, from 60 to 540 (D4). **+** is also `=`, and **−** is also `-` and `_`, so neither needs Shift.
- **Enter:** stop, and decide.
- **Ctrl+C:** end the session. What was recorded stays recorded, and the report is written again.

While paused, ←, →, N, H, T, and R move to their line, show it, and don't speak it, so a person can step through the lines in silence. Space speaks from there (D7).

Keys typed while a line is spoken wait their turn: each acts once the voice has stopped for it.
- A line that isn't paused always starts. A key already waiting then stops it at once, and acts (Ruling R4).
- Ctrl+C, or the keys ending, ends the session without waiting for the line to stop: closing the voice ends it (Ruling R6).
- A line the voice was asked to stop gets 5 seconds to end. A voice that hasn't stopped it by then is stuck, and the session ends with "The computer's voice stopped answering." (Ruling R7).
- A key meant for one thing never acts on the next (Ruling R9). The keys left waiting before a page, or before NVDA's two lines, are dropped. So are the keys pressed in the half second after an answer, when a page follows: an Enter pressed after the digit, out of habit, would otherwise end the next page before it was heard. So are the keys pressed in the half second after the Enter that goes on from NVDA's two lines: with NVDA muted, nothing is heard until the voice starts, so a second Enter is likely, and it would end page 1 unheard (Ruling R12). A Ctrl+C among them still ends the session.

**The voice:**
- On Windows, its built-in voice (System.Speech), through a small PowerShell script that ships with voicecap.
  - The script is a constant in voicecap's code, given to PowerShell with `-Command`, not a `.ps1` file (C1, D1). Windows' default execution policy on Windows 10 and 11, "Restricted", refuses to run any `.ps1` file, and a policy set by Group Policy, as an agency's PCs may have, overrides `-ExecutionPolicy Bypass`. No policy applies to a script given with `-Command`, which is how voicecap's other PowerShell work already runs.
  - A line whose audio fails, as when the audio device is removed, isn't passed over in silence. The script answers each line when System.Speech says it's done (`SpeakCompleted`), with the error when there's one, and the session then ends and says why (Ruling R5).
- On a Mac, `say`.
- Its speed is in words a minute: `--rate <wpm>`, a whole number from 60 to 540, default 180 (D4). On Windows it maps onto the voice's own rate scale, as `round(10 × log₃(wpm ÷ 180))`, kept within −10 to 10. So 180 is the voice's normal speed (0), 540 its fastest (10), and 60 its slowest (−10).
- There's no NVDA, browser, or network. It reads the saved transcript, so it works at any time, offline, with the person's hands on the keyboard.
- On another platform, or with no voice found, `--replay` stops and says so, before anything is recorded. Its exit code is then 2, as when NVDA won't start for a run.

**It needs a terminal.** Without one (a script, CI), or with the output redirected, `--replay` stops and says so. `review` without `--replay` is unchanged: `--page` and `--status` are still required. voicecap checks them itself now ("--page is required, unless --replay is given."), since with `--replay` neither is required.

**The person's own NVDA.** An NVDA that's running reads each line as it appears in the terminal, so the person would hear it over the replay's voice. On Windows, before the first page, voicecap looks for a running `nvda.exe` in Windows' list of running programs (`tasklist`), as a run does before it starts NVDA (Ruling R12). When it finds one, it says so, and waits:

```
NVDA is running, and it will read these lines too, over the replay's voice.
Mute it (NVDA+S changes its speech mode) or quit it, then press Enter.
```

The session starts on Enter. voicecap never stops, starts, or changes the person's NVDA during a replay. When it can't tell whether NVDA is running, it starts anyway. That includes a check that hasn't answered within 5 seconds, so the session never waits more than 5 seconds on it.

## Safety

- **No shell:** the words reach the voice on its standard input, never in a command line, so no transcript can run a command.
  - On Windows, voicecap starts `powershell.exe` with `-NoProfile -NonInteractive -Command` and its own script (C1).
  - It sends each line as a line of JSON on standard input (`{ "say": "...", "rate": n }`, `{ "stop": true }`). The JSON is in ASCII alone, with every other character written as a `\uXXXX` escape, so the words arrive as written, whatever code page PowerShell reads its input in.
  - The script answers on standard output when a line is spoken, and never evaluates what it reads.
  - On a Mac, voicecap starts `say -r <rate> -f -` and writes the line to its input.
  - Nothing is started through `cmd /c` or any shell.
- **Nothing new is written,** except the review entries the person chose, through the existing `addReview`, and the report, written again once at the end when a decision was recorded (D8).

## How it's built

Six modules in `src/review-replay/`, each with one job, and the command:
- **`keys.ts`:** the keys a person presses, read from the terminal in raw mode for the whole session, and the note they type. In raw mode, Ctrl+C reaches voicecap as a key, not as a console signal, which on Windows would also end the voice's PowerShell.
- **`voice.ts`:** a `Voice` (`say(text, wpm): Promise<void>`, `stop(): void`, `close(): Promise<void>`), with a Windows voice and a Mac voice; the tests use a fake. The Windows script is `SPEAK_SCRIPT`, a constant here, given to PowerShell with `-Command` (C1), so there's no `.ps1` file, and the build doesn't change. The voices' error messages are here too, beside what goes wrong.
- **`player.ts`:** a pure state machine (the transcript's lines, the current line, flagged lines, the pass, paused, the rate), driven by keys, plus a loop that drives it with a `Voice` and a key source.
- **`pages.ts`:** which pages, in what order, from the shareable page's own model (C2, D2); and each page's lines and marks, from its shown transcripts, with the flag rules' own matching (plan 7's `flagItemLines` and `flagQuotes`, and `flagQuotedSteps` for the rules whose quotes stand for a place, Ruling R8).
- **`session.ts`:** the check for the person's own NVDA before the first page; each page in turn; the decision question; `addReview` with `regenerateReport: false` and the shown run's id for each decision (C3); one report at the end (D8).
- **`text.ts`:** the words a person sees, but for the usage errors, which sit where they're thrown, and the voices' messages, in `voice.ts`.
- **`src/cli/main.ts`:** `review` gains `--replay`, `--all`, and `--rate <wpm>`. With `--replay`, `--status`, `--note`, and `--run` aren't taken: a page plays from its shown transcripts.
  - It stops with a usage error (exit code 1) before anything starts:
    - without `--replay`: "--page is required, unless --replay is given.", "--status is required, unless --replay is given.", and "--all and --rate go with --replay.";
    - with it: "--replay asks for each decision itself, so it doesn't take --status, --note, or --run.", "--all and --page can't be used together.", a `--rate` that isn't a whole number from 60 to 540, and an input or an output that isn't a terminal.
  - It reads the keys from the start, and a closed window ends them (SIGHUP or SIGTERM, and SIGBREAK on Windows). Every way out closes them, which ends raw mode, and stops watching for a closed window: the last page, Ctrl+C, a closed window, and an error, before the voice starts or after.
  - Its exit codes: 0 when the session ends after its last page, or has nothing to hear; 130 when the person ended it first; 2 when there's no voice, or the voice stops working; 1 for a usage error.
  - Its check for the person's own NVDA counts each running `nvda.exe` in Windows' list of running programs (`listProcesses("nvda.exe")`, which runs `tasklist`), the check a run makes before it starts NVDA, on Windows only (Ruling R12). The list `doctor` reads (`nvdaProcesses`), with each NVDA's path, compiles C# whenever an `nvda.exe` is running, so it's slowest just when the answer matters. A check that hasn't answered within 5 seconds counts as not running.
  - Its tests give it a fake voice and a fake check for NVDA, through `CliContext.replayVoice` and `CliContext.nvdaRunning`, so no test reaches the computer's voice or NVDA.

## Tests

- **The session's pages:** `--page`; the default (What needs attention's pages that NVDA read, in page order); `--all`; a page with no transcripts left out, and said.
- **The player, with a fake voice and fake keys:**
  - each key's effect on the line, the pass, pause, and rate;
  - N, with no flagged line left;
  - the end of a transcript leading to the question.
- **Decisions:** each answer recorded through `addReview` with the run and the reviewer; Skip recording nothing; Ctrl+C keeping what's recorded; the report written once.
- **The voices:**
  - each starts its program with no shell, and the text goes only to standard input;
  - the Windows script's JSON lines;
  - the rate mapping;
  - a voice that fails to start, ending the session before anything is recorded.
- **No terminal:** `--replay` stops with its message.
- **The command:** its checks; the terminal given back on every way out; exit code 130 when Ctrl+C ends it; and the check for NVDA giving up after 5 seconds.
- **The person's own NVDA:** with one running, the message, and the session waiting for Enter; with none, no message; when voicecap can't tell, the session starts; and in every case, no NVDA is stopped or started.
- **At the PC,** with the owner, on a temporary copy of `fixture/i2i-v3-run`, so no real record changes. That's the real i2i v3 run of 6 October 2026, from before the site's logo was fixed, so its home page still has the flagged logo line (i2i's own records have had no flags since that fix). The command is `voicecap review --replay --page / --out <the copy>`. The owner hears the home page, jumps to the flagged logo line, and records a decision. That isn't hands-off: the person is at the keyboard by design, and voicecap starts no NVDA.

## Docs and release

- **The README:** the replay in the review section; the keys; and that it reads the saved words, not NVDA again.
- **The CHANGELOG,** and the timeline row at the release.
- **The release:** 0.14.0. That's the owner's order of 2026-10-07: plan 9, the page for managers, first, as 0.13.0 (released 2026-10-08); then this; then plan 6c, as 0.15.0.

## Not included

- NVDA's own voice, or NVDA reading the live page again (a new read, not a replay).
- A standalone `voicecap replay` command.
- Audio files.
- Replay on Linux.

## Plan 8's corrections, decisions, and rulings

The plan (`docs/superpowers/plans/2026-10-08-review-replay-plan-8.md`) corrected this spec in three places, and made eight decisions, which the owner approved with the plan on 2026-10-08. Rulings made while it was built changed some of what it does. R1 only placed a test helper. Each of the others is written into the sections above, and the code cites it by its name:
- **C1:** the voice's script is given to PowerShell with `-Command`, as a constant in voicecap's code, not run from a `.ps1` file (The voice; Safety).
- **C2:** "the same pages What needs attention counts" is the rule for the default pages (Which pages).
- **C3:** a page plays from its shown transcripts, and each decision is recorded against that run (Which pages).
- **D1:** C1.
- **D2:** C2. Pages with an open issue, and reads that stopped short, are in too.
- **D3:** a decision is one key, 1 to 4; the note ends with Enter.
- **D4:** the speed: `--rate`, its range and steps, the keys that change it, and the Windows voice's scale.
- **D5:** what a mark says, and which lines carry one.
- **D6:** what plays, and how each line is numbered and shown.
- **D7:** keys while paused move without speaking.
- **D8:** how it ends: exit code 130, the report written once, and the count.
- **R2:** Enter alone records no note.
- **R3:** no count when the session stops before the voice starts.
- **R4:** a line always starts, and a key already waiting stops it at once.
- **R5:** a line whose audio fails ends with an error, from `SpeakCompleted`, and the session says why.
- **R6:** Ctrl+C, or the keys ending, ends the session without waiting for the line.
- **R7:** a stopped line gets 5 seconds, then "The computer's voice stopped answering." ends the session.
- **R8:** the place rules mark the place they quote, and the other rules mark every line with the quoted words.
- **R9:** keys left before a page or NVDA's two lines are dropped, and so are the keys pressed in the half second after an answer.
- **R12:** the final review's fixes, made before the merge:
  - the check for the person's own NVDA counts each `nvda.exe` that `tasklist` lists, which compiles nothing, so it answers in time when NVDA runs;
  - the keys pressed in the half second after the Enter that goes on from NVDA's two lines are dropped too, so a second Enter can't end page 1 unheard;
  - while a page plays, ← and → pass over a line where NVDA said nothing, so ← can reach the lines before one, and → moves one line with words.
