# voicecap build plan

Draft for review, 2026-09-26. This is deliverable 1 of `docs/build-prompt.md`. It covers the whole package. **Phase A** is what I build after your OK. Section 15 holds the questions that need your call. Section 14 lists the assumptions I'll proceed with unless you object.

## 1. Phase A scope

Phase A covers everything in the prompt except the Guidepup NVDA driver, `voicecap setup`, and `voicecap doctor`.

- **Built in Phase A:** the core, the CLI, the programmatic API, the replay driver, the AT Driver stub, the report, the fixture, the Vitest suite, GitHub Actions CI, a README draft, and `CHANGELOG.md`.
- **Placeholders until Phase B:**
  - `setup` and `doctor` exist but print "arrives in Phase B" and exit 1.
  - `driver: "guidepup"` gives the friendly "NVDA runs on Windows only" message off Windows, and "not built yet" on Windows.
- **README:** Phase A writes every section. The Windows steps are marked "verified in Phase B", and the run-time figures stay the prompt's estimates until Phase B measures them.

## 2. Stack

| Choice | Why |
| --- | --- |
| Node ≥ 22.12 (CI on 22 and 24) | Commander 15, Vitest 5, and ESLint 10 require it. Node 24 is the active LTS. |
| TypeScript **6.0**, not 7.0 | TypeScript 7.0.2 is out, but typescript-eslint 8.70 only supports TypeScript < 6.1. |
| ESM only, built with `tsc` to `dist/` | A plain library plus CLI. `bin: voicecap`. |
| pnpm, Vitest, ESLint (flat config with typescript-eslint), Prettier | As requested. |

Runtime dependencies:

- `commander` (CLI)
- `csv-parse` (quoted fields, BOM, CRLF, record line info)
- `fast-xml-parser` (sitemaps)
- `jsonc-parser` (JSON with element offsets, so errors can cite line numbers)
- `picomatch` (globs)
- `diff` (line diffs)
- `jiti` (loading `voicecap.config.ts`)
- `zod` (config validation with readable errors)

Windows-1252 decoding uses Node's built-in `TextDecoder`. I checked that it decodes “ ” € – correctly, and a test guards against regressions on each Node version in CI.

Development only: `playwright` and `@axe-core/playwright`, which run axe on the generated report in real Chromium. jsdom can't check color contrast.

Phase B adds `playwright` as a runtime dependency, plus `@guidepup/guidepup@0.34.0` and `@guidepup/setup@0.28.0`, both pinned exactly.

## 3. File structure

```
.github/workflows/ci.yml
fixture/                         test fixture (also used for Phase B's real-NVDA checks)
  site/                          served by `pnpm fixture:serve` at http://127.0.0.1:4747
    index.html                   good page: skip link, landmarks, one h1
    flawed/index.html            "Read more"/"Click here" links, unlabeled button, img without alt, no skip link, starts at h2
    duplicates/index.html        two identical consecutive lines; the last line also appears earlier
    files/annual-report.pdf
    sitemap.xml                  <sitemapindex> → sitemaps/pages.xml, sitemaps/files.xml
    sitemaps/pages.xml           the pages plus one off-origin URL
    sitemaps/files.xml           the PDF
  pages.json  pages.csv          subsets: a relative path, a labeled entry, one invalid row (CSV is CRLF)
  pages-windows-1252.csv         Excel "CSV (Comma delimited)": smart quotes and dashes, CRLF
  reviews.json                   sample history (reviewed → issue → fixed)
  manual/speech-viewer.txt       CRLF
  manual/nvda-io-log.txt         Input/output log: noise, typing in a form field, crosses midnight, CRLF
  replay-run/                    hand-written run folder: run.json + pages/<slug>/{read,headings,tab}.{txt,json}
scripts/serve-fixture.ts
src/
  index.ts                       public API: runAudit, listUrls, addReview, importManualSession, generateReport, defineConfig, types
  cli.ts                         bin entry: commands, exit codes
  cli/args.ts                    page arguments, pattern arguments, Git Bash rewrite detection
  config/{schema,defaults,load}.ts
  pages/{url,slug,decode,page-list,sitemap,filter,resolve,sample}.ts
  drivers/types.ts               ScreenReaderDriver interface (section 4)
  drivers/index.ts               driver name → module (the only place that knows driver names)
  drivers/replay.ts
  drivers/at-driver-nvda.ts      stub
  drivers/guidepup-nvda.ts       Phase B
  passes/{read,headings,tab,repeat}.ts   stop logic; drivers never decide when a pass ends
  run/{audit,store,resume,page-runner,progress,signals,lock}.ts
  transcripts/{format,write}.ts
  flags/evaluate.ts
  reviews/{store,reviewer,changed}.ts
  manual/{import,detect,speech-viewer,nvda-log,python-repr,redact}.ts
  report/{model,render,compare,styles,client}.ts   client.ts = inline filter script
  util/{atomic-write,hash,time,errors,log}.ts
test/*.test.ts, test/helpers/scripted-driver.ts (a fake driver for timeout, retry, and abort tests)
```

