import type {
  BrowserSession,
  LoadResult,
  NvdaControl,
  NvdaKey,
} from "../../src/drivers/guidepup-nvda.js";
import type { CaptureMode, FocusedElement, Speech } from "../../src/drivers/types.js";

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
  /** Keys that reached a window that wasn't the browser: must stay empty. */
  readonly strayKeys: string[] = [];
  /** Everything that happened, in order, e.g. "alert", "nvda:start", "key:toTop". */
  readonly events: string[] = [];
  /** Sessions launched, newest last. */
  readonly sessions: FakeSession[] = [];
  /** Runs before a key reaches the browser, to simulate something stealing the foreground. */
  beforeKey: ((key: string) => void) | null = null;
  /** Speech for keys the browser receives; default "<key> speech". */
  speech: (key: string, session: FakeSession) => Speech = (key) => `${key} speech`;

  /** Which window is in front. The browser's page sees every switch away as a focus loss. */
  get front(): "browser" | "other" {
    return this.frontWindow;
  }

  set front(value: "browser" | "other") {
    if (this.frontWindow === "browser" && value === "other") this.sessions.at(-1)?.loseFocus();
    this.frontWindow = value;
  }

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
    return this.session.receive(key);
  }
}

export class FakeNvda implements NvdaControl {
  readonly build = "0.2.1-2026.2";
  started = false;
  startOptions: { capture: CaptureMode; settings: Record<string, unknown> } | null = null;
  forceQuits = 0;
  /** Makes stop() hang until forceQuit() is called. */
  stopHangs = false;
  private releaseStop: (() => void) | null = null;
  settingsInEffect: Record<string, unknown> = {
    general: { language: "Windows", loggingLevel: "OFF" },
    speech: { synth: "oneCore" },
    virtualBuffers: { autoSayAllOnPageLoad: false },
    remote: { enabled: true },
  };

  constructor(private readonly desktop: FakeDesktop) {}

  start(options: { capture: CaptureMode; settings: Record<string, unknown> }): Promise<void> {
    this.desktop.events.push("nvda:start");
    this.started = true;
    this.startOptions = options;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.desktop.events.push("nvda:stop");
    if (!this.stopHangs) {
      this.started = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.releaseStop = () => {
        this.started = false;
        resolve();
      };
    });
  }

  forceQuit(): void {
    this.forceQuits++;
    this.desktop.events.push("nvda:force-quit");
    this.releaseStop?.();
  }

  press(key: NvdaKey, options: { capture?: boolean } = {}): Promise<Speech> {
    if (!this.started) return Promise.reject(new Error("NVDA is not running"));
    if (
      options.capture !== false &&
      this.desktop.front === "other" &&
      this.desktop.otherKeepsTalking
    ) {
      this.desktop.events.push(`hung:${key}`);
      return new Promise(() => {});
    }
    if (key === "reportTitle") {
      const title =
        this.desktop.front === "browser"
          ? `${this.desktop.session.title} - Google Chrome`
          : this.desktop.otherTitle;
      return Promise.resolve(options.capture === false ? "" : title);
    }
    const spoken = this.desktop.deliver(key);
    return Promise.resolve(options.capture === false ? "" : spoken);
  }

  async speechDuring(action: () => Promise<void>): Promise<Speech> {
    await action();
    return this.desktop.session.lastSpoken;
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
}

export class FakeSession implements BrowserSession {
  readonly name = "Chrome";
  readonly version = "153.0.8010.53";
  title = "";
  closed = false;
  loaded: string[] = [];
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
  }

  load(url: string): Promise<LoadResult> {
    this.loaded.push(url);
    const page = this.pages[url] ?? {};
    this.title = page.title ?? "Fake page";
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

  focusState(): Promise<{ focused: boolean; losses: number }> {
    if (this.desktop.front === "browser") this.activated = true;
    const focused = this.activated ? this.desktop.front === "browser" && !this.inToolbar : true;
    return Promise.resolve({ focused, losses: this.losses });
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

  close(): Promise<void> {
    this.closed = true;
    this.desktop.events.push("browser:close");
    return Promise.resolve();
  }

  abandon(): void {
    this.closed = true;
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
