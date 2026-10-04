# Plan 5 of the shareable report: the website

**Goal:** A website of every report voicecap has shared, by site and by date, with the demo. `voicecap site` builds it from the transcripts home's records of what was shared, byte for byte, with the headers Netlify serves, so ICJIA can point anyone to `icjia-voicecap.netlify.app`.

**Architecture:**
- **What's published comes only from the record of what was shared:** each site folder's `share/shares.json`. The site holds every file an intact entry names that still matches its recorded size and SHA-256, copied byte for byte.
  - `voicecap share` now writes and records each run's walkthrough file too, so the site has one to offer.
- **The site's own page,** `index.html`, is rendered from a model of what's published. It's pure, and it's in the report's design: one file, one style block, one script.
- **The headers:**
  - `_headers`, written by each build, holds each page's Content Security Policy (the hashes of that page's own style block and script) and each download's `Content-Disposition`.
  - `netlify.toml`, written once, holds the build command and the headers for every file.

**Tech Stack:** TypeScript strict, ESM, Node 22.19+, pnpm, Vitest, commander, and Playwright's Chromium in the tests. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-30-shareable-report-design.md`:
- "The website";
- "Rules the page follows" (accessibility and honesty), which the site's page follows too;
- "Files, names, and the record of what was sent".

This plan builds on plans 1 to 4, which shipped as 0.6.0, 0.7.0, and 0.8.0:
- `voicecap share` writes `share/<site>_<day>.html` and `.docx`, never over a file, and records each in `share/shares.json`, sealed and chained.
- Each page has exactly one `<style>`, one `<script>`, and no `style` attribute: plan 2's rule, made for this plan's Content Security Policy.
- Each run's walkthrough file is in its page's evidence as a download (plan 4).

Carried here from plan 3: `readShares`'s exported type promises more than it checks (Task 2).

## Decisions beyond the spec, for the owner's eye

1. **`voicecap share` also writes each run's walkthrough file,** beside the page and its Word copy:
   - It's named `<the page's name without .html>_<run id>_walkthrough.json`, and recorded in `shares.json` with its run, size, and SHA-256.
   - Why: the spec has the site offer each report's walkthrough file, and publish only shared, fingerprinted copies, byte for byte.
   - The line to paste into the email still names only the page and the Word copy, which are what's emailed.
   - Shares made before this have no walkthrough files, and the site says so for them.
2. **`Content-Disposition: attachment` goes in `_headers`, not in `netlify.toml`.**
   - `_headers` is written by each build, with each `.docx` and `.json` file's exact path.
   - `netlify.toml` is written once and never overwritten.
   - Netlify's wildcard paths aren't relied on.
3. **`voicecap site` empties its output folder before each build, but only a folder it built itself:** one whose `_headers` starts with voicecap's line, or an empty or missing one.
   - It refuses anything else, the home itself, a folder that holds the home, and a site's folder, so a mistyped `--out` can't delete records.
4. **What's left out:**
   - A copy that's changed or missing isn't published. It's named in the build's output and, in a line, under its report on the site.
   - An entry whose seal no longer holds is left out whole, and named in the build's output only.
   - The build still succeeds, so one changed file doesn't stop every later update.
5. **The demo** is published under `demo/`, from the latest share in the home's `voicecap-demo/` folder.
   - It isn't in "Every report, by date", since it's an example, not a site.
   - With no demo share, there's no demo view.
   - A site folder named `demo` would take its place, so it's left out and named.
6. **Names:**
   - Only folders and files named as voicecap names them (letters, digits, `.`, `_`, and `-`) are published; any other is left out and named.
   - Each site is shown by its folder's name, its host, such as `dvfr.illinois.gov`, since the site reads only the record of what was shared, never the runs.
7. **`.gitignore`:**
   - A new home's file gains `_site/`.
   - For an older home, such as ICJIA's, `voicecap site` says to add it, and never edits the file, as plan 3 did for `~$*`.
8. **`readShares`'s type says what it checks:** each entry as an object whose fields are unknown (carried from plan 3). It's a compile-time change for code that imports it.
9. **The bar** stays in view at 640 pixels wide and wider. On a narrower screen it scrolls with the page, so it never covers half a phone's screen.
10. **One theme choice for the site and its reports.** The site's page keeps the reader's theme under the same name as the reports do, so a choice made on one carries to the other.

## Global Constraints

- **Toolchain:** Node.js 22.19 or later; TypeScript strict; ESM; pnpm. `pnpm lint` (ESLint, then Prettier), `pnpm typecheck`, and `pnpm test` all pass before each commit.
- **Dependencies:** no new package.
- **The site's page (`index.html`)** follows the report's rules:
  - one self-contained file: exactly one `<style>` and one `<script>`, no `style="…"` attribute, nothing loaded from outside, and the fonts embedded;
  - links only to its own published files (relative), anchors in itself, and `https://github.com/ICJIA/voicecap`;
  - axe with zero violations in both themes;
  - reflows at 320 pixels;
  - complete without JavaScript;
  - dark by default, light when switched, and light in print.
- **Published files:**
  - byte for byte the shared copies;
  - only files an intact entry of a `shares.json` names, by a plain name, as voicecap names them;
  - never a file whose size or SHA-256 differs from the record;
  - never a file read through a name that holds a path.
- **Netlify's files** are exactly as Task 3 gives them.
- **`voicecap share`'s copies are never written over,** the walkthrough files included.
- **Copy:**
  - plain words, short sentences;
  - never "automated" for voicecap;
  - never say a person "listened";
  - dates as "3 October 2026", times as "14:05";
  - counts as digits.
- **Never start a real screen reader,** in tests or while building:
  - no run without `--replay-from` or a scripted driver;
  - no `setup`, `doctor`, `preflight`, `demo`, `init`, `test:nvda`, or `fixture:capture`;
  - never pass a composed command through `cmd /c` or any shell.
