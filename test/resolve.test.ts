import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pageSourceFor, resolvePages } from "../src/pages/resolve.js";
import { parseSiteUrl } from "../src/pages/url.js";
import { UsageError } from "../src/util/errors.js";
import { createMemoryLogger } from "../src/util/log.js";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const SITE_DIR = new URL("../fixture/site/", import.meta.url);
const ORIGIN = "http://127.0.0.1:4747";
const site = parseSiteUrl(ORIGIN);

/** Serves fixture/site as http://127.0.0.1:4747, plus in-memory documents. */
function fetchFrom(extra: Record<string, string> = {}): typeof fetch {
  return async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (extra[url] !== undefined) return new Response(extra[url], { status: 200 });
    if (!url.startsWith(`${ORIGIN}/`)) throw new TypeError("fetch failed");
    try {
      return new Response(await readFile(new URL(url.slice(ORIGIN.length + 1), SITE_DIR)));
    } catch {
      return new Response("not found", { status: 404 });
    }
  };
}

const urlset = (...locs: string[]) =>
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-resolve-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("resolvePages: the fixture sitemap", () => {
  it("keeps the site's pages and skips other origins and non-HTML files", async () => {
    const logger = createMemoryLogger();
    const result = await resolvePages({
      site,
      sitemap: `${ORIGIN}/sitemap.xml`,
      fetch: fetchFrom(),
      logger,
    });
    expect(result.pageSource).toEqual({ kind: "sitemap", url: `${ORIGIN}/sitemap.xml` });
    expect(result.pages.map((p) => p.url)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/duplicates/`,
      `${ORIGIN}/flawed/`,
      // Skipped only when loaded: a redirect off-origin and an RSS response.
      `${ORIGIN}/contact/`,
      `${ORIGIN}/feed/`,
    ]);
    expect(result.pages[0]).toEqual({ url: `${ORIGIN}/`, key: `${ORIGIN}/`, slug: "home" });
    expect(result.pages[1]!.key).toBe(`${ORIGIN}/duplicates`);
    expect(result.pages[1]!.slug).toMatch(/^duplicates-[0-9a-f]{10}$/);
    expect(result.skipped).toEqual([
      { url: "https://www.example.com/partner/", reason: "off-origin" },
      { url: `${ORIGIN}/files/annual-report.pdf`, reason: "non-html-extension" },
    ]);
    expect(result.source).toMatchObject({
      kind: "sitemap",
      listed: 7,
      duplicates: 0,
      invalid: [],
      excludedByFilter: 0,
      excludedByLimit: 0,
      warnings: [],
    });
    expect(result.source.sitemaps).toHaveLength(3);
    expect(logger.text("info")).toMatch(/Skipped 1 URL not on http:\/\/127\.0\.0\.1:4747/);
    expect(logger.text("info")).toMatch(/Skipped 1 URL not HTML pages/);
    expect(logger.text("info")).toMatch(/5 pages to transcribe/);
    expect(logger.text("alert")).toBe("");
  });

  it("applies include, exclude, and limit after skipping", async () => {
    const result = await resolvePages({
      site,
      sitemap: `${ORIGIN}/sitemap.xml`,
      fetch: fetchFrom(),
      include: ["**"],
      exclude: ["contact", "re:^/feed"],
      limit: 2,
    });
    expect(result.pages.map((p) => p.url)).toEqual([`${ORIGIN}/`, `${ORIGIN}/duplicates/`]);
    expect(result.source.excludedByFilter).toBe(2);
    expect(result.source.excludedByLimit).toBe(1);
  });
});

describe("resolvePages: normalization and dedupe", () => {
  it("drops fragments, merges /about and /about/ keeping the first form, and keeps queries", async () => {
    const result = await resolvePages({
      site,
      sitemap: `${ORIGIN}/dupes.xml`,
      fetch: fetchFrom({
        [`${ORIGIN}/dupes.xml`]: urlset(
          `${ORIGIN}/about/#team`,
          `${ORIGIN}/about`,
          `${ORIGIN}/about/`,
          `${ORIGIN}/news?page=1`,
          `${ORIGIN}/news?page=2`,
          `${ORIGIN}/news/?page=1`,
        ),
      }),
    });
    expect(result.pages.map((p) => p.url)).toEqual([
      `${ORIGIN}/about/`,
      `${ORIGIN}/news?page=1`,
      `${ORIGIN}/news?page=2`,
    ]);
    expect(result.pages.map((p) => p.key)).toEqual([
      `${ORIGIN}/about`,
      `${ORIGIN}/news?page=1`,
      `${ORIGIN}/news?page=2`,
    ]);
    expect(result.source.duplicates).toBe(3);
    expect(new Set(result.pages.map((p) => p.slug)).size).toBe(3);
  });

  it("alerts when most URLs are on another origin", async () => {
    const logger = createMemoryLogger();
    const result = await resolvePages({
      site,
      sitemap: `${ORIGIN}/other.xml`,
      logger,
      fetch: fetchFrom({
        [`${ORIGIN}/other.xml`]: urlset(
          "https://127.0.0.1:4747/a",
          "http://www.127.0.0.1.example/b",
          "https://127.0.0.1:4747/c",
          `${ORIGIN}/d`,
        ),
      }),
    });
    expect(result.pages.map((p) => p.url)).toEqual([`${ORIGIN}/d`]);
    expect(result.skipped.filter((s) => s.reason === "off-origin")).toHaveLength(3);
    const alert = logger.text("alert");
    expect(alert).toMatch(/3 of 4 URLs/);
    expect(alert).toMatch(/http:\/\/ or www\./);
    expect(alert).toMatch(/https:\/\/127\.0\.0\.1:4747 ×2/);
    expect(result.source.warnings).toContain(alert);
  });

  it("does not alert when only a few URLs are off-origin", async () => {
    const logger = createMemoryLogger();
    await resolvePages({
      site,
      sitemap: `${ORIGIN}/few.xml`,
      logger,
      fetch: fetchFrom({
        [`${ORIGIN}/few.xml`]: urlset(`${ORIGIN}/a`, `${ORIGIN}/b`, "https://www.example.com/c"),
      }),
    });
    expect(logger.text("alert")).toBe("");
  });

  it("reports sitemap locs that aren't page URLs as invalid", async () => {
    const result = await resolvePages({
      site,
      sitemap: `${ORIGIN}/bad.xml`,
      fetch: fetchFrom({
        [`${ORIGIN}/bad.xml`]: urlset("mailto:web@example.com", `${ORIGIN}/ok`),
      }),
    });
    expect(result.pages.map((p) => p.url)).toEqual([`${ORIGIN}/ok`]);
    expect(result.source.invalid).toEqual([
      {
        line: null,
        value: "mailto:web@example.com",
        reason: "not an http(s) URL or a root-relative path",
      },
    ]);
  });
});

