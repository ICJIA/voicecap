# The shareable report: a dated page and its Word copy, showing what the runs found and proving they ran

Design approved in conversation with the owner on 2026-09-30, then extended the same day at the owner's request: the human review first, every problem explained with its record, how voicecap works, how it came to be, and folds to keep the page quiet at first glance. For voicecap 0.6.0, after 0.5.0 (the demo and the Windows checks' fixes). A mockup built from the real records of the demo runs on 2026-09-29 is at https://claude.ai/artifact/ESwcXRQX7BHEDG5vwkC247 (private to the owner). Its parts those records can't show yet, such as the listener's statement and the reviews, are marked as samples. A throwaway script built it; it isn't in the repository.

## Why

The owner's request: reports detailed enough for a skeptical manager, or a state or federal auditor who is looking for holes, that show:
- that each NVDA (or, later, VoiceOver) run really happened as recorded;
- what the honest results were, failures and interruptions included, with nothing softened or left out.

voicecap is a human review, sped up. The person running it listens as NVDA reads each page, reads the transcripts, and fixes what they find. What voicecap does on its own is press the screen reader's keys, the way a person would, and move from page to page along the sitemap or a list of pages. Working from the list also makes the review more thorough than clicking through a site by hand: every page on the list is accounted for, and none is missed or done twice. So one person can spot-check a large site, zero in on the pages that need attention, or go through a whole small site.

The owner's manager wants two things: an automated check, such as axe or Lighthouse, and a person's listen-through with a real screen reader. voicecap is the listen-through, and the page has to make that plain: every word in it is what NVDA (or VoiceOver) said, and every decision in it is a person's. It must never read as if no person was involved.

When something goes wrong during a run, a reader has to be able to judge it: what happened, whose it was (another program on the computer, the screen reader, the browser, the website, or voicecap itself), whether it happened again, and the record of it, word for word. A manager, an auditor, or a lawyer should be able to tell a one-off interruption from a problem in voicecap.

voicecap already keeps an audit record that can be checked (`2026-09-27-audit-record-design.md`: seals, the review chain, `voicecap verify`, Git history). What's missing is something the owner can send to people who will never open that record, and more evidence of each run than the transcripts alone.

Success:
- The owner can send one file, a web page or a Word document, that a non-technical reader understands at a glance and an auditor can check to the byte.
- The page shows the person's review: that they listened, what they found, and what they fixed.
- Every problem during a run is explained with its record, and a reader can tell an interruption from a problem in voicecap.
- Every run records enough evidence to show it happened: who ran it, on what, minute by minute, with what was on screen, and NVDA's own record of what it said.

## What it is

- **A single, self-contained web page per site and date:** `dvfr.illinois.gov_2026-09-30.html`. Everything is inside it (styles, fonts, charts, screenshots, and transcripts), so it can be emailed and opened anywhere, offline.
  - It looks modern and infographic: big numbers, simple charts, dark by default, with a light theme that is also how it prints.
- **A Word copy** with the same name, date, and content: `dvfr.illinois.gov_2026-09-30.docx`. The owner can send either.
- **Its readers are mostly non-technical.** The page leads with plain language and puts technical detail lower down, where an auditor looks for it.
- **It's quiet at first glance.** Each section opens with a line that sums it up, and the detail is folded away under lines that say what's in them, a click away (see "What's open at first, and what's folded").

## The page, top to bottom

The mockup shows this order. Each section's first sentence is its point.

1. **The top.**
   - The site's name as the headline. It isn't its address.
   - A plain line: "How its pages read aloud with NVDA, a free screen reader, tested on <date>."
   - A second: "voicecap took NVDA through every page, pressing its keys the way a person would. Every word shown here is what NVDA said."
   - "As of <date>", "Prepared by <name>", and "Made with voicecap", linked to https://github.com/ICJIA/voicecap.
   - The site's address last, small.
   - NVDA links to https://www.nvaccess.org/.
   - Two buttons: "Open every section" and the theme.
2. **Summary**, written for a non-technical manager who reads nothing else. It's in plain words, with no jargon, all computed from the records, in this order:
   - **The result in one sentence**, leading with the person's review. For example: "Christopher Schweda listened as NVDA read all 7 pages, and reviewed every transcript. 1 page has problems a screen reader user would hear." Each part appears only as far as the records show it (see "The human review").
   - **A second line:** "A human review, sped up: voicecap pressed NVDA's keys and moved from page to page; a person did the listening, the reading, and the deciding."
   - **Six numbers:**
     - **pages in scope;**
     - **pages transcribed:** with transcripts in the standing;
     - **pages with flags,** and how many rules raised them;
     - **pages listened to live by a person;**
     - **lines NVDA spoke:** every step of every pass in the transcripts shown;
     - **NVDA time:** the total time the runs the standing draws on held NVDA, from their records.
   - **Four panels:**
     - **What needs attention:** each page with flags, failures, or issues a reviewer found, in one plain line about what a listener hears. For example: "Common mistakes: a search box and a button have no names, so NVDA says only 'edit' and 'button'; three links say only 'click here'; its first heading is level 2, not 1."
     - **How complete the test was:** pages read, out of pages in scope; the problems during the runs in one line (how many, of what kind, and whether a later try made each good); whether any was an unexpected error, the kind that could mean a problem in voicecap itself; and pages that couldn't be read after every attempt.
     - **What's still to do:** the real tasks: issues found and not yet fixed, pages that couldn't be read, and flagged pages with no decision recorded.
     - **When and how:** the date, who ran it, the screen reader, browser, and operating system.
   - **Three bars:**
     - each page's latest result: no flags, flags, or never transcribed;
     - flags by rule: how many times each rule was raised, in both passes;
     - the human review: pages listened to live, transcripts reviewed, and issues fixed, each out of its total.
   - **Read the full report:** links to each section below.

   The Word copy puts the same summary on its first page.
