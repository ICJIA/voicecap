# The Shareable Report, Plan 3 of 6: The Word Copy and Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every site folder gets `share/current.docx` beside `share/current.html`, and `voicecap share` writes a dated copy of both to send, records it in a sealed `share/shares.json`, and `voicecap verify` checks what was sent.

**Architecture:**
- **One place for the words.** The sentences the page says move out of its renderers: fixed ones into `src/share/text.ts`, computed ones into `src/share/words.ts`, as lines with no markup. Both copies say them from there, so they can't disagree.
- **The Word copy is an outline first.** Section builders in `src/share/word/` turn the `ShareModel` into plain blocks (headings, paragraphs, lists, tables, fixed-width text). They're pure, and tested as data.
- **One file touches the library.** `src/share/docx.ts` turns an outline into a `.docx` with `docx`: US Letter, Word's own heading styles, header rows that repeat, the title, author, and language.
- **Sharing.** `writeShareFiles` writes `current.html` and `current.docx` wherever `report.html` is written. `shareReport` writes the dated pair, never over a file, and appends a sealed, chained entry to `shares.json`. `verifyHome` checks that record and every file it lists.

**Tech Stack:** TypeScript (strict, ESM), Node.js 22.19+, Vitest. New: `docx` 9.8.1 (MIT), pinned exactly. New for tests only: `jszip` 3.10.1, to open a `.docx`; its XML is read with `fast-xml-parser`, already a dependency.

**Spec:** `docs/superpowers/specs/2026-09-30-shareable-report-design.md`: "Files, names, and the record of what was sent", "The Word copy", and what the other sections say of the Word copy and of `voicecap share` ("The page, top to bottom", "What changed since the last run", "What's open at first, and what's folded", "Checking the fingerprints in the page", "Fixed text", "How it's built", "Tests").

**Starts from:** plan 2's "After execution" (`docs/superpowers/plans/2026-09-30-0.6.0-plan-2-the-page.md`), which carried three items here: the renderers' fixed sentences into `text.ts`; the Word copy's card 5; and `verify`'s checks, replacing Ruling 43's skip.

## Where the six plans stand

1. **Run records:** released in 0.6.0.
2. **The page:** released in 0.6.0.
3. **The Word copy and sharing (this plan).** It ships in a later release, when the owner says. Nothing here publishes.
4. **The walkthrough file.**
5. **The website.** It reads `shares.json`, which this plan defines.
6. **Stage 2, at the PC:** the event log, screenshots, and NVDA's own log. Until then their places say "Not recorded", in the Word copy as on the page.

## What the owner decided after the spec

The spec is binding except where the owner has since decided otherwise:

- **"Heard", not "listened"** (2026-10-02). During a run NVDA speaks too fast to follow, so the person running voicecap hears it at work and reads the transcripts. Every sentence either copy says uses the words 0.6.0 shipped: "heard NVDA speaking", "Heard live by <name>", "Whether NVDA was heard". Where the spec says "listened" or "the listener's statement", this plan follows the code. The phrases "listen-through" and "worth a closer listen" stay.
- **Never say how voicecap started by naming a library** (2026-10-02). Managers and auditors read both copies. Neither names Guidepup in "How voicecap came to be".
- **0.6.0 is released** (2026-10-02) with plans 1 and 2. This plan's CHANGELOG entries go under `[Unreleased]`.

## Decisions this plan makes beyond the spec

Each is small, and each is the owner's to change at review:

1. **`voicecap share` takes `--reviewer <name>`.** The spec's record keeps "who made it", and its command line has no way to say. A share is never recorded without a name, as a review isn't.
2. **`voicecap share` refuses when no run counts** (only replayed, interrupted, or unsealed runs). A dated, recorded copy of "no results yet" has no use.
3. **`voicecap verify` names a file in `share/` that `shares.json` doesn't record.** A crash between writing the copies and recording them would otherwise leave copies that look sent.
4. **The Word copy's pages are numbered** ("Page 3 of 41", with the site's name and the date). A printed copy needs them to be cited.
5. **"Every page" is one table in the Word copy,** a row for each page, where the page has a card for each. The cards' spoken-line strips have no table: the spec lists the charts that become tables, and the strips aren't among them.
6. **Each transcript is one paragraph** in the fixed-width font, with a line break after each line. A paragraph for each line made a large site's copy take half a minute to write (measured below).
7. **Characters XML forbids are shown as "�" (U+FFFD) in the Word copy.** `docx` writes them into the file as they are (measured below), which leaves XML that no XML reader accepts, Word's included. The page and the recorded files keep them as they are.
8. **`current.docx` open in Word:** Windows won't let voicecap replace it. voicecap waits 1 second, not 10, then says so plainly and goes on.
9. **Card 5 is reworded** so it's true in both copies (carried from plan 2).
10. **The files:** the outline's builders are in `src/share/word/`, as the page's renderers are in `src/share/html/`. The spec's `src/share/docx.ts` is the one file that uses `docx`.

**Measured on 2026-10-02, with `docx` 9.8.1 on Node 24.19.0, Windows 11:**

