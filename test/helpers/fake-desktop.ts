import type {
  BrowserSession,
  LoadResult,
  NvdaControl,
  NvdaKey,
} from "../../src/drivers/guidepup-nvda.js";
import type { ForegroundWindow } from "../../src/drivers/guidepup/windows.js";
import type { CaptureMode, FocusedElement, Speech } from "../../src/drivers/types.js";
import { TINY_JPEG } from "./jpeg.js";
import { rawAxe } from "./raw-axe.js";

/** For FakePage's axe: a check that never finishes. */
export const AXE_HANGS = Symbol("axe never finishes");

/**
 * Something NVDA said aloud on the fake desktop, and when, on its time (FakeDesktop.clockMs): of
 * the browser's page or window, of another window in front, or of the window behind the browser,
 * which NVDA reads while a browser opens or is raised (FakeDesktop.behind).
 */
export interface FakeSound {
  from: number;
  to: number;
  text: string;
  by: "browser" | "other" | "behind";
}

/** How long NVDA takes to say anything on the fake desktop, and the quiet after it, in ms. */
export const SPEECH_MS = 200;
export const QUIET_MS = 100;

/** Holds whoever waits on it until the test opens it: for work still in progress at a given moment. */
export class Gate {
  /** How many callers have waited on the gate. */
  waiting = 0;
  private readonly opened: Promise<void>;
  private release: () => void = () => {};

  constructor() {
    this.opened = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  wait(): Promise<void> {
    this.waiting++;
    return this.opened;
  }

  open(): void {
    this.release();
  }
}

/**
 * A fake Windows desktop for the Guidepup driver's tests: which window is in front, what NVDA says,
 * and where keystrokes land. It reproduces what the real exploration runs showed:
 *
 * - keys pressed through NVDA go to whichever window is in front;
 * - NVDA+T reports the title of the window in front;
 * - Windows names the program that owns the window in front, and gives its title;
 * - Chrome reports that its page has focus until its window has really been in front at least
 *   once, even while another window is in front.
 */
export class FakeDesktop {
  private frontWindow: "browser" | "other" = "browser";
  /** The process that owns the other window, and its program: the name is its file's description. */
  otherPid = 7001;
  otherProgram = "Microsoft Outlook";
  otherTitle = "Inbox - Outlook";
  /** Whether asking the browser window to come forward works. */
  raiseWorks = true;
  /**
   * How many more times asking the browser window to come forward fails before it works again, as
   * when Windows keeps another window in front for a moment (default: none).
   */
  raiseFailures = 0;
  /**
   * How many more NVDA+T presses read the browser's window title from before its page's title last
   * changed, while the browser is in front: Windows can take a moment to give the window its page's
   * new title (default: none).
   */
  oldTitleReads = 0;
  /** What each NVDA+T said, in order: the title it read of the window in front. */
  readonly titlesRead: string[] = [];
  /**
   * The desktop's own time, in ms since the epoch, which a test can give the driver as its clock
   * (`now`). It moves on only as NVDA speaks (see say), so any moment the driver reads is one the
   * desktop's sounds can be lined up with.
   */
  clockMs = Date.UTC(2026, 9, 11, 14, 0, 0);
  /** The desktop's time as a clock, for a driver's `now`. */
  readonly now = (): Date => new Date(this.clockMs);
  /** Everything NVDA said aloud, in order, with when: what a recording of NVDA holds. */
  readonly sounds: FakeSound[] = [];
  /**
   * The window behind voicecap's browser. While a browser opens, or is raised (which minimizes it
   * for a moment), that window is in front, and NVDA reads its title and some of its text aloud, as
   * it read Visual Studio Code's terminal in the r3 run of 2026-10-10. Null (the default): nothing
   * is behind the browser that NVDA reads.
   */
  behind: { title: string; text: string } | null = null;
  /**
   * The other window closes when it gets Escape, as Windows Search and the Start menu do: the
   * browser, which was behind it, is in front again, and can be raised.
   */
  otherClosesOnEscape = false;
  /**
   * The other window keeps changing (a terminal with a spinner, say), so NVDA keeps talking while
   * it's in front, and Guidepup, which waits for silence before each captured command, hangs.
   */
  otherKeepsTalking = false;
  /**
   * The page keeps NVDA talking (a live region, a carousel), so a captured command waits for
   * silence, which comes only when the page goes away.
   */
  pageKeepsTalking = false;
  /** Windows is locked: NVDA can't press keys or speak. */
  locked = false;
  /** Keys that reached a window that wasn't the browser: must stay empty. */
  readonly strayKeys: string[] = [];
  /** Everything that happened, in order, e.g. "alert", "nvda:start", "key:toTop". */
  readonly events: string[] = [];
  /** Sessions launched, newest last. */
  readonly sessions: FakeSession[] = [];
  /** Runs before a key reaches the browser, to simulate something stealing the foreground. */
  beforeKey: ((key: string) => void) | null = null;
  /** Holds browser launches until opened. A launch that's held can be killed. */
  launchGate: Gate | null = null;
  /** Launches held by the gate come up even when killed (the kill came too late). */
  launchesOutliveKill = false;
  /** The version the next browser launched reports (browsers update themselves). */
  browserVersion = "153.0.8010.53";
  /** Speech for keys the browser receives; default "<key> speech". */
  speech: (key: string, session: FakeSession) => Speech = (key) => `${key} speech`;
  /** Where the person's own running NVDA copies were started from (Guidepup's start ends them). */
  ownNvda: string[] = [];
  /** Holds the driver's question about the person's own NVDA until opened. */
  ownNvdaGate: Gate | null = null;
  /** Windows can't tell whether the person's own NVDA is running (PowerShell didn't answer). */
  ownNvdaFails = false;
  /** Starting the person's own NVDA again fails, either way. */
  restartFails = false;
  /** Holds the driver's wait for the person's own NVDA to start again until opened. */
  restartGate: Gate | null = null;
  /** Every path the driver started the person's own NVDA again from, either way, failures included. */
  readonly restarts: string[] = [];
  /**
   * NVDA's log as its file in the temp folder holds it (the text the driver reads and cleans): null
   * when there is no such file, or the error that reading it fails with. NVDA starts a new log
   * whenever it starts, so a test sets the log of the NVDA session it's about to stop.
   */
  nvdaLog: string | Error | null = null;
  /** Another program holds NVDA's log, so deleting it fails and the file stays as it is. */
  nvdaLogHeld = false;

