# voicecap init and --page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npx @icjia/voicecap init` (or no arguments in a terminal) asks a few questions and prints a copy-pasteable `npx @icjia/voicecap …` command, offering to run it; runs gain a repeatable `--page <url>` page source; every example in the README and help is a real, checkable one on i2i.illinois.gov or dvfr.illinois.gov.

**Architecture:** A new page source kind, `{ kind: "urls"; urls }`, is added and described everywhere first; `--page` then feeds it through the existing page resolution as entries without line numbers. The tool is four small units under `src/init/` (line prompts, site checks, command composition, the question flow) wired into the CLI; running the composed command goes back through `main()` in the same process.

**Tech Stack:** TypeScript 6 (ESM), Node ≥22.19, `node:readline`, vitest, commander. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-27-voicecap-init-design.md` (built on `docs/superpowers/specs/2026-09-27-audit-record-design.md`; do `docs/superpowers/plans/2026-09-27-audit-record.md` first)

## Global Constraints

- Prompts are plain lines: numbered choices, the default in brackets (`Choose [1]:`), no arrow-key menus, no colors.
- Exit codes: Ctrl+C 130; input that ends early 1; not runnable, or "Run it now?" answered No, 0; a run started from the tool returns the run's own code.
- The printed command always starts `npx @icjia/voicecap`; order `--site`, the page source, `--limit`, `--out`; `--limit` only when set; `--out` only when the home answer differs from the home in effect.
- Quoting: a value is wrapped in single quotes only when it contains a character outside `A-Z a-z 0-9 _ . / : @ % + , = -`; a `'` inside becomes `'\''`; an empty value is written as `''`.
- `--site` is written as the site's origin (no trailing slash); a `--page` is always written as a full URL.
- Sitemap discovery: `robots.txt` `Sitemap:` lines in order, then `/sitemap.xml`; a candidate counts only when it answers with `<urlset` or `<sitemapindex`.
- Network waits: 15 seconds per request in the site checks.
- Tests never use the network: they use a fake `fetch` built from the recorded i2i.illinois.gov and dvfr.illinois.gov responses below.
- Real examples only: i2i.illinois.gov (sitemap `https://i2i.illinois.gov/sitemap-index.xml`, an index pointing to `sitemap-0.xml`, 35 pages; `/about/` doesn't exist) and dvfr.illinois.gov (sitemap `https://dvfr.illinois.gov/sitemap.xml`, a `<urlset>` of 36 pages, with `/about/` and `/faq/`). Both redirect `http://` to `https://`.
- The owner commits and pushes only when they say so: tasks end with a full test run, not a commit.

## Review Focus

- A website answer with spaces and capitals (`  I2I.Illinois.GOV `) becomes `https://i2i.illinois.gov` — test in Task 5.
- A site that times out or answers 403 gets "Use it anyway? [y/N]", not a crash — test in Task 5 (the reasons) and Task 6 (the question).
- `robots.txt` with CRLF line endings, `SITEMAP:` in capitals, or a relative sitemap path still finds the sitemap — test in Task 5.
- A page list path with a space or backslashes is quoted in the printed command — test in Task 3 (`C:\Users\Jane Doe\pages.csv`) and Task 6 (`lists/dvfr pages.csv`).
- `--page` with a query and a fragment (`/faq/?a=1&b=2#top`) keeps the query, drops the fragment, and is quoted for `&` — test in Tasks 2 and 3.

### Recorded responses for the fake fetch

`test/helpers/real-sites.ts` (create in Task 5) exports `realSitesFetch(extra: Record<string, () => Response | Promise<Response>> = {}): typeof fetch`. `extra` answers (or overrides) single URLs, as factories because a body can be read only once:

- `https://i2i.illinois.gov/` and `https://dvfr.illinois.gov/` → 200, a small HTML page.
- `http://i2i.illinois.gov/` and `http://dvfr.illinois.gov/` → the same 200 page as a followed redirect: a `Response` whose `url` is set to the `https://` address with `Object.defineProperty` (a constructed `Response` has an empty `url`).
- `https://i2i.illinois.gov/robots.txt` → 200, ending `Sitemap: https://i2i.illinois.gov/sitemap-index.xml`.
- `https://i2i.illinois.gov/sitemap-index.xml` → 200, `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://i2i.illinois.gov/sitemap-0.xml</loc></sitemap></sitemapindex>`.
- `https://dvfr.illinois.gov/robots.txt` → 200, `User-agent: *\nAllow: /\n\nSitemap: https://dvfr.illinois.gov/sitemap.xml\n`.
- `https://dvfr.illinois.gov/sitemap.xml` → 200, a `<urlset>` with `https://dvfr.illinois.gov/`, `/about/`, `/faq/`.
- Anything else → 404 HTML.

