# Plan 9: The page for managers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put what a manager needs first on the shareable page and in its Word copy, in this order:
- **At a glance:** a verdict in words and an icon, the result in one sentence, a ring of the pages, and four big numbers;
- **What needs attention,** only when there's a card;
- **Every page,** each card with what NVDA said first and its full transcript folded inside;
- **The details, for reviewers and auditors.**

Ship it as 0.13.0, then share sfs and i2i v3 again.

**Architecture:**
- **One verdict rule.** `verdictOf(result)`, in a new `src/share/verdict.ts`, serves the page's At a glance, its Word copy, and the website's card (0.12.3). It works from the `ShareResult` the model now carries (`model.result`), which `voicecap share` already records.
- **New in the model:** the ring's three counts (`model.ring`), and each page's first lines (`PageCard.heardFirst`).
- **The page's sections become four:** `renderGlance`, `renderAttention`, `renderPages` (which takes in the appendix's transcripts), and `renderDetails`. `renderDetails` lives in a new `src/share/html/details.ts`, and sets today's later sections one heading level down with `demoted`.
- **The Word copy's outline** follows the same order, with a fourth heading level.

**Tech Stack:** TypeScript strict ESM, Node 22.19+, pnpm, Vitest, Playwright's headless Chromium (axe, folds, the README's screenshots), and docx 9.8.1. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-30-shareable-report-design.md`, as amended in bf59344 and merged with 0.12.3 in 3a40612. The parts this plan builds:
- "The page, top to bottom";
- "What's open at first, and what's folded";
- "Checking the fingerprints in the page" (the transcripts in a page's card);
- "The Word copy";
- "Rules the page follows" (the verdict in words and an icon);
- "Tests", under "The page for managers (0.13.0)";
- "Stages and release", item 5.

Task 6 writes the decisions below into the spec.

**Branch:** `plan-9-page-for-managers`, in the worktree `C:/Users/cschw/code/voicecap-redesign`. Main (0.12.3) was merged into it at 3a40612. Run `pnpm install` in the worktree first: it has no `node_modules` of its own.

## Decisions this plan makes (the owner reviews them with the plan)

- **D1, one count of problems at the top.** On the demo, the verdict says "5 problems need attention, on 2 pages", counting every card. Today's sentence says "4 problems need attention, on 1 page", counting only the cards that come from flags. Shown together they disagree. So the sentence stops counting problems, and the verdict counts them, every card, as What needs attention, the Word copy, and the website's card do. The sentence keeps who ran it, who heard NVDA, who reviewed, and what review found. The demo's becomes "NVDA read all 7 pages."
  - **The alternative, if the owner prefers it:** the sentence counts every card too. Task 1's step for the sentence changes, and nothing else does.
- **D2, red means a page in scope wasn't read.** The verdict is red when NVDA read fewer pages than are in scope, whether it couldn't read one or skipped it. That's the website card's rule (0.12.3). With no card then, it says "Nothing needs attention on the pages read", as the page's own line does. The spec said "couldn't be read".
- **D3, the method line keeps "the reading and the deciding".** The spec's copy says "the listening, the reading, and the deciding", which predates the owner's rule of 2026-10-02 against saying a person listened. The page keeps today's words (`summary.second`).
- **D4, the Word copy matches the page.**
  - Its ring table replaces "each page's latest result", as the ring replaces that bar on the page.
  - It has no "On this page": its headings and Word's navigation pane do that.

## Global Constraints

- **Never "automated".** voicecap is always a person's review with a real screen reader, sped up, never "automated testing" or an "automated checker".
- **Words to avoid:** never say a person "listened" (say "heard"; keep "listen-through"). Never name Guidepup on the page or in the Word copy.
- **Only what the records show.** The page says a person heard NVDA, reviewed, or fixed something only where the records say so.
- **Computed numbers.** Every number is computed from the records, never typed.
- **One source of words.** The page's words live in `src/share/text.ts`, and both renderers use them.
- **Copy the spec pins, word for word:**
  - "At a glance";
  - the verdict's headlines, from `verdictOf` (Task 1);
  - the ring's parts: "No problems", "Need attention", "Not read";
  - "On this page", and its links' words: "What needs attention", "Every page", "The details";
  - "The details, for reviewers and auditors", and its line: "How the test was run, what it covered, and the evidence behind it.";
  - "Heard first", and "The full transcript";
  - the method line: `summary.second`, as today (D3).
- **No status by color alone.** The verdict says it in words. Its sign (✓, ⚠) is drawn by the page's style with empty alternative text (`content: "✓" / ""`), as the website's card's is. A sign in the markup fails axe's contrast check ("contains only non-text characters").
- **Accessibility:**
  - headings in order, never skipping a level: The details' parts are `h3`, and what's inside them starts at `h4`;
  - folds are `<details>` and `<summary>`; a section's heading is never inside a fold, and a fold's summary line is never a heading (`fold` refuses both);
  - axe reports zero violations;
  - the page sets no `style` attribute: it has one style block and one script, hashed by its Content Security Policy.
- **Commits:** a plain subject line with no trailers of any kind, and no push until the release.
- **What subagents never do:**
  - start NVDA, Word, or any desktop program;
  - run voicecap, except through the test suite's scripted or replay drivers;
  - pass a composed command through `cmd /c` or any shell;
  - touch the owner's transcripts home.

  Headless Chromium through the test suite and through `pnpm readme:screenshots` is allowed.

## Review Focus

1. **A site where no run counts yet:** At a glance has the sentence ("No live run counts yet: …"), the method line, and On this page. It has no verdict, ring, or numbers, and The details has no parts from the summary. Tasks 2 and 3 test it.
2. **A large site** (more than 12 pages): the cards with nothing to note fold behind one line, and each holds its own transcript fold. A link to a page's transcript inside that fold opens both folds, and "Open every section" opens them all. Task 4 tests it.
3. **A page never read, and a page whose transcripts can't be read here:**
   - the first has no Heard first and no transcript fold, and the ring counts it as Not read;
   - the second has its fold, with the line that says its transcript couldn't be read.

   Tasks 1 and 4 test them.
4. **Text that needs escaping** in a page's first lines (`<`, `&`, `"`): shown as text on the page, never as markup, and as plain text in Word. Tasks 4 and 5 test it.
5. **A ring of one part:** when every page has no problems, the ring is one whole circle (one arc as long as the ring). A part with no pages draws no arc, but keeps its legend line, with 0. Task 3 tests it.

