import type { FocusedElement, ScreenReaderDriver } from "../drivers/types.js";
import type { PassName, StepRecord, StopReason } from "../model.js";
import { errorMessage } from "../util/errors.js";
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

export interface PassResult {
  pass: PassName;
  steps: StepRecord[];
  stopReason: StopReason;
  durationMs: number;
  warnings: string[];
  errors: string[];
  initialFocus?: FocusedElement | null;
}

/**
 * Run one pass on the page the driver has open. Timeouts and driver errors end the pass with
 * stop reason "timeout" or "error" and keep the steps recorded so far; an interruption
 * (Ctrl+C) propagates so the page stays pending.
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
  }
  return {
    pass,
    steps: recorder.steps,
    stopReason,
    durationMs: recorder.elapsedMs(),
    warnings,
    errors,
    ...(pass === "tab" ? { initialFocus: initialFocus ?? null } : {}),
  };
}

export { InterruptedError, StepTimeoutError, withTimeout } from "./steps.js";
