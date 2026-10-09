/**
 * The Guidepup NVDA driver: real NVDA through @guidepup/guidepup (pinned exactly), with Google
 * Chrome driven through Playwright as a library. Windows only.
 *
 * What the driver guarantees, beyond passing keys to NVDA (checked against real NVDA 2026.2):
 *
 * - Keystrokes go to the browser, and another window's speech never ends up in a transcript. Keys
 *   sent through NVDA go to whichever window is in front, so every load confirms the window with
 *   NVDA+T (report title) against a unique marker title, and every step checks that the page has
 *   focus before and after its keystroke. A step during which another window came forward is
 *   discarded as a ForegroundError. The check before a step can't close every gap: Guidepup
 *   silences NVDA (at least 250 ms) before sending the key, so a window that comes forward just
 *   then gets that one keystroke, and the step is discarded.
 * - Each load gets a fresh browser with a new profile, so no page's transcript depends on which
 *   pages came before (visited links, cookies, storage).
 * - The tab pass starts at the first focusable element: the first Tab after a load goes to the
 *   browser directly. Sent through NVDA in browse mode, it would move to the first focusable
 *   element after NVDA's cursor, which Ctrl+Home puts on the first line, skipping a skip link.
 * - NVDA is stopped exactly once, by voicecap: Guidepup's own signal handlers are detached (see
 *   guidepup/nvda.ts), and a Guidepup stop that hangs falls back to shutting NVDA down directly.
 * - stop() can come at any moment: the core stops the driver when it gives up on a call (a timeout,
 *   or Ctrl+C) without waiting for the call to finish. A start or browser launch still under way
 *   gets a moment to finish, and every browser launched is closed. NVDA is shut down before the
 *   browsers (directly, if a command is under way), so a command already handed to Guidepup can't
 *   send its key to the window that comes forward, and a call that was under way stops before its
 *   next command, so it can't type into the page of a restarted driver.
 * - The person's own NVDA, which Guidepup's NVDA shuts down as it starts, is started again from
 *   where it ran once NVDA and the browsers are down: at the final stop() (a mid-run restart keeps
 *   it off), or as the process exits.
 * - What it does to NVDA, the browsers, the person's own NVDA, and the NVDA lock goes to the run's
 *   event log (setEventRecorder) as it's done, in the order it's done, and only once it's done: a
 *   browser that wouldn't close isn't recorded as closed. An event recorded after the fact is
 *   stamped with when it happened: NVDA's start with when it finished, before the lookup of its
 *   process id, and the person's own NVDA's shutdown with when the start began. The exit hook
 *   (abandon) records nothing.
 * - When another window has the foreground, it looks up which program has it as the loss is found:
 *   once for a step, and after each try that fails when it brings the browser forward. The log gets
 *   the program and the window's title (foreground-lost), once for the loss that fails a step or a
 *   page, and the ForegroundError names the program only: a title can hold private text. Not knowing
 *   the program (the lookup fails, Windows doesn't say, or the foreground has come back to the
 *   page's own browser, which took it from no one) changes nothing else about the failure.
 * - Windows Search and the Start menu sometimes come in front of the browser by themselves, and keep
 *   it from coming forward. Where it brings the browser forward, when it finds one of those two
 *   (closedProgram) in front, it presses Escape once to close it, through NVDA, to the window in
 *   front, records that it did (foreground-escape: the key sent, not that the program closed), and
 *   tries again within its tries. It presses Escape only after finding one of those two in front,
 *   and a step that loses the foreground still fails.
 * - Each HTML page's screenshot is taken through the browser's DevTools connection once the page
 *   has loaded, before the browser is brought to the front and before any key, so it shows the page
 *   as the screen reader finds it, and taking it doesn't move the window. One that can't be taken
 *   is returned as the reason, and never fails the page.
 * - A page is checked with axe-core only when the core asks (checkWithAxe), through the browser's
 *   DevTools connection, in an isolated world of axe's own on the page's main frame: axe-core's own
 *   script runs there, so nothing is added to the page's own world, and a world apart keeps the
 *   page's scripts from changing the built-ins axe uses, or its name. A page can still hold up the
 *   thread axe shares with it, or answer axe's messages to its frames from a frame of its own
 *   origin. The check presses no key and leaves the window as it is. One that fails is returned as
 *   the first line of its reason. So is one that takes over 20 seconds, which can't be stopped, and
 *   says it's still under way in the page (leftRunning): the core opens the page again, and that
 *   load's fresh browser closes this one, ending the check with it. Neither fails the page.
 * - NVDA's own log is turned on at the input/output level, through Guidepup's settings (a
 *   general.loggingLevel the config sets itself wins). Each time voicecap's NVDA has quit, the driver
 *   reads that log, cleans it (./guidepup/nvda-log.ts), and hands the copy to the run's recorder,
 *   before anything starts NVDA again: NVDA moves the last log aside to nvda-old.log whenever it
 *   starts, as the person's own NVDA does when the final stop starts it again. It reads nothing
 *   for a recorder that keeps no copies, and a log it can't have (none, one it can't read, or one
 *   older than the NVDA session, an earlier NVDA's) is recorded as no copy, with why, and the
 *   console is told, once for a driver: it never stops a stop.
 */
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import { AXE_LIMIT_MS, axeErrorReason, axeScript, keptAxeResults } from "../axe/results.js";
import type { VoicecapConfig } from "../config/schema.js";
import { isHtmlContentType } from "../pages/url.js";
import { redactHome } from "../run/failure.js";
import { EnvironmentError, errorMessage } from "../util/errors.js";
import { closedProgram } from "../util/foreground.js";
import { acquireLockFile, isStale, readLockHolder } from "../util/lock-file.js";
import type { Logger } from "../util/log.js";
import { formatDuration } from "../util/time.js";
import { launchChrome, LimitReachedError, withinLimit } from "./guidepup/chrome.js";
import { loadGuidepupNvda } from "./guidepup/nvda.js";
import { beganWithSession, cleanNvdaLog, withNvdaLog } from "./guidepup/nvda-log.js";
import {
  guidepupInstall,
  nvdaLockFile,
  nvdaVersionFromBuild,
  readGuidepupPackage,
  unsafePathMessage,
  type GuidepupInstall,
} from "./guidepup/paths.js";
import {
  cleanupOrphans,
  foregroundWindow,
  listProcesses,
  keepAwake,
  nvdaLanguage,
  nvdaProcesses,
  ownNvdaPaths,
  readNvdaLog,
  restartNvda,
  restartNvdaDetached,
  sessionLocked,
  startedNvda,
  titleMatches,
  windowsSystemInfo,
  type ForegroundWindow,
} from "./guidepup/windows.js";
import {
  ForegroundError,
  NO_EVENTS,
  type AxeCapture,
  type CaptureMode,
  type EnvironmentInfo,
  type EventRecorder,
  type FocusedElement,
  type PageInfo,
  type PageScreenshot,
  type ScreenReaderDriver,
  type Speech,
} from "./types.js";