- **Commit messages:** one subject line, and no trailers of any kind.

## Review Focus

1. **A record naming a file outside `share/`:** `../../.ssh/id_rsa`, an absolute path, or a name with a slash.
   - It's never read and never published. The build names it, and the rest still publishes.
   - Tasks 2 and 5 add the tests.
2. **`--out` mistyped** as the home, a folder holding it, a site's folder, or a folder of other files.
   - It's refused before anything is deleted, and nothing there changes.
   - Task 5 adds the tests.
3. **A copy changed after it was shared:**
   - it's left out and named, and its report's other files are still published;
   - the site never offers a file whose fingerprint doesn't match.

   Task 5 adds the test.
4. **A page made by an older voicecap** (a 0.7.0 dated copy) is served with its own hashes, from its own bytes, so its script runs and its fingerprint check works under the Content Security Policy. Task 6 adds the test.
5. **Netlify's build:** `voicecap site` needs no config, no screen reader, and no browser, and runs on Linux. Task 6's CI step runs it on every system, from a folder with no config.

---

### Task 1: `voicecap share` writes each run's walkthrough file

**Files:**
- Modify: `src/model.ts` (`SharedFile`, `ShareEntry.files`'s doc comment), `src/share/share.ts`
- Test: `test/share-report.test.ts`

**Interfaces:**
- Consumes:
  - the share model's `evidence[].walkthrough`, which is a `WalkthroughDownload` (`fileName`, `base64`, `bytes`) or `{ problem }`;
  - `walkthroughJson` and `walkthroughOf` (`src/share/walkthrough.ts`).
- Produces:
  - `SharedFile.run?: string`, with the doc comment "The run a walkthrough file is of. Only a walkthrough file has it."
  - `ShareEntry.files`' doc comment: "The page, then its Word copy, then each run's walkthrough file, oldest run first."
  - A walkthrough copy's name is `<stem>_<run id>_walkthrough.json`, where `<stem>` is the page's name without `.html`, such as `127.0.0.1_4848_2026-10-03-2`.

- [ ] **Step 1: Write the failing tests** in `test/share-report.test.ts`, each on a copy of the demo fixture home (runs 1315 and 1402 count), with `reviewer: "Test Reviewer"` and a fixed `now`:
  - `it("writes each run's walkthrough file beside the page and its Word copy, and records it")`:
    - `entry.files` names are the page, the Word copy, then `<stem>_2026-09-29_1315_walkthrough.json` and `<stem>_2026-09-29_1402_walkthrough.json`;
    - the last two have `run` `"2026-09-29_1315"` and `"2026-09-29_1402"`, and the first two have no `run` key;
    - each walkthrough copy's bytes equal `walkthroughJson(walkthroughOf(demoRun(...)))`, and its recorded `bytes` and `sha256` are the file's.
  - `it("numbers every file of a second share the same day")`: every name of the second share has the stem `<folder>_<day>-2`.
  - `it("takes the next number when a walkthrough file's name is taken")`:
    - a file at `<stem>_2026-09-29_1315_walkthrough.json` in `share/` makes the share use `-2` for all its files;
    - the file that was there is unchanged.
  - `it("shares no walkthrough file of a run that can't have one, and says why")`:
    - setup: run 1315's page 1 label is edited to hold ESC (`\u{1b}`), and the run is sealed again (`run.seal = sealOf(run)`);
    - the entry has run 1402's walkthrough file only;
    - the logger warned: `Run 2026-09-29_1315's walkthrough file can't be made, so it isn't shared: page 1's label has a control character in it.`
  - `it("names only the page and its Word copy in the line to paste")`: `pasteLine` contains no `_walkthrough.json`.
  - `it("leaves a home that verify finds whole")`: `verifyHome` on the home after a share finds 0 problems.
  - `it("takes away what it wrote when a copy's write fails partway")`. This is carried from plan 3.
    - setup: `vi.doMock("node:fs/promises", …)` wraps `open` so the Word copy's handle throws on `writeFile`, and the share module is imported after it;
    - the share rejects with that error;
    - `share/` holds none of its files, and `shares.json` is as before.
- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/share-report.test.ts`. Expected: the new tests FAIL. The entry has 2 files, and there's no warning.
- [ ] **Step 3: Write the walkthrough copies in `shareReport`.**
  - **Before the loop over names:** take the runs the copies draw on, oldest first (the model lists them latest first), each with its walkthrough's bytes, `Buffer.from(base64, "base64")`, or its `problem`. Warn once for each run that has a problem, in Step 1's words.
  - **`isTaken`** checks every name of a stem: the page, the Word copy, and each walkthrough copy.
  - **`copies`:** the page, the Word copy, then the walkthrough copies, all through `writeNew`.
  - **Recording:**
    - each walkthrough copy's file is `{ name, bytes, sha256, run }`;
    - the page's and the Word copy's are `{ name, bytes, sha256 }`, as now;
    - `pasteLineOf` gets the files with no `run`.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS. Tests that pinned a share's two files gain the walkthrough copies. Change those expectations, and nothing else.
- [ ] **Step 5: Commit:** `git commit -m "Share each run's walkthrough file with the page and its Word copy"`.

### Task 2: What the site reads: the record of what was shared

**Files:**
- Create: `src/site/records.ts`
- Modify:
  - `src/share/shares.ts`: `readShares`'s type, plus `recordedFiles` and `isPlainName`, moved here from `src/verify.ts`;
  - `src/verify.ts`: it uses them.
- Test: `test/site-records.test.ts`, with `test/shares.test.ts` and `test/verify.test.ts` passing unchanged

**Interfaces:**
- Produces, in `src/share/shares.ts`:
  - `export interface SharesAsRead { schemaVersion: 1; shares: Record<string, unknown>[] }`, which `readShares` returns. Its doc comment: "As read: only that each entry is an object is checked, so a caller checks each field it uses."
  - `recordedFiles(files: unknown): SharedFile[] | null`. It's `verify`'s `sharedFiles`, moved, and it keeps a file's `run` when it's text.
  - `isPlainName(name: string): boolean`, moved from `verify` as is.
- Produces, in `src/site/records.ts`:
  ```ts
  /** An entry of a shares.json the site can publish from: its seal holds, and its fields are readable. */
  export interface SiteEntry {
    /** Its site's folder, as the home names it (for the demo, as voicecap-demo/ does). */
    folder: string;
    /** Where its files are: that folder's share/. */
    dir: string;
    seq: number;
    /** As recorded: a local ISO date and time. */
    at: string;
    by: string;
    /** The files whose names voicecap would give, in the record's order. */
    files: SharedFile[];
  }
  export interface SiteRecords {
    /** Each site folder with an entry to publish, by folder name; its entries in the record's order. */
    sites: { folder: string; entries: SiteEntry[] }[];
    /** The latest entry in voicecap-demo/'s site folders; null when there's none. */
    demo: SiteEntry | null;
    /** What's left out, one line each, for the build's output: "<path from the home>: <why>". */
    leftOut: string[];
  }
  export async function readSiteRecords(home: string): Promise<SiteRecords>;
  ```

- [ ] **Step 1: Write the failing tests** in `test/site-records.test.ts`.
  - **The test homes:** each has site folders (each with a date folder), `share/shares.json` with entries sealed by `sealOf`, and small files.
  - **Kept:**
    - `it("reads every site's entries, and the demo's latest")`:
      - two sites' entries come in record order, with the sites by folder name;
      - `voicecap-demo/127.0.0.1_4848/` has two entries, and `demo` is the later one by `at`.
    - `it("keeps a walkthrough file's run, and drops one that isn't text")`.
  - **Left out:**
    - `it("leaves out an entry whose seal no longer holds, and names it")`:
      - setup: one entry's `by` is changed after sealing;
      - its site's other entries are kept;
      - `leftOut` has `example.illinois.gov/share/shares.json: entry 2 changed since it was recorded`.
    - `it("leaves out a record that can't be read, and keeps the other sites")`. The line ends `: not a readable record of what was shared`.
    - `it("never keeps a file named with a path, or as voicecap names none")`:
      - the names are `../outside.html`, `/etc/passwd`, `a/b.html`, `a\\b.html`, `x y.html`, and `".."`;
      - none is in `files`;
      - each gives a line ending `names "<name>", which isn't a file voicecap would publish`, with the name as `JSON.stringify` writes it;
      - the entry's other files are kept.
    - `it("leaves out a site folder voicecap would never name, and one named demo")`. The folders are `my site` (with a date folder) and `demo`.
    - `it("leaves out an entry it can't read: a seq that isn't one, an at that isn't a time, a by that isn't text")`.
  - `it("reads a home with nothing shared as nothing")`: `sites` and `leftOut` are empty, and `demo` is null.
- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/site-records.test.ts`. Expected: FAIL, since the module isn't there.
- [ ] **Step 3: Write it.**
  - **Site folders** come from `siteFolders(home)`. A name is voicecap's when it matches `/^[a-z0-9._-]+$/` and isn't `demo`.
  - **The demo's folders** come from `siteFolders(path.join(home, "voicecap-demo"))`, and its latest entry is the one with the latest `Date.parse(at)`, the higher `seq` on a tie.
  - **An entry is kept** when:
    - `entry.seal === sealOf(entry)`;
    - `isSeq(entry.seq)`;
    - `at` is text `Date.parse` reads;
    - `by` is text;
    - `recordedFiles(entry.files)` isn't null.
  - **A file is kept** when its name passes `isPlainName` and matches `/^[A-Za-z0-9._-]+$/`.
  - Paths in `leftOut` are `linkPath(home, …)`.
  - `appendShare` and `nextInChain` read the new type, checking `seq` with `isSeq` and `seal` as text.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS, with `verify`'s tests unchanged.
- [ ] **Step 5: Commit:** `git commit -m "Read what was shared for the site, and give readShares the type it checks"`.

### Task 3: Netlify's files: `_headers`, `robots.txt`, `netlify.toml`, and `.nvmrc`

**Files:**
- Create: `src/site/headers.ts`, `src/site/netlify.ts`
- Modify: `src/run/git-files.ts` (export `writeIfMissing`, returning whether it wrote)
- Test: `test/site-headers.test.ts`, `test/site-netlify.test.ts`

**Interfaces:**
- Produces, in `src/site/headers.ts`:
  ```ts
  /** The hashes a Content Security Policy allows a page's own code by, each as 'sha256-<base64>'. */
  export function inlineHashes(html: string): { styles: string[]; scripts: string[] };
  export function contentSecurityPolicy(hashes: { styles: string[]; scripts: string[] }): string;
  export interface HeaderRule { path: string; headers: [name: string, value: string][] }
  /** _headers as Netlify reads it: HEADERS_FIRST_LINE, then each rule. */
  export function headersFile(rules: HeaderRule[]): string;
  export const HEADERS_FIRST_LINE = "# Made by voicecap site. Each build empties this folder and writes it again.";
  export const ROBOTS_TXT = "User-agent: *\nDisallow: /\n";
  ```
- Produces, in `src/site/netlify.ts`:
  ```ts
  /** netlify.toml, building with the minor version of `version`: "0.9.0" builds with @icjia/voicecap@0.9. */
  export function netlifyToml(version: string): string;
  export const NVMRC = "24\n";
  /** Write netlify.toml and .nvmrc into the home where they're missing; never over a file. The names written. */
  export async function ensureNetlifyFiles(home: string, version: string): Promise<string[]>;
  ```
- **The Content Security Policy,** exactly as the spec gives it:

  `default-src 'none'; script-src <hashes>; style-src <hashes>; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`

  `<hashes>` is the list joined by spaces, or `'none'` when it's empty.
- **`inlineHashes`:**
  - It hashes each `<style>` element's text.
  - It hashes each `<script>` element's text when it has no `src` and its `type` is missing, empty, `text/javascript`, `application/javascript`, or `module`. A data block (`application/json`) never runs, and isn't hashed.
  - The text runs from the start tag's `>` to the first `</style` or `</script` after it, as the HTML parser reads it. It's hashed as UTF-8.
  - Tags are matched in any case. Each hash comes once, in the order found.
- **`netlify.toml`'s text,** with `<minor>` as `major.minor` of the version:
  ```toml
  # Written by voicecap site, once: voicecap never changes it. Netlify builds the website with it on every push.
  # To build with a newer voicecap, change the version in the command.
  [build]
    command = "npx --yes @icjia/voicecap@<minor> site --home . --out _site"
    publish = "_site"

  [[headers]]
    for = "/*"
    [headers.values]
      X-Robots-Tag = "noindex, nofollow, noarchive"
      Referrer-Policy = "no-referrer"
      X-Content-Type-Options = "nosniff"
      X-Frame-Options = "DENY"
      Permissions-Policy = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
      Strict-Transport-Security = "max-age=63072000; includeSubDomains"
      Cross-Origin-Opener-Policy = "same-origin"
      Cross-Origin-Resource-Policy = "same-origin"
  ```
- **`headersFile`'s text:**
  - the first line;
  - then, for each rule, a blank line, the path on a line of its own, and each header as `  <Name>: <value>`;
  - a final newline.

- [ ] **Step 1: Write the failing tests.**
  - In `test/site-headers.test.ts`:
    - `it("hashes the shareable page's one style block and one script, and not its data")`:
      - the page is `renderSharePage(await demoModel(), { fontCss: "" })`;
      - `styles` is the hash of `"\n\n" + SHARE_CSS`;
      - `scripts` is the hash of `SHARE_SCRIPT + CHECK_SCRIPT`;
      - each expectation is computed with `createHash("sha256")…digest("base64")`.
    - `it("hashes inline code only, in any case, once each")`: an `<SCRIPT>` in capitals, two scripts with the same text, a `<script src="x.js">`, and a `<script type="application/json">`.
    - `it("writes the policy with each page's hashes, and 'none' for a kind it has none of")`: the exact string.
    - `it("writes _headers as Netlify reads it")`: the exact text for two rules.
    - `ROBOTS_TXT` is the exact text.
  - In `test/site-netlify.test.ts`:
    - `it("builds with the minor version that wrote it")`:
      - `netlifyToml("0.9.0")` is the exact text, with `@icjia/voicecap@0.9`;
      - `"1.2.3-beta.1"` gives `@1.2`.
    - `it("writes netlify.toml and .nvmrc into a home that has neither, and says which")`: the exact contents, and `["netlify.toml", ".nvmrc"]`.
    - `it("never writes over either file")`: a `netlify.toml` with other text stays as it was; `.nvmrc` is written; the result is `[".nvmrc"]`.
- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/site-headers.test.ts test/site-netlify.test.ts`. Expected: FAIL, since the modules aren't there.
- [ ] **Step 3: Write both modules.** `ensureNetlifyFiles` writes through `writeIfMissing`.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Write what Netlify reads: each page's policy, robots.txt, netlify.toml, and .nvmrc"`.

### Task 4: The site's page

**Files:**
- Create:
  - `src/site/text.ts`, the fixed text, `SITE_TEXT`;
  - `src/site/style.ts`, `SITE_CSS`;
  - `src/site/client.ts`, `SITE_SCRIPT`;
  - `src/site/render.ts`, the model types and `renderSiteIndex`.
- Modify: `src/share/html/style.ts`. Export `THEME_CSS`: the `:root`, `:root[data-theme="light"]`, and `@media print` rules, as they are. `SHARE_CSS` interpolates it in the same place, so its text doesn't change.
- Test: `test/site-render.test.ts`, `test/site-page-browser.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PublishedFile {
    kind: "page" | "word" | "walkthrough" | "other";
    name: string;
    /** Its address from the site's top: "dvfr.illinois.gov/dvfr.illinois.gov_2026-10-03.html". */
    href: string;
    bytes: number;
    sha256: string;
    /** The run a walkthrough file is of; null for any other file. */
    run: string | null;
  }
  export interface PublishedReport {
    /** Its site's folder on the site; "demo" for the demo's. */
    folder: string;
    /** Its anchor: "report-<folder>-<seq>", or "report-demo". */
    id: string;
    at: string;
    by: string;
    files: PublishedFile[];
    /** Each file the record names that isn't published: changed since it was shared, or missing. */
    notPublished: { name: string; reason: "changed" | "missing" }[];
  }
  export interface SiteContent {
    demo: PublishedReport | null;
    /** By folder name; each site's reports the newest first. */
    sites: { folder: string; reports: PublishedReport[] }[];
  }
  export function renderSiteIndex(content: SiteContent, assets: { fontCss: string }): string;
  ```
- **A file's kind,** by its extension: `.html` is the page, `.docx` the Word copy, `.json` a walkthrough file, and anything else other.
- **`SITE_TEXT`:**
  - The title and `<h1>`: "Screen reader test results".
  - The lead: "Each report is a person's review of a website with a real screen reader, sped up by voicecap. Every word in a report is what the screen reader said, and every decision in it is a person's."
  - The bar's `nav` label: "Views". Its links, as the views' headings:
    - "The demo", whose lead is "voicecap's report on its own small demo site, as an example of what it makes.";
    - "The sites", whose lead is "Each site's reports, the newest first." With none: "No reports have been shared yet.";
    - "Every report, by date", whose lead is "Every site's reports, the newest first, each with its page."
  - A site's count: "1 report" or "<n> reports".
  - A report's line: "<longDate(at)>, <clock(at)>". Then "Prepared by <by>".
  - The files' labels:
    - "The report, to open";
    - "The Word copy";
    - "The walkthrough file of run <run>", or "A walkthrough file" with no run;
    - "A file".
  - With no walkthrough file: "No walkthrough file was shared with this report."
  - A file that isn't published:
    - "<name> isn't here: it no longer matches the fingerprint recorded when it was shared.";
    - "<name> isn't here: the file is missing."
  - Under the views:
    - "A file's SHA-256 fingerprint is the one recorded when it was shared, so a copy can be checked against it: `Get-FileHash <file>` in PowerShell, or `shasum -a 256 <file>` on a Mac. PowerShell shows the same letters in capitals." Use `POWERSHELL_HASH` and `MAC_HASH` from `src/share/text.ts`.
    - "A walkthrough file repeats its run, with the same pages, passes, and limits: `npx @icjia/voicecap --walkthrough <file>`."
  - The footer: `ABOUT`, and "Made with voicecap" linking to `https://github.com/ICJIA/voicecap`.
  - The theme button: "Light version" and "Dark version", as the page has them.
- **The markup, in order:**
  1. `<html lang="en">`, `<meta charset>`, viewport, `<meta name="robots" content="noindex, nofollow, noarchive">`, the title, then the style block: `\n${fontCss}\n${SITE_CSS}`.
  2. A skip link to `#main`.
  3. `<header class="bar">` with the `nav` and the theme button (`hidden` until the script shows it).
  4. `<main id="main">`:
     - `h1` and the lead;
     - the views as `section`s with ids `demo` (only when there's a demo), `sites`, and `by-date`;
     - a site is a `section` with an `h3` of its folder and its count;
     - a report is an `article` with an `h4` of its line, its "Prepared by", a list of its files, its "isn't here" lines, and the no-walkthrough line when it has no walkthrough file;
     - the demo's report heading is an `h3`;
     - "Every report, by date" is an `ol` across the sites (not the demo), sorted by `Date.parse(at)`, newest first. Each item has `<time datetime="<at>">`, the folder, "prepared by <by>", and a link to its page named by the file's name, or "its page isn't here".
  5. The footer.
  6. Last, `<script>${SITE_SCRIPT}</script>`.
- **A file's item:** its label, a link named by the file's name (`download` on every link but the page's), `sizeWords(bytes)`, and `SHA-256` with the fingerprint in `<code>`.
- **Escaping:** every text and attribute through `esc` (`src/report/html.ts`).
- **`SITE_SCRIPT`** is the page's theme part only, with the same key, `voicecap-theme`.
- **`SITE_CSS`** begins with `THEME_CSS`.
  - It takes the page's rules for visible keyboard focus (`:focus-visible`), the skip link, `.sr`, and `[hidden]` as they are.
  - The bar is `position: sticky` at 640 px and wider, with a `scroll-padding-top` that keeps whatever has focus, or a link points to, below it.
  - Long names and fingerprints wrap: `overflow-wrap: anywhere`.

- [ ] **Step 1: Write the failing tests.**
  - In `test/site-render.test.ts`, on a `SiteContent` with a demo, two sites, three reports, a not-published file, and a report with no walkthrough file:
    - `it("is one file: one style block, one script last, no style attribute, nothing from outside")`:
      - no `src=`, `srcset`, `<link`, `<iframe`, `@import`, or `url(http`;
      - `inlineHashes` gives one style hash and one script hash.
    - `it("links only to its files, its own anchors, and voicecap's GitHub page")`:
      - every `.docx` and `.json` link has `download`, and the page's link doesn't.
    - `it("puts its headings in order")`: `h1`; an `h2` per view; `h3` sites and the demo's report; `h4` reports.
    - `it("lists each report's files with their labels, sizes, and fingerprints")`.
    - `it("says what isn't here, and when no walkthrough file was shared")`.
    - `it("lists every report by date across the sites, newest first, without the demo")`.
    - `it("has no demo view, and no link to one, without a demo")`.
    - `it("says no reports have been shared yet when there are none")`.
    - `it("escapes what the record holds")`: a `by` of `<img src=x onerror=alert(1)>` and a name with `&` come out escaped.
  - In `test/site-page-browser.test.ts`, with Chromium via `launchBrowser` (`test/helpers/axe.ts`), the page opened from a file:
    - `it("passes axe with zero violations, dark and light")`;
    - `it("fits a window 320 pixels wide")`: `scrollWidth <= 320`;
    - `it("never hides what has focus under the bar, 1100 pixels wide")`. Tab through every link and the button: `document.elementFromPoint` at the focused element's center is it, or inside it.
    - `it("switches the theme and keeps the choice")`, under `voicecap-theme`;
    - `it("is complete without JavaScript")`: every view and file is there, and the theme button is hidden.
- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/site-render.test.ts test/site-page-browser.test.ts`. Expected: FAIL, since the modules aren't there.
- [ ] **Step 3: Write the four modules, and export `THEME_CSS`.**
- [ ] **Step 4: Check the shareable page didn't change.**
  - Run `pnpm share:fixture <a folder>` before the change to `style.ts` and after it, into two folders.
  - Expected: `cmp` of the two `demo.html` files prints nothing.
  - Then run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "The site's page: every shared report, by site and by date, with the demo"`.

### Task 5: `buildSite`

**Files:**
- Create: `src/site/build.ts`, `test/helpers/site-home.ts`
- Modify: `src/run/git-files.ts`. `GITIGNORE` gains `# the website voicecap site builds,` and `_site/`, before `# and files the operating system adds.`, and its doc comment says so.
- Test: `test/site-build.test.ts`, `test/git-files.test.ts`

**Interfaces:**
- Consumes:
  - `readSiteRecords` (Task 2);
  - `inlineHashes`, `contentSecurityPolicy`, `headersFile`, `HEADERS_FIRST_LINE`, `ROBOTS_TXT`, and `ensureNetlifyFiles` (Task 3);
  - `renderSiteIndex` and `SiteContent` (Task 4);
  - `fontFaceCss`;
  - `voicecapVersion`.
- Produces:
  ```ts
  export interface BuildSiteOptions {
    /** The transcripts home. Default: VOICECAP_TRANSCRIPTS, else "transcripts". */
    home?: string;
    /** The folder to build the site in. Default: _site in the home. */
    out?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    logger?: Logger;
  }
  export interface BuildSiteResult {
    /** The folder the site was built in, as a full path. */
    out: string;
    content: SiteContent;
    /** Each thing left out, as the build's output said it. */
    leftOut: string[];
  }
  export async function buildSite(options?: BuildSiteOptions): Promise<BuildSiteResult>;
  ```
- `test/helpers/site-home.ts`: `homeWithShares(): Promise<string>`, a home in a temporary folder:
  - a copy of the demo fixture home, shared twice (`_<day>` and `_<day>-2`), with a fixed `now`;
  - `example.illinois.gov/` with a date folder and a hand-sealed `shares.json` naming two small files in its `share/`;
  - `voicecap-demo/127.0.0.1_4848/`, a copy of the fixture's site folder, shared once with `out: <home>/voicecap-demo`.

- [ ] **Step 1: Write the failing tests.**
  - In `test/site-build.test.ts`, on `homeWithShares()`:
    - `it("publishes every shared file byte for byte, under its site's folder, and the demo's under demo/")`.
    - `it("writes index.html, robots.txt, and _headers")`. `_headers`:
      - starts with `HEADERS_FIRST_LINE`;
      - has `/` and `/index.html` with the index's policy;
      - has each page at `/<folder>/<name>` and at `/<folder>/<name without .html>`, with the policy of that page's own bytes;
      - has each `.docx` and `.json` with `Content-Disposition: attachment`.
    - `it("leaves out a copy changed since it was shared, names it, and publishes the rest of its report")`:
      - setup: one byte of a Word copy is changed;
      - the copy isn't in the output folder;
      - `leftOut` and a warning say `<path>: not published: it no longer matches its fingerprint`;
      - the site's page has the "isn't here" line;
      - the report's other files are published.
    - `it("leaves out a missing copy, and names it")`.
    - `it("leaves out an entry changed since it was recorded, and names it")`.
    - `it("refuses to build into the home, a folder holding it, a site's folder, or a folder of other files, and deletes nothing")`. Each gives a `UsageError`, and every file there is as it was.
    - `it("empties a folder it built before")`: a file left by an earlier build is gone.
    - `it("writes netlify.toml and .nvmrc into the home once")`: a second build leaves an edited `netlify.toml` as it was.
    - `it("says to add _site/ to a .gitignore that doesn't keep it out")`:
      - the warning is `<home>'s .gitignore doesn't keep _site/ out of Git, so the built site could be committed with the records. Add the line _site/ to it.`;
      - there's no warning with the new `GITIGNORE`.
    - `it("builds the site of a home that shared nothing")`.
    - `it("builds from the home in effect, with no config anywhere")`: `VOICECAP_TRANSCRIPTS` is set, and `cwd` is an empty folder.
    - `it("says what it built")`: `Built the site in <out>: 2 reports from 2 sites, and the demo's.`, with the right counts.
  - In `test/git-files.test.ts`: `GITIGNORE` has `_site/`.
- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/site-build.test.ts test/git-files.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write `buildSite`, in this order:**
  1. **The home** comes from `resolveHome({ out: options.home, env, cwd })`. If it isn't a folder: `UsageError("<home> isn't a folder, so there's no transcripts home to build the site from.")`.
  2. **The output folder** is resolved with `resolveUserPath`.
     - Refuse it before anything is touched when:
       - it's a file, not a folder;
       - it's the home;
       - it holds the home;
       - it's inside a site's folder or `voicecap-demo/`;
       - it's there, and isn't empty, and its `_headers` doesn't start with `HEADERS_FIRST_LINE`.
     - The refusal: `voicecap site won't build into <out>: <why>. Give a folder of its own, such as <home>/_site.`
     - Otherwise, remove the folder (`rm` with `recursive`, `force`, and `maxRetries: 3`) and make it again.
  3. **Publish each kept entry's files**, and the demo's under `demo/`.
     - Each file is read once, checked against its size and SHA-256, and written from those same bytes to `<out>/<folder>/<name>`.
     - A mismatch is `changed`, and `ENOENT` is `missing`.
     - Each becomes a `notPublished` item and a `leftOut` line.
  4. **Order:** sites by folder name, and each site's reports by `Date.parse(at)`, newest first, the higher `seq` on a tie.
  5. **Write the rest:** `index.html`, `robots.txt`, and `_headers` (the rules of Step 1). Then `ensureNetlifyFiles(home, voicecapVersion())`, logging `Wrote <name> into <home>, for Netlify: commit it with the records.` for each file written.
  6. **The `.gitignore` check,** when the output folder is `<home>/_site`. A `_site` line counts as `_site`, `_site/`, `/_site`, or `/_site/`, trimmed.
  7. **Report:** warn each `leftOut` line, then log the summary.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS. A test that pinned `GITIGNORE`'s whole text gains the two lines.
- [ ] **Step 5: Commit:** `git commit -m "Build the website from what was shared, byte for byte, with its headers"`.

### Task 6: `voicecap site`, the API, `pnpm site:fixture`, and the site served as Netlify serves it

**Files:**
- Modify:
  - `src/cli/main.ts`: the command;
  - `src/index.ts`: the exports;
  - `package.json`: the `site:fixture` script;
  - `.github/workflows/ci.yml`: the smoke step.
- Create: `scripts/site-fixture.ts`, `test/helpers/site-server.ts`
- Test: `test/cli.test.ts`, `test/site-served.test.ts`

**Interfaces:**
- **The command:** `voicecap site [--home <dir>] [--out <dir>]`.
  - Description: "build the website of every shared report, for Netlify: index.html, each report's files, robots.txt, and _headers".
  - `--home <dir>`: "the transcripts home (default: VOICECAP_TRANSCRIPTS, else ./transcripts)".
  - `--out <dir>`: "the folder to build it in (default: _site in the home); a folder voicecap site built is emptied first".
- **The API:** `buildSite`, the types `BuildSiteOptions` and `BuildSiteResult` (`src/site/build.ts`), and `SiteContent`, `PublishedReport`, and `PublishedFile` (`src/site/render.ts`).
- **`pnpm site:fixture <folder>`:** makes `homeWithShares()`'s home in `<folder>/home`, builds the site into `<folder>/_site`, and prints `index.html`'s path.
- **`test/helpers/site-server.ts`:** `serveSite(dir: string): Promise<{ url: string; close(): Promise<void> }>`.
  - It serves `dir` with `serveStatic` (`src/util/static-site.ts`).
  - It adds each `_headers` rule's headers to the response for its exact path.

- [ ] **Step 1: Write the failing tests.**
  - In `test/cli.test.ts`:
    - `it("builds the site with voicecap site")`: `--home` is `homeWithShares()`, `--out` is a temporary folder, the exit code is 0, and `index.html` is there.
    - `it("lists site in voicecap --help")`.
  - In `test/site-served.test.ts`, on the built site served by `serveSite`, in Chromium:
    - `it("runs every page under its own policy, with no violation")`:
      - `securitypolicyviolation` events are collected by an init script, and none occur on `/` or on any published page;
      - the index's theme button shows;
      - a report's "Check the fingerprints" says everything matches.
    - `it("runs an older page under its own policy")`:
      - setup: a hand-sealed entry names a page whose script text differs (an added comment);
      - its script runs, and there's no violation.
    - `it("downloads a Word copy and a walkthrough file as attachments")`:
      - Playwright's `download` event gives the file's bytes;
      - each response has `Content-Disposition: attachment`.
    - `it("carries the theme from the site to a report")`.
- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/cli.test.ts -t "site" test/site-served.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the command, the exports, the script, and the server helper.** Add to CI's smoke step:
  ```bash
  home="$RUNNER_TEMP/site-home"
  cp -R test/fixtures/share/demo-2026-09-29 "$home"
  node dist/cli.js share --out "$home" --reviewer CI
  node dist/cli.js site --home "$home" --out "$home/_site"
  test -f "$home/_site/index.html"
  grep -q "^/index.html$" "$home/_site/_headers"
  node dist/cli.js verify --out "$home"
  ```
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then run the smoke step's lines through `dist/`.** Expected: PASS, and the step exits 0.
- [ ] **Step 5: Commit:** `git commit -m "voicecap site, its API, and the site checked as Netlify serves it"`.

### Task 7: The docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `src/share/text.ts` (`TIMELINE`), `docs/phase-c-handoff.md`
- Test: `test/share-text.test.ts`

- [ ] **Step 1: Update the timeline's tests** in `test/share-text.test.ts`.
  - `it("tells the website in a row of its own, across both tracks, after 0.8.0's")` finds the row by its day with no release. Its `both` is: `The website: <code>voicecap site</code> builds a site of every shared report, by site and by date, with each one's page, Word copy, and walkthrough files, and their fingerprints.`
  - Next's PC cell is `The event log, screenshots, and NVDA's own log, recorded at the PC.` Its Mac cell is unchanged.
  - Run: `pnpm exec vitest run test/share-text.test.ts`. Expected: FAIL.
- [ ] **Step 2: The timeline.** Add the row, dated the day the branch merges, and change Next.
- [ ] **Step 3: The README.**
  - **"voicecap in brief"'s line for any computer:** add `site`.
  - **Contents:** add the new section.
  - **"Other commands":** add the `voicecap site` line, and "**`site` takes two options:** …", as `share`'s paragraph does.
  - **"Sending it: `voicecap share`":** it writes each run's walkthrough file, with its name, recorded with its run. The email line names the page and the Word copy only.
  - **"What was sent: `shares.json`":** walkthrough files, and `run`.
  - **"The transcripts folder"'s layout:** the walkthrough copies in `share/`; `_site/`, `netlify.toml`, and `.nvmrc` at the home's top.
  - **"What `.gitignore` keeps out":** `_site/`, and the line for an older home.
  - **"Before you send it":** everything on the site is public to anyone with its address.
  - **A new section, "The website: `voicecap site`",** after "What was sent: `shares.json`":
    - what's on it;
    - what the build reads, and what it leaves out and names;
    - the files it writes, and the headers;
    - publishing: share, commit, and push, and Netlify builds;
    - the first deploy, as numbered steps:
      1. run `voicecap site` once;
      2. add `_site/` to `.gitignore` if voicecap says to;
      3. commit `netlify.toml` and `.nvmrc`, and push;
      4. in Netlify, import `ICJIA/voicecap-transcripts` and name the site `icjia-voicecap`;
      5. open the site and check it;
    - the demo on the site: run `voicecap demo` in the home's folder, then `voicecap share --out voicecap-demo`;
    - that a share is never deleted, so the site shows every one.
  - **"Programmatic API":** `buildSite` and its types, and `readShares`'s type.
- [ ] **Step 4: The CHANGELOG and the handoff.**
  - **CHANGELOG, under `[Unreleased]`:**
    - Added: the website (`voicecap site`), the walkthrough copies `share` makes (`SharedFile.run`), and the API.
    - Changed: `readShares`'s type (a compile-time change), and a new home's `.gitignore` (`_site/`).
  - **The handoff:**
    - "Being built": plan 5 merged and not published, and plan 6 next.
    - The test count.
- [ ] **Step 5: Run `pnpm lint && pnpm typecheck && pnpm test`, and the README check:** folds balanced, no heading in a fold, every in-page link landing. Expected: PASS. Then commit: `git commit -m "Document the website"`.

## For the owner, once it's built

No screen reader is needed for any of this:

1. `pnpm site:fixture C:\Users\cschw\voicecap-site` builds the site from the demo fixture. Open `C:\Users\cschw\voicecap-site\_site\index.html` and check:
   - the three views;
   - the theme button;
   - a report's page;
   - downloading a Word copy and a walkthrough file.
2. Read the site's fixed text (`SITE_TEXT`) and the README's new section.
3. After the release, do the first deploy, using the README's numbered steps.

## Not in this plan

- **The evidence recorded at the PC** (plan 6).
- **Taking a report off the site.** A share is never deleted, so the site shows every one. A way to withdraw one would be its own decision.
- **Search, or naming a site by its report's headline.**
- **Hosting anywhere but Netlify.** `_headers` is Netlify's format. Cloudflare Pages reads the same file, but that's untested.
- **Committing or pushing.** voicecap never does either; publishing is the owner's push.

## After execution

The plan was built as written, with the rulings below, fix rounds after several task reviews, and a final wave of fixes after the whole-branch review. The ledger (`.superpowers/sdd/2026-10-03-shareable-report-plan-5-website/progress.md`, on the Windows PC) has each ruling's full text.

**Where the plan's text is wrong, as built:**

- **Task 2:**
  - An entry is named as `verify` names it, "share 2 (<at>)", not "entry 2" (Ruling Q5).
  - A published file's name also can't start or end with a dot, and must end with `.html`, `.docx`, or `.json` in lower case (Rulings Q8, Q12, Q19).
  - An entry's `at` must be one the site can write, and a file's `run` a run id (Ruling Q11).
  - An entry with no file to publish is left out whole (Ruling Q10).
- **Task 4:**
  - The bar is sticky from 40em, not 640px (Ruling Q15).
  - A site's section isn't a named region (Ruling Q16).
  - The site's lists carry `role="list"` (Ruling Q14).
  - The lead's second sentence is "Every transcript in a report is what the screen reader said, word for word, and every decision in it is a person's." (Ruling Q22).
- **Task 5:**
  - The summary line's counts are `homeWithShares()`'s, "3 reports from 2 sites" (Ruling Q1).
  - It also refuses a folder that looks built but holds a dot name or a folder inside a folder, with an operating system's own files allowed (Rulings Q17, Q20). On Windows, it refuses a folder whose name ends with a dot or a space.
  - It also leaves out a copy that's unreadable or isn't a regular file, a `voicecap-demo` that isn't a folder, site folders named `index.html`, `robots.txt`, or `_headers`, and a page named `index.html` (Rulings Q7, Q18).
- **Task 7:**
  - The first deploy names the site afterwards, from the project's overview, when the import page has no field for it.
  - The README states Netlify's plan requirement for a private organization repository (Ruling Q23).

**The rulings that changed the plan:**

- **Q1, the summary's counts:** the helper's home's.
- **Q2, a file's kind:** `fileKind`, one rule in `render.ts`.
- **Q3, commands on the site's page:** in `<code>`, with no backtick.
- **Q4, wording left over from Task 1:** placed where each file was next touched.
- **Q5, naming an entry:** `describeShare`'s words.
- **Q6, an entry that can't be named:** "a share".
- **Q7, reading a copy:** only a regular file, by `lstat`.
- **Q8 and Q12, a file name's edges:** no leading or trailing dot.
- **Q9, `describeShare`'s fallback:** `verify` no longer crashes on such an entry.
- **Q10, an entry with no file to publish:** left out.
- **Q11, `at` and `run`:** checked by `longDate` and `isRunId`.
- **Q13, the no-walkthrough line:** only when the record names none.
- **Q14, `role="list"`:** on the site's lists, for VoiceOver.
- **Q15, the bar:** sticky from 40em.
- **Q16, sites:** not landmarks.
- **Q17, a folder that looks built:** refused when it holds a dot name or a nested folder; paths compared by their real place.
- **Q18, a copy's size:** checked first; an unreadable copy is left out, and the build goes on.
- **Q19, what's published:** only voicecap's three kinds of file.
- **Q20, an operating system's files:** they don't count against a built folder.
- **Q21, `SharesAsRead`:** exported.
- **Q22, the lead:** each transcript is word for word.
- **Q23, Netlify's plan:** stated in the README; the design is unchanged (the owner is on Netlify Pro).

**At the owner's request,** the README gained a section near its top, "Why voicecap, and who it's for": the two halves of an accessibility review, how voicecap is different, and stories of the people it's made for. The stories were written for the README and are labeled as composites, not quotes. A review checked each claim in it against what voicecap does.

**Items carried to later plans:**

- **The full security audit,** once every phase is done:
  - `voicecap verify` prints a `shares.json` entry's time and file names raw, and throws on an entry nested thousands of levels deep;
  - Netlify's `_headers` parser and header names (unreachable today);
  - `voicecap share`'s warning prints a run id raw for a hand-edited `run.json`;
  - one printing escape, with the wider class `walkthrough.ts` uses;
  - a deploy by hand doesn't apply `netlify.toml`'s headers, such as `X-Robots-Tag`.
- **Later:**
  - test-helper polish: the download test, the alias paths, `rulesOf` and wildcards, `serveSite`'s 500;
  - comments: the bar's "one line", the reader's CR;
  - moving the page reader and `writeIfMissing` to modules of their own;
  - the CI step's name;
  - a brand-new folder holding only `.DS_Store`, which still counts as not empty;
  - "`voicecap verify` can show that nothing has changed since", in the README's six steps, the shareable page's own steps (`src/share/text.ts`), the diagram (`assets/how-voicecap-works.svg` and its PNG), and the spec, to say what the README's new section says. All four change together.
- **For the owner:**
  - the first deploy, by the README's steps;
  - on the Mac: WebKit and VoiceOver with the site's lists and its sticky bar;
  - once deployed: check that a report's page, at its address with and without `.html`, comes with its `Content-Security-Policy`.
