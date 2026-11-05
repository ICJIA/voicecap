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
      ...(outcome.analyticsHosts ? { analyticsHosts: outcome.analyticsHosts } : {}),
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
    return (file.forms as unknown[]).map(sendingFacts) as FormFlagInput[];
  } catch {
    return null;
  }
}

/** A held request the file doesn't say enough of: to no host, so it's never the form sending. */
const UNREADABLE_REQUEST: Record<string, unknown> = { host: "", type: "unknown" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * A form read back with what says whether a press sent it made safe to read: a list of analytics
 * hosts that isn't a list of text is left out (voicecap's own is read then), a held request that
 * isn't one with a host and a type as text keeps its place as one to no host, which never counts
 * as the form sending (a press reads the list from its place in it), and a method that isn't text is left off
 * its request (which then counts only by its host). A hand-edited file reads, and doesn't throw.
 */
function sendingFacts(form: unknown): unknown {
  if (!isRecord(form)) return form;
  const copy: Record<string, unknown> = { ...form };
  const hosts = copy.analyticsHosts;
  if (
    hosts !== undefined &&
    !(Array.isArray(hosts) && hosts.every((host) => typeof host === "string"))
  ) {
    delete copy.analyticsHosts;
  }
  if (Array.isArray(copy.presses)) {
    copy.presses = copy.presses.map((press: unknown) => {
      if (!isRecord(press) || !isRecord(press.state) || press.state.held === undefined) {
        return press;
      }
      const held = Array.isArray(press.state.held) ? press.state.held : [];
      return {
        ...press,
        state: {
          ...press.state,
          held: held
            .map((request: unknown) =>
              isRecord(request) &&
              typeof request.host === "string" &&
              typeof request.type === "string"
                ? request
                : UNREADABLE_REQUEST,
            )
            .map((request: Record<string, unknown>) => {
              if (request.method === undefined || typeof request.method === "string") {
                return request;
              }
              const { method: _method, ...rest } = request;
              return rest;
            }),
        },
      };
    });
  }
  return copy;
}
