import { describe, expect, it } from "vitest";

import {
  canonicalName,
  canonicalRootFrom,
  chooseCanonicalRoot,
  isLocalHost,
  isWebRoot,
  normalizeCanonical,
  readLocation,
  recordedCanonical,
  toCanonical,
  type TaggedPage,
} from "../src/pages/canonical.js";
import { UsageError, errorMessage } from "../src/util/errors.js";

/** The demo's canonical address, and the address its runs read it at. */
const demoRoot = "https://voicecap.netlify.app/demo-site/";
const demoOrigin = "http://127.0.0.1:4848";

/** What `normalizeCanonical` throws for `input`. The test fails when it doesn't throw. */
function refusalOf(input: string): unknown {
  try {
    normalizeCanonical(input);
  } catch (error) {
    return error;
  }
  throw new Error(`normalizeCanonical(${JSON.stringify(input)}) didn't throw`);
}

describe("normalizeCanonical", () => {
  it("adds https:// to a bare host", () => {
    expect(normalizeCanonical("dvfr.illinois.gov")).toBe("https://dvfr.illinois.gov/");
  });

  it("adds https:// to a bare host with a port, as init does", () => {
    expect(normalizeCanonical("dvfr.illinois.gov:8443")).toBe("https://dvfr.illinois.gov:8443/");
  });

  it("ignores spaces around the address", () => {
    expect(normalizeCanonical("  dvfr.illinois.gov \n")).toBe("https://dvfr.illinois.gov/");
  });

  it("keeps an http:// scheme", () => {
    expect(normalizeCanonical("http://example.org")).toBe("http://example.org/");
  });

  it("gives a path without a trailing slash one", () => {
    expect(normalizeCanonical("https://example.org/agency")).toBe("https://example.org/agency/");
    expect(normalizeCanonical("https://example.org/agency/")).toBe("https://example.org/agency/");
  });

  it("drops a query and a hash", () => {
    expect(normalizeCanonical("https://Example.org/agency?x=1#y")).toBe(
      "https://example.org/agency/",
    );
  });

  it("lowers an upper-case host, and keeps the path's case", () => {
    expect(normalizeCanonical("HTTPS://DVFR.Illinois.GOV/Agency")).toBe(
      "https://dvfr.illinois.gov/Agency/",
    );
  });

  it("writes an international host in its ASCII form", () => {
    expect(normalizeCanonical("bücher.example")).toBe("https://xn--bcher-kva.example/");
  });

  it("drops any credentials in the address", () => {
    expect(normalizeCanonical("https://user:secret@example.org/agency")).toBe(
      "https://example.org/agency/",
    );
  });

  it("refuses what isn't a web address, saying so", () => {
    for (const input of ["", "ftp://x.org", "not a url", "javascript:alert(1)"]) {
      const refusal = refusalOf(input);
      expect(refusal, input).toBeInstanceOf(UsageError);
      expect(errorMessage(refusal), input).toBe(
        `"${input}" isn't a web address, such as https://dvfr.illinois.gov.`,
      );
    }
  });

  it("refuses an IP address or a local address, saying so", () => {
    for (const input of [
      "http://localhost:3000",
      "127.0.0.1:4848",
      "https://203.0.113.7/",
      "https://[2001:db8::1]/",
    ]) {
      const refusal = refusalOf(input);
      expect(refusal, input).toBeInstanceOf(UsageError);
      expect(errorMessage(refusal), input).toBe(
        `"${input}" is an IP address or a local address, not a site's name; give the address people visit, such as https://dvfr.illinois.gov.`,
      );
    }
  });
});

describe("recordedCanonical", () => {
  it("gives the root a record names, as normalizeCanonical has it", () => {
    expect(recordedCanonical(demoRoot)).toBe(demoRoot);
    expect(recordedCanonical("https://dvfr.illinois.gov")).toBe("https://dvfr.illinois.gov/");
  });

  // A record is data, which something other than voicecap may have written: what isn't a site's
  // name names nothing, and never throws.
  it("gives null for a record that isn't a site's name", () => {
    for (const recorded of [
      "http://127.0.0.1:4848/",
      "http://localhost:3000/",
      "http://[::1]:4848/",
      "javascript:alert(1)",
      "ftp://dvfr.illinois.gov/",
      "not an address",
      "",
    ]) {
      expect(recordedCanonical(recorded), recorded).toBeNull();
    }
  });

  it("gives null for a record that isn't text, or isn't there", () => {
    for (const recorded of [undefined, null, 42, true, {}, ["https://dvfr.illinois.gov/"]]) {
      expect(recordedCanonical(recorded), JSON.stringify(recorded)).toBeNull();
    }
  });
});

