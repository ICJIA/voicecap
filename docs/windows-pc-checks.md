# Windows PC checks: `voicecap demo` and readiness (before 0.5.0)

This file was written on the Mac on 2026-09-29, for a Claude Code session on the owner's Windows PC. Notes kept on the Mac don't travel, so everything the PC session needs is here.

`voicecap demo` (the guided first run) and readiness (0.4.x) have both been built, reviewed, and tested with fakes, and CI passes on Windows. The checks below need a real Windows PC with NVDA. They're what stands between `main` and a 0.5.0 release.

## How to start

On the PC, in the voicecap folder, run:

```
git pull
pnpm install
pnpm build
```

Then start Claude Code there and paste:

> I'm on the Windows PC to run the checks in `docs/windows-pc-checks.md` for voicecap. Read that file first, and follow its working rules exactly. Also read `docs/phase-c-handoff.md` ("Still to check by hand"). Don't start NVDA, or run anything that starts a screen reader, until I say so. Then we'll go through the checks together.

## Working rules

These are the owner's standing rules:

- **Real screen-reader runs need the owner's OK.** They take over the keyboard and speech. Warn every time: hands off the keyboard and mouse, Do Not Disturb on, and the screen awake and unlocked.
- **Commit, push, or publish only when the owner asks.** Before merging to `main`, check CI on a pushed branch.
- **Never add a `Co-Authored-By`, `Claude-Session`, or any other AI trailer** to a commit message.
- **Never use or repeat a password or PIN pasted into the chat.** A fresh npm 2FA code, given at publish time, is the only exception.
- **Never write that voicecap doesn't replace screen reader testing.**
- **Ask before working around how Guidepup or NVDA actually behave.** Keep screen-reader specifics in the driver layer and the config.

## Part 1: `voicecap demo`

Use PowerShell or Windows Terminal, not Git Bash's own window (mintty), which doesn't always let Node see a terminal. Run each check from the voicecap folder, as its own run of:

```
node dist/cli.js demo
```

**What happens.** The tour has seven steps, each waiting for Enter. In step 3, a 20-second live test, and in step 4, the audit, NVDA speaks and takes over the keyboard: hands off. The audit is estimated at about 6 minutes, and the whole tour at about 9. If your own NVDA is running, voicecap turns it back on afterwards. The demo writes to a `voicecap-demo/` folder, which git ignores.

1. **Timing.** Time step 4, and the whole tour. They're estimated at 6 and 9 minutes: `AUDIT_MINUTES` and `TOUR_MINUTES` in `src/demo/words.ts`.
2. **Flags.** Step 6 offers to open the report. Check that it flags `/common-mistakes/`, with `headings`, `unlabeled`, and `generic-link-text`, and no other page.
3. **Ctrl+C.** In another run, during step 4:
   - click the terminal window, since the browser is in front and gets the keyboard;
   - press Ctrl+C once.

   Expect *"Stopping: shutting down NVDA and the browser. This can take a minute."* NVDA should then come back as it was, and the tour should exit.
4. **Closing the window.** In another run, close the terminal window during step 4. Then, in Task Manager, check that no voicecap `nvda.exe` or Chromium is left running, and that your own NVDA is back as it was.

**If the timings are off:** change the two constants in `src/demo/words.ts`, and the tests that quote them (`test/demo-words.test.ts`). Also change the README's two numbers ("Try it first") and the spec's (`docs/superpowers/specs/2026-09-29-demo-design.md`: the example, and the "Timing" paragraph).

## Part 2: the readiness checks

These run with the same build: `node dist/cli.js doctor`, `init`, or `setup`. Most output ends up in `doctor`'s report.

1. **A Guidepup folder with an accented letter in its path.** voicecap accepts accented letters; it refuses only spaces, `& ( , ; = ^`, and `%NAME%`.
   - Set `GUIDEPUP_SCREEN_READERS_PATH` to a folder such as `C:\guidepup-é`.
   - Run `node dist/cli.js setup` to install Guidepup's NVDA there, then `node dist/cli.js doctor`, whose live test starts NVDA from that folder.
   - Check that NVDA starts at all.
   - Check that the report shows the path without garbled characters.
   - Check that voicecap tells Guidepup's NVDA from your own: no false "Your NVDA is running".
2. **Whether Windows reports the installed NVDA's path.** With your installed NVDA running, run `node dist/cli.js doctor`. The warning reads one of two ways:
   - "voicecap will use its own NVDA, then turn yours back on" means the path was found;
   - "Afterwards, start yours again the way you usually do" means Windows hid it.

   Record which. An NVDA with UIAccess may hide it.
3. **The computer's model and browser.** In `doctor`'s machine info, the Model and Browser lines should show this PC's real model and Chrome's real version.
4. **Your installed NVDA coming back after a run**, including one that uses UIAccess.
   - With your NVDA running, do a real run: the demo, or a one-page audit such as `node dist/cli.js --site https://dvfr.illinois.gov --page https://dvfr.illinois.gov/ --fresh`.
   - Afterwards it should say "Turned your NVDA back on", and NVDA should be running.
5. **How long the quick checks take.** Time the checks at the start of `node dist/cli.js init`, or `doctor` before its live test, against the README's "about two seconds".
6. **Closing the window during `init`'s live test.**
   - Run `node dist/cli.js init` and answer y to "Test NVDA now?".
   - Close the terminal window during the test.
   - Then check, as in Part 1's check 4, that nothing voicecap started is left running and your own NVDA is back.

## Recording the results

Add a dated "Windows checks" section to `docs/phase-c-handoff.md`, with one line per check: passed, or what happened. If something fails, stop and design the fix with the owner before changing code.

## Then, when the owner says: releasing 0.5.0

Before a release:
- **The CHANGELOG** doesn't mention `runAudit`'s new public options `again` and `preflight`. Add them under "Programmatic API", or mark them internal.
- **Optional:** the small items parked in `docs/phase-c-handoff.md` ("Deferred from the `voicecap demo` reviews"), such as the Ctrl+D message landing on the prompt's line.

The owner's release steps:

1. Commit and push the changes. Check CI on a pushed branch, merge to `main`, and push `main`.
2. Move `[Unreleased]` in `CHANGELOG.md` to `## [0.5.0] - <date>` (keeping an empty `[Unreleased]` above it), update the links at the bottom, commit as "Prepare 0.5.0: the changelog", push, and wait for CI on `main`.
3. Run `./publish.sh --dry-run minor`. It checks everything and publishes nothing.
4. Run `npm version minor --no-git-tag-version`, then ask the owner for a fresh 2FA code.
5. Run `npm publish --access public --ignore-scripts --otp <code>` right away.
6. Commit `package.json` as "Release v0.5.0", add an annotated tag with `git tag -a v0.5.0 -m "voicecap 0.5.0"`, then push `main` and the tag.
