/**
 * Finding a page's forms, and reading one after a press, through the DevTools connection. The page
 * is read in an isolated world of voicecap's own, on the main frame: it shares the page's document
 * but not its scripts' globals, so a page can't change what the scan sees by redefining the
 * built-ins it uses. The scan moves no focus, scrolls nothing, clicks nothing, and adds no element.
 *
 * The world keeps the forms it found, so a later read asks after the same form, and a mutation
 * observer in it notes the text added since the scan, and whether a live region changed since the last read. A navigation ends the world, and every
 * form in it is then gone.
 */
import type { CDPSession } from "playwright";

import { describeForm, type RawForm } from "../../forms/classify.js";
import type { FormInfo, FormState } from "../../forms/types.js";

/** The isolated world the forms are read in. */
const FORMS_WORLD = "voicecap-forms";

/** Marks the objects the scan hands out, so they're released together. */
const OBJECT_GROUP = "voicecap-forms";

/**
 * Where another site's forms live, as host and path: Google Forms, Microsoft Forms, and the like.
 * A page's frame on one of these holds a form that voicecap can't see into.
 */
const FORM_SITES =
  "^(?:docs\\.google\\.com/forms|forms\\.gle/|forms\\.office\\.com/|forms\\.microsoft\\.com/|[^/]*\\.typeform\\.com/|[^/]*\\.jotform\\.com/|[^/]*\\.surveymonkey\\.com/)";

/**
 * The scan, as an expression for the world. It defines `voicecapFormState` there, for the reads that
 * follow, and answers an object of `json` (each form as the page's DOM showed it) and `elements`
 * (every field in it, form by form, which voicecap names through the accessibility tree).
 */
