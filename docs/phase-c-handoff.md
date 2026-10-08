# Phase C handoff: VoiceOver on the Mac

> **On hold until the PC work is finished** (the owner, 2026-10-05): plan 6c, then a security audit of the PC work, come first. Then Phase C is built, followed by a separate security audit of the Mac part. See "Where things stand" for the latest.

## Status: readiness done, released in 0.4.0 (2026-09-29; spike findings below)

Readiness (sub-project 1): designed (`docs/superpowers/specs/2026-09-28-readiness-design.md`) and built. The spike is done. The VoiceOver driver (sub-project 2) comes next.

**Releasing:** the plan was for the Mac half to ship with the VoiceOver driver. On 2026-09-29 the owner chose to ship both halves in 0.4.0, once the supervised run on this Mac passes, and the spec's Release row was amended to say so. Until the driver exists, a ready Mac says voicecap can't run VoiceOver yet: `init` after its command, and every verdict ("Ready: this computer is set up for VoiceOver, but voicecap can't run VoiceOver yet: that comes with its VoiceOver driver.").

**Supervised run on this Mac (2026-09-29).** Steps 1–4 and 7 were run by the owner in iTerm, and steps 5 and 6 from VS Code's terminal. After every step, VoiceOver was back as it had been (on or off, with the owner's own settings), the settings image was unmounted, no test browser was left, and the lock file was gone.
- **Step 1, `doctor` with VoiceOver off: passed.** All 12 checks and the 4 live-test checks were OK.
- **Step 2, `doctor` with VoiceOver on: passed.** The warning said VoiceOver was on, and there were no clean-up warnings.
- **Step 3, `setup`: passed.** It found the VoiceOver files already cached, wrote its two settings with their undo lines, said the checking notice, passed all 12 checks, and passed the offered live test.
- **Step 4, `init`: passed.** It ran the checks and the offered live test, then the wizard. The site check caught a mistyped address (ENOTFOUND). It ended with the command and the "can't run VoiceOver yet" line, with no "Run it now?".
- **Step 5, one Control-C: passed.** The signal went to the process group 11 seconds in, with the settings image mounted and the browser up. It printed "Interrupted…" and exited 130 within 3 seconds.
- **Step 6, two Control-Cs, VoiceOver on: passed.** voicecap exited at once (130). The exit hook detached the image (`hdiutil`, 07:47:44.10), and the owner's VoiceOver restarted right after (07:47:44), so it loaded the owner's settings.
- **Step 7, the three `SETTINGS_PAGES` addresses: each opened the right page** on macOS 26.
- **Found by the run, and fixed before release:**
  - `doctor` and `setup` said a ready Mac "can run VoiceOver for voicecap". Every verdict now uses the line above.
  - The terminal app was named from its Info.plist, as "Code" and "iTerm2". System Settings and macOS's prompts call them "Visual Studio Code" and "iTerm", so voicecap now uses the app's file name.
- **Found by the run, for the docs:** while the browser is in front (during a live test or a run), Control-C typed on the keyboard goes to the browser, not the terminal. The owner's attempts at step 5 never reached voicecap. The README now says to click the terminal window first.
- **Found by the run, for the VoiceOver driver:** VO-F4 described Chromium's address bar ("127.0.0.1:… Address and search bar edit text has keyboard focus"), not the check page. voicecap starts Chrome on `about:blank`, which puts focus in the address bar, and it stays there after the page loads. So the driver must move focus into the web content before a pass. The live test's "hears the page" still holds as a check that VoiceOver speaks for that browser window, as Windows' check accepts any speech.

Still to check by hand. For the Windows PC, `docs/windows-pc-checks.md` gives each check step by step, with the commands, what to look for, and the release steps that follow:

- **On the Windows PC:** done on 2026-09-29, with a final clean run on 2026-09-30; see "Windows checks on the PC" below.
  - `nvdaProcesses` with a non-ASCII character in the Guidepup folder path;
  - whether Windows reports the installed NVDA's `ExecutablePath` (the null-path case);
  - `windowsComputerModel` and `windowsBrowserVersion` on real hardware;
  - after a run, that the person's installed NVDA restarts through `Start-Process`, including one that uses UIAccess;
  - how long the quick checks take, against the README's "about two seconds";
  - closing the terminal window during `init`'s live test;
  - **`voicecap demo` from start to finish**, from a build of the branch (`node dist/cli.js demo`), or with `npx @icjia/voicecap demo`:
    - time step 4 and the whole tour against `AUDIT_MINUTES` (6) and `TOUR_MINUTES` (9) in `src/demo/words.ts`, and change them (and the README and spec) if they're off;
    - check that the opened report flags `/common-mistakes/` and no other page;
    - check that the terminal keeps Ctrl+C for itself through the whole audit;
    - check that Ctrl+C, and closing the window, both stop the audit mid-run and give the owner's own NVDA back.
