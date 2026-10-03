import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { VoicecapConfig } from "../src/config/schema.js";
import type { PageSource, RunJson } from "../src/model.js";
import { buildReportModel, generateReport, renderReport } from "../src/report/index.js";
import { linkPath, liveCompareDir, runDir, runJsonPath, runReportPath } from "../src/run/paths.js";
import { writeRunJson } from "../src/run/store.js";
import {
  LOGO,
  addManualSession,
  addReview,
  buildRichFixture,
  findPage,
  tempOutDir,
  writeSyntheticRun,
} from "./helpers/report-data.js";

const config: VoicecapConfig = {
  ...DEFAULT_CONFIG,
  report: {
    ...DEFAULT_CONFIG.report,
    title: "Agency NVDA report",
    agency: "Example Agency",
    logo: LOGO,
  },
};

/** The text of each summary item, by its label. */
function summary(html: string): Map<string, string> {
  const items = new Map<string, string>();
  const section = html.slice(html.indexOf('<dl class="summary-list">'), html.indexOf("</dl>"));
  for (const match of section.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)) {
    items.set(match[1]!, match[2]!.replace(/<[^>]+>/g, "").trim());
  }
  return items;
}

/** Every href in the document. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
}

/** Local links resolve to files; in-page links resolve to ids. Returns the broken ones. */
function brokenLinks(html: string, file: string): string[] {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!));
  return hrefs(html).filter((href) => {
    if (/^(https?:|mailto:|data:)/.test(href)) return false;
    if (href.startsWith("#")) return !ids.has(href.slice(1));
    const target = path.resolve(path.dirname(file), ...href.split("/").map(decodeURIComponent));
    return !existsSync(target);
  });
}

/** The live report of a run of one page, whose pages came from `source`. */
async function reportOfRunFrom(source: PageSource): Promise<string> {
  const outDir = await tempOutDir();
  const run = await writeSyntheticRun(outDir, {
    id: "2026-09-26_1405",
    source,
    pages: [{ path: "/" }],
  });
  const { file } = await generateReport({ outDir, run, target: "live", config });
  return readFile(file, "utf8");
}

function row(html: string, pageName: string): string {
  const rows = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>")).split("<tr ");
  const found = rows.find((candidate) => candidate.includes(`>${pageName}</a>`));
  if (!found) throw new Error(`No row for ${pageName}`);
  return found;
}

