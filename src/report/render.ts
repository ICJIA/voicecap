import path from "node:path";

import type { ManualSessionFile } from "../manual/list.js";
import type {
  EnvironmentRecord,
  PageRecord,
  PassName,
  PassSummary,
  ReviewEntry,
  ReviewStatus,
  SessionRecord,
  SkipReason,
  SkippedRecord,
} from "../model.js";
import { describePageUrls } from "../pages/describe.js";
import { liveReportPath, pageDir, runReportPath } from "../run/paths.js";
import { environmentLines, stopReasonText } from "../transcripts/format.js";
import { REPORT_SCRIPT } from "./client.js";
import { esc, fileHref, link, linkList, plural, shortTime } from "./html.js";
import type { Banner, PageGroup, ReportModel, ReportRow } from "./model.js";
import { pageName } from "./model.js";
import { REPORT_CSS } from "./styles.js";

export interface RenderPaths {
  outDir: string;
  /** Folder of the file being written; every local link is relative to it. */
  baseDir: string;
  /** Live reports link to the run's snapshot when it exists. */
  snapshotExists: boolean;
}

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  unreviewed: "Unreviewed",
  reviewed: "Reviewed, no issues",
  issue: "Issue found",
  fixed: "Fixed",
};

const PASS_LABEL: Record<PassName, string> = { read: "Read", headings: "Headings", tab: "Tab" };

const SKIP_REASON: Record<SkipReason, string> = {
  "off-origin": "On a different origin from the site",
  "non-html-extension": "Not an HTML page (by file extension)",
  "non-html-response": "The response wasn't HTML",
  "redirect-off-origin": "Redirected to a different origin",
};

const FORMAT_LABEL = { "nvda-log": "NVDA log", "speech-viewer": "Speech Viewer" } as const;

/** Template filter value for pages without a template. */
const NO_TEMPLATE = "(none)";

const DASH = `<span aria-hidden="true">—</span><span class="visually-hidden">Not applicable</span>`;