const SCAN = `(() => {
  const world = globalThis;
  const getAttribute = (element, name) => Element.prototype.getAttribute.call(element, name);
  // A form's own properties can be hidden by a field named "action" or "elements".
  const own = (element, name) =>
    Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, name).get.call(element);
  const visible = (element) =>
    element.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
  const LIVE = '[role="alert"], [role="status"], [role="log"], [aria-live]:not([aria-live="off"])';
  // Outside the form, only a page's alerts and status messages count as the form's.
  const PAGE_LEVEL = '[role="alert"], [role="status"]';
  const NOT_FIELDS = /^(?:hidden|submit|image|button|reset)$/;
  const CAPTCHA = [
    ".g-recaptcha", ".h-captcha", ".cf-turnstile", "[data-sitekey]",
    'iframe[src*="recaptcha" i]', 'iframe[src*="hcaptcha" i]', 'iframe[src*="turnstile" i]',
    '[class*="captcha" i]', '[id*="captcha" i]', '[name*="captcha" i]',
  ].join(",");
  const text = (value) => (value || "").replace(/\\s+/g, " ").trim().slice(0, 300);

  const isField = (element) => {
    const tag = element.localName;
    if (tag !== "input" && tag !== "select" && tag !== "textarea") return false;
    return !NOT_FIELDS.test(element.type) && !element.disabled && visible(element);
  };
  // The form a button or input belongs to: one inside it, or one elsewhere that names it by form="id".
  const formOf = (element) =>
    Object.getOwnPropertyDescriptor(
      element.localName === "button" ? HTMLButtonElement.prototype : HTMLInputElement.prototype,
      "form",
    ).get.call(element);
  // Every submit control of a form, an image button too, hidden or disabled or not: the one list
  // that decides whether the form can be pressed, and where it sends. (form.elements leaves out
  // image buttons.)
  const submitsOf = (form) =>
    Array.from(document.querySelectorAll("button, input")).filter(
      (element) => (element.type === "submit" || element.type === "image") && formOf(element) === form,
    );
  const canPress = (element) => !element.disabled && visible(element);
  // A radio group is one stop for Tab, so one field.
  const fieldsOf = (controls) => {
    const seen = new Set();
    return controls.filter(isField).filter((element) => {
      if (element.type !== "radio" || !element.name) return true;
      const key = (element.form ? "in:" : "out:") + element.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const requiredBy = (element, controls) => {
    if (element.required || getAttribute(element, "aria-required") === "true") return true;
    if (element.type !== "radio" && element.type !== "checkbox") return false;
    if (element.type === "radio" && element.name) {
      const group = controls.filter((other) => other.type === "radio" && other.name === element.name);
      if (group.some((other) => other.required)) return true;
    }
    const around = element.closest('[role="group"], [role="radiogroup"], fieldset');
    return around !== null && getAttribute(around, "aria-required") === "true";
  };

  // A submit button's formaction replaces the form's action for that button; a non-web one wins.
  const actionOf = (form, submits) => {
    for (const control of submits) {
      const formaction = getAttribute(control, "formaction");
      if (!formaction) continue;
      try {
        const address = new URL(formaction, document.baseURI);
        if (!/^https?:$/.test(address.protocol)) return address.href;
      } catch {
        return formaction;
      }
    }
    return String(own(form, "action"));
  };

  const entries = [];
  for (const form of document.forms) {
    const controls = Array.from(own(form, "elements"));
    const fields = fieldsOf(controls);
    if (!visible(form) && fields.length === 0) continue;
    entries.push({ form, controls, fields, submits: submitsOf(form) });
  }
  const loose = Array.from(document.querySelectorAll("input, select, textarea")).filter((element) => !element.form);
  const looseFields = fieldsOf(loose);
  if (looseFields.length > 0) entries.push({ form: null, controls: loose, fields: looseFields, submits: [] });

  const raws = entries.map(({ form, controls, fields, submits }, index) => ({
    index,
    frame: null,
    formless: form === null,
    action: form === null ? document.URL : actionOf(form, submits),
    actionSelf: form === null || !getAttribute(form, "action"),
    method: form === null ? "get" : String(own(form, "method")),
    searchRole: form !== null && form.closest('[role="search"], search') !== null,
    submit: form !== null && submits.some(canPress),
    fields: fields.map((element, at) => ({
      index: at,
      name: null,
      type: element.type,
      required: requiredBy(element, controls),
      autocomplete: getAttribute(element, "autocomplete") || "",
      attribute: getAttribute(element, "name") || "",
    })),
    captcha: form !== null && form.querySelector(CAPTCHA) !== null,
  }));

  const sites = new RegExp(${JSON.stringify(FORM_SITES)}, "i");
  const hosts = new Set();
  for (const frame of document.querySelectorAll("iframe[src]")) {
    let address;
    try {
      address = new URL(frame.src, document.baseURI);
    } catch {
      continue;
    }
    if (address.origin === location.origin || !/^https?:$/.test(address.protocol)) continue;
    if (!sites.test(address.host + address.pathname) || hosts.has(address.host)) continue;
    hosts.add(address.host);
    raws.push({
      index: raws.length, frame: address.host, formless: false, action: "", actionSelf: true,
      method: "get", searchRole: false, submit: false, fields: [], captcha: false,
    });
  }

  // What the world remembers for the reads that follow: the forms, and what changed in the page.
  const changes = world.voicecapChanges ?? { live: false, added: [], watching: false };
  changes.live = false;
  changes.added = [];
  if (!changes.watching) {
    changes.watching = true;
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (target && target.closest(LIVE)) changes.live = true;
        if (record.type === "characterData") changes.added.push(record.target);
        else changes.added.push(...record.addedNodes);
      }
      // Only the latest are kept, so a busy page can't grow the list without end.
      changes.added = changes.added.slice(-200);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }
  world.voicecapChanges = changes;
  world.voicecapForms = entries;

  world.voicecapFormState = (form) => {
    const entry = world.voicecapForms[form];
    const present = entry !== undefined &&
      (entry.form !== null ? entry.form.isConnected : entry.fields.some((field) => field.isConnected));
    const now = world.voicecapChanges;
    const read = { invalid: [], messages: [], liveChanged: now.live, present, bubble: null };
    const added = now.added;
    now.live = false;
    if (!present) return read;

    const root = entry.form ?? document.body;
    const messages = new Set();
    const say = (value) => {
      const shown = text(value);
      if (shown) messages.add(shown);
    };
    entry.fields.forEach((field, at) => {
      if (field.isConnected && (field.matches(":invalid") || getAttribute(field, "aria-invalid") === "true")) {
        read.invalid.push(at);
        const names = (getAttribute(field, "aria-describedby") || "") + " " + (getAttribute(field, "aria-errormessage") || "");
        for (const id of names.split(/\\s+/)) {
          const target = id ? document.getElementById(id) : null;
          if (target && visible(target)) say(target.textContent);
        }
      }
    });
    for (const region of document.querySelectorAll(LIVE)) {
      const counts = root.contains(region) || region.matches(PAGE_LEVEL);
      if (counts && visible(region)) say(region.textContent);
    }
    for (const node of added) {
      const parent = node.nodeType === 1 ? node : node.parentElement;
      if (node.isConnected && root.contains(node) && parent && visible(parent)) say(node.textContent);
    }
    read.messages = Array.from(messages);

    const focus = document.activeElement;
    const ours = (focus) =>
      entry.fields.includes(focus) ||
      (focus.type === "radio" && focus.name !== "" &&
        entry.fields.some((field) => field.type === "radio" && field.name === focus.name && field.form === focus.form));
    if (focus && ours(focus) && focus.willValidate && !focus.validity.valid) {
      read.bubble = focus.validationMessage || null;
    }
    return read;
  };

  const elements = entries.flatMap((entry) => entry.fields);
  return { json: JSON.stringify(raws), elements };
})()`;

