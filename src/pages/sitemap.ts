import { gunzipSync } from "node:zlib";

import { XMLParser, XMLValidator } from "fast-xml-parser";

import { EnvironmentError, errorMessage, UsageError } from "../util/errors.js";
import { sha256 } from "../util/hash.js";
import type { Logger } from "../util/log.js";
import { decodeText } from "./decode.js";

export interface SitemapDocument {
  url: string;
  /** Number of <loc> entries in this document: page URLs in a <urlset>, child sitemaps in a <sitemapindex>. */
  urls: number;
  /** SHA-256 of the bytes as fetched. */
  sha256?: string;
  error?: string;
}

export interface SitemapResult {
  /** Page URLs in document order, with the sitemap that listed each. */
  urls: { loc: string; sitemap: string }[];
  /** Every sitemap document fetched: the one given, then its children depth-first. */
  documents: SitemapDocument[];
  warnings: string[];
}

export interface FetchSitemapOptions {
  fetch?: typeof fetch;
  /** How deep <sitemapindex> files may nest. Default 5. */
  maxDepth?: number;
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
  logger?: Logger;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  // Sitemaps may use a prefixed namespace (<sm:urlset>); prefixes don't matter here.
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === "url" || name === "sitemap",
});

/**
 * Fetch a sitemap and every child of a <sitemapindex>, depth-first, returning the page URLs in
 * order. If the sitemap given can't be read, that's fatal (UsageError for HTTP 4xx or a document
 * that isn't a sitemap; EnvironmentError for network errors and 5xx). A failing child is a
 * warning: it's recorded in `documents` and the rest continue.
 */
export async function fetchSitemap(
  url: string,
  options: FetchSitemapOptions = {},
): Promise<SitemapResult> {
  const result: SitemapResult = { urls: [], documents: [], warnings: [] };
  const visited = new Set<string>();
  await visit(url, 0, true, result, visited, options);
  return result;
}

async function visit(
  url: string,
  depth: number,
  topLevel: boolean,
  result: SitemapResult,
  visited: Set<string>,
  options: FetchSitemapOptions,
): Promise<void> {
  const key = visitKey(url);
  if (visited.has(key)) {
    warn(result, options, `Sitemap ${url} is listed more than once (a loop?); read it only once.`);
    return;
  }
  visited.add(key);

  let fetched: { raw: Uint8Array; xml: string };
  try {
    fetched = await fetchDocument(url, options);
  } catch (error) {
    if (topLevel) throw error;
    result.documents.push({ url, urls: 0, error: errorMessage(error) });
    warn(result, options, `${errorMessage(error)} Skipped this child sitemap; read the others.`);
    return;
  }

  let parsed: ParsedSitemap;
  try {
    parsed = parseSitemapXml(fetched.xml);
  } catch (error) {
    if (topLevel) {
      throw new UsageError(`The sitemap ${url} ${errorMessage(error)}`, { cause: error });
    }
    result.documents.push({
      url,
      urls: 0,
      sha256: sha256(fetched.raw),
      error: errorMessage(error),
    });
    warn(result, options, `Skipped child sitemap ${url}: it ${errorMessage(error)}`);
    return;
  }

  result.documents.push({ url, urls: parsed.locs.length, sha256: sha256(fetched.raw) });
  if (parsed.kind === "urlset") {
    for (const loc of parsed.locs) result.urls.push({ loc, sitemap: url });
    return;
  }
  const maxDepth = options.maxDepth ?? 5;
  if (depth + 1 > maxDepth) {
    warn(
      result,
      options,
      `Sitemap index ${url} is nested more than ${maxDepth} levels deep; its ${parsed.locs.length} child sitemap(s) were not read.`,
    );
    return;
  }
  for (const child of parsed.locs) {
    let childUrl: string;
    try {
      childUrl = new URL(child, url).href;
    } catch {
      warn(result, options, `Sitemap index ${url} lists an invalid sitemap URL: "${child}".`);
      continue;
    }
    await visit(childUrl, depth + 1, false, result, visited, options);
  }
}

interface ParsedSitemap {
  kind: "urlset" | "sitemapindex";
  locs: string[];
}

/** Parse sitemap XML. Throws an Error whose message completes "<url> ..." for the caller. */
export function parseSitemapXml(xml: string): ParsedSitemap {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new Error(
      `is not valid XML: ${valid.err.msg} (line ${valid.err.line}, column ${valid.err.col}).`,
    );
  }
  const doc = parser.parse(xml) as Record<string, unknown>;
  const urlset = doc.urlset;
  const index = doc.sitemapindex;
  if (urlset !== undefined) return { kind: "urlset", locs: locsOf(urlset, "url") };
  if (index !== undefined) return { kind: "sitemapindex", locs: locsOf(index, "sitemap") };
  throw new Error("is not a sitemap: expected a <urlset> or <sitemapindex> root element.");
}

function locsOf(container: unknown, entryName: "url" | "sitemap"): string[] {
  if (container === null || typeof container !== "object") return [];
  const entries = (container as Record<string, unknown>)[entryName];
  if (!Array.isArray(entries)) return [];
  const locs: string[] = [];
  for (const entry of entries) {
    const loc = (entry as Record<string, unknown> | null)?.loc;
    if (typeof loc === "string" && loc.trim() !== "") locs.push(loc.trim());
  }
  return locs;
}

async function fetchDocument(
  url: string,
  options: FetchSitemapOptions,
): Promise<{ raw: Uint8Array; xml: string }> {
  const doFetch = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      headers: { accept: "application/xml, text/xml;q=0.9, */*;q=0.8" },
    });
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    const detail = cause instanceof Error ? cause.message : errorMessage(error);
    throw new EnvironmentError(`Could not fetch the sitemap ${url}: ${detail}`, { cause: error });
  }
  if (!response.ok) {
    const message = `Could not fetch the sitemap ${url}: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`;
    throw response.status >= 400 && response.status < 500
      ? new UsageError(message)
      : new EnvironmentError(message);
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  let bytes = raw;
  // .xml.gz sitemaps arrive as raw gzip (fetch only decompresses Content-Encoding: gzip).
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      bytes = new Uint8Array(gunzipSync(raw));
    } catch (error) {
      throw new UsageError(
        `Could not decompress the gzipped sitemap ${url}: ${errorMessage(error)}`,
      );
    }
  }
  return { raw, xml: decodeText(bytes).text };
}

function visitKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url;
  }
}

function warn(result: SitemapResult, options: FetchSitemapOptions, message: string): void {
  result.warnings.push(message);
  options.logger?.warn(message);
}
