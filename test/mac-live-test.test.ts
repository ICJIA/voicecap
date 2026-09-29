import { describe, expect, it } from "vitest";

import {
  guidepupVoiceOver,
  macLiveTest,
  VOICECAP_VOICEOVER_SETTINGS,
  type MacLiveDeps,
  type VoiceOverControl,
} from "../src/drivers/voiceover/live-test.js";
import {
  SETTINGS_PAGES,
  VOICEOVER_STARTER,
  type CommandResult,
  type RunCommand,
} from "../src/drivers/voiceover/macos.js";
import { InterruptedError } from "../src/passes/steps.js";
import type { Check } from "../src/readiness/model.js";
import { EnvironmentError } from "../src/util/errors.js";
import { fakeCommands } from "./helpers/fake-commands.js";

// Every test drives a fake Mac: no osascript, pgrep, pkill, VoiceOver, Guidepup, or browser runs.

const APP = "Visual Studio Code";
const AGAIN = "npx @icjia/voicecap doctor";
const BROWSER_PID = 4242;
const PAGE_URL = "http://127.0.0.1:61234/";
const PHRASE = "voicecap doctor, web content";

const DENIED: Partial<CommandResult> = {
  code: 1,
  stderr: "execution error: Not authorized to send Apple events to VoiceOver. (-1743)",
};
/** osascript killed at its timeout: a first-time permission prompt is probably still on screen. */
const NO_ANSWER: Partial<CommandResult> = { code: null, signal: "SIGTERM", stderr: "" };

/** Whose VoiceOver is running on the fake Mac, if any. */
type VoiceOverState = "off" | "the person's" | "voicecap's";

interface FakeMacOptions {
  /** The person's VoiceOver is on before the test. */
  on?: boolean;
  /**
   * What osascript gives for step 1's question to VoiceOver. Asking VoiceOver to quit needs the
   * same permission, so it gets the same result.
   */
  voiceOverAnswers?: Partial<CommandResult>;
  /** false: VoiceOverStarter does nothing. */
  starterWorks?: boolean;
  /**
   * VoiceOver's process appears this long after VoiceOverStarter runs, as the real one takes a
   * moment, on the fake Mac's clock: the test's waits move it on.
   */
  startTakesMs?: number;
  /**
   * The first this many pgreps are killed by a signal, as a closed terminal's SIGHUP kills
   * everything in voicecap's process group.
   */
  pgrepKilled?: number;
  /** Guidepup's start fails with this (after quitting any VoiceOver that was running). */
  guidepupStartError?: Error;
  /**
   * Guidepup's stop fails with this, VoiceOver still running, as Guidepup 0.34.0's does when
   * VoiceOver survives both of its attempts to quit it.
   */
  guidepupStopError?: Error;
  /** VoiceOver survives being asked to quit, and pkill. */
  unstoppable?: boolean;
  /** After the exit hook's pkill, pgrep still finds VoiceOver's process this many times. */
  lingersFor?: number;
  /** What osascript gives when asked to bring the browser to the front. */
  raiseAnswers?: Partial<CommandResult>;
  /** The process System Events says is frontmost once the browser is raised. */
  frontmostPid?: number;
  /** What VoiceOver says for VO-F4. */
  phrase?: string;
  /** Runs while the check page loads, e.g. a test's Ctrl+C. */
  whileLoading?: () => void;
  /** Runs as step 1 asks VoiceOver its question. */
  whileAsking?: () => void;
  /**
   * Step 1's question gets no answer, as while a permission prompt is on screen: osascript runs
   * until something kills it. Here only Ctrl+C can, through its abort signal.
   */
  questionHangs?: boolean;
  /** Runs after each wait, given how many there have been. */
  whileWaiting?: (waits: number) => void;
  /** The lock can't be taken. */
  lockError?: Error;
}

/** How runCommand resolves for a command killed by Ctrl+C: once `signal` aborts, never before. */
function killedOnAbort(signal: AbortSignal | undefined): Promise<Partial<CommandResult>> {
  return new Promise((resolve) => {
    const killed = () => resolve({ code: null, signal: "SIGTERM", stdout: "", stderr: "" });
    if (signal?.aborted) killed();
    else signal?.addEventListener("abort", killed, { once: true });
  });
}

/** A label for each command, in the fake Mac's log of events. */
function describeCommand(file: string, args: string[]): string {
  const text = args.join(" ");
  if (file === "pgrep") return "pgrep VoiceOver";
  if (file === VOICEOVER_STARTER) return "VoiceOverStarter";
  if (file === "pkill") return "pkill VoiceOver";
  if (file === "hdiutil" && text === "detach /Volumes/GuidepupVoiceOverPreferences") {
    return "detach Guidepup's settings";
  }
  if (text.includes("get text under cursor")) return "ask VoiceOver";
  if (text.includes('"VoiceOver" to quit')) return "ask VoiceOver to quit";
  if (text.includes("set frontmost")) return "raise the browser";
  if (text.includes("whose frontmost is true")) return "ask which process is frontmost";
  return `${file} ${text}`;
}

/**
 * A Mac where VoiceOver's state follows the commands and Guidepup calls the live test makes, as the
 * real ones do: VoiceOverStarter starts the person's VoiceOver, a quit that VoiceOver accepts or
 * pkill stops it, and Guidepup's start quits any running VoiceOver before starting its own (and
 * stops it again when starting fails), as Guidepup 0.34.0 does.
 */