| What | Result |
| --- | --- |
| US Letter, heading styles, repeating header rows, links, the title and author, `en-US` | All written as Word expects (`w:pgSz w:w="12240" w:h="15840"`, `w:pStyle w:val="Heading1"`, `w:tblHeader`, `w:lang w:val="en-US"`, `dc:title`, `dc:creator`). |
| 150 pages, 3 transcripts each, 120 lines each: a paragraph for each line | 3.6 s, 469 MB. At 400 pages of 150 lines: 32 s, 1.1 GB. |
| The same, one paragraph for each transcript | 0.3 s, 330 MB. At 400 pages: 1 s, 762 MB. |
| A table of 2,400 rows, three times | 0.3 s. |
| `"\u0000"`, `"\u0001"`, `"\u000B"`, `"\u001B"`, `"\uFFFE"` in a text run | Written into `document.xml` as they are, which isn't XML. |
| Two builds of one document | Different bytes (the links' ids are random, and the file keeps when it was made). Tests never compare a `.docx` by its bytes. |

## Global Constraints

- **Toolchain:** Node.js 22.19 or later; TypeScript strict; ESM; pnpm. `pnpm lint` (ESLint, then Prettier), `pnpm typecheck`, and `pnpm test` all pass before each commit.
- **Dependencies:** `docx` is `"9.8.1"` in `dependencies`, with no `^`, as the Guidepup packages are pinned. `jszip` is `"3.10.1"` in `devDependencies`. No other new package.
- **Only `src/share/docx.ts` imports `docx`,** and it loads it when a Word copy is made (`await import("docx")`), so no other command pays for loading it.
- **The page (`current.html` and its dated copies):**
  - stays one self-contained file: exactly one `<style>` element, no `style="…"` attribute, and nothing loaded from outside;
  - links only to `https://github.com/ICJIA/voicecap`, `https://github.com/ICJIA/voicecap/issues`, `https://www.nvaccess.org/`, and the Deque study;
  - passes axe with zero violations, as today. Its tests stay as they are, except where a task says a sentence changes.
- **The Word copy:**
  - has the page's sections, in the page's order, with the page's numbers, from the same `ShareModel`;
  - folds nothing: every section is there in full;
  - is US Letter (12240 × 15840 twentieths of a point), with 1-inch margins, black on white;
  - uses Word's own styles: `Title` for the site's name, `Heading 1` for a section, `Heading 2` and `Heading 3` inside one, in order, never skipping a level;
  - gives every table a header row that repeats across pages, with no empty header cell and no merged cell (Word's accessibility checker flags both);
  - has no image yet (screenshots come with plan 6, each with alt text);
  - links only to the page's four addresses;
  - says no status by color: every status is in words.
- **Honesty** (the spec's rules, binding on every sentence either copy says):
  - voicecap is a person's review with a real screen reader, sped up. Never "automated testing" or an "automated checker".
  - A copy says a person heard NVDA, reviewed, or fixed something only where the records say so, and never leads with what a person hasn't done.
  - Coverage is claimed for the list ("every page on the list").
  - Every page in scope appears. Failures appear with their reasons and records.
  - Every number is computed from the records.
  - Where a run predates a kind of evidence, the copy says "Not recorded: this run used voicecap <version>", never a blank that looks like a pass.
  - No claim of conformance (such as "meets WCAG").
- **The home folder** is already replaced in everything the model holds for showing. The Word copy shows only what the model gives it, and its document properties hold only the title, the preparer's name, and "Made with voicecap".
- **What was sent is never changed.** voicecap never overwrites or deletes a dated copy, and never rewrites an entry of `shares.json`.
- **Copy:** curly quotes for quoted speech (“click here”); dates as "30 September 2026"; times as 24-hour local "13:15"; counts as digits. Plain words, short sentences.
- **The timeline lives in `src/share/text.ts`.** When this plan's feature lands, its line goes there in the same change (Task 13).
- **Never start a real screen reader,** in tests or while building: no run without `--replay-from` or a scripted driver; no `setup`, `doctor`, `preflight`, `demo`, `init`, `test:nvda`, or `fixture:capture`; never pass a composed command through `cmd /c` or any shell.
- **Commit messages:** one subject line, and no trailers of any kind.

## Review Focus

1. **`current.docx` is open in Word when voicecap rewrites it** (a review, a run ending, `voicecap report`). Windows refuses the replace. The run or review still succeeds, within about a second, the page is still written, and one plain warning says to close the file and run `voicecap report`. Task 9 adds the test.
2. **A transcript line, a note, or an error message with a character XML forbids** (a null, an escape, U+FFFE). The Word copy still opens: its XML parses, and the character shows as "�". Task 4 adds the test.
3. **A large site** (150 pages, long transcripts). The Word copy has one paragraph for each transcript, however many lines it has. Tasks 4 and 6 add the tests.
4. **Sharing twice in a day, or after someone deleted a sent copy.** The new copies never take a name any entry of `shares.json` records, on disk or not, and never overwrite a file. Task 11 adds the tests.
5. **A damaged or hand-edited `shares.json`.** `voicecap share` refuses to write and says why; `voicecap verify` names the entry that changed, the entry that's missing, and the file that no longer matches. Tasks 10 and 12 add the tests.

---

### Task 1: One place for the words of the page's first half

The page's renderers hold the sentences they say as string literals and small functions. The Word copy must say the same ones. This task moves those of the top, the summary, "How voicecap works", "Every page", "What the flags found", and the appendix, and changes nothing a reader sees.

**Files:**
- Create: `src/share/line.ts`, `src/share/words.ts`, `scripts/share-fixture.ts`
- Modify: `src/share/text.ts`, `src/share/html/parts.ts`, `src/share/html/top.ts`, `src/share/html/pages.ts`, `package.json` (a `share:fixture` script)
- Test: `test/share-line.test.ts`, `test/share-words.test.ts`

**Interfaces:**
- Consumes: `ShareModel`, `PageCard`, `AppendixFile`, `Summary` as they are.
- Produces:
  - `src/share/line.ts`:
    ```ts
    /** A piece of a line: plain words, or words in bold, in the fixed-width font, or linked out. */
    export type Inline = string | { text: string; bold?: true; mono?: true; href?: string };
    /** A line of the report, as both copies say it: no markup, and nothing escaped. */
    export type Line = Inline[];
    /** The line's words alone. */
    export function lineText(line: Line): string;
    /** Fixed markup of `<b>` and `<code>` only, as the timeline's cells have it, as a line. */
    export function lineOfMarkup(markup: string): Line;
    /** A sentence with its first sentence in bold: it ends at ".", "!", or "?" before a space or the end. */
    export function firstSentenceBold(text: string): Line;
    ```
  - `src/share/html/parts.ts`: `export function lineHtml(line: Line): string` (every word escaped; bold as `<b>`, fixed-width as `<code>`, a link as `<a href>`, the link outermost). `verdictLine(text)` becomes `lineHtml(firstSentenceBold(text))` in its paragraph.
  - `src/share/text.ts`: one exported object for each section's fixed words: `TOP_TEXT`, `SUMMARY_TEXT`, `HOW_TEXT`, `PAGES_TEXT`, `FLAGS_TEXT`, `APPENDIX_TEXT`, and `PASS_TITLE` and `PASS_WORDS` (`Record<PassName, string>`). Later tasks read their keys from the file.
  - `src/share/words.ts`, each pure:

    | Function | From | Gives |
    | --- | --- | --- |
    | `topLead(header: ShareModel["header"]): Line` | `renderTop`'s lead | The two sentences under the headline, with NVDA linked. |
    | `numbersOf(model: ShareModel): NumberTile[]` | `tiles` | The six numbers, in order. |
    | `spokenDuration(ms: number): string` | `duration`'s spoken form | "12 minutes 34 seconds". |
    | `shareOf(part: number, whole: number): string` | new | "43%", rounded to a whole number; "nothing to count" when `whole` is 0. |
    | `resultsCaption(results: Summary["bars"]["results"]): string` | `resultsMeter`'s caption | "5 pages without flags, 1 page with flags". |
    | `howLead(): Line` | `lead` | `HOW_LEAD`, its bold words bold. |
    | `heardTitle(sample: NonNullable<ShareModel["heard"]>): string` | `heard`'s heading | "Heard on this site: /, three ways". |
    | `pagesGist(model): Line`, `flagsGist(model): Line`, `appendixGist(model): Line` | `html/pages.ts` | Each section's opening line, its headline bold. |
    | `took(ms: number): string` | `html/pages.ts` | "55.1 s", "1 min 2 s". |
    | `titleOf(card: PageCard): string \| null` | `titleLine` | "Title: Home". |
    | `fromRun(card: PageCard): string \| null` | `fromLine` | "From run 2026-09-29_1315, on 29 September". |
    | `manualLine(session: PageCard["manual"][number]): string` | `cardOf` | "Manual NVDA session, 29 September, by Pat Lee". |
    | `originOf(card: PageCard \| undefined, latest: string \| null): Line \| null` | `html/pages.ts` | "From run <id>", the id fixed-width. |
    | `transcriptsInside(passes: PassName[]): string` | `appendixPage` | "read, headings, and Tab transcripts". |
    | `fileFingerprint(file: AppendixFile): Line` | `transcriptOf` | "The whole file, its header included: 4,210 bytes, SHA-256 <sha>". |

    ```ts
    export interface NumberTile {
      tone: "ok" | "warn" | "quiet";
      value: { count: number } | { part: number; whole: number } | { ms: number };
      /** What follows the number: "pages in scope", "transcribed by NVDA". */
      label: string;
    }
    ```
  - `scripts/share-fixture.ts`: `pnpm share:fixture <folder>` writes `<folder>/demo.html`, the page of the demo fixture (`demoModel()` in `test/helpers/share-model.ts`) with no fonts (`fontCss: ""`), and prints its path. Task 8 adds `demo.docx`.

**What moves, and what stays.** A sentence, label, table heading, or empty-state line that a reader of the Word copy will also read moves. Markup, ids, `aria-label`s, words for screen readers only (`class="sr"`), the buttons, the fold lines, and the charts' captions stay in the renderer.

- [ ] **Step 1: Write the script, and save the page as it is now**

Write `scripts/share-fixture.ts` and the `share:fixture` script. Then, before changing any other file (`SCRATCH` is any folder outside the repository):

```bash
pnpm share:fixture "$SCRATCH/before"
```

Expected: `demo.html`, about 208,000 bytes.

- [ ] **Step 2: Write the failing tests**

`test/share-line.test.ts`:

```ts
it("gives a line's words, and its HTML with every word escaped", () => {
  const line: Line = [{ text: "7 pages <all>.", bold: true }, " See ", { text: "a&b", mono: true }, " at ", { text: "NVDA", href: "https://www.nvaccess.org/" }];
  expect(lineText(line)).toBe("7 pages <all>. See a&b at NVDA");
  expect(lineHtml(line)).toBe('<b>7 pages &lt;all&gt;.</b> See <code>a&amp;b</code> at <a href="https://www.nvaccess.org/">NVDA</a>');
});
it("reads the timeline's markup as a line", () => {
  expect(lineOfMarkup("<b>0.6.0</b>: the page, and <code>voicecap preflight</code>.")).toEqual([
    { text: "0.6.0", bold: true }, ": the page, and ", { text: "voicecap preflight", mono: true }, ".",
  ]);
});
it("sets a first sentence in bold, and never ends it at a version number", () => {
  expect(firstSentenceBold("2 problems, in 0.4.1 records. Neither came back.")).toEqual([
    { text: "2 problems, in 0.4.1 records.", bold: true }, " Neither came back.",
  ]);
});
```

`test/share-words.test.ts`, on `await demoModel()`:

```ts
expect(lineText(pagesGist(model))).toBe(textOf(/<p class="gist">(.*?)<\/p>/s.exec(renderPages(model))![1]!));
expect(numbersOf(model).map(({ label }) => label)).toEqual([
  "pages in scope", "transcribed by NVDA", expect.stringMatching(/^pages? with flags/), "heard live by a person", "lines NVDA spoke", expect.stringMatching(/^of NVDA time, across 2 runs/),
]);
expect(spokenDuration(754_000)).toBe("12 minutes 34 seconds");
expect([shareOf(3, 7), shareOf(0, 0)]).toEqual(["43%", "nothing to count"]);
```

- [ ] **Step 3: Run them, and see them fail**

Run: `pnpm exec vitest run test/share-line.test.ts test/share-words.test.ts`
Expected: FAIL, the modules don't exist.

- [ ] **Step 4: Move the words**

Create `line.ts` and `words.ts`, add the objects to `text.ts`, and have `html/top.ts` and `html/pages.ts` say every moved sentence from them, through `lineHtml` where it's a `Line`.

- [ ] **Step 5: Check that nothing a reader sees changed**

```bash
pnpm share:fixture "$SCRATCH/after" && cmp "$SCRATCH/before/demo.html" "$SCRATCH/after/demo.html"
pnpm test
```

Expected: `cmp` prints nothing. Every test passes, and no expected string in `test/share-html-*.test.ts`, `test/share-document.test.ts`, or `test/share-browser.test.ts` was edited.

- [ ] **Step 6: Commit**

```bash
git add src/share scripts/share-fixture.ts package.json test/share-line.test.ts test/share-words.test.ts
git commit -m "Keep the words of the page's first half in one place, for both copies"
```

### Task 2: One place for the words of the page's second half

The same move for "What changed since the last run", "Problems during the runs", "What these results cover", the evidence, the story, and the footer. Nothing a reader sees changes.

**Files:**
- Modify: `src/share/text.ts`, `src/share/words.ts`, `src/share/html/changes.ts`, `src/share/html/problems.ts`, `src/share/html/evidence.ts`
- Test: `test/share-words.test.ts`

**Interfaces:**
- Consumes: Task 1's `Line`, `lineHtml`, `firstSentenceBold`, and `words.ts`.
- Produces:
  - `src/share/text.ts`: `CHANGES_TEXT` (with the reasons a page is in only one run), `PROBLEMS_TEXT` (the questions' labels, the section's gist, the words for "did it happen again", the table headings, and the request to report an unexpected error), `COVERAGE_TEXT`, `EVIDENCE_TEXT` (what a fingerprint is, what the check proves, the parts' titles, the table headings, the runs left out), `STORY_TEXT` (the fold lines, the timeline's caption and headings), `FOOTER_TEXT`, and `ISSUES_URL`.
  - `src/share/words.ts`, each pure:

    | Function | From | Gives |
    | --- | --- | --- |
    | `sizesOf(removed: number, added: number): string` | `html/changes.ts` | "3 lines removed and 2 added". |
    | `countsOf(page: PageChange): string` | `html/changes.ts` | "read: 3 lines removed and 2 added; Tab: 1 line removed". |
    | `changesGist(changes: Changes): Line \| null` | `gistOf` | "Compared: run <id> (before) and run <id> (latest). …" |
    | `onlyInOneLead(pages: OnlyInOnePage[]): Line` | `onlyInOneNote` | "2 pages were read in full in only one of the two runs, so they weren't compared:" |
    | `changedRules(flags: PageChange["flags"]): { resolved: string[]; fresh: string[] }` | `flagChips` | The rules a page's chips name as resolved, and as new. |
    | `flagsLine(flags: PageChange["flags"]): Line \| null` | `flagsParagraph` | "Flags: **generic-link-text** (read pass), 3 before, none now (resolved). …" |
    | `sentence(text: string): string`, `timeOfDay(iso: string): string` | `html/problems.ts` | As they are. |
    | `decidedFrom(kind: ProblemKind): string` | `html/problems.ts` | How an older run's kind was decided. |
    | `whereOf(problem: Problem, nth: number): string` | `html/problems.ts` | "on /about/ in run 2026-09-29_1402, attempt 2". |
    | `evidenceGist(model: ShareModel): Line` | `html/evidence.ts` | "2 runs, both completed and sealed. …" |
    | `unreadableNote(model: ShareModel): Line \| null` | `html/evidence.ts` | The transcripts the check leaves out. |
    | `whenOf(run: RunJson): string` | `html/evidence.ts` | "29 September 2026, 14:02 to 14:09". |
    | `generatedLine(footer: ShareModel["footer"]): string` | `renderFooter` | "Generated on … at … (UTC−05:00). Times are as each run recorded them (…)." |
    | `timelineDay(date: string, lastYear: string \| null): string` | `timelineHeader` | "25 September 2026", then "26 September". |

- [ ] **Step 1: Save the page as it is now**

```bash
pnpm share:fixture "$SCRATCH/before"
```

- [ ] **Step 2: Write the failing tests**

In `test/share-words.test.ts`:

```ts
expect(sizesOf(3, 2)).toBe("3 lines removed and 2 added");
expect(sizesOf(0, 2)).toBe("2 lines added");
expect(lineText(evidenceGist(model))).toMatch(/^2 runs, both completed and sealed\. The flags were computed with the current flag rules, fingerprint [0-9a-f]{64}\.$/);
expect(whenOf(demoRun("1402"))).toBe("29 September 2026, 14:02 to 14:09");
expect(timelineDay("2026-09-26", "2026")).toBe("26 September");
```

Correct the expected time of run 1402 from its record (`runStart`, `runEnd`) if it differs.

- [ ] **Step 3: Run them, and see them fail**

Run: `pnpm exec vitest run test/share-words.test.ts`
Expected: FAIL, the functions aren't exported.

- [ ] **Step 4: Move the words**

As in Task 1, for the three renderers.

- [ ] **Step 5: Check that nothing a reader sees changed**

```bash
pnpm share:fixture "$SCRATCH/after" && cmp "$SCRATCH/before/demo.html" "$SCRATCH/after/demo.html"
pnpm test
```

Expected: `cmp` prints nothing, and no expected string in the page's tests was edited.

- [ ] **Step 6: Commit**

```bash
git add src/share test/share-words.test.ts
git commit -m "Keep the words of the page's second half in one place, for both copies"
```

### Task 3: What the page now says of its Word copy and of sharing

Three sentences of the page change, on purpose.

**Files:**
- Modify: `src/share/model.ts`, `src/share/load.ts`, `src/share/text.ts`, `src/share/html/evidence.ts`, `test/helpers/share-model.ts`
- Test: `test/share-html-evidence.test.ts`, `test/share-model.test.ts`, `test/share-text.test.ts`

**Interfaces:**
- Produces:
  - `ShareInput.wordName: string` and `ShareModel["footer"].wordName: string`, the Word copy's file name. `loadShareInput` takes `wordName?: string`, default `"current.docx"`, beside `fileName?: string`, default `"current.html"`. `inputOf` (the test helper) defaults it the same way.
  - `FOOTER_TEXT.page(fileName, wordName)` gives `This file: current.html. Its Word copy: current.docx.` and `FOOTER_TEXT.word(fileName, wordName)` gives `This file: current.docx. Its web page: current.html.`

**The three sentences:**

1. **The footer** names both files. Each name is in the fixed-width font: `This file: <span class="mono">current.html</span>. Its Word copy: <span class="mono">current.docx</span>.`
2. **What the check proves** (`EVIDENCE_TEXT`) says where the sender's fingerprint comes from:

   > **What the check proves:** this page is consistent with itself, so the transcripts shown are exactly the ones the sealed records list. It can't prove the page itself wasn't changed, since whoever changed it could change the fingerprints too. For that, compare this file's own fingerprint with the one its sender recorded: `voicecap share` prints it, ready for the email that sends the file, and `Get-FileHash <file>` in PowerShell, or `shasum -a 256 <file>` on a Mac, shows it for the file you received. Or run `<the verify command>` on the transcripts folder.

3. **Card 5** of `WORTH_KNOWING` is true in both copies:

   > voicecap checks the design of this report's web page with axe in its own tests, with no violations: the automated checker and the listen-through, side by side.

- [ ] **Step 1: Write the failing tests.** Change the expected footer, check sentence, and card 5 in the three test files to the text above, and add to `test/share-model.test.ts`:

```ts
expect(buildShareModel(inputOf([run], { fileName: "x_2026-09-30.html", wordName: "x_2026-09-30.docx" })).footer)
  .toMatchObject({ fileName: "x_2026-09-30.html", wordName: "x_2026-09-30.docx" });
```

- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/share-html-evidence.test.ts test/share-model.test.ts test/share-text.test.ts`. Expected: FAIL on the old sentences, and on `wordName`.
- [ ] **Step 3: Make the changes** in the model, the loader, `text.ts`, and `renderFooter`.
- [ ] **Step 4: Run `pnpm test`.** Expected: PASS, the page's axe and browser tests included.
- [ ] **Step 5: Commit**

```bash
git add src/share test/helpers/share-model.ts test/share-html-evidence.test.ts test/share-model.test.ts test/share-text.test.ts
git commit -m "Have the page name its Word copy, and say where the sender's fingerprint comes from"
```

### Task 4: The outline's blocks, and the .docx they make

**Files:**
- Create: `src/share/word/blocks.ts`, `src/share/docx.ts`, `test/helpers/docx.ts`
- Modify: `package.json`, `pnpm-lock.yaml`
- Test: `test/share-docx.test.ts`

**Interfaces:**
- Consumes: `Line`, `Inline` (Task 1).
- Produces:
  - `src/share/word/blocks.ts`:
    ```ts
    /** A table cell: its lines, each a paragraph of its own; `mono` sets them in the fixed-width font. */
    export interface Cell { lines: Line[]; mono?: true }
    export type Block =
      | { kind: "title"; text: string }
      | { kind: "heading"; level: 1 | 2 | 3; text: string }
      | { kind: "para"; line: Line }
      | { kind: "list"; items: Line[] }
      | { kind: "table"; head: string[]; rows: Cell[][]; widths?: number[] }
      /** Lines in the fixed-width font, as one paragraph with a line break after each. */
      | { kind: "mono"; lines: string[] }
      | { kind: "pageBreak" };
    export function title(text: string): Block;
    export function heading(level: 1 | 2 | 3, text: string): Block;
    export function para(...line: Inline[]): Block;
    export function list(items: (Line | string)[]): Block;
    /** `widths` are each column's share of the text width, and add up to 100; equal without them. */
    export function table(head: string[], rows: (Cell | Line | string)[][], widths?: number[]): Block;
    export function cell(...lines: (Line | string)[]): Cell;
    export function monoCell(...lines: string[]): Cell;
    export function mono(lines: string[]): Block;
    export const PAGE_BREAK: Block;
    /** Every word of some blocks: a string for each title, heading, paragraph, list item, table row (its cells joined by " | ", a cell's lines by " / "), and fixed-width line. */
    export function wordsOf(blocks: Block[]): string[];
    ```
  - `src/share/docx.ts`:
    ```ts
    export interface WordProperties {
      /** The document's title. */
      title: string;
      /** Its author: the preparer, or "voicecap" when the records name no one. */
      author: string;
      /** What each page's footer says before "Page 3 of 41". */
      footer: string;
    }
    /** The blocks as a .docx. Loads `docx` when called. */
    export function docxOf(blocks: Block[], properties: WordProperties): Promise<Uint8Array>;
    ```
  - `test/helpers/docx.ts`:
    ```ts
    export interface DocxParts { document: string; styles: string; core: string; footer: string; rels: string }
    export function unzipDocx(bytes: Uint8Array): Promise<DocxParts>;
    /** The body's paragraphs outside tables, in order: its style ("" for none) and its words, a line break as "\n". */
    export function paragraphsOf(documentXml: string): { style: string; text: string }[];
    /** Each table: whether its first row repeats as a header, and each row's cells' words (a cell's paragraphs joined by "\n"). */
    export function tablesOf(documentXml: string): { header: boolean; rows: string[][] }[];
    /** Each address the document links out to, once, in order. */
    export function linksOf(parts: DocxParts): string[];
    ```

**How the document looks.** Body text is Calibri 11 pt; a table's text 10 pt; fixed-width text is Consolas 9 pt, in a paragraph style named `Mono`. A header row is bold on a light gray fill, and repeats. A link is blue and underlined. A newline inside a line's words is a line break. The footer of every page is centered, 9 pt: `properties.footer`, then ". Page ", the page number, " of ", and the number of pages. The properties are the title, the author (also as last modified by), and the description "Made with voicecap".

- [ ] **Step 1: Add the two packages**

```bash
pnpm add --save-exact docx@9.8.1 && pnpm add --save-dev --save-exact jszip@3.10.1
```

Expected: `"docx": "9.8.1"` in `dependencies`, and `"jszip": "3.10.1"` in `devDependencies`.

- [ ] **Step 2: Write the failing tests**

`test/share-docx.test.ts`:

```ts
const PROPERTIES = { title: "Demo: how its pages read aloud with NVDA", author: "Pat Lee", footer: "Demo, as of 30 September 2026" };
const BLOCKS = [
  title("Demo"), heading(1, "Summary"),
  para({ text: "Bold.", bold: true }, " Then ", { text: "code", mono: true }, ", and ", { text: "a link", href: "https://github.com/ICJIA/voicecap" }, "."),
  list(["one", "two"]),
  table(["Rule", "NVDA said"], [["generic-link-text", cell("“click here”", "“read more”")]]),
  mono(["line 1", "line 2", "line 3"]), PAGE_BREAK, heading(2, "Next"), heading(3, "Inside"),
];

it("is US Letter, in Word's own styles, with a header row that repeats", async () => {
  const parts = await unzipDocx(await docxOf(BLOCKS, PROPERTIES));
  expect(parts.document).toContain('<w:pgSz w:w="12240" w:h="15840"');
  expect(paragraphsOf(parts.document).filter(({ style }) => /^(Title|Heading\d)$/.test(style))).toEqual([
    { style: "Title", text: "Demo" }, { style: "Heading1", text: "Summary" },
    { style: "Heading2", text: "Next" }, { style: "Heading3", text: "Inside" },
  ]);
  expect(tablesOf(parts.document)).toEqual([
    { header: true, rows: [["Rule", "NVDA said"], ["generic-link-text", "“click here”\n“read more”"]] },
  ]);
  expect(linksOf(parts)).toEqual(["https://github.com/ICJIA/voicecap"]);
});
it("sets the title, the author, and the language", async () => {
  const { core, styles } = await unzipDocx(await docxOf(BLOCKS, PROPERTIES));
  expect(core).toContain("<dc:title>Demo: how its pages read aloud with NVDA</dc:title>");
  expect(core).toContain("<dc:creator>Pat Lee</dc:creator>");
  expect(core).toContain("<cp:lastModifiedBy>Pat Lee</cp:lastModifiedBy>");
  expect(styles).toContain('<w:lang w:val="en-US"');
});
it("numbers its pages in the footer", async () => {
  const { footer } = await unzipDocx(await docxOf(BLOCKS, PROPERTIES));
  expect(footer).toContain("Demo, as of 30 September 2026");
  expect(footer).toMatch(/PAGE<\/w:instrText>[\s\S]*NUMPAGES<\/w:instrText>/);
});
// Review Focus 3: a transcript is one paragraph, however many lines it has.
it("writes fixed-width lines as one paragraph, a line break after each", async () => {
  const { document } = await unzipDocx(await docxOf([mono(["line 1", "line 2", "line 3"])], PROPERTIES));
  expect(paragraphsOf(document)).toEqual([{ style: "Mono", text: "line 1\nline 2\nline 3" }]);
});
// Review Focus 2: characters XML forbids.
it("shows a character XML forbids as U+FFFD, so the file still opens", async () => {
  const odd = [para("a\u0000b\u0001c\u000Bd\uFFFEe"), mono(["x\u001By"]), table(["H"], [["z\u0008"]])];
  const { document } = await unzipDocx(await docxOf(odd, PROPERTIES));
  expect(XMLValidator.validate(document)).toBe(true);
  expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(document)).toBe(false);
  expect(paragraphsOf(document)[0]?.text).toBe("a\uFFFDb\uFFFDc\uFFFDd\uFFFDe");
});
it("has no image, so none lacks alt text", async () => {
  expect((await unzipDocx(await docxOf(BLOCKS, PROPERTIES))).document).not.toContain("<w:drawing");
});
```

And for `wordsOf`: `expect(wordsOf(BLOCKS)).toEqual(["Demo", "Summary", "Bold. Then code, and a link.", "one", "two", "Rule | NVDA said", "generic-link-text | “click here” / “read more”", "line 1", "line 2", "line 3", "Next", "Inside"])`.

- [ ] **Step 3: Run them, and see them fail.** Run: `pnpm exec vitest run test/share-docx.test.ts`. Expected: FAIL, the modules don't exist.
- [ ] **Step 4: Write `blocks.ts`, `docx.ts`, and the test helper.** The characters XML 1.0 allows are tab, newline, carriage return, U+0020 to U+D7FF, U+E000 to U+FFFD, and U+10000 to U+10FFFF; every other one, a lone surrogate included, becomes U+FFFD, in every word the document holds.
- [ ] **Step 5: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/share/word/blocks.ts src/share/docx.ts test/helpers/docx.ts test/share-docx.test.ts
git commit -m "Add the Word copy's blocks, and the .docx they make"
```

### Task 5: The Word copy's top, summary, and "How voicecap works"

**Files:**
- Create: `src/share/word/top.ts`
- Test: `test/share-word-top.test.ts`

**Interfaces:**
- Consumes: the blocks (Task 4); `topLead`, `numbersOf`, `spokenDuration`, `shareOf`, `howLead`, `heardTitle`, and `TOP_TEXT`, `SUMMARY_TEXT`, `HOW_TEXT` (Task 1); `HOW_STEPS`, `WHEN_TO_RUN`.
- Produces: `wordTop(model: ShareModel): Block[]`, `wordSummary(model: ShareModel): Block[]`, `wordHow(model: ShareModel): Block[]`.

**The layout:**

- **The top:** the site's name as the title; "Screen reader test results" in bold; `topLead`; then one line: "As of **30 September 2026**. Prepared by **Pat Lee**. Made with voicecap. Site address http://127.0.0.1:4848." ("voicecap" links to GitHub; "Prepared by" only when the records name someone.)
- **Summary** (heading 1): the sentence in bold, then the second line. With no run that counts, that's all, as on the page. Otherwise:
  - a table, "Number" and "What it counts", a row for each of `numbersOf`: a count as "7", a count out of its total as "7 of 7", a time as `spokenDuration` gives it;
  - "What needs attention" (heading 2): a paragraph for each page, its name in bold, then ": " and its clauses and a full stop; or the line that says no page has flags or an open issue;
  - "How complete the test was" (heading 2): a list of the model's lines, then the line about the run before, when there is one;
  - "What's still to do" (heading 2): a list;
  - "When and how" (heading 2): a list, each label in bold;
  - "Every page's latest result" (heading 2): a table of "Result", "Pages", "Share": without flags, with flags, never transcribed, each a row, zeros too;
  - "Flags by rule" (heading 2): a table of "Rule", "Times raised", "Share of all flags raised"; or "No flags were raised.";
  - "The human review" (heading 2): a table of "What", "Count", "Out of", "Share": heard live, transcripts reviewed, issues fixed;
  - a page break, so the summary has the first page to itself.
- **How voicecap works** (heading 1): `howLead`; a table of "No.", "Step", "What it means", a row for each of the six steps, its title in bold; the sample, under `heardTitle` (heading 2), as a table with a column for each pass ("Down Arrow, line by line"; "H, heading by heading"; "Tab, control by control") and a row for each line, each cell “the line” then its time in brackets; the sample's caption; or, with no sample, the line that says none is available. Then `WHEN_TO_RUN.headline` (heading 2), its line, and a table with the four stages' titles as its headings and their texts as its one row, the marked stage's text in bold.

- [ ] **Step 1: Write the failing tests**

`test/share-word-top.test.ts`, on `await demoModel()`:

```ts
const words = (blocks: Block[]) => wordsOf(blocks);
it("leads with the site's name, and what the page is", () => {
  const top = wordTop(model);
  expect(top[0]).toEqual({ kind: "title", text: model.header.siteName });
  expect(words(top)).toContain(lineText(topLead(model.header)));
});
it("gives the summary's numbers as a table, each as the model has it", () => {
  const { numbers } = model.summary;
  const rows = words(wordSummary(model));
  expect(rows).toContain("Number | What it counts");
  expect(rows).toContain(`${numbers.pagesInScope} | pages in scope`);
  expect(rows).toContain(`${numbers.transcribed} of ${numbers.pagesInScope} | transcribed by NVDA`);
  expect(rows).toContain(`${numbers.listened} of ${numbers.transcribed} | heard live by a person`);
});
it("turns the three bars into tables, with counts and shares", () => {
  const rows = words(wordSummary(model));
  const { done, flagged, never } = model.summary.bars.results;
  const total = done + flagged + never;
  expect(rows).toContain("Result | Pages | Share");
  expect(rows).toContain(`Without flags | ${done} | ${shareOf(done, total)}`);
  expect(rows).toContain("What | Count | Out of | Share");
});
it("ends the summary with a page break, and says the model's sentence first", () => {
  const summary = wordSummary(model);
  expect(summary.at(-1)).toEqual(PAGE_BREAK);
  expect(summary.slice(0, 2)).toEqual([heading(1, "Summary"), para({ text: model.summary.sentence, bold: true })]);
});
it("says only its sentences when no run counts", () => {
  const none = buildShareModel(inputOf([shareRun({ replayed: true })]));
  expect(wordSummary(none).map(({ kind }) => kind)).toEqual(["heading", "para", "para"]);
});
it("has the six steps as a numbered table, and the stages as four columns", () => {
  const how = wordHow(model);
  const tables = how.filter((block) => block.kind === "table");
  expect(tables[0]).toMatchObject({ head: ["No.", "Step", "What it means"] });
  expect(words([tables[0]!]).slice(1)).toEqual(HOW_STEPS.map((step, index) => `${index + 1} | ${step.title} | ${step.text}`));
  expect(tables.at(-1)).toMatchObject({ head: WHEN_TO_RUN.stages.map((stage) => stage.title) });
});
```

Use the helper `shareRun` with whatever option makes a replayed run in `test/helpers/share-data.ts`.

- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/share-word-top.test.ts`. Expected: FAIL, the module doesn't exist.
- [ ] **Step 3: Write `src/share/word/top.ts`.**
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/share/word/top.ts test/share-word-top.test.ts
git commit -m "Add the Word copy's top, summary, and how voicecap works"
```

### Task 6: The Word copy's pages, flags, and appendix

**Files:**
- Create: `src/share/word/pages.ts`
- Modify: `src/share/text.ts` (`PAGES_TEXT.nothingToFlag`: "Nothing was read to flag")
- Test: `test/share-word-pages.test.ts`

**Interfaces:**
- Consumes: the blocks; `pagesGist`, `flagsGist`, `appendixGist`, `took`, `titleOf`, `fromRun`, `manualLine`, `originOf`, `fileFingerprint`, `PASS_TITLE`, `PAGES_TEXT`, `FLAGS_TEXT`, `APPENDIX_TEXT`.
- Produces: `wordPages(model: ShareModel): Block[]`, `wordFlags(model: ShareModel): Block[]`, `wordAppendix(model: ShareModel): Block[]`.

**The layout:**

- **Every page** (heading 1): `pagesGist`; then one table, a row for each page in order, with the columns:
  - "No.": the page's number;
  - "Page": its name in bold; its path, when it has a label; and `titleOf`;
  - "Result": `statusText`; the failure, when it has one; and `fromRun`;
  - "Flags": "Nothing was read to flag" for a page with no transcripts; "No flags"; or the rules that raised flags, with "Flags as recorded" when they're the run's own;
  - "The person's review": each review chip's words, then each manual session's line. Empty when the records show none: a copy never says what a person hasn't done;
  - "What each pass captured": "Read: 21 lines", "Headings: 4", "Tab stops: 10", and "Time: 55.1 s", as the page's card has them ("Not read" for a pass the run didn't read; the time's "Not recorded" line where there's none). Empty for a page with no transcripts.

  Then "No longer listed" (heading 2), its sentence, and its table, when a page is.
- **What the flags found** (heading 1): `flagsGist`; for each flagged page, its name and how many flags (heading 2), `fromRun`, and a table of "Rule", "What NVDA showed", "NVDA said", each line NVDA said in curly quotes on a line of its own, or "No line to quote".
- **Appendix: every transcript** (heading 1), after a page break: `appendixGist`; for each page, its number and name (heading 2), `originOf`, and "Screenshot:" with the card's "Not recorded" line; then for each pass, "Read transcript of /about/, 21 lines" (heading 3), `fileFingerprint`, and its lines as one fixed-width block (the text split at its line breaks, without a last empty line), or the line that says it has none. A transcript that couldn't be read, and a page with no transcript files, say so as the page does.

- [ ] **Step 1: Write the failing tests**

`test/share-word-pages.test.ts`:

```ts
it("has a row for every page, in order, with its result in words", () => {
  const [pages] = wordPages(model).filter((block) => block.kind === "table");
  expect(pages).toMatchObject({ head: ["No.", "Page", "Result", "Flags", "The person's review", "What each pass captured"] });
  expect(pages!.kind === "table" && pages!.rows.length).toBe(model.pages.length);
  for (const card of model.pages) expect(wordsOf([pages!]).join("\n")).toContain(card.statusText);
});
it("never leaves the flags of a page that wasn't read looking like none", () => {
  const never = buildShareModel(inputOf([shareRun({ pages: [{ path: "/", status: "failed" }] })]));
  expect(wordsOf(wordPages(never)).join("\n")).toContain("Nothing was read to flag");
});
it("quotes what NVDA said for each rule", () => {
  const rows = wordsOf(wordFlags(model));
  expect(rows).toContain("Rule | What NVDA showed | NVDA said");
  for (const { quotes } of model.flagged) for (const { said } of quotes) for (const line of said) expect(rows.join("\n")).toContain(`“${line}”`);
});
// Review Focus 3: one paragraph a transcript, however long.
it("has each transcript as one fixed-width block, with its fingerprint above it", () => {
  const appendix = wordAppendix(model);
  const files = model.appendix.flatMap((entry) => entry.files);
  expect(appendix.filter((block) => block.kind === "mono")).toHaveLength(files.filter((file) => file.lines > 0).length);
  const first = files[0]!;
  expect(appendix).toContainEqual(mono(first.text.replace(/\r?\n$/, "").split(/\r?\n/)));
  expect(wordsOf(appendix)).toContain(lineText(fileFingerprint(first)));
});
it("starts the appendix on a new page", () => {
  expect(wordAppendix(model)[0]).toEqual(PAGE_BREAK);
});
```

- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/share-word-pages.test.ts`. Expected: FAIL, the module doesn't exist.
- [ ] **Step 3: Write `src/share/word/pages.ts`,** and add `PAGES_TEXT.nothingToFlag`.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/share/word/pages.ts src/share/text.ts test/share-word-pages.test.ts
git commit -m "Add the Word copy's pages, flags, and appendix"
```

### Task 7: The Word copy's changes and problems

**Files:**
- Create: `src/share/word/changes.ts`, `src/share/word/problems.ts`
- Test: `test/share-word-changes.test.ts`

**Interfaces:**
- Consumes: the blocks; `firstSentenceBold`, `sizesOf`, `countsOf`, `changesGist`, `onlyInOneLead`, `changedRules`, `flagsLine`, `sentence`, `timeOfDay`, `decidedFrom`, `whereOf`, `CHANGES_TEXT`, `PROBLEMS_TEXT`, `ISSUES_URL`, `PASS_WORDS`; `KIND_ROWS` from `src/share/problems.ts`; `pageTitle`, `pagePath`, `clock` from `src/share/format.ts`.
- Produces: `wordChanges(model: ShareModel): Block[]`, `wordProblems(model: ShareModel): Block[]`.

**The layout:**

- **What changed since the last run** (heading 1). With no run before: the line that says there's none to compare with. Otherwise, in the page's order: the tools that differ, as a list under their bold lead; the note on the passes; the section's line, its first sentence bold; `changesGist`; the pages read in only one run, as a list under `onlyInOneLead`, each name in bold with its reason. Then, for each page that sounds different:
  - its name and `countsOf` (heading 2);
  - one line of the rules its flags resolved and raised: "generic-link-text resolved; unlabeled-control new", when there are any;
  - for each pass, "The read pass on /about/: 3 lines removed and 2 added" (heading 3), and a table of "Change" and "What NVDA said": "Removed" or "Added" with the line, its changed words in bold; "Same" with the line; and, for a run of lines the same, "…" with "12 lines the same";
  - a line for each pass that sounds different but couldn't be read here;
  - `flagsLine`.
- **Problems during the runs** (heading 1): the verdict line, its first sentence bold; the section's gist, when there's a problem. Then, for each problem, oldest first:
  - "Run 2026-09-29_1402 · How a run works" (heading 2);
  - one line: its time ("time not recorded" when it has none), its kind, and whether it happened again, each a sentence;
  - a table of "Question" and "Answer": what happened; how the kind was decided, for an older run's wording; what voicecap did; did it happen again; the effect on the results; and, for an unexpected error, where to report it, the address a link;
  - "The record of this problem, word for word, on /about/ in run …" (heading 3), and a table of "Time", "From", "What was recorded", the record in the fixed-width font;
  - for an unexpected error, "Where in voicecap's code it happened, on …" (heading 3), and its stack as a fixed-width block;
  - each line of what the run didn't record.

  Last, "How voicecap tells causes apart" (heading 2), and the table of kinds, the issues address a link.

- [ ] **Step 1: Write the failing tests**

`test/share-word-changes.test.ts`. Build the models with the helpers in `test/helpers/share-data.ts` and `share-model.ts` (`shareRun`, `inputOf`, `storeOf`), as `test/share-html-changes.test.ts` does:

```ts
it("says there's no run to compare with, when there isn't", () => {
  expect(wordsOf(wordChanges(oneRun))).toEqual(["What changed since the last run", "No earlier run with the same pages to compare with."]);
});
it("shows a changed page's lines as a table, each marked in words", () => {
  const rows = wordsOf(wordChanges(twoRuns));
  expect(rows).toContain("Change | What NVDA said");
  expect(rows).toContain("Removed | link, click here");
  expect(rows).toContain("Added | link, Read the annual report");
  expect(rows.some((row) => /^… \| \d+ lines? the same$/.test(row))).toBe(true);
});
it("sets the changed words in bold, and not the rest", () => {
  const added = diffRows(wordChanges(twoRuns)).find((line) => lineText(line) === "link, Read the annual report")!;
  expect(added[0]).toBe("link, ");
  expect(added.slice(1).every((piece) => typeof piece !== "string" && piece.bold === true)).toBe(true);
});
it("has the demo's two problems, each with its record in the fixed-width font", () => {
  const blocks = wordProblems(demo);
  expect(wordsOf(blocks)).toContain(lineText(firstSentenceBold(demo.problems.line)));
  expect(blocks.filter((b) => b.kind === "heading" && b.level === 2).map((b) => b.kind === "heading" && b.text)).toEqual([
    ...demo.problems.problems.map((p) => `Run ${p.run} · ${pageTitle(p.page)}`), "How voicecap tells causes apart",
  ]);
  const record = blocks.find((b) => b.kind === "table" && b.head[2] === "What was recorded");
  expect(record?.kind === "table" && record.rows[0]![2]).toMatchObject({ mono: true });
});
it("links an unexpected error to where it's reported, and shows its stack", () => {
  const blocks = wordProblems(unexpected);
  expect(JSON.stringify(blocks)).toContain('"href":"https://github.com/ICJIA/voicecap/issues"');
  expect(blocks.some((b) => b.kind === "mono")).toBe(true);
});
```

`twoRuns` is two runs of one page whose read pass differs in one line: “link, click here” before, “link, Read the annual report” after. `diffRows` is a helper in the test file: the lines of the first changes table's second column.

- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/share-word-changes.test.ts`. Expected: FAIL, the modules don't exist.
- [ ] **Step 3: Write `src/share/word/changes.ts` and `src/share/word/problems.ts`.**
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/share/word/changes.ts src/share/word/problems.ts test/share-word-changes.test.ts
git commit -m "Add the Word copy's changes and problems"
```

### Task 8: The Word copy's last sections, and the whole document

**Files:**
- Create: `src/share/word/evidence.ts`, `src/share/word/outline.ts`
- Modify: `src/share/docx.ts` (`renderWordCopy`), `src/share/text.ts` (`EVIDENCE_TEXT.word`), `scripts/share-fixture.ts` (writes `demo.docx` too)
- Test: `test/share-word-evidence.test.ts`, `test/share-word-outline.test.ts`

**Interfaces:**
- Consumes: Tasks 5 to 7's builders; `evidenceGist`, `unreadableNote`, `whenOf`, `generatedLine`, `timelineDay`, `lineOfMarkup`; `COVERAGE_TEXT`, `EVIDENCE_TEXT`, `STORY_TEXT`, `FOOTER_TEXT`, `STORY`, `TIMELINE`, `WORTH_KNOWING`, `ABOUT`.
- Produces:
  - `wordCoverage`, `wordEvidence`, `wordStory`, `wordFooter`: each `(model: ShareModel) => Block[]`.
  - `src/share/word/outline.ts`: `wordOutline(model: ShareModel): Block[]` (the top, the summary, how voicecap works, every page, the flags, the changes, the problems, the coverage, the evidence, the story, the appendix, the footer), and `wordProperties(model: ShareModel): WordProperties`.
  - `src/share/docx.ts`: `renderWordCopy(model: ShareModel): Promise<Uint8Array>`.

**The layout:**

- **What these results cover** (heading 1): "Covered" and "Technical limits" (heading 2), each a list, each only when it has lines.
- **The evidence behind these results** (heading 1). With no run that counts: the line that says so, then the runs left out. Otherwise:
  - `evidenceGist`; what a fingerprint is, its question in bold; `unreadableNote`;
  - what the Word copy has in place of the page's check (`EVIDENCE_TEXT.word`, new, for the owner's review):
    - "A Word document can't check itself. Two checks show whether anything has changed:"
    - a list of two: "Compare this file's own fingerprint with the one its sender recorded. `voicecap share` prints it, ready for the email that sends the file. `Get-FileHash <file>` in PowerShell, or `shasum -a 256 <file>` on a Mac, shows it for the file you received." and "Run `<the verify command>` on the transcripts folder. It checks every recorded file against its fingerprint, and every sealed record against its seal."
    - "This report's web page, <fileName>, can also check the transcripts it shows against their fingerprints, in any browser, offline."
  - for each run, the latest first: "Run 2026-09-29_1402" (heading 2); "<whenOf>. Completed and sealed."; its facts as a table of "What" and "What the run recorded"; then, each under a heading 3 that names the run, "Minute by minute" and "NVDA's own log, checked against the transcripts" with their "Not recorded" lines, "Test environment" as a table, and "Fingerprints (SHA-256)" as a table of "Page", "File", "Size", "SHA-256" (the fingerprint fixed-width), or the line that says the record lists no files; then the sentence before the verify command, and the command as a fixed-width block;
  - "Runs left out" (heading 2), its sentence, and the list, when there are any.
