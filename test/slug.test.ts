import { describe, expect, it } from "vitest";

import { isWindowsReservedName, pageSlug } from "../src/pages/slug.js";
import { canonicalKey } from "../src/pages/url.js";

const SAFE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("pageSlug", () => {
  it('names the home page "home"', () => {
    expect(pageSlug(canonicalKey("https://example.illinois.gov/"))).toBe("home");
    expect(pageSlug(canonicalKey("http://127.0.0.1:4747"))).toBe("home");
  });

  it("combines a readable part of the path with a short hash", () => {
    const slug = pageSlug(canonicalKey("https://example.illinois.gov/grants/fy27-jag"));
    expect(slug).toMatch(/^grants-fy27-jag-[0-9a-f]{10}$/);
  });

  it("is deterministic", () => {
    const key = canonicalKey("https://example.illinois.gov/news/2026/budget");
    expect(pageSlug(key)).toBe(pageSlug(key));
  });

  it("gives /about and /about/ the same slug, via the canonical URL", () => {
    expect(pageSlug(canonicalKey("https://a.gov/about"))).toBe(
      pageSlug(canonicalKey("https://a.gov/about/")),
    );
  });

  it("is unique per canonical URL, including query strings and case", () => {
    const keys = [
      "https://a.gov/news",
      "https://a.gov/news?page=2",
      "https://a.gov/News",
      "https://a.gov/?lang=es",
      "https://b.gov/news",
    ].map((url) => canonicalKey(url));
    const slugs = keys.map((key) => pageSlug(key));
    expect(new Set(slugs).size).toBe(keys.length);
    expect(pageSlug(canonicalKey("https://a.gov/?lang=es"))).toMatch(/^home-[0-9a-f]{10}$/);
  });

  it("uses only characters that are safe in Windows file names", () => {
    const urls = [
      "https://a.gov/Some Page/with:colons*and?query=1",
      "https://a.gov/a<b>c|d\"e'f",
      "https://a.gov/caf%C3%A9/r%C3%A9sum%C3%A9",
      "https://a.gov/trailing./dots...",
      "https://a.gov/%E4%B8%AD%E6%96%87",
      "https://a.gov/%ZZ-bad-encoding",
    ];
    for (const url of urls) {
      const slug = pageSlug(canonicalKey(url));
      expect(slug, url).toMatch(SAFE);
      expect(isWindowsReservedName(slug)).toBe(false);
    }
    expect(pageSlug(canonicalKey("https://a.gov/caf%C3%A9"))).toMatch(/^cafe-[0-9a-f]{10}$/);
  });

  it("stays short enough to avoid path-length problems", () => {
    const long = `https://a.gov/${"very-long-segment/".repeat(20)}end`;
    const slug = pageSlug(canonicalKey(long));
    expect(slug.length).toBeLessThanOrEqual(51);
    expect(slug).toMatch(SAFE);
  });

  it("never produces a reserved Windows name", () => {
    for (const name of ["con", "prn", "aux", "nul", "com1", "lpt9"]) {
      const slug = pageSlug(canonicalKey(`https://a.gov/${name}`));
      expect(slug).toMatch(new RegExp(`^${name}-[0-9a-f]{10}$`));
      expect(isWindowsReservedName(slug)).toBe(false);
    }
  });
});

describe("isWindowsReservedName", () => {
  it("matches reserved device names with or without an extension, in any case", () => {
    for (const name of ["CON", "con", "Nul", "nul.txt", "COM1", "lpt3.json", "com¹"]) {
      expect(isWindowsReservedName(name), name).toBe(true);
    }
    for (const name of ["home", "console", "con-1a2b3c4d5e", "nullable", "com10x"]) {
      expect(isWindowsReservedName(name), name).toBe(false);
    }
  });
});