- **On this Mac, with the owner's OK:** the supervised run above is done, except for one item: a fresh macOS user account, whose VoiceOver has never been turned on. There, the checks should say "VoiceOver: not set up for this user yet".
- **On this Mac, for 0.6.0's run records:** capture `system_profiler SPDisplaysDataType -json`, and check `parseMacDisplays` (`src/drivers/voiceover/macos.ts`) against it. Every session records the main display it reads, replays on a Mac included. Two things may be wrong on a real Mac:
  - on a scaled Retina display, `_spdisplays_resolution` may hold the "looks like" size while `_spdisplays_pixels` holds the physical pixels;
  - a descriptor before the "@", as in "2560 x 1440 (QHD/WQHD - Wide Quad High Definition) @ 60.00Hz", loses the refresh rate.

**Windows checks on the PC (2026-09-29).** The owner ran each check in PowerShell on the Windows PC: an Alienware Aurora ACT1250, Windows 11 Pro 25H2, the installed NVDA 2026.2 (with UI Access), Guidepup's NVDA 0.2.1-2026.2, and Chrome 153.0.8010.53, then 154.0.8037.58. The first runs used `main` at 42a419d, and the rest the branch `windows-checks-fixes`, with Fix 1 and Fix 2 below.

- **Evidence:**
  - A read-only watcher logged, to the millisecond, every `nvda.exe` start and exit with its path, voicecap's NVDA lock, and its browser profiles.
  - The demo runs' own records are in `voicecap-demo/127.0.0.1_4848/2026-09-29/`: runs 1315, 1402, 1415, and 1419. That folder is git-ignored.
- **Part 1 check 1, the demo's timings: a little off.**
  - Step 4 held NVDA for 6:10.8 (run 1315) and 6:23.7 (run 1402). Each run had one page fail, after the owner bumped the keyboard or the desk.
  - The stopwatch gave 6:20.95 for run 1315's step 4, and its whole tour took 7:39.
  - A clean audit comes to about 6:30 of NVDA time, or about 6:40 by stopwatch. So `AUDIT_MINUTES` (6) is short, and `TOUR_MINUTES` (9) holds.
  - The owner chose 7: `AUDIT_MINUTES` is now 7, and so are the README's and the spec's numbers.
  - Confirmed by the final clean run on 2026-09-30 (below): step 4 took about 6 minutes, and the whole tour 7:51, so 7 and 9 hold, a little generously.
- **Part 1 check 2, the flags: failed, then passed with Fix 2.**
  - Run 1315 also flagged `/ask-a-question/` `unlabeled`. In browse mode, NVDA read its labeled textarea's label as a line of its own: "Your question (required)", then "edit, required, multi line".
  - With Fix 2, run 1402 flagged `/common-mistakes/` only, with `generic-link-text`, `unlabeled`, and `headings`.
  - No single run finished all seven pages; each page finished in one run or the other.
- **Part 1 check 3, Ctrl+C: passed** (run 1415).
  - The tour said "Stopping: …".
  - About 3 seconds after the shutdown began (14:16:42.6), Guidepup's NVDA had quit, and the owner's NVDA was back (14:16:45.518, process 39060) before the lock was released.
  - The tour said "Stopped. Nothing is left running.", and nothing voicecap started was left.
  - The run recorded `interrupted`, with 1 page done and 6 pending.
- **Part 1 check 4, closing the window: passed** (run 1419).
  - Nothing voicecap started was left, and the owner's NVDA came back (14:20:45.507, process 9452). The run recorded `interrupted`.
  - The exit path started the owner's NVDA 1.1 s before Guidepup's NVDA had finished quitting (14:20:46.582). It survived, because NVDA's own start waits for a copy that's still running to quit.
  - Fixed since, with Fix 4.
- **Part 2 check 1, an accented Guidepup folder: passed.**
  - `setup` installed Guidepup's NVDA in `C:\guidepup-é` (401 MB), and `doctor`'s live test started it from there.
  - The report showed `C:\guidepup-é` without garbling.
  - During the test, `nvdaProcesses()` read the path exactly, for all three of that NVDA's processes, and didn't count that NVDA as the owner's.
- **Part 2 check 2, the installed NVDA's path: Windows hid it; fixed with Fix 1.**
  - The installed NVDA runs with UI Access at High integrity (0x3000), and voicecap's PowerShell at Medium (0x2000).
  - WMI's `ExecutablePath` came back empty, so the warning said "Afterwards, start yours again the way you usually do".
  - `QueryFullProcessImageName` gives the path. With Fix 1, the warning says "…then turn yours back on".
- **Part 2 check 3, the model and browser: passed.**
  - The Model line read "Alienware Aurora ACT1250, Intel(R) Core(TM) Ultra 7 265F, 32 GB memory, …".
  - The Browser line showed Chrome's real version: 153.0.8010.53, then 154.0.8037.58 after Chrome updated itself.
- **Part 2 check 4, the installed NVDA back after a run: failed, then passed with Fix 1.**
  - Run 1315's live test shut the owner's NVDA down at 13:15:09 and couldn't start it again, since it had no path. The owner restarted it by hand.
  - With Fix 1, every run and live test turned it back on and said so: runs 1402, 1415, and 1419, `init`'s and `doctor`'s live tests, and a live test that failed.
  - voicecap's own `restartNvda()`, run by hand with the owner's OK, started the installed NVDA with UI Access through `Start-Process`.
