import { describe, expect, it } from "vitest";

import { checkSite, checkSitemap, findSitemap, normalizeSiteAnswer } from "../src/init/site.js";
import { InterruptedError } from "../src/passes/steps.js";
import { realSitesFetch } from "./helpers/real-sites.js";

/**
 * A response whose headers arrive fine (status/ok already readable) but whose body stream then
 * times out, like a real server that sends headers immediately and stalls past the shared
 * AbortSignal.timeout: fetch() resolves normally, but reading the body later rejects.
 */
function bodyTimesOut(status = 200): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new DOMException("timed out", "TimeoutError"));
    },
  });
  return new Response(stream, { status });
}

describe("normalizeSiteAnswer", () => {
  it("trims the answer, adds https://, and lowercases the host", () => {
    expect(normalizeSiteAnswer("  I2I.Illinois.GOV ")?.origin).toBe("https://i2i.illinois.gov");
  });

  it("keeps an explicit scheme and drops the path", () => {
    expect(normalizeSiteAnswer("https://dvfr.illinois.gov/faq/")?.origin).toBe(
      "https://dvfr.illinois.gov",
    );
  });

  it("adds https:// to a host:port answer, instead of taking its host for a scheme", () => {
    expect(normalizeSiteAnswer("localhost:3000")?.href).toBe("https://localhost:3000/");
    expect(normalizeSiteAnswer("localhost:3000/faq/")?.href).toBe("https://localhost:3000/");
    expect(normalizeSiteAnswer("dvfr.illinois.gov:8443")?.href).toBe(
      "https://dvfr.illinois.gov:8443/",
    );
    // A real scheme before a host:port stays.
    expect(normalizeSiteAnswer("http://localhost:3000")?.href).toBe("http://localhost:3000/");
  });

  it("rejects a non-http(s) scheme", () => {
    expect(normalizeSiteAnswer("ftp://x")).toBeNull();
  });

  it("rejects text that isn't a URL even with https:// added", () => {
    expect(normalizeSiteAnswer("not a url")).toBeNull();
  });

  it("rejects an empty answer", () => {
    expect(normalizeSiteAnswer("")).toBeNull();
  });
});

describe("checkSite", () => {
  it("answers ok with no redirect", async () => {
    const result = await checkSite(new URL("https://i2i.illinois.gov"), realSitesFetch());
    if (!result.ok) throw new Error(`expected ok, got reason: ${result.reason}`);
    expect(result.site.origin).toBe("https://i2i.illinois.gov");
    expect(result.moved).toBe(false);
  });

  it("adopts the final origin after an http:// to https:// redirect", async () => {
    const result = await checkSite(new URL("http://i2i.illinois.gov"), realSitesFetch());
    if (!result.ok) throw new Error(`expected ok, got reason: ${result.reason}`);
    expect(result.site.origin).toBe("https://i2i.illinois.gov");
    expect(result.moved).toBe(true);
  });

  it("reports the HTTP status when the site answers with an error", async () => {
    const site = new URL("https://example.illinois.gov");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/": () => new Response("nope", { status: 403 }),
    });
    const result = await checkSite(site, fetch);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("HTTP 403");
    expect(result.site).toBe(site);
  });

  it("reports a timeout as 'no answer in 15 seconds'", async () => {
    const site = new URL("https://example.illinois.gov");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/": () => {
        throw new DOMException("timed out", "TimeoutError");
      },
    });
    const result = await checkSite(site, fetch);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("no answer in 15 seconds");
    expect(result.site).toBe(site);
  });

  it("reports a failed fetch's cause message", async () => {
    const site = new URL("https://example.illinois.gov");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/": () => {
        throw new TypeError("fetch failed", {
          cause: new Error("getaddrinfo ENOTFOUND example.illinois.gov"),
        });
      },
    });
    const result = await checkSite(site, fetch);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("getaddrinfo ENOTFOUND example.illinois.gov");
  });

  it("falls back to the error's own message when it has no cause", async () => {
    const site = new URL("https://example.illinois.gov");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/": () => {
        throw new Error("boom");
      },
    });
    const result = await checkSite(site, fetch);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("boom");
  });

  it("doesn't reject when the body errors before the cancel", async () => {
    const site = new URL("https://example.illinois.gov");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/": () => bodyTimesOut(),
    });

    const result = await checkSite(site, fetch);

    if (!result.ok) throw new Error(`expected ok, got reason: ${result.reason}`);
    expect(result.site.origin).toBe("https://example.illinois.gov");
    expect(result.moved).toBe(false);
  });
});

describe("fetchFailureReason", () => {
  it("never gives an empty reason", async () => {
    const site = new URL("https://example.illinois.gov");

    const aggregate = await checkSite(
      site,
      realSitesFetch({
        "https://example.illinois.gov/": () => {
          throw new TypeError("fetch failed", {
            cause: new AggregateError([
              new Error("connect ECONNREFUSED ::1:443"),
              new Error("connect ECONNREFUSED 127.0.0.1:443"),
            ]),
          });
        },
      }),
    );
    if (aggregate.ok) throw new Error("expected a failure");
    expect(aggregate.reason).toBe("connect ECONNREFUSED ::1:443");

    const withCode = await checkSite(
      site,
      realSitesFetch({
        "https://example.illinois.gov/": () => {
          const cause: NodeJS.ErrnoException = new Error("");
          cause.code = "ENOTFOUND";
          throw new TypeError("fetch failed", { cause });
        },
      }),
    );
    if (withCode.ok) throw new Error("expected a failure");
    expect(withCode.reason).toBe("ENOTFOUND");
  });

  it("falls back to the error's name, then to 'unknown error', when its message is empty", async () => {
    const site = new URL("https://example.illinois.gov");
    const failWith = (error: Error) =>
      checkSite(
        site,
        realSitesFetch({
          "https://example.illinois.gov/": () => {
            throw error;
          },
        }),
      );

    const unnamed = new Error("");
    unnamed.name = "";
    const reasons = [
      await failWith(new TypeError("")),
      await failWith(new TypeError("", { cause: new Error("") })),
      await failWith(unnamed),
    ].map((result) => (result.ok ? "(answered)" : result.reason));

    expect(reasons).toEqual(["TypeError", "TypeError", "unknown error"]);
  });
});

