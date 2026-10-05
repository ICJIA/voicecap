import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { defaultConfig, defineConfig, loadConfig, resolveConfig } from "../src/config/load.js";
import { hashJson } from "../src/util/hash.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "voicecap-config-"));

describe("loadConfig", () => {
  it("uses the defaults when there's no config file", async () => {
    const loaded = await loadConfig({ cwd: await tmp() });
    expect(loaded.file).toBeNull();
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  // voicecap demo's settings, whatever config file the current folder has.
  it("gives voicecap's own settings with no file, as loadConfig does in a folder without one", async () => {
    expect(defaultConfig()).toEqual(await loadConfig({ cwd: await tmp() }));
  });

  it.each([
    // TypeScript syntax, to prove the .ts config is transpiled.
    [
      "voicecap.config.ts",
      'export default { reviewer: "TS Reviewer" } satisfies Record<string, unknown>;\n',
    ],
    ["voicecap.config.mts", 'export default { reviewer: "TS Reviewer" };\n'],
    ["voicecap.config.js", 'export default { reviewer: "TS Reviewer" };\n'],
    ["voicecap.config.mjs", 'export default { reviewer: "TS Reviewer" };\n'],
    ["voicecap.config.json", '\uFEFF{ "reviewer": "TS Reviewer" }\n'],
  ])("loads %s", async (name, source) => {
    const dir = await tmp();
    await writeFile(path.join(dir, name), source);
    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.file).toBe(path.join(dir, name));
    expect(loaded.config.reviewer).toBe("TS Reviewer");
    expect(loaded.config.passes).toEqual(DEFAULT_CONFIG.passes);
  });

  it("lets a config import defineConfig from @icjia/voicecap with no node_modules (npx)", async () => {
    const dir = await tmp();
    await writeFile(
      path.join(dir, "voicecap.config.ts"),
      'import { defineConfig } from "@icjia/voicecap";\nexport default defineConfig({ reviewer: "Alias Test" });\n',
    );
    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.config.reviewer).toBe("Alias Test");
  });

  it("merges nested settings over the defaults, replacing arrays", () => {
    const config = resolveConfig({
      stepCaps: { read: 100 },
      passes: ["read"],
      flags: { genericLinkText: { minCount: 5 } },
    });
    expect(config.stepCaps).toEqual({ ...DEFAULT_CONFIG.stepCaps, read: 100 });
    expect(config.passes).toEqual(["read"]);
    expect(config.flags.genericLinkText.minCount).toBe(5);
    expect(config.flags.genericLinkText.phrases).toEqual(
      DEFAULT_CONFIG.flags.genericLinkText.phrases,
    );
  });

  it("reports invalid settings with their paths", () => {
    const invalid = () => resolveConfig({ stepCaps: { read: -1 }, capture: "everything" });
    expect(invalid).toThrow(/- stepCaps\.read: /);
    expect(invalid).toThrow(/- capture: /);
    expect(() =>
      resolveConfig({
        flags: {
          custom: [{ id: "x", description: "d", passes: ["read"], pattern: "(", minCount: 1 }],
        },
      }),
    ).toThrow(/valid regular expression/);
    expect(() => resolveConfig({ report: { logo: "https://example.com/logo.png" } })).toThrow(
      /data:image/,
    );
  });

  it("reads the site's name from report.siteName", () => {
    expect(DEFAULT_CONFIG.report.siteName).toBeNull();
    expect(resolveConfig({}).report.siteName).toBeNull();
    expect(
      resolveConfig({ report: { siteName: "Illinois Criminal Justice Information Authority" } })
        .report.siteName,
    ).toBe("Illinois Criminal Justice Information Authority");
    expect(() => resolveConfig({ report: { siteName: "" } })).toThrow(/- report\.siteName: /);
  });

  it("reads the site's canonical address from report.canonical, as the root people visit", () => {
    expect(DEFAULT_CONFIG.report.canonical).toBeNull();
    expect(resolveConfig({}).report.canonical).toBeNull();
    const root = (canonical: string) => resolveConfig({ report: { canonical } }).report.canonical;
    expect(root("https://dvfr.illinois.gov/")).toBe("https://dvfr.illinois.gov/");
    // Written the short way, or without its closing slash, or with more than a root: the root.
    expect(root("dvfr.illinois.gov")).toBe("https://dvfr.illinois.gov/");
    expect(root("https://voicecap.netlify.app/demo-site")).toBe(
      "https://voicecap.netlify.app/demo-site/",
    );
    expect(root("https://dvfr.illinois.gov/about/?x=1#top")).toBe(
      "https://dvfr.illinois.gov/about/",
    );
  });

  it("names report.canonical when it isn't a site's name: not an address, an IP address, or a local address", () => {
    for (const canonical of [
      "",
      "not an address",
      "ftp://dvfr.illinois.gov/",
      "http://127.0.0.1:4848",
      "localhost:3000",
      "http://[::1]:4848/",
    ]) {
      expect(() => resolveConfig({ report: { canonical } }), canonical).toThrow(
        /- report\.canonical: /,
      );
    }
    expect(() => resolveConfig({ report: { canonical: "http://127.0.0.1:4848" } })).toThrow(
      /is an IP address or a local address, not a site's name/,
    );
  });

  it("rejects unknown keys, to catch typos", () => {
    expect(() => resolveConfig({ stepcaps: { read: 5 } })).toThrow(/stepcaps|Unrecognized/);
  });

  it("refuses to guess between two config files", async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, "voicecap.config.json"), "{}");
    await writeFile(path.join(dir, "voicecap.config.mjs"), "export default {};");
    await expect(loadConfig({ cwd: dir })).rejects.toThrow(/more than one config file/);
  });

  it("explains a config that fails to load", async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, "voicecap.config.json"), "{ not json");
    await expect(loadConfig({ cwd: dir })).rejects.toThrow(/Could not load/);
  });

  it("hashes the effective config, so any change is visible", () => {
    expect(defineConfig({ reviewer: "x" })).toEqual({ reviewer: "x" });
  });
});

