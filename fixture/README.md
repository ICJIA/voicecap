# voicecap test fixture

A tiny fictional agency site plus everything voicecap needs to test itself without NVDA: page lists, a run to replay, sample reviews, manual-session captures, and a run with NVDA's own log, cleaned.

The run in `replay-run/` is **real**: voicecap's Guidepup driver running NVDA 2026.2 with Chrome 153 on Windows 11, captured with `pnpm fixture:capture`. Its environment record says exactly what produced it. Everything on the site itself is fictional.

## Contents

| Path | What it's for |
| --- | --- |
| `site/index.html` | A well-built home page: skip link, landmarks, one h1, a labeled search field, and two lists of links. |
| `site/duplicates/index.html` | End-of-page detection. It has two identical consecutive lines ("Applications are due October 31."). Its last line ("Back to top", at the end of the footer) also appears earlier on the page. |
| `site/flawed/index.html` | Deliberately flawed page. No skip link, and 12 focus stops before main content. The first heading is an h2. It has three "Read more" links and one "Click here" link. It also has an image without alt, an image-only link without alt, an unlabeled text field, and an icon-only button with no name. |
| `site/frames/` | A page with a link, a frame from the same site, a frame from another site (the same server as `localhost`, so Chrome runs it in its own process, as it does embedded videos and maps), and another link. Not in the sitemap: only `pnpm test:nvda` and the Chrome session tests use it, to check that Tab goes into and out of frames without a foreground error (focus moving into a frame blurs the page's window). |
| `site/files/annual-report.pdf` | A tiny valid PDF, listed in the sitemap so voicecap skips it by extension. |
| `site/images/chart.png` | The image the flawed page uses. |
| `site/feed/feed.xml` | Served at `/feed/` as `application/rss+xml`: a URL with no file extension whose response isn't HTML. |
| `site/sitemap.xml`, `site/sitemaps/*.xml` | A `<sitemapindex>` with two child sitemaps. They list the three pages; `/contact/`, which redirects to another origin; `/feed/`; an off-origin URL; and the PDF. |
| `site/404.html` | The server's not-found page. |
| `pages.json`, `pages.csv`, `pages-windows-1252.csv` | Page lists covering a subset of the site. They include a relative path, labeled entries, and an invalid row. The CSV files keep Windows line endings, and the last is in Excel's Windows-1252 encoding. |
| `replay-run/` | A real run folder, exactly as voicecap wrote it (including its `report.html` snapshot): `run.json`, then `pages/<slug>/{read,headings,tab}.{txt,json}`. The replay driver replays it (`--replay-from fixture/replay-run`). |
| `reviews.json` | A sample review history for that run, built by `pnpm fixture:reviews`. The home page goes reviewed → issue → fixed. The flawed page has an open issue. The duplicates page was reviewed against an earlier, fictional run, so it shows as changed since review. |
| `manual/speech-viewer.txt` | A real Speech Viewer capture of the home page read with Down Arrow, from Ctrl+Home through the first repeat of the last line, read from NVDA's Speech Viewer window by `pnpm fixture:capture`. Windows line endings. |
| `manual/nvda-io-log.txt` | An NVDA log excerpt at Input/output level, written by hand in NVDA's log format, for manual-session import. It includes log noise, typing into the search field, and a session that crosses midnight. Windows line endings. |
| `nvda-io-run/` | A real run made with NVDA's own log turned on, and that log, **cleaned**. `run/` is the run as voicecap wrote it, without its screenshots and `report.html`: `run.json`, `events.jsonl`, and `pages/<slug>/{read,headings,tab}.{txt,json}`. `nvda-log/1-1.txt` is NVDA's log of the run's one session, cleaned as a run keeps it (see below). |

`.gitattributes` marks the CRLF and Windows-1252 files `-text`, so Git never converts them.

## NVDA's own log, cleaned

`nvda-io-run/` is a real run of the demo's seven pages (NVDA 2026.2 with Chrome 154 on Windows 11, 2026-10-06), made with NVDA's own log turned on at the input/output level. The run is from before voicecap kept that log, so its `run.json` doesn't list it. The log sits beside the run as `nvda-log/1-1.txt`: session 1, copy 1, the name a run gives it.

The log in the fixture is the **cleaned copy**, the only copy voicecap keeps, made by `cleanNvdaLog` (`src/drivers/guidepup/nvda-log.ts`). It keeps these entries of NVDA's log, whole and in order:

- NVDA's speech: the 392 `Speaking [...]` entries;
- the keys voicecap pressed: the 267 `Input: kb(desktop):<gesture>` entries, every one of them a gesture in `VOICECAP_GESTURES` (`downArrow`, `h`, `tab`, `control+home`, `control+end`, `NVDA+t`, `escape`);
- NVDA's warnings and errors, with their tracebacks.

It leaves out every other key, every typed word, and NVDA's INFO and debugging entries, and it writes `%USERPROFILE%` for the home folder. Its first line says so, and its lines end with `\n`.

The speech includes what NVDA said outside voicecap's steps: the window in front before the run started (`Calculator`), `Connected as controlled computer`, and the speech after each page's title check.

The raw log isn't in the repository, and Git ignores `*.log` files: it holds the account's name, and whatever was typed while it was written. So the copy can't be made again here. It is the fixture, and `test/nvda-log-clean.test.ts` checks it: its counts, that it holds no account name and no key but voicecap's, and that cleaning it again changes nothing.

## Serving the site

```sh
pnpm fixture:serve        # http://127.0.0.1:4747/ until Ctrl+C
```

The sitemaps list absolute `http://127.0.0.1:4747` URLs, so real runs need this fixed port. The IPv4 literal avoids Windows resolving `localhost` to `::1`. Tests import `startFixtureServer({ port: 0 })` from `scripts/serve-fixture.ts` to get a free port instead.

Routes:
- Static files are served from `site/`.
- A folder URL serves its `index.html`, and a folder without its trailing slash redirects (301) to the slashed URL.
- `/contact/` redirects (302) to `https://www.example.com/contact/`.
- `/feed/` serves RSS.
- Anything else is a 404 HTML page. Paths that escape `site/` are refused.

## Capturing the run with real NVDA

On Windows, after `voicecap setup`:

```sh
pnpm test:nvda          # run voicecap with NVDA on this site and check the results; the fixture is left alone
pnpm fixture:capture    # the same, then replace replay-run/, reviews.json, and manual/speech-viewer.txt
pnpm fixture:reviews    # only rebuild reviews.json from replay-run/
```

A capture takes about 5 minutes, during which NVDA speaks and browser windows come and go: don't use the keyboard or mouse. It serves the site itself (or uses `pnpm fixture:serve` if that's running), runs voicecap over the sitemap, then reads the home page again with NVDA's Speech Viewer open. It checks:

