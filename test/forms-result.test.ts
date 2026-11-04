/**
 * What a page keeps of its forms pass (forms-result.json): for each form its facts, what came of it,
 * and each press, kept apart from the page's transcripts as axe.json is, and the same bytes for the
 * same outcomes.
 */
import os from "node:os";

import { describe, expect, it } from "vitest";

import { keptAxeResults } from "../src/axe/results.js";
import type { FormInfo, FormOutcome, FormState } from "../src/forms/types.js";
import { FORMS_FILE, keptFormsResults } from "../src/forms/result-file.js";
import { rawAxe, rawRule } from "./helpers/raw-axe.js";

const STATE: FormState = {
  focused: null,
  focusedField: 0,
  focusedSubmit: false,
  invalid: [0],
  emptyRequired: [0],
  messages: ["Name is required"],
  liveChanged: true,
  heldRequests: 0,
  present: true,
  bubble: null,
};

function formOf(signature: string, overrides: Partial<FormInfo> = {}): FormInfo {
  return {
    index: 0,
    signature,
    kind: "test",
    site: null,
    fields: [{ index: 0, name: "Name", type: "text", required: true, tabIndex: 0 }],
    submitName: "Send",
    sensitive: false,
    captcha: false,
    ...overrides,
  };
}

function outcomeOf(signature: string, overrides: Partial<FormOutcome> = {}): FormOutcome {
  return {
    form: formOf(signature),
    result: "stuck",
    stoppedAt: { index: 0, name: "Name", type: "text", required: true, tabIndex: 0 },
    reason: "Tab never reached the Name field",
    presses: [{ state: STATE, spoken: "Name is required", axe: null }],
    firstWalk: [{ field: 0, spoken: "Name, edit", required: false }],
    errorWalk: [],
    lastWalk: [{ field: 0, spoken: "Name, edit, invalid", required: true }],
    ...overrides,
  };
}

const found = keptAxeResults(rawAxe({ violations: [rawRule("image-alt")] }), "http://x/");

describe("keptFormsResults", () => {
  it("is named forms-result.json", () => {
    expect(FORMS_FILE).toBe("forms-result.json");
  });

  it("keeps each form with its result, where it stopped, why, and each press", () => {
    const kept = keptFormsResults(
      [
        outcomeOf("a", {
          presses: [
            {
              state: STATE,
              spoken: "Name is required",
              axe: { json: found.json, summary: found.summary },
            },
            { state: STATE, spoken: "", axe: { error: "axe timed out" } },
          ],
        }),
      ],
      "/contact/",
    );
    const file = JSON.parse(kept.json) as {
      page: string;
      forms: {
        presses: {
          state: FormState;
          spoken: string;
          axe: { summary?: unknown; results?: { violations: { id: string }[] }; error?: string };
        }[];
        firstWalk: unknown;
        lastWalk: unknown[];
      }[];
    };
    expect(file.page).toBe("/contact/");
    expect(file.forms).toHaveLength(1);
    const form = file.forms[0]!;
    expect(form).toMatchObject({
      result: "stuck",
      reason: "Tab never reached the Name field",
      stoppedAt: { index: 0, name: "Name" },
      form: { signature: "a", kind: "test", submitName: "Send" },
    });
    expect(form.firstWalk).toEqual([{ field: 0, spoken: "Name, edit", required: false }]);
    expect(form.lastWalk).toHaveLength(1);
    expect(form.presses[0]!.state.messages).toEqual(["Name is required"]);
    expect(form.presses[0]!.spoken).toBe("Name is required");
    expect(form.presses[0]!.axe.summary).toEqual(found.summary);
    expect(form.presses[0]!.axe.results?.violations[0]?.id).toBe("image-alt");
    expect(form.presses[1]!.axe).toEqual({ error: "axe timed out" });
  });

  it("counts the forms by what came of them, and their presses", () => {
    const kept = keptFormsResults(
      [
        outcomeOf("a", { result: "completed", reason: null, stoppedAt: null }),
        outcomeOf("b"),
        outcomeOf("c", { result: "not-tested", presses: [], reason: "tested on /x" }),
      ],
      "/",
    );
    expect(kept.counts).toEqual({ forms: 3, completed: 1, stuck: 1, notTested: 1, presses: 2 });
    expect((JSON.parse(kept.json) as { counts: unknown }).counts).toEqual(kept.counts);
  });

  it("keeps the count of loads the pass made, in the file and the counts, when it is given", () => {
    const outcomes = [outcomeOf("a")];
    const kept = keptFormsResults(outcomes, "/", 3);
    expect(kept.counts.loads).toBe(3);
    expect((JSON.parse(kept.json) as { counts: { loads: number } }).counts.loads).toBe(3);
    expect(kept.json).toBe(keptFormsResults(structuredClone(outcomes), "/", 3).json);
    // A record made without a count has none.
    expect(keptFormsResults(outcomes, "/").counts).not.toHaveProperty("loads");
  });

  it("keeps a form tested on another page, and one not tested, with no press", () => {
    const kept = keptFormsResults(
      [outcomeOf("a", { result: "not-tested", presses: [], reason: "tested on /x" })],
      "/",
    );
    const file = JSON.parse(kept.json) as { forms: { reason: string; presses: unknown[] }[] };
    expect(file.forms[0]).toMatchObject({ reason: "tested on /x", presses: [] });
  });

  it("gives the same bytes for the same outcomes, with its keys sorted and a final newline", () => {
    const outcomes = [outcomeOf("a"), outcomeOf("b")];
    const first = keptFormsResults(outcomes, "/");
    const second = keptFormsResults(structuredClone(outcomes), "/");
    expect(second.json).toBe(first.json);
    expect(first.json.endsWith("}\n")).toBe(true);
    const keys = Object.keys(JSON.parse(first.json) as object);
    expect(keys).toEqual([...keys].sort());
  });

  it("replaces the home folder in what was said and in a reason", () => {
    const home = os.homedir();
    const kept = keptFormsResults(
      [
        outcomeOf("a", {
          reason: `Could not read ${home}\\form.txt`,
          presses: [
            {
              state: { ...STATE, messages: [`saved in ${home}`] },
              spoken: `at ${home}`,
              axe: { error: `failed in ${home}` },
            },
          ],
        }),
      ],
      "/",
    );
    expect(kept.json).not.toContain(home);
    expect(kept.json).not.toContain(home.replaceAll("\\", "\\\\"));
  });
});
