# The event log and screenshots (0.11.0) Implementation Plan

**Goal:**
- Each run records its event log (`events.jsonl`) and a screenshot of each page. When the browser loses the screen, the log names the program that took it.
- The page and its Word copy show them.
- On every page voicecap makes, the footer sits at the window's bottom when the page is shorter than the window.

**Architecture:**
- **The event log:**
  - `runAudit` opens `events.jsonl` in the run's folder, and hands a recorder to the driver, the driver session, and the page runner.
  - Each records its events as they happen, one JSON line each, written at once.
  - At each session's end, the log's SHA-256 goes into `run.json`'s new `files`, so the seal covers it and `verify` checks it.
- **The program in front:**
  - When the browser loses the screen, the NVDA driver asks Windows which program's window is in front. A PowerShell helper does it, behind the driver's deps.
  - The driver records the program, with the window's title, in the event log.
  - The failed attempt's record keeps the program's name, never the title.
- **Screenshots:**
  - The browser session takes one through its DevTools connection as each page finishes loading, before the read pass.
  - The page runner writes it as `pages/<slug>/screenshot.jpg`, with a record of its own in the page's record.
- **The page and the Word copy:**
  - The share loader reads each run's event log and each shown page's screenshot.
  - The model builds each session's timeline and event table, the problems' record rows from the event log, and the page cards' pictures.
  - Both renderers draw them.
- **The footer:** each page's body becomes a column at least the window's height on screen. Its main part grows, so the footer ends at the window's bottom.

**Tech Stack:** TypeScript (strict, ESM), Node 22.19+ or 24, pnpm, Vitest, Playwright Chromium, zod 4, docx 9.8.1.

**Spec:** docs/superpowers/specs/2026-09-30-shareable-report-design.md. The sections are:
- "New evidence each run records": A, B, and E's program in front;
- "Problems during the runs": which program, and the record's event-log rows;
- "The page, top to bottom", items 4, 9, and 11;
- "Tests", Stage 2;
- "Facts to confirm at the PC".

This plan also amends the spec:
- "Stages and release": stage 2 in two parts;
- "Rules the page follows": the footer;
- B's true size;
- A's names for the two NVDAs;
- what Guidepup's source shows about NVDA's log.

**Branch:** `plan-6-evidence`, from `main` at 0.10.0.

**The owner's decisions (2026-10-05):**
- **The footer:**
  - It applies to every page voicecap makes: the report page and its shared copies, the run report, the website, and the demo site's pages.
  - The owner chose "Bottom on short pages": on a page shorter than the window, the footer sits at the window's bottom. On a longer page it comes after the content, as now. It isn't pinned while scrolling.
  - It ships with this plan, as its first task.
- **Plan 6:** "just start plan 6".

**What this plan leaves to plan 6c, and why:** plan 6c is evidence C: NVDA's own log, checked against the transcripts, and its warnings and errors in a problem's record. Reading Guidepup 0.34.0's source found three things:
- **No log option.** Guidepup starts NVDA with only `--config-path`. The one supported way to log is NVDA's own setting through Guidepup's settings, `general.loggingLevel`, and its NVDA has that at `OFF`.
- **The log moves on every start.** NVDA writes `%TEMP%\nvda.log`, and moves the last one to `nvda-old.log` whenever NVDA starts, the computer's own NVDA included. So a run's copy has to be taken the moment its NVDA quits.
- **Private text.** At the input/output level, NVDA logs every key and any window's speech, so a copy can hold private text.

Before C, the spec asks four things: the setting's value, where the log goes, whether logging changes NVDA's timing, and whether voicecap's key presses appear. Those need real runs, and comparing the log with the transcripts needs a real log. This plan ends at the PC, where those are settled and a real log is kept. Plan 6c is written from them.

## Global Constraints

- **Event types are general,** as the spec says: "screen reader started", "browser closed".
  - The NVDA details stay in the NVDA driver.
  - The page names the screen reader and the browser as the run's environment records them.
- **Guidepup is never named** on the page or in the Word copy. The screen reader voicecap runs is "voicecap's NVDA", and the one it shuts down is "the computer's own NVDA". The mockup's "Guidepup's NVDA" and "operator's own NVDA" are replaced.
- **No window title reaches the page or the Word copy.** The event log keeps a title; the page and the Word copy show only the program's name.
- **The home folder:** any path shown from an event or an error shows it as `%USERPROFILE%` (or `~`), through `redactHome`, as problems do today.
- **Records stay honest:**
  - the event log is append-only, and nothing sealed is rewritten;
  - runs from 0.10.0 and before keep working. Their places say "Not recorded: this run used voicecap 0.10.0." (`notRecordedBy`);
  - `voicecap verify` passes on an older home;
  - `RunSettings` gains nothing, so an older incomplete run still resumes.
- **Public API:**
  - `ScreenReaderDriver`, `PageInfo`, and `ForegroundError` are exported (`src/index.ts`).
  - What they gain is optional, and the CHANGELOG lists it.
- **The first version that records the event log and screenshots is 0.11.0.**
- **Wording:**
  - never describe voicecap as automated testing or an automated checker;
  - never say the person "listened" (they heard NVDA speaking), and keep "listen-through";
  - never write that voicecap doesn't replace screen reader testing;
  - never mention who or what helped write voicecap;
  - write plain, active sentences in the code's own voice. Strings live in `src/share/text.ts`.
- **Never start a real screen reader, Word, or any desktop program:**
  - Never run `voicecap` itself except through the test suite's scripted or replay drivers.
  - Never run `setup`, `doctor`, `preflight` (for real), `demo`, `init` (except in tests, with its fakes), `test:nvda`, or `fixture:capture`.
  - Never pass a composed command through `cmd /c` or any shell.
  - Never open, raise, or focus a window in a test. The Windows helpers are tested through their parsers and fakes, and for real only at the PC.
- **Tests:**
  - A test never touches the owner's real transcripts home. `test/setup.ts` clears `VOICECAP_TRANSCRIPTS`; still pass `env` and `home` explicitly.
  - CI runs on Windows, macOS, and Linux. Windows-only code sits behind `GuidepupDriverDeps`, with fakes, and its real-Windows tests are `describe.skipIf(process.platform !== "win32")`.
  - Browser layout tests allow for Chromium on Linux rounding a character's width to a whole pixel.
- **Quality and commits:**
  - Prettier (printWidth 100), ESLint, and both typechecks must be clean. Every task ends with `pnpm lint`, `pnpm typecheck`, and `pnpm test` green.
  - Commit each task. Messages carry no trailers of any kind.
  - Don't push: the controller pushes.

## Review Focus

1. **A run cut short.** A closed window or a power cut can leave the event log's last line cut short.
   - A resumed run starts a new line.
   - The reader skips the cut line and says how many it couldn't read.
   - The run's seal and `verify` hold. (Task 2.)
2. **A screenshot that can't be taken.** A page that crashed, a DevTools call that hangs, or a page that isn't HTML never fails the page or the run. The record says why, and the page says "Not recorded" with the reason. (Tasks 5 and 7.)
3. **A program Windows won't name.** An elevated or protected program, a window that closed, or a slow PowerShell gives no name within the lookup's limit.
   - The step is still thrown out.
   - The attempt records `program: null`.
   - The page says Windows didn't say which program it was. (Tasks 4 and 6.)
