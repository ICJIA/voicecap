import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium, type Browser, type CDPSession, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import {
  chromeArgs,
  ChromeSession,
  launchChrome,
  resolveBrowser,
} from "../src/drivers/guidepup/chrome.js";
import { EnvironmentError } from "../src/util/errors.js";
import { startFixtureServer, type FixtureServer } from "../scripts/serve-fixture.js";

// Real Chromium (Playwright's build, headless) against the fixture site. The Guidepup driver runs
// headed Chrome on Windows; everything but NVDA and the window's place on screen is the same.
const haveChromium = existsSync(chromium.executablePath());
const HEADLESS = ["--headless=new", ...(process.platform === "linux" ? ["--no-sandbox"] : [])];

let server: FixtureServer;
const sessions: ChromeSession[] = [];

beforeAll(async () => {
  server = await startFixtureServer({ port: 0 });
});
afterAll(async () => {
  await server.close();
});
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
});

async function launch(): Promise<ChromeSession> {
  const session = await launchChrome({
    browser: { channel: "chromium", fallbackToChromium: false },
    env: process.env,
    extraArgs: HEADLESS,
  });
  sessions.push(session);
  return session;
}

/** A local port with nothing listening on it: one that was free a moment ago. */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe.skipIf(!haveChromium)("a Chrome session", () => {
  it("loads a page and reports where it ended up, its status, and its content type", async () => {
    const session = await launch();
    expect(await session.load(server.url, 15_000)).toEqual({
      finalUrl: server.url,
      status: 200,
      contentType: "text/html; charset=utf-8",
    });
  });

  it("follows redirects to the final URL", async () => {
    const session = await launch();
    const result = await session.load(new URL("flawed", server.url).href, 15_000);
    expect(result.finalUrl).toBe(new URL("flawed/", server.url).href);
    expect(result.status).toBe(200);
  });

  it("reports HTTP errors and responses that aren't HTML", async () => {
    const session = await launch();
    expect((await session.load(new URL("no-such-page/", server.url).href, 15_000)).status).toBe(
      404,
    );
    expect((await session.load(new URL("feed/", server.url).href, 15_000)).contentType).toMatch(
      /^application\/rss\+xml/,
    );
  });

  // With nothing listening, Chromium says net::ERR_CONNECTION_REFUSED. (It refuses some low ports
  // outright: port 9 gives net::ERR_UNSAFE_PORT, so the test closes a port of its own.)
  it("says the page couldn't be reached, with a code, when the network refuses the connection", async () => {
    const session = await launch();
    const url = `http://127.0.0.1:${await closedPort()}/`;
    const loading = session.load(url, 15_000);
    await expect(loading).rejects.toBeInstanceOf(EnvironmentError);
    await expect(loading).rejects.toMatchObject({
      failure: "unreachable",
      message: `The page couldn't be reached: net::ERR_CONNECTION_REFUSED at ${url}`,
    });
    // Playwright's own error stays as the cause.
    await expect(loading).rejects.toHaveProperty(
      "cause.message",
      expect.stringContaining("net::ERR_CONNECTION_REFUSED"),
    );
  });

  it("leaves a navigation error that isn't the network's as it is", async () => {
    const session = await launch();
    const loading = session.load("not a url", 15_000);
    await expect(loading).rejects.toThrow(/invalid URL/);
    await expect(loading).rejects.not.toBeInstanceOf(EnvironmentError);
  });

  it("sets the page's title and restores it", async () => {
    const session = await launch();
    await session.load(server.url, 15_000);
    const restore = await session.setTitle("voicecap check k3m9x2");
    expect(await session.pageTitle()).toBe("voicecap check k3m9x2");
    await restore();
    expect(await session.pageTitle()).toBe("Home | Voicecap Test Agency");
  });

  it("starts with nothing focused, and its first Tab reaches the skip link", async () => {
    const session = await launch();
    await session.load(server.url, 15_000);
    expect(await session.focusedElement()).toBeNull();
    await session.pressTab();
    expect(await session.focusedElement()).toEqual({
      tag: "a",
      role: "link",
      name: "Skip to main content",
      inMain: false,
      href: "#main",
    });
  });

  it("describes a focused form field inside main", async () => {
    const session = await launch();
    await session.load(server.url, 15_000);
    // Skip link, site name, then the four navigation links, then the search field.
    for (let i = 0; i < 7; i++) await session.pressTab();
    expect(await session.focusedElement()).toEqual({
      tag: "input",
      role: "textbox",
      name: "Search this site",
      inMain: true,
      href: null,
    });
  });

  // A real loss (another window in front) was checked on Windows with headed Chrome: the blur
  // arrives with document.hasFocus() false, and it counts even after focus comes back. Headless
  // Chrome can't lose focus to another window (and whether it reports focus at all varies), so the
  // page makes document.hasFocus() say no, then blurs its window.
  it("counts a blur that leaves the page without focus", async () => {
    const session = await launch();
    const page = `<title>blur</title><a href="#a">link</a><script>setTimeout(() => { document.hasFocus = () => false; dispatchEvent(new FocusEvent("blur")); }, 800);</script>`;
    await session.load(`data:text/html,${encodeURIComponent(page)}`, 15_000);
    await delay(1400);
    expect(await session.focusState()).toEqual({ focused: false, losses: 1 });
  });

  it("doesn't count a blur while the page still has focus", async () => {
    const session = await launch();
    const page = `<title>blur</title><a href="#a">link</a><script>setTimeout(() => dispatchEvent(new FocusEvent("blur")), 800);</script>`;
    await session.load(`data:text/html,${encodeURIComponent(page)}`, 15_000);
    await session.pressTab(); // headless Chrome reports focus once something in the page has it
    await delay(1400);
    expect(await session.focusState()).toEqual({ focused: true, losses: 0 });
  });

  it("doesn't count focus moving into a frame as the window losing focus", async () => {
    const session = await launch();
    const page = `<title>frames</title><a href="#a">before</a><iframe srcdoc="<a href='#b'>inside</a>"></iframe><a href="#c">after</a>`;
    await session.load(`data:text/html,${encodeURIComponent(page)}`, 15_000);
    await session.pressTab();
    await session.pressTab(); // into the frame
    expect(await session.focusState()).toEqual({ focused: true, losses: 0 });
    await session.pressTab(); // back out
    expect(await session.focusState()).toEqual({ focused: true, losses: 0 });
  });

  it("doesn't count focus moving into a frame from another site, in its own process", async () => {
    const session = await launch();
    await session.load(new URL("frames/", server.url).href, 15_000);
    await session.waitUntilReady({ readySelector: null, settleMs: 0, networkIdleTimeoutMs: 5_000 });
    // Before the frames, into the same-site frame, into the other site's, after the frames.
    for (let tab = 1; tab <= 4; tab++) {
      await session.pressTab();
      expect(await session.focusState(), `after Tab ${tab}`).toEqual({ focused: true, losses: 0 });
    }
    expect((await session.focusedElement())?.name).toBe("After the frames");
  });

  it("doesn't count focus moving between elements of the page", async () => {
    const session = await launch();
    await session.load(server.url, 15_000);
    await session.pressTab();
    await session.pressTab();
    expect((await session.focusState()).losses).toBe(0);
  });

  it("waits for the ready selector, and says which one never appeared", async () => {
    const session = await launch();
    await session.load(server.url, 15_000);
    await session.waitUntilReady({
      ...DEFAULT_CONFIG.readiness,
      readySelector: "main h1",
      settleMs: 0,
    });
    await expect(
      session.waitUntilReady({
        readySelector: "#never-there",
        settleMs: 0,
        networkIdleTimeoutMs: 500,
      }),
    ).rejects.toThrow(/#never-there/);
  });

  it("stops a browser that's still starting when the launch is called off", async () => {
    const calledOff = new AbortController();
    const launching = launchChrome({
      browser: { channel: "chromium", fallbackToChromium: false },
      env: process.env,
      extraArgs: HEADLESS,
      signal: calledOff.signal,
    });
    setTimeout(() => calledOff.abort(), 20);
    await expect(launching).rejects.toThrow(EnvironmentError);
    await expect(launching).rejects.toMatchObject({ failure: "browser" });
  });

  it("doesn't start a browser at all when the launch was called off already", async () => {
    const launching = launchChrome({
      browser: { channel: "chromium", fallbackToChromium: false },
      env: process.env,
      extraArgs: HEADLESS,
      signal: AbortSignal.abort(),
    });
    await expect(launching).rejects.toThrow(EnvironmentError);
    await expect(launching).rejects.toMatchObject({ failure: "browser" });
  });

  // The Mac live test brings the browser to the front through System Events, by process id.
  it("knows its browser's process id", async () => {
    const session = await launch();
    expect(session.pid).toEqual(expect.any(Number));
  });

  it("uses a fresh profile, deleted when the browser closes", async () => {
    const session = await launch();
    expect(existsSync(session.profileDir)).toBe(true);
    await session.close();
    expect(existsSync(session.profileDir)).toBe(false);
  });
});

// Seen on Windows 11 (2026-09-29): with an update waiting and no other Chrome open, the Chrome
// voicecap starts swaps the update in and exits (0), and a new copy goes on with voicecap's profile.
describe.skipIf(!haveChromium)(
  "a browser that hands over to a new copy of itself as it starts",
  () => {
    const takeovers: number[] = [];
    /** Profiles handed over to a copy that the launch should have closed. */
    const handedOver: string[] = [];
    afterEach(() => {
      for (const pid of takeovers.splice(0)) {
        if (alive(pid))
          spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      }
      // Whatever the launch left behind, should a test fail.
      for (const dir of handedOver.splice(0)) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      }
    });

    const chromiumOptions = {
      browser: { channel: "chromium", fallbackToChromium: false },
      env: process.env,
      extraArgs: HEADLESS,
    };
    const profileOf = (args: string[]) =>
      args.find((arg) => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length) ??
      "";
    /** A start that exits at once with this code, as the one that hands over does. */
    const exiting = (code: number) =>
      spawn(process.execPath, ["-e", `process.exit(${code})`], { stdio: "ignore" });

    it.skipIf(process.platform !== "win32")(
      "closes the copy that took over its profile, and starts the browser again",
      async () => {
        const notices: string[] = [];
        let starts = 0;
        const session = await launchChrome({
          ...chromiumOptions,
          onRelaunch: (notice) => notices.push(notice),
          spawnBrowser: (file, args) => {
            starts++;
            if (starts > 1) return spawn(file, args, { stdio: "ignore" });
            handedOver.push(profileOf(args));
            const handing = exiting(0);
            handing.once("exit", () => {
              const takeover = spawn(file, args, { stdio: "ignore", detached: true });
              takeover.unref();
              if (takeover.pid !== undefined) takeovers.push(takeover.pid);
            });
            return handing;
          },
        });
        sessions.push(session);
        expect((await session.load(server.url, 15_000)).status).toBe(200);
        expect(starts).toBe(2);
        expect(notices).toEqual([
          "Chromium handed over to a new copy of itself as it started, as it does to finish installing an update. voicecap closed that copy and is starting Chromium again.",
        ]);
        expect(handedOver.filter((dir) => existsSync(dir))).toEqual([]);
        expect(takeovers.filter(alive)).toEqual([]);
      },
      60_000,
    );

    it("gives up with the usual error if it hands over again", async () => {
      const notices: string[] = [];
      let starts = 0;
      const launching = launchChrome({
        ...chromiumOptions,
        onRelaunch: (notice) => notices.push(notice),
        spawnBrowser: () => {
          starts++;
          return exiting(0);
        },
      });
      await expect(launching).rejects.toThrow("Chromium didn't start: it exited (0)");
      await expect(launching).rejects.toMatchObject({ failure: "browser" });
      expect(starts).toBe(2);
      expect(notices).toHaveLength(1);
    });

    it("doesn't start again a browser that crashed", async () => {
      const notices: string[] = [];
      let starts = 0;
      const launching = launchChrome({
        ...chromiumOptions,
        onRelaunch: (notice) => notices.push(notice),
        spawnBrowser: () => {
          starts++;
          return exiting(3);
        },
      });
      await expect(launching).rejects.toThrow("Chromium didn't start: it exited (3)");
      await expect(launching).rejects.toMatchObject({ failure: "browser" });
      expect(starts).toBe(1);
      expect(notices).toEqual([]);
    });
  },
);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("closing a browser that doesn't answer", () => {
  it("kills it after a while instead of waiting forever", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "voicecap-chrome-hung-test-"));
    let killed = false;
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null,
      kill() {
        killed = true;
        child.exitCode = 1;
        child.emit("exit", 1);
        return true;
      },
    });
    const hungBrowser = {
      version: () => "153.0.0.0",
      // Chrome never answers Browser.close.
      newBrowserCDPSession: () => Promise.resolve({ send: () => new Promise(() => {}) }),
      close: () => Promise.resolve(),
    };
    const session = new ChromeSession(
      { name: "Chrome", path: "chrome.exe" },
      child as unknown as ChildProcess,
      dir,
      hungBrowser as unknown as Browser,
      {} as Page,
      {} as CDPSession,
      { closeTimeoutMs: 100 },
    );
    await session.close();
    expect(killed).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });
});

