# Plan 4 of the shareable report: the walkthrough file

**Goal:** A run's recipe as one file, so anyone can repeat the run exactly: `voicecap walkthrough` writes it, `--walkthrough` repeats it and then says page by page whether each page sounds the same, and the shareable page offers each run's file as a download.

**Architecture:**
- **The format** is a pure module, `src/share/walkthrough.ts`. It builds a file from a run's record, reads one back strictly (it may come from anyone), and compares a repeat with the original.
- **Runs** gain a fourth page source, `walkthrough`, beside the sitemap, the page list, and `--page`. `runAudit` takes the file's pages, in order, with its passes, step limits, capture mode, and readiness settings.
- **The page and the Word copy** give each run's file in its evidence: the page as a download carried in the page itself, and the Word copy as the commands that get and repeat it.

**Tech Stack:** TypeScript strict, ESM, Node 22.19+, pnpm, Vitest, commander, zod (as the config uses). No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-30-shareable-report-design.md`:
- "Repeating a walkthrough";
- the page's section 9, "The evidence behind these results";
- "Files", and the programmatic API.

This plan builds on plans 1 to 3, which shipped as 0.6.0 and 0.7.0. Each run's record (`run.json`) already holds almost everything a walkthrough file needs: the pages in order with their labels, templates, and notes; the passes, step limits, capture mode, NVDA settings, and browser; each pass's content fingerprint (`contentSha256`); the page source with its fingerprints; and the versions, in each session's environment.

## Decisions beyond the spec, for the owner's eye

1. **A repeat uses this computer's NVDA settings and browser, not the file's.**
   - Why: a walkthrough file can come from anyone, and the NVDA settings in it would be written into NVDA's configuration on this computer.
   - The file still records the original's, and the repeat says which of them differ.
   - Applied from the file: the passes, step limits, capture mode, and readiness settings, which decide what's read and when.
2. **Runs record their readiness settings from now on** (`settings.readiness`). The spec puts them in the file, and run records don't hold them yet.
   - A file written from an older run says they weren't recorded, and repeating it uses this computer's.
   - One side effect: a run left incomplete by 0.7.0 isn't resumed by the next version. Its settings differ, so it starts again, and voicecap says so as it does today. The CHANGELOG says this.
3. **`voicecap walkthrough` never overwrites a file,** as `voicecap share` never does.
4. **Which runs can be written:** a walkthrough file comes from any completed run, as the spec says, a replayed one included (the file says it was a replay). An incomplete run is refused.
5. **What `--walkthrough` refuses and allows.**
   - Refused alongside it, since they'd change what's read: `--site`, `--sitemap`, `--pages`, `--page`, `--limit`, `--include`, `--exclude`, `--passes`, and `--max-steps`.
   - Allowed: `--out`, `--reviewer`, `--compare`, `--run-name`, `--fresh`, and `--replay-from`. With `--replay-from`, tests and CI repeat a walkthrough without a screen reader.
6. **The page carries each counted run's file as a `data:` link** with a `download` attribute. It needs no script and works offline. The page's "links only to its four addresses" rule gains this one kind of link.
7. **The comparison is printed at the end of a repeat that completes,** and isn't stored. The repeat's record names the walkthrough it repeated, through its page source, and that's enough to compare again later.

## Global Constraints

- **Toolchain:** Node.js 22.19 or later; TypeScript strict; ESM; pnpm. `pnpm lint` (ESLint, then Prettier), `pnpm typecheck`, and `pnpm test` all pass before each commit.
- **Dependencies:** no new package.
- **The walkthrough format:**
  - `voicecapWalkthrough: 1`;
  - written as JSON with two-space indents and a final newline;
  - keys in the order of the `Walkthrough` type;
  - the pages in the original run's order.
- **A walkthrough file is untrusted input.** `parseWalkthrough` reads it strictly:
  - no keys beyond the type's;
  - every page URL is absolute `http:` or `https:`, on the file's own site's origin;
  - 1 to 10,000 pages;
  - passes from `read`, `headings`, and `tab`, at least one, none twice;
  - step limits are integers from 1 to 5,000;
  - capture is `complete` or `initial`;
  - readiness values are within the config's own bounds.

  A file that fails says what's wrong, and nothing runs.
- **The page** (`current.html` and its dated copies):
  - stays one self-contained file: exactly one `<style>`, no `style="…"` attribute, nothing loaded from outside;
  - links only to `https://github.com/ICJIA/voicecap`, `https://github.com/ICJIA/voicecap/issues`, `https://www.nvaccess.org/`, and the Deque study, and to each counted run's walkthrough download (an `<a download>` whose `href` is `data:application/json;base64,…`);
  - passes axe with zero violations;
  - reflows at 320 px.
