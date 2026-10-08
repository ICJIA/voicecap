# "Can I trust this?" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a second page on the website, `trust.html` (also served at `/trust`), linked as "Can I trust this?" in the bar of every page of the site, that says who built voicecap and shows how it can be checked and how it's tested, with every number and date about voicecap generated from the release and the records. Ship it as 0.13.2.

**Architecture:**
- **A release records its facts:** publish.sh runs a new script, `scripts/release-facts.mjs`, after the tests pass and the build is done. It writes `dist/release-facts.json`: the release's own test counts, git's commit count and first commit date, and CI's matrix.
- **The site build reads them:** `src/site/facts.ts` reads the facts beside voicecap's own modules, with the package's `package.json` and CHANGELOG, and counts the records' facts from what the build published.
- **The page:** `src/site/trust.ts` renders it as a pure function, with its words in `src/site/trust-text.ts`.
- **Both pages share a frame:** the bar, the footer, and the page shell move from `render.ts` into `src/site/frame.ts`.
- **The build:** `src/site/build.ts` writes `trust.html` and gives it its Content Security Policy at both its addresses.

**Tech Stack:** TypeScript strict ESM, Node 22.19+, pnpm, Vitest 5, Playwright (Chromium) with axe for the browser tests, and Bash (publish.sh). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-trust-page-design.md` (1c760a4), approved by the owner on 2026-10-08. This plan builds all of it, with the corrections below.

**Branch:** `0.13.2-trust-page`, in the worktree `C:/Users/cschw/code/voicecap-trust`. Main (0.13.1) was merged into it at 166f114. Its `node_modules` are installed.

## Corrections to the spec (found while planning)

- **C1, the page's words get their own module.** They go in a new `src/site/trust-text.ts` (`TRUST_TEXT`), not in `src/site/text.ts`, so each file keeps one page's words. Only the bar's link label, "Can I trust this?", goes in `SITE_TEXT`, since both pages' bars say it.
- **C2, the bar, the footer, and the page shell move into `src/site/frame.ts`,** shared by both pages, so the two bars can't drift apart. The spec's "render.ts: the bar gains the link on every page" happens there.
- **C3, where the facts are read from.** `dist/release-facts.json` is read relative to the module that reads it (`new URL("../release-facts.json", import.meta.url)` from `dist/site/facts.js`). The source tree never holds one, so a test never reads a developer's stale build. The CHANGELOG and `package.json` are read at `../../`, the package root, as `src/util/version.ts` reads `package.json`.
- **C4, publish.sh empties `dist` before it builds** (`rm -rf dist`). So the tests write their report outside `dist`, to a temporary file (`--reporter=default --reporter=json --outputFile=<file>`), and the facts are written after `pnpm build`. The facts carry no version: publish.sh's `npm version` bumps `package.json` in both modes, and the page reads that.
- **C5, the dry run writes the facts too.** The owner's releases run `./publish.sh --dry-run patch`, then publish the dry run's `dist` with `npm publish --ignore-scripts`. So the step sits before the dry run's exit, and the pack check requires `dist/release-facts.json` in both modes.
- **C6, `buildSite` gains an option, `voicecapFacts`:** the facts the page states, read from the package when it isn't given. The README's pictures then come out the same each time, with fixed example facts as their share times are fixed, and the build's tests are deterministic.
- **C7, the build's own files gain two names.** A site folder named `trust.html` would take the page's place, and one named `trust` would collide with its short address. Both join `OWN_FILES`.
- **C8, the README's pictures become nine:** `website-trust.png`. Its test, and the README's "eight screenshots", change with it.
- **C9, the test count comes from the publishing computer's own run** (publish.sh's `pnpm test`). The facts record that computer's system (`process.platform`), and the page names it: "on Windows".
- **C10, publish.sh has no test harness.** Its facts step and the pack check's new requirement are proven by running them (Task 1's Step 4, then the release's dry run, which must print the facts line), not by a test that reads the script's text.

## Decisions this plan makes (the owner reviews them with the plan)

- **D1, the README's picture uses fixed example numbers,** clearly the script's own, as its share times are, so the README's pictures come out the same each time (C6, C8). The live page's numbers are always generated.
- **D2, a fact that isn't there says so in its place.** A big number shows "—" (which a screen reader hears as "not recorded"), and its line ends "not recorded in this build of voicecap". The page never shows a number it doesn't have.
- **D3, where each big number links:**
  - the tests to "How it's tested";
  - the pages read to the reports (`index.html#sites`);
  - the files to "The evidence";
  - the releases to "How it got here".
- **D4, a release's headline is its CHANGELOG entry's first line.** That's the first bullet's bold words, or else a paragraph's words up to its first ": " or ". ". Backticks and link markup are dropped, leaving plain text.

## Global Constraints

- **Wording:**
  - voicecap is a human review, sped up, and never "automated". "Automated" may describe another tool, such as axe, never voicecap.
  - A person hears, reads, and decides; never say a person "listened".
  - No mention of an AI assistant, anywhere.
  - Guidepup isn't named on the page.
