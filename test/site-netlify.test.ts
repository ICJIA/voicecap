/**
 * netlify.toml and .nvmrc, which `voicecap site` writes into the transcripts home once and never
 * writes over. Each test that writes has a home of its own, new and empty.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureNetlifyFiles, netlifyToml, NVMRC } from "../src/site/netlify.js";

/** netlify.toml as Netlify reads it, with `minor` as the version its build command names. */
const tomlFor = (
  minor: string,
) => `# Written by voicecap site, once: voicecap never changes it. Netlify builds the website with it on every push.
# To build with a newer voicecap, change the version in the command.
[build]
  command = "npx --yes @icjia/voicecap@${minor} site --home . --out _site"
  publish = "_site"

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

describe("netlifyToml", () => {
  it("builds with the minor version that wrote it", () => {
    expect(netlifyToml("0.9.0")).toBe(tomlFor("0.9"));
    expect(netlifyToml("0.9.7")).toBe(tomlFor("0.9"));
    expect(netlifyToml("0.9")).toBe(tomlFor("0.9"));
    expect(netlifyToml("1.2.3-beta.1")).toBe(tomlFor("1.2"));
    expect(netlifyToml("10.20.30")).toBe(tomlFor("10.20"));
  });

  it.each(["", "0", "v0.9.0", "latest", ".9.0", "0.x.1", "x.9.0"])(
    "refuses %j, which doesn't start with two numbers",
    (version) => {
      expect(() => netlifyToml(version)).toThrow("doesn't start with two numbers");
    },
  );
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

    expect(await readFile(tomlFile(), "utf8")).toBe(tomlFor("0.9"));
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
    expect(await readFile(tomlFile(), "utf8")).toBe(tomlFor("0.9"));
    expect(await readFile(nvmrcFile(), "utf8")).toBe("22\n");
  });

  it("writes neither file when the version doesn't start with two numbers", async () => {
    await expect(ensureNetlifyFiles(home, "latest")).rejects.toThrow(
      "doesn't start with two numbers",
    );

    expect(await readdir(home)).toEqual([]);
  });
});