describe("resolvePages: page list files", () => {
  it("reads fixture/pages.json relative to cwd", async () => {
    const logger = createMemoryLogger();
    const result = await resolvePages({ site, pagesFile: "fixture/pages.json", cwd: REPO, logger });
    const bytes = await readFile(path.join(REPO, "fixture/pages.json"));
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(result.pageSource).toEqual({ kind: "pages", file: "fixture/pages.json", sha256: hash });
    expect(result.pages.map((p) => [p.url, p.line, p.label ?? null])).toEqual([
      [`${ORIGIN}/`, 2, null],
      [`${ORIGIN}/duplicates/`, 4, "Duplicate lines"],
      [`${ORIGIN}/flawed/`, 10, "Flawed page"],
    ]);
    expect(result.pages[2]).toMatchObject({
      template: "content",
      notes: "Generic link text, an unlabeled button, and no skip link.",
    });
    expect(result.source).toMatchObject({
      kind: "pages",
      file: "fixture/pages.json",
      sha256: hash,
      format: "json",
      encoding: "utf-8",
      listed: 4,
    });
    expect(result.source.invalid).toEqual([
      {
        line: 16,
        value: "http://[not-a-host]/broken/",
        reason: "not an http(s) URL or a root-relative path",
      },
    ]);
    expect(logger.text("warn")).toMatch(/line 16/);
  });

  it("reads fixture/pages.csv and carries labels, templates, and notes", async () => {
    const result = await resolvePages({ site, pagesFile: "fixture/pages.csv", cwd: REPO });
    expect(result.pages.map((p) => [p.url, p.line, p.label, p.template])).toEqual([
      [`${ORIGIN}/`, 2, "Home", "home"],
      [`${ORIGIN}/duplicates/`, 3, "Duplicate lines, end-of-page test", "content"],
      [`${ORIGIN}/flawed/`, 5, "Flawed page", "content"],
    ]);
    expect(result.source.invalid).toEqual([
      { line: 7, value: ",Row with no URL (invalid on purpose),,", reason: "empty url" },
    ]);
    expect(result.source.listed).toBe(4);
  });

  it("warns about the Windows-1252 CSV and records its encoding", async () => {
    const logger = createMemoryLogger();
    const result = await resolvePages({
      site,
      pagesFile: "fixture/pages-windows-1252.csv",
      cwd: REPO,
      logger,
    });
    expect(result.source.encoding).toBe("windows-1252");
    expect(result.pages[0]!.label).toBe("“Home” – FY27");
    expect(logger.text("warn")).toMatch(/CSV UTF-8/);
    expect(result.source.warnings.join("\n")).toMatch(/CSV UTF-8/);
  });

  it("reports duplicate entries with their lines", async () => {
    const file = path.join(dir, "dupes.csv");
    await writeFile(file, "url\n/a\n/b\n/a/\n/a#x\n");
    const result = await resolvePages({ site, pagesFile: file, cwd: dir });
    expect(result.pages.map((p) => p.line)).toEqual([2, 3]);
    expect(result.source.duplicates).toBe(2);
    expect(result.source.warnings).toContain(
      "Ignored 2 duplicate entries (lines 4, 5); the first listing of each page is used.",
    );
  });

  it("skips off-origin entries with their line numbers", async () => {
    const file = path.join(dir, "mixed.json");
    await writeFile(file, '[\n"/a",\n"https://other.gov/b",\n"/files/x.pdf"\n]\n');
    const result = await resolvePages({ site, pagesFile: file, cwd: dir });
    expect(result.skipped).toEqual([
      { url: "https://other.gov/b", reason: "off-origin", line: 3 },
      { url: `${ORIGIN}/files/x.pdf`, reason: "non-html-extension", line: 4 },
    ]);
  });
});