describe("isWebRoot", () => {
  it("is true for the root of a web site, as a share records it", () => {
    for (const root of [
      "https://dvfr.illinois.gov/",
      demoRoot,
      "https://staging.dvfr.org:8443/",
      "http://dvfr.illinois.gov/",
      "https://xn--bcher-kva.example/",
    ]) {
      expect(isWebRoot(root), root).toBe(true);
    }
  });

  // A share of a site with no canonical address records the address voicecap read, which is no
  // name, but is a root all the same.
  it("is true for the root of an IP address or a local address", () => {
    for (const root of [
      `${demoOrigin}/`,
      "http://localhost:3000/",
      "http://[::1]:4848/",
      "http://203.0.113.7/",
    ]) {
      expect(isWebRoot(root), root).toBe(true);
    }
  });

  it("is false for text that isn't a root as voicecap writes one", () => {
    for (const value of [
      "dvfr.illinois.gov",
      "https://dvfr.illinois.gov",
      "https://dvfr.illinois.gov/about",
      "https://dvfr.illinois.gov/?x=1",
      "https://dvfr.illinois.gov/?",
      "https://dvfr.illinois.gov/#top",
      "https://pat:secret@dvfr.illinois.gov/",
      "HTTPS://Dvfr.Illinois.gov/",
      "https://dvfr.illinois.gov:443/",
      " https://dvfr.illinois.gov/",
      "https://dvfr.illinois.gov/ ",
      "ftp://dvfr.illinois.gov/",
      "file:///C:/records/",
      "javascript:alert(1)",
      "not an address",
      "",
    ]) {
      expect(isWebRoot(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("is false for a record that isn't text, or isn't there", () => {
    for (const value of [undefined, null, 42, true, {}, ["https://dvfr.illinois.gov/"]]) {
      expect(isWebRoot(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe("canonicalRootFrom", () => {
  it("gives the root the home page's tag names, path and all", () => {
    expect(canonicalRootFrom("http://127.0.0.1:4848/", demoRoot)).toBe(demoRoot);
  });

  it("gives the same root from an inner page's tag", () => {
    expect(
      canonicalRootFrom(
        "http://127.0.0.1:4848/before-you-start/",
        "https://voicecap.netlify.app/demo-site/before-you-start/",
      ),
    ).toBe(demoRoot);
  });

  it("gives the site's own root for a copy on localhost", () => {
    expect(
      canonicalRootFrom("http://localhost:3000/grants/", "https://dvfr.illinois.gov/grants/"),
    ).toBe("https://dvfr.illinois.gov/");
  });

  it("gives null for a tag that names another page", () => {
    expect(canonicalRootFrom("http://localhost:3000/a/", "https://x.org/b/")).toBeNull();
  });

  it("gives null for a tag whose last name only ends like the page's", () => {
    expect(canonicalRootFrom("http://localhost:3000/rants/", "https://x.org/grants/")).toBeNull();
  });

  it("gives null for a tag with another scheme", () => {
    expect(canonicalRootFrom("http://localhost:3000/a/", "ftp://x.org/a/")).toBeNull();
    expect(canonicalRootFrom("http://localhost:3000/a/", "javascript:alert(1)")).toBeNull();
  });

  it("gives null with no tag", () => {
    expect(canonicalRootFrom("http://localhost:3000/a/", null)).toBeNull();
  });

  it("gives null for a tag that doesn't parse as an address", () => {
    expect(canonicalRootFrom("http://localhost:3000/a/", "not a url")).toBeNull();
    expect(canonicalRootFrom("http://localhost:3000/a/", "/a/")).toBeNull();
  });

  it("ignores the tag's query and hash", () => {
    expect(canonicalRootFrom("http://localhost:3000/a/", "https://x.org/a/?utm=1")).toBe(
      "https://x.org/",
    );
    expect(canonicalRootFrom("http://localhost:3000/a/", "https://x.org/a/#top")).toBe(
      "https://x.org/",
    );
  });

  it("gives null for a tag that names an address on this computer", () => {
    expect(canonicalRootFrom("http://127.0.0.1:4848/", "http://localhost:3000/")).toBeNull();
  });

  it("gives null for a page that isn't a web address", () => {
    // Chromium shows chrome-error://chromewebdata/ for a page that won't load. Its path is "/",
    // which any tag's path ends with.
    expect(canonicalRootFrom("chrome-error://chromewebdata/", "https://x.org/a/b/")).toBeNull();
    expect(canonicalRootFrom("about:blank", "https://x.org/blank")).toBeNull();
    expect(canonicalRootFrom("not a url", "https://x.org/a/")).toBeNull();
  });
});

describe("chooseCanonicalRoot", () => {
  const read = "http://127.0.0.1:4848";
  /** Two roots a copy's pages can name: with and without www. */
  const plain = "https://dvfr.illinois.gov/";
  const www = "https://www.dvfr.illinois.gov/";

  /** A page of the copy that was read, as a run's record has it: where it ended, and its tag. */
  const page = (path: string, canonical: string | null, finalUrl?: string): TaggedPage => ({
    url: `${read}${path}`,
    ...(finalUrl === undefined ? {} : { finalUrl }),
    canonical,
  });

  it("is the address given, whatever the pages' tags say", () => {
    const pages = [page("/", plain), page("/grants/", `${plain}grants/`)];
    expect(chooseCanonicalRoot(pages, "https://given.example/agency/")).toBe(
      "https://given.example/agency/",
    );
    expect(chooseCanonicalRoot([], "https://given.example/")).toBe("https://given.example/");
  });

  it("is the root the home page's tag names when no inner page's tag fits", () => {
    expect(chooseCanonicalRoot([page("/", plain), page("/about/", null)], null)).toBe(plain);
  });

  it("is the root most inner pages' tags name, over a home page tag that names another page", () => {
    // The home page's path ("/") ends any tag's path ending in "/", so its tag fits, whatever it
    // names. The inner pages' tags each end with their own page's path.
    const pages = [
      page("/", `${plain}about/`),
      page("/grants/", `${plain}grants/`),
      page("/news/", `${plain}news/`),
      page("/about/", `${www}about/`),
    ];
    expect(chooseCanonicalRoot(pages, null)).toBe(plain);
  });

  it("is the first inner page's root when inner pages tie, whatever the home page names", () => {
    const grants = page("/grants/", `${plain}grants/`);
    const news = page("/news/", `${www}news/`);
    expect(chooseCanonicalRoot([page("/", www), grants, news], null)).toBe(plain);
    expect(chooseCanonicalRoot([page("/", plain), news, grants], null)).toBe(www);
  });

  it("is the root the pages' tags name for a path that isn't the home page's", () => {
    // A site on a path: its pages' tags end with their own paths, and the root is what's before.
    const pages = [page("/a/", "https://x.org/agency/a/"), page("/b/", "https://x.org/agency/b/")];
    expect(chooseCanonicalRoot(pages, null)).toBe("https://x.org/agency/");
  });

  it("counts http and https, and www and not, as different roots", () => {
    const pages = [
      page("/a/", `${www}a/`),
      page("/b/", "http://dvfr.illinois.gov/b/"),
      page("/c/", `${plain}c/`),
      page("/d/", `${plain}d/`),
    ];
    expect(chooseCanonicalRoot(pages, null)).toBe(plain);
  });

  it.each([
    ["another page", "https://dvfr.illinois.gov/news/"],
    ["a page of another site", "https://other.example.org/news/"],
    ["this copy's own address", `${read}/grants/`],
    ["an address that isn't http or https", "ftp://dvfr.illinois.gov/grants/"],
    ["something that isn't an address", "grants"],
  ])("ignores an inner page's tag that names %s", (_what, tag) => {
    expect(chooseCanonicalRoot([page("/", null), page("/grants/", tag)], null)).toBeNull();
  });

  it("ignores a home page's tag that is this copy's own address, or isn't a web address", () => {
    for (const tag of [`${read}/`, "ftp://dvfr.illinois.gov/", "not an address"]) {
      expect(chooseCanonicalRoot([page("/", tag)], null), tag).toBeNull();
    }
  });

  it("reads a page at the address it ended at", () => {
    // The tag ends with the address the page ended at, not the one the run asked for.
    expect(chooseCanonicalRoot([page("/about", `${plain}about/`, `${read}/about/`)], null)).toBe(
      plain,
    );
    expect(chooseCanonicalRoot([page("/about", `${plain}about/`)], null)).toBeNull();
  });

  it("takes a page that ended at the home page for the home page", () => {
    // Inner pages decide first, so a page that ended at "/" can't outvote them.
    const pages = [page("/index.html", plain, `${read}/`), page("/grants/", `${www}grants/`)];
    expect(chooseCanonicalRoot(pages, null)).toBe(www);
    expect(chooseCanonicalRoot([pages[0]!], null)).toBe(plain);
  });

  it("takes a home page with a query for the home page", () => {
    const pages = [page("/?lang=es", plain), page("/grants/", `${www}grants/`)];
    expect(chooseCanonicalRoot(pages, null)).toBe(www);
    expect(chooseCanonicalRoot([pages[0]!], null)).toBe(plain);
  });

  it("takes the first home page whose tag fits when there's no inner page", () => {
    const pages = [page("/", "not an address"), page("/?lang=es", www), page("/?lang=fr", plain)];
    expect(chooseCanonicalRoot(pages, null)).toBe(www);
  });

  it("takes a page with no tag, and one never read, as having none", () => {
    const neverRead: TaggedPage = { url: `${read}/grants/` };
    expect(chooseCanonicalRoot([neverRead, page("/news/", null)], null)).toBeNull();
    expect(chooseCanonicalRoot([neverRead, page("/", plain)], null)).toBe(plain);
  });

  it("is null when no page names a root, and for no pages", () => {
    expect(chooseCanonicalRoot([page("/", null), page("/about/", null)], null)).toBeNull();
    expect(chooseCanonicalRoot([], null)).toBeNull();
  });
});

describe("toCanonical", () => {
  it("maps the home page of the copy that was read to the root itself", () => {
    expect(toCanonical("http://127.0.0.1:4848/", demoOrigin, demoRoot)).toBe(demoRoot);
  });

  it("keeps a page's path and query on the root, and drops its hash", () => {
    expect(
      toCanonical("http://127.0.0.1:4848/before-you-start/?q=1#top", demoOrigin, demoRoot),
    ).toBe("https://voicecap.netlify.app/demo-site/before-you-start/?q=1");
  });

  it("leaves an address on another origin as it was", () => {
    expect(toCanonical("https://elsewhere.org/x", demoOrigin, demoRoot)).toBe(
      "https://elsewhere.org/x",
    );
  });

  it("leaves every address as it was with no root", () => {
    expect(toCanonical("http://127.0.0.1:4848/a/#top", demoOrigin, null)).toBe(
      "http://127.0.0.1:4848/a/#top",
    );
    expect(toCanonical("https://elsewhere.org/x", demoOrigin, null)).toBe(
      "https://elsewhere.org/x",
    );
  });

  it("leaves text that isn't an address as it was", () => {
    expect(toCanonical("not a url", demoOrigin, demoRoot)).toBe("not a url");
  });

  it("takes the read origin with a trailing slash too", () => {
    expect(toCanonical("http://127.0.0.1:4848/a/", `${demoOrigin}/`, demoRoot)).toBe(
      "https://voicecap.netlify.app/demo-site/a/",
    );
  });
});

describe("canonicalName", () => {
  it("is a plain host", () => {
    expect(canonicalName(demoRoot)).toBe("voicecap.netlify.app");
  });

  it("keeps a port", () => {
    expect(canonicalName("https://example.org:8443/")).toBe("example.org:8443");
  });
});

describe("isLocalHost", () => {
  it("is true for localhost, its subdomains, and IP addresses", () => {
    for (const host of [
      "localhost",
      "app.localhost",
      "127.0.0.1",
      "10.0.0.5",
      "192.168.1.10",
      "[::1]",
      "::1",
    ]) {
      expect(isLocalHost(host), host).toBe(true);
    }
  });

  it("is false for the names people visit", () => {
    for (const host of ["dvfr.illinois.gov", "voicecap.netlify.app", "localhost.example.org"]) {
      expect(isLocalHost(host), host).toBe(false);
    }
  });

  it("is true for any IP address, public or not", () => {
    for (const host of ["203.0.113.7", "0.0.0.0", "[2001:db8::1]", "2001:db8::1"]) {
      expect(isLocalHost(host), host).toBe(true);
    }
  });

  it("allows for a port, an upper-case name, and a trailing dot", () => {
    for (const host of [
      "localhost:3000",
      "127.0.0.1:4848",
      "[::1]:3000",
      "LOCALHOST",
      "localhost.",
    ]) {
      expect(isLocalHost(host), host).toBe(true);
    }
    expect(isLocalHost("dvfr.illinois.gov:8443")).toBe(false);
  });

  it("reads an IPv4 address written the short way as the address it is", () => {
    for (const host of ["127.1", "2130706433"]) {
      expect(isLocalHost(host), host).toBe(true);
    }
  });

  it("is false for a name that only looks like an IPv4 address", () => {
    for (const host of ["256.0.0.1", "10.0.0.5.example.org"]) {
      expect(isLocalHost(host), host).toBe(false);
    }
  });

  it("is false for nothing at all", () => {
    expect(isLocalHost("")).toBe(false);
  });
});

describe("readLocation", () => {
  it("is same when the run read the canonical site itself", () => {
    expect(readLocation("https://dvfr.illinois.gov", "https://dvfr.illinois.gov/")).toBe("same");
    expect(readLocation("https://voicecap.netlify.app", demoRoot)).toBe("same");
  });

  it("is local for a copy on this computer", () => {
    expect(readLocation("http://127.0.0.1:4848", demoRoot)).toBe("local");
  });

  it("is elsewhere for a copy at another address", () => {
    expect(readLocation("https://staging.example.org", "https://dvfr.illinois.gov/")).toBe(
      "elsewhere",
    );
  });

  it("is elsewhere for a read origin that isn't an address", () => {
    expect(readLocation("not a url", "https://dvfr.illinois.gov/")).toBe("elsewhere");
  });
});
