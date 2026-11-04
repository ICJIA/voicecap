import { FORMS_DEFAULTS } from "../config/defaults.js";
import type { AxeCapture, ScreenReaderDriver } from "../drivers/types.js";
import type {
  FieldHeard,
  FieldValue,
  FormField,
  FormInfo,
  FormOutcome,
  FormResult,
  FormState,
} from "../forms/types.js";
import { readPress } from "../forms/press.js";
import type { StopReason } from "../model.js";
import { redactAccount } from "../run/failure.js";
import { errorMessage } from "../util/errors.js";
import { InterruptedError, type StepRecorder } from "./steps.js";

export interface FormPassOptions {
  cap: number;
  /** How long the driver keeps listening after a press, once NVDA has gone quiet. */
  settleMs: number;
  /** What goes into a typed field, by input type (see fieldValueOf). */
  values: Record<string, string>;
}

export interface FormsPassOutcome {
  stopReason: StopReason;
  forms: FormOutcome[];
  warnings: string[];
  /**
   * The error that ended the pass at a form (not Ctrl+C): the forms before it keep their outcomes,
   * and it and those after are not tested, so the pass still has a result for each form it took.
   */
  error?: Error;
}

/** The members a driver needs for the pass, which leaves only checkFormWithAxe optional. */
type FormDriver = ScreenReaderDriver &
  Required<
    Pick<
      ScreenReaderDriver,
      "armFormGuard" | "focusFormField" | "pressSubmit" | "fillField" | "formState"
    >
  >;

function testsForms(driver: ScreenReaderDriver): driver is FormDriver {
  return (
    driver.armFormGuard !== undefined &&
    driver.focusFormField !== undefined &&
    driver.pressSubmit !== undefined &&
    driver.fillField !== undefined &&
    driver.formState !== undefined
  );
}

const NO_FORM_DRIVER = "this run's driver doesn't test forms";

/** Why a form stopped at a field the keyboard can't get to: `form-field-unreachable`'s evidence. */
export const UNREACHABLE = "Tab never reached it";

/**
 * Why a form that answered with a JavaScript dialog (an alert, say, or "Are you sure?") isn't
 * tested: voicecap dismisses the dialog, and the press's state keeps its words. Until dialogs are
 * tested, the banner says neither that NVDA can complete the form nor that it can't.
 */
export const DIALOG = "it answered with a dialog box, which voicecap doesn't test yet";

export const OUT_OF_STEPS = "the pass ran out of steps on this form";

/**
 * Why a form isn't tested when Tab went on out of the page, into the browser's own controls, with
 * every required field heard: a keyboard user could go back, but voicecap presses no key outside the
 * page, and script can't bring focus back from there.
 */
export const TAB_LEFT =
  "Tab went on out of the page, into the browser's own controls, where voicecap presses no key";

/** Tab stops a walk allows beyond the fields: links and buttons among them, such as a "What's this?". */
const WALK_SPARE_TABS = 10;

/** Why a form gets no press at all, or null for a form that gets one. */
function whyNotPressed(form: FormInfo): string | null {
  switch (form.kind) {
    case "search":
      return "it's a search form, with no required fields to learn from";
    case "no-submit":
      return "it has no submit control";
    case "other-site":
      return `it's on another site, ${form.site ?? "in a frame"}, in a frame voicecap can't read`;
    case "not-web":
      return "it sends by something other than a web address, so voicecap doesn't press it";
    case "test":
      return form.fields.length === 0 ? "it has no fields" : null;
  }
}

/** Why a form is pressed once and empty, or null for one voicecap fills. */
function whyLeftEmpty(form: FormInfo): string | null {
  if (form.captcha) return "the CAPTCHA stops voicecap there";
  if (form.sensitive) {
    return "it asks for a password or a card number, so voicecap tests it empty and never fills it";
  }
  return null;
}

/** Input types the keyboard can't be given a value for, unless a config's table has one. */
const NO_VALUE_TYPES = new Set([
  "file",
  "color",
  "range",
  "time",
  "month",
  "week",
  "datetime-local",
]);

/**
 * What the keyboard puts in a field, or null for a type voicecap has no value for. A value a config's
 * table leaves out takes the default.
 */
