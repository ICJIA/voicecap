/**
 * The demo site's server, for voicecap demo: serves demo/site/, which ships in the package, on
 * 127.0.0.1, at port 4848 when it's free and any free port otherwise. It writes /sitemap.xml and
 * /robots.txt from the address it's serving, and gives a 404 page for anything else. The question
 * form is a GET to ask-a-question/sent.html, a file like any other, since the website serves these
 * pages too (see DEMO_CANONICAL) and a static host can't answer a post: so the server answers no
 * POST. Nothing is fetched from anywhere, and nothing a visitor sends is kept.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import {
  closeServer,
  CONTENT_TYPES,
  requestPath,
  send,
  sendNotFound,
  serveStatic,
} from "../util/static-site.js";

export const DEMO_HOST = "127.0.0.1";
export const DEMO_PORT = 4848;
/** The sitemap's name on the demo site: what the demo's run gives --sitemap. */
export const DEMO_SITEMAP = "sitemap.xml";
// This file is src/demo/server.ts (tests) or dist/demo/server.js (published): either way, the
// package root is two levels up, and demo/site/ is in it.
export const DEMO_SITE_DIR = fileURLToPath(new URL("../../demo/site/", import.meta.url));
/**
 * The demo's canonical address: where `voicecap site` publishes the demo's pages, inside the
 * website. Each page's `<link rel="canonical">` names its own address under it, so a run on the copy
 * at this computer learns the site's real name.
 */
export const DEMO_CANONICAL = "https://voicecap.icjia.app/demo-site/";
/**
 * The demo site's pages, in the tour's order: what /sitemap.xml lists. ask-a-question/sent.html,
 * which the question form goes to, is a page of the site too, but it's reached by the form, not the
 * tour, so it isn't listed.
 */
export const DEMO_PAGES = [
  "/",
  "/before-you-start/",
  "/how-a-run-works/",
  "/reading-transcripts/",
  "/the-report/",
  "/ask-a-question/",
  "/common-mistakes/",
] as const;
/** Errors that mean the port can't be had: in use, or in a range Windows reserves (Hyper-V, WSL). */
const PORT_UNAVAILABLE = new Set(["EADDRINUSE", "EACCES"]);

export interface DemoServer {
  /** e.g. "http://127.0.0.1:4848", with no trailing slash: what --site takes. */
  origin: string;
  close(): Promise<void>;
}

/**
 * Starts the demo site's server. `port` is the one to try first (default 4848); `siteDir` is the
 * folder to serve (default demo/site/). Tests give both.
 */
export async function startDemoServer(
  options: { port?: number; siteDir?: string } = {},
): Promise<DemoServer> {
  const siteDir = options.siteDir ?? DEMO_SITE_DIR;
  // Set once the server listens, before any request can arrive.
  let origin = "";
  const server = createServer((request, response) => {
    handle(request, response, siteDir, origin).catch(() => {
      if (!response.headersSent) send(response, 500, CONTENT_TYPES[".txt"]!, "Server error");
      else response.end();
    });
  });
  const port = await listenWithFallback(
    (candidate) => listen(server, candidate),
    options.port ?? DEMO_PORT,
  );
  origin = `http://${DEMO_HOST}:${port}`;
  return { origin, close: () => closeServer(server) };
}

/**
 * Listens on `preferred`, or on any free port when that one is in use or reserved. `listen`
 * listens on a port (0 for any free one) and resolves to the port it got. Any other error is
 * thrown.
 */
export async function listenWithFallback(
  listen: (port: number) => Promise<number>,
  preferred: number,
): Promise<number> {
  try {
    return await listen(preferred);
  } catch (error) {
    if (!PORT_UNAVAILABLE.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
    return listen(0);
  }
}

/** Listens on `port` at DEMO_HOST, resolving to the port it got, or rejecting with the error. */
function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error) => {
      server.off("listening", listening);
      reject(error);
    };
    const listening = () => {
      server.off("error", failed);
      resolve((server.address() as AddressInfo).port);
    };
    server.once("error", failed);
    server.once("listening", listening);
    server.listen(port, DEMO_HOST);
  });
}

/**
 * The sitemap: a <urlset> of the demo's pages, each at `base`, the address they're served at with
 * no slash on the end: the origin being served, or, for the website's copy, its origin and the
 * path the pages are under (`https://voicecap.icjia.app/demo-site`).
 */
export function sitemapXml(base: string): string {
  const urls = DEMO_PAGES.map((page) => `  <url><loc>${base}${page}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

/** robots.txt: everything allowed, and where the sitemap is. */
export function robotsTxt(origin: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/${DEMO_SITEMAP}\n`;
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  siteDir: string,
  origin: string,
): Promise<void> {
  const where = requestPath(request);
  if (where === null) {
    send(response, 400, CONTENT_TYPES[".txt"]!, "Bad request");
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    send(response, 405, CONTENT_TYPES[".txt"]!, "Method not allowed");
    return;
  }
  if (where.decoded === `/${DEMO_SITEMAP}`) {
    send(response, 200, CONTENT_TYPES[".xml"]!, sitemapXml(origin), request.method);
    return;
  }
  if (where.decoded === "/robots.txt") {
    send(response, 200, CONTENT_TYPES[".txt"]!, robotsTxt(origin), request.method);
    return;
  }
  if (!(await serveStatic(siteDir, where, request, response))) {
    await sendNotFound(siteDir, response, request.method);
  }
}