function fakeMac(options: FakeMacOptions = {}) {
  const state: { voiceOver: VoiceOverState } = { voiceOver: options.on ? "the person's" : "off" };
  const events: string[] = [];
  const waits: number[] = [];
  /** The abort signal each wait was given. */
  const waitSignals: (AbortSignal | undefined)[] = [];
  /** What the live test said through deps.warn. */
  const warned: string[] = [];
  /** The exit hook the live test holds now, if any. */
  let exitHook: (() => void) | null = null;
  /** The commands that hook ran, synchronously. */
  const syncCalls: { file: string; args: string[]; detached?: boolean }[] = [];
  /** The waits between those commands. */
  const syncWaits: number[] = [];
  /** How many more times pgrep finds VoiceOver's process after pkill has ended it. */
  let lingering = 0;
  /** The fake Mac's clock, in ms: each wait moves it on. */
  let clock = 0;
  /** When a VoiceOver that's still starting appears, on that clock. */
  let appearsAt: number | null = null;
  /** How many more pgreps a signal kills. */
  let pgrepKills = options.pgrepKilled ?? 0;
  /** A VoiceOver that's still starting comes up once its time has come. */
  const settle = () => {
    if (appearsAt !== null && clock >= appearsAt) {
      state.voiceOver = "the person's";
      appearsAt = null;
    }
  };
  /** VoiceOverStarter starts the person's VoiceOver, at once or after startTakesMs. */
  const starterRuns = () => {
    if (state.voiceOver !== "off" || options.starterWorks === false) return;
    if (options.startTakesMs) appearsAt ??= clock + options.startTakesMs;
    else state.voiceOver = "the person's";
  };
  const seen: {
    settings: Record<string, unknown> | null;
    load: { url: string; timeoutMs: number } | null;
  } = { settings: null, load: null };

  const commands = fakeCommands([
    [(file) => file === "pgrep" && state.voiceOver !== "off", { code: 0, stdout: "501\n" }],
    [(file) => file === "pgrep", { code: 1 }],
    [(file) => file === VOICEOVER_STARTER, { code: 0 }],
    [(file) => file === "pkill", { code: 0 }],
    [(file) => file === "hdiutil", { code: 0 }],
    [
      (file, args) =>
        file === "osascript" && args.join(" ").includes('tell application "VoiceOver"'),
      options.voiceOverAnswers ?? { code: 0, stdout: "voicecap doctor check\n" },
    ],
    [
      (file, args) => file === "osascript" && args.join(" ").includes("set frontmost"),
      options.raiseAnswers ?? { code: 0 },
    ],
    [
      (file, args) => file === "osascript" && args.join(" ").includes("whose frontmost is true"),
      { code: 0, stdout: `${options.frontmostPid ?? BROWSER_PID}\n` },
    ],
  ]);
  const run: RunCommand = async (file, args, runOptions) => {
    const event = describeCommand(file, args);
    events.push(event);
    settle();
    let result = await commands.run(file, args, runOptions);
    if (file === "pgrep" && pgrepKills > 0) {
      pgrepKills--;
      result = { code: null, signal: "SIGHUP", stdout: "", stderr: "" };
    }
    if (event === "ask VoiceOver") {
      options.whileAsking?.();
      if (options.questionHangs)
        result = { ...result, ...(await killedOnAbort(runOptions?.signal)) };
    }
    if (event === "VoiceOverStarter") starterRuns();
    if (!options.unstoppable) {
      if (event === "pkill VoiceOver") state.voiceOver = "off";
      if (event === "ask VoiceOver to quit" && result.code === 0) state.voiceOver = "off";
    }
    return result;
  };

  const voiceOver: VoiceOverControl = {
    start(settings) {
      events.push("Guidepup starts VoiceOver");
      seen.settings = settings;
      state.voiceOver = "off";
      if (options.guidepupStartError) return Promise.reject(options.guidepupStartError);
      state.voiceOver = "voicecap's";
      return Promise.resolve();
    },
    stop() {
      events.push("Guidepup stops VoiceOver");
      if (options.guidepupStopError) return Promise.reject(options.guidepupStopError);
      state.voiceOver = "off";
      return Promise.resolve();
    },
    describeFocus() {
      events.push("VO-F4");
      return Promise.resolve(options.phrase ?? PHRASE);
    },
  };

  const deps: MacLiveDeps = {
    run,
    app: APP,
    again: AGAIN,
    loadVoiceOver: () => {
      events.push("load Guidepup");
      return Promise.resolve(voiceOver);
    },
    launchBrowser: () => {
      events.push("launch the browser");
      return Promise.resolve({
        pid: BROWSER_PID,
        load: (url: string, timeoutMs: number) => {
          events.push(`load ${url}`);
          seen.load = { url, timeoutMs };
          options.whileLoading?.();
          return Promise.resolve({});
        },
        close: () => {
          events.push("close the browser");
          return Promise.resolve();
        },
      });
    },
    serveCheckPage: () => {
      events.push("serve the check page");
      return Promise.resolve({
        url: PAGE_URL,
        close: () => {
          events.push("close the check page");
          return Promise.resolve();
        },
      });
    },
    lock: () => {
      events.push("take the lock");
      if (options.lockError) return Promise.reject(options.lockError);
      return Promise.resolve(() => {
        events.push("release the lock");
        return Promise.resolve();
      });
    },
    sleep: (ms, signal) => {
      waits.push(ms);
      waitSignals.push(signal);
      clock += ms;
      settle();
      options.whileWaiting?.(waits.length);
      return Promise.resolve();
    },
    warn: (message) => {
      warned.push(message);
    },
    onExit: (hook) => {
      events.push("add the exit hook");
      exitHook = hook;
      return () => {
        events.push("remove the exit hook");
        exitHook = null;
      };
    },
    // The same Mac, commanded synchronously: pkill ends VoiceOver (after `lingersFor` more checks
    // find it), pgrep finds it while it runs, and VoiceOverStarter starts the person's.
    runSync: (file, args, runOptions) => {
      syncCalls.push({ file, args, detached: runOptions?.detached });
      settle();
      if (file === "pkill" && !options.unstoppable) {
        state.voiceOver = "off";
        lingering = options.lingersFor ?? 0;
      }
      if (file === "pgrep") {
        if (lingering > 0) {
          lingering--;
          return 0;
        }
        return state.voiceOver === "off" ? 1 : 0;
      }
      if (file === VOICEOVER_STARTER) starterRuns();
      // A detached command's exit isn't waited for.
      return runOptions?.detached ? null : 0;
    },
    sleepSync: (ms) => {
      syncWaits.push(ms);
      clock += ms;
      settle();
    },
    now: () => clock,
  };
  return {
    deps,
    state,
    events,
    waits,
    waitSignals,
    warned,
    seen,
    calls: commands.calls,
    syncCalls,
    syncWaits,
    /** The process exits now: runs the exit hook held, if any, and says whether there was one. */
    exits: () => {
      exitHook?.();
      return exitHook !== null;
    },
    /** The fake Mac's time runs on, long after the test: a VoiceOver still starting comes up. */
    later: () => {
      clock += 60_000;
      settle();
    },
  };
}

function count(events: string[], event: string): number {
  return events.filter((candidate) => candidate === event).length;
}