export function fieldValueOf(
  field: FormField,
  settings: Pick<FormPassOptions, "values">,
): FieldValue | null {
  if (field.type === "checkbox" || field.type === "radio") return { kind: "space" };
  if (field.type === "select-one" || field.type === "select-multiple") return { kind: "arrow" };
  const own = settings.values[field.type] ?? FORMS_DEFAULTS.values[field.type];
  if (own !== undefined) return { kind: "text", text: own };
  if (NO_VALUE_TYPES.has(field.type)) return null;
  return { kind: "text", text: (settings.values.text ?? FORMS_DEFAULTS.values.text) as string };
}

/** How one walk goes. */
interface WalkPlan {
  /**
   * Where it ends: a field, the submit control, or, left out, the submit control once every field
   * Tab can reach (by the scan's tabIndex) is heard: a field with a negative tabIndex would take the
   * walk out of the page, and a field after the submit control is heard on the way.
   */
  stopAt?: number | "submit";
  /** Tab on from where focus is, rather than enter the form at its first field. */
  fromHere?: boolean;
}

/** What a walk heard, and whether Tab took focus out of the page, which ends it. */
interface Walked {
  heard: FieldHeard[];
  /** Focus is in the browser's own controls now: no key may follow, and no script focus can. */
  left: boolean;
  /** Tab reached the form's submit control on the way. */
  submit: boolean;
  /** The fields it heard after Tab had passed the submit control. */
  pastSubmit: number[];
}

/**
 * Keep what NVDA says at each of the form's fields as focus moves through it: Tab, from the first
 * field, which script moves focus to, or from where focus is. Ends with focus on `plan.stopAt`.
 * Otherwise it ends when focus leaves the page (`left`), the form goes, it has used its spare tabs,
 * or the form's steps run out. A submit control that comes before a field Tab can reach doesn't end
 * a walk that's hearing the form: it goes on to hear the fields after it, and ends at the last. The fields it returns are those it found focus on, so one at
 * `stopAt` is really there.
 */
async function walk(
  driver: FormDriver,
  recorder: StepRecorder,
  form: FormInfo,
  stepLimit: number,
  { stopAt, fromHere = false }: WalkPlan = {},
): Promise<Walked> {
  const heard: FieldHeard[] = [];
  let submit = false;
  const pastSubmit: number[] = [];
  const allReachable = () =>
    form.fields.every(
      (field) => field.tabIndex < 0 || heard.some((one) => one.field === field.index),
    );
  const focusCheck = async () => ({ inDocument: await driver.focusInDocument() });
  for (let stop = 0; stop <= form.fields.length + WALK_SPARE_TABS; stop++) {
    if (recorder.count >= stepLimit) break;
    const step =
      stop === 0 && !fromHere
        ? await recorder.step("focusField", () => driver.focusFormField(form.index, 0), focusCheck)
        : await recorder.step("nextFocusable", () => driver.nextFocusable(), focusCheck);
    if (step.inDocument === false) return { heard, left: true, submit, pastSubmit };
    const state = await recorder.query("form state", () => driver.formState(form.index));
    if (!state.present) break;
    const field = state.focusedField === null ? undefined : form.fields[state.focusedField];
    if (field && !heard.some((entry) => entry.field === field.index)) {
      heard.push({ field: field.index, spoken: step.spoken, required: field.required });
      if (submit) pastSubmit.push(field.index);
    }
    submit ||= state.focusedSubmit;
    if (field && field.index === stopAt) break;
    if (state.focusedSubmit && stopAt === "submit") break;
    // Heard all: at the submit control, or, once Tab has passed it, where it is, in the page.
    if (stopAt === undefined && submit && allReachable()) break;
  }
  return { heard, left: false, submit, pastSubmit };
}

/** The fields keeping the form back, as far as the page says: its invalid ones, then the empty. */
function blocking(form: FormInfo, state: FormState): FormField[] {
  return [...state.invalid, ...state.emptyRequired].flatMap((index) => form.fields[index] ?? []);
}

/** How a field reads in a sentence. */
function nameOf(field: FormField): string {
  return field.name ?? `field ${field.index + 1}`;
}

/**
 * Test one form, on a page that's open with the form's guard not armed yet. Arm the guard, then hear
 * the form, press it, look at the page, hear it again, fill the field that's blocking, and go round
 * again. Each round fills a field no round has, so a form takes at most its fields + 1 presses. A
 * filled field that's still blocking doesn't take a turn again: the press after it could be a reset
 * as easily as a refusal, so the form goes on and answers for it at the end.
 *
 * Script moves focus only to enter the form at its first field. The keyboard does the rest, so every
 * press is from the submit control Tab reached, and every fill is in a field a walk found focus on.
 * What voicecap can't speak for, it calls `not-tested`, not `stuck`, since a false red is as bad as a
 * false green: a form tested empty, one that runs out of `options.cap` steps, which are this form's
 * own, and one that needs a value voicecap hasn't got.
 *
 * `FormState.messages` is the text showing now and `heldRequests` only counts up, so messages and
 * invalid fields are new against the state before the first walk, as a page can show errors when Tab
 * leaves a field, and a held request is against the state just before its press, as a page can send
 * one while a field is typed in. A guard that refuses or never answers is an answer about the form;
 * any other driver error, or a timeout, ends the pass.
 */
