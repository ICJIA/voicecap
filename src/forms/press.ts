/**
 * What one press of a form's submit control did, read from the page's state: shared by the pass,
 * which decides what to do next from it, and the flag rules, which must read each press as the pass
 * did. `heldRequests` only counts up for the whole session, so a press is read against the count
 * just before it (kept with the press as `heldBefore`), never against zero.
 */
import { FORMS_DEFAULTS } from "../config/defaults.js";
import type { FormState, HeldRequest } from "./types.js";

/** What the page showed before any press: the fields invalid and the messages showing then. */
export interface PressBaseline {
  invalid: readonly number[];
  messages: readonly string[];
}

/**
 * What one press did, against the page before the first press and the count just before it.
 * `analyticsHosts` is the list the run counted as analytics (FormOutcome.analyticsHosts), voicecap's
 * own for a file from before voicecap kept it.
 */
export function readPress(
  baseline: PressBaseline,
  heldBefore: number,
  state: FormState,
  analyticsHosts: readonly string[] = FORMS_DEFAULTS.analyticsHosts,
) {
  const newInvalid = state.invalid.filter((field) => !baseline.invalid.includes(field));
  const newMessages = state.messages.filter((message) => !baseline.messages.includes(message));
  const wouldSend = sentByPress(heldBefore, state, analyticsHosts);
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

/** The methods that send something: a GET to another host only asks for something. */
const SENDING_METHODS = new Set(["POST", "PUT", "PATCH"]);

/**
 * What a form's script sends by: a fetch, an XHR, or a beacon ("ping"). A CSP report, a frame's
 * post, or anything else the page sends to another host is no sign of the form going.
 */
const SENDING_TYPES = new Set(["fetch", "xhr", "ping"]);

/**
 * Whether the guard held what the form would have sent, in this press: a navigation of the page, a
 * request of any kind to the page's own host or the form's action host, or a POST, PUT, or PATCH
 * by a fetch, an XHR, or a beacon (and no other kind of request) to any other host that isn't an analytics or tracking service's
 * (`analyticsHosts`, matched by the host or a host under it). A form that sends by script often
 * sends to an API on a host of its own. A GET to another host, and anything to an analytics host,
 * goes out on a press whether or not the form does, so it isn't one. A held request with no method
 * (a file from before voicecap kept it) counts only by its host. A state with no list of what was
 * held (a driver that can't say, or a file from before voicecap kept it) counts every held request.
 */
export function sentByPress(
  heldBefore: number,
  state: FormState,
  analyticsHosts: readonly string[] = FORMS_DEFAULTS.analyticsHosts,
): boolean {
  if (state.held === undefined) return state.heldRequests > heldBefore;
  return state.held.slice(heldBefore).some((request) => sendsForm(request, state, analyticsHosts));
}

/** Whether one held request is the form's own sending (see sentByPress). */
export function sendsForm(
  request: HeldRequest,
  state: Pick<FormState, "pageHost" | "actionHost">,
  analyticsHosts: readonly string[] = FORMS_DEFAULTS.analyticsHosts,
): boolean {
  if (request.type === "navigation") return true;
  const host = request.host.toLowerCase();
  if (state.pageHost !== undefined && host === state.pageHost.toLowerCase()) return true;
  if (typeof state.actionHost === "string" && host === state.actionHost.toLowerCase()) return true;
  return (
    SENDING_TYPES.has(request.type) &&
    typeof request.method === "string" &&
    SENDING_METHODS.has(request.method.toUpperCase()) &&
    host !== "" &&
    !isAnalyticsHost(host, analyticsHosts)
  );
}

/** Whether a host is one of the list's, or a host under one: `www.google-analytics.com` is. */
export function isAnalyticsHost(host: string, analyticsHosts: readonly string[]): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return analyticsHosts.some((listed) => {
    const entry = listed.toLowerCase();
    return name === entry || name.endsWith(`.${entry}`);
  });
}