/** Keys the driver presses through NVDA. */
export type NvdaKey =
  | "reportTitle" // NVDA+T
  | "exitFocusMode" // Escape
  | "nextLine" // Down Arrow
  | "nextHeading" // H
  | "tab" // Tab
  | "toTop" // Ctrl+Home
  | "toBottom"; // Ctrl+End

/** The part of NVDA (through Guidepup) the driver uses. */
export interface NvdaControl {
  /** Guidepup's NVDA build id, e.g. "0.2.1-2026.2". */
  readonly build: string;
  start(options: { capture: CaptureMode; settings: Record<string, unknown> }): Promise<void>;
  stop(): Promise<void>;
  /** Shut NVDA down directly (synchronously), for when Guidepup's stop hangs or the process exits. */
  forceQuit(): void;
  /** Press a key through NVDA; returns everything NVDA said in response ("" with capture: false). */
  press(key: NvdaKey, options?: { capture?: boolean }): Promise<Speech>;
  /** Run an action that isn't an NVDA command and return what NVDA said in response. */
  speechDuring(action: () => Promise<void>): Promise<Speech>;
  /** NVDA's settings, by section, from the running session's configuration. */
  settings(): Record<string, unknown>;
  /** Whether NVDA is running (it accepts connections), whatever Guidepup believes. */
  isRunning(): Promise<boolean>;
}

export interface FocusState {
  focused: boolean;
  losses: number;
}

export interface LoadResult {
  finalUrl: string;
  status: number | null;
  contentType: string | null;
}

/**
 * One browser, with a fresh profile, showing one page. A call that finds the browser gone (its
 * window closed, or it or the page crashed) fails with an EnvironmentError coded "browser".
 */
export interface BrowserSession {
  readonly name: string;
  readonly version: string;
  /** The browser's process id, which the event log keeps; absent when there is none to give. */
  readonly pid?: number;
  /** Load a URL, following redirects, within the time limit (0: no limit). */
  load(url: string, timeoutMs: number): Promise<LoadResult>;
  waitUntilReady(readiness: VoicecapConfig["readiness"]): Promise<void>;
  pageTitle(): Promise<string>;
  /**
   * The address the page's first `<link rel="canonical">` tag gives, as the browser resolved it
   * (absolute), or null when the page has no such tag or the tag has no address.
   */
  pageCanonical(): Promise<string | null>;
  /**
   * What shows in the window now, as a JPEG at half the page's CSS size. It goes through the
   * browser's DevTools connection, so it never brings the window forward, and it fails when the
   * browser hasn't answered within five seconds.
   */
  screenshot(): Promise<Uint8Array>;
  /**
   * axe-core's results for the page as it is now, as axe gives them. `script`, axe-core's own, runs
   * through the browser's DevTools connection in an isolated world of its own on the page's main
   * frame, so nothing is added to the page's own world, and the page's scripts can't reach it. It
   * never brings the window forward or presses a key, and it has no time limit of its own.
   */
  runAxe(script: string): Promise<unknown>;
  /** Set the page's title (the window title follows it); returns a function that restores it. */
  setTitle(title: string): Promise<() => Promise<void>>;
  /**
   * Whether the page has keyboard focus, and how many times its window has lost focus since the
   * page loaded (counted from the window's blur events, so a loss is noticed even if focus came
   * back). Chrome reports focus for a window it opened even while another window is in front,
   * until its window has really been in front once.
   */
  focusState(): Promise<FocusState>;
  /** Ask Windows to bring the browser window to the front, without keystrokes. */
  raise(): Promise<void>;
  /** Press Tab in the page directly, not through NVDA. */
  pressTab(): Promise<void>;
  focusedElement(): Promise<FocusedElement | null>;
  close(): Promise<void>;
  /** Kill the browser at once (synchronously), for when the process is exiting. */
  abandon(): void;
}

export interface SystemInfo {
  os: string;
  /** The Windows display language, e.g. "en-US". */
  uiLocale: string | null;
  guidepupVersion: string;
}

export interface GuidepupDriverDeps {
  platform: NodeJS.Platform;
  /** Loads Guidepup; called when the driver starts. */
  loadNvda: () => Promise<NvdaControl>;
  install: GuidepupInstall;
  installed: () => boolean;
  /** Launch a browser; aborting the signal kills one that's still starting. */
  launchBrowser: (signal: AbortSignal) => Promise<BrowserSession>;
  /** Process ids of running NVDA copies (any NVDA, not just Guidepup's). */
  runningNvda: () => Promise<number[]>;
  /**
   * The process id of the NVDA voicecap started (Guidepup's), for the event log; null when it
   * can't be found. Asked once that NVDA has started. A lookup that fails counts as null.
   */
  screenReaderPid: () => Promise<number | null>;
  /**
   * Where the person's own running NVDA was started from (not Guidepup's NVDA), each path once.
   * Throws when Windows can't tell.
   */
  ownNvda: () => Promise<string[]>;
  /** Start the person's own NVDA again from its path; resolves once Windows has started it. */
  restartNvda: (exe: string) => Promise<void>;
  /**
   * The same without waiting (synchronously), for when the process is exiting: the start happens
   * once Guidepup's NVDA has quit.
   */
  restartNvdaDetached: (exe: string) => void;
  /**
   * NVDA's own log as NVDA left it (the decoded text of nvda.log in the temp folder), or null when
   * there is no such file. Rejects when it can't be read (another program has it locked, say). Asked
   * once each time voicecap's NVDA has quit, and only for a recorder that keeps copies of it.
   */
  readNvdaLog: () => Promise<string | null>;
  /**
   * The account's home folder, which a copy of NVDA's log writes as %USERPROFILE%, and so does the
   * reason a log couldn't be had, which is kept with the run.
   */
  home: string;
  /** The machine-wide lock: only one voicecap drives NVDA at a time. */
  lockFile: string;
  system: () => SystemInfo;
  /** Close browsers and delete profiles that an earlier run left behind; describe what was done. */
  cleanupOrphans: () => Promise<string[]>;
  /** Whether Windows is locked (null when it doesn't say). */
  sessionLocked: () => Promise<boolean | null>;
  /**
   * The window in front, by its process, program, and title; null when Windows doesn't say. The
   * log keeps the program and the title, and the process tells the page's own browser's window from
   * another's. Asked once each time another window is found to have the foreground, and a lookup
   * that fails counts as null. It must answer in good time: the step that lost the foreground waits.
   */
  foregroundWindow: () => Promise<ForegroundWindow | null>;
  /** Keep Windows from sleeping or turning the screen off (and locking because of either). */
  keepAwake: () => { release(): void };
  /** Wait; an abort ends the wait early (it may reject). */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** A short random token for the window-title check. */
  marker: () => string;
  /**
   * The time now: when NVDA's start began and finished, which the event log stamps the events of
   * the start with, since they're recorded only after it (see startUp).
   */
  now: () => Date;
}

