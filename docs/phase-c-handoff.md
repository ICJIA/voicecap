# Phase C handoff: VoiceOver on the Mac

## Status: not started (written 2026-09-28, after 0.3.1)

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
- **Deferred minor findings** from the audit-record and `init` work (about 60, each with a reason) are in git-ignored ledgers on the Windows PC only: `.superpowers/sdd/2026-09-27-*/progress.md`.

## The goal

- **VoiceOver on macOS as a second screen reader, chosen by platform.** The owner asked for auto-detection: the same commands use NVDA on Windows and VoiceOver on the Mac.
- **NVDA stays the core.** In WebAIM's 2024 survey, JAWS was the main desktop screen reader for 40.5% of respondents, NVDA for 37.7%, and VoiceOver for 9.7%. VoiceOver is a second opinion: it catches different problems and covers Mac users.
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

## The Mac environment

- **Node 22.19 or later** (24 recommended), **pnpm 10** (`packageManager` pins 10.33.4), and Google Chrome.
- **Checks before changing anything:** `pnpm install`, `pnpm exec playwright install chromium`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- **The transcripts home is `~/webdev/voicecap-transcripts`**, with `export VOICECAP_TRANSCRIPTS=~/webdev/voicecap-transcripts` in `~/.zshrc` (README, "Setting it up"). If reviews are also recorded on the PC, pull before recording and push after: two machines adding reviews before syncing break the review chain, and `verify` reports it.
