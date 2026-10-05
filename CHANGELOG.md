# Changelog

All notable changes to voicecap are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and voicecap uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Each run records an event log, which names the program that took the screen, and a screenshot of each page. The shareable page and its Word copy show them: the event log minute by minute, and each page's screenshot. On every page voicecap makes, the footer sits at the window's bottom when the page is shorter than the window.

### Added

- **The event log, `events.jsonl`,** in each run's folder: a JSON line for each thing that happened, with its time to the millisecond, written as the run goes, so a window closed in the middle of a run still leaves everything up to that moment. A resumed run adds its events after the earlier sessions'. The README's "What each run records" describes it.
  - **What it holds:** each session starting and ending, with why; the NVDA lock taken and released; voicecap's NVDA started and stopped, with its process id, and each restart of it, with the reason; the computer's own NVDA shut down while voicecap runs, and started again; each browser launched and closed, and a hand-over to a new copy of itself; each attempt at a page starting, and finishing or failing; the computer found locked; and another window taking the screen.
  - **Sealed and checked:** at the end of each session, the log's SHA-256 and size go into `run.json`'s new `files`, so the run's seal covers it, and `voicecap verify` checks it: it names a log that's missing or changed, and one a completed run doesn't record. A run from before 0.11.0 has none, and `verify` passes on it.
  - **Only added to:** a line cut short by a closed window is left as it is, and the next event starts on a new line.
- **The program that took the screen.** When another window takes the screen, voicecap asks Windows which program it was. The event log keeps the program and the window's title. The failed attempt's record keeps `program`, the program's name only, or `null` when Windows didn't say, and when voicecap's own browser was back in front by the time it looked. A title can hold private text, such as an email's subject, so the page and the Word copy never show it.
- **A screenshot of each page,** `pages/<slug>/screenshot.jpg`, taken through the browser's own DevTools connection as the page finishes loading, before NVDA reads it, without taking focus: the part of the page the window shows, at half its size (about 640 pixels wide), as a JPEG. The page's record keeps `screenshot`: the file's size and SHA-256, the picture's size, and when it was recorded, or the reason when none could be taken, which never fails the page. `voicecap verify` checks each file, and the shareable page's "Check the fingerprints" checks each one it shows.
- **Minute by minute, on the shareable page and in its Word copy.** Each run's evidence shows each session as a chart, with a lane for the lock, voicecap's NVDA, the pages, and the computer's own NVDA, and a fold with every event to the millisecond. The run's facts say how many times NVDA was restarted, and why. A problem's record has the event log's lines from that attempt, and a problem of another window taking the screen says which program came to the front, by its name; the section's opening line names each such program, with how often. In the Word copy, a session is the sentences that sum it up and a table of its events. A run whose log isn't as its record says, or that has none, says so in the log's place, and a run from before 0.11.0 says which version of voicecap it used. So does each session of a run begun before 0.11.0 and finished on it, in that session's place, and the run's facts say which sessions NVDA's restarts were counted in.
- **Screenshots on the shareable page and in its Word copy.** Each page's card and its entry in the appendix show its screenshot, with alt text, and the Word copy has the picture in the appendix. A screenshot that's missing, or isn't the file its run recorded, isn't shown, and the page says so.
- **Programmatic API,** all optional, so code that uses voicecap as before works as before:
  - `ScreenReaderDriver.setEventRecorder(recorder)`, which a run calls with an `EventRecorder` before it first starts the driver, for a driver to report what it does to the screen reader and the browser;
  - `PageInfo.screenshot`, a `PageScreenshot` (`{ jpeg }`, or `{ error }`) that a driver gives for a page it has loaded;
  - `ForegroundError`'s `program`, the name of the program that took the screen, given as `{ program }` in its second argument;
  - `RunJson.files`, `PageRecord.screenshot` (a `ScreenshotRecord`), and `AttemptRecord.program`;
  - the types `RunEvent`, `NewRunEvent`, `RestartReason`, `EventRecorder`, `PageScreenshot`, and `ScreenshotRecord`.

### Changed

- **The footer sits at the window's bottom when its page is shorter than the window,** on every page voicecap makes: the shareable page and its dated copies, a run's report, the website, and the demo's own pages. On a page longer than the window it comes after the content, as before, and print is as before. A page already shared is as it was: only pages made from now on change.
- **The story's "Next" now lists NVDA's own log,** checked against the transcripts, recorded at the PC. It's the part of the evidence still to come, since the event log and the screenshots are recorded from this release.

## [0.10.0] - 2026-10-05

Canonical site names: everything voicecap makes for readers names a site by the address people visit, never an IP address, even for a run on a copy on the tester's computer, and the page and its Word copy lead with that name and when the site was tested. The website publishes the demo's own pages at voicecap.netlify.app/demo-site/, the footers keep to the width of the text above them, and the README shows what voicecap makes.

### Added

- **Canonical names:** voicecap names a site by its canonical address, the one people visit, such as `https://dvfr.illinois.gov/`, in everything it makes for readers. Its canonical name is that address's host, `dvfr.illinois.gov`, and it leads the shareable page, the Word copy, the dated copies' names, and the website. The page and its Word copy lead with when the site was tested too; the dated copies' names, and the website, give the day the report was shared. An IP address or a local address doesn't lead, even for a run on a copy of the site on the tester's own computer, once the site's canonical address is known. The README's "A site's name: its canonical address" describes it.
  - **How a site gets one,** from the strongest way to the weakest: `report.canonical` in the config, which names the site whenever the page, its Word copy, or a share is made, and beats the address any run recorded; `--canonical <address>` on a run; or the pages' own `<link rel="canonical">` tags, which a run reads as it goes. A run records the root that most of the inner pages' tags name, and the home page's only when no inner page names one. A tag counts only when its path ends with the page's own, so a tag for another page, a local address, or an address that isn't on the web is ignored. With none of them, a site is named by the address voicecap read, as before, and `voicecap share` refuses one that voicecap read at an IP address or a local address (see "Changed").
  - **`--canonical <address>`** on a run: the address people visit, such as `https://dvfr.illinois.gov`. It's kept as a root, with a `/` on the end, and the session that completes the run records it as `canonical` in `run.json`, so the seal covers it. It isn't one of the settings a run resumes by, and a replay, which reads no tags, learns an address only from it. An IP address or a local address is refused: `"http://localhost:3000" is an IP address or a local address, not a site's name; give the address people visit, such as https://dvfr.illinois.gov.` So is a host with an empty label, such as `https://.example.com` or `https://a..b.org`, which isn't a web address.
  - **`report.canonical`** in the config: an address of the same kind. One config names every site it's used with, so keep one per site, as with `report.siteName`. When it isn't set, it's left out of the config's SHA-256 that each run records, so a config without it has the SHA-256 it had in 0.9.x, and comparing a run from before the upgrade with one from after doesn't say the config differs.
  - **`voicecap init` asks for the address** when the website is at an IP address or a local address and its home page names none of its own: `This address is an IP address or a local address, so reports need the address people visit. What is it? (for example, https://dvfr.illinois.gov)`. It asks again until the answer is an address that fits, and writes it into the command it prints as `--canonical`. When the home page names an address with a path, such as the demo's, the question adds `Its home page names https://voicecap.netlify.app/demo-site/: press Enter to use that.`, and Enter takes it. When the home page names the site's own address, `init` says so, and asks nothing: `The site names its canonical address: https://dvfr.illinois.gov/. Reports will name it so.`
  - **What keeps the address voicecap read:** a run's `site` and the site's folder, the walkthrough file, the terminal's output, a problem's record, and the data the page carries for its fingerprint check. When the address voicecap read isn't the canonical one, the page's evidence says so and names no address: `These runs read a copy of the site on the computer that ran them.` for a copy at `localhost` or another of the computer's own addresses (`127.0.0.1`, `::1`), and `These runs read a copy of the site at another address.` for any other, another computer's IP address included. The site itself over `http`, or with or without `www.`, gets neither.
  - **Recorded:** `run.json` has `canonical`, and each page's record the address its tag gave. Each `shares.json` entry has `site`, the root the share named the site by, and `voicecap verify` checks it. A run or a share from before 0.10.0 has neither, and is named as before unless `report.canonical` names it, though a site such a run read at an IP address or a local address needs `report.canonical` to be shared again. Nothing already written is changed.