3. **How voicecap works.** Six steps, and a sample of what NVDA said on this site (see "Fixed text").
4. **Every page.** One card per page:
   - the page's screenshot, its path, and its title;
   - its status, flags, and the person's review ("Listened to live", "Reviewed, no issues", "Issue found", "Fixed"), each a chip that says it in words;
   - the pass counts (read lines, headings, Tab stops) and the page's time;
   - its spoken-line strip: one bar per line NVDA spoke, as wide as the line took and as tall as the square root of its length;
   - a link to its transcripts.
5. **What the flags found.** For each flagged page, one row per rule: what the rule found, and NVDA's own words quoted from the transcripts.
6. **What changed since the last run.** The pages that sound different from the run before, each with its changes (see "What changed since the last run").
7. **Problems during the runs.** Every failed attempt, explained (see "Problems during the runs").
8. **What these results cover.** Two panels:
   - **Covered:** the scope, the passes, and every problem, linked to where it's explained.
   - **Technical limits:** the screen reader, version, language, and browser the results come from, that flags match NVDA's English phrasing and the person reviewing decides what they mean, and any change of environment between runs.
9. **The evidence behind these results.** A line with the number of runs and whether each completed and was sealed; what a fingerprint is, in two plain sentences; the "Check the fingerprints" button (see "Checking the fingerprints in the page"); and the command that checks the originals. Then one folded panel per run the standing draws on, each with:
   - the run's facts (started, finished, pages, NVDA restarts, run by, and the listener's statement);
   - the minute-by-minute timeline, and every event to the millisecond as a table (evidence A);
   - NVDA's own log checked against the transcripts (evidence C);
   - the test environment (evidence D);
   - the fingerprints (SHA-256) and how to check them: `npx @icjia/voicecap verify --site <url>`.
   - the walkthrough file, to download, with the command that repeats the run (see "Repeating a walkthrough").
10. **How voicecap came to be.** Why it exists, its timeline on a Windows PC and on a Mac, and a few things worth knowing (see "Fixed text").
11. **Appendix: every transcript.** Per page: its screenshot, and its read, headings, and Tab transcripts word for word, each with its line count, size, and fingerprint.
12. **The footer.**
   - What voicecap is, with the link again: "voicecap is free, open-source software that speeds up a person's review of a website with a real screen reader. It presses the screen reader's keys the way a person would, moves from page to page on its own, and saves every word the screen reader says."
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

## The human review

voicecap speeds up a person's review. The page shows that review as the records show it, in three parts:

- **Listening, live:** the listener's statement (evidence F, new). When a session that read pages ends at a terminal, voicecap asks: "Did you listen as NVDA read these pages?" The answers are "Yes, all of them", "Part of them", and "No".
  - It's asked however the session ends: completed, after Ctrl+C, stopped after too many failed pages in a row, or ended by an error. After an error, one line says why the session stopped before the question, and the full explanation follows the answer.
  - Only an answer typed after the question appears counts: keys typed during the run, which wait in the terminal's input, are discarded before the question shows.
  - The session's end is written before the question. The session's record keeps the answer, and when voicecap asked and when it was answered, beside the session's reviewer (recorded from 0.5.0). The run's seal covers it.
  - It isn't asked without a terminal (a script, CI), or with the output redirected (to a file, say). Ctrl+C at the question (after an interrupted run, a second Ctrl+C) and a closed window give no answer. The page then says "not recorded".
  - On a Mac, it asks about VoiceOver.
- **Reading the transcripts, and deciding:** `voicecap review`'s entries, as today: "Reviewed, no issues", "Issue found" with its note, and "Fixed".
- **Fixing:** the "Fixed" entries, with their notes.

The page:
- says a person listened only where the statement says so: "Listened to live by <name>" for pages read in a session answered "Yes, all of them", and "<name> listened to part of this session" for "Part of them";
- leads with what the person did, never with what they haven't done. What's left appears once, as tasks, under "What's still to do";
- shows each count out of its total, so nothing looks complete that isn't.

## What changed since the last run

The owner asked whether a diff against the run before is information or clutter. It's information: after a fix or an upgrade, it shows exactly what a screen reader user now hears differently, and when nothing changed, it shows the same pages sound the same. It stays quiet by showing only what changed, folded.

