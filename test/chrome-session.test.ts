import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
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
  });

  it("doesn't start a browser at all when the launch was called off already", async () => {
    await expect(
      launchChrome({
        browser: { channel: "chromium", fallbackToChromium: false },
        env: process.env,
        extraArgs: HEADLESS,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow(EnvironmentError);
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