- **Part 2 check 5, the quick checks' time: about 3 seconds, not the README's "about two".**
  - The checks take 2.65–3.05 s, plus 0.3 s for Node to start.
  - The slowest parts: machine info 1.3 s, the owner's-NVDA check 0.7–0.9 s, and the Windows-locked check 0.6 s.
  - The README now says "about three seconds".
- **Part 2 check 6, closing the window during `init`'s live test: passed** on the second try. On the first, the window was closed after the test had ended.
  - The test stopped about 3 s early: 16.2 s, against 18.9–19.3 s for the day's uninterrupted tests.
  - Guidepup's NVDA quit (14:26:42.414) before the owner's came back (14:26:43.489), and nothing was left.
- **Found along the way: Chrome updating itself as voicecap starts it.**
  - Chrome had an update staged, and no other Chrome was open. The Chrome voicecap started swapped in 154.0.8037.58 and exited with code 0.
  - The new version then carried on with voicecap's profile for about a minute.
  - The live test said "Chrome didn't start: it exited (0)", and the profile folder was left behind. The next run deleted it.
  - Fixed with Fix 3, the owner's choice among two designs.
- **Fix 1** (`src/drivers/guidepup/windows.ts`): `nvdaProcesses()` reads each path with `QueryFullProcessImageName`, which needs only the limited query right, instead of WMI's `ExecutablePath`.
  - Its test starts a stand-in `nvda.exe` whose access list leaves this user only that right. The test failed before the fix, and passes after it.
- **Fix 2** (`src/flags/evaluate.ts`, the config): a new setting, `flags.unlabeled.tabOnlyRoles`, lists edit, combo box, check box, and radio button.
  - A read-pass line with only one of those roles isn't flagged; the tab pass still flags them.
  - Checked against the day's real transcripts, and against the fixture run's.
- **Fix 3** (`src/drivers/guidepup/chrome.ts`): when the browser voicecap starts exits with code 0 before it's ready, voicecap closes whatever took over its profile, found by the profile's path in the command line (`closeBrowsersUsing`). It then deletes the profile, says so, and starts the browser again, once.
  - Its tests, with real Chromium, simulate the hand-over: a start that exits with code 0 while a new copy goes on with the profile. They also check that a second hand-over gives up with the usual error, and that a crash (another exit code) isn't retried.
  - A narrow gap remains, as before the fix. If the new copy wrote its DevTools port before voicecap noticed the first exit, voicecap would attach to a browser it didn't start. Closing it works (through the DevTools connection). If voicecap were killed, though, the copy would stay open until the next run's clean-up.
  - On 2026-09-29, voicecap noticed the exit first. The first process exits as soon as it has started the new copy, and voicecap checks every 50 ms, while the new copy needs a few hundred milliseconds to write its port.
- **Fix 4** (`src/drivers/guidepup/windows.ts`): the helper that starts the owner's NVDA as voicecap exits (`restartAfterScript`) first waits, for up to 20 seconds, until no `nvda.exe` from Guidepup's folder is running.
  - Its test starts a file that doesn't exist, so the attempt opens no window. Before the fix, the attempt came 1.4 s before a stand-in Guidepup NVDA had quit; now it comes after.
- **The final clean run: passed** (2026-09-30, run 2026-09-30_1218). The owner ran `node dist/cli.js demo`, built from the branch at f8b11ac, with Chrome 154.0.8037.58.
  - All 7 pages were read in full, each on its first attempt. The run completed and was sealed, and `voicecap verify` found everything matching.
  - Timings: step 4 about 6 minutes by the owner's stopwatch (the run held NVDA from 12:18:54 to 12:25:32, its report included), and the whole tour 7:51.
  - Flags: `/common-mistakes/` only, with `generic-link-text`, `unlabeled`, and `headings` (Fix 2).
  - The owner's installed NVDA came back after the live test and after the run (Fix 1).
  - The session recorded its reviewer, "Christopher Schweda" from `git config user.name`, and the report's sessions table showed it.
  - No page needed a retry, and Chrome didn't hand over, so this run didn't exercise Fix 3 or the retries; their tests cover them.

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

Deferred from the `voicecap demo` reviews (2026-09-29), each judged "can wait" or parked by the final review:

- **Ctrl+C in the tour** (`src/demo/tour.ts`):
  - A second Ctrl+C while the terminal keeps it for itself does nothing; only a real SIGINT gets the exit on the second press.
  - A SIGHUP after a Ctrl+C only aborts.
  - The prompter exists before step 2, so on a Mac, Ctrl+C can't cut short a check that's waiting up to 60 seconds on the System Events prompt.
  - A late SIGINT, arriving after the run's last abort check, says "Stopping…", yet the tour carries on. The fix: treat `stop.signal.aborted` after a completed run as interrupted.
  - An alternative the final review suggested: close the prompter during step 4 and use `handleInterrupts`, as `init` does when it hands off to a run.
