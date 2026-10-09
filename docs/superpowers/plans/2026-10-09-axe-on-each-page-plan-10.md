# Plan 10, axe on each page's card: the plan

> Build it task by task; each step is a checkbox (`- [ ]`).

**Goal:** during a run, voicecap checks each page with axe-core on the first page load, before NVDA reads it. It keeps the results with the page, fingerprinted and sealed, and shows them on the page's card, in the shareable page and its Word copy.

**Architecture:**
- **The capture:** a pure module, `src/axe/results.ts`, holds axe's settings and turns axe's raw results into the kept JSON. The Guidepup driver runs axe-core's own script on the page it holds, in an isolated world of its own on the page's main frame, through the browser's DevTools connection and an optional driver method.
- **The record:** the runner records the result beside the screenshot's, and verify checks it.
- **The display:** the shareable page and the Word copy read the file back, check it, and draw it.

**Tech Stack:** TypeScript strict ESM, Node 22.19+, Playwright (in `src/drivers/` only), axe-core 4.13.0 (now a runtime dependency), Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-09-axe-on-each-page-design.md` (written overnight from the recommendations the owner endorsed; its "Choices for the owner to confirm" travel with this plan).

## Global Constraints

- **Wording:**
  - axe may be called "an automated checker"; voicecap never is, since it's a human review, sped up;
  - a person hears, reads, and decides, never "listened";
  - voicecap's words never call a page accessible or not;
  - axe's `help` and `failureSummary` are shown as axe's;
  - never lead with an IP address.
- **Apart from the verdict:** the verdict, the ring, the four numbers, and "What needs attention" are exactly as they are without axe.
- **NVDA is untouched:** axe runs once a page, on the first load, after `openPage`, before the first pass's first key. It never moves focus, scrolls, or adds an element to the page.
- **Never a failure:** axe has its own 20-second limit. Any error or timeout becomes `{ error }`, and the page is read as usual. While the check runs, only a browser that's gone stays an environment error.
- **The kept file:** `pages/<slug>/axe.json` holds `schemaVersion: 1`, at most 50 elements a rule, and at most 300 UTF-16 code units of each element's HTML (never splitting a character written with two). Its keys are sorted, with a 2-space indent and a final newline, so the same results give the same bytes.
- **Sealed and verified like the screenshot:** a page record's `axe?` sits apart from `files`; `voicecap verify` checks the file; a run from before 0.16.0 passes.
- **No `schemaVersion` bump,** no new run setting, and no change to walkthrough files.
- **The shareable page's rules hold:** one style block, one runnable script, one data block, no `style` attribute, axe-clean in both themes at 1280, 390, and 320 pixels, and nothing wider than 320.
- **Dependencies:** `axe-core` moves to `dependencies`, pinned exactly to `4.13.0`; its file is used unchanged, with its notice. Nothing else is added.
- **Only `src/drivers/`** imports Playwright.
- **Commits:** plain subject lines, no trailers. No push until the release.
- **What the build never does:** start NVDA or any desktop program; run voicecap except through the test suite; publish; push; or touch the owner's transcripts home.

## Review Focus

1. **A page whose own scripts break axe:** a page that redefines `Array.prototype` methods, or holds a global named `axe`, gives a clean result, since axe runs in a world of its own that the page's scripts don't reach, and never a hung page or a failed one. *Test: Task 1.*
2. **A huge page,** with hundreds of failing elements for one rule, keeps 50 and counts the rest. The file and the shareable page stay small. *Tests: Tasks 1, 3.*
3. **axe's HTML snippets hold markup** (`<script>`, `&`, quotes), which comes out as text on the page and in the Word copy. *Tests: Tasks 3, 4.*
4. **A retried or resumed page:** its `axe.json` moves to `attempts/` with the folder, the new attempt records its own, and verify agrees. *Test: Task 2.*
5. **A run without the read pass** (`--passes headings,tab`) still checks each page once, on its first load. *Test: Task 2.*

## Decisions this plan makes

- **D1, one module for axe's settings and the kept JSON:** `src/axe/results.ts` imports nothing from Playwright. Its tests run without a browser.
- **D2, the fold's words and the check read one text:** the shareable page carries each `axe.json`'s exact text in its data block. "Check the fingerprints" checks that text, and the fold is drawn from the same text (but for its line with the file's size and SHA-256), and the check holds what the fold shows to it, so a passing check vouches for those parts of what's shown: the counts, the number on the card's chip, each rule's heading and impact, each element's selector and HTML, axe's words on how to fix them (said once for a rule when every element listed shares them), and the number in each rule's "and N more elements" line. It doesn't vouch for the rest, which isn't compared: the version line, each rule's criteria, and the links, drawn from the same text, and the line with the file's size and SHA-256, which is the run's record's.
- **D3, a strict Content Security Policy in the browser test** comes from a `<meta http-equiv="Content-Security-Policy">` in a page the test writes, so the fixture server needs no change.
- **D4, the README's card picture is shot again** (`report-pages.png`), since every card now has the fold.

---

### Task 1: Checking a page with axe, through the driver

**Files:**
- Create:
  - `src/axe/results.ts`;
  - `test/axe-results.test.ts`.
- Modify:
  - `src/drivers/types.ts`;
  - `src/drivers/guidepup/chrome.ts` (a `ChromeSession.runAxe()`);
  - `src/drivers/guidepup-nvda.ts` (`checkWithAxe`);
  - `package.json` and `pnpm-lock.yaml` (`axe-core` to `dependencies`, `"4.13.0"`);
  - `test/helpers/fake-desktop.ts` (a `FakeSession.runAxe`);
  - `test/chrome-session.test.ts`, `test/guidepup-driver.test.ts`.

**Interfaces:**
- Produces, in `src/axe/results.ts`:
  - `AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]`;
  - `AXE_LIMIT_MS = 20_000`, `MAX_NODES = 50`, `MAX_HTML = 300`;
  - `interface AxeSummary { axeVersion: string; counts: { violations: number; incomplete: number; passes: number; inapplicable: number }; impacts: { critical: number; serious: number; moderate: number; minor: number } }`, where `impacts` counts violations by impact and a missing impact isn't counted;
  - `keptAxeResults(raw: unknown, url: string): { json: string; summary: AxeSummary }`, which throws on something that isn't axe's results;
  - `axeScript(): Promise<string>`: `axe.min.js` from the installed `axe-core`, found with `createRequire(import.meta.url).resolve("axe-core/axe.min.js")`.
- Produces, in `src/drivers/types.ts`:
  - `type AxeCapture = { json: string; summary: AxeSummary } | { error: string }`;
  - `ScreenReaderDriver.checkWithAxe?(): Promise<AxeCapture>`.
- The kept JSON is `{ schemaVersion: 1, axeVersion, tags, url, counts, violations: KeptRule[], incomplete: KeptRule[] }`, where:
  - `KeptRule` is `{ id, impact, help, helpUrl, tags, nodes: { target: string[]; html: string; failureSummary: string }[], moreNodes: number }`;
  - `impact` is `null` where axe gives none.

- [ ] **Step 1: Write the failing tests:**
  - **`axe-results`,** with a raw result built in the test:
    - "keeps at most 50 elements a rule, and counts the rest": 120 nodes give 50 kept and `moreNodes: 70`;
    - "cuts an element's HTML to 300 UTF-16 code units, never splitting a character": 299 `x`s and an emoji keep 299 units, and 298 and an emoji keep 300;
    - "counts violations, needs review, passes, and rules that didn't apply, and violations by impact";
    - "writes the same bytes for the same results": the keys are sorted at every level, with a 2-space indent and a final newline, and two calls with keys in a different order give equal strings;
    - "refuses something that isn't axe's results": `keptAxeResults({}, url)` throws;
    - "finds axe-core's own script": `axeScript()` begins with axe's license notice ("Mozilla Public License").
  - **`chrome-session`,** with real headless Chromium (skipped without it):
    - "finds the demo site's known violations": on `/common-mistakes/`, the violations' ids are exactly `button-name`, `label`, and `page-has-heading-one`;
    - "runs on a page whose policy allows no script": the page's `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">` (D3) still gives results;
    - "moves no focus and scrolls nothing": `document.activeElement` and `scrollY` are the same before and after;
    - "survives a page that breaks arrays, or names its own axe": `Array.prototype.map` replaced, `window.axe = 1`, or a non-writable `axe`, gives results within the limit, and leaves the page's own world as its scripts left it (Review Focus 1);
    - "runs on a page that requires Trusted Types", and "adds nothing to the page": its HTML, `document.activeElement`, and the scroll positions are the same before and after.
  - **`guidepup-driver`:**
    - "gives an error, and keeps the page, when axe fails or takes too long": a session whose `runAxe` rejects, or never settles (fake timers past `AXE_LIMIT_MS`), gives `{ error }`;
    - "says the browser is gone as an environment error".
