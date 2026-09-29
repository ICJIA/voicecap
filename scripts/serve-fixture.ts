/**
 * Serves the test fixture site (fixture/site) for voicecap runs and tests.
 *
 *   pnpm fixture:serve        # http://127.0.0.1:4747/ until Ctrl+C
 *
 * The sitemaps list absolute http://127.0.0.1:4747 URLs, so real runs use the fixed port. Tests
 * import startFixtureServer and pass port 0 to get a free port instead. The static files are
 * served as the demo site's are (src/util/static-site.ts).
 */
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  closeServer,
  CONTENT_TYPES,
  requestPath,
  send,
  sendNotFound,
  serveStatic,
} from "../src/util/static-site.js";

export const FIXTURE_HOST = "127.0.0.1";
export const FIXTURE_PORT = 4747;
export const FIXTURE_SITE_DIR = fileURLToPath(new URL("../fixture/site/", import.meta.url));

/** Where /contact/ redirects: another origin, so voicecap records the page as skipped. */
export const CONTACT_REDIRECT = "https://www.example.com/contact/";

export interface FixtureServer {
  /** Base URL with a trailing slash, e.g. "http://127.0.0.1:4747/". */
  url: string;
  close(): Promise<void>;
}

/** Start the fixture server. Port 0 picks a free port. */
export async function startFixtureServer(
  options: { port?: number; host?: string } = {},
): Promise<FixtureServer> {
  const host = options.host ?? FIXTURE_HOST;
  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) send(response, 500, CONTENT_TYPES[".txt"]!, "Server error");
      else response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? FIXTURE_PORT, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://${host}:${port}/`, close: () => closeServer(server) };
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    send(response, 405, CONTENT_TYPES[".txt"]!, "Method not allowed");
    return;
  }
  const where = requestPath(request);
  if (where === null) {
    send(response, 400, CONTENT_TYPES[".txt"]!, "Bad request");
    return;
  }

  const pathname = where.decoded;
  if (pathname === "/contact" || pathname === "/contact/") {
    response.writeHead(302, { Location: CONTACT_REDIRECT, "Cache-Control": "no-store" });
    response.end();
    return;
  }
  if (pathname === "/feed" || pathname === "/feed/") {
    // No file extension in the URL, but the response isn't HTML.
    const rss = await readFile(path.join(FIXTURE_SITE_DIR, "feed", "feed.xml"));
    send(response, 200, "application/rss+xml; charset=utf-8", rss, request.method);
    return;
  }
  if (!(await serveStatic(FIXTURE_SITE_DIR, where, request, response))) {
    await sendNotFound(FIXTURE_SITE_DIR, response, request.method);
  }
}

async function main(): Promise<void> {
  const server = await startFixtureServer();
  console.log(`Fixture site: ${server.url}  (sitemap: ${server.url}sitemap.xml)`);
  console.log("Press Ctrl+C to stop.");
  const stop = () => {
    void server.close().then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
