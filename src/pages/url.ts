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

/**
 * Whether a host name has an empty label: it starts or ends with a dot, or has two together
 * (`.example.com`, `a..b.org`, `example.com.`, and `..`, which is a host of dots). `URL` lets each
 * through, but none is a name to call a site by: copies named `.example.com_<day>.html` would be
 * hidden on a Mac, and left off the website, and a folder named for a host of dots is the
 * transcripts home or the folder that holds it.
 */
export function hasEmptyLabel(hostname: string): boolean {
  return hostname.split(".").includes("");
}

/**
 * Why an address with a user name or password in it (`https://name:password@host/`) is refused,
 * and the reason a run records for a page list row or a sitemap entry that has one: the address is
 * kept in the run's records, and its report goes to the website.
 */
export const CREDENTIALS_REASON = "has a user name or password in it";

/** What `--page` says of an address with a user name or password in it. */
export const PAGE_CREDENTIALS_REFUSAL =
  "--page has a user name or password in its address: voicecap doesn't read pages that way, and the address would be kept in its records.";

/** Whether `url` has a user name or a password in it. */
export function hasCredentials(url: URL): boolean {
  return url.username !== "" || url.password !== "";
}

/** The address of `url` with its user name and password cleared, for a message or a record. */
export function withoutCredentials(url: URL): string {
  const copy = new URL(url.href);
  copy.username = "";
  copy.password = "";
  return copy.href;
}

/**
 * The address `input` names, as a person gives a page or a sitemap (a full URL of any scheme, or a
 * path against `site`), when it has a user name or password in it; null for one that has none, and
 * for text that is no address. It's asked before an address is repeated in a message or kept in a
 * record, so that neither holds them. A path that names another host (`//name:password@host/`) is
 * an address with them too.
 */
export function addressWithCredentials(input: string, site?: URL): URL | null {
  const value = input.trim();
  try {
    // Only the address's own user name and password count, so any base does for a path.
    const url = hasScheme(value)
      ? new URL(value)
      : new URL(value, site === undefined ? "https://base.invalid/" : `${site.origin}/`);
    return hasCredentials(url) ? url : null;
  } catch {
    return null;
  }
}

/**
 * What comes before the last @ of an address's authority, with the @: the user name and password of
 * `https://name:password@host/`, `//name:password@host/`, or `ftp://name@host/`. The authority is
 * what follows a scheme and two slashes (or two slashes alone) up to the next slash, question mark, or
 * hash. What is before it, the scheme and the slashes, is kept (the first group).
 */
const AUTHORITY_USER_INFO = /^(\s*(?:[a-z][a-z0-9+.-]*:)?[/\\]{2})[^/\\?#]*@/i;

/**
 * A name, a colon, a password, and an @ at the start of a text that has no authority for them:
 * `staging:secret@staging.example.org/a`, which the URL standard reads as an address in the scheme
 * `staging:` with a path, so that it has no user name, though it has a name and a password to a person.
 */
const BARE_USER_INFO = /^(\s*)[^\s/\\?#:@]+:[^\s/\\?#]*@/;

/** A mail address in its own scheme, whose "name:" is the scheme and is no user name. */
const MAIL_ADDRESS = /^\s*mailto:/i;

/**
 * `text` without the user name and password an address in it has, for a message or a record of what
 * a person gave that isn't an address voicecap reads (see `addressWithCredentials`, which finds the
 * ones that are, and `withoutCredentials`, which clears a URL's). It reads the text as it is written:
 * an address with an authority, whatever else is wrong with it (`https://name:password@exa mple.org/`),
 * and a name and password with no scheme in front of them (`staging:secret@staging.example.org/a`).
 * A mail address (`mailto:someone@example.org`) and every text with no @ before its first slash are
 * left as they are. It is linear in the text's length: each pattern is tried once, at the start.
 */
export function withoutUserInfo(text: string): string {
  const withAuthority = text.replace(AUTHORITY_USER_INFO, "$1");
  if (withAuthority !== text) return withAuthority;
  return MAIL_ADDRESS.test(text) ? text : text.replace(BARE_USER_INFO, "$1");
}

/**
 * Parse --site: an absolute http(s) URL, with a host that is a name or an address (no empty part:
 * see hasEmptyLabel) and no user name or password. Returns the site's origin as a URL
 * ("https://host/"). The user name and password are checked first, and what a message repeats of
 * the input is repeated without any (see withoutUserInfo), so no message holds them.
 */
export function parseSiteUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UsageError(
      `--site must be a full URL such as https://dvfr.illinois.gov (got "${withoutUserInfo(input)}").`,
    );
  }
  if (hasCredentials(url)) {
    throw new UsageError(`--site ${CREDENTIALS_REASON}: give the site's address without them.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError(`--site must be an http or https URL (got "${withoutUserInfo(input)}").`);
  }
  if (hasEmptyLabel(url.hostname)) {
    throw new UsageError(
      `--site must be a web address such as https://dvfr.illinois.gov: a host can't start or end with a dot or have two dots in a row (got "${withoutUserInfo(input)}").`,
    );
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
 * `answer` with `https://` added when it has no scheme, as an address typed the short way
 * (`dvfr.illinois.gov`, `dvfr.illinois.gov/sitemap.xml`) has none. A `host:port` answer such as
 * `localhost:3000` counts as having none too: it starts with its host (see `startsWithHost`), and
 * nothing with a real scheme does.
 */
export function withScheme(answer: string): string {
  return hasScheme(answer) && !startsWithHost(answer) ? answer : `https://${answer}`;
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
 * Returns null for anything that isn't an http(s) URL, for an address with a user name or password
 * in it (see addressWithCredentials), and for a name or path that's empty, has a space in it, or
 * has no `site` to be read on.
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
  return (url.protocol === "http:" || url.protocol === "https:") && !hasCredentials(url)
    ? url
    : null;
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
