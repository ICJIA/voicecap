/**
 * The browser for the Guidepup driver: Chrome launched by voicecap and driven through Playwright.
 *
 * voicecap starts Chrome itself and attaches with connectOverCDP({ noDefaults: true }) instead of
 * using Playwright's launch(): Playwright otherwise emulates focus, so document.hasFocus() reports
 * true whatever is in front, and the driver relies on real focus to keep keystrokes out of other
 * windows. Each session gets a new profile (voicecap-chrome-* in the temp folder), so no page's
 * speech depends on the pages loaded before it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium, type Browser, type CDPSession, type Page, type Response } from "playwright";

import type { VoicecapConfig } from "../../config/schema.js";
import { EnvironmentError, errorMessage } from "../../util/errors.js";
import { formatDuration } from "../../util/time.js";
import type { BrowserSession, FocusState, LoadResult } from "../guidepup-nvda.js";
import type { FocusedElement } from "../types.js";
import { envValue, PROFILE_PREFIX } from "./paths.js";

/** A fixed window size, so pages lay out (and NVDA splits lines) the same way in every run. */
const WINDOW = { width: 1280, height: 960 };

/** Browser features that would add network noise or UI surprises to a run (as Playwright disables them). */
const DISABLED_FEATURES = [
  "Translate",
  "HttpsUpgrades",
  "MediaRouter",
  "DialMediaRouteProvider",
  "GlobalMediaControls",
  "LensOverlay",
  "OptimizationHints",
  "AutoDeElevate",
  "msForceBrowserSignIn",
];

/** Install folders per browser channel, as Playwright's registry looks for them on Windows. */
const CHANNEL_FOLDERS: Record<string, { folder: string; roots: ("local" | "pf" | "pf86")[] }> = {
  chrome: { folder: "Google\\Chrome", roots: ["local", "pf", "pf86"] },
  "chrome-beta": { folder: "Google\\Chrome Beta", roots: ["local", "pf", "pf86"] },
  "chrome-dev": { folder: "Google\\Chrome Dev", roots: ["local", "pf", "pf86"] },
  "chrome-canary": { folder: "Google\\Chrome SxS", roots: ["local"] },
  msedge: { folder: "Microsoft\\Edge", roots: ["pf86", "pf", "local"] },
  "msedge-beta": { folder: "Microsoft\\Edge Beta", roots: ["pf86", "pf", "local"] },
  "msedge-dev": { folder: "Microsoft\\Edge Dev", roots: ["pf86", "pf", "local"] },
  "msedge-canary": { folder: "Microsoft\\Edge SxS", roots: ["local"] },
};

const CHANNEL_NAMES: Record<string, string> = {
  chrome: "Chrome",
  "chrome-beta": "Chrome Beta",
  "chrome-dev": "Chrome Dev",
  "chrome-canary": "Chrome Canary",
  msedge: "Microsoft Edge",
  "msedge-beta": "Microsoft Edge Beta",
  "msedge-dev": "Microsoft Edge Dev",
  "msedge-canary": "Microsoft Edge Canary",
};

/** Where a browser channel's executable can be, most likely first. Unknown channels have none. */
export function browserCandidates(channel: string, env: NodeJS.ProcessEnv): string[] {
  const entry = CHANNEL_FOLDERS[channel];
  if (!entry) return [];
  const exe = channel.startsWith("msedge") ? "msedge.exe" : "chrome.exe";
  const roots = {
    local: envValue(env, "LOCALAPPDATA"),
    pf: envValue(env, "PROGRAMFILES"),
    pf86: envValue(env, "PROGRAMFILES(X86)"),
  };
  return entry.roots.flatMap((root) => {
    const base = roots[root];
    return base ? [path.win32.join(base, entry.folder, "Application", exe)] : [];
  });
}

export interface BrowserExecutable {
  name: string;
  path: string;
}

/**
 * The browser to run: the configured channel's installed browser, else (with fallbackToChromium)
 * Playwright's Chromium. The channel "chromium" means Playwright's Chromium.
 */