- **The builder line, word for word:** "Built by Christopher Schweda at ICJIA."
- **Every number and date about voicecap is generated,** never typed in the page's code or words. A missing fact says "not recorded in this build of voicecap" (D2). The one exception is the law's compliance dates, quoted from the rule with a link to it.
- **The page is a pure function of the package and the records:** the same records and the same package build the same bytes. No clock, no network, no randomness.
- **The website's rules:**
  - one self-contained file, with one style block (the fonts, then `SITE_CSS`) and one script (`SITE_SCRIPT`), and no `style` attribute;
  - a Content Security Policy from its own hashes, at `/trust.html` and `/trust`;
  - dark first, with a switch to light, and light in print;
  - headings in order, landmarks, a skip link, visible keyboard focus, and complete without JavaScript;
  - axe with no violations in both themes at 1280, 390, and 320 pixels;
  - nothing wider than a 320-pixel window.
- **The bar of every page** has "Can I trust this?", with `aria-current="page"` on the trust page's own bar.
- **No new dependencies.** The facts script reads CI's matrix with a regular expression, not a YAML parser, and runs `git` with `execFileSync`, never through a shell.
- **Commits:** a plain subject line with no trailers of any kind, and no push until the release.
- **What subagents never do:** start NVDA or any desktop program; run voicecap except through the test suite; publish; push; or touch the owner's transcripts home.

## Review Focus

1. **A missing, malformed, or foreign `release-facts.json`** (a hand-edited file, a schema that isn't 1, or counts that aren't whole numbers): the page says "not recorded", never throws, and never shows a wrong number. Task 2 tests it.
2. **A CHANGELOG that doesn't fit** (an `[Unreleased]` heading, a release with no date, or the installed version with no entry, as on a developer's build): the releases list skips what isn't a dated release, and the stamp says the release date isn't recorded. Task 2 tests it.
3. **A website with no report, or with reports from before 0.12.3** (shares with no `result`): the records' facts say "no report has been shared yet", or name how many sites' reports they count. Tasks 2 and 4 test it.
4. **A failed or interrupted test run at release time** (`success` false, failures, or no tests): the facts script refuses to write and exits non-zero, so a failed run's counts never ship. Task 1 tests it.
5. **A site folder named `trust.html` or `trust`:** it's left out with the build's existing "would take the place of the site's own" warning, and the trust page stays. Task 5 tests it.

---

### Task 1: The release's facts

**Files:**
- Create: `scripts/release-facts.mjs`.
- Modify: `publish.sh`, in "Checks and build" and the pack check's `required` list.
- Test: `test/release-facts.test.ts` (new).

