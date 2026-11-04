/**
 * The forms pass's flag rules, which read what a form's test found (a FormOutcome, or the same as
 * forms-result.json keeps it) rather than NVDA's steps. Six hints for a person, never verdicts:
 *
 * - `form-error-silent`: a press showed an error (a message, a field turned invalid, or Chrome's own
 *   bubble) and NVDA said none of it.
 * - `form-no-feedback`: a press changed nothing, and no request was held.
 * - `form-error-unlinked`: after the press, a field that is invalid said no more than it did before
 *   it: not that it is invalid where it hadn't said so, and not the error's own words. "Invalid
 *   entry" alone is no evidence, since NVDA says it before any press on an untouched required radio,
 *   list, and check box. The field a press put focus on is heard in that press's own words; the
 *   others on the walk after it. For Chrome's own errors, a field is linked when NVDA spoke the
 *   bubble at a press that showed it there.
 * - `form-required-unsaid`: a field that blocked the form didn't say "required" on the first walk.
 * - `form-cant-finish`: the form never got to the point of sending by keyboard.
 * - `form-field-unreachable`: Tab never reached a required field, or its value couldn't be entered.
 *
 * A message seen only after a request was held is no form error: a page may be reacting to the guard.
 * A form that answered with a JavaScript dialog raises nothing: voicecap doesn't test dialogs yet.
 * A form that got to the point of sending with no problems raises nothing, and axe's findings raise
 * nothing. NVDA's English words are FORMS_DEFAULTS.words, in the config's defaults. Pure.
 */
import { FORMS_DEFAULTS } from "../config/defaults.js";
import type { FlagResult } from "../model.js";
import { DIALOG, OUT_OF_STEPS, UNREACHABLE } from "../passes/forms.js";
import { readPress } from "../forms/press.js";
import type { FieldHeard, FormField, FormOutcome, FormState } from "../forms/types.js";
import { normalizeSpeech } from "../passes/steps.js";

/** The ids of the forms pass's rules, in the order they are raised. */
export const FORMS_RULES = [
  "form-error-silent",
  "form-no-feedback",
  "form-error-unlinked",
  "form-required-unsaid",
  "form-cant-finish",
  "form-field-unreachable",
] as const;

/** A forms rule's id. */
export type FormsRule = (typeof FORMS_RULES)[number];

/** Whether `rule` is one of the forms pass's. */
export function isFormsRule(rule: string): rule is FormsRule {
  return (FORMS_RULES as readonly string[]).includes(rule);
}

/**
 * What the rules read of a form's test: a FormOutcome fits, and so does a form of forms-result.json
 * read back, without its axe checks, which no rule reads.
 */
export type FormFlagInput = Pick<
  FormOutcome,
  "form" | "result" | "stoppedAt" | "reason" | "baseline" | "firstWalk" | "errorWalk" | "lastWalk"
> & { presses: readonly { state: FormState; spoken: string; heldBefore?: number }[] };

/** What a rule found on one form: its message, how many times, and the lines it quotes. */
interface Finding {
  message: string;
  count: number;
  /** What NVDA said, then the page's words beside it. */
  quotes: string[];
}

/** The flags the forms pass's rules raise on `forms`, in the rules' order, each form in turn. */
export function formsFlags(forms: readonly FormFlagInput[]): FlagResult[] {
  const flags: FlagResult[] = [];
  for (const rule of FORMS_RULES) {
    for (const form of forms) {
      const found = findings(form)[rule];
      if (found) {
        flags.push({ rule, pass: "forms", count: found.count, message: found.message });
      }
    }
  }
  return flags;
}

/** The lines a forms rule's flag quotes: what NVDA said and the page's words, each once, at most 3. */
export function formsQuotes(rule: string, forms: readonly FormFlagInput[]): string[] {
  if (!isFormsRule(rule)) return [];
  const lines: string[] = [];
  for (const form of forms) {
    for (const line of findings(form)[rule]?.quotes ?? []) {
      if (line !== "" && !lines.includes(line)) lines.push(line);
    }
  }
  return lines.slice(0, 3);
}