---

### Task 1: The `urls` page source, described everywhere

**Files:**
- Create: `src/pages/describe.ts`
- Modify: `src/model.ts:41-42` (`PageSource`), `src/model.ts:108` (`SourceDetails.kind`), `src/transcripts/format.ts:102-105` (`environmentLines`), `src/report/render.ts:124-127` (summary) and `:171-176` (source details), `src/report/compare.ts:180-191` (`samePageSource`, `describeSource`), `src/run/resume.ts:85-89`, `src/pages/resolve.ts:247` (`baseDetails` kind) and `:259-261` (`describeSource`)
- Test: `test/describe.test.ts` (create), cases in `test/transcripts.test.ts`, `test/report.test.ts`, `test/compare.test.ts`, `test/resume.test.ts`

**Interfaces:**
- Produces:
  - `PageSource` adds `{ kind: "urls"; urls: string[] }` (resolved absolute URLs, fragment dropped, in the order given); `SourceDetails.kind` adds `"urls"`.
  - `describePageUrls(urls: readonly string[]): string` — one URL: `page <url>`; several: `<n> pages (<the first three, ", "-joined>[, …])`.
  - Copy: the TXT header and resume use `describePageUrls`; the report's "Page source" is `describePageUrls` (escaped), and its source details add a `Pages given with --page` row listing every URL; `compare` describes a `urls` run with `describePageUrls` and treats two `urls` runs as the same source when their lists are equal in order; `resolve.ts`'s off-origin warning names the source as `the pages given with --page`.

- [ ] **Step 1: Write the failing tests:**
  - `test/describe.test.ts`: `describePageUrls(["https://dvfr.illinois.gov/faq/"])` → `"page https://dvfr.illinois.gov/faq/"`; three → `"3 pages (https://dvfr.illinois.gov/, https://dvfr.illinois.gov/about/, https://dvfr.illinois.gov/faq/)"`; five → starts `"5 pages ("` and ends `", …)"`.
  - `test/transcripts.test.ts`: `environmentLines` of an environment whose `pageSource` is `{ kind: "urls", urls: ["https://dvfr.illinois.gov/faq/"] }` contains `"Page source: page https://dvfr.illinois.gov/faq/"`.
  - `test/report.test.ts`: a report for a run whose `settings.source` is `urls` with the three dvfr URLs contains `3 pages (https://dvfr.illinois.gov/, https://dvfr.illinois.gov/about/, https://dvfr.illinois.gov/faq/)` and `Pages given with --page`.
  - `test/compare.test.ts` (beside the test at line 211): `previous` resolves to an earlier completed run with the same `urls` list; with a different list it fails with `No earlier completed run with the same page source (page https://dvfr.illinois.gov/faq/)`.
  - `test/resume.test.ts`: `chooseRun` with an incomplete run of `urls` `[A]` and settings `urls` `[A, B]` doesn't resume, and its message contains `page A` and `2 pages (A, B)` (with A and B real dvfr URLs).

- [ ] **Step 2: Run** `pnpm exec vitest run test/describe.test.ts test/transcripts.test.ts test/report.test.ts test/compare.test.ts test/resume.test.ts` — expect the new cases to FAIL.

- [ ] **Step 3: Implement** `describePageUrls` and the `urls` branch in each describer listed under Files.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` — expect PASS/clean.

---

### Task 2: `--page` for runs

**Files:**
- Modify: `src/pages/resolve.ts` (`ResolvePagesOptions`, `pageSourceFor`, `resolvePages`, `requireOneSource`), `src/run/audit.ts` (`RunAuditOptions.pageUrls`; remove its own one-source check, `if (Boolean(options.sitemap) === Boolean(options.pages))` at about line 102, since `pageSourceFor` gives the same messages before any folder is touched; pass `pageUrls` and `site` to both calls), `src/cli/main.ts` (`--page` option, `RunOptions.page`, `checkUrlOptions`)
- Test: `test/resolve.test.ts`, `test/run.test.ts`, `test/cli.test.ts`

**Interfaces:**
- Consumes: Task 1's `urls` page source.
- Produces:
  - `ResolvePagesOptions.pageUrls?: readonly string[]`; `pageSourceFor(options: { sitemap?: string; pagesFile?: string; pageUrls?: readonly string[]; site?: URL; cwd?: string })` (`site` is required with `pageUrls`).
  - `RunAuditOptions.pageUrls?: string[] | null`.
  - Error copy, exactly: none → `Give a page source: --sitemap <url>, --pages <file>, or --page <url>.`; a mix → `Use one kind of page source: --sitemap, --pages, or --page, not a mix.`; an unusable value → `--page "<value>" isn't a page URL or a path like /faq/.`