/** The driver with the real Guidepup, browser, and Windows behind it. Nothing starts until start(). */
export function createGuidepupNvdaDriver(
  options: { config: VoicecapConfig; logger: Logger },
  platform: NodeJS.Platform = process.platform,
): GuidepupNvdaDriver {
  const guidepup = readGuidepupPackage();
  const install = guidepupInstall(guidepup.nvdaBuild, process.env, os.homedir());
  let system: SystemInfo | null = null;
  const driver = new GuidepupNvdaDriver(options, {
    platform,
    loadNvda: () => loadGuidepupNvda(install),
    install,
    installed: () => existsSync(install.nvdaExe),
    launchBrowser: (signal) =>
      launchChrome({
        browser: options.config.browser,
        env: process.env,
        signal,
        onRelaunch: (notice) => driver.relaunched(notice),
      }),
    runningNvda: () => listProcesses("nvda.exe"),
    screenReaderPid: async () => startedNvda(await nvdaProcesses(), install.nvdaExe),
    ownNvda: () => ownNvdaPaths(install),
    restartNvda,
    restartNvdaDetached: (exe) => restartNvdaDetached(exe, install.nvdaExe),
    readNvdaLog: () => readNvdaLog(os.tmpdir()),
    home: os.homedir(),
    lockFile: nvdaLockFile(process.env, os.homedir()),
    system: () => (system ??= { ...windowsSystemInfo(), guidepupVersion: guidepup.version }),
    cleanupOrphans: () => cleanupOrphans(os.tmpdir(), install.nvdaExe),
    sessionLocked,
    foregroundWindow,
    keepAwake,
    sleep: (ms, signal) => delay(ms, undefined, { signal }),
    marker: randomMarker,
    now: () => new Date(),
  });
  return driver;
}

/** Six random letters: NVDA reads letters back exactly, whatever its symbol and number settings. */
function randomMarker(): string {
  return Array.from({ length: 6 }, () => String.fromCharCode(97 + randomInt(26))).join("");
}

/** Tries at raising the browser window before giving up on a page. */
const RAISE_ATTEMPTS = 3;
/** How long Guidepup gets to stop NVDA before voicecap shuts it down directly. */
const STOP_TIMEOUT_MS = 15_000;
/** Time for the window title to follow a new page title before NVDA+T. */
const TITLE_SETTLE_MS = 150;
/** Time for Windows to close a program Escape was sent to, before the browser is raised again. */
const CLOSE_SETTLE_MS = 300;
/** Settings sections always recorded (empty when all their values are NVDA's defaults). */
const SETTINGS_SECTIONS = ["speech", "documentFormatting", "virtualBuffers", "keyboard"];
/** Further sections that affect speech, recorded when present. */
const OPTIONAL_SETTINGS_SECTIONS = ["presentation", "general"];

export class GuidepupNvdaDriver implements ScreenReaderDriver {
  readonly name = "guidepup";

  private nvda: NvdaControl | null = null;
  private nvdaState: "stopped" | "starting" | "running" | "stopping" = "stopped";
  /** The generation of the start that started NVDA. */
  private nvdaOwner = -1;
  /** Bumped by stop(): a call that began before then is stale and must stop where it is. */
  private generation = 0;
  /** Called off by stop(): browser launches under way. */
  private launches = new AbortController();
  /** A start and browser launches under way; stop() gives them a moment to finish. */
  private readonly pending = new Set<Promise<void>>();
  /** Every browser launched and not yet closed, with its close once that has begun. */
  private readonly browsers = new Map<BrowserSession, Promise<void> | null>();
  private stopping: Promise<void> | null = null;
  /** Whether the stop under way is the final one, not a mid-run restart's: it gives back NVDA. */
  private finalStop = false;
  /** Guidepup stops that outlived their time and haven't finished yet. */
  private readonly unfinishedStops = new Set<Promise<void>>();
  private releaseLock: (() => Promise<void>) | null = null;
  /** Windows kept awake while the driver runs. */
  private awake: { release(): void } | null = null;
  /** Where the person's own NVDA ran from before Guidepup's NVDA shut it down: to start again. */
  private ownNvdaExes: string[] = [];
  /** Where the run's event log is, once a run gives the driver it. */
  private events: EventRecorder = NO_EVENTS;
  /** The process id of the NVDA voicecap started, for the event that says it stopped. */
  private nvdaPid: number | null = null;
  /**
   * When voicecap last began to start its NVDA: a log it keeps a copy of must have begun since (see
   * cleanedNvdaLog).
   */
  private nvdaBegan: Date | null = null;
  /**
   * Whether the console has been told that a copy of NVDA's log wasn't kept: it's told once for a
   * driver, the first time, whichever copy it was and whatever the reason.
   */
  private noCopyWarned = false;
  private session: BrowserSession | null = null;
  /** Whether the current session has loaded a page (the next load gets a fresh browser). */
  private sessionUsed = false;
  /** The address of the page loaded last, after redirects: what axe's results are of. */
  private pageUrl = "";
  private settings: Record<string, unknown> = {};
  private browser: { name: string; version: string } | null = null;
  private firstTab = true;
  private inDocument = true;
  private exitHooked = false;
  /** NVDA commands sent and not yet finished. */
  private commandsUnderWay = 0;
  private readonly onExit = () => this.abandon();

  constructor(
    private readonly options: { config: VoicecapConfig; logger: Logger },
    private readonly deps: GuidepupDriverDeps,
  ) {}

  setEventRecorder(recorder: EventRecorder): void {
    this.events = recorder;
  }

  /**
   * The browser handed over to a new copy of itself as it started, and voicecap is starting it
   * again (launchChrome's onRelaunch calls this): warned of on the console, and recorded.
   */
  relaunched(notice: string): void {
    this.options.logger.warn(notice);
    this.events.record({ type: "browser-handed-over" });
  }

  async start(): Promise<void> {
    const { install } = this.deps;
    if (this.deps.platform !== "win32") {
      throw new EnvironmentError(
        "The guidepup driver runs NVDA, which only runs on Windows. On macOS and Linux, use the replay driver: --replay-from <run folder>.",
      );
    }
    if (!this.deps.installed()) {
      throw new EnvironmentError(
        `NVDA for voicecap (Guidepup's NVDA build ${install.build}) isn't installed; it belongs at ${install.nvdaExe}. Install it with: npx @icjia/voicecap setup`,
      );
    }
    const unsafePath = unsafePathMessage(install);
    if (unsafePath) throw new EnvironmentError(unsafePath);
    await this.track(this.startUp(this.generation));
  }

