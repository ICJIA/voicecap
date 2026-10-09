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

import {
  chromium,
  errors,
  type Browser,
  type CDPSession,
  type Page,
  type Response,
} from "playwright";

import { AXE_TAGS } from "../../axe/results.js";
import type { VoicecapConfig } from "../../config/schema.js";
import { EnvironmentError, errorMessage } from "../../util/errors.js";
import { formatDuration } from "../../util/time.js";
import type { BrowserSession, FocusState, LoadResult } from "../guidepup-nvda.js";
import { BROWSER_WINDOW, type FocusedElement } from "../types.js";
import { envValue, PROFILE_PREFIX } from "./paths.js";
import { closeBrowsersUsing } from "./windows.js";

/** A screenshot is a JPEG at this quality: small enough to keep with every page, and still legible. */
const SCREENSHOT_QUALITY = 60;
/** It's taken at half the page's CSS size. */
const SCREENSHOT_SCALE = 0.5;
/**
 * The screen's pixels for each CSS pixel can be no fewer than this, and no more than the next: from
 * a screen at 50% to one at 400%, beyond any Windows scaling voicecap's window is likely to meet. A
 * ratio past them is taken as the nearer, so no reading can make a picture huge, or a speck.
 */
const LEAST_PIXEL_RATIO = 0.5;
const MOST_PIXEL_RATIO = 4;
/** How long the browser gets to answer before the screenshot is given up. */
const SCREENSHOT_TIMEOUT_MS = 5_000;

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
  /** Playwright's own Chromium, downloaded into the user's folder rather than installed. */
  playwrightBuild?: boolean;
}

/**
 * The browser to run: the configured channel's installed browser, else (with fallbackToChromium)
 * Playwright's Chromium. The channel "chromium" means Playwright's Chromium. When there's none to
 * run, the error is coded "browser": each page's launch asks, so a browser uninstalled mid-run
 * fails the next page as the browser's problem.
 */
export function resolveBrowser(
  config: VoicecapConfig["browser"],
  env: NodeJS.ProcessEnv,
  exists: (file: string) => boolean = existsSync,
  chromiumPath: string = chromium.executablePath(),
): BrowserExecutable {
  const playwrightChromium = { name: "Chromium", path: chromiumPath, playwrightBuild: true };
  const installChromium = `Install Playwright's Chromium with: npx @icjia/voicecap setup`;
  if (config.channel === "chromium") {
    if (exists(chromiumPath)) return playwrightChromium;
    throw new EnvironmentError(`Playwright's Chromium isn't installed. ${installChromium}`, {
      failure: "browser",
    });
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
      { failure: "browser" },
    );
  }
  const fix = config.fallbackToChromium
    ? `Install ${wanted}, or ${installChromium.charAt(0).toLowerCase()}${installChromium.slice(1)}`
    : `Install ${wanted}, or set browser.fallbackToChromium in voicecap.config to use Playwright's Chromium`;
  throw new EnvironmentError(
    `${wanted} isn't installed (looked in ${candidates.join(", ") || "its usual folders"}). ${fix}.`,
    { failure: "browser" },
  );
}

export interface LaunchChromeOptions {
  browser: VoicecapConfig["browser"];
  env: NodeJS.ProcessEnv;
  /** Extra command-line switches (the tests run headless). */
  extraArgs?: string[];
  /** How long Chrome gets to start and accept the connection. */
  timeoutMs?: number;
  /** Calls the launch off: a browser that's still starting is killed, and the launch fails. */
  signal?: AbortSignal;
  /** Starts the browser's process: spawn(), unless a test's. */
  spawnBrowser?: (file: string, args: string[]) => ChildProcess;
  /** Says that the browser handed over to a new copy of itself as it started, and starts again. */
  onRelaunch?: (notice: string) => void;
}

/**
 * The browser voicecap started exited before it was ready, with this exit code (or signal). With
 * 0, it handed over to a new copy of itself: Chrome does that to finish installing an update it had
 * waiting, when no other Chrome is open (seen on Windows 11, Chrome 153 to 154), and the new copy
 * goes on with voicecap's profile.
 */
class BrowserExited extends Error {
  constructor(readonly code: number | NodeJS.Signals | null) {
    super(`it exited (${code ?? ""})`);
  }
}

