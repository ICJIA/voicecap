/**
 * netlify.toml and .nvmrc, which `voicecap site` writes into the transcripts home once and never
 * writes over. Each test that writes has a home of its own, new and empty.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureNetlifyFiles, netlifyToml, NVMRC } from "../src/site/netlify.js";

/** netlify.toml as Netlify reads it, with `version` as the exact release its build command names. */
const tomlFor = (
  version: string,
) => `# Written by voicecap site, once: voicecap never changes it. Netlify builds the website with it on every push.
# Change the version in the command after each release, a patch included.
[build]
  command = "npx --yes @icjia/voicecap@${version} site --home . --out _site"
  publish = "_site"

[build.environment]
  # No package's install script runs in the build.
  NPM_CONFIG_IGNORE_SCRIPTS = "true"

[[headers]]
  for = "/*"
  [headers.values]
    X-Robots-Tag = "noindex, nofollow, noarchive"
    Referrer-Policy = "no-referrer"
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "DENY"
    Permissions-Policy = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    Strict-Transport-Security = "max-age=63072000; includeSubDomains"
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Resource-Policy = "same-origin"
`;

/** The lines of one table of netlify.toml: after its header, up to the blank line that ends it. */
function tableOf(toml: string, header: string): string[] {
  const lines = toml.split("\n");
  const start = lines.indexOf(header);
  if (start === -1) throw new Error(`netlify.toml has no ${header}.`);
  const table = lines.slice(start + 1);
  const end = table.indexOf("");
  return end === -1 ? table : table.slice(0, end);
}

describe("netlifyToml", () => {
  it("builds with the exact version that wrote it, and nothing newer", () => {
    expect(netlifyToml("0.18.0")).toBe(tomlFor("0.18.0"));
    expect(netlifyToml("1.2.3-beta.1")).toBe(tomlFor("1.2.3-beta.1"));
    expect(netlifyToml("10.20.30")).toBe(tomlFor("10.20.30"));
    // A patch release is another version, and the command names it: the owner changes the version
    // after each release, a patch included.
    expect(netlifyToml("0.18.1")).toBe(tomlFor("0.18.1"));
    expect(netlifyToml("0.18.1")).not.toContain("@icjia/voicecap@0.18.0");
  });

  it("tells the owner, in its second comment line, to change the version after each release", () => {
    expect(netlifyToml("0.18.0").split("\n").slice(0, 2)).toEqual([
      "# Written by voicecap site, once: voicecap never changes it. Netlify builds the website with it on every push.",
      "# Change the version in the command after each release, a patch included.",
    ]);
  });

  it("turns npm's install scripts off in the build, in a table of its own after [build]", () => {
    const toml = netlifyToml("0.18.0");

    const tables = toml
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("["));
    expect(tables).toEqual(["[build]", "[build.environment]", "[[headers]]", "[headers.values]"]);
    expect(tableOf(toml, "[build.environment]")).toEqual([
      "  # No package's install script runs in the build.",
      '  NPM_CONFIG_IGNORE_SCRIPTS = "true"',
    ]);
    // The command and the folder to publish stay in [build], above it.
    expect(tableOf(toml, "[build]")).toEqual([
      '  command = "npx --yes @icjia/voicecap@0.18.0 site --home . --out _site"',
      '  publish = "_site"',
    ]);
  });

  it.each([
    "0.9",
    "",
    "v0.9.0",
    "latest",
    "0",
    ".9.0",
    "0.x.1",
    "0.9.x",
    "^0.9.0",
    "0.9.0-",
    // Nothing but a version can reach the command, which Netlify runs in a shell.
    "0.9.0 ",
    "0.9.0\n",
    "0.9.0 --yes",
    '0.9.0" --evil "',
    "0.9.0;exit",
  ])("refuses %j, which isn't three numbers like 1.2.3", (version) => {
    expect(() => netlifyToml(version)).toThrow("isn't three numbers like 1.2.3");
  });
});

describe("NVMRC", () => {
  it("names the Node version Netlify builds with, and ends with a line break", () => {
    expect(NVMRC).toBe("24\n");
  });
});

describe("ensureNetlifyFiles", () => {
  /** The transcripts home: new for each test, and empty. */
  let home: string;
  const tomlFile = () => path.join(home, "netlify.toml");
  const nvmrcFile = () => path.join(home, ".nvmrc");

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "voicecap-site-netlify-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("writes netlify.toml and .nvmrc into a home that has neither, and says which", async () => {
    expect(await ensureNetlifyFiles(home, "0.9.0")).toEqual(["netlify.toml", ".nvmrc"]);

    expect(await readFile(tomlFile(), "utf8")).toBe(tomlFor("0.9.0"));
    expect(await readFile(nvmrcFile(), "utf8")).toBe("24\n");
  });

  it("never writes over either file", async () => {
    const own = '[build]\n  command = "my own build"\n';
    await writeFile(tomlFile(), own);

    expect(await ensureNetlifyFiles(home, "0.9.0")).toEqual([".nvmrc"]);
    expect(await readFile(tomlFile(), "utf8")).toBe(own);
    expect(await readFile(nvmrcFile(), "utf8")).toBe("24\n");

    // Both are there now. A later build, by a newer voicecap, leaves both as they are.
    await writeFile(nvmrcFile(), "22\n");

    expect(await ensureNetlifyFiles(home, "0.10.0")).toEqual([]);
    expect(await readFile(tomlFile(), "utf8")).toBe(own);
    expect(await readFile(nvmrcFile(), "utf8")).toBe("22\n");
  });

  it("writes netlify.toml when only .nvmrc is there", async () => {
    await writeFile(nvmrcFile(), "22\n");

    expect(await ensureNetlifyFiles(home, "0.9.0")).toEqual(["netlify.toml"]);
    expect(await readFile(tomlFile(), "utf8")).toBe(tomlFor("0.9.0"));
    expect(await readFile(nvmrcFile(), "utf8")).toBe("22\n");
  });

  it.each(["latest", "0.9"])(
    "writes neither file when the version is %j, which isn't three numbers",
    async (version) => {
      await expect(ensureNetlifyFiles(home, version)).rejects.toThrow(
        "isn't three numbers like 1.2.3",
      );

      expect(await readdir(home)).toEqual([]);
    },
  );
});