- [ ] **Step 2:** Run `pnpm exec vitest run test/axe-results.test.ts test/chrome-session.test.ts test/guidepup-driver.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `src/axe/results.ts`.** `KeptRule.impact` is axe's `impact`, or `null`. The canonical JSON comes from a recursive key sort, then `JSON.stringify(value, null, 2) + "\n"`.
- [ ] **Step 4: Implement the browser's side.**
  - `ChromeSession.runAxe(script: string): Promise<unknown>`, through `onPage`, so a gone browser is an `EnvironmentError`. It goes through the DevTools session the browser holds, in an isolated world of axe's own on the page's main frame, not through `page.evaluate` in the page's own world:
    - `Page.getFrameTree` gives the main frame, and `Page.createIsolatedWorld` makes the world;
    - `Runtime.evaluate` runs axe-core's script as the expression, in that world;
    - then `Runtime.callFunctionOn` runs `axe.run(document, { runOnly: { type: "tag", values: AXE_TAGS }, resultTypes: ["violations", "incomplete"] })` there, with `awaitPromise` and `returnByValue`, and gives the results as one JSON string, which Node parses;
    - a script that throws, or a promise that is rejected, is the error DevTools describes (`exceptionDetails`).
  - `GuidepupNvdaDriver.checkWithAxe()`:
    - `withinLimit(session.runAxe(await axeScript()), AXE_LIMIT_MS, …)`, then `keptAxeResults(raw, finalUrl)`;
    - any error but the browser's gives `{ error }` with the first line of what went wrong (`axeErrorReason`), cut to 300 UTF-16 code units.
  - Move `axe-core` to `dependencies` at `"4.13.0"`, and run `pnpm install` to update the lock.
- [ ] **Step 5:** Run the focused tests, then `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 6:** Commit: `Check a page with axe-core through the Guidepup driver, in the page it holds, within 20 seconds, keeping what each rule found`.

