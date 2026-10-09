# axe on each page's card: what an automated checker finds, beside what NVDA said

## Why

On 2026-10-08 the owner asked, looking at a page's card in the sfs report:

> "is it possible to also have an expandable section with full axe/lighthouse information for each page? That way, a user can zero in on a single page, see the NVDA transcripts, and the axe scores."

They queued it as plan 10 ("yes plan 10. thanks"), on the design recommended in chat:
- axe only, not Lighthouse;
- captured in the run, on the page load NVDA reads;
- sealed with the run;
- a fold on each page's card, kept apart from voicecap's verdict.

The release order is plan 12 (0.15.0), then this (0.16.0).

**This spec was written overnight on 2026-10-08, from those recommendations,** at the owner's word: "your recommendations are fine for questions", and "please continue through the night". Every choice it makes beyond the chat's is listed under "Choices for the owner to confirm".

## What it is

During a run, voicecap checks each page with axe-core, the open-source accessibility checker that Lighthouse's accessibility score is built on.
- **When:** on the page load NVDA reads first, once the page is ready, before NVDA reads it.
- **What's kept:** the results are saved with the page, fingerprinted, and sealed with the run, like the page's screenshot.
- **Where they show:** each page's card on the shareable page gets a chip and a closed fold, "What axe found". The Word copy has the same, unfolded.

**What doesn't change:**
- **What NVDA says, and how it's driven.** axe runs once NVDA is at the top of the page and before the first pass's first key, and it doesn't touch the page: it moves no focus, scrolls nothing, and adds nothing to the page.
- **voicecap's verdict, the ring, the numbers, and "What needs attention".** They stay about what NVDA said and the person's review. axe's results are evidence beside them, never a score and never a verdict ("axe isn't the answer key", as the shareable report's design said in 2026-09-30).
- **The website.** It still publishes only what each share recorded. axe's results reach it inside the shareable page and the Word copy, as the screenshots do.
- **A run's settings.** axe has none, so a walkthrough file and a run's resume are as they are.

## How it's captured

- **The driver gets an optional method,** `checkWithAxe?(): Promise<AxeCapture>`. A driver that can't check a page leaves it out, and the run records no axe result for its pages: the replay driver, and the AT Driver stub. `AxeCapture` is `{ json: string; summary: AxeSummary } | { error: string }`.
- **The runner calls it on the first load of each page, and only there.** That's right after `openPage` and the first load's checks (an HTML page that answered 2xx), and before the first pass's first key. It never calls it on a later load, on a page it skips, or on one that answered 4xx or 5xx.
- **In the Guidepup driver, through the browser it already holds:**
  - It runs axe-core's own script, `axe.min.js` from the installed `axe-core` package, unchanged, with its license notice. The script runs through the browser's DevTools connection, in an isolated world of its own on the page's main frame: a world that shares the page's document, but none of its scripts' globals. So nothing is added to the page's own world, and a page's own scripts can't reach axe (a page that replaces `Array.prototype.map`, or names a global `axe`, is still checked). It isn't a `<script>` added to the page, and it isn't evaluated by a string in the page, so a page's Content Security Policy, or its Trusted Types, doesn't block it.
  - Then, in that world, it runs `axe.run(document, { runOnly: { type: "tag", values: TAGS }, resultTypes: ["violations", "incomplete"] })`, and takes the results back as one JSON string.
  - The tags are the ones voicecap's own tests use: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`.
  - axe checks the page's main frame. It doesn't look inside a page's iframes: each shows as an item that needs review (`frame-tested`).
- **Bounded, and never a failure:**
  - It has its own limit of 20 seconds. Past the limit, or on any error, it gives `{ error }`, as the screenshot does: the first line of what went wrong, cut to 300 UTF-16 code units, so the reason holds no stack.
  - The page is read as usual, and its record says why axe has no result.
  - A browser that's gone is still the environment error it is today.
