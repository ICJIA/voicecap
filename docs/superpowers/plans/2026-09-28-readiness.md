# voicecap readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** before voicecap drives NVDA or VoiceOver, it shows what the computer is and whether it's ready. Every problem gets a plain-language diagnosis and numbered fix, and voicecap stops cleanly.

- **Commands:** `init` starts with this preflight. `doctor` works on both platforms. `setup` guides a Mac through its permissions. Real NVDA runs check first.
- **The person's own screen reader:** voicecap turns it back on afterwards.

**Architecture:**

- **`src/readiness/` (the core):** a screen-reader-neutral core holds the check and machine-info types, the text rendering, the preflight runner, the guided loop, `doctor`, and the generic live check.
- **Platform modules, in `src/drivers/`:** each implements `PlatformReadiness`. `src/drivers/guidepup/readiness-windows.ts` is the Windows one, and `src/drivers/voiceover/readiness-mac.ts` with `macos.ts` is the Mac one. Linux has a one-check module.
- **`src/drivers/readiness.ts`:** the only place that maps a platform to its module, loaded lazily like drivers. The core never imports Guidepup or Playwright.
- **The commands:** `init`, `doctor`, `setup`, and `runAudit` call the core.

**Tech Stack:** TypeScript 6 (ESM), Node ≥22.19, vitest, commander, `@guidepup/guidepup` 0.34.0 and `@guidepup/setup` 0.28.0 (pinned). On the Mac, `osascript`, `defaults`, `system_profiler`, `scutil`, `sw_vers`, `pgrep`, `ps`, `plutil`, and `open`. On Windows, `tasklist` and PowerShell. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-readiness-design.md`. The spike's findings, the evidence behind the Mac checks, are in `docs/phase-c-handoff.md` ("Spike findings").

## Global Constraints

- **Safety, for every implementer and subagent.** Never start NVDA, VoiceOver, or a browser. Never run the CLI's `setup`, `doctor`, `init`, `test:nvda`, `fixture:capture`, or a run without `--replay-from`. Never run `osascript`, `open`, `defaults write`, `killall`, `tccutil`, or VoiceOver's starter on the owner's Mac. Never pass a composed command through a shell that could split it. `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` are safe. Every macOS and Windows command goes through an injected runner that the tests fake.
- **Privacy settings.** voicecap never changes them: no writes to the privacy (TCC) database, no `tccutil`, no System Integrity Protection changes, no `@guidepup/setup setup`. The only settings voicecap writes are the two VoiceOver defaults in Mac setup (Task 8).
- **Architecture.** Nothing outside `src/drivers/` imports `@guidepup/*` or Playwright (`test/drivers.test.ts`, "architecture").
- **Exit codes.** Unchanged: 0 ready or completed, 2 not ready (`ExitCode.environment`), 130 Ctrl+C.
- **Status words.** Exactly `OK`, `WARN`, `FAIL`, padded to 6 columns (`  OK    …`).
- **Wording.** Plain language for non-technical readers. Never say that voicecap doesn't replace screen reader testing.
- **Waits.**
  - The two permission probes (System Events, and control of VoiceOver) wait 60 seconds: `with timeout of 60 seconds` in the script, and the process is killed at 65 seconds.
  - Other `osascript` calls wait 10 seconds.
- **Commits.** The owner commits and pushes only when they say so, so tasks end with a full test run, not a commit. No AI attribution trailer in any commit message.
- **Platform-only code** (Windows helpers, macOS helpers) is tested with fakes and runs in CI on Ubuntu, macOS, and Windows.

## Review Focus

- **A nested app bundle.** A parent chain like VS Code's, with a `Code Helper.app` inside `Visual Studio Code.app`, names the outer app, "Visual Studio Code". Test in Task 4.
- **A probe killed at its timeout** reports "macOS may be waiting for you to answer …", never a raw `Command failed: /usr/bin/osascript`. That goes for the System Events probe and the VoiceOver one. Tests in Tasks 4, 5, and 6.
- **The person's own screen reader comes back** even when the live test or run fails, throws, or is interrupted with Ctrl+C. Tests in Task 6 (VoiceOver) and Task 11 (NVDA).
- **Full Disk Access granted during setup.** The re-check still fails in the same process, because macOS applies it after the terminal app reopens. Setup must say "run setup again" and exit 2, not ask forever. Test in Task 8.
- **A real NVDA run on a not-ready Windows computer** exits 2 with the "Not ready" block before it creates the site folder or touches NVDA. Replay runs never run the checks. Test in Task 10.

---

### Task 1: The readiness model and its text

**Files:**
- Create: `src/readiness/model.ts`, `src/readiness/render.ts`
- Test: `test/readiness-render.test.ts` (create)

**Interfaces:**
- Produces (`model.ts`):

  ```ts
  export type CheckStatus = "OK" | "WARN" | "FAIL";
  export interface Problem {
    title: string;            // "Full Disk Access for Visual Studio Code"
    whatsWrong: string;       // follows "What's wrong: "
    fix: string[];            // numbered under "How to fix:"
    setupHelps: boolean;      // adds "Or run npx @icjia/voicecap setup, which walks you through it."
    open?: { kind: "settings"; url: string; page: string } | { kind: "app"; name: string };
    needsRestart?: boolean;   // passes only after the terminal app quits and reopens
  }
  export interface Check { id: string; status: CheckStatus; summary: string; problem?: Problem }
  export interface CheckRunner { id: string; run(): Promise<Check> }
  export interface MachineInfo {
    lines: { label: string; value: string }[];
    screenReader: string | null; // for the run summary, e.g. "NVDA 2026.2", "VoiceOver 10"
    system: string;              // for the run summary, e.g. "Windows 11 Pro 24H2", "macOS 26.6.2"
  }
  export interface PreflightResult { info: MachineInfo; checks: Check[]; ready: boolean }
  export interface PlatformReadiness {
    readonly screenReader: string | null;   // "NVDA", "VoiceOver", or null (Linux)
    readonly cannotRunYet: string | null;   // why runs can't happen here yet, or null when they can
    readonly readyTip: string | null;       // printed after "Ready: …"
    readonly liveTestNotice: string[];      // said before asking to run the live test
    machineInfo(): Promise<MachineInfo>;
    quickChecks(): CheckRunner[];
    liveTest: ((signal?: AbortSignal) => Promise<Check[]>) | null; // throws InterruptedError on Ctrl+C
  }
  ```

- Produces (`render.ts`):
  - `renderHeader(kind: "preflight" | "doctor", when: Date): string` returns `voicecap preflight, 2026-09-28 11:10`: local time, `YYYY-MM-DD HH:MM`, zero-padded.
  - `renderMachineInfo(info: MachineInfo): string` returns `This computer` plus one line per entry: `"  " + label.padEnd(16) + value`.
  - `renderChecks(checks: Check[]): string` returns `Checks` plus `"  " + status.padEnd(6) + summary`.
  - `renderProblems(checks: Check[], options: { offerSetup: boolean }): string` returns `Not ready: 1 problem.` (or `2 problems.`), a blank line, then a numbered block per FAIL:
    - `N. <title>`;
    - `   What's wrong: <whatsWrong>`, wrapped with `wrap`;
    - `   How to fix:`;
    - `     K. <step>` lines;
    - `   Or run npx @icjia/voicecap setup, which walks you through it.`, only when `setupHelps && offerSetup`.

    Blocks are separated by a blank line.
  - `renderVerdict(result, options: { screenReader: string | null; tip: string | null; offerSetup: boolean }): string`:
    - Ready: `Ready: this computer can run <screenReader> for voicecap.`, then the tip line if there is one.
    - Otherwise: `renderProblems`.
  - `renderPreflight(result, options: { kind; when; screenReader; tip; offerSetup }): string` joins the header, machine info, checks, and verdict, with a blank line between each. Callers pass `when: new Date()` (or the injected `now()`), `screenReader: platform.screenReader`, and `tip: platform.readyTip`. Later tasks write only the options that differ, such as `renderPreflight({ kind: "doctor", …, offerSetup: true })`.
  - `renderRunSummary(result: PreflightResult): string` returns `Checks passed: <info.screenReader> on <info.system>` plus a `  WARN  <summary>` line per WARN.
  - `wrap(text: string, width: number, firstPrefix: string, restPrefix: string): string[]` breaks at spaces. No line is longer than `width` unless a single word is. Use width 96.

- [ ] **Step 1: Write the failing tests:**
  - `"renders the spec's example exactly"`: build the spec's "What someone sees" result as a literal. That's the 12 machine lines, the 8 checks, and the one Full Disk Access problem with its 4 steps and `setupHelps: true`. `renderPreflight` with `kind: "preflight"`, `new Date(2026, 8, 28, 11, 10)`, `screenReader: "VoiceOver"`, and `offerSetup: true` equals the spec's block, character for character.
  - `"says Ready, with the tip"`: an all-OK result gives `Ready: this computer can run VoiceOver for voicecap.\nTip: turn on Do Not Disturb, so notifications don't interrupt VoiceOver.`
  - `"counts problems"`: two FAILs give `Not ready: 2 problems.` and blocks `1.` and `2.`
  - `"leaves out the setup line when setup is the one asking"`: with `offerSetup: false`, the output has no `Or run npx @icjia/voicecap setup`.
  - `"wraps long text under its label"`: a 200-character `whatsWrong` gives lines of at most 96 characters, the second starting with 3 spaces.
  - `"sums up a passing run in one line, plus warnings"`: `renderRunSummary` gives `Checks passed: NVDA 2026.2 on Windows 11 Pro 24H2\n  WARN  Your NVDA is running: voicecap will use its own NVDA, then turn yours back on`.
- [ ] **Step 2: Run** `pnpm exec vitest run test/readiness-render.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** `model.ts` (types only) and `render.ts` (pure functions, no I/O).
- [ ] **Step 4: Run** it again. Expect PASS.

---

### Task 2: The preflight, the platform mapping, and Linux

**Files:**
- Create: `src/readiness/preflight.ts`, `src/readiness/machine.ts`, `src/readiness/common-checks.ts`, `src/drivers/readiness.ts`
- Test: `test/readiness-preflight.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's types.
- Produces:
  - `runPreflight(platform: PlatformReadiness): Promise<PreflightResult>`.
    - It runs `machineInfo()`, then each runner in order, one at a time, because a check may raise a macOS prompt.
    - A runner that throws becomes `{ id, status: "FAIL", summary: "Couldn't check <id>: <message>", problem: { title: "An unexpected error", whatsWrong: <message>, fix: ["Run npx @icjia/voicecap doctor and send its output to the voicecap maintainers."], setupHelps: false } }`.
    - `ready` is true when no check is a FAIL.
  - `machine.ts`:
    - `gigabytes(bytes: number): string` rounds to whole GiB and appends ` GB`, e.g. `"16 GB"`.
    - `diskSpace(dir: string, statfs = fs.statfs): Promise<{ free: number; total: number } | null>` computes `bavail * bsize` and `blocks * bsize`, and returns null when `statfs` throws.
    - `languageName(locale: string | null): string | null` reads `en_US` or `en-US` as `English (United States)` with `Intl.DisplayNames(["en"], { type: "language" })`, and returns null for null.
    - `homePath(file: string, home: string): string` shows a path under the home folder as `~/…`.
  - `common-checks.ts` holds the checks both platforms share, with no driver imports:
    - `MIN_NODE = [22, 19, 0]` and `nodeIsSupported(version)`, both moved from today's `doctor.ts`.
    - `nodeCheck(version: string, again: string): Check` (id `node`):
      - OK `Node.js <v>`.
      - FAIL `Node.js <v> is too old`, problem `{ title: "Node.js", whatsWrong: "voicecap needs Node.js 22.19 or later.", fix: ["Install the current Node.js LTS from https://nodejs.org.", "Run <again> again."], setupHelps: false }`.
    - `otherVoicecapCheck(holder: { pid: number; startedAt: string } | null, lockFile: string, screenReader: string, again: string): Check` (id `otherVoicecap`):
      - OK `No other voicecap is using <screenReader>`.
      - FAIL `Another voicecap is using <screenReader>`, problem `{ title: "Another voicecap", whatsWrong: "Another voicecap (process <pid>, started <startedAt>) is using <screenReader> on this computer, and only one can at a time.", fix: ["Wait for it to finish, or stop it.", "If no other voicecap is running, delete its lock: <lockFile>", "Run <again> again."], setupHelps: false }`.
    - `browserCheck(resolve: () => { name: string; path: string }): Check` (id `browser`):
      - OK `Browser: <name>`.
      - When `resolve` throws: FAIL `No browser for voicecap`, problem `{ title: "The browser", whatsWrong: <the error's message>, fix: ["Run npx @icjia/voicecap setup."], setupHelps: true }`.
  - `src/drivers/readiness.ts`:
    - `interface ReadinessOptions { platform: NodeJS.Platform; config: VoicecapConfig; logger: Logger; env: NodeJS.ProcessEnv; cwd: string; again: string }`. `again` is the command to rerun, such as `npx @icjia/voicecap init` or `the same command`.
    - `loadPlatformReadiness(options: ReadinessOptions): Promise<PlatformReadiness>` maps:
      - `win32` to `(await import("./guidepup/readiness-windows.js")).windowsReadiness(options)`;
      - `darwin` to `(await import("./voiceover/readiness-mac.js")).macReadiness(options)`;
      - anything else to `otherReadiness(options)`, in this file.
  - `otherReadiness`:
    - `screenReader: null`, `cannotRunYet: "voicecap drives NVDA on Windows and VoiceOver on macOS."`, `readyTip: null`, `liveTestNotice: []`, `liveTest: null`.
    - Machine lines:
      - `Computer` is `<os.hostname()>, user <os.userInfo().username>`;
      - `Model` is `<os.cpus()[0].model>, <gigabytes(totalmem)> memory, <free> free of <total>`;
      - `System` is `<os.type()> <os.release()>, <process.arch>`;
      - `Node.js`, `voicecap`, and `Transcripts` (from `resolveHome`).
    - One runner, `id: "platform"`:
      - FAIL `This is <os.type()>: voicecap drives NVDA on Windows and VoiceOver on macOS`;
      - problem `{ title: "No screen reader to drive here", whatsWrong: "voicecap drives NVDA on Windows and VoiceOver on macOS, and neither runs here.", fix: ["Use replay runs here: add --replay-from <run folder> to the command.", "Run real audits on a Windows computer or a Mac."], setupHelps: false }`.
- [ ] **Step 1: Write the failing tests:**
  - `runPreflight`:
    - ready with only OK and WARN;
    - not ready with one FAIL;
    - runs the runners in order, one at a time, recording start and end order in the fakes;
    - turns a throwing runner into the "Couldn't check" FAIL.
  - `loadPlatformReadiness({ platform: "linux", … })` gives one FAIL check with the exact summary and problem, and `liveTest` null.
  - `gigabytes(17179869184)` is `"16 GB"`; `languageName("en_US")` is `"English (United States)"`; `languageName(null)` is null.
  - `diskSpace` with a fake statfs (`bavail 1000, bsize 4096, blocks 5000`) gives `{ free: 4096000, total: 20480000 }`; a throwing statfs gives null.
  - `nodeCheck`: `22.19.0` and `24.1.0` pass; `22.18.2` fails with the exact problem.
  - `otherVoicecapCheck`: a holder gives the FAIL naming the process, its start time, the screen reader, and the lock file; null gives OK.
  - `browserCheck`: a throwing `resolve` gives the FAIL with its message.
- [ ] **Step 2: Run** `pnpm exec vitest run test/readiness-preflight.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** `src/drivers/readiness.ts` imports the platform modules only through `import()`, so replay runs never load Guidepup. It's the one file outside the driver folders' own modules that knows the platform modules exist.
- [ ] **Step 4: Run** `pnpm exec vitest run test/readiness-preflight.test.ts test/drivers.test.ts`. Expect PASS.

---

### Task 3: Windows readiness

**Files:**
- Create: `src/drivers/guidepup/readiness-windows.ts` and `src/readiness/live-check.ts`. `LiveCheck`, `runLiveCheck`, and the check page move here from `src/drivers/guidepup/doctor.ts`, which Task 7 deletes.
- Modify:
  - `src/drivers/guidepup/windows.ts`: add `parseNvdaProcesses`, `nvdaProcesses`, `windowsComputerModel`, `windowsBrowserVersion`.
  - `src/drivers/guidepup/paths.ts`: `unsafePathProblem`, with `unsafePathMessage` built from it.
- Test: `test/readiness-windows.test.ts` (create); `test/readiness-live-check.test.ts` (create, with today's `runLiveCheck` cases moved from `test/setup-doctor.test.ts`); `test/windows-helpers.test.ts`.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:
  - `src/readiness/live-check.ts`:
    - `LiveCheck` and `runLiveCheck(driver, url, config, signal?, onCleanup?)`, moved unchanged except for the step labels: "Starting the screen reader and the browser" in place of "Starting NVDA and the browser".
    - `serveCheckPage(): Promise<{ url: string; close(): Promise<void> }>` serves today's `CHECK_PAGE` on 127.0.0.1. The page's paragraph becomes `If the screen reader reads this, voicecap can hear it.`
  - `paths.ts`: `unsafePathProblem(install): { whatsWrong: string; fix: string[] } | null`.
    - `whatsWrong` is today's first line.
    - `fix` is `["Choose a folder whose path has only letters, digits, and - _ . in its names, set GUIDEPUP_SCREEN_READERS_PATH to it, and install NVDA there. In Git Bash: mkdir -p /c/guidepup && setx GUIDEPUP_SCREEN_READERS_PATH 'C:\\guidepup'", "Open a new terminal and run: npx @icjia/voicecap setup"]`.
    - `unsafePathMessage` returns exactly today's text, which its existing tests pin.
  - `windows.ts`:
    - `parseNvdaProcesses(stdout): { pid: number; path: string | null }[]` reads lines of `<pid>|<path>`, where an empty path is null.
    - `nvdaProcesses()` runs PowerShell `Get-CimInstance Win32_Process -Filter "Name='nvda.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }` (`-NoProfile -NonInteractive`, `windowsHide`, 20-second timeout).
    - `windowsComputerModel(): Promise<string | null>` gives `<Manufacturer> <Model>` from `Win32_ComputerSystem`.
    - `windowsBrowserVersion(file): Promise<string | null>` gives `(Get-Item -LiteralPath '<file>').VersionInfo.ProductVersion`.
  - `readiness-windows.ts`:
    - `interface WindowsReadinessDeps`, all injectable: `nodeVersion`, `voicecapVersion`, `guidepup: GuidepupPackage`, `install: GuidepupInstall`, `exists(file)`, `nvdaProcesses()`, `otherVoicecap(): Promise<LockHolder | null>`, `nvdaLockFile`, `sessionLocked()`, `system(): { os; uiLocale }`, `computerModel()`, `hostname()`, `username()`, `cpu()`, `totalmem()`, `disk(): Promise<{ free; total } | null>`, `resolveBrowser()`, `browserVersion(file)`, `transcripts: string`, `liveCheck(signal?): Promise<LiveCheck>`.
    - `windowsReadiness(options: ReadinessOptions, deps = realWindowsDeps(options)): PlatformReadiness`.
  - The Windows `PlatformReadiness`:
    - `screenReader` is `"NVDA"`, `cannotRunYet` is null, and `readyTip` is null.
    - `liveTestNotice` is `["The live test takes about 20 seconds. NVDA speaks and takes over the keyboard, so keep your hands off."]`.
  - Machine lines, in order:
    - `Computer`: `<hostname>, user <username>`;
    - `Model`: `<model>, <cpu>, <mem> memory, <free> free of <total>` (a part that's unknown is left out);
    - `System`: `<system().os>, <process.arch>`;
    - `Node.js`;
    - `voicecap`: `<v>, with @guidepup/guidepup <gv>`;
    - `Screen reader`: `NVDA <version> (Guidepup's build <build>)`;
    - `Browser`: `<name> <version>`;
    - `Language`: `languageName(uiLocale)`;
    - `Transcripts`;
    - `Guidepup files`: `install.cacheDir`;
    - `Browser path`.

    `screenReader` is `NVDA <version>`, and `system` is `system().os`.
  - Check runners, in order, with `<again>` from the options:
    - `node`: `nodeCheck(nodeVersion, again)` (Task 2).
    - `guidepupFolder`:
      - OK `Guidepup's folder: <cacheDir>`.
      - FAIL `Guidepup's folder has a path NVDA can't start from`, problem `{ title: "Guidepup's folder", …unsafePathProblem, setupHelps: false }`.
    - `nvda`:
      - OK `NVDA <version> (Guidepup's build <build>) is installed`.
      - FAIL `NVDA for voicecap isn't installed`, problem `{ title: "NVDA for voicecap", whatsWrong: "voicecap uses Guidepup's own copy of NVDA (build <build>), and it isn't installed yet.", fix: ["Run npx @icjia/voicecap setup."], setupHelps: true }`.
    - `otherVoicecap`: `otherVoicecapCheck(await otherVoicecap(), nvdaLockFile, "NVDA", again)` (Task 2).
    - `ownNvda`: WARN `Your NVDA is running: voicecap will use its own NVDA, then turn yours back on`. The line appears only when an `nvda.exe` other than Guidepup's is running; paths are compared with `path.win32.normalize(...).toLowerCase()`. When there isn't one, the runner returns OK `Your NVDA isn't running`.
    - `session`:
      - OK `Windows is unlocked`.
      - WARN `Windows didn't say whether it's locked: keep it unlocked while voicecap runs`.
      - FAIL `Windows is locked`, problem `{ title: "Windows is locked", whatsWrong: "NVDA can't press keys or speak while Windows is locked.", fix: ["Unlock the computer.", "Run <again> again."], setupHelps: false }`.
    - `browser`: `browserCheck(resolveBrowser)` (Task 2).
  - `liveTest`, from `deps.liveCheck`:
    - Speech:
      - OK `NVDA speaks: "<a>" / "<b>" (<x.x> s per step)`.
      - FAIL `NVDA started, but voicecap heard nothing from it`, problem `{ title: "NVDA's speech", whatsWrong: "NVDA started, but voicecap captured no speech from it.", fix: ["Run <again> again.", "If it happens again, run npx @icjia/voicecap setup."], setupHelps: true }`.
    - Foreground: OK `The browser came to the front (checked with NVDA+T)`.
    - Language:
      - OK `NVDA's language: <lang>`.
      - WARN `NVDA's language is <lang or unknown>: voicecap's end-of-page detection and flags expect NVDA's English phrasing`.
    - Errors:
      - A `ForegroundError` gives FAIL `The browser didn't come to the front`, problem `{ title: "The browser's window", whatsWrong: <message>, fix: ["Don't use the keyboard or mouse during the test.", "Run <again> again."], setupHelps: false }`.
      - Any other error gives FAIL `The live test failed`, problem `{ title: "The live test", whatsWrong: <message>, fix: ["Run <again> again."], setupHelps: false }`.
      - `InterruptedError` propagates.
- [ ] **Step 1: Write the failing tests:**
  - Every runner's OK, WARN, and FAIL, with fakes, asserting exact summaries and problems.
  - The machine lines for a sample:
    - host `ICJIA-PC`, user `pat`;
    - model `Dell Inc. OptiPlex 7010`, CPU `Intel(R) Core(TM) i7-13700`, 32 GiB, 400 GiB free of 953 GiB;
    - OS `Windows 11 Pro 24H2`, `x64`, UI locale `en-US`;
    - Chrome `142.0.7444.60`.
  - The live test mapping: speech captured, speech empty, a `ForegroundError`, another error, an English and a non-English language, and `InterruptedError` rethrown.
  - `parseNvdaProcesses("1234|C:\\Program Files (x86)\\NVDA\\nvda.exe\r\n5678|\r\n")` gives two entries, the second with path null.
  - Guidepup's own `nvda.exe`, in different letter case, isn't counted as the person's NVDA.
  - `unsafePathMessage` is unchanged. Keep the existing assertions.
  - The moved `runLiveCheck` tests pass from their new file.
- [ ] **Step 2: Run** `pnpm exec vitest run test/readiness-windows.test.ts test/readiness-live-check.test.ts test/windows-helpers.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** `realWindowsDeps` wires the real helpers: `listProcesses` stays for the driver, `nvdaProcesses` is new, and `readLockHolder`/`isStale` for `otherVoicecap` are as in today's `doctor.ts`. The live check is `runLiveCheck(createGuidepupNvdaDriver(...), (await serveCheckPage()).url, config, signal)`, closing the server afterwards.
- [ ] **Step 4: Run** those tests again. Expect PASS.

---

### Task 4: macOS helpers

**Files:**
- Create: `src/drivers/voiceover/macos.ts`, `test/helpers/fake-commands.ts`
- Test: `test/macos-helpers.test.ts` (create)

**Interfaces:**
- Produces (`macos.ts`):
  - `interface CommandResult { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }`.
  - `type RunCommand = (file: string, args: string[], options?: { timeoutMs?: number }) => Promise<CommandResult>`, and `runCommand: RunCommand`, which is `execFile` with no shell. It kills the process at `timeoutMs` and never throws for a non-zero exit.
  - `PROBE_TIMEOUT_MS = 60_000` and `SHORT_TIMEOUT_MS = 10_000`.
  - `type AppleScriptAnswer = { ok: true; value: string } | { ok: false; reason: "denied" | "no-answer" | "failed"; message: string }`.
  - `runAppleScript(run, script, { timeoutMs, javascript? }): Promise<AppleScriptAnswer>`:
    - AppleScript is wrapped as `with timeout of <ceil(timeoutMs/1000)> seconds\n<script>\nend timeout` and run with `osascript -e`. JavaScript (`-l JavaScript`) isn't wrapped.
    - The process is killed at `timeoutMs + 5000`.
    - `denied`: stderr contains `-1743` or `Not authorized to send Apple events`.
    - `no-answer`: the process was killed by the timeout, or stderr contains `-1712`.
    - `failed`: anything else, with `message` set to stderr trimmed.
    - `ok`: stdout trimmed.
  - Processes:
    - `interface ProcessRow { pid: number; ppid: number; command: string }`.
    - `parseProcessTable(stdout)` reads `ps -A -o pid=,ppid=,comm=`.
    - `terminalAppBundle(rows, startPid): string | null` walks up the parents to the first command containing `.app/`, and returns that path cut at the end of its **first** `.app` segment, the outermost bundle.
    - `terminalApp(run, startPid = process.pid): Promise<{ name: string; bundle: string } | null>`. The name comes from `plutil -extract CFBundleDisplayName raw -o - <bundle>/Contents/Info.plist`, else `CFBundleName`, else the bundle's file name without `.app`.
  - Permission probes:
    - `accessibilityTrusted(run): Promise<boolean>` runs JavaScript `ObjC.import("ApplicationServices"); $.AXIsProcessTrusted()` and returns true when the answer is `true`.
    - `systemEventsAccess(run)` runs `tell application "System Events" to get name of first process whose frontmost is true` at `PROBE_TIMEOUT_MS`.
    - `askVoiceOver(run)` runs `tell application "VoiceOver" to get text under cursor of vo cursor` at `PROBE_TIMEOUT_MS`.
  - Files and settings:
    - `voiceOverPrefsDir(home)` is `<home>/Library/Group Containers/group.com.apple.VoiceOver/Library/Preferences`.
    - `canWriteVoiceOverPrefs(dir, fs = { writeFile, rm }): Promise<{ ok: true } | { ok: false; code: string; message: string }>` writes and removes `.voicecap-check-<pid>`.
    - `APPLESCRIPT_ENABLED_FILE = "/private/var/db/Accessibility/.VoiceOverAppleScriptEnabled"`.
    - `readDefault(run, domain, key): Promise<string | null>` runs `defaults read`, trimmed, and returns null on a non-zero exit.
    - `writeDefault(run, domain, key, value: boolean): Promise<void>` runs `defaults write <domain> <key> -bool true|false` and throws `EnvironmentError` on a non-zero exit.
  - VoiceOver:
    - `voiceOverRunning(run): Promise<boolean>` runs `pgrep -f "VoiceOver launchd -s"`, as Guidepup's `isRunning` does.
    - `VOICEOVER_STARTER = "/System/Library/CoreServices/VoiceOver.app/Contents/MacOS/VoiceOverStarter"`, and `startVoiceOver(run)` runs it.
    - `raiseProcess(run, pid): Promise<{ ok: true } | { ok: false; frontmostPid: number | null; message: string }>` runs System Events `set frontmost of (first process whose unix id is <pid>) to true`, waits 300 ms, then reads `get unix id of first process whose frontmost is true`.
  - System Settings:
    - `SETTINGS_PAGES`, typed `Record<"accessibility" | "fullDiskAccess" | "automation", { kind: "settings"; url: string; page: string }>`:
      - `accessibility`: `{ kind: "settings", url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility", page: "Accessibility" }`;
      - `fullDiskAccess`: `{ kind: "settings", url: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles", page: "Full Disk Access" }`;
      - `automation`: `{ kind: "settings", url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation", page: "Automation" }`.
    - `openTarget(run, target: NonNullable<Problem["open"]>)` runs `open <url>` or `open -a <name>`.
  - Permission problems, shared by Tasks 5 and 6:
    - `automationDeniedProblem(app: string, target: "System Events" | "VoiceOver", again: string): Problem` gives `{ title: "Control of <target>", whatsWrong: "<why>, and macOS asks you once whether <app> may control it. It was turned down.", fix: ["Open System Settings, then Privacy & Security, then Automation.", "Under <app>, switch on <target>.", "Run <again> again."], setupHelps: true, open: SETTINGS_PAGES.automation }`. `<why>` is `voicecap sends VoiceOver's keys through System Events` for System Events, and `voicecap drives VoiceOver through AppleScript` for VoiceOver.
    - `permissionPromptProblem(app: string, target: "System Events" | "VoiceOver", again: string): Problem` gives `{ title: "A permission prompt", whatsWrong: "macOS may be waiting for you to answer \"<app> wants access to control <target>\".", fix: ["If that prompt is on screen, click Allow.", "Run <again> again.", "If the prompt doesn't close when you click it, log out and back in, then run <again> again."], setupHelps: false }`.
  - This Mac:
    - `macSystem(run): Promise<{ version; build; arch: "Apple silicon" | "Intel"; model: string | null; identifier: string | null; chip: string | null; computerName: string | null; locale: string | null }>`.
      - `sw_vers -productVersion` and `-buildVersion`.
      - `uname -m`: `arm64` is Apple silicon.
      - `system_profiler SPHardwareDataType -json`: `machine_name`, `machine_model`, and `chip_type` or else `cpu_type`.
      - `scutil --get ComputerName` and `defaults read -g AppleLocale`.
    - `bundleVersion(run, bundle): Promise<string | null>` gives `CFBundleShortVersionString`.
    - `voiceOverVersion(run): Promise<{ version: string; build: string } | null>` gives VoiceOver.app's `CFBundleShortVersionString` and `CFBundleVersion`.
- Produces (`test/helpers/fake-commands.ts`): `fakeCommands(answers: Array<[match: (file: string, args: string[]) => boolean, result: Partial<CommandResult>]>)` returns `{ run: RunCommand; calls: { file: string; args: string[]; timeoutMs?: number }[] }`. The first matching answer wins. An unmatched call returns `code: 1`, with `stderr` `unexpected command: <file> <args>`.
- [ ] **Step 1: Write the failing tests:**
  - `runAppleScript` classification:
    - stderr `execution error: Not authorized to send Apple events to System Events. (-1743)` gives `denied`;
    - `signal: "SIGTERM"` gives `no-answer`;
    - stderr with `(-1712)` gives `no-answer`;
    - other stderr gives `failed`;
    - exit 0 with `"x\n"` gives `{ ok: true, value: "x" }`;
    - the script is wrapped in `with timeout of 60 seconds`, and `timeoutMs` passed to `run` is 65000.
  - `terminalAppBundle` for four chains:
    - `zsh` → `claude` → `zsh` → `/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper` → `/Applications/Visual Studio Code.app/Contents/MacOS/Code` gives `/Applications/Visual Studio Code.app`;
    - `/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal` gives `Terminal.app`;
    - `/Applications/iTerm.app/Contents/MacOS/iTerm2` gives `iTerm.app`;
    - `sshd-session` → `zsh` gives null.
  - `terminalApp` names: `CFBundleDisplayName` when present, else `CFBundleName`, else the file name.
  - `raiseProcess`: the frontmost pid equal to the target gives ok; a different one gives `{ ok: false, frontmostPid: 99 }`.
  - `canWriteVoiceOverPrefs` with a fake `writeFile` throwing `EPERM` gives `{ ok: false, code: "EPERM" }`.
  - `macSystem` parses a recorded `system_profiler` JSON: `{"SPHardwareDataType":[{"machine_name":"Mac mini","machine_model":"Mac16,10","chip_type":"Apple M4"}]}`, with `sw_vers` `26.6.2`/`25G83`, `uname` `arm64`, and `scutil` `cschweda's Mac mini`.
  - `readDefault` gives null on exit 1.
  - `automationDeniedProblem("Visual Studio Code", "VoiceOver", "npx @icjia/voicecap doctor")` and `permissionPromptProblem(…, "System Events", …)` give their exact texts.
- [ ] **Step 2: Run** `pnpm exec vitest run test/macos-helpers.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** Only `runCommand` touches `node:child_process`. Everything else takes the `run` argument.
- [ ] **Step 4: Run** it again. Expect PASS.

---

### Task 5: Mac quick checks and machine info

**Files:**
- Create: `src/drivers/voiceover/readiness-mac.ts`
- Test: `test/readiness-mac.test.ts` (create)

**Interfaces:**
- Consumes: Tasks 1, 2 and 4, plus `resolveBrowser` (`src/drivers/guidepup/chrome.ts`), `acquireLockFile`, `readLockHolder` and `isStale` (`src/util/lock-file.ts`).
- Produces:
  - `voiceOverLockFile(home)` is `<home>/Library/Caches/voicecap/voiceover.lock`.
  - `guidepupCacheDir(env, home)` is `GUIDEPUP_SCREEN_READERS_PATH` when set (resolved), else `<home>/Library/Caches/guidepup`. That mirrors Guidepup 0.34.0's `lib/resolveCachePath.js`.
  - `voiceOverAsset(manifest, darwinMajor, cacheDir): { supported: string[]; file: string | null }`.
    - It reads Guidepup's `manifest.json` `screenReaders[id=voiceover].assets`.
    - `file` is `<cacheDir>/voiceover/<platformVersion>/<version>/<asset>`.
    - `macOSForDarwin(d)` is `d >= 25 ? d + 1 : d - 9`, so Darwin 21–24 give macOS 12–15 and Darwin 25 gives 26.
  - `interface MacReadinessDeps`: `run: RunCommand`, `pid`, `home`, `env`, `nodeVersion`, `voicecapVersion`, `guidepup: { version: string; manifest: unknown }`, `darwinMajor: number`, `exists(file)`, `writeVoiceOverPrefs(): Promise<…>` (`canWriteVoiceOverPrefs` bound to the folder), `otherVoicecap(): Promise<LockHolder | null>`, `lockFile`, `resolveBrowser(): BrowserExecutable`, `transcripts`, `totalmem()`, `disk()`, `liveTest(signal?): Promise<Check[]>` (Task 6).
  - `macReadiness(options: ReadinessOptions, deps = realMacDeps(options)): PlatformReadiness`:
    - `screenReader` is `"VoiceOver"`.
    - `cannotRunYet` is `"voicecap can't run VoiceOver yet: that comes with its VoiceOver driver. For now, run this command on a Windows computer."`.
    - `readyTip` is `"Tip: turn on Do Not Disturb, so notifications don't interrupt VoiceOver."`.
    - `liveTestNotice` is `["The live test takes about 20 seconds. VoiceOver speaks and takes over the keyboard, so keep your hands off.", "If macOS asks whether <app> can control VoiceOver, click Allow."]`.
  - Machine lines, as in the spec's example:
    - `Computer`: `<computerName>, user <username>`;
    - `Model`: `<model> (<identifier>), <chip>, <mem> memory, <free> free of <total>`;
    - `System`: `macOS <version> (<build>), <arch>`;
    - `Terminal app`: `<name> (macOS gives permissions to this app)`, or `none found`;
    - `Node.js`;
    - `voicecap`: `<v>, with @guidepup/guidepup <gv>`;
    - `Screen reader`: `VoiceOver <version> (build <build>)`;
    - `Browser`: `<name> <version>`, plus ` (Playwright's)` for Playwright's build. The version comes from `bundleVersion` of the `.app` holding the executable.
    - `Language`;
    - `Transcripts`;
    - `Guidepup files`: `guidepupCacheDir`;
    - `Browser path`, shown with `homePath`.

    `screenReader` is `VoiceOver <version>`, and `system` is `macOS <version>`.
  - Check runners, in order, with `<app>` the terminal app's name, or `the app voicecap runs in` when there's none:
    - `version`:
      - OK `macOS <major> is supported`.
      - FAIL `macOS <version> isn't supported by voicecap's Guidepup`, problem `{ title: "macOS <version>", whatsWrong: "voicecap drives VoiceOver through Guidepup <gv>, which supports macOS <first> through <last>.", fix: ["Use a Mac with a supported version of macOS."], setupHelps: false }`.
    - `node`: `nodeCheck(nodeVersion, again)` (Task 2).
    - `terminal`:
      - OK `Terminal app: <app>`.
      - FAIL `No terminal app found`, problem `{ title: "The terminal app", whatsWrong: "macOS gives the permissions VoiceOver automation needs to an app, such as Terminal or Visual Studio Code, and voicecap isn't running inside one (over SSH, for example).", fix: ["Open Terminal (or Visual Studio Code) on this Mac and run <again> there."], setupHelps: false }`.
    - `assets`:
      - OK `VoiceOver's files for Guidepup are installed`.
      - FAIL `VoiceOver's files for Guidepup aren't installed`, problem `{ title: "VoiceOver's files for Guidepup", whatsWrong: "Guidepup starts VoiceOver with its own settings file, which isn't in <cacheDir> yet.", fix: ["Run npx @icjia/voicecap setup."], setupHelps: true }`.
    - `appleScript`:
      - OK `VoiceOver can be controlled by AppleScript`.
      - FAIL `VoiceOver can't be controlled by AppleScript`, problem `{ title: "AppleScript control of VoiceOver", whatsWrong: "voicecap sends VoiceOver its commands through AppleScript, which VoiceOver accepts only once you allow it.", fix: ["Open VoiceOver Utility (in Applications, then Utilities).", "Under General, tick \"Allow VoiceOver to be controlled with AppleScript\", and enter your Mac's password when asked.", "Run <again> again."], setupHelps: true, open: { kind: "app", name: "VoiceOver Utility" } }`.
    - `welcome`:
      - OK `VoiceOver's welcome screen is off`.
      - FAIL `VoiceOver's welcome screen is on`, problem `{ title: "VoiceOver's welcome screen", whatsWrong: "VoiceOver shows a welcome screen when it starts, which would stop voicecap's run.", fix: ["Run npx @icjia/voicecap setup, which turns it off."], setupHelps: true }`.
      - Detection: `readDefault(run, "com.apple.VoiceOverTraining", "doNotShowSplashScreen") === "1"`.
    - `accessibility`:
      - OK `Accessibility: <app> is allowed`.
      - FAIL `Accessibility: <app> isn't allowed`, problem `{ title: "Accessibility for <app>", whatsWrong: "voicecap presses VoiceOver's keys through macOS's Accessibility features, which need your OK for <app>.", fix: ["Open System Settings, then Privacy & Security, then Accessibility.", "Switch on <app>. If it isn't listed, click + and choose it.", "Run <again> again."], setupHelps: true, open: SETTINGS_PAGES.accessibility as settings }`.
    - `fullDiskAccess`:
      - OK `Full Disk Access: <app> is allowed`.
      - FAIL `Full Disk Access: <app> isn't allowed`, problem `{ title: "Full Disk Access for <app>", whatsWrong: "voicecap keeps its VoiceOver settings apart from yours by linking them into a folder macOS protects, and macOS blocks <app> from that folder.", fix: ["Open System Settings, then Privacy & Security, then Full Disk Access.", "Switch on <app>. If it isn't listed, click + and choose it.", "When macOS asks, quit and reopen <app>.", "Run <again> again."], setupHelps: true, open: fullDiskAccess, needsRestart: true }`.
      - Any `canWriteVoiceOverPrefs` failure counts, and its `code` goes into the summary only when it isn't `EPERM`: `Full Disk Access: couldn't write to VoiceOver's settings folder (<code>)`.
    - `systemEvents`:
      - OK `<app> can control System Events`.
      - `denied`: FAIL `<app> isn't allowed to control System Events`, problem `automationDeniedProblem(app, "System Events", again)` (Task 4).
      - `no-answer`: FAIL `No answer from System Events in 60 seconds`, problem `permissionPromptProblem(app, "System Events", again)` (Task 4).
      - `failed`: FAIL `System Events didn't answer: <message>`, problem `{ title: "System Events", whatsWrong: <message>, fix: ["Run <again> again."], setupHelps: false }`.
    - `otherVoicecap`: `otherVoicecapCheck(await otherVoicecap(), lockFile, "VoiceOver", again)` (Task 2).
    - `browser`: `browserCheck(resolveBrowser)` (Task 2).
    - `voiceOverOn`: WARN `VoiceOver is on: voicecap will use it, then turn it back on with your settings` when `voiceOverRunning`. Otherwise it returns OK `VoiceOver is off`, and the preflight prints that line.

    The terminal app is looked up once (the `terminal` runner) and reused by the later runners.
- [ ] **Step 1: Write the failing tests:**
  - Each runner's states, with `fakeCommands` and fake deps, asserting exact summaries, problems, `open` targets, and `needsRestart` on Full Disk Access.
  - Darwin 20 gives the version FAIL, naming `macOS 12 through 26`.
  - The machine lines for the Mac mini sample equal the spec's example lines. Use a fake home `/Users/cschweda` and transcripts `/Users/cschweda/webdev/voicecap-transcripts`.
  - With no terminal app, the Accessibility FAIL says `the app voicecap runs in`.
  - `voiceOverAsset` for Darwin 25 with the cache folder `/Users/cschweda/Library/Caches/guidepup` gives `/Users/cschweda/Library/Caches/guidepup/voiceover/25/0.0.1-VoiceOver4/guidepup-voiceover-preferences-macos-26.dmg`; unsupported Darwin 30 gives `file: null`.
- [ ] **Step 2: Run** `pnpm exec vitest run test/readiness-mac.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** `realMacDeps` reads Guidepup's `package.json` and `manifest.json` with `createRequire` (inside `src/drivers/`), the Darwin major from `os.release()`, and the rest from the Task 4 helpers.
- [ ] **Step 4: Run** it again. Expect PASS.

---

### Task 6: The Mac live test

**Files:**
- Create: `src/drivers/voiceover/live-test.ts`
- Modify:
  - `src/drivers/guidepup/chrome.ts`: `ChromeSession` gains `get pid(): number | undefined`, which returns `this.child.pid`.
  - `src/drivers/guidepup/nvda.ts`: export `GUIDEPUP_EVENTS`.
  - `src/drivers/voiceover/readiness-mac.ts`: `realMacDeps().liveTest` is `macLiveTest`.
- Test: `test/mac-live-test.test.ts` (create), plus one assertion in `test/chrome-session.test.ts` that a launched session's `pid` is a number.

**Interfaces:**
- Consumes: Task 4 (`askVoiceOver`, `voiceOverRunning`, `startVoiceOver`, `raiseProcess`), Task 3 (`serveCheckPage`), and `acquireLockFile`.
- Produces:
  - `VOICECAP_VOICEOVER_SETTINGS = { SCRShouldOutputVOInstructions: false }`.
  - `interface VoiceOverControl { start(settings: Record<string, unknown>): Promise<void>; stop(): Promise<void>; describeFocus(): Promise<string> }`.
    - The real one loads Guidepup's `voiceOver`, and `start` wraps `voiceOver.start({ settings })` in `withoutAddedListeners(GUIDEPUP_EVENTS, …)`.
    - `describeFocus` runs `voiceOver.perform(voiceOver.keyboardCommands.describeItemWithKeyboardFocus, { capture: "initial" })` and returns `voiceOver.lastSpokenPhrase()`.
  - `interface MacLiveDeps { run: RunCommand; app: string; again: string; loadVoiceOver(): Promise<VoiceOverControl>; launchBrowser(signal: AbortSignal): Promise<{ pid: number | undefined; load(url: string, timeoutMs: number): Promise<unknown>; close(): Promise<void> }>; serveCheckPage(): Promise<{ url: string; close(): Promise<void> }>; lock(): Promise<() => Promise<void>>; sleep(ms: number): Promise<void> }`.
  - `macLiveTest(deps: MacLiveDeps, signal?: AbortSignal): Promise<Check[]>` works in order and stops at the first FAIL:
    0. **Prepare.** `wasOn = await voiceOverRunning(run)`, then take the lock. A lock `EnvironmentError` becomes FAIL `Another voicecap is using VoiceOver` with its message.
    1. **`liveControl`.** If `!wasOn`: `startVoiceOver`, then poll `voiceOverRunning` every 250 ms for up to 10 s. Then `askVoiceOver`:
       - `ok`: OK `<app> can control VoiceOver`.
       - `denied`: FAIL `<app> isn't allowed to control VoiceOver`, problem `automationDeniedProblem(app, "VoiceOver", again)` (Task 4).
       - `no-answer`: FAIL `No answer from VoiceOver in 60 seconds`, problem `permissionPromptProblem(app, "VoiceOver", again)` (Task 4).
       - `failed`: FAIL `VoiceOver didn't answer: <message>`.
    2. **`liveStart`.** `(await loadVoiceOver()).start(VOICECAP_VOICEOVER_SETTINGS)`:
       - OK `VoiceOver started with voicecap's settings`.
       - An error gives FAIL `VoiceOver didn't start`, problem `{ title: "Starting VoiceOver", whatsWrong: "Guidepup couldn't start VoiceOver: <message>", fix: ["Run npx @icjia/voicecap setup.", "Run <again> again."], setupHelps: true }`.
    3. **`liveFront`.** Serve the check page, launch the browser, load the page (30 s), then `raiseProcess(run, pid)`:
       - OK `The browser came to the front`.
       - Otherwise FAIL `The browser didn't come to the front`, problem `{ title: "The browser's window", whatsWrong: <message>, fix: ["Don't use the keyboard or mouse during the test.", "Run <again> again."], setupHelps: false }`.
    4. **`liveHear`.** `describeFocus()`:
       - Non-empty: OK `VoiceOver hears the page ("<phrase>")`.
       - Empty: FAIL `VoiceOver started, but voicecap heard nothing from it`, problem `{ title: "VoiceOver's speech", whatsWrong: "VoiceOver started, but voicecap captured no speech from it.", fix: ["Run <again> again.", "If it happens again, run npx @icjia/voicecap setup."], setupHelps: true }`.

    **Finally, always:**
    - stop VoiceOver if step 2 started it, and close the browser and the page server;
    - if `wasOn`, run `startVoiceOver` and wait until it's running;
    - if that fails, add WARN `Couldn't turn VoiceOver back on: press Command-F5` (id `liveRestore`);
    - release the lock.

    An aborted `signal` stops at the next step boundary, cleans up the same way, then throws `InterruptedError`.
- [ ] **Step 1: Write the failing tests** with `fakeCommands` and fake deps:
  - All four OK, in order.
  - `denied` at step 1: one FAIL, and `loadVoiceOver` never called.
  - `no-answer`: the prompt problem's exact text.
  - VoiceOver on beforehand: `startVoiceOver` runs after `stop()`, even when step 2 throws.
  - VoiceOver off beforehand: not restarted, but started for step 1's probe.
  - Restart fails: a `liveRestore` WARN.
  - Ctrl+C during step 3: `InterruptedError`, with VoiceOver stopped, the browser closed, and the lock released.
  - The lock held: a FAIL with the lock's message.
- [ ] **Step 2: Run** `pnpm exec vitest run test/mac-live-test.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** The step order and the 60-second probe before Guidepup's start are the point. Guidepup's own AppleScript calls give up after 10 seconds, which in the spike left a prompt that no click could answer.
- [ ] **Step 4: Run** `pnpm exec vitest run test/mac-live-test.test.ts test/chrome-session.test.ts`. Expect PASS. The chrome-session test is skipped where Playwright's Chromium isn't installed.

---

### Task 7: `doctor` on the readiness module

**Files:**
- Create: `src/readiness/doctor.ts`
- Delete: `src/drivers/guidepup/doctor.ts`, whose pieces went to Tasks 3 and 7.
- Modify: `src/cli/main.ts`, the `doctor` command. Its description becomes `check this computer and print a summary to paste into a bug report`. It loads the platform with `loadPlatformReadiness({ …, again: "npx @icjia/voicecap doctor" })` and calls `runDoctor`.
- Test: `test/doctor.test.ts` (create, in place of the doctor half of `test/setup-doctor.test.ts`). The setup half moves to `test/setup.test.ts`.

**Interfaces:**
- Produces: `runDoctor(options: { platform: PlatformReadiness; logger: Logger; signal?: AbortSignal; now?: () => Date }): Promise<number>`.
  1. Run the preflight.
  2. If ready and `platform.liveTest`: log `liveTestNotice`, then run the live test and append its checks.
  3. Log `renderPreflight({ kind: "doctor", …, offerSetup: true })`, with the checks including the live ones and `ready` recomputed.
  4. Return 0 when ready, 2 otherwise.
  5. On `InterruptedError`: log the warning `Interrupted: the screen reader and the browser were shut down.` and return 130, with no verdict.
- [ ] **Step 1: Write the failing tests** with a fake `PlatformReadiness`:
  - All pass: exit 0, `voicecap doctor, 2026-09-28 11:10`, and `Ready: this computer can run NVDA for voicecap.`
  - A quick-check FAIL: exit 2, the live test isn't run, and the problem block is printed.
  - A live-test FAIL: exit 2.
  - Ctrl+C: 130, with no `Ready`/`Not ready`.
  - The Linux module: exit 2, with the "No screen reader to drive here" block.
- [ ] **Step 2: Run** `pnpm exec vitest run test/doctor.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement, then delete** `src/drivers/guidepup/doctor.ts` and move `test/setup-doctor.test.ts`'s setup cases to `test/setup.test.ts` unchanged.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expect PASS.

---

### Task 8: The guided loop, and `setup` on both platforms

**Files:**
- Create: `src/readiness/guided.ts`, `src/drivers/voiceover/setup-mac.ts`
- Modify:
  - `src/drivers/guidepup/setup.ts`: export `ensureBrowser`. `runSetup` gains a `prompter` option, ends with the preflight and the offer of the live test, and returns an exit code.
  - `src/cli/main.ts`, the `setup` command. Description: `install and check what voicecap needs on this computer`.
    - It creates a prompter when stdin is a terminal, as `init` does.
    - `darwin` runs `runMacSetup`, `win32` runs `runSetup`, and anything else prints the Linux preflight and exits 2.
    - It sets the exit code that's returned.
- Test: `test/readiness-guided.test.ts` (create), `test/setup-mac.test.ts` (create), `test/setup.test.ts`.

**Interfaces:**
- Consumes: `Prompter` (`src/init/prompt.ts`), `openTarget` (Task 4), and Tasks 1 and 2.
- Produces:
  - `guideThrough(platform: PlatformReadiness, deps: { prompter: Prompter | null; say(text: string): void; open(target: NonNullable<Problem["open"]>): Promise<void>; app: string }): Promise<{ result: PreflightResult; restartNeeded: Problem | null }>`:
    1. **Pick the steps.** Run the preflight. The steps are the FAIL checks whose problem has `setupHelps` and either an `open` or the id `systemEvents`, with `needsRestart` ones moved to the end. `n` is their count.
    2. **Walk each step, `i` of `n`:**
       - say `Step i of n: <title>`, then `  <whatsWrong>`;
       - for `open` settings: say `  Opening System Settings at Privacy & Security, <page>…` and `open`. For `open` app: `  Opening <name>…` and `open`;
       - say each fix step that isn't the first "Open …" step or the last "Run … again" step, as `  <step>`;
       - `ask("Press Enter when it's on, or type s to skip")`: `s` skips; anything else re-runs that check's runner;
       - OK: say `  OK: <summary>`;
       - FAIL with `needsRestart`: say `When <app> reopens, run npx @icjia/voicecap setup again to finish.` and stop, returning that problem;
       - other FAIL: say `  Not yet: <summary>` and ask again.

       For `systemEvents`, the step just re-runs the check, which raises the prompt and waits 60 seconds. Its say lines are `  macOS will ask whether <app> can control System Events: click Allow.`
    3. **With `prompter` null:** say `renderProblems(checks, { offerSetup: false })` and return.
    4. **Finish.** Run the preflight again and return its result.
  - `interface MacSetupDeps { run: RunCommand; setupCli: { version: string; bin: string }; guidepup: { dir: string }; runNode(script: string, args: string[], cwd: string): Promise<number>; ensureBrowser(): Promise<{ name: string; path: string }>; platform(): Promise<PlatformReadiness>; open(target: NonNullable<Problem["open"]>): Promise<void> }`. `realMacSetupDeps(options)` builds it the way `realSetupDeps` does in `setup.ts`, with `runCommand`, `openTarget`, and `loadPlatformReadiness({ …, again: "npx @icjia/voicecap setup" })`.
  - `runMacSetup(options: { config; logger; prompter: Prompter | null }, deps = realMacSetupDeps(options)): Promise<number>`:
    1. Log `Installing Guidepup's VoiceOver files, with @guidepup/setup <v>.`, then `runNode(setupCli.bin, ["install", "voiceover"], guidepup.dir)`.
       - A non-zero exit throws `EnvironmentError`: `Installing Guidepup's VoiceOver files failed (the installer exited with code <n>); its messages are above. It downloads from github.com: behind a proxy, set HTTPS_PROXY (and NO_PROXY), then run voicecap setup again.`
    2. Run `ensureBrowser`.
    3. `writeDefault(run, "com.apple.VoiceOverTraining", "doNotShowSplashScreen", true)`, then log `Turned off VoiceOver's welcome screen (to undo: defaults delete com.apple.VoiceOverTraining doNotShowSplashScreen).`
       - Then `writeDefault(run, "com.apple.VoiceOver4/default", "SCREnableAppleScript", true)`, then log `Turned on VoiceOver's own "allow AppleScript" setting (to undo: defaults delete com.apple.VoiceOver4/default SCREnableAppleScript).`
    4. Run `guideThrough`. With `restartNeeded`, return 2.
    5. Log `renderPreflight({ kind: "preflight", offerSetup: false, … })`.
       - If ready, with a prompter and `liveTest`: log the notice, then `confirm("Test VoiceOver now?", false)`. A yes runs the test and logs `renderChecks` of its checks, plus `renderProblems` when one fails.
       - Return 0 when ready and the live test passed or was declined, otherwise 2.
  - `runSetup` (Windows):
    - Today's steps, unchanged, except that the closing `Next, check everything with: npx @icjia/voicecap doctor` becomes the preflight.
    - It then offers `Test NVDA now?` the same way and returns 0 or 2.
- [ ] **Step 1: Write the failing tests:**
  - **Guided loop:**
    - Enter, then the re-check passes: `OK: …`;
    - `s` skips;
    - still failing, then asked again, then OK;
    - Full Disk Access re-checked and still failing: `When Visual Studio Code reopens, run npx @icjia/voicecap setup again to finish.` and `restartNeeded` set, with no further questions;
    - the settings `open` target is passed through;
    - no prompter: the problem list, with no questions.
  - **Mac setup:**
    - the installer called with `["install", "voiceover"]` in Guidepup's folder;
    - installer failure: the exact message;
    - both `defaults write` calls with their exact arguments, and both "to undo" lines;
    - the live test offered only when ready and there's a prompter;
    - returns 2 with `restartNeeded`.
  - **Windows setup:** today's cases pass. It ends with the preflight, and offers the live test only when ready and interactive.
- [ ] **Step 2: Run** `pnpm exec vitest run test/readiness-guided.test.ts test/setup-mac.test.ts test/setup.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** those tests again. Expect PASS.

---

### Task 9: `init` starts with the preflight

**Files:**
- Modify:
  - `src/cli/main.ts`: the `init` action. `CliContext.readiness?` is replaced by `platformReadiness?: () => Promise<PlatformReadiness>`, for tests.
  - `src/init/wizard.ts`: `Readiness` moves here as `{ canRun: true; screenReader: string } | { canRun: false; reason: string }`. Its line becomes `<screenReader> will speak and take over the keyboard until the run ends.`
- Delete: `src/init/readiness.ts`
- Test: `test/init-wizard.test.ts` (drop the `checkReadiness` cases; `readiness: () => ({ canRun: true, screenReader: "NVDA" })`), `test/cli.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2 and 7's patterns.
- Produces the `init` flow:
  1. Build the prompter.
  2. Load the platform with `again: "npx @icjia/voicecap init"`.
  3. Write `renderPreflight({ kind: "preflight", offerSetup: true, … })`.
  4. Not ready: exit 2, with no wizard questions.
  5. With a live test: say each notice line, then `confirm("Test <screenReader> now?", false)`. A yes runs it and writes `renderChecks`. Any FAIL writes `renderProblems` and exits 2.
  6. Run the wizard. Its `readiness` is `platform.cannotRunYet === null ? { canRun: true, screenReader } : { canRun: false, reason: cannotRunYet }`.
  7. An `InterruptedError` from the live test exits 130.
- [ ] **Step 1: Write the failing tests** (`test/cli.test.ts`, with `platformReadiness` fakes):
  - Not ready: exit 2, stdout contains `Not ready: 1 problem.`, and it never asks `Website:`.
  - Ready, with the live test declined: the wizard runs as today.
  - The live test accepted and failing: exit 2 with its problem.
  - A fake with `cannotRunYet` set: `Your command:`, then the reason, and no `Run it now?`.
  - Ready NVDA: `NVDA will speak and take over the keyboard until the run ends.`
  - Every existing `init` test gets a ready fake.
- [ ] **Step 2: Run** `pnpm exec vitest run test/cli.test.ts test/init-wizard.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`. Expect PASS.

---

### Task 10: Quick checks before real runs

**Files:**
- Modify: `src/run/audit.ts`. `RunAuditOptions` gains `readiness?: () => Promise<PlatformReadiness>` and `platform?: NodeJS.Platform` (both for tests). The check goes after `settings` is built and before `createDriver`.
- Test: `test/run.test.ts`

**Interfaces:**
- **The rule.** The checks run when `selection.name !== "replay"` and either `options.readiness` is given, or `!options.driver && selection.name === "guidepup" && (options.platform ?? process.platform) === "win32"`. The platform module is `options.readiness` when given, else `loadPlatformReadiness({ platform, config, logger, env, cwd, again: "the same command" })`. The Mac is added in sub-project 2 with its driver.
- **Not ready:** `throw new EnvironmentError(renderProblems(result.checks, { offerSetup: true }))`, before `resolveHome`, the site folder, or the lock.
- **Ready:** `logger.info(renderRunSummary(result))`.
- [ ] **Step 1: Write the failing tests:**
  - With a scripted driver and `readiness` giving a FAIL: it rejects with an `EnvironmentError` (exit code 2) whose message starts `Not ready: 1 problem.`, and the transcripts home has no site folder.
  - With a passing `readiness` that has one WARN: the log has `Checks passed: NVDA 2026.2 on Windows 11 Pro 24H2` and the WARN line, then the run completes.
  - With `replayFrom` and `readiness` given: `readiness` isn't called.
  - With `driver` given and no `readiness`: no checks.
- [ ] **Step 2: Run** `pnpm exec vitest run test/run.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it again. Expect PASS.

---

### Task 11: Restoring the person's own NVDA

**Files:**
- Modify:
  - `src/drivers/guidepup-nvda.ts`: `GuidepupDriverDeps` gains `ownNvda(): Promise<string[]>` and `restartNvda(exe: string): void`, wired in `createGuidepupNvdaDriver`.
  - `src/drivers/guidepup/windows.ts`: `restartNvda(exe)` is `spawn(exe, [], { detached: true, stdio: "ignore" }).unref()`, and `ownNvdaPaths(install)` uses `nvdaProcesses`, excluding Guidepup's `nvda.exe` and null paths.
  - `test/helpers/fake-desktop.ts`.
- Test: `test/guidepup-driver.test.ts`

**Interfaces:**
- **Start.** In `startUp`, before Guidepup starts NVDA: `this.ownNvdaExes = await this.deps.ownNvda()`.
- **After shutdown.** At the end of `shutDown`, after NVDA and the browsers are down: for each noted path, `restartNvda(exe)` and log `Turned your NVDA back on (<exe>).`
  - A throw logs the warning `Couldn't turn your NVDA back on (<message>). Start it the way you usually do.`
  - The list is cleared, so a second `stop()` doesn't start it again.
- **On `abandon()`** (the process is exiting): the same, synchronously.
- [ ] **Step 1: Write the failing tests** with the fake desktop:
  - The person's NVDA running: `restartNvda` is called with its path once, after NVDA's stop, even with `stop()` called twice.
  - The same after `abandon()`.
  - None running: never called.
  - `restartNvda` throwing: the warning.
- [ ] **Step 2: Run** `pnpm exec vitest run test/guidepup-driver.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`. Expect PASS.

---

### Task 12: Documentation, and checking the System Settings addresses

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `docs/phase-c-handoff.md`

- [ ] **Step 1: README.**
  - **"Setting it up" gains "On a Mac":**
    - `npx @icjia/voicecap setup`, and what it installs and changes;
    - each permission (Accessibility, Automation for System Events and VoiceOver, Full Disk Access, VoiceOver Utility's AppleScript checkbox), with why it's needed;
    - why the terminal app matters, since permissions belong to the app voicecap runs in;
    - that VoiceOver runs arrive with the VoiceOver driver.
  - **Document** the preflight at the start of `init`, `doctor` on both platforms, the live test, restoring the person's own screen reader, and the checks before NVDA runs.
  - **Exit codes** are unchanged.
  - **Wording:** no "doesn't replace testing".
- [ ] **Step 2: CHANGELOG, "Unreleased".**
  - **Added:** the preflight, `doctor` and `setup` on macOS, restoring the person's screen reader, and the checks before NVDA runs.
  - **Changed:** `init` starts with the preflight, and `doctor`'s output shows machine info and plain-language fixes.
- [ ] **Step 3: The handoff.** `docs/phase-c-handoff.md`: under Status, add "Readiness (sub-project 1): designed (`docs/superpowers/specs/2026-09-28-readiness-design.md`) and built."
- [ ] **Step 4: Check the addresses with the owner.** Opening them opens System Settings on the owner's Mac, so ask first. With their OK, `open` each `SETTINGS_PAGES` address and confirm it lands on its page on macOS 26. If one doesn't, keep the address (it still opens Privacy & Security) and make sure the step's text names the page.
- [ ] **Step 5: Run** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Expect all clean.
