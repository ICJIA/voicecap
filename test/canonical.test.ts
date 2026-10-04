import { describe, expect, it } from "vitest";

import {
  canonicalName,
  canonicalRootFrom,
  isLocalHost,
  normalizeCanonical,
  readLocation,
  toCanonical,
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

  it("refuses an address on this computer, saying so", () => {
    for (const input of ["http://localhost:3000", "127.0.0.1:4848"]) {
      const refusal = refusalOf(input);
      expect(refusal, input).toBeInstanceOf(UsageError);
      expect(errorMessage(refusal), input).toBe(
        `"${input}" is an address on this computer; give the address people visit, such as https://dvfr.illinois.gov.`,
      );
    }
  });

  it("refuses an IP address, public or not", () => {
    expect(() => normalizeCanonical("https://203.0.113.7/")).toThrow(UsageError);
    expect(() => normalizeCanonical("https://[2001:db8::1]/")).toThrow(UsageError);
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
