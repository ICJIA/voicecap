import os from "node:os";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { VoicecapConfig } from "../src/config/schema.js";
import type { EnvironmentInfo, ScreenReaderDriver } from "../src/drivers/types.js";
import {
  runDoctor,
  runLiveCheck,
  type DoctorDeps,
  type LiveCheck,
} from "../src/drivers/guidepup/doctor.js";
import { runSetup, type SetupDeps } from "../src/drivers/guidepup/setup.js";
import { InterruptedError, StepTimeoutError } from "../src/passes/steps.js";
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

function setupWith(overrides: Partial<SetupDeps> = {}, config: VoicecapConfig = DEFAULT_CONFIG) {
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
    run: () => runSetup({ config, logger }, deps),
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
    otherVoicecap: () => Promise.resolve(null),
    sessionLocked: () => Promise.resolve(false),
    nvdaLockFile: "C:\\Users\\pat\\AppData\\Local\\voicecap\\nvda.lock",
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
      "OK    Session: unlocked",
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

  it("fails the same way on a path with a character the command shell treats specially", async () => {
    const doctor = doctorWith({
      install: { ...install, cacheDir: "C:\\Users\\R&D\\AppData\\Local\\guidepup" },
    });
    expect(await doctor.run()).toBe(2);
    expect(doctor.logger.text()).toMatch(/FAIL .*"&".*GUIDEPUP_SCREEN_READERS_PATH/s);
    expect(doctor.liveChecks()).toBe(0);
  });

  it("fails on a locked Windows session, without trying NVDA", async () => {
    const doctor = doctorWith({ sessionLocked: () => Promise.resolve(true) });
    expect(await doctor.run()).toBe(2);
    expect(doctor.logger.text()).toMatch(/FAIL {2}Session: Windows is locked/);
    expect(doctor.liveChecks()).toBe(0);
  });

  it("warns, and still checks NVDA, when Windows doesn't say whether it's locked", async () => {
    const doctor = doctorWith({ sessionLocked: () => Promise.resolve(null) });
    expect(await doctor.run()).toBe(0);
    expect(doctor.logger.text()).toMatch(/WARN {2}Session: /);
    expect(doctor.liveChecks()).toBe(1);
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
    expect(logger.text()).toContain("FAIL  Live check: NVDA didn't start: Timed out");
  });

  it("still names the browser when the live check fails", async () => {
    const { run, logger } = doctorWith({
      liveCheck: () => Promise.reject(new EnvironmentError("NVDA didn't start: Timed out")),
    });
    await run();
    expect(logger.text()).toContain(`Browser: Chrome (${CHROME})`);
  });

  it("exits 130 without a summary when Ctrl+C stops the live check", async () => {
    const { run, logger } = doctorWith({
      liveCheck: () => Promise.reject(new InterruptedError()),
    });
    expect(await run()).toBe(130);
    expect(logger.text()).not.toMatch(/voicecap doctor, \d/);
  });

  it("reports another voicecap using NVDA, rather than checking NVDA under it", async () => {
    const doctor = doctorWith({
      runningNvda: () => Promise.resolve([4321]),
      otherVoicecap: () =>
        Promise.resolve({ pid: 999, host: os.hostname(), startedAt: "2026-09-27T08:00:00-05:00" }),
    });
    expect(await doctor.run()).toBe(2);
    const text = doctor.logger.text();
    expect(text).toContain("FAIL  Other voicecap: process 999");
    expect(text).not.toContain("voicecap shuts it down");
    expect(doctor.liveChecks()).toBe(0);
  });

  it("says where the NVDA lock is, in case another voicecap's was left behind", async () => {
    const { run, logger } = doctorWith({
      otherVoicecap: () =>
        Promise.resolve({ pid: 999, host: os.hostname(), startedAt: "2026-09-27T08:00:00-05:00" }),
    });
    await run();
    expect(logger.text()).toContain("C:\\Users\\pat\\AppData\\Local\\voicecap\\nvda.lock");
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

/** A driver whose named calls never finish. */
class StubDriver implements ScreenReaderDriver {
  readonly name = "guidepup";
  readonly calls: string[] = [];

  constructor(private readonly hangs: string[] = []) {}

  private call<T>(name: string, value: T): Promise<T> {
    this.calls.push(name);
    return this.hangs.includes(name) ? new Promise(() => {}) : Promise.resolve(value);
  }

  start = () => this.call("start", undefined);
  stop = () => this.call("stop", undefined);
  getEnvironmentInfo = () => this.call("getEnvironmentInfo", environment);
  cleanupStale = () => this.call("cleanupStale", [] as string[]);
  openPage = (url: string) =>
    this.call("openPage", { finalUrl: url, status: 200, contentType: "text/html", title: "t" });
  nextLine = () => this.call("nextLine", "");
  nextHeading = () => this.call("nextHeading", "");
  nextFocusable = () => this.call("nextFocusable", "Doctor button, button");
  toTop = () => this.call("toTop", "heading, level 1, voicecap doctor check");
  toBottom = () => this.call("toBottom", "");
  focusInDocument = () => this.call("focusInDocument", true);
  focusedElement = () => this.call("focusedElement", null);
}

describe("the doctor's live check", () => {
  const quick: VoicecapConfig = {
    ...DEFAULT_CONFIG,
    timeouts: { ...DEFAULT_CONFIG.timeouts, stepMs: 20, driverStartMs: 20 },
    readiness: { ...DEFAULT_CONFIG.readiness, networkIdleTimeoutMs: 20 },
  };
  const url = "http://127.0.0.1:9/";

  it("captures what NVDA says at the top of the page and for the first Tab", async () => {
    const driver = new StubDriver();
    const live = await runLiveCheck(driver, url, quick);
    expect(live.speech).toEqual([
      "heading, level 1, voicecap doctor check",
      "Doctor button, button",
    ]);
    expect(driver.calls.at(-1)).toBe("stop");
  });

  it("gives up on a start that never finishes, and stops NVDA and the browser", async () => {
    const driver = new StubDriver(["start"]);
    await expect(runLiveCheck(driver, url, quick)).rejects.toThrow(StepTimeoutError);
    expect(driver.calls).toContain("stop");
  });

  it("gives up on a step that never finishes, and stops NVDA and the browser", async () => {
    const driver = new StubDriver(["nextFocusable"]);
    await expect(runLiveCheck(driver, url, quick)).rejects.toThrow(StepTimeoutError);
    expect(driver.calls).toContain("stop");
  });

  it("stops at Ctrl+C, and stops NVDA and the browser", async () => {
    const driver = new StubDriver(["openPage"]);
    const controller = new AbortController();
    const check = runLiveCheck(driver, url, DEFAULT_CONFIG, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(check).rejects.toThrow(InterruptedError);
    expect(driver.calls).toContain("stop");
  });
});
