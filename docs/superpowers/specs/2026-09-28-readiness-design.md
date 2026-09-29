# voicecap readiness: know a computer is ready before voicecap drives a screen reader

Design approved in conversation on 2026-09-28. Phase C has three sub-projects, and this is the first:

1. **Readiness** (this spec).
2. **The VoiceOver driver** and automatic driver choice.
3. **A recorded VoiceOver fixture run.**

It builds on the Phase C spike's findings (`docs/phase-c-handoff.md`, "Spike findings").

## Why

voicecap fails late and cryptically when a computer isn't ready. On Windows, `init` only checks "Windows, and NVDA installed", and only after composing the command. On the Mac, the spike found that a missing permission shows up as "VoiceOver cannot be started" or "Unable to activate application" after a 10-second hang, and doesn't name the permission.

People setting up voicecap, often non-technical, should see up front, in plain language:

- what their computer is;
- whether NVDA or VoiceOver is ready;
- for each problem, exactly what's wrong and how to fix it.

voicecap should also stop cleanly rather than half-start a screen reader.

Success:

- On a fresh Mac or PC, `npx @icjia/voicecap setup` followed by `npx @icjia/voicecap init` leads someone through every requirement without outside help.
- A computer that isn't ready never starts NVDA or VoiceOver.
- Every failure names its cause and its fix.
- A person who uses VoiceOver or NVDA themselves gets their own screen reader back, with their own settings, after voicecap is done with it.

## Decisions

