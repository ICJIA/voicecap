import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { VoicecapConfig } from "../src/config/schema.js";
import { GuidepupNvdaDriver, type GuidepupDriverDeps } from "../src/drivers/guidepup-nvda.js";
import { ForegroundError } from "../src/drivers/types.js";
import { EnvironmentError } from "../src/util/errors.js";
import { createMemoryLogger, type Logger } from "../src/util/log.js";
import { FakeDesktop, FakeNvda, FakeSession, Gate, type FakePage } from "./helpers/fake-desktop.js";

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
  const lockChecks: boolean[] = [];
  const awake = { requests: 0, held: 0 };
  const deps: GuidepupDriverDeps = {
    platform: options.platform ?? "win32",
    loadNvda: () => Promise.resolve(nvda),
    install: {
      build: "0.2.1-2026.2",
      cacheDir,
      nvdaExe: `${cacheDir}\\nvda\\all\\0.2.1-2026.2\\extracted\\nvda.exe`,
    },
    installed: () => options.installed ?? true,
    launchBrowser: async (signal) => {
      if (desktop.launchGate) {
        const launched = desktop.launchGate.wait();
        if (desktop.launchesOutliveKill) {
          await launched;
        } else {
          await Promise.race([
            launched,
            new Promise((_, reject) => {
              signal.addEventListener("abort", () => {
                desktop.events.push("browser:launch-killed");
                reject(new Error("Chrome didn't start: killed"));
              });
            }),
          ]);
        }
      }
      const session = new FakeSession(desktop, options.pages ?? {});
      desktop.sessions.push(session);
      desktop.events.push("browser:launch");
      return session;
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
    keepAwake: () => {
      awake.requests++;
      awake.held++;
      let released = false;
      return {
        release: () => {
          if (!released) awake.held--;
          released = true;
        },
      };
    },
    sessionLocked: () => {
      lockChecks.push(desktop.locked);
      return Promise.resolve(desktop.locked);
    },
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
  return { driver, desktop, nvda, logger: memory, deps, orphanCleanups, lockChecks, awake };
}

const URL_HOME = "http://127.0.0.1:4747/";

/** Lets pending work (the lock file's disk I/O included) run until the condition holds. */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition() && Date.now() < deadline) await delay(1);
  expect(condition()).toBe(true);
}

const keysSent = (desktop: FakeDesktop) =>
  desktop.events.filter((event) => event.startsWith("key:"));

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

  it("explains the same for a path with a character the command shell treats specially", async () => {
    const { driver, nvda } = setup({ cacheDir: "C:\\Users\\R&D\\AppData\\Local\\guidepup" });
    const start = driver.start();
    await expect(start).rejects.toThrow(EnvironmentError);
    await expect(start).rejects.toThrow(/"&".+GUIDEPUP_SCREEN_READERS_PATH/s);
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

  // The core's open timeout restarts the driver and retries the page; a shorter limit of the
  // driver's own would fail a slow page instead.
  it("leaves a slow load to the core's open timeout", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    expect(desktop.session.loadTimeouts).toEqual([0]);
  });

  it("won't go on with a browser that updated itself during the run", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.browserVersion = "154.0.8100.10";
    const open = driver.openPage(URL_HOME);
    await expect(open).rejects.toThrow(EnvironmentError);
    await expect(open).rejects.toThrow(/153\.0\.8010\.53.+154\.0\.8100\.10/);
    expect(desktop.sessions.at(-1)?.closed).toBe(true);
    expect(keysSent(desktop)).toEqual(["key:exitFocusMode", "key:toTop"]);
  });

  it("won't restart with a browser that updated itself either", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    await driver.stop();
    desktop.browserVersion = "154.0.8100.10";
    await expect(driver.start()).rejects.toThrow(EnvironmentError);
    expect(desktop.sessions.every((session) => session.closed)).toBe(true);
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

// When NVDA dies, Guidepup's commands stop reaching it and come back with no speech at all, which
// a pass would otherwise take for blank lines, or the end of the page.
describe("NVDA dying during a run", () => {
  it("fails a silent step with an EnvironmentError when NVDA isn't running any more", async () => {
    const { driver, nvda } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    nvda.crashed = true;
    await expect(driver.nextLine()).rejects.toThrow(EnvironmentError);
    await expect(driver.nextLine()).rejects.toThrow(/NVDA/);
  });

  it("takes silence at face value while NVDA is running", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.speech = () => "";
    expect(await driver.nextLine()).toBe("");
  });

  it("fails a silent Tab the same way, the first one included", async () => {
    const { driver, nvda } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    nvda.crashed = true;
    await expect(driver.nextFocusable()).rejects.toThrow(EnvironmentError);
  });

  it("says NVDA stopped, not that another window is in front, when NVDA+T gets no answer", async () => {
    const { driver, nvda } = setup();
    await driver.start();
    nvda.crashed = true;
    await expect(driver.openPage(URL_HOME)).rejects.toThrow(EnvironmentError);
  });
});

