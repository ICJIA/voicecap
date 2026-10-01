import { linkPath } from "../run/paths.js";

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for HTML element content and quoted attribute values. */
export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}

/**
 * An href for a local file, relative to the folder of the report being written. Each path segment
 * is percent-encoded, so run names and file names with unusual characters still link correctly.
 */
export function fileHref(fromDir: string, target: string): string {
  return linkPath(fromDir, target)
    .split("/")
    .map((segment) => (segment === ".." || segment === "." ? segment : encodeURIComponent(segment)))
    .join("/");
}

/** A link whose accessible name is extended with text only screen readers get, e.g. the page. */
export function link(href: string, text: string, hiddenContext?: string): string {
  const context = hiddenContext
    ? `<span class="visually-hidden"> ${esc(hiddenContext)}</span>`
    : "";
  return `<a href="${esc(href)}">${esc(text)}${context}</a>`;
}

/** An inline list of links, or a dash when there are none. */
export function linkList(items: string[]): string {
  if (items.length === 0) return `<span class="none">None</span>`;
  return `<ul class="links">${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

/** "1 page", "3 pages". The count is made a number first, so it can only ever be one. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  const amount = Number(count);
  return `${amount.toLocaleString("en-US")} ${amount === 1 ? singular : pluralForm}`;
}

/** An id-safe fragment from any string (slugs already are; this guards everything else). */
export function idFragment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

/**
 * A timestamp in the pages table: "2026-09-26 19:00", in a <time> element carrying the full
 * ISO value. Sections that serve as the audit trail show the full timestamp instead.
 */
export function shortTime(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return `<time datetime="${esc(iso)}">${esc(match ? `${match[1]} ${match[2]}` : iso)}</time>`;
}
