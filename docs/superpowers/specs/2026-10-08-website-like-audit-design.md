# The website, like audit.icjia.app: its look, two bars, Technical details, and What's New

## Why

On 2026-10-08 the owner asked:

> "please also add a 'technical details' page like audit.icjia.app (https://audit.icjia.app/technical-details). Add a bottom status bar with the trust link, the technical details, a what's new link, a version number, changelog, and a link to the github repo. I want the web part of this app to look as much like web app of audit.icjia.app. This may need its own phase -- that's fine."

The same day, they chose:
- the website's own pages, with the shared reports keeping their look;
- to build it after the trust page (0.13.2) and the replay (0.14.0), as 0.15.0;
- a What's New page made from the CHANGELOG.

They approved this design in chat the same day ("Yes, write the spec"), with three more answers:
- "ICJIA Screen Reader Tests" as the website's name in its bar;
- Guidepup named in the Technical details page's toolchain table;
- a What's New banner on the front page, with a link to every update.

The reference is the audit tool as it was on 2026-10-08: its pages (/, /trust, /technical-details, /announcements), and its source, github.com/ICJIA/file-accessibility-audit (apps/web/app/assets/css/main.css, layouts/default.vue, pages/).

## What it is

`voicecap site` builds four pages. Each is one self-contained file under its own Content Security Policy, at its `.html` address and the one without it:

| Page | File | Addresses |
| --- | --- | --- |
| The front page, "Screen reader test results" | `index.html` | `/`, `/index.html` |
| Can I trust this? (0.13.2) | `trust.html` | `/trust`, `/trust.html` |
| Technical details (new) | `technical-details.html` | `/technical-details`, `/technical-details.html` |
| What's New (new) | `whats-new.html` | `/whats-new`, `/whats-new.html` |

All four share the audit tool's look, a top bar, and a bottom bar.

**What doesn't change:**
- **Each shared report,** the demo's included, is the page voicecap wrote when it was shared, and keeps its look.
- **The front page** keeps its views, sites, reports, and links. What it gains is the kicker, the What's New banner, and the "On this page" row (below).
- **The website's rules hold on every page:**
  - one file a page, with one style block and one script, and no `style` attribute;
  - a policy made from the page's own hashes;
  - dark first, with a switch to light, and light in print;
  - headings in order, landmarks, a skip link, and visible keyboard focus;
  - complete without JavaScript;
  - axe with no violations in both themes at 1280, 390, and 320 pixels;
  - nothing wider than a 320-pixel window;
  - every page a pure function of the package and the records, so the same records build the same bytes.

## The look

As the audit tool's:
- a near-black page, with its main part in one centered column;
- a small, spaced-out line in capitals (the kicker) over a very heavy headline, then a quieter lead;
- cards with thin borders and rounded corners;
- a line between the parts of a page;
- big numbers in a fixed-width font.

### Type

- **The system's own fonts,** as the audit tool uses:
  - words: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
  - big numbers, fingerprints, and commands: `ui-monospace, "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace`, with figures of one width.
- **The website's pages stop embedding the IBM Plex fonts.** That makes each page about 240 KB smaller (the nine faces' files are 184 KB, and more as base64), and its policy allows no font from anywhere. The shared reports keep IBM Plex.
- **Headlines are at weight 900,** which is Segoe UI Black on Windows, and kickers at 700.
- **Sizes:**
  - body text 1.0625rem, 17 pixels at the browser's own size, as the audit tool's;
  - a lead `clamp(1rem, 2vw, 1.1875rem)`;
  - a kicker 0.8125rem;
  - a page's h1 `clamp(2.125rem, 6vw, 3.875rem)`, with a line height of 1.05;
  - a part's h2 `clamp(1.625rem, 4.2vw, 2.5rem)`.

### Color

The website gets its own tokens, from the audit tool's. The shareable page's theme stays as it is.