- **How voicecap came to be** (heading 1): why it exists, the study's headline a link; the usual answer; voicecap's answer; the timeline's caption; the timeline as a table of "When" and "What happened", a row for each entry: its day (`timelineDay`; "Next" for what isn't done), and its words, "**Windows PC:** …" and "**Mac:** …" for an entry with tracks, and the words alone for one across both; then "A few things worth knowing" (heading 2), and the six cards as a list, each title in bold.
- **The footer:** `ABOUT`, with the address a link; `generatedLine`; and `FOOTER_TEXT.word(fileName, wordName)`.
- **The properties:** the title is "<site name>: how its pages read aloud with <screen reader>", as the page's is; the author is who prepared it, or "voicecap"; each page's footer starts "<site name>, as of <date>".

- [ ] **Step 1: Write the failing tests**

`test/share-word-evidence.test.ts` checks, on `await demoModel()`: the coverage lists equal `model.coverage`; the evidence has a heading 2 for each run, latest first, each run's facts and fingerprints as table rows (`rows.length` equals `fingerprints.length`), "Not recorded" lines for the two parts no run records, and the two checks; the timeline table has a row for each `TIMELINE` entry and the last row's first cell is "Next"; the footer's last line is `This file: current.docx. Its web page: current.html.`

`test/share-word-outline.test.ts`:

