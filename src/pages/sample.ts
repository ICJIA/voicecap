export interface SampleGroup<T> {
  /** URL path pattern, e.g. "/news/*". */
  pattern: string;
  /** Pages matching the pattern. */
  total: number;
  chosen: T[];
}

/**
 * The URL path pattern a page belongs to when drafting a sample: its parent path plus "/*"
 * ("/news/2026-budget" -> "/news/*", "/researchhub/articles/x" -> "/researchhub/articles/*").
 * Top-level pages share "/*"; the home page is its own pattern, "/". Query strings are ignored.
 */
export function urlPattern(input: URL | string): string {
  const url = typeof input === "string" ? new URL(input) : input;
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return "/";
  if (segments.length === 1) return "/*";
  return `/${segments.slice(0, -1).join("/")}/*`;
}

/**
 * Pick up to n pages per URL path pattern, evenly spaced through each group in list order (the
 * first and last are always included when n >= 2), so the choice is deterministic and spans the
 * group. Groups come in order of first appearance.
 */
export function samplePages<T extends { url: URL | string }>(
  pages: readonly T[],
  n: number,
): SampleGroup<T>[] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("The sample size must be at least 1.");
  const groups = new Map<string, T[]>();
  for (const page of pages) {
    const pattern = urlPattern(page.url);
    const group = groups.get(pattern);
    if (group) group.push(page);
    else groups.set(pattern, [page]);
  }
  return [...groups].map(([pattern, members]) => ({
    pattern,
    total: members.length,
    chosen: evenlySpaced(members, n),
  }));
}

function evenlySpaced<T>(items: readonly T[], n: number): T[] {
  if (items.length <= n) return [...items];
  if (n === 1) return [items[0]!];
  const step = (items.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => items[Math.round(i * step)]!);
}
