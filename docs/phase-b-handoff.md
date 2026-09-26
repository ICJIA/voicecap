# Phase B handoff: picking up on Windows

Phase A was finished on macOS on 2026-09-26 and pushed to the `phase-a` branch of https://github.com/cschweda/voicecap. This file is everything a new Claude Code chat on a new Windows machine needs to pick up Phase B. The chat has none of the earlier conversation, so everything it needs is here.

## 1. Set up the Windows machine (you, before starting Claude Code)

In **Windows Terminal → PowerShell**:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
```

Node's installer is machine-wide, so it may ask for administrator rights once (on a managed PC, IT may need to run it). Close and reopen Windows Terminal, then open a **Git Bash** tab (the `˅` next to the `+` lists it). Everything from here on is in Git Bash, as your normal user:

```bash
node --version                      # needs 22.12 or later
npm install -g pnpm@10              # per-user; no admin needed
npm install -g @anthropic-ai/claude-code   # or follow https://docs.claude.com/en/docs/claude-code/setup
git clone https://github.com/cschweda/voicecap.git
cd voicecap
git checkout phase-a
claude                              # start Claude Code in the repo
```

Close any copy of NVDA you have running before testing; voicecap shuts NVDA down when it starts.

## 2. What to say in the new chat

Paste this as your first message:

> I'm continuing work on **voicecap** (this repo, branch `phase-a`). Phase A is done: everything except the real NVDA driver, built on macOS with the replay driver. I'm now on my Windows machine, in Git Bash inside Windows Terminal, as a normal (non-admin) user, to do **Phase B**.
>
> 1. Read `docs/phase-b-handoff.md` first. Then read `docs/build-prompt.md` (the spec; Phase B is under "Deliverables"), `docs/plan.md` (the approved plan; I accepted all its recommendations), `README.md`, and `CHANGELOG.md`.
> 2. Check the environment and run the Phase A checks before changing anything: `pnpm install`, `pnpm exec playwright install chromium`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Tell me about any Windows-specific failures.
> 3. Before writing the driver, re-verify the Guidepup facts in the build prompt against the exact versions you'll pin. Check npm for newer releases than the ones listed in the handoff, and use the actual method names; don't guess.
> 4. Then give me a short plan for Phase B and wait for my OK. Phase B means:
>    - the Guidepup NVDA driver (`src/drivers/guidepup-nvda.ts`), `voicecap setup`, and `voicecap doctor`;
>    - running the real driver yourself against the fixture (`pnpm fixture:serve`);
>    - replacing `fixture/replay-run` with real captured output, retuning the flag phrasing, and putting measured run times in the README.
>
>    Keep code changes inside the driver layer as far as possible.
>
> My preferences: never add a `Co-Authored-By` or any other AI attribution trailer to commit messages. Commit and push only when I ask. Ask me before building rather than silently working around something that conflicts with how Guidepup or NVDA actually work.

## 3. State at handoff

- **Phase A is complete.** 343 tests in 30 files pass on macOS (Node 22.22). `pnpm lint`, `pnpm typecheck`, and `pnpm build` are clean, and the built CLI passes a smoke test against the fixture.
- **CI** (`.github/workflows/ci.yml`) runs lint, type checks, tests, a build, and a CLI smoke test on Ubuntu, macOS, and Windows with Node 22 and 24. On Windows it also checks under Git Bash that `--page /about` is caught as a rewritten path. Check the latest run for the `phase-a` branch on GitHub: any Windows failure there is the first thing to fix.
- **Pinned for Phase B**, current on npm on 2026-09-26: `@guidepup/guidepup` 0.34.0, `@guidepup/setup` 0.28.0, `@guidepup/playwright` 0.19.1 (only its `navigateToWebContent` code is ported, not the package). Phase A doesn't install Guidepup yet. `playwright` is a devDependency today (used by the report's axe test) and should become a dependency in Phase B.
- **Stubs waiting for Phase B:**
  - `createDriver` in `src/drivers/index.ts` throws "built in Phase B" for `guidepup` on Windows.
  - `voicecap setup` and `voicecap doctor` in `src/cli/main.ts` print "isn't available yet".
- **Toolchain choice:** TypeScript is pinned to 6.0.x because typescript-eslint (8.70) doesn't support TypeScript 7 yet.

### Decisions already made (from docs/plan.md, all accepted)

- **End-of-page matching** (Q1). The repeat must match the end of the Ctrl+End speech at an item boundary, and one confirmation Down Arrow is required (`read.endConfirmations: 1`; 0 restores the plain rule).
- **Sitemap runs** (Q2) are identified by URL only for resuming, and a resumed run uses the page list stored at its start. Page list files are identified by their content hash.
- **The resume settings hash** (Q3) also covers the NVDA settings overrides and the browser.
- **Failures** (Q4). The driver restarts after any failed page, and after 5 failures in a row the run stops with exit code 2, resumable.
- **License** (Q5): MIT, © 2026 Christopher Schweda.

### Facts learned in Phase A that Phase B needs

- **Signals.** Guidepup 0.34.0's own SIGINT/SIGTERM/SIGQUIT/SIGHUP/`beforeExit` handlers (`lib/teardown.js`) stop NVDA but **never exit the process**. voicecap's core already handles the signals (`src/run/signals.ts`), saves state, and calls `driver.stop()` once. After `nvda.start()`, the driver should detach Guidepup's listeners (compare `process.listeners(...)` before and after) so NVDA is stopped exactly once, by voicecap.
- **Speech format.**
  - Guidepup joins the text items of one utterance with `", "` (each trimmed, whitespace runs collapsed) and utterances with `". "` (`lib/windows/NVDA/NVDAClient.js`).
  - `capture: true` waits for 1 s of silence, and the stop-speech debounce is 250 ms.
  - The driver must return this format; see `Speech` in `src/drivers/types.ts`.
- **Containers on arrival.** Confirmed in NVDA's `speech.py`: when moving to a line, NVDA announces the containers it enters ("content info landmark"); when re-speaking the line it's on, it doesn't. So the end of a page shows the arrival, then the repeats. The read-pass logic in `src/passes/read.ts` handles this. Verify it against real output.
- **NVDA phrasing** (from NVDA's source, in `fixture/README.md`):
  - lists are announced as two items, "list" and "with N items";
  - links to the current page say "same page";
  - an image with no alt that isn't a link isn't read at all;
  - whitespace-only items can appear (e.g. `edit, `).
- **Unverified until Phase B:**
  - what Chrome focuses when Tab leaves the page (assumed the address bar, detected with `document.hasFocus()`);
  - which landmarks NVDA announces when a field takes focus;
  - where NVDA wraps long lines.
- **Visited links.** "visited" makes transcripts depend on the order pages were visited, so use a fresh browser context (or profile) per page.
- **VBScript helpers to avoid:** `lib/windows/activate.js`, `quit.js`, and `sendKeys.js` (used by `type()`, `windowsActivate`, `windowsQuit`).
- **navigateToWebContent** to port, with attribution, is in `@guidepup/playwright` 0.19.1 `lib/nvdaTest.js` (around line 64). Leave out the body click and Tab.
- **Focused element.** For the role and accessible name of the focused element, Chrome's DevTools protocol (`Accessibility.getPartialAXTree` through a Playwright CDP session) is more reliable than DOM attributes. `inMain` is `activeElement.closest('main, [role=main]')`. Record `href` for links (the skip-link flag uses it).
- **AT Driver.** The NVDA AT Driver implementation now lives at https://github.com/Prime-Access-Consulting/nvda-at-automation (not `w3c/nvda-at-automation`). The spec's key command is `interaction.userIntent` with `name: "pressKeys"`. The stub's comments in `src/drivers/at-driver-nvda.ts` reflect this.
- **Still Phase B work:**
  - a machine-wide lock (only one NVDA);
  - cleaning up NVDA and Chrome processes left by a crash (`driver.cleanupStale()`);
  - the warning printed before NVDA starts, because it shuts down any running NVDA.

### Where things are

- **Spec and plan:** `docs/build-prompt.md`, `docs/plan.md`; a requirement → test map is in section 16 of the plan.
- **Driver interface:** `src/drivers/types.ts`. Replay driver: `src/drivers/replay.ts`. Driver selection: `src/drivers/index.ts`.
- **Core:** stop logic is in `src/passes/`; the run engine (resume, timeouts, retries, restarts, signals) is in `src/run/`.
- **Fixture:**
  - The site is in `fixture/site/`, served by `pnpm fixture:serve` at http://127.0.0.1:4747.
  - The replay source is in `fixture/replay-src/`; `pnpm fixture:replay` regenerates `fixture/replay-run/` and `fixture/reviews.json`. The generator checks each recording against the core's stop rules.
  - `fixture/README.md` has the NVDA phrasing sources and their uncertainties.
- **Try it on Windows today, without NVDA:**
  ```bash
  pnpm build
  node dist/cli.js --site http://127.0.0.1:4747 --pages fixture/pages.json --replay-from fixture/replay-run
  ```