  /**
   * Take the lock (unless cleanupStale() has), note the person's own NVDA, start NVDA, and launch
   * the first browser. If the start fails, or stop() overtakes it, it shuts down the NVDA and
   * browser it started itself; the lock is stop()'s to release, and the person's NVDA the final
   * stop()'s to start again (Guidepup's NVDA may have shut it down before failing).
   */
  private async startUp(generation: number): Promise<void> {
    const { install } = this.deps;
    let session: BrowserSession | null = null;
    try {
      await this.holdLock();
      this.checkLive(generation);
      this.awake ??= this.deps.keepAwake();
      const running = await this.deps.runningNvda();
      this.checkLive(generation);
      // Asked once: after a mid-run restart the person's NVDA is still off, and asking again would
      // forget it.
      const ownNvdaExes =
        this.ownNvdaExes.length > 0 ? this.ownNvdaExes : await this.ownNvdaRunning();
      this.checkLive(generation);
      if (running.length > 0) {
        const afterwards =
          ownNvdaExes.length > 0
            ? "voicecap will turn your NVDA back on when it has finished."
            : "Start your NVDA again when voicecap has finished.";
        this.options.logger.alert(
          `NVDA is running (process ${running.join(", ")}). voicecap shuts it down now and starts its own copy (Guidepup's NVDA ${install.build}). ${afterwards}`,
        );
      }
      const nvda = await this.deps.loadNvda();
      this.checkLive(generation);
      // Noted only now: Guidepup's start begins by quitting whichever NVDA is running. A start that
      // failed or was stopped before this point left the person's NVDA running, and starting it
      // again would restart it.
      this.ownNvdaExes = ownNvdaExes;
      this.syncExitHook();
      const { began, finished } = await this.startNvda(nvda, generation);
      // Recorded before the check for a stop: NVDA has started, and a stop that came meanwhile shuts
      // it down next, which the log shows as the stop of that start. Each is stamped when it
      // happened, not when it's recorded: the computer's own NVDA closed as the start began (it's
      // the first thing Guidepup's start does), and voicecap's NVDA was running once the start
      // finished, before the lookup of its process id, a start of PowerShell that takes a second or
      // more.
      if (running.length > 0) {
        this.events.record({ type: "own-screen-reader-closed", pids: [...running] }, began);
      }
      this.nvdaPid = await this.startedNvdaPid();
      this.events.record({ type: "screen-reader-started", pid: this.nvdaPid }, finished);
      this.checkLive(generation);
      const settings = nvda.settings();
      // Launching the browser now checks that it works before any page is tried.
      session = await this.launchBrowser();
      this.checkLive(generation);
      this.settings = settings;
      this.session = session;
      this.sessionUsed = false;
      this.browser ??= { name: session.name, version: session.version };
    } catch (error) {
      // Only the NVDA this start started: stop() may have been followed by another start.
      if (this.nvdaOwner === generation) await this.shutDownNvda();
      if (session) await this.closeBrowser(session);
      throw error;
    }
  }

  /**
   * Take the machine's NVDA lock, unless this driver holds it already. Only taking it is recorded:
   * a call that finds the lock held changes nothing.
   */
  private async holdLock(): Promise<void> {
    if (this.releaseLock) return;
    const file = this.deps.lockFile;
    this.releaseLock = await acquireLockFile(file, {
      held: (holder) =>
        `Another voicecap (process ${holder.pid}, started ${holder.startedAt}) is using NVDA on this computer, and only one can at a time. Wait for it to finish, or stop it first. If no other voicecap is running, delete its lock: ${file}`,
      otherHost: (holder) =>
        `The NVDA lock ${file} was taken on another computer (${holder.host}). If no voicecap is running here, delete it.`,
    });
    this.events.record({ type: "screen-reader-lock-taken" });
  }

  /** Start NVDA, and say when the start began and when it finished, for the event log. */
  private async startNvda(
    nvda: NvdaControl,
    generation: number,
  ): Promise<{ began: Date; finished: Date }> {
    this.nvda = nvda;
    this.nvdaOwner = generation;
    this.setNvdaState("starting");
    const began = this.deps.now();
    this.nvdaBegan = began;
    try {
      await nvda.start({
        capture: this.options.config.capture,
        settings: withNvdaLog(this.options.config.nvdaSettings),
      });
    } catch (error) {
      this.setNvdaState("stopped");
      throw new EnvironmentError(`NVDA didn't start: ${describeError(error)}`, {
        cause: error,
        failure: "screen-reader-stopped",
      });
    }
    const finished = this.deps.now();
    this.setNvdaState("running");
    return { began, finished };
  }

  stop(options: { restarting?: boolean } = {}): Promise<void> {
    // A final stop gives the person's NVDA back, even when it joins a restart's stop under way.
    if (options.restarting !== true) this.finalStop = true;
    this.stopping ??= this.shutDown().finally(() => {
      this.stopping = null;
      this.finalStop = false;
    });
    return this.stopping;
  }

  private async shutDown(): Promise<void> {
    this.generation++;
    this.session = null;
    // Browsers still starting are killed. A start still under way (the core stopped waiting for
    // it) gets a moment to finish, so the NVDA it started is shut down now, not left running.
    this.callOffLaunches();
    if (
      this.pending.size > 0 &&
      !(await this.settlesWithin(Promise.all(this.pending), STOP_TIMEOUT_MS)) &&
      this.nvdaState === "starting"
    ) {
      this.options.logger.warn("NVDA is still starting; shutting it down directly.");
      this.nvda?.forceQuit();
    }
    // NVDA before the browsers: a command still waiting for NVDA to fall silent sends its key once
    // the page goes quiet, and with the page's browser closed, the key would go to another window.
    await this.shutDownNvda();
    await Promise.all([...this.browsers.keys()].map((session) => this.closeBrowser(session)));
    // A mid-run restart keeps the person's NVDA noted, and off, until the final stop, which starts
    // it again before letting go of the NVDA lock, so that no other voicecap's NVDA is starting
    // meanwhile. That holds only while this driver has the lock: a restart whose start couldn't
    // take it back has none, and a restore put off until the process exits (see
    // giveBackOwnNvda) comes after the lock below is released.
    if (this.finalStop) await this.giveBackOwnNvda();
    this.letSleep();
    const release = this.releaseLock;
    this.releaseLock = null;
    if (release) {
      await release();
      this.events.record({ type: "screen-reader-lock-released" });
    }
  }

  /**
   * Shut NVDA and every browser down synchronously, then start the person's own NVDA again: the
   * process is exiting.
   */
  abandon(): void {
    this.generation++;
    this.session = null;
    this.callOffLaunches();
    if (this.nvda && this.nvdaState !== "stopped") {
      this.nvda.forceQuit();
      this.setNvdaState("stopped");
    }
    for (const session of this.browsers.keys()) session.abandon();
    this.browsers.clear();
    this.restartOwnNvdaDetached();
    this.letSleep();
    this.syncExitHook();
  }

  /**
   * Where the person's own NVDA is running from. None when Windows can't tell: the checks before
   * the run have said so already, and not knowing mustn't stop a run.
   */
  private async ownNvdaRunning(): Promise<string[]> {
    try {
      return await this.deps.ownNvda();
    } catch {
      return [];
    }
  }

  /**
   * The process id of the NVDA that has just started. Null when it can't be found: it's kept for
   * the event log, and not knowing it mustn't stop a run.
   */
  private async startedNvdaPid(): Promise<number | null> {
    try {
      return await this.deps.screenReaderPid();
    } catch {
      return null;
    }
  }