A lint rule (`no-restricted-imports`) and an architecture test keep `@guidepup/*` and `playwright` out of everything except `src/drivers/`.

## 4. Driver interface

```ts
/** Everything NVDA said in response to one action. Items are joined with ", " and
 *  utterances with ". " (Guidepup's format, verified in 0.34.0). "" means silence.
 *  Every driver must return this format, so the core's matching is driver-independent. */
export type Speech = string;

export interface ScreenReaderDriver {
  readonly name: string;                      // "guidepup" | "replay" | "at-driver"
  start(): Promise<void>;
  stop(): Promise<void>;                      // idempotent; safe to call from a signal handler
  getEnvironmentInfo(): Promise<EnvironmentInfo>;
  cleanupStale(): Promise<string[]>;          // clean up processes left by a crashed run; returns what it did

  /** Load fresh, wait until ready, bring the browser to the front (or throw ForegroundError),
   *  and move NVDA into the web content. It returns with the browse-mode cursor at the top,
   *  nothing focused, and the sequential focus starting point at the top of the document.
   *  If the response isn't HTML, it returns straight after loading; the core then skips the page. */
  openPage(url: string): Promise<PageInfo>;
  nextLine(): Promise<Speech>;                // browse-mode Down Arrow
  nextHeading(): Promise<Speech>;
  nextFocusable(): Promise<Speech>;           // Tab
  toTop(): Promise<Speech>;
  toBottom(): Promise<Speech>;
  focusInDocument(): Promise<boolean>;        // false once Tab has moved focus into browser UI
  focusedElement(): Promise<FocusedElement | null>;   // null = nothing focused (body)
}

export interface PageInfo { finalUrl: string; status: number | null; contentType: string | null; title: string | null }
export interface FocusedElement { tag: string; role: string | null; name: string; inMain: boolean; href: string | null }
export interface EnvironmentInfo {
  driver: { name: string; version: string };
  screenReader: { name: "NVDA"; version: string; build: string | null; language: string | null } | null;
  capture: "complete" | "initial";
  browser: { name: string; version: string } | null;
  os: string;
  screenReaderSettings: Record<string, unknown>;  // at least speech, documentFormatting, virtualBuffers, keyboard
  replay?: { from: string; sourceRun: string; sourceDriver: string };
}
```

The core wraps every call in the per-step timeout and every page in the per-page timeout (section 6).

**Replay driver.** It indexes a run folder's page JSON files by canonical URL, both as listed and after redirects. For each recording it builds a small model: the lines, headings, and focus stops, taken from the recorded steps with the end-of-pass steps removed. It then answers like NVDA:

- `toBottom` and `toTop` speak the last and first line.
- `nextLine` advances, and re-speaks the last line forever once it reaches the end.
- `nextHeading` says "no next heading" after the last heading.
- `focusInDocument()` turns false after the last focus stop.
- `openPage` returns the recorded final URL and content type.

A URL with no recording is a page error. Because the core runs the same stop logic, the tests can assert that the replayed stop reasons match the recording's.

