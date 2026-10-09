import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium, errors, type Browser, type CDPSession, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AXE_LIMIT_MS, AXE_TAGS, type KeptAxeResults } from "../src/axe/results.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { startDemoServer, type DemoServer } from "../src/demo/server.js";
import { axeCheckOf } from "../src/drivers/guidepup-nvda.js";
import {
  chromeArgs,
  ChromeSession,
  launchChrome,
  resolveBrowser,
} from "../src/drivers/guidepup/chrome.js";
import type { AxeCapture } from "../src/drivers/types.js";
import { EnvironmentError } from "../src/util/errors.js";
import { jpegSize } from "../src/util/jpeg.js";
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

async function launch(extraArgs: string[] = []): Promise<ChromeSession> {
  const session = await launchChrome({
    browser: { channel: "chromium", fallbackToChromium: false },
    env: process.env,
    extraArgs: [...HEADLESS, ...extraArgs],
  });
  sessions.push(session);
  return session;
}

/**
 * A local server that drops each connection as it comes, without a word. It holds its port until
 * it's closed, so no other test's server can take it meanwhile.
 */
async function droppingServer(): Promise<{ port: number; close(): Promise<void> }> {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/**
 * A local server of HTML pages by path, and a 404 for any other path. The fixture site has no
 * page with a canonical tag, and the browser resolves a tag against the address it loaded the page
 * from, so the page has to come from a server. It holds its port until it's closed.
 */
async function servingPages(
  pages: Record<string, string>,
): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    const html = pages[request.url ?? ""];
    response.writeHead(html === undefined ? 404 : 200, {
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end(html ?? "Not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
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

  // A server that drops the connection unanswered: Chromium says net::ERR_EMPTY_RESPONSE, or
  // net::ERR_CONNECTION_RESET, depending on how the connection ends; any of its codes will do.
  // (A port closed again at once could be taken by another test's server before Chromium tries it.)
  it("says the page couldn't be reached, with its code, when the server drops the connection", async () => {
    const dropping = await droppingServer();
    try {
      const session = await launch();
      const url = `http://127.0.0.1:${dropping.port}/`;
      const loading = session.load(url, 15_000);
      await expect(loading).rejects.toBeInstanceOf(EnvironmentError);
      await expect(loading).rejects.toMatchObject({
        failure: "unreachable",
        message: expect.stringMatching(
          new RegExp(`^The page couldn't be reached: net::ERR_[A-Z_]+ at ${escapeRegExp(url)}$`),
        ) as unknown,
      });
      // Playwright's own error stays as the cause.
      await expect(loading).rejects.toHaveProperty(
        "cause.message",
        expect.stringMatching(/net::ERR_[A-Z_]+ at /),
      );
    } finally {
      await dropping.close();
    }
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

  describe("reading the page's canonical tag", () => {
    const tagged = (tags: string) => `<!doctype html><title>Tagged</title>${tags}<p>Hello</p>`;
    const pages = {
      "/path/": tagged('<link rel="Canonical" href="/x/">'),
      "/absolute/": tagged(
        '<link rel="canonical" href="https://dvfr.illinois.gov/about/?a=1#top">',
      ),
      "/upper/": tagged('<link rel="CANONICAL" href="y/">'),
      "/with-other/": tagged(
        '<link rel="stylesheet" href="/s.css"><link rel="canonical" href="/z/">',
      ),
      "/two/": tagged(
        '<link rel="canonical" href="/first/"><link rel="canonical" href="/second/">',
      ),
      "/no-address/": tagged('<link rel="canonical">'),
      "/other-links/": tagged(
        '<link rel="stylesheet" href="/s.css"><link rel="alternate" href="/e/">',
      ),
      "/plain/": "<!doctype html><title>Plain</title><p>No tag.</p>",
    };
    let served: Awaited<ReturnType<typeof servingPages>>;
    beforeAll(async () => {
      served = await servingPages(pages);
    });
    afterAll(async () => {
      await served.close();
    });

    /** The address `pageCanonical` reads from the page at `where` on the local server. */
    async function read(where: string): Promise<string | null> {
      const session = await launch();
      await session.load(new URL(where, served.url).href, 15_000);
      return session.pageCanonical();
    }

    it("gives the absolute address of a tag written as a path", async () => {
      expect(await read("/path/")).toBe(new URL("/x/", served.url).href);
    });

    it("gives a tag's address as it is, query and hash too, when it's absolute", async () => {
      expect(await read("/absolute/")).toBe("https://dvfr.illinois.gov/about/?a=1#top");
    });

    it("resolves a tag against the page it's on, and reads rel without regard to case", async () => {
      expect(await read("/upper/")).toBe(new URL("/upper/y/", served.url).href);
    });

    it("finds the tag among the page's other links", async () => {
      expect(await read("/with-other/")).toBe(new URL("/z/", served.url).href);
    });

    it("takes the first tag, when a page has two", async () => {
      expect(await read("/two/")).toBe(new URL("/first/", served.url).href);
    });

    it("gives null for a tag with no address", async () => {
      expect(await read("/no-address/")).toBeNull();
    });

    it("gives null when the page has no canonical tag", async () => {
      expect(await read("/other-links/")).toBeNull();
      expect(await read("/plain/")).toBeNull();
      // The fixture site's own home page has no such tag either.
      const session = await launch();
      await session.load(server.url, 15_000);
      expect(await session.pageCanonical()).toBeNull();
    });
  });

  describe("taking a screenshot", () => {
    /** The page's viewport, in CSS pixels and without its scrollbars: what a screenshot is half of. */
    function viewportOf(session: ChromeSession): Promise<{ width: number; height: number }> {
      return session["page"].evaluate(() => ({
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      }));
    }

    /** Expect `jpeg` to be a JPEG, as wide and as high as half the viewport, to within a pixel. */
    function expectHalf(jpeg: Uint8Array, viewport: { width: number; height: number }): void {
      expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8]);
      const size = jpegSize(jpeg);
      expect(size).not.toBeNull();
      expect(Math.abs((size?.width ?? 0) - viewport.width / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs((size?.height ?? 0) - viewport.height / 2)).toBeLessThanOrEqual(1);
    }

    it("takes a screenshot at half the page's size", async () => {
      const session = await launch();
      await session.load(server.url, 15_000);
      expectHalf(await session.screenshot(), await viewportOf(session));
    });

    // A page taller than the window is shown as far as the window shows it, not whole.
    it("takes only what shows in the window of a page that's taller", async () => {
      const session = await launch();
      const tall = `<!doctype html><title>tall</title><body style="margin:0"><div style="height:6000px">Tall</div>`;
      await session.load(`data:text/html,${encodeURIComponent(tall)}`, 15_000);
      const viewport = await viewportOf(session);
      expect(viewport.height).toBeLessThan(3000);
      expectHalf(await session.screenshot(), viewport);
    });

    // Colors say which part of the page it is: a red band, then a blue one, then a green one.
    it("takes the part of the page that's in view", async () => {
      const session = await launch();
      const bands = `<!doctype html><title>bands</title><body style="margin:0"><div style="height:2000px;background:#d00"></div><div style="height:2000px;background:#00d"></div><div style="height:2000px;background:#0a0"></div>`;
      await session.load(`data:text/html,${encodeURIComponent(bands)}`, 15_000);
      const colorAtTop = async (jpeg: Uint8Array) =>
        session["page"].evaluate(async (base64) => {
          const image = new Image();
          image.src = `data:image/jpeg;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          const [red = 0, green = 0, blue = 0] = context.getImageData(10, 10, 1, 1).data;
          return red > 150 ? "red" : blue > 150 ? "blue" : green > 120 ? "green" : "other";
        }, Buffer.from(jpeg).toString("base64"));

      expect(await colorAtTop(await session.screenshot())).toBe("red");
      await session["page"].evaluate(() => window.scrollTo(0, 2500));
      expect(await colorAtTop(await session.screenshot())).toBe("blue");
    });

    // Chromium counts a screenshot's scale in the screen's own pixels, so on a scaled display (a
    // laptop at 150%, a Retina screen) half the size takes less than a scale of one half.
    it("takes it at half the page's size on a scaled display too", async () => {
      const session = await launch(["--force-device-scale-factor=2"]);
      await session.load(server.url, 15_000);
      expect(await session["page"].evaluate(() => window.devicePixelRatio)).toBe(2);
      expectHalf(await session.screenshot(), await viewportOf(session));
    });

    // A page's own script can say anything of its pixel ratio. The screenshot's size never follows
    // it: a tiny ratio would make the picture huge, and a large one would make it a speck.
    it("takes it at half the page's size, whatever the page's script says its pixel ratio is", async () => {
      for (const scale of [1, 2]) {
        const session = await launch([`--force-device-scale-factor=${scale}`]);
        await session.load(server.url, 15_000);
        const viewport = await viewportOf(session);
        for (const said of [0.0001, 1000, scale === 1 ? 2 : 1]) {
          await session["page"].evaluate((value) => {
            Object.defineProperty(window, "devicePixelRatio", {
              get: () => value,
              configurable: true,
            });
          }, said);
          expect(await session["page"].evaluate(() => window.devicePixelRatio)).toBe(said);
          expectHalf(await session.screenshot(), viewport);
        }
      }
    });
  });

  // Through the driver's own check (axeCheckOf), in the browser the driver holds: voicecap's
  // Chrome, attached over DevTools without Playwright's defaults.
  describe("checking a page with axe", () => {
    const image = `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'/%3E">`;
    /** A page in English with a main landmark and a heading, so `body` holds what axe finds. */
    const page = (title: string, body: string, head = "") =>
      `<!doctype html><html lang="en"><head>${head}<title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
    const pages = {
      // The policy comes first, so it covers the page's own script, which would change the title.
      "/strict/": page(
        "Strict",
        image,
        `<meta http-equiv="Content-Security-Policy" content="script-src 'none'"><script>document.title = "Its script ran";</script>`,
      ),
      "/tall/": page(
        "Tall",
        `<p><a id="first" href="#one">First</a> <a id="second" href="#two">Second</a></p>
        <div id="region" role="region" tabindex="0" aria-label="A region that scrolls" style="height:100px;overflow:auto"><p style="height:600px">Scrolls within itself</p></div>
        <p style="margin-top:3000px;color:#aaa">Far down, and pale</p>
        <p style="margin-top:3000px">Further down still</p>`,
      ),
      "/breaks-arrays/": page(
        "Breaks arrays",
        image,
        `<script>Array.prototype.map = function () { throw new Error("This page broke arrays"); };</script>`,
      ),
      "/names-axe/": page("Names axe", image, "<script>window.axe = 1;</script>"),
      "/keeps-axe/": page(
        "Keeps axe",
        image,
        `<script>Object.defineProperty(window, "axe", { value: 1 });</script>`,
      ),
    };
    let demo: DemoServer;
    let served: Awaited<ReturnType<typeof servingPages>>;
    beforeAll(async () => {
      demo = await startDemoServer({ port: 0 });
      served = await servingPages(pages);
    });
    afterAll(async () => {
      await served.close();
      await demo.close();
    });

    /** A new browser with the page at `url` loaded, and how long axe's check of it took. */
    async function check(url: string) {
      const session = await launch();
      await session.load(url, 15_000);
      const began = performance.now();
      const capture = await axeCheckOf(session, url);
      return { session, capture, tookMs: performance.now() - began };
    }

    /** What axe kept of the page, read back; it fails, with axe's reason, if there's none. */
    function keptOf(capture: AxeCapture): KeptAxeResults {
      if ("error" in capture) throw new Error(`axe didn't check the page: ${capture.error}`);
      return JSON.parse(capture.json) as KeptAxeResults;
    }

    /** The rules axe found violated, by id. */
    const violated = (capture: AxeCapture) =>
      keptOf(capture)
        .violations.map((rule) => rule.id)
        .sort();

    it("finds the demo site's known violations", async () => {
      const url = `${demo.origin}/common-mistakes/`;
      const { capture, tookMs } = await check(url);
      expect(violated(capture)).toEqual(["button-name", "label", "page-has-heading-one"]);
      expect(keptOf(capture)).toMatchObject({
        schemaVersion: 1,
        axeVersion: "4.13.0",
        tags: [...AXE_TAGS],
        url,
      });
      expect(capture).toMatchObject({
        summary: { axeVersion: "4.13.0", counts: { violations: 3 } },
      });
      expect(tookMs).toBeLessThan(AXE_LIMIT_MS);
    });

    it("runs on a page whose policy allows no script", async () => {
      const { session, capture } = await check(new URL("/strict/", served.url).href);
      // The policy holds: the page's own script didn't run.
      expect(await session.pageTitle()).toBe("Strict");
      expect(violated(capture)).toEqual(["image-alt"]);
    });

    it("moves no focus, scrolls nothing, and adds nothing to the page", async () => {
      const url = new URL("/tall/", served.url).href;
      const session = await launch();
      await session.load(url, 15_000);
      await session.pressTab();
      await session.pressTab();
      await session["page"].evaluate(() => {
        window.scrollTo(0, 2000);
        document.querySelector("#region")!.scrollTop = 150;
      });
      /** Where focus is, how far the page and its region are scrolled, and the page's markup. */
      const stateNow = () =>
        session["page"].evaluate(() => ({
          focused: document.activeElement?.id,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          region: document.querySelector("#region")?.scrollTop,
          markup: document.documentElement.outerHTML,
        }));
      const before = await stateNow();
      expect(before).toMatchObject({ focused: "second", scrollY: 2000, region: 150 });
      // axe did check it, and found the pale text far below the window.
      const capture = await axeCheckOf(session, url);
      expect(violated(capture)).toEqual(["color-contrast"]);
      expect(await stateNow()).toEqual(before);
    });

    // A page's own script can break what axe relies on. Then axe gives what it found, or the reason
    // it found nothing, well within its limit, and the page is still there to read.
    it("survives a page that breaks arrays, or names its own axe", async () => {
      const outcomes: Record<string, unknown> = {};
      for (const where of ["/breaks-arrays/", "/names-axe/", "/keeps-axe/"]) {
        const { session, capture, tookMs } = await check(new URL(where, served.url).href);
        expect(tookMs, where).toBeLessThan(AXE_LIMIT_MS);
        outcomes[where] = "error" in capture ? capture.error : violated(capture);
        expect(await session.pageTitle(), where).not.toBe("");
      }
      expect(outcomes).toEqual({
        // axe's own code uses the page's arrays.
        "/breaks-arrays/": expect.stringContaining("This page broke arrays") as unknown,
        // axe's script takes the name over.
        "/names-axe/": ["image-alt"],
        // A name the page won't give up: what's under it isn't axe.
        "/keeps-axe/": expect.stringMatching(/axe\.run is not a function/) as unknown,
      });
    }, 60_000);
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
    const waiting = session.waitUntilReady({
      readySelector: "#never-there",
      settleMs: 0,
      networkIdleTimeoutMs: 500,
    });
    await expect(waiting).rejects.toThrow(/#never-there/);
    // The page didn't open in time: a code of its own, not an unexpected error.
    await expect(waiting).rejects.toMatchObject({ failure: "open-timeout" });
  });

  it("says the browser closed, with a code, when a call finds it gone", async () => {
    const session = await launch();
    await session.load(server.url, 15_000);
    await session.close();
    const reading = session.focusState();
    await expect(reading).rejects.toBeInstanceOf(EnvironmentError);
    await expect(reading).rejects.toMatchObject({
      failure: "browser",
      message: "Chromium closed while voicecap was using it: its window was closed, or it crashed.",
    });
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
      { on: () => {} } as unknown as Page,
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
    const handlers = new Map<string, (response: unknown) => void>();
    const page = {
      mainFrame: () => mainFrame,
      on: (event: string, handler: (response: unknown) => void) => {
        handlers.set(event, handler);
      },
      off: () => {},
      isClosed: () => false,
      goto: () => {
        if (response) {
          handlers.get("response")?.({
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
      { version: () => "153.0.0.0", isConnected: () => true } as unknown as Browser,
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

// What Playwright raises once the browser has gone, without a browser: every call on the page, the
// browser, and the DevTools connection fails with the same error.
describe("a browser that closes or crashes mid-page", () => {
  /**
   * A session whose calls all fail with `failure`, and what it can see of its browser: whether the
   * page is closed, and whether the browser is still connected. `crash` reports a crash, as
   * Playwright's page does.
   */
  function failingSession(failure: Error, state: { closed?: boolean; connected?: boolean } = {}) {
    const handlers = new Map<string, () => void>();
    const fail = () => Promise.reject(failure);
    const page = {
      on: (event: string, handler: () => void) => {
        handlers.set(event, handler);
      },
      off: () => {},
      isClosed: () => state.closed ?? false,
      mainFrame: () => ({}),
      url: () => "about:blank",
      goto: fail,
      waitForLoadState: fail,
      waitForSelector: fail,
      title: fail,
      evaluate: fail,
      bringToFront: fail,
      keyboard: { press: fail },
    };
    const browser = { version: () => "153.0.0.0", isConnected: () => state.connected ?? true };
    const session = new ChromeSession(
      { name: "Chrome", path: "chrome.exe" },
      {} as ChildProcess,
      "unused",
      browser as unknown as Browser,
      page as unknown as Page,
      { send: fail } as unknown as CDPSession,
    );
    return { session, crash: () => handlers.get("crash")?.() };
  }

  const closed = () => new Error("page.evaluate: Target page, context or browser has been closed");
  const readiness = { readySelector: "main h1", settleMs: 0, networkIdleTimeoutMs: 500 };

  // Every call a page's attempt makes on the browser.
  const calls: [string, (session: ChromeSession) => Promise<unknown>][] = [
    ["load", (session) => session.load("https://example.gov/", 0)],
    ["waitUntilReady", (session) => session.waitUntilReady(readiness)],
    ["pageTitle", (session) => session.pageTitle()],
    ["pageCanonical", (session) => session.pageCanonical()],
    ["screenshot", (session) => session.screenshot()],
    ["runAxe", (session) => session.runAxe("void 0")],
    ["setTitle", (session) => session.setTitle("voicecap check k3m9x2")],
    ["focusState", (session) => session.focusState()],
    ["raise", (session) => session.raise()],
    ["pressTab", (session) => session.pressTab()],
    ["focusedElement", (session) => session.focusedElement()],
  ];

  it.each(calls)(
    "says the browser closed, coded browser, when %s finds its window closed",
    async (_name, call) => {
      const failure = closed();
      const calling = call(failingSession(failure, { closed: true }).session);
      await expect(calling).rejects.toBeInstanceOf(EnvironmentError);
      await expect(calling).rejects.toMatchObject({
        failure: "browser",
        message: "Chrome closed while voicecap was using it: its window was closed, or it crashed.",
      });
      await expect(calling).rejects.toHaveProperty("cause", failure);
    },
  );

  it("says so when the browser is no longer connected, whatever the page says", async () => {
    const reading = failingSession(closed(), { connected: false }).session.focusState();
    await expect(reading).rejects.toMatchObject({
      failure: "browser",
      message: "Chrome closed while voicecap was using it: its window was closed, or it crashed.",
    });
  });

  // A crashed page isn't closed: Playwright reports the crash, and fails every call after it.
  it.each(calls)(
    "says the page crashed, coded browser, when %s fails after a crash",
    async (_name, call) => {
      const failure = new Error("page.evaluate: Target crashed");
      const { session, crash } = failingSession(failure);
      crash();
      const calling = call(session);
      await expect(calling).rejects.toBeInstanceOf(EnvironmentError);
      await expect(calling).rejects.toMatchObject({
        failure: "browser",
        message: "The page crashed in Chrome while voicecap was using it.",
      });
      await expect(calling).rejects.toHaveProperty("cause", failure);
    },
  );

  it("leaves a failure as it is while the browser is still there", async () => {
    const failure = new Error("page.evaluate: Execution context was destroyed");
    await expect(failingSession(failure).session.focusState()).rejects.toBe(failure);
  });

  it("codes a readySelector that never appears as a page that didn't open in time", async () => {
    const timeout = new errors.TimeoutError("page.waitForSelector: Timeout 500ms exceeded.");
    const waiting = failingSession(timeout).session.waitUntilReady(readiness);
    await expect(waiting).rejects.toBeInstanceOf(EnvironmentError);
    await expect(waiting).rejects.toMatchObject({
      failure: "open-timeout",
      message: 'The readySelector "main h1" didn\'t appear within 500ms.',
    });
    await expect(waiting).rejects.toHaveProperty("cause", timeout);
  });

  // A selector the browser can't read fails at once: it's no timeout, and Playwright's words say why.
  it("leaves a readySelector the browser can't read as Playwright says it", async () => {
    const unreadable = new Error(
      'page.waitForSelector: Unexpected token "#" while parsing css selector "###".',
    );
    await expect(failingSession(unreadable).session.waitUntilReady(readiness)).rejects.toBe(
      unreadable,
    );
  });
});

// The commands a screenshot sends to the browser, without a browser: which they are, and what each
// asks for. The real browser's pictures are checked above.
describe("a screenshot's DevTools commands", () => {
  const picture = Uint8Array.of(0xff, 0xd8, 1, 2, 3);
  /** The viewport in CSS pixels, as the layout metrics give it. */
  const CSS_VIEWPORT = { pageX: 40, pageY: 120, clientWidth: 1265, clientHeight: 849 };
  /**
   * What `Page.getLayoutMetrics` answers on a screen of `ratio` pixels for each CSS pixel: the
   * viewport in the screen's pixels too, or, for `null`, with no width in them.
   */
  const metricsAt = (ratio: number | null, width?: unknown) => ({
    layoutViewport:
      ratio === null
        ? {
            pageX: 0,
            pageY: 0,
            clientHeight: 849,
            ...(width === undefined ? {} : { clientWidth: width }),
          }
        : { pageX: 40, pageY: 120, clientWidth: 1265 * ratio, clientHeight: 849 * ratio },
    cssLayoutViewport: CSS_VIEWPORT,
  });
  /** What each command answers: a function is called to answer, and so can fail or never answer. */
  const answers: Record<string, unknown> = {
    "Page.getLayoutMetrics": metricsAt(1),
    "Page.captureScreenshot": { data: Buffer.from(picture).toString("base64") },
  };

  /**
   * A session whose DevTools connection answers as `changed` says, in place of `answers`, and the
   * commands it was sent. Its page can do nothing: a screenshot may use only the connection.
   */
  function withDevTools(changed: Record<string, unknown> = {}) {
    const sent: { method: string; params?: unknown }[] = [];
    const cdp = {
      send: (method: string, params?: unknown) => {
        sent.push({ method, params });
        const answer = { ...answers, ...changed }[method];
        return typeof answer === "function" ? (answer as () => unknown)() : Promise.resolve(answer);
      },
    };
    const page = { on: () => {}, isClosed: () => false };
    const session = new ChromeSession(
      { name: "Chrome", path: "chrome.exe" },
      {} as ChildProcess,
      "unused",
      { version: () => "153.0.0.0", isConnected: () => true } as unknown as Browser,
      page as unknown as Page,
      cdp as unknown as CDPSession,
    );
    return { session, sent };
  }

  /** The scale the screenshot was asked for. */
  const scaleOf = (sent: { params?: unknown }[]) =>
    (sent.at(-1)?.params as { clip: { scale: number } }).clip.scale;

  it("asks for a JPEG of what shows in the window at half its size, and for nothing else", async () => {
    const { session, sent } = withDevTools();
    expect([...(await session.screenshot())]).toEqual([...picture]);
    // Nothing runs in the page: what the page's own script says of itself has no say.
    expect(sent).toEqual([
      { method: "Page.getLayoutMetrics" },
      {
        method: "Page.captureScreenshot",
        params: {
          format: "jpeg",
          quality: 60,
          clip: { x: 40, y: 120, width: 1265, height: 849, scale: 0.5 },
          captureBeyondViewport: false,
        },
      },
    ]);
  });

  it("allows for the pixels of a scaled display, as the browser's own metrics give them, so the picture stays half the page's size", async () => {
    for (const ratio of [1.25, 1.5, 2]) {
      const { session, sent } = withDevTools({ "Page.getLayoutMetrics": metricsAt(ratio) });
      await session.screenshot();
      expect(scaleOf(sent), String(ratio)).toBeCloseTo(0.5 / ratio, 10);
    }
  });

  it("takes the display as unscaled when the browser gives no width in the screen's pixels", async () => {
    for (const width of [undefined, 0, -1265, "1897", Number.NaN]) {
      const { session, sent } = withDevTools({ "Page.getLayoutMetrics": metricsAt(null, width) });
      await session.screenshot();
      expect(scaleOf(sent), String(width)).toBe(0.5);
    }
    const { session, sent } = withDevTools({
      "Page.getLayoutMetrics": { cssLayoutViewport: CSS_VIEWPORT },
    });
    await session.screenshot();
    expect(scaleOf(sent)).toBe(0.5);
  });

  it("keeps the ratio between a screen at 50% and one at 400%, so no reading makes the picture huge or a speck", async () => {
    for (const [ratio, kept] of [
      [0.0001, 0.5],
      [0.5, 0.5],
      [4, 4],
      [1000, 4],
    ] as const) {
      const { session, sent } = withDevTools({ "Page.getLayoutMetrics": metricsAt(ratio) });
      await session.screenshot();
      expect(scaleOf(sent), String(ratio)).toBeCloseTo(0.5 / kept, 10);
    }
  });

  it("gives up after five seconds on a browser that doesn't answer", async () => {
    vi.useFakeTimers();
    try {
      const { session } = withDevTools({ "Page.captureScreenshot": () => new Promise(() => {}) });
      let settled = false;
      const taking = session.screenshot();
      const rejected = expect(taking).rejects.toThrow("timed out after 5s");
      taking.then(
        () => (settled = true),
        () => (settled = true),
      );
      await vi.advanceTimersByTimeAsync(4_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves what the browser refuses as the browser says it", async () => {
    const refusal = new Error("Protocol error (Page.captureScreenshot): Cannot take screenshot");
    const { session } = withDevTools({ "Page.captureScreenshot": () => Promise.reject(refusal) });
    await expect(session.screenshot()).rejects.toBe(refusal);
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

  // A browser uninstalled mid-run fails the next page's launch: the browser's problem, with its code.
  it.each([
    { label: "no browser for the channel", channel: "chrome", message: /isn't installed/ },
    { label: "no Chromium", channel: "chromium", message: /Chromium isn't installed/ },
    { label: "a channel it doesn't know", channel: "firefox", message: /doesn't know the browser/ },
  ])("codes $label as the browser's problem", ({ channel, message }) => {
    let thrown: unknown;
    try {
      resolveBrowser({ channel, fallbackToChromium: false }, env, found([]), "C:\\pw\\chrome.exe");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EnvironmentError);
    expect(thrown).toMatchObject({
      failure: "browser",
      message: expect.stringMatching(message) as unknown,
    });
  });
});