  /**
   * The final stop's restore, once nothing of Guidepup's can shut the person's NVDA down again:
   * Guidepup's start keeps waiting for its NVDA after a direct shutdown (then starts it again, or
   * quits whichever NVDA is running when it gives up), and its stop ends with that quit. Until
   * then the note stays, and so does the exit hook: abandon() shuts NVDA down, then starts theirs.
   * The NVDA lock isn't kept for that: shutDown() releases it straight after this returns.
   */
  private async giveBackOwnNvda(): Promise<void> {
    if (this.ownNvdaExes.length === 0) return;
    const guidepupBusy =
      this.pending.size > 0 || this.nvdaState !== "stopped" || this.unfinishedStops.size > 0;
    if (guidepupBusy) {
      this.options.logger.warn("Your NVDA will be turned back on when voicecap exits.");
      return;
    }
    await this.restartOwnNvda();
  }

  /**
   * Start the person's own NVDA again from each noted path, once, and say so once Windows has. A
   * path stays noted until its start has been tried: the PowerShell starting it ends with
   * voicecap, so if the process exits meanwhile, abandon() starts it too.
   */
  private async restartOwnNvda(): Promise<void> {
    for (const exe of [...this.ownNvdaExes]) {
      if (!this.ownNvdaExes.includes(exe)) continue; // abandon() has started it meanwhile
      let ok = false;
      try {
        await this.deps.restartNvda(exe);
        ok = true;
        this.options.logger.info(`Turned your NVDA back on (${exe}).`);
      } catch (error) {
        this.warnNotRestarted(error);
      }
      this.events.record({ type: "own-screen-reader-restarted", ok });
      this.ownNvdaExes = this.ownNvdaExes.filter((noted) => noted !== exe);
      this.syncExitHook();
    }
  }

  /**
   * restartOwnNvda() without waiting: the process is exiting. Nothing confirms the start, so
   * nothing says NVDA is back on.
   */
  private restartOwnNvdaDetached(): void {
    const exes = this.ownNvdaExes;
    this.ownNvdaExes = [];
    for (const exe of exes) {
      try {
        this.deps.restartNvdaDetached(exe);
      } catch (error) {
        this.warnNotRestarted(error);
      }
    }
  }

  private warnNotRestarted(error: unknown): void {
    this.options.logger.warn(
      `Couldn't turn your NVDA back on (${errorMessage(error)}). Start it the way you usually do: an installed NVDA starts with Ctrl+Alt+N.`,
    );
  }

  getEnvironmentInfo(): Promise<EnvironmentInfo> {
    const { install } = this.deps;
    const system = this.deps.system();
    const nvdaVersion = nvdaVersionFromBuild(install.build) ?? install.build;
    return Promise.resolve({
      driver: { name: "guidepup", version: system.guidepupVersion },
      screenReader: {
        name: "NVDA",
        version: nvdaVersion,
        build: install.build,
        language: nvdaLanguage(section(this.settings, "general").language, system.uiLocale),
      },
      capture: this.options.config.capture,
      browser: this.browser,
      os: system.os,
      screenReaderSettings: recordedSettings(this.settings, nvdaVersion),
    });
  }

  /**
   * Take the NVDA lock (kept for start()), then shut down what an earlier run left behind. With
   * the lock held, nothing cleaned up can belong to another voicecap: one that's running holds the
   * lock, and this throws its "held" message instead.
   */
  async cleanupStale(): Promise<string[]> {
    if (this.deps.platform !== "win32") return [];
    const previous = await readLockHolder(this.deps.lockFile);
    await this.holdLock();
    const notes = await this.deps.cleanupOrphans();
    if (previous && isStale(previous)) {
      notes.unshift(
        `An earlier voicecap run (process ${previous.pid}, started ${previous.startedAt}) didn't shut down cleanly.`,
      );
    }
    return notes;
  }

  async openPage(url: string): Promise<PageInfo> {
    const { generation, nvda } = this.started();
    const session = await this.freshSession(generation);
    const page: Current = { generation, nvda, session };
    this.firstTab = true;
    this.inDocument = true;
    this.pageUrl = url;
    // No time limit of the driver's own: the core's open timeout restarts and retries.
    const loaded = await session.load(url, 0);
    this.pageUrl = loaded.finalUrl;
    if (!isHtmlContentType(loaded.contentType)) return { ...loaded, title: null, canonical: null };
    await session.waitUntilReady(this.options.config.readiness);
    const title = await session.pageTitle();
    const canonical = await session.pageCanonical();
    const screenshot = await this.screenshotOf(session);
    await this.bringToFront(page);
    await this.press(page, "exitFocusMode", { capture: false });
    await this.press(page, "toTop");
    return { ...loaded, title: title === "" ? null : title, canonical, screenshot };
  }