**AT Driver stub.** Every method throws `NotImplementedError("at-driver: …")`. Comments map each method to W3C AT Driver commands (`session.new`, `interaction.pressKeys`, the `interaction.capturedOutput` event, `settings.getSettings`). Before writing those comments I'll check them against the current AT Driver spec.

## 5. Passes and stop detection

Every pass starts with `openPage`. Every keystroke is one recorded step. Every pass also stops at its step cap (`step-cap`), or at `--max-steps`, which overrides all three caps.

**read**

```
last = toBottom()                        step 1
prev = toTop()                           step 2
loop:
  s = nextLine()
  if s == prev and lineMatches(last, s):          candidate end: this line was spoken, then repeated
      confirm with endConfirmations (default 1) more nextLine() calls
      if all of them repeat s → stop "end-reached"
      otherwise the new line is ordinary content → continue from it
  else if s has occurred repeatLimit (default 10) times in a row → stop "repeat-limit"
  prev = s
lineMatches(last, s) = last == s, or last ends with ", " + s or ". " + s   (whitespace-normalized)
```

- A mid-page pair like back-to-back "Read more" links never stops the pass unless it also matches the last line, and then the confirmation step catches it.
- A last line that also appears earlier doesn't stop the pass either, because nothing repeats it there.
- The suffix match and the confirmation step are Q1 in section 15.

**headings.** From the top, call `nextHeading()` until the speech matches `phrasing.noNextHeading` (default `^no next heading$`), which stops the pass with `no-next-heading`. The repeat safety net also applies.

**tab.**

- Record `focusedElement()` before the first Tab. It should be nothing; if the page autofocused something, the pass gets a warning.
- Then loop `nextFocusable()`. After each step, `focusInDocument()` decides. When it's false, record the step and stop with `left-document`. Otherwise record the step with `focusedElement()`.
- The repeat safety net also applies here, which catches a one-element focus trap.

Stop reasons: `end-reached`, `no-next-heading`, `left-document`, `repeat-limit`, `step-cap`, `timeout`, `error`.

## 6. Runs, resuming, reliability

**Starting a run**

1. Validate the arguments (exit 1 on bad usage) and load the config.
2. Compute the settings hash, then look for a resumable run. This happens before fetching anything.
3. If a new run is needed, resolve the pages in this order:
   - source → normalize and dedupe → same-origin check → non-HTML extensions → `--include` → `--exclude` → `--limit`.
   - Store the URL list, the skipped list, the settings, and their hash in a new `run.json` with status `running`.

**Running pages**

- Clean up stale processes, then start the driver and record this session's environment.
- For each pending page, run each pass: write the transcripts, then update `run.json`, then print the progress line.
- Every write is atomic: a temp file in the same folder, then `fsync`, then rename, retrying briefly on `EPERM`/`EBUSY`/`EACCES`.

**Resuming**

- The settings hash covers: the site origin; the source identity (sitemap URL, or page list file name plus its SHA-256); passes; include/exclude; limit; driver (plus the replay folder); capture mode; and the step caps.
- A run is a resume candidate when it is incomplete, its hash matches, and no later completed run has the same hash.
- The most recent candidate is resumed with the page list stored in its `run.json`. The source is never fetched again.
- Pages marked done or skipped are kept. Pending and failed pages are redone.
- Otherwise a new run starts, and voicecap says why, e.g. "Not resuming 2026-09-24_0900: passes differ (read,headings,tab → read)". `--fresh` always starts a new run.
- **Sessions:** each start or resume is a session in `run.json`, with its own environment record.
  - If Chrome or NVDA updated while the run was paused, the report says "environment changed during this run".
  - Each TXT header records the environment that page actually used.

**Timeouts and failures**

- Defaults: 30 s per step and 30 min per page.
- On a timeout: stop and restart the driver, then retry the page once. If it times out again, the page is failed.
- Any other page error (a foreground failure, an HTTP 4xx) is recorded, and the run continues.
- Consecutive failures are Q4.
- The driver restarts every `restartEvery` pages (default 50).
- Only one run at a time per output folder (a lock file with a stale-PID check). Phase B adds a machine-wide NVDA lock.

