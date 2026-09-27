import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { EnvironmentInfo } from "../src/drivers/types.js";
import { runDoctor, type DoctorDeps, type LiveCheck } from "../src/drivers/guidepup/doctor.js";
import { runSetup, type SetupDeps } from "../src/drivers/guidepup/setup.js";
import { EnvironmentError } from "../src/util/errors.js";
import { createMemoryLogger } from "../src/util/log.js";

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

function setupWith(overrides: Partial<SetupDeps> = {}) {
  const runs: { script: string; args: string[]; cwd: string }[] = [];
  const files = new Set<string>();
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
    ...overrides,
  };
  const logger = createMemoryLogger();
  return {
    deps,
    runs,
    files,
    logger,
    run: () => runSetup({ config: DEFAULT_CONFIG, logger }, deps),
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

  it("says where NVDA went and what to run next", async () => {
    const { run, logger } = setupWith();
    await run();
    expect(logger.text()).toContain(install.nvdaExe);
    expect(logger.text()).toContain("voicecap doctor");
  });

  it("refuses anywhere but Windows", async () => {
    const { run, runs } = setupWith({ platform: "linux" });
    await expect(run()).rejects.toThrow(EnvironmentError);
    expect(runs).toEqual([]);
  });

  it("explains the space-in-path problem before downloading anything", async () => {
    const { run, runs } = setupWith({
      install: { ...install, cacheDir: "C:\\Users\\Jane Doe\\AppData\\Local\\guidepup" },
    });
    await expect(run()).rejects.toThrow(/GUIDEPUP_SCREEN_READERS_PATH/);
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
});

const environment: EnvironmentInfo = {
  driver: { name: "guidepup", version: "0.34.0" },
  screenReader: { name: "NVDA", version: "2026.2", build: "0.2.1-2026.2", language: "en-US" },
  capture: "complete",
  browser: { name: "Chrome", version: "153.0.8010.53" },
  os: "Windows 11 Pro 25H2 (10.0.26200)",
  screenReaderSettings: {},
};

const passingLiveCheck: LiveCheck = {
  environment,
  speech: ["heading, level 1, voicecap doctor check", "Doctor button, button"],
  stepMs: 1300,
};

function doctorWith(overrides: Partial<DoctorDeps> = {}) {
  let liveChecks = 0;
  const deps: DoctorDeps = {
    platform: "win32",
    nodeVersion: "24.19.0",
    voicecapVersion: "0.2.0",
    guidepup,
    setupVersion: "0.28.0",
    install,
    exists: (file) => file === install.nvdaExe,
    runningNvda: () => Promise.resolve([]),
    system: () => ({ os: "Windows 11 Pro 25H2 (10.0.26200)", uiLocale: "en-US" }),
    resolveBrowser: () => ({ name: "Chrome", path: CHROME }),
    liveCheck: () => {
      liveChecks++;
      return Promise.resolve(passingLiveCheck);
    },
    now: () => new Date("2026-09-27T09:30:00"),
    ...overrides,
  };
  const logger = createMemoryLogger();
  return {
    deps,
    logger,
    liveChecks: () => liveChecks,
    run: () => runDoctor({ config: DEFAULT_CONFIG, logger }, deps),
  };
}

describe("voicecap doctor", () => {
  it("prints a summary of every check and exits 0 when all pass", async () => {
    const { run, logger } = doctorWith();
    expect(await run()).toBe(0);
    const text = logger.text();
    for (const line of [
      "OK    Windows: Windows 11 Pro 25H2 (10.0.26200)",
      "OK    Node.js: 24.19.0",
      "OK    NVDA build: 0.2.1-2026.2 (NVDA 2026.2)",
      "OK    Other NVDA: none running",
      "OK    Browser: Chrome 153.0.8010.53",
      "OK    NVDA speech: captured",
      "OK    Foreground: the browser came to the front (checked with NVDA+T)",
      "OK    NVDA language: en-US",
    ]) {
      expect(text).toContain(line);
    }
  });

  it("fails without trying NVDA when Guidepup's NVDA isn't installed", async () => {
    const doctor = doctorWith({ exists: () => false });
    expect(await doctor.run()).toBe(2);
    expect(doctor.logger.text()).toMatch(/FAIL {2}NVDA build: .*voicecap setup/);
    expect(doctor.liveChecks()).toBe(0);
  });

  it("fails on a Guidepup folder whose path has a space, with the fix", async () => {
    const doctor = doctorWith({
      install: { ...install, cacheDir: "C:\\Users\\Jane Doe\\AppData\\Local\\guidepup" },
    });
    expect(await doctor.run()).toBe(2);
    expect(doctor.logger.text()).toMatch(/FAIL .*GUIDEPUP_SCREEN_READERS_PATH/s);
    expect(doctor.liveChecks()).toBe(0);
  });

  it("warns, without failing, that a running NVDA will be shut down", async () => {
    const { run, logger } = doctorWith({ runningNvda: () => Promise.resolve([4321]) });
    expect(await run()).toBe(0);
    expect(logger.text()).toContain("WARN  Other NVDA: running (process 4321)");
  });

  it("fails when NVDA or the browser don't work, saying why", async () => {
    const { run, logger } = doctorWith({
      liveCheck: () => Promise.reject(new EnvironmentError("NVDA didn't start: Timed out")),
    });
    expect(await run()).toBe(2);
    expect(logger.text()).toContain("FAIL  NVDA speech: NVDA didn't start: Timed out");
  });

  it("fails when NVDA's speech doesn't come through", async () => {
    const { run, logger } = doctorWith({
      liveCheck: () => Promise.resolve({ ...passingLiveCheck, speech: ["", ""] }),
    });
    expect(await run()).toBe(2);
    expect(logger.text()).toMatch(/FAIL {2}NVDA speech: /);
  });

  it("warns when NVDA doesn't speak English, which voicecap's phrasing assumes", async () => {
    const { run, logger } = doctorWith({
      liveCheck: () =>
        Promise.resolve({
          ...passingLiveCheck,
          environment: {
            ...environment,
            screenReader: { ...environment.screenReader!, language: "de-DE" },
          },
        }),
    });
    expect(await run()).toBe(0);
    expect(logger.text()).toContain("WARN  NVDA language: de-DE");
  });

  it("stops at the platform check anywhere but Windows", async () => {
    const doctor = doctorWith({ platform: "darwin" });
    expect(await doctor.run()).toBe(2);
    expect(doctor.logger.text()).toContain("FAIL  Windows:");
    expect(doctor.liveChecks()).toBe(0);
  });
});