- [ ] **Step 1: Write the failing tests.** In `test/resolve.test.ts` (its `fetchFrom`, `ORIGIN`, `site`):
  - `"takes pages given with --page, full URLs or paths"`: `pageUrls: ["/duplicates/", `${ORIGIN}/flawed/#top`]` → page URLs `${ORIGIN}/duplicates/` and `${ORIGIN}/flawed/`; `pageSource` `{ kind: "urls", urls: [those two] }`; `source.kind` `"urls"`.
  - `"skips a --page on another site, as page lists do"`: `pageUrls: ["https://dvfr.illinois.gov/faq/", "/"]` → one page; `skipped` `[{ url: "https://dvfr.illinois.gov/faq/", reason: "off-origin" }]`.
  - `"keeps a --page query string and drops its fragment"`: `pageSourceFor({ site, pageUrls: ["/faq/?a=1&b=2#top"] })` → `{ kind: "urls", urls: [`${ORIGIN}/faq/?a=1&b=2`] }`.
  - `"rejects a --page that isn't a page"`: `pageUrls: ["ftp://x/"]` → `UsageError` with the unusable-value copy.
  - `"catches a --page Git Bash rewrote"`: `pageUrls: ["C:/Program Files/Git/faq/"]` → rejects with `/Git Bash rewrote it/`.
  - `"takes one kind of page source"`: a sitemap plus `pageUrls` → `/Use one kind of page source/`; nothing → `/--page <url>/`.
  - Update the assertions on the old copy: `test/resolve.test.ts:271` → `/--page <url>/`, `:274` → `/one kind of page source/`; `test/cli.test.ts:55` → `"Give a page source"`, `:65` → `"one kind of page source"`.

  In `test/run.test.ts` (its `ScriptedDriver` pattern and `SITE`):
  - `"runs the pages given with --page, and tells runs apart by them"`: `pageUrls: [`${SITE}/about`]` and no `pages` → completes with one page; `result.run.settings.source` equals `{ kind: "urls", urls: [`${SITE}/about`] }`; a second run with the same list has the same `run.settingsHash`, and one with `[`${SITE}/resources`]` a different one.

  In `test/cli.test.ts` (its `cli` helper):
  - `"accepts --page more than once"`: `["--site", SITE, "--page", "/", "--page", `${SITE}/duplicates/`, "--replay-from", fixture("replay-run")]` → exit 0, output contains `[2/2]`.

- [ ] **Step 2: Run** `pnpm exec vitest run test/resolve.test.ts test/run.test.ts test/cli.test.ts` — expect the new cases to FAIL.

- [ ] **Step 3: Implement.** One helper resolves the values for both `pageSourceFor` and `resolvePages`: `assertNotRewritten("--page", value)`, then `resolvePageUrl(value, site)`, throwing the unusable-value error for null. `resolvePages` turns the values into entries `{ value, line: null }` for the shared resolution below and records `baseDetails("urls", values.length, [])`. The CLI adds `.option("--page <url>", "take this page: a full URL, or a path like /faq/ (repeatable)", collect, [])` and passes `pageUrls` when it's non-empty; `checkUrlOptions` also checks each `--page`.

- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` — expect PASS/clean.

---

### Task 3: Composing the command

**Files:**
- Create: `src/init/compose.ts`
- Test: `test/init-compose.test.ts` (create)

**Interfaces:**
- Produces:
  - `type PageChoice = { kind: "sitemap"; url: string } | { kind: "pages"; file: string } | { kind: "page"; url: string }`
  - `interface InitAnswers { site: string; pages: PageChoice; limit: number | null; home: string | null }` (`home` null: the home in effect, so no `--out`)
  - `composeArgs(answers: InitAnswers): string[]`
  - `quoteArg(value: string): string`
  - `formatCommand(args: readonly string[]): string` — `"npx @icjia/voicecap " + args.map(quoteArg).join(" ")`

- [ ] **Step 1: Write the failing tests:**
  - `composeArgs({ site: "https://i2i.illinois.gov", pages: { kind: "sitemap", url: "https://i2i.illinois.gov/sitemap-index.xml" }, limit: 5, home: null })` → `["--site", "https://i2i.illinois.gov", "--sitemap", "https://i2i.illinois.gov/sitemap-index.xml", "--limit", "5"]`.
  - A `pages` file with `home: "C:\\Users\\Jane Doe\\vt"` → `--pages <file>`, then `--out <home>` last; a `page` → `--page <url>`; `limit: null` → no `--limit`.
  - `quoteArg`: `"https://dvfr.illinois.gov/faq/"` unchanged; `"https://dvfr.illinois.gov/faq/?a=1&b=2"` → `"'https://dvfr.illinois.gov/faq/?a=1&b=2'"`; `"C:\\Users\\Jane Doe\\pages.csv"` → `"'C:\\Users\\Jane Doe\\pages.csv'"`; `"it's"` → `"'it'\\''s'"`.
  - `formatCommand(composeArgs(<the i2i answers>))` equals the spec's line: `npx @icjia/voicecap --site https://i2i.illinois.gov --sitemap https://i2i.illinois.gov/sitemap-index.xml --limit 5`.