- **`--site` takes a site's canonical address** on `review`, `manual add`, `report`, `share`, `walkthrough`, and `verify`, as well as the address voicecap read. It finds the folder named for the address when that folder holds records, and otherwise the one folder that recorded the address as its site's canonical address, by its newest completed run or by its newest share, which records the address `report.canonical` gave. An address with a path, such as the demo's, is looked for in a folder that recorded it before the folder named for its host, which holds that host's own pages. When two folders recorded it, voicecap stops, names both, and asks for the address it read. With `--run`, `walkthrough` looks in every folder the address names and takes the one that holds the run, so the commands the page and its Word copy show, such as `voicecap walkthrough --site https://dvfr.illinois.gov --run <id> <file>`, work on a site that was read on a copy, or named by `report.canonical`, and beside the live site's own folder. When none of them holds the run, it names the folders it looked in; when several do, it takes the folder named for an address with no path, if that's one of them, and otherwise asks for the address voicecap read. A run's own `--site` is still the address to read.
- **The demo's own pages are published on the website,** under `demo-site/`, so the demo's canonical address, `https://voicecap.netlify.app/demo-site/`, leads to the pages NVDA reads in the demo, and the demo's view links to them.
  - **Every build writes them,** from voicecap itself, byte for byte, with a folder for each page and a `sitemap.xml` of the pages at their canonical address. The files an operating system adds to a folder someone opens (`.DS_Store`, `Thumbs.db`, and `desktop.ini`), as in a checkout of voicecap opened in Finder or Explorer, are never published. Each page has a Content Security Policy of its own, at every address it answers at: `default-src 'none'; style-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`.
  - **`demo-site/` is the one folder inside a folder that a build's folder may hold:** it counts as a build's when it holds only the paths this voicecap writes there. A site folder named `demo-site` is left out, as one named `demo` is. A build into a folder whose `demo-site/` holds a file or a folder this voicecap doesn't write, such as a demo page that a later voicecap removed, stops, and says why and what to do: `voicecap site won't build into <folder>: it holds demo-site/<path>, which this voicecap's build doesn't write (it may be from another voicecap): delete the folder and build again.` It says to delete the folder only when nothing else in it is anyone's: a link, or a name that starts with a dot, gets the refusal any other folder does.
  - **Each demo page names its canonical address** in a `<link rel="canonical">` tag, so a run of the demo on the copy on this computer learns it, and the demo's report and its copies are named `voicecap.netlify.app`.
- **`pnpm readme:screenshots`**, for development: makes the README's six screenshots, of the demo's shareable page and of the website built from its report, in `assets/screenshots`, from a temporary home. It needs Playwright's Chromium and no screen reader, and it refuses to write a shot that shows an IP address or `localhost`.

### Changed

- **The footer of the website and of the shareable page keeps to the width of the text above it,** so a line of it is no longer to read. On a wide window it ran the page's whole width, about 170 characters a line. Its smaller text now stops at 80 characters, as wide as the 72 of the text above. A page already shared is as it was: only pages made from now on change.
- **The shareable page and its Word copy lead with the site's canonical name and when it was tested.** The page's headline is the name, such as `dvfr.illinois.gov`, with "Tested 29 September 2026, 14:02", the day and time the latest run began, under it. `report.siteName` is now a line under the name, not the headline, and without it there's no such line: the home page's title is no longer a headline. The Word copy opens with its title, the name, the `report.siteName` line, and "Tested 29 September 2026, 14:02. This copy was made 30 September 2026.", with the site's address last. Every page address either shows is that page on the canonical address, and a page whose path already starts with the root's path keeps it, so a site under a path, such as `https://icjia.illinois.gov/researchhub/`, isn't doubled when it's read itself. The run report's subtitle names the site by its canonical name too, when the run recorded one. A page already shared is as it was: only pages made from now on change.
- **Shared copies are named for the site's canonical name,** such as `dvfr.illinois.gov_2026-10-05.html`, not for the site's folder, which is the address voicecap read. The walkthrough files the page offers to download are named the same way. A site with no canonical address, read at a name people visit, is named by that name as before, and copies shared before this keep their names. A share's `shares.json` entry records the `site` the copies name.
- **`voicecap share` won't name a site by an IP address or a local address.** A site with no canonical address that voicecap read at one, such as a copy at `localhost` or the demo's runs from before 0.10.0, isn't shared: a share is recorded for good, and published. It stops before it writes anything, exits with code 1, and says how to name the site: `voicecap won't share a site by an IP address or a local address (127.0.0.1:4848). Give it the address people visit: set report.canonical in a voicecap config in a folder of the site's own, and share from that folder; or run it again with --canonical <address>.` Before, it named the copies after the address, such as `127.0.0.1_4848_2026-10-05.html`.
- **The website heads each site by its canonical name,** from its newest share's `site`, and names it so in every report, by date. Site folders whose shares name one site are one site, their reports together, the newest first, and each report's files stay in the folder it was shared in. A site with no canonical address is headed by its folder's name, as before. When that name is an IP address or a local address, as a copy's folder shared before 0.10.0 is, the build still publishes it, and warns: `127.0.0.1_4848: headed by its folder's name, an IP address or a local address. Share it again with its canonical address (see report.canonical) to name it.`
- **The demo's pages are made to be published,** as well as to be read on the copy on this computer. Their links are relative, and the footer says `This demo site comes with voicecap, for trying it out.`, since "runs only on this computer" isn't true on the website. The question form sends with GET to `ask-a-question/sent.html`, a page like any other, since a static site answers no POST, and the demo's own server answers none either (405). The form's note says `This is a practice form: sending it only shows a thank-you page, so don't type anything private.`, and the answer page, "Practice form", says it's a practice form, so no one will answer it.
- **The README shows what voicecap makes,** with six screenshots of the demo's shareable page and of the website, each described in text beside it.
- **Programmatic API:**
  - `PageInfo` has a new, required `canonical`: the address of the page's first `<link rel="canonical">` tag as the browser resolved it, or `null` for a page with none, and for a driver that can't read tags. It's a compile-time change for a custom driver, which now has to return the field. At run time, a driver that leaves it out works as one that returns `null`.
  - `SiteContent.sites` entries are `{ name, folders, reports }`, in place of `{ folder, reports }`. It's a compile-time change for code that reads a site's `folder`: `name` is the heading the site shows (its canonical name, or its folder's name), and `folders` are the site folders its reports are in, more than one when folders name one site.
  - `chooseSiteDir`, and the `site` option of `shareReport` and `writeWalkthrough`, take a site's canonical address as well as the address voicecap read, which a folder recorded by its runs or its shares. `writeWalkthrough` given a `run` takes the folder, of those the address names, that holds the run.
  - `RunJson` and `PageRecord` have a new, optional `canonical`, and `ShareEntry` a new, optional `site`, which leave code that reads them as it was.
  - `report` in the config has a new `canonical`, a root or `null`. It's a compile-time change for code that builds a `VoicecapConfig`, or a `LoadedConfig`, by hand: it now has to give `report.canonical` (`null` for none). A config from `loadConfig` or `resolveConfig` has it, `null` when it isn't set, so code that reads one is as it was, and a `UserConfig` for `defineConfig` needn't give it.

## [0.9.1] - 2026-10-04

A fix for a home's first website build: `voicecap site` writes voicecap's own `.gitignore` and `.gitattributes` where the home is missing them, and reads a `.gitignore` as Git does. The README's stories of who voicecap is for now open from one line each.

### Changed

- **The README's stories of who voicecap is for** are now one line each, naming the person and what voicecap gives them, and each opens to its story, so all nine can be read at a glance.
- **The first deploy's steps** say what `voicecap site` writes in a home that is missing `.gitattributes` or `.gitignore`, and commit them with the Netlify files.
- **No test can reach a person's own transcripts home or reviewer name:** the tests take `VOICECAP_TRANSCRIPTS` and `VOICECAP_REVIEWER` out of their environment before each file runs, so even a mistake in the code under test that reads the environment can't write into the home. CI sets both for its test run, to check it.

### Fixed

- **`voicecap site` writes `.gitattributes` and `.gitignore` into a home that is missing either,** as a run does, and says so (`Wrote .gitignore into <home>, for Git: commit it with the records.`). Before, a home that no run had written to was told to add `_site/` to a `.gitignore` it didn't have. A `.gitignore` made by hand then would have kept voicecap from ever writing its own, which keeps raw NVDA logs, the run lock, and the page's working copies out of Git too. If you made one that way, with only `_site/` in it, delete it and run `voicecap site` again: it writes voicecap's own, `_site/` included.
- **The `.gitignore` check reads each line as Git does.** A line with white space at its start or a tab at its end, such as `  _site/`, keeps nothing out of Git, and it now gets the warning: before, it passed. A CRLF line ending, trailing spaces, and a UTF-8 byte order mark at the file's start still count, since Git drops them. A line with a long run of spaces in it is read in one pass.

## [0.9.0] - 2026-10-04

The website: `voicecap site` builds a site of every shared report, by site and by date, with the demo, each report with its page, Word copy, and walkthrough files and their fingerprints, for Netlify to publish. `voicecap share` now shares each run's walkthrough file too, and the README opens with who voicecap is for.

### Added

- **The website, `voicecap site [--home <dir>] [--out <dir>]`**: builds a website of every report voicecap has shared, by site and by date, with the demo, for Netlify to publish. The README's "The website: `voicecap site`" describes it, with the numbered steps of the first deploy.
  - **Its two options:** `--home` is the transcripts home (default: `VOICECAP_TRANSCRIPTS`, else `./transcripts`), and `--out` is the folder to build the site in (default: `_site` in the home). That differs from every other command, where `--out` is the home.
  - **What's on it:** three views, which a bar of links reaches: the demo, the sites, and every report by date.
    - The demo is voicecap's report on its own demo site: the latest share in the home's `voicecap-demo/` folder, published under `demo/`. It isn't in "Every report, by date", since it's an example, not a site.
    - Each site's reports are listed the newest first, under the site's folder name (its host).
    - Each report shows when it was shared, who prepared it, and its files: the page, to open, and its Word copy and each walkthrough file, to download. Each file shows its size and SHA-256 fingerprint. A report shared by 0.8.0 or earlier has no walkthrough file, and says so.
    - The site's page is one self-contained file in the shareable page's design: dark at first, with a button for a light version, light in print, and complete without JavaScript. It keeps the reader's theme under the same name as the reports, so a choice made on one carries to the other.
  - **What it publishes:** only what the records of what was shared name. That's each file of an entry whose seal still holds, as a regular file whose size and SHA-256 are the recorded ones, copied byte for byte. It reads each site folder's `share/shares.json`, and never a run.
  - **What it leaves out, and names,** in the build's output. The build still succeeds, so one changed file doesn't stop every later update.
    - An entry whose seal no longer holds, whose fields aren't what voicecap records, or whose `shares.json` can't be read: the site shows nothing of it.
    - A copy that has changed, is missing, can't be read, or isn't a regular file: it's also named under its report on the site (`<name> isn't here: …`), and the report's other files are still published.
    - A name voicecap never gives: only lower-case `.html`, `.docx`, and `.json` files are published, and only folders and files named with letters, digits, `.`, `_`, and `-`, with no dot at the start or end of a file's name, and none named `index.html`, which Netlify would serve at its site folder's own address, where it would have no Content Security Policy. A name that holds a path is never read.
    - A site folder named `demo`, which would take the demo's place, and one named `index.html`, `robots.txt`, or `_headers`, which would take the place of the site's own file.
    - A `voicecap-demo` that isn't a folder (Git for Windows checks a committed link out as a plain file): the site is built without a demo.
  - **Where it builds:** the output folder is emptied first, so it's built into only when it's empty or one `voicecap site` built (its `_headers` starts with voicecap's line), and then only when it holds no name that starts with a dot and no folder inside a folder. The files an operating system adds (`.DS_Store`, `Thumbs.db`, and `desktop.ini`) don't count against a folder a build made. It refuses the transcripts home itself, a folder that holds it, and anything inside a site's folder or `voicecap-demo/`, through links too. On Windows it also refuses a folder whose name ends with a dot or a space, which Windows drops. A refusal says why, exits with code 1, and changes nothing.
  - **What it writes:** `index.html`, the site's page; `robots.txt`, which turns every crawler away; and `_headers`, with each page's Content Security Policy, made from the hashes of that page's own style and script, and `Content-Disposition: attachment` for each Word copy and walkthrough file.
  - **In the home, once, and never written over:** `netlify.toml`, with the build command (`npx --yes @icjia/voicecap@<the minor version that wrote it> site --home . --out _site`), `publish = "_site"`, and the security headers for every file; and `.nvmrc`, with `24`.
  - **It's public:** everything on the site is open to anyone with its address. A share is never deleted, so the site shows every one whose record is intact.
- **`voicecap share` writes each run's walkthrough file,** beside the page and its Word copy, so the website has one to offer: the file the page offers to download, named `<the page's name without .html>_<run id>_walkthrough.json`, oldest run first, and never written over. Each is recorded in `shares.json` with its run (`run`), size, and SHA-256. A run whose file can't be made gets a warning, and the share goes on. A share made before this has none. The line to paste into the email still names only the page and its Word copy.
- **The README says why voicecap is useful and who it's for,** near its top: the two halves of an accessibility review, how voicecap is different, and stories written for the README, each a composite of the people it's made for (a web coordinator with a deadline, a developer, an accessibility specialist, a manager, an outside auditor, a tester, a content editor, a project manager, and a screen reader user).
- **`pnpm site:fixture <folder>`**, for development: makes a transcripts home with reports shared in it, from the demo fixture, at `<folder>/home`, builds the site in `<folder>/_site`, and prints the path of its `index.html`. It needs no screen reader.
- **Programmatic API**: `buildSite`, which builds the website as `voicecap site` does (it takes `home`, `out`, `cwd`, `env`, and `logger`, and gives back `out`, the folder it built in; `content`, what it published; and `leftOut`, each thing it left out); the types `BuildSiteOptions`, `BuildSiteResult`, `SiteContent`, `PublishedReport`, `PublishedFile`, and `SharesAsRead` (what `readShares` gives back); and `SharedFile`'s optional `run`, the run a walkthrough file is of. `shareReport`'s `files` and `entry.files` now hold each run's walkthrough file after the page and the Word copy, so a caller that took them for the pair gets more files.

### Changed

- **The line before the one to paste into the email, in `voicecap share`'s output, now says `To paste into the email that sends the page and its Word copy:`.** It said "…that sends them:", which read loosely once a share made more than the page and its Word copy. The line to paste is as it was.
- **`readShares`'s type says what it checks.** It gives back a `SharesAsRead`, which is exported: `{ schemaVersion: 1, shares }` with each share a `Record<string, unknown>`, since it checks only that each entry is an object. It was a `SharesFile`, with every field known. It's a compile-time change for code that reads a field of a share: it now needs to check the field first. `SharesFile` is still exported, and describes what `voicecap share` writes.
- **A new home's `.gitignore` keeps the website out of Git** (`_site/`), as it keeps `share/current.*` out. voicecap never rewrites a `.gitignore` it wrote before, so add `_site/` to an older home's by hand: `voicecap site` warns, with the line to add, when the home's `_site/` is built and the line isn't there, and never edits the file.
- **The story's timeline has a row for the website,** and "Next" now lists the evidence recorded at the PC.

### Fixed

- **`voicecap verify` no longer crashes when it names a `shares.json` entry whose time can't be made into text** (a record someone edited by hand, such as a time that's an object whose `toString` isn't a function). It says "a share" in place of naming it.

## [0.8.0] - 2026-10-03

The walkthrough file: `voicecap walkthrough` writes a run's recipe, and `--walkthrough` repeats the run, then says page by page how each page sounds against the original. The shareable page offers each run's file to download, and its Word copy says how to get it.

### Added

- **The walkthrough file**: a run's recipe in one JSON file, so anyone can repeat the run exactly: the same pages, in the same order, with the same passes and limits. The README's "Repeating a run: the walkthrough file" describes it.
  - **What it holds:** the site; every page of the run's list, in its order, with its label, template, and notes, what the original run did with it, and the fingerprint of each pass it read; the passes, each pass's step limit, the capture mode, and the readiness settings, which a repeat applies; and where it came from, which is recorded and never applied (the original run's id and seal, its dates, whether it was a replay, its page source with the fingerprints of what it read from, the versions of voicecap, the screen reader, and the browser, and its NVDA settings and browser channel). A page list's file is kept by its name only, never its folders.
  - **It's read strictly,** since it may come from anyone. voicecap refuses a file, before anything runs, and says what's wrong and where, when:
    - it isn't JSON, or has a format version it doesn't read, a key it doesn't know, or no pages;
    - it lists more than 10,000 pages;
    - a page isn't on the file's own site, or its address has a space or a control character in it, or is over 8,192 characters;
    - a page's label, template, or notes has a control character in it other than a tab or a line break;
    - the ready selector (`readySelector`) has a control character in it, or is over 1,024 characters;
    - its NVDA settings are nested more than 32 levels deep;
    - a run id has characters a run id doesn't have;
    - a step limit is over 100,000, or a readiness time is over ten minutes (600,000 milliseconds);
    - it's over 8 MB.
  - **voicecap never writes a file its own reader would refuse.**
- **`voicecap walkthrough [--site <url>] [--run <id>] [--out <dir>] <file>`**: writes a completed run's walkthrough file, from the site's latest completed run unless `--run` names one (a replayed run counts), and says where it is and how to repeat the run. It never overwrites a file, and it needs no screen reader.
  - **It stops, with exit code 1 and nothing written,** when the site has no completed run, when the run named isn't there or didn't complete, when something is at `<file>` already, and when the run can't be written as a file its own reader would accept (such as more than 10,000 pages, a step limit above 100,000, or a file over 8 MB).
  - **Write the file outside the transcripts home:** `voicecap verify` names a new folder inside a site's folder, and a file inside a run's `pages/` folder, as problems.
- **`--walkthrough <file>` on a run** repeats it: the same pages in the same order, with the same passes, step limits, capture mode, and readiness settings, all from the file (this computer's readiness settings, when the file has none).
  - **It needs no `--site`:** the site is the file's.
  - **It first says what it repeats,** before the readiness check: `Repeating run <id> of <site> from <file>: <n> pages.`
  - **NVDA's settings and the browser are this computer's,** whatever the file recorded of them. A file can come from anyone, so it never changes this computer's NVDA settings or its browser.
  - **Refused beside it,** before anything runs, since they would change what's read: `--sitemap`, `--pages`, `--page`, `--limit`, `--include`, `--exclude`, `--passes`, `--max-steps`, and a `--site` that isn't the file's own. Allowed: `--out`, `--reviewer`, `--compare`, `--run-name`, `--fresh`, and `--replay-from`.
  - **An interrupted repeat resumes** with the same file, and an edited file starts a new run.
  - **The site's scope:** a repeat of a sitemap or page-list run is a list run, in scope like a page list, and a repeat of a `--page` run is a spot check, like `--page`. The file says what its original's pages came from, so a walkthrough file trimmed by hand, from a sitemap run, becomes the scope, with its subset.
- **After a repeat that completes, voicecap says how each page sounds against the original,** page by page: `sounds the same`, `sounds different (headings, tab)` with the passes that differ, `wasn't read in the original`, or `couldn't be read now`. Then it says `<n> of <m> pages sound the same.`, and then any versions (NVDA, the browser, voicecap) and NVDA settings that differ from the original's. A page sounds the same only when every pass matches. A pass that only one of the two ran is named as not run in this repeat, or in the original, and the page isn't counted as sounding the same. The comparison is printed, and isn't stored.
- **The shareable page offers each run's walkthrough file** to download, as a new, fifth part of each run's evidence, with the command that repeats the run. Each link names its run for a screen reader. The file is carried inside the page. The Word copy can't carry a file, so it says how to get it (`voicecap walkthrough --site <site> --run <id> <file>`) and how to repeat the run. A run whose file can't be made says why.
- **Programmatic API**: `writeWalkthrough`, which writes a run's walkthrough file as `voicecap walkthrough` does (it takes `file`, `site`, `run`, and `out`, plus `logger`, and gives back the `file` it wrote, the `runId`, and the `walkthrough`); `parseWalkthrough`, which reads a walkthrough file's text strictly; `walkthroughOf`, which builds the walkthrough of a completed run's record; `walkthroughJson`, the text a file holds; `walkthroughProblem`, why `parseWalkthrough` would refuse a walkthrough, or `null`; `runAudit`'s `walkthrough` option, the path of a file to repeat (`site` is then optional); and the types `WriteWalkthroughOptions`, `WriteWalkthroughResult`, `Walkthrough`, `WalkthroughPage`, `WalkthroughSettings`, and `WalkthroughOrigin`.

### Changed

- **Runs record their readiness settings** (`settings.readiness` in `run.json`): `readySelector`, `settleMs`, and `networkIdleTimeoutMs`, as the config gave them, or as the walkthrough file did for a repeat. A run resumes only with the same settings, and these are now among them, so a change to the config's `readiness` starts a new run. A walkthrough file written from a run made before this has no readiness settings (`null`), and a repeat of it uses this computer's.
- **A run left incomplete by 0.7.0 or earlier isn't resumed.** It has no readiness settings, so its settings differ from every new run's. voicecap starts a new run instead, and says why (`Starting a new run. Not resuming <id> because its settings differ: readiness: not recorded → …`). That's said when the new run starts, and not again once a new run with the same other settings has completed: that run takes the old one's place, as a completed run with the same settings always has.
- **`PageSource` has a fourth kind, `walkthrough`, and `SourceDetails.kind` a fourth value.** It's a compile-time change for code that switches on `kind` exhaustively: it needs a case for `"walkthrough"`. The new kind holds the file (recorded as a page list's is, relative to the working folder when inside it), its `sha256`, the `run` it was made from, and `from`, what that run's pages came from: `"sitemap"`, `"pages"`, or `"urls"`, never `"walkthrough"`, since a repeat of a repeat carries its original's own. Wherever a run's page source is named (the report, a transcript's header, `--compare`, and the message about resuming), a walkthrough is named by its file, then its run.
- **A run id in a walkthrough file is read as voicecap makes one:** 1 to 100 letters, digits, `.`, `_`, and `-`. The reader refuses any other, in `original.run` and in `original.source.run`, so an id can't break a transcript's header or reach a terminal.
- **The story's timeline has a row for the walkthrough file,** and "Next" now lists the website.

### Fixed

- **A key named `__proto__` added to a sealed record now changes its seal**, as any other added key does, so `voicecap verify` and the shareable page's own check both catch it. Every seal voicecap has already written stays the same.
- **A transcript's header is written at once when a page's label, template, or notes holds a long run of spaces.** Putting each on one line took seconds for 150,000 spaces, and far longer for more, which a page list or a walkthrough file can hold.
- **Two pages that would be saved under the same name are refused with a plain message** that names both addresses, instead of an error with its stack trace.
- **The shareable page's and the Word copy's commands quote a site address that needs it,** such as `http://[::1]:4848`, whose brackets a Mac's shell would otherwise read as a pattern.

## [0.7.0] - 2026-10-03

The Word copy of the shareable page, and `voicecap share`: dated copies to send, each recorded with its fingerprint, and what `voicecap verify` checks of them.

**A home made with 0.6.0 needs two small changes.** 0.6.0's README said to keep a copy of the file you send. A copy kept in `share/` by hand is now named by `voicecap verify` as `not recorded in shares.json`: move it out of `share/`. From now on, `voicecap share` makes and records the copies. Also, that home's `.gitignore` doesn't keep Word's lock files out of Git: add `~$*` to it.

### Added

- **The Word copy, `share/current.docx`**, beside the shareable page in every site's folder: the same sections and numbers, nothing folded, with tables where the page has charts, made for paper and for Word's navigation pane. The README's "The Word copy" describes it.
  - **What's in it:** a title, "Screen reader test results", and the date and time it was made, then the site's name and address; the page's ten sections in its order, then a last heading, "About this report", over the footer's lines. It has no fingerprint check, which a Word document can't do; where the page has its check, it says what a reader can do instead: compare the file's own fingerprint with the one its sender recorded, or run `voicecap verify`.
  - **When it's written:** wherever the page is, so when a run completes, and after `voicecap review`, `voicecap manual add`, and `voicecap report`. `voicecap report` now also prints `Word copy: <path>` after `Shareable page: <path>`, each only when its file was written. In the programmatic API, `generateReport`, `addReview`, and `addManualSession` write it too, as well as the page (`addReview` and `addManualSession` write neither when `regenerateReport` is `false`).
  - **A file that can't be written is a warning,** and neither file stops the other being written. On Windows, when Word holds `current.docx` open, a run, review, or report still finishes in about a second, with the page written, and a warning says the Word copy wasn't updated: `current.docx` couldn't be replaced (with the error's code in parentheses), as happens while it's open in Word. It says to close it, then gives the exact command to run. The command names the site and the transcripts home, so it works in a home of several sites, and in a home given with `--out`: `npx @icjia/voicecap report --site <url> --out <home>`.
