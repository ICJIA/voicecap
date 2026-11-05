import { describe, expect, it } from "vitest";

import {
  classifyForm,
  describeForm,
  formSignature,
  type RawField,
  type RawForm,
} from "../src/forms/classify.js";

// One case for each row of "Which forms" in the forms design.

function field(index: number, type: string, extra: Partial<RawField> = {}): RawField {
  return {
    index,
    name: null,
    type,
    required: false,
    tabIndex: 0,
    autocomplete: "",
    attribute: `f${index}`,
    ...extra,
  };
}

function form(extra: Partial<RawForm> = {}): RawForm {
  return {
    index: 0,
    frame: null,
    formless: false,
    action: "https://example.gov/send",
    actionSelf: false,
    method: "post",
    searchRole: false,
    submit: true,
    submitName: "Send",
    fields: [field(0, "email"), field(1, "text")],
    captcha: false,
    ...extra,
  };
}

describe("classifyForm", () => {
  it("tests a form with a submit control", () => {
    expect(classifyForm(form())).toBe("test");
  });

  it("skips a search form, by its role or by one text field and a GET", () => {
    expect(classifyForm(form({ searchRole: true }))).toBe("search");
    expect(classifyForm(form({ method: "get", fields: [field(0, "search")] }))).toBe("search");
    expect(classifyForm(form({ method: "get", fields: [field(0, "text")] }))).toBe("search");
  });

  it("tests a lone field that posts, or a GET with more than one field", () => {
    expect(classifyForm(form({ fields: [field(0, "text")] }))).toBe("test");
    expect(classifyForm(form({ fields: [field(0, "search")] }))).toBe("test");
    expect(classifyForm(form({ fields: [field(0, "email")] }))).toBe("test");
    expect(classifyForm(form({ method: "get", fields: [field(0, "email")] }))).toBe("test");
    expect(classifyForm(form({ method: "get" }))).toBe("test");
  });

  it("still tests a login, a card number, or a CAPTCHA, and says so", () => {
    const login = form({ fields: [field(0, "text"), field(1, "password")] });
    expect(classifyForm(login)).toBe("test");
    expect(describeForm(login).sensitive).toBe(true);
    const card = form({ fields: [field(0, "text", { autocomplete: "cc-number" })] });
    expect(describeForm(card).sensitive).toBe(true);
    const named = form({
      fields: [field(0, "text", { autocomplete: "section-a shipping cc-csc" })],
    });
    expect(describeForm(named).sensitive).toBe(true);
    expect(describeForm(form()).sensitive).toBe(false);
    const captcha = form({ captcha: true });
    expect(classifyForm(captcha)).toBe("test");
    expect(describeForm(captcha).captcha).toBe(true);
  });

  it("leaves a form in another site's frame, and names the site", () => {
    const framed = form({ frame: "docs.google.com", fields: [], submit: false, action: "" });
    expect(classifyForm(framed)).toBe("other-site");
    expect(describeForm(framed).site).toBe("docs.google.com");
    expect(describeForm(form()).site).toBeNull();
  });

  it("doesn't press a form that sends by anything but a web address", () => {
    expect(classifyForm(form({ action: "mailto:office@example.gov" }))).toBe("not-web");
    expect(classifyForm(form({ action: "javascript:void(0)" }))).toBe("not-web");
    expect(classifyForm(form({ action: "http://example.gov/send" }))).toBe("test");
  });

  it("lets not-web win over no-submit, and no-submit over search", () => {
    const mail = "mailto:office@example.gov";
    expect(classifyForm(form({ action: mail, submit: false }))).toBe("not-web");
    expect(classifyForm(form({ action: mail, formless: true }))).toBe("not-web");
    expect(classifyForm(form({ action: mail, searchRole: true }))).toBe("not-web");
    expect(classifyForm(form({ searchRole: true, submit: false }))).toBe("no-submit");
  });

  it("doesn't press a dialog form", () => {
    expect(classifyForm(form({ method: "dialog" }))).toBe("no-submit");
  });

  it("doesn't test fields with no form, or a form with no submit control", () => {
    expect(classifyForm(form({ formless: true }))).toBe("no-submit");
    expect(classifyForm(form({ submit: false }))).toBe("no-submit");
  });
});

describe("formSignature", () => {
  it("is the same for one form on two pages", () => {
    const here = form({ action: "https://example.gov/join?from=home", index: 2 });
    const there = form({ action: "https://example.gov/join?from=news", index: 5 });
    expect(formSignature(here)).toBe(formSignature(there));
  });

  it("differs for two forms: in fields, type, name, method, action, formless, or frame", () => {
    const base = formSignature(form());
    const other = (extra: Partial<RawForm>) => formSignature(form(extra));
    expect(other({ fields: [field(0, "email")] })).not.toBe(base);
    expect(other({ fields: [field(0, "tel"), field(1, "text")] })).not.toBe(base);
    expect(
      other({ fields: [field(0, "email", { attribute: "mail" }), field(1, "text")] }),
    ).not.toBe(base);
    expect(other({ method: "get" })).not.toBe(base);
    expect(other({ action: "https://example.gov/other" })).not.toBe(base);
    expect(other({ formless: true })).not.toBe(base);
    expect(other({ frame: "forms.gle", fields: [] })).not.toBe(base);
  });

  it("is the same for a form that sends to its own page, whichever page, and not for one that names it", () => {
    const a = form({ action: "https://example.gov/a", actionSelf: true });
    const b = form({ action: "https://example.gov/b", actionSelf: true });
    expect(formSignature(a)).toBe(formSignature(b));
    const named = form({ action: "https://example.gov/a" });
    expect(formSignature(named)).not.toBe(formSignature(a));
  });
});