/** Render the report as one self-contained HTML document. Pure: no file access. */
export function renderReport(model: ReportModel, paths: RenderPaths): string {
  const { input } = model;
  const { run, branding } = input;
  const kind = input.target === "live" ? "Live report" : "Snapshot";
  const out: string[] = [];
  out.push(
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n`,
    `<meta name="generator" content="voicecap ${esc(input.voicecapVersion)}">\n`,
    `<title>${esc(branding.title)}: ${kind.toLowerCase()} of run ${esc(run.id)}</title>\n`,
    `<style>${REPORT_CSS}</style>\n</head>\n<body>\n`,
    `<a class="skip-link" href="#main">Skip to main content</a>\n`,
    header(model),
    `<main id="main" tabindex="-1">\n`,
    model.banners.map(banner).join(""),
    summarySection(model),
    pagesSection(model, paths),
    comparisonSection(model, paths),
    skippedSection(model.input.run.skipped),
    historySection(model),
    manualSection(model, paths),
    environmentSection(model),
    aboutSection(),
    `</main>\n`,
    footer(model, paths),
    `<script>${REPORT_SCRIPT}</script>\n</body>\n</html>\n`,
  );
  return out.join("");
}

function header(model: ReportModel): string {
  const { run, branding, target, generatedAt } = model.input;
  const brand =
    branding.logo || branding.agency
      ? `<div class="brand">${branding.logo ? `<img src="${esc(branding.logo)}" alt="">` : ""}${
          branding.agency ? `<p class="agency">${esc(branding.agency)}</p>` : ""
        }</div>\n`
      : "";
  const site = `<a href="${esc(run.site)}">${esc(run.site)}</a>`;
  const subtitle =
    target === "live"
      ? `Live report for run <span class="mono">${esc(run.id)}</span> of ${site}, with reviews and manual sessions as of ${shortTime(generatedAt)}.`
      : `Snapshot of run <span class="mono">${esc(run.id)}</span> of ${site}, taken when the run completed (${shortTime(generatedAt)}).`;
  const sections: [string, string][] = [
    ["summary", "Summary"],
    ["pages", "Pages"],
    ...(model.input.compare ? ([["comparison", "Comparison"]] as [string, string][]) : []),
    ["skipped", "Skipped URLs"],
    ["history", "Review history"],
    ["manual", "Manual sessions"],
    ["environment", "Environment"],
    ["about", "About this report"],
  ];
  const toc = sections.map(([id, text]) => `<li><a href="#${id}">${text}</a></li>`).join("");
  return (
    `<header class="page-header">\n${brand}<h1>${esc(branding.title)}</h1>\n` +
    `<p class="subtitle">${subtitle}</p>\n` +
    `<nav class="toc" aria-label="Report sections"><ul>${toc}</ul></nav>\n</header>\n`
  );
}

function banner(item: Banner): string {
  const lines = item.lines.map((line) => `<p>${esc(line)}</p>`).join("");
  return `<div class="banner banner-${item.tone}"><p class="banner-title">${esc(item.title)}</p>${lines}</div>\n`;
}

function summarySection(model: ReportModel): string {
  const { run } = model.input;
  const s = model.summary;
  const source = run.settings.source;
  const sourceText =
    source.kind === "sitemap"
      ? `Full sitemap: <a href="${esc(source.url)}">${esc(source.url)}</a>`
      : source.kind === "pages"
        ? `Curated page list: <span class="mono">${esc(source.file)}</span> <span class="meta">SHA-256 <span class="mono">${esc(source.sha256.slice(0, 12))}…</span></span>`
        : esc(describePageUrls(source.urls));
  const item = (term: string, value: string) => `<div><dt>${term}</dt><dd>${value}</dd></div>`;
  const count = (n: number) => n.toLocaleString("en-US");
  const items = [
    item("Page source", sourceText),
    item("Driver and capture mode", esc(driverText(model))),
    item(
      "Pages in this run",
      `${count(s.totalPages)}${s.pending > 0 ? ` <span class="meta">${count(s.pending)} pending</span>` : ""}`,
    ),
    item("Pages transcribed", count(s.transcribed)),
    item("Pages reviewed", count(s.reviewed)),
    item("Changed since their last review", count(s.changedSinceReview)),
    item("Pages manually tested", count(s.manuallyTested)),
    item("Open issues", count(s.openIssues)),
    item("Pages with errors", count(s.withErrors)),
    item("Pages with heuristic flags", count(s.flagged)),
    item("Skipped URLs", count(s.skippedUrls)),
  ];
  const completed = run.completedAt
    ? `completed ${shortTime(run.completedAt)}`
    : "<strong>not completed</strong>";
  return (
    `<section>\n<h2 id="summary">Summary</h2>\n<dl class="summary-list">${items.join("")}</dl>\n` +
    `<p>Run <span class="mono">${esc(run.id)}</span>${run.name ? ` (“${esc(run.name)}”)` : ""} started ${shortTime(run.createdAt)}, ${completed}, in ${plural(run.sessions.length, "session")}. Passes: ${esc(run.settings.passes.join(", "))}.</p>\n` +
    sourceDetails(model) +
    `</section>\n`
  );
}

function driverText(model: ReportModel): string {
  const { run } = model.input;
  const env = model.environments.at(-1);
  if (!env) return `${run.settings.driver}, capture: ${run.settings.capture}`;
  if (env.replay) {
    return `${env.driver.name} ${env.driver.version}, replaying ${env.replay.sourceDriver} run ${env.replay.sourceRun}; capture: ${env.capture}`;
  }
  return `${env.driver.name} ${env.driver.version}, capture: ${env.capture}`;
}

function sourceDetails(model: ReportModel): string {
  const { source } = model.input.run;
  const pageSource = model.input.run.settings.source;
  const rows: string[] = [
    ...(pageSource.kind === "pages"
      ? [
          `<dt>Page list file</dt><dd class="mono">${esc(pageSource.file)}</dd>`,
          `<dt>Page list SHA-256</dt><dd class="mono">${esc(pageSource.sha256)}</dd>`,
        ]
      : []),
    ...(pageSource.kind === "urls"
      ? [
          `<dt>Pages given with --page</dt><dd><ul class="links">${pageSource.urls
            .map((url) => `<li><span class="mono">${esc(url)}</span></li>`)
            .join("")}</ul></dd>`,
        ]
      : []),
    `<dt>Entries listed</dt><dd>${source.listed.toLocaleString("en-US")}</dd>`,
    `<dt>Duplicates merged</dt><dd>${source.duplicates.toLocaleString("en-US")}</dd>`,
    `<dt>Excluded by --include / --exclude</dt><dd>${source.excludedByFilter.toLocaleString("en-US")}</dd>`,
    `<dt>Excluded by --limit</dt><dd>${source.excludedByLimit.toLocaleString("en-US")}</dd>`,
  ];
  if (source.encoding) rows.push(`<dt>File encoding</dt><dd>${esc(source.encoding)}</dd>`);
  if (source.sitemaps && source.sitemaps.length > 0) {
    const docs = source.sitemaps.map(
      (doc) =>
        `<li><span class="mono">${esc(doc.url)}</span>: ${doc.error ? `<span class="status-bad">failed: ${esc(doc.error)}</span>` : plural(doc.urls, "URL")}</li>`,
    );
    rows.push(`<dt>Sitemaps fetched</dt><dd><ul class="links">${docs.join("")}</ul></dd>`);
  }
  const invalid =
    source.invalid.length > 0
      ? `<h3>Invalid entries in the page source</h3>\n<ul>${source.invalid
          .map(
            (entry) =>
              `<li>${entry.line !== null ? `Line ${entry.line}: ` : ""}<span class="mono">${esc(entry.value || "(empty)")}</span> <span class="meta">${esc(entry.reason)}</span></li>`,
          )
          .join("")}</ul>\n`
      : "";
  return `<details><summary>Page source details</summary><dl class="details-list">${rows.join("")}</dl></details>\n${invalid}`;
}

function pagesSection(model: ReportModel, paths: RenderPaths): string {
  const { run } = model.input;
  if (model.rows.length === 0) {
    return `<section>\n<h2 id="pages">Pages</h2>\n<p>This run has no pages.</p>\n</section>\n`;
  }
  const passHeaders = model.passes
    .map((pass) => `<th scope="col">${PASS_LABEL[pass]} pass</th>`)
    .join("");
  const compareHeader = model.input.compare
    ? `<th scope="col">Compared with run ${esc(model.input.compare.base)}</th>`
    : "";
  const head =
    `<tr><th scope="col">Page</th><th scope="col">Template</th><th scope="col">Run status</th>${passHeaders}` +
    `<th scope="col">Heuristic flags</th><th scope="col">Current review</th><th scope="col">Review entries</th>` +
    `<th scope="col">Changed since review</th><th scope="col">Manual sessions</th><th scope="col">Transcripts</th>${compareHeader}</tr>`;
  const body = model.rows.map((row) => pageRow(row, model, paths)).join("\n");
  const total = plural(model.rows.length, "page");
  return (
    `<section>\n<h2 id="pages">Pages</h2>\n${filters(model)}` +
    `<p id="row-count" class="row-count" role="status">Showing ${model.rows.length.toLocaleString("en-US")} of ${total}</p>\n` +
    `<div class="table-scroll" role="region" aria-labelledby="pages-caption" tabindex="0">\n` +
    `<table id="pages-table" class="pages-table">\n<caption id="pages-caption">Pages in run ${esc(run.id)} (${total}). Scroll sideways for more columns.</caption>\n` +
    `<thead>${head}</thead>\n<tbody>\n${body}\n</tbody>\n</table>\n</div>\n</section>\n`
  );
}

function filters(model: ReportModel): string {
  const hasUntemplated = model.rows.some((row) => !row.page.template);
  const templateOptions = model.templates
    .map((template) => `<option value="${esc(template)}">${esc(template)}</option>`)
    .join("");
  const template =
    model.templates.length > 0
      ? `<div><label for="filter-template">Template</label><select id="filter-template"><option value="">All templates</option>${templateOptions}${
          hasUntemplated ? `<option value="${NO_TEMPLATE}">No template</option>` : ""
        }</select></div>`
      : "";
  const compare = model.input.compare
    ? `<div class="check"><input type="checkbox" id="filter-compare"><label for="filter-compare">Changed since run ${esc(model.input.compare.base)}</label></div>`
    : "";
  return (
    `<form id="filters" class="filters" hidden>\n<fieldset>\n<legend>Filter the pages table</legend>\n<div class="filter-controls">` +
    `<div><label for="filter-flagged">Heuristic flags</label><select id="filter-flagged"><option value="">All pages</option><option value="yes">Flagged</option><option value="no">Not flagged</option></select></div>` +
    `<div><label for="filter-review">Review status</label><select id="filter-review"><option value="">Any status</option><option value="unreviewed">Not reviewed</option><option value="reviewed">${REVIEW_LABEL.reviewed}</option><option value="issue">${REVIEW_LABEL.issue}</option><option value="fixed">${REVIEW_LABEL.fixed}</option></select></div>` +
    template +
    `<div class="check"><input type="checkbox" id="filter-changed"><label for="filter-changed">Changed since review</label></div>` +
    `<div class="check"><input type="checkbox" id="filter-manual"><label for="filter-manual">Manually tested</label></div>` +
    compare +
    `<div><button type="reset">Clear filters</button></div>` +
    `</div>\n</fieldset>\n</form>\n`
  );
}

function pageRow(row: ReportRow, model: ReportModel, paths: RenderPaths): string {
  const { page } = row;
  const name = pageName(page);
  const data = [
    `data-flagged="${page.flags.length > 0 ? "yes" : "no"}"`,
    `data-review="${row.reviewStatus}"`,
    `data-changed="${row.changed === true ? "yes" : "no"}"`,
    `data-manual="${row.manual.length > 0 ? "yes" : "no"}"`,
    `data-template="${esc(page.template || NO_TEMPLATE)}"`,
    ...(row.compare ? [`data-compare="${row.compare.state}"`] : []),
  ].join(" ");
  const cells = [
    pageCell(page, name),
    `<td>${page.template ? esc(page.template) : DASH}</td>`,
    `<td>${statusCell(page)}</td>`,
    ...model.passes.map((pass) => `<td>${passCell(page.passes[pass])}</td>`),
    `<td class="flags-cell">${
      page.flags.length > 0
        ? `<ul class="flags">${page.flags.map((flag) => `<li>${esc(flag.message)}</li>`).join("")}</ul>`
        : `<span class="none">None</span>`
    }</td>`,
    `<td class="review-cell">${reviewCell(row)}</td>`,
    `<td>${
      row.reviewCount > 0
        ? link(`#history-${page.slug}`, plural(row.reviewCount, "entry", "entries"), `for ${name}`)
        : `<span class="none">None</span>`
    }</td>`,
    `<td>${
      row.changed === true
        ? `<span class="status-bad">Changed</span>`
        : row.changed === false
          ? "Unchanged"
          : DASH
    }</td>`,
    `<td class="links-cell">${manualCell(row.manual, name, paths)}</td>`,
    `<td class="links-cell">${transcriptLinks(page, model, name, paths)}</td>`,
    ...(row.compare ? [`<td>${compareCell(row, model, name, paths)}</td>`] : []),
  ];
  return `<tr ${data}>${cells.join("")}</tr>`;
}

function pageCell(page: PageRecord, name: string): string {
  const url = page.label?.trim() ? `<span class="url">${esc(page.url)}</span>` : "";
  const final =
    page.finalUrl && page.finalUrl !== page.url
      ? `<span class="url">Final URL: ${esc(page.finalUrl)}</span>`
      : "";
  const notes = page.notes?.trim() ? `<span class="meta">Notes: ${esc(page.notes)}</span>` : "";
  return `<th scope="row"><a class="page-name url-wrap" href="${esc(page.url)}">${esc(name)}</a>${url}${final}${notes}</th>`;
}

function statusCell(page: PageRecord): string {
  const attempts = page.attempts > 1 ? `<span class="meta">${page.attempts} attempts</span>` : "";
  const errors =
    page.errors.length > 0
      ? `<ul class="links">${page.errors.map((error) => `<li>${esc(error)}</li>`).join("")}</ul>`
      : "";
  switch (page.status) {
    case "done":
      return `<span class="status-good">Done</span>${attempts}${errors}`;
    case "failed":
      return `<span class="status-bad">Failed</span>${attempts}${errors}`;
    case "pending":
      return `<span class="muted">Pending</span>`;
    case "skipped":
      return `Skipped${page.skip ? `<span class="meta">${esc(SKIP_REASON[page.skip.reason])}</span>` : ""}${errors}`;
  }
}

function passCell(summary: PassSummary | undefined): string {
  if (!summary) return DASH;
  const problems = [...summary.errors, ...summary.warnings];
  return (
    `${plural(summary.steps, "step")}<span class="meta">${esc(stopReasonText(summary.stopReason))}</span>` +
    (problems.length > 0
      ? `<ul class="links">${problems.map((problem) => `<li>${esc(problem)}</li>`).join("")}</ul>`
      : "")
  );
}

function reviewCell(row: ReportRow): string {
  if (!row.review) return `<span class="none">Not reviewed</span>`;
  const { status, reviewer, at } = row.review;
  const tone = status === "issue" ? "status-bad" : status === "unreviewed" ? "" : "status-good";
  return `<span class="${tone}">${REVIEW_LABEL[status]}</span><span class="meta">${esc(reviewer)}, ${shortTime(at)}</span>`;
}

function manualCell(sessions: ManualSessionFile[], name: string, paths: RenderPaths): string {
  if (sessions.length === 0) return `<span class="none">None</span>`;
  return linkList(
    sessions.map(
      (session) =>
        `${esc(session.json.id)} <span class="meta">${FORMAT_LABEL[session.json.input.format]}</span>${sessionLinks(session, `session ${session.json.id} for ${name}`, paths)}`,
    ),
  );
}

function sessionLinks(session: ManualSessionFile, context: string, paths: RenderPaths): string {
  const href = (relative: string) =>
    fileHref(paths.baseDir, path.join(paths.outDir, ...relative.split("/")));
  const links = [
    link(href(session.txtPath), "Transcript", context),
    link(href(session.jsonPath), "JSON", context),
  ];
  if (session.rawPath) links.push(link(href(session.rawPath), "Raw original", context));
  return ` ${links.join(" ")}`;
}

function transcriptLinks(
  page: PageRecord,
  model: ReportModel,
  name: string,
  paths: RenderPaths,
): string {
  const dir = pageDir(paths.outDir, model.input.run.id, page.slug);
  const passes = [...new Set([...model.passes, ...(Object.keys(page.passes) as PassName[])])];
  const items = passes.flatMap((pass) => {
    const files = [`${pass}.txt`, `${pass}.json`].filter((file) => page.files[file]);
    if (files.length === 0) return [];
    const links = files.map((file) =>
      link(
        fileHref(paths.baseDir, path.join(dir, file)),
        file.endsWith(".txt") ? "TXT" : "JSON",
        `${pass} pass transcript for ${name}`,
      ),
    );
    return [`${PASS_LABEL[pass]}: ${links.join(" ")}`];
  });
  return linkList(items);
}

function compareCell(row: ReportRow, model: ReportModel, name: string, paths: RenderPaths): string {
  const compare = row.compare!;
  const base = model.input.compare?.base ?? "";
  switch (compare.state) {
    case "changed":
      return `<span class="status-bad">Changed</span>${linkList(
        compare.passes.map((pass) =>
          link(
            fileHref(paths.baseDir, pass.diffFile),
            `${PASS_LABEL[pass.pass]} diff`,
            `for ${name}`,
          ),
        ),
      )}`;
    case "unchanged":
      return "Unchanged";
    case "new":
      return `Not in run ${esc(base)}`;
    case "not-compared":
      return `Not compared<span class="meta">${esc(compare.reason ?? "")}</span>`;
  }
}

function comparisonSection(model: ReportModel, paths: RenderPaths): string {
  const compare = model.input.compare;
  if (!compare) return "";
  const pageItem = (page: { url: string; label?: string }) =>
    `<li><a class="url-wrap" href="${esc(page.url)}">${esc(pageName(page))}</a></li>`;
  const list = (items: { url: string; label?: string }[], empty: string) =>
    items.length > 0 ? `<ul>${items.map(pageItem).join("")}</ul>` : `<p>${empty}</p>`;
  const changed =
    compare.changed.length > 0
      ? `<ul>${compare.changed
          .map(
            (page) =>
              `<li>${esc(pageName(page))}: ${page.passes
                .map((pass) =>
                  link(
                    fileHref(paths.baseDir, pass.diffFile),
                    `${PASS_LABEL[pass.pass]} diff`,
                    `for ${pageName(page)}`,
                  ),
                )
                .join(", ")}</li>`,
          )
          .join("")}</ul>`
      : "<p>No page's transcripts changed.</p>";
  const differences =
    compare.environmentDifferences.length > 0
      ? `<h3>Environment differences</h3>\n<ul>${compare.environmentDifferences.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>\n`
      : `<p>Both runs used the same driver, NVDA, browser, voicecap, NVDA settings, and capture mode.</p>\n`;
  return (
    `<section>\n<h2 id="comparison">Comparison with run ${esc(compare.base)}</h2>\n` +
    `<p>Pages in both runs are compared by their transcript lines; header blocks are ignored. ` +
    `${plural(compare.changed.length, "page")} changed, ${compare.unchanged.toLocaleString("en-US")} unchanged, ` +
    `${compare.notCompared.length.toLocaleString("en-US")} not compared; ${compare.onlyInRun.length.toLocaleString("en-US")} only in this run and ${compare.onlyInBase.length.toLocaleString("en-US")} only in run ${esc(compare.base)}.</p>\n` +
    differences +
    `<h3>Changed pages</h3>\n${changed}\n` +
    `<h3>Pages only in this run</h3>\n${list(compare.onlyInRun, "None.")}\n` +
    `<h3>Pages only in run ${esc(compare.base)}</h3>\n${list(compare.onlyInBase, "None.")}\n` +
    `</section>\n`
  );
}

function skippedSection(skipped: SkippedRecord[]): string {
  if (skipped.length === 0) {
    return `<section>\n<h2 id="skipped">Skipped URLs</h2>\n<p>No URLs were skipped.</p>\n</section>\n`;
  }
  const rows = skipped
    .map((record) => {
      const details = [
        record.finalUrl ? `Final URL: ${esc(record.finalUrl)}` : "",
        record.contentType ? `Content type: ${esc(record.contentType)}` : "",
        record.status !== undefined && record.status !== null ? `HTTP ${record.status}` : "",
        record.line !== undefined ? `Line ${record.line}` : "",
      ].filter((detail) => detail !== "");
      return `<tr><td class="url-wrap">${esc(record.url)}</td><td>${esc(SKIP_REASON[record.reason])}</td><td>${details.length > 0 ? details.join("<br>") : DASH}</td></tr>`;
    })
    .join("\n");
  return (
    `<section>\n<h2 id="skipped">Skipped URLs</h2>\n<p>${plural(skipped.length, "URL was", "URLs were")} skipped and not transcribed.</p>\n` +
    `<details><summary>Show the skipped URLs</summary>\n<table class="skipped-table">\n<caption>Skipped URLs and why</caption>\n` +
    `<thead><tr><th scope="col">URL</th><th scope="col">Reason</th><th scope="col">Details</th></tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>\n</details>\n</section>\n`
  );
}

function historySection(model: ReportModel): string {
  const intro =
    `<p>Every review decision, oldest first. Entries are never edited or deleted; ` +
    `a correction is a new entry, and the latest entry is the page's current status.</p>\n`;
  if (model.histories.length === 0) {
    return `<section>\n<h2 id="history">Review history</h2>\n${intro}<p>No reviews have been recorded yet.</p>\n</section>\n`;
  }
  const groups = model.histories.map((group) => historyGroup(group)).join("\n");
  return `<section>\n<h2 id="history">Review history</h2>\n${intro}<div class="history">\n${groups}\n</div>\n</section>\n`;
}

function historyGroup(group: PageGroup<ReviewEntry>): string {
  const entries = group.items
    .map((entry) => {
      const files = Object.entries(entry.files);
      const hashes =
        files.length > 0
          ? `<details><summary>Hashes of the reviewed transcripts</summary><ul class="links mono">${files
              .map(([file, hash]) => `<li>${esc(file)}: ${esc(hash)}</li>`)
              .join("")}</ul></details>`
          : "";
      return (
        `<li><p><strong>${REVIEW_LABEL[entry.status]}</strong>, by ${esc(entry.reviewer)} on ${esc(entry.at)}` +
        `${entry.run ? `, reviewing run <span class="mono">${esc(entry.run)}</span>` : ""}.</p>` +
        `${entry.note ? `<p>Note: ${esc(entry.note)}</p>` : ""}${hashes}</li>`
      );
    })
    .join("");
  const note = group.inRun ? "" : ` <span class="meta">Not in this run</span>`;
  return `<h3 id="history-${esc(group.slug)}">${esc(group.name)}</h3>${note}\n<ol>${entries}</ol>`;
}

function manualSection(model: ReportModel, paths: RenderPaths): string {
  const intro = `<p>Hands-on NVDA sessions imported with <code>voicecap manual add</code>.</p>\n`;
  if (model.manualGroups.length === 0) {
    return `<section>\n<h2 id="manual">Manual NVDA sessions</h2>\n${intro}<p>No manual sessions have been imported yet.</p>\n</section>\n`;
  }
  const groups = model.manualGroups
    .map((group) => {
      const items = group.items
        .map((session) => {
          const json = session.json;
          const when = [
            json.session.date,
            json.session.start && json.session.end
              ? `${json.session.start} to ${json.session.end}`
              : "",
          ]
            .filter((part) => part !== "")
            .join(", ");
          const redaction = json.redaction.applied
            ? ` Typed text was redacted (${plural(json.redaction.keystrokes, "keystroke")}, ${plural(json.redaction.speech, "speech entry", "speech entries")}).`
            : "";
          const raw = json.input.raw.kept
            ? ""
            : ` The raw original was ${json.input.raw.reason === "withheld-for-privacy" ? "withheld for privacy" : "not kept"}; its SHA-256 is <span class="mono">${esc(json.input.sha256)}</span>.`;
          return (
            `<li><p><strong>Session ${esc(json.id)}</strong>: ${FORMAT_LABEL[json.input.format]} (${esc(json.input.fileName)}), ${esc(when)}. ` +
            `Imported ${esc(json.importedAt)} by ${esc(json.reviewer)}; ${plural(json.entries.length, "entry", "entries")}.${redaction}${raw}</p>` +
            `<p>${sessionLinks(session, `session ${json.id} for ${group.name}`, paths)}</p></li>`
          );
        })
        .join("");
      const note = group.inRun ? "" : ` <span class="meta">Not in this run</span>`;
      return `<h3 id="manual-${esc(group.slug)}">${esc(group.name)}</h3>${note}\n<ul>${items}</ul>`;
    })
    .join("\n");
  return `<section>\n<h2 id="manual">Manual NVDA sessions</h2>\n${intro}<div class="sessions">\n${groups}\n</div>\n</section>\n`;
}

function environmentSection(model: ReportModel): string {
  const sessions = model.sessions
    .map(
      (session) =>
        `<tr><td>${session.n}</td><td>${esc(reviewerCell(session.reviewer))}</td><td>${esc(session.startedAt)}</td><td>${session.endedAt ? esc(session.endedAt) : DASH}</td><td>${esc(session.endReason ?? "did not end cleanly")}</td><td>${session.pagesDone.toLocaleString("en-US")}</td></tr>`,
    )
    .join("\n");
  const sessionTable =
    model.sessions.length > 0
      ? `<table class="sessions-table">\n<caption>Sessions of this run (each start or resume)</caption>\n<thead><tr><th scope="col">Session</th><th scope="col">Reviewer</th><th scope="col">Started</th><th scope="col">Ended</th><th scope="col">How it ended</th><th scope="col">Pages done</th></tr></thead>\n<tbody>\n${sessions}\n</tbody>\n</table>\n`
      : `<p>This run has no sessions yet.</p>\n`;
  const environments =
    model.environments.length === 0
      ? `<p>No environment was recorded: the driver never started.</p>\n`
      : model.environments
          .map(
            (env, index) =>
              `${model.environments.length > 1 ? `<h3>Environment ${index + 1}</h3>\n` : ""}${environmentList(env)}`,
          )
          .join("");
  return `<section>\n<h2 id="environment">Environment</h2>\n${sessionTable}${environments}</section>\n`;
}

/** Who ran a session: the name; "None given" when it had none; "Not recorded" before voicecap kept it. */
function reviewerCell(reviewer: SessionRecord["reviewer"]): string {
  if (reviewer === undefined) return "Not recorded";
  return reviewer === null ? "None given" : reviewer.name;
}

function environmentList(env: EnvironmentRecord): string {
  const items = environmentLines(env).map((line) => {
    const colon = line.indexOf(": ");
    const term = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 2);
    return `<dt>${esc(term)}</dt><dd>${esc(value)}</dd>`;
  });
  return `<dl class="details-list">${items.join("")}</dl>\n`;
}

function aboutSection(): string {
  return (
    `<section>\n<h2 id="about">About this report</h2>\n` +
    `<p>voicecap drove the NVDA screen reader through each page and saved what it said as text transcripts, so a person can skim them faster than listening and diff them between runs. ` +
    `The transcripts support human review; they don't replace it.</p>\n<dl class="details-list">` +
    `<dt>Passes</dt><dd>Read: every line from top to bottom in browse mode. Headings: heading by heading. Tab: every focus stop, from the top of the page until focus leaves it.</dd>` +
    `<dt>Stop reasons</dt><dd>End reached: the last line was spoken and then repeated, which is how NVDA behaves at the end of a page. ` +
    `No next heading: NVDA said so. Left the document: Tab moved focus into the browser. ` +
    `Repeat limit: the same speech came many times in a row, so the pass stopped as a safety net. Step cap: the pass hit its maximum number of steps.</dd>` +
    `<dt>Heuristic flags</dt><dd>Point to things a person should check, such as generic link text or unlabeled controls. They never fail a page.</dd>` +
    `<dt>Changed since review</dt><dd>The page's transcript lines differ from the ones recorded with its latest review.</dd>` +
    `</dl>\n</section>\n`
  );
}

function footer(model: ReportModel, paths: RenderPaths): string {
  const { run, target, generatedAt, voicecapVersion } = model.input;
  const other =
    target === "snapshot"
      ? `<p>This snapshot was taken when the run completed. ${link(fileHref(paths.baseDir, liveReportPath(paths.outDir)), "Open the live report")} for later reviews and manual sessions.</p>`
      : paths.snapshotExists
        ? `<p>${link(fileHref(paths.baseDir, runReportPath(paths.outDir, run.id)), `Open the snapshot of run ${run.id}`)}, taken when it completed.</p>`
        : "";
  return `<footer class="page-footer">\n<p>Generated by voicecap ${esc(voicecapVersion)} on ${esc(generatedAt)}.</p>\n${other}\n</footer>\n`;
}
