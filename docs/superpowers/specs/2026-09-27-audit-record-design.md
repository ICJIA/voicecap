# The audit record: one home, per site, per day, never rewritten

Design approved in conversation on 2026-09-27. Implemented before `voicecap init` (see `2026-09-27-voicecap-init-design.md`), which builds on it.

## Why

The owner wants a long-lasting, Git-friendly, non-destructive record of every voicecap run, automatic and manual, for audit and legal purposes: one private Git repository, pushed often, where the runs for any site can be counted and every file can be trusted not to have been changed.

Success: every run and every manual session lands in `<home>/<site>/<date>/<one folder each>/`; nothing voicecap does ever deletes or rewrites anything it recorded; and the home can be committed and pushed as is, with nothing sensitive in it.

## The home

- Where transcripts go, in order of precedence: `--out <dir>`; the `VOICECAP_TRANSCRIPTS` environment variable; `transcripts/` in the current folder (as now).
- The owner's homes: `C:\Users\cschw\code\voicecap-transcripts` on Windows and `~/webdev/voicecap-transcripts` on macOS. The `voicecap-` prefix sorts it next to `voicecap`. Nothing in the code assumes these paths; the README shows them as the example.
- `--out` keeps its name but now names the home, as `VOICECAP_TRANSCRIPTS` does, for every command that takes it.

## The layout

```
voicecap-transcripts/
  .gitattributes  .gitignore        written when missing, never overwritten
  dvfr.illinois.gov/                one folder per site
    2026-09-27/                     one folder per day with a run or manual session
      1102/                         an automatic run
        run.json  report.html
        pages/faq/read.txt ...
        attempts/faq/1/read.txt ... earlier attempts at a retried page, kept
      1415_manual_faq/              a manual NVDA session on /faq/
        session.json  session.txt  raw/nvda-log.txt
    reviews.json                    append-only review history
    report.html  latest.txt         regenerated views
    compare/                        regenerated diffs
    .voicecap.lock                  while a run writes here
  i2i.illinois.gov/
    2026-09-27/
      1044_before-redesign/
```

- **Site folder**: the site's host name, plus `_<port>` when the URL has a port, lowercased, with any character other than `a-z 0-9 . -` replaced by `_` (`https://dvfr.illinois.gov` gives `dvfr.illinois.gov`; `http://127.0.0.1:4747` gives `127.0.0.1_4747`). The same function names the folder `voicecap init` suggests.
- **Run folders**: run ids don't change (`2026-09-27_1102`, `2026-09-27_1530_before-redesign`, `2026-09-27_1102-2`), and they're still what `--compare`, `review --run`, and reports use. The date is the folder; the rest names the run's folder: `2026-09-27/1102/`, `2026-09-27/1530_before-redesign/`, `2026-09-27/1102-2/`. Times are local, as now.
- **Manual session folders**: named by the session's own date and time (from the log, or `--date`), as session ids are now, then `_manual_` and the page's slug: `2026-09-27/1415_manual_faq/`, with `-2`, `-3` for a name that's taken. Inside: `session.json`, `session.txt`, and `raw/<format>.txt` when the raw input is kept.
- **Site level**: `reviews.json` (append-only, as now), and the regenerated views: the live `report.html`, `latest.txt`, and `compare/`.
- Counting a site's runs means counting its dated run folders; the live report keeps listing them.

## Never rewritten

- A completed run's folder is sealed (already enforced: "its folder is never modified").
- Reviews are only ever appended (already).
- A manual session never overwrites another (already, by unique names).
- **New**: a page that's retried or resumed keeps its earlier attempt. Today the page's folder is emptied first (`src/run/page-runner.ts`); instead, its files move to `attempts/<slug>/<n>/` in the run's folder (`n` = 1, 2, …) before the new attempt starts. Reports and comparisons ignore `attempts/`.
- **New**: folders in voicecap 0.2.0's layout (`<home>/runs/…`, `<home>/manual/…`, and the files beside them) are neither read nor moved. When a home has them, a run prints one line saying so; nothing else changes.
- Every run keeps recording each transcript file's SHA-256 in `run.json`, so a later change is detectable even outside Git, and `voicecap verify` checks them (see "Checking the record").

## Git-safe by default

