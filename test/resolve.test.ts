import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PASS_NAMES, type PageSource, type RunJson } from "../src/model.js";
import {
  describeSource,
  pageSourceFor,
  readWalkthroughFile,
  resolvePages,
  type WalkthroughFile,
} from "../src/pages/resolve.js";
import { pageSlug } from "../src/pages/slug.js";
import { canonicalKey, parseSiteUrl } from "../src/pages/url.js";
import { runAudit } from "../src/run/audit.js";
import { pageDir, runDir, runJsonPath } from "../src/run/paths.js";
import type { Walkthrough, WalkthroughPage } from "../src/share/walkthrough.js";
import { UsageError } from "../src/util/errors.js";
import { createMemoryLogger } from "../src/util/log.js";
import { gitBashForm } from "./helpers/git-bash.js";
import { options, outDir, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

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

const sha256Of = (text: string) => createHash("sha256").update(text).digest("hex");

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
  // Git Bash translates /c/... itself, except with MSYS_NO_PATHCONV=1 set.
  it.runIf(process.platform === "win32")("reads a page list written Git Bash's way", async () => {
    const pagesFile = gitBashForm(path.join(REPO, "fixture", "pages.json"));
    const result = await resolvePages({ site, pagesFile, cwd: REPO });
    expect(result.pageSource).toMatchObject({ kind: "pages", file: "fixture/pages.json" });
    expect(result.pages.map((p) => p.url)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/duplicates/`,
      `${ORIGIN}/flawed/`,
    ]);
    expect(await pageSourceFor({ pagesFile, cwd: REPO })).toMatchObject({
      kind: "pages",
      file: "fixture/pages.json",
    });
  });

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

  it("rejects a sitemap that isn't an http(s) URL, a name, or a path", async () => {
    for (const sitemap of ["ftp://127.0.0.1/sitemap.xml", "  ", "not a sitemap"]) {
      await expect(resolvePages({ site, sitemap, fetch: fetchFrom() })).rejects.toThrow(
        `--sitemap must be a full URL such as https://dvfr.illinois.gov/sitemap.xml, or a name or path on --site such as sitemap.xml (got "${sitemap}").`,
      );
    }
  });
});

