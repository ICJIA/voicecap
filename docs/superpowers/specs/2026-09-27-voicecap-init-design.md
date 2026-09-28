# voicecap init: compose a run by answering questions

Design approved in conversation on 2026-09-27. Built after the audit record (`2026-09-27-audit-record-design.md`), whose home, site folders, and folder-naming function it uses.

## Why

A run needs several flags (`--site`, a page source, `--limit`, `--out`), and the people who review their own sites with voicecap shouldn't need to learn them first. `voicecap init` asks a few plain questions, shows the finished `npx @icjia/voicecap …` command (to copy, keep, and run again to resume), and offers to run it.

Success: someone who knows only their site's address gets a correct, copy-pasteable command in under a minute, pressing Enter for most answers; the run lands in the audit record's folder for its site; and every example in the README can be checked right away against i2i.illinois.gov or dvfr.illinois.gov.

## Decisions

| Question | Decision |
| --- | --- |
| Starting it | `npx @icjia/voicecap init` always starts it; `npx @icjia/voicecap` with no arguments starts it too when stdin and stdout are a terminal. With no arguments and no terminal (scripts, CI), the current "Missing --site" usage error stays. |
| A single page | A new, repeatable `--page <url>` run option: a third page source beside `--sitemap` and `--pages`. |
| What it asks | The site, where the pages are, how many (for a sitemap or page list), and where to save transcripts. Everything else keeps its default: all three passes, no filters. |
| At the end | Print the command, then offer "Run it now? [y/N]" (No by default) when the computer can run it. |
| Prompt style | Plain line-by-line questions with numbered choices and the default in brackets, using Node's `readline/promises`: readable with a screen reader in a terminal, works in Git Bash, Windows Terminal, and PowerShell, and adds no dependency. |
| Where transcripts go | The audit record's home: `VOICECAP_TRANSCRIPTS` when set, else `transcripts/`. `init` asks for the home and shows the site folder the run will use; the site and date folders are automatic. |

## What someone sees

```
$ npx @icjia/voicecap init

Website: i2i.illinois.gov
Checking https://i2i.illinois.gov…
  → https://i2i.illinois.gov (it answers)
Looking for the site's sitemap…
Where are the pages?
  1. The site's sitemap: https://i2i.illinois.gov/sitemap-index.xml
  2. A sitemap at another address
  3. A page list file (.csv or .json)
  4. One page
Choose [1]:
How many pages? A number, or Enter for all [all]: 5
Transcripts home [C:\Users\cschw\code\voicecap-transcripts]:
  → this run goes into C:\Users\cschw\code\voicecap-transcripts\i2i.illinois.gov\2026-09-27\

Your command:
  npx @icjia/voicecap --site https://i2i.illinois.gov --sitemap https://i2i.illinois.gov/sitemap-index.xml --limit 5
Run the same command again later to resume where it stopped.

NVDA will speak and take over the keyboard until the run ends.
Run it now? [y/N]:
```

### The questions