**Interfaces:**
- Produces, as named exports of `scripts/release-facts.mjs`, which also runs as a command when it's the entry script (the `import.meta.url` check `scripts/readme-screenshots.ts` uses):
  - **`testsOf(report)`:** from a parsed Vitest 5 JSON report, it gives `{ passed: numPassedTests, skipped: numPendingTests + numTodoTests, files: testResults.length }`. It throws an `Error` that says why when `success !== true`, `numFailedTests > 0`, or `numTotalTests === 0`.
  - **`ciOf(workflow)`:** from the text of `.github/workflows/ci.yml`, it reads the `os: [...]` and `node: [...]` lists of the job's matrix with regular expressions. It gives `{ systems, node }`:
    - `systems` maps each `<name>-latest` to its name: "ubuntu" to "Ubuntu", "macos" to "macOS", "windows" to "Windows";
    - `node` holds the versions as strings.
    - It throws when either list isn't there, or an `os` entry isn't one of the three.
  - **`systemName(platform)`:** "win32" gives "Windows", "darwin" "macOS", and "linux" "Linux". Anything else gives itself.
  - **`writeReleaseFacts({ report, workflow, out, cwd, platform })`:** it reads the report and the workflow files, and runs `execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd, encoding: "utf8" })` and `["log", "--max-parents=0", "--format=%cs"]` (the earliest line, when a history has more than one root). Then it writes `out`, with `JSON.stringify(facts, null, 2) + "\n"`:

    ```json
    { "schema": 1,
      "tests": { "passed": 5012, "skipped": 2, "files": 125, "system": "Windows" },
      "commits": { "count": 486, "first": "2026-09-26" },
      "ci": { "systems": ["Ubuntu", "macOS", "Windows"], "node": ["22", "24"] } }
    ```

  - **The command:** `node scripts/release-facts.mjs <vitest-report.json> [out]`, where `out` defaults to `dist/release-facts.json`. The workflow is `.github/workflows/ci.yml` beside the script's repository, `cwd` is the repository, and `platform` is `process.platform`. It prints one line, `Recorded the release's facts in dist/release-facts.json: 5,012 tests passed on Windows.`, and exits 1 with the error's message when anything throws.
- **publish.sh:**
  - replace `pnpm test` with `RESULTS="$(mktemp -d)/vitest.json"` and `pnpm test --reporter=default --reporter=json --outputFile="$RESULTS"`;
  - after `pnpm build`, run `node scripts/release-facts.mjs "$RESULTS"`;
  - add `dist/release-facts.json` to the pack check's `required` list.

- [ ] **Step 1: Write the failing tests** in `test/release-facts.test.ts`:
  - **"reads a passing run's counts":** `testsOf({ success: true, numTotalTests: 5014, numPassedTests: 5012, numFailedTests: 0, numPendingTests: 2, numTodoTests: 0, testResults: Array(125) })` is `{ passed: 5012, skipped: 2, files: 125 }`.
  - **"refuses a run that failed or ran nothing":** `testsOf` throws for `success: false`, for `numFailedTests: 1`, and for `numTotalTests: 0`.
  - **"reads CI's matrix from the workflow":** `ciOf` of the repository's own `.github/workflows/ci.yml` is `{ systems: ["Ubuntu", "macOS", "Windows"], node: ["22", "24"] }`. A workflow with no `node:` list throws.
  - **"names the system it ran on":** `systemName("win32")`, `("darwin")`, and `("linux")` give "Windows", "macOS", and "Linux".
  - **"writes the facts":**
    - in a temporary folder, `git init` it (via `execFileSync`, no shell), and make two commits with fixed author dates (`GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` of `2026-09-26T10:00:00` and `2026-10-01T10:00:00`);
    - write a passing report and a copy of the workflow;
    - `writeReleaseFacts` writes JSON whose `commits` is `{ count: 2, first: "2026-09-26" }`, `schema` is 1, and `tests.system` is the `platform` given.
  - **"writes nothing when the run failed":** with a failing report, `writeReleaseFacts` rejects, and `out` doesn't exist.
- [ ] **Step 2:** Run `pnpm vitest run test/release-facts.test.ts`. Expected: FAIL, since the script doesn't exist.
- [ ] **Step 3: Implement** the script, and edit publish.sh as above.
- [ ] **Step 4:** Run the file. Expected: PASS. Then:
  - run `pnpm lint && pnpm typecheck`;
  - run `bash -n publish.sh`;
  - run `pnpm test --reporter=default --reporter=json --outputFile="$TMP/v.json" test/release-facts.test.ts && pnpm build && node scripts/release-facts.mjs "$TMP/v.json"`. It prints its line, and `dist/release-facts.json` has this test file's counts.
  - Delete that `dist/release-facts.json` afterwards: it isn't a release's.
- [ ] **Step 5:** Commit: `Record each release's facts in the package: its own test counts, its commits, and CI's matrix, written by publish.sh after the tests and the build`.

### Task 2: The facts the page states

**Files:**
- Create: `src/site/facts.ts`.
- Test: `test/site-facts.test.ts` (new).

**Interfaces:**
- Consumes: `SiteContent` and `PublishedReport` (`src/site/render.ts`).
- Produces, in `src/site/facts.ts`:
  - **`export interface ReleaseFacts`:** `{ tests: { passed: number; skipped: number; files: number; system: string }; commits: { count: number; first: string }; ci: { systems: string[]; node: string[] } }`.
  - **`export interface VoicecapRelease`:** `{ version: string; date: string; headline: string }`, where `date` is `YYYY-MM-DD`.
  - **`export interface VoicecapFacts`:** `{ version: string; released: string | null; releases: VoicecapRelease[]; release: ReleaseFacts | null }`.
    - `released` is the date of the CHANGELOG entry for `version`, or null.
    - `releases` is every dated entry, newest first.
    - `release` is null when there's no valid `release-facts.json`.
  - **`export interface RecordFacts`:** `{ sites: number; reports: number; reading: { read: number; pages: number; problems: number; sitesCounted: number } | null; files: { published: number; leftOut: number }; newest: string | null }`.
  - **`export function parseChangelog(text: string): VoicecapRelease[]`:**
    - It takes each heading line matching `/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/`.
    - Each entry's headline is D4's: the first line after the heading that isn't blank and isn't a `### ` heading. With a bullet that starts with `**`, it's the bold words with a trailing "," or "." taken off. Otherwise it's the text up to the first ": " or ". ", or all of it. In both, backticks are removed, and `[text](url)` becomes `text`.
    - The entries come in file order (newest first).
  - **`export function parseReleaseFacts(value: unknown): ReleaseFacts | null`:**
    - It gives null unless `schema === 1`;
    - every count is a safe whole number of 0 or more;
    - `first` matches `YYYY-MM-DD`;
    - `system` is a string, and `systems` and `node` are non-empty arrays of strings.
  - **`export function voicecapFactsOf(packageJson: unknown, changelog: string, releaseFacts: unknown): VoicecapFacts`:** pure. The version is `packageJson.version` (a string, or it throws, as a package without one is broken).
  - **`export async function readVoicecapFacts(): Promise<VoicecapFacts>`:** it reads `new URL("../../package.json", import.meta.url)`, `new URL("../../CHANGELOG.md", import.meta.url)`, and `new URL("../release-facts.json", import.meta.url)` (C3).
    - A missing or unreadable `release-facts.json` is `undefined` to `voicecapFactsOf`, and so is one that isn't JSON. A missing CHANGELOG is "".
  - **`export function recordFactsOf(content: SiteContent): RecordFacts`:**
    - `sites` counts the sites, and `reports` their reports.
    - `reading` sums the `result` of each site's current report (its first) that has one, with `pages > 0`, and counts them in `sitesCounted`. It's null when none has one.
    - `files.published` counts the distinct `href`s of the published files of every report shown, the demo's too.
    - `files.leftOut` counts every report's `notPublished`.
    - `newest` is the latest `at`, by `Date.parse`, among every report shown, the demo's too, or null.

