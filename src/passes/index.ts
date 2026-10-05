import type { FocusedElement, ScreenReaderDriver } from "../drivers/types.js";
import type { DriverCommand, FailureCause, PassName, StepRecord, StopReason } from "../model.js";
import { causeOf } from "../run/failure.js";
import { errorMessage, programOf } from "../util/errors.js";
import { headingsPass } from "./headings.js";
import { readPass } from "./read.js";
import { InterruptedError, StepRecorder, StepTimeoutError } from "./steps.js";
import { tabPass } from "./tab.js";

export interface PassSettings {
  cap: number;
  repeatLimit: number;
  endConfirmations: number;
  noNextHeading: RegExp;
  stepTimeoutMs: number;
}

/** What a failed pass, or the opening of a page for one, says about why it failed. */
export interface PassFailure {
  cause: FailureCause;
  message: string;
  /** The 1-based step that failed (see StepRecorder.current), or null when none was under way. */
  step: number | null;
  /** The driver command that step sent, or null. */
  command: DriverCommand | null;
  /**
   * For "foreground" only, from a driver that looked: the program that took the foreground, or
   * null when Windows didn't say. Absent for the rest, and when the driver didn't look.
   */
  program?: string | null;
  /**
   * For "unexpected" only, which may be a fault in voicecap: the error's stack, as it was raised.
   * The page's record keeps it with the home folder replaced.
   */
  stack?: string;
}

export interface PassResult {
  pass: PassName;
  steps: StepRecord[];
  stopReason: StopReason;
  durationMs: number;
  warnings: string[];
  errors: string[];
  /** Set when the pass stopped with "timeout" or "error": what went wrong, and in which step. */
  failure?: PassFailure;
  initialFocus?: FocusedElement | null;
}

/**
 * Run one pass on the page the driver has open. Timeouts and driver errors end the pass with
 * stop reason "timeout" or "error" and keep the steps recorded so far, and the failure says why;
 * an interruption (Ctrl+C) propagates so the page stays pending.
 */
export async function runPass(
  pass: PassName,
  driver: ScreenReaderDriver,
  settings: PassSettings,
  signal?: AbortSignal,
  clock?: () => number,
): Promise<PassResult> {
  const recorder = new StepRecorder(settings.stepTimeoutMs, signal, clock);
  const warnings: string[] = [];
  const errors: string[] = [];
  let stopReason: StopReason;
  let failure: PassFailure | undefined;
  let initialFocus: FocusedElement | null | undefined;
  try {
    if (pass === "read") {
      stopReason = await readPass(driver, recorder, settings);
    } else if (pass === "headings") {
      stopReason = await headingsPass(driver, recorder, settings);
    } else {
      const outcome = await tabPass(driver, recorder, settings);
      stopReason = outcome.stopReason;
      initialFocus = outcome.initialFocus;
      warnings.push(...outcome.warnings);
    }
  } catch (error) {
    if (error instanceof InterruptedError) throw error;
    stopReason = error instanceof StepTimeoutError ? "timeout" : "error";
    errors.push(errorMessage(error));
    failure = failureOf(error, recorder.current);
  }
  return {
    pass,
    steps: recorder.steps,
    stopReason,
    durationMs: recorder.elapsedMs(),
    warnings,
    errors,
    ...(failure ? { failure } : {}),
    ...(pass === "tab" ? { initialFocus: initialFocus ?? null } : {}),
  };
}

/**
 * What an error that stopped a pass (or the opening of a page for one) amounts to: its cause and
 * message, the step that was under way when it was raised (`step`, from StepRecorder.current; none
 * for an error outside a step), the program that took the foreground when that's what the error
 * says (programOf), and, for an unexpected error only, its stack.
 */
export function failureOf(error: unknown, step: StepRecorder["current"] = null): PassFailure {
  const cause = causeOf(error);
  const program = programOf(error);
  return {
    cause,
    message: errorMessage(error),
    step: step?.n ?? null,
    command: step?.command ?? null,
    ...(program !== undefined ? { program } : {}),
    ...(cause === "unexpected" && error instanceof Error && error.stack
      ? { stack: error.stack }
      : {}),
  };
}

export { InterruptedError, StepTimeoutError, withTimeout } from "./steps.js";
