# Phase C handoff: VoiceOver on the Mac

## Status: readiness built, not yet released (2026-09-28, after 0.3.1; spike findings below)

Readiness (sub-project 1): designed (`docs/superpowers/specs/2026-09-28-readiness-design.md`) and built. The spike is done. The VoiceOver driver (sub-project 2) comes next.

**Before any release:** the spec's Release row says the Mac half ships with the VoiceOver driver, because a ready Mac can't run anything until the driver exists. So a release before sub-project 2 must first gate the Mac half, so that Macs keep today's behavior. The Windows half can ship as it is, when the owner says.

Still to check by hand:

- **On the Windows PC:**
  - `nvdaProcesses` with a non-ASCII character in the Guidepup folder path;
  - whether Windows reports the installed NVDA's `ExecutablePath` (the null-path case);
  - `windowsComputerModel` and `windowsBrowserVersion` on real hardware;
  - after a run, that the person's installed NVDA restarts through `Start-Process`, including one that uses UIAccess;
  - how long the quick checks take, against the README's "about two seconds";
  - closing the terminal window during `init`'s live test.
- **On this Mac, with the owner's OK:** a supervised real run.
  - `setup`, then `doctor`, then `init`, once with VoiceOver on beforehand and once with it off.
  - Ctrl+C once during the live test.
  - Afterwards, that VoiceOver is back as it was: on or off, and with the owner's own settings.
  - Ctrl+C twice during `doctor`'s live test, with VoiceOver on beforehand, so voicecap exits at once and its exit hook does the clean-up: then that VoiceOver comes back with the owner's own settings.
  - A fresh macOS user account, whose VoiceOver has never been turned on: the checks should say "VoiceOver: not set up for this user yet".
  - That each `SETTINGS_PAGES` address (`x-apple.systempreferences:…`, for Accessibility, Full Disk Access, and Automation) actually opens System Settings at that exact page on macOS 26. Where one doesn't, the checks' own wording already names the page, so the address stays as it is.

Parked, known and left for later:

- The Mac live test's clean-up asks VoiceOver to quit (`tell application "VoiceOver" to quit`) before its `pkill`. With a "control VoiceOver" prompt still pending, that request can wait up to about 15 seconds (AppleScript's 10-second timeout, then the kill 5 seconds later) before the `pkill` runs.
- **The exit hook's stop wait can be cut short.** `stopVoiceOverSync` (`src/drivers/voiceover/macos.ts`) reads a killed `pgrep` as "VoiceOver is gone", and doesn't send again a `pkill` that was killed. So pressing Ctrl+C a third time while the hook waits (silently, for up to about 15 seconds) can let the detach and the restart run while VoiceOver is still quitting, and the person's VoiceOver may come back with voicecap's settings until the Mac restarts. Fix it when sub-project 2 reuses these helpers:
  - treat a killed `pgrep` as unknown, and keep polling;
  - send `pkill` again while VoiceOver still runs;
  - print one line before the hook blocks.
- **An early Ctrl+C in `doctor` can hold the test for 10 seconds.** It reaches the whole process group, so it can kill VoiceOverStarter before VoiceOver starts. Step 1 then waits its full 10 seconds before the test stops.
- **The clean-up can miss a late VoiceOver.** It checks once whether VoiceOver is running, so it misses one that appears only after step 1's 10-second wait gave up. The code before this work had the same gap.
- **Guidepup's own calls can't be interrupted.** They take no abort signal, so Ctrl+C during the live test's step 2 (Guidepup's start) or step 4 (VO-F4) waits for them to finish.

Deferred from the readiness reviews (each judged "can wait" by the final review):

- **Rendering** (`src/readiness/`):
  - `wrap` breaks a path at its spaces, so a path in a fix step can split across two lines. Its edge cases are also untested.
  - `renderProblems` drops a FAIL that has no problem. Making `problem` required on FAIL in the `Check` type would rule that out.
  - Fix steps 10 and up misalign by one column.
  - "Couldn't check <id>" shows internal ids such as `fullDiskAccess`.
  - `guided.ts` holds Mac-specific sentences and the `systemEvents` id. The `Problem` could carry them instead.
- **Machine info:**
  - On the Mac, the terminal app is looked up more than once per preflight, and three times in Mac setup.
  - Every real Windows run works out machine-info lines it never prints, which costs two PowerShell starts.
  - Some fallbacks are untested: `languageName`'s raw locale, Linux's Model line, and the Mac's "this Mac".
