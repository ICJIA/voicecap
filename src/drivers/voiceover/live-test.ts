/**
 * The Mac live test, until the VoiceOver driver exists. VoiceOver starts through Guidepup with
 * voicecap's settings, the browser comes to the front with the check page, and VoiceOver is heard
 * describing it. Then everything is put back as it was, however the test ends (a FAIL, an error,
 * or Ctrl+C): Guidepup's VoiceOver stopped, the browser and the check page closed, and the
 * person's VoiceOver on again with their own settings, or off, as they had it. A WARN says what
 * couldn't be put back. If the process exits before that clean-up can finish (a second Ctrl+C, or
 * a closed window), an exit hook does its work with synchronous commands (exitHook).
 *
 * The order is the point. Before Guidepup starts VoiceOver, step 1 asks VoiceOver a harmless
 * question with a 60-second wait, so a first-time "<app> wants access to control VoiceOver" prompt
 * comes from a request that stays alive until it's answered. Guidepup's own AppleScript calls give
 * up after 10 seconds, which in the spike left a prompt that no click could answer.
 */
import type * as GuidepupModule from "@guidepup/guidepup";

import { InterruptedError } from "../../passes/steps.js";
import type { Check } from "../../readiness/model.js";
import { EnvironmentError, errorMessage } from "../../util/errors.js";
import { GUIDEPUP_EVENTS, withoutAddedListeners } from "../guidepup/nvda.js";
import {
  askVoiceOver,
  automationDeniedProblem,
  detachGuidepupPreferences,
  GUIDEPUP_PREFERENCES_VOLUME,
  messageOr,
  permissionPromptProblem,
  raiseProcess,
  startVoiceOver,
  stopVoiceOver,
  stopVoiceOverSync,
  VOICEOVER_STARTER,
  voiceOverRunning,
  waitForVoiceOver,
  waitUntilVoiceOverRunsSync,
  type RunCommand,
  type RunCommandSync,
  type Sleep,
  type SleepSync,
} from "./macos.js";

/** The settings Guidepup starts VoiceOver with for voicecap: no usage hints after each item. */
export const VOICECAP_VOICEOVER_SETTINGS: Record<string, unknown> = {
  SCRShouldOutputVOInstructions: false,
};

/** How long VoiceOver gets to be running after its starter runs. */
const VOICEOVER_START_WAIT_MS = 10_000;
/** How long the check page gets to load. */
const PAGE_LOAD_TIMEOUT_MS = 30_000;

/** VoiceOver, driven through Guidepup. */
export interface VoiceOverControl {
  /** Quits any running VoiceOver, then starts it with these settings in place of the person's. */
  start(settings: Record<string, unknown>): Promise<void>;
  /** Quits VoiceOver and takes voicecap's settings away again. */
  stop(): Promise<void>;
  /** What VoiceOver says for VO-F4, which describes the item with the keyboard focus. */
  describeFocus(): Promise<string>;
}

/** The browser the test brings to the front: a ChromeSession, or a test's stand-in. */
export interface LiveBrowser {
  pid: number | undefined;
  load(url: string, timeoutMs: number): Promise<unknown>;
  close(): Promise<void>;
}

/** Everything the live test does to the computer, so tests can fake it. */
export interface MacLiveDeps {
  run: RunCommand;
  /** The terminal app's name: macOS asks whether it may control VoiceOver. */
  app: string;
  /** The command to rerun after fixing a problem, e.g. "npx @icjia/voicecap doctor". */
  again: string;
  loadVoiceOver: () => Promise<VoiceOverControl>;
  /** Starts the browser; aborting the signal kills one that's still starting. */
  launchBrowser: (signal: AbortSignal) => Promise<LiveBrowser>;
  serveCheckPage: () => Promise<{ url: string; close(): Promise<void> }>;
  /**
   * Takes the VoiceOver lock and gives back its release. Throws EnvironmentError while another
   * voicecap holds it.
   */
  lock: () => Promise<() => Promise<void>>;
  /** A wait, which Ctrl+C ends early when it's given the signal (pause). */
  sleep: Sleep;
  /**
   * Says one of the clean-up's warnings at once. Used only when Ctrl+C ends the test: the
   * InterruptedError it throws carries no checks.
   */
  warn?: (message: string) => void;
  /**
   * Adds a hook the process runs as it exits, giving back its removal: process.on("exit"). The
   * test holds one while VoiceOver is in voicecap's hands (see exitHook).
   */
  onExit: (hook: () => void) => () => void;
  /** Runs a command from that hook, synchronously (runCommandSync). */
  runSync: RunCommandSync;
  /** A wait from that hook, which blocks (pauseSync). */
  sleepSync: SleepSync;
  /** A clock in ms (performance.now): the hook's wait for a VoiceOver still starting ends on it. */
  now: () => number;
}