| Token | Dark (first) | Light | For |
| --- | --- | --- | --- |
| `--bg` | `#0a0a0a` | `#f9fafb` | the page |
| `--panel` | `#111111` | `#ffffff` | cards, the banner |
| `--panel-2` | `#141414` | `#f3f4f6` | a table's header, a card in a card |
| `--line` | `#222222` | `#e5e7eb` | borders, the line between parts |
| `--heading` | `#ffffff` | `#111827` | headlines, the website's name |
| `--text` | `#f5f5f5` | `#1f2937` | the words |
| `--text-2` | `#d4d4d4` | `#374151` | a card's words |
| `--muted` | `#a3a3a3` | `#4b5563` | kickers, leads, both bars' links |
| `--link` | `#60a5fa` | `#2563eb` | links, which are underlined |
| `--good` | `#34d399` | `#196549` | nothing needs attention; a headline's second line; big numbers |
| `--warn` | `#fbbf24` | `#705510` | needs attention; the trust page's stamp |
| `--bad` | `#f87171` | `#8b3f3f` | not read |
| `--act` | `#67e8f9` | `#2c626a` | the words that matter in a kicker; a big number |

Each of the four colors after `--link` also has a tint, at 12%, for what sits behind a pill or a box.
- **The light colors** are the audit tool's own, which its makers darkened until each passed 4.5 to 1 against its own tint.
- **axe decides,** in both themes, on every page.
- **The verdicts' colors map to these:** green to `--good`, amber to `--warn`, and red to `--bad`.

### Layout

