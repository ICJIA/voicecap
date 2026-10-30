/**
 * What the forms pass knows about a page's forms, shared by the browser's scan, the driver, and the
 * pass. A form is only ever pressed when its kind is "test".
 */
import type { AxeCapture, FocusedElement } from "../drivers/types.js";

/**
 * - test: a form with a submit control; the pass presses it.
 * - search: a search form, which has no required fields to learn from.
 * - no-submit: fields with no `<form>` around them, or a form with no submit control.
 * - other-site: a form in another site's frame (Google Forms, Microsoft Forms); `site` names it.
 * - not-web: a form that sends by anything but a web address, such as `mailto:`.
 */
export type FormKind = "test" | "search" | "no-submit" | "other-site" | "not-web";

export interface FormField {
  /** Its place among the form's fields, in the order Tab visits them (a radio group is one). */
  index: number;
  /** The accessible name as the browser computes it; null when it has none. */
  name: string | null;
  /** The input's type, or "select-one", "select-multiple", or "textarea". */
  type: string;
  /** The `required` attribute, `aria-required="true"`, or a radio or check box required by its group. */
  required: boolean;
}

export interface FormInfo {
  /** Its place among the page's forms, in the order the scan found them. */
  index: number;
  /** The same for one form on two pages and different for two forms: a footer's sign-up is one. */
  signature: string;
  kind: FormKind;
  /** The site that holds a form in another site's frame; otherwise null. */
  site: string | null;
  fields: FormField[];
  /** A password or a card number: the pass never fills it. */
  sensitive: boolean;
  /** A CAPTCHA, which stops voicecap there. */
  captcha: boolean;
}

export interface FormState {
  focused: FocusedElement | null;
  /** Which of the form's fields has focus: its index, by a radio group's one index for any radio. */
  focusedField: number | null;
  /** Whether a submit control of the form has focus. */
  focusedSubmit: boolean;
  /** The indexes of the fields the browser or the page calls invalid. */
  invalid: number[];
  /**
   * The message text showing now: the form's alerts and live regions, a page's alerts and status
   * messages, what an invalid field's `aria-describedby` or `aria-errormessage` names, and text
   * added to the form since the scan. A hint that was there before any press is in it too, so a
   * caller compares it with the read before the first press.
   */
  messages: string[];
  /** Whether a live region's text changed since the last read. */
  liveChanged: boolean;
  /** How many requests the guard has held: the session's count, not the page's. */
  heldRequests: number;
  /** Whether the form is still in the page. */
  present: boolean;
  /** The focused field's own validationMessage: Chrome's bubble, which is in no element. */
  bubble: string | null;
}

/** What NVDA said at a field, and whether the field is required. */
export interface FieldHeard {
  field: number;
  spoken: string;
  required: boolean;
}

/** What goes into a field: typed text, the space bar (a check box or radio), or an arrow key (a list). */
export type FieldValue = { kind: "text"; text: string } | { kind: "space" } | { kind: "arrow" };

/**
 * What came of a form: `completed`, a press that would have sent it; `stuck`, it never got there;
 * `not-tested`, voicecap didn't try to finish it, as `reason` says. A form tested empty, for a password
 * or a CAPTCHA, is `not-tested` with its press kept, since nothing says a person couldn't finish it.
 */
export type FormResult = "completed" | "stuck" | "not-tested";

export interface FormOutcome {
  form: FormInfo;
  result: FormResult;
  /** The field it stopped at, when it's one field's doing. */
  stoppedAt: FormField | null;
  /** Why it stopped short of completed; null for a form that's completed. */
  reason: string | null;
  /** Each press in turn: `axe` is null where the form's errors hadn't changed, so it wasn't checked. */
  presses: { state: FormState; spoken: string; axe: AxeCapture | null }[];
  /** What NVDA said at each field before any press. */
  firstWalk: FieldHeard[];
  /** The same after the last press that didn't end it; empty when no walk followed a press. */
  lastWalk: FieldHeard[];
}