- **Words:**
  - The Ctrl+D message lands on the prompt's line; it needs a blank line first.
  - A browser that updates itself mid-demo still says "run the same command again to resume" (`guidepup-nvda.ts:744`).
  - `doctor` is described as "the checks on their own", though it also runs the live test.
  - README's "pnpm is only for … the replay demo" sits near "Try it first".
  - `auditIntro`'s first two lines don't go through `paragraph()`.
- **An Enter typed ahead** during step 2's checks answers the pause before the live test (typed-ahead input isn't dropped).
- **The demo server** (`src/demo/server.ts`, `src/util/static-site.ts`):
  - `close()` rejects on a second call.
  - A missing `demo/site/` or `404.html` makes every page a 500; a check at startup would give a clear error.
  - The 500 and 405 blocks are duplicated in both servers.
  - The default port, 4848, isn't tested, and neither is `closeAllConnections()`.
  - Polish: temp folders from the tests aren't removed; the `listen` parameter shadows the module's function. (A third item, a 405 on `/ask-a-question/` that says `Allow: GET, HEAD`, without POST, is settled: since 0.10.0 the form sends with GET to `ask-a-question/sent.html`, and the server answers no POST, so the header is right.)
- **Tests:**
  - No test pins that a replay run ignores `preflight`.
  - No test checks that step 3 passes the fake signals on.
  - The throwing-run test doesn't check that listeners are gone.
  - The fixture server's traversal test is weak for 5 of its 6 cases. This predates the demo; the shared guard is pinned by the demo server's test.
- **Duplication:** `renderPreflight`'s options are built three times, in `main.ts`, `guided.ts`, and `tour.ts`.

Written on the Windows PC at the end of Phase B and the audit-record work, for a new working session on the owner's Mac. Notes kept on the PC don't travel, so everything the Mac session needs is here.

## How to start

On the Mac: `git pull` in the voicecap repository (Phase A was built there), then start from this brief:

> I'm continuing work on **voicecap** on my Mac, to do **Phase C: VoiceOver**. Read `docs/phase-c-handoff.md` first and follow its "Working rules" exactly. Then read `README.md`, `CHANGELOG.md`, and `docs/phase-b-handoff.md`, and check the environment as the handoff says. Don't start VoiceOver, run `@guidepup/setup`, or change any macOS setting or permission until I say so. Then we'll design Phase C together before any code.

## Working rules

The owner's standing rules, from Phases A and B:

- **Commit messages are one subject line, with no trailers of any kind.**
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
- **A delegated task never starts a real screen reader.** Every brief for a task that may run the CLI says:
  - no run without `--replay-from` or a replay config;
  - no `setup`, `doctor`, `test:nvda`, `fixture:capture`, or their VoiceOver counterparts;
  - never pass a composed command through a shell that could split it;
  - answer `init`'s "Run it now?" with No.

  On 2026-09-28 a quoting check on Windows sent a printed command through `cmd /c`. cmd split it at `&`, dropped `--replay-from`, and started a real run, which stopped the owner's own NVDA.
- **macOS security settings stay with the owner.** Never disable System Integrity Protection, edit the TCC database, or change Privacy & Security settings without asking. Permissions granted by hand in System Settings are the expected route.
- **Don't write that voicecap doesn't replace screen reader testing.** Its NVDA and VoiceOver runs are the screen reader testing that was asked for, and wording like "doesn't replace testing by people who use screen readers" makes the work sound unfinished. The README's three such lines came out on 2026-09-28. Say what voicecap and its reviewers do, and keep Known limitations to technical ones.
- **Never call voicecap automated testing or an automated checker** (the owner, 2026-09-30). It's a listen-through with a real screen reader, NVDA or VoiceOver: the other half of what a manager asks for, beside an automated checker such as axe or Lighthouse.
- **When a major feature lands, merged or released, update the README and the report's timeline in the same change** (the owner, 2026-09-30). The timeline is in "How voicecap came to be", with a Windows PC track and a Mac track, and lives in `src/share/text.ts` (`TIMELINE`); a test checks every release in it against the CHANGELOG's headings, and that every minor release has its line. What isn't done yet is marked "Next".
- **voicecap is a human review, sped up** (the owner, 2026-09-30). The person running it reads the transcripts and fixes what they find; voicecap presses the keys and turns the pages. Lead with what the person did.
  - **The key is the transcripts, not the speech** (the owner, 2026-10-02). During a run NVDA speaks at its top speed, as Guidepup sets it up (rate 100 with rate boost), and Guidepup silences it before each key press, so the person hears it at work but can't follow the words. Say the person heard NVDA speaking, never that they listened. Keep the word "listen-through" for what voicecap is, and "worth a closer listen" for what flags point to.
  - The question at the end of a run is "Did you hear NVDA speaking as it read these pages?", and it says the speech is very fast. It names the screen reader, so before a VoiceOver run asks it, check how fast VoiceOver speaks under Guidepup. Never headline that pages haven't been reviewed by a person: what's left is a task, under "What's still to do". Working from the list, voicecap accounts for every page on it, none missed or done twice.
  - What it does on its own is press the screen reader's keys, the way a person would, and move from page to page along a sitemap or page list. That's how one person can spot-check a large site, zero in on problem pages, or go through a whole small site.
  - Every word in its results is what the screen reader said.

## Where things stand

