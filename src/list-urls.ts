import path from "node:path";

import { resolvePages } from "./pages/resolve.js";
import { samplePages, type SampleGroup } from "./pages/sample.js";
import { displayPath, parseSiteUrl } from "./pages/url.js";
import { writeFileAtomic } from "./util/atomic-write.js";
import { UsageError } from "./util/errors.js";
import { resolveUserPath } from "./util/git-bash.js";
import type { Logger } from "./util/log.js";

export interface ListUrlsOptions {
  /** The site, as given to --site. */
  site: URL | string;
  sitemap: string;
  /** Output file: .csv or .json. */
  output: string;
  /** Draft a sample: this many pages per URL path pattern. */
  sample?: number;
  include?: readonly string[];
  exclude?: readonly string[];
  limit?: number | null;
  cwd?: string;
  fetch?: typeof fetch;
  logger?: Logger;
}

export interface ListUrlsResult {
  /** Absolute path of the file written. */
  file: string;
  /** Rows written. */
  count: number;
  /** With --sample: each pattern, how many pages it had, and the URLs chosen. */
  groups?: { pattern: string; total: number; chosen: string[] }[];
}

interface Row {
  url: string;
  label: string;
  template: string;
  notes: string;
}

/**
 * Export a sitemap as a page list file (url plus empty label, template, and notes columns) to
 * prune and tag in a spreadsheet, or with `sample` draft a curated sample: n pages per URL path
 * pattern, with the pattern as the template. Applies the same filtering as a run.
 */
export async function listUrls(options: ListUrlsOptions): Promise<ListUrlsResult> {
  const cwd = options.cwd ?? process.cwd();
  const file = resolveUserPath(cwd, options.output);
  const format = outputFormat(file);
  if (options.sample !== undefined && (!Number.isInteger(options.sample) || options.sample < 1)) {
    throw new UsageError(`--sample must be a whole number of at least 1 (got ${options.sample}).`);
  }
  const site = typeof options.site === "string" ? parseSiteUrl(options.site) : options.site;
  const resolved = await resolvePages({
    site,
    sitemap: options.sitemap,
    ...(options.include ? { include: options.include } : {}),
    ...(options.exclude ? { exclude: options.exclude } : {}),
    limit: options.limit ?? null,
    cwd,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  });

  let rows: Row[];
  let groups: SampleGroup<(typeof resolved.pages)[number]>[] | undefined;
  if (options.sample !== undefined) {
    groups = samplePages(resolved.pages, options.sample);
    rows = groups.flatMap((group) =>
      group.chosen.map((page) => ({
        url: page.url,
        label: "",
        template: group.pattern,
        notes: "",
      })),
    );
    logSample(options.logger, groups, options.sample, rows.length, resolved.pages.length);
  } else {
    rows = resolved.pages.map((page) => ({ url: page.url, label: "", template: "", notes: "" }));
  }

  await writeFileAtomic(
    file,
    format === "csv" ? toCsv(rows) : `${JSON.stringify(rows, null, 2)}\n`,
  );
  options.logger?.info(
    `Wrote ${rows.length} URL${rows.length === 1 ? "" : "s"} to ${path.relative(cwd, file) || file}. ` +
      `Edit it, then run: voicecap --site ${site.origin} --pages ${path.relative(cwd, file) || file}`,
  );
  const result: ListUrlsResult = { file, count: rows.length };
  if (groups) {
    result.groups = groups.map((group) => ({
      pattern: group.pattern,
      total: group.total,
      chosen: group.chosen.map((page) => page.url),
    }));
  }
  return result;
}

function outputFormat(file: string): "csv" | "json" {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".csv") return "csv";
  if (ext === ".json") return "json";
  throw new UsageError(
    `The list-urls output file must end in .csv or .json (got "${path.basename(file)}").`,
  );
}

/** CSV as Excel's "CSV UTF-8" writes it: a byte order mark, CRLF line endings, RFC 4180 quoting. */
function toCsv(rows: readonly Row[]): string {
  const lines = [
    ["url", "label", "template", "notes"],
    ...rows.map((r) => [r.url, r.label, r.template, r.notes]),
  ];
  return `\uFEFF${lines.map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function logSample(
  logger: Logger | undefined,
  groups: readonly SampleGroup<{ url: string }>[],
  n: number,
  chosen: number,
  total: number,
): void {
  if (!logger) return;
  logger.info(
    `Drafted a sample of ${chosen} of ${total} pages: up to ${n} per URL path pattern, ` +
      `evenly spaced through each pattern's pages in sitemap order (first and last included).`,
  );
  for (const group of groups) {
    const picks = group.chosen.map((page) => displayPath(page.url)).join(", ");
    logger.info(
      `  ${group.pattern}  ${group.total} page${group.total === 1 ? "" : "s"}, chose ${group.chosen.length}: ${picks}`,
    );
  }
  logger.info(
    "Review the draft: keep pages that represent each template, fill in labels, and remove the rest.",
  );
}