- **The run before** is the most recent earlier completed, sealed run with the same page source, as `--compare previous` picks it, per page. voicecap already makes these diffs (`src/report/compare.ts`); the model reuses them.
- **The section opens with one line,** for example: "Compared with the run on 29 September: 3 of 7 pages sound different, and 4 sound exactly the same. Resolved: the 'click here' links on Common mistakes (generic-link-text)." When nothing changed: "Every page read in full in both runs sounds exactly the same."
- **Pages that sound the same** are counted, not shown. **Pages read in only one of the two runs** are listed, with the reason (new, no longer listed, or failed in one run).
- **Each page that sounds different** is folded behind one line: its path, how many lines changed in each pass, and any flags resolved or new. Opened, it shows each pass's changes:
  - removed lines and added lines, each marked in words ("Removed", "Added") as well as by color, with the changed words highlighted within a line;
  - runs of unchanged lines collapsed to a count ("12 lines the same");
  - the flags before and after: resolved, new, or unchanged.
- **When the two runs used different NVDA, browser, or voicecap versions,** the section says so first, since some differences may come from the tools rather than the site.
- **The summary** gets one line when there's a run before: "Since the last run on <date>: 3 pages sound different, and the 'click here' links on Common mistakes are fixed."
- **The Word copy** has the summary line and, per changed page, a table of removed and added lines.

## Problems during the runs

Every failed attempt in the runs the standing draws on appears, including those a later attempt made good. The section opens with its verdict line. For example: "2 problems, both outside voicecap: another window took the screen. Neither happened again. Neither was an unexpected error, the kind that could mean a problem in voicecap itself." Then each problem is folded behind one line: the run, the page, the time, what kind of problem, and whether it happened again.

Opened, each shows:
- **What happened:** the pass, the step, and the key, in plain words.
- **Which program** came to the front, for a foreground loss: its name, never its window title.
- **What voicecap did:** threw the step out, restarted NVDA and the browser, and tried again (attempt n of 5), or recorded the page as failed.
- **Did it happen again?** The verdict, below.
- **Effect on the results:** which attempt's transcripts are shown, and what the failed attempt left in `attempts/`.
- **The record of it, word for word:** a table of time, source, and entry, from:
  - the page's record in `run.json`;
  - the event log, from the attempt's start until the next attempt starts, or 10 seconds after the failure;
  - NVDA's own log's errors and warnings from that time, with their tracebacks (not its speech, which evidence C compares);
  - for an unexpected error, its stack trace.

  Paths show the home folder as `%USERPROFILE%` (or `~` on a Mac), so the account name isn't shown. The recorded files are unchanged.

**Kinds of problem.** A folded table, "How voicecap tells causes apart", explains them:

| Kind | Whose it is | What voicecap does, and what it means |
|---|---|---|
| Another window came to the front | Outside voicecap: another program, or someone at the computer | The step is thrown out, so the other window's speech never reaches a transcript, and the page is tried again. |
| The computer locked | Outside voicecap: Win+L, a screen saver, or a lock policy | As above. voicecap keeps the screen awake, but can't stop a lock. |
| NVDA stopped running | The screen reader | voicecap can't tell why. NVDA's own log from that moment is shown. |
| The browser stopped, or didn't start | The browser | Tried again with a fresh browser. |
| The website answered with an error | The website | A 5xx is tried again. A 4xx isn't, since trying again can't help. |
| The website couldn't be reached | The website or the network: the address didn't answer, the connection failed, or its certificate wasn't valid | Tried again. If it keeps failing, the site was down or couldn't be reached from this computer. |
| A step took too long | Not certain: the website, NVDA, the computer, or voicecap | Tried again. If it keeps happening on one page, that page and the record say more. |
| An unexpected error | Possibly voicecap itself | The full error, and where in voicecap's code it happened, are shown, with a link to report it (github.com/ICJIA/voicecap/issues). |
| Stopped by the person running it | The person: Ctrl+C, or closing the window | Not a failure. The page is read when the run resumes. |

**How the kind is decided:**
- voicecap's own errors carry a cause code: `foreground`, `locked`, `screen-reader-stopped`, `browser`, `http`, `unreachable`, `open-timeout`, `step-timeout`, or `page-timeout`. The drivers set the screen-reader ones in general terms, so the VoiceOver driver uses the same codes.
- Any other error is `unexpected`.
- In runs recorded before cause codes (0.5.0 and earlier), the kind comes from the error's wording, which voicecap itself wrote, and the page says so. Wording it doesn't recognize counts as unexpected.

**Did it happen again?**
- Read in full on a later attempt: "No: read in full on attempt n, with NVDA and the browser started fresh."
- Read in full in another run the standing draws on: "No: read in full in run <id>."
- Every attempt failed the same way: "Yes, on every attempt (n of n). That points to this page, or to voicecap, rather than a one-off." For the website's errors, it points to the website.
- Attempts failed in different ways: "Yes, in different ways", listing each.
- The verdict line also counts problems of the same kind across pages, naming each program that came to the front and how often.

**Runs from before this existed** have their errors as text, with attempt numbers (0.5.0) or without (0.4.1 and earlier). The page shows what's there, and says what the run didn't record, such as the program in front.

## What's open at first, and what's folded

The page is long, so most of it starts folded. Nothing is left out: every fold opens with a click, and the Word copy has everything unfolded.

- **Open:**
  - the top, the summary, and How voicecap works;
  - each section's heading and its one-line gist, with its numbers;
  - "What these results cover", the verdict line of the problems, and the verify command.