- **Windows** (`src/drivers/guidepup-nvda.ts`, `windows.ts`, `paths.ts`):
  - Skip the `ownNvda()` PowerShell query when no `nvda.exe` is running. It costs about 1 second at every start.
  - Keep the NVDA lock while a deferred restore is pending. For now there's a narrow window in which a second voicecap could take it.
  - `shutDown` releases the lock while a Guidepup start or stop it gave up on is still running. This predates this work.
  - A final `stop()` that joins after the restore point loses its final flag. This can't happen today.
  - No test pins the restore coming before the lock's release.
  - `unsafePathMessage` rebuilds its text by string replacement. An exact-text test guards it.
  - The "person's NVDA beside Guidepup's" test checks only for WARN.
- **Mac** (`src/drivers/voiceover/`):
  - `wasOn` is read before the lock is taken, which leaves a race of about 1 ms between two voicecaps.
  - `raiseProcess`:
    - the tests match its scripts only by substring;
    - it has no guard against a non-numeric answer;
    - one of its tests waits on a real 300 ms timer.
  - The order of Guidepup's manifest is trusted, not sorted.
  - Some branches are untested: `browser.close()` or `page.close()` rejecting, and a lock failure that isn't an `EnvironmentError`.
  - The shared exports `GUIDEPUP_EVENTS` and `VOICECAP_VOICEOVER_SETTINGS` are mutable.
  - `stopVoiceOver` can run twice in a compound failure, which adds up to 5 seconds.
  - Over SSH, the guided walk still opens System Settings.
- **CLI and setup** (`src/cli/main.ts`, `src/init/`):
  - Ctrl+C between setup's questions takes effect only at the next question.
  - "Not yet" keeps a step's first guidance when the re-check finds a different problem.
  - The darwin and win32 setup wiring in `main.ts` has no test.
  - The CLI's run path doesn't pass `CliContext.platform` or a readiness override. Future CLI run tests on Windows CI will need that seam.
  - Smaller items:
    - `init` asserts `screenReader!`;
    - `init`'s clock can't be injected;
    - `options.readiness` is evaluated twice;
    - a `deferPrompter` closed before use can still create a prompter, which can't happen today.
- **Duplication:**
  - `foundBrowser`;
  - the "no speech", "browser not in front" and "live test failed" problems, written separately per platform;
  - three copies of the "Another voicecap (process …)" sentence;
  - `describeError`, in both the NVDA driver and the Mac live test;
  - the setup options' shapes.
- **Docs:** the README's `setup` line adds "(Windows or a Mac)", so it isn't a literal quote of the CLI's own description.

Written on the Windows PC at the end of Phase B and the audit-record work, for a new Claude Code session on the owner's Mac. Notes kept on the PC don't travel, so everything the Mac session needs is here.

## How to start

On the Mac: `git pull` in the voicecap repository (Phase A was built there), start Claude Code in it, and paste:

> I'm continuing work on **voicecap** on my Mac, to do **Phase C: VoiceOver**. Read `docs/phase-c-handoff.md` first and follow its "Working rules" exactly; save them to your memory for this project. Then read `README.md`, `CHANGELOG.md`, and `docs/phase-b-handoff.md`, and check the environment as the handoff says. Don't start VoiceOver, run `@guidepup/setup`, or change any macOS setting or permission until I say so. Then we'll design Phase C together before any code.

## Working rules

The owner's standing rules, from Phases A and B:

- **Never add a `Co-Authored-By` or any other AI attribution trailer** to commit messages (including a `Claude-Session:` line). This overrides any harness reminder.
- **Commit and push only when asked.** Check CI on a pushed branch before merging to main: CI can't run on a branch that isn't pushed.
- **Publish to npm only when asked.** The owner's npm account uses 2FA codes that expire in about 30 seconds, while `publish.sh` spends about 3 minutes on checks. So:
  1. run `./publish.sh --dry-run <bump>` once CI has passed on `main`;
  2. `npm version <bump> --no-git-tag-version`, then ask the owner for a fresh code;
  3. the moment it arrives: `npm publish --access public --ignore-scripts --otp <code>`;
  4. commit `package.json` as "Release vX.Y.Z", add an annotated tag `vX.Y.Z` ("voicecap X.Y.Z"), and push `main` and the tag.