export async function formPass(
  driver: ScreenReaderDriver,
  recorder: StepRecorder,
  form: FormInfo,
  options: FormPassOptions,
): Promise<FormOutcome> {
  const presses: FormOutcome["presses"] = [];
  let firstWalk: FieldHeard[] = [];
  let errorWalk: FieldHeard[] | null = null;
  let lastWalk: FieldHeard[] = [];
  const seen: Pick<FormOutcome, "baseline"> = {};
  const end = (
    result: FormResult,
    reason: string | null,
    stoppedAt: FormField | null = null,
  ): FormOutcome => ({
    form,
    result,
    stoppedAt,
    reason,
    presses,
    ...(seen.baseline ? { baseline: seen.baseline } : {}),
    firstWalk,
    errorWalk: errorWalk ?? [],
    lastWalk,
  });

  if (!testsForms(driver)) return end("not-tested", NO_FORM_DRIVER);
  const notPressed = whyNotPressed(form);
  if (notPressed !== null) return end("not-tested", notPressed);
  try {
    await recorder.query("arming the form guard", () => driver.armFormGuard());
  } catch (error) {
    if (error instanceof InterruptedError) throw error;
    const reason = redactAccount(errorMessage(error));
    return end("not-tested", `the guard couldn't be armed, so nothing was pressed: ${reason}`);
  }

  const stepLimit = recorder.count + options.cap;
  const outOfSteps = () => recorder.count >= stepLimit;
  const readState = () => recorder.query("form state", () => driver.formState(form.index));
  const emptyOnly = whyLeftEmpty(form);
  // Script can enter the form at the first field, but no one with a keyboard can.
  const barred = form.fields.find(
    (field) => field.tabIndex < 0 && (field.required || field.index === 0),
  );
  const settleMs = Math.min(options.settleMs, recorder.stepTimeoutMs / 2);
  const filled = new Set<number>();
  let lastErrors: string | null = null;

  // Whether any walk has had Tab reach the submit control, and the fields a walk heard after it.
  let submitSeen = false;
  const pastSubmit = new Set<number>();
  let lastFilled: number | null = null;
  const walkOn = async (plan?: WalkPlan): Promise<Walked> => {
    const walked = await walk(driver, recorder, form, stepLimit, plan);
    submitSeen ||= walked.submit;
    for (const index of walked.pastSubmit) pastSubmit.add(index);
    return walked;
  };
  /**
   * Where a form ends once a walk took Tab out of the page, with no key after it: at the first
   * required field no walk heard, which Tab never reaches; at the submit control, when Tab never
   * reached it; or, with both heard, not tested, since only a key outside the page could go back.
   */
  const leftPage = (walked: FieldHeard[]): FormOutcome => {
    // A form tested empty says why, as it would after its press.
    if (emptyOnly !== null) return end("not-tested", emptyOnly);
    const heard = [...firstWalk, ...(errorWalk ?? []), ...lastWalk, ...walked];
    const missed = form.fields.find(
      (field) => field.required && !heard.some((entry) => entry.field === field.index),
    );
    if (missed) return end("stuck", UNREACHABLE, missed);
    return submitSeen ? end("not-tested", TAB_LEFT) : end("stuck", neverSubmit());
  };
  const neverSubmit = () =>
    `Tab never reached the submit control${form.submitName === null ? "" : `, "${form.submitName}"`}`;

  const baseline = await readState();
  seen.baseline = { invalid: [...baseline.invalid], messages: [...baseline.messages] };
  // A dialog the page opened as it loaded isn't the form's answer: only one after this is.
  const dialogsBefore = baseline.dialogs?.length ?? 0;
  const dialogSince = (state: FormState) => (state.dialogs?.length ?? 0) > dialogsBefore;
  const first = await walkOn();
  firstWalk = first.heard;
  if (first.left) return leftPage([]);
  for (;;) {
    if (outOfSteps()) return end("not-tested", OUT_OF_STEPS);
    let before = await readState();
    if (before.present && !before.focusedSubmit) {
      // Tab on from the field just filled, unless it comes after the submit control: Tab from there
      // goes on away from it, so the walk enters the form at its first field again.
      const fromHere = lastFilled !== null && !pastSubmit.has(lastFilled);
      const toSubmit = await walkOn({ stopAt: "submit", fromHere });
      if (toSubmit.left) return leftPage(toSubmit.heard);
      if (outOfSteps()) return end("not-tested", OUT_OF_STEPS);
      before = await readState();
    }
    if (dialogSince(before)) return end("not-tested", DIALOG);
    if (!before.present) return end("stuck", "the form left the page");
    if (!before.focusedSubmit) return end("stuck", neverSubmit());
    const { spoken } = await recorder.step("pressSubmit", () =>
      driver.pressSubmit(form.index, settleMs),
    );
    const state = await readState();

    const errors = JSON.stringify([state.invalid, state.messages]);
    let axe: AxeCapture | null = null;
    if (state.present && driver.checkFormWithAxe && errors !== lastErrors) {
      axe = await recorder.query("checking the form with axe", () =>
        driver.checkFormWithAxe!(form.index),
      );
    }
    lastErrors = errors;
    presses.push({ state, spoken, axe, heldBefore: before.heldRequests });
    // The press's state keeps the dialog's words, for the record.
    if (dialogSince(state)) return end("not-tested", DIALOG);

    if (!state.present) {
      if (emptyOnly !== null) return end("not-tested", emptyOnly);
      return end("stuck", "the form left the page after the press");
    }
    // A check still under way holds the page up, so no key goes into it.
    if (axe && "leftRunning" in axe) {
      return end("not-tested", "axe was still running in the page, so voicecap pressed no more");
    }
    const press = readPress(baseline, before.heldRequests, state);
    const finishes = emptyOnly === null && barred === undefined;
    if (finishes && press.completed) return end("completed", null);
    if (finishes && !press.changed) {
      const stoppedAt = form.fields[state.invalid[0] ?? -1] ?? null;
      return end("stuck", "pressing submit changed nothing", stoppedAt);
    }

    const after = await walkOn();
    lastWalk = after.heard;
    if (press.showedError) errorWalk ??= lastWalk;
    if (emptyOnly !== null) return end("not-tested", emptyOnly);
    if (after.left) return leftPage([]);
    if (barred !== undefined) return end("stuck", UNREACHABLE, barred);
    if (outOfSteps()) return end("not-tested", OUT_OF_STEPS);
    const blockers = blocking(form, state);
    const next = blockers.find((field) => !filled.has(field.index));
    if (next === undefined) {
      const [stoppedAt = null] = blockers;
      return end(
        "stuck",
        stoppedAt
          ? "it was filled by keyboard, and the form didn't take it"
          : "every required field was filled, and the form still wouldn't send",
        stoppedAt,
      );
    }
    const value = fieldValueOf(next, options);
    if (value === null) {
      return end(
        "not-tested",
        `voicecap has no value for ${nameOf(next)}, a ${next.type} field`,
        next,
      );
    }
    const reached = await walkOn({ stopAt: next.index });
    // Tab went out of the page on the way to the field: from the form's start, it never reached it.
    if (reached.left) return end("stuck", UNREACHABLE, next);
    if (outOfSteps()) return end("not-tested", OUT_OF_STEPS);
    if (!reached.heard.some((entry) => entry.field === next.index)) {
      return end("stuck", UNREACHABLE, next);
    }
    await recorder.step("fillField", () => driver.fillField(value));
    filled.add(next.index);
    lastFilled = next.index;
  }
}

