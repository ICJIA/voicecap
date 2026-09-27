/**
 * The Guidepup NVDA driver: real NVDA through @guidepup/guidepup (pinned exactly), with Google
 * Chrome driven through Playwright as a library. Windows only.
 *
 * What the driver guarantees, beyond passing keys to NVDA (checked against real NVDA 2026.2):
 *
 * - Keystrokes only ever reach the browser. Keys sent through NVDA go to whichever window is in
 *   front, so every load confirms the window with NVDA+T (report title) against a unique marker
 *   title, and every step checks that the page still has focus before and after its keystroke. A
 *   step during which another window came forward is discarded as a ForegroundError, so another
 *   window's speech never ends up in a transcript.
 * - Each load gets a fresh browser with a new profile, so no page's transcript depends on which
 *   pages came before (visited links, cookies, storage).
 * - The tab pass starts at the first focusable element: the first Tab after a load goes to the
 *   browser directly. Sent through NVDA in browse mode, it would move to the first focusable
 *   element after NVDA's cursor, which Ctrl+Home puts on the first line, skipping a skip link.
 * - NVDA is stopped exactly once, by voicecap: Guidepup's own signal handlers are detached (see
 *   guidepup/nvda.ts), and a Guidepup stop that hangs falls back to shutting NVDA down directly.
 */
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import type { VoicecapConfig } from "../config/schema.js";
import { isHtmlContentType } from "../pages/url.js";
import { EnvironmentError, errorMessage } from "../util/errors.js";
import { acquireLockFile, isStale, readLockHolder } from "../util/lock-file.js";
import type { Logger } from "../util/log.js";
import { launchChrome } from "./guidepup/chrome.js";
import { loadGuidepupNvda } from "./guidepup/nvda.js";
import {
  guidepupInstall,
  nvdaLockFile,
  nvdaVersionFromBuild,
  readGuidepupPackage,
  spaceInPathMessage,
  type GuidepupInstall,
} from "./guidepup/paths.js";
import {
  cleanupOrphans,
  listProcesses,
  nvdaLanguage,
  titleMatches,
  windowsSystemInfo,
} from "./guidepup/windows.js";
import {
  ForegroundError,
  type CaptureMode,
  type EnvironmentInfo,
  type FocusedElement,
  type PageInfo,
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

/** One browser, with a fresh profile, showing one page. */
export interface BrowserSession {
  readonly name: string;
  readonly version: string;
  /** Load a URL, following redirects. */
  load(url: string, timeoutMs: number): Promise<LoadResult>;
  waitUntilReady(readiness: VoicecapConfig["readiness"]): Promise<void>;
  pageTitle(): Promise<string>;
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
  launchBrowser: () => Promise<BrowserSession>;
  /** Process ids of running NVDA copies (any NVDA, not just Guidepup's). */
  runningNvda: () => Promise<number[]>;
  /** The machine-wide lock: only one voicecap drives NVDA at a time. */
  lockFile: string;
  system: () => SystemInfo;
  /** Close browsers and delete profiles that an earlier run left behind; describe what was done. */
  cleanupOrphans: () => Promise<string[]>;
  sleep: (ms: number) => Promise<void>;
  /** A short random token for the window-title check. */
  marker: () => string;
}

/** The driver with the real Guidepup, browser, and Windows behind it. Nothing starts until start(). */
export function createGuidepupNvdaDriver(
  options: { config: VoicecapConfig; logger: Logger },
  platform: NodeJS.Platform = process.platform,
): GuidepupNvdaDriver {
  const guidepup = readGuidepupPackage();
  const install = guidepupInstall(guidepup.nvdaBuild, process.env, os.homedir());
  let system: SystemInfo | null = null;
  return new GuidepupNvdaDriver(options, {
    platform,
    loadNvda: () => loadGuidepupNvda(install),
    install,
    installed: () => existsSync(install.nvdaExe),
    launchBrowser: () => launchChrome({ browser: options.config.browser, env: process.env }),
    runningNvda: () => listProcesses("nvda.exe"),
    lockFile: nvdaLockFile(process.env, os.homedir()),
    system: () => (system ??= { ...windowsSystemInfo(), guidepupVersion: guidepup.version }),
    cleanupOrphans: () => cleanupOrphans(os.tmpdir(), install.nvdaExe),
    sleep: (ms) => delay(ms),
    marker: randomMarker,
  });
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
  private nvdaRunning = false;
  private releaseLock: (() => Promise<void>) | null = null;
  private session: BrowserSession | null = null;
  /** Whether the current session has loaded a page (the next load gets a fresh browser). */
  private sessionUsed = false;
  private settings: Record<string, unknown> = {};
  private browser: { name: string; version: string } | null = null;
  private firstTab = true;
  private inDocument = true;
  private readonly onExit = () => this.abandon();

  constructor(
    private readonly options: { config: VoicecapConfig; logger: Logger },
    private readonly deps: GuidepupDriverDeps,
  ) {}

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
    if (/\s/.test(install.cacheDir)) throw new EnvironmentError(spaceInPathMessage(install));

    this.releaseLock = await acquireLockFile(this.deps.lockFile, {
      held: (holder) =>
        `Another voicecap (process ${holder.pid}, started ${holder.startedAt}) is using NVDA on this computer, and only one can at a time. Wait for it to finish, or stop it first.`,
      otherHost: (holder, file) =>
        `The NVDA lock ${file} was taken on another computer (${holder.host}). If no voicecap is running here, delete it.`,
    });
    try {
      const running = await this.deps.runningNvda();
      if (running.length > 0) {
        this.options.logger.alert(
          `NVDA is running (process ${running.join(", ")}). voicecap shuts it down now and starts its own copy (Guidepup's NVDA ${install.build}). Start your NVDA again when voicecap has finished.`,
        );
      }
      const nvda = await this.deps.loadNvda();
      try {
        await nvda.start({
          capture: this.options.config.capture,
          settings: this.options.config.nvdaSettings,
        });
      } catch (error) {
        throw new EnvironmentError(`NVDA didn't start: ${describeError(error)}`, {
          cause: error,
        });
      }
      this.nvda = nvda;
      this.nvdaRunning = true;
      process.on("exit", this.onExit);
      this.settings = nvda.settings();
      // Launching the browser now checks that it works before any page is tried.
      this.session = await this.deps.launchBrowser();
      this.sessionUsed = false;
      this.browser = { name: this.session.name, version: this.session.version };
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session) {
      await session.close().catch((error: unknown) => {
        this.options.logger.warn(`Closing the browser failed: ${errorMessage(error)}`);
      });
    }
    const nvda = this.nvda;
    if (nvda && this.nvdaRunning) {
      this.nvdaRunning = false;
      await this.stopNvda(nvda);
    }
    process.removeListener("exit", this.onExit);
    const release = this.releaseLock;
    this.releaseLock = null;
    await release?.();
  }

  /** Shut NVDA and the browser down synchronously: the process is exiting. */
  abandon(): void {
    if (this.nvda && this.nvdaRunning) {
      this.nvdaRunning = false;
      this.nvda.forceQuit();
    }
    this.session?.abandon();
    this.session = null;
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

  async cleanupStale(): Promise<string[]> {
    if (this.deps.platform !== "win32") return [];
    const holder = await readLockHolder(this.deps.lockFile);
    // A live holder is another voicecap run: its browsers are in use.
    if (holder && !isStale(holder)) return [];
    const notes = await this.deps.cleanupOrphans();
    if (holder) {
      await rm(this.deps.lockFile, { force: true });
      notes.unshift(
        `An earlier voicecap run (process ${holder.pid}, started ${holder.startedAt}) didn't shut down cleanly.`,
      );
    }
    return notes;
  }

  async openPage(url: string): Promise<PageInfo> {
    const nvda = this.requireNvda();
    const session = await this.freshSession();
    this.firstTab = true;
    this.inDocument = true;
    const loaded = await session.load(url, this.options.config.timeouts.stepMs);
    if (!isHtmlContentType(loaded.contentType)) return { ...loaded, title: null };
    await session.waitUntilReady(this.options.config.readiness);
    const title = await session.pageTitle();
    await this.bringToFront(session, nvda);
    await this.press(session, nvda, "exitFocusMode", { capture: false });
    await this.press(session, nvda, "toTop");
    return { ...loaded, title: title === "" ? null : title };
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
    const { nvda, session } = this.requirePage();
    const before = await session.focusState();
    if (!before.focused) throw lostForeground();
    let speech: Speech;
    if (this.firstTab) {
      this.firstTab = false;
      speech = await nvda.speechDuring(() => session.pressTab());
    } else {
      speech = await nvda.press("tab");
    }
    const after = await session.focusState();
    if (after.focused && !lostFocusBetween(before, after)) {
      this.inDocument = true;
      return speech;
    }
    // Focus left the page and stayed out: normally in the browser's own toolbar, the end of the
    // tab pass. Focus that left and came back means another window came and went.
    if (!after.focused && (await this.browserInFront(session, nvda))) {
      this.inDocument = false;
      return speech;
    }
    throw lostForeground();
  }

  focusInDocument(): Promise<boolean> {
    return Promise.resolve(this.inDocument);
  }

  focusedElement(): Promise<FocusedElement | null> {
    return this.requirePage().session.focusedElement();
  }

  private async step(key: NvdaKey): Promise<Speech> {
    const { nvda, session } = this.requirePage();
    return this.press(session, nvda, key);
  }

  /**
   * Press a key through NVDA, only while the page has focus, and discard the step if the page lost
   * focus at any moment during it (its speech may include another window's).
   */
  private async press(
    session: BrowserSession,
    nvda: NvdaControl,
    key: NvdaKey,
    options?: { capture?: boolean },
  ): Promise<Speech> {
    const before = await session.focusState();
    if (!before.focused) throw lostForeground();
    const speech = await nvda.press(key, options);
    const after = await session.focusState();
    if (!after.focused || lostFocusBetween(before, after)) throw lostForeground();
    return speech;
  }

  /**
   * Bring the browser window to the front (without keystrokes) and confirm it with NVDA+T against
   * a unique marker title, trying again a few times if another window stays in front.
   */
  private async bringToFront(session: BrowserSession, nvda: NvdaControl): Promise<void> {
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
        spoken = await nvda.press("reportTitle");
        if (titleMatches(spoken, marker)) return;
      }
      this.options.logger.warn(
        `The browser couldn't be brought to the front; NVDA reports this window in front: "${spoken}".`,
      );
      throw new ForegroundError(
        "The browser window couldn't be brought to the front, so keystrokes would have gone to another window. Keep the computer free while voicecap runs: close dialogs, and don't use other windows.",
      );
    } finally {
      await restore();
    }
  }

  /** Whether the browser window is in front (focus may be in its toolbar rather than the page). */
  private async browserInFront(session: BrowserSession, nvda: NvdaControl): Promise<boolean> {
    const marker = this.markerTitle();
    const restore = await session.setTitle(marker);
    try {
      await this.deps.sleep(TITLE_SETTLE_MS);
      return titleMatches(await nvda.press("reportTitle"), marker);
    } finally {
      await restore();
    }
  }

  private markerTitle(): string {
    return `voicecap check ${this.deps.marker()}`;
  }

  /**
   * The browser for the next load. The browser launched at start serves the first load; after
   * that each load gets a new one. The new one launches before the old one closes, so Windows
   * hands the foreground from the old window to the new one.
   */
  private async freshSession(): Promise<BrowserSession> {
    if (this.session && !this.sessionUsed) {
      this.sessionUsed = true;
      return this.session;
    }
    const previous = this.session;
    const next = await this.deps.launchBrowser();
    this.session = next;
    this.sessionUsed = true;
    await previous?.close().catch((error: unknown) => {
      this.options.logger.warn(`Closing the previous browser failed: ${errorMessage(error)}`);
    });
    return next;
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
    }
  }

  private settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
    return Promise.race([promise.then(() => true), this.deps.sleep(ms).then(() => false)]);
  }

  private requireNvda(): NvdaControl {
    if (!this.nvda || !this.nvdaRunning) throw new Error("The guidepup driver isn't started.");
    return this.nvda;
  }

  private requirePage(): { nvda: NvdaControl; session: BrowserSession } {
    const nvda = this.requireNvda();
    if (!this.session || !this.sessionUsed) throw new Error("openPage() must be called first.");
    return { nvda, session: this.session };
  }
}

/**
 * Whether the page's window lost focus between two readings. The count lives in the page, so a page
 * that reloads itself starts it over; only a rise means a loss.
 */
function lostFocusBetween(before: FocusState, after: FocusState): boolean {
  return after.losses > before.losses;
}

function lostForeground(): ForegroundError {
  return new ForegroundError(
    "The browser lost the foreground to another window, so this step's keystroke and speech were discarded. Keep the computer free while voicecap runs.",
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
