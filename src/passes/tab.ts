import type { FocusedElement, ScreenReaderDriver } from "../drivers/types.js";
import type { StopReason } from "../model.js";
import { normalizeSpeech, type StepRecorder } from "./steps.js";

export interface TabPassOptions {
  cap: number;
  repeatLimit: number;
}

export interface TabPassOutcome {
  stopReason: StopReason;
  /** What was focused before the first Tab; it should be nothing. */
  initialFocus: FocusedElement | null;
  warnings: string[];
}

/**
 * Press Tab from a freshly loaded page and record each focus stop. Stops when focus leaves the
 * page document (Tab eventually reaches browser UI), detected by the browser, not from speech.
 */
export async function tabPass(
  driver: ScreenReaderDriver,
  recorder: StepRecorder,
  options: TabPassOptions,
): Promise<TabPassOutcome> {
  const warnings: string[] = [];
  const initialFocus = await recorder.query("focus check", () => driver.focusedElement());
  if (initialFocus) {
    warnings.push(
      `Something was focused before the first Tab (${describeElement(initialFocus)}); the page may move focus on load, so the first Tab may not start at the top.`,
    );
  }

  let prev: string | null = null;
  let run = 0;
  for (;;) {
    if (recorder.count >= options.cap) return { stopReason: "step-cap", initialFocus, warnings };
    const step = await recorder.step(
      "nextFocusable",
      () => driver.nextFocusable(),
      async () => {
        const inDocument = await driver.focusInDocument();
        return { inDocument, focused: inDocument ? await driver.focusedElement() : null };
      },
    );
    if (step.inDocument === false) return { stopReason: "left-document", initialFocus, warnings };
    // A focus trap keeps focus on the same element. Distinct controls that sound the same (a
    // column of "Download, link") differ in their element, so they aren't repeats.
    const current = focusSignature(step.spoken, step.focused ?? null);
    run = prev !== null && current === prev ? run + 1 : 1;
    if (run >= options.repeatLimit) return { stopReason: "repeat-limit", initialFocus, warnings };
    prev = current;
  }
}

function focusSignature(spoken: string, focused: FocusedElement | null): string {
  return JSON.stringify([
    normalizeSpeech(spoken),
    focused?.tag,
    focused?.role,
    focused?.name,
    focused?.href,
  ]);
}

export function describeElement(element: FocusedElement): string {
  const name = element.name ? ` "${element.name}"` : " with no name";
  return `${element.role ?? element.tag}${name}`;
}