/** What the steps have opened, for the clean-up to close. */
interface Opened {
  /**
   * Step 1's start of VoiceOver: when its starter ran (on deps.now's clock), and whether VoiceOver
   * has been seen running since. Null when step 1 didn't start it.
   */
  started: { at: number; seen: boolean } | null;
  /**
   * Guidepup's start has begun: its VoiceOver may be running, and its disk image with voicecap's
   * settings attached, even when the start then fails.
   */
  guidepupBegan: boolean;
  /** Guidepup's VoiceOver, once step 2 has started it. */
  voiceOver: VoiceOverControl | null;
  browser: LiveBrowser | null;
  page: { url: string; close(): Promise<void> } | null;
}

/** The exit hook while VoiceOver is in voicecap's hands. */
interface ExitHook {
  /** Adds the hook, unless it's there already. */
  hold(): void;
  /** Removes it, once the clean-up has finished. */
  release(): void;
}

/**
 * VoiceOver is in voicecap's hands from the moment step 1 starts it, or Guidepup's start begins,
 * until the clean-up has finished. If the process exits meanwhile without reaching the clean-up (a
 * second Ctrl+C, or a closed window), the hook does the clean-up's work, with synchronous commands
 * and waits only:
 * - When step 1's start hasn't been seen to bring VoiceOver up, it waits for VoiceOver, until 10
 *   seconds after the starter ran, as step 1 would have: a VoiceOver that came up after the hook's
 *   pkill would stay on.
 * - It quits VoiceOver and waits up to 5 seconds for it to be gone (stopVoiceOverSync), when it
 *   should end up off or Guidepup's may be running. A VoiceOver still quitting could keep
 *   Guidepup's settings image busy, or be running still when the person's is started.
 * - Once Guidepup's start has begun, it detaches Guidepup's settings, as
 *   detachGuidepupPreferences does.
 * - When VoiceOver was on and Guidepup took over, it starts the person's own VoiceOver again,
 *   detached so that it outlives voicecap.
 * The last two are done even when VoiceOver hasn't gone in time: they may still work.
 */
function exitHook(deps: MacLiveDeps, wasOn: boolean, opened: Opened): ExitHook {
  const onExit = () => {
    const { started } = opened;
    if (started && !started.seen) {
      const until = started.at + VOICEOVER_START_WAIT_MS;
      waitUntilVoiceOverRunsSync(deps.runSync, until, deps.now, deps.sleepSync);
    }
    if (!wasOn || opened.guidepupBegan) stopVoiceOverSync(deps.runSync, deps.sleepSync);
    if (opened.guidepupBegan) deps.runSync("hdiutil", ["detach", GUIDEPUP_PREFERENCES_VOLUME]);
    if (wasOn && opened.guidepupBegan) deps.runSync(VOICEOVER_STARTER, [], { detached: true });
  };
  let remove: (() => void) | null = null;
  return {
    hold: () => {
      remove ??= deps.onExit(onExit);
    },
    release: () => {
      remove?.();
      remove = null;
    },
  };
}

/**
 * Runs the four steps in order, stopping at the first FAIL, and cleans up however it ends. The
 * clean-up's WARNs follow the steps' checks. An aborted signal (Ctrl+C) kills the command or wait
 * the steps are in (all but step 1's start of VoiceOver, which runs until VoiceOver is up), and
 * stops the test at the next step boundary; it then cleans up the same way, says the clean-up's
 * WARNs through deps.warn, and throws InterruptedError. The clean-up never gets the signal: it
 * must finish. Any other error fails the step it came from.
 */