// Windows mustn't sleep, turn the screen off, or lock because of either while NVDA is in use.
describe("keeping Windows awake", () => {
  it("holds from start to stop", async () => {
    const { driver, awake } = setup();
    await driver.start();
    expect(awake.held).toBe(1);
    await driver.openPage(URL_HOME);
    await driver.stop();
    expect(awake.held).toBe(0);
  });

  it("lets go when the process exits", async () => {
    const { driver, awake } = setup();
    await driver.start();
    driver.abandon();
    expect(awake.held).toBe(0);
  });

  it("holds again after a restart, never twice at once", async () => {
    const { driver, awake } = setup();
    await driver.start();
    await driver.stop();
    await driver.start();
    expect(awake).toEqual({ requests: 2, held: 1 });
  });
});

// On a locked computer, Windows keeps NVDA from pressing keys, and NVDA says nothing.
describe("a locked computer", () => {
  it("is named, rather than another window being blamed, when NVDA+T gets no speech", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    desktop.locked = true;
    const open = driver.openPage(URL_HOME);
    await expect(open).rejects.toThrow(EnvironmentError);
    await expect(open).rejects.toThrow(/Windows is locked/);
  });

  it("fails a step with an EnvironmentError when Windows is locked during the run", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.locked = true;
    await expect(driver.nextLine()).rejects.toThrow(/Windows is locked/);
    await expect(driver.nextFocusable()).rejects.toThrow(/Windows is locked/);
  });

  // Seen on real Windows: locking it takes the page's focus, so the step looks like another window
  // came forward.
  it("is named when Windows locks during a step, which also takes the page's focus", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.locked = true;
    desktop.front = "other"; // the lock screen
    await expect(driver.nextLine()).rejects.toThrow(/Windows is locked/);
    await expect(driver.nextFocusable()).rejects.toThrow(/Windows is locked/);
  });

  it("is checked for only when NVDA said nothing where it should have spoken", async () => {
    const { driver, desktop, lockChecks } = setup();
    await driver.start();
    await driver.openPage(URL_HOME); // Escape is pressed without capturing speech
    expect(lockChecks).toEqual([]);
    desktop.speech = () => "";
    expect(await driver.nextLine()).toBe("");
    expect(lockChecks).toEqual([false]);
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

  it("leaves no timer behind once NVDA has stopped, so the process can exit", async () => {
    const { driver, deps } = setup();
    const settle = deps.sleep;
    const timeouts: AbortSignal[] = [];
    deps.sleep = (ms, signal) => {
      if (!signal) return settle(ms);
      timeouts.push(signal);
      return new Promise(() => {}); // a timeout that hasn't run out
    };
    await driver.start();
    await driver.stop();
    expect(timeouts).not.toEqual([]);
    expect(timeouts.every((signal) => signal.aborted)).toBe(true);
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

// The core stops the driver when it gives up on a call (a timeout, or Ctrl+C) without waiting for
// the call to finish, so a stop can arrive while the driver is in the middle of anything.
describe("stopping while the driver is busy", () => {
  it("shuts down NVDA that finished starting after the driver was told to stop", async () => {
    const { driver, desktop, nvda, deps } = setup();
    nvda.startGate = new Gate();
    const start = driver.start();
    start.catch(() => {});
    await until(() => desktop.events.includes("nvda:start"));
    const stopping = driver.stop();
    nvda.startGate.open();
    await stopping;
    await expect(start).rejects.toThrow(/stopped/);
    expect(nvda.started).toBe(false);
    expect(desktop.sessions.every((session) => session.closed)).toBe(true);
    const next = setup({ lockFile: deps.lockFile });
    await next.driver.start();
  });

  it("shuts NVDA down directly when it's still starting after a while", async () => {
    const { driver, desktop, nvda, deps } = setup();
    nvda.startGate = new Gate(); // never opens
    const start = driver.start();
    start.catch(() => {});
    await until(() => desktop.events.includes("nvda:start"));
    await driver.stop();
    expect(nvda.forceQuits).toBe(1);
    await expect(start).rejects.toThrow();
    expect(desktop.sessions).toEqual([]);
    const next = setup({ lockFile: deps.lockFile });
    await next.driver.start();
  });

  it("kills a browser that's still launching, without waiting for it", async () => {
    const { driver, desktop, deps } = setup();
    const settle = deps.sleep;
    deps.sleep = (ms, signal) => (signal ? new Promise(() => {}) : settle(ms)); // no time limit runs out
    await driver.start();
    await driver.openPage(URL_HOME);
    const launch = (desktop.launchGate = new Gate()); // never opens
    const open = driver.openPage(URL_HOME);
    open.catch(() => {});
    await until(() => launch.waiting > 0);
    await driver.stop();
    expect(desktop.events).toContain("browser:launch-killed");
    expect(desktop.sessions.map((session) => session.closed)).toEqual([true]);
    await expect(open).rejects.toThrow();
    expect(keysSent(desktop)).toEqual(["key:exitFocusMode", "key:toTop"]);
  });

  it("closes a browser that finished launching only after the driver had stopped", async () => {
    const { driver, desktop } = setup();
    desktop.launchesOutliveKill = true; // the kill came too late
    await driver.start();
    await driver.openPage(URL_HOME);
    const launch = (desktop.launchGate = new Gate());
    const open = driver.openPage(URL_HOME);
    open.catch(() => {});
    await until(() => launch.waiting > 0);
    await driver.stop();
    launch.open();
    await expect(open).rejects.toThrow(/stopped/);
    expect(desktop.sessions.map((session) => session.closed)).toEqual([true, true]);
  });

  it("waits for a browser that's still closing", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    const first = desktop.session;
    const closing = (first.closeGate = new Gate());
    void driver.openPage(URL_HOME).catch(() => {});
    await until(() => closing.waiting > 0);
    let stopped = false;
    const stopping = driver.stop().then(() => {
      stopped = true;
    });
    await until(() => desktop.sessions[1]?.closed === true);
    await delay(100);
    expect(stopped).toBe(false);
    closing.open();
    await stopping;
    expect(first.closed).toBe(true);
  });

  it("sends no key for a step still in progress when the driver restarted", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    const focus = (desktop.session.focusGate = new Gate());
    const step = driver.nextLine();
    step.catch(() => {});
    await until(() => focus.waiting > 0);
    await driver.stop();
    await driver.start();
    await driver.openPage(URL_HOME);
    const keys = keysSent(desktop);
    focus.open();
    await expect(step).rejects.toThrow(/stopped/);
    expect(keysSent(desktop)).toEqual(keys);
  });

  // Guidepup sends a command's key only once NVDA has fallen silent, and its stop waits for the
  // command. Closing the page first would end the silence wait with another window in front.
  it("doesn't let a command still waiting for NVDA to fall silent type into another window", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.pageKeepsTalking = true;
    void driver.nextLine().catch(() => {});
    await until(() => desktop.events.includes("hung:nextLine"));
    await driver.stop();
    expect(desktop.strayKeys).toEqual([]);
    expect(desktop.sessions.every((session) => session.closed)).toBe(true);
  });

  it("shuts NVDA down at once rather than wait for a command that can't finish", async () => {
    const { driver, desktop, deps } = setup();
    const settle = deps.sleep;
    deps.sleep = (ms, signal) => (signal ? new Promise(() => {}) : settle(ms)); // no time limit runs out
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.pageKeepsTalking = true;
    void driver.nextLine().catch(() => {});
    await until(() => desktop.events.includes("hung:nextLine"));
    await driver.stop();
    expect(desktop.strayKeys).toEqual([]);
  });

  it("doesn't let a start that outlived its stop shut down the next start's NVDA", async () => {
    const { driver, desktop, nvda } = setup();
    desktop.launchesOutliveKill = true;
    const launch = (desktop.launchGate = new Gate());
    const first = driver.start();
    first.catch(() => {});
    await until(() => launch.waiting > 0);
    await driver.stop(); // its wait for the first start runs out
    desktop.launchGate = null;
    await driver.start();
    launch.open(); // the first start's browser arrives only now
    await expect(first).rejects.toThrow(/stopped/);
    expect(nvda.started).toBe(true);
    await driver.openPage(URL_HOME);
  });

  it("kills every browser when the process exits, including one still closing", async () => {
    const { driver, desktop, nvda } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    const closing = (desktop.session.closeGate = new Gate());
    void driver.openPage(URL_HOME).catch(() => {});
    await until(() => closing.waiting > 0);
    driver.abandon();
    expect(desktop.sessions.map((session) => session.killed)).toEqual([true, true]);
    expect(nvda.forceQuits).toBe(1);
    closing.open();
  });

  it("shuts NVDA down directly when the process exits while it's starting", async () => {
    const { driver, desktop, nvda } = setup();
    nvda.startGate = new Gate();
    void driver.start().catch(() => {});
    await until(() => desktop.events.includes("nvda:start"));
    driver.abandon();
    expect(nvda.forceQuits).toBe(1);
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
    expect(notes[0]).toMatch(/didn't shut down cleanly/);
    // The dead run's lock is now this run's.
    expect(readFileSync(deps.lockFile, "utf8")).not.toMatch(/2000-01-01/);
  });

  it("leaves another live run's NVDA and browsers alone", async () => {
    const first = setup();
    await first.driver.start();
    const second = setup({ lockFile: first.deps.lockFile });
    await expect(second.driver.cleanupStale()).rejects.toThrow(/process \d+/);
    expect(second.orphanCleanups).toEqual([]);
  });

  it("takes the NVDA lock before cleaning up, so a voicecap starting meanwhile can't be disturbed", async () => {
    const first = setup();
    await first.driver.cleanupStale();
    const second = setup({ lockFile: first.deps.lockFile });
    await expect(second.driver.cleanupStale()).rejects.toThrow(EnvironmentError);
    await expect(second.driver.start()).rejects.toThrow(EnvironmentError);
    expect(second.orphanCleanups).toEqual([]);
    await first.driver.start();
    await first.driver.stop();
    await second.driver.start();
  });

  it("says where the NVDA lock is, in case one was left behind", async () => {
    const first = setup();
    await first.driver.start();
    const second = setup({ lockFile: first.deps.lockFile });
    await expect(second.driver.start()).rejects.toThrow(first.deps.lockFile);
  });
});
