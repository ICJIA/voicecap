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

const OUT_OF_STEPS = "the pass ran out of steps on this form";

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
  /** Where it ends: a field, the submit control, or, left out, the submit once all are heard. */
  stopAt?: number | "submit";
  /** Tab on from where focus is, rather than enter the form at its first field. */
  fromHere?: boolean;
}

/**
 * Keep what NVDA says at each of the form's fields as focus moves through it: Tab, from the first
 * field, which script moves focus to, or from where focus is. Ends with focus on `plan.stopAt`.
 * Otherwise it ends when focus leaves the page, the form goes, it has used its spare tabs, or the
 * form's steps run out. A submit control that comes before a field doesn't end a walk that's hearing
 * the form. The fields it returns are those it found focus on, so one at `stopAt` is really there.
 */
async function walk(
  driver: FormDriver,
  recorder: StepRecorder,
  form: FormInfo,
  stepLimit: number,
  { stopAt, fromHere = false }: WalkPlan = {},
): Promise<FieldHeard[]> {
  const heard: FieldHeard[] = [];
  const focusCheck = async () => ({ inDocument: await driver.focusInDocument() });
  for (let stop = 0; stop <= form.fields.length + WALK_SPARE_TABS; stop++) {
    if (recorder.count >= stepLimit) break;
    const step =
      stop === 0 && !fromHere
        ? await recorder.step("focusField", () => driver.focusFormField(form.index, 0), focusCheck)
        : await recorder.step("nextFocusable", () => driver.nextFocusable(), focusCheck);
    if (step.inDocument === false) break;
    const state = await recorder.query("form state", () => driver.formState(form.index));
    if (!state.present) break;
    const field = state.focusedField === null ? undefined : form.fields[state.focusedField];
    if (field && !heard.some((entry) => entry.field === field.index)) {
      heard.push({ field: field.index, spoken: step.spoken, required: field.required });
    }
    if (field && field.index === stopAt) break;
    if (state.focusedSubmit && stopAt === "submit") break;
    if (state.focusedSubmit && stopAt === undefined && heard.length === form.fields.length) break;
  }
  return heard;
}

/** What one press did, against the page before the first press and just before this one. */
function readPress(baseline: FormState, before: FormState, state: FormState) {
  const newInvalid = state.invalid.filter((field) => !baseline.invalid.includes(field));
  const newMessages = state.messages.filter((message) => !baseline.messages.includes(message));
  const wouldSend = state.heldRequests > before.heldRequests;
  return {
    // A request alone proves nothing: a click beacon goes out on a press that was blocked, by Chrome
    // or the page's script. So nothing may be left invalid or empty, and no bubble may be showing.
    completed:
      wouldSend &&
      state.invalid.length === 0 &&
      state.emptyRequired.length === 0 &&
      state.bubble === null,
    // The page may be reacting to the guard, so a message after a held request isn't an error.
    showedError:
      newInvalid.length > 0 || state.bubble !== null || (newMessages.length > 0 && !wouldSend),
    // pressSubmit leaves focus on the submit control: a field that has it was moved to by the page.
    changed:
      wouldSend ||
      newInvalid.length > 0 ||
      newMessages.length > 0 ||
      state.bubble !== null ||
      state.liveChanged ||
      state.focusedField !== null,
  };
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

  const baseline = await readState();
  firstWalk = await walk(driver, recorder, form, stepLimit);
  for (;;) {
    if (outOfSteps()) return end("not-tested", OUT_OF_STEPS);
    let before = await readState();
    if (before.present && !before.focusedSubmit) {
      const fromHere = presses.length > 0;
      await walk(driver, recorder, form, stepLimit, { stopAt: "submit", fromHere });
      if (outOfSteps()) return end("not-tested", OUT_OF_STEPS);
      before = await readState();
    }
    if (!before.present) return end("stuck", "the form left the page");
    if (!before.focusedSubmit) {
      const submit = form.submitName === null ? "" : `, "${form.submitName}"`;
      return end("stuck", `Tab never reached the submit control${submit}`);
    }
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
    presses.push({ state, spoken, axe });

    if (!state.present) {
      if (emptyOnly !== null) return end("not-tested", emptyOnly);
      return end("stuck", "the form left the page after the press");
    }
    // A check still under way holds the page up, so no key goes into it.
    if (axe && "leftRunning" in axe) {
      return end("not-tested", "axe was still running in the page, so voicecap pressed no more");
    }
    const press = readPress(baseline, before, state);
    const finishes = emptyOnly === null && barred === undefined;
    if (finishes && press.completed) return end("completed", null);
    if (finishes && !press.changed) {
      const stoppedAt = form.fields[state.invalid[0] ?? -1] ?? null;
      return end("stuck", "pressing submit changed nothing", stoppedAt);
    }

    lastWalk = await walk(driver, recorder, form, stepLimit);
    if (press.showedError) errorWalk ??= lastWalk;
    if (emptyOnly !== null) return end("not-tested", emptyOnly);
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
    if (!lastWalk.some((entry) => entry.field === next.index)) {
      return end("stuck", UNREACHABLE, next);
    }
    const value = fieldValueOf(next, options);
    if (value === null) {
      return end(
        "not-tested",
        `voicecap has no value for ${nameOf(next)}, a ${next.type} field`,
        next,
      );
    }
    const reached = await walk(driver, recorder, form, stepLimit, { stopAt: next.index });
    if (outOfSteps()) return end("not-tested", OUT_OF_STEPS);
    if (!reached.some((entry) => entry.field === next.index)) {
      return end("stuck", UNREACHABLE, next);
    }
    await recorder.step("fillField", () => driver.fillField(value));
    filled.add(next.index);
  }
}

/**
 * Test the forms on the page that's open, in the order the driver found them. A driver that can't
 * test forms is no failure of the page: its forms aren't tested, and the pass says so.
 */
export async function formsPass(
  driver: ScreenReaderDriver,
  recorder: StepRecorder,
  options: FormPassOptions,
): Promise<FormsPassOutcome> {
  const warnings = testsForms(driver) ? [] : [NO_FORM_DRIVER];
  const find = driver.findForms?.bind(driver);
  if (find === undefined)
    return { stopReason: "forms-done", forms: [], warnings: [NO_FORM_DRIVER] };
  const outcomes: FormOutcome[] = [];
  for (const form of await recorder.query("finding forms", find)) {
    outcomes.push(await formPass(driver, recorder, form, options));
  }
  const capped = outcomes.some((outcome) => outcome.reason === OUT_OF_STEPS);
  return { stopReason: capped ? "step-cap" : "forms-done", forms: outcomes, warnings };
}
