You are a senior Node.js/TypeScript engineer with deep experience in web accessibility testing, Playwright, and screen reader automation. Build me a reusable, publishable npm package named **@icjia/voicecap** that drives NVDA through a website's pages (from its sitemap or a chosen list), saves what NVDA speaks as reviewable transcripts, and produces an auditable report of automated coverage and human review.

## Context

I'm a senior web developer at the Illinois Criminal Justice Information Authority (ICJIA), a state agency, and I manage 15+ agency websites. They already pass axe-core and pa11y at 100%. My manager wants NVDA screen reader testing. The current site has ~35 pages; the next has ~2,000.

The goal is NOT to replace human review. It is to:
1. Produce text transcripts of NVDA's output that a person can skim much faster than listening, and that can be diffed between runs to catch regressions.
2. Keep an honest audit trail of what was transcribed automatically, what a person reviewed, and what was manually tested with NVDA.

## Commands and options

Main run: `--site` plus exactly one page source (`--sitemap` and `--pages` are mutually exclusive; exit with a clear error if both or neither are given):

    npx @icjia/voicecap --site https://example.illinois.gov --sitemap https://example.illinois.gov/sitemap.xml
    npx @icjia/voicecap --site https://example.illinois.gov --pages ./pages.csv

Run options: `--limit N`, `--include` / `--exclude` (URL patterns, glob or regex), `--passes read,headings,tab`, `--max-steps N`, `--sample`, `--compare <run-id|previous>`, `--fresh`, `--out <dir>` (default `./transcripts`), `--run-name <name>`, `--replay-from <dir>` (replay driver only).

Other commands:
- `voicecap list-urls --site <url> --sitemap <url> <output.csv|output.json>`: export a sitemap as a page list file (see Page sources).
- `voicecap review --page <url> --status <unreviewed|reviewed|issue|fixed> [--note "..."]`: record a review (see Audit trail).
- `voicecap manual add <file> --page <url> [--from <time>] [--to <time>] [--redact-typing] [--no-raw]`: import a manual NVDA session (see Manual sessions).

Wherever a command takes a page, accept either a full URL or a root-relative path. Git Bash on Windows rewrites arguments beginning with `/` into Windows paths, so full URLs must always work; the README should explain this and mention `MSYS_NO_PATHCONV=1`.

## Page sources

- **Sitemap (`--sitemap`):** handle both `<urlset>` and `<sitemapindex>` (recurse into child sitemaps).
- **Page list file (`--pages`):** for testing a chosen subset of a large site. Detect format by extension:
  - **JSON:** an array of URL strings, or an array of objects with a required `url` and optional `label`, `template`, and `notes`.
  - **CSV:** a header row with a required `url` column and optional `label`, `template`, and `notes` columns. Use a well-maintained CSV parser that handles quoted fields, blank lines, a UTF-8 BOM, and CRLF line endings, as Excel on Windows produces.
  - Entries may be absolute URLs or root-relative paths, resolved against `--site`.
  - Report malformed or missing URLs with file line numbers and continue with the valid entries. A missing `url` column is a file-level error.
