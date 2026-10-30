import type { AxeCapture, Speech } from "../../src/drivers/types.js";
import type { FieldValue, FormField, FormInfo, FormState } from "../../src/forms/types.js";
import { ScriptedDriver } from "./scripted-driver.js";

/** One field of the fake form. */
export interface FakeField {
  name: string;
  type?: string;
  required?: boolean;
  /** False for a field the keyboard can't fill: its value never takes. */
  takes?: boolean;
  /** False for a field Tab passes over. */
  tabbable?: boolean;
}

/** How the fake form behaves when pressed, by the rule a real page would have. */
export interface FakeForm {
  fields: FakeField[];
  kind?: FormInfo["kind"];
  sensitive?: boolean;
  captcha?: boolean;
  /** Why armFormGuard rejects; it doesn't when this is left out. */
  armError?: string;
  /**
   * What a press does:
   * - "native" (the default): Chrome's checks. An empty required field is `:invalid` from the load,
   *   and a press moves focus to the first of them and shows its bubble.
   * - "aria": the page's own script marks the empty fields with aria-invalid when pressed.
   * - "message": the page's script shows one alert, and marks no field.
   * - "nothing": the press does nothing.
   */
  validates?: "native" | "aria" | "message" | "nothing";
  /** A press empties every field, after it has been checked. */
  resets?: boolean;
  /** The form's in the page for this many presses. */
  goneAfter?: number;
  /** Text showing from the load, before any press. */
  hints?: string[];
  /** A request the page sends with a key of a fill, which the guard holds. */
  sendsOnFill?: boolean;
  /** A click beacon, or anything else that a press sends whether or not the form goes through. */
  sendsOnPress?: boolean;
  /** Text the page shows on being told its request failed. */
  afterHeld?: string;
  /** What checkFormWithAxe gives. */
  axe?: AxeCapture;
}

/** The driver side of the forms pass, over a form it models. `made` lists what the pass did. */
export class FakeFormDriver extends ScriptedDriver {
  readonly made: string[] = [];
  readonly fills: FieldValue[] = [];
  readonly settles: number[] = [];
  readonly info: FormInfo;
  private readonly filled = new Set<number>();
  /** A field's index, "submit", "out" (past the form), or null before anything is focused. */
  private focus: number | "submit" | "out" | null = null;
  private held = 0;
  private presses = 0;
  private marked: number[] = [];
  private shown: string[] = [];
  private live = false;
  private bubble: string | null = null;

  constructor(private readonly form: FakeForm) {
    super([]);
    this.info = {
      index: 0,
      signature: "fake",
      kind: form.kind ?? "test",
      site: form.kind === "other-site" ? "docs.google.com" : null,
      fields: form.fields.map(({ name, type, required }, index): FormField => ({
        index,
        name,
        type: type ?? "text",
        required: required ?? true,
      })),
      sensitive: form.sensitive ?? false,
      captcha: form.captcha ?? false,
    };
  }

  findForms(): Promise<FormInfo[]> {
    this.made.push("findForms");
    return Promise.resolve([this.info]);
  }

  armFormGuard(): Promise<void> {
    this.made.push("armFormGuard");
    return this.form.armError === undefined
      ? Promise.resolve()
      : Promise.reject(new Error(this.form.armError));
  }

  focusFormField(form: number, field: number): Promise<Speech> {
    this.made.push(`focusFormField ${form} ${field}`);
    this.focus = field;
    return Promise.resolve(this.speechAt(field));
  }

  override nextFocusable(): Promise<Speech> {
    this.made.push("nextFocusable");
    const stops = this.form.fields.flatMap((field, index) =>
      field.tabbable === false ? [] : [index],
    );
    const at = typeof this.focus === "number" ? stops.indexOf(this.focus) : -1;
    const next = stops[at + 1];
    if (this.focus === "submit" || this.focus === "out") this.focus = "out";
    else if (next === undefined) this.focus = "submit";
    else this.focus = next;
    if (typeof this.focus === "number") return Promise.resolve(this.speechAt(this.focus));
    return Promise.resolve(this.focus === "submit" ? "Send, button" : "");
  }

  override focusInDocument(): Promise<boolean> {
    return Promise.resolve(this.focus !== "out");
  }

  override focusedElement(): Promise<null> {
    return Promise.resolve(null);
  }

  pressSubmit(form: number, settleMs: number): Promise<Speech> {
    this.made.push(`pressSubmit ${form}`);
    this.settles.push(settleMs);
    this.presses += 1;
    this.focus = "submit";
    this.bubble = null;
    this.live = false;
    if (this.form.sendsOnPress) this.held += 1;
    const empty = this.emptyFields();
    switch (this.form.validates ?? "native") {
      case "native":
        if (empty[0] === undefined) break;
        this.focus = empty[0];
        this.bubble = "Please fill out this field.";
        break;
      case "aria":
        this.marked = empty;
        if (empty.length > 0) this.show("Fix the fields marked");
        break;
      case "message":
        if (empty.length > 0) this.show("Please complete the form");
        break;
      case "nothing":
        return Promise.resolve("");
    }
    if (empty.length === 0 && (this.form.validates ?? "native") !== "nothing") {
      this.held += 1;
      if (this.form.afterHeld !== undefined) this.show(this.form.afterHeld);
    }
    if (this.form.resets) this.filled.clear();
    return Promise.resolve(this.bubble ?? this.shown.at(-1) ?? "");
  }

  fillField(value: FieldValue): Promise<Speech> {
    this.made.push(`fillField ${String(this.focus)}`);
    this.fills.push(value);
    if (typeof this.focus === "number" && this.form.fields[this.focus]?.takes !== false) {
      this.filled.add(this.focus);
    }
    if (this.form.sendsOnFill) this.held += 1;
    return Promise.resolve("v");
  }

  formState(form: number): Promise<FormState> {
    this.made.push(`formState ${form}`);
    const live = this.live;
    this.live = false;
    const present = this.form.goneAfter === undefined || this.presses < this.form.goneAfter;
    const state: FormState = {
      focused: null,
      focusedField: null,
      focusedSubmit: false,
      invalid: [],
      messages: [],
      liveChanged: live,
      heldRequests: this.held,
      present,
      bubble: null,
    };
    if (!present) return Promise.resolve(state);
    const native = (this.form.validates ?? "native") === "native";
    return Promise.resolve({
      ...state,
      focusedField: typeof this.focus === "number" ? this.focus : null,
      focusedSubmit: this.focus === "submit",
      invalid: native ? this.emptyFields() : this.marked,
      messages: [...(this.form.hints ?? []), ...this.shown],
      // Chrome's message for the field that's focused, for as long as it stays invalid.
      bubble: typeof this.focus === "number" && !this.filled.has(this.focus) ? this.bubble : null,
    });
  }

  checkFormWithAxe(form: number): Promise<AxeCapture> {
    this.made.push(`checkFormWithAxe ${form}`);
    return Promise.resolve(this.form.axe ?? { error: "no axe here" });
  }

  /** How many times the pass did `call`, by the start of what `made` lists. */
  count(call: string): number {
    return this.made.filter((made) => made.startsWith(call)).length;
  }

  private emptyFields(): number[] {
    return this.info.fields.flatMap((field) =>
      field.required && !this.filled.has(field.index) ? [field.index] : [],
    );
  }

  private show(text: string): void {
    if (!this.shown.includes(text)) this.shown.push(text);
    this.live = true;
  }

  private speechAt(field: number): Speech {
    const { name, required } = this.info.fields[field]!;
    return `${name}, edit${required ? ", required" : ""}, blank`;
  }
}
