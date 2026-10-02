# Changelog

All notable changes to voicecap are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and voicecap uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-10-02

The shareable page, and a way to check a computer first: `share/current.html` in every site's folder, what each run now records for it (every failed attempt, the computer, and whether the person heard NVDA speaking), and `voicecap preflight`.

### Added

- **Each page's title**, as the browser reports it, in the page's record in `run.json` (`title`). A page with no title, or one that was tried but never loaded, has none (`null`), and so does every page of a replayed run.
- **Every failed attempt at a page, with its cause.** A page's record (`failedAttempts`) lists every attempt that failed, in every session of the run, including those a later attempt made good. Each is written to `run.json` as it happens, before the screen reader and browser are started again, so Ctrl+C, a closed window, a crash, or a restart that fails doesn't lose it.
  - Each keeps its number, counted across the sessions; when it started and ended (local time, to the millisecond); the pass, the step, and the command it sent (`nextLine`, say, or `openPage` for a page that didn't open); the error's message; and whether the screen reader and browser were started again for the next attempt.
  - Each keeps why it failed, as a code: `foreground`, `locked`, `screen-reader-stopped`, `browser`, `http`, `unreachable`, `open-timeout`, `step-timeout`, `page-timeout`, or `unexpected` (the README's "What each run records" says what each means). A browser window closed mid-page, a browser that crashes, a page that crashes once it has opened, and a browser that isn't installed are the browser's (`browser`). A page that crashes during navigation can still be recorded as `unreachable`: the browser reports the failed navigation (`net::ERR_ABORTED`) before it reports the crash. A configured `readySelector` that never appears is a page that didn't open in time (`open-timeout`).
  - An unexpected error, which may be a fault in voicecap itself, also keeps its stack, with the home folder replaced by `%USERPROFILE%` (or `~`).
- **Whether NVDA was heard.** When a session that read pages ends, voicecap asks at the terminal, once NVDA has stopped: "Did you hear NVDA speaking as it read these pages?" It says, with the question, that NVDA speaks very fast during a run, so the words are hard to follow, and that the transcripts have every word. The answers are "Yes, the whole time", "Part of the time", and "No", typed as 1, 2, or 3; Enter picks No. The session's record in `run.json` keeps the answer (`listener`), with when voicecap asked and when it was answered, beside the reviewer recorded since 0.5.0 and the session's page count (`pagesDone`). The session's end is written before the question, and the run's seal covers the answer.
  - It's asked however the session ends: when the run completes; after Ctrl+C; when the run stops after too many failed pages in a row; and when an error ends it, after a line that says why (the full explanation follows the answer).
  - Only an answer typed after the question appears counts: keys pressed during the run are dropped before it shows.
  - Ctrl+C at the question, or closing the window, gives no answer; the record then has no statement.
  - It isn't asked without a terminal (a script, or CI), or when the output is redirected to a file; in Git Bash's own window (mintty), which doesn't always let Node see a terminal (run voicecap in PowerShell or Windows Terminal to be asked); for a replay; or for a session that read no pages. `voicecap demo` doesn't ask.
- **The computer's details**, in each session's environment record (`machine`), and never the computer's maker, model, or name, or the account's name:
  - the operating system: edition, version, build with its update revision, and architecture;
  - the processor: name, base speed, physical cores, and logical processors;
  - memory, and the display: resolution and refresh rate, and on Windows its scaling;
  - the browser window's fixed size: 1280 × 960 (none for a replay);
  - the time zone and its offset, and the display language;
  - the versions of Node.js, voicecap, Guidepup, and Playwright.
- **Programmatic API**: `runAudit` takes `askListener`, a function called when a session that read pages ends, however it ends (never for a replay), and given `{ screenReader, pagesRead }`. It asks whether the person heard the screen reader speaking, and resolves to `"all"`, `"part"`, or `"no"`, or to `null` for no answer. Without it, nothing is asked.
- **The shareable page, `share/current.html`**, in every site's folder: one file to send to a manager or an auditor, with the site's standing from its sealed runs, the person's review, every problem with its record, and a fingerprint check that works offline. The README's "The shareable page" describes it.
  - **When it's written:** whenever the site's `report.html` is, so when a run completes, and after `voicecap review`, `voicecap manual add`, and `voicecap report`. `voicecap report` now also prints `Shareable page: <path>` after the report's path. In the programmatic API, `generateReport` writes it too, and so do `addReview` and `addManualSession`, unless `regenerateReport` is `false`. A page that can't be made or written is a warning, never a failed run, review, or report.
  - **One self-contained file:** its styles, fonts, and data are inside it, and nothing is loaded from outside. The fonts are IBM Plex Sans, Sans Condensed, and Mono, under the SIL Open Font License, whose text ships with voicecap. The page is dark by default, with a light version, and prints light. Its details are folded behind lines that say what's inside; "Open every section", and printing, open them all.
  - **What's in it, in order:** the summary, which leads with the person's review (that they heard NVDA speaking, what they found, and what they fixed, only as far as the records say so) and says what voicecap does and what the person running it does; how voicecap works; every page; what the flags found; what changed since the run before; problems during the runs; what the results cover; the evidence; how voicecap came to be; and every transcript, word for word.
  - **Only completed, sealed, live runs count.** A replayed run, an interrupted or unfinished run, a completed run with no seal, and a run whose `run.json` can't be read are left out of every result, and the page lists each with why. With no run that counts, the page says so.
  - **The pages in scope** are those of the latest run that counts whose pages came from a sitemap or a page list. A later run given its pages with `--page` is a spot check: its transcripts and failures are each page's newest, but it doesn't change which pages are in scope. A page whose latest attempt failed is said beside its last good transcripts, and is a task.
  - **Every problem during the runs:** every failed attempt in the runs the page draws on, including those a later attempt made good. Each has its kind (another window took the screen, the computer locked, NVDA stopped, the browser stopped, the website answered with an error or couldn't be reached, a step took too long, or an unexpected error, which may be a fault in voicecap itself), and what it means for the results. Whether it happened again is judged by what came after it: a run before it that read the page shows only that the page could be read. The record of each is shown word for word, with the home folder replaced by `%USERPROFILE%` (or `~`).
  - **What changed since the run before:** the pages that sound different, line by line, with the changed words marked. Pages that sound the same are counted, not listed.
  - **"Check the fingerprints"** checks, with no network, every transcript the page shows against the fingerprint in its run's sealed record, each run's seal, and each review's seal and the review chain, and that the text each transcript shows is the file the page carries. "Show a change being caught" does the same on a copy with one character changed, in memory only. The page says what the check proves and what it can't, and names the two stronger checks: the file's own fingerprint, and `voicecap verify` on the originals.
  - **"Not recorded":** where a run didn't record something the page shows, the page says so, and says why (usually, which voicecap made the run), and never leaves a blank.
  - `voicecap verify` leaves the `share/` folder alone: the page is made again from the records each time, and `verify` checks the records themselves.
  - The transcripts home's `.gitignore` keeps `share/current.*` out of Git, since it's written again after every run and review. voicecap never rewrites a `.gitignore` it wrote before, so add `**/share/current.*` to an older home's by hand.
- **`report.siteName`**, a new setting: the site's name, as the shareable page's headline. It names every site the config is used with, so use a config per site for different names. Without it, the headline is the home page's title as the latest run recorded it, then the site's host name.
- **`voicecap preflight`**: checks this computer and says how to fix anything that isn't ready, without starting the screen reader.

### Changed

- **A page's `attempts` counts each attempt as it ends,** across sessions, those before a Ctrl+C included. An attempt that Ctrl+C stopped midway still isn't counted.
- **The README starts with a Quick start in three steps:** check the computer with `voicecap preflight`, fix what it lists, then `voicecap init`. It says why voicecap is an npm package, why PowerShell is preferred to Git Bash on a PC, and why it's a command-line app. Its long reference sections are folded, each behind a line that says what's inside. It ends with Credits: a hat tip to Guidepup, where voicecap began, and to NVDA, Playwright, and IBM Plex.
- **The README's Windows setup is written for PowerShell,** Windows Terminal's default. It says what to do when a new PC's PowerShell refuses to run `npx` ("running scripts is disabled on this system"). Git Bash still works: "Git Bash and paths that start with "/"" is its note.
- **The fix for a Windows user folder that NVDA can't start from** (a space, or one of `& ( , ; = ^`, in its path) gives each command a step of its own. The commands are written the same for PowerShell and Git Bash, so each can be pasted as it is.

## [0.5.0] - 2026-09-30

A guided demo, and what the checks on a real Windows PC found: `voicecap demo`, a failed page tried up to 5 times, the reviewer's name on every run, and four fixes.

### Added

- **`voicecap demo`, a guided first run** against a small demo site that comes with voicecap and runs only on this computer. Seven steps, each explained and each waiting for Enter: the welcome, this computer's checks, the live test, an audit of the demo's seven pages (showing the command it runs), the transcripts, the report (with an offer to open it), and what to do next. Its files go in `voicecap-demo/` in the current folder. On a Mac, until the VoiceOver driver, it runs the checks and the VoiceOver live test, then says what the audit will do; a Windows PC runs the full tour.
- **Runs record who ran them.** A run takes `--reviewer <name>`, and each session's record in `run.json` names who ran it and where the name came from, sealed with the run, so a run someone else resumes names both. Without `--reviewer`, the name comes from `VOICECAP_REVIEWER`, then `git config user.name`, then the config's `reviewer`, as for `voicecap review`. With none, the run goes ahead, says so, and records that no name was given. The report's table of sessions shows who ran each.
- **`voicecap init` asks for the reviewer,** after the transcripts home. Enter takes `icjia`, a quick default, or `VOICECAP_REVIEWER` when it's set; a person's name can be typed instead. The command it composes ends with `--reviewer <name>`, easy to change for someone else.
- **Programmatic API**: three options on `runAudit`. `preflight` takes the checks' result from a caller that has just run them, so a real run doesn't check again. `again` names the command that starts over, which an interrupted or stopped run then gives in place of "run the same command again to resume". `voicecap demo` uses both. `reviewer` is the name each session records, as `--reviewer` gives it.

### Changed

- **A page that fails is tried again, up to 5 times in all,** each time with NVDA and the browser started fresh. The limit is the new setting `pageAttempts`.
  - It covers a timeout, NVDA or the browser not responding, and another window taking the foreground.
  - Before, only a timeout or a server error got one retry, and a page that lost the foreground failed at once.
  - Every attempt is kept under `attempts/`, and the page's record names each failed attempt's reason.
  - A page the site answers with an HTTP 4xx still gets one try.
- **The README** says the checks take about three seconds, as measured on a Windows PC, not two.
- **The README, the package description, and `voicecap --help`** present voicecap as what it is: a listen-through with a real screen reader, the other half beside automated checkers such as axe and Lighthouse. What it does on its own is press the screen reader's keys and move from page to page.
- **The README has a new section, How voicecap works:** six steps, a diagram, and the first lines NVDA said on the demo site. It presents voicecap as a human review, sped up: voicecap presses the keys and turns the pages, and the person running it listens, reads the transcripts, and fixes what they find. Working from the list, voicecap accounts for every page on it, with none missed or done twice.
- **The README says when to run voicecap,** with a diagram: on the deployed site before it goes live, and again after a major update, not on every build during development.

### Fixed

- **voicecap turns an installed NVDA back on.** An installed NVDA runs with UI Access, at a higher integrity level than voicecap, and the way voicecap asked Windows for its path (WMI's `ExecutablePath`) came back empty. So after a run or the live test, voicecap couldn't start it again, and said to start it by hand. voicecap now reads each `nvda.exe`'s path with `QueryFullProcessImageName`, which Windows allows. Found on Windows 11 with NVDA 2026.2.
- **The `unlabeled` flag no longer flags labeled form fields in the read pass.** In browse mode, NVDA reads a form field's label as separate text, on the field's line or the line before, so a read-pass line with only "edit" can belong to a labeled field: the demo's labeled textarea was flagged. Form fields (edit, combo box, check box, radio button) now count only in the tab pass, where NVDA says the name first. The new setting `flags.unlabeled.tabOnlyRoles` lists them. `voicecap report` recomputes earlier runs' flags with the new rule.
- **Chrome that updates itself as voicecap starts it.** With an update waiting and no other Chrome open, the Chrome voicecap started handed over to a new copy of itself, which finished the update and went on with voicecap's profile. voicecap said "Chrome didn't start: it exited (0)" and left the profile behind. Now it closes that copy, says so, and starts Chrome again, once.
- **After a closed terminal window, your NVDA starts once Guidepup's has quit.** The helper that starts your NVDA as voicecap exits now waits, for up to 20 seconds, until Guidepup's NVDA has quit. Before, it could start yours while Guidepup's was still quitting.

## [0.4.1] - 2026-09-29

### Added

- **`--sitemap` takes a sitemap's name or path**, such as `--sitemap sitemap.xml`, `/sitemap.xml`, or `/sitemaps/pages.xml`, read on the site from its root, as `--page` paths are, in runs and `list-urls`. A full URL works as before. A run records the sitemap's full URL, so resuming with its name or its full URL finds the same run. An address given without `https://`, such as `--sitemap dvfr.illinois.gov/sitemap.xml`, is refused before anything is fetched, with the full URL to give instead. In Git Bash, a `--sitemap` that begins with `/` is caught and explained, suggesting the name without the slash.
- **`init` offers every sitemap a site has**: each one its `robots.txt` lists, then `/sitemap.xml`, each labeled with where it was found. A site with one sitemap sees the same menu as before. "A sitemap at another address" now asks for `Sitemap (a full URL, or a name like sitemap.xml)` and takes a name such as `sitemap.xml`; the command `init` composes still has the full URL.
- **Programmatic API**: `runAudit`'s and `listUrls`'s `sitemap` take a name or path, read on `site` from its root.

### Changed

- **The README** says plainly what works on Windows and on a Mac, has a walkthrough for each, and corrects examples that were wrong or would break when pasted into Git Bash or a Mac's terminal.

## [0.4.0] - 2026-09-29

### Added

- **A preflight check at the start of `init`**: before any question, it shows this computer's own details (hardware, screen reader, browser, and paths) and runs quick checks that decide whether NVDA (on Windows) or VoiceOver (on a Mac) is ready, in about two seconds. The checks only read, except on a Mac, where the Full Disk Access check creates and removes a small file, and the System Events check can raise macOS's prompt, which `init` warns about first. A computer that isn't ready stops there with exit code 2 and a numbered, plain-language diagnosis — what's wrong, and how to fix it — for each problem; a ready one, at a terminal, can try a 20-second live test before the wizard's usual questions.
- **`voicecap setup` and `voicecap doctor` on macOS**: `setup` installs Guidepup's own VoiceOver files and the browser, turns off VoiceOver's welcome screen and turns on VoiceOver's own AppleScript setting (saying how to undo each), then walks through any missing permission — VoiceOver Utility's AppleScript checkbox, Accessibility, Automation for System Events, and Full Disk Access — one at a time, opening System Settings at the right page and naming the terminal app that needs it. `doctor` checks the same things on either platform and always runs the live test, printing one report fit to paste into a bug report. Real VoiceOver runs still wait for the VoiceOver driver, coming in a later release.
- **The live test**: a 20-second check that starts NVDA or VoiceOver for real, brings the browser to the front, and confirms the screen reader can be heard, then puts everything back. It cleans up on Ctrl+C too, and when the terminal window is closed, it stops the test and cleans up as Ctrl+C does. `init` (at a terminal) offers it after a passing preflight, `setup` offers it at the end, and `doctor` always runs it, each with a hands-off warning first.
- **Restoring the person's own screen reader**: voicecap notes whether NVDA or VoiceOver is already running before it takes it over, and turns it back on afterwards with the person's own settings — after the live test on both platforms, and after every real NVDA run on Windows. If it can't, it says so and how to do it by hand.
- **Quick checks before a real run**: before NVDA starts, a run does the same checks `doctor` does (about two seconds). A computer that isn't ready exits 2 with the "Not ready" diagnosis before the site folder, the run lock, or NVDA are touched; a ready one gets one pass line plus any warnings.

### Changed

- **`init` now starts with the preflight** described above, before its usual questions.
- **`doctor`'s output now leads with this computer's own details, and gives each failing check a numbered, plain-language diagnosis with fix steps**, in place of the previous one-line-per-check summary.
- **`setup` on Windows now ends with the same preflight**, and exits 2 when the computer still isn't ready (it used to exit 0).

### Fixed

- **On a Mac, the browser voicecap starts no longer asks for the login keychain.** Chrome for Testing asked for its Safe Storage key as each new profile opened, macOS showed an approval dialog, and every page load waited for the answer. voicecap now starts the browser with `--use-mock-keychain`, as Playwright does on macOS.

## [0.3.1] - 2026-09-28

### Fixed

- **On Windows, a path written Git Bash's way (`/c/Users/me/…`) is read as that Windows path** by `--out`, `VOICECAP_TRANSCRIPTS`, `--pages`, `--replay-from`, `manual add`, and `list-urls`, as `init` already did. Git Bash translates these itself, but not with `MSYS_NO_PATHCONV=1` set (the fix voicecap suggests for `--page /about`), and voicecap then read `/c/Users/me` as `C:\c\Users\me`.

## [0.3.0] - 2026-09-28

The audit record: one transcripts home with a folder per site and per day, records that `voicecap verify` can check, `voicecap init` to set up a run, and `--page`.

### Added

- **`voicecap verify [--site <url>] [--out <dir>]`**: checks the records in the transcripts home against their seals and recorded hashes. A completed run's `run.json`, each manual session's `session.json`, and each review entry now carry a `seal` (a SHA-256 of the record itself); review entries also carry `seq` and `prev`, chaining the whole review history. `verify` checks every site's runs (their seals and every recorded page file), manual sessions (their seals, transcripts, and kept raw copies), and the review chain, printing one line per problem it finds and exiting 0 when everything matches, 3 when something doesn't. It catches an edited record, a reordered review entry, and a deleted entry that a later entry follows. Deleting the newest review entries, or a whole run or manual session, leaves nothing for `verify` to find: only Git history shows it.
- **Programmatic API**: `verifyHome`; `resolveHome`, `siteFolder`, `siteDirFor`, and `chooseSiteDir`, to find a site's folder in the transcripts home; `siteDir` and `runDir` on `runAudit`'s result; `site` on `addReview` and `addManualSession`; and `env` and `pageUrls` (`--page`'s values: full URLs or root-relative paths) on `runAudit`.
- **`voicecap init`**: answers a few plain questions (the website, where its pages are, how many, and the transcripts home) and prints the finished `npx @icjia/voicecap …` command, ready to copy, keep, and run again to resume. It offers to run the command right away on a computer that can (Windows, with voicecap's own NVDA installed). `voicecap` with no arguments starts `init` too, in a terminal; without one (scripts, CI, and sometimes Git Bash's own window), the "Missing --site" usage error stays, now pointing to `init`.
- **`--page <url>`**: a third, repeatable page source for a run, alongside `--sitemap` and `--pages`. Each value is a full URL or a root-relative path, resolved against `--site`, and goes through the same off-origin, non-HTML, and duplicate handling as the other sources; `--include`, `--exclude`, and `--limit` still apply. It's recorded in `run.json` and every transcript, and described consistently in the report, transcript headers, run comparison, and resume.

### Changed

- **The transcripts home now holds one folder per site**, each with its own dated run and manual-session folders (`<site>/<date>/<time>/`, `<site>/<date>/<time>_manual_<slug>/`), `reviews.json`, live report, and `compare/`, instead of one shared `runs/` and `manual/` folder. The home now comes from `--out`, else the `VOICECAP_TRANSCRIPTS` environment variable, else `./transcripts`.
- **`review`, `manual add`, and `report` take `--site <url>`** to pick the site's folder; without it, the site comes from a full `--page` URL, else the home's only site folder (a usage error names the folders when there are several and neither is given).
- **A retried or resumed page keeps its earlier attempt**, moved to `attempts/<slug>/<n>/` in the run's folder instead of being overwritten; reports and comparisons ignore it.
- **`.gitattributes` and a new `.gitignore`** are written at the home's top the first time they're needed, and never overwritten, so the owner's own edits stay. `.gitignore` keeps out manual sessions' raw NVDA logs (`**/*_manual_*/raw/`), which can hold typed passwords, along with the run lock (`.voicecap.lock`), the temporary files a crash can leave behind (`.*.tmp`), and the files an operating system adds to folders (`.DS_Store`, `Thumbs.db`, `desktop.ini`).
- **voicecap 0.2.0's `runs/` and `manual/` folders, if a home still has them, are no longer read or moved**; a run notes once that it saw them and left them alone.
- **`generateReport`'s `outDir` now means a site's folder** in the transcripts home, not the home itself, which breaks 0.2.0 callers: pass `runAudit`'s `siteDir`, or find one with `resolveHome` and `siteDirFor`.
- **`PageSource` has a third variant, `{ kind: "urls"; urls: string[] }`**, for a run's `--page` pages (their resolved URLs, in the order given), recorded in `run.json` and in each transcript's environment record. It's a compile-time change for TypeScript code that switches over `PageSource`'s `kind` exhaustively: add a case for `"urls"`.

## [0.2.0] - 2026-09-27

Phase B: the real NVDA driver, checked end to end with NVDA 2026.2 and Chrome 153 on Windows 11.

### Added

- **The Guidepup NVDA driver** (`driver: "guidepup"`, the default; Windows only): NVDA through `@guidepup/guidepup` 0.34.0, with the browser driven by Playwright.
  - Every page load gets a new browser with a new profile, so no page's transcript depends on the pages before it.
  - Keystrokes go to the browser, and another window's speech never ends up in a transcript. For every load, the driver brings the browser to the front and confirms it with NVDA+T, and every step checks that the page kept focus. A step during which another window came forward, even briefly, is discarded as a foreground error; a window that comes forward in the moment before a keystroke can still receive that one keystroke. Tabbing into and out of a frame (an embedded video, map, or form) isn't mistaken for another window.
  - The tab pass starts at the first focusable element: its first Tab goes to the browser directly. Through NVDA in browse mode, it would skip the element under NVDA's cursor, usually the skip link.
  - The environment record has Guidepup's NVDA build, the NVDA version, NVDA's language, the browser, the Windows version, and NVDA's speech-related settings (the values that differ from NVDA's defaults). If the browser updates itself during a run, the page being opened fails, and voicecap stops (exit code 2) when it restarts the browser for the next page, rather than record a version that's no longer true. Running the same command again resumes with the new version recorded (on the last page, the run completes with that page failed, exit code 3).
  - If NVDA dies during a run, or Guidepup loses its connection to it, the step fails instead of being recorded as silence, and voicecap restarts NVDA and the browser.
  - Only one voicecap drives NVDA at a time (per Windows user). voicecap warns before it shuts down an NVDA that's already running. It takes its lock before it shuts down NVDA and closes browsers that a crashed run left behind, so it never disturbs a voicecap that's running.
  - NVDA is stopped exactly once, by voicecap: Guidepup's own signal handlers are removed, and a hung Guidepup stop falls back to shutting NVDA down directly. A stop can come at any moment (Ctrl+C, a timeout): browsers still starting are killed, a start still under way is given a moment to finish and then shut down, NVDA is shut down before the browsers (so a key it was about to send can't reach the window that comes forward), and every browser launched is closed. NVDA and the browsers are also shut down when the process exits, including on a second Ctrl+C; after a hard kill, the next run cleans up.
  - Downloads are refused, so a link to a file doesn't put it in your Downloads folder.
  - While it runs, voicecap keeps Windows from sleeping or turning the screen off (and locking because of either), as video players do. On a locked computer (Win+L, a screen saver, a lock policy), NVDA can't press keys or speak; voicecap then says "Windows is locked" instead of blaming another window.
- **`voicecap setup`**: installs the NVDA build that voicecap's pinned Guidepup expects, with voicecap's own pinned `@guidepup/setup` 0.28.0. It installs Playwright's Chromium if that's the configured browser, or if the configured browser isn't installed. It explains the fix when the install folder's path has a space or another character the Windows command shell splits or changes it at (`& ( , ; = ^`, `%NAME%`): Guidepup can't start NVDA from such a path.
- **`voicecap doctor`**: checks Windows, Node.js, the NVDA build, other running NVDA copies and voicecaps, whether Windows is locked, the browser, speech capture, the foreground check, and NVDA's language, and prints a summary to paste into a bug report. Exits 2 if something voicecap needs doesn't work. Its live check has a run's timeouts, and Ctrl+C shuts NVDA and the browser down (exit code 130).
- **`pnpm test:nvda` and `pnpm fixture:capture`** (Windows, for development): run voicecap with real NVDA on the fixture site and check end-of-page detection (including the page with duplicate lines), "no next heading", the tab pass starting at the skip link, complete capture compared with NVDA's Speech Viewer, and tabbing into and out of a frame. `fixture:capture` then replaces the fixture's recorded run.

### Changed

- The fixture's replay run is now a real NVDA run, with a real Speech Viewer capture, in place of the hand-written one. `pnpm fixture:replay` and `fixture/replay-src/` are gone; `pnpm fixture:reviews` rebuilds the sample `reviews.json`.
- The flag phrasing was checked against real NVDA output; no rules needed changing. The fixture README records what NVDA 2026.2 actually says, including two differences from Phase A's source-based expectations: an image without alt text is read ("Unlabeled graphic"), and transcripts have NVDA's names for symbols (`copyright`, `bullet`).
- voicecap now needs Node.js 22.19 or later (`@guidepup/setup` requires it).
- `playwright` is now a dependency, and `@guidepup/guidepup` and `@guidepup/setup` are pinned exactly.
- The repository moved to [github.com/ICJIA/voicecap](https://github.com/ICJIA/voicecap), and the copyright holder is now the Illinois Criminal Justice Information Authority (ICJIA).

### Fixed

- `publish.sh --dry-run` no longer logs you in to npm: without a login it warns and carries on, so a dry run changes nothing. The whole dry run was checked in Git Bash on Windows.

## [0.1.0] - 2026-09-26

### Added

Phase A: everything except the real NVDA driver, working on Windows, macOS, and Linux with the replay driver.

- **Runs.**
  - `voicecap --site … --sitemap …|--pages …` with `--limit`, `--include`/`--exclude` (globs, or `re:` regular expressions; leading slash optional), `--passes`, `--max-steps`, `--compare`, `--fresh`, `--out`, `--run-name`, and `--replay-from`.
  - Exit codes 0, 1, 2, 3, and 130.
- **Page sources.**
  - Sitemaps (`<urlset>`, nested `<sitemapindex>`, gzip) and page lists (JSON, and CSV including CRLF, BOM, and Windows-1252 with a warning), with line numbers for bad entries.
  - URL normalization and deduplication; off-origin, non-HTML, and redirect handling.
- **`voicecap list-urls`**, to export a sitemap as a page list or draft a curated sample with `--sample N`.
- **Passes** with the stop logic in the core:
  - `read`: end of page detected from the repeated last line, with a confirmation step and container-context matching.
  - `headings`: stops on "no next heading".
  - `tab`: stops when focus leaves the page. It records the focused element (tag, role, name, link target, inside main) and warns about focus set on load.
  - Every pass has a repeat safety net and step caps.
- **Output.**
  - One immutable folder per run, with TXT and JSON transcripts. Each TXT is a header block with the full environment record, then one line per step.
  - Deterministic, Windows-safe page slugs.
  - SHA-256 of every file, plus content hashes of each transcript body.
  - `latest.txt`, and a `.gitattributes` that keeps Git from altering transcripts.
- **Reliability.**
  - Resumable runs: a settings hash, atomic `run.json` writes with Windows retries, and per-session environment records.
  - Per-step and per-page timeouts, with a driver restart and one retry.
  - Restarts every N pages, and a stop after too many consecutive failures.
  - Clean Ctrl+C handling and a run lock.
- **Reviews**: `voicecap review`, an append-only history per page in `reviews.json`, reviewer name resolution, and "changed since review".
- **Manual sessions**: `voicecap manual add` for Speech Viewer text and NVDA Input/output logs.
  - Timestamps, midnight crossings, `--from`/`--to`, and `--date`.
  - Raw copies with hashes (`--no-raw`); `--redact-typing` with raw copies withheld (`--keep-raw`); privacy warnings.
- **Report**: a self-contained, accessible HTML report with a summary, per-page table, filters (they work without JavaScript), review history, manual sessions, environment, and `--compare` with separate diff files and environment-difference warnings. There is a live report plus a snapshot per run, and `voicecap report` regenerates it.
- **Heuristic flags**, configurable, with custom phrase rules: generic link text, unlabeled items, read pass not finished, headings, tab with no stops, a long run before main content with no skip link, and repeated phrases.
- **Configuration** in `voicecap.config.ts`/`.mts`/`.js`/`.mjs`/`.json`, validated, with defaults and a recorded hash.
- **Drivers**: the replay driver, a W3C AT Driver stub, and the `ScreenReaderDriver` interface.
- **Programmatic API**: `runAudit`, `listUrls`, `addReview`, `addManualSession`, `generateReport`, `loadConfig`, `defineConfig`, and the data-format types.
- **Test fixture**: a static site with a flawed page and a duplicate-lines page, sitemaps, page lists, a sample review history, a Speech Viewer capture, an NVDA log excerpt, and a hand-written replay run with its generator.
- **Tests and CI**: a Vitest suite (including axe-core checks of the generated report) and GitHub Actions CI on Ubuntu, macOS, and Windows.
- **`publish.sh`**: publishes to npm only after every check passes, including installing and running the packed tarball.

### Not yet

- The Guidepup NVDA driver, `voicecap setup`, and `voicecap doctor` (Phase B, on Windows).

[Unreleased]: https://github.com/ICJIA/voicecap/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/ICJIA/voicecap/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/ICJIA/voicecap/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/ICJIA/voicecap/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ICJIA/voicecap/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/ICJIA/voicecap/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/ICJIA/voicecap/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ICJIA/voicecap/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ICJIA/voicecap/releases/tag/v0.1.0