---

### Task 1: The verdict, the ring, and each page's first lines, in the model

**Files:**
- Create: `src/share/verdict.ts`.
- Modify: `src/share/text.ts`: `ATTENTION_TEXT` gains `headline(problems: number, pages: number): string`, which is today's `sentence` without its period. `sentence` becomes `` `${headline(problems, pages)}.` ``.
- Modify: `src/share/cards.ts`: `PageCard.heardFirst`, and `export const HEARD = 3`, moved here from `model.ts`.
- Modify: `src/share/model.ts`: `ShareModel.result` and `ShareModel.ring`. `heardOf` imports `HEARD`.
- Modify: `src/share/summary.ts`: the sentence loses its part on problems (D1).
- Modify: `src/share/words.ts`: add `glanceNumbersOf`. `numbersOf` stays until Task 5 removes it.
- Modify: `src/share/share.ts`: the entry's `result` is `model.result`.
- Modify: `src/site/text.ts` (`SITE_TEXT.verdict`) and `src/site/render.ts` (`verdict`): the website card's words and kind from `verdictOf`. Their words don't change.
- Test:
  - `test/share-verdict.test.ts` (new);
  - `test/share-model.test.ts`, `test/share-summary.test.ts`, and `test/share-words.test.ts`;
  - `test/share-report.test.ts` and `test/site-render.test.ts`, which must pass unchanged.

**Interfaces:**
- Produces:
  - `export type VerdictKind = "ok" | "warn" | "bad"`.
  - `export interface Verdict { kind: VerdictKind; headline: string }`.
  - **`export function verdictOf(result: ShareResult): Verdict`.**
    - The kind is "bad" when `read < pages`, else "warn" when `problems > 0`, else "ok".
    - The headline is `ATTENTION_TEXT.headline(problems, problemPages)` when `problems > 0`, else "Nothing needs attention" when `read === pages`, else "Nothing needs attention on the pages read".
  - **`ShareModel.result: ShareResult`**: `{ pages: summary.numbers.pagesInScope, read: summary.numbers.transcribed, problems: summary.attention.problems, problemPages: summary.attention.pages }`.
  - **`ShareModel.ring: { noProblems: number; needAttention: number; notRead: number }`**, from the page cards:
    - a card with `counts === null` is not read;
    - a card with counts, whose slug is on any attention card's pages, needs attention;
    - every other card has no problems.
  - **`PageCard.heardFirst: string[]`**: the first `HEARD` lines of the read pass of the transcripts shown, as `stepLine` gives them, taking only the steps of `MAIN_COMMAND.read`, as `heardOf` does; `[]` when there are none.
  - **`glanceNumbersOf(model: ShareModel): NumberTile[]`**, four tiles:
    - `{ part: read, whole: pages }`, labeled "pages read by NVDA", in the tone `ok` when they're equal, `warn` when fewer, and `quiet` with no page;
    - `{ count: problems }`, labeled "problems to fix" ("problem to fix" for one), `warn` above 0 and `ok` at 0;
    - lines NVDA spoke, and NVDA time, as `numbersOf` gives them today.

