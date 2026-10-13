import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { defaultConfig, defineConfig, loadConfig, resolveConfig } from "../src/config/load.js";
import { ConfigError } from "../src/util/errors.js";
import { hashJson } from "../src/util/hash.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "voicecap-config-"));

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The four names of a config written as code, which voicecap runs only when it's named. */
const CODE_CONFIG_NAMES = [
  "voicecap.config.ts",
  "voicecap.config.mts",
  "voicecap.config.js",
  "voicecap.config.mjs",
];

/**
 * A config written as code that writes a marker file when it runs, so that a test can tell a config
 * that ran from one that was only found. `settings` is what it exports.
 */
function markedConfig(marker: string, settings: object = {}): string {
  return `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nexport default ${JSON.stringify(settings)};\n`;
}

/** What voicecap says to a person whose folder has a config written as code that no one named. */
function codeConfigRefusal(name: string, folder: string): string {
  return `${name} in ${folder} is code, and voicecap runs a config's code only when you name it: anyone who can add a file to this folder could have put it there. Write the same settings as voicecap.config.json, or set VOICECAP_CONFIG to the file's full path to run it.`;
}

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

  // A config written as code runs only when it's named, with VOICECAP_CONFIG.
  it.each([
    // TypeScript syntax, to prove the .ts config is transpiled.
    [
      "voicecap.config.ts",
      'export default { reviewer: "TS Reviewer" } satisfies Record<string, unknown>;\n',
    ],
    ["voicecap.config.mts", 'export default { reviewer: "TS Reviewer" };\n'],
    ["voicecap.config.js", 'export default { reviewer: "TS Reviewer" };\n'],
    ["voicecap.config.mjs", 'export default { reviewer: "TS Reviewer" };\n'],
  ])("loads %s when VOICECAP_CONFIG names it", async (name, source) => {
    const dir = await tmp();
    await writeFile(path.join(dir, name), source);
    const loaded = await loadConfig({ cwd: dir, env: { VOICECAP_CONFIG: path.join(dir, name) } });
    expect(loaded.file).toBe(path.join(dir, name));
    expect(loaded.config.reviewer).toBe("TS Reviewer");
    expect(loaded.config.passes).toEqual(DEFAULT_CONFIG.passes);
  });

  it("finds voicecap.config.json in the folder, as before", async () => {
    const dir = await tmp();
    await writeFile(
      path.join(dir, "voicecap.config.json"),
      '\u{FEFF}{ "reviewer": "TS Reviewer" }\n',
    );
    const loaded = await loadConfig({ cwd: dir, env: {} });
    expect(loaded.file).toBe(path.join(dir, "voicecap.config.json"));
    expect(loaded.config.reviewer).toBe("TS Reviewer");
    expect(loaded.config.passes).toEqual(DEFAULT_CONFIG.passes);
  });

  it("lets a config import defineConfig from @icjia/voicecap with no node_modules (npx)", async () => {
    const dir = await tmp();
    const file = path.join(dir, "voicecap.config.ts");
    await writeFile(
      file,
      'import { defineConfig } from "@icjia/voicecap";\nexport default defineConfig({ reviewer: "Alias Test" });\n',
    );
    const loaded = await loadConfig({ cwd: dir, env: { VOICECAP_CONFIG: file } });
    expect(loaded.config.reviewer).toBe("Alias Test");
  });

  describe("a config written as code that no one named", () => {
    it.each(CODE_CONFIG_NAMES)(
      "refuses %s, says to write JSON or to name it, and never runs it",
      async (name) => {
        const dir = await tmp();
        const marker = path.join(dir, "ran.txt");
        await writeFile(path.join(dir, name), markedConfig(marker, { reviewer: "Not Run" }));

        const refused = expect(loadConfig({ cwd: dir, env: {} })).rejects;

        await refused.toBeInstanceOf(ConfigError);
        await refused.toMatchObject({ message: codeConfigRefusal(name, dir) });
        await refused.toThrow(/VOICECAP_CONFIG/);
        await refused.toThrow(/voicecap\.config\.json/);
        expect(existsSync(marker)).toBe(false);
      },
    );

    it("refuses one beside voicecap.config.json too, and never runs it", async () => {
      const dir = await tmp();
      const marker = path.join(dir, "ran.txt");
      await writeFile(path.join(dir, "voicecap.config.json"), '{ "reviewer": "Json Reviewer" }');
      await writeFile(path.join(dir, "voicecap.config.mjs"), markedConfig(marker));

      await expect(loadConfig({ cwd: dir, env: {} })).rejects.toThrow(
        codeConfigRefusal("voicecap.config.mjs", dir),
      );
      expect(existsSync(marker)).toBe(false);
    });

    it("names the first of two, and runs neither", async () => {
      const dir = await tmp();
      const markers = [path.join(dir, "ts.txt"), path.join(dir, "mjs.txt")];
      await writeFile(path.join(dir, "voicecap.config.mjs"), markedConfig(markers[1]!));
      await writeFile(path.join(dir, "voicecap.config.ts"), markedConfig(markers[0]!));

      await expect(loadConfig({ cwd: dir, env: {} })).rejects.toThrow(
        codeConfigRefusal("voicecap.config.ts", dir),
      );
      expect(markers.map((marker) => existsSync(marker))).toEqual([false, false]);
    });

    it("is refused when VOICECAP_CONFIG is blank, as when it's not set", async () => {
      const dir = await tmp();
      const marker = path.join(dir, "ran.txt");
      await writeFile(path.join(dir, "voicecap.config.ts"), markedConfig(marker));

      for (const blank of ["", "   ", "\t"]) {
        await expect(loadConfig({ cwd: dir, env: { VOICECAP_CONFIG: blank } })).rejects.toThrow(
          codeConfigRefusal("voicecap.config.ts", dir),
        );
      }
      expect(existsSync(marker)).toBe(false);
    });

    it("is run once it's named, which its marker shows", async () => {
      const dir = await tmp();
      const marker = path.join(dir, "ran.txt");
      const file = path.join(dir, "voicecap.config.ts");
      await writeFile(file, markedConfig(marker, { reviewer: "Named" }));

      const loaded = await loadConfig({ cwd: dir, env: { VOICECAP_CONFIG: file } });

      expect(loaded.config.reviewer).toBe("Named");
      expect(existsSync(marker)).toBe(true);
    });
  });

  describe("the file VOICECAP_CONFIG names", () => {
    it("is trimmed, and a relative path is resolved against the folder voicecap runs in", async () => {
      const dir = await tmp();
      await writeFile(
        path.join(dir, "mine.config.ts"),
        'export default { reviewer: "Relative" };\n',
      );

      const loaded = await loadConfig({
        cwd: dir,
        env: { VOICECAP_CONFIG: "  mine.config.ts \t" },
      });

      expect(loaded.file).toBe(path.join(dir, "mine.config.ts"));
      expect(loaded.config.reviewer).toBe("Relative");
    });

    it("can be in another folder, and then the folder's own code config is not run", async () => {
      const here = await tmp();
      const elsewhere = await tmp();
      const stray = path.join(here, "ran.txt");
      await writeFile(path.join(here, "voicecap.config.ts"), markedConfig(stray));
      await writeFile(
        path.join(elsewhere, "voicecap.config.ts"),
        'export default { reviewer: "Elsewhere" };\n',
      );

      const loaded = await loadConfig({
        cwd: here,
        env: { VOICECAP_CONFIG: path.join(elsewhere, "voicecap.config.ts") },
      });

      expect(loaded.file).toBe(path.join(elsewhere, "voicecap.config.ts"));
      expect(loaded.config.reviewer).toBe("Elsewhere");
      expect(existsSync(stray)).toBe(false);
    });

    it("is read in place of the folder's voicecap.config.json", async () => {
      const dir = await tmp();
      await writeFile(path.join(dir, "voicecap.config.json"), '{ "reviewer": "From Json" }');
      await writeFile(path.join(dir, "named.json"), '{ "reviewer": "Named Json" }');

      const loaded = await loadConfig({ cwd: dir, env: { VOICECAP_CONFIG: "named.json" } });

      expect(loaded.file).toBe(path.join(dir, "named.json"));
      expect(loaded.config.reviewer).toBe("Named Json");
    });

    it("comes second: the file option beats it", async () => {
      const dir = await tmp();
      await writeFile(path.join(dir, "option.json"), '{ "reviewer": "Option" }');
      await writeFile(path.join(dir, "env.json"), '{ "reviewer": "Env" }');

      const loaded = await loadConfig({
        cwd: dir,
        file: "option.json",
        env: { VOICECAP_CONFIG: "env.json" },
      });

      expect(loaded.file).toBe(path.join(dir, "option.json"));
      expect(loaded.config.reviewer).toBe("Option");
    });

    it("is reported when it names a file that isn't there", async () => {
      const dir = await tmp();
      const missing = path.join(dir, "nowhere.config.ts");

      await expect(loadConfig({ cwd: dir, env: { VOICECAP_CONFIG: missing } })).rejects.toThrow(
        `Config file not found: ${missing}`,
      );
    });

    it("is read from process.env when the caller gives no env", async () => {
      const dir = await tmp();
      // Not a name the folder is searched for, so only the variable can have named it.
      const file = path.join(dir, "ambient.config.ts");
      await writeFile(file, 'export default { reviewer: "Ambient" };\n');
      vi.stubEnv("VOICECAP_CONFIG", file);

      const loaded = await loadConfig({ cwd: dir });

      expect(loaded.file).toBe(file);
      expect(loaded.config.reviewer).toBe("Ambient");
    });
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
    expect(root("https://voicecap.icjia.app/demo-site")).toBe(
      "https://voicecap.icjia.app/demo-site/",
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

  it("explains a config that fails to load", async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, "voicecap.config.json"), "{ not json");
    await expect(loadConfig({ cwd: dir })).rejects.toThrow(/Could not load/);
  });

  it("hashes the effective config, so any change is visible", () => {
    expect(defineConfig({ reviewer: "x" })).toEqual({ reviewer: "x" });
  });
});

