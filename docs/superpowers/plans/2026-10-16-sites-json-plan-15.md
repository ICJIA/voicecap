# Plan 15: the website's sites as JSON (`sites.json`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `voicecap site` also writes `sites.json` at the website's top: each site's name, its address, the link to its section on the front page, and its current report's time, verdict, and page, so that another website, such as ICJIA's documentation index, can link each site's results and keep their date and verdict current.

**Architecture:** A pure `renderSitesJson(content)` in `src/site/render.ts`, beside `renderLlmsTxt`, from the same `SiteContent`. The ids of the sites' sections come from one function (`withSectionIds`), shared with the front page, so a link in the file can't drift from the id on the page. The build writes the file after `llms.txt`, keeps a site folder from taking its name, and gives it the JSON type and the AI files' policy in `_headers`.

**Tech Stack:** TypeScript (strict), Vitest, Playwright (the served-site tests).

**Spec:** none written. The owner asked on 2026-10-16 for docs.icjia.app, ICJIA's documentation index, to show an "NVDA Accessibility" card in each site's section, pointing to that site's results on voicecap's website and kept current on every deploy, and skipped the questions ("just start on the cards"). The docs side is its own plan, in the icjia-docs repository (`specs/2026-10-16-nvda-accessibility-cards.md`). The decisions this plan makes are in Global Constraints.

## Global Constraints