- [ ] **Step 1: Write the failing tests** in `test/site-facts.test.ts`:
  - **"reads each dated release, newest first, with its first line":** a CHANGELOG string with `## [Unreleased]`, then `## [0.13.1] - 2026-10-08` and `### Changed` before a bullet, `- **The website's headings say more at a glance, and each site links to the site itself.** The README…`.
    - Then `## [0.10.0] - 2026-10-05` and a paragraph, "Canonical site names: everything…".
    - Then `## [0.4.1] - 2026-09-29` and a bullet, "- **`--sitemap` takes a sitemap's name or path**, such as…".
    - It gives the three releases, with the headlines "The website's headings say more at a glance, and each site links to the site itself", "Canonical site names", and "--sitemap takes a sitemap's name or path".
  - **"reads the real CHANGELOG":** `parseChangelog` of the repository's CHANGELOG has its first entry's version equal to `package.json`'s, every date matching `YYYY-MM-DD`, and no empty headline.
  - **"skips what isn't a dated release":** `## [0.14.0]` with no date, and `## [Unreleased]`, give no entry.
  - **"takes only release facts it can trust":** `parseReleaseFacts` gives the object for a valid one. It gives null for `undefined`, `"text"`, `{ schema: 2, … }`, a count of `-1` or `1.5` or `"5012"`, a `first` of `"26 Sep"`, and an empty `systems`.
  - **"says what it knows of voicecap":**
    - `voicecapFactsOf({ version: "0.13.2" }, changelog with 0.13.2 dated 2026-10-09, valid facts)` has `released: "2026-10-09"` and a non-null `release`;
    - with a version the CHANGELOG lacks, `released` is null;
    - with `undefined` facts, `release` is null.
  - **"reads the package it runs from":** `readVoicecapFacts()` from the source gives `package.json`'s version, and `release: null`, since the source tree holds no `release-facts.json` (C3).
  - **"counts the records' facts":** on `CONTENT` (`test/helpers/site-content.ts`), with results added to both sites' current reports (`{9, 9, 0, 0}` and `{32, 32, 1, 32}`), and one older report's result that must be ignored:
    - `sites` is 2, and `reports` 3;
    - `reading` is `{ read: 41, pages: 41, problems: 1, sitesCounted: 2 }`;
    - `files.published` is the number of distinct hrefs in `filesOf(CONTENT)`;
    - `files.leftOut` is 2 (the two `notPublished`);
    - `newest` is `DVFR_NEWEST.at`.
  - **"says when the records have nothing to count":** for `{ demo: null, sites: [] }`, it gives `reading` null, `newest` null, and 0 files. For `CONTENT` as it is (no results), `reading` is null.
- [ ] **Step 2:** Run `pnpm vitest run test/site-facts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/site/facts.ts`.
- [ ] **Step 4:** PASS. Then run `pnpm lint && pnpm typecheck`.
- [ ] **Step 5:** Commit: `Read what the trust page says of voicecap from its package and its release, and count the records' facts from what the website published`.

### Task 3: One bar for every page

