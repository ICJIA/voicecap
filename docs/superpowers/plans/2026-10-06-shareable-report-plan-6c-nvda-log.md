# NVDA's own log, checked against the transcripts (0.17.0) Implementation Plan

**Goal:**
- Each run keeps a cleaned copy of NVDA's own log for every NVDA session, sealed with the run.
- The page and its Word copy check NVDA's speech against the transcripts, step by step.
- A problem's record shows NVDA's own warnings and errors from that time.

**Architecture:**
- **Turning the log on:** the NVDA driver has Guidepup start NVDA with its log at the input/output level, through Guidepup's own settings (`general.loggingLevel: "IO"`).
- **Keeping a copy:** each time voicecap's NVDA quits, the driver reads `%TEMP%\nvda.log` before anything starts NVDA again, cleans it, and hands it to the run's recorder. The run writes it as `nvda-log/<session>-<n>.txt` and seals it in `run.json`'s `files`.
- **The check:** a pure comparison pairs each step in the transcripts with the speech that follows voicecap's key for it in the log.
- **The page and the Word copy** show the comparison's counts and every line that differs, in either direction. A problem's record gains NVDA's warnings and errors from its time.

**Tech Stack:** TypeScript (strict, ESM), Node 22.19+ or 24, pnpm, Vitest, Playwright Chromium, docx 9.8.1.

**Spec:** docs/superpowers/specs/2026-09-30-shareable-report-design.md. The sections are:
- "New evidence each run records", C;
- "Problems during the runs", the record's NVDA rows;
- "The page, top to bottom", item 9;
- "Facts to confirm at the PC", with what Guidepup's source shows.

This plan amends C with the owner's decision.

**Branch:** `plan-6c-nvda-log`, from `main` at 0.11.0 (c5b4763).