/** The events from `event` (included) to the end. */
function from(events: string[], event: string): string[] {
  const index = events.indexOf(event);
  if (index === -1) throw new Error(`"${event}" never happened.`);
  return events.slice(index);
}

/** How Guidepup 0.34.0's stop fails when VoiceOver survives both of its attempts to quit it. */
const STOP_ERROR = new Error(
  "Timed out waiting for VoiceOver to not be running\n    at waitForCondition",
);
const STOP_WARN: Check = {
  id: "liveStop",
  status: "WARN",
  summary:
    "VoiceOver didn't stop cleanly (Timed out waiting for VoiceOver to not be running). If VoiceOver doesn't sound as usual, restart the Mac.",
};

const OK_CHECKS: Check[] = [
  { id: "liveControl", status: "OK", summary: "Visual Studio Code can control VoiceOver" },
  { id: "liveStart", status: "OK", summary: "VoiceOver started with voicecap's settings" },
  { id: "liveFront", status: "OK", summary: "The browser came to the front" },
  {
    id: "liveHear",
    status: "OK",
    summary: 'VoiceOver hears the page ("voicecap doctor, web content")',
  },
];

describe("the Mac live test", () => {
  it("passes its four steps in order, then puts everything back", async () => {
    const mac = fakeMac();
    expect(await macLiveTest(mac.deps)).toEqual(OK_CHECKS);
    expect(mac.events).toEqual([
      "pgrep VoiceOver",
      "take the lock",
      "add the exit hook",
      "VoiceOverStarter",
      "pgrep VoiceOver",
      "ask VoiceOver",
      "load Guidepup",
      "Guidepup starts VoiceOver",
      "serve the check page",
      "launch the browser",
      `load ${PAGE_URL}`,
      "raise the browser",
      "ask which process is frontmost",
      "VO-F4",
      "Guidepup stops VoiceOver",
      "close the browser",
      "close the check page",
      "pgrep VoiceOver",
      "remove the exit hook",
      "release the lock",
    ]);
    expect(mac.state.voiceOver).toBe("off");
  });

  // Guidepup's own AppleScript calls give up after 10 seconds, which in the spike left a "control
  // VoiceOver" prompt that no click could answer. A first-time prompt must come from a request that
  // stays alive until it's answered, before Guidepup sends any.
  it("asks VoiceOver its 60-second question before Guidepup starts VoiceOver", async () => {
    const mac = fakeMac();
    await macLiveTest(mac.deps);
    expect(mac.calls.find((call) => call.args.join(" ").includes("get text under cursor"))).toEqual(
      {
        file: "osascript",
        args: [
          "-e",
          'with timeout of 60 seconds\ntell application "VoiceOver" to get text under cursor of vo cursor\nend timeout',
        ],
        timeoutMs: 65_000,
      },
    );
    expect(mac.events.indexOf("ask VoiceOver")).toBeLessThan(
      mac.events.indexOf("Guidepup starts VoiceOver"),
    );
  });

  it("starts VoiceOver without its hints, loads the check page, and raises the browser's own process", async () => {
    const mac = fakeMac();
    await macLiveTest(mac.deps);
    expect(mac.seen.settings).toEqual({ SCRShouldOutputVOInstructions: false });
    expect(mac.seen.load).toEqual({ url: PAGE_URL, timeoutMs: 30_000 });
    const raise = mac.calls.find((call) => call.args.join(" ").includes("set frontmost"));
    expect(raise?.args.join(" ")).toContain("first process whose unix id is 4242");
  });
});

describe("the Mac live test, step 1: control of VoiceOver", () => {
  it("asks the person's own VoiceOver when it's on already, without starting it", async () => {
    const mac = fakeMac({ on: true });
    await macLiveTest(mac.deps);
    expect(mac.events.slice(0, 3)).toEqual(["pgrep VoiceOver", "take the lock", "ask VoiceOver"]);
  });

  it("fails when the terminal app isn't allowed to control VoiceOver, without loading Guidepup", async () => {
    const mac = fakeMac({ voiceOverAnswers: DENIED });
    expect(await macLiveTest(mac.deps)).toEqual([
      {
        id: "liveControl",
        status: "FAIL",
        summary: "Visual Studio Code isn't allowed to control VoiceOver",
        problem: {
          title: "Control of VoiceOver",
          whatsWrong:
            "voicecap drives VoiceOver through AppleScript, and macOS asks you once whether Visual Studio Code may control it. It was turned down.",
          fix: [
            "Open System Settings, then Privacy & Security, then Automation.",
            "Under Visual Studio Code, switch on VoiceOver.",
            "Run npx @icjia/voicecap doctor again.",
          ],
          setupHelps: false,
          open: SETTINGS_PAGES.automation,
        },
      },
    ]);
    expect(mac.events).not.toContain("load Guidepup");
  });

  it("fails with the permission prompt's text when VoiceOver doesn't answer within 60 seconds", async () => {
    const mac = fakeMac({ voiceOverAnswers: NO_ANSWER });
    expect(await macLiveTest(mac.deps)).toEqual([
      {
        id: "liveControl",
        status: "FAIL",
        summary: "No answer from VoiceOver in 60 seconds",
        problem: {
          title: "A permission prompt",
          whatsWrong:
            'macOS may be waiting for you to answer "Visual Studio Code wants access to control VoiceOver".',
          fix: [
            "If that prompt is on screen, click Allow.",
            "Run npx @icjia/voicecap doctor again.",
            "If the prompt doesn't close when you click it, log out and back in, then run npx @icjia/voicecap doctor again.",
          ],
          setupHelps: false,
        },
      },
    ]);
    expect(mac.events).not.toContain("load Guidepup");
  });

  it("fails with VoiceOver's own message when the question fails any other way", async () => {
    const message = "execution error: VoiceOver got an error: AppleEvent handler failed. (-10000)";
    const mac = fakeMac({ voiceOverAnswers: { code: 1, stderr: message } });
    expect(await macLiveTest(mac.deps)).toEqual([
      {
        id: "liveControl",
        status: "FAIL",
        summary: `VoiceOver didn't answer: ${message}`,
        problem: {
          title: "VoiceOver",
          whatsWrong: message,
          fix: ["Run npx @icjia/voicecap doctor again."],
          setupHelps: false,
        },
      },
    ]);
  });

  it("says what's wrong even when the question fails without a word", async () => {
    const mac = fakeMac({ voiceOverAnswers: { code: 1, stderr: "" } });
    expect(await macLiveTest(mac.deps)).toEqual([
      {
        id: "liveControl",
        status: "FAIL",
        summary: "VoiceOver didn't answer",
        problem: {
          title: "VoiceOver",
          whatsWrong: "VoiceOver didn't answer voicecap's question, and macOS gave no reason.",
          fix: ["Run npx @icjia/voicecap doctor again."],
          setupHelps: false,
        },
      },
    ]);
  });

  it("fails when VoiceOver doesn't start within 10 seconds, checking every 250 ms", async () => {
    const mac = fakeMac({ starterWorks: false });
    expect(await macLiveTest(mac.deps)).toEqual([
      {
        id: "liveControl",
        status: "FAIL",
        summary: "VoiceOver didn't start",
        problem: {
          title: "Starting VoiceOver",
          whatsWrong: "VoiceOver didn't start within 10 seconds.",
          fix: ["Run npx @icjia/voicecap setup.", "Run npx @icjia/voicecap doctor again."],
          setupHelps: true,
        },
      },
    ]);
    expect(mac.waits).toHaveLength(40);
    expect(new Set(mac.waits)).toEqual(new Set([250]));
    expect(mac.events).not.toContain("ask VoiceOver");
  });
});

