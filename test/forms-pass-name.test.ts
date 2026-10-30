/**
 * `forms` is a pass name, but an opt-in one: nothing changes for a run, a file, or a config that
 * doesn't ask for it.
 */
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG, formsSettingsOf, stepCapOf } from "../src/config/defaults.js";
import { resolveConfig } from "../src/config/load.js";
import { DEFAULT_PASS_NAMES, PASS_NAMES, type RunJson, type RunSettings } from "../src/model.js";
import { runPass } from "../src/passes/index.js";
import { runAudit, type RunAuditOptions } from "../src/run/audit.js";
import { settingsHash } from "../src/run/resume.js";
import { parseWalkthrough, walkthroughJson, walkthroughOf } from "../src/share/walkthrough.js";
import { MAIN_COMMAND } from "../src/transcripts/format.js";
import { options, setup, sitePages } from "./helpers/run-site.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";
import { shareRun } from "./helpers/share-data.js";

const settings: RunSettings = {
  site: "https://example.illinois.gov",
  source: { kind: "pages", file: "pages.csv", sha256: "a".repeat(64) },
  passes: ["read", "headings", "tab"],
  include: [],
  exclude: [],
  limit: null,
  driver: "guidepup",
  replayFrom: null,
  capture: "complete",
  stepCaps: { read: 400, headings: 200, tab: 300 },
  nvdaSettings: {},
  browser: { channel: "chrome", fallbackToChromium: true },
};

describe("forms as a pass name", () => {
  it("is a pass voicecap knows, after the three it has always had", () => {
    expect(PASS_NAMES).toEqual(["read", "headings", "tab", "forms"]);
    expect(DEFAULT_PASS_NAMES).toEqual(["read", "headings", "tab"]);
    expect(MAIN_COMMAND.forms).toBe("pressSubmit");
  });

  it("stays out of the defaults, so a config that doesn't ask for it is the config it was", () => {
    expect(DEFAULT_CONFIG.passes).toEqual(["read", "headings", "tab"]);
    expect(DEFAULT_CONFIG.stepCaps).toEqual({ read: 1500, headings: 500, tab: 1000 });
    expect(DEFAULT_CONFIG).not.toHaveProperty("forms");
    const config = resolveConfig({});
    expect(config.passes).toEqual(["read", "headings", "tab"]);
    expect(config).not.toHaveProperty("forms");
    expect(stepCapOf(config, "forms")).toBe(500);
    expect(formsSettingsOf(config)).toEqual({
      settleMs: 3000,
      maxPerPage: 5,
      values: { text: "voicecap test", email: "test@example.com", tel: "555-555-5555" },
    });
  });

  it("is accepted by a config's passes, and its settings by the config", () => {
    const config = resolveConfig({
      passes: ["read", "forms"],
      stepCaps: { forms: 40 },
      forms: { maxPerPage: 3, values: { Email: "someone@example.com" } },
    });
    expect(config.passes).toEqual(["read", "forms"]);
    expect(stepCapOf(config, "forms")).toBe(40);
    expect(stepCapOf(config, "read")).toBe(1500);
    expect(formsSettingsOf(config)).toEqual({
      settleMs: 3000,
      maxPerPage: 3,
      values: { Email: "someone@example.com" },
    });
  });

  it("is accepted by --passes, and a typo is still refused with the three listed", async () => {
    // Given to the program's own parser, with runAudit replaced by one that only keeps its options.
    vi.resetModules();
    let given: RunAuditOptions | undefined;
    vi.doMock("../src/run/audit.js", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      runAudit: (options: RunAuditOptions) => {
        given = options;
        return Promise.resolve({ exitCode: 0 });
      },
    }));
    try {
      const { main } = await import("../src/cli/main.js");
      const run = async (list: string) => {
        const stderr: string[] = [];
        const code = await main(
          ["--site", "http://127.0.0.1:4747", "--pages", "p.json", "--passes", list],
          {
            stdout: { write: () => true },
            stderr: { write: (text: string) => (stderr.push(text), true) },
            cwd: process.cwd(),
            env: {},
            signal: new AbortController().signal,
            interactive: false,
            platform: "linux",
          },
        );
        return { code, err: stderr.join("") };
      };
      expect((await run("read,forms")).code).toBe(0);
      expect(given?.passes).toEqual(["read", "forms"]);
      const typo = await run("read,sing");
      expect(typo.code).toBe(1);
      expect(typo.err).toContain("use a comma-separated list of read, headings, tab.");
    } finally {
      vi.doUnmock("../src/run/audit.js");
      vi.resetModules();
    }
  });
});

