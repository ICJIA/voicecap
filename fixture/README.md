# voicecap test fixture

A tiny fictional agency site plus everything voicecap needs to test itself without NVDA: page lists, a hand-written run to replay, sample reviews, and manual-session captures. Phase B also uses the site to check the real NVDA driver end to end.

Everything here is fictional. The run in `replay-run/` was **written by hand**. It is not output from a real NVDA session, and its environment record says so (`driver: hand-written`, OS "Windows 11 (hand-written fixture)").

## Contents

| Path | What it's for |
| --- | --- |
| `site/index.html` | A well-built home page: skip link, landmarks, one h1, a labeled search field, and two lists of links. |
| `site/duplicates/index.html` | End-of-page detection. It has two identical consecutive lines ("Applications are due October 31."). Its last line ("Back to top", at the end of the footer) also appears earlier on the page. |
| `site/flawed/index.html` | Deliberately flawed page. No skip link, and 12 focus stops before main content. The first heading is an h2. It has three "Read more" links and one "Click here" link. It also has an image without alt, an image-only link without alt, an unlabeled text field, and an icon-only button with no name. |
| `site/files/annual-report.pdf` | A tiny valid PDF, listed in the sitemap so voicecap skips it by extension. |
| `site/images/chart.png` | The image the flawed page uses. |
| `site/feed/feed.xml` | Served at `/feed/` as `application/rss+xml`: a URL with no file extension whose response isn't HTML. |
| `site/sitemap.xml`, `site/sitemaps/*.xml` | A `<sitemapindex>` with two child sitemaps. They list the three pages; `/contact/`, which redirects to another origin; `/feed/`; an off-origin URL; and the PDF. |
| `site/404.html` | The server's not-found page. |
| `pages.json`, `pages.csv`, `pages-windows-1252.csv` | Page lists covering a subset of the site. They include a relative path, labeled entries, and an invalid row. The CSV files keep Windows line endings, and the last is in Excel's Windows-1252 encoding. |
| `replay-src/*.json` | The hand-written source of the replay run. It holds each page's steps as NVDA speech items, plus run metadata and sample review entries. |
| `replay-run/` | A complete run folder generated from `replay-src/` by voicecap's own writers: `run.json`, then `pages/<slug>/{read,headings,tab}.{txt,json}`. The replay driver replays it (`--replay-from fixture/replay-run`). |
| `reviews.json` | A sample review history. The home page goes reviewed → issue → fixed. The flawed page has an open issue. The duplicates page was reviewed against an earlier, fictional run, so it shows as changed since review. |
| `manual/speech-viewer.txt` | A Speech Viewer capture of the home page read with Down Arrow, from Ctrl+Home through the first repeat of the last line. Windows line endings. |
| `manual/nvda-io-log.txt` | An NVDA log excerpt at Input/output level, for manual-session import. It includes log noise, typing into the search field, and a session that crosses midnight. Windows line endings. |

`.gitattributes` marks the CRLF and Windows-1252 files `-text`, so Git never converts them.

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

## Regenerating the replay run

Edit `replay-src/`, then run:

```sh
pnpm fixture:replay
```

This rewrites `replay-run/`, `reviews.json`, and `manual/speech-viewer.txt`, deterministically. `test/fixture.test.ts` fails if they fall out of step with `replay-src/`.

The generator checks every pass against the core's stop rules (docs/plan.md section 5, default config: `endConfirmations: 1`, `repeatLimit: 10`). Replaying the run therefore stops exactly where each recording ends: read at `end-reached`, headings at `no-next-heading`, tab at `left-document`.

The run has no `report.html` snapshot. `voicecap report --run 2026-09-20_0930_hand-written` renders one.

**Phase B replaces `replay-run/` with output captured from real NVDA** on this site, retunes the flag phrasing to match, and records the real phrasing in place of the assumptions below.

## Where the phrasing comes from

The steps follow NVDA's source (nvaccess/nvda `master`, September 2026) for Chrome in browse mode with default settings. Speech strings use Guidepup's format: each item trimmed and joined with `", "`. That format was verified in `@guidepup/guidepup` 0.34.0's `NVDAClient.js`.

