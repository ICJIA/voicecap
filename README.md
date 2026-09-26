# voicecap

[![CI](https://github.com/cschweda/voicecap/actions/workflows/ci.yml/badge.svg)](https://github.com/cschweda/voicecap/actions/workflows/ci.yml)

voicecap drives the NVDA screen reader through a website's pages (from its sitemap or a page list you curate), saves what NVDA says as text transcripts you can skim and diff, and produces an accessible HTML report of automated coverage and human review.

It doesn't replace listening to a site with a screen reader. It makes that review faster and keeps an honest audit trail:

- **Transcripts** of everything NVDA says, one line per keystroke, that a person can skim much faster than listening to, and that can be diffed between runs to catch regressions.
- **An audit trail** of what was transcribed automatically, what a person reviewed (with a full, append-only history), and what was tested by hand with NVDA.

> **Status: Phase A.** Everything except the real NVDA driver works today on Windows, macOS, and Linux, using the **replay driver** (which plays back a recorded run). The Guidepup NVDA driver, `voicecap setup`, and `voicecap doctor` arrive in **Phase B**, on Windows. Until then, running with the default driver prints a message saying so. Run times in this README are estimates until Phase B measures them.

## Contents

- [Quick start](#quick-start)
- [Windows setup (for someone new to Windows)](#windows-setup-for-someone-new-to-windows)
- [Commands and options](#commands-and-options)
- [Page sources](#page-sources)
- [What voicecap does on each page](#what-voicecap-does-on-each-page)
- [The transcripts folder](#the-transcripts-folder)
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

voicecap needs **Node.js 22.12 or later**. You run it with `npx`; pnpm is only needed to develop voicecap itself.

**Try it on any OS** with the replay driver and the test fixture in this repository:

```bash
git clone https://github.com/cschweda/voicecap.git && cd voicecap
pnpm install && pnpm build
node dist/cli.js --site http://127.0.0.1:4747 --pages fixture/pages.json --replay-from fixture/replay-run
# then open transcripts/report.html
```

**Before voicecap is published to npm**, run it from a clone instead of `npx`: after `pnpm build`, use `node /path/to/voicecap/dist/cli.js` wherever this README says `npx @icjia/voicecap` (or run `pnpm link --global` in the clone to get a `voicecap` command).

**On a real site, with NVDA (Windows, Phase B):**

```bash
npx @icjia/voicecap setup      # once: install the NVDA build voicecap's Guidepup expects
npx @icjia/voicecap doctor     # check the environment
npx @icjia/voicecap --site https://example.illinois.gov --pages ./pages.csv
```

## Windows setup (for someone new to Windows)

These steps assume Windows 11, a normal (non-administrator) account, and Git Bash inside Windows Terminal.

1. **Install Git and Node.js** with winget from a Windows Terminal (PowerShell) window:

   ```powershell
   winget install --id Git.Git -e
   winget install --id OpenJS.NodeJS.LTS -e
   ```

   Node's installer is machine-wide and usually needs administrator rights once, so on a managed PC you may need IT to run it (Git may prompt too). Close and reopen Windows Terminal afterwards so both are on your PATH.

2. **Open Git Bash** in Windows Terminal: the tab drop-down (the `˅` next to the `+`) lists "Git Bash" once Git is installed. You can make it the default profile in Windows Terminal's settings. Check with `node --version` (22.12 or later) and `git --version`.

3. **Only if you'll develop voicecap:** install pnpm with `corepack enable pnpm` (or `npm install -g pnpm`). Running voicecap needs only Node and `npx`.

4. **Install NVDA for voicecap:** `npx @icjia/voicecap setup` *(Phase B)*. This downloads the portable NVDA build that voicecap's pinned Guidepup version expects into `%LOCALAPPDATA%\guidepup`. It's separate from any NVDA you already have installed.

5. **Check everything:** `npx @icjia/voicecap doctor` *(Phase B)*. It confirms the NVDA build, that no other NVDA is running, that NVDA starts and its speech can be captured, and that the browser launches and comes to the front. It prints a summary you can paste into a bug report.

6. **Before a run:**
   - **Close your own copy of NVDA.** voicecap shuts down any running NVDA when it starts (Guidepup does this), and it warns you first.
   - **Keep the desktop awake and unlocked.** Keystrokes go to whichever window is in front, so a locked screen, a screen saver, or a minimized Remote Desktop window (Windows stops drawing it) breaks a run. In Settings → System → Power & battery → Screen and sleep, set both to "Never" while plugged in.
   - **Turn on Do Not Disturb** (Settings → System → Notifications) so notifications don't get read into transcripts.
   - **Pause Windows Update** restarts during long runs (Settings → Windows Update → Pause updates). If a restart happens anyway, voicecap resumes where it stopped.

### Git Bash and paths that start with "/"

Git Bash rewrites command-line arguments that start with `/` into Windows paths, so `--page /about` reaches voicecap as `C:/Program Files/Git/about`. voicecap detects this and stops with an explanation. Three ways around it:

- use full URLs: `--page https://example.illinois.gov/about` (always works);
- leave off the leading slash in patterns: `--include 'news/*'` (patterns match with or without it);
- turn the rewriting off for one command: `MSYS_NO_PATHCONV=1 npx @icjia/voicecap review --page /about ...`.

## Commands and options

### Run an audit

```bash
npx @icjia/voicecap --site <url> (--sitemap <url> | --pages <file>) [options]
```

`--site` is required, plus exactly one page source; giving both or neither is an error.

| Option | Meaning |
| --- | --- |
| `--site <url>` | The site. Pages must be on its origin. |
| `--sitemap <url>` | Take pages from a sitemap: a `<urlset>` or a `<sitemapindex>` (child sitemaps are read too; gzip is fine). |
| `--pages <file>` | Take pages from a page list: `.csv` or `.json` (see [Page sources](#page-sources)). |
| `--limit <n>` | Transcribe at most n pages (after include and exclude). |
| `--include <pattern>` | Only URL paths matching. Glob by default; `re:` for a regular expression. Repeatable. |
| `--exclude <pattern>` | Skip URL paths matching. Same syntax. Repeatable. |
| `--passes <list>` | Which passes to run: any of `read,headings,tab` (default: all three). |
| `--max-steps <n>` | Override every pass's step cap. |
| `--compare <run-id\|previous>` | Compare with an earlier run in the report. `previous` is the most recent earlier completed run with the same page source. |
| `--fresh` | Start a new run even if an interrupted run with the same settings could be resumed. |
| `--out <dir>` | Output folder (default `./transcripts`). |
| `--run-name <name>` | Add a name to the run's folder, e.g. `2026-09-26_1405_exhaustive`. |
| `--replay-from <dir>` | Use the replay driver: play back a run folder instead of running NVDA. |

**Patterns.** Globs match the URL's path: `news/*` matches `/news/fy27-grants` but not `/news/` itself; `news/**` matches both, and deeper paths. The leading slash is optional in both the pattern and the path. `re:` patterns are regular expressions tested against the path plus the query string (with and without the leading slash), e.g. `--exclude 're:\?page=\d+'`. `--include`, then `--exclude`, then `--limit` apply, in that order.

### Other commands

```bash
voicecap list-urls --site <url> --sitemap <url> [--sample N] [--include p] [--exclude p] [--limit n] <output.csv|output.json>
voicecap review --page <url> --status <unreviewed|reviewed|issue|fixed> [--note "..."] [--reviewer <name>] [--run <run-id>] [--out <dir>]
voicecap manual add <file> --page <url> [--from <time>] [--to <time>] [--date <YYYY-MM-DD>] [--redact-typing] [--keep-raw] [--no-raw] [--reviewer <name>] [--out <dir>]
voicecap report [--run <run-id>] [--compare <run-id|previous>] [--out <dir>]
voicecap setup     # Windows (Phase B)
voicecap doctor    # Windows (Phase B)
```

Wherever a command takes a page, give a full URL or a root-relative path (`/about`). Paths resolve against the site of the latest run.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The run (or command) completed. Heuristic flags never change this. |
| 1 | Invalid usage or config (including an unreadable page source). |
| 2 | The environment is unusable, e.g. NVDA won't start, or several pages in a row failed. |
| 3 | The run completed, but some pages failed. |
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
https://example.illinois.gov/news/2026-09-01-announcement,,news,
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

### How the list is cleaned up

For both sources:

- **Duplicates.** Fragments (`#section`) are dropped, and `/about` and `/about/` count as the same page (the form listed first is the one loaded). Different query strings are different pages.
- **Other origins are skipped** and logged. If most URLs are on another origin, voicecap says so prominently: sitemaps that list `http://` or `www.` variants of the site are a common misconfiguration.
- **Non-HTML resources are skipped**: by extension up front (PDF, DOCX, images, and so on), and any page whose response turns out not to be HTML.
- **Redirects** are followed and the final URL recorded. A redirect to another origin is recorded as skipped.

### Export, prune, rerun

To curate a list from a big sitemap:

```bash
voicecap list-urls --site https://example.illinois.gov --sitemap https://example.illinois.gov/sitemap.xml pages.csv
```

This writes `url` plus empty `label`, `template`, and `notes` columns, with the same filtering a run uses. Open it in a spreadsheet, delete rows, fill in labels and templates, save as CSV UTF-8, and run with `--pages pages.csv`.

### Drafting a sample

```bash
voicecap list-urls --site https://example.illinois.gov --sitemap https://example.illinois.gov/sitemap.xml --sample 10 pages.csv
```

With `--sample N`, voicecap drafts a sample for you to curate: N pages per URL path pattern, with the pattern in the `template` column. The pattern is the page's parent path plus `/*` (`/news/*`, `/researchhub/articles/*`); top-level pages share `/*` and the home page is its own group. Pages are picked evenly spaced through each group, and voicecap prints what it chose and why. A run never samples on its own: the page list decides.

## What voicecap does on each page

For each page, voicecap runs up to three **passes** in a real browser with NVDA running. Before each pass it loads the page fresh, waits until it's ready (network idle, plus an optional `readySelector` and settle delay for sites like Nuxt that keep rendering after load), makes sure the browser window is in front (keystrokes go to whichever window is in front; if it can't be brought forward, the page is recorded as an error rather than transcribing the wrong window), and moves NVDA into the page.

voicecap captures **everything** NVDA says after each keystroke. That costs about a second per step, which is the right trade for an audit trail.

### read

Walks the page line by line in browse mode (Down Arrow) to the end. NVDA has no end-of-document announcement: on the last line, Down Arrow simply says the last line again. So voicecap:

1. jumps to the bottom (Ctrl+End) and records the last line;
2. returns to the top (Ctrl+Home) and reads down;
3. stops when that line is spoken and the next step repeats it, then presses Down once more to confirm (`read.endConfirmations`).

Two identical lines in a row mid-page, such as back-to-back "Read more" links, don't stop it, and neither does a last line that also appears earlier. When NVDA moves onto the last line it also announces containers it enters (like "content info landmark"), but it leaves them out when it repeats the line; voicecap matches the repeat against the end of what Ctrl+End said, so this doesn't matter. The pass also stops if the same speech repeats `repeatLimit` times in a row (a safety net) or at the step cap (default 400), and records which condition stopped it.

### headings

From the top, moves heading to heading (H) until NVDA says "no next heading".

### tab

Starts with nothing focused and presses Tab, recording what NVDA says at each focus stop and the focused element as the browser sees it: tag, role, accessible name, link target, and whether it's inside the main landmark. It stops when focus leaves the page for the browser's own interface (detected by the browser, not from speech), at the repeat safety net (a one-element focus trap), or at the step cap. If the page had already focused something before the first Tab, the pass records a warning.

### Progress

voicecap prints one line per page with an estimate of the time left:

```
[27/100] /grants/fy27-jag — read: 212 steps (end reached), headings: 9, tab: 34 — 5m 48s — about 7h 10m left
```

## The transcripts folder

Everything goes in `transcripts/` in the current folder (`--out` changes this):

```
transcripts/
  report.html              ← live report: latest completed run plus current reviews and manual sessions
  latest.txt               ← id of the most recently completed run
  reviews.json             ← append-only review history, by page; persists across runs
  .gitattributes           ← keeps Git from changing line endings (see below)
  runs/
    2026-09-26_1405/       ← one folder per run: local date and time, plus --run-name if given
      run.json             ← run metadata, environment, transcript hashes, and resume state
      report.html          ← snapshot of the report when the run completed
      pages/<page-slug>/
        read.txt  read.json  headings.txt  headings.json  tab.txt  tab.json
      compare/<base-run>/  ← diffs, when the run used --compare
  manual/<page-slug>/      ← manual NVDA sessions
  compare/<base>__<run>/   ← diffs made by `voicecap report --compare`
```

- **Runs never overwrite each other**, and a run folder is never modified after the run completes. Two runs started in the same minute get `-2`, `-3`, and so on.
- **Page slugs** are a readable part of the path plus a short hash of the URL (`grants-fy27-jag-1a2b3c4d5e`), safe on Windows and short enough to avoid path-length problems. The home page is `home`. The full URL is inside every JSON file.
- **TXT transcripts** start with a header block (every line begins `# `): the page, the run, the stop reason, and the full environment record, so each file stands alone as evidence. After one blank line comes **one line per step**, everything NVDA said in response to one keystroke. Setup steps are labeled (`[to bottom] …`, `[to top] …`), and a step where NVDA said nothing is written `[no speech]`, so line N of the body is always step N.
- **JSON transcripts** hold one record per step (number, command, spoken text, duration, time since the pass started, and for the tab pass the focus state and focused element) plus the page, pass, step count, stop reason, duration, timestamp, errors, warnings, and the environment record.
- **Environment record.** `run.json` records, and every transcript repeats: page source (sitemap URL, or page list file with its SHA-256), driver and version, NVDA version (and Guidepup's build id), NVDA language, capture mode, browser and version, OS, voicecap version, a hash of the effective config, run timestamp, and NVDA's speech, document formatting, browse mode, and keyboard settings.
- **Hashes.** `run.json` records the SHA-256 of every transcript file (integrity) and of each pass's TXT body without the header (content). "Changed since review" and `--compare` use the content hashes, because headers include timestamps and run ids.

### Committing transcripts to Git

Committing `transcripts/` preserves the audit trail alongside the site's code; not committing it keeps the repository small (an exhaustive run writes six files per page). If you commit it, keep the `.gitattributes` voicecap writes (`* -text`): without it, Git on Windows may convert line endings on checkout and the recorded hashes would no longer match the files.

> **Never commit an unredacted raw NVDA log.** At Input/output level NVDA logs every keystroke, including passwords typed into forms. See [Manual NVDA sessions](#manual-nvda-sessions).

## Long runs, interruptions, and resuming

A curated run of about 100 pages takes roughly 10 hours, and an exhaustive run over a 2,000-page sitemap more than a week (estimates: about 1.3–1.6 s per step, roughly 6 minutes for a page with 250 steps across the three passes; Phase B replaces these with measurements). Interruptions are normal: reboots, Windows Update, power cuts.

- **Resuming.** At the start of a run voicecap stores the page list and a hash of the settings that matter (site, page source, passes, filters, limit, driver, capture mode, step caps, NVDA settings, browser). `run.json` is rewritten after every page (atomically: a temporary file is flushed to disk and renamed, with retries while Windows holds the file). Running the same command again resumes the most recent incomplete run with the same settings, skipping pages already done (failed pages are retried). Otherwise voicecap starts a new run and says why. `--fresh` always starts a new run.
- **Sitemap runs resume with the page list stored when they started**, so a sitemap that changed in the meantime (a new news item, say) doesn't block resuming. A page list file is identified by its contents, so editing it starts a new run.
- **A failing page never stops the run**: it's recorded, reported, and the run moves on. Steps and whole pages have timeouts; after a timeout voicecap restarts NVDA and the browser and retries the page once before recording it as failed. After `maxConsecutiveFailures` failed pages in a row (default 5), voicecap stops with exit code 2 instead of marking every remaining page failed; fix the problem and rerun to resume.
- **Restarts.** NVDA and the browser are restarted every `restartEvery` pages (default 50).
- **Ctrl+C** saves state, shuts down NVDA and the browser, and exits with code 130; the page in progress is redone on resume. Press Ctrl+C a second time to exit immediately.
- **One run per output folder** at a time (a lock file, taken over if the process that held it is gone).

## Reviews: the audit trail

```bash
voicecap review --page /grants/fy27-jag --status issue --note "Table headers not announced"
voicecap review --page /grants/fy27-jag --status fixed --note "Headers added in #412"
```

Each page has a full, append-only history in `transcripts/reviews.json`. Every entry records the status (`unreviewed`, `reviewed` with no issues, `issue` found, `fixed`), the reviewer, a timestamp, the note, the run reviewed (by default the latest run with transcripts for the page; `--run` picks another), and the SHA-256 hashes of that run's transcripts for the page. Entries are never edited or deleted: a correction is a new entry, and the latest entry is the page's current status. voicecap refuses to overwrite a `reviews.json` it can't read.

The reviewer name comes from `--reviewer`, then the `VOICECAP_REVIEWER` environment variable, then `git config user.name`, then `reviewer` in the config. voicecap won't record a review without one.

A page is **changed since review** when its transcripts in the run shown differ from the ones recorded with its latest review.

## Manual NVDA sessions

`voicecap manual add` imports a hands-on NVDA session for a page into `transcripts/manual/<page-slug>/`. voicecap recognizes two kinds of input.

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

Check the clean transcript before committing it, and never commit an unredacted raw log.

## Verifying transcript fidelity

To check that an automated transcript really is everything NVDA said, compare it with a Speech Viewer capture of the same page:

1. Open Speech Viewer, load the page, press Ctrl+Home, then Down Arrow until the end, and save the Speech Viewer text.
2. Compare it with `read.txt` (skip the header block and the `[to bottom]` line). Normalize the separators first: Speech Viewer separates items with two spaces and utterances with new lines, while transcripts separate items with ", " and put all the utterances of one keystroke on one line, joined with ". ".

`fixture/manual/speech-viewer.txt` is such a capture for the fixture's home page, and the fixture tests compare it with the replay transcript.

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
    title: "NVDA transcripts: example.illinois.gov",
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

const result = await runAudit({ site: "https://example.illinois.gov", pages: "pages.csv" });
console.log(result.runId, result.exitCode);

await addReview({ page: "/about", status: "reviewed", reviewer: "Pat Reviewer" });
await addManualSession({ file: "nvda.log", page: "/about", redactTyping: true });

const { config } = await loadConfig();
await generateReport({ outDir: "transcripts", config, logger: createConsoleLogger() });
```

`runAudit` accepts every CLI option, plus `signal` (an `AbortSignal` that interrupts the run like Ctrl+C), `logger`, `config`, and `driver` (any object implementing `ScreenReaderDriver`). The data formats (`RunJson`, `TranscriptJson`, `ReviewsFile`, `ManualSessionJson`) are exported as TypeScript types.

## Drivers

A driver owns both the screen reader and the browser, so the rest of voicecap never touches Guidepup or Playwright. The `ScreenReaderDriver` interface (`src/drivers/types.ts`) is expressed in actions (open a page, next line, next heading, next focusable, to top, to bottom, focus checks); voicecap's core decides when a pass stops from what the driver returns, so replay exercises the same stop logic as a real run.

- **`guidepup`** (default, Phase B): NVDA through [Guidepup](https://github.com/guidepup/guidepup) with Playwright as a library. Windows only.
- **`replay`**: no screen reader or browser. It plays back a run folder (`--replay-from`), matched by URL: each pass's recorded steps in order, then NVDA's end behavior (the last line repeats, "no next heading", focus leaves the page). Replayed output is labeled as such in every transcript and report.
- **`at-driver`**: a stub for the W3C [AT Driver](https://w3c.github.io/at-driver/) protocol. Every method throws "not implemented"; the comments show how each maps to AT Driver messages.

## Updating Guidepup

Guidepup changes its API across versions and releases often, so voicecap pins `@guidepup/guidepup` and `@guidepup/setup` exactly and upgrades them together:

1. `pnpm add -E @guidepup/guidepup@<version> @guidepup/setup@<version>`.
2. Re-check the driver (`src/drivers/guidepup-nvda.ts`) against the new versions' source: method names, capture behavior, signal handling.
3. Re-run `voicecap setup`: a new Guidepup can pin a new NVDA build (it reads `manifest.json` from the installed `@guidepup/guidepup`).
4. Re-run the fixture checks on Windows and compare with the previous transcripts (`--compare`).
5. For a temporary fix in Guidepup itself, use `pnpm patch @guidepup/guidepup` and `pnpm patch-commit` rather than forking it.

Completing the AT Driver stub would mean installing the NVDA AT Automation add-on and server ([Prime-Access-Consulting/nvda-at-automation](https://github.com/Prime-Access-Consulting/nvda-at-automation), a WebSocket server on `ws://localhost:3031` by default), implementing `src/drivers/at-driver-nvda.ts` along its comments (browser work stays with Playwright), and running the same fixture checks.

## Known limitations

- **Timing.** Screen reader automation is timing-sensitive: a slow page or a busy machine can produce different output between runs. voicecap captures each keystroke's speech until a second of silence, which absorbs most of this, but compare runs with care.
- **Not a stock setup.** voicecap uses Guidepup's portable NVDA build with its own settings, and one browser (Chrome by default). Real users' NVDA versions, settings, and browsers differ.
- **English phrasing.** Stop detection and flags match NVDA's English wording.
- **Run times** are estimates until Phase B measures them (see [Long runs](#long-runs-interruptions-and-resuming)).
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
pnpm fixture:replay  # regenerate fixture/replay-run from fixture/replay-src
```

`fixture/` holds the test site (with a deliberately flawed page and a page that tests end-of-page detection), sitemaps, page lists (including CRLF and Windows-1252 CSVs), a sample `reviews.json`, a Speech Viewer capture, an NVDA log excerpt, and a hand-written replay run; see `fixture/README.md`. CI runs lint, type checks, and tests on Ubuntu, macOS, and Windows.

`docs/build-prompt.md` is the specification, `docs/plan.md` the approved plan, and `docs/phase-b-handoff.md` explains how to continue with Phase B on Windows.

## License

[MIT](LICENSE) © 2026 Christopher Schweda