- **The file:** `sites.json`, at the website's top, beside `llms.txt`. UTF-8 JSON, with two spaces of indent and a line break at its end, its keys in the order below. The same records and the same voicecap write the same bytes: nothing in it is the time of the build.
- **Its shape, format 1:**

  ```json
  {
    "format": 1,
    "sites": [
      {
        "name": "dvfr.illinois.gov",
        "address": "https://dvfr.illinois.gov/",
        "href": "./#site-dvfr.illinois.gov",
        "current": {
          "shared": "2026-10-03T14:05:00-05:00",
          "status": "ok",
          "verdict": "Nothing needs attention",
          "reading": "NVDA read all 9 pages.",
          "page": "dvfr.illinois.gov/dvfr.illinois.gov_2026-10-03.html"
        }
      }
    ]
  }
  ```

  - `sites`: the front page's sites, in its order. The demo is never one.
  - `address`: where people visit the site, the root that names it (`SiteContent`'s `address`); `null` for a site its folder names.
  - `href`: the site's section on the front page, relative to `sites.json`: `./#` and the id the page gives the section, with the page's `-2`, `-3` for a second name that writes to the same id.
  - `current`: the site's current report, its first. `shared` is the share's `at`, as recorded. `status` is `verdictOf`'s kind (`ok`, `warn`, or `bad`), `verdict` its headline, and `reading` the card's `SITE_TEXT.reading`; all three are `null` for a report with no verdict to give (`hasVerdict`). `page` is its page's address, from the site's top, or `null` when its page isn't published. `current` is `null` for a site with no report.
  - Every link is relative to the file, as `llms.txt`'s are: the build knows no address of the website.
- **`_headers`:** `/sites.json` gets `Content-Type: application/json; charset=utf-8` (`JSON_TYPE`) and `Content-Security-Policy: default-src 'none'; sandbox` (`AI_FILE_POLICY`), as a share's JSON does.
- **`OWN_FILES`** gets `sites.json`: a site folder of that name is left out and named, as for `llms.txt`.
- **The release:** 0.20.0, a minor (a new file on the website), with its CHANGELOG entry and its timeline row ("How voicecap came to be", `TIMELINE` in `src/share/text.ts`), and the three pinned reports re-pinned for that row. The website builds with it once the transcripts repository's `netlify.toml` names `@icjia/voicecap@0.20.0`.
- **Commits:** one subject line each, with no trailers.
- **Words:** plain, as the rest of the README and Technical details. voicecap is never called automated testing or an automated checker.

## Review Focus

1. **A site name that the page writes differently in its id** (`example.gov:8080` is `site-example.gov_8080`), and two names that write to one id: `href` must be the id the page gives, `-2` included. Task 1 pins both against the page's own HTML.
2. **A current report with no verdict**, shared before 0.12.3 (no `result`) or with a result of no page: `status`, `verdict`, and `reading` are `null`, never "Nothing needs attention". Task 1.
3. **A current report whose page changed after it was shared,** so the build left it out: `page` is `null`, and the site is still listed. Task 1.
4. **A site its folder names** (a share from before 0.10.0): `address` is `null`, and the site is listed, as the front page lists it. Task 1.
5. **A name with quotes, a backslash, or a control character:** the file is still valid JSON, and the name comes back as it was. Task 1.

---

### Task 1: `renderSitesJson`, with the sections' ids shared with the front page

**Files:**
- Modify: `src/site/render.ts` (the sites' view, `sitesView`, takes its ids from the new `withSectionIds`; `renderSitesJson` and its types go after `renderLlmsTxt`)
- Test: `test/site-render.test.ts` (a new `describe("renderSitesJson")`, after `renderLlmsTxt`'s)

**Interfaces:**
- Produces: `withSectionIds(sites: SiteContent["sites"]): [site, id][]` (the module's own), each site with the id of its section, in order, as the page gives them; `export interface SitesJson { format: 1; sites: SitesJsonSite[] }`; `export interface SitesJsonSite { name: string; address: string | null; href: string; current: SitesJsonReport | null }`; `export interface SitesJsonReport { shared: string; status: VerdictKind | null; verdict: string | null; reading: string | null; page: string | null }`; `export function renderSitesJson(content: SiteContent): string`.

- [ ] **Step 1: Write the failing tests**, with the fixtures of `test/helpers/site-content.ts` (`CONTENT` is dvfr.illinois.gov, with its address and `DVFR_NEWEST` current, and example.illinois.gov, with no address; neither records a result):
  - `it("lists each site of the page, in its order, with its name, its address, the link to its section, and its current report")`: `JSON.parse(renderSitesJson(CONTENT))` equals `{ format: 1, sites: [{ name: DVFR, address: DVFR_ADDRESS, href: "./#site-dvfr.illinois.gov", current: { shared: "2026-10-03T14:05:00-05:00", status: null, verdict: null, reading: null, page: "dvfr.illinois.gov/dvfr.illinois.gov_2026-10-03.html" } }, { name: EXAMPLE, address: null, href: "./#site-example.illinois.gov", current: { shared: "2026-10-02T09:30:00-05:00", status: null, verdict: null, reading: null, page: "example.illinois.gov/example.illinois.gov_2026-10-02.html" } }] }`; the text ends with `"\n"` and is `JSON.stringify(parsed, null, 2) + "\n"`.
  - `it("says the verdict as the site's card says it, and none for a report that records no result or no page")`: with `result` `{ pages: 9, read: 9, problems: 0, problemPages: 0 }` the first site's `current` has `status: "ok"`, `verdict: "Nothing needs attention"`, `reading: "NVDA read all 9 pages."`; `{ pages: 32, read: 32, problems: 1, problemPages: 32 }` gives `"warn"`, `"1 problem needs attention, on 32 pages"`, `"NVDA read all 32 pages."`; `{ pages: 9, read: 7, problems: 0, problemPages: 0 }` gives `"bad"`, `"Nothing needs attention on the pages read"`, `"NVDA read 7 of the 9 pages."`; `{ pages: 0, read: 0, problems: 0, problemPages: 0 }` and no result give `null` for all three.
  - `it("links each site to the id its section has on the page, -2 for a second name written to the same id")`: content with sites named `"example.gov:8080"` and `"example.gov_8080"` gives hrefs `"./#site-example.gov_8080"` and `"./#site-example.gov_8080-2"`, and `renderSiteIndex(content, FACTS)` has `id="site-example.gov_8080"` and `id="site-example.gov_8080-2"`.
  - `it("gives no page when the current report's page isn't published, and no current report for a site with none")`: a current report whose `files` hold no `page` gives `page: null`; a site with `reports: []` gives `current: null`.
  - `it("never lists the demo, and is an empty list when no site has a report")`: `{ demo: DEMO_REPORT, sites: [] }` renders `{ format: 1, sites: [] }`, and no text of `renderSitesJson(CONTENT)` holds `"demo"`.
  - `it("keeps a name with quotes, a backslash, or a control character whole, in valid JSON")`: a site named `'a"b\\c\u0007d'` parses back to that name.
  - `it("is the same for the same content")`: `renderSitesJson(CONTENT)` equals `renderSitesJson(structuredClone(CONTENT))`.

- [ ] **Step 2: Run them, and see them fail**

  Run: `pnpm exec vitest run test/site-render.test.ts -t renderSitesJson`
  Expected: FAIL, `renderSitesJson` is not exported.

- [ ] **Step 3: Implement `withSectionIds` and `renderSitesJson` in `src/site/render.ts`.** `withSectionIds` is the loop `sitesView` has now (`uniqueId(\`site-${folderSafe(name)}\`, taken)` over the sites, one `taken` set), and `sitesView` maps each site with its id from it. `renderSitesJson` builds a `SitesJson` and returns `JSON.stringify(value, null, 2) + "\n"`, with `verdictOf` and `hasVerdict` for the verdict, `SITE_TEXT.reading` for `reading`, and `fileOf(current, "page")?.href ?? null` for `page`. Its doc comment says what it is for, as `renderLlmsTxt`'s does.

- [ ] **Step 4: Run the file's tests, and see them pass**

  Run: `pnpm exec vitest run test/site-render.test.ts`
  Expected: PASS, the front page's own tests included.

- [ ] **Step 5: Commit**

  `git commit -m "Write each site of the website, its address, the link to its section, and its current report's time, verdict, and page as sites.json's text, with the sections' ids from one function the front page uses too"`

### Task 2: the build writes `sites.json`, with its type and its policy

**Files:**
- Modify: `src/site/build.ts` (a `SITES_FILE` constant beside `LLMS_FILE`, in `OWN_FILES`; written after `llms.txt`; its rule in `headerRules`, after the four pages'; the top comment and `buildSite`'s comment name it)
- Test: `test/site-build.test.ts`, `test/site-served.test.ts`

**Interfaces:**
- Consumes: `renderSitesJson(content: SiteContent): string` (Task 1); `JSON_TYPE` and `AI_FILE_POLICY` from `src/site/headers.ts`.

- [ ] **Step 1: Write the failing tests**
  - In `test/site-build.test.ts`: the list of the files a build writes at the site's top (the constant near line 233) gains `"sites.json"`; the test of the same four pages and `llms.txt` for the same records "whatever the day" covers `sites.json` too; `it("writes sites.json: each site, the link to its section, and its current report")` reads `sites.json` from the built folder and expects it to be `renderSitesJson(content)` of the build's own content; `it("leaves out a site folder named sites.json, and names it")` expects a warning line `sites.json: not published: a site folder named sites.json would take the place of the site's own sites.json`; and `_headers` has the rule `/sites.json` with `Content-Type: application/json; charset=utf-8` and `Content-Security-Policy: default-src 'none'; sandbox`.
  - In `test/site-served.test.ts`: `it("serves sites.json as JSON, at the site's top, with each link answering")` gets `sites.json` from the served site, expects `content-type` `application/json; charset=utf-8`, the body to be the built file, and each site's `href` (resolved against the file's address) to be the front page with a fragment that names an element on it, and each `page` to answer 200.

- [ ] **Step 2: Run them, and see them fail**

  Run: `pnpm exec vitest run test/site-build.test.ts test/site-served.test.ts`
  Expected: FAIL, no `sites.json` in the built folder.

- [ ] **Step 3: Implement it in `src/site/build.ts`,** as `llms.txt` is done, and its `_headers` rule as a share's JSON's is.

- [ ] **Step 4: Run the site's tests, and see them pass**

  Run: `pnpm exec vitest run test/site-build.test.ts test/site-served.test.ts test/site-render.test.ts test/site-headers.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "Write sites.json at the website's top, sent as JSON with the AI files' policy, and leave out a site folder of that name"`

### Task 3: say it on Technical details, in the README, and in the CHANGELOG

**Files:**
- Modify: `src/site/technical-text.ts` (a point after `llms.txt`'s, in what's published); `README.md` (the files the build writes, the names a site folder can't have, a short part on `sites.json` after `llms.txt`'s, and the API's `buildSite` line if it lists the files); `CHANGELOG.md` (`## [Unreleased]`, `### Added`)
- Test: `test/site-technical.test.ts` (the expected points, near line 805)

- [ ] **Step 1: Write the failing test.** Technical details' published points include, after `llms.txt`'s: `sites.json at the website's top, which lists each site, the link to its part of this page, and its current report's date and verdict, for another website to link to.`
- [ ] **Step 2: Run it, and see it fail.** Run: `pnpm exec vitest run test/site-technical.test.ts` Expected: FAIL on the missing point.
- [ ] **Step 3: Add the point; write the README's part,** with the format, an example, and what a hub does with it (ICJIA's documentation index makes a card of each site's current report from it, and rebuilds when the website deploys); and the CHANGELOG's entry. In "Why the sound matters", "Only listening tells you whether it makes sense." becomes "Only what the screen reader says tells you whether it makes sense.", and in "Two different checks", "Listening can't measure contrast" becomes "A listen-through can't measure contrast", the owner's words for what voicecap is.
- [ ] **Step 4: Run the tests and the checks.** Run: `pnpm lint && pnpm typecheck && pnpm exec vitest run test/site-technical.test.ts` Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Say what sites.json holds, on Technical details, in the README, and in the CHANGELOG"`

### Task 4: prepare 0.20.0, release it, and build the website with it

- [ ] **Step 1: Prepare.** The CHANGELOG's entry becomes `## [0.20.0] - <day>`; `TIMELINE` gets the row `{ date: "<day>", release: "0.20.0", pc: null, mac: null, both: "<b>0.20.0</b>: sites.json, each site's current report as JSON, for another website to link to, such as ICJIA's documentation index." }` before the "Next" row; the three pinned reports in `test/share-document.test.ts` and `test/share-word-evidence.test.ts` are re-pinned (sizes and SHA-256 from the failing run, as "Prepare 0.19.0" did), with the timeline's last dated row's day. Run `pnpm test`; expect PASS. Commit: `git commit -m "Prepare 0.20.0: its CHANGELOG entry, the timeline's row, and the three pinned reports re-pinned for it"`.
- [ ] **Step 2: CI on the branch,** then merge to `main` and push. Expect all six jobs and the smoke test to pass.
- [ ] **Step 3: The owner releases it:** `./publish.sh --dry-run minor`, then `./publish.sh minor`, with a fresh 6-digit code typed at its prompt. Never with a code on the command line, and never a code from the chat.
- [ ] **Step 4: Build the website with 0.20.0.** In `ICJIA/voicecap-transcripts`, `netlify.toml`'s command names `@icjia/voicecap@0.20.0`. Commit: "Build the website with voicecap 0.20.0", and push. Expect Netlify's deploy of that commit to be ready, and `https://voicecap.icjia.app/sites.json` to answer with `application/json; charset=utf-8` and list dvfr.illinois.gov, r3.illinois.gov, sfs.icjia.illinois.gov, and v3--i2i.netlify.app.
