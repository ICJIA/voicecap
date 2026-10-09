# Plan 12, the website in audit.icjia.app's look: the plan

> Build it task by task; each step is a checkbox (`- [ ]`).

**Goal:** `voicecap site` builds four pages in the audit tool's look: the front page, Can I trust this?, Technical details (new), and What's New (new), with a top bar and a bottom bar on each.

**Architecture:**
- The website's style becomes its own: the audit tool's tokens, the system's fonts, and its parts (kicker, heavy headline, card, pill, big number, table). The pages stop embedding fonts.
- Two new pages are drawn like the trust page: a pure function of the package's facts and the records, written by `buildSite`, each under its own Content Security Policy at two addresses.
- One frame (`frame.ts`) gives every page the same two bars and the back link.

**Tech Stack:** TypeScript strict ESM, Node 22.19+, Vitest 5, Playwright Chromium with axe (test only). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-website-like-audit-design.md`, approved by the owner on 2026-10-08 ("Approve as is", with their three answers).

## Global Constraints

- **Wording:**
  - voicecap is a human review, sped up, and never "automated" ("automated" may describe another tool, such as axe, never voicecap);
  - a person hears, reads, and decides, and never "listened";
  - Guidepup is named only in the Technical details toolchain table, and in What's New where the CHANGELOG's own words name it;
  - never lead with an IP address.
- **Every number and date about voicecap is generated:**
  - from `package.json`, the CHANGELOG, `dist/release-facts.json`, voicecap's own code, or the records;
  - a missing fact says "not recorded in this build of voicecap";
  - the npm packages' licenses are typed, and a test holds each to the installed package's `license`.
- **The website's rules, on all four pages:**
  - one self-contained file, with one style block and one script, and no `style` attribute;
  - a policy made from the page's own hashes, at its `.html` address and the one without it;
  - dark first, with a switch to light, and light in print;
  - headings in order, landmarks, a skip link, visible keyboard focus, and complete without JavaScript;
  - axe with no violations in both themes at 1280, 390, and 320 pixels;
  - nothing wider than a 320-pixel window.
- **Pure:** the same package and records build the same bytes. No clock, no network, no randomness.
- **Untouched:** each shared report, the demo's report, and `demo-site/` are published byte for byte, as today.
- **The look's values** are the spec's, verbatim: its Type sizes, its Color table (both themes, and the 12% tints), its Layout widths, and its parts.
- **Commits:** a plain subject line with no trailers of any kind. No push until the release.
- **What the build never does:** start NVDA or any desktop program; run voicecap except through the test suite; publish; push; or touch the owner's transcripts home.

## Review Focus

1. **A CHANGELOG line with markup in it** (`<script>`, `&`, an unbalanced backtick) comes out as plain text on What's New and the banner, never as markup. *Test: Task 2.*
2. **A website with no report yet** (no sites, no demo) still draws all four pages whole: no broken link, no empty card, the right "not yet" words. *Tests: Tasks 2, 3, 5.*
3. **Text at 200% and 400%** (the browser's text size, not zoom): both bars wrap, nothing overlaps, and focus stays visible on every bar link and the theme button. *Test: Task 4.*
4. **JavaScript off:** the theme button stays hidden, every page is complete and dark, and every link of both bars works. *Test: Task 4.*
5. **A long word at 320 pixels** (a long site name in the banner area, a long version in the bottom bar, a long command in a table): nothing runs out of the window; a table scrolls in its own box. *Tests: Tasks 3, 4.*

## Decisions this plan makes (the owner reviews them with the plan)

- **D1, the order:** the look (Task 1), then What's New (Task 2) and Technical details (Task 3), then the bars (Task 4). That way the bars never link to a page that isn't built yet. Until Task 4, the two new pages are built and served, and the old bar doesn't link to them.
- **D2, the theme button:** it shows a sun in the dark theme and a moon in the light one, drawn by the style from `data-theme`. Its words are an `aria-label` that the script keeps in step: "Switch to the light theme" or "Switch to the dark theme". The stored choice keeps its name, `voicecap-theme`, so it still carries to and from the reports.
- **D3, the built-in flag rules:** `BUILT_IN_RULES` in `src/flags/evaluate.ts` becomes the one list of their ids. Technical details takes its table and its count from it.
- **D4, the shares a site keeps:** `buildSite` passes `KEPT_PER_SITE` to Technical details, so the page module doesn't import `build.ts`.
- **D5, a CHANGELOG entry's link:** it goes to the entry's heading on GitHub, by GitHub's heading slug: `## [0.13.1] - 2026-10-08` becomes `#0131---2026-10-08`.
- **D6, What's New's items:** the bullets at indent 0 and 2 spaces.
- **D7, the website pages' policy:** `font-src 'none'`. The reports' rules keep `font-src data:`, since their pages embed fonts.

