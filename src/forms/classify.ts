/**
 * Sorting the forms the browser scan found: the pure half, which takes what the page's DOM said and
 * decides what voicecap does with each form (see "Which forms" in the forms design).
 */
import { createHash } from "node:crypto";

import type { FormField, FormInfo, FormKind } from "./types.js";

export interface RawField extends FormField {
  /** The `autocomplete` attribute, as written. */
  autocomplete: string;
  /** The `name` attribute, which the signature uses: the accessible name can change with a page's text. */
  attribute: string;
}

/** One form as the page's DOM showed it. */
export interface RawForm {
  index: number;
  /** The host of the other site's frame this form is in; its fields can't be seen. Otherwise null. */
  frame: string | null;
  /** Fields with no `<form>` around them, gathered as one. */
  formless: boolean;
  /** The form's action as the browser resolves it: an empty one is the page's own address. */
  action: string;
  /** Whether the action attribute is empty or missing. */
  actionSelf: boolean;
  method: string;
  /** `role="search"` on the form or an element around it. */
  searchRole: boolean;
  /** A submit button or image button that is visible and enabled. */
  submit: boolean;
  fields: RawField[];
  captcha: boolean;
}

/** What the form does when pressed, and so whether voicecap may press it. */
export function classifyForm(raw: RawForm): FormKind {
  if (raw.frame !== null) return "other-site";
  if (!/^https?:/i.test(raw.action)) return "not-web";
  if (raw.formless || !raw.submit) return "no-submit";
  if (raw.searchRole) return "search";
  const [only] = raw.fields;
  if (
    raw.fields.length === 1 &&
    raw.method === "get" &&
    (only?.type === "search" || only?.type === "text")
  ) {
    return "search";
  }
  return "test";
}

/** A password or a card number (`autocomplete="cc-number"`, `cc-csc`, and the rest). */
function isSensitive(field: RawField): boolean {
  return field.type === "password" || /(?:^|\s)cc-/i.test(field.autocomplete);
}

/** The address without its query or fragment, which a page can change without changing the form. */
function withoutQuery(address: string): string {
  return address.replace(/[?#].*$/, "");
}

/**
 * Made of what the form is, not of where it was found: its action (none, for a form that sends to
 * its own page), its method, and each field's type and name. The same footer sign-up on two pages
 * has one signature; a form with other fields has another.
 */
export function formSignature(raw: RawForm): string {
  const parts =
    raw.frame !== null
      ? ["frame", raw.frame]
      : [
          raw.formless ? "formless" : "form",
          raw.method,
          raw.actionSelf ? "" : withoutQuery(raw.action),
          ...raw.fields.map((field) => `${field.type}:${field.attribute}`),
        ];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

export function describeForm(raw: RawForm): FormInfo {
  return {
    index: raw.index,
    signature: formSignature(raw),
    kind: classifyForm(raw),
    site: raw.frame,
    fields: raw.fields.map(({ index, name, type, required }) => ({ index, name, type, required })),
    sensitive: raw.fields.some(isSensitive),
    captcha: raw.captcha,
  };
}