describe("the Mac live test, step 2: Guidepup starts VoiceOver", () => {
  it("fails with Guidepup's reason, and the cause it gives, when Guidepup can't start VoiceOver", async () => {
    const mac = fakeMac({
      guidepupStartError: new Error("VoiceOver cannot be started", {
        cause: new Error("Timed out waiting for VoiceOver to be running\nat waitForRunning"),
      }),
    });
    expect(await macLiveTest(mac.deps)).toEqual([
      OK_CHECKS[0],
      {
        id: "liveStart",
        status: "FAIL",
        summary: "VoiceOver didn't start",
        problem: {
          title: "Starting VoiceOver",
          whatsWrong:
            "Guidepup couldn't start VoiceOver: VoiceOver cannot be started (Timed out waiting for VoiceOver to be running)",
          fix: ["Run npx @icjia/voicecap setup.", "Run npx @icjia/voicecap doctor again."],
          setupHelps: true,
        },
      },
    ]);
    expect(mac.events).not.toContain("launch the browser");
    // Guidepup stops what it started when its start fails, so there's no Guidepup to stop.
    expect(mac.events).not.toContain("Guidepup stops VoiceOver");
  });

  it("fails the same way when Guidepup can't be loaded", async () => {
    const mac = fakeMac();
    const deps: MacLiveDeps = {
      ...mac.deps,
      loadVoiceOver: () => Promise.reject(new Error("Cannot find module '@guidepup/guidepup'")),
    };
    const checks = await macLiveTest(deps);
    expect(checks[1]?.id).toBe("liveStart");
    expect(checks[1]?.problem?.whatsWrong).toBe(
      "Guidepup couldn't start VoiceOver: Cannot find module '@guidepup/guidepup'",
    );
    expect(checks).toHaveLength(2);
  });
});

describe("the Mac live test, step 3: the browser comes to the front", () => {
  it("fails when another process stays in front of the browser", async () => {
    const mac = fakeMac({ frontmostPid: 99 });
    expect(await macLiveTest(mac.deps)).toEqual([
      ...OK_CHECKS.slice(0, 2),
      {
        id: "liveFront",
        status: "FAIL",
        summary: "The browser didn't come to the front",
        problem: {
          title: "The browser's window",
          whatsWrong: "Process 4242 didn't come to the front (process 99 is).",
          fix: [
            "Don't use the keyboard or mouse during the test.",
            "Run npx @icjia/voicecap doctor again.",
          ],
          setupHelps: false,
        },
      },
    ]);
    expect(mac.events).not.toContain("VO-F4");
  });

  it("says what's wrong even when System Events is killed at its timeout without a word", async () => {
    const mac = fakeMac({ raiseAnswers: NO_ANSWER });
    expect((await macLiveTest(mac.deps)).at(-1)).toEqual({
      id: "liveFront",
      status: "FAIL",
      summary: "The browser didn't come to the front",
      problem: {
        title: "The browser's window",
        whatsWrong:
          "System Events didn't answer when voicecap asked it to bring the browser to the front.",
        fix: [
          "Don't use the keyboard or mouse during the test.",
          "Run npx @icjia/voicecap doctor again.",
        ],
        setupHelps: false,
      },
    });
  });

  it("stops Guidepup's VoiceOver after that failure, and leaves VoiceOver off when it was off", async () => {
    const mac = fakeMac({ frontmostPid: 99 });
    await macLiveTest(mac.deps);
    expect(from(mac.events, "ask which process is frontmost")).toEqual([
      "ask which process is frontmost",
      "Guidepup stops VoiceOver",
      "close the browser",
      "close the check page",
      "pgrep VoiceOver",
      "remove the exit hook",
      "release the lock",
    ]);
    // Only step 1 started VoiceOver: nothing started it again.
    expect(count(mac.events, "VoiceOverStarter")).toBe(1);
    expect(mac.state.voiceOver).toBe("off");
  });
});

describe("the Mac live test, step 4: VoiceOver hears the page", () => {
  it("fails when VoiceOver says nothing about the focused page", async () => {
    const mac = fakeMac({ phrase: " \n" });
    expect(await macLiveTest(mac.deps)).toEqual([
      ...OK_CHECKS.slice(0, 3),
      {
        id: "liveHear",
        status: "FAIL",
        summary: "VoiceOver started, but voicecap heard nothing from it",
        problem: {
          title: "VoiceOver's speech",
          whatsWrong: "VoiceOver started, but voicecap captured no speech from it.",
          fix: [
            "Run npx @icjia/voicecap doctor again.",
            "If it happens again, run npx @icjia/voicecap setup.",
          ],
          setupHelps: true,
        },
      },
    ]);
  });
});