- **Role, state, and landmark words** (`controlTypes/role.py`, `controlTypes/state.py`, `aria.py`): "link", "heading", "edit", "button", "graphic", "list"; "banner", "navigation", "main", "search", and "content info" landmarks, spoken as e.g. "main landmark".
- **Line reading** (Down Arrow, `OutputReason.CARET`; `speech/speech.py` `getControlFieldSpeech`): the role comes before the text, as in "heading, level 1, Welcome…" and "link, Home".
  - Link states come before the role: "same page, link".
  - Containers (landmarks, lists) are spoken only when entered, as in "list, with 4 items". Lists also say "out of list" when left; landmarks say nothing when left.
  - Landmarks always report their name (`virtualBuffers/__init__.py` sets `alwaysReportName`), as in "Main, navigation landmark".
- **Quick navigation (H) and focus (Tab)** (`_shouldSpeakContentFirst`): the content comes first, as in "Resources, heading, level 2" and "Read more, link".
- **"no next heading"**: `browseMode.py`.
- **Same-page links** (`utils/urlUtils.py` `isSamePageURL`, `documentFormatting.reportLinkType` on by default): a link whose target is the current page is "same page", ignoring fragments. That includes the home page's links to `/`, not just `#` links.
- **Empty controls** (`nvdaHelper/vbufBackends/gecko_ia2/gecko_ia2.cpp`): an interactive control with no content gets a space so it can be reached. That's why the unlabeled edit and button are read as "edit" and "button". A non-interactive image without alt is not rendered at all.
- **Linked images**: an image-only link without alt is named after its image file by `getNameForURL` (`nvdaHelper/vbufBase/utils.cpp`), so NVDA says "link, graphic, chart".
- **Line wrapping**: browse-mode lines wrap at `virtualBuffers.maxLineLength` (100). The home page's first paragraph (102 characters) is therefore two lines.
- **Speech Viewer** (`speechViewer.py`): items joined with two spaces, one speech sequence per line.
  - Both Speech Viewer and Guidepup's Remote Access capture receive the sequence in `speech.speak()` before symbol processing. That's why "©" stays a character rather than becoming "copyright".
- **End of page** (plan Q1): NVDA re-speaks the last line without the containers it announced on arrival. On the home and flawed pages the last line enters the footer, so arrival says "content info landmark, © 2026…" and the repeats say "© 2026…".
  - The core needs the pair of repeats plus one confirmation, so those read passes end with the arrival and three identical lines.
  - On the duplicates page the last line doesn't enter a new container, so it ends with the arrival and two repeats.
  - Ctrl+End from the top speaks the last line with its context, and it ends with ", " plus the repeated line.

## Uncertainties (check in Phase B)

- **Visited links.** Chrome may also report links to the current page, or to pages visited earlier in the same browser profile, as "visited". The fixture assumes a fresh profile and leaves "visited" out. If the Phase B driver keeps one profile across pages, transcripts would depend on the order pages were visited.
- **Whitespace-only items.** NVDA sends text chunks as-is, including the space rendered for empty controls and spaces between inline controls. Guidepup trims items but keeps empty ones, so real output may contain empty items (e.g. `edit, ` or `, button`). The fixture writes these steps without them.
- **Line break position.** The fixture assumes the wrap happens at the last space before the 100-character limit, leaving "page." on its own line.
- **Unlabeled linked image.** The derived name may come from the link URL instead of the image file ("data" rather than "chart").
- **Focus-mode fields.** Tabbing to a text field switches to focus mode. NVDA then reports the object (`speakObject`) and may also announce focus ancestors such as landmarks. The fixture writes only "Search this site, edit, blank" and "edit, blank".
- **Leaving the page.** The fixture assumes Tab past the last element focuses Chrome's address bar ("Address and search bar, edit, 127.0.0.1:4747/flawed/"). Chrome may focus a different toolbar control first. NVDA may also report the selected URL differently.
- **Settings.** The recorded NVDA settings are a plausible subset of NVDA's defaults, not Guidepup's actual configuration (e.g. whether it turns off say-all on page load). Step timings (about 1.25–1.6 s each) are synthetic.
