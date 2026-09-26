import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fetchSitemap, parseSitemapXml } from "../src/pages/sitemap.js";
import { EnvironmentError, UsageError } from "../src/util/errors.js";
import { createMemoryLogger } from "../src/util/log.js";

const SITE_DIR = new URL("../fixture/site/", import.meta.url);
const ORIGIN = "http://127.0.0.1:4747";

/** A fetch that serves fixture/site as if it were http://127.0.0.1:4747, plus overrides. */
function fixtureFetch(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    const override = overrides[url];
    if (override) return override();
    if (!url.startsWith(`${ORIGIN}/`)) throw new TypeError("fetch failed");
    try {
      const body = await readFile(new URL(url.slice(ORIGIN.length + 1), SITE_DIR));
      return new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
    } catch {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
  }) as typeof fetch;
  return { fetchImpl, requested };
}

const xml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, { status: 200 });
const urlset = (...locs: string[]) =>
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
const index = (...locs: string[]) =>
  `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join("")}</sitemapindex>`;

describe("fetchSitemap: the fixture sitemap index", () => {
  it("recurses into child sitemaps and returns page URLs in order", async () => {
    const { fetchImpl, requested } = fixtureFetch();
    const result = await fetchSitemap(`${ORIGIN}/sitemap.xml`, { fetch: fetchImpl });
    expect(requested).toEqual([
      `${ORIGIN}/sitemap.xml`,
      `${ORIGIN}/sitemaps/pages.xml`,
      `${ORIGIN}/sitemaps/files.xml`,
    ]);
    expect(result.urls.map((u) => u.loc)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/duplicates/`,
      `${ORIGIN}/flawed/`,
      `${ORIGIN}/contact/`,
      `${ORIGIN}/feed/`,
      "https://www.example.com/partner/",
      `${ORIGIN}/files/annual-report.pdf`,
    ]);
    expect(result.urls[0]!.sitemap).toBe(`${ORIGIN}/sitemaps/pages.xml`);
    expect(result.warnings).toEqual([]);
  });

  it("records each document with its URL count and SHA-256", async () => {
    const { fetchImpl } = fixtureFetch();
    const result = await fetchSitemap(`${ORIGIN}/sitemap.xml`, { fetch: fetchImpl });
    const bytes = await readFile(new URL("sitemaps/pages.xml", SITE_DIR));
    expect(result.documents).toEqual([
      {
        url: `${ORIGIN}/sitemap.xml`,
        urls: 2,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      },
      {
        url: `${ORIGIN}/sitemaps/pages.xml`,
        urls: 6,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      { url: `${ORIGIN}/sitemaps/files.xml`, urls: 1, sha256: expect.any(String) as unknown },
    ]);
  });
});

describe("fetchSitemap: formats", () => {
  it("reads a plain <urlset>", async () => {
    const { fetchImpl } = fixtureFetch();
    const result = await fetchSitemap(`${ORIGIN}/sitemaps/files.xml`, { fetch: fetchImpl });
    expect(result.urls.map((u) => u.loc)).toEqual([`${ORIGIN}/files/annual-report.pdf`]);
  });

  it("decompresses gzipped sitemaps", async () => {
    const body = gzipSync(Buffer.from(urlset("https://a.gov/x", "https://a.gov/y")));
    const { fetchImpl } = fixtureFetch({
      "https://a.gov/sitemap.xml.gz": () => new Response(body, { status: 200 }),
    });
    const result = await fetchSitemap("https://a.gov/sitemap.xml.gz", { fetch: fetchImpl });
    expect(result.urls.map((u) => u.loc)).toEqual(["https://a.gov/x", "https://a.gov/y"]);
    expect(result.documents[0]!.sha256).toBe(createHash("sha256").update(body).digest("hex"));
  });

  it("tolerates namespace prefixes, whitespace, and entities", () => {
    const doc =
      '<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      "<sm:url><sm:loc>\n   https://a.gov/search?q=a&amp;page=2  \n</sm:loc></sm:url>" +
      "<sm:url><sm:loc></sm:loc></sm:url>" +
      "</sm:urlset>";
    expect(parseSitemapXml(doc)).toEqual({
      kind: "urlset",
      locs: ["https://a.gov/search?q=a&page=2"],
    });
  });

  it("resolves relative child sitemap URLs against the index", async () => {
    const { fetchImpl, requested } = fixtureFetch({
      "https://a.gov/sitemap.xml": () => xml(index("/child.xml")),
      "https://a.gov/child.xml": () => xml(urlset("https://a.gov/page")),
    });
    const result = await fetchSitemap("https://a.gov/sitemap.xml", { fetch: fetchImpl });
    expect(requested).toContain("https://a.gov/child.xml");
    expect(result.urls.map((u) => u.loc)).toEqual(["https://a.gov/page"]);
  });
});

describe("fetchSitemap: failures", () => {
  it("records a failing child sitemap as a warning and continues", async () => {
    const logger = createMemoryLogger();
    const { fetchImpl } = fixtureFetch({
      "https://a.gov/sitemap.xml": () =>
        xml(index("https://a.gov/missing.xml", "https://a.gov/broken.xml", "https://a.gov/ok.xml")),
      "https://a.gov/missing.xml": () =>
        new Response("gone", { status: 404, statusText: "Not Found" }),
      "https://a.gov/broken.xml": () => xml("<urlset><url><loc>x</loc></urlset>"),
      "https://a.gov/ok.xml": () => xml(urlset("https://a.gov/ok")),
    });
    const result = await fetchSitemap("https://a.gov/sitemap.xml", { fetch: fetchImpl, logger });
    expect(result.urls.map((u) => u.loc)).toEqual(["https://a.gov/ok"]);
    expect(result.documents.map((d) => [d.url, d.error !== undefined])).toEqual([
      ["https://a.gov/sitemap.xml", false],
      ["https://a.gov/missing.xml", true],
      ["https://a.gov/broken.xml", true],
      ["https://a.gov/ok.xml", false],
    ]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatch(/missing\.xml.*HTTP 404/);
    expect(result.warnings[1]).toMatch(/broken\.xml.*not valid XML/);
    expect(logger.text("warn")).toMatch(/missing\.xml/);
  });

  it("throws a usage error when the sitemap given returns HTTP 4xx", async () => {
    const { fetchImpl } = fixtureFetch();
    const error = await fetchSitemap(`${ORIGIN}/nope.xml`, { fetch: fetchImpl }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).toMatch(/HTTP 404/);
  });

  it("throws an environment error for network failures and HTTP 5xx", async () => {
    const { fetchImpl } = fixtureFetch({
      "https://down.gov/sitemap.xml": () => new Response("busy", { status: 503 }),
    });
    await expect(
      fetchSitemap("https://unreachable.gov/sitemap.xml", { fetch: fetchImpl }),
    ).rejects.toBeInstanceOf(EnvironmentError);
    await expect(
      fetchSitemap("https://down.gov/sitemap.xml", { fetch: fetchImpl }),
    ).rejects.toThrow(/HTTP 503/);
    await expect(
      fetchSitemap("https://down.gov/sitemap.xml", { fetch: fetchImpl }),
    ).rejects.toBeInstanceOf(EnvironmentError);
  });

  it("throws a usage error when the document given isn't a sitemap", async () => {
    const { fetchImpl } = fixtureFetch({
      "https://a.gov/sitemap.xml": () => new Response("<html><body>Hi</body></html>"),
    });
    await expect(fetchSitemap("https://a.gov/sitemap.xml", { fetch: fetchImpl })).rejects.toThrow(
      /not a sitemap/,
    );
    await expect(
      fetchSitemap("https://a.gov/sitemap.xml", { fetch: fetchImpl }),
    ).rejects.toBeInstanceOf(UsageError);
  });

  it("reads a sitemap listed twice only once (loop guard)", async () => {
    const { fetchImpl, requested } = fixtureFetch({
      "https://a.gov/sitemap.xml": () =>
        xml(
          index(
            "https://a.gov/sitemap.xml",
            "https://a.gov/child.xml",
            "https://a.gov/child.xml#x",
          ),
        ),
      "https://a.gov/child.xml": () => xml(urlset("https://a.gov/page")),
    });
    const result = await fetchSitemap("https://a.gov/sitemap.xml", { fetch: fetchImpl });
    expect(requested).toEqual(["https://a.gov/sitemap.xml", "https://a.gov/child.xml"]);
    expect(result.urls.map((u) => u.loc)).toEqual(["https://a.gov/page"]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatch(/more than once/);
  });

  it("stops at the nesting limit", async () => {
    const { fetchImpl, requested } = fixtureFetch({
      "https://a.gov/0.xml": () => xml(index("https://a.gov/1.xml")),
      "https://a.gov/1.xml": () => xml(index("https://a.gov/2.xml")),
      "https://a.gov/2.xml": () => xml(urlset("https://a.gov/deep")),
    });
    const result = await fetchSitemap("https://a.gov/0.xml", { fetch: fetchImpl, maxDepth: 1 });
    expect(requested).toEqual(["https://a.gov/0.xml", "https://a.gov/1.xml"]);
    expect(result.urls).toEqual([]);
    expect(result.warnings[0]).toMatch(/nested more than 1 levels/);
  });
});

describe("fetchSitemap over real HTTP", () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/sitemap.xml") {
        // Content-Encoding gzip is decompressed by fetch itself.
        res.writeHead(200, { "content-type": "application/xml", "content-encoding": "gzip" });
        res.end(gzipSync(Buffer.from(index(`${origin}/pages.xml`))));
      } else if (req.url === "/pages.xml") {
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(urlset(`${origin}/`, `${origin}/about/`));
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("fetches with the built-in fetch", async () => {
    const result = await fetchSitemap(`${origin}/sitemap.xml`);
    expect(result.urls.map((u) => u.loc)).toEqual([`${origin}/`, `${origin}/about/`]);
  });

  it("reports an unreachable server as an environment error", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    await expect(
      fetchSitemap(`http://127.0.0.1:${port}/sitemap.xml`, { timeoutMs: 5000 }),
    ).rejects.toBeInstanceOf(EnvironmentError);
  });
});
