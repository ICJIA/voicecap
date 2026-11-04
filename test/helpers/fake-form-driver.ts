import type { AxeCapture, Speech } from "../../src/drivers/types.js";
import type {
  FieldValue,
  FormField,
  FormInfo,
  FormState,
  HeldRequest,
  PageDialog,
} from "../../src/forms/types.js";
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
  /** Its tabIndex, 0 by default. Below 0, Tab passes over it too. */
  tabIndex?: number;
}

/** How the fake form behaves when pressed, by the rule a real page would have. */
export interface FakeForm {
  fields: FakeField[];
  kind?: FormInfo["kind"];
  sensitive?: boolean;
  captcha?: boolean;
  /** Why armFormGuard rejects; it doesn't when this is left out. */
  armError?: string;
  /** armFormGuard never answers, as a hung gate wouldn't. */
  armHangs?: boolean;
  /** The submit control has a negative tabindex: Tab goes past it, out of the page. */
  submitUntabbable?: boolean;
  /** After this many Tabs in all, the next leaves the page. */
  tabsUntilOut?: number;
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
  /** The page's script refuses the form whatever is in it, and sends nothing. */
  neverSends?: boolean;
  /** Errors show as focus leaves a field, by the rule of `validates: "aria"`. */
  onBlur?: boolean;
  /** The form's in the page for this many presses. */
  goneAfter?: number;
  /** Text showing from the load, before any press. */
  hints?: string[];
  /** A request the page sends with a key of a fill, which the guard holds. */
  sendsOnFill?: boolean;
  /** A click beacon, or anything else that a press sends whether or not the form goes through. */
  sendsOnPress?: boolean;
  /** A native form that blocks a press with no bubble: its fields are `:invalid`, and nothing shows. */
  noBubble?: boolean;
  /** Chrome's message showing whatever the fields say, as `bubble` can with no field invalid. */
  strayBubble?: string;
  /**
   * With `validates: "aria"`: the page moves focus to the first field it marks, and each marked field
   * says it's invalid and what's wrong ("Name is required"), by aria-describedby.
   */
  linksErrors?: boolean;
  /** Text the page shows on being told its request failed. */
  afterHeld?: string;
  /** What checkFormWithAxe gives. */
  axe?: AxeCapture;
  /**
   * How the form itself sends, as the guard holds it: a navigation, or a fetch to the page's own
   * host. Set (or `beaconHost` set), the fake says what it held, and the page's and action's hosts.
   */
  sendsBy?: "navigation" | "fetch";
  /** The host a request sent by a fill or a press beacon goes to; the page's own when left out. */
  beaconHost?: string;
  /** The JavaScript dialog a press opens (the page's alert, say), which voicecap dismisses. */
  dialogOnPress?: PageDialog;
}