  /** The driver's ownNvda(): the person's own NVDA copies running now. */
  async findOwnNvda(): Promise<string[]> {
    this.events.push("own-nvda:find");
    await this.ownNvdaGate?.wait();
    if (this.ownNvdaFails) throw new Error("PowerShell didn't answer");
    return [...this.ownNvda];
  }

  /** The driver's restartNvda(): start the person's own NVDA again, and wait until it has. */
  async restartNvda(exe: string): Promise<void> {
    this.restarts.push(exe);
    this.events.push(`own-nvda:restart:${exe}`);
    await this.restartGate?.wait();
    if (this.restartFails) throw new Error("PowerShell didn't start it");
    this.ownNvda.push(exe);
  }

  /** The driver's restartNvdaDetached(): the same without waiting, as the process exits. */
  restartNvdaDetached(exe: string): void {
    this.restarts.push(exe);
    this.events.push(`own-nvda:restart-detached:${exe}`);
    if (this.restartFails) throw new Error("spawn EINVAL");
    this.ownNvda.push(exe);
  }

  /** The driver's readNvdaLog(): NVDA's log as it is now. Every read is in `events`. */
  readNvdaLog(): Promise<string | null> {
    this.events.push("nvda-log:read");
    return this.nvdaLog instanceof Error
      ? Promise.reject(this.nvdaLog)
      : Promise.resolve(this.nvdaLog);
  }

  /** NVDA says `text` aloud from now: it takes SPEECH_MS, and QUIET_MS of quiet follow it. */
  say(text: Speech, by: FakeSound["by"]): void {
    if (text.trim() === "") return;
    const from = this.clockMs;
    this.clockMs += SPEECH_MS;
    this.sounds.push({ from, to: this.clockMs, text, by });
    this.clockMs += QUIET_MS;
  }