interface AxValue {
  value?: unknown;
}

interface RemoteProperty {
  name: string;
  value?: { value?: unknown; objectId?: string };
}

/** The scan's answer, without the part the session adds. */
export type FormStateRead = Omit<FormState, "focused" | "heldRequests">;

/**
 * Every form the page shows, sorted. The world the forms are held in is made new each time, and its
 * context id is returned for the reads that follow.
 */
export async function scanForms(
  cdp: CDPSession,
  frameId: string,
): Promise<{ forms: FormInfo[]; contextId: number }> {
  const { executionContextId: contextId } = await cdp.send("Page.createIsolatedWorld", {
    frameId,
    worldName: FORMS_WORLD,
  });
  try {
    const scanned = await cdp.send("Runtime.evaluate", {
      expression: SCAN,
      contextId,
      objectGroup: OBJECT_GROUP,
    });
    if (scanned.exceptionDetails) {
      const { text, exception } = scanned.exceptionDetails;
      throw new Error(exception?.description || text);
    }
    const properties = await propertiesOf(cdp, scanned.result.objectId);
    const json = properties.find((property) => property.name === "json")?.value?.value;
    const list = properties.find((property) => property.name === "elements")?.value?.objectId;
    if (typeof json !== "string") throw new Error("The forms on the page couldn't be read.");
    const raws = JSON.parse(json) as RawForm[];
    const names = await namesOf(cdp, list);
    let next = 0;
    for (const raw of raws) {
      for (const field of raw.fields) field.name = names[next++] ?? null;
    }
    return { forms: raws.map(describeForm), contextId };
  } finally {
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup: OBJECT_GROUP }).catch(() => {});
  }
}

/**
 * What the form at `form` shows now. A page that has navigated since the scan, and a form the scan
 * never found, are both a form that isn't there.
 */
export async function readFormState(
  cdp: CDPSession,
  contextId: number | null,
  form: number,
): Promise<FormStateRead> {
  const gone: FormStateRead = {
    invalid: [],
    messages: [],
    liveChanged: false,
    present: false,
    bubble: null,
  };
  if (contextId === null) return gone;
  try {
    const read = await cdp.send("Runtime.evaluate", {
      expression: `voicecapFormState(${JSON.stringify(form)})`,
      contextId,
      returnByValue: true,
    });
    if (read.exceptionDetails) return gone;
    return read.result.value as FormStateRead;
  } catch {
    // The world went with the page it was made for.
    return gone;
  }
}

async function propertiesOf(
  cdp: CDPSession,
  objectId: string | undefined,
): Promise<RemoteProperty[]> {
  if (!objectId) return [];
  const { result } = await cdp.send("Runtime.getProperties", { objectId, ownProperties: true });
  return result;
}

/** Each field's accessible name, as the browser computes it, in the list's order; null for none. */
async function namesOf(cdp: CDPSession, listId: string | undefined): Promise<Array<string | null>> {
  const items = (await propertiesOf(cdp, listId)).filter((property) => /^\d+$/.test(property.name));
  const names: Array<string | null> = [];
  for (const item of items) {
    const objectId = item.value?.objectId;
    if (!objectId) {
      names.push(null);
      continue;
    }
    const { nodes } = await cdp.send("Accessibility.getPartialAXTree", {
      objectId,
      fetchRelatives: false,
    });
    const node = nodes.find((candidate) => !candidate.ignored) ?? nodes[0];
    const name = (node?.name as AxValue | undefined)?.value;
    const trimmed = typeof name === "string" ? name.trim() : "";
    names.push(trimmed === "" ? null : trimmed);
  }
  return names;
}
