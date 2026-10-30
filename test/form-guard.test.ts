import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import dgram from "node:dgram";
import { createServer, request as httpRequest, type Server, type ServerResponse } from "node:http";
import { createServer as createTlsServer } from "node:https";
import net, { type AddressInfo, type Socket } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium, type Page } from "playwright";
import { generate } from "selfsigned";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formGateArgs,
  launchChrome,
  type ChromeSession,
  type LaunchChromeOptions,
} from "../src/drivers/guidepup/chrome.js";
import {
  isLoopback,
  listenForUdp,
  openFormGate,
  tunnelTarget,
  type FormGate,
} from "../src/drivers/guidepup/form-gate.js";

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

/** Opens a WebTransport session, if the realm has them, and quietly lets it fail. */
const OPEN_TRANSPORT = (url: string): string => `
  if (self.WebTransport) {
    const transport = new WebTransport(${url});
    transport.ready.catch(() => {});
    transport.closed.catch(() => {});
  }`;

/** A self-signed certificate for 127.0.0.1, made in memory when the test runs and kept nowhere. */
const makeTls = async (): Promise<{ key: string; cert: string }> => {
  const pems = await generate([{ name: "commonName", value: "127.0.0.1" }], {
    keyType: "ec",
    algorithm: "sha256",
    extensions: [
      { name: "basicConstraints", cA: true, critical: true },
      { name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] },
    ],
  });
  return { key: pems.private, cert: pems.cert };
};

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
    case "a pixel with what was typed in its address":
      return button(`new Image().src = "/pixel.gif?email=typed"`);
    case "a new stylesheet":
      return button(
        `document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/new.css" }))`,
      );
    case "a dynamic script with a query":
      return button(
        `document.head.append(Object.assign(document.createElement("script"), { src: "/new.js?email=typed" }))`,
      );
    case "a font at a new address":
      return button(`new FontFace("New", "url(/new.woff2?email=typed)").load().catch(() => {})`);
    case "a worker's imported script":
      return `${button(`worker.postMessage("/new.js?email=typed")`)}<script>const worker = new Worker("/importer.js");</script>`;
    case "a known image's address with what was typed":
      return `${button(`new Image().src = "/pic.png?email=typed"`)}<img src="/pic.png" alt="">`;
    case "a known image's cookie":
      return `${button(`document.cookie = "email=typed"; new Image().src = "/pic.png"`)}<img src="/pic.png" alt="">`;
    case "a known image's referrer":
      return `${button(`history.replaceState(null, "", "?email=typed"); new Image().src = "/pic.png"`)}<img src="/pic.png" alt="">`;
    case "a speculation rule's prefetch":
    case "a speculation rule's prerender": {
      const rule = kind.endsWith("prefetch") ? "prefetch" : "prerender";
      return button(
        `const rules = document.createElement("script"); rules.type = "speculationrules";
         rules.textContent = JSON.stringify({ ${rule}: [{ urls: ["/sent?a=secret"] }] });
         document.head.append(rules)`,
      );
    }
    case "a preconnect":
      return button(
        `document.head.append(Object.assign(document.createElement("link"), { rel: "preconnect", href: "${otherOrigin}" }))`,
      );
    case "a nested worker's address":
      return `${button(`worker.postMessage("send")`)}<script>const worker = new Worker("/nester.js");</script>`;
    case "a websocket opened before the guard":
      return `${button(`socket.send("secret")`)}<script>
        const socket = new WebSocket(location.origin.replace("http", "ws") + "/socket");
        window.ready = new Promise((resolve) => { socket.onopen = resolve; });
      </script>`;
    default:
      throw new Error(`no page for ${kind}`);
  }
};

/** A page's words when a socket inside a tunnel is open. */
const TUNNELLED = `${HEAD}<input id="go" oninput="socket.send(this.value)"><script>
  const socket = new WebSocket(location.origin.replace("http", "ws") + "/socket");
  window.ready = new Promise((resolve) => { socket.onopen = resolve; });
</script>`;

