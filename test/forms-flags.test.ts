/**
 * The forms pass's flags: six hints for a person, raised from what a form's test found. Each is a
 * hint, never a verdict; axe's findings never raise one; and no flag changes the exit code.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { evaluateFlags, flagQuotes } from "../src/flags/evaluate.js";
import { RULE_WCAG, wcagOf } from "../src/flags/wcag.js";
import { keptFormsResults, readFormsResults } from "../src/forms/result-file.js";
import { OUT_OF_STEPS } from "../src/passes/forms.js";
import type { FormField, FormInfo, FormOutcome, FormState } from "../src/forms/types.js";
import type { FlagResult } from "../src/model.js";
import { attentionCards, type AttentionPage } from "../src/share/attention.js";
import { attentionWords } from "../src/share/attention-words.js";

const rules = DEFAULT_CONFIG.flags;

function field(index: number, name: string, overrides: Partial<FormField> = {}): FormField {
  return { index, name, type: "text", required: true, tabIndex: 0, ...overrides };
}

const FIELDS = [field(0, "Name"), field(1, "Email", { type: "email" })];

function formOf(fields: FormField[] = FIELDS): FormInfo {
  return {
    index: 0,
    signature: "sig",
    kind: "test",
    site: null,
    fields,
    submitName: "Send",
    sensitive: false,
    captcha: false,
  };
}

function stateOf(overrides: Partial<FormState> = {}): FormState {
  return {
    focused: null,
    focusedField: null,
    focusedSubmit: true,
    invalid: [],
    emptyRequired: [],
    messages: [],
    liveChanged: false,
    heldRequests: 0,
    present: true,
    bubble: null,
    ...overrides,
  };
}

function outcomeOf(overrides: Partial<FormOutcome> = {}): FormOutcome {
  return {
    form: formOf(),
    result: "completed",
    stoppedAt: null,
    reason: null,
    baseline: { invalid: [], messages: [] },
    presses: [],
    firstWalk: [
      { field: 0, spoken: "Name, edit, required, blank", required: true },
      { field: 1, spoken: "Email, edit, required, blank", required: true },
    ],
    errorWalk: [],
    lastWalk: [],
    ...overrides,
  };
}

function flagsOf(...outcomes: FormOutcome[]): FlagResult[] {
  return evaluateFlags(
    { forms: { steps: [], stopReason: "forms-done", forms: outcomes } },
    rules,
  ).filter((flag) => flag.pass === "forms");
}

const ruleIds = (flags: FlagResult[]): string[] => flags.map((flag) => flag.rule);

/** A form whose first press showed an error on Name, in a message and an invalid field. */
function pressedEmpty(spoken: string, extra: Partial<FormState> = {}): FormOutcome {
  return outcomeOf({
    result: "stuck",
    reason: "it was filled by keyboard, and the form didn't take it",
    presses: [
      {
        state: stateOf({
          invalid: [0],
          emptyRequired: [0, 1],
          messages: ["Name is required"],
          ...extra,
        }),
        spoken,
        axe: null,
      },
    ],
    errorWalk: [
      { field: 0, spoken: "Name, edit, required, invalid entry, Name is required", required: true },
      { field: 1, spoken: "Email, edit, required, blank", required: true },
    ],
  });
}

