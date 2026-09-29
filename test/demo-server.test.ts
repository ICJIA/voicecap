import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEMO_PAGES,
  DEMO_PORT,
  listenWithFallback,
  startDemoServer,
  type DemoServer,
} from "../src/demo/server.js";
import { fetchSitemap } from "../src/pages/sitemap.js";

/** Text in a file outside the site folder: a traversal that escapes it would find this. */
const SECRET = "do-not-serve-this-secret";

/**
 * A small stand-in for demo/site/, so these tests don't depend on its wording. The site lives in
 * a site/ subfolder, with a sentinel file beside it: a traversal that escapes the site folder
 * finds a real file this way, where the OS temp root has no package.json to find instead.
 */
async function stubSite(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-demo-site-"));
  await writeFile(path.join(dir, "secret.txt"), SECRET);
  const site = path.join(dir, "site");
  await mkdir(path.join(site, "ask-a-question"), { recursive: true });
  await writeFile(path.join(site, "index.html"), "<!doctype html><title>Welcome</title>");
  await writeFile(path.join(site, "404.html"), "<!doctype html><title>Page not found</title>");
  await writeFile(path.join(site, "style.css"), "body { color: #181f3a; }");
  await writeFile(path.join(site, "ask-a-question", "index.html"), "<!doctype html><form>");
  await writeFile(
    path.join(site, "ask-a-question", "sent.html"),
    "<!doctype html><title>Nothing was sent: this is a demo</title>",
  );
  return site;
}

/** A port nothing listens on right now. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** Send a GET with the path exactly as given (fetch would normalize "/../"). */
function rawGet(origin: string, rawPath: string): Promise<{ status: number; body: string }> {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: url.hostname, port: url.port, path: rawPath, method: "GET" },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("the demo server", () => {
  let siteDir: string;
  let server: DemoServer;

  beforeAll(async () => {
    siteDir = await stubSite();
    server = await startDemoServer({ port: await freePort(), siteDir });
  });
  afterAll(async () => {
    await server.close();
  });

  it("tries port 4848 first, unless told otherwise", async () => {
    expect(DEMO_PORT).toBe(4848);
    const port = await freePort();
    const own = await startDemoServer({ port, siteDir });
    try {
      expect(own.origin).toBe(`http://127.0.0.1:${port}`);
    } finally {
      await own.close();
    }
  });

  it("takes any free port when that one is in use", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const taken = (blocker.address() as AddressInfo).port;
    try {
      const own = await startDemoServer({ port: taken, siteDir });
      try {
        expect(own.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(own.origin).not.toBe(`http://127.0.0.1:${taken}`);
        expect((await fetch(`${own.origin}/`)).status).toBe(200);
      } finally {
        await own.close();
      }
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("lists the seven pages in /sitemap.xml, at the origin it's serving", async () => {
    const sitemap = await fetchSitemap(`${server.origin}/sitemap.xml`);
    expect(DEMO_PAGES).toHaveLength(7);
    expect(sitemap.urls.map((entry) => entry.loc)).toEqual(
      DEMO_PAGES.map((page) => `${server.origin}${page}`),
    );
  });

  it("names the sitemap in /robots.txt", async () => {
    const response = await fetch(`${server.origin}/robots.txt`);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await response.text()).toBe(
      `User-agent: *\nAllow: /\n\nSitemap: ${server.origin}/sitemap.xml\n`,
    );
  });

  it("serves the pages and the stylesheet", async () => {
    const home = await fetch(`${server.origin}/`);
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await home.text()).toContain("Welcome");
    const style = await fetch(`${server.origin}/style.css`);
    expect(style.headers.get("content-type")).toMatch(/^text\/css/);
  });

  it("answers the question form's POST with its page", async () => {
    const response = await fetch(`${server.origin}/ask-a-question/`, {
      method: "POST",
      body: new URLSearchParams({ question: "Is this sent anywhere?" }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Nothing was sent: this is a demo");
  });

  it("refuses a POST anywhere else", async () => {
    const response = await fetch(`${server.origin}/`, { method: "POST", body: "x" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("gives its 404 page for a page that isn't there, and for a path outside the site", async () => {
    const missing = await fetch(`${server.origin}/no-such-page/`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("Page not found");

    for (const rawPath of [
      "/../secret.txt",
      "/%2e%2e/secret.txt",
      "/..%2fsecret.txt",
      "/%2e%2e%5csecret.txt",
    ]) {
      const response = await rawGet(server.origin, rawPath);
      expect(response.status, rawPath).not.toBe(200);
      expect(response.body, rawPath).not.toContain(SECRET);
    }
  });

  it("stops answering once it's closed", async () => {
    const own = await startDemoServer({ port: await freePort(), siteDir });
    await own.close();
    await expect(fetch(`${own.origin}/`)).rejects.toThrow();
  });
});

describe("listenWithFallback", () => {
  const failure = (code: string) =>
    Object.assign(new Error(`listen ${code}: 127.0.0.1:4848`), { code });

  it("takes the preferred port when it can", async () => {
    await expect(listenWithFallback((port) => Promise.resolve(port), 4848)).resolves.toBe(4848);
  });

  // Windows reserves ranges of ports (for Hyper-V, WSL, and Docker), and listening on a port in
  // one fails with EACCES, not EADDRINUSE.
  it.each(["EADDRINUSE", "EACCES"])(
    "takes any free port when the preferred one gives %s",
    async (code) => {
      const tried: number[] = [];
      const port = await listenWithFallback((candidate) => {
        tried.push(candidate);
        return candidate === 4848 ? Promise.reject(failure(code)) : Promise.resolve(51234);
      }, 4848);
      expect(port).toBe(51234);
      expect(tried).toEqual([4848, 0]);
    },
  );

  it("passes on any other error", async () => {
    await expect(
      listenWithFallback(() => Promise.reject(failure("EADDRNOTAVAIL")), 4848),
    ).rejects.toThrow("EADDRNOTAVAIL");
  });
});