**Files:**
- Create: `src/site/frame.ts`.
- Modify: `src/site/render.ts` (the bar, the footer, and the shell move out to `frame.ts`), `src/site/text.ts` (`SITE_TEXT.trust`), and `src/site/style.ts` (the current page's link).
- Test: `test/site-render.test.ts`, `test/site-page-browser.test.ts`.

**Interfaces:**
- Produces, in `src/site/frame.ts`:
  - **`export type SitePage = "index" | "trust"`.**
  - **`export function siteBar(content: SiteContent, current: SitePage): string`:** the bar as `render.ts` writes it today, with two changes.
    - A last link in the nav, `SITE_TEXT.trust` ("Can I trust this?"), to `trust.html`.
    - On the trust page, each view's link goes to `index.html#<id>` rather than `#<id>`, and the trust link has `aria-current="page"`.
  - **`export function siteFooter(): string`:** the footer as it is.
  - **`export function sitePage(parts: { title: string; bar: string; main: string[] }, assets: { fontCss: string }): string`:** the page's shell, as `renderSiteIndex` writes it today, around `main`. That's the head with the title and the one style block, the skip link, the bar, `<main id="main">`, the footer, and the one script.
  - `renderSiteIndex` keeps its signature and its output, except the bar's new link.
- `SITE_CSS`: the current page's link is underlined and bold (`.bar nav a[aria-current="page"]`), so it's told apart by more than color.

- [ ] **Step 1: Write the failing tests:**
  - In `test/site-render.test.ts`, **"links the bar to the trust page, last":** the bar's links are `#demo`, `#sites`, `#by-date`, then `trust.html` with the words "Can I trust this?", and none has `aria-current`.
  - Add `trust.html` to the allowed links of "links only to its files, its own anchors, …".
  - In `test/site-page-browser.test.ts`'s "never hides what has focus under the bar", the count gains 1 for the new link.
- [ ] **Step 2:** Run `pnpm vitest run test/site-render.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `frame.ts`, and move the code out of `render.ts`.
- [ ] **Step 4:** Run `pnpm vitest run test/site-render.test.ts test/site-page-browser.test.ts test/site-build.test.ts`. Expected: PASS, with every other test unchanged. Then run `pnpm lint && pnpm typecheck`.
- [ ] **Step 5:** Commit: `Give every page of the website one bar, with a last link to "Can I trust this?"`.

### Task 4: The trust page

**Files:**
- Create: `src/site/trust.ts` and `src/site/trust-text.ts`.
- Modify: `src/site/style.ts` (the page's styles) and `src/site/icons.ts` (one picture for the page's banner).
- Test: `test/site-trust.test.ts` (new), `test/site-page-browser.test.ts`.

**Interfaces:**
- Consumes: `VoicecapFacts` and `RecordFacts` (Task 2), and `siteBar(content, "trust")`, `sitePage` (Task 3).
- Produces:
  - **`export interface TrustInput { voicecap: VoicecapFacts; records: RecordFacts; content: SiteContent }`.** `content` is only for the bar's views.
  - **`export function renderTrustPage(input: TrustInput, assets: { fontCss: string }): string`:** pure. Every number goes through `count` (`src/share/format.ts`), a date through `longDate`, and the newest share through `dateAndTime`. Everything the facts hold goes through `esc`.
  - **`export const TRUST_TEXT`,** with this copy, word for word. A `${…}` is a fact, written with `count`, `longDate`, or `dateAndTime`. A list in words is joined "A, B, and C", or "A and B":
    - **`title`:** "Can I trust this? · Screen reader test results".
    - **The hero:**
      - kicker: "voicecap · a human review, sped up";
      - h1: "Built to be checked. See for yourself.";
      - lead: "Every claim on this page can be checked without taking anyone's word for it, the builder's included.";
      - the stamp: `voicecap ${version}, released ${released}` (or, with no `released`, `voicecap ${version}, whose release date isn't recorded in this build`), then " · ", then `records as of ${newest}` (or "no report has been shared yet").
    - **The four tiles** (D2 for a missing fact), each a big number, a line, and a link:
      - `${passed}` and `tests passed on ${system} before this release: every one must pass, or nothing is published`, linked "How it's tested" (`#tested`);
      - `${read} of ${pages}` and `pages NVDA read in the current reports on this website` (with `, in ${sitesCounted} of its ${sites} sites` when fewer were counted), then `, where nothing needs attention` for 0 problems, `, where 1 problem needs attention`, or `, where ${problems} problems need attention`, linked "See the reports" (`index.html#sites`);
      - `${published}` and `files on this website, each matching the fingerprint recorded when it was shared` (with `; ${leftOut} left out, because they don't` when `leftOut > 0`), linked "How to check a copy" (`#evidence`);
      - `${releases.length}` and `releases, and ${commits} public changes, since ${first}: every step on the record`, linked "How it got here" (`#releases`).
    - **"What it does"** (`#does`):
      - kicker: "what it does";
      - h2: "One job: hear a website the way a screen reader user hears it.";
      - text: "Many people who are blind or can't see well use a screen reader: software that reads what's on the screen out loud. voicecap has a real screen reader, NVDA, read every page of a website three ways (line by line, heading by heading, and control by control) and saves every word it says. A person then reads what it said, and decides what each page needs. It's a human review, sped up."
    - **"Real NVDA"** (`#nvda`):
      - kicker: "the screen reader";
      - h2: "Real NVDA, not a simulation.";
      - text: "voicecap drives NVDA, the free screen reader many blind people use on Windows, and records exactly what it says on each page. Every transcript is NVDA's own words, so what you read is what a screen reader user hears."
    - **"The law"** (`#law`):
      - kicker: "the law · three names, one idea";
      - h2: "Title II. IITAA. WCAG.";
      - lead: "Government information must work for everyone. Two laws say so; one rulebook defines \"works.\"";
      - the three cards, each a tag, a heading linked to its source, and the spec's quoted words, with the WCAG card's voicecap sentence.
    - **"The evidence"** (`#evidence`):
      - kicker: "the evidence";
      - h2: "Every word can be checked.";
      - five items:
        - "Every transcript and screenshot has a SHA-256 fingerprint. Every run's record is sealed, and every share and every review is chained to the one before it." linked "The audit record" (`https://github.com/ICJIA/voicecap#the-audit-record`);
        - "voicecap verify checks a whole audit record against its seals and fingerprints." linked "How to check a record" (`…#checking-the-record-voicecap-verify`);
        - "Each report checks its own fingerprints in your browser, with no network: open a report and press \"Check the fingerprints\"." linked "See the reports" (`index.html#sites`);
        - `This website publishes only files that still match the fingerprints recorded when they were shared: ${published} today` (with `, and ${leftOut} left out` when `leftOut > 0`), then ".";
        - "Each report's walkthrough file repeats its run, page for page, so anyone can run it again and compare." linked "The walkthrough file" (`…#repeating-a-run-the-walkthrough-file`).
    - **"How it's tested"** (`#tested`):
      - kicker: "the tests";
      - h2: "It tests itself before every release.";
      - four items:
        - `Before each release: ${passed} tests passed on ${system}, with ${skipped} skipped, in ${files} files, then the lint, the type checks, and a check that the package installs and runs. If one test fails, nothing is published.`;
        - `On every change: the same tests on ${systems}, with Node ${node}: ${systems.length × node.length} combinations, and a run of the command line with its replay driver.`;
        - "Every page voicecap writes is checked with axe, an accessibility testing engine, in a real browser, in both themes and at a phone's width.";
        - "A run with real NVDA at a PC comes before any release that changes how voicecap drives NVDA."
      - Missing facts give: "Before each release: every test, the lint, the type checks, and a check that the package installs and runs. The count is not recorded in this build of voicecap." and "On every change: the same tests, on every system in its CI; not recorded in this build of voicecap."
    - **"What it doesn't do"** (`#limits`):
      - kicker: "the limits";
      - h2: "What it doesn't do.";
      - four items:
        - "It doesn't decide what's accessible: a person does, from what NVDA said.";
        - "It uses NVDA only, for now. VoiceOver on a Mac comes later.";
        - "A transcript shows what NVDA said, not what every screen reader would say.";
        - "Automated checkers such as axe find what code can find; a person's review finds the rest."
    - **"One person built this"** (`#builder`):
      - kicker: "the objection";
      - h2: "\"One person built this.\"";
      - lead: "Built by Christopher Schweda at ICJIA. You don't have to take that on trust:";
      - six cards, each a heading and its words:
        - "The code is public": "Every line is on GitHub, free under the MIT license, for anyone to read, run, or check." linked "voicecap on GitHub";
        - "The real screen reader": "voicecap records NVDA itself, the screen reader people use, not an imitation of one.";
        - "Every word on the record": "Each report keeps every transcript, word for word, with a screenshot of each page NVDA read.";
        - "Fingerprints anyone can check": "A report checks its own files in your browser, and voicecap verify checks the whole record.";
        - `${passed} tests` (or "Its own tests"): `Every release passes them first, on ${system}, and CI runs them on every change.`;
        - "A public, dated record": `${releases.length} releases and ${commits} public changes since ${first}, each release dated in the CHANGELOG.` linked "The CHANGELOG" (`https://github.com/ICJIA/voicecap/blob/main/CHANGELOG.md`).
    - **"How it got here"** (`#releases`):
      - kicker: "the record";
      - h2: "How it got here.";
      - the newest five releases, as `${version} · ${date}` then the headline;
      - the rest in a closed fold, `Every earlier release (${n})`, when there are more;
      - a link, "The full CHANGELOG".
    - **The footer** is `siteFooter()`, and above it a line of links: "voicecap on GitHub", "The CHANGELOG", "voicecap on npm" (`https://www.npmjs.com/package/@icjia/voicecap`), and `voicecap ${version}`.
  - **The hero is the page's banner,** in the website's banner style (`view-head`, with its title row): the shield picture in its circle and the h1. The kicker, the lead, the stamp, and the four tiles follow it. Each later section has its kicker above a large h2, as the audit tool's page has.
  - **Headings:** h1, then an h2 for each section, and an h3 for each card. Each section is a `<section>` named by its h2 (`aria-labelledby`), as the website's views are.
  - **`SITE_CSS` gains:** the hero (its kicker, the stamp, and the four tiles in a grid that wraps to one a row at 320 pixels); the cards (three a row for the law, wrapping); a list of releases; and the fold, reusing `details.fold`. All by class, with the theme's tokens.

- [ ] **Step 1: Write the failing tests** in `test/site-trust.test.ts`, with a `FACTS` fixture (version "0.13.2", released "2026-10-09", three releases, valid release facts) and `recordFactsOf(CONTENT with results)`:
  - **"is one file, under its own policy":** one style block, one script last, no `style` attribute, and `inlineHashes(page)` gives the hashes of `\n${fontCss}\n${SITE_CSS}` and `SITE_SCRIPT`.
  - **"puts its headings in order":** h1 "Built to be checked. See for yourself.", then the h2s in the order above, h3s only under "The law" and "One person built this", and no level skipped.
  - **"says every number from the facts it's given":**
    - the tiles' numbers are "5,012", "41 of 41", the published count, and "3", and the pages' line ends ", where 1 problem needs attention";
    - changing each fact (passed 5,013; read 40; one more file; a fourth release) changes the page's text where it should;
    - no tile's number is in `TRUST_TEXT` or `trust.ts` as a literal (assert the page rendered with other facts doesn't contain "5,012").
  - **"stamps the version, its release date, and the newest share":** "voicecap 0.13.2, released 9 October 2026 · records as of 3 October 2026, 14:05".
  - **"says what isn't recorded, and never invents it":** with `release: null`, the tests' tile shows "—" and its line ends "not recorded in this build of voicecap", and the page holds no "tests passed on". With `released: null`, the stamp says the release date isn't recorded. With no reports, the stamp and the pages' tile say "no report has been shared yet".
  - **"names the builder, and the law with its sources":** "Built by Christopher Schweda at ICJIA." The three cards link to ada.gov, doit.illinois.gov, and w3.org, and hold "April 26, 2027" and "April 26, 2028".
  - **"links only where it says":** every link is one of `#…` on the page, `index.html#…`, `trust.html`, the README anchors on GitHub, GitHub, the CHANGELOG on GitHub, npm, or the three law sources.
  - **"shows the newest five releases, and folds the rest":** with seven releases, five in the list and two in the fold, whose summary says "(2)".
  - **"never calls voicecap automated, or says a person listened, or names Guidepup":** the text's only "automated" is in "Automated checkers such as axe", and it holds no "listen" or "Guidepup".
  - **"escapes what the facts hold":** a headline of `<img src=x onerror=alert(1)>` and a system of `"><b>` come out as text.
  - In `test/site-page-browser.test.ts`, a `trust` file rendered with `FACTS`, and a `trustBare` one with `release: null` and no reports, with:
    - axe with no violations, dark and light, at 1280, 390, and 320 pixels;
    - nothing wider than 320 pixels, with the fold open;
    - complete without JavaScript, with its fold open by mouse and by keyboard;
    - the bar's trust link with `aria-current="page"`, underlined.
