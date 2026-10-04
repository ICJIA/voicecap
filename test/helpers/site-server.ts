/**
 * A built website served as Netlify serves it, for the tests that open it in a browser: each file at
 * its address (serveStatic, src/util/static-site.ts), and each rule of the site's _headers giving its
 * headers to the response for its path. A rule is for its exact path, since voicecap writes no
 * wildcard, and the page at /<folder>/<name>.html isn't also served at /<folder>/<name>. A .docx and
 * a .json have no content type of their own here: serveStatic sends each as application/octet-stream.
 *
 * The server is on 127.0.0.1, at a free port, and is stopped by `close`.
 */
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import {
  closeServer,
  CONTENT_TYPES,
  requestPath,
  send,
  serveStatic,
} from "../../src/util/static-site.js";

const HOST = "127.0.0.1";

export interface SiteServer {
  /** The site's address, with its closing slash: "http://127.0.0.1:52713/". */
  url: string;
  close(): Promise<void>;
}

/** The headers _headers gives each path, by the path. */
type Rules = Map<string, [name: string, value: string][]>;

/**
 * The rules of a _headers file: a line that starts with "#" is a comment and a blank line is
 * nothing, a line that starts with "/" is a rule's path, and each indented line after it is one of
 * its headers, "Name: value". A line that is none of those is an error, so a _headers that Netlify
 * wouldn't read as written stops the tests.
 */
function rulesOf(text: string): Rules {
  const rules: Rules = new Map();
  let current: [string, string][] | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    if (/^\s/.test(line)) {
      const colon = line.indexOf(":");
      if (current === null || colon === -1) {
        throw new Error(`Not a header line in _headers: ${JSON.stringify(line)}`);
      }
      current.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
    } else {
      if (!line.startsWith("/")) {
        throw new Error(`Not a path in _headers: ${JSON.stringify(line)}`);
      }
      current = rules.get(line.trim()) ?? [];
      rules.set(line.trim(), current);
    }
  }
  return rules;
}

async function handle(
  dir: string,
  rules: Rules,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
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
  // Set before the file is sent, which writes the rest of the response's headers around them.
  for (const [name, value] of rules.get(where.decoded) ?? []) response.setHeader(name, value);
  if (!(await serveStatic(dir, where, request, response))) {
    send(response, 404, CONTENT_TYPES[".txt"]!, "Not found", request.method);
  }
}

/** Serve the site built in `dir`, whose _headers it reads once, as the folder is when it's served. */
export async function serveSite(dir: string): Promise<SiteServer> {
  const rules = rulesOf(await readFile(path.join(dir, "_headers"), "utf8"));
  const server = createServer((request, response) => {
    handle(dir, rules, request, response).catch(() => {
      if (!response.headersSent) send(response, 500, CONTENT_TYPES[".txt"]!, "Server error");
      else response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://${HOST}:${port}/`, close: () => closeServer(server) };
}
