# Handoff: running voicecap from here

This file was written on 2026-10-24, on the owner's Mac, as the closing handoff, after the owner set Phase C aside and chose to wrap voicecap up (`docs/phase-c-handoff.md`, the note at its top, has the decision and its reasons). It's for whoever runs voicecap from here, on the owner's Windows PC: how to read a site and share it, what to do when something updates, where everything is, and the loose ends left open on purpose. `docs/phase-c-handoff.md` ("Where things stand") has the full history.

## What voicecap is, and where it stands

voicecap takes NVDA through every page of a website, saves every word it says as transcripts with a recording of its voice, runs axe on each page, and keeps a sealed record of it all. A share of a run is published at **https://voicecap.icjia.app**, and docs.icjia.app shows a card for each site from it. The point is due diligence: managers, auditors, and lawyers get the address and the records, a trail that a real screen reader read every single page, with the problems it found and what was done about them.

- **The Windows PC is voicecap's focus.** Audits run there, with NVDA and Chrome. The Mac prepares and checks itself for VoiceOver (`setup`, `doctor`, `init`) as groundwork, but no audit runs there: a Mac version may come later, if it's needed, and isn't part of voicecap now.
- **Released:** 0.24.0 is the latest (2026-10-28; see "Since then", below). 0.22.2 was the wrap-up release (see the CHANGELOG): recordings declare a whole-millisecond pre-skip, so Chrome 156 decodes them whole; every place that promised a VoiceOver driver says where audits run instead; and the step caps are 1,500 / 500 / 1,000 (read / headings / Tab), so a long page reads to its end without `--max-steps`.
- **Sites on the website:** sfs.icjia.illinois.gov, dvfr.illinois.gov, v3--i2i.netlify.app (i2i, until i2i.illinois.gov serves v3), and r3.illinois.gov (entry 5, 25 of 25 pages, nothing needing attention).

## Since then: 2026-10-28, on the Mac

Three releases, from the Mac at the owner's word, after a reader of the website found it hard to see each page's report and screenshot, and couldn't find the recordings:

- **0.23.0 and 0.23.1, the website.** Each site is a card of its own color (slate blue in the dark theme, pale teal in the light) for non-technical managers, in order of importance: the result (verdict, pages read, the day NVDA read them); three big tiles with pictures, "See all N pages" (every page with its screenshot), "Hear NVDA" (the voice page), and "Read the report"; the Word copy; and, after a line, the earlier reports and the files.
- **0.23.0, the voice page starts at 0.3×.** Pressing play slows it at once, the browser's way, and voicecap's clearer copy takes over from the same place when it's ready (about 2 s for a recording of 3.5 minutes).
- **0.24.0, the voice page is one to follow along with.** Each page's section has its screenshot, player, and speeds on the left, and its read, headings, and Tab transcripts on the right, in a box that scrolls on its own; nothing on the page leaves it while a recording plays. As it plays, the line NVDA is saying is outlined in yellow (each line's span from its pass's JSON, placed by the recording's stretch for that pass; checked against the sound of real recordings). The page's check now covers its transcripts and screenshots too.
- **The website builds with 0.24.0**, and sfs, dvfr, and r3 were shared again with it (sfs entry 9, dvfr 5, r3 7): the same runs and results, no new audio. A voice page is written when a site is shared, so a site shows a new voice page only once it's shared again.

## Next, on the PC: the forms trial, then i2i with its recording (written 2026-10-30)

0.24.1 is released, and the website builds with it. The forms pass is designed and planned (`docs/superpowers/specs/2026-10-30-forms-pass-design.md`, `docs/superpowers/plans/2026-10-30-forms-pass.md`), on the branch `forms-pass`. The owner's decisions: nothing a form sends ever leaves the browser, submission is assumed to work, the test is whether a form is accessible through NVDA and axe, and each form gets a definitive banner ("This form works with NVDA"), which is what the manager is looking for. It will be built with subagents, once the trial below is back.

**Each of these starts real NVDA, and only the owner starts it.** Keep hands off the keyboard and mouse while it runs.

1. **Get the branch:** `git fetch`, `git checkout forms-pass`, `git pull`, `pnpm install`.
2. **Run the trial:** `pnpm forms:trial`. It takes about 3 minutes, on two local pages, and nothing leaves the PC. It writes what NVDA said to `docs/forms-trial-notes.md`.
3. **Commit that file and push:** `git add docs/forms-trial-notes.md`, `git commit -m "Record the forms trial"`, `git push`. The answers decide how Tasks 1 to 9 are built.
4. **Read the new i2i with NVDA, with its recording:** in the transcripts home, `git pull`, then, with the released voicecap, on Windows 11:

   ```
   npx @icjia/voicecap@latest --site https://v3--i2i.netlify.app --pages page-lists/v3--i2i.netlify.app.csv
   ```

   32 pages, about an hour. Say yes when it asks whether you heard NVDA.