- [ ] **Step 2:** Run `pnpm vitest run test/site-trust.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `trust.ts`, `trust-text.ts`, the styles, and the picture (a shield with a check mark, outlined, in `SITE_ICONS`).
- [ ] **Step 4:** Run `pnpm vitest run test/site-trust.test.ts test/site-page-browser.test.ts`. Expected: PASS. Then run `pnpm lint && pnpm typecheck`.
- [ ] **Step 5:** Commit: `Write the "Can I trust this?" page: who built voicecap, how it can be checked, and how it's tested, every number from its facts`.

### Task 5: The build writes it

**Files:**
- Modify: `src/site/build.ts`, `src/index.ts`.
- Test: `test/site-build.test.ts`, `test/site-served.test.ts`.

**Interfaces:**
- Consumes: `readVoicecapFacts`, `recordFactsOf`, and `VoicecapFacts` (Task 2), and `renderTrustPage` (Task 4).
- Produces:
  - **`BuildSiteOptions.voicecapFacts?: VoicecapFacts`:** what the trust page says of voicecap. It defaults to `await readVoicecapFacts()`, read with the records, before the folder is emptied (C6).
  - The build writes `trust.html` beside `index.html`, from `renderTrustPage({ voicecap, records: recordFactsOf(content), content }, { fontCss })`.
  - `headerRules` gives it the policy of its own bytes at `/trust.html` and `/trust`, after the index's two rules.
  - `OWN_FILES` gains "trust.html" and "trust" (C7).
  - `src/index.ts` exports the types `VoicecapFacts`, `VoicecapRelease`, `ReleaseFacts`, and `RecordFacts`.
  - The build's last line is unchanged.

