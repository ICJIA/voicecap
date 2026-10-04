import { describe, expect, it } from "vitest";

import {
  canonicalLinkHref,
  checkSite,
  checkSitemap,
  findSitemaps,
  normalizeSiteAnswer,
} from "../src/init/site.js";
import { InterruptedError } from "../src/passes/steps.js";
import { realSitesFetch, redirectedTo } from "./helpers/real-sites.js";

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
    // The page can't be read, so it names no address, and the check still says the site answers.
    expect(result.canonical).toBeNull();
  });
});

describe("checkSite's canonical address", () => {
  const tag = (href: string) => `<link rel="canonical" href="${href}">`;

  /** A home page that answers with HTML, `head` between its <head> tags. */
  function homePage(head: string): () => Response {
    return () =>
      new Response(
        `<!doctype html><html><head><title>Home</title>${head}</head><body><h1>Home</h1></body></html>`,
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      );
  }

  /** The root the home page at `site` names, when its head has `head`. */
  async function canonicalOf(site: string, head: string): Promise<string | null> {
    const fetch = realSitesFetch({ [`${site}/`]: homePage(head) });
    const result = await checkSite(new URL(site), fetch);
    if (!result.ok) throw new Error(`expected ok, got reason: ${result.reason}`);
    return result.canonical;
  }

  it("is the root the home page's tag names", async () => {
    expect(
      await canonicalOf("https://example.illinois.gov", tag("https://example.illinois.gov/")),
    ).toBe("https://example.illinois.gov/");
  });

  it("is the site's own root for a copy on this computer", async () => {
    expect(await canonicalOf("http://localhost:3000", tag("https://dvfr.illinois.gov/"))).toBe(
      "https://dvfr.illinois.gov/",
    );
  });

  it.each([
    ["the demo's root", "https://voicecap.netlify.app/demo-site/"],
    ["another page of the site", "https://dvfr.illinois.gov/about/"],
    ["a language folder", "https://dvfr.illinois.gov/en/"],
  ])("is null for a home page's tag that names a root with a path: %s", async (_what, href) => {
    // At the path "/", a tag that names any page fits, as its path ends in "/", so a root with a
    // path might be another page's address. The run judges it from its inner pages' tags.
    expect(await canonicalOf("http://127.0.0.1:4848", tag(href))).toBeNull();
  });

  it("keeps a root with a path when the page it read isn't at the path /", async () => {
    // The home page redirects to /en/, so its tag has to end with that path, which is stronger.
    const fetch = realSitesFetch({
      "http://127.0.0.1:4848/": () =>
        redirectedTo(
          "http://127.0.0.1:4848/en/",
          `<html><head>${tag("https://voicecap.netlify.app/demo-site/en/")}</head></html>`,
        ),
    });
    const result = await checkSite(new URL("http://127.0.0.1:4848"), fetch);
    if (!result.ok) throw new Error(`expected ok, got reason: ${result.reason}`);
    expect(result.canonical).toBe("https://voicecap.netlify.app/demo-site/");
  });

  it("reads a relative tag against the page's address, as a browser does", async () => {
    // On a public site, "/" is the site's own address; an address with no scheme takes the page's.
    expect(await canonicalOf("https://example.illinois.gov", tag("/"))).toBe(
      "https://example.illinois.gov/",
    );
    expect(await canonicalOf("http://localhost:3000", tag("//dvfr.illinois.gov/"))).toBe(
      "http://dvfr.illinois.gov/",
    );
  });

  it("is null when the page has no tag", async () => {
    const result = await checkSite(new URL("https://i2i.illinois.gov"), realSitesFetch());
    if (!result.ok) throw new Error(`expected ok, got reason: ${result.reason}`);
    expect(result.canonical).toBeNull();
  });

  it.each([
    ["a tag that names another page", tag("https://dvfr.illinois.gov/about")],
    ["a tag that names an address on this computer", tag("http://localhost:3000/")],
    ["a relative tag, which reads as the copy's own address", tag("/about/")],
    ["a tag with another scheme", tag("ftp://dvfr.illinois.gov/")],
    ["a tag that isn't an address", tag("http://")],
    ["a tag with no address", '<link rel="canonical">'],
    ["a tag only a comment holds", `<!-- ${tag("https://dvfr.illinois.gov/")} -->`],
  ])("is null for %s", async (_what, head) => {
    expect(await canonicalOf("http://localhost:3000", head)).toBeNull();
  });

  it("reads the tag against the address the page ended at", async () => {
    // The home page redirects to /en/, and its tag names that page: the site's root is the origin's.
    const fetch = realSitesFetch({
      "https://example.illinois.gov/": () =>
        redirectedTo(
          "https://example.illinois.gov/en/",
          `<html><head>${tag("https://example.illinois.gov/en/")}</head></html>`,
        ),
    });
    const result = await checkSite(new URL("https://example.illinois.gov"), fetch);
    if (!result.ok) throw new Error(`expected ok, got reason: ${result.reason}`);
    expect(result.canonical).toBe("https://example.illinois.gov/");
    expect(result.site.href).toBe("https://example.illinois.gov/");
  });

  it("doesn't read a page that isn't HTML", async () => {
    const fetch = realSitesFetch({
      "https://example.illinois.gov/": () =>
        new Response(`{"head":"<link rel='canonical' href='https://example.illinois.gov/'>"}`, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const result = await checkSite(new URL("https://example.illinois.gov"), fetch);
    if (!result.ok) throw new Error(`expected ok, got reason: ${result.reason}`);
    expect(result.canonical).toBeNull();
  });
});

describe("canonicalLinkHref", () => {
  it("reads the address of the canonical link", () => {
    const head = '<head><link rel="canonical" href="https://dvfr.illinois.gov/about/"></head>';
    expect(canonicalLinkHref(head)).toBe("https://dvfr.illinois.gov/about/");
  });

  it.each([
    ["the attributes the other way round", '<link href="https://x.org/" rel="canonical">'],
    ["upper-case names", '<LINK REL="canonical" HREF="https://x.org/">'],
    ["a capital in the value", '<link rel="Canonical" href="https://x.org/">'],
    ["single quotes", "<link rel='canonical' href='https://x.org/'>"],
    ["no quotes", "<link rel=canonical href=https://x.org/>"],
    ["spaces around the equals signs", '<link rel = "canonical" href = "https://x.org/" >'],
    ["a closing slash", '<link rel="canonical" href="https://x.org/"/>'],
    ["a closing slash after a space", '<link rel="canonical" href="https://x.org/" />'],
    ["other attributes", '<link id=a rel="canonical" hreflang="en" data-b href="https://x.org/">'],
    ["another word in rel", '<link rel="alternate  canonical" href="https://x.org/">'],
    ["a tab in rel", '<link rel="alternate\tcanonical" href="https://x.org/">'],
    ["line breaks in the tag", '<link\n  rel="canonical"\n  href="https://x.org/"\n>'],
  ])("reads a link written with %s", (_what, html) => {
    expect(canonicalLinkHref(html)).toBe("https://x.org/");
  });

  it("keeps a > inside a quoted value from ending the tag", () => {
    const html = '<link rel="canonical" title="a > b" href="https://x.org/?a=1>2">';
    expect(canonicalLinkHref(html)).toBe("https://x.org/?a=1>2");
  });

  it("skips the links that aren't canonical", () => {
    const html =
      '<link rel="stylesheet" href="/a.css"><link rel="alternate" href="https://y.org/">' +
      '<link rel="canonicalize" href="https://z.org/"><link href="https://w.org/">' +
      '<link rel="canonical" href="https://x.org/">';
    expect(canonicalLinkHref(html)).toBe("https://x.org/");
  });

  it("takes the first canonical link, as a browser's first match is", () => {
    const html =
      '<link rel="canonical" href="https://first.org/"><link rel="canonical" href="https://second.org/">';
    expect(canonicalLinkHref(html)).toBe("https://first.org/");
  });

  it("takes an attribute's first value when it's written twice, as a browser does", () => {
    const html = '<link rel="canonical" href="https://first.org/" href="https://second.org/">';
    expect(canonicalLinkHref(html)).toBe("https://first.org/");
  });

  it("gives null when the first canonical link has no address", () => {
    expect(canonicalLinkHref('<link rel="canonical">')).toBeNull();
    expect(
      canonicalLinkHref('<link rel="canonical"><link rel="canonical" href="https://x.org/">'),
    ).toBeNull();
  });

  it("gives an empty address as it is written", () => {
    expect(canonicalLinkHref('<link rel="canonical" href="">')).toBe("");
  });

  it("gives null when the page has no canonical link", () => {
    expect(
      canonicalLinkHref("<!doctype html><html><head><title>Home</title></head></html>"),
    ).toBeNull();
    expect(canonicalLinkHref("")).toBeNull();
  });

  it("leaves out a link inside a comment", () => {
    const html = '<!-- <link rel="canonical" href="https://old.example/"> --><p>Hello</p>';
    expect(canonicalLinkHref(html)).toBeNull();
    const conditional =
      '<!--[if IE]><link rel="canonical" href="https://old.example/"><![endif]-->';
    expect(canonicalLinkHref(`${conditional}<link rel="canonical" href="https://x.org/">`)).toBe(
      "https://x.org/",
    );
  });

  it("reads a link after the shortest comments", () => {
    for (const comment of ["<!---->", "<!-->", "<!--->"]) {
      expect(canonicalLinkHref(`${comment}<link rel="canonical" href="https://x.org/">`)).toBe(
        "https://x.org/",
      );
    }
  });

  it("gives null when a comment never ends", () => {
    expect(canonicalLinkHref('<!-- <link rel="canonical" href="https://x.org/">')).toBeNull();
  });

  it("leaves out a link written in a script, a style, a title, or a textarea", () => {
    for (const element of ["script", "style", "title", "textarea", "SCRIPT"]) {
      const text = `<${element} type="x">write('<link rel="canonical" href="https://old.example/">')</${element}>`;
      expect(canonicalLinkHref(text), element).toBeNull();
      expect(
        canonicalLinkHref(`${text}<link rel="canonical" href="https://x.org/">`),
        element,
      ).toBe("https://x.org/");
    }
  });

  it("gives null when a script never ends", () => {
    expect(
      canonicalLinkHref('<script>write("<link rel=canonical href=https://old.example/>")'),
    ).toBeNull();
  });

  it("leaves out a link written inside another tag's attribute", () => {
    const html = `<meta name="description" content='<link rel="canonical" href="https://old.example/">'>`;
    expect(canonicalLinkHref(html)).toBeNull();
  });

  it("takes only a link tag, not one whose name only starts with link", () => {
    const html =
      '<linked rel="canonical" href="https://old.example/"><link-box rel="canonical" href="https://old.example/">';
    expect(canonicalLinkHref(html)).toBeNull();
  });

  it("reads past a < in the text, an end tag, and a doctype", () => {
    const link = '<link rel="canonical" href="https://x.org/">';
    expect(canonicalLinkHref(`<!DOCTYPE html><p>1 < 2 and 3 <= 4 and 5 <3</p>${link}`)).toBe(
      "https://x.org/",
    );
    // No ">" between the "<" and the link: a "<" that starts no tag isn't the start of one.
    expect(canonicalLinkHref(`<p>1 < 2 ${link}`)).toBe("https://x.org/");
  });

  it("gives null for a tag that never ends", () => {
    expect(canonicalLinkHref('<link rel="canonical" href="https://x.org/"')).toBeNull();
    expect(canonicalLinkHref('<link rel="canonical" href="https://x.org/')).toBeNull();
    expect(canonicalLinkHref('<link rel="canonical" href=')).toBeNull();
    expect(canonicalLinkHref("<link rel")).toBeNull();
    expect(canonicalLinkHref("<")).toBeNull();
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

describe("findSitemaps", () => {
  const urlset = () => new Response('<?xml version="1.0"?><urlset></urlset>', { status: 200 });

  it("offers both of i2i.illinois.gov's sitemaps: the index robots.txt names, then /sitemap.xml", async () => {
    const found = await findSitemaps(new URL("https://i2i.illinois.gov/"), realSitesFetch());
    expect(found).toEqual([
      { url: "https://i2i.illinois.gov/sitemap-index.xml", from: "robots.txt" },
      { url: "https://i2i.illinois.gov/sitemap.xml", from: "/sitemap.xml" },
    ]);
  });

  it("lists dvfr.illinois.gov's sitemap once, since its robots.txt names /sitemap.xml itself", async () => {
    const found = await findSitemaps(new URL("https://dvfr.illinois.gov/"), realSitesFetch());
    expect(found).toEqual([{ url: "https://dvfr.illinois.gov/sitemap.xml", from: "robots.txt" }]);
  });

  it("matches a Sitemap: line case-insensitively, over CRLF, and resolves it against the origin", async () => {
    const site = new URL("https://example.illinois.gov/");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/robots.txt": () =>
        new Response("User-agent: *\r\nSITEMAP: /sitemaps/main.xml\r\n", { status: 200 }),
      "https://example.illinois.gov/sitemaps/main.xml": urlset,
    });
    const found = await findSitemaps(site, fetch);
    expect(found).toEqual([
      { url: "https://example.illinois.gov/sitemaps/main.xml", from: "robots.txt" },
    ]);
  });

  it("lists each sitemap robots.txt names once, in order, leaving out any that isn't one", async () => {
    const site = new URL("https://example.illinois.gov/");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/robots.txt": () =>
        new Response(
          "Sitemap: /pages.xml\nSitemap: /gone.xml\n" +
            "Sitemap: https://example.illinois.gov/pages.xml\nSitemap: /news.xml\n",
          { status: 200 },
        ),
      "https://example.illinois.gov/pages.xml": urlset,
      "https://example.illinois.gov/news.xml": urlset,
    });
    const found = await findSitemaps(site, fetch);
    expect(found).toEqual([
      { url: "https://example.illinois.gov/pages.xml", from: "robots.txt" },
      { url: "https://example.illinois.gov/news.xml", from: "robots.txt" },
    ]);
  });

  it("finds /sitemap.xml alone when there's no robots.txt", async () => {
    const site = new URL("https://example.illinois.gov/");
    const fetch = realSitesFetch({ "https://example.illinois.gov/sitemap.xml": urlset });
    const found = await findSitemaps(site, fetch);
    expect(found).toEqual([
      { url: "https://example.illinois.gov/sitemap.xml", from: "/sitemap.xml" },
    ]);
  });

  it("finds none when neither robots.txt nor /sitemap.xml answering 200 HTML is a sitemap", async () => {
    const site = new URL("https://example.illinois.gov/");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/sitemap.xml": () =>
        new Response("<html><body>hi</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    const found = await findSitemaps(site, fetch);
    expect(found).toEqual([]);
  });

  it("checks them all at once, so a slow sitemap doesn't hold up the others", async () => {
    const site = new URL("https://example.illinois.gov/");
    let askedForSitemapXml!: () => void;
    const sitemapXmlAsked = new Promise<void>((resolve) => (askedForSitemapXml = resolve));
    const fetch = realSitesFetch({
      "https://example.illinois.gov/robots.txt": () =>
        new Response("Sitemap: /slow.xml\n", { status: 200 }),
      // Answers only once /sitemap.xml has been asked for too: checked one by one, this never ends.
      "https://example.illinois.gov/slow.xml": async () => {
        await sitemapXmlAsked;
        return urlset();
      },
      "https://example.illinois.gov/sitemap.xml": () => {
        askedForSitemapXml();
        return urlset();
      },
    });
    const found = await findSitemaps(site, fetch);
    expect(found.map((sitemap) => sitemap.url)).toEqual([
      "https://example.illinois.gov/slow.xml",
      "https://example.illinois.gov/sitemap.xml",
    ]);
  });

  it("leaves out a candidate whose body times out, instead of throwing", async () => {
    const site = new URL("https://example.illinois.gov/");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/robots.txt": () =>
        new Response("Sitemap: https://example.illinois.gov/sitemap-slow.xml\n", { status: 200 }),
      "https://example.illinois.gov/sitemap-slow.xml": () => bodyTimesOut(),
      "https://example.illinois.gov/sitemap.xml": urlset,
    });
    const found = await findSitemaps(site, fetch);
    expect(found).toEqual([
      { url: "https://example.illinois.gov/sitemap.xml", from: "/sitemap.xml" },
    ]);
  });

  it("treats a robots.txt body timeout like a missing robots.txt, instead of throwing", async () => {
    const site = new URL("https://example.illinois.gov/");
    const fetch = realSitesFetch({
      "https://example.illinois.gov/robots.txt": () => bodyTimesOut(),
      "https://example.illinois.gov/sitemap.xml": urlset,
    });
    const found = await findSitemaps(site, fetch);
    expect(found).toEqual([
      { url: "https://example.illinois.gov/sitemap.xml", from: "/sitemap.xml" },
    ]);
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
    const findPromise = findSitemaps(site, waitsForAbort, controller.signal);
    controller.abort();

    await expect(sitePromise).rejects.toThrow(InterruptedError);
    await expect(sitemapPromise).rejects.toThrow(InterruptedError);
    await expect(findPromise).rejects.toThrow(InterruptedError);
  });

  it("rejects with InterruptedError when the signal aborts while the home page is arriving", async () => {
    const controller = new AbortController();
    // Answers at once, then keeps its body open until its request's signal aborts.
    const stalls: typeof fetch = (_input, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(stream) {
              init!.signal!.addEventListener("abort", () => stream.error(init!.signal!.reason));
            },
          }),
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      );

    const pending = checkSite(new URL("https://example.illinois.gov/"), stalls, controller.signal);
    // Let the answer arrive and the page start to be read, then press Ctrl+C.
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(pending).rejects.toThrow(InterruptedError);
  });
});