**Ctrl+C.** voicecap handles SIGINT, SIGTERM, SIGHUP (sent when a Windows Terminal tab closes), and SIGBREAK:

- It aborts the current page, which stays pending.
- It saves `run.json`, calls `driver.stop()` once, and exits 130.
- A second Ctrl+C forces exit after a best-effort save.

Phase B detail (verified in the 0.34.0 source): Guidepup's handlers for SIGINT, SIGTERM, SIGQUIT, SIGHUP, and `beforeExit` only stop NVDA; they **never exit the process**. So the Guidepup driver will detach them right after `nvda.start()`. voicecap then saves state first and stops NVDA exactly once.

**Completion**

1. Set the status to `completed`.
2. Write the run's `report.html` snapshot, plus any `--compare` diffs, into the run folder.
3. Write `latest.txt`.
4. Regenerate the live `report.html`.

After that the store refuses any write to the run folder.

**Progress line.** `[27/100] /grants/fy27-jag — read: 212 steps (end reached), headings: 9, tab: 34 — 5m 48s — about 7h 10m left`. The time left is the average page time so far × pages remaining.

**Exit codes**

| Code | When |
| --- | --- |
| 0 | The run completed. Flags never change this. |
| 1 | Invalid usage or config, including an unreadable page source. |
| 2 | The environment is unusable. |
| 3 | The run completed, but some pages failed. |
| 130 | Interrupted. |

## 7. Output: layout, transcripts, hashes

**Layout.** As in the prompt. In addition:

- Run ids are `YYYY-MM-DD_HHMM[_<run-name>]` in local time. The name is sanitized, and a taken id gets `-2`, `-3`.
- voicecap writes `transcripts/.gitattributes` containing `* -text`.
- Transcripts use LF on every OS.

**Page identity.** The canonical URL: fragment dropped, trailing slash removed except at the root, query kept. Slugs, reviews, manual sessions, and comparisons all key on it. The form listed first is the one loaded and shown.

**Slug.** A readable part from the path, then `-`, then 10 hex characters of the canonical URL's SHA-256.

- The readable part is lowercase `[a-z0-9-]` and at most 40 characters, e.g. `grants-fy27-jag-1a2b3c4d5e`.
- `/` without a query is `home`.
- The hash suffix rules out reserved names like `CON`, but I'll still guard against them and test for them.

**TXT transcript.** A header block where every line starts with `# `, then one blank line, then one line per step:

```
# voicecap transcript: read pass
# Page: https://example.illinois.gov/grants/fy27-jag  (final URL: same)
# Label: FY27 JAG | Template: grants | Notes: -
# Run 2026-09-26_1405 | captured 2026-09-26T14:32:10-05:00 | 212 steps, end reached | 4m 51s
# Source: pages.csv (sha256 3f4e...)
# Driver: guidepup 0.34.0, capture complete | NVDA 2026.2 (build 0.2.1-2026.2), language en
# Browser: Chrome 141.0.7390.55 | OS: Windows 11 Pro 24H2 (10.0.26100) | voicecap 0.1.0, config sha256 1a2b...
# NVDA speech: ...   # NVDA documentFormatting: ...   # NVDA virtualBuffers: ...   # NVDA keyboard: ...  (one line each)

[to bottom] content info landmark, © 2026 Illinois Criminal Justice Information Authority
[to top] banner landmark, link, Skip to main content
navigation landmark, list with 6 items, link, Home
...
```

- Setup steps are labeled (`[to bottom]`, `[to top]`).
- Silence is written as `[no speech]`.
- Line breaks inside a step become spaces. The JSON keeps the exact text.
- A replayed run adds `# REPLAYED from <dir>: not a live NVDA session` as the second header line.

**JSON transcript.**

- Metadata: `{ schemaVersion, replayed, run, pass, page: {url, finalUrl, key, slug, label, template, notes}, capturedAt, durationMs, stepCount, stopReason, warnings, errors, environment, steps }`.
- Each step: `{ n, command, spoken, durationMs, offsetMs }`.
- Tab-pass steps also carry `inDocument` and `focused`.