  /**
   * A browser opens or is raised: the window behind it is in front for a moment, and NVDA reads it.
   * Nothing is said when nothing is behind the browser (behind is null).
   */
  handOver(): void {
    if (this.behind !== null)
      this.say(`${this.behind.title}, window. ${this.behind.text}`, "behind");
  }

  /**
   * The driver's removeNvdaLog(): NVDA's log is deleted, unless another program holds it
   * (nvdaLogHeld), and then it stays. It never fails. Every call is in `events`.
   */
  removeNvdaLog(): Promise<void> {
    this.events.push("nvda-log:remove");
    if (!this.nvdaLogHeld) this.nvdaLog = null;
    return Promise.resolve();
  }

  /** Which window is in front. The browser's page sees every switch away as a focus loss. */
  get front(): "browser" | "other" {
    return this.frontWindow;
  }

  set front(value: "browser" | "other") {
    if (this.frontWindow === "browser" && value === "other") this.frontBrowser?.loseFocus();
    this.frontWindow = value;
    this.changed();
  }

  /** The title of the window in front, as NVDA+T reports it and Windows gives it. */
  get frontTitle(): string {
    return this.front === "browser"
      ? `${this.frontBrowser?.title ?? ""} - Google Chrome`
      : this.otherTitle;
  }

  /**
   * What NVDA+T says: the title of the window in front, or, while oldTitleReads lasts and the
   * browser is in front, its window's title from before its page's title last changed.
   */
  reportTitle(): Speech {
    const browser = this.frontBrowser;
    let title = this.frontTitle;
    if (this.front === "browser" && browser !== undefined && this.oldTitleReads > 0) {
      this.oldTitleReads--;
      title = `${browser.titleBefore} - Google Chrome`;
    }
    this.titlesRead.push(title);
    this.say(title, this.front === "browser" ? "browser" : "other");
    return title;
  }

  /**
   * The driver's foregroundWindow(): the process, program, and title of the window in front, which
   * is the newest browser's when the browser is in front. None where no browser has started.
   */
  foregroundWindow(): Promise<ForegroundWindow | null> {
    this.events.push("foreground:look");
    if (this.front === "other") {
      return Promise.resolve({
        pid: this.otherPid,
        program: this.otherProgram,
        title: this.otherTitle,
      });
    }
    const browser = this.frontBrowser;
    return Promise.resolve(
      browser ? { pid: browser.pid, program: "Google Chrome", title: this.frontTitle } : null,
    );
  }

  /** Whether the window in front keeps NVDA talking. */
  keepsNvdaTalking(): boolean {
    if (this.front === "other") return this.otherKeepsTalking;
    return this.pageKeepsTalking && this.frontBrowser !== undefined;
  }

  private readonly watchers: (() => void)[] = [];

  /** Call back whenever the window in front, or a browser, changes. */
  watch(watcher: () => void): void {
    this.watchers.push(watcher);
  }

  changed(): void {
    for (const watcher of this.watchers) watcher();
  }

  /** The browser whose window is in front whenever a browser is: the newest one still open. */
  get frontBrowser(): FakeSession | undefined {
    return this.sessions.filter((session) => !session.closed).at(-1);
  }

  /** The newest browser launched (open or not). */
  get session(): FakeSession {
    const session = this.sessions.at(-1);
    if (!session) throw new Error("no browser session");
    return session;
  }

