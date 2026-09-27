# Phase B handoff: picking up on Windows

## Status: Phase B done (2026-09-27)

Phase B was built on Windows 11 (Git Bash, non-admin) and checked end to end with real NVDA 2026.2 (Guidepup build 0.2.1-2026.2) and Chrome 153. The rest of this file is the original handoff, kept for its background.

**What was built** (details in `CHANGELOG.md` and `README.md`):
- The Guidepup NVDA driver: `src/drivers/guidepup-nvda.ts` (the driver's logic, tested with a fake desktop in `test/guidepup-driver.test.ts`) and `src/drivers/guidepup/` (Guidepup adapter, browser, Windows helpers, `setup`, `doctor`).
- `pnpm test:nvda` / `pnpm fixture:capture` (`scripts/capture-fixture.ts`), which run the four Phase B checks against live NVDA, plus a check that Tab goes into and out of frames, including one from another site (`fixture/site/frames/`, outside the sitemap). `fixture/replay-run` is now a real run.

**Facts that turned out differently from the notes below:**
- *Focus.* A browser launched by Playwright emulates focus (`document.hasFocus()` is always true), so the driver launches Chrome itself and attaches with `connectOverCDP({ noDefaults: true })`. Even then, Chrome reports focus for a window that has never really been in front, so every page load confirms the window with NVDA+T against a unique marker title. After that, the page's blur events show any loss of focus.
- *navigateToWebContent.* Alt+Esc window cycling was dropped (it brought other windows forward and NVDA read them). The NVDA+Space toggles were dropped too: entering focus mode focuses the element under NVDA's cursor. Instead the driver raises its window (minimize and restore, no keystrokes) before the first NVDA command of each load. A window in front that keeps changing (a terminal with a spinner) keeps NVDA talking, and Guidepup waits for silence before every captured command, so NVDA+T would never return.
- *The tab pass.* With nothing focused, NVDA's browse mode handles Tab itself and moves to the first focusable element after its cursor (the skip link, after Ctrl+Home), skipping it. So the first Tab goes to Chrome directly (`page.keyboard.press`, captured with Guidepup's `capture()`), and later Tabs go through NVDA.
- *Leaving the page* focuses Chrome's toolbar ("Tab search, button"), not the address bar.
- *Symbols.* Guidepup's capture has NVDA's spoken symbol names ("copyright", "bullet"); Speech Viewer shows the characters.
- *Signals.* Playwright's own SIGINT handler exits the process (code 130), so it's turned off too, not just Guidepup's.
- *Guidepup 0.34.0* spawns nvda.exe unquoted through the shell (paths with a space or one of `& ( , ; = ^`, or a `%NAME%` that expands, fail, as measured with Node 24; `voicecap setup` and `doctor` explain the fix) and triggers Node 24's DEP0190 warning (hidden). `getSettings()` reads Guidepup's `nvda.ini`, which holds only non-default values.
- *@guidepup/setup 0.28.0* needs Node 22.19 (undici 8) and pulls in ffmpeg-static through an optional dependency (macOS recording only).
- *Frames.* Focus moving into an iframe blurs the page's window while `document.hasFocus()` stays true, so only a blur that leaves the page without focus counts as a loss (found in the Phase B code review).
- *NVDA dying.* Guidepup's commands then come back with no speech (once it gives up reconnecting, at once, without sending their key), and its unawaited stop-speech key press rejects with nothing to handle it, which would end the process. voicecap marks those key presses as handled (it patches `NVDAClient.prototype.sendKeyCode`; Guidepup has no exports map), fails a captured command that comes back in under 200 ms (Guidepup always takes at least 250), and, on a silent step, checks NVDA's port (as Guidepup's own `isRunning` does).
- *Locked Windows.* On a locked computer, the keys NVDA injects are blocked: Guidepup's commands take their usual time and hear nothing, and NVDA doesn't even act on the stop-speech key. Locking also takes the page's focus, so a step then looks like another window came forward. voicecap asks Windows (WTSQuerySessionInformation) when a captured step is silent or the page lost focus, and holds a SetThreadExecutionState request (system and display required) while it runs, so Windows doesn't sleep or turn the screen off. A first real run failed on every page because the owner had locked the computer before stepping away.
- *Stopping.* Guidepup sends a captured command's key only once NVDA has fallen silent, and its stop waits for the command. So voicecap shuts NVDA down before it closes the page's browser (directly, when a command is under way): closing the page first ends the silence wait, and the key goes to the window that comes forward. A killed Chrome reports a signal, not an exit code, on Windows too.

**Still open:**
- The Phase A review's smaller items, listed below under "Follow-ups from the Phase A code review".
- The NVDA lock is per Windows user (`%LOCALAPPDATA%`), while NVDA's port is shared by the computer. A machine-wide lock was considered in the Phase B review and declined; the README lists it as a limitation.
- An upstream Guidepup issue about the unquoted shell spawn (spaces and `& ( , ; = ^` in the path), for the owner to file.
- Guidepup's reconnect also writes to NVDA from an async `secureConnect` listener that nothing waits for. If the connection dies in the instant after it's made, that rejection is still unhandled; only the stop-speech key presses are covered.
- A page that fails with a foreground error (someone used the computer) is recorded as failed without an immediate retry. The core retries timeouts once; retrying foreground errors the same way is a small change in `src/run/page-runner.ts`.
- Publishing 0.2.0 (section 2 below).

Phase A was finished on macOS on 2026-09-26, merged to `main`, and tagged `v0.1.0` at https://github.com/cschweda/voicecap. This file is everything a new Claude Code chat on a new Windows machine needs to pick up Phase B. The chat has none of the earlier conversation, so everything it needs is here.

## 1. Setting up the machine and starting the chat

Follow [`WINDOWS-SETUP.md`](../WINDOWS-SETUP.md) at the repository root. It covers:
- which window to use (PowerShell only to install Git and Node, Git Bash for everything else);
- each setup step;
- the prompt to paste into a new Claude Code chat.

## 2. State at handoff

- **Phase A is complete.** 351 tests in 30 files pass. `pnpm lint`, `pnpm typecheck`, and `pnpm build` are clean, the built CLI passes a smoke test against the fixture, and the packed tarball installs and runs.
- **CI** (`.github/workflows/ci.yml`) runs lint, type checks, tests, a build, and a CLI smoke test on Ubuntu, macOS, and Windows with Node 22 and 24, and all six jobs passed. On Windows it also checks under Git Bash that `--page /about` is caught as a rewritten path. If the latest run on `main` shows a failure, fix that first.
- **Publishing: wait until Phase B is done** (decided 2026-09-26). Nothing is on npm, and 0.1.0 won't be published, because its default NVDA driver doesn't exist yet. Publish Phase B as 0.2.0:
  1. Add a `## [0.2.0]` entry to `CHANGELOG.md`.
  2. Run `./publish.sh --dry-run minor`, then `./publish.sh minor`.

  A bare `./publish.sh` would try to publish 0.1.0; its tag is on an older commit, so the script would stop.
- **Pinned for Phase B**, current on npm on 2026-09-26: `@guidepup/guidepup` 0.34.0, `@guidepup/setup` 0.28.0, `@guidepup/playwright` 0.19.1 (only its `navigateToWebContent` code is ported, not the package). Phase A doesn't install Guidepup yet. `playwright` is a devDependency today (used by the report's axe test) and should become a dependency in Phase B.
- **Stubs waiting for Phase B:**
  - `createDriver` in `src/drivers/index.ts` throws "built in Phase B" for `guidepup` on Windows.
  - `voicecap setup` and `voicecap doctor` in `src/cli/main.ts` print "isn't available yet".