describe("the Mac live test: the person's own VoiceOver", () => {
  it("turns it back on after Guidepup's stop, with their own settings, when it was on", async () => {
    const mac = fakeMac({ on: true });
    expect(await macLiveTest(mac.deps)).toEqual(OK_CHECKS);
    expect(from(mac.events, "Guidepup stops VoiceOver")).toEqual([
      "Guidepup stops VoiceOver",
      "close the browser",
      "close the check page",
      "pgrep VoiceOver",
      "VoiceOverStarter",
      "pgrep VoiceOver",
      "remove the exit hook",
      "release the lock",
    ]);
    expect(mac.state.voiceOver).toBe("the person's");
  });

  it("turns it back on when Guidepup fails to start, having quit it first", async () => {
    const mac = fakeMac({ on: true, guidepupStartError: new Error("VoiceOver cannot be started") });
    await macLiveTest(mac.deps);
    expect(from(mac.events, "Guidepup starts VoiceOver")).toEqual([
      "Guidepup starts VoiceOver",
      "pgrep VoiceOver",
      "VoiceOverStarter",
      "pgrep VoiceOver",
      "remove the exit hook",
      "release the lock",
    ]);
    expect(mac.state.voiceOver).toBe("the person's");
  });

  // A closed terminal's SIGHUP reaches voicecap's whole process group, pgrep included.
  it("asks again when a signal kills the first look, rather than take theirs for off", async () => {
    const mac = fakeMac({ on: true, pgrepKilled: 1 });
    expect(await macLiveTest(mac.deps)).toEqual(OK_CHECKS);
    expect(mac.events.slice(0, 4)).toEqual([
      "pgrep VoiceOver",
      "pgrep VoiceOver",
      "take the lock",
      "ask VoiceOver",
    ]);
    // Taken for off, it would have been left off at the end.
    expect(mac.state.voiceOver).toBe("the person's");
  });

  it("leaves it running, untouched, when the test ends before Guidepup took it over", async () => {
    const mac = fakeMac({ on: true, voiceOverAnswers: DENIED });
    await macLiveTest(mac.deps);
    expect(mac.events).toEqual([
      "pgrep VoiceOver",
      "take the lock",
      "ask VoiceOver",
      "pgrep VoiceOver",
      "release the lock",
    ]);
    expect(mac.state.voiceOver).toBe("the person's");
  });

  it("leaves it off when it was off, having started it only for step 1's question", async () => {
    const mac = fakeMac();
    await macLiveTest(mac.deps);
    expect(count(mac.events, "VoiceOverStarter")).toBe(1);
    expect(mac.events.indexOf("VoiceOverStarter")).toBeLessThan(
      mac.events.indexOf("ask VoiceOver"),
    );
    expect(mac.state.voiceOver).toBe("off");
  });

  it("stops the VoiceOver step 1 started when the question is turned down, and doesn't start it again", async () => {
    const mac = fakeMac({ voiceOverAnswers: DENIED });
    await macLiveTest(mac.deps);
    expect(mac.events).toEqual([
      "pgrep VoiceOver",
      "take the lock",
      "add the exit hook",
      "VoiceOverStarter",
      "pgrep VoiceOver",
      "ask VoiceOver",
      "pgrep VoiceOver",
      // Turned down too, as the question was: pkill needs no permission.
      "ask VoiceOver to quit",
      "pkill VoiceOver",
      "pgrep VoiceOver",
      "remove the exit hook",
      "release the lock",
    ]);
    expect(mac.state.voiceOver).toBe("off");
  });

  it("warns when VoiceOver doesn't come back on within 10 seconds", async () => {
    const mac = fakeMac({ on: true, starterWorks: false });
    expect(await macLiveTest(mac.deps)).toEqual([
      ...OK_CHECKS,
      {
        id: "liveRestore",
        status: "WARN",
        summary: "Couldn't turn VoiceOver back on: press Command-F5",
      },
    ]);
    // Raising the browser's 300 ms, then 10 seconds of checks for VoiceOver to come back.
    expect(mac.waits).toEqual([300, ...Array<number>(40).fill(250)]);
    expect(mac.events.at(-1)).toBe("release the lock");
    // The WARN is in the checks, so it isn't said a second time.
    expect(mac.warned).toEqual([]);
  });

  it("warns when VoiceOver won't turn off again, when it was off", async () => {
    const mac = fakeMac({ voiceOverAnswers: DENIED, unstoppable: true });
    const checks = await macLiveTest(mac.deps);
    expect(checks.map((check) => check.id)).toEqual(["liveControl", "liveRestore"]);
    expect(checks[1]).toEqual({
      id: "liveRestore",
      status: "WARN",
      summary: "Couldn't turn VoiceOver off: press Command-F5",
    });
    // Still running, as the WARN says.
    expect(mac.state.voiceOver).not.toBe("off");
  });
});

describe("the Mac live test: when Guidepup's stop fails", () => {
  it("quits VoiceOver and detaches Guidepup's settings itself, warns, and leaves VoiceOver off when it was off", async () => {
    const mac = fakeMac({ guidepupStopError: STOP_ERROR });
    expect(await macLiveTest(mac.deps)).toEqual([...OK_CHECKS, STOP_WARN]);
    expect(from(mac.events, "Guidepup stops VoiceOver")).toEqual([
      "Guidepup stops VoiceOver",
      "ask VoiceOver to quit",
      "pkill VoiceOver",
      "pgrep VoiceOver",
      "detach Guidepup's settings",
      "close the browser",
      "close the check page",
      "pgrep VoiceOver",
      "remove the exit hook",
      "release the lock",
    ]);
    expect(mac.state.voiceOver).toBe("off");
    expect(mac.warned).toEqual([]);
  });

  it("does the same, then turns the person's VoiceOver back on, when it was on", async () => {
    const mac = fakeMac({ on: true, guidepupStopError: STOP_ERROR });
    expect(await macLiveTest(mac.deps)).toEqual([...OK_CHECKS, STOP_WARN]);
    expect(from(mac.events, "Guidepup stops VoiceOver")).toEqual([
      "Guidepup stops VoiceOver",
      "ask VoiceOver to quit",
      "pkill VoiceOver",
      "pgrep VoiceOver",
      "detach Guidepup's settings",
      "close the browser",
      "close the check page",
      "pgrep VoiceOver",
      "VoiceOverStarter",
      "pgrep VoiceOver",
      "remove the exit hook",
      "release the lock",
    ]);
    expect(mac.state.voiceOver).toBe("the person's");
  });

  it("warns that VoiceOver is still on too, when it won't quit at all and it was off", async () => {
    const mac = fakeMac({ guidepupStopError: STOP_ERROR, unstoppable: true });
    expect(await macLiveTest(mac.deps)).toEqual([
      ...OK_CHECKS,
      STOP_WARN,
      {
        id: "liveRestore",
        status: "WARN",
        summary: "Couldn't turn VoiceOver off: press Command-F5",
      },
    ]);
    expect(mac.events).toContain("detach Guidepup's settings");
  });
});