describe("form-error-silent", () => {
  it("is raised when a message and an invalid field appeared and NVDA said none of it", () => {
    const flags = flagsOf(pressedEmpty("Send, button"));
    expect(ruleIds(flags)).toContain("form-error-silent");
    expect(flags.find((flag) => flag.rule === "form-error-silent")?.pass).toBe("forms");
  });

  it("is not raised when NVDA said the message", () => {
    expect(ruleIds(flagsOf(pressedEmpty("alert, Name is required")))).not.toContain(
      "form-error-silent",
    );
  });

  it("is not raised when NVDA said the field was invalid", () => {
    expect(ruleIds(flagsOf(pressedEmpty("Name, edit, invalid entry")))).not.toContain(
      "form-error-silent",
    );
  });

  it("is not raised for a native bubble NVDA spoke", () => {
    const outcome = outcomeOf({
      result: "stuck",
      presses: [
        {
          state: stateOf({ invalid: [0], focusedField: 0, bubble: "Please fill out this field." }),
          spoken: "Please fill out this field.",
          axe: null,
        },
      ],
    });
    expect(ruleIds(flagsOf(outcome))).not.toContain("form-error-silent");
  });

  it("is raised for a native bubble NVDA never spoke", () => {
    const outcome = outcomeOf({
      result: "stuck",
      presses: [
        {
          state: stateOf({ invalid: [0], focusedField: 0, bubble: "Please fill out this field." }),
          spoken: "Name, edit",
          axe: null,
        },
      ],
    });
    expect(ruleIds(flagsOf(outcome))).toContain("form-error-silent");
  });

  it("does not count a message that came only after a request was held", () => {
    const outcome = outcomeOf({
      presses: [
        {
          state: stateOf({ heldRequests: 1, messages: ["Network error, try again"] }),
          spoken: "",
          axe: null,
        },
      ],
    });
    expect(ruleIds(flagsOf(outcome))).toEqual([]);
  });

  it("does not count a message that was there before any press", () => {
    const outcome = outcomeOf({
      result: "stuck",
      baseline: { invalid: [], messages: ["All fields are required"] },
      presses: [
        {
          state: stateOf({ messages: ["All fields are required"], liveChanged: true }),
          spoken: "",
          axe: null,
        },
      ],
    });
    expect(ruleIds(flagsOf(outcome))).not.toContain("form-error-silent");
  });
});

describe("form-no-feedback", () => {
  const nothing = outcomeOf({
    result: "stuck",
    reason: "pressing submit changed nothing",
    presses: [{ state: stateOf(), spoken: "", axe: null }],
  });

  it("is raised when pressing changed nothing and no request was held", () => {
    expect(ruleIds(flagsOf(nothing))).toContain("form-no-feedback");
  });

  it("is not raised when a request was held", () => {
    const sent = outcomeOf({
      presses: [{ state: stateOf({ heldRequests: 1 }), spoken: "", axe: null }],
    });
    expect(flagsOf(sent)).toEqual([]);
  });

  it("is not raised when a field turned invalid", () => {
    const outcome = outcomeOf({
      result: "stuck",
      presses: [{ state: stateOf({ invalid: [0] }), spoken: "invalid entry", axe: null }],
    });
    expect(ruleIds(flagsOf(outcome))).not.toContain("form-no-feedback");
  });
});

describe("form-error-unlinked", () => {
  it("is raised when an invalid field said no more after the press than before it", () => {
    const outcome = pressedEmpty("alert, Name is required");
    outcome.firstWalk[0]!.spoken = "Name, edit, required, invalid entry";
    outcome.errorWalk[0]!.spoken = "Name, edit, required, invalid entry";
    const flags = flagsOf(outcome);
    expect(ruleIds(flags)).toContain("form-error-unlinked");
    expect(flags.find((flag) => flag.rule === "form-error-unlinked")?.message).toContain("Name");
  });

  it("is not raised when the field began to say it is invalid", () => {
    expect(ruleIds(flagsOf(pressedEmpty("alert, Name is required")))).not.toContain(
      "form-error-unlinked",
    );
  });

  it("is not raised when the field says the error's own words", () => {
    const outcome = pressedEmpty("alert, Name is required");
    outcome.firstWalk[0]!.spoken = "Name, edit, required, invalid entry";
    outcome.errorWalk[0]!.spoken = "Name, edit, required, invalid entry, Name is required";
    expect(ruleIds(flagsOf(outcome))).not.toContain("form-error-unlinked");
  });

  it("is not raised when no walk followed the press", () => {
    const outcome = pressedEmpty("alert, Name is required");
    outcome.errorWalk = [];
    expect(ruleIds(flagsOf(outcome))).not.toContain("form-error-unlinked");
  });
});