```ts
it("has the page's sections, in the page's order", () => {
  const sections = wordOutline(model).flatMap((block) => (block.kind === "heading" && block.level === 1 ? [block.text] : []));
  expect(sections).toEqual([
    "Summary", "How voicecap works", "Every page", "What the flags found", "What changed since the last run",
    "Problems during the runs", "What these results cover", "The evidence behind these results",
    "How voicecap came to be", "Appendix: every transcript",
  ]);
  const page = renderSharePage(model, { fontCss: "" });
  expect(sections).toEqual([...page.matchAll(/<h2 id="[^"]+">(.*?)<\/h2>/g)].map(([, words]) => textOf(words!)));
});
// The spec: "the Word copy has the same text".
it("says every word of the fixed text", () => {
  const text = wordsOf(wordOutline(model)).join("\n");
  const fixed = [
    HOW_LEAD, ...HOW_STEPS.flatMap((step) => [step.title, step.text]),
    WHEN_TO_RUN.headline, WHEN_TO_RUN.text, ...WHEN_TO_RUN.stages.flatMap((stage) => [stage.title, stage.text]),
    STORY.why, STORY.usual, STORY.answer, ...WORTH_KNOWING.flatMap((card) => [card.title, card.text]), ABOUT,
    ...TIMELINE.flatMap((row) => [row.pc, row.mac, row.both]).flatMap((cell) => (cell === null ? [] : [lineText(lineOfMarkup(cell))])),
  ];
  for (const words of fixed) expect(text).toContain(words);
});
it("never names a library as how voicecap began", () => {
  expect(wordsOf(wordStory(model)).join("\n")).not.toMatch(/guidepup/i);
});
it("opens as a Word document with the right headings, properties, and links", async () => {
  const parts = await unzipDocx(await renderWordCopy(model));
  expect(XMLValidator.validate(parts.document)).toBe(true);
  expect(paragraphsOf(parts.document)[0]).toEqual({ style: "Title", text: model.header.siteName });
  expect(parts.core).toContain(`<dc:title>${model.header.siteName}: how its pages read aloud with NVDA</dc:title>`);
  expect(tablesOf(parts.document).every(({ header, rows }) => header && rows[0]!.every((words) => words !== ""))).toBe(true);
  expect(new Set(linksOf(parts))).toEqual(new Set([
    "https://github.com/ICJIA/voicecap", "https://github.com/ICJIA/voicecap/issues", "https://www.nvaccess.org/", STORY.deque.url,
  ]));
});
it("still says so when no run counts", async () => {
  const none = buildShareModel(inputOf([shareRun({ replayed: true })]));
  expect(wordsOf(wordOutline(none)).join("\n")).toContain("No live run counts yet.");
  expect(XMLValidator.validate((await unzipDocx(await renderWordCopy(none))).document)).toBe(true);
});
```