describe("the Mac live test: Ctrl+C", () => {
  it("stops at the end of the step it interrupts, cleans up, and throws InterruptedError", async () => {
    const controller = new AbortController();
    const mac = fakeMac({ whileLoading: () => controller.abort() });
    await expect(macLiveTest(mac.deps, controller.signal)).rejects.toThrow(InterruptedError);
    expect(mac.events).not.toContain("VO-F4");
    expect(from(mac.events, "ask which process is frontmost")).toEqual([
      "ask which process is frontmost",
      "Guidepup stops VoiceOver",
      "close the browser",
      "close the check page",
      "pgrep VoiceOver",
      "remove the exit hook",
      "release the lock",
    ]);
    expect(mac.state.voiceOver).toBe("off");
    expect(mac.warned).toEqual([]);
  });

  it("says the clean-up's warnings itself, since InterruptedError carries no checks", async () => {
    const controller = new AbortController();
    const mac = fakeMac({ on: true, starterWorks: false, whileLoading: () => controller.abort() });
    await expect(macLiveTest(mac.deps, controller.signal)).rejects.toThrow(InterruptedError);
    expect(mac.warned).toEqual(["Couldn't turn VoiceOver back on: press Command-F5"]);
  });

  it("says a failed Guidepup stop the same way", async () => {
    const controller = new AbortController();
    const mac = fakeMac({
      guidepupStopError: STOP_ERROR,
      whileLoading: () => controller.abort(),
    });
    await expect(macLiveTest(mac.deps, controller.signal)).rejects.toThrow(InterruptedError);
    expect(mac.warned).toEqual([STOP_WARN.summary]);
  });

  it("calls off a browser that's still starting, and throws InterruptedError, not a FAIL", async () => {
    const controller = new AbortController();
    const mac = fakeMac({ on: true });
    const launch: { signal?: AbortSignal } = {};
    const deps: MacLiveDeps = {
      ...mac.deps,
      launchBrowser: (signal) => {
        launch.signal = signal;
        controller.abort();
        return Promise.reject(
          new EnvironmentError("Chromium didn't start: the launch was called off"),
        );
      },
    };
    await expect(macLiveTest(deps, controller.signal)).rejects.toThrow(InterruptedError);
    // The launch saw Ctrl+C, so a browser still starting is killed rather than waited for.
    expect(launch.signal?.aborted).toBe(true);
    expect(from(mac.events, "Guidepup stops VoiceOver")).toEqual([
      "Guidepup stops VoiceOver",
      "close the check page",
      "pgrep VoiceOver",
      "VoiceOverStarter",
      "pgrep VoiceOver",
      "remove the exit hook",
      "release the lock",
    ]);
    expect(mac.state.voiceOver).toBe("the person's");
  });

  // With a first-time "control VoiceOver" prompt on screen, the question waits up to 60 seconds.
  it("stops step 1's question at once, then cleans up as before", async () => {
    const controller = new AbortController();
    const mac = fakeMac({ questionHangs: true, whileAsking: () => controller.abort() });
    await expect(macLiveTest(mac.deps, controller.signal)).rejects.toThrow(InterruptedError);
    expect(from(mac.events, "ask VoiceOver")).toEqual([
      "ask VoiceOver",
      "pgrep VoiceOver",
      "ask VoiceOver to quit",
      "pkill VoiceOver",
      "pgrep VoiceOver",
      "remove the exit hook",
      "release the lock",
    ]);
    expect(mac.state.voiceOver).toBe("off");
  });

  // VoiceOver's process appears a moment after its starter returns, and the clean-up looks once to
  // see whether to quit it: a start cut short could come up after that look, and stay on.
  it("lets VoiceOver finish starting, so the clean-up sees it and quits it", async () => {
    const controller = new AbortController();
    const mac = fakeMac({
      startTakesMs: 600,
      whileWaiting: (waits) => {
        if (waits === 1) controller.abort();
      },
    });
    await expect(macLiveTest(mac.deps, controller.signal)).rejects.toThrow(InterruptedError);
    expect(from(mac.events, "VoiceOverStarter")).toEqual([
      "VoiceOverStarter",
      // Checked at once, then after each wait until it's up.
      "pgrep VoiceOver",
      "pgrep VoiceOver",
      "pgrep VoiceOver",
      "pgrep VoiceOver",
      "ask VoiceOver",
      // The clean-up: VoiceOver is up, so it's quit.
      "pgrep VoiceOver",
      "ask VoiceOver to quit",
      "pkill VoiceOver",
      "pgrep VoiceOver",
      "remove the exit hook",
      "release the lock",
    ]);
    expect(mac.waits).toEqual([250, 250, 250]);
    mac.later();
    expect(mac.state.voiceOver).toBe("off");
  });

  it("gives Ctrl+C's signal to its steps' commands and waits, but not to VoiceOver's start or the clean-up", async () => {
    const controller = new AbortController();
    const mac = fakeMac({ guidepupStopError: STOP_ERROR });
    await macLiveTest(mac.deps, controller.signal);
    const given = (signal: AbortSignal | undefined) =>
      signal === controller.signal ? "Ctrl+C" : signal === undefined ? "nothing" : "another";
    expect(
      mac.calls.map((call) => `${describeCommand(call.file, call.args)}: ${given(call.signal)}`),
    ).toEqual([
      // Whether the person's VoiceOver is on: the clean-up depends on knowing.
      "pgrep VoiceOver: nothing",
      // VoiceOver's start, which runs until VoiceOver is up (or 10 seconds have passed).
      "VoiceOverStarter: nothing",
      "pgrep VoiceOver: nothing",
      "ask VoiceOver: Ctrl+C",
      "raise the browser: Ctrl+C",
      "ask which process is frontmost: Ctrl+C",
      // The clean-up must finish.
      "ask VoiceOver to quit: nothing",
      "pkill VoiceOver: nothing",
      "pgrep VoiceOver: nothing",
      "detach Guidepup's settings: nothing",
      "pgrep VoiceOver: nothing",
    ]);
    // Raising the browser's wait.
    expect(mac.waitSignals.map(given)).toEqual(["Ctrl+C"]);
  });

  it("touches nothing when Ctrl+C came before it began", async () => {
    const mac = fakeMac();
    await expect(macLiveTest(mac.deps, AbortSignal.abort())).rejects.toThrow(InterruptedError);
    expect(mac.events).toEqual([]);
  });
});