describe("form-required-unsaid", () => {
  it("is raised when a field that blocked the form didn't say required on the first walk", () => {
    const outcome = pressedEmpty("alert, Name is required");
    outcome.firstWalk[0]!.spoken = "Name, edit, blank";
    const flags = flagsOf(outcome);
    expect(ruleIds(flags)).toContain("form-required-unsaid");
    expect(flags.find((flag) => flag.rule === "form-required-unsaid")?.message).toContain("Name");
  });

  it("is not raised when every blocking field said required", () => {
    expect(ruleIds(flagsOf(pressedEmpty("alert, Name is required")))).not.toContain(
      "form-required-unsaid",
    );
  });

  it("is not raised for a field Tab never reached: that is another flag's", () => {
    const outcome = pressedEmpty("alert, Name is required");
    outcome.firstWalk = outcome.firstWalk.filter((heard) => heard.field !== 0);
    expect(ruleIds(flagsOf(outcome))).not.toContain("form-required-unsaid");
  });
});

describe("form-cant-finish", () => {
  it("is raised for a form that got stuck", () => {
    const outcome = outcomeOf({
      result: "stuck",
      reason: "it was filled by keyboard, and the form didn't take it",
      stoppedAt: FIELDS[1]!,
      presses: [{ state: stateOf({ invalid: [1] }), spoken: "invalid entry", axe: null }],
    });
    const flags = flagsOf(outcome);
    expect(ruleIds(flags)).toContain("form-cant-finish");
    expect(flags.find((flag) => flag.rule === "form-cant-finish")?.message).toContain("Email");
  });

  it("is not raised for a completed form, or one voicecap can't speak for", () => {
    const sent = outcomeOf({
      presses: [{ state: stateOf({ heldRequests: 1 }), spoken: "", axe: null }],
    });
    const untested = outcomeOf({ result: "not-tested", reason: "tested empty", presses: [] });
    expect(flagsOf(sent, untested)).toEqual([]);
  });
});

describe("form-field-unreachable", () => {
  it("is raised when a stop was a field Tab never reached", () => {
    const outcome = outcomeOf({
      result: "stuck",
      reason: "Tab never reached it",
      stoppedAt: FIELDS[1]!,
      firstWalk: [{ field: 0, spoken: "Name, edit, required", required: true }],
      presses: [{ state: stateOf({ heldRequests: 1 }), spoken: "", axe: null }],
    });
    const flags = flagsOf(outcome);
    expect(ruleIds(flags)).toContain("form-field-unreachable");
    expect(flags.find((flag) => flag.rule === "form-field-unreachable")?.message).toContain(
      "Email",
    );
  });

  it("is raised for a required field no walk reached, on a form that went on to be stuck", () => {
    const outcome = outcomeOf({
      result: "stuck",
      reason: 'Tab never reached the submit control, "Send"',
      firstWalk: [{ field: 0, spoken: "Name, edit, required", required: true }],
    });
    expect(ruleIds(flagsOf(outcome))).toContain("form-field-unreachable");
  });

  it("is not raised for fields a walk never heard because the pass ran out of steps", () => {
    const outcome = outcomeOf({
      result: "not-tested",
      reason: OUT_OF_STEPS,
      firstWalk: [{ field: 0, spoken: "Name, edit, required", required: true }],
    });
    expect(ruleIds(flagsOf(outcome))).not.toContain("form-field-unreachable");
  });

  it("is not raised for fields a walk never heard because the form left the page", () => {
    for (const reason of ["the form left the page", "the form left the page after the press"]) {
      const outcome = outcomeOf({
        result: "stuck",
        reason,
        firstWalk: [{ field: 0, spoken: "Name, edit, required", required: true }],
      });
      expect(ruleIds(flagsOf(outcome)), reason).not.toContain("form-field-unreachable");
    }
  });

  it("is not raised when a typed field refused voicecap's value, but is for a list or date", () => {
    const refused = (type: string) =>
      outcomeOf({
        form: formOf([field(0, "Name"), field(1, "Zip", { type })]),
        result: "stuck",
        reason: "it was filled by keyboard, and the form didn't take it",
        stoppedAt: field(1, "Zip", { type }),
        firstWalk: [
          { field: 0, spoken: "Name, edit, required", required: true },
          { field: 1, spoken: "Zip, edit, required", required: true },
        ],
      });
    expect(ruleIds(flagsOf(refused("text")))).not.toContain("form-field-unreachable");
    expect(ruleIds(flagsOf(refused("text")))).toContain("form-cant-finish");
    expect(ruleIds(flagsOf(refused("date")))).toContain("form-field-unreachable");
  });

  it("is not raised when every required field was reached", () => {
    expect(ruleIds(flagsOf(outcomeOf()))).toEqual([]);
  });

  it("is not raised for a form that was never walked", () => {
    const outcome = outcomeOf({ result: "not-tested", reason: "tested on /x", firstWalk: [] });
    expect(flagsOf(outcome)).toEqual([]);
  });
});