1. **Website** (required). `i2i.illinois.gov`, `https://i2i.illinois.gov/`, and `http://i2i.illinois.gov` are all accepted: `https://` is added when there's no scheme (a `host:port` answer such as `localhost:3000` counts as having none), and only `http` and `https` are allowed. The site is fetched (following redirects, 15-second limit), with `Checking <origin>…` shown first so nobody waits in silence. If it ends up on another origin (`http://` → `https://`, or a `www.` host), that origin is used and said so; this avoids the known Phase A problem where the wrong scheme skips every page. If it doesn't answer, the reason is shown and "Use it anyway? [y/N]" is asked; No asks for the website again. `--site` is written as the site's origin (scheme, host, and port), since voicecap keeps pages on that origin and resolves paths against it.
2. **Where are the pages?**
   - Before the sitemap search, which can take up to 30 seconds, `Looking for the site's sitemap…` is shown, so nobody waits in silence.
   - When a sitemap is found, the choices are the four shown above, and the found sitemap is the default. A sitemap is found by reading `robots.txt` `Sitemap:` lines in order, then trying `/sitemap.xml`; a candidate counts only if it answers with a `<urlset>` or `<sitemapindex>` document.
   - When none is found, the choices are "A sitemap at another address", "A page list file (.csv or .json)", and "One page", and the default is "One page".
   - **A sitemap at another address**: asks for the URL (`https://` is added when there's no scheme, as for the website), which must be `http(s)` and answer with a sitemap document (or "Use it anyway? [y/N]").
   - **A page list file**: asks for the path (relative to the current folder); it must exist, end in `.csv` or `.json`, and read as a page list (the existing `readPageList`), and the number of pages is shown. A path wrapped in one pair of quotes, as Windows' "Copy as path" gives, is taken without them.
   - **One page**: asks "Page (a full URL, or a path like /faq/) [https://dvfr.illinois.gov/]:", with the site's home page as the default; the answer is resolved against the site and must be on its origin. It's always written into the command as a full URL, so Git Bash can't rewrite it.
3. **How many pages?** Only for a sitemap or a page list: a positive whole number, or Enter (or `all`) for all. A number becomes `--limit`.
4. **Transcripts home** `[<the home in effect>]`: the default is `VOICECAP_TRANSCRIPTS` when set, else `transcripts` (in the current folder). Any path is accepted, and one pair of surrounding quotes is taken off, as for a page list. The answer is followed by the folder the run goes into: `<home>/<site folder>/<today>/`, with the audit record's site folder name. When `VOICECAP_TRANSCRIPTS` isn't set, one line suggests setting it (see the README's audit-record setup) so every run lands in one place.

A wrong answer is explained in one line and the question is asked again. Ctrl+C ends the tool with exit code 130, at once, even during a site check or sitemap search; input that ends before all questions are answered (a closed pipe) ends it with exit code 1. On Windows, a path typed in Git Bash's form (`/c/Users/…`) for the page list or the home is read as the Windows path (`C:/Users/…`), since typed answers don't get Git Bash's path conversion, and homes are compared without regard to case. A failed request's reason is never empty.

### The command

- Written as `npx @icjia/voicecap --site <site> <page source> [--limit <n>] [--out <home>]`, with `--out` only when the answer differs from the home in effect (so a command made with `VOICECAP_TRANSCRIPTS` set stays short, and one made without it, with a typed home, says where it goes).
- A value is quoted with single quotes only when it contains a character outside `A-Z a-z 0-9 _ . / : @ % + , = -` (a single quote inside becomes `'\''`), and an empty value is written as `''`, so it isn't lost. The result is correct in Git Bash, and in PowerShell unless a value contains a single quote. It isn't correct in cmd, where single quotes aren't quotes: the tool says so right under the command (`In cmd, use double quotes instead of single quotes.`) whenever the command has a single-quoted value.
- When the command depends on the folder it's run from (a page list given as a relative path, or a transcripts home that's relative, as written or in effect, including the default `transcripts`), one more line follows the resume line: `Run it from this folder: <the current folder>`. The order under "Your command:" is the command, the cmd line (if any), the resume line, then the folder line (if any).
- "Run the same command again later to resume where it stopped." follows it.

### Running it

- Not Windows: "voicecap runs NVDA, which only runs on Windows. Run this command on a Windows computer." No offer; exit code 0.
- Windows, but Guidepup's NVDA isn't installed (its `nvda.exe` is missing): "NVDA for voicecap isn't installed yet. Install it with: npx @icjia/voicecap setup, then run the command above." No offer; exit code 0.
- Otherwise: the warning line, then "Run it now? [y/N]". Yes runs the composed arguments through the normal CLI in the same process (the same code as typing the command: Ctrl+C handling, resuming, exit codes); its exit code is the tool's. No ends with exit code 0.

## `--page <url>` for runs

- Repeatable; a run takes exactly one kind of page source: `--sitemap`, `--pages`, or one or more `--page`. The error for none or a mix names all three.
- Each value is a full URL or a root-relative path (`/faq/`), resolved against `--site`. A value Git Bash rewrote (`C:/Program Files/Git/faq/`) is caught with the existing `assertNotRewritten` message, whose example URL becomes a real one.
- The values go through the same resolution as page-list entries: off-origin, non-HTML-extension, and duplicate pages are skipped and reported the same way; `--include`, `--exclude`, and `--limit` apply.
- A new page source kind, `{ kind: "urls"; urls: string[] }` with the resolved absolute URLs in order, is recorded in `run.json` and in each transcript's environment. The settings hash covers it, so a `--page` run resumes when run again with the same pages in the same order.
- Wherever a page source is described (the report, the TXT transcript header, run comparison, and resume's settings differences), it reads `page https://dvfr.illinois.gov/faq/` for one page and `3 pages (https://…, https://…, https://…)` for several.

## Components

| Unit | Does | Depends on |
| --- | --- | --- |
| `src/init/prompt.ts` | A line-based prompter over given input and output streams: ask (with default and check), choose (numbered), confirm (y/N); end of input and Ctrl+C reported as errors | `node:readline/promises` |
| `src/init/site.ts` | Normalize the website answer, check that it answers (final origin after redirects), find the sitemap | `fetch` (injected) |
| `src/init/compose.ts` | Pure: answers → argument list, argument list → printable command with quoting | nothing |
| `src/init/wizard.ts` | The question flow; returns the arguments, or nothing when there's nothing to run | the three above, `readPageList`, a "can this computer run it" check |
| `src/cli/main.ts` | The `init` command; no arguments in a terminal → `init`; after "Run it now?" → the normal run with the composed arguments | `CliContext` gains `stdin` and `interactive` (both injectable for tests) |
| `src/pages/resolve.ts` and the page-source describers | `--page` as a third source | existing page resolution |

## Tests

No test uses the network: the site checks take a fake `fetch` that plays back i2i.illinois.gov's and dvfr.illinois.gov's real `robots.txt` and sitemaps (i2i's robots.txt names `sitemap-index.xml`, an index pointing to `sitemap-0.xml` with 35 pages; dvfr's names `sitemap.xml`, a `<urlset>` of 36 pages).

- `compose`: argument order, `--limit` only when set, `--out` only when the home differs from the one in effect, quoting (a URL with `&` or `?`, a Windows path, a value with a single quote).
- `site`: scheme added, `http` → `https` redirect adopted, an unreachable site, sitemap found from robots.txt, from `/sitemap.xml`, and not at all (HTML answering 200 doesn't count).
- `wizard`, with scripted answers: all defaults with a found sitemap; each page source; a limit; a typed home, and the default from `VOICECAP_TRANSCRIPTS`; the suggestion when it isn't set; wrong answers asked again; end of input; not Windows and no NVDA (no offer); "Run it now?" yes and no.
- CLI: `init` starts the tool; no arguments in a terminal start it; no arguments without a terminal is still the usage error.
- `--page`: resolution (full URL, path, off-origin skipped, Git Bash rewrite caught), only one kind of source allowed, resume identity, and the report, TXT header, compare, and resume descriptions.

## Documentation

- README: a Quick start with `npx @icjia/voicecap init` and the i2i.illinois.gov session above; `--page` in the options table and under Page sources.
- README, "Starting voicecap" (checked on Windows 11 with 0.2.0: a global install creates `voicecap`, `voicecap.cmd`, and `voicecap.ps1`, and needs no administrator rights):
  - What's needed: Node.js 22.19 or later. For real runs, Windows, `voicecap setup` once (voicecap's own copy of NVDA, no administrator rights), and preferably Google Chrome. Nothing else: no Git, no separate NVDA, no Playwright.
  - Without installing: `npx @icjia/voicecap init`. npx downloads voicecap the first time and reuses it; `npx @icjia/voicecap@latest init` picks up a newer version.
  - Or install it once: `npm install -g @icjia/voicecap`, then `voicecap init` (and `voicecap setup`, `voicecap doctor`, `voicecap --site …`) in Git Bash, PowerShell, or cmd; `npm install -g @icjia/voicecap@latest` updates it. The command `init` prints is quoted for Git Bash and PowerShell; in cmd, its single quotes must become double quotes (or answer "Run it now?" with y, which uses no shell).
  - npm may warn that it skipped `ffmpeg-static`'s install script: harmless, since only `@guidepup/setup`'s macOS screen recording uses it.
- The command `init` prints always starts with `npx @icjia/voicecap`, so it works on any computer with Node.js; with a global install, `voicecap` can replace it.
- Every placeholder `example.illinois.gov` example (7 in the README, 2 in `--help`, 1 in the Git Bash message) becomes a real, checkable one on i2i.illinois.gov or dvfr.illinois.gov, including ones anyone can check at once on any OS without NVDA, such as `npx @icjia/voicecap list-urls dvfr.csv --site https://dvfr.illinois.gov --sitemap https://dvfr.illinois.gov/sitemap.xml`.
- CHANGELOG: an Unreleased entry for `init` and `--page`.

## Not included

Questions about passes, filters, or a run name; saving the command to a file; a config file; running on computers other than Windows.
