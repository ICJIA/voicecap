import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import { chromium, type Browser, type Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { launchChrome, type ChromeSession } from "../src/drivers/guidepup/chrome.js";

// Real Chromium (Playwright's build, headless) against a local server that counts every request.
// The guard is what keeps a form's data on the computer, so nothing here is faked but the failures
// the last tests ask for.
const haveChromium = existsSync(chromium.executablePath());
const HEADLESS = ["--headless=new", ...(process.platform === "linux" ? ["--no-sandbox"] : [])];

/** How long a request that got past the guard gets to reach the server. */
const STRAGGLER_MS = 400;
/** How long the page gets to try to send. */
const SEND_LIMIT_MS = 5_000;

interface Counter {
  url: string;
  /** The same server by another name, so a page's frame on it is cross-origin, in its own process. */
  otherOrigin: string;
  /** What's reached the server since the last mark: requests, sockets, and a socket's messages. */
  reaches(): number;
  paths(): string[];
  mark(): void;
  /** Answers the requests to /slow, which wait until now. */
  answerSlow(): void;
  close(): Promise<void>;
}

/** The start of every page: no favicon request, which the guard would hold as the page's own. */
const HEAD = `<!doctype html><title>Form</title><link rel="icon" href="data:,">`;

const WORKER = `self.onmessage = () => { fetch("/worker-sent", { method: "POST", body: "secret" }); };`;
const WORKER_SOCKET = `self.onmessage = (event) => { new WebSocket(event.data); };`;
const SHARED_WORKER = `self.onconnect = (event) => {
  event.ports[0].onmessage = () => { fetch("/shared-worker-sent", { method: "POST", body: "secret" }); };
};`;
const SERVICE_WORKER = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", () => { fetch("/sw-sent", { method: "POST", body: "secret" }); });
self.addEventListener("fetch", (event) => event.respondWith(fetch(event.request)));`;

/** A one-pixel PNG. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** A page with a control, #go, and what the page sends when it's pressed, or typed in. */
function button(onclick: string): string {
  return `${HEAD}<button id="go" onclick='${onclick}'>Send</button>`;
}

const sentBy = (kind: string, otherOrigin: string): string => {
  switch (kind) {
    case "post form":
      return `${HEAD}<form method="post" action="/sent"><input name="a" value="secret"><button id="go">Send</button></form>`;
    case "get form":
      return `${HEAD}<form method="get" action="/sent"><input name="a" value="secret"><button id="go">Send</button></form>`;
    case "fetch":
      return button(`fetch("/sent", { method: "POST", body: "secret" })`);
    case "xhr":
      return button(`const x = new XMLHttpRequest(); x.open("POST", "/sent"); x.send("secret")`);
    case "beacon":
      return button(`navigator.sendBeacon("/sent", "secret")`);
    case "websocket":
      return button(`new WebSocket(location.origin.replace("http", "ws") + "/socket")`);
    case "window.open":
      return button(`window.open("/sent?a=secret")`);
    case 'target="_blank" form':
      return `${HEAD}<form method="post" action="/sent" target="_blank"><input name="a" value="secret"><button id="go">Send</button></form>`;
    case "service worker fetch":
      return `${button(`navigator.serviceWorker.controller.postMessage("send")`)}<script>
        window.ready = navigator.serviceWorker.register("/sw.js").then(() => new Promise((resolve) => {
          if (navigator.serviceWorker.controller) resolve();
          navigator.serviceWorker.addEventListener("controllerchange", resolve);
        }));
      </script>`;
    case "cross-origin frame's form":
      return `${HEAD}<iframe src="${otherOrigin}/frame"></iframe>`;
    case "input event autosave":
      return `${HEAD}<input id="go" oninput='fetch("/save", { method: "POST", body: this.value })'>`;
    case "a page's fetch through its service worker":
      return `${button(`fetch("/sent")`)}<script>
        window.ready = navigator.serviceWorker.register("/sw.js").then(() => new Promise((resolve) => {
          if (navigator.serviceWorker.controller) resolve();
          navigator.serviceWorker.addEventListener("controllerchange", resolve);
        }));
      </script>`;
    case "a move of the page":
      return button(`location.href = "/sent?a=secret"`);
    case "a link's ping":
      return `${HEAD}<a id="go" href="#here" ping="/sent">Send</a>`;
    case "a frame's move":
      return `${button(`document.querySelector("iframe").src = "/sent?a=secret"`)}<iframe></iframe>`;
    case "a cross-origin fetch":
      return button(
        `fetch("${otherOrigin}/sent", { method: "POST", body: "secret", headers: { "x-secret": "1" } })`,
      );
    case "a keepalive fetch":
      return button(`fetch("/sent", { method: "POST", body: "secret", keepalive: true })`);
    case "an event stream":
      return button(`new EventSource("/sent?a=secret")`);
    case "a worker's fetch":
      return `${button(`worker.postMessage("send")`)}<script>const worker = new Worker("/worker.js");</script>`;
    case "a shared worker's fetch":
      return `${button(`shared.port.postMessage("send")`)}<script>const shared = new SharedWorker("/shared-worker.js");</script>`;
    case "a worker's websocket":
      return `${button(`worker.postMessage(location.origin.replace("http", "ws") + "/socket")`)}
        <script>const worker = new Worker("/worker-socket.js");</script>`;
    case "a websocket made from a constructor kept before the guard":
      return `${button(`new Kept(location.origin.replace("http", "ws") + "/socket")`)}
        <script>const Kept = window.WebSocket;</script>`;
    case "a cross-origin frame's websocket":
      return `${HEAD}<iframe src="${otherOrigin}/frame-socket"></iframe>`;
    case "an input handler's send on a websocket opened before the guard":
      return `${HEAD}<input id="go" oninput="socket.send(this.value)"><script>
        const socket = new WebSocket(location.origin.replace("http", "ws") + "/socket");
        window.ready = new Promise((resolve) => { socket.onopen = resolve; });
      </script>`;
    case "cross-origin frame's websocket opened before the guard":
      return `${HEAD}<iframe src="${otherOrigin}/frame-open"></iframe><script>
        window.ready = new Promise((resolve) => { window.onmessage = resolve; });
      </script>`;
    case "a worker's websocket opened before the guard":
      return `${button(`worker.postMessage("send")`)}<script>
        const worker = new Worker("/worker-open.js");
        window.ready = new Promise((resolve) => { worker.onmessage = resolve; });
      </script>`;
    case "a service worker's websocket opened before the guard":
      return `${button(`navigator.serviceWorker.controller.postMessage("send")`)}<script>
        window.ready = navigator.serviceWorker.register("/sw-open.js").then(() => new Promise((resolve) => {
          navigator.serviceWorker.onmessage = resolve;
          const ask = () => navigator.serviceWorker.controller?.postMessage("open");
          navigator.serviceWorker.addEventListener("controllerchange", ask);
          ask();
        }));
      </script>`;
    case "a request in flight as the guard arms":
      return `${HEAD}<script>
        fetch("/slow").finally(() => fetch("/sent", { method: "POST", body: "secret" }));
      </script>`;
    case "a websocket opened before the guard":
      return `${button(`socket.send("secret")`)}<script>
        const socket = new WebSocket(location.origin.replace("http", "ws") + "/socket");
        window.ready = new Promise((resolve) => { socket.onopen = resolve; });
      </script>`;
    default:
      throw new Error(`no page for ${kind}`);
  }
};

/** Enough of a WebSocket server to count a handshake, and each message a socket sends. */
function acceptSocket(request: { headers: Record<string, unknown> }, socket: Socket): void {
  const accept = createHash("sha1")
    .update(`${String(request.headers["sec-websocket-key"])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
}

async function countingServer(kindOf: () => string, csp = ""): Promise<Counter> {
  const seen: string[] = [];
  const sockets = new Set<Socket>();
  const slow: ServerResponse[] = [];
  let origins = { url: "", otherOrigin: "" };
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://here");
    request.resume();
    seen.push(url.pathname);
    if (url.pathname === "/slow") {
      slow.push(response);
      return;
    }
    const answers: Record<string, [string, string]> = {
      "/sw.js": ["text/javascript", SERVICE_WORKER],
      "/worker.js": ["text/javascript", WORKER],
      "/worker-socket.js": ["text/javascript", WORKER_SOCKET],
      "/shared-worker.js": ["text/javascript", SHARED_WORKER],
      "/style.css": ["text/css", "body { color: #111; }"],
      "/late.js": ["text/javascript", "window.lateRan = true;"],
      "/pic.png": ["image/png", ""],
      "/late-worker.js": [
        "text/javascript",
        `fetch("/late-worker-sent", { method: "POST", body: "secret" });`,
      ],
      "/late-sw.js": [
        "text/javascript",
        `fetch("/late-sw-sent", { method: "POST", body: "secret" });`,
      ],
      "/worker-open.js": [
        "text/javascript",
        `const socket = new WebSocket(location.origin.replace("http", "ws") + "/socket");
        socket.onopen = () => postMessage("open");
        self.onmessage = () => socket.send("secret");`,
      ],
      "/sw-open.js": [
        "text/javascript",
        `let socket;
        self.addEventListener("install", () => self.skipWaiting());
        self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
        self.addEventListener("message", (event) => {
          if (event.data === "send") return socket.send("secret");
          socket ??= new WebSocket(location.origin.replace("http", "ws") + "/socket");
          socket.onopen = () => event.source.postMessage("open");
        });`,
      ],
      "/frame-open": [
        "text/html",
        `${HEAD}<button id="go" onclick='socket.send("secret")'>Send</button><script>
          const socket = new WebSocket(location.origin.replace("http", "ws") + "/socket");
          socket.onopen = () => parent.postMessage("open", "*");
        </script>`,
      ],
      "/frame-socket": [
        "text/html",
        `${HEAD}<button id="go" onclick='new WebSocket(location.origin.replace("http", "ws") + "/socket")'>Send</button>`,
      ],
      "/frame": [
        "text/html",
        `${HEAD}<form method="post" action="/sent"><input name="a" value="secret"><button id="go">Send</button></form>`,
      ],
    };
    const answer = answers[url.pathname];
    const html = url.pathname === "/" ? sentBy(kindOf(), origins.otherOrigin) : undefined;
    const headers: Record<string, string> = {
      "Content-Type": html === undefined ? (answer?.[0] ?? "text/plain") : "text/html",
      "Access-Control-Allow-Origin": "*",
      ...(csp && html !== undefined ? { "Content-Security-Policy": csp } : {}),
    };
    response.writeHead(200, headers);
    response.end(url.pathname === "/pic.png" ? PIXEL : (html ?? answer?.[1] ?? "ok"));
  });
  server.on("upgrade", (request, socket) => {
    seen.push("(socket)");
    sockets.add(socket as Socket);
    socket.on("error", () => {});
    socket.on("data", () => seen.push("(socket message)"));
    acceptSocket(request, socket as Socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  origins = { url: `http://127.0.0.1:${port}/`, otherOrigin: `http://localhost:${port}` };
  let start = 0;
  return {
    ...origins,
    reaches: () => seen.length - start,
    paths: () => seen.slice(start),
    mark: () => {
      start = seen.length;
    },
    answerSlow: () => {
      for (const response of slow.splice(0)) response.end("ok");
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** The session's own page: the tests press what a person would, as the forms pass will. */
const pageOf = (session: ChromeSession): Page => (session as unknown as { page: Page }).page;

describe.skipIf(!haveChromium)("the form guard", () => {
  let kind = "";
  let server: Counter;
  let session: ChromeSession;

  async function start(csp = ""): Promise<void> {
    server = await countingServer(() => kind, csp);
    session = await launchChrome({
      browser: { channel: "chromium", fallbackToChromium: false },
      env: process.env,
      extraArgs: HEADLESS,
    });
  }

  /** The page's load, its setup, and its last quiet moment: what reaches the server after is sent. */
  async function open(path = ""): Promise<Page> {
    await session.load(`${server.url}${path}`, 15_000);
    const page = pageOf(session);
    await page.evaluate("window.ready");
    await delay(STRAGGLER_MS);
    server.mark();
    return page;
  }

  /** Press #go by the keyboard, in the page or its frame, or type in it. */
  async function press(page: Page): Promise<void> {
    const inFrame =
      kind.startsWith("cross-origin frame") || kind.startsWith("a cross-origin frame");
    const target = inFrame ? page.frameLocator("iframe").locator("#go") : page.locator("#go");
    await target.focus();
    await page.keyboard.press(kind.includes("input") ? "a" : "Enter");
  }

  /** Waits for the guard to hold something, then gives anything that got past it time to arrive. */
  async function settled(): Promise<void> {
    await vi.waitFor(
      () => {
        if (session.heldRequests() === 0 && server.reaches() === 0) throw new Error("nothing yet");
      },
      { timeout: SEND_LIMIT_MS, interval: 25 },
    );
    await delay(STRAGGLER_MS);
  }

  async function armAndTrigger(): Promise<void> {
    await start();
    const page = await open();
    await session.armFormGuard();
    await press(page);
    await settled();
  }

  afterEach(async () => {
    await session?.close();
    await server?.close();
  });

  it.each([
    "post form",
    "get form",
    "fetch",
    "xhr",
    "beacon",
    "websocket",
    "window.open",
    'target="_blank" form',
    "service worker fetch",
    "cross-origin frame's form",
    "input event autosave",
    "a page's fetch through its service worker",
    "a move of the page",
    "a link's ping",
    "a frame's move",
    "a cross-origin fetch",
    "a keepalive fetch",
    "an event stream",
    "a worker's fetch",
    "a shared worker's fetch",
    "a worker's websocket",
    "a websocket made from a constructor kept before the guard",
    "a cross-origin frame's websocket",
    "a websocket opened before the guard",
    "an input handler's send on a websocket opened before the guard",
    "cross-origin frame's websocket opened before the guard",
    "a worker's websocket opened before the guard",
  ])("lets nothing out: %s", async (name) => {
    kind = name;
    await armAndTrigger();
    expect(server.paths()).toEqual([]);
    expect(server.reaches()).toBe(0);
    expect(session.heldRequests()).toBeGreaterThan(0);
  });

  // Stopped, and not counted: no page sees a service worker's socket, so the count is low, never high.
  it("lets nothing out: a service worker's websocket opened before the guard", async () => {
    kind = "a service worker's websocket opened before the guard";
    await start();
    const page = await open();
    await session.armFormGuard();
    await press(page);
    await delay(STRAGGLER_MS * 2);
    expect(server.paths()).toEqual([]);
  });

  it("holds what a request in flight as it arms goes on to send", async () => {
    kind = "a request in flight as the guard arms";
    await start();
    await open();
    await session.armFormGuard();
    server.answerSlow();
    await settled();
    expect(server.paths()).toEqual([]);
    expect(session.heldRequests()).toBeGreaterThan(0);
  });

  it("is offline for real: an open socket stays silent when the page can't be told it's online", async () => {
    kind = "an input handler's send on a websocket opened before the guard";
    await start();
    const page = await open();
    const cdp = (session as unknown as { cdp: { send: (...args: unknown[]) => Promise<unknown> } })
      .cdp;
    const send = cdp.send.bind(cdp);
    vi.spyOn(cdp, "send").mockImplementation((method, ...rest) =>
      method === "Network.overrideNetworkState"
        ? Promise.reject(new Error("no override"))
        : send(method, ...rest),
    );
    await session.armFormGuard();
    await press(page);
    await settled();
    expect(server.paths()).toEqual([]);
  });

  it("still lets a stylesheet, an image, a font, and a script load", async () => {
    kind = "fetch";
    await start();
    const page = await open();
    await session.armFormGuard();
    const loaded = await page.evaluate(`Promise.all([
      new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve("image loaded");
        image.onerror = () => resolve("image failed");
        image.src = "/pic.png";
      }),
      new Promise((resolve) => {
        const sheet = document.createElement("link");
        sheet.rel = "stylesheet";
        sheet.onload = () => resolve("sheet loaded");
        sheet.onerror = () => resolve("sheet failed");
        sheet.href = "/style.css";
        document.head.append(sheet);
      }),
      new FontFace("Asked", "url(/font.woff2)").load().catch(() => "font asked for"),
      new Promise((resolve) => {
        const script = document.createElement("script");
        script.onload = script.onerror = () => resolve(window.lateRan);
        script.src = "/late.js";
        document.head.append(script);
      }),
    ])`);
    // The font isn't a real one: what counts is that it reached the server, below.
    expect(loaded).toEqual(["image loaded", "sheet loaded", "font asked for", true]);
    expect(server.paths().sort()).toEqual(["/font.woff2", "/late.js", "/pic.png", "/style.css"]);
    expect(session.heldRequests()).toBe(0);
  });

  it("stops a shared worker started once it's armed, before its first line", async () => {
    kind = "fetch";
    await start();
    const page = await open();
    await session.armFormGuard();
    await page.evaluate(`window.late = new SharedWorker("/late-worker.js")`);
    await settled();
    expect(server.paths().filter((path) => path !== "/late-worker.js")).toEqual([]);
    expect(session.heldRequests()).toBeGreaterThan(0);
  });

  it("stops a service worker registered once it's armed", async () => {
    kind = "fetch";
    await start();
    const page = await open();
    await session.armFormGuard();
    await page.evaluate(`navigator.serviceWorker.register("/late-sw.js").catch(() => {})`);
    await delay(STRAGGLER_MS * 2);
    expect(server.paths().filter((path) => path !== "/late-sw.js")).toEqual([]);
  });

  it("still tells the page it's online", async () => {
    kind = "fetch";
    await start();
    const page = await open();
    await session.armFormGuard();
    await expect(page.evaluate("navigator.onLine")).resolves.toBe(true);
  });

  it("counts what the page sends, and not its own confirmation", async () => {
    kind = "fetch";
    await start();
    await open();
    await session.armFormGuard();
    expect(session.heldRequests()).toBe(0);
    expect(server.reaches()).toBe(0);
  });

  it("leaves the page where it is when a form's post is held, so what it shows can be read", async () => {
    kind = "post form";
    await start();
    const page = await open();
    await session.armFormGuard();
    await press(page);
    await settled();
    expect(page.url()).toBe(server.url);
    await expect(page.locator("#go").count()).resolves.toBe(1);
  });

  it("closes a new window at once, and the session's page stays", async () => {
    kind = "window.open";
    await start();
    const page = await open();
    await session.armFormGuard();
    await press(page);
    await settled();
    await vi.waitFor(() => expect(page.context().pages()).toEqual([page]));
  });

  it("confirms on a page whose Content Security Policy forbids any connection", async () => {
    kind = "fetch";
    await start("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
    await open();
    await expect(session.armFormGuard()).resolves.toBeUndefined();
    expect(server.reaches()).toBe(0);
  });

  it("confirms on a page that has replaced fetch", async () => {
    kind = "fetch";
    await start();
    const page = await open();
    await page.evaluate(`window.fetch = () => Promise.reject(new TypeError("Failed to fetch"))`);
    await expect(session.armFormGuard()).resolves.toBeUndefined();
  });

  it("is armed once, however many times it's asked", async () => {
    kind = "fetch";
    await start();
    const page = await open();
    await session.armFormGuard();
    await session.armFormGuard();
    await press(page);
    await settled();
    expect(session.heldRequests()).toBe(1);
  });

  it("keeps the session from loading any other page once it's armed", async () => {
    kind = "fetch";
    await start();
    await open();
    await session.armFormGuard();
    await expect(session.load(`${server.url}sent`, 5_000)).rejects.toThrow();
    expect(server.reaches()).toBe(0);
  });

  describe("when it can't be confirmed", () => {
    beforeEach(async () => {
      kind = "post form";
      await start();
    });

    it("rejects, and presses nothing, when the guard can't be confirmed", async () => {
      const page = await open();
      // A route that's accepted and never sees a request: the guard believes it's armed.
      vi.spyOn(page.context(), "route").mockResolvedValue(undefined as never);
      await expect(session.armFormGuard()).rejects.toThrow(/guard/);
      expect(server.reaches()).toBe(0);
    });

    it("rejects when the route can't be set", async () => {
      const page = await open();
      vi.spyOn(page.context(), "route").mockRejectedValue(new Error("no route"));
      await expect(session.armFormGuard()).rejects.toThrow(/no route/);
    });

    it("rejects when DevTools won't bypass the service workers", async () => {
      const page = await open();
      const cdp = (
        session as unknown as { cdp: { send: (...args: unknown[]) => Promise<unknown> } }
      ).cdp;
      const send = cdp.send.bind(cdp);
      vi.spyOn(cdp, "send").mockImplementation((method, ...rest) =>
        method === "Network.setBypassServiceWorker"
          ? Promise.reject(new Error("no bypass"))
          : send(method, ...rest),
      );
      await expect(session.armFormGuard()).rejects.toThrow(/no bypass/);
      await expect(page.locator("#go").count()).resolves.toBe(1);
    });

    it("rejects when the browser won't go offline", async () => {
      const page = await open();
      vi.spyOn(page.context(), "setOffline").mockRejectedValue(new Error("no offline"));
      await expect(session.armFormGuard()).rejects.toThrow(/no offline/);
    });

    it("rejects when a shared worker is still running", async () => {
      await open();
      const browser = (session as unknown as { browser: Browser }).browser;
      const real = browser.newBrowserCDPSession.bind(browser);
      vi.spyOn(browser, "newBrowserCDPSession").mockImplementation(async () => {
        const cdp = await real();
        const send = cdp.send.bind(cdp) as (...args: unknown[]) => Promise<unknown>;
        vi.spyOn(cdp, "send").mockImplementation(((method: string, ...rest: unknown[]) =>
          method === "Target.getTargets"
            ? Promise.resolve({ targetInfos: [{ type: "shared_worker" }] })
            : send(method, ...rest)) as never);
        return cdp;
      });
      await expect(session.armFormGuard()).rejects.toThrow(/shared worker/);
    });

    it("stays rejected when it's asked again, rather than seeming armed", async () => {
      const page = await open();
      vi.spyOn(page.context(), "route").mockRejectedValue(new Error("no route"));
      await expect(session.armFormGuard()).rejects.toThrow(/no route/);
      await expect(session.armFormGuard()).rejects.toThrow(/no route/);
    });
  });
});
