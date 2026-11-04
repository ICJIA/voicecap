/**
 * What one press of a form's submit control did, read from the page's state: shared by the pass,
 * which decides what to do next from it, and the flag rules, which must read each press as the pass
 * did. `heldRequests` only counts up for the whole session, so a press is read against the count
 * just before it (kept with the press as `heldBefore`), never against zero.
 */
import type { FormState } from "./types.js";

/** What the page showed before any press: the fields invalid and the messages showing then. */
export interface PressBaseline {
  invalid: readonly number[];
  messages: readonly string[];
}

/** What one press did, against the page before the first press and the count just before it. */
export function readPress(baseline: PressBaseline, heldBefore: number, state: FormState) {
  const newInvalid = state.invalid.filter((field) => !baseline.invalid.includes(field));
  const newMessages = state.messages.filter((message) => !baseline.messages.includes(message));
  const wouldSend = state.heldRequests > heldBefore;
  return {
    newInvalid,
    newMessages,
    wouldSend,
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