### Task 2: The run records it, and verify checks it

**Files:**
- Modify:
  - `src/model.ts` (`AXE_FILE`, `AxeRecord`, `PageRecord.axe?`);
  - `src/run/page-runner.ts` (the call on the first load; `keepAxe`; `PageOutcome.axe`, `Loaded.axe`);
  - `src/run/audit.ts` (`applyOutcome`);
  - `src/verify.ts` (`recordedFiles`);
  - `src/share/records.ts` (`axeRecordOf`);
  - `test/helpers/scripted-driver.ts` (axe results a page).
- Create: `test/run-axe.test.ts`.
- Test: `test/verify.test.ts`.

**Interfaces:**
- Consumes: `AxeCapture`, `AxeSummary`, and `checkWithAxe?` (Task 1).
- Produces:
  - `AXE_FILE = "axe.json"`;
  - `type AxeRecord = (FileHash & AxeSummary & { ranAt: string }) | { error: string; ranAt: string }`;
  - `PageRecord.axe?: AxeRecord`;
  - `axeRecordOf(page: PageRecord): AxeRecord | "unreadable" | undefined`, the pattern of `screenshotRecordOf`.

- [ ] **Step 1: Write the failing tests** (`run-axe`, with the scripted driver):
  - "checks each page once, on its first load, after it opens and before its first key": the driver's call log has `openPage`, then `checkWithAxe`, then the first key; and no `checkWithAxe` on the second or third load;
  - "writes axe.json, and records its fingerprint and counts with the page": the file's bytes are the capture's `json`, and the record is `{ sha256, bytes, ranAt, ...summary }`;
  - "records axe's error, and reads the page as usual": `{ error, ranAt }`, with the page done;
  - "doesn't check a page it skips, or one that answered 4xx or 5xx";
  - "records no axe for a driver that can't check a page";
  - "checks each page on its first load without the read pass": `--passes headings,tab` (Review Focus 5);
  - "moves a retried page's axe.json to attempts/, and records the new attempt's own" (Review Focus 4);
  - "seals the axe record with the run": changing `page.axe.bytes` breaks the seal;
  - `verify`: "reports a missing, changed, or unrecorded axe.json"; "passes a run from before 0.16.0, and the i2i fixture".