  /**
   * The page as it looks now it has loaded: taken before the browser comes forward and before any
   * key, so it's the page as the screen reader finds it. A picture that can't be taken is the reason
   * instead, and never fails the page: it's evidence beside the transcripts, not part of them.
   */
  private async screenshotOf(session: BrowserSession): Promise<PageScreenshot> {
    try {
      return { jpeg: await session.screenshot() };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }

  /**
   * axe-core's check of the page that's open, in the browser that holds it, under the address the
   * page loaded at: see axeCheckOf. It presses no key, and leaves the window and its title as they
   * are. One left running at its limit ends when the page is next opened, with its browser.
   */
  async checkWithAxe(): Promise<AxeCapture> {
    const { session } = this.onPage();
    return axeCheckOf(session, this.pageUrl);
  }

  nextLine(): Promise<Speech> {
    return this.step("nextLine");
  }

  nextHeading(): Promise<Speech> {
    return this.step("nextHeading");
  }

  toTop(): Promise<Speech> {
    return this.step("toTop");
  }

  toBottom(): Promise<Speech> {
    return this.step("toBottom");
  }

  async nextFocusable(): Promise<Speech> {
    const page = this.onPage();
    const { nvda, session } = page;
    const before = await session.focusState();
    this.checkLive(page.generation);
    if (!before.focused) throw await this.foregroundLost(session);
    let speech: Speech;
    if (this.firstTab) {
      this.firstTab = false;
      speech = await this.command(() => nvda.speechDuring(() => session.pressTab()));
    } else {
      speech = await this.command(() => nvda.press("tab"));
    }
    speech = await this.heard(page, speech);
    const after = await session.focusState();
    this.checkLive(page.generation);
    if (after.focused && !lostFocusBetween(before, after)) {
      this.inDocument = true;
      return speech;
    }
    // Focus left the page and stayed out: normally in the browser's own toolbar, the end of the
    // tab pass. Focus that left and came back means another window came and went.
    if (!after.focused && (await this.browserInFront(page))) {
      this.checkLive(page.generation);
      this.inDocument = false;
      return speech;
    }
    throw await this.foregroundLost(session);
  }

  focusInDocument(): Promise<boolean> {
    return Promise.resolve(this.inDocument);
  }

  focusedElement(): Promise<FocusedElement | null> {
    return this.onPage().session.focusedElement();
  }

  private async step(key: NvdaKey): Promise<Speech> {
    return this.press(this.onPage(), key);
  }

  /**
   * Press a key through NVDA, only while the page has focus, and discard the step if the page lost
   * focus at any moment during it (its speech may include another window's).
   */
  private async press(
    page: Current,
    key: NvdaKey,
    options?: { capture?: boolean },
  ): Promise<Speech> {
    const before = await page.session.focusState();
    this.checkLive(page.generation);
    if (!before.focused) throw await this.foregroundLost(page.session);
    const said = await this.command(() => page.nvda.press(key, options));
    // Only speech that was captured says anything about NVDA and Windows.
    const speech = options?.capture === false ? said : await this.heard(page, said);
    const after = await page.session.focusState();
    this.checkLive(page.generation);
    if (!after.focused || lostFocusBetween(before, after)) {
      throw await this.foregroundLost(page.session);
    }
    return speech;
  }

  /**
   * Bring the browser window to the front (without keystrokes) and confirm it with NVDA+T against
   * a unique marker title, trying again a few times if another window stays in front.
   *
   * When a try fails, it asks which program is in front (windowInFront). If it's Windows Search or
   * the Start menu (closedProgram), which come in front by themselves and keep the browser from
   * coming forward, it records the loss as it's found and presses Escape once to close it
   * (closeForeground), then tries again, within the same tries: after the last there's no try to
   * make, so it presses nothing. For any other program, or none known, it only asks again after the
   * next try; the loss that fails the page is recorded once, with what the last try found, and the
   * error says no more than before.
   *
   * With openPage's Escape and Ctrl+Home, this is navigateToWebContent from @guidepup/playwright
   * 0.19.1, lib/nvdaTest.js (by Craig Morten, MIT License), adapted: the window is raised instead
   * of cycled with Alt+Esc (which brought other windows forward, and NVDA read them), and the
   * body click, Tab, and focus-mode toggles are left out (they move the browser's focus starting
   * point, which the tab pass depends on, and a click can follow a link).
   */
  private async bringToFront(page: Current): Promise<void> {
    const { nvda, session } = page;
    const marker = this.markerTitle();
    const restore = await session.setTitle(marker);
    try {
      let spoken = "";
      // What the last try that failed found in front.
      let front: InFront = { program: null, title: null };
      for (let attempt = 0; attempt < RAISE_ATTEMPTS; attempt++) {
        // Raise before asking NVDA anything: a window in front that keeps changing (a terminal
        // with a spinner, say) keeps NVDA talking, and Guidepup waits for silence before every
        // command it captures, so NVDA+T would never return.
        await session.raise();
        await this.deps.sleep(TITLE_SETTLE_MS);
        this.checkLive(page.generation);
        spoken = await this.heard(page, await this.command(() => nvda.press("reportTitle")));
        if (titleMatches(spoken, marker)) return;
        // Another window is in front: which? Asked after every try that fails, so Search or the
        // Start menu coming up on a later one is found too.
        front = await this.windowInFront(session);
        this.checkLive(page.generation);
        const { program } = front;
        if (program !== null && closedProgram(program) !== null) {
          // Recorded as it's found, as any loss is. Another try follows, or there's nothing to close
          // it for.
          this.recordForegroundLost(front);
          if (attempt < RAISE_ATTEMPTS - 1) await this.closeForeground(page, program);
        }
      }
      this.options.logger.warn(
        `The browser couldn't be brought to the front; NVDA reports this window in front: "${spoken}".`,
      );
      // The loss that fails the page is recorded once: what the last try found in front, unless it
      // was Search or the Start menu, which were recorded as they were found.
      if (closedProgram(front.program) === null) this.recordForegroundLost(front);
      throw new ForegroundError(
        "The browser window couldn't be brought to the front, so keystrokes would have gone to another window. Keep the computer free while voicecap runs: close dialogs, and don't use other windows.",
        { program: front.program },
      );
    } finally {
      await restore();
    }
  }

  /**
   * Press Escape once to close `program`, which came in front of the browser (Windows Search or the
   * Start menu: see closedProgram). It goes through NVDA, as openPage's Escape does, to the window
   * in front, which isn't the page's: the page has no focus, so press()'s check of it would refuse.
   * It's recorded once it's sent, with the program's name as windowInFront gave it, and then
   * Windows gets a moment to close it before the browser is raised again.
   */
  private async closeForeground(page: Current, program: string): Promise<void> {
    // The lookup before this took a while: a stop() that came meanwhile sends no key.
    this.checkLive(page.generation);
    await this.command(() => page.nvda.press("exitFocusMode", { capture: false }));
    this.checkLive(page.generation);
    this.events.record({ type: "foreground-escape", program });
    await this.deps.sleep(CLOSE_SETTLE_MS);
    this.checkLive(page.generation);
  }

  /** Whether the browser window is in front (focus may be in its toolbar rather than the page). */
  private async browserInFront(page: Current): Promise<boolean> {
    const marker = this.markerTitle();
    const restore = await page.session.setTitle(marker);
    try {
      await this.deps.sleep(TITLE_SETTLE_MS);
      this.checkLive(page.generation);
      const spoken = await this.command(() => page.nvda.press("reportTitle"));
      return titleMatches(await this.heard(page, spoken), marker);
    } finally {
      await restore();
    }
  }

  /**
   * What NVDA said, checked: when NVDA has died, Guidepup's commands come back with no speech at
   * all, which a pass would take for a blank line or the end of the page.
   */
  private async heard(page: Current, speech: Speech): Promise<Speech> {
    if (speech.trim() !== "") return speech;
    if (!(await page.nvda.isRunning())) {
      this.checkLive(page.generation);
      throw new EnvironmentError(
        "NVDA stopped running (it may have crashed), so this step's silence says nothing about the page.",
        { failure: "screen-reader-stopped" },
      );
    }
    // On a locked computer, Windows keeps NVDA from pressing keys, and NVDA says nothing.
    if ((await this.deps.sessionLocked()) === true) {
      this.checkLive(page.generation);
      throw this.computerLocked();
    }
    return speech;
  }

  /**
   * The page of the browser `session` lost focus: to another window, or to the lock screen (checked
   * on real Windows).
   */
  private async foregroundLost(session: BrowserSession): Promise<Error> {
    return (await this.deps.sessionLocked()) === true
      ? this.computerLocked()
      : lostForeground(await this.foregroundTakenBy(session));
  }

  /**
   * Another window has the foreground, as a step's error is made: which program has it is looked up,
   * once, and recorded (foreground-lost). Gives the program's name, null when it isn't known (see
   * windowInFront). The error gets the name only, as the window's title, which the log keeps, can
   * hold private text. Not knowing mustn't change what the step fails with.
   */
  private async foregroundTakenBy(session: BrowserSession): Promise<string | null> {
    const front = await this.windowInFront(session);
    this.recordForegroundLost(front);
    return front.program;
  }

  /**
   * The window in front now, as the log keeps it: its program's name and its title, each null when
   * it isn't known: the lookup failed, Windows didn't say, or the window in front is the page's own
   * browser (`session`, told by its process id). The lookup comes a moment after the loss, and the
   * foreground may have come back to the browser by then: no program took it. A browser with no
   * process id can't be told from another program's window, so the answer stands. Nothing is
   * recorded: whoever asks decides which loss is the one to record.
   */
  private async windowInFront(session: BrowserSession): Promise<InFront> {
    let front: ForegroundWindow | null = null;
    try {
      front = await this.deps.foregroundWindow();
    } catch {
      // Counts as not known.
    }
    if (front !== null && front.pid === session.pid) front = null;
    return { program: front?.program ?? null, title: front?.title ?? null };
  }

  /** Another window took the foreground from the browser: recorded, with the program and its title. */
  private recordForegroundLost(front: InFront): void {
    this.events.record({ type: "foreground-lost", program: front.program, title: front.title });
  }

  /** Windows was found locked: recorded, as the error that says so is made. */
  private computerLocked(): EnvironmentError {
    this.events.record({ type: "computer-locked" });
    return windowsLocked();
  }

  private markerTitle(): string {
    return `voicecap check ${this.deps.marker()}`;
  }

  /**
   * The browser for the next load. The browser launched at start serves the first load; after
   * that each load gets a new one. The new one launches before the old one closes, so Windows
   * hands the foreground from the old window to the new one. Closing the old one ends what it still
   * had under way, with its page: a check with axe that ran out of time (see axeCheckOf) included.
   */
  private async freshSession(generation: number): Promise<BrowserSession> {
    if (this.session && !this.sessionUsed) {
      this.sessionUsed = true;
      return this.session;
    }
    const previous = this.session;
    const next = await this.launchBrowser();
    if (generation !== this.generation) {
      await this.closeBrowser(next);
      throw stopped();
    }
    this.session = next;
    this.sessionUsed = true;
    if (previous) await this.closeBrowser(previous);
    this.checkLive(generation);
    return next;
  }

  /**
   * Launch a browser, kept track of until it has closed. Every browser must be the one recorded
   * at the first start: each page gets a new browser, and browsers update themselves.
   */
  private launchBrowser(): Promise<BrowserSession> {
    return this.track(
      this.deps.launchBrowser(this.launches.signal).then(async (session) => {
        this.browsers.set(session, null);
        this.syncExitHook();
        this.events.record({ type: "browser-launched", pid: session.pid ?? null });
        const recorded = this.browser;
        if (recorded && (session.name !== recorded.name || session.version !== recorded.version)) {
          await this.closeBrowser(session);
          throw new EnvironmentError(
            `The browser changed during the run: ${recorded.name} ${recorded.version} was recorded, and ${session.name} ${session.version} started now (browsers update themselves). Transcripts from different browser versions aren't comparable, so run the same command again to resume with the new version recorded.`,
            { failure: "browser" },
          );
        }
        return session;
      }),
    );
  }

  /**
   * Close a browser; closing one that's already closing waits for that close. The close is recorded
   * once it has finished: a browser that wouldn't close isn't said to have.
   */
  private closeBrowser(session: BrowserSession): Promise<void> {
    let closing = this.browsers.get(session);
    if (closing === undefined) return Promise.resolve();
    if (closing === null) {
      closing = session
        .close()
        .then(() => {
          this.events.record({ type: "browser-closed", pid: session.pid ?? null });
        })
        .catch((error: unknown) => {
          this.options.logger.warn(`Closing the browser failed: ${errorMessage(error)}`);
        })
        .finally(() => {
          this.browsers.delete(session);
          this.syncExitHook();
        });
      this.browsers.set(session, closing);
    }
    return closing;
  }

  /** Let Windows sleep, turn the screen off, and lock again. */
  private letSleep(): void {
    this.awake?.release();
    this.awake = null;
  }

  /** Kill the browsers still starting; later launches belong to the next start. */
  private callOffLaunches(): void {
    this.launches.abort();
    this.launches = new AbortController();
  }

  /** Keep work under way in view until it settles, so stop() can give it a moment to finish. */
  private track<T>(work: Promise<T>): Promise<T> {
    const settled = work.then(
      () => {},
      () => {},
    );
    this.pending.add(settled);
    void settled.then(() => this.pending.delete(settled));
    return work;
  }

  private setNvdaState(state: GuidepupNvdaDriver["nvdaState"]): void {
    this.nvdaState = state;
    this.syncExitHook();
  }

  /**
   * Shut NVDA and the browsers down if the process exits while any of them is running, and start
   * the person's own NVDA again if that's still to do.
   */
  private syncExitHook(): void {
    const needed =
      this.nvdaState !== "stopped" || this.browsers.size > 0 || this.ownNvdaExes.length > 0;
    if (needed === this.exitHooked) return;
    this.exitHooked = needed;
    if (needed) process.on("exit", this.onExit);
    else process.removeListener("exit", this.onExit);
  }

  /** Send an NVDA command, counted while it's under way. */
  private async command<T>(send: () => Promise<T>): Promise<T> {
    this.commandsUnderWay++;
    try {
      return await send();
    } finally {
      this.commandsUnderWay--;
    }
  }

  /** Stop NVDA if it's running. Whoever finds it running does the stopping. */
  private async shutDownNvda(): Promise<void> {
    const nvda = this.nvda;
    if (!nvda || this.nvdaState !== "running") return;
    this.setNvdaState("stopping");
    try {
      // A command under way was given up on (a timeout, or Ctrl+C), and Guidepup's stop would wait
      // for it: shutting NVDA down directly ends it, and NVDA can't send its key any more.
      if (this.commandsUnderWay > 0) nvda.forceQuit();
      await this.stopNvda(nvda);
    } finally {
      this.setNvdaState("stopped");
    }
    // A restart's stop is one that a start follows at once. That's judged only now, after the wait,
    // as a final stop may have joined it meanwhile. NVDA shut down by a start that failed, with no
    // stop() under way, isn't followed by a start: the core decides what comes next.
    const restarting = this.stopping !== null && !this.finalStop;
    this.events.record({ type: "screen-reader-stopped", pid: this.nvdaPid, restarting });
    this.nvdaPid = null;
    await this.keepNvdaLog();
  }

  /**
   * NVDA has quit: read its log, clean it, and hand the copy to the run's recorder, which keeps it
   * (EventRecorder.screenReaderLog). It's read here, by whoever stopped NVDA, because NVDA moves the
   * last log aside to nvda-old.log whenever it starts, which the next start does, and so does the
   * person's own NVDA when the final stop starts it again. Only an NVDA that this driver ran and
   * has just quit has a log to read: one that never started has none of this run's. A recorder that
   * keeps no copies is given none, and nothing is read, as doctor's live check and fixture capture
   * run the driver with none. A log that can't be had (see cleanedNvdaLog) is recorded as no copy,
   * with why, and the console is told, once for a driver; it never stops the stop that was under
   * way. What the recorder does with a copy is its own: it never throws, as `record` never does.
   */
  private async keepNvdaLog(): Promise<void> {
    const recorder = this.events;
    if (recorder.screenReaderLog === undefined) return;
    const log = await this.cleanedNvdaLog();
    if ("cleaned" in log) {
      recorder.screenReaderLog(log.cleaned);
      return;
    }
    recorder.record({ type: "screen-reader-log", file: null, reason: log.reason });
    if (!this.noCopyWarned) {
      this.noCopyWarned = true;
      this.options.logger.warn(
        `NVDA's own log of one NVDA session wasn't kept: ${sentence(log.reason)} The run goes on.`,
      );
    }
  }

  /**
   * NVDA's log, read and cleaned, or why it can't be had: there is no file, or it's empty, or it
   * can't be read (another program has it locked, say), or it began before this NVDA session's
   * start did, so it's an earlier NVDA's (beganWithSession). Nothing is read when the account's home
   * folder isn't known: a copy says it has the home folder written as %USERPROFILE%, and the
   * account's name in a path would stay in it. Never throws.
   */
  private async cleanedNvdaLog(): Promise<{ cleaned: string } | { reason: string }> {
    const { home, platform } = this.deps;
    if (home.trim() === "") {
      return {
        reason: "The account's home folder isn't known, so NVDA's log couldn't be cleaned of it.",
      };
    }
    try {
      const raw = await this.deps.readNvdaLog();
      if (raw === null || raw.trim() === "") return { reason: "NVDA's log wasn't there." };
      const began = this.nvdaBegan;
      if (began !== null && !beganWithSession(raw, began, this.deps.now())) {
        return {
          reason: "NVDA's log is older than this NVDA session, so it isn't this session's.",
        };
      }
      return { cleaned: cleanNvdaLog(raw, { home, platform }) };
    } catch (error) {
      // The run keeps the reason, and a path in an error's message names the account.
      return { reason: redactHome(errorMessage(error), home, platform) };
    }
  }

  private async stopNvda(nvda: NvdaControl): Promise<void> {
    const stopped = nvda.stop().catch((error: unknown) => {
      this.options.logger.warn(`Stopping NVDA failed: ${describeError(error)}`);
    });
    if (await this.settlesWithin(stopped, STOP_TIMEOUT_MS)) return;
    this.options.logger.warn("NVDA didn't stop in time; shutting it down directly.");
    nvda.forceQuit();
    if (!(await this.settlesWithin(stopped, STOP_TIMEOUT_MS))) {
      this.options.logger.warn("Guidepup still hasn't finished stopping NVDA.");
      // Its stop still ends by quitting whichever NVDA is running, so the person's must wait.
      this.unfinishedStops.add(stopped);
      void stopped.finally(() => {
        this.unfinishedStops.delete(stopped);
      });
    }
  }

  /** Whether the promise settles within the time; the timer is cancelled as soon as it does. */
  private async settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
    const timer = new AbortController();
    try {
      return await Promise.race([
        promise.then(() => true),
        this.deps.sleep(ms, timer.signal).then(
          () => false,
          () => false,
        ),
      ]);
    } finally {
      timer.abort();
    }
  }