4. **Private text.** A window title, such as an email's subject or a chat, stays in `events.jsonl`. No page, Word copy, or table shows it. Home-folder paths in event and error text are replaced. (Task 6.)
5. **Files that don't match their records.** A screenshot file that's missing or changed after the run isn't embedded. The page says so, and `verify` names it. (Tasks 5 and 7.)

---

### Task 1: The footer sits at the window's bottom on short pages

**Files:**
- Modify: `src/share/html/style.ts` (`SHARE_CSS`), `src/report/styles.ts` (`REPORT_CSS`), `src/site/style.ts` (`SITE_CSS`), `demo/site/style.css`
- Create: `test/helpers/footer.ts`
- Test: `test/share-browser.test.ts`, `test/report-a11y.test.ts`, `test/site-page-browser.test.ts`, `test/demo-site.test.ts`

**Interfaces:**
- Produces: `footerPlacement(page: Page, footer = "footer"): Promise<{ scrolls: boolean; gapBelow: number }>` in `test/helpers/footer.ts`.
  - `scrolls` says whether the document is taller than the window.
  - `gapBelow` is the distance, in CSS pixels, from the footer's bottom edge to the document's bottom edge.
  - `footer` is a selector. The run report's footer is `".page-footer"`.

- [ ] **Step 1: Write the failing tests.** For each kind of page:
  - **"puts the footer at the window's bottom when the page is shorter than the window":**
    1. Open the page at 1280 × 800, and take `long = await footerPlacement(page)`.
    2. Read the document's height `H` (`document.documentElement.scrollHeight`), and resize to 1280 × (H + 400).
    3. Take `short = await footerPlacement(page)`.
    4. Expect `short.scrolls` to be false, and `Math.abs(short.gapBelow - long.gapBelow)` to be at most 1.
  - **"prints as before":** after `page.emulateMedia({ media: "print" })`, `getComputedStyle(document.body).display` isn't `"flex"`.
  - For the shareable page and the run report, which are long: **"leaves a long page's footer after its content":** at 1280 × 800, `scrolls` is true, and the footer's top is at or below `main`'s bottom.

  The pages:
  - the demo's shareable page (`share-browser.test.ts`'s `demo` file);
  - a run report (`report-a11y.test.ts`'s);
  - the website's page with no reports, and with the demo (`site-page-browser.test.ts`);
  - the demo site's `index.html` and `ask-a-question/sent.html` (`demo-site.test.ts`).
- [ ] **Step 2:** Run `pnpm vitest run test/share-browser.test.ts test/report-a11y.test.ts test/site-page-browser.test.ts test/demo-site.test.ts -t "window's bottom"`. Expected: FAIL, each `short.gapBelow` about 400 more than `long.gapBelow`.
- [ ] **Step 3: Implement**, on screen only (`@media screen`), so print is unchanged.
  - Each page's `body` gets `min-height: 100vh`, then `min-height: 100dvh`. It becomes a flex column whose main part grows (`flex: 1 0 auto`). The page must otherwise look the same.
  - **The shareable page:**
    - The 8 px margin the browser gives `body` today becomes padding (`margin: 0; padding: 8px 24px; box-sizing: border-box`, in place of `padding-inline: 16px`), so nothing moves.
    - `.wrap` grows, with rows `auto 1fr auto` and `width: 100%`.
    - `main` keeps its sections together at the top (`align-content: start`).
  - **The run report:** `.page-header`, `main`, and `.page-footer` keep their measure (`width: 100%`, with their `max-width` and auto margins). `main` grows.
  - **The website:** `main` grows and keeps its measure (`width: 100%`). The bar stays sticky.
  - **The demo site:** `main` grows.

  Each style block says why in a one-line comment. `SHARE_CSS` stays within its budget (`< 40_000`).
- [ ] **Step 4:** Run the four files: PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`. Every axe, reflow (320 px), and print test stays green.
- [ ] **Step 5:** Commit: `Keep each page's footer at the window's bottom when the page is short`.

### Task 2: The event log

**Files:**
- Create: `src/run/events.ts`, `test/run-events.test.ts`
- Modify:
  - `src/model.ts`: `RunEvent`, `NewRunEvent`, `RestartReason`, `RunJson.files`;
  - `src/drivers/types.ts`: `EventRecorder`, `NO_EVENTS`, `ScreenReaderDriver.setEventRecorder?`;
  - `src/run/paths.ts`: `eventLogFile`;
  - `src/run/audit.ts`: open, hand out, record, hash, close;
  - `src/run/driver-session.ts`: `restart(reason: RestartReason, signal?)`;
  - `src/run/page-runner.ts`: `PageContext.events`, and the page's events;
  - `src/verify.ts`: the run's own files;
  - `src/index.ts`: export the new types;
  - `test/helpers/scripted-driver.ts`: keep the recorder it's given, as `recorder`.
- Test: `test/run-events.test.ts`, `test/verify.test.ts`

**Interfaces:**
- Produces, in `src/model.ts` (later tasks and plan 6c rely on these names):
  ```ts
  export type RestartReason =
    | { kind: "every"; pages: number }
    | { kind: "failed-page" }
    | { kind: "retry"; page: string; attempt: number; of: number };
  export type NewRunEvent =
    | { type: "run-started"; session: number; resumed: boolean }
    | { type: "run-ended"; session: number; reason: NonNullable<SessionRecord["endReason"]> }
    | { type: "screen-reader-lock-taken" }
    | { type: "screen-reader-lock-released" }
    | { type: "screen-reader-started"; pid: number | null }
    | { type: "screen-reader-stopped"; pid: number | null; restarting: boolean }
    | { type: "screen-reader-restarting"; reason: RestartReason }
    | { type: "own-screen-reader-closed"; pids: number[] }
    | { type: "own-screen-reader-restarted"; ok: boolean }
    | { type: "browser-launched"; pid: number | null }
    | { type: "browser-closed"; pid: number | null }
    | { type: "browser-handed-over" }
    | { type: "page-started"; page: string; attempt: number }
    | { type: "page-finished"; page: string; attempt: number; status: "done" | "skipped" }
    | { type: "page-failed"; page: string; attempt: number; cause: FailureCause; message: string }
    | { type: "computer-locked" }
    | { type: "foreground-lost"; program: string | null; title: string | null };
  export type RunEvent = NewRunEvent & { at: string };
  ```
  - `page` is the page's address as voicecap read it (`PageRecord.url`).
  - `RunJson` gains `files?: Record<string, FileHash>`: the run's own evidence files, each by its path from the run folder, with `/`. This plan adds `"events.jsonl"`; plan 6c adds `"nvda-log/…"`.
- Produces, in `src/drivers/types.ts`:
  - `interface EventRecorder { record(event: NewRunEvent): void }`;
  - `const NO_EVENTS: EventRecorder`, which records nothing;
  - `ScreenReaderDriver.setEventRecorder?(recorder: EventRecorder): void`. It's optional, so custom drivers needn't record.
- Produces, in `src/run/events.ts`:
  - `EVENT_LOG = "events.jsonl"`.
  - `openEventLog(file: string, options: { now: () => Date; logger: Logger }): EventLog`, where `interface EventLog extends EventRecorder { close(): void }`.
    - `record` appends one line at once (`appendFileSync` with `flush: true`). The line is the event, with `at: isoLocalMs(now())` first.
    - When the file doesn't end with a newline (a line cut short when a window closed), its first line starts on a new line.
    - A write that fails is warned once, as `The event log couldn't be written: <reason>.`, and never stops the run.
    - After `close()`, `record` does nothing.
  - `readEventLog(text: string): { events: RunEvent[]; unreadable: number }`.
    - A non-blank line that isn't a JSON object with a string `at` and a string `type` counts as unreadable.
    - Blank lines are skipped.
    - Types this version doesn't know are kept.
- Produces, in `src/run/paths.ts`: `eventLogFile(siteDir: string, runId: string): string`.

- [ ] **Step 1: Write the failing tests** in `test/run-events.test.ts`, with `run-site.ts`'s helpers and `ScriptedDriver`:
  - **"records a run's events in order":** a completed run of two pages. The event types are exactly:
    1. `run-started`;
    2. `page-started` (home, attempt 1);
    3. `page-finished` (home, 1, done);
    4. `page-started` (about, 1);
    5. `page-finished` (about, 1, done);
    6. `run-ended` (session 1, completed).

    Every `at` matches `ISO_MS`.
  - **"records a retry, and why voicecap restarted":** `sitePages({ about: { openError: lost, openErrorTimes: 1 } })`. Around the retry, the events are:
    1. `page-failed` (about, attempt 1, cause `foreground`);
    2. `screen-reader-restarting` with `{ kind: "retry", page: <about's url>, attempt: 2, of: 5 }`;
    3. `page-started` (about, 2).
  - **"records the restart every n pages":** `config({ restartEvery: 1 })` gives `screen-reader-restarting` with `{ kind: "every", pages: 1 }`.
  - **"seals the event log with the run":** `run.files["events.jsonl"]` equals `fileHash` of the file, and `sealOf(run)` equals `run.seal`.
  - **"keeps a resumed run's events after a line cut short":**
    1. Interrupt a run after its first page.
    2. Append `{"at":"2026` to its log, with no newline.
    3. Resume the run.
    4. `readEventLog` gives `unreadable: 1` and both sessions' events, the second's `run-started` with `resumed: true`.
    5. The completed run verifies.
  - **"never stops a run when its log can't be written":** put a folder where the file would go. The run completes, and the memory logger has the warning once.
  - **"gives the driver the recorder before it starts":** `ScriptedDriver.recorder` is set before its first `start`.
  - **`readEventLog`'s own cases:** a blank line, a line that isn't JSON, an object without `at`, and an unknown type, which is kept.
  - **In `test/verify.test.ts`,** a sealed run whose `events.jsonl` is:
    - edited: `…/events.jsonl: changed since it was recorded (SHA-256 differs)`;
    - removed: `…: missing`;
    - added to a run that didn't record it: `…: not recorded by the run`.
- [ ] **Step 2:** Run `pnpm vitest run test/run-events.test.ts test/verify.test.ts`. Expected: FAIL, since the module doesn't exist.
- [ ] **Step 3: Implement.**
  - **Opening the log:** in `runAudit`, once the run's folder exists (new or resumed) and before `execute` calls `cleanupStale`:
    - open the log;
    - give it to the driver (`setEventRecorder?.()`), to `DriverSession` (a constructor argument), and to `processPage` (`PageContext.events`).
  - **Session start:** record `run-started`, with `resumed` true for every session after the first.
  - **Session end, in `end()`, in this order:**
    1. record `run-ended` with the session's end reason;
    2. `close()` the log;
    3. set `run.files["events.jsonl"]` to the file's `fileHash`;
    4. write `run.json`.

    So a completed run's seal covers the log, and nothing writes to it after.
  - **`DriverSession.restart`** takes a `RestartReason`, and records `screen-reader-restarting` before it stops the driver. Its log line keeps today's words: `every N pages`, `after a failed page`, `retrying <url>: attempt k of n`.
  - **The page runner** records `page-started` as each attempt starts; `page-finished`, with `done` or `skipped`, when the page ends that way; and `page-failed`, with the attempt's cause and message, when an attempt fails.
  - **`verify`'s `checkRun`,** for a sealed run:
    - checks each `run.files` entry as it checks a page's file, for missing and changed;
    - reports an `events.jsonl` in the folder that `run.files` doesn't list as `not recorded by the run`.
- [ ] **Step 4:** Run the two files: PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`. A test that pins a run folder's listing may need `events.jsonl` added; change it only for that.
- [ ] **Step 5:** Commit: `Record each run's events in events.jsonl, sealed with the run`.

### Task 3: The driver's events

**Files:**
- Modify:
  - `src/drivers/guidepup-nvda.ts`: `setEventRecorder`, the events, and `relaunched(notice)`;
  - `src/drivers/guidepup/windows.ts`: `startedNvda`;
  - `src/drivers/guidepup/chrome.ts`: `BrowserSession.pid?`;
  - `test/helpers/fake-desktop.ts`: process ids for the fakes.
- Test: `test/guidepup-driver.test.ts`, `test/windows-helpers.test.ts`

**Interfaces:**
- Consumes: Task 2's `EventRecorder`, `NO_EVENTS`, and `NewRunEvent`.
- Produces:
  - `GuidepupDriverDeps.screenReaderPid: () => Promise<number | null>`. It's the process id of the NVDA voicecap started. The factory's is `startedNvda(await nvdaProcesses(), install.nvdaExe)`, and any failure gives null.
  - `startedNvda(processes: NvdaProcess[], guidepupExe: string): number | null` (windows.ts, pure). It returns the process whose path is Guidepup's executable, compared as `personsNvda` compares paths.
  - `BrowserSession` gains `readonly pid?: number`.
  - `GuidepupNvdaDriver.relaunched(notice: string): void`. It warns as the factory's `onRelaunch` does today, and records `browser-handed-over`. The factory's `onRelaunch` calls it.

- [ ] **Step 1: Write the failing tests** in `test/guidepup-driver.test.ts`, with `FakeDesktop` and a recorder that keeps what it's given:
  - **"records its start, a page, and its stop, in order":** the computer's own NVDA is running. Start, open a page, and stop. The types are exactly:
    1. `screen-reader-lock-taken`;
    2. `own-screen-reader-closed`, with the fake's pids;
    3. `screen-reader-started`, with the fake's pid;
    4. `browser-launched` and `browser-closed`, as the driver launches and closes them;
    5. `screen-reader-stopped`, with `restarting: false`;
    6. `own-screen-reader-restarted`, with `ok: true`;
    7. `screen-reader-lock-released`.

    Pin the order the code gives, after checking it against the spec's list.
  - **"records a restart's stop and start":** `stop({ restarting: true })`, then `start()`, gives:
    1. `screen-reader-stopped` (restarting true);
    2. `screen-reader-lock-released`;
    3. `screen-reader-lock-taken`;
    4. `screen-reader-started`.

    It gives no `own-screen-reader-restarted`.
  - **"records a pid it can't find as null":** `screenReaderPid` rejects.
  - **"records the computer found locked":** with the fake locked during a silent step, `computer-locked` comes before the `locked` error.
  - **"records the computer's own NVDA not coming back":** `restartNvda` rejects, giving `own-screen-reader-restarted` with `ok: false`.
  - **"records a hand-over":** `relaunched("…")` warns, and records `browser-handed-over`.
  - **"records nothing, and works, without a recorder":** as for doctor's live check and fixture capture.
  - **In `test/windows-helpers.test.ts`'s pure block:** `startedNvda` picks Guidepup's copy among the person's, matches paths without regard to case, and returns null when there is none.
- [ ] **Step 2:** Run `pnpm vitest run test/guidepup-driver.test.ts test/windows-helpers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement:** record each event where the driver does the thing.
  - **The lock:** when it's newly taken (in `cleanupStale` or `startUp`), and when `shutDown` releases it.
  - **The computer's own NVDA:**
    - its closing, once `startNvda` succeeds, when `runningNvda()` found it running before;
    - `giveBackOwnNvda`'s outcome.
  - **The start,** with the pid lookup awaited. The driver keeps its NVDA's pid for the stop's event.
  - **The stop.**
  - **Each browser's launch and close,** with `session.pid ?? null`.
  - **`windowsLocked()`.**
  - `abandon()` records nothing new.
- [ ] **Step 4:** Run the two files: PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Record the screen reader's, the browser's, and the lock's events as the driver does them`.

### Task 4: The program that took the screen

**Files:**
- Modify:
  - `src/drivers/guidepup/windows.ts`: `foregroundWindow`, `parseForegroundWindow`;
  - `src/drivers/types.ts`: `ForegroundError`'s program;
  - `src/drivers/guidepup-nvda.ts`: the lookup, the event, and the error's program;
  - `src/util/errors.ts`: `programOf`;
  - `src/passes/index.ts`: `PassFailure.program`, through `failureOf`;
  - `src/model.ts`: `AttemptRecord.program`;
  - `src/run/page-runner.ts`: copy it into the attempt's record;
  - `test/helpers/fake-desktop.ts`: the front window's program and title;
  - `test/helpers/scripted-driver.ts`: a step can throw a `ForegroundError` with a program.
- Test: `test/windows-helpers.test.ts`, `test/guidepup-driver.test.ts`, `test/run-events.test.ts`

**Interfaces:**
- Produces:
  - `interface ForegroundWindow { program: string; title: string }` (windows.ts).
  - `foregroundWindow(ask: (script: string) => Promise<string> = powershell): Promise<ForegroundWindow | null>`.
    - It finds the window in front with user32's `GetForegroundWindow`, `GetWindowThreadProcessId`, and `GetWindowText`, through P/Invoke with `Add-Type`, as the other helpers do.
    - The program's name is its executable's file description (`[System.Diagnostics.FileVersionInfo]::GetVersionInfo(path).FileDescription`, such as `Microsoft Teams`), else its process name.
    - It answers in JSON, within a 10 s limit. Any failure gives null.
  - `parseForegroundWindow(answer: string): ForegroundWindow | null` (pure).
  - `GuidepupDriverDeps.foregroundWindow: () => Promise<ForegroundWindow | null>`.
  - `ForegroundError`'s constructor becomes `(message: string, options?: { program?: string | null })`, with `readonly program?: string | null`.
  - `programOf(error: unknown): string | null | undefined` (util/errors.ts). It gives a `ForegroundError`'s program, and `undefined` for anything else.
  - `PassFailure.program?: string | null`.
  - `AttemptRecord.program?: string | null`. It's present only on a `foreground` attempt from 0.11.0: the program's name, or null when Windows didn't say.

- [ ] **Step 1: Write the failing tests.**
  - **`parseForegroundWindow`, in the pure block:**
    - `{"program":"Microsoft Teams","title":"Chat | Microsoft Teams"}` parses;
    - an empty answer, `null`, an answer that isn't an object, and an empty program give null;
    - a missing title becomes `""`.
  - **The driver, with `FakeDesktop`:**
    - Another window comes forward during a step, and the fake's lookup gives `{ program: "Microsoft Outlook", title: "Inbox - Outlook" }`. The step's `ForegroundError` has `program: "Microsoft Outlook"`, and the recorder has `foreground-lost` with both.
    - A lookup that gives null, and one that rejects, give `program: null`, and the step still fails as `foreground`.
    - `bringToFront`'s `ForegroundError` behaves the same way.
  - **The run, with `ScriptedDriver`:**
    - A step throws `new ForegroundError("…", { program: "Microsoft Teams" })`, and the page's `failedAttempts[0].program` is `"Microsoft Teams"`.
    - A failure of another kind records no `program`.
  - No test opens, raises, or focuses a real window. That check is the PC's.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `foregroundLost()` and `bringToFront()` look up the window before they throw, record `foreground-lost`, and pass the program to the error.
  - `failureOf` keeps `programOf(error)`.
  - The page runner copies the program into the attempt's record, from a pass's failure or from `openPage`'s error.
  - The lookup runs once per loss. Then the step is thrown out, as today.
- [ ] **Step 4:** Run them: PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Name the program that took the screen, in the event log and the failed attempt`.

### Task 5: Screenshots

**Files:**
- Create: `src/util/jpeg.ts`, `test/helpers/jpeg.ts`, `test/run-screenshots.test.ts`, `test/jpeg.test.ts`
- Modify:
  - `src/drivers/types.ts`: `PageScreenshot`, `PageInfo.screenshot?`;
  - `src/drivers/guidepup/chrome.ts`: `BrowserSession.screenshot`, through `ChromeSession`'s DevTools session;
  - `src/drivers/guidepup-nvda.ts`: take the screenshot in `openPage`;
  - `src/model.ts`: `ScreenshotRecord`, `PageRecord.screenshot?`, `SCREENSHOT_FILE`;
  - `src/run/page-runner.ts`: write and record it;
  - `src/verify.ts`: `recordedFiles` adds it;
  - `test/helpers/scripted-driver.ts`: a page's `screenshot` option;
  - `test/helpers/fake-desktop.ts`: `FakeSession.screenshot`.
- Test: `test/chrome-session.test.ts`, `test/run-screenshots.test.ts`, `test/guidepup-driver.test.ts`, `test/verify.test.ts`, `test/jpeg.test.ts`

**Interfaces:**
- Produces:
  - `type PageScreenshot = { jpeg: Uint8Array } | { error: string }`, as `PageInfo.screenshot?`. A driver that doesn't take screenshots leaves it out.
  - `BrowserSession.screenshot(): Promise<Uint8Array>`.
    - It uses DevTools' `Page.captureScreenshot`, as JPEG at quality 60.
    - It captures the window's visible page at half its CSS size: `clip` at the viewport's size, with `scale: 0.5` and `captureBeyondViewport: false`.
    - It never brings the window forward, and has a 5 s limit.
  - `SCREENSHOT_FILE = "screenshot.jpg"`.
  - `type ScreenshotRecord = (FileHash & { takenAt: string; width: number; height: number }) | { error: string; takenAt: string }`, as `PageRecord.screenshot?`. It's absent when the run didn't take one.
  - `jpegSize(bytes: Uint8Array): { width: number; height: number } | null`. It reads a JPEG's frame header, and gives null for anything else.
  - `TINY_JPEG: Uint8Array` (a test helper): a real JPEG, 16 × 12.
- About the size: the spec's 640 × 480 is half the 1280 × 960 window. The visible page is a little shorter than the window, which has its own bar. So a screenshot is 640 wide and a little less than 480 high. The record keeps the true size, and the page uses it.

- [ ] **Step 1: Write the failing tests.**
  - **`chrome-session.test.ts`, in headless Chromium:** "takes a screenshot at half the page's size". `screenshot()` after `load` gives a JPEG (`FF D8`), and its `jpegSize` is half the viewport's CSS size, within 1 px.
  - **`run-screenshots.test.ts`, with `ScriptedDriver` and `TINY_JPEG`:**
    - `pages/home/screenshot.jpg` holds exactly those bytes;
    - the page's `screenshot` has their `fileHash`, `width: 16`, `height: 12`, and `takenAt` (`ISO_MS`);
    - the run verifies.
  - **A screenshot of `{ error: "timed out" }`:** the record is `{ error, takenAt }`, and the page is done.
  - **A skipped page** has no `screenshot`.
  - **A retried page:** the first attempt's screenshot moves to `attempts/<slug>/1/` with its transcripts, and the page's record is the last attempt's.
  - **`verify.test.ts`:** an edited or removed `screenshot.jpg` is named.
  - **`guidepup-driver.test.ts`:**
    - `openPage` returns the fake session's screenshot, taken after the load;
    - a screenshot that throws gives `{ error: <message> }`, and the page still opens.
  - **`jpeg.test.ts`:** `jpegSize(TINY_JPEG)` is 16 × 12. PNG bytes and empty bytes give null.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **The NVDA driver:** `openPage` takes the screenshot once the page has loaded and before it returns, so before any pass. A failure becomes `{ error: <message> }`.
  - **The page runner,** for a page it will read:
    - writes the JPEG to `pages/<slug>/screenshot.jpg` with `writeFileAtomic`;
    - records `{ ...fileHash(bytes), takenAt: isoLocalMs(now()), ...jpegSize(bytes) }`;
    - records `{ error, takenAt }` for an error, or for bytes `jpegSize` can't read;
    - records nothing when the driver gave none.
  - **`verify`:** `recordedFiles` adds `<slug>/screenshot.jpg` for a recorded hash.
- [ ] **Step 4:** Run them: PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Take a screenshot of each page as it loads, before the read pass`.

### Task 6: The page and the Word copy: the event log

**Files:**
- Create: `src/share/timeline.ts`, `src/share/html/timeline.ts`, `test/share-timeline.test.ts`
- Modify:
  - `src/share/load.ts`: read each counted run's `events.jsonl`;
  - `src/share/model.ts`: `ShareInput.events`, and the events' offsets in `offsetsOf`;
  - `src/share/run-evidence.ts`: the timeline, and the restarts row;
  - `src/share/problems.ts`: the record's event rows, and the program;
  - `src/share/text.ts`: `EVENT_TEXT`, `TIMELINE_TEXT`, and the program's words;
  - `src/share/html/evidence.ts` and `src/share/html/problems.ts`;
  - `src/share/html/style.ts`: the `.ev-*` classes, and `.timeline` in print;
  - `src/share/word/evidence.ts` and `src/share/word/problems.ts`;
  - `test/helpers/share-model.ts`: `inputOf`'s default `events`.
- Test: `test/share-timeline.test.ts`, `test/share-problems.test.ts`, `test/share-html-evidence.test.ts`, `test/share-word-evidence.test.ts`, `test/share-document.test.ts`, `test/share-browser.test.ts`

**Interfaces:**
- Consumes: Task 2's `RunEvent` and `readEventLog`, and Task 4's `AttemptRecord.program`.
- Produces:
  - `ShareInput.events: Map<string, { events: RunEvent[]; unreadable: number }>`, by run id. A run without the file isn't in it.
  - `timelinesOf(run: RunJson, log: { events: RunEvent[]; unreadable: number }, words: EventWords): SessionTimeline[]` in `src/share/timeline.ts`, with `EventWords = { screenReader: string; pageName: (url: string) => string; pageNumber: (url: string) => number; redact: (text: string) => string }`. It gives one timeline per session, since a resumed run's sessions can be days apart:
    ```ts
    interface Span { from: string; to: string }
    interface SessionTimeline {
      session: number;
      from: string;
      to: string;
      summary: string[]; // the sentences above the chart: with the table, its text
      lock: Span[];
      screenReader: (Span & { pid: number | null })[];
      own: Span[]; // the computer's own screen reader, off while voicecap ran
      pages: (Span & { n: number; failed: boolean })[];
      rows: { time: string; text: string; kind: "run" | "lock" | "screen-reader" | "own" | "browser" | "page" | "fail" }[];
      unreadable: number;
    }
    ```
  - `RunEvidence.timeline: SessionTimeline[] | { notRecorded: string }`.
  - `eventText(event: RunEvent, words: EventWords): string` (src/share/timeline.ts). It never uses an event's `title`.
  - `ProblemRecordRow.source` gains `"events.jsonl"`, and `Problem` gains `program?: string | null`.
- Fixed text in `text.ts`, pinned here. The owner reviews it with the release. `{sr}` is the run's screen reader, `{name}` the page's name as the page shows it, and `{n}` its number in the run.
  - **The run:**
    - `The run started`, and when resumed, `The run resumed (session {n})`.
    - `The run ended: {reason}`. The reason is one of:
      - `complete`;
      - `stopped by the person running it`;
      - `stopped by a problem on the computer`;
      - `stopped by an unexpected error`.
  - **The lock:** `voicecap took the {sr} lock`, and `voicecap released the {sr} lock`.
  - **voicecap's screen reader:**
    - `voicecap's {sr} started: process {pid}`, or `voicecap's {sr} started` without a pid;
    - `voicecap's {sr} stopped: process {pid}`, with `, to restart` when it's restarting;
    - `voicecap restarted {sr}: {reason}`. The reason is one of:
      - `after every {pages} pages`;
      - `after a failed page`;
      - `to try {name} again (attempt {attempt} of {of})`.
  - **The computer's own screen reader:**
    - `The computer's own {sr} was shut down while voicecap ran: process {pids}`;
    - `The computer's own {sr} was started again`, or `The computer's own {sr} couldn't be started again`.
  - **The browser:**
    - `The browser started: process {pid}`;
    - `The browser closed: process {pid}`;
    - `The browser handed over to a new copy of itself to finish an update`.
  - **The pages:**
    - `Page {n} started: {name}`, with ` (attempt {k})` after the first;
    - `Page {n} read in full: {name}`;
    - `Page {n} skipped: {name}`;
    - `Page {n} failed: {kind}`, with the kind in `PROBLEMS_TEXT`'s words.
  - **The computer:**
    - `The computer was locked`;
    - `Another window came to the front: {program}`, or `Another window came to the front` without one.
  - **An event type this version doesn't know** shows as its type.
  - **The chart's summary,** from the spans. Each sentence appears only where it applies:
    - `voicecap held the {sr} lock from {from} to {to}.`
    - `voicecap's {sr} ran as process {pid}.` With more than one: `… as process {a}, then {b}.`
    - `The computer's own {sr} was shut down at {at} and started again at {at}.`
    - `{count} pages ran in order.` A failed page adds `; page {n} failed at {at}` before the period.
  - **The fold's line:** `Every event, to the millisecond ({count})`.
  - **The table's heads:** `Time` and `Event`.
  - **Below the table,** when any: `{count} lines of the event log couldn't be read.`
  - **In a problem:** `Which program came to the front: {program}.`, or `Windows didn't say which program came to the front.`

- [ ] **Step 1: Write the failing tests.**
  - **`share-timeline.test.ts`, pure, on events written in the test:**
    - one timeline per session;
    - the spans for the lock, each process, the computer's own screen reader, and each page, with a failed page marked;
    - each summary sentence;
    - the rows in time order, with their kinds and texts;
    - an unknown type shown as its type;
    - `unreadable` carried through.
    - **No title anywhere:** a `foreground-lost` with the title `"Re: salary review - Inbox"` appears in no row, sentence, or rendered markup.
  - **`share-problems.test.ts`:**
    - a foreground problem from a 0.11.0 run says its program, or that Windows didn't say;
    - one from an older run still says it's not recorded;
    - the record's event rows are exactly the events from the attempt's start until the next attempt's start, or until 10 s after its end when there's no next attempt, each with `source: "events.jsonl"`;
    - an event's text shows the home folder as `%USERPROFILE%`.
  - **`share-html-evidence.test.ts`:**
    - **The chart:** a run with events has, per session, an `svg.timeline` with `role="img"`, labelled by its summary, inside a named, focusable scroll region.
    - **The table:** its folded `details.log` table has a row for each event, with that row's `ev-<kind>` class.
    - **The facts:** the row "NVDA restarts" counts the `screen-reader-restarting` events, with their reasons.
    - **The demo:** its 0.4.1 runs are unchanged.
  - **`share-word-evidence.test.ts`:** each session's summary, and its table of `Time` and `Event`.
  - **`share-document.test.ts`:** the print test's selector widens to `.scroll, .events`, on a page with a run that has events. Nothing is cut short at 718 px.
  - **`share-browser.test.ts`:** the `rich` page, whose runs now record events, passes axe in both themes, with every fold closed and open, at 1280, 390, and 320 px.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **The loader** reads `events.jsonl` for each run the evidence draws on.
  - **The model** builds the timelines and the restarts row, and adds the events' UTC offsets to `offsetsOf`.
  - **The HTML** draws each session's chart, then each session's folded event table. The chart is ported from the mockup's run 1402 panel (`docs/superpowers/specs/2026-09-30-shareable-report-mockup.html`), with these changes:
    - its lane names: the lock; `voicecap's {sr}`; Pages; and `The computer's own {sr}`;
    - a lane with no spans isn't drawn;
    - minute ticks at a step that keeps them to about 12;
    - no `style=` attribute.
  - **The Word copy** writes each session's sentences and its table.
  - **The print style** drops the chart's `min-width`.
  - **The problems' record** merges the event rows with `run.json`'s, by time.
- [ ] **Step 4:** Run them: PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Show each run's timeline and events on the page and in the Word copy`.

### Task 7: The page and the Word copy: screenshots

**Files:**
- Modify:
  - `src/share/load.ts`: read each shown page's screenshot, checked against its record;
  - `src/share/model.ts`: `ShareInput.screenshots`;
  - `src/share/cards.ts`: the card's picture;
  - `src/share/run-evidence.ts`: the screenshot in the page's fingerprints;
  - `src/share/html/pages.ts`: the recorded size, in place of `SHOT`;
  - `src/share/check.ts`: the check hashes each embedded screenshot;
  - `src/share/word/blocks.ts`: an `image` block;
  - `src/share/docx.ts`: `ImageRun`;
  - `src/share/word/pages.ts`: the picture, in the appendix entry;
  - `src/share/text.ts`: the alt text and the reasons;
  - `test/helpers/docx.ts`: read `word/media/`;
  - `test/helpers/share-model.ts`: `inputOf`'s default `screenshots`.
- Test: the cards' tests, `test/share-document.test.ts`, `test/share-check.test.ts`, `test/share-docx.test.ts`, `test/share-word-pages.test.ts`, `test/share-browser.test.ts`

**Interfaces:**
- Consumes: Task 5's `ScreenshotRecord`, `SCREENSHOT_FILE`, `jpegSize`, and `TINY_JPEG`.
- Produces:
  - `ShareInput.screenshots: Map<string, Uint8Array>`, keyed `<runId>/<slug>`. It holds only files whose bytes match their record.
  - `PageCard.screenshot: { dataUri: string; alt: string; width: number; height: number } | { notRecorded: string }`.
  - `Block` gains `{ kind: "image"; jpeg: Uint8Array; width: number; height: number; alt: string }`.
- Fixed text, pinned here. The owner reviews it with the release.
  - **The alt text:** `The page {name} as it loaded, before {sr} read it`.
  - **Not recorded:**
    - an older run's: `notRecordedBy(version)`;
    - an error's: `Not recorded: the screenshot couldn't be taken ({error}).`;
    - a 0.11.0 run without one: `Not recorded: this run's screen reader driver doesn't take screenshots.`
  - **Not matching:** `Not shown: the file isn't as the run recorded it; voicecap verify names it.`

- [ ] **Step 1: Write the failing tests.**
  - **The model:**
    - a recorded screenshot gives a `data:image/jpeg;base64,` URI of the file's bytes, with the alt text, width, and height;
    - each "Not recorded" reason;
    - "Not shown", for a missing file and for a changed one.
  - **`share-document.test.ts`:**
    - "is one self-contained file" allows `src=` only as a `data:image/jpeg;base64,` image;
    - a page with screenshots grows by each one's base64 at most twice: on its card and in the appendix.
  - **The HTML pages:** an `<img>` has the recorded `width` and `height`.
  - **`share-check.test.ts`, in headless Chromium:**
    - a page as generated checks clean;
    - changing one character of an embedded screenshot's base64 makes the check name that page's screenshot.
  - **`share-docx.test.ts` and `share-word-pages.test.ts`:**
    - each page with a screenshot has one `<w:drawing>`, whose `descr` is the alt text;
    - `word/media/` holds the screenshot's exact bytes;
    - a page without one has the "Not recorded" line;
    - the old "no image yet" assertions change to these.
  - **`share-browser.test.ts`:** the `rich` page, with `TINY_JPEG` screenshots, passes axe as in Task 6, and no request leaves the file.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **The loader** reads `pages/<slug>/screenshot.jpg` for each shown page whose record has a hash, and keeps it only when its `fileHash` matches.
  - **The fingerprint table** lists the screenshot.
  - **The check:** `#fp-data` carries each embedded screenshot's sha256, and the check compares it with its own SHA-256 of the image's bytes.
  - **The Word copy** puts the picture where it says the screenshot today, in the appendix entry.
    - It's 400 px wide, with its height in proportion.
    - It's an `ImageRun` of type `jpg`, whose `altText` `{ name, description, title }` is the alt text.
    - `wordsOf` counts the alt text.
  - **The website's report pages** already allow `img-src data:` (`src/site/headers.ts`), so nothing changes there.
- [ ] **Step 4:** Run them: PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Show each page's screenshot on its card, in the appendix, and in the Word copy`.

### Task 8: The README, the CHANGELOG, the timeline, and the handoff note

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `src/share/text.ts` (the TIMELINE "Next" row), the tests that pin that row (`test/share-text.test.ts`, `test/share-word-evidence.test.ts`), and `docs/phase-c-handoff.md`

- [ ] **Step 1: The README.**
  - **The evidence's parts:** the event log and the screenshots are recorded from 0.11.0. NVDA's own log comes next.
  - **What a run's folder holds:** `events.jsonl`, and `pages/<slug>/screenshot.jpg`. `run.json`'s `files` are sealed, and `verify` checks them.
  - **Privacy:** the event log keeps the title of a window that came to the front, which can hold private text, such as an email's subject. The page and the Word copy never show it, only the program's name.
  - **The footers:** they stay at the window's bottom on short pages.

  All the README's in-page links still resolve.
- [ ] **Step 2: The CHANGELOG's Unreleased.**
  - **Added:**
    - `events.jsonl`;
    - screenshots;
    - the program that took the screen;
    - the page's timeline and event table;
    - the screenshots on the page and in the Word copy;
    - in the API: `ScreenReaderDriver.setEventRecorder`, `PageInfo.screenshot`, `ForegroundError`'s `program`, and the `RunEvent` types.
  - **Changed:** the footers on short pages.
- [ ] **Step 3: The TIMELINE's "Next" row.** Its `pc` becomes `NVDA's own log, checked against the transcripts, recorded at the PC.` The release adds 0.11.0's row. Update the two tests that pin it.
- [ ] **Step 4: The handoff note's "where things stand".** Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Describe the event log and screenshots in the README and the CHANGELOG`.

### At the PC: the controller, with the owner

Real runs check A and B before the release, and settle the facts plan 6c needs.
- They need the owner's OK, and the warning every time: hands off the keyboard and mouse, Do Not Disturb on, and the screen awake and unlocked.
- No subagent does any of this.

1. **Build:** run `pnpm build` on the branch. Work in a scratch folder (`C:\Users\cschw\voicecap-check`), never the transcripts home.
2. **The demo, as shipped:** `node <repo>/dist/cli.js demo`. Check:
   - **`events.jsonl`:** every kind of event the run should give, with real process ids, in order;
   - **each page's `screenshot.jpg`:** its size, and that it shows the page;
   - **the records:** `run.json`'s `files`, and `verify` clean;
   - **a share in the scratch folder:** its page (the timelines, the tables, the screenshots) and its Word copy.
3. **The program in front:** a short run of one page. During it, the owner brings another window forward once on purpose, such as Notepad. Check:
   - the attempt records `foreground` with the program's name;
   - `events.jsonl` keeps the title;
   - the page shows only the name;
   - the next attempt reads the page in full.
4. **For plan 6c:** the demo again, with a scratch config of `nvdaSettings: { general: { loggingLevel: "IO" } }`.
   - Right after it, copy `%TEMP%\nvda-old.log`, where the computer's own NVDA's restart moved the run's last log.
   - Note whether it holds input/output entries (`Speaking`, `Input:`).
   - Note whether voicecap's key presses appear as `Input:` entries.
   - Note whether its transcripts match step 2's, for timing.
   - Keep the copy, with the home folder replaced, as plan 6c's fixture, once the owner has looked it over for anything private.
5. **Optional, from 0.6.0's list:** close voicecap's Chrome mid-page, and check that the attempt records `browser`.
6. **If a check fails,** fix it on the branch with a test, and repeat the check.

### The release

1. Merge to `main` once CI is green on the pushed branch.
2. "Prepare 0.11.0":
   - the CHANGELOG's heading;
   - the TIMELINE's 0.11.0 row: `both`: `<b>0.11.0</b>: each run's event log, with the program that took the screen, and a screenshot of each page, on the page and in its Word copy; and footers that stay at the window's bottom.`;
   - the tests that pin the newest row.
3. Let CI pass, then run `./publish.sh --dry-run minor` in the foreground.
4. Publish 0.11.0 with the owner's 2FA code. Commit "Release v0.11.0", tag it, and push.
5. Update the website's build:
   - wait until `npm view @icjia/voicecap@0.11 version` prints 0.11.0, then a minute more;
   - then set the transcripts repo's `netlify.toml` to `@0.11`, and commit and push.
6. Check the live site, the 23 demo addresses and the front page, against a local build.
7. Record the release in the handoff note, then write plan 6c from the PC's step 4.

## After execution

**How it was built (2026-10-05):**
- Subagent-driven, as the owner chose ("Yes build and do subagent"). One implementer per task (Task 6 on opus, the rest on sonnet), each task reviewed (Tasks 6 and 7 on opus), with scoped re-reviews of each fix round.
- Fix rounds: Task 2 had one (a test that read the year 2026), Task 6 had one (a problem blamed the version for a log the page couldn't show), and Task 4 had a fix before its review (R5).
- The owner's computer crashed during Task 8. Its implementer resumed from its saved transcript and finished; nothing was lost.
- A final whole-branch review (opus) found 0 Critical, 3 Important, and 7 Minor. One fix wave (opus, 13 commits) followed, then a scoped re-review: all twelve items addressed, nothing new beyond three minor notes.
- Commits: the plan, 1f75b06; Tasks 1–8, a1ab279..bbad1ee; the fix wave, 34aab36..0adc076. 4,652 tests pass, and 2 skip on Windows.

**Rulings** (what, why, and what it costs if wrong; there is no R7):
- **R1:** work in place on this branch, as plans 5 and 5b did. *If wrong:* none.
- **R2, R2a:** implementers on sonnet, Task 6 on opus; reviews on sonnet, Tasks 6 and 7 on opus. *If wrong:* cost.
- **R3:** a retry's "attempt k of n" counts across sessions, as `AttemptRecord.n` does. *If wrong:* a resumed retry says "of 7" where "of 5" was meant.
- **R4:** `verify` refuses a `run.files` path that leaves the run's folder. *If wrong:* such a run reads as unreadable.
- **R5:** the window lookup returns the window's process. When it's voicecap's own browser (the other window already gone), the program counts as unknown, never "Google Chrome". *If wrong:* that loss reads as not named, which is true.
- **R6:** the capture's scale is half the page's CSS size, whatever the display's scaling (later from the browser's layout metrics, M5). *If wrong:* smaller files.
- **R8:** tests get 90 s on Windows CI only. *Why:* the runners pause (main's CI failed once that way on 2026-10-05). *If wrong:* a real hang there shows after 90 s, not 30.
- **R9:** a page with no screenshot says the driver takes none only when no page of that run has one; otherwise `Not recorded: no screenshot was taken, since the page wasn't read.`
- **R10:** `voicecap couldn't tell which program came to the front.` replaces "Windows didn't say…", true when Windows answered with voicecap's own browser too.
- **R11:** `EventRecorder.record` takes an optional moment. The driver stamps NVDA's start when it finished, before the process lookup, and the computer's own NVDA's shutdown when the start began. *If wrong:* an optional parameter on an exported type.
- **R12:** the run's own files (`events.jsonl`) get rows in the fingerprint table, under `The run`.
- **R13:** the problems' verdict line names each program that came to the front, and how often. Older runs keep today's line.
- **R14:** a session the event log doesn't cover says so (`Session {n}: not recorded: …`), and the restarts fact says which sessions it counts.

**What the final review changed:**
- **I1:** R12.
- **I2:** R13.
- **I3:** R14.
- **M1:** the chart works out its tick count before making ticks, so a session of years (a clock jump) marks 12.
- **M2:** a screenshot record of no known shape never stops a share.
- **M3:** more strings moved into text.ts.
- **M4:** R11.
- **M5:** the pixel ratio comes from the browser's layout metrics, never the page's script, and is kept between 0.5 and 4.
- **M6:** R10.
- **M7:** a README line.
- **C1:** R8.
- **C2:** a test that printing puts every screenshot on paper, those in folds too.

**Carried, for later:**
- **The run side:**
  - `hashOfEventLog` swallows a read error with no warning;
  - `verifyHome`'s doc;
  - `audit.ts`'s size;
  - tests for resuming a 0.10.0 run, for `page-started`'s time against `AttemptRecord.startedAt`, and for `verify` on an incomplete run with `files`.
- **The driver:**
  - a process lookup slower than a stop's wait can log after the stop;
  - no `checkLive` after the lock check or the window lookup;
  - the lookups run with no recorder (doctor's live check, fixture capture);
  - the recorder's "never throws" contract is documented only on `openEventLog`;
  - the factory's `onRelaunch` wiring is untested;
  - `own-screen-reader-closed`'s pids are every nvda.exe;
  - the window script has no automated syntax guard;
  - the repeated P/Invoke block;
  - the file sizes.
- **Screenshots:**
  - nothing pins the capture after the page is ready;
  - only the first load's capture is kept;
  - three captures per page;
  - another race-a-timer helper.
- **The page:**
  - a mixed-version run's evidence and problems name versions by different scopes;
  - the chart's word-fit isn't measured;
  - "NVDA stopped running" under other screen readers (Phase C);
  - `cards.ts`'s size, and its base64 decoder imported by the Word side;
  - `sizeOf`'s stale doc;
  - `records.ts` repeats `verify`'s `isFileHash`;
  - tick labels read 00:00 at a step of a day or more;
  - older sentences built outside text.ts in problems.ts;
  - duplicated test helpers.
- **Docs:**
  - the handoff note's top status still reads as if Phase C starts now;
  - two README lead-ins;
  - the long API paragraph.

**At the PC, added to the checklist by the reviews:**
- R5's assumption, that voicecap's Chrome window belongs to the process it launched;
- whether an endpoint tool blocks the window lookup's hidden script (every loss would read as unknown);
- what Microsoft Teams, Outlook, and a Store app are called;
- screenshots on real headed runs: none timed out because the window was behind others, and about 640 wide at 110%;
- the capture's cost per page.
- **The version:** a branch build records "voicecap 0.10.0", so missing pieces get the older wording. Build with a local prerelease version, not committed, or expect it.

**For the owner's release review:**
- the new fixed text, including the event phrases, the timeline's sentences, the gap sentences, R9's, R10's, R12's, R13's, and R14's;
- the computer's own NVDA lane's drawing against the mockup;
- the Word copy's thumbnail for a page that was never transcribed (about 117 px);
- a large site's page size, two copies of each picture (about 21 MB for 400 pages);
- "Check the fingerprints" described as covering transcripts only, in `EVIDENCE_TEXT.proves` and the Word copy;
- a session line without a heading.

**At "Prepare 0.11.0":** name `SCREENSHOT_FILE` in the CHANGELOG's API line, and fix the CHANGELOG's compare links (`[Unreleased]` compares from v0.7.0, and 0.8.0 to 0.10.0 have none).

**At the PC (2026-10-06, with the owner's "go"):**
- **The setup:**
  - runs from a fresh build, with `package.json` set to `0.11.0-rc.0` for the session only (voicecap reads its version at run time), then restored;
  - the demo site served from the built `startDemoServer`;
  - every run with `--out` in a scratch folder.
- **Run 1, the demo as shipped:**
  - All seven pages were read in full.
  - `events.jsonl` held 62 events in order: the lock, NVDA started (a real process id), three browsers a page, each page started and finished, NVDA stopped, the lock released, and the run's end.
  - Screenshots were 16–22 KB each, 633 × 433 at 110% display scaling (625 wide with a scrollbar). Each showed its page fully drawn before NVDA read it.
  - `run.files` was sealed, the canonical address came from the pages' tags, and `verify` found everything matching.
- **Run 2, the program in front** (the owner was away and asked the controller to bring the windows forward; a script did it without a key press):
  - Notepad was caught in about 2.7 s. It was recorded as `foreground` on the tab pass, step 4, with a restart, then read in full on attempt 2.
  - The Calculator was caught in about 2.8 s, the same way.
  - Both runs' event logs kept the titles, and the page showed only the programs.
  - **Found:** a Store app was named "Application Frame Host", and the packaged Notepad "Notepad.exe". Fixed in c0f35b2: a Store app is named by its hosted program, and a bare file name loses ".exe". It's reviewed, and a Windows-only test compiles and parses the script without reading a window. **Rechecked** with real windows: "Calculator" and "Notepad".
- **Run 3, NVDA's own log at the input/output level, for plan 6c:**
  - `nvdaSettings.general.loggingLevel: "IO"`, set through Guidepup's settings, works. The log is `%TEMP%\nvda.log`, moved to `nvda-old.log` at every NVDA start: 114 KB and 1,651 lines for the seven pages, with 392 `Speaking` and 267 `Input` entries.
  - All 21 of the demo's passes were word for word the same as run 1's, and each page took the same time to within a second. Logging changes neither NVDA's timing nor its speech.
  - voicecap's own keys appear as `Input: kb(desktop):…` lines: down arrow, Tab, NVDA+T, H, Ctrl+Home, Escape, and Ctrl+End.
  - The log also caught the window that was in front before the run ("Calculator window, Display is 0") and NVDA's own messages ("Connected as controlled computer"), and its setup lines carry the account name in paths.
  - A copy is kept for plan 6c's fixture, once the owner has looked it over.
- **Across four of the runs,** every page and pass read the same words, including the pages retried after a window took the screen.
- **Not checked:** a Chrome window closed mid-page (optional, from 0.6.0's list).

**Released as 0.11.0 on 2026-10-06:**
- the merge was 9d43499, "Prepare 0.11.0" cb3d939, and "Release v0.11.0" 3bf9d0c, tagged `v0.11.0`;
- the handoff note is b3b6013;
- the website builds with `@0.11` (transcripts 375f8bb), set only after npm served 0.11.0, and the live site matched a local build on all 29 addresses.

The Store-app fix's own review left four small notes, carried for later:
- the parse-only test checks stdout only; it should assert stderr is empty;
- five comment lines run 101 columns;
- one assertion pair is repeated, and one script capture is duplicated, in `windows-helpers.test.ts`;
- the window script's branches are guarded by text, parse, and compile tests, with the real check at the PC.
