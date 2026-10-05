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

- hear the screen reader at work, then go back over exactly what it said, line by line;
- compare runs to see exactly what changed after an update;
- record what they found and what they fixed, and add their own hands-on NVDA sessions.

Everything goes into one record that voicecap never rewrites, summed up in an accessible HTML report, and `voicecap verify` checks that the recorded files still match what voicecap wrote.

voicecap makes screen reader testing faster, repeatable, and documented: https://github.com/ICJIA/voicecap

Here is the top of that report for voicecap's own demo site, as NVDA read it on 29 September 2026. The demo's pages are at [voicecap.netlify.app/demo-site/](https://voicecap.netlify.app/demo-site/), and every screenshot in this README is of the demo's report, or of the website built from it. The page leads with the site's name, `voicecap.netlify.app`, and when it was tested. Its summary opens with the result in one sentence, "NVDA read all 7 pages. 1 page has flags worth a closer listen." Then come six numbers (7 pages in scope, 7 transcribed, 1 with flags, 0 heard live by a person, 204 lines NVDA spoke, and 12 minutes 34 seconds of NVDA time) and four panels: what needs attention, how complete the test was, what's still to do, and when and how it was run.

![The top of the demo's shareable page, in its dark theme: the site's name, voicecap.netlify.app, and "Tested 29 September 2026, 14:02"; the summary sentence, "NVDA read all 7 pages. 1 page has flags worth a closer listen."; six number tiles; and four panels.](https://raw.githubusercontent.com/ICJIA/voicecap/main/assets/screenshots/report-top.png)

> **Status: what works where.**
>
> - **Windows:** everything, including full audits with NVDA and Chrome, checked end to end with real NVDA 2026.2 and Chrome 153.
> - **Mac:** `setup`, `doctor`, and `init` prepare and check a Mac for VoiceOver, down to a live test that starts it. Audits with VoiceOver come with voicecap's VoiceOver driver, in a later release; until then, run audits on a Windows computer.
> - **Any computer, Linux included:** reviews, reports, `share`, `site`, `walkthrough`, manual NVDA sessions, `list-urls`, `verify`, and replay runs, which play back a recorded run (`--replay-from`).

## Why voicecap, and who it's for

An accessibility review has two halves. Automated checkers such as axe, Lighthouse, and Pa11y test a page's code against rules, and they're quick: they catch a missing label or missing alt text. What they can't tell you is what a page sounds like:

- whether its links make sense read aloud;
- whether its headings tell a screen reader user where they are;
- whether its buttons and fields are named in words that make sense when a screen reader says them.

That takes a person going through each page with a real screen reader. On a large site, or a dozen sites, it's weeks of work that's hard to write down and harder to repeat.

voicecap speeds up that second half. It presses NVDA's keys the way a person would, moves from page to page along the site's sitemap or a list of pages, and saves every word NVDA says. The person running it hears NVDA at work, reads the transcripts, records what they found, and fixes it.

**How it's different:**

- **The real screen reader, never a simulation.** Every line of a transcript is what NVDA said.
- **Every page on the list, three ways.** voicecap goes line by line, heading by heading, and control by control, as a blind visitor moves through a page. No page on the list is missed or done twice.
- **A person's review, on the record.** What the person found and fixed is recorded beside the transcripts, with their own hands-on NVDA sessions.
- **A record anyone can check.** Each transcript has a fingerprint and each finished run is sealed, so `voicecap verify` flags any recorded file that has changed (see [Checking the record](#checking-the-record-voicecap-verify)).
- **Results for people who never open a terminal.** There's a plain-language web page and its Word copy, dated copies to send with their fingerprints, and a website of every shared report (see [The shareable page](#the-shareable-page)).
- **Repeatable.** Comparing two runs shows what changed after an update. A walkthrough file repeats a run, with the same pages in the same order and the same passes, then says page by page how each page sounds against the original (see [Repeating a run](#repeating-a-run-the-walkthrough-file)).

To see it at work before you use it on your own site, try the guided demo on a Windows PC (see [Try it first](#try-it-first-npx-icjiavoicecap-demo)).

### Stories of the people it's for

These stories were written for this page. Each is a composite of the people voicecap is made for: how they'd describe using it, and why they'd choose it. They aren't quotes from real users, and none of them endorses voicecap. Each line below names one of them and what voicecap gives them. Open one to read their story.

<details>
<summary><b>A web coordinator with more than a dozen sites and a deadline:</b> every page on the list is accounted for, and the work leaves a record.</summary>

"I look after more than a dozen websites, and every one has to meet the April 2027 ADA Title II deadline for accessible digital content. Our automated checks came back clean, but my manager wanted to know that a person had gone through each site with a real screen reader. voicecap takes NVDA through every page on the list from each site's sitemap. Then I read the transcripts and fix what I find, one site after another. When someone asks how we know, I send the report."

</details>

<details>
<summary><b>A front-end developer:</b> the screen reader's own words, and a quick way to check a fix.</summary>

"When a page sounds wrong, I don't want to guess from the markup. The transcript shows me, line by line, what NVDA said and in what order. I fix the code, run that page again with `--page`, and compare it with the earlier run, naming that run with `--compare`, to see exactly which lines changed."

</details>

<details>
<summary><b>An accessibility specialist:</b> it covers the whole list, so their time goes where it's needed.</summary>

"I judge the hard pages in my own hands-on sessions with NVDA, and voicecap keeps those beside its transcripts, with `voicecap manual add`. What it saves me is the key-pressing on the hundreds of pages in between. Its flags point me to what's worth a closer listen, like links that say only 'click here', which axe passes."

</details>

<details>
<summary><b>A manager responsible for compliance:</b> results in plain language that show a person did the review.</summary>

"I'm never going to run a command. I need something I can read and forward: which pages were reviewed, by whom, with what screen reader, what was found, and what was fixed. The shareable page gives me that in plain language, and its Word copy goes in our files."

</details>

<details>
<summary><b>An outside auditor:</b> evidence that can be checked, not just trusted.</summary>

"I'm paid to look for holes, so I don't take a report's word for it. I check the file's own fingerprint against the one in the sender's email. Inside it, the page checks every transcript against its sealed records, and failures are shown with their records, not smoothed over. To hear it for myself, I repeat the run from its walkthrough file on my own Windows PC with NVDA, and it tells me page by page whether anything sounds different."

</details>

<details>
<summary><b>A tester on a team that ships often:</b> the same pages, the same keys, in the same order, every time.</summary>

"After each major update, I run the same list of pages again and compare it with the run before. The report marks the pages that changed and shows the lines that changed. When we need to know a page still sounds the way it did at launch, the walkthrough file from launch repeats that exact run."

</details>

<details>
<summary><b>A content editor:</b> plain-text transcripts anyone on the team can read.</summary>

"I write the pages; I don't build them. Reading the transcripts was the first time I knew how my links sounded: 'click here', again and again, on one page. Those were mine to fix, and I fixed them without touching any code."

</details>

<details>
<summary><b>A project manager signing off on a vendor's redesign:</b> a shared, specific record of what NVDA said on each page, and what was found.</summary>

"Before we accept a vendor's work, voicecap goes through the pages on our list on the staging site, and the vendor gets the shareable report: every page on the list, what NVDA said, and what needs fixing. When they say it's fixed, we run it again and compare."

</details>

<details>
<summary><b>A screen reader user on the accessibility team:</b> the screen reader's exact words, ready to quote.</summary>

"I use NVDA every day. When I report a problem, developers want it written down exactly. voicecap writes down every word NVDA says on each page on the list, so my report can point at the line, not at my memory of it."

</details>

## How voicecap works

![How voicecap works: a human review, sped up. Six steps, each described in the list below, and three lines NVDA said on voicecap's demo site.](https://raw.githubusercontent.com/ICJIA/voicecap/main/assets/how-voicecap-works.png)

Automated checkers such as axe and Lighthouse read a page's code and test it against rules. voicecap is a human review, sped up: it takes a real screen reader through each page the way a person would and saves every word it says, while the person running it reads the transcripts and fixes what they find.

1. **Every page on the list.** voicecap works from the site's sitemap, or a list of chosen pages in a CSV or JSON file. Each page is read once, in full, or recorded with the reason it couldn't be. None is missed or done twice, an easy slip when clicking through a site by hand.
2. **The real screen reader.** voicecap runs NVDA itself, never a simulation, with a fresh browser for every page, so no page's results depend on the pages before it.
3. **Three ways through each page.** It presses NVDA's keys as a person would: Down Arrow to go line by line, H to go heading by heading, and Tab to go control by control.
4. **Every word, checked.** It saves each key press and everything NVDA said, in order, waiting until NVDA has been quiet for a second so nothing is cut off. Before and after every key press, it checks that the page still has the screen. If another window took it, the step is thrown out and the page tried again, with NVDA and the browser started fresh.
5. **A person reviews.** The person running voicecap hears NVDA at work, and says so when the run ends. NVDA speaks very fast during a run, so the transcripts are where its words are read: the person reads them, records what they found with `voicecap review`, and fixes it. Flags point to moments worth a closer look, such as links that say only "click here".
6. **A sealed record.** Every file gets a fingerprint (SHA-256) and each run is sealed, so `voicecap verify` can show that nothing has changed since.

The first lines NVDA said on the demo site's home page, in each pass:

```
read (Down Arrow)   banner landmark, voicecap demo
                    Tour, navigation landmark, list, with 1 item, link, Next: Before you start
                    out of list, main landmark, heading, level 1, Welcome to the voicecap demo
headings (H)        main landmark, Welcome to the voicecap demo, heading, level 1
                    The tour's pages, heading, level 2
                    no next heading
tab (Tab)           Skip to main content, same page, link
                    Tour, navigation landmark, list, with 1 item, Next: Before you start, link
                    main landmark, list, with 6 items, Before you start, link
```

The details are in [What voicecap does on each page](#what-voicecap-does-on-each-page).

## When to run voicecap

![When to run voicecap: run it on the deployed site before it goes live, and again after a major update, not during development.](https://raw.githubusercontent.com/ICJIA/voicecap/main/assets/when-to-run-voicecap.png)

**Run voicecap on the deployed site before it goes live, and again after a major update.**

- **Not on every build during development.** Builds change daily, and a development copy isn't what users get. Screen reader users hear the deployed site, with its real content, so that's the one to listen to.
- **Before launch,** run the full listen-through on the site as it will go live, such as a staging copy of the production site. Fix what you find, then run the pages you fixed again.
- **After a major update,** run the same pages again with `--compare previous` to see exactly what changed in what the screen reader says.

## Contents

- [Why voicecap, and who it's for](#why-voicecap-and-who-its-for)
  - [Stories of the people it's for](#stories-of-the-people-its-for)
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
  - [A site's name: its canonical address](#a-sites-name-its-canonical-address)
  - [The Word copy](#the-word-copy)
  - [Sending it: voicecap share](#sending-it-voicecap-share)
  - [What was sent: shares.json](#what-was-sent-sharesjson)
- [The website: voicecap site](#the-website-voicecap-site)
  - [What the build reads, and what it leaves out](#what-the-build-reads-and-what-it-leaves-out)
  - [The files it writes, and the headers](#the-files-it-writes-and-the-headers)
  - [Publishing it, and the demo](#publishing-it-and-the-demo)
  - [The first deploy](#the-first-deploy)
- [Repeating a run: the walkthrough file](#repeating-a-run-the-walkthrough-file)
  - [Writing the file: voicecap walkthrough](#writing-the-file-voicecap-walkthrough)
  - [Repeating the run from the file](#repeating-the-run-from-the-file)
  - [What a repeat says afterwards](#what-a-repeat-says-afterwards)
- [Heuristic flags](#heuristic-flags)
- [Configuration](#configuration)
- [Programmatic API](#programmatic-api)
- [Drivers](#drivers)
- [Updating Guidepup](#updating-guidepup)
- [Known limitations](#known-limitations)
- [Future enhancements](#future-enhancements)
- [Development](#development)
- [Credits](#credits)
- [License](#license)

## Quick start

voicecap needs **Node.js 22.19 or later** (24 recommended), and nothing else to start: run it with `npx`, as below. npx downloads voicecap the first time and reuses it; `npx @icjia/voicecap@latest …` picks up a newer version. pnpm is only for developing voicecap, or for the replay demo below.

Why voicecap is built the way it is, in three short answers:

- **Why an npm package.** voicecap runs on your own computer, where the screen reader is. It's one package for Windows and a Mac, `npx` fetches the version you ask for, and every run records the version of voicecap that made it.
- **Why PowerShell, not Git Bash, on a PC.** Git Bash rewrites any argument that starts with `/` into a Windows path (`--page /about` arrives as `C:/Program Files/Git/about`). voicecap catches that and explains it, but it's an extra step. Git Bash's own window (mintty) also doesn't always let Node see a terminal. When it doesn't, voicecap leaves out what needs one: the live test that `init` and `setup` offer, and "Did you hear NVDA speaking as it read these pages?" at the end of a run. `demo` won't start at all. PowerShell has neither problem, on its own or in Windows Terminal (see [Git Bash and paths that start with "/"](#git-bash-and-paths-that-start-with-)). It has one catch of its own, fixed once: on a new PC it can refuse to run `npx` (see [If PowerShell says "running scripts is disabled"](#if-powershell-says-running-scripts-is-disabled)).
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
The site names its canonical address: https://i2i.illinois.gov/. Reports will name it so.
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

**The site's name.** `init` reads the site's home page when it checks the website. When the page names the site's own address as its canonical address, as i2i.illinois.gov's does above, `init` says so and goes on. When the website is at an IP address or a local address, such as `http://localhost:3000`, and its home page names none, `init` asks for the address people visit, and writes the answer into the command it prints as `--canonical`. The reports then name the site by it (see [A site's name: its canonical address](#a-sites-name-its-canonical-address)).

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

`npx @icjia/voicecap demo` is a guided first run, about 9 minutes, against a small demo site that comes with voicecap. The site runs only on this computer, and only while the tour needs it: nothing is downloaded, and nothing is sent anywhere. Its pages name their own address, [voicecap.netlify.app/demo-site/](https://voicecap.netlify.app/demo-site/), where ICJIA publishes the same pages (see [The website](#the-website-voicecap-site)), so the demo's report names the demo by that address, not by the one on your computer. The tour goes one step at a time, and each step waits for Enter. Ctrl+C at any of them stops the tour, with nothing left running.

1. **Welcome:** what voicecap does, and what the tour will do.
2. **Checking this computer:** the checks `init` starts with. On their own, they're `npx @icjia/voicecap preflight`.
3. **The live test:** about 20 seconds of NVDA speaking. Keep your hands off the keyboard.
4. **Auditing the demo site:** NVDA reads the demo's seven pages, hands off, for about 7 minutes. The tour shows the command it runs, such as `npx @icjia/voicecap --site http://127.0.0.1:4848 --sitemap sitemap.xml --out voicecap-demo --fresh`. To stop early, click the terminal window first (the browser is in front), then press Ctrl+C.
5. **The transcripts:** where they are, and the first lines NVDA said on the demo's home page.
6. **The report:** where it is, its flags, which are all on the "Common mistakes (on purpose)" page, and an offer to open it.
7. **Your own site:** `npx @icjia/voicecap init` sets up a run.

The demo's files go in a `voicecap-demo` folder in the current folder, never in your `VOICECAP_TRANSCRIPTS` audit record, and they're safe to delete. The one exception is a demo you put on the website: it's made in the home's folder and committed with the records, so deleting it and committing that, then pushing, takes the demo off the website at the next build (see [Publishing it, and the demo](#publishing-it-and-the-demo)). The demo site uses port 4848, or any free port when that one is taken. The tour needs a terminal: it doesn't run from a script. On Windows, run it in PowerShell or Windows Terminal, not Git Bash's own window (mintty), which doesn't always let Node see a terminal.

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

   - **If your Windows user folder's path has a space or one of `& ( , ; = ^`** (`C:\Users\Jane Doe`, `C:\Users\R&D`), Guidepup can't start NVDA from there. setup explains the fix: set `GUIDEPUP_SCREEN_READERS_PATH` to a plain folder such as `C:\guidepup` (`mkdir "C:\guidepup"`, then `setx GUIDEPUP_SCREEN_READERS_PATH "C:\guidepup"`, the same in PowerShell and Git Bash), open a new terminal, and run setup again.
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

- **Allow scripts for your own account, once.** Run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`, and answer `Y` if it asks. It needs no administrator rights, and it works at once, in the same window. From then on, your account can run scripts written on this computer. One downloaded from the internet still needs a signature.
- **Or change nothing, and type `npx.cmd` wherever these steps say `npx`,** as in `npx.cmd @icjia/voicecap preflight`. Use this on a work PC where the first way is refused, or where your organization's settings override it. One catch: an address with `&` in it, such as `--page "https://example.org/search?q=a&lang=en"`, doesn't survive `npx.cmd`. For an address like that, use the first way, or put the address in a `--pages` file.

### Git Bash and paths that start with "/"

PowerShell doesn't rewrite arguments, so this note is only for people who use Git Bash. To open Git Bash in Windows Terminal, use the tab drop-down, the small down arrow (`˅`) next to the `+`: it lists "Git Bash" once Git is installed. Git Bash rewrites command-line arguments that start with `/` into Windows paths, so `--page /about` reaches voicecap as `C:/Program Files/Git/about`. voicecap detects this and stops with an explanation. Four ways around it:

- use full URLs: `--page https://dvfr.illinois.gov/about/` (always works);
- leave off the leading slash in patterns: `--include 'news/*'` (patterns match with or without it);
- give a sitemap by its name, without the slash: `--sitemap sitemap.xml` is the same file as `/sitemap.xml`;
- turn the rewriting off for one command: `MSYS_NO_PATHCONV=1 npx @icjia/voicecap review --page /about ...`.

With the rewriting off, Git Bash also stops translating its own way of writing a Windows path, `/c/Users/me` (what `~` expands to), so voicecap reads that form itself on Windows: `--out` (`site`'s too), `site`'s `--home`, `VOICECAP_TRANSCRIPTS`, `--pages`, `--walkthrough`, `--replay-from`, and the files `manual add`, `list-urls`, and `walkthrough` take all accept it.

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
npx @icjia/voicecap --walkthrough <file> [options]
```

`--site` is required, plus exactly one kind of page source: `--sitemap`, `--pages`, or one or more `--page`; giving none of them, or a mix, is an error. The second line is the other way to give the pages: a walkthrough file repeats a run, and needs no `--site`, since the site is the file's (see [Repeating a run: the walkthrough file](#repeating-a-run-the-walkthrough-file)).

| Option | Meaning |
| --- | --- |
| `--site <url>` | The site. Pages must be on its origin. Required, except with `--walkthrough`, which takes the site from its file. |
| `--canonical <address>` | The address people visit, for the reports to name the site by, such as `https://dvfr.illinois.gov`. A bare name works (`dvfr.illinois.gov`), and the run keeps the address as a root with a `/` on the end. Default: the one the pages' canonical tags name, and none for a replay, which reads no tags. An IP address or a local address is refused, since neither is a site's name. The run records it (see [A site's name: its canonical address](#a-sites-name-its-canonical-address)). |
| `--sitemap <url>` | Take pages from a sitemap: a `<urlset>` or a `<sitemapindex>` (child sitemaps are read too; gzip is fine). Give its full URL, or its name or path on the site, from its root (`sitemap.xml`, `/sitemaps/pages.xml`). |
| `--pages <file>` | Take pages from a page list: `.csv` or `.json` (see [Page sources](#page-sources)). |
| `--page <url>` | Take this page: a full URL, or a path like `/faq/`, resolved against `--site` (repeatable). |
| `--walkthrough <file>` | Repeat a run from its walkthrough file (see [Repeating a run: the walkthrough file](#repeating-a-run-the-walkthrough-file)): the same pages in the same order, with the same passes, step limits, capture mode, and readiness settings (this computer's readiness settings, when the file has none). Refused beside `--sitemap`, `--pages`, `--page`, `--limit`, `--include`, `--exclude`, `--passes`, `--max-steps`, and a `--site` that isn't the file's. |
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

**The question at the end.** When a session that read pages ends, voicecap asks at the terminal, once NVDA has stopped: "Did you hear NVDA speaking as it read these pages?" With it, voicecap says that NVDA speaks very fast during a run, so the words are hard to follow, and that the transcripts have every word. The answers are "Yes, the whole time", "Part of the time", and "No", typed as 1, 2, or 3. Enter picks No, so a run never says you heard it unless you said so. The session's record keeps the answer, with when voicecap asked and when it was answered, and the run's seal covers it (see [What each run records](#what-each-run-records)).

- **It's asked however the session ends:** when the run completes; after Ctrl+C; when the run stops after too many failed pages in a row (exit code 2); and when an error ends it (the browser updating itself mid-run, say). After an error, a line before the question says why the session stopped, and the full explanation follows your answer.
- **Only an answer typed after the question appears counts.** Keys pressed while the run went on, a stray Enter say, are dropped before the question shows, so they can't answer it for you.
- **Ctrl+C at the question, or closing the window, gives no answer.** The record then has none.
- **It isn't asked,** and the record has no answer:
  - without a terminal (a script, or CI), or when the output is redirected to a file (`voicecap … > log.txt`), where no one would see the question;
  - in Git Bash's own window (mintty), which doesn't always let Node see a terminal: run voicecap in PowerShell or Windows Terminal to be asked;
  - for a replay, or for a session that read no pages;
  - by `voicecap demo`.

</details>

### Other commands

<details>
<summary>One line for each of the other commands, how they pick a site's folder, what <code>share</code>, <code>site</code>, and <code>walkthrough</code> take, and what <code>doctor</code> prints</summary>

```bash
voicecap list-urls --site <url> --sitemap <url> [--sample N] [--include p] [--exclude p] [--limit n] <output.csv|output.json>
voicecap review --page <url> --status <unreviewed|reviewed|issue|fixed> [--note "..."] [--reviewer <name>] [--run <run-id>] [--site <url>] [--out <dir>]
voicecap manual add <file> --page <url> [--from <time>] [--to <time>] [--date <YYYY-MM-DD>] [--redact-typing] [--keep-raw] [--no-raw] [--reviewer <name>] [--site <url>] [--out <dir>]
voicecap report [--run <run-id>] [--compare <run-id|previous>] [--site <url>] [--out <dir>]
voicecap share [--site <url>] [--out <dir>] [--reviewer <name>]
voicecap walkthrough [--site <url>] [--run <id>] [--out <dir>] <file>
voicecap site [--home <dir>] [--out <dir>]
voicecap verify [--site <url>] [--out <dir>]
voicecap setup     # install and check what voicecap needs on this computer (Windows or a Mac)
voicecap preflight # check this computer is ready for a run, without starting the screen reader
voicecap doctor    # check this computer and print a summary to paste into a bug report
voicecap demo      # a guided first run against a demo site that comes with voicecap
```

Wherever a command takes a page, give a full URL or a root-relative path (`/about`). `review`, `manual add`, `report`, `share`, and `walkthrough` work in one site's folder in the transcripts home (see [The audit record](#the-audit-record)): give `--site`, or a full URL with `--page`, or, when the home has only one site's folder so far, nothing at all. With more than one and neither given, voicecap stops and names them.

**`--site` takes the address voicecap read, or the site's canonical address,** on these five commands and on `verify` (see [A site's name: its canonical address](#a-sites-name-its-canonical-address)). `--site https://dvfr.illinois.gov` finds the folder named for that address when the folder holds records, and otherwise the one folder whose newest completed run recorded it as the site's canonical address, such as a run on a copy of the site on the tester's own computer. When two folders recorded it, voicecap stops, names both, and asks for the address it read. A run's own `--site` is still the address to read.

**`share` takes three options:** `--site <url>`, the site's address or its canonical address (default: the home's only site); `--out <dir>`, the transcripts home (default: `VOICECAP_TRANSCRIPTS`, else `./transcripts`); and `--reviewer <name>`, who is sharing (default: `VOICECAP_REVIEWER`, then `git config user.name`, then `reviewer` in the config). With no name it stops, as `review` does: a share is recorded with who made it. What it makes and prints is under [Sending it: `voicecap share`](#sending-it-voicecap-share).

**`walkthrough` takes the file to write, and three options:** `--site <url>`, the site's address or its canonical address (default: the home's only site); `--run <id>`, the run to write it from (default: the site's latest completed run); and `--out <dir>`, the transcripts home (default: `VOICECAP_TRANSCRIPTS`, else `./transcripts`). It never overwrites a file, and it needs no screen reader. What it writes is under [Writing the file: `voicecap walkthrough`](#writing-the-file-voicecap-walkthrough).

**`site` takes two options:** `--home <dir>`, the transcripts home (default: `VOICECAP_TRANSCRIPTS`, else `./transcripts`); and `--out <dir>`, the folder to build the website in (default: `_site` in the home). **Here `--out` isn't the home.** In every other command that takes it, `--out` is the transcripts home, and `site` takes the home as `--home`. It reads every site's folder in the home, so it takes no `--site`, and it needs no screen reader. What it builds and prints is under [The website: `voicecap site`](#the-website-voicecap-site).

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

For all three sources, and for the pages of a walkthrough file (see [Repeating a run: the walkthrough file](#repeating-a-run-the-walkthrough-file)):

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

voicecap takes NVDA through each page three ways: line by line (Down Arrow), heading by heading (H), and control by control (Tab). The report's "Heard on" panel shows the first three lines NVDA said in each way on the demo site's home page, and how long each line took: 1.3 seconds. The same lines are in text, under [How voicecap works](#how-voicecap-works).

![The "Heard on" panel of the demo's report: three columns, one for each way NVDA goes through the page (Down Arrow, line by line; H, heading by heading; Tab, control by control), each with its first three lines on the home page and how long each took, 1.3 seconds.](https://raw.githubusercontent.com/ICJIA/voicecap/main/assets/screenshots/report-heard.png)

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
  netlify.toml  .nvmrc                 ← written once by `voicecap site`, for Netlify (see "The website")
  _site/                               ← the website `voicecap site` builds, made again by every build and kept out of Git
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
    share/current.docx                 ← its Word copy, written with it
    share/<site>_<date>.html  .docx    ← the page and its Word copy that `voicecap share` made to send: never written again
    share/<site>_<date>_<run>_walkthrough.json  ← each run's walkthrough file, made with them: never written again
    share/shares.json                  ← what `voicecap share` sent: sealed, chained, only added to
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
- **Environment record.** `run.json` records, and every transcript repeats: page source (sitemap URL, page list file with its SHA-256, or walkthrough file with its SHA-256 and the run it was made from), driver and version, NVDA version (and Guidepup's build id), NVDA language, capture mode, browser and version, OS, voicecap version, a hash of the effective config (this computer's, for a repeat), run timestamp, and NVDA's speech, document formatting, browse mode, and keyboard settings. It also holds the computer's details (see [What each run records](#what-each-run-records)), which `run.json` and the JSON transcripts keep, and the TXT header leaves out.
- **Hashes.** `run.json` records the SHA-256 of every transcript file (integrity) and of each pass's TXT body without the header (content). "Changed since review" and `--compare` use the content hashes, because headers include timestamps and run ids.

</details>

## The audit record

voicecap can keep a permanent, non-destructive record of every run and every manual session, for audit and legal purposes: one private Git repository, pushed often, where the runs for any site can be counted and every file can be trusted not to have changed. Point every voicecap command at one folder outside your site's own repository — the **transcripts home** — and give that folder to Git on its own.

### Layout

The home's folders are shown under [The transcripts folder](#the-transcripts-folder). A site's folder is its host name, lowercased, plus `_<port>` when the URL has one, with anything other than `a-z 0-9 . -` replaced by `_` (`https://dvfr.illinois.gov` → `dvfr.illinois.gov`; `http://127.0.0.1:4747` → `127.0.0.1_4747`). `review`, `manual add`, `report`, `share`, and `walkthrough` work in one site's folder at a time (see [Other commands](#other-commands) for how they pick it).

A site's folder is named for the address voicecap read, whatever the site's canonical address is. What readers meet, the shareable page, its Word copy, the dated copies, and the website, names the site by its canonical address instead (see [A site's name: its canonical address](#a-sites-name-its-canonical-address)).

The home's top can also hold your own files and folders, notes for example. A folder there is a site's folder only when it holds a date folder, `reviews.json`, `latest.txt`, or `report.html`; any other is left alone, and `review`, `manual add`, `report`, `share`, `walkthrough`, `verify`, and `site` never take it for a site.

### What each run records

<details>
<summary>Page titles, the site's canonical address, every failed attempt and its code, the reviewer and whether NVDA was heard, and the computer's details</summary>

Beyond its transcripts, each run's `run.json` records:

- **Each page's title**, as the browser reports it. A page with no title, or one that never loaded, has none (`null`), and so does every page of a replayed run.
- **The site's canonical address,** when the run learned one: the root `--canonical` gave, or the one the pages' tags name (`canonical` in `run.json`, set when the run completes, so its seal covers it). Each page's record keeps the address its own tag gave, as the browser resolved it, or `null` for a page with no tag and a page that wasn't read (see [A site's name: its canonical address](#a-sites-name-its-canonical-address)). A run from before voicecap 0.10.0 has neither.
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
- **Each session's reviewer, and whether NVDA was heard.** That's the answer to "Did you hear NVDA speaking as it read these pages?" The session's record keeps the answer (`listener`), when voicecap asked and when it was answered, and how many pages the session went through (see [Run an audit](#run-an-audit)).
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
- **Shares are append-only too.** A share is a new entry in `share/shares.json`, and `voicecap share` never overwrites a copy: a name that's taken means the next number (see [Sending it: `voicecap share`](#sending-it-voicecap-share)).
- **A retried or resumed page keeps its earlier attempt**, moved to `attempts/<slug>/<n>/` instead of being overwritten. Reports and comparisons ignore it.
- **voicecap 0.2.0's layout is left alone.** If a home still has its `runs/` or `manual/` folders, they're never read or moved; a run just says once that it saw them.

### Checking the record: `voicecap verify`

Two checks look at the record. `voicecap verify` checks the files in the transcripts home against their seals and fingerprints. The shareable page checks itself too, in the browser, with no network: its "Check the fingerprints" button checks every transcript the page shows against the fingerprint in its run's sealed record, and checks each run's seal and each review's (see [The shareable page](#the-shareable-page)). On the demo's page, the result reads, in green: "Checked just now, in this browser. 21 of 21 transcripts match their fingerprints, and both runs' seals check out." Under it, a fold lists every file checked, and says how many matched.

![The fingerprint check in the demo's report, after a click on "Check the fingerprints". The result, in green: "Checked just now, in this browser. 21 of 21 transcripts match their fingerprints, and both runs' seals check out." Under it, a closed fold, "Every file checked: 23 checked, 0 not matching".](https://raw.githubusercontent.com/ICJIA/voicecap/main/assets/screenshots/report-fingerprints.png)

<details>
<summary>How seals and the review chain work, what <code>voicecap verify</code> checks, and what it can't catch</summary>

```bash
voicecap verify [--site <url>] [--out <dir>]
```

Every record voicecap finishes writing is sealed: a completed run's `run.json`, each manual session's `session.json`, each review entry, and each entry in `share/shares.json` carry a `seal`, a SHA-256 of the record itself. Review entries, and share entries, also chain to the one before them (`seq`, `prev`). A reordered review entry, or a deleted entry that a later entry follows, breaks the chain; an edited one no longer matches its own seal, including the newest entry, which no later entry points to yet.

`verify` checks every site folder in the home, or one with `--site` (the address voicecap read, or the site's canonical address): each run's seal and the SHA-256 of every file it recorded; each manual session's seal, its transcript, and its raw copy when one was kept; the whole review chain; and what was shared (see below). It prints one line per problem it finds, then a summary for each site, and exits **0** when everything matches and **3** when something doesn't. An incomplete run (still running, or interrupted) is listed, not counted as a problem, and a missing raw NVDA log isn't either: `.gitignore` keeps those out of Git on purpose (see below), so a clone of the home never has them.

**What it checks of the shares:** `share/shares.json`'s seals and chain; the site each entry records (from 0.10.0), which has to be the root of a web address, such as `https://dvfr.illinois.gov/`, as voicecap writes one; each copy the record names, which is a problem when it's missing, or has changed since it was recorded; and any other file or folder in `share/` that nothing records, such as a dated copy that `shares.json` doesn't name. It passes over `current.html` and `current.docx` (voicecap writes them again from the records, so `verify` checks the records), names that start with a dot, the files an operating system adds, and Word's lock files (`~$…`, which Word keeps beside a document it has open: a sent copy that someone is reading has one). When it says a copy is `not recorded in shares.json`, move the copy out of `share/` if you kept it by hand, or delete it if a share was interrupted and it was never sent.

The summary line says what it checked: `dvfr.illinois.gov: 3 runs (1 incomplete), 2 manual sessions, 4 reviews, 1 share checked: everything matches.` When something doesn't match, the line ends with the number of problems in place of "everything matches".

`verify` doesn't check the regenerated views (a site's `report.html`, `latest.txt`, `share/current.html`, `share/current.docx`, and `compare/`), a run's own `report.html` and `compare/` diffs, or kept earlier attempts.

**What it can't catch on its own:** someone who edits a record and recomputes its seal, and every later seal and `prev`; and someone who deletes the newest review entries, the newest share with its copies, or a whole run or manual session, which leaves nothing for `verify` to find: only Git history shows it. Git history pushed to a protected branch catches both, since rewriting commits that are already pushed takes a force-push, and a branch protected against force-pushes refuses it — which is why the setup below has you protect the branch and push often.

</details>

### What `.gitignore` keeps out, and why

<details>
<summary>What <code>.gitignore</code> keeps out of Git, and why</summary>

voicecap writes `.gitattributes` and `.gitignore` at the home's top the first time it needs them (a run, a review, a share, a manual session, or a build of the website), and never overwrites them, so your own edits or additions stay. Since voicecap writes its own only where there's none, don't start a home's `.gitignore` yourself: add to the one voicecap wrote. `.gitattributes` (`* -text`) keeps Git from changing line endings on checkout, which would otherwise make the recorded hashes stop matching the files. `.gitignore` keeps out:

- **`.voicecap.lock`**, the marker a run holds while it's writing.
- **Manual sessions' raw NVDA logs** (`**/*_manual_*/raw/`). At Input/output level, NVDA's log records every keystroke, including passwords typed into forms — not something to put in Git. The raw copy's SHA-256 stays in `session.json` either way, so a home missing a raw copy isn't something `verify` will flag.
- **The shareable page and its Word copy** (`**/share/current.*`). voicecap writes them again after every run and review, so a copy in Git each time would only make the record bigger; they're made from the records, which are in Git. The dated copies that `voicecap share` makes (the page, its Word copy, and each run's walkthrough file), and `shares.json`, go into Git with the rest of the record: they're what was shared, and what the website is built from. A home whose `.gitignore` voicecap wrote before 0.6.0 doesn't have this line: add it by hand.
- **Temporary files a crash can leave behind** (`.*.tmp`). voicecap writes each file under a temporary name first, then renames it into place.
- **Word's lock files** (`~$*`). Word keeps one beside a document it has open (a sent copy someone is reading, say), named with `~$` first, and a commit made then would take it. voicecap never changes a `.gitignore` it wrote before, so the owner of a home set up before this line was added can add `~$*` by hand.
- **The website** (`_site/`). `voicecap site` builds it from the records, and builds it again every time, so a copy in Git would only make the record bigger, and could be committed with the records by mistake. Netlify builds its own copy. A home whose `.gitignore` voicecap wrote with 0.8.0 or earlier doesn't have this line. When `voicecap site` builds into the home's `_site/` and the line isn't there, it warns, with the line to add, and never changes the file: add `_site/` by hand, on a line of its own with nothing before it (Git reads a space at a line's start as part of the name).
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

- **Resuming.** At the start of a run voicecap stores the page list and a hash of the settings that matter (site, page source, passes, filters, limit, driver, capture mode, step caps, NVDA settings, browser, readiness). `run.json` is rewritten after every page (atomically: a temporary file is flushed to disk and renamed, with retries while Windows holds the file). Running the same command again resumes the most recent incomplete run with the same settings, skipping pages already done (failed pages are retried). Otherwise voicecap starts a new run and says why. `--fresh` always starts a new run. A run that voicecap 0.7.0 or earlier left incomplete isn't resumed, since those versions didn't record the readiness settings: voicecap starts a new run and says so, until a new run with the same other settings completes.
- **Sitemap runs resume with the page list stored when they started**, so a sitemap that changed in the meantime (a new news item, say) doesn't block resuming. A page list file, and a walkthrough file, is identified by its contents, so editing it starts a new run.
- **A failing page never stops the run**: it's recorded, reported, and the run moves on.
  - **Up to 5 tries** (`pageAttempts`). voicecap tries the page again after a timeout (steps and whole pages have timeouts), when NVDA or the browser stops responding, or when another window takes the foreground. Each retry starts NVDA and the browser fresh.
  - **Every attempt is kept** under `attempts/`, and the page's record names each failed attempt's reason, so a page that needed three tries says so.
  - **Too many failures in a row:** after `maxConsecutiveFailures` pages in a row (default 5) fail every try, voicecap stops with exit code 2 instead of marking every remaining page failed. Fix the problem and rerun to resume. If the fix is a change to the readiness settings (`readiness` in the config, see [Configuration](#configuration)), the rerun starts a new run instead: a run resumes only with the same settings, and those are among them.
- **Restarts.** NVDA and the browser are restarted every `restartEvery` pages (default 50).
- **If NVDA dies** (it crashes, or someone closes it), or Guidepup loses its connection to it, the step in progress fails rather than being recorded as silence, and voicecap restarts NVDA and the browser and tries the page again, up to `pageAttempts` times in all.
- **If the browser updates itself** during a run (Chrome does, in the background), the page being opened when the new version starts fails, and voicecap stops with exit code 2 when it restarts the browser for the next page, so the version recorded with the transcripts stays true. Run the same command again to resume with the new version recorded; the failed page is retried. (On the last page, the run completes instead, with that page failed: exit code 3.)
- **Ctrl+C** saves state and shuts down NVDA and the browser. When the session read pages, voicecap then asks whether you heard NVDA speaking (see "The question at the end" under [Run an audit](#run-an-audit)), and it exits with code 130 once you've answered. The page in progress is redone on resume. Press Ctrl+C a second time to exit immediately; at the question, Ctrl+C gives no answer, and voicecap exits. The browser is in front while voicecap works, so click the terminal window first, or the keystroke goes to the browser.
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

Open a site's `report.html` in a browser: `transcripts/dvfr.illinois.gov/report.html`, say, or the path a run prints when it completes. It's a single self-contained file (no external assets) and is itself accessible. Its subtitle names the site by its canonical name, linked to its address, when the run recorded one, and by the address voicecap read when it didn't (see [A site's name: its canonical address](#a-sites-name-its-canonical-address)).

- **Summary**: the page source (curated list, full sitemap, or walkthrough file), driver and capture mode, and counts: pages, transcribed, reviewed, changed since review, manually tested, open issues, errors, skipped URLs. Banners mark replayed output ("not a live NVDA session"), incomplete runs, and environment changes.
- **Pages table**: one row per page with its template, run status, step counts and stop reasons per pass, heuristic flags, current review status (with reviewer and date), number of review entries, a "changed since review" marker, manual sessions, and links to every transcript. With `--compare`, a column marks changed pages and links to the text diffs.
- **Filters** (flagged, review status, template, changed since review, manually tested) are ordinary form controls; the number of pages shown is announced. Without JavaScript the full table is still there.
- **Skipped URLs**, **Review history** (every entry for every page), **Manual NVDA sessions**, and the **Environment** record follow.

A completed run, `review`, `manual add`, and `voicecap report` regenerate it. Each run's folder keeps its own `report.html` snapshot from when it completed. `voicecap report --run <id>` renders a specific run, including an incomplete one (clearly marked).

**Compare.** `--compare previous` (or a run id) compares the pages both runs contain, marks changed pages, and links to line diffs of the transcripts (not the header blocks). Pages that appear in only one run are listed. If the two runs' environments differ (NVDA, browser, voicecap, NVDA settings, capture mode), the report says so prominently, because some changes may come from the tooling rather than the site.

</details>

## The shareable page

The shareable page folds its detail under lines that say what's inside. This is one of its sections, "What the flags found", with its fold open. The demo's flags are all on one page, "Common mistakes (on purpose)", which breaks three rules on purpose (see [Heuristic flags](#heuristic-flags)): `generic-link-text`, since 3 links say only "click here"; `unlabeled`, since 2 items have no names, so NVDA says only "button" and "edit"; and `headings`, since its first heading is level 2, not 1. For each rule, the page quotes what NVDA said.

!["What the flags found" in the demo's report, with its fold open: the one flagged page, with 5 flags from 3 rules. A table gives each rule (generic-link-text, unlabeled, headings), what NVDA showed, and NVDA's own words, quoted.](https://raw.githubusercontent.com/ICJIA/voicecap/main/assets/screenshots/report-flags.png)

<details>
<summary>What the page is, how voicecap writes it, which runs count, its sections, the fingerprint check, and what to know before you send it</summary>

`share/current.html`, in a site's folder, is the shareable page: made for people who will never open the transcripts home, a manager, say, or an auditor. It's one file, and it opens in any browser, offline. It shows where the site stands, from its sealed runs, and the person's review: what they heard, found, and fixed. It explains every problem that came up during the runs, with its record, word for word, and it can check its own fingerprints, in the browser, with no network. Beside it is `share/current.docx`, its Word copy (see [The Word copy](#the-word-copy)).

voicecap writes it whenever it rewrites the site's `report.html`: when a run completes, and after `voicecap review`, `voicecap manual add`, and `voicecap report`, which also prints `Shareable page: <path>` and then `Word copy: <path>`, each only when its file was written. (The programmatic API's `generateReport`, `addReview`, and `addManualSession` write the page and its Word copy too.) It's rewritten each time, so `current.html` isn't the file to send: `voicecap share` makes a dated copy of the page, and of its Word copy, to send (see [Sending it: `voicecap share`](#sending-it-voicecap-share)). A page that can't be written is a warning, never a failed run, review, or report.

- **One self-contained file.** Its styles, fonts, and data are inside it, and nothing is loaded from outside. It's dark at first, with a button for a light version, and it prints light. Its detail is folded under lines that say what's inside. Each fold opens with a click, scripts or not; "Open every section", at the top, opens them all; and so does printing. Like the report, it's itself accessible: voicecap's tests run axe on it, in both themes, with every fold shut and every fold open.
- **Only completed, sealed, live runs count.** Its pages are those of the latest run that counts whose pages came from a sitemap or a page list. A later run given its pages with `--page` is a spot check: its transcripts are shown for the pages it read, and its failures are said, but it doesn't change which pages are in scope. Each page shows its newest transcripts from any run that counts.
  - A run repeated from a walkthrough file counts as what its original was. A repeat of a sitemap or page-list run is a list run, in scope like a page list, and a repeat of a `--page` run is a spot check, like `--page`. The file says what its original's pages came from (`from`). So a walkthrough file trimmed by hand, from a sitemap run, still counts as a list: its pages, the subset, are the scope, and the pages taken out go in "No longer listed" (see [Repeating a run: the walkthrough file](#repeating-a-run-the-walkthrough-file)).
  - A page whose latest attempt failed shows the failure beside its last good transcripts, and is a task under "What's still to do".
  - A page the latest run's list no longer has goes in a small table, "No longer listed".
  - A replayed run (`--replay-from`), a run that was interrupted or never finished, a completed run with no seal, and a run whose `run.json` can't be read never count toward a result. The page lists each one it left out, with why, and with no run that counts, it says so.
- **A person's review, first.** The summary leads with what the person did: that they heard NVDA speaking as it read the pages (their answer to the question at the end, under [Run an audit](#run-an-audit)), what they found, and what they fixed (see [Reviews: the audit trail](#reviews-the-audit-trail)). It says a person heard, reviewed, or fixed something only where the records say so, and what's left appears as tasks, under "What's still to do".
- **Nothing left blank.** Where a run didn't record something the page shows, it says so, as in "Not recorded: this run used voicecap 0.5.0".

Its sections, in order:

- **Summary**: the result in one sentence, six numbers (pages in scope, pages transcribed, pages with flags, pages heard live, lines NVDA spoke, and NVDA time), what needs attention, how complete the test was, what's still to do, and when and how it was run.
- **How voicecap works**: the six steps, the first lines NVDA said on the site's home page, and when to run voicecap.
- **Every page**: a card for each page, with its result, flags, review, line counts, and a link to its transcripts.
- **What the flags found**: each flagged page's rules, with NVDA's own words quoted from the transcripts.
- **What changed since the last run**: the pages that sound different from the run before (the latest earlier run that counts, with the same page source), line by line, with the changed words marked. Pages that sound the same are counted, not listed.
- **Problems during the runs**: every failed attempt in the runs the page draws on, including those a later attempt made good. Each has its kind: another window took the screen, the computer locked, NVDA stopped, the browser stopped, the website answered with an error or couldn't be reached, a step took too long, or an unexpected error, which may be a fault in voicecap itself. Each says what voicecap did, whether it happened again (by what came after it: a run before it that read the page shows only that the page could be read), and what it means for the results. Then comes the record of it, word for word, with the home folder replaced by `%USERPROFILE%` (or `~`).
- **What these results cover**: the pages and passes, and the technical limits.
- **The evidence behind these results**: the fingerprint check, then each run the page draws on, with its facts and five parts. The first two, the event log minute by minute and NVDA's own log, are ones no version of voicecap records yet, so each says "Not recorded". The others are its test environment, the fingerprint of every file, and, last, its walkthrough file to download, with the command that repeats the run (see [Repeating a run: the walkthrough file](#repeating-a-run-the-walkthrough-file)).
- **How voicecap came to be**: it opens with why voicecap was needed, then why it exists, then its timeline and a few things worth knowing.
- **Appendix: every transcript**: each page's read, headings, and Tab transcripts, word for word.

**The fingerprint check.** "Check the fingerprints", in the evidence, checks every transcript the page shows against the fingerprint in its run's sealed record, each run's seal, and each review's seal and the review chain, all in the browser. It also checks that the text each transcript shows in the appendix is the file the page carries, so the transcripts shown are exactly the ones the sealed records list. "Show a change being caught" repeats the check on a copy with one character changed, in memory only, so a reader can see a mismatch named. The check shows that the page agrees with itself. It can't show that the page itself wasn't changed, since whoever changed it could change the fingerprints too. For that, compare the file's own fingerprint with the one its sender recorded: `voicecap share` prints it, ready for the email that sends the file, and `Get-FileHash <file>` in PowerShell, or `shasum -a 256 <file>` on a Mac, shows it for the file you received. Or run `voicecap verify` on the transcripts home, which checks the originals. `voicecap verify` leaves `current.html` and `current.docx` alone, since voicecap makes them again from the records each time, and `verify` checks the records. It does check the dated copies that `voicecap share` made, against what `shares.json` recorded of them (see [Checking the record](#checking-the-record-voicecap-verify)).

**Before you send it:** the page carries its runs' sealed records exactly as voicecap wrote them, for the fingerprint check, and those can include file paths with your account name in them (a page list's, say), which the page itself never shows. The walkthrough files it offers hold no folder names: a page list's file is kept by its name only. Each walkthrough file carries the pages' labels, templates, and notes from your page list, as the records do. **Everything on the website is public to anyone with its address,** so all of this holds there too, for every page, Word copy, and walkthrough file that has been shared (see [The website: `voicecap site`](#the-website-voicecap-site)).

**The site's name,** the page's headline, is its canonical name, such as `dvfr.illinois.gov`. Under it, the page says when the site was tested, such as "Tested 29 September 2026, 14:02": the day and time the latest run began (see [A site's name: its canonical address](#a-sites-name-its-canonical-address)). `report.siteName` in the config (see [Configuration](#configuration)) adds a line of its own under the name, such as the site's full title. Without it the page has no such line, and the home page's title is no longer a headline. The setting names every site the config is used with, so give each site its own config when they need different names.

</details>

### A site's name: its canonical address

The shareable page, its Word copy, the dated copies, and the website name a site by its **canonical address**: the address people visit, such as `https://dvfr.illinois.gov/`. Its **canonical name** is that address's host, `dvfr.illinois.gov`. The page and its Word copy lead with it, and with when the site was tested. A site that voicecap read on a copy on the tester's own computer is named the same way once its canonical address is known, so nothing a reader meets leads with an IP address or `localhost`, which mean nothing to a reader. The fold below says how voicecap learns the address.

<details>
<summary>How a site gets its canonical address, where its name shows, what keeps the address voicecap read, and what a site with none is called</summary>

**How a site gets one,** from the strongest way to the weakest:

1. **`report.canonical` in the config** (see [Configuration](#configuration)). It names the site whenever the page, its Word copy, or a share is made, and it beats the address any run recorded, past or to come. So it names every site the config is used with: keep one config per site, as with `report.siteName`. A command reads the config in the folder it runs from, so a config with `report.canonical` goes in a folder of its own, never in the transcripts home, which holds many sites.
2. **`--canonical <address>` on a run** (see [Run an audit](#run-an-audit)). The session that completes the run records it. It isn't one of the settings a run resumes by, so adding it when you run again doesn't start a new run. `voicecap init` asks for it when it's needed, and puts it in the command it prints (see [Quick start](#quick-start)).
3. **The site's own pages.** A run reads each page's `<link rel="canonical">` tag when it loads the page, and records the root that most of the inner pages' tags name (an inner page is any page but the home page). The home page's tag counts only when no inner page gives one. A tag counts only when it names the page it's on: its path has to end with the page's own path. A tag for another page, a local address, or an address that isn't on the web is ignored. A copy of a site keeps the tags of the site it copies, so a run on a copy learns the real address.
4. **None of these.** The site is named by the address voicecap read: its host, and its port if it has one. For a copy on the tester's own computer, that is an IP address or `localhost`, so give such a site its address with `--canonical` or `report.canonical`.

An address is kept as its root: a scheme, a host, and a path that ends in `/`. `dvfr.illinois.gov` becomes `https://dvfr.illinois.gov/`, and a site that lives under a path keeps it: the demo's is `https://voicecap.netlify.app/demo-site/`. An IP address or a local address, such as `http://localhost:3000`, is refused, since neither is a site's name, and so is a host with an empty label, such as `https://.example.com`, which isn't a web address.

**Where the name shows:**

- the page's headline and title, and every page address it shows, which is the page on the canonical address: the demo's `/before-you-start/` is `voicecap.netlify.app/demo-site/before-you-start/`. A page whose path already starts with the root's path keeps it, so a site that lives under a path isn't doubled when it's read itself, or on a copy with the same paths: with the root `https://icjia.illinois.gov/researchhub/`, `/researchhub/x/` is `icjia.illinois.gov/researchhub/x/`;
- the Word copy, in the same places;
- the commands they show, such as `voicecap walkthrough --site <canonical address> …`, since `--site` takes it (see [Other commands](#other-commands));
- the names of the dated copies and of the walkthrough files (see [Sending it: `voicecap share`](#sending-it-voicecap-share));
- the website's headings and lists (see [The website: `voicecap site`](#the-website-voicecap-site));
- the run report's subtitle (see [Reading the report](#reading-the-report)).

**What keeps the address voicecap read.** The records are as they were written: the run's `site`, the site's folder, the walkthrough file, the terminal's output, a problem's record word for word, and the data the page carries for its fingerprint check. When the address voicecap read isn't the canonical one, the page's evidence says so, and names no address: "These runs read a copy of the site on the computer that ran them." for a copy at `localhost` or another of the computer's own addresses (`127.0.0.1`, say), and "These runs read a copy of the site at another address." for any other, such as a server on the network. The site itself over `http` in place of `https`, or with or without `www.`, is the site, and gets no such sentence.

**Older records.** A run from before 0.10.0 recorded no canonical address, and a share from before it recorded no site. Their site is named by the address voicecap read, or by `report.canonical` when it's set, and nothing already written is changed.

</details>

### The Word copy

<details>
<summary>What the Word copy holds, how it differs from the page, and what happens when Word has it open</summary>

`share/current.docx`, beside the page, is the page's Word copy. voicecap writes it with the page, from the same records, so it has the same sections and the same numbers. It's made for paper and for Word's navigation pane.

- **A title, the site's name, and when it was tested first.** It opens with "Screen reader test results", then the site's canonical name, then the line `report.siteName` sets, when there is one, then "Tested 29 September 2026, 14:02. This copy was made 30 September 2026." Then come how the pages were read and who prepared it, and the site's address last. A reader meets what the document is, which site it's about, and when it was tested before any web address.
- **The same sections, in the same order.** The page's ten sections, then a last heading, "About this report", over the footer's lines: what voicecap is, when the report was made, and the names of the file and of its web page. The page's footer names its Word copy the same way, so each copy tells its reader where the other is.
- **Nothing is folded.** What the page keeps behind a fold is open in the Word copy, written out in full.
- **Tables where the page has charts.** The page's tiles and bars are tables, and its cards for every page are one table, with the same numbers in them.
- **Made for paper and for Word's navigation pane.** Every section is a heading in one of Word's own heading styles, so View → Navigation Pane lists each one. Every page of paper ends with the site's name, the date, and its page number, and a table's header row repeats at the top of each page the table runs onto. It uses Calibri and Consolas, which Word has, in place of the page's IBM Plex.
- **No fingerprint check of its own.** A Word document can't check itself. Where the page has its check, the Word copy says what a reader can do instead: compare the file's own fingerprint with the one its sender recorded (`voicecap share` prints it), or run `voicecap verify` on the transcripts folder. It also says that the page can check the transcripts it shows.
- **No download, but how to get each run's walkthrough file.** A Word document can't carry the file, as the page does. Where the page has its download, the Word copy says to get the file from the web page, or with `voicecap walkthrough --site <site> --run <id> <file>`, and then gives the command that repeats the run. A run whose file can't be made says why.

On Windows, voicecap can't replace `current.docx` while Word has it open. A run, review, or report still finishes, in about a second, with the page written, and a warning says the Word copy wasn't updated: `current.docx` couldn't be replaced (with the error's code in parentheses, such as `EPERM`), as happens while it's open in Word. The warning says to close it, then gives the exact command to run. The command names the site and the transcripts home, so it works in a home of several sites, and in a home you gave with `--out`: `npx @icjia/voicecap report --site https://dvfr.illinois.gov --out 'C:\Users\cschw\code\voicecap-transcripts'`. Like the page, a Word copy that can't be made or written is a warning, never a failed run, review, or report, and neither file stops the other being written.

</details>

### Sending it: `voicecap share`

<details>
<summary>The dated copies and each run's walkthrough file, what <code>share</code> prints, the line for the email, and when it stops</summary>

`current.html` and `current.docx` change with every run, review, and report, so they aren't what to send. `voicecap share` makes copies of its own: the page and its Word copy, to send, and the walkthrough file of each run the page draws on. It records them all in `shares.json` (see [What was sent](#what-was-sent-sharesjson)). The page it sends is the one described above, so read "Before you send it" there first.

```bash
npx @icjia/voicecap share [--site <url>] [--out <dir>] [--reviewer <name>]
```

**The copies are dated.** The page and its Word copy are named for the site's canonical name and the day, such as `dvfr.illinois.gov_2026-10-02.html` and `dvfr.illinois.gov_2026-10-02.docx`, and they go in the site's `share/` folder. The name is the canonical address's host, and its port if it has one, made safe for a file name as a site's folder is (see [A site's name: its canonical address](#a-sites-name-its-canonical-address)). A site with no canonical address is named by the address voicecap read, as its folder is, which is how copies shared before 0.10.0 were named. A second share the same day takes `-2` (`dvfr.illinois.gov_2026-10-02-2.html`), then `-3`, and so on. A copy is never overwritten, and a name that `shares.json` records is never used again, even when the copy with that name has been deleted. Each copy's footer names the other by its dated name.

**Each run's walkthrough file** goes beside them, the oldest run first. It's the file the page offers to download, byte for byte, named for the share and the run, such as `dvfr.illinois.gov_2026-10-02_2026-09-26_1405_walkthrough.json`. It's recorded with its run, and never overwritten, as the other copies are. A run whose file can't be made gets a warning, such as `Warning: Run 2026-09-26_1405's walkthrough file can't be made, so it isn't shared: <why>`, and the share goes on without it. The website offers these files (see [The website: `voicecap site`](#the-website-voicecap-site)).

**It prints what it made:** each file's path, size, and SHA-256, then the line to paste into the email that sends the page and its Word copy (the fingerprints are shortened here: a real one is 64 characters):

```
PS> npx @icjia/voicecap share
Shared dvfr.illinois.gov, as of 2 October 2026: entry 1 in C:\Users\cschw\code\voicecap-transcripts\dvfr.illinois.gov\share\shares.json.
  C:\Users\cschw\code\voicecap-transcripts\dvfr.illinois.gov\share\dvfr.illinois.gov_2026-10-02.html
    1.2 MB (1,234,567 bytes), SHA-256 9f2c…e41a
  C:\Users\cschw\code\voicecap-transcripts\dvfr.illinois.gov\share\dvfr.illinois.gov_2026-10-02.docx
    310 KB (317,440 bytes), SHA-256 61b7…03d5
  C:\Users\cschw\code\voicecap-transcripts\dvfr.illinois.gov\share\dvfr.illinois.gov_2026-10-02_2026-09-26_1405_walkthrough.json
    4 KB (3,894 bytes), SHA-256 c04e…77b9
To paste into the email that sends the page and its Word copy:
  Fingerprints (SHA-256): dvfr.illinois.gov_2026-10-02.html 9f2c…e41a; dvfr.illinois.gov_2026-10-02.docx 61b7…03d5. To check a file you received: Get-FileHash <file> in PowerShell, or shasum -a 256 <file> on a Mac. PowerShell shows the same letters in capitals.
```

**The line for the email** names the page and its Word copy, each with its fingerprint, and says how to check a file you received. The walkthrough files aren't in it: they aren't what's emailed. The fingerprints are in lower case, as the copies and `shares.json` have them, and PowerShell shows the same letters in capitals, so the line ends by saying so. The copies' own fingerprint checks tell a reader to run the same two commands.

**Sizes** are in KB, with thousands separators, while the rounded size is under 1,024 KB, and in MB with one decimal from there. Each comes with its exact bytes. A copy over 20 MB gets a warning after the line for the email, such as `Warning: dvfr.illinois.gov_2026-10-02.docx is 23.4 MB, over 20 MB: too big for most email.`

**It needs a name, and a run that counts.** It takes the name of who is sharing as `review` does: `--reviewer`, then `VOICECAP_REVIEWER`, then `git config user.name`, then `reviewer` in the config. With none, it stops. It also stops when no completed, sealed, live run is there to show (a replayed, interrupted, or unsealed run doesn't count: see [The shareable page](#the-shareable-page)), and when it can't read `shares.json`. In each case it writes nothing and exits with code 1, and it never overwrites a `shares.json` it can't use.

</details>

### What was sent: `shares.json`

`share/shares.json`, beside the copies, records each share. An entry holds:

- `seq` and `prev`: its number in the chain, and the seal of the entry before it (`null` for the first);
- `at`, when the copies were made, in local time, and `by`, who shared;
- `site`, from 0.10.0: the root of the site the copies name, which their file names are made from. That's the canonical address, such as `https://dvfr.illinois.gov/`, or, for a site with none, the address voicecap read. A share made before 0.10.0 has none;
- `runs`: the ids of the runs the copies drew on, oldest first;
- `files`: the page, then its Word copy, then each run's walkthrough file (the oldest run first), each with its `name`, `bytes`, and `sha256`, and a walkthrough file's `run`, the id of its run;
- `seal`: a SHA-256 of the entry itself.

A share made by voicecap 0.8.0 or earlier lists only the page and its Word copy. Entries are sealed and chained as `reviews.json`'s are, and they're never edited or deleted: a new share is a new entry (see [Checking the record](#checking-the-record-voicecap-verify)). voicecap refuses to overwrite a `shares.json` it can't read.

The dated copies, the walkthrough files, and `shares.json` go into Git with the rest of the record: they're what was shared, and the record of it. `current.html` and `current.docx` stay out, since every run writes them again (see [What `.gitignore` keeps out, and why](#what-gitignore-keeps-out-and-why)). `voicecap verify` checks `shares.json` and each copy it records, and names a copy that nothing records.

## The website: `voicecap site`

`voicecap site` builds a website of every report voicecap has shared, by site and by date, with the demo. It gives people one address to open, in place of a file to send. Netlify can build it from the transcripts home's repository every time the repository is pushed. voicecap's own repository stays code only.

```bash
npx @icjia/voicecap site [--home <dir>] [--out <dir>]
```

`--home` is the transcripts home, and `--out` is the folder to build the site in: `_site` in the home, by default. Here `--out` isn't the home, as it is in the other commands (see [Other commands](#other-commands)). The command needs no screen reader.

**What's on the site,** in three views, with a bar of links to them:

- **The demo:** voicecap's report on its own small demo site, as an example of what it makes. It's there only when the home has a share of the demo (see [Publishing it, and the demo](#publishing-it-and-the-demo)). Its lead links to the demo's own pages, the ones NVDA read. Every build publishes them in `demo-site/`, so on ICJIA's site they're at [voicecap.netlify.app/demo-site/](https://voicecap.netlify.app/demo-site/), the demo's canonical address.
- **The sites:** each site, headed by its canonical name (such as `dvfr.illinois.gov`, from its newest share), with its reports, the newest first. Folders whose shares name one site are one site, with their reports together. A site whose shares name no canonical address is headed by its folder's name (see [A site's name: its canonical address](#a-sites-name-its-canonical-address)).
- **Every report, by date:** every site's reports, the newest first, each with its site's name and a link to its page. The demo isn't in it: it's an example, not a site.

Each report shows when it was shared and who prepared it, then its files: the page, to open; and its Word copy and the walkthrough file of each run it draws on, to download. Each file shows its size and its SHA-256 fingerprint, as `shares.json` recorded them. To check a copy against its fingerprint, run `Get-FileHash <file>` in PowerShell, or `shasum -a 256 <file>` on a Mac. A report shared before voicecap shared walkthrough files says that none was shared with it.

Here is the top of the site for the demo's report, in the dark theme it opens in, then in the light one a reader can pick. The bar links to "The demo", "The sites", and "Every report, by date", and holds the button that switches themes. Under "The demo" are the link to the demo's pages and the report, shared on 30 September 2026 at 09:00 by Demo Reviewer. The report lists its page to open, its Word copy, and the walkthrough file of each of the two runs it draws on, each with its size and SHA-256 fingerprint.

![The website in its dark theme, from its bar through the demo's report: the bar's links (The demo, The sites, Every report, by date) and its "Light version" button, the heading "Screen reader test results", the link to the demo's pages, and the report shared on 30 September 2026, 09:00, by Demo Reviewer, with its four files and their fingerprints.](https://raw.githubusercontent.com/ICJIA/voicecap/main/assets/screenshots/website-dark.png)

![The same part of the website in its light theme, after the reader picks "Light version". The button now reads "Dark version".](https://raw.githubusercontent.com/ICJIA/voicecap/main/assets/screenshots/website-light.png)

The site's page follows the shareable page's rules. It's one self-contained file, dark at first, with a button for a light version, and light in print. It's complete without JavaScript, and voicecap's tests run axe on it, in both themes. A reader's choice of theme carries between the site and its reports.

**Everything on the website is public to anyone with its address.** Anyone can open each report, and download each Word copy and walkthrough file. `robots.txt` and a header ask search engines to keep the site out of their results, but that's a request, not a lock. Keep the transcripts repository private: the website holds only what was shared, and the repository holds much more. Read "Before you send it", under [The shareable page](#the-shareable-page), and share only what you'd put on a public page.

**A share is never deleted, so the site shows every one,** as long as its record is intact. voicecap has no command that takes a report off the site.

### What the build reads, and what it leaves out

<details>
<summary>What it reads, what it publishes, what it leaves out and says so, and the folders it builds into</summary>

**What it reads:** only the record of what was shared. That's each site folder's `share/shares.json`, and the latest share in the home's `voicecap-demo/` folder, which it publishes under `demo/`. It never reads a run. Beside the records, it copies the demo site's own pages from voicecap itself, into `demo-site/` (see [The files it writes, and the headers](#the-files-it-writes-and-the-headers)).

**What it publishes:** each file that an entry names, when the entry's seal still holds and the file is still a regular file whose size and SHA-256 are the recorded ones. It copies the file byte for byte, so a file on the site is exactly the file that was shared, and its fingerprint matches.

**What it leaves out, and names.** Each is a warning in the build's output, such as `Warning: dvfr.illinois.gov/share/dvfr.illinois.gov_2026-10-02.docx: not published: the file is missing`. The build still finishes, with exit code 0, so one changed file doesn't stop every later update.

- **An entry whose seal no longer holds,** or whose fields aren't what voicecap records, and a `shares.json` that can't be read. The site shows nothing of it. Only the build's output names it.
- **A copy that has changed since it was shared, is missing, can't be read, or isn't a regular file** (a link or a folder, say). The report's other files are still published, and under the report the site says that `<name> isn't here`, and why.
- **A name voicecap never gives.** Only files whose names end in a lower-case `.html`, `.docx`, or `.json` are published, and only when they and their folder are named as voicecap names them: letters, digits, `.`, `_`, and `-` (lower case for a site's folder), with no dot at the start or end of a file's name. A file named `index.html` is left out too, since Netlify would serve it at its site folder's own address, where it would have no Content Security Policy. A name that holds a path, such as `../notes.txt`, is never read.
- **A site folder named `demo`,** which would take the demo's place on the site. One named `demo-site`, `index.html`, `robots.txt`, or `_headers` is left out too: it would take the place of the site's own folder or file.
- **A `voicecap-demo` that isn't a folder.** Git for Windows checks a committed link out as a plain file, so a file can be where the folder should be. The site is built without a demo.

**The folder it builds into** is emptied first, so voicecap builds only into a folder it can be sure of. That's a folder that's new or empty, or one an earlier build made: its `_headers` starts with voicecap's own line.

It stops at an earlier build's folder that holds a name starting with a dot (a repository's `.git`, say) or a folder inside a folder. A build writes neither, so they aren't voicecap's to delete. The one exception is `demo-site/`, the demo's own pages, which has a folder for each page: it counts as a build's when it holds only the paths this voicecap writes there. If `voicecap site` refuses a folder it built because `demo-site/` holds a file this voicecap doesn't write (a demo page that a later voicecap removed, say), delete the folder and build again. The files an operating system adds to a folder you open (`.DS_Store`, `Thumbs.db`, and `desktop.ini`) don't count against a folder an earlier build made, and are emptied with the rest.

It also refuses the transcripts home itself, a folder that holds the home, and anything inside a site's folder or inside `voicecap-demo/`. It goes by where each folder really is, so a link, a short name, or another letter case doesn't get past it. On Windows, it also refuses a folder whose name ends with a dot or a space, which Windows drops: a folder made with one can't be opened or removed there. Every refusal comes before anything is touched. The build says why, and exits with code 1:

```
Error: voicecap site won't build into C:\Users\cschw\code\voicecap-transcripts\notes: it isn't empty, and voicecap site didn't build it. Give a folder of its own, such as "C:\Users\cschw\code\voicecap-transcripts\_site".
```

</details>

### The files it writes, and the headers

<details>
<summary>What goes in the output folder, what <code>_headers</code> and <code>robots.txt</code> hold, and the files it writes in the home, for Git and for Netlify</summary>

**In the output folder,** every build writes:

- **`index.html`:** the site's page.
- **A folder for each site, and `demo/`,** holding the files of their reports, with the names they were shared under. A report's files stay in the folder they were shared in, so two folders that name one site can hold files of one name, and neither takes the other's place.
- **`demo-site/`:** the demo site's own pages and style sheet, copied from voicecap byte for byte, with a folder for each page, and a `sitemap.xml` that lists the pages at their canonical address. Every build writes it, whether or not the home has a share of the demo.
- **`robots.txt`:** `User-agent: *` and `Disallow: /`, which turns every crawler away.
- **`_headers`:** Netlify's file of headers, with a rule for each path.
  - Each page gets its own Content Security Policy, made from the SHA-256 of that page's own style and script: `default-src 'none'; script-src 'sha256-…'; style-src 'sha256-…'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. The page's own code runs, and nothing else does. It loads nothing from outside, makes no connection, and can't be put in a frame. Each page was made by the voicecap that shared it, so each is hashed from its own bytes.
  - Each of the demo's own pages gets a policy of its own, at every address it answers at: `default-src 'none'; style-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`. The pages have a style sheet beside them and a form that goes to a page of their own, and no script.
  - Each Word copy and walkthrough file gets `Content-Disposition: attachment`, so a browser downloads it.
  - Its first line, `# Made by voicecap site. Each build empties this folder and writes it again.`, is how a later build knows the folder is one it made.

**In the home,** the first time, and never again. `voicecap site` never writes over any of these files, so they're yours once they're there:

- **`.gitattributes` and `.gitignore`,** each only if the home doesn't have it yet. A run, a review, a share, or a manual session writes them too, so a home has both once any of those has written in it. They're the two a run writes, so the home's first build keeps `_site/` out of Git, with everything else voicecap keeps out (see [What `.gitignore` keeps out, and why](#what-gitignore-keeps-out-and-why)).
- **`netlify.toml`:** the build command, the folder to publish, and the headers every file gets.
  - **The build command,** such as `npx --yes @icjia/voicecap@0.9 site --home . --out _site`. It names the minor version of the voicecap that wrote the file: `@0.9` when voicecap 0.9.x wrote it, which npm reads as the latest 0.9 release. So the next build uses a patch release. It uses a new minor version only when you change the version in the command.
  - **The folder to publish:** `publish = "_site"`.
  - **The headers,** one line each:
    - `X-Robots-Tag: noindex, nofollow, noarchive`
    - `Referrer-Policy: no-referrer`
    - `X-Content-Type-Options: nosniff`
    - `X-Frame-Options: DENY`
    - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, which turns off those five
    - `Strict-Transport-Security: max-age=63072000; includeSubDomains`
    - `Cross-Origin-Opener-Policy: same-origin`
    - `Cross-Origin-Resource-Policy: same-origin`
- **`.nvmrc`:** `24`, so Netlify builds with Node 24, and the npm that comes with it.

`voicecap site` says when it writes one, such as `Wrote netlify.toml into <home>, for Netlify: commit it with the records.` or `Wrote .gitignore into <home>, for Git: commit it with the records.` `_headers` is Netlify's format, and voicecap builds the site for Netlify.

</details>

### Publishing it, and the demo

<details>
<summary>Sharing, committing, and pushing; looking at the site before it's pushed; and putting the demo on it</summary>

**To publish a report,** share it, then commit the transcripts home and push (as under [Setting it up](#setting-it-up)):

```bash
npx @icjia/voicecap share --site https://dvfr.illinois.gov
git add -A
git commit -m "voicecap share"
git push
```

`--site` names the site to share. A home with only one site doesn't need it, but with more than one, `share` stops and names them (see [Other commands](#other-commands)). Netlify then builds the site again, with `voicecap site`, and publishes what it builds. voicecap never commits or pushes: publishing is your push.

**To look at the site first,** run `npx @icjia/voicecap site`, then open `index.html`, in the `_site` folder of the transcripts home, in a browser. The links in it go to files in the same folder, so it works from there. The first time, the command also writes `netlify.toml` and `.nvmrc` in the home, and `.gitattributes` or `.gitignore` if the home is missing one (see [The files it writes, and the headers](#the-files-it-writes-and-the-headers)).

**The demo on the site** is the latest share in the home's `voicecap-demo/` folder. This is the one case where the demo's files belong in the home: they're committed with the records, so deleting `voicecap-demo/` and committing that, then pushing, takes the demo off the site at the next build. To put one there, in PowerShell, in the transcripts home's folder:

1. Run `npx @icjia/voicecap demo`. It's a guided tour of about 9 minutes that starts NVDA for real, so follow its steps and keep your hands off the keyboard when it says to (see [Try it first](#try-it-first-npx-icjiavoicecap-demo)). Use a Windows PC: on a Mac, the tour stops before the audit. Its files go in `voicecap-demo/`, in the current folder: the home.
2. Run `npx @icjia/voicecap share --out voicecap-demo`. The `--out` makes `share` work in the demo's folder, in place of the transcripts home, so it shares the demo's report. It needs a name for who is sharing, as every share does. The demo's pages name their own address, `https://voicecap.netlify.app/demo-site/`, so a demo run made by this voicecap learns it, and the report and its copies name the demo `voicecap.netlify.app`, such as `voicecap.netlify.app_2026-10-02.html`.
3. Commit and push, as above. `voicecap-demo/` goes with the rest.

To update the demo, do the three steps again: the site shows the latest share.

**A demo run made before 0.10.0** has no address in its record, since the pages it read had no canonical tags, so a share of it names the demo by the address voicecap read. Run the demo again: update it as above, with `npx @icjia/voicecap@latest demo` in step 1, so that `npx` uses the newest voicecap, not an older one it kept. The new run records the address from the demo's own tags, and the share names the demo by what its latest run recorded.

If you can't run the demo again, give the share the address in a config instead. **Keep that config out of the transcripts home.** `share`, `report`, `review`, `manual add`, and every run read the config in the folder they run from, so a `report.canonical` in the home would name every site in it after the demo, in shares that are never deleted (see [A site's name: its canonical address](#a-sites-name-its-canonical-address)). Put it in a folder of its own, and run `share` from there:

1. Make a folder outside the transcripts home, such as `C:\Users\cschw\code\demo-share`.
2. In that folder, make a file named `voicecap.config.json` with this in it:

   ```json
   { "report": { "canonical": "https://voicecap.netlify.app/demo-site/" } }
   ```

3. In PowerShell, go to that folder and share the demo from there, with the demo's folder in the transcripts home as `--out`. As every share does, it needs a name for who is sharing.

   ```powershell
   cd C:\Users\cschw\code\demo-share
   npx @icjia/voicecap share --out "$env:VOICECAP_TRANSCRIPTS\voicecap-demo"
   ```

   If you haven't set `VOICECAP_TRANSCRIPTS`, type the transcripts home's folder in its place. The share names the demo `voicecap.netlify.app`, such as `voicecap.netlify.app_2026-10-02.html`.
4. Go back to the transcripts home (`cd $env:VOICECAP_TRANSCRIPTS`), then commit and push, as above. Leave the config in its own folder, or take the folder away.

</details>

### The first deploy

<details>
<summary>Five steps, once: build the site, check <code>.gitignore</code>, commit and push the files it wrote in the home, import the repository in Netlify, and check the site</summary>

Do this once, after the transcripts home holds a share, and is a repository on GitHub (see [Setting it up](#setting-it-up)). The names below are ICJIA's: the repository `ICJIA/voicecap-transcripts` and the Netlify site `voicecap`, at https://voicecap.netlify.app. For another home, use its repository and a name of your own.

**Check the team's Netlify plan first.** Netlify shows it under the team's **Usage & billing**. Netlify builds from an organization's private repository, as `ICJIA/voicecap-transcripts` is, only on its Pro or Enterprise plan (Core Pro, on older accounts). On Free, Personal, or Core Starter, every build fails. Netlify's troubleshooting page lists these ways around it:

- Upgrade the plan.
- Move the repository to a personal GitHub account. Netlify builds from a personal account's private repository on any plan.
- Deploy by hand after running `voicecap site`, with Netlify's CLI or its API, or by dragging the built folder onto the deploys page. A deploy by hand doesn't build on each push, and may not send the headers `netlify.toml` gives every file, such as `X-Robots-Tag`. `robots.txt` still asks search engines to stay out.

[Netlify's page on it](https://docs.netlify.com/build/configure-builds/troubleshooting-tips/#organization-owned-private-repository) lists making the repository public too. Don't: it holds the run records.

1. **Build the site once on this computer.** In PowerShell, run:

   ```powershell
   npx @icjia/voicecap@latest site
   ```

   It builds from the transcripts home (`VOICECAP_TRANSCRIPTS`; give `--home <folder>` if you haven't set it). `@latest` makes `npx` use the newest voicecap, not one it kept: `netlify.toml` names the version that writes it, and Netlify builds with that version. It prints a line for each file it writes in the home, then one for the site (your numbers will differ). If the home is missing `.gitattributes` or `.gitignore` (a home that holds a share has both already), it writes that too, with a line that ends `for Git: commit it with the records.`:

   ```
   Wrote netlify.toml into C:\Users\cschw\code\voicecap-transcripts, for Netlify: commit it with the records.
   Wrote .nvmrc into C:\Users\cschw\code\voicecap-transcripts, for Netlify: commit it with the records.
   Built the site in C:\Users\cschw\code\voicecap-transcripts\_site: 3 reports from 2 sites, and the demo's.
   ```

   Check that the folder it names is your transcripts home. Anything it left out comes as `Warning:` lines before the last line, and the build still finishes (see [What the build reads, and what it leaves out](#what-the-build-reads-and-what-it-leaves-out)). If it stops with an `Error:`, it says why. If the `Error:` says `isn't a folder`, the transcripts home isn't where `VOICECAP_TRANSCRIPTS` (or `--home`) says it is.

2. **Add `_site/` to `.gitignore`, if voicecap says to.** Look at step 1's output. If it has a warning that ends `Add the line _site/ to it.`, add that line to the home's `.gitignore`. A home that voicecap set up with 0.8.0 or earlier needs it. A newer home's `.gitignore` has it already, and so does the one step 1 writes in a home that had none, so with no such warning, go on to step 3. To add the line:
   1. In PowerShell, go to the transcripts home's folder: `cd $env:VOICECAP_TRANSCRIPTS`. (If you haven't set `VOICECAP_TRANSCRIPTS`, type `cd` and the folder's path.)
   2. Run `notepad .gitignore`. It opens the file in Notepad.
   3. Go to the end of the file, and add a line of its own that says `_site/`.
   4. Save the file, and close Notepad.
   5. Do the `npx @icjia/voicecap@latest site` step again. The warning should be gone.

3. **Commit the files step 1 wrote in the home (and `.gitignore`, if you changed it), and push.**
   1. In PowerShell, go to the transcripts home's folder: `cd $env:VOICECAP_TRANSCRIPTS`.
   2. Run `git status`.
   3. Check that it lists the files step 1 said it wrote: `netlify.toml` and `.nvmrc`, and `.gitattributes` and `.gitignore` if it wrote them. It lists `.gitignore` too if you added `_site/` to it. It must not list `_site/`. If it does, go back to step 2.
   4. Run `git add .gitattributes .gitignore netlify.toml .nvmrc`. (Netlify can publish only what's pushed. If a share isn't pushed yet, run `git add -A` in its place: it adds the share too.)
   5. Run `git commit -m "Add the files voicecap site wrote"`.
   6. Run `git push`.

4. **In Netlify, import the repository and name the site.**
   - Sign in at https://app.netlify.com.
   - On the Projects page, open the **Add new project** menu, and choose **Import an existing project**.
   - Choose GitHub. When Netlify asks for access to the repository, allow it, then pick `ICJIA/voicecap-transcripts`.
   - Name the project `voicecap`, if the page has a field for the name. A project is Netlify's word for a site. The address is then `https://voicecap.netlify.app`. If Netlify says the name is taken, pick another, and use that address in step 5. If the page has no field for the name, go on: the last bullet renames the project afterwards.
   - Leave the build settings as they are: `netlify.toml` sets them, and its settings win over the ones on the page.
   - Choose the button that starts the deploy (**Deploy site**), and wait for the deploy to finish.
   - If the page had no field for the name, rename the project now that the deploy has finished. Open the project's overview, choose **Customize**, then **Manage project name and cover image**, enter `voicecap`, and save. The address changes to match.

5. **Open the site and check it.** Open the address from step 4, or the one on the project's overview. Check that:
   - the page opens, with "Screen reader test results" at the top, and the links in its bar go to "The demo" (when the home has one), "The sites", and "Every report, by date";
   - a report's page opens;
   - a Word copy and a walkthrough file download, for a report shared with this release or later, or the demo's; an earlier report says none was shared;
   - a downloaded file's fingerprint is the one the site shows: `Get-FileHash <file>` in PowerShell shows it, in capitals;
   - each page came with its headers. Do this for the site's home page, looking for `X-Robots-Tag: noindex, nofollow, noarchive`, then for a report's page, looking for `Content-Security-Policy`:
     1. Open the page.
     2. Press F12. The browser's developer tools open.
     3. Choose the **Network** tab.
     4. Press F5. The page loads again.
     5. Click the first request in the list. Its name is the page's own address.
     6. Find **Response Headers**.
     7. Find the header. Its name may show in lower case.

     If a header is missing, check first that you clicked the page's own request. If `X-Robots-Tag` is still missing, check that `netlify.toml` in the repository still has its `[[headers]]` part, and that Netlify built the site from the repository: a deploy by hand may not send it. If `Content-Security-Policy` is missing on a report's page, open the deploy's log in Netlify: the build's last line should start `Built the site in`.

   If the site says `No reports have been shared yet.`, nothing shared has been pushed: share, commit, and push, and Netlify builds again. If the deploy failed, open its log in Netlify. The build's own lines are the ones `voicecap site` printed in step 1. If they show that voicecap doesn't know the command `site`, `netlify.toml` names a version from before the website: change the version in its build command to one that has it, push, and deploy again. A build that stops with "Build blocked" about a private repository means the team's plan: see the paragraph before step 1.

</details>

## Repeating a run: the walkthrough file

A walkthrough file is a run's recipe, so anyone can repeat the run exactly: the same pages, in the same order, with the same passes and limits. It's for an auditor who wants to check the results, and for you, after a major update to the site. `voicecap walkthrough` writes one from a completed run, `--walkthrough` repeats the run from it, and the shareable page offers each run's file to download.

After a repeat, voicecap says page by page how each page sounds against the original run. A repeat reads the same pages the same way, but it can't promise the same words: a changed site, or a newer screen reader or browser, changes what's said.

### Writing the file: `voicecap walkthrough`

<details>
<summary>The command, which run it writes from, where to write the file, what it holds, and where else to get one</summary>

```bash
voicecap walkthrough [--site <url>] [--run <id>] [--out <dir>] <file>
```

It writes the walkthrough of a completed run to `<file>`, then says where it is and how to repeat the run:

```
PS> npx @icjia/voicecap walkthrough C:\Users\cschw\walkthrough.json
Wrote the walkthrough of run 2026-09-26_1405 (12 pages) to C:\Users\cschw\walkthrough.json.
To repeat the run: npx @icjia/voicecap --walkthrough 'C:\Users\cschw\walkthrough.json'
```

- **Which run.** `--run <id>` names it. Without it, voicecap takes the site's latest completed run, a replayed one included (the file says it was a replay). A run that didn't complete can't be written: run it to the end first. `--site` and `--out` pick the site and the transcripts home as `share` does (see [Other commands](#other-commands)).
- **It never overwrites a file.** A name that's taken is refused: give another, or move that file first. It makes the file's folder when that's missing.
- **Write it outside the transcripts home,** which is the audit record. `voicecap verify` names a new folder inside a site's folder, and a file inside a run's `pages/` folder, as problems.
- **It needs no screen reader,** so it works on any computer, a Mac included.
- **It never writes a file that voicecap would refuse to read.** For example, a run with more than 10,000 pages, a step limit above 100,000, or a file that would be over 8 MB can't be written. voicecap says why, writes nothing, and exits with code 1.
- **The shareable page offers each run's file too.** In the evidence behind its results, each run the page draws on has a link that downloads its walkthrough file, with the command that repeats the run.
  - The link says "Download the walkthrough file" and the file's size, and names its run for a screen reader.
  - The file is the one `voicecap walkthrough` writes for that run, saved as `<site name>_<run id>_walkthrough.json`, such as `dvfr.illinois.gov_2026-09-26_1405_walkthrough.json`. The site's name is its canonical name, made safe for a file name as a site's folder is, or the address voicecap read when the site has no canonical address (see [A site's name: its canonical address](#a-sites-name-its-canonical-address)). It's carried inside the page as text, so each file adds about a third more than its size to the page.
  - The Word copy can't carry a file, so it says to get it from the web page, or with `voicecap walkthrough --site <site> --run <id> <file>`, and gives the command that repeats the run.
  - A run whose file can't be made says why, in the page and in the Word copy.

**What the file holds.** It's plain JSON, with the pages in the run's order:

- `voicecapWalkthrough`, the format's version (`1`), and the `site`;
- `pages`: every page of the run's list, with its address, its label, template, and notes where it has them, what the original run did with it (`status`), and the fingerprint of each pass it read, which is what a repeat compares itself with;
- `settings`, which a repeat applies: the passes, each pass's step limit, the capture mode, and the readiness settings (`null` when the run didn't record them, as runs made with voicecap 0.7.0 or earlier didn't, and a repeat then uses this computer's);
- `original`, where the file came from, which is recorded and never applied: the run's id and seal, when it began and finished, whether it was a replay, its page source and the fingerprints of what it read from, the versions of voicecap, the screen reader, and the browser, and the NVDA settings and browser channel it used.

A page list's file is kept by its name only, never its folders, since a path can carry a person's user name. voicecap repeats what the file says. It reads the file strictly and refuses one that breaks the format (see [Repeating the run from the file](#repeating-the-run-from-the-file)).

</details>

### Repeating the run from the file

<details>
<summary>The command, what a repeat takes from the file and from this computer, what it refuses, and how the file is read</summary>

```bash
npx @icjia/voicecap --walkthrough <file> [--reviewer <name>] [--out <dir>] [--compare <run-id>]
```

A repeat is a run like any other, with its own folder, its own record, and its own seal. It reads the same pages in the same order, with the same passes, step limits, capture mode, and readiness settings, all from the file (this computer's readiness settings, when the file has none). It needs no `--site`: the site is the file's. voicecap first says which run, of which site, it's repeating, as in `Repeating run 2026-09-26_1405 of https://dvfr.illinois.gov from walkthrough.json: 12 pages.`

- **NVDA's settings and the browser are this computer's.** A file can come from anyone, so it never changes this computer's NVDA settings or its browser. The file records the original's, and voicecap says afterwards which versions and which NVDA settings differ.
- **Refused beside it,** before anything runs, because they would change what's read: `--sitemap`, `--pages`, `--page`, `--limit`, `--include`, `--exclude`, `--passes`, and `--max-steps`, and a `--site` that isn't the file's own. voicecap stops with exit code 1 and says which, such as `--walkthrough repeats the pages and passes its file lists, so it can't be used with --limit.` Allowed: `--out`, `--reviewer`, `--compare`, `--run-name`, `--fresh`, and `--replay-from`.
- **An interrupted repeat resumes** when you run the same command again with the same file, as any run does (see [Long runs, interruptions, and resuming](#long-runs-interruptions-and-resuming)). A file that was edited since starts a new run, since the file is identified by its contents.
- **Its page source is the file.** The run's record names the file, its SHA-256, the id of the run it was made from, and what that run's pages came from.
- **To compare it with the original line by line,** give the original's id: `--compare <run-id>`. `--compare previous` finds an earlier repeat of the same file, not the original, since a repeat's page source is the file.
- **On a Mac,** a repeat waits for voicecap's VoiceOver driver, as every run does. Until then, repeat on a Windows computer, with NVDA. With `--replay-from`, a repeat plays back a recorded run on any computer, with no screen reader, which is how voicecap's own tests and CI try it.

**How the file is read.** The file may come from anyone, so voicecap takes nothing on trust. It refuses a file, before anything runs, and says what's wrong and where, when:

- it isn't JSON, or has a format version this voicecap doesn't read, a key it doesn't know, or no pages;
- it lists more than 10,000 pages;
- a page isn't on the file's own site, or its address has a space or a control character in it, or is over 8,192 characters;
- a page's label, template, or notes has a control character in it other than a tab or a line break;
- the ready selector (`readySelector`) has a control character in it, or is over 1,024 characters;
- its NVDA settings are nested more than 32 levels deep;
- a run id has characters that a run id doesn't have (it can be 1 to 100 letters, digits, `.`, `_`, and `-`);
- a step limit is over 100,000, or a readiness time is over ten minutes (600,000 milliseconds);
- it's over 8 MB, which voicecap refuses without reading it.

A page the file lists twice is read once, as with a page list.

</details>

### What a repeat says afterwards

<details>
<summary>The comparison with the original, page by page, what "sounds the same" means, and what a repeat can't promise</summary>

When a repeat completes, voicecap prints each page of the file against the original, after the line that says where the report is:

```
Run 2026-10-02_0930 complete. Report: C:\Users\cschw\code\voicecap-transcripts\dvfr.illinois.gov\report.html
Compared with run 2026-09-26_1405, from its walkthrough file:
  https://dvfr.illinois.gov/: sounds the same
  https://dvfr.illinois.gov/about/: sounds different (headings, tab)
  https://dvfr.illinois.gov/grants/fy27-jag: wasn't read in the original
  https://dvfr.illinois.gov/faq/: couldn't be read now
1 of 4 pages sound the same.
Different from the original: NVDA 2026.3 (was 2026.2), Chrome 154.0.8037.58 (was 153.0.8010.53).
```

- **`sounds the same`:** every pass matches the original's. A pass matches when its fingerprint is the same: the words NVDA said, line by line, without the transcript's header, whose timestamps would differ.
- **`sounds different`:** one or more passes that both ran don't match. They're named, in the order `read`, `headings`, `tab`.
- **`wasn't read in the original`:** the repeat read the page, and the original didn't: it failed, or was skipped.
- **`couldn't be read now`:** the repeat didn't read the page, whatever the original did with it.
- **The count** is the pages that sound the same, out of the pages in the file.
- **What else differs,** when something does: the versions of NVDA, the browser, and voicecap, each named only when both runs recorded it, and then the names of the NVDA settings whose values differ from the original's.

A pass that only one of the two ran is named, such as `the tab pass wasn't run in this repeat` or `the headings pass wasn't run in the original`, and the page isn't counted as sounding the same.

voicecap prints this when the repeat completes, and doesn't keep it. The comparison needs only the file, which holds the original's fingerprints. A repeat that's interrupted, or stops, says nothing until a later session completes it. For the words that changed, line by line, give `--compare` the original's id: the report then marks the changed pages and links to the diffs (see [Reading the report](#reading-the-report)). On the shareable page, a repeat's "What changed since the last run" compares it with an earlier repeat of the same file (the same page source), never the original, so the first repeat of a file has nothing earlier to be compared with there.

**What a repeat can't promise.** It reads the same pages the same way, with the same keys in the same order, but it can't promise the same words. A changed site, or a newer screen reader or browser, changes what's said, and so can timing (see [Known limitations](#known-limitations)). So "sounds different" points to where to look, and the person running voicecap reads the transcripts, as in any run.

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
    canonical: "https://dvfr.illinois.gov",
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
| `report.siteName` | `null` | A name of your own for the site, such as its full title: a line under the site's name on the shareable page and in its Word copy (see [The shareable page](#the-shareable-page)). It isn't the headline, which is the site's canonical name. It names every site the config is used with, so use a config per site for different names. Without it, the page has no such line. |
| `report.canonical` | `null` | The site's canonical address, the one people visit, such as `"https://dvfr.illinois.gov"`: a bare name works, and it's kept as a root with a `/` on the end. When the shareable page, its Word copy, or a share is made, it names the site, and it beats the address every run recorded. So it names every site the config is used with: use a config per site. An IP address or a local address is refused. Without it, the page uses the address the latest run that counts recorded, and without that, the address voicecap read (see [A site's name: its canonical address](#a-sites-name-its-canonical-address)). |

Unknown settings are errors, to catch typos. The SHA-256 of the effective config is recorded with every run. A `report.canonical` that isn't set is left out of it, so a config without one has the SHA-256 it had before 0.10.0, and runs from before and after the upgrade aren't said to differ in their config. For a repeat, that's this computer's config: what the repeat took from the file is in the run's settings. A repeat from a walkthrough file takes `passes`, `capture`, `stepCaps`, and `readiness` from the file instead of the config, except that a file with no readiness settings leaves the config's (see [Repeating a run: the walkthrough file](#repeating-a-run-the-walkthrough-file)).

</details>

## Programmatic API

<details>
<summary>An example, and what <code>runAudit</code> and the other functions take and return</summary>

```ts
import {
  addManualSession,
  addReview,
  buildSite,
  createConsoleLogger,
  generateReport,
  loadConfig,
  runAudit,
  shareReport,
  writeWalkthrough,
} from "@icjia/voicecap";

const result = await runAudit({ site: "https://dvfr.illinois.gov", pages: "pages.csv" });
console.log(result.runId, result.exitCode);

await addReview({ page: "/about", status: "reviewed", reviewer: "Pat Reviewer" });
await addManualSession({ file: "nvda.log", page: "/about", redactTyping: true });

const { config } = await loadConfig();
await generateReport({ outDir: result.siteDir, config, logger: createConsoleLogger() });

const shared = await shareReport({ site: "https://dvfr.illinois.gov", reviewer: "Pat Reviewer" });
console.log(shared.pasteLine);

const site = await buildSite({ home: "voicecap-transcripts" });
console.log(site.out, site.leftOut);

const written = await writeWalkthrough({
  file: "walkthrough.json",
  site: "https://dvfr.illinois.gov",
});
console.log(written.file, written.runId);

const repeat = await runAudit({ walkthrough: written.file });
```

`runAudit` accepts every CLI option, with `--page`'s values as `pageUrls` (an array of full URLs or root-relative paths), plus `signal` (an `AbortSignal` that interrupts the run like Ctrl+C), `logger`, `config`, `driver` (any object implementing `ScreenReaderDriver`), and `askListener` (a function called when a session that read pages ends, however it ends, but never for a replay, and given `{ screenReader, pagesRead }`: the screen reader's name and how many pages the session went through; it asks whether the person heard the screen reader speaking, and resolves to `"all"`, `"part"`, or `"no"`, or to `null` for no answer; without it, nothing is asked). `generateReport`'s `outDir` is a site's folder in the transcripts home, not the home itself; `runAudit`'s result gives you one as `siteDir`, and `addReview` and `addManualSession` find theirs the same way `review` and `manual add` do (`--site`, or a full page URL, or the home's only site). To find one yourself, `siteDirFor(resolveHome({ env: process.env, cwd: process.cwd() }), site)` gives a site's folder, and `chooseSiteDir` picks one as those commands do, and takes a site's canonical address as well as the address voicecap read; `siteFolder` names it. The data formats (`RunJson`, `TranscriptJson`, `ReviewsFile`, `ManualSessionJson`, `SharesFile`) are exported as TypeScript types.

`generateReport`, `addReview`, and `addManualSession` write the Word copy, `share/current.docx`, as well as the shareable page, as the commands do (`addReview` and `addManualSession` write neither when `regenerateReport` is `false`). `shareReport` makes the dated copies to send, as `voicecap share` does: the page, its Word copy, and each run's walkthrough file. It takes `site` (any URL on the site, or its canonical address), `out`, and `reviewer`, plus `logger` and `config`, whose `report.canonical` names the site, and says what it made to its `logger` as the command does. It gives back `siteDir`; `entry`, as `share/shares.json` holds it; `files`, the page, then its Word copy, then each run's walkthrough file (the oldest run first), each with its `path`, `name`, `bytes`, and `sha256`, and a walkthrough file's `run`; and `pasteLine`, the line for the email that sends the page and its Word copy. It throws a `UsageError`, with nothing written, when there's no name for who is sharing, no run that counts, or a `shares.json` it can't read.

`readShares(siteDir)` reads a site's `share/shares.json`, and gives back a `SharesAsRead`: `{ schemaVersion: 1, shares }`. It checks only that each share is an object, since a person can edit the file, so each share is typed as a `Record<string, unknown>`, and a caller checks each field it uses. It was typed as a `SharesFile`, with every field known, which promised more than it checks. So it's a compile-time change: code that reads a field of a share, such as `files`, now needs to check it first. `SharesAsRead` is exported, so a caller can name the type. `SharesFile` is still exported too, and describes what `voicecap share` writes. `SharedFile` has a new, optional `run`: the run that a walkthrough file is of. A `ShareEntry` has a new, optional `site` (from 0.10.0): the root of the site its copies name.

The run's records have new, optional fields from 0.10.0, which leave code that reads them as it was: `RunJson.canonical`, the root of the site's canonical address, and `PageRecord.canonical`, the address a page's own tag gave. `PageInfo`, which a driver gives back for each page it opens, has a new, required `canonical`: the address of the page's first `<link rel="canonical">` tag, as the browser resolved it, or `null` when the page has none or the driver can't read tags. It's a compile-time change for a custom driver, which now has to return the field. At run time, a driver that leaves it out works as one that returns `null`.

`buildSite` builds the website as `voicecap site` does (see [The website: `voicecap site`](#the-website-voicecap-site)). It takes `home`, the transcripts home (default: `VOICECAP_TRANSCRIPTS`, else `./transcripts`), and `out`, the folder to build in (default: `_site` in the home), plus `cwd`, `env`, and `logger`, and says what it wrote and what it left out to its `logger` as the command does. It gives back `out`, the full path of the folder it built in; `content`, what it published, as a `SiteContent`; and `leftOut`, each thing it left out, worded as the build's output words it. A `SiteContent` has `demo`, a `PublishedReport` or `null`, and `sites`, each with its `name` (the heading the site shows: its canonical name, or its folder's name), its `folders` (the site folders its reports are in, more than one when folders name one site), and its `reports`, the newest first. A site had a `folder` in place of `name` and `folders`, so it's a compile-time change for code that reads one: `name` is the heading, and each of `folders` is where files are. A `PublishedReport` has its `folder`, `id` (its anchor on the page), `at`, `by`, its `files`, and `notPublished`: the files its record names that aren't published, each with its `name` and a `reason`, `"changed"` or `"missing"`. A `PublishedFile` has its `kind` (`"page"`, `"word"`, `"walkthrough"`, or `"other"`), `name`, `href`, `bytes`, `sha256`, and `run` (the run a walkthrough file is of, else `null`). A copy that has changed, or is missing, doesn't make it throw: it's left out, and named in `leftOut`. It throws a `UsageError`, before anything is changed, when the home isn't a folder, and when the folder to build in is one it mustn't empty. The types `BuildSiteOptions`, `BuildSiteResult`, `SiteContent`, `PublishedReport`, and `PublishedFile` are exported.

`writeWalkthrough` writes a run's walkthrough file as `voicecap walkthrough` does (see [Repeating a run: the walkthrough file](#repeating-a-run-the-walkthrough-file)), and never overwrites one. It takes `file`, plus `site`, `run`, and `out`, and `logger`, and says what it wrote to its `logger` as the command does. It gives back `file`, the full path it wrote; `runId`; and `walkthrough`, what the file holds. It throws a `UsageError`, with nothing written, when the site has no completed run, when the run named isn't there or didn't complete, when voicecap's own reader would refuse the file, and when something is at `file` already. `runAudit`'s `walkthrough` is the path of a walkthrough file to repeat: the pages, passes, step limits, capture mode, and readiness settings come from it (the config's readiness settings, when the file has none), `site` becomes optional, and `sitemap`, `pages`, `pageUrls`, `limit`, `include`, `exclude`, `passes`, and `maxSteps` are refused with it. `parseWalkthrough(text, file)` reads a walkthrough file's text as a repeat does, strictly, and gives back a `Walkthrough`, or throws a `UsageError` that names the file (`file` is its name, for that message) and says what's wrong. `walkthroughOf(run)` builds the `Walkthrough` of a completed run's record, `walkthroughJson(walkthrough)` is the text a file holds, and `walkthroughProblem(walkthrough)` is why `parseWalkthrough` would refuse a `Walkthrough`, or `null`. The types `Walkthrough`, `WalkthroughPage`, `WalkthroughSettings`, `WalkthroughOrigin`, `WriteWalkthroughOptions`, and `WriteWalkthroughResult` are exported.

A run's page source (`PageSource`) has four kinds now, `sitemap`, `pages`, `urls`, and `walkthrough`, and so does `SourceDetails`'s `kind`, so code that switches on `kind` needs a case for `"walkthrough"`. A `walkthrough` source holds the file, its `sha256`, the `run` it was made from, and `from`, what that run's pages came from: `"sitemap"`, `"pages"`, or `"urls"`.

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
<summary>NVDA's fast speech during a run, timing, a portable NVDA, English phrasing, the computer being voicecap's during a run, and more</summary>

- **NVDA speaks very fast during a run.** voicecap runs Guidepup's own copy of NVDA, which Guidepup sets to NVDA's top speed, and Guidepup silences NVDA before each key press, so a long line is cut off. The transcripts have every word. To hear a page at your own speed, run NVDA yourself: see [Manual NVDA sessions](#manual-nvda-sessions).
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
| `pnpm share:fixture <folder>` | Writes the demo's shareable page and its Word copy into a folder, to look at a change to either. Needs no screen reader. |
| `pnpm site:fixture <folder>` | Builds the website from the demo fixture, to look at a change to it: makes a transcripts home with reports shared in it at `<folder>/home` (which must not be there yet), builds the site in `<folder>/_site`, and prints the path of its `index.html`. Needs no screen reader. |
| `pnpm readme:screenshots [folder]` | Makes the README's six screenshots, of the demo's shareable page and of the website built from its report, in `assets/screenshots` (or the folder given), from a temporary home. Needs Playwright's Chromium, and no screen reader. It refuses to write a shot that shows an IP address or `localhost`. Run it when the page's or the site's design changes, and commit what it writes. |

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

## Credits

**A hat tip to [Guidepup](https://www.guidepup.dev/), the starting point for voicecap.** voicecap came from a need at ICJIA: more than a dozen websites to go through methodically with a real screen reader, NVDA or VoiceOver, keeping a transcript of each, to round out an accessibility review beside axe, Lighthouse, and Pa11y before the April 2027 ADA Title II deadline for accessible digital content. Guidepup is what made that possible, and where the work started. It's Craig Morten's open-source library ([guidepup/guidepup](https://github.com/guidepup/guidepup), MIT license) for driving real screen readers from code: NVDA on Windows and VoiceOver on a Mac. voicecap has grown a long way from that start, with its page lists, sealed audit record, reviews, reports, and shareable page. It still starts the screen reader, presses its keys, and reads back what it said, all through Guidepup, and the NVDA it runs is Guidepup's portable build.

voicecap also stands on:

- **[NVDA](https://www.nvaccess.org/)**, the free, open-source screen reader from NV Access, which does the reading on Windows;
- **[Playwright](https://playwright.dev/)**, which opens each page in a real browser;
- **[IBM Plex](https://github.com/IBM/plex)**, the typefaces in the shareable page, under the SIL Open Font License.

## License

[MIT](LICENSE) © 2026 Illinois Criminal Justice Information Authority (ICJIA)
