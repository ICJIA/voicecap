# The Audit Record Implementation Plan

**Goal:** Every automatic run and manual session lands in `<home>/<site>/<date>/<its own folder>/`, the home comes from `--out`, `VOICECAP_TRANSCRIPTS`, or `transcripts/`, nothing voicecap records is ever deleted or rewritten, and `voicecap verify` shows whether anything recorded has changed since.

**Architecture:** Every internal function that takes an `outDir` keeps doing so, but `outDir` now means the site's folder inside the home. The home and site folder are worked out once at each entry point (`runAudit`, `addReview`, `addManualSession`, the `report` command). First every command moves into the site folder, keeping the old run and manual layout inside it; then runs and manual sessions move into dated folders, a retried page's earlier attempt is moved aside instead of deleted, and the home gets `.gitattributes` and `.gitignore`.

**Tech Stack:** TypeScript 6 (ESM), Node ≥22.19, vitest, commander. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-27-audit-record-design.md`

## Global Constraints

- The home, in order: `--out <dir>`, then `VOICECAP_TRANSCRIPTS`, then `transcripts` (resolved against the working folder).
- Site folder: host name, plus `_<port>` when the URL has one, lowercased, every character outside `a-z 0-9 . -` replaced by `_`.
- Run ids keep their format (`2026-09-27_1102`, `2026-09-27_1530_before-redesign`, `2026-09-27_1102-2`); a run's folder is `<site>/<first 10 characters>/<the rest after the underscore>`.
- Manual session folder: `<site>/<date>/<HHMM>_manual_<slug>` plus `-2`, `-3` for a taken name; files `session.json`, `session.txt`, `raw/<format>.txt`.
- Nothing recorded is deleted or rewritten: completed runs stay sealed, reviews stay append-only, manual sessions never overwrite, retried pages keep earlier attempts, 0.2.0-layout folders are left alone.
- `.gitattributes` (the current content) and `.gitignore` (`.voicecap.lock` and `**/*_manual_*/raw/`) are written at the home's top when missing and never overwritten.
- voicecap never runs Git (tests may call `git check-ignore`).
- Seal: the SHA-256 of a record's canonical JSON (`hashJson`, keys sorted) without its `seal` field. Sealed records: a completed run's `run.json`, each manual session's `session.json`, and each review entry, which also carries `seq` (1, 2, … across the file, in the order added) and `prev` (the previous entry's seal, null for the first).
- `voicecap verify` exits 0 when everything matches and 3 when anything doesn't.
- Every task ends with `pnpm test` and `pnpm typecheck` passing: a function is removed only in the task that moves its last caller.
- The owner commits and pushes only when they say so: tasks end with a full test run, not a commit.
- Copy follows the codebase: plain English, short sentences, "you".

## Review Focus

- A home path with a space or accented letters (`C:\Users\Jané Doe\code\voicecap-transcripts`) must work end to end — test in Task 2.
- Two runs of one site started in the same minute go to `<date>/1102/` and `<date>/1102-2/`, and resume picks the unfinished one — test in Task 3.
- A run that passes midnight stays in the folder of the day it started (its id is fixed at the start) — test in Task 3.
- `VOICECAP_TRANSCRIPTS` given relative, or ending in `/` or `\`, resolves against the working folder and normalizes — test in Task 1.
- `https://WWW.Example.gov` and `https://www.example.gov/x` share one site folder, `www.example.gov` — test in Task 1.

---

### Task 1: The home, site folders, and dated-path helpers

**Files:**
- Modify: `src/run/paths.ts` (add the functions below; leave `runDir`, `runsDir`, `manualRoot`, `manualPageDir`, and the layout comment as they are: Tasks 3, 6, and 7 change them when their callers move)
- Test: `test/paths.test.ts` (create)