// Guidepup's own handlers for Ctrl+C and the like are removed, so if the process exits before the
// clean-up (a second Ctrl+C, a closed window), this hook does its work, synchronously.
describe("the Mac live test: when the process exits in the middle", () => {
  const PKILL = {
    file: "pkill",
    args: ["-15", "-f", "VoiceOver.app/Contents/MacOS/VoiceOver launchd -s"],
  };
  const PGREP = { file: "pgrep", args: ["-f", "VoiceOver launchd -s"] };
  const DETACH = { file: "hdiutil", args: ["detach", "/Volumes/GuidepupVoiceOverPreferences"] };
  const RESTART = { file: VOICEOVER_STARTER, args: [], detached: true };

  it("holds an exit hook from Guidepup's start until the clean-up is done, when VoiceOver was on", async () => {
    const mac = fakeMac({ on: true });
    await macLiveTest(mac.deps);
    expect(mac.events).toEqual([
      "pgrep VoiceOver",
      "take the lock",
      "ask VoiceOver",
      "load Guidepup",
      "add the exit hook",
      "Guidepup starts VoiceOver",
      "serve the check page",
      "launch the browser",
      `load ${PAGE_URL}`,
      "raise the browser",
      "ask which process is frontmost",
      "VO-F4",
      "Guidepup stops VoiceOver",
      "close the browser",
      "close the check page",
      "pgrep VoiceOver",
      "VoiceOverStarter",
      "pgrep VoiceOver",
      "remove the exit hook",
      "release the lock",
    ]);
    expect(mac.exits()).toBe(false);
  });

  it("removes the hook even when the clean-up fails", async () => {
    const mac = fakeMac();
    const deps: MacLiveDeps = {
      ...mac.deps,
      run: (file, args, options) =>
        mac.events.includes("Guidepup stops VoiceOver") && file === "pgrep"
          ? Promise.reject(new Error("pgrep vanished"))
          : mac.deps.run(file, args, options),
    };
    await expect(macLiveTest(deps)).rejects.toThrow("pgrep vanished");
    expect(mac.events.slice(-2)).toEqual(["remove the exit hook", "release the lock"]);
    expect(mac.exits()).toBe(false);
  });

  it("when VoiceOver was off and Guidepup hasn't started: stops the VoiceOver step 1 started", async () => {
    let exited = false;
    const mac = fakeMac({ whileAsking: () => (exited = mac.exits()) });
    await macLiveTest(mac.deps);
    expect(exited).toBe(true);
    expect(mac.syncCalls).toEqual([PKILL, PGREP]);
  });

  it("when VoiceOver was off and Guidepup has started: stops it and detaches Guidepup's settings", async () => {
    let exited = false;
    const mac = fakeMac({ whileLoading: () => (exited = mac.exits()) });
    await macLiveTest(mac.deps);
    expect(exited).toBe(true);
    expect(mac.syncCalls).toEqual([PKILL, PGREP, DETACH]);
  });

  it("when VoiceOver was on and Guidepup has started: does the same, then starts theirs again, detached", async () => {
    let exited = false;
    const mac = fakeMac({ on: true, whileLoading: () => (exited = mac.exits()) });
    await macLiveTest(mac.deps);
    expect(exited).toBe(true);
    expect(mac.syncCalls).toEqual([PKILL, PGREP, DETACH, RESTART]);
  });

  // A VoiceOver still quitting could keep Guidepup's settings image busy, or be taken for the
  // person's own and never come back, so the hook waits for it, as stopVoiceOver does.
  it("waits for VoiceOver to be gone before detaching, checking every 100 ms and no longer", async () => {
    let exited = false;
    const mac = fakeMac({ on: true, lingersFor: 2, whileLoading: () => (exited = mac.exits()) });
    await macLiveTest(mac.deps);
    expect(exited).toBe(true);
    expect(mac.syncCalls).toEqual([PKILL, PGREP, PGREP, PGREP, DETACH, RESTART]);
    expect(mac.syncWaits).toEqual([100, 100]);
  });

  // Step 1's start of VoiceOver, cut short by the exit: VoiceOver may still be coming up.
  it("waits for a VoiceOver that's still starting, then quits it once it's up", async () => {
    let exited = false;
    const mac = fakeMac({
      startTakesMs: 350,
      whileWaiting: (waits) => {
        if (waits === 1) exited = mac.exits();
      },
    });
    await macLiveTest(mac.deps);
    expect(exited).toBe(true);
    // Not up yet 250 ms after the starter; up after one more wait of 100 ms.
    expect(mac.syncCalls).toEqual([PGREP, PGREP, PKILL, PGREP]);
    expect(mac.syncWaits).toEqual([100]);
  });

  it("gives up on a start that never produces VoiceOver 10 seconds after the starter ran, then carries on", async () => {
    let exited = false;
    const mac = fakeMac({
      starterWorks: false,
      whileWaiting: (waits) => {
        if (waits === 2) exited = mac.exits();
      },
    });
    await macLiveTest(mac.deps);
    expect(exited).toBe(true);
    // 500 ms had passed: checks from then until 10 s, every 100 ms, then the pkill all the same.
    expect(mac.syncCalls).toEqual([...Array.from({ length: 96 }, () => PGREP), PKILL, PGREP]);
    expect(mac.syncWaits).toEqual(Array<number>(95).fill(100));
  });

  it("doesn't wait for a start that step 1 has seen come up", async () => {
    let exited = false;
    const mac = fakeMac({ startTakesMs: 500, whileAsking: () => (exited = mac.exits()) });
    await macLiveTest(mac.deps);
    expect(exited).toBe(true);
    expect(mac.syncCalls).toEqual([PKILL, PGREP]);
    expect(mac.syncWaits).toEqual([]);
  });

  it("gives up waiting after 5 seconds, then detaches and starts theirs again all the same", async () => {
    let exited = false;
    const mac = fakeMac({
      on: true,
      unstoppable: true,
      whileLoading: () => (exited = mac.exits()),
    });
    await macLiveTest(mac.deps);
    expect(exited).toBe(true);
    // A check at once, then one after each of 50 waits of 100 ms: 5 seconds.
    expect(mac.syncCalls).toEqual([
      PKILL,
      ...Array.from({ length: 51 }, () => PGREP),
      DETACH,
      RESTART,
    ]);
    expect(mac.syncWaits).toEqual(Array<number>(50).fill(100));
  });

  it("holds no hook while the person's own VoiceOver is untouched", async () => {
    let exited: boolean | null = null;
    const mac = fakeMac({ on: true, whileAsking: () => (exited = mac.exits()) });
    await macLiveTest(mac.deps);
    expect(exited).toBe(false);
    expect(mac.syncCalls).toEqual([]);
  });
});