/**
 * The start of the reason a form gives when an earlier test of the same form stands for it, followed
 * by that test's page as a path: "tested on /about". The banner reads it (forms/banner.ts).
 */
export const TESTED_ON = "tested on ";

/** What a form says when an earlier test of the same form stands for it. */
export function testedOnReason(page: string): string {
  return `${TESTED_ON}${page}`;
}

/** What the forms pass is told about the run it's part of. */
export interface FormsContext {
  /** The most forms the pass takes on one page. */
  maxPerPage?: number;
  /** This page, as a path such as "/about", which a later form of the same signature says. */
  page?: string;
  /** The page a form of this signature was tested on earlier in the run, as a path; null for none. */
  testedOn?: (signature: string) => string | null;
  /**
   * Load the page again, with the guard's gate in front of the browser, for the next form: each form
   * gets a load of its own, since pressing a form changes the page. It times itself. Left out, every
   * form is taken on the load that's open.
   */
  reopen?: () => Promise<void>;
}

/** A form taken without a press, and why. */
function untested(form: FormInfo, reason: string): FormOutcome {
  return {
    form,
    result: "not-tested",
    stoppedAt: null,
    reason,
    presses: [],
    firstWalk: [],
    errorWalk: [],
    lastWalk: [],
  };
}

/**
 * Test the forms on the page that's open, in the order the driver found them: the first
 * `maxPerPage`, with a warning that says how many it left. A form the run tested on an earlier page,
 * or earlier on this one (a footer's sign-up), is pressed no more: it says where it was tested. Each
 * form that's pressed gets a load of its own (`reopen`), and is found again on it by its signature,
 * since the scan numbers a page's forms on each load. A driver that can't test forms is no failure
 * of the page: its forms aren't tested, and the pass says so.
 */
