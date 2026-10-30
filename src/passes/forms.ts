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
import { InterruptedError, StepTimeoutError, type StepRecorder } from "./steps.js";

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

/** What the keyboard puts in a field. A value a config's table leaves out takes the default. */
export function fieldValueOf(
  field: FormField,
  settings: Pick<FormPassOptions, "values">,
): FieldValue {
  if (field.type === "checkbox" || field.type === "radio") return { kind: "space" };
  if (field.type === "select-one" || field.type === "select-multiple") return { kind: "arrow" };
  const key = field.type === "email" || field.type === "tel" ? field.type : "text";
  return { kind: "text", text: (settings.values[key] ?? FORMS_DEFAULTS.values[key]) as string };
}

/**
 * Focus the form's first field, by script, and Tab on from it, keeping what NVDA says at each of the
 * form's fields. Ends at `stopAt`, a field, with focus on it. Otherwise it ends at the submit control
 * once every field has been heard, or when focus leaves the page, the form goes, it has used its
 * spare tabs, or the pass is out of steps. A submit control that comes before a field doesn't end it.
 */
async function walk(
  driver: FormDriver,
  recorder: StepRecorder,
  form: FormInfo,
  cap: number,
  stopAt?: number,
): Promise<FieldHeard[]> {
  const heard: FieldHeard[] = [];
  const focusCheck = async () => ({ inDocument: await driver.focusInDocument() });
  for (let stop = 0; stop <= form.fields.length + WALK_SPARE_TABS; stop++) {
    if (recorder.count >= cap) break;
    const step =
      stop === 0
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
    if (state.focusedSubmit && heard.length === form.fields.length) break;
  }
  return heard;
}

/** What one press did, against the page before the first press and just before this one. */
function readPress(baseline: FormState, before: FormState, state: FormState) {
  const newInvalid = state.invalid.filter((field) => !baseline.invalid.includes(field));
  const newMessages = state.messages.filter((message) => !baseline.messages.includes(message));
  const wouldSend = state.heldRequests > before.heldRequests;
  return {
    // A request alone proves nothing: a click beacon goes out on a press Chrome blocked. So nothing
    // may be left invalid, whether it was so before the press or not, and no bubble may be showing.
    completed: wouldSend && state.invalid.length === 0 && state.bubble === null,
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

/**
 * The next field to fill: the first invalid one not filled yet, or, when the page marks none, the
 * first required one. A filled field that's still invalid doesn't take a turn again, and the press
 * after it could be a reset as easily as a refusal, so the form goes on and answers for it at the end.
 */
function nextToFill(form: FormInfo, state: FormState, filled: Set<number>): FormField | undefined {
  const invalid = state.invalid.flatMap((index) => form.fields[index] ?? []);
  const blocking = invalid.length > 0 ? invalid : form.fields.filter((field) => field.required);
  return blocking.find((field) => !filled.has(field.index));
}

/**
 * Test one form, on a page that's open with the form's guard not armed yet. Arm the guard, then hear
 * the form, press it, look at the page, hear it again, fill the field that's blocking, and go round
 * again. Each round fills a field no round has, so a form takes at most its fields + 1 presses.
 *
 * `FormState.messages` is the text showing now and `heldRequests` only counts up, so messages and
 * invalid fields are new against the state before the first press, and a held request with the
 * state just before that press, since a page can send one as a field is typed in. The driver's
 * errors and a timeout end the pass: only the guard's own refusal is an answer about the form.
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
    if (error instanceof InterruptedError || error instanceof StepTimeoutError) throw error;
    const reason = redactAccount(errorMessage(error));
    return end("not-tested", `the guard couldn't be armed, so nothing was pressed: ${reason}`);
  }

  const readState = () => recorder.query("form state", () => driver.formState(form.index));
  const firstInvalid = (state: FormState) => form.fields[state.invalid[0] ?? -1] ?? null;
  const outOfSteps = () => recorder.count >= options.cap;
  const emptyOnly = whyLeftEmpty(form);
  const filled = new Set<number>();
  let lastErrors: string | null = null;

  firstWalk = await walk(driver, recorder, form, options.cap);
  const baseline = await readState();
  for (;;) {
    if (outOfSteps()) return end("stuck", "the pass ran out of steps");
    const before = await readState();
    if (!before.present) return end("stuck", "the form left the page");
    const { spoken } = await recorder.step("pressSubmit", () =>
      driver.pressSubmit(form.index, options.settleMs),
    );
    const state = await readState();

    const errors = JSON.stringify([state.invalid, state.messages]);
    let axe: AxeCapture | null = null;
    if (driver.checkFormWithAxe && errors !== lastErrors) {
      axe = await recorder.query("checking the form with axe", () =>
        driver.checkFormWithAxe!(form.index),
      );
    }
    lastErrors = errors;
    presses.push({ state, spoken, axe });

    if (!state.present) return end("stuck", "the form left the page after the press");
    const press = readPress(baseline, before, state);
    if (press.completed) return end("completed", null);
    // A check still under way holds the page up, so no key goes into it.
    if (axe && "leftRunning" in axe) {
      return end("not-tested", "axe was still running in the page, so voicecap pressed no more");
    }
    if (!press.changed && emptyOnly === null) {
      return end("stuck", "pressing submit changed nothing", firstInvalid(state));
    }

    lastWalk = await walk(driver, recorder, form, options.cap);
    if (press.showedError) errorWalk ??= lastWalk;
    if (emptyOnly !== null) return end("not-tested", emptyOnly);
    if (outOfSteps()) return end("stuck", "the pass ran out of steps");
    const next = nextToFill(form, state, filled);
    if (next === undefined) {
      const stoppedAt = firstInvalid(state);
      return end(
        "stuck",
        stoppedAt
          ? "it was filled by keyboard, and the form still calls it invalid"
          : "every required field was filled, and the form still wouldn't send",
        stoppedAt,
      );
    }
    if (!lastWalk.some((entry) => entry.field === next.index)) {
      return end("stuck", "Tab never reached it", next);
    }
    await walk(driver, recorder, form, options.cap, next.index);
    if (outOfSteps()) return end("stuck", "the pass ran out of steps");
    await recorder.step("fillField", () => driver.fillField(fieldValueOf(next, options)));
    filled.add(next.index);
  }
}

/**
 * Test the forms on the page that's open, in the order the driver found them. A driver that can't
 * find forms is no failure of the page: the pass ends there, and says so.
 */
export async function formsPass(
  driver: ScreenReaderDriver,
  recorder: StepRecorder,
  options: FormPassOptions,
): Promise<FormsPassOutcome> {
  const find = driver.findForms?.bind(driver);
  if (find === undefined || !testsForms(driver)) {
    return { stopReason: "forms-done", forms: [], warnings: [NO_FORM_DRIVER] };
  }
  const outcomes: FormOutcome[] = [];
  for (const form of await recorder.query("finding forms", find)) {
    outcomes.push(await formPass(driver, recorder, form, options));
    if (recorder.count >= options.cap) {
      return { stopReason: "step-cap", forms: outcomes, warnings: [] };
    }
  }
  return { stopReason: "forms-done", forms: outcomes, warnings: [] };
}
