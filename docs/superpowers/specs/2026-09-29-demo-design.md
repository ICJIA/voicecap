# voicecap demo: a guided first run against a demo site that ships with voicecap

Design approved in conversation on 2026-09-29, section by section. It builds on readiness (0.4.0): the preflight, the live test, and restoring the person's own screen reader. It depends on the sitemap-name change (`--sitemap sitemap.xml`, read relative to `--site`), which is being built separately. The VoiceOver driver (Phase C, sub-project 2) later switches on the Mac's audit step.

## Why

Someone using voicecap for the first time has no safe, known site to learn on. Pointing it at a live agency site to learn is slow and confusing, because real problems mix with learning. The README explains every step, but watching them happen teaches faster:
- the checks;
- a screen reader reading pages;
- the transcripts saved;
- the report built.

A small demo site with known content is also a stable target. It can check a new computer end to end, and later it serves as the VoiceOver driver's test site.

Success:

- **On a ready Windows PC,** `npx @icjia/voicecap demo` walks a first-time user from the checks to an opened report in about 5 minutes. It explains each step, with nothing else to install or find.
- **On a Mac,** the tour checks the Mac and proves VoiceOver works. It flags a Windows PC as the preferred tour platform for now, up front and in the preflight, and it ends with clear next steps.
- **The report shows exactly the intended flags.** They're on the "Common mistakes" page, and there are none on the other six.
- **Nothing is left running** when the tour ends, however it ends. The person's own screen reader is back as it was.

## Decisions

| Question | Decision |
| --- | --- |
| The command | `npx @icjia/voicecap demo`. |
| Self-contained | The demo site ships inside the npm package and is served on this computer. Nothing is hosted or downloaded. |
| Approach | **One process.** The tour reuses what `init`, `doctor` and runs already use: the preflight, the live test, `runAudit`, and the live report. At each step it shows the equivalent command, so people learn the real ones. |
| Pacing | **Step by step.** Seven steps, each explained, each waiting for Enter. Ctrl+C at any pause ends the tour cleanly. |
| The site | Seven pages whose text narrates the tour. Six are well built. One, "Common mistakes (on purpose)", has mistakes voicecap flags. `/sitemap.xml` and `/robots.txt` sit at the root. |
| The Mac, until the VoiceOver driver exists | Steps 1–3 are real: the welcome, the Mac's checks, and the VoiceOver live test. Step 4 explains that the audit comes with the VoiceOver driver, and that a Windows PC runs the full tour. Steps 5 and 6 are skipped; step 7 follows. The welcome and the preflight both flag a Windows PC as the preferred tour platform for now. |
| The Mac, later | The tour runs step 4 whenever the platform's `cannotRunYet` is empty, the same signal `init` uses. The VoiceOver driver clears it, and the Mac then does the whole tour with no change to the tour itself. |
| Where files go | A `voicecap-demo/` folder in the current folder. It never writes into a `VOICECAP_TRANSCRIPTS` audit record. |
| A recorded replay for the Mac | Not included. It was considered, and the owner chose to wait for the driver. |

## What someone sees

### On a ready Windows PC

Abridged. Each "Press Enter" line waits.

```
$ npx @icjia/voicecap demo

voicecap demo: a guided first run

Step 1 of 7 · Welcome
voicecap drives a real screen reader through a website's pages and saves what it says, so you
can hear what a screen reader user hears. This tour runs it against a small demo site on this
computer, using NVDA. It takes about 5 minutes. In step 4, NVDA speaks and takes over the
keyboard for about 3 minutes.

Press Enter for step 2 (checking this computer), or Ctrl+C to stop here.

Step 2 of 7 · Checking this computer
Before voicecap touches a screen reader, it checks this computer can run one. On its own,
that's: npx @icjia/voicecap doctor

voicecap preflight, 2026-09-29 14:05
[this computer's details and the checks, exactly as init shows them]
Ready: this computer can run NVDA for voicecap.

Press Enter for step 3 (the 20-second live test), or Ctrl+C to stop here.

Step 3 of 7 · The live test
The live test takes about 20 seconds. NVDA speaks and takes over the keyboard, so keep your hands off.
[the live test's checks]

Press Enter for step 4 (auditing the demo site, hands off for about 3 minutes), or Ctrl+C to stop here.

Step 4 of 7 · Auditing the demo site
The demo site is running at http://127.0.0.1:4848. voicecap is now running:
  npx @icjia/voicecap --site http://127.0.0.1:4848 --sitemap sitemap.xml --out voicecap-demo --fresh
For about 3 minutes, NVDA speaks and takes over the keyboard: keep your hands off. To stop
early, click this terminal window first, then press Ctrl+C.
[a normal run's progress lines]

Press Enter for step 5 (the transcripts), or Ctrl+C to stop here.

Step 5 of 7 · The transcripts
Saved in voicecap-demo/127.0.0.1_4848/2026-09-29/1405/pages/, one folder per page, each with
read.txt, headings.txt, and tab.txt: what NVDA said in each pass.
What NVDA said on the home page (read.txt, the first 5 lines):
  [the lines]

Press Enter for step 6 (the report), or Ctrl+C to stop here.

Step 6 of 7 · The report
voicecap-demo/127.0.0.1_4848/report.html shows every page, what each pass captured, and flags
that point to pages worth a closer listen.
Flags: 3 on /common-mistakes/ (unlabeled, generic-link-text, headings), none on the other pages.
Open the report now? [Y/n]

Step 7 of 7 · Your own site
To set up a run on your own site: npx @icjia/voicecap init
Tips: turn on Do Not Disturb, so notifications don't interrupt NVDA. To stop a run, click the
terminal window first (the browser is in front), then press Ctrl+C.
The demo's files are in voicecap-demo/. They're safe to delete.
```