**Hashes.** `run.json` stores two kinds:

- **File SHA-256:** for every file written. This is the integrity record.
- **Content SHA-256:** for each pass, the TXT body only. This is for change detection. Headers include timestamps and run ids, so file hashes differ in every run even when NVDA said the same thing.

## 8. Review history

`reviews.json` stores `{ schemaVersion: 1, pages: { "<canonical URL>": [entry, ...] } }`. Each entry is `{ status, reviewer, at, note, run, transcripts: { "read.txt": { sha256, contentSha256 }, ... } }`.

- **Append-only:** voicecap reads the file, refuses to continue if it doesn't parse, checks that the existing entries are unchanged, appends, and writes atomically. The latest entry is the current status.
- **Reviewer:** `--reviewer`, then `VOICECAP_REVIEWER`, then `git config user.name`, then the config default. With none of these, voicecap refuses and exits 1.
- **Run:** `--run`, or the most recent run (complete or in progress) that has transcripts for the page. voicecap prints the run it used.
- **Changed since review:** the latest entry's content hashes differ from the displayed run's, or the set of passes differs.

## 9. Manual sessions

**Detection.** The file is an NVDA log if it has log-entry headers, which look like `IO - module.func (HH:MM:SS.mmm) - Thread (id):`. Otherwise it's Speech Viewer text.

**Log parsing**

- Keep only `Input: …` gestures, `Speaking [...]` entries, and `typed word:` entries. Discard everything else.
- `Speaking` is parsed by a small Python-repr tokenizer. String literals are kept, with escapes handled. Command objects such as `LangChangeCommand ('en_US')`, `EndUtteranceCommand()`, and `CancellableSpeech (…)` are dropped.
- Items are joined with ", " and utterances with ". ", as in automated transcripts.
- If the log has no input or speech entries: "the logging level probably wasn't Input/output".
- The NVDA version comes from the "Starting NVDA version …" line, if present.
- Before building the fixture and parser, I'll confirm every log format detail against NVDA's source.

**Dates and times**

- The session date is `--date`, or else the file's modification date, which voicecap prints.
- The modification time marks the session's end, so the start date = the modification date minus the number of midnight crossings.
- A midnight crossing is a backwards time jump of more than 12 hours.
- `--from`/`--to` resolve forward from the session start, so `--from 23:50 --to 00:10` works. With Speech Viewer input they are a usage error.

**Files**, named after the session start:

- `manual/<slug>/2026-09-26_1405.txt` and `.json`
- `raw/2026-09-26_1405.nvda-log.txt`, or `.speech-viewer.txt`, with its SHA-256 in the JSON

`--no-raw` keeps the hash without the copy. Collisions get `-2`. Importing needs a reviewer name.

**Redaction (`--redact-typing`)**

- **Editable fields:** voicecap tracks focus announcements, meaning speech that follows a Tab, Shift+Tab, Escape, and similar keys. When that speech contains an editable role from config (English: `edit`, `password edit`, `editable`, `combo box`, `spin button`, `protected`), focus counts as being in an editable field.
- **What gets redacted:**
  - While focus is in an editable field, character keys (including space and Backspace) collapse into one `[typed text redacted]` entry.
  - Any speech that follows a non-navigation key while focus is in the field (character echo, arrow-key read-back) is redacted too.
  - `typed word:` entries are always redacted.
- **Raw copies:** with `--redact-typing`, the raw copy is withheld. Only its hash and a note are kept, unless `--keep-raw`, which prints a warning.
- **Warnings:** every log import prints a privacy warning. An unredacted log where the detector finds typing prints a warning that suggests `--redact-typing`.
- **Documented limits:** English phrasing only; fields reached without a spoken role; mouse focus changes; pasted text that is read back; error messages that quote input; autocomplete lists; IME input; typing in other apps.

## 10. Report

The report is one self-contained file: inline CSS and an inline script, no external assets.

**Structure**