/** Enough of a WebSocket server to count a handshake, and each message a socket sends. */
function acceptSocket(request: { headers: Record<string, unknown> }, socket: Socket): void {
  const accept = createHash("sha1")
    .update(`${String(request.headers["sec-websocket-key"])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
}

/** Takes WebSockets on a server, adding what they do to what it's seen. */
function countSockets(server: Server, seen: string[], sockets: Set<Socket>): void {
  server.on("upgrade", (request, socket) => {
    seen.push("(socket)");
    sockets.add(socket as Socket);
    socket.on("error", () => {});
    socket.on("data", () => seen.push("(socket message)"));
    acceptSocket(request, socket as Socket);
  });
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
      "/nester.js": [
        "text/javascript",
        `self.onmessage = () => new Worker("/nested.js?email=typed");`,
      ],
      "/transport-nester.js": [
        "text/javascript",
        `self.onmessage = (event) => {
          const source = ${"`"}\${OPEN} ;${"`"};
          new Worker(URL.createObjectURL(new Blob([source.replace("URL", JSON.stringify(event.data))])));
        };`,
      ],
      "/importer.js": ["text/javascript", `self.onmessage = (event) => importScripts(event.data);`],
      "/transport-worker.js": [
        "text/javascript",
        `self.onmessage = (event) => { ${OPEN_TRANSPORT("event.data")} };`,
      ],
      "/transport-sw.js": [
        "text/javascript",
        `self.addEventListener("install", () => self.skipWaiting());
        self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
        self.addEventListener("message", (event) => { ${OPEN_TRANSPORT("event.data")} });`,
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
      "Cache-Control": "no-store",
      ...(csp && html !== undefined ? { "Content-Security-Policy": csp } : {}),
    };
    response.writeHead(200, headers);
    response.end(url.pathname === "/pic.png" ? PIXEL : (html ?? answer?.[1] ?? "ok"));
  });
  server.on("connection", () => seen.push("(connection)"));
  countSockets(server, seen, sockets);
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

/** What a proxy client gets for a request through the gate: its status, or null if hung up on. */
function throughGate(gate: FormGate, target: string): Promise<number | null> {
  return new Promise((resolve) => {
    const request = httpRequest({ host: "127.0.0.1", port: gate.port, path: target }, (answer) => {
      answer.resume();
      resolve(answer.statusCode ?? null);
    });
    request.on("error", () => resolve(null));
    request.end();
  });
}

describe("a form gate", () => {
  let gate: FormGate;
  let server: Counter;

  beforeEach(async () => {
    gate = await openFormGate();
    server = await countingServer(() => "fetch");
    server.mark();
  });
  afterEach(async () => {
    await gate.close();
    await server.close();
  });

  it("serves only this computer", () => {
    expect(["127.0.0.1", "::1", "::ffff:127.0.0.1"].every(isLoopback)).toBe(true);
    expect(["192.168.1.5", "10.0.0.1", "::ffff:10.0.0.1", undefined].some(isLoopback)).toBe(false);
  });

  it("forwards plain HTTP, and says what it's served", async () => {
    await expect(throughGate(gate, `${server.url}anything`)).resolves.toBe(200);
    expect(server.paths()).toContain("/anything");
    expect(gate.hasServed("127.0.0.1")).toBe(true);
    await expect(gate.refuses()).resolves.toBe(false);
  });

  it("refuses everything once shut, and for good", async () => {
    gate.shut();
    gate.shut();
    await expect(throughGate(gate, `${server.url}anything`)).resolves.toBeNull();
    await expect(gate.refuses()).resolves.toBe(true);
    await delay(STRAGGLER_MS);
    expect(server.reaches()).toBe(0);
  });

  it("listens for UDP on 127.0.0.1 only, and hears a datagram", async () => {
    const listener = await listenForUdp();
    const sender = dgram.createSocket("udp4");
    sender.send("hello", listener.port, listener.address);
    await vi.waitFor(() => expect(listener.heard()).toBe(1));
    sender.close();
    await listener.close();
    expect(listener.address).toBe("127.0.0.1");
  });

  it("reads a tunnel's port, port 80 among them", () => {
    const target = (url: string) => tunnelTarget({ url });
    expect(target("example.gov:80")).toEqual({ hostname: "example.gov", port: 80 });
    expect(target("example.gov:443")).toEqual({ hostname: "example.gov", port: 443 });
    expect(target("[::1]:80")).toEqual({ hostname: "[::1]", port: 80 });
    expect(target("example.gov")).toBeNull();
    expect(target("example.gov:0")).toBeNull();
    expect(target("example.gov:70000")).toBeNull();
  });

  it("answers a tunnel to port 80 while it's open, and refuses it once shut", async () => {
    const ask = () =>
      new Promise<string | null>((resolve) => {
        const tunnel = net.connect(gate.port, "127.0.0.1");
        tunnel.on("error", () => {});
        tunnel.write("CONNECT 127.0.0.1:80 HTTP/1.1\r\n\r\n");
        tunnel.once("data", (data) => {
          tunnel.destroy();
          resolve(data.toString());
        });
        tunnel.once("close", () => resolve(null));
      });
    await expect(ask()).resolves.toMatch(/^HTTP\/1\.1 (200|502)/);
    gate.shut();
    await expect(ask()).resolves.toBeNull();
  });

  it("cuts a request already under way", async () => {
    const answered = throughGate(gate, `${server.url}slow`);
    await vi.waitFor(() => expect(server.paths()).toContain("/slow"));
    gate.shut();
    await expect(answered).resolves.toBeNull();
  });

  it("cuts an open tunnel, in both directions", async () => {
    const tunnel = net.connect(gate.port, "127.0.0.1");
    const port = new URL(server.url).port;
    tunnel.on("error", () => {});
    tunnel.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\n\r\n`);
    await new Promise((resolve) => tunnel.once("data", resolve));
    const closed = new Promise((resolve) => tunnel.once("close", resolve));
    gate.shut();
    await closed;
    await delay(STRAGGLER_MS);
    expect(server.paths()).not.toContain("(socket message)");
  });
});

