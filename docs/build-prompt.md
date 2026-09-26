You are a senior Node.js/TypeScript engineer with deep experience in web accessibility testing, Playwright, and screen reader automation. Build me a reusable, publishable npm package named **@icjia/voicecap** that drives NVDA through a website's pages (from its sitemap or a chosen list), saves what NVDA speaks as reviewable transcripts, and produces an auditable report of automated coverage and human review.

## Context

I'm a senior web developer at the Illinois Criminal Justice Information Authority (ICJIA), a state agency, and I manage 15+ agency websites. They already pass axe-core and pa11y at 100%. My manager wants NVDA screen reader testing. The current site has ~35 pages; the next has ~2,000.

The goal is NOT to replace human review. It is to:
1. Produce text transcripts of NVDA's output that a person can skim much faster than listening, and that can be diffed between runs to catch regressions.
2. Keep an honest audit trail of what was transcribed automatically, what a person reviewed, and what was manually tested with NVDA.

Because this is an audit trail, completeness beats speed: capture everything NVDA says, and keep every review decision rather than overwriting it.

Routine runs use a page list I curate: about 10 routes for each of a site's ~10 main templates, roughly 100 pages. An exhaustive run over a whole sitemap is an occasional job that can take days (see Known facts), so it must survive interruptions.

## Commands and options

Main run: `--site` plus exactly one page source (`--sitemap` and `--pages` are mutually exclusive; exit with a clear error if both or neither are given):

    npx @icjia/voicecap --site https://example.illinois.gov --sitemap https://example.illinois.gov/sitemap.xml
    npx @icjia/voicecap --site https://example.illinois.gov --pages ./pages.csv