function findings(form: FormFlagInput): Partial<Record<FormsRule, Finding>> {
  const found: Partial<Record<FormsRule, Finding>> = {};
  // A form that answered with a dialog box isn't tested: its presses are no evidence either way.
  if (form.result === "not-tested" && form.reason === DIALOG) return found;
  const label = form.form.submitName === null ? "The form" : `The "${form.form.submitName}" form`;
  const words = FORMS_DEFAULTS.words;
  const presses = form.presses.map((_, i) => readOne(form, i));

  const shown = presses.find((press) => press.showedError);
  if (shown) {
    const said = [...shown.messages, ...(shown.bubble === null ? [] : [shown.bubble])];
    const heard =
      said.some((text) => contains(shown.spoken, text)) || hasWord(shown.spoken, words.invalid);
    if (!heard) {
      found["form-error-silent"] = {
        message: `${label} showed an error after the press (${said.length > 0 ? said.map((text) => `"${text}"`).join(", ") : `${plural(shown.invalid.length, "field")} turned invalid`}), and NVDA said none of it.`,
        count: 1,
        quotes: [normalizeSpeech(shown.spoken), ...said],
      };
    }
  }

  const unchanged = presses.find((press) => !press.changed);
  if (unchanged) {
    found["form-no-feedback"] = {
      message: `${label}: pressing submit changed nothing, and no request was held.`,
      count: 1,
      quotes: [normalizeSpeech(unchanged.spoken)],
    };
  }

  if (shown && form.errorWalk.length > 0) {
    const errorWords = [...shown.messages, ...(shown.bubble === null ? [] : [shown.bubble])];
    const nativeError = shown.bubble !== null && shown.messages.length === 0;
    const unlinked = nativeError
      ? unlinkedBubbled(presses, form.errorWalk)
      : unlinkedMarked(form, presses, shown.state.invalid, errorWords);
    if (unlinked.length > 0) {
      found["form-error-unlinked"] = {
        message: `${label}: after the press, ${names(
          form,
          unlinked.map((one) => one.index),
        )} didn't say what was wrong, or that it was invalid.`,
        count: unlinked.length,
        quotes: [...unlinked.map((one) => normalizeSpeech(one.spoken)), ...errorWords],
      };
    }
  }

  const first = presses[0];
  if (first) {
    const blockers = [...new Set([...first.invalid, ...first.state.emptyRequired])];
    const unsaid = blockers.flatMap((index) => {
      const heard = form.firstWalk.find((entry) => entry.field === index);
      return heard && !hasWord(heard.spoken, words.required)
        ? [{ index, spoken: heard.spoken }]
        : [];
    });
    if (unsaid.length > 0) {
      found["form-required-unsaid"] = {
        message: `${label}: ${names(
          form,
          unsaid.map((one) => one.index),
        )} blocked the form, but NVDA didn't say it is required.`,
        count: unsaid.length,
        quotes: unsaid.map((one) => normalizeSpeech(one.spoken)),
      };
    }
  }

  if (form.result === "stuck") {
    const at = form.stoppedAt ? ` at ${nameOf(form.stoppedAt)}` : "";
    const why = form.reason === null ? "" : `: ${form.reason}`;
    found["form-cant-finish"] = {
      message: `${label} couldn't be completed by keyboard, stopping${at}${why}.`,
      count: 1,
      quotes: [],
    };
  }

  const walked = [...form.firstWalk, ...form.errorWalk, ...form.lastWalk];
  // A walk cut short (the pass ran out of steps, or the form left the page) hasn't heard every field.
  const cutShort = form.reason === OUT_OF_STEPS || form.reason?.startsWith(LEFT_PAGE) === true;
  const missed =
    form.firstWalk.length === 0 || cutShort
      ? []
      : form.form.fields.filter(
          (field) => field.required && !walked.some((heard) => heard.field === field.index),
        );
  const stopped =
    form.result === "stuck" &&
    form.stoppedAt &&
    (form.reason === UNREACHABLE ||
      // A value keyboard keys put in and the form refused: a keyboard problem only for a control
      // that isn't typed into. A typed field may simply refuse voicecap's fake value (a pattern).
      (form.reason?.startsWith("it was filled by keyboard") === true &&
        !TYPED.has(form.stoppedAt.type)))
      ? [form.stoppedAt]
      : [];
  const unreachable = [
    ...new Map([...missed, ...stopped].map((field) => [field.index, field])).values(),
  ];
  if (unreachable.length > 0) {
    found["form-field-unreachable"] = {
      message: `${label}: ${unreachable.map(nameOf).join(", ")} couldn't be reached or filled by keyboard.`,
      count: unreachable.length,
      quotes: [],
    };
  }
  return found;
}