describe.skipIf(!haveChromium)("the form guard", () => {
  let kind = "";
  let server: Counter;
  let gate: FormGate;
  let session: ChromeSession;

  async function start(
    csp = "",
    spawnBrowser?: LaunchChromeOptions["spawnBrowser"],
  ): Promise<void> {
    server = await countingServer(() => kind, csp);
    gate = await openFormGate();
    session = await launchChrome({
      browser: { channel: "chromium", fallbackToChromium: false },
      env: process.env,
      extraArgs: [...HEADLESS, "--ignore-certificate-errors"],
      formGate: gate,
      ...(spawnBrowser ? { spawnBrowser } : {}),
    });
  }

  /** A launch whose profile sets another WebRTC policy. */
  const withPolicy =
    (policy: string): NonNullable<LaunchChromeOptions["spawnBrowser"]> =>
    (file, args) => {
      const profile = args.find((arg) => arg.startsWith("--user-data-dir="))?.split("=")[1] ?? "";
      mkdirSync(path.join(profile, "Default"), { recursive: true });
      writeFileSync(
        path.join(profile, "Default", "Preferences"),
        JSON.stringify({ webrtc: { ip_handling_policy: policy } }),
      );
      return spawn(file, args, { stdio: "ignore" });
    };

  /** A launch whose profile has lost the preference that turns direct UDP off. */
  const withoutPreference: LaunchChromeOptions["spawnBrowser"] = (file, args) => {
    const profile = args.find((arg) => arg.startsWith("--user-data-dir="))?.split("=")[1] ?? "";
    rmSync(path.join(profile, "Default", "Preferences"), { force: true });
    return spawn(file, args, { stdio: "ignore" });
  };

  /** The page's load, its setup, and its last quiet moment: what reaches the server after is sent. */
  async function open(url = server.url): Promise<Page> {
    await session.load(url, 15_000);
    const page = pageOf(session);
    await page.evaluate("window.ready");
    await delay(STRAGGLER_MS);
    server.mark();
    return page;
  }

  /** Press #go by the keyboard, in the page or its frame, or type in it. */
  async function press(page: Page): Promise<void> {
    const inFrame = kind.includes("cross-origin frame");
    const target = inFrame ? page.frameLocator("iframe").locator("#go") : page.locator("#go");
    await target.focus();
    await page.keyboard.press(kind.includes("input") ? "a" : "Enter");
  }

  /** Waits for the route to hold something, then gives anything that got past time to arrive. */
  async function settled(): Promise<void> {
    await vi.waitFor(
      () => {
        if (session.heldRequests() === 0 && server.reaches() === 0) throw new Error("nothing yet");
      },
      { timeout: SEND_LIMIT_MS, interval: 25 },
    );
    await delay(STRAGGLER_MS);
  }

  async function armAndPress(): Promise<Page> {
    await start();
    const page = await open();
    await session.armFormGuard();
    await press(page);
    return page;
  }

  afterEach(async () => {
    await session?.close();
    await server?.close();
  });

  // What the route sees: nothing arrives, and it's counted.
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
    "a pixel with what was typed in its address",
    "a new stylesheet",
    "a dynamic script with a query",
    "a font at a new address",
    "a worker's imported script",
    "a known image's address with what was typed",
    "a known image's cookie",
    "a known image's referrer",
    "a worker's websocket",
    "a websocket made from a constructor kept before the guard",
    "a cross-origin frame's websocket",
  ])("lets nothing out: %s", async (name) => {
    kind = name;
    await armAndPress();
    await settled();
    expect(server.paths()).toEqual([]);
    expect(server.reaches()).toBe(0);
    expect(session.heldRequests()).toBeGreaterThan(0);
  });

  // What only the wall stops: nothing arrives, and nothing in the browser sees it to count.
  it.each([
    "a shared worker's fetch",
    "a speculation rule's prefetch",
    "a speculation rule's prerender",
    "a preconnect",
    "a nested worker's address",
    "a websocket opened before the guard",
    "an input handler's send on a websocket opened before the guard",
    "cross-origin frame's websocket opened before the guard",
    "a worker's websocket opened before the guard",
    "a service worker's websocket opened before the guard",
  ])("lets nothing out, past the route: %s", async (name) => {
    kind = name;
    await armAndPress();
    await delay(STRAGGLER_MS * 3);
    expect(server.paths()).toEqual([]);
  });

  it("cuts what a request in flight as it arms would have gone on to send", async () => {
    kind = "a request in flight as the guard arms";
    await start();
    await open();
    await session.armFormGuard();
    server.answerSlow();
    await delay(STRAGGLER_MS * 2);
    expect(server.paths()).toEqual([]);
  });

  it("keeps a file the page already fetched from loading again, as it holds everything", async () => {
    kind = "a known image's cookie";
    await start();
    const page = await open();
    await session.armFormGuard();
    await page.evaluate(`fetch("/pic.png").catch(() => {})`);
    await settled();
    expect(server.paths()).toEqual([]);
  });

  describe("as the session closes", () => {
    it.each([
      [
        "a pagehide beacon",
        `addEventListener("pagehide", () => navigator.sendBeacon("/sent", "secret"))`,
      ],
      [
        "a pagehide keepalive fetch",
        `addEventListener("pagehide", () => fetch("/sent", { method: "POST", body: "secret", keepalive: true }))`,
      ],
      ["a fetchLater", `fetchLater("/sent", { method: "POST", body: "secret" })`],
    ])("lets nothing out: %s", async (_name, script) => {
      kind = "fetch";
      await start();
      const page = await open();
      await session.armFormGuard();
      await page.evaluate(script);
      await session.close();
      await delay(STRAGGLER_MS);
      expect(server.paths()).toEqual([]);
    });

    it("stays shut until the browser has gone, and is closed after", async () => {
      kind = "fetch";
      await start();
      await open();
      const shut = vi.spyOn(gate, "shut");
      const close = vi.spyOn(gate, "close");
      const killed = new Promise<void>((resolve) =>
        (
          session as unknown as { child: { once(event: "exit", then: () => void): void } }
        ).child.once("exit", () => {
          expect(shut).toHaveBeenCalled();
          expect(close).not.toHaveBeenCalled();
          resolve();
        }),
      );
      await session.close();
      await killed;
      expect(close).toHaveBeenCalled();
    });

    it("shuts the gate when a session is left behind", async () => {
      kind = "fetch";
      await start();
      await open();
      session.abandon();
      await expect(gate.refuses()).resolves.toBe(true);
    });
  });

  describe("through a tunnel", () => {
    let seen: string[];
    let tls: Server;
    let tlsUrl: string;
    const sockets = new Set<Socket>();

    beforeEach(async () => {
      seen = [];
      sockets.clear();
      tls = createTlsServer(await makeTls(), (request, response) => {
        request.resume();
        seen.push(request.url ?? "");
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(request.url === "/" ? TUNNELLED : "ok");
      });
      countSockets(tls, seen, sockets);
      await new Promise<void>((resolve) => tls.listen(0, "127.0.0.1", resolve));
      tlsUrl = `https://127.0.0.1:${(tls.address() as AddressInfo).port}/`;
      kind = "fetch";
      await start();
    });
    afterEach(async () => {
      for (const socket of sockets) socket.destroy();
      tls.closeAllConnections();
      await new Promise<void>((resolve) => tls.close(() => resolve()));
    });

    it("loads an https page through the gate, by CONNECT", async () => {
      const result = await session.load(tlsUrl, 15_000);
      expect(result.status).toBe(200);
      expect(seen).toContain("/");
      expect(gate.hasServed("127.0.0.1")).toBe(true);
    });

    it("cuts a tunnel and the socket in it, both opened before it's armed", async () => {
      const page = await open(tlsUrl);
      expect(seen).toContain("(socket)");
      const before = seen.length;
      const [socket] = sockets;
      const cut = new Promise((resolve) => socket?.once("close", resolve));
      await session.armFormGuard();
      await cut;
      kind = "input";
      await press(page);
      await delay(STRAGGLER_MS);
      await page.evaluate(`fetch("/after").catch(() => {})`);
      await delay(STRAGGLER_MS);
      expect(seen.slice(before)).toEqual([]);
    });
  });

  describe("past TCP and HTTP", () => {
    let packets = 0;
    let connections = 0;
    let udp: dgram.Socket;
    let tcp: net.Server;
    let udpPort = 0;
    let tcpPort = 0;

    beforeEach(async () => {
      packets = 0;
      connections = 0;
      udp = dgram.createSocket("udp4");
      udp.on("message", () => (packets += 1));
      await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
      udpPort = udp.address().port;
      tcp = net.createServer((socket) => {
        connections += 1;
        socket.on("error", () => {});
      });
      await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve));
      tcpPort = (tcp.address() as AddressInfo).port;
      kind = "fetch";
      await start();
    });

    afterEach(async () => {
      udp.close();
      await new Promise<void>((resolve) => tcp.close(() => resolve()));
    });

    const peerConnection = (realm: string, ice: string) => `(async () => {
      const peer = new ${realm}.RTCPeerConnection({ iceServers: [${ice}] });
      peer.createDataChannel("sent");
      await peer.setLocalDescription(await peer.createOffer());
      window.peer = peer;
    })()`;
    const stun = () => `{ urls: "stun:127.0.0.1:${udpPort}" }`;
    const turnTcp = () =>
      `{ urls: "turn:127.0.0.1:${tcpPort}?transport=tcp", username: "secret", credential: "x" }`;
    const transportUrl = () => `https://127.0.0.1:${udpPort}/`;

    it("stops WebRTC, over UDP and TCP, in the page", async () => {
      const page = await open();
      await session.armFormGuard();
      await page.evaluate(peerConnection("window", stun()));
      await page.evaluate(peerConnection("window", turnTcp()));
      await delay(STRAGGLER_MS * 3);
      expect([packets, connections]).toEqual([0, 0]);
    });

    it("stops WebRTC over TCP in a frame made after it's armed", async () => {
      const page = await open();
      await session.armFormGuard();
      await page.evaluate(`(() => {
        const frame = document.createElement("iframe");
        document.body.append(frame);
        window.frameWindow = frame.contentWindow;
      })()`);
      await expect(page.evaluate("typeof frameWindow.RTCPeerConnection")).resolves.toBe("function");
      await page.evaluate(peerConnection("window.frameWindow", turnTcp()));
      await delay(STRAGGLER_MS * 3);
      expect(connections).toBe(0);
    });

    it("stops WebTransport in the page", async () => {
      const page = await open();
      await session.armFormGuard();
      await page.evaluate(OPEN_TRANSPORT(`"${transportUrl()}"`));
      await delay(STRAGGLER_MS * 2);
      expect(packets).toBe(0);
    });

    it("keeps WebTransport off a browser behind a gate, even before it's armed", async () => {
      const page = await open();
      await page.evaluate(OPEN_TRANSPORT(`"${transportUrl()}"`));
      await delay(STRAGGLER_MS * 2);
      expect(packets).toBe(0);
    });

    it("stops WebTransport in a worker, and in a service worker", async () => {
      const page = await open();
      await page.evaluate(`window.worker = new Worker("/transport-worker.js")`);
      await page.evaluate(`navigator.serviceWorker.register("/transport-sw.js").then(() => new Promise((resolve) => {
        if (navigator.serviceWorker.controller) resolve();
        navigator.serviceWorker.addEventListener("controllerchange", resolve);
      }))`);
      await delay(STRAGGLER_MS);
      await session.armFormGuard();
      await page.evaluate(`worker.postMessage("${transportUrl()}");
        navigator.serviceWorker.controller.postMessage("${transportUrl()}")`);
      await delay(STRAGGLER_MS * 2);
      expect(packets).toBe(0);
    });

    it("stops a nested worker's WebTransport", async () => {
      const page = await open();
      await page.evaluate(`window.worker = new Worker("/transport-nester.js")`);
      await delay(STRAGGLER_MS);
      await session.armFormGuard();
      await page.evaluate(`worker.postMessage("${transportUrl()}")`);
      await delay(STRAGGLER_MS * 2);
      expect(packets).toBe(0);
    });

    it("stops new Worker.prototype.constructor(blob) and its WebTransport", async () => {
      const page = await open();
      await session.armFormGuard();
      const source = JSON.stringify(OPEN_TRANSPORT(`"${transportUrl()}"`));
      await page.evaluate(`new Worker.prototype.constructor(URL.createObjectURL(new Blob([${source}])))
        .postMessage("go")`);
      await delay(STRAGGLER_MS * 2);
      expect(packets).toBe(0);
    });
  });

  it("stays shut whatever a page's script does", async () => {
    kind = "fetch";
    await start();
    const page = await open();
    await session.armFormGuard();
    await page.evaluate(`(async () => {
      for (let i = 0; i < 20; i += 1) {
        fetch("/again?" + i).catch(() => {});
        navigator.sendBeacon("/again", "secret");
        new WebSocket(location.origin.replace("http", "ws") + "/socket").onerror = () => {};
        new Image().src = "/again.png?" + i;
        new Worker(URL.createObjectURL(new Blob(['fetch("/again")'])));
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    })()`);
    await delay(STRAGGLER_MS);
    await expect(gate.refuses()).resolves.toBe(true);
    expect(server.paths()).toEqual([]);
  });

  it("leaves the page where it is when a form's post is held", async () => {
    kind = "post form";
    const page = await armAndPress();
    await settled();
    expect(page.url()).toBe(server.url);
    await expect(page.locator("#go").count()).resolves.toBe(1);
  });

  it("counts what the page sends, and not its own confirmation", async () => {
    kind = "fetch";
    await start();
    await open();
    await session.armFormGuard();
    expect(session.heldRequests()).toBe(0);
    expect(server.reaches()).toBe(0);
  });

  it("closes a new window, and the session's page stays", async () => {
    kind = "window.open";
    const page = await armAndPress();
    await settled();
    await vi.waitFor(() => expect(page.context().pages()).toEqual([page]), { timeout: 10_000 });
    expect(session.strayWindows()).toBe(0);
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

  describe("direct UDP", () => {
    const udpMessage = /direct UDP/;

    it("arms with the preference in place", async () => {
      kind = "fetch";
      await start();
      await open();
      await expect(session.armFormGuard()).resolves.toBeUndefined();
    });

    it("rejects, and presses nothing, when the preference is gone", async () => {
      kind = "post form";
      await start("", withoutPreference);
      await open();
      await expect(session.armFormGuard()).rejects.toThrow(udpMessage);
      expect(server.reaches()).toBe(0);
    });

    it("rejects when a page's script fakes a browser with no candidates", async () => {
      kind = "fetch";
      await start("", withoutPreference);
      const page = await open();
      await page.evaluate(`(() => {
        const nothing = function () {
          return {
            createDataChannel() {},
            createOffer: async () => ({}),
            setLocalDescription: async function () {
              this.iceGatheringState = "complete";
            },
            close() {},
            iceGatheringState: "complete",
            addEventListener() {},
          };
        };
        window.RTCPeerConnection = nothing;
        RTCPeerConnection.prototype.createOffer = async () => ({});
      })()`);
      await expect(session.armFormGuard()).rejects.toThrow(udpMessage);
    });

    it("rejects when a page's Content Security Policy would hide the candidates", async () => {
      kind = "fetch";
      await start("webrtc 'block'", withoutPreference);
      await open();
      await expect(session.armFormGuard()).rejects.toThrow(udpMessage);
    });

    it("arms on a page whose Content Security Policy blocks WebRTC, with the preference in place", async () => {
      kind = "fetch";
      await start("webrtc 'block'");
      await open();
      await expect(session.armFormGuard()).resolves.toBeUndefined();
    });

    it.each([
      "default",
      "default_public_and_private_interfaces",
      "default_public_interface_only",
      "not_a_policy",
    ])("rejects on the policy %s, under which UDP really does go out", async (policy) => {
      kind = "fetch";
      await start("", withPolicy(policy));
      const page = await open();
      const control = await listenForUdp();
      try {
        await page.evaluate(`(async () => {
          const peer = new RTCPeerConnection({
            iceServers: [{ urls: "stun:${control.address}:${control.port}" }],
          });
          peer.createDataChannel("sent");
          await peer.setLocalDescription(await peer.createOffer());
          window.peer = peer;
        })()`);
        await vi.waitFor(() => expect(control.heard()).toBeGreaterThan(0), { timeout: 5_000 });
      } finally {
        await control.close();
      }
      await expect(session.armFormGuard()).rejects.toThrow(/direct UDP/);
    });

    it("rejects when the listener heard something, even if gathering says all's well", async () => {
      kind = "fetch";
      await start("", withPolicy("default_public_interface_only"));
      await open();
      const cdp = (
        session as unknown as { cdp: { send: (...args: unknown[]) => Promise<unknown> } }
      ).cdp;
      const send = cdp.send.bind(cdp);
      vi.spyOn(cdp, "send").mockImplementation(async (method, ...rest) => {
        const answer = await send(method, ...rest);
        return method === "Runtime.callFunctionOn" ? { result: { value: "none" } } : answer;
      });
      await expect(session.armFormGuard()).rejects.toThrow(/direct UDP/);
    });

    it("rejects when the check can't finish", async () => {
      kind = "fetch";
      await start();
      await open();
      const cdp = (
        session as unknown as { cdp: { send: (...args: unknown[]) => Promise<unknown> } }
      ).cdp;
      const send = cdp.send.bind(cdp);
      vi.spyOn(cdp, "send").mockImplementation((method, ...rest) =>
        method === "Runtime.callFunctionOn"
          ? Promise.resolve({ result: { value: "unfinished" } })
          : send(method, ...rest),
      );
      await expect(session.armFormGuard()).rejects.toThrow(/direct UDP/);
    });
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

    it("rejects when the route can't be set, and the gate stays shut", async () => {
      const page = await open();
      vi.spyOn(page.context(), "route").mockRejectedValue(new Error("no route"));
      await expect(session.armFormGuard()).rejects.toThrow(/no route/);
      await expect(gate.refuses()).resolves.toBe(true);
    });

    it("rejects when the gate still answers", async () => {
      await open();
      vi.spyOn(gate, "refuses").mockResolvedValue(false);
      await expect(session.armFormGuard()).rejects.toThrow(/still answers/);
    });

    it("rejects when the page didn't come through the gate", async () => {
      await open();
      vi.spyOn(gate, "hasServed").mockReturnValue(false);
      await expect(session.armFormGuard()).rejects.toThrow(/didn't load through/);
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

    it("rejects rather than hang when a step never answers", async () => {
      await open();
      const cdp = (
        session as unknown as { cdp: { send: (...args: unknown[]) => Promise<unknown> } }
      ).cdp;
      vi.spyOn(cdp, "send").mockImplementation(() => new Promise(() => {}));
      await expect(session.armFormGuard()).rejects.toThrow(/within/);
    }, 25_000);

    it("stays rejected when it's asked again, rather than seeming armed", async () => {
      const page = await open();
      vi.spyOn(page.context(), "route").mockRejectedValue(new Error("no route"));
      await expect(session.armFormGuard()).rejects.toThrow(/no route/);
      await expect(session.armFormGuard()).rejects.toThrow(/no route/);
    });
  });
});

describe.skipIf(!haveChromium)("a browser with no form gate", () => {
  it("has no proxy switches, keeps WebRTC, and can't be armed", async () => {
    const seen: string[][] = [];
    const server = await countingServer(() => "fetch");
    const session = await launchChrome({
      browser: { channel: "chromium", fallbackToChromium: false },
      env: process.env,
      extraArgs: HEADLESS,
      spawnBrowser: (file, args) => {
        seen.push(args);
        return spawn(file, args, { stdio: "ignore" });
      },
    });
    try {
      await session.load(server.url, 15_000);
      const page = pageOf(session);
      const apis = "[typeof RTCPeerConnection, typeof WebTransport, typeof Worker].join()";
      await expect(page.evaluate(apis)).resolves.toBe("function,function,function");
      for (const name of ["proxy", "host-resolver", "quic", "webrtc"]) {
        expect(seen.flat().filter((arg) => arg.includes(name))).toEqual([]);
      }
      await expect(session.armFormGuard()).rejects.toThrow(/no form gate/);
    } finally {
      await session.close();
      await server.close();
    }
  });

  it("gets the switches only from a gate", () => {
    expect(formGateArgs({ port: 4321 })).toEqual([
      "--proxy-server=http://127.0.0.1:4321",
      "--proxy-bypass-list=<-loopback>",
      "--disable-quic",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    ]);
  });
});