Run options: `--limit N`, `--include` / `--exclude` (URL path patterns: glob by default, regex with a `re:` prefix), `--passes read,headings,tab`, `--max-steps N` (overrides every pass's step cap), `--compare <run-id|previous>`, `--fresh`, `--out <dir>` (default `./transcripts`), `--run-name <name>`, `--replay-from <dir>` (replay driver only).

Other commands:
- `voicecap list-urls --site <url> --sitemap <url> [--sample N] <output.csv|output.json>`: export a sitemap as a page list file, or draft a sample to curate (see Page sources).
- `voicecap review --page <url> --status <unreviewed|reviewed|issue|fixed> [--note "..."] [--reviewer <name>] [--run <run-id>]`: add an entry to a page's review history (see Audit trail).
- `voicecap manual add <file> --page <url> [--from <time>] [--to <time>] [--date <YYYY-MM-DD>] [--redact-typing] [--keep-raw] [--no-raw] [--reviewer <name>]`: import a manual NVDA session (see Manual sessions).
- `voicecap report [--run <run-id>] [--compare <run-id|previous>]`: regenerate the live report (see HTML report).
- `voicecap setup`: on Windows, install the NVDA build that voicecap's pinned Guidepup expects (see Known facts).
- `voicecap doctor`: check the environment and print a summary I can paste into a bug report: NVDA build installed, no other NVDA running, NVDA starts and its speech can be captured, and the browser launches and comes to the foreground.

Wherever a command takes a page, accept either a full URL or a root-relative path. Git Bash on Windows rewrites arguments beginning with `/` into Windows paths, so full URLs must always work; the README should explain this and mention `MSYS_NO_PATHCONV=1`. The same rewriting hits `--include` / `--exclude` patterns that begin with `/`, so match patterns with or without a leading slash. When an argument looks rewritten (it starts with the Git for Windows install path, such as `C:/Program Files/Git/`), exit with a message explaining the cause and the fix.

Exit codes: 0 when a run completes (flags never change this), 1 for invalid usage or config, 2 when the environment is unusable (e.g. NVDA won't start), 3 when a run completes but some pages failed, and 130 after Ctrl+C (state saved).

## Page sources

- **Sitemap (`--sitemap`):** handle both `<urlset>` and `<sitemapindex>` (recurse into child sitemaps).
- **Page list file (`--pages`):** for my curated samples (the routine case) or any chosen subset of a site. Detect format by extension:
  - **JSON:** an array of URL strings, or an array of objects with a required `url` and optional `label`, `template`, and `notes`.
  - **CSV:** a header row with a required `url` column and optional `label`, `template`, and `notes` columns. Use a well-maintained CSV parser that handles quoted fields, blank lines, a UTF-8 BOM, and CRLF line endings, as Excel on Windows produces. Excel's plain "CSV (Comma delimited)" format is Windows-1252, not UTF-8: if a file isn't valid UTF-8, decode it as Windows-1252 and print a warning recommending "CSV UTF-8".
  - Entries may be absolute URLs or root-relative paths, resolved against `--site`.
  - Report malformed or missing URLs with file line numbers and continue with the valid entries. A missing `url` column is a file-level error.
- **For both sources:**
  - Normalize URLs before deduplicating: drop fragments, treat `/about` and `/about/` as the same page (keep the form listed first), and keep query strings (different queries are different pages).
  - Skip (with a log entry) URLs not on the same origin as `--site`. If most URLs are skipped that way, say so prominently: sitemaps that list `http://` or `www.` variants are a common misconfiguration.
  - Skip non-HTML resources (PDF, DOCX, images, etc.) by extension up front, and any page whose response turns out not to be HTML.
  - Follow redirects and record the final URL; a redirect to another origin is recorded as skipped.
  - `--include`, `--exclude`, then `--limit` apply, in that order, after the list is built.
- **`list-urls`** applies the same filtering and writes `url` plus empty `label`, `template`, and `notes` columns, so I can export a large sitemap, prune and tag it in a spreadsheet, and feed it back with `--pages`. With `--sample N` it instead drafts a sample for me to curate: N pages per URL path pattern (e.g. /news/*, /grants/*), with the pattern filled in as the `template`. Print what it chose and why. A run never samples on its own; the page list decides.

## NVDA passes

For each page, run the passes below in a real browser via Playwright with NVDA running. Before each pass:
- load the page fresh;
- wait until it's ready: network idle, plus an optional per-site `readySelector` and settle delay from config (Nuxt sites keep rendering after the load event);
- confirm the browser window is in the foreground, since keystrokes go to whichever window is in front (NVDA+T reports the window title). If it can't be brought to the front, record a page error rather than transcribing the wrong window;
- move NVDA into the web content.

Capture everything NVDA says in response to each keystroke (Guidepup's `capture: true`; its default, `"initial"`, keeps only the first utterance). This costs about a second per step, which is the right trade for an audit trail.

- **read:** walk the page in browse mode line by line (Down Arrow; Guidepup's `next()`) until the end. NVDA has no end-of-document announcement: on the last line, Down Arrow re-speaks that line (see Known facts). So first jump to the bottom (Ctrl+End) and record the last line, then return to the top (Ctrl+Home) and read until that line is spoken and the next step repeats it. Also stop if any phrase repeats several times in a row (a safety net), or at a hard cap (default 400 steps). Record which condition stopped it. Two identical lines in a row mid-page, such as back-to-back "Read more" links, must not stop the pass.
- **headings:** from the top, move heading to heading (Guidepup's `nextHeading()`) until NVDA says "no next heading", recording each announcement.
- **tab:** start with nothing focused and the browser's sequential focus starting point at the top of the document, so the first Tab reaches the first focusable element (usually the skip link). Press Tab and record what NVDA announces at each focus stop, plus the focused element as Playwright sees it: tag, role, accessible name, and whether it's inside the main landmark. Stop when focus leaves the page document (Tab eventually reaches browser UI such as the address bar; detect this with Playwright, not from speech) or a cap is reached.

## Output folder layout

All output goes in `transcripts/` in the current working directory, created if missing (`--out` overrides):

    transcripts/
      report.html              ← live report: latest completed run plus current reviews and manual sessions
      latest.txt               ← id of the most recently completed run
      reviews.json             ← append-only review history, keyed by page URL; persists across runs
      runs/
        2026-09-26_1405/       ← one folder per run: local date and time, plus --run-name if given
          run.json             ← run metadata, environment, transcript hashes, and resume state
          report.html          ← snapshot of the report when the run completed
          pages/<page-slug>/
            read.txt  read.json  headings.txt  headings.json  tab.txt  tab.json
      manual/<page-slug>/      ← manual NVDA sessions (see Manual sessions)

- Runs never overwrite each other; earlier runs remain as evidence and for diffing. A run folder is never modified after the run completes. If a run folder name is taken (two runs in the same minute), append `-2`, `-3`, and so on.
- `latest.txt` is a plain file, not a symlink (symlinks are unreliable on Windows).
- Generate the top-level `report.html` with links correct for its own location; don't copy the run's report (its relative links would break).
- **TXT transcripts:** a short header block (see Audit trail), then one line per step (everything NVDA said in response to one keystroke), for skimming and diffing.
- **JSON transcripts:** one record per step (step number, command, spoken text, elapsed time, and for the tab pass the focused element) plus metadata: URL as listed and final URL, label/template/notes if provided, pass, step count, stop reason, duration, timestamp, and errors.
- Page slugs must be deterministic, safe on Windows (no reserved names like `CON` or `NUL`, no forbidden characters), short enough to avoid path-length problems, and unique: a readable part from the path plus a short hash of the normalized URL. Store the full URL in each JSON file so slugs never need to be reversible. The home page's slug is `home`.

## Audit trail

- **Environment record.** Store in `run.json`, and repeat as the header block of every TXT transcript so each file stands alone as evidence: page source (sitemap URL, or page list file name plus a SHA-256 hash of its contents), driver name and version, NVDA version (Guidepup reports its own build id, such as `0.2.1-2026.2`; record it and the NVDA version it contains), NVDA language, capture mode, browser name and version, OS version, voicecap version, a hash of the effective voicecap config, run timestamp, and the NVDA speech/verbosity settings in effect (Guidepup's `getSettings()` reads NVDA's config; record at least the speech, document formatting, browse mode, and keyboard settings).
- **Transcript integrity.** `run.json` records the SHA-256 of every transcript file the run writes.
- **Reviews.** A full, append-only history per page. Each entry records the status (unreviewed, reviewed with no issues, issue found, fixed), reviewer name, timestamp, notes, the run id reviewed (by default the latest run containing the page; `--run` overrides), and the SHA-256 hashes of that run's transcripts for the page. Entries are never edited or deleted; a correction is a new entry, and the latest entry is the page's current status. The reviewer name comes from `--reviewer`, then the `VOICECAP_REVIEWER` environment variable, then `git config user.name`, then the config default; refuse to record a review without one. Stored in `transcripts/reviews.json` via the `review` command and merged into the live report.

## Manual sessions

`voicecap manual add` imports a hands-on NVDA session into `transcripts/manual/<page-slug>/`.

- **Inputs, auto-detected:**
  - **Speech Viewer text:** copied from NVDA's Speech Viewer (NVDA menu → Tools → Speech Viewer). It has no timestamps and no keystrokes: each line is one utterance, with items inside an utterance separated by two spaces.
  - **NVDA log at Input/output level:** a copy of `nvda.log` or `nvda-old.log`. Extract, in order and with timestamps, the input gestures (`Input: ...` entries) and the speech NVDA produced (`Speaking [...]` entries, a Python repr of the speech sequence whose non-text command objects should be dropped), discarding all other log content. If the log has no input/output entries, say the logging level probably wasn't set to Input/output.
  - Log timestamps are time of day only, with no date. Take the session date from `--date`, defaulting to the file's modification date (print it so I can confirm), and handle sessions that cross midnight. `--from` / `--to` apply only to logs.
- **Saved per session**, named by session date and time so several sessions per page can coexist:
  - a clean `.txt` transcript (for logs: each keystroke followed by what NVDA said in response)
  - JSON with the entries (timestamp, type key or speech, text) and metadata: page URL, input format, session start and end (when known), NVDA version if present, import date, reviewer name
  - the unmodified original in a `raw/` subfolder, with its SHA-256 hash in the JSON, as evidence the clean transcript wasn't altered. Name the copy so it doesn't end in `.log` (e.g. `2026-09-26_1405.nvda-log.txt`): many repos ignore `*.log`, which would silently leave the evidence uncommitted. `--no-raw` skips the copy but keeps the hash.
- **Privacy:** Input/output logs record every keystroke, including text typed into form and password fields. Print a warning on import. `--redact-typing` replaces character keystrokes typed while focus is in an editable field, and NVDA's spoken echo of them, with `[typed text redacted]`; document the heuristic's limits honestly. With `--redact-typing`, don't keep the raw original, since it would defeat the redaction: record only its SHA-256 and a note that it was withheld for privacy. `--keep-raw` overrides this, with a warning. When an unredacted log contains keystrokes typed into editable fields, warn and suggest `--redact-typing`.
- A log may cover several pages: `--from` / `--to` import part of a log, and the same log can be imported against several pages.

## HTML report

A single self-contained file (inline CSS, no external assets) that is itself accessible: proper heading structure, landmarks, a data table with a caption and scoped headers, visible focus styles, sufficient contrast.

- **Summary:** page source (curated list or full sitemap), the driver and capture mode used, total pages, pages transcribed, pages reviewed, pages whose transcripts changed since their last review, pages manually tested, open issues, pages with errors, skipped URLs.
- **Per-page table:** page (label if provided, otherwise URL), template, run status, step counts and stop reasons per pass, heuristic flags, current review status with reviewer and date, number of review entries, a "changed since review" marker, manual-test indicator, and links to each transcript, manual session, and the page's review history.
- **Filters:** flagged/unflagged, review status, changed since review, manually tested, template. Use native, labeled form controls, announce the number of visible rows in a live region, and keep the table usable without JavaScript.
- **Compare:** with `--compare`, mark changed pages and link to text diffs in separate files (an exhaustive run can have thousands of pages). `previous` means the most recent earlier completed run with the same page source. Compare the pages both runs contain, and list pages present in only one. Diff transcript lines, not header blocks. If the two runs' environments differ (NVDA, browser, voicecap, NVDA settings, capture mode), say so prominently, because some changes may come from the tooling rather than the site.
- **Regeneration:** a run's own `report.html` is a snapshot taken when the run completes. The top-level `report.html` is the live view; `review`, `manual add`, and `voicecap report` regenerate it. `voicecap report --run <id>` can also render an incomplete run, clearly marked as such.

## Heuristic flags

Flag for human attention; never fail a page:
- Generic link text announced repeatedly ("click here", "read more", "learn more", "here", or "link" with no name)
- Unlabeled or poorly labeled items ("button" or "edit" with no accessible name, "graphic" with no description, "unlabeled")
- Read pass stopped at the hard cap instead of a natural end
- No headings, or a first heading that isn't level 1
- Tab pass with zero focus stops, or a long run of stops before main content (possible missing skip link), judged from the recorded focused elements rather than from speech
- The same phrase repeated many times consecutively (possible focus trap or duplicated content), ignoring the read pass's end-of-page repeat

The rules, including the NVDA phrasing they match, live in config. The phrasing assumes NVDA's English interface.

## Reliability at scale

- One page at a time; there is only one screen reader.
- **Resumable:** at the start of a run, store the resolved URL list and a hash of the effective settings in `run.json`: page source and its content hash, passes, filters, limit, driver, capture mode, and step caps. Update `run.json` after each page, writing it atomically (write a temporary file, then rename; retry briefly on Windows `EPERM`/`EBUSY`). Re-running resumes the most recent incomplete run whose settings hash matches, skipping completed pages; otherwise it starts a new run and says why. `--fresh` always starts a new run.
- A failing page never kills the run: catch, log, record it in the report, continue. Use per-step and per-page timeouts; on a timeout, restart NVDA and the browser and retry the page once before recording it as failed.
- Restart NVDA and/or the browser every N pages (config, default 50).
- Handle Ctrl+C cleanly: save state, shut down NVDA and the browser, and leave no orphaned processes. Guidepup registers its own signal handlers that stop NVDA; coordinate with them so state is saved first and NVDA isn't stopped twice. At startup, clean up NVDA or browser processes left behind by a crashed run.
- Exhaustive runs take days, so interruptions are normal: reboots, Windows Update, power. Resuming must handle all of them.
- Clear console progress with an estimate of the time remaining, e.g. `[27/100] /grants/fy27-jag — read: 212 steps (end reached), headings: 9, tab: 34 — 5m 48s — about 7h 10m left`

## Architecture

- Node LTS, TypeScript, pnpm. A plain Node CLI and library; no Nuxt or other web framework.
- CLI plus a programmatic API (`import { runAudit } from "@icjia/voicecap"`). Semantic versioning and a `CHANGELOG.md`.
- **Driver layer.** A driver owns both the screen reader and the browser, so the core never touches Guidepup or Playwright, and the replay driver needs neither. The `ScreenReaderDriver` interface is expressed in actions, not keystrokes. At minimum:
  - start, stop, and getEnvironmentInfo;
  - openPage(url): load fresh, wait until ready, bring to the front, move into web content;
  - nextLine, nextHeading, nextFocusable, toTop, and toBottom, each returning what NVDA said in response;
  - focusInDocument and focusedElement.

  The core decides when a pass stops, from what the driver returns and the phrasing in config, so replay exercises the same stop logic as a real run. Nothing outside `src/drivers/` may import a driver library or assume a specific driver's behavior. Select the driver with a `driver` config setting:
  - `"guidepup"` (default): `src/drivers/guidepup-nvda.ts`, using Playwright as a library with `@guidepup/guidepup` (`@guidepup/playwright` only provides Playwright Test fixtures, which don't suit a CLI). Pin `@guidepup/guidepup` and `@guidepup/setup` exactly and upgrade them together. Guidepup is never forked or vendored, with one exception: port the `navigateToWebContent` logic from `@guidepup/playwright`'s NVDA fixture into this driver, with attribution and the version it came from. Leave out its body click and Tab: clicking can activate a link, and both move the browser's focus starting point, which would corrupt the tab pass. Avoid Guidepup helpers that shell out to VBScript (`type()`, `windowsActivate`, `windowsQuit`); Microsoft is phasing VBScript out, and locked-down PCs often block it.
  - `"at-driver"`: `src/drivers/at-driver-nvda.ts`, a stub for the W3C NVDA AT Driver (github.com/w3c/nvda-at-automation). Every method throws a clear "not implemented" error, with comments showing how it would map to AT Driver websocket commands.
  - `"replay"`: `src/drivers/replay.ts`, with no screen reader or browser. It emulates NVDA from a run folder (`--replay-from <dir>`), matched by URL: it returns each pass's recorded steps in order, then behaves as NVDA does at the end (repeats the last line, says "no next heading", reports focus leaving the document). That way the rest of the pipeline, including stop detection, runs on any OS for development and tests, and tests can assert that the stop reasons the core detects match the recording. Replayed output is labeled as such in every transcript and report, so it can never be mistaken for a real NVDA session.
- **NVDA only, for now.** The name is deliberately screen-reader-agnostic, but do not implement VoiceOver, JAWS, or others. Keep NVDA-specific details (keystrokes, phrasing matched by flags, setup) in drivers and config, not the core.
- **Config:** `voicecap.config.ts` in the current directory (also accept `.js`, `.mjs`, or `.json`), loaded with a TypeScript-capable loader such as jiti, with sensible defaults if absent. It holds:
  - the driver and the browser (default: installed Google Chrome via Playwright's `channel` option, falling back to Playwright's Chromium);
  - capture mode (default: complete) and NVDA settings overrides (applied through Guidepup's `start({ settings })` and recorded);
  - page readiness (`readySelector`, settle delay) and timeouts;
  - flag rules, default passes, per-pass step caps, and the restart interval;
  - the default reviewer name;
  - report branding: title, agency name, and a logo as an inline data URI.
- Use Playwright and a well-maintained XML parser.

## Platform

- Real NVDA runs happen on Windows only. Everything else, including the full pipeline under the replay driver, must work on Windows, macOS, and Linux. NVDA drivers check `process.platform` and exit with a friendly message elsewhere. Do not set `"os": ["win32"]` in package.json.
- I normally work on macOS and Ubuntu, and I'm new to Windows. I'll run voicecap from Git Bash in Windows Terminal, as a normal (non-admin) user. Only Node and npx are needed to run voicecap; pnpm is only for developing it.
- voicecap shuts down any running NVDA when it starts, because Guidepup does. Print a clear warning first.
- **IMPORTANT:** Guidepup's API has changed across versions, and it releases often. The facts below were checked against its source in September 2026. Before writing code, re-check them against the version you pin and use the actual current method names. Do not guess. If something I've asked for isn't supported, say so and propose the closest alternative.

## Known facts about Guidepup and NVDA (checked September 2026)

Checked against the source of `@guidepup/guidepup` 0.34.0, `@guidepup/playwright` 0.19.1, `@guidepup/setup` 0.28.0, and NVDA's `master` branch:

- **Installing NVDA:** `npx @guidepup/setup` no longer installs NVDA on Windows; its `setup` step does nothing there. Instead, `npx @guidepup/setup install`:
  - reads the NVDA build to download from `manifest.json` in whichever `@guidepup/guidepup` resolves from the current directory;
  - downloads it from GitHub releases (honoring `HTTPS_PROXY`);
  - extracts it under `%LOCALAPPDATA%\guidepup` (`GUIDEPUP_SCREEN_READERS_PATH` overrides this).

  Someone running `npx @icjia/voicecap` from a site folder has no such package, so `voicecap setup` must run the pinned installer from voicecap's own package directory.
- **The NVDA build:** Guidepup 0.34.0 pins `guidepup-nvda-0.2.1-2026.2`, a portable NVDA 2026.2 with Guidepup's own settings, separate from any installed NVDA. `nvda.version` returns that build id; it doesn't ask NVDA.
- **Starting NVDA:** `nvda.start()` first runs `nvda.exe --quit`, which shuts down any running NVDA, including an installed copy. It then copies Guidepup's NVDA settings into a per-session folder and applies any `start({ settings })` overrides; `getSettings()` reads them.
- **Speech capture:**
  - Guidepup talks to NVDA over NVDA's Remote Access protocol on 127.0.0.1:6837 and sends keystrokes the same way, so they reach whichever window is in front.
  - Before each captured command it stops speech and waits 250 ms. `capture: "initial"` (the default) keeps only the first utterance per command; `capture: true` keeps everything and waits for 1 s of silence.
  - The spoken-phrase log gets exactly one entry per command: utterances are joined with `". "`, and items within an utterance with `", "`.
  - Don't call Guidepup commands inside `capture()`. Judging from the code, the nested command queues behind the outer one, which is waiting for it, so both hang.
- **Commands:** `next()` is Down Arrow (browse-mode line movement, not an "item"), and `nextHeading()` is H. `lastSpokenPhrase()`, `spokenPhraseLog()`, and `clearSpokenPhraseLog()` exist. Guidepup registers its own SIGINT, SIGTERM, and other signal handlers.
- **`navigateToWebContent`** exists only inside `@guidepup/playwright`'s `nvdaTest` fixture, which requires `@playwright/test`. In order, it:
  1. exits focus mode;
  2. checks the window title with NVDA+T, cycling windows with Alt+Esc until the browser is in front;
  3. clicks the page body and presses Tab;
  4. toggles focus mode;
  5. presses Ctrl+Home.
- **NVDA behavior:**
  - In browse mode, Down Arrow on the last line re-speaks that line; there is no end-of-document message (`cursorManager.py`).
  - Moving past the last heading says "no next heading" (`browseMode.py`).
  - Speech Viewer separates items within an utterance with two spaces, and utterances with newlines (`speechViewer.py`).
  - Log timestamps are time of day only (`logHandler.py`). Speech is logged as `Speaking [...]`, input as `Input: ...`, and typed words as `typed word: ...`.
- **Speed:** based on those timings (an estimate, not a measurement), complete capture costs about 1.3–1.6 s per step, roughly 6 minutes for a page with ~250 steps across the three passes. That's about 10 hours for a 100-page sample and more than a week for an exhaustive 2,000-page run. Measure real numbers in Phase B and put them in the README.

## Deliverables

1. **A short plan first:** file structure, main modules, the driver interface, end-of-page and end-of-tab detection, resuming, and review history. List every assumption and open question, and map each requirement to the test that will cover it. Wait for my OK before writing the full code.
2. **Build in two phases:**
   - **Phase A (any OS, replay driver; I'll do it on my Mac):** everything except the real NVDA driver, with Vitest tests covering:
     - page-list parsing, including Windows-1252 and CRLF files;
     - URL normalization and slugs;
     - stop detection through the replay driver;
     - flag rules;
     - manual log parsing and redaction;
     - report generation, including an axe-core check of the generated report;
     - review history and resume logic.

     Add GitHub Actions CI running lint, type checks, and tests on Ubuntu, macOS, and Windows, so Windows-specific bugs surface before Phase B.
   - **Phase B (Windows):** build the Guidepup driver, `voicecap setup`, and `voicecap doctor`. If you're running on the Windows machine, run the real driver yourself; otherwise give me exact commands to run and say what output to send back. Verify end to end against the test fixture:
     - end-of-page detection, including the page with duplicate lines;
     - "no next heading";
     - the tab pass starting at the skip link;
     - complete capture, checked against a Speech Viewer capture of the same page.

     Then replace the hand-written replay run with real captured output and retune the flag phrasing to match. Keep code changes inside the driver layer as far as possible; fixture and config updates are expected.
3. **A README** covering:
   - Windows setup for someone new to Windows:
     - Node and Git via winget (Node's installer is machine-wide and typically needs admin rights once, so it may need IT); pnpm only for development;
     - `voicecap setup` and `voicecap doctor`;
     - running from Git Bash as a non-admin user;
     - keeping the desktop awake and unlocked (no locked screen or minimized RDP session), with Do Not Disturb on so notifications don't end up in transcripts, and Windows Update restarts paused during long runs;
     - closing any personal copy of NVDA first, since voicecap shuts it down.
   - every command, option, and config setting, including the page list formats with examples, the export-prune-rerun workflow, and drafting a curated sample with `list-urls --sample`
   - the `transcripts/` layout, the trade-off of committing it to git (preserves the audit trail vs. keeps the repo small), and why unredacted raw NVDA logs should never be committed (they can contain passwords)
   - recording manual sessions with Speech Viewer and with the NVDA log (NVDA menu → Preferences → Settings → General → Logging level → Input/output), including the privacy warning and resetting the level afterward
   - verifying transcript fidelity by comparing a Speech Viewer capture with the automated transcript for the same page, normalizing their different separators
   - how to read the report
   - "Updating Guidepup": bumping `@guidepup/guidepup` and `@guidepup/setup` together, re-running `voicecap setup` (a new Guidepup can require a new NVDA build), re-running the fixture, using `pnpm patch` for temporary driver fixes, and what completing the AT Driver stub would involve
   - known limitations: timing flakiness, differences from a stock NVDA install or another browser, expected run times (measured in Phase B), and what automation cannot judge
4. **A test fixture**, with a script to serve it locally on a fixed port (e.g. `pnpm fixture:serve`; sitemap URLs are absolute). It contains:
   - 2–3 static HTML pages and a sitemap index with child sitemaps, including an off-origin URL and a PDF to skip;
   - one page deliberately flawed (generic link text, unlabeled button, no skip link);
   - one page with two identical consecutive lines and a last line that also appears earlier, to test end-of-page detection;
   - `pages.json` and `pages.csv` covering a subset, with a relative path, a labeled entry, and one invalid row, plus a Windows-1252 CSV;
   - a sample `reviews.json` with history;
   - one Speech Viewer capture;
   - one realistic NVDA Input/output log excerpt that includes log noise the parser must discard, text typed into a form field, and a session that crosses midnight;
   - a hand-written replay run folder in realistic NVDA phrasing, including the repeated last line at the end of each read pass, with the flawed page's problems visible in its transcripts.

   The repo's `.gitattributes` converts line endings to LF, so mark CRLF fixtures `-text` to keep their Windows line endings.

If anything here is ambiguous or conflicts with how Guidepup or NVDA actually work, ask me before building rather than working around it silently.