5. **Share and publish it:** `npx @icjia/voicecap@latest share --site https://v3--i2i.netlify.app`, then `git add -A`, commit, and push in the transcripts home. The site's card then says "Hear NVDA". To make the README's screenshots show the recording, `pnpm readme:screenshots` needs a run kept in `fixture/i2i-v3-run` that has one: leave that for the Mac, or a later day.

**Earlier list, 2026-10-28:**

1. **Read v3--i2i.netlify.app again with NVDA, and share it with 0.24.0 or later.** Its runs are all from 2026-10-06, before voicecap recorded NVDA's voice (0.18.0), so it has never had a recording, and its card says "No recording". The owner's manager wants an audio transcript of the site in progress now; it will be read again once it's i2i.illinois.gov. Only with the owner's OK, as every real run.
2. **The forms phase, a request of 2026-10-28, not started.** The owner's manager wants each site's forms tested with NVDA: voicecap should give pages with forms special emphasis, try the submit button, and read what keeps a form from being sent (a missing required field, say). It's a new pass in the driver, so design it first, with the owner (a brainstorm, then a spec and a plan), before any code. Questions to raise: never sending real data (press submit with the form empty only? stop on a success?), forms that send email or write records, CAPTCHAs, forms in several steps, how the report shows a form's result, and whether the recording covers the new pass.

## How to start

