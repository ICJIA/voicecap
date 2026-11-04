/**
 * What readers see of the forms pass on the shareable page: the banner of each form (the feature's
 * headline, said once in src/forms/banner.ts), the card's banners in view with a fold of what
 * happened at the form, At a glance's line, the share's record of it, and the fingerprint check of
 * forms-result.json.
 */
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { formsFlags } from "../src/flags/forms.js";
import { formBanner } from "../src/forms/banner.js";
import { keptFormsResults } from "../src/forms/result-file.js";
import type { FormInfo, FormOutcome, FormState } from "../src/forms/types.js";
import type { FlagResult, FormsRecord, ReviewsFile, RunJson } from "../src/model.js";
import { CHECK_LIBRARY } from "../src/share/check.js";
import { renderSharePage } from "../src/share/html/document.js";
import { SHARE_CSS } from "../src/share/html/style.js";
import { renderAiJson } from "../src/share/ai/json.js";
import { renderAiMarkdown } from "../src/share/ai/markdown.js";
import { renderGlance } from "../src/share/html/top.js";
import { renderPages } from "../src/share/html/pages.js";
import { shareResultOf } from "../src/share/shares.js";
import { buildShareModel, type ShareModel } from "../src/share/model.js";
import { wordsOf } from "../src/share/word/blocks.js";
import { wordPages } from "../src/share/word/pages.js";
import { wordGlance } from "../src/share/word/top.js";
import { fileHash } from "../src/transcripts/write.js";
import { launchBrowser, violations } from "./helpers/axe.js";
import { shareRun, type SharePageSpec } from "./helpers/share-data.js";
import { textOf } from "./helpers/share-html.js";
import { inputOf, LINES, storeOf, TRANSCRIPTS } from "./helpers/share-model.js";

const STATE: FormState = {
  focused: null,
  focusedField: null,
  focusedSubmit: true,
  invalid: [],
  emptyRequired: [],
  messages: [],
  liveChanged: false,
  heldRequests: 1,
  present: true,
  bubble: null,
};

const NAME = { index: 0, name: "Name", type: "text", required: true, tabIndex: 0 };
const EMAIL = { index: 1, name: "Email", type: "email", required: true, tabIndex: 0 };
const BIRTH = { index: 2, name: "Date of birth", type: "date", required: true, tabIndex: 0 };

function formOf(overrides: Partial<FormInfo> = {}): FormInfo {
  return {
    index: 0,
    signature: "contact",
    kind: "test",
    site: null,
    fields: [NAME, EMAIL],
    submitName: "Send",
    sensitive: false,
    captcha: false,
    ...overrides,
  };
}

/** A form that was completed by keyboard, with no flag raised on it. */
function completed(overrides: Partial<FormOutcome> = {}): FormOutcome {
  return {
    form: formOf(),
    result: "completed",
    stoppedAt: null,
    reason: null,
    presses: [
      {
        state: { ...STATE, invalid: [0], messages: ["Name is required"], heldRequests: 0 },
        spoken: "Name is required",
        axe: null,
        heldBefore: 0,
      },
      { state: STATE, spoken: "", axe: null, heldBefore: 0 },
    ],
    baseline: { invalid: [], messages: [] },
    firstWalk: [
      { field: 0, spoken: "Name, edit, required", required: true },
      { field: 1, spoken: "Email, edit, required", required: true },
    ],
    errorWalk: [],
    lastWalk: [],
    ...overrides,
  };
}

function stuck(): FormOutcome {
  return completed({
    form: formOf({ fields: [NAME, EMAIL, BIRTH] }),
    result: "stuck",
    stoppedAt: BIRTH,
    reason: "Tab never reached it",
  });
}

/** A form that was completed, though a press showed an error NVDA said none of. */
function silent(): FormOutcome {
  return completed({
    presses: [
      {
        state: { ...STATE, invalid: [1], messages: ["Email is not valid"], heldRequests: 0 },
        spoken: "",
        axe: null,
        heldBefore: 0,
      },
      { state: STATE, spoken: "", axe: null, heldBefore: 0 },
    ],
  });
}

/** The flags the pass raises on a form, as the report reads them. */
const FLAG: FlagResult = formsFlags([silent()])[0] ?? { rule: "none", message: "none" };

