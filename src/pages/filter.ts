import picomatch from "picomatch";

import { UsageError } from "../util/errors.js";

export type UrlMatcher = (url: URL) => boolean;

export interface FilterOptions {
  include?: readonly string[];
  exclude?: readonly string[];
  limit?: number | null;
}

export interface FilterResult<T> {
  kept: T[];
  /** Removed by --include (matched no include pattern) or --exclude. */
  excludedByFilter: number;
  /** Removed by --limit. */
  excludedByLimit: number;
}

/**
 * Compile an --include/--exclude pattern.
 *
 * - Glob (default): matched with picomatch against the URL's path, percent-decoded, without its
 *   trailing slash. "/news/*" matches /news/story but not /news/ itself; "/news/**" matches both.
 * - "re:" prefix: a regular expression tested against the path plus query string.
 *
 * The leading slash is optional on both sides, because Git Bash rewrites arguments that start with
 * "/" into Windows paths: "news/*" and "/news/*" behave the same, and a regex is tested against
 * the path both with and without its leading slash.
 */
export function compilePattern(pattern: string): UrlMatcher {
  const trimmed = pattern.trim();
  if (trimmed === "" || trimmed === "re:") {
    throw new UsageError("An --include or --exclude pattern is empty.");
  }
  if (trimmed.startsWith("re:")) {
    let regex: RegExp;
    try {
      regex = new RegExp(trimmed.slice(3));
    } catch (error) {
      throw new UsageError(
        `Invalid regular expression in pattern "${pattern}": ${(error as Error).message}`,
      );
    }
    return (url) => {
      const withSlash = `${url.pathname}${url.search}`;
      return regex.test(withSlash) || regex.test(withSlash.replace(/^\/+/, ""));
    };
  }
  // Paths are compared without leading or trailing slashes, so patterns are too; "/" alone is
  // the home page.
  const glob = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  if (glob === "") return (url) => globPath(url) === "";
  const isMatch = picomatch(glob, { dot: true });
  return (url) => {
    const path = globPath(url);
    // picomatch never matches an empty path, but "**" means "any depth", the home page included.
    return path === "" ? glob === "**" || isMatch(path) : isMatch(path);
  };
}

/** Apply --include (keep items matching any), then --exclude (drop matches), then --limit. */
export function applyFilters<T extends { url: URL | string }>(
  items: readonly T[],
  options: FilterOptions,
): FilterResult<T> {
  const includes = (options.include ?? []).map(compilePattern);
  const excludes = (options.exclude ?? []).map(compilePattern);
  const filtered = items.filter((item) => {
    const url = typeof item.url === "string" ? new URL(item.url) : item.url;
    if (includes.length > 0 && !includes.some((matches) => matches(url))) return false;
    return !excludes.some((matches) => matches(url));
  });
  const limit = options.limit ?? null;
  const kept = limit === null ? filtered : filtered.slice(0, Math.max(0, limit));
  return {
    kept,
    excludedByFilter: items.length - filtered.length,
    excludedByLimit: filtered.length - kept.length,
  };
}

function globPath(url: URL): string {
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the encoded form if it isn't valid percent-encoding.
  }
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}
