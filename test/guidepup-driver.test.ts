import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { VoicecapConfig } from "../src/config/schema.js";
import { GuidepupNvdaDriver, type GuidepupDriverDeps } from "../src/drivers/guidepup-nvda.js";
import { ForegroundError } from "../src/drivers/types.js";
import { EnvironmentError } from "../src/util/errors.js";
import { createMemoryLogger, type Logger } from "../src/util/log.js";
import { FakeDesktop, FakeNvda, FakeSession, type FakePage } from "./helpers/fake-desktop.js";

const temps: string[] = [];
const drivers: GuidepupNvdaDriver[] = [];
afterEach(async () => {
  for (const driver of drivers.splice(0)) await driver.stop();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Setup {
  platform?: NodeJS.Platform;
  installed?: boolean;
  cacheDir?: string;
  running?: number[];
  pages?: Record<string, FakePage>;
  lockFile?: string;
  config?: Partial<VoicecapConfig>;
}

function setup(options: Setup = {}) {
  const desktop = new FakeDesktop();
  const nvda = new FakeNvda(desktop);
  const memory = createMemoryLogger();
  const logger: Logger = {
    ...memory,
    alert: (message) => {
      desktop.events.push("alert");
      memory.alert(message);
    },
  };
  let lockFile = options.lockFile;
  if (!lockFile) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "voicecap-driver-test-"));
    temps.push(dir);
    lockFile = path.join(dir, "nvda.lock");
  }
  const cacheDir = options.cacheDir ?? "C:\\Users\\pat\\AppData\\Local\\guidepup";
  const orphanCleanups: string[] = [];
  const deps: GuidepupDriverDeps = {
    platform: options.platform ?? "win32",
    loadNvda: () => Promise.resolve(nvda),
    install: {
      build: "0.2.1-2026.2",
      cacheDir,
      nvdaExe: `${cacheDir}\\nvda\\all\\0.2.1-2026.2\\extracted\\nvda.exe`,
    },
    installed: () => options.installed ?? true,
    launchBrowser: () => {
      const session = new FakeSession(desktop, options.pages ?? {});
      desktop.sessions.push(session);
      desktop.events.push("browser:launch");
      return Promise.resolve(session);
    },
    runningNvda: () => {
      desktop.events.push("tasklist");
      return Promise.resolve(options.running ?? []);
    },
    lockFile,
    system: () => ({
      os: "Windows 11 Pro 25H2 (10.0.26200)",
      uiLocale: "en-US",
      guidepupVersion: "0.34.0",
    }),
    cleanupOrphans: () => {
      orphanCleanups.push("cleaned");
      return Promise.resolve(["Closed 2 browser processes left by an earlier run."]);
    },
    // Waits end on the next turn of the event loop, after anything already settled.
    sleep: () => new Promise((resolve) => setImmediate(resolve)),
    marker: () => "k3m9x2",
  };
  const config = { ...DEFAULT_CONFIG, ...options.config };
  const driver = new GuidepupNvdaDriver({ config, logger }, deps);
  drivers.push(driver);
  return { driver, desktop, nvda, logger: memory, deps, orphanCleanups };
}

const URL_HOME = "http://127.0.0.1:4747/";