- **`voicecap share [--site <url>] [--out <dir>] [--reviewer <name>]`**: makes a dated pair of copies of the shareable page and its Word copy, to send, in the site's `share/` folder, and records them in `share/shares.json`.
  - **The copies are dated:** named for the site's folder and the day, such as `dvfr.illinois.gov_2026-10-02.html` and `.docx`. A second share the same day takes `-2`, then `-3`. A copy is never overwritten, and a name `shares.json` records is never used again, even when the copy with that name has been deleted. Each copy's footer names the other by its dated name.
  - **It prints what it made:** each copy's path, size, and SHA-256, then a line to paste into the email that sends them: `Fingerprints (SHA-256): <page's name> <its fingerprint>; <Word copy's name> <its fingerprint>. To check a file you received: Get-FileHash <file> in PowerShell, or shasum -a 256 <file> on a Mac. PowerShell shows the same letters in capitals.`
  - **Sizes** are in KB, with thousands separators, while the rounded size is under 1,024 KB, and in MB with one decimal from there. Each comes with its exact bytes, as in "310 KB (317,440 bytes)". A copy over 20 MB gets a warning that it's too big for most email.
  - **It stops, with exit code 1 and nothing written,** when there's no name for who is sharing (taken as `voicecap review` takes it: `--reviewer`, then `VOICECAP_REVIEWER`, then `git config user.name`, then `reviewer` in the config), when no completed, sealed, live run counts, and when it can't read `shares.json`.