- **Toolchain choice:** TypeScript is pinned to 6.0.x because typescript-eslint (8.70) doesn't support TypeScript 7 yet.

### Decisions already made (from docs/plan.md, all accepted)

- **End-of-page matching** (Q1). The repeat must match the end of the Ctrl+End speech at an item boundary, and one confirmation Down Arrow is required (`read.endConfirmations: 1`; 0 restores the plain rule).
- **Sitemap runs** (Q2) are identified by URL only for resuming, and a resumed run uses the page list stored at its start. Page list files are identified by their content hash.
- **The resume settings hash** (Q3) also covers the NVDA settings overrides and the browser.
- **Failures** (Q4). The driver restarts after any failed page, and after 5 failures in a row the run stops with exit code 2, resumable.
- **License** (Q5): MIT, © 2026 Christopher Schweda.

### Facts learned in Phase A that Phase B needs

- **Signals.** Guidepup 0.34.0's own SIGINT/SIGTERM/SIGQUIT/SIGHUP/`beforeExit` handlers (`lib/teardown.js`) stop NVDA but **never exit the process**. voicecap's core already handles the signals (`src/run/signals.ts`), saves state, and calls `driver.stop()` once. After `nvda.start()`, the driver should detach Guidepup's listeners (compare `process.listeners(...)` before and after) so NVDA is stopped exactly once, by voicecap.
- **Speech format.**
  - Guidepup joins the text items of one utterance with `", "` (each trimmed, whitespace runs collapsed) and utterances with `". "` (`lib/windows/NVDA/NVDAClient.js`).
  - `capture: true` waits for 1 s of silence, and the stop-speech debounce is 250 ms.
  - The driver must return this format; see `Speech` in `src/drivers/types.ts`.
