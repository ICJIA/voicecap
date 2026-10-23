import { readFileSync } from "node:fs";
import net, { type AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import type * as GuidepupModule from "@guidepup/guidepup";
import { describe, expect, it } from "vitest";

import {
  acceptsConnections,
  GuidepupNvda,
  handleUnawaitedKeyPresses,
  loadGuidepupNvda,
  withoutAddedListeners,
} from "../src/drivers/guidepup/nvda.js";
import { readGuidepupPackage } from "../src/drivers/guidepup/paths.js";
import { EnvironmentError } from "../src/util/errors.js";

describe("Guidepup's signal handlers", () => {
  it("are removed after starting NVDA, leaving voicecap's own in place", async () => {
    const voicecaps = () => {};
    const guidepups = () => {};
    process.on("SIGINT", voicecaps);
    try {
      await withoutAddedListeners(["SIGINT", "SIGTERM", "beforeExit"], () => {
        process.on("SIGINT", guidepups);
        process.on("SIGTERM", guidepups);
        process.on("beforeExit", guidepups);
        return Promise.resolve();
      });
      expect(process.listeners("SIGINT")).toContain(voicecaps);
      expect(process.listeners("SIGINT")).not.toContain(guidepups);
      expect(process.listeners("SIGTERM")).not.toContain(guidepups);
      expect(process.listeners("beforeExit")).not.toContain(guidepups);
    } finally {
      process.off("SIGINT", voicecaps);
      process.off("SIGINT", guidepups);
      process.off("SIGTERM", guidepups);
      process.off("beforeExit", guidepups);
    }
  });

  // Guidepup attaches them as soon as start() is called, and NVDA can take many seconds to start.
  it("are removed before NVDA has finished starting, so Ctrl+C meanwhile is voicecap's alone", async () => {
    const guidepups = () => {};
    let duringStart: unknown[] = [];
    try {
      await withoutAddedListeners(["SIGINT"], async () => {
        process.on("SIGINT", guidepups);
        await new Promise((resolve) => setImmediate(resolve));
        duringStart = process.listeners("SIGINT");
      });
      expect(duringStart).not.toContain(guidepups);
    } finally {
      process.off("SIGINT", guidepups);
    }
  });

  it("are removed even when starting NVDA fails", async () => {
    const guidepups = () => {};
    await expect(
      withoutAddedListeners(["SIGINT"], () => {
        process.on("SIGINT", guidepups);
        return Promise.reject(new Error("NVDA cannot be started"));
      }),
    ).rejects.toThrow("NVDA cannot be started");
    expect(process.listeners("SIGINT")).not.toContain(guidepups);
  });
});

// Guidepup checks that NVDA is running the same way: by connecting to NVDA's port.
describe("checking that NVDA is running", () => {
  it("says yes while something accepts connections on the port, and no once nothing does", async () => {
    const server = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    expect(await acceptsConnections(port)).toBe(true);
    await new Promise((resolve) => server.close(resolve));
    expect(await acceptsConnections(port)).toBe(false);
  });
});

const INSTALL = { build: "0.2.1-2026.2", cacheDir: "C:\\guidepup", nvdaExe: "nvda.exe" };

/** A stand-in for the @guidepup/guidepup module, with the NVDA methods the adapter uses. */
function fakeGuidepup(nvdaOverrides: Record<string, unknown> = {}) {
  const nvda = {
    version: "0.2.1-2026.2",
    keyboardCommands: {
      reportTitle: { name: "reportTitle" },
      exitFocusMode: { name: "exitFocusMode" },
      moveToNext: { name: "moveToNext" },
      moveToNextHeading: { name: "moveToNextHeading" },
      readNextFocusableItem: { name: "readNextFocusableItem" },
    },
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    perform: () => Promise.resolve(),
    lastSpokenPhrase: () => Promise.resolve("heading, level 1, Welcome"),
    clearSpokenPhraseLog: () => Promise.resolve(),
    capture: async (action: () => Promise<void>) => {
      await action();
      return { spokenPhrase: "Skip to main content, link" };
    },
    getSettings: () => ({}),
    ...nvdaOverrides,
  };
  const lib = {
    nvda,
    WindowsKeyCodes: { Home: 0x24, End: 0x23 },
    WindowsModifiers: { Control: 0x11 },
  } as unknown as typeof GuidepupModule;
  return { lib, nvda };
}

/**
 * A stand-in for Guidepup 0.36.4's NVDA object with its start and stop flags: it counts an NVDA as
 * started from a start that succeeded until a stop that finished, its start says "NVDA is already
 * running" while it does, and a stop whose quit times out leaves that NVDA counted.
 */
function guidepupWithFlags(options: { stopFailures?: number; startFailure?: string } = {}) {
  let started = false;
  let stopFailures = options.stopFailures ?? 0;
  let stops = 0;
  const { lib } = fakeGuidepup({
    start: () => {
      if (started) return Promise.reject(new Error("NVDA is already running"));
      if (options.startFailure) return Promise.reject(new Error(options.startFailure));
      started = true;
      return Promise.resolve();
    },
    stop: () => {
      stops++;
      if (!started) return Promise.reject(new Error("NVDA is not running"));
      if (stopFailures > 0) {
        stopFailures--;
        return Promise.reject(
          new Error("Timed out waiting for NVDA to quit (an NVDA dialog may be open)"),
        );
      }
      started = false;
      return Promise.resolve();
    },
  });
  return { lib, started: () => started, stops: () => stops };
}

/** The rejections nobody handled while the action ran. */
async function unhandledRejectionsDuring(action: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const listener = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  try {
    await action();
    await delay(20); // Node reports unhandled rejections after the current job
  } finally {
    process.off("unhandledRejection", listener);
  }
  return unhandled;
}

// Guidepup presses NVDA's stop-speech key without waiting for the result (NVDAClient's
// #stopReading). Once NVDA has died, that press fails (failing to reconnect, or writing to a
// closed connection), and nothing handles the rejection, which by default ends the process.
describe("Guidepup's key presses that nobody waits for", () => {
  it("fail quietly, while a caller that waits still sees the failure", async () => {
    class Client {
      sendKeyCode(): Promise<void> {
        return Promise.reject(new Error("write ECANCELED"));
      }
    }
    handleUnawaitedKeyPresses(Client.prototype);
    const unhandled = await unhandledRejectionsDuring(async () => {
      void new Client().sendKeyCode();
      await expect(new Client().sendKeyCode()).rejects.toThrow("ECANCELED");
    });
    expect(unhandled).toEqual([]);
  });

  // Guidepup loads on every system voicecap's CI runs on: from 0.36.0, on Linux too (with Orca).
  it("fail quietly in Guidepup's own client once voicecap has loaded Guidepup", async () => {
    await loadGuidepupNvda(INSTALL);
    const { NVDAClient } = await import("@guidepup/guidepup/lib/windows/NVDA/NVDAClient.js");
    const { WindowsKeyCodes } = await import("@guidepup/guidepup");
    const unhandled = await unhandledRejectionsDuring(() => {
      // Not a connected client, so the press fails, as it does once NVDA has died.
      void NVDAClient.prototype.sendKeyCode.call({} as never, {
        keyCode: [WindowsKeyCodes.Down],
      });
      return Promise.resolve();
    });
    expect(unhandled).toEqual([]);
  });

  it("don't change how the rest of the process handles unhandled rejections", async () => {
    const before = process.listeners("unhandledRejection");
    const nvda = new GuidepupNvda(fakeGuidepup().lib, INSTALL);
    await nvda.start({ capture: "complete", settings: {} });
    expect(process.listeners("unhandledRejection")).toEqual(before);
  });
});

describe("the pinned Guidepup package", () => {
  it("is read from voicecap's own dependencies, with the NVDA build its manifest names", () => {
    const pinned = (
      JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
        dependencies: Record<string, string>;
      }
    ).dependencies["@guidepup/guidepup"];
    const guidepup = readGuidepupPackage();
    expect(guidepup.version).toBe(pinned);
    expect(guidepup.nvdaBuild).toMatch(/^\d+\.\d+\.\d+-\d{4}\.\d+/);
  });

  // The adapter knows a start refused after a failed stop by these words (see its start()).
  it("refuses a start with the words the adapter looks for", async () => {
    const errors = await import("@guidepup/guidepup/lib/windows/errors.js");
    expect(errors.ERR_NVDA_ALREADY_RUNNING).toBe("NVDA is already running");
  });
});

