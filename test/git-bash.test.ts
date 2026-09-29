import path from "node:path";

import { describe, expect, it } from "vitest";

import { assertNotRewritten, fromGitBash, resolveUserPath } from "../src/util/git-bash.js";

describe("fromGitBash", () => {
  it("reads a Windows path written Git Bash's way as that path, on Windows", () => {
    expect(fromGitBash("/c/Users/me/vt", "win32")).toBe("C:/Users/me/vt");
    expect(fromGitBash("/D/work/", "win32")).toBe("D:/work/");
    expect(fromGitBash("/d", "win32")).toBe("D:/");
  });

  it("leaves every other path alone, and every path off Windows", () => {
    const others = [
      "C:/Users/me",
      "C:\\Users\\me",
      "vt",
      "./vt",
      "/tmp/vt",
      "/cd/vt",
      "//server/x",
    ];
    for (const value of others) expect(fromGitBash(value, "win32")).toBe(value);
    expect(fromGitBash("/c/Users/me", "darwin")).toBe("/c/Users/me");
    expect(fromGitBash("/c/Users/me", "linux")).toBe("/c/Users/me");
  });
});

describe("resolveUserPath", () => {
  it("resolves a path against the folder, reading Git Bash's form first", () => {
    const cwd = path.resolve("/work");
    expect(resolveUserPath(cwd, "vt", "win32")).toBe(path.resolve(cwd, "vt"));
    expect(resolveUserPath(cwd, "/c/vt", "win32")).toBe(path.resolve(cwd, "C:/vt"));
    expect(resolveUserPath(cwd, "/c/vt", "linux")).toBe(path.resolve(cwd, "/c/vt"));
  });
});

describe("assertNotRewritten", () => {
  it("leaves URLs, paths, names, and patterns alone", () => {
    for (const value of ["https://dvfr.illinois.gov/about/", "/about", "sitemap.xml", "news/*"]) {
      expect(() => assertNotRewritten("--sitemap", value)).not.toThrow();
    }
  });

  it("explains a --page Git Bash rewrote, with a full URL or MSYS_NO_PATHCONV=1 as the fix", () => {
    expect(() => assertNotRewritten("--page", "C:/Program Files/Git/about")).toThrow(
      [
        `--page "C:/Program Files/Git/about" looks like a Windows path, not a URL.`,
        `Git Bash rewrote it: arguments that begin with "/" are turned into Windows paths (for example /about becomes C:/Program Files/Git/about).`,
        "To fix it, use a full URL (https://dvfr.illinois.gov/about/), leave off the leading slash in",
        "patterns (--include 'news/*'), or turn the rewriting off with MSYS_NO_PATHCONV=1, e.g.",
        "  MSYS_NO_PATHCONV=1 npx @icjia/voicecap --page /about ...",
      ].join("\n"),
    );
  });

  it("suggests a --sitemap's name without the slash, a full URL, or MSYS_NO_PATHCONV=1", () => {
    expect(() => assertNotRewritten("--sitemap", "D:/sites/sitemap.xml")).toThrow(
      [
        `--sitemap "D:/sites/sitemap.xml" looks like a Windows path, not a URL.`,
        `If you're using Git Bash, it rewrites arguments that begin with "/" into Windows paths (for example /sitemap.xml becomes C:/Program Files/Git/sitemap.xml).`,
        "To fix it, leave off the leading slash (--sitemap sitemap.xml), use a full URL",
        "(https://dvfr.illinois.gov/sitemap.xml), or turn the rewriting off with MSYS_NO_PATHCONV=1, e.g.",
        "  MSYS_NO_PATHCONV=1 npx @icjia/voicecap --sitemap /sitemap.xml ...",
      ].join("\n"),
    );
  });
});