- [ ] **Step 2:** Run `pnpm exec vitest run test/run-axe.test.ts test/verify.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - In `runAttempt`, after the first load's checks keep the screenshot, call `session.driver.checkWithAxe?.()` and keep its outcome with `keepAxe`. `keepAxe` writes `AXE_FILE` with `writeFileAtomic`, then builds the record from `fileHash` of the bytes and `ranAt: isoLocalMs(ctx.now())`.
  - `applyOutcome` sets or deletes `page.axe`, as it does `page.screenshot`.
  - `recordedFiles` adds `<slug>/axe.json` when `isFileHash(page.axe)`.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Record each page's axe result with its run, sealed beside its screenshot, and check axe.json in voicecap verify`.

### Task 3: The shareable page shows what axe found

**Files:**
- Create: `src/share/axe-view.ts` (`axeViewOf`).
- Modify:
  - `src/share/load.ts` (`axeFilesOf`, beside `screenshotsOf`; `ShareInput.axeFiles`);
  - `src/share/cards.ts` (`PageCard.axe`);
  - `src/share/text.ts` (`AXE_TEXT`);
  - `src/share/html/pages.ts` (the chip; `axeFold` after "Heard first");
  - `src/share/html/style.ts`;
  - `src/share/check.ts` and `src/share/model.ts` (the axe files in the check);
  - `src/share/run-evidence.ts` (the fingerprints rows);
  - `src/share/html/details.ts` (or wherever "How voicecap works" sits: one line).
- Test: `test/share-cards.test.ts`, `test/share-pages.test.ts` (or the file that tests `cardOf`), `test/share-check.test.ts`, `test/share-document.test.ts`, `test/share-browser.test.ts`, `test/share-text.test.ts`.