describe("resolvePages: a sitemap given by name or path", () => {
  it("reads a name, a path, or a nested path against the site", async () => {
    const byName = await resolvePages({ site, sitemap: "sitemap.xml", fetch: fetchFrom() });
    expect(byName.pageSource).toEqual({ kind: "sitemap", url: `${ORIGIN}/sitemap.xml` });
    expect(byName.pages.map((p) => p.url)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/duplicates/`,
      `${ORIGIN}/flawed/`,
      `${ORIGIN}/contact/`,
      `${ORIGIN}/feed/`,
    ]);
    expect(byName.source.sitemaps?.[0]?.url).toBe(`${ORIGIN}/sitemap.xml`);

    const byPath = await resolvePages({ site, sitemap: "/sitemap.xml", fetch: fetchFrom() });
    expect(byPath.pageSource).toEqual(byName.pageSource);

    for (const sitemap of ["/sitemaps/pages.xml", "sitemaps/pages.xml"]) {
      const nested = await resolvePages({ site, sitemap, fetch: fetchFrom() });
      expect(nested.pageSource).toEqual({ kind: "sitemap", url: `${ORIGIN}/sitemaps/pages.xml` });
      expect(nested.source.sitemaps).toHaveLength(1);
    }
  });

  it("reads a name or path from the site's root, whatever path the site has", async () => {
    const blog = new URL("https://example.com/blog/");
    for (const sitemap of ["sitemap.xml", "/sitemap.xml"]) {
      expect(await pageSourceFor({ sitemap, site: blog })).toEqual({
        kind: "sitemap",
        url: "https://example.com/sitemap.xml",
      });
    }
    // A subsite's sitemap is given as its path.
    for (const sitemap of ["/blog/sitemap.xml", "blog/sitemap.xml"]) {
      expect(await pageSourceFor({ sitemap, site: blog })).toEqual({
        kind: "sitemap",
        url: "https://example.com/blog/sitemap.xml",
      });
    }
  });

  it("takes a full URL as it is, on any host", async () => {
    expect(await pageSourceFor({ sitemap: "https://dvfr.illinois.gov/sitemap.xml", site })).toEqual(
      { kind: "sitemap", url: "https://dvfr.illinois.gov/sitemap.xml" },
    );
  });

  it("refuses an address without https://, before fetching anything", async () => {
    let fetched = 0;
    const counting: typeof fetch = () => {
      fetched += 1;
      return Promise.resolve(new Response("not found", { status: 404 }));
    };
    for (const sitemap of ["dvfr.illinois.gov/sitemap.xml", "localhost:3000/sitemap.xml"]) {
      const message = `--sitemap "${sitemap}" looks like an address without https://: give its full URL (https://${sitemap}), or just its name on --site, such as sitemap.xml.`;
      await expect(resolvePages({ site, sitemap, fetch: counting })).rejects.toThrow(message);
      await expect(pageSourceFor({ site, sitemap })).rejects.toThrow(message);
      // With no site too: it's an address, not a name on a site.
      await expect(pageSourceFor({ sitemap })).rejects.toThrow(message);
    }
    expect(fetched).toBe(0);
  });

  it("needs a site to read a name or path against", async () => {
    await expect(pageSourceFor({ sitemap: "sitemap.xml" })).rejects.toThrow(UsageError);
    await expect(pageSourceFor({ sitemap: "/sitemap.xml" })).rejects.toThrow(
      `--sitemap "/sitemap.xml" is read relative to --site, and there's no --site: give --site, or the sitemap's full URL, such as https://dvfr.illinois.gov/sitemap.xml.`,
    );
  });

  it("explains a --sitemap Git Bash rewrote, and suggests the name without the slash", async () => {
    const rewritten = "C:/Program Files/Git/sitemap.xml";
    for (const attempt of [
      () => resolvePages({ site, sitemap: rewritten, fetch: fetchFrom() }),
      () => pageSourceFor({ site, sitemap: rewritten }),
    ]) {
      await expect(attempt()).rejects.toThrow(
        [
          `--sitemap "${rewritten}" looks like a Windows path, not a URL.`,
          `Git Bash rewrote it: arguments that begin with "/" are turned into Windows paths (for example /sitemap.xml becomes C:/Program Files/Git/sitemap.xml).`,
          "To fix it, leave off the leading slash (--sitemap sitemap.xml), use a full URL",
          "(https://dvfr.illinois.gov/sitemap.xml), or turn the rewriting off with MSYS_NO_PATHCONV=1, e.g.",
          "  MSYS_NO_PATHCONV=1 npx @icjia/voicecap --sitemap /sitemap.xml ...",
        ].join("\n"),
      );
    }
  });
});

