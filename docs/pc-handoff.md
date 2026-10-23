# PC handoff: after 0.21.0's release

This file was brought up to date on the PC on 2026-10-23, after 0.21.0's release, for the next working session on the owner's Windows PC. Notes kept on one computer don't travel to the other, so everything the next session needs is here. `docs/phase-c-handoff.md` has the full history, under "Where things stand".

## What the PC did on 2026-10-22 and 2026-10-23

- **The branch `guidepup-0.36` passed its checks with NVDA,** each with the owner's OK and hands off: `doctor`, NVDA from `C:\guidepup test & more` (`setup`, then `doctor`), and the demo. `docs/phase-c-handoff.md` ("Checked at the PC") has what each showed.
- **A stop that fails no longer fails every later start in a run.** Guidepup 0.36 counts its NVDA as still running after a stop whose quit timed out, and refuses to start another ("NVDA is already running"), so after one such stop every later page of the run would fail to start NVDA. The adapter's start now stops that NVDA again, once, and starts. It was settled under the owner's standing rule to take the recommended option, for the owner to confirm or reverse.
- **r3.illinois.gov was read again with 0.20.0** (run 2026-10-22_1318), shared as entry 4, and pushed (transcripts 15e4729). It's live, byte for byte, and `sites.json` names it.
- **0.20.1 was released on 2026-10-23** (tag `v0.20.1`), at the owner's word. `main` moved to the branch's last commit without a merge commit, CI passed for it, and `publish.sh` published it with the owner's code at its prompt. It's a patch, as 0.18.1 was: a dependency upgrade and fixes, with no new feature. The website builds with it (transcripts 3448ca2).
- **A fix from r3's run is in it:** a run ends when its last session ended, as NVDA stopped reading, not when it was sealed. r3's question was answered hours after the reading, so entry 4's evidence gives the run as "13:18 to 19:11"; from 0.20.1 such a run reads "13:18 to 14:36". Entry 4 keeps its words, since a share is never rewritten.
- **r3.illinois.gov was read again on 2026-10-23** (run 2026-10-23_1204, `--max-steps 800`), at the owner's word, hands off: 25 of 25 pages, no problem found. Entry 4's one problem, the read pass's step cap on /documentation/accessibility/ (a table of 78 rows), is gone: the read reached the page's end in 655 steps. The run's closing question ("heard NVDA?") was still to be answered at the PC that evening, so it isn't sealed or shared yet.
- **0.21.0 was released on 2026-10-23** (tag `v0.21.0`), at the owner's word, with the owner's code relayed from the chat. Each page's card on the shareable page links to the page's recording, right under its name ("▶ Hear what NVDA said on this page"), as does each page listed in "What needs attention", and the Word copy says where each page's recording is; reports no longer carry voicecap's own timeline. It also upgrades zod to 4.6.7 for GHSA-mrhx-c7xc-m3w5, which `npm audit` found in the dry run. 7,896 tests passed; CI passed on all six jobs (one macOS job re-run after the AI Markdown test of hostile strings ran out of time).

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

> I'm back on the Windows PC to continue voicecap. Read `docs/pc-handoff.md` first, and follow the "Working rules" in `docs/phase-c-handoff.md` exactly. Don't start NVDA, or run anything that starts a screen reader, until I say so.

## Working rules

All of the owner's standing rules are in `docs/phase-c-handoff.md` ("Working rules"). These matter most here:

- **Real screen-reader runs only with the owner's OK.** Warn every time: hands off the keyboard and mouse, Do Not Disturb on, and the screen awake and unlocked.
- **Commit, push, or publish only when the owner asks.** Commit messages are one subject line, with no trailers of any kind.
- **Never use or repeat a password or PIN** pasted into the chat.

## Next, when the owner says

- **Share r3.illinois.gov as entry 5, from run 2026-10-23_1204.** First the owner answers the run's closing question in voicecap's own PowerShell window, which seals it. Then, in the transcripts home, `npx --yes @icjia/voicecap@0.21.0 share --site https://r3.illinois.gov`, then `verify`, then commit and push. It should say "Nothing needs attention", with a link to each page's recording on its card.

## Also at the PC, when the owner wants

- **Delete `C:\guidepup test & more`** after quitting VS Code. VS Code still has two of NVDA's files from that folder loaded, so Windows won't delete it while VS Code runs.
- **r3's card on docs.icjia.app.** r3.illinois.gov has no section on docs.icjia.app yet, so it has no card. The owner's rule: "i need to add it to docs first, then you can add the voicecap card". Once the owner has added r3's section to `docs.json` in `ICJIA/icjia-docs`, with `"url": "https://r3.illinois.gov"`, the card follows on the next build of the index, with nothing more to add. The index's README has the rest ("NVDA Accessibility cards (from voicecap)").
- **Not yet tried at the PC with Guidepup 0.36** (each needs a real run, with the owner's OK): a connection to NVDA that fails with an error, voicecap's process ending in the middle of a run, and a stop that fails.
- **Still to confirm on a real PC** (`docs/phase-c-handoff.md`, "Being built"):
  - a Chrome window closed mid-page is recorded as `browser`;
  - a real repeat with NVDA, which should end with each page's comparison.
- **i2i.illinois.gov** will soon serve i2i's v3 (the owner, 2026-10-16). Until then, i2i's section on docs.icjia.app shows `v3--i2i.netlify.app`'s results. Once a run of i2i.illinois.gov itself is shared, the section shows that report instead, since a section shows the report shared last.
- **Dependabot:** nine open pull requests (from 2026-10-06 and 2026-10-13), and three alerts on vite (development only, through vitest; fixed in vite 8.3.3). The release script audits only what ships, so none of them blocks a release. As checked on 2026-10-22:
  - #1 (source-map-js 1.2.2) is already in `main`'s lockfile, and #6 (`@guidepup/setup` 0.29.2) is replaced by the branch's 0.29.3, so both can be closed.
  - #7 (fast-xml-parser 5.11.2, which ships), #8 (vitest 5.0.3), and #9 (jszip 3.10.2, which only the tests use) are patch updates that passed CI on every system. After the release, Dependabot rebases them.
  - #5 (axe-core 4.14.0) can change what axe finds on a page, and #2 to #4 move three GitHub Actions to new major versions. Both are the owner's call.
  - None of them brings vite 8.3.3, and `pnpm update vite` leaves it at 8.3.1, so clearing the alerts takes an override (`overrides:` in `pnpm-workspace.yaml`), also the owner's call.
- **Merged branches** still on GitHub: `plan-15-sites-json` and `readme-why-voicecap`, and `guidepup-0.36`, released as 0.20.1. Deleting them is the owner's call.