**Interfaces:**
- Consumes: `AxeRecord`, `axeRecordOf`, `AXE_FILE` (Task 2).
- Produces:
  - `interface AxeView { axeVersion: string; tags: string[]; counts: AxeSummary["counts"]; violations: AxeViewRule[]; incomplete: AxeViewRule[] }`, with `AxeViewRule` the kept rule's fields;
  - `axeViewOf(text: string): AxeView | null` (null for a text that isn't a kept file);
  - `PageCard.axe?: { view: AxeView; text: string; bytes: number; sha256: string } | { notRecorded: string }`;
  - `CheckData.axe: { run: string; slug: string; name: string; text: string }[]`.

- [ ] **Step 1: Write the failing tests:**
  - **The chip:** "says how many issues axe found": `axe: no issues`, `axe: 1 issue`, `axe: 3 issues`; and no chip without a result.
  - **The fold:**
    - "folds what axe found after Heard first": its summary is "What axe found", with `<span class="sr"> on /about/</span>`;
    - inside, in order: the line of what axe is, the version and rules, the counts, then the issues, most severe first. Each issue has its help, its impact, its WCAG criteria or "best practice", its elements (selector and HTML in `<code>`, with axe's how to fix), and axe's `helpUrl`. Then needs review, under its own heading, and last the file's fingerprint.
  - **The reasons:**
    - "says why there's no result": "Not recorded: this run used voicecap 0.15.0." for an older run;
    - "axe couldn't check this page: <reason>." for an `{ error }` record;
    - "Not checked: this run's driver doesn't check pages with axe." for a 0.16.0 run whose pages have no `axe`;
    - and a file that's missing, or isn't the one recorded, is not shown, and the fold says so.
  - **Escaping:** "draws everything axe supplies as text": an element's HTML holding `<script>alert(1)</script>` and `&` comes out escaped (Review Focus 3).
  - **"Check the fingerprints":**
    - "checks each axe file against its run's record": the result line adds "and N of M axe results match their fingerprints";
    - "Show a change being caught" changes one axe file's text and catches it.
  - **The page:**
    - "keeps the verdict, the ring, and What needs attention as they are": the same model with and without axe results gives the same `glance` and `attention`;
    - "carries each axe file once, in the data block": no other copy;
    - a card with 400 failing elements for one rule shows 50 and "and 350 more" (Review Focus 2).
  - **Browser:** axe has no violations on the shareable page, in both themes, at 1280, 390, and 320 pixels, with every fold open.
- [ ] **Step 2:** Run the files. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - **`axeFilesOf`** reads a card's `pages/<slug>/axe.json` only when its record has a hash, and the file's size and SHA-256 match, as `screenshotsOf` does.
  - **The card's `axe`:** the view comes from `axeViewOf(text)`. The reasons follow `screenshotOf`'s cases, with the version rule `keepsAxe(version)` (voicecap ≥ 0.16.0).
  - **The words** go in `AXE_TEXT`.
  - **The fold** reuses `fold(...)`, with `id: "axe-<slug>"`.
  - **The check script** checks `axe` like `files`. It doesn't apply `bodyOf`, since an axe file has no transcript header. It also holds what each fold shows to the file, as D2 says: the fold names its file (`data-run`, `data-slug`, and `data-file`), and the script compares the counts, the chip's number, each rule's heading and impact, each element's selector and HTML, axe's words on how to fix them, and the number in each rule's "and N more elements" line.
  - **The fingerprints rows** follow the screenshot's.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Show what axe found on each page's card, in a fold beside what NVDA said, checked with the page's other fingerprints`.

### Task 4: The Word copy

**Files:**
- Modify: `src/share/word/pages.ts` (the axe part after "Heard first").
- Test: the Word copy's page tests and evidence tests (`test/share-word-*.test.ts`).

- [ ] **Step 1: Write the failing tests:**
  - "writes what axe found after Heard first": a bold "What axe found", the counts, each issue as a paragraph with its elements as a list, and needs review;
  - "writes why there's none": the card's reason line;
  - "lists each axe.json in the fingerprints table";
  - "writes axe's HTML as text": the `<script>` case (Review Focus 3).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement it from `PageCard.axe` and `AXE_TEXT`, with the Word copy's paragraph and list helpers.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Write what axe found on each page in the Word copy, with its fingerprint`.

### Task 5: The README, its picture, and the CHANGELOG

**Files:** `README.md`, `CHANGELOG.md`, `assets/screenshots/report-pages.png`, `scripts/readme-screenshots.ts` (only if the card's crop needs it).

- [ ] **Step 1:** Run `pnpm readme:screenshots`. Commit `report-pages.png` only (D4); restore the other report pictures it rewrites. Its alt text says what the card now shows: the i2i run is 0.11.0's, so the fold says axe's result isn't recorded.
- [ ] **Step 2: The README:**
  - "What voicecap does on each page": axe's check on the first load, before the first key of the first pass, the 20-second limit, and what's kept;
  - "The audit record": `axe.json` and the page's `axe` record, sealed, and checked by verify;
  - "The shareable page" and "The Word copy": the chip and the fold, apart from the verdict;
  - "Checking the record": axe.json, from 0.16.0;
  - Credits: axe-core (MPL-2.0).
- [ ] **Step 3: The CHANGELOG:** under `## [Unreleased]`, `### Added`, in its style. Reports show axe's results from each site's next run, once it's shared.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Describe axe's check of each page in the README and the CHANGELOG`.

## The release (with the owner)

1. Review the whole branch, then make one round of fixes and review them.
2. After 0.15.0 is released: merge main into this branch.
   - Resolve the CHANGELOG and README.
   - Update the website's Technical details toolchain row for axe-core: it checks each page during a run, as well as voicecap's own tests.
   - Run the full suite.
3. Merge into main (`--no-ff`). Then make "Prepare 0.16.0": the CHANGELOG heading and links, the timeline row under `both` (`<b>0.16.0</b>: axe on each page: what an automated checker finds, in a fold on each page's card, beside what NVDA said, and sealed with the run.`), the Word copy test's days, and the handoff.
4. Push; CI green.
5. `./publish.sh --dry-run minor`.
6. `npm whoami`. Then the owner's 2FA, and `npm version minor --no-git-tag-version && npm publish --access public --ignore-scripts --otp <code>`.
7. "Release v0.16.0", tag, and push.
8. After the tarball wait, set `netlify.toml` to `@0.16` (the standing OK).
9. **A real run, at the owner's word, hands off:** run one site again (sfs, 9 pages) and share it, so its report shows axe's results. Then the live check.
10. Update the handoff and the memories, and add axe-core to the PC security audit's supply-chain list.