  /** A key pressed by the user or NVDA lands in the window in front. */
  deliver(key: string): Speech {
    this.beforeKey?.(key);
    if (this.front !== "browser") {
      this.strayKeys.push(key);
      const reacts = `${this.otherTitle} reacts to ${key}`;
      this.say(reacts, "other");
      if (key === "exitFocusMode" && this.otherClosesOnEscape) {
        this.events.push("other:closed");
        this.raiseWorks = true;
        this.front = "browser";
      }
      return reacts;
    }
    this.events.push(`key:${key}`);
    const page = this.frontBrowser;
    if (!page) throw new Error("no browser open");
    return page.receive(key);
  }
}

export class FakeNvda implements NvdaControl {
  readonly build = "0.2.1-2026.2";
  /** The process id Windows gives Guidepup's NVDA once it has started. */
  readonly pid = 5150;
  started = false;
  startOptions: { capture: CaptureMode; settings: Record<string, unknown> } | null = null;
  forceQuits = 0;
  /** Makes stop() hang until forceQuit() is called. */
  stopHangs = false;
  /** Holds start() until opened; shutting NVDA down directly meanwhile makes the start fail. */
  startGate: Gate | null = null;
  /**
   * forceQuit() doesn't end a start or stop under way, as with Guidepup's own: its start keeps
   * waiting for NVDA (and starts it again), and its stop still ends by quitting whichever NVDA runs.
   */
  outlivesForceQuit = false;
  /** NVDA doesn't start: start() fails, after Guidepup has shut any other NVDA down. */
  startFails = false;
  /** What start() fails with then: Guidepup's own message, unless a test gives another error. */
  startError: Error | null = null;
  /** NVDA died: keys sent through it go nowhere, and it says nothing. */
  crashed = false;
  private releaseStop: (() => void) | null = null;
  private failStart: (() => void) | null = null;
  /** Commands under way, which stop() waits for, as Guidepup's does. */
  private readonly commands = new Set<Promise<Speech>>();
  /** Commands waiting for NVDA to fall silent before sending their key. */
  private readonly silencing = new Set<{ resume: () => void; fail: () => void }>();
  settingsInEffect: Record<string, unknown> = {
    general: { language: "Windows", loggingLevel: "OFF" },
    speech: { synth: "oneCore" },
    virtualBuffers: { autoSayAllOnPageLoad: false },
    remote: { enabled: true },
  };

  constructor(private readonly desktop: FakeDesktop) {
    desktop.watch(() => {
      if (desktop.keepsNvdaTalking()) return;
      for (const command of [...this.silencing]) command.resume();
    });
  }

  start(options: { capture: CaptureMode; settings: Record<string, unknown> }): Promise<void> {
    this.desktop.events.push("nvda:start");
    // Guidepup's NVDA shuts down any other NVDA as it starts, the person's own included.
    this.desktop.ownNvda = [];
    this.startOptions = options;
    if (this.startFails) {
      return Promise.reject(this.startError ?? new Error("NVDA cannot be started"));
    }
    const gate = this.startGate;
    if (!gate) {
      this.started = true;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      this.failStart = () => {
        settled = true;
        reject(new Error("NVDA cannot be started"));
      };
      void gate.wait().then(() => {
        if (settled) return;
        this.failStart = null;
        this.started = true;
        resolve();
      });
    });
  }

  /** Like Guidepup's stop: it waits for the commands under way. */
  async stop(): Promise<void> {
    this.desktop.events.push("nvda:stop");
    await Promise.allSettled([...this.commands]);
    if (this.stopHangs) {
      await new Promise<void>((resolve) => {
        this.releaseStop = resolve;
      });
    }
    this.started = false;
  }

  /**
   * Lets a stop that's still hanging (stopHangs, outliving forceQuit()) finish, ending as
   * Guidepup's does: by quitting whichever NVDA is running, the person's own included.
   */
  finishStop(): void {
    this.desktop.ownNvda = [];
    this.releaseStop?.();
  }

  forceQuit(): void {
    this.forceQuits++;
    this.desktop.events.push("nvda:force-quit");
    this.started = false;
    if (!this.outlivesForceQuit) {
      this.releaseStop?.();
      this.failStart?.();
      this.failStart = null;
    }
    for (const command of [...this.silencing]) command.fail();
  }

  press(key: NvdaKey, options: { capture?: boolean } = {}): Promise<Speech> {
    const command = this.run(key, options);
    this.commands.add(command);
    const done = () => this.commands.delete(command);
    command.then(done, done);
    return command;
  }