  private started(): { generation: number; nvda: NvdaControl } {
    if (!this.nvda || this.nvdaState !== "running" || !this.session) {
      throw new Error("The guidepup driver isn't started.");
    }
    return { generation: this.generation, nvda: this.nvda };
  }

  private onPage(): Current {
    const { generation, nvda } = this.started();
    if (!this.session || !this.sessionUsed) throw new Error("openPage() must be called first.");
    return { generation, nvda, session: this.session };
  }

  /** Throws if stop() came after the call that began in this generation. */
  private checkLive(generation: number): void {
    if (generation !== this.generation) throw stopped();
  }
}

/** What a call works with: NVDA and the page's browser, as they were when the call began. */
interface Current {
  generation: number;
  nvda: NvdaControl;
  session: BrowserSession;
}

/** The window found in front of the browser: what a lost foreground is recorded with. */
interface InFront {
  /** The program that owns it, by the name the lookup gives it; null when that isn't known. */
  program: string | null;
  /** Its title, which can hold private text: the log keeps it, and no report shows it. */
  title: string | null;
}

/**
 * axe-core's check of the page `session` holds, which is at `url`: what voicecap keeps of axe's
 * results, or the reason there are none (its first line: see axeErrorReason). axe gets
 * AXE_LIMIT_MS. A check still under way then can't be stopped, so its reason says it's left running
 * in the page (`leftRunning`): the core opens the page again before any key, and the fresh browser
 * that load gets (`freshSession`) closes this one, which ends the check. Neither a check that fails
 * nor one that runs out of time fails the page: axe's results are evidence beside the transcripts,
 * not part of them. Only a browser that's gone fails it, as it would any step.
 */