/** The first start handed over; the launch starts the browser again, once. */
class HandedOver extends Error {}

/**
 * Start a browser with a new profile, attached through Playwright. A browser that hands over to a
 * new copy of itself as it starts is started again, once, after that copy is closed.
 */
export async function launchChrome(options: LaunchChromeOptions): Promise<ChromeSession> {
  const executable = resolveBrowser(options.browser, options.env);
  try {
    return await launchOnce(executable, options, { last: false });
  } catch (error) {
    if (!(error instanceof HandedOver)) throw error;
    options.onRelaunch?.(
      `${executable.name} handed over to a new copy of itself as it started, as it does to finish installing an update. voicecap closed that copy and is starting ${executable.name} again.`,
    );
    return launchOnce(executable, options, { last: true });
  }
}

async function launchOnce(
  executable: BrowserExecutable,
  options: LaunchChromeOptions,
  attempt: { last: boolean },
): Promise<ChromeSession> {
  const { signal } = options;
  if (signal?.aborted) {
    throw new EnvironmentError(`${executable.name} wasn't started: the launch was called off.`, {
      failure: "browser",
    });
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  const profileDir = mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  const spawnBrowser =
    options.spawnBrowser ?? ((file, args) => spawn(file, args, { stdio: "ignore" }));
  const child = spawnBrowser(executable.path, [
    ...chromeArgs(profileDir, executable),
    ...(options.extraArgs ?? []),
    "about:blank",
  ]);
  const spawnError = new Promise<never>((_, reject) => child.once("error", reject));
  spawnError.catch(() => {});
  let callOff = () => {};
  const calledOff = new Promise<never>((_, reject) => {
    callOff = () => {
      child.kill();
      reject(new Error("the launch was called off"));
    };
  });
  calledOff.catch(() => {});
  signal?.addEventListener("abort", callOff, { once: true });
  try {
    const port = await Promise.race([
      readDevToolsPort(profileDir, child, timeoutMs),
      spawnError,
      calledOff,
    ]);
    const browser = await Promise.race([
      chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        noDefaults: true,
        timeout: timeoutMs,
      }),
      calledOff,
    ]);
    const context = browser.contexts()[0];
    if (!context) throw new Error("the browser has no default context");
    // Playwright leaves downloads alone for a browser it attaches to without defaults: a page
    // that answers with a download mustn't put files in the user's Downloads folder.
    const browserCdp = await browser.newBrowserCDPSession();
    await browserCdp.send("Browser.setDownloadBehavior", { behavior: "deny" });
    const page = context.pages()[0] ?? (await context.newPage());
    const cdp = await context.newCDPSession(page);
    if (signal?.aborted) throw new Error("the launch was called off");
    return new ChromeSession(executable, child, profileDir, browser, page, cdp);
  } catch (error) {
    child.kill();
    // The new copy a browser handed over to has this profile open: close it, so the profile can go.
    const handedOver = error instanceof BrowserExited && error.code === 0;
    if (handedOver && process.platform === "win32") await closeBrowsersUsing(profileDir);
    await removeProfile(profileDir);
    if (handedOver && !attempt.last) throw new HandedOver();
    throw new EnvironmentError(`${executable.name} didn't start: ${errorMessage(error)}`, {
      cause: error,
      failure: "browser",
    });
  } finally {
    signal?.removeEventListener("abort", callOff);
  }
}

/**
 * The browser's command line. Playwright's own Chromium keeps its sandboxes except the network
 * service's: Chrome's sandbox can't read the download (a user folder, with no access for app
 * containers), so that service would crash as the browser starts and restart, aborting a page
 * load under way. Seen on GitHub's Windows runners, then on a Windows 11 PC. An installed Chrome or
 * Edge keeps every sandbox.
 *
 * On macOS, --use-mock-keychain keeps the browser out of the login keychain: otherwise it asks for
 * its Safe Storage key as the profile's cookie store opens, macOS may show an approval dialog, and
 * every page load waits for the answer (seen on a Mac; Playwright passes the switch too). Other
 * platforms ignore it.
 */