  private async run(key: NvdaKey, options: { capture?: boolean }): Promise<Speech> {
    if (!this.started) throw new Error("NVDA is not running");
    if (this.crashed || this.desktop.locked) return "";
    // Guidepup silences NVDA before a captured command's key, waiting while something keeps
    // NVDA talking; the key then goes to whichever window is in front by then.
    if (options.capture !== false && this.desktop.keepsNvdaTalking()) {
      this.desktop.events.push(`hung:${key}`);
      await new Promise<void>((resolve, reject) => {
        const command = {
          resume: () => {
            this.silencing.delete(command);
            resolve();
          },
          fail: () => {
            this.silencing.delete(command);
            reject(new Error("Cannot connect to NVDA"));
          },
        };
        this.silencing.add(command);
      });
    }
    if (key === "reportTitle") {
      const title = this.desktop.reportTitle();
      return options.capture === false ? "" : title;
    }
    const spoken = this.desktop.deliver(key);
    return options.capture === false ? "" : spoken;
  }

  async speechDuring(action: () => Promise<void>): Promise<Speech> {
    await action();
    return this.crashed || this.desktop.locked ? "" : (this.desktop.frontBrowser?.lastSpoken ?? "");
  }

  isRunning(): Promise<boolean> {
    return Promise.resolve(this.started && !this.crashed);
  }

  settings(): Record<string, unknown> {
    return this.settingsInEffect;
  }
}

export interface FakePage {
  finalUrl?: string;
  status?: number | null;
  contentType?: string | null;
  title?: string;
  /** The address of the page's canonical tag, as the browser reports it (default: no tag). */
  canonical?: string;
  /**
   * What taking a screenshot of the page gives: the JPEG's bytes, or the error the browser fails
   * with (default: a tiny picture).
   */
  screenshot?: Uint8Array | Error;
  /**
   * What checking the page with axe gives: what the page hands back (default: axe's results, with
   * nothing found), the Error the browser fails with, or AXE_HANGS, for a check that never finishes.
   */
  axe?: unknown;
}

export class FakeSession implements BrowserSession {
  readonly name = "Chrome";
  readonly version: string;
  /** The browser's process id: each browser launched has its own, counting up from 6001. */
  readonly pid: number;
  title = "";
  /** The page's title before it last changed (see FakeDesktop.oldTitleReads). */
  titleBefore = "";
  /** The loaded page's canonical tag: null when it has none. */
  canonical: string | null = null;
  closed = false;
  killed = false;
  loaded: string[] = [];
  /** The time limit given with each load (0: none). */
  loadTimeouts: number[] = [];
  /** Holds the next focus readings until opened. */
  focusGate: Gate | null = null;
  /** Holds close() until opened. */
  closeGate: Gate | null = null;
  /** Whether the window has really been in front (Chrome's focus reports are wrong before). */
  private activated: boolean;
  /** Focus is in Chrome's own toolbar (Tab went past the last element). */
  inToolbar = false;
  /** Tabs pressed inside the page through Chrome rather than NVDA. */
  chromeTabs = 0;
  /** The script each check with axe ran in the page, in order. */
  readonly axeScripts: string[] = [];
  lastSpoken: Speech = "";
  focused: FocusedElement | null = null;
  /** Called when a Tab moves focus; return true to put focus in the toolbar. */
  tabLeavesPage: (tabNumber: number) => boolean = () => false;
  private tabs = 0;
  private losses = 0;

  constructor(
    private readonly desktop: FakeDesktop,
    private readonly pages: Record<string, FakePage>,
  ) {
    this.activated = desktop.front === "browser";
    this.version = desktop.browserVersion;
    this.pid = 6001 + desktop.sessions.length;
  }

  load(url: string, timeoutMs: number): Promise<LoadResult> {
    this.loaded.push(url);
    this.loadTimeouts.push(timeoutMs);
    const page = this.pages[url] ?? {};
    this.title = page.title ?? "Fake page";
    this.canonical = page.canonical ?? null;
    this.inToolbar = false;
    this.tabs = 0;
    return Promise.resolve({
      finalUrl: page.finalUrl ?? url,
      status: page.status === undefined ? 200 : page.status,
      contentType: page.contentType === undefined ? "text/html; charset=utf-8" : page.contentType,
    });
  }