describe("checkSitemap", () => {
  it("accepts a <urlset> document", async () => {
    const result = await checkSitemap("https://dvfr.illinois.gov/sitemap.xml", realSitesFetch());
    expect(result).toEqual({ ok: true });
  });

  it("accepts a <sitemapindex> document", async () => {
    const result = await checkSitemap(
      "https://i2i.illinois.gov/sitemap-index.xml",
      realSitesFetch(),
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects a 200 HTML page as not a sitemap", async () => {
    const result = await checkSitemap("https://i2i.illinois.gov/", realSitesFetch());
    expect(result).toEqual({ ok: false, reason: "not a sitemap (no <urlset> or <sitemapindex>)" });
  });

  it("converts a body-read timeout into 'no answer in 15 seconds' instead of rejecting", async () => {
    const fetch = realSitesFetch({
      "https://example.illinois.gov/sitemap.xml": () => bodyTimesOut(),
    });
    const result = await checkSitemap("https://example.illinois.gov/sitemap.xml", fetch);
    expect(result).toEqual({ ok: false, reason: "no answer in 15 seconds" });
  });
});

describe("findSitemap", () => {
  it("finds i2i.illinois.gov's sitemap index from robots.txt", async () => {
    const found = await findSitemap(new URL("https://i2i.illinois.gov/"), realSitesFetch());
    expect(found).toBe("https://i2i.illinois.gov/sitemap-index.xml");
  });

  it("finds dvfr.illinois.gov's sitemap from robots.txt", async () => {
    const found = await findSitemap(new URL("https://dvfr.illinois.gov/"), realSitesFetch());
    expect(found).toBe("https://dvfr.illinois.gov/sitemap.xml");
  });

  it("matches a Sitemap: line case-insensitively, over CRLF, and resolves it against the origin", async () => {
    const site = new URL("https://example.illinois.gov/");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/robots.txt": () =>
        new Response("User-agent: *\r\nSITEMAP: /sitemaps/main.xml\r\n", { status: 200 }),
      "https://example.illinois.gov/sitemaps/main.xml": () =>
        new Response('<?xml version="1.0"?><urlset></urlset>', { status: 200 }),
    });
    const found = await findSitemap(site, fetch);
    expect(found).toBe("https://example.illinois.gov/sitemaps/main.xml");
  });

  it("falls back to /sitemap.xml when there's no robots.txt", async () => {
    const site = new URL("https://example.illinois.gov/");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/sitemap.xml": () =>
        new Response('<?xml version="1.0"?><urlset></urlset>', { status: 200 }),
    });
    const found = await findSitemap(site, fetch);
    expect(found).toBe("https://example.illinois.gov/sitemap.xml");
  });

  it("returns null when neither robots.txt nor /sitemap.xml answering 200 HTML is a sitemap", async () => {
    const site = new URL("https://example.illinois.gov/");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/sitemap.xml": () =>
        new Response("<html><body>hi</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    const found = await findSitemap(site, fetch);
    expect(found).toBeNull();
  });

  it("moves on to the next candidate when one's body times out, instead of throwing", async () => {
    const site = new URL("https://example.illinois.gov/");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/robots.txt": () =>
        new Response("Sitemap: https://example.illinois.gov/sitemap-slow.xml\n", { status: 200 }),
      "https://example.illinois.gov/sitemap-slow.xml": () => bodyTimesOut(),
      "https://example.illinois.gov/sitemap.xml": () =>
        new Response('<?xml version="1.0"?><urlset></urlset>', { status: 200 }),
    });
    const found = await findSitemap(site, fetch);
    expect(found).toBe("https://example.illinois.gov/sitemap.xml");
  });

  it("treats a robots.txt body timeout like a missing robots.txt, instead of throwing", async () => {
    const site = new URL("https://example.illinois.gov/");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/robots.txt": () => bodyTimesOut(),
      "https://example.illinois.gov/sitemap.xml": () =>
        new Response('<?xml version="1.0"?><urlset></urlset>', { status: 200 }),
    });
    const found = await findSitemap(site, fetch);
    expect(found).toBe("https://example.illinois.gov/sitemap.xml");
  });
});

describe("interruption", () => {
  it("rejects with InterruptedError when the signal aborts", async () => {
    const controller = new AbortController();
    // Waits for its own request signal to abort, ignoring which URL it was asked for.
    const waitsForAbort: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason as Error));
      });
    const site = new URL("https://example.illinois.gov/");

    const sitePromise = checkSite(site, waitsForAbort, controller.signal);
    const sitemapPromise = checkSitemap(
      "https://example.illinois.gov/sitemap.xml",
      waitsForAbort,
      controller.signal,
    );
    const findPromise = findSitemap(site, waitsForAbort, controller.signal);
    controller.abort();

    await expect(sitePromise).rejects.toThrow(InterruptedError);
    await expect(sitemapPromise).rejects.toThrow(InterruptedError);
    await expect(findPromise).rejects.toThrow(InterruptedError);
  });
});
