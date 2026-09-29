/**
 * Serving a folder of static files over HTTP, shared by the demo site's server
 * (src/demo/server.ts) and the test fixture's (scripts/serve-fixture.ts). A folder URL serves its
 * index.html, a folder without its trailing slash redirects to the slashed URL, and a path that
 * would leave the folder is refused. Nothing is cached.
 */
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import path from "node:path";

export const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** A request's path without its query or fragment: as sent, and decoded. */
export interface RequestPath {
  /** As sent, for a redirect's Location. */
  raw: string;
  /** Decoded, for finding the file. */
  decoded: string;
}

/** The request's path, or null when it can't be decoded (a 400). */
export function requestPath(request: IncomingMessage): RequestPath | null {
  // Keep the raw path: the traversal check must see "..", which URL parsing would remove.
  const raw = (request.url ?? "/").split("?")[0]!.split("#")[0]!;
  try {
    return { raw, decoded: decodeURIComponent(raw) };
  } catch {
    return null;
  }
}

/** Map a decoded URL path to a file under `siteDir`, or null if it would escape it. */
export function resolveInsideSite(siteDir: string, pathname: string): string | null {
  if (pathname.includes("\0")) return null;
  const segments = pathname.split(/[\\/]+/).filter((segment) => segment !== "");
  if (segments.some((segment) => segment === "..")) return null;
  const file = path.resolve(siteDir, ...segments);
  const relative = path.relative(siteDir, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return file;
}

/**
 * Answers a GET or HEAD from `siteDir`: the file, a folder's index.html, or a 301 to a folder's
 * slashed URL. Returns false, having sent nothing, when there's nothing there: the caller sends
 * its 404.
 */
export async function serveStatic(
  siteDir: string,
  where: RequestPath,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const file = resolveInsideSite(siteDir, where.decoded);
  if (file === null) return false;
  const info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    if (!where.decoded.endsWith("/")) {
      // Like most static hosts: /about → /about/ (voicecap records the final URL).
      response.writeHead(301, { Location: `${where.raw}/`, "Cache-Control": "no-store" });
      response.end();
      return true;
    }
    const index = path.join(file, "index.html");
    if (!(await stat(index).catch(() => null))?.isFile()) return false;
    send(response, 200, CONTENT_TYPES[".html"]!, await readFile(index), request.method);
    return true;
  }
  if (!info?.isFile()) return false;
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  send(response, 200, type, await readFile(file), request.method);
  return true;
}

/** `siteDir`'s 404.html, with status 404. */
export async function sendNotFound(
  siteDir: string,
  response: ServerResponse,
  method: string | undefined,
): Promise<void> {
  const page = await readFile(path.join(siteDir, "404.html"));
  send(response, 404, CONTENT_TYPES[".html"]!, page, method);
}

/** Sends a whole response, marked not to be cached. A HEAD gets the headers only. */
export function send(
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

/** Stops `server`, ending its open connections (a browser's keep-alive ones) first. */
export function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