describe("what raises nothing", () => {
  it("raises no flag on a completed form", () => {
    const outcome = outcomeOf({
      presses: [
        {
          state: stateOf({ invalid: [0], emptyRequired: [0, 1], messages: ["Name is required"] }),
          spoken: "alert, Name is required",
          axe: null,
        },
        { state: stateOf({ heldRequests: 1 }), spoken: "", axe: null },
      ],
      errorWalk: [
        {
          field: 0,
          spoken: "Name, edit, required, invalid entry, Name is required",
          required: true,
        },
      ],
    });
    expect(flagsOf(outcome)).toEqual([]);
  });

  it("raises nothing from axe's findings", () => {
    const outcome = outcomeOf({
      presses: [
        {
          state: stateOf({ heldRequests: 1 }),
          spoken: "",
          axe: { error: "axe timed out" },
        },
      ],
    });
    expect(flagsOf(outcome)).toEqual([]);
  });

  it("raises nothing for a page with no forms pass, and the other rules still work", () => {
    expect(evaluateFlags({}, rules)).toEqual([]);
  });
});

describe("the rules' criteria", () => {
  it("are the spec's", () => {
    expect(wcagOf("form-error-silent")).toEqual(["3.3.1", "4.1.3"]);
    expect(wcagOf("form-no-feedback")).toEqual(["3.3.1"]);
    expect(wcagOf("form-error-unlinked")).toEqual(["3.3.1", "1.3.1"]);
    expect(wcagOf("form-required-unsaid")).toEqual(["3.3.2"]);
    expect(wcagOf("form-cant-finish")).toEqual(["2.1.1", "3.3.3"]);
    expect(wcagOf("form-field-unreachable")).toEqual(["2.1.1"]);
    expect(Object.isFrozen(RULE_WCAG["form-cant-finish"])).toBe(true);
  });
});

describe("the cards", () => {
  const passes = {
    forms: {
      steps: [],
      stopReason: "forms-done" as const,
      forms: [pressedEmpty("Send, button")],
    },
  };
  const flags = evaluateFlags(passes, rules).filter((flag) => flag.pass === "forms");

  it("gives each flag a card with its cause, why, fix in the code, and path", () => {
    const page = {
      card: { flags, status: "done", flagsAsRecorded: false, readStopped: null, failure: null },
      review: null,
      passes,
    } as unknown as AttentionPage;
    const cards = attentionCards([page], rules);
    expect(cards.map((card) => card.kind)).toEqual(
      expect.arrayContaining(["form-error-silent", "form-cant-finish"]),
    );
    for (const card of cards) {
      const words = attentionWords(card);
      expect(words.cause).not.toBe("");
      expect(words.why).not.toBe("");
      expect(words.path.length).toBeGreaterThan(0);
      expect(words.fixes.length).toBeGreaterThan(0);
    }
  });

  it("quotes what NVDA said and the page's message beside it", () => {
    const silent = flags.find((flag) => flag.rule === "form-error-silent")!;
    expect(flagQuotes(passes, rules, silent)).toEqual(
      expect.arrayContaining(["Send, button", "Name is required"]),
    );
  });
});