- [ ] **Step 1: Write the failing tests:**
  - In `test/site-build.test.ts`, **"writes the trust page, with its policy at both its addresses":** on a home with a shared report, built with a `voicecapFacts` fixture:
    - `trust.html` exists, and its text has the fixture's version;
    - `_headers` has rules for `/trust.html` and `/trust`, each with `contentSecurityPolicy(inlineHashes(<trust.html's text>))`;
    - `index.html`'s bar links to `trust.html`.
  - **"reads voicecap's own facts when none are given":** a build without `voicecapFacts` writes a trust page with `package.json`'s version and the tests' "not recorded in this build of voicecap", since the source tree holds no release facts.
  - **"leaves out a site folder named for the trust page":** folders `trust.html` and `trust` with shares are left out with the existing "would take the place of the site's own" line, and `trust.html` is the trust page.
  - The package entry's "exports its types" gains the four types.
  - In `test/site-served.test.ts`'s "runs every page under its own policy", the trust page at `/trust` and at `/trust.html` runs under a hashed policy with no violation, and its theme button works. **"reaches the trust page from the site's bar":** clicking "Can I trust this?" on `/` lands on the trust page.
- [ ] **Step 2:** Run `pnpm vitest run test/site-build.test.ts test/site-served.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Build the trust page with the website, under its own policy at both its addresses`.

