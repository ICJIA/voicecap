# Canonical site names (0.10.0) Implementation Plan

**Goal:** Everything voicecap makes for readers names a site by its canonical address, and leads with its canonical name and a date and time, never an IP address or a local address. That means the shareable page, its Word copy, the website, the names of shared copies, the run report, and the README's screenshots. A run on a copy at `localhost` names the real site.

**Architecture:**
- **Runs:** a run learns the site's canonical root from `--canonical`, else from its pages' `<link rel="canonical">`, and records it in `run.json`.
- **The page and the Word copy:** the share model resolves the root (`report.canonical`, else the latest counted run's, else none) and maps every page address it shows onto it.
- **Shares:** each share records the root as `site`, and names its copies after the canonical name.
- **The website:** it heads sites by their canonical names, and publishes the demo's own pages under `demo-site/`, so the demo's canonical address, `https://voicecap.netlify.app/demo-site/`, is real.
- **Commands:** `--site` accepts a canonical address.

**Tech Stack:** TypeScript (strict, ESM), Node 22.19+ or 24, pnpm, Vitest, Playwright Chromium, zod 4, docx.

**Spec:** docs/superpowers/specs/2026-09-30-shareable-report-design.md. The sections are "Canonical names" (new), "The page, top to bottom" item 1, "Files, names, and the record of what was sent", "The Word copy", and "The website".

**Branch:** `plan-5b-canonical-names`. It starts from `0.9.2-site-footer-measure`, so it carries the footer fix (f426f56, 591e45a, fbfbdfc), which ships in this release. The CHANGELOG's 0.9.2 heading was folded back into Unreleased (e6fdb0a).

**The owner's decisions (2026-10-04):**
- **Canonical names everywhere:** "use canonical site names, even if run on localhost. … IP addresses -- prod or local -- make no sense and mean nothing."
- **Where the name comes from:** the site's own tag, then `init`'s question for a local address, then the address itself.
- **The demo:** its pages are published inside voicecap.netlify.app at `/demo-site/`, and its report leads with `voicecap.netlify.app`. "voicecap.netlify.app is the site's name."
- **The `report.siteName` setting:** it becomes a line under the canonical name, and the home page's title is no longer a headline.
- **Release:** the footer fix and the README screenshots go out with this as 0.10.0.

## Global Constraints

- **Nothing an IP address or a local address leads.** No page, Word copy, website, shared file name, run report header, or README screenshot leads with an IP address (`127.0.0.1`, any IPv4 or IPv6 literal) or a local address (`localhost`). They lead with the canonical name and a date and time. The owner has asked three times.
- **Records stay honest.** Nothing sealed is rewritten. These keep the address voicecap read:
  - `run.site`, and the site folders named after it;
  - walkthrough files (their reader is a strict zod schema: add no field);
  - terminal output;
  - a problem's quoted record;
  - the page's embedded `#fp-data`.
- **Records from before 0.10.0 keep working,** named as before unless `report.canonical` names them. `voicecap verify` passes on an older home.
- **Wording:**
  - never describe voicecap as automated testing or an automated checker;
  - never say the person "listened" (they heard NVDA speaking); keep "listen-through";
  - never write that voicecap doesn't replace screen reader testing;
  - never mention who or what helped write voicecap;
  - write plain, active sentences in the code's own voice; strings live in `src/share/text.ts`, `src/site/text.ts`, and the init wording beside its prompts.
- **Never start a real screen reader, Word, or any desktop program.**
  - Never run `voicecap` itself except through the test suite's scripted or replay drivers.
  - Never run `setup`, `doctor`, `preflight` (for real), `demo`, `init` (except in tests, with its fakes), `test:nvda`, or `fixture:capture`.
  - Never pass a composed command through `cmd /c` or any shell.
- **Tests:**
  - A test never touches the owner's real transcripts home. `test/setup.ts` clears `VOICECAP_TRANSCRIPTS`; still pass `env` and `home` explicitly.
  - Browser layout tests allow for Chromium on Linux rounding a character's width to a whole pixel.
- **Quality and commits:**
  - Prettier (printWidth 100), ESLint, and both typechecks must be clean. Every task ends with `pnpm lint`, `pnpm typecheck`, and `pnpm test` green.
  - Commit each task. Messages carry no trailers of any kind. Don't push: the controller pushes.

## Review Focus

1. **A tag that doesn't fit.** A `<link rel="canonical">` can name another page, another site, a relative URL that the browser resolved, a scheme other than http(s), or nothing usable. It's ignored, never used to misname the site.
2. **Pages that disagree.** Some pages may have no tag, or may name `www.` and not, or http and https. The home page's fitting tag wins, else the first page whose tag fits, in the run's page order. A resumed run counts pages read in earlier sessions.
3. **A root with a path.** For the demo's `/demo-site/`, and pages with a query, the shown address is right. The home page maps to the root itself, and a URL on another origin (an off-site link, a redirect away) is left as it was.
4. **Old records:**
   - runs without `canonical`, and shares without `site`, are named as before;
   - `verify` passes;
   - the website builds;
   - nothing is rewritten.
5. **The website's two edge cases:**
   - Two site folders naming one canonical site get one heading, their reports together, the newest first, with unique ids.
   - The build's emptying guard, given the `demo-site/` folders a build now writes: a folder voicecap built is rebuilt, and a nested folder anywhere else is still refused.

---

### Task 1: Canonical addresses: the helpers

**Files:**
- Create: `src/pages/canonical.ts`
- Test: `test/canonical.test.ts`

**Interfaces:**
- Produces (exact names; later tasks rely on them):
  - `normalizeCanonical(input: string): string`. An http(s) root ending in `/`.
    - `"dvfr.illinois.gov"` gives `"https://dvfr.illinois.gov/"`, adding `https://` as init's `normalizeSiteAnswer` does.
    - `"https://Example.org/agency?x=1#y"` gives `"https://example.org/agency/"`.
    - It throws `UsageError` for anything else, with the message `"<input>" isn't a web address, such as https://dvfr.illinois.gov.`
  - `canonicalRootFrom(pageUrl: string, declared: string | null): string | null`. The root a page's tag gives, or null.
    - `declared` must parse as an absolute http(s) URL.
    - Its pathname must end with the page's own pathname. The prefix before that becomes the root's path, ending in `/`.
    - The tag's query and hash are ignored.
  - `toCanonical(url: string, readOrigin: string, root: string | null): string`. The address to show.
    - When `root` is null, or `url`'s origin isn't `readOrigin`, it returns `url` as it was.
    - Otherwise it returns `root` + the URL's pathname without its leading `/` + its search. The hash is dropped.
  - `canonicalName(root: string): string`. The root's host: `"voicecap.netlify.app"`, or `"example.org:8443"`.
  - `isLocalHost(host: string): boolean`. True for:
    - `localhost` and `*.localhost`;
    - any IPv4 literal;
    - any IPv6 literal, bracketed or not.
  - `readLocation(readOrigin: string, root: string): "same" | "local" | "elsewhere"`. Whether a run read the canonical site itself (the same origin), a copy on this computer (an `isLocalHost` host), or a copy at another address.
- Consumes: `UsageError` (`src/util/errors.ts`).

- [ ] **Step 1: Write the failing tests** in `test/canonical.test.ts`. Use these cases, one `it` each; group them by function:
  - **normalizeCanonical:**
    - bare host;
    - with `http://`;
    - a path without a trailing slash becomes one with it;
    - a query and hash are dropped;
    - upper-case host is lowered;
    - IDN host (`bücher.example` gives `https://xn--bcher-kva.example/`);
    - refuses `""`, `"ftp://x.org"`, `"not a url"`, and `"javascript:alert(1)"`, with the exact message.
  - **canonicalRootFrom:**
    - page `http://127.0.0.1:4848/` with tag `https://voicecap.netlify.app/demo-site/` gives `https://voicecap.netlify.app/demo-site/`;
    - page `http://127.0.0.1:4848/before-you-start/` with tag `https://voicecap.netlify.app/demo-site/before-you-start/` gives the same root;
    - page `http://localhost:3000/grants/` with tag `https://dvfr.illinois.gov/grants/` gives `https://dvfr.illinois.gov/`;
    - a tag naming another page (page `/a/`, tag `https://x.org/b/`) gives null;
    - a tag with another scheme (`ftp:`) gives null;
    - a null tag gives null;
    - a tag that doesn't parse gives null;
    - the tag's query is ignored (`https://x.org/a/?utm=1` for page `/a/` gives `https://x.org/`).
  - **toCanonical:**
    - maps `http://127.0.0.1:4848/` to the root itself;
    - maps `http://127.0.0.1:4848/before-you-start/?q=1#top` to `https://voicecap.netlify.app/demo-site/before-you-start/?q=1`;
    - leaves `https://elsewhere.org/x` unchanged;
    - leaves everything unchanged with a null root.
  - **canonicalName:**
    - a plain host;
    - a host with a port.
  - **isLocalHost:**
    - true for `localhost`, `app.localhost`, `127.0.0.1`, `10.0.0.5`, `192.168.1.10`, `[::1]`, and `::1`;
    - false for `dvfr.illinois.gov`, `voicecap.netlify.app`, and `localhost.example.org`.
  - **readLocation:**
    - `same` for the same origin;
    - `local` for `http://127.0.0.1:4848`;
    - `elsewhere` for `https://staging.example.org`.
- [ ] **Step 2:** Run `pnpm vitest run test/canonical.test.ts`. Expected: FAIL, since the module doesn't exist.
- [ ] **Step 3:** Implement `src/pages/canonical.ts` with the WHATWG `URL` only, and no regular expression over a whole URL. The IPv4 test is four dotted decimal parts, each 0 to 255. The IPv6 test is a host `URL` gives in brackets, or a string `URL` accepts as `http://[<host>]/`.
- [ ] **Step 4:** Run the test file: PASS. Then `pnpm lint && pnpm typecheck`.
- [ ] **Step 5:** Commit: `Add the helpers that name a site by its canonical address`.

### Task 2: Runs learn the canonical root, and record it

**Files:**
- Modify:
  - `src/drivers/types.ts` (`PageInfo`);
  - `src/drivers/guidepup/chrome.ts` (`BrowserSession.pageCanonical`, in the `PageDocument` pattern beside `setTitle`);
  - `src/drivers/guidepup-nvda.ts` (`openPage` fills it, and null for a non-HTML page);
  - `src/drivers/replay.ts` (null);
  - `src/run/page-runner.ts` (first pass only, as the title is);
  - `src/run/audit.ts`:
    - `RunAuditOptions.canonical`;
    - `page.canonical`;
    - `run.canonical`, set before `run.seal = sealOf(run)`;
  - `src/model.ts` (`PageRecord.canonical?: string | null`; `RunJson.canonical?: string`);
  - `src/cli/main.ts` (`--canonical <address>` on a run);
  - `test/helpers/scripted-driver.ts` and `test/helpers/fake-desktop.ts` (pages can declare a tag).
- Test:
  - `test/run-canonical.test.ts` (new);
  - `test/chrome-session.test.ts` (the real Chromium read);
  - the `cli` tests for the option.

**Interfaces:**
- Consumes: `normalizeCanonical` and `canonicalRootFrom` (Task 1).
- Produces:
  - `PageInfo.canonical: string | null`: the browser-resolved `href` of the first `link[rel~="canonical" i]`, or null.
  - `PageRecord.canonical`: the tag's address as the page gave it, on the run's last attempt's first load.
  - `RunJson.canonical`: the root, left out when there's none.
  - `RunAuditOptions.canonical?: string | null`: already normalized.

**Rules:**
- **Where `run.canonical` comes from, at completion:**
  - it's `options.canonical` when it's given;
  - else the home page's root (`canonicalRootFrom(page.finalUrl ?? page.url, page.canonical)` for the page whose path is `/`);
  - else the first page in the run's order whose tag fits;
  - else it's left out.
- **Pages from earlier sessions count.** A resumed run counts the `PageRecord.canonical` of pages read in earlier sessions, so resuming changes nothing.
- **`--canonical` isn't a setting.** It isn't in `RunSettings`, so it doesn't change which runs resume. The value given to the session that completes the run is the one recorded. An invalid value is a usage error before anything starts, with Task 1's message.
- **Replays never learn a root.** A replay run records no tag, so a root comes only from `--canonical`. Replays don't count on the page either way.
- **Terminal output is unchanged.**

- [ ] **Step 1: Write the failing tests.**
  - **In `test/run-canonical.test.ts`,** using the scripted driver and a temporary home:
    - "records the root the home page's tag names": `run.canonical` is `https://dvfr.illinois.gov/` for a run on `http://localhost:3000` whose `/` declares `https://dvfr.illinois.gov/`;
    - "takes the first fitting page's tag when the home page's doesn't fit";
    - "ignores a tag that names another page or another site";
    - "--canonical wins over the pages' tags";
    - "records no canonical when no page names one" (the key is absent);
    - "keeps the seal holding" (verify the run passes);
    - "counts pages read in an earlier session of a resumed run";
    - "refuses an invalid --canonical before the run starts".
  - **In `test/chrome-session.test.ts`,** against a page served by the existing test server: `pageCanonical()` returns the absolute address for `<link rel="Canonical" href="/x/">`, and null with no tag.
- [ ] **Step 2:** Run them: FAIL.
- [ ] **Step 3:** Implement. Read the tag only on the first pass's load, beside the title. A page that fails gets no tag.
- [ ] **Step 4:** Run the new tests, then the whole suite: PASS.
- [ ] **Step 5:** Commit: `Learn each site's canonical address in a run, from its pages or --canonical`.

### Task 3: `voicecap init` asks for the canonical address of a local site

**Files:**
- Modify:
  - `src/init/site.ts`: `checkSite` also returns the home page's tag. It reads it from the HTML it fetched, with a small attribute reader, not a regular expression over the whole document.
  - `src/init/wizard.ts`: after `askSite`.
  - `src/init/compose.ts`: `InitAnswers.canonical` adds `--canonical <root>`.
  - The init words.
- Test: `test/init-wizard.test.ts`, `test/init-site.test.ts`.

**Interfaces:**
- Consumes: `isLocalHost`, `normalizeCanonical`, `canonicalRootFrom` (Task 1).
- Produces: `InitAnswers.canonical: string | null`.

**Rules:**
- **When the home page names a root** (its tag fits): print `The site names its canonical address: <root>. Reports will name it so.` Ask nothing.
- **When the address is local** (`isLocalHost`) and names none, ask:
  - The question: `This site runs on this computer, so reports need the address people visit. What is it? (for example, https://dvfr.illinois.gov)`
  - It takes the first answer `normalizeCanonical` accepts. After a refused answer, it says the refusal and asks again. An empty answer is refused, since a report must name the site.
- **Any other address** asks nothing.

- [ ] **Step 1: Write the failing tests:**
  - the question is asked for `http://localhost:3000` with no tag, and `--canonical https://dvfr.illinois.gov/` is in the composed command;
  - it isn't asked when the page names a root, and the message is printed;
  - it isn't asked for `https://dvfr.illinois.gov`;
  - an invalid answer, then a valid one;
  - an empty answer is refused.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, then the suite.
- [ ] **Step 5:** Commit: `Ask init for the address people visit when the site runs on this computer`.

### Task 4: The share model names the site canonically, and shows every page address on the root

**Files:**
- Modify:
  - `src/config/schema.ts` and `src/config/defaults.ts`: `report.canonical: string | null`. Validate it with `normalizeCanonical` in a `transform` or `superRefine`, so a bad value is a config error naming the field.
  - `src/share/load.ts`: `ShareInput.canonical`, `ShareInput.readOrigin`.
  - `src/share/model.ts`: the header, and a `shown(url)` mapping used wherever an address is shown.
  - The pieces that format addresses: `src/share/format.ts`, `src/share/words.ts`, `src/share/run-evidence.ts`, `src/share/summary.ts`, and `src/share/cards.ts` as needed. Map at the model's boundary, not in each renderer.
  - `src/share/text.ts`.
- Test:
  - `test/share-model.test.ts`: update the pinned headline tests, 289–303;
  - `test/share-canonical.test.ts` (new).

**Interfaces:**
- Consumes: Task 1's helpers, and `RunJson.canonical` (Task 2).
- Produces:
  - `resolveCanonical(input: { configCanonical: string | null; latest: RunJson | null }): string | null`, exported from `src/share/load.ts`. It's the config's value, else the latest counted run's `canonical`, else null. Task 6 reuses it.
  - The header:
    - `header.name`: `canonicalName(root)` when there's a root, else the host voicecap read;
    - `header.site`: the root, else the read origin;
    - `header.siteName`: `report.siteName` or null. It's a line under the name now, not the headline.
    - `header.testedAt`: the latest counted run's start, as "29 September 2026, 14:02", in the format the website uses, in the run's own offset;
    - `header.readFrom`: `"same" | "local" | "elsewhere"` from `readLocation`, or null with no root.

**Rules:**
- **Every address the page or the Word copy shows goes through `shown`.** That covers:
  - page names that fall back to a URL;
  - the sample of what NVDA said ("Heard on …");
  - "no longer listed";
  - the flags' fold lines;
  - the appendix's fold lines;
  - the scope line's sitemap address;
  - the evidence's page-source row.
- **Links follow the same mapping.** Any link to a page of the site points to its canonical address.
- **The verify command drops `--site`:** `npx @icjia/voicecap verify`, which checks every site in the home.
- **Walkthrough commands use the canonical address when there is one:** `walkthrough --site <root> --run <id>`, which Task 9 makes `--site` accept. Otherwise they use the read origin, as now.
- **Walkthrough download names use the canonical name,** made folder-safe with `siteFolder`'s rule, in place of the folder name.
- **The tested address never shows.** `#fp-data` and a problem's quoted record stay as recorded.

- [ ] **Step 1: Write the failing tests:**
  - "names the site by `report.canonical` when it's set";
  - "names the site by the latest run's recorded root";
  - "falls back to the host for runs that recorded none" (the pre-0.10.0 behavior, minus the home page's title);
  - "shows `report.siteName` as a line, not the name";
  - "maps every page address it shows onto the root";
  - "leaves an off-site address as it is".
  - **And the guard test,** "the page shows no IP address":
    - build the demo fixture's page with `report.canonical` set to `https://voicecap.netlify.app/demo-site/`;
    - render it, and collect every visible text node and every `href`, outside `#fp-data` and outside the problems' record boxes;
    - assert that none contains `127.0.0.1` or `localhost`.

    Repeat the guard for the Word copy's text, read from its `document.xml`, as the Word tests do.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, then the suite.
- [ ] **Step 5:** Commit: `Name the site by its canonical address on the page and the Word copy`.

### Task 5: The page's top, the Word copy's top, and the run report's header lead with the name and a date and time

**Files:**
- Modify:
  - `src/share/html/top.ts`: the masthead;
  - `src/share/words.ts`: `documentTitle` uses `header.name`;
  - `src/share/word/top.ts` and `src/share/word/outline.ts`: the top lines, and the footer;
  - `src/share/html/evidence.ts` and `src/share/word/evidence.ts`: the "read a copy" line;
  - `src/report/render.ts`: the run report's subtitle names the canonical address when `run.canonical` is set;
  - `src/share/text.ts`.
- Test: `test/share-html-top.test.ts`, `test/share-word-top.test.ts`, `test/share-words.test.ts`, the run report's render tests, `test/report-a11y.test.ts`, `test/share-browser.test.ts` (axe stays at zero).

**Rules (the spec's "The page, top to bottom" item 1):**
- **The masthead, top to bottom:**
  - the eyebrow, as now;
  - `<h1>` with `header.name`;
  - `header.siteName`, when set, as a line under it;
  - `Tested <testedAt>`, beside or just under the name;
  - the plain lines, as now;
  - "As of", "Prepared by", and "Made with voicecap", as now;
  - `Site address` with the canonical root, linked, last and small.
- **The Word copy's first lines:**
  - the title;
  - the name in bold;
  - `header.siteName` when set;
  - `Tested <testedAt>. This copy was made <asOf>.`;
  - the lead, as now.
- **Each Word page's footer:** `<name>, as of <date>`.
- **The evidence:** when `readFrom` is `"local"`, it says `These runs read a copy of the site on this computer.` When it's `"elsewhere"`, it says `These runs read a copy of the site at another address.` It names no address. When it's `"same"`, it says nothing.

- [ ] **Step 1:** Update the pinned tests to the new top, and add:
  - "leads with the canonical name and the date and time it was tested";
  - "says the runs read a copy, and names no address";
  - for the run report, "names the canonical address in its subtitle".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, then the browser and axe tests. Zero violations, dark and light, at 1280, 390, and 320 pixels.
- [ ] **Step 5:** Commit: `Lead the page, the Word copy, and the run report with the site's name and when it was tested`.

### Task 6: Shares record the canonical address, and name their copies after it

**Files:**
- Modify:
  - `src/share/share.ts`: the stem;
  - `src/share/shares.ts`: `appendShare` writes `site`;
  - `src/model.ts`: `ShareEntry.site?: string`;
  - `src/verify.ts`: a present `site` must be an http(s) root; anything else is a problem, named as the other field problems are;
  - `src/site/records.ts`: `SiteEntry.site: string | null`; an entry whose `site` isn't a root is read with `site: null`.
- Test: `test/share-report.test.ts`, `test/verify.test.ts`, and the site's records tests.

**Interfaces:**
- Consumes: `resolveCanonical` (Task 4), `canonicalName` (Task 1), and `siteFolder` (`src/run/paths.ts`).
- Produces: `ShareEntry.site` (sealed with the rest), and `SiteEntry.site`.

**Rules:**
- **What `site` records:** the resolved root, else the read origin with a `/`.
- **The stem:** `siteFolder(canonicalName(site))` + `_` + the day, then `-2`, `-3` for later shares that day, as now. The walkthrough copies follow the stem.
- **Older entries** have no `site`, and still verify and still build.
- **The line to paste into the email** keeps its form.

- [ ] **Step 1: Write the failing tests:**
  - "names the copies after the canonical name": `voicecap.netlify.app_2026-09-30.html` for the demo fixture with `report.canonical`;
  - "records `site` in the entry, sealed";
  - "keeps `-2` for a second share that day";
  - "verify passes an entry from before 0.10.0, with no `site`";
  - "verify names an entry whose `site` isn't a web address".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, then the suite.
- [ ] **Step 5:** Commit: `Record each share's canonical address, and name its copies after it`.

### Task 7: The website names sites canonically

**Files:**
- Modify:
  - `src/site/build.ts`: group the site folders by name;
  - `src/site/render.ts`: the headings, ids, and the list by date;
  - `src/site/text.ts`.
- Test: `test/site-build.test.ts`, `test/site-render.test.ts`, `test/site-page-browser.test.ts` (axe).

**Rules:**
- **A folder's name** is `canonicalName` of its newest entry's `site`, else the folder's name.
- **Folders with the same name are one site.** Their reports are listed together, newest first, by each report's time.
- **The heading is the name.** The id is `site-` + the name made folder-safe, unique on the page.
- **The list by date** names each report's site the same way.
- **Published paths stay `<folder>/<file>`.** Only what's shown changes.
- **`SiteContent.sites` entries** become `{ name: string; folders: string[]; reports: PublishedReport[] }`. `PublishedReport.folder` stays.

- [ ] **Step 1: Write the failing tests:**
  - "heads a site by its newest share's canonical name";
  - "puts two folders that name one site under one heading, their reports newest first";
  - "names an older site by its folder";
  - "lists reports by date with their canonical names";
  - the axe test, unchanged, still at zero.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, then the suite.
- [ ] **Step 5:** Commit: `Head the website's sites by their canonical names`.

### Task 8: The demo's pages: relative links, canonical tags, and published under `demo-site/`

**Files:**
- Modify:
  - `demo/site/**/*.html` (not `404.html`'s links: the local server serves it at any depth, so its links stay root-relative);
  - `src/demo/server.ts`: the form's answer;
  - `src/site/build.ts`: copy `DEMO_SITE_DIR` (`src/demo/server.ts`) into `<out>/demo-site/`, and write `demo-site/sitemap.xml`. Widen the emptying guard for exactly the files a build writes there.
  - `src/site/headers.ts`: a rule for `/demo-site/*`;
  - `src/site/render.ts` and `src/site/text.ts`: the demo view links to `demo-site/`.
- Test:
  - `test/demo-site.test.ts` (new);
  - `test/demo-server.test.ts` (the form);
  - `test/site-build.test.ts` (publishing, and the guard);
  - `test/site-served.test.ts` (the pages load under `/demo-site/` with their style, no CSP violation, and their links resolving).

**Rules:**
- **Each demo page** (`index.html` and each `<page>/index.html`, and `ask-a-question/sent.html`) gets `<link rel="canonical" href="https://voicecap.netlify.app/demo-site/<its path>">` in its head.
- **Every root-relative `href` and `action` becomes relative:** `style.css` and `before-you-start/` from the home page; `../style.css`, `../`, and `../the-report/` from a page.
- **The form** becomes `method="get" action="sent.html"`. A static host can't answer a post, so `sent.html` is served as a file in both places. The local server's POST handling is removed, or left to answer the same page; choose one and test it. What NVDA says on the form page doesn't change.
- **`voicecap site` publishes every file of `DEMO_SITE_DIR` byte for byte** under `<out>/demo-site/`, leaving out `404.html`. It also writes `demo-site/sitemap.xml`, listing the demo's pages (the server's list) at `https://voicecap.netlify.app/demo-site/`.
- **`_headers` for `/demo-site/*`:** `Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`. The toml's headers still apply.
- **The emptying guard** still refuses a nested folder or a dot name. The one exception is the exact set of paths a build writes under `demo-site/`, as the package lists them. A folder voicecap built is rebuilt, and a `demo-site/` holding anything else is refused, like any other folder.
- **The demo view's lead** says the pages are at `voicecap.netlify.app/demo-site/`, with a relative link. The text is in `src/site/text.ts`.

- [ ] **Step 1: Write the failing tests:**
  - "every demo page names its canonical address";
  - "no demo page links root-relatively except 404.html";
  - "the form answers with sent.html locally";
  - "a build publishes the demo's pages under demo-site/, byte for byte, with a sitemap";
  - "a built folder holding demo-site/ is rebuilt; a nested folder elsewhere is refused";
  - "the demo's pages load under /demo-site/ with their style and no CSP violation";
  - "the demo view links to demo-site/".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, then the suite. The demo fixture's transcripts are unchanged: they're records.
- [ ] **Step 5:** Commit: `Publish the demo's pages under demo-site/, at their canonical address`.

### Task 9: `--site` accepts a canonical address

**Files:**
- Modify:
  - `src/run/site-dir.ts`: `chooseSiteDir`;
  - `src/cli/main.ts`: the help for `--site` on `review`, `manual add`, `report`, `share`, `walkthrough`, and `verify`. A run's `--site` stays the address to read.
- Test: `test/site-dir.test.ts`, the `cli` tests.

**Rules:** `--site <address>` finds:
1. the folder named after the address, when it exists, as now;
2. else the one site folder whose newest completed run recorded that canonical root (compared after `normalizeCanonical`);
3. else, as now, the folder the address would have (for commands that may make it).

Two folders whose runs recorded the root are a usage error, naming both folders and asking for the address voicecap read.

- [ ] **Step 1: Write the failing tests:**
  - "finds the folder whose runs recorded the canonical address";
  - "prefers a folder named after the address";
  - "names both folders when two recorded it";
  - "finds nothing new for an address no run recorded".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, then the suite.
- [ ] **Step 5:** Commit: `Let --site take a site's canonical address`.

### Task 10: The README's screenshots, the README, and the release notes

**Files:**
- Create or modify:
  - `scripts/readme-screenshots.ts`: it exists, uncommitted; finish it;
  - `package.json`: `"readme:screenshots": "tsx scripts/readme-screenshots.ts"`;
  - `assets/screenshots/*.png`;
  - `README.md`;
  - `CHANGELOG.md`;
  - `src/share/text.ts` (`TIMELINE`);
  - `docs/phase-c-handoff.md`.

**Rules:**
- **The script:**
  - It shares the demo fixture with `report.canonical` set to `https://voicecap.netlify.app/demo-site/`, by `SHARED_BY` "Demo Reviewer", on 30 September 2026. Don't add `example.illinois.gov` or any other made-up site.
  - It builds the website from that home, and draws everything at 1200 × 900, scale 2.
  - It writes six PNGs:
    - `report-top.png`: the masthead and the summary;
    - `report-heard.png`: "Heard on …", the element alone;
    - `report-flags.png`: the flags, with their fold open;
    - `report-fingerprints.png`: the check, after it runs;
    - `website-dark.png` and `website-light.png`: the bar through the demo's report.
  - **It refuses to write a shot that shows an IP address.** Before each shot, it reads the region's visible text and fails if it holds `127.0.0.1` or `localhost`.
- **README placements, each with alt text that says what it shows (no image of text the README doesn't also say):**
  - `report-top.png` right after "voicecap in brief";
  - `report-heard.png` in "What voicecap does on each page";
  - `report-flags.png` in "The shareable page";
  - `report-fingerprints.png` in "Checking the record";
  - the two website shots in "The website".

  Link each the way the existing images are (`https://raw.githubusercontent.com/ICJIA/voicecap/main/assets/…`).
- **README text:**
  - canonical names: `--canonical`, `init`'s question, `report.canonical`, and what the page leads with;
  - the demo's pages at `voicecap.netlify.app/demo-site/`;
  - the new names of shared copies.
- **CHANGELOG `[Unreleased]`:**
  - *Added:* canonical names, `--canonical`, `report.canonical`, the demo's pages on the website, and `pnpm readme:screenshots`;
  - *Changed:* the page's and the Word copy's top, shared copies' names, the website's headings, the form of the demo's page, and the README's screenshots;
  - plus the footer line already there.
- **The timeline:** a 0.10.0 row (a test requires one per minor), dated when released, in "Prepare 0.10.0".
- **The handoff note:** record it at release.

- [ ] **Step 1:** Run `pnpm readme:screenshots`. It writes the six files; look at each.
- [ ] **Step 2:** Place them in the README; check the folds, links, and anchors as before; then `pnpm lint`.
- [ ] **Step 3:** Commit: `Show what voicecap makes in the README: screenshots of the page and the website`.

---

## After execution

**How it was built (2026-10-04):**
- Subagent-driven: one implementer per task (sonnet), each task reviewed (sonnet), with scoped re-reviews of each fix round.
- A final whole-branch review (opus) found 0 Critical, 3 Important, and 8 Minor. One fix wave (opus) followed, then a scoped re-review: every finding addressed, none new.
- 35 commits on the branch, including the footer fix it started from.
- 4,282 tests pass, and 2 skip on Windows. CI is green on all six jobs at the fix wave's head, f320f5c. Two runs needed a re-run of one job: a macOS focus-timing test once, and two Windows timeouts once, each a runner stall.

**Rulings** (what, why, and what it costs if wrong):
- **P1:** Task 4 renamed the headline's uses to `header.name`, and Task 5 built the new top. *Why:* each task stays green. *If wrong:* a bigger Task 4.
- **P2:** the page's walkthrough commands use `--site <root>` before Task 9. *Why:* nothing runs them in between. *If wrong:* none.
- **P3:** tasks run in order.
- **P4, P4a:** a canonical address is never an IP or local address. The refusal says `"<input>" is an IP address or a local address, not a site's name; give the address people visit, such as https://dvfr.illinois.gov.` *Why:* the owner's rule. *If wrong:* a site at an IP can't be named by it.
- **P5:** a run's root comes from the root most inner pages' tags give. The home page's root counts only when none does. *Why:* a home page's `/` fits any tag. *If wrong:* the inner pages win a disagreement.
- **P6:** only pages that were read vote. *If wrong:* a run whose tagged pages all failed learns no root.
- **P7:** in `init`, a home page's root with a path counts as no tag. *Why:* init sees no inner page. *If wrong:* a sub-path site is asked once.
- **P8:** init's question says `This address is an IP address or a local address, so reports need the address people visit. What is it? (for example, https://dvfr.illinois.gov)`.
- **P9:** a shared copy's stem is `siteFolder(new URL(<root, or the read origin>))_<day>`. *Why:* the plan's stem didn't type-check.
- **P10:** the Word copy's top keeps "Site address <root>." last, and the run report's link text is the canonical name.
- **P11:** the "local" sentence is `These runs read a copy of the site on the computer that ran them.` It supersedes this plan's Task 5 text (`on this computer`): the page travels.
- **P12:** a website heading is the canonical name of the newest share's `site`, else the folder's name.
- **P13, then P13a:** a share refuses to name a site by an IP or local address when no canonical root resolves, before anything is written. `voicecap site` warns for each site headed by an IP or local folder name. *Why:* shares are permanent and published, so a warning would come too late.
- **P14, P14a:** the demo's words are true locally and on the website:
  - every footer says `This demo site comes with voicecap, for trying it out.`;
  - the form's note says `This is a practice form: sending it only shows a thank-you page, so don't type anything private.`;
  - sent.html is titled `Practice form | voicecap demo` and headed `This is a practice form, so no one will answer it.`
- **P15, P15a:** the demo's pages get their CSP as exact `_headers` rules at every address, extensionless included, with no splat. *Why:* Netlify's docs don't say whether a splat matches the folder's own address.
- **P16:** `--site`'s step 1 needs a folder that holds site records, and a root with a path checks recorded roots first.
- **P17:** `chooseSiteDir`'s step 2 also counts shares' recorded `site`. `walkthrough --run` takes the folder that holds the run.
- **P18:** `toCanonical` keeps a path that already starts with the root's path, on the root's origin.
- **P19:** a null `report.canonical` is left out of the config's hash, so default configs hash as in 0.9.x.
- **P20:** "a copy on the computer that ran them" applies only to loopback addresses, and "the same site" ignores the scheme and a leading `www.`.
- **P21:** init offers a home page's root with a path as the Enter default.
- **P22:** a host with an empty label is refused.

**What the final review changed:**
- **A:** P13a.
- **B:** P17. The page's printed `walkthrough` command now finds its run when the root came from `report.canonical`, or when a live folder and a copy's folder name one root.
- **C:** P18.
- **D:** P19.
- **E:** P20.
- **F:** P21.
- **G:** P22.
- **H:**
  - the OS's litter files are skipped when the demo's pages are published;
  - the guard's refusal says to delete the folder and build again, when that's safe;
  - three doc errors fixed.
- **I:** the spec, the CHANGELOG, and comments aligned. CI's smoke test shares the demo from a folder with its own config.

**Carried, for later:**
- **Helpers:**
  - pin the strict trailing-slash fit;
  - guard `toCanonical` against `blob:`;
  - document that `canonicalName` takes a normalized root.
- **Runs:**
  - make the "every session" test able to fail;
  - rename the tests named "another site";
  - test resuming a pre-0.10.0 incomplete run;
  - consider counting votes by distinct final address.
- **init:**
  - bound the home page read (to `</head>`, or about 1 MiB);
  - document the tag scanner's gaps, or move it to its own module;
  - init and a run can name different `www.` hosts.
- **The page:**
  - widen the guard tests' IP pattern;
  - share the repeated inline page-name type;
  - "No longer listed" over another scheme keeps its read address;
  - two comments in `top.ts`;
  - the duplicated test helpers;
  - "copy" in two senses in the Word copy (the owner's call).
- **Shares:**
  - a test tying copies' names to the website's name rule;
  - `verify.ts`'s comment about `JSON.stringify`.
- **The website:**
  - same-named links when merged folders shared on one day;
  - `example.gov_8080` next to `example.gov:8080`;
  - one site per folder is assumed;
  - pin `demo-site` as a file or link at the top as tolerated;
  - make `DEMO_SITE_DIR` injectable, and move the demo's code out of `build.ts`.
- **`--site`:**
  - a canonical page with a canonical `--site` is refused, naming the read host;
  - `canonicalRoot` duplicates `recordedCanonical`;
  - `report --run` and `review --run` don't look across folders;
  - the cost of scanning every `run.json`, and a `run.json` that is `null`.
- **README:**
  - the screenshot guard reads drawn text only;
  - some details are only in the pictures (the owner's call);
  - the flags table's rule chip wraps mid-word (the page's own layout).
- **Fix-wave residuals:**
  - a stale `namedRoot` comment (`src/init/site.ts:19`);
  - `current.*` print a `walkthrough` command that finds its run only once a share records the root;
  - init's host-root path doesn't re-check an empty-label tag;
  - a pre-0.10.0 demo share keeps its IP names, with no warning (the README says to run the demo again).
- **Process note:** one implementer briefly ran test files through a shell (`shell: true`) in a mutation helper. Only tests ran, and it was changed.

**The release (the controller, with the owner):**
1. Merge to `main` once CI is green on the pushed branch.
2. Run `./publish.sh --dry-run minor` in the foreground.
3. Publish 0.10.0 with the owner's 2FA code.
4. Commit "Release v0.10.0", tag it, push, and record it in the handoff note.
5. Set the transcripts repo's `netlify.toml` command to `@0.10`, then commit and push. This is a standing step the owner asked for on 2026-10-04. That build publishes `demo-site/` and the canonical names.
6. Check the live site: `curl -I` the 23 demo addresses (each has its CSP, and `/demo-site` reaches `/demo-site/`).
7. Recommended by the final review: the owner checks one real demo run with this release.
   - `run.json` records `"canonical": "https://voicecap.netlify.app/demo-site/"`.
   - `share --out voicecap-demo` names `voicecap.netlify.app_<day>.*`.
   - This is the real Chrome path that no test drives.
