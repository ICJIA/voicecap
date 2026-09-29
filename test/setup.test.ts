import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { VoicecapConfig } from "../src/config/schema.js";
import { runSetup, type SetupDeps } from "../src/drivers/guidepup/setup.js";
import type { Check, PlatformReadiness } from "../src/readiness/model.js";
import { EnvironmentError } from "../src/util/errors.js";
import { createMemoryLogger } from "../src/util/log.js";
import { scriptedPlatform } from "./helpers/scripted-platform.js";
import { scriptedScreen } from "./helpers/screen.js";

const install = {
  build: "0.2.1-2026.2",
  cacheDir: "C:\\Users\\pat\\AppData\\Local\\guidepup",
  nvdaExe: "C:\\Users\\pat\\AppData\\Local\\guidepup\\nvda\\all\\0.2.1-2026.2\\extracted\\nvda.exe",
};
const guidepup = {
  version: "0.34.0",
  dir: "C:\\voicecap\\node_modules\\@guidepup\\guidepup",
  nvdaBuild: "0.2.1-2026.2",
};
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const NVDA_OK: Check = {
  id: "nvda",
  status: "OK",
  summary: "NVDA 2026.2 (Guidepup's build 0.2.1-2026.2) is installed",
};
const LOCKED: Check = {
  id: "session",
  status: "FAIL",
  summary: "Windows is locked",
  problem: {
    title: "Windows is locked",
    whatsWrong: "NVDA can't press keys or speak while Windows is locked.",
    fix: ["Unlock the computer.", "Run npx @icjia/voicecap setup again."],
    setupHelps: false,
  },
};
const LIVE_OK: Check = {
  id: "liveHear",
  status: "OK",
  summary: 'NVDA speaks: "voicecap doctor check, heading, level 1" (0.4 s per step)',
};
const LIVE_FAIL: Check = {
  id: "liveHear",
  status: "FAIL",
  summary: "NVDA started, but voicecap heard nothing from it",
  problem: {
    title: "NVDA's speech",
    whatsWrong: "NVDA started, but voicecap captured no speech from it.",
    fix: ["Run npx @icjia/voicecap setup again."],
    setupHelps: true,
  },
};

/**
 * A Windows computer whose quick checks answer from `script` (ready, by default), with a live
 * test that answers `live`. `liveRuns` counts the live tests run.
 */
function windowsWith(script: Record<string, Check[]> = { nvda: [NVDA_OK] }, live = [LIVE_OK]) {
  let liveRuns = 0;
  const platform: PlatformReadiness = scriptedPlatform(script, {
    screenReader: "NVDA",
    liveTestNotice: [
      "The live test takes about 20 seconds. NVDA speaks and takes over the keyboard, so keep your hands off.",
    ],
    liveTest: () => {
      liveRuns++;
      return Promise.resolve(live);
    },
  }).platform;
  return { platform, liveRuns: () => liveRuns };
}

/**
 * runSetup with every installer faked, and a ready Windows computer with no live test, unless
 * overridden. `answers` are typed at its questions; null (the default) means no one can answer
 * (stdin isn't a terminal), so there's no prompter.
 */
function setupWith(
  overrides: Partial<SetupDeps> = {},
  config: VoicecapConfig = DEFAULT_CONFIG,
  answers: string[] | null = null,
) {
  const runs: { script: string; args: string[]; cwd: string }[] = [];
  const files = new Set<string>();
  const ready = scriptedPlatform({ nvda: [NVDA_OK] }, { screenReader: "NVDA" }).platform;
  const deps: SetupDeps = {
    platform: "win32",
    guidepup,
    setupCli: {
      version: "0.28.0",
      bin: "C:\\voicecap\\node_modules\\@guidepup\\setup\\bin\\guidepup",
    },
    playwrightCli: "C:\\voicecap\\node_modules\\playwright\\cli.js",
    install,
    exists: (file) => files.has(file),
    runNode: (script, args, cwd) => {
      runs.push({ script, args, cwd });
      if (args[0] === "install" && args[1] === "nvda") files.add(install.nvdaExe);
      return Promise.resolve(0);
    },
    resolveBrowser: () => ({ name: "Chrome", path: CHROME }),
    platformReadiness: () => Promise.resolve(ready),
    ...overrides,
  };
  const logger = createMemoryLogger();
  const screen = scriptedScreen(answers ?? []);
  const prompter = answers === null ? null : screen.prompter;
  return {
    deps,
    runs,
    files,
    logger,
    screen,
    run: () => runSetup({ config, logger, prompter }, deps).finally(() => screen.close()),
  };
}