describe("formBanner", () => {
  it("is green and definite for a form that was completed with no flag left", () => {
    const banner = formBanner(completed(), []);
    expect(banner.kind).toBe("works");
    expect(banner.headline).toBe("This form works with NVDA.");
    expect(banner.detail).toBe(
      "NVDA reached all 2 required fields, said each one's name and that it's required, and told the user what was wrong. The form was completed by keyboard.",
    );
  });

  it("says NVDA told the user what was wrong only when a press showed an error", () => {
    const quiet = completed({
      presses: [{ state: STATE, spoken: "", axe: null, heldBefore: 0 }],
    });
    const banner = formBanner(quiet, []);
    expect(banner.kind).toBe("works");
    expect(banner.detail).toBe(
      "NVDA reached all 2 required fields, said each one's name and that it's required. The form was completed by keyboard.",
    );
  });

  it("claims only what was observed when a review settled the flags", () => {
    const banner = formBanner(silent(), [], "30 October 2026");
    expect(banner.kind).toBe("works");
    expect(banner.detail).toBe(
      "Checked 30 October 2026: NVDA reached all 2 required fields, and the form was completed by keyboard. A person's review settled what voicecap had flagged.",
    );
  });

  it("is amber for a completed form with a flag left, and says what's wrong", () => {
    expect(FLAG.rule).toBe("form-error-silent");
    const banner = formBanner(silent(), [FLAG]);
    expect(banner.kind).toBe("needs-work");
    expect(banner.headline).toBe("This form needs work with NVDA.");
    expect(banner.detail).toContain(FLAG.message);
  });

  it("is red for a form that never reached the point of sending, and says where it stopped", () => {
    const banner = formBanner(stuck(), []);
    expect(banner.kind).toBe("cant-complete");
    expect(banner.headline).toBe("This form can't be completed with NVDA.");
    expect(banner.detail).toContain("It stopped at Date of birth.");
  });

  it("is gray for a form that wasn't tested, and says why", () => {
    const search = completed({
      form: formOf({ kind: "search" }),
      result: "not-tested",
      reason: "it is a search form",
    });
    const banner = formBanner(search, []);
    expect(banner.kind).toBe("not-checked");
    expect(banner.headline).toBe("This form wasn't checked.");
    expect(banner.detail).toContain("it is a search form");
  });

  it("turns green when a review settled the flags of a completed form", () => {
    expect(formBanner(completed(), [FLAG]).kind).toBe("needs-work");
    expect(formBanner(completed(), []).kind).toBe("works");
  });

  it("is never turned green by a review of a form that can't be completed", () => {
    expect(formBanner(stuck(), []).kind).toBe("cant-complete");
    expect(formBanner(stuck(), [FLAG]).kind).toBe("cant-complete");
  });
});

// A page of the forms pass, as a run keeps it.

const RAN_AT = "2026-10-30T09:00:00.000-05:00";

/** A page's forms-result.json, and the page's record of it. */
function kept(outcomes: FormOutcome[], page: string): { text: string; record: FormsRecord } {
  const { json, counts } = keptFormsResults(outcomes, page);
  return { text: json, record: { ...fileHash(json), counts, ranAt: RAN_AT } };
}

interface Built {
  model: ShareModel;
  run: RunJson;
}

const NEW = "0.25.0";

