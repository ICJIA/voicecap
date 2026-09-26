import { sha256 } from "../util/hash.js";

const READABLE_MAX = 40;
const HASH_LENGTH = 10;

/** Base names Windows reserves in every folder, with or without an extension. */
const WINDOWS_RESERVED =
  /^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(\..*)?$/i;

export function isWindowsReservedName(name: string): boolean {
  return WINDOWS_RESERVED.test(name);
}

/**
 * The folder name for a page: a readable part from its path plus a short hash of its canonical
 * URL, e.g. "grants-fy27-jag-1a2b3c4d5e". Deterministic, unique per canonical URL, safe on
 * Windows (only a-z, 0-9 and "-"), and at most 51 characters. The home page is "home".
 */
export function pageSlug(canonicalUrl: string): string {
  const url = new URL(canonicalUrl);
  if (url.pathname === "/" && url.search === "") return "home";

  const readable = readablePart(url.pathname) || "home";
  const slug = `${readable}-${sha256(canonicalUrl).slice(0, HASH_LENGTH)}`;
  // The hash suffix already rules out reserved names; keep the guard in case the format changes.
  return isWindowsReservedName(slug) ? `page-${slug}` : slug;
}

function readablePart(pathname: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  const ascii = decoded
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii.slice(0, READABLE_MAX).replace(/-+$/, "");
}