### Task 6: The README, its picture, and the CHANGELOG

**Files:**
- Modify:
  - `README.md`;
  - `CHANGELOG.md`;
  - `scripts/readme-screenshots.ts` (a ninth shot, with fixed example facts);
  - `test/readme-screenshots.test.ts`;
  - `assets/screenshots/website-trust.png` (made by the script).

- [ ] **Step 1: The picture.**
  - `SCREENSHOTS` gains "website-trust.png", after "website-light.png".
  - `makeScreenshots` builds the site with `voicecapFacts: EXAMPLE_FACTS`, a constant in the script: version "0.13.2", released "2026-10-09", the CHANGELOG's real releases from `parseChangelog`, and release facts of 5,000 tests on Windows, 480 commits since 2026-09-26, and CI's real matrix.
  - Its doc comment says these numbers are the script's own, so the picture comes out the same each time (D1).
  - `shootWebsite` opens `trust.html` and shoots its top, through the four tiles, dark.
  - `test/readme-screenshots.test.ts`'s list gains it.
  - Run `pnpm readme:screenshots`, and commit only `website-trust.png` and any website picture that changed. Leave the report pictures alone; they don't come out byte-identical on this PC, as noted for 0.13.1.
- [ ] **Step 2: The README:**
  - **In "The website: `voicecap site`",** a part headed **"Can I trust this?"**:
    - what the page is for (the owner's words: managers needn't take one person's tool on trust), and what it shows, part by part;
    - where each number comes from: the release's facts in `dist/release-facts.json`, written by publish.sh from its own test run, git, and CI's matrix; and the package's version and CHANGELOG, and the records, at each build;
    - that a missing fact says "not recorded in this build of voicecap";
    - that the law's compliance dates are quoted from the rule;
    - the picture, with its words and the note that its numbers are the script's own.
  - **The bar's description** gains the link.
  - **The buildSite paragraph** gains the `voicecapFacts` option and the four types.
  - **The `pnpm readme:screenshots` row** says nine pictures.
  - **The fold "How `publish.sh` works, and what it checks before publishing"** (under "Development") gains the facts step: after the build, it records the release's facts in `dist/release-facts.json`, and the pack check requires the file.
- [ ] **Step 3: The CHANGELOG:** under `## [Unreleased]`, `### Added`, one entry in the CHANGELOG's style: the page, the bar's link, where its numbers come from, and that the website shows it at its next build with no report shared again.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS, with `test/share-text.test.ts` unchanged (a patch has no timeline row).
- [ ] **Step 5:** Commit: `Describe the trust page in the README, with its picture, and in the CHANGELOG`.

## The release (the controller, with the owner)

1. Run the final review on the most capable model, then one fix wave and its scoped re-review (subagent-driven development).
2. Merge into main: `git switch main && git merge --no-ff 0.13.2-trust-page`. Then "Prepare 0.13.2": the CHANGELOG's `## [0.13.2] - <date>`, and its compare links.
3. Push main, and get CI green on all six jobs.
4. Run `./publish.sh --dry-run patch`. Check that it printed "Recorded the release's facts…" with the test count, and that `dist/release-facts.json` holds that count, the commit count, and CI's matrix.
5. Run `npm whoami`; if it fails, the owner logs in.
6. The owner gives a fresh 2FA code. Then run `npm version patch --no-git-tag-version && npm publish --access public --ignore-scripts --otp <code>`. That publishes the dry run's `dist`, with its facts.
7. Commit "Release v0.13.2", tag `v0.13.2` (annotated), and push with the tag.
8. Wait until the 0.13.2 tarball answers 200 and 10 minutes have passed since the publish. Netlify builds with `@0.13`, so no `netlify.toml` change is needed, but it builds only on a push. The empty commit "Build the website with voicecap 0.13.2" in the transcripts repo needs the owner's OK each time; or the owner clicks "Trigger deploy".
9. **The live check:**
   - `/trust` and `/trust.html` answer with the page and its policy;
   - its tests tile shows the dry run's count, and its stamp shows "voicecap 0.13.2, released <date>";
   - every page's bar links to it;
   - the reports are byte-identical to a local `npx @icjia/voicecap@0.13.2 site` build;
   - the front page differs only by Netlify's pretty URLs.
10. Update the handoff's "Published" and "Being built" lines, and the memories. Next is plan 8's release (0.14.0).