describe("the Mac live test: the VoiceOver lock", () => {
  it("fails with the lock's own message when another voicecap holds it, touching nothing else", async () => {
    const message =
      "Another voicecap (process 999, started 2026-09-28T08:00:00-05:00) is using VoiceOver on this computer, and only one can at a time. Wait for it to finish, or stop it first. If no other voicecap is running, delete its lock: /Users/cschweda/Library/Caches/voicecap/voiceover.lock";
    const mac = fakeMac({ lockError: new EnvironmentError(message) });
    expect(await macLiveTest(mac.deps)).toEqual([
      {
        id: "liveLock",
        status: "FAIL",
        summary: "Another voicecap is using VoiceOver",
        problem: {
          title: "Another voicecap",
          whatsWrong: message,
          fix: ["Run npx @icjia/voicecap doctor again."],
          setupHelps: false,
        },
      },
    ]);
    expect(mac.events).toEqual(["pgrep VoiceOver", "take the lock"]);
  });

  it("says what's wrong even when the lock's refusal says nothing", async () => {
    const mac = fakeMac({ lockError: new EnvironmentError("") });
    expect((await macLiveTest(mac.deps))[0]?.problem?.whatsWrong).toBe(
      "Another voicecap is using VoiceOver on this computer.",
    );
  });
});

describe("the Mac live test: an unexpected error", () => {
  it("fails the live test with the error's message, after the checks so far, and still cleans up", async () => {
    const mac = fakeMac();
    const deps: MacLiveDeps = {
      ...mac.deps,
      launchBrowser: () => {
        mac.events.push("launch the browser");
        return Promise.reject(new EnvironmentError("Chromium didn't start: it exited (1)"));
      },
    };
    expect(await macLiveTest(deps)).toEqual([
      ...OK_CHECKS.slice(0, 2),
      {
        id: "liveTest",
        status: "FAIL",
        summary: "The live test failed",
        problem: {
          title: "The live test",
          whatsWrong: "Chromium didn't start: it exited (1)",
          fix: ["Run npx @icjia/voicecap doctor again."],
          setupHelps: false,
        },
      },
    ]);
    expect(from(mac.events, "launch the browser")).toEqual([
      "launch the browser",
      "Guidepup stops VoiceOver",
      "close the check page",
      "pgrep VoiceOver",
      "remove the exit hook",
      "release the lock",
    ]);
  });

  it("says what's wrong even for an error with no message", async () => {
    const mac = fakeMac();
    const deps: MacLiveDeps = {
      ...mac.deps,
      launchBrowser: () => Promise.reject(new Error("")),
    };
    expect((await macLiveTest(deps)).at(-1)?.problem?.whatsWrong).toBe(
      "The live test stopped on an error that didn't say what went wrong.",
    );
  });

  it("fails the live test, raising nothing, when the browser's process isn't known", async () => {
    const mac = fakeMac();
    const deps: MacLiveDeps = {
      ...mac.deps,
      launchBrowser: async (signal) => ({
        ...(await mac.deps.launchBrowser(signal)),
        pid: undefined,
      }),
    };
    expect((await macLiveTest(deps)).at(-1)).toEqual({
      id: "liveTest",
      status: "FAIL",
      summary: "The live test failed",
      problem: {
        title: "The live test",
        whatsWrong: "voicecap couldn't find the browser's process.",
        fix: ["Run npx @icjia/voicecap doctor again."],
        setupHelps: false,
      },
    });
    expect(mac.events).not.toContain("raise the browser");
    expect(mac.events).toContain("close the browser");
  });
});

describe("VoiceOver through Guidepup", () => {
  /** A stand-in for Guidepup's voiceOver object, with the parts the live test uses. */
  function fakeGuidepupVoiceOver(onStart: () => void = () => {}) {
    const calls: unknown[][] = [];
    const describeItemWithKeyboardFocus = { representation: "VO-F4" };
    const voiceOver = {
      keyboardCommands: {
        describeItem: { representation: "VO-F3" },
        describeItemWithKeyboardFocus,
      },
      start: (options: unknown) => {
        calls.push(["start", options]);
        onStart();
        return Promise.resolve();
      },
      stop: () => {
        calls.push(["stop"]);
        return Promise.resolve();
      },
      perform: (command: unknown, options: unknown) => {
        calls.push(["perform", command, options]);
        return Promise.resolve();
      },
      lastSpokenPhrase: () => Promise.resolve(PHRASE),
    };
    return {
      voiceOver: voiceOver as unknown as Parameters<typeof guidepupVoiceOver>[0],
      calls,
      describeItemWithKeyboardFocus,
    };
  }

  // Guidepup's start adds Ctrl+C handlers that stop VoiceOver on their own; voicecap stops it
  // itself, after Ctrl+C, in the live test's clean-up.
  it("starts VoiceOver with the settings given, without the signal handlers Guidepup adds", async () => {
    const guidepups = () => {};
    const guidepup = fakeGuidepupVoiceOver(() => process.on("SIGINT", guidepups));
    try {
      await guidepupVoiceOver(guidepup.voiceOver).start(VOICECAP_VOICEOVER_SETTINGS);
      expect(guidepup.calls).toEqual([
        ["start", { settings: { SCRShouldOutputVOInstructions: false } }],
      ]);
      expect(process.listeners("SIGINT")).not.toContain(guidepups);
    } finally {
      process.off("SIGINT", guidepups);
    }
  });

  it("hears the focused item with VO-F4, capturing the first of what VoiceOver says", async () => {
    const guidepup = fakeGuidepupVoiceOver();
    expect(await guidepupVoiceOver(guidepup.voiceOver).describeFocus()).toBe(PHRASE);
    expect(guidepup.calls).toEqual([
      ["perform", guidepup.describeItemWithKeyboardFocus, { capture: "initial" }],
    ]);
  });
});