Those four are every address the page links to: the table of kinds names the issues address in every copy.

- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/share-word-evidence.test.ts test/share-word-outline.test.ts`. Expected: FAIL, the modules don't exist.
- [ ] **Step 3: Write `word/evidence.ts`, `word/outline.ts`, and `renderWordCopy`,** and have `pnpm share:fixture` write `demo.docx` beside `demo.html`.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`, then `pnpm share:fixture "$SCRATCH/sample"`.** Expected: PASS, and both files written.
- [ ] **Step 5: Commit**

```bash
git add src/share scripts/share-fixture.ts test/share-word-evidence.test.ts test/share-word-outline.test.ts
git commit -m "Add the Word copy's last sections, and the whole document"
```

### Task 9: `share/current.docx`, written with the page

**Files:**
- Modify: `src/share/write.ts`, `src/run/paths.ts`, `src/run/audit.ts`, `src/run/live-report.ts`, `src/cli/main.ts`, `.github/workflows/ci.yml`
- Test: `test/run-share.test.ts`, `test/cli.test.ts`

**Interfaces:**
- Consumes: `renderWordCopy` (Task 8); `loadShareInput`'s `wordName` (Task 3).
- Produces:
  - `src/run/paths.ts`: `shareDir(siteDir: string): string` (`<siteDir>/share`) and `shareWordPath(siteDir: string): string` (`<siteDir>/share/current.docx`), beside `sharePath`.
  - `src/share/write.ts`: `writeSharePage` becomes
    ```ts
    export interface ShareFiles { page: string | null; word: string | null }
    /** Null, with nothing said, when the site folder holds no run yet. */
    export function writeShareFiles(options: WriteShareFilesOptions): Promise<ShareFiles | null>;
    ```
    `WriteShareFilesOptions` is `WriteSharePageOptions`, with `rename?: (from: string, to: string) => Promise<void>` for the tests, passed to `writeFileAtomic`.
  - `LiveFiles` (`src/run/live-report.ts`) gains `word: string | null`.