- **Published:** `@icjia/voicecap` 0.13.2 on npm, released 2026-10-08 (tag `v0.13.2`), from github.com/ICJIA/voicecap (public; CI is free there).
  - 0.1.0 was Phase A: everything with the replay driver.
  - 0.2.0 was Phase B: NVDA through Guidepup on Windows, plus `setup` and `doctor`.
  - 0.3.0 added the audit record, `voicecap verify`, `voicecap init`, and `--page`; 0.3.1 fixed Git Bash's `/c/...` paths.
  - 0.4.0 added readiness: the checks, the live test, and `setup` and `doctor` on macOS; 0.4.1 let `--sitemap` take a sitemap's name.
  - 0.5.0 added `voicecap demo`, the four fixes the Windows checks found (2026-09-29 and 30), a failed page tried up to 5 times, and the reviewer's name on every session. It was merged to `main` from the branch `windows-checks-fixes`.
  - 0.6.0 (2026-10-02) added the first two of the shareable report's six plans, and more:
    - what each run records: page titles, every failed attempt and its cause, the computer, and whether the person heard NVDA speaking;
    - the shareable page, every site folder's `share/current.html`, written after a completed run, a review, a manual session, and `voicecap report`;
    - `voicecap preflight`, the checks on their own, with a Ready or Not ready verdict (on a Mac it says the checks passed, and that VoiceOver audits wait for the driver);
    - a README that starts with a three-step Quick start, folds its long sections, puts PowerShell first on a PC, and ends with Credits.
  - A real run on the Windows PC, the last check before 0.6.0, found that voicecap didn't exit after the end-of-run question in Windows Terminal (fixed: the keyboard's raw mode is left only once stdin has stopped reading), and that NVDA's speech in a run is too fast to follow (kept, and said plainly: see "The key is the transcripts" above).
  - 0.7.0 (2026-10-03) added plan 3 of the shareable report:
    - the Word copy, `share/current.docx`, written wherever the page is; it opens with its title and the date and time it was made, then the site, so a reader never meets a bare address first (the owner asked for this after opening it in Word);
    - `voicecap share`, which makes the dated pair to send, records it in `share/shares.json` with its fingerprints, and prints a line to paste into the email;
    - `voicecap verify`'s checks of that record and of every copy it names;
    - a fix for CI: a CLI run in the tests now uses the test's platform, so it no longer starts the real PowerShell probe on Windows (about 20 s on CI's Windows machines).
  - 0.8.0 (2026-10-03) added plan 4 of the shareable report, the walkthrough file:
    - `voicecap walkthrough` writes a completed run's recipe: its pages in order, with its passes, step limits, capture mode, and readiness settings;
    - `--walkthrough` repeats the run from the file, then says page by page how each page sounds against the original;
    - the shareable page offers each run's file to download, and the Word copy says how to get it;
    - runs now record their readiness settings, so a run that 0.7.0 or earlier left incomplete isn't resumed (voicecap says so at each new run, until a later completed run with the same other settings supersedes the old one);
    - a file can come from anyone, so voicecap reads it strictly: among other things, it refuses a file whose page labels, templates, or notes hold a control character (a tab or a line break is fine), or whose ready selector holds one or is over 1,024 characters;
    - a fix: a key named `__proto__` added to a sealed record now changes its seal.
  - 0.9.0 (2026-10-04) added plan 5 of the shareable report, the website:
    - `voicecap site` builds a website of every report voicecap has shared, by site and by date, with the demo. It reads each site folder's `share/shares.json`, and publishes only the files whose size and SHA-256 still match the record, byte for byte, with the headers Netlify serves;
    - `voicecap share` now also writes each run's walkthrough file, and records it with its run, so the site has one to offer;
    - the README opens, after "voicecap in brief", with "Why voicecap, and who it's for": the two halves of an accessibility review, how voicecap is different, and composite stories of the people it's made for (the owner asked for it);
    - the first deploy was the owner's, by the README's five numbered steps, on 2026-10-04: the site is https://voicecap.netlify.app, built by Netlify from `ICJIA/voicecap-transcripts` on every push. It says "No reports have been shared yet." until a share is pushed. The owner's Netlify team is on Pro, which Netlify needs to build from an organization's private repository;
    - still to confirm on this Mac, with VoiceOver in Safari (only Chromium was available on the PC): that the site's lists of files, and its list by date, are announced as lists (they carry `role="list"`, since WebKit drops the list from one with no markers); that the bar, which stays in view from 40em wide (640 pixels at the default text size), doesn't cover what Tab moves to; and how VoiceOver reads the theme button, whose name changes with its state. `pnpm site:fixture <folder>` builds a page to open.
  - 0.9.1 (2026-10-04) fixed what the owner's first deploy found, on a home no run had written to yet:
    - `voicecap site` writes voicecap's own `.gitattributes` and `.gitignore` where the home is missing them, as a run does. 0.9.0 told the owner to add `_site/` to a `.gitignore` that wasn't there, and a `.gitignore` made by hand keeps voicecap's own, which keeps raw NVDA logs out of Git, from ever being written;
    - the check that a `.gitignore` keeps `_site/` out reads it as Git does: a line with a space at its start keeps nothing out, and a byte order mark at the file's start is skipped;
    - the tests take `VOICECAP_TRANSCRIPTS` and `VOICECAP_REVIEWER` out of their environment, since a deliberate-break check during plan 5 had read them and written a stale `netlify.toml` (`@0.8`), `.nvmrc`, and `_site/` into the owner's real home. CI sets both, to check it;
    - the README's stories of who voicecap is for open from one line each (the owner asked).
  - 0.10.0 (2026-10-05) added plan 5b, canonical site names. The owner asked three times that nothing readers see lead with an IP address: "use canonical site names, even if run on localhost".
    - **Where the name comes from:** a run learns the site's canonical address from `--canonical` or its pages' `<link rel="canonical">` (inner pages first) and records it in `run.json`. `report.canonical` in a config names it when the page or a share is made. `init` asks for it when the site's address is an IP or local and its home page names none.
    - **What leads:** the page, its Word copy, the run report, shared copies' names, and the website name the site by that address, never an IP. The page and the Word copy lead with the name and "Tested <date>, <time>".
    - **Shares:** a share refuses to name a site by an IP or local address. Shares record the address as `site`, and `--site` accepts it.
    - **The demo:** its pages are published at voicecap.netlify.app/demo-site/, its canonical address, with relative links, canonical tags, a GET form, and exact CSP rules.
    - **Also:** the website's and the page's footers keep to the width of the text above them, and the README shows six screenshots of what voicecap makes (`pnpm readme:screenshots`).
    - **The plan's record:** its After execution lists 23 rulings and what's carried.
    - **Confirmed on the PC on 2026-10-06** (with 0.11.0's build): a real demo run records `"canonical": "https://voicecap.netlify.app/demo-site/"`, and its share is named `voicecap.netlify.app_2026-10-06.*`.
  - 0.11.0 (2026-10-06) added plan 6, the event log and screenshots. Its plan is `docs/superpowers/plans/2026-10-05-shareable-report-plan-6-event-log-and-screenshots.md`, with its rulings and what the PC found in its After execution.
    - **Footers:** the footer sits at the window's bottom when a page is shorter than the window, on every page voicecap makes.
    - **The event log:** each run's folder has `events.jsonl`, written as the run goes, and sealed with the run in `run.json`'s new `files`, which `voicecap verify` checks.
      - It holds the run's own events: its sessions, its pages, and each restart and why.
      - It also holds the NVDA driver's: the NVDA lock, voicecap's NVDA and the computer's own, the browsers (with process ids), and the computer found locked.
    - **The program in front:** when another window takes the screen, the log names the program and keeps the window's title. The failed attempt's record keeps only the program's name, so no page or Word copy shows a title. A Store app is named by its own program, such as Calculator, which the PC runs found and the release fixed.
    - **Screenshots:** each page has `pages/<slug>/screenshot.jpg`, taken through the browser's DevTools connection as the page loads, before NVDA reads it.
    - **The page and the Word copy** show:
      - each session's timeline and table of events;
      - the "NVDA restarts" fact;
      - a problem's event-log lines and program;
      - each page's screenshot, which "Check the fingerprints" covers.
    - **The README** opens with two sentences on what voicecap does and why nothing off the shelf does it (the owner asked, for managers).
    - **The PC runs** (2026-10-06) checked all of it with real NVDA. They also settled the facts plan 6c needs:
      - NVDA's log at the input/output level is turned on through Guidepup's settings (`general.loggingLevel: "IO"`), and lands in `%TEMP%\nvda.log`, moved to `nvda-old.log` at each NVDA start;
      - it changes neither NVDA's timing nor what it says;
      - voicecap's keys appear in it as `Input:` lines;
      - it also holds other windows' speech and the account name in paths.
  - 0.12.0 (2026-10-07) added plan 7, `docs/superpowers/plans/2026-10-06-shareable-report-plan-7-what-needs-attention.md`, at the owner's requests of 2026-10-06.
    - **What needs attention** is a section of cards, one for each problem across pages. Each says what NVDA says and where, the likely cause (with Chrome's rule for alt text that's too generic, from Chromium's source), why it matters, the fix in the code, what NVDA should say then, and the path forward. The cards come from NVDA's words, never the page's HTML.
    - **A review settles a flag** ("Checked by <name>, <date>: not an issue"); a stopped read clears only when a later run reads the page to its end.
    - **The summary** has five numbers (no "heard live"), counts problems, and its attention panel takes the full width.
    - **The README's screenshots** come from the i2i v3 run of 6 October 2026 (`fixture/i2i-v3-run`), the owner's main site.
  - 0.12.1 (2026-10-07) made the summary easier to read, at the owner's request:
    - its four panels are full-width rows, one under another, with each line of text kept to 80 characters;
    - its "Since the last run" line groups the pages a flag was resolved on, and says each flag once ("the unnamed items, on all 32 of them").
  - 0.12.2 (2026-10-07) trimmed the website, at the owner's request: "the only report that matters is the current one", and "the most recent 3 is all that's needed".
    - **What a site shows:** its newest three shares. First comes the current report, with buttons to open it and to download its Word copy. The two before it are a line each. Last is every file with its fingerprint, in a closed fold.
    - **The list by date** shows only when two sites or more have reports.
    - **An older share** stays in the records, and `verify` checks it as before. Its files aren't published. Its page's address sends a reader on to the site's current report (`_redirects`, a 302).
  - 0.12.3 (2026-10-07) put what each report found on its card, at the owner's request: managers ask "Did it pass?".
    - **Each share records a sealed `result`:** the pages in scope, how many NVDA read, the problems that need attention, and the pages they're on. `verify` names one it can't read.
    - **The card says it in the report's own words,** after a sign drawn by the style, which a screen reader doesn't read: "✓ Nothing needs attention: NVDA read all 9 pages.", or "⚠ 1 problem needs attention, on 32 pages. …"; red when NVDA read fewer pages than are in scope.
    - **A share from before 0.12.3** has no result, and its card says nothing of one: share again, with no new run.
    - **Each site's section has its own address,** such as `voicecap.netlify.app/#site-sfs.icjia.illinois.gov`, which always leads with the newest report.
  - **Two sites on the website, since 2026-10-07:** i2i's v3 (`v3--i2i.netlify.app`) and Safe From the Start (`sfs.icjia.illinois.gov`). Safe From the Start's 9 pages were read that day with real NVDA and raised no flags.
  - 0.13.0 (2026-10-08) is plan 9, the page for managers. The owner asked on 2026-10-07 for the most critical facts first (the overall result, the screenshots, and the transcripts) and the details last.
    - **At a glance comes first:**
      - a verdict in words and an icon, which is red when NVDA read fewer pages than are in scope;
      - the result sentence;
      - a ring of the pages: "Read, no problems", "Read, with problems", and "Not read";
      - four big numbers;
      - the method line.
    - **What needs attention** shows only when there's a card.
    - **Every page:** each card holds what NVDA said first on its page and its full transcript, folded. The cards sit two a row on wide screens. The appendix of transcripts is gone.
    - **The details, for reviewers and auditors,** come last, with what the summary's panels and the later sections held. The Word copy follows the same order.
    - **The owner's choices after the final review:** two cards a row, where an opened transcript had read in a box about 200 px wide; and the ring's labels, where "Need attention" could contradict the verdict.
    - sfs and i2i v3 were shared again with 0.13.0 on 2026-10-08 (entries 3 and 6). The website builds with `@0.13`.
  - 0.13.1 (2026-10-08) is the website's headings. The owner asked that day to make them "more infographic-ish", with "a direct link to each site", then "even bigger".
    - **Each view's heading is a banner:** a large picture in a circle, the heading in large type, and how many the view holds as a big number with its word ("2 sites").
    - **Each site's name is larger,** with "Visit the site", a link to the root that names the site. It opens in a new tab (the owner's ask, so a reader can switch between the report and the site), and a screen reader hears "Visit the site at sfs.icjia.illinois.gov, in a new tab". A site its folder names has no link.
    - **A card's verdict is a pill,** over a bar of the pages NVDA read with its words.
    - The owner reviewed it on a Netlify draft deploy, `headings-preview--voicecap.netlify.app` (`netlify deploy --no-build --alias headings-preview`, never `--prod`).
  - 0.13.2 (2026-10-08) is the website's "Can I trust this?" page (`trust.html`, also at `/trust`), modeled on audit.icjia.app/trust at the owner's ask: managers needn't take one person's tool on trust. Every page's bar links to it.
    - **Every number and date about voicecap on it is generated:** the release's own test counts, commits, and CI matrix in `dist/release-facts.json` (written by `publish.sh` from its own test run; a shallow clone is refused), the package's version and CHANGELOG, and the records the website published. A missing fact says "not recorded in this build of voicecap".
    - **It says only what holds:** "Before this release", files left out as "missing or changed", "nothing needs attention on the pages read" when NVDA didn't read every page, and axe claimed only for the shareable page and the website. CI's checkout fetches the whole history (`fetch-depth: 0`).
- **Being built:** each plan written when the owner says:
  - plan 8, the review replay (`voicecap review --replay`: a page's saved words read aloud at a normal speed), as 0.14.0. Its spec was approved and its plan (`docs/superpowers/plans/2026-10-08-review-replay-plan-8.md`) is built and reviewed on `plan-8-review-replay` (worktree `voicecap-replay`), and waits for the owner's check at the PC before its release.
  - plan 12, the website in audit.icjia.app's look, as 0.15.0: a top bar and a bottom bar (GitHub, Changelog, What's New, Can I trust this?, Technical details, the version), a Technical details page, and a What's New page made from the CHANGELOG. Its spec is `docs/superpowers/specs/2026-10-08-website-like-audit-design.md` on `plan-12-website-look` (worktree `voicecap-look`), awaiting the owner's review.
  - plan 10, axe's findings on each page's card, beside its transcripts, as 0.16.0 (queued by the owner on 2026-10-08): captured on the page load NVDA reads, sealed with the run, apart from voicecap's verdict.
  - plan 11, NVDA's own voice saved as a small, compressed audio file for each page, fingerprinted, with a player that can slow it down, as 0.17.0 (queued by the owner on 2026-10-08).
  - plan 6c, NVDA's own log checked against the transcripts, after those, as 0.18.0. Tasks 1-2 are built on `plan-6c-nvda-log`; it waits, and resumes by merging main first. Until then, its place on the page says "Not recorded".
  - plan 6d, queued for later ("eventually"): an optional double check that re-reads some pages, compares the reads, and reads again on a mismatch, so the page can say a page read the same twice.
  - **The owner's decisions of 2026-10-05:** the VoiceOver work on the Mac (Phase C) waits until the PC work is finished: plans 6 and 6c, then a security audit of the PC work. Then Phase C is built, and a separate security audit of the Mac part follows.
  - Still to confirm on a real PC: a Chrome window closed mid-page is recorded as `browser`, and a real repeat with NVDA, which should end with each page's comparison (the owner's check, hands off, as for any real run).