describe("a run that doesn't take the forms pass", () => {
  it("has the settings hash it had before the pass existed", () => {
    expect(settingsHash(settings)).toBe(
      "b4ca070a95eb1b358465a56d4199c2d77ba3476843fb31b6bbeeba9c9bd7bf41",
    );
  });

  it("records three step caps, and a page with no forms has no forms transcripts", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages());
    const run = (await runAudit(options(dir, driver))).run;
    expect(run.pages[0]?.status).toBe("done");
    expect(Object.keys(run.pages[0]!.passes).sort()).toEqual(["headings", "read", "tab"]);
  });

  it("counts the transcripts it has, not three for every page", async () => {
    const dir = await setup(["/", "/about"]);
    const driver = new ScriptedDriver(sitePages());
    const result = await runAudit(options(dir, driver, { passes: ["read"] }));
    expect(result.run.settings.stepCaps).toEqual({ read: 1500, headings: 500, tab: 1000 });
    for (const page of result.run.pages) {
      expect(Object.keys(page.passes)).toEqual(["read"]);
    }
  });
});

describe("a run that takes the forms pass", () => {
  it("records its cap, and --max-steps sets it too", async () => {
    const dir = await setup(["/"]);
    const driver = new ScriptedDriver(sitePages());
    const result = await runAudit(options(dir, driver, { passes: ["forms"], maxSteps: 7 }));
    expect(result.run.settings.passes).toEqual(["forms"]);
    expect(result.run.settings.stepCaps).toEqual({ read: 7, headings: 7, tab: 7, forms: 7 });
  });

  it("ends at once with a driver that can't test forms, and says so", async () => {
    const driver = new ScriptedDriver(sitePages());
    await driver.openPage(sitePages()[0]!.url);
    const result = await runPass("forms", driver, {
      cap: 10,
      repeatLimit: 10,
      endConfirmations: 1,
      noNextHeading: /^no next heading$/i,
      stepTimeoutMs: 1000,
      forms: { settleMs: 0, values: {} },
    });
    expect(result.stopReason).toBe("forms-done");
    expect(result.steps).toEqual([]);
    expect(result.warnings).toEqual(["this run's driver doesn't test forms"]);
  });
});

describe("a walkthrough file", () => {
  const run = (): RunJson =>
    shareRun({
      id: "2026-09-26_1405",
      pages: [{ path: "/", passes: { read: ["a"], headings: ["b"], tab: ["c"] } }],
    });

  it("from a run with no forms pass is written without a cap for it, and read back", () => {
    const walkthrough = walkthroughOf(run());
    expect(Object.keys(walkthrough.settings.stepCaps).sort()).toEqual(["headings", "read", "tab"]);
    expect(parseWalkthrough(walkthroughJson(walkthrough), "w.json")).toStrictEqual(walkthrough);
  });

  it("from before the pass, with no stepCaps.forms, is still read", () => {
    const text = JSON.parse(walkthroughJson(walkthroughOf(run()))) as {
      settings: { stepCaps: Record<string, number> };
    };
    delete text.settings.stepCaps.forms;
    const parsed = parseWalkthrough(JSON.stringify(text), "old.json");
    expect(parsed.settings.stepCaps.forms).toBeUndefined();
    expect(parsed.settings.passes).toEqual(["read", "headings", "tab"]);
  });

  it("from a run that took the forms pass keeps its cap and its fingerprint", () => {
    const base = run();
    base.settings.passes = [...base.settings.passes, "forms"];
    base.settings.stepCaps = { ...base.settings.stepCaps, forms: 90 };
    const walkthrough = walkthroughOf(base);
    expect(walkthrough.settings.stepCaps.forms).toBe(90);
    expect(parseWalkthrough(walkthroughJson(walkthrough), "w.json")).toStrictEqual(walkthrough);
  });
});