export function resolveBrowser(
  config: VoicecapConfig["browser"],
  env: NodeJS.ProcessEnv,
  exists: (file: string) => boolean = existsSync,
  chromiumPath: string = chromium.executablePath(),
): BrowserExecutable {
  const playwrightChromium = { name: "Chromium", path: chromiumPath };
  const installChromium = `Install Playwright's Chromium with: npx @icjia/voicecap setup`;
  if (config.channel === "chromium") {
    if (exists(chromiumPath)) return playwrightChromium;
    throw new EnvironmentError(`Playwright's Chromium isn't installed. ${installChromium}`);
  }
  const candidates = browserCandidates(config.channel, env);
  const found = candidates.find((candidate) => exists(candidate));
  if (found) return { name: CHANNEL_NAMES[config.channel] ?? config.channel, path: found };
  if (config.fallbackToChromium && exists(chromiumPath)) return playwrightChromium;

  const wanted =
    config.channel === "chrome" ? "Google Chrome" : (CHANNEL_NAMES[config.channel] ?? "");
  if (!wanted) {
    throw new EnvironmentError(
      `voicecap doesn't know the browser channel "${config.channel}". Use chrome, chrome-beta, chrome-dev, chrome-canary, msedge (or its -beta, -dev, -canary), or chromium.`,
    );
  }
  const fix = config.fallbackToChromium
    ? `Install ${wanted}, or ${installChromium.charAt(0).toLowerCase()}${installChromium.slice(1)}`
    : `Install ${wanted}, or set browser.fallbackToChromium in voicecap.config to use Playwright's Chromium`;
  throw new EnvironmentError(
    `${wanted} isn't installed (looked in ${candidates.join(", ") || "its usual folders"}). ${fix}.`,
  );
}

export interface LaunchChromeOptions {
  browser: VoicecapConfig["browser"];
  env: NodeJS.ProcessEnv;
  /** Extra command-line switches (the tests run headless). */
  extraArgs?: string[];
  /** How long Chrome gets to start and accept the connection. */
  timeoutMs?: number;
}