export async function macLiveTest(deps: MacLiveDeps, signal?: AbortSignal): Promise<Check[]> {
  if (signal?.aborted) throw new InterruptedError();
  // Step 0: note whether the person's VoiceOver is on, then take the lock. Until the lock is held,
  // a running VoiceOver may be another voicecap's, so nothing is changed or cleaned up.
  const wasOn = await voiceOverRunning(deps.run);
  let release: () => Promise<void>;
  try {
    release = await deps.lock();
  } catch (error) {
    return [
      error instanceof EnvironmentError
        ? lockFailure(error.message, deps.again)
        : liveFailure(error, deps.again),
    ];
  }
  const opened: Opened = {
    started: null,
    guidepupBegan: false,
    voiceOver: null,
    browser: null,
    page: null,
  };
  const hook = exitHook(deps, wasOn, opened);
  const checks: Check[] = [];
  let interruption: InterruptedError | null = null;
  let warnings: Check[];
  try {
    await runSteps(deps, wasOn, opened, hook, checks, signal);
  } catch (error) {
    if (!(error instanceof InterruptedError)) throw error;
    interruption = error;
  } finally {
    try {
      warnings = await cleanUp(deps, wasOn, opened);
    } finally {
      hook.release();
      await release();
    }
  }
  if (interruption || signal?.aborted) {
    // The InterruptedError carries no checks, so the clean-up's WARNs are said now, or never.
    for (const warning of warnings) deps.warn?.(warning.summary);
    throw interruption ?? new InterruptedError();
  }
  return [...checks, ...warnings];
}

/** Steps 1 to 4, each adding its check, until one fails or Ctrl+C has been pressed. */
async function runSteps(
  deps: MacLiveDeps,
  wasOn: boolean,
  opened: Opened,
  hook: ExitHook,
  checks: Check[],
  signal: AbortSignal | undefined,
): Promise<void> {
  const steps = [
    () => controlStep(deps, wasOn, opened, hook, signal),
    () => startStep(deps, opened, hook),
    () => frontStep(deps, opened, signal),
    () => hearStep(deps, opened),
  ];
  for (const step of steps) {
    if (signal?.aborted) return;
    let check: Check;
    try {
      check = await step();
    } catch (error) {
      if (error instanceof InterruptedError) throw error;
      check = liveFailure(error, deps.again);
    }
    checks.push(check);
    if (check.status === "FAIL") return;
  }
}

/**
 * Step 1: makes sure VoiceOver is running (starting it with its own starter when it's off), then
 * asks it a harmless question, waiting up to 60 seconds for the answer. Ctrl+C ends the question's
 * wait at once, but not the start's.
 */
async function controlStep(
  deps: MacLiveDeps,
  wasOn: boolean,
  opened: Opened,
  hook: ExitHook,
  signal: AbortSignal | undefined,
): Promise<Check> {
  const { run, app, again } = deps;
  if (!wasOn) {
    hook.hold();
    const started = { at: deps.now(), seen: false };
    opened.started = started;
    // The start takes no Ctrl+C: VoiceOver's process appears a moment after its starter returns,
    // and the clean-up looks once to see whether there's a VoiceOver to quit. Cut short, the start
    // could bring VoiceOver up after that look, and leave it on. Once it's up, the question below
    // sees Ctrl+C at once, and the steps stop there.
    await startVoiceOver(run);
    started.seen = await waitForVoiceOver(run, "running", VOICEOVER_START_WAIT_MS, deps.sleep);
    if (!started.seen) {
      return {
        id: "liveControl",
        status: "FAIL",
        summary: "VoiceOver didn't start",
        problem: {
          title: "Starting VoiceOver",
          whatsWrong: "VoiceOver didn't start within 10 seconds.",
          fix: ["Run npx @icjia/voicecap setup.", `Run ${again} again.`],
          setupHelps: true,
        },
      };
    }
  }
  const answer = await askVoiceOver(run, signal);
  if (answer.ok) {
    return { id: "liveControl", status: "OK", summary: `${app} can control VoiceOver` };
  }
  if (answer.reason === "denied") {
    return {
      id: "liveControl",
      status: "FAIL",
      summary: `${app} isn't allowed to control VoiceOver`,
      problem: automationDeniedProblem(app, "VoiceOver", again),
    };
  }
  if (answer.reason === "no-answer") {
    return {
      id: "liveControl",
      status: "FAIL",
      summary: "No answer from VoiceOver in 60 seconds",
      problem: permissionPromptProblem(app, "VoiceOver", again),
    };
  }
  return {
    id: "liveControl",
    status: "FAIL",
    summary:
      answer.message === ""
        ? "VoiceOver didn't answer"
        : `VoiceOver didn't answer: ${answer.message}`,
    problem: {
      title: "VoiceOver",
      whatsWrong: messageOr(
        answer.message,
        "VoiceOver didn't answer voicecap's question, and macOS gave no reason.",
      ),
      fix: [`Run ${again} again.`],
      setupHelps: false,
    },
  };
}