describe("resolvePages: --page", () => {
  it("takes pages given with --page, full URLs or paths", async () => {
    const result = await resolvePages({
      site,
      pageUrls: ["/duplicates/", `${ORIGIN}/flawed/#top`],
    });
    expect(result.pages.map((p) => p.url)).toEqual([`${ORIGIN}/duplicates/`, `${ORIGIN}/flawed/`]);
    expect(result.pageSource).toEqual({
      kind: "urls",
      urls: [`${ORIGIN}/duplicates/`, `${ORIGIN}/flawed/`],
    });
    expect(result.source.kind).toBe("urls");
  });

  it("skips a --page on another site, as page lists do", async () => {
    const result = await resolvePages({
      site,
      pageUrls: ["https://dvfr.illinois.gov/faq/", "/"],
    });
    expect(result.pages).toHaveLength(1);
    expect(result.skipped).toEqual([
      { url: "https://dvfr.illinois.gov/faq/", reason: "off-origin" },
    ]);
  });

  it("rejects a --page that isn't a page", async () => {
    await expect(resolvePages({ site, pageUrls: ["ftp://x/"] })).rejects.toThrow(UsageError);
    await expect(resolvePages({ site, pageUrls: ["ftp://x/"] })).rejects.toThrow(
      `--page "ftp://x/" isn't a page URL or a path like /faq/.`,
    );
  });

  it("catches a --page Git Bash rewrote", async () => {
    await expect(resolvePages({ site, pageUrls: ["C:/Program Files/Git/faq/"] })).rejects.toThrow(
      /Git Bash rewrote it/,
    );
  });
});

describe("resolvePages: arguments", () => {
  it("requires exactly one page source", async () => {
    await expect(resolvePages({ site })).rejects.toThrow(/--page <url>/);
    await expect(
      resolvePages({ site, sitemap: `${ORIGIN}/sitemap.xml`, pagesFile: "pages.csv" }),
    ).rejects.toThrow(/one kind of page source/);
  });

  it("requires a full sitemap URL", async () => {
    await expect(resolvePages({ site, sitemap: "/sitemap.xml" })).rejects.toThrow(UsageError);
  });
});

describe("pageSourceFor", () => {
  it("identifies a sitemap by URL without fetching it", async () => {
    expect(await pageSourceFor({ sitemap: `${ORIGIN}/sitemap.xml` })).toEqual({
      kind: "sitemap",
      url: `${ORIGIN}/sitemap.xml`,
    });
  });

  it("identifies a page list by relative path and content hash", async () => {
    const source = await pageSourceFor({ pagesFile: "fixture/pages.csv", cwd: REPO });
    const bytes = await readFile(path.join(REPO, "fixture/pages.csv"));
    expect(source).toEqual({
      kind: "pages",
      file: "fixture/pages.csv",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  });

  it("uses forward slashes for nested paths and an absolute path outside cwd", async () => {
    const nested = await pageSourceFor({
      pagesFile: path.join("fixture", "pages.json"),
      cwd: REPO,
    });
    expect(nested).toMatchObject({ file: "fixture/pages.json" });
    const outside = await pageSourceFor({
      pagesFile: path.join(REPO, "fixture", "pages.json"),
      cwd: dir,
    });
    expect(outside).toMatchObject({ file: path.join(REPO, "fixture", "pages.json") });
  });

  it("reports a missing file", async () => {
    await expect(pageSourceFor({ pagesFile: "nope.csv", cwd: dir })).rejects.toThrow(UsageError);
  });

  it("keeps a --page query string and drops its fragment", async () => {
    expect(await pageSourceFor({ site, pageUrls: ["/faq/?a=1&b=2#top"] })).toEqual({
      kind: "urls",
      urls: [`${ORIGIN}/faq/?a=1&b=2`],
    });
  });

  it("takes one kind of page source", async () => {
    await expect(
      pageSourceFor({ sitemap: `${ORIGIN}/sitemap.xml`, pageUrls: ["/a"], site }),
    ).rejects.toThrow(/Use one kind of page source/);
    await expect(pageSourceFor({ site })).rejects.toThrow(/--page <url>/);
  });
});