The command in step 4 is the exact equivalent of what the tour runs. It works only while the demo site is running, and step 4 says so if asked.

### On a Mac, until the VoiceOver driver exists

- **Step 1 flags a Windows PC up front.** It adds: *"For now, a Windows PC runs the full tour. On this Mac, the tour checks the Mac and runs the VoiceOver live test (steps 1–3). The audit, the transcripts, and the report (steps 4–6) come with voicecap's VoiceOver driver, in a later release."*
- **Step 2's preflight flags it too.** The checks list gets one line from the tour, after the Mac's own checks. It's a warning, so it doesn't make the Mac "not ready":

  ```
  WARN  The full demo runs on a Windows PC for now: on this Mac, the tour stops after the live test
  ```

  The verdict is the Mac's usual one: *"Ready: this computer is set up for VoiceOver, but voicecap can't run VoiceOver yet: that comes with its VoiceOver driver."*
- **Step 3 is the real VoiceOver live test.**
- **Step 4** says: *"voicecap can't run VoiceOver yet: that comes with its VoiceOver driver. On a Windows PC, `npx @icjia/voicecap demo` runs this step and the next two: NVDA reads the seven demo pages, voicecap saves the transcripts, and builds the report."* The demo site isn't started.
- **Steps 5 and 6 are skipped.** "Press Enter for step 7" follows step 4.
- **Step 7** gives the Mac's next steps. `npx @icjia/voicecap setup` and `doctor` keep the Mac ready. `npx @icjia/voicecap init` sets up a run on your own site, and composes the command to run on a Windows PC.
- **The tour exits 0:** it did what a Mac can do today.

The flag appears only where the preflight can pass but `cannotRunYet` is set: a Mac today. On Linux, the preflight's own FAIL explains it instead.

### On Linux

Step 2's preflight is "Not ready". The Linux check says voicecap drives NVDA on Windows and VoiceOver on macOS. The tour stops there with exit code 2.

## The demo site

Seven pages. Their text is the tour's narration: as the screen reader reads each page, the transcript itself explains how voicecap works.

| Page | Says and shows |
| --- | --- |
| `/` Welcome | What the tour is, and a navigation list of its steps. |
| `/before-you-start/` | What `setup` and `doctor` do, and what they check. |
| `/how-a-run-works/` | The three passes (read, headings, tab), each under its own heading. |
| `/reading-transcripts/` | What's in a page's folder, with a short example. |
| `/the-report/` | Coverage, flags, and reviews. |
| `/ask-a-question/` | A well-built form: labeled fields, a required field with a hint (`aria-describedby`), a radio group in a `fieldset` with a `legend`, and a submit button. Nothing is ever sent: the server answers a submission with a short "Nothing was sent: this is a demo" page, which isn't in the sitemap. |
| `/common-mistakes/` | Titled "Common mistakes (on purpose)". Its first heading is level 2, which raises voicecap's `headings` flag. A search box with no label and an icon button with no name raise `unlabeled`. Three "click here" links raise `generic-link-text`. After each mistake, one sentence says what's wrong and what the screen reader said. |

**Every page except the last is built well:**
- `lang="en"` and a unique `<title>`;
- a skip link, and header, nav, main, and footer landmarks;
- one `h1`, with headings in order;
- descriptive links;
- one shared stylesheet in voicecap's navy and amber, with high contrast.

**The site is plain HTML and CSS,** with no scripts and no build step.

**`/sitemap.xml`** is a `urlset` of the seven pages with absolute URLs. **`/robots.txt`** allows everything and names the sitemap. The server generates both from the address it's actually serving, so any port works.

**Timing.** The target is about 3 minutes for all seven pages with NVDA, and about 5 minutes for the whole tour.

The pages' wording, and the flags, assume NVDA's English interface, as voicecap's flag rules do.

## Components