- `.gitattributes` (as voicecap writes it now, but at the home's top) keeps Git from altering transcripts.
- A new `.gitignore` keeps out the run lock (`.voicecap.lock`) and raw NVDA logs (`**/*_manual_*/raw/`): at Input/output level they record every keystroke, passwords included. A withheld raw log's SHA-256 stays in `session.json`. It also keeps out OS litter (`.DS_Store`, `Thumbs.db`) and the temporary files a crash can leave behind (`.*.tmp`).
- Both are written when missing and never overwritten, so the owner's own additions stay.
- voicecap never runs Git. Committing and pushing publish data, and a run can be stopped halfway, so they stay with the owner. The README gives the one-time setup (a private repository) and the routine after runs.

## Checking the record

Added on 2026-09-27 after an adversarial review found that nothing re-checked the recorded hashes, and that `reviews.json` could be edited without a trace.

- **Seals.** Every record voicecap finishes writing carries a `seal`: the SHA-256 of the record's canonical JSON (keys sorted, as `hashJson` does) without the `seal` field. Sealed records are a completed run's `run.json` (sealed when the run completes; an incomplete run isn't sealed yet), each manual session's `session.json`, and each review entry.
- **The review chain.** Each review entry also carries `seq` (1, 2, … across the whole file, in the order entries were added) and `prev` (the `seal` of the entry before it, or null for the first). A reordered entry, or a deleted one that a later entry follows, breaks the chain; an edited one no longer matches its own seal, including the newest entry, which no later entry points to yet. Deleting the newest entries, or a whole run or manual session, leaves nothing for `verify` to find: only Git history shows it.
- **Manual transcripts.** `session.json` records `session.txt`'s SHA-256 and size.
- **`voicecap verify [--site <url>] [--out <home>]`** checks every site folder in the home, or one with `--site`:
  - each completed run: its seal, and each file it records in `pages/` (SHA-256 and size); a recorded file that's missing, and a file in `pages/` it doesn't record, are problems;
  - each manual session: its seal, `session.txt`, and the kept raw copy when it's there (its SHA-256 must equal the input's). A missing raw copy isn't a problem: `.gitignore` keeps raw copies out of Git, so a clone of the home never has them;
  - `reviews.json`: each entry's seal, `seq` running 1, 2, … with no gaps, and each `prev`; and, since a seal doesn't cover where an entry is filed, each page's entries in increasing `seq` and each entry's `url` having the canonical key it's filed under, so an entry moved to another page, or swapped with another within one, is caught;
  - a record without a seal (written before this version) is a problem: it can't be checked;
  - incomplete runs are listed, not counted as problems.
- It prints one line per problem, then a summary per site, and exits 0 when everything matches and 3 when anything doesn't.
- Not checked: the regenerated views (`report.html`, `latest.txt`, `compare/`), a run's own `report.html` and `compare/` diffs, and kept earlier attempts.
- **What it can't catch alone:** someone who edits a record and recomputes its seal, and every later seal and `prev`; and someone who deletes the newest review entries or a whole run or manual session. Git history pushed to a protected branch catches both, since rewriting pushed commits takes a force-push that branch protection refuses. The README says exactly this, tells the owner to protect the branch in the setup, and makes no stronger legal claim.

## Which site, for commands without `--site`

`review`, `manual add`, and `report` work in one site's folder. They gain `--site <url>`, and take the site from, in order: `--site`; the full URL given with `--page`; the only site folder in the home. A site folder is a folder at the home's top that holds a date folder, `reviews.json`, `latest.txt`, or `report.html`; other folders there (the owner's own notes, for example) are left alone and never taken for sites. With several site folders and no way to tell, they stop with a usage error that names them, for example: "voicecap-transcripts has dvfr.illinois.gov and i2i.illinois.gov: add --site, or give --page as a full URL."

## Tests

- Paths: site folder names, run id ↔ folder, manual session folders.
- Runs: a replay run lands in `<home>/<site>/<date>/<time>/`; resume finds it there; `--compare previous` finds the earlier run of the same site; the home comes from `--out`, else `VOICECAP_TRANSCRIPTS`, else `transcripts/`.
- Retries: a retried page's first attempt is kept under `attempts/<slug>/1/`, and the report and diffs don't show it.
- Manual sessions: an import lands in its dated folder; a second import of the same session gets `-2`; `listManualSessions` and the report find them.
- Site selection for `review`, `manual add`, `report`: `--site`, a full page URL, the only site folder, and the usage error naming several.
- Git files: written when missing, left alone when present; the `.gitignore` keeps a manual session's `raw/` folder out (checked with `git check-ignore` when Git is available).
- The old layout: a home with `runs/` is left as it is, with the one-line note.
- Seals and `verify`: a home nobody touched passes; an edited, deleted, or added transcript file, an edited `run.json`, an edited review entry (the newest included), a deleted review entry that a later entry follows, and an edited manual transcript are each reported; unsealed records count as problems; incomplete runs don't.

## Documentation

- README, "The audit record": the layout, the guarantees, what's kept out of Git and why, and the setup:
  - Windows: create `C:\Users\cschw\code\voicecap-transcripts`, `git init`, create a private GitHub repository for it, and `setx VOICECAP_TRANSCRIPTS 'C:\Users\cschw\code\voicecap-transcripts'` (a new terminal picks it up).
  - macOS: the same with `~/webdev/voicecap-transcripts`, and `export VOICECAP_TRANSCRIPTS=~/webdev/voicecap-transcripts` in `~/.zshrc`.
  - After runs: `git add -A`, `git commit -m "…"`, `git push`. Signing commits (`git commit -S`) adds proof of who committed, if that's wanted.
- The README's output-layout section, `src/run/paths.ts`'s layout comment, and the handoff doc describe the new layout.
- CHANGELOG, under Changed: the new layout, the home from `VOICECAP_TRANSCRIPTS`, and that 0.2.0's folders are no longer read.

## Not included

voicecap running Git (commit, push, or signing); moving 0.2.0-layout runs into the new layout; per-site settings.
