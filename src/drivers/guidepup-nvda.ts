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
 * - When another window has the foreground, it looks up which program has it, once, as the loss is
 *   found. The log gets the program and the window's title (foreground-lost), and the
 *   ForegroundError names the program only: a title can hold private text. Not knowing the program
 *   (the lookup fails, Windows doesn't say, or the foreground has come back to the page's own
 *   browser, which took it from no one) changes nothing else about the failure.
 * - Each HTML page's screenshot is taken through the browser's DevTools connection once the page
 *   has loaded, before the browser is brought to the front and before any key, so it shows the page
 *   as the screen reader finds it, and taking it doesn't move the window. One that can't be taken
 *   is returned as the reason, and never fails the page.
 * - A page is checked with axe-core only when the core asks (checkWithAxe), in the page the browser
 *   holds: axe-core's own script, evaluated through Playwright, so nothing is added to the page.
 *   The check presses no key and leaves the window as it is. One that fails or takes over 20
 *   seconds is returned as the reason, and never fails the page.
 */
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import { AXE_LIMIT_MS, axeScript, keptAxeResults } from "../axe/results.js";
import type { VoicecapConfig } from "../config/schema.js";
import { isHtmlContentType } from "../pages/url.js";
import { EnvironmentError, errorMessage } from "../util/errors.js";
import { acquireLockFile, isStale, readLockHolder } from "../util/lock-file.js";
import type { Logger } from "../util/log.js";
import { formatDuration } from "../util/time.js";
import { launchChrome, withinLimit } from "./guidepup/chrome.js";
import { loadGuidepupNvda } from "./guidepup/nvda.js";
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
   * axe-core's results for the page as it is now, as axe gives them: `script` is axe-core's own,
   * run in the page without adding anything to it. It never brings the window forward or presses a
   * key, and it has no time limit of its own.
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
    try {
      await nvda.start({
        capture: this.options.config.capture,
        settings: this.options.config.nvdaSettings,
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
   * are.
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
      for (let attempt = 0; attempt < RAISE_ATTEMPTS; attempt++) {
        // Raise before asking NVDA anything: a window in front that keeps changing (a terminal
        // with a spinner, say) keeps NVDA talking, and Guidepup waits for silence before every
        // command it captures, so NVDA+T would never return.
        await session.raise();
        await this.deps.sleep(TITLE_SETTLE_MS);
        this.checkLive(page.generation);
        spoken = await this.heard(page, await this.command(() => nvda.press("reportTitle")));
        if (titleMatches(spoken, marker)) return;
      }
      this.options.logger.warn(
        `The browser couldn't be brought to the front; NVDA reports this window in front: "${spoken}".`,
      );
      throw new ForegroundError(
        "The browser window couldn't be brought to the front, so keystrokes would have gone to another window. Keep the computer free while voicecap runs: close dialogs, and don't use other windows.",
        { program: await this.foregroundTakenBy(session) },
      );
    } finally {
      await restore();
    }
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
   * Another window has the foreground: which program has it is looked up, once, and recorded as the
   * error is made. Gives the program's name, null when it isn't known: the lookup failed, Windows
   * didn't say, or the window in front is the page's own browser (`session`, told by its process
   * id). The lookup comes a moment after the loss, and the foreground may have come back to the
   * browser by then: no program took it. A browser with no process id can't be told from another
   * program's window, so the answer stands. The error gets the name only, as the window's title,
   * which the log keeps, can hold private text. Not knowing mustn't change what the step fails with.
   */
  private async foregroundTakenBy(session: BrowserSession): Promise<string | null> {
    let front: ForegroundWindow | null = null;
    try {
      front = await this.deps.foregroundWindow();
    } catch {
      // Counts as not known.
    }
    if (front !== null && front.pid === session.pid) front = null;
    this.events.record({
      type: "foreground-lost",
      program: front?.program ?? null,
      title: front?.title ?? null,
    });
    return front?.program ?? null;
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
   * hands the foreground from the old window to the new one.
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

/**
 * axe-core's check of the page `session` holds, which is at `url`: what voicecap keeps of axe's
 * results, or the reason there are none. axe gets AXE_LIMIT_MS; a check still under way then can't
 * be stopped, so it's left behind. Neither a check that fails nor one that runs out of time fails
 * the page: axe's results are evidence beside the transcripts, not part of them. Only a browser
 * that's gone fails it, as it would any step.
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
    return { error: errorMessage(error) };
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