describe("voicecap setup", () => {
  it("runs voicecap's pinned Guidepup installer for NVDA, from the Guidepup package it serves", async () => {
    const { run, runs } = setupWith();
    await run();
    expect(runs[0]).toEqual({
      script: "C:\\voicecap\\node_modules\\@guidepup\\setup\\bin\\guidepup",
      args: ["install", "nvda"],
      cwd: guidepup.dir,
    });
  });

  it("says where NVDA went, then ends with the preflight", async () => {
    const { run, logger } = setupWith();
    expect(await run()).toBe(0);
    const text = logger.text();
    expect(text).toContain(install.nvdaExe);
    // The preflight takes the place of today's "Next, check everything with: … doctor".
    expect(text).toContain(
      [
        "voicecap talks to NVDA only on this computer (127.0.0.1); it doesn't need network access.",
        "",
        "voicecap preflight, ",
      ].join("\n"),
    );
    expect(text).toContain("Ready: this computer can run NVDA for voicecap.");
    expect(text).not.toContain("Next, check everything");
    // That's the Mac's line, for its System Events prompt: Windows checks raise no prompt.
    expect(text).not.toContain("Checking this Mac");
  });

  it("returns 2 with the problems when the preflight isn't ready", async () => {
    const windows = windowsWith({ nvda: [NVDA_OK], session: [LOCKED] });
    const { run, logger } = setupWith({
      platformReadiness: () => Promise.resolve(windows.platform),
    });
    expect(await run()).toBe(2);
    expect(logger.text()).toContain("  FAIL  Windows is locked");
    expect(logger.text()).toContain("Not ready: 1 problem.");
  });

  it("offers the live test when ready and someone can answer", async () => {
    const windows = windowsWith();
    const setup = setupWith(
      { platformReadiness: () => Promise.resolve(windows.platform) },
      DEFAULT_CONFIG,
      ["n"],
    );
    expect(await setup.run()).toBe(0);
    expect(setup.logger.text()).toContain(
      "The live test takes about 20 seconds. NVDA speaks and takes over the keyboard, so keep your hands off.",
    );
    expect(setup.screen.text()).toBe("Test NVDA now? [y/N]: n\n");
    expect(windows.liveRuns()).toBe(0);
  });

  it("runs the live test on a yes: 0 when it passes, 2 with the problem when it fails", async () => {
    const passing = windowsWith();
    const passed = setupWith(
      { platformReadiness: () => Promise.resolve(passing.platform) },
      DEFAULT_CONFIG,
      ["y"],
    );
    expect(await passed.run()).toBe(0);
    expect(passing.liveRuns()).toBe(1);
    expect(passed.logger.text()).toContain(`Checks\n  OK    ${LIVE_OK.summary}`);

    const failing = windowsWith(undefined, [LIVE_FAIL]);
    const failed = setupWith(
      { platformReadiness: () => Promise.resolve(failing.platform) },
      DEFAULT_CONFIG,
      ["y"],
    );
    expect(await failed.run()).toBe(2);
    expect(failed.logger.text()).toContain("Not ready: 1 problem.\n\n1. NVDA's speech");
  });

  it("doesn't offer the live test when no one can answer, or when the computer isn't ready", async () => {
    const ready = windowsWith();
    const unattended = setupWith({ platformReadiness: () => Promise.resolve(ready.platform) });
    expect(await unattended.run()).toBe(0);
    expect(ready.liveRuns()).toBe(0);

    const locked = windowsWith({ session: [LOCKED] });
    // No answers: a question would end the input, and fail the setup.
    const notReady = setupWith(
      { platformReadiness: () => Promise.resolve(locked.platform) },
      DEFAULT_CONFIG,
      [],
    );
    expect(await notReady.run()).toBe(2);
    expect(notReady.screen.text()).toBe("");
    expect(locked.liveRuns()).toBe(0);
  });

  // The CLI sends a Mac to its own setup, and Linux to the preflight: only a direct call gets here.
  it("refuses anywhere but Windows", async () => {
    const { run, runs } = setupWith({ platform: "linux" });
    await expect(run()).rejects.toThrow(
      new EnvironmentError("voicecap's Windows setup installs NVDA, which only runs on Windows."),
    );
    expect(runs).toEqual([]);
  });

  it("explains the space-in-path problem before downloading anything", async () => {
    const { run, runs } = setupWith({
      install: { ...install, cacheDir: "C:\\Users\\Jane Doe\\AppData\\Local\\guidepup" },
    });
    await expect(run()).rejects.toThrow(/GUIDEPUP_SCREEN_READERS_PATH/);
    expect(runs).toEqual([]);
  });

  it("explains the same for a path with a character the command shell treats specially", async () => {
    const { run, runs } = setupWith({
      install: { ...install, cacheDir: "C:\\Users\\R&D\\AppData\\Local\\guidepup" },
    });
    await expect(run()).rejects.toThrow(/"&".+GUIDEPUP_SCREEN_READERS_PATH/s);
    expect(runs).toEqual([]);
  });

  it("fails when the installer fails, pointing at proxies", async () => {
    const { run } = setupWith({ runNode: () => Promise.resolve(1) });
    const setup = run();
    await expect(setup).rejects.toThrow(EnvironmentError);
    await expect(setup).rejects.toThrow(/HTTPS_PROXY/);
  });

  it("fails when nvda.exe didn't arrive", async () => {
    const { run } = setupWith({ runNode: () => Promise.resolve(0) });
    await expect(run()).rejects.toThrow(/nvda\.exe/);
  });

  it("installs Playwright's Chromium only when the configured browser isn't installed", async () => {
    const withChrome = setupWith();
    await withChrome.run();
    expect(withChrome.runs.map((r) => r.args.join(" "))).toEqual(["install nvda"]);

    let chromiumInstalled = false;
    const withoutChrome = setupWith({
      resolveBrowser: () => {
        if (!chromiumInstalled) throw new EnvironmentError("Google Chrome isn't installed.");
        return { name: "Chromium", path: "C:\\pw\\chrome.exe" };
      },
    });
    const baseRun = withoutChrome.deps.runNode;
    withoutChrome.deps.runNode = async (script, args, cwd) => {
      if (args.join(" ") === "install chromium") chromiumInstalled = true;
      return baseRun(script, args, cwd);
    };
    await withoutChrome.run();
    expect(withoutChrome.runs.map((r) => r.args.join(" "))).toEqual([
      "install nvda",
      "install chromium",
    ]);
    expect(withoutChrome.runs[1]?.script).toBe("C:\\voicecap\\node_modules\\playwright\\cli.js");
  });

  it("installs Playwright's Chromium when that's the configured browser, fallback or not", async () => {
    let chromiumInstalled = false;
    const setup = setupWith(
      {
        resolveBrowser: () => {
          if (!chromiumInstalled) {
            throw new EnvironmentError("Playwright's Chromium isn't installed.");
          }
          return { name: "Chromium", path: "C:\\pw\\chrome.exe" };
        },
      },
      { ...DEFAULT_CONFIG, browser: { channel: "chromium", fallbackToChromium: false } },
    );
    const baseRun = setup.deps.runNode;
    setup.deps.runNode = async (script, args, cwd) => {
      if (args.join(" ") === "install chromium") chromiumInstalled = true;
      return baseRun(script, args, cwd);
    };
    await setup.run();
    expect(setup.runs.map((r) => r.args.join(" "))).toEqual(["install nvda", "install chromium"]);
  });

  it("doesn't suggest Google Chrome when Chromium, the configured browser, fails to install", async () => {
    const setup = setupWith(
      {
        resolveBrowser: () => {
          throw new EnvironmentError("Playwright's Chromium isn't installed.");
        },
        runNode: (_script, args) => Promise.resolve(args[1] === "chromium" ? 1 : 0),
        exists: () => true,
      },
      { ...DEFAULT_CONFIG, browser: { channel: "chromium", fallbackToChromium: false } },
    );
    const failure = setup.run();
    await expect(failure).rejects.toThrow(/HTTPS_PROXY/);
    await expect(failure).rejects.not.toThrow(/Google Chrome/);
  });

  it("doesn't put Chromium in place of a missing browser when fallback is off", async () => {
    const setup = setupWith(
      {
        resolveBrowser: () => {
          throw new EnvironmentError("Google Chrome isn't installed.");
        },
      },
      { ...DEFAULT_CONFIG, browser: { channel: "chrome", fallbackToChromium: false } },
    );
    await expect(setup.run()).rejects.toThrow(/Google Chrome/);
    expect(setup.runs.map((r) => r.args.join(" "))).toEqual(["install nvda"]);
  });
});
