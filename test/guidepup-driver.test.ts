import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { VoicecapConfig } from "../src/config/schema.js";
import {
  createGuidepupNvdaDriver,
  GuidepupNvdaDriver,
  type GuidepupDriverDeps,
} from "../src/drivers/guidepup-nvda.js";
import { cleanNvdaLog } from "../src/drivers/guidepup/nvda-log.js";
import { ForegroundError, type EventRecorder } from "../src/drivers/types.js";
import type { NewRunEvent } from "../src/model.js";
import { openEventLog, readEventLog } from "../src/run/events.js";
import { EnvironmentError } from "../src/util/errors.js";
import { createMemoryLogger, type Logger } from "../src/util/log.js";
import { isoLocalMs } from "../src/util/time.js";
import { FakeDesktop, FakeNvda, FakeSession, Gate, type FakePage } from "./helpers/fake-desktop.js";

/** The account's home folder, which a cleaned copy of NVDA's log writes as %USERPROFILE%. */
const HOME = "C:\\Users\\pat";

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
    // Guidepup's NVDA has a process only once it has started.
    screenReaderPid: () => Promise.resolve(nvda.started ? nvda.pid : null),
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
    foregroundWindow: () => desktop.foregroundWindow(),
    cleanupOrphans: () => {
      orphanCleanups.push("cleaned");
      return Promise.resolve(["Closed 2 browser processes left by an earlier run."]);
    },
    ownNvda: () => desktop.findOwnNvda(),
    restartNvda: (exe) => desktop.restartNvda(exe),
    restartNvdaDetached: (exe) => desktop.restartNvdaDetached(exe),
    readNvdaLog: () => desktop.readNvdaLog(),
    home: HOME,
    // Waits end on the next turn of the event loop, after anything already settled.
    sleep: () => new Promise((resolve) => setImmediate(resolve)),
    marker: () => "k3m9x2",
    now: () => new Date(),
  };
  const config = { ...DEFAULT_CONFIG, ...options.config };
  const driver = new GuidepupNvdaDriver({ config, logger }, deps);
  drivers.push(driver);
  return { driver, desktop, nvda, logger: memory, deps, orphanCleanups, lockChecks, awake };
}

/** A recorder that keeps what it's given. */
function keepEvents(): EventRecorder & { events: NewRunEvent[]; types(): string[] } {
  const events: NewRunEvent[] = [];
  return {
    events,
    record: (event) => {
      events.push(event);
    },
    types: () => events.map((event) => event.type),
  };
}

/** setup(), with a recorder given to the driver, as a run gives it. */
function recording(options: Setup = {}) {
  const made = setup(options);
  const recorder = keepEvents();
  made.driver.setEventRecorder(recorder);
  return { ...made, recorder };
}

/**
 * A recorder that keeps the cleaned copies of NVDA's log it's handed, too: what a run's event log
 * is, and the only kind a driver reads NVDA's log for.
 */
function keepLogs(): ReturnType<typeof keepEvents> & { logs: string[] } {
  const logs: string[] = [];
  return {
    ...keepEvents(),
    logs,
    screenReaderLog: (cleaned) => {
      logs.push(cleaned);
    },
  };
}

/** recording(), with a recorder that keeps NVDA's log. */
function recordingLogs(options: Setup = {}) {
  const made = setup(options);
  const recorder = keepLogs();
  made.driver.setEventRecorder(recorder);
  return { ...made, recorder };
}

/** The events of these types, in the order they were recorded. */
function only(events: NewRunEvent[], ...types: NewRunEvent["type"][]): NewRunEvent[] {
  return events.filter((event) => types.includes(event.type));
}

const URL_HOME = "http://127.0.0.1:4747/";
/** The person's own NVDA, installed: not Guidepup's copy. */
const OWN_NVDA = "C:\\Program Files (x86)\\NVDA\\nvda.exe";

/** Lets pending work (the lock file's disk I/O included) run until the condition holds. */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition() && Date.now() < deadline) await delay(1);
  expect(condition()).toBe(true);
}

const keysSent = (desktop: FakeDesktop) =>
  desktop.events.filter((event) => event.startsWith("key:"));

