import type {
  BrowserSession,
  LoadResult,
  NvdaControl,
  NvdaKey,
} from "../../src/drivers/guidepup-nvda.js";
import type { CaptureMode, FocusedElement, Speech } from "../../src/drivers/types.js";

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
 * - Chrome reports that its page has focus until its window has really been in front at least
 *   once, even while another window is in front.
 */
export class FakeDesktop {
  private frontWindow: "browser" | "other" = "browser";
  otherTitle = "Inbox - Outlook";
  /** Whether asking the browser window to come forward works. */
  raiseWorks = true;
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

  /** Which window is in front. The browser's page sees every switch away as a focus loss. */
  get front(): "browser" | "other" {
    return this.frontWindow;
  }

  set front(value: "browser" | "other") {
    if (this.frontWindow === "browser" && value === "other") this.frontBrowser?.loseFocus();
    this.frontWindow = value;
    this.changed();
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
      return `${this.otherTitle} reacts to ${key}`;
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
    if (this.startFails) return Promise.reject(new Error("NVDA cannot be started"));
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
      const title =
        this.desktop.front === "browser"
          ? `${this.desktop.frontBrowser?.title ?? ""} - Google Chrome`
          : this.desktop.otherTitle;
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
}

export class FakeSession implements BrowserSession {
  readonly name = "Chrome";
  readonly version: string;
  /** The browser's process id: each browser launched has its own, counting up from 6001. */
  readonly pid: number;
  title = "";
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

  setTitle(title: string): Promise<() => Promise<void>> {
    const previous = this.title;
    this.title = title;
    this.desktop.events.push(`title:${title}`);
    return Promise.resolve(() => {
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
    if (this.desktop.raiseWorks) {
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

  /** A key reaching the page. */
  receive(key: string): Speech {
    if (key === "tab") {
      this.tabs++;
      if (this.tabLeavesPage(this.tabs)) {
        this.inToolbar = true;
        this.loseFocus();
      }
    }
    this.lastSpoken = this.desktop.speech(key, this);
    return this.lastSpoken;
  }
}