**Interfaces:**
- Produces:
  - `siteFolder(site: string | URL): string`
  - `resolveHome(options: { out?: string | null; env?: NodeJS.ProcessEnv; cwd: string }): string` (absolute)
  - `siteDirFor(home: string, site: string | URL): string` = `path.join(home, siteFolder(site))`
  - `DATE_FOLDER: RegExp` = `/^\d{4}-\d{2}-\d{2}$/`
  - `attemptsDir(siteDir: string, runId: string, slug: string): string` = `path.join(runDir(siteDir, runId), "attempts", slug)`
  - `manualSessionDir(siteDir: string, sessionId: string, slug: string): string`

- [ ] **Step 1: Write the failing tests** in `test/paths.test.ts`:

```ts
it("names a site's folder after its host", () => {
  expect(siteFolder("https://dvfr.illinois.gov")).toBe("dvfr.illinois.gov");
  expect(siteFolder("http://127.0.0.1:4747/")).toBe("127.0.0.1_4747");
  expect(siteFolder("https://WWW.Example.gov/news/")).toBe("www.example.gov");
  expect(siteFolder(new URL("https://www.example.gov/x"))).toBe("www.example.gov");
});
it("takes the home from --out, then VOICECAP_TRANSCRIPTS, then transcripts", () => {
  const cwd = path.resolve("/work");
  expect(resolveHome({ out: "records", env: { VOICECAP_TRANSCRIPTS: "/elsewhere" }, cwd })).toBe(path.join(cwd, "records"));
  expect(resolveHome({ env: { VOICECAP_TRANSCRIPTS: "vt/" }, cwd })).toBe(path.join(cwd, "vt"));
  expect(resolveHome({ env: {}, cwd })).toBe(path.join(cwd, "transcripts"));
  expect(resolveHome({ env: { VOICECAP_TRANSCRIPTS: "  " }, cwd })).toBe(path.join(cwd, "transcripts"));
});
it("puts a manual session in its date's folder, named by time, _manual_, and page", () => {
  const site = path.join("home", "dvfr.illinois.gov");
  expect(manualSessionDir(site, "2026-09-27_1415", "faq")).toBe(path.join(site, "2026-09-27", "1415_manual_faq"));
  expect(manualSessionDir(site, "2026-09-27_1415-2", "faq")).toBe(path.join(site, "2026-09-27", "1415_manual_faq-2"));
});
it("keeps a page's earlier attempts in its run's folder", () => {
  const site = path.join("home", "dvfr.illinois.gov");
  expect(attemptsDir(site, "2026-09-27_1102", "faq")).toBe(path.join(runDir(site, "2026-09-27_1102"), "attempts", "faq"));
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run test/paths.test.ts` — expect FAIL (functions not exported).

- [ ] **Step 3: Implement** in `src/run/paths.ts`. `resolveHome` ignores a blank `VOICECAP_TRANSCRIPTS`; `path.resolve` normalizes trailing separators. `manualSessionDir` splits the id into date, time, and an optional `-n` suffix and puts the suffix after the slug.

- [ ] **Step 4: Run** `pnpm exec vitest run test/paths.test.ts`, then `pnpm test && pnpm typecheck` — expect PASS/clean.

---

### Task 2: One folder per site, for every command

