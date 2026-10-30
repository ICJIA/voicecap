/**
 * The forms pass against a fake form: what it presses, fills, and concludes. The driver's real side
 * is tested with the run.
 */
import { describe, expect, it } from "vitest";

import { FORMS_DEFAULTS } from "../src/config/defaults.js";
import { fieldValueOf, formPass, type FormPassOptions } from "../src/passes/forms.js";
import { runPass, type PassSettings } from "../src/passes/index.js";
import { StepRecorder } from "../src/passes/steps.js";
import { progressLine } from "../src/run/progress.js";
import { MAIN_COMMAND, stopReasonText } from "../src/transcripts/format.js";
import { FakeFormDriver, type FakeForm } from "./helpers/fake-form-driver.js";
import { ScriptedDriver } from "./helpers/scripted-driver.js";

const options: FormPassOptions = { cap: 500, settleMs: 7, values: FORMS_DEFAULTS.values };

const THREE: FakeForm["fields"] = [
  { name: "Name" },
  { name: "Email", type: "email" },
  { name: "Topic" },
];

async function pass(form: FakeForm, overrides: Partial<FormPassOptions> = {}) {
  const driver = new FakeFormDriver(form);
  const recorder = new StepRecorder(1000, undefined);
  const outcome = await formPass(driver, recorder, driver.info, { ...options, ...overrides });
  return { driver, recorder, outcome };
}

describe("a form that can be completed", () => {
  it("fills 3 required fields, in 4 presses, and hears every field", async () => {
    const { driver, outcome } = await pass({ fields: THREE });
    expect(outcome.result).toBe("completed");
    expect(outcome.reason).toBeNull();
    expect(outcome.stoppedAt).toBeNull();
    expect(outcome.presses).toHaveLength(4);
    expect(driver.count("pressSubmit")).toBe(4);
    expect(driver.fills).toEqual([
      { kind: "text", text: "voicecap test" },
      { kind: "text", text: "test@example.com" },
      { kind: "text", text: "voicecap test" },
    ]);
    expect(outcome.firstWalk).toEqual([
      { field: 0, spoken: "Name, edit, required, blank", required: true },
      { field: 1, spoken: "Email, edit, required, blank", required: true },
      { field: 2, spoken: "Topic, edit, required, blank", required: true },
    ]);
  });

  it("keeps each press's state and words, and hears the form again after the last that failed", async () => {
    const { outcome } = await pass({ fields: THREE });
    expect(outcome.presses[0]?.spoken).toBe("Please fill out this field.");
    expect(outcome.presses[0]?.state.bubble).toBe("Please fill out this field.");
    expect(outcome.presses[3]?.state.heldRequests).toBe(1);
    expect(outcome.lastWalk.map((heard) => heard.field)).toEqual([0, 1, 2]);
  });

  it("gives the driver the settle time for each press", async () => {
    const { driver } = await pass({ fields: [{ name: "Name" }] });
    expect(driver.settles).toEqual([7, 7]);
  });

  it("records its keys as steps, and fills a field only once Tab has reached it", async () => {
    const { driver, recorder } = await pass({ fields: THREE });
    const commands = recorder.steps.map((step) => step.command);
    expect(new Set(commands)).toEqual(
      new Set(["focusField", "nextFocusable", "pressSubmit", "fillField"]),
    );
    expect(driver.made.filter((call) => call.startsWith("fillField"))).toEqual([
      "fillField 0",
      "fillField 1",
      "fillField 2",
    ]);
    // Script moves focus to the first field and no other.
    expect(driver.made.filter((call) => call.startsWith("focusFormField"))).not.toContain(
      "focusFormField 0 1",
    );
    expect(driver.made.filter((call) => call.startsWith("focusFormField"))).not.toContain(
      "focusFormField 0 2",
    );
  });

  it("completes a form the page's own script checks, with the errors in aria-invalid", async () => {
    const { outcome } = await pass({ fields: THREE, validates: "aria" });
    expect(outcome.result).toBe("completed");
    expect(outcome.presses).toHaveLength(4);
  });

  it("fills the required fields of a form whose only answer is one alert", async () => {
    const { driver, outcome } = await pass({ fields: THREE, validates: "message" });
    expect(outcome.result).toBe("completed");
    expect(driver.fills).toHaveLength(3);
  });

  it("presses once a form with nothing required, and calls it completed", async () => {
    const { driver, outcome } = await pass({ fields: [{ name: "Note", required: false }] });
    expect(outcome.result).toBe("completed");
    expect(outcome.presses).toHaveLength(1);
    expect(driver.fills).toEqual([]);
  });
});

describe("the guard", () => {
  it("goes on before anything else the pass does to the page", async () => {
    const { driver } = await pass({ fields: THREE });
    expect(driver.made[0]).toBe("armFormGuard");
    expect(driver.count("armFormGuard")).toBe(1);
  });

  it("presses nothing and fills nothing when it can't be armed", async () => {
    const { driver, recorder, outcome } = await pass({
      fields: THREE,
      armError: "the gate is open",
    });
    expect(outcome.result).toBe("not-tested");
    expect(outcome.reason).toContain("the gate is open");
    expect(driver.made).toEqual(["armFormGuard"]);
    expect(recorder.count).toBe(0);
  });
});

