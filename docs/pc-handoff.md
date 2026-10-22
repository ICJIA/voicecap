# PC handoff: the Guidepup 0.36.4 branch's checks, and r3.illinois.gov again

This file was written on the Mac on 2026-10-17, and brought up to date there on 2026-10-22 on the branch `guidepup-0.36`, for the next working session on the owner's Windows PC. Notes kept on the Mac don't travel, so everything the PC session needs is here. `docs/phase-c-handoff.md` has the full history, under "Where things stand".

## What changed on the Mac

The PC's last session was 0.19.0's, on 2026-10-15. Since then, on the Mac:

- **voicecap 0.20.0** was released on 2026-10-16 (plan 15). Every build of the website now writes `sites.json`: each site's current report, as JSON, for another website that links to the results.
- **docs.icjia.app,** ICJIA's documentation index (the private repository `ICJIA/icjia-docs`), shows an "NVDA Accessibility" card in each site's section, made from `sites.json` on every build. voicecap's Netlify "Deploy succeeded" notification calls the index's build hook, so a push to the transcripts repository refreshes the cards a minute or so after the website is published.
- **The transcripts repository** builds the website with 0.20.0: commit 0708195, made on GitHub from the Mac. The PC's copy doesn't have it yet.
- **The README's** "Why voicecap, and who it's for" opens with four parts for managers.

Then, on 2026-10-22:

- **The Mac moved to macOS 27** (27.0.1). 0.20.0's Mac checks call it "macOS 28" and fail it, and macOS 27 has no VoiceOverStarter, which started VoiceOver until then.
- **The branch `guidepup-0.36`** moves to Guidepup 0.36.4 and `@guidepup/setup` 0.29.3 for macOS 27, and drops the plain-folder rule for Guidepup's NVDA (the owner's choice). It's pushed, and CI passes, but it isn't merged or released: it needs the PC's checks first (below).
- **The Mac's live test now passes or fails by chance.** Guidepup's start restarts macOS's preferences daemon twice, and launchd holds the daemon back for 10 seconds, which VoiceOver's start doesn't survive within Guidepup's 5-second limits. The fix belongs in Guidepup: `docs/guidepup-cfprefsd-issue-draft.md` is a draft issue for the owner to file. NVDA isn't affected.

## How to start