describe("starting the Guidepup NVDA driver", () => {
  it("refuses to start anywhere but Windows", async () => {
    const { driver, nvda } = setup({ platform: "darwin" });
    await expect(driver.start()).rejects.toThrow(EnvironmentError);
    expect(nvda.started).toBe(false);
  });

  it("tells you to run voicecap setup when Guidepup's NVDA isn't installed", async () => {
    const { driver, nvda } = setup({ installed: false });
    await expect(driver.start()).rejects.toThrow(/voicecap setup/);
    expect(nvda.started).toBe(false);
  });

  it("explains that Guidepup can't start NVDA from a folder whose path has a space", async () => {
    const { driver, nvda } = setup({ cacheDir: "C:\\Users\\Jane Doe\\AppData\\Local\\guidepup" });
    const start = driver.start();
    await expect(start).rejects.toThrow(EnvironmentError);
    await expect(start).rejects.toThrow(/GUIDEPUP_SCREEN_READERS_PATH/);
    expect(nvda.started).toBe(false);
  });

  it("warns before shutting down an NVDA that's already running", async () => {
    const { driver, desktop, logger } = setup({ running: [4321] });
    await driver.start();
    expect(logger.text("alert")).toMatch(/4321/);
    expect(desktop.events.indexOf("alert")).toBeLessThan(desktop.events.indexOf("nvda:start"));
  });

  it("doesn't warn when no other NVDA is running", async () => {
    const { driver, logger } = setup({ running: [] });
    await driver.start();
    expect(logger.text("alert")).toBe("");
  });

  it("starts NVDA with the configured capture mode and settings overrides", async () => {
    const { driver, nvda } = setup({
      config: { capture: "initial", nvdaSettings: { speech: { oneCore: { rate: 60 } } } },
    });
    await driver.start();
    expect(nvda.startOptions).toEqual({
      capture: "initial",
      settings: { speech: { oneCore: { rate: 60 } } },
    });
  });

  it("lets only one voicecap drive NVDA at a time on this computer", async () => {
    const first = setup();
    await first.driver.start();
    const second = setup({ lockFile: first.deps.lockFile });
    await expect(second.driver.start()).rejects.toThrow(/process \d+/);
    expect(second.nvda.started).toBe(false);
    await first.driver.stop();
    await second.driver.start();
    expect(second.nvda.started).toBe(true);
  });
});

describe("opening a page", () => {
  it("brings the browser to the front, checked with NVDA+T, before sending any key", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    desktop.front = "other";
    const info = await driver.openPage(URL_HOME);
    expect(desktop.front).toBe("browser");
    expect(desktop.strayKeys).toEqual([]);
    expect(desktop.events).toContain("raise");
    expect(info).toMatchObject({ finalUrl: URL_HOME, status: 200, title: "Fake page" });
  });

  it("raises the browser before asking NVDA anything, as another window may keep NVDA talking", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    desktop.front = "other";
    desktop.otherKeepsTalking = true;
    await driver.openPage(URL_HOME);
    expect(desktop.events.filter((event) => event.startsWith("hung:"))).toEqual([]);
    expect(desktop.front).toBe("browser");
  });

  it("doesn't trust the page's own focus report before its window has been in front", async () => {
    const { driver, desktop } = setup();
    desktop.front = "other"; // the browser starts behind another window, yet claims focus
    await driver.start();
    await driver.openPage(URL_HOME);
    expect(desktop.strayKeys).toEqual([]);
    expect(desktop.events).toContain("raise");
  });

  it("restores the page's title after checking the window", async () => {
    const { driver, desktop } = setup({ pages: { [URL_HOME]: { title: "Home | Agency" } } });
    await driver.start();
    await driver.openPage(URL_HOME);
    expect(desktop.session.title).toBe("Home | Agency");
    expect(desktop.events).toContain("title:voicecap check k3m9x2");
  });

  it("fails the page with a ForegroundError, typing nothing, when the browser can't come forward", async () => {
    const { driver, desktop, logger } = setup();
    await driver.start();
    desktop.front = "other";
    desktop.raiseWorks = false;
    const open = driver.openPage(URL_HOME);
    await expect(open).rejects.toBeInstanceOf(ForegroundError);
    await expect(open).rejects.not.toThrow(/Outlook/);
    expect(desktop.strayKeys).toEqual([]);
    // The window in front is named on the console only, not in the recorded error.
    expect(logger.text()).toMatch(/Inbox - Outlook/);
  });

  it("moves NVDA to the top of the page, out of focus mode", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    const keys = desktop.events.filter((event) => event.startsWith("key:"));
    expect(keys).toEqual(["key:exitFocusMode", "key:toTop"]);
  });

  it("returns straight after loading a response that isn't HTML", async () => {
    const pdf = "http://127.0.0.1:4747/files/report.pdf";
    const { driver, desktop } = setup({ pages: { [pdf]: { contentType: "application/pdf" } } });
    await driver.start();
    const info = await driver.openPage(pdf);
    expect(info.contentType).toBe("application/pdf");
    expect(desktop.events.filter((event) => event.startsWith("key:"))).toEqual([]);
  });

  it("gives each load a fresh browser, so no page sees another's history", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    await driver.openPage(URL_HOME);
    expect(desktop.sessions).toHaveLength(2);
    expect(desktop.sessions[0]?.closed).toBe(true);
    expect(desktop.sessions[1]?.closed).toBe(false);
  });
});