- **The Word copy** follows plan 3's rules (Word's own styles, repeating table headers, no merged or empty header cells, links only to the page's four addresses). It has no downloads; it says the commands.
- **Honesty:**
  - a repeat promises the same pages, keys, and order, never the same words;
  - "sounds the same" only when every pass's fingerprint matches the original's;
  - a version that differs is named.
- **Copy:**
  - plain words, short sentences;
  - never "automated" for voicecap;
  - never say a person "listened";
  - dates as "30 September 2026";
  - counts as digits.
- **Never start a real screen reader,** in tests or while building:
  - no run without `--replay-from` or a scripted driver;
  - no `setup`, `doctor`, `preflight`, `demo`, `init`, `test:nvda`, or `fixture:capture`;
  - never pass a composed command through `cmd /c` or any shell.
- **Commit messages:** one subject line, and no trailers of any kind.

## Review Focus

1. **A walkthrough file edited to point elsewhere:** a page at another origin, a `file:` or `javascript:` address, or a site of `file:`. It's refused before anything runs or is fetched, naming the page. Task 2 adds the tests.
2. **A page the original read that's gone now** (a 404, or a redirect off the site). The repeat records it as any run would, and the comparison says "couldn't be read now", never "sounds different". Task 6 adds the test.
3. **`--walkthrough` with an option that would change what's read.** It's refused before anything runs, naming the option. Task 5 adds the tests.
4. **A walkthrough written from a run made with 0.4.1** (no titles, no environment, no readiness). It's written, with nulls where the run recorded nothing, and it repeats. Tasks 2 and 3 add the tests.
5. **A large site** (400 pages, 3 runs). The file writes and reads back in well under a second, and the page's downloads add a measured, reported amount to it. Tasks 2 and 7 add the tests.

---

### Task 1: Runs record their readiness settings

**Files:**
- Modify: `src/model.ts` (`RunSettings`), `src/run/audit.ts` (the settings object, about lines 201-215)
- Test: `test/run.test.ts`

**Interfaces:**
- Produces: `RunSettings.readiness?: { readySelector: string | null; settleMs: number; networkIdleTimeoutMs: number }`. Its doc comment: "How long the run waited for each page to be ready, as the config gave it. Absent in runs from before voicecap recorded it."

- [ ] **Step 1: Write the failing test.** In `test/run.test.ts`, test "records the readiness settings it waited with":
  - a scripted run with a config whose `readiness` is `{ readySelector: "#app", settleMs: 250, networkIdleTimeoutMs: 4000 }`;
  - `readRunJson(...).settings.readiness` equals exactly that object.
- [ ] **Step 2: Run it, and see it fail.** Run: `pnpm exec vitest run test/run.test.ts -t "readiness settings"`. Expected: FAIL, `readiness` is undefined.
- [ ] **Step 3: Record them.** Add `readiness: { ...config.readiness }` to the settings `runAudit` builds. Leave unchanged how a run is resumed: a different settings hash starts a new run, as today.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS. Tests that pin a run's whole settings object gain `readiness`; change those expectations, and nothing else.
- [ ] **Step 5: Commit:** `git commit -m "Record the readiness settings each run waited with"`.

### Task 2: The walkthrough format: built from a run, and read back strictly

**Files:**
- Create: `src/share/walkthrough.ts`, `test/share-walkthrough.test.ts`

