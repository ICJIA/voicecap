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
- Otherwise, every page with flags no one has decided on, and every page that reads differently since its review (the same pages "What needs attention" counts), in the latest run's page order.
- `--all`: every page with transcripts, in that order.
- `--site` and `--out` as `review` takes them; `--reviewer` as today (default: `VOICECAP_REVIEWER`, then `git config user.name`).

A page plays from its shown transcripts: the latest run that read it, as the shareable page shows it.

**Each page, in order:**
1. A line names it: `Page 3 of 7: /biographies/ (2 flags)`.
2. The voice reads the read pass (Down Arrow), line by line. Each line is shown as it's read, with its number: `  12  banner landmark, same page, link, current page, Unlabeled graphic, i 2i Logo…`. A line that raised a flag carries a mark after it, in words: `⚑ unlabeled graphic`.
3. When the transcript ends, or the person presses Enter, voicecap asks:

   ```
   What did you decide?  1 Reviewed, no issues   2 Issue found   3 Fixed   4 Skip
   ```

   For 2 and 3 it asks for a note (Enter for none). The answer is recorded at once, through `addReview`: who, when, the run, and the transcripts' fingerprints, sealed and chained as every review entry is. Skip records nothing.
4. On to the next page. After the last, voicecap writes the report again once, and says how many decisions it recorded.

**Keys while a transcript plays:**
- **Space:** pause, and resume. Pausing stops the voice; resuming starts the current line again.
- **←** and **→:** back a line, and ahead a line.
- **N:** the next line that raised a flag.
- **H**, **T**, and **R:** the headings transcript, the Tab transcript, and back to the read transcript, each from its start.
- **+** and **−:** faster and slower, for the rest of the session.
- **Enter:** stop, and decide.
- **Ctrl+C:** end the session. What was recorded stays recorded, and the report is written again.

Keys typed while a line is spoken wait their turn: each acts once the voice has stopped for it.

**The voice:**
- On Windows, its built-in voice (System.Speech), through a small PowerShell script that ships with voicecap.
- On a Mac, `say`.
- Its speed is in words a minute: `--rate <n>`, default 180. On Windows it maps onto the voice's own rate scale.
- There's no NVDA, browser, or network. It reads the saved transcript, so it works at any time, offline, with the person's hands on the keyboard.
- On another platform, or with no voice found, `--replay` stops and says so, before anything is recorded.

**It needs a terminal.** Without one (a script, CI), or with the output redirected, `--replay` stops and says so. `review` without `--replay` is unchanged: `--page` and `--status` are still required.

## Safety

- **No shell:** the words reach the voice on its standard input, never in a command line, so no transcript can run a command. On Windows, voicecap starts `powershell.exe` with `-NoProfile -NonInteractive -File <its own script>`. It sends each line as a line of JSON on standard input (`{ "say": "...", "rate": n }`, `{ "stop": true }`), and the script answers on standard output when a line is spoken. On a Mac, voicecap starts `say -r <rate> -f -` and writes the line to its input. Nothing is started through `cmd /c` or any shell.
- **Nothing new is written,** except the review entries the person chose, through the existing `addReview`.

## How it's built

- **`src/review-replay/voice.ts`:** a `Voice` (`say(text, rate): Promise<void>`, `stop(): void`, `close(): Promise<void>`), with a Windows voice, a Mac voice, and a fake for the tests. The Windows script is `src/review-replay/speak.ps1`, copied into `dist`.
- **`src/review-replay/player.ts`:** a pure state machine (the transcript's lines, the current line, flagged lines, the pass, paused, the rate), driven by keys, plus a loop that drives it with a `Voice` and a key source.
- **`src/review-replay/session.ts`:** which pages, in what order; each page's lines and flags from its shown transcripts, with the flag rules' own matching (plan 7's `flagItemLines` and `flagQuotes`); the decision question; `addReview` with `regenerateReport: false` for each decision; one report at the end.
- **`src/cli/main.ts`:** `review` gains `--replay`, `--all`, and `--rate`. With `--replay`, `--status` and `--note` aren't taken.

## Tests

- **The session's pages:** `--page`; the default (undecided flags, and pages changed since their review, in page order); `--all`; a page with no transcripts left out, and said.
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
- **At the PC,** with the owner: `voicecap review --replay --page /` on the i2i v3 site. The owner hears the home page, jumps to the flagged logo line, and records a decision. That isn't hands-off: the person is at the keyboard by design.

## Docs and release

- **The README:** the replay in the review section; the keys; and that it reads the saved words, not NVDA again.
- **The CHANGELOG,** and the timeline row at the release.
- **The release:** 0.13.0, built right after plan 7 (0.12.0) and before plan 6c, which then ships as 0.14.0. That's the owner's order, 2026-10-06.

## Not included

- NVDA's own voice, or NVDA reading the live page again (a new read, not a replay).
- A standalone `voicecap replay` command.
- Audio files.
- Replay on Linux.