describe("steps", () => {
  it("returns what NVDA said in response to each command", async () => {
    const { driver, desktop } = setup();
    desktop.speech = (key) => `said after ${key}`;
    await driver.start();
    await driver.openPage(URL_HOME);
    expect(await driver.toBottom()).toBe("said after toBottom");
    expect(await driver.toTop()).toBe("said after toTop");
    expect(await driver.nextLine()).toBe("said after nextLine");
    expect(await driver.nextHeading()).toBe("said after nextHeading");
  });

  it("sends no key when another window has taken the foreground", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.front = "other";
    await expect(driver.nextLine()).rejects.toBeInstanceOf(ForegroundError);
    expect(desktop.strayKeys).toEqual([]);
  });

  it("discards a step during which another window took the foreground", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.speech = () => {
      desktop.front = "other";
      return "Inbox - Outlook, window. 3 unread messages";
    };
    await expect(driver.nextLine()).rejects.toBeInstanceOf(ForegroundError);
  });
});

describe("brief focus losses", () => {
  it("discards a step during which another window came forward and went away again", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.speech = () => {
      desktop.front = "other";
      desktop.front = "browser";
      return "link, Data. MOVIES 01 - Shortcut. TV 01 - Shortcut";
    };
    await expect(driver.nextLine()).rejects.toBeInstanceOf(ForegroundError);
  });

  it("doesn't mistake a page that reloads itself for another window coming forward", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.front = "other";
    desktop.front = "browser";
    desktop.speech = (_key, session) => {
      session.reloadDocument();
      return "heading, level 1, Welcome";
    };
    expect(await driver.nextLine()).toBe("heading, level 1, Welcome");
  });

  it("discards such a Tab too, rather than ending the tab pass", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    await driver.nextFocusable();
    desktop.speech = () => {
      desktop.front = "other";
      desktop.front = "browser";
      return "Contact, link. Desktop. View";
    };
    await expect(driver.nextFocusable()).rejects.toBeInstanceOf(ForegroundError);
  });
});

describe("the tab pass", () => {
  it("sends the first Tab through the browser, so NVDA's cursor can't skip the first element", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    await driver.nextFocusable();
    await driver.nextFocusable();
    await driver.nextFocusable();
    expect(desktop.session.chromeTabs).toBe(1);
    expect(desktop.events.filter((event) => event === "key:tab")).toHaveLength(2);
  });

  it("returns what NVDA said for the first Tab too", async () => {
    const { driver, desktop } = setup();
    desktop.speech = (key) => (key === "tab" ? "Skip to main content, same page, link" : "");
    await driver.start();
    await driver.openPage(URL_HOME);
    expect(await driver.nextFocusable()).toBe("Skip to main content, same page, link");
  });

  it("starts over with the browser's Tab after every load", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    await driver.nextFocusable();
    await driver.openPage(URL_HOME);
    await driver.nextFocusable();
    expect(desktop.sessions.map((session) => session.chromeTabs)).toEqual([1, 1]);
  });

  it("reports focus leaving the page for the browser's own toolbar", async () => {
    const { driver, desktop } = setup();
    desktop.speech = (key, session) =>
      key === "tab" && session.inToolbar ? "Tab search, button, collapsed" : `${key} speech`;
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.session.tabLeavesPage = (tab) => tab === 3;
    await driver.nextFocusable();
    expect(await driver.focusInDocument()).toBe(true);
    await driver.nextFocusable();
    expect(await driver.nextFocusable()).toBe("Tab search, button, collapsed");
    expect(await driver.focusInDocument()).toBe(false);
  });

  it("treats focus moving to another window as a foreground error, not the end of the page", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    await driver.nextFocusable();
    desktop.beforeKey = () => {
      desktop.front = "other";
    };
    await expect(driver.nextFocusable()).rejects.toBeInstanceOf(ForegroundError);
  });

  it("passes on the focused element as the browser sees it", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.session.focused = {
      tag: "a",
      role: "link",
      name: "Skip to main content",
      inMain: false,
      href: "#main",
    };
    expect(await driver.focusedElement()).toEqual({
      tag: "a",
      role: "link",
      name: "Skip to main content",
      inMain: false,
      href: "#main",
    });
  });
});