**Interfaces:**
- Consumes: `RunJson`, `PageStatus`, `PassName`, `CaptureMode`, `PageSource` (src/model.ts); `UsageError`.
- Produces, in `src/share/walkthrough.ts`:
  ```ts
  export interface WalkthroughPage {
    url: string;
    label?: string;
    template?: string;
    notes?: string;
    /** What the original run did with the page, and each pass's fingerprint where it read it. */
    original: { status: PageStatus; passes: Partial<Record<PassName, string>> };
  }
  export interface WalkthroughSettings {
    passes: PassName[];
    stepCaps: Record<PassName, number>;
    capture: CaptureMode;
    /** null when the original run didn't record them. */
    readiness: { readySelector: string | null; settleMs: number; networkIdleTimeoutMs: number } | null;
  }
  export interface WalkthroughOrigin {
    run: string;
    seal: string | null;
    createdAt: string;
    completedAt: string;
    replayed: boolean;
    /** The page source as the run recorded it, and the fingerprints of what it read from it. */
    source: PageSource;
    sourceFingerprints: { name: string; sha256: string }[];
    /** From the run's last session; null where it recorded none. */
    voicecap: string | null;
    screenReader: { name: string; version: string } | null;
    browser: { name: string; version: string } | null;
    /** Recorded, never applied: a repeat uses this computer's. */
    nvdaSettings: Record<string, unknown>;
    browserChannel: string;
  }
  export interface Walkthrough {
    voicecapWalkthrough: 1;
    site: string;
    pages: WalkthroughPage[];
    settings: WalkthroughSettings;
    original: WalkthroughOrigin;
  }
  /** The walkthrough of a completed run: every page of its list, in its order. Pure. */
  export function walkthroughOf(run: RunJson): Walkthrough;
  /** As the file holds it: two-space indents and a final newline. */
  export function walkthroughJson(walkthrough: Walkthrough): string;
  /** Read a walkthrough file strictly; a UsageError that names the file and the problem otherwise. */
  export function parseWalkthrough(text: string, file: string): Walkthrough;
  ```
- **Where the source fingerprints come from:**
  - a sitemap run's `source.sitemaps` entries that have a `sha256` (`name` is each sitemap's URL);
  - a page list's `source.sha256` (`name` is its file);
  - none for `--page` runs.
- **What a page's passes hold:** each `passes[pass].contentSha256`, for the pages the run read (`status: "done"`).
- **Where the versions come from:** the last session with an environment, through `screenReader`, `browser`, and `voicecap.version`.

- [ ] **Step 1: Write the failing tests** in `test/share-walkthrough.test.ts`. Build runs with `shareRun` (test/helpers/share-data.ts), and use `demoRun("1402")` (test/helpers/share-fixture.ts, recorded by 0.4.1).
  - **"holds every page of the run, in its order, with what it said":**
    - `walkthroughOf(run).pages.map((p) => p.url)` equals `run.pages.map((p) => p.url)`;
    - a page that was read has `original: { status: "done", passes: { read: <its read contentSha256>, … } }`;
    - a failed page has `original: { status: "failed", passes: {} }`;
    - labels, templates, and notes are kept where the run has them, and absent where it doesn't.
  - **"takes the settings that decide what's read, and records the rest":** `settings` equals the run's `passes`, `stepCaps`, `capture`, and `readiness`. `original.nvdaSettings` and `original.browserChannel` are the run's.
  - **"says where it came from":** `original` holds the run's id, seal, `createdAt`, `completedAt`, and `replayed`, the versions from its last session's environment, and the source's fingerprints.
  - **"writes nulls where an older run recorded nothing":** for `demoRun("1402")`, `settings.readiness` is `null` and `original.voicecap` is `"0.4.1"`. Each other field the 0.4.1 record lacks is `null`, never a guess.
  - **"refuses an incomplete run":** `walkthroughOf` of a run with `status: "incomplete"` throws `UsageError`, with "didn't complete" in its message.
  - **"reads back exactly what it wrote, keys in the type's order":**
    - `parseWalkthrough(walkthroughJson(w), "w.json")` deep-equals `w`;
    - `Object.keys(JSON.parse(walkthroughJson(w)))` equals `["voicecapWalkthrough", "site", "pages", "settings", "original"]`;
    - the text ends with `"}\n"`.
  - **"refuses a file that isn't a walkthrough, saying why"** (Review Focus 1). `it.each` over these, each expecting a `UsageError` whose message starts `"w.json isn't a voicecap walkthrough file: "` and contains the reason:

    | input | reason contains |
    |---|---|
    | `"{ not json"` | `"it isn't JSON"` |
    | a valid file with `voicecapWalkthrough: 2` | `"its format version is 2"` |
    | `pages: []` | `"it lists no pages"` |
    | page 3's url `"file:///C:/x"` | `"page 3's address, file:///C:/x, isn't on its site"` |
    | a page at `"https://elsewhere.example/"` | `"isn't on its site"` |
    | a page at `"javascript:alert(1)"` | `"isn't on its site"` |
    | `site: "file:///C:/"` | `"its site isn't a web address"` |
    | `passes: ["read", "read"]` | `"passes"` |
    | `passes: ["speak"]` | `"passes"` |
    | `stepCaps.read: 0` | `"stepCaps"` |
    | an extra top-level key `"run"` | `"run"` |
    | 10,001 pages | `"more than 10,000 pages"` |
  - **"reads a file with a byte-order mark":** a valid file with a leading U+FEFF parses.
  - **"writes and reads a 400-page walkthrough quickly"** (Review Focus 5): building, writing, and parsing a 400-page, 3-pass walkthrough takes under 500 ms in total, measured with `performance.now()` and asserted.
- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/share-walkthrough.test.ts`. Expected: FAIL, the module doesn't exist.
- [ ] **Step 3: Write the module.** Parse with a zod strict schema, as `src/config/schema.ts` does. The origin and URL rules go in a refinement, so the message names the page by its 1-based place. Strip a leading BOM before `JSON.parse`. The 10,000-page limit is a constant, `MAX_WALKTHROUGH_PAGES`.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Add the walkthrough file's format: built from a run, read back strictly"`.

### Task 3: `voicecap walkthrough` writes a run's file

**Files:**
- Create: `src/share/write-walkthrough.ts`, `test/write-walkthrough.test.ts`
- Modify: `src/cli/main.ts`, `src/index.ts`, `test/cli.test.ts`

**Interfaces:**
- Consumes: `walkthroughOf`, `walkthroughJson` (Task 2). It finds the home and the site folder as `shareReport` does (`resolveHome`, `chooseSiteDir`), and reads runs with `listRuns` and `readRunJson`.
- Produces:
  ```ts
  export interface WriteWalkthroughOptions {
    /** Where to write it. Never overwritten. */
    file: string;
    site?: string | null;
    /** The run to write it from. Default: the latest completed run. */
    run?: string | null;
    out?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    logger?: Logger;
  }
  export interface WriteWalkthroughResult { file: string; runId: string; walkthrough: Walkthrough }
  export function writeWalkthrough(options: WriteWalkthroughOptions): Promise<WriteWalkthroughResult>;
  ```
  `src/index.ts` exports `writeWalkthrough`, `parseWalkthrough`, `walkthroughOf`, and their types.
- **What it says:**
  - On success: `Wrote the walkthrough of run <id> (<n> pages) to <file>.` Then: `To repeat the run: npx @icjia/voicecap --walkthrough <file>`. `<file>` is quoted with `formatCommand`'s quoting (src/util/command-line.ts), as `voicecap report`'s hint is.
  - No completed run: `There's no completed run in <siteDir> yet, so there's nothing to repeat.`
  - `--run` names an incomplete run: `Run <id> didn't complete, so it can't be repeated. Run it to the end first.`
  - `--run` names no run: `There's no run <id> in <siteDir>.`
  - The file is there: `<file> is already there. voicecap doesn't overwrite it: give another name, or move that file first.`
- **The command:**
  - `voicecap walkthrough [options] <file>`, described as "write a run's walkthrough file: its pages, in order, and its settings, so anyone can repeat the run".
  - Options: `--site <url>` ("the site's URL (default: the home's only site)"), `--run <id>` ("the run to write it from (default: the latest completed run)"), and `--out <dir>`, worded as `share`'s.
  - It exits 0, and a refusal exits as other usage errors do.

- [ ] **Step 1: Write the failing tests.** In `test/write-walkthrough.test.ts`, use the hoisted `homeWithCountedRun` (test/helpers/run-site.ts):
  - **"writes the latest completed run's walkthrough, and says how to repeat it":**
    - the file parses with `parseWalkthrough`;
    - its `original.run` is the run's id;
    - the logger's lines are exactly the two above.
  - **"writes the run --run names, an older one too":** two runs, `run` set to the first. The file's `original.run` is the first's id.
  - **"refuses an incomplete run, a missing run, and a home with no completed run":** each message as above, and no file written.
  - **"never overwrites a file":** write to a path holding `"mine"`. It's refused, and the file still holds `"mine"`.
  - **"writes from a run voicecap 0.4.1 recorded"** (Review Focus 4): copy `test/fixtures/share/demo-2026-09-29` into a temp home and write `--run 2026-09-29_1402`. It parses, and `settings.readiness` is `null`.

  In `test/cli.test.ts`:
  - `voicecap walkthrough --out <home> --site <SITE> <file>` exits 0 and prints the two lines;
  - `voicecap --help` lists `walkthrough`.
- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/write-walkthrough.test.ts test/cli.test.ts`. Expected: FAIL, the module and the command don't exist.
- [ ] **Step 3: Write `writeWalkthrough`, the command, and the exports.**
  - Write with the `wx` flag, synced before closing, as `shareReport` writes its copies.
  - Create the file's folder if it's missing.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Add voicecap walkthrough: write a run's walkthrough file"`.

### Task 4: A run's pages can come from a walkthrough