// Ruling P19. Every run records the config's SHA-256, and a comparison says "The voicecap config
// differs" when two runs' differ. 0.10.0 adds report.canonical, null by default: a config that leaves
// it null hashes as it did in 0.9.x, so comparing runs across the upgrade adds no such line.
describe("the config's SHA-256", () => {
  /** The default config's SHA-256 in voicecap 0.9.x, computed with the code at 983f6b8. */
  const DEFAULT_SHA256_0_9 = "1c9a00546562af9ea16f3010aa2162b17dcb643b6e55ccf62e47ca17485140bb";

  /** A config file of `settings` in a folder of its own, loaded. */
  async function loadedFrom(settings: object) {
    const dir = await tmp();
    await writeFile(path.join(dir, "voicecap.config.json"), JSON.stringify(settings));
    return loadConfig({ cwd: dir });
  }

  /** The config as 0.9.x had it: with no report.canonical key at all. */
  function without(config: ReturnType<typeof resolveConfig>): object {
    const { canonical: _canonical, ...report } = config.report;
    return { ...config, report };
  }

  it("is 0.9.x's for the default config", async () => {
    expect(defaultConfig().sha256).toBe(DEFAULT_SHA256_0_9);
    expect((await loadConfig({ cwd: await tmp() })).sha256).toBe(DEFAULT_SHA256_0_9);
    expect(hashJson(without(DEFAULT_CONFIG))).toBe(DEFAULT_SHA256_0_9);
  });

  it("leaves out a report.canonical that is null, so any config without it hashes as it did", async () => {
    const own = await loadedFrom({ reviewer: "Pat Lee", report: { siteName: "DVFR" } });
    expect(own.sha256).toBe(hashJson(without(own.config)));
    expect((await loadedFrom({ report: { canonical: null } })).sha256).toBe(DEFAULT_SHA256_0_9);
  });

  it("hashes a report.canonical that is set, so naming the site changes it", async () => {
    const named = await loadedFrom({ report: { canonical: "dvfr.illinois.gov" } });
    expect(named.config.report.canonical).toBe("https://dvfr.illinois.gov/");
    expect(named.sha256).toBe(hashJson(named.config));
    expect(named.sha256).not.toBe(DEFAULT_SHA256_0_9);
    const other = await loadedFrom({ report: { canonical: "i2i.illinois.gov" } });
    expect(other.sha256).not.toBe(named.sha256);
  });
});