/** One run of pages; each page spec may carry its forms, whose file the loader is made to hold. */
function build(
  pages: { path: string; forms?: FormOutcome[]; flags?: FlagResult[] }[],
  options: {
    passes?: ("read" | "headings" | "tab" | "forms")[];
    version?: string;
    /** A person's review of the first page, of the transcripts shown. */
    review?: "reviewed" | "issue";
  } = {},
  overrides: Partial<Parameters<typeof inputOf>[1]> = {},
): Built {
  const files = new Map<string, string>();
  const specs: SharePageSpec[] = pages.map((page) => {
    const made = page.forms === undefined ? undefined : kept(page.forms, page.path);
    return {
      path: page.path,
      title: `Page ${page.path}`,
      files: TRANSCRIPTS,
      passes: LINES,
      ...(made === undefined ? {} : { forms: made.record }),
      ...(page.flags === undefined ? {} : { flags: page.flags }),
      __text: made?.text,
    } as SharePageSpec;
  });
  const run = shareRun({
    id: "r1",
    voicecapVersion: options.version ?? NEW,
    passes: options.passes ?? ["read", "headings", "tab", "forms"],
    pages: specs,
  });
  pages.forEach((page, index) => {
    const text = (specs[index] as unknown as { __text?: string }).__text;
    const slug = run.pages[index]?.slug;
    if (text !== undefined && slug !== undefined) files.set(`r1/${slug}`, text);
  });
  const first = run.pages[0];
  const reviews: ReviewsFile =
    options.review === undefined || first === undefined
      ? { schemaVersion: 1, pages: {} }
      : {
          schemaVersion: 1,
          pages: {
            [first.key]: [
              {
                status: options.review,
                reviewer: "Pat Lee",
                at: "2026-09-27T10:00:00-05:00",
                note: null,
                run: run.id,
                url: first.url,
                files: {},
                content: Object.fromEntries(
                  Object.entries(first.passes).map(([pass, summary]) => [
                    pass,
                    summary.contentSha256,
                  ]),
                ),
              },
            ],
          },
        };
  const model = buildShareModel(
    inputOf([run], { transcripts: storeOf(), formsFiles: files, reviews, ...overrides }),
  );
  return { model, run };
}

/** A card's html outside every fold. */
function outsideFolds(html: string): string {
  return html.replace(/<details[\s\S]*?<\/details>/g, "");
}