---

### Task 1: The look

**Files:**
- Modify:
  - `src/site/style.ts` (rewritten);
  - `src/site/headers.ts` (`contentSecurityPolicy`);
  - `src/site/frame.ts` (`sitePage` without fonts);
  - `src/site/render.ts`, `src/site/trust.ts` (no `assets` parameter);
  - `src/site/build.ts` (no `fontFaceCss`; the pages' policies without fonts).
- Test:
  - `test/site-render.test.ts`, `test/site-trust.test.ts`, `test/site-headers.test.ts`, `test/site-build.test.ts`, `test/site-page-browser.test.ts`, `test/site-served.test.ts`;
  - `scripts/readme-screenshots.ts` (it calls the renderers).

**Interfaces:**
- Produces:
  - `SITE_CSS`, the website's own;
  - `contentSecurityPolicy(hashes: { styles: string[]; scripts: string[] }, options?: { fonts?: boolean }): string`, where `fonts` defaults to `true` (`font-src data:`) and `false` gives `font-src 'none'`;
  - `sitePage(parts: { title: string; bar: string; main: string[] }): string`;
  - `renderSiteIndex(content: SiteContent): string`;
  - `renderTrustPage(input: TrustInput): string`.

- [ ] **Step 1: Write the failing tests:**
  - `site-render`: "draws the website in the system's fonts, and embeds none". `renderSiteIndex(CONTENT)` has no `@font-face`, and its style block holds `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` and `ui-monospace, "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace`.
  - `site-render`: "has the audit tool's colors, dark first, light when picked, light in print". An `it.each` over the spec's 13 tokens finds each one's dark value under `:root`, its light value under `:root[data-theme="light"]`, and the light values again in `@media print`.
  - `site-render`: "sets headlines at weight 900 and kickers at 700, in capitals set by the style". Check the rules for `h1` and `.kicker`, including `text-transform: uppercase`.
  - `site-render`: "lets the bar scroll with the page". `SITE_CSS` has no `position: sticky` and no `scroll-padding-top`.
  - `site-headers`: "allows fonts as data: by default, and none when asked". `contentSecurityPolicy(h)` contains `font-src data:`; `contentSecurityPolicy(h, { fonts: false })` contains `font-src 'none'`.
  - `site-build`: "gives the website's pages a policy with no font, and a report its fonts". The rules for `/`, `/index.html`, `/trust.html`, and `/trust` carry `font-src 'none'`; a shared report's page rule still carries `font-src data:`.
- [ ] **Step 2:** Run `pnpm exec vitest run test/site-render.test.ts test/site-headers.test.ts test/site-build.test.ts`. Expected: FAIL on the new tests.
- [ ] **Step 3: Write `SITE_CSS` as the website's own.**
  - **Tokens:** `:root` (dark), `:root[data-theme="light"]`, and `@media print` (light, `.theme` hidden), each with the spec's 13 tokens. Each of `--good`, `--warn`, `--bad`, and `--act` gets a `-tint` of 12%: `color-mix(in srgb, var(--good) 12%, transparent)`.
  - **Rules kept from the shareable page's:** visible focus, `.skip`, `.sr`, and `[hidden]`. Copy them here; `THEME_CSS` is no longer imported.
  - **Type and layout:** the spec's Type sizes and Layout (the bars' content in a 72rem column, main in 56rem, gutters of 16px and 24px from 40em).
  - **The parts:** `.kicker`, `h1`/`h2` at weight 900, `.lead`, `.card`, `.pill`, `.n` (a big number: weight 900, the mono stack, `font-variant-numeric: tabular-nums`, `clamp(1.5rem, 17cqi, 2.375rem)` in a `container-type: inline-size` card), tables with a scroll box, and buttons.
  - **The classes the two pages already use**, restyled in the new tokens and keeping their names: `.view-head`, `.site-head`, `.visit`, `.report`, `.verdict.ok|warn|bad`, `.reading`, `.action`, `.earlier`, `details.fold`, `.files`, `.dates`, `.note`, `.hero`, `.stamp`, `.tiles`, `.tile`, `.part`, `.points`, `.cards`, `.card`, `.tag`, and `.releases`. The verdict's colors map green → `--good`, amber → `--warn`, red → `--bad`.
  - **Remove the sticky bar** and its scroll padding.
  - **Remove the pages' `@font-face` block:**
    - `sitePage` writes `<style>\n${SITE_CSS}</style>`;
    - `buildSite` no longer calls `fontFaceCss`;
    - the website's pages' rules use `contentSecurityPolicy(…, { fonts: false })`.