describe("the results file", () => {
  it("gives the same flags read back from forms-result.json as from the outcomes", () => {
    const outcome = pressedEmpty("Send, button");
    const forms = readFormsResults(keptFormsResults([outcome], "/contact/").json);
    expect(forms).not.toBeNull();
    expect(flagsOf(outcome).length).toBeGreaterThan(0);
    expect(
      evaluateFlags({ forms: { steps: [], stopReason: "forms-done", forms: forms! } }, rules),
    ).toEqual(flagsOf(outcome));
  });

  it("reads nothing from text that isn't one", () => {
    expect(readFormsResults("not json")).toBeNull();
    expect(readFormsResults('{"schemaVersion":99,"forms":[]}')).toBeNull();
  });
});

describe("fields already invalid before the press, as the scan marks native required fields", () => {
  /** A native required field is invalid from load; NVDA says "invalid entry" before and after. */
  const native = (after: string) =>
    outcomeOf({
      result: "stuck",
      baseline: { invalid: [0], messages: [] },
      presses: [
        {
          state: stateOf({
            invalid: [0],
            emptyRequired: [0],
            bubble: "Please fill out this field.",
          }),
          spoken: "Name, edit",
          axe: null,
        },
      ],
      firstWalk: [{ field: 0, spoken: "Name, edit, required, invalid entry", required: true }],
      errorWalk: [{ field: 0, spoken: after, required: true }],
    });

  it("raises form-error-unlinked when 'invalid entry' is said both times and nothing says why", () => {
    expect(ruleIds(flagsOf(native("Name, edit, required, invalid entry")))).toContain(
      "form-error-unlinked",
    );
  });

  it("does not when the field says the error's own words after the press", () => {
    expect(
      ruleIds(flagsOf(native("Name, edit, required, invalid entry, Please fill out this field."))),
    ).not.toContain("form-error-unlinked");
  });
});

describe("a request held before a press", () => {
  const empty = { invalid: [], messages: [] };

  it("is not this press's: a second form whose session count was already 2 still changed nothing", () => {
    const outcome = outcomeOf({
      result: "stuck",
      baseline: empty,
      presses: [{ state: stateOf({ heldRequests: 2 }), spoken: "", heldBefore: 2, axe: null }],
    });
    expect(ruleIds(flagsOf(outcome))).toContain("form-no-feedback");
  });

  it("does not drop a silent error's message because the count rose before the first press", () => {
    const outcome = outcomeOf({
      result: "stuck",
      baseline: empty,
      presses: [
        {
          state: stateOf({ heldRequests: 1, invalid: [0], messages: ["Name is required"] }),
          spoken: "Send, button",
          heldBefore: 1,
          axe: null,
        },
      ],
    });
    expect(ruleIds(flagsOf(outcome))).toContain("form-error-silent");
  });

  it("is this press's when the count rose across it", () => {
    const outcome = outcomeOf({
      presses: [{ state: stateOf({ heldRequests: 3 }), spoken: "", heldBefore: 2, axe: null }],
    });
    expect(flagsOf(outcome)).toEqual([]);
  });
});

describe("a structured alert", () => {
  it("is heard when a run of the message's words is spoken among role words", () => {
    const outcome = outcomeOf({
      result: "stuck",
      presses: [
        {
          state: stateOf({ messages: ["Errors Name is required"] }),
          spoken: "alert, Errors, heading level 2, list with 1 item, Name is required",
          axe: null,
        },
      ],
    });
    expect(ruleIds(flagsOf(outcome))).not.toContain("form-error-silent");
  });

  it("is silent when only scraps of it are spoken", () => {
    const outcome = outcomeOf({
      result: "stuck",
      presses: [
        {
          state: stateOf({ messages: ["Errors Name is required"] }),
          spoken: "alert, Errors, list with 1 item",
          axe: null,
        },
      ],
    });
    expect(ruleIds(flagsOf(outcome))).toContain("form-error-silent");
  });
});