/** A field that didn't say what was wrong with it, and what NVDA said there. */
interface Unlinked {
  index: number;
  spoken: string;
}

/**
 * Chrome's own errors: the fields its bubble was shown at, each the field a press put focus on (or
 * the first invalid one), that NVDA didn't speak the bubble for at any such press. A field the bubble
 * was never shown at isn't checked: it never blocked the form. A walk after the press that says the
 * bubble's words at the field counts too, but "invalid entry" there isn't needed: real NVDA says
 * "required, blank" at a native text field.
 */
function unlinkedBubbled(
  presses: readonly ReturnType<typeof readOne>[],
  walked: readonly FieldHeard[],
): Unlinked[] {
  const bubbled = new Map<number, { heard: boolean; spoken: string }>();
  for (const press of presses) {
    const { bubble } = press;
    if (bubble === null) continue;
    const index = press.state.focusedField ?? press.state.invalid[0];
    if (index === undefined) continue;
    const after = walked.find((one) => one.field === index)?.spoken ?? "";
    const heard = [press.spoken, after].some((said) => contains(said, bubble));
    const earlier = bubbled.get(index);
    bubbled.set(index, {
      heard: (earlier?.heard ?? false) || heard,
      spoken: earlier?.spoken ?? press.spoken,
    });
  }
  return [...bubbled].flatMap(([index, { heard, spoken }]) => (heard ? [] : [{ index, spoken }]));
}

/**
 * The page's own errors: each field invalid at the press that showed them which said no more than it
 * did before. The field a press put focus on (a page moves it to the first error) is heard at the
 * press itself: NVDA announces it then, and the walk's script focus of the same field is silent. It
 * is linked when that press's words, from its name on, turn it invalid or hold an error's words; a
 * field with no name can't be told from the page's other words, so only "invalid entry" counts for
 * it. Every other field is heard on the walk after the press.
 */
function unlinkedMarked(
  form: FormFlagInput,
  presses: readonly ReturnType<typeof readOne>[],
  invalid: readonly number[],
  errorWords: readonly string[],
): Unlinked[] {
  const words = FORMS_DEFAULTS.words;
  const turnedFrom = (index: number, said: string) => {
    const before = form.firstWalk.find((heard) => heard.field === index);
    return hasWord(said, words.invalid) && !(before && hasWord(before.spoken, words.invalid));
  };
  const linkedAtPress = new Set<number>();
  for (const press of presses) {
    const index = press.state.focusedField;
    if (!press.showedError || index === null) continue;
    const name = form.form.fields[index]?.name;
    const named = typeof name === "string" && name.trim() !== "";
    const own = [...press.messages, ...(press.bubble === null ? [] : [press.bubble])];
    const said = named ? spokenAfter(press.spoken, name, own) : press.spoken;
    if (said === null) continue;
    if (turnedFrom(index, said) || (named && own.some((text) => contains(said, text)))) {
      linkedAtPress.add(index);
    }
  }
  return invalid.flatMap((index) => {
    if (linkedAtPress.has(index)) return [];
    const after = form.errorWalk.find((heard) => heard.field === index);
    if (!after) return [];
    const named = errorWords.some((text) => contains(after.spoken, text));
    return turnedFrom(index, after.spoken) || named ? [] : [{ index, spoken: after.spoken }];
  });
}