describe("stopping", () => {
  it("closes the browser and stops NVDA, and can be called again", async () => {
    const { driver, desktop, nvda } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    await driver.stop();
    await driver.stop();
    expect(desktop.session.closed).toBe(true);
    expect(nvda.started).toBe(false);
    expect(desktop.events.filter((event) => event === "nvda:stop")).toHaveLength(1);
  });

  it("shuts NVDA down without Guidepup when Guidepup's stop hangs", async () => {
    const { driver, nvda } = setup();
    await driver.start();
    nvda.stopHangs = true;
    await driver.stop();
    expect(nvda.forceQuits).toBe(1);
    expect(nvda.started).toBe(false);
  });

  it("shuts NVDA and the browser down at once when the process is exiting", async () => {
    const { driver, desktop, nvda } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    driver.abandon();
    expect(nvda.forceQuits).toBe(1);
    expect(desktop.events).toContain("browser:kill");
  });

  it("can start again after stopping (a restart)", async () => {
    const { driver, nvda } = setup();
    await driver.start();
    await driver.stop();
    await driver.start();
    expect(nvda.started).toBe(true);
  });
});

describe("the environment record", () => {
  it("records Guidepup's build, the NVDA version in it, the language, and the browser", async () => {
    const { driver } = setup();
    await driver.start();
    const info = await driver.getEnvironmentInfo();
    expect(info).toMatchObject({
      driver: { name: "guidepup", version: "0.34.0" },
      screenReader: { name: "NVDA", version: "2026.2", build: "0.2.1-2026.2", language: "en-US" },
      capture: "complete",
      browser: { name: "Chrome", version: "153.0.8010.53" },
      os: "Windows 11 Pro 25H2 (10.0.26200)",
    });
  });

  it("records NVDA's speech-related settings, saying they're only the non-default values", async () => {
    const { driver } = setup();
    await driver.start();
    const { screenReaderSettings } = await driver.getEnvironmentInfo();
    expect(screenReaderSettings).toEqual({
      recorded:
        "only settings that differ from NVDA 2026.2's defaults (Guidepup's configuration plus voicecap's nvdaSettings)",
      speech: { synth: "oneCore" },
      documentFormatting: {},
      virtualBuffers: { autoSayAllOnPageLoad: false },
      keyboard: {},
      general: { language: "Windows", loggingLevel: "OFF" },
    });
  });
});

describe("cleaning up after a crashed run", () => {
  it("closes browsers left behind when the last run didn't release NVDA", async () => {
    const { driver, deps, orphanCleanups } = setup();
    writeFileSync(
      deps.lockFile,
      JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: "2000-01-01T00:00:00Z" }),
    );
    const notes = await driver.cleanupStale();
    expect(orphanCleanups).toHaveLength(1);
    expect(notes).toContain("Closed 2 browser processes left by an earlier run.");
    expect(existsSync(deps.lockFile)).toBe(false);
  });

  it("leaves another live run's browsers alone", async () => {
    const first = setup();
    await first.driver.start();
    const second = setup({ lockFile: first.deps.lockFile });
    expect(await second.driver.cleanupStale()).toEqual([]);
    expect(second.orphanCleanups).toEqual([]);
    await first.driver.stop();
  });
});
