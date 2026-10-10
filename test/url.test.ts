import { describe, expect, it } from "vitest";

import {
  addressWithCredentials,
  canonicalKey,
  displayPath,
  hasCredentials,
  hasEmptyLabel,
  isHtmlContentType,
  nonHtmlExtension,
  normalizeUrl,
  parseSiteUrl,
  resolvePageUrl,
  resolveSitemapUrl,
  sameOrigin,
  withoutCredentials,
} from "../src/pages/url.js";
import { UsageError } from "../src/util/errors.js";

const site = parseSiteUrl("https://example.illinois.gov");

/** What `--site` says of an address with a user name or password in it. */
const SITE_CREDENTIALS =
  "--site has a user name or password in it: give the site's address without them.";

/** The error `parseSiteUrl` stops `input` with. */
function siteRefusal(input: string): UsageError {
  let error: unknown;
  try {
    parseSiteUrl(input);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(UsageError);
  return error as UsageError;
}

describe("parseSiteUrl", () => {
  it("returns the site's origin", () => {
    expect(parseSiteUrl("https://Example.Illinois.gov/some/path?x=1").href).toBe(
      "https://example.illinois.gov/",
    );
    expect(parseSiteUrl("http://127.0.0.1:4747").href).toBe("http://127.0.0.1:4747/");
    expect(parseSiteUrl("https://dvfr.illinois.gov").href).toBe("https://dvfr.illinois.gov/");
  });

  it("rejects values that aren't http(s) URLs", () => {
    expect(() => parseSiteUrl("example.illinois.gov")).toThrow(UsageError);
    expect(() => parseSiteUrl("ftp://example.illinois.gov")).toThrow(/http or https/);
  });

  // A host with an empty part isn't a site's name, and a folder named for one could be the
  // transcripts home itself, or the folder that holds it (`new URL("http://../").host` is "..").
  it.each([
    "http://../",
    "http://%2e%2e/",
    "http://.../",
    "http://./",
    "https://a..b.org",
    "https://.example.org",
    "https://example.org.",
    "https://example.org./path",
  ])("refuses %s, as not a web address, naming --site", (address) => {
    const message = siteRefusal(address).message;

    expect(message).toContain("--site");
    expect(message).toContain("web address");
  });

  it("says what the site must be, and what it was given, for a host with an empty part", () => {
    expect(siteRefusal("https://a..b.org").message).toBe(
      `--site must be a web address such as https://dvfr.illinois.gov: a host can't start or end with a dot or have two dots in a row (got "https://a..b.org").`,
    );
  });

  it("refuses an address with a user name and a password, in words that hold neither", () => {
    const message = siteRefusal("https://user:pw@example.org").message;

    expect(message).toBe(SITE_CREDENTIALS);
    expect(message).toContain("--site");
    expect(message).not.toContain("pw");
  });

  it.each([
    "https://jane:s3cret@example.org/some/path?x=1#top",
    "http://jane@example.org",
    "http://:s3cret@example.org",
    // Not a web address either, and still no echo of what it holds.
    "ftp://jane:s3cret@example.org",
    "http:jane:s3cret@example.org/",
    // A host with an empty part as well: the password is still not repeated.
    "http://jane:s3cret@../",
  ])("refuses %s, with words that hold no user name and no password", (address) => {
    const message = siteRefusal(address).message;

    expect(message).toBe(SITE_CREDENTIALS);
    expect(message).not.toContain("jane");
    expect(message).not.toContain("s3cret");
  });

  it("takes an address whose @ is in its path, query, or fragment, which is no user name", () => {
    expect(parseSiteUrl("https://example.org/@pw").href).toBe("https://example.org/");
    expect(parseSiteUrl("https://example.org/?mail=a@b.c").href).toBe("https://example.org/");
    expect(parseSiteUrl("https://example.org/#@pw").href).toBe("https://example.org/");
    // A bare @ is no user name and no password.
    expect(parseSiteUrl("https://@example.org").href).toBe("https://example.org/");
  });

  it("still takes a local address, an address with a port, and a host in capitals", () => {
    expect(parseSiteUrl("http://127.0.0.1:4747").href).toBe("http://127.0.0.1:4747/");
    expect(parseSiteUrl("http://localhost:3000/x").href).toBe("http://localhost:3000/");
    expect(parseSiteUrl("http://[::1]:4747/").href).toBe("http://[::1]:4747/");
    expect(parseSiteUrl("http://intranet").href).toBe("http://intranet/");
    expect(parseSiteUrl("HTTPS://DVFR.Illinois.GOV").href).toBe("https://dvfr.illinois.gov/");
  });
});

describe("hasEmptyLabel", () => {
  it.each([
    ["a host that starts with a dot", ".example.com"],
    ["a host with two dots together", "a..b.org"],
    ["a host that ends with a dot", "example.com."],
    ["a host of dots", ".."],
    ["a single dot", "."],
    ["nothing at all", ""],
  ])("is true for %s", (_name, hostname) => {
    expect(hasEmptyLabel(hostname)).toBe(true);
  });

  it.each([
    "example.com",
    "dvfr.illinois.gov",
    "intranet",
    "127.0.0.1",
    "[::1]",
    "xn--exmple-cua.gov",
  ])("is false for %s", (hostname) => {
    expect(hasEmptyLabel(hostname)).toBe(false);
  });
});

describe("hasCredentials and withoutCredentials", () => {
  it.each([
    ["a user name and a password", "https://user:pw@example.org/a?b=1#c"],
    ["a user name alone", "https://user@example.org/a"],
    ["a password alone", "https://:pw@example.org/a"],
  ])("see %s", (_name, address) => {
    const url = new URL(address);

    expect(hasCredentials(url)).toBe(true);
    const without = withoutCredentials(url);
    expect(without).toBe(address.replace(/\/\/[^@]*@/, "//"));
    expect(without).not.toContain("pw");
    expect(without).not.toContain("user");
    expect(hasCredentials(new URL(without))).toBe(false);
  });

  it("see none in an address with an @ elsewhere, or a bare @", () => {
    for (const address of [
      "https://example.org/a@b",
      "https://example.org/?x=a@b",
      "https://example.org/#a@b",
      "https://@example.org/",
      "https://example.org/",
    ]) {
      expect(hasCredentials(new URL(address)), address).toBe(false);
    }
  });

  it("gives the address back as it was when there's nothing to clear, and changes no URL it's given", () => {
    const plain = new URL("https://example.org/a?b=1#c");
    expect(withoutCredentials(plain)).toBe("https://example.org/a?b=1#c");

    const url = new URL("https://user:pw@example.org/a");
    withoutCredentials(url);
    expect(url.username).toBe("user");
    expect(url.password).toBe("pw");
  });
});

describe("addressWithCredentials", () => {
  it.each([
    ["a full URL", "https://u:p@example.org/a", "https://u:p@example.org/a"],
    [
      "a full URL with a user name alone",
      "https://jane@example.org/a",
      "https://jane@example.org/a",
    ],
    ["a full URL of another scheme", "ftp://u:p@example.org/a", "ftp://u:p@example.org/a"],
    ["a full URL, in spaces", "  https://u:p@example.org/a  ", "https://u:p@example.org/a"],
    [
      "an address with no slashes after its scheme",
      "http:u:p@example.org/a",
      "http://u:p@example.org/a",
    ],
  ])("gives %s, with its user name and password", (_name, input, href) => {
    expect(addressWithCredentials(input)?.href).toBe(href);
    expect(addressWithCredentials(input, site)?.href).toBe(href);
  });

  it("gives a path that names another host, whether or not there's a site to resolve it on", () => {
    expect(addressWithCredentials("//u:p@example.org/a", site)?.href).toBe(
      "https://u:p@example.org/a",
    );
    expect(addressWithCredentials("//u:p@example.org/a")?.username).toBe("u");
  });

  it.each([
    "https://example.org/a",
    "https://example.org/a@b",
    "https://example.org/?mail=a@b.c",
    "https://example.org/#a@b",
    "https://@example.org/",
    "mailto:someone@example.com",
    "/about",
    "about",
    "sitemap.xml",
    "",
    "   ",
    "http://[not-a-host]/",
    "C:/Program Files/Git/about",
  ])("gives none for %j", (input) => {
    expect(addressWithCredentials(input)).toBeNull();
    expect(addressWithCredentials(input, site)).toBeNull();
  });
});

describe("resolveSitemapUrl", () => {
  it("gives a sitemap's URL, as a full URL or as a name or path on the site", () => {
    expect(resolveSitemapUrl("https://dvfr.illinois.gov/sitemap.xml", site)?.href).toBe(
      "https://dvfr.illinois.gov/sitemap.xml",
    );
    expect(resolveSitemapUrl("sitemap.xml", site)?.href).toBe(
      "https://example.illinois.gov/sitemap.xml",
    );
    expect(resolveSitemapUrl("/sitemaps/pages.xml", site)?.href).toBe(
      "https://example.illinois.gov/sitemaps/pages.xml",
    );
  });

  it("gives none for a sitemap whose address has a user name or password in it", () => {
    expect(resolveSitemapUrl("https://user:pw@example.org/sitemap.xml", site)).toBeNull();
    expect(resolveSitemapUrl("https://user@example.org/sitemap.xml")).toBeNull();
    // A path that goes to another host, with its user name, is the same address.
    expect(resolveSitemapUrl("//user:pw@example.org/sitemap.xml", site)).toBeNull();
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