- **Ask before building** rather than silently working around something that conflicts with how Guidepup or VoiceOver actually work.
- **Keep screen-reader specifics in the driver layer and config** as far as possible, not in the core.
- **Never use or repeat a password or PIN** pasted into the chat.
- **Real screen-reader runs only with the owner's OK.** They take over the keyboard and speech. The owner stays off the keyboard and mouse, and the Mac stays awake and unlocked (a locked Mac can't be driven). Warn every time.
- **Subagents never start a real screen reader.** Put this in every subagent prompt that may run the CLI:
  - no run without `--replay-from` or a replay config;
  - no `setup`, `doctor`, `test:nvda`, `fixture:capture`, or their VoiceOver counterparts;
  - never pass a composed command through a shell that could split it;
  - answer `init`'s "Run it now?" with No.

  On 2026-09-28 a subagent on Windows sent a printed command through `cmd /c` to test its quoting. cmd split it at `&`, dropped `--replay-from`, and started a real run, which stopped the owner's own NVDA.
- **macOS security settings stay with the owner.** Never disable System Integrity Protection, edit the TCC database, or change Privacy & Security settings without asking. Permissions granted by hand in System Settings are the expected route.
- **Don't write that voicecap doesn't replace screen reader testing.** Its NVDA and VoiceOver runs are the screen reader testing that was asked for, and wording like "doesn't replace testing by people who use screen readers" makes the work sound unfinished. The README's three such lines came out on 2026-09-28. Say what voicecap and its reviewers do, and keep Known limitations to technical ones.

## Where things stand

- **Published:** `@icjia/voicecap` 0.3.1 on npm, from github.com/ICJIA/voicecap (public; CI is free there).
  - 0.1.0 was Phase A: everything with the replay driver.
  - 0.2.0 was Phase B: NVDA through Guidepup on Windows, plus `setup` and `doctor`.
  - 0.3.0 added the audit record, `voicecap verify`, `voicecap init`, and `--page`.
  - 0.3.1 fixed Git Bash's `/c/...` paths.
- **Tests:** about 710 Vitest tests. CI runs on Ubuntu, macOS, and Windows with Node 22 and 24 (six jobs), plus a replay smoke test and `voicecap verify`. They should all pass on the Mac as they are.
- **On macOS today**, everything that doesn't drive a screen reader works: `init`, replay runs, `verify`, `review`, `report`, `manual add`, and `list-urls`. The other commands stop with a clear message:
  - a run: "The guidepup driver runs NVDA, which only runs on Windows. On macOS and Linux, use the replay driver: --replay-from <run folder>." (`requireWindows` in `src/drivers/index.ts`);
  - `init`, instead of offering to run the command: "voicecap runs NVDA, which only runs on Windows. Run this command on a Windows computer." (`src/init/readiness.ts`);
  - `setup` and `doctor`: refuse, and `doctor` reports a FAIL (`src/drivers/guidepup/setup.ts`, `doctor.ts`).
- **The design's spec** is `docs/build-prompt.md` ("NVDA only, for now"; keep NVDA specifics in drivers and config). The audit record and `init` have their own specs and plans in `docs/superpowers/`. The same flow worked well for them: brainstorm with the owner, write a spec, then a plan, then build.
- **Review notes** from the audit-record and `init` work are in git-ignored ledgers on the Windows PC only: `.superpowers/sdd/2026-09-27-*/progress.md`.

## The goal