| Question | Decision |
| --- | --- |
| Order within Phase C | Readiness first, then the VoiceOver driver, then the recorded fixture run. Each has its own spec, plan, and build. |
| Architecture | **One set of checks.** A shared, screen-reader-neutral readiness module, used by `init`, `doctor`, `setup`, and runs. **Platform code beside the drivers.** Each platform's checks live beside its driver, following the rule that screen-reader specifics stay in drivers and config. **`doctor` moves.** Today's `doctor.ts` is split into the core module and the Windows platform module. |
| `init`'s preflight | It runs first, before the wizard's questions. It shows the machine info and the quick checks. Not ready stops `init` with exit code 2 (`ExitCode.environment`). |
| The live test | It is offered after passing quick checks in `init` and at the end of `setup` (y/N, with a hands-off warning). `doctor` always runs it, after the same warning. |
| Mac `setup` | A guided setup. It installs what's needed and changes two VoiceOver settings itself, saying so. It walks through each missing permission, opening System Settings at the right page and re-checking after Enter. |
| Privacy settings | voicecap never changes them. It never edits the privacy database, never turns off System Integrity Protection, and never runs `@guidepup/setup setup`. |
| Real runs | They do the quick checks first. A failure prints the same diagnosis and exits 2 before any screen reader starts. Replay runs skip the checks. |
| Machine info | Everything that follows, including identifiers (the computer's name and the user name): the readiness essentials, the hardware, and the paths. |
| The person's own screen reader | voicecap warns if it's running, then restores it afterwards with the person's own settings. That applies after the live test and after every real run, including on Ctrl+C or an error. |
| Release | The plan was for the Mac half to ship with the VoiceOver driver, because a ready Mac can't run anything until the driver exists. The Windows half could ship as soon as it's done, when the owner says. **Amended 2026-09-29:** the owner chose to ship both halves together, before the driver, once a supervised run on a real Mac passes. Until the driver exists, a ready Mac says so (see "Until the VoiceOver driver exists"). |

## What someone sees

`init` on a Mac with one problem:

```
$ npx @icjia/voicecap init

voicecap preflight, 2026-09-28 11:10

This computer
  Computer        cschweda's Mac mini, user cschweda
  Model           Mac mini (Mac16,10), Apple M4, 16 GB memory, 72 GB free of 228 GB
  System          macOS 26.6.2 (25G83), Apple silicon
  Terminal app    Visual Studio Code (macOS gives permissions to this app)
  Node.js         22.22.2
  voicecap        0.4.0, with @guidepup/guidepup 0.34.0
  Screen reader   VoiceOver 10 (build 993)
  Browser         Chrome for Testing 153.0.8010.12 (Playwright's)
  Language        English (United States)
  Transcripts     /Users/cschweda/webdev/voicecap-transcripts
  Guidepup files  /Users/cschweda/Library/Caches/guidepup
  Browser path    ~/Library/Caches/ms-playwright/chromium-1243/…

Checks
  OK    macOS 26 is supported
  OK    VoiceOver's files for Guidepup are installed
  OK    VoiceOver can be controlled by AppleScript
  OK    VoiceOver's welcome screen is off
  OK    Accessibility: Visual Studio Code is allowed
  FAIL  Full Disk Access: Visual Studio Code isn't allowed
  OK    Visual Studio Code can control System Events
  WARN  VoiceOver is on: voicecap will use it, then turn it back on with your settings

Not ready: 1 problem.

1. Full Disk Access for Visual Studio Code
   What's wrong: voicecap keeps its VoiceOver settings apart from yours by linking them into
   a folder macOS protects, and macOS blocks Visual Studio Code from that folder.
   How to fix:
     1. Open System Settings, then Privacy & Security, then Full Disk Access.
     2. Switch on Visual Studio Code. If it isn't listed, click + and choose it.
     3. When macOS asks, quit and reopen Visual Studio Code.
     4. Run npx @icjia/voicecap init again.
   Or run npx @icjia/voicecap setup, which walks you through it.
```

When every check passes, the end reads instead:

```
Ready: this computer can run VoiceOver for voicecap.
Tip: turn on Do Not Disturb, so notifications don't interrupt VoiceOver.

Test VoiceOver now? It takes about 20 seconds. VoiceOver speaks and takes over the keyboard,
so keep your hands off. If macOS asks whether Visual Studio Code can control VoiceOver,
click Allow. (y/N)
```

Then the wizard's questions follow, as today. On Windows, the same layout shows Windows, NVDA and its build, and the NVDA checks.

## The checks

The quick checks take about 2 seconds and never start a screen reader. They only read, with one exception: if the terminal app's control of System Events has never been answered, that check raises macOS's prompt so it's answered while the person is watching.

A **FAIL** means a run can't work, so the computer isn't ready. A **WARN** means it works, with something the person should know.

### Mac

| Check | How it's detected | On failure |
| --- | --- | --- |
| macOS version | The pinned Guidepup's manifest has VoiceOver files for this Darwin major version. Guidepup 0.34.0 lists Darwin 21 to 25, which is macOS 12 to 26. | FAIL: voicecap's Guidepup can't drive VoiceOver on this version. |
| Node.js | 22.19 or later, as today. | FAIL. |
| Terminal app | Walk up voicecap's parent processes to the first one whose executable is inside an `.app` bundle. The terminal app is that path's outermost bundle: for VS Code, `Visual Studio Code.app`, not its nested `Code Helper.app`. Its display name comes from its `Info.plist`. | FAIL when there's none, as over SSH: VoiceOver can't be automated there. |
| VoiceOver's files for Guidepup | The asset for this macOS version in Guidepup's cache (`~/Library/Caches/guidepup/voiceover/…`). | FAIL: run setup. |
| AppleScript control | `/private/var/db/Accessibility/.VoiceOverAppleScriptEnabled` exists. VoiceOver Utility's checkbox creates it, with an admin password. | FAIL: VoiceOver Utility, then General, then "Allow VoiceOver to be controlled with AppleScript". |
| Welcome screen | `com.apple.VoiceOverTraining doNotShowSplashScreen` is true. | FAIL, because it would block VoiceOver at start: setup turns it off. |
| Accessibility | `AXIsProcessTrusted()`, asked through `osascript -l JavaScript`, so macOS answers for the terminal app. | FAIL: System Settings, then Privacy & Security, then Accessibility. |
| Full Disk Access | Create and remove a temporary file in `~/Library/Group Containers/group.com.apple.VoiceOver/Library/Preferences`. That's where Guidepup links its settings, and it failed with EPERM in the spike. The check uses the folder Guidepup will use (that one when it exists, else `~/Library/Preferences`), and reports a user whose VoiceOver has never been turned on, since VoiceOver's own settings file, which Guidepup needs there, doesn't exist yet. | FAIL: System Settings, then Privacy & Security, then Full Disk Access, then reopen the terminal app. |
| System Events | A harmless System Events query through `osascript`, with a 60-second wait, so a first-time prompt can't go dead. | FAIL when denied (-1743): System Settings, then Privacy & Security, then Automation, then the terminal app, then System Events. |
| Another voicecap | A lock file, `~/Library/Caches/voicecap/voiceover.lock`, like Windows' `nvda.lock`. The Mac live test holds it now, and the VoiceOver driver will. | FAIL: another voicecap is using VoiceOver. |
| Browser | What voicecap would launch (`resolveBrowser`, as today). | FAIL: run setup. |
| VoiceOver already on | VoiceOver's process is running. | WARN: it will be restored afterwards. |

Two things can't be checked without starting VoiceOver: whether the terminal app may control VoiceOver, and whether VoiceOver answers. The live test covers both.

### Windows

- **The checks:** today's `doctor` checks, unchanged: Node.js, Guidepup's folder, NVDA's build installed, another voicecap holding NVDA (FAIL), a locked session (FAIL, or WARN when Windows doesn't say), and the browser.
- **The person's own NVDA:** running is a WARN (an `nvda.exe` that isn't Guidepup's build). It's restored afterwards.
- **Machine info:** hardware and identifiers come from Node's `os` module and `fs.statfs`. The computer's maker and model come from `Get-CimInstance Win32_ComputerSystem`, through PowerShell as the Windows helpers already run it.