// Guidepup silences NVDA (at least 250 ms) before every command it captures. Once its connection
// to NVDA is gone for good, it skips that and the speech, and doesn't send the key either, so the
// command comes back at once with no speech, whether or not NVDA is still running.
describe("commands Guidepup didn't send", () => {
  /** A clock that the fake NVDA's commands move on. */
  function withClock(commandMs: number) {
    let now = 0;
    const clock = () => now;
    const { lib } = fakeGuidepup({
      perform: () => {
        now += commandMs;
        return Promise.resolve();
      },
      capture: async (action: () => Promise<void>) => {
        await action();
        now += commandMs;
        return { spokenPhrase: "" };
      },
    });
    return new GuidepupNvda(lib, INSTALL, clock);
  }

  it("fail when a captured command comes back too quickly to have been sent", async () => {
    const nvda = withClock(0);
    const press = nvda.press("nextLine");
    await expect(press).rejects.toThrow(EnvironmentError);
    await expect(press).rejects.toMatchObject({ failure: "screen-reader-stopped" });
    const speech = nvda.speechDuring(() => Promise.resolve());
    await expect(speech).rejects.toThrow(/connection/);
    await expect(speech).rejects.toMatchObject({ failure: "screen-reader-stopped" });
  });

  it("go through when Guidepup took the time to capture them", async () => {
    const nvda = withClock(1300);
    expect(await nvda.press("nextLine")).toBe("heading, level 1, Welcome");
    expect(await nvda.speechDuring(() => Promise.resolve())).toBe("");
  });

  it("aren't expected to take any time when nothing is captured", async () => {
    const nvda = withClock(0);
    expect(await nvda.press("exitFocusMode", { capture: false })).toBe("");
  });
});