On the PC, in PowerShell or Windows Terminal (not Git Bash's own window):

1. In the voicecap folder, switch to the branch, then install and build it:

   ```
   git fetch
   git checkout guidepup-0.36
   git pull
   pnpm install
   pnpm build
   ```

   `pnpm install` brings Guidepup 0.36.4. It uses the same NVDA build as 0.34.0 (0.2.1-2026.2), so no new NVDA downloads.

2. In the transcripts home, before anything is run or shared, pull 0708195. Without it, the next push is refused:

   ```
   cd $env:VOICECAP_TRANSCRIPTS
   git pull
   ```

3. From there, check the version: `npx @icjia/voicecap@0.20.0 --version` prints `0.20.0`. Run the npx commands below from the transcripts home, not the voicecap folder: inside voicecap's own folder, npx finds that folder's package and says `voicecap` isn't a command.

Then start from this brief:

> I'm back on the Windows PC to continue voicecap, on the branch `guidepup-0.36`. Read `docs/pc-handoff.md` first, and follow the "Working rules" in `docs/phase-c-handoff.md` exactly. Don't start NVDA, or run anything that starts a screen reader, until I say so.

## Working rules

All of the owner's standing rules are in `docs/phase-c-handoff.md` ("Working rules"). These matter most here:

- **Real screen-reader runs only with the owner's OK.** Warn every time: hands off the keyboard and mouse, Do Not Disturb on, and the screen awake and unlocked.
- **Commit, push, or publish only when the owner asks.** Commit messages are one subject line, with no trailers of any kind.
- **Never use or repeat a password or PIN** pasted into the chat.

## First: the branch's checks, with NVDA

Each of these starts NVDA, so each needs the owner's OK, with the usual warning. They run the branch's build (`node dist/cli.js`), in the voicecap folder. `docs/phase-c-handoff.md` ("Still to check at the PC, before a release") lists what to watch for.

1. **`node dist/cli.js doctor`.** Its live test starts Guidepup 0.36.4's NVDA. Every check should pass, with no warning printed as NVDA starts or stops.
2. **A real run with NVDA:** `node dist/cli.js demo`, the guided tour, about 7 minutes hands off. Its files go in `voicecap-demo` (git ignores it), never in the transcripts home. Afterwards, check in Task Manager that no voicecap `nvda.exe` or Chromium is left, and that the owner's own NVDA is back as it was.
3. **NVDA from a folder whose path has a space and `&`.** In a new PowerShell window, in the voicecap folder:

   ```
   $env:GUIDEPUP_SCREEN_READERS_PATH = "C:\guidepup test & more"
   node dist/cli.js setup
   node dist/cli.js doctor
   ```

   setup installs NVDA there (about 100 MB), and doctor's live test starts NVDA from there. Then close that window, so nothing else uses the variable, and delete `C:\guidepup test & more`.
4. **Record the results** in `docs/phase-c-handoff.md` ("Guidepup 0.36.4, for macOS 27"). If all pass, a release is the owner's call: it fixes the Mac's checks on macOS 27, though the Mac's live test stays unreliable until Guidepup fixes its restarts.

## Next: r3.illinois.gov, read again with 0.20.0

This runs the published 0.20.0 through npx, from the transcripts home, so the branch checked out in the voicecap folder doesn't affect it.

The owner asked on 2026-10-16, on the Mac: "please also do a voicecap on r3.iillinois.gov", meaning r3.illinois.gov. It needs NVDA, so it waited for the PC.

- **Its current report** is the run of 2026-10-10 with 0.17.0, shared again with 0.18.0 on 2026-10-14 as entry 3. NVDA read all 25 pages, and 1 problem needs attention, on 1 page.
- **The run,** with the owner's OK and hands off. It takes the 2026-10-10 run's settings: all 25 pages from the sitemap, with the three passes, in Chrome. That run completed, so this command starts a new one:

  ```
  npx @icjia/voicecap@0.20.0 preflight
  npx @icjia/voicecap@0.20.0 --site https://r3.illinois.gov --sitemap https://r3.illinois.gov/sitemap.xml
  ```

  The owner answers the question at the end.
- **The share,** then the check:

  ```
  npx @icjia/voicecap@0.20.0 share --site https://r3.illinois.gov
  npx @icjia/voicecap@0.20.0 verify
  ```

- **When the owner says,** commit the transcripts home and push it. Its commit messages say what was run, such as "Run r3.illinois.gov again with voicecap 0.20.0, all 25 pages from its sitemap, and share it as entry 4". Netlify then builds voicecap.icjia.app, and its deploy rebuilds docs.icjia.app.
- **Afterwards,** `https://voicecap.icjia.app/sites.json` names the new report under r3.illinois.gov.
- **Record the run** in `docs/phase-c-handoff.md` ("Where things stand"), as the PC sessions have.

## r3's card on docs.icjia.app

r3.illinois.gov has no section on docs.icjia.app yet, so it has no card. The owner's rule: "i need to add it to docs first, then you can add the voicecap card". Once the owner has added r3's section to `docs.json` in `ICJIA/icjia-docs`, with `"url": "https://r3.illinois.gov"`, the card follows on the next build of the index, with nothing more to add. Until then, each build names r3.illinois.gov as a site with NVDA results and no section. The index's README has the rest ("NVDA Accessibility cards (from voicecap)").

## Also at the PC, when the owner wants

- **Still to confirm on a real PC** (`docs/phase-c-handoff.md`, "Being built"):
  - a Chrome window closed mid-page is recorded as `browser`;
  - a real repeat with NVDA, which should end with each page's comparison.
- **i2i.illinois.gov** will soon serve i2i's v3 (the owner, 2026-10-16). Until then, i2i's section on docs.icjia.app shows `v3--i2i.netlify.app`'s results. Once a run of i2i.illinois.gov itself is shared, the section shows that report instead, since a section shows the report shared last.
- **Two merged branches** are still on GitHub: `plan-15-sites-json` and `readme-why-voicecap`. Deleting them is the owner's call.