- **Containers on arrival.** Confirmed in NVDA's `speech.py`: when moving to a line, NVDA announces the containers it enters ("content info landmark"); when re-speaking the line it's on, it doesn't. So the end of a page shows the arrival, then the repeats. The read-pass logic in `src/passes/read.ts` handles this. Verify it against real output.
- **NVDA phrasing** (from NVDA's source, in `fixture/README.md`):
  - lists are announced as two items, "list" and "with N items";
  - links to the current page say "same page";
  - an image with no alt that isn't a link isn't read at all;
  - whitespace-only items can appear (e.g. `edit, `).
- **Unverified until Phase B:**
  - what Chrome focuses when Tab leaves the page (assumed the address bar, detected with `document.hasFocus()`);
  - which landmarks NVDA announces when a field takes focus;
  - where NVDA wraps long lines.
- **Visited links.** "visited" makes transcripts depend on the order pages were visited, so use a fresh browser context (or profile) per page.
- **VBScript helpers to avoid:** `lib/windows/activate.js`, `quit.js`, and `sendKeys.js` (used by `type()`, `windowsActivate`, `windowsQuit`).
- **navigateToWebContent** to port, with attribution, is in `@guidepup/playwright` 0.19.1 `lib/nvdaTest.js` (around line 64). Leave out the body click and Tab.
- **Focused element.** For the role and accessible name of the focused element, Chrome's DevTools protocol (`Accessibility.getPartialAXTree` through a Playwright CDP session) is more reliable than DOM attributes. `inMain` is `activeElement.closest('main, [role=main]')`. Record `href` for links (the skip-link flag uses it).
- **AT Driver.** The NVDA AT Driver implementation now lives at https://github.com/Prime-Access-Consulting/nvda-at-automation (not `w3c/nvda-at-automation`). The spec's key command is `interaction.userIntent` with `name: "pressKeys"`. The stub's comments in `src/drivers/at-driver-nvda.ts` reflect this.
- **Still Phase B work:**
  - a machine-wide lock (only one NVDA);
  - cleaning up NVDA and Chrome processes left by a crash (`driver.cleanupStale()`);
  - the warning printed before NVDA starts, because it shuts down any running NVDA.

### Follow-ups from the Phase A code review

An independent review of Phase A found two critical and four important issues, all fixed and tested before `v0.1.0`:
- HTTP errors no longer count toward the consecutive-failure stop, and resumed runs make progress.
- Redaction now tracks focus across the whole log when `--from`/`--to` is used.
- Runs with no pages are refused.
- Overnight gaps in logs count as midnight crossings.
- A config can import `@icjia/voicecap` under npx.
- The tab pass's safety net now compares the focused element.

Still open (smaller, deliberately left for later):
- **Concurrent reviews.** `reviews.json` has no protection against two `review` commands at once: the last writer wins, so an entry can be lost. Add a short lock, or re-read just before the rename.
- **Large runs.** At 2,000 pages, regenerating the live report after each `review` rewrites every compare diff, and after a flag-rule change it re-reads every transcript. Cache both, outside the sealed run folder.
- **Ctrl+C during the sitemap fetch** isn't honored (it only takes seconds). Pass the signal into `fetch`.
- **Stop rules exist twice.** `scripts/build-replay-fixture.ts` has its own copy of them; keep it in sync with `src/passes/`, or import from there.
- **Same-name buttons.** In the tab pass, distinct buttons with the same name and no link target still look like repeats to the safety net.
- **Worth deciding:**
  - stop-rule settings (`repeatLimit`, `read.endConfirmations`) aren't in the resume hash (compare does note config differences);
  - two listed URLs that redirect to the same page are transcribed twice;
  - `--site http://` for an https-only site skips every page when it loads, instead of warning up front.

### Where things are

- **Spec and plan:** `docs/build-prompt.md`, `docs/plan.md`; a requirement → test map is in section 16 of the plan.
- **Driver interface:** `src/drivers/types.ts`. Replay driver: `src/drivers/replay.ts`. Driver selection: `src/drivers/index.ts`.
- **Core:** stop logic is in `src/passes/`; the run engine (resume, timeouts, retries, restarts, signals) is in `src/run/`.
- **Fixture:**
  - The site is in `fixture/site/`, served by `pnpm fixture:serve` at http://127.0.0.1:4747.
  - The replay source is in `fixture/replay-src/`; `pnpm fixture:replay` regenerates `fixture/replay-run/` and `fixture/reviews.json`. The generator checks each recording against the core's stop rules.
  - `fixture/README.md` has the NVDA phrasing sources and their uncertainties.
- **Try it on Windows today, without NVDA:**
  ```bash
  pnpm build
  node dist/cli.js --site http://127.0.0.1:4747 --pages fixture/pages.json --replay-from fixture/replay-run
  ```