- **Landmarks:** header, main, footer. One `h1`, and `h2` for each section.
- **Summary:** the prompt's list as a definition list.
- **Environment:** shows a mixed-environment warning when needed. A replayed run gets a prominent banner.
- **Pages table:**
  - It has a `<caption>`, `th scope="col"`, and a page cell with `th scope="row"`.
  - It sits in a focusable scroll region, labeled for screen readers.
  - Columns: page (label or URL), template, run status, steps and stop reason per pass, flags, current review (status, reviewer, date), entry count, changed since review, manual sessions, and transcript links. A compare column appears when comparing.
- **Other sections:**
  - Skipped URLs, in a `<details>` with the reason for each.
  - Review history for each page with entries, which the table's "entries" links point to.
  - Manual sessions.
- **Styling:** light and dark color schemes (axe runs on both) and visible focus styles.

**Filters**

- Native, labeled controls: flagged, review status, changed since review, manually tested, template.
- A `role="status"` live region reports "Showing 12 of 35 pages".
- The filter form ships `hidden`, and the script reveals it. Without JavaScript the full table is still there, and there are no dead controls.

**Compare**

- **Base run:** `--compare <id|previous>`. `previous` is the most recent earlier completed run with the same page source: the same sitemap URL, or the same page list file name.
- **What it compares:** only pages in both runs, using the content hashes. Changed pages link to unified diffs of body lines, one file per pass (`<slug>/<pass>.diff.txt`).
- **Where the diffs go:** for a run, into the run folder before sealing. For `voicecap report --compare`, into `transcripts/compare/<base>__<run>/`.
- **Other output:** lists of pages that appear in only one run. If driver, NVDA, browser, voicecap, NVDA settings, or capture mode differ between the runs, a prominent warning says so.

**Regeneration**

- `review`, `manual add`, and `report` regenerate the live report. The live report keeps the displayed run's recorded `--compare` base, so a new review doesn't drop the comparison.
- `report --run <id>` renders an incomplete run with an "Incomplete run: 27 of 100 pages" banner.
- Links are computed relative to the file being written.

## 11. Flags

Flags are config-driven. They never fail a page. They're computed at run time and stored in `run.json`. If the config's rules change later, reports recompute flags from the transcripts, so Phase B can retune them without re-running NVDA. The phrasing assumes English NVDA, and Phase B retunes it.

| Rule | Default logic |
| --- | --- |
| `generic-link-text` | ≥ 2 announcements of a generic link in read or tab. Browse mode says `link, Read more`; focus says `Read more, link`. Phrases: click here, read more, learn more, here, more; a bare `link` counts too. |
| `unlabeled` | Tab: the first item is a bare role (`button`, `edit`, `combo box`, `graphic`, `link`), because focus speech puts the name first. Read: a step that is only a role, or that contains `unlabeled`. |
| `read-not-finished` | The read pass stopped on `step-cap` or `repeat-limit`. |
| `headings` | No headings, or the first heading's level (`level (\d+)`) isn't 1. |
| `tab-no-stops` | Zero in-document focus stops. |
| `tab-before-main` | ≥ 10 stops before the first stop inside main, and the first stop isn't a skip link (a same-page `#` link, or a name matching `/skip/i`). |
| `repeated-phrase` | ≥ 4 identical consecutive steps in any pass. It ignores the read pass's end-of-page repeats and the final "no next heading". |

Users can add custom phrase rules: `{ id, description, passes, pattern, minCount }`.

## 12. Fixture

As listed in section 3. The pages' HTML also serves Phase B's checks: end of page with duplicate lines, "no next heading", Tab reaching the skip link first, and complete capture compared against a Speech Viewer capture.

`replay-run/` is hand-written in realistic NVDA phrasing:

- Every read pass ends with the repeated last line.
- The flawed page's transcripts show its problems.
- It includes one recorded redirect and one non-HTML response.
- Its environment says `driver: hand-written`, so it can't be mistaken for real output. Phase B replaces it with captured output.

`.gitattributes` gets `-text` for the CRLF and Windows-1252 fixtures. The log fixture is named `.txt` because this repo ignores `*.log`.

