# Changelog

All notable changes to voicecap are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and voicecap uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`voicecap demo`, a guided first run** against a small demo site that comes with voicecap and runs only on this computer. Seven steps, each explained and each waiting for Enter: the welcome, this computer's checks, the live test, an audit of the demo's seven pages (showing the command it runs), the transcripts, the report (with an offer to open it), and what to do next. Its files go in `voicecap-demo/` in the current folder. On a Mac, until the VoiceOver driver, it runs the checks and the VoiceOver live test, then says what the audit will do; a Windows PC runs the full tour.

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

[Unreleased]: https://github.com/ICJIA/voicecap/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/ICJIA/voicecap/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ICJIA/voicecap/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/ICJIA/voicecap/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/ICJIA/voicecap/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ICJIA/voicecap/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ICJIA/voicecap/releases/tag/v0.1.0