// What Playwright raises for a navigation that fails, without a browser: a page that only navigates.
describe("a navigation that fails", () => {
  const URL_PDF = "https://example.gov/report.pdf";

  /** A session whose page fails to navigate with this, after the main response (if any) came. */
  function failing(error: unknown, response?: { url: string; contentType: string }): ChromeSession {
    const mainFrame = {};
    let onResponse: ((response: unknown) => void) | undefined;
    const page = {
      mainFrame: () => mainFrame,
      on: (_event: string, handler: (response: unknown) => void) => {
        onResponse = handler;
      },
      off: () => {},
      goto: () => {
        if (response) {
          onResponse?.({
            request: () => ({ isNavigationRequest: () => true, frame: () => mainFrame }),
            url: () => response.url,
            status: () => 200,
            headers: () => ({ "content-type": response.contentType }),
          });
        }
        throw error;
      },
      evaluate: () => Promise.resolve(),
    };
    return new ChromeSession(
      { name: "Chrome", path: "chrome.exe" },
      {} as ChildProcess,
      "unused",
      { version: () => "153.0.0.0" } as unknown as Browser,
      page as unknown as Page,
      {} as CDPSession,
    );
  }

  it.each([
    {
      label: "Playwright's message, with its call log",
      message:
        'page.goto: net::ERR_NAME_NOT_RESOLVED at https://example.gov/\nCall log:\n\u001b[2m  - navigating to "https://example.gov/", waiting until "load"\u001b[22m\n',
      detail: "net::ERR_NAME_NOT_RESOLVED at https://example.gov/",
    },
    {
      label: "a message without Playwright's prefix",
      message: "net::ERR_CONNECTION_RESET at https://example.gov/a?b=1",
      detail: "net::ERR_CONNECTION_RESET at https://example.gov/a?b=1",
    },
    {
      label: "a message with nothing after the code",
      message: "page.goto: net::ERR_INTERNET_DISCONNECTED",
      detail: "net::ERR_INTERNET_DISCONNECTED",
    },
  ])("says the page couldn't be reached, with a code: $label", async ({ message, detail }) => {
    const error = new Error(message);
    const loading = failing(error).load("https://example.gov/", 0);
    await expect(loading).rejects.toBeInstanceOf(EnvironmentError);
    await expect(loading).rejects.toMatchObject({
      failure: "unreachable",
      message: `The page couldn't be reached: ${detail}`,
    });
    await expect(loading).rejects.toHaveProperty("cause", error);
  });

  it.each([
    {
      label: "a timeout",
      message:
        'page.goto: Timeout 30000ms exceeded.\nCall log:\n  - navigating to "https://example.gov/", waiting until "load"\n',
    },
    {
      label: "an invalid URL",
      message: "page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL",
    },
    {
      label: "a message that names a network error only later",
      message: "page.goto: Timeout 30000ms exceeded.\nCall log:\n  - net::ERR_NETWORK_CHANGED",
    },
  ])("leaves $label as it is", async ({ message }) => {
    const error = new Error(message);
    await expect(failing(error).load("https://example.gov/", 0)).rejects.toBe(error);
  });

  it("leaves something that isn't an error as it is", async () => {
    await expect(failing("net::ERR_FAILED").load("https://example.gov/", 0)).rejects.toBe(
      "net::ERR_FAILED",
    );
  });

  // A download never commits, so the navigation fails; the response that came first says what it was.
  it("takes the main response that came first, whatever the failure", async () => {
    const aborted = new Error(`page.goto: net::ERR_ABORTED at ${URL_PDF}`);
    const loaded = await failing(aborted, {
      url: URL_PDF,
      contentType: "application/pdf",
    }).load(URL_PDF, 0);
    expect(loaded).toEqual({ finalUrl: URL_PDF, status: 200, contentType: "application/pdf" });
  });
});