## 13. CI

`.github/workflows/ci.yml` runs on ubuntu, macos, and windows, each with Node 22 and 24:

1. `pnpm install --frozen-lockfile`
2. Install Playwright's Chromium (`--with-deps` on Linux).
3. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
4. Smoke test: run the built CLI end to end with the replay driver on the fixture.
5. On Windows only, under Git Bash: `voicecap review --page /about …` must exit 1 with the rewrite explanation, and must work with `MSYS_NO_PATHCONV=1`.

## 14. Assumptions (I'll proceed with these unless you object)

1. `--replay-from <dir>` selects the replay driver and overrides the config's `driver`. `driver: "replay"` without a folder is a usage error.
2. `--include`/`--exclude`:
   - Both can be repeated. There is no comma splitting, because globs use `{a,b}`.
   - Globs match the URL path, and `re:` patterns match the path plus the query string.
   - The leading slash is optional on both the pattern and the path.
3. Git Bash detection applies to arguments that are meant to be URLs or URL patterns: `--page`, `--include`, `--exclude`, `--site`, `--sitemap`. When one of these looks like a Windows path, voicecap explains the Git Bash rewrite and exits 1. Local file paths such as `--pages`, `--out`, and the manual file are left alone.
4. `review` and `manual add` resolve a root-relative `--page` against the latest run's site, because neither command takes `--site`. Without any run, they ask for a full URL.
5. `manual add` requires a reviewer name, using the same resolution order as `review`.
6. HTTP 4xx marks a page as failed. HTTP 5xx is retried once, like a timeout, and then fails.
7. A child sitemap that fails to load is a warning, recorded in `run.json` and the report, and the run continues. `.xml.gz` sitemaps work. Proxies are supported through Node's `NODE_USE_ENV_PROXY=1`, which the README documents.
8. `list-urls --sample N` groups by parent path plus `/*`:
   - For example `/news/*` or `/researchhub/articles/*`. Top-level pages share `/*`, and the home page is its own group.
   - It picks N evenly spaced URLs per group in sitemap order, which is deterministic, and prints the counts and its choices.
9. The repeat safety net stops at 10 identical steps in a row, and the `repeated-phrase` flag triggers at 4.
10. The tab pass also records `href` and the initial focus (section 5).
11. The fixture server is fixed at `127.0.0.1:4747`. The IPv4 literal avoids Windows' `localhost` → `::1` problems.
12. Version 0.1.0, with a `CHANGELOG.md` "Unreleased" section. Nothing is published to npm.

## 15. Open questions (my recommendation first)

1. **Read-pass end matching (differs from the prompt's rule).**
   - **Problem 1:** NVDA announces containers it enters, such as "content info landmark", when it moves to a line, but not when it re-speaks the line it's already on (speech.py's control-field cache). So Ctrl+End can say `content info landmark, © 2026 ICJIA` while the end-of-page repeat says `© 2026 ICJIA`. Exact matching would miss the end and fall through to the safety net.
   - **Problem 2:** a mid-page pair of lines that equals the last line would stop the pass early.
   - **Recommendation:** match on an item-boundary suffix (section 5), and add one confirmation Down Arrow, about 1.3 s per page. Both are configurable, and `endConfirmations: 0` restores your exact rule. Phase B checks this against real NVDA output.
2. **Resuming sitemap runs (differs from the prompt).**
   - **Problem:** the prompt puts the source's content hash into the settings hash. A live sitemap changes often, for example when a news item is posted, so a days-long exhaustive run would stop being resumable after its first interruption.
   - **Recommendation:** for sitemaps, hash the URL only. A resumed run uses the page list stored when it started. Page list files keep their content hash, so editing the list starts a new run.
3. **Extra settings in the resume hash.** Also include the NVDA settings overrides and the browser, because both change what gets spoken. **Recommendation: yes.**
4. **Consecutive failures.** Restart the driver after any failed page. After 5 failed pages in a row, stop the run with exit 2, so it's resumable, rather than marking 1,900 pages as failed because NVDA died. **Recommendation: yes.**
5. **License.** The package is meant to be published, and there is no LICENSE file yet. **Recommendation: MIT, with the copyright holder to be confirmed by you: ICJIA or yourself.**

