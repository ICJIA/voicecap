/**
 * What a page card says of a page's forms: each form's banner (src/forms/banner.ts, the one place
 * its words are decided), then, for the card's fold "What happened at the form", each required field
 * with what NVDA said of it, what each press did, and what axe found with the form's errors showing.
 * It is drawn from forms-result.json, which the page carries for its fingerprint check; the card
 * says nothing the file doesn't. Pure: the file's text is data, so each part of it is checked before
 * it is read.
 */
import { formsFlags, type FormFlagInput } from "../flags/forms.js";
import { formBanner, type FormBanner } from "../forms/banner.js";
import { readPress } from "../forms/press.js";
import { readFormsResults } from "../forms/result-file.js";
import type { FlagResult } from "../model.js";
import { normalizeSpeech } from "../passes/steps.js";
import { FORMS_TEXT } from "./text.js";

/** One form of a page, as its card shows it. */
export interface CardForm {
  /** "Form 1", and, when the form's submit control has a name, "sends with Send". */
  label: string;
  banner: FormBanner;
  /** The form's flags a person's review hasn't settled: the ones the banner was decided by. */
  flagsLeft: FlagResult[];
  /** Each required field: its name, and what NVDA said of it on the first walk, or null if nothing. */
  fields: { name: string; heard: string | null }[];
  /** Each press of the submit control: what NVDA said, and what the press did. */
  presses: { spoken: string; did: string }[];
  /** "axe with its errors showing: no issues", or what else it came to. */
  axe: string;
}

/** Whether `value` is an array of the kind the file keeps. */
const isList = (value: unknown): value is unknown[] => Array.isArray(value);

/** One form of the file as the card reads it: null where the file's form isn't in a shape it reads. */
function wellFormed(form: unknown): form is FormFlagInput & { presses: { axe?: unknown }[] } {
  if (typeof form !== "object" || form === null) return false;
  const each = form as Record<string, unknown>;
  const info = each.form as Record<string, unknown> | undefined;
  return (
    ["completed", "stuck", "not-tested"].includes(String(each.result)) &&
    typeof info === "object" &&
    info !== null &&
    typeof info.kind === "string" &&
    isList(info.fields) &&
    isList(each.presses) &&
    isList(each.firstWalk)
  );
}

/**
 * The forms of a forms-result.json, ready for a card; null when the text isn't a file voicecap
 * writes (or is one of a version it doesn't know), and an empty list for a file of no forms.
 * `settled` is whether a person's review settled the page's flags ("Reviewed, no issues" or
 * "Fixed", of the transcripts shown); `checkedOn` is the day the page's forms were checked.
 */
export function cardFormsOf(text: string, settled: boolean, checkedOn: string): CardForm[] | null {
  const forms = readFormsResults(text);
  if (forms === null || !forms.every(wellFormed)) return null;
  return forms.map((form, at) => {
    const flagsLeft = settled ? [] : formsFlags([form]);
    const banner = formBanner(form, flagsLeft, checkedOn);
    return {
      label: labelOf(form, at + 1),
      banner,
      flagsLeft,
      fields: requiredOf(form),
      presses: form.presses.map((press) => ({
        spoken: normalizeSpeech(String(press.spoken ?? "")),
        did: didOf(form, press),
      })),
      axe: axeOf(form),
    };
  });
}

function labelOf(form: FormFlagInput, number: number): string {
  const name = form.form.submitName;
  return typeof name === "string" && name.trim() !== ""
    ? FORMS_TEXT.labelNamed(number, name.trim())
    : FORMS_TEXT.label(number);
}

/** Each required field with what NVDA said of it on the first walk. */
function requiredOf(form: FormFlagInput): CardForm["fields"] {
  return form.form.fields
    .filter((field) => field.required)
    .map((field) => {
      const heard = form.firstWalk.find((each) => each.field === field.index);
      const spoken = heard === undefined ? "" : normalizeSpeech(String(heard.spoken ?? ""));
      return {
        name: typeof field.name === "string" && field.name !== "" ? field.name : FORMS_TEXT.noName,
        heard: spoken === "" ? null : spoken,
      };
    });
}

/** What a press did, in a sentence, as the pass read it. */
function didOf(form: FormFlagInput, press: FormFlagInput["presses"][number]): string {
  const read = readPress(
    form.baseline ?? { invalid: [], messages: [] },
    press.heldBefore ?? 0,
    press.state,
  );
  if (read.completed) return FORMS_TEXT.did.completed;
  if (read.showedError) {
    const shown = press.state.bubble ?? read.newMessages[0];
    return shown === undefined || shown === null || shown === ""
      ? FORMS_TEXT.did.error
      : FORMS_TEXT.did.errorWith(normalizeSpeech(shown));
  }
  return read.changed ? FORMS_TEXT.did.changed : FORMS_TEXT.did.nothing;
}

/** The most rules the line on axe names. */
const MOST_RULES = 5;

/**
 * What axe found with the form's errors showing: the last press that has an axe check, since that is
 * when the errors were showing. The line says no issues, how many and which rules, or why axe has
 * no result.
 */
function axeOf(form: FormFlagInput): string {
  const checked = form.presses
    .map((press) => (press as { axe?: unknown }).axe as Record<string, unknown> | null | undefined)
    .filter((axe): axe is Record<string, unknown> => typeof axe === "object" && axe !== null);
  const last = checked.at(-1);
  if (last === undefined) return FORMS_TEXT.axe.none;
  if (typeof last.error === "string") return FORMS_TEXT.axe.failed;
  const counts = (last.summary as { counts?: { violations?: unknown } } | undefined)?.counts;
  const issues = counts?.violations;
  if (typeof issues !== "number" || !Number.isInteger(issues) || issues < 0) {
    return FORMS_TEXT.axe.none;
  }
  if (issues === 0) return FORMS_TEXT.axe.clean;
  const found = (last.results as { violations?: { id?: unknown }[] } | undefined)?.violations;
  const rules = (isList(found) ? found : [])
    .flatMap((rule) => (typeof rule?.id === "string" ? [rule.id] : []))
    .slice(0, MOST_RULES);
  return FORMS_TEXT.axe.found(issues, rules.join(", "));
}

/**
 * What At a glance says of the forms: the forms the pass checked across the page's cards and how
 * many work with NVDA, with the pages of those that don't, in page order. A form that wasn't checked
 * is no form that doesn't work, so it's in neither count.
 */
export interface FormsGlance {
  found: number;
  working: number;
  /** The forms that weren't checked (a search form, a form on another site, one with no submit). */
  notChecked: number;
  /** The pages with a form that doesn't work, by the name the page shows. */
  broken: string[];
}

/** The glance's counts over some cards. */
export function formsGlanceOf(
  cards: readonly { name: string; forms?: { forms: CardForm[] } | { notRecorded: string } }[],
): FormsGlance {
  let found = 0;
  let notChecked = 0;
  let working = 0;
  const broken: string[] = [];
  for (const card of cards) {
    if (card.forms === undefined || !("forms" in card.forms)) continue;
    const checked = card.forms.forms.filter((form) => form.banner.kind !== "not-checked");
    found += checked.length;
    notChecked += card.forms.forms.length - checked.length;
    const fine = checked.filter((form) => form.banner.kind === "works").length;
    working += fine;
    if (fine < checked.length) broken.push(card.name);
  }
  return { found, working, notChecked, broken };
}
