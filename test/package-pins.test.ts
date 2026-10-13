import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** A file of this repository, read as text. */
function repositoryFile(...names: string[]): string {
  return readFileSync(new URL(`../${names.join("/")}`, import.meta.url), "utf8");
}

const pkg = JSON.parse(repositoryFile("package.json")) as {
  files: string[];
  dependencies: Record<string, string>;
  publishConfig: Record<string, string>;
};

// A release names the packages it needs by one version each, and the workflow that checks it runs
// each action at one commit. A range ("^1.2.3") or a moving tag ("v4") would let a newer one in
// the next time someone installs or CI runs.
describe("the pins", () => {
  it("name every dependency of the package by one exact version", () => {
    const names = Object.keys(pkg.dependencies);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(pkg.dependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("send a publish to the npm registry, whatever registry the person publishing has set", () => {
    expect(pkg.publishConfig.registry).toBe("https://registry.npmjs.org/");
    expect(pkg.publishConfig.access).toBe("public");
  });

  // publish.sh makes npm-shrinkwrap.json at release, and npm packs a file in the package's folder
  // only if `files` names it (without a `files` list it would, but this package has one).
  it("let npm pack the lock that publish.sh makes at each release", () => {
    expect(pkg.files).toContain("npm-shrinkwrap.json");
  });

  it("run each action of the CI workflow at one commit, with its tag in a comment", () => {
    const uses = repositoryFile(".github", "workflows", "ci.yml")
      .split("\n")
      .filter((line) => /^\s*(?:-\s+)?uses:/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(/^\s*(?:-\s+)?uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+(?:\.\d+)*$/);
    }
  });
});