**Files:**
- Create: `src/run/site-dir.ts`
- Modify: `src/run/audit.ts` (`RunAuditOptions.env`; the home, and `outDir = siteDirFor(home, site)`; `ensureGitattributes(home)`, so the file stays at the home's top; `RunAuditResult.siteDir` and `runDir`), `src/reviews/review.ts` and `src/manual-add.ts` (the home and the site folder; a `site` option), `src/cli/main.ts` (`--out` without a commander default and with the help "transcripts home (default: VOICECAP_TRANSCRIPTS, else ./transcripts)" on the run, `review`, `manual add`, and `report`; `--site <url>` on `review`, `manual add`, and `report`; pass `ctx.env`), `src/index.ts` (types only), `scripts/capture-fixture.ts` (use `result.runDir` instead of `path.join(work, "transcripts", "runs", result.runId)`)
- Test: `test/site-dir.test.ts` (create); new cases in `test/run.test.ts` and `test/cli.test.ts`; update tests that look for output directly in the home to look in its site folder (`test/run.test.ts`'s `outDir` helper at line 109 and `replayFrom` at line 491, `test/replay.test.ts`, `test/cli.test.ts`, and any others the suite shows)

**Interfaces:**
- Consumes: Task 1's `resolveHome`, `siteDirFor`, `siteFolder`.
- Produces:
  - `RunAuditOptions.env?: NodeJS.ProcessEnv` (default `process.env`); `RunAuditOptions.out` now names the home.
  - `RunAuditResult.siteDir: string` and `RunAuditResult.runDir: string` (absolute).
  - `chooseSiteDir(options: { home: string; site?: string | null; page?: string | null }): Promise<string>` — `--site` wins; else a full `http(s)` page URL's host; else the only site folder in the home (a folder that isn't `runs`, `manual`, or `compare` and doesn't start with `.`); else `UsageError`.
  - `AddReviewOptions.site?: string | null`, `AddManualSessionOptions.site?: string | null`.
  - Inside the site folder, runs stay at `runs/<id>/` and manual sessions at `manual/<slug>/` until Tasks 3 and 6.
  - Copy: several site folders → `<home's folder name> has dvfr.illinois.gov and i2i.illinois.gov: add --site, or give --page as a full URL.` (`report`, which has no `--page`: `…: add --site.`; three or more are listed `a, b, and c`); an empty home → `<home> has no site folders yet: run voicecap on the site first, or add --site.`

- [ ] **Step 1: Write the failing tests:**
  - `test/site-dir.test.ts`: `"uses --site first"`; `"takes the site from a full page URL"` (`https://dvfr.illinois.gov/faq/` → `<home>/dvfr.illinois.gov`, even before that folder exists); `"uses the only site folder when a path is given"`; `"names the sites when it can't tell which one"` (a home with `dvfr.illinois.gov/` and `i2i.illinois.gov/`, `page: "/faq/"` → `UsageError` containing `dvfr.illinois.gov and i2i.illinois.gov` and `--site`); `"says there's nothing yet in an empty home"` → the empty-home copy.
  - `test/run.test.ts`: `"puts a run in the site's folder in the home"`: `result.siteDir === path.join(home, siteFolder(SITE))` and `existsSync(path.join(result.runDir, "run.json"))`; `"takes the home from VOICECAP_TRANSCRIPTS when there's no --out"`: `env: { VOICECAP_TRANSCRIPTS: home }`, no `out`; `"works in a home whose path has a space and an accent"`: home `path.join(tmp, "Jané Doe", "voicecap-transcripts")`, the run completes and `run.json` is where expected.
  - `test/cli.test.ts`: after a replay run of `http://127.0.0.1:4747` (the file's full-session pattern) and an empty `dvfr.illinois.gov/` folder in the home, `review --page /flawed/ --status issue` exits 1 naming both sites; with `--site http://127.0.0.1:4747` it records the review in `transcripts/127.0.0.1_4747/reviews.json`.

- [ ] **Step 2: Run** `pnpm exec vitest run test/site-dir.test.ts test/run.test.ts test/cli.test.ts` — expect the new cases to FAIL.

- [ ] **Step 3: Implement.** `runAudit` computes `home = resolveHome({ out: options.out, env: options.env ?? process.env, cwd })` and `outDir = siteDirFor(home, site)`, and returns `siteDir` and `runDir` (`runDir(outDir, run.id)`). `addReview`, `addManualSession`, and the `report` command compute the home the same way and the site folder with `chooseSiteDir({ home, site, page })` (`report`: no page), and use the site folder where they used `out` before.

- [ ] **Step 4: Update the tests** that expected output directly in the home (see Files), then run `pnpm test && pnpm typecheck && pnpm lint` — expect PASS/clean.

---

### Task 3: Runs in dated folders

**Files:**
- Modify: `src/run/paths.ts` (`runDir` maps a run id to its dated folder; delete `runsDir`), `src/run/run-id.ts` (`allocateRunId`), `src/run/store.ts` (`listRuns`; the error in `readRunJson`), `src/report/compare.ts:255` (the diff path relative to the site folder)
- Test: `test/paths.test.ts`, new cases in `test/run.test.ts`; update tests that build run paths by hand (`test/store.test.ts`, `test/replay.test.ts`, `test/helpers/report-data.ts`, and any others the suite shows)

**Interfaces:**
- Consumes: Task 1's `DATE_FOLDER`; Task 2's `RunAuditResult.runDir`.
- Produces: `runDir(siteDir: string, runId: string): string` = `<siteDir>/<first 10 characters>/<the rest after the underscore>` (`runJsonPath`, `runReportPath`, `pageDir`, `runCompareDir` built on it, signatures unchanged); `listRuns(siteDir)` and `allocateRunId(siteDir, now, name)` keep their signatures.

- [ ] **Step 1: Write the failing tests:**
  - `test/paths.test.ts`: `"puts a run in its date's folder"`: for `site = path.join("home", "dvfr.illinois.gov")`, `runDir(site, "2026-09-27_1102")` → `path.join(site, "2026-09-27", "1102")`; `"2026-09-27_1530_before-redesign"` → `path.join(site, "2026-09-27", "1530_before-redesign")`; `"2026-09-27_1102-2"` → `path.join(site, "2026-09-27", "1102-2")`.
  - `test/run.test.ts`: `"puts a run in <site>/<date>/<time>/"`: with `now: () => new Date(2026, 8, 27, 11, 2)`, `result.runDir === path.join(home, siteFolder(SITE), "2026-09-27", "1102")`.
  - `"gives a second run in the same minute its own folder, and resumes the unfinished one"`: with `now` fixed at 11:02, a first run completes in `2026-09-27/1102/`; a second is interrupted (the file's `signal` pattern) in `2026-09-27/1102-2/`; a third resumes it (`result.runId` is `2026-09-27_1102-2`) and completes it. (`chooseRun` resumes the newest incomplete run with matching settings.)
  - `"keeps a run that passes midnight in the folder of the day it started"`: `now` returns 23:59 on 2026-09-27 for the start and 00:01 on 2026-09-28 afterwards; every page folder is under `2026-09-27/2359/`.
  - `"finds the previous run of the same site for --compare previous"`: two runs of the site; the second, with `compare: "previous"`, compares with the first.

- [ ] **Step 2: Run** `pnpm exec vitest run test/paths.test.ts test/run.test.ts` — expect the new cases to FAIL.

- [ ] **Step 3: Implement.** `allocateRunId` creates `<siteDir>/<date>/` and claims `<rest>` with `mkdir` (as now: `-2`, `-3` on `EEXIST`). `listRuns` reads each `DATE_FOLDER` child of the site folder and each folder inside it that has a readable `run.json` (others, such as manual sessions later, are skipped), sorted by id as now. `compare.ts` makes its diff path relative to the site folder. Delete `runsDir`.

- [ ] **Step 4: Update** the tests that build run paths by hand to use `runDir`, then run `pnpm test && pnpm typecheck` — expect PASS/clean.

---

### Task 4: Keep a retried page's earlier attempt

**Files:**
- Create: `src/run/attempts.ts`
- Modify: `src/run/page-runner.ts:113-115` (the `rm` before an attempt)
- Test: `test/attempts.test.ts` (create), a case in `test/run.test.ts`

**Interfaces:**
- Consumes: Task 1's `attemptsDir`; `pageDir`.
- Produces: `keepEarlierAttempt(siteDir: string, runId: string, slug: string): Promise<string | null>` — moves the page's folder to `attempts/<slug>/<n>/` (first free `n` from 1) when it exists and holds anything; returns the new path, or null when there was nothing to keep.

- [ ] **Step 1: Write the failing tests:**
  - `test/attempts.test.ts`: `"moves an earlier attempt aside instead of deleting it"` — write `pages/faq/read.txt`, call `keepEarlierAttempt`; expect `attempts/faq/1/read.txt` to exist with the same content and `pages/faq` gone; call again after writing a new `pages/faq/read.txt` → `attempts/faq/2/`. `"does nothing for a page that has no folder yet"` → returns null.
  - `test/run.test.ts`: `"keeps the first attempt at a page that timed out, and reports only the final one"` — the file's timeout-retry pattern (line 235); expect `attempts/<slug>/1/` in the run folder, the page `done`, and the page record's `files` naming only `pages/<slug>/…` files.

- [ ] **Step 2: Run** `pnpm exec vitest run test/attempts.test.ts test/run.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** `keepEarlierAttempt` with `fs.rename` (same volume), retrying on the codes `src/util/atomic-write.ts` retries (`EPERM`, `EBUSY`, `EACCES`) on Windows. In `page-runner.ts`, call it where the folder is now removed.

- [ ] **Step 4: Run** the two test files, then `pnpm test` — expect PASS.

---

### Task 5: Git-safe home, and the note about 0.2.0's layout

**Files:**
- Create: `src/run/git-files.ts`
- Modify: `src/run/audit.ts` (replace `ensureGitattributes` and its constant; add the note), `src/reviews/review.ts`, `src/manual-add.ts` (call `ensureGitFiles(home)`)
- Test: `test/git-files.test.ts` (create), a case in `test/run.test.ts`

**Interfaces:**
- Produces: `ensureGitFiles(home: string): Promise<void>`; `GITIGNORE: string` exactly:

```
# Written by voicecap. Keep these out of Git:
# the lock a run holds while it writes,
.voicecap.lock
# and raw NVDA logs, which can hold typed passwords (their SHA-256 stays in session.json).
**/*_manual_*/raw/
```

- [ ] **Step 1: Write the failing tests** in `test/git-files.test.ts`:
  - `"writes .gitattributes and .gitignore at the home's top"`: both exist; `.gitattributes` has the current content; `.gitignore` equals `GITIGNORE`.
  - `"never overwrites them"`: pre-write `.gitignore` with `"mine\n"`; after `ensureGitFiles`, it's still `"mine\n"`.
  - `it.skipIf(!gitAvailable)("keeps raw NVDA logs and the run lock out of Git")`: `git init` in a temp home, `ensureGitFiles`, then `git check-ignore -q dvfr.illinois.gov/2026-09-27/1415_manual_faq/raw/nvda-log.txt` and `dvfr.illinois.gov/.voicecap.lock` exit 0, and `dvfr.illinois.gov/2026-09-27/1102/run.json` exits 1.
  - In `test/run.test.ts`: `"leaves 0.2.0-layout folders alone, and says so once"`: a home with `runs/2026-09-26_1405/run.json` and `manual/home/2026-09-26_1405.json`; after a run, both files are unchanged and the log has exactly one line naming `runs/` and `manual/`.

- [ ] **Step 2: Run** both files — expect FAIL.

- [ ] **Step 3: Implement.** `ensureGitFiles` writes each file with flag `"wx"` and ignores `EEXIST`. `runAudit`, `addReview`, and `addManualSession` call it with the home. `runAudit` logs one line when `<home>/runs` or `<home>/manual` exists, naming the ones that do: `"<home> has voicecap 0.2.0's runs/ and manual/ folders. They aren't read any more, and they're left as they are."` (`runs/ folder`, `It isn't`, and `it's` when there's one.)

- [ ] **Step 4: Run** both files, then `pnpm test` — expect PASS.

---

### Task 6: Manual sessions in dated folders

**Files:**
- Modify: `src/run/paths.ts` (delete `manualRoot` and `manualPageDir`), `src/manual/import.ts` (replace `uniqueSessionId`; file names; raw path), `src/manual/list.ts` (scan the dated folders)
- Test: `test/manual.test.ts`, `test/cli.test.ts:187` (update layout assumptions), new cases in `test/manual.test.ts`

**Interfaces:**
- Consumes: Task 1's `manualSessionDir`, `DATE_FOLDER`; Task 2's site folder for `manual add`.
- Produces:
  - `allocateManualSession(siteDir: string, baseId: string, slug: string): { id: string; dir: string }` — `id` is `baseId`, or `baseId-2`, `-3`… when `manualSessionDir(siteDir, id, slug)` exists.
  - `listManualSessions(siteDir)` keeps its signature and return type; `jsonPath`, `txtPath`, `rawPath` are relative to the site folder with forward slashes (`2026-09-27/1415_manual_faq/session.json`).
  - `ManualSessionJson.input.raw.path` becomes `raw/<format>.txt` (relative to the session's folder).

- [ ] **Step 1: Write the failing tests** in `test/manual.test.ts`, giving the page as the full URL `http://127.0.0.1:4747/`:
  - `"puts a session in its date's folder under the site"`: import the fixture NVDA log with `date: "2026-09-27"`; expect `session.json`, `session.txt`, `raw/nvda-log.txt` under `<home>/127.0.0.1_4747/2026-09-27/<HHMM>_manual_home/`.
  - `"gives a second import of the same session its own folder"`: import twice → `…_manual_home` and `…_manual_home-2`; neither file of the first changed (compare bytes).
  - `"lists sessions from the dated folders for the report"`: `listManualSessions(siteDir)` returns both, with site-relative forward-slash paths.

- [ ] **Step 2: Run** `pnpm exec vitest run test/manual.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** as the interfaces say; delete `manualRoot` and `manualPageDir` once nothing calls them.

- [ ] **Step 4: Update** the remaining manual-layout assumptions (`test/manual.test.ts`, `test/cli.test.ts:187`), then run `pnpm test && pnpm typecheck` — expect PASS/clean.

---

### Task 7: Seals on runs, manual sessions, and reviews

**Files:**
- Modify: `src/util/hash.ts` (add `sealOf`), `src/model.ts` (`RunJson.seal`, `ManualSessionJson.transcript` and `seal`, `ReviewEntry.seq`, `prev`, `seal`), `src/run/audit.ts:407` (seal a run when it completes, after every other field is final), `src/manual/import.ts` (record `session.txt`'s hash and size; seal `session.json`), `src/reviews/store.ts` (`appendReview` sets `seq`, `prev`, and `seal`)
- Test: `test/seal.test.ts` (create), cases in `test/run.test.ts`, `test/manual.test.ts`, `test/reviews.test.ts`

**Interfaces:**
- Produces:
  - `sealOf(record: object): string` — `hashJson` of the record without its `seal` key.
  - `RunJson.seal?: string` — set once, when the run completes; absent while it's incomplete.
  - `ManualSessionJson.transcript?: FileHash` (`session.txt`'s `sha256` and `bytes`) and `ManualSessionJson.seal?: string`.
  - `ReviewEntry.seq?: number` (1 + the highest `seq` in the file, 0 when there's none), `ReviewEntry.prev?: string | null` (the seal of the entry with the highest `seq`, null when there's none), `ReviewEntry.seal?: string`.
  - The fields are optional in the types because records written before this change lack them; everything voicecap writes from now on has them.

- [ ] **Step 1: Write the failing tests:**
  - `test/seal.test.ts`: `sealOf({ b: 1, a: 2, seal: "x" })` equals `sealOf({ a: 2, b: 1 })` (key order and the seal field don't matter); changing any value changes it.
  - `test/run.test.ts`: `"seals a run when it completes"`: a completed run's `run.seal === sealOf(run)`; an interrupted run (the file's `signal` pattern) has no seal until it's resumed and completes.
  - `test/manual.test.ts`: `"records the transcript's hash and seals the session"`: `session.transcript.sha256` is the SHA-256 of `session.txt`'s bytes, and `session.seal === sealOf(session)`.
  - `test/reviews.test.ts`: `"chains review entries across pages"`: three appends (page A, page B, page A) → `seq` 1, 2, 3; `prev` null, then the first entry's seal, then the second's; each `seal === sealOf(entry)`.

- [ ] **Step 2: Run** `pnpm exec vitest run test/seal.test.ts test/run.test.ts test/manual.test.ts test/reviews.test.ts` — expect the new cases to FAIL.

- [ ] **Step 3: Implement.** The run's seal is computed last, just before the completing `writeRunJson`; nothing may write a completed run's `run.json` after that. `appendReview` computes `seq`, `prev`, and `seal` from the file it just re-read, inside its existing checks.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` — expect PASS/clean.

---

### Task 8: `voicecap verify`

**Files:**
- Create: `src/verify.ts`
- Modify: `src/run/site-dir.ts` (export the listing of a home's site folders, if Task 2 kept it private), `src/cli/main.ts` (the `verify` command: `--site <url>`, and `--out <dir>` as the other commands have it), `src/index.ts` (export `verifyHome` and its types, as the other commands' functions are)
- Test: `test/verify.test.ts` (create), cases in `test/cli.test.ts`

**Interfaces:**
- Consumes: Task 7's `sealOf` and sealed fields; Task 2's `resolveHome` and site folders; Task 3's `listRuns`; Task 6's `listManualSessions`; the reviews reader in `src/reviews/store.ts`.
- Produces:
  - `verifyHome(options: { home: string; site?: string | null; logger: Logger }): Promise<VerifyResult>`
  - `interface VerifyResult { sites: { folder: string; runs: number; incomplete: number; manualSessions: number; reviews: number; problems: string[] }[]; problems: number }`
  - Checks, per the spec's "Checking the record": each completed run's seal and every file it records in `pages/` (SHA-256 and size), plus files in `pages/` it doesn't record; each manual session's seal, `session.txt`, and its raw copy when present (a missing raw copy isn't a problem); `reviews.json`'s seals, `seq` running 1, 2, … with no gaps, and `prev`, plus each page's entries in increasing `seq` and each entry's `canonicalKey(url)` equal to the key it's filed under (a seal doesn't cover where an entry is filed); unsealed records are problems; incomplete runs are counted, not problems.
  - Copy, with paths relative to the home and forward slashes:
    - `<path>: changed since it was recorded (SHA-256 differs)` — a recorded transcript, `session.txt`, or a raw copy
    - `<path>: missing` — a recorded transcript or `session.txt`
    - `<path>: not recorded by the run` — a file in a run's `pages/` that `run.json` doesn't list
    - `<path to run.json or session.json>: changed since it was sealed`
    - `<path>: not sealed (written before voicecap 0.3.0), so it can't be checked` (for a review entry: `<site>/reviews.json: an entry for <page URL> at <at> is not sealed …`)
    - `<site>/reviews.json: entry <seq> (<page URL>) changed since it was recorded`
    - `<site>/reviews.json: entry <n> is missing` (a gap in `seq`), and `<site>/reviews.json: entry <seq> doesn't follow entry <seq - 1>` (a `prev` that doesn't match)
    - `<site>/reviews.json: entry <seq> (<page URL>) is filed under another page (<key>)`, and `<site>/reviews.json: the entries for <page URL> are out of order (entry <a> comes before entry <b>)`
    - after each site's problems: `<site folder>: <n> runs (<i> incomplete), <m> manual sessions, <k> reviews checked: everything matches.` or `…: <p> problems.`

- [ ] **Step 1: Write the failing tests** in `test/verify.test.ts`, on a home built through the real entry points (a completed run, a manual session import, and two reviews of one page, the second `issue`):
  - `"passes a home nobody touched"`: `problems` 0, and the summary says everything matches.
  - `"catches an edited transcript"`: append a line to a recorded `read.txt` → one problem naming it, `changed since it was recorded`.
  - `"catches a missing transcript and an unrecorded file"`: delete a recorded file and add `pages/<slug>/extra.txt` → `missing` and `not recorded by the run`.
  - `"catches an edited run.json"`: change one recorded `sha256` in `run.json` → `changed since it was sealed`.
  - `"catches a changed newest review"`: change the last entry's `status` from `issue` to `reviewed` → `entry 2 (<url>) changed since it was recorded`.
  - `"catches a deleted review"`: remove the first entry → a problem about entry 1.
  - `"catches a review moved to another page, and reviews swapped within a page"`: move the last entry into another page's array → `filed under another page`; swap the two entries of one page → `out of order`.
  - `"catches an edited manual transcript"`: edit `session.txt` → `changed since it was recorded`.
  - `"doesn't mind a raw copy that isn't there"`: delete the session's `raw/` folder → no problem.
  - `"counts unsealed records as problems, and incomplete runs as neither"`: remove `seal` from a completed `run.json` → `not sealed …`; an interrupted run → `incomplete` 1, no problem.
  - `test/cli.test.ts`: `verify` exits 0 on a clean home and 3 after an edit, printing the problem.

- [ ] **Step 2: Run** `pnpm exec vitest run test/verify.test.ts test/cli.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `verifyHome` and the command; with no `--site`, every site folder in the home is checked.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — expect PASS/clean.

---

### Task 9: Documentation, and a look at a real home

**Files:**
- Modify: `README.md` (new "The audit record" section; the output-layout section; `--out` in the options table; `--site` for `review`, `manual add`, `report`; the `verify` command; the API example, where `generateReport({ outDir })` now takes a site folder: `RunAuditResult.siteDir`), `src/run/paths.ts` (the layout comment: the spec's tree), stale layout comments (`src/manual-add.ts:52`, "under manual/<page-slug>/"; `test/store.test.ts:53`; any other comment still naming `runs/<id>` or `manual/<slug>`), `src/cli/main.ts` (help: `verify --help` states its exit codes, 0 everything matches and 3 something doesn't; the root help's "Exit codes" line says what 3 means for `verify`), `CHANGELOG.md` (Unreleased → Added and Changed), `docs/phase-b-handoff.md` (where things are)

- [ ] **Step 1: Write "The audit record"** with the spec's layout tree, the guarantees (sealed runs, append-only reviews, kept attempts, untouched 0.2.0 folders, file hashes in `run.json`), checking the record with `voicecap verify` (what it checks, and what it can't catch alone: someone who recomputes the seals, which Git history pushed to a protected branch covers; no stronger legal claim), what `.gitignore` keeps out and why, and the setup, verbatim values:
  - Windows (Git Bash): `mkdir -p /c/Users/cschw/code/voicecap-transcripts && cd /c/Users/cschw/code/voicecap-transcripts && git init`, then a private GitHub repository for it (for example `gh repo create voicecap-transcripts --private --source .`, which adds the `origin` remote; no `--push`, since there's nothing to push yet), then `setx VOICECAP_TRANSCRIPTS 'C:\Users\cschw\code\voicecap-transcripts'` and a new terminal.
  - macOS: the same with `~/webdev/voicecap-transcripts`, and `export VOICECAP_TRANSCRIPTS=~/webdev/voicecap-transcripts` in `~/.zshrc`.
  - After runs: `git add -A && git commit -m "voicecap runs"`, then `git push -u origin HEAD` the first time and `git push` after that; `git commit -S` to sign.
  - Say to keep the repository private (reviewer names, notes, and typed text in manual sessions).

- [ ] **Step 2: Update** the output-layout section and `src/run/paths.ts`'s layout comment to the new tree, and CHANGELOG Unreleased: under Added, `voicecap verify` and the seals and review chain it checks; under Changed, the layout, the home from `VOICECAP_TRANSCRIPTS`, `--site` for `review`/`manual add`/`report`, kept attempts, the Git files, and that 0.2.0's folders are no longer read.

- [ ] **Step 3: Look at a real home.** In a temp folder: `git init`, then `node dist/cli.js --site http://127.0.0.1:4747 --pages fixture/pages.json --replay-from fixture/replay-run --out <temp>` (after `pnpm build`), `node dist/cli.js manual add fixture/manual/nvda-io-log.txt --page http://127.0.0.1:4747/ --out <temp>`, then `git status --short --untracked-files=all` in the temp folder: expect files under `127.0.0.1_4747/<date>/<time>/` and `127.0.0.1_4747/<date>/<time>_manual_home/`, `.gitattributes`, `.gitignore`, and no `raw/` or `.voicecap.lock` path listed. Then `node dist/cli.js verify --out <temp>` exits 0 saying everything matches; after appending a line to one `read.txt`, it exits 3 naming that file.

- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — expect all clean.