**What the real runs at the PC settled (2026-10-06, plan 6's After execution):**
- **Turning it on:** `nvdaSettings.general.loggingLevel: "IO"`, through Guidepup's settings, turns NVDA's log on at the input/output level.
- **Where it goes:** the log is `%TEMP%\nvda.log`. NVDA moves the last one to `nvda-old.log` at every start, including the computer's own NVDA's restart after a run.
- **No effect on the run:** logging changes neither NVDA's timing nor its speech. All 21 of the demo's passes were word for word the same with it on and off.
- **voicecap's keys are in it:** they appear as `Input: kb(desktop):<gesture>` lines, using seven gestures in all: `downArrow`, `h`, `tab`, `control+home`, and `control+end` for steps, and `NVDA+t` and `escape` for the driver's own checks.
- **Speech appears as `Speaking [...]` entries.** One step's speech can span several entries.
- **What else it holds:** other windows' speech (the window in front before the run, and "Connected as controlled computer"), and the account name in paths.

**The owner's decision (2026-10-06): "A cleaned copy, in Git".**
- **What's kept:**
  - NVDA's speech;
  - the keys voicecap itself pressed;
  - NVDA's warnings and errors.
- **What's dropped or replaced:**
  - any other key, and every typed word, is dropped;
  - the home folder becomes `%USERPROFILE%`.
- **How it's held:** the copy is sealed and checked by `verify` like the event log, and the comparison is rebuilt from it on any computer.
- **What the page lists:** mismatches only inside voicecap's own steps, never speech from before or between pages.

## Global Constraints

- **The cleaned copy is the only copy voicecap keeps.**
  - The raw `nvda.log` is never copied into a run, and never committed.
  - The test fixture made from the real log is the cleaned copy.
- **Each cleaned copy says what it is.** Its first line is voicecap's: `# NVDA's own log of one NVDA session in this run, as voicecap keeps it: NVDA's speech, the keys voicecap pressed, and NVDA's warnings and errors. voicecap left out every other key, every typed word, and what NVDA said after a key voicecap didn't press, and wrote %USERPROFILE% for the home folder.`
- **The page never lists speech outside voicecap's own steps**: not before the first step, not between pages, and not in attempts that were thrown out. It only counts it.
- **Turning the log on uses Guidepup's supported settings, and nothing else:**
  - no command-line flags;
  - no patching Guidepup;
  - a `general.loggingLevel` the config sets itself wins.
- **NVDA specifics stay in the NVDA driver** (the gestures, the log's file, the cleaning). The comparison is general: it takes a map from a step's command to its key.
- **Records stay honest:**
  - nothing sealed is rewritten;
  - runs from 0.11.0 and before keep working, and their places say "Not recorded: this run used voicecap 0.11.0.";
  - `voicecap verify` passes on an older home;
  - `RunSettings` gains nothing.
- **Public API:** what `EventRecorder` and `NewRunEvent` gain is optional, and the CHANGELOG lists it.
- **The first version that keeps NVDA's log is 0.17.0.**
- **Wording:**
  - never describe voicecap as automated testing or an automated checker;
  - never say the person "listened" (keep "listen-through");
  - never write that voicecap doesn't replace screen reader testing;
  - never mention who or what helped write voicecap;
  - never name Guidepup on the page or in the Word copy;
  - strings live in `src/share/text.ts`.
- **Never start a real screen reader, Word, or any desktop program:**
  - never run `voicecap` itself except through the test suite's scripted or replay drivers;
  - never run `setup`, `doctor`, `preflight` (for real), `demo`, `init`, `test:nvda`, or `fixture:capture`;
  - never pass a composed command through `cmd /c` or any shell;
  - never open, raise, or focus a window in a test.
- **Tests:**
  - a test never touches the owner's real transcripts home (pass `env` and `home` explicitly);
  - CI runs on Windows, macOS, and Linux, and Windows-only code sits behind `GuidepupDriverDeps`, with fakes.
- **Quality and commits:**
  - Prettier (printWidth 100), ESLint, and both typechecks are clean, and every task ends with `pnpm lint`, `pnpm typecheck`, and `pnpm test` green;
  - commit each task; messages carry no trailers of any kind; don't push.

## Review Focus

1. **A log that can't be had.** NVDA was killed, `%TEMP%` points elsewhere, or the file is missing, locked, or empty.
   - The run never fails.
   - The event log records `screen-reader-log` with a null file and the reason.
   - The page says the copy wasn't kept. (Task 2.)
2. **Private text in the log.** The cleaned copy drops:
   - keys a person typed, and their `typed word:` entries;
   - INFO and DEBUG lines;
   - the account name in paths.

   The page never lists speech outside voicecap's steps. (Tasks 1 and 4.)
3. **A run with restarts.** Retries, and a restart every n pages, give one copy for each NVDA session, in order. A thrown-out attempt's steps are never paired with a kept step. (Tasks 2 and 3.)
4. **Speech that differs only in form.** One step's speech can span several `Speaking` entries, and empty items can be kept or dropped. The comparison joins and normalizes both sides the same way: on the real demo run, every step agrees. (Task 3.)
5. **The computer's own NVDA restarting at the end.** Its start would move the run's last log to `nvda-old.log`, so the copy is taken before that restart. The fake desktop pins the order, and the PC confirms it. (Task 2.)

---

### Task 1: The cleaned copy of NVDA's log, and a real fixture

**Files:**
- Create: `src/drivers/guidepup/nvda-log.ts`, `test/nvda-log-clean.test.ts`
- Create (fixture): `fixture/nvda-io-run/`, holding:
  - the run of 2026-10-06 08:08 (`C:\Users\cschw\voicecap-check\plan6-io\runs\127.0.0.1_4848\2026-10-06\0808\`): its `run.json`, `events.jsonl`, and each page's `*.txt` and `*.json` transcripts, but not `screenshot.jpg` or `report.html`;
  - `nvda-log/1-1.txt`: `cleanNvdaLog` of `C:\Users\cschw\voicecap-check\plan6-io\nvda-after-run3.log` (the raw log; read it, never commit it), with `home: "C:\\Users\\cschw"`.
- Modify: `fixture/README.md` (what the fixture is, and that it's cleaned)

**Interfaces:**
- Produces, in `src/drivers/guidepup/nvda-log.ts`:
  - `NVDA_LOG_FILE = "nvda.log"`.
  - `VOICECAP_GESTURES: readonly string[]`. These are the gestures the NVDA driver presses, as NVDA logs them after `kb(desktop):` or `kb(laptop):`: `downArrow`, `h`, `tab`, `control+home`, `control+end`, `NVDA+t`, `escape`. A test ties the list to the driver's key map (`src/drivers/guidepup/nvda.ts`'s `commands`).
  - `gestureOf(command: DriverCommand): string | null`. It maps `nextLine` to `downArrow`, `nextHeading` to `h`, `nextFocusable` to `tab`, `toTop` to `control+home`, and `toBottom` to `control+end`; anything else gives null.
  - `cleanNvdaLog(raw: string, options: { home: string; platform: NodeJS.Platform }): string`.
    - It splits the log into entries with `splitLogEntries` (`src/manual/nvda-log.ts`).
    - It keeps only these entries, whole, in order:
      - `IO` entries whose message starts `Speaking `, but only when the last `Input:` entry before them was one of `VOICECAP_GESTURES`, or none came before them (Ruling R3, from Task 1's review: NVDA speaks what a person types, so speech after any other key is dropped with the key);
      - `IO` entries whose message is `Input: kb(desktop|laptop):<g>` with `<g>` in `VOICECAP_GESTURES`;
      - entries at the `WARNING`, `ERROR`, or `CRITICAL` level, with their following lines (a traceback).
    - It drops everything else, including other `Input:` entries, `typed word:` entries, and `INFO`, `DEBUG`, and `DEBUGWARNING` entries.
    - It replaces the home folder with `redactHome` (`src/run/failure.ts`).
    - It puts the Global Constraints' first line (`# NVDA's own log …`) first.
    - Its lines end with `\n`.
- `splitLogEntries` and `parseNvdaLog` skip a line starting `# ` before the first entry. Add that if they don't.

- [ ] **Step 1: Write the failing tests** in `test/nvda-log-clean.test.ts`:
  - **What's kept:**
    - a `Speaking` entry, whole;
    - `Input: kb(desktop):downArrow` and `kb(laptop):NVDA+t`;
    - an `ERROR` entry with a 3-line traceback, whole.
  - **What's dropped:**
    - `Input: kb(desktop):a`, and `Input: kb(desktop):shift+p`;
    - a `typed word: hunter2` entry;
    - `INFO`, `DEBUG`, and `DEBUGWARNING` entries.
  - **The home folder:** `C:\Users\jane\AppData\…` in a traceback becomes `%USERPROFILE%\AppData\…`.
  - **The header:** the first line is exactly the Global Constraints' line, and `splitLogEntries` of the cleaned copy gives exactly the kept entries.
  - **The gestures:** `VOICECAP_GESTURES` is exactly the gestures of the driver's key map. `gestureOf` maps the five step commands.
  - **On the fixture:**
    - `fixture/nvda-io-run/nvda-log/1-1.txt` holds no `cschw`, and no `Input:` gesture outside `VOICECAP_GESTURES`;
    - it still has 392 `Speaking` entries and 267 `Input:` entries, the counts the raw log had (all its keys were voicecap's).
- [ ] **Step 2:** Run `pnpm vitest run test/nvda-log-clean.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Then make the fixture:
  1. Copy the run's files as listed.
  2. Run `cleanNvdaLog` over the raw log with a short script. Leave the script out of the repo.
  3. Check that the fixture's files hold no account name.
- [ ] **Step 4:** Run the file: PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Clean NVDA's own log down to its speech, voicecap's keys, and its warnings and errors`.

### Task 2: Turn the log on, and keep a cleaned copy of each NVDA session

**Files:**
- Modify:
  - `src/drivers/guidepup-nvda.ts`: the setting, reading the log after each quit, and handing it on;
  - `src/drivers/guidepup/windows.ts` or the factory: `readNvdaLog`;
  - `src/drivers/types.ts`: `EventRecorder.screenReaderLog?`;
  - `src/model.ts`: the `screen-reader-log` event;
  - `src/run/events.ts`: write, record, and track the copies;
  - `src/run/audit.ts`: the session number, and hashing at `end()`;
  - `src/verify.ts`: copies the run doesn't list;
  - `test/helpers/fake-desktop.ts`: a log to read.
- Test: `test/guidepup-driver.test.ts`, `test/run-events.test.ts`, `test/verify.test.ts`

**Interfaces:**
- Consumes: Task 1's `cleanNvdaLog` and `NVDA_LOG_FILE`.
- Produces:
  - `EventRecorder` gains `screenReaderLog?(cleaned: string): void`, optional.
  - `NewRunEvent` gains `{ type: "screen-reader-log"; file: string | null; reason: string | null }`. When a copy is kept, `file` is its path from the run folder (`nvda-log/1-2.txt`), and `reason` is null. When none is kept, `file` is null and `reason` says why.
  - `GuidepupDriverDeps.readNvdaLog: () => Promise<string | null>`. The factory reads `path.join(os.tmpdir(), NVDA_LOG_FILE)` and decodes it with `decodeManualInput` (`src/manual/detect.ts`). A missing file gives null.
  - `openEventLog(file, options: { now; logger; session: number })`. Its `screenReaderLog(cleaned)` does three things:
    - writes `nvda-log/<session>-<n>.txt` at once (`writeFileSync`, with `flush: true`), counting `n` from 1 within the session;
    - records `screen-reader-log` with that file;
    - remembers the path.

    A write that fails records `screen-reader-log` with a null file and the reason, and never stops the run.
  - At `end()`, every copy the session kept goes into `run.files` with its `fileHash`, beside `events.jsonl`.
- **The driver:**
  - `startNvda` passes `{ general: { loggingLevel: "IO" } }`, deep-merged under the config's own `nvdaSettings`, so a `general.loggingLevel` the config sets wins.
  - After NVDA has quit in every stop, it reads the log, cleans it, and hands it on. "Every stop" means restarts and the final stop, after `stopNvda` finishes, and before the computer's own NVDA restarts or the next start.
  - When the log can't be had, it records `screen-reader-log` with a null file and the reason (`NVDA's log wasn't there`, or the read error). With no recorder, it reads nothing.

- [ ] **Step 1: Write the failing tests:**
  - **The driver, with `FakeDesktop`:**
    - Start: the settings the fake NVDA was started with include `general.loggingLevel: "IO"`. A config with `general.loggingLevel: "OFF"` keeps its own value.
    - Stop: `readNvdaLog` is called once, after NVDA's stop and before `own-nvda:restart`, in the fake's `events`.
    - The recorder's `screenReaderLog` gets the cleaned text: a raw fake log with a typed word gets that word dropped.
    - A restart, then the final stop, gives two copies, in order.
    - `readNvdaLog` giving null, or rejecting, gives `screen-reader-log` with a null file and the reason, and the stop still finishes.
  - **The run (`run-events.test.ts`, `ScriptedDriver` calling `recorder.screenReaderLog` in its stop):**
    - `nvda-log/1-1.txt` holds the text;
    - the event log has `screen-reader-log` with that file;
    - `run.files["nvda-log/1-1.txt"]` is its `fileHash`, and the seal covers it;
    - a resumed run's second session writes `nvda-log/2-1.txt`.
  - **Verify:** an edited copy reports `…: changed since it was recorded (SHA-256 differs)`, a removed one `…: missing`, and an extra file in `nvda-log/` that `run.files` doesn't list `…: not recorded by the run`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run them: PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Turn NVDA's log on, and keep a cleaned copy of each NVDA session, sealed with the run`.

### Task 3: The comparison

**Files:**
- Create: `src/share/log-check.ts`, `test/share-log-check.test.ts`

**Interfaces:**
- Consumes:
  - Task 1's `gestureOf`, passed in;
  - `splitLogEntries` and `python-repr`'s list parser (`src/manual/`);
  - `StepRecord` (`command`, `spoken`).
- Produces:
  ```ts
  interface LogMismatch { page: string; pass: PassName; step: number; text: string }
  interface LogCheck {
    transcriptLines: number; // the steps in the run's kept transcripts
    logLines: number;        // the steps the log has speech for
    agree: number;           // the steps whose speech is the same in both
    onlyInLog: LogMismatch[];        // the log's speech for a step, where the transcript says otherwise or nothing
    onlyInTranscripts: LogMismatch[]; // the transcript's line, where the log says otherwise or nothing
    outside: number; // speech entries outside voicecap's steps: before the first, between pages, in thrown-out attempts
  }
  checkAgainstLog(input: {
    logs: string[]; // the run's cleaned copies, in order
    steps: { page: string; pass: PassName; steps: StepRecord[] }[]; // the kept attempts' steps, in run order
    thrownOut: { from: string; to: string }[]; // failed attempts' windows (AttemptRecord startedAt..endedAt)
    gestureOf: (command: DriverCommand) => string | null;
  }): LogCheck
  ```
- **The algorithm:**
  1. **Segment the log.** Each kept `Input:` entry starts a segment, and the `Speaking` entries after it, until the next key, are its speech.
  2. **Set aside thrown-out speech.** Entries whose time of day falls inside a thrown-out attempt's window are set aside. Use the windows' local times, and `parseNvdaLog`'s day-crossing rule.
  3. **Pair segments with steps.** Walk the steps in order, and give each step the next segment whose gesture is that step's `gestureOf(command)`. Segments skipped over (`NVDA+t`, `escape`, an unmatched key), and the speech before the first segment, count toward `outside`.
  4. **Compare a pair.** Join the segment's speech the way voicecap's capture joins a step's: an entry's string items with `", "`, and a step's entries with `". "`. Keep empty items, and drop command objects (`LangChangeCommand`, `BreakCommand`, `CancellableSpeech`). Then compare it with `spoken`, after collapsing whitespace on both.
     - Equal: the pair agrees.
     - Not equal: the log's text goes in `onlyInLog`, and the transcript's in `onlyInTranscripts`.
     - A step with no segment left goes in `onlyInTranscripts` only.

  If the real fixture shows a systematic difference that this joining doesn't settle (a symbol's name, an empty item), handle it in the normalization, name it in a comment, and pin it in a test. Never drop a step's text to make it agree.

- [ ] **Step 1: Write the failing tests** in `test/share-log-check.test.ts`:
  - **The real fixture** (`fixture/nvda-io-run/`, its seven pages' three passes, and `nvda-log/1-1.txt`):
    - `agree` equals `transcriptLines` equals `logLines`;
    - both mismatch lists are empty;
    - `outside` counts the speech before the first step and the title checks' speech.
  - **Made-up logs:**
    - a step NVDA said differently goes in both lists, with the page, pass, and step;
    - a step with no speech in the log goes in `onlyInTranscripts` only;
    - speech before the first key isn't listed, only counted;
    - a thrown-out attempt's keys and speech, inside its window, are never paired with the kept attempt's steps;
    - two logs (a restart) are walked in order;
    - a step's speech spanning two `Speaking` entries agrees with its `spoken` text joined by `". "`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run it: PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Check NVDA's own log against the transcripts, step by step`.

### Task 4: The page and the Word copy: the comparison

**Files:**
- Modify:
  - `src/share/load.ts`: read each counted run's `nvda-log/*.txt` listed in `run.files`, kept only when its `fileHash` matches;
  - `src/share/model.ts`: `ShareInput.nvdaLogs`;
  - `src/share/run-evidence.ts`: the `nvdaLog` part;
  - `src/share/text.ts`;
  - `src/share/html/evidence.ts`, `src/share/word/evidence.ts`, `src/share/html/style.ts` (the `.cross` tiles exist);
  - `test/helpers/share-model.ts`: `inputOf`'s default `nvdaLogs`.
- Test: `test/share-html-evidence.test.ts`, `test/share-word-evidence.test.ts`, `test/share-model.test.ts`, `test/share-browser.test.ts`

**Interfaces:**
- Consumes: Task 3's `checkAgainstLog` and `LogCheck`; Task 1's `gestureOf`, through the model's input.
- Produces:
  - `ShareInput.nvdaLogs: Map<string, string[]>`, by run id;
  - `RunEvidence.nvdaLog: LogCheck | { notRecorded: string }`.
- Fixed text in `text.ts`, pinned here; the owner reviews it with the release:
  - **The tiles:**
    - `{n} lines in voicecap's transcripts for this run`;
    - `{n} lines NVDA's own log has for those steps`;
    - `{n} agree`.
  - **The lists' headings:** `Said in NVDA's own log, not in the transcripts`, and `In the transcripts, not in NVDA's own log`. Each item gives its page, pass, and step, and the words.
  - **When they're all the same:** `Every line agrees.`
  - **Outside the steps:** `{n} lines NVDA spoke outside voicecap's steps (while pages loaded, before the run, or in attempts that were thrown out) aren't compared or shown.`
  - **Not recorded, by reason:**
    - an older run's: `notRecordedBy(version)`;
    - a 0.17.0 run with no copy: `Not recorded: this run kept no copy of NVDA's log.`;
    - a run whose screen reader isn't NVDA: `Not recorded: this check is NVDA's only, since VoiceOver keeps no log of what it says.`
  - **A copy that isn't as recorded:** `Not shown: NVDA's log isn't as the run recorded it; voicecap verify names it.`

- [ ] **Step 1: Write the failing tests:**
  - **The model:** a run with the fixture's log gives the `LogCheck`, and each "Not recorded" or "Not shown" reason is right.
  - **The HTML:**
    - the three tiles and the counts;
    - both lists, with `Every line agrees.` when they're empty;
    - the outside line;
    - no speech from outside the steps anywhere on the page: the fixture's "Calculator window" speech doesn't appear.
  - **The Word copy:** the same sentences and lists.
  - **The browser:** axe passes on a page with the check, in both themes, with folds closed and open.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run them: PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Show NVDA's own log against the transcripts on the page and in the Word copy`.

### Task 5: A problem's record: NVDA's warnings and errors

**Files:**
- Modify:
  - `src/share/problems.ts`: the `nvda-log` rows, and dropping the NVDA log's "not recorded" line for runs that kept a copy;
  - `src/share/html/problems.ts`, `src/share/word/problems.ts`: show a multi-line entry, such as a traceback, line by line.
- Test: `test/share-problems.test.ts`

**Interfaces:**
- Consumes: Task 4's `ShareInput.nvdaLogs`.
- Produces: `ProblemRecordRow.source` gains `"nvda-log"`. The rows are NVDA's `WARNING`, `ERROR`, and `CRITICAL` entries in the problem's window, the same window as the event log's rows. Each entry is its message and its traceback's lines, joined with `\n` and redacted again. They're merged with the other rows by time.

- [ ] **Step 1: Write the failing tests:**
  - an `ERROR` entry with a traceback, inside a problem's window, is a row with `source: "nvda-log"`, its time, and its lines;
  - one outside the window isn't;
  - a 0.17.0 run that kept a copy no longer says NVDA's log isn't recorded;
  - an older run still does.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run it: PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Show NVDA's own warnings and errors in a problem's record`.

### Task 6: The README, the CHANGELOG, the timeline, and the handoff note

**Files:** `README.md`, `CHANGELOG.md`, `src/share/text.ts` (the TIMELINE "Next" row), the tests that pin it, `docs/phase-c-handoff.md`, and the spec

- [ ] **Step 1: The README.**
  - **The evidence's parts:** all five are recorded from 0.17.0.
  - **What a run's folder holds:** `nvda-log/<session>-<n>.txt` and what each keeps.
  - **The owner's privacy rule:** what's left out, and that the raw log is never copied.
  - **How to turn it off:** `nvdaSettings.general.loggingLevel: "OFF"` in the config.
- [ ] **Step 2: The CHANGELOG's Unreleased.**
  - **Added:**
    - the cleaned copy and its seal;
    - the comparison on the page and in the Word copy;
    - NVDA's warnings and errors in a problem's record;
    - the API's `EventRecorder.screenReaderLog` and the `screen-reader-log` event.
  - **Changed:** voicecap's NVDA now logs at the input/output level.
- [ ] **Step 3: The TIMELINE's "Next" row.** Its `pc` becomes `A security review of everything voicecap does on a PC.` The release adds 0.17.0's row. Update the tests that pin it.
- [ ] **Step 4: The spec's C,** with the owner's decision and the settled facts. Then the handoff note's "where things stand". Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Describe NVDA's own log, and its check, in the README and the CHANGELOG`.

### At the PC: the controller, with the owner

Real runs need the owner's OK and the warning every time: hands off the keyboard and mouse, Do Not Disturb on, and the screen awake and unlocked. Only the controller does any of this, with the owner.

0. **Merge main into the branch first,** resolve, and run the full suite (`pnpm lint`, `pnpm typecheck`, and `pnpm test`), so the session runs the code that ships.
1. **Prepare.**
   - Build the branch, with `package.json` set to `0.17.0-rc.0` for the session only, then restored.
   - Serve the demo with the built `startDemoServer`.
   - Work in `C:\Users\cschw\voicecap-check\plan6c`, and give every run `--out`.
2. **Start with the computer's own NVDA running,** so its restart at the end is tested. Run the demo's seven pages. Check:
   - `nvda-log/1-1.txt` is voicecap's NVDA's log, not the computer's own (its speech is the demo's);
   - it holds no account name, and no key outside `VOICECAP_GESTURES`;
   - `run.files` lists it, and `verify` is clean;
   - the event log has `screen-reader-log`.
3. **A window brought forward once** (Notepad, by the controller's script, as on 2026-10-06), so a restart gives `nvda-log/1-2.txt`. Check:
   - both copies are kept;
   - the thrown-out attempt's speech isn't paired;
   - the problem's record has NVDA's warnings and errors, if NVDA logged any.
4. **Share in the scratch folder.** The page's check says `Every line agrees.`, or lists real differences to look into. Its Word copy matches.
5. If a check fails, fix it on the branch with a test, and repeat the check.

### The release

1. Merge to `main` once CI is green on the pushed branch.
2. "Prepare 0.17.0":
   - the CHANGELOG heading and its compare link;
   - the TIMELINE's 0.17.0 row (`both`: `<b>0.17.0</b>: NVDA's own log, kept cleaned with each run and checked against the transcripts, line by line.`);
   - the tests that pin the newest row.
3. Run `./publish.sh --dry-run minor` in the foreground. Then check `npm whoami`, and ask the owner for a login if needed.
4. Publish with the owner's 2FA code. Commit "Release v0.17.0", tag it, and push.
5. Once `npm view @icjia/voicecap@0.17 version` prints 0.17.0, wait a minute more. Then set the transcripts repo's `netlify.toml` to `@0.17`, and commit and push.
6. Check the live site against a local build.
7. Record the release in the handoff note.