- **Folded, each behind a line that says what's inside:**
  - pages with nothing to note, when there are more than 12 pages ("The other 88 pages: nothing to note, all read in full"). Pages that need attention always show;
  - each flagged page's quotes, when more than 3 pages have flags;
  - each page that sounds different from the run before;
  - each problem, and the table of kinds;
  - each run's evidence, and within it the event table;
  - the rest of the background story, and the "worth knowing" cards;
  - each page's transcripts in the appendix.
- **Opening them:**
  - "Open every section", at the top, opens them all, and then folds them again;
  - printing opens them all first, and restores them after;
  - a link to something folded, such as a page card's "Transcripts and fingerprints", opens its fold;
  - Chrome's and Edge's find in page searches folded text too, and opens it.
- **Without JavaScript,** every fold still opens with a click or Enter. Printing then prints only what's open, so the Word copy is the complete paper version.
- **Accessibility:**
  - folds are `<details>` and `<summary>`, which screen readers announce as collapsed or expanded;
  - section headings are never inside a fold, so every section can be reached by heading;
  - a fold's summary line is never a heading, since some screen readers don't announce a heading inside one. Headings inside a fold start at level 3;
  - every scrolling box can be reached and scrolled with the keyboard, and has a name.

## Checking the fingerprints in the page

A manager will ask what the fingerprints are for, and whether they can check them. The page answers both.

**What a fingerprint is,** in the page's words, beside the fingerprints: "A fingerprint (SHA-256) is a code computed from a file's exact contents: change one character, and it changes completely. voicecap took one of every file as it wrote it, so a matching fingerprint shows the file hasn't changed since."

**"Check the fingerprints",** a button that works in one click, offline:
- It checks:
  - each transcript file in the page, against the fingerprint in its run's sealed record;
  - each run record's seal;
  - each review entry's seal, and the review chain.
- It shows a result line, for example "21 of 21 transcripts match their fingerprints, and both runs' seals check out", with a folded list of every file checked. A file that doesn't match is named, in red and in words.
- A second button, "Show a change being caught", runs the same check on a copy with one character changed, in memory only, so a reader can see a mismatch named. The page itself is never changed.
- The page carries what it checks: each transcript file's exact contents, and each run's record and review entries, as data. The check uses the browser's own SHA-256 (Web Crypto), or a small one built into the page where that isn't available. It recomputes a seal exactly as voicecap does: the record without its seal, as JSON with its keys sorted.

**What the check proves,** said beside its result: the page is consistent with itself, so the transcripts shown are exactly the ones the sealed records list. It can't prove the page itself wasn't changed, since whoever changed it could change the fingerprints too. The page names the two stronger checks:
- Compare this file's own fingerprint with the one the sender recorded. `voicecap share` prints it, ready to paste into the email that sends the file. `Get-FileHash <file>` in PowerShell, or `shasum -a 256 <file>` on a Mac, shows it for the file received.
- Run `npx @icjia/voicecap verify --site <url>` on the transcripts folder, which checks the originals.

**Without scripts,** the button is replaced by a line on how to check with those commands. **The Word copy** runs no scripts: it has the explanation, the fingerprints, and the two checks.

## Repeating a walkthrough

A walkthrough file lets anyone repeat a run exactly: an auditor checking the results, or the owner after a site's major upgrade. It's one JSON file (a recipe read as a whole, so not JSONL).

- **What it holds:**
  - `voicecapWalkthrough: 1`, its format's version;
  - the site, and every page in the order the run read it, with its label, template, and notes;
  - the passes, the step limits, the capture mode, and the readiness and screen reader settings that shape what's heard;
  - where it came from: the original run's id, seal, and dates; the voicecap, screen reader, and browser versions; and the page source, with the sitemap's or page list's fingerprint as read;
  - for each page and pass, the fingerprint of what the screen reader said in the original.
- **Getting one:** `voicecap walkthrough [--site <url>] [--run <id>] [--out <home>] <file>` writes it from any completed run, older ones too, since run records already hold all of it. The shareable report carries each run's walkthrough file as a download, with the command to repeat it.
- **Repeating it:** `npx @icjia/voicecap --walkthrough walkthrough.json [--reviewer <name>] [--out <home>]` makes a new run of the same pages, in the same order, the same three ways, with the same limits.
  - Options that would change what's read, such as `--sitemap`, `--limit`, or `--passes`, are refused alongside it.
  - It runs with NVDA today, and with VoiceOver once its driver exists. The NVDA settings then don't apply, and the new run records that the original used NVDA.
- **After the repeat,** voicecap compares each page with the original's fingerprints and says, page by page, "sounds the same" or "sounds different". It needs only the file for that. With the original run in the same home, `--compare <run>` shows the differences line by line, as "What changed since the last run" does.
- **What it can't promise:** the same pages, keys, and order, but not the same words. A changed site, a newer NVDA or browser, or a different screen reader changes what's said, and the run says which versions differ. With VoiceOver, the wording differs throughout, so a repeat shows the same pages were covered.
- **Tests,** in stage 1 with the scripted and replay drivers:
  - a run's walkthrough file, written and read back;
  - a repeat run reading exactly the listed pages, in order, with the same settings;
  - options that conflict with it, refused;
  - "sounds the same" and "sounds different" against the fingerprints;
  - a walkthrough file written from a run made before this existed.

## Fixed text: how voicecap works, and how it came to be