- **What's kept of axe's results,** in `pages/<slug>/axe.json`. axe's full output repeats every element that passed, so only this is kept:
  - `schemaVersion: 1`, the axe-core version, the tags run, and `url`;
  - the counts of violations, needs-review (axe's "incomplete"), passes, and rules that didn't apply;
  - for each violation and each needs-review rule:
    - its id, impact, `help`, `helpUrl`, and tags;
    - for each element, its `target` (selectors) and its `failureSummary`;
    - its `html`, cut to 300 UTF-16 code units (a string's length), never splitting a character written with two of them;
    - at most 50 elements a rule, with how many more there were.

  The JSON is written with sorted keys and one indent, so the same results give the same bytes.

## How it's recorded

- **The page's record gains `axe?`,** beside `screenshot?`, and kept apart from `files` as the screenshot is, so a review doesn't copy it. It's one of these:
  - `FileHash & { ranAt, axeVersion, counts: { violations, incomplete, passes, inapplicable }, impacts: { critical, serious, moderate, minor } }`, where `impacts` counts violations by impact;
  - or `{ error, ranAt }`.
- **No `axe` field** means axe didn't run: the page wasn't read, its driver can't check a page, or the run is from before 0.16.0.
- **The run's seal covers it,** as it covers the screenshot's record. A completed run's folder is never written again.
- **A retry or a resume** moves `axe.json` with the page's folder to `attempts/`, as today.
- **`voicecap verify`** checks `pages/<slug>/axe.json` against its record when the record has a hash: missing, changed, or not recorded by the run, as for a screenshot. A run from before 0.16.0 passes.
- **No `schemaVersion` bump:** the field is optional, as `screenshot` was in 0.11.0.

## What the shareable page shows

- **On each page's card:**
  - **A chip after the flags' chips:**
    - with violations: `axe: 3 issues`, in the chips' warning color;
    - with none: `axe: no issues`;
    - with no result: no chip.

    Chips are plain words: the color only repeats them.
  - **A closed fold, after "Heard first" and before "The full transcript":** "What axe found", with the page's address for a screen reader ("What axe found on /about/"), as the transcript's fold does. Inside:
    - **A line of what it is:** "axe is an automated checker: it tests a page's code against rules, and finds what code can find. A person's review finds the rest." Then the axe version and the rules run (WCAG 2.0, 2.1, and 2.2 at A and AA, and best practices).
    - **The counts:** issues by impact (critical, serious, moderate, minor), needs review, and rules passed.
    - **Each issue, most severe first:**
      - its `help`, as the item's heading;
      - its impact;
      - the WCAG success criteria its tags name ("WCAG 2.1 AA 1.4.3"), or "best practice";
      - its elements, each with its selector and its HTML in the fixed-width font, and axe's "how to fix" (`failureSummary`), said once for the rule when every element listed has the same words, and with each element when they differ;
      - a link to axe's page for the rule (`helpUrl`), which leaves the page.
    - **Needs review:** what axe couldn't decide, listed the same way, under its own heading. It says these need a person to check.
    - **With nothing found:** "axe found no issues on this page." with the counts.
    - **The file's fingerprint,** as each transcript's is: "axe.json: N bytes, SHA-256 …".
  - **Without a result,** the fold says why, as the screenshot's place does:
    - "Not recorded: this run used voicecap 0.15.0.";
    - "axe couldn't check this page: <reason>.";
    - "Not checked: this run's driver doesn't check pages with axe."
- **"Check the fingerprints"** covers each `axe.json`. The page carries each file's exact text in its data block, as it does each transcript's, and checks it against the run's record. The fold is drawn from the same text, and the check holds what the fold shows to it: the counts, the number on the card's chip, each rule's heading, each element's selector and HTML, and axe's words on how to fix them. So a passing check vouches for those parts of the fold, and not for the rest, which is drawn from the same text but isn't compared: among it the version line, each rule's impact and criteria lines, the "and N more elements" line, the line with the file's size and SHA-256, and the links. The result line adds "and N of M axe results match their fingerprints".
- **The fingerprints table** gains a row for each `axe.json`.
- **The details, for reviewers and auditors:** one line in "How voicecap works" says each page is checked with axe before NVDA reads it, and that axe's results are evidence beside the person's review, never its verdict.
- **The page's size:** each `axe.json` is carried once, in the data block, and its words once, in the fold. The share's 20 MB warning stays as it is.

## The Word copy

For each page, after "Heard first":
- **"What axe found"** (bold), then the same counts and issues as the fold, unfolded, each issue a paragraph with its elements as a list;
- or the reason there's none.

The files and fingerprints table gains the `axe.json` rows.

## Dependencies

- **`axe-core` moves from devDependencies to dependencies,** pinned exactly (`4.13.0`). It's MPL-2.0. Its file is used unchanged, with its notice.
- **The PC security audit** adds it to the supply-chain list.
- **`@axe-core/playwright` stays a dev dependency,** for voicecap's own tests.
- **After plan 12 merges,** the website's Technical details toolchain row for axe-core says it checks each page during a run, as well as in voicecap's tests.

## Wording

- axe may be called "an automated checker". voicecap never is: it's a human review, sped up.
- A person hears, reads, and decides, and never "listened".
- axe's words (`help`, `failureSummary`) are axe's, shown as axe's, in the fold. voicecap's own words never call a page accessible or not.

## Tests

- **The Guidepup driver,** with real headless Chromium on the fixture site (`test/chrome-session.test.ts`'s pattern, skipped without Chromium):
  - axe finds the known violations on the demo site's /common-mistakes/: `button-name`, `label`, and `page-has-heading-one`;
  - it runs on a page with a strict Content Security Policy, and on one that requires Trusted Types;
  - it checks a page that replaces `Array.prototype.map` or names its own `axe` as it checks any other, and leaves what the page's own world holds as it was;
  - `document.activeElement` and the scroll position are unchanged after it, and so is the page's HTML;
  - its result is under the 20-second limit, and a stuck run gives `{ error }` at the limit.
- **The runner,** with the scripted driver:
  - axe runs once a page, on the first load, after `openPage` and before the first pass's first key;
  - `axe.json` is written and recorded;
  - an `{ error }` is recorded and the page is read as usual;
  - no axe on a skipped page, a 4xx, or a 5xx;
  - a driver without the method records no `axe`.
- **The record and verify:**
  - the seal covers `axe`;
  - verify reports a missing, changed, or unrecorded `axe.json`;
  - a run from before 0.16.0, and the i2i fixture (0.11.0), pass.
- **The shareable page:**
  - the chip's words for 0, 1, and many issues;
  - the fold's parts and order;
  - the reason lines for each kind of missing result;
  - escaping of everything axe supplies (an element's HTML holding `<script>` comes out as text);
  - "Check the fingerprints" checks the axe files, and what each card's fold shows of them (the counts, the chip's number, each rule's heading, each element, and axe's words on how to fix them), and catches a changed file, or a fold that shows otherwise ("Show a change being caught" changes an axe file);
  - the verdict, the ring, and "What needs attention" are the same with and without axe results;
  - axe has no violations on the page itself, in both themes, at 1280, 390, and 320 pixels, with the folds open.
- **The Word copy:** the axe part, and the fingerprints rows.
- **Wording:** the share-text tests' rules hold. "automated" appears only of axe and other checkers.

## Docs and release

- **The README:**
  - "What voicecap does on each page": axe's check, before NVDA reads, and what's kept;
  - "The audit record": the `axe` record, `axe.json`, and verify;
  - "The shareable page" and "The Word copy": the chip and the fold;
  - Credits: axe-core (MPL-2.0).
- **The CHANGELOG,** and the timeline's row for 0.16.0 (a minor).
- **The release:** 0.16.0, after 0.15.0. Reports show axe's results from each site's next run, once it's shared. The i2i and sfs sites can be run again whenever the owner chooses: a real run, hands off.

## Choices for the owner to confirm

Made overnight from the recommendations, each easy to change:
1. axe runs before the first pass's first key on the first load (once `openPage` has put NVDA at the top), not after the passes. The page is as it loaded, and no Tab has moved focus.
2. The tags are voicecap's own tests': WCAG 2.0, 2.1, and 2.2 at A and AA, plus best practices. Each issue names its WCAG criterion, or "best practice".
3. Needs review (axe's "incomplete") is shown, under its own heading.
4. No option to turn axe off: it adds seconds to a page that takes about 90.
5. At most 50 elements a rule, and 300 characters (UTF-16 code units) of each element's HTML, to keep the page's size in hand.
6. The chip counts issues (violations); needs-review isn't in the chip.
7. A replayed run has no axe results; the replay driver doesn't carry them.

## Not included

- **Lighthouse,** or any score.
- **axe on the run's local report** (`report.html`). It gets the counts on each page's line only if a later plan asks.
- **Changing the verdict, the ring, or "What needs attention".**
- **Checking pages with axe outside a run** (a `voicecap axe` command).
