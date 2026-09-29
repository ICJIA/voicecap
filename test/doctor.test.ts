import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { loadPlatformReadiness } from "../src/drivers/readiness.js";
import { InterruptedError } from "../src/passes/steps.js";
import { interruptMessage, runDoctor } from "../src/readiness/doctor.js";
import type { Check, CheckRunner, PlatformReadiness, Problem } from "../src/readiness/model.js";
import { createMemoryLogger, silentLogger } from "../src/util/log.js";

/** A fixed local time, matching the design spec's "2026-09-28 11:10" example. */
const NOW = () => new Date(2026, 8, 28, 11, 10);

function fakeRunner(id: string, check: Check): CheckRunner {
  return { id, run: () => Promise.resolve(check) };
}

const PROBLEM: Problem = {
  title: "Something's wrong",
  whatsWrong: "It's broken.",
  fix: ["Fix it.", "Run npx @icjia/voicecap doctor again."],
  setupHelps: false,
};

/** An all-OK platform: one quick check, no live test, unless overridden. */
function fakePlatform(overrides: Partial<PlatformReadiness> = {}): PlatformReadiness {
  return {
    screenReader: "NVDA",
    cannotRunYet: null,
    readyTip: null,
    liveTestNotice: [],
    checkingNotice: [],
    liveTest: null,
    machineInfo: () => Promise.resolve({ lines: [], screenReader: "NVDA", system: "Fake OS" }),
    quickChecks: () => [
      fakeRunner("quick", { id: "quick", status: "OK", summary: "Quick is fine" }),
    ],
    ...overrides,
  };
}

describe("runDoctor", () => {
  it("runs the live test and prints Ready when every check passes", async () => {
    let liveCalls = 0;
    const platform = fakePlatform({
      liveTestNotice: ["Get ready.", "Hands off the keyboard."],
      liveTest: () => {
        liveCalls++;
        return Promise.resolve([{ id: "live", status: "OK", summary: "Live check passed" }]);
      },
    });
    const logger = createMemoryLogger();
    const code = await runDoctor({ platform, logger, now: NOW });

    expect(code).toBe(0);
    expect(liveCalls).toBe(1);
    const text = logger.text();
    expect(text).toContain("voicecap doctor, 2026-09-28 11:10");
    expect(text).toContain("Ready: this computer can run NVDA for voicecap.");
    expect(text).toContain("Get ready.");
    expect(text).toContain("Hands off the keyboard.");
  });

  it("says the computer is set up, but voicecap can't run its screen reader yet, when it can't", async () => {
    const platform = fakePlatform({
      screenReader: "VoiceOver",
      cannotRunYet: "voicecap can't run VoiceOver yet.",
    });
    const logger = createMemoryLogger();

    expect(await runDoctor({ platform, logger, now: NOW })).toBe(0);
    const text = logger.text();
    expect(text).toContain(
      "Ready: this computer is set up for VoiceOver, but voicecap can't run VoiceOver yet: that comes with its VoiceOver driver.",
    );
    expect(text).not.toContain("can run VoiceOver for voicecap");
  });

  it("fails without running the live test when a quick check FAILs, printing the problem block", async () => {
    let liveCalls = 0;
    const platform = fakePlatform({
      quickChecks: () => [
        fakeRunner("quick", {
          id: "quick",
          status: "FAIL",
          summary: "Quick check is broken",
          problem: PROBLEM,
        }),
      ],
      liveTest: () => {
        liveCalls++;
        return Promise.resolve([]);
      },
    });
    const logger = createMemoryLogger();
    const code = await runDoctor({ platform, logger, now: NOW });

    expect(code).toBe(2);
    expect(liveCalls).toBe(0);
    const text = logger.text();
    expect(text).toContain("Not ready: 1 problem.");
    expect(text).toContain("1. Something's wrong");
  });

  it("fails when the live test itself FAILs", async () => {
    const platform = fakePlatform({
      liveTest: () =>
        Promise.resolve([
          { id: "live", status: "FAIL", summary: "Live check broke", problem: PROBLEM },
        ]),
    });
    const logger = createMemoryLogger();
    const code = await runDoctor({ platform, logger, now: NOW });

    expect(code).toBe(2);
    expect(logger.text()).toContain("Not ready: 1 problem.");
  });

  it("exits 130 on Ctrl+C during the live test, with no Ready/Not ready verdict", async () => {
    const platform = fakePlatform({ liveTest: () => Promise.reject(new InterruptedError()) });
    const logger = createMemoryLogger();
    const code = await runDoctor({ platform, logger, now: NOW });

    expect(code).toBe(130);
    const text = logger.text();
    expect(text).toContain("Interrupted: the screen reader and the browser were shut down.");
    expect(text).not.toMatch(/Ready:|Not ready:/);
  });

  it("says the platform's checking notice, then a blank line, before the checks begin", async () => {
    const logger = createMemoryLogger();
    let shown: string | null = null;
    const platform = fakePlatform({
      checkingNotice: ["Checking this computer.", "Click Allow if you're asked."],
      // Each preflight's first call.
      machineInfo: () => {
        shown = logger.text();
        return Promise.resolve({ lines: [], screenReader: "NVDA", system: "Fake OS" });
      },
    });
    await runDoctor({ platform, logger, now: NOW });
    expect(shown).toBe("Checking this computer.\nClick Allow if you're asked.\n");
    expect(logger.text()).toContain(
      "Checking this computer.\nClick Allow if you're asked.\n\nvoicecap doctor, 2026-09-28 11:10",
    );
  });

  it("says nothing first on a platform with no checking notice", async () => {
    const logger = createMemoryLogger();
    await runDoctor({ platform: fakePlatform(), logger, now: NOW });
    expect(logger.text().startsWith("voicecap doctor, 2026-09-28 11:10")).toBe(true);
  });

  it("doctor's words on Ctrl+C name the platform's screen reader", () => {
    expect(interruptMessage("VoiceOver")("SIGINT")).toBe(
      "SIGINT received: stopping the test and shutting down VoiceOver and the browser. Press Ctrl+C again to exit immediately.",
    );
    expect(interruptMessage(null)("SIGHUP")).toBe(
      "SIGHUP received: stopping the test and shutting down the screen reader and the browser. Press Ctrl+C again to exit immediately.",
    );
  });

  it("Linux: fails at the platform check, with the 'no screen reader' block", async () => {
    const platform = await loadPlatformReadiness({
      platform: "linux",
      config: DEFAULT_CONFIG,
      logger: silentLogger,
      env: {},
      cwd: "/work",
      again: "npx @icjia/voicecap doctor",
    });
    const logger = createMemoryLogger();
    const code = await runDoctor({ platform, logger, now: NOW });

    expect(code).toBe(2);
    expect(logger.text()).toContain("No screen reader to drive here");
  });
});