These two sections are the page's only prose not computed from the records, and they make no claim about any run's results. The text lives in one module, `src/share/text.ts`, which both renderers use. The owner reviews it before each release.

**How voicecap works:**
- **The lead:** automated checkers read a page's code and test it against rules. voicecap takes a real screen reader through each page the way a person would, and saves every word it says. It can spot-check a large site, zero in on the pages that need attention, or go through a whole small site. The person running it listens along, then reads the transcripts and fixes what they find. voicecap presses the keys and turns the pages, so the person can give the listening their full attention.
- **Six steps,** each with an icon:
  1. **Every page on the list:** from the sitemap, or a list of chosen pages (a CSV file). Each page is read once, in full, or listed with the reason it couldn't be. None is missed or done twice, an easy slip when clicking through a site by hand.
  2. **The real screen reader:** NVDA itself, never a simulation, with a fresh browser for every page.
  3. **Three ways through each page:** the keys a person presses to go line by line, heading by heading, and control by control.
  4. **Every word, and a check on every key:** each key press and everything the screen reader said, in order. Before and after every key press, voicecap checks that the page still has the screen. If it doesn't, the step is thrown out and the page tried again.
  5. **A person listens, reads, and fixes:** the person running voicecap listens as it reads, and says so when the run ends. Then they read the transcripts, record what they found, and fix it. Flags point to moments worth a second listen.
  6. **A sealed record:** every file gets a fingerprint and each run is sealed, so anyone can check that nothing has changed since.
- **Heard on this site,** which is computed, not fixed: the first three lines of each pass on the site's home page (or the first page in scope), from the transcripts shown, each with its time.
- **When to run it,** a bold band after the steps: "When to run voicecap: before the site goes live. And again after a major update. Screen reader users hear the deployed site, so that's the one to listen to." Then four stages, with the second marked:
  1. In development: not here, since builds change daily and aren't what users get.
  2. Before launch: run voicecap on the deployed site, as users will get it.
  3. Live: share the results, the report and the sealed record behind it.
  4. After a major update: run it again, on the same pages, compared with the run before.

  The README has the same recommendation and a diagram of the stages (`assets/when-to-run-voicecap.png`). The Word copy has the stages as a four-column table.
- The keys named, and the sample, come from the screen reader the section is about. For NVDA, they're Down Arrow, H, and Tab. VoiceOver's come with its driver.

**How voicecap came to be:**
- **Why it exists:** automated checkers find what a machine can test, but only part of the problems. Even by Deque's count (Deque makes axe), its automated tests found 57% of the issues in its audits: "Automated Testing Identifies 57 Percent of Digital Accessibility Issues", March 2021, over 2,000 audits and 13,000 pages, linked. And no checker can say what a page sounds like.
- **The usual answer,** a person with a screen reader, page by page, is slow, hard to show afterward, and hard to repeat.
- **voicecap's answer:** keep the person and the real screen reader, and take over the slow parts. Working from the list makes the review more thorough than going page by page by hand: every page is accounted for, none is missed or done twice, and each is heard the same way, with the same keys in the same order. voicecap is free and open source, from ICJIA (MIT license).
- **The timeline,** as a table with two tracks, a Windows PC with NVDA and a Mac with VoiceOver:
  - from the first line of code (25 September 2026) through each release;
  - including VoiceOver's first trial on a real Mac (28 September), and the Mac's setup, checks, and live test in 0.4.0 (29 September);
  - what isn't done yet, such as full runs with VoiceOver, is marked "Next", never shown as done;
  - its facts come from the Git tags and the CHANGELOG. A test checks every version and date in it against the CHANGELOG's release headings, and that every minor release (0.5.0, 0.6.0, and on) has its line, so a release can't ship without one;
  - when a major feature lands, merged or released, its line goes in the timeline, and the README says what it does, in the same change.
- **Six "worth knowing" cards:** the real screen reader; no page missed; nothing from other windows; tamper-evident; both kinds of testing (this page is checked with axe, with no violations); and tested itself (over a thousand tests on Windows, macOS, and Linux with every change).

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
  - **The person who ran it:** each session's reviewer, which runs record from 0.5.0: `--reviewer`, which `init` asks for, else `VOICECAP_REVIEWER`, `git config user.name`, or the config's `reviewer`.
  - **The operating system:** edition, version, and build (with its update revision), and architecture.
  - **The processor:** its name, base speed, physical cores, and logical processors.
  - **Memory, and the display:** the display's resolution, refresh rate, and scaling, and the browser window's fixed size.
  - **Time zone and language:** the time zone (all times are local), and the display language.
  - **Software:** the Node.js, voicecap, Guidepup, and Playwright versions.
  - **Screen reader and browser:** NVDA's version, build, language, and non-default settings, and the browser's version.
  - **Not recorded:** the computer's maker or model, the Windows account name, and the computer's name.
  - Each page's title, as the browser reports it, goes in its record too, for the headline's fallback and the page cards.
- **E. Each failed attempt,** in the page's record in `run.json`:
  - its number, and when it started and ended, to the millisecond;
  - the pass, the step, and the key;
  - the cause code, and the error's message;
  - the program in front, for a foreground loss;
  - the stack trace, for an unexpected error, with the home folder replaced;
  - whether NVDA and the browser were restarted before the next attempt.

  The pass keeps the error's cause, step, and stack for this. Today it keeps only the message.