On the PC, in PowerShell or Windows Terminal (not Git Bash's own window):

1. In the voicecap folder, bring the code up to date, then install and build it. The code is on `main`.

   ```
   git fetch
   git checkout main
   git pull
   pnpm install
   pnpm build
   ```

2. In the transcripts home, pull, in case the Mac pushed:

   ```
   cd $env:VOICECAP_TRANSCRIPTS
   git pull
   ```

Then start from this brief:

> I'm on the Windows PC to run voicecap. Read `docs/pc-handoff.md` first, and follow the "Working rules" in `docs/phase-c-handoff.md` exactly. Don't start NVDA, or run anything that starts a screen reader, until I say so.

## Working rules

All of the owner's standing rules are in `docs/phase-c-handoff.md` ("Working rules"). These matter most here:

- **Real screen-reader runs only with the owner's OK.** Warn every time: hands off the keyboard and mouse, Do Not Disturb on, and the screen awake and unlocked.
- **Commit, push, or publish only when the owner asks.** Commit messages are one subject line, with no trailers of any kind.
- **Never use or repeat a password or PIN** pasted into the chat.

## Reading a site and sharing it

The routine, with the released voicecap (`npx @icjia/voicecap` fetches the latest release) or with a build of the code (`node dist/cli.js`):

1. **Check the PC:** `npx @icjia/voicecap preflight`. It starts nothing. `doctor` adds a 20-second live test with NVDA.
2. **Read the site:** `npx @icjia/voicecap init` asks the questions and prints the run's command, or run it directly, for example `npx @icjia/voicecap --site https://r3.illinois.gov`. A run resumes where it stopped when the same command is run again; `--page` reads one page again; `--walkthrough <file>` repeats a run page for page. At the end, the run's closing question ("heard NVDA?") seals it: answer it, or the run isn't sealed and can't be shared.
3. **Review what needs attention**, if anything does: `voicecap review` records a person's finding on a page, and `voicecap review --replay` reads the transcripts aloud with the computer's own voice.
4. **Share it:** `npx @icjia/voicecap share --site https://r3.illinois.gov` (the site's address) makes the dated shareable page, its Word copy, the voice page, the report as Markdown and JSON for AI tools, and the walkthrough file, and records the share in `share/shares.json`.
5. **Publish it:** in the transcripts home, `git add`, commit, and push. Netlify builds the website from `ICJIA/voicecap-transcripts` on every push (`netlify.toml` pins the voicecap version that builds it), and its "Deploy succeeded" notification calls docs.icjia.app's build hook, which reads `sites.json` and makes the cards. A site gets a card only in a section that already exists on docs.icjia.app; r3.illinois.gov still waits for its section (the owner adds it to `docs.json` in `ICJIA/icjia-docs` with `"url": "https://r3.illinois.gov"`, and the card follows).

**Pull before a share, push after.** Reviews and shares are chained to the ones before them; two computers adding to the record before syncing break the chain, and `voicecap verify` reports it.

**Checking a record:** `npx @icjia/voicecap verify` checks every fingerprint and chain in the home. The website publishes only files that still match their recorded fingerprints.

## When something updates

- **Chrome:** voicecap launches the installed Google Chrome with a fresh profile and attaches to it, so Chrome updates itself and voicecap follows. A Chrome that changes how it decodes a recording shows up in `test/voice-browser.test.ts` only when Playwright's bundled Chromium catches up (Chrome 156 did, in October 2026; fixed in 0.22.2).
- **NVDA:** voicecap runs Guidepup's own NVDA, installed by `voicecap setup` (through `@guidepup/setup`), never the person's. The person's NVDA is stopped for a run and started again afterwards. NVDA updates don't reach Guidepup's copy; Guidepup's releases do.
- **Guidepup** (`@guidepup/guidepup` 0.36.4 and `@guidepup/setup` 0.29.3, pinned): upgrade on a branch, as 0.20.1 did (`docs/phase-c-handoff.md`, "Guidepup 0.36.4"), and check at the PC with the owner's OK before a release: `doctor`, the demo, and a real run. Guidepup 0.36 changed how NVDA starts and quits.
- **axe-core** (4.14.0, pinned): a new version can change what axe finds. Before a release, compare the old and new on the demo site and on every page of the current runs, as 0.22.1 did, and say in the CHANGELOG what changed. Reports already shared keep their results.
- **Playwright** (1.63.0): its bundled Chromium runs the tests, not the audits. 1.64 (Chromium 156) is safe to merge now that 0.22.2's recordings decode whole in it.
- **Node:** 22.19 or later (24 recommended), pnpm 10 (`packageManager` pins 10.33.4).
- **Dependabot** opens pull requests weekly, for npm and for GitHub Actions. CI runs on each; the release script audits what ships (`pnpm audit --prod`). `vitest` and `vite` are development-only.

## Releasing, if there's ever a fix to release

`publish.sh` does it all, from `main`, once CI has passed there: `./publish.sh --dry-run patch`, then `./publish.sh patch`. It runs the checks (about 8 minutes), shows the commits since the last release, asks for the version to be typed, and asks for npm's 6-digit code just before it publishes (the owner's; it expires in about 30 seconds). It commits "Release vX.Y.Z", tags it, and pushes `main` and the tag. Afterwards, set the transcripts repository's `netlify.toml` to the new version (`npx --yes @icjia/voicecap@X.Y.Z site --home . --out _site`), commit, and push, under the owner's standing OK.

## Loose ends, left open on purpose

- **Never tried for real with Guidepup 0.36** (each needs a real run, with the owner's OK): a connection to NVDA that fails with an error, voicecap's process ending in the middle of a run, and a stop that fails (the adapter's "stop again, once" retry is tested only against a stand-in).
- **Still to confirm on a real PC:** a Chrome window closed mid-page is recorded as `browser`; a real repeat with NVDA ends with each page's comparison.
- **Plan 6d,** queued "eventually": an optional second reading of a page, compared with the first.
- **The step caps** were raised to 1,500 / 500 / 1,000 on the strength of r3's 78-row table (655 read steps). A page that needs more is listed as "The reading stopped before the page's end": run it again with `--page` and `--max-steps`.
- **i2i.illinois.gov** will serve i2i's v3; until a run of it is shared, docs.icjia.app's i2i section shows `v3--i2i.netlify.app`'s report (a section shows the report shared last).
- **The Mac's live test on macOS 27 passes or fails by luck:** Guidepup restarts macOS's preferences daemon twice at start, and launchd holds it back for 10 seconds (`docs/phase-c-handoff.md`, "Guidepup 0.36.4", and `docs/guidepup-cfprefsd-issue-draft.md`, a draft issue the owner can file or drop). It only matters if a Mac version is ever built.
- **The test folder on the PC,** `C:\guidepup test & more`: delete it after quitting VS Code, which keeps two of NVDA's files from it loaded.
- **Merged branches on GitHub** (`plan-15-sites-json`, `readme-why-voicecap`, `guidepup-0.36`): deleting them is housekeeping, nothing more.

## Where everything is

- **Code:** github.com/ICJIA/voicecap (public, MIT; the git remote still says `cschweda/voicecap` and redirects). Releases on npm as `@icjia/voicecap`. CI: GitHub Actions, six jobs (Ubuntu, macOS, Windows; Node 22 and 24) plus a replay smoke test.
- **Records:** the transcripts home (`$env:VOICECAP_TRANSCRIPTS` on the PC; `/Volumes/satechi/webdev/voicecap-transcripts` on the Mac), a clone of `ICJIA/voicecap-transcripts`, which Netlify builds into https://voicecap.icjia.app.
- **docs.icjia.app:** `ICJIA/icjia-docs` (private), built by Netlify; its `build.js` reads voicecap's `sites.json`.
- **The documents:** `README.md` (everything a person needs, including the technical details), `CHANGELOG.md` (every release), `docs/build-prompt.md` (the specification), `docs/plan.md`, `docs/superpowers/specs/` and `docs/superpowers/plans/` (each feature's design and plan), `docs/phase-b-handoff.md` and `docs/phase-c-handoff.md` (the history, with the owner's standing rules), `docs/windows-pc-checks.md`, and the two Guidepup issue drafts.
