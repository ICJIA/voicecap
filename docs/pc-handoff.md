# PC handoff: after the Guidepup 0.36.4 checks and r3.illinois.gov's entry 4

This file was brought up to date on the PC on 2026-10-22, at the end of that day's session, on the branch `guidepup-0.36`, for the next working session on the owner's Windows PC. Notes kept on one computer don't travel to the other, so everything the next session needs is here. `docs/phase-c-handoff.md` has the full history, under "Where things stand".

## What the PC did on 2026-10-22

- **The branch `guidepup-0.36` passed its checks with NVDA,** each with the owner's OK and hands off: `doctor`, NVDA from `C:\guidepup test & more` (`setup`, then `doctor`), and the demo. `docs/phase-c-handoff.md` ("Checked at the PC") has what each showed.
- **A stop that fails no longer fails every later start in a run.** Guidepup 0.36 counts its NVDA as still running after a stop whose quit timed out, and refuses to start another ("NVDA is already running"), so after one such stop every later page of the run would fail to start NVDA. The adapter's start now stops that NVDA again, once, and starts. It was settled under the owner's standing rule to take the recommended option, for the owner to confirm or reverse.
- **r3.illinois.gov was read again with 0.20.0** (run 2026-10-22_1318), shared as entry 4, and pushed (transcripts 15e4729). It's live, byte for byte, and `sites.json` names it.
- **0.20.1 is prepared on the branch:** its CHANGELOG entry, dated 2026-10-22. It's a patch, as 0.18.1 was: a dependency upgrade and fixes, with no new feature. It isn't merged or released.

## How to start

On the PC, in PowerShell or Windows Terminal (not Git Bash's own window):

1. In the voicecap folder, bring the code up to date, then install and build it. Until 0.20.1 is released, the code is on the branch `guidepup-0.36`; afterwards, it's on `main`.

   ```
   git fetch
   git checkout guidepup-0.36
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

## Next: release 0.20.1, when the owner says

The release is the owner's call. It can be made from the PC or the Mac, with the owner's npm code at the release script's prompt, as for earlier releases.

1. Check that CI passed for the branch's last commit, and that `npm whoami` answers. If it doesn't, the owner logs in to npm first.
2. Bring `main` up to the branch, and push it. `main` is behind the branch with nothing of its own, so it moves without a merge commit, and CI's run for that commit counts for the release:

   ```
   git checkout main
   git pull
   git merge --ff-only guidepup-0.36
   git push origin main
   ```

3. `./publish.sh --dry-run patch`, then `./publish.sh patch`. The script checks everything again, then asks for the version and for npm's code.
4. Once npm serves 0.20.1, set the build command in the transcripts repository's `netlify.toml` to `@0.20.1`, then commit and push it (the owner's standing OK).
5. Record the release in `docs/phase-c-handoff.md` ("Where things stand").

## Also at the PC, when the owner wants

- **Delete `C:\guidepup test & more`** after quitting VS Code. VS Code still has two of NVDA's files from that folder loaded, so Windows won't delete it while VS Code runs.
- **r3's card on docs.icjia.app.** r3.illinois.gov has no section on docs.icjia.app yet, so it has no card. The owner's rule: "i need to add it to docs first, then you can add the voicecap card". Once the owner has added r3's section to `docs.json` in `ICJIA/icjia-docs`, with `"url": "https://r3.illinois.gov"`, the card follows on the next build of the index, with nothing more to add. The index's README has the rest ("NVDA Accessibility cards (from voicecap)").
- **Not yet tried at the PC with Guidepup 0.36** (each needs a real run, with the owner's OK): a connection to NVDA that fails with an error, voicecap's process ending in the middle of a run, and a stop that fails.
- **Still to confirm on a real PC** (`docs/phase-c-handoff.md`, "Being built"):
  - a Chrome window closed mid-page is recorded as `browser`;
  - a real repeat with NVDA, which should end with each page's comparison.
- **i2i.illinois.gov** will soon serve i2i's v3 (the owner, 2026-10-16). Until then, i2i's section on docs.icjia.app shows `v3--i2i.netlify.app`'s results. Once a run of i2i.illinois.gov itself is shared, the section shows that report instead, since a section shows the report shared last.
- **Dependabot:** nine open pull requests (from 2026-10-06 and 2026-10-13), and three alerts on vite (development only, through vitest; fixed in vite 8.3.3, which none of the pull requests brings). The release script audits only what ships, so none of them blocks a release. They're worth one pass together, with the owner deciding axe-core 4.14.0, which can change what axe finds on a page, and the three GitHub Actions moves to new major versions. `@guidepup/setup` 0.29.2's pull request is replaced by the branch's 0.29.3.
- **Merged branches** still on GitHub: `plan-15-sites-json` and `readme-why-voicecap`, and `guidepup-0.36` once it's released. Deleting them is the owner's call.
