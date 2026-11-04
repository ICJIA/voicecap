/**
 * The banner of a form: the one place its words are decided, shared by every copy of the report. It
 * is the forms pass's headline, plain and definite, with no hedging. Four kinds:
 *
 * - works: the form reached the point of sending, and no form flag is left on it.
 * - needs-work: it reached the point of sending, with a form flag left; the banner says what's wrong.
 * - cant-complete: it never reached the point of sending; the banner says where it stopped.
 * - not-checked: voicecap didn't test it; the banner says why.
 *
 * `flagsLeft` is the form's flags that no review settled. A person's review of "Reviewed, no issues"
 * settles them, which turns a completed form green; a form that can't be completed stays red whatever
 * a review says, since a review doesn't make the form finishable. Pure.
 */
import type { FlagResult } from "../model.js";
import { formsFlags, type FormFlagInput } from "../flags/forms.js";
import { readPress } from "./press.js";

export type FormBannerKind = "works" | "needs-work" | "cant-complete" | "not-checked";

export interface FormBanner {
  kind: FormBannerKind;
  /** Bold, first: what the form does with NVDA. */
  headline: string;
  /** The line under it: what NVDA did, or what's wrong, or why the form wasn't checked. */
  detail: string;
}

/** The headline of each kind. */
export const BANNER_HEADLINES: Record<FormBannerKind, string> = {
  works: "This form works with NVDA.",
  "needs-work": "This form needs work with NVDA.",
  "cant-complete": "This form can't be completed with NVDA.",
  "not-checked": "This form wasn't checked.",
};

/**
 * The banner of a form. `checkedOn` is the day the form was checked, as the page writes a date
 * ("30 October 2026"): it opens the green banner's line, which says what was checked.
 */
export function formBanner(
  outcome: FormFlagInput,
  flagsLeft: readonly FlagResult[],
  checkedOn?: string,
): FormBanner {
  if (outcome.result === "stuck") {
    return {
      kind: "cant-complete",
      headline: BANNER_HEADLINES["cant-complete"],
      detail: stopped(outcome),
    };
  }
  if (outcome.result === "not-tested") {
    return {
      kind: "not-checked",
      headline: BANNER_HEADLINES["not-checked"],
      detail: whyNot(outcome),
    };
  }
  if (flagsLeft.length > 0) {
    return {
      kind: "needs-work",
      headline: BANNER_HEADLINES["needs-work"],
      detail: flagsLeft.map((flag) => flag.message).join(" "),
    };
  }
  return { kind: "works", headline: BANNER_HEADLINES.works, detail: worked(outcome, checkedOn) };
}

/** "1 required field" and "2 required fields". */
function requiredFields(count: number): string {
  return `${count} required ${count === 1 ? "field" : "fields"}`;
}

/** What the green banner says was checked. */
function worked(outcome: FormFlagInput, checkedOn: string | undefined): string {
  const required = outcome.form.fields.filter((field) => field.required).length;
  const flagged = formsFlags([outcome]).length > 0;
  // A field with no name: NVDA can't have said each field's name, whatever a review settled.
  const nameless = outcome.form.fields.some(
    (field) => typeof field.name !== "string" || field.name.trim() === "",
  );
  const lead = checkedOn === undefined ? "" : `Checked ${checkedOn}: `;
  // A press that showed an error: only then can the banner say NVDA told the user what was wrong.
  const baseline = outcome.baseline ?? { invalid: [], messages: [] };
  const showedError = outcome.presses.some(
    (press) => readPress(baseline, press.heldBefore ?? 0, press.state).showedError,
  );
  if (flagged || nameless) {
    // A person's review settled what voicecap flagged, or a field has no name, so the banner claims
    // no more than that the fields were reached and the form was completed: the card's own evidence
    // may show less.
    const reached =
      required === 0
        ? "NVDA reached the form's fields"
        : `NVDA reached all ${requiredFields(required)}`;
    const settled = flagged ? " A person's review settled what voicecap had flagged." : "";
    return `${lead}${reached}, and the form was completed by keyboard.${settled}`;
  }
  const said = "said each one's name and that it's required";
  const reached =
    required === 0
      ? "NVDA reached the form's fields"
      : `NVDA reached all ${requiredFields(required)}, ${said}${showedError ? ", and told the user what was wrong" : ""}`;
  return `${lead}${reached}. The form was completed by keyboard.`;
}

/** Where a form that can't be completed stopped. */
function stopped(outcome: FormFlagInput): string {
  if (outcome.stoppedAt !== null) {
    return `It stopped at ${outcome.stoppedAt.name ?? "a field with no name"}.`;
  }
  return outcome.reason === null
    ? "It never reached the point of sending."
    : `It never reached the point of sending: ${outcome.reason}.`;
}

/** Why a form wasn't tested, by what voicecap knows of it. */
function whyNot(outcome: FormFlagInput): string {
  const { form, reason } = outcome;
  const kinds: Record<string, string> = {
    search: "It's a search form.",
    "other-site":
      form.site === null
        ? "It's a form on another site."
        : `It's a form on another site (${form.site}).`,
    "no-submit": "It has no submit button to press.",
    "not-web": "It sends by something other than a web address.",
  };
  const kind = kinds[form.kind] ?? "";
  const because = reason === null ? "" : `Not tested: ${reason}.`;
  const said = [kind, because].filter((part) => part !== "").join(" ");
  return said === "" ? "voicecap didn't test it." : said;
}