- [ ] **Step 2: Run** `pnpm exec vitest run test/init-compose.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the three functions as the interfaces say.
- [ ] **Step 4: Run** it again — expect PASS.

---

### Task 4: Line prompts

**Files:**
- Create: `src/init/prompt.ts`
- Test: `test/init-prompt.test.ts` (create)

**Interfaces:**
- Consumes: `InterruptedError` (`src/passes/steps.ts`), `OutputStream` (`src/util/log.ts`).
- Produces:
  - `class InputEndedError extends Error`
  - `interface Prompter { ask(question: string, options?: { default?: string; check?: (answer: string) => string | null }): Promise<string>; choose(question: string, choices: readonly string[], defaultIndex: number): Promise<number>; confirm(question: string, defaultYes: boolean): Promise<boolean>; say(text: string): void; close(): void }` — `check` returns the one-line reason an answer is wrong, or null.
  - `createPrompter(io: { input: NodeJS.ReadableStream; output: OutputStream; terminal?: boolean }): Prompter`
  - Rendering: `ask` shows `Question [default]: ` (no brackets without a default) and returns the trimmed answer, or the default for an empty one; `choose` prints the question, then `  1. …` lines, then asks `Choose [<defaultIndex + 1>]: ` and returns a 0-based index; `confirm` asks `Question [y/N]: ` or `Question [Y/n]: `. A wrong answer prints its reason (`check`'s, or `Enter a number from 1 to <n>.`, or `Answer y or n.`) on its own line and asks again; `choose` asks its whole question again (the question line, the numbered choices, and the `Choose` line). Ctrl+C at any time, including between questions, makes the next or pending answer reject with `InterruptedError`.

- [ ] **Step 1: Write the failing tests** with a `PassThrough` input and a collecting `OutputStream`:
  - `"uses the default for an empty answer"`, `"asks again, with the reason, after an answer that fails its check"`, `"numbers the choices and returns the one picked"` (`"2\n"` → 1), `"asks again after a number out of range"`, `"reads y and n, and the default for Enter"`.
  - `"keeps answers that arrive all at once"`: write `"a\nb\n"` before the first question; two `ask`s return `"a"` and `"b"`.
  - `"throws InputEndedError when the input ends"`: end the input before answering.
  - `"throws InterruptedError on Ctrl+C in a terminal"`: `terminal: true`, a `Writable` as the output, write `"\u0003"`.

- [ ] **Step 2: Run** `pnpm exec vitest run test/init-prompt.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** on `node:readline`'s `createInterface({ input, output: terminal ? output : undefined, terminal })`, reading answers from the interface's async iterator, created once in `createPrompter`. Don't use `question()`: it drops lines that arrive before it's called, which loses piped answers (checked on Node 24.19: three answers piped at once were all lost; the iterator kept them and then reported the end). Show each question with `rl.setPrompt(text)` and `rl.prompt()` in a terminal, so line editing redraws it, and with `output.write(text)` otherwise. The interface's `SIGINT` event (Ctrl+C in a terminal) rejects the pending answer with `InterruptedError`; the iterator ending rejects it with `InputEndedError`.

- [ ] **Step 4: Run** it again — expect PASS.

---

### Task 5: Site checks and sitemap discovery

**Files:**
- Create: `src/init/site.ts`, `test/helpers/real-sites.ts` (the recorded responses above)
- Test: `test/init-site.test.ts` (create)