export function chromeArgs(profileDir: string, executable: BrowserExecutable): string[] {
  const disabled = executable.playwrightBuild
    ? [...DISABLED_FEATURES, "NetworkServiceSandbox"]
    : DISABLED_FEATURES;
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
    "--use-mock-keychain",
    `--disable-features=${disabled.join(",")}`,
    `--window-size=${BROWSER_WINDOW.width},${BROWSER_WINDOW.height}`,
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
    // A browser that was killed has a signal instead of an exit code (on Windows too).
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new BrowserExited(child.exitCode ?? child.signalCode);
    }
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
 * Counts the times the page's window lost focus, so a loss is noticed even when focus has come
 * back (the user clicked another window, then the browser again). Only blur events on the window
 * itself are seen; focus moving between elements doesn't reach this listener. Focus moving into
 * a frame also blurs the window, but the page still has focus then, so it doesn't count.
 * (While focus is inside a frame, a switch to another window blurs the frame's window instead;
 * the page not having focus afterwards still shows a switch that lasted.)
 */
const WATCH_FOCUS = `(() => {
  if (typeof window.__voicecapFocusLosses !== "number") {
    window.__voicecapFocusLosses = 0;
    window.addEventListener("blur", (event) => {
      if (event.target === window && !document.hasFocus()) window.__voicecapFocusLosses += 1;
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
  /** An element can be removed, and a link has its address (as the browser resolved it). */
  querySelector(selector: string): { remove(): void; href?: string } | null;
}

/** The isolated world axe runs in, on the page's main frame, apart from the page's own scripts. */
const AXE_WORLD = "voicecap-axe";

/**
 * Called in axe's world once axe-core's script has run there: axe checks the page's document with
 * the rules of `tags`. Its results come back as JSON made with that world's own JSON, which the
 * page's scripts can't reach. As one string, they come back whole, however deeply they nest.
 */
const RUN_AXE = `function (tags) {
  return axe.run(document, {
    runOnly: { type: "tag", values: tags },
    resultTypes: ["violations", "incomplete"],
  }).then((results) => JSON.stringify(results));
}`;

/**
 * What Playwright says when the network won't take a navigation: the first line reads "page.goto:
 * net::ERR_NAME_NOT_RESOLVED at https://example.gov/", and a call log follows.
 */
const NETWORK_ERROR = /^(?:page\.goto: )?(net::ERR_[^\r\n]*)/;

/**
 * A navigation the network refused (a name that doesn't resolve, a refused or reset connection, an
 * unreachable address, no internet, and the like) as an EnvironmentError coded "unreachable": the
 * website couldn't be reached, whether that's the website's fault or the network's. Any other
 * error is returned as it is.
 */
function asUnreachable(error: unknown): unknown {
  const detail = error instanceof Error ? NETWORK_ERROR.exec(error.message)?.[1] : undefined;
  if (detail === undefined) return error;
  return new EnvironmentError(`The page couldn't be reached: ${detail}`, {
    cause: error,
    failure: "unreachable",
  });
}