const START = { capture: "complete" as const, settings: {} };

// Guidepup has one NVDA object for the whole process, and voicecap wraps it in a new adapter at
// each start, so what a failed stop leaves behind meets the next start, whichever adapter makes it.
describe("a start after a stop that failed", () => {
  it("stops the NVDA Guidepup still counts as running, then starts", async () => {
    const guidepup = guidepupWithFlags({ stopFailures: 1 });
    const first = new GuidepupNvda(guidepup.lib, INSTALL);
    await first.start(START);
    await expect(first.stop()).rejects.toThrow("Timed out waiting for NVDA to quit");
    await new GuidepupNvda(guidepup.lib, INSTALL).start(START);
    expect(guidepup.started()).toBe(true);
    expect(guidepup.stops()).toBe(2);
  });

  it("fails with the reason when that NVDA still can't be stopped", async () => {
    const guidepup = guidepupWithFlags({ stopFailures: 2 });
    const first = new GuidepupNvda(guidepup.lib, INSTALL);
    await first.start(START);
    await expect(first.stop()).rejects.toThrow("Timed out waiting for NVDA to quit");
    await expect(new GuidepupNvda(guidepup.lib, INSTALL).start(START)).rejects.toThrow(
      "Timed out waiting for NVDA to quit (an NVDA dialog may be open)",
    );
  });
});

describe("a start that fails for another reason", () => {
  it("keeps its reason, and stops nothing", async () => {
    const guidepup = guidepupWithFlags({ startFailure: "NVDA cannot be started" });
    await expect(new GuidepupNvda(guidepup.lib, INSTALL).start(START)).rejects.toThrow(
      "NVDA cannot be started",
    );
    expect(guidepup.stops()).toBe(0);
  });
});