export async function formsPass(
  driver: ScreenReaderDriver,
  recorder: StepRecorder,
  options: FormPassOptions & FormsContext,
): Promise<FormsPassOutcome> {
  const warnings = testsForms(driver) ? [] : [NO_FORM_DRIVER];
  const find = driver.findForms?.bind(driver);
  if (find === undefined)
    return { stopReason: "forms-done", forms: [], warnings: [NO_FORM_DRIVER] };
  const findAgain: () => Promise<FormInfo[]> = find;
  const outcomes: FormOutcome[] = [];
  const found = await recorder.query("finding forms", find);
  const taken = found.slice(0, options.maxPerPage ?? found.length);
  const left = found.length - taken.length;
  if (left > 0) {
    warnings.push(
      `${left} more ${left === 1 ? "form was" : "forms were"} left untested: the pass takes ${taken.length} a page`,
    );
  }
  const here = new Map<string, string>();
  // Whether the load that's open has had a form tried on it.
  let used = false;
  // Whether a form's walk left focus in the browser's own controls on the load that's open.
  let outside = false;
  for (const [at, form] of taken.entries()) {
    try {
      await takeForm(form);
    } catch (error) {
      if (error instanceof InterruptedError) throw error;
      const why = redactAccount(errorMessage(error));
      outcomes.push(untested(form, `voicecap couldn't finish testing it: ${why}`));
      for (const after of taken.slice(at + 1)) outcomes.push(untested(after, ENDED_AT_ERROR));
      return {
        stopReason: "error",
        forms: outcomes,
        warnings,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
  const capped = outcomes.some((outcome) => outcome.reason === OUT_OF_STEPS);
  return { stopReason: capped ? "step-cap" : "forms-done", forms: outcomes, warnings };

  /** Test one form, or say why it isn't, and add its outcome. */
  async function takeForm(form: FormInfo): Promise<void> {
    const earlier =
      form.kind === "test"
        ? (here.get(form.signature) ?? options.testedOn?.(form.signature))
        : null;
    if (earlier) {
      outcomes.push(untested(form, testedOnReason(earlier)));
      return;
    }
    let current = form;
    if (used && options.reopen !== undefined) {
      await options.reopen();
      const again = await recorder.query("finding forms", findAgain);
      const match =
        again.find((one) => one.signature === form.signature && one.index === form.index) ??
        again.find((one) => one.signature === form.signature);
      if (match === undefined) {
        outcomes.push(untested(form, "the form wasn't on the page when it loaded again"));
        return;
      }
      current = match;
      outside = false;
    }
    // A form that wouldn't be pressed says its own reason, wherever focus is.
    if (outside && whyNotPressed(current) === null) {
      // No key goes to the browser's own controls, and script can't bring focus back from there.
      outcomes.push(untested(form, LEFT_BEFORE));
      return;
    }
    const outcome = await formPass(driver, recorder, current, options);
    outcomes.push(outcome);
    if (outcome.presses.length > 0 && options.page !== undefined) {
      here.set(form.signature, options.page);
    }
    if (whyNotPressed(current) === null) used = true;
    outside = !(await driver.focusInDocument());
  }
}

/** Why a form isn't tested on a load where an earlier form's walk took focus out of the page. */
const LEFT_BEFORE =
  "an earlier form's walk took focus out of the page, where voicecap presses no key";

/** Why the forms after one the pass ended at weren't tested. */
const ENDED_AT_ERROR = "the pass ended at an error before it was tested";