/** Step 2: Guidepup quits VoiceOver and starts it again with voicecap's settings. */
async function startStep(deps: MacLiveDeps, opened: Opened, hook: ExitHook): Promise<Check> {
  try {
    const voiceOver = await deps.loadVoiceOver();
    opened.guidepupBegan = true;
    hook.hold();
    await voiceOver.start(VOICECAP_VOICEOVER_SETTINGS);
    opened.voiceOver = voiceOver;
  } catch (error) {
    // Guidepup stops what it started when its start fails, so there's no Guidepup to stop.
    return {
      id: "liveStart",
      status: "FAIL",
      summary: "VoiceOver didn't start",
      problem: {
        title: "Starting VoiceOver",
        whatsWrong: `Guidepup couldn't start VoiceOver: ${describeError(error)}`,
        fix: ["Run npx @icjia/voicecap setup.", `Run ${deps.again} again.`],
        setupHelps: true,
      },
    };
  }
  return { id: "liveStart", status: "OK", summary: "VoiceOver started with voicecap's settings" };
}

/**
 * Step 3: opens the check page in the browser, then brings the browser's own process to the front
 * through System Events and confirms it's frontmost.
 */
async function frontStep(
  deps: MacLiveDeps,
  opened: Opened,
  signal: AbortSignal | undefined,
): Promise<Check> {
  const page = await deps.serveCheckPage();
  opened.page = page;
  const browser = await deps.launchBrowser(signal ?? new AbortController().signal);
  opened.browser = browser;
  await browser.load(page.url, PAGE_LOAD_TIMEOUT_MS);
  if (browser.pid === undefined) throw new Error("voicecap couldn't find the browser's process.");
  const raised = await raiseProcess(deps.run, browser.pid, deps.sleep, signal);
  if (raised.ok) return { id: "liveFront", status: "OK", summary: "The browser came to the front" };
  return {
    id: "liveFront",
    status: "FAIL",
    summary: "The browser didn't come to the front",
    problem: {
      title: "The browser's window",
      // Empty when System Events was killed at its timeout.
      whatsWrong: messageOr(
        raised.message,
        "System Events didn't answer when voicecap asked it to bring the browser to the front.",
      ),
      fix: ["Don't use the keyboard or mouse during the test.", `Run ${deps.again} again.`],
      setupHelps: false,
    },
  };
}

/** Step 4: what VoiceOver says for VO-F4 is the proof that it hears the page. */
async function hearStep(deps: MacLiveDeps, opened: Opened): Promise<Check> {
  // Step 2 passed, so Guidepup's VoiceOver is there.
  if (!opened.voiceOver) throw new Error("VoiceOver wasn't started.");
  const phrase = (await opened.voiceOver.describeFocus()).trim();
  if (phrase !== "") {
    return { id: "liveHear", status: "OK", summary: `VoiceOver hears the page ("${phrase}")` };
  }
  return {
    id: "liveHear",
    status: "FAIL",
    summary: "VoiceOver started, but voicecap heard nothing from it",
    problem: {
      title: "VoiceOver's speech",
      whatsWrong: "VoiceOver started, but voicecap captured no speech from it.",
      fix: [`Run ${deps.again} again.`, "If it happens again, run npx @icjia/voicecap setup."],
      setupHelps: true,
    },
  };
}

/**
 * Puts everything back: Guidepup's VoiceOver stopped (which takes voicecap's settings away), the
 * browser and the check page closed, and VoiceOver as the person had it. Gives a WARN for what it
 * couldn't put back.
 *
 * Guidepup's stop fails when VoiceOver survives its attempts to quit it, and then it never detaches
 * the disk image with voicecap's settings. voicecap quits VoiceOver and detaches the image itself,
 * but can't tell whether VoiceOver has the person's own settings again, so the liveStop WARN says
 * to restart the Mac if VoiceOver doesn't sound as usual.
 */
