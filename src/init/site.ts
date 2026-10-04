import { withScheme } from "../pages/url.js";
import { InterruptedError } from "../passes/steps.js";
import { errorMessage } from "../util/errors.js";

/** How long `init`'s site checks wait for an answer before giving up. */
const TIMEOUT_MS = 15_000;

/** Whether something answered as expected, or the one-line reason it didn't. */
export type Check = { ok: true } | { ok: false; reason: string };

/**
 * Whether the site answers, and where it really is. `site` is the final origin reached after
 * redirects: unchanged from the one given when the fetch's `response.url` is empty (as a
 * constructed `Response` has, meaning no redirect happened). `moved` is true when that origin
 * differs from the one given.
 */
export type SiteCheck =
  { ok: true; site: URL; moved: boolean } | { ok: false; site: URL; reason: string };

/**
 * Normalize `init`'s website answer: trims it, adds `https://` when it has no scheme (see
 * `withScheme`), and allows only `http` and `https`. Returns the site's origin as a URL (no path),
 * or null when the answer isn't a usable address.
 */
export function normalizeSiteAnswer(answer: string): URL | null {
  let url: URL;
  try {
    url = new URL(withScheme(answer.trim()));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return new URL(`${url.origin}/`);
}

/**
 * The 15-second request timeout, joined with `signal` when one is given: whichever aborts first
 * decides the request's fate. `AbortSignal.any` can't take `undefined` as one of its signals, so
 * this is the one place that builds the combination.
 */
function fetchSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

/**
 * Check that `site` answers, following redirects, with a 15-second limit. On success, `site` in
 * the result is the final origin actually reached (see `SiteCheck`) and `moved` says whether
 * that's a different origin than the one given. On failure, `site` is the one given. When `signal`
 * is given and it (not the timeout) is why the request failed, rejects with `InterruptedError`
 * instead of returning a reason, so Ctrl+C stops the wizard at once.
 */
export async function checkSite(
  site: URL,
  doFetch: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<SiteCheck> {
  let response: Response;
  try {
    response = await doFetch(site.href, { signal: fetchSignal(signal) });
  } catch (error) {
    if (signal?.aborted) throw new InterruptedError();
    return { ok: false, site, reason: fetchFailureReason(error) };
  }
  // Nothing here reads the body, and a body that errors on its own (e.g. one that already timed
  // out) must not fail a check whose status is already known.
  await response.body?.cancel().catch(() => {});
  if (!response.ok) return { ok: false, site, reason: `HTTP ${response.status}` };
  const finalOrigin = response.url === "" ? site.origin : new URL(response.url).origin;
  return { ok: true, site: new URL(`${finalOrigin}/`), moved: finalOrigin !== site.origin };
}

/**
 * Whether `url` answers with a sitemap document: a `<urlset>` or `<sitemapindex>` (not parsed;
 * see `src/pages/sitemap.ts` for that). A 15-second limit applies. When `signal` is given and it
 * (not the timeout) is why the request failed, rejects with `InterruptedError` instead of
 * returning a reason.
 */
export async function checkSitemap(
  url: string,
  doFetch: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<Check> {
  let text: string;
  try {
    const response = await doFetch(url, { signal: fetchSignal(signal) });
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    // The signal can still fire while this body is streaming, after doFetch already resolved.
    text = await response.text();
  } catch (error) {
    if (signal?.aborted) throw new InterruptedError();
    return { ok: false, reason: fetchFailureReason(error) };
  }
  if (text.includes("<urlset") || text.includes("<sitemapindex")) return { ok: true };
  return { ok: false, reason: "not a sitemap (no <urlset> or <sitemapindex>)" };
}

/** A sitemap the site has: its URL, and where `findSitemaps` found it. */
export interface FoundSitemap {
  url: string;
  /** Listed on a `Sitemap:` line in the site's robots.txt, or found at /sitemap.xml. */
  from: "robots.txt" | "/sitemap.xml";
}

/**
 * Find every sitemap the site has. The candidates are its `robots.txt` `Sitemap:` lines (matched
 * case-insensitively, resolved against the site's origin), in order, then `/sitemap.xml` when
 * robots.txt doesn't list it; a URL listed twice is one candidate. They're checked all at once, so
 * the search takes at most two 15-second limits (robots.txt, then the checks), and each that
 * `checkSitemap` accepts is returned, in that order. None is an empty list, including when
 * `robots.txt` itself doesn't answer. When `signal` is given and it (not a timeout) is why a
 * request failed, rejects with `InterruptedError`.
 */
export async function findSitemaps(
  site: URL,
  doFetch: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<FoundSitemap[]> {
  const candidates: FoundSitemap[] = [];
  const add = (url: string, from: FoundSitemap["from"]) => {
    if (!candidates.some((candidate) => candidate.url === url)) candidates.push({ url, from });
  };
  for (const url of await sitemapLinesFromRobots(site, doFetch, signal)) add(url, "robots.txt");
  add(new URL("/sitemap.xml", site.origin).href, "/sitemap.xml");
  const checks = await Promise.all(
    candidates.map((candidate) => checkSitemap(candidate.url, doFetch, signal)),
  );
  return candidates.filter((_candidate, index) => checks[index]!.ok);
}

/** The `Sitemap:` lines in `site`'s `robots.txt`, resolved to absolute URLs, in order. */
async function sitemapLinesFromRobots(
  site: URL,
  doFetch: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<string[]> {
  let text: string;
  try {
    const response = await doFetch(new URL("/robots.txt", site.origin).href, {
      signal: fetchSignal(signal),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return [];
    }
    // The signal can still fire while this body is streaming, after doFetch already resolved.
    text = await response.text();
  } catch {
    if (signal?.aborted) throw new InterruptedError();
    return [];
  }
  const lines: string[] = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const match = /^sitemap:\s*(.+)$/i.exec(rawLine.trim());
    if (!match) continue;
    try {
      lines.push(new URL(match[1]!.trim(), site.origin).href);
    } catch {
      // Not a usable URL; skip this line.
    }
  }
  return lines;
}

/** A non-empty string property, read loosely off any value (an `Error`, or a plain object). */
function textProp(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const prop = (value as Record<string, unknown>)[key];
  return typeof prop === "string" && prop !== "" ? prop : undefined;
}

/**
 * The one-line reason a fetch failed, never empty: `"no answer in 15 seconds"` for a timeout;
 * else the underlying `cause`'s message (fetch's own `TypeError: fetch failed` keeps the real
 * reason there); else the cause's `code` (such as `ENOTFOUND`, when its message is empty); else,
 * when the cause is an `AggregateError` (fetch's shape for "every address failed"), its first
 * inner error's message; else the error's own message; else its name (such as `TypeError`); else
 * `"unknown error"`.
 */
function fetchFailureReason(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "no answer in 15 seconds";
  }
  const cause = error instanceof Error ? error.cause : undefined;
  const causeMessage = textProp(cause, "message");
  if (causeMessage !== undefined) return causeMessage;
  const causeCode = textProp(cause, "code");
  if (causeCode !== undefined) return causeCode;
  if (cause instanceof AggregateError) {
    const firstMessage = textProp(cause.errors[0], "message");
    if (firstMessage !== undefined) return firstMessage;
  }
  const message = errorMessage(error);
  if (message !== "") return message;
  return textProp(error, "name") ?? "unknown error";
}