  waitUntilReady(): Promise<void> {
    return Promise.resolve();
  }

  pageTitle(): Promise<string> {
    return Promise.resolve(this.title);
  }

  pageCanonical(): Promise<string | null> {
    return Promise.resolve(this.canonical);
  }

  /**
   * A picture of the page loaded last, which is the page it takes: asked before a page has loaded,
   * it fails. It never brings the window forward.
   */
  screenshot(): Promise<Uint8Array> {
    this.desktop.events.push("screenshot");
    const url = this.loaded.at(-1);
    if (url === undefined) return Promise.reject(new Error("No page has loaded yet."));
    const shot = this.pages[url]?.screenshot ?? TINY_JPEG;
    return shot instanceof Error ? Promise.reject(shot) : Promise.resolve(shot);
  }

  /**
   * axe's check of the page loaded last, with the script it was given to run there: asked before a
   * page has loaded, it fails. It never brings the window forward or presses a key.
   */
  runAxe(script: string): Promise<unknown> {
    this.desktop.events.push("axe");
    this.axeScripts.push(script);
    const url = this.loaded.at(-1);
    if (url === undefined) return Promise.reject(new Error("No page has loaded yet."));
    const answer = this.pages[url]?.axe ?? rawAxe();
    if (answer === AXE_HANGS) return new Promise(() => {});
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  }

  setTitle(title: string): Promise<() => Promise<void>> {
    const previous = this.title;
    this.titleBefore = previous;
    this.title = title;
    this.desktop.events.push(`title:${title}`);
    return Promise.resolve(() => {
      this.titleBefore = this.title;
      this.title = previous;
      this.desktop.events.push(`title:${previous}`);
      return Promise.resolve();
    });
  }

  async focusState(): Promise<{ focused: boolean; losses: number }> {
    await this.focusGate?.wait();
    if (this.desktop.front === "browser") this.activated = true;
    const focused = this.activated ? this.desktop.front === "browser" && !this.inToolbar : true;
    return { focused, losses: this.losses };
  }

  /** The page's window lost focus (a blur event). */
  loseFocus(): void {
    if (this.activated) this.losses++;
  }

  /** The page reloads itself (a meta refresh, say): the page's focus-loss counter starts over. */
  reloadDocument(): void {
    this.losses = 0;
  }

  raise(): Promise<void> {
    this.desktop.events.push("raise");
    // Raising minimizes the window and restores it: meanwhile, the window behind it is in front.
    this.desktop.handOver();
    if (this.desktop.raiseFailures > 0) {
      this.desktop.raiseFailures--;
    } else if (this.desktop.raiseWorks) {
      this.desktop.front = "browser";
      this.activated = true;
    }
    return Promise.resolve();
  }

  pressTab(): Promise<void> {
    this.chromeTabs++;
    this.desktop.events.push("chrome:Tab");
    this.lastSpoken = this.receive("tab");
    return Promise.resolve();
  }

  focusedElement(): Promise<FocusedElement | null> {
    return Promise.resolve(this.focused);
  }

  async close(): Promise<void> {
    this.desktop.events.push("browser:close");
    await this.closeGate?.wait();
    const wasInFront = this === this.desktop.frontBrowser && this.desktop.front === "browser";
    this.closed = true;
    // The browser in front went away: Windows brings another window forward.
    if (wasInFront) this.desktop.front = "other";
    this.desktop.changed();
  }

  abandon(): void {
    this.closed = true;
    this.killed = true;
    this.desktop.events.push("browser:kill");
  }

  /** A key reaching the page: what NVDA says of it, aloud on the desktop. */
  receive(key: string): Speech {
    if (key === "tab") {
      this.tabs++;
      if (this.tabLeavesPage(this.tabs)) {
        this.inToolbar = true;
        this.loseFocus();
      }
    }
    this.lastSpoken = this.desktop.speech(key, this);
    this.desktop.say(this.lastSpoken, this.desktop.front === "browser" ? "browser" : "other");
    return this.lastSpoken;
  }
}
