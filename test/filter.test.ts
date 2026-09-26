import { describe, expect, it } from "vitest";

import { applyFilters, compilePattern } from "../src/pages/filter.js";
import { UsageError } from "../src/util/errors.js";

const url = (path: string) => new URL(`https://example.illinois.gov${path}`);
const matches = (pattern: string, path: string) => compilePattern(pattern)(url(path));

describe("compilePattern: globs", () => {
  it("matches the path with or without a leading slash on the pattern", () => {
    for (const pattern of ["/news/*", "news/*", "//news/*"]) {
      expect(matches(pattern, "/news/budget-2027"), pattern).toBe(true);
      expect(matches(pattern, "/news/2026/budget"), pattern).toBe(false);
      expect(matches(pattern, "/grants/budget"), pattern).toBe(false);
    }
  });

  it("ignores the path's trailing slash", () => {
    expect(matches("news/*", "/news/budget/")).toBe(true);
    expect(matches("about", "/about/")).toBe(true);
    // A listing page isn't "inside" its folder; ** covers both.
    expect(matches("news/*", "/news/")).toBe(false);
    expect(matches("news/**", "/news/")).toBe(true);
    expect(matches("news/**", "/news/2026/budget")).toBe(true);
  });

  it('treats "/" as the home page and ignores a trailing slash on the pattern', () => {
    expect(matches("/", "/")).toBe(true);
    expect(matches("/", "/about")).toBe(false);
    expect(matches("/news/", "/news")).toBe(true);
    expect(matches("**", "/")).toBe(true);
    expect(matches("*", "/")).toBe(false);
  });

  it("matches percent-decoded paths and ignores query strings", () => {
    expect(matches("café/*", "/caf%C3%A9/menu")).toBe(true);
    expect(matches("news/*", "/news/story?page=2")).toBe(true);
  });

  it("supports braces and character classes", () => {
    expect(matches("{news,grants}/**", "/grants/fy27")).toBe(true);
    expect(matches("reports/202[0-9]/*", "/reports/2026/q1")).toBe(true);
  });
});

describe("compilePattern: regular expressions", () => {
  it("tests the path plus query string", () => {
    expect(matches("re:\\?page=\\d+$", "/news?page=2")).toBe(true);
    expect(matches("re:\\?page=\\d+$", "/news")).toBe(false);
  });

  it("works with or without a leading slash", () => {
    expect(matches("re:^/grants/", "/grants/fy27-jag")).toBe(true);
    expect(matches("re:^grants/", "/grants/fy27-jag")).toBe(true);
    expect(matches("re:^grants/", "/other/grants/x")).toBe(false);
  });

  it("rejects an invalid regular expression", () => {
    expect(() => compilePattern("re:news/(")).toThrow(UsageError);
    expect(() => compilePattern("re:news/(")).toThrow(/Invalid regular expression/);
  });

  it("rejects empty patterns", () => {
    expect(() => compilePattern("")).toThrow(/empty/);
    expect(() => compilePattern("re:")).toThrow(/empty/);
  });
});

describe("applyFilters", () => {
  const items = [
    "/",
    "/news/a",
    "/news/b",
    "/news/archive/old",
    "/grants/fy27",
    "/grants/fy26",
    "/about",
  ].map((path) => ({ url: url(path).href }));

  it("keeps everything with no options", () => {
    expect(applyFilters(items, {})).toEqual({
      kept: items,
      excludedByFilter: 0,
      excludedByLimit: 0,
    });
  });

  it("applies include, then exclude, then limit", () => {
    const result = applyFilters(items, {
      include: ["news/**", "grants/*"],
      exclude: ["news/archive/**", "re:fy26$"],
      limit: 2,
    });
    expect(result.kept.map((i) => new URL(i.url).pathname)).toEqual(["/news/a", "/news/b"]);
    // Kept by include: 5; minus 2 excluded -> 3 remaining; limit keeps 2.
    expect(result.excludedByFilter).toBe(4);
    expect(result.excludedByLimit).toBe(1);
  });

  it("keeps an item when any include pattern matches", () => {
    const result = applyFilters(items, { include: ["about", "re:^/$"] });
    expect(result.kept.map((i) => new URL(i.url).pathname)).toEqual(["/", "/about"]);
  });

  it("applies the limit after filtering", () => {
    const result = applyFilters(items, { exclude: ["/"], limit: 1 });
    expect(result.kept.map((i) => new URL(i.url).pathname)).toEqual(["/news/a"]);
    expect(result.excludedByLimit).toBe(5);
  });

  it("accepts URL objects", () => {
    const result = applyFilters([{ url: url("/a") }, { url: url("/b") }], { exclude: ["a"] });
    expect(result.kept).toHaveLength(1);
  });
});
