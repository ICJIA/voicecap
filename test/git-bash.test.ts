import path from "node:path";

import { describe, expect, it } from "vitest";

import { fromGitBash, resolveUserPath } from "../src/util/git-bash.js";

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