// NVDA's Remote Access service is what voicecap's connection to NVDA goes through, and its
// settings are NVDA's `remote` section. A config may set the rest of NVDA's settings, not that one.
describe("a config's nvdaSettings and NVDA's Remote Access settings", () => {
  const REASON =
    "voicecap doesn't change NVDA's Remote Access settings (remote): Guidepup's own configuration sets them, and voicecap's connection to NVDA depends on them.";

  /** The error `run` throws, or a failure of the test when it doesn't throw. */
  function thrownBy(run: () => unknown): Error {
    try {
      run();
    } catch (error) {
      if (error instanceof Error) return error;
      throw error;
    }
    throw new Error("Expected the call to throw.");
  }

  it.each(["remote", "Remote", "REMOTE", " remote "])(
    "refuses a section named %j, with a reason that names nvdaSettings.remote",
    (key) => {
      const error = thrownBy(() =>
        resolveConfig({ nvdaSettings: { [key]: { controlServer: { host: "x" } } } }),
      );

      expect(error).toBeInstanceOf(ConfigError);
      // The reason names the setting as voicecap writes it, never the spelling the config had.
      expect(error.message).toBe(`The config is invalid:\n  - nvdaSettings.remote: ${REASON}`);
    },
  );

  it("gives the reason once, whatever the spellings, and keeps the other problems", () => {
    const error = thrownBy(() =>
      resolveConfig({ nvdaSettings: { remote: {}, Remote: {} }, stepCaps: { read: -1 } }),
    );

    expect(error.message.match(/nvdaSettings\.remote/g)).toHaveLength(1);
    expect(error.message).toMatch(/- stepCaps\.read: /);
  });

  it("refuses it in a config file too, and names the file", async () => {
    const dir = await tmp();
    await writeFile(
      path.join(dir, "voicecap.config.json"),
      JSON.stringify({ nvdaSettings: { remote: { controlServer: { host: "x" } } } }),
    );

    await expect(loadConfig({ cwd: dir, env: {} })).rejects.toThrow(
      `The config in voicecap.config.json is invalid:\n  - nvdaSettings.remote: ${REASON}`,
    );
  });

  it("refuses it in a config written as code that is named", async () => {
    const dir = await tmp();
    const file = path.join(dir, "voicecap.config.ts");
    await writeFile(file, "export default { nvdaSettings: { Remote: { enabled: false } } };\n");

    await expect(loadConfig({ cwd: dir, env: { VOICECAP_CONFIG: file } })).rejects.toThrow(
      `The config in voicecap.config.ts is invalid:\n  - nvdaSettings.remote: ${REASON}`,
    );
  });

  it("loads any other NVDA setting", () => {
    const nvdaSettings = { speech: { rate: 50 }, general: { loggingLevel: "OFF" } };

    expect(resolveConfig({ nvdaSettings }).nvdaSettings).toEqual(nvdaSettings);
    expect(resolveConfig({ nvdaSettings: { speech: { rate: 50 } } }).nvdaSettings).toEqual({
      speech: { rate: 50 },
    });
    expect(resolveConfig({}).nvdaSettings).toEqual({});
  });

  it("refuses a section named remote and no other: not one inside a section, nor one that only starts so", () => {
    const nvdaSettings = { speech: { remote: true }, remoteness: { enabled: false } };

    expect(resolveConfig({ nvdaSettings }).nvdaSettings).toEqual(nvdaSettings);
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