| Unit | Does | Built on |
| --- | --- | --- |
| `demo/site/` | The seven pages and the stylesheet. `package.json`'s `files` adds `demo`, so they ship. `publish.sh`'s packed-files check already allows it. | Plain HTML and CSS. |
| `src/demo/server.ts` | Serves `demo/site/` on 127.0.0.1: port 4848 if it's free, else any free port. It generates `/sitemap.xml` and `/robots.txt`, answers a form submission, gives a 404 page, and stops when asked. | Node's `http`, like `scripts/serve-fixture.ts`. The fixture server may reuse its static-file part instead of keeping two copies. |
| `src/demo/tour.ts` | The seven steps and their wording. The platform's readiness, the prompter, the run, the file opener, and the clock are injected, so tests fake them all. | `loadPlatformReadiness`, `runPreflight` and the renderers for step 2; the platform's `liveTest` for step 3; `runAudit` for step 4, with the demo's origin, `sitemap: "sitemap.xml"`, `out: "voicecap-demo"` and `fresh: true`; the run folder and the live report for steps 5 and 6. |
| Step 4's run | The run doesn't repeat the checks step 2 has just done. | A `runAudit` option, or an equivalent the plan settles. |
| The demo flag | A WARN check line added by the tour on a platform whose preflight can pass while `cannotRunYet` is set. | The readiness model (`Check`). It's the tour's own line, not a platform check. |
| Opening the report | "Open this file" per platform: `open` on a Mac, Explorer on Windows, `xdg-open` on Linux, with no shell. | A small module in `src/drivers/`, so OS specifics stay in the driver layer. Tests fake it. |
| `src/cli/main.ts` | The `demo` command. It needs a terminal, and has the same test seams as `init` and `doctor` (`platformReadiness`, `platform`), so no test reaches a real screen reader or opens a real file. | The existing CLI wiring. |

## Errors, interruptions, and exit codes

| Situation | What happens | Exit |
| --- | --- | --- |
| Ctrl+C at any "Press Enter" pause | Stops: *"Stopped. Nothing is left running."* | 130 |
| Ctrl+C or a closed window during the live test or the audit | The existing cleanup runs: the browser closes, and the screen reader is put back with the person's own settings. Then the demo site stops. Step 4's warning says to click the terminal first, since the browser is in front. | 130 |
| Not ready at step 2 | The numbered diagnosis, which says when `setup` helps, then *"When this computer is ready, run `npx @icjia/voicecap demo` again."* The demo site hasn't started. | 2 |
| The live test fails | Its problems, as `init` shows them. The tour stops, since an audit would fail the same way. | 2 |
| A page fails during the audit | As in any run: it's recorded, and the run goes on. Steps 5 and 6 point it out. | 3, as for a run |
| The audit can't run (a driver error) | The error, then the demo site stops. | 2 |
| Port 4848 is busy | Any free port instead. It isn't an error. | — |
| An earlier `voicecap-demo/` exists | A new run goes beside the old ones, as in any transcripts folder. | — |
| No terminal (piped or scripted) | *"voicecap demo is interactive: run it in a terminal."* | 1 |
| The tour finished | | 0 |

The demo site always stops when the tour ends, however it ends.

## Tests

- **The tour, with fakes, and no real screen reader, browser, network or file opener:**
  - **Windows:** all seven steps in order. Step 4's command matches what's run. `runAudit` gets the origin, `sitemap.xml`, `voicecap-demo` and `fresh`. The report is offered, and "yes" calls the opener.
  - **Mac:** step 1's flag and step 2's WARN line. The live test runs. Step 4 explains; steps 5 and 6 are skipped. The server never starts, `runAudit` is never called, and the exit is 0.
  - **Linux:** Not ready, and exit 2.
  - **Ctrl+C at each pause:** exit 130, with the server stopped when it had started.
  - **No terminal:** exit 1.
  - **Other endings:** a failed live test exits 2; a page failure exits 3 after steps 5 and 6.
- **The server:**
  - it takes port 4848 when free, and falls back when it isn't;
  - `/sitemap.xml` lists the seven pages with the real origin;
  - `/robots.txt` names the sitemap;
  - it answers a POST, and gives a 404;
  - it's stopped after `close()`.
- **The site,** with axe in Chromium, using the setup `test/report-a11y.test.ts` already uses in CI:
  - every page in the sitemap exists;
  - the six good pages have no violations;
  - `/common-mistakes/` has exactly `label`, `button-name`, and `page-has-heading-one`.
- **Safety:** as for readiness, no CLI test reaches real readiness, a real run, or the real opener.

**By hand on the Windows PC:** `npx @icjia/voicecap demo` from start to finish. Check the timing, the opened report, and that the flags appear on `/common-mistakes/` and nowhere else.

## Documentation

- **The README:** a short "Try it first: `npx @icjia/voicecap demo`" section right after the Quick start, including what a Mac does today.
- **The CHANGELOG:** an Added line.
- **The Phase C handoff:** the demo site as the VoiceOver driver's test site.

## Not included

- A recorded replay for the Mac (considered; the owner chose to wait for the VoiceOver driver).
- Hosting the demo site publicly.
- A `--quick` mode (the owner chose step by step).
- Running the tour from a script: it needs a terminal.
- VoiceOver phrasing for the flags. That's part of the VoiceOver driver work.
