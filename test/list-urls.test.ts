import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listUrls } from "../src/list-urls.js";
import { readPageList } from "../src/pages/page-list.js";
import { samplePages, urlPattern } from "../src/pages/sample.js";
import { UsageError } from "../src/util/errors.js";
import { createMemoryLogger } from "../src/util/log.js";
import { gitBashForm } from "./helpers/git-bash.js";

const SITE_DIR = new URL("../fixture/site/", import.meta.url);
const ORIGIN = "http://127.0.0.1:4747";

function fetchFrom(extra: Record<string, string> = {}): typeof fetch {
  return async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (extra[url] !== undefined) return new Response(extra[url]);
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
  dir = await mkdtemp(path.join(os.tmpdir(), "voicecap-list-urls-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("listUrls", () => {
  it("exports the filtered sitemap as a CSV that Excel opens as UTF-8", async () => {
    const logger = createMemoryLogger();
    const result = await listUrls({
      site: ORIGIN,
      sitemap: `${ORIGIN}/sitemap.xml`,
      output: "pages.csv",
      cwd: dir,
      fetch: fetchFrom(),
      logger,
    });
    expect(result).toEqual({ file: path.join(dir, "pages.csv"), count: 5 });
    const bytes = await readFile(result.file);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.subarray(3).toString("utf8");
    expect(text.split("\r\n")).toEqual([
      "url,label,template,notes",
      `${ORIGIN}/,,,`,
      `${ORIGIN}/duplicates/,,,`,
      `${ORIGIN}/flawed/,,,`,
      `${ORIGIN}/contact/,,,`,
      `${ORIGIN}/feed/,,,`,
      "",
    ]);
    // Skipped URLs are reported, not exported.
    expect(logger.text("info")).toMatch(/Skipped 1 URL not on/);
    expect(logger.text("info")).toMatch(/Wrote 5 URLs to pages\.csv/);
  });

  // Git Bash translates /c/... itself, except with MSYS_NO_PATHCONV=1 set.
  it.runIf(process.platform === "win32")("writes to a file written Git Bash's way", async () => {
    const result = await listUrls({
      site: ORIGIN,
      sitemap: `${ORIGIN}/sitemap.xml`,
      output: gitBashForm(path.join(dir, "git-bash.csv")),
      cwd: dir,
      fetch: fetchFrom(),
    });
    expect(result).toEqual({ file: path.join(dir, "git-bash.csv"), count: 5 });
  });

  it("writes a file that reads back as a page list", async () => {
    const result = await listUrls({
      site: ORIGIN,
      sitemap: `${ORIGIN}/sitemap.xml`,
      output: path.join("out", "roundtrip.csv"),
      cwd: dir,
      fetch: fetchFrom(),
      exclude: ["contact", "feed"],
    });
    const list = await readPageList(result.file);
    expect(list.encoding).toBe("utf-8");
    expect(list.invalid).toEqual([]);
    expect(list.entries.map((e) => e.value)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/duplicates/`,
      `${ORIGIN}/flawed/`,
    ]);
  });

  it("exports JSON with url, label, template, and notes", async () => {
    const result = await listUrls({
      site: new URL(`${ORIGIN}/`),
      sitemap: `${ORIGIN}/sitemap.xml`,
      output: "pages.json",
      cwd: dir,
      fetch: fetchFrom(),
      limit: 2,
    });
    expect(JSON.parse(await readFile(result.file, "utf8"))).toEqual([
      { url: `${ORIGIN}/`, label: "", template: "", notes: "" },
      { url: `${ORIGIN}/duplicates/`, label: "", template: "", notes: "" },
    ]);
  });

  it("quotes CSV fields that need it", async () => {
    const result = await listUrls({
      site: ORIGIN,
      sitemap: `${ORIGIN}/q.xml`,
      output: "quoted.csv",
      cwd: dir,
      sample: 1,
      fetch: fetchFrom({ [`${ORIGIN}/q.xml`]: urlset(`${ORIGIN}/a,b/c`) }),
    });
    const text = (await readFile(result.file, "utf8")).replace(/^\uFEFF/, "");
    expect(text.split("\r\n")[1]).toBe(`"${ORIGIN}/a,b/c",,"/a,b/*",`);
  });

  it("drafts a sample: n pages per URL path pattern, with the pattern as the template", async () => {
    const news = Array.from({ length: 9 }, (_, i) => `${ORIGIN}/news/story-${i + 1}`);
    const logger = createMemoryLogger();
    const result = await listUrls({
      site: ORIGIN,
      sitemap: `${ORIGIN}/big.xml`,
      output: "sample.json",
      cwd: dir,
      sample: 3,
      logger,
      fetch: fetchFrom({
        [`${ORIGIN}/big.xml`]: urlset(
          `${ORIGIN}/`,
          ...news,
          `${ORIGIN}/about`,
          `${ORIGIN}/contact`,
          `${ORIGIN}/grants/fy27/jag`,
        ),
      }),
    });
    expect(result.groups).toEqual([
      { pattern: "/", total: 1, chosen: [`${ORIGIN}/`] },
      {
        pattern: "/news/*",
        total: 9,
        chosen: [news[0], news[4], news[8]],
      },
      { pattern: "/*", total: 2, chosen: [`${ORIGIN}/about`, `${ORIGIN}/contact`] },
      { pattern: "/grants/fy27/*", total: 1, chosen: [`${ORIGIN}/grants/fy27/jag`] },
    ]);
    const rows = JSON.parse(await readFile(result.file, "utf8")) as { template: string }[];
    expect(rows.map((r) => r.template)).toEqual([
      "/",
      "/news/*",
      "/news/*",
      "/news/*",
      "/*",
      "/*",
      "/grants/fy27/*",
    ]);
    const info = logger.text("info");
    expect(info).toMatch(/Drafted a sample of 7 of 13 pages: up to 3 per URL path pattern/);
    expect(info).toMatch(
      /\/news\/\*\s+9 pages, chose 3: \/news\/story-1, \/news\/story-5, \/news\/story-9/,
    );
  });

  it("rejects other output extensions and bad sample sizes", async () => {
    const base = { site: ORIGIN, sitemap: `${ORIGIN}/sitemap.xml`, cwd: dir, fetch: fetchFrom() };
    await expect(listUrls({ ...base, output: "pages.txt" })).rejects.toThrow(UsageError);
    await expect(listUrls({ ...base, output: "pages.csv", sample: 0 })).rejects.toThrow(/--sample/);
  });
});

describe("urlPattern", () => {
  it("uses the parent path plus /*", () => {
    expect(urlPattern("https://a.gov/")).toBe("/");
    expect(urlPattern("https://a.gov/?lang=es")).toBe("/");
    expect(urlPattern("https://a.gov/about")).toBe("/*");
    expect(urlPattern("https://a.gov/about/")).toBe("/*");
    expect(urlPattern("https://a.gov/news/story")).toBe("/news/*");
    expect(urlPattern(new URL("https://a.gov/researchhub/articles/x?y=1"))).toBe(
      "/researchhub/articles/*",
    );
  });
});

describe("samplePages", () => {
  const pages = Array.from({ length: 10 }, (_, i) => ({ url: `https://a.gov/p/${i}` }));

  it("keeps every page when the group is small", () => {
    expect(samplePages(pages.slice(0, 2), 5)[0]!.chosen).toHaveLength(2);
  });

  it("spreads choices evenly, including the first and last", () => {
    const chosen = samplePages(pages, 4)[0]!.chosen.map((p) => p.url.split("/").pop());
    expect(chosen).toEqual(["0", "3", "6", "9"]);
  });

  it("picks the first page when n is 1", () => {
    expect(samplePages(pages, 1)[0]!.chosen).toEqual([pages[0]]);
  });

  it("is deterministic", () => {
    expect(samplePages(pages, 3)).toEqual(samplePages(pages, 3));
  });

  it("rejects n < 1", () => {
    expect(() => samplePages(pages, 0)).toThrow(RangeError);
  });
});
