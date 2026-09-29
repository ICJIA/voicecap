/**
 * setup's part of readiness, on any platform: the guided loop, which walks someone through each
 * failing permission (explain, open the right place, wait for Enter or s, check again), and
 * setup's end: the preflight's result and the offer of the live test. Platform-neutral: it works
 * from any PlatformReadiness, with no driver imports of its own.
 */
import type { Check, PlatformReadiness, PreflightResult, Problem } from "./model.js";
import { runCheck, runPreflight } from "./preflight.js";
import { renderChecks, renderPreflight, renderProblems } from "./render.js";
import type { Prompter } from "../init/prompt.js";
import { InterruptedError } from "../passes/steps.js";
import { stopOnClosedWindow, type SignalSource } from "../run/signals.js";
import { ExitCode } from "../util/errors.js";
import type { Logger } from "../util/log.js";

export interface GuideDeps {
  /** Asks at each step; null when no one can answer (stdin isn't a terminal): no walk, then. */
  prompter: Prompter | null;
  say(text: string): void;
  /** Opens a problem's System Settings page, or its app; false when it couldn't. */
  open(target: NonNullable<Problem["open"]>): Promise<boolean>;
  /** The terminal app's name: macOS gives the permissions to it. */
  app: string;
  /**
   * Called just before each preflight guideThrough runs: the first, and the one after the walk.
   * Mac setup says the platform's checking notice there, since checking can raise macOS's System
   * Events prompt.
   */
  beforeCheck?(): void;
}

/** A FAIL check with its problem: one step of the walk-through. */
type Step = Check & { problem: Problem };

/** What to do once the terminal app has quit and reopened, for a step that needs it. */
function restartLine(app: string): string {
  return `When ${app} reopens, run npx @icjia/voicecap setup again to finish.`;
}

/**
 * The check whose step is the check itself: checking System Events again sends the query, which
 * raises macOS's "control System Events" prompt while it's unanswered, then waits 60 seconds.
 */
const SYSTEM_EVENTS = "systemEvents";

/**
 * The steps: FAIL checks setup helps with that have a page or app to open, and System Events.
 * Ones that pass only after the terminal app reopens (Full Disk Access) come last.
 */
function pickSteps(checks: Check[]): Step[] {
  const steps = checks.filter(
    (check): check is Step =>
      check.status === "FAIL" &&
      check.problem !== undefined &&
      ((check.problem.setupHelps && check.problem.open !== undefined) ||
        check.id === SYSTEM_EVENTS),
  );
  return [
    ...steps.filter((step) => !step.problem.needsRestart),
    ...steps.filter((step) => step.problem.needsRestart),
  ];
}

/**
 * A problem's fix steps, less a first "Open …" when the step has opened that place itself, and a
 * last "Run … again".
 */
function stepsToSay(fix: string[], opened: boolean): string[] {
  let lines = fix;
  if (opened && lines[0]?.startsWith("Open ")) lines = lines.slice(1);
  const last = lines[lines.length - 1];
  if (last !== undefined && /^Run .+ again\.$/.test(last)) lines = lines.slice(0, -1);
  return lines;
}

/** Says what step `number` of `count` is for and what to do there, opening its page or app. */
async function introduce(step: Step, number: number, count: number, deps: GuideDeps) {
  const { problem } = step;
  deps.say("");
  deps.say(`Step ${number} of ${count}: ${problem.title}`);
  deps.say(`  ${problem.whatsWrong}`);
  const target = problem.open;
  if (target) {
    const name = target.kind === "settings" ? "System Settings" : target.name;
    deps.say(
      target.kind === "settings"
        ? `  Opening System Settings at Privacy & Security, ${target.page}…`
        : `  Opening ${name}…`,
    );
    const opened = await deps.open(target);
    // Every problem's own first step says where to go, so it's said when that has to be by hand.
    if (!opened) deps.say(`  Couldn't open ${name}.`);
    for (const line of stepsToSay(problem.fix, opened)) deps.say(`  ${line}`);
  } else {
    // System Events, unanswered: checking again raises macOS's prompt.
    deps.say(`  macOS will ask whether ${deps.app} can control System Events: click Allow.`);
  }
  // Said now, before the question: quitting the app, as the step says to, ends setup before Enter.
  if (problem.needsRestart) deps.say(restartLine(deps.app));
}

