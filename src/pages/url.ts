import { UsageError } from "../util/errors.js";

/** File extensions that are never HTML pages; skipped before a run starts. */
// prettier-ignore
export const NON_HTML_EXTENSIONS: ReadonlySet<string> = new Set([
  // documents
  "pdf", "doc", "docx", "dot", "dotx", "rtf", "odt", "txt", "epub",
  "xls", "xlsx", "xlsm", "csv", "ods", "ppt", "pptx", "odp",
  // images
  "jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp", "tif", "tiff", "ico", "heic",
  // audio and video
  "mp3", "m4a", "wav", "ogg", "oga", "flac", "mp4", "m4v", "mov", "avi", "wmv", "webm", "mkv",
  // archives and installers
  "zip", "gz", "tgz", "tar", "7z", "rar", "exe", "msi", "dmg", "pkg",
  // data, feeds, and code
  "json", "xml", "rss", "atom", "js", "mjs", "css", "map", "ics", "kml", "kmz", "gpx",
  // fonts
  "woff", "woff2", "ttf", "otf", "eot",
]);

/** Parse --site: an absolute http(s) URL. Returns the site's origin as a URL ("https://host/"). */
export function parseSiteUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UsageError(
      `--site must be a full URL such as https://dvfr.illinois.gov (got "${input}").`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError(`--site must be an http or https URL (got "${input}").`);
  }
  return new URL(`${url.origin}/`);
}

/**
 * Whether a page is given as a full URL: it starts with a scheme ("https:", even "https:/host/",
 * or "mailto:"). Anything else is a path, resolved against a site.
 */
export function hasScheme(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(input.trim());
}

/** A `host:port` value (`localhost:3000`, maybe with more after it), whose host looks like a scheme. */
const HOST_AND_PORT = /^[^/:]+:\d+(?:[/?#]|$)/;
/** A host name with a dot in it, then a path: `dvfr.illinois.gov/sitemap.xml`. */
const DOTTED_HOST_AND_PATH = /^[^\s/?#:.]+(?:\.[^\s/?#:.]+)+\//;

/**
 * Whether `value` is an address written the short way, without its scheme, starting with its
 * host: a `host:port` (`localhost:3000`, maybe with more after it), or a host name with a dot in
 * it and then a path (`dvfr.illinois.gov/sitemap.xml`). A name on its own (`sitemap.xml`), a path
 * (`sitemaps/pages.xml`, `/sitemap.xml`), or a full URL isn't one.
 */
export function startsWithHost(value: string): boolean {
  return HOST_AND_PORT.test(value) || DOTTED_HOST_AND_PATH.test(value);
}

/**
 * Resolve a page given as a full URL or a root-relative path ("/about") against the site.
 * Returns null for anything that isn't an http(s) page URL.
 */
export function resolvePageUrl(input: string, site: URL): URL | null {
  const value = input.trim();
  if (value === "") return null;
  let url: URL;
  try {
    url = hasScheme(value) ? new URL(value) : new URL(value, site.origin + "/");
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return normalizeUrl(url);
}

/**
 * Resolve a sitemap given as a full URL, or as a name or path on the site, read from its root as
 * --page paths are: "sitemap.xml" and "/sitemap.xml" are both https://dvfr.illinois.gov/sitemap.xml
 * for any `site` on https://dvfr.illinois.gov, whatever its path, and a sitemap further down is
 * given as its path ("/blog/sitemap.xml"). A full URL is taken as it is, whatever `site` is.
 * Returns null for anything that isn't an http(s) URL, and for a name or path that's empty, has a
 * space in it, or has no `site` to be read on.
 */
export function resolveSitemapUrl(input: string, site?: URL): URL | null {
  const value = input.trim();
  if (value === "") return null;
  // A full URL is parsed on its own, as it always was; a name or path, from the site's root.
  let base: string | undefined;
  if (!hasScheme(value)) {
    if (site === undefined || /\s/.test(value)) return null;
    base = `${site.origin}/`;
  }
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

/** Drop the fragment; everything else (including the query string) is kept. */
export function normalizeUrl(url: URL): URL {
  const copy = new URL(url.href);
  copy.hash = "";
  return copy;
}

/**
 * A page's identity: origin + path without a trailing slash (except the root) + query.
 * "/about" and "/about/" are the same page; different query strings are different pages.
 */
export function canonicalKey(input: URL | string): string {
  const url = normalizeUrl(typeof input === "string" ? new URL(input) : input);
  let path = url.pathname;
  while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return `${url.origin}${path}${url.search}`;
}

export function sameOrigin(a: URL, b: URL): boolean {
  return a.origin === b.origin;
}

/** The URL's file extension when it names a non-HTML resource (e.g. "pdf"), otherwise null. */
export function nonHtmlExtension(url: URL): string | null {
  const lastSegment = url.pathname.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = lastSegment.slice(dot + 1).toLowerCase();
  return NON_HTML_EXTENSIONS.has(ext) ? ext : null;
}

/** Whether a Content-Type header describes an HTML document. Unknown types count as HTML. */
export function isHtmlContentType(contentType: string | null | undefined): boolean {
  if (contentType === null || contentType === undefined || contentType.trim() === "") return true;
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  return type === "text/html" || type === "application/xhtml+xml";
}

/** Path plus query, for console output: "/grants/fy27-jag". */
export function displayPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}