/** The page's own host, and the form's action host, for a fake that says what it held. */
export const FAKE_HOST = "example.illinois.gov";

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
  private readonly heldList: HeldRequest[] = [];
  private readonly dialogs: PageDialog[] = [];
  private tabs = 0;
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
      fields: form.fields.map(({ name, type, required, tabIndex }, index): FormField => ({
        index,
        name,
        type: type ?? "text",
        required: required ?? true,
        tabIndex: tabIndex ?? 0,
      })),
      submitName: "Send",
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
    if (this.form.armHangs) return new Promise(() => {});
    return this.form.armError === undefined
      ? Promise.resolve()
      : Promise.reject(new Error(this.form.armError));
  }

  focusFormField(form: number, field: number): Promise<Speech> {
    // The real driver moves focus off a field that has it before focusing it, so it's announced.
    if (this.focus === field) this.made.push(`refocus ${field}`);
    this.made.push(`focusFormField ${form} ${field}`);
    this.focus = field;
    return Promise.resolve(this.speechAt(field));
  }

  override nextFocusable(): Promise<Speech> {
    this.made.push("nextFocusable");
    const stops = this.form.fields.flatMap((field, index) =>
      field.tabbable === false || (field.tabIndex ?? 0) < 0 ? [] : [index],
    );
    this.tabs += 1;
    if (this.form.onBlur) this.markEmpty();
    const at = typeof this.focus === "number" ? stops.indexOf(this.focus) : -1;
    const next = stops[at + 1];
    const leaves = this.form.tabsUntilOut !== undefined && this.tabs > this.form.tabsUntilOut;
    if (leaves || this.focus === "submit" || this.focus === "out") this.focus = "out";
    else if (next === undefined) this.focus = this.form.submitUntabbable ? "out" : "submit";
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
    // The driver presses what has focus: a press from anywhere else is the pass's mistake.
    if (this.focus !== "submit") throw new Error("pressSubmit with focus off the submit control");
    this.made.push(`pressSubmit ${form}`);
    this.settles.push(settleMs);
    this.presses += 1;
    this.focus = "submit";
    this.bubble = null;
    this.live = false;
    if (this.form.dialogOnPress !== undefined) {
      this.dialogs.push(this.form.dialogOnPress);
      return Promise.resolve(this.form.dialogOnPress.message);
    }
    if (this.form.sendsOnPress) {
      this.hold("ping", this.form.beaconHost);
      if (this.form.afterHeld !== undefined) this.show(this.form.afterHeld);
    }
    const empty = this.emptyFields();
    switch (this.form.validates ?? "native") {
      case "native":
        if (empty[0] === undefined || this.form.noBubble) break;
        this.focus = empty[0];
        this.bubble = "Please fill out this field.";
        break;
      case "aria":
        this.markEmpty();
        if (this.form.linksErrors && this.marked[0] !== undefined) this.focus = this.marked[0];
        break;
      case "message":
        if (empty.length > 0) this.show("Please complete the form");
        break;
      case "nothing":
        return Promise.resolve("");
    }
    if (this.form.neverSends) {
      this.show("Please complete the form");
    } else if (empty.length === 0 && (this.form.validates ?? "native") !== "nothing") {
      this.hold(
        this.form.sendsBy ?? "fetch",
        this.form.sendsBy === "navigation" ? "elsewhere.example" : FAKE_HOST,
      );
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
    if (this.form.sendsOnFill) this.hold("xhr", this.form.beaconHost);
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
      emptyRequired: [],
      messages: [],
      liveChanged: live,
      heldRequests: this.held,
      ...(this.form.sendsBy !== undefined || this.form.beaconHost !== undefined
        ? { held: [...this.heldList], pageHost: FAKE_HOST, actionHost: FAKE_HOST }
        : {}),
      ...(this.form.dialogOnPress !== undefined ? { dialogs: [...this.dialogs] } : {}),
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
      emptyRequired: this.emptyFields(),
      messages: [...(this.form.hints ?? []), ...this.shown],
      // Chrome's message for the field that's focused, for as long as it stays invalid.
      bubble:
        this.form.strayBubble ??
        (typeof this.focus === "number" && !this.filled.has(this.focus) ? this.bubble : null),
    });
  }

  /** A request the guard holds: counted, and listed with where it was going. */
  private hold(type: string, host: string = FAKE_HOST): void {
    this.held += 1;
    this.heldList.push({ host, type });
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

  private markEmpty(): void {
    this.marked = this.emptyFields();
    if (this.marked.length > 0) this.show("Fix the fields marked");
  }

  private show(text: string): void {
    if (this.shown.includes(text)) return;
    this.shown.push(text);
    this.live = true;
  }

  private speechAt(field: number): Speech {
    const { name, required } = this.info.fields[field]!;
    const error =
      this.form.linksErrors && this.marked.includes(field) && !this.filled.has(field)
        ? `, invalid entry, ${name} is required`
        : "";
    return `${name}, edit${required ? ", required" : ""}${error}, blank`;
  }
}