### Linux

A single FAIL: "voicecap drives NVDA on Windows and VoiceOver on macOS. On Linux, use replay runs."

## Guided setup on the Mac

`npx @icjia/voicecap setup` does four things, in order:

1. **Installs**, with progress shown:
   - Guidepup's VoiceOver files, with the pinned `@guidepup/setup install voiceover`, run in voicecap's installed `@guidepup/guidepup` package as `install nvda` is on Windows;
   - the browser, when none is found (today's `ensureBrowser`).
2. **Changes two VoiceOver settings, and says so.** The output names each setting and how to undo it:
   - `defaults write com.apple.VoiceOverTraining doNotShowSplashScreen -bool true` (no welcome screen);
   - `defaults write com.apple.VoiceOver4/default SCREnableAppleScript -bool true` (VoiceOver's own AppleScript setting, as Guidepup's setup sets it).
3. **Walks through each failing permission, one at a time.** The order is VoiceOver Utility's AppleScript checkbox, then Accessibility, then System Events, then Full Disk Access. Each step:
   - says in a sentence or two what it's for;
   - opens the right place (System Settings at the Privacy & Security page with `open "x-apple.systempreferences:…"`, or `open -a "VoiceOver Utility"`);
   - says exactly what to switch on, naming the terminal app;
   - waits for Enter, or `s` to skip, then checks again. If it still fails, it says what's still wrong and asks again.

   **Full Disk Access comes last.** macOS makes you quit and reopen the terminal app after it, so setup says: "When it reopens, run npx @icjia/voicecap setup again to finish." A rerun skips what's done. **System Events** isn't a System Settings step: setup sends the query and waits up to 60 seconds for Allow. The System Settings addresses are verified on macOS 26 during the build. Where one doesn't land on the exact page, the step's text still names the page.
4. **Ends with the preflight result.** When the computer is ready, it offers the live test.

Without a terminal to answer (stdin isn't a TTY), setup installs, changes the two settings, prints the remaining steps as a list, and exits 2 if the computer isn't ready.

On Windows, `setup` is unchanged (it installs NVDA, then the browser), except that it also ends with the preflight result and the offer of the live test.

## The live test

About 20 seconds. Ctrl+C stops it and cleans up.

**Windows:** today's `runLiveCheck` with the NVDA driver, unchanged:

- It starts NVDA and the browser and opens the check page.
- It goes to the top, then presses Tab once.
- It reports what NVDA said, the foreground check, and a WARN if NVDA isn't in English.

**Mac**, until the VoiceOver driver exists:

1. **Raise the "control VoiceOver" prompt with a live request.** Guidepup's own AppleScript calls give up after 10 seconds, and in the spike that left an unanswerable prompt. So before Guidepup starts, the test makes sure VoiceOver is running, starting it with VoiceOver's own starter if needed. It then sends a harmless AppleScript query to VoiceOver with a 60-second wait. A first-time prompt ("Visual Studio Code wants access to control VoiceOver") is then raised by a request that stays alive until it's answered.
2. **Start VoiceOver through Guidepup with voicecap's settings.** Hints are off: `SCRShouldOutputVOInstructions: false`.
3. **Bring the browser to the front.** Open the check page, bring the browser's own process to the front through System Events (`set frontmost of (first process whose unix id is <pid>) to true`), and confirm it's frontmost.
4. **Hear VoiceOver.** Capture VoiceOver's answer to VO-F4 ("describe the item with the keyboard focus"), as proof it hears the page.
5. **Clean up.** Stop VoiceOver, close the browser, and restore the person's VoiceOver.

Each step reports OK or FAIL with a diagnosis. For example: "Visual Studio Code isn't allowed to control VoiceOver: open System Settings, then Privacy & Security, then Automation, then Visual Studio Code, and switch on VoiceOver." When the VoiceOver driver lands, the Mac test becomes `runLiveCheck` with that driver, as on Windows.

## Restoring the person's own screen reader

This happens after the live test and after every real run, including on Ctrl+C or an error.

- **Mac:**
  - Before starting, voicecap notes whether VoiceOver is on.
  - Guidepup's stop removes voicecap's settings. If VoiceOver was on, voicecap starts it again with `/System/Library/CoreServices/VoiceOver.app/Contents/MacOS/VoiceOverStarter`, so it comes back with the person's settings.
  - If that fails, it says: "Turn VoiceOver back on with Command-F5."
  - The live test gets this now, and the VoiceOver driver gets it in sub-project 2.
- **Windows:**
  - Before starting, voicecap notes the person's running `nvda.exe` (any that isn't Guidepup's build) and its path.
  - After the NVDA driver's `stop()`, it starts that `nvda.exe` again, detached, which loads the person's own settings.
  - If that fails, it says how to start NVDA.
  - This changes today's NVDA driver, so real runs get it too.

## Runs, `doctor`, and `init`

- **Real runs:**
  - After the driver is chosen, and before it starts, a run does the quick checks for its platform.
  - **Passing** prints one line (`Checks passed: VoiceOver 10 on macOS 26.6.2`) plus any WARN lines.
  - **A FAIL** prints the "Not ready" block and exits 2. Nothing is written to the audit record.
  - Replay runs skip the checks. So does the `at-driver` driver, which keeps its own behavior: these checks are for Guidepup's NVDA and for VoiceOver.
  - Runs don't copy the preflight's hardware or identifiers into `run.json`, so names stay out of synced transcripts.
- **`doctor`:** the dated header, then the machine info, the checks, the live test, and a verdict.
  - It keeps its `OK`/`WARN`/`FAIL` lines, which paste into a bug report.
  - It keeps its exit codes: 0 ready, 2 not ready, 130 on Ctrl+C.
  - It works on both platforms.
- **`init`:**
  1. The preflight comes first. Not ready exits 2.
  2. When the computer is ready, the live test is offered. A failed live test exits 2 with its diagnosis; declining continues.
  3. Then the wizard, as today.
  4. At the end, "Run it now?" is offered on a ready computer. Its warning names the screen reader in use, "VoiceOver will speak and take over the keyboard until the run ends." on the Mac.
  5. `src/init/readiness.ts` goes away: the preflight's result replaces it.
- **Until the VoiceOver driver exists** (sub-project 2), a ready Mac still can't run anything:
  - Real runs on the Mac keep today's message that the configured NVDA driver only runs on Windows. The quick checks before runs apply to NVDA runs on Windows.
  - `init` on a ready Mac shows the command and says: "voicecap can't run VoiceOver yet: that comes with its VoiceOver driver. For now, run this command on a Windows computer." It doesn't offer "Run it now?".
  - The verdict of a ready Mac, in `init`'s preflight, `doctor`, and `setup`, reads "Ready: this computer is set up for VoiceOver, but voicecap can't run VoiceOver yet: that comes with its VoiceOver driver." It doesn't say the computer "can run VoiceOver". Added 2026-09-29, after the supervised run showed the old line promising too much.

  Sub-project 2 switches all three on for VoiceOver.

## Components

| Unit | Does | Depends on |
| --- | --- | --- |
| `src/readiness/model.ts` | **Types:** `MachineInfo`, `Check` (name, status, detail, plus for a problem: what's wrong, numbered fix steps, a System Settings page), and `PlatformReadiness` (machine info, quick checks, live test, guided steps). | — |
| `src/readiness/render.ts` | **The text:** the dated header, "This computer", "Checks", the "Not ready" blocks, the verdicts, and the one-line run summary. | model |
| `src/readiness/preflight.ts` | **Runs a platform's machine info and quick checks** and decides ready or not ready, for `init`, `doctor`, `setup`, and runs. | model, the platform module |
| `src/readiness/guided.ts` | **The guided loop:** explain, open, wait for Enter or `s`, then check again. It prints the list instead when there's no terminal. | model, init's prompter |
| `src/readiness/doctor.ts` | **`doctor`:** the preflight, the live test, and a verdict. It replaces `src/drivers/guidepup/doctor.ts`. | preflight, render |
| `src/drivers/readiness.ts` | **The platform mapping.** It's the only place that maps a platform to its readiness module, loaded lazily as drivers are, so nothing outside `src/drivers/` imports Guidepup. | — |
| `src/drivers/guidepup/readiness-windows.ts` | **The Windows side:** machine info, today's checks moved from `doctor.ts`, detecting the person's NVDA, and the NVDA live test. | Guidepup, Windows helpers, chrome |
| `src/drivers/voiceover/macos.ts` | **Mac helpers:** `osascript` with a timeout, finding the terminal app, the Accessibility answer, the System Events probe, the Full Disk Access test, System Settings addresses, bringing a process to the front by pid, noting and restarting VoiceOver, and machine info (`system_profiler`, `scutil`). | macOS commands |
| `src/drivers/voiceover/readiness-mac.ts` | **The Mac side:** the checks and the live test. | macos.ts, Guidepup, chrome |
| `src/drivers/voiceover/setup-mac.ts` | **The Mac guided setup.** | guided, macos.ts, `@guidepup/setup install voiceover`, the browser installer |
| `src/drivers/guidepup-nvda.ts` | **Restores** the person's NVDA after `stop()`. | Windows helpers |
| `src/cli/main.ts`, `src/init/wizard.ts` | **Wiring:** `init` (the preflight first, the offer of the live test, the screen reader named in "Run it now?"), runs (the quick checks before the driver starts), `setup` and `doctor` on each platform. | preflight |

## Tests

Vitest with injected fakes, as the NVDA driver's fake desktop does today. No test starts NVDA, VoiceOver, or a browser. Everything runs in CI on Ubuntu, macOS, and Windows.

- **Every check in all three states**, with fake command results, including the spike's real failures: EPERM from the VoiceOver preferences folder, `-1743` (not authorized), an `osascript` killed at its timeout, and no `.app` among the parent processes.
- **Finding the terminal app** from sample process chains: VS Code with its nested helper, Terminal, iTerm, and SSH.
- **The wording:** the header, "This computer", check lines, "Not ready" blocks, and verdicts.
- **The guided loop:** Enter, then pass; skip; still failing, then asked again; Full Disk Access's "run setup again"; and no terminal attached, which lists the steps and exits 2.
- **`init`:** not ready exits 2 before any question; ready offers the live test; declining continues to the wizard; "Run it now?" names the screen reader.
- **Runs:** a FAIL exits 2 and writes nothing; replay runs skip the checks; WARN lines are printed.
- **`doctor`:** on each platform, with fakes. Today's `setup-doctor` tests move with it.
- **Restoring:** after a normal stop, an error, and Ctrl+C. The Mac calls VoiceOver's starter only when VoiceOver was on. Windows restarts the noted `nvda.exe`.

## Documentation

- **README:** "Setting it up" gains a Mac section: the guided setup, each permission and why, and why the terminal app matters. The README also documents the preflight in `init`, `doctor` on both platforms, restoring the person's own screen reader, and the checks before real runs. Exit codes are unchanged.
- **CHANGELOG:** an entry for the release that ships each half.
- **The handoff:** `docs/phase-c-handoff.md` notes that readiness is designed and built.

As the working rules say, no text describes voicecap as not replacing screen reader testing.

## Not included

- **Sub-project 2: the VoiceOver driver and automatic driver choice**, including:
  - `driver: auto`;
  - the rules for each screen reader: phrasing, flag wording, end of page;
  - `--compare previous` comparing only runs from the same screen reader;
  - the environment record for VoiceOver.

  Its driver must raise the "control VoiceOver" prompt the same way as the live test, before Guidepup starts, and restore the person's VoiceOver.
- **Sub-project 3:** the recorded VoiceOver fixture run.
- **Mac paths for the installed Google Chrome** (`browserCandidates`), which go with the driver's choice of browser.
- **Reading the privacy database** to check permissions. The format is private, and the live test covers them instead.
- **Saving the preflight's output to a file**, or JSON output.
- **Other Mac settings:** turning on Do Not Disturb (the preflight only suggests it), and Guidepup's dictation setting.
- **Readiness for the `at-driver` driver.**