## 16. Requirement → test map

| Requirement | Test (file › case) |
| --- | --- |
| `--sitemap`/`--pages` exclusive; option validation; exit codes 0/1/2/3/130 | `cli.test.ts` |
| Full URL or root-relative page; Git Bash rewrite message; `MSYS_NO_PATHCONV` | `args.test.ts`; CI Git Bash step |
| Patterns: glob, `re:`, optional leading slash; include → exclude → limit order | `filter.test.ts` |
| Sitemap `urlset` and `sitemapindex` recursion, gzip, child failure | `sitemap.test.ts` (injected fetch, plus one test against the real fixture server) |
| JSON and CSV lists: quotes, blank lines, BOM, CRLF, relative entries, bad rows with line numbers, missing `url` column | `page-list.test.ts` (fixture files) |
| Windows-1252 fallback and warning | `page-list.test.ts` › `pages-windows-1252.csv` |
| Normalization and dedupe (fragments, trailing slash, first form kept, queries kept); same-origin skip and the "mostly skipped" warning; non-HTML extensions | `url.test.ts`, `resolve.test.ts` |
| Redirect final URL; off-origin redirect and non-HTML response skipped | `run.test.ts` (replay) |
| Slugs: deterministic, Windows-safe, short, unique, `home` | `slug.test.ts` |
| `list-urls` CSV/JSON columns; `--sample` groups, choices, printout | `list-urls.test.ts` |
| Read end detection: duplicate pair, last line seen earlier, context prefix, confirmation, safety net, cap | `passes.test.ts` (scripted driver) |
| "no next heading"; tab leaves document; focused element; initial-focus warning | `passes.test.ts` |
| Replayed stop reasons match the recording; replay labels in transcripts and report | `replay.test.ts` |
| Layout, run ids and `-2` suffix, `latest.txt` as a file, transcript SHA-256s, completed run immutable | `run.test.ts`, `store.test.ts` |
| TXT header and body, JSON records, environment record, content vs file hashes | `transcripts.test.ts` |
| Resume: hash match and mismatch messages, superseded runs, `--fresh`, stored list reused | `resume.test.ts` |
| Atomic write retries on `EPERM`/`EBUSY` | `atomic-write.test.ts` |
| Failing page isolated; timeout → restart → one retry; restart every N; consecutive-failure stop; Ctrl+C saves state, stops once, exits 130, resumes | `run.test.ts` (scripted driver) |
| Progress line and time left | `progress.test.ts` |
| Reviews: append-only, fields, reviewer order, refusal without a reviewer, default run, changed since review | `reviews.test.ts` |
| Log parsing: noise dropped, repr commands dropped, no-I/O message, version, dates, midnight, `--from`/`--to` | `nvda-log.test.ts`, `python-repr.test.ts` |
| Speech Viewer parsing | `speech-viewer.test.ts` |
| Redaction; raw withheld; `--keep-raw` warning; unredacted-typing warning | `redact.test.ts` |
| Manual import files, raw copy naming, `--no-raw`, collisions | `manual.test.ts` |
| Each flag rule, positive and negative | `flags.test.ts` |
| Report content, summary counts, links resolve, no external assets, incomplete-run and replay banners | `report.test.ts` |
| **axe-core:** zero violations in light and dark, with JS on and off, after filtering; live-region count; full table without JS | `report-a11y.test.ts` (Playwright + @axe-core/playwright) |
| Compare: changed pages, body-only diffs in separate files, pages only in one run, environment warning, `previous` | `compare.test.ts` |
| Config `.ts`/`.js`/`.mjs`/`.json`, defaults, validation errors | `config.test.ts` |
| No driver libraries outside `src/drivers/`; AT Driver stub throws | `architecture.test.ts`, `drivers.test.ts`; ESLint |
| Windows, macOS, and Linux | CI matrix |
