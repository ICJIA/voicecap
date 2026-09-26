import { describe, expect, it } from "vitest";

import {
  canonicalKey,
  displayPath,
  isHtmlContentType,
  nonHtmlExtension,
  normalizeUrl,
  parseSiteUrl,
  resolvePageUrl,
  sameOrigin,
} from "../src/pages/url.js";
import { UsageError } from "../src/util/errors.js";

const site = parseSiteUrl("https://example.illinois.gov");

describe("parseSiteUrl", () => {
  it("returns the site's origin", () => {
    expect(parseSiteUrl("https://Example.Illinois.gov/some/path?x=1").href).toBe(
      "https://example.illinois.gov/",
    );
    expect(parseSiteUrl("http://127.0.0.1:4747").href).toBe("http://127.0.0.1:4747/");
  });

  it("rejects values that aren't http(s) URLs", () => {
    expect(() => parseSiteUrl("example.illinois.gov")).toThrow(UsageError);
    expect(() => parseSiteUrl("ftp://example.illinois.gov")).toThrow(/http or https/);
  });
});

describe("resolvePageUrl", () => {
  it("accepts full URLs and root-relative paths", () => {
    expect(resolvePageUrl("https://example.illinois.gov/about", site)?.href).toBe(
      "https://example.illinois.gov/about",
    );
    expect(resolvePageUrl("/grants/fy27-jag", site)?.href).toBe(
      "https://example.illinois.gov/grants/fy27-jag",
    );
    expect(resolvePageUrl("  /about/  ", site)?.href).toBe("https://example.illinois.gov/about/");
  });

  it("resolves paths without a leading slash against the site root", () => {
    expect(resolvePageUrl("about", site)?.href).toBe("https://example.illinois.gov/about");
  });

  it("drops fragments and keeps query strings", () => {
    expect(resolvePageUrl("/news?page=2#top", site)?.href).toBe(
      "https://example.illinois.gov/news?page=2",
    );
  });

  it("returns null for anything that isn't an http(s) page", () => {
    expect(resolvePageUrl("", site)).toBeNull();
    expect(resolvePageUrl("   ", site)).toBeNull();
    expect(resolvePageUrl("mailto:someone@example.com", site)).toBeNull();
    expect(resolvePageUrl("ftp://example.illinois.gov/file", site)).toBeNull();
    expect(resolvePageUrl("http://[not-a-host]/", site)).toBeNull();
    expect(resolvePageUrl("C:/Program Files/Git/about", site)).toBeNull();
  });
});

describe("canonicalKey", () => {
  it("treats /about and /about/ as the same page", () => {
    expect(canonicalKey("https://example.illinois.gov/about/")).toBe(
      canonicalKey("https://example.illinois.gov/about"),
    );
    expect(canonicalKey("https://example.illinois.gov/about/")).toBe(
      "https://example.illinois.gov/about",
    );
  });

  it("keeps the root path", () => {
    expect(canonicalKey("https://example.illinois.gov")).toBe("https://example.illinois.gov/");
    expect(canonicalKey("https://example.illinois.gov/")).toBe("https://example.illinois.gov/");
  });

  it("keeps query strings, so different queries are different pages", () => {
    const a = canonicalKey("https://example.illinois.gov/news?page=1");
    const b = canonicalKey("https://example.illinois.gov/news?page=2");
    expect(a).toBe("https://example.illinois.gov/news?page=1");
    expect(a).not.toBe(b);
    expect(canonicalKey("https://example.illinois.gov/news/?page=1")).toBe(a);
  });

  it("drops fragments, lowercases the host, and removes default ports", () => {
    expect(canonicalKey("HTTPS://Example.Illinois.GOV:443/About#top")).toBe(
      "https://example.illinois.gov/About",
    );
  });

  it("accepts URL objects", () => {
    expect(canonicalKey(new URL("https://example.illinois.gov/a/#x"))).toBe(
      "https://example.illinois.gov/a",
    );
  });
});

describe("normalizeUrl and sameOrigin", () => {
  it("normalizeUrl drops only the fragment and doesn't mutate its input", () => {
    const input = new URL("https://example.illinois.gov/a?b=1#c");
    expect(normalizeUrl(input).href).toBe("https://example.illinois.gov/a?b=1");
    expect(input.hash).toBe("#c");
  });

  it("sameOrigin compares scheme, host, and port", () => {
    expect(sameOrigin(new URL("https://example.illinois.gov/x"), site)).toBe(true);
    expect(sameOrigin(new URL("http://example.illinois.gov/x"), site)).toBe(false);
    expect(sameOrigin(new URL("https://www.example.illinois.gov/x"), site)).toBe(false);
  });
});

describe("nonHtmlExtension", () => {
  it("recognizes documents, images, and other non-HTML files", () => {
    expect(nonHtmlExtension(new URL("https://a.gov/files/report.pdf"))).toBe("pdf");
    expect(nonHtmlExtension(new URL("https://a.gov/files/Form.DOCX"))).toBe("docx");
    expect(nonHtmlExtension(new URL("https://a.gov/img/logo.png"))).toBe("png");
    expect(nonHtmlExtension(new URL("https://a.gov/files/report.pdf?download=1"))).toBe("pdf");
  });

  it("leaves HTML pages and extensionless paths alone", () => {
    expect(nonHtmlExtension(new URL("https://a.gov/about"))).toBeNull();
    expect(nonHtmlExtension(new URL("https://a.gov/about/"))).toBeNull();
    expect(nonHtmlExtension(new URL("https://a.gov/index.html"))).toBeNull();
    expect(nonHtmlExtension(new URL("https://a.gov/page.aspx"))).toBeNull();
    expect(nonHtmlExtension(new URL("https://a.gov/.well-known"))).toBeNull();
    expect(nonHtmlExtension(new URL("https://a.gov/v1.2/notes"))).toBeNull();
  });
});

describe("isHtmlContentType", () => {
  it("accepts HTML and unknown types, rejects others", () => {
    expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlContentType("application/xhtml+xml")).toBe(true);
    expect(isHtmlContentType(null)).toBe(true);
    expect(isHtmlContentType("")).toBe(true);
    expect(isHtmlContentType("application/pdf")).toBe(false);
    expect(isHtmlContentType("application/rss+xml; charset=utf-8")).toBe(false);
  });
});

describe("displayPath", () => {
  it("shows path and query", () => {
    expect(displayPath("https://a.gov/grants/fy27-jag?x=1")).toBe("/grants/fy27-jag?x=1");
    expect(displayPath("not a url")).toBe("not a url");
  });
});