- every read pass ends at the end of the page, including the page with duplicate lines;
- every headings pass ends on "no next heading";
- the home and duplicates tab passes start at the skip link and end with focus leaving the page;
- complete capture: Speech Viewer shows the same speech as the home page's read pass;
- Tab on `/frames/` reaches the link before the frames, the one in each frame, and the one after them, in that order.

If a check fails, nothing is replaced and the run is kept for inspection. `--from <run folder>` checks (and with `--write`, installs) a run made earlier instead of making a new one.

Re-capture after upgrading Guidepup, NVDA, or Chrome, and review the transcript changes with `git diff` before committing. `test/replay.test.ts` replays the run through voicecap's core and expects the recorded stops and content, and `test/fixture.test.ts` checks the run's files, hashes, and the Speech Viewer capture.

## What NVDA says (NVDA 2026.2, Chrome 153)

Observed in this run. Phase A predicted the phrasing from NVDA's source; where the prediction was wrong, that's noted.

- **Speech format.** Guidepup trims each text item, joins items with `", "`, and joins utterances with `". "`. Empty items survive: the home page's search line is `search landmark, Search this site, edit, , button, Search` (the empty text field).
- **Symbols are spoken by name in transcripts** (`copyright 2026`, `bullet`), because Guidepup receives NVDA's speech (over NVDA Remote Access) after symbol processing. Speech Viewer shows the characters (`© 2026`, `•`). *Phase A assumed both kept the characters.*
- **Line reading** (Down Arrow): the role comes before the text (`heading, level 1, Welcome to the Voicecap Test Agency`, `link, Home`), link states before the role (`same page, link, Home`), and containers only when entered (`list, with 4 items`; `out of list`). Landmarks report their names (`Main, navigation landmark`).
- **Focus (Tab) and quick navigation (H)**: the content comes first (`Read more, link`, `Resources, heading, level 2`). When focus enters landmarks, they're announced first, as separate utterances when a field takes focus: `main landmark. search landmark. Search this site, edit, blank`.
- **End of page**: arriving on the last line announces the containers entered (`content info landmark, copyright 2026 Voicecap Test Agency`); Down Arrow on it repeats the line without them (`copyright 2026 Voicecap Test Agency`). On the duplicates page the container was entered one line earlier, so the arrival and the repeats are identical (`same page, link, Back to top`).
- **Line wrapping** at 100 characters: the home page's first paragraph is two lines, the second being `page.`.
- **"no next heading"** after the last heading.
- **Same-page links** say `same page`, including links to `/` on the home page. No link says `visited`: each page load uses a fresh browser profile.
- **Images.** An image without alt that isn't a link *is* read in NVDA 2026.2: `Unlabeled graphic, To get missing image descriptions, open the context menu.` *(Phase A assumed it was silent.)* The image-only link is named after its file: `link, Unlabeled graphic, chart` when read, `chart, Unlabeled graphic, link` on focus.
- **Unlabeled controls**: the text field and the icon-only button are `edit` and `button` when read, `edit, blank` and `button` on focus.
- **Leaving the page**: Tab past the last element focuses Chrome's toolbar, not the address bar: `Home Voicecap Test Agency - Google Chrome, region. Tab search, button, collapsed`. voicecap detects it from the page losing focus, not from this speech.
- **The first Tab** reaches the skip link, because the driver sends it to Chrome directly. Sent through NVDA in browse mode, it moves to the first focusable element *after* NVDA's cursor, and Ctrl+Home puts the cursor on the skip link, so the skip link would be skipped.
