/**
 * Serves the test fixture site (fixture/site) for voicecap runs and tests.
 *
 *   pnpm fixture:serve        # http://127.0.0.1:4747/ until Ctrl+C
 *
 * The sitemaps list absolute http://127.0.0.1:4747 URLs, so real runs use the fixed port. Tests
 * import startFixtureServer and pass port 0 to get a free port instead.
 */
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FIXTURE_HOST = "127.0.0.1";
export const FIXTURE_PORT = 4747;
export const FIXTURE_SITE_DIR = fileURLToPath(new URL("../fixture/site/", import.meta.url));

/** Where /contact/ redirects: another origin, so voicecap records the page as skipped. */
export const CONTACT_REDIRECT = "https://www.example.com/contact/";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

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
      if (!response.headersSent) send(response, 500, "text/plain; charset=utf-8", "Server error");
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
  return {
    url: `http://${host}:${port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    send(response, 405, "text/plain; charset=utf-8", "Method not allowed");
    return;
  }
  // Keep the raw path: the traversal check below must see "..", which URL parsing would remove.
  const rawPath = (request.url ?? "/").split("?")[0]!.split("#")[0]!;
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    send(response, 400, "text/plain; charset=utf-8", "Bad request");
    return;
  }

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

  const file = resolveInsideSite(pathname);
  if (file === null) {
    await sendNotFound(response, request.method);
    return;
  }
  const info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    if (!pathname.endsWith("/")) {
      // Like most static hosts: /duplicates → /duplicates/ (voicecap records the final URL).
      response.writeHead(301, { Location: `${rawPath}/`, "Cache-Control": "no-store" });
      response.end();
      return;
    }
    const index = path.join(file, "index.html");
    if (!(await stat(index).catch(() => null))?.isFile()) {
      await sendNotFound(response, request.method);
      return;
    }
    send(response, 200, CONTENT_TYPES[".html"]!, await readFile(index), request.method);
    return;
  }
  if (!info?.isFile()) {
    await sendNotFound(response, request.method);
    return;
  }
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  send(response, 200, type, await readFile(file), request.method);
}

/** Map a decoded URL path to a file under the site folder, or null if it would escape it. */
function resolveInsideSite(pathname: string): string | null {
  if (pathname.includes("\0")) return null;
  const segments = pathname.split(/[\\/]+/).filter((segment) => segment !== "");
  if (segments.some((segment) => segment === "..")) return null;
  const file = path.resolve(FIXTURE_SITE_DIR, ...segments);
  const relative = path.relative(FIXTURE_SITE_DIR, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return file;
}

async function sendNotFound(response: ServerResponse, method: string | undefined): Promise<void> {
  const page = await readFile(path.join(FIXTURE_SITE_DIR, "404.html"));
  send(response, 404, CONTENT_TYPES[".html"]!, page, method);
}

function send(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
  method?: string,
): void {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(method === "HEAD" ? undefined : body);
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