/**
 * Runs the preflight, then walks through each failing permission, one step at a time: it says
 * what's wrong, opens the right place, and waits for Enter (check again) or s (skip). A check that
 * still fails is said and asked about again, except one that passes only after the terminal app
 * reopens: that ends the walk, returned as restartNeeded. After the last step, the preflight runs
 * again and its result is returned. deps.beforeCheck, when given, is called just before each
 * preflight.
 *
 * Without a prompter, or with nothing to walk through, it says nothing and returns the preflight's
 * result as it is: setup's preflight, printed next, lists what's left.
 */
export async function guideThrough(
  platform: PlatformReadiness,
  deps: GuideDeps,
): Promise<{ result: PreflightResult; restartNeeded: Problem | null }> {
  deps.beforeCheck?.();
  const first = await runPreflight(platform);
  const { prompter } = deps;
  const steps = pickSteps(first.checks);
  if (!prompter || steps.length === 0) return { result: first, restartNeeded: null };

  const runners = platform.quickChecks();
  // What's known so far, for a walk that ends before the preflight runs again.
  let checks = first.checks;
  for (const [index, step] of steps.entries()) {
    const runner = runners.find((candidate) => candidate.id === step.id);
    if (!runner) throw new Error(`No quick check has the id "${step.id}".`);
    await introduce(step, index + 1, steps.length, deps);
    for (;;) {
      const answer = await prompter.ask("Press Enter when it's on, or type s to skip");
      if (answer.toLowerCase() === "s") break;
      const check = await runCheck(runner);
      checks = checks.map((known) => (known.id === check.id ? check : known));
      if (check.status !== "FAIL") {
        deps.say(`  OK: ${check.summary}`);
        break;
      }
      if (check.problem?.needsRestart) {
        deps.say(restartLine(deps.app));
        return { result: { info: first.info, checks, ready: false }, restartNeeded: check.problem };
      }
      deps.say(`  Not yet: ${check.summary}`);
    }
  }
  deps.beforeCheck?.();
  return { result: await runPreflight(platform), restartNeeded: null };
}

/**
 * setup's end, on every platform: logs the preflight's result, then offers the live test when the
 * computer is ready and someone can answer. Returns setup's exit code: 0 when ready (and the live
 * test passed or was declined), 2 when not ready or the live test failed, 130 on Ctrl+C during it.
 */
export async function finishSetup(
  platform: PlatformReadiness,
  result: PreflightResult,
  options: { logger: Logger; prompter: Prompter | null; now?: () => Date },
): Promise<number> {
  const { logger, prompter } = options;
  logger.info(
    renderPreflight(result, {
      kind: "preflight",
      when: (options.now ?? (() => new Date()))(),
      screenReader: platform.screenReader,
      tip: platform.readyTip,
      offerSetup: false,
    }),
  );
  if (!result.ready) return ExitCode.environment;
  return prompter ? offerLiveTest(platform, { prompter, logger }) : ExitCode.ok;
}

/**
 * Logs the live test's notice and asks whether to run it (No unless answered). A yes runs it and
 * logs its checks, and its problems when one FAILs. Returns 0 when it passed or was declined (or
 * the platform has none), 2 when it failed, and 130 when it was stopped: by Ctrl+C, through the
 * prompter's `interrupted` signal, or by a closed window's SIGHUP or a SIGTERM (stopOnClosedWindow,
 * listening to `signals`, the process's own unless given).
 */
export async function offerLiveTest(
  platform: PlatformReadiness,
  options: { prompter: Prompter; logger: Logger; signals?: SignalSource },
): Promise<number> {
  const { prompter, logger } = options;
  const { liveTest } = platform;
  if (!liveTest) return ExitCode.ok;
  logger.info("");
  for (const line of platform.liveTestNotice) logger.info(line);
  const screenReader = platform.screenReader ?? "the screen reader";
  if (!(await prompter.confirm(`Test ${screenReader} now?`, false))) return ExitCode.ok;

  const closed = new AbortController();
  const unlisten = stopOnClosedWindow(closed, options.signals);
  let checks: Check[];
  try {
    checks = await liveTest(AbortSignal.any([prompter.interrupted, closed.signal]));
  } catch (error) {
    if (!(error instanceof InterruptedError)) throw error;
    logger.warn("Interrupted: the screen reader and the browser were shut down.");
    return ExitCode.interrupted;
  } finally {
    unlisten();
  }
  logger.info("");
  logger.info(renderChecks(checks));
  if (checks.every((check) => check.status !== "FAIL")) return ExitCode.ok;
  logger.info("");
  logger.info(renderProblems(checks, { offerSetup: false }));
  return ExitCode.environment;
}