/** Start a browser with a new profile, attached through Playwright. */
export async function launchChrome(options: LaunchChromeOptions): Promise<ChromeSession> {
  const executable = resolveBrowser(options.browser, options.env);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const profileDir = mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  const child = spawn(
    executable.path,
    [...chromeArgs(profileDir), ...(options.extraArgs ?? []), "about:blank"],
    { stdio: "ignore" },
  );
  const spawnError = new Promise<never>((_, reject) => child.once("error", reject));
  spawnError.catch(() => {});
  try {
    const port = await Promise.race([readDevToolsPort(profileDir, child, timeoutMs), spawnError]);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
      noDefaults: true,
      timeout: timeoutMs,
    });
    const context = browser.contexts()[0];
    if (!context) throw new Error("the browser has no default context");
    const page = context.pages()[0] ?? (await context.newPage());
    const cdp = await context.newCDPSession(page);
    return new ChromeSession(executable, child, profileDir, browser, page, cdp);
  } catch (error) {
    child.kill();
    await removeProfile(profileDir);
    throw new EnvironmentError(`${executable.name} didn't start: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

function chromeArgs(profileDir: string): string[] {
  return [
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
    "--disable-component-update",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-breakpad",
    "--disable-client-side-phishing-detection",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-hang-monitor",
    "--disable-prompt-on-repost",
    "--disable-search-engine-choice-screen",
    "--metrics-recording-only",
    "--no-service-autorun",
    "--password-store=basic",
    `--disable-features=${DISABLED_FEATURES.join(",")}`,
    `--window-size=${WINDOW.width},${WINDOW.height}`,
    "--window-position=0,0",
  ];
}

/** Chrome writes its DevTools port to <profile>/DevToolsActivePort once it's listening. */
async function readDevToolsPort(
  profileDir: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<number> {
  const file = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`it exited with code ${child.exitCode}`);
    try {
      const port = Number(readFileSync(file, "utf8").split("\n")[0]?.trim());
      if (Number.isInteger(port) && port > 0) return port;
    } catch (error) {
      // Not written yet, or still being written (Windows holds it open: EBUSY).
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EBUSY" && code !== "EPERM") throw error;
    }
    await delay(50);
  }
  throw new Error(`it didn't open its DevTools port within ${formatDuration(timeoutMs)}`);
}

async function removeProfile(dir: string): Promise<void> {
  // Chrome's helper processes can hold files for a moment after it exits.
  await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
}

/** Finds the focused element, looking into shadow roots and same-origin frames; null for the body. */
const FOCUSED_ELEMENT = `(() => {
  let el = document.activeElement;
  for (;;) {
    if (el && el.shadowRoot && el.shadowRoot.activeElement) { el = el.shadowRoot.activeElement; continue; }
    if (el && (el.tagName === "IFRAME" || el.tagName === "FRAME")) {
      let inner = null;
      try { inner = el.contentDocument && el.contentDocument.activeElement; } catch (e) { inner = null; }
      if (inner && inner !== el.contentDocument.body) { el = inner; continue; }
    }
    break;
  }
  return el && el !== document.body && el !== document.documentElement ? el : null;
})()`;

/** Called on the focused element: its tag, link target, and whether it's inside the main landmark. */
const DESCRIBE_ELEMENT = `function () {
  const tag = this.tagName.toLowerCase();
  const href = (tag === "a" || tag === "area") && this.hasAttribute("href") ? this.getAttribute("href") : null;
  let node = this;
  let inMain = false;
  while (node) {
    if (node.closest && node.closest("main, [role=main]")) { inMain = true; break; }
    const root = node.getRootNode && node.getRootNode();
    if (root && root.host) { node = root.host; continue; }
    const view = node.ownerDocument && node.ownerDocument.defaultView;
    const frame = view ? view.frameElement : null;
    if (frame) { node = frame; continue; }
    break;
  }
  return { tag, href, inMain };
}`;

/**
 * Counts the page window's focus losses (blur events on the window itself; focus moving between
 * elements doesn't reach this listener). A loss is noticed even when focus has come back, as
 * when the user clicks another window and then the browser again.
 */
const WATCH_FOCUS = `(() => {
  if (typeof window.__voicecapFocusLosses !== "number") {
    window.__voicecapFocusLosses = 0;
    window.addEventListener("blur", (event) => {
      if (event.target === window) window.__voicecapFocusLosses += 1;
    });
  }
})()`;

const FOCUS_STATE = `({
  focused: document.hasFocus(),
  losses: typeof window.__voicecapFocusLosses === "number" ? window.__voicecapFocusLosses : 0,
})`;

interface AxValue {
  value?: unknown;
}

/** The little of the page's document the session touches. */
interface PageDocument {
  title: string;
  querySelector(selector: string): { remove(): void } | null;
}

export class ChromeSession implements BrowserSession {
  readonly name: string;
  readonly version: string;
  private closing: Promise<void> | null = null;

  constructor(
    executable: BrowserExecutable,
    private readonly child: ChildProcess,
    /** The session's own profile folder, deleted when it closes. */
    readonly profileDir: string,
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly cdp: CDPSession,
    private readonly options: { closeTimeoutMs?: number } = {},
  ) {
    this.name = executable.name;
    this.version = browser.version();
  }

  async load(url: string, timeoutMs: number): Promise<LoadResult> {
    // A download never commits, so goto() fails; the main response still tells what it was.
    let mainResponse: Response | null = null;
    const onResponse = (response: Response) => {
      const request = response.request();
      if (request.isNavigationRequest() && request.frame() === this.page.mainFrame()) {
        mainResponse = response;
      }
    };
    this.page.on("response", onResponse);
    try {
      let response: Response | null;
      try {
        response = await this.page.goto(url, { waitUntil: "load", timeout: timeoutMs });
      } catch (error) {
        if (!mainResponse) throw error;
        response = mainResponse;
      }
      // Count the window's focus losses from here on (not possible in a PDF viewer, say).
      await this.page.evaluate(WATCH_FOCUS).catch(() => {});
      if (!response) return { finalUrl: this.page.url(), status: null, contentType: null };
      return {
        finalUrl: response.url(),
        status: response.status(),
        contentType: response.headers()["content-type"] ?? null,
      };
    } finally {
      this.page.off("response", onResponse);
    }
  }

  async waitUntilReady(readiness: VoicecapConfig["readiness"]): Promise<void> {
    await this.page
      .waitForLoadState("networkidle", { timeout: readiness.networkIdleTimeoutMs })
      .catch(() => {
        // Pages that poll or stream never go idle; they're transcribed as they are.
      });
    const selector = readiness.readySelector;
    if (selector) {
      await this.page
        .waitForSelector(selector, { state: "attached", timeout: readiness.networkIdleTimeoutMs })
        .catch((error: unknown) => {
          throw new Error(
            `The readySelector "${selector}" didn't appear within ${formatDuration(readiness.networkIdleTimeoutMs)}.`,
            { cause: error },
          );
        });
    }
    if (readiness.settleMs > 0) await delay(readiness.settleMs);
  }

  pageTitle(): Promise<string> {
    return this.page.title();
  }

  async setTitle(title: string): Promise<() => Promise<void>> {
    // These functions run in the page (voicecap's own code is compiled without DOM types).
    const previous = await this.page.evaluate((next) => {
      const doc = (globalThis as unknown as { document: PageDocument }).document;
      const had = doc.querySelector("title") !== null;
      const old = doc.title;
      doc.title = next;
      return { had, old };
    }, title);
    return async () => {
      await this.page.evaluate(({ had, old }) => {
        const doc = (globalThis as unknown as { document: PageDocument }).document;
        doc.title = old;
        if (!had) doc.querySelector("title")?.remove();
      }, previous);
    };
  }

  focusState(): Promise<FocusState> {
    return this.page.evaluate<FocusState>(FOCUS_STATE);
  }

  async raise(): Promise<void> {
    const { windowId } = await this.cdp.send("Browser.getWindowForTarget");
    await this.cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });
    await delay(300);
    await this.cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    await this.page.bringToFront();
    await delay(500);
  }

  pressTab(): Promise<void> {
    return this.page.keyboard.press("Tab");
  }

  async focusedElement(): Promise<FocusedElement | null> {
    const { result } = await this.cdp.send("Runtime.evaluate", { expression: FOCUSED_ELEMENT });
    const objectId = result.objectId;
    if (!objectId) return null;
    try {
      const described = await this.cdp.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: DESCRIBE_ELEMENT,
        returnByValue: true,
      });
      const { tag, href, inMain } = described.result.value as {
        tag: string;
        href: string | null;
        inMain: boolean;
      };
      const { nodes } = await this.cdp.send("Accessibility.getPartialAXTree", {
        objectId,
        fetchRelatives: false,
      });
      const node = nodes.find((candidate) => !candidate.ignored) ?? nodes[0];
      const role = axString(node?.role);
      return { tag, role, name: axString(node?.name) ?? "", inMain, href };
    } finally {
      await this.cdp.send("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  }

  close(): Promise<void> {
    this.closing ??= this.shutDown();
    return this.closing;
  }

  abandon(): void {
    try {
      this.child.kill();
    } catch {
      // Already gone.
    }
  }

  private async shutDown(): Promise<void> {
    const exited =
      this.child.exitCode !== null || this.child.signalCode !== null
        ? Promise.resolve()
        : new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    // A graceful shutdown lets every helper process exit, so the profile can be deleted. It isn't
    // awaited: a browser that doesn't answer is killed once the wait below runs out.
    void this.browser
      .newBrowserCDPSession()
      .then((session) => session.send("Browser.close"))
      .catch(() => {});
    if (!(await settlesWithin(exited, this.options.closeTimeoutMs ?? 10_000))) {
      this.child.kill();
      await settlesWithin(exited, 5_000);
    }
    await settlesWithin(
      this.browser.close().catch(() => {}),
      5_000,
    );
    await removeProfile(this.profileDir);
  }
}

function axString(value: AxValue | undefined): string | null {
  return typeof value?.value === "string" ? value.value : null;
}

async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const timeout = new AbortController();
  try {
    return await Promise.race([
      promise.then(() => true),
      delay(ms, false, { signal: timeout.signal }).catch(() => false),
    ]);
  } finally {
    timeout.abort();
  }
}