describe("the browser's command line", () => {
  const profile = "C:\\Temp\\voicecap-chrome-x";
  const disabledFeatures = (args: string[]) =>
    args
      .find((arg) => arg.startsWith("--disable-features="))
      ?.split("=")[1]
      ?.split(",") ?? [];

  it("keeps every sandbox for an installed browser", () => {
    const args = chromeArgs(profile, {
      name: "Chrome",
      path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    });
    expect(disabledFeatures(args)).not.toContain("NetworkServiceSandbox");
    expect(args).not.toContain("--no-sandbox");
  });

  // Seen on GitHub's Windows runners, then on a Windows 11 PC: Chrome's sandbox can't read
  // Playwright's download (a user folder, with no access for app containers), so the network
  // service crashes as the browser starts and restarts, aborting a page load under way.
  it("turns off only the network service's sandbox for Playwright's own Chromium", () => {
    const args = chromeArgs(profile, {
      name: "Chromium",
      path: "C:\\Users\\pat\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe",
      playwrightBuild: true,
    });
    expect(disabledFeatures(args)).toContain("NetworkServiceSandbox");
    expect(args).not.toContain("--no-sandbox");
  });

  // Seen on a Mac: without it, Chrome asks the login keychain for its Safe Storage key as the
  // profile's cookie store opens, macOS shows an approval dialog, and every page load waits for
  // the answer. Playwright passes the same switch on macOS.
  it("keeps the browser out of the macOS keychain", () => {
    for (const executable of [
      { name: "Chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
      {
        name: "Chromium",
        path: "/Users/pat/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        playwrightBuild: true,
      },
    ]) {
      expect(chromeArgs(profile, executable)).toContain("--use-mock-keychain");
    }
  });
});

describe("choosing the browser", () => {
  const found = (paths: string[]) => (candidate: string) => paths.includes(candidate);
  const env = { LOCALAPPDATA: "C:\\Users\\pat\\AppData\\Local", PROGRAMFILES: "C:\\Program Files" };

  it("uses the installed browser for the configured channel", () => {
    expect(
      resolveBrowser(
        { channel: "chrome", fallbackToChromium: true },
        env,
        found(["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"]),
        "C:\\pw\\chrome.exe",
      ),
    ).toEqual({
      name: "Chrome",
      path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    });
  });

  it("falls back to Playwright's Chromium when the channel isn't installed", () => {
    expect(
      resolveBrowser(
        { channel: "chrome", fallbackToChromium: true },
        env,
        found(["C:\\pw\\chrome.exe"]),
        "C:\\pw\\chrome.exe",
      ),
    ).toEqual({ name: "Chromium", path: "C:\\pw\\chrome.exe", playwrightBuild: true });
  });

  it("explains what to install when neither is there", () => {
    expect(() =>
      resolveBrowser(
        { channel: "chrome", fallbackToChromium: true },
        env,
        found([]),
        "C:\\pw\\chrome.exe",
      ),
    ).toThrow(EnvironmentError);
    expect(() =>
      resolveBrowser(
        { channel: "chrome", fallbackToChromium: false },
        env,
        found([]),
        "C:\\pw\\chrome.exe",
      ),
    ).toThrow(/Google Chrome/);
  });
});