async function cleanUp(deps: MacLiveDeps, wasOn: boolean, opened: Opened): Promise<Check[]> {
  const warnings: Check[] = [];
  if (opened.voiceOver) {
    try {
      await opened.voiceOver.stop();
    } catch (error) {
      await stopVoiceOver(deps.run, deps.sleep);
      await detachGuidepupPreferences(deps.run);
      warnings.push({
        id: "liveStop",
        status: "WARN",
        summary: `VoiceOver didn't stop cleanly (${firstLine(error)}). If VoiceOver doesn't sound as usual, restart the Mac.`,
      });
    }
  }
  await opened.browser?.close().catch(() => {});
  await opened.page?.close().catch(() => {});
  return [...warnings, ...(await restoreVoiceOver(deps, wasOn))];
}

/**
 * VoiceOver as the person had it before the test, or a WARN that says how to get there.
 * - It was on: once it has stopped (Guidepup's start and stop both quit it), VoiceOverStarter
 *   starts it again with their own settings. While it's still running, it's left alone.
 * - It was off: a VoiceOver still running (step 1 started it, or Guidepup couldn't stop it) is
 *   quit.
 */
async function restoreVoiceOver(deps: MacLiveDeps, wasOn: boolean): Promise<Check[]> {
  const running = await voiceOverRunning(deps.run);
  if (wasOn && !running) {
    await startVoiceOver(deps.run);
    if (!(await waitForVoiceOver(deps.run, "running", VOICEOVER_START_WAIT_MS, deps.sleep))) {
      return [
        {
          id: "liveRestore",
          status: "WARN",
          summary: "Couldn't turn VoiceOver back on: press Command-F5",
        },
      ];
    }
  }
  if (!wasOn && running && !(await stopVoiceOver(deps.run, deps.sleep))) {
    return [
      {
        id: "liveRestore",
        status: "WARN",
        summary: "Couldn't turn VoiceOver off: press Command-F5",
      },
    ];
  }
  return [];
}

/** Another voicecap holds the VoiceOver lock; the lock's message says which, and how to free it. */
function lockFailure(message: string, again: string): Check {
  return {
    id: "liveLock",
    status: "FAIL",
    summary: "Another voicecap is using VoiceOver",
    problem: {
      title: "Another voicecap",
      whatsWrong: messageOr(message, "Another voicecap is using VoiceOver on this computer."),
      fix: [`Run ${again} again.`],
      setupHelps: false,
    },
  };
}

/** Any other error fails the live test, as it does on Windows. */
function liveFailure(error: unknown, again: string): Check {
  return {
    id: "liveTest",
    status: "FAIL",
    summary: "The live test failed",
    problem: {
      title: "The live test",
      whatsWrong: messageOr(
        describeError(error),
        "The live test stopped on an error that didn't say what went wrong.",
      ),
      fix: [`Run ${again} again.`],
      setupHelps: false,
    },
  };
}

/** The first line of an error's message. */
function firstLine(error: unknown): string {
  return errorMessage(error).split("\n")[0] ?? "";
}

/**
 * An error's message, plus the first line of its cause when that says more. Guidepup's errors
 * give their reason there: its start fails with "VoiceOver cannot be started" and the reason why.
 */
function describeError(error: unknown): string {
  const message = errorMessage(error);
  if (!(error instanceof Error) || error.cause === undefined) return message;
  const cause = firstLine(error.cause);
  return cause !== "" && !message.includes(cause) ? `${message} (${cause})` : message;
}

// ---- Guidepup ----

type GuidepupVoiceOver = (typeof GuidepupModule)["voiceOver"];

/** Loads Guidepup, only when the live test starts VoiceOver, and wraps its VoiceOver. */
export async function loadGuidepupVoiceOver(): Promise<VoiceOverControl> {
  const { voiceOver } = await import("@guidepup/guidepup");
  return guidepupVoiceOver(voiceOver);
}

/**
 * VoiceOverControl through Guidepup's voiceOver object. Guidepup's start adds handlers for Ctrl+C
 * and the like that stop VoiceOver on their own; they're removed at once, because voicecap stops
 * VoiceOver itself after Ctrl+C, in the live test's clean-up.
 */
export function guidepupVoiceOver(voiceOver: GuidepupVoiceOver): VoiceOverControl {
  return {
    start: (settings) =>
      withoutAddedListeners(GUIDEPUP_EVENTS, () => voiceOver.start({ settings })),
    stop: () => voiceOver.stop(),
    describeFocus: async () => {
      await voiceOver.perform(voiceOver.keyboardCommands.describeItemWithKeyboardFocus, {
        capture: "initial",
      });
      return voiceOver.lastSpokenPhrase();
    },
  };
}