- [ ] **Step 4:** Run the focused tests, then the browser files: `pnpm exec vitest run test/site-page-browser.test.ts test/site-trust.test.ts test/site-served.test.ts`. Bring their expectations up to date where they pinned the old look: the sticky bar, the scroll room, the fonts, and colors. Expected: axe has no violations in both themes at 1280, 390, and 320 on both pages, and nothing is wider than 320.
- [ ] **Step 5:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 6:** Commit: `Draw the website in the audit tool's look: its colors, the system's fonts, heavy headlines, and its cards, pills, and big numbers; no fonts embedded, and a bar that scrolls with the page`.

### Task 2: What's New, from the CHANGELOG

**Files:**
- Create:
  - `src/site/changelog.ts`;
  - `src/site/whats-new.ts`;
  - `test/site-changelog.test.ts`, `test/site-whats-new.test.ts`.
- Modify:
  - `src/site/facts.ts` (`parseChangelog` moves to `changelog.ts`; `facts.ts` imports it);
  - `src/site/text.ts` (the page's words, under `SITE_TEXT.whatsNew`);
  - `src/site/frame.ts` (`SitePage` gains `"whats-new"`; on it, the old bar's view links go to `index.html#…`, as on the trust page);
  - `src/site/build.ts` (writes `whats-new.html`; rules at `/whats-new.html` and `/whats-new`; `OWN_FILES` gains both names);
  - `src/index.ts` (exports `ReleaseItem`);
  - `test/helpers/trust-facts.ts` (each release gains `items: []`);
  - `test/site-facts.test.ts`, `test/site-build.test.ts`, `test/site-served.test.ts`, `test/site-page-browser.test.ts`.

**Interfaces:**
- Produces:
  - `type ReleaseItem = (string | { code: string })[]`;
  - `interface VoicecapRelease { version: string; date: string; headline: string; items: ReleaseItem[] }`, where `items` is new;
  - `parseChangelog(text: string): VoicecapRelease[]` (in `changelog.ts`);
  - `changelogHref(release: { version: string; date: string }): string`;
  - `renderWhatsNew(input: { voicecap: VoicecapFacts; content: SiteContent }): string`.

- [ ] **Step 1: Write the failing tests:**
  - **`site-changelog`:**
    - "gives each release its items: the bold words that begin each bullet at the first two levels, but the headline's". Given an entry of `- **The headline.** more`, `  - **Item one:** more`, ``  - **Item `two`,** more``, `    - **Too deep** x`, and `- plain bullet: the rest`, the items are `[["Item one"], ["Item ", { code: "two" }], ["plain bullet"]]`.
    - "keeps a link's words, and no other Markdown". ``**See [the README](x).**`` gives `["See the README"]`.
    - "takes an unbalanced backtick as a plain character". ``**One ` tick**`` gives ``["One ` tick"]``.
    - "skips [Unreleased] and any heading that isn't a dated release". This moves from `site-facts`, with the headline tests. The test on the real CHANGELOG's headlines (none names Guidepup or says "listen") stays as it is: the banner and the trust page print them.
    - "links each release to its heading on GitHub". `changelogHref({ version: "0.13.1", date: "2026-10-08" })` is `https://github.com/ICJIA/voicecap/blob/main/CHANGELOG.md#0131---2026-10-08`.
  - **`site-whats-new`,** with `FACTS` and `CONTENT`:
    - "lists every release, newest first, one card each, in an ordered list". The `<ol>` has one `<li>` for each of `FACTS.releases`, in their order.
    - "marks the version that built the website as the current one". Only `FACTS.version`'s card says "the current version".
    - "heads each card with its headline, under the page's h1". The headings are h1, then h2s.
    - "links each card to its entry, naming its version for a screen reader". Each href is `changelogHref(release)`, and the link's words include `for 0.13.2` in `.sr`.
    - "draws every word from the CHANGELOG as text". A headline and an item holding `<script>alert(1)</script> & <b>` come out escaped, and the page has no `<script` but its own (Review Focus 1).
    - "says when no release is recorded". With `releases: []`, the page says `No release is recorded in this build of voicecap.` and has no `<ol>` (Review Focus 2).
  - **`site-build`:**
    - "writes What's New, with its own policy at both its addresses". `whats-new.html` exists, and `/whats-new.html` and `/whats-new` carry the policy of its own bytes.
    - "leaves out a site folder named whats-new".
- [ ] **Step 2:** Run `pnpm exec vitest run test/site-changelog.test.ts test/site-whats-new.test.ts test/site-build.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `parseChangelog` with its items** (and keep `headlineOf` as it is).
  - Within a release, a line counts if it matches `^( {0,2})[-*+]\s+`. The headline's own line is skipped.
  - An item is the bullet's bold words (less a closing `.`, `,`, or `:`), or, with none, its words up to the first `: ` or `. `.
  - It's split into pieces at balanced backtick pairs (a code span becomes `{ code }`). A link `[text](url)` becomes its text.
- [ ] **Step 4: Implement `changelogHref`.**
  - Lower-case the heading's text, `[x.y.z] - YYYY-MM-DD`.
  - Drop every character that isn't a letter, digit, space, or `-`.
  - Turn each space into `-`.
  - Then prefix the CHANGELOG's GitHub address and `#`.
- [ ] **Step 5: Implement `renderWhatsNew`** through `sitePage`, with these words:
  - the kicker "Every release";
  - the h1 "What's New";
  - the lead "Every release of voicecap, newest first, from its CHANGELOG. The front page shows the newest one.";
  - each card: the version as a `.pill` (good), the date ("8 October 2026", with the date format the trust page uses), and " · the current version" on `voicecap.version`'s; the headline as an h2; the items as a `<ul>`, each piece escaped, with code in `<code>`; then the link "The full entry in the CHANGELOG", with `<span class="sr"> for <version></span>`.
  - Card styles go in `SITE_CSS`.
  - Wire it into `buildSite` beside the trust page, and `OWN_FILES`, with its rules.
- [ ] **Step 6:** Add `whats-new.html` to the browser tests: axe in both themes at 1280, 390, and 320, nothing wider than 320, and both its addresses served with their policy. Run them. Expected: PASS.
- [ ] **Step 7:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 8:** Commit: `Build What's New from the CHANGELOG: every release, newest first, its headline and the bold words of its points, each linked to its entry`.

### Task 3: Technical details

**Files:**
- Create:
  - `src/site/technical.ts`;
  - `src/site/technical-text.ts`;
  - `test/site-technical.test.ts`.
- Modify:
  - `src/flags/evaluate.ts` (`BUILT_IN_RULES`);
  - `src/site/frame.ts` (`SitePage` gains `"technical"`);
  - `src/site/build.ts` (writes `technical-details.html`; rules at both addresses; `OWN_FILES`; passes `keptPerSite: KEPT_PER_SITE`);
  - `test/flags.test.ts`, `test/site-build.test.ts`, `test/site-served.test.ts`, `test/site-page-browser.test.ts`.

**Interfaces:**
- Consumes:
  - `VoicecapFacts`, `RecordFacts`, `SiteContent`;
  - `DEFAULT_CONFIG` (`src/config/defaults.ts`);
  - `PASS_NAMES` (`src/model.ts`).
- Produces:
  - `const BUILT_IN_RULES = ["generic-link-text", "unlabeled", "read-not-finished", "headings", "tab-no-stops", "tab-before-main", "repeated-phrase"] as const`, with `type BuiltInRule`;
  - `interface TechnicalInput { voicecap: VoicecapFacts; records: RecordFacts; content: SiteContent; keptPerSite: number }`;
  - `renderTechnical(input: TechnicalInput): string`;
  - `TECHNICAL_TEXT`, holding:
    - each part's kicker, heading, and points;
    - `rules: Record<BuiltInRule, string>`;
    - `commands: { name: string; job: string }[]`;
    - `toolchain: { tool: string; job: string; license: string; where: string; npm?: string }[]`;
    - `code: { label: string; path: string }[]`;
    - `related: { label: string; title: string; line: string; href: string }[]`.

- [ ] **Step 1: Write the failing tests:**
  - **`flags`:** "lists every built-in rule once, and each has its settings". Map each id of `BUILT_IN_RULES` to camelCase; that's exactly the keys of `DEFAULT_CONFIG.flags` other than `custom`.
  - **`site-technical`,** rendering with distinctive facts (version `9.8.7`, released `2031-02-03`, tests 4321 in 87 files, CI `["Ubuntu","Windows"]` and `["23"]`, and `keptPerSite: 4`):
    - "puts its headings in order, and links each part from 'On this page'". Every `href="#…"` in the `nav` matches an h2 `id`.
    - "says the version, its date, the tests, and CI's matrix from the facts". The page holds `9.8.7`, `3 February 2031`, `4,321`, `87`, `Ubuntu`, and `23`.
    - "takes the passes, the rules, the defaults, and the shares kept from the code". The page holds:
      - each of `PASS_NAMES`;
      - each of `BUILT_IN_RULES`, with the count `7` from `BUILT_IN_RULES.length`;
      - each of `DEFAULT_CONFIG.stepCaps`' values, and `repeatLimit`, `pageAttempts`, `restartEvery`, `maxConsecutiveFailures`, and the step and page time limits;
      - `4` shares kept.
    - "says a missing release fact isn't recorded". With `release: null`, it says `not recorded in this build of voicecap` where the tests and CI would be.
    - "draws whole for a website with no report". Use `RecordFacts` of empty content (Review Focus 2).
    - "names Guidepup in the toolchain table and nowhere else". It appears at least once inside `<table class="toolchain">`, and 0 times outside it.
    - "gives each npm tool the license of the package voicecap installs". For each toolchain row with `npm`, `license` equals `node_modules/<npm>/package.json`'s `license`.
    - "names only commands, files, and rules that exist":
      - each `commands[].name` appears as `.command("<name>` in `src/cli/main.ts`'s text;
      - each `code[].path` exists from the repository's root.
    - "links the code at the version's tag". Each code link starts with `https://github.com/ICJIA/voicecap/tree/v9.8.7/`.
    - "links only to the website's pages, GitHub, and npm". The set of hrefs is exact.
    - "keeps a wide table in a scroll box that a keyboard can reach and that's named". Each table's wrapper has `tabindex="0"`, `role="region"`, and `aria-labelledby` naming its heading (Review Focus 5).
    - "keeps the wording rules". There's no `/listened/i`; `/automat/i` appears only in the axe row; and there's no IP address.
  - **`site-build`:**
    - "writes Technical details, with its own policy at both its addresses";
    - "leaves out a site folder named technical-details";
    - the test that builds the same records twice, on two faked dates, now compares all four pages' bytes.
- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3: Add `BUILT_IN_RULES`** to `src/flags/evaluate.ts`, and use it where the rules are listed.
- [ ] **Step 4: Write `TECHNICAL_TEXT`** from the spec's Technical details parts 1 to 12, in the wording the shareable page and README use.
  - Every fact must be true of the code at this commit. The research notes' references are the checks:
    - the passes' keys and ends: `src/passes/*.ts`;
    - what a run records: `src/run/paths.ts`, `src/model.ts`;
    - the seals: `src/util/hash.ts`;
    - `voicecap verify`: `src/verify.ts`;
    - the website: `src/site/build.ts`, `headers.ts`, `netlify.ts`;
    - privacy: `src/drivers/guidepup/chrome.ts`, `src/run/git-files.ts`.
  - The toolchain rows are the spec's list, with `npm` set for each npm package.
  - Use "on this computer only", and no address, for NVDA's and Chrome's local ports.
- [ ] **Step 5: Implement `renderTechnical`** through `sitePage`, in this order:
  1. the kicker "Technical details";
  2. the h1 "How voicecap works";
  3. the spec's lead;
  4. the stamp "From voicecap <version>, released <date>." (or "not recorded…" without a date);
  5. "On this page", a `nav` with a list;
  6. the 12 parts.
  - **How a run works** is an `<ol class="flow">`; its arrows come from `::after`, with `content: "→" / ""` (`"↓"` on a phone).
  - **The tables** (commands, passes, defaults, rules, toolchain) are `<table>` with `<th scope="col">`, each in its scroll box.
  - **Related documents** is a card of four cards.
  - Styles go in `SITE_CSS`. Wire it into `buildSite` with its rules and `OWN_FILES`.
- [ ] **Step 6:** Add `technical-details.html` to the browser tests: axe in both themes at 1280, 390, and 320, nothing wider than 320, and both addresses served with their policy. Run them. Expected: PASS.
- [ ] **Step 7:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 8:** Commit: `Add Technical details, how voicecap works, with its passes, rules, and defaults taken from the code, and the toolchain's licenses held to the packages`.

### Task 4: The two bars and the back link

**Files:**
- Modify:
  - `src/site/frame.ts`, `src/site/icons.ts`, `src/site/client.ts`, `src/site/text.ts`, `src/site/style.ts`;
  - `src/site/render.ts` (the "On this page" row);
  - `src/site/trust.ts`, `src/site/technical.ts`, `src/site/whats-new.ts` (the new frame);
  - `src/site/build.ts`.
- Test: `test/site-render.test.ts`, `test/site-trust.test.ts`, `test/site-technical.test.ts`, `test/site-whats-new.test.ts`, `test/site-page-browser.test.ts`, `test/site-served.test.ts`.

**Interfaces:**
- Produces:
  - `type SitePage = "index" | "trust" | "technical" | "whats-new"`;
  - `siteBar(current: SitePage): string`;
  - `siteFooter(current: SitePage, version: string): string`;
  - `backLink(): string`;
  - `sitePage(parts: { title: string; current: SitePage; version: string; main: string[] }): string`;
  - `renderSiteIndex(content: SiteContent, voicecap: VoicecapFacts): string`;
  - `renderWhatsNew(input: { voicecap: VoicecapFacts }): string` (the `content` parameter goes);
  - `TrustInput` and `TechnicalInput` drop `content`, which was only for the old bar's view links;
  - `SITE_TEXT.siteName = "ICJIA Screen Reader Tests"`.

- [ ] **Step 1: Write the failing tests:**
  - **"heads every page with the website's name, then three links, then the theme button":**
    - `siteBar("trust")` has `<a class="name" href="index.html">ICJIA Screen Reader Tests</a>`;
    - then `<nav aria-label="This website">` with `trust.html`, `whats-new.html`, and `technical-details.html`, in that order, with the words "Can I trust this?", "What's New", and "Technical details";
    - `aria-current="page"` is only on the trust link;
    - on `siteBar("index")`, only the name has it.
  - **"ends every page with a list of six":**
    - `siteFooter("technical", "0.15.0")` has a `<ul>` of 6 `<li>`: `https://github.com/ICJIA/voicecap`, `https://github.com/ICJIA/voicecap/blob/main/CHANGELOG.md`, `whats-new.html`, `trust.html`, `technical-details.html`;
    - then `v0.15.0` with `aria-hidden="true"`, and `<span class="sr">voicecap version 0.15.0</span>`;
    - `aria-current="page"` is on the Technical details link;
    - every icon has `aria-hidden="true"`.
  - **"makes the theme button an icon with words for a screen reader":** `<button class="theme" id="theme-toggle" type="button" hidden aria-label="Switch to the light theme">`, holding a sun and a moon, each `aria-hidden`.
  - **"links the front page's views from its 'On this page' row":** `<nav aria-label="On this page">` holds `#demo` (when there is one), `#sites`, and `#by-date` (with two sites or more), and the top bar holds none of them.
  - **"opens the trust page, Technical details, and What's New with the way back":** `<a class="back" href="index.html">`, with the arrow `aria-hidden` and the words "Back to the test results"; the front page has none.
  - **Browser:**
    - "switches the theme, and its words, with the button": a click sets `data-theme="light"` and `aria-label` "Switch to the dark theme", and the choice is kept under `voicecap-theme`.
    - "keeps both bars whole at 200% and 400% text": set the root's font size, then check no bar item overlaps another or leaves the window, and that focus is visible on each bar link and on the button (Review Focus 3).
    - "draws every page whole without JavaScript": with `javaScriptEnabled: false`, the button stays hidden, the theme is dark, and every bar link answers 200 from the served site (Review Focus 4).
    - "fits a long version in the bottom bar at 320 pixels": a version 40 characters long (Review Focus 5).
  - **`site-served`:** "follows every link of both bars on all four pages to a page that's there".
- [ ] **Step 2:** Run the files. Expected: FAIL.
- [ ] **Step 3: Implement the frame.**
  - Every page passes `current` and `voicecap.version` to `sitePage`. The trust page, Technical details, and What's New start their main part with `backLink()`.
  - **Icons** (24-grid outlines, `aria-hidden`, sized by class): GitHub's mark (filled), a list, a megaphone, a shield with a check, a terminal's window, a sun, a moon, and a left arrow.
  - **The script** sets `aria-label` where it set `textContent`.
  - **The bars' styles:** the name at weight 600 in `--heading`; links in `--muted`, turning `--heading` under the pointer; the current link bold and underlined at 0.15em.
  - **The bottom bar:** a centered, wrapping row, 0.875rem, with dividers drawn as `li + li { border-left: 1px solid var(--line) }`.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Give every page the audit tool's two bars: the website's name and its three pages above, GitHub, the CHANGELOG, the pages, and the version below, and a way back from each page to the test results`.

### Task 5: The front page's kicker and banner, and the trust page's heading, stamp, releases, and two wordings

**Files:**
- Modify:
  - `src/site/render.ts`, `src/site/text.ts`;
  - `src/site/trust.ts`, `src/site/trust-text.ts`;
  - `src/site/style.ts`.
- Test: `test/site-render.test.ts`, `test/site-trust.test.ts`, `test/site-page-browser.test.ts`.

**Interfaces:**
- Consumes:
  - `renderSiteIndex(content, voicecap)` (Task 4);
  - `POWERSHELL_HASH` and `MAC_HASH` (`src/share/text.ts`).
- Produces:
  - `TRUST_TEXT.hero.heading` becomes `{ first: "Built to be checked.", second: "See for yourself." }`;
  - `TRUST_TEXT.hero.stamp` becomes `{ label(version, released): string; date(newest): string }`.

- [ ] **Step 1: Write the failing tests:**
  - **The front page's kicker:** "puts the kicker over the front page's heading". Before the h1, the page has `<p class="kicker">`, reading `ICJIA · Built for Title II of the ADA · WCAG · Illinois IITAA` to the eye. The three names are in `.act`, and each `·` is `aria-hidden`, with a comma in `.sr` instead.
  - **The banner:**
    - "shows the newest release between the lead and 'On this page'": the version's `.pill`, its headline, and `Released 8 October 2026`, with `See all updates` linking to `whats-new.html`, from `FACTS.releases[0]`;
    - "shows no banner when no release is recorded".
  - **The trust page:**
    - "heads the trust page in two lines": the h1's text is `Built to be checked. See for yourself.`, and its second sentence is in `.good`.
    - "puts the stamp in the audit tool's box: where the numbers come from, then the records' date": with no report, the date's side says `No report has been shared yet.`
    - "lists the newest five releases, then a link to the rest": with 7 releases, there are 5 items and `See all 7 releases` linking to `whats-new.html`; there's no fold; with 5 or fewer, there's no link.
    - "says each page of a website": the does-part has `each page of a website`, and not `every page`.
    - "links the files tile to how a copy is checked": its link goes to `#check`. The element with `id="check"`, in the evidence part, holds `Get-FileHash <file>` and `shasum -a 256 <file>`.
- [ ] **Step 2:** Run the files. Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - **The kicker's words** go in `SITE_TEXT.kicker`, as pieces, so the three names can be marked.
  - **The banner** is `<div class="news">`, holding a `.kicker` "What's new" and no landmark. It comes after the lead, before "On this page".
  - **The trust page:**
    - the stamp's label and date get the spec's box (a 2px `--warn` border on `--warn-tint`; the date at weight 900);
    - the tiles' numbers take `.good`, `.good`, `.act`, and `.warn`, in order;
    - the releases' fold goes;
    - `#check` is a new point in the evidence part, built from `POWERSHELL_HASH` and `MAC_HASH`.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS, with axe clean on both pages in both themes and at all three widths.
- [ ] **Step 5:** Commit: `Head the front page with its kicker and the newest release, and the trust page with its two-line heading, the stamp's box, the newest five releases, each page, and how a copy is checked`.

### Task 6: The README, its pictures, and the CHANGELOG

**Files:**
- Modify:
  - `README.md`, `CHANGELOG.md`;
  - `scripts/readme-screenshots.ts`, `test/readme-screenshots.test.ts`;
  - `assets/screenshots/website-dark.png`, `website-light.png`, and `website-trust.png`.
- Create: `assets/screenshots/website-technical.png` and `website-whats-new.png`.

- [ ] **Step 1: The pictures.**
  - `SCREENSHOTS` gains `website-technical.png` and `website-whats-new.png` after `website-trust.png`: eleven in all.
  - `shootWebsite` shoots Technical details from its bar through "On this page", and What's New through its first two cards, both dark.
  - The build keeps using `EXAMPLE_FACTS` (R-T9), so the pictures come out the same each time.
  - Run `pnpm readme:screenshots`. Commit the five website pictures only, and restore the report pictures it rewrites (`git checkout -- <file>`).
- [ ] **Step 2: The README:**
  - **"The website: `voicecap site`"** describes:
    - the four pages, and each one's addresses;
    - both bars, word for word;
    - the look: the audit tool's colors, system fonts, and no fonts embedded;
    - What's New: what it shows of each release, its link to the CHANGELOG, and that it's built at each build;
    - Technical details: its parts, which of its facts come from the code, and its licenses held to the packages;
    - the banner;
    - the policy's `font-src 'none'` for the website's pages.
  - **The pictures,** with alt text that says what each shows; the screenshot row says eleven.
  - **"What goes in the output folder" and "left out"** gain `technical-details.html`, `technical-details`, `whats-new.html`, and `whats-new`.
  - **`voicecap site --help`'s description** (`src/cli/main.ts`) and its pinned copy (`test/cli.test.ts`) name the two new pages.
- [ ] **Step 3: The CHANGELOG:** under `## [Unreleased]`, in its style:
  - `### Added`: Technical details, What's New, the banner, and the two bars;
  - `### Changed`: the look, no fonts embedded, the bar no longer sticky, the trust page's heading, stamp, releases, and its two wordings.
  - No report needs sharing again.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Describe the website's new look, its two bars, Technical details, and What's New in the README, with their pictures, and in the CHANGELOG`.

## The release (with the owner)

1. Review the whole branch, then make one round of fixes and review them.
2. Merge: `git switch main && git merge --no-ff plan-12-website-look`. Then make "Prepare 0.15.0":
   - the CHANGELOG's `## [0.15.0] - <date>`, and its compare links;
   - the timeline's row in `src/share/text.ts`, under `both`: `<b>0.15.0</b>: the website in the audit tool's look: a top bar and a bottom bar on every page, Technical details on how voicecap works, and What's New, every release from the CHANGELOG.`;
   - the Word copy's test of the timeline's days, which gains the row's day;
   - the handoff's "Published" and "Being built" lines.
3. Push, and get CI green on all six jobs.
4. Run `./publish.sh --dry-run minor`. Check its facts: the test count, `commits.first` `2026-09-25`, and CI's matrix.
5. Run `npm whoami`. If the login has expired, the owner runs `! npm login`.
6. The owner gives a fresh 2FA code. Then run `npm version minor --no-git-tag-version && npm publish --access public --ignore-scripts --otp <code>`.
7. Commit "Release v0.15.0", tag `v0.15.0` (annotated), and push with the tag.
8. Once the tarball answers 200 and 10 minutes have passed, set the transcripts repo's `netlify.toml` command to `@0.15`, commit, and push (the owner's standing OK).
9. **The live check:**
   - all four pages answer at both their addresses, each with its own policy, and with `font-src 'none'`;
   - each page equals a local `npx @icjia/voicecap@0.15.0 site` build, but for Netlify's pretty URLs;
   - a report is byte-identical.
10. Update the handoff and the memories. Next is plan 10 (axe on each page's card), as 0.16.0.
