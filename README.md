# voicecap

[![CI](https://github.com/ICJIA/voicecap/actions/workflows/ci.yml/badge.svg)](https://github.com/ICJIA/voicecap/actions/workflows/ci.yml)

## voicecap in brief

voicecap is a free, open-source tool from the Illinois Criminal Justice Information Authority (ICJIA) that captures what a screen reader user actually hears on a website.

Automated accessibility checkers such as axe and Lighthouse catch problems like missing labels, but they can't tell you what a page sounds like. voicecap drives NVDA, one of the two most widely used screen readers, through a site's pages the way a blind visitor would: reading from top to bottom, jumping from heading to heading, and tabbing through links and buttons. It saves everything NVDA says as plain-text transcripts.

That lets a reviewer:

- skim what NVDA says on a page much faster than listening to it;
- compare runs to see exactly what changed after an update;
- record what they reviewed and found, and add their own hands-on NVDA sessions.

Everything goes into one record that voicecap never rewrites, and `voicecap verify` checks that the recorded files still match what voicecap wrote.

voicecap doesn't replace testing by people who use screen readers. It makes that testing faster, repeatable, and documented. It runs on Windows with NVDA and Chrome: https://github.com/ICJIA/voicecap

---

voicecap drives the NVDA screen reader through a website's pages (from its sitemap or a page list you curate), saves what NVDA says as text transcripts you can skim and diff, and produces an accessible HTML report of automated coverage and human review.

It doesn't replace listening to a site with a screen reader. It makes that review faster and keeps an honest audit trail:

- **Transcripts** of everything NVDA says, one line per keystroke, that a person can skim much faster than listening to, and that can be diffed between runs to catch regressions.
- **An audit trail** of what was transcribed automatically, what a person reviewed (with a full, append-only history), and what was tested by hand with NVDA.

> **Status.** voicecap runs NVDA on Windows through its Guidepup driver, checked end to end against real NVDA 2026.2 with Chrome 153. Everything else (reports, reviews, manual sessions, and the whole pipeline under the **replay driver**, which plays back a recorded run) works on Windows, macOS, and Linux.

## Contents

- [Quick start](#quick-start)
- [Windows setup (for someone new to Windows)](#windows-setup-for-someone-new-to-windows)
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
- [Heuristic flags](#heuristic-flags)
- [Configuration](#configuration)
- [Programmatic API](#programmatic-api)
- [Drivers](#drivers)
- [Updating Guidepup](#updating-guidepup)
- [Known limitations](#known-limitations)
- [Development](#development)
- [License](#license)

## Quick start

voicecap needs **Node.js 22.19 or later** (24 recommended). You run it with `npx`; pnpm is only needed to develop voicecap itself.

**Try it on any OS** with the replay driver and the test fixture in this repository:

```bash
git clone https://github.com/ICJIA/voicecap.git && cd voicecap
pnpm install && pnpm build
node dist/cli.js --site http://127.0.0.1:4747 --pages fixture/pages.json --replay-from fixture/replay-run
# then open transcripts/127.0.0.1_4747/report.html
```

**On a real site, answer a few questions and voicecap composes the command for you:**

```
$ npx @icjia/voicecap init

Website: i2i.illinois.gov
Checking https://i2i.illinois.gov…
  → https://i2i.illinois.gov (it answers)
Looking for the site's sitemap…
Where are the pages?
  1. The site's sitemap: https://i2i.illinois.gov/sitemap-index.xml
  2. A sitemap at another address
  3. A page list file (.csv or .json)
  4. One page
Choose [1]:
How many pages? A number, or Enter for all [all]: 5
Transcripts home [C:\Users\cschw\code\voicecap-transcripts]:
  → this run goes into C:\Users\cschw\code\voicecap-transcripts\i2i.illinois.gov\2026-09-27\

Your command:
  npx @icjia/voicecap --site https://i2i.illinois.gov --sitemap https://i2i.illinois.gov/sitemap-index.xml --limit 5
Run the same command again later to resume where it stopped.

NVDA will speak and take over the keyboard until the run ends.
Run it now? [y/N]:
```

### Starting voicecap

**What's needed:** Node.js 22.19 or later. For real runs: Windows, `voicecap setup` once (voicecap's own copy of NVDA, no administrator rights), and preferably Google Chrome. Nothing else: no Git, no separate NVDA, no Playwright.

**Without installing:** `npx @icjia/voicecap init`. npx downloads voicecap the first time and reuses it; `npx @icjia/voicecap@latest init` picks up a newer version. In Git Bash, type `init` rather than relying on the bare command: Git Bash's own window (mintty) doesn't always let Node see a terminal, so `npx @icjia/voicecap` alone can print the usage error there instead of starting the questions.

**Or install it once:** `npm install -g @icjia/voicecap`, then `voicecap init` (and `voicecap setup`, `voicecap doctor`, `voicecap --site …`) in Git Bash, PowerShell, or cmd. On Windows 11 this creates `voicecap`, `voicecap.cmd`, and `voicecap.ps1` commands, with no administrator rights needed; `npm install -g @icjia/voicecap@latest` updates it. The command `init` prints is quoted for Git Bash and PowerShell; in cmd, its single quotes must become double quotes (or answer "Run it now?" with y, which uses no shell).

npm may warn that it skipped `ffmpeg-static`'s install script: harmless, since only `@guidepup/setup`'s macOS screen recording uses it.

The command `init` prints always starts with `npx @icjia/voicecap`, so it works on any computer with Node.js; with a global install, `voicecap` can replace it.

## Windows setup (for someone new to Windows)

These steps assume Windows 11, a normal (non-administrator) account, and Git Bash inside Windows Terminal.

1. **Install Git and Node.js** with winget from a Windows Terminal (PowerShell) window:

   ```powershell
   winget install --id Git.Git -e
   winget install --id OpenJS.NodeJS.LTS -e
   ```

   Node's installer is machine-wide and usually needs administrator rights once, so on a managed PC you may need IT to run it (Git may prompt too). Close and reopen Windows Terminal afterwards so both are on your PATH.

2. **Open Git Bash** in Windows Terminal: the tab drop-down (the `˅` next to the `+`) lists "Git Bash" once Git is installed. You can make it the default profile in Windows Terminal's settings. Check with `node --version` (22.19 or later) and `git --version`.

3. **Only if you'll develop voicecap:** install pnpm with `corepack enable pnpm` (or `npm install -g pnpm`). Running voicecap needs only Node and `npx`.

4. **Install NVDA for voicecap:** `npx @icjia/voicecap setup`. This downloads (about 100 MB, from GitHub) the portable NVDA build that voicecap's pinned Guidepup expects into `%LOCALAPPDATA%\guidepup`. It's separate from any NVDA you already have installed, and needs no administrator rights. If Google Chrome isn't installed, setup also installs Playwright's Chromium for voicecap to use instead. Behind a proxy, set `HTTPS_PROXY` first.

   - **If your Windows user folder's path has a space or one of `& ( , ; = ^`** (`C:\Users\Jane Doe`, `C:\Users\R&D`), Guidepup can't start NVDA from there. setup explains the fix: set `GUIDEPUP_SCREEN_READERS_PATH` to a plain folder such as `C:\guidepup`, open a new terminal, and run setup again.
   - **The first time NVDA starts**, Windows may ask whether NVDA can communicate on networks. voicecap talks to NVDA only on this computer (127.0.0.1); it doesn't need network access.

5. **Check everything:** `npx @icjia/voicecap doctor`. It checks the NVDA build, whether another NVDA is running, that NVDA starts and its speech is captured, that the browser comes to the front, and that NVDA speaks English. It prints a summary you can paste into a bug report:

   ```
   OK    NVDA build: 0.2.1-2026.2 (NVDA 2026.2), installed at C:\Users\…\nvda.exe
   OK    Other NVDA: none running
   OK    Browser: Chrome 153.0.8010.53 (C:\Program Files\Google\Chrome\Application\chrome.exe)
   OK    NVDA speech: captured ("heading, level 1, voicecap doctor check" / "Doctor button, button"), 1.3 s per step
   OK    Foreground: the browser came to the front (checked with NVDA+T)
   OK    NVDA language: en-US
   ```

6. **Before a run:**
   - **Close your own copy of NVDA.** voicecap shuts down any running NVDA when it starts (Guidepup does this), and it warns you first.
   - **Don't use the computer during a run.** NVDA's keystrokes go to whichever window is in front. voicecap brings its browser to the front for every page, checks it with NVDA+T, and throws away any step during which another window came forward, but each click elsewhere costs a page (it's recorded as failed). NVDA speaks aloud throughout, and NVDA's Speech Viewer window opens beside the browser.
   - **Keep the computer unlocked.** On a locked computer, NVDA can't press keys or speak, and voicecap stops with "Windows is locked". voicecap keeps Windows from sleeping or turning the screen off while it runs, but it can't stop a lock: Win+L, a screen saver set to lock, or a workplace lock policy. If you step away, leave it unlocked. A minimized Remote Desktop window (Windows stops drawing it) breaks a run too.
   - **Turn on Do Not Disturb** (Settings → System → Notifications) so notifications don't get read into transcripts.
   - **Pause Windows Update** restarts during long runs (Settings → Windows Update → Pause updates). If a restart happens anyway, voicecap resumes where it stopped.

### Git Bash and paths that start with "/"

Git Bash rewrites command-line arguments that start with `/` into Windows paths, so `--page /about` reaches voicecap as `C:/Program Files/Git/about`. voicecap detects this and stops with an explanation. Three ways around it:

- use full URLs: `--page https://dvfr.illinois.gov/about/` (always works);
- leave off the leading slash in patterns: `--include 'news/*'` (patterns match with or without it);
- turn the rewriting off for one command: `MSYS_NO_PATHCONV=1 npx @icjia/voicecap review --page /about ...`.

## Commands and options

### Run an audit

```bash
npx @icjia/voicecap --site <url> (--sitemap <url> | --pages <file> | --page <url>...) [options]
```

`--site` is required, plus exactly one kind of page source: `--sitemap`, `--pages`, or one or more `--page`; giving none of them, or a mix, is an error.

| Option | Meaning |
| --- | --- |
| `--site <url>` | The site. Pages must be on its origin. |
| `--sitemap <url>` | Take pages from a sitemap: a `<urlset>` or a `<sitemapindex>` (child sitemaps are read too; gzip is fine). |
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
| `--run-name <name>` | Add a name to the run's folder, e.g. `2026-09-26_1405_exhaustive`. |
| `--replay-from <dir>` | Use the replay driver: play back a run folder instead of running NVDA. |

**Patterns.** Globs match the URL's path: `news/*` matches `/news/fy27-grants` but not `/news/` itself; `news/**` matches both, and deeper paths. The leading slash is optional in both the pattern and the path. `re:` patterns are regular expressions tested against the path plus the query string (with and without the leading slash), e.g. `--exclude 're:\?page=\d+'`. `--include`, then `--exclude`, then `--limit` apply, in that order.

### Other commands

```bash
voicecap list-urls --site <url> --sitemap <url> [--sample N] [--include p] [--exclude p] [--limit n] <output.csv|output.json>
voicecap review --page <url> --status <unreviewed|reviewed|issue|fixed> [--note "..."] [--reviewer <name>] [--run <run-id>] [--site <url>] [--out <dir>]
voicecap manual add <file> --page <url> [--from <time>] [--to <time>] [--date <YYYY-MM-DD>] [--redact-typing] [--keep-raw] [--no-raw] [--reviewer <name>] [--site <url>] [--out <dir>]
voicecap report [--run <run-id>] [--compare <run-id|previous>] [--site <url>] [--out <dir>]
voicecap verify [--site <url>] [--out <dir>]
voicecap setup     # Windows: install the NVDA build voicecap's Guidepup expects
voicecap doctor    # Windows: check NVDA, the browser, and speech capture; print a summary
```

Wherever a command takes a page, give a full URL or a root-relative path (`/about`). `review`, `manual add`, and `report` work in one site's folder in the transcripts home: give `--site`, or a full URL with `--page`, or, when the home has only one site's folder so far, nothing at all (see [The audit record](#the-audit-record)).

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The run (or command) completed. Heuristic flags never change this. |
| 1 | Invalid usage or config (including an unreadable page source). |
| 2 | The environment is unusable, e.g. NVDA won't start, or several pages in a row failed. |
| 3 | The run completed, but some pages failed. `voicecap verify` also uses 3, for something recorded that doesn't match. |
| 130 | Interrupted with Ctrl+C. State was saved; run the same command again to resume. |

## Page sources

### Sitemaps (`--sitemap`)

voicecap reads `<urlset>` sitemaps and `<sitemapindex>` files, following child sitemaps (loops are ignored, gzip is fine). If a child sitemap can't be fetched, the run continues with the rest and the problem is recorded in `run.json` and the report. For sitemaps behind a proxy, set `NODE_USE_ENV_PROXY=1` along with `HTTPS_PROXY`.

### Page lists (`--pages`)

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
voicecap list-urls --site https://dvfr.illinois.gov --sitemap https://dvfr.illinois.gov/sitemap.xml pages.csv
```

This writes `url` plus empty `label`, `template`, and `notes` columns, with the same filtering a run uses. Open it in a spreadsheet, delete rows, fill in labels and templates, save as CSV UTF-8, and run with `--pages pages.csv`.

### Drafting a sample

```bash
voicecap list-urls --site https://i2i.illinois.gov --sitemap https://i2i.illinois.gov/sitemap-index.xml --sample 10 pages.csv
```

With `--sample N`, voicecap drafts a sample for you to curate: N pages per URL path pattern, with the pattern in the `template` column. The pattern is the page's parent path plus `/*` (`/news/*`, `/researchhub/articles/*`); top-level pages share `/*` and the home page is its own group. Pages are picked evenly spaced through each group, and voicecap prints what it chose and why. A run never samples on its own: the page list decides.

## What voicecap does on each page

For each page, voicecap runs up to three **passes** in a real browser with NVDA running. Before each pass it loads the page fresh, in a new browser with a new profile (so no page's speech depends on the pages before it: no "visited" links, cookies, or saved state), and waits until it's ready (network idle, plus an optional `readySelector` and settle delay for sites like Nuxt that keep rendering after load). Then it brings the browser window to the front and checks with NVDA+T (report title) that NVDA sees it there: keystrokes go to whichever window is in front, so if the browser can't be brought forward, the page is recorded as an error rather than transcribing the wrong window. Finally it moves NVDA to the top of the page, in browse mode.

voicecap captures **everything** NVDA says after each keystroke: it waits until NVDA has been quiet for a second, so a step takes about 1.3 seconds. That's the right trade for an audit trail. A step during which another window came to the front is thrown away and the page recorded as failed, so another window's speech never ends up in a transcript.

### read

Walks the page line by line in browse mode (Down Arrow) to the end. NVDA has no end-of-document announcement: on the last line, Down Arrow simply says the last line again. So voicecap:

1. jumps to the bottom (Ctrl+End) and records the last line;
2. returns to the top (Ctrl+Home) and reads down;
3. stops when that line is spoken and the next step repeats it, then presses Down once more to confirm (`read.endConfirmations`).

Two identical lines in a row mid-page, such as back-to-back "Read more" links, don't stop it, and neither does a last line that also appears earlier. (A run of three or more identical lines mid-page that also matches the last line can still end it early; raise `read.endConfirmations` if your pages have those.) When NVDA moves onto the last line it also announces containers it enters (like "content info landmark"), but it leaves them out when it repeats the line; voicecap matches the repeat against the end of what Ctrl+End said, so this doesn't matter. The pass also stops if the same speech repeats `repeatLimit` times in a row (a safety net) or at the step cap (default 400), and records which condition stopped it.

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

Everything goes in the transcripts home: `--out <dir>`, else the `VOICECAP_TRANSCRIPTS` environment variable, else `./transcripts` in the current folder. Inside it, each site you run voicecap against gets its own folder:

```
transcripts/
  dvfr.illinois.gov/                 ← one folder per site (its host name, plus _port if the URL has one)
    2026-09-26/
      1405/                         ← one folder per run: local date and time, plus --run-name if given
        run.json                   ← run metadata, environment, transcript hashes, resume state, and seal
        report.html                ← snapshot of the report when the run completed
        pages/<page-slug>/
          read.txt  read.json  headings.txt  headings.json  tab.txt  tab.json
        attempts/<page-slug>/1/    ← an earlier attempt at a retried or resumed page, kept
        compare/<base-run>/        ← diffs, when the run used --compare
    reviews.json                   ← append-only review history, by page; persists across runs
    report.html  latest.txt        ← live report, and the id of the most recently completed run
    compare/<base>__<run>/         ← diffs made by `voicecap report --compare`
```

- **Runs never overwrite each other**, and a run folder is never modified after the run completes. Two runs started in the same minute get `-2`, `-3`, and so on.
- **Page slugs** are a readable part of the path plus a short hash of the URL (`grants-fy27-jag-1a2b3c4d5e`), safe on Windows and short enough to avoid path-length problems. The home page is `home`. The full URL is inside every JSON file.
- **TXT transcripts** start with a header block (every line begins `# `): the page, the run, the stop reason, and the full environment record, so each file stands alone as evidence. After one blank line comes **one line per step**, everything NVDA said in response to one keystroke. Setup steps are labeled (`[to bottom] …`, `[to top] …`), and a step where NVDA said nothing is written `[no speech]`, so line N of the body is always step N.
- **JSON transcripts** hold one record per step (number, command, spoken text, duration, time since the pass started, and for the tab pass the focus state and focused element) plus the page, pass, step count, stop reason, duration, timestamp, errors, warnings, and the environment record.
- **Environment record.** `run.json` records, and every transcript repeats: page source (sitemap URL, or page list file with its SHA-256), driver and version, NVDA version (and Guidepup's build id), NVDA language, capture mode, browser and version, OS, voicecap version, a hash of the effective config, run timestamp, and NVDA's speech, document formatting, browse mode, and keyboard settings.
- **Hashes.** `run.json` records the SHA-256 of every transcript file (integrity) and of each pass's TXT body without the header (content). "Changed since review" and `--compare` use the content hashes, because headers include timestamps and run ids.

## The audit record

voicecap can keep a permanent, non-destructive record of every run and every manual session, for audit and legal purposes: one private Git repository, pushed often, where the runs for any site can be counted and every file can be trusted not to have changed. Point every voicecap command at one folder outside your site's own repository — the **transcripts home** — and give that folder to Git on its own.

### Layout

```
voicecap-transcripts/
  .gitattributes  .gitignore          ← written once, at the top (see below)
  dvfr.illinois.gov/                  ← one folder per site
    2026-09-27/                       ← one folder per day with a run or manual session
      1102/                           ← an automated run
        run.json  report.html
        pages/faq/read.txt ...
        attempts/faq/1/read.txt ...   ← an earlier, retried attempt at a page, kept
      1415_manual_faq/                ← a manual NVDA session on /faq/
        session.json  session.txt  raw/nvda-log.txt
    reviews.json                      ← append-only review history
    report.html  latest.txt           ← regenerated views
    compare/                          ← regenerated diffs
    .voicecap.lock                    ← only while a run writes here
  i2i.illinois.gov/
    2026-09-27/
      1044_before-redesign/
```

The site folder is the site's host name, lowercased, plus `_<port>` when the URL has one, with anything other than `a-z 0-9 . -` replaced by `_` (`https://dvfr.illinois.gov` → `dvfr.illinois.gov`; `http://127.0.0.1:4747` → `127.0.0.1_4747`). `review`, `manual add`, and `report` work in one site's folder at a time: give `--site`, or a full URL with `--page`, or, when the home has only one site's folder so far, nothing at all. With more than one and neither given, voicecap stops and names them.

The home's top can also hold your own files and folders, notes for example. A folder there is a site's folder only when it holds a date folder, `reviews.json`, `latest.txt`, or `report.html`; any other is left alone, and `review`, `manual add`, `report`, and `verify` never take it for a site.

### What's guaranteed

- **A completed run is never modified again.** `run.json` records every transcript file's SHA-256 as it's written, and once the run completes, the whole record is sealed (see "Checking the record," below).
- **Reviews are append-only.** A correction is a new entry in `reviews.json`, never an edit to an earlier one.
- **A retried or resumed page keeps its earlier attempt**, moved to `attempts/<slug>/<n>/` instead of being overwritten. Reports and comparisons ignore it.
- **voicecap 0.2.0's layout is left alone.** If a home still has its `runs/` or `manual/` folders, they're never read or moved; a run just says once that it saw them.

### Checking the record: `voicecap verify`

```bash
voicecap verify [--site <url>] [--out <dir>]
```

Every record voicecap finishes writing is sealed: a completed run's `run.json`, each manual session's `session.json`, and each review entry carry a `seal`, a SHA-256 of the record itself. Review entries also chain to the one before them (`seq`, `prev`). A reordered entry, or a deleted one that a later entry follows, breaks the chain; an edited one no longer matches its own seal, including the newest entry, which no later entry points to yet.

`verify` checks every site folder in the home, or one with `--site`: each run's seal and the SHA-256 of every file it recorded; each manual session's seal, its transcript, and its raw copy when one was kept; and the whole review chain. It prints one line per problem it finds, then a summary for each site, and exits **0** when everything matches and **3** when something doesn't. An incomplete run (still running, or interrupted) is listed, not counted as a problem, and a missing raw NVDA log isn't either: `.gitignore` keeps those out of Git on purpose (see below), so a clone of the home never has them.

So `verify` catches an edited record, a reordered review entry, and a deleted entry that a later entry follows. It doesn't check the regenerated views (a site's `report.html`, `latest.txt`, and `compare/`), a run's own `report.html` and `compare/` diffs, or kept earlier attempts.

**What it can't catch on its own:** someone who edits a record and recomputes its seal, and every later seal and `prev`; and someone who deletes the newest review entries, or a whole run or manual session, which leaves nothing for `verify` to find: only Git history shows it. Git history pushed to a protected branch catches both, since rewriting commits that are already pushed takes a force-push, and a branch protected against force-pushes refuses it — which is why the setup below has you protect the branch and push often.

### What `.gitignore` keeps out, and why

voicecap writes `.gitattributes` and `.gitignore` at the home's top the first time it needs them, and never overwrites them, so your own edits or additions stay. `.gitattributes` (`* -text`) keeps Git from changing line endings on checkout, which would otherwise make the recorded hashes stop matching the files. `.gitignore` keeps out:

- **`.voicecap.lock`**, the marker a run holds while it's writing.
- **Manual sessions' raw NVDA logs** (`**/*_manual_*/raw/`). At Input/output level, NVDA's log records every keystroke, including passwords typed into forms — not something to put in Git. The raw copy's SHA-256 stays in `session.json` either way, so a home missing a raw copy isn't something `verify` will flag.
- **Temporary files a crash can leave behind** (`.*.tmp`). voicecap writes each file under a temporary name first, then renames it into place.
- **Files the operating system adds** to folders you open: `.DS_Store` (macOS), `Thumbs.db` and `desktop.ini` (Windows).

> **Never commit an unredacted raw NVDA log.** See [Manual NVDA sessions](#manual-nvda-sessions).

### Setting it up

**Windows, in Git Bash:**

```bash
mkdir -p /c/Users/cschw/code/voicecap-transcripts && cd /c/Users/cschw/code/voicecap-transcripts && git init
gh repo create voicecap-transcripts --private --source .
setx VOICECAP_TRANSCRIPTS 'C:\Users\cschw\code\voicecap-transcripts'
```

`gh repo create --private --source .` is one way to make the private repository; it adds the `origin` remote. Leave off `--push` — there's nothing to push yet. `setx` only takes effect in a new terminal.

**macOS:** the same, with `~/webdev/voicecap-transcripts`, and in `~/.zshrc`:

```bash
export VOICECAP_TRANSCRIPTS=~/webdev/voicecap-transcripts
```

**After runs, reviews, or manual sessions:**

```bash
git add -A && git commit -m "voicecap runs"
git push -u origin HEAD   # the first time
git push                  # after that
```

`git commit -S` signs the commit, if you want proof of who committed.

**Once, after the first push:** on GitHub, protect the default branch against force pushes and deletion, in the repository's Settings → Rules → Rulesets, or Settings → Branches → Branch protection rules. Whether a private repository can use these depends on your GitHub plan.

Keep the repository private: manual sessions can carry reviewer names, notes, and typed text.

## Long runs, interruptions, and resuming

**Measured run times** (Windows 11, NVDA 2026.2, Chrome 153): each step takes **1.3 seconds** (voicecap waits for a second of silence after every keystroke), and each page adds about **17 seconds**, about 6 per pass, to load the page in a fresh browser, bring it to the front, and move NVDA to the top. So a page takes about 1.3 s × its steps + 17 s:

| Pages | Steps per page (all three passes) | Time per page | 100 pages | 2,000 pages |
| --- | --- | --- | --- | --- |
| Five sampled pages of i2i.illinois.gov (measured) | 46–68 | 78–106 s, 92 s on average | about 2½ hours | about 2 days |
| A long page | 250 | about 6 minutes | about 9½ hours | about 8 days |

Count a page's steps as its lines in browse mode, plus its headings, plus its focusable elements. Interruptions are normal: reboots, Windows Update, power cuts.

- **Resuming.** At the start of a run voicecap stores the page list and a hash of the settings that matter (site, page source, passes, filters, limit, driver, capture mode, step caps, NVDA settings, browser). `run.json` is rewritten after every page (atomically: a temporary file is flushed to disk and renamed, with retries while Windows holds the file). Running the same command again resumes the most recent incomplete run with the same settings, skipping pages already done (failed pages are retried). Otherwise voicecap starts a new run and says why. `--fresh` always starts a new run.
- **Sitemap runs resume with the page list stored when they started**, so a sitemap that changed in the meantime (a new news item, say) doesn't block resuming. A page list file is identified by its contents, so editing it starts a new run.
- **A failing page never stops the run**: it's recorded, reported, and the run moves on. Steps and whole pages have timeouts; after a timeout voicecap restarts NVDA and the browser and retries the page once before recording it as failed. After `maxConsecutiveFailures` failed pages in a row (default 5), voicecap stops with exit code 2 instead of marking every remaining page failed; fix the problem and rerun to resume.
- **Restarts.** NVDA and the browser are restarted every `restartEvery` pages (default 50).
- **If NVDA dies** (it crashes, or someone closes it), or Guidepup loses its connection to it, the step in progress fails rather than being recorded as silence, and voicecap restarts NVDA and the browser; the page is retried when you resume.
- **If the browser updates itself** during a run (Chrome does, in the background), the page being opened when the new version starts fails, and voicecap stops with exit code 2 when it restarts the browser for the next page, so the version recorded with the transcripts stays true. Run the same command again to resume with the new version recorded; the failed page is retried. (On the last page, the run completes instead, with that page failed: exit code 3.)
- **Ctrl+C** saves state, shuts down NVDA and the browser, and exits with code 130; the page in progress is redone on resume. Press Ctrl+C a second time to exit immediately.
- **One run per output folder** at a time (a lock file, taken over if the process that held it is gone).
- **HTTP errors are page problems.** A page that answers 404 (or 5xx, after one retry) is recorded as failed, but it doesn't count toward stopping the run and doesn't restart NVDA. Only timeouts and driver errors do. When a run resumes, pages never tried come first and pages that failed earlier are retried last, so a resumed run always makes progress.
- **Avoid synced folders** (OneDrive, Dropbox) for the output: sync clients and antivirus scans can hold files open. voicecap retries, but a folder they keep locked can still stop a run. If Git on Windows complains about long paths in `transcripts/`, run `git config core.longpaths true`.

## Reviews: the audit trail

```bash
voicecap review --page /grants/fy27-jag --status issue --note "Table headers not announced"
voicecap review --page /grants/fy27-jag --status fixed --note "Headers added in #412"
```

Each page has a full, append-only history in its site's `reviews.json` (see [The audit record](#the-audit-record)). Every entry records the status (`unreviewed`, `reviewed` with no issues, `issue` found, `fixed`), the reviewer, a timestamp, the note, the run reviewed (by default the latest run with transcripts for the page; `--run` picks another), and the SHA-256 hashes of that run's transcripts for the page. Entries are never edited or deleted: a correction is a new entry, and the latest entry is the page's current status. Each entry is sealed and chained to the one before it, so `voicecap verify` can catch an edited or reordered entry, and a deleted one that a later entry follows; deleting the newest entries leaves nothing for it to find (see [Checking the record](#checking-the-record-voicecap-verify)). voicecap refuses to overwrite a `reviews.json` it can't read.

The reviewer name comes from `--reviewer`, then the `VOICECAP_REVIEWER` environment variable, then `git config user.name`, then `reviewer` in the config. voicecap won't record a review without one.

A page is **changed since review** when its transcripts in the run shown differ from the ones recorded with its latest review.

## Manual NVDA sessions

`voicecap manual add` imports a hands-on NVDA session for a page into its site's folder in the transcripts home, under `<date>/<time>_manual_<page-slug>/` (see [The audit record](#the-audit-record)). voicecap recognizes two kinds of input.

### Speech Viewer

In NVDA, open NVDA menu → Tools → Speech Viewer, use the page, then copy the Speech Viewer text into a file:

```bash
voicecap manual add speech.txt --page /grants/fy27-jag
```

Speech Viewer has no timestamps or keystrokes: each line is one utterance, and its items are separated by two spaces (voicecap converts them to ", " like the automated transcripts).

### The NVDA log (Input/output level)

The log records each keystroke and what NVDA said, with times:

1. NVDA menu → Preferences → Settings → General → **Logging level → Input/output**. Press OK.
2. Test the page.
3. Copy the log: NVDA menu → Tools → View log, or copy `%TEMP%\nvda.log` (`nvda-old.log` holds the previous NVDA session).
4. **Set the logging level back** to its previous value ("Info" by default) when you're done.

```bash
voicecap manual add nvda.log --page /grants/fy27-jag --redact-typing
voicecap manual add nvda.log --page /about --from 14:05 --to 14:20   # part of a log
```

voicecap keeps only the keystrokes (`Input: …`) and speech (`Speaking […]`) and discards everything else. Log times have no date: the session date comes from `--date`, or else the file's modification date (voicecap prints it so you can confirm), and sessions that cross midnight are handled. `--from` and `--to` import part of a log, so one log can cover several pages.

### What gets saved

- a clean `.txt` transcript (for logs: each keystroke followed by what NVDA said in response);
- a `.json` file with the entries (time, key or speech, text) and the page, input format, session start and end, NVDA version, import date, and reviewer;
- the unmodified original in `raw/`, named so it doesn't end in `.log` (many repositories ignore `*.log`, which would silently leave the evidence uncommitted), with its SHA-256 in the JSON. `--no-raw` skips the copy but keeps the hash.

Sessions are named by their date and time, so several sessions per page can coexist.

### Privacy

**Input/output logs record every keystroke, including text typed into form and password fields.** voicecap warns on every log import, and warns again if it finds typing in form fields and you didn't ask to redact it.

`--redact-typing` replaces keys typed while focus is in an editable field, and NVDA's spoken echo of them, with `[typed text redacted]`. With `--redact-typing` the raw log is not kept (only its SHA-256, with a note that it was withheld for privacy); `--keep-raw` keeps it anyway, with a warning.

The redaction is a heuristic, and it has limits. It relies on NVDA announcing an editable role (English phrasing such as "edit" or "password edit") when focus moves to the field, so it can miss:

- fields reached without that announcement (by mouse, or in apps NVDA reads differently);
- pasted text that NVDA reads back;
- error messages that quote what you typed, and autocomplete suggestions;
- input methods (IME) and typing in other applications.

It errs on the side of hiding things. After focus leaves a field by mouse click, speech stays redacted until the next focus key (Tab, Escape, …), which can hide ordinary page speech. Enter counts as leaving a field, so further typing in a multi-line field after Enter is only caught when NVDA logs it as a typed word. With `--from`/`--to`, redaction still follows focus from the start of the log, so a field entered before the window is handled.

Check the clean transcript before committing it, and never commit an unredacted raw log.

## Verifying transcript fidelity

This is a different question from `voicecap verify` (see [The audit record](#the-audit-record)), which checks that a recorded file hasn't changed since voicecap wrote it. To check that an automated transcript really is everything NVDA said, compare it with a Speech Viewer capture of the same page:

1. Open Speech Viewer, load the page, press Ctrl+Home, then Down Arrow until the end, and save the Speech Viewer text.
2. Compare it with `read.txt` (skip the header block and the `[to bottom]` line). Normalize first:
   - **Separators.** Speech Viewer separates items with two spaces and utterances with new lines; transcripts separate items with ", " and put all the utterances of one keystroke on one line, joined with ". ".
   - **Symbols.** Speech Viewer shows the text before NVDA turns symbols into words; transcripts have the words NVDA speaks. So Speech Viewer's `© 2026` and `•` are `copyright 2026` and `bullet` in a transcript (NVDA's English symbol names, at its default symbol level).
   - **Empty items.** Transcripts keep NVDA's empty text items (`edit, , button` for an empty field); Speech Viewer shows them as extra spaces.

`fixture/manual/speech-viewer.txt` is a real capture of the fixture's home page, and the fixture tests compare it with the fixture run's read transcript this way. On Windows, `pnpm test:nvda` repeats the whole check against live NVDA.

## Reading the report

Open `transcripts/report.html` in a browser. It's a single self-contained file (no external assets) and is itself accessible.

- **Summary**: the page source (curated list or full sitemap), driver and capture mode, and counts: pages, transcribed, reviewed, changed since review, manually tested, open issues, errors, skipped URLs. Banners mark replayed output ("not a live NVDA session"), incomplete runs, and environment changes.
- **Pages table**: one row per page with its template, run status, step counts and stop reasons per pass, heuristic flags, current review status (with reviewer and date), number of review entries, a "changed since review" marker, manual sessions, and links to every transcript. With `--compare`, a column marks changed pages and links to the text diffs.
- **Filters** (flagged, review status, template, changed since review, manually tested) are ordinary form controls; the number of pages shown is announced. Without JavaScript the full table is still there.
- **Skipped URLs**, **Review history** (every entry for every page), **Manual NVDA sessions**, and the **Environment** record follow.

`review`, `manual add`, and `voicecap report` regenerate `transcripts/report.html`. Each run's folder keeps its own `report.html` snapshot from when it completed. `voicecap report --run <id>` renders a specific run, including an incomplete one (clearly marked).

**Compare.** `--compare previous` (or a run id) compares the pages both runs contain, marks changed pages, and links to line diffs of the transcripts (not the header blocks). Pages that appear in only one run are listed. If the two runs' environments differ (NVDA, browser, voicecap, NVDA settings, capture mode), the report says so prominently, because some changes may come from the tooling rather than the site.

## Heuristic flags

Flags point a person at pages worth a closer listen. They never fail a page or change the exit code.

| Flag | Raised when |
| --- | --- |
| `generic-link-text` | A pass announces generic link text at least twice: "click here", "read more", "learn more", "here", "more", … or a link with no name. |
| `unlabeled` | A button, edit field, or other control is announced with no name ("button", "edit"), a graphic has no description, or NVDA says "unlabeled". |
| `read-not-finished` | The read pass stopped at its step cap or the repeat safety net instead of the end of the page. |
| `headings` | The page has no headings, or its first heading isn't level 1. |
| `tab-no-stops` | Tab reached no focusable elements. |
| `tab-before-main` | Ten or more focus stops come before main content and the first stop isn't a skip link (judged from the focused elements, not speech). |
| `repeated-phrase` | The same speech repeats four or more times in a row (a possible focus trap or duplicated content), ignoring the read pass's end-of-page repeat. |

The rules, including the NVDA phrasing they match, live in the config (`flags`), and you can add your own phrase rules. The phrasing assumes NVDA's English interface. If you change the rules, `voicecap report` recomputes the flags from the transcripts, without running NVDA again.

## Configuration

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
| `phrasing.noNextHeading` | `"^no next heading$"` | NVDA's announcement after the last heading (a regular expression). |
| `flags.*` | see [Heuristic flags](#heuristic-flags) | Each rule's `enabled` switch, phrasing, and thresholds; `flags.custom` adds phrase rules `{ id, description, passes, pattern, minCount }`. |
| `manual.editableRoles` | `["edit", "password edit", …]` | Words that mean focus is in an editable field (redaction). |
| `manual.focusKeys` | `["tab", "shift+tab", "enter", …]` | NVDA key names that move focus (redaction). |
| `reviewer` | `null` | Default reviewer name. |
| `report.title`, `report.agency`, `report.logo` | `"NVDA transcript report"`, `null`, `null` | Report branding; the logo must be a `data:image/…` URI. |

Unknown settings are errors, to catch typos. The SHA-256 of the effective config is recorded with every run.

## Programmatic API

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

`runAudit` accepts every CLI option, with `--page`'s values as `pageUrls` (an array of full URLs or root-relative paths), plus `signal` (an `AbortSignal` that interrupts the run like Ctrl+C), `logger`, `config`, and `driver` (any object implementing `ScreenReaderDriver`). `generateReport`'s `outDir` is a site's folder in the transcripts home, not the home itself; `runAudit`'s result gives you one as `siteDir`, and `addReview` and `addManualSession` find theirs the same way `review` and `manual add` do (`--site`, or a full page URL, or the home's only site). To find one yourself, `siteDirFor(resolveHome({ env: process.env, cwd: process.cwd() }), site)` gives a site's folder, and `chooseSiteDir` picks one as those commands do; `siteFolder` names it. The data formats (`RunJson`, `TranscriptJson`, `ReviewsFile`, `ManualSessionJson`) are exported as TypeScript types.

## Drivers

A driver owns both the screen reader and the browser, so the rest of voicecap never touches Guidepup or Playwright. The `ScreenReaderDriver` interface (`src/drivers/types.ts`) is expressed in actions (open a page, next line, next heading, next focusable, to top, to bottom, focus checks); voicecap's core decides when a pass stops from what the driver returns, so replay exercises the same stop logic as a real run.

- **`guidepup`** (default): NVDA through [Guidepup](https://github.com/guidepup/guidepup), with the browser driven by Playwright as a library. Windows only. It launches the browser itself (with a new profile for each page load) and attaches Playwright to it, because a browser launched by Playwright pretends to have focus, and the driver relies on real focus to keep keystrokes out of other windows. It removes Guidepup's own Ctrl+C handlers (they stop NVDA but never exit), so voicecap saves its state first and stops NVDA exactly once.
- **`replay`**: no screen reader or browser. It plays back a run folder (`--replay-from`), matched by URL: each pass's recorded steps in order, then NVDA's end behavior (the last line repeats, "no next heading", focus leaves the page). Replayed output is labeled as such in every transcript and report.
- **`at-driver`**: a stub for the W3C [AT Driver](https://w3c.github.io/at-driver/) protocol. Every method throws "not implemented"; the comments show how each maps to AT Driver messages.

## Updating Guidepup

Guidepup changes its API across versions and releases often, so voicecap pins `@guidepup/guidepup` and `@guidepup/setup` exactly and upgrades them together:

1. `pnpm add -E @guidepup/guidepup@<version> @guidepup/setup@<version>`.
2. Re-check the driver against the new versions' source (`src/drivers/guidepup/nvda.ts` lists what it relies on): method names, capture behavior, signal handling, where the NVDA build is installed.
3. Re-run `voicecap setup`: a new Guidepup can pin a new NVDA build (it reads `manifest.json` from the installed `@guidepup/guidepup`).
4. On Windows, run `pnpm test:nvda`: it runs voicecap with real NVDA on the fixture site and checks end-of-page detection, "no next heading", the tab pass starting at the skip link, and complete capture against Speech Viewer. Then `pnpm fixture:capture` replaces the fixture's recorded run; review the transcript changes with `git diff`, and update the flag phrasing in `src/config/defaults.ts` if NVDA's wording changed.
5. For a temporary fix in Guidepup itself, use `pnpm patch @guidepup/guidepup` and `pnpm patch-commit` rather than forking it.

`npm install` of voicecap also fetches ffmpeg (about 30 MB): `@guidepup/setup` has an optional dependency for screen-recording its macOS setup, which voicecap never uses. If your network blocks the download, npm skips it and voicecap works the same.

Completing the AT Driver stub would mean installing the NVDA AT Automation add-on and server ([Prime-Access-Consulting/nvda-at-automation](https://github.com/Prime-Access-Consulting/nvda-at-automation), a WebSocket server on `ws://localhost:3031` by default), implementing `src/drivers/at-driver-nvda.ts` along its comments (browser work stays with Playwright), and running the same fixture checks.

## Known limitations

- **Timing.** Screen reader automation is timing-sensitive: a slow page or a busy machine can produce different output between runs. voicecap captures each keystroke's speech until a second of silence, which absorbs most of this, but compare runs with care.
- **Not a stock setup.** voicecap uses Guidepup's portable NVDA build with its own settings, and one browser (Chrome by default). Real users' NVDA versions, settings, and browsers differ.
- **English phrasing.** Stop detection and flags match NVDA's English wording; `voicecap doctor` warns when NVDA's language isn't English (NVDA follows the Windows display language).
- **The computer is voicecap's during a run.** NVDA's keystrokes go to the window in front. voicecap confirms its browser is in front for every page and checks it before and after every step, throwing away any step during which another window came forward, but that page is then recorded as failed. A window that comes forward in the moment before a keystroke (Guidepup silences NVDA first, which takes at least a quarter of a second) can still receive that one keystroke. Pop-up dialogs (Windows Update, chat apps) have the same effect.
- **Frames.** voicecap notices another window coming forward from the page's focus events. While focus is inside a frame (an embedded video, map, or form), a switch to another window is noticed only if it lasts until the end of the step.
- **One user at a time.** The lock that lets only one voicecap drive NVDA is per Windows user, but NVDA's connection (port 6837 on 127.0.0.1) is shared by the whole computer: don't run voicecap as two Windows users at once.
- **Shared computers.** While a page is open, its browser listens for remote debugging on 127.0.0.1 (with a throwaway profile), where other users of the same computer could connect. On a single-user desktop that doesn't matter.
- **Pages that talk nonstop.** Guidepup waits for NVDA to fall silent before each keystroke. On a page with content that announces itself continuously (a fast-updating live region, an auto-advancing carousel), a step can time out; voicecap then restarts NVDA and the browser, retries the page once, and records it as failed if it happens again.
- **Folders with spaces or special characters.** Guidepup 0.34.0 starts NVDA through the Windows command shell without quoting its path, so it can't start NVDA from a path with a space or one of `& ( , ; = ^`; see [Windows setup](#windows-setup-for-someone-new-to-windows).
- **Symbols.** Transcripts contain NVDA's spoken names for symbols (`copyright`, `bullet`), not the characters.
- **What automation can't judge.** A transcript shows what NVDA said, not whether it made sense: reading order that is technically right but confusing, alt text that is present but unhelpful, whether a page is usable. That still takes a person.

## Development

```bash
pnpm install
pnpm exec playwright install chromium   # for the report's accessibility test
pnpm test            # Vitest
pnpm lint            # ESLint + Prettier
pnpm typecheck
pnpm build
pnpm fixture:serve   # serve the test fixture at http://127.0.0.1:4747
pnpm test:nvda       # Windows: run voicecap with real NVDA on the fixture and check the results
pnpm fixture:capture # Windows: the same, then replace the fixture's recorded run with it
pnpm fixture:reviews # rebuild fixture/reviews.json from the recorded run
```

`fixture/` holds the test site (with a deliberately flawed page and a page that tests end-of-page detection), sitemaps, page lists (including CRLF and Windows-1252 CSVs), a sample `reviews.json`, a real Speech Viewer capture, an NVDA log excerpt, and a run recorded with real NVDA that the replay driver plays back; see `fixture/README.md`. CI runs lint, type checks, and tests on Ubuntu, macOS, and Windows (the tests use the replay driver and Playwright's Chromium; the real-NVDA checks run locally with `pnpm test:nvda`).

`docs/build-prompt.md` is the specification, `docs/plan.md` the approved plan, and `docs/phase-b-handoff.md` the notes for Phase B (the real NVDA driver). `WINDOWS-SETUP.md` is the checklist for setting up a new Windows machine for development.

### Publishing to npm

Always publish with `publish.sh`, from an up-to-date `main`. It's a bash script, so on Windows run it from Git Bash. Add the release to `CHANGELOG.md` first (move items from `[Unreleased]` under `## [x.y.z] - date`).

```bash
./publish.sh --dry-run        # every check, plus a dry-run publish; changes nothing (and doesn't log you in to npm)
./publish.sh                  # first publish: package.json's version; afterwards: next patch version
./publish.sh minor            # or patch, major, current, or an exact version like 1.2.3
./publish.sh minor 123456     # with an npm 2FA code (skips the confirmation prompt)
```

It stops before publishing unless:
- you're logged in to npm, the version isn't published yet, and `CHANGELOG.md` has an entry for it;
- CI passed for the commit (checked when the GitHub CLI is available);
- lint, typecheck, tests, and build pass;
- the package contains `dist/` and the docs (no source, tests, or fixtures);
- the packed tarball installs in a scratch project and `voicecap --version` prints the new version.

It restores `package.json` if anything fails before publishing. After publishing it commits the version bump, tags `vX.Y.Z`, and pushes.

## License

[MIT](LICENSE) © 2026 Illinois Criminal Justice Information Authority (ICJIA)
