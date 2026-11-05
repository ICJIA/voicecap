/**
 * The forms fixture: its pages (fixture/site/forms/), and the real NVDA run of them with the forms
 * pass (fixture/forms-run, made by `pnpm fixture:capture` on Windows). Each page's forms must come to
 * what scripts/forms-fixture.ts expects: each form's result, its banner, and its flags, and the
 * page's other flags.
 *
 * Until that run is captured, the run's tests are skipped and say so: the expectations are checked
 * only against what NVDA really did, never against a run made up to match them.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FORMS_FILE, type RunJson } from "../src/model.js";
import { sha256 } from "../src/util/hash.js";
import { FORMS_RUN_DIR } from "../scripts/fixture-reviews.js";
import { FORMS_FIXTURE_EXPECTED, formsPageOutcome } from "../scripts/forms-fixture.js";
import {
  FIXTURE_FORMS_PAGES,
  startFixtureServer,
  type FixtureServer,
} from "../scripts/serve-fixture.js";

const captured = existsSync(path.join(FORMS_RUN_DIR, "run.json"));
if (!captured) {
  console.warn(
    "test/fixture-forms.test.ts: fixture/forms-run isn't captured yet, so the forms run's tests are skipped. Run `pnpm fixture:capture` on the Windows PC (real NVDA) to make it.",
  );
}

describe("the forms fixture's pages", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer({ port: 0 });
  });
  afterAll(async () => {
    await server.close();
  });

  it("has an expectation for every page of the forms run, and no other", () => {
    expect(Object.keys(FORMS_FIXTURE_EXPECTED).sort()).toEqual([...FIXTURE_FORMS_PAGES].sort());
  });

  it.each(FIXTURE_FORMS_PAGES.filter((page) => page !== "/"))(
    "serves %s with one form that sends by POST to a page of its own",
    async (page) => {
      const response = await fetch(new URL(page.slice(1), server.url));
      expect(response.status).toBe(200);
      const html = await response.text();
      const forms = html.match(/<form\b[^>]*>/g) ?? [];
      expect(forms).toHaveLength(1);
      expect(forms[0]).toContain('method="post"');
      expect(forms[0]).toContain(`action="${page}sent/"`);
    },
  );
});

describe.skipIf(!captured)("the forms fixture's recorded run (fixture/forms-run)", () => {
  let run: RunJson;
  beforeAll(async () => {
    run = JSON.parse(await readFile(path.join(FORMS_RUN_DIR, "run.json"), "utf8")) as RunJson;
  });

  it("took the forms pass, after the other three", () => {
    expect(run.settings.passes).toEqual(["read", "headings", "tab", "forms"]);
  });

  it.each(Object.entries(FORMS_FIXTURE_EXPECTED))(
    "%s comes to its expected result, banner, and flags",
    async (page, expected) => {
      expect(await formsPageOutcome(run, FORMS_RUN_DIR, page)).toEqual(expected);
    },
  );

  it("keeps each page's forms results as its record says", async () => {
    for (const page of run.pages.filter((one) => one.status === "done")) {
      const record = page.forms;
      expect(record, page.slug).toBeDefined();
      if (!record || "error" in record) throw new Error(`${page.slug}: no forms results kept`);
      const text = await readFile(path.join(FORMS_RUN_DIR, "pages", page.slug, FORMS_FILE));
      expect(sha256(text), page.slug).toBe(record.sha256);
      expect(text.length, page.slug).toBe(record.bytes);
    }
  });
});