- **F. The listener's statement,** in the session's record (see "The human review").

## Files, names, and the record of what was sent

In the site's folder of the transcripts home:

- **`share/current.html` and `share/current.docx`** are rewritten after every run, review, and manual session, and by `voicecap report`, as the site's `report.html` is today. They're always the latest.
- **`voicecap share [--site <url>] [--out <home>]`** writes the dated copies:
  - `share/<site>_<YYYY-MM-DD>.html` and `.docx` (`<site>` is the site's folder name); a second pair on the same day gets `-2`, then `-3`;
  - sent copies are never changed or deleted;
  - it prints both paths, their sizes, and their fingerprints, and warns when a file is over 20 MB, too big for most email;
  - it also prints a line to paste into the email that sends the files, with each file's name and fingerprint, so the people receiving them can check them.
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
- **Nothing is folded:** every section is there in full.
- **The steps, problems, and story:** How voicecap works has its steps as a numbered table and its sample as a three-column table. Each problem is a table, with its record in the fixed-width font. The story has its text, its timeline as a table, and its six cards as a list.
- **Made for paper:**
  - a light theme and US Letter pages;
  - real Word heading styles, so Word's navigation pane and accessibility checker work;
  - table header rows that repeat across pages, and alt text on every image;
  - the document's title, author (the preparer), and language (en-US) set.
- **Charts become tables:** the headline numbers, each page's latest result, flags by rule, and the human review, with counts and shares. The minute-by-minute chart becomes the event table. Screenshots are embedded as images.
- **Links:** "Made with voicecap" to GitHub, and NVDA to its makers' site.
- **Transcripts** go in an appendix, one section per page, in a fixed-width font, each with its fingerprint.
- **Built with `docx`** (MIT licensed), a new dependency, pinned exactly like voicecap's others.

## The website

A public site the owner can point anyone to, `icjia-voicecap.netlify.app` (approved 2026-09-30): every report voicecap has shared, by site and by date, with the demo. It's ICJIA's own site, not a setting for everyone who downloads voicecap. Netlify builds it from ICJIA's transcripts repository (github.com/ICJIA/voicecap-transcripts, private), the transcripts home, on every push. voicecap's own repository stays code only.

- **What's on it:**
  - the demo's latest report, as an example of what voicecap makes;
  - each site, with its newest report on top and its earlier ones below;
  - every report by date, across sites.

  Each report lists its date, who prepared it, and its files: the page to open, and the Word copy and the walkthrough file to download, so anyone can repeat the run exactly (see "Repeating a walkthrough"). Each file shows its size and SHA-256 fingerprint, a second place to check a copy against.
- **How it looks:** the report's design, dark by default with a light toggle, sleek, with a bar that stays in view for the three views: the demo, the sites, and every report by date.
- **`voicecap site [--home <dir>] [--out <dir>]`** builds it:
  - from each site folder's `share/shares.json` in the transcripts home (`--home`, default: the home in effect): the dated copies, sealed and fingerprinted. A copy that no longer matches its fingerprint is left out, and named;
  - from the demo's shared copies, when the home has a `voicecap-demo/` folder (run `voicecap demo` from the home's folder);
  - into `--out` (default `_site` in the home, which the home's `.gitignore` keeps out of Git): `index.html`, each report's files under `<site>/`, `robots.txt`, and `_headers`.

  The published files are byte for byte the shared copies, so their fingerprints still match. Everything the site adds goes in headers, never into those files.
- **Publishing:** after `voicecap share`, commit the transcripts home and push. Netlify runs `voicecap site` and publishes what it builds. To preview first, run `voicecap site` and open `_site/index.html`.
- **The Netlify files,** which `voicecap site` writes into the home the first time and never overwrites, as it does `.gitattributes`:
  - `netlify.toml`: the build, `npx --yes @icjia/voicecap@<the minor version that wrote it> site --home . --out _site`, and `publish = "_site"`; then headers for every file: `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a `Permissions-Policy` that turns off the camera, microphone, geolocation, payment, and USB, `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `Cross-Origin-Opener-Policy: same-origin`, and `Cross-Origin-Resource-Policy: same-origin`; and `Content-Disposition: attachment` for `.docx` and `.json` files. To build the site with a newer voicecap, change the version in the build command.
  - `.nvmrc`: `24`, so Netlify's build uses Node 24 and its bundled npm.
  - Each build writes `_site/robots.txt`: `User-agent: *`, then `Disallow: /`.
  - Each build writes `_site/_headers`: each page's Content Security Policy, `default-src 'none'; script-src 'sha256-…'; style-src 'sha256-…'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, with the hashes of that page's own scripts and style block. Each page was made by its own voicecap version, so each gets its own. For this to work, a page has no inline style attributes, only its one style block.
- **Search:** `robots.txt` and the noindex header keep the site out of search results. The transcripts repository is private, so the reports aren't on GitHub for anyone to find.
- **The first deploy,** once 0.6.0 is released with `voicecap site` and the home holds a shared report: in Netlify, import `ICJIA/voicecap-transcripts` from GitHub, and name the site `icjia-voicecap`. `netlify.toml` sets the rest.

## Rules the page follows

**Accessibility.** The page is an accessibility report, so it passes what it tests for:
- headings in order (the site's name, then sections, then items), landmarks, a skip link, and visible keyboard focus;
- contrast meeting WCAG 2.2 AA in both themes;
- no status shown by color alone: every chip says it in words;
- every chart with a text equivalent (a summary, or its numbers as a table), and alt text on every screenshot;
- complete without JavaScript. Its only scripts are the theme button, "Open every section", opening every fold for printing, opening a fold a link points into, and "Check the fingerprints". Without them, every fold still opens by hand;
- dark by default, light when switched, and light in print;
- folds as "What's open at first, and what's folded" describes;
- the fonts embedded: IBM Plex Sans, Sans Condensed, and Mono, Latin subsets, openly licensed (SIL Open Font License, whose text ships with voicecap), about 200 KB;
- axe run on the generated file in the tests: zero violations.

**Honesty:**
- voicecap is always a person's review with a real screen reader, sped up, never "automated testing" or an "automated checker".
  - What it does on its own is press the screen reader's keys and move from page to page.
  - Everything in the results is what the screen reader said, or what a person decided.
- The page says a person listened, reviewed, or fixed something only where the records say so, and it never leads with what a person hasn't done.
- Coverage is claimed for the list: every page on the list is accounted for. It's never "every page on the site", unless the list is the site's whole sitemap.
- Every page in scope appears. Failures appear with their reasons and their records, never hidden or softened.
- A problem's kind comes from its cause code or from voicecap's own wording, never from a guess. An error voicecap didn't expect is shown as possibly voicecap's own, with its stack trace.
- Every number is computed from the records, never typed, and traces to a file with its fingerprint.
- Unfinished, unsealed, and replayed runs never count toward the standing, and the page says what it left out.
- A run recorded before a kind of evidence existed says so in that place ("Not recorded: this run used voicecap 0.5.0"). It never leaves a silent gap or a blank that looks like a pass.
- Plain wording. Flags are rules that point a person to pages worth a closer listen, and the person reviewing decides what they mean.
- No claim of conformance (such as "meets WCAG") that the evidence doesn't show, and only technical limits.
- Stand-in data, as in the mockup, never appears in a real report.

## How it's built

**One evidence model, two renderers:**
- **`src/share/model.ts`:** reads a site's records (runs, transcripts, reviews, manual sessions, shares, and the new evidence) and builds the standing and each run's evidence, by the rules above. It's pure over what it's given, so it can be tested with fixture records. It reuses the report's readers and helpers (`src/report/`) where they fit.
- **`src/share/html.ts`:** the page, from the model. It uses the mockup's design, with inline styles and SVG, and embedded fonts from `src/share/fonts/`.
- **`src/share/problems.ts`:** each problem's kind, verdict, and record, and the verdict line. It's pure, like the model.
- **`src/share/text.ts`:** the fixed text, for both renderers.
- **`src/share/check.ts`:** the page's fingerprint check, the small script the page carries, with its built-in SHA-256.
- **`src/share/walkthrough.ts`:** writes a run's walkthrough file and reads one back; `runAudit` takes it as `walkthrough`, and `--walkthrough` on the command line.
- **`src/share/docx.ts`:** the Word copy, from the same model, with `docx`.
- **`src/share/share.ts`:** writes `current.*` and the dated copies, and appends to `shares.json`.
- **`src/verify.ts`:** gains the `shares.json` checks.

**What runs record:**
- **The event log:** a recorder the run passes to its driver, which appends to `events.jsonl`. The NVDA driver and the browser session report their events through it. The foreground program's lookup is a Windows helper in `src/drivers/guidepup/windows.ts`.
- **Screenshots:** `ChromeSession` takes them.
- **NVDA's log:** the NVDA driver turns it on through Guidepup's settings, collects it after each NVDA session, and cross-checks it (the cross-check itself isn't NVDA-specific).
- **The environment:** the readiness code's machine info extends into the run's environment record.
- **Failed attempts (E):** voicecap's own errors carry cause codes (`src/util/errors.ts`, the drivers' errors, and `StepTimeoutError`). A pass keeps its error's cause, step, and stack, and `processPage` records each attempt.
- **The listener's statement (F):** the CLI asks when a session ends, and the run records the answer in the session before the seal.

**CLI and API:**
- `voicecap share`, with `--site` and `--out` as `report` and `verify` take them.
- `voicecap walkthrough`, and `--walkthrough` on a run (see "Repeating a walkthrough").
- `shareReport(options)` and `writeWalkthrough(options)` join the programmatic API, and the CHANGELOG lists them.

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
  - axe with zero violations, with every fold closed and with every fold open;
  - nothing loaded from outside the file, and links only to voicecap's GitHub page and issues, NV Access, and Deque's study;
  - a size budget that fails the test if the embedded assets grow unexpectedly.
- The fingerprint check, in headless Chromium, on a page opened from a file:
  - everything matches on a page as generated;
  - changing one character in an embedded transcript, a run record, or a review entry makes it name that one;
  - "Show a change being caught" names the changed copy's file, and leaves the page as it was;
  - the built-in SHA-256 gives Node's results on test vectors.
- The folds, in headless Chromium:
  - which parts start folded, at 12 and 13 pages, and at 3 and 4 flagged pages;
  - no heading inside a summary line;
  - "Open every section", printing, and a link each opening what they should.
- What changed since the last run:
  - the run before, chosen as `--compare previous` chooses it;
  - the section's line, with pages the same counted and not shown, and pages read in only one run listed with their reason;
  - a changed page's removed and added lines marked in words, and its flags resolved and new;
  - the warning when the two runs' versions differ;
  - the demo runs of 29 September as a real case: every page read in full in both sounds exactly the same.
- Problems:
  - each kind, from cause codes, and from the wording of the demo runs' 0.4.1 records and of 0.5.0 records;
  - each verdict, and the verdict line;
  - the record of each, with the home folder replaced.
- Failed attempts (E), with the scripted driver: each attempt recorded with its cause, pass, step, and key; an unexpected error's stack; a pass keeping its error's cause.
- The human review:
  - the listener's question when a session ends at a terminal, after Ctrl+C too, and never without a terminal;
  - each answer recorded in the session and covered by the seal;
  - the page's wording for each answer and for none, and a summary that never leads with what's missing.
- The fixed text: every version and date in the timeline matches the CHANGELOG, every minor release has its line, and the Word copy has the same text.
- The Word copy opens (its XML parsed) with the right headings, tables, image alt text, and document properties.
- Sharing:
  - the file names, `-2`, and never overwriting;
  - `shares.json` sealed and chained;
  - `verify` catching an edited or missing sent file, and an edited entry.
- All of it runs in CI on Windows, macOS, and Linux.

**Stage 2:**
- Fake-desktop driver tests: the events and their order, a restart's reason, and the foreground program (through a fake lookup), in the event log and in the problem's "Which program".
- Headless Chromium: a page's screenshot is taken before the read pass and fingerprinted.
- A real NVDA log captured at the PC, kept as a fixture, for the parser and the cross-check: lines that agree, and lines only on one side.
- Real runs at the PC, with the owner's OK and the hands-off warning: the demo site first, then one page of a real site. They check each kind of evidence, and the page built from it.

## Stages and release

1. **Stage 1:**
   - the model, and the page with its folds, what changed since the last run, its problems section, the human review, and the fixed text;
   - the Word copy;
   - sharing: `current.*`, `voicecap share`, `shares.json`, and `verify`;
   - the walkthrough file: `voicecap walkthrough`, `--walkthrough`, and the report's download;
   - the website: `voicecap site`, and the `netlify.toml` and `.nvmrc` it writes into the transcripts home;
   - evidence D with page titles, E without the program in front, and F.

   Built and tested without a screen reader, so it can be done remotely. It merges to `main` when done, because it only adds.
2. **Stage 2:** evidence A (the event log and the foreground program, which also fills E's program), B (screenshots), and C (NVDA's own log and the cross-check). Built, then checked with real runs at the PC.
3. **Release as 0.6.0** once both stages pass.

## Facts to confirm at the PC

- **The listener's question after Ctrl+C:** that the terminal still takes an answer once voicecap has shut NVDA down and given the owner's NVDA back.
- **Keys typed during the run don't answer the question:** that Enter and a number, pressed while the run goes on (with the terminal in front, or not), are dropped, and the question waits for an answer typed after it appears.
- **Closing the window at the question:** for an interrupted run, that the session's end is in `run.json` with no statement; for a completed run, that the run is sealed, with its session ended and no statement.
- **A voicecap Chrome window closed mid-page:** that the page's attempt records `browser`, not `unexpected`.

Before stage 2's C:

- **How to turn NVDA's log on:** can voicecap set NVDA's log level (to input/output) through Guidepup's start settings (`nvdaSettings`), as it sets NVDA's other settings? This uses NVDA's own setting through Guidepup's supported path. If Guidepup doesn't allow it, the owner decides before anything works around it.
- **Where Guidepup's portable NVDA writes its log,** and whether each NVDA restart starts a new one.
- **Whether logging at that level changes NVDA's timing** enough to change transcripts, by comparing a run with it on and off on the demo site.
- **The foreground program's lookup:** the Windows call that names the program behind the window in front, checked against a real window taking the foreground.

## Not included

- Charts drawn as pictures in the Word copy (a later option: render them with the browser voicecap already runs).
- A PDF (Chrome could print the page; a later option).
- Comparing with the last copy sent.
- Digital signatures on the files; Git's signed commits already exist for that.
- Emailing the files. Hosting them is "The website".
- Detecting a person's key presses during a run. It would take a system-wide keyboard hook, which security software treats as a keylogger.
- Window titles on the page. The event log keeps them; the page shows only the program's name.
- Recording the listener's statement later. It's asked when the session ends, or not at all, since a statement made afterward is weaker evidence.
- **axe's findings beside voicecap's, as a possible later addition.**
  - axe would run on the same page load as the read pass, before NVDA reads.
  - Per page, the page would show what both found, what only listening found (such as "click here" links, which pass axe), and what only axe found (such as color contrast), naming each axe rule's WCAG criterion.
  - It would never be a score: axe isn't the answer key, and the two check different things.
  - voicecap's tests already drive axe (`test/helpers/axe.ts`), but runs and reports don't use it.
- VoiceOver's evidence, which comes with the VoiceOver driver, in the same layout.