/** How many times the driver has asked Windows which window is in front. */
const lookups = (desktop: FakeDesktop) =>
  desktop.events.filter((event) => event === "foreground:look").length;

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
    // Its path isn't known (another user's NVDA, say), so voicecap can't start it again.
    expect(logger.text("alert")).toMatch(/ Start your NVDA again when voicecap has finished\.$/);
    expect(desktop.events.indexOf("alert")).toBeLessThan(desktop.events.indexOf("nvda:start"));
  });

  it("says it will turn the person's NVDA back on when it knows where that NVDA runs from", async () => {
    const { driver, desktop, logger } = setup({ running: [4321] });
    desktop.ownNvda = [OWN_NVDA];
    await driver.start();
    expect(logger.text("alert")).toBe(
      "NVDA is running (process 4321). voicecap shuts it down now and starts its own copy (Guidepup's NVDA 0.2.1-2026.2). voicecap will turn your NVDA back on when it has finished.",
    );
    expect(desktop.events.indexOf("alert")).toBeLessThan(desktop.events.indexOf("nvda:start"));
  });

  it("doesn't warn when no other NVDA is running", async () => {
    const { driver, logger } = setup({ running: [] });
    await driver.start();
    expect(logger.text("alert")).toBe("");
  });

  it("starts NVDA with the configured capture mode and settings overrides, and its log turned on", async () => {
    const { driver, nvda } = setup({
      config: { capture: "initial", nvdaSettings: { speech: { oneCore: { rate: 60 } } } },
    });
    await driver.start();
    expect(nvda.startOptions).toEqual({
      capture: "initial",
      settings: { speech: { oneCore: { rate: 60 } }, general: { loggingLevel: "IO" } },
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
    await expect(open).rejects.toMatchObject({ failure: "foreground" });
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

  it("reports the address of the page's canonical tag, and null when it has none", async () => {
    const tagged = "https://dvfr.illinois.gov/";
    const { driver } = setup({ pages: { [URL_HOME]: { canonical: tagged } } });
    await driver.start();
    expect((await driver.openPage(URL_HOME)).canonical).toBe(tagged);
    expect((await driver.openPage(`${URL_HOME}duplicates/`)).canonical).toBeNull();
  });

  it("reports no title or tag for a response that isn't HTML, whatever the browser holds", async () => {
    const pdf = "http://127.0.0.1:4747/files/report.pdf";
    const { driver } = setup({
      pages: {
        [pdf]: {
          contentType: "application/pdf",
          title: "Annual report",
          canonical: "https://dvfr.illinois.gov/files/report.pdf",
        },
      },
    });
    await driver.start();
    expect(await driver.openPage(pdf)).toMatchObject({ title: null, canonical: null });
  });

  describe("taking the page's screenshot", () => {
    // The driver hands the picture on as the browser gave it; the run is what reads it.
    const HOME_PICTURE = Uint8Array.of(1, 2, 3);
    const DUPLICATES = `${URL_HOME}duplicates/`;
    const DUPLICATES_PICTURE = Uint8Array.of(4, 5, 6);
    const pictures = {
      [URL_HOME]: { screenshot: HOME_PICTURE },
      [DUPLICATES]: { screenshot: DUPLICATES_PICTURE },
    };

    it("returns the browser's screenshot of the page that loaded", async () => {
      const { driver } = setup({ pages: pictures });
      await driver.start();
      expect((await driver.openPage(URL_HOME)).screenshot).toEqual({ jpeg: HOME_PICTURE });
      // Each page's own: the one of the page this load is of.
      expect((await driver.openPage(DUPLICATES)).screenshot).toEqual({ jpeg: DUPLICATES_PICTURE });
    });

    it("takes it as the page loaded, before bringing the browser to the front or pressing a key", async () => {
      const { driver, desktop } = setup({ pages: pictures });
      await driver.start();
      desktop.front = "other";
      await driver.openPage(URL_HOME);
      const { events } = desktop;
      expect(events.filter((event) => event === "screenshot")).toHaveLength(1);
      expect(events.indexOf("screenshot")).toBeLessThan(events.indexOf("raise"));
      expect(events.indexOf("screenshot")).toBeLessThan(
        events.findIndex((event) => event.startsWith("key:")),
      );
    });

    it("gives the reason when the screenshot can't be taken, and the page opens all the same", async () => {
      const failure = new Error("Protocol error (Page.captureScreenshot): Target closed");
      const { driver, desktop } = setup({ pages: { [URL_HOME]: { screenshot: failure } } });
      await driver.start();
      const info = await driver.openPage(URL_HOME);
      expect(info.screenshot).toEqual({ error: failure.message });
      expect(info).toMatchObject({ finalUrl: URL_HOME, status: 200, title: "Fake page" });
      expect(keysSent(desktop)).toEqual(["key:exitFocusMode", "key:toTop"]);
    });

    it("takes none of a response that isn't HTML", async () => {
      const pdf = "http://127.0.0.1:4747/files/report.pdf";
      const { driver, desktop } = setup({ pages: { [pdf]: { contentType: "application/pdf" } } });
      await driver.start();
      const info = await driver.openPage(pdf);
      expect(info).not.toHaveProperty("screenshot");
      expect(desktop.events).not.toContain("screenshot");
    });
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
    await expect(open).rejects.toMatchObject({ failure: "browser" });
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
    const start = driver.start();
    await expect(start).rejects.toThrow(EnvironmentError);
    await expect(start).rejects.toMatchObject({ failure: "browser" });
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
    const step = driver.nextLine();
    await expect(step).rejects.toBeInstanceOf(ForegroundError);
    await expect(step).rejects.toMatchObject({ failure: "foreground" });
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
    const step = driver.nextLine();
    await expect(step).rejects.toBeInstanceOf(ForegroundError);
    await expect(step).rejects.toMatchObject({ failure: "foreground" });
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
    const step = driver.nextLine();
    await expect(step).rejects.toThrow(EnvironmentError);
    await expect(step).rejects.toThrow(/NVDA/);
    await expect(step).rejects.toMatchObject({ failure: "screen-reader-stopped" });
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
    const tab = driver.nextFocusable();
    await expect(tab).rejects.toThrow(EnvironmentError);
    await expect(tab).rejects.toMatchObject({ failure: "screen-reader-stopped" });
  });

  it("says NVDA stopped, not that another window is in front, when NVDA+T gets no answer", async () => {
    const { driver, nvda } = setup();
    await driver.start();
    nvda.crashed = true;
    const open = driver.openPage(URL_HOME);
    await expect(open).rejects.toThrow(EnvironmentError);
    await expect(open).rejects.toMatchObject({ failure: "screen-reader-stopped" });
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
    await expect(open).rejects.toMatchObject({ failure: "locked" });
  });

  it("fails a step with an EnvironmentError when Windows is locked during the run", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.locked = true;
    const line = driver.nextLine();
    await expect(line).rejects.toThrow(/Windows is locked/);
    await expect(line).rejects.toMatchObject({ failure: "locked" });
    const tab = driver.nextFocusable();
    await expect(tab).rejects.toThrow(/Windows is locked/);
    await expect(tab).rejects.toMatchObject({ failure: "locked" });
  });

  // Seen on real Windows: locking it takes the page's focus, so the step looks like another window
  // came forward.
  it("is named when Windows locks during a step, which also takes the page's focus", async () => {
    const { driver, desktop } = setup();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.locked = true;
    desktop.front = "other"; // the lock screen
    const line = driver.nextLine();
    await expect(line).rejects.toThrow(/Windows is locked/);
    await expect(line).rejects.toMatchObject({ failure: "locked" });
    const tab = driver.nextFocusable();
    await expect(tab).rejects.toThrow(/Windows is locked/);
    await expect(tab).rejects.toMatchObject({ failure: "locked" });
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
    const step = driver.nextLine();
    await expect(step).rejects.toBeInstanceOf(ForegroundError);
    await expect(step).rejects.toMatchObject({ failure: "foreground" });
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
    const tab = driver.nextFocusable();
    await expect(tab).rejects.toBeInstanceOf(ForegroundError);
    await expect(tab).rejects.toMatchObject({ failure: "foreground" });
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
    const tab = driver.nextFocusable();
    await expect(tab).rejects.toBeInstanceOf(ForegroundError);
    await expect(tab).rejects.toMatchObject({ failure: "foreground" });
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

// Starting Guidepup's NVDA shuts down any other NVDA, including the one a blind person uses every
// day, so voicecap starts theirs again afterwards.
describe("turning the person's own NVDA back on", () => {
  it("starts it again once NVDA and the browser are down, and only once when stopped twice", async () => {
    const { driver, desktop, logger } = setup();
    desktop.ownNvda = [OWN_NVDA];
    await driver.start();
    expect(desktop.ownNvda).toEqual([]); // Guidepup's NVDA shut it down
    await driver.openPage(URL_HOME);
    await driver.stop();
    await driver.stop();
    expect(desktop.restarts).toEqual([OWN_NVDA]);
    expect(desktop.ownNvda).toEqual([OWN_NVDA]);
    const restarted = desktop.events.indexOf(`own-nvda:restart:${OWN_NVDA}`);
    expect(restarted).toBeGreaterThan(desktop.events.indexOf("nvda:stop"));
    expect(restarted).toBeGreaterThan(desktop.events.lastIndexOf("browser:close"));
    expect(logger.text("info")).toContain(`Turned your NVDA back on (${OWN_NVDA}).`);
  });

  it("says it's back on only once Windows has started it", async () => {
    const { driver, desktop, logger } = setup();
    desktop.ownNvda = [OWN_NVDA];
    const starting = (desktop.restartGate = new Gate());
    await driver.start();
    const stopping = driver.stop();
    await until(() => starting.waiting > 0);
    expect(logger.text("info")).not.toContain("Turned your NVDA back on");
    starting.open();
    await stopping;
    expect(logger.text("info")).toContain(`Turned your NVDA back on (${OWN_NVDA}).`);
  });

  it("starts it again without waiting when the process exits, once NVDA and the browser are shut down", async () => {
    const { driver, desktop, logger } = setup();
    desktop.ownNvda = [OWN_NVDA];
    await driver.start();
    await driver.openPage(URL_HOME);
    driver.abandon();
    expect(desktop.restarts).toEqual([OWN_NVDA]);
    const restarted = desktop.events.indexOf(`own-nvda:restart-detached:${OWN_NVDA}`);
    expect(restarted).toBeGreaterThan(desktop.events.indexOf("nvda:force-quit"));
    expect(restarted).toBeGreaterThan(desktop.events.indexOf("browser:kill"));
    // Nothing waits for it, so nothing claims it's back on.
    expect(logger.text("info")).not.toContain("Turned your NVDA back on");
    driver.abandon();
    await driver.stop();
    expect(desktop.restarts).toEqual([OWN_NVDA]);
  });

  it("starts it again without waiting if the process exits while an earlier start is under way", async () => {
    const { driver, desktop } = setup();
    desktop.ownNvda = [OWN_NVDA];
    const starting = (desktop.restartGate = new Gate());
    await driver.start();
    const stopping = driver.stop();
    await until(() => starting.waiting > 0);
    // The PowerShell starting it ends with voicecap, so that start may never happen.
    driver.abandon();
    expect(desktop.events).toContain(`own-nvda:restart-detached:${OWN_NVDA}`);
    starting.open();
    await stopping;
    expect(desktop.restarts).toEqual([OWN_NVDA, OWN_NVDA]);
  });

  it("starts nothing when none of the person's own NVDA was running", async () => {
    const { driver, desktop, logger } = setup();
    await driver.start();
    // Asked before Guidepup's NVDA starts, which would shut the person's down.
    const beforeStart = desktop.events.slice(0, desktop.events.indexOf("nvda:start"));
    expect(beforeStart).toContain("own-nvda:find");
    await driver.stop();
    driver.abandon();
    expect(desktop.restarts).toEqual([]);
    expect(logger.text("info")).not.toContain("NVDA back on");
  });

  it("says how to start it when it can't be started again, and still finishes stopping", async () => {
    const { driver, desktop, logger, deps } = setup();
    desktop.ownNvda = [OWN_NVDA];
    desktop.restartFails = true;
    await driver.start();
    await driver.stop();
    expect(desktop.restarts).toEqual([OWN_NVDA]);
    expect(logger.text("warn")).toContain(
      "Couldn't turn your NVDA back on (PowerShell didn't start it). Start it the way you usually do: an installed NVDA starts with Ctrl+Alt+N.",
    );
    expect(logger.text("info")).not.toContain("Turned your NVDA back on");
    // The NVDA lock was released all the same.
    await setup({ lockFile: deps.lockFile }).driver.start();
  });

  it("says the same, without throwing, when that happens as the process exits", async () => {
    const { driver, desktop, logger } = setup();
    desktop.ownNvda = [OWN_NVDA];
    desktop.restartFails = true;
    await driver.start();
    expect(() => driver.abandon()).not.toThrow();
    expect(logger.text("warn")).toContain(
      "Couldn't turn your NVDA back on (spawn EINVAL). Start it the way you usually do: an installed NVDA starts with Ctrl+Alt+N.",
    );
  });

  it("still starts when Windows can't tell whether the person's NVDA is running", async () => {
    const { driver, desktop, nvda } = setup();
    desktop.ownNvdaFails = true;
    await driver.start();
    expect(desktop.events).toContain("own-nvda:find");
    expect(nvda.started).toBe(true);
    await driver.stop();
    expect(desktop.restarts).toEqual([]);
  });

  it("starts it again after a start that failed, since Guidepup's NVDA may have shut it down", async () => {
    const { driver, desktop, deps } = setup();
    desktop.ownNvda = [OWN_NVDA];
    deps.launchBrowser = () => Promise.reject(new Error("Chrome didn't start"));
    await expect(driver.start()).rejects.toThrow(/Chrome didn't start/);
    expect(desktop.ownNvda).toEqual([]);
    await driver.stop();
    expect(desktop.restarts).toEqual([OWN_NVDA]);
  });

  it("starts it again if the process exits after a start that failed, before any stop()", async () => {
    const { driver, desktop, deps } = setup();
    desktop.ownNvda = [OWN_NVDA];
    deps.launchBrowser = () => Promise.reject(new Error("Chrome didn't start"));
    const before = process.listeners("exit");
    await expect(driver.start()).rejects.toThrow(/Chrome didn't start/);
    // NVDA and the browser are down already. The process exits: only what this test added runs.
    for (const onExit of process.listeners("exit")) {
      if (!before.includes(onExit)) onExit(0);
    }
    expect(desktop.restarts).toEqual([OWN_NVDA]);
  });

  it("leaves it alone when the driver was stopped before Guidepup's NVDA started", async () => {
    const { driver, desktop } = setup();
    desktop.ownNvda = [OWN_NVDA];
    const asking = (desktop.ownNvdaGate = new Gate());
    const start = driver.start();
    start.catch(() => {});
    await until(() => asking.waiting > 0);
    const stopping = driver.stop();
    asking.open();
    await stopping;
    await expect(start).rejects.toThrow(/stopped/);
    expect(desktop.events).not.toContain("nvda:start");
    expect(desktop.restarts).toEqual([]);
    expect(desktop.ownNvda).toEqual([OWN_NVDA]);
  });

  it("leaves it alone when the driver was stopped while Guidepup was loading", async () => {
    const { driver, desktop, deps, nvda } = setup();
    desktop.ownNvda = [OWN_NVDA];
    const loading = new Gate();
    deps.loadNvda = async () => {
      await loading.wait();
      return nvda;
    };
    const start = driver.start();
    start.catch(() => {});
    await until(() => loading.waiting > 0);
    const stopping = driver.stop();
    loading.open();
    await stopping;
    await expect(start).rejects.toThrow(/stopped/);
    expect(desktop.events).not.toContain("nvda:start");
    expect(desktop.restarts).toEqual([]);
    expect(desktop.ownNvda).toEqual([OWN_NVDA]);
  });

  it("leaves it alone when Guidepup can't be loaded", async () => {
    const { driver, desktop, deps } = setup();
    desktop.ownNvda = [OWN_NVDA];
    deps.loadNvda = () => Promise.reject(new Error("Cannot find module '@guidepup/guidepup'"));
    await expect(driver.start()).rejects.toThrow(/guidepup/);
    await driver.stop();
    expect(desktop.restarts).toEqual([]);
    expect(desktop.ownNvda).toEqual([OWN_NVDA]);
  });

  it("starts it again when Guidepup's NVDA fails to start, having shut theirs down", async () => {
    const { driver, desktop, nvda } = setup();
    desktop.ownNvda = [OWN_NVDA];
    nvda.startFails = true;
    const start = driver.start();
    await expect(start).rejects.toThrow(/NVDA didn't start/);
    await expect(start).rejects.toMatchObject({ failure: "screen-reader-stopped" });
    expect(desktop.ownNvda).toEqual([]);
    await driver.stop();
    expect(desktop.restarts).toEqual([OWN_NVDA]);
  });

  it("keeps it off through a mid-run restart, and starts it again once after the final stop", async () => {
    const { driver, desktop } = setup();
    desktop.ownNvda = [OWN_NVDA];
    await driver.start();
    await driver.stop({ restarting: true });
    expect(desktop.restarts).toEqual([]);
    await driver.start();
    // Still noted from the first start: asking again would find it off, and forget it.
    expect(desktop.events.filter((event) => event === "own-nvda:find")).toHaveLength(1);
    await driver.stop();
    expect(desktop.restarts).toEqual([OWN_NVDA]);
  });

  it("starts it again if the process exits during a mid-run restart", async () => {
    const { driver, desktop } = setup();
    desktop.ownNvda = [OWN_NVDA];
    const before = process.listeners("exit");
    await driver.start();
    await driver.stop({ restarting: true });
    expect(desktop.restarts).toEqual([]);
    // The process exits before the restart's start: only what this test added runs.
    for (const onExit of process.listeners("exit")) {
      if (!before.includes(onExit)) onExit(0);
    }
    expect(desktop.restarts).toEqual([OWN_NVDA]);
  });

  it("starts it again when the final stop comes while a restart's stop is under way", async () => {
    const { driver, desktop } = setup();
    desktop.ownNvda = [OWN_NVDA];
    await driver.start();
    await driver.openPage(URL_HOME);
    const closing = (desktop.session.closeGate = new Gate());
    const restarting = driver.stop({ restarting: true });
    await until(() => closing.waiting > 0);
    const final = driver.stop();
    closing.open();
    await Promise.all([restarting, final]);
    expect(desktop.restarts).toEqual([OWN_NVDA]);
  });

  it("waits until voicecap exits to start it again while Guidepup's NVDA is still starting", async () => {
    const { driver, desktop, nvda, logger } = setup();
    desktop.ownNvda = [OWN_NVDA];
    nvda.startGate = new Gate(); // never opens
    nvda.outlivesForceQuit = true;
    const before = process.listeners("exit");
    const start = driver.start();
    start.catch(() => {});
    await until(() => desktop.events.includes("nvda:start"));
    await driver.stop();
    // Guidepup's start would shut the person's NVDA down again, whenever it got that far.
    expect(nvda.forceQuits).toBe(1);
    expect(desktop.restarts).toEqual([]);
    expect(logger.text("warn")).toContain("Your NVDA will be turned back on when voicecap exits.");
    // voicecap exits: only what this test added runs.
    for (const onExit of process.listeners("exit")) {
      if (!before.includes(onExit)) onExit(0);
    }
    expect(nvda.forceQuits).toBe(2);
    const restarted = desktop.events.indexOf(`own-nvda:restart-detached:${OWN_NVDA}`);
    expect(restarted).toBeGreaterThan(desktop.events.lastIndexOf("nvda:force-quit"));
    expect(desktop.restarts).toEqual([OWN_NVDA]);
  });

  it("waits until voicecap exits to start it again while Guidepup is still stopping NVDA", async () => {
    const { driver, desktop, nvda, logger } = setup();
    desktop.ownNvda = [OWN_NVDA];
    const before = process.listeners("exit");
    await driver.start();
    nvda.stopHangs = true;
    nvda.outlivesForceQuit = true;
    await driver.stop();
    expect(logger.text("warn")).toContain("Guidepup still hasn't finished stopping NVDA.");
    // Guidepup's stop ends by quitting whichever NVDA is running: the person's, if it were back.
    expect(desktop.restarts).toEqual([]);
    expect(logger.text("warn")).toContain("Your NVDA will be turned back on when voicecap exits.");
    // voicecap exits: only what this test added runs.
    for (const onExit of process.listeners("exit")) {
      if (!before.includes(onExit)) onExit(0);
    }
    expect(desktop.events).toContain(`own-nvda:restart-detached:${OWN_NVDA}`);
    expect(desktop.restarts).toEqual([OWN_NVDA]);
  });

  it("waits while the stop from a failed start's own clean-up is under way, then starts it at a later stop", async () => {
    const { driver, desktop, nvda, deps, logger } = setup();
    desktop.ownNvda = [OWN_NVDA];
    nvda.stopHangs = true;
    nvda.outlivesForceQuit = true;
    deps.launchBrowser = () => Promise.reject(new Error("Chrome didn't start"));
    const before = process.listeners("exit");
    await expect(driver.start()).rejects.toThrow(/Chrome didn't start/);
    // The start's clean-up gave up waiting for Guidepup's stop, which ends by quitting whichever
    // NVDA is running: the person's, if it were back already.
    expect(logger.text("warn")).toContain("Guidepup still hasn't finished stopping NVDA.");
    await driver.stop();
    expect(desktop.restarts).toEqual([]);
    expect(logger.text("warn")).toContain("Your NVDA will be turned back on when voicecap exits.");
    nvda.finishStop();
    await delay(1);
    await driver.stop();
    expect(desktop.restarts).toEqual([OWN_NVDA]);
    expect(desktop.ownNvda).toEqual([OWN_NVDA]);
    expect(process.listeners("exit").filter((onExit) => !before.includes(onExit))).toEqual([]);
  });

  it("starts it again at once after a stop during a start that finishes in time", async () => {
    const { driver, desktop, nvda, deps, logger } = setup();
    desktop.ownNvda = [OWN_NVDA];
    // No time limit runs out: the start finishes within stop()'s wait for it.
    const settle = deps.sleep;
    deps.sleep = (ms, signal) => (signal ? new Promise<void>(() => {}) : settle(ms));
    const starting = (nvda.startGate = new Gate());
    const before = process.listeners("exit");
    const start = driver.start();
    start.catch(() => {});
    await until(() => desktop.events.includes("nvda:start"));
    const stopping = driver.stop();
    starting.open();
    await stopping;
    await expect(start).rejects.toThrow(/stopped/);
    expect(desktop.restarts).toEqual([OWN_NVDA]);
    expect(logger.text("warn")).not.toContain("when voicecap exits");
    expect(process.listeners("exit").filter((onExit) => !before.includes(onExit))).toEqual([]);
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

// What the driver tells the run's event log, as it does each thing, in the order it does it.
describe("reporting to the run's event log", () => {
  it("records its start, a page, and its stop, in order", async () => {
    const { driver, desktop, nvda, recorder } = recording({ running: [4321, 4322] });
    desktop.ownNvda = [OWN_NVDA];
    await driver.start();
    await driver.openPage(URL_HOME);
    await driver.stop();
    const browser = desktop.session.pid;
    expect(recorder.events).toEqual([
      { type: "screen-reader-lock-taken" },
      { type: "own-screen-reader-closed", pids: [4321, 4322] },
      { type: "screen-reader-started", pid: nvda.pid },
      { type: "browser-launched", pid: browser },
      // NVDA stops before the browsers close, and the computer's own NVDA starts after both.
      { type: "screen-reader-stopped", pid: nvda.pid, restarting: false },
      { type: "browser-closed", pid: browser },
      { type: "own-screen-reader-restarted", ok: true },
      { type: "screen-reader-lock-released" },
    ]);
  });

  it("launches each page's browser before closing the last page's", async () => {
    const { driver, desktop, recorder } = recording();
    await driver.start();
    await driver.openPage(URL_HOME);
    await driver.openPage(URL_HOME);
    const [first, second] = desktop.sessions.map((session) => session.pid);
    expect(only(recorder.events, "browser-launched", "browser-closed")).toEqual([
      { type: "browser-launched", pid: first },
      { type: "browser-launched", pid: second },
      { type: "browser-closed", pid: first },
    ]);
  });

  it("records a restart's stop and start", async () => {
    const { driver, desktop, nvda, recorder } = recording();
    await driver.start();
    const before = recorder.events.length;
    await driver.stop({ restarting: true });
    await driver.start();
    const [first, second] = desktop.sessions.map((session) => session.pid);
    expect(recorder.events.slice(before)).toEqual([
      { type: "screen-reader-stopped", pid: nvda.pid, restarting: true },
      { type: "browser-closed", pid: first },
      { type: "screen-reader-lock-released" },
      { type: "screen-reader-lock-taken" },
      { type: "screen-reader-started", pid: nvda.pid },
      { type: "browser-launched", pid: second },
    ]);
  });

  it("records the computer's own NVDA closing once, and starting again once, across a restart", async () => {
    const options: Setup = { running: [4321] };
    const { driver, desktop, recorder } = recording(options);
    desktop.ownNvda = [OWN_NVDA];
    const closed: NewRunEvent = { type: "own-screen-reader-closed", pids: [4321] };
    await driver.start();
    options.running = []; // voicecap's NVDA shut it down
    await driver.stop({ restarting: true });
    await driver.start();
    // It stays off through the restart, which neither closes it again nor starts it.
    expect(only(recorder.events, "own-screen-reader-closed")).toEqual([closed]);
    expect(recorder.types()).not.toContain("own-screen-reader-restarted");
    await driver.stop();
    expect(
      only(recorder.events, "own-screen-reader-closed", "own-screen-reader-restarted"),
    ).toEqual([closed, { type: "own-screen-reader-restarted", ok: true }]);
  });

  it("records its start once it has the pid, before it launches the browser", async () => {
    const { driver, desktop, deps, nvda, recorder } = recording();
    const looking = new Gate();
    deps.screenReaderPid = async () => {
      await looking.wait();
      return nvda.pid;
    };
    const start = driver.start();
    await until(() => looking.waiting > 0);
    expect(nvda.started).toBe(true);
    expect(recorder.types()).toEqual(["screen-reader-lock-taken"]);
    expect(desktop.sessions).toEqual([]);
    looking.open();
    await start;
    expect(recorder.events).toEqual([
      { type: "screen-reader-lock-taken" },
      { type: "screen-reader-started", pid: nvda.pid },
      { type: "browser-launched", pid: desktop.session.pid },
    ]);
  });

  it("stamps the computer's own NVDA closed as its start began, and its own started as the start finished, before the pid lookup", async () => {
    const { driver, desktop, deps, nvda } = setup({ running: [4321] });
    let clock = new Date(2026, 9, 5, 10, 0, 0, 0).getTime();
    const now = () => new Date(clock);
    deps.now = now;
    const dir = mkdtempSync(path.join(os.tmpdir(), "voicecap-driver-log-"));
    temps.push(dir);
    const file = path.join(dir, "events.jsonl");
    driver.setEventRecorder(openEventLog(file, { now, logger: createMemoryLogger(), session: 1 }));
    desktop.ownNvda = [OWN_NVDA];
    desktop.ownNvdaGate = new Gate();
    nvda.startGate = new Gate();
    const looking = new Gate();
    deps.screenReaderPid = async () => {
      await looking.wait();
      return nvda.pid;
    };

    const start = driver.start();
    // The lock is taken at 10:00:00; the start begins a second later, and takes two seconds.
    await until(() => (desktop.ownNvdaGate?.waiting ?? 0) > 0);
    clock += 1_000;
    desktop.ownNvdaGate.open();
    await until(() => desktop.events.includes("nvda:start"));
    clock += 2_000;
    nvda.startGate.open();
    // The pid lookup, a start of PowerShell, takes a second and a half more.
    await until(() => looking.waiting > 0);
    clock += 1_500;
    looking.open();
    await start;

    const at = (seconds: number, ms = 0) => isoLocalMs(new Date(2026, 9, 5, 10, 0, seconds, ms));
    // In the order recorded, each stamped when it happened.
    expect(
      readEventLog(readFileSync(file, "utf8")).events.map(({ at: time, type }) => [type, time]),
    ).toEqual([
      ["screen-reader-lock-taken", at(0)],
      ["own-screen-reader-closed", at(1)],
      ["screen-reader-started", at(3)],
      ["browser-launched", at(4, 500)],
    ]);
  });

  it("records a pid it can't find as null", async () => {
    // The lookup fails, and it finds nothing: neither stops NVDA from starting.
    const lookups: GuidepupDriverDeps["screenReaderPid"][] = [
      () => Promise.reject(new Error("PowerShell didn't answer")),
      () => Promise.resolve(null),
    ];
    for (const lookup of lookups) {
      const { driver, deps, nvda, recorder } = recording();
      deps.screenReaderPid = lookup;
      await driver.start();
      expect(nvda.started).toBe(true);
      await driver.openPage(URL_HOME);
      await driver.stop();
      expect(only(recorder.events, "screen-reader-started", "screen-reader-stopped")).toEqual([
        { type: "screen-reader-started", pid: null },
        { type: "screen-reader-stopped", pid: null, restarting: false },
      ]);
    }
  });

  it("records the lock when cleanupStale() takes it, and not again when start() finds it held", async () => {
    const { driver, recorder } = recording();
    await driver.cleanupStale();
    expect(recorder.types()).toEqual(["screen-reader-lock-taken"]);
    await driver.start();
    await driver.stop();
    expect(
      only(recorder.events, "screen-reader-lock-taken", "screen-reader-lock-released"),
    ).toEqual([{ type: "screen-reader-lock-taken" }, { type: "screen-reader-lock-released" }]);
  });

  it("records no lock that another voicecap holds, and releases none it never took", async () => {
    const first = setup();
    await first.driver.start();
    const { driver, recorder } = recording({ lockFile: first.deps.lockFile });
    await expect(driver.cleanupStale()).rejects.toThrow(/process \d+/);
    await expect(driver.start()).rejects.toThrow(/process \d+/);
    await driver.stop();
    expect(recorder.events).toEqual([]);
  });

  it("records the computer found locked", async () => {
    const { driver, desktop, recorder } = recording();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.locked = true; // NVDA says nothing
    const step = driver.nextLine();
    await expect(step).rejects.toMatchObject({ failure: "locked" });
    // Recorded as the error was made: it's there as the step fails, and only once.
    expect(only(recorder.events, "computer-locked")).toEqual([{ type: "computer-locked" }]);
  });

  it("records the computer found locked when the lock screen has taken the page's focus too", async () => {
    const { driver, desktop, recorder } = recording();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.locked = true;
    desktop.front = "other"; // the lock screen
    await expect(driver.nextLine()).rejects.toMatchObject({ failure: "locked" });
    await expect(driver.nextFocusable()).rejects.toMatchObject({ failure: "locked" });
    expect(only(recorder.events, "computer-locked")).toHaveLength(2);
  });

  it("doesn't record the computer locked when another window has only come forward", async () => {
    const { driver, desktop, recorder } = recording();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.front = "other";
    await expect(driver.nextLine()).rejects.toBeInstanceOf(ForegroundError);
    expect(only(recorder.events, "computer-locked")).toEqual([]);
  });

  it("records the computer's own NVDA closing, though it can't start it again when its path is unknown", async () => {
    const { driver, desktop, recorder } = recording({ running: [4321] });
    await driver.start();
    await driver.stop();
    expect(
      only(recorder.events, "own-screen-reader-closed", "own-screen-reader-restarted"),
    ).toEqual([{ type: "own-screen-reader-closed", pids: [4321] }]);
    expect(desktop.restarts).toEqual([]);
  });

  it("records nothing of the computer's own NVDA when none was running", async () => {
    const { driver, recorder } = recording();
    await driver.start();
    await driver.stop();
    expect(
      only(recorder.events, "own-screen-reader-closed", "own-screen-reader-restarted"),
    ).toEqual([]);
  });

  it("records no closing of the computer's own NVDA when voicecap's NVDA doesn't start", async () => {
    const { driver, desktop, nvda, recorder } = recording({ running: [4321] });
    desktop.ownNvda = [OWN_NVDA];
    nvda.startFails = true;
    await expect(driver.start()).rejects.toThrow(/NVDA didn't start/);
    // No start, no stop of an NVDA that never ran, and no closing: just the lock it took.
    expect(recorder.events).toEqual([{ type: "screen-reader-lock-taken" }]);
  });

  it("records the computer's own NVDA not coming back", async () => {
    const { driver, desktop, recorder } = recording();
    desktop.ownNvda = [OWN_NVDA];
    desktop.restartFails = true;
    await driver.start();
    await driver.stop();
    expect(only(recorder.events, "own-screen-reader-restarted")).toEqual([
      { type: "own-screen-reader-restarted", ok: false },
    ]);
    // The lock is let go all the same, after.
    expect(recorder.types().slice(-2)).toEqual([
      "own-screen-reader-restarted",
      "screen-reader-lock-released",
    ]);
  });

  it("records a start's NVDA shut down again after the start failed, as a stop that isn't a restart's", async () => {
    const { driver, deps, nvda, recorder } = recording();
    deps.launchBrowser = () => Promise.reject(new Error("Chrome didn't start"));
    await expect(driver.start()).rejects.toThrow(/Chrome didn't start/);
    expect(recorder.events).toEqual([
      { type: "screen-reader-lock-taken" },
      { type: "screen-reader-started", pid: nvda.pid },
      { type: "screen-reader-stopped", pid: nvda.pid, restarting: false },
    ]);
  });

  it("records a start that a restart's stop overtook, and the stop as the restart's", async () => {
    const { driver, desktop, nvda, recorder } = recording();
    nvda.startGate = new Gate();
    const start = driver.start();
    start.catch(() => {});
    await until(() => desktop.events.includes("nvda:start"));
    const stopping = driver.stop({ restarting: true });
    nvda.startGate.open();
    await stopping;
    await expect(start).rejects.toThrow(/stopped/);
    expect(recorder.events).toEqual([
      { type: "screen-reader-lock-taken" },
      { type: "screen-reader-started", pid: nvda.pid },
      { type: "screen-reader-stopped", pid: nvda.pid, restarting: true },
      { type: "screen-reader-lock-released" },
    ]);
  });

  it("records a restart's stop as a final one when the final stop joins it before NVDA has stopped", async () => {
    const { driver, desktop, deps, nvda, recorder } = recording();
    const settle = deps.sleep;
    deps.sleep = (ms, signal) => (signal ? new Promise(() => {}) : settle(ms)); // no time limit runs out
    await driver.start();
    nvda.stopHangs = true; // Guidepup's stop doesn't finish until it's told to
    const restartStop = driver.stop({ restarting: true });
    await until(() => desktop.events.includes("nvda:stop"));
    const finalStop = driver.stop();
    nvda.finishStop();
    await Promise.all([restartStop, finalStop]);
    expect(only(recorder.events, "screen-reader-stopped")).toEqual([
      { type: "screen-reader-stopped", pid: nvda.pid, restarting: false },
    ]);
  });

  it("records the close of a browser it won't go on with, which had updated itself", async () => {
    const { driver, desktop, recorder } = recording();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.browserVersion = "154.0.8100.10";
    await expect(driver.openPage(URL_HOME)).rejects.toMatchObject({ failure: "browser" });
    const [first, second] = desktop.sessions.map((session) => session.pid);
    expect(only(recorder.events, "browser-launched", "browser-closed")).toEqual([
      { type: "browser-launched", pid: first },
      { type: "browser-launched", pid: second },
      { type: "browser-closed", pid: second },
    ]);
  });

  it("records no close for a browser that failed to close", async () => {
    const { driver, desktop, logger, recorder } = recording();
    await driver.start();
    desktop.session.close = () => Promise.reject(new Error("the window won't close"));
    await driver.stop();
    expect(logger.text("warn")).toContain("Closing the browser failed: the window won't close");
    expect(only(recorder.events, "browser-launched", "browser-closed")).toEqual([
      { type: "browser-launched", pid: desktop.session.pid },
    ]);
  });

  it("records a browser's pid as null when it has none to give", async () => {
    const { driver, deps, recorder } = recording();
    const launch = deps.launchBrowser;
    deps.launchBrowser = async (signal) => {
      const session = await launch(signal);
      Object.defineProperty(session, "pid", { value: undefined });
      return session;
    };
    await driver.start();
    await driver.stop();
    expect(only(recorder.events, "browser-launched", "browser-closed")).toEqual([
      { type: "browser-launched", pid: null },
      { type: "browser-closed", pid: null },
    ]);
  });

  it("records a hand-over", () => {
    const { driver, logger, recorder } = recording();
    const notice = "Chrome handed over to a new copy of itself as it started.";
    driver.relaunched(notice);
    expect(logger.text("warn")).toBe(notice);
    expect(recorder.events).toEqual([{ type: "browser-handed-over" }]);
  });

  it("records nothing as the process exits", async () => {
    const { driver, desktop, recorder } = recording({ running: [4321] });
    desktop.ownNvda = [OWN_NVDA];
    await driver.start();
    await driver.openPage(URL_HOME);
    const before = [...recorder.events];
    driver.abandon();
    expect(desktop.restarts).toEqual([OWN_NVDA]); // it did what it does
    expect(recorder.events).toEqual(before);
  });

  it("records nothing, and works, without a recorder", async () => {
    // As for doctor's live check and fixture capture, which run it with none.
    const { driver, desktop, nvda, logger } = setup({ running: [4321] });
    desktop.ownNvda = [OWN_NVDA];
    await driver.cleanupStale();
    await driver.start();
    await driver.openPage(URL_HOME);
    await driver.nextLine();
    driver.relaunched("Chrome handed over to a new copy of itself as it started.");
    await driver.stop();
    expect(logger.text("warn")).toContain("handed over");
    expect(nvda.started).toBe(false);
    expect(desktop.restarts).toEqual([OWN_NVDA]);
  });
});

// Another window taking the foreground is looked up once, and its program named: in the event log,
// with the window's title, and on the error, by its name only. The lookup comes a moment after the
// loss, so the window in front may be voicecap's own browser again: no program took the foreground
// then, and the answer is "not known".
describe("the program that took the foreground", () => {
  const OUTLOOK: NewRunEvent = {
    type: "foreground-lost",
    program: "Microsoft Outlook",
    title: "Inbox - Outlook",
  };
  const NOT_KNOWN: NewRunEvent = { type: "foreground-lost", program: null, title: null };

  it("is named in the event log, with its window's title, and on the error by its name only", async () => {
    const { driver, desktop, recorder } = recording();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.front = "other";
    const step = driver.nextLine();
    await expect(step).rejects.toBeInstanceOf(ForegroundError);
    await expect(step).rejects.toMatchObject({
      failure: "foreground",
      program: "Microsoft Outlook",
    });
    // The title is for the log: nothing the error says tells what the window showed.
    await expect(step).rejects.not.toThrow(/Outlook|Inbox/);
    expect(only(recorder.events, "foreground-lost")).toEqual([OUTLOOK]);
  });

  it("is looked up once for each loss, however the driver finds it", async () => {
    type Loss = (desktop: FakeDesktop, driver: GuidepupNvdaDriver) => Promise<unknown>;
    const losses: [string, Loss][] = [
      [
        "before a step",
        (desktop, driver) => {
          desktop.front = "other";
          return driver.nextLine();
        },
      ],
      [
        "during a step",
        (desktop, driver) => {
          desktop.speech = () => {
            desktop.front = "other";
            return "Inbox - Outlook, window. 3 unread messages";
          };
          return driver.nextLine();
        },
      ],
      [
        "before a Tab",
        (desktop, driver) => {
          desktop.front = "other";
          return driver.nextFocusable();
        },
      ],
      [
        "during a Tab",
        async (desktop, driver) => {
          await driver.nextFocusable();
          desktop.beforeKey = () => {
            desktop.front = "other";
          };
          return driver.nextFocusable();
        },
      ],
    ];
    for (const [when, lose] of losses) {
      const { driver, desktop, recorder } = recording();
      await driver.start();
      await driver.openPage(URL_HOME);
      expect(lookups(desktop), when).toBe(0);
      await expect(lose(desktop, driver), when).rejects.toMatchObject({
        failure: "foreground",
        program: "Microsoft Outlook",
      });
      expect(lookups(desktop), when).toBe(1);
      expect(only(recorder.events, "foreground-lost"), when).toEqual([OUTLOOK]);
    }
  });

  // A lookup that finds nothing and one that fails say the same: Windows didn't say.
  const unanswered: [string, GuidepupDriverDeps["foregroundWindow"]][] = [
    ["finds nothing", () => Promise.resolve(null)],
    ["fails", () => Promise.reject(new Error("PowerShell didn't answer"))],
  ];

  it("is named null when the lookup doesn't answer, and the step still fails as a lost foreground", async () => {
    for (const [how, lookup] of unanswered) {
      const { driver, desktop, deps, recorder } = recording();
      deps.foregroundWindow = lookup;
      await driver.start();
      await driver.openPage(URL_HOME);
      desktop.front = "other";
      const step = driver.nextLine();
      await expect(step, how).rejects.toBeInstanceOf(ForegroundError);
      await expect(step, how).rejects.toMatchObject({ failure: "foreground", program: null });
      expect(only(recorder.events, "foreground-lost"), how).toEqual([NOT_KNOWN]);
    }
  });

  it("is named when the browser can't be brought to the front, as a page is opened", async () => {
    const { driver, desktop, recorder } = recording();
    await driver.start();
    desktop.front = "other";
    desktop.raiseWorks = false;
    const open = driver.openPage(URL_HOME);
    await expect(open).rejects.toBeInstanceOf(ForegroundError);
    await expect(open).rejects.toMatchObject({
      failure: "foreground",
      program: "Microsoft Outlook",
    });
    await expect(open).rejects.not.toThrow(/Outlook|Inbox/);
    expect(only(recorder.events, "foreground-lost")).toEqual([OUTLOOK]);
    // Once, though the browser was raised three times: the page is given up on after the last.
    expect(desktop.events.filter((event) => event === "raise")).toHaveLength(3);
    expect(lookups(desktop)).toBe(1);
  });

  it("is named null when the lookup doesn't answer for a page that wouldn't come to the front", async () => {
    for (const [how, lookup] of unanswered) {
      const { driver, desktop, deps, recorder } = recording();
      deps.foregroundWindow = lookup;
      await driver.start();
      desktop.front = "other";
      desktop.raiseWorks = false;
      const open = driver.openPage(URL_HOME);
      await expect(open, how).rejects.toBeInstanceOf(ForegroundError);
      await expect(open, how).rejects.toMatchObject({ failure: "foreground", program: null });
      expect(only(recorder.events, "foreground-lost"), how).toEqual([NOT_KNOWN]);
      expect(desktop.strayKeys, how).toEqual([]);
    }
  });

  it("isn't looked up when Windows is locked: that's recorded as the lock, and the lock screen is no program", async () => {
    const { driver, desktop, recorder } = recording();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.locked = true;
    desktop.front = "other"; // the lock screen
    await expect(driver.nextLine()).rejects.toMatchObject({ failure: "locked" });
    expect(only(recorder.events, "computer-locked", "foreground-lost")).toEqual([
      { type: "computer-locked" },
    ]);
    expect(lookups(desktop)).toBe(0);
  });

  /** A lookup that finds a window of the process `pid`, whatever its program is called. */
  const finding =
    (pid: number): GuidepupDriverDeps["foregroundWindow"] =>
    () =>
      Promise.resolve({ pid, program: "Microsoft Teams", title: "Chat | Microsoft Teams" });
  const TEAMS: NewRunEvent = {
    type: "foreground-lost",
    program: "Microsoft Teams",
    title: "Chat | Microsoft Teams",
  };

  it("isn't named when the window in front is the browser voicecap uses, whatever it says it is", async () => {
    const { driver, desktop, deps, recorder } = recording();
    await driver.start();
    await driver.openPage(URL_HOME);
    // The process that owns the window decides, not the program's name.
    deps.foregroundWindow = finding(desktop.session.pid);
    desktop.front = "other";
    const step = driver.nextLine();
    await expect(step).rejects.toBeInstanceOf(ForegroundError);
    await expect(step).rejects.toMatchObject({ failure: "foreground", program: null });
    expect(only(recorder.events, "foreground-lost")).toEqual([NOT_KNOWN]);
  });

  it("isn't named when the window in front is the browser of a later page, which each page gets afresh", async () => {
    const { driver, desktop, deps, recorder } = recording();
    await driver.start();
    await driver.openPage(URL_HOME);
    await driver.openPage(URL_HOME);
    const [first, second] = desktop.sessions.map((session) => session.pid);
    expect(second).not.toBe(first);
    deps.foregroundWindow = finding(second!);
    desktop.front = "other";
    await expect(driver.nextLine()).rejects.toMatchObject({ failure: "foreground", program: null });
    expect(only(recorder.events, "foreground-lost")).toEqual([NOT_KNOWN]);
  });

  it("keeps the program and the title of a window another process owns, even one next to the browser's", async () => {
    for (const offset of [-1, 1]) {
      const { driver, desktop, deps, recorder } = recording();
      await driver.start();
      await driver.openPage(URL_HOME);
      deps.foregroundWindow = finding(desktop.session.pid + offset);
      desktop.front = "other";
      const step = driver.nextLine();
      await expect(step, String(offset)).rejects.toMatchObject({
        failure: "foreground",
        program: "Microsoft Teams",
      });
      expect(only(recorder.events, "foreground-lost"), String(offset)).toEqual([TEAMS]);
    }
  });

  it("isn't named when another window came and went before the lookup, and the browser is in front again", async () => {
    const { driver, desktop, recorder } = recording();
    await driver.start();
    await driver.openPage(URL_HOME);
    desktop.speech = () => {
      desktop.front = "other";
      desktop.front = "browser";
      return "Inbox - Outlook, window. 3 unread messages";
    };
    const step = driver.nextLine();
    await expect(step).rejects.toBeInstanceOf(ForegroundError);
    await expect(step).rejects.toMatchObject({ failure: "foreground", program: null });
    // The lookup was made, once, and the browser answered it.
    expect(lookups(desktop)).toBe(1);
    expect(only(recorder.events, "foreground-lost")).toEqual([NOT_KNOWN]);
  });

  it("isn't named when the browser can't be brought to the front, and the window in front is its own", async () => {
    const { driver, desktop, deps, recorder } = recording();
    deps.foregroundWindow = () =>
      Promise.resolve({
        pid: desktop.session.pid,
        program: "Google Chrome",
        title: "voicecap check k3m9x2 - Google Chrome",
      });
    await driver.start();
    desktop.front = "other";
    desktop.raiseWorks = false;
    const open = driver.openPage(URL_HOME);
    await expect(open).rejects.toBeInstanceOf(ForegroundError);
    await expect(open).rejects.toMatchObject({ failure: "foreground", program: null });
    expect(only(recorder.events, "foreground-lost")).toEqual([NOT_KNOWN]);
  });

  it("keeps the answer when the browser has no process id to tell its windows by", async () => {
    const { driver, desktop, deps, recorder } = recording();
    const launch = deps.launchBrowser;
    deps.launchBrowser = async (signal) => {
      const session = await launch(signal);
      Object.defineProperty(session, "pid", { value: undefined });
      return session;
    };
    await driver.start();
    await driver.openPage(URL_HOME);
    // The process the first browser would have had: with no pid to match it against, it's named.
    deps.foregroundWindow = finding(6001);
    desktop.front = "other";
    const step = driver.nextLine();
    await expect(step).rejects.toMatchObject({ failure: "foreground", program: "Microsoft Teams" });
    expect(only(recorder.events, "foreground-lost")).toEqual([TEAMS]);
  });
});

// NVDA's own log: turned on as NVDA starts, and, each time voicecap's NVDA has quit, read, cleaned,
// and handed to the run, before anything starts NVDA again (it moves the last log aside to
// nvda-old.log as it starts, and the person's own NVDA starts again at the final stop).
describe("NVDA's own log", () => {
  /**
   * NVDA's log of a session as the file holds it, with Windows line ends: an entry NVDA logs about
   * itself, the keys pressed (voicecap's, and a person's typing), what NVDA spoke, a typed word, and
   * a warning that names the account.
   */
  const FIRST_LOG = [
    "INFO - __main__ (09:00:00.100) - MainThread (4100):",
    "Starting NVDA version 2026.2 AMD64",
    "IO - inputCore.InputManager.executeGesture (09:00:02.000) - winInputHook (5200):",
    "Input: kb(desktop):downArrow",
    "IO - speech.speech.speak (09:00:02.100) - MainThread (4100):",
    "Speaking [LangChangeCommand ('en_US'), 'Welcome', CancellableSpeech (still valid)]",
    "IO - inputCore.InputManager.executeGesture (09:00:03.000) - winInputHook (5200):",
    "Input: kb(desktop):x",
    "IO - speech.speech.speakTypedCharacters (09:00:03.010) - MainThread (4100):",
    "typed word: hunter2",
    "WARNING - config.ConfigManager._loadConfig (09:00:04.000) - MainThread (4100):",
    String.raw`Couldn't read C:\Users\pat\AppData\Roaming\nvda\nvda.ini`,
    "",
  ].join("\r\n");
  const SECOND_LOG = [
    "IO - inputCore.InputManager.executeGesture (09:10:00.000) - winInputHook (5200):",
    "Input: kb(desktop):tab",
    "IO - speech.speech.speak (09:10:00.100) - MainThread (4100):",
    "Speaking [LangChangeCommand ('en_US'), 'Skip to main content', 'link', CancellableSpeech (still valid)]",
    "",
  ].join("\r\n");

  /** A raw log as a run keeps it: cleaned, with this account's home folder. */
  const cleaned = (raw: string) => cleanNvdaLog(raw, { home: HOME, platform: "win32" });

  /** How many times the driver has read NVDA's log. */
  const reads = (desktop: FakeDesktop) =>
    desktop.events.filter((event) => event === "nvda-log:read").length;

  describe("turning it on", () => {
    it("starts NVDA with its log at the input/output level", async () => {
      const { driver, nvda } = setup();
      await driver.start();
      expect(nvda.startOptions?.settings).toEqual({ general: { loggingLevel: "IO" } });
    });

    it("keeps the config's own settings, and the rest of its general ones, beside it", async () => {
      const { driver, nvda } = setup({
        config: {
          nvdaSettings: { general: { language: "en" }, speech: { symbolLevel: 100 } },
        },
      });
      await driver.start();
      expect(nvda.startOptions?.settings).toEqual({
        general: { language: "en", loggingLevel: "IO" },
        speech: { symbolLevel: 100 },
      });
    });

    it("leaves alone a loggingLevel the config sets itself", async () => {
      for (const loggingLevel of ["OFF", "DEBUG"]) {
        const { driver, nvda } = setup({
          config: { nvdaSettings: { general: { language: "en", loggingLevel } } },
        });
        await driver.start();
        expect(nvda.startOptions?.settings, loggingLevel).toEqual({
          general: { language: "en", loggingLevel },
        });
      }
    });

    it("treats a loggingLevel the config leaves undefined as one it didn't set", async () => {
      const { driver, nvda } = setup({
        config: { nvdaSettings: { general: { loggingLevel: undefined } } },
      });
      await driver.start();
      expect(nvda.startOptions?.settings).toEqual({ general: { loggingLevel: "IO" } });
    });

    it("never changes the config's own settings, which the run records", async () => {
      const nvdaSettings = { general: { language: "en" }, speech: { symbolLevel: 100 } };
      const { driver } = setup({ config: { nvdaSettings } });
      await driver.start();
      await driver.stop();
      expect(nvdaSettings).toEqual({ general: { language: "en" }, speech: { symbolLevel: 100 } });
    });
  });

  describe("keeping a copy of it", () => {
    it("reads it once NVDA has quit, before the browser closes and the person's own NVDA starts again", async () => {
      const { driver, desktop, recorder } = recordingLogs();
      desktop.ownNvda = [OWN_NVDA];
      desktop.nvdaLog = FIRST_LOG;
      await driver.start();
      await driver.openPage(URL_HOME);
      expect(reads(desktop)).toBe(0);
      await driver.stop();
      expect(reads(desktop)).toBe(1);
      const read = desktop.events.indexOf("nvda-log:read");
      expect(read).toBeGreaterThan(desktop.events.indexOf("nvda:stop"));
      expect(read).toBeLessThan(desktop.events.indexOf("browser:close"));
      expect(read).toBeLessThan(desktop.events.indexOf(`own-nvda:restart:${OWN_NVDA}`));
      expect(recorder.logs).toHaveLength(1);
    });

    it("hands the run the log cleaned: its speech and voicecap's keys, with what a person typed left out", async () => {
      const { driver, desktop, recorder } = recordingLogs();
      desktop.nvdaLog = FIRST_LOG;
      await driver.start();
      await driver.stop();
      expect(recorder.logs).toEqual([cleaned(FIRST_LOG)]);
      const [copy] = recorder.logs;
      expect(copy).toContain("Input: kb(desktop):downArrow");
      expect(copy).toContain("'Welcome'");
      // What a person typed, the word it made, and what NVDA says of itself aren't kept.
      expect(copy).not.toContain("kb(desktop):x");
      expect(copy).not.toContain("hunter2");
      expect(copy).not.toContain("Starting NVDA");
      // The warning is, with the account's folder written as the copy says it is.
      expect(copy).toContain(String.raw`Couldn't read %USERPROFILE%\AppData\Roaming\nvda\nvda.ini`);
      expect(copy).not.toContain(HOME);
      expect(copy).not.toMatch(/\bpat\b/);
    });

    it("keeps a copy for each NVDA session, a restart's and then the final stop's, in order", async () => {
      const { driver, desktop, recorder } = recordingLogs();
      desktop.ownNvda = [OWN_NVDA];
      desktop.nvdaLog = FIRST_LOG;
      await driver.start();
      await driver.stop({ restarting: true });
      // The first is read before anything starts NVDA again.
      expect(recorder.logs).toEqual([cleaned(FIRST_LOG)]);
      desktop.nvdaLog = SECOND_LOG;
      await driver.start();
      await driver.stop();
      expect(recorder.logs).toEqual([cleaned(FIRST_LOG), cleaned(SECOND_LOG)]);
      expect(reads(desktop)).toBe(2);
      // Start, stop, read, start, stop, read, and then the person's own NVDA.
      const order = desktop.events.filter((event) =>
        ["nvda:stop", "nvda-log:read", "nvda:start", `own-nvda:restart:${OWN_NVDA}`].includes(
          event,
        ),
      );
      expect(order).toEqual([
        "nvda:start",
        "nvda:stop",
        "nvda-log:read",
        "nvda:start",
        "nvda:stop",
        "nvda-log:read",
        `own-nvda:restart:${OWN_NVDA}`,
      ]);
    });

    it("keeps one copy when a final stop joins a restart's stop under way", async () => {
      const { driver, desktop, deps, nvda, recorder } = recordingLogs();
      const settle = deps.sleep;
      deps.sleep = (ms, signal) => (signal ? new Promise(() => {}) : settle(ms)); // no time limit runs out
      desktop.nvdaLog = FIRST_LOG;
      await driver.start();
      nvda.stopHangs = true; // Guidepup's stop doesn't finish until it's told to
      const restartStop = driver.stop({ restarting: true });
      await until(() => desktop.events.includes("nvda:stop"));
      const finalStop = driver.stop();
      expect(reads(desktop)).toBe(0); // NVDA hasn't quit
      nvda.finishStop();
      await Promise.all([restartStop, finalStop]);
      expect(reads(desktop)).toBe(1);
      expect(recorder.logs).toEqual([cleaned(FIRST_LOG)]);
    });

    it("keeps the log of an NVDA that a failed start shut down again, once", async () => {
      const { driver, desktop, deps, recorder } = recordingLogs();
      deps.launchBrowser = () => Promise.reject(new Error("Chrome didn't start"));
      desktop.nvdaLog = FIRST_LOG;
      await expect(driver.start()).rejects.toThrow(/Chrome didn't start/);
      expect(recorder.logs).toEqual([cleaned(FIRST_LOG)]);
      expect(desktop.events.indexOf("nvda-log:read")).toBeGreaterThan(
        desktop.events.indexOf("nvda:stop"),
      );
      // The final stop finds no NVDA to quit, so it has no log of its own to read, and the log of
      // the last one that quit isn't kept twice.
      await driver.stop();
      expect(reads(desktop)).toBe(1);
      expect(recorder.logs).toHaveLength(1);
    });

    it("keeps the log of an NVDA that a stop overtook as it started, once", async () => {
      const { driver, desktop, nvda, recorder } = recordingLogs();
      desktop.nvdaLog = FIRST_LOG;
      nvda.startGate = new Gate();
      const start = driver.start();
      start.catch(() => {});
      await until(() => desktop.events.includes("nvda:start"));
      const stopping = driver.stop({ restarting: true });
      nvda.startGate.open();
      await stopping;
      await expect(start).rejects.toThrow(/stopped/);
      // The NVDA the start finished was shut down, whichever call did it, and its log read then.
      expect(reads(desktop)).toBe(1);
      expect(recorder.logs).toEqual([cleaned(FIRST_LOG)]);
      expect(desktop.events.indexOf("nvda-log:read")).toBeGreaterThan(
        desktop.events.indexOf("nvda:stop"),
      );
    });

    it("reads no log for an NVDA that didn't start", async () => {
      const { driver, desktop, nvda, recorder } = recordingLogs();
      desktop.nvdaLog = FIRST_LOG;
      await driver.start();
      await driver.stop({ restarting: true });
      expect(reads(desktop)).toBe(1);
      // The restart's start fails, and the final stop comes: it has no NVDA to quit, and NVDA's log
      // is still the one already kept.
      nvda.startFails = true;
      await expect(driver.start()).rejects.toThrow(/NVDA didn't start/);
      await driver.stop();
      expect(reads(desktop)).toBe(1);
      expect(recorder.logs).toHaveLength(1);
    });

    it("reads no log when another voicecap has the NVDA, whose log it would be", async () => {
      const first = setup();
      await first.driver.start();
      const { driver, desktop, recorder } = recordingLogs({ lockFile: first.deps.lockFile });
      desktop.nvdaLog = FIRST_LOG;
      await expect(driver.start()).rejects.toThrow(/process \d+/);
      await driver.stop();
      expect(reads(desktop)).toBe(0);
      expect(recorder.logs).toEqual([]);
    });

    it("reads nothing for a run that has no recorder, or a recorder that keeps no copies", async () => {
      // As for doctor's live check and fixture capture, which run it with none.
      const bare = setup();
      bare.desktop.nvdaLog = FIRST_LOG;
      await bare.driver.start();
      await bare.driver.stop();
      expect(reads(bare.desktop)).toBe(0);

      const withoutLogs = recording();
      withoutLogs.desktop.nvdaLog = FIRST_LOG;
      await withoutLogs.driver.start();
      await withoutLogs.driver.stop();
      expect(reads(withoutLogs.desktop)).toBe(0);
      expect(only(withoutLogs.recorder.events, "screen-reader-log")).toEqual([]);
    });

    it("reads nothing as the process exits", async () => {
      const { driver, desktop } = recordingLogs();
      desktop.nvdaLog = FIRST_LOG;
      await driver.start();
      driver.abandon();
      expect(reads(desktop)).toBe(0);
    });
  });

  describe("a log that can't be had", () => {
    const NOT_THERE: NewRunEvent = {
      type: "screen-reader-log",
      file: null,
      reason: "NVDA's log wasn't there.",
    };

    it("is recorded as no copy, saying it wasn't there, when there is no file", async () => {
      const { driver, desktop, recorder } = recordingLogs();
      desktop.nvdaLog = null;
      await driver.start();
      await driver.stop();
      expect(recorder.logs).toEqual([]);
      expect(only(recorder.events, "screen-reader-log")).toEqual([NOT_THERE]);
    });

    it("is recorded the same when the file is empty", async () => {
      for (const empty of ["", "\r\n  \r\n"]) {
        const { driver, desktop, recorder } = recordingLogs();
        desktop.nvdaLog = empty;
        await driver.start();
        await driver.stop();
        expect(recorder.logs, JSON.stringify(empty)).toEqual([]);
        expect(only(recorder.events, "screen-reader-log"), JSON.stringify(empty)).toEqual([
          NOT_THERE,
        ]);
      }
    });

    it("is recorded as no copy, with the error's words and the account's folder left out, when it can't be read", async () => {
      const { driver, desktop, recorder } = recordingLogs();
      desktop.nvdaLog = new Error(
        String.raw`EBUSY: resource busy or locked, open 'C:\Users\pat\AppData\Local\Temp\nvda.log'`,
      );
      await driver.start();
      await driver.stop();
      expect(recorder.logs).toEqual([]);
      expect(only(recorder.events, "screen-reader-log")).toEqual([
        {
          type: "screen-reader-log",
          file: null,
          reason: String.raw`EBUSY: resource busy or locked, open '%USERPROFILE%\AppData\Local\Temp\nvda.log'`,
        },
      ]);
    });

    it("is recorded as no copy, and not read, when the account's home folder isn't known", async () => {
      // A copy says the home folder is written as %USERPROFILE%, which it can't be when it's unknown.
      for (const home of ["", "  "]) {
        const { driver, desktop, deps, recorder } = recordingLogs();
        deps.home = home;
        desktop.nvdaLog = FIRST_LOG;
        await driver.start();
        await driver.stop();
        expect(reads(desktop), JSON.stringify(home)).toBe(0);
        expect(recorder.logs, JSON.stringify(home)).toEqual([]);
        expect(only(recorder.events, "screen-reader-log"), JSON.stringify(home)).toEqual([
          {
            type: "screen-reader-log",
            file: null,
            reason:
              "The account's home folder isn't known, so NVDA's log couldn't be cleaned of it.",
          },
        ]);
      }
    });

    it("never stops the stop: the browser closes, the person's NVDA starts again, and the lock is let go", async () => {
      for (const log of [null, new Error("EBUSY: resource busy or locked")]) {
        const { driver, desktop, deps, nvda, recorder } = recordingLogs();
        desktop.ownNvda = [OWN_NVDA];
        desktop.nvdaLog = log;
        await driver.start();
        await driver.openPage(URL_HOME);
        await driver.stop();
        expect(nvda.started).toBe(false);
        expect(desktop.sessions.every((session) => session.closed)).toBe(true);
        expect(desktop.restarts).toEqual([OWN_NVDA]);
        expect(recorder.types().at(-2)).toBe("own-screen-reader-restarted");
        expect(recorder.types().at(-1)).toBe("screen-reader-lock-released");
        // The NVDA lock was let go.
        await setup({ lockFile: deps.lockFile }).driver.start();
      }
    });

    it("never stops a restart, which starts again after it", async () => {
      const { driver, desktop, recorder } = recordingLogs();
      desktop.nvdaLog = new Error("EBUSY: resource busy or locked");
      await driver.start();
      await driver.stop({ restarting: true });
      desktop.nvdaLog = SECOND_LOG;
      await driver.start();
      await driver.stop();
      // The first session has no copy, with why, and the second has its own.
      expect(only(recorder.events, "screen-reader-log")).toEqual([
        { type: "screen-reader-log", file: null, reason: "EBUSY: resource busy or locked" },
      ]);
      expect(recorder.logs).toEqual([cleaned(SECOND_LOG)]);
    });
  });

  it("is read from the temp folder's nvda.log, with the account's home folder, by the driver voicecap makes", async () => {
    // The wiring of the real driver, which nothing else here builds: made with the folders of the
    // test's own, so that the real temp folder's log is never read.
    const dir = mkdtempSync(path.join(os.tmpdir(), "voicecap-factory-log-"));
    temps.push(dir);
    writeFileSync(path.join(dir, "nvda.log"), FIRST_LOG);
    writeFileSync(path.join(dir, "nvda-old.log"), SECOND_LOG);
    const tmpdir = vi.spyOn(os, "tmpdir").mockReturnValue(dir);
    const homedir = vi.spyOn(os, "homedir").mockReturnValue(HOME);
    try {
      const driver = createGuidepupNvdaDriver(
        { config: DEFAULT_CONFIG, logger: createMemoryLogger() },
        "win32",
      );
      const { deps } = driver as unknown as { deps: GuidepupDriverDeps };
      await expect(deps.readNvdaLog()).resolves.toBe(FIRST_LOG);
      expect(deps.home).toBe(HOME);
    } finally {
      tmpdir.mockRestore();
      homedir.mockRestore();
    }
  });

  it("is kept in the run's folder, with its event, when the recorder is a run's event log", async () => {
    const { driver, desktop } = setup();
    const dir = mkdtempSync(path.join(os.tmpdir(), "voicecap-driver-log-"));
    temps.push(dir);
    const file = path.join(dir, "events.jsonl");
    const now = () => new Date(2026, 9, 6, 9, 0, 0, 0);
    driver.setEventRecorder(openEventLog(file, { now, logger: createMemoryLogger(), session: 1 }));
    desktop.nvdaLog = FIRST_LOG;
    await driver.start();
    await driver.stop({ restarting: true });
    desktop.nvdaLog = SECOND_LOG;
    await driver.start();
    await driver.stop();

    expect(readFileSync(path.join(dir, "nvda-log", "1-1.txt"), "utf8")).toBe(cleaned(FIRST_LOG));
    expect(readFileSync(path.join(dir, "nvda-log", "1-2.txt"), "utf8")).toBe(cleaned(SECOND_LOG));
    const logged = readEventLog(readFileSync(file, "utf8")).events.flatMap(
      ({ at: _at, ...event }) => (event.type === "screen-reader-log" ? [event] : []),
    );
    expect(logged).toEqual([
      { type: "screen-reader-log", file: "nvda-log/1-1.txt", reason: null },
      { type: "screen-reader-log", file: "nvda-log/1-2.txt", reason: null },
    ]);
  });
});
