# Changelog

All notable changes to voicecap are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and voicecap uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/ICJIA/voicecap/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ICJIA/voicecap/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ICJIA/voicecap/releases/tag/v0.1.0