**What it does.** It builds the model once, and writes the page and then the Word copy, each on its own: one that can't be made or written is a warning, and never stops the other, a run, a review, or a report. The Word copy is written with `retryForMs: 1000`. Its warning is `The Word copy wasn't updated: <the error's message>`, and when the error's code is `EPERM`, `EBUSY`, or `EACCES` it ends: ` If current.docx is open in Word, close it, then run: npx @icjia/voicecap report`. `voicecap report` prints `Word copy: <path>` after `Shareable page: <path>`.

- [ ] **Step 1: Write the failing tests**

In `test/run-share.test.ts`, rename the `writeSharePage` tests to `writeShareFiles`, have each expect `{ page, word }`, and add:

```ts
it("writes current.docx beside current.html when a run completes", async () => {
  const result = await runAudit(options(dir, new ScriptedDriver(sitePages())));
  const word = path.join(result.siteDir, "share", "current.docx");
  expect(XMLValidator.validate((await unzipDocx(await readFile(word))).document)).toBe(true);
});
// Review Focus 1: current.docx open in Word.
it("writes the page, and says so plainly, when Word holds current.docx", async () => {
  const held = Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
  const rename = async (from: string, to: string) => {
    if (to.endsWith("current.docx")) throw held;
    await fsRename(from, to);
  };
  const started = Date.now();
  const files = await writeShareFiles({ siteDir, config, logger, rename });
  expect(files).toEqual({ page: path.join(siteDir, "share", "current.html"), word: null });
  expect(Date.now() - started).toBeLessThan(5000);
  expect(logger.text("warn")).toMatch(
    /^The Word copy wasn't updated: EPERM.* If current\.docx is open in Word, close it, then run: npx @icjia\/voicecap report$/,
  );
});
it("writes the Word copy when the page can't be written", async () => {
  const rename = async (from: string, to: string) => {
    if (to.endsWith("current.html")) throw new Error("no room");
    await fsRename(from, to);
  };
  const files = await writeShareFiles({ siteDir, config, logger, rename });
  expect(files).toEqual({ page: null, word: path.join(siteDir, "share", "current.docx") });
  expect(logger.text("warn")).toBe("The shareable page wasn't updated: no room");
});
```

In `test/cli.test.ts`: `voicecap report` on a replayed fixture site prints a line starting `Word copy: ` that ends `current.docx`.

- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/run-share.test.ts test/cli.test.ts`. Expected: FAIL, `writeShareFiles` doesn't exist.
- [ ] **Step 3: Make the changes.** In `ci.yml`'s smoke test, after the line that checks `share/current.html`, add `test -f "$out/127.0.0.1_4747/share/current.docx"`.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src .github/workflows/ci.yml test/run-share.test.ts test/cli.test.ts
git commit -m "Write share/current.docx wherever the shareable page is written"
```

### Task 10: `shares.json`, the record of what was sent

**Files:**
- Create: `src/share/shares.ts`
- Modify: `src/model.ts`, `src/run/paths.ts`
- Test: `test/shares.test.ts`

**Interfaces:**
- Produces:
  - `src/model.ts`:
    ```ts
    /** A file `voicecap share` wrote: its name in the site's share/ folder, its size, and its SHA-256. */
    export interface SharedFile extends FileHash { name: string }
    /** One share, in <site>/share/shares.json: never rewritten once it's recorded. */
    export interface ShareEntry {
      /** Its 1-based place in the file's chain. */
      seq: number;
      /** The seal of the entry before it; null for the first. */
      prev: string | null;
      /** When the copies were made: a local ISO date and time. */
      at: string;
      /** Who made them. */
      by: string;
      /** The ids of the runs the copies drew on, oldest first. */
      runs: string[];
      /** The page, then its Word copy. */
      files: SharedFile[];
      /** sealOf this entry. */
      seal: string;
    }
    export interface SharesFile { schemaVersion: 1; shares: ShareEntry[] }
    ```
  - `src/run/paths.ts`: `sharesPath(siteDir: string): string` (`<siteDir>/share/shares.json`).
  - `src/share/shares.ts`:
    ```ts
    /** A site folder's shares.json. A missing file is an empty record. */
    export function readShares(siteDir: string): Promise<SharesFile>;
    /** Append one entry, chained and sealed. Earlier entries are never edited or deleted. */
    export function appendShare(siteDir: string, entry: Omit<ShareEntry, "seq" | "prev" | "seal">): Promise<ShareEntry>;
    ```

**The rules,** as `src/reviews/store.ts` keeps them for reviews: the file is re-read, checked, extended, checked again to hold every earlier entry unchanged, and written atomically, as JSON with two-space indents and a final newline. `seq` is one past the highest in the file, and `prev` is that entry's seal. A file that isn't JSON, or isn't `{ schemaVersion: 1, shares: [...] }` with an object for each entry, is never overwritten: both functions throw a `UsageError` that names the file and says voicecap never overwrites the record of what was shared, so fix it or restore it from version control.

- [ ] **Step 1: Write the failing tests**

`test/shares.test.ts`:

