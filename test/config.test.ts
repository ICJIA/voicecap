import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { defineConfig, loadConfig, resolveConfig } from "../src/config/load.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "voicecap-config-"));

describe("loadConfig", () => {
  it("uses the defaults when there's no config file", async () => {
    const loaded = await loadConfig({ cwd: await tmp() });
    expect(loaded.file).toBeNull();
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.sha256).toMatch(/^[0-9a-f]{64}$/);
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