describe("generateReport", () => {
  it("writes a live report with the summary counts", async () => {
    const outDir = await tempOutDir();
    const { run } = await buildRichFixture(outDir);
    const { file } = await generateReport({ outDir, run, target: "live", config });
    expect(file).toBe(path.join(outDir, "report.html"));
    const html = await readFile(file, "utf8");
    const items = summary(html);

    expect(items.get("Page source")).toContain("Curated page list: pages.csv");
    expect(items.get("Driver and capture mode")).toBe("guidepup 0.34.0, capture: complete");
    expect(items.get("Pages in this run")).toBe("6");
    expect(items.get("Pages transcribed")).toBe("4");
    // Home (fixed), grants (reviewed), resources (issue).
    expect(items.get("Pages reviewed")).toBe("3");
    // Grants was reviewed against the earlier run and its read transcript changed since.
    expect(items.get("Changed since their last review")).toBe("1");
    expect(items.get("Pages manually tested")).toBe("2");
    expect(items.get("Open issues")).toBe("1");
    expect(items.get("Pages with errors")).toBe("1");
    expect(items.get("Pages with heuristic flags")).toBe("1");
    expect(items.get("Skipped URLs")).toBe("3");
  });

  it("describes a --page run with describePageUrls and lists every URL given", async () => {
    const outDir = await tempOutDir();
    const urls = [
      "https://dvfr.illinois.gov/",
      "https://dvfr.illinois.gov/about/",
      "https://dvfr.illinois.gov/faq/",
    ];
    const run = await writeSyntheticRun(outDir, {
      id: "2026-09-26_1405",
      source: { kind: "urls", urls },
      pages: [{ path: "/faq/" }],
    });
    const html = await readFile(
      (await generateReport({ outDir, run, target: "live", config })).file,
      "utf8",
    );
    expect(summary(html).get("Page source")).toBe(
      "3 pages (https://dvfr.illinois.gov/, https://dvfr.illinois.gov/about/, https://dvfr.illinois.gov/faq/)",
    );
    const detailRow = html.match(/<dt>Pages given with --page<\/dt><dd>([\s\S]*?)<\/dd>/);
    expect(detailRow).not.toBeNull();
    for (const url of urls) expect(detailRow![1]).toContain(url);
  });

  it("describes a sitemap run by its address, with no file in the page source details", async () => {
    const html = await reportOfRunFrom({
      kind: "sitemap",
      url: "https://example.illinois.gov/sitemap.xml",
    });

    expect(summary(html).get("Page source")).toBe(
      "Full sitemap: https://example.illinois.gov/sitemap.xml",
    );
    expect(html).not.toContain("<dt>Page list file</dt>");
    expect(html).not.toContain("<dt>Walkthrough file</dt>");
  });

  it("describes a page list run by its file and SHA-256", async () => {
    const html = await reportOfRunFrom({
      kind: "pages",
      file: "pages.csv",
      sha256: "a".repeat(64),
    });

    expect(summary(html).get("Page source")).toBe(
      "Curated page list: pages.csv SHA-256 aaaaaaaaaaaa…",
    );
    expect(html).toContain('<dt>Page list file</dt><dd class="mono">pages.csv</dd>');
    expect(html).toContain(`<dt>Page list SHA-256</dt><dd class="mono">${"a".repeat(64)}</dd>`);
    expect(html).not.toContain("<dt>Walkthrough file</dt>");
  });

  it("describes a walkthrough run by its run, its file, and its SHA-256", async () => {
    const html = await reportOfRunFrom({
      kind: "walkthrough",
      file: "w.json",
      sha256: "a".repeat(64),
      run: "2026-09-29_1402",
    });

    expect(summary(html).get("Page source")).toBe(
      "Walkthrough of run 2026-09-29_1402 (w.json) SHA-256 aaaaaaaaaaaa…",
    );
    expect(html).toContain('<dt>Walkthrough file</dt><dd class="mono">w.json</dd>');
    expect(html).toContain(`<dt>Walkthrough SHA-256</dt><dd class="mono">${"a".repeat(64)}</dd>`);
    expect(html).toContain('<dt>Walkthrough of run</dt><dd class="mono">2026-09-29_1402</dd>');
    expect(html).not.toContain("<dt>Page list file</dt>");
  });

  it("has every column, and rows carry their filter data", async () => {
    const outDir = await tempOutDir();
    const { base, run } = await buildRichFixture(outDir);
    const { file } = await generateReport({
      outDir,
      run,
      target: "live",
      config,
      compare: { base, diffDir: liveCompareDir(outDir, base.id, run.id) },
    });
    const html = await readFile(file, "utf8");
    const head = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
    const columns = [...head.matchAll(/<th scope="col">(.*?)<\/th>/g)].map((match) => match[1]);
    expect(columns).toEqual([
      "Page",
      "Template",
      "Run status",
      "Read pass",
      "Headings pass",
      "Tab pass",
      "Heuristic flags",
      "Current review",
      "Review entries",
      "Changed since review",
      "Manual sessions",
      "Transcripts",
      `Compared with run ${base.id}`,
    ]);
    expect(html).toContain('<caption id="pages-caption">');
    expect(html).toContain('role="region" aria-labelledby="pages-caption" tabindex="0"');

    const grants = row(html, "FY27 JAG");
    expect(grants).toContain('data-changed="yes"');
    expect(grants).toContain('data-review="reviewed"');
    expect(grants).toContain('data-template="grants"');
    expect(grants).toContain('data-compare="changed"');
    expect(grants).toContain("6 steps");
    expect(grants).toContain("end reached");
    expect(grants).toContain("no next heading");
    expect(grants).toContain("left the document");
    expect(grants).toContain("Read diff");

    const resources = row(html, "Resources");
    expect(resources).toContain('data-flagged="yes"');
    expect(resources).toContain("Generic link text announced 3 times");
    expect(resources).toContain("Unlabeled button");
    expect(resources).toContain('data-manual="yes"');
    expect(resources).toContain("Issue found");
    expect(resources).toContain("Pat Reviewer");
    expect(resources).toContain('data-compare="unchanged"');

    const broken = row(html, `${run.site}broken`);
    expect(broken).toContain("Failed");
    expect(broken).toContain("Timed out twice; gave up");
    expect(broken).toContain("2 attempts");

    const contact = row(html, `${run.site}contact`);
    expect(contact).toContain("Redirected to a different origin");

    expect(row(html, "New page")).toContain('data-compare="new"');
    expect(row(html, "Home")).toContain('href="#history-home"');
    expect(row(html, "Home")).toContain("3 entries");
  });

  it("links only to files that exist, from the live report and the snapshot", async () => {
    const outDir = await tempOutDir();
    // The snapshot is written just before the run is sealed, so run.json on disk is incomplete.
    const { base, run } = await buildRichFixture(outDir, { sealRun: false });
    const snapshot = await generateReport({
      outDir,
      run,
      target: "snapshot",
      config,
      compare: { base, diffDir: path.join(runDir(outDir, run.id), "compare", base.id) },
    });
    await writeRunJson(outDir, run);
    const live = await generateReport({
      outDir,
      run,
      target: "live",
      config,
      compare: { base, diffDir: liveCompareDir(outDir, base.id, run.id) },
    });
    expect(snapshot.file).toBe(path.join(runDir(outDir, run.id), "report.html"));

    for (const file of [snapshot.file, live.file]) {
      const html = await readFile(file, "utf8");
      expect(brokenLinks(html, file)).toEqual([]);
      // Transcripts, manual sessions, and diffs are all linked.
      expect(html).toMatch(/pages\/[^"]+\/read\.txt/);
      expect(html).toMatch(/2026-09-25\/2358_manual_[^"/]+\/session\.txt/);
      expect(html).toMatch(/read\.diff\.txt/);
    }
    const liveHtml = await readFile(live.file, "utf8");
    expect(liveHtml).toContain(linkPath(outDir, runReportPath(outDir, run.id)));
    const snapshotHtml = await readFile(snapshot.file, "utf8");
    expect(snapshotHtml).toContain('href="../../report.html"');
    expect(snapshotHtml).toContain('href="pages/');
    expect(snapshotHtml).toContain('href="../../2026-09-25/');
  });

  it("has no external assets", async () => {
    const outDir = await tempOutDir();
    const { run } = await buildRichFixture(outDir);
    const html = await readFile(
      (await generateReport({ outDir, run, target: "live", config })).file,
      "utf8",
    );
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/url\(/i);
    for (const match of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
      expect(match[1]).toMatch(/^data:image\//);
    }
    expect(html).toContain('<img src="data:image/png;base64,');
    expect(html).toContain("Example Agency");
    expect(html).toContain("<title>Agency NVDA report: live report of run 2026-09-26_1405</title>");
  });

  it("marks an incomplete run", async () => {
    const outDir = await tempOutDir();
    const run = await writeSyntheticRun(outDir, {
      id: "2026-09-26_1405",
      status: "incomplete",
      pages: [
        { path: "/" },
        { path: "/a" },
        { path: "/b", status: "failed", errors: ["boom"] },
        { path: "/c", status: "pending" },
        { path: "/d", status: "pending" },
      ],
    });
    const html = await readFile(
      (await generateReport({ outDir, run, target: "live", config })).file,
      "utf8",
    );
    expect(html).toContain("Incomplete run: 3 of 5 pages done");
    expect(html).toContain("not completed");
    expect(summary(html).get("Pages in this run")).toBe("5 2 pending");
  });

  it("labels replayed output prominently", async () => {
    const outDir = await tempOutDir();
    const run = await writeSyntheticRun(outDir, {
      id: "2026-09-26_1405",
      replayed: true,
      pages: [{ path: "/" }],
    });
    const html = await readFile(
      (await generateReport({ outDir, run, target: "live", config })).file,
      "utf8",
    );
    expect(html).toContain("banner-danger");
    expect(html).toContain("Replayed output: not a live NVDA session");
    expect(html).toContain("replaying hand-written run 2026-09-20_0930");
  });

  it("warns when the environment changed during the run, and shows source warnings", async () => {
    const outDir = await tempOutDir();
    const run = await writeSyntheticRun(outDir, {
      id: "2026-09-26_1405",
      pages: [{ path: "/" }],
      resumedWith: [{ browser: { name: "Chrome", version: "142.0.1.1" } }],
      sourceWarnings: ["Most URLs (8 of 10) are on a different origin."],
    });
    const html = await readFile(
      (await generateReport({ outDir, run, target: "live", config })).file,
      "utf8",
    );
    expect(html).toContain("The environment changed during this run");
    expect(html).toContain("Browser differs: Chrome 141.0.7390.55 → Chrome 142.0.1.1");
    expect(html).toContain("Most URLs (8 of 10) are on a different origin.");
    expect(html).toContain("<h3>Environment 2</h3>");
  });

  it("names who ran each session, and says when there was no name or none was recorded", async () => {
    const outDir = await tempOutDir();
    const run = await writeSyntheticRun(outDir, {
      id: "2026-09-26_1405",
      pages: [{ path: "/" }],
      resumedWith: [{}, {}],
    });
    run.sessions[0]!.reviewer = { name: "cschweda", source: "option" };
    run.sessions[1]!.reviewer = null;
    // The third, like a session from before voicecap recorded the reviewer, has none at all.
    const html = await readFile(
      (await generateReport({ outDir, run, target: "live", config })).file,
      "utf8",
    );
    const start = html.indexOf('<table class="sessions-table">');
    const table = html.slice(start, html.indexOf("</table>", start));
    expect(table).toContain('<th scope="col">Reviewer</th>');
    const cells = table
      .split("<tr>")
      .slice(2)
      .map((row) => /<td>[^<]*<\/td><td>([^<]*)<\/td>/.exec(row)?.[1]);
    expect(cells).toEqual(["cschweda", "None given", "Not recorded"]);
  });

  it("refuses to write a snapshot into a completed run", async () => {
    const outDir = await tempOutDir();
    const run = await writeSyntheticRun(outDir, { id: "2026-09-26_1405", pages: [{ path: "/" }] });
    expect(existsSync(runJsonPath(outDir, run.id))).toBe(true);
    await expect(generateReport({ outDir, run, target: "snapshot", config })).rejects.toThrow(
      /completed/,
    );
  });

  it("shows review history oldest first, including pages not in the run", async () => {
    const outDir = await tempOutDir();
    const { base, run } = await buildRichFixture(outDir);
    await addReview(outDir, base, "/retired-page", "reviewed", { note: "Looked fine." });
    const html = await readFile(
      (await generateReport({ outDir, run, target: "live", config })).file,
      "utf8",
    );
    const history = html.slice(html.indexOf('<h2 id="history">'), html.indexOf('<h2 id="manual">'));
    expect(history).toContain('<h3 id="history-home">Home</h3>');
    const first = history.indexOf(
      "<strong>Reviewed, no issues</strong>, by Pat Reviewer on 2026-09-21",
    );
    const second = history.indexOf("<strong>Issue found</strong>, by Pat Reviewer on 2026-09-22");
    const third = history.indexOf("<strong>Fixed</strong>");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(history).toContain("Note: Skip link target is wrong.");
    expect(history).toContain(
      `${run.site}retired-page</h3> <span class="meta">Not in this run</span>`,
    );
    expect(history).toMatch(/read\.txt: [0-9a-f]{64}/);
  });

  it("describes manual sessions, including withheld raw originals", async () => {
    const outDir = await tempOutDir();
    const { run } = await buildRichFixture(outDir);
    await addManualSession(outDir, "/grants/fy27-jag", "2026-09-23_0800", { raw: "no-raw" });
    const html = await readFile(
      (await generateReport({ outDir, run, target: "live", config })).file,
      "utf8",
    );
    const manual = html.slice(
      html.indexOf('<h2 id="manual">'),
      html.indexOf('<h2 id="environment">'),
    );
    expect(manual).toContain("Session 2026-09-25_2358</strong>: NVDA log");
    expect(manual).toContain("Typed text was redacted (15 keystrokes, 15 speech entries)");
    expect(manual).toContain("The raw original was withheld for privacy");
    expect(manual).toContain("The raw original was not kept");
    expect(manual).toContain("Speech Viewer");
    expect(summary(html).get("Pages manually tested")).toBe("3");
  });

  it("escapes page labels, notes, flags, and review notes", async () => {
    const outDir = await tempOutDir();
    const evil = `<script>alert("x")</script> & 'friends'`;
    const run = await writeSyntheticRun(outDir, {
      id: "2026-09-26_1405",
      pages: [
        {
          path: "/evil?q=<b>",
          label: evil,
          template: `<i>t</i>`,
          notes: evil,
          flags: [{ rule: "custom", message: evil }],
        },
      ],
    });
    await addReview(outDir, run, "/evil?q=<b>", "issue", { note: evil, reviewer: `<b>R</b>` });
    const html = await readFile(
      (await generateReport({ outDir, run, target: "live", config })).file,
      "utf8",
    );
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<b>R</b>");
    expect(html).not.toContain("<i>t</i>");
    expect(html).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;friends&#39;",
    );
    expect(html.match(/<script>/g)?.length).toBe(1);
  });

  it("renders a run with no pages", async () => {
    const outDir = await tempOutDir();
    const run = await writeSyntheticRun(outDir, { id: "2026-09-26_1405", pages: [] });
    const html = await readFile(
      (await generateReport({ outDir, run, target: "live", config })).file,
      "utf8",
    );
    expect(html).toContain("This run has no pages.");
    expect(html).not.toContain('<table id="pages-table"');
  });

  it("shows the default title without branding", async () => {
    const outDir = await tempOutDir();
    const run: RunJson = await writeSyntheticRun(outDir, {
      id: "2026-09-26_1405",
      pages: [{ path: "/" }],
    });
    const html = await readFile(
      (await generateReport({ outDir, run, target: "live", config: DEFAULT_CONFIG })).file,
      "utf8",
    );
    expect(html).toContain("<h1>NVDA transcript report</h1>");
    expect(html).not.toContain('class="brand"');
    expect(findPage(run, "/").slug).toBe("home");
  });

  it("renders 2,000 pages quickly", async () => {
    const outDir = await tempOutDir();
    const template = await writeSyntheticRun(outDir, {
      id: "2026-09-26_1405",
      pages: [{ path: "/p" }],
    });
    const one = template.pages[0]!;
    const pages = Array.from({ length: 2000 }, (_, index) => ({
      ...one,
      url: `${one.url}/${index}`,
      key: `${one.key}/${index}`,
      slug: `p-${index}-0123456789`,
      label: `Page ${index} with a fairly long label for realism`,
      template: `template-${index % 10}`,
      flags: index % 7 === 0 ? [{ rule: "generic-link-text", message: "Generic link text" }] : [],
    }));
    const run: RunJson = { ...template, pages };
    const started = performance.now();
    const model = buildReportModel({
      run,
      target: "live",
      reviews: { schemaVersion: 1, pages: {} },
      manual: [],
      compare: null,
      branding: config.report,
      generatedAt: "2026-09-26T18:00:00-05:00",
      voicecapVersion: "0.1.0",
    });
    const html = renderReport(model, { outDir, baseDir: outDir, snapshotExists: false });
    const elapsed = performance.now() - started;
    expect(html.split("<tr data-flagged=").length - 1).toBe(2000);
    expect(model.templates).toHaveLength(10);
    expect(elapsed).toBeLessThan(3000);
  });
});