describe("what a press means", () => {
  it("doesn't take a request a key sent while filling for the press's own", async () => {
    // Each fill sends a request. The press after it is blocked, so the form isn't done yet.
    const { outcome } = await pass({ fields: THREE, sendsOnFill: true });
    expect(outcome.result).toBe("completed");
    expect(outcome.presses).toHaveLength(4);
  });

  it("doesn't take a message that shows after a request was held for the form's error", async () => {
    const { outcome } = await pass({
      fields: [{ name: "Note", required: false }],
      afterHeld: "Network error, try again",
    });
    expect(outcome.result).toBe("completed");
    expect(outcome.presses).toHaveLength(1);
  });

  it("isn't completed by a request held while a new field is invalid", async () => {
    const { driver, outcome } = await pass({
      fields: THREE,
      validates: "aria",
      sendsOnPress: true,
    });
    expect(outcome.result).toBe("completed");
    expect(driver.fills).toHaveLength(3);
    expect(outcome.presses).toHaveLength(4);
  });

  it("isn't moved by a hint that was showing before any press", async () => {
    const { outcome } = await pass({
      fields: THREE,
      validates: "nothing",
      hints: ["All fields are required"],
    });
    expect(outcome.result).toBe("stuck");
    expect(outcome.presses).toHaveLength(1);
  });
});

describe("a form that can't be completed", () => {
  it("names a field that won't take its value", async () => {
    const { driver, outcome } = await pass({
      fields: [{ name: "Name" }, { name: "Date of birth", takes: false }, { name: "Topic" }],
    });
    expect(outcome.result).toBe("stuck");
    expect(outcome.stoppedAt?.name).toBe("Date of birth");
    expect(outcome.reason).toBeTruthy();
    expect(driver.count("fillField")).toBe(3);
  });

  it("names a required field Tab never reaches", async () => {
    const { driver, outcome } = await pass({
      fields: [{ name: "Name" }, { name: "Topic", tabbable: false }, { name: "Email" }],
    });
    expect(outcome.result).toBe("stuck");
    expect(outcome.stoppedAt?.name).toBe("Topic");
    expect(outcome.firstWalk.map((heard) => heard.field)).toEqual([0, 2]);
    expect(driver.made).not.toContain("fillField 1");
  });

  it("ends when pressing changes nothing, with no more presses", async () => {
    const { driver, outcome } = await pass({ fields: THREE, validates: "nothing" });
    expect(outcome.result).toBe("stuck");
    expect(outcome.reason).toContain("changed nothing");
    expect(outcome.presses).toHaveLength(1);
    expect(driver.count("pressSubmit")).toBe(1);
    expect(driver.fills).toEqual([]);
  });

  it("ends without a throw when the form's gone after a press", async () => {
    const { driver, outcome } = await pass({ fields: THREE, goneAfter: 2 });
    expect(outcome.result).toBe("stuck");
    expect(outcome.reason).toContain("left the page");
    expect(outcome.presses).toHaveLength(2);
    expect(outcome.presses[1]?.state.present).toBe(false);
    expect(driver.count("pressSubmit")).toBe(2);
  });

  it("ends at fields + 1 presses when the form resets after each", async () => {
    const { driver, outcome } = await pass({ fields: THREE, resets: true });
    expect(outcome.result).toBe("stuck");
    expect(outcome.presses).toHaveLength(4);
    expect(driver.count("pressSubmit")).toBe(4);
  });

  it("ends at the step cap, and says so", async () => {
    const { recorder, outcome } = await pass({ fields: THREE }, { cap: 6 });
    expect(outcome.result).toBe("stuck");
    expect(outcome.reason).toContain("ran out of steps");
    expect(recorder.count).toBeLessThanOrEqual(6);
  });
});