/**
 * What NVDA said after it said `name` as the field's own announcement (its words, from where the
 * name's run of words ends), or null when it never said the name. The last time it said the name
 * outside the page's `messages` as they were spoken: an alert ("Enter your name.") may hold the
 * name too, before or after the field's announcement.
 */
function spokenAfter(spoken: string, name: string, messages: readonly string[]): string | null {
  const said = wordsOf(spoken);
  const wanted = wordsOf(name);
  if (wanted.length === 0) return null;
  const at = (run: readonly string[], start: number) =>
    run.every((word, i) => said[start + i] === word);
  // Which of the words are a message's, spoken whole.
  const inMessage = new Array<boolean>(said.length).fill(false);
  for (const message of messages) {
    const run = wordsOf(message);
    if (run.length === 0) continue;
    for (let start = 0; start + run.length <= said.length; start++) {
      if (at(run, start)) inMessage.fill(true, start, start + run.length);
    }
  }
  for (let start = said.length - wanted.length; start >= 0; start--) {
    if (at(wanted, start) && !inMessage[start]) return said.slice(start + wanted.length).join(" ");
  }
  return null;
}

/**
 * What one press did, read as the pass read it (forms/press.ts) against the count of held requests
 * just before it, which the outcome keeps; an older file without it is read against the press before.
 */
function readOne(form: FormFlagInput, i: number) {
  const { state, spoken, heldBefore } = form.presses[i]!;
  const baseline = form.baseline ?? { invalid: [], messages: [] };
  const held = heldBefore ?? (i === 0 ? 0 : form.presses[i - 1]!.state.heldRequests);
  const read = readPress(baseline, held, state);
  return {
    state,
    spoken,
    invalid: read.newInvalid,
    // A message that comes after a held request may be the page's answer to the guard, not an error.
    messages: read.wouldSend ? [] : read.newMessages,
    bubble: state.bubble,
    showedError: read.showedError,
    changed: read.changed,
  };
}

function nameOf(field: FormField): string {
  return field.name ?? `field ${field.index + 1}`;
}

function names(form: FormFlagInput, indexes: number[]): string {
  return indexes
    .map((index) => {
      const field = form.form.fields[index];
      return field ? nameOf(field) : `field ${index + 1}`;
    })
    .join(", ");
}

function plural(count: number, one: string): string {
  return `${count} ${count === 1 ? one : `${one}s`}`;
}

/** Words of a text, lowercased: letters and digits, whatever stands between them. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** The most consecutive words of a message that must be spoken for it to count as heard. */
const HEARD_RUN = 3;

/**
 * Whether what NVDA said holds `text`: a run of its words (3 in a row, or all of a shorter one),
 * spoken in order. NVDA puts role words between the parts of a structured alert ("Errors, heading
 * level 2, list with 1 item, Name is required"), so the whole text rarely comes in one piece. Empty
 * text is never held.
 */
function contains(spoken: string, text: string): boolean {
  const wanted = wordsOf(text);
  if (wanted.length === 0) return false;
  const said = wordsOf(spoken).join(" ");
  const run = Math.min(HEARD_RUN, wanted.length);
  for (let start = 0; start + run <= wanted.length; start++) {
    if (` ${said} `.includes(` ${wanted.slice(start, start + run).join(" ")} `)) return true;
  }
  return false;
}

/** Whether what NVDA said holds one of the words. */
function hasWord(spoken: string, words: readonly string[]): boolean {
  return words.some((word) => contains(spoken, word));
}

/** Why a form stopped when it left the page, which the pass words two ways. */
const LEFT_PAGE = "the form left the page";

/** The types of field a keyboard types into. */
const TYPED = new Set(["text", "email", "tel", "url", "number", "search", "password", "textarea"]);
