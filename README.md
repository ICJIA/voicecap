![voicecap: captures what a screen reader user actually hears on your website](https://raw.githubusercontent.com/ICJIA/voicecap/main/assets/og-image.png)

# voicecap

[![CI](https://github.com/ICJIA/voicecap/actions/workflows/ci.yml/badge.svg)](https://github.com/ICJIA/voicecap/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@icjia/voicecap)](https://www.npmjs.com/package/@icjia/voicecap)
[![Node](https://img.shields.io/node/v/@icjia/voicecap)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)

## voicecap in brief

voicecap is a free, open-source tool from the Illinois Criminal Justice Information Authority (ICJIA) that captures what a screen reader user actually hears on a website.

Automated accessibility checkers such as axe and Lighthouse catch problems like missing labels, but they can't tell you what a page sounds like. voicecap is the other half: a listen-through with a real screen reader, **NVDA on a Windows PC, and VoiceOver on a Mac**. The screen reader reads each page from top to bottom, jumps from heading to heading, and tabs through links and buttons, the way a blind visitor would, and voicecap saves every word it says as plain-text transcripts. On a Mac, setup, checks, and a live VoiceOver test work today, and full VoiceOver audits come with voicecap's VoiceOver driver.

Every line of a transcript is what the screen reader actually said. voicecap presses the screen reader's keys the way a person would, and moves from page to page on its own, following the site's sitemap or a list of pages. Working from the list, it accounts for every page on it: none is missed or done twice, an easy slip when clicking through a site by hand. So one person can spot-check a large site, zero in on the pages that need attention, or go through a whole small site.

It's a human review, sped up: voicecap does the key presses and the page turning, so the person running it can:

- listen along as the screen reader reads, then go back over exactly what it said, line by line;
- compare runs to see exactly what changed after an update;
- record what they found and what they fixed, and add their own hands-on NVDA sessions.

Everything goes into one record that voicecap never rewrites, summed up in an accessible HTML report, and `voicecap verify` checks that the recorded files still match what voicecap wrote.

voicecap makes screen reader testing faster, repeatable, and documented: https://github.com/ICJIA/voicecap

> **Status: what works where.**
>
> - **Windows:** everything, including full audits with NVDA and Chrome, checked end to end with real NVDA 2026.2 and Chrome 153.
> - **Mac:** `setup`, `doctor`, and `init` prepare and check a Mac for VoiceOver, down to a live test that starts it. Audits with VoiceOver come with voicecap's VoiceOver driver, in a later release; until then, run audits on a Windows computer.
> - **Any computer, Linux included:** reviews, reports, manual NVDA sessions, `list-urls`, `verify`, and replay runs, which play back a recorded run (`--replay-from`).

## How voicecap works

![How voicecap works: a human review, sped up. Six steps, each described in the list below, and three lines NVDA said on voicecap's demo site.](https://raw.githubusercontent.com/ICJIA/voicecap/main/assets/how-voicecap-works.png)

Automated checkers such as axe and Lighthouse read a page's code and test it against rules. voicecap is a human review, sped up: it takes a real screen reader through each page the way a person would and saves every word it says, while the person running it listens, reads the transcripts, and fixes what they find.

1. **Every page on the list.** voicecap works from the site's sitemap, or a list of chosen pages in a CSV or JSON file. Each page is read once, in full, or recorded with the reason it couldn't be. None is missed or done twice, an easy slip when clicking through a site by hand.
2. **The real screen reader.** voicecap runs NVDA itself, never a simulation, with a fresh browser for every page, so no page's results depend on the pages before it.
3. **Three ways through each page.** It presses NVDA's keys as a person would: Down Arrow to go line by line, H to go heading by heading, and Tab to go control by control.
4. **Every word, checked.** It saves each key press and everything NVDA said, in order, waiting until NVDA has been quiet for a second so nothing is cut off. Before and after every key press, it checks that the page still has the screen. If another window took it, the step is thrown out and the page tried again, with NVDA and the browser started fresh.
5. **A person reviews.** The person running voicecap listens as NVDA reads, then reads the transcripts, records what they found with `voicecap review`, and fixes it. Flags point to moments worth a second listen, such as links that say only "click here".
6. **A sealed record.** Every file gets a fingerprint (SHA-256) and each run is sealed, so `voicecap verify` can show that nothing has changed since.

The first lines NVDA said on the demo site's home page, in each pass:

```
read (Down Arrow)   banner landmark, voicecap demo
                    Tour, navigation landmark, list, with 1 item, link, Next: Before you start
headings (H)        main landmark, Welcome to the voicecap demo, heading, level 1
                    The tour's pages, heading, level 2
tab (Tab)           Skip to main content, same page, link
                    Tour, navigation landmark, list, with 1 item, Next: Before you start, link
```

The details are in [What voicecap does on each page](#what-voicecap-does-on-each-page).

## When to run voicecap

![When to run voicecap: run it on the deployed site before it goes live, and again after a major update, not during development.](https://raw.githubusercontent.com/ICJIA/voicecap/main/assets/when-to-run-voicecap.png)

**Run voicecap on the deployed site before it goes live, and again after a major update.**

- **Not on every build during development.** Builds change daily, and a development copy isn't what users get. Screen reader users hear the deployed site, with its real content, so that's the one to listen to.
- **Before launch,** run the full listen-through on the site as it will go live, such as a staging copy of the production site. Fix what you find, then run the pages you fixed again.
- **After a major update,** run the same pages again with `--compare previous` to see exactly what changed in what the screen reader says.

## Contents

- [How voicecap works](#how-voicecap-works)
- [When to run voicecap](#when-to-run-voicecap)
- [Quick start](#quick-start)
  - [On Windows](#on-windows)
  - [On a Mac](#on-a-mac)
- [Try it first: npx @icjia/voicecap demo](#try-it-first-npx-icjiavoicecap-demo)
- [Windows setup (for someone new to Windows)](#windows-setup-for-someone-new-to-windows)
  - [If PowerShell says "running scripts is disabled"](#if-powershell-says-running-scripts-is-disabled)
- [Mac setup](#mac-setup)
- [Commands and options](#commands-and-options)
- [Page sources](#page-sources)
- [What voicecap does on each page](#what-voicecap-does-on-each-page)
- [The transcripts folder](#the-transcripts-folder)
- [The audit record](#the-audit-record)
- [Long runs, interruptions, and resuming](#long-runs-interruptions-and-resuming)
- [Reviews: the audit trail](#reviews-the-audit-trail)
- [Manual NVDA sessions](#manual-nvda-sessions)
- [Verifying transcript fidelity](#verifying-transcript-fidelity)
- [Reading the report](#reading-the-report)
- [The shareable page](#the-shareable-page)
- [Heuristic flags](#heuristic-flags)
- [Configuration](#configuration)
- [Programmatic API](#programmatic-api)
- [Drivers](#drivers)
- [Updating Guidepup](#updating-guidepup)
- [Known limitations](#known-limitations)
- [Future enhancements](#future-enhancements)
- [Development](#development)
- [License](#license)

## Quick start

voicecap needs **Node.js 22.19 or later** (24 recommended), and nothing else to start: run it with `npx`, as below. npx downloads voicecap the first time and reuses it; `npx @icjia/voicecap@latest …` picks up a newer version. pnpm is only for developing voicecap, or for the replay demo below.

Why voicecap is built the way it is, in three short answers:

- **Why an npm package.** voicecap runs on your own computer, where the screen reader is. It's one package for Windows and a Mac, `npx` fetches the version you ask for, and every run records the version of voicecap that made it.
- **Why PowerShell, not Git Bash, on a PC.** Git Bash rewrites any argument that starts with `/` into a Windows path (`--page /about` arrives as `C:/Program Files/Git/about`). voicecap catches that and explains it, but it's an extra step. Git Bash's own window (mintty) also doesn't always let Node see a terminal, and voicecap then leaves out what needs one: the live test that `init` and `setup` offer, and "Did you listen?" at the end of a run; and `demo` won't start. PowerShell has neither problem, on its own or in Windows Terminal (see [Git Bash and paths that start with "/"](#git-bash-and-paths-that-start-with-)). It has one catch of its own, fixed once: on a new PC it can refuse to run `npx` (see [If PowerShell says "running scripts is disabled"](#if-powershell-says-running-scripts-is-disabled)).
- **Why a command-line app, not a web app.** voicecap has to start a real screen reader, press its keys on your computer, and capture what it says. A web page can't do any of that from inside the browser's sandbox. Running on your own computer also keeps every transcript in a folder you control. The web part is what voicecap makes: [the shareable page](#the-shareable-page).

Three steps take you from a new computer to a first run:

1. **Check your computer:** in PowerShell on a PC, or Terminal on a Mac, run `npx @icjia/voicecap preflight`. It never starts the screen reader, and it needs no site. It ends with a verdict, in words as well as color: "Ready", in green, means you can go on to step 3. "Not ready", in red, comes after a numbered list of exactly what to fix. See [The checks, and the live test](#the-checks-and-the-live-test). If PowerShell refuses to run `npx` at all, see [If PowerShell says "running scripts is disabled"](#if-powershell-says-running-scripts-is-disabled).
2. **Fix what it lists,** then run `preflight` again, until it says Ready. Each problem comes with its own numbered steps. `npx @icjia/voicecap setup` installs what's missing and, on a Mac, walks you through the permissions. [Windows setup](#windows-setup-for-someone-new-to-windows) and [Mac setup](#mac-setup), below, have the details.
3. **Run voicecap:** `npx @icjia/voicecap init` asks a few questions, then prints the command for your first real run and starts it when you say yes. NVDA speaks and takes over the keyboard until the run ends, so keep your hands off. (On a Mac, voicecap can't run VoiceOver yet: `init` ends with the command to run on a Windows computer.)

To try voicecap first, `npx @icjia/voicecap demo` is a guided first run on voicecap's own built-in demo site, so you need no site of your own (see [Try it first](#try-it-first-npx-icjiavoicecap-demo)).

### On Windows

<details>
<summary>The four steps on a Windows PC, what <code>init</code> shows on a ready computer, and the reviewer name</summary>

In PowerShell inside Windows Terminal (on a computer new to all this, start with [Windows setup](#windows-setup-for-someone-new-to-windows); if you use Git Bash, read [Git Bash and paths that start with "/"](#git-bash-and-paths-that-start-with-) first):

1. **Set up, once:** `npx @icjia/voicecap setup` installs voicecap's own copy of NVDA, and Playwright's Chromium if Google Chrome isn't installed, with no administrator rights. It ends by checking this computer.
2. **Check:** `npx @icjia/voicecap doctor` checks this computer and runs a 20-second live test with NVDA, then prints a report to paste into a bug report.
3. **Compose the run:** `npx @icjia/voicecap init` checks this computer, asks a few questions, and prints the run's command, with the offer to run it now.
4. **Run:** the command `init` printed, such as `npx @icjia/voicecap --site https://i2i.illinois.gov --sitemap https://i2i.illinois.gov/sitemap.xml --limit 5 --reviewer icjia`. NVDA speaks and takes over the keyboard until the run ends (see [Windows setup](#windows-setup-for-someone-new-to-windows), step 6). To resume a run that stopped, run the same command again.

`init` on a ready computer, declining the live test:

```
PS> npx @icjia/voicecap init

voicecap preflight, 2026-09-28 11:10

This computer
  Computer        DESKTOP-4K2P1, user cschw
  Model           Dell Inc. OptiPlex 7010, Intel(R) Core(TM) i5-3470 CPU @ 3.20GHz, 16 GB memory, 120 GB free of 476 GB
  System          Windows 11 Pro 24H2 (10.0.26100), x64
  Node.js         22.19.0
  voicecap        0.4.0, with @guidepup/guidepup 0.34.0
  Screen reader   NVDA 2026.2 (Guidepup's build 0.2.1-2026.2)
  Browser         Chrome 153.0.8010.53
  Language        English (United States)
  Transcripts     C:\Users\cschw\code\voicecap-transcripts
  Guidepup files  C:\Users\cschw\AppData\Local\guidepup
  Browser path    C:\Program Files\Google\Chrome\Application\chrome.exe

Checks
  OK    Node.js 22.19.0
  OK    Guidepup's folder: C:\Users\cschw\AppData\Local\guidepup
  OK    NVDA 2026.2 (Guidepup's build 0.2.1-2026.2) is installed
  OK    No other voicecap is using NVDA
  OK    Your NVDA isn't running
  OK    Windows is unlocked
  OK    Browser: Chrome

Ready: this computer can run NVDA for voicecap.

The live test takes about 20 seconds. NVDA speaks and takes over the keyboard, so keep your hands off.
Test NVDA now? [y/N]: n

Website: i2i.illinois.gov
Checking https://i2i.illinois.gov…
  → https://i2i.illinois.gov (it answers)
Looking for the site's sitemap…
Where are the pages?
  1. The site's sitemap, listed in robots.txt: https://i2i.illinois.gov/sitemap-index.xml
  2. The site's sitemap at /sitemap.xml: https://i2i.illinois.gov/sitemap.xml
  3. A sitemap at another address
  4. A page list file (.csv or .json)
  5. One page
Choose [1]: 2
How many pages? A number, or Enter for all [all]: 5
Transcripts home [C:\Users\cschw\code\voicecap-transcripts]:
  → this run goes into C:\Users\cschw\code\voicecap-transcripts\i2i.illinois.gov\2026-09-28\
Reviewer, recorded with the run [icjia]:
Tip: set VOICECAP_REVIEWER to make your own name the default.

Your command:
  npx @icjia/voicecap --site https://i2i.illinois.gov --sitemap https://i2i.illinois.gov/sitemap.xml --limit 5 --reviewer icjia
Run the same command again later to resume where it stopped.

NVDA will speak and take over the keyboard until the run ends.
Run it now? [y/N]:
```

`init` offers every sitemap the site has: each one its `robots.txt` lists, then `/sitemap.xml`. A site with one sitemap shows just "The site's sitemap". "A sitemap at another address" asks for `Sitemap (a full URL, or a name like sitemap.xml)`. A name is read on the site, and an address typed without `https://` gets it added.

**The reviewer** is recorded with each session of the run, and the report shows it. Enter takes the quick default, `icjia`; type a person's name to record who ran it. The command ends with `--reviewer`, so it's easy to change for someone else. To make your own name the default, set `VOICECAP_REVIEWER` once: in PowerShell, `setx VOICECAP_REVIEWER "Your Name"`, then open a new window (on a Mac, add `export VOICECAP_REVIEWER="Your Name"` to `~/.zshrc`). `voicecap review` records the same name.

</details>

### On a Mac

<details>
<summary>The four steps on a Mac, and what the checks and <code>init</code> end with</summary>

In Terminal, iTerm, or Visual Studio Code's terminal:

1. **Set up, once:** `npx @icjia/voicecap setup` installs Guidepup's VoiceOver files, and Playwright's Chromium if Google Chrome isn't installed. It changes two VoiceOver settings, walks you through the macOS permissions voicecap needs, and ends by checking this Mac (see [Mac setup](#mac-setup)).
2. **Check:** `npx @icjia/voicecap doctor` checks this Mac and runs a 20-second live test that starts VoiceOver, then prints a report to paste into a bug report.
3. **Compose the run:** `npx @icjia/voicecap init` checks this Mac, asks the same questions as on Windows, and prints the run's command.
4. **Run:** on a Windows computer, for now. voicecap can't run VoiceOver yet: that comes with its VoiceOver driver, in a later release. (A run started on a Mac stops at once, with exit code 2.)

On a ready Mac, the checks end with this verdict:

```
Ready: this computer is set up for VoiceOver, but voicecap can't run VoiceOver yet: that comes with its VoiceOver driver.
Tip: turn on Do Not Disturb, so notifications don't interrupt VoiceOver.
```

And `init` ends with the command, and where to run it, in place of "Run it now?":

```
Your command:
  npx @icjia/voicecap --site https://i2i.illinois.gov --page https://i2i.illinois.gov/program-overview/
Run the same command again later to resume where it stopped.

voicecap can't run VoiceOver yet: that comes with its VoiceOver driver. For now, run this command on a Windows computer.
```

</details>

### Try it without a screen reader

The replay driver plays back a run recorded with real NVDA, so the whole pipeline works on any computer, Linux included. With the test fixture in this repository:

```bash
git clone https://github.com/ICJIA/voicecap.git
cd voicecap
pnpm install
pnpm build
node dist/cli.js --site http://127.0.0.1:4747 --pages fixture/pages.json --replay-from fixture/replay-run
```

Then open `transcripts/127.0.0.1_4747/report.html`.

### The checks, and the live test

<details>
<summary>What the checks look at, what <code>preflight</code> prints and its exit codes, and the 20-second live test</summary>

**`preflight`, `init`, `doctor`, and `setup` check this computer:** `preflight`, `init`, and `doctor` first, `setup` after installing. A real run on Windows does too, before NVDA starts (see [Checks before a run, and getting your screen reader back](#checks-before-a-run-and-getting-your-screen-reader-back)). In about three seconds, the checks show this computer's details and whether NVDA (on Windows) or VoiceOver (on a Mac) is ready. They only read, with two exceptions on a Mac: the Full Disk Access check creates and removes a small file in the folder where VoiceOver keeps its settings, and the System Events check makes macOS ask, the first time, whether your terminal app may control System Events. So on a Mac they start with `Checking this Mac. If macOS asks for access to control "System Events", click Allow.`

**`npx @icjia/voicecap preflight` is the checks on their own,** for finding out whether a computer is ready with nothing else happening. It shows this computer's details, each check passed or failed, and for each failure the numbered steps that fix it. It never starts NVDA or VoiceOver, never opens the browser, and never runs the live test, and it needs no site. `doctor` adds the live test to the same checks.

It ends with a verdict, in words as well as color: green or red where the output is a terminal, and plain when it isn't or when `NO_COLOR` is set. A ready computer exits with code 0:

```
✓ Ready: this computer can run voicecap.
Next: npx @icjia/voicecap doctor adds a 20-second live test with NVDA (hands off the keyboard and mouse), or npx @icjia/voicecap init sets up a run.
```

A computer that isn't ready exits with code 2, as `init` does, after the numbered fixes:

```
✗ Not ready: 2 things to fix.
Fix these, then run npx @icjia/voicecap preflight again.
```

On a Mac that passes every check, the verdict is `✓ Ready: this Mac passed every check.`, followed by a note that voicecap can't run VoiceOver audits yet, and that `npx @icjia/voicecap doctor`, a 20-second live test, shows VoiceOver working now. The exit code is still 0, so a script can tell that the checks passed. On Linux, which has no screen reader for voicecap to drive, it says so, with exit code 2.

**A computer that isn't ready** gets a numbered diagnosis of what's wrong and how to fix it (see the example under [Mac setup](#mac-setup)), and `preflight` and `init` stop there, with exit code 2.

**A ready computer can take the live test.** It starts NVDA or VoiceOver for real, brings the browser to the front with a small check page, and checks that the screen reader can be heard, then puts everything back as it was, your own screen reader included. It takes about 20 seconds, after a warning to keep your hands off. `init` and `setup` offer it when you're at a terminal to answer; `doctor` runs it without asking; `preflight` never runs it. If it fails, voicecap says what's wrong and exits with code 2. To stop it early, click the terminal window first (the browser is in front, and would get the keystroke), then press Ctrl+C: voicecap stops the test and puts everything back the same way.

</details>

### Installing voicecap

<details>
<summary>Installing it anyway, how the command <code>init</code> prints is quoted, and the <code>ffmpeg-static</code> notice</summary>

You don't have to: npx runs voicecap without installing it. `npx @icjia/voicecap` with nothing after it starts `init` too, in a terminal. Git Bash's own window (mintty) doesn't always let Node see a terminal, though, and there the bare command prints the usage error instead, so type `npx @icjia/voicecap init`.

To install it anyway: `npm install -g @icjia/voicecap`, and `npm install -g @icjia/voicecap@latest` to update. Then `voicecap` does what `npx @icjia/voicecap` does: `voicecap init`, `voicecap setup`, `voicecap --site …`. On Windows 11 this creates `voicecap`, `voicecap.cmd`, and `voicecap.ps1` commands, for Git Bash, cmd, and PowerShell, with no administrator rights needed.

The command `init` prints always starts with `npx @icjia/voicecap`, so it works on any computer with Node.js. It's quoted for Git Bash, PowerShell, and a Mac's terminal; in cmd, its single quotes must become double quotes (`init` says so when it uses any), or answer "Run it now?" with y, which uses no shell.

npm may say it skipped `ffmpeg-static`'s install script, or it may download ffmpeg (about 30 MB): `@guidepup/setup` can screen-record its own macOS setup with it, which voicecap never does. Either way, voicecap works the same.

</details>

## Try it first: `npx @icjia/voicecap demo`

<details>
<summary>The tour's seven steps, where its files go, and what it does on a Mac</summary>

`npx @icjia/voicecap demo` is a guided first run, about 9 minutes, against a small demo site that comes with voicecap. The site runs only on this computer, and only while the tour needs it: nothing is downloaded, and nothing is sent anywhere. The tour goes one step at a time, and each step waits for Enter. Ctrl+C at any of them stops the tour, with nothing left running.

1. **Welcome:** what voicecap does, and what the tour will do.
2. **Checking this computer:** the checks `init` starts with. On their own, they're `npx @icjia/voicecap preflight`.
3. **The live test:** about 20 seconds of NVDA speaking. Keep your hands off the keyboard.
4. **Auditing the demo site:** NVDA reads the demo's seven pages, hands off, for about 7 minutes. The tour shows the command it runs, such as `npx @icjia/voicecap --site http://127.0.0.1:4848 --sitemap sitemap.xml --out voicecap-demo --fresh`. To stop early, click the terminal window first (the browser is in front), then press Ctrl+C.
5. **The transcripts:** where they are, and the first lines NVDA said on the demo's home page.
6. **The report:** where it is, its flags, which are all on the "Common mistakes (on purpose)" page, and an offer to open it.
7. **Your own site:** `npx @icjia/voicecap init` sets up a run.

The demo's files go in a `voicecap-demo` folder in the current folder, never in your `VOICECAP_TRANSCRIPTS` audit record, and they're safe to delete. The demo site uses port 4848, or any free port when that one is taken. The tour needs a terminal: it doesn't run from a script. On Windows, run it in PowerShell or Windows Terminal, not Git Bash's own window (mintty), which doesn't always let Node see a terminal.

**On a Mac, for now,** the tour checks the Mac and runs the VoiceOver live test (steps 1 to 3). Step 4 says what the audit will do, and the tour ends with the Mac's next steps. The audit, the transcripts, and the report come with voicecap's VoiceOver driver, in a later release; a Windows PC runs the full tour.

</details>

## Windows setup (for someone new to Windows)

<details>
<summary>Six steps for a new Windows PC, from installing Git and Node.js to what to do before a run</summary>

These steps assume Windows 11, a normal (non-administrator) account, and PowerShell inside Windows Terminal (its default profile).

1. **Install Git and Node.js.** Open Windows Terminal from the Start menu (it starts in PowerShell, its default profile), and run:

   ```powershell
   winget install --id Git.Git -e
   winget install --id OpenJS.NodeJS.LTS -e
   ```

   Node's installer is machine-wide and usually needs administrator rights once, so on a managed PC you may need IT to run it (Git may prompt too).

2. **Close Windows Terminal and open it again,** so both are on your PATH. Check with `node --version` (22.19 or later), `git --version`, and `npx --version`. If PowerShell refuses to run `npx`, see [If PowerShell says "running scripts is disabled"](#if-powershell-says-running-scripts-is-disabled).

3. **Only if you'll develop voicecap:** install pnpm with `corepack enable pnpm` (or `npm install -g pnpm`). Running voicecap needs only Node and `npx`.

4. **Install NVDA for voicecap:** `npx @icjia/voicecap setup`. This downloads (about 100 MB, from GitHub) the portable NVDA build that voicecap's pinned Guidepup expects into `%LOCALAPPDATA%\guidepup`. It's separate from any NVDA you already have installed, and needs no administrator rights. If Google Chrome isn't installed, setup also installs Playwright's Chromium for voicecap to use instead. Behind a proxy, set `HTTPS_PROXY` first (in PowerShell, `$env:HTTPS_PROXY = "http://your-proxy:port"` sets it for the current window).

   - **If your Windows user folder's path has a space or one of `& ( , ; = ^`** (`C:\Users\Jane Doe`, `C:\Users\R&D`), Guidepup can't start NVDA from there. setup explains the fix: set `GUIDEPUP_SCREEN_READERS_PATH` to a plain folder such as `C:\guidepup` (in PowerShell, `mkdir C:\guidepup`, then `setx GUIDEPUP_SCREEN_READERS_PATH C:\guidepup`), open a new terminal, and run setup again.
   - **The first time NVDA starts**, Windows may ask whether NVDA can communicate on networks. voicecap talks to NVDA only on this computer (127.0.0.1); it doesn't need network access.
   - **Then setup checks this computer.** If it's ready, setup offers the live test (see [The checks, and the live test](#the-checks-and-the-live-test)); if it isn't, setup says what's wrong and exits with code 2.

5. **Check everything:** `npx @icjia/voicecap doctor`. It checks the NVDA build, whether your own NVDA or another voicecap is running, Windows' lock state, and the browser, then runs the live test, which also checks that the browser comes to the front and that NVDA speaks English. It prints one report, with a plain-language fix for anything wrong, to paste into a bug report (see [Other commands](#other-commands)).

6. **Before a run:**
   - **voicecap checks this computer first,** and stops with exit code 2, before touching anything, if it isn't ready (see [Checks before a run, and getting your screen reader back](#checks-before-a-run-and-getting-your-screen-reader-back)).
   - **Your own NVDA can stay on.** voicecap warns you, shuts it down when it starts (Guidepup does this), and turns it back on afterwards, with your own settings.
   - **Don't use the computer during a run.** NVDA's keystrokes go to whichever window is in front. voicecap brings its browser to the front for every page, checks it with NVDA+T, and throws away any step during which another window came forward, but each click elsewhere costs a page (it's recorded as failed). NVDA speaks aloud throughout, and NVDA's Speech Viewer window opens beside the browser.
   - **Keep the computer unlocked.** On a locked computer, NVDA can't press keys or speak, and voicecap stops with "Windows is locked". voicecap keeps Windows from sleeping or turning the screen off while it runs, but it can't stop a lock: Win+L, a screen saver set to lock, or a workplace lock policy. If you step away, leave it unlocked. A minimized Remote Desktop window (Windows stops drawing it) breaks a run too.
   - **Turn on Do Not Disturb** (Settings → System → Notifications) so notifications don't get read into transcripts.
   - **Pause Windows Update** restarts during long runs (Settings → Windows Update → Pause updates). If a restart happens anyway, voicecap resumes where it stopped.

</details>

### If PowerShell says "running scripts is disabled"

On a new Windows PC, PowerShell can refuse to run `npx` (and `npm`) at all:

```text
npx : File C:\Program Files\nodejs\npx.ps1 cannot be loaded because running scripts is disabled on this system.
```

Nothing is wrong with voicecap or Node.js. In PowerShell, `npx` runs as a PowerShell script (`npx.ps1`), and Windows starts out not letting PowerShell run any script. Two ways past it:

- **Allow scripts for your own account, once.** Run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`, and answer `Y` if it asks. It needs no administrator rights, and it works at once, in the same window. From then on, scripts on this computer run, and a script downloaded from the internet still needs a signature.
- **Or change nothing, and type `npx.cmd` wherever these steps say `npx`,** as in `npx.cmd @icjia/voicecap preflight`. Use this on a work PC where the first way is refused, or where your organization's settings override it. One catch: an address with `&` in it, such as `--page "https://example.org/search?q=a&lang=en"`, doesn't survive `npx.cmd`.

### Git Bash and paths that start with "/"

PowerShell doesn't rewrite arguments, so this note is only for people who use Git Bash (in Windows Terminal, the tab drop-down, the `˅` next to the `+`, lists "Git Bash" once Git is installed). Git Bash rewrites command-line arguments that start with `/` into Windows paths, so `--page /about` reaches voicecap as `C:/Program Files/Git/about`. voicecap detects this and stops with an explanation. Four ways around it:

- use full URLs: `--page https://dvfr.illinois.gov/about/` (always works);
- leave off the leading slash in patterns: `--include 'news/*'` (patterns match with or without it);
- give a sitemap by its name, without the slash: `--sitemap sitemap.xml` is the same file as `/sitemap.xml`;
- turn the rewriting off for one command: `MSYS_NO_PATHCONV=1 npx @icjia/voicecap review --page /about ...`.

With the rewriting off, Git Bash also stops translating its own way of writing a Windows path, `/c/Users/me` (what `~` expands to), so voicecap reads that form itself on Windows: `--out`, `VOICECAP_TRANSCRIPTS`, `--pages`, `--replay-from`, and the files `manual add` and `list-urls` take all accept it.

## Mac setup

<details>
<summary>What <code>setup</code> does on a Mac, and <code>init</code> on a Mac that's missing one permission</summary>

`npx @icjia/voicecap setup` prepares a Mac for VoiceOver. It:

- checks that voicecap's Guidepup can drive VoiceOver on this version of macOS (12 to 26), and if it can't, stops there, before downloading anything;
- installs Guidepup's VoiceOver files (the settings Guidepup starts VoiceOver with) and, if Google Chrome isn't installed, Playwright's Chromium;
- changes two VoiceOver settings itself, and says how to undo each:

  ```
  Turned off VoiceOver's welcome screen (to undo: defaults delete com.apple.VoiceOverTraining doNotShowSplashScreen).
  Turned on VoiceOver's own "allow AppleScript" setting (to undo: defaults delete com.apple.VoiceOver4/default SCREnableAppleScript).
  ```

  The welcome screen would otherwise stop voicecap the moment VoiceOver starts. The AppleScript setting is VoiceOver's own switch for accepting AppleScript commands at all; Guidepup's own setup turns on the same one.

- walks you through each permission that's still missing, one at a time (see [Permissions and the terminal app](#permissions-and-the-terminal-app));
- checks this Mac, as `init` does, and once it's ready, offers the [live test](#the-live-test-on-a-mac).

Without a terminal to answer (a script, say), setup still installs everything and changes the two settings, then lists whatever's still missing, and exits with code 2 if the Mac isn't ready.

Here's `init` on a Mac that's missing one permission, which `setup` would walk you through:

```
$ npx @icjia/voicecap init

Checking this Mac. If macOS asks for access to control "System Events", click Allow.

voicecap preflight, 2026-09-28 11:10

This computer
  Computer        cschweda’s Mac mini, user cschweda
  Model           Mac mini (Mac16,10), Apple M4, 16 GB memory, 72 GB free of 228 GB
  System          macOS 26.6.2 (25G83), Apple silicon
  Terminal app    Visual Studio Code (macOS gives permissions to this app)
  Node.js         22.22.2
  voicecap        0.4.0, with @guidepup/guidepup 0.34.0
  Screen reader   VoiceOver 10 (build 993)
  Browser         Chromium 153.0.8010.12 (Playwright's)
  Language        English (United States)
  Transcripts     /Users/cschweda/webdev/voicecap-transcripts
  Guidepup files  /Users/cschweda/Library/Caches/guidepup
  Browser path    ~/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing

Checks
  OK    macOS 26 is supported
  OK    Node.js 22.22.2
  OK    Terminal app: Visual Studio Code
  OK    VoiceOver's files for Guidepup are installed
  OK    VoiceOver can be controlled by AppleScript
  OK    VoiceOver's welcome screen is off
  OK    Accessibility: Visual Studio Code is allowed
  FAIL  Full Disk Access: Visual Studio Code isn't allowed
  OK    Visual Studio Code can control System Events
  OK    No other voicecap is using VoiceOver
  OK    Browser: Chromium
  WARN  VoiceOver is on: voicecap will use it, then turn it back on with your settings

Not ready: 1 problem.

1. Full Disk Access for Visual Studio Code
   What's wrong: voicecap keeps its VoiceOver settings apart from yours by linking them into
   a folder macOS protects, and macOS blocks Visual Studio Code from that folder.
   How to fix:
     1. Open System Settings, then Privacy & Security, then Full Disk Access.
     2. Switch on Visual Studio Code. If it isn't listed, click + and choose it.
     3. When macOS asks, quit and reopen Visual Studio Code.
     4. Run npx @icjia/voicecap init again.
   Or run npx @icjia/voicecap setup, which walks you through it.
```

</details>

### Permissions and the terminal app

<details>
<summary>The five permissions voicecap needs, how <code>setup</code> walks you through them, and the Full Disk Access check</summary>

Every permission belongs to the app you run voicecap in (Terminal, iTerm, Visual Studio Code, or another editor's terminal), not to voicecap itself, because that's the app macOS sees asking. voicecap finds it by walking up its own parent processes to the outermost app, and calls it by the name System Settings lists, in the machine details ("Terminal app") and in every check and step. Switch to another terminal app and you'll need to grant these again; over SSH there's no app to find, and the check fails.

| Permission | Why voicecap needs it |
| --- | --- |
| VoiceOver Utility → General → "Allow VoiceOver to be controlled with AppleScript" | voicecap sends VoiceOver its commands through AppleScript, which VoiceOver accepts only once you allow it. |
| Privacy & Security → Accessibility | voicecap presses VoiceOver's keys through macOS's Accessibility features, which need your OK for your terminal app. |
| Privacy & Security → Automation → System Events | voicecap sends VoiceOver's keys through System Events. |
| Privacy & Security → Full Disk Access | voicecap keeps its VoiceOver settings apart from yours by linking them into a folder macOS protects, and macOS blocks your terminal app from that folder. |
| Privacy & Security → Automation → VoiceOver | voicecap drives VoiceOver through AppleScript. Only the live test can tell whether this one is missing, since that takes starting VoiceOver. |

`setup` walks through whichever of the first four are missing, in that order, one step each. It says what the permission is for, opens VoiceOver Utility or System Settings at the right page when there's one to open (or says it couldn't, and where to go), and says what to switch on, naming your terminal app. Then it waits for Enter (or `s` to skip) and checks again:

```
Step 2 of 4: Accessibility for Visual Studio Code
  voicecap presses VoiceOver's keys through macOS's Accessibility features, which need your OK for Visual Studio Code.
  Opening System Settings at Privacy & Security, Accessibility…
  Switch on Visual Studio Code. If it isn't listed, click + and choose it.
Press Enter when it's on, or type s to skip:
```

Full Disk Access comes last because it takes effect only once your terminal app quits and reopens, so its step ends with `When Visual Studio Code reopens, run npx @icjia/voicecap setup again to finish.` A rerun skips whatever's already fixed.

The Full Disk Access check looks at the folder Guidepup will actually use, so it can also say:

- `Full Disk Access: not needed on this Mac`, where VoiceOver keeps your settings outside the protected folder;
- `VoiceOver: not set up for this user yet`, when VoiceOver has never been turned on for your user, so your settings don't exist yet. Press Command-F5 to turn VoiceOver on, press it again once VoiceOver starts speaking, then run setup again.

</details>

### The live test on a Mac

<details>
<summary>What the live test says and checks on a Mac, and what a pass looks like</summary>

Before it starts, voicecap says:

```
The live test takes about 20 seconds. VoiceOver speaks and takes over the keyboard, so keep your hands off.
If macOS asks whether Visual Studio Code can control VoiceOver, click Allow.
```

Click Allow if macOS asks: that's Automation for VoiceOver, which only starting VoiceOver for real can raise. The test starts VoiceOver through Guidepup with voicecap's own settings, brings the browser to the front with a small check page, and asks VoiceOver to describe what has the keyboard focus. A pass looks like this:

```
Checks
  OK    Visual Studio Code can control VoiceOver
  OK    VoiceOver started with voicecap's settings
  OK    The browser came to the front
  OK    VoiceOver hears the page ("127.0.0.1:57951 Address and search bar edit text has keyboard focus contents selected")
```

Then voicecap puts VoiceOver back the way it found it (see [Checks before a run, and getting your screen reader back](#checks-before-a-run-and-getting-your-screen-reader-back)).

</details>

## Commands and options

You type these commands the same way in PowerShell, in Git Bash, and in a Mac's terminal, except that Git Bash rewrites arguments that start with `/` (see [Git Bash and paths that start with "/"](#git-bash-and-paths-that-start-with-)).

### Run an audit

<details>
<summary>The command, every option, how patterns match, and the question voicecap asks at the end</summary>

```bash
npx @icjia/voicecap --site <url> (--sitemap <url> | --pages <file> | --page <url>...) [options]
```

`--site` is required, plus exactly one kind of page source: `--sitemap`, `--pages`, or one or more `--page`; giving none of them, or a mix, is an error.

| Option | Meaning |
| --- | --- |
| `--site <url>` | The site. Pages must be on its origin. |
| `--sitemap <url>` | Take pages from a sitemap: a `<urlset>` or a `<sitemapindex>` (child sitemaps are read too; gzip is fine). Give its full URL, or its name or path on the site, from its root (`sitemap.xml`, `/sitemaps/pages.xml`). |
| `--pages <file>` | Take pages from a page list: `.csv` or `.json` (see [Page sources](#page-sources)). |
| `--page <url>` | Take this page: a full URL, or a path like `/faq/`, resolved against `--site` (repeatable). |
| `--limit <n>` | Transcribe at most n pages (after include and exclude). |
| `--include <pattern>` | Only URL paths matching. Glob by default; `re:` for a regular expression. Repeatable. |
| `--exclude <pattern>` | Skip URL paths matching. Same syntax. Repeatable. |
| `--passes <list>` | Which passes to run: any of `read,headings,tab` (default: all three). |
| `--max-steps <n>` | Override every pass's step cap. |
| `--compare <run-id\|previous>` | Compare with an earlier run in the report. `previous` is the most recent earlier completed run with the same page source. |
| `--fresh` | Start a new run even if an interrupted run with the same settings could be resumed. |
| `--out <dir>` | The transcripts home (default: `VOICECAP_TRANSCRIPTS`, else `./transcripts`). |
| `--run-name <name>` | Add a name to the run's folder: `--run-name exhaustive` makes it `2026-09-26/1405_exhaustive`, and the run's id `2026-09-26_1405_exhaustive`. |
| `--reviewer <name>` | Who is running it, recorded with each session of the run and shown in the report. Default: `VOICECAP_REVIEWER`, then `git config user.name`, then `reviewer` in the config. With none, the run goes ahead and its record says no name was given. `init` always asks. |
| `--replay-from <dir>` | Use the replay driver: play back a run folder instead of running NVDA. |

**Patterns.** Globs match the URL's path: `news/*` matches `/news/fy27-grants` but not `/news/` itself; `news/**` matches both, and deeper paths. The leading slash is optional in both the pattern and the path. `re:` patterns are regular expressions tested against the path plus the query string (with and without the leading slash), e.g. `--exclude 're:\?page=\d+'`. `--include`, then `--exclude`, then `--limit` apply, in that order.

**The question at the end.** When a session that read pages ends, voicecap asks at the terminal, once NVDA has stopped: "Did you listen as NVDA read these pages?" The answers are "Yes, all of them", "Part of them", and "No", typed as 1, 2, or 3. Enter picks No, so a run never says you listened unless you said so. The session's record keeps the answer, with when voicecap asked and when it was answered, and the run's seal covers it (see [What each run records](#what-each-run-records)).

- **It's asked however the session ends:** when the run completes; after Ctrl+C; when the run stops after too many failed pages in a row (exit code 2); and when an error ends it (the browser updating itself mid-run, say). After an error, a line before the question says why the session stopped, and the full explanation follows your answer.
- **Only an answer typed after the question appears counts.** Keys pressed while the run went on, a stray Enter say, are dropped before the question shows, so they can't answer it for you.
- **Ctrl+C at the question, or closing the window, gives no answer.** The record then has no statement.
- **It isn't asked,** and the record has no statement:
  - without a terminal (a script, or CI), or when the output is redirected to a file (`voicecap … > log.txt`), where no one would see the question;
  - in Git Bash's own window (mintty), which doesn't always let Node see a terminal: run voicecap in PowerShell or Windows Terminal to be asked;
  - for a replay, or for a session that read no pages;
  - by `voicecap demo`.

</details>

### Other commands

<details>
<summary>One line for each of the other commands, how they pick a site's folder, and what <code>doctor</code> prints</summary>

```bash
voicecap list-urls --site <url> --sitemap <url> [--sample N] [--include p] [--exclude p] [--limit n] <output.csv|output.json>
voicecap review --page <url> --status <unreviewed|reviewed|issue|fixed> [--note "..."] [--reviewer <name>] [--run <run-id>] [--site <url>] [--out <dir>]
voicecap manual add <file> --page <url> [--from <time>] [--to <time>] [--date <YYYY-MM-DD>] [--redact-typing] [--keep-raw] [--no-raw] [--reviewer <name>] [--site <url>] [--out <dir>]
voicecap report [--run <run-id>] [--compare <run-id|previous>] [--site <url>] [--out <dir>]
voicecap verify [--site <url>] [--out <dir>]
voicecap setup     # install and check what voicecap needs on this computer (Windows or a Mac)
voicecap preflight # check this computer is ready for a run, without starting the screen reader
voicecap doctor    # check this computer and print a summary to paste into a bug report
voicecap demo      # a guided first run against a demo site that comes with voicecap
```

Wherever a command takes a page, give a full URL or a root-relative path (`/about`). `review`, `manual add`, and `report` work in one site's folder in the transcripts home (see [The audit record](#the-audit-record)): give `--site`, or a full URL with `--page`, or, when the home has only one site's folder so far, nothing at all. With more than one and neither given, voicecap stops and names them.

**`setup` and `doctor` work on Windows and on a Mac;** [Quick start](#quick-start) says what each does there. `doctor` installs nothing and changes no settings. It runs the checks and, if they pass, the live test, without asking first, then prints one report to paste whole into a bug report: this computer's details, one line per check (`OK`, `WARN`, or `FAIL`), and a verdict. On Windows:

```
PS> npx @icjia/voicecap doctor

The live test takes about 20 seconds. NVDA speaks and takes over the keyboard, so keep your hands off.
voicecap doctor, 2026-09-28 11:10

This computer
  Computer        DESKTOP-4K2P1, user cschw
  Model           Dell Inc. OptiPlex 7010, Intel(R) Core(TM) i5-3470 CPU @ 3.20GHz, 16 GB memory, 120 GB free of 476 GB
  System          Windows 11 Pro 24H2 (10.0.26100), x64
  Node.js         22.19.0
  voicecap        0.4.0, with @guidepup/guidepup 0.34.0
  Screen reader   NVDA 2026.2 (Guidepup's build 0.2.1-2026.2)
  Browser         Chrome 153.0.8010.53
  Language        English (United States)
  Transcripts     C:\Users\cschw\code\voicecap-transcripts
  Guidepup files  C:\Users\cschw\AppData\Local\guidepup
  Browser path    C:\Program Files\Google\Chrome\Application\chrome.exe

Checks
  OK    Node.js 22.19.0
  OK    Guidepup's folder: C:\Users\cschw\AppData\Local\guidepup
  OK    NVDA 2026.2 (Guidepup's build 0.2.1-2026.2) is installed
  OK    No other voicecap is using NVDA
  OK    Your NVDA isn't running
  OK    Windows is unlocked
  OK    Browser: Chrome
  OK    NVDA speaks: "heading, level 1, voicecap doctor check" / "Doctor button, button" (1.3 s per step)
  OK    The browser came to the front (checked with NVDA+T)
  OK    NVDA's language: English (United States)

Ready: this computer can run NVDA for voicecap.
```

A problem reads the same way as the example under [Mac setup](#mac-setup): a numbered "Not ready" entry with what's wrong and how to fix it, usually ending with a nudge to run `setup`.

</details>

### Checks before a run, and getting your screen reader back

<details>
<summary>The checks a real run starts with, and how voicecap turns your own NVDA or VoiceOver back on</summary>

**Before NVDA starts, a real run does the same quick checks as `doctor`** (see [The checks, and the live test](#the-checks-and-the-live-test)). If the computer isn't ready, voicecap prints the same "Not ready" diagnosis as `init` and `doctor`, and stops with exit code 2 before anything else happens: no site folder, no lock file, no NVDA. If it's ready, voicecap logs one line plus any warnings, for example:

```
Checks passed: NVDA 2026.2 on Windows 11 Pro 24H2 (10.0.26100)
  WARN  Your NVDA is running: voicecap will use its own NVDA, then turn yours back on
```

A replay run (`--replay-from`) never touches NVDA, so it skips these checks.

**If NVDA is already running under your own account,** voicecap warns before it takes over:

```
========================================================================
WARNING: NVDA is running (process 4821). voicecap shuts it down now and starts its own copy (Guidepup's NVDA 0.2.1-2026.2). voicecap will turn your NVDA back on when it has finished.
========================================================================
```

**Once voicecap is done** — the run finished, was interrupted with Ctrl+C, or hit an error — it turns that copy on again, with your own settings, and says so:

```
Turned your NVDA back on (C:\Program Files\NVDA\nvda.exe).
```

If it can't, it says why and what to do instead, for example:

```
Warning: Couldn't turn your NVDA back on (PowerShell didn't start it). Start it the way you usually do: an installed NVDA starts with Ctrl+Alt+N.
```

**On a Mac, the live test does the same for VoiceOver** (real VoiceOver runs come with its driver). The checks warn first if VoiceOver is on, and afterwards the test leaves it as it found it: on, with your own settings, or off. Turning it back on is silent when it works; if it doesn't, voicecap says `Couldn't turn VoiceOver back on: press Command-F5` (or `Couldn't turn VoiceOver off: press Command-F5`, if VoiceOver should have gone back off).

</details>

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The run (or command) completed. Heuristic flags never change this. |
| 1 | Invalid usage or config (including an unreadable page source). |
| 2 | The computer isn't ready (the checks or the live test failed), or the environment is unusable, e.g. NVDA won't start, or several pages in a row failed. |
| 3 | The run completed, but some pages failed. `voicecap verify` also uses 3, for something recorded that doesn't match. |
| 130 | Interrupted with Ctrl+C. State was saved; run the same command again to resume. |

## Page sources

### Sitemaps (`--sitemap`)

voicecap reads `<urlset>` sitemaps and `<sitemapindex>` files, following child sitemaps (loops are ignored, gzip is fine). If a child sitemap can't be fetched, the run continues with the rest and the problem is recorded in `run.json` and the report. For sitemaps behind a proxy, set `NODE_USE_ENV_PROXY=1` along with `HTTPS_PROXY`.

**Give the sitemap's full URL, or just its name.** For example, `--site https://dvfr.illinois.gov --sitemap sitemap.xml` reads `https://dvfr.illinois.gov/sitemap.xml`.
- A name or path is read on the site from its root, as `--page` paths are, whatever path `--site` has. So `sitemap.xml` and `/sitemap.xml` are the same file, and a sitemap further down is given as its path (`/blog/sitemap.xml`).
- An address typed without `https://`, such as `dvfr.illinois.gov/sitemap.xml`, is refused before anything is fetched: give its full URL instead.
- A run records the sitemap's full URL, so resuming with the name or with the full URL finds the same run.

### Page lists (`--pages`)

<details>
<summary>The CSV and JSON formats, with examples, and saving a CSV from Excel</summary>

For the routine case: a list you curate, such as about 10 routes for each of a site's main templates. The format is picked by file extension.

**CSV** needs a header row with a `url` column; `label`, `template`, and `notes` are optional:

```csv
url,label,template,notes
/,Home,home,
/grants/fy27-jag,FY27 JAG,grant,"Long page, check the table"
https://dvfr.illinois.gov/meetings/,,meetings,
```

Quoted fields, blank lines, a byte-order mark, and Windows (CRLF) line endings are all fine. In Excel, save as **"CSV UTF-8 (Comma delimited)"**. Excel's plain "CSV (Comma delimited)" is Windows-1252, not UTF-8; voicecap reads that too but warns, because other tools may not.

**JSON** is an array of URL strings or of objects with a required `url`:

```json
[
  "/",
  { "url": "/grants/fy27-jag", "label": "FY27 JAG", "template": "grant", "notes": "Long page" }
]
```

Entries may be absolute URLs or root-relative paths, resolved against `--site`. Malformed or missing URLs are reported with their line numbers, and the run continues with the valid entries. A CSV without a `url` column is an error.

</details>

### One page (`--page`)

For checking a single page, or just a few: repeat `--page`, once per page.

```bash
npx @icjia/voicecap --site https://dvfr.illinois.gov --page https://dvfr.illinois.gov/faq/ --page https://dvfr.illinois.gov/about/
```

Each value is a full URL or a root-relative path (`/faq/`), resolved against `--site`, and goes through the same cleanup as a sitemap or page list (see below): off-origin, non-HTML, and duplicate pages are skipped and reported the same way, and `--include`, `--exclude`, and `--limit` still apply. Use full URLs, as above, in Git Bash: a value starting with `/` is rewritten into a Windows path before voicecap ever sees it (see "Git Bash and paths that start with "/"", earlier in this README).

### How the list is cleaned up

For all three sources:

- **Duplicates.** Fragments (`#section`) are dropped, and `/about` and `/about/` count as the same page (the form listed first is the one loaded). Different query strings are different pages.
- **Other origins are skipped** and logged. If most URLs are on another origin, voicecap says so prominently: sitemaps that list `http://` or `www.` variants of the site are a common misconfiguration.
- **Non-HTML resources are skipped**: by extension up front (PDF, DOCX, images, and so on), and any page whose response turns out not to be HTML.
- **Redirects** are followed and the final URL recorded. A redirect to another origin is recorded as skipped.

### Export, prune, rerun

To curate a list from a big sitemap:

```bash
npx @icjia/voicecap list-urls --site https://dvfr.illinois.gov --sitemap https://dvfr.illinois.gov/sitemap.xml pages.csv
```

This writes `url` plus empty `label`, `template`, and `notes` columns, with the same filtering a run uses. Open it in a spreadsheet, delete rows, fill in labels and templates, save as CSV UTF-8, and run with `--pages pages.csv`.

### Drafting a sample

```bash
npx @icjia/voicecap list-urls --site https://i2i.illinois.gov --sitemap sitemap.xml --sample 10 pages.csv
```

With `--sample N`, voicecap drafts a sample for you to curate: N pages per URL path pattern, with the pattern in the `template` column. The pattern is the page's parent path plus `/*` (`/news/*`, `/researchhub/articles/*`); top-level pages share `/*` and the home page is its own group. Pages are picked evenly spaced through each group, and voicecap prints what it chose and why. A run never samples on its own: the page list decides.

## What voicecap does on each page

<details>
<summary>How each page is loaded, and how voicecap captures everything NVDA says</summary>

For each page, voicecap runs up to three **passes** in a real browser with NVDA running. Before each pass it loads the page fresh, in a new browser with a new profile (so no page's speech depends on the pages before it: no "visited" links, cookies, or saved state), and waits until it's ready (network idle, plus an optional `readySelector` and settle delay for sites like Nuxt that keep rendering after load). Then it brings the browser window to the front and checks with NVDA+T (report title) that NVDA sees it there: keystrokes go to whichever window is in front, so if the browser can't be brought forward, the page is recorded as an error rather than transcribing the wrong window. Finally it moves NVDA to the top of the page, in browse mode.

voicecap captures **everything** NVDA says after each keystroke: it waits until NVDA has been quiet for a second, so a step takes about 1.3 seconds. That's the right trade for an audit trail. A step during which another window came to the front is thrown away and the page recorded as failed, so another window's speech never ends up in a transcript.

</details>

### read

<details>
<summary>How the read pass walks a page, and how it decides it has reached the end</summary>

Walks the page line by line in browse mode (Down Arrow) to the end. NVDA has no end-of-document announcement: on the last line, Down Arrow simply says the last line again. So voicecap:

1. jumps to the bottom (Ctrl+End) and records the last line;
2. returns to the top (Ctrl+Home) and reads down;
3. stops when that line is spoken and the next step repeats it, then presses Down once more to confirm (`read.endConfirmations`).

Two identical lines in a row mid-page, such as back-to-back "Read more" links, don't stop it, and neither does a last line that also appears earlier. (A run of three or more identical lines mid-page that also matches the last line can still end it early; raise `read.endConfirmations` if your pages have those.) When NVDA moves onto the last line it also announces containers it enters (like "content info landmark"), but it leaves them out when it repeats the line; voicecap matches the repeat against the end of what Ctrl+End said, so this doesn't matter. The pass also stops if the same speech repeats `repeatLimit` times in a row (a safety net) or at the step cap (default 400), and records which condition stopped it.

</details>

### headings

From the top, moves heading to heading (H) until NVDA says "no next heading".

### tab

Starts with nothing focused and presses Tab, recording what NVDA says at each focus stop and the focused element as the browser sees it: tag, role, accessible name, link target, and whether it's inside the main landmark. It stops when focus leaves the page for the browser's own interface (Chrome's toolbar; detected by the browser, not from speech), at the repeat safety net (a one-element focus trap), or at the step cap. If the page had already focused something before the first Tab, the pass records a warning.

The first Tab goes to the browser directly; the rest go through NVDA. In browse mode NVDA handles Tab itself, moving to the first focusable element *after its cursor*, and its cursor starts on the first line of the page, which is usually the skip link. Sent through NVDA, the first Tab would skip the skip link.

### Progress

voicecap prints one line per page with an estimate of the time left:

```
[27/100] /grants/fy27-jag — read: 212 steps (end reached), headings: 9, tab: 34 — 5m 48s — about 7h 10m left
```

## The transcripts folder

<details>
<summary>The folder tree, how pages are named, and what the TXT and JSON transcripts, the environment record, and the hashes hold</summary>

Everything goes in the transcripts home: `--out <dir>`, else the `VOICECAP_TRANSCRIPTS` environment variable, else `./transcripts` in the current folder. Inside it, each site you run voicecap against gets its own folder:

```
voicecap-transcripts/                  ← the transcripts home
  .gitattributes  .gitignore           ← written once, at the top (see "The audit record")
  dvfr.illinois.gov/                   ← one folder per site: its host name, plus _port if the URL has one
    2026-09-26/                        ← one folder per day with a run or manual session
      1405/                            ← a run: its local time, plus --run-name if given
        run.json                       ← run metadata, environment, transcript hashes, resume state, and seal
        report.html                    ← snapshot of the report when the run completed
        pages/<page-slug>/
          read.txt  read.json  headings.txt  headings.json  tab.txt  tab.json
        attempts/<page-slug>/1/        ← an earlier attempt at a retried or resumed page, kept
        compare/<base-run>/            ← diffs, when the run used --compare
      1415_manual_faq/                 ← a manual NVDA session on /faq/
        session.json  session.txt  raw/nvda-log.txt
    reviews.json                       ← append-only review history, by page; persists across runs
    report.html  latest.txt            ← live report, and the id of the most recently completed run
    share/current.html                 ← the shareable page, written again with report.html
    compare/<base>__<run>/             ← diffs made by `voicecap report --compare`
    .voicecap.lock                     ← only while a run writes here
  i2i.illinois.gov/
    2026-09-27/
      1044_before-redesign/            ← a run made with --run-name before-redesign
```

- **Runs never overwrite each other**, and a run folder is never modified after the run completes. Two runs started in the same minute get `-2`, `-3`, and so on.
- **Page slugs** are a readable part of the path plus a short hash of the URL (`grants-fy27-jag-1a2b3c4d5e`), safe on Windows and short enough to avoid path-length problems. The home page is `home`. The full URL is inside every JSON file.
- **TXT transcripts** start with a header block (every line begins `# `): the page, the run, the stop reason, and the environment (see "Environment record," below), so each file stands alone as evidence. After one blank line comes **one line per step**, everything NVDA said in response to one keystroke. Setup steps are labeled (`[to bottom] …`, `[to top] …`), and a step where NVDA said nothing is written `[no speech]`, so line N of the body is always step N.
- **JSON transcripts** hold one record per step (number, command, spoken text, duration, time since the pass started, and for the tab pass the focus state and focused element) plus the page, pass, step count, stop reason, duration, timestamp, errors, warnings, and the environment record.
- **Environment record.** `run.json` records, and every transcript repeats: page source (sitemap URL, or page list file with its SHA-256), driver and version, NVDA version (and Guidepup's build id), NVDA language, capture mode, browser and version, OS, voicecap version, a hash of the effective config, run timestamp, and NVDA's speech, document formatting, browse mode, and keyboard settings. It also holds the computer's details (see [What each run records](#what-each-run-records)), which `run.json` and the JSON transcripts keep, and the TXT header leaves out.
- **Hashes.** `run.json` records the SHA-256 of every transcript file (integrity) and of each pass's TXT body without the header (content). "Changed since review" and `--compare` use the content hashes, because headers include timestamps and run ids.

</details>

## The audit record

voicecap can keep a permanent, non-destructive record of every run and every manual session, for audit and legal purposes: one private Git repository, pushed often, where the runs for any site can be counted and every file can be trusted not to have changed. Point every voicecap command at one folder outside your site's own repository — the **transcripts home** — and give that folder to Git on its own.

### Layout

The home's folders are shown under [The transcripts folder](#the-transcripts-folder). A site's folder is its host name, lowercased, plus `_<port>` when the URL has one, with anything other than `a-z 0-9 . -` replaced by `_` (`https://dvfr.illinois.gov` → `dvfr.illinois.gov`; `http://127.0.0.1:4747` → `127.0.0.1_4747`). `review`, `manual add`, and `report` work in one site's folder at a time (see [Other commands](#other-commands) for how they pick it).

The home's top can also hold your own files and folders, notes for example. A folder there is a site's folder only when it holds a date folder, `reviews.json`, `latest.txt`, or `report.html`; any other is left alone, and `review`, `manual add`, `report`, and `verify` never take it for a site.

### What each run records

<details>
<summary>Page titles, every failed attempt and its code, the reviewer and the listener's statement, and the computer's details</summary>

Beyond its transcripts, each run's `run.json` records:

- **Each page's title**, as the browser reports it. A page with no title, or one that never loaded, has none (`null`), and so does every page of a replayed run.
- **Every failed attempt at a page**, in every session of the run, including those a later attempt made good. Each is written to `run.json` as it happens, before the screen reader and browser are started again, so Ctrl+C, a closed window, or a crash doesn't lose it, and a later session adds its own after it. Each attempt's record keeps:
  - its number, counted across the sessions, and when it started and ended (local time, to the millisecond);
  - the pass, the step, and the command it sent (`nextLine`, say, or `openPage` for a page that didn't open);
  - the error's message, and why it failed, as one of these codes:
    - `foreground`: another window came to the front;
    - `locked`: the computer locked;
    - `screen-reader-stopped`: the screen reader didn't start, or stopped;
    - `browser`: the browser didn't start, changed, closed, or crashed;
    - `http`: the website answered with an HTTP error;
    - `unreachable`: the website couldn't be reached;
    - `open-timeout`: the page didn't open in time;
    - `step-timeout`: a step took too long;
    - `page-timeout`: the whole page took too long;
    - `unexpected`: an error voicecap didn't expect, which may be a fault in voicecap itself. Its record also keeps the error's stack, with the home folder replaced by `%USERPROFILE%` (or `~`);
  - whether the screen reader and browser were started again for the next attempt.
- **Each session's reviewer, and the listener's statement.** The statement is the answer to "Did you listen as NVDA read these pages?" The session's record keeps the answer, when voicecap asked and when it was answered, and how many pages the session went through (see [Run an audit](#run-an-audit)).
- **The computer's details**, in each session's environment record, and never the computer's maker, model, or name, or the account's name:
  - the operating system: its edition, version, build, and architecture;
  - the processor: its name, base speed, physical cores, and logical processors;
  - memory, and the display: its resolution and refresh rate, and on Windows its scaling;
  - the browser window's fixed size: 1280 × 960 (none for a replay, which opens no browser);
  - the time zone and its offset, and the display language;
  - the versions of Node.js, voicecap, Guidepup, and Playwright.

Once the run completes, its seal covers all of this.

</details>

### What's guaranteed

- **A completed run is never modified again.** `run.json` records every transcript file's SHA-256 as it's written, and once the run completes, the whole record is sealed (see "Checking the record," below).
- **Reviews are append-only.** A correction is a new entry in `reviews.json`, never an edit to an earlier one.
- **A retried or resumed page keeps its earlier attempt**, moved to `attempts/<slug>/<n>/` instead of being overwritten. Reports and comparisons ignore it.
- **voicecap 0.2.0's layout is left alone.** If a home still has its `runs/` or `manual/` folders, they're never read or moved; a run just says once that it saw them.

### Checking the record: `voicecap verify`

<details>
<summary>How seals and the review chain work, what <code>voicecap verify</code> checks, and what it can't catch</summary>

```bash
voicecap verify [--site <url>] [--out <dir>]
```

Every record voicecap finishes writing is sealed: a completed run's `run.json`, each manual session's `session.json`, and each review entry carry a `seal`, a SHA-256 of the record itself. Review entries also chain to the one before them (`seq`, `prev`). A reordered entry, or a deleted one that a later entry follows, breaks the chain; an edited one no longer matches its own seal, including the newest entry, which no later entry points to yet.

`verify` checks every site folder in the home, or one with `--site`: each run's seal and the SHA-256 of every file it recorded; each manual session's seal, its transcript, and its raw copy when one was kept; and the whole review chain. It prints one line per problem it finds, then a summary for each site, and exits **0** when everything matches and **3** when something doesn't. An incomplete run (still running, or interrupted) is listed, not counted as a problem, and a missing raw NVDA log isn't either: `.gitignore` keeps those out of Git on purpose (see below), so a clone of the home never has them.

`verify` doesn't check the regenerated views (a site's `report.html`, `latest.txt`, `share/current.html`, and `compare/`), a run's own `report.html` and `compare/` diffs, or kept earlier attempts.

**What it can't catch on its own:** someone who edits a record and recomputes its seal, and every later seal and `prev`; and someone who deletes the newest review entries, or a whole run or manual session, which leaves nothing for `verify` to find: only Git history shows it. Git history pushed to a protected branch catches both, since rewriting commits that are already pushed takes a force-push, and a branch protected against force-pushes refuses it — which is why the setup below has you protect the branch and push often.

</details>

### What `.gitignore` keeps out, and why

<details>
<summary>What <code>.gitignore</code> keeps out of Git, and why</summary>

voicecap writes `.gitattributes` and `.gitignore` at the home's top the first time it needs them, and never overwrites them, so your own edits or additions stay. `.gitattributes` (`* -text`) keeps Git from changing line endings on checkout, which would otherwise make the recorded hashes stop matching the files. `.gitignore` keeps out:

- **`.voicecap.lock`**, the marker a run holds while it's writing.
- **Manual sessions' raw NVDA logs** (`**/*_manual_*/raw/`). At Input/output level, NVDA's log records every keystroke, including passwords typed into forms — not something to put in Git. The raw copy's SHA-256 stays in `session.json` either way, so a home missing a raw copy isn't something `verify` will flag.
- **The shareable page** (`**/share/current.*`). voicecap writes it again after every run and review, so a copy in Git each time would only make the record bigger; it's made from the records, which are in Git. A home whose `.gitignore` voicecap wrote before 0.6.0 doesn't have this line: add it by hand.
- **Temporary files a crash can leave behind** (`.*.tmp`). voicecap writes each file under a temporary name first, then renames it into place.
- **Files the operating system adds** to folders you open: `.DS_Store` (macOS), `Thumbs.db` and `desktop.ini` (Windows).

> **Never commit an unredacted raw NVDA log.** See [Manual NVDA sessions](#manual-nvda-sessions).

</details>

### Setting it up

<details>
<summary>Making the private repository on Windows or a Mac, saving runs to it, and protecting the branch</summary>

**Windows, in PowerShell:**

```powershell
mkdir C:\Users\cschw\code\voicecap-transcripts
cd C:\Users\cschw\code\voicecap-transcripts
git init
gh repo create voicecap-transcripts --private --source .
setx VOICECAP_TRANSCRIPTS 'C:\Users\cschw\code\voicecap-transcripts'
```

`gh repo create --private --source .` is one way to make the private repository; it adds the `origin` remote. Leave off `--push` — there's nothing to push yet. `setx` only takes effect in a new terminal. In Git Bash, the same lines work, except that the first two become `mkdir -p /c/Users/cschw/code/voicecap-transcripts && cd /c/Users/cschw/code/voicecap-transcripts`.

**macOS:**

```bash
mkdir -p ~/webdev/voicecap-transcripts && cd ~/webdev/voicecap-transcripts && git init
gh repo create voicecap-transcripts --private --source .
```

If the repository already exists, made on another computer, clone it instead: `gh repo clone voicecap-transcripts ~/webdev/voicecap-transcripts`. Then add this line to `~/.zshrc`, which also takes effect in a new terminal:

```bash
export VOICECAP_TRANSCRIPTS=~/webdev/voicecap-transcripts
```

**After runs, reviews, or manual sessions,** the same in PowerShell, Git Bash, and a Mac's terminal:

```bash
git add -A
git commit -m "voicecap runs"
git push -u origin HEAD
```

After the first push, plain `git push` is enough. `git commit -S` signs the commit, if you want proof of who committed. With the record on two computers, `git pull` before recording reviews, and push after: reviews recorded on both before they're synced break the review chain, and `verify` reports it.

**Once, after the first push:** on GitHub, protect the default branch against force pushes and deletion, in the repository's Settings → Rules → Rulesets, or Settings → Branches → Branch protection rules. Whether a private repository can use these depends on your GitHub plan.

Keep the repository private: manual sessions can carry reviewer names, notes, and typed text.

</details>

## Long runs, interruptions, and resuming

<details>
<summary>Measured run times, and how voicecap resumes, retries failed pages, and handles Ctrl+C and crashes</summary>

**Measured run times** (Windows 11, NVDA 2026.2, Chrome 153): each step takes **1.3 seconds** (voicecap waits for a second of silence after every keystroke), and each page adds about **17 seconds**, about 6 per pass, to load the page in a fresh browser, bring it to the front, and move NVDA to the top. So a page takes about 1.3 s × its steps + 17 s:

| Pages | Steps per page (all three passes) | Time per page | 100 pages | 2,000 pages |
| --- | --- | --- | --- | --- |
| Five sampled pages of i2i.illinois.gov (measured) | 46–68 | 78–106 s, 92 s on average | about 2½ hours | about 2 days |
| A long page | 250 | about 6 minutes | about 9½ hours | about 8 days |

Count a page's steps as its lines in browse mode, plus its headings, plus its focusable elements. Interruptions are normal: reboots, Windows Update, power cuts.

- **Resuming.** At the start of a run voicecap stores the page list and a hash of the settings that matter (site, page source, passes, filters, limit, driver, capture mode, step caps, NVDA settings, browser). `run.json` is rewritten after every page (atomically: a temporary file is flushed to disk and renamed, with retries while Windows holds the file). Running the same command again resumes the most recent incomplete run with the same settings, skipping pages already done (failed pages are retried). Otherwise voicecap starts a new run and says why. `--fresh` always starts a new run.
- **Sitemap runs resume with the page list stored when they started**, so a sitemap that changed in the meantime (a new news item, say) doesn't block resuming. A page list file is identified by its contents, so editing it starts a new run.
- **A failing page never stops the run**: it's recorded, reported, and the run moves on.
  - **Up to 5 tries** (`pageAttempts`). voicecap tries the page again after a timeout (steps and whole pages have timeouts), when NVDA or the browser stops responding, or when another window takes the foreground. Each retry starts NVDA and the browser fresh.
  - **Every attempt is kept** under `attempts/`, and the page's record names each failed attempt's reason, so a page that needed three tries says so.
  - **Too many failures in a row:** after `maxConsecutiveFailures` pages in a row (default 5) fail every try, voicecap stops with exit code 2 instead of marking every remaining page failed. Fix the problem and rerun to resume.
- **Restarts.** NVDA and the browser are restarted every `restartEvery` pages (default 50).
- **If NVDA dies** (it crashes, or someone closes it), or Guidepup loses its connection to it, the step in progress fails rather than being recorded as silence, and voicecap restarts NVDA and the browser and tries the page again, up to `pageAttempts` times in all.
- **If the browser updates itself** during a run (Chrome does, in the background), the page being opened when the new version starts fails, and voicecap stops with exit code 2 when it restarts the browser for the next page, so the version recorded with the transcripts stays true. Run the same command again to resume with the new version recorded; the failed page is retried. (On the last page, the run completes instead, with that page failed: exit code 3.)
- **Ctrl+C** saves state and shuts down NVDA and the browser. When the session read pages, voicecap then asks whether you listened (see "The question at the end" under [Run an audit](#run-an-audit)), and it exits with code 130 once you've answered. The page in progress is redone on resume. Press Ctrl+C a second time to exit immediately; at the question, Ctrl+C gives no answer, and voicecap exits. The browser is in front while voicecap works, so click the terminal window first, or the keystroke goes to the browser.
- **One run per output folder** at a time (a lock file, taken over if the process that held it is gone).
- **HTTP errors are page problems.** A page that answers 404 gets a single try, since trying again can't help. A 5xx is tried again, up to `pageAttempts` times. Either is recorded as failed, but it doesn't count toward stopping the run and doesn't restart NVDA; only timeouts and driver errors do. When a run resumes, pages never tried come first and pages that failed earlier are retried last, so a resumed run always makes progress.
- **Avoid synced folders** (OneDrive, Dropbox) for the output: sync clients and antivirus scans can hold files open. voicecap retries, but a folder they keep locked can still stop a run. If Git on Windows complains about long paths in `transcripts/`, run `git config core.longpaths true`.

</details>

## Reviews: the audit trail

<details>
<summary>Recording what you found with <code>voicecap review</code>, and how the history is kept</summary>

A reviewer reads a page's transcripts and catches what automated checkers such as axe can't: reading order that is technically right but confusing, alt text that is present but unhelpful, a page that is hard to use. `voicecap review` records what they found:

```bash
npx @icjia/voicecap review --page https://dvfr.illinois.gov/grants/fy27-jag --status issue --note "Table headers not announced"
npx @icjia/voicecap review --page https://dvfr.illinois.gov/grants/fy27-jag --status fixed --note "Headers added in #412"
```

Each page has a full, append-only history in its site's `reviews.json` (see [The audit record](#the-audit-record)). Every entry records the status (`unreviewed`, `reviewed` with no issues, `issue` found, `fixed`), the reviewer, a timestamp, the note, the run reviewed (by default the latest run with transcripts for the page; `--run` picks another), and the SHA-256 hashes of that run's transcripts for the page. Entries are never edited or deleted: a correction is a new entry, and the latest entry is the page's current status. Each entry is sealed and chained to the one before it, for `voicecap verify` to check (see [Checking the record](#checking-the-record-voicecap-verify) for what it can and can't catch). voicecap refuses to overwrite a `reviews.json` it can't read.

The reviewer name comes from `--reviewer`, then the `VOICECAP_REVIEWER` environment variable, then `git config user.name`, then `reviewer` in the config. voicecap won't record a review without one. Runs record the same name with each session (`--reviewer` on the run, which `init` asks for), but go ahead without one.

A page is **changed since review** when its transcripts in the run shown differ from the ones recorded with its latest review.

</details>

## Manual NVDA sessions

`voicecap manual add` imports a hands-on NVDA session for a page into its site's folder in the transcripts home, under `<date>/<time>_manual_<page-slug>/` (see [The audit record](#the-audit-record)). voicecap recognizes two kinds of input.

### Speech Viewer

In NVDA, open NVDA menu → Tools → Speech Viewer, use the page, then copy the Speech Viewer text into a file:

```bash
npx @icjia/voicecap manual add speech.txt --page https://dvfr.illinois.gov/grants/fy27-jag
```

Speech Viewer has no timestamps or keystrokes: each line is one utterance, and its items are separated by two spaces (voicecap converts them to ", " like a run's transcripts).

### The NVDA log (Input/output level)

<details>
<summary>Turning on NVDA's log, importing it, and importing just part of it</summary>

The log records each keystroke and what NVDA said, with times:

1. NVDA menu → Preferences → Settings → General → **Logging level → Input/output**. Press OK.
2. Test the page.
3. Copy the log: NVDA menu → Tools → View log, or copy `%TEMP%\nvda.log` (`nvda-old.log` holds the previous NVDA session).
4. **Set the logging level back** to its previous value ("Info" by default) when you're done.

```bash
npx @icjia/voicecap manual add nvda.log --page https://dvfr.illinois.gov/grants/fy27-jag --redact-typing
npx @icjia/voicecap manual add nvda.log --page https://dvfr.illinois.gov/about/ --from 14:05 --to 14:20
```

voicecap keeps only the keystrokes (`Input: …`) and speech (`Speaking […]`) and discards everything else. Log times have no date: the session date comes from `--date`, or else the file's modification date (voicecap prints it so you can confirm), and sessions that cross midnight are handled. `--from` and `--to` import part of a log, as in the second example, so one log can cover several pages.

</details>

### What gets saved

- a clean `.txt` transcript (for logs: each keystroke followed by what NVDA said in response);
- a `.json` file with the entries (time, key or speech, text) and the page, input format, session start and end, NVDA version, import date, and reviewer;
- the unmodified original in `raw/`, named so it doesn't end in `.log` (many repositories ignore `*.log`, which would silently leave the evidence uncommitted), with its SHA-256 in the JSON. `--no-raw` skips the copy but keeps the hash.

Sessions are named by their date and time, so several sessions per page can coexist.

### Privacy

<details>
<summary>Typed text in NVDA's log, what <code>--redact-typing</code> does, and what it can miss</summary>

**Input/output logs record every keystroke, including text typed into form and password fields.** voicecap warns on every log import, and warns again if it finds typing in form fields and you didn't ask to redact it.

`--redact-typing` replaces keys typed while focus is in an editable field, and NVDA's spoken echo of them, with `[typed text redacted]`. With `--redact-typing` the raw log is not kept (only its SHA-256, with a note that it was withheld for privacy); `--keep-raw` keeps it anyway, with a warning.

The redaction is a heuristic, and it has limits. It relies on NVDA announcing an editable role (English phrasing such as "edit" or "password edit") when focus moves to the field, so it can miss:

- fields reached without that announcement (by mouse, or in apps NVDA reads differently);
- pasted text that NVDA reads back;
- error messages that quote what you typed, and autocomplete suggestions;
- input methods (IME) and typing in other applications.

It errs on the side of hiding things. After focus leaves a field by mouse click, speech stays redacted until the next focus key (Tab, Escape, …), which can hide ordinary page speech. Enter counts as leaving a field, so further typing in a multi-line field after Enter is only caught when NVDA logs it as a typed word. With `--from`/`--to`, redaction still follows focus from the start of the log, so a field entered before the window is handled.

Check the clean transcript before committing it, and never commit an unredacted raw log.

</details>

## Verifying transcript fidelity

<details>
<summary>How to compare a run's transcript with a Speech Viewer capture, and what to normalize first</summary>

This is a different question from `voicecap verify` (see [The audit record](#the-audit-record)), which checks that a recorded file hasn't changed since voicecap wrote it. To check that a run's transcript really is everything NVDA said, compare it with a Speech Viewer capture of the same page:

1. Open Speech Viewer, load the page, press Ctrl+Home, then Down Arrow until the end, and save the Speech Viewer text.
2. Compare it with `read.txt` (skip the header block and the `[to bottom]` line). Normalize first:
   - **Separators.** Speech Viewer separates items with two spaces and utterances with new lines; transcripts separate items with ", " and put all the utterances of one keystroke on one line, joined with ". ".
   - **Symbols.** Speech Viewer shows the text before NVDA turns symbols into words; transcripts have the words NVDA speaks. So Speech Viewer's `© 2026` and `•` are `copyright 2026` and `bullet` in a transcript (NVDA's English symbol names, at its default symbol level).
   - **Empty items.** Transcripts keep NVDA's empty text items (`edit, , button` for an empty field); Speech Viewer shows them as extra spaces.

`fixture/manual/speech-viewer.txt` is a real capture of the fixture's home page, and the fixture tests compare it with the fixture run's read transcript this way. On Windows, `pnpm test:nvda` repeats the whole check against live NVDA.

</details>

## Reading the report

<details>
<summary>What the report shows, when it's regenerated, and how <code>--compare</code> marks changes</summary>

Open a site's `report.html` in a browser: `transcripts/dvfr.illinois.gov/report.html`, say, or the path a run prints when it completes. It's a single self-contained file (no external assets) and is itself accessible.

- **Summary**: the page source (curated list or full sitemap), driver and capture mode, and counts: pages, transcribed, reviewed, changed since review, manually tested, open issues, errors, skipped URLs. Banners mark replayed output ("not a live NVDA session"), incomplete runs, and environment changes.
- **Pages table**: one row per page with its template, run status, step counts and stop reasons per pass, heuristic flags, current review status (with reviewer and date), number of review entries, a "changed since review" marker, manual sessions, and links to every transcript. With `--compare`, a column marks changed pages and links to the text diffs.
- **Filters** (flagged, review status, template, changed since review, manually tested) are ordinary form controls; the number of pages shown is announced. Without JavaScript the full table is still there.
- **Skipped URLs**, **Review history** (every entry for every page), **Manual NVDA sessions**, and the **Environment** record follow.

A completed run, `review`, `manual add`, and `voicecap report` regenerate it. Each run's folder keeps its own `report.html` snapshot from when it completed. `voicecap report --run <id>` renders a specific run, including an incomplete one (clearly marked).

**Compare.** `--compare previous` (or a run id) compares the pages both runs contain, marks changed pages, and links to line diffs of the transcripts (not the header blocks). Pages that appear in only one run are listed. If the two runs' environments differ (NVDA, browser, voicecap, NVDA settings, capture mode), the report says so prominently, because some changes may come from the tooling rather than the site.

</details>

## The shareable page

<details>
<summary>What the page is, how voicecap writes it, which runs count, its sections, the fingerprint check, and what to know before you send it</summary>

`share/current.html`, in a site's folder, is the page to send to people who will never open the transcripts home: a manager, say, or an auditor. It's one file, and it opens in any browser, offline. It shows where the site stands, from its sealed runs, and the person's review: what they listened to, found, and fixed. It explains every problem that came up during the runs, with its record, word for word, and it can check its own fingerprints, in the browser, with no network.

voicecap writes it whenever it rewrites the site's `report.html`: when a run completes, and after `voicecap review`, `voicecap manual add`, and `voicecap report`, which also prints `Shareable page: <path>`. (The programmatic API's `generateReport`, `addReview`, and `addManualSession` write it too.) It's rewritten each time, so keep a copy of the file you send. A page that can't be written is a warning, never a failed run, review, or report.

- **One self-contained file.** Its styles, fonts, and data are inside it, and nothing is loaded from outside. It's dark at first, with a button for a light version, and it prints light. Its detail is folded under lines that say what's inside. Each fold opens with a click, scripts or not; "Open every section", at the top, opens them all; and so does printing. Like the report, it's itself accessible: voicecap's tests run axe on it, in both themes, with every fold shut and every fold open.
- **Only completed, sealed, live runs count.** Its pages are those of the latest run that counts whose pages came from a sitemap or a page list. A later run given its pages with `--page` is a spot check: its transcripts are shown for the pages it read, and its failures are said, but it doesn't change which pages are in scope. Each page shows its newest transcripts from any run that counts.
  - A page whose latest attempt failed shows the failure beside its last good transcripts, and is a task under "What's still to do".
  - A page the latest run's list no longer has goes in a small table, "No longer listed".
  - A replayed run (`--replay-from`), a run that was interrupted or never finished, a completed run with no seal, and a run whose `run.json` can't be read never count toward a result. The page lists each one it left out, with why, and with no run that counts, it says so.
- **A person's review, first.** The summary leads with what the person did: that they listened as NVDA read the pages (their answer to the question at the end, under [Run an audit](#run-an-audit)), what they found, and what they fixed (see [Reviews: the audit trail](#reviews-the-audit-trail)). It says a person listened, reviewed, or fixed something only where the records say so, and what's left appears as tasks, under "What's still to do".
- **Nothing left blank.** Where a run didn't record something the page shows, it says so, as in "Not recorded: this run used voicecap 0.5.0".

Its sections, in order:

- **Summary**: the result in one sentence, six numbers (pages in scope, pages transcribed, pages with flags, pages listened to live, lines NVDA spoke, and NVDA time), what needs attention, how complete the test was, what's still to do, and when and how it was run.
- **How voicecap works**: the six steps, the first lines NVDA said on the site's home page, and when to run voicecap.
- **Every page**: a card for each page, with its result, flags, review, line counts, and a link to its transcripts.
- **What the flags found**: each flagged page's rules, with NVDA's own words quoted from the transcripts.
- **What changed since the last run**: the pages that sound different from the run before (the latest earlier run that counts, with the same page source), line by line, with the changed words marked. Pages that sound the same are counted, not listed.
- **Problems during the runs**: every failed attempt in the runs the page draws on, including those a later attempt made good. Each has its kind: another window took the screen, the computer locked, NVDA stopped, the browser stopped, the website answered with an error or couldn't be reached, a step took too long, or an unexpected error, which may be a fault in voicecap itself. Each says what voicecap did, whether it happened again (by what came after it: a run before it that read the page shows only that the page could be read), and what it means for the results. Then comes the record of it, word for word, with the home folder replaced by `%USERPROFILE%` (or `~`).
- **What these results cover**: the pages and passes, and the technical limits.
- **The evidence behind these results**: the fingerprint check, then each run the page draws on, with its facts, its test environment, and the fingerprint of every file.
- **How voicecap came to be**: why it exists, its timeline, and a few things worth knowing.
- **Appendix: every transcript**: each page's read, headings, and Tab transcripts, word for word.

**The fingerprint check.** "Check the fingerprints", in the evidence, checks every transcript the page shows against the fingerprint in its run's sealed record, each run's seal, and each review's seal and the review chain, all in the browser. It also checks that the text each transcript shows in the appendix is the file the page carries, so the transcripts shown are exactly the ones the sealed records list. "Show a change being caught" repeats the check on a copy with one character changed, in memory only, so a reader can see a mismatch named. The check shows that the page agrees with itself. It can't show that the page itself wasn't changed, since whoever changed it could change the fingerprints too. For that, compare the file's own fingerprint (`Get-FileHash <file>` in PowerShell, `shasum -a 256 <file>` on a Mac) with one its sender noted down, or run `voicecap verify` on the transcripts home, which checks the originals. `voicecap verify` leaves `share/` alone: the page is made again from the records each time, and `verify` checks the records.

**Before you send it:** the page carries its runs' sealed records exactly as voicecap wrote them, for the fingerprint check, and those can include file paths with your account name in them (a page list's, say), which the page itself never shows.

**The site's name,** the page's headline, is `report.siteName` in the config (see [Configuration](#configuration)), else the home page's title as the latest run recorded it, else the site's host name. The setting names every site the config is used with, so give each site its own config when they need different names.

</details>

## Heuristic flags

<details>
<summary>Each flag and when it's raised, and how the rules can be changed</summary>

Flags point a person at pages worth a closer listen. They never fail a page or change the exit code.

| Flag | Raised when |
| --- | --- |
| `generic-link-text` | A pass announces generic link text at least twice: "click here", "read more", "learn more", "here", "more", … or a link with no name. |
| `unlabeled` | A button, edit field, or other control is announced with no name ("button", "edit"), a graphic has no description, or NVDA says "unlabeled". Form fields (edit, combo box, check box, radio button) count only in the tab pass: in the read pass, NVDA reads a field's label as separate text, so "edit" alone there doesn't mean the field has no name. |
| `read-not-finished` | The read pass stopped at its step cap or the repeat safety net instead of the end of the page. |
| `headings` | The page has no headings, or its first heading isn't level 1. |
| `tab-no-stops` | Tab reached no focusable elements. |
| `tab-before-main` | Ten or more focus stops come before main content and the first stop isn't a skip link (judged from the focused elements, not speech). |
| `repeated-phrase` | The same speech repeats four or more times in a row (a possible focus trap or duplicated content), ignoring the read pass's end-of-page repeat. |

The rules, including the NVDA phrasing they match, live in the config (`flags`), and you can add your own phrase rules. The phrasing assumes NVDA's English interface. If you change the rules, `voicecap report` recomputes the flags from the transcripts, without running NVDA again.

</details>

## Configuration

<details>
<summary>An example config file, and every setting with its default</summary>

Put a `voicecap.config.ts` (or `.mts`, `.js`, `.mjs`, `.json`) in the folder you run voicecap from. Every setting is optional:

```ts
import { defineConfig } from "@icjia/voicecap";

export default defineConfig({
  readiness: { readySelector: "#__nuxt main", settleMs: 1000 },
  reviewer: "Your Name",
  report: {
    title: "NVDA transcripts: dvfr.illinois.gov",
    agency: "Illinois Criminal Justice Information Authority",
    logo: "data:image/png;base64,iVBORw0KGgo...",
  },
});
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `driver` | `"guidepup"` | `"guidepup"` (NVDA on Windows), `"replay"`, or `"at-driver"` (stub). `--replay-from` selects `"replay"`. |
| `replayFrom` | `null` | Run folder for the replay driver. |
| `browser.channel` | `"chrome"` | Playwright browser channel; `"chrome"` is the installed Google Chrome. |
| `browser.fallbackToChromium` | `true` | Use Playwright's Chromium if the channel isn't installed. |
| `capture` | `"complete"` | `"complete"` keeps everything NVDA says per keystroke; `"initial"` keeps only the first utterance. |
| `nvdaSettings` | `{}` | NVDA settings overrides (applied through Guidepup's `start({ settings })` and recorded). |
| `readiness.readySelector` | `null` | Wait for this CSS selector after network idle. |
| `readiness.settleMs` | `500` | Extra delay after the page is ready. |
| `readiness.networkIdleTimeoutMs` | `15000` | How long to wait for network idle. |
| `timeouts.stepMs` | `30000` | Per-step timeout. |
| `timeouts.pageMs` | `1800000` | Per-page timeout (30 minutes). |
| `timeouts.driverStartMs` | `120000` | Timeout for starting NVDA and the browser. |
| `passes` | `["read","headings","tab"]` | Passes run when `--passes` isn't given. |
| `stepCaps` | `{ read: 400, headings: 200, tab: 300 }` | Hard step caps per pass (`--max-steps` overrides all three). |
| `read.endConfirmations` | `1` | Extra Down Arrows that must repeat the last line before the end counts as reached. `0` is the plain "spoken, then repeated" rule. |
| `repeatLimit` | `10` | Stop a pass when the same speech occurs this many times in a row. |
| `restartEvery` | `50` | Restart NVDA and the browser every N pages. |
| `maxConsecutiveFailures` | `5` | Stop the run (exit 2, resumable) after this many failed pages in a row. |
| `pageAttempts` | `5` | How many times a page is tried before it's recorded as failed. Each retry starts NVDA and the browser fresh (except after an HTTP 5xx). A page that answers with an HTTP 4xx gets one try. |
| `phrasing.noNextHeading` | `"^no next heading$"` | NVDA's announcement after the last heading (a regular expression). |
| `flags.*` | see [Heuristic flags](#heuristic-flags) | Each rule's `enabled` switch, phrasing, and thresholds; `flags.custom` adds phrase rules `{ id, description, passes, pattern, minCount }`. |
| `manual.editableRoles` | `["edit", "password edit", …]` | Words that mean focus is in an editable field (redaction). |
| `manual.focusKeys` | `["tab", "shift+tab", "enter", …]` | NVDA key names that move focus (redaction). |
| `reviewer` | `null` | Default reviewer name. |
| `report.title`, `report.agency`, `report.logo` | `"NVDA transcript report"`, `null`, `null` | Report branding; the logo must be a `data:image/…` URI. |
| `report.siteName` | `null` | The site's name, the headline of the shareable page (see [The shareable page](#the-shareable-page)). It names every site the config is used with, so use a config per site for different names. Without it, the headline is the home page's title as the latest run recorded it, else the site's host name. |

Unknown settings are errors, to catch typos. The SHA-256 of the effective config is recorded with every run.

</details>

## Programmatic API

<details>
<summary>An example, and what <code>runAudit</code> and the other functions take and return</summary>

```ts
import {
  addManualSession,
  addReview,
  createConsoleLogger,
  generateReport,
  loadConfig,
  runAudit,
} from "@icjia/voicecap";

const result = await runAudit({ site: "https://dvfr.illinois.gov", pages: "pages.csv" });
console.log(result.runId, result.exitCode);

await addReview({ page: "/about", status: "reviewed", reviewer: "Pat Reviewer" });
await addManualSession({ file: "nvda.log", page: "/about", redactTyping: true });

const { config } = await loadConfig();
await generateReport({ outDir: result.siteDir, config, logger: createConsoleLogger() });
```

`runAudit` accepts every CLI option, with `--page`'s values as `pageUrls` (an array of full URLs or root-relative paths), plus `signal` (an `AbortSignal` that interrupts the run like Ctrl+C), `logger`, `config`, `driver` (any object implementing `ScreenReaderDriver`), and `askListener` (a function called when a session that read pages ends, however it ends, but never for a replay, and given `{ screenReader, pagesRead }`: the screen reader's name and how many pages the session went through; it asks whether the person listened, and resolves to `"all"`, `"part"`, or `"no"`, or to `null` for no answer; without it, nothing is asked). `generateReport`'s `outDir` is a site's folder in the transcripts home, not the home itself; `runAudit`'s result gives you one as `siteDir`, and `addReview` and `addManualSession` find theirs the same way `review` and `manual add` do (`--site`, or a full page URL, or the home's only site). To find one yourself, `siteDirFor(resolveHome({ env: process.env, cwd: process.cwd() }), site)` gives a site's folder, and `chooseSiteDir` picks one as those commands do; `siteFolder` names it. The data formats (`RunJson`, `TranscriptJson`, `ReviewsFile`, `ManualSessionJson`) are exported as TypeScript types.

</details>

## Drivers

<details>
<summary>The <code>guidepup</code>, <code>replay</code>, and <code>at-driver</code> drivers, and why there's no VoiceOver driver yet</summary>

A driver owns both the screen reader and the browser, so the rest of voicecap never touches Guidepup or Playwright. The `ScreenReaderDriver` interface (`src/drivers/types.ts`) is expressed in actions (open a page, next line, next heading, next focusable, to top, to bottom, focus checks); voicecap's core decides when a pass stops from what the driver returns, so replay exercises the same stop logic as a real run.

- **`guidepup`** (default): NVDA through [Guidepup](https://github.com/guidepup/guidepup), with the browser driven by Playwright as a library. Windows only. It launches the browser itself (with a new profile for each page load) and attaches Playwright to it, because a browser launched by Playwright pretends to have focus, and the driver relies on real focus to keep keystrokes out of other windows. It removes Guidepup's own Ctrl+C handlers (they stop NVDA but never exit), so voicecap saves its state first and stops NVDA exactly once.
- **`replay`**: no screen reader or browser. It plays back a run folder (`--replay-from`), matched by URL: each pass's recorded steps in order, then NVDA's end behavior (the last line repeats, "no next heading", focus leaves the page). Replayed output is labeled as such in every transcript and report.
- **`at-driver`**: a stub for the W3C [AT Driver](https://w3c.github.io/at-driver/) protocol. Every method throws "not implemented"; the comments show how each maps to AT Driver messages. Completing it would mean installing the NVDA AT Automation add-on and server ([Prime-Access-Consulting/nvda-at-automation](https://github.com/Prime-Access-Consulting/nvda-at-automation), a WebSocket server on `ws://localhost:3031` by default), implementing `src/drivers/at-driver-nvda.ts` along its comments (browser work stays with Playwright), and running the same fixture checks.

There's no VoiceOver driver yet: it comes in a later release. Until then, the Mac's checks and live test drive VoiceOver through Guidepup directly, in `src/drivers/voiceover/`.

</details>

## Updating Guidepup

<details>
<summary>The five steps for moving to a new Guidepup</summary>

Guidepup changes its API across versions and releases often, so voicecap pins `@guidepup/guidepup` and `@guidepup/setup` exactly and upgrades them together:

1. `pnpm add -E @guidepup/guidepup@<version> @guidepup/setup@<version>`.
2. Re-check the driver against the new versions' source (`src/drivers/guidepup/nvda.ts` lists what it relies on): method names, capture behavior, signal handling, where the NVDA build is installed. On the Mac, `src/drivers/voiceover/` mirrors some of Guidepup 0.34.0's own choices too: where it caches VoiceOver's files, the folder it links voicecap's VoiceOver settings into, and the disk image it mounts.
3. Re-run `voicecap setup`: a new Guidepup can pin a new NVDA build, or new VoiceOver files (setup reads them from the installed `@guidepup/guidepup`'s `manifest.json`).
4. On Windows, run `pnpm test:nvda`: it runs voicecap with real NVDA on the fixture site and checks end-of-page detection, "no next heading", the tab pass starting at the skip link, and complete capture against Speech Viewer. Then `pnpm fixture:capture` replaces the fixture's recorded run; review the transcript changes with `git diff`, and update the flag phrasing in `src/config/defaults.ts` if NVDA's wording changed.
5. For a temporary fix in Guidepup itself, use `pnpm patch @guidepup/guidepup` and `pnpm patch-commit` rather than forking it.

</details>

## Known limitations

<details>
<summary>Timing, a portable NVDA, English phrasing, the computer being voicecap's during a run, and more</summary>

- **Timing.** Driving a screen reader is timing-sensitive: a slow page or a busy machine can produce different output between runs. voicecap captures each keystroke's speech until a second of silence, which absorbs most of this, but compare runs with care.
- **Not a stock setup.** voicecap uses Guidepup's portable NVDA build with its own settings, and one browser (Chrome by default). Real users' NVDA versions, settings, and browsers differ.
- **English phrasing.** Stop detection and flags match NVDA's English wording; `voicecap doctor` warns when NVDA's language isn't English (NVDA follows the Windows display language).
- **The computer is voicecap's during a run** (see [Windows setup](#windows-setup-for-someone-new-to-windows), step 6). voicecap checks that its browser is in front before and after every step, but a window that comes forward in the moment before a keystroke (Guidepup silences NVDA first, which takes at least a quarter of a second) can still receive that one keystroke. Pop-up dialogs (Windows Update, chat apps) count as other windows too.
- **Frames.** voicecap notices another window coming forward from the page's focus events. While focus is inside a frame (an embedded video, map, or form), a switch to another window is noticed only if it lasts until the end of the step.
- **One user at a time.** The lock that lets only one voicecap drive NVDA is per Windows user, but NVDA's connection (port 6837 on 127.0.0.1) is shared by the whole computer: don't run voicecap as two Windows users at once.
- **Shared computers.** While a page is open, its browser listens for remote debugging on 127.0.0.1 (with a throwaway profile), where other users of the same computer could connect. On a single-user desktop that doesn't matter.
- **Pages that talk nonstop.** Guidepup waits for NVDA to fall silent before each keystroke. On a page with content that announces itself continuously (a fast-updating live region, an auto-advancing carousel), a step can time out; voicecap then restarts NVDA and the browser and tries the page again, up to 5 times in all, and records it as failed if every try times out.
- **Folders with spaces or special characters.** Guidepup 0.34.0 starts NVDA through the Windows command shell without quoting its path, so it can't start NVDA from a path with a space or one of `& ( , ; = ^`; see [Windows setup](#windows-setup-for-someone-new-to-windows).
- **Symbols.** Transcripts contain NVDA's spoken names for symbols (`copyright`, `bullet`), not the characters.

</details>

## Future enhancements

<details>
<summary>Single-file executables for Windows and Mac, and what stands in the way</summary>

**Single-file executables for Windows and Mac.** Node's single-executable build could package voicecap as one file per platform, so there would be no Node.js to install. It isn't built, and it takes more than packaging. voicecap's own files (the demo site, the shareable page's fonts, and Guidepup's files) would have to be embedded. `setup` installs Playwright's fallback browser by running Playwright's own installer, from the packages `npx` downloads today, so an executable would need another way to get it. The commands voicecap prints would name the executable in place of `npx @icjia/voicecap`, and the executable would need its own way to update. It would have to be signed, since Windows SmartScreen warns about unsigned downloads; on a Mac it would also need notarizing, and its Accessibility and Automation permissions, which belong to the terminal app today, would have to be sorted out. It would count as ready only once real NVDA and VoiceOver runs had been made with it, and each run would then record which build made it.

</details>

## Development

<details>
<summary>The development commands, the test fixture, and where the specs and plans are</summary>

| Command | What it does |
| --- | --- |
| `pnpm install` | Installs the dependencies. |
| `pnpm exec playwright install chromium` | Installs Playwright's Chromium, for the report's accessibility test. |
| `pnpm test` | Runs the tests (Vitest). |
| `pnpm lint` | ESLint, then Prettier. |
| `pnpm typecheck` | Checks the types. |
| `pnpm build` | Builds `dist/`. |
| `pnpm fixture:serve` | Serves the test fixture at http://127.0.0.1:4747. |
| `pnpm test:nvda` | Windows: runs voicecap with real NVDA on the fixture and checks the results. |
| `pnpm fixture:capture` | Windows: the same, then replaces the fixture's recorded run with it. |
| `pnpm fixture:reviews` | Rebuilds `fixture/reviews.json` from the recorded run. |

`fixture/` holds the test site (with a deliberately flawed page and a page that tests end-of-page detection), sitemaps, page lists (including CRLF and Windows-1252 CSVs), a sample `reviews.json`, a real Speech Viewer capture, an NVDA log excerpt, and a run recorded with real NVDA that the replay driver plays back; see `fixture/README.md`. CI runs lint, type checks, and tests on Ubuntu, macOS, and Windows (the tests use the replay driver and Playwright's Chromium; the real-NVDA checks run locally with `pnpm test:nvda`).

`docs/build-prompt.md` is the specification and `docs/plan.md` the approved plan. `docs/phase-b-handoff.md` and `docs/phase-c-handoff.md` are the notes for Phase B (the real NVDA driver) and Phase C (VoiceOver on the Mac), and `docs/superpowers/` holds the specs and plans for the audit record, `init`, and the readiness checks. `WINDOWS-SETUP.md` is the checklist for setting up a new Windows machine for development.

</details>

### Publishing to npm

<details>
<summary>How <code>publish.sh</code> works, and what it checks before publishing</summary>

Always publish with `publish.sh`, from an up-to-date `main`. It's a bash script, so on Windows run it from Git Bash. Add the release to `CHANGELOG.md` first (move items from `[Unreleased]` under `## [x.y.z] - date`).

| Command | What it does |
| --- | --- |
| `./publish.sh --dry-run` | Every check, plus a dry-run publish. It changes nothing, and doesn't log you in to npm. |
| `./publish.sh` | The first publish: package.json's version. Afterwards: the next patch version. |
| `./publish.sh minor` | Or `patch`, `major`, `current`, or an exact version like `1.2.3`. |
| `./publish.sh minor 123456` | With an npm 2FA code, which skips the confirmation prompt. |

It stops before publishing unless:
- you're logged in to npm, the version isn't published yet, and `CHANGELOG.md` has an entry for it;
- CI passed for the commit (checked when the GitHub CLI is available);
- lint, typecheck, tests, and build pass;
- the package contains `dist/` and the docs (no source, tests, or fixtures);
- the packed tarball installs in a scratch project and `voicecap --version` prints the new version.

It restores `package.json` if anything fails before publishing. After publishing it commits the version bump, tags `vX.Y.Z`, and pushes.

</details>

## License

[MIT](LICENSE) © 2026 Illinois Criminal Justice Information Authority (ICJIA)
