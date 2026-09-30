# The shareable report: a dated page and its Word copy, showing what the runs found and proving they ran

Design approved in conversation with the owner on 2026-09-30. For voicecap 0.6.0, after 0.5.0 (the demo and the Windows checks' fixes). A mockup built from the real records of the demo runs on 2026-09-29 is at https://claude.ai/artifact/ESwcXRQX7BHEDG5vwkC247 (private to the owner). A throwaway script built it; it isn't in the repository.

## Why

The owner's request: reports detailed enough for a skeptical manager, or a state or federal auditor who is looking for holes, that show:
- that each NVDA (or, later, VoiceOver) run really happened as recorded;
- what the honest results were, failures and interruptions included, with nothing softened or left out.

voicecap already keeps an audit record that can be checked (`2026-09-27-audit-record-design.md`: seals, the review chain, `voicecap verify`, Git history). What's missing is something the owner can send to people who will never open that record, and more evidence of each run than the transcripts alone.

Success:
- The owner can send one file, a web page or a Word document, that a non-technical reader understands at a glance and an auditor can check to the byte.
- Every run records enough evidence to show it happened: who ran it, on what, minute by minute, with what was on screen, and NVDA's own record of what it said.

## What it is

- **A single, self-contained web page per site and date:** `dvfr.illinois.gov_2026-09-30.html`. Everything is inside it (styles, fonts, charts, screenshots, and transcripts), so it can be emailed and opened anywhere, offline.
  - It looks modern and infographic: big numbers, simple charts, dark by default, with a light theme that is also how it prints.
- **A Word copy** with the same name, date, and content: `dvfr.illinois.gov_2026-09-30.docx`. The owner can send either.
- **Its readers are mostly non-technical.** The page leads with plain language and puts technical detail lower down, where an auditor looks for it.

## The page, top to bottom

The mockup shows this order. Each section's first sentence is its point.

1. **The top.**
   - The site's name as the headline. It isn't its address.
   - A plain line: "How its pages read aloud with NVDA, a free screen reader, tested on <date>."
   - "As of <date>", "Prepared by <name>", and "Made with voicecap", linked to https://github.com/ICJIA/voicecap.
   - The site's address last, small.
   - NVDA links to https://www.nvaccess.org/.
2. **At a glance.**
   - A plain summary sentence.
   - Six numbers:
     - **pages in scope;**
     - **pages transcribed:** with transcripts in the standing;
     - **pages with flags,** and how many rules raised them;
     - **pages reviewed by a person:** those whose latest review is "Reviewed, no issues", "Issue found", or "Fixed";
     - **lines NVDA spoke:** every step of every pass in the transcripts shown;
     - **NVDA time:** the total time the runs the standing draws on held NVDA, from their records.
   - Three bars:
     - each page's latest result: no flags, flags, or never transcribed;
     - flags by rule: how many times each rule was raised, in both passes;
     - review by a person: "Reviewed, no issues", "Issue found", "Fixed", and "Not reviewed yet".
3. **Every page.** One card per page:
   - the page's screenshot, its path, and its title;
   - its status, flags, and review, each a chip that says it in words;
   - the pass counts (read lines, headings, Tab stops) and the page's time;
   - its spoken-line strip: one bar per line NVDA spoke, as wide as the line took and as tall as the square root of its length;
   - a link to its transcripts.
4. **What the flags found.** For each flagged page, one row per rule: what the rule found, and NVDA's own words quoted from the transcripts.
5. **What these results cover.** Two panels:
   - **Covered:** the scope, the passes, and every failure with its reason.
   - **Technical limits:** the screen reader, version, language, and browser the results come from, that flags match NVDA's English phrasing and a person's review decides what they mean, and any change of environment between runs.
6. **The evidence behind these results.** One panel per run the standing draws on, each with:
   - the run's facts (started, finished, pages, NVDA restarts, run by);
   - the minute-by-minute timeline, and every event to the millisecond as a table (evidence A);
   - NVDA's own log checked against the transcripts (evidence C);
   - the test environment (evidence D);
   - the fingerprints (SHA-256) and how to check them: `npx @icjia/voicecap verify --site <url>`.
7. **Appendix: every transcript.** Per page: its screenshot, and its read, headings, and Tab transcripts word for word, each with its line count, size, and fingerprint.
8. **The footer.**
   - What voicecap is, in one line, with the link again.
   - When the page was generated, and the time zone its times are in.
   - The file's own name and its Word copy's.

**The site's name** comes from a new setting, `report.siteName`. Without it, the home page's title as the run recorded it is used. Without that, the site's host name.

## The site's standing

- **The pages:** those in the site's most recent completed run.
  - Pages that earlier runs tested but the latest page list no longer has go in a small separate table, "No longer listed".
- **Each page's result:** its most recent transcription in a completed run.
  - A page whose latest attempt failed shows that failure, with its reason, next to its last good transcripts and the run they came from.
  - A page never transcribed counts as such, in red.
- **Only sealed, live runs count.** That means completed runs, which `verify` can check.
  - Interrupted and unfinished runs are listed with what they did, but their transcripts aren't used.
  - Replayed runs never count as live results.
  - The page says when it left any out.
- **Reviews:** each page's latest review up to the page's date: its status, reviewer, date, and note. A page whose transcript changed after its review says so. Manual NVDA sessions are listed on their page.
- **Flags:** computed from the transcripts shown, with the current rules. The rules' fingerprint is part of the evidence.
- **More than one environment:** when the runs used different NVDA, browser, or voicecap versions, the "Technical limits" panel names each change (`compare.ts` already works these out).
- **One standing per screen reader:** a site tested with NVDA and VoiceOver gets a section for each, never merged, since they speak differently. Until VoiceOver runs exist, every page has the one section.

## New evidence each run records

Everything below goes in the run's folder. Each file's SHA-256 is recorded in `run.json`, so the run's seal covers it, and `voicecap verify` checks it, as it checks transcripts today.

- **A. The event log (`events.jsonl`).** One line per event, to the millisecond, written as the run goes, so a closed window still leaves everything up to that moment. The events:
  - the run starting and ending (with its end reason); the NVDA lock taken and released;
  - the screen reader starting, stopping, and restarting (with process IDs and each restart's reason);
  - the person's own screen reader shut down and started again;
  - each browser launched and closed, including a Chrome hand-over;
  - each page starting, finishing, or failing; Windows found locked.
  - **The foreground program:** when the browser loses the foreground, the event names the program that took it (for example, "Microsoft Teams") and keeps its window title.
    - The shared page shows only the program, never the title, which can hold private text such as an email subject.
  - Event types are general ("screen reader started", "browser closed"). The NVDA details stay in the NVDA driver, and the VoiceOver driver will record its own.
- **B. Screenshots.** One per page, `pages/<slug>/screenshot.jpg`:
  - taken as the page finishes loading, before NVDA reads it;
  - taken through the browser's DevTools connection, so it never takes focus;
  - 640 × 480 (half the 1280 × 960 window), JPEG, about 25 KB.
- **C. NVDA's own log.** While voicecap runs NVDA, NVDA logs everything it says. voicecap keeps a copy per NVDA session (`nvda-log/<session>.txt`) and compares its speech with the transcripts, line by line.
  - The page shows how many lines agree and lists any that don't, in either direction.
  - The parsing builds on voicecap's NVDA-log import for manual sessions (`src/manual/nvda-log.ts`).
  - VoiceOver keeps no such log, as far as we know. For Mac runs the page will say this check is NVDA-only; the VoiceOver driver confirms it.
- **D. Who and what.** Recorded when the run starts, in the run's environment record:
  - **The person who ran it:** the name, taken as reviews take it (`resolveReviewer`: `--reviewer`, then `VOICECAP_REVIEWER`, then the reviewer setting, then `git config user.name`).
  - **The operating system:** edition, version, and build (with its update revision), and architecture.
  - **The processor:** its name, base speed, physical cores, and logical processors.
  - **Memory, and the display:** the display's resolution, refresh rate, and scaling, and the browser window's fixed size.
  - **Time zone and language:** the time zone (all times are local), and the display language.
  - **Software:** the Node.js, voicecap, Guidepup, and Playwright versions.
  - **Screen reader and browser:** NVDA's version, build, language, and non-default settings, and the browser's version.
  - **Not recorded:** the computer's maker or model, the Windows account name, and the computer's name.
  - Each page's title, as the browser reports it, goes in its record too, for the headline's fallback and the page cards.

## Files, names, and the record of what was sent

In the site's folder of the transcripts home:

- **`share/current.html` and `share/current.docx`** are rewritten after every run, review, and manual session, and by `voicecap report`, as the site's `report.html` is today. They're always the latest.
- **`voicecap share [--site <url>] [--out <home>]`** writes the dated copies:
  - `share/<site>_<YYYY-MM-DD>.html` and `.docx` (`<site>` is the site's folder name); a second pair on the same day gets `-2`, then `-3`;
  - sent copies are never changed or deleted;
  - it prints both paths, their sizes, and their fingerprints, and warns when a file is over 20 MB, too big for most email.
- **`share/shares.json` is the record of what was sent.** Each `share` adds an entry, never rewritten, holding:
  - `seq`, `prev`, and `seal`, chained and sealed as reviews are;
  - the date and time, and who made it;
  - the runs it drew on;
  - each file's name, size, and SHA-256.

  A page can't carry its own fingerprint, so this record carries it. Anyone can later check that a copy someone holds is exactly what was sent.
- **`voicecap verify`** also checks `shares.json`: each entry's seal, the chain, and that each sent file still matches its recorded size and SHA-256. A missing sent file is a problem. `current.*` isn't checked, being regenerated.
- **Git:** the home's `.gitattributes` (`* -text`) already keeps Git from changing any file's bytes, so sent copies stay identical. Sent copies and `shares.json` go into Git with the rest of the record.

## The Word copy

- **Same content:** the same sections, order, and numbers, built from the same model, so the two can't disagree.
- **Made for paper:**
  - a light theme and US Letter pages;
  - real Word heading styles, so Word's navigation pane and accessibility checker work;
  - table header rows that repeat across pages, and alt text on every image;
  - the document's title, author (the preparer), and language (en-US) set.
- **Charts become tables:** the headline numbers, each page's latest result, flags by rule, and review status, with counts and shares. The minute-by-minute chart becomes the event table. Screenshots are embedded as images.
- **Links:** "Made with voicecap" to GitHub, and NVDA to its makers' site.
- **Transcripts** go in an appendix, one section per page, in a fixed-width font, each with its fingerprint.
- **Built with `docx`** (MIT licensed), a new dependency, pinned exactly like voicecap's others.

## Rules the page follows

**Accessibility.** The page is an accessibility report, so it passes what it tests for:
- headings in order (the site's name, then sections, then items), landmarks, a skip link, and visible keyboard focus;
- contrast meeting WCAG 2.2 AA in both themes;
- no status shown by color alone: every chip says it in words;
- every chart with a text equivalent (a summary, or its numbers as a table), and alt text on every screenshot;
- complete without JavaScript: the theme button is its only script, and the page is dark by default, light when switched, and light in print;
- the fonts embedded: IBM Plex Sans, Sans Condensed, and Mono, Latin subsets, openly licensed (SIL Open Font License, whose text ships with voicecap), about 200 KB;
- axe run on the generated file in the tests: zero violations.

**Honesty:**
- Every page in scope appears. Failures appear with their reasons, never hidden or softened.
- Every number is computed from the records, never typed, and traces to a file with its fingerprint.
- Unfinished, unsealed, and replayed runs never count toward the standing, and the page says what it left out.
- A run recorded before a kind of evidence existed says so in that place ("Not recorded: this run used voicecap 0.5.0"). It never leaves a silent gap or a blank that looks like a pass.
- Plain wording. Flags are rules that point a person to pages worth a closer listen, and a person's review decides what they mean.
- No claim of conformance (such as "meets WCAG") that the evidence doesn't show, and only technical limits.
- Stand-in data, as in the mockup, never appears in a real report.

## How it's built

**One evidence model, two renderers:**
- **`src/share/model.ts`:** reads a site's records (runs, transcripts, reviews, manual sessions, shares, and the new evidence) and builds the standing and each run's evidence, by the rules above. It's pure over what it's given, so it can be tested with fixture records. It reuses the report's readers and helpers (`src/report/`) where they fit.
- **`src/share/html.ts`:** the page, from the model. It uses the mockup's design, with inline styles and SVG, and embedded fonts from `src/share/fonts/`.
- **`src/share/docx.ts`:** the Word copy, from the same model, with `docx`.
- **`src/share/share.ts`:** writes `current.*` and the dated copies, and appends to `shares.json`.
- **`src/verify.ts`:** gains the `shares.json` checks.

**What runs record:**
- **The event log:** a recorder the run passes to its driver, which appends to `events.jsonl`. The NVDA driver and the browser session report their events through it. The foreground program's lookup is a Windows helper in `src/drivers/guidepup/windows.ts`.
- **Screenshots:** `ChromeSession` takes them.
- **NVDA's log:** the NVDA driver turns it on through Guidepup's settings, collects it after each NVDA session, and cross-checks it (the cross-check itself isn't NVDA-specific).
- **The environment:** the readiness code's machine info extends into the run's environment record.

**CLI and API:**
- `voicecap share`, with `--site` and `--out` as `report` and `verify` take them.
- `shareReport(options)` joins the programmatic API, and the CHANGELOG lists it.

**Config:** `report.siteName`, optional.

## Tests

**Stage 1:**
- The standing rules, on fixture records:
  - the latest result, and a failed page falling back to its last good transcripts;
  - a page never transcribed, and "no longer listed";
  - unfinished, unsealed, and replayed runs left out;
  - the latest review, "changed since review", and more than one environment.
- The page:
  - its sections in order, every page present, and the numbers matching the model;
  - no status by color alone;
  - axe with zero violations;
  - nothing external except its two links;
  - a size budget that fails the test if the embedded assets grow unexpectedly.
- The Word copy opens (its XML parsed) with the right headings, tables, image alt text, and document properties.
- Sharing:
  - the file names, `-2`, and never overwriting;
  - `shares.json` sealed and chained;
  - `verify` catching an edited or missing sent file, and an edited entry.
- All of it runs in CI on Windows, macOS, and Linux.

**Stage 2:**
- Fake-desktop driver tests: the events and their order, a restart's reason, and the foreground program (through a fake lookup).
- Headless Chromium: a page's screenshot is taken before the read pass and fingerprinted.
- A real NVDA log captured at the PC, kept as a fixture, for the parser and the cross-check: lines that agree, and lines only on one side.
- Real runs at the PC, with the owner's OK and the hands-off warning: the demo site first, then one page of a real site. They check each kind of evidence, and the page built from it.

## Stages and release

1. **Stage 1:** the model, the page, the Word copy, sharing (`current.*`, `voicecap share`, `shares.json`, `verify`), and evidence D with page titles. Built and tested without a screen reader, so it can be done remotely. It merges to `main` when done, because it only adds.
2. **Stage 2:** evidence A (the event log and the foreground program), B (screenshots), and C (NVDA's own log and the cross-check). Built, then checked with real runs at the PC.
3. **Release as 0.6.0** once both stages pass.

## Facts to confirm at the PC before stage 2's C

- **How to turn NVDA's log on:** can voicecap set NVDA's log level (to input/output) through Guidepup's start settings (`nvdaSettings`), as it sets NVDA's other settings? This uses NVDA's own setting through Guidepup's supported path. If Guidepup doesn't allow it, the owner decides before anything works around it.
- **Where Guidepup's portable NVDA writes its log,** and whether each NVDA restart starts a new one.
- **Whether logging at that level changes NVDA's timing** enough to change transcripts, by comparing a run with it on and off on the demo site.
- **The foreground program's lookup:** the Windows call that names the program behind the window in front, checked against a real window taking the foreground.

## Not included

- Charts drawn as pictures in the Word copy (a later option: render them with the browser voicecap already runs).
- A PDF (Chrome could print the page; a later option).
- Comparing with the last copy sent.
- Digital signatures on the files; Git's signed commits already exist for that.
- Emailing or hosting the files.
- VoiceOver's evidence, which comes with the VoiceOver driver, in the same layout.