- **VoiceOver on macOS as a second screen reader, chosen by platform.** The owner asked for auto-detection: the same commands use NVDA on Windows and VoiceOver on the Mac.
- **NVDA stays the core, and VoiceOver adds the Mac.** VoiceOver reads pages differently from NVDA, so it catches problems NVDA doesn't, and it's the screen reader Mac users have.
- **Out of scope:** VoiceOver on the iPhone (Guidepup can't drive it), JAWS, and Orca on Linux (`@guidepup/setup` 0.28.0 mentions it; a possible later phase).

## What's already in place

- **One driver interface** hides the screen reader: `guidepup` (NVDA), `replay`, and a stub. Driver selection is in `src/drivers/index.ts`. The NVDA driver's logic is in `src/drivers/guidepup-nvda.ts`, tested with a fake desktop. Its Windows parts are in `src/drivers/guidepup/`: the Guidepup adapter, Chrome launch, Windows helpers, `setup`, and `doctor`.
- **Every `run.json` and transcript records the screen reader and its version** (the environment record). NVDA and VoiceOver runs can share a site's folder in the audit record without being confused.
- **Pinned:** `@guidepup/guidepup` 0.34.0 and `@guidepup/setup` 0.28.0. Their READMEs list macOS Sonoma, Sequoia, and Tahoe.
  - **VoiceOver API:** `voiceOver.start()`, `next()`, `nextHeading()`, `itemText()`, `lastSpokenPhrase()`, `spokenPhraseLog()`, `perform(voiceOver.keyboardCommands.…)`, and `stop()`. Check the exact names against the installed version; don't guess.
  - **`@guidepup/setup setup`** configures the OS once per machine. Run locally, it "may need some manual steps": https://www.guidepup.dev/docs/guides/manual-voiceover-setup. Its TCC database updates need System Integrity Protection off, which the working rules rule out without the owner. `--macos-ignore-tcc-db` skips them.
  - **`@guidepup/setup install voiceover`** puts VoiceOver's assets in `~/Library/Caches/guidepup/`.

## The hard part is the core, not the driver

Several things are tuned to NVDA and need VoiceOver versions:

- **How a pass moves:** NVDA reads line by line, VoiceOver item by item.
- **End of page:** NVDA repeats the last line.
- **Wording:** the "no next heading" wording, and the flag phrases (NVDA says "unlabeled graphic").
- **The tab pass's start:** NVDA's browse mode skipped the first focusable element, so the first Tab goes to Chrome directly.
- **The foreground check:** NVDA+T against a marker title. VoiceOver needs its own.
- **Keeping the machine awake and detecting a lock**, done for Windows.
- **`setup`, `doctor`, and `init`'s readiness** for macOS, and the messages quoted above.
- **Comparisons:** NVDA and VoiceOver transcripts can't be compared line for line, so `--compare previous` should only look at runs from the same screen reader.

`docs/phase-b-handoff.md` ("Facts that turned out differently") covers what surprised us with NVDA. Most of it has a VoiceOver counterpart to check:
- a browser launched by Playwright fakes focus, so the driver launches Chrome itself and attaches over CDP;
- every page load gets a fresh browser;
- Guidepup's own signal handlers are detached, so the screen reader is stopped exactly once;
- a window in front that keeps changing (Claude Code animating in VS Code) keeps the screen reader talking, so the driver raises the browser first.

## Open questions for the owner

1. **Which browser:**
   - Safari is VoiceOver's natural partner, but Playwright can't drive real Safari.
   - Chrome reuses Phase B's launch-and-attach code. Earlier lean: Chrome, settled by the spike.
2. **Configuration:** `driver: "auto"` as the default (Windows: NVDA; macOS: VoiceOver; elsewhere: a clear message pointing to replay)? And does `guidepup` keep meaning NVDA?
3. **Run folder names:** should they name the screen reader (`2026-09-27/1102_nvda/`)? Every run already records it inside; the earlier lean was no. Decide before real audit runs accumulate.
4. **Real VoiceOver in CI:** Guidepup has a GitHub Action that sets up VoiceOver on GitHub's macOS runners. Check it.
5. **The environment record:** which VoiceOver settings to record (voice, rate, verbosity), as NVDA's non-default settings are.

## Suggested sequence

1. **A spike on the Mac:** Guidepup with VoiceOver against the fixture site (`pnpm fixture:serve`), with the owner's OK and hands off. Write down:
   - what VoiceOver says, and where pages end;
   - how Tab and focus behave;
   - how reliable capture is (`lastSpokenPhrase` against `spokenPhraseLog`);
   - which permission steps were needed.

   Keep the code throwaway and put the findings in this file.
2. **Design with the owner:** a spec and a plan.
3. **Build:**
   - the VoiceOver driver, with per-screen-reader phrasing and flag rules;
   - `auto` detection;
   - macOS `setup`, `doctor`, and `init` readiness.
4. **A real VoiceOver fixture run**, like `fixture/replay-run` for NVDA, so replay tests cover both screen readers everywhere, including CI.

## Spike findings (the Mac, 2026-09-28)

Throwaway spike code (kept outside the repository, in `../voicecap-phase-c-spike/`, with its results and logs) drove real VoiceOver through Guidepup over the fixture site, from Claude Code in VS Code's terminal. Setup: macOS 26.6.2, VoiceOver 10 (build 993), Guidepup 0.34.0, Playwright's Chrome for Testing 153 (chromium-1243).

### Permissions and setup

Every grant belongs to the terminal app that runs voicecap (here VS Code), not to voicecap.

- **Guidepup's VoiceOver assets:** `guidepup install voiceover` puts them in `~/Library/Caches/guidepup`. `voiceOver.start()` needs them.
- **Manual steps, once:** VoiceOver Utility's "Allow VoiceOver to be controlled with AppleScript", VoiceOver's welcome screen, and Do Not Disturb.
- **Accessibility** for the terminal app.
- **Full Disk Access** for the terminal app. Without it, `start()` fails: macOS 26 won't let the terminal create Guidepup's four `com.apple.VoiceOver4.portable.*` symlinks in `~/Library/Group Containers/group.com.apple.VoiceOver/Library/Preferences` (EPERM). Editing the existing `com.apple.VoiceOver4.local.plist` there works.
- **Automation:** the terminal app needs permission to control System Events and VoiceOver. macOS asks the first time each is used.
  - While a prompt is unanswered, every AppleScript call waits until Guidepup kills it at 10 seconds. `start()` tries twice, then reports only "VoiceOver cannot be started". Other calls fail with "Unable to activate application" and similar messages. None of them mentions the prompt.
  - A prompt left until all its requests have died stops responding to Allow.
  - Closing such a prompt by stopping UserNotificationCenter records Don't Allow.
- **Guidepup's ID in VoiceOver's local plist:** Guidepup re-adds it on every start. cfprefsd dropped it once, when VoiceOver was started by hand. That isn't a failure.

### The browser

- **Chrome for Testing's signature:** Playwright's Chrome for Testing has a broken code signature. It's ad-hoc signed, `_CodeSignature` is missing, and `codesign -v` fails. macOS can't match an Automation grant to it, so it asks again on every launch, even with the grant switched on.
- **Raising the browser:** the spike brings the browser to the front by process ID through System Events (`set frontmost of (first process whose unix id is <pid>) to true`), then checks the frontmost pid. Guidepup's reference used `macOSActivate(appName)`. The browser gets no Apple events, so it needs no grant, any browser works, and the right window comes forward even when the owner's own Chrome is open.
- **The installed Google Chrome** is validly signed, but `browserCandidates` in `src/drivers/guidepup/chrome.ts` only knows Windows paths.
- **Getting into the page:** ported from `@guidepup/playwright`. The spike raises the browser, opens the Item Chooser (VO-I), types "web content", then presses Enter and interacts.
  - Once, focus moved to VS Code between passes, after the browser had been raised and checked. "Web content" then matched VS Code's markdown preview, and the pass read VS Code.
  - Match the page's title instead (the Item Chooser lists "<title> web content"), and check focus at every step.

### What VoiceOver says (the home page: read, headings, and Tab passes)

- **Reading (VO-Right):** goes item by item, and containers and their ends are items too.
  - For example: "banner", "end of banner", "Main navigation", "list 4 items", "link Home 1 of 4", "end of list", "main", "footer", "end of footer".
  - List bullets are items: "• 1 of 2. You are currently on a AXListMarker."
- **Usage hints:** every item ends with one, such as "You are currently on a link. To click this link, press Control-Option-Space." The setting is probably `SCRShouldOutputVOInstructions`, which Guidepup's image turns on. Untested: turning it off with `start({ settings })` should shorten both transcripts and steps.
- **End of page:** after "end of footer", VO-Right says nothing new and the item stays "footer".
- **Headings (VO-Command-H):** at the last heading, VoiceOver says "Last heading heading level 2 About the agency". NVDA says "no next heading".
- **Tab:** the first Tab lands on the first focusable element (the skip link). NVDA's browse mode skipped it.
  - Context is added on the way in: "link Home list 4 items", "Search this site edit text search".
  - Tabbing past the last element leaves the page. `document.hasFocus()` turns false, and VoiceOver speaks only a hint.

### Capture, timing, and the environment record

- **Capture:** `lastSpokenPhrase()` and `itemText()` read Guidepup's own logs, which only commands run with capture fill. In 0.34.0, `lastSpokenPhrase()` is the last entry of `spokenPhraseLog()`. The captured speech matched every item.
- **Timing:** capture waits until the speech has been stable for 25 polls (about 4 seconds). Each step took 6–10 seconds, and each silent step at the end of the page took about 17 seconds. The home page's read pass took 6.4 minutes, and the spike's 15-minute watchdog stopped it after four passes. The driver needs fewer silent steps at the end, and probably no hints.
- **Version:** `voiceOver.version` is the version of Guidepup's preferences image ("0.0.1-VoiceOver4"), not VoiceOver's. VoiceOver's own version is in VoiceOver.app's `Info.plist` (10, build 993).
- **Settings:** Guidepup's image fixes VoiceOver's settings during runs, whatever the user's own: Daniel (Premium) voice, 90% rate, high verbosity, punctuation level 1, AppleScript on, and no automatic page reading. `getSettings()` reads them without starting VoiceOver.

### Second run: hints off, the duplicates and flawed pages

This run started VoiceOver with `start({ settings: { SCRShouldOutputVOInstructions: false } })` and used Guidepup's `capture: "initial"` on each step. It also checked the page's title in the Item Chooser, and checked focus after every step.

- **Hints and speed:** with the hints off (the setting read back false) and `initial` capture, a step took about 0.27 seconds instead of 6–10, silent steps included. Six passes over two pages took 1.5 minutes.
- **Getting in:** checking the Item Chooser's "web content" item against the page's title worked first time, on every pass.
- **Repeated phrases look like silence.** Guidepup only notices a phrase that differs from the one before.
  - A repeated line ("Applications are due October 31." twice) or a repeated link ("link Read more" on Tab) comes back as no speech.
  - The item text repeats too, so neither signal tells a repeat from the end of the page.
  - Here, two silent steps in a row ended each read pass correctly. Three identical lines in a row would end one early.
  - The driver needs another signal: perhaps the VoiceOver cursor's position, or, on Tab, which element has focus.
- **The start of the page:** on `/flawed/`, the read pass began at "Main navigation" and skipped the banner and its link. After VoiceOver gets in, its cursor isn't at the top. The driver should move it to the top of the web content and read the item there before stepping.
- **Groups:** on `/flawed/`, the unlabeled field and the icon-only button each sit in a `<div>`. The read pass announced each wrapper as "group" (the second silently, as a repeated phrase) and didn't step into either one. The Tab pass reached both.
- **Focus checks and VO-Command-H:** VO-Command-H makes VoiceOver itself the front process for a moment, so `document.hasFocus()` turns false. Both headings passes stopped after one step on this false alarm. A focus check must accept VoiceOver in front.
- **Wording for the flawed page's problems (VoiceOver 10):**
  - An image without alt text: "Unlabeled image". NVDA says "unlabeled graphic".
  - An image-only link: "Unlabeled image Unlabeled image /chart.png", which uses the file name and doesn't say "link". The read pass had only one such item for the page's two images.
  - An unlabeled text field, on Tab: "edit text blank".
  - An unnamed button: "button".
  - Generic links: "link Read more", "link Click here".
- **Tab:** the first Tab lands on the first focusable element, with or without a skip link. That was "link Skip to main content" on `/duplicates/` and "link Voicecap Test Agency banner" on `/flawed/`. Context words ("main", "footer") tell the two "Back to top" links apart.

### Still open

- **The headings passes on `/duplicates/` and `/flawed/`:** the focus check stopped them. The home page's headings pass showed the full behavior.
- **The two images on `/flawed/`:** the read pass had only one "Unlabeled image" item for the page's two images.

## The owner's requests for Phase C

- **A preflight check in `init` (2026-09-28).** Show the platform and the machine's details. Check that NVDA (Windows) or VoiceOver (Mac) is ready, and say clearly whether everything is ready. If any check fails, give a detailed diagnosis and suggested fixes, then exit gracefully.
  - On the Mac, the checks include each grant above for the terminal app.
  - It's best to raise the Automation prompts up front, while the user is watching, before VoiceOver starts.
  - An AppleScript call killed at its timeout should be reported as "macOS may be waiting for you to answer a permission prompt", naming the app.

## The Mac environment

- **Node 22.19 or later** (24 recommended), **pnpm 10** (`packageManager` pins 10.33.4), and Google Chrome.
- **Checks before changing anything:** `pnpm install`, `pnpm exec playwright install chromium`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- **The transcripts home is `~/webdev/voicecap-transcripts`**, with `export VOICECAP_TRANSCRIPTS=~/webdev/voicecap-transcripts` in `~/.zshrc` (README, "Setting it up"). If reviews are also recorded on the PC, pull before recording and push after: two machines adding reviews before syncing break the review chain, and `verify` reports it.