describe("forms the pass doesn't press", () => {
  it.each([
    ["search", "search"],
    ["no-submit", "submit"],
    ["other-site", "docs.google.com"],
    ["not-web", "web address"],
  ] as const)("a %s form is not tested, and says why", async (kind, words) => {
    const { driver, outcome } = await pass({ fields: THREE, kind });
    expect(outcome.result).toBe("not-tested");
    expect(outcome.reason).toContain(words);
    expect(driver.made).toEqual([]);
  });

  it("doesn't press a form with a submit and no fields", async () => {
    const { driver, outcome } = await pass({ fields: [] });
    expect(outcome.result).toBe("not-tested");
    expect(outcome.reason).toBe("it has no fields");
    expect(driver.made).toEqual([]);
  });

  it("presses a sensitive form once, empty, and never fills it", async () => {
    const { driver, outcome } = await pass({ fields: THREE, sensitive: true });
    expect(outcome.presses).toHaveLength(1);
    expect(driver.fills).toEqual([]);
    expect(outcome.result).toBe("not-tested");
    expect(outcome.reason).toContain("never fills");
    expect(outcome.lastWalk).toHaveLength(3);
  });

  it("presses a CAPTCHA's form once, empty, and says the CAPTCHA stops voicecap there", async () => {
    const { driver, outcome } = await pass({ fields: THREE, captcha: true });
    expect(outcome.presses).toHaveLength(1);
    expect(driver.fills).toEqual([]);
    expect(outcome.result).toBe("not-tested");
    expect(outcome.reason).toContain("CAPTCHA stops voicecap there");
  });

  it("calls every form not tested with a driver that can't test forms", async () => {
    const driver = new FakeFormDriver({ fields: THREE });
    const without = new ScriptedDriver([]);
    const outcome = await formPass(
      without,
      new StepRecorder(1000, undefined),
      driver.info,
      options,
    );
    expect(outcome.result).toBe("not-tested");
    expect(outcome.reason).toBe("this run's driver doesn't test forms");
  });
});

describe("axe", () => {
  const axe = { error: "checked" };

  it("checks the first press, and later ones only when the form's errors changed", async () => {
    // The same alert after each press, and no field marked.
    const same = await pass({ fields: THREE, validates: "message", axe });
    expect(same.outcome.presses.map((press) => press.axe)).toEqual([axe, null, null, null]);
    expect(same.driver.count("checkFormWithAxe")).toBe(1);
    // One field fewer marked each time.
    const changing = await pass({ fields: THREE, validates: "aria", axe });
    expect(changing.outcome.presses.map((press) => press.axe)).toEqual([axe, axe, axe, axe]);
  });

  it("stops at a check still running in the page, with no more keys", async () => {
    const { driver, outcome } = await pass({
      fields: THREE,
      axe: { error: "timed out", leftRunning: true },
    });
    expect(outcome.result).toBe("not-tested");
    expect(outcome.reason).toContain("axe");
    expect(driver.fills).toEqual([]);
    expect(driver.count("pressSubmit")).toBe(1);
  });
});

describe("fieldValueOf", () => {
  const field = (type: string) => ({ index: 0, name: null, type, required: true });
  const settings = { values: { text: "words", email: "a@example.com", tel: "1" } };

  it("maps each input type to what the keyboard puts in it", () => {
    expect(fieldValueOf(field("email"), settings)).toEqual({ kind: "text", text: "a@example.com" });
    expect(fieldValueOf(field("tel"), settings)).toEqual({ kind: "text", text: "1" });
    for (const type of ["text", "textarea", "url", "number", "date"]) {
      expect(fieldValueOf(field(type), settings)).toEqual({ kind: "text", text: "words" });
    }
    for (const type of ["checkbox", "radio"]) {
      expect(fieldValueOf(field(type), settings)).toEqual({ kind: "space" });
    }
    for (const type of ["select-one", "select-multiple"]) {
      expect(fieldValueOf(field(type), settings)).toEqual({ kind: "arrow" });
    }
  });

  it("takes the default for a type a config's values leave out", () => {
    expect(fieldValueOf(field("email"), { values: { text: "words" } })).toEqual({
      kind: "text",
      text: "test@example.com",
    });
  });
});

describe("runPass", () => {
  const settings: PassSettings = {
    cap: 500,
    repeatLimit: 10,
    endConfirmations: 1,
    noNextHeading: /^no next heading$/i,
    stepTimeoutMs: 1000,
    forms: { settleMs: 0, values: FORMS_DEFAULTS.values },
  };

  it("takes each form the driver finds, and ends at the pass's own natural end", async () => {
    const driver = new FakeFormDriver({ fields: THREE });
    const result = await runPass("forms", driver, settings);
    expect(result.stopReason).toBe("forms-done");
    expect(result.forms?.map((outcome) => outcome.result)).toEqual(["completed"]);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
  });

  it("says so, and fails nothing, with a driver that can't test forms", async () => {
    const result = await runPass("forms", new ScriptedDriver([]), settings);
    expect(result.stopReason).toBe("forms-done");
    expect(result.steps).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(["this run's driver doesn't test forms"]);
  });

  it("stops at the step cap, as a pass does", async () => {
    const driver = new FakeFormDriver({ fields: THREE });
    const result = await runPass("forms", driver, { ...settings, cap: 6 });
    expect(result.stopReason).toBe("step-cap");
  });

  it("names the press as the pass's main step, and its end in words", () => {
    expect(MAIN_COMMAND.forms).toBe("pressSubmit");
    expect(stopReasonText("forms-done")).toBe("forms done");
    const line = progressLine({
      index: 1,
      total: 1,
      path: "/",
      outcome: {
        kind: "done",
        passes: { forms: { steps: 4, stopReason: "forms-done", items: 4 } },
      },
      durationMs: 1000,
      remainingMs: null,
    });
    expect(line).not.toContain("forms done");
  });
});