- **Tests:** 5,233 Vitest tests pass on the Windows PC, and 2 skip there (a folder name with an ESC in it, and a link to a file, which Windows won't let this account make). CI runs on Ubuntu, macOS, and Windows with Node 22 and 24 (six jobs), plus a replay smoke test, which now also writes a walkthrough file and repeats it, shares the demo fixture's runs and builds the website from them, and `voicecap verify`.
- **On macOS today,** `setup`, `doctor`, and `init` prepare and check a Mac for VoiceOver, down to a live test that starts it, and everything that doesn't drive a screen reader works. `voicecap share`, the Word copy, `voicecap walkthrough`, and `voicecap site` need no screen reader, so they work on a Mac as on any computer. A run with VoiceOver waits for the VoiceOver driver, the next piece of Phase C: `init` ends with "voicecap can't run VoiceOver yet: that comes with its VoiceOver driver. For now, run this command on a Windows computer." A walkthrough repeats on a Mac with VoiceOver once that driver exists. Until then, repeat it on a Windows computer, with NVDA.
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
- **A demo site with known content**, for `voicecap demo` (`docs/superpowers/specs/2026-09-29-demo-design.md`): `demo/site/`, served on 127.0.0.1 by `src/demo/server.ts`. Seven short pages whose text explains voicecap: six built well, and `/common-mistakes/`, with a level 2 first heading, a text field and an icon button with no names, and three "click here" links. It's the VoiceOver driver's test site. Once the driver clears the Mac's `cannotRunYet`, `voicecap demo` runs its whole tour on the Mac with no change to the tour. The pages' wording, and the flags they raise (`headings`, `unlabeled`, `generic-link-text`), assume NVDA's English phrasing; VoiceOver's phrasing for the flags comes with the driver.

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
- **Repeats from a walkthrough file:** the comparison after a repeat (`compareWithOriginal`, in `src/share/walkthrough.ts`) sets each pass's fingerprint against the original's, whichever screen reader made it. A repeat with VoiceOver of an NVDA walkthrough will say every page sounds different, with both screen readers named among what differs ("VoiceOver … (was NVDA …)"). It shows that the same pages were covered, and no more, as the spec says.

`docs/phase-b-handoff.md` ("Facts that turned out differently") covers what surprised us with NVDA. Most of it has a VoiceOver counterpart to check:
- a browser launched by Playwright fakes focus, so the driver launches Chrome itself and attaches over CDP;
- every page load gets a fresh browser;
- Guidepup's own signal handlers are detached, so the screen reader is stopped exactly once;
- a window in front that keeps changing (a terminal animating in VS Code) keeps the screen reader talking, so the driver raises the browser first.

## Open questions for the owner

1. **Which browser:**
   - Safari is VoiceOver's natural partner, but Playwright can't drive real Safari.
   - Chrome reuses Phase B's launch-and-attach code. Earlier lean: Chrome, settled by the spike.
2. **Configuration:** `driver: "auto"` as the default (Windows: NVDA; macOS: VoiceOver; elsewhere: a clear message pointing to replay)? And does `guidepup` keep meaning NVDA?
3. **Run folder names:** should they name the screen reader (`2026-09-27/1102_nvda/`)? Every run already records it inside; the earlier lean was no. Decide before real audit runs accumulate.
4. **Real VoiceOver in CI:** Guidepup has a GitHub Action that sets up VoiceOver on GitHub's macOS runners. Check it.
5. **The environment record:** which VoiceOver settings to record (voice, rate, verbosity), as NVDA's non-default settings are.
6. **The browser window's size:** runs record a 1280 × 960 browser window for every session that isn't a replay (`src/run/audit.ts`, from `BROWSER_WINDOW` in `src/drivers/types.ts`), which is the Chrome window voicecap opens. The VoiceOver driver must open its browser at that size, or carry its own window size in its environment info.

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

Throwaway spike code (kept outside the repository, in `../voicecap-phase-c-spike/`, with its results and logs) drove real VoiceOver through Guidepup over the fixture site, from VS Code's terminal. Setup: macOS 26.6.2, VoiceOver 10 (build 993), Guidepup 0.34.0, Playwright's Chrome for Testing 153 (chromium-1243).

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