- **`share/shares.json`**, the record of what was sent: an entry for each share, with its `seq` and `prev`, when (`at`) and who (`by`), the runs the copies drew on (`runs`, oldest first), and each copy's `name`, `bytes`, and `sha256` (`files`). Entries are sealed (`seal`) and chained as `reviews.json`'s are, and never edited or deleted. The dated copies and `shares.json` go into Git with the rest of the record, and `current.*` stays out.
- **`voicecap verify` checks what was shared:**
  - `share/shares.json`'s seals and chain;
  - each copy it records, which is a problem when it's missing, or has changed since it was recorded;
  - any other file or folder in `share/` that nothing records, such as a dated copy that `shares.json` doesn't name.

  It passes over `current.html`, `current.docx`, names that start with a dot, the files an operating system adds, and Word's lock files (`~$…`).
- **Programmatic API**: `shareReport`, which makes the dated pair as `voicecap share` does (it takes `site`, `out`, and `reviewer`, plus `logger` and `config`, and gives back `siteDir`, the `entry` it recorded, each copy's `path`, `name`, `bytes`, and `sha256` in `files`, and `pasteLine`, the line for the email); `readShares`, which reads a site's `share/shares.json`; and the types `ShareReportOptions`, `ShareReportResult`, `ShareEntry`, `SharedFile`, and `SharesFile`.
- **`pnpm share:fixture <folder>`**, for development: writes the demo's shareable page and its Word copy into a folder, to look at a change to either. It needs no screen reader.

### Changed

- **The page's story, "How voicecap came to be", opens with why voicecap was needed:** more than a dozen websites to review before the April 2027 ADA Title II deadline for accessible digital content. Its timeline has a row for the Word copy and `voicecap share`, and "Next" now lists the walkthrough file and the website.
- **The README's Credits tells that story,** with Guidepup as the starting point of voicecap.
- **The page's footer names its Word copy:** "This file: current.html. Its Word copy: current.docx." The Word copy's footer names the page the same way.
- **"What the check proves," in the page's evidence, says where the sender's fingerprint comes from:** `voicecap share` prints it, ready for the email that sends the file.
- **`voicecap verify`'s summary line counts shares:** "dvfr.illinois.gov: 3 runs (1 incomplete), 2 manual sessions, 4 reviews, 1 share checked: everything matches."
- **`docx` is a new dependency,** pinned at 9.8.1. It makes the Word copy, and it's loaded only when a Word copy is made.
- **The `.gitignore` a new home gets keeps Word's lock files out of Git** (`~$*`), as it keeps `share/current.*` out. voicecap never rewrites a `.gitignore` it wrote before, so add `~$*` to an older home's by hand.
- **`voicecap verify` passes over Word's lock files** (`~$…`) in `share/`. Word keeps one beside a document it has open, such as a sent copy someone is reading.

## [0.6.0] - 2026-10-02

The shareable page, and a way to check a computer first: `share/current.html` in every site's folder, what each run now records for it (every failed attempt, the computer, and whether the person heard NVDA speaking), and `voicecap preflight`.

### Added

- **Each page's title**, as the browser reports it, in the page's record in `run.json` (`title`). A page with no title, or one that was tried but never loaded, has none (`null`), and so does every page of a replayed run.
- **Every failed attempt at a page, with its cause.** A page's record (`failedAttempts`) lists every attempt that failed, in every session of the run, including those a later attempt made good. Each is written to `run.json` as it happens, before the screen reader and browser are started again, so Ctrl+C, a closed window, a crash, or a restart that fails doesn't lose it.
  - Each keeps its number, counted across the sessions; when it started and ended (local time, to the millisecond); the pass, the step, and the command it sent (`nextLine`, say, or `openPage` for a page that didn't open); the error's message; and whether the screen reader and browser were started again for the next attempt.
  - Each keeps why it failed, as a code: `foreground`, `locked`, `screen-reader-stopped`, `browser`, `http`, `unreachable`, `open-timeout`, `step-timeout`, `page-timeout`, or `unexpected` (the README's "What each run records" says what each means). A browser window closed mid-page, a browser that crashes, a page that crashes once it has opened, and a browser that isn't installed are the browser's (`browser`). A page that crashes during navigation can still be recorded as `unreachable`: the browser reports the failed navigation (`net::ERR_ABORTED`) before it reports the crash. A configured `readySelector` that never appears is a page that didn't open in time (`open-timeout`).
  - An unexpected error, which may be a fault in voicecap itself, also keeps its stack, with the home folder replaced by `%USERPROFILE%` (or `~`).
- **Whether NVDA was heard.** When a session that read pages ends, voicecap asks at the terminal, once NVDA has stopped: "Did you hear NVDA speaking as it read these pages?" It says, with the question, that NVDA speaks very fast during a run, so the words are hard to follow, and that the transcripts have every word. The answers are "Yes, the whole time", "Part of the time", and "No", typed as 1, 2, or 3; Enter picks No. The session's record in `run.json` keeps the answer (`listener`), with when voicecap asked and when it was answered, beside the reviewer recorded since 0.5.0 and the session's page count (`pagesDone`). The session's end is written before the question, and the run's seal covers the answer.
  - It's asked however the session ends: when the run completes; after Ctrl+C; when the run stops after too many failed pages in a row; and when an error ends it, after a line that says why (the full explanation follows the answer).
  - Only an answer typed after the question appears counts: keys pressed during the run are dropped before it shows.
  - Ctrl+C at the question, or closing the window, gives no answer; the record then has none.
  - It isn't asked without a terminal (a script, or CI), or when the output is redirected to a file; in Git Bash's own window (mintty), which doesn't always let Node see a terminal (run voicecap in PowerShell or Windows Terminal to be asked); for a replay; or for a session that read no pages. `voicecap demo` doesn't ask.
- **The computer's details**, in each session's environment record (`machine`), and never the computer's maker, model, or name, or the account's name:
  - the operating system: edition, version, build with its update revision, and architecture;
  - the processor: name, base speed, physical cores, and logical processors;
  - memory, and the display: resolution and refresh rate, and on Windows its scaling;
  - the browser window's fixed size: 1280 × 960 (none for a replay);
  - the time zone and its offset, and the display language;
  - the versions of Node.js, voicecap, Guidepup, and Playwright.
- **Programmatic API**: `runAudit` takes `askListener`, a function called when a session that read pages ends, however it ends (never for a replay), and given `{ screenReader, pagesRead }`. It asks whether the person heard the screen reader speaking, and resolves to `"all"`, `"part"`, or `"no"`, or to `null` for no answer. Without it, nothing is asked.
- **The shareable page, `share/current.html`**, in every site's folder: one file to send to a manager or an auditor, with the site's standing from its sealed runs, the person's review, every problem with its record, and a fingerprint check that works offline. The README's "The shareable page" describes it.
  - **When it's written:** whenever the site's `report.html` is, so when a run completes, and after `voicecap review`, `voicecap manual add`, and `voicecap report`. `voicecap report` now also prints `Shareable page: <path>` after the report's path. In the programmatic API, `generateReport` writes it too, and so do `addReview` and `addManualSession`, unless `regenerateReport` is `false`. A page that can't be made or written is a warning, never a failed run, review, or report.
  - **One self-contained file:** its styles, fonts, and data are inside it, and nothing is loaded from outside. The fonts are IBM Plex Sans, Sans Condensed, and Mono, under the SIL Open Font License, whose text ships with voicecap. The page is dark by default, with a light version, and prints light. Its details are folded behind lines that say what's inside; "Open every section", and printing, open them all.
  - **What's in it, in order:** the summary, which leads with the person's review (that they heard NVDA speaking, what they found, and what they fixed, only as far as the records say so) and says what voicecap does and what the person running it does; how voicecap works; every page; what the flags found; what changed since the run before; problems during the runs; what the results cover; the evidence; how voicecap came to be; and every transcript, word for word.
  - **Only completed, sealed, live runs count.** A replayed run, an interrupted or unfinished run, a completed run with no seal, and a run whose `run.json` can't be read are left out of every result, and the page lists each with why. With no run that counts, the page says so.
  - **The pages in scope** are those of the latest run that counts whose pages came from a sitemap or a page list. A later run given its pages with `--page` is a spot check: its transcripts and failures are each page's newest, but it doesn't change which pages are in scope. A page whose latest attempt failed is said beside its last good transcripts, and is a task.
  - **Every problem during the runs:** every failed attempt in the runs the page draws on, including those a later attempt made good. Each has its kind (another window took the screen, the computer locked, NVDA stopped, the browser stopped, the website answered with an error or couldn't be reached, a step took too long, or an unexpected error, which may be a fault in voicecap itself), and what it means for the results. Whether it happened again is judged by what came after it: a run before it that read the page shows only that the page could be read. The record of each is shown word for word, with the home folder replaced by `%USERPROFILE%` (or `~`).
  - **What changed since the run before:** the pages that sound different, line by line, with the changed words marked. Pages that sound the same are counted, not listed.
  - **"Check the fingerprints"** checks, with no network, every transcript the page shows against the fingerprint in its run's sealed record, each run's seal, and each review's seal and the review chain, and that the text each transcript shows is the file the page carries. "Show a change being caught" does the same on a copy with one character changed, in memory only. The page says what the check proves and what it can't, and names the two stronger checks: the file's own fingerprint, and `voicecap verify` on the originals.
  - **"Not recorded":** where a run didn't record something the page shows, the page says so, and says why (usually, which voicecap made the run), and never leaves a blank.
  - `voicecap verify` leaves the `share/` folder alone: the page is made again from the records each time, and `verify` checks the records themselves.
  - The transcripts home's `.gitignore` keeps `share/current.*` out of Git, since it's written again after every run and review. voicecap never rewrites a `.gitignore` it wrote before, so add `**/share/current.*` to an older home's by hand.
- **`report.siteName`**, a new setting: the site's name, as the shareable page's headline. It names every site the config is used with, so use a config per site for different names. Without it, the headline is the home page's title as the latest run recorded it, then the site's host name.
- **`voicecap preflight`**: checks this computer and says how to fix anything that isn't ready, without starting the screen reader.

### Changed

- **A page's `attempts` counts each attempt as it ends,** across sessions, those before a Ctrl+C included. An attempt that Ctrl+C stopped midway still isn't counted.
- **The README starts with a Quick start in three steps:** check the computer with `voicecap preflight`, fix what it lists, then `voicecap init`. It says why voicecap is an npm package, why PowerShell is preferred to Git Bash on a PC, and why it's a command-line app. Its long reference sections are folded, each behind a line that says what's inside. "How voicecap works", its diagram, and Known limitations now say that NVDA speaks very fast during a run, and that the person reads the transcripts. It ends with Credits: a hat tip to Guidepup, where voicecap began, and to NVDA, Playwright, and IBM Plex.
- **The README's Windows setup is written for PowerShell,** Windows Terminal's default. It says what to do when a new PC's PowerShell refuses to run `npx` ("running scripts is disabled on this system"). Git Bash still works: "Git Bash and paths that start with "/"" is its note.
- **The fix for a Windows user folder that NVDA can't start from** (a space, or one of `& ( , ; = ^`, in its path) gives each command a step of its own. The commands are written the same for PowerShell and Git Bash, so each can be pasted as it is.

## [0.5.0] - 2026-09-30

A guided demo, and what the checks on a real Windows PC found: `voicecap demo`, a failed page tried up to 5 times, the reviewer's name on every run, and four fixes.

### Added

- **`voicecap demo`, a guided first run** against a small demo site that comes with voicecap and runs only on this computer. Seven steps, each explained and each waiting for Enter: the welcome, this computer's checks, the live test, an audit of the demo's seven pages (showing the command it runs), the transcripts, the report (with an offer to open it), and what to do next. Its files go in `voicecap-demo/` in the current folder. On a Mac, until the VoiceOver driver, it runs the checks and the VoiceOver live test, then says what the audit will do; a Windows PC runs the full tour.
- **Runs record who ran them.** A run takes `--reviewer <name>`, and each session's record in `run.json` names who ran it and where the name came from, sealed with the run, so a run someone else resumes names both. Without `--reviewer`, the name comes from `VOICECAP_REVIEWER`, then `git config user.name`, then the config's `reviewer`, as for `voicecap review`. With none, the run goes ahead, says so, and records that no name was given. The report's table of sessions shows who ran each.
- **`voicecap init` asks for the reviewer,** after the transcripts home. Enter takes `icjia`, a quick default, or `VOICECAP_REVIEWER` when it's set; a person's name can be typed instead. The command it composes ends with `--reviewer <name>`, easy to change for someone else.
- **Programmatic API**: three options on `runAudit`. `preflight` takes the checks' result from a caller that has just run them, so a real run doesn't check again. `again` names the command that starts over, which an interrupted or stopped run then gives in place of "run the same command again to resume". `voicecap demo` uses both. `reviewer` is the name each session records, as `--reviewer` gives it.

### Changed

- **A page that fails is tried again, up to 5 times in all,** each time with NVDA and the browser started fresh. The limit is the new setting `pageAttempts`.
  - It covers a timeout, NVDA or the browser not responding, and another window taking the foreground.
  - Before, only a timeout or a server error got one retry, and a page that lost the foreground failed at once.
  - Every attempt is kept under `attempts/`, and the page's record names each failed attempt's reason.
  - A page the site answers with an HTTP 4xx still gets one try.
- **The README** says the checks take about three seconds, as measured on a Windows PC, not two.
- **The README, the package description, and `voicecap --help`** present voicecap as what it is: a listen-through with a real screen reader, the other half beside automated checkers such as axe and Lighthouse. What it does on its own is press the screen reader's keys and move from page to page.
- **The README has a new section, How voicecap works:** six steps, a diagram, and the first lines NVDA said on the demo site. It presents voicecap as a human review, sped up: voicecap presses the keys and turns the pages, and the person running it listens, reads the transcripts, and fixes what they find. Working from the list, voicecap accounts for every page on it, with none missed or done twice.
- **The README says when to run voicecap,** with a diagram: on the deployed site before it goes live, and again after a major update, not on every build during development.

### Fixed

- **voicecap turns an installed NVDA back on.** An installed NVDA runs with UI Access, at a higher integrity level than voicecap, and the way voicecap asked Windows for its path (WMI's `ExecutablePath`) came back empty. So after a run or the live test, voicecap couldn't start it again, and said to start it by hand. voicecap now reads each `nvda.exe`'s path with `QueryFullProcessImageName`, which Windows allows. Found on Windows 11 with NVDA 2026.2.
- **The `unlabeled` flag no longer flags labeled form fields in the read pass.** In browse mode, NVDA reads a form field's label as separate text, on the field's line or the line before, so a read-pass line with only "edit" can belong to a labeled field: the demo's labeled textarea was flagged. Form fields (edit, combo box, check box, radio button) now count only in the tab pass, where NVDA says the name first. The new setting `flags.unlabeled.tabOnlyRoles` lists them. `voicecap report` recomputes earlier runs' flags with the new rule.
- **Chrome that updates itself as voicecap starts it.** With an update waiting and no other Chrome open, the Chrome voicecap started handed over to a new copy of itself, which finished the update and went on with voicecap's profile. voicecap said "Chrome didn't start: it exited (0)" and left the profile behind. Now it closes that copy, says so, and starts Chrome again, once.
- **After a closed terminal window, your NVDA starts once Guidepup's has quit.** The helper that starts your NVDA as voicecap exits now waits, for up to 20 seconds, until Guidepup's NVDA has quit. Before, it could start yours while Guidepup's was still quitting.

## [0.4.1] - 2026-09-29

### Added

- **`--sitemap` takes a sitemap's name or path**, such as `--sitemap sitemap.xml`, `/sitemap.xml`, or `/sitemaps/pages.xml`, read on the site from its root, as `--page` paths are, in runs and `list-urls`. A full URL works as before. A run records the sitemap's full URL, so resuming with its name or its full URL finds the same run. An address given without `https://`, such as `--sitemap dvfr.illinois.gov/sitemap.xml`, is refused before anything is fetched, with the full URL to give instead. In Git Bash, a `--sitemap` that begins with `/` is caught and explained, suggesting the name without the slash.
- **`init` offers every sitemap a site has**: each one its `robots.txt` lists, then `/sitemap.xml`, each labeled with where it was found. A site with one sitemap sees the same menu as before. "A sitemap at another address" now asks for `Sitemap (a full URL, or a name like sitemap.xml)` and takes a name such as `sitemap.xml`; the command `init` composes still has the full URL.
- **Programmatic API**: `runAudit`'s and `listUrls`'s `sitemap` take a name or path, read on `site` from its root.

### Changed

- **The README** says plainly what works on Windows and on a Mac, has a walkthrough for each, and corrects examples that were wrong or would break when pasted into Git Bash or a Mac's terminal.

## [0.4.0] - 2026-09-29

### Added

- **A preflight check at the start of `init`**: before any question, it shows this computer's own details (hardware, screen reader, browser, and paths) and runs quick checks that decide whether NVDA (on Windows) or VoiceOver (on a Mac) is ready, in about two seconds. The checks only read, except on a Mac, where the Full Disk Access check creates and removes a small file, and the System Events check can raise macOS's prompt, which `init` warns about first. A computer that isn't ready stops there with exit code 2 and a numbered, plain-language diagnosis — what's wrong, and how to fix it — for each problem; a ready one, at a terminal, can try a 20-second live test before the wizard's usual questions.
- **`voicecap setup` and `voicecap doctor` on macOS**: `setup` installs Guidepup's own VoiceOver files and the browser, turns off VoiceOver's welcome screen and turns on VoiceOver's own AppleScript setting (saying how to undo each), then walks through any missing permission — VoiceOver Utility's AppleScript checkbox, Accessibility, Automation for System Events, and Full Disk Access — one at a time, opening System Settings at the right page and naming the terminal app that needs it. `doctor` checks the same things on either platform and always runs the live test, printing one report fit to paste into a bug report. Real VoiceOver runs still wait for the VoiceOver driver, coming in a later release.
- **The live test**: a 20-second check that starts NVDA or VoiceOver for real, brings the browser to the front, and confirms the screen reader can be heard, then puts everything back. It cleans up on Ctrl+C too, and when the terminal window is closed, it stops the test and cleans up as Ctrl+C does. `init` (at a terminal) offers it after a passing preflight, `setup` offers it at the end, and `doctor` always runs it, each with a hands-off warning first.
- **Restoring the person's own screen reader**: voicecap notes whether NVDA or VoiceOver is already running before it takes it over, and turns it back on afterwards with the person's own settings — after the live test on both platforms, and after every real NVDA run on Windows. If it can't, it says so and how to do it by hand.
- **Quick checks before a real run**: before NVDA starts, a run does the same checks `doctor` does (about two seconds). A computer that isn't ready exits 2 with the "Not ready" diagnosis before the site folder, the run lock, or NVDA are touched; a ready one gets one pass line plus any warnings.

### Changed

- **`init` now starts with the preflight** described above, before its usual questions.
- **`doctor`'s output now leads with this computer's own details, and gives each failing check a numbered, plain-language diagnosis with fix steps**, in place of the previous one-line-per-check summary.
- **`setup` on Windows now ends with the same preflight**, and exits 2 when the computer still isn't ready (it used to exit 0).

### Fixed

- **On a Mac, the browser voicecap starts no longer asks for the login keychain.** Chrome for Testing asked for its Safe Storage key as each new profile opened, macOS showed an approval dialog, and every page load waited for the answer. voicecap now starts the browser with `--use-mock-keychain`, as Playwright does on macOS.

## [0.3.1] - 2026-09-28

### Fixed

- **On Windows, a path written Git Bash's way (`/c/Users/me/…`) is read as that Windows path** by `--out`, `VOICECAP_TRANSCRIPTS`, `--pages`, `--replay-from`, `manual add`, and `list-urls`, as `init` already did. Git Bash translates these itself, but not with `MSYS_NO_PATHCONV=1` set (the fix voicecap suggests for `--page /about`), and voicecap then read `/c/Users/me` as `C:\c\Users\me`.

## [0.3.0] - 2026-09-28

The audit record: one transcripts home with a folder per site and per day, records that `voicecap verify` can check, `voicecap init` to set up a run, and `--page`.

### Added

- **`voicecap verify [--site <url>] [--out <dir>]`**: checks the records in the transcripts home against their seals and recorded hashes. A completed run's `run.json`, each manual session's `session.json`, and each review entry now carry a `seal` (a SHA-256 of the record itself); review entries also carry `seq` and `prev`, chaining the whole review history. `verify` checks every site's runs (their seals and every recorded page file), manual sessions (their seals, transcripts, and kept raw copies), and the review chain, printing one line per problem it finds and exiting 0 when everything matches, 3 when something doesn't. It catches an edited record, a reordered review entry, and a deleted entry that a later entry follows. Deleting the newest review entries, or a whole run or manual session, leaves nothing for `verify` to find: only Git history shows it.
- **Programmatic API**: `verifyHome`; `resolveHome`, `siteFolder`, `siteDirFor`, and `chooseSiteDir`, to find a site's folder in the transcripts home; `siteDir` and `runDir` on `runAudit`'s result; `site` on `addReview` and `addManualSession`; and `env` and `pageUrls` (`--page`'s values: full URLs or root-relative paths) on `runAudit`.
- **`voicecap init`**: answers a few plain questions (the website, where its pages are, how many, and the transcripts home) and prints the finished `npx @icjia/voicecap …` command, ready to copy, keep, and run again to resume. It offers to run the command right away on a computer that can (Windows, with voicecap's own NVDA installed). `voicecap` with no arguments starts `init` too, in a terminal; without one (scripts, CI, and sometimes Git Bash's own window), the "Missing --site" usage error stays, now pointing to `init`.
- **`--page <url>`**: a third, repeatable page source for a run, alongside `--sitemap` and `--pages`. Each value is a full URL or a root-relative path, resolved against `--site`, and goes through the same off-origin, non-HTML, and duplicate handling as the other sources; `--include`, `--exclude`, and `--limit` still apply. It's recorded in `run.json` and every transcript, and described consistently in the report, transcript headers, run comparison, and resume.

### Changed

- **The transcripts home now holds one folder per site**, each with its own dated run and manual-session folders (`<site>/<date>/<time>/`, `<site>/<date>/<time>_manual_<slug>/`), `reviews.json`, live report, and `compare/`, instead of one shared `runs/` and `manual/` folder. The home now comes from `--out`, else the `VOICECAP_TRANSCRIPTS` environment variable, else `./transcripts`.
- **`review`, `manual add`, and `report` take `--site <url>`** to pick the site's folder; without it, the site comes from a full `--page` URL, else the home's only site folder (a usage error names the folders when there are several and neither is given).
- **A retried or resumed page keeps its earlier attempt**, moved to `attempts/<slug>/<n>/` in the run's folder instead of being overwritten; reports and comparisons ignore it.
- **`.gitattributes` and a new `.gitignore`** are written at the home's top the first time they're needed, and never overwritten, so the owner's own edits stay. `.gitignore` keeps out manual sessions' raw NVDA logs (`**/*_manual_*/raw/`), which can hold typed passwords, along with the run lock (`.voicecap.lock`), the temporary files a crash can leave behind (`.*.tmp`), and the files an operating system adds to folders (`.DS_Store`, `Thumbs.db`, `desktop.ini`).
- **voicecap 0.2.0's `runs/` and `manual/` folders, if a home still has them, are no longer read or moved**; a run notes once that it saw them and left them alone.
- **`generateReport`'s `outDir` now means a site's folder** in the transcripts home, not the home itself, which breaks 0.2.0 callers: pass `runAudit`'s `siteDir`, or find one with `resolveHome` and `siteDirFor`.
- **`PageSource` has a third variant, `{ kind: "urls"; urls: string[] }`**, for a run's `--page` pages (their resolved URLs, in the order given), recorded in `run.json` and in each transcript's environment record. It's a compile-time change for TypeScript code that switches over `PageSource`'s `kind` exhaustively: add a case for `"urls"`.

## [0.2.0] - 2026-09-27

Phase B: the real NVDA driver, checked end to end with NVDA 2026.2 and Chrome 153 on Windows 11.

### Added

- **The Guidepup NVDA driver** (`driver: "guidepup"`, the default; Windows only): NVDA through `@guidepup/guidepup` 0.34.0, with the browser driven by Playwright.
  - Every page load gets a new browser with a new profile, so no page's transcript depends on the pages before it.
  - Keystrokes go to the browser, and another window's speech never ends up in a transcript. For every load, the driver brings the browser to the front and confirms it with NVDA+T, and every step checks that the page kept focus. A step during which another window came forward, even briefly, is discarded as a foreground error; a window that comes forward in the moment before a keystroke can still receive that one keystroke. Tabbing into and out of a frame (an embedded video, map, or form) isn't mistaken for another window.
  - The tab pass starts at the first focusable element: its first Tab goes to the browser directly. Through NVDA in browse mode, it would skip the element under NVDA's cursor, usually the skip link.
  - The environment record has Guidepup's NVDA build, the NVDA version, NVDA's language, the browser, the Windows version, and NVDA's speech-related settings (the values that differ from NVDA's defaults). If the browser updates itself during a run, the page being opened fails, and voicecap stops (exit code 2) when it restarts the browser for the next page, rather than record a version that's no longer true. Running the same command again resumes with the new version recorded (on the last page, the run completes with that page failed, exit code 3).
  - If NVDA dies during a run, or Guidepup loses its connection to it, the step fails instead of being recorded as silence, and voicecap restarts NVDA and the browser.
  - Only one voicecap drives NVDA at a time (per Windows user). voicecap warns before it shuts down an NVDA that's already running. It takes its lock before it shuts down NVDA and closes browsers that a crashed run left behind, so it never disturbs a voicecap that's running.
  - NVDA is stopped exactly once, by voicecap: Guidepup's own signal handlers are removed, and a hung Guidepup stop falls back to shutting NVDA down directly. A stop can come at any moment (Ctrl+C, a timeout): browsers still starting are killed, a start still under way is given a moment to finish and then shut down, NVDA is shut down before the browsers (so a key it was about to send can't reach the window that comes forward), and every browser launched is closed. NVDA and the browsers are also shut down when the process exits, including on a second Ctrl+C; after a hard kill, the next run cleans up.
  - Downloads are refused, so a link to a file doesn't put it in your Downloads folder.
  - While it runs, voicecap keeps Windows from sleeping or turning the screen off (and locking because of either), as video players do. On a locked computer (Win+L, a screen saver, a lock policy), NVDA can't press keys or speak; voicecap then says "Windows is locked" instead of blaming another window.
- **`voicecap setup`**: installs the NVDA build that voicecap's pinned Guidepup expects, with voicecap's own pinned `@guidepup/setup` 0.28.0. It installs Playwright's Chromium if that's the configured browser, or if the configured browser isn't installed. It explains the fix when the install folder's path has a space or another character the Windows command shell splits or changes it at (`& ( , ; = ^`, `%NAME%`): Guidepup can't start NVDA from such a path.
- **`voicecap doctor`**: checks Windows, Node.js, the NVDA build, other running NVDA copies and voicecaps, whether Windows is locked, the browser, speech capture, the foreground check, and NVDA's language, and prints a summary to paste into a bug report. Exits 2 if something voicecap needs doesn't work. Its live check has a run's timeouts, and Ctrl+C shuts NVDA and the browser down (exit code 130).
- **`pnpm test:nvda` and `pnpm fixture:capture`** (Windows, for development): run voicecap with real NVDA on the fixture site and check end-of-page detection (including the page with duplicate lines), "no next heading", the tab pass starting at the skip link, complete capture compared with NVDA's Speech Viewer, and tabbing into and out of a frame. `fixture:capture` then replaces the fixture's recorded run.

### Changed

- The fixture's replay run is now a real NVDA run, with a real Speech Viewer capture, in place of the hand-written one. `pnpm fixture:replay` and `fixture/replay-src/` are gone; `pnpm fixture:reviews` rebuilds the sample `reviews.json`.
- The flag phrasing was checked against real NVDA output; no rules needed changing. The fixture README records what NVDA 2026.2 actually says, including two differences from Phase A's source-based expectations: an image without alt text is read ("Unlabeled graphic"), and transcripts have NVDA's names for symbols (`copyright`, `bullet`).
- voicecap now needs Node.js 22.19 or later (`@guidepup/setup` requires it).
- `playwright` is now a dependency, and `@guidepup/guidepup` and `@guidepup/setup` are pinned exactly.
- The repository moved to [github.com/ICJIA/voicecap](https://github.com/ICJIA/voicecap), and the copyright holder is now the Illinois Criminal Justice Information Authority (ICJIA).

### Fixed

- `publish.sh --dry-run` no longer logs you in to npm: without a login it warns and carries on, so a dry run changes nothing. The whole dry run was checked in Git Bash on Windows.

## [0.1.0] - 2026-09-26

### Added

Phase A: everything except the real NVDA driver, working on Windows, macOS, and Linux with the replay driver.

- **Runs.**
  - `voicecap --site … --sitemap …|--pages …` with `--limit`, `--include`/`--exclude` (globs, or `re:` regular expressions; leading slash optional), `--passes`, `--max-steps`, `--compare`, `--fresh`, `--out`, `--run-name`, and `--replay-from`.
  - Exit codes 0, 1, 2, 3, and 130.
- **Page sources.**
  - Sitemaps (`<urlset>`, nested `<sitemapindex>`, gzip) and page lists (JSON, and CSV including CRLF, BOM, and Windows-1252 with a warning), with line numbers for bad entries.
  - URL normalization and deduplication; off-origin, non-HTML, and redirect handling.
- **`voicecap list-urls`**, to export a sitemap as a page list or draft a curated sample with `--sample N`.
- **Passes** with the stop logic in the core:
  - `read`: end of page detected from the repeated last line, with a confirmation step and container-context matching.
  - `headings`: stops on "no next heading".
  - `tab`: stops when focus leaves the page. It records the focused element (tag, role, name, link target, inside main) and warns about focus set on load.
  - Every pass has a repeat safety net and step caps.
- **Output.**
  - One immutable folder per run, with TXT and JSON transcripts. Each TXT is a header block with the full environment record, then one line per step.
  - Deterministic, Windows-safe page slugs.
  - SHA-256 of every file, plus content hashes of each transcript body.
  - `latest.txt`, and a `.gitattributes` that keeps Git from altering transcripts.
- **Reliability.**
  - Resumable runs: a settings hash, atomic `run.json` writes with Windows retries, and per-session environment records.
  - Per-step and per-page timeouts, with a driver restart and one retry.
  - Restarts every N pages, and a stop after too many consecutive failures.
  - Clean Ctrl+C handling and a run lock.
- **Reviews**: `voicecap review`, an append-only history per page in `reviews.json`, reviewer name resolution, and "changed since review".
- **Manual sessions**: `voicecap manual add` for Speech Viewer text and NVDA Input/output logs.
  - Timestamps, midnight crossings, `--from`/`--to`, and `--date`.
  - Raw copies with hashes (`--no-raw`); `--redact-typing` with raw copies withheld (`--keep-raw`); privacy warnings.
- **Report**: a self-contained, accessible HTML report with a summary, per-page table, filters (they work without JavaScript), review history, manual sessions, environment, and `--compare` with separate diff files and environment-difference warnings. There is a live report plus a snapshot per run, and `voicecap report` regenerates it.
- **Heuristic flags**, configurable, with custom phrase rules: generic link text, unlabeled items, read pass not finished, headings, tab with no stops, a long run before main content with no skip link, and repeated phrases.
- **Configuration** in `voicecap.config.ts`/`.mts`/`.js`/`.mjs`/`.json`, validated, with defaults and a recorded hash.
- **Drivers**: the replay driver, a W3C AT Driver stub, and the `ScreenReaderDriver` interface.
- **Programmatic API**: `runAudit`, `listUrls`, `addReview`, `addManualSession`, `generateReport`, `loadConfig`, `defineConfig`, and the data-format types.
- **Test fixture**: a static site with a flawed page and a duplicate-lines page, sitemaps, page lists, a sample review history, a Speech Viewer capture, an NVDA log excerpt, and a hand-written replay run with its generator.
- **Tests and CI**: a Vitest suite (including axe-core checks of the generated report) and GitHub Actions CI on Ubuntu, macOS, and Windows.
- **`publish.sh`**: publishes to npm only after every check passes, including installing and running the packed tarball.

### Not yet

- The Guidepup NVDA driver, `voicecap setup`, and `voicecap doctor` (Phase B, on Windows).

[Unreleased]: https://github.com/ICJIA/voicecap/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/ICJIA/voicecap/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ICJIA/voicecap/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/ICJIA/voicecap/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/ICJIA/voicecap/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ICJIA/voicecap/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/ICJIA/voicecap/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/ICJIA/voicecap/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ICJIA/voicecap/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ICJIA/voicecap/releases/tag/v0.1.0