describe("pageSourceFor", () => {
  it("identifies a sitemap by URL without fetching it", async () => {
    expect(await pageSourceFor({ sitemap: `${ORIGIN}/sitemap.xml` })).toEqual({
      kind: "sitemap",
      url: `${ORIGIN}/sitemap.xml`,
    });
  });

  // A run resumes when its page source matches, so a sitemap's name and its full URL must match.
  it("identifies a sitemap given by name or path by its full URL", async () => {
    const full = await pageSourceFor({ sitemap: `${ORIGIN}/sitemap.xml`, site });
    expect(await pageSourceFor({ sitemap: "sitemap.xml", site })).toEqual(full);
    expect(await pageSourceFor({ sitemap: "/sitemap.xml", site })).toEqual(full);
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

  it("uses forward slashes for nested paths, and the file's name alone outside cwd", async () => {
    const nested = await pageSourceFor({
      pagesFile: path.join("fixture", "pages.json"),
      cwd: REPO,
    });
    expect(nested).toMatchObject({ file: "fixture/pages.json" });
    // A path outside the folder can carry the account's name, so only the file's name is kept.
    const outside = await pageSourceFor({
      pagesFile: path.join(REPO, "fixture", "pages.json"),
      cwd: dir,
    });
    expect(outside).toMatchObject({ kind: "pages", file: "pages.json" });
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

// A path from outside the folder voicecap runs in can carry the account's name (a file dragged in
// from Downloads, a redirected Documents folder on a file server), so a run keeps such a file by
// its name alone. A file inside the folder keeps its path from it, which names no account.
describe("a page list outside the working folder", () => {
  const CSV = "url\n/\n/about\n";
  let work: string;
  let elsewhere: string;
  beforeAll(async () => {
    work = path.join(dir, "work");
    elsewhere = path.join(dir, `elsewhere-${randomUUID()}`);
    await mkdir(path.join(work, "page-lists"), { recursive: true });
    await mkdir(elsewhere, { recursive: true });
    await writeFile(path.join(work, "page-lists", "pages.csv"), CSV);
    await writeFile(path.join(elsewhere, "pages.csv"), CSV);
  });

  it("is recorded by its name alone: in the page source and in the source's details", async () => {
    const pagesFile = path.join(elsewhere, "pages.csv");
    const result = await resolvePages({ site, pagesFile, cwd: work });

    const list = { kind: "pages", file: "pages.csv", sha256: sha256Of(CSV) };
    expect(result.pageSource).toEqual(list);
    expect(result.source).toMatchObject({ ...list, listed: 2 });
    expect(await pageSourceFor({ pagesFile, cwd: work })).toEqual(list);
    expect(describeSource(result.pageSource)).toBe("the page list pages.csv");
  });

  it("keeps its path from the working folder when it's inside, however it's given", async () => {
    const inside = { kind: "pages", file: "page-lists/pages.csv", sha256: sha256Of(CSV) };

    for (const pagesFile of [
      path.join("page-lists", "pages.csv"),
      path.join(work, "page-lists", "pages.csv"),
    ]) {
      const result = await resolvePages({ site, pagesFile, cwd: work });
      expect(result.pageSource, pagesFile).toEqual(inside);
      expect(result.source, pagesFile).toMatchObject(inside);
      expect(await pageSourceFor({ pagesFile, cwd: work }), pagesFile).toEqual(inside);
    }
  });

  it("is recorded by its name alone when it is in a folder beside the working folder, too", async () => {
    // "../elsewhere-…/pages.csv" begins with two dots, and is not inside.
    const pagesFile = path.relative(work, path.join(elsewhere, "pages.csv"));
    expect(pagesFile.startsWith("..")).toBe(true);
    expect(await pageSourceFor({ pagesFile, cwd: work })).toMatchObject({ file: "pages.csv" });
  });
});

describe("a run from a page list outside the working folder", () => {
  /** Every file under a folder, with its text. */
  function filesUnder(folder: string): { file: string; text: string }[] {
    return readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return { file, text: readFileSync(file, "utf8") };
      });
  }

  it("records the file by its name alone: in run.json, and in every transcript", async () => {
    const cwd = path.join(dir, `run-${randomUUID()}`);
    const folder = `elsewhere-${randomUUID()}`;
    await mkdir(path.join(dir, folder), { recursive: true });
    const pages = path.join(dir, folder, "pages.csv");
    const list = "url\n/\n/about\n";
    await writeFile(pages, list);

    const result = await runAudit(options(cwd, new ScriptedDriver(sitePages()), { pages }));
    expect(result.outcome).toBe("completed");

    const siteDir = outDir(cwd);
    const run = JSON.parse(readFileSync(runJsonPath(siteDir, result.runId), "utf8")) as RunJson;
    const listed = { kind: "pages", file: "pages.csv", sha256: sha256Of(list) };
    // The settings the run resumes by, the details of the source, and each session's environment.
    expect(run.settings.source).toEqual(listed);
    expect(run.source).toMatchObject({ kind: "pages", file: "pages.csv" });
    expect(run.sessions.map((session) => session.environment?.pageSource)).toEqual([listed]);
    // Every transcript says the same in its header, in the JSON and in the TXT.
    const headers = run.pages.flatMap((page) =>
      PASS_NAMES.map((pass) => path.join(pageDir(siteDir, run.id, page.slug), `${pass}.txt`)),
    );
    expect(headers).toHaveLength(6);
    for (const file of headers) {
      expect(readFileSync(file, "utf8"), file).toMatch(
        /^# Page source: page list pages\.csv \(sha256 [\da-f]{64}\)$/m,
      );
    }
    // No file of the run holds the folder the list was in, in any spelling.
    const files = filesUnder(runDir(siteDir, run.id));
    expect(files.length).toBeGreaterThan(10);
    expect(files.filter(({ text }) => text.includes(folder)).map(({ file }) => file)).toEqual([]);
  });

  it("records the file with its path from the working folder when it's inside it", async () => {
    const cwd = path.join(dir, `run-${randomUUID()}`);
    await mkdir(path.join(cwd, "page-lists"), { recursive: true });
    await writeFile(path.join(cwd, "page-lists", "pages.csv"), "url\n/\n");

    const result = await runAudit(
      options(cwd, new ScriptedDriver(sitePages()), {
        pages: path.join("page-lists", "pages.csv"),
      }),
    );

    const run = JSON.parse(readFileSync(runJsonPath(outDir(cwd), result.runId), "utf8")) as RunJson;
    expect(run.settings.source).toMatchObject({ kind: "pages", file: "page-lists/pages.csv" });
    const read = path.join(pageDir(outDir(cwd), run.id, run.pages[0]!.slug), "read.txt");
    expect(readFileSync(read, "utf8")).toMatch(
      /^# Page source: page list page-lists\/pages\.csv \(sha256 [\da-f]{64}\)$/m,
    );
  });
});

describe("a walkthrough file as the page source", () => {
  const SHA = "a".repeat(64);
  const PAGES_SOURCE: PageSource = { kind: "pages", file: "pages.csv", sha256: "b".repeat(64) };

  /**
   * A walkthrough file of the fixture site, as a run reads it, listing `pages` (by their addresses
   * or whole), made from a run whose pages came from `from`.
   */
  function walkthroughFile(
    pages: (string | WalkthroughPage)[],
    from: PageSource = PAGES_SOURCE,
  ): WalkthroughFile {
    const parsed: Walkthrough = {
      voicecapWalkthrough: 1,
      site: ORIGIN,
      pages: pages.map((page) =>
        typeof page === "string" ? { url: page, original: { status: "done", passes: {} } } : page,
      ),
      settings: {
        passes: ["read", "headings", "tab"],
        stepCaps: { read: 400, headings: 200, tab: 300 },
        capture: "complete",
        readiness: null,
      },
      original: {
        run: "2026-09-29_1402",
        seal: null,
        createdAt: "2026-09-29T14:02:00-05:00",
        completedAt: "2026-09-29T14:20:00-05:00",
        replayed: false,
        source: from,
        sourceFingerprints: [],
        voicecap: null,
        screenReader: null,
        browser: null,
        nvdaSettings: {},
        browserChannel: "chrome",
      },
    };
    return { file: "w.json", sha256: SHA, parsed };
  }

  it.each<[name: string, from: PageSource, came: "sitemap" | "pages" | "urls"]>([
    ["a sitemap", { kind: "sitemap", url: `${ORIGIN}/sitemap.xml` }, "sitemap"],
    ["a page list", PAGES_SOURCE, "pages"],
    ["--page", { kind: "urls", urls: [`${ORIGIN}/faq/`] }, "urls"],
    [
      "a walkthrough, which says what its own pages came from",
      { kind: "walkthrough", file: "w0.json", sha256: "c".repeat(64), run: "r0", from: "urls" },
      "urls",
    ],
  ])(
    "names its file, SHA-256, and run, and what the pages of that run came from: %s",
    async (_name, from, came) => {
      const walkthrough = walkthroughFile([`${ORIGIN}/`], from);
      const expected: PageSource = {
        kind: "walkthrough",
        file: "w.json",
        sha256: SHA,
        run: "2026-09-29_1402",
        from: came,
      };

      expect(await pageSourceFor({ walkthrough })).toEqual(expected);
      expect((await resolvePages({ site, walkthrough })).pageSource).toEqual(expected);
    },
  );

  it("takes the file's pages, in its order, with their labels, templates, and notes", async () => {
    const walkthrough = walkthroughFile([
      {
        url: `${ORIGIN}/flawed/`,
        label: "Flawed page",
        template: "content",
        notes: "No skip link.",
        original: { status: "done", passes: {} },
      },
      `${ORIGIN}/`,
      {
        url: `${ORIGIN}/duplicates/`,
        label: "Duplicates",
        original: { status: "failed", passes: {} },
      },
    ]);

    const result = await resolvePages({ site, walkthrough });

    expect(result.pages.map((page) => page.url)).toEqual([
      `${ORIGIN}/flawed/`,
      `${ORIGIN}/`,
      `${ORIGIN}/duplicates/`,
    ]);
    expect(result.pages.map((page) => [page.label, page.template, page.notes])).toEqual([
      ["Flawed page", "content", "No skip link."],
      [undefined, undefined, undefined],
      ["Duplicates", undefined, undefined],
    ]);
    expect(result.pages.map((page) => page.line)).toEqual([undefined, undefined, undefined]);
    expect(result.pages[0]?.key).toBe(`${ORIGIN}/flawed`);
    expect(result.pages[0]?.slug).toMatch(/^flawed-[0-9a-f]{10}$/);
    expect(result.skipped).toEqual([]);
  });

  it("describes the pages as the file's: its name, SHA-256, and how many pages it lists", async () => {
    const result = await resolvePages({
      site,
      walkthrough: walkthroughFile([`${ORIGIN}/`, `${ORIGIN}/flawed/`]),
    });

    expect(result.source).toEqual({
      kind: "walkthrough",
      file: "w.json",
      sha256: SHA,
      listed: 2,
      duplicates: 0,
      invalid: [],
      excludedByFilter: 0,
      excludedByLimit: 0,
      warnings: [],
    });
  });

  it("reads a page listed twice once, keeping the form listed first, and counts the repeats", async () => {
    const logger = createMemoryLogger();
    const walkthrough = walkthroughFile([
      `${ORIGIN}/duplicates`,
      `${ORIGIN}/`,
      `${ORIGIN}/duplicates/`,
      `${ORIGIN}/#top`,
    ]);

    const result = await resolvePages({ site, walkthrough, logger });

    expect(result.pages.map((page) => page.url)).toEqual([`${ORIGIN}/duplicates`, `${ORIGIN}/`]);
    expect(result.source).toMatchObject({ listed: 4, duplicates: 2 });
    expect(result.source.warnings).toEqual([
      "Ignored 2 duplicate entries; the first listing of each page is used.",
    ]);
    expect(logger.text("warn")).toContain(
      "Ignored 2 duplicate entries; the first listing of each page is used.",
    );
    expect(logger.text()).toContain("2 pages to transcribe, 2 duplicates ignored.");
  });

  it("skips a page whose address is a file that isn't a page, as a page list does", async () => {
    const result = await resolvePages({
      site,
      walkthrough: walkthroughFile([`${ORIGIN}/`, `${ORIGIN}/files/annual-report.pdf`]),
    });

    expect(result.pages.map((page) => page.url)).toEqual([`${ORIGIN}/`]);
    expect(result.skipped).toEqual([
      { url: `${ORIGIN}/files/annual-report.pdf`, reason: "non-html-extension" },
    ]);
  });

  it("is a page source of its own, not to be mixed with another", async () => {
    const walkthrough = walkthroughFile([`${ORIGIN}/`]);

    await expect(
      resolvePages({ site, walkthrough, sitemap: `${ORIGIN}/sitemap.xml` }),
    ).rejects.toThrow(/^Use one kind of page source: --walkthrough, --sitemap, --pages, or --page/);
    await expect(pageSourceFor({ walkthrough, pageUrls: ["/a"], site })).rejects.toThrow(
      /^Use one kind of page source: --walkthrough, --sitemap, --pages, or --page/,
    );
  });

  // A page's folder is named for its path and ten hex digits (40 bits) of a fingerprint of its whole
  // address, so a search of a few seconds finds two addresses that differ in their query and share
  // one name. A walkthrough file is made to travel, so one can be made to hold such a pair. The
  // pair can't be read in one run, and that is a refusal like any other, not a crash.
  describe("holding two addresses that would be saved under one name", () => {
    const COLLIDING_SITE = "https://example.com";
    const FIRST = `${COLLIDING_SITE}/page?x=1778912`;
    const SECOND = `${COLLIDING_SITE}/page?x=2659347`;
    const NAME = "page-c18143e304";
    const REFUSAL = (first: string, second: string): string =>
      `${first} and ${second} would be saved under the same name ("${NAME}"), so voicecap can't read both in one run.`;

    /** A walkthrough file of `COLLIDING_SITE` listing `pages`. */
    function collidingFile(pages: string[]): WalkthroughFile {
      const file = walkthroughFile(pages);
      return { ...file, parsed: { ...file.parsed, site: COLLIDING_SITE } };
    }

    /** What reading the pages with `resolve` is refused with, once it's checked it's a UsageError. */
    async function refusedWith(resolve: () => Promise<unknown>): Promise<string> {
      const error = await resolve().then(
        () => {
          throw new Error("It wasn't refused.");
        },
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(UsageError);
      return (error as UsageError).message;
    }

    it("really are two addresses with one name, which the tests below rely on", () => {
      expect(FIRST).not.toBe(SECOND);
      expect(pageSlug(canonicalKey(FIRST))).toBe(NAME);
      expect(pageSlug(canonicalKey(SECOND))).toBe(NAME);
    });

    it("is refused, naming both addresses and the name, when the pages are in a walkthrough file", async () => {
      const message = await refusedWith(() =>
        resolvePages({
          site: parseSiteUrl(COLLIDING_SITE),
          walkthrough: collidingFile([FIRST, SECOND]),
        }),
      );

      expect(message).toBe(REFUSAL(FIRST, SECOND));
    });

    it("is refused the same way when the pages are given with --page", async () => {
      const message = await refusedWith(() =>
        resolvePages({ site: parseSiteUrl(COLLIDING_SITE), pageUrls: [FIRST, SECOND] }),
      );

      expect(message).toBe(REFUSAL(FIRST, SECOND));
    });

    it("names the address listed first first, whatever the order", async () => {
      const message = await refusedWith(() =>
        resolvePages({
          site: parseSiteUrl(COLLIDING_SITE),
          walkthrough: collidingFile([`${COLLIDING_SITE}/about`, SECOND, FIRST]),
        }),
      );

      expect(message).toBe(REFUSAL(SECOND, FIRST));
    });

    it("isn't a refusal for one address listed twice, which is one page", async () => {
      const result = await resolvePages({
        site: parseSiteUrl(COLLIDING_SITE),
        walkthrough: collidingFile([FIRST, `${FIRST}#top`]),
      });

      expect(result.pages.map((page) => page.slug)).toEqual([NAME]);
    });
  });
});

describe("readWalkthroughFile", () => {
  /** A walkthrough of the fixture site, as the text of a file. */
  const text = JSON.stringify({
    voicecapWalkthrough: 1,
    site: ORIGIN,
    pages: [{ url: `${ORIGIN}/`, original: { status: "done", passes: {} } }],
    settings: {
      passes: ["read"],
      stepCaps: { read: 400, headings: 200, tab: 300 },
      capture: "complete",
      readiness: null,
    },
    original: {
      run: "2026-09-29_1402",
      seal: null,
      createdAt: "2026-09-29T14:02:00-05:00",
      completedAt: "2026-09-29T14:20:00-05:00",
      replayed: false,
      source: { kind: "urls", urls: [`${ORIGIN}/`] },
      sourceFingerprints: [],
      voicecap: null,
      screenReader: null,
      browser: null,
      nvdaSettings: {},
      browserChannel: "chrome",
    },
  });

  it("reads the file once, as bytes, and keeps their SHA-256 as read", async () => {
    // A byte order mark is part of the file as read, and the hash covers it.
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
    await writeFile(path.join(dir, "bom.json"), bytes);

    const read = await readWalkthroughFile("bom.json", dir);

    expect(read.file).toBe("bom.json");
    expect(read.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(read.parsed.pages.map((page) => page.url)).toEqual([`${ORIGIN}/`]);
  });

  it("names the file as it was given when it can't be read as a walkthrough", async () => {
    await writeFile(path.join(dir, "not-a-walkthrough.json"), "{}");

    await expect(readWalkthroughFile("not-a-walkthrough.json", dir)).rejects.toThrow(
      /^not-a-walkthrough\.json isn't a voicecap walkthrough file: /,
    );
  });

  // As a page list is: by its name alone outside the folder voicecap runs in, which can carry the
  // account's name, and by its path from the folder inside it.
  it("records the file by its name alone outside the working folder, and its path inside it", async () => {
    const work = path.join(dir, `walk-${randomUUID()}`);
    const elsewhere = path.join(dir, `walk-elsewhere-${randomUUID()}`);
    await mkdir(path.join(work, "walkthroughs"), { recursive: true });
    await mkdir(elsewhere, { recursive: true });
    await writeFile(path.join(work, "walkthroughs", "w.json"), text);
    await writeFile(path.join(elsewhere, "w.json"), text);

    const outside = await readWalkthroughFile(path.join(elsewhere, "w.json"), work);
    expect(outside.file).toBe("w.json");
    const inside = await readWalkthroughFile(path.join("walkthroughs", "w.json"), work);
    expect(inside.file).toBe("walkthroughs/w.json");
    expect((await readWalkthroughFile(path.join(work, "walkthroughs", "w.json"), work)).file).toBe(
      "walkthroughs/w.json",
    );

    // A repeat keeps it so in its page source, and in the details of the source.
    const pages = await resolvePages({ site, walkthrough: outside, cwd: work });
    expect(pages.pageSource).toMatchObject({ kind: "walkthrough", file: "w.json" });
    expect(pages.source).toMatchObject({ kind: "walkthrough", file: "w.json" });
    expect(describeSource(pages.pageSource)).toBe(
      "the walkthrough w.json from run 2026-09-29_1402",
    );
  });
});

describe("describeSource", () => {
  // The words the warning about URLs on other sites uses for where the pages came from.
  it.each<[name: string, source: PageSource, words: string]>([
    [
      "a sitemap",
      { kind: "sitemap", url: `${ORIGIN}/sitemap.xml` },
      `the sitemap ${ORIGIN}/sitemap.xml`,
    ],
    [
      "a page list",
      { kind: "pages", file: "pages.csv", sha256: "a".repeat(64) },
      "the page list pages.csv",
    ],
    ["--page", { kind: "urls", urls: [`${ORIGIN}/faq/`] }, "the pages given with --page"],
  ])("names %s", (_name, source, words) => {
    expect(describeSource(source)).toBe(words);
  });

  it("names a walkthrough by its file, then its run", () => {
    const source: PageSource = {
      kind: "walkthrough",
      file: "w.json",
      sha256: "a".repeat(64),
      run: "2026-09-29_1402",
      from: "sitemap",
    };

    expect(describeSource(source)).toBe("the walkthrough w.json from run 2026-09-29_1402");
  });
});