**Interfaces:**
- Produces:
  - `normalizeSiteAnswer(answer: string): URL | null` — trims, adds `https://` when there's no scheme, allows only `http` and `https`, and returns the origin as a `URL`.
  - `type Check = { ok: true } | { ok: false; reason: string }`
  - `type SiteCheck = { ok: true; site: URL; moved: boolean } | { ok: false; site: URL; reason: string }` — `site` is the final origin after redirects (an empty `response.url`, as a constructed `Response` has, means no redirect); `moved` when it differs from the one given.
  - `checkSite(site: URL, fetch: typeof globalThis.fetch): Promise<SiteCheck>`
  - `checkSitemap(url: string, fetch: typeof globalThis.fetch): Promise<Check>`
  - `findSitemap(site: URL, fetch: typeof globalThis.fetch): Promise<string | null>`
  - Reasons: `HTTP <status>`; `no answer in 15 seconds` for a timeout; `not a sitemap (no <urlset> or <sitemapindex>)`; otherwise the error's `cause` message when it has one (fetch's `TypeError: fetch failed` keeps the real reason, such as `getaddrinfo ENOTFOUND i2i.ilinois.gov`, there), else its message.

- [ ] **Step 1: Write the failing tests** with `realSitesFetch()`:
  - `normalizeSiteAnswer("  I2I.Illinois.GOV ")?.origin` → `"https://i2i.illinois.gov"`; `"https://dvfr.illinois.gov/faq/"` → `https://dvfr.illinois.gov`; `"ftp://x"`, `"not a url"`, and `""` → null.
  - `checkSite(new URL("https://i2i.illinois.gov"))` → `{ ok: true, moved: false }`; `new URL("http://i2i.illinois.gov")` → `ok: true`, `site.origin` `https://i2i.illinois.gov`, `moved: true`.
  - An `extra` answering 403 → `{ ok: false, reason: "HTTP 403" }`; an `extra` that throws `new DOMException("timed out", "TimeoutError")` → `reason: "no answer in 15 seconds"`.
  - `findSitemap(i2i)` → `https://i2i.illinois.gov/sitemap-index.xml`; `findSitemap(dvfr)` → `https://dvfr.illinois.gov/sitemap.xml`.
  - A `robots.txt` of `"User-agent: *\r\nSITEMAP: /sitemaps/main.xml\r\n"`, with that path serving a `<urlset>` → `https://<site>/sitemaps/main.xml`.
  - No `robots.txt`, and `/sitemap.xml` serving a `<urlset>` → `/sitemap.xml`; serving 200 HTML → null.
  - `checkSitemap` of a 200 HTML page → `{ ok: false, reason: "not a sitemap (no <urlset> or <sitemapindex>)" }`.

