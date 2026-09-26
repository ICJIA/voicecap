import type { ScreenReaderDriver } from "../drivers/types.js";
import type { StopReason } from "../model.js";
import { normalizeSpeech, sameSpeech, type StepRecorder } from "./steps.js";

export interface ReadPassOptions {
  cap: number;
  repeatLimit: number;
  /** Extra Down Arrows that must repeat the line before the end counts as reached. */
  endConfirmations: number;
}

/**
 * Read the page line by line in browse mode.
 *
 * NVDA has no end-of-document announcement: on the last line, Down Arrow re-speaks that line.
 * So first record the last line (Ctrl+End), return to the top (Ctrl+Home), and read until that
 * line is spoken and the next step repeats it; then confirm with `endConfirmations` more steps,
 * so a mid-page pair of identical lines that happens to equal the last line can't end the pass.
 * Two identical lines mid-page (back-to-back "Read more" links) never stop it on their own.
 */
export async function readPass(
  driver: ScreenReaderDriver,
  recorder: StepRecorder,
  options: ReadPassOptions,
): Promise<StopReason> {
  const last = (await recorder.step("toBottom", () => driver.toBottom())).spoken;
  let prev = (await recorder.step("toTop", () => driver.toTop())).spoken;
  let run = 1;

  for (;;) {
    if (recorder.count >= options.cap) return "step-cap";
    const current = (await recorder.step("nextLine", () => driver.nextLine())).spoken;
    run = sameSpeech(current, prev) ? run + 1 : 1;

    if (run >= 2 && lineMatches(last, current)) {
      let confirmed = true;
      for (let i = 0; i < options.endConfirmations; i++) {
        if (recorder.count >= options.cap) return "step-cap";
        const next = (await recorder.step("nextLine", () => driver.nextLine())).spoken;
        if (!sameSpeech(next, current)) {
          confirmed = false;
          prev = next;
          run = 1;
          break;
        }
        run++;
      }
      if (confirmed) return "end-reached";
      continue;
    }

    if (run >= options.repeatLimit) return "repeat-limit";
    prev = current;
  }
}

/**
 * Whether `line` is the page's last line, as spoken by Ctrl+End (`last`).
 *
 * Moving to a line, NVDA first announces the containers it enters (e.g. "content info landmark");
 * re-speaking the line it's already on, it doesn't. So Ctrl+End from the top can say
 * "content info landmark, © 2026 ICJIA" while the end-of-page repeat says "© 2026 ICJIA": accept
 * a match on the whole speech or on its trailing items (", " joins items, ". " utterances).
 */
export function lineMatches(last: string, line: string): boolean {
  const target = normalizeSpeech(last);
  const candidate = normalizeSpeech(line);
  if (target === candidate) return true;
  if (candidate === "") return false;
  return target.endsWith(`, ${candidate}`) || target.endsWith(`. ${candidate}`);
}