describe("the page's card", () => {
  it("shows each form's banner in view, outside any fold, with a sign that repeats its words", () => {
    const { model } = build([{ path: "/contact/", forms: [completed()] }]);
    const html = renderPages(model);
    const open = outsideFolds(html);
    expect(open).toContain('class="form-banner works"');
    expect(textOf(open)).toContain("This form works with NVDA.");
    expect(textOf(open)).toContain("NVDA reached all 2 required fields");
    // The sign is the style block's, drawn with no alternative text; the words say the same.
    expect(SHARE_CSS).toContain('.form-banner.works .headline::before { content: "✓"');
  });

  it("shows an amber, a red, and a gray banner, each with its own sign and words", () => {
    const { model } = build([
      { path: "/silent/", forms: [silent()] },
      { path: "/stuck/", forms: [stuck()] },
      {
        path: "/search/",
        forms: [
          completed({
            form: formOf({ kind: "search" }),
            result: "not-tested",
            reason: "it is a search form",
          }),
        ],
      },
    ]);
    const open = outsideFolds(renderPages(model));
    expect(open).toContain('class="form-banner needs-work"');
    expect(textOf(open)).toContain("This form needs work with NVDA.");
    expect(open).toContain('class="form-banner cant-complete"');
    expect(textOf(open)).toContain("This form can't be completed with NVDA.");
    expect(open).toContain('class="form-banner not-checked"');
    expect(textOf(open)).toContain("This form wasn't checked.");
    expect(SHARE_CSS).toContain('.form-banner.needs-work .headline::before { content: "⚠"');
    expect(SHARE_CSS).toContain('.form-banner.cant-complete .headline::before { content: "⚠"');
    expect(SHARE_CSS).toContain('.form-banner.not-checked .headline::before { content: "–"');
  });

  it("turns a flagged completed form green once a person reviewed the page with no issues", () => {
    const flagged = build([{ path: "/silent/", forms: [silent()] }]);
    expect(outsideFolds(renderPages(flagged.model))).toContain("form-banner needs-work");
    const settled = build([{ path: "/silent/", forms: [silent()] }], { review: "reviewed" });
    const open = outsideFolds(renderPages(settled.model));
    expect(open).toContain("form-banner works");
    expect(open).not.toContain("form-banner needs-work");
    expect(textOf(open)).toContain("A person's review settled what voicecap had flagged.");
    // The banner claims no more than the fields were reached and the form was completed.
    expect(textOf(open)).not.toContain("told the user what was wrong");
    expect(textOf(open)).not.toContain("said each one's name");
  });

  it("keeps a form that can't be completed red under the same review", () => {
    const { model } = build([{ path: "/stuck/", forms: [stuck()] }], { review: "reviewed" });
    const open = outsideFolds(renderPages(model));
    expect(open).toContain("form-banner cant-complete");
    expect(open).not.toContain("form-banner works");
  });

  it("leaves a flagged form amber when the review found an issue", () => {
    const { model } = build([{ path: "/silent/", forms: [silent()] }], { review: "issue" });
    expect(outsideFolds(renderPages(model))).toContain("form-banner needs-work");
  });

  it("has a fold, What happened at the form, with each required field, each press, and axe", () => {
    const withAxe = completed({
      presses: [
        {
          state: { ...STATE, invalid: [0], messages: ["Name is required"], heldRequests: 0 },
          spoken: "Name is required",
          axe: {
            json: "{}",
            summary: {
              axeVersion: "4.14.0",
              counts: { violations: 0, incomplete: 0, passes: 4, inapplicable: 1 },
              impacts: { critical: 0, serious: 0, moderate: 0, minor: 0 },
            },
          },
          heldBefore: 0,
        },
      ],
    });
    const { model } = build([{ path: "/contact/", forms: [withAxe] }]);
    const html = renderPages(model);
    const fold = /<details class="fold forms-fold"[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
    expect(textOf(fold)).toContain("What happened at the form");
    expect(textOf(fold)).toContain("Name");
    expect(textOf(fold)).toContain("Name, edit, required");
    expect(textOf(fold)).toContain("Email, edit, required");
    expect(textOf(fold)).toContain("Name is required");
    expect(textOf(fold)).toContain("axe with its errors showing: no issues");
    // The banner is not inside the fold.
    expect(fold).not.toContain("form-banner");
  });

  it("says nothing of forms on a page of a run with no forms pass", () => {
    const { model } = build([{ path: "/plain/" }], { passes: ["read", "headings", "tab"] });
    const html = renderPages(model);
    expect(html).not.toContain("form-banner");
    expect(html).not.toContain("What happened at the form");
  });
});

describe("At a glance", () => {
  it("says all the forms work, once a run has the pass", () => {
    const { model } = build([
      { path: "/a/", forms: [completed()] },
      { path: "/b/", forms: [completed(), completed()] },
      { path: "/c/", forms: [completed()] },
    ]);
    expect(model.forms).toMatchObject({ found: 4, working: 4 });
    const glance = textOf(renderGlance(model));
    expect(glance).toContain("All 4 forms work with NVDA");
  });

  it("says how many work, naming the pages of those that don't", () => {
    const { model } = build([
      { path: "/a/", forms: [completed()] },
      { path: "/b/", forms: [completed(), completed()] },
      { path: "/c/", forms: [stuck()] },
    ]);
    expect(model.forms).toMatchObject({ found: 4, working: 3 });
    const glance = textOf(renderGlance(model));
    expect(glance).toContain("3 of 4 forms work with NVDA");
    expect(glance).toContain("/c/");
    expect(glance).not.toContain("/a/");
    expect(renderGlance(model)).toMatch(/class="form-banner needs-work"/);
  });

  it("records no forms when the run took the pass and found none to check, and says nothing at a glance", () => {
    const { model } = build([{ path: "/plain/" }]);
    expect(model.forms).toEqual({ found: 0, working: 0, notChecked: 0, broken: [] });
    expect(model.result.forms).toEqual({ found: 0, working: 0, notChecked: 0 });
    expect(textOf(renderGlance(model))).not.toContain("forms");
  });

  it("tells forms that weren't checked from no forms at all, in what the share records", () => {
    const search = completed({
      form: formOf({ kind: "search" }),
      result: "not-tested",
      reason: "it is a search form",
    });
    const { model } = build([{ path: "/search/", forms: [search] }]);
    expect(model.result.forms).toEqual({ found: 0, working: 0, notChecked: 1 });
    expect(textOf(renderGlance(model))).not.toContain("forms work");
  });

  it("records the count for the website in the share's result", () => {
    const { model } = build([
      { path: "/a/", forms: [completed()] },
      { path: "/c/", forms: [stuck()] },
    ]);
    expect(model.result.forms).toEqual({ found: 2, working: 1, notChecked: 0 });
    const parsed = shareResultOf({ ...model.result });
    expect(parsed?.forms).toEqual({ found: 2, working: 1, notChecked: 0 });
  });

  it("reads no forms count that can't be true from a share's record", () => {
    const base = { pages: 3, read: 3, problems: 0, problemPages: 0 };
    expect(shareResultOf({ ...base, forms: { found: 2, working: 3, notChecked: 0 } })).toBeNull();
    expect(shareResultOf({ ...base, forms: { found: "2", working: 1, notChecked: 0 } })).toBeNull();
    expect(shareResultOf({ ...base, forms: { found: 2, working: 1 } })).toBeNull();
    expect(shareResultOf({ ...base, forms: { found: 2, working: 1, notChecked: -1 } })).toBeNull();
    expect(shareResultOf(base)?.forms).toBeUndefined();
  });

  it("says nothing for a run with no forms pass", () => {
    const { model } = build([{ path: "/plain/" }], { passes: ["read", "headings", "tab"] });
    expect(model.forms).toBeNull();
    expect(model.result.forms).toBeUndefined();
    expect(textOf(renderGlance(model))).not.toContain("forms");
  });

  it("says Not recorded for a run from before the pass", () => {
    const { model } = build([{ path: "/plain/" }], {
      passes: ["read", "headings", "tab"],
      version: "0.12.0",
    });
    expect(model.forms).toEqual({ notRecorded: "Not recorded: this run used voicecap 0.12.0." });
    expect(model.result.forms).toBeUndefined();
    expect(textOf(renderGlance(model))).toContain("Not recorded: this run used voicecap 0.12.0.");
  });
});

describe("the fingerprint check", () => {
  it("carries each forms-result.json a card shows, with its exact text", () => {
    const { model, run } = build([{ path: "/contact/", forms: [completed()] }]);
    const slug = run.pages[0]?.slug;
    expect(model.check.forms).toHaveLength(1);
    expect(model.check.forms?.[0]).toMatchObject({
      run: "r1",
      slug,
      name: "forms-result.json",
    });
    const record = run.pages[0]?.forms;
    expect(
      record && "sha256" in record ? fileHash(model.check.forms?.[0]?.text ?? "").sha256 : "",
    ).toBe(record && "sha256" in record ? record.sha256 : "x");
  });

  it("names a forms-result.json that isn't as its run recorded it, and shows no banner for it", () => {
    const { model } = build(
      [{ path: "/contact/", forms: [completed()] }],
      {},
      {
        formsFiles: new Map(),
      },
    );
    expect(model.check.forms).toEqual([]);
    expect(textOf(renderPages(model))).toContain("forms-result.json isn't as the run recorded it");
  });
});

describe("the fingerprint check's library", () => {
  const library = vm.runInNewContext(CHECK_LIBRARY + ";({ checkAll })", { TextEncoder }) as {
    checkAll: (data: unknown) => Promise<{ forms: { ok: boolean }[]; line: string }>;
  };

  it("holds a forms file to the fingerprint its run recorded, whole", async () => {
    const { model, run } = build([{ path: "/contact/", forms: [completed()] }]);
    const data = { ...model.check, runs: [run] };
    const same = await library.checkAll(data);
    expect(same.forms.map((each) => each.ok)).toEqual([true]);
    expect(same.line).toContain("1 of 1 forms result matches its fingerprint");
    const first = model.check.forms?.[0];
    const changed = await library.checkAll({
      ...data,
      forms: [{ ...first, text: `${first?.text ?? ""} ` }],
    });
    expect(changed.forms.map((each) => each.ok)).toEqual([false]);
    expect(changed.line).toContain("forms-result.json doesn't match its fingerprint.");
  });
});

describe("the Word copy", () => {
  const wordOf = (model: ShareModel): string[] => [
    ...wordsOf(wordGlance(model)),
    ...wordsOf(wordPages(model)),
  ];

  it("writes At a glance's line, with its sign and the pages that need work", () => {
    const { model } = build([
      { path: "/a/", forms: [completed()] },
      { path: "/c/", forms: [stuck()] },
    ]);
    const glance = wordsOf(wordGlance(model));
    expect(glance).toContain("⚠ 1 of 2 forms work with NVDA");
    expect(glance.some((line) => line.includes("/c/") && line.includes("don't work"))).toBe(true);
    const all = build([{ path: "/a/", forms: [completed()] }]);
    expect(wordsOf(wordGlance(all.model))).toContain("✓ All 1 form works with NVDA");
  });

  it("writes each form's banner first on its page, with its sign, then what happened at the form", () => {
    const { model } = build([{ path: "/a/", forms: [completed(), stuck()] }]);
    const lines = wordOf(model);
    const at = (words: string): number => lines.findIndex((line) => line === words);
    expect(at("✓ This form works with NVDA.")).toBeGreaterThan(-1);
    expect(at("⚠ This form can't be completed with NVDA.")).toBeGreaterThan(-1);
    expect(lines).toContain('Form 1, sends with "Send"');
    expect(lines).toContain("It stopped at Date of birth.");
    // The banner is before the first lines NVDA said, and the fold after them.
    const first = lines.findIndex((line) => line.startsWith("Heard first"));
    expect(at("✓ This form works with NVDA.")).toBeLessThan(first === -1 ? Infinity : first);
    const fold = at("What happened at the form");
    expect(fold).toBeGreaterThan(at("✓ This form works with NVDA."));
    expect(lines).toContain("Name: NVDA said: Name, edit, required");
    expect(lines).toContain("Required fields, and what NVDA said at each");
    expect(lines).toContain("Each press of the submit control");
    expect(lines).toContain(
      "NVDA said: Name is required The page showed an error: Name is required",
    );
    expect(lines).toContain("axe with its errors showing: not checked");
  });

  it("writes nothing of forms for a run with no forms pass", () => {
    const { model } = build([{ path: "/plain/" }], { passes: ["read", "headings", "tab"] });
    const lines = wordOf(model).join("\n");
    expect(lines).not.toMatch(/This form|What happened at the form|forms work/);
  });

  it("says Not recorded in At a glance for a run from before the pass, and nothing else of forms", () => {
    const { model } = build([{ path: "/old/" }], {
      passes: ["read", "headings", "tab"],
      version: "0.12.0",
    });
    expect(wordsOf(wordGlance(model))).toContain("Not recorded: this run used voicecap 0.12.0.");
    expect(wordOf(model).join(" ")).not.toMatch(/This form|What happened at the form|forms work/);
  });
});

describe("the files for AI tools", () => {
  const FLAGGED: FormOutcome = silent();

  it("carry each banner, with its sign and the flags that decided it, in the Markdown", () => {
    const { model } = build([{ path: "/a/", forms: [FLAGGED, stuck()] }]);
    const md = renderAiMarkdown(model);
    expect(md).toContain("**⚠ This form needs work with NVDA.**");
    expect(md).toContain("**⚠ This form can't be completed with NVDA.**");
    expect(md).toContain("form-error-silent (WCAG 3.3.1 and 4.1.3)");
  });

  it("carry the fold's content in the Markdown, under its heading", () => {
    const { model } = build([{ path: "/a/", forms: [completed()] }]);
    const md = renderAiMarkdown(model);
    expect(md).toContain("#### What happened at the form");
    expect(md).toContain("Required fields, and what NVDA said at each");
    expect(md).toContain("NVDA said: Name, edit, required");
    expect(md).toContain(
      "1. NVDA said: Name is required The page showed an error: Name is required",
    );
    expect(md).toContain("axe with its errors showing: not checked");
  });

  it("carry At a glance's line in the Markdown", () => {
    const { model } = build([
      { path: "/a/", forms: [completed()] },
      { path: "/c/", forms: [stuck()] },
    ]);
    const md = renderAiMarkdown(model);
    expect(md).toContain("**⚠ 1 of 2 forms work with NVDA**");
    expect(md.indexOf("1 of 2 forms work with NVDA")).toBeLessThan(md.indexOf("## Every page"));
  });

  it("carry the banners, the fold, and each flag's WCAG list in the JSON", () => {
    const { model } = build([
      { path: "/a/", forms: [FLAGGED] },
      { path: "/b/", forms: [stuck()] },
    ]);
    const report = JSON.parse(renderAiJson(model)) as {
      forms: {
        found: number;
        working: number;
        notChecked: number;
        banner: { line: string };
        pagesToFix: string[];
      };
      pages: {
        forms: {
          name: string;
          banner: { kind: string; line: string; headline: string; detail: string };
          flags: { rule: string; wcag: string[] }[];
          requiredFields: { name: string; said: string | null }[];
          presses: { said: string; did: string }[];
          axe: string;
        }[];
      }[];
    };
    expect(report.forms).toMatchObject({ found: 2, working: 0, notChecked: 0 });
    expect(report.forms.banner.line).toBe("⚠ 0 of 2 forms work with NVDA");
    expect(report.forms.pagesToFix.map((page) => new URL(page).pathname)).toEqual(["/a/", "/b/"]);
    const [a, b] = report.pages;
    expect(a?.forms[0]).toMatchObject({
      name: 'Form 1, sends with "Send"',
      banner: { kind: "needs-work", headline: "This form needs work with NVDA." },
    });
    expect(a?.forms[0]?.flags[0]).toMatchObject({
      rule: "form-error-silent",
      wcag: ["3.3.1", "4.1.3"],
    });
    expect(a?.forms[0]?.requiredFields).toEqual([
      { name: "Name", said: "Name, edit, required" },
      { name: "Email", said: "Email, edit, required" },
    ]);
    expect(a?.forms[0]?.presses).toHaveLength(2);
    expect(a?.forms[0]?.axe).toBe("axe with its errors showing: not checked");
    expect(b?.forms[0]?.banner.kind).toBe("cant-complete");
  });

  it("say null for a run with no forms pass, and no forms words", () => {
    const { model } = build([{ path: "/plain/" }], { passes: ["read", "headings", "tab"] });
    const report = JSON.parse(renderAiJson(model)) as {
      forms: unknown;
      pages: { forms: unknown }[];
    };
    expect(report.forms).toBeNull();
    expect(report.pages[0]?.forms).toBeNull();
    expect(renderAiMarkdown(model)).not.toMatch(/This form|What happened at the form|forms work/);
  });

  it("say Not recorded in every file for a run from before the pass", () => {
    const { model } = build([{ path: "/old/" }], {
      passes: ["read", "headings", "tab"],
      version: "0.12.0",
    });
    const report = JSON.parse(renderAiJson(model)) as { forms: unknown };
    expect(report.forms).toEqual({ notRecorded: "Not recorded: this run used voicecap 0.12.0." });
    expect(renderAiMarkdown(model)).toContain("Not recorded: this run used voicecap 0.12.0.");
  });

  it("give the counts, and an empty list for the page, when the pass found no form", () => {
    const { model } = build([{ path: "/plain/" }]);
    const report = JSON.parse(renderAiJson(model)) as {
      forms: unknown;
      pages: { forms: unknown }[];
    };
    expect(report.forms).toEqual({
      found: 0,
      working: 0,
      notChecked: 0,
      banner: null,
      pagesToFix: [],
    });
    expect(report.pages[0]?.forms).toEqual([]);
  });
});

describe("accessibility, in Chromium", () => {
  it("has no axe violations with every kind of banner, folds open, in both themes", async () => {
    const { model } = build([
      { path: "/ok/", forms: [completed()] },
      { path: "/silent/", forms: [silent()] },
      { path: "/stuck/", forms: [stuck()] },
      {
        path: "/search/",
        forms: [
          completed({
            form: formOf({ kind: "search" }),
            result: "not-tested",
            reason: "it is a search form",
          }),
        ],
      },
    ]);
    const html = renderSharePage(model, { fontCss: "" });
    const browser = await launchBrowser();
    try {
      for (const scheme of ["dark", "light"] as const) {
        const context = await browser.newContext({ colorScheme: scheme });
        const page = await context.newPage();
        await page.setContent(html);
        await page.evaluate((theme) => {
          document.documentElement.setAttribute("data-theme", theme);
          document.querySelectorAll("details").forEach((each) => each.setAttribute("open", ""));
        }, scheme);
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: 1280, height });
        expect(await violations(page), scheme).toEqual([]);
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }, 120_000);
});