- [ ] **Step 2: Run** `pnpm exec vitest run test/init-site.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** with `AbortSignal.timeout(15_000)` on each request; `Sitemap:` lines matched case-insensitively and resolved against the site's origin.
- [ ] **Step 4: Run** it again — expect PASS.

---

### Task 6: The question flow

**Files:**
- Create: `src/init/wizard.ts`, `src/init/readiness.ts`
- Test: `test/init-wizard.test.ts` (create)

**Interfaces:**
- Consumes: Tasks 3–5; the audit record's `resolveHome(options: { out?: string | null; env?: NodeJS.ProcessEnv; cwd: string }): string` and `siteFolder(site: string | URL): string` (`src/run/paths.ts`); `readPageList` (`src/pages/page-list.ts`); `resolvePageUrl` and `sameOrigin` (`src/pages/url.ts`); `guidepupInstall` and `readGuidepupPackage` (`src/drivers/guidepup/paths.ts`).
- Produces:
  - `type Readiness = { canRun: true } | { canRun: false; reason: string }`
  - `checkReadiness(options: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; homedir: string; exists: (file: string) => boolean }): Readiness` — the NVDA it looks for is `guidepupInstall(readGuidepupPackage().nvdaBuild, env, homedir).nvdaExe`; the reasons are the spec's two sentences, exactly.
  - `interface WizardDeps { prompter: Prompter; fetch: typeof globalThis.fetch; cwd: string; env: NodeJS.ProcessEnv; now: () => Date; readiness: () => Readiness }`
  - `interface WizardResult { args: string[]; command: string; run: boolean }`
  - `runWizard(deps: WizardDeps): Promise<WizardResult>` — the spec's questions, in order, with the spec's copy where it gives some, and this copy where it doesn't:
    - Website: a wrong answer → `Enter the site's address, such as dvfr.illinois.gov or https://dvfr.illinois.gov.`; then `  → <origin> (it answers)`, or `  → <final origin> (<given origin> redirects there)`, or `  → <origin> doesn't answer (<reason>).` followed by `Use it anyway? [y/N]: `.
    - Another sitemap: `Sitemap URL: `; not http(s) → `Enter a full URL, such as https://dvfr.illinois.gov/sitemap.xml.`; failing `checkSitemap` → `  → <url>: <reason>.` followed by `Use it anyway? [y/N]: `.
    - Sitemap search: `Looking for the site's sitemap…` just before it starts.
    - Paths (the page list and the home): one pair of matching surrounding quotes (`"…"` or `'…'`, as Windows' "Copy as path" gives) is taken off.
    - Page list: `Page list file (.csv or .json): `; wrong → `There's no file at <path>.`, `A page list is a .csv or .json file.`, or `readPageList`'s message; read → `  → <n> pages listed` (`1 page listed` for one).
    - One page: an answer off the site → `Enter a page on <origin>: a full URL, or a path like /faq/.`
    - How many: a wrong answer → `Enter a whole number of at least 1, or press Enter for all.`
    - Home: `  → this run goes into <home>/<site folder>/<YYYY-MM-DD>/` (local date, platform separators); when `VOICECAP_TRANSCRIPTS` isn't set: `Tip: set VOICECAP_TRANSCRIPTS to keep every run in one place. See "The audit record" in the README.`
    - `home` in the answers is null when `path.resolve(cwd, answer)` equals `resolveHome({ env, cwd })`, else the answer as typed.

- [ ] **Step 1: Write the failing tests** (scripted answers through a `PassThrough`, `realSitesFetch()`, `now` on 2026-09-27, and `readiness: () => ({ canRun: true })` unless stated):
  - `"composes the i2i example from mostly Enter"`: `VOICECAP_TRANSCRIPTS` set to a temp home; answers `i2i.illinois.gov`, Enter, `5`, Enter, Enter → `command` is the spec's i2i line, `run: false`; output contains `→ https://i2i.illinois.gov (it answers)` and `this run goes into <home>/i2i.illinois.gov/2026-09-27/` (built with `path.join`).
  - `"offers one page, with the home page as the default, when no sitemap is found"`: `extra` makes i2i's `robots.txt` and `sitemap-index.xml` 404 → three choices and `Choose [3]:`; `i2i.illinois.gov`, then Enter for every other answer → `--page https://i2i.illinois.gov/`.
  - `"writes a page given as a path as a full URL, and asks again for one off the site"`: dvfr, choice `4`, then `https://i2i.illinois.gov/` (asked again), then `/faq/` → `--page https://dvfr.illinois.gov/faq/`.
  - `"takes a page list, and says how many pages it has"`: `cwd` a temp folder with `lists/dvfr pages.csv` (a `url` header and 2 rows); dvfr, choice `3`, `missing.csv` (asked again), then `lists/dvfr pages.csv` → output shows `2 pages listed`; the command has `--pages 'lists/dvfr pages.csv'`.
  - `"checks a sitemap at another address"`: dvfr, choice `2`, `https://dvfr.illinois.gov/` (HTML) → `Use it anyway? [y/N]`, `n` → asked again → `https://dvfr.illinois.gov/sitemap.xml` is accepted.
  - `"asks about a site that doesn't answer"`: `extra` 403 for `https://i2i.illinois.gov/` → `doesn't answer (HTTP 403)` and `Use it anyway? [y/N]`; `n` asks for the website again.
  - `"asks again for a page count that isn't a whole number"`: `0` → the reason, then `5` → `--limit 5`.
  - `"writes --out only for a home other than the one in effect"`: `VOICECAP_TRANSCRIPTS` unset; Enter → no `--out`, and the tip is shown; a second session answering `C:\vt` → `--out 'C:\vt'`.
  - `"doesn't offer to run where it can't"`: `readiness` returns the not-Windows reason → it's printed, there's no `Run it now?`, and `run: false`.
  - `"runs only after a yes"`: `y` → `run: true`; Enter → `run: false`.
  - `checkReadiness`: `darwin` → the not-Windows reason; `win32` with `exists: () => false` → the setup reason; `win32` with `exists: (file) => file.endsWith("nvda.exe")` → `canRun`.

- [ ] **Step 2: Run** `pnpm exec vitest run test/init-wizard.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `runWizard` and `checkReadiness`.
- [ ] **Step 4: Run** it again — expect PASS.

---

### Task 7: Stopping at once, and the paths a Windows user types

Added after Task 6's review. Each item comes from the spec's "The questions" paragraph on wrong answers.

**Files:**
- Modify: `src/init/prompt.ts` (`Prompter.interrupted`), `src/init/site.ts` (an optional `signal` on `checkSite`, `checkSitemap`, and `findSitemap`; the body cancel in `checkSite`; `fetchFailureReason`), `src/init/wizard.ts` (`WizardDeps.signal` and `WizardDeps.platform`; Git Bash paths; the home comparison)
- Test: `test/init-prompt.test.ts`, `test/init-site.test.ts`, `test/init-wizard.test.ts`

**Interfaces:**
- Produces:
  - `Prompter.interrupted: AbortSignal`: aborted when Ctrl+C arrives in a terminal, at any time, pending question or not.
  - `checkSite(site, fetch, signal?)`, `checkSitemap(url, fetch, signal?)`, and `findSitemap(site, fetch, signal?)`: each request waits on `AbortSignal.any([AbortSignal.timeout(15_000), signal])`. When `signal` aborts, the function rejects with `InterruptedError` instead of giving a reason.
  - `WizardDeps.signal?: AbortSignal`, passed to every site call.
  - `WizardDeps.platform?: NodeJS.Platform` (default `process.platform`). On `win32`:
    - a page-list or home answer in Git Bash form (`/c/Users/…`, one drive letter) is read as `C:/Users/…`;
    - the home comparison uses `path.win32` and ignores case.
  - `fetchFailureReason` is never empty. It gives the cause's message; else the cause's `code` (such as `ENOTFOUND`); else, for an `AggregateError` cause, its first inner error's message; else the error's own message.
  - `checkSite`'s body cancel can't make `checkSite` reject.

- [ ] **Step 1: Write the failing tests:**
  - `test/init-prompt.test.ts`: `"aborts interrupted on Ctrl+C, pending question or not"`: in terminal mode, `interrupted.aborted` is false; after `"\u0003"` with no question pending, it's true.
  - `test/init-site.test.ts`:
    - `"rejects with InterruptedError when the signal aborts"`: use a fetch that waits until its `signal` aborts. Aborting the given signal makes `checkSite`, `checkSitemap`, and `findSitemap` each reject with `InterruptedError`.
    - `"never gives an empty reason"`: `TypeError("fetch failed", { cause: new AggregateError([new Error("connect ECONNREFUSED ::1:443"), new Error("connect ECONNREFUSED 127.0.0.1:443")]) })` gives the reason `connect ECONNREFUSED ::1:443`. A cause with an empty message and `code: "ENOTFOUND"` gives `ENOTFOUND`.
    - `"doesn't reject when the body errors before the cancel"`.
  - `test/init-wizard.test.ts`:
    - `"stops at once on Ctrl+C during the site check"`: use a fetch that waits until aborted, and abort `signal` while it waits. `runWizard` rejects with `InterruptedError` within a second.
    - `it.runIf(process.platform === "win32")("reads a Git Bash home as a Windows path")`: `platform: "win32"`, with the answer `/c/vt`, gives `--out C:/vt`.
    - `it.runIf(process.platform === "win32")("compares homes without regard to case")`: with `VOICECAP_TRANSCRIPTS` set to `C:\vt`, the answer `c:\VT` gives no `--out`.
    - `"leaves /c/vt alone off Windows"`: `platform: "linux"` gives `--out /c/vt`.

- [ ] **Step 2: Run** `pnpm exec vitest run test/init-prompt.test.ts test/init-site.test.ts test/init-wizard.test.ts` — expect the new cases to FAIL.
- [ ] **Step 3: Implement** as the interfaces say. The sticky Ctrl+C behavior of the prompter's answers stays as it is; `interrupted` is in addition to it.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — expect PASS/clean.

---

### Task 8: The `init` command

**Files:**
- Modify: `src/cli/main.ts` (`CliContext`, `main`, the `init` command, the missing-site message)
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: Task 4's `createPrompter` and `InputEndedError`; Task 6's `runWizard`, `checkReadiness`, and `Readiness`.
- Produces: `CliContext.stdin: NodeJS.ReadableStream` (default `process.stdin`); `CliContext.interactive: boolean` (default `process.stdin.isTTY === true && process.stdout.isTTY === true`); `CliContext.readiness?: () => Readiness` (tests).

- [ ] **Step 1: Write the failing tests** in `test/cli.test.ts` (`main(argv, { stdin, interactive, fetch, readiness, … })`):
  - `"init asks the questions and prints the command"`: `["init"]` with `realSitesFetch()`, answers `dvfr.illinois.gov` and Enter ×4 → stdout contains `npx @icjia/voicecap --site https://dvfr.illinois.gov --sitemap https://dvfr.illinois.gov/sitemap.xml`; exit 0.
  - `"starts init with no arguments in a terminal"`: `[]`, `interactive: true` → `Website:` is asked.
  - `"keeps the usage error with no arguments and no terminal"`: `[]`, `interactive: false` → exit 1; stderr contains `Missing --site` and `voicecap init`.
  - `"exits 1 when the answers stop coming"`: the input ends after the website.
  - `"runs the command when told to"`: `cwd` a temp folder holding `voicecap.config.json` `{ "driver": "replay", "replayFrom": <fixture/replay-run, absolute> }`; `fetch` answers `http://127.0.0.1:4747/` with 200 HTML and 404 for everything else; `readiness: () => ({ canRun: true })`; answers `http://127.0.0.1:4747`, Enter (one page), Enter (the home page), Enter (home), `y` → exit 0, and `transcripts/127.0.0.1_4747/latest.txt` names a run whose `run.json` has status `completed`.

- [ ] **Step 2: Run** `pnpm exec vitest run test/cli.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** `main` turns `[]` into `["init"]` when `ctx.interactive`. The `init` action builds a prompter on `ctx.stdin` and `ctx.stdout` (`terminal` only when the input is a TTY), runs `runWizard` with `ctx.fetch ?? fetch`, `ctx.cwd`, `ctx.env`, `signal: prompter.interrupted` (Task 7), and `ctx.readiness ?? (() => checkReadiness({ platform: process.platform, env: ctx.env, homedir: os.homedir(), exists: existsSync }))`, closes the prompter, maps `InputEndedError` to exit 1 and `InterruptedError` to 130, and on `run: true` sets the exit code to `await main(result.args, ctx)`. The missing-site error becomes `Missing --site <url>. Run voicecap init to answer a few questions instead, or voicecap --help for usage.` (Git Bash's mintty window can hide the terminal from Node, so there the no-argument shortcut may not start `init`.)
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint` — expect PASS/clean.

---

### Task 9: Real examples in the README, help, and messages

**Files:**
- Modify: `README.md` (Quick start, "Starting voicecap", `--page` in the options table and under Page sources, the 7 `example.illinois.gov` examples including the API example), `src/cli/main.ts:121-124` (the root help's Examples block), `src/index.ts:5`, `src/pages/url.ts:28`, `src/pages/resolve.ts:234`, `src/util/git-bash.ts:22`, `CHANGELOG.md` (Unreleased → Added: `init`, `--page`)

- [ ] **Step 1: Write the README sections** from the spec (its Quick start session is the spec's "What someone sees" block, including `Looking for the site's sitemap…`), keeping the owner's "voicecap in brief" pitch at the top as it is, and fixing two stale Quick start lines on the way (`# then open transcripts/report.html`, which is now `transcripts/127.0.0.1_4747/report.html`, and the "Before voicecap is published to npm" paragraph, which "Starting voicecap" replaces): the Quick start with the i2i.illinois.gov session; "Starting voicecap" (npx, or `npm install -g @icjia/voicecap`; what's needed; the harmless `ffmpeg-static` warning; `voicecap` in place of `npx @icjia/voicecap` after a global install; in Git Bash, `npx @icjia/voicecap init` when the bare command prints the usage error); `--page` with full-URL examples only, since Git Bash rewrites arguments that begin with `/`.
- [ ] **Step 2: Replace every placeholder** with real examples, using only these checked values: `https://dvfr.illinois.gov` with `https://dvfr.illinois.gov/sitemap.xml` (`/faq/`, `/about/`, `/meetings/`), and `https://i2i.illinois.gov` with `https://i2i.illinois.gov/sitemap-index.xml` (`/program-overview/`, `/contact/`, `/grant-opportunities/`, `/biographies/…`, `/spotlights/…`). The help's `review` example becomes `voicecap review --page https://dvfr.illinois.gov/about/ --status reviewed --note "Reads well"`, and the help gains `npx @icjia/voicecap init` and a run-level `--page` example with a full URL (`npx @icjia/voicecap --site https://dvfr.illinois.gov --page https://dvfr.illinois.gov/faq/`). Test data keeps its placeholders; update only assertions that quote a changed message.
- [ ] **Step 3: Check the examples against the real sites** (network, after `pnpm build`): `node dist/cli.js list-urls <tmp>/dvfr.csv --site https://dvfr.illinois.gov --sitemap https://dvfr.illinois.gov/sitemap.xml` prints `Wrote 36 URLs`; the same for i2i with `sitemap-index.xml` prints `Wrote 35 URLs` (the counts on 2026-09-27; if a site has changed, check the count against its sitemap instead); with `--sample 2`, the i2i file has exactly 2 rows under `/biographies/` and 2 under `/spotlights/`; `printf 'dvfr.illinois.gov\n\n\n\n\n' | node dist/cli.js init` prints the dvfr command and exits 0 (the last Enter answers "Run it now?" where NVDA is installed).
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — expect all clean.