```ts
const FILES = [{ name: "x_2026-09-30.html", bytes: 10, sha256: "a".repeat(64) }, { name: "x_2026-09-30.docx", bytes: 20, sha256: "b".repeat(64) }];
const entry = { at: "2026-09-30T10:00:00-05:00", by: "Pat Lee", runs: ["2026-09-29_1315", "2026-09-29_1402"], files: FILES };

it("gives an empty record for a site that has shared nothing", async () => {
  expect(await readShares(siteDir)).toEqual({ schemaVersion: 1, shares: [] });
});
it("chains and seals each entry, as reviews are", async () => {
  const first = await appendShare(siteDir, entry);
  const second = await appendShare(siteDir, { ...entry, at: "2026-09-30T11:00:00-05:00" });
  expect(first).toMatchObject({ seq: 1, prev: null });
  expect(first.seal).toBe(sealOf(first));
  expect(second).toMatchObject({ seq: 2, prev: first.seal });
  expect((await readShares(siteDir)).shares).toEqual([first, second]);
});
// Review Focus 5.
it("never overwrites a record it can't read", async () => {
  await writeFile(sharesPath(siteDir), "{ not json");
  await expect(appendShare(siteDir, entry)).rejects.toThrow(/never overwrites the record of what was shared/);
  expect(await readFile(sharesPath(siteDir), "utf8")).toBe("{ not json");
});
it("refuses a record that isn't a list of shares", async () => {
  await writeFile(sharesPath(siteDir), JSON.stringify({ schemaVersion: 1, shares: ["x"] }));
  await expect(readShares(siteDir)).rejects.toThrow(UsageError);
});
```

- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/shares.test.ts`. Expected: FAIL, the module doesn't exist.
- [ ] **Step 3: Write the types, `sharesPath`, and `src/share/shares.ts`.**
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/model.ts src/run/paths.ts src/share/shares.ts test/shares.test.ts
git commit -m "Add shares.json, the sealed record of what was sent"
```

### Task 11: `voicecap share`, and `shareReport`

**Files:**
- Create: `src/share/share.ts`
- Modify: `src/cli/main.ts`, `src/index.ts`
- Test: `test/share-report.test.ts`, `test/cli.test.ts`

**Interfaces:**
- Consumes: `loadShareInput`, `buildShareModel`, `renderSharePage`, `fontFaceCss`, `renderWordCopy`, `appendShare`, `readShares`, `shareDir`; `resolveHome`, `chooseSiteDir`, `loadConfig`, `resolveReviewer`, `ensureGitFiles`, `isoLocal`, `sha256`, as `addReview` (`src/reviews/review.ts`) uses them.
- Produces, in `src/share/share.ts`, exported from `src/index.ts` with its types:
  ```ts
  export interface ShareReportOptions {
    /** Any URL on the site. Default: the home's only site. */
    site?: string | null;
    /** The transcripts home. Default: VOICECAP_TRANSCRIPTS, else "transcripts". */
    out?: string;
    /** Who is sharing. Default: VOICECAP_REVIEWER, then git config user.name, then the config's reviewer. */
    reviewer?: string | null;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    config?: LoadedConfig;
    logger?: Logger;
    now?: Date;
  }
  export interface ShareReportResult {
    siteDir: string;
    /** The entry as shares.json holds it. */
    entry: ShareEntry;
    /** The page, then its Word copy: each file's full path, with what the entry records of it. */
    files: (SharedFile & { path: string })[];
    /** The line to paste into the email that sends them. */
    pasteLine: string;
  }
  export function shareReport(options?: ShareReportOptions): Promise<ShareReportResult>;
  ```

**What it does, in order:**

1. Finds the site's folder and who is sharing, as `addReview` does: `resolveReviewer`, which refuses with a `UsageError` when there's no name, and whose own tests cover that.
2. Loads the site's records. With no run that counts (`model.header.tested === null`), it throws a `UsageError`: `No completed, sealed, live run in <siteDir> yet, so there's nothing to share. Replayed, interrupted, and unsealed runs don't count.`
3. Picks the copies' name: `<the site folder's name>_<YYYY-MM-DD>`, the date `now`'s local date; then `-2`, `-3`, and so on, taking the first whose `.html` and `.docx` are neither on disk in `share/` nor named by any entry of `shares.json`.
4. Builds the model with those names (`fileName`, `wordName`), so each copy's footer names itself and the other, and renders both.
5. Writes each with the `wx` flag, which never overwrites. If either name was taken meanwhile, it removes what it just wrote of this pair, takes the next number, and starts again from step 4.
6. Makes sure the home has its Git files (`ensureGitFiles`), as a review does, then appends the entry: `at` is `isoLocal(now)`, `runs` are the ids of the runs the model's evidence lists, oldest first, and `files` are the page, then the Word copy, each with its size and SHA-256 as written.
7. Says, through the logger:
   ```text
   Shared <the site folder's name>, as of 30 September 2026: entry 3 in <path to shares.json>.
     <path to the page>
       1.2 MB (1,234,567 bytes), SHA-256 <its fingerprint>
     <path to the Word copy>
       310 KB (317,440 bytes), SHA-256 <its fingerprint>
   To paste into the email that sends them:
     Fingerprints (SHA-256): <page's name> <its fingerprint>; <Word copy's name> <its fingerprint>. To check a file you received: Get-FileHash <file> in PowerShell, or shasum -a 256 <file> on a Mac.
   ```
   The last line, without its indent, is `pasteLine`. A size is in KB under 1 MB (1,048,576 bytes), and in MB with one decimal from there. A file over 20 MB (20 × 1,048,576 bytes) gets a warning: `<name> is 23.4 MB, over 20 MB: too big for most email.`

**The command:** `voicecap share`, described as "make a dated copy of the shareable page and its Word copy to send, and record it", with `--site <url>` ("the site's URL (default: the home's only site)"), `--out <dir>`, and `--reviewer <name>` ("who is sharing (default: VOICECAP_REVIEWER, git config user.name, or the config's reviewer)"). It exits with 0.

- [ ] **Step 1: Write the failing tests**

`test/share-report.test.ts`. Each test makes a home with one completed, sealed, live run, as `test/run-share.test.ts` does (`const run = await runAudit(options(dir, new ScriptedDriver(sitePages())))`, from `test/helpers/run-site.ts`; `siteDir` is `outDir(dir)`), and shares with `options = { out: path.join(dir, "transcripts"), site: SITE, reviewer: "Pat Lee", now: new Date(2027, 0, 15, 10, 0), logger }`. `SITE`'s folder is `example.illinois.gov`:

```ts
it("writes the dated pair, and records it", async () => {
  const { files, entry, pasteLine } = await shareReport(options);
  expect(files.map(({ name }) => name)).toEqual(["example.illinois.gov_2027-01-15.html", "example.illinois.gov_2027-01-15.docx"]);
  for (const file of files) {
    const bytes = await readFile(file.path);
    expect({ bytes: bytes.length, sha256: sha256(bytes) }).toEqual({ bytes: file.bytes, sha256: file.sha256 });
  }
  expect(entry).toMatchObject({ seq: 1, prev: null, by: "Pat Lee", at: isoLocal(options.now), runs: [run.runId] });
  expect((await readShares(siteDir)).shares).toEqual([entry]);
  expect(pasteLine).toBe(`Fingerprints (SHA-256): ${files[0]!.name} ${files[0]!.sha256}; ${files[1]!.name} ${files[1]!.sha256}. To check a file you received: Get-FileHash <file> in PowerShell, or shasum -a 256 <file> on a Mac.`);
});
it("has each copy name itself and the other", async () => {
  const { files } = await shareReport(options);
  expect(await readFile(files[0]!.path, "utf8")).toContain('This file: <span class="mono">example.illinois.gov_2027-01-15.html</span>. Its Word copy: <span class="mono">example.illinois.gov_2027-01-15.docx</span>.');
  const { document } = await unzipDocx(await readFile(files[1]!.path));
  expect(paragraphsOf(document).at(-1)?.text).toBe("This file: example.illinois.gov_2027-01-15.docx. Its web page: example.illinois.gov_2027-01-15.html.");
});
// Review Focus 4.
it("numbers a second pair on the same day, and never changes the first", async () => {
  const first = await shareReport(options);
  const before = await Promise.all(first.files.map(({ path: file }) => readFile(file)));
  const second = await shareReport(options);
  expect(second.files.map(({ name }) => name)).toEqual(["example.illinois.gov_2027-01-15-2.html", "example.illinois.gov_2027-01-15-2.docx"]);
  expect(await Promise.all(first.files.map(({ path: file }) => readFile(file)))).toEqual(before);
  expect(second.entry).toMatchObject({ seq: 2, prev: first.entry.seal });
});
it("never takes a name the record has, even when its file is gone", async () => {
  const first = await shareReport(options);
  await Promise.all(first.files.map(({ path: file }) => rm(file)));
  expect((await shareReport(options)).files[0]!.name).toBe("example.illinois.gov_2027-01-15-2.html");
});
it("never writes over a file that's there, recorded or not", async () => {
  await mkdir(shareDir(siteDir), { recursive: true });
  await writeFile(path.join(shareDir(siteDir), "example.illinois.gov_2027-01-15.docx"), "someone's own file");
  expect((await shareReport(options)).files[0]!.name).toBe("example.illinois.gov_2027-01-15-2.html");
  expect(await readFile(path.join(shareDir(siteDir), "example.illinois.gov_2027-01-15.docx"), "utf8")).toBe("someone's own file");
});
it("leaves current.html and current.docx as they were", async () => {
  const current = [sharePath(siteDir), shareWordPath(siteDir)];
  const before = await Promise.all(current.map((file) => readFile(file)));
  await shareReport(options);
  expect(await Promise.all(current.map((file) => readFile(file)))).toEqual(before);
});
it("refuses when no run counts", async () => {
  // A home whose only run is a replay: runAudit with replayFrom, as test/run-share.test.ts makes one.
  await expect(shareReport(replayOnly)).rejects.toThrow(/so there's nothing to share\. Replayed, interrupted, and unsealed runs don't count\./);
  expect(existsSync(sharesPath(replaySiteDir))).toBe(false);
});
it("takes the name as a review does, when --reviewer gives none", async () => {
  const { entry } = await shareReport({ ...options, reviewer: null, env: { VOICECAP_REVIEWER: "Env Name" } });
  expect(entry.by).toBe("Env Name");
});
// Review Focus 5.
it("refuses to share over a record it can't read, and writes no copy", async () => {
  await writeFile(sharesPath(siteDir), "{ not json");
  await expect(shareReport(options)).rejects.toThrow(/never overwrites the record of what was shared/);
  expect((await readdir(shareDir(siteDir))).sort()).toEqual(["current.docx", "current.html", "shares.json"]);
});
it("warns when a copy is too big for most email", () => {
  expect(sizeWarning("x.html", 24_536_679)).toBe("x.html is 23.4 MB, over 20 MB: too big for most email.");
  expect(sizeWarning("x.html", EMAIL_LIMIT_BYTES)).toBeNull();
});
```

`share.ts` exports `EMAIL_LIMIT_BYTES = 20 * 1024 * 1024` and the pure `sizeWarning(name: string, bytes: number): string | null`, which `shareReport` calls for each file it wrote.


In `test/cli.test.ts`: `voicecap share --out <home> --site https://example.illinois.gov --reviewer "Pat Lee"` exits with 0 and prints the lines above, the paste line last; `voicecap --help` lists `share`.

- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/share-report.test.ts test/cli.test.ts`. Expected: FAIL, the module and the command don't exist.
- [ ] **Step 3: Write `src/share/share.ts`, the command, and the exports** (`shareReport`, `ShareReportOptions`, `ShareReportResult`; `readShares` for plan 5; the types of Task 10 come with `export * from "./model.js"`).
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/share/share.ts src/cli/main.ts src/index.ts test/share-report.test.ts test/cli.test.ts
git commit -m "Add voicecap share: dated copies to send, each recorded with its fingerprint"
```

### Task 12: `voicecap verify` checks what was shared

**Files:**
- Modify: `src/verify.ts`
- Test: `test/verify.test.ts`

**Interfaces:**
- Consumes: `readShares`, `sharesPath`, `shareDir`, `sealOf`; `verify.ts`'s own `difference`, `chainProblems`, `linkPath`, `MISSING`, `CHANGED`.
- Produces: `VerifySiteResult.shares: number`, the entries in `shares.json`. The summary line becomes `<folder>: 3 runs (1 incomplete), 2 manual sessions, 4 reviews, 1 share checked: everything matches.`

**What it checks,** for each site folder, after the reviews. Every problem starts with a path from the home, with forward slashes, as the others do:

- `shares.json` that can't be read as one: `<path to shares.json>: not a readable record of what was shared`, and nothing more of it.
- An entry that no longer matches its seal: `<path to shares.json>: share 2 (2026-09-30T10:00:00-05:00) changed since it was recorded`.
- The chain, by the rules `chainProblems` has for reviews (make it take any entries with `seq`, `prev`, `seal`, and whether each is intact): `<path to shares.json>: entry 2 is missing`, `entries 2 to 3 are missing`, `more than one entry is numbered 2`, `entry 1 follows an entry that isn't there`, `entry 3 doesn't follow entry 2`.
- Each file of each entry that matches its seal: `<path to the file>: missing`, or `<path to the file>: changed since it was recorded (SHA-256 differs)` (its size or its SHA-256 differs).
- Each file in `share/` that no entry names, other than `current.html`, `current.docx`, `shares.json`, and a file whose name starts with a dot: `<path to the file>: not recorded in shares.json`. A folder in `share/`: `<path>: an unexpected folder`.

`current.html` and `current.docx` are never checked: voicecap writes them again from the records. A site with no `share/` folder, or with only `current.*` in it, has 0 shares and no problem.

The problems come in this order: the record's own (each entry that changed, then the chain), then each recorded file in the entries' order, then each file nothing records, by name. A file that any entry names, changed or not, is never also "not recorded". With a record that can't be read, every dated copy in the folder is "not recorded in shares.json", after the record's own line.


- [ ] **Step 1: Write the failing tests**

In `test/verify.test.ts`, with a home made as Task 11's tests make one, shared twice on the same day (`first`, then `second`):

```ts
it("counts the shares, and finds nothing wrong with copies as they were sent", async () => {
  const { sites, problems } = await verifyHome({ home, logger });
  expect(problems).toBe(0);
  expect(sites[0]).toMatchObject({ shares: 2 });
  expect(logger.entries.at(-1)?.message).toBe("example.illinois.gov: 1 run (0 incomplete), 0 manual sessions, 0 reviews, 2 shares checked: everything matches.");
});
// Review Focus 5.
it("names a sent copy that was edited, and one that's gone", async () => {
  await appendFile(first.files[0]!.path, " ");
  await rm(second.files[1]!.path);
  expect((await verifyHome({ home, logger })).sites[0]!.problems).toEqual([
    "example.illinois.gov/share/example.illinois.gov_2027-01-15.html: changed since it was recorded (SHA-256 differs)",
    "example.illinois.gov/share/example.illinois.gov_2027-01-15-2.docx: missing",
  ]);
});
it("names an entry that was edited, and doesn't go by what it says of its files", async () => {
  const record = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as SharesFile;
  record.shares[0]!.by = "Someone Else";
  await writeFile(sharesPath(siteDir), JSON.stringify(record, null, 2));
  await rm(first.files[0]!.path);
  expect((await verifyHome({ home, logger })).sites[0]!.problems).toEqual([
    `example.illinois.gov/share/shares.json: share 1 (${first.entry.at}) changed since it was recorded`,
  ]);
});
it("names an entry that was removed, and the copies nothing records any more", async () => {
  const record = JSON.parse(await readFile(sharesPath(siteDir), "utf8")) as SharesFile;
  record.shares.shift();
  await writeFile(sharesPath(siteDir), JSON.stringify(record, null, 2));
  expect((await verifyHome({ home, logger })).sites[0]!.problems).toEqual([
    "example.illinois.gov/share/shares.json: entry 1 is missing",
    "example.illinois.gov/share/example.illinois.gov_2027-01-15.docx: not recorded in shares.json",
    "example.illinois.gov/share/example.illinois.gov_2027-01-15.html: not recorded in shares.json",
  ]);
});
it("names a copy that nothing records", async () => {
  await writeFile(path.join(shareDir(siteDir), "example.illinois.gov_2027-02-01.html"), "<p>");
  expect((await verifyHome({ home, logger })).sites[0]!.problems).toEqual(["example.illinois.gov/share/example.illinois.gov_2027-02-01.html: not recorded in shares.json"]);
});
it("says when the record can't be read, and names the copies it can no longer vouch for", async () => {
  await writeFile(sharesPath(siteDir), "{");
  expect((await verifyHome({ home, logger })).sites[0]!.problems[0]).toBe(
    "example.illinois.gov/share/shares.json: not a readable record of what was shared",
  );
});
it("leaves current.html and current.docx alone", async () => {
  await appendFile(sharePath(siteDir), " ");
  await appendFile(shareWordPath(siteDir), " ");
  expect((await verifyHome({ home, logger })).problems).toBe(0);
});
```


Every existing test that pins the summary line gains `, 0 shares`.

- [ ] **Step 2: Run them, and see them fail.** Run: `pnpm exec vitest run test/verify.test.ts`. Expected: FAIL, `shares` is undefined and the line has no shares.
- [ ] **Step 3: Add the check to `src/verify.ts`,** and update the comment that says `share/` holds only what voicecap writes again.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/verify.ts test/verify.test.ts
git commit -m "Have verify check shares.json, and every copy it records"
```

### Task 13: The docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `src/share/text.ts` (the timeline), `src/run/paths.ts` (its header comment), `docs/phase-c-handoff.md`
- Test: `test/share-text.test.ts`

**What to write:**

- **`README.md`.** It's one paragraph to a line; its long sections are folded behind `<details>`, with every heading outside a fold. Keep both.
  - "The shareable page": the Word copy (`share/current.docx`: the same sections and numbers, nothing folded, tables where the page has charts, made for paper and for Word's navigation pane); `voicecap share` (the dated copies, `-2` on the same day, never overwritten; what it prints, with the line to paste into the email; the 20 MB warning; that it needs a name, and a run that counts); `share/shares.json` (what each entry holds, sealed and chained); and that the dated copies and `shares.json` go into Git with the rest of the record, while `current.*` stays out.
  - "Commands and options": `voicecap share`, with its three options.
  - "The transcripts folder": the tree gains `share/current.docx`, `share/<site>_<date>.html`, `.docx`, and `share/shares.json`.
  - "The audit record": `verify` checks `shares.json` and each copy it records, and names a copy nothing records; the summary line's new form.
  - "Programmatic API": `shareReport`, and that `generateReport`, `addReview`, and `addManualSession` now write `current.docx` too.
  - Wherever it says what `voicecap report` prints: the `Word copy:` line.
- **`CHANGELOG.md`, `[Unreleased]`, "Added":** the Word copy; `voicecap share` and `shares.json`; `verify`'s checks; `shareReport`. "Changed": the page's footer names its Word copy; "What the check proves" says where the sender's fingerprint comes from; `verify`'s summary line counts shares; `docx` is a new dependency.
- **The timeline** (`TIMELINE`), for the owner's review:
  - a new row dated the day this is written, `release: null`, across both tracks: `The Word copy of the shareable report, and <code>voicecap share</code>: dated copies to send, each recorded with its fingerprint.`
  - the "Next" row's Windows PC cell becomes: `A walkthrough file that repeats a run exactly, and a website of the shared reports.`
- **`src/run/paths.ts`:** the header comment's tree gains the four files.
- **`docs/phase-c-handoff.md`:** under "Being built", plan 3 as merged; the test count; and for the Mac: `voicecap share` and the Word copy need no screen reader, and work on any computer.

- [ ] **Step 1: Write the failing test.** In `test/share-text.test.ts`: the last row is "Next", and its `pc` is the sentence above; the row before it has `release: null` and `both` the sentence above.
- [ ] **Step 2: Run it, and see it fail.** Run: `pnpm exec vitest run test/share-text.test.ts`. Expected: FAIL on the old "Next" row.
- [ ] **Step 3: Write the docs and the timeline.**
- [ ] **Step 4: Check the README.** Its `<details>` are balanced and never nested, no heading is inside one, and every in-page link lands (compare each `](#…)` with GitHub's slug of a heading).
- [ ] **Step 5: Run `pnpm lint && pnpm typecheck && pnpm test`.** Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md src/share/text.ts src/run/paths.ts docs/phase-c-handoff.md test/share-text.test.ts
git commit -m "Document the Word copy, voicecap share, and what verify checks of them"
```

## For the owner, once it's built

No screen reader is needed for any of this:

1. `pnpm share:fixture <a folder>` writes the demo's page and its Word copy. Open `demo.docx` in Word.
2. In Word: View → Navigation Pane shows every section by its heading; Review → Check Accessibility should find no errors; File → Print Preview shows page numbers, and each table's headings again at the top of a new page.
3. `node dist/cli.js share --out C:\Users\cschw\voicecap-check` makes a dated pair from the check run of 2 October, and prints the line for the email. `node dist/cli.js verify --out C:\Users\cschw\voicecap-check` then counts 1 share.
4. Read the new fixed text: the two checks in the Word copy's evidence, card 5, the footer's two names, and the timeline's two rows.

## Not in this plan

- **The walkthrough file's download** (plan 4), **the website** (plan 5), and **the event log, screenshots, and NVDA's own log** (plan 6). Their places say "Not recorded" in the Word copy, as on the page.
- **Charts drawn as pictures** in the Word copy, **a PDF**, and **comparing with the last copy sent**: the spec's "Not included".
- **IBM Plex in the Word copy.** It uses Calibri and Consolas, which Word has. The page embeds its fonts; a `.docx` would need them in another format.
- **A table of contents in the Word copy.** Word asks to update one's page numbers on opening, which worries a reader; the navigation pane does the job.
- **One standing per screen reader** (Phase C).
- **Carried from plan 2 and still open:** the items under "Later" in its "After execution".