export class ChromeSession implements BrowserSession {
  readonly name: string;
  readonly version: string;
  private closing: Promise<void> | null = null;
  /** Whether the page crashed (Chrome's "Aw, Snap!"). A crashed page isn't closed. */
  private crashed = false;

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
    page.on("crash", () => {
      this.crashed = true;
    });
  }

  /**
   * The browser's process id: the run's event log keeps it, and the Mac live test raises it
   * through System Events.
   */
  get pid(): number | undefined {
    return this.child.pid;
  }

  load(url: string, timeoutMs: number): Promise<LoadResult> {
    return this.onPage(async () => {
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
          if (!mainResponse) throw asUnreachable(error);
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
    });
  }

  /**
   * Wait for the page to go quiet, and for the configured readySelector. A readySelector that
   * doesn't appear in time is coded "open-timeout": the page didn't open in time.
   */
  waitUntilReady(readiness: VoicecapConfig["readiness"]): Promise<void> {
    return this.onPage(async () => {
      await this.page
        .waitForLoadState("networkidle", { timeout: readiness.networkIdleTimeoutMs })
        .catch(() => {
          // Pages that poll or stream never go idle; they're transcribed as they are.
        });
      const selector = readiness.readySelector;
      if (selector) {
        const timeout = readiness.networkIdleTimeoutMs;
        await this.page
          .waitForSelector(selector, { state: "attached", timeout })
          .catch((error: unknown) => {
            // A selector the browser can't read fails at once, and Playwright's words say why.
            if (!(error instanceof errors.TimeoutError)) throw error;
            throw new EnvironmentError(
              `The readySelector "${selector}" didn't appear within ${formatDuration(timeout)}.`,
              { cause: error, failure: "open-timeout" },
            );
          });
      }
      if (readiness.settleMs > 0) await delay(readiness.settleMs);
    });
  }

  pageTitle(): Promise<string> {
    return this.onPage(() => this.page.title());
  }

  pageCanonical(): Promise<string | null> {
    // This function runs in the page (voicecap's own code is compiled without DOM types). A link's
    // `href` is the address resolved against the page's own, and "" when the tag has none.
    return this.onPage(() =>
      this.page.evaluate(() => {
        const doc = (globalThis as unknown as { document: PageDocument }).document;
        const href = doc.querySelector('link[rel~="canonical" i]')?.href;
        return href === undefined || href === "" ? null : href;
      }),
    );
  }

  /**
   * What shows in the window now, as a JPEG at half the page's CSS size. It uses the DevTools
   * connection and nothing else, so it never brings the window forward or takes focus. The browser
   * gets five seconds to answer: a call that hangs can't be stopped, so it's left behind.
   */
  screenshot(): Promise<Uint8Array> {
    return this.onPage(() =>
      withinLimit(
        this.capture(),
        SCREENSHOT_TIMEOUT_MS,
        `timed out after ${formatDuration(SCREENSHOT_TIMEOUT_MS)}`,
      ),
    );
  }

  private async capture(): Promise<Uint8Array> {
    // The window's visible page: its viewport (without scrollbars), where the page is scrolled to,
    // in CSS pixels, and the same viewport in the screen's own pixels, which Chromium still gives
    // though it calls them deprecated: one it no longer gives is taken as unscaled.
    const metrics = await this.cdp.send("Page.getLayoutMetrics");
    const view = metrics.cssLayoutViewport;
    const onScreen = (metrics as { layoutViewport?: { clientWidth?: unknown } }).layoutViewport;
    const { data } = await this.cdp.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: SCREENSHOT_QUALITY,
      clip: {
        x: view.pageX,
        y: view.pageY,
        width: view.clientWidth,
        height: view.clientHeight,
        // The scale counts the screen's own pixels: at a scale of 1, a screen at 200% gives 2 pixels
        // for each CSS pixel. Dividing by the screen's ratio keeps the picture at half the page's CSS
        // size on a scaled display, as at 100% (where the ratio is 1).
        scale: SCREENSHOT_SCALE / pixelRatio(onScreen?.clientWidth, view.clientWidth),
      },
      captureBeyondViewport: false,
    });
    return Buffer.from(data, "base64");
  }

  /**
   * axe-core's results for the page as it is now. Everything goes through the DevTools connection,
   * in an isolated world of axe's own on the page's main frame: it shares the page's document, but
   * not its scripts' globals.
   * - Nothing is added to the page's own world: no `axe`, none of axe's listeners, and no module
   *   registered with a loader of the page's.
   * - The page's own scripts can't break axe there, by changing what JavaScript's built-ins do or
   *   holding the name `axe`.
   * - `script`, axe-core's own, is the expression DevTools runs, not a `<script>` added to the page
   *   or a string evaluated in it, so neither a Content Security Policy nor Trusted Types stops it.
   *
   * Then axe runs the rules of AXE_TAGS. It gives every element it finds for the violations and
   * what needs review, and at most one for each rule that passed or didn't apply, which voicecap
   * only counts. axe reads the page: it moves no focus, scrolls nothing, and adds no element.
   *
   * A script that throws, and an axe whose promise is rejected, fail with what the page's world
   * said. There's no time limit here: the driver gives axe its own.
   */
  runAxe(script: string): Promise<unknown> {
    return this.onPage(async () => {
      const { frameTree } = await this.cdp.send("Page.getFrameTree");
      const { executionContextId } = await this.cdp.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: AXE_WORLD,
      });
      // DevTools answers a script that threw, or a promise that was rejected, with its details.
      const loaded = await this.cdp.send("Runtime.evaluate", {
        expression: script,
        contextId: executionContextId,
      });
      if (loaded.exceptionDetails) throw thrownIn(loaded.exceptionDetails);
      const ran = await this.cdp.send("Runtime.callFunctionOn", {
        functionDeclaration: RUN_AXE,
        executionContextId,
        arguments: [{ value: [...AXE_TAGS] }],
        awaitPromise: true,
        returnByValue: true,
      });
      if (ran.exceptionDetails) throw thrownIn(ran.exceptionDetails);
      const json: unknown = ran.result.value;
      if (typeof json !== "string") throw new Error("axe's results didn't come back");
      return JSON.parse(json) as unknown;
    });
  }

  async setTitle(title: string): Promise<() => Promise<void>> {
    // These functions run in the page (voicecap's own code is compiled without DOM types).
    const previous = await this.onPage(() =>
      this.page.evaluate((next) => {
        const doc = (globalThis as unknown as { document: PageDocument }).document;
        const had = doc.querySelector("title") !== null;
        const old = doc.title;
        doc.title = next;
        return { had, old };
      }, title),
    );
    return () =>
      this.onPage(() =>
        this.page.evaluate(({ had, old }) => {
          const doc = (globalThis as unknown as { document: PageDocument }).document;
          doc.title = old;
          if (!had) doc.querySelector("title")?.remove();
        }, previous),
      );
  }

  focusState(): Promise<FocusState> {
    return this.onPage(() => this.page.evaluate<FocusState>(FOCUS_STATE));
  }

  raise(): Promise<void> {
    return this.onPage(async () => {
      const { windowId } = await this.cdp.send("Browser.getWindowForTarget");
      await this.cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "minimized" },
      });
      await delay(300);
      await this.cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "normal" },
      });
      await this.page.bringToFront();
      await delay(500);
    });
  }

  pressTab(): Promise<void> {
    return this.onPage(() => this.page.keyboard.press("Tab"));
  }

  focusedElement(): Promise<FocusedElement | null> {
    return this.onPage(async () => {
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
    });
  }

  /**
   * Do `work` on the page. When it fails because the browser has gone (its window was closed, it
   * quit or crashed, or the page crashed), the failure says so, coded "browser": Playwright's own
   * words ("Target page, context or browser has been closed", "Target crashed") would read as a
   * fault in voicecap. Any other failure is thrown as it is.
   */
  private async onPage<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw this.gone(error) ?? error;
    }
  }

  /** What `error` becomes when the browser has gone: null while it's still there. */
  private gone(error: unknown): EnvironmentError | null {
    if (this.crashed) {
      return new EnvironmentError(`The page crashed in ${this.name} while voicecap was using it.`, {
        cause: error,
        failure: "browser",
      });
    }
    if (this.page.isClosed() || !this.browser.isConnected()) {
      return new EnvironmentError(
        `${this.name} closed while voicecap was using it: its window was closed, or it crashed.`,
        { cause: error, failure: "browser" },
      );
    }
    return null;
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

/**
 * What a script threw in the page, or why its promise was rejected, as DevTools describes it
 * ("TypeError: …", with the page's stack), or in DevTools' own words when what was thrown has no
 * description ("Uncaught (in promise) undefined").
 */
function thrownIn(details: { text: string; exception?: { description?: string } }): Error {
  return new Error(details.exception?.description || details.text);
}

/**
 * The screen's pixels for each CSS pixel of the page, 1 at 100% and 1.5 at 150%: the viewport's
 * width in the screen's pixels (`screen`, the layout metrics' own) over its width in CSS pixels
 * (`css`), as the browser reports them. Never the page's `devicePixelRatio`, which the page's own
 * script can change. 1 when the browser gives no width to go by, and kept between the least and the
 * most a screen has (LEAST_PIXEL_RATIO, MOST_PIXEL_RATIO).
 */
function pixelRatio(screen: unknown, css: unknown): number {
  const width = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  const [onScreen, inCss] = [width(screen), width(css)];
  if (onScreen === null || inCss === null) return 1;
  return Math.min(MOST_PIXEL_RATIO, Math.max(LEAST_PIXEL_RATIO, onScreen / inCss));
}

/**
 * `work`, or a rejection with `message` once `ms` have passed without it finishing. The work isn't
 * stopped: what it gives or throws later is ignored.
 */
export function withinLimit<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
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