**Files:**
- Modify: `src/model.ts` (`PageSource`, `SourceDetails.kind`), `src/pages/resolve.ts` (the source's description, about line 326), `src/run/resume.ts` (about line 86), `src/report/compare.ts` (about lines 184-195), `src/report/render.ts` (about lines 127-181), `src/transcripts/format.ts` (about line 104), `src/share/model.ts` (about line 414)
- Test: `test/pages-resolve.test.ts` (or the file that tests `describeSource`), `test/compare.test.ts`, `test/report.test.ts`, `test/transcripts-format.test.ts`, `test/share-model.test.ts`, `test/share-standing.test.ts`. Use whichever existing test files cover each function; create none.

**Interfaces:**
- Produces:
  - `PageSource` gains `{ kind: "walkthrough"; file: string; sha256: string; run: string }`: the walkthrough's file, recorded as a page list's is (`recordedPath`: relative to the working folder when inside it), its SHA-256 as read, and the original run's id;
  - `SourceDetails.kind` gains `"walkthrough"`.
- **How each place names the source:** as it names a page list, with the walkthrough's words in place of the page list's:
  - every description: `the walkthrough of run <run> (<file>)`;
  - the transcript header and the report: the walkthrough's file, its SHA-256, and the run;
  - `sameSource`: two walkthroughs with the same SHA-256 are the same source. A walkthrough and any other source are different, and the comparison note names both, as it does today;
  - the site's standing (`standing.ts`): a walkthrough run is a list run, in scope, like a page list. It already is, since its kind isn't `urls`; pin it with a test.

- [ ] **Step 1: Write the failing tests,** one per place, each giving its exact words for a source of `{ kind: "walkthrough", file: "w.json", sha256: "a".repeat(64), run: "2026-09-29_1402" }`. Then one in `test/share-standing.test.ts`: "counts a walkthrough run as a list, in scope, like a page list".
- [ ] **Step 2: Run them, and see them fail.** Expected: FAIL. Each place names an unknown kind wrongly, or TypeScript rejects the kind.
- [ ] **Step 3: Add the kind and each description.** Every `switch` or `if` chain on `source.kind` ends in an exhaustive check (`const never: never = source`), so a fifth kind can't be missed later.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Let a run's pages come from a walkthrough file"`.

### Task 5: `--walkthrough` repeats a run

**Files:**
- Modify: `src/run/audit.ts`, `src/pages/resolve.ts`, `src/cli/main.ts`, `src/index.ts` (the option's type is exported with `RunAuditOptions`)
- Test: `test/run-walkthrough.test.ts` (new), `test/cli.test.ts`

**Interfaces:**
- Consumes: `parseWalkthrough` (Task 2); `PageSource` `walkthrough` (Task 4); `RunSettings.readiness` (Task 1).
- Produces:
  - `RunAuditOptions.walkthrough?: string | null`: the walkthrough file's path.
  - `resolvePages` takes `walkthrough?: { file: string; sha256: string; parsed: Walkthrough }`, the file already read and parsed. The pages are the file's, in its order, with their labels, templates, and notes. The source details' `kind` is `"walkthrough"`, with the file and its SHA-256.
  - `RunAuditOptions.site` becomes optional: required, as today, unless `walkthrough` is given, when the site is the file's. Without either, the CLI's existing "Missing --site <url>" refusal stands.
- **How a repeat runs:**
  - The file is read once, as bytes. Its SHA-256 goes into the page source, then it's parsed.
  - The site is the file's.
  - The settings' passes, step limits, capture mode, and readiness are the file's. Where the file's readiness is `null`, the config's apply.
  - The NVDA settings and browser are this computer's config (decision 1).
  - The driver gets a config with those replaced (`capture`, `stepCaps`, `readiness`), so what it reads is what the file says.
- **What it refuses.** With any of `site` (other than the file's own), `sitemap`, `pages`, `pageUrls`, `limit`, `include`, `exclude`, `passes`, or `maxSteps`, it refuses before anything runs:
  - `--walkthrough repeats the pages and passes its file lists, so it can't be used with --<option>.`
  - The CLI's own `--site` comes from the file, so the CLI doesn't require `--site` alongside `--walkthrough`.
- **The CLI option:** `--walkthrough <file>`, described as "repeat a run from its walkthrough file: the same pages, in the same order, with the same passes and limits".

- [ ] **Step 1: Write the failing tests** in `test/run-walkthrough.test.ts`, with the scripted driver (test/helpers/scripted-driver.ts). Write a walkthrough from a scripted run with `writeWalkthrough`, then:
  - **"reads exactly the file's pages, in its order":**
    - the repeat's `run.pages.map((p) => p.url)` equals the file's, including after the file's pages are reordered by hand;
    - the scripted driver saw the pages in that order.
  - **"runs with the file's passes, step limits, capture mode, and readiness":** a file with `passes: ["read"]` and `stepCaps.read: 7`. The repeat's settings have exactly those, and the driver's config `capture` is the file's.
  - **"keeps this computer's NVDA settings and browser":** a file whose `original.nvdaSettings` is `{ "speech.rate": 10 }`. The repeat's `settings.nvdaSettings` is the config's.
  - **"records where its pages came from":** the repeat's `settings.source` equals `{ kind: "walkthrough", file, sha256: <the file's SHA-256>, run: <the original's id> }`.
  - **"refuses an option that would change what's read"** (Review Focus 3): `it.each` over the nine options, each refused with its message, and no run folder written.
  - **"allows --compare, and the other options that don't change what's read":** a repeat with `compare: <the original's id>` completes, and its `compareTo` is the original's id. One with `reviewer`, `runName`, and `fresh` completes too.
  - **"resumes an interrupted repeat":** interrupt after one page (the scripted driver's abort), then run the same walkthrough again. The same run continues.
  - **"refuses a walkthrough file it can't read, and runs nothing":** a file with a page off the site. The `UsageError` from Task 2, and no run folder.

  In `test/cli.test.ts`, "repeats a run from its walkthrough file, with the replay driver":
  - `walkthrough` from a replayed run;
  - then `--walkthrough <file> --replay-from <same folder>`;
  - it exits 0, and its `run.json` names the walkthrough as its source.
- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/run-walkthrough.test.ts test/cli.test.ts`. Expected: FAIL, there's no `walkthrough` option.
- [ ] **Step 3: Implement it** in `runAudit`, `resolvePages`, and the CLI. Refuse the conflicting options first, before the readiness check or any folder is touched.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Repeat a run from its walkthrough file with --walkthrough"`.

### Task 6: After a repeat, each page against the original

**Files:**
- Modify: `src/share/walkthrough.ts`, `src/run/audit.ts`, `.github/workflows/ci.yml`
- Test: `test/share-walkthrough.test.ts`, `test/run-walkthrough.test.ts`

**Interfaces:**
- Produces, in `src/share/walkthrough.ts`:
  ```ts
  export type PageComparison =
    | { url: string; result: "same" }
    | { url: string; result: "different"; passes: PassName[] }
    | { url: string; result: "not-read-originally" }
    | { url: string; result: "not-read-now" };
  export interface WalkthroughComparison {
    original: string;
    pages: PageComparison[];
    /** "NVDA 2026.3 (was 2026.2)", each version that differs; empty when none does. */
    versions: string[];
    /** The NVDA settings whose values differ from the original's, by name. */
    nvdaSettings: string[];
  }
  /** The repeat, page by page, against the original's fingerprints. Pure. */
  export function compareWithOriginal(walkthrough: Walkthrough, repeat: RunJson): WalkthroughComparison;
  export function comparisonLines(comparison: WalkthroughComparison): string[];
  ```
- **The lines,** exactly:
  - `Compared with run <original>, from its walkthrough file:`
  - then a line for each page, two spaces in:
    - `  <url>: sounds the same`
    - `  <url>: sounds different (headings, tab)`, naming each pass whose fingerprint differs, in the passes' order
    - `  <url>: wasn't read in the original`
    - `  <url>: couldn't be read now`
  - then `<same> of <total> pages sound the same.`, with `<total>` every page of the file;
  - then, when any version differs: `Different from the original: NVDA 2026.3 (was 2026.2), Chrome 155.0 (was 154.0), voicecap 0.8.0 (was 0.7.0).`, naming only those that differ;
  - then, when the NVDA settings differ: `NVDA's settings here differ from the original's in: speech.rate, speech.pitch.`
- **What counts:**
  - a page "sounds the same" only when the original and the repeat both read it, and every pass's `contentSha256` is equal;
  - a page the repeat failed or skipped is "couldn't be read now" (Review Focus 2);
  - a page the original didn't read, but the repeat did, is "wasn't read in the original".
- **When it's said:** `runAudit` logs these lines after `Run <id> complete. Report: <path>`, for a walkthrough run that completes. An interrupted one says nothing yet; it says them once a later session completes it.

- [ ] **Step 1: Write the failing tests.**
  - In `test/share-walkthrough.test.ts`, `compareWithOriginal` on runs built with `shareRun`: one test for each result; one for "sounds different" naming only the passes that differ; and one for the versions and NVDA settings lines. `comparisonLines` gives the exact lines above.
  - In `test/run-walkthrough.test.ts`, with the scripted driver:
    - **"says, page by page, how the repeat sounds against the original":**
      - repeat a run with the script unchanged: every page "sounds the same", and `7 of 7 pages sound the same.`;
      - change one page's script: that page says `sounds different (read)`;
      - make one page fail: it says `couldn't be read now`.
    - **"says nothing more for a repeat that didn't complete".**
- [ ] **Step 2: Run them, and see them fail.** Expected: FAIL, `compareWithOriginal` doesn't exist.
- [ ] **Step 3: Implement it,** and in `ci.yml`'s smoke test, after `verify`, add:
  ```bash
  node dist/cli.js walkthrough --out "$out" --site http://127.0.0.1:4747 "$RUNNER_TEMP/walkthrough.json"
  node dist/cli.js --walkthrough "$RUNNER_TEMP/walkthrough.json" --replay-from fixture/replay-run --out "$out" | tee repeat.txt
  grep -q "pages sound the same." repeat.txt
  ```
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Say, after a repeat, how each page sounds against the original"`.

### Task 7: The page offers each run's walkthrough file, and the Word copy says how to get it

**Files:**
- Modify: `src/share/run-evidence.ts`, `src/share/html/evidence.ts`, `src/share/word/evidence.ts`, `src/share/text.ts`
- Test: `test/share-html-evidence.test.ts`, `test/share-word-evidence.test.ts`, `test/share-document.test.ts`, `test/share-model.test.ts`, `test/share-words.test.ts`

**Interfaces:**
- Consumes: `walkthroughOf`, `walkthroughJson` (Task 2).
- Produces: `RunEvidence.walkthrough: { fileName: string; base64: string; bytes: number; get: string; repeat: string }`, where:
  - `fileName` is `<the site folder's name>_<run id>_walkthrough.json`, e.g. `127.0.0.1_4848_2026-09-29_1402_walkthrough.json`, with the folder named as `siteFolder` names it;
  - `base64` is the file's bytes in base64;
  - `bytes` is its size;
  - `get` is `npx @icjia/voicecap walkthrough --site <site> --run <id> <fileName>`;
  - `repeat` is `npx @icjia/voicecap --walkthrough <fileName>`.
- **Fixed words** (in `text.ts`):
  - `EVIDENCE_TEXT.parts.walkthrough`: `"Walkthrough file"`.
  - `EVIDENCE_TEXT.walkthrough`:
    - `lead`: "To repeat this run exactly, with the same pages in the same order and the same passes and limits, download its walkthrough file, then run:";
    - `download(size)`: "Download the walkthrough file (<size>)", where the size is in words as `sizeLine` gives it (src/share/share.ts), without the bytes;
    - `promise`: "A repeat reads the same pages the same way, but can't promise the same words: a changed site, or a newer screen reader or browser, changes what's said. After a repeat, voicecap says page by page whether each sounds the same.".
  - `WORD_TEXT.evidence.walkthrough`: `lead`: "To repeat this run exactly, with the same pages in the same order and the same passes and limits, get its walkthrough file from the web page, or with:", then `then`: "then run:". `promise` is the page's.
- **Where it goes:**
  - On the page, it's a fifth part of each run's fold, after the fingerprints, made with `runPart`:
    - the lead;
    - a paragraph with `<a download="<fileName>" href="data:application/json;base64,<base64>">` holding the download's words;
    - `verifyBox`'s fixed-width box with `repeat`;
    - `promise`.
  - In the Word copy, it's a fifth heading 3, `"Walkthrough file in run <id>"`, holding the lead, `get` as a fixed-width block, `then`, `repeat` as a fixed-width block, and `promise`.

- [ ] **Step 1: Write the failing tests.**
  - **"offers each counted run's walkthrough file, carried in the page":** for the demo model, each run's fold has exactly one `a[download]`.
    - Its `download` is the `fileName`.
    - Its `href` starts with `data:application/json;base64,`.
    - Decoded, it equals `walkthroughJson(walkthroughOf(run))`, byte for byte.
    - It's followed by the repeat command.
  - **The page's link rule:** in `test/share-document.test.ts`, the test that allows only `LINKS_OUT` now also allows an `href` starting `data:application/json;base64,` on an `<a>` with a `download` attribute ending `_walkthrough.json`, and only that. Add a check that a `data:` link without `download`, or of another type, still fails.
  - **The Word copy:** "says how to get each run's walkthrough file, and how to repeat it": each run's fifth heading 3, and its two commands as fixed-width blocks. It has no `data:` link, and its links are still the four.
  - **The page passes axe,** and reflows at 320 px with the new part open. Extend the existing axe and reflow tests' models; add no new browser test file.
  - **"adds a measured amount for a large site"** (Review Focus 5): a 400-page, 3-run model. The page with downloads is at most the page without them plus 1.5 times the three files' total base64 size. Report the measured numbers in the task's report.
  - **Every fixed word is in `text.ts`:** the phrase walk of the page's evidence (as plan 3's Task 8 did) finds the new part's words in the Word copy, except the download link's words. The Word copy says how to get the file instead.
- [ ] **Step 2: Run them, and see them fail.** Expected: FAIL.
- [ ] **Step 3: Implement it.** The page's output changes only by the new part. Rebuild the demo with `pnpm share:fixture <dir>`, and check that the only difference is the five new parts' markup.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Offer each run's walkthrough file on the page, and say how to get it in the Word copy"`.

### Task 8: The docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `src/share/text.ts` (the timeline), `docs/phase-c-handoff.md`
- Test: `test/share-text.test.ts`

**What to write:**
- **`README.md`.** Keep its form: one paragraph to a line, long sections folded, every heading outside a fold.
  - A section, "Repeating a run: the walkthrough file", covering:
    - `voicecap walkthrough` and what the file holds;
    - `--walkthrough` and what it refuses alongside it;
    - what a repeat says afterwards, and what it can't promise;
    - that the shareable page offers each run's file, and the Word copy says how to get it;
    - that NVDA's settings and the browser are this computer's (decision 1).
  - "Commands and options": the command, and the option.
  - "The shareable page": the fifth part of each run's evidence.
  - "Programmatic API": `writeWalkthrough`, `parseWalkthrough`, `walkthroughOf`, and `runAudit`'s `walkthrough`.
- **`CHANGELOG.md`, `[Unreleased]`:**
  - Added: the walkthrough file, `voicecap walkthrough`, `--walkthrough`, the comparison after a repeat, the page's downloads, and the API.
  - Changed: runs record their readiness settings, and a run left incomplete by 0.7.0 starts again, not resumed (decision 2).
- **The timeline** (`TIMELINE`), for the owner's review:
  - a row dated the day this merges, `release: null`, across both tracks: `The walkthrough file: <code>voicecap walkthrough</code> writes a run's recipe, and <code>--walkthrough</code> repeats the run exactly, then says page by page how it sounds against the original.`;
  - the "Next" row's Windows PC cell becomes: `A website of the shared reports.`
- **`docs/phase-c-handoff.md`:** under "Being built", plan 4 merged, and the test count. For the Mac: a walkthrough repeats with NVDA today, and with VoiceOver once its driver exists.

- [ ] **Step 1: Write the failing test.** In `test/share-text.test.ts`, the last row is "Next", with the PC cell above. The row before it has `release: null` and the sentence above.
- [ ] **Step 2: Run it, and see it fail.** Run: `pnpm exec vitest run test/share-text.test.ts`. Expected: FAIL on the old "Next" row.
- [ ] **Step 3: Write the docs and the timeline.**
- [ ] **Step 4: Check the README:** its `<details>` balanced and never nested, no heading inside one, and every in-page link landing.
- [ ] **Step 5: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 6: Commit:** `git commit -m "Document the walkthrough file"`.

## For the owner, once it's built

No screen reader is needed for any of this:

1. `pnpm share:fixture <a folder>` writes the demo's page. Open it, open a run's evidence, and download its walkthrough file.
2. `node dist/cli.js walkthrough --out C:\Users\cschw\voicecap-check C:\Users\cschw\walkthrough.json` writes the check run's file, and says how to repeat it.
3. Read the new fixed text: the page's walkthrough part, the Word copy's, the comparison's lines, and the timeline's row.
4. A real repeat with NVDA, when you choose, with the usual warning: hands off the keyboard and mouse, Do Not Disturb on, the screen awake and unlocked. Run `npx @icjia/voicecap --walkthrough C:\Users\cschw\walkthrough.json --out C:\Users\cschw\voicecap-check`. It should end with each page's comparison.

## Not in this plan

- **The website** (plan 5), which lists each report's walkthrough file as a download of its own.
- **The evidence recorded at the PC** (plan 6).
- **Storing the comparison** in the repeat's record, or showing it on the page (decision 7).
- **VoiceOver repeats** (Phase C). A walkthrough already records the original's screen reader.
