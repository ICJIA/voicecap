/**
 * What a page keeps of its forms pass beside the transcripts (forms-result.json): for each form its
 * facts, what came of it, and every press with the page's state after it, what NVDA said, and the
 * axe check of the form where one was made. As axe.json is, it's kept apart from the page's
 * transcripts, written with its keys sorted so the same outcomes give the same bytes, with the
 * account's folders replaced, and recorded with the page, which the run's seal covers.
 */
import { FORMS_FILE, type FormsCounts } from "../model.js";
import { redactAccount } from "../run/failure.js";
import { sortKeys } from "../util/hash.js";
import type { AxeCapture } from "../drivers/types.js";
import type { FormFlagInput } from "../flags/forms.js";
import type { FormOutcome } from "./types.js";

export { FORMS_FILE };

/** The file's version: a reader of an older file knows what it may not find. */
const SCHEMA_VERSION = 1;

/**
 * The text of a page's forms results, and how they come out. `page` is the page's address as the run
 * shows it (its path). Every string in the file has the account's folders replaced, since what the
 * browser said or showed may name a path.
 */
export function keptFormsResults(
  outcomes: readonly FormOutcome[],
  page: string,
): { json: string; counts: FormsCounts } {
  const counts: FormsCounts = { forms: 0, completed: 0, stuck: 0, notTested: 0, presses: 0 };
  const forms = outcomes.map((outcome) => {
    counts.forms++;
    if (outcome.result === "completed") counts.completed++;
    else if (outcome.result === "stuck") counts.stuck++;
    else counts.notTested++;
    counts.presses += outcome.presses.length;
    return {
      form: outcome.form,
      result: outcome.result,
      stoppedAt: outcome.stoppedAt,
      reason: outcome.reason,
      presses: outcome.presses.map((press) => ({
        state: press.state,
        ...(press.heldBefore === undefined ? {} : { heldBefore: press.heldBefore }),
        spoken: press.spoken,
        axe: keptAxe(press.axe),
      })),
      ...(outcome.baseline ? { baseline: outcome.baseline } : {}),
      firstWalk: outcome.firstWalk,
      errorWalk: outcome.errorWalk,
      lastWalk: outcome.lastWalk,
    };
  });
  const kept = { schemaVersion: SCHEMA_VERSION, page, counts, forms };
  return {
    json: `${JSON.stringify(sortKeys(redactStrings(kept)), null, 2)}
`,
    counts: { ...counts },
  };
}

/** A press's axe check as the file keeps it: what it came to and what it found, or why there's none. */
function keptAxe(axe: AxeCapture | null): unknown {
  if (axe === null) return null;
  if ("error" in axe) return { error: axe.error };
  try {
    return { summary: axe.summary, results: JSON.parse(axe.json) as unknown };
  } catch {
    return { error: "axe's results for the form couldn't be read" };
  }
}

/** A copy of `value` with the account's folders replaced in every string. */
function redactStrings(value: unknown): unknown {
  if (typeof value === "string") return redactAccount(value);
  if (Array.isArray(value)) return value.map(redactStrings);
  if (value !== null && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, each] of Object.entries(value)) copy[key] = redactStrings(each);
    return copy;
  }
  return value;
}

/**
 * The forms of a forms-result.json read back, as the flag rules read them (they leave out each
 * press's axe check); null where the text isn't one, or is of a version this voicecap doesn't know.
 */
export function readFormsResults(text: string): FormFlagInput[] | null {
  try {
    const file = JSON.parse(text) as { schemaVersion?: unknown; forms?: unknown };
    if (file.schemaVersion !== SCHEMA_VERSION || !Array.isArray(file.forms)) return null;
    return file.forms as FormFlagInput[];
  } catch {
    return null;
  }
}
