import type { ScreenReaderDriver } from "../drivers/types.js";
import type { StopReason } from "../model.js";
import { normalizeSpeech, sameSpeech, type StepRecorder } from "./steps.js";

export interface HeadingsPassOptions {
  cap: number;
  repeatLimit: number;
  /** Matches NVDA's announcement after the last heading ("no next heading"). */
  noNextHeading: RegExp;
}

/** From the top of the page, move heading to heading until NVDA says there is no next heading. */
export async function headingsPass(
  driver: ScreenReaderDriver,
  recorder: StepRecorder,
  options: HeadingsPassOptions,
): Promise<StopReason> {
  let prev: string | null = null;
  let run = 0;
  for (;;) {
    if (recorder.count >= options.cap) return "step-cap";
    const current = (await recorder.step("nextHeading", () => driver.nextHeading())).spoken;
    if (options.noNextHeading.test(normalizeSpeech(current))) return "no-next-heading";
    run = prev !== null && sameSpeech(current, prev) ? run + 1 : 1;
    if (run >= options.repeatLimit) return "repeat-limit";
    prev = current;
  }
}
