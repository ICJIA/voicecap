/**
 * Describe the URLs given with `--page`, for the report, the TXT transcript header, run
 * comparison, and resume's settings differences: one URL as "page <url>", several as
 * "<n> pages (<url>, <url>, <url>)", showing only the first three when there are more.
 */
export function describePageUrls(urls: readonly string[]): string {
  if (urls.length === 1) return `page ${urls[0]}`;
  const shown = urls.slice(0, 3).join(", ");
  return `${urls.length} pages (${shown}${urls.length > 3 ? ", …" : ""})`;
}