export async function axeCheckOf(session: BrowserSession, url: string): Promise<AxeCapture> {
  try {
    const raw = await withinLimit(
      session.runAxe(await axeScript()),
      AXE_LIMIT_MS,
      `timed out after ${formatDuration(AXE_LIMIT_MS)}`,
    );
    return keptAxeResults(raw, url);
  } catch (error) {
    if (error instanceof EnvironmentError && error.failure === "browser") throw error;
    const reason = axeErrorReason(error);
    return error instanceof LimitReachedError
      ? { error: reason, leftRunning: true }
      : { error: reason };
  }
}

function stopped(): Error {
  return new Error("The guidepup driver was stopped while this call was under way.");
}

/**
 * Whether the page's window lost focus between two readings. The count lives in the page, so a page
 * that reloads itself starts it over; only a rise means a loss.
 */
function lostFocusBetween(before: FocusState, after: FocusState): boolean {
  return after.losses > before.losses;
}

function windowsLocked(): EnvironmentError {
  return new EnvironmentError(
    "Windows is locked, so NVDA can't press keys or speak. Unlock the computer and keep it unlocked while voicecap runs: voicecap keeps Windows from sleeping or turning the screen off, but Win+L, a screen saver, or a workplace lock policy still lock it.",
    { failure: "locked" },
  );
}

function lostForeground(program: string | null): ForegroundError {
  return new ForegroundError(
    "The browser lost the foreground to another window, so this step's keystroke and speech were discarded. Keep the computer free while voicecap runs.",
    { program },
  );
}

/** A reason as a sentence of its own: its words, with one full stop at the end. */
function sentence(reason: string): string {
  return `${reason.trim().replace(/[\s.]+$/, "")}.`;
}

function describeError(error: unknown): string {
  const message = errorMessage(error);
  const cause =
    error instanceof Error && error.cause !== undefined ? errorMessage(error.cause) : "";
  return cause && !message.includes(cause)
    ? `${message} (${cause.split("\n")[0] ?? cause})`
    : message;
}

function section(settings: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = settings[name];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The settings recorded with every transcript. Guidepup's configuration, like NVDA's own saved
 * configuration, holds only values that differ from NVDA's defaults, so empty sections mean
 * "all defaults" for that NVDA version.
 */
function recordedSettings(
  settings: Record<string, unknown>,
  nvdaVersion: string,
): Record<string, unknown> {
  const recorded: Record<string, unknown> = {
    recorded: `only settings that differ from NVDA ${nvdaVersion}'s defaults (Guidepup's configuration plus voicecap's nvdaSettings)`,
  };
  for (const name of SETTINGS_SECTIONS) recorded[name] = section(settings, name);
  for (const name of OPTIONAL_SETTINGS_SECTIONS) {
    if (name in settings) recorded[name] = section(settings, name);
  }
  return recorded;
}