- **The bars** run the window's width, with what's in them in a column of 72rem.
- **The main part** is a column of 56rem (the audit tool's `max-w-6xl` and `max-w-4xl`).
- **The gutter** is 16 pixels on a phone and 24 from 40em.

### The parts

- **A kicker:**
  - 0.8125rem, weight 700, letter-spacing 0.14em, in `--muted`;
  - in capitals, set by the style: it's written in ordinary case, so a screen reader reads words and not letters;
  - the words that matter in it are in `--act`.
- **A headline** is at weight 900, in `--heading`. A page's h1 may have a second line in `--good`, as the trust page's "See for yourself." does.
- **A lead** is in `--muted`, at most 64 characters a line.
- **A card** has `--panel` behind it, a 1px border in `--line`, corners of 14 pixels, and 22 by 20 pixels inside.
- **A part of a page** has 44 pixels above and below it, and a line between it and the part before.
- **A pill** is small, in capitals, at weight 700, in its color on its color's tint, with corners of 6 pixels.
- **A big number:**
  - weight 900, in the fixed-width font, in a color of its own;
  - sized to its card, not the window, as the audit tool's (`clamp(1.5rem, 17cqi, 2.375rem)`), so a long number never runs out of its card.
- **A table:**
  - its header row is small, in capitals, in `--muted`, on `--panel-2`, and lines divide its rows;
  - a table wider than a phone scrolls in its own box, which can take focus and is named by the table's heading, so the page itself is never wider than 320 pixels.
- **A button,** such as a report's "Open" or a site's "Visit the site", is an outline in `--line`, with words in `--heading` on `--panel`.

## The top bar

Every page has it, and it scrolls with the page, as the audit tool's does. It's no longer sticky, so the 0.13.2 room kept clear of it (`scroll-padding-top`) goes too.

- **Left: the website's name, "ICJIA Screen Reader Tests":**
  - a link to the front page, in `--heading`, at weight 600;
  - on the front page, it's the page the reader is on, and says so (`aria-current="page"`).
- **Right: a navigation, "This website":**
  - **Its three links,** in `--muted`, turning `--heading` under the pointer: "Can I trust this?", "What's New", and "Technical details".
  - **The page the reader is on:** its link has `aria-current="page"`, and is drawn in `--heading`, bold, and underlined more heavily than the others, so it's told apart by more than its color.
  - **Then the theme button, an icon:**
    - a sun in the dark theme, a moon in the light one;
    - its words are for a screen reader ("Switch to the light theme");
    - it's hidden until the script shows it, as today, so without JavaScript there's no button that does nothing.
- **On a narrow window,** the name takes a line of its own, and the links wrap under it.
- **The front page's view links leave the bar.** "The demo", "The sites", and "Every report, by date" become the front page's "On this page" row.
- **There's no status light.** The audit tool shows its server's; the website has no server.

## The bottom bar

Every page ends with it, in place of the footer's two lines ("what voicecap is" and "made with voicecap").

- **Its look:** a line above it, then one centered row of six items, each an icon and its words, small (0.875rem) and in `--muted`.
- **Its dividers** are thin lines drawn by the style, so a screen reader hears a list of six and no dividers.
- **The six items:**
  1. GitHub (GitHub's mark): `https://github.com/ICJIA/voicecap`.
  2. Changelog (a list): the CHANGELOG on GitHub, `https://github.com/ICJIA/voicecap/blob/main/CHANGELOG.md`.
  3. What's New (a megaphone): `whats-new.html`.
  4. Can I trust this? (a shield with a check): `trust.html`.
  5. Technical details (a terminal's window): `technical-details.html`.
  6. The version, `v0.15.0`, as plain text.
- **The version** is the one of the voicecap that built the website, from its `package.json`. A screen reader hears "voicecap version 0.15.0".
- **Its icons** are hidden from screen readers.
- **Its links open in the same tab,** with no arrow, as the audit tool's GitHub and Changelog do.
- **The page the reader is on** has `aria-current="page"` here too, drawn as in the top bar.
- **On a phone,** the row wraps, centered.

## The front page

In order:
1. **The kicker:** "ICJIA · Built for Title II of the ADA · WCAG · Illinois IITAA", with the three names in `--act`, as the audit tool's trust page heads itself.
2. **The h1,** "Screen reader test results", and its lead, as today.
3. **The What's New banner:** see below.
4. **"On this page":** a row of links to the views that are there ("The demo", "The sites", "Every report, by date").
5. **The views,** in the new look. The 0.13.1 pictures and big numbers stay; their colors are the new tokens.
   - **Each view's heading** is a card, with its picture in a circle, the h2 at weight 900, and its count as a big number in `--good`.
   - **Each site:**
     - its picture, its name, and "Visit the site" as a button;
     - its current report in a card, with the verdict's pill and the bar of the pages NVDA read in the verdict's color;
     - its earlier reports under it.

### The What's New banner

- **Where:** between the lead and "On this page". It comes after the h1, so a screen reader meets the page's heading first. The audit tool puts its banner above everything.
- **What it holds,** in a card:
  - "What's new", as a kicker;
  - the newest release's version as a pill in `--good`;
  - its headline;
  - "Released 8 October 2026 · See all updates", with "See all updates" a link to `whats-new.html`.
- **It isn't dismissible.** Dismissing it would need storage, and it's short and always current.
- **A build whose CHANGELOG records no release** (a developer's) has no banner.

## Can I trust this?

The 0.13.2 page, in the new look, with its words unchanged except where noted:
- **The heading:** its kicker over a headline of two lines, "Built to be checked." in `--heading` and "See for yourself." in `--good`, as the audit tool's.
- **The stamp** becomes the audit tool's amber box:
  - a label at its left, which says where the numbers come from;
  - the records' date, big, at its right, in `--warn`;
  - the 0.13.2 stamp's words, divided between the two.
- **The four big numbers** are in tiles, in the fixed-width font, in the colors the audit tool's tiles use (`--good`, `--good`, `--act`, and `--warn`): one a row on a phone, two from 36em, four from 60em.
- **Each part** has a kicker over a heavy h2. Its cards have the card look, and the law's tags are pills.
- **"How it got here"** shows the newest five releases, then "See all N releases" (a link to `whats-new.html`), where 0.13.2 folded away the rest.
- **"Back to the test results"** opens the page (see Technical details).

## Technical details

`technical-details.html` is the technical reference, for auditors and developers, in the shape of the audit tool's technical page.

### The top of the page

1. **"Back to the test results":** a link to the front page, after a back arrow, as the audit tool's technical page opens with "Back". The trust page and What's New open with it too.
2. **The kicker,** "Technical details", and the h1, "How voicecap works".
3. **The lead:** "The technical reference, for auditors and developers: how a run works, what it records, how anyone can check the records, and how this website is built. Every claim here can be checked against voicecap's code. For the short version, see Can I trust this?"
4. **The stamp:** "From voicecap 0.15.0, released 9 October 2026."
5. **"On this page":** a list of links to the parts below. The audit tool folds its whole reference away; here it's open, so it's complete without JavaScript, and the list leads to each part.

### Its parts

Each part has an h2 with an id, and h3s inside it where it needs them. The words follow the fixed wording the shareable page and the README already use.

1. **What voicecap does.**
   - A human review, sped up. voicecap presses NVDA's keys the way a person would, moves from page to page, and saves every word NVDA says. The person running it hears NVDA at work, reads the transcripts, records what they found, and fixes it.
   - The real screen reader, never a simulation.
   - Where voicecap runs:
     - real NVDA runs need Windows;
     - reviews, reports, sharing, this website, and `voicecap verify` work on any computer;
     - VoiceOver on a Mac comes later.
2. **How a run works.**
   - **The diagram:** an ordered list drawn as a flow of boxes, with an arrow from each to the next, and one under another on a phone. The arrows are the style's, so a screen reader hears the list. These are the steps:
     1. **The page list:** a sitemap, a page list, pages named one by one, or a walkthrough file. It's cleaned up first: one address a page, and pages off the site or not HTML left out.
     2. **Quick checks,** before NVDA starts. A computer that isn't ready stops the run before anything is written.
     3. **The real tools start:** voicecap's own copy of NVDA, and Chrome. The person's own NVDA is closed, and started again afterwards.
     4. **Each page, three ways.**
        - A new Chrome, with a new profile, opens the page, and its screenshot is taken.
        - The window comes to the front, and NVDA confirms it.
        - NVDA reads the page line by line, heading by heading, and control by control, and every word is saved.
     5. **Safeguards on every key:**
        - focus is checked before and after each key;
        - a step during which another window came forward is thrown away, and the page tried again, with earlier tries kept;
        - silence is never recorded for a stopped NVDA or a locked screen.
     6. **Flags** point a person at moments worth a closer look.
     7. **The person's review:**
        - at a run's end, voicecap asks whether the person heard NVDA (Enter means No);
        - the person reads the transcripts, and records a decision for each page (`voicecap review`);
        - they can hear a page's saved words again with `voicecap review --replay`.
     8. **A sealed record:** the run's record is sealed when it completes, and the report, the shareable page, and its Word copy are written.
     9. **Sharing:** `voicecap share` makes a dated copy, with each run's walkthrough file, recorded in a sealed, chained `shares.json`.
     10. **This website:** `voicecap site` publishes each site's newest shares, every file checked against its fingerprint.
   - **The commands,** in a table: each command, and what it's for, in the order a person uses them (from `preflight` and `setup` to `site` and `verify`).
3. **NVDA's three passes.**
   - **A table of the passes:** each pass, its key, where it starts, and what ends it.
     - read: Down Arrow, from the top. It ends when the last line is spoken and the next steps repeat it, since NVDA has no message for the end of a page.
     - headings: H, from the top. It ends when NVDA says "no next heading".
     - tab: Tab, from nothing focused. The first Tab goes to the browser itself, so a skip link isn't passed over, and the rest go through NVDA. It ends when focus leaves the page, which the browser reports, not NVDA's words.
   - **Every pass** also stops at its step cap or at its repeat limit, and records why. The reasons are end-reached, no-next-heading, left-document, repeat-limit, step-cap, timeout, and error.
   - **How NVDA's words are caught,** without naming Guidepup, which the toolchain table names:
     - voicecap's NVDA driver connects to NVDA's Remote Access service, on this computer only, sends each key, and receives what NVDA speaks;
     - it silences NVDA before each key, and waits until a second passes with no more speech;
     - a step's words are what NVDA said for that key, and a step where NVDA said nothing is written `[no speech]`.
   - **The run's record** keeps NVDA's settings that differ from NVDA's own defaults.
   - **A table of the defaults,** from voicecap's own (generated):
     - the step caps (read, headings, tab);
     - the repeat limit;
     - the time limits for a step and a page;
     - the tries a page gets;
     - how often NVDA and the browser restart;
     - how many failed pages in a row stop a run.
4. **What a run records.**
   - **The transcripts home, as a tree,** each entry with a line on what it holds:
     - `run.json`, the run's record;
     - `events.jsonl`, the event log, one line for each event as it happens;
     - `pages/<page>/`: `read.txt`, `headings.txt`, and `tab.txt`, each with its `.json` of every step (the key, the words, its timing), and `screenshot.jpg`;
     - `attempts/`, the earlier tries, kept;
     - `reviews.json`, the review history;
     - `share/`: the shareable page, its Word copy, the dated copies, the walkthrough files, and `shares.json`.
   - **What a run's record of the computer keeps:** the system, processor, memory, display, browser window, time zone, language, and versions.
   - **What it never keeps:** the computer's maker, model, or name, or the account.
5. **The flags: what voicecap points out for a person to check.**
   - **A table of the built-in rules:** each rule's id and what it catches, with the number of rules generated.
   - **A rule can be added** in voicecap's config.
   - **Flags never fail a page or change the exit code,** and they match NVDA's English wording.
   - **On the shareable page,** "What needs attention" turns them into cards with a suggested fix. The person decides.
6. **Fingerprints, seals, and `voicecap verify`.**
   - **What's fingerprinted:** the SHA-256 of every transcript, screenshot, event log, page list, config, and shared copy, recorded as each is written.
   - **A seal** is the SHA-256 of the record itself, with its seal left out. Each completed run, manual session, review, and share has one. A completed run's folder is never written again.
   - **The chains:** each review, and each share, carries the seal of the one before it, in one chain of reviews a site and one of shares a site folder.
   - **`voicecap verify`** checks all of it, and exits 0 when everything matches, 3 when something doesn't.
   - **Each report's "Check the fingerprints"** does the same for the report's own records, in the reader's browser, with nothing sent anywhere.
   - **What no check can catch:**
     - someone who edits a record and seals it, and every record after it, again;
     - someone who deletes the newest records.
     The Git history, pushed to a protected branch, shows both.
7. **How this website is built and protected.**
   - **What's published:**
     - each site's newest shares, from their sealed `shares.json` records only (how many a site keeps, generated);
     - a file only when its size and SHA-256 are the ones recorded when it was shared;
     - anything else is left out, and the build names it.
   - **How each page is protected:**
     - it's one file, and loads nothing from outside;
     - its Content Security Policy is made from the SHA-256 of its own style and script, and it allows no connection.
   - **The headers** voicecap's `netlify.toml` asks Netlify for: no indexing, no referrer, no sniffing, no framing, no camera or microphone, HTTPS only, and the same-origin rules.
   - **Who can see it:** `robots.txt` asks every crawler away. That's a request, not a lock: anyone with the address can read the website.
   - **How it's built:** Netlify builds it from the transcripts repo, a private repository, with `npx @icjia/voicecap@<version> site` on each push.
   - **This website, now:** its sites, reports, and files published (generated, as on the trust page).
8. **The toolchain:** a table of each tool, its job, its license, and where it's used, as the audit tool's "The Open-Source Toolchain at a Glance":
   - NVDA (GPL-2.0), and Guidepup and `@guidepup/setup` (MIT);
   - Chrome, or Chromium (BSD-3-Clause), and Playwright (Apache-2.0);
   - Node.js (MIT);
   - commander, csv-parse, docx, fast-xml-parser, jiti, jsonc-parser, picomatch, and zod (MIT), and diff (BSD-3-Clause);
   - axe-core (MPL-2.0) and Vitest (MIT), in voicecap's own tests, and TypeScript (Apache-2.0);
   - the computer's own voice, for `voicecap review --replay` (System.Speech on Windows, `say` on a Mac);
   - and voicecap itself, MIT.
   - The npm packages' licenses are checked against the installed packages (see Tests). NVDA's, Node.js's, and Chromium's are linked to their sources.
9. **Privacy and security.**
   - **On the person's computer:**
     - everything a run makes stays there: transcripts, records, screenshots, and reports;
     - voicecap talks to NVDA and to Chrome on that computer only.
   - **What goes out:**
     - Chrome loads each page under test, and what it loads;
     - the page list reads the site's sitemap and `robots.txt`;
     - `voicecap setup` downloads NVDA's build from GitHub, checked by its SHA-256, and Chromium when Chrome isn't there.
     - Nothing else.
   - **Nothing voicecap doesn't need:**
     - no telemetry, analytics, or cookies; a voicecap page stores only the reader's choice of theme, in their browser;
     - no accounts, keys, or passwords, read or stored.
   - **The browser** gets a new profile for each page load, deleted after, with sync, background networking, and extensions off, and downloads refused.
   - **Private text stays private:**
     - a window's title, which can hold private text, is kept only in the event log, never on a page or in a Word copy;
     - an NVDA log from a manual session can hold every keystroke, so voicecap warns, can redact typed text, and never commits the raw copy.
   - **Walkthrough files** may come from anyone, so they're read with strict limits, and never change NVDA's settings or the browser.
   - **Where it lives:** the transcripts repo is private; this website is public to anyone with its address.
10. **What it can't do: the limits.** Technical ones, as the README's Known limitations:
    - NVDA speaks very fast during a run, and the transcripts have every word;
    - a run is timing-sensitive, so runs are compared with care;
    - NVDA is voicecap's own copy, with its own settings, in one browser;
    - NVDA's interface must be in English;
    - the computer is voicecap's during a run, for one voicecap at a time;
    - a page that talks without stopping can time out;
    - VoiceOver runs come later.
11. **Verify for yourself.**
    - **Links to the code that built this website,** at its version's tag (generated from the version):
      - the NVDA driver, `src/drivers/`;
      - the passes, `src/passes/`;
      - the flags, `src/flags/evaluate.ts`;
      - the seals, `src/util/hash.ts`;
      - verify, `src/verify.ts`;
      - the website, `src/site/`.
    - **How to check a copy you were sent:** `Get-FileHash` on Windows, or `shasum -a 256` on a Mac, against the fingerprint the sender gave; and `voicecap verify` on a copy of the records.
12. **Related documents:** a card holding four cards, as the audit tool's, each with a small label, a title, and a line:
    - TRUST: "Can I trust this?";
    - HISTORY: "What's New";
    - CODE: "Source on GitHub";
    - MANUAL: "The README", how to install and run voicecap.

### What it states from the code

Where the page states something voicecap's code holds, it takes it from the code, so the page can't fall behind it:
- the passes and their names;
- the built-in flag rules, and how many there are;
- the defaults;
- how many shares a site keeps on the website;
- the version and its date.

The rest is typed, in `technical-text.ts`, and its tests hold the names it uses to the code. Every command, rule id, pass, and file it names must exist.

## What's New

`whats-new.html`, from the CHANGELOG that the package ships, read at each build of the website. A new release appears on its own, once Netlify builds with it.

In order:
1. **"Back to the test results".**
2. **The kicker,** "Every release", the h1 "What's New", and the lead: "Every release of voicecap, newest first, from its CHANGELOG. The front page shows the newest one."
3. **One card for each dated release,** newest first, in an ordered list, as the audit tool's update archive:
   - **The card's first line:** the version as a pill in `--good`, then the date ("8 October 2026"). On the version that built the website, it adds "the current version".
   - **The release's headline** (as the trust page's facts word it), as the card's h2.
   - **Its items,** as a list: the bold words that begin each bullet of the entry, at its first two levels, other than the bullet that gave the headline. A bullet that doesn't begin with bold words gives its words up to its first ": " or ". ", as a headline does.
   - **Last, "The full entry in the CHANGELOG":** a link to the entry's heading on GitHub. A screen reader hears its version with it ("The full entry for 0.13.1 in the CHANGELOG"), so no two cards' links sound alike.
- **What it skips:** `## [Unreleased]` and any heading that isn't a dated release.
- **Every word is plain text, escaped.** Code spans are in the fixed-width font, a link is its words, and nothing else from the CHANGELOG becomes markup.
- **A CHANGELOG with no release** says so: "No release is recorded in this build of voicecap."
- **Guidepup, for the owner to confirm:**
  - The items are the CHANGELOG's own words, so a few of them name Guidepup, as the CHANGELOG does. Examples are 0.2.0's "The Guidepup NVDA driver" and 0.5.0's "After a closed terminal window, your NVDA starts once Guidepup's has quit."
  - Like Technical details, What's New is a record for those who want the detail.
  - The front page, the trust page, the shareable page, and the Word copy still never name it.
  - A release's headline is on the front page's banner and the trust page, so a test holds every headline in the CHANGELOG to never naming it.

## Generated, never typed

As on the trust page, no number or date about voicecap is typed into a page or its words. Each comes from one of these:
- **voicecap's `package.json`:** its version.
- **Its CHANGELOG:** the version's date; every release's date, headline, and items.
- **Its `dist/release-facts.json`,** written by each release (0.13.2): the tests, the commits, and where CI runs.
- **Its own code,** imported by the build: how many flag rules there are, and NVDA's passes.
- **The records:** the sites, reports, pages read, and the files published and left out.

A fact that's missing says "not recorded in this build of voicecap", and never makes one up. The npm packages' licenses in the toolchain table are words, typed, and a test holds each to the `license` of the package voicecap installs.

## Wording

Every page follows voicecap's rules:
- voicecap is a human review, sped up, and never "automated" ("automated" may describe another tool, such as axe, never voicecap);
- a person hears, reads, and decides, and never "listened";
- no mention of an AI assistant;
- Guidepup is named only in the Technical details page's toolchain table, and in What's New where the CHANGELOG names it (above).

## How it's built

- **`src/site/frame.ts`:**
  - the top bar, `siteBar(current)`, which no longer needs the content, since the views' links move to the front page;
  - the bottom bar, `siteFooter(current, version)`;
  - the "Back to the test results" link;
  - `sitePage`, which takes the page's title, which page it is, and its main part.
- **`src/site/style.ts`:**
  - the website's own tokens and rules, in the audit tool's look;
  - it no longer begins with the shareable page's `THEME_CSS`;
  - it keeps that page's rules for focus, the skip link, and text only a screen reader gets.
- **`src/site/render.ts`:** the front page's kicker, banner, and "On this page" row, and its markup for the new look.
- **`src/site/trust.ts`:** the two-line headline, the stamp's box, the tiles' numbers, and the releases' link to What's New.
- **`src/site/technical.ts` and `src/site/technical-text.ts`** (new): the Technical details page and its words. It takes these from voicecap's own code:
  - the passes, from `PASS_NAMES`;
  - the flag rules and the defaults, from `DEFAULT_CONFIG`;
  - the shares a site keeps, from `KEPT_PER_SITE`.
- **`src/site/whats-new.ts`** (new): the What's New page.
- **`src/site/changelog.ts`** (new): the CHANGELOG's releases, with their headlines and items. `parseChangelog` moves here from `facts.ts` and gains the items.
- **`src/site/icons.ts`:** the bottom bar's five icons, the sun and the moon, and the back arrow.
- **`src/site/client.ts`:** the theme button's icon follows the theme.
- **`src/site/build.ts`** writes the two new pages, and **`src/site/headers.ts`** gives each page its policy at both its addresses.
- **The website no longer uses `src/share/fonts.ts`.**

## Tests

- **The bars:**
  - their links and their order;
  - `aria-current` on each page's own link, in both bars;
  - the bottom bar is a list of six;
  - the version, and what a screen reader hears of it;
  - neither bar is sticky.
- **The CHANGELOG:**
  - releases with their dates, headlines, and items (two levels; the bold words; the headline's own bullet skipped);
  - code spans;
  - a `<script>` in a line comes out escaped;
  - `## [Unreleased]` is skipped;
  - an empty CHANGELOG;
  - no release's headline in voicecap's own CHANGELOG.md names Guidepup.
- **What's New:**
  - one card for each release, newest first;
  - the current one marked;
  - each card's link goes to its entry and says its version;
  - headings in order.
- **Technical details:**
  - headings in order, and every "On this page" link goes to its part;
  - every number comes from the facts given, and the defaults' table equals voicecap's defaults;
  - every command, rule id, pass, and file the page names exists in the code;
  - each npm license in the table matches the installed package's;
  - Guidepup is named in the toolchain table, and nowhere else on the page;
  - nothing calls voicecap "automated", nothing says a person "listened", and nothing mentions an AI assistant.
- **The front page:**
  - the banner, with the newest release and its link;
  - no banner without a release;
  - the "On this page" row;
  - the existing tests keep passing, with their markup brought up to date.
- **The build:**
  - the four pages are written;
  - `_headers` gives each page its policy at both its addresses;
  - every link among the four pages goes to a page that's there;
  - the same records build the same bytes;
  - no page embeds a font.
- **In a browser, on all four pages:**
  - axe with no violations in both themes, at 1280, 390, and 320 pixels;
  - nothing wider than 320 pixels;
  - complete without JavaScript;
  - the theme button switches, and its icon follows;
  - focus is visible on every link of both bars;
  - at 200% and 400% text, the bars wrap and nothing overlaps.

## Docs and release

- **The README:** "The website: `voicecap site`" describes the four pages, both bars, and the look. Its pictures are drawn again (`pnpm readme:screenshots`): the website, dark and light, the trust page, Technical details, and What's New.
- **The CHANGELOG,** and the timeline's row for 0.15.0 on the PC track (a minor).
- **The release:** 0.15.0.
  1. Once npm serves it, the transcripts repo's `netlify.toml` builds with `@0.15` (the standing OK).
  2. Then the live check: all four pages, at both of their addresses.

## Not included

- **A server status:** the website is static.
- **An FAQ page, a scoring page, and a data retention policy page:** the audit tool's, which voicecap has no counterpart for yet.
- **A banner that can be dismissed.**
- **The shared reports' look.**
- **Search, analytics, and cookies.**