- [ ] **Step 1: Write the failing tests.**
  - **`test/share-verdict.test.ts`, "says each kind of result in words, with its kind"** (an `it.each` of `{ pages, read, problems, problemPages }` → kind, headline):
    - `9, 9, 0, 0` → `ok`, "Nothing needs attention"
    - `32, 32, 1, 32` → `warn`, "1 problem needs attention, on 32 pages"
    - `3, 3, 2, 1` → `warn`, "2 problems need attention, on 1 page"
    - `9, 7, 2, 2` → `bad`, "2 problems need attention, on 2 pages"
    - `9, 8, 0, 0` → `bad`, "Nothing needs attention on the pages read"
  - **`test/share-model.test.ts`, "carries the result its copies say, and the ring's three parts":** `demoModel()` gives `result` equal to `{ pages: 7, read: 7, problems: 5, problemPages: 2 }`, and `ring` equal to `{ noProblems: 5, needAttention: 2, notRead: 0 }`. The ring's parts add up to `result.pages`.
  - **"counts a page never read as not read":** in a model built with `inputOf`, where the latest run failed a page that no run transcribed:
    - `ring.notRead` is 1;
    - `verdictOf(model.result).kind` is `bad`.
  - **"gives each card the first three lines NVDA said on it":**
    - the demo's home card's `heardFirst` equals the first three lines of the read transcript the model carries for it (`model.appendix`'s read file, split at line breaks), checked as a literal list in the test;
    - a page whose read pass has fewer lines gives what it has;
    - a page with no transcripts gives `[]`.
  - **`test/share-summary.test.ts`:** the demo's sentence is "NVDA read all 7 pages." (D1). Every test that pins a sentence ending with a count of problems loses that part, in this file and in any other that pins one (`test/share-html-top.test.ts` and `test/share-word-top.test.ts` among them).
  - **`test/share-words.test.ts`, "gives At a glance its four numbers":** on the demo:
    - `{ part: 7, whole: 7 }`, "pages read by NVDA", `ok`;
    - `{ count: 5 }`, "problems to fix", `warn`;
    - `{ count: 204 }`, "lines NVDA spoke", `quiet`;
    - `{ ms: 754000 }`, "of NVDA time, across 2 runs", `quiet`.
- [ ] **Step 2:** Run the new and changed test files. Expected: FAIL (no `verdict.ts`, no `result`, no `ring`, no `heardFirst`).
- [ ] **Step 3: Implement** the interfaces above. Then make `share.ts` use `model.result`, and the website's card take its kind and headline from `verdictOf`. The card adds ". " or ": " and how many pages NVDA read, as today.
- [ ] **Step 4:** Run the test files. Expected: PASS, and `test/share-report.test.ts` and `test/site-render.test.ts` pass with no change. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Work out the verdict, the ring of the pages, and each page's first lines in the model, and give the website's card the same verdict`.

### Task 2: The details, for reviewers and auditors, on the page

**Files:**
- Create: `src/share/html/details.ts`: `renderDetails(model: ShareModel): string`.
- Modify: `src/share/html/parts.ts`: add `demoted`.
- Modify: `src/share/html/top.ts`:
  - **The summary's panels and bars become the details' parts:** `todoPart`, `completePart`, `whenHowPart`, `rulesPart`, and `reviewPart`, all exported. They're today's panels and meters, each now `<section aria-labelledby="<id>">` with `<h3 id="<id>">`. The ids are `todo-h`, `complete-h`, `whenhow-h`, `rules-h`, and `review-h`.
  - **`renderSummary` keeps** its sentence, second line, tiles, and contents, and loses its four panels and three bars. Two go for good: the attention panel (`attentionPanel`), since Task 3's verdict and What needs attention say it, and the results bar (`resultsMeter`), which Task 3's ring replaces.
  - **`renderHow`'s sample** of what NVDA said becomes a fold, with the class `heard-fold` and the summary line `<span class="what">${heardTitle(sample)}</span>`. The six steps and the band on when to run stay open.
- Modify: `src/share/text.ts`: `DETAILS_TEXT = { title: "The details, for reviewers and auditors", gist: "How the test was run, what it covered, and the evidence behind it.", link: "The details" }`.
- Modify: `src/share/html/document.ts`: `SECTIONS` becomes `[renderSummary, renderAttention, renderPages, renderDetails, renderAppendix]`.
- Modify: `src/share/html/style.ts`: a part's `h3` looks like a section heading, a step smaller. Its panels keep their look.
- Test:
  - `test/share-html-details.test.ts` (new);
  - `test/share-html-top.test.ts`: the panels' and bars' tests move to the new file;
  - `test/share-document.test.ts` and `test/share-browser.test.ts`: "the summary's panels" become "the details' parts".

**Interfaces:**
- Consumes: today's `renderChanges`, `renderProblems`, `renderCoverage`, `renderEvidence`, `renderHow`, and `renderStory`.
- Produces:
  - **`demoted(html: string): string`:** every heading in the markup one level down, `h2` to `h6`. It moves opening tags (`<h2>`, and `<h2` followed by white space) and closing tags alike. It throws `"A heading can't go below h6."` for an `h6`.
  - **`renderDetails(model)`:** `<section id="details" aria-labelledby="details-h">` with `<h2 id="details-h">`, then `<p class="gist">` with DETAILS_TEXT's line. Then, in this order:
    1. `todoPart`
    2. `completePart`
    3. `whenHowPart`
    4. `demoted(renderChanges(model))`
    5. `demoted(renderProblems(model))`
    6. `demoted(renderCoverage(model))`
    7. `rulesPart`
    8. `reviewPart`
    9. `demoted(renderEvidence(model))`
    10. `demoted(renderHow(model))`
    11. `demoted(renderStory(model))`

    When no run counts (`header.tested === null`), the five parts from the summary are left out, as the summary leaves them out today.
  - Each moved section keeps its ids, so every link to `#chg-h`, `#prob-h`, `#lim-h`, `#ev-h`, `#how-h`, or `#story-h` still lands.

- [ ] **Step 1: Write the failing tests.**
  - **`test/share-html-details.test.ts`:**
    - **"sets out the details in the spec's order, each part's heading at level 3":** on the demo, the `h3` ids that are parts, in order: `todo-h`, `complete-h`, `whenhow-h`, `chg-h`, `prob-h`, `lim-h`, `rules-h`, `review-h`, `ev-h`, `how-h`, `story-h`. The only `h2` is `details-h`.
    - **"says what's here under its heading":** the gist reads "How the test was run, what it covered, and the evidence behind it."
    - **"keeps what's inside each part below it":** no heading inside the details skips a level.
    - **"folds How voicecap works' sample of what NVDA said":** a `<details class="fold heard-fold">` whose summary line starts "Heard on this site". The six steps' `ol.flow` is outside every fold.
    - **"leaves out the summary's parts when no run counts":** the model of a site whose only run was a replay has no `todo-h`, `complete-h`, `whenhow-h`, `rules-h`, or `review-h`.
    - **`demoted`:**
      - `"<h2 id=\"a\">A</h2><h5>B</h5>"` gives `"<h3 id=\"a\">A</h3><h6>B</h6>"`;
      - text that holds `&lt;h2&gt;` stays as it is;
      - `"<h6>x</h6>"` throws.
  - **`test/share-document.test.ts`, "puts the sections in the spec's order":** the `h2` ids are `glance-h`, `need-h`, `pages-h`, `details-h`, and `app-h`, each outside every fold.
  - **`test/share-browser.test.ts`:** axe reports zero violations on the demo's page, dark and light, with every fold closed and every fold open.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Gather what reviewers and auditors need into The details, each part a heading under it, and fold How voicecap works' sample`.

### Task 3: At a glance, on the page

**Files:**
- Modify: `src/share/html/top.ts`: `renderGlance(model: ShareModel): string` replaces `renderSummary`. It drops what was left of the summary: `tiles` (five numbers) and `contents`.
- Modify: `src/share/html/parts.ts`: add `ring`.
- Modify: `src/share/text.ts`: `GLANCE_TEXT = { title: "At a glance", parts: { noProblems: "No problems", needAttention: "Need attention", notRead: "Not read" }, onThisPage: "On this page" }`. `SUMMARY_TEXT` keeps the parts' and bars' titles.
- Modify: `src/share/html/attention.ts`: `renderAttention` gives `""` when `model.attention` is empty. The verdict says so instead.
- Modify: `src/share/html/document.ts`: `SECTIONS` starts with `renderGlance`.
- Modify: `src/share/html/style.ts`:
  - the verdict line, a large line;
  - its signs, which only repeat the words: `.verdict.ok::before { content: "✓"; content: "✓" / ""; color: var(--ok) }`, and `⚠` for `warn` (`--warn`) and `bad` (`--bad`);
  - the ring and its legend, side by side, and one above the other below 40em;
  - four tiles.
- Test: `test/share-html-top.test.ts`, `test/share-html-attention.test.ts`, `test/share-document.test.ts`, and `test/share-browser.test.ts`.

**Interfaces:**
- Consumes: `verdictOf`, `model.result`, `model.ring`, and `glanceNumbersOf` (Task 1), and `DETAILS_TEXT.link` (Task 2).
- Produces:
  - `export interface RingPart { label: string; value: number; kind: "ok" | "warn" | "bad" }`.
  - **`ring(parts: RingPart[], total: number): string`**, in `parts.ts`:
    - It's `<div class="ring" aria-hidden="true">` holding an SVG `viewBox="0 0 120 120"`, with a track circle (`cx 60, cy 60, r 48, stroke-width 16`).
    - Each part with a value above 0 is a `<circle class="ring-part <kind>">` on the same circle, with `stroke-dasharray="<len> <C - len>"` and `stroke-dashoffset="<-start>"`. `C` is `2π × 48`, rounded to two places (301.59). `len` is `C × value / total`. `start` is the sum of the earlier parts' lengths.
    - The SVG is turned `-90°`, so the first part starts at the top.
    - After the SVG come `<span class="ring-n">` with `count(total)`, and `<span class="ring-k">` with "pages" ("page" for one).
    - The legend is apart from it: `<ul class="ring-legend" role="list">`, with an `<li class="<kind>">` for every part, those of 0 too: `<span class="sw" aria-hidden="true"></span><label>: <b><count></b>`.
  - **`renderGlance(model)`:** `<section class="glance" aria-labelledby="glance-h">`, with `<h2 id="glance-h">At a glance</h2>`, then in this order:
    1. `<p class="verdict <kind>"><headline></p>`;
    2. `<p class="lead"><summary.sentence></p>`;
    3. `<div class="ring-row">`, with the ring and its legend, its parts in the order No problems (`ok`), Need attention (`warn`), Not read (`bad`);
    4. `<div class="tiles">` with the four numbers;
    5. `<p class="gist"><summary.second></p>`;
    6. `<nav class="toc" aria-label="On this page">`, with `<span class="sub">On this page:</span>`, then links to `#need-h` (only when there's a card), `#pages-h`, and `#details-h`.

    When no run counts, items 1, 3, and 4 are left out.

- [ ] **Step 1: Write the failing tests.**
  - **`test/share-html-top.test.ts`, "opens with At a glance, in its order":** on the demo, the verdict, the lead, the ring's row, the tiles, the method line, and the nav come in that order. They are:
    - the verdict: `<p class="verdict warn">5 problems need attention, on 2 pages</p>`;
    - the lead: "NVDA read all 7 pages." (D1);
    - the method line: "A human review, sped up: voicecap presses NVDA's keys and moves from page to page; the person running it does the reading and the deciding." (D3).
  - **"draws the ring, with a legend that says each part in words":** on the demo:
    - the legend's items read "No problems: 5", "Need attention: 2", "Not read: 0";
    - there's one `ring-part ok` and one `ring-part warn`, and no `ring-part bad`;
    - the ring's box is `aria-hidden="true"`, and the legend has `role="list"`.
  - **"draws one whole circle for a ring of one part"** (Review Focus 5): `ring([{ label: "No problems", value: 9, kind: "ok" }, { label: "Need attention", value: 0, kind: "warn" }, { label: "Not read", value: 0, kind: "bad" }], 9)` has exactly one `ring-part`, with `stroke-dasharray="301.59 0"`.
  - **"says it in four big numbers":** on the demo, the tiles' labels are "pages read by NVDA", "problems to fix", "lines NVDA spoke", and "of NVDA time, across 2 runs". The first is `7/7`, and the second `5`.
  - **"links to what's on the page":** on the demo, the nav's links go to `#need-h`, `#pages-h`, and `#details-h`. In a model with no card, they go to `#pages-h` and `#details-h`.
  - **"has no verdict, ring, or numbers before any run counts"** (Review Focus 1): the model of a site whose only run was a replay has the `h2`, the lead ("No live run counts yet: …"), the method line, and the nav. It has no `class="verdict`, no `class="ring`, and no `class="tiles"`.
  - **`test/share-html-attention.test.ts`, "isn't there without a card":** `renderAttention` of a model with no card is `""`.
  - **`test/share-document.test.ts`:** the `h2` ids are `glance-h`, `need-h`, `pages-h`, `details-h`, and `app-h`, and `need-h` is missing without a card.
  - **`test/share-browser.test.ts`:**
    - axe reports zero violations on At a glance, dark and light, at 1280, 390, and 320 px;
    - the verdict's `::before` content is `"⚠" / ""` on the demo;
    - Chromium's accessibility tree gives the verdict's words with no sign in them, as the website's test checks.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement,** and remove the dead code listed above.
- [ ] **Step 4:** PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Open the page with At a glance: a verdict in words and an icon, a ring of the pages, and four big numbers`.

### Task 4: Every page, with what NVDA said first and its full transcript

**Files:**
- Modify: `src/share/html/pages.ts`:
  - **`cardOf` adds two things.** "Heard first" comes after the chips and the lines under them. The full transcript's fold comes after the strip. The link "Transcripts and fingerprints" goes.
  - **A transcript's heading is `h4`,** inside the card's `h3`.
  - **These are removed:** `renderAppendix`, `appendixPage`'s screenshot copy, and `OPEN_A_PAGE`.
- Modify: `src/share/words.ts`: remove `appendixGist`.
- Modify: `src/share/text.ts`:
  - `PAGES_TEXT` gains `heardFirst: "Heard first"` and `fullTranscript: "The full transcript"`;
  - `APPENDIX_TEXT` loses `title`, and keeps the words its transcripts use.
- Modify: `src/share/html/document.ts`: `SECTIONS` becomes `[renderGlance, renderAttention, renderPages, renderDetails]`.
- Modify: `src/share/check.ts`: the comments only. It finds `section.tx[data-file]` anywhere on the page, so its code doesn't change.
- Modify: `src/share/html/style.ts`: Heard first, and the fold inside a card.
- Move: `manyPages(total, flagged)`, from `test/share-html-pages.test.ts` to `test/helpers/share-model.ts`, so the browser tests use it too.
- Test: `test/share-html-pages.test.ts`, `test/share-document.test.ts`, `test/share-browser.test.ts`, and `test/share-check.test.ts`.

**Interfaces:**
- Consumes: `PageCard.heardFirst` (Task 1).
- Produces:
  - **Heard first:** `<figure class="heard-first"><figcaption>Heard first</figcaption><ol class="said-list" role="list">`, then `<li>“<esc(line)>”</li>` for each line. There's none when `heardFirst` is `[]`.
  - **The transcript fold:** `fold(summary, body, { id: \`tx-${idFragment(slug)}\`, className: "tx-page" })`:
    - its summary is `<span class="what">The full transcript:</span> <span class="sub"><transcriptsInside(passes)></span>`;
    - its body is today's appendix entry without its screenshot: the line naming the run, each `section.tx`, and the line for no files.

    A page with no entry in `model.appendix` has no fold.

- [ ] **Step 1: Write the failing tests.**
  - **`test/share-html-pages.test.ts`:**
    - **"shows each page's first lines, word for word":** the demo's home card has `figure.heard-first` with its three lines, in curly quotes, in `heardFirst`'s order.
    - **"escapes a first line"** (Review Focus 4): a card whose `heardFirst` is `['link, <b> & "x"']` shows `“link, &lt;b&gt; &amp; &quot;x&quot;”`.
    - **"folds each page's full transcript into its card":**
      - `article#pg-<slug>` holds `details#tx-<slug>.tx-page`, whose summary reads "The full transcript: read, headings, and Tab transcripts";
      - its three `section.tx` keep `data-run`, `data-slug`, and `data-file`, with `h4` headings;
      - the page has one `img[data-file]` for each page with a screenshot.
    - **"has no first lines and no transcript fold for a page never read"** (Review Focus 3).
    - **"keeps a transcript it can't read in the fold, said in words"** (Review Focus 3).
  - **`test/share-document.test.ts`:**
    - **"grows by each screenshot's base64 once, on its card":** today's "at most twice" becomes once.
    - **"puts the sections in the spec's order":** the `h2` ids are `glance-h`, `need-h`, `pages-h`, and `details-h`. There's no `app-h`.
  - **`test/share-browser.test.ts`:**
    - **"a link to a page's transcript opens its fold, and the fold of quiet pages around it"** (Review Focus 2): on `manyPages(13, 2)`'s page, a link to the transcript fold of a quiet page opens both folds, and "Open every section" opens every fold.
    - **"Check the fingerprints catches a changed character in a card's transcript":** change one character in a `section.tx pre`, and the check names that file, in red and in words.
    - **The spec's axe matrix:** zero violations with every fold closed and every fold open, at 1280, 390, and 320 px, dark and light.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement,** and remove the appendix.
- [ ] **Step 4:** PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Show each page's first lines in its card, with its full transcript folded there, in place of the appendix`.

### Task 5: The Word copy, in the page's order

**Files:**
- Modify: `src/share/word/blocks.ts`:
  - a heading's level is `1 | 2 | 3 | 4`;
  - add `demoted(blocks: Block[]): Block[]`, which adds 1 to each heading's level, and throws `"A heading can't go below level 4."` past 4.
- Modify: `src/share/docx.ts`: a `heading4` style, `headingStyle(3, 22, 160, 40)`, and level 4 as `HEADING_4`.
- Modify: `src/share/word/top.ts`:
  - `wordGlance(model: ShareModel): Block[]` replaces `wordSummary`. It drops `numbersTable`'s five numbers and `resultsBlocks`;
  - export `todoBlocks`, `completeBlocks`, `whenHowBlocks`, `rulesBlocks`, and `reviewBlocks` for the details.
- Modify: `src/share/word/attention.ts`: `wordAttention` gives `[]` without a card.
- Modify: `src/share/word/pages.ts`: `wordPages` gives each page its own blocks, in place of today's table of pages. `wordAppendix` is removed.
- Create: `src/share/word/details.ts`: `wordDetails(model: ShareModel): Block[]`.
- Modify: `src/share/word/outline.ts`: `SECTIONS` becomes `[wordTop, wordGlance, wordAttention, wordPages, wordDetails, wordFooter]`.
- Modify: `src/share/words.ts`: remove `numbersOf` and `resultsCaption`, which nothing uses now.
- Test: `test/share-word-top.test.ts`, `test/share-word-pages.test.ts`, `test/share-word-outline.test.ts`, and `test/share-docx.test.ts`.

**Interfaces:**
- Consumes: `verdictOf`, `model.result`, `model.ring`, `glanceNumbersOf`, and `PageCard.heardFirst` (Task 1); `DETAILS_TEXT` (Task 2); `GLANCE_TEXT` (Task 3); and `PAGES_TEXT.heardFirst` (Task 4).
- Produces:
  - **`wordGlance(model)`:**
    - `heading(1, "At a glance")`;
    - the verdict, as a paragraph in bold, `<sign> <headline>`, where the sign is `✓` for `ok` and `⚠` otherwise;
    - the sentence;
    - the ring's table, `table(["Part", "Pages"], [["No problems", "5"], ["Need attention", "2"], ["Not read", "0"]])` on the demo;
    - the four numbers' table;
    - the method line;
    - `PAGE_BREAK`.

    When no run counts, there's only its heading, the sentence, and the method line.
  - **`wordPages(model)`:**
    - `heading(1, "Every page")` and its gist;
    - for each page:
      - `heading(2, "<n> <path>")`;
      - its picture, or the line that says why there's none;
      - one paragraph of its status, its flags, and its review, as today's table cells say them;
      - when it has first lines, a "Heard first" paragraph and a `list` of the lines, each in curly quotes;
      - then each transcript: `heading(3, "<Pass>, <n> lines")`, its fingerprint paragraph, and its lines as `mono`;
    - the pages no longer listed, as today.
  - **`wordDetails(model)`:**
    - `heading(1, DETAILS_TEXT.title)` and a paragraph of its gist;
    - then `todoBlocks`, `completeBlocks`, `whenHowBlocks`, `demoted(wordChanges(model))`, `demoted(wordProblems(model))`, `demoted(wordCoverage(model))`, `rulesBlocks`, `reviewBlocks`, `demoted(wordEvidence(model))`, `demoted(wordHow(model))`, and `demoted(wordStory(model))`.

- [ ] **Step 1: Write the failing tests.**
  - **`test/share-word-outline.test.ts`, "has the page's order":**
    - on the demo, the level-1 headings, in order, are "At a glance", "What needs attention", "Every page", "The details, for reviewers and auditors", and the footer's;
    - there's no "Appendix";
    - no heading skips a level;
    - a level-4 heading is under "The evidence behind these results".
  - **`test/share-word-top.test.ts`, "says At a glance first":** on the demo:
    - the verdict paragraph reads "⚠ 5 problems need attention, on 2 pages";
    - the ring's table has the rows above;
    - the numbers' table has four rows.
  - **`test/share-word-pages.test.ts`:**
    - the home page has `heading 2 "1 /"`, its picture, a "Heard first" list of three quoted lines, then three `heading 3` transcripts, each with `mono` lines;
    - a page never read has none of those transcripts;
    - a line holding `<b> & "x"` is plain text in the list (Review Focus 4).
  - **`test/share-docx.test.ts`:** a level-4 heading gets the Heading4 style in the .docx's XML.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement,** and remove `wordSummary`, `wordAppendix`, the table of pages, `numbersOf`, and `resultsCaption`.
- [ ] **Step 4:** PASS. Then run `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 5:** Commit: `Set the Word copy in the page's order: At a glance, What needs attention, every page with its transcripts, and The details`.

### Task 6: The README, the screenshots, the spec, and the CHANGELOG

**Files:**
- Modify: `scripts/readme-screenshots.ts`. The selectors follow the page:
  - `report-top.png` is from the top through `section.glance nav.toc`;
  - `report-heard.png` is `details.heard-fold`, opened first;
  - `report-pages.png` keeps its row of cards, now with Heard first and the closed transcript fold;
  - `report-attention.png`, `report-timeline.png` (`section:has(> #ev-h) > .folds > details`), and `report-fingerprints.png` keep their selectors.
- Run: `pnpm readme:screenshots`, and look at all eight pictures.
- Modify: `README.md`:
  - "The shareable page" describes the new order, part by part;
  - each picture's description and alt text say what it now shows;
  - the Word copy's order.
- Modify: the spec:
  - "The page, top to bottom", item 2: D1, D2, and D3;
  - "The human review": the sentence has no count of problems (D1);
  - "The Word copy": D4;
  - "Tests", under "The page for managers (0.13.0)": the verdict's three states as D2 words them.
- Modify: `CHANGELOG.md`: under `## [Unreleased]`, Changed:
  - the page's new order;
  - At a glance, with the verdict, the ring, and four numbers;
  - What needs attention only with a card;
  - each page's first lines and full transcript in its card, with no appendix;
  - The details;
  - the Word copy's order;
  - the sentence's count of problems, which moved to the verdict.

- [ ] **Step 1:** Make the changes above.
- [ ] **Step 2:** Run `pnpm lint && pnpm typecheck && pnpm test`. `test/readme-screenshots.test.ts` passes, and the two website pictures haven't changed.
- [ ] **Step 3:** Commit: `Describe the page for managers in the README, with its pictures drawn again, and in the spec and the CHANGELOG`.

## The release (the controller, with the owner)

1. Run the final review on opus, then one fix wave and its re-review (subagent-driven development).
2. Push the branch, and get CI green on all six jobs.
3. Merge: `git switch main && git merge --no-ff plan-9-page-for-managers`.
4. **"Prepare 0.13.0":**
   - the CHANGELOG's `## [0.13.0] - <date>` and its compare link;
   - the timeline's 0.13.0 row in `src/share/text.ts`, on both tracks: `<b>0.13.0</b>: the page for managers: At a glance, with a verdict and a ring of the pages; each page's first lines and full transcript in its card; and the details last.`;
   - the tests that pin the timeline;
   - `docs/phase-c-handoff.md`'s "Published" line.

   Push, and get CI green.
5. Run `./publish.sh --dry-run minor`. Then run `npm whoami`; if it fails, the owner logs in.
6. The owner gives a fresh 2FA code. Run `npm version minor --no-git-tag-version && npm publish --access public --ignore-scripts --otp <code>`.
7. Commit "Release v0.13.0", tag `v0.13.0` (annotated), and push with the tag.
8. Wait until the 0.13.0 tarball answers 200 and 10 minutes have passed since the publish.
9. In the transcripts repo, set `netlify.toml`'s command to `@0.13`, commit, and push (the owner's standing OK).
10. **Share sfs and i2i v3 again**, with no new runs:
    1. From the transcripts home, run `npx --yes @icjia/voicecap@0.13.0 share --site <address> --out .` for `https://sfs.icjia.illinois.gov` and `https://v3--i2i.netlify.app`.
    2. Check that no file names the account or a local path, the Word copies' XML included, and that `verify` finds everything matching.
    3. Commit, and push.
11. **The live check:**
    - each card's verdict;
    - each new report opens on At a glance;
    - the live files' fingerprints match the shares'.

    Send the owner the links.
12. Update the handoff and the memories. Next is plan 8, the review replay, as 0.14.0: merge main into `plan-8-review-replay`, then write its plan.