- **For both sources:** deduplicate, and skip (with a log entry) URLs not on the same origin as `--site` and non-HTML resources (PDF, DOCX, images, etc.). `--include`, `--exclude`, `--limit`, and `--sample` apply after the list is built.
- **`list-urls`** applies the same filtering and writes `url` plus empty `label`, `template`, and `notes` columns, so I can export a large sitemap, prune and tag it in a spreadsheet, and feed it back with `--pages`.
- **`--sample`** picks one page per template (count configurable): by the `template` field when present, otherwise by URL path pattern (e.g. /news/*, /grants/*). Print what it chose and why.

## NVDA passes

For each page, open it in a real browser via Playwright with NVDA running, move NVDA into the web content, and run:

- **read:** walk the page in browse mode, item by item, until the end. Stop at a reliable end-of-document signal (verify NVDA's actual behavior; don't assume one), the same phrase repeating several times in a row, or a hard cap (default 400 steps). Record which condition stopped it.
- **headings:** move heading to heading until NVDA reports no next heading, recording each announcement.
- **tab:** press Tab and record what NVDA announces at each focus stop. Stop when focus leaves the page document (Tab eventually reaches browser UI such as the address bar; detect this with Playwright, not from speech) or a cap is reached.

## Output folder layout

All output goes in `transcripts/` in the current working directory, created if missing (`--out` overrides):

    transcripts/
      report.html              ← report for the most recent run
      latest.txt               ← id of the most recent run
      reviews.json             ← review data, keyed by page URL; persists across runs
      runs/
        2026-09-26_1405/       ← one folder per run: local date and time, plus --run-name if given
          run.json             ← run metadata, environment, and resume state
          report.html
          pages/<page-slug>/
            read.txt  read.json  headings.txt  headings.json  tab.txt  tab.json
      manual/<page-slug>/      ← manual NVDA sessions (see Manual sessions)

- Runs never overwrite each other; earlier runs remain as evidence and for diffing.
- `latest.txt` is a plain file, not a symlink (symlinks are unreliable on Windows).
- Generate the top-level `report.html` with links correct for its own location; don't copy the run's report (its relative links would break).
- **TXT transcripts:** a short header block (see Audit trail), then one spoken phrase per line, for skimming and diffing.
- **JSON transcripts:** the phrases plus metadata: URL, label/template/notes if provided, pass, step count, stop reason, duration, timestamp, and errors.
- Page slugs must be deterministic, safe on Windows (no reserved names like `CON` or `NUL`, no forbidden characters), and short enough to avoid path-length problems. Store the full URL in each JSON file so slugs never need to be reversible. The home page's slug is `home`.

## Audit trail

- **Environment record.** Store in `run.json`, and repeat as the header block of every TXT transcript so each file stands alone as evidence: page source (sitemap URL, or page list file name plus a SHA-256 hash of its contents), driver name and version, NVDA version, browser name and version, OS version, voicecap version, run timestamp, and the NVDA speech/verbosity settings in effect (read from NVDA's config if possible; otherwise document what the driver's setup applies).
- **Reviews.** Per page: status (unreviewed, reviewed with no issues, issue found, fixed), reviewer name (defaulting from config), review date, and notes. Stored in `transcripts/reviews.json` via the `review` command and merged into every report.

## Manual sessions

`voicecap manual add` imports a hands-on NVDA session into `transcripts/manual/<page-slug>/`.

- **Inputs, auto-detected:**
  - **Speech Viewer text:** copied from NVDA's Speech Viewer (NVDA menu → Tools → Speech Viewer).
  - **NVDA log at Input/output level:** a copy of `nvda.log` or `nvda-old.log`. Extract, in order and with timestamps, the input gestures and the speech NVDA produced, discarding all other log content. If the log has no input/output entries, say the logging level probably wasn't set to Input/output.
- **Saved per session**, named by session date and time so several sessions per page can coexist:
  - a clean `.txt` transcript (for logs: each keystroke followed by what NVDA said in response)
  - JSON with the entries (timestamp, type key or speech, text) and metadata: page URL, input format, session start and end, NVDA version if present, import date, reviewer name
  - the unmodified original in a `raw/` subfolder, with its SHA-256 hash in the JSON, as evidence the clean transcript wasn't altered (`--no-raw` skips this)
- **Privacy:** Input/output logs record every keystroke, including text typed into form and password fields. Print a warning on import. `--redact-typing` replaces character keystrokes typed while focus is in an editable field, and NVDA's spoken echo of them, with `[typed text redacted]`; document the heuristic's limits honestly.
- A log may cover several pages: `--from` / `--to` import part of a log, and the same log can be imported against several pages.

## HTML report

A single self-contained file (inline CSS, no external assets) that is itself accessible: proper heading structure, landmarks, a data table with a caption and scoped headers, visible focus styles, sufficient contrast.

- **Summary:** page source and whether the run was a sample, the driver used, total pages, pages transcribed, pages reviewed, pages manually tested, open issues, pages with errors, skipped URLs.
- **Per-page table:** page (label if provided, otherwise URL), template, run status, step counts and stop reasons per pass, heuristic flags, review status with reviewer and date, manual-test indicator, and links to each transcript and manual session.
- Filters: flagged/unflagged, review status, manually tested, template.
- With `--compare`, mark changed pages and show text diffs.

## Heuristic flags

Flag for human attention; never fail a page:
- Generic link text announced repeatedly ("click here", "read more", "learn more", "here", or "link" with no name)
- Unlabeled or poorly labeled items ("button" or "edit" with no accessible name, "graphic" with no description, "unlabeled")
- Read pass stopped at the hard cap instead of a natural end
- No headings, or a first heading that isn't level 1
- Tab pass with zero focus stops, or a long run of stops before main content (possible missing skip link)
- The same phrase repeated many times consecutively (possible focus trap or duplicated content)

The rules, including the NVDA phrasing they match, live in config.

## Reliability at scale

- One page at a time; there is only one screen reader.
- **Resumable:** update `run.json` after each page. Re-running the same command resumes the most recent incomplete run with the same page source, skipping completed pages; `--fresh` starts a new run.
- A failing page never kills the run: catch, log, record it in the report, continue.
- Restart NVDA and/or the browser every N pages (config, default 50).
- Handle Ctrl+C cleanly: save state, shut down NVDA and the browser, and leave no orphaned processes.
- Clear console progress, e.g. `[127/2014] /grants/fy27-jag — read: 212 steps (end reached), headings: 9, tab: 34 — 41s`

## Architecture

- Node LTS, TypeScript, pnpm. A plain Node CLI and library; no Nuxt or other web framework.
- CLI plus a programmatic API (`import { runAudit } from "@icjia/voicecap"`). Semantic versioning and a `CHANGELOG.md`.
- **Driver layer.** A `ScreenReaderDriver` interface (at minimum: start, stop, navigateToWebContent, next, press(key), getSpokenLog, getEnvironmentInfo). Nothing outside `src/drivers/` may import a driver library or assume a specific driver's behavior. Select the driver with a `driver` config setting:
  - `"guidepup"` (default): `src/drivers/guidepup-nvda.ts`. Guidepup is a pinned dependency, never forked or vendored.
  - `"at-driver"`: `src/drivers/at-driver-nvda.ts`, a stub for the W3C NVDA AT Driver (github.com/w3c/nvda-at-automation). Every method throws a clear "not implemented" error, with comments showing how it would map to AT Driver websocket commands.
  - `"replay"`: `src/drivers/replay.ts`, with no screen reader or browser. It replays each pass's phrases and recorded stop reason from a run folder (`--replay-from <dir>`), matched by URL, so the rest of the pipeline runs on any OS for development and tests. Replayed output is labeled as such in every transcript and report, so it can never be mistaken for a real NVDA session.
- **NVDA only, for now.** The name is deliberately screen-reader-agnostic, but do not implement VoiceOver, JAWS, or others. Keep NVDA-specific details (keystrokes, phrasing matched by flags, setup) in drivers and config, not the core.
- **Config:** `voicecap.config.ts` in the current directory (also accept `.js`, `.mjs`, or `.json`), loaded with a TypeScript-capable loader such as jiti, with sensible defaults if absent. It holds the driver, browser, flag rules, default passes, step caps, restart interval, default reviewer name, and report branding (title, agency name, logo as an inline data URI).
- Use Playwright and a well-maintained XML parser. Decide whether to use @guidepup/playwright or Playwright as a library with @guidepup/guidepup (the latter is likely cleaner for a CLI), and explain your choice.

## Platform

- Real NVDA runs happen on Windows only. Everything else, including the full pipeline under the replay driver, must work on Windows, macOS, and Linux. NVDA drivers check `process.platform` and exit with a friendly message elsewhere. Do not set `"os": ["win32"]` in package.json.
- I normally work on macOS and Ubuntu, and I'm new to Windows. I'll run voicecap from Git Bash in Windows Terminal, as a normal (non-admin) user.
- **IMPORTANT:** Guidepup's API has changed across versions. Before writing code, check the current Guidepup documentation and examples (the Playwright + NVDA example especially) and use the actual current method names. Do not guess. If something I've asked for isn't supported, say so and propose the closest alternative.

## Deliverables

1. **A short plan first:** file structure, main modules, the driver interface, end-of-page and end-of-tab detection, resuming, and review merging. Wait for my OK before writing the full code.
2. **Build in two phases:**
   - **Phase A (any OS, replay driver):** everything except the real NVDA driver, with Vitest tests for page-list parsing, flag rules, manual log parsing, report generation, review merging, and resume logic.
   - **Phase B (Windows):** the Guidepup driver, verified end to end against the test fixture. Keep Phase B changes inside the driver layer as far as possible.
3. **A README** covering:
   - Windows setup for someone new to Windows: Node, pnpm, and Git via winget; `npx @guidepup/setup` and the Playwright browser install; running from Git Bash as a non-admin user; keeping the desktop awake and unlocked (no locked screen or minimized RDP session)
   - every command, option, and config setting, including the page list formats with examples and the export-prune-rerun workflow
   - the `transcripts/` layout, and the trade-off of committing it to git (preserves the audit trail vs. keeps the repo small)
   - recording manual sessions with Speech Viewer and with the NVDA log (NVDA menu → Preferences → Settings → General → Logging level → Input/output), including the privacy warning and resetting the level afterward
   - verifying transcript fidelity by comparing a Speech Viewer capture with the automated transcript for the same page
   - how to read the report
   - "Updating Guidepup": bumping the dependency, re-running the fixture, using `pnpm patch` for temporary driver fixes, and what completing the AT Driver stub would involve
   - known limitations: timing flakiness, differences from a stock NVDA install or another browser, and what automation cannot judge
4. **A test fixture**, with a script to serve it locally (e.g. `pnpm fixture:serve`): 2–3 static HTML pages and a sitemap.xml, one page deliberately flawed (generic link text, unlabeled button, no skip link); `pages.json` and `pages.csv` covering a subset, with a relative path, a labeled entry, and one invalid row; a sample `reviews.json`; one Speech Viewer capture and one realistic NVDA Input/output log excerpt that includes log noise the parser must discard; and a hand-written replay run folder in realistic NVDA phrasing, with the flawed page's problems visible in its transcripts.

If anything here is ambiguous or conflicts with how Guidepup or NVDA actually work, ask me before building rather than working around it silently.
