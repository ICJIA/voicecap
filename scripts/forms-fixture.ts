/**
 * What each page of the forms fixture (fixture/site/forms/, and the home page's search form) should
 * come to in a real NVDA run with the forms pass, and how a run's results are read to compare: shared
 * by `pnpm fixture:capture` (and `pnpm test:nvda`), which checks a new run against it, and
 * test/fixture-forms.test.ts, which checks the recorded run (fixture/forms-run).
 *
 * Each page's forms are read from its forms-result.json: what came of each form, its banner (as
 * every copy of the report draws it, with no review settling anything), and the forms pass's flags.
 * The page's other flags, the read, headings, and Tab passes', are from its record in run.json.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { formsFlags, isFormsRule } from "../src/flags/forms.js";
import { formBanner, type FormBannerKind } from "../src/forms/banner.js";
import { readFormsResults } from "../src/forms/result-file.js";
import type { FormResult } from "../src/forms/types.js";
import { FORMS_FILE, type RunJson } from "../src/model.js";
import { displayPath } from "../src/pages/url.js";

/** What a page's forms came to, form by form, and the page's other flags. */
export interface FormsPageOutcome {
  forms: { result: FormResult; banner: FormBannerKind; flags: string[] }[];
  /** The flags of the read, headings, and Tab passes, by rule, sorted. */
  pageFlags: string[];
}

/** What each forms fixture page should come to, by path. */
export const FORMS_FIXTURE_EXPECTED: Record<string, FormsPageOutcome> = {
  // A search form: left untested, and the banner says why.
  "/": { forms: [{ result: "not-tested", banner: "not-checked", flags: [] }], pageFlags: [] },
  "/forms/good/": { forms: [{ result: "completed", banner: "works", flags: [] }], pageFlags: [] },
  // Chrome's own errors: the ruling of form-error-unlinked for them is checked here.
  "/forms/native/": { forms: [{ result: "completed", banner: "works", flags: [] }], pageFlags: [] },
  "/forms/silent/": {
    forms: [{ result: "completed", banner: "needs-work", flags: ["form-error-silent"] }],
    pageFlags: [],
  },
  "/forms/no-feedback/": {
    forms: [
      {
        result: "stuck",
        banner: "cant-complete",
        flags: ["form-no-feedback", "form-cant-finish"],
      },
    ],
    pageFlags: [],
  },
  // A field with no name is the unlabeled flag's, not a forms flag.
  "/forms/no-labels/": {
    forms: [{ result: "completed", banner: "works", flags: [] }],
    pageFlags: ["unlabeled"],
  },
  "/forms/unreachable/": {
    forms: [
      {
        result: "stuck",
        banner: "cant-complete",
        flags: ["form-cant-finish", "form-field-unreachable"],
      },
    ],
    pageFlags: [],
  },
};

/**
 * What the page at `pagePath` came to in the run in `runDir`; null when the run has no such page
 * that was read. A page whose forms-result.json is missing or unreadable has no forms.
 */
export async function formsPageOutcome(
  run: RunJson,
  runDir: string,
  pagePath: string,
): Promise<FormsPageOutcome | null> {
  const page = run.pages.find(
    (candidate) => candidate.status === "done" && displayPath(candidate.url) === pagePath,
  );
  if (!page) return null;
  const text = await readFile(path.join(runDir, "pages", page.slug, FORMS_FILE), "utf8").catch(
    () => null,
  );
  const forms = (text === null ? null : readFormsResults(text)) ?? [];
  return {
    forms: forms.map((form) => {
      const flags = formsFlags([form]);
      return {
        result: form.result,
        banner: formBanner(form, flags).kind,
        flags: flags.map((flag) => flag.rule),
      };
    }),
    pageFlags: [
      ...new Set(page.flags.map((flag) => flag.rule).filter((rule) => !isFormsRule(rule))),
    ].sort(),
  };
}
