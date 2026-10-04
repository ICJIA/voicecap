import { UsageError } from "../util/errors.js";
import { hasScheme, startsWithHost } from "./url.js";

/** `value` as a URL, or null when it isn't one. */
function parseUrl(value: string): URL | null {
  return URL.canParse(value) ? new URL(value) : null;
}

/** Whether `url` is an http or https address. */
function isWebAddress(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

/** The origin of `value`, or null when it isn't a URL. */
function originOf(value: string): string | null {
  return parseUrl(value)?.origin ?? null;
}

/**
 * The root of the site at the canonical address `input`: its scheme, host, and path, with a `/` on
 * the end and without any query, hash, or credentials. An address typed the short way gets
 * `https://` (`dvfr.illinois.gov` is `https://dvfr.illinois.gov/`), by the rule of `withScheme` in
 * src/init/site.ts, which this file can't import because init builds on the pages code. Throws a
 * `UsageError` when `input` isn't an http(s) web address, and when it's an address on this
 * computer or an IP address (see `isLocalHost`), which readers can't visit.
 */
export function normalizeCanonical(input: string): string {
  const answer = input.trim();
  const address = hasScheme(answer) && !startsWithHost(answer) ? answer : `https://${answer}`;
  const url = parseUrl(address);
  if (url === null || !isWebAddress(url)) {
    throw new UsageError(`"${input}" isn't a web address, such as https://dvfr.illinois.gov.`);
  }
  if (isLocalHost(url.hostname)) {
    throw new UsageError(
      `"${input}" is an address on this computer; give the address people visit, such as https://dvfr.illinois.gov.`,
    );
  }
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${path}`;
}

/**
 * The root of the site that a page's `<link rel="canonical">` tag names, or null when the tag gives
 * none. `pageUrl` is the page as voicecap read it, and `declared` is the tag's address, which must
 * be an absolute http(s) URL (null for a page with no tag). The tag's path has to end with the
 * page's own path, and its host has to be one people visit (not an `isLocalHost` one). The root is
 * the tag's address up to the page's path, with a `/` on the end: `http://127.0.0.1:4848/about/`
 * with the tag `https://voicecap.netlify.app/demo-site/about/` gives
 * `https://voicecap.netlify.app/demo-site/`. A tag that names another page gives null, and the
 * tag's query and hash don't count.
 */
export function canonicalRootFrom(pageUrl: string, declared: string | null): string | null {
  if (declared === null) return null;
  const page = parseUrl(pageUrl);
  const tag = parseUrl(declared);
  if (page === null || tag === null) return null;
  if (!isWebAddress(page) || !isWebAddress(tag) || isLocalHost(tag.hostname)) return null;
  if (!tag.pathname.endsWith(page.pathname)) return null;
  // The root is the tag's path up to the page's own, keeping the slash that path starts with.
  const rootPath = tag.pathname.slice(0, tag.pathname.length - page.pathname.length + 1);
  return `${tag.origin}${rootPath}`;
}

/**
 * The address to show readers for `url`. An address on `readOrigin`, the origin voicecap read, is
 * shown on the canonical `root` (which ends in `/`): the root, then the address's path without its
 * leading `/`, then its query, and not its hash. So the read site's home page is the root itself.
 * With no `root`, or for an address on another origin (a link off the site, a redirect away),
 * `url` comes back as it was.
 */
export function toCanonical(url: string, readOrigin: string, root: string | null): string {
  if (root === null) return url;
  const address = parseUrl(url);
  if (address === null || address.origin !== originOf(readOrigin)) return url;
  return `${root}${address.pathname.slice(1)}${address.search}`;
}

/**
 * The name readers know a site by: the host of its canonical `root`, with its port if it has one.
 */
export function canonicalName(root: string): string {
  return new URL(root).host;
}

/** Whether `name` is four dotted decimal numbers, each from 0 to 255. */
function isIpv4(name: string): boolean {
  const parts = name.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * Whether `host` is this computer or an IP address, neither of which readers can visit by name:
 * `localhost` or a name under it, an IPv4 address, or an IPv6 address (bracketed or not). `host`
 * can have a port, capital letters, and a trailing dot, and an IPv4 address written another way
 * (`127.1`) counts as the address `URL` reads it as. A name people visit, such as
 * `dvfr.illinois.gov`, isn't one, and neither is `localhost.example.org`.
 */
export function isLocalHost(host: string): boolean {
  // An IPv6 address needs its brackets for `URL`, so one given without them is tried with them.
  const url = parseUrl(`http://${host}/`) ?? parseUrl(`http://[${host}]/`);
  if (url === null) return false;
  const name = url.hostname.endsWith(".") ? url.hostname.slice(0, -1) : url.hostname;
  return (
    name === "localhost" || name.endsWith(".localhost") || name.startsWith("[") || isIpv4(name)
  );
}

/**
 * Where a run read the site, compared with its canonical `root`: "same" when `readOrigin` is the
 * root's own origin, "local" when it's a copy on this computer (a host `isLocalHost` accepts), and
 * "elsewhere" for a copy at any other address.
 */
export function readLocation(readOrigin: string, root: string): "same" | "local" | "elsewhere" {
  const read = parseUrl(readOrigin);
  if (read === null) return "elsewhere";
  if (read.origin === originOf(root)) return "same";
  return isLocalHost(read.hostname) ? "local" : "elsewhere";
}
